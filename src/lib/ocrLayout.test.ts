import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it, test } from 'vitest'
import {
  normalizePageText,
  sanitizeForWinAnsi,
  sanitizePageText,
  type RecognizedBox,
  type RecognizedText,
} from './ocrLayout'

/** One block, one line, and whatever words the caller wants to try. */
function page(words: { text: string; boundingBox?: RecognizedBox }[], lineText?: string): RecognizedText {
  const text = lineText ?? words.map((word) => word.text).join(' ')
  return { blocks: [{ text, lines: [{ text, elements: words }] }] }
}

const A4ish = { width: 1000, height: 500 }

describe('normalizePageText', () => {
  test('turns a pixel box into a fraction of the image', () => {
    const result = normalizePageText(
      page([{ text: 'Halo', boundingBox: { left: 100, top: 50, right: 300, bottom: 150 } }]),
      A4ish,
    )

    expect(result.blocks[0].lines[0].words[0]).toEqual({
      text: 'Halo',
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.2,
    })
  })

  test('drops a word with no box but keeps the line it came from', () => {
    const result = normalizePageText(
      page([
        { text: 'tanpa' },
        { text: 'kotak', boundingBox: { left: 0, top: 0, right: 100, bottom: 50 } },
      ]),
      A4ish,
    )

    expect(result.blocks[0].lines[0].words.map((word) => word.text)).toEqual(['kotak'])
    expect(result.blocks[0].lines[0].text).toBe('tanpa kotak')
  })

  test('clamps a box that runs past the edge of the image', () => {
    const result = normalizePageText(
      page([{ text: 'lebar', boundingBox: { left: -50, top: -10, right: 1200, bottom: 600 } }]),
      A4ish,
    )

    expect(result.blocks[0].lines[0].words[0]).toEqual({ text: 'lebar', x: 0, y: 0, w: 1, h: 1 })
  })

  test('drops a word whose box has no area', () => {
    const result = normalizePageText(
      page([{ text: 'pipih', boundingBox: { left: 200, top: 100, right: 200, bottom: 150 } }]),
      A4ish,
    )

    expect(result.blocks[0].lines[0].words).toEqual([])
  })

  test('drops a line whose text is blank', () => {
    const result = normalizePageText(
      page([{ text: '  ', boundingBox: { left: 0, top: 0, right: 10, bottom: 10 } }], '  '),
      A4ish,
    )

    expect(result.blocks).toEqual([])
  })

  test('drops a block once every line in it is gone', () => {
    const raw: RecognizedText = {
      blocks: [
        { text: '', lines: [{ text: '', elements: [] }] },
        { text: 'ada isinya', lines: [{ text: 'ada isinya', elements: [] }] },
      ],
    }

    const result = normalizePageText(raw, A4ish)

    expect(result.blocks.map((block) => block.text)).toEqual(['ada isinya'])
  })

  test('yields nothing rather than infinities when the image size is unusable', () => {
    const result = normalizePageText(
      page([{ text: 'Halo', boundingBox: { left: 0, top: 0, right: 10, bottom: 10 } }]),
      { width: 0, height: 500 },
    )

    expect(result.blocks).toEqual([])
  })
})

describe('sanitizeForWinAnsi', () => {
  /** The real encoder the PDF text layer will hand its words to. */
  async function helvetica() {
    const pdf = await PDFDocument.create()
    return pdf.embedFont(StandardFonts.Helvetica)
  }

  test('leaves ordinary Indonesian text alone', () => {
    expect(sanitizeForWinAnsi('Rp 1.250.000 - dibayar penuh, kaf\u00e9')).toBe(
      'Rp 1.250.000 - dibayar penuh, kaf\u00e9',
    )
  })

  test('keeps the typographic punctuation WinAnsi does have', () => {
    expect(sanitizeForWinAnsi('\u201cKwitansi\u201d \u2013 \u2014 no\u2026 \u20ac5')).toBe(
      '\u201cKwitansi\u201d \u2013 \u2014 no\u2026 \u20ac5',
    )
  })

  test('drops characters the font has no glyph for, leaving the rest untouched', () => {
    // The spaces around the dropped characters stay: only the glyphs go, and
    // words are drawn one at a time anyway, so runs of spaces cost nothing.
    expect(sanitizeForWinAnsi('Total \u540d\u524d \u{1F600} rupiah')).toBe('Total   rupiah')
  })

  test('drops control characters', () => {
    expect(sanitizeForWinAnsi('baris\u0000satu\u0007\u0081')).toBe('barissatu')
  })

  test('accepts every code point the font accepts, and no others', async () => {
    const font = await helvetica()

    let survivors = ''
    for (let point = 0; point <= 0x2fff; point++) {
      // Lone surrogates are not characters; String.fromCodePoint would build
      // an unpaired half that means nothing to either side of this check.
      if (point >= 0xd800 && point <= 0xdfff) continue
      survivors += sanitizeForWinAnsi(String.fromCodePoint(point))
    }
    survivors += sanitizeForWinAnsi('\u{1F600}\u{1D400}')

    expect(() => font.encodeText(survivors)).not.toThrow()
    expect(() => font.widthOfTextAtSize(survivors, 12)).not.toThrow()
    // Guards the other direction: a sanitizer that returned '' would pass the
    // two assertions above while destroying every document it touched.
    expect(survivors).toContain('abcdefghijklmnopqrstuvwxyz')
    expect(survivors.length).toBeGreaterThan(200)
  })

  test('proves the guard is needed: the raw string does make the font throw', async () => {
    const font = await helvetica()

    expect(() => font.encodeText('Halo \u{1F600}')).toThrow()
  })
})

describe('sanitizePageText', () => {
  const word = { text: 'Halo', x: 0.1, y: 0.2, w: 0.3, h: 0.05 }
  const stored = { blocks: [{ text: 'Halo', lines: [{ text: 'Halo', words: [word] }] }] }

  it('accepts what it wrote itself', () => {
    expect(sanitizePageText(stored)).toEqual(stored)
  })

  it.each([null, undefined, 'nope', 42, { blocks: 'nope' }])('rejects %s outright', (raw) => {
    expect(sanitizePageText(raw)).toEqual({ blocks: [] })
  })

  /**
   * A NaN reaches pdf-lib as a coordinate and lands in the file as the literal
   * `NaN`, which is not a number any reader can parse — one corrupt word would
   * make the whole PDF unopenable.
   */
  it('drops a word whose box is not finite', () => {
    const broken = {
      blocks: [
        {
          text: 'Halo',
          lines: [{ text: 'Halo', words: [{ ...word, x: NaN }, { ...word, h: Infinity }, word] }],
        },
      ],
    }

    expect(sanitizePageText(broken).blocks[0].lines[0].words).toEqual([word])
  })

  it('drops a word whose text is not a string', () => {
    const broken = {
      blocks: [{ text: 'Halo', lines: [{ text: 'Halo', words: [{ ...word, text: 7 }] }] }],
    }

    expect(sanitizePageText(broken).blocks[0].lines[0].words).toEqual([])
  })

  it('drops a line or block whose text is missing', () => {
    const broken = {
      blocks: [
        { lines: [{ text: 'Halo', words: [] }] },
        { text: 'Ada', lines: [{ words: [] }, { text: 'Ada', words: [] }] },
      ],
    }

    const result = sanitizePageText(broken)

    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0].lines.map((line) => line.text)).toEqual(['Ada'])
  })

  it('keeps only the fields a page layout is allowed to carry', () => {
    const extra = {
      blocks: [
        {
          text: 'Halo',
          confidence: 0.9,
          lines: [{ text: 'Halo', angle: 3, words: [{ ...word, language: 'id' }] }],
        },
      ],
    }

    expect(sanitizePageText(extra)).toEqual(stored)
  })
})
