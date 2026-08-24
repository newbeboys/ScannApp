import {
  remapMarksForCrop,
  remapMarksForRotation,
  type Mark,
  type SignatureStamp,
} from './annotations'
import {
  cropImage,
  filterImage,
  renderMarks,
  rotateImage,
  type CropRect,
  type Rotation,
} from './imageEditor'
import {
  annotationSource,
  applyDocumentFilter,
  applyPageDerived,
  applyPageFilter,
  filterSource,
  invalidateDisplayUri,
  readPageBlob,
  reorderPages,
  resetPageEdit,
  resolvePage,
  savePageEdit,
  savePageMarks,
  type DocumentFilter,
  type LocalScanDocument,
  type PageFilter,
  type ScanPage,
} from './scanStorage'
import type { Tier } from './tier'

/** Loads whatever the page currently shows — the ink, else the filter, else the edit, else the scan. */
export async function loadPageBlob(page: ScanPage): Promise<Blob> {
  return readPageBlob(resolvePage(page))
}

/**
 * Loads the page *without* its ink, for the annotate screen.
 *
 * The overlay draws every mark live, so showing the annotated render behind it
 * would put each stroke on screen twice — and undoing one would appear to do
 * nothing, because the copy underneath would still be there.
 */
export async function loadAnnotationBase(page: ScanPage): Promise<Blob> {
  return readPageBlob(annotationSource(page))
}

/**
 * Draws marks onto a page, reading each signature file the marks refer to.
 *
 * The renderer itself only knows about bitmaps — it has no way to read a file —
 * so the decoding happens here, once per distinct signature rather than once
 * per stamp. A signature that has gone missing is skipped: it can only mean a
 * file was deleted underneath us, and losing one stamp is better than refusing
 * to render the page at all.
 */
async function drawMarks(source: Blob, marks: Mark[]): Promise<Blob> {
  const paths = new Set(
    marks.filter((mark): mark is SignatureStamp => mark.kind === 'signature').map((m) => m.source),
  )

  const signatures = new Map<string, ImageBitmap>()
  for (const path of paths) {
    try {
      signatures.set(path, await createImageBitmap(await readPageBlob(path)))
    } catch {
      // Gone from disk; the stamp is skipped rather than failing the render.
    }
  }

  try {
    return await renderMarks(source, marks, signatures)
  } finally {
    for (const bitmap of signatures.values()) bitmap.close()
  }
}

/**
 * Rebuilds both derived files after a page's geometry changed underneath them.
 *
 * `savePageEdit`/`resetPageEdit` delete the filter render and the ink render as
 * a side effect — right, since both were made from geometry that no longer
 * exists — but neither can regenerate them; they are storage, with no canvas
 * to render with. This is the one place that closes the gap, shared by
 * `editPage` (after a crop or rotate) and `revertPage` (after undoing one).
 *
 * One call rather than "filter, then ink": the filter pass renders the ink too,
 * so doing it in two steps draws every stroke twice — once at the coordinates
 * the crop just invalidated.
 */
async function rebuildDerived(
  docId: string,
  pageIndex: number,
  marks: Mark[],
): Promise<LocalScanDocument> {
  return applyPageDerived(docId, pageIndex, marks, filterImage, drawMarks)
}

/**
 * @param remap moves the page's marks onto the geometry the transform produced.
 *   Ink is stored in coordinates relative to the page's content, so a crop
 *   slides it across the paper unless it is remapped with the pixels.
 */
async function editPage(
  doc: LocalScanDocument,
  pageIndex: number,
  transform: (blob: Blob) => Promise<Blob>,
  remap: (marks: Mark[]) => Mark[],
): Promise<LocalScanDocument> {
  const page = doc.pages[pageIndex]
  if (!page) throw new Error('Halaman tidak ditemukan.')

  // Read from the geometry chain rather than from what is on screen. Cropping
  // the filtered render would bake the filter into `edited`, and the filter
  // could never be changed again without losing the crop with it. Cropping the
  // annotated render would bake the ink in too, and undo would stop working.
  const source = await readPageBlob(filterSource(page))
  const result = await transform(source)
  const saved = await savePageEdit(doc.id, pageIndex, result)

  // The edit reuses the same file path, so any cached object URL is stale.
  invalidateDisplayUri(resolvePage(saved.pages[pageIndex]))

  // The remap runs even when it empties the list: that means every stroke was
  // on the part of the page that was just cut away, and the ink render has to
  // go with them.
  return rebuildDerived(doc.id, pageIndex, remap(saved.pages[pageIndex].marks ?? []))
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
  return editPage(
    doc,
    pageIndex,
    (blob) => rotateImage(blob, degrees),
    (marks) => remapMarksForRotation(marks, degrees),
  )
}

export async function cropPage(
  doc: LocalScanDocument,
  pageIndex: number,
  rect: CropRect,
): Promise<LocalScanDocument> {
  return editPage(
    doc,
    pageIndex,
    (blob) => cropImage(blob, rect),
    (marks) => remapMarksForCrop(marks, rect),
  )
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

  // The marks keep their coordinates: they cannot be mapped back through a
  // crop that no longer exists, and undoing a crop is not a request to tear up
  // a signature.
  return rebuildDerived(doc.id, pageIndex, reverted.pages[pageIndex].marks ?? [])
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
  return applyDocumentFilter(doc.id, filter, filterImage, drawMarks, onProgress)
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
  return applyPageFilter(doc.id, pageIndex, choice, filterImage, drawMarks)
}

/**
 * Replaces what is drawn on one page (Pro).
 *
 * The tier is checked here, in the library, not only where the button is
 * drawn. Hiding a control is not a gate — the same lesson as
 * `resolveCompressionLevel` (see the Fase 6 export notes): every path into the
 * feature has to pass the same check, or the next screen that calls this
 * function quietly reopens it.
 */
export async function setPageMarks(
  doc: LocalScanDocument,
  pageIndex: number,
  marks: Mark[],
  tier: Tier,
): Promise<LocalScanDocument> {
  if (tier !== 'pro') {
    throw new Error('Anotasi & tanda tangan tersedia untuk akun Pro.')
  }

  return savePageMarks(doc.id, pageIndex, marks, drawMarks)
}

/** Moves a page one step towards the front or the back of the document. */
export async function movePage(
  doc: LocalScanDocument,
  pageIndex: number,
  direction: -1 | 1,
): Promise<LocalScanDocument> {
  return reorderPages(doc.id, pageIndex, pageIndex + direction)
}
