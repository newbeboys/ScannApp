import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnnotateOverlay, type AnnotateTool } from '../components/AnnotateOverlay'
import { AnnotateToolbar } from '../components/AnnotateToolbar'
import { CropOverlay } from '../components/CropOverlay'
import { EnhancePanel } from '../components/EnhancePanel'
import { FilterPicker } from '../components/FilterPicker'
import { QuadOverlay } from '../components/QuadOverlay'
import { SignaturePad } from '../components/SignaturePad'
import { activeChip, pickToChoice, type FilterScope } from '../lib/filterChoice'
import {
  CheckIcon,
  ChevronLeftIcon,
  CloseIcon,
  CropIcon,
  ImageIcon,
  MergeIcon,
  RotateIcon,
  SignatureIcon,
  StraightenIcon,
  SunIcon,
  UndoIcon,
} from '../components/Icons'
import { PageReorder } from '../components/PageReorder'
import {
  defaultSignatureBox,
  INK_COLORS,
  INK_WIDTHS,
  type InkColorId,
  type InkWidth,
  type Mark,
} from '../lib/annotations'
import {
  cropPage,
  describeEnhanceOutcome,
  loadAnnotationBase,
  loadPageBlob,
  movePage,
  revertPage,
  rotatePage,
  setDocumentEnhance,
  setDocumentFilter,
  setPageFilter,
  setPageMarks,
  straightenPage,
} from '../lib/documentEditing'
import type { CropRect, Quad } from '../lib/imageEditor'
import { markCount, saveSignatureImage, type LocalScanDocument } from '../lib/scanStorage'
import { useSignatureUris } from '../lib/useSignatureUris'

interface EditorScreenProps {
  document: LocalScanDocument
  onDocumentChange: (doc: LocalScanDocument) => void
  onClose: () => void
  onError: (message: string) => void
  /** An ordinary message, not a failure — `onError` already covers those. */
  onNotice: (message: string) => void
}

const FULL_CROP: CropRect = { x: 0.05, y: 0.05, width: 0.9, height: 0.9 }

/** A neutral rectangle a few percent in from every edge — same inset as FULL_CROP, and for the same reason: easy to grab, and close enough to a no-op that applying it untouched changes very little. Never the output of any pixel analysis (design doc, Fase 7B Bagian 2 — v1 has no detection). */
const FULL_QUAD: Quad = {
  topLeft: { x: 0.05, y: 0.05 },
  topRight: { x: 0.95, y: 0.05 },
  bottomLeft: { x: 0.05, y: 0.95 },
  bottomRight: { x: 0.95, y: 0.95 },
}

/** Which tool is open. Only one at a time — they all want the whole screen. */
type Mode = 'none' | 'crop' | 'straighten' | 'filter' | 'enhance' | 'reorder' | 'annotate'

const TITLES: Record<Mode, string> = {
  none: 'Edit Halaman',
  crop: 'Potong Halaman',
  straighten: 'Luruskan Halaman',
  filter: 'Filter Dokumen',
  enhance: 'Perbaiki Pencahayaan',
  reorder: 'Urutkan Halaman',
  annotate: 'Anotasi & Tanda Tangan',
}

export function EditorScreen({
  document: doc,
  onDocumentChange,
  onClose,
  onError,
  onNotice,
}: EditorScreenProps) {
  const [pageIndex, setPageIndex] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [aspect, setAspect] = useState(1 / Math.SQRT2)
  const [mode, setMode] = useState<Mode>('none')
  const [rect, setRect] = useState<CropRect>(FULL_CROP)
  const [quad, setQuad] = useState<Quad>(FULL_QUAD)
  const [isBusy, setIsBusy] = useState(false)
  const [scope, setScope] = useState<FilterScope>('document')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [enhanceProgress, setEnhanceProgress] = useState<{ done: number; total: number } | null>(
    null,
  )
  /** Held in a ref, not state: cancelling must not wait for a re-render. */
  const enhanceRun = useRef<AbortController | null>(null)

  /**
   * The ink being worked on, held in memory until the user saves.
   *
   * Not written per stroke on purpose: every save re-encodes the whole page,
   * which is a 12 MP JPEG. Drawing has to stay at the speed of a finger.
   */
  const [draftMarks, setDraftMarks] = useState<Mark[] | null>(null)
  const [tool, setTool] = useState<AnnotateTool>('pen')
  const [inkColor, setInkColor] = useState<InkColorId>('blue')
  const [inkWidth, setInkWidth] = useState<InkWidth>('medium')
  const [selectedMark, setSelectedMark] = useState<number | null>(null)
  const [isSigning, setIsSigning] = useState(false)

  const page = doc.pages[pageIndex]
  const marks = draftMarks ?? page?.marks ?? []
  const signatureUris = useSignatureUris(marks)

  /** True once the draft differs from what is stored, which is what Simpan needs. */
  const hasMarkChanges = useMemo(
    () => draftMarks !== null && JSON.stringify(draftMarks) !== JSON.stringify(page?.marks ?? []),
    [draftMarks, page],
  )

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

    // In annotate mode the overlay draws every mark itself, so the picture
    // behind it has to be the bare page — showing the annotated render there
    // would put each stroke on screen twice.
    const load = mode === 'annotate' ? loadAnnotationBase(page) : loadPageBlob(page)

    load
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        // The <img> below reports its own size once it has loaded. Measuring
        // here first meant decoding a 12MP scan twice for one preview — around
        // 270ms of it wasted per page on a desktop, considerably more on a
        // phone (diukur 24 Agustus 2026).
        setPreviewUrl(objectUrl)
      })
      .catch(() => onError('Gagal memuat halaman.'))

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [page, mode, onError])

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

  const handleApplyStraighten = async () => {
    await run(() => straightenPage(doc, pageIndex, quad))
    setMode('none')
    setQuad(FULL_QUAD)
  }

  const startStraighten = () => {
    setQuad(FULL_QUAD)
    setMode('straighten')
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

  const enhancedCount = doc.pages.filter((entry) => entry.enhanced).length

  const handleEnhanceToggle = async (next: boolean) => {
    const controller = new AbortController()
    enhanceRun.current = controller

    setIsBusy(true)
    setEnhanceProgress({ done: 0, total: doc.pages.length })
    try {
      const { document: updated, outcome } = await setDocumentEnhance(doc, next, {
        onProgress: (done, total) => setEnhanceProgress({ done, total }),
        signal: controller.signal,
      })
      onDocumentChange(updated)
      onNotice(describeEnhanceOutcome(outcome, next))
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Gagal memperbaiki pencahayaan.')
    } finally {
      enhanceRun.current = null
      setEnhanceProgress(null)
      setIsBusy(false)
    }
  }

  /** Opens the annotate tools. Every tier — see `setPageMarks`. */
  const startAnnotate = () => {
    setDraftMarks(page?.marks ?? [])
    setSelectedMark(null)
    setTool('pen')
    setMode('annotate')
  }

  /**
   * Leaves the annotate tools, asking first if anything would be thrown away.
   *
   * Ink lives in a draft until it is saved, so backing out silently is the one
   * way to lose work in this editor — everything else is written the moment it
   * is applied.
   */
  const closeAnnotate = ({ confirmLoss = false } = {}) => {
    if (confirmLoss && hasMarkChanges && !confirm('Buang anotasi yang belum disimpan?')) return
    setDraftMarks(null)
    setSelectedMark(null)
    setMode('none')
  }

  const handleSaveMarks = async () => {
    if (draftMarks === null) return
    setIsBusy(true)
    try {
      onDocumentChange(await setPageMarks(doc, pageIndex, draftMarks))
      closeAnnotate()
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Gagal menyimpan anotasi.')
    } finally {
      setIsBusy(false)
    }
  }

  /**
   * Stores the drawn signature, then drops it on the page.
   *
   * The file is written straight away rather than with the rest of the draft:
   * the overlay has to be able to show the stamp while it is being positioned,
   * and it shows it by loading that file.
   */
  const handleSignature = async (png: Blob, aspectRatio: number) => {
    setIsBusy(true)
    try {
      const source = await saveSignatureImage(png)
      const box = defaultSignatureBox(aspectRatio, aspect)
      const next: Mark[] = [...marks, { kind: 'signature', source, ...box }]

      setDraftMarks(next)
      // Selected and ready to drag: a signature is almost never wanted exactly
      // where it lands. Set outside the state updater, which has to stay pure —
      // React may call it more than once for a single update.
      setSelectedMark(next.length - 1)
      setTool('move')
      setIsSigning(false)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Gagal menyimpan tanda tangan.')
    } finally {
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
          onClick={() => {
            if (mode === 'none') onClose()
            else if (mode === 'annotate') closeAnnotate({ confirmLoss: true })
            else setMode('none')
          }}
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
              : mode === 'straighten'
                ? 'Geser sudut untuk meluruskan'
                : `Halaman ${pageIndex + 1} dari ${doc.pageCount}`}
          </p>
        </div>
        {/* One badge, and ink wins: it is the more recent and more visible change. */}
        {mode === 'none' && page && markCount(page) > 0 && (
          <span className="app-header__tier">Dianotasi</span>
        )}
        {mode === 'none' && page && markCount(page) === 0 && page.edited && (
          <span className="app-header__tier">Diedit</span>
        )}
      </header>

      {mode !== 'reorder' && (
        <div
          className={`editor-stage${mode === 'crop' || mode === 'straighten' ? ' editor-stage--crop' : ''}`}
          style={{ '--page-aspect': String(aspect) } as CSSProperties}
        >
          {previewUrl && (
            <img
              className="editor-image"
              src={previewUrl}
              alt={`Halaman ${pageIndex + 1}`}
              onLoad={(event) =>
                setAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)
              }
            />
          )}
          {mode === 'crop' && <CropOverlay rect={rect} onChange={setRect} />}
          {mode === 'straighten' && <QuadOverlay quad={quad} onChange={setQuad} />}
          {mode === 'annotate' && (
            <AnnotateOverlay
              marks={marks}
              tool={tool}
              color={INK_COLORS.find((entry) => entry.id === inkColor)!.value}
              width={INK_WIDTHS[inkWidth]}
              signatureUris={signatureUris}
              selected={selectedMark}
              onSelect={setSelectedMark}
              onAddStroke={(stroke) => setDraftMarks((current) => [...(current ?? []), stroke])}
              onChangeMark={(index, mark) =>
                setDraftMarks((current) =>
                  (current ?? []).map((entry, i) => (i === index ? mark : entry)),
                )
              }
            />
          )}
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

      {mode === 'straighten' && (
        <div className="editor-actions">
          <button type="button" className="button" onClick={() => setMode('none')} disabled={isBusy}>
            <CloseIcon size={17} />
            <span>Batal</span>
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleApplyStraighten}
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

      {mode === 'enhance' && (
        <EnhancePanel
          enabled={doc.enhance === true}
          enhancedCount={enhancedCount}
          total={doc.pages.length}
          progress={enhanceProgress}
          isBusy={isBusy}
          onToggle={(next) => void handleEnhanceToggle(next)}
          onCancel={() => enhanceRun.current?.abort()}
        />
      )}

      {mode === 'annotate' && (
        <AnnotateToolbar
          tool={tool}
          color={inkColor}
          width={inkWidth}
          markCount={marks.length}
          isBusy={isBusy}
          hasChanges={hasMarkChanges}
          onToolChange={(next) => {
            setTool(next)
            if (next !== 'move') setSelectedMark(null)
          }}
          onColorChange={setInkColor}
          onWidthChange={setInkWidth}
          onSignature={() => setIsSigning(true)}
          onUndo={() => {
            setDraftMarks((current) => (current ?? []).slice(0, -1))
            setSelectedMark(null)
          }}
          onClear={() => {
            setDraftMarks([])
            setSelectedMark(null)
          }}
          onSave={handleSaveMarks}
        />
      )}

      {isSigning && (
        <SignaturePad
          isBusy={isBusy}
          onCancel={() => setIsSigning(false)}
          onSave={handleSignature}
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
            <button type="button" className="button" onClick={startStraighten} disabled={isBusy}>
              <StraightenIcon size={17} />
              <span>Luruskan</span>
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

          {/* The whole document — filter, lighting and reorder, open to every tier. */}
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
              onClick={() => setMode('enhance')}
              disabled={isBusy}
            >
              <SunIcon size={17} />
              <span>Cahaya</span>
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

          {/* Semua tier sejak 25 Agustus 2026 — tidak ada lagi gerbang Pro di editor ini. */}
          <div className="editor-actions">
            <button type="button" className="button" onClick={startAnnotate} disabled={isBusy}>
              <SignatureIcon size={17} />
              <span>Anotasi & Tanda Tangan</span>
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
