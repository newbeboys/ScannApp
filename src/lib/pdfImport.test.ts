import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildPdf } from './pdfExport'
import { readBackup } from './pdfImport'

/**
 * Smallest valid baseline JPEG (1x1 px) — same fixture as pdfExport.test.ts.
 */
const ONE_PIXEL_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA' +
  'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
  'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
  'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
  'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA' +
  'AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx' +
  'BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK' +
  'U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3' +
  'uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii' +
  'gD//2Q=='

/**
 * Same pixels, different bytes.
 *
 * Every page in these tests has to be individually recognisable, otherwise a
 * function that returns the pages in the wrong order — or returns page 1 three
 * times — would still pass. A JPEG comment segment (`FF FE`, two length bytes,
 * then the text) is the cheapest way to make each copy unique: decoders skip
 * it, so pdf-lib still reads the image, but the bytes differ.
 */
function jpegPage(tag: string): Uint8Array {
  const base = new Uint8Array(Buffer.from(ONE_PIXEL_JPEG_BASE64, 'base64'))
  const text = new TextEncoder().encode(tag)
  const segmentLength = text.length + 2

  const out = new Uint8Array(base.length + text.length + 4)
  out.set(base.subarray(0, 2), 0) // SOI
  out.set([0xff, 0xfe, segmentLength >> 8, segmentLength & 0xff], 2)
  out.set(text, 6)
  out.set(base.subarray(2), 6 + text.length)
  return out
}

describe('readBackup', () => {
  it('returns one image per page of the backup', async () => {
    const pdf = await buildPdf([jpegPage('a'), jpegPage('b'), jpegPage('c')], {
      watermark: false,
    })

    expect((await readBackup(pdf)).pages).toHaveLength(3)
  })

  it('returns the page bytes untouched, so a restored scan is the scan', async () => {
    const original = jpegPage('halaman-tunggal')
    const pdf = await buildPdf([original], { watermark: false })

    const [restored] = (await readBackup(pdf)).pages

    expect(restored).toEqual(original)
  })

  it('keeps the pages in reading order', async () => {
    const pages = [jpegPage('satu'), jpegPage('dua'), jpegPage('tiga')]
    const pdf = await buildPdf(pages, { watermark: false })

    expect((await readBackup(pdf)).pages).toEqual(pages)
  })

  /**
   * The commercially load-bearing case. A Basic user's backup carries the
   * ScannApp watermark, but it is drawn as PDF text *over* the image rather
   * than burned into the pixels — so restoring must hand back a clean scan.
   * If this ever regresses, restored documents would accumulate a second
   * watermark on every backup-restore round trip.
   */
  it('recovers pages free of the watermark drawn over them', async () => {
    const original = jpegPage('dicadangkan-tier-basic')
    const marked = await buildPdf([original], { watermark: true })

    const [restored] = (await readBackup(marked)).pages

    expect(restored).toEqual(original)
  })

  it('refuses a PDF whose pages hold no scanned image', async () => {
    const empty = await PDFDocument.create()
    empty.addPage([595.28, 841.89])

    await expect(readBackup(await empty.save())).rejects.toThrow(
      'Cadangan ini tidak berisi halaman hasil pindai.',
    )
  })

  it('refuses a PDF with no pages at all', async () => {
    const empty = await PDFDocument.create()

    await expect(readBackup(await empty.save())).rejects.toThrow(
      'Cadangan ini tidak berisi halaman hasil pindai.',
    )
  })

  /**
   * Skipping the odd unreadable page would hand back a document that is
   * quietly missing one, and nothing downstream could tell: the page count
   * would simply be smaller. Since the backup stays in the cloud either way,
   * failing loudly costs the user nothing and losing a page costs them a page.
   */
  it('refuses a backup with an unreadable page rather than dropping it', async () => {
    const pdf = await PDFDocument.create()
    const readable = await pdf.embedJpg(jpegPage('utuh'))
    pdf.addPage().drawImage(readable)
    pdf.addPage() // no image on this one
    pdf.addPage().drawImage(readable)

    await expect(readBackup(await pdf.save())).rejects.toThrow(
      'Halaman 2 pada cadangan ini tidak bisa dibaca.',
    )
  })

  it('refuses bytes that are not a PDF, rather than surfacing a parser error', async () => {
    await expect(readBackup(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(
      'Berkas cadangan rusak atau tidak lengkap.',
    )
  })

  /**
   * The date is carried by the file because nothing else carries it:
   * `scan_documents.created_at` is when the row was first written, i.e. when
   * the document was backed up. Without this, a scan from March restored in
   * August comes back dated August and jumps to the top of the list.
   */
  it('reads back the day the pages were scanned, not the day they were backed up', async () => {
    const scannedAt = '2026-03-04T09:15:00.000Z'
    const pdf = await buildPdf([jpegPage('lama')], { watermark: false, scannedAt })

    expect((await readBackup(pdf)).scannedAt).toBe(scannedAt)
  })

  /**
   * Backups made before we started stamping the date still carry pdf-lib's
   * own creation date, which is when they were built — the same answer the
   * database would give. Nothing to refuse, and nothing lost.
   */
  it('still reports a date for a backup built without one', async () => {
    const pdf = await buildPdf([jpegPage('lawas')], { watermark: false })

    expect((await readBackup(pdf)).scannedAt).not.toBeNull()
  })

  it('ignores an unusable scan date rather than writing a broken one', async () => {
    const pdf = await buildPdf([jpegPage('tanggal-ngawur')], {
      watermark: false,
      scannedAt: 'bukan tanggal',
    })

    // Falls back to pdf-lib's own creation date; the point is that the file
    // stays readable rather than carrying "D:NaN…".
    expect((await readBackup(pdf)).scannedAt).not.toBeNull()
  })
})
