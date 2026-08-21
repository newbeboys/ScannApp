import { errorResponse, handler, json, serviceClient } from '../_shared/http.ts'
import { deleteObject } from '../_shared/r2.ts'
import { isOwnedBy } from '../_shared/storageKey.ts'

Deno.serve(
  handler(async (request, user) => {
    const body: { document_id?: string } = await request.json().catch(() => ({}))
    const documentId = body.document_id

    if (!documentId) {
      return errorResponse('BAD_REQUEST', 'document_id wajib diisi.', 400)
    }

    const db = serviceClient()

    const { data: doc } = await db
      .from('scan_documents')
      .select('r2_object_key, file_size_bytes')
      .eq('id', documentId)
      .eq('owner_id', user.id)
      .maybeSingle()

    // Nothing to remove is a success, not an error — the caller wanted this
    // document gone from the cloud and it already is.
    if (!doc) return json({ ok: true, bytes_used: null })

    if (doc.r2_object_key) {
      if (!isOwnedBy(doc.r2_object_key, user.id)) {
        return errorResponse('FORBIDDEN', 'Dokumen ini bukan milik akun kamu.', 403)
      }
      await deleteObject(doc.r2_object_key)
    }

    await db.from('scan_documents').delete().eq('id', documentId).eq('owner_id', user.id)

    const { data: usage } = await db
      .from('storage_usage')
      .select('bytes_used')
      .eq('user_id', user.id)
      .maybeSingle()

    const nextUsed = Math.max(0, (usage?.bytes_used ?? 0) - (doc.file_size_bytes ?? 0))

    await db
      .from('storage_usage')
      .update({ bytes_used: nextUsed, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)

    return json({ ok: true, bytes_used: nextUsed })
  }),
)
