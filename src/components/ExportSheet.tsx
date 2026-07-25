import { CloseIcon, ImageIcon, PdfIcon } from './Icons'
import type { ExportFormat } from '../lib/documentExport'
import type { Tier } from '../lib/tier'
import { shouldWatermark } from '../lib/exportLimits'

interface ExportSheetProps {
  pageCount: number
  tier: Tier
  isBusy: boolean
  onExport: (format: ExportFormat) => void
  onClose: () => void
}

export function ExportSheet({ pageCount, tier, isBusy, onExport, onClose }: ExportSheetProps) {
  const watermarked = shouldWatermark(tier)

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
            <p>{pageCount} halaman · kompresi standar</p>
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
        </button>

        {isBusy && <p className="sheet__status">Memproses…</p>}
      </div>
    </div>
  )
}
