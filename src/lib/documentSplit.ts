import {
  createDocumentFromPages,
  deleteScanDocument,
  resolvePage,
  type LocalScanDocument,
} from './scanStorage'
import { splitTitles } from './scanSplit'

/**
 * Splitting a document that is already saved, as opposed to a scanning session
 * that has not been saved yet (`scanSplit`).
 *
 * The two share their whole geometry — `planSplit`, `toggleCut`, `everyNCuts`,
 * `splitTitles` all live in `scanSplit` and are used from here unchanged — and
 * they share a screen. What differs is only where the pages come from and what
 * happens to what they came from: a scan disappears into the documents it
 * becomes, while a saved document is still there afterwards unless the user
 * asks for it to go.
 *
 * This is what the merged document needed: merging ten receipts into one file
 * had no inverse, so a merge done by mistake could only be undone by scanning
 * again (dilaporkan Boss Ali 25 Agustus 2026).
 */

export interface DocumentSplitResult {
  saved: LocalScanDocument[]
  /** Groups of page indices that did not make it, in their original order. */
  remaining: number[][]
  /** True only when the source document really was removed. */
  originalRemoved: boolean
  /** Indonesian, ready for the toast. */
  message: string
}

export interface DocumentSplitOptions {
  /**
   * Removes the source document once every group has landed.
   *
   * Never honoured on a partial failure — see the guard in `splitDocument`.
   */
  deleteOriginal?: boolean
  /** Continues the " (n)" numbering after a save that half succeeded. */
  startAt?: number
}

/** One sentence for the toast, covering all-saved, partial and nothing-saved. */
export function summarizeDocumentSplit(
  saved: number,
  failed: number,
  originalRemoved: boolean,
): string {
  if (saved === 0) {
    return 'Tidak ada dokumen yang dibuat. Dokumen aslinya masih utuh — coba lagi.'
  }
  if (failed > 0) {
    // Deliberately not "coba lagi": the run is not resumable from here. The
    // source document still holds every page, so pressing Pisah again would
    // build the groups that already succeeded a second time.
    return `${saved} dokumen dibuat, ${failed} gagal. Dokumen asli masih utuh — hapus hasil yang sudah jadi dulu kalau mau mengulang.`
  }
  return originalRemoved
    ? `${saved} dokumen dibuat, dokumen asli dihapus.`
    : `${saved} dokumen dibuat. Dokumen asli masih ada.`
}

/**
 * Creates one new document per group of pages, sequentially.
 *
 * Pages are copied through `resolvePage`, exactly as merge does, so each new
 * document carries the page the user is looking at — cropped, filtered and
 * annotated — rather than the untouched scan underneath it.
 *
 * Sequential for the same reason as the batch export and the scan split: these
 * are 12 MP JPEGs being copied, and starting ten at once only makes them
 * compete for the same memory on a phone.
 *
 * A group that fails stays behind in `remaining` instead of throwing, so nine
 * good documents are not thrown away by the tenth. The source document is only
 * ever deleted when nothing stayed behind: those pages exist nowhere else yet.
 */
export async function splitDocument(
  doc: LocalScanDocument,
  groups: number[][],
  base: string,
  options: DocumentSplitOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<DocumentSplitResult> {
  const usable = groups
    .map((group) => group.filter((index) => doc.pages[index] !== undefined))
    .filter((group) => group.length > 0)

  if (usable.length === 0) {
    throw new Error('Tidak ada halaman untuk dipisah.')
  }
  // Unlike a scan, there is no "just save it" button next door: splitting into
  // one would silently mint a duplicate of a document that already exists.
  if (usable.length < 2) {
    throw new Error('Belum ada pemisah — tambahkan minimal satu untuk memisah dokumen ini.')
  }

  const startAt = options.startAt ?? 0
  /*
    An empty name field falls back to the document's own title — but through
    `splitTitles`, not around it. Patching the gap downstream with a raw
    `${doc.title} (n)` template skipped the shared normaliser and, worse, the
    length cap: a title typed right up to MAX_TITLE_LENGTH plus " (1)" came out
    longer than `confirm-upload` allows, so the document read one way on the
    phone and another in the cloud the moment it was backed up.
  */
  const effectiveBase = base.trim() === '' ? doc.title : base
  const titles = splitTitles(effectiveBase, usable.length, startAt)

  const saved: LocalScanDocument[] = []
  const remaining: number[][] = []

  for (let index = 0; index < usable.length; index++) {
    onProgress?.(index, usable.length)
    const group = usable[index]

    try {
      saved.push(
        await createDocumentFromPages(
          group.map((page) => ({ pagePath: resolvePage(doc.pages[page]) })),
          // Always a string in practice: `effectiveBase` is non-empty, and
          // splitTitles only leaves gaps for an empty base. The fallback is the
          // base itself rather than a hand-built template, so even the branch
          // that cannot happen stays inside the length cap.
          titles[index] ?? effectiveBase,
        ),
      )
    } catch {
      remaining.push(group)
    }
  }
  onProgress?.(usable.length, usable.length)

  // Only when the whole document made it across. Deleting after a partial run
  // would take the pages of the failed groups with it, and a page that is gone
  // cannot be recovered from anywhere on the phone.
  let originalRemoved = false
  if (options.deleteOriginal && remaining.length === 0 && saved.length > 0) {
    try {
      await deleteScanDocument(doc.id)
      originalRemoved = true
    } catch {
      // The new documents are already safe; a source that refused to delete is
      // a tidiness problem, not a failed split. The message below says which
      // of the two actually happened.
    }
  }

  return {
    saved,
    remaining,
    originalRemoved,
    message: summarizeDocumentSplit(saved.length, remaining.length, originalRemoved),
  }
}
