import { CompressionField } from './CompressionField'
import { CloseIcon, ImageIcon, ImageStackIcon, PdfIcon } from './Icons'
import type { ExportFormat } from '../lib/documentExport'
import type { ExportSizeEstimate } from '../lib/exportEstimate'
import type { Tier } from '../lib/tier'
import { shouldWatermark, type CompressionLevel } from '../lib/exportLimits'
import { formatBytes } from '../lib/formatBytes'
import { useScrollLock } from '../lib/useScrollLock'

interface ExportSheetProps {
  pageCount: number
  tier: Tier
  isBusy: boolean
  level: CompressionLevel
  /** Null while the sizes are still being measured, or if measuring failed. */
  estimate: ExportSizeEstimate | null
  onLevelChange: (level: CompressionLevel) => void
  onExport: (format: ExportFormat) => void
  onClose: () => void
}

export function ExportSheet({
  pageCount,
  tier,
  isBusy,
  level,
  estimate,
  onLevelChange,
  onExport,
  onClose,
}: ExportSheetProps) {
  useScrollLock()
  const watermarked = shouldWatermark(tier)

  /** "≈ 2,4 MB", or nothing at all rather than a number we have not measured. */
  const size = (bytes: number | undefined) =>
    bytes === undefined ? null : <span className="format-option__size">≈ {formatBytes(bytes)}</span>

  return (
    <div className="sheet-backdrop" onClick={isBusy ? undefined : onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Pilih format ekspor"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet__head">
          <div>
            <h2>Ekspor Dokumen</h2>
            <p>{pageCount} halaman</p>
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
          Quality sits above the formats because tapping a format exports
          immediately — by then the choice has to already be made.
        */}
        <CompressionField level={level} isBusy={isBusy} onLevelChange={onLevelChange} />

        <button
          type="button"
          className="format-option"
          onClick={() => onExport('pdf')}
          disabled={isBusy}
        >
          <span className="format-option__icon">
            <PdfIcon size={22} />
          </span>
          <span className="format-option__text">
            <strong>PDF</strong>
            <small>
              Satu berkas, semua halaman
              {watermarked ? ' · ada watermark ScannApp' : ''}
            </small>
          </span>
          {size(estimate?.pdf)}
        </button>

        <button
          type="button"
          className="format-option"
          onClick={() => onExport('jpg')}
          disabled={isBusy}
        >
          <span className="format-option__icon">
            <ImageIcon size={22} />
          </span>
          <span className="format-option__text">
            <strong>JPG</strong>
            <small>
              {pageCount === 1 ? 'Satu gambar' : `${pageCount} gambar terpisah`} · tanpa watermark
            </small>
          </span>
          {size(estimate?.jpg)}
        </button>

        <button
          type="button"
          className="format-option"
          onClick={() => onExport('png')}
          disabled={isBusy}
        >
          <span className="format-option__icon">
            <ImageStackIcon size={22} />
          </span>
          <span className="format-option__text">
            <strong>PNG</strong>
            <small>Tanpa kehilangan detail · pas untuk Hitam-Putih</small>
          </span>
          {size(estimate?.png)}
        </button>

        {isBusy && <p className="sheet__status">Memproses…</p>}
      </div>
    </div>
  )
}
