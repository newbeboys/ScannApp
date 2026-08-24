import { describe, expect, it } from 'vitest'
import {
  clampPan,
  clampScale,
  distance,
  DOUBLE_TAP_SCALE,
  isPageMounted,
  MAX_SCALE,
  midpoint,
  MIN_SCALE,
  panLimit,
  swipeOffset,
  swipeTarget,
  zoomAround,
} from './pageViewer'

const FRAME = { width: 360, height: 500 }

describe('clampScale', () => {
  it('keeps a scale that is already in range', () => {
    expect(clampScale(2.4)).toBe(2.4)
  })

  it('never zooms out past the page fitting its frame', () => {
    expect(clampScale(0.4)).toBe(MIN_SCALE)
  })

  it('stops at the maximum zoom', () => {
    expect(clampScale(99)).toBe(MAX_SCALE)
  })

  it('falls back to fit for a value that is not a real number', () => {
    // Both come out of the same division: a pinch whose two fingers land on
    // the same pixel starts from a gap of zero. Fit is the safe landing —
    // clamping to MAX instead would slam the page to 4x on a stray touch.
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE)
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MIN_SCALE)
  })

  it('has a double-tap scale inside the allowed range', () => {
    expect(clampScale(DOUBLE_TAP_SCALE)).toBe(DOUBLE_TAP_SCALE)
  })
})

describe('distance & midpoint', () => {
  it('measures the gap between two fingers', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })

  it('finds the point between two fingers', () => {
    expect(midpoint({ x: 0, y: 10 }, { x: 20, y: 30 })).toEqual({ x: 10, y: 20 })
  })
})

describe('panLimit', () => {
  it('is zero at fit scale, so an un-zoomed page cannot be dragged off centre', () => {
    expect(panLimit(FRAME, 1)).toEqual({ width: 0, height: 0 })
  })

  it('grows with half the overflow', () => {
    // At 2x the page is twice its frame; half of the extra frame-width hangs
    // off each side.
    expect(panLimit(FRAME, 2)).toEqual({ width: 180, height: 250 })
  })

  it('never returns a negative limit for a scale below fit', () => {
    expect(panLimit(FRAME, 0.5)).toEqual({ width: 0, height: 0 })
  })
})

describe('clampPan', () => {
  it('leaves a translation that keeps the page covering the frame', () => {
    expect(clampPan({ scale: 2, x: 50, y: -80 }, FRAME)).toEqual({ scale: 2, x: 50, y: -80 })
  })

  it('stops the page before an edge pulls into view', () => {
    expect(clampPan({ scale: 2, x: 999, y: -999 }, FRAME)).toEqual({
      scale: 2,
      x: 180,
      y: -250,
    })
  })

  it('re-centres a page that is no longer zoomed', () => {
    expect(clampPan({ scale: 1, x: 120, y: 90 }, FRAME)).toEqual({ scale: 1, x: 0, y: 0 })
  })
})

describe('zoomAround', () => {
  it('zooming on the centre keeps the page centred', () => {
    expect(zoomAround({ scale: 1, x: 0, y: 0 }, { x: 0, y: 0 }, 2, FRAME)).toEqual({
      scale: 2,
      x: 0,
      y: 0,
    })
  })

  it('keeps the pinched point under the fingers', () => {
    const frame = { width: 400, height: 400 }
    const focal = { x: 100, y: 50 }
    const next = zoomAround({ scale: 1, x: 0, y: 0 }, focal, 2, frame)

    // The content point under `focal` before the zoom is (focal - x) / scale.
    // After it, that same content point must land back on `focal`.
    const contentPoint = { x: (focal.x - 0) / 1, y: (focal.y - 0) / 1 }
    expect(contentPoint.x * next.scale + next.x).toBeCloseTo(focal.x, 6)
    expect(contentPoint.y * next.scale + next.y).toBeCloseTo(focal.y, 6)
  })

  it('zooming back out to fit re-centres the page', () => {
    const zoomed = zoomAround({ scale: 1, x: 0, y: 0 }, { x: 150, y: 200 }, 3, FRAME)
    const out = zoomAround(zoomed, { x: 150, y: 200 }, 1, FRAME)

    expect(out).toEqual({ scale: 1, x: 0, y: 0 })
  })

  it('clamps the result, so a pinch near the edge cannot expose the background', () => {
    const state = zoomAround({ scale: 1, x: 0, y: 0 }, { x: 180, y: 250 }, 2, FRAME)
    const limit = panLimit(FRAME, state.scale)

    expect(Math.abs(state.x)).toBeLessThanOrEqual(limit.width)
    expect(Math.abs(state.y)).toBeLessThanOrEqual(limit.height)
  })

  it('refuses to zoom past the maximum however hard the pinch', () => {
    expect(zoomAround({ scale: 3, x: 0, y: 0 }, { x: 0, y: 0 }, 12, FRAME).scale).toBe(MAX_SCALE)
  })
})

describe('swipeOffset', () => {
  it('follows the finger between pages', () => {
    expect(swipeOffset(-90, 1, 5)).toBe(-90)
  })

  it('resists dragging back from the first page', () => {
    expect(swipeOffset(100, 0, 5)).toBeCloseTo(32, 6)
  })

  it('resists dragging forward from the last page', () => {
    expect(swipeOffset(-100, 4, 5)).toBeCloseTo(-32, 6)
  })

  it('does not resist dragging away from an edge', () => {
    expect(swipeOffset(-100, 0, 5)).toBe(-100)
    expect(swipeOffset(100, 4, 5)).toBe(100)
  })
})

describe('swipeTarget', () => {
  const WIDTH = 360

  it('stays put when the drag is too small to mean anything', () => {
    expect(swipeTarget(2, -30, WIDTH, 5, 400)).toBe(2)
  })

  it('advances when the drag passes the threshold', () => {
    expect(swipeTarget(2, -100, WIDTH, 5, 400)).toBe(3)
  })

  it('goes back when the drag passes the threshold the other way', () => {
    expect(swipeTarget(2, 100, WIDTH, 5, 400)).toBe(1)
  })

  it('accepts a short but fast flick', () => {
    // 40px in 50ms: well under the distance threshold, unmistakably a flick.
    expect(swipeTarget(2, -40, WIDTH, 5, 50)).toBe(3)
  })

  it('rejects the same distance dragged slowly', () => {
    expect(swipeTarget(2, -40, WIDTH, 5, 2000)).toBe(2)
  })

  it('never skips a page, however far the drag went', () => {
    // The strip only ever mounts the neighbours; landing on page 6 would show
    // an empty slide.
    expect(swipeTarget(2, -2000, WIDTH, 8, 300)).toBe(3)
  })

  it('cannot leave the document at either end', () => {
    expect(swipeTarget(0, 300, WIDTH, 5, 300)).toBe(0)
    expect(swipeTarget(4, -300, WIDTH, 5, 300)).toBe(4)
  })

  it('treats a drag with no measured duration on distance alone', () => {
    expect(swipeTarget(1, -100, WIDTH, 5)).toBe(2)
    expect(swipeTarget(1, -10, WIDTH, 5)).toBe(1)
  })
})

describe('isPageMounted', () => {
  it('keeps the page on screen and both neighbours', () => {
    expect(isPageMounted(4, 5)).toBe(true)
    expect(isPageMounted(5, 5)).toBe(true)
    expect(isPageMounted(6, 5)).toBe(true)
  })

  it('drops everything else, so a 40-page document costs the same as a 3-page one', () => {
    expect(isPageMounted(3, 5)).toBe(false)
    expect(isPageMounted(7, 5)).toBe(false)
    expect(isPageMounted(39, 5)).toBe(false)
  })
})
