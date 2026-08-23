import { useCallback, useEffect, useState } from 'react'
import { CropOverlay } from '../components/CropOverlay'
import { FilterPicker } from '../components/FilterPicker'
import { activeChip, pickToChoice, type FilterScope } from '../lib/filterChoice'
import {
  CheckIcon,
  ChevronLeftIcon,
  CloseIcon,
  CropIcon,
  ImageIcon,
  MergeIcon,
  RotateIcon,
  UndoIcon,
} from '../components/Icons'
import { PageReorder } from '../components/PageReorder'
import {
  cropPage,
  loadPageBlob,
  movePage,
  revertPage,
  rotatePage,
  setDocumentFilter,
  setPageFilter,
} from '../lib/documentEditing'
import { getImageSize, type CropRect } from '../lib/imageEditor'
import type { LocalScanDocument } from '../lib/scanStorage'

interface EditorScreenProps {
  document: LocalScanDocument
  onDocumentChange: (doc: LocalScanDocument) => void
  onClose: () => void
  onError: (message: string) => void
}

const FULL_CROP: CropRect = { x: 0.05, y: 0.05, width: 0.9, height: 0.9 }

/** Which tool is open. Only one at a time — they all want the whole screen. */
type Mode = 'none' | 'crop' | 'filter' | 'reorder'

const TITLES: Record<Mode, string> = {
  none: 'Edit Halaman',
  crop: 'Potong Halaman',
  filter: 'Filter Dokumen',
  reorder: 'Urutkan Halaman',
}

export function EditorScreen({
  document: doc,
  onDocumentChange,
  onClose,
  onError,
}: EditorScreenProps) {
  const [pageIndex, setPageIndex] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [aspect, setAspect] = useState(1 / Math.SQRT2)
  const [mode, setMode] = useState<Mode>('none')
  const [rect, setRect] = useState<CropRect>(FULL_CROP)
  const [isBusy, setIsBusy] = useState(false)
  const [scope, setScope] = useState<FilterScope>('document')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const page = doc.pages[pageIndex]

  // Re-read the page whenever it changes so edits — including a filter, which
  // changes which file the page resolves to — show up immediately. Every
  // storage mutation (crop, rotate, revert, filter) returns a fresh page
  // object rather than mutating in place, so `page` itself is a new reference
  // whenever what it resolves to has actually changed; nothing extra needs
  // watching alongside it.
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

  /** Reports whether the change went through — the error itself is already shown. */
  const run = useCallback(
    async (action: () => Promise<LocalScanDocument>): Promise<boolean> => {
      setIsBusy(true)
      try {
        onDocumentChange(await action())
        return true
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Gagal mengubah halaman.')
        return false
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
    setMode('none')
    setRect(FULL_CROP)
  }

  const startCrop = () => {
    setRect(FULL_CROP)
    setMode('crop')
  }

  const handlePick = async (pick: Parameters<typeof pickToChoice>[0]) => {
    const choice = pickToChoice(pick, scope)

    setIsBusy(true)
    try {
      if ('document' in choice) {
        // Every page is re-rendered, so a long document needs to say so.
        setProgress({ done: 0, total: doc.pages.length })
        onDocumentChange(
          await setDocumentFilter(doc, choice.document, (done, total) =>
            setProgress({ done, total }),
          ),
        )
      } else {
        onDocumentChange(await setPageFilter(doc, pageIndex, choice.page))
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Gagal menerapkan filter.')
    } finally {
      setProgress(null)
      setIsBusy(false)
    }
  }

  const handleMove = async (direction: -1 | 1) => {
    const target = pageIndex + direction
    // Follow the page that moved, not the slot it left behind — but only once
    // it really has moved. `run` reports the failure and leaves the order
    // alone, so moving the selection anyway would leave it on a page the user
    // never chose, and the next tap would shift the wrong one.
    if (await run(() => movePage(doc, pageIndex, direction))) setPageIndex(target)
  }

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button
          type="button"
          className="icon-button"
          onClick={() => (mode === 'none' ? onClose() : setMode('none'))}
          aria-label="Kembali"
          disabled={isBusy}
        >
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          <h1>{TITLES[mode]}</h1>
          <p>
            {mode === 'crop'
              ? 'Geser sudut untuk mengatur area'
              : `Halaman ${pageIndex + 1} dari ${doc.pageCount}`}
          </p>
        </div>
        {page?.edited && mode === 'none' && <span className="app-header__tier">Diedit</span>}
      </header>

      {mode !== 'reorder' && (
        <div className="editor-stage" style={{ aspectRatio: String(aspect) }}>
          {previewUrl && (
            <img className="editor-image" src={previewUrl} alt={`Halaman ${pageIndex + 1}`} />
          )}
          {mode === 'crop' && <CropOverlay rect={rect} onChange={setRect} />}
        </div>
      )}

      {mode === 'crop' && (
        <div className="editor-actions">
          <button type="button" className="button" onClick={() => setMode('none')} disabled={isBusy}>
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
      )}

      {mode === 'filter' && page && (
        <FilterPicker
          active={activeChip(scope, doc, page)}
          scope={scope}
          isBusy={isBusy}
          progress={progress}
          pageNumber={pageIndex + 1}
          onScopeChange={setScope}
          onPick={handlePick}
        />
      )}

      {mode === 'reorder' && (
        <PageReorder
          pageCount={doc.pages.length}
          pageIndex={pageIndex}
          isBusy={isBusy}
          onSelect={setPageIndex}
          onMove={handleMove}
        />
      )}

      {mode === 'none' && (
        <>
          {/* This page's geometry. */}
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

          {/* The whole document — filter and reorder, open to every tier. */}
          <div className="editor-actions">
            <button
              type="button"
              className="button"
              onClick={() => setMode('filter')}
              disabled={isBusy}
            >
              <ImageIcon size={17} />
              <span>Filter</span>
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setMode('reorder')}
              disabled={isBusy || doc.pages.length < 2}
            >
              <MergeIcon size={17} />
              <span>Urutkan</span>
            </button>
          </div>

          {doc.pages.length > 1 && (
            <div className="review-strip">
              {doc.pages.map((entry, index) => (
                <button
                  key={`${entry.original}-${index}`}
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
