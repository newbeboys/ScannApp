/**
 * Pure geometry for the full-screen page viewer: pinch zoom, panning limits,
 * and the swipe that moves between pages.
 *
 * None of it touches the DOM on purpose. The viewer owns pointer events and
 * layout, but every number it puts into a transform comes from here, so the
 * parts that are easy to get subtly wrong — a focal point that drifts, a pan
 * that lets the page slide off screen, a swipe that skips two pages — are
 * covered by node tests instead of by looking at a phone.
 */

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** Scale plus the translation applied *after* it, in CSS pixels. */
export interface ZoomState {
  scale: number
  x: number
  y: number
}

export const MIN_SCALE = 1
export const MAX_SCALE = 4
/** Where a double tap lands. Close enough to read small print, far enough to feel like a jump. */
export const DOUBLE_TAP_SCALE = 2.5

export const RESET_ZOOM: ZoomState = { scale: 1, x: 0, y: 0 }

/** How far a page must be dragged, as a share of its width, before it changes. */
const SWIPE_THRESHOLD_RATIO = 0.2
/** A flick this fast changes the page even if it never crossed the threshold. */
const SWIPE_VELOCITY_PX_PER_MS = 0.5
/** How much of a drag survives past the first/last page. */
const OVERSCROLL_RESISTANCE = 0.32

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Half of how much the scaled page overflows its frame — i.e. the furthest it
 * may be translated in either direction before an edge pulls into view.
 *
 * At scale 1 the page is exactly its frame, so the limit is zero and the page
 * cannot be nudged at all. That is what keeps an un-zoomed page from drifting.
 */
export function panLimit(frame: Size, scale: number): Size {
  const factor = Math.max(0, scale - 1) / 2
  return { width: frame.width * factor, height: frame.height * factor }
}

/** Pulls a translation back inside `panLimit`, leaving the scale alone. */
export function clampPan(state: ZoomState, frame: Size): ZoomState {
  const limit = panLimit(frame, state.scale)
  return {
    scale: state.scale,
    x: Math.min(limit.width, Math.max(-limit.width, state.x)),
    y: Math.min(limit.height, Math.max(-limit.height, state.y)),
  }
}

/**
 * Zooms to `nextScale` while keeping whatever is under `focal` under it.
 *
 * `focal` is in frame coordinates with the origin at the frame's centre, which
 * is where a CSS transform's origin sits by default — so a pinch centred on a
 * signature keeps that signature under the fingers instead of sliding the page
 * out from under them.
 */
export function zoomAround(
  state: ZoomState,
  focal: Point,
  nextScale: number,
  frame: Size,
): ZoomState {
  const scale = clampScale(nextScale)
  const ratio = scale / state.scale

  return clampPan(
    {
      scale,
      x: focal.x - (focal.x - state.x) * ratio,
      y: focal.y - (focal.y - state.y) * ratio,
    },
    frame,
  )
}

/**
 * How far the page strip should actually follow a horizontal drag.
 *
 * Dragging past the first or last page keeps moving, but only a third as far.
 * A hard stop reads as a frozen screen; the rubber band says "there is nothing
 * over here" without pretending the touch was ignored.
 */
export function swipeOffset(dx: number, index: number, pageCount: number): number {
  const pastStart = index === 0 && dx > 0
  const pastEnd = index === pageCount - 1 && dx < 0
  return pastStart || pastEnd ? dx * OVERSCROLL_RESISTANCE : dx
}

/**
 * Which page a finished drag lands on.
 *
 * Distance alone is not enough: a quick flick barely covers ground but clearly
 * means "next page", so speed gets its own path in. Only ever one page at a
 * time — a long drag is still one page, because the strip only ever renders
 * the neighbours and skipping to page 7 would land on an empty slide.
 */
export function swipeTarget(
  index: number,
  dx: number,
  width: number,
  pageCount: number,
  durationMs = 0,
): number {
  const threshold = width * SWIPE_THRESHOLD_RATIO
  const velocity = durationMs > 0 ? Math.abs(dx) / durationMs : 0
  const decisive = Math.abs(dx) > threshold || velocity > SWIPE_VELOCITY_PX_PER_MS

  if (!decisive || dx === 0) return index

  const target = dx < 0 ? index + 1 : index - 1
  return Math.min(pageCount - 1, Math.max(0, target))
}

/**
 * Which pages are worth having in the DOM around `index`.
 *
 * A scanned page is a 12 MP JPEG; decoded, a handful of them is hundreds of
 * megabytes. Only the page on screen and its two neighbours are rendered, so
 * a swipe always has its destination ready without the document's page count
 * deciding how much memory the viewer costs.
 */
export function isPageMounted(index: number, current: number): boolean {
  return Math.abs(index - current) <= 1
}
