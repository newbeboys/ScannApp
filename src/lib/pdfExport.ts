import {
  PDFDocument,
  StandardFonts,
  TextRenderingMode,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setTextRenderingMode,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import { sanitizeForWinAnsi, type PageText } from './ocrLayout'
import { drawWatermark } from './watermark'

/** A4 in PDF points. */
const A4 = { width: 595.28, height: 841.89 } as const
const PAGE_MARGIN = 18

export interface BuildPdfOptions {
  /** Basic exports carry the ScannApp mark; Pro exports are clean. */
  watermark: boolean
  title?: string
  /**
   * When the pages were scanned, as an ISO string.
   *
   * Stored as the PDF's creation date, which is the only place that date
   * survives a backup: `scan_documents.created_at` is when the row was first
   * written — that is, when the document was *backed up* — so a scan from
   * March restored in August would otherwise come back dated August.
   */
  scannedAt?: string
  /**
   * Recognised text per page, index-aligned with `jpegPages`.
   *
   * Drawn invisibly on top of the scan, which is what makes the exported file
   * searchable without changing a single visible pixel. A page with no entry
   * — or none at all — produces exactly the file this function produced
   * before OCR existed.
   */
  text?: (PageText | null)[]
}

/** Where the scan ended up on the PDF page, in points. */
interface DrawnImage {
  left: number
  bottom: number
  width: number
  height: number
}

/**
 * Writes one page's recognised words as invisible text over the scan.
 *
 * Rendering mode 3 rather than a transparent fill: it is what every OCR tool
 * emits and what readers look for, and it costs no graphics state of its own.
 *
 * Each word is stretched to its own box with `Tz`. Without that the run is
 * however wide Helvetica happens to draw it, and a reader highlighting "one
 * word" would paint half a sentence or a sliver of one — the complaint people
 * file as "the OCR is broken".
 */
function drawTextLayer(page: PDFPage, text: PageText, font: PDFFont, image: DrawnImage): void {
  const words = text.blocks
    .flatMap((block) => block.lines.flatMap((line) => line.words))
    // A word the font cannot encode would make drawText throw and take the
    // whole export with it. The layer is invisible; the document is not.
    .map((word) => ({ ...word, text: sanitizeForWinAnsi(word.text) }))
    .filter((word) => word.text !== '')

  if (words.length === 0) return

  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible))

  for (const word of words) {
    const size = word.h * image.height
    const natural = font.widthOfTextAtSize(word.text, size)
    const squeeze = natural > 0 ? ((word.w * image.width) / natural) * 100 : 100

    page.pushOperators(setCharacterSqueeze(squeeze))
    page.drawText(word.text, {
      x: image.left + word.x * image.width,
      // Box fractions run down from the top of the scan while PDF y runs up,
      // so the far edge of the box is the near edge of the page. The baseline
      // sits on it: close enough that a reader's highlight lands on the word,
      // and free of any fudge factor that would need explaining.
      y: image.bottom + (1 - (word.y + word.h)) * image.height,
      size,
      font,
    })
  }

  page.pushOperators(popGraphicsState())
}

/**
 * Builds a PDF from already-compressed JPEG pages.
 *
 * Every page is fitted into A4 (rotated to landscape when the scan is
 * wider than tall) and centred with a small margin, so the result prints
 * and shares predictably regardless of the source aspect ratio.
 *
 * Takes anything iterable rather than an array, so the caller can *produce*
 * pages as this consumes them. An array still works and every existing caller
 * still passes one; `exportPdf` now hands in an async generator instead. A
 * twenty-page document is around 25 MB of JPEG, and holding all of it in a
 * list while pdf-lib holds its own copy of the same bytes meant two whole
 * documents sat in the WebView's heap before `save()` had allocated the third
 * (diukur 31 Agustus 2026 — see the note on `exportPdf`).
 *
 * Deliberately free of DOM APIs so it can be unit-tested under Node.
 */
export async function buildPdf(
  jpegPages: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
  options: BuildPdfOptions,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setProducer('ScannApp')
  pdf.setCreator('ScannApp')
  if (options.title) pdf.setTitle(options.title)

  // Guarded rather than trusted: an unparseable date would otherwise be
  // written as "D:NaN…". CreationDate and ModDate are both pinned to this
  // same value -- not left for pdf-lib to stamp at whatever wall-clock
  // moment .save() happens to run, which is what it does for any field
  // this function does not set explicitly itself (PDFDocument.
  // prototype.updateInfoDict) -- both because a backup exported today of a
  // March scan should not read as modified today, and because that is what
  // makes the same pages always produce the same file (verified directly
  // against pdf-lib: two builds with an explicit setModificationDate
  // >1s apart come out byte-identical; without it they never do -- this is
  // what made "builds the same document from a generator as from an array"
  // below flaky in CI while passing every time locally, round 1).
  const parsedScannedAt = options.scannedAt ? new Date(options.scannedAt) : null
  const metadataDate =
    parsedScannedAt && !Number.isNaN(parsedScannedAt.getTime()) ? parsedScannedAt : new Date()
  pdf.setCreationDate(metadataDate)
  pdf.setModificationDate(metadataDate)

  const font = options.watermark ? await pdf.embedFont(StandardFonts.HelveticaBold) : null

  // Embedded only when there is something to draw with it, so a document that
  // never ran OCR keeps producing byte-identical files.
  const hasText = options.text?.some((page) => page && page.blocks.length > 0) ?? false
  const textFont = hasText ? await pdf.embedFont(StandardFonts.Helvetica) : null

  // Counted rather than read off a length: the source may be a generator that
  // does not know how many pages it has until it has finished producing them.
  let index = 0

  for await (const bytes of jpegPages) {
    const image = await pdf.embedJpg(bytes)
    const landscape = image.width > image.height
    const pageWidth = landscape ? A4.height : A4.width
    const pageHeight = landscape ? A4.width : A4.height

    const page = pdf.addPage([pageWidth, pageHeight])

    const maxWidth = pageWidth - PAGE_MARGIN * 2
    const maxHeight = pageHeight - PAGE_MARGIN * 2
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height)
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale

    const left = (pageWidth - drawWidth) / 2
    const bottom = (pageHeight - drawHeight) / 2

    page.drawImage(image, { x: left, y: bottom, width: drawWidth, height: drawHeight })

    // The text layer reuses the rectangle the scan was just fitted into, so
    // margins, A4 and the landscape flip are accounted for in one place only.
    const text = options.text?.[index] ?? null
    if (text && textFont) {
      drawTextLayer(page, text, textFont, { left, bottom, width: drawWidth, height: drawHeight })
    }

    if (font) drawWatermark(page, font)
    index++
  }

  // Checked at the end rather than up front, for the same reason the counter
  // exists: an empty generator only says so by finishing. A blank PDF is still
  // never produced — nothing has left this function yet.
  if (index === 0) throw new Error('Tidak ada halaman untuk diekspor.')

  return pdf.save()
}
