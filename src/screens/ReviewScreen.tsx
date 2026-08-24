import { ChevronLeftIcon, CloseIcon, PlusIcon } from '../components/Icons'
import { PageImage } from '../components/PageImage'

interface ReviewScreenProps {
  pages: string[]
  currentIndex: number
  isBusy: boolean
  onSelectPage: (index: number) => void
  /** Opens the full-screen preview so a page can be checked before it is kept. */
  onPreview: (index: number) => void
  onRemovePage: (index: number) => void
  onAddPages: () => void
  onCancel: () => void
  onSave: () => void
}

export function ReviewScreen({
  pages,
  currentIndex,
  isBusy,
  onSelectPage,
  onPreview,
  onRemovePage,
  onAddPages,
  onCancel,
  onSave,
}: ReviewScreenProps) {
  const safeIndex = Math.min(currentIndex, pages.length - 1)

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Kembali">
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          <h1>Tinjau Hasil Pindai</h1>
          <p>Buang halaman yang kurang bagus</p>
        </div>
      </header>

      {/*
        Tappable, because deciding whether a scan is good enough to keep is
        exactly what this screen is for — and blurred text is not visible at
        46vh. Straight into the same viewer the saved document uses.
      */}
      <button
        type="button"
        className="review-stage"
        onClick={() => onPreview(safeIndex)}
        aria-label={`Lihat halaman ${safeIndex + 1} layar penuh`}
      >
        {pages[safeIndex] && <PageImage source={pages[safeIndex]} raw alt="" />}
      </button>

      <p className="review-counter">
        Halaman {safeIndex + 1} dari {pages.length} · ketuk untuk memperbesar
      </p>

      <div className="review-strip">
        {pages.map((page, index) => (
          <div
            key={page}
            className={`review-thumb${index === safeIndex ? ' review-thumb--active' : ''}`}
          >
            <button
              type="button"
              className="review-thumb__select"
              onClick={() => onSelectPage(index)}
            >
              <PageImage source={page} raw alt={`Halaman ${index + 1}`} />
              <span className="review-thumb__number">{index + 1}</span>
            </button>
            <button
              type="button"
              className="review-thumb__remove"
              onClick={() => onRemovePage(index)}
              aria-label={`Hapus halaman ${index + 1}`}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        ))}

        <button type="button" className="review-add" onClick={onAddPages} disabled={isBusy}>
          <PlusIcon size={18} />
          <span>Tambah</span>
        </button>
      </div>

      <div className="flow-footer">
        <button type="button" className="button button--primary" onClick={onSave} disabled={isBusy}>
          {isBusy ? 'Menyimpan…' : `Simpan Dokumen (${pages.length} halaman)`}
        </button>
      </div>
    </div>
  )
}
