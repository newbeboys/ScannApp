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
 * dependency. So is "Perbaiki Pencahayaan" (Fase 7A): deterministic too, but a
 * separate pipeline stage that runs before these rather than a sixth filter.
 * The name "AI Enhance" is reserved for the TFLite version, and must not be
 * used for the classical one in any UI or copy (CLAUDE.md Bagian 6).
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

  /*
    No lookup table for the lift, unlike `bright` and `ink-saver`. It was tried
    on 24 Agustus 2026 and reverted: a table has to be a Uint8ClampedArray,
    which rounds on store, so the lifted channels would enter the saturation
    step below as integers instead of the fractions they are now — 8.1 million
    channels came out different on a 12MP page. It bought 390ms against 360ms
    for that, which is not a trade worth making.
  */
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

  // Was a Math.pow per pixel: 1556ms on a 12MP page against 277ms for the
  // table, measured in Chromium. Indexing by rounded luminance can land a
  // result one level off the exact curve, which no eye resolves on a printed
  // page — `filters.test.ts` holds it to that one level.
  const curve = new Uint8ClampedArray(256)
  for (let level = 0; level < 256; level++) {
    // Everything from the white point up is background: print nothing.
    curve[level] = level >= white ? 255 : clamp255(255 * (level / white) ** 0.6)
  }

  for (let i = 0; i < data.length; i += 4) {
    const value = curve[Math.round(luminance(data[i], data[i + 1], data[i + 2]))]
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
 * Long edge from which the mean table is built at quarter scale instead of
 * pixel-for-pixel.
 *
 * At full resolution the table is one float per pixel: 92MB for a 12MP scan,
 * asked for in a single allocation while a 46MB pixel buffer is already open.
 * A phone will either stall collecting garbage or refuse outright. The local
 * mean is a low-frequency signal — it describes the lighting across the page,
 * not the ink — so sampling it every fourth pixel loses nothing: measured in
 * Chromium on a 3000x4000 page, not one pixel of the output changed, and the
 * table fell to 17MB.
 *
 * Below this size the exact table is cheap, so small pages keep it and the
 * behaviour tests describe the real thing rather than an approximation.
 */
const COARSE_TABLE_MIN_EDGE = 1024
const COARSE_SHIFT = 2

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
  // Zero at the top-left of every scale, so the four-corner lookup below needs
  // no bounds checks in the inner loop.
  const shift = Math.max(width, height) >= COARSE_TABLE_MIN_EDGE ? COARSE_SHIFT : 0
  const cellSize = 1 << shift
  const cols = Math.max(1, (width + cellSize - 1) >> shift)
  const rows = Math.max(1, (height + cellSize - 1) >> shift)
  const stride = cols + 1
  const sums = new Float64Array(stride * (rows + 1))

  if (shift === 0) {
    for (let y = 0; y < height; y++) {
      let rowSum = 0
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        rowSum += luminance(data[i], data[i + 1], data[i + 2])
        sums[(y + 1) * stride + (x + 1)] = sums[y * stride + (x + 1)] + rowSum
      }
    }
  } else {
    // Average each cell first; the table is then built over cell means, so a
    // lookup still reads back an average brightness whatever the scale.
    const totals = new Float64Array(cols * rows)
    const counts = new Uint32Array(cols * rows)

    for (let y = 0; y < height; y++) {
      const cellRow = (y >> shift) * cols
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const cell = cellRow + (x >> shift)
        totals[cell] += luminance(data[i], data[i + 1], data[i + 2])
        counts[cell]++
      }
    }

    for (let y = 0; y < rows; y++) {
      let rowSum = 0
      for (let x = 0; x < cols; x++) {
        const cell = y * cols + x
        rowSum += totals[cell] / counts[cell]
        sums[(y + 1) * stride + (x + 1)] = sums[y * stride + (x + 1)] + rowSum
      }
    }
  }

  // Kept in source pixels first so the window covers the same part of the page
  // at either scale, then converted to cells.
  const radius = Math.max(
    1,
    Math.round(Math.max(4, Math.round(Math.max(width, height) * THRESHOLD_WINDOW)) / cellSize),
  )

  for (let y = 0; y < height; y++) {
    const cellY = y >> shift
    const top = Math.max(0, cellY - radius)
    const bottom = Math.min(rows - 1, cellY + radius)

    for (let x = 0; x < width; x++) {
      const cellX = x >> shift
      const left = Math.max(0, cellX - radius)
      const right = Math.min(cols - 1, cellX + radius)

      const total =
        sums[(bottom + 1) * stride + (right + 1)] -
        sums[top * stride + (right + 1)] -
        sums[(bottom + 1) * stride + left] +
        sums[top * stride + left]
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
