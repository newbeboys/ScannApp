import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  HIGHLIGHTER_ALPHA,
  MIN_SIGNATURE_WIDTH,
  moveSignature,
  resizeSignature,
  signatureAt,
  simplifyStroke,
  strokeWidth,
  type InkStroke,
  type InkTool,
  type Mark,
  type SignatureStamp,
} from '../lib/annotations'

export type AnnotateTool = InkTool | 'move'

interface AnnotateOverlayProps {
  marks: Mark[]
  tool: AnnotateTool
  color: string
  /** Nib size as a fraction of the page's long edge. */
  width: number
  signatureUris: Record<string, string>
  /** Index of the signature the user is working on, or null. */
  selected: number | null
  onSelect: (index: number | null) => void
  onAddStroke: (stroke: InkStroke) => void
  onChangeMark: (index: number, mark: Mark) => void
}

/** How big the resize grab area is, in CSS pixels. */
const HANDLE_PX = 26

/**
 * A signature drag carries the stamp it started from, and every move is
 * computed against that rather than against the previous event.
 *
 * Reading the stamp back out of `marks` instead makes the drag lag: pointer
 * events fire faster than React re-renders, so two moves in one frame both see
 * the pre-drag box while the running total has already advanced — and the
 * stamp travels at roughly half the speed of the finger.
 */
type Drag =
  | { kind: 'stroke'; points: number[] }
  | { kind: 'move'; index: number; from: SignatureStamp; startX: number; startY: number }
  | { kind: 'resize'; index: number; from: SignatureStamp }

/**
 * The drawing surface that sits over the page in the editor.
 *
 * Everything it produces is in page fractions, never screen pixels: the same
 * stroke has to render onto a 3000px page later. Screen coordinates only exist
 * inside the pointer handlers and inside the SVG, which is measured live —
 * rotating the phone changes the frame, not the drawing.
 *
 * Nothing here is written to storage. Ink lands in the editor's draft and is
 * only rendered when the user is finished; re-encoding a 12 MP page after every
 * stroke would make drawing unusable.
 */
export function AnnotateOverlay({
  marks,
  tool,
  color,
  width,
  signatureUris,
  selected,
  onSelect,
  onAddStroke,
  onChangeMark,
}: AnnotateOverlayProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  /** The stroke being drawn right now, kept apart so `marks` stays committed. */
  const [live, setLive] = useState<number[] | null>(null)

  // The SVG draws in pixels, so it has to know how big it currently is. A
  // ResizeObserver rather than a one-off measure: the frame changes when the
  // phone is rotated and when the image finally reports its aspect ratio.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect
      setSize({ width: box.width, height: box.height })
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const toPage = (event: ReactPointerEvent): { x: number; y: number } => {
    const rect = hostRef.current!.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = hostRef.current
    if (!host) return
    host.setPointerCapture(event.pointerId)

    const point = toPage(event)

    if (tool === 'move') {
      const stamp = selected !== null ? (marks[selected] as SignatureStamp | undefined) : undefined
      if (stamp?.kind === 'signature' && onHandle(stamp, point, size)) {
        dragRef.current = { kind: 'resize', index: selected!, from: stamp }
        return
      }

      const hit = signatureAt(marks, point.x, point.y)
      onSelect(hit === -1 ? null : hit)
      dragRef.current =
        hit === -1
          ? null
          : {
              kind: 'move',
              index: hit,
              from: marks[hit] as SignatureStamp,
              startX: point.x,
              startY: point.y,
            }
      return
    }

    dragRef.current = { kind: 'stroke', points: [point.x, point.y] }
    setLive([point.x, point.y])
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const point = toPage(event)

    if (drag.kind === 'stroke') {
      drag.points.push(point.x, point.y)
      setLive([...drag.points])
      return
    }

    if (drag.kind === 'resize') {
      onChangeMark(
        drag.index,
        resizeSignature(drag.from, Math.max(MIN_SIGNATURE_WIDTH, point.x - drag.from.x)),
      )
      return
    }

    onChangeMark(
      drag.index,
      moveSignature(drag.from, point.x - drag.startX, point.y - drag.startY),
    )
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = hostRef.current
    if (host?.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId)

    const drag = dragRef.current
    dragRef.current = null
    setLive(null)
    if (drag?.kind !== 'stroke') return

    // A tap is not a stroke. Two identical points render as nothing at all, so
    // committing them would leave an invisible entry that undo has to eat
    // before it reaches anything the user can see.
    if (drag.points.length < 4) return

    onAddStroke({
      kind: 'ink',
      tool: inkTool(tool),
      color,
      width,
      points: simplifyStroke(drag.points),
    })
  }

  const longEdge = Math.max(size.width, size.height)
  const selectedStamp =
    selected !== null && marks[selected]?.kind === 'signature'
      ? (marks[selected] as SignatureStamp)
      : null

  return (
    <div
      className="annotate"
      ref={hostRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {size.width > 0 && (
        <svg className="annotate__canvas" width={size.width} height={size.height}>
          {marks.map((mark, index) =>
            mark.kind === 'signature' ? (
              signatureUris[mark.source] ? (
                <image
                  key={index}
                  href={signatureUris[mark.source]}
                  x={mark.x * size.width}
                  y={mark.y * size.height}
                  width={mark.width * size.width}
                  height={mark.height * size.height}
                  preserveAspectRatio="none"
                />
              ) : null
            ) : (
              <Stroke key={index} stroke={mark} size={size} longEdge={longEdge} />
            ),
          )}

          {live && (
            <Stroke
              stroke={{ kind: 'ink', tool: inkTool(tool), color, width, points: live }}
              size={size}
              longEdge={longEdge}
            />
          )}

          {selectedStamp && (
            <>
              <rect
                className="annotate__selection"
                x={selectedStamp.x * size.width}
                y={selectedStamp.y * size.height}
                width={selectedStamp.width * size.width}
                height={selectedStamp.height * size.height}
              />
              <circle
                className="annotate__handle"
                cx={(selectedStamp.x + selectedStamp.width) * size.width}
                cy={(selectedStamp.y + selectedStamp.height) * size.height}
                r={9}
              />
            </>
          )}
        </svg>
      )}
    </div>
  )
}

interface StrokeProps {
  stroke: InkStroke
  size: { width: number; height: number }
  longEdge: number
}

function Stroke({ stroke, size, longEdge }: StrokeProps) {
  const points: string[] = []
  for (let i = 0; i < stroke.points.length; i += 2) {
    points.push(`${stroke.points[i] * size.width},${stroke.points[i + 1] * size.height}`)
  }

  return (
    <polyline
      points={points.join(' ')}
      fill="none"
      stroke={stroke.color}
      strokeWidth={Math.max(1, strokeWidth(stroke) * longEdge)}
      strokeLinecap="round"
      strokeLinejoin="round"
      /*
        Matches what `renderMarks` will do on the real page: a highlighter
        multiplies into the paper rather than painting over it, so text under
        it stays black. The overlay deliberately creates no stacking context
        of its own, which is what lets the blend reach the page image behind it.
      */
      style={
        stroke.tool === 'highlighter'
          ? { mixBlendMode: 'multiply', opacity: HIGHLIGHTER_ALPHA }
          : undefined
      }
    />
  )
}

/** The 'move' tool draws nothing; a live stroke can only ever be an ink tool. */
function inkTool(tool: AnnotateTool): InkTool {
  return tool === 'highlighter' ? 'highlighter' : 'pen'
}

/** True when the point is on the resize handle at the stamp's bottom-right corner. */
function onHandle(
  stamp: SignatureStamp,
  point: { x: number; y: number },
  size: { width: number; height: number },
): boolean {
  if (size.width === 0 || size.height === 0) return false

  const dx = (point.x - (stamp.x + stamp.width)) * size.width
  const dy = (point.y - (stamp.y + stamp.height)) * size.height

  return Math.hypot(dx, dy) <= HANDLE_PX
}
