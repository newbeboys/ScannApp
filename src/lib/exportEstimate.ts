import { loadPageBlob } from './documentEditing'
import { COMPRESSION_PRESETS, resolveCompressionLevel, type CompressionLevel } from './exportLimits'
import { compressImagePair } from './imageEditor'
import type { LocalScanDocument } from './scanIndexMigration'
import type { Tier } from './tier'

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
 * The tier is resolved the same way the real export resolves it, so a Basic
 * account is never shown a size it cannot actually get.
 */
export async function estimateExportSizes(
  doc: LocalScanDocument,
  tier: Tier,
  level: CompressionLevel,
): Promise<ExportSizeEstimate> {
  const options = COMPRESSION_PRESETS[resolveCompressionLevel(tier, level)]
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
