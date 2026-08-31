import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { quadArea, type Point, type Quad } from '../lib/perspective'

type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'

interface QuadOverlayProps {
  quad: Quad
  onChange: (quad: Quad) => void
}

/**
 * Below this fraction of the unit square's area, a corner drag is rejected
 * outright rather than applied. Ten times `perspective.ts`'s own
 * `MIN_QUAD_AREA` (0.001) — a margin the user can actually feel before a drag
 * stops responding, well before the maths itself would ever refuse the quad.
 * Not a "minimum useful size" the way `CropOverlay`'s `MIN_SIZE` is: a small
 * but well-formed quad (picking out one corner of a page) is a legitimate
 * thing to want, same as a small crop.
 */
const MIN_AREA = 0.01

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Four independently draggable corners for a perspective straighten — "Luruskan
 * Halaman" (Fase 7B). Sibling of `CropOverlay`, same normalised 0..1
 * coordinate convention, but a free quadrilateral rather than an
 * axis-aligned rectangle: there is no "move" handle, because there is no
 * single rigid shape here to slide as a whole.
 */
export function QuadOverlay({ quad, onChange }: QuadOverlayProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ corner: Corner; startX: number; startY: number; start: Point } | null>(
    null,
  )

  const beginDrag = (corner: Corner) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { corner, startX: event.clientX, startY: event.clientY, start: quad[corner] }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    const frame = frameRef.current
    if (!drag || !frame) return

    const bounds = frame.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) return

    const dx = (event.clientX - drag.startX) / bounds.width
    const dy = (event.clientY - drag.startY) / bounds.height

    const next: Quad = {
      ...quad,
      [drag.corner]: { x: clamp01(drag.start.x + dx), y: clamp01(drag.start.y + dy) },
    }

    // A drag that would fold the quad in on itself is dropped rather than
    // applied — better than a corner the user can no longer see or grab.
    if (quadArea(next) < MIN_AREA) return

    onChange(next)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
  }

  const corners: Corner[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']
  const points = corners.map((corner) => `${quad[corner].x * 100},${quad[corner].y * 100}`).join(' ')

  return (
    <div className="quad-overlay" ref={frameRef} onPointerMove={onPointerMove} onPointerUp={endDrag}>
      <svg className="quad-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon points={points} />
      </svg>
      {corners.map((corner) => (
        <span
          key={corner}
          className="quad-handle"
          style={{ left: `${quad[corner].x * 100}%`, top: `${quad[corner].y * 100}%` }}
          onPointerDown={beginDrag(corner)}
          onPointerUp={endDrag}
          role="slider"
          tabIndex={0}
          aria-label={`Sudut ${corner}`}
        />
      ))}
    </div>
  )
}
