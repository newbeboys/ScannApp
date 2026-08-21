import { useCallback, useEffect, useState } from 'react'
import { CropOverlay } from '../components/CropOverlay'
import { CheckIcon, ChevronLeftIcon, CloseIcon, CropIcon, RotateIcon, UndoIcon } from '../components/Icons'
import { cropPage, loadPageBlob, revertPage, rotatePage } from '../lib/documentEditing'
import { getImageSize, type CropRect } from '../lib/imageEditor'
import type { LocalScanDocument } from '../lib/scanStorage'

interface EditorScreenProps {
  document: LocalScanDocument
  onDocumentChange: (doc: LocalScanDocument) => void
  onClose: () => void
  onError: (message: string) => void
}

const FULL_CROP: CropRect = { x: 0.05, y: 0.05, width: 0.9, height: 0.9 }

export function EditorScreen({
  document: doc,
  onDocumentChange,
  onClose,
  onError,
}: EditorScreenProps) {
  const [pageIndex, setPageIndex] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [aspect, setAspect] = useState(1 / Math.SQRT2)
  const [cropping, setCropping] = useState(false)
  const [rect, setRect] = useState<CropRect>(FULL_CROP)
  const [isBusy, setIsBusy] = useState(false)

  const page = doc.pages[pageIndex]

  // Re-read the page whenever it changes on disk so edits show immediately.
  useEffect(() => {
    if (!page) return
    let objectUrl: string | null = null
    let cancelled = false

    loadPageBlob(page)
      .then(async (blob) => {
        const size = await getImageSize(blob)
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setAspect(size.width / size.height)
        setPreviewUrl(objectUrl)
      })
      .catch(() => onError('Gagal memuat halaman.'))

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [page, onError])

  const run = useCallback(
    async (action: () => Promise<LocalScanDocument>) => {
      setIsBusy(true)
      try {
        onDocumentChange(await action())
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Gagal mengubah halaman.')
      } finally {
        setIsBusy(false)
      }
    },
    [onDocumentChange, onError],
  )

  const handleRotate = () => run(() => rotatePage(doc, pageIndex))

  const handleReset = () => run(() => revertPage(doc, pageIndex))

  const handleApplyCrop = async () => {
    await run(() => cropPage(doc, pageIndex, rect))
    setCropping(false)
    setRect(FULL_CROP)
  }

  const startCrop = () => {
    setRect(FULL_CROP)
    setCropping(true)
  }

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button type="button" className="icon-button" onClick={onClose} aria-label="Kembali">
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          <h1>{cropping ? 'Potong Halaman' : 'Edit Halaman'}</h1>
          <p>
            {cropping
              ? 'Geser sudut untuk mengatur area'
              : `Halaman ${pageIndex + 1} dari ${doc.pageCount}`}
          </p>
        </div>
        {page?.edited && !cropping && <span className="app-header__tier">Diedit</span>}
      </header>

      <div className="editor-stage" style={{ aspectRatio: String(aspect) }}>
        {previewUrl && <img className="editor-image" src={previewUrl} alt={`Halaman ${pageIndex + 1}`} />}
        {cropping && <CropOverlay rect={rect} onChange={setRect} />}
      </div>

      {cropping ? (
        <div className="editor-actions">
          <button
            type="button"
            className="button"
            onClick={() => setCropping(false)}
            disabled={isBusy}
          >
            <CloseIcon size={17} />
            <span>Batal</span>
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleApplyCrop}
            disabled={isBusy}
          >
            <CheckIcon size={17} />
            <span>{isBusy ? 'Memproses…' : 'Terapkan'}</span>
          </button>
        </div>
      ) : (
        <>
          <div className="editor-actions">
            <button type="button" className="button" onClick={startCrop} disabled={isBusy}>
              <CropIcon size={17} />
              <span>Potong</span>
            </button>
            <button type="button" className="button" onClick={handleRotate} disabled={isBusy}>
              <RotateIcon size={17} />
              <span>Putar</span>
            </button>
            <button
              type="button"
              className="button"
              onClick={handleReset}
              disabled={isBusy || !page?.edited}
            >
              <UndoIcon size={17} />
              <span>Asli</span>
            </button>
          </div>

          {doc.pages.length > 1 && (
            <div className="review-strip">
              {doc.pages.map((entry, index) => (
                <button
                  key={entry.original}
                  type="button"
                  className={`editor-thumb${index === pageIndex ? ' editor-thumb--active' : ''}`}
                  onClick={() => setPageIndex(index)}
                >
                  {index + 1}
                  {entry.edited && <span className="editor-thumb__dot" />}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
