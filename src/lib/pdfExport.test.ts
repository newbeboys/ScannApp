import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildPdf } from './pdfExport'

/**
 * Smallest valid baseline JPEG (1x1 px). Enough for pdf-lib's embedJpg,
 * which is all these tests need — page geometry is judged visually in the
 * browser, correctness of tier behaviour is judged here.
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

function jpegPage(): Uint8Array {
  return new Uint8Array(Buffer.from(ONE_PIXEL_JPEG_BASE64, 'base64'))
}

/**
 * The watermark is the only element that needs a font, so a *populated*
 * Font dictionary is a precise signal that it was drawn. pdf-lib always
 * creates the Font key itself, hence the emptiness check rather than a
 * presence check. Scanning the raw bytes would not work either — pdf-lib
 * packs objects into compressed object streams.
 */
function pageFontCount(page: { node: { Resources(): PDFDict | undefined } }): number {
  const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict)
  return fonts ? fonts.keys().length : 0
}

async function firstPageFontCount(pdfBytes: Uint8Array): Promise<number> {
  const loaded = await PDFDocument.load(pdfBytes)
  return pageFontCount(loaded.getPage(0))
}

describe('buildPdf', () => {
  it('creates one PDF page per scanned page', async () => {
    const pdf = await buildPdf([jpegPage(), jpegPage(), jpegPage()], { watermark: false })
    const loaded = await PDFDocument.load(pdf)

    expect(loaded.getPageCount()).toBe(3)
  })

  it('rejects an empty document instead of writing a blank PDF', async () => {
    await expect(buildPdf([], { watermark: false })).rejects.toThrow(
      'Tidak ada halaman untuk diekspor.',
    )
  })

  it('sets the document title so the shared file is identifiable', async () => {
    const pdf = await buildPdf([jpegPage()], { watermark: false, title: 'Invoice Juli' })
    const loaded = await PDFDocument.load(pdf)

    expect(loaded.getTitle()).toBe('Invoice Juli')
  })

  /**
   * The tier rule that actually matters commercially: Basic exports are
   * marked, Pro exports are not. The watermark is the only thing in the
   * document that embeds a font, so its font dictionary is a reliable tell.
   */
  it('embeds the watermark for Basic exports', async () => {
    const pdf = await buildPdf([jpegPage()], { watermark: true })
    expect(await firstPageFontCount(pdf)).toBeGreaterThan(0)
  })

  it('leaves Pro exports completely unmarked', async () => {
    const pdf = await buildPdf([jpegPage()], { watermark: false })
    expect(await firstPageFontCount(pdf)).toBe(0)
  })

  it('marks every page, not just the first', async () => {
    const pdf = await buildPdf([jpegPage(), jpegPage(), jpegPage()], { watermark: true })
    const loaded = await PDFDocument.load(pdf)

    for (const page of loaded.getPages()) {
      expect(pageFontCount(page)).toBeGreaterThan(0)
    }
  })

  it('produces a larger file when watermarked, page for page', async () => {
    const withMark = await buildPdf([jpegPage()], { watermark: true })
    const withoutMark = await buildPdf([jpegPage()], { watermark: false })

    expect(withMark.byteLength).toBeGreaterThan(withoutMark.byteLength)
  })
})
