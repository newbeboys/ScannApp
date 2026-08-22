import { normalizeDocumentTitle } from '../_shared/documentTitle.ts'
import { errorResponse, handler, json, serviceClient } from '../_shared/http.ts'
import { fitsInQuota, quotaBytesFor } from '../_shared/quota.ts'
import { deleteObject, headObjectSize } from '../_shared/r2.ts'
import { buildObjectKey } from '../_shared/storageKey.ts'

interface ConfirmRequest {
  document_id?: string
  title?: string
  page_count?: number
  /**
   * Still sent by the client, deliberately not read. Kept in the shape so it
   * is obvious the omission is a decision rather than an oversight: the size
   * that counts is measured from R2 below.
   */
  file_size_bytes?: number
}

Deno.serve(
  handler(async (request, user) => {
    const body: ConfirmRequest = await request.json().catch(() => ({}))
    const documentId = body.document_id
    const pageCount = Number(body.page_count)

    if (!documentId) {
      return errorResponse('BAD_REQUEST', 'document_id wajib diisi.', 400)
    }

    const db = serviceClient()
    const objectKey = buildObjectKey(user.id, documentId)

    // The size the client reports is ignored. generate-upload-url only checked
    // a *claim*, and the presigned PUT enforces no length, so a caller can
    // claim a kilobyte and store a gigabyte. R2 is the only honest source.
    const size = await headObjectSize(objectKey)

    if (size === null || size <= 0) {
      return errorResponse('UPLOAD_NOT_FOUND', 'Berkas cadangan belum sampai di cloud.', 400)
    }

    const { data: existing } = await db
      .from('scan_documents')
      .select('file_size_bytes')
      .eq('id', documentId)
      .eq('owner_id', user.id)
      .maybeSingle()

    const previousSize = existing?.file_size_bytes ?? 0

    // Re-check the quota against the real size. The earlier check ran on the
    // claimed one, so this is the point where an oversized upload is caught.
    const { data: profile } = await db
      .from('profiles')
      .select('tier, tier_expires_at, pro_plan')
      .eq('id', user.id)
      .maybeSingle()

    const { data: quotaUsage } = await db
      .from('storage_usage')
      .select('bytes_used')
      .eq('user_id', user.id)
      .maybeSingle()

    // No profile means no entitlement to measure against, so there is nothing
    // that would make keeping the object correct. Treated like being over
    // quota rather than waved through.
    const accepted =
      profile !== null &&
      fitsInQuota({
        used: quotaUsage?.bytes_used ?? 0,
        quota: quotaBytesFor(profile),
        incoming: size,
        replacing: previousSize,
      })

    if (!accepted) {
      // Remove it rather than leave it billing us: the object is already in the
      // bucket, and no database row will point at it after this returns.
      await deleteObject(objectKey).catch((error) => console.error(error))

      return profile === null
        ? errorResponse('PROFILE_NOT_FOUND', 'Profil tidak ditemukan.', 404)
        : errorResponse(
            'QUOTA_EXCEEDED',
            'Kuota cloud penuh. Hapus cadangan lama atau naik ke Pro untuk ruang lebih besar.',
            409,
          )
    }

    const fields = {
      // Shared with rename-document so a backup can never rewrite a title into
      // a different spelling than the rename that just set it.
      title: normalizeDocumentTitle(body.title),
      page_count: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 1,
      file_size_bytes: size,
      export_format: 'pdf',
      local_only: false,
      r2_object_key: objectKey,
      updated_at: new Date().toISOString(),
    }

    // Deliberately not an upsert on `id` alone. This runs as the service role,
    // so RLS is not watching: an upsert would happily rewrite `owner_id` on a
    // row belonging to somebody else, letting anyone who guesses a document id
    // take over its metadata and orphan the victim's backup.
    //
    // Update-then-insert closes that without a check-then-write race: the
    // update is scoped to rows we already own, and if no such row exists the
    // insert lets the primary key decide. A 23505 there means the id belongs
    // to another account, which the database establishes atomically.
    const { data: updated, error: updateError } = await db
      .from('scan_documents')
      .update(fields)
      .eq('id', documentId)
      .eq('owner_id', user.id)
      .select('id')

    if (updateError) {
      console.error(updateError)
      return errorResponse('DB_ERROR', 'Gagal menyimpan metadata dokumen.', 500)
    }

    if (!updated || updated.length === 0) {
      const { error: insertError } = await db
        .from('scan_documents')
        .insert({ id: documentId, owner_id: user.id, ...fields })

      if (insertError?.code === '23505') {
        return errorResponse('FORBIDDEN', 'Dokumen ini bukan milik akun kamu.', 403)
      }

      if (insertError) {
        console.error(insertError)
        return errorResponse('DB_ERROR', 'Gagal menyimpan metadata dokumen.', 500)
      }
    }

    // Charge the difference, not the whole file: a second backup of the same
    // document replaces the object rather than adding to it.
    const nextUsed = Math.max(0, (quotaUsage?.bytes_used ?? 0) - previousSize + size)

    await db
      .from('storage_usage')
      .update({ bytes_used: nextUsed, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)

    return json({ ok: true, bytes_used: nextUsed })
  }),
)
