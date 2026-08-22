import { normalizeDocumentTitle } from '../_shared/documentTitle.ts'
import { errorResponse, handler, json, serviceClient } from '../_shared/http.ts'

/**
 * Renames a document's cloud copy.
 *
 * This exists because the client deliberately has no write policy on
 * `scan_documents` — that was revoked on 21 August 2026 after a client could
 * inflate `file_size_bytes` and walk straight past its storage quota. The title
 * is harmless on its own, but reopening client writes to grant it would undo
 * that fix, so the rename goes through the service role here instead, where
 * ownership is checked and only the title can be touched.
 *
 * The app renames locally first and calls this afterwards: storage is
 * local-first, so a rename must never depend on the network.
 */
Deno.serve(
  handler(async (request, user) => {
    const body: { document_id?: string; title?: string } = await request
      .json()
      .catch(() => ({}))

    const documentId = body.document_id
    if (!documentId) {
      return errorResponse('BAD_REQUEST', 'document_id wajib diisi.', 400)
    }

    const title = normalizeDocumentTitle(body.title)
    const db = serviceClient()

    // Scoped to owner_id so a caller cannot rename someone else's document by
    // guessing an id. Nothing here trusts the client beyond the new title.
    //
    // updated_at is deliberately left alone: it is the only record of when the
    // document was last backed up, and CloudBackupScreen both shows and sorts
    // by it. Touching it here would make a months-old backup look like it was
    // taken today and jump to the top of the list.
    const { data, error } = await db
      .from('scan_documents')
      .update({ title })
      .eq('id', documentId)
      .eq('owner_id', user.id)
      .select('id')

    if (error) {
      return errorResponse('DB_ERROR', 'Gagal menyimpan nama baru di cloud.', 500)
    }

    // No row means this document has no cloud copy yet — the local rename still
    // stands, and the next backup will carry the new name up. That is a
    // success for the caller, not something to show an error for.
    return json({ ok: true, title, synced: (data?.length ?? 0) > 0 })
  }),
)
