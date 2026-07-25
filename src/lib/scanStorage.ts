import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { base64ToBlob, blobToBase64 } from './blobBase64'
import { migrateScanIndex, type LocalScanDocument, type ScanPage } from './scanIndexMigration'

export { resolvePage, hasEdits } from './scanIndexMigration'
export type { LocalScanDocument, ScanPage } from './scanIndexMigration'

const SCANS_DIR = 'scans'
const INDEX_PATH = `${SCANS_DIR}/index.json`

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
    Array.isArray(parsed) && parsed.some((doc) => (doc as LocalScanDocument)?.schemaVersion !== 2)
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
 * services, not paths under our own storage. fetch() can read them inside
 * the Capacitor webview, so we pull the bytes and write our own copy —
 * otherwise the source files can disappear once the scanner's temp cache
 * is cleared.
 */
async function fetchAsBase64(uri: string): Promise<string> {
  const response = await fetch(uri)
  return blobToBase64(await response.blob())
}

export async function saveScanDocument(
  imageUris: string[],
  title?: string,
): Promise<LocalScanDocument> {
  await ensureScansDir()
  const id = crypto.randomUUID()
  const docDir = `${SCANS_DIR}/${id}`
  await Filesystem.mkdir({ path: docDir, directory: Directory.Data, recursive: true })

  const pages: ScanPage[] = []
  for (let i = 0; i < imageUris.length; i++) {
    const base64 = await fetchAsBase64(imageUris[i])
    const pagePath = `${docDir}/page-${i + 1}.jpg`
    await Filesystem.writeFile({ path: pagePath, directory: Directory.Data, data: base64 })
    pages.push({ original: pagePath })
  }

  const doc: LocalScanDocument = {
    schemaVersion: 2,
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

export async function listScanDocuments(): Promise<LocalScanDocument[]> {
  return readIndex()
}

export async function getScanDocument(id: string): Promise<LocalScanDocument | null> {
  const docs = await readIndex()
  return docs.find((doc) => doc.id === id) ?? null
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

/** Reads a stored page as raw base64 so it can be decoded into a canvas. */
export async function readPageBase64(pagePath: string): Promise<string> {
  const result = await Filesystem.readFile({ path: pagePath, directory: Directory.Data })
  return result.data as string
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

  const editedPath = `${SCANS_DIR}/${docId}/page-${pageIndex + 1}-edited.jpg`
  await Filesystem.writeFile({
    path: editedPath,
    directory: Directory.Data,
    data: await blobToBase64(edited),
  })

  doc.pages[pageIndex] = { ...page, edited: editedPath }
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

  try {
    await Filesystem.deleteFile({ path: page.edited, directory: Directory.Data })
  } catch {
    // file already gone; clearing the index entry below is what matters
  }

  doc.pages[pageIndex] = { original: page.original }
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
  const id = crypto.randomUUID()
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
    schemaVersion: 2,
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
