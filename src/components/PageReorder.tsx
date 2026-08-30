import { ChevronLeftIcon, ChevronRightIcon } from './Icons'

interface PageReorderProps {
  pageCount: number
  /** Which page is being moved. */
  pageIndex: number
  isBusy: boolean
  onSelect: (index: number) => void
  onMove: (direction: -1 | 1) => void
}

/**
 * Moving a page one position at a time.
 *
 * Deliberately buttons rather than drag-and-drop: on a touch screen a drag has
 * to compete with the scroll of the very strip it lives in, and a mis-grab
 * silently reorders the wrong page. Scans usually need a correction of one or
 * two positions, so the cost of stepping is small and it never misfires.
 */
export function PageReorder({
  pageCount,
  pageIndex,
  isBusy,
  onSelect,
  onMove,
}: PageReorderProps) {
  return (
    <div className="reorder">
      <div className="review-strip">
        {Array.from({ length: pageCount }, (_, index) => (
          <button
            key={index}
            type="button"
            className={`editor-thumb${index === pageIndex ? ' editor-thumb--active' : ''}`}
            onClick={() => onSelect(index)}
            disabled={isBusy}
            aria-label={`Pilih halaman ${index + 1}`}
          >
            {index + 1}
          </button>
        ))}
      </div>

      <div className="editor-actions">
        <button
          type="button"
          className="button"
          onClick={() => onMove(-1)}
          disabled={isBusy || pageIndex === 0}
        >
          <ChevronLeftIcon size={17} />
          <span>Geser kiri</span>
        </button>
        <button
          type="button"
          className="button"
          onClick={() => onMove(1)}
          disabled={isBusy || pageIndex === pageCount - 1}
        >
          <span>Geser kanan</span>
          <ChevronRightIcon size={17} />
        </button>
      </div>

      <p className="reorder__hint">
        Halaman {pageIndex + 1} dari {pageCount}
      </p>
    </div>
  )
}
