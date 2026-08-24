import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from '../components/Icons'
import { usePageDisplayUri } from '../lib/usePageDisplayUri'
import {
  clampPan,
  distance,
  DOUBLE_TAP_SCALE,
  isPageMounted,
  midpoint,
  MIN_SCALE,
  RESET_ZOOM,
  swipeOffset,
  swipeTarget,
  zoomAround,
  type Point,
  type Size,
  type ZoomState,
} from '../lib/pageViewer'

interface PageViewerScreenProps {
  title: string
  /** One entry per page: a stored path, or a scanner URI when `raw`. */
  sources: string[]
  raw?: boolean
  initialIndex?: number
  /** Reports the page the reader moved to, so the screen behind can follow. */
  onPageChange?: (index: number) => void
  onClose: () => void
  /** Optional buttons for the bottom bar — "Edit" and "Ekspor" on a saved document. */
  actions?: ReactNode
}

/** A finger that has not travelled this far has tapped, not dragged. */
const TAP_SLOP_PX = 8
/** Two taps closer together than this, in time and in space, are a double tap. */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP_PX = 40
/** Below this the pinch has effectively returned to fit; snap the rest of the way. */
const FIT_EPSILON = 0.02

/** Which fingers are down and what they are doing. */
type Gesture =
  | {
      kind: 'swipe'
      startX: number
      startY: number
      startedAt: number
      moved: boolean
      axis: 'none' | 'x' | 'y'
    }
  | { kind: 'pan'; startX: number; startY: number; from: ZoomState; moved: boolean }
  | { kind: 'pinch'; startGap: number; focal: Point; from: ZoomState; frame: Size }

/**
 * Full-screen page preview: the thing a scanner app is for.
 *
 * Gestures are handled here rather than left to a scroll-snap container. A
 * native scroller gives free momentum but it also owns the touch, and a zoomed
 * page has to take single-finger drags back from it — the two end up fighting
 * over every gesture. Driving one transform ourselves means the page under the
 * finger is always the one being moved, and every number involved comes from
 * `lib/pageViewer`, which is tested on its own.
 */
export function PageViewerScreen({
  title,
  sources,
  raw = false,
  initialIndex = 0,
  onPageChange,
  onClose,
  actions,
}: PageViewerScreenProps) {
  const pageCount = sources.length
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), pageCount - 1))
  const [drag, setDrag] = useState(0)
  const [zoom, setZoom] = useState<ZoomState>(RESET_ZOOM)
  /** Bars hide on a tap so the page can be looked at, not framed. */
  const [chromeVisible, setChromeVisible] = useState(true)
  /**
   * Whether a finger is currently driving the page.
   *
   * Only used to decide whether the transform may animate. A double tap should
   * glide into its zoom; a pinch must not, because a transition would make the
   * page chase the fingers a beat behind them.
   */
  const [isTouching, setIsTouching] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLImageElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture | null>(null)
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null)
  /**
   * The zoom as the pointer handlers see it. They run between renders — a
   * pinch fires dozens of moves per second — so reading `zoom` out of the
   * closure would work from whatever value the last render happened to catch.
   */
  const zoomRef = useRef(zoom)

  const applyZoom = useCallback((next: ZoomState) => {
    zoomRef.current = next
    setZoom(next)
  }, [])

  const goTo = useCallback(
    (target: number) => {
      const next = Math.min(Math.max(target, 0), pageCount - 1)
      setIndex(next)
      applyZoom(RESET_ZOOM)
      onPageChange?.(next)
    },
    [applyZoom, onPageChange, pageCount],
  )

  // Escape closes, arrows page. Android has no keyboard, but `npm run dev` is
  // where this screen gets exercised most and it costs three lines.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') goTo(index + 1)
      if (event.key === 'ArrowLeft') goTo(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, index, onClose])

  // Keeps the page strip pointed at where the reader actually is. Swiping to
  // page 20 of a 30-page document otherwise leaves the strip showing 1–8, so
  // it stops being a map of the document and starts being a lie about it.
  useEffect(() => {
    stripRef.current
      ?.querySelector('.viewer__page-dot--active')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [index])

  /**
   * Where the current page sits when nothing is zoomed, in screen pixels.
   *
   * `getBoundingClientRect` reports the box *after* the transform, so both the
   * scale and the translation are divided back out. Everything the zoom maths
   * takes — the frame the page must stay inside, and a focal point measured
   * from that frame's centre — is expressed against this untransformed box.
   */
  const measure = useCallback((): { center: Point; size: Size } | null => {
    const el = frameRef.current
    if (!el) return null

    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null

    const { scale, x, y } = zoomRef.current
    return {
      center: { x: rect.left + rect.width / 2 - x, y: rect.top + rect.height / 2 - y },
      size: { width: rect.width / scale, height: rect.height / scale },
    }
  }, [])

  const handleTap = (clientX: number, clientY: number) => {
    const now = performance.now()
    const previous = lastTap.current
    lastTap.current = { at: now, x: clientX, y: clientY }

    // Toggled on every tap, including both halves of a double tap — which
    // leaves the bars exactly where they started. That is why no timer is
    // needed here to tell one tap from two.
    setChromeVisible((visible) => !visible)

    const isDoubleTap =
      previous !== null &&
      now - previous.at < DOUBLE_TAP_MS &&
      distance({ x: clientX, y: clientY }, previous) < DOUBLE_TAP_SLOP_PX

    if (!isDoubleTap) return
    lastTap.current = null

    if (zoomRef.current.scale > MIN_SCALE) {
      applyZoom(RESET_ZOOM)
      return
    }

    const frame = measure()
    if (!frame) return
    applyZoom(
      zoomAround(
        RESET_ZOOM,
        { x: clientX - frame.center.x, y: clientY - frame.center.y },
        DOUBLE_TAP_SCALE,
        frame.size,
      ),
    )
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current
    if (!stage) return

    /*
      The paging arrows live inside the stage, over the page. Capturing the
      pointer for them would retarget the pointerup to the stage, so no click
      would ever reach the button — and the gesture would be read as a tap,
      hiding the very control the user had just pressed.
    */
    if (event.target instanceof Element && event.target.closest('button')) return

    stage.setPointerCapture(event.pointerId)
    setIsTouching(true)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const frame = measure()

      // No laid-out page to pinch against — a 12 MP JPEG still decoding. The
      // swipe started by the first finger has to be dropped along with it:
      // left in place it would keep reading `dx` from whichever of the two
      // fingers moved last, shaking the strip and turning the page on release
      // even though the user only ever pinched.
      if (!frame) {
        gesture.current = null
        setDrag(0)
        return
      }

      const centre = midpoint(a, b)
      gesture.current = {
        kind: 'pinch',
        // Guarded: two fingers landing on the same pixel would otherwise make
        // every later ratio a division by zero.
        startGap: Math.max(distance(a, b), 1),
        focal: { x: centre.x - frame.center.x, y: centre.y - frame.center.y },
        from: zoomRef.current,
        frame: frame.size,
      }
      // A pinch that began mid-swipe must not leave the strip half-shifted.
      setDrag(0)
      return
    }

    if (pointers.current.size > 2) return

    gesture.current =
      zoomRef.current.scale > MIN_SCALE
        ? {
            kind: 'pan',
            startX: event.clientX,
            startY: event.clientY,
            from: zoomRef.current,
            moved: false,
          }
        : {
            kind: 'swipe',
            startX: event.clientX,
            startY: event.clientY,
            startedAt: performance.now(),
            moved: false,
            axis: 'none',
          }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    const active = gesture.current
    if (!active) return

    if (active.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()]
      if (!a || !b) return
      applyZoom(
        zoomAround(
          active.from,
          active.focal,
          (active.from.scale * distance(a, b)) / active.startGap,
          active.frame,
        ),
      )
      return
    }

    if (active.kind === 'pan') {
      const frame = measure()
      if (!frame) return

      const dragX = event.clientX - active.startX
      const dragY = event.clientY - active.startY
      if (!active.moved && Math.hypot(dragX, dragY) > TAP_SLOP_PX) active.moved = true

      applyZoom(
        clampPan(
          { scale: active.from.scale, x: active.from.x + dragX, y: active.from.y + dragY },
          frame.size,
        ),
      )
      return
    }

    const dx = event.clientX - active.startX
    const dy = event.clientY - active.startY
    if (!active.moved && Math.hypot(dx, dy) > TAP_SLOP_PX) active.moved = true

    // The axis is decided once and then held. Without the lock a diagonal drag
    // would swing the strip sideways every time the finger wandered past 45
    // degrees, which reads as the page shivering.
    if (active.moved && active.axis === 'none') {
      active.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (active.axis !== 'x') return

    setDrag(swipeOffset(dx, index, pageCount))
  }

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current

    // A pointer that never started a gesture — one that landed on a paging
    // arrow — must not end someone else's. Without this, pressing an arrow
    // with one hand while the other is mid-swipe finishes that swipe using the
    // *button's* coordinates, and the document jumps to whichever page the
    // arithmetic happens to land on.
    if (!pointers.current.has(event.pointerId)) return

    pointers.current.delete(event.pointerId)
    if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
    if (pointers.current.size === 0) setIsTouching(false)

    const active = gesture.current
    if (!active) return

    if (active.kind === 'pinch') {
      // Only over once both fingers are gone: lifting one and carrying on with
      // the other must not restart as a pan from a stale origin.
      if (pointers.current.size > 0) return
      gesture.current = null
      if (zoomRef.current.scale <= MIN_SCALE + FIT_EPSILON) applyZoom(RESET_ZOOM)
      return
    }

    gesture.current = null

    // A finger that never travelled is a tap, whichever gesture it began as.
    // A zoomed page always starts a pan, so leaving this to the swipe branch
    // alone made double-tap-to-zoom-out unreachable — and with the bars
    // hidden, that left no way back out of the viewer at all.
    if (!active.moved) {
      handleTap(event.clientX, event.clientY)
      setDrag(0)
      return
    }

    if (active.kind === 'pan') return

    if (active.axis === 'x' && stage) {
      const target = swipeTarget(
        index,
        event.clientX - active.startX,
        stage.clientWidth,
        pageCount,
        performance.now() - active.startedAt,
      )
      if (target !== index) goTo(target)
    }
    setDrag(0)
  }

  const isDragging = drag !== 0
  const isZoomed = zoom.scale > MIN_SCALE

  return (
    <div className={`viewer${chromeVisible ? '' : ' viewer--immersive'}`}>
      <header className="viewer__bar viewer__bar--top">
        <button
          type="button"
          className="viewer__icon"
          onClick={onClose}
          aria-label="Tutup pratinjau"
        >
          <CloseIcon size={19} />
        </button>
        <p className="viewer__title">{title}</p>
        <span className="viewer__count">
          {index + 1}/{pageCount}
        </span>
      </header>

      <div
        className="viewer__stage"
        ref={stageRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <div
          className={`viewer__track${isDragging ? ' viewer__track--dragging' : ''}`}
          style={{ transform: `translate3d(calc(${-index * 100}% + ${drag}px), 0, 0)` }}
        >
          {sources.map((source, position) => (
            <div className="viewer__slide" key={`${source}-${position}`}>
              {isPageMounted(position, index) && (
                <ViewerPage
                  source={source}
                  raw={raw}
                  label={`Halaman ${position + 1}`}
                  imageRef={position === index ? frameRef : undefined}
                  zoom={position === index ? zoom : RESET_ZOOM}
                  isSettling={position === index && !isTouching}
                />
              )}
            </div>
          ))}
        </div>

        {/*
          Buttons as well as swipes. A zoomed page takes single-finger drags for
          panning, so without these the only way on to the next page would be to
          zoom back out first.
        */}
        {pageCount > 1 && (
          <>
            <button
              type="button"
              className="viewer__step viewer__step--prev"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              aria-label="Halaman sebelumnya"
            >
              <ChevronLeftIcon size={20} />
            </button>
            <button
              type="button"
              className="viewer__step viewer__step--next"
              onClick={() => goTo(index + 1)}
              disabled={index === pageCount - 1}
              aria-label="Halaman berikutnya"
            >
              <ChevronRightIcon size={20} />
            </button>
          </>
        )}
      </div>

      <footer className="viewer__bar viewer__bar--bottom">
        {pageCount > 1 && (
          <div className="viewer__pages" ref={stripRef}>
            {sources.map((source, position) => (
              <button
                key={`${source}-${position}`}
                type="button"
                className={`viewer__page-dot${
                  position === index ? ' viewer__page-dot--active' : ''
                }`}
                onClick={() => goTo(position)}
                aria-label={`Ke halaman ${position + 1}`}
                aria-current={position === index}
              >
                {position + 1}
              </button>
            ))}
          </div>
        )}
        {actions && <div className="viewer__actions">{actions}</div>}
        <p className="viewer__hint">
          {isZoomed
            ? 'Geser untuk menggeser gambar · ketuk dua kali untuk kembali'
            : 'Cubit atau ketuk dua kali untuk memperbesar'}
        </p>
      </footer>
    </div>
  )
}

interface ViewerPageProps {
  source: string
  raw: boolean
  label: string
  imageRef?: RefObject<HTMLImageElement | null>
  zoom: ZoomState
  /** True when the zoom may animate — i.e. it is not being driven by a finger. */
  isSettling: boolean
}

function ViewerPage({ source, raw, label, imageRef, zoom, isSettling }: ViewerPageProps) {
  const src = usePageDisplayUri(source, raw)

  if (!src) return <div className="viewer__placeholder" aria-label={`${label} sedang dimuat`} />

  return (
    <img
      ref={imageRef}
      className={`viewer__image${isSettling ? ' viewer__image--settling' : ''}`}
      src={src}
      alt={label}
      draggable={false}
      decoding="async"
      style={
        {
          transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`,
        } as CSSProperties
      }
    />
  )
}
