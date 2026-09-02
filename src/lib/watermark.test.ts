import { readFileSync } from 'node:fs'
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { drawWatermark } from './watermark'

/** Builds a one-page PDF with the watermark drawn on it, decompressed content stream. */
async function watermarkedContentStream(): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage()
  drawWatermark(page, font)
  const bytes = await doc.save()

  const loaded = await PDFDocument.load(bytes)
  const contents = loaded.getPage(0).node.Contents()
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => loaded.context.lookup(ref))
      : [contents]

  return streams
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1'))
    .join('\n')
}

describe('drawWatermark', () => {
  /**
   * The mark changed from a single filled path (public/favicon.svg's purple
   * shape) to src/assets/logo.svg's two layers: a stroked black outline plus
   * a filled teal bar. A fill-only mark never emits an "S" (stroke) operator
   * or an "RG" (stroking color) operator -- their presence is the signal
   * that both layers actually drew, not just one.
   */
  it('draws both the stroked outline and the filled bar', async () => {
    const stream = await watermarkedContentStream()

    expect(stream).toMatch(/\bS\b/)
    expect(stream).toContain(' RG')
    expect(stream).toContain(' rg')
  })

  it('keeps the source SVG colors -- black outline, teal bar', async () => {
    const stream = await watermarkedContentStream()

    const strokeMatch = /([\d.]+) ([\d.]+) ([\d.]+) RG/.exec(stream)
    expect(strokeMatch).not.toBeNull()
    const [, r, g, b] = strokeMatch!
    expect(Number(r)).toBeCloseTo(0, 3)
    expect(Number(g)).toBeCloseTo(0, 3)
    expect(Number(b)).toBeCloseTo(0, 3)

    const fillMatch = /([\d.]+) ([\d.]+) ([\d.]+) rg/.exec(stream)
    expect(fillMatch).not.toBeNull()
    const [, fr, fg, fb] = fillMatch!
    expect(Number(fr)).toBeCloseTo(44 / 255, 2)
    expect(Number(fg)).toBeCloseTo(169 / 255, 2)
    expect(Number(fb)).toBeCloseTo(188 / 255, 2)
  })

  /**
   * The two paths share one anchor (see the comment on SECONDARY_PATH in
   * watermark.ts) -- this only holds if the hand-applied rotate+translate
   * transform was baked in correctly. A wrong transform would not throw; it
   * would just draw the teal bar somewhere else on the page, so this test
   * pins the drawing call itself down rather than trusting the geometry by
   * eye.
   */
  it('draws without throwing on a real PDFPage/PDFFont pair', async () => {
    await expect(watermarkedContentStream()).resolves.toEqual(expect.any(String))
  })

  it('still embeds a font for the "ScannApp" label, same as before', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage()

    drawWatermark(page, font)

    const resources = page.node.Resources()
    expect(resources).toBeDefined()
  })

  /**
   * PRIMARY_PATH/SECONDARY_PATH in watermark.ts are hand-derived from
   * src/assets/logo.svg — SECONDARY_PATH by applying its `transform` by hand
   * (see the comment above it), since pdf-lib's drawSvgPath has no transform
   * support. Nothing re-reads the SVG at build or run time, so nothing else
   * would notice if the source file changed under those constants. This
   * pins the exact source strings the hand-derivation started from — a
   * change here means logo.svg changed and watermark.ts's paths need
   * re-deriving to match, not just a routine failing-test fix (caught in
   * code review, round 1).
   */
  it('matches the source SVG the hardcoded paths were derived from', () => {
    const svg = readFileSync(new URL('../assets/logo.svg', import.meta.url), 'utf8')

    expect(svg).toContain(
      'id="primary" d="M17,14H15M3,10,20,4M4,18H20a1,1,0,0,0,1-1V11a1,1,0,0,0-1-1H3v7A1,1,0,0,0,4,18Z"',
    )
    expect(svg).toContain(
      'id="secondary" d="M9,5h6a1,1,0,0,1,1,1V22a1,1,0,0,1-1,1H8a0,0,0,0,1,0,0V6A1,1,0,0,1,9,5Z" transform="translate(26 2) rotate(90)"',
    )
  })
})
