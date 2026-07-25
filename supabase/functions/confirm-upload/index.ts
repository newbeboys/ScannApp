import { errorResponse, handler, json, serviceClient } from '../_shared/http.ts'
import { buildObjectKey } from '../_shared/storageKey.ts'

interface ConfirmRequest {
  document_id?: string
  file_size_bytes?: number
  title?: string
  page_count?: number
}

Deno.serve(
  handler(async (request, user) => {
    const body: ConfirmRequest = await request.json().catch(() => ({}))
    const documentId = body.document_id
    const size = Number(body.file_size_bytes)
    const pageCount = Number(body.page_count)

    if (!documentId || !Number.isFinite(size) || size <= 0) {
      return errorResponse('BAD_REQUEST', 'document_id dan file_size_bytes wajib diisi.', 400)
    }

    const db = serviceClient()
    const objectKey = buildObjectKey(user.id, documentId)

    const { data: existing } = await db
      .from('scan_documents')
      .select('file_size_bytes')
      .eq('id', documentId)
      .eq('owner_id', user.id)
      .maybeSingle()

    const previousSize = existing?.file_size_bytes ?? 0

    const { error: upsertError } = await db.from('scan_documents').upsert(
      {
        id: documentId,
        owner_id: user.id,
        title: body.title?.slice(0, 200) || 'Dokumen',
        page_count: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 1,
        file_size_bytes: size,
        export_format: 'pdf',
        local_only: false,
        r2_object_key: objectKey,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )

    if (upsertError) {
      console.error(upsertError)
      return errorResponse('DB_ERROR', 'Gagal menyimpan metadata dokumen.', 500)
    }

    // Charge the difference, not the whole file: a second backup of the same
    // document replaces the object rather than adding to it.
    const { data: usage } = await db
      .from('storage_usage')
      .select('bytes_used')
      .eq('user_id', user.id)
      .maybeSingle()

    const nextUsed = Math.max(0, (usage?.bytes_used ?? 0) - previousSize + size)

    await db
      .from('storage_usage')
      .update({ bytes_used: nextUsed, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)

    return json({ ok: true, bytes_used: nextUsed })
  }),
)
