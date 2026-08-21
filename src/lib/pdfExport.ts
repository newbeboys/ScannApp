import { PDFDocument, StandardFonts } from 'pdf-lib'
import { drawWatermark } from './watermark'

/** A4 in PDF points. */
const A4 = { width: 595.28, height: 841.89 } as const
const PAGE_MARGIN = 18

export interface BuildPdfOptions {
  /** Basic exports carry the ScannApp mark; Pro exports are clean. */
  watermark: boolean
  title?: string
}

/**
 * Builds a PDF from already-compressed JPEG pages.
 *
 * Every page is fitted into A4 (rotated to landscape when the scan is
 * wider than tall) and centred with a small margin, so the result prints
 * and shares predictably regardless of the source aspect ratio.
 *
 * Deliberately free of DOM APIs so it can be unit-tested under Node.
 */
export async function buildPdf(
  jpegPages: Uint8Array[],
  options: BuildPdfOptions,
): Promise<Uint8Array> {
  if (jpegPages.length === 0) {
    throw new Error('Tidak ada halaman untuk diekspor.')
  }

  const pdf = await PDFDocument.create()
  pdf.setProducer('ScannApp')
  if (options.title) pdf.setTitle(options.title)

  const font = options.watermark ? await pdf.embedFont(StandardFonts.HelveticaBold) : null

  for (const bytes of jpegPages) {
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

    page.drawImage(image, {
      x: (pageWidth - drawWidth) / 2,
      y: (pageHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    })

    if (font) drawWatermark(page, font)
  }

  return pdf.save()
}
