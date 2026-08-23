import type { CSSProperties } from 'react'
import { CloseIcon, ImageIcon, ImageStackIcon, PdfIcon } from './Icons'
import type { ExportFormat } from '../lib/documentExport'
import type { ExportSizeEstimate } from '../lib/exportEstimate'
import type { Tier } from '../lib/tier'
import {
  canChooseCompression,
  COMPRESSION_HINTS,
  COMPRESSION_LABELS,
  COMPRESSION_LEVELS,
  resolveCompressionLevel,
  shouldWatermark,
  type CompressionLevel,
} from '../lib/exportLimits'
import { formatBytes } from '../lib/formatBytes'

interface ExportSheetProps {
  pageCount: number
  tier: Tier
  isBusy: boolean
  level: CompressionLevel
  /** Null while the sizes are still being measured, or if measuring failed. */
  estimate: ExportSizeEstimate | null
  onLevelChange: (level: CompressionLevel) => void
  onExport: (format: ExportFormat) => void
  onUpgrade: () => void
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
  onUpgrade,
  onClose,
}: ExportSheetProps) {
  const watermarked = shouldWatermark(tier)
  const canChoose = canChooseCompression(tier)
  /*
    Shown through the same gate the export runs through. A remembered 'max'
    outlives the Pro subscription that chose it — and another account on the
    same phone inherits it — so displaying the stored value raw would label the
    slider "Maksimal" while the file, and the estimate beside it, came out at
    Standar.
  */
  const effective = resolveCompressionLevel(tier, level)
  const position = COMPRESSION_LEVELS.indexOf(effective)

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
        <div className="export-quality">
          <div className="export-quality__head">
            <strong>Kualitas</strong>
            <span className="export-quality__value">{COMPRESSION_LABELS[effective]}</span>
          </div>

          {/*
            `--fill` colours the track up to the thumb: a uniformly grey bar
            reads as a setting that is off rather than one sitting at a level.
          */}
          <input
            type="range"
            className="export-quality__slider"
            min={0}
            max={COMPRESSION_LEVELS.length - 1}
            step={1}
            value={position}
            disabled={!canChoose || isBusy}
            onChange={(event) => onLevelChange(COMPRESSION_LEVELS[Number(event.target.value)])}
            aria-label="Kualitas ekspor"
            aria-valuetext={COMPRESSION_LABELS[effective]}
            style={
              {
                '--fill': `${(position / (COMPRESSION_LEVELS.length - 1)) * 100}%`,
              } as CSSProperties
            }
          />

          <div className="export-quality__ticks" aria-hidden="true">
            {COMPRESSION_LEVELS.map((step) => (
              <span
                key={step}
                className={`export-quality__tick${step === effective ? ' export-quality__tick--on' : ''}`}
              >
                {COMPRESSION_LABELS[step]}
              </span>
            ))}
          </div>

          <p className="export-quality__hint">{COMPRESSION_HINTS[effective]}</p>

          {/*
            Basic sees the real control rather than a hidden one, so the thing
            Pro buys is visible instead of merely described.
          */}
          {!canChoose && (
            <button
              type="button"
              className="export-quality__lock"
              onClick={onUpgrade}
              disabled={isBusy}
            >
              <span className="pro-badge">Pro</span>
              Atur sendiri kualitas & ukuran berkas
            </button>
          )}
        </div>

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
