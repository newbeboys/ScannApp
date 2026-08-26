import { useState } from 'react'
import { CloseIcon, ExportIcon } from './Icons'
import { CompressionField } from './CompressionField'
import type { BatchFormat, BatchProgress } from '../lib/documentExport'
import type { CompressionLevel } from '../lib/exportLimits'
import { useScrollLock } from '../lib/useScrollLock'

interface BatchExportSheetProps {
  count: number
  pageCount: number
  level: CompressionLevel
  /** Null until the run starts, and again once it ends. */
  progress: BatchProgress | null
  isBusy: boolean
  onLevelChange: (level: CompressionLevel) => void
  onExport: (format: BatchFormat) => void
  onStop: () => void
  onClose: () => void
}

const FORMATS: { id: BatchFormat; label: string }[] = [
  { id: 'pdf', label: 'PDF' },
  { id: 'docx', label: 'Word' },
]

/**
 * The batch counterpart of `ExportSheet`.
 *
 * Deliberately narrower than that one: PDF or Word only, never one image file
 * per page — five documents in JPG is a hundred files landing at once — and no
 * size estimate. The single-document sheet takes about 1.2 s to measure one
 * document on a real phone, so measuring a selection of five would leave this
 * sheet blank for six seconds before it could show anything at all.
 */
export function BatchExportSheet({
  count,
  pageCount,
  level,
  progress,
  isBusy,
  onLevelChange,
  onExport,
  onStop,
  onClose,
}: BatchExportSheetProps) {
  useScrollLock()
  // PDF first: it is the one format every selected document can always
  // produce, whether or not anybody has run the recogniser over it.
  const [format, setFormat] = useState<BatchFormat>('pdf')
  const isWord = format === 'docx'

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

        <div className="format-switch" role="radiogroup" aria-label="Format ekspor">
          {FORMATS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={format === option.id}
              className={`format-switch__option${
                format === option.id ? ' format-switch__option--active' : ''
              }`}
              disabled={isBusy}
              onClick={() => setFormat(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/*
          Hidden for Word, unlike the single-document sheet: there are no images
          in a Word file to compress, and here there *is* a selected format for
          the control to react to — tapping a format in the other sheet exports
          straight away, so it never has one.
        */}
        {!isWord && (
          <CompressionField level={level} isBusy={isBusy} onLevelChange={onLevelChange} />
        )}

        <p className="batch-note">
          {isWord
            ? 'Setiap dokumen jadi satu berkas Word berisi teksnya. Dokumen yang belum dikenali teksnya akan dilewati.'
            : 'Setiap dokumen jadi satu berkas PDF di folder Documents.'}
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
            onClick={() => onExport(format)}
          >
            <ExportIcon size={17} />
            <span>Ekspor {count} {isWord ? 'Word' : 'PDF'}</span>
          </button>
        )}
      </div>
    </div>
  )
}
