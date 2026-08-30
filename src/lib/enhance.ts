import { luminance } from './filters'

/**
 * The pixel maths behind "Perbaiki Pencahayaan" — Fase 7A.
 *
 * Free of canvas and every other DOM API, exactly like `filters.ts`: these read
 * or mutate a raw RGBA buffer, so they can be unit-tested under Node against
 * pixels whose right answer is known. `imageEditor.enhancePage` does the
 * decoding and encoding around them.
 *
 * Ordinary deterministic image processing — no model, no new dependency. The
 * name "AI Enhance" belongs to the TFLite version and must not be used for this
 * one in any UI or copy (CLAUDE.md Bagian 6).
 */

/** Tiles per axis in the light map. */
export const GRID = 16

/** Long edge of the work image the map is estimated from. */
export const WORK_EDGE = 256

/**
 * Most a pixel may be multiplied by.
 *
 * Without it a near-black corner asks for a gain of twenty, and what comes back
 * is amplified sensor noise rather than paper.
 */
export const MAX_GAIN = 2.5

/**
 * How bright a tile's paper is taken to be.
 *
 * A percentile, not a mean — a mean is dragged down by every letter on the tile
 * — and not the maximum, which one reflection off a staple would own.
 */
const PERCENTILE = 0.95

/** Half-width of the tile neighbourhood outliers are judged against: 5x5. */
const WINDOW_RADIUS = 2

/** Turns a median absolute deviation into a standard-deviation estimate. */
const MAD_SCALE = 1.4826

/**
 * Floor under the deviation estimate.
 *
 * MAD is exactly zero across plain paper, and without a floor the test would
 * then reject any tile differing by a single level.
 */
const MIN_SIGMA = 4

/** How many deviations below its neighbours a tile must sit to be rejected. */
const OUTLIER_K = 3

/** Past this share of rejected tiles the map is not worth trusting at all. */
const MAX_REJECTED = 0.5

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/**
 * Fills a rejected tile from the accepted tiles nearest to it.
 *
 * The square grows until it finds something rather than reaching for a global
 * average: lighting is a local property, and a tile in a dark corner should be
 * patched from that corner, not from the lit half of the page.
 */
function patchFromNeighbours(
  raw: Float32Array,
  rejected: Uint8Array,
  tx: number,
  ty: number,
  cols: number,
  rows: number,
): number {
  for (let radius = 1; radius <= Math.max(cols, rows); radius++) {
    let total = 0
    let count = 0

    for (let y = Math.max(0, ty - radius); y <= Math.min(rows - 1, ty + radius); y++) {
      for (let x = Math.max(0, tx - radius); x <= Math.min(cols - 1, tx + radius); x++) {
        const cell = y * cols + x
        if (rejected[cell]) continue
        total += raw[cell]
        count++
      }
    }

    if (count > 0) return total / count
  }

  return raw[ty * cols + tx]
}

/**
 * Estimates how much light fell on each part of the page.
 *
 * Returns one value per tile of a `cols` x `rows` grid, or `null` when too much
 * of the grid had to be thrown away to trust what is left — in which case the
 * caller must leave the page exactly as it is rather than dividing it by a
 * guess (design doc, Bagian 4.3).
 *
 * Meant to be handed a *work* image of about `WORK_EDGE` on its long side, not
 * a full-resolution page: lighting is a low-frequency signal, so sampling it at
 * 65k pixels instead of 12 million changes the answer by nothing measurable and
 * costs two orders of magnitude less.
 */
export function estimateLightGrid(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cols = GRID,
  rows = GRID,
): Float32Array | null {
  const raw = new Float32Array(cols * rows)
  const rejected = new Uint8Array(cols * rows)
  let rejectedCount = 0

  for (let ty = 0; ty < rows; ty++) {
    const y0 = Math.floor((ty * height) / rows)
    const y1 = Math.floor(((ty + 1) * height) / rows)

    for (let tx = 0; tx < cols; tx++) {
      const x0 = Math.floor((tx * width) / cols)
      const x1 = Math.floor(((tx + 1) * width) / cols)
      const cell = ty * cols + tx

      const values: number[] = []
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4
          values.push(luminance(data[i], data[i + 1], data[i + 2]))
        }
      }

      // No pixels landed in this tile — the work image is smaller than the
      // grid. Rejected rather than guessed; enough of these trip the valve
      // below and the page is left alone.
      if (values.length === 0) {
        rejected[cell] = 1
        rejectedCount++
        continue
      }

      values.sort((a, b) => a - b)
      raw[cell] = values[Math.min(values.length - 1, Math.floor(values.length * PERCENTILE))]
    }
  }

  /*
    Written to its own array, not back into `rejected`, so every verdict is
    read from the raw grid. Sharing one array lets a rejection change the
    neighbourhood the next tile is judged against, and rejection then spreads
    across the page from wherever it started.
  */
  const outlier = new Uint8Array(cols * rows)

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const cell = ty * cols + tx
      if (rejected[cell]) continue

      const window: number[] = []
      for (
        let y = Math.max(0, ty - WINDOW_RADIUS);
        y <= Math.min(rows - 1, ty + WINDOW_RADIUS);
        y++
      ) {
        for (
          let x = Math.max(0, tx - WINDOW_RADIUS);
          x <= Math.min(cols - 1, tx + WINDOW_RADIUS);
          x++
        ) {
          const neighbour = y * cols + x
          if (!rejected[neighbour]) window.push(raw[neighbour])
        }
      }
      if (window.length < 3) continue

      const centre = median(window)
      const sigma = Math.max(MAD_SCALE * median(window.map((v) => Math.abs(v - centre))), MIN_SIGMA)

      // Only tiles *darker* than their neighbourhood are suspect: that is what
      // ink, a photo, or a black block looks like. A brighter tile is a
      // brighter part of the page, which is exactly what is being measured.
      if (raw[cell] < centre - OUTLIER_K * sigma) {
        outlier[cell] = 1
        rejectedCount++
      }
    }
  }

  for (let cell = 0; cell < outlier.length; cell++) {
    if (outlier[cell]) rejected[cell] = 1
  }

  if (rejectedCount > cols * rows * MAX_REJECTED) return null

  const grid = Float32Array.from(raw)
  for (let cell = 0; cell < grid.length; cell++) {
    if (!rejected[cell]) continue
    grid[cell] = patchFromNeighbours(raw, rejected, cell % cols, Math.floor(cell / cols), cols, rows)
  }

  return grid
}

/**
 * Divides the page by its light map, in place.
 *
 * The reference is the map's own maximum rather than a fixed white level, so
 * the brightest paper on the page is left untouched and everything else is
 * lifted to meet it. That keeps this a *flattening* stage: it never darkens
 * anything, and it never doubles as a brightness control — `bright` and `magic`
 * already own that, and they run after this one.
 *
 * The map is never expanded to page size. For a 12 MP scan that array would be
 * 48MB, asked for while a 48MB pixel buffer is already open; the bilinear
 * lookup below reads the 256 numbers directly instead, with only the per-column
 * weights precomputed (design doc, Bagian 4.5).
 *
 * Alpha is never touched, and the destination being a `Uint8ClampedArray` means
 * the clamp on store is the browser's, not ours.
 */
export function correctLighting(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  grid: Float32Array,
  cols = GRID,
  rows = GRID,
  maxGain = MAX_GAIN,
): void {
  let target = 0
  for (let cell = 0; cell < grid.length; cell++) {
    if (grid[cell] > target) target = grid[cell]
  }

  // A page that is black all over has no paper to take as the reference, and
  // dividing by it would only amplify whatever noise is in there.
  if (target <= 1) return

  const leftIndex = new Int32Array(width)
  const rightIndex = new Int32Array(width)
  const weightX = new Float32Array(width)

  for (let x = 0; x < width; x++) {
    const gx = Math.min(cols - 1, Math.max(0, ((x + 0.5) * cols) / width - 0.5))
    const x0 = Math.floor(gx)
    leftIndex[x] = x0
    rightIndex[x] = Math.min(cols - 1, x0 + 1)
    weightX[x] = gx - x0
  }

  for (let y = 0; y < height; y++) {
    const gy = Math.min(rows - 1, Math.max(0, ((y + 0.5) * rows) / height - 0.5))
    const y0 = Math.floor(gy)
    const y1 = Math.min(rows - 1, y0 + 1)
    const wy = gy - y0
    const topRow = y0 * cols
    const bottomRow = y1 * cols

    for (let x = 0; x < width; x++) {
      const x0 = leftIndex[x]
      const x1 = rightIndex[x]
      const wx = weightX[x]

      const top = grid[topRow + x0] + (grid[topRow + x1] - grid[topRow + x0]) * wx
      const bottom = grid[bottomRow + x0] + (grid[bottomRow + x1] - grid[bottomRow + x0]) * wx
      const background = top + (bottom - top) * wy

      const gain = Math.min(target / Math.max(background, 1), maxGain)
      if (gain <= 1) continue

      const i = (y * width + x) * 4
      data[i] = data[i] * gain
      data[i + 1] = data[i + 1] * gain
      data[i + 2] = data[i + 2] * gain
    }
  }
}
