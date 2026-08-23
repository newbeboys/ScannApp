import { cropImage, filterImage, rotateImage, type CropRect, type Rotation } from './imageEditor'
import {
  applyDocumentFilter,
  applyPageFilter,
  effectiveFilter,
  filterSource,
  invalidateDisplayUri,
  readPageBlob,
  reorderPages,
  resetPageEdit,
  resolvePage,
  savePageEdit,
  type DocumentFilter,
  type LocalScanDocument,
  type PageFilter,
  type ScanPage,
} from './scanStorage'

/** Loads whatever the page currently shows — the filter, else the edit, else the original. */
export async function loadPageBlob(page: ScanPage): Promise<Blob> {
  return readPageBlob(resolvePage(page))
}

/**
 * Re-renders a page's filter after its geometry changed underneath it.
 *
 * `savePageEdit`/`resetPageEdit` both delete the now-outdated filter file as a
 * side effect — right, since it was rendered from geometry that no longer
 * exists — but neither can regenerate it themselves; they are storage,
 * with no canvas to render with. This is the one place that closes the gap,
 * shared by both `editPage` (after a crop/rotate) and `revertPage` (after
 * undoing one), so the rule lives once rather than being copied per caller.
 *
 * A no-op when nothing is actually filtered — most pages, most of the time.
 */
async function reapplyFilter(
  docId: string,
  pageIndex: number,
  doc: LocalScanDocument,
): Promise<LocalScanDocument> {
  const page = doc.pages[pageIndex]
  const filter = effectiveFilter(doc, page)
  if (!filter) return doc

  return applyPageFilter(docId, pageIndex, page.filter ?? null, filterImage)
}

async function editPage(
  doc: LocalScanDocument,
  pageIndex: number,
  transform: (blob: Blob) => Promise<Blob>,
): Promise<LocalScanDocument> {
  const page = doc.pages[pageIndex]
  if (!page) throw new Error('Halaman tidak ditemukan.')

  // Read from the geometry chain rather than from what is on screen. Cropping
  // the filtered render would bake the filter into `edited`, and the filter
  // could never be changed again without losing the crop with it.
  const source = await readPageBlob(filterSource(page))
  const result = await transform(source)
  const saved = await savePageEdit(doc.id, pageIndex, result)

  // The edit reuses the same file path, so any cached object URL is stale.
  invalidateDisplayUri(resolvePage(saved.pages[pageIndex]))

  return reapplyFilter(doc.id, pageIndex, saved)
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

/**
 * Throws away the crop/rotate on a page and goes back to the untouched scan.
 * The page's own filter choice, if any, is untouched — "Asli" undoes geometry,
 * not the user's mind about colour.
 */
export async function revertPage(
  doc: LocalScanDocument,
  pageIndex: number,
): Promise<LocalScanDocument> {
  const page = doc.pages[pageIndex]
  if (!page?.edited) return doc

  invalidateDisplayUri(page.edited)
  const reverted = await resetPageEdit(doc.id, pageIndex)

  return reapplyFilter(doc.id, pageIndex, reverted)
}

/**
 * Sets the filter for the whole document.
 *
 * Every page without its own exception is re-rendered, which for a long
 * document takes a few seconds — hence the progress callback.
 */
export async function setDocumentFilter(
  doc: LocalScanDocument,
  filter: DocumentFilter | null,
  onProgress?: (done: number, total: number) => void,
): Promise<LocalScanDocument> {
  return applyDocumentFilter(doc.id, filter, filterImage, onProgress)
}

/**
 * Sets one page's exception to the document filter — the colour chart in the
 * middle of a black-and-white contract.
 *
 * `null` puts the page back under the document's choice.
 */
export async function setPageFilter(
  doc: LocalScanDocument,
  pageIndex: number,
  choice: PageFilter | null,
): Promise<LocalScanDocument> {
  return applyPageFilter(doc.id, pageIndex, choice, filterImage)
}

/** Moves a page one step towards the front or the back of the document. */
export async function movePage(
  doc: LocalScanDocument,
  pageIndex: number,
  direction: -1 | 1,
): Promise<LocalScanDocument> {
  return reorderPages(doc.id, pageIndex, pageIndex + direction)
}
