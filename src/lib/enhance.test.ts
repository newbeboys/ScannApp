import { describe, expect, it } from 'vitest'
import { correctLighting, estimateLightGrid, GRID, MAX_GAIN } from './enhance'
import { luminance } from './filters'

/** A flat grey page — no shadow anywhere. */
function flatPage(width: number, height: number, value: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
    data[i + 3] = 255
  }
  return data
}

/** A page whose paper darkens from left to right — a hand's shadow across it. */
function shadowedPage(
  width: number,
  height: number,
  left: number,
  right: number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const paper = left + ((right - left) * x) / (width - 1)
      const i = (y * width + x) * 4
      data[i] = paper
      data[i + 1] = paper
      data[i + 2] = paper
      data[i + 3] = 255
    }
  }
  return data
}

/** Luminance of one pixel. */
function lumaAt(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  const i = (y * width + x) * 4
  return luminance(data[i], data[i + 1], data[i + 2])
}

/** Paints a solid block over one tile of a 16x16 grid on a square page. */
function paintTile(
  data: Uint8ClampedArray,
  width: number,
  tx: number,
  ty: number,
  value: number,
): void {
  const size = width / GRID
  for (let y = ty * size; y < (ty + 1) * size; y++) {
    for (let x = tx * size; x < (tx + 1) * size; x++) {
      const i = (y * width + x) * 4
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
    }
  }
}

describe('estimateLightGrid', () => {
  it('follows the shadow: the lit side reads far brighter than the dark side', () => {
    const grid = estimateLightGrid(shadowedPage(256, 256, 210, 90), 256, 256)!

    expect(grid[0]).toBeGreaterThan(grid[GRID - 1] + 80)
  })

  it('reads a page with even lighting as even', () => {
    const grid = estimateLightGrid(flatPage(256, 256, 200), 256, 256)!
    const values = Array.from(grid)

    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(2)
  })

  /**
   * The failure this locks out. A pasted photo or a solid black block reports
   * "the paper is dark here" when the paper is not dark at all. Following that
   * reading would multiply the block by the gain cap and wash the photo out.
   */
  it('patches a black block from its neighbours instead of believing it', () => {
    const data = flatPage(256, 256, 200)
    paintTile(data, 256, 8, 8, 10)

    const grid = estimateLightGrid(data, 256, 256)!

    expect(grid[8 * GRID + 8]).toBeGreaterThan(150)
  })

  it('gives up when most tiles have no pixels at all', () => {
    // 5x5 pixels against a 16x16 grid: 231 of 256 tiles are empty.
    expect(estimateLightGrid(flatPage(5, 5, 200), 5, 5)).toBeNull()
  })
})

describe('correctLighting', () => {
  it('flattens a shadow that spans the page', () => {
    const data = shadowedPage(256, 256, 210, 90)
    const before = Math.abs(lumaAt(data, 256, 8, 128) - lumaAt(data, 256, 248, 128))

    correctLighting(data, 256, 256, estimateLightGrid(data, 256, 256)!)
    const after = Math.abs(lumaAt(data, 256, 8, 128) - lumaAt(data, 256, 248, 128))

    expect(before).toBeGreaterThan(100)
    expect(after).toBeLessThan(20)
  })

  /**
   * The stage flattens lighting; it never darkens. That is what `target =
   * max(grid)` buys, and it is what keeps the filters downstream working on a
   * page shaped the way they expect.
   */
  it('never makes any pixel darker than it was', () => {
    const data = shadowedPage(256, 256, 210, 90)
    const before = Uint8ClampedArray.from(data)

    correctLighting(data, 256, 256, estimateLightGrid(data, 256, 256)!)

    let darkened = false
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < before[i]) darkened = true
    }
    expect(darkened).toBe(false)
  })

  it('caps the gain, so a near-black corner is not turned into amplified noise', () => {
    const data = shadowedPage(256, 256, 250, 20)

    correctLighting(data, 256, 256, estimateLightGrid(data, 256, 256)!)

    // 20 x 2.5 = 50; anything above that means the cap did not hold.
    expect(lumaAt(data, 256, 255, 128)).toBeLessThan(55)
  })

  it('keeps ink darker than the paper around it', () => {
    const data = shadowedPage(256, 256, 210, 90)
    for (let y = 0; y < 256; y++) {
      const i = (y * 256 + 240) * 4
      data[i] = data[i] * 0.25
      data[i + 1] = data[i + 1] * 0.25
      data[i + 2] = data[i + 2] * 0.25
    }

    correctLighting(data, 256, 256, estimateLightGrid(data, 256, 256)!)

    expect(lumaAt(data, 256, 240, 128)).toBeLessThan(lumaAt(data, 256, 248, 128) - 100)
  })

  it('scales the channels together, so colour is not shifted', () => {
    const data = flatPage(256, 256, 40)
    // One bright tile makes the target, so the rest asks for real gain.
    paintTile(data, 256, 0, 0, 200)
    const i = (128 * 256 + 128) * 4
    data[i] = 80
    data[i + 1] = 40
    data[i + 2] = 20

    correctLighting(data, 256, 256, estimateLightGrid(data, 256, 256)!)

    expect(data[i] / data[i + 1]).toBeCloseTo(2, 1)
    expect(data[i + 1] / data[i + 2]).toBeCloseTo(2, 1)
  })

  it('leaves a page that is black all over exactly as it was', () => {
    const data = flatPage(64, 64, 0)

    correctLighting(data, 64, 64, estimateLightGrid(data, 64, 64)!)

    expect(data[0]).toBe(0)
  })

  it('exposes the gain cap it enforces', () => {
    expect(MAX_GAIN).toBe(2.5)
  })
})

/**
 * The exact form `correctLighting` is a fast approximation of: interpolate the
 * light bilinearly for every pixel, then divide there and then.
 *
 * Kept here rather than in the implementation because it is the *reference*,
 * not a fallback — its job is to be obviously right and slow, so the fast path
 * can be measured against something.
 */
function correctLightingExactly(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  grid: Float32Array,
  cols = GRID,
  rows = GRID,
): void {
  let target = 0
  for (const value of grid) if (value > target) target = value
  if (target <= 1) return

  for (let y = 0; y < height; y++) {
    const gy = Math.min(rows - 1, Math.max(0, ((y + 0.5) * rows) / height - 0.5))
    const y0 = Math.floor(gy)
    const y1 = Math.min(rows - 1, y0 + 1)
    const wy = gy - y0

    for (let x = 0; x < width; x++) {
      const gx = Math.min(cols - 1, Math.max(0, ((x + 0.5) * cols) / width - 0.5))
      const x0 = Math.floor(gx)
      const x1 = Math.min(cols - 1, x0 + 1)
      const wx = gx - x0

      const top = grid[y0 * cols + x0] + (grid[y0 * cols + x1] - grid[y0 * cols + x0]) * wx
      const bottom = grid[y1 * cols + x0] + (grid[y1 * cols + x1] - grid[y1 * cols + x0]) * wx
      const background = top + (bottom - top) * wy

      const gain = Math.min(target / Math.max(background, 1), MAX_GAIN)
      if (gain <= 1) continue

      const i = (y * width + x) * 4
      data[i] = data[i] * gain
      data[i + 1] = data[i + 1] * gain
      data[i + 2] = data[i + 2] * gain
    }
  }
}

/** Worst single-channel difference between the fast path and the exact one. */
function deviationFromExact(
  width: number,
  height: number,
  paperAt: (x: number, y: number) => number,
): number {
  const fast = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = paperAt(x, y)
      const i = (y * width + x) * 4
      fast[i] = value
      fast[i + 1] = value
      fast[i + 2] = value
      fast[i + 3] = 255
    }
  }
  const slow = Uint8ClampedArray.from(fast)
  const grid = estimateLightGrid(fast, width, height)!

  correctLighting(fast, width, height, grid)
  correctLightingExactly(slow, width, height, grid)

  let worst = 0
  for (let i = 0; i < fast.length; i += 4) worst = Math.max(worst, Math.abs(fast[i] - slow[i]))
  return worst
}

/**
 * `correctLighting` divides at every fourth pixel and interpolates the gain
 * between, because a division per pixel was the single most expensive thing in
 * the whole page (diukur 30 Agustus 2026: 200-250ms of a ~500ms page, against
 * ~140ms once the divisions went).
 *
 * `target / light` is convex, so that shortcut has an error, and the error is
 * worst exactly where this feature is supposed to help — a hard shadow edge.
 * These hold it where it was measured. Dividing only at the sixteen grid nodes
 * instead was 24 levels out on the hard edge, which is a visible bright band;
 * that is the version these tests exist to keep from coming back.
 */
describe('correctLighting against the exact division', () => {
  it('stays within a level on a smooth shadow', () => {
    expect(deviationFromExact(1600, 400, (x) => 210 - (120 * x) / 1599)).toBeLessThanOrEqual(1)
  })

  it('stays within two levels on a hard shadow edge', () => {
    expect(deviationFromExact(1600, 400, (x) => (x < 800 ? 205 : 70))).toBeLessThanOrEqual(2)
  })

  it('stays within two levels under a vignette', () => {
    expect(
      deviationFromExact(1600, 400, (x, y) => {
        const distance = Math.hypot(x - 320, y - 100) / 1600
        return Math.max(30, 210 - 260 * distance * distance)
      }),
    ).toBeLessThanOrEqual(2)
  })
})
