import { loadPageBlob } from './documentEditing'
import { COMPRESSION_PRESETS, resolveCompressionLevel, type CompressionLevel } from './exportLimits'
import { compressImagePair } from './imageEditor'
import type { LocalScanDocument } from './scanIndexMigration'

/** Roughly what pdf-lib adds per page around an embedded JPEG. */
const PDF_STRUCTURE_BYTES_PER_PAGE = 2_000

export interface ExportSizeEstimate {
  pdf: number
  jpg: number
  png: number
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
    // pdf-lib embeds the JPEG bytes as-is (DCTDecode), so a PDF is its pages
    // plus page objects — not a re-compression of them.
    pdf: jpeg.size * pages + PDF_STRUCTURE_BYTES_PER_PAGE * pages,
    jpg: jpeg.size * pages,
    png: png.size * pages,
  }
}
