import type { DocumentFilter } from './scanIndexMigration'

/**
 * The pixel maths behind the five document filters.
 *
 * Deliberately free of canvas and every other DOM API: these take a raw RGBA
 * buffer and mutate it in place, so they can be unit-tested under Node against
 * pixels whose right answer is known. `imageEditor` does the decoding and
 * encoding around them.
 *
 * All five are ordinary deterministic image processing — no model, no new
 * dependency. AI Enhance is Fase 7 and a different path entirely (CLAUDE.md
 * Bagian 2).
 */

/** Rec. 601 luma — how bright a pixel looks, not the plain channel average. */
export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

/**
 * The brightness that counts as paper white on this page.
 *
 * Taken as a high percentile of the luminance histogram rather than the
 * maximum: one blown-out highlight — a reflection off a staple, a window in
 * frame — would otherwise define white for the whole page and leave the actual
 * paper looking grey.
 */
export function whitePoint(data: Uint8ClampedArray, percentile = 0.95): number {
  const histogram = new Uint32Array(256)
  let count = 0

  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.round(luminance(data[i], data[i + 1], data[i + 2]))]++
    count++
  }

  const target = count * percentile
  let seen = 0
  for (let level = 0; level < 256; level++) {
    seen += histogram[level]
    if (seen >= target) return Math.max(level, 1)
  }

  return 255
}

/**
 * Magic Color — the all-rounder.
 *
 * Stretches everything below the page's white point up to full white, so grey
 * paper reads as paper, then lifts saturation slightly so ink and highlighter
 * stay legible instead of washing out with the background.
 */
function magic(data: Uint8ClampedArray): void {
  const scale = 255 / whitePoint(data)

  for (let i = 0; i < data.length; i += 4) {
    const r = clamp255(data[i] * scale)
    const g = clamp255(data[i + 1] * scale)
    const b = clamp255(data[i + 2] * scale)
    const grey = luminance(r, g, b)

    // Push each channel away from its own grey — saturation without touching
    // brightness, which keeps the page from getting darker as colour returns.
    data[i] = clamp255(grey + (r - grey) * 1.25)
    data[i + 1] = clamp255(grey + (g - grey) * 1.25)
    data[i + 2] = clamp255(grey + (b - grey) * 1.25)
  }
}

/**
 * Cerah — for scans taken in poor light.
 *
 * A gamma curve rather than a flat brightness add: it opens up the shadows
 * where the detail is hiding while leaving what is already bright alone, so
 * the page does not simply turn into a grey wash.
 */
function bright(data: Uint8ClampedArray): void {
  const curve = new Uint8ClampedArray(256)
  for (let level = 0; level < 256; level++) {
    curve[level] = clamp255(255 * (level / 255) ** 0.65)
  }

  for (let i = 0; i < data.length; i += 4) {
    data[i] = curve[data[i]]
    data[i + 1] = curve[data[i + 1]]
    data[i + 2] = curve[data[i + 2]]
  }
}

/** Abu-abu — drops colour but keeps every gradation. */
function grayscale(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const grey = clamp255(luminance(data[i], data[i + 1], data[i + 2]))
    data[i] = grey
    data[i + 1] = grey
    data[i + 2] = grey
  }
}

/**
 * Hemat Tinta — for printing.
 *
 * Forces anything at or above paper white to pure white so the printer lays
 * down no ink on the background at all, and thins the ink that remains by
 * lightening the mid-tones. Text stays readable; the page stops costing a
 * cartridge.
 */
function inkSaver(data: Uint8ClampedArray): void {
  const white = whitePoint(data, 0.9)

  for (let i = 0; i < data.length; i += 4) {
    const grey = luminance(data[i], data[i + 1], data[i + 2])
    // Everything from the white point up is background: print nothing.
    const value = grey >= white ? 255 : clamp255(255 * (grey / white) ** 0.6)
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
  }
}

/**
 * How far the local average is sampled when thresholding, as a fraction of the
 * image's longest side. Roughly a couple of text lines: wide enough that a
 * letter is compared against the paper around it rather than against itself,
 * narrow enough to follow a shadow gradient across the page.
 */
const THRESHOLD_WINDOW = 0.02

/**
 * Hitam-Putih — one bit per pixel, the smallest files and the sharpest text.
 *
 * Thresholded against a *local* average rather than one number for the whole
 * page. A global threshold is what turns a photographed document into a black
 * smear: a hand's shadow or a lamp off to one side makes half the paper darker
 * than the other half's ink, and no single cut-off can serve both. Comparing
 * each pixel with its own neighbourhood follows the lighting instead of
 * fighting it.
 *
 * The neighbourhood mean comes from a summed-area table, so the cost does not
 * grow with the window size — one pass to build it, four lookups per pixel.
 */
function blackAndWhite(data: Uint8ClampedArray, width: number, height: number): void {
  // One row and column of zero padding, so the four-corner lookup below needs
  // no bounds checks in the inner loop.
  const sums = new Float64Array((width + 1) * (height + 1))

  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      rowSum += luminance(data[i], data[i + 1], data[i + 2])
      sums[(y + 1) * (width + 1) + (x + 1)] = sums[y * (width + 1) + (x + 1)] + rowSum
    }
  }

  const radius = Math.max(4, Math.round(Math.max(width, height) * THRESHOLD_WINDOW))

  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius)
    const bottom = Math.min(height - 1, y + radius)

    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius)
      const right = Math.min(width - 1, x + radius)

      const total =
        sums[(bottom + 1) * (width + 1) + (right + 1)] -
        sums[top * (width + 1) + (right + 1)] -
        sums[(bottom + 1) * (width + 1) + left] +
        sums[top * (width + 1) + left]
      const mean = total / ((bottom - top + 1) * (right - left + 1))

      const i = (y * width + x) * 4
      // The 0.92 bias keeps paper white: without it, a blank region whose
      // pixels sit right at their own average turns into speckled noise.
      const value = luminance(data[i], data[i + 1], data[i + 2]) < mean * 0.92 ? 0 : 255
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
    }
  }
}

/** Applies one filter to an RGBA buffer, in place. Alpha is never touched. */
export function applyFilter(
  filter: DocumentFilter,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  switch (filter) {
    case 'magic':
      return magic(data)
    case 'bright':
      return bright(data)
    case 'grayscale':
      return grayscale(data)
    case 'bw':
      return blackAndWhite(data, width, height)
    case 'ink-saver':
      return inkSaver(data)
  }
}

/** Label shown in the filter picker. */
export const FILTER_LABELS: Record<DocumentFilter, string> = {
  magic: 'Magic Color',
  bright: 'Cerah',
  grayscale: 'Abu-abu',
  bw: 'Hitam-Putih',
  'ink-saver': 'Hemat Tinta',
}
