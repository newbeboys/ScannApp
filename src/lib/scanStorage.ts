import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'

const SCANS_DIR = 'scans'
const INDEX_PATH = `${SCANS_DIR}/index.json`

export interface LocalScanDocument {
  id: string
  title: string
  createdAt: string
  pageCount: number
  /** Paths relative to Directory.Data, e.g. "scans/<id>/page-1.jpg" */
  pagePaths: string[]
}

async function ensureScansDir(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: SCANS_DIR, directory: Directory.Data, recursive: true })
  } catch {
    // directory already exists
  }
}

async function readIndex(): Promise<LocalScanDocument[]> {
  try {
    const result = await Filesystem.readFile({
      path: INDEX_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    })
    return JSON.parse(result.data as string) as LocalScanDocument[]
  } catch {
    return []
  }
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
  const blob = await response.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result as string
      resolve(dataUrl.substring(dataUrl.indexOf(',') + 1))
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export async function saveScanDocument(
  imageUris: string[],
  title?: string,
): Promise<LocalScanDocument> {
  await ensureScansDir()
  const id = crypto.randomUUID()
  const docDir = `${SCANS_DIR}/${id}`
  await Filesystem.mkdir({ path: docDir, directory: Directory.Data, recursive: true })

  const pagePaths: string[] = []
  for (let i = 0; i < imageUris.length; i++) {
    const base64 = await fetchAsBase64(imageUris[i])
    const pagePath = `${docDir}/page-${i + 1}.jpg`
    await Filesystem.writeFile({ path: pagePath, directory: Directory.Data, data: base64 })
    pagePaths.push(pagePath)
  }

  const doc: LocalScanDocument = {
    id,
    title: title ?? `Scan ${new Date().toLocaleString('id-ID')}`,
    createdAt: new Date().toISOString(),
    pageCount: pagePaths.length,
    pagePaths,
  }

  const docs = await readIndex()
  docs.unshift(doc)
  await writeIndex(docs)

  return doc
}

export async function listScanDocuments(): Promise<LocalScanDocument[]> {
  return readIndex()
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

/** Resolves a stored page path to a URI the webview can render in <img src>. */
export async function getScanPageDisplayUri(pagePath: string): Promise<string> {
  const result = await Filesystem.getUri({ path: pagePath, directory: Directory.Data })
  return Capacitor.convertFileSrc(result.uri)
}
