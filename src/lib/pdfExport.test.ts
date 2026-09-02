import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from 'pdf-lib'
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
   * PDFDocument.create() defaults to updateMetadata: true, which stamps
   * Producer with pdf-lib's own signature the moment the document is
   * constructed. buildPdf's own setProducer('ScannApp') call runs right
   * after and unconditionally overwrites that -- confirmed directly against
   * pdf-lib rather than assumed, since a first attempt at this fix reached
   * for { updateMetadata: false } on create() as well, on the mistaken
   * belief that was also required; it changed nothing observable and was
   * removed (code review, round 1).
   *
   * PDFDocument.load() has this same updateMetadata: true default,
   * independently -- loading the saved bytes with no options re-stamps
   * Producer right back to pdf-lib's signature on the way in, which would
   * make this test "pass" for the wrong reason (asserting what load() just
   * overwrote, not what buildPdf wrote). { updateMetadata: false } here is
   * what makes this actually read the saved bytes.
   */
  it('stamps ScannApp as the producer, not pdf-lib\'s own signature', async () => {
    const pdf = await buildPdf([jpegPage()], { watermark: false })
    const loaded = await PDFDocument.load(pdf, { updateMetadata: false })

    expect(loaded.getProducer()).toBe('ScannApp')
  })

  /**
   * Same root cause as Producer above, but for ModDate: without buildPdf's
   * own setModificationDate call, the document keeps the ModDate
   * create() stamped it with at construction time -- the wall-clock moment
   * .create() happened to run, not when the pages were scanned. A cloud
   * backup exported today of a document scanned in March would then read as
   * "modified today" in any tool that surfaces ModDate, and two builds of
   * the same pages would only be byte-identical when they landed in the
   * same second -- this is what made the "generator vs array" test below
   * flaky in CI while passing every time locally, round 1.
   */
  it('dates both Creation and Modification from scannedAt, not from create() time', async () => {
    const scannedAt = '2026-03-04T00:00:00.000Z'
    const pdf = await buildPdf([jpegPage()], { watermark: false, scannedAt })
    const loaded = await PDFDocument.load(pdf, { updateMetadata: false })

    expect(loaded.getCreationDate()?.toISOString()).toBe(scannedAt)
    expect(loaded.getModificationDate()?.toISOString()).toBe(scannedAt)
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

/** The page's content stream, decompressed — where the drawing operators live. */
async function contentStream(pdfBytes: Uint8Array, index = 0): Promise<string> {
  const loaded = await PDFDocument.load(pdfBytes)
  const contents = loaded.getPage(index).node.Contents()
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => loaded.context.lookup(ref))
      : [contents]

  return streams
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1'))
    .join('\n')
}

/** WinAnsi bytes as pdf-lib writes them: `<48616C6F> Tj`. */
function hexOf(word: string): string {
  return Buffer.from(word, 'latin1').toString('hex').toUpperCase()
}

/** One word filling the given fraction of the page. */
function layout(text: string, box: { x: number; y: number; w: number; h: number }) {
  return { blocks: [{ text, lines: [{ text, words: [{ text, ...box }] }] }] }
}

/*
  The test JPEG is 1x1, so it is fitted to whichever A4 edge runs out first —
  the width, minus an 18pt margin on each side. The result is a square image
  centred on a taller page, which is why the two offsets differ.
*/
const DRAW_SIZE = 595.28 - 36
const IMAGE_LEFT = (595.28 - DRAW_SIZE) / 2
const IMAGE_BOTTOM = (841.89 - DRAW_SIZE) / 2

describe('buildPdf — invisible text layer', () => {
  it('draws nothing at all when no text was recognised', async () => {
    const pdf = await buildPdf([jpegPage()], { watermark: false })

    expect(await contentStream(pdf)).not.toContain('Tr')
  })

  /**
   * The upgrade must be invisible to documents that never ran OCR. Comparing
   * whole files catches an accidental font embed or resource entry that a
   * content-stream check would miss.
   */
  it('leaves the file byte-for-byte unchanged when a page has no text', async () => {
    const before = await buildPdf([jpegPage()], { watermark: false })
    const after = await buildPdf([jpegPage()], { watermark: false, text: [null] })

    expect(Buffer.from(after)).toEqual(Buffer.from(before))
  })

  it('writes each word in the invisible rendering mode', async () => {
    const pdf = await buildPdf([jpegPage()], {
      watermark: false,
      text: [layout('Kwitansi', { x: 0, y: 0, w: 0.5, h: 0.1 })],
    })

    const stream = await contentStream(pdf)
    expect(stream).toContain('3 Tr')
    expect(stream).toContain(`<${hexOf('Kwitansi')}> Tj`)
  })

  /**
   * The box is a fraction of the *scan*, and the scan is drawn inside a
   * margin on A4. A word placed against the page instead of against the image
   * would sit 18pt out horizontally and 141pt out vertically here.
   */
  it('places a word against the drawn image, not against the paper', async () => {
    const pdf = await buildPdf([jpegPage()], {
      watermark: false,
      text: [layout('Halo', { x: 0.25, y: 0.5, w: 0.5, h: 0.1 })],
    })

    const [, x, y] = /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/.exec(await contentStream(pdf))!

    expect(Number(x)).toBeCloseTo(IMAGE_LEFT + 0.25 * DRAW_SIZE, 1)
    // Fractions run downward from the top of the image; PDF y runs upward, so
    // the baseline sits at the *bottom* edge of the box.
    expect(Number(y)).toBeCloseTo(IMAGE_BOTTOM + (1 - 0.6) * DRAW_SIZE, 1)
  })

  /**
   * Without the horizontal scale, a word's invisible run is however wide
   * Helvetica happens to make it — so selecting one word highlights half a
   * sentence, or a sliver of one.
   */
  it('stretches each word to the width of its own box', async () => {
    const box = { x: 0.1, y: 0.2, w: 0.4, h: 0.05 }
    const pdf = await buildPdf([jpegPage()], { watermark: false, text: [layout('Halo', box)] })

    const stream = await contentStream(pdf)
    const size = Number(/ ([\d.]+) Tf/.exec(stream)![1])
    const squeeze = Number(/([\d.]+) Tz/.exec(stream)![1])

    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const drawn = font.widthOfTextAtSize('Halo', size) * (squeeze / 100)

    expect(drawn).toBeCloseTo(box.w * DRAW_SIZE, 1)
  })

  it('sizes a word from the height of its box', async () => {
    const pdf = await buildPdf([jpegPage()], {
      watermark: false,
      text: [layout('Halo', { x: 0, y: 0, w: 0.5, h: 0.04 })],
    })

    const size = Number(/ ([\d.]+) Tf/.exec(await contentStream(pdf))![1])

    expect(size).toBeCloseTo(0.04 * DRAW_SIZE, 1)
  })

  /**
   * drawText throws on a character WinAnsi cannot encode. One such glyph
   * anywhere in a twenty-page scan would otherwise take the whole export down
   * — and the layer it belongs to is invisible.
   */
  it('survives a word the font cannot encode', async () => {
    const pdf = await buildPdf([jpegPage()], {
      watermark: false,
      text: [layout('\u{1F600}\u540d', { x: 0, y: 0, w: 0.5, h: 0.1 })],
    })

    expect(pdf.byteLength).toBeGreaterThan(0)
    expect(await contentStream(pdf)).not.toContain('Tj')
  })

  it('gives each page its own text', async () => {
    const pdf = await buildPdf([jpegPage(), jpegPage()], {
      watermark: false,
      text: [layout('Pertama', { x: 0, y: 0, w: 0.5, h: 0.1 }), layout('Kedua', { x: 0, y: 0, w: 0.5, h: 0.1 })],
    })

    expect(await contentStream(pdf, 0)).toContain(`<${hexOf('Pertama')}> Tj`)
    expect(await contentStream(pdf, 1)).toContain(`<${hexOf('Kedua')}> Tj`)
  })
})

/**
 * Pages arrive as a generator from `exportPdf` since 31 Agustus 2026, so that a
 * twenty-page document does not sit in a list while pdf-lib holds its own copy
 * of the same bytes. These hold the change to being invisible in the file.
 */
describe('buildPdf — pages that arrive one at a time', () => {
  async function* stream(pages: Uint8Array[]): AsyncGenerator<Uint8Array> {
    for (const page of pages) yield page
  }

  it('builds the same document from a generator as from an array', async () => {
    const pages = [jpegPage(), jpegPage(), jpegPage()]
    const scannedAt = '2026-03-04T00:00:00.000Z'

    const fromArray = await buildPdf(pages, { watermark: true, title: 'Nota', scannedAt })
    const fromStream = await buildPdf(stream(pages), { watermark: true, title: 'Nota', scannedAt })

    expect(fromStream).toEqual(fromArray)
  })

  /**
   * The empty check moved to the end of the loop when the length stopped being
   * knowable up front. It still has to refuse rather than write a blank file.
   */
  it('still refuses a generator that yields nothing', async () => {
    await expect(buildPdf(stream([]), { watermark: false })).rejects.toThrow(
      'Tidak ada halaman untuk diekspor.',
    )
  })

  /** The text layer is matched to pages by position, which a counter must keep. */
  it('keeps every page text on the page it belongs to', async () => {
    const word = (text: string) => ({
      blocks: [{ lines: [{ words: [{ text, x: 0.1, y: 0.1, w: 0.3, h: 0.05 }] }] }],
    })
    const pages = [jpegPage(), jpegPage()]

    const fromArray = await buildPdf(pages, {
      watermark: false,
      text: [word('satu'), word('dua')],
    })
    const fromStream = await buildPdf(stream(pages), {
      watermark: false,
      text: [word('satu'), word('dua')],
    })

    expect(fromStream).toEqual(fromArray)
  })
})
