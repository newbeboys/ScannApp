import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { normalizeDocumentTitle } from '../../supabase/functions/_shared/documentTitle'
import { base64ToBlob, blobToBase64 } from './blobBase64'
import {
  effectiveFilter,
  filterSource,
  migrateScanIndex,
  type DocumentFilter,
  type LocalScanDocument,
  type PageFilter,
  type ScanPage,
} from './scanIndexMigration'

export {
  resolvePage,
  hasEdits,
  effectiveFilter,
  filterSource,
  DOCUMENT_FILTERS,
} from './scanIndexMigration'
export type { LocalScanDocument, ScanPage, DocumentFilter, PageFilter } from './scanIndexMigration'

const SCANS_DIR = 'scans'
const INDEX_PATH = `${SCANS_DIR}/index.json`

/**
 * crypto.randomUUID() only exists from Chrome 92, and this app supports
 * Android 7 (minSdkVersion 24), where the system WebView can be much older.
 *
 * The fallback must still produce a syntactically valid UUID v4: this id is not
 * only a local folder name, it also travels to Supabase as the document_id that
 * `confirm-upload` writes into `scan_documents.id`, which is a `uuid` column.
 * An arbitrary string is rejected by Postgres (22P02) only *after* the file has
 * already been PUT to R2, leaving an orphaned object that still costs money.
 */
function newDocumentId(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()

  const bytes = new Uint8Array(16)
  if (typeof crypto?.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

async function ensureScansDir(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: SCANS_DIR, directory: Directory.Data, recursive: true })
  } catch {
    // directory already exists
  }
}

/**
 * Reads the index and upgrades any Fase 1 (v1) entries in place. The
 * rewrite only happens when something actually changed, so the common
 * path stays a single read.
 */
async function readIndex(): Promise<LocalScanDocument[]> {
  let parsed: unknown
  try {
    const result = await Filesystem.readFile({
      path: INDEX_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    })
    parsed = JSON.parse(result.data as string)
  } catch {
    return []
  }

  const docs = migrateScanIndex(parsed)
  const needsRewrite =
    Array.isArray(parsed) && parsed.some((doc) => (doc as LocalScanDocument)?.schemaVersion !== 3)
  if (needsRewrite) {
    await writeIndex(docs)
  }
  return docs
}

async function writeIndex(docs: LocalScanDocument[]): Promise<void> {
  await Filesystem.writeFile({
    path: INDEX_PATH,
    directory: Directory.Data,
    data: JSON.stringify(docs),
    encoding: Encoding.UTF8,
  })
}

/**
 * The document scanner returns file/content URIs owned by Google Play
 * services, not paths under our own storage. We pull the bytes and write our
 * own copy — otherwise the source files can disappear once the scanner's temp
 * cache is cleared.
 *
 * convertFileSrc is applied again here even though scanDocument already did it.
 * It is idempotent (an https URL matches none of its prefixes and is returned
 * unchanged), and a raw `file://` URI reaching fetch() is precisely what failed
 * before: it rejects with the bare message "Failed to fetch", which says nothing
 * about the real cause. Cheap insurance at the layer that actually broke.
 */
async function fetchAsBase64(uri: string): Promise<string> {
  const response = await fetch(Capacitor.convertFileSrc(uri))
  if (!response.ok) {
    throw new Error(`Gagal membaca halaman hasil pindai (HTTP ${response.status}).`)
  }
  return blobToBase64(await response.blob())
}

export async function saveScanDocument(
  imageUris: string[],
  title?: string,
): Promise<LocalScanDocument> {
  await ensureScansDir()
  const id = newDocumentId()
  const docDir = `${SCANS_DIR}/${id}`
  await Filesystem.mkdir({ path: docDir, directory: Directory.Data, recursive: true })

  const pages: ScanPage[] = []
  try {
    for (let i = 0; i < imageUris.length; i++) {
      const base64 = await fetchAsBase64(imageUris[i])
      const pagePath = `${docDir}/page-${i + 1}.jpg`
      await Filesystem.writeFile({ path: pagePath, directory: Directory.Data, data: base64 })
      pages.push({ original: pagePath })
    }
  } catch (error) {
    // The index is written last, so a page that fails half way through would
    // strand docDir with no entry pointing at it — and deleteScanDocument only
    // works from the index, so nothing would ever reclaim those bytes.
    await Filesystem.rmdir({ path: docDir, directory: Directory.Data, recursive: true }).catch(
      () => {
        // Nothing better to do; the original failure is what matters.
      },
    )
    throw error
  }

  const doc: LocalScanDocument = {
    schemaVersion: 3,
    id,
    title: title ?? `Scan ${new Date().toLocaleString('id-ID')}`,
    createdAt: new Date().toISOString(),
    pageCount: pages.length,
    pages,
  }

  const docs = await readIndex()
  docs.unshift(doc)
  await writeIndex(docs)

  return doc
}

/**
 * Puts a document from the cloud back on this phone.
 *
 * The other half of `backupDocument`: pages that `pdfImport` recovered from
 * the backup PDF are written to disk and indexed, so a document that only
 * existed in R2 — after a reinstall or on a new phone — becomes an ordinary
 * local document again, editable and mergeable like any other.
 *
 * The cloud's id is kept rather than minting a new one. That id is the primary
 * key of the `scan_documents` row and the R2 object name behind it, so a fresh
 * one would make the next backup write a *second* row, charge the same bytes
 * against the quota twice, and orphan the copy already up there.
 */
export async function restoreDocumentFromJpegs(
  cloud: { id: string; title: string; createdAt: string },
  jpegs: Uint8Array[],
): Promise<LocalScanDocument> {
  // Checked before writing anything: overwriting a local copy would destroy
  // page edits that were never backed up. The UI only ever offers documents
  // that are missing locally, but storage must not depend on the caller for
  // that. The index is read again at the end, which is the real guard.
  if ((await readIndex()).some((doc) => doc.id === cloud.id)) {
    throw new Error('Dokumen ini sudah ada di HP.')
  }

  await ensureScansDir()
  const docDir = `${SCANS_DIR}/${cloud.id}`
  try {
    await Filesystem.mkdir({ path: docDir, directory: Directory.Data, recursive: true })
  } catch {
    // Unlike saveScanDocument, the id comes from the cloud rather than being
    // freshly minted, so the folder can already exist — a delete whose rmdir
    // failed still clears the index. An existing folder is no reason to
    // refuse; a real failure surfaces when the first page is written.
  }

  const pages: ScanPage[] = []
  try {
    for (let i = 0; i < jpegs.length; i++) {
      const pagePath = `${docDir}/page-${i + 1}.jpg`
      await Filesystem.writeFile({
        path: pagePath,
        directory: Directory.Data,
        data: await blobToBase64(new Blob([jpegs[i] as BlobPart])),
      })
      pages.push({ original: pagePath })
    }
  } catch (error) {
    // Same reasoning as saveScanDocument: the index is written last, so a
    // failure here would strand docDir with nothing pointing at it.
    await Filesystem.rmdir({ path: docDir, directory: Directory.Data, recursive: true }).catch(
      () => {
        // Nothing better to do; the original failure is what matters.
      },
    )
    throw error
  }

  const doc: LocalScanDocument = {
    schemaVersion: 3,
    id: cloud.id,
    title: cloud.title,
    // The day it was scanned, not the day it came back.
    createdAt: cloud.createdAt,
    pageCount: pages.length,
    pages,
  }

  // Read last, like saveScanDocument. A copy taken before the download started
  // would be stale by now: restoring is slow enough that the user can finish a
  // scan meanwhile, and writing that old copy back would drop the new document
  // from the index while its files stayed on disk as garbage.
  const docs = await readIndex()
  if (docs.some((existing) => existing.id === cloud.id)) {
    // A second restore of the same backup got there first. Its pages are ours
    // byte for byte — same id, same folder — so there is nothing to clean up.
    throw new Error('Dokumen ini sudah ada di HP.')
  }

  docs.unshift(doc)
  await writeIndex(docs)

  return doc
}

export async function listScanDocuments(): Promise<LocalScanDocument[]> {
  return readIndex()
}

export async function getScanDocument(id: string): Promise<LocalScanDocument | null> {
  const docs = await readIndex()
  return docs.find((doc) => doc.id === id) ?? null
}

/**
 * Renames a document on this device. Storage is local-first, so this never
 * touches the network — syncing the new name to the cloud copy is a separate,
 * best-effort step the caller runs afterwards.
 */
export async function renameScanDocument(
  id: string,
  title: string,
): Promise<LocalScanDocument> {
  const docs = await readIndex()
  const doc = docs.find((entry) => entry.id === id)
  if (!doc) throw new Error('Dokumen tidak ditemukan.')

  doc.title = normalizeDocumentTitle(title)
  await writeIndex(docs)

  return doc
}

export async function deleteScanDocument(id: string): Promise<void> {
  const docs = await readIndex()
  if (!docs.some((doc) => doc.id === id)) return

  try {
    await Filesystem.rmdir({
      path: `${SCANS_DIR}/${id}`,
      directory: Directory.Data,
      recursive: true,
    })
  } catch {
    // already gone from disk; still drop it from the index below
  }

  await writeIndex(docs.filter((doc) => doc.id !== id))
}

export async function deleteAllScanDocuments(): Promise<void> {
  try {
    await Filesystem.rmdir({ path: SCANS_DIR, directory: Directory.Data, recursive: true })
  } catch {
    // nothing stored yet
  }
  await ensureScansDir()
  await writeIndex([])
}

/** Reads a stored page as raw base64. Kept for the web storage fallback. */
export async function readPageBase64(pagePath: string): Promise<string> {
  const result = await Filesystem.readFile({ path: pagePath, directory: Directory.Data })
  return result.data as string
}

/**
 * Reads a stored page as binary — the fast path, and the one every caller that
 * just wants the bytes should use.
 *
 * Filesystem.readFile is the slow way to move an image on Android: the plugin
 * base64-encodes the file (a 3 MB scan becomes a 4 MB string), hands that
 * string across the JS/Java bridge as JSON, and then base64ToBlob walks it byte
 * by byte in JavaScript. Measured on a desktop, the decode alone costs 9-27x
 * more than building the Blob straight from bytes, and the bridge hop costs
 * more again on a phone.
 *
 * On native the file already has a URL that Capacitor's own asset loader
 * serves — the same one the <img> tags use — so fetch() streams the bytes with
 * no base64 and no bridge in the way.
 */
export async function readPageBlob(pagePath: string): Promise<Blob> {
  if (!Capacitor.isNativePlatform()) {
    // Web storage is IndexedDB-backed, so there is no URL to stream from.
    // Deliberately not routed through getScanPageDisplayUri: that would park a
    // full-size object URL in the display cache, which only invalidateDisplayUri
    // ever revokes — exporting 20 pages would strand tens of MB for the session.
    return base64ToBlob(await readPageBase64(pagePath))
  }

  const { uri } = await Filesystem.getUri({ path: pagePath, directory: Directory.Data })

  // cache: 'no-store' is load-bearing, not a precaution. savePageEdit rewrites
  // the *same* path (page-N-edited.jpg) and the URL is therefore stable, so the
  // webview would happily serve the bytes it cached for the <img> that is
  // showing the page right now. Rotating twice would then re-rotate the first
  // rotation's output and appear stuck at 90 degrees, and the exported PDF
  // would carry the pre-edit pixels. Filesystem.readFile never had this problem
  // because it always went to disk.
  const response = await fetch(Capacitor.convertFileSrc(uri), { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Gagal membaca halaman dokumen (HTTP ${response.status}).`)
  }
  return response.blob()
}

/**
 * Derives a page's edit/filter file path from its own stable `original` path
 * rather than from its current position in the array.
 *
 * `reorderPages` only changes array order — it never renames a page's files.
 * A path keyed on `pageIndex` would therefore collide the moment two pages
 * swap places: page A (cropped, `edited: page-1-edited.jpg`) moved to index 1
 * and page B moved into index 0 would both compute `page-1-edited.jpg` the
 * next time either was edited, and one page's file would silently overwrite
 * the other's. `original` is assigned once, at creation, and never changes,
 * so it stays a safe, unique key for the document's lifetime.
 */
function derivedPath(original: string, suffix: 'edited' | 'filtered'): string {
  return original.replace(/\.jpg$/i, `-${suffix}.jpg`)
}

/**
 * Stores an edited version of a page alongside — never over — the original.
 * A page can be edited repeatedly; each save replaces the previous edit.
 */
export async function savePageEdit(
  docId: string,
  pageIndex: number,
  edited: Blob,
): Promise<LocalScanDocument> {
  const docs = await readIndex()
  const doc = docs.find((entry) => entry.id === docId)
  if (!doc) throw new Error('Dokumen tidak ditemukan.')

  const page = doc.pages[pageIndex]
  if (!page) throw new Error('Halaman tidak ditemukan.')

  const editedPath = derivedPath(page.original, 'edited')
  await Filesystem.writeFile({
    path: editedPath,
    directory: Directory.Data,
    data: await blobToBase64(edited),
  })

  // The filter render was made from the *old* geometry, so it is now wrong —
  // it would show the page at its pre-crop shape. Dropped here; the caller
  // re-renders it from the new edit (see documentEditing.editPage).
  const { filtered, ...rest } = page
  if (filtered) {
    invalidateDisplayUri(filtered)
    await Filesystem.deleteFile({ path: filtered, directory: Directory.Data }).catch(() => {
      // Already gone; the index no longer points at it either way.
    })
  }

  doc.pages[pageIndex] = { ...rest, edited: editedPath }
  await writeIndex(docs)
  return doc
}

/** Drops the edited variant so the page falls back to the untouched scan. */
export async function resetPageEdit(
  docId: string,
  pageIndex: number,
): Promise<LocalScanDocument> {
  const docs = await readIndex()
  const doc = docs.find((entry) => entry.id === docId)
  if (!doc) throw new Error('Dokumen tidak ditemukan.')

  const page = doc.pages[pageIndex]
  if (!page?.edited) return doc

  // The filter render was made from the geometry that is about to be thrown
  // away, so it is now wrong and gets deleted here — but *not* regenerated:
  // that needs a canvas, which this module deliberately has no access to.
  // documentEditing.revertPage does that step right after calling this, using
  // the page this function returns.
  for (const path of [page.edited, page.filtered]) {
    if (!path) continue
    invalidateDisplayUri(path)
    try {
      await Filesystem.deleteFile({ path, directory: Directory.Data })
    } catch {
      // file already gone; clearing the index entry below is what matters
    }
  }

  // The page's own filter *choice* survives — reverting a crop is not the
  // same thing as changing the user's mind about this page's filter. Losing
  // it here would silently pull the page back onto the document's filter, or
  // strip a deliberate 'none' exception, neither of which "Asli" ever asked for.
  doc.pages[pageIndex] = {
    original: page.original,
    ...(page.filter ? { filter: page.filter } : {}),
  }
  await writeIndex(docs)
  return doc
}

/** Renders one page's filter, or clears it, and returns the new page entry. */
async function renderPageFilter(
  page: ScanPage,
  filter: DocumentFilter | null,
  render: FilterRenderer,
): Promise<ScanPage> {
  const path = derivedPath(page.original, 'filtered')

  if (filter === null) {
    if (page.filtered) {
      invalidateDisplayUri(page.filtered)
      await Filesystem.deleteFile({ path: page.filtered, directory: Directory.Data }).catch(() => {
        // Already gone. The index entry is what decides what gets displayed.
      })
    }
    const { filtered: _dropped, ...rest } = page
    return rest
  }

  // Always from the geometry chain, never from the previous render — this is
  // what lets a filter be swapped without eating the crop underneath it.
  const rendered = await render(await readPageBlob(filterSource(page)), filter)
  await Filesystem.writeFile({
    path,
    directory: Directory.Data,
    data: await blobToBase64(rendered),
  })
  // The path is stable across re-renders, so any cached object URL is stale.
  invalidateDisplayUri(path)

  return { ...page, filtered: path }
}

/**
 * Renders a filter, supplied by the caller rather than imported.
 *
 * Storage has no business touching a canvas — keeping the rendering out here
 * is what lets this module stay free of the DOM, and lets these functions be
 * tested without one.
 */
export type FilterRenderer = (source: Blob, filter: DocumentFilter) => Promise<Blob>

/**
 * Sets the filter for the whole document and re-renders every page that is
 * not carrying its own exception.
 *
 * One index write at the end rather than one per page: twenty pages would
 * otherwise mean twenty rewrites of the same file, each a window in which a
 * crash leaves the index disagreeing with what is on disk.
 */
export async function applyDocumentFilter(
  docId: string,
  filter: DocumentFilter | null,
  render: FilterRenderer,
  onProgress?: (done: number, total: number) => void,
): Promise<LocalScanDocument> {
  const docs = await readIndex()
  const doc = docs.find((entry) => entry.id === docId)
  if (!doc) throw new Error('Dokumen tidak ditemukan.')

  const next: LocalScanDocument = { ...doc, filter: filter ?? undefined }
  if (filter === null) delete next.filter

  const pages: ScanPage[] = []
  for (const [index, page] of doc.pages.entries()) {
    pages.push(await renderPageFilter(page, effectiveFilter(next, page), render))
    onProgress?.(index + 1, doc.pages.length)
  }

  next.pages = pages
  docs[docs.indexOf(doc)] = next
  await writeIndex(docs)
  return next
}

/**
 * Sets one page's exception to the document filter.
 *
 * `null` puts the page back under the document's choice; `'none'` is the
 * opposite — the user deliberately keeping this one page plain.
 */
export async function applyPageFilter(
  docId: string,
  pageIndex: number,
  choice: PageFilter | null,
  render: FilterRenderer,
): Promise<LocalScanDocument> {
  const docs = await readIndex()
  const doc = docs.find((entry) => entry.id === docId)
  if (!doc) throw new Error('Dokumen tidak ditemukan.')

  const page = doc.pages[pageIndex]
  if (!page) throw new Error('Halaman tidak ditemukan.')

  const withChoice: ScanPage = { ...page }
  if (choice === null) delete withChoice.filter
  else withChoice.filter = choice

  doc.pages[pageIndex] = await renderPageFilter(
    withChoice,
    effectiveFilter(doc, withChoice),
    render,
  )

  await writeIndex(docs)
  return doc
}

/**
 * Moves a page to a new position.
 *
 * Only the order in the index changes — no file is touched or rewritten, so
 * this stays instant however large the pages are. The filenames deliberately
 * keep their original numbers; they are identifiers, not positions, and
 * renaming them would mean rewriting every page to fix an ordering that the
 * index already expresses.
 */
export async function reorderPages(
  docId: string,
  from: number,
  to: number,
): Promise<LocalScanDocument> {
  const docs = await readIndex()
  const doc = docs.find((entry) => entry.id === docId)
  if (!doc) throw new Error('Dokumen tidak ditemukan.')

  const lastIndex = doc.pages.length - 1
  if (from < 0 || from > lastIndex || to < 0 || to > lastIndex || from === to) return doc

  const [moved] = doc.pages.splice(from, 1)
  doc.pages.splice(to, 0, moved)

  await writeIndex(docs)
  return doc
}

/**
 * Creates a new document by copying page files out of existing ones, used
 * by the merge flow. Copying (rather than referencing) keeps the merged
 * document standalone — deleting a source document later cannot break it.
 */
export async function createDocumentFromPages(
  sources: { pagePath: string }[],
  title: string,
  sourceDocumentIds: string[],
): Promise<LocalScanDocument> {
  await ensureScansDir()
  const id = newDocumentId()
  const docDir = `${SCANS_DIR}/${id}`
  await Filesystem.mkdir({ path: docDir, directory: Directory.Data, recursive: true })

  const pages: ScanPage[] = []
  for (let i = 0; i < sources.length; i++) {
    const targetPath = `${docDir}/page-${i + 1}.jpg`
    await Filesystem.copy({
      from: sources[i].pagePath,
      directory: Directory.Data,
      to: targetPath,
      toDirectory: Directory.Data,
    })
    pages.push({ original: targetPath })
  }

  const doc: LocalScanDocument = {
    schemaVersion: 3,
    id,
    title,
    createdAt: new Date().toISOString(),
    pageCount: pages.length,
    pages,
    sourceDocumentIds,
  }

  const docs = await readIndex()
  docs.unshift(doc)
  await writeIndex(docs)
  return doc
}

/**
 * On the web the Filesystem plugin is backed by IndexedDB, so getUri()
 * hands back a virtual path that no <img> can load. Reading the bytes into
 * an object URL keeps every screen working in `npm run dev` without any
 * separate mock storage layer. Native still gets the cheap direct URI.
 */
const webDisplayUriCache = new Map<string, string>()

export async function getScanPageDisplayUri(pagePath: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const result = await Filesystem.getUri({ path: pagePath, directory: Directory.Data })
    return Capacitor.convertFileSrc(result.uri)
  }

  const cached = webDisplayUriCache.get(pagePath)
  if (cached) return cached

  const blob = base64ToBlob(await readPageBase64(pagePath))
  const objectUrl = URL.createObjectURL(blob)
  webDisplayUriCache.set(pagePath, objectUrl)
  return objectUrl
}

/** Drops a cached object URL so an edited page re-reads its new bytes. */
export function invalidateDisplayUri(pagePath: string): void {
  const cached = webDisplayUriCache.get(pagePath)
  if (cached) {
    URL.revokeObjectURL(cached)
    webDisplayUriCache.delete(pagePath)
  }
}
