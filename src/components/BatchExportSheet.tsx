import { CloseIcon, ExportIcon } from './Icons'
import { CompressionField } from './CompressionField'
import type { BatchProgress } from '../lib/documentExport'
import type { CompressionLevel } from '../lib/exportLimits'
import type { Tier } from '../lib/tier'
import { useScrollLock } from '../lib/useScrollLock'

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
  /** Opens the paywall from the locked quality row — Basic reaches this sheet now. */
  onUpgrade: () => void
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
  onUpgrade,
  onClose,
}: BatchExportSheetProps) {
  useScrollLock()

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

        {/*
          The lock row leads to the paywall, like the single-document sheet's
          does. It used to close the sheet instead, on the grounds that the
          button opening it was Pro-only so no Basic account could ever get
          here — which stopped being true on 25 Agustus 2026 when batch export
          moved to every tier. The quality control itself is still Pro.
        */}
        <CompressionField
          tier={tier}
          level={level}
          isBusy={isBusy}
          onLevelChange={onLevelChange}
          onUpgrade={onUpgrade}
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
              {/*
                Deliberately `index / total`, not `(index + 1) / total` like the
                text line above. `onProgress` fires *before* each document is
                written (see exportDocumentsBatch), so `index` is the count of
                documents already finished, not the one in flight. Using
                `index + 1` here would read 33% before any file exists on a
                3-document batch, and sit pegged at 100% for the whole time the
                last file is still being written.
              */}
              <span
                className="batch-progress__fill"
                style={{ width: `${(progress.index / progress.total) * 100}%` }}
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
