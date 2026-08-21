import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { CropRect } from '../lib/imageEditor'

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'move'

interface CropOverlayProps {
  rect: CropRect
  onChange: (rect: CropRect) => void
}

/** Keeps a crop from collapsing to nothing under a fast drag. */
const MIN_SIZE = 0.08

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Corner-handle crop selection. All state is kept in normalised 0..1
 * coordinates so it stays correct regardless of how the preview is scaled
 * on screen — the parent only has to render this inside a box that matches
 * the image's aspect ratio.
 */
export function CropOverlay({ rect, onChange }: CropOverlayProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; start: CropRect } | null>(
    null,
  )

  const beginDrag = (handle: Handle) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      start: rect,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    const frame = frameRef.current
    if (!drag || !frame) return

    const bounds = frame.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) return

    const dx = (event.clientX - drag.startX) / bounds.width
    const dy = (event.clientY - drag.startY) / bounds.height
    const s = drag.start

    if (drag.handle === 'move') {
      onChange({
        ...s,
        x: clamp(s.x + dx, 0, 1 - s.width),
        y: clamp(s.y + dy, 0, 1 - s.height),
      })
      return
    }

    // Work in edge coordinates, then convert back — easier to clamp correctly.
    let left = s.x
    let top = s.y
    let right = s.x + s.width
    let bottom = s.y + s.height

    if (drag.handle === 'nw' || drag.handle === 'sw') left = clamp(s.x + dx, 0, right - MIN_SIZE)
    if (drag.handle === 'ne' || drag.handle === 'se')
      right = clamp(right + dx, left + MIN_SIZE, 1)
    if (drag.handle === 'nw' || drag.handle === 'ne') top = clamp(s.y + dy, 0, bottom - MIN_SIZE)
    if (drag.handle === 'sw' || drag.handle === 'se')
      bottom = clamp(bottom + dy, top + MIN_SIZE, 1)

    onChange({ x: left, y: top, width: right - left, height: bottom - top })
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
  }

  const style = {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  }

  return (
    <div className="crop-overlay" ref={frameRef} onPointerMove={onPointerMove} onPointerUp={endDrag}>
      <div
        className="crop-window"
        style={style}
        onPointerDown={beginDrag('move')}
        onPointerUp={endDrag}
      >
        <span className="crop-grid" aria-hidden="true" />
        {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
          <span
            key={handle}
            className={`crop-handle crop-handle--${handle}`}
            onPointerDown={beginDrag(handle)}
            onPointerUp={endDrag}
            role="slider"
            tabIndex={0}
            aria-label={`Sudut ${handle}`}
            aria-valuenow={Math.round(rect.width * 100)}
          />
        ))}
      </div>
    </div>
  )
}
