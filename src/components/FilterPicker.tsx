import { DOCUMENT_FILTERS, type DocumentFilter } from '../lib/scanStorage'
import { FILTER_LABELS } from '../lib/filters'
import type { FilterScope } from '../lib/filterChoice'

interface FilterPickerProps {
  /** The filter the chips should show as chosen, for the scope in force. */
  active: DocumentFilter | null
  scope: FilterScope
  /**
   * Any render in flight, page-scope included.
   *
   * `progress` alone is not enough: it is only filled for a whole-document
   * render, so relying on it left the chips live during a single-page one —
   * long enough to start a second render that writes the same file and the
   * same index as the first.
   */
  isBusy: boolean
  /** Progress while a long document is being re-rendered, or null when idle. */
  progress: { done: number; total: number } | null
  pageNumber: number
  onScopeChange: (scope: FilterScope) => void
  onPick: (filter: DocumentFilter | 'none' | null) => void
}

/**
 * The filter chips.
 *
 * No thumbnail previews per filter on purpose: rendering five variants of a
 * full-resolution page every time the picker opens costs seconds on a phone,
 * for a preview smaller than a stamp. Picking one shows the real thing on the
 * page behind, which is a better preview than any thumbnail would be.
 */
export function FilterPicker({
  active,
  scope,
  isBusy,
  progress,
  pageNumber,
  onScopeChange,
  onPick,
}: FilterPickerProps) {
  const busy = isBusy || progress !== null

  return (
    <div className="filter-picker">
      {/*
        Whole document first, because that is what people almost always want —
        a contract is scanned to be black-and-white throughout, not on page 3.
        The per-page escape exists for the colour chart in the middle of it.
      */}
      <div className="filter-scope" role="group" aria-label="Cakupan filter">
        <button
          type="button"
          className={`filter-scope__option${scope === 'document' ? ' filter-scope__option--active' : ''}`}
          onClick={() => onScopeChange('document')}
          disabled={busy}
        >
          Semua halaman
        </button>
        <button
          type="button"
          className={`filter-scope__option${scope === 'page' ? ' filter-scope__option--active' : ''}`}
          onClick={() => onScopeChange('page')}
          disabled={busy}
        >
          Halaman {pageNumber} saja
        </button>
      </div>

      <div className="filter-chips">
        <button
          type="button"
          className={`filter-chip${active === null ? ' filter-chip--active' : ''}`}
          onClick={() => onPick(scope === 'page' ? 'none' : null)}
          disabled={busy}
        >
          Asli
        </button>

        {DOCUMENT_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className={`filter-chip${active === filter ? ' filter-chip--active' : ''}`}
            onClick={() => onPick(filter)}
            disabled={busy}
          >
            {FILTER_LABELS[filter]}
          </button>
        ))}
      </div>

      {progress && (
        <p className="filter-progress">
          Menerapkan filter… {progress.done} dari {progress.total} halaman
        </p>
      )}
    </div>
  )
}
