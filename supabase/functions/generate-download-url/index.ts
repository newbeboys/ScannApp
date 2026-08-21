import { errorResponse, handler, json, serviceClient } from '../_shared/http.ts'
import { presignDownload, SIGNED_URL_TTL_SECONDS } from '../_shared/r2.ts'
import { isOwnedBy } from '../_shared/storageKey.ts'

Deno.serve(
  handler(async (request, user) => {
    const body: { document_id?: string } = await request.json().catch(() => ({}))
    const documentId = body.document_id

    if (!documentId) {
      return errorResponse('BAD_REQUEST', 'document_id wajib diisi.', 400)
    }

    const db = serviceClient()

    // Scoped by owner_id, so another user's id simply finds nothing.
    const { data: doc } = await db
      .from('scan_documents')
      .select('r2_object_key, title')
      .eq('id', documentId)
      .eq('owner_id', user.id)
      .maybeSingle()

    if (!doc?.r2_object_key) {
      return errorResponse('NOT_FOUND', 'Cadangan dokumen ini tidak ditemukan.', 404)
    }

    // Belt and braces: never sign a key that sits outside the caller's prefix,
    // even if a bad row somehow made it into the table.
    if (!isOwnedBy(doc.r2_object_key, user.id)) {
      return errorResponse('FORBIDDEN', 'Dokumen ini bukan milik akun kamu.', 403)
    }

    return json({
      download_url: await presignDownload(doc.r2_object_key),
      title: doc.title,
      expires_in: SIGNED_URL_TTL_SECONDS,
    })
  }),
)
