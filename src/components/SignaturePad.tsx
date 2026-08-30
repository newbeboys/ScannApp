import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CheckIcon, CloseIcon, UndoIcon } from './Icons'
import { useScrollLock } from '../lib/useScrollLock'

interface SignaturePadProps {
  isBusy?: boolean
  onCancel: () => void
  /** Hands over a transparent PNG, trimmed to what was actually drawn. */
  onSave: (png: Blob, aspectRatio: number) => void
}

/** The pad is drawn at this many device-independent pixels wide, then trimmed. */
const PAD_WIDTH = 1000
const PAD_HEIGHT = 400
const PEN_WIDTH = 7
/** Left around the trimmed ink so the strokes are not clipped at the edge. */
const TRIM_PADDING = 8

/**
 * A wide, empty box to sign in.
 *
 * Deliberately not the page itself. Signing inside a small box at the bottom
 * of a scanned page produces the shaky, oversized scrawl everyone recognises
 * as "signed on a phone"; a full-width pad is drawn at a comfortable size and
 * then placed on the page at whatever scale suits it.
 *
 * The result is trimmed to the ink's own bounding box. Without that, the
 * signature carries the pad's whole aspect ratio with it, and dropping it on a
 * page would leave a stamp mostly made of empty space with a signature adrift
 * somewhere inside.
 */
export function SignaturePad({ isBusy = false, onCancel, onSave }: SignaturePadProps) {
  useScrollLock()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [strokes, setStrokes] = useState<number[][]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#101828'
    ctx.lineWidth = PEN_WIDTH
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const points of strokes) {
      if (points.length < 4) continue
      ctx.beginPath()
      ctx.moveTo(points[0], points[1])
      for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1])
      ctx.stroke()
    }
  }, [strokes])

  const toPad = (event: ReactPointerEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return [
      ((event.clientX - rect.left) / rect.width) * PAD_WIDTH,
      ((event.clientY - rect.top) / rect.height) * PAD_HEIGHT,
    ]
  }

  const handleDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    canvasRef.current?.setPointerCapture(event.pointerId)
    drawing.current = true
    setStrokes((current) => [...current, toPad(event)])
  }

  const handleMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const point = toPad(event)
    setStrokes((current) => {
      const next = [...current]
      next[next.length - 1] = [...next[next.length - 1], ...point]
      return next
    })
  }

  const handleUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    drawing.current = false
  }

  const handleSave = async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const trimmed = trimToInk(canvas)
    if (!trimmed) return

    const png = await new Promise<Blob | null>((resolve) =>
      trimmed.toBlob((blob) => resolve(blob), 'image/png'),
    )
    if (png) onSave(png, trimmed.width / trimmed.height)
  }

  const isEmpty = strokes.every((points) => points.length < 4)

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet__head">
          <div>
            <h2>Tanda Tangan</h2>
            <p>Tulis tanda tanganmu di kotak, lalu tempelkan ke halaman.</p>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Tutup">
            <CloseIcon size={18} />
          </button>
        </div>

        <canvas
          ref={canvasRef}
          className="signature-pad"
          width={PAD_WIDTH}
          height={PAD_HEIGHT}
          aria-label="Area tanda tangan"
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
        />

        <div className="editor-actions">
          <button
            type="button"
            className="button"
            onClick={() => setStrokes((current) => current.slice(0, -1))}
            disabled={isBusy || strokes.length === 0}
          >
            <UndoIcon size={17} />
            <span>Urungkan</span>
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleSave}
            disabled={isBusy || isEmpty}
          >
            <CheckIcon size={17} />
            <span>{isBusy ? 'Menyimpan…' : 'Tempelkan'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Copies just the drawn part of the pad onto a new canvas.
 *
 * Returns null for a pad with nothing on it, which the caller treats as
 * nothing to save.
 */
function trimToInk(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let minX = canvas.width
  let minY = canvas.height
  let maxX = -1
  let maxY = -1

  // The alpha channel alone: the pad is transparent everywhere the pen has
  // not been, whatever colour the ink is.
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0) return null

  minX = Math.max(0, minX - TRIM_PADDING)
  minY = Math.max(0, minY - TRIM_PADDING)
  maxX = Math.min(canvas.width - 1, maxX + TRIM_PADDING)
  maxY = Math.min(canvas.height - 1, maxY + TRIM_PADDING)

  const out = document.createElement('canvas')
  out.width = maxX - minX + 1
  out.height = maxY - minY + 1
  out.getContext('2d')!.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height)

  return out
}
