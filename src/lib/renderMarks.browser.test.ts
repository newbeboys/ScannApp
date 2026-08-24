import { describe, expect, it } from 'vitest'
import { HIGHLIGHTER_WIDTH_FACTOR, type InkStroke, type Mark } from './annotations'
import { renderMarks } from './imageEditor'

/**
 * Runs in a real Chromium, not a mocked DOM.
 *
 * Every claim this module makes is a claim about what the browser drew:
 * whether the ink landed on the pixels it was aimed at, how wide the nib came
 * out, what `multiply` does to the paper underneath. A mocked canvas would
 * only prove the mock was called — see CLAUDE.md Bagian 4.
 */

/** Plain white paper, so any non-white pixel afterwards is ink. */
function blankPage(width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'))
}

/** A small opaque square, standing in for a drawn signature. */
function signatureImage(width = 120, height = 40): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000080'
  ctx.fillRect(0, 0, width, height)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'))
}

async function pixelsOf(blob: Blob): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  // Read before close: a closed ImageBitmap reports 0 for both dimensions.
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return { data: image.data, ...size }
}

function at(
  image: { data: Uint8ClampedArray; width: number },
  x: number,
  y: number,
): [number, number, number] {
  const i = (y * image.width + x) * 4
  return [image.data[i], image.data[i + 1], image.data[i + 2]]
}

/**
 * How many pixels in a column are not white — a proxy for how wide a stroke
 * drew.
 *
 * Measured across all three channels rather than on red alone. A translucent
 * red or yellow highlighter over white paper leaves the red channel almost
 * untouched, so a red-only test counts the widest strokes on the page as blank.
 */
function inkedRowsInColumn(
  image: { data: Uint8ClampedArray; width: number; height: number },
  x: number,
): number {
  let count = 0
  for (let y = 0; y < image.height; y++) {
    if (255 - Math.min(...at(image, x, y)) > 12) count++
  }
  return count
}

const HORIZONTAL_PEN: InkStroke = {
  kind: 'ink',
  tool: 'pen',
  color: '#e5484d',
  width: 0.02,
  points: [0.1, 0.5, 0.9, 0.5],
}

const NO_SIGNATURES = new Map<string, ImageBitmap>()

describe('renderMarks', () => {
  it('returns a JPEG, proven from the file’s first bytes', async () => {
    const result = await renderMarks(await blankPage(400, 400), [HORIZONTAL_PEN], NO_SIGNATURES)
    const head = new Uint8Array(await result.slice(0, 3).arrayBuffer())

    expect([...head]).toEqual([0xff, 0xd8, 0xff])
  })

  it('keeps the page at its original size', async () => {
    const result = await renderMarks(await blankPage(500, 300), [HORIZONTAL_PEN], NO_SIGNATURES)
    const image = await pixelsOf(result)

    expect(image.width).toBe(500)
    expect(image.height).toBe(300)
  })

  it('draws the stroke where it was aimed and nowhere else', async () => {
    const image = await pixelsOf(
      await renderMarks(await blankPage(400, 400), [HORIZONTAL_PEN], NO_SIGNATURES),
    )

    // On the line, halfway along: red ink.
    const [r, g, b] = at(image, 200, 200)
    expect(r).toBeGreaterThan(150)
    expect(g).toBeLessThan(140)
    expect(b).toBeLessThan(140)

    // Well above it, and beyond its left end: still paper.
    expect(at(image, 200, 60)[0]).toBeGreaterThan(240)
    expect(at(image, 10, 200)[0]).toBeGreaterThan(240)
  })

  it('leaves a page with no marks looking like the page', async () => {
    const image = await pixelsOf(await renderMarks(await blankPage(200, 200), [], NO_SIGNATURES))

    expect(at(image, 100, 100)[0]).toBeGreaterThan(240)
  })

  /**
   * Widths are a fraction of the *long* edge, which is what keeps a stroke the
   * same weight whichever way round the page is.
   */
  it('scales the nib with the page, not with the viewport it was drawn in', async () => {
    const small = await pixelsOf(
      await renderMarks(await blankPage(200, 200), [HORIZONTAL_PEN], NO_SIGNATURES),
    )
    const large = await pixelsOf(
      await renderMarks(await blankPage(800, 800), [HORIZONTAL_PEN], NO_SIGNATURES),
    )

    // Four times the page, four times the nib in pixels — within a pixel or
    // two of rounding and the round cap.
    expect(inkedRowsInColumn(large, 400) / inkedRowsInColumn(small, 100)).toBeGreaterThan(3.5)
    expect(inkedRowsInColumn(large, 400) / inkedRowsInColumn(small, 100)).toBeLessThan(4.5)
  })

  it('draws a highlighter far wider than a pen at the same nominal width', async () => {
    const pen = await pixelsOf(
      await renderMarks(await blankPage(400, 400), [HORIZONTAL_PEN], NO_SIGNATURES),
    )
    const marker = await pixelsOf(
      await renderMarks(
        await blankPage(400, 400),
        [{ ...HORIZONTAL_PEN, tool: 'highlighter' }],
        NO_SIGNATURES,
      ),
    )

    // Not exactly HIGHLIGHTER_WIDTH_FACTOR: a translucent edge pixel falls
    // under the "not white" threshold on the wide stroke and over it on the
    // narrow one, so the measured ratio sits a little under the nominal one.
    const ratio = inkedRowsInColumn(marker, 200) / inkedRowsInColumn(pen, 200)
    expect(ratio).toBeGreaterThan(HIGHLIGHTER_WIDTH_FACTOR - 2)
    expect(ratio).toBeLessThanOrEqual(HIGHLIGHTER_WIDTH_FACTOR + 1)
  })

  /**
   * The reason a highlighter is composited with `multiply` rather than painted
   * with plain alpha: text under it has to stay readable. Multiplying yellow
   * over black leaves black; painting over it would lighten it.
   */
  it('a highlighter leaves the text under it black, not washed out', async () => {
    const page = document.createElement('canvas')
    page.width = 400
    page.height = 400
    const ctx = page.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 400, 400)
    ctx.fillStyle = '#000000'
    ctx.fillRect(150, 190, 100, 20)
    const withText: Blob = await new Promise((resolve) =>
      page.toBlob((blob) => resolve(blob!), 'image/png'),
    )

    const image = await pixelsOf(
      await renderMarks(
        withText,
        [{ ...HORIZONTAL_PEN, tool: 'highlighter', color: '#f5c443' }],
        NO_SIGNATURES,
      ),
    )

    // Over the text: still essentially black.
    expect(at(image, 200, 200)[0]).toBeLessThan(60)
    // Beside the text, under the same stroke: yellowed paper.
    const [r, , b] = at(image, 60, 200)
    expect(r).toBeGreaterThan(200)
    expect(b).toBeLessThan(220)
  })

  it('stamps a signature inside the box it was given', async () => {
    const bitmap = await createImageBitmap(await signatureImage())
    const stamp: Mark = {
      kind: 'signature',
      source: 'scans/signature-1.png',
      x: 0.5,
      y: 0.5,
      width: 0.4,
      height: 0.2,
    }

    const image = await pixelsOf(
      await renderMarks(
        await blankPage(400, 400),
        [stamp],
        new Map([['scans/signature-1.png', bitmap]]),
      ),
    )
    bitmap.close()

    // Middle of the box (x 200..360, y 200..280): the signature's navy.
    expect(at(image, 280, 240)[2]).toBeGreaterThan(80)
    expect(at(image, 280, 240)[0]).toBeLessThan(80)
    // Just outside it: paper.
    expect(at(image, 280, 320)[0]).toBeGreaterThan(240)
  })

  /**
   * A signature file can go missing — deleted storage, a restore from an older
   * backup. Losing one stamp beats refusing to render the page at all, so the
   * mark is skipped and everything else still draws.
   */
  it('skips a signature whose file is missing and still draws the ink', async () => {
    const marks: Mark[] = [
      { kind: 'signature', source: 'gone.png', x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      HORIZONTAL_PEN,
    ]

    const image = await pixelsOf(
      await renderMarks(await blankPage(400, 400), marks, NO_SIGNATURES),
    )

    expect(at(image, 200, 200)[0]).toBeGreaterThan(150)
    expect(at(image, 60, 60)[0]).toBeGreaterThan(240)
  })

  /**
   * The whole point of keeping marks as data. Rendering the same marks onto
   * the same page twice has to give the same picture — if ink ever compounded,
   * every filter change would darken it.
   */
  it('rendering the same marks again does not thicken them', async () => {
    const once = await pixelsOf(
      await renderMarks(await blankPage(400, 400), [HORIZONTAL_PEN], NO_SIGNATURES),
    )
    const twice = await pixelsOf(
      await renderMarks(await blankPage(400, 400), [HORIZONTAL_PEN], NO_SIGNATURES),
    )

    expect(inkedRowsInColumn(twice, 200)).toBe(inkedRowsInColumn(once, 200))
  })
})
