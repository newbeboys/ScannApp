import { CompressionField } from './CompressionField'
import { CloseIcon, ImageIcon, ImageStackIcon, PdfIcon, TextIcon } from './Icons'
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
  /** Whether any page has been through the recogniser — the one thing Word needs. */
  hasText: boolean
  onLevelChange: (level: CompressionLevel) => void
  onExport: (format: ExportFormat) => void
  /** Takes the user to the recogniser when Word has nothing to export yet. */
  onRecognizeText: () => void
  onClose: () => void
}

export function ExportSheet({
  pageCount,
  tier,
  isBusy,
  level,
  estimate,
  hasText,
  onLevelChange,
  onExport,
  onRecognizeText,
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

        {/*
          Word is the only row here that can be unavailable, because it is the
          only one made of something other than the pages themselves. When
          there is no text it offers the recogniser rather than sitting there
          greyed out — a dead row reads as a broken app, and the fix is one
          screen away.

          The compression level above does not reach this format at all: there
          are no images in the file to compress. Nothing is hidden for it,
          though, because tapping a format here exports immediately — there is
          no selected state for a control to react to.
        */}
        <button
          type="button"
          className="format-option"
          onClick={() => (hasText ? onExport('docx') : onRecognizeText())}
          disabled={isBusy}
        >
          <span className="format-option__icon">
            <TextIcon size={22} />
          </span>
          <span className="format-option__text">
            <strong>Word</strong>
            <small>
              {hasText
                ? 'Teks yang bisa diedit · tanpa gambar halaman'
                : 'Kenali teks dokumen dulu'}
            </small>
          </span>
          {/*
            No "≈": a text-only file is cheap enough to build for real, so this
            is the size of the file rather than a projection of it.
          */}
          {estimate?.docx != null && (
            <span className="format-option__size">{formatBytes(estimate.docx)}</span>
          )}
        </button>

        {isBusy && <p className="sheet__status">Memproses…</p>}
      </div>
    </div>
  )
}
