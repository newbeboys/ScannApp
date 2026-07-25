import { errorResponse, handler, json, serviceClient } from '../_shared/http.ts'
import { presignUpload, SIGNED_URL_TTL_SECONDS } from '../_shared/r2.ts'
import { fitsInQuota, quotaBytesFor } from '../_shared/quota.ts'
import { buildObjectKey } from '../_shared/storageKey.ts'

interface UploadRequest {
  document_id?: string
  file_size_bytes?: number
}

Deno.serve(
  handler(async (request, user) => {
    const body: UploadRequest = await request.json().catch(() => ({}))
    const documentId = body.document_id
    const incoming = Number(body.file_size_bytes)

    if (!documentId || !Number.isFinite(incoming) || incoming <= 0) {
      return errorResponse('BAD_REQUEST', 'document_id dan file_size_bytes wajib diisi.', 400)
    }

    const db = serviceClient()

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('tier, tier_expires_at, pro_plan')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return errorResponse('PROFILE_NOT_FOUND', 'Profil tidak ditemukan.', 404)
    }

    // The signup trigger writes the Basic quota once and nothing updates it
    // afterwards, so the entitlement is recomputed here on every upload and
    // written back — that is what makes a Pro upgrade take effect.
    const quota = quotaBytesFor(profile)

    const { data: usage } = await db
      .from('storage_usage')
      .select('bytes_used, quota_bytes')
      .eq('user_id', user.id)
      .maybeSingle()

    const used = usage?.bytes_used ?? 0

    if (usage && usage.quota_bytes !== quota) {
      await db.from('storage_usage').update({ quota_bytes: quota }).eq('user_id', user.id)
    }

    // Re-backing up overwrites the same object, so only the growth is charged.
    const { data: existing } = await db
      .from('scan_documents')
      .select('file_size_bytes')
      .eq('id', documentId)
      .eq('owner_id', user.id)
      .maybeSingle()

    const replacing = existing?.file_size_bytes ?? 0

    if (!fitsInQuota({ used, quota, incoming, replacing })) {
      return errorResponse(
        'QUOTA_EXCEEDED',
        'Kuota cloud penuh. Hapus cadangan lama atau naik ke Pro untuk ruang lebih besar.',
        409,
      )
    }

    const objectKey = buildObjectKey(user.id, documentId)

    return json({
      upload_url: await presignUpload(objectKey),
      object_key: objectKey,
      expires_in: SIGNED_URL_TTL_SECONDS,
    })
  }),
)
