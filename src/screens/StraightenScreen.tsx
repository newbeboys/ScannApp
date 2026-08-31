import { useEffect, useState, type CSSProperties } from 'react'
import { QuadOverlay } from '../components/QuadOverlay'
import { CheckIcon, ChevronLeftIcon } from '../components/Icons'
import type { Quad } from '../lib/perspective'

interface StraightenScreenProps {
  /** Displayable URI of the page awaiting confirmation — a raw scanner/import URI, already convertFileSrc'd (see documentScanner.ts's own note). */
  pageUri: string
  /** Position within the whole pending-pages list — matches the numbering ReviewScreen shows moments later, not a separate "import batch" count. */
  pageNumber: number
  pageCount: number
  isBusy: boolean
  onApply: (quad: Quad) => void
  onSkip: () => void
  onCancelAll: () => void
}

/**
 * A neutral rectangle a few percent in from every edge — same inset as
 * EditorScreen's FULL_CROP, and for the same reason: easy to grab, and close
 * enough to a no-op that applying it untouched changes very little. Never the
 * output of any pixel analysis — v1 has no edge detection (design doc,
 * Fase 7B Bagian 2).
 */
const DEFAULT_QUAD: Quad = {
  topLeft: { x: 0.05, y: 0.05 },
  topRight: { x: 0.95, y: 0.05 },
  bottomLeft: { x: 0.05, y: 0.95 },
  bottomRight: { x: 0.95, y: 0.95 },
}

/**
 * One page at a time, standing between an imported page and ReviewScreen —
 * "Luruskan Halaman" for the import path (Fase 7B). Only ML Kit scanner pages
 * skip this screen; they already arrive perspective-corrected.
 *
 * Deliberately does not call `warpImage` itself. The caller (`App.tsx`) owns
 * the actual fetch + warp + error handling, the same split already used
 * between `EnhancePanel` and `EditorScreen` — this screen stays a plain,
 * fully testable function of its props.
 */
export function StraightenScreen({
  pageUri,
  pageNumber,
  pageCount,
  isBusy,
  onApply,
  onSkip,
  onCancelAll,
}: StraightenScreenProps) {
  const [quad, setQuad] = useState<Quad>(DEFAULT_QUAD)
  const [aspect, setAspect] = useState(1 / Math.SQRT2)

  // Every new page starts from the same neutral guess — a quad left bent from
  // the previous page would show up already skewed on one that may not need
  // it at all.
  useEffect(() => {
    setQuad(DEFAULT_QUAD)
  }, [pageUri])

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button
          type="button"
          className="icon-button"
          onClick={onCancelAll}
          aria-label="Kembali"
          disabled={isBusy}
        >
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          <h1>Luruskan Halaman</h1>
          <p>
            Halaman {pageNumber} dari {pageCount} · geser sudut untuk meluruskan
          </p>
        </div>
      </header>

      <div
        className="editor-stage editor-stage--crop"
        style={{ '--page-aspect': String(aspect) } as CSSProperties}
      >
        <img
          className="editor-image"
          src={pageUri}
          alt={`Halaman impor ${pageNumber}`}
          onLoad={(event) =>
            setAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)
          }
        />
        <QuadOverlay quad={quad} onChange={setQuad} />
      </div>

      <div className="flow-footer">
        <button type="button" className="button" onClick={onSkip} disabled={isBusy}>
          <span>Lewati</span>
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => onApply(quad)}
          disabled={isBusy}
        >
          <CheckIcon size={17} />
          <span>{isBusy ? 'Memproses…' : 'Luruskan'}</span>
        </button>
      </div>
    </div>
  )
}
