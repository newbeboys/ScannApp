import { CloseIcon, ExportIcon } from './Icons'
import { CompressionField } from './CompressionField'
import type { BatchProgress } from '../lib/documentExport'
import type { CompressionLevel } from '../lib/exportLimits'
import type { Tier } from '../lib/tier'

interface BatchExportSheetProps {
  count: number
  pageCount: number
  tier: Tier
  level: CompressionLevel
  /** Null until the run starts, and again once it ends. */
  progress: BatchProgress | null
  isBusy: boolean
  onLevelChange: (level: CompressionLevel) => void
  onExport: () => void
  onStop: () => void
  onClose: () => void
}

/**
 * The batch counterpart of `ExportSheet`.
 *
 * Deliberately narrower than that one: PDF only, and no size estimate. The
 * single-document sheet takes about 1.2 s to measure one document on a real
 * phone, so measuring a selection of five would leave this sheet blank for six
 * seconds before it could show anything at all.
 */
export function BatchExportSheet({
  count,
  pageCount,
  tier,
  level,
  progress,
  isBusy,
  onLevelChange,
  onExport,
  onStop,
  onClose,
}: BatchExportSheetProps) {
  return (
    <div className="sheet-backdrop" onClick={isBusy ? undefined : onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Ekspor banyak dokumen"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet__head">
          <div>
            <h2>Ekspor Banyak Dokumen</h2>
            <p>
              {count} dokumen · {pageCount} halaman
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Tutup"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <CompressionField
          tier={tier}
          level={level}
          isBusy={isBusy}
          onLevelChange={onLevelChange}
          /*
            Nothing to upgrade to from here: the button that opened this sheet
            is already Pro-only, so a Basic account cannot reach it. The lock
            row still renders for the tier check's own sake, and closing is the
            honest thing for it to do.
          */
          onUpgrade={onClose}
        />

        <p className="batch-note">
          Setiap dokumen jadi satu berkas PDF di folder Documents.
        </p>

        {progress ? (
          <div className="batch-progress">
            <div className="batch-progress__head">
              <strong>{progress.title}</strong>
              <span>
                {progress.index + 1} dari {progress.total}
              </span>
            </div>
            <div className="batch-progress__track">
              <span
                className="batch-progress__fill"
                style={{ width: `${((progress.index + 1) / progress.total) * 100}%` }}
              />
            </div>
          </div>
        ) : null}

        {isBusy ? (
          <button
            type="button"
            className="button"
            data-testid="batch-stop"
            onClick={onStop}
          >
            <span>Hentikan</span>
          </button>
        ) : (
          <button
            type="button"
            className="button button--primary"
            data-testid="batch-export"
            onClick={onExport}
          >
            <ExportIcon size={17} />
            <span>Ekspor {count} PDF</span>
          </button>
        )}
      </div>
    </div>
  )
}
