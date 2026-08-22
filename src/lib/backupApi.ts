import { buildPdfFile } from './documentExport'
import type { LocalScanDocument } from './scanStorage'
import { supabase } from './supabase'
import type { Tier } from './tier'

export interface CloudBackup {
  id: string
  title: string
  pageCount: number
  sizeBytes: number
  updatedAt: string
}

export interface StorageUsage {
  usedBytes: number
  /** Quota recorded server-side; the UI prefers the entitlement it computes. */
  quotaBytes: number
}

/** Errors carry an Indonesian message straight from the Edge Function. */
async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })

  if (error) {
    // Supabase wraps non-2xx responses; dig out our own message when present.
    const context = (error as { context?: Response }).context
    const parsed = await context
      ?.json()
      .catch(() => null)
      .then((value: { message?: string } | null) => value?.message)

    throw new Error(parsed ?? 'Gagal menghubungi server. Periksa koneksi lalu coba lagi.')
  }

  return data as T
}

/**
 * Exports the document to PDF, uploads it straight to R2 with a short-lived
 * signed URL, then tells the server it landed. The bytes never pass through
 * Supabase compute (BACKEND_API_DESIGN.md Bagian 8).
 */
export async function backupDocument(doc: LocalScanDocument, tier: Tier): Promise<number> {
  const file = await buildPdfFile(doc, tier)
  const sizeBytes = file.blob.size

  const { upload_url } = await callFunction<{ upload_url: string }>('generate-upload-url', {
    document_id: doc.id,
    file_size_bytes: sizeBytes,
  })

  // A rejected fetch here is usually the network dropping or the bucket
  // refusing the browser's preflight — neither produces a message worth
  // showing, so translate both into one the user can act on.
  let response: Response
  try {
    response = await fetch(upload_url, {
      method: 'PUT',
      body: file.blob,
      headers: { 'Content-Type': 'application/pdf' },
    })
  } catch {
    throw new Error('Tidak bisa menghubungi penyimpanan cloud. Periksa koneksi lalu coba lagi.')
  }

  if (!response.ok) {
    throw new Error('Gagal mengunggah ke cloud. Coba lagi sebentar lagi.')
  }

  const { bytes_used } = await callFunction<{ bytes_used: number }>('confirm-upload', {
    document_id: doc.id,
    file_size_bytes: sizeBytes,
    title: doc.title,
    page_count: doc.pageCount,
  })

  return bytes_used
}

export async function deleteBackup(documentId: string): Promise<void> {
  await callFunction('delete-backup', { document_id: documentId })
}

/**
 * Whether the new name reached the cloud copy.
 *
 * `no-cloud-copy` and `failed` are kept apart on purpose: only the second one
 * is worth warning the user about. A document that was never backed up has
 * nothing out of sync.
 */
export type CloudRenameResult = 'synced' | 'no-cloud-copy' | 'failed'

/**
 * Points the cloud copy at the document's new name.
 *
 * Goes through an Edge Function rather than a plain update because the client
 * has no write policy on `scan_documents` — revoked on 21 August 2026 so a
 * caller could not inflate its own `file_size_bytes` past the storage quota.
 *
 * Never throws: the local rename has already succeeded by the time this runs,
 * and storage is local-first, so a dropped connection must not look like the
 * rename failed. The next backup carries the current name up anyway.
 *
 * Whether a cloud copy exists is answered by the server, not guessed from the
 * client's backup map — that map is empty whenever listCloudBackups() failed,
 * which would otherwise silently skip the sync for the rest of the session.
 */
export async function renameCloudDocument(
  documentId: string,
  title: string,
): Promise<CloudRenameResult> {
  try {
    const { synced } = await callFunction<{ synced: boolean }>('rename-document', {
      document_id: documentId,
      title,
    })
    return synced ? 'synced' : 'no-cloud-copy'
  } catch {
    return 'failed'
  }
}

/** Returns a short-lived link the caller can open or download. */
export async function backupDownloadUrl(documentId: string): Promise<string> {
  const { download_url } = await callFunction<{ download_url: string }>('generate-download-url', {
    document_id: documentId,
  })

  return download_url
}

/**
 * Read straight from the table — RLS already limits both of these to the
 * signed-in user, so no Edge Function round trip is needed just to look.
 *
 * `local_only = false` is what actually means "there is a copy in R2". Every
 * row today is written by `confirm-upload`, which always sets it false, so the
 * filter changes nothing right now. It is here because the offline metadata
 * sync in SYSTEM_DESIGN.md Bagian 6 is meant to create `local_only = true`
 * rows: without the filter, the day that lands, this list would show documents
 * that have no cloud copy and the backup badge would claim they are safe.
 */
export async function listCloudBackups(): Promise<CloudBackup[]> {
  const { data, error } = await supabase
    .from('scan_documents')
    .select('id, title, page_count, file_size_bytes, updated_at')
    .eq('local_only', false)
    .order('updated_at', { ascending: false })

  if (error || !data) return []

  return data.map((row) => ({
    id: row.id,
    title: row.title,
    pageCount: row.page_count,
    sizeBytes: row.file_size_bytes,
    updatedAt: row.updated_at,
  }))
}

export async function fetchStorageUsage(): Promise<StorageUsage | null> {
  const { data, error } = await supabase
    .from('storage_usage')
    .select('bytes_used, quota_bytes')
    .maybeSingle()

  if (error || !data) return null

  return { usedBytes: data.bytes_used, quotaBytes: data.quota_bytes }
}
