import { describe, expect, it } from 'vitest'
import {
  defaultSignatureBox,
  HIGHLIGHTER_WIDTH_FACTOR,
  INK_COLORS,
  INK_WIDTHS,
  MIN_SIGNATURE_WIDTH,
  moveSignature,
  remapMarksForCrop,
  remapMarksForRotation,
  sanitizeMarks,
  resizeSignature,
  signatureAt,
  simplifyStroke,
  strokeWidth,
  type InkStroke,
  type Mark,
  type SignatureStamp,
} from './annotations'

function stroke(points: number[], overrides: Partial<InkStroke> = {}): InkStroke {
  return { kind: 'ink', tool: 'pen', color: '#1b2740', width: 0.004, points, ...overrides }
}

function signature(overrides: Partial<SignatureStamp> = {}): SignatureStamp {
  return {
    kind: 'signature',
    source: 'scans/signature-1.png',
    x: 0.5,
    y: 0.6,
    width: 0.3,
    height: 0.1,
    ...overrides,
  }
}

describe('ink presets', () => {
  it('uses only colours that already exist elsewhere in the app', () => {
    // CLAUDE.md 9.2: no new palette entries without Boss Ali. Each of these is
    // --fg, the primary, the danger red, and --pro-gold respectively.
    expect(INK_COLORS.map((entry) => entry.value)).toEqual([
      '#1b2740',
      '#2563eb',
      '#e5484d',
      '#f5c443',
    ])
  })

  it('orders the nib sizes from thin to thick', () => {
    expect(INK_WIDTHS.thin).toBeLessThan(INK_WIDTHS.medium)
    expect(INK_WIDTHS.medium).toBeLessThan(INK_WIDTHS.thick)
  })

  it('draws a highlighter far wider than a pen of the same nominal size', () => {
    const pen = stroke([0, 0, 1, 1])
    const marker = stroke([0, 0, 1, 1], { tool: 'highlighter' })

    expect(strokeWidth(pen)).toBe(0.004)
    expect(strokeWidth(marker)).toBeCloseTo(0.004 * HIGHLIGHTER_WIDTH_FACTOR, 10)
  })
})

describe('sanitizeMarks', () => {
  it('keeps a well-formed stroke and a well-formed signature', () => {
    const marks: Mark[] = [stroke([0.1, 0.1, 0.2, 0.2]), signature()]
    expect(sanitizeMarks(marks)).toEqual(marks)
  })

  it('returns nothing for a value that is not an array', () => {
    expect(sanitizeMarks(null)).toEqual([])
    expect(sanitizeMarks({ kind: 'ink' })).toEqual([])
  })

  it('drops a stroke with an odd number of coordinates', () => {
    // Half a point lost in a truncated write. Kept, the trailing x would be
    // read as a y and bend every point after it.
    expect(sanitizeMarks([stroke([0.1, 0.1, 0.2])])).toEqual([])
  })

  it('drops a stroke with fewer than two points', () => {
    expect(sanitizeMarks([stroke([0.1, 0.1])])).toEqual([])
  })

  it('drops a stroke carrying a coordinate that is not a finite number', () => {
    expect(sanitizeMarks([stroke([0.1, 0.1, Number.NaN, 0.4])])).toEqual([])
    expect(sanitizeMarks([{ ...stroke([0, 0, 1, 1]), points: [0, 0, '1', 1] }])).toEqual([])
  })

  it('drops a stroke with an unknown tool', () => {
    expect(sanitizeMarks([{ ...stroke([0, 0, 1, 1]), tool: 'airbrush' }])).toEqual([])
  })

  it('drops a signature with no source file', () => {
    expect(sanitizeMarks([signature({ source: '' })])).toEqual([])
  })

  it('drops a signature with no area, which would render as nothing', () => {
    expect(sanitizeMarks([signature({ width: 0 })])).toEqual([])
    expect(sanitizeMarks([signature({ height: -0.2 })])).toEqual([])
  })

  it('keeps the good marks in a list that also holds bad ones', () => {
    const good = stroke([0.1, 0.1, 0.9, 0.9])
    expect(sanitizeMarks([{ kind: 'ink' }, good, null, signature({ width: 0 })])).toEqual([good])
  })
})

describe('remapMarksForCrop', () => {
  const HALF: Mark[] = [stroke([0.5, 0.5, 0.75, 0.75])]

  it('moves a stroke with the page', () => {
    // Cropping to the bottom-right quarter puts the page's centre at the new
    // top-left corner.
    const [moved] = remapMarksForCrop(HALF, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 })

    expect((moved as InkStroke).points).toEqual([0, 0, 0.5, 0.5])
  })

  it('thickens the stroke by as much as the crop magnified the page', () => {
    const [moved] = remapMarksForCrop(HALF, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 })

    // Half the page is rendered at the same output size, so what was 0.004 of
    // the old page has to become 0.008 of the new one to look unchanged.
    expect((moved as InkStroke).width).toBeCloseTo(0.008, 10)
  })

  it('drops a stroke that was entirely on the part that was cut away', () => {
    const marks: Mark[] = [stroke([0.05, 0.05, 0.1, 0.1])]

    expect(remapMarksForCrop(marks, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 })).toEqual([])
  })

  it('keeps a stroke that only partly survives the crop', () => {
    const marks: Mark[] = [stroke([0.1, 0.1, 0.6, 0.6])]

    expect(remapMarksForCrop(marks, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 })).toHaveLength(1)
  })

  it('moves and rescales a signature box', () => {
    const [moved] = remapMarksForCrop(
      [signature({ x: 0.5, y: 0.5, width: 0.25, height: 0.1 })],
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ) as SignatureStamp[]

    expect(moved.x).toBeCloseTo(0, 10)
    expect(moved.y).toBeCloseTo(0, 10)
    expect(moved.width).toBeCloseTo(0.5, 10)
    expect(moved.height).toBeCloseTo(0.2, 10)
  })

  it('drops a signature that fell outside the crop entirely', () => {
    const marks = [signature({ x: 0.05, y: 0.05, width: 0.1, height: 0.1 })]

    expect(remapMarksForCrop(marks, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 })).toEqual([])
  })

  it('survives a crop of zero size without dividing by zero', () => {
    const result = remapMarksForCrop(HALF, { x: 0, y: 0, width: 0, height: 0 })

    for (const value of (result[0] as InkStroke)?.points ?? []) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})

describe('remapMarksForRotation', () => {
  it('turns a point a quarter turn clockwise', () => {
    // The top-left corner of the page becomes the top-right corner.
    const [turned] = remapMarksForRotation([stroke([0, 0, 1, 1])], 90) as InkStroke[]

    expect(turned.points[0]).toBeCloseTo(1, 10)
    expect(turned.points[1]).toBeCloseTo(0, 10)
    expect(turned.points[2]).toBeCloseTo(0, 10)
    expect(turned.points[3]).toBeCloseTo(1, 10)
  })

  it('four quarter turns bring a stroke back where it started', () => {
    const original = stroke([0.2, 0.35, 0.7, 0.9])
    let marks: Mark[] = [original]
    for (let turn = 0; turn < 4; turn++) marks = remapMarksForRotation(marks, 90)

    for (const [index, value] of (marks[0] as InkStroke).points.entries()) {
      expect(value).toBeCloseTo(original.points[index], 10)
    }
  })

  it('leaves stroke width alone — a rotation changes no scale', () => {
    const [turned] = remapMarksForRotation([stroke([0, 0, 1, 1])], 90) as InkStroke[]

    expect(turned.width).toBe(0.004)
  })

  it('swaps a signature box width and height on a quarter turn', () => {
    const [turned] = remapMarksForRotation(
      [signature({ x: 0.1, y: 0.2, width: 0.4, height: 0.1 })],
      90,
    ) as SignatureStamp[]

    expect(turned.width).toBeCloseTo(0.1, 10)
    expect(turned.height).toBeCloseTo(0.4, 10)
  })

  it('keeps a signature box on the page through a quarter turn', () => {
    const [turned] = remapMarksForRotation(
      [signature({ x: 0.6, y: 0.8, width: 0.3, height: 0.1 })],
      90,
    ) as SignatureStamp[]

    expect(turned.x).toBeGreaterThanOrEqual(0)
    expect(turned.y).toBeGreaterThanOrEqual(0)
    expect(turned.x + turned.width).toBeLessThanOrEqual(1.0000001)
    expect(turned.y + turned.height).toBeLessThanOrEqual(1.0000001)
  })

  it('four quarter turns bring a signature back where it started', () => {
    const original = signature({ x: 0.15, y: 0.25, width: 0.4, height: 0.2 })
    let marks: Mark[] = [original]
    for (let turn = 0; turn < 4; turn++) marks = remapMarksForRotation(marks, 90)

    const back = marks[0] as SignatureStamp
    expect(back.x).toBeCloseTo(original.x, 10)
    expect(back.y).toBeCloseTo(original.y, 10)
    expect(back.width).toBeCloseTo(original.width, 10)
    expect(back.height).toBeCloseTo(original.height, 10)
  })

  it('a half turn is the same as two quarter turns', () => {
    const marks: Mark[] = [stroke([0.2, 0.35, 0.7, 0.9])]
    const half = remapMarksForRotation(marks, 180)
    const twice = remapMarksForRotation(remapMarksForRotation(marks, 90), 90)

    for (const [index, value] of (half[0] as InkStroke).points.entries()) {
      expect(value).toBeCloseTo((twice[0] as InkStroke).points[index], 10)
    }
  })
})

describe('simplifyStroke', () => {
  it('leaves a two-point stroke alone', () => {
    expect(simplifyStroke([0, 0, 1, 1])).toEqual([0, 0, 1, 1])
  })

  it('drops points too close together to be seen', () => {
    // A finger fires a pointer event per frame; a flourish arrives as hundreds
    // of points a fraction of a millimetre apart, all of which land in the
    // index and get redrawn on every re-render.
    const dense: number[] = []
    for (let i = 0; i <= 100; i++) dense.push(i / 100, 0)

    const simplified = simplifyStroke(dense, 0.05)

    expect(simplified.length).toBeLessThan(dense.length / 2)
  })

  it('always keeps the first and last point, so a stroke never loses its ends', () => {
    const dense: number[] = []
    for (let i = 0; i <= 100; i++) dense.push(i / 100, 0)

    const simplified = simplifyStroke(dense, 0.5)

    expect(simplified.slice(0, 2)).toEqual([0, 0])
    expect(simplified.slice(-2)).toEqual([1, 0])
  })

  it('keeps every point of a stroke drawn in big steps', () => {
    const spread = [0, 0, 0.3, 0.3, 0.6, 0.6, 0.9, 0.9]

    expect(simplifyStroke(spread, 0.01)).toEqual(spread)
  })
})

describe('defaultSignatureBox', () => {
  it('drops the signature near the bottom right, where one goes on paper', () => {
    const box = defaultSignatureBox(3, 1 / Math.SQRT2)

    expect(box.x + box.width).toBeLessThan(1)
    expect(box.x + box.width).toBeGreaterThan(0.8)
    expect(box.y + box.height).toBeLessThan(1)
    expect(box.y + box.height).toBeGreaterThan(0.7)
  })

  it('never squashes the signature', () => {
    // The box is in page fractions, so its ratio is not the signature's own:
    // rendered pixels are fw*W by fh*H, and those have to come out at 3:1.
    // fw/fh therefore has to be 3 divided by the page's own aspect ratio —
    // a wider box on a portrait page than the signature itself is.
    const pageAspect = 1 / Math.SQRT2
    const box = defaultSignatureBox(3, pageAspect)

    expect(box.width / box.height).toBeCloseTo(3 / pageAspect, 6)
    // The proof of the same thing in pixels, on a 1240x1754 A4 render.
    // 1240x1754 is A4 at 150dpi, a hair off the exact ratio, hence 2 places.
    expect((box.width * 1240) / (box.height * 1754)).toBeCloseTo(3, 2)
  })

  it('keeps a very tall signature on the page', () => {
    const box = defaultSignatureBox(0.4, 1 / Math.SQRT2)

    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeLessThan(1)
  })
})

describe('signatureAt', () => {
  const stamp = signature({ x: 0.4, y: 0.4, width: 0.2, height: 0.1 })

  it('finds a stamp under the point', () => {
    expect(signatureAt([stamp], 0.5, 0.45)).toBe(0)
  })

  it('reports nothing for a point on bare paper', () => {
    expect(signatureAt([stamp], 0.1, 0.1)).toBe(-1)
  })

  it('ignores ink strokes, which are not draggable', () => {
    expect(signatureAt([stroke([0.4, 0.4, 0.6, 0.5])], 0.5, 0.45)).toBe(-1)
  })

  /** Later stamps are drawn over earlier ones, so the top one is the target. */
  it('picks the stamp on top when two overlap', () => {
    const under = signature({ x: 0.4, y: 0.4, width: 0.3, height: 0.2 })
    const over = signature({ x: 0.45, y: 0.42, width: 0.2, height: 0.1 })

    expect(signatureAt([under, over], 0.5, 0.45)).toBe(1)
  })

  it('counts the edges of the box as inside it', () => {
    expect(signatureAt([stamp], 0.4, 0.4)).toBe(0)
    expect(signatureAt([stamp], 0.6, 0.5)).toBe(0)
  })
})

describe('moveSignature', () => {
  const stamp = signature({ x: 0.4, y: 0.4, width: 0.2, height: 0.1 })

  it('slides the stamp by the drag', () => {
    const moved = moveSignature(stamp, 0.1, -0.2)

    expect(moved.x).toBeCloseTo(0.5, 10)
    expect(moved.y).toBeCloseTo(0.2, 10)
  })

  it('leaves the size alone', () => {
    const moved = moveSignature(stamp, 0.1, 0.1)

    expect(moved.width).toBe(0.2)
    expect(moved.height).toBe(0.1)
  })

  it('never lets the stamp be dragged off the page entirely', () => {
    const off = moveSignature(stamp, -5, -5)

    // Half may hang over the edge — signing across a margin is normal — but
    // half stays on the page, or there is nothing left to grab.
    expect(off.x + off.width).toBeGreaterThan(0)
    expect(off.y + off.height).toBeGreaterThan(0)

    const far = moveSignature(stamp, 5, 5)
    expect(far.x).toBeLessThan(1)
    expect(far.y).toBeLessThan(1)
  })
})

describe('resizeSignature', () => {
  const stamp = signature({ x: 0.2, y: 0.2, width: 0.3, height: 0.1 })

  it('keeps the proportions, so a signature is never stretched', () => {
    const bigger = resizeSignature(stamp, 0.6)

    expect(bigger.width / bigger.height).toBeCloseTo(3, 10)
  })

  it('grows from the top-left corner, which stays put', () => {
    const bigger = resizeSignature(stamp, 0.5)

    expect(bigger.x).toBe(0.2)
    expect(bigger.y).toBe(0.2)
  })

  it('refuses to shrink a signature into a smudge', () => {
    expect(resizeSignature(stamp, 0.001).width).toBe(MIN_SIGNATURE_WIDTH)
  })

  it('stops growing at the right edge of the page', () => {
    expect(resizeSignature(stamp, 5).width).toBeCloseTo(0.8, 10)
  })
})
