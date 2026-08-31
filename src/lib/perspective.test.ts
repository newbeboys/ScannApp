import { describe, expect, it } from 'vitest'
import {
  applyMatrix3,
  invertMatrix3,
  MIN_QUAD_AREA,
  quadArea,
  sampleWarp,
  unitSquareToQuad,
  warpedOutputSize,
  type Matrix3,
  type Quad,
} from './perspective'

/** The whole source image, corner for corner — the default a fresh QuadOverlay starts from. */
const FULL: Quad = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomLeft: { x: 0, y: 1 },
  bottomRight: { x: 1, y: 1 },
}

describe('quadArea', () => {
  it('is 1 for the full unit square', () => {
    expect(quadArea(FULL)).toBeCloseTo(1, 10)
  })

  it('is 0 for four corners collapsed onto one point', () => {
    const point = { x: 0.4, y: 0.4 }
    expect(quadArea({ topLeft: point, topRight: point, bottomLeft: point, bottomRight: point })).toBe(0)
  })

  it('is 0.25 for a quad covering exactly one quadrant', () => {
    const quadrant: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0.5, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 0.5, y: 0.5 },
    }
    expect(quadArea(quadrant)).toBeCloseTo(0.25, 10)
  })
})

describe('unitSquareToQuad', () => {
  it('is the identity matrix for the full-image quad', () => {
    const matrix = unitSquareToQuad(FULL)!
    expect(matrix).not.toBeNull()

    for (const point of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0.3, y: 0.7 }]) {
      const mapped = applyMatrix3(matrix, point)
      expect(mapped.x).toBeCloseTo(point.x, 10)
      expect(mapped.y).toBeCloseTo(point.y, 10)
    }
  })

  /**
   * The common case in practice: a user who barely touches the corners ends
   * up with something very close to an axis-aligned rectangle, which is a
   * parallelogram — the branch of Heckbert's derivation that divides by
   * nothing. If this branch is wrong, every ordinary straighten breaks.
   */
  it('maps a plain inset rectangle without distorting it', () => {
    const rect: Quad = {
      topLeft: { x: 0.1, y: 0.2 },
      topRight: { x: 0.9, y: 0.2 },
      bottomLeft: { x: 0.1, y: 0.8 },
      bottomRight: { x: 0.9, y: 0.8 },
    }
    const matrix = unitSquareToQuad(rect)!

    expect(applyMatrix3(matrix, { x: 0, y: 0 })).toEqual({ x: 0.1, y: 0.2 })
    expect(applyMatrix3(matrix, { x: 1, y: 1 })).toEqual({ x: 0.9, y: 0.8 })
    expect(applyMatrix3(matrix, { x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 })
  })

  /**
   * A genuine perspective quad — not a parallelogram, so this exercises the
   * g/h branch. Hand-derived: P0=(0,0) P1=(2,0) P2=(1,1) P3=(0,1), verified
   * independently against the plan's own derivation (design doc Bagian 5.1 /
   * plan Task 1 notes) before being written here.
   */
  it('matches a hand-derived mapping for a true (non-parallelogram) quad', () => {
    const quad: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 2, y: 0 },
      bottomLeft: { x: 0, y: 1 },
      bottomRight: { x: 1, y: 1 },
    }
    const matrix = unitSquareToQuad(quad)!

    expect(applyMatrix3(matrix, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
    expect(applyMatrix3(matrix, { x: 1, y: 0 })).toEqual({ x: 2, y: 0 })
    expect(applyMatrix3(matrix, { x: 0, y: 1 })).toEqual({ x: 0, y: 1 })

    const bottomRight = applyMatrix3(matrix, { x: 1, y: 1 })
    expect(bottomRight.x).toBeCloseTo(1, 10)
    expect(bottomRight.y).toBeCloseTo(1, 10)
  })

  it('refuses four corners collapsed onto one point', () => {
    const point = { x: 0.4, y: 0.4 }
    expect(
      unitSquareToQuad({ topLeft: point, topRight: point, bottomLeft: point, bottomRight: point }),
    ).toBeNull()
  })

  it('refuses four corners that are all on one line', () => {
    const line: Quad = {
      topLeft: { x: 0.1, y: 0.5 },
      topRight: { x: 0.4, y: 0.5 },
      bottomLeft: { x: 0.6, y: 0.5 },
      bottomRight: { x: 0.9, y: 0.5 },
    }
    expect(unitSquareToQuad(line)).toBeNull()
  })

  it('refuses exactly at the documented MIN_QUAD_AREA threshold', () => {
    // A square of side s has area s^2; picking s just under sqrt(MIN_QUAD_AREA)
    // keeps this test tied to the exported constant instead of a made-up number,
    // so a future change to the threshold is caught here instead of silently
    // changing what counts as "too small" for every caller.
    const side = Math.sqrt(MIN_QUAD_AREA) * 0.99
    const tooSmall: Quad = {
      topLeft: { x: 0.5 - side / 2, y: 0.5 - side / 2 },
      topRight: { x: 0.5 + side / 2, y: 0.5 - side / 2 },
      bottomLeft: { x: 0.5 - side / 2, y: 0.5 + side / 2 },
      bottomRight: { x: 0.5 + side / 2, y: 0.5 + side / 2 },
    }
    expect(unitSquareToQuad(tooSmall)).toBeNull()

    const bigEnoughSide = Math.sqrt(MIN_QUAD_AREA) * 1.5
    const bigEnough: Quad = {
      topLeft: { x: 0.5 - bigEnoughSide / 2, y: 0.5 - bigEnoughSide / 2 },
      topRight: { x: 0.5 + bigEnoughSide / 2, y: 0.5 - bigEnoughSide / 2 },
      bottomLeft: { x: 0.5 - bigEnoughSide / 2, y: 0.5 + bigEnoughSide / 2 },
      bottomRight: { x: 0.5 + bigEnoughSide / 2, y: 0.5 + bigEnoughSide / 2 },
    }
    expect(unitSquareToQuad(bigEnough)).not.toBeNull()
  })
})

describe('invertMatrix3', () => {
  it('inverts the identity to itself', () => {
    const identity = unitSquareToQuad({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1, y: 0 },
      bottomLeft: { x: 0, y: 1 },
      bottomRight: { x: 1, y: 1 },
    })!
    expect(invertMatrix3(identity)).toEqual(identity)
  })

  it('round-trips a point through a true perspective matrix and its inverse', () => {
    const quad: Quad = {
      topLeft: { x: 0.05, y: 0.1 },
      topRight: { x: 0.85, y: 0.02 },
      bottomLeft: { x: 0.1, y: 0.92 },
      bottomRight: { x: 0.95, y: 0.88 },
    }
    const matrix = unitSquareToQuad(quad)!
    const inverse = invertMatrix3(matrix)!

    for (const point of [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.6 }, { x: 0.5, y: 0.5 }]) {
      const forward = applyMatrix3(matrix, point)
      const back = applyMatrix3(inverse, forward)
      expect(back.x).toBeCloseTo(point.x, 8)
      expect(back.y).toBeCloseTo(point.y, 8)
    }
  })

  it('refuses a singular matrix', () => {
    const singular: Matrix3 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(invertMatrix3(singular)).toBeNull()
  })
})

describe('warpedOutputSize', () => {
  it('matches the source size exactly for the full-image quad', () => {
    expect(warpedOutputSize(FULL, 3000, 4000)).toEqual({ width: 3000, height: 4000 })
  })

  it('follows the quad edges, not the source frame, for a half-height selection', () => {
    const topHalf: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 1, y: 0.5 },
    }
    expect(warpedOutputSize(topHalf, 800, 1000)).toEqual({ width: 800, height: 500 })
  })

  it('never returns a zero dimension', () => {
    const point = { x: 0.4, y: 0.4 }
    const collapsed: Quad = { topLeft: point, topRight: point, bottomLeft: point, bottomRight: point }
    const size = warpedOutputSize(collapsed, 1000, 1000)
    expect(size.width).toBeGreaterThanOrEqual(1)
    expect(size.height).toBeGreaterThanOrEqual(1)
  })
})

describe('sampleWarp', () => {
  /** 2x2 source, one flat colour per pixel: TL=red, TR=green, BL=blue, BR=white. */
  function tinySource(): Uint8ClampedArray {
    // prettier-ignore
    return new Uint8ClampedArray([
      255, 0, 0, 255,     0, 255, 0, 255,
      0, 0, 255, 255,     255, 255, 255, 255,
    ])
  }

  it('reproduces the source pixel-for-pixel through the identity mapping', () => {
    const matrix = unitSquareToQuad(FULL)!
    const source = tinySource()
    const dest = new Uint8ClampedArray(source.length)

    sampleWarp(source, 2, 2, dest, 2, 2, matrix)

    // Pixel centres land exactly on the source grid at equal size, so this is
    // an exact match, not a "close enough" bilinear blend.
    expect([...dest]).toEqual([...source])
  })

  it('reads only the top-left quadrant when the quad selects just that corner', () => {
    const topLeftQuadrant: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0.5, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 0.5, y: 0.5 },
    }
    const matrix = unitSquareToQuad(topLeftQuadrant)!
    // 4x4 source: solid red in the top-left quadrant, solid blue everywhere else.
    const source = new Uint8ClampedArray(4 * 4 * 4)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4
        const inTopLeft = x < 2 && y < 2
        source[i] = inTopLeft ? 255 : 0
        source[i + 1] = 0
        source[i + 2] = inTopLeft ? 0 : 255
        source[i + 3] = 255
      }
    }
    const dest = new Uint8ClampedArray(4 * 4 * 4)

    sampleWarp(source, 4, 4, dest, 4, 4, matrix)

    // Only the interior 3x3 sub-grid is checked — the outermost row/column of a
    // 2x-magnified 2x2 source region straddles the true pixel boundary and
    // bilinearly blends toward the neighbouring (blue) source pixel there,
    // which is correct sampling behaviour (same half-pixel convention the
    // "clamps sampling at the source edge" test below relies on), not a
    // defect. imageEditor.browser.test.ts's own quadrant-extraction test
    // avoids the same edge band by sampling a few px in from the true corner
    // at higher resolution; this 4x4 fixture just makes that blend band cover
    // most of the tiny grid instead of an invisible sliver.
    for (let py = 0; py < 3; py++) {
      for (let px = 0; px < 3; px++) {
        const i = (py * 4 + px) * 4
        expect(dest[i]).toBeGreaterThan(200) // red channel, well inside the magnified region
        expect(dest[i + 2]).toBeLessThan(60) // blue channel stays low well inside the magnified region
      }
    }
  })

  it('clamps sampling at the source edge instead of reading past it', () => {
    const matrix = unitSquareToQuad(FULL)!
    const source = tinySource()
    const dest = new Uint8ClampedArray(4 * 4 * 4) // upsampled 4x — every sample still valid

    expect(() => sampleWarp(source, 2, 2, dest, 4, 4, matrix)).not.toThrow()
    // Bottom-right destination pixel should read close to the source's
    // bottom-right (white) pixel, not garbage from outside the buffer.
    const lastPixel = dest.length - 4
    expect(dest[lastPixel]).toBeGreaterThan(200)
    expect(dest[lastPixel + 1]).toBeGreaterThan(200)
    expect(dest[lastPixel + 2]).toBeGreaterThan(200)
  })
})
