import { base64ToBlob } from './blobBase64'
import { cropImage, rotateImage, type CropRect, type Rotation } from './imageEditor'
import {
  invalidateDisplayUri,
  readPageBase64,
  resetPageEdit,
  resolvePage,
  savePageEdit,
  type LocalScanDocument,
  type ScanPage,
} from './scanStorage'

/** Loads whatever the page currently shows — the edit if present, else the original. */
export async function loadPageBlob(page: ScanPage): Promise<Blob> {
  return base64ToBlob(await readPageBase64(resolvePage(page)))
}

async function editPage(
  doc: LocalScanDocument,
  pageIndex: number,
  transform: (blob: Blob) => Promise<Blob>,
): Promise<LocalScanDocument> {
  const page = doc.pages[pageIndex]
  if (!page) throw new Error('Halaman tidak ditemukan.')

  const source = await loadPageBlob(page)
  const result = await transform(source)
  const updated = await savePageEdit(doc.id, pageIndex, result)

  // The edit reuses the same file path, so any cached object URL is stale.
  invalidateDisplayUri(resolvePage(updated.pages[pageIndex]))
  return updated
}

/**
 * Rotations compound: rotating twice by 90 leaves the page at 180, because
 * each edit is applied to the currently displayed image rather than the
 * untouched original.
 */
export async function rotatePage(
  doc: LocalScanDocument,
  pageIndex: number,
  degrees: Rotation = 90,
): Promise<LocalScanDocument> {
  return editPage(doc, pageIndex, (blob) => rotateImage(blob, degrees))
}

export async function cropPage(
  doc: LocalScanDocument,
  pageIndex: number,
  rect: CropRect,
): Promise<LocalScanDocument> {
  return editPage(doc, pageIndex, (blob) => cropImage(blob, rect))
}

/** Throws away every edit on a page and goes back to the untouched scan. */
export async function revertPage(
  doc: LocalScanDocument,
  pageIndex: number,
): Promise<LocalScanDocument> {
  const page = doc.pages[pageIndex]
  if (page?.edited) invalidateDisplayUri(page.edited)
  return resetPageEdit(doc.id, pageIndex)
}
