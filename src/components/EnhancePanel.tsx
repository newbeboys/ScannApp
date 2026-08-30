interface EnhancePanelProps {
  /** What the document's switch currently says. */
  enabled: boolean
  /** Pages that already carry a lighting render. */
  enhancedCount: number
  total: number
  /** Progress while a run is in flight, or null when idle. */
  progress: { done: number; total: number } | null
  /** Set for the whole run, which is also what locks the switch. */
  isBusy: boolean
  onToggle: (next: boolean) => void
  onCancel: () => void
}

/**
 * The "Perbaiki Pencahayaan" switch.
 *
 * A stage of its own rather than a sixth filter chip, and this panel is where
 * that shows: turning it on does not take Hitam-Putih away, it runs before it.
 *
 * Three resting states, because three things actually happen: off, on and
 * complete, and on but only part-way — what a cancelled run leaves behind, and
 * also what a document with pages the estimator declined settles at for good.
 * Rounding the middle state to either end would leave the user with no way to
 * tell why one page still looks the way it did.
 *
 * Every tier: no badge, no upgrade path, no tier prop (CLAUDE.md Bagian 6). And
 * never the word "AI" anywhere in here — this is deterministic maths, and there
 * is a test holding that line.
 */
export function EnhancePanel({
  enabled,
  enhancedCount,
  total,
  progress,
  isBusy,
  onToggle,
  onCancel,
}: EnhancePanelProps) {
  const running = progress !== null || isBusy
  const partial = enabled && enhancedCount > 0 && enhancedCount < total

  return (
    <div className="filter-picker">
      <p className="enhance-note">
        Perbaiki Pencahayaan meratakan cahaya dan menghapus bayangan sebelum filter
        diterapkan.
      </p>

      <div className="enhance-switch" role="group" aria-label="Perbaiki Pencahayaan">
        <button
          type="button"
          className={`enhance-switch__option${!enabled ? ' enhance-switch__option--active' : ''}`}
          onClick={() => onToggle(false)}
          disabled={running}
        >
          Nonaktif
        </button>
        <button
          type="button"
          className={`enhance-switch__option${enabled ? ' enhance-switch__option--active' : ''}`}
          onClick={() => onToggle(true)}
          disabled={running}
        >
          Aktif
        </button>
      </div>

      {progress && (
        <>
          <p className="filter-progress">
            Memperbaiki halaman {progress.done} dari {progress.total}…
          </p>
          <button type="button" className="button" onClick={onCancel}>
            <span>Batal</span>
          </button>
        </>
      )}

      {!running && partial && (
        <>
          <p className="filter-progress">
            {enhancedCount} dari {total} halaman diperbaiki
          </p>
          <button type="button" className="button" onClick={() => onToggle(true)}>
            <span>Lanjutkan</span>
          </button>
        </>
      )}
    </div>
  )
}
