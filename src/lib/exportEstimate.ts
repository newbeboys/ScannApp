import { loadPageBlob } from './documentEditing'
import { COMPRESSION_PRESETS, resolveCompressionLevel, type CompressionLevel } from './exportLimits'
import { compressImagePair } from './imageEditor'
import type { PageText } from './ocrLayout'
import type { LocalScanDocument } from './scanIndexMigration'
import { readPageText } from './scanStorage'

/** Roughly what pdf-lib adds per page around an embedded JPEG. */
const PDF_STRUCTURE_BYTES_PER_PAGE = 2_000

export interface ExportSizeEstimate {
  pdf: number
  jpg: number
  png: number
  /**
   * The exact size of the Word file, or null when there is no text to put in
   * one yet.
   *
   * Null rather than zero: the sheet has to tell "nothing recognised yet"
   * apart from "an empty file", and a zero reads as the second.
   */
  docx: number | null
}

/**
 * The Word file's size, measured by building it.
 *
 * The image formats have to encode one page and multiply because encoding
 * thirty 12 MP pages would cost seconds on every nudge of the slider. A
 * text-only DOCX has no images in it at all, so building the real thing takes
 * milliseconds — and then the number shown is not an estimate.
 */
async function measureDocx(doc: LocalScanDocument): Promise<number | null> {
  const text: (PageText | null)[] = []
  for (const page of doc.pages) {
    text.push(await readPageText(page))
  }
  if (!text.some((page) => page && page.blocks.length > 0)) return null

  const { buildDocx } = await import('./docxExport')
  return buildDocx(text, { title: doc.title, createdAt: doc.createdAt }).length
}

/**
 * What each format would weigh at this level, so "quality vs size" is a number
 * the user can see rather than a promise.
 *
 * Only the first page is encoded and then multiplied out. Encoding every page
 * would make each nudge of the slider cost seconds on a long document, and the
 * pages of one scan are alike enough that the extra work would not move the
 * figure much. Everything here is shown with a "≈".
 *
 * The level goes through the same resolver as the real export, so the figure
 * shown is the figure the file comes out at — including when a stored level
 * this build does not recognise falls back to Standar.
 *
 * The tier used to be a parameter here, back when it could turn the requested
 * level into a different one. It stopped being able to on 25 Agustus 2026.
 */
export async function estimateExportSizes(
  doc: LocalScanDocument,
  level: CompressionLevel,
): Promise<ExportSizeEstimate> {
  const options = COMPRESSION_PRESETS[resolveCompressionLevel(level)]
  const first = await loadPageBlob(doc.pages[0])

  // One decode feeding both encoders — see `compressImagePair`.
  const { jpeg, png } = await compressImagePair(first, options)

  const pages = Math.max(1, doc.pageCount)

  return {
    docx: await measureDocx(doc),
    // pdf-lib embeds the JPEG bytes as-is (DCTDecode), so a PDF is its pages
    // plus page objects — not a re-compression of them.
    pdf: jpeg.size * pages + PDF_STRUCTURE_BYTES_PER_PAGE * pages,
    jpg: jpeg.size * pages,
    png: png.size * pages,
  }
}
