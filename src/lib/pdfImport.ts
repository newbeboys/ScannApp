import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'

export interface BackupContents {
  /** The original JPEGs, in reading order. */
  pages: Uint8Array[]
  /**
   * When the pages were scanned, if the backup records it — see
   * `BuildPdfOptions.scannedAt`. Null for a PDF that carries no creation date
   * at all; backups made before we started stamping it carry the date they
   * were built, which is the same thing the database would have said anyway.
   */
  scannedAt: string | null
}

/**
 * Pulls the scanned pages back out of a backup PDF.
 *
 * This works — cheaply, and without a rasteriser — only because we wrote the
 * PDF ourselves: `buildPdf` puts exactly one JPEG on each page and never
 * re-encodes it, so the image object still holds the original file, DCTDecode
 * being PDF's name for "the bytes are a JPEG". Reading it back is a lookup,
 * not a render, and what comes out is the same file that went in.
 *
 * That also means the Basic watermark does not survive the round trip, which
 * is the behaviour we want: it is drawn as page text over the image, never
 * burned into the pixels, so a restored scan is clean rather than doubly
 * marked the next time it is backed up.
 *
 * Deliberately free of DOM APIs so it can be unit-tested under Node.
 */
export async function readBackup(pdfBytes: Uint8Array): Promise<BackupContents> {
  let pdf: PDFDocument
  try {
    pdf = await PDFDocument.load(pdfBytes)
  } catch {
    // A truncated download and a file that was never a PDF land here alike;
    // pdf-lib's own message names neither in terms a user could act on.
    throw new Error('Berkas cadangan rusak atau tidak lengkap.')
  }

  const pages: Uint8Array[] = []
  let firstUnreadable = 0
  for (const [index, page] of pdf.getPages().entries()) {
    const jpeg = firstJpegOf(pdf, page.node.Resources())
    if (jpeg) pages.push(jpeg)
    else if (!firstUnreadable) firstUnreadable = index + 1
  }

  // Nothing readable at all means this is not one of our backups; a gap in an
  // otherwise readable document means one page is damaged. Both refuse, but
  // they are worth telling apart — only the second names a page to look at.
  if (pages.length === 0) {
    throw new Error('Cadangan ini tidak berisi halaman hasil pindai.')
  }
  if (firstUnreadable) {
    throw new Error(`Halaman ${firstUnreadable} pada cadangan ini tidak bisa dibaca.`)
  }

  return { pages, scannedAt: scanDateOf(pdf) }
}

/** The scan date `buildPdf` stamped on the file, if it is still readable. */
function scanDateOf(pdf: PDFDocument): string | null {
  let date: Date | undefined
  try {
    date = pdf.getCreationDate()
  } catch {
    // pdf-lib throws on a malformed date string. A backup whose pages read
    // perfectly well is not worth refusing over its metadata.
    return null
  }

  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}

/** The one image on a page built by `buildPdf`, or nothing if it holds none. */
function firstJpegOf(pdf: PDFDocument, resources: PDFDict | undefined): Uint8Array | null {
  const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
  if (!xobjects) return null

  for (const [, ref] of xobjects.entries()) {
    const stream = pdf.context.lookup(ref)
    if (!(stream instanceof PDFRawStream)) continue

    const isImage = stream.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image')
    const isJpeg = stream.dict.lookup(PDFName.of('Filter')) === PDFName.of('DCTDecode')
    if (isImage && isJpeg) return stream.contents
  }

  return null
}
