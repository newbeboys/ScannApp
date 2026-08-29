import { useEffect, useRef } from 'react'
import { CheckIcon, CloudIcon, DownloadIcon, ExportIcon, MergeIcon, ScanIcon, TrashIcon } from '../components/Icons'
import { PageImage } from '../components/PageImage'
import type { DocumentEntry } from '../lib/documentEntries'
import {
  isAllSelected,
  isSelectable,
  LONG_PRESS_MOVE_PX,
  LONG_PRESS_MS,
  summarizeSelection,
} from '../lib/documentSelection'
import { formatBytes } from '../lib/formatBytes'
import { resolvePage } from '../lib/scanStorage'
import type { Tier } from '../lib/tier'

interface DocumentsScreenProps {
  entries: DocumentEntry[]
  tier: Tier
  /** Which document is being fetched back from the cloud right now. */
  restoringId: string | null
  isRestoringAll: boolean
  /** Whether the Documents tab is in select mode right now. */
  selectMode: boolean
  /** Ids ticked in the current selection. */
  selectedIds: string[]
  /** Whether a batch export or bulk delete is running. */
  isBatchBusy: boolean
  onDelete: (id: string) => void
  onOpen: (id: string) => void
  onRestore: (id: string) => void
  onRestoreAll: () => void
  onMerge: () => void
  /**
   * Enters select mode. An empty string means "enter without ticking
   * anything" — that is how the header's "Pilih" button calls this; a long
   * press on a row calls it with that row's id instead, which also ticks it.
   */
  onEnterSelect: (id: string) => void
  onToggleSelect: (id: string) => void
  /** Ticks every local document, or clears the lot — see `toggleSelectAll`. */
  onToggleSelectAll: () => void
  onExitSelect: () => void
  onBatchExport: () => void
  onBatchDelete: () => void
  onNotice: (message: string) => void
}

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function DocumentsScreen({
  entries,
  tier,
  restoringId,
  isRestoringAll,
  selectMode,
  selectedIds,
  isBatchBusy,
  onDelete,
  onOpen,
  onRestore,
  onRestoreAll,
  onMerge,
  onEnterSelect,
  onToggleSelect,
  onToggleSelectAll,
  onExitSelect,
  onBatchExport,
  onBatchDelete,
  onNotice,
}: DocumentsScreenProps) {
  const localCount = entries.filter((entry) => entry.kind === 'local').length
  const cloudCount = entries.length - localCount
  const busy = isRestoringAll || restoringId !== null

  const pressTimer = useRef<number | null>(null)
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  /**
   * A long press is followed by a real `click` from the same finger. Without
   * this, selecting a document would also open it.
   */
  const swallowClick = useRef(false)

  const cancelPress = () => {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
    pressOrigin.current = null
  }

  /**
   * A pending long press must not outlive the row that started it. Without
   * this, switching tabs mid-press lets the timeout fire after unmount and
   * silently re-enter select mode — after `App.tsx` has already exited it on
   * the tab change.
   */
  useEffect(() => {
    return () => {
      if (pressTimer.current !== null) clearTimeout(pressTimer.current)
    }
  }, [])

  const startPress = (entry: DocumentEntry) => (event: React.PointerEvent) => {
    // Already selecting: a tap is a toggle, and there is nothing to enter.
    if (selectMode) return

    swallowClick.current = false
    pressOrigin.current = { x: event.clientX, y: event.clientY }
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null
      swallowClick.current = true

      if (!isSelectable(entry)) {
        // Silence here reads as a broken app: the row simply would not respond.
        onNotice('Pulihkan dulu ke HP sebelum bisa dipilih.')
        return
      }

      onEnterSelect(entry.id)
    }, LONG_PRESS_MS)
  }

  /** A finger that travels is scrolling the list, not holding a row. */
  const trackPress = (event: React.PointerEvent) => {
    const origin = pressOrigin.current
    if (!origin) return
    if (
      Math.abs(event.clientX - origin.x) > LONG_PRESS_MOVE_PX ||
      Math.abs(event.clientY - origin.y) > LONG_PRESS_MOVE_PX
    ) {
      cancelPress()
    }
  }

  const handleRowClick = (entry: DocumentEntry) => () => {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    if (selectMode) {
      if (isSelectable(entry)) onToggleSelect(entry.id)
      return
    }
    if (entry.kind === 'local') onOpen(entry.id)
    else onRestore(entry.id)
  }

  const selection = summarizeSelection(entries, selectedIds)
  const allSelected = isAllSelected(entries, selectedIds)
  /* Same condition as the bar itself below, so the two cannot drift apart. */
  const showSelectBar = selectMode && selection.count > 0
  const pressHandlers = (entry: DocumentEntry) => ({
    onPointerDown: startPress(entry),
    onPointerMove: trackPress,
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onPointerLeave: cancelPress,
  })

  return (
    <div className={`screen${showSelectBar ? ' screen--select-bar' : ''}`}>
      {selectMode ? (
        <header className="app-header app-header--select">
          <div className="app-header__titles">
            <h1>
              {selection.count} dipilih · {selection.pageCount} halaman
            </h1>
          </div>
          {/*
            Ticking ten documents one at a time is ten taps, which is what
            this replaces (diminta Boss Ali 25 Agustus 2026). One button, not
            two: the label follows the state, so there is never a dead
            "Semua" sitting next to a full selection.
          */}
          {entries.some(isSelectable) && (
            <button
              type="button"
              className="link-button"
              onClick={onToggleSelectAll}
              disabled={isBatchBusy}
            >
              {allSelected ? 'Kosongkan' : 'Semua'}
            </button>
          )}
          {/*
            Every other action-bar control disables while a batch op runs;
            this one didn't. Tapping it mid-delete cleared select mode while
            the delete loop kept going, briefly exposing the normal per-row
            controls for documents that were still being deleted.
          */}
          <button
            type="button"
            className="link-button"
            onClick={onExitSelect}
            disabled={isBatchBusy}
          >
            Batal
          </button>
        </header>
      ) : (
        <header className="app-header">
          <div className="app-header__badge">
            <ScanIcon size={22} />
          </div>
          <div className="app-header__titles">
            <h1>ScannApp</h1>
            <p>Semua dokumen tersimpan</p>
          </div>
          {entries.some(isSelectable) && (
            <button type="button" className="link-button" onClick={() => onEnterSelect('')}>
              Pilih
            </button>
          )}
          <span className="app-header__tier">{tier === 'pro' ? 'Pro' : 'Basic'}</span>
        </header>
      )}

      {/*
        Answers the question the empty list used to raise silently: the
        documents are not gone, they are in the cloud and one tap away. Placed
        above the list because that is where the user is looking for them.
      */}
      {cloudCount > 0 && (
        <div className="cloud-note">
          <div className="cloud-note__icon">
            <CloudIcon size={20} />
          </div>
          <div className="cloud-note__body">
            <h3>
              {cloudCount} dokumen tersimpan di cloud
            </h3>
            <p>Belum ada di HP ini. Ketuk salah satu untuk memulihkannya.</p>
          </div>
          <button
            type="button"
            className="cloud-note__action"
            onClick={onRestoreAll}
            disabled={busy}
          >
            {isRestoringAll ? 'Memulihkan…' : 'Pulihkan semua'}
          </button>
        </div>
      )}

      {/* Merge has its own screen because the order rows are ticked in there is meaningful. */}
      {!selectMode && localCount >= 2 && (
        <div className="editor-actions">
          <button type="button" className="button" onClick={onMerge}>
            <MergeIcon size={17} />
            <span>Gabungkan Dokumen</span>
          </button>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="empty-note">Belum ada dokumen tersimpan.</p>
      ) : (
        <ul className="doc-list">
          {entries.map((entry) =>
            entry.kind === 'local' ? (
              <li key={entry.id} className="doc-row">
                <button
                  type="button"
                  className="doc-row__open"
                  onClick={handleRowClick(entry)}
                  {...pressHandlers(entry)}
                >
                  {selectMode && (
                    <span
                      className={`select-check${selectedIds.includes(entry.id) ? ' select-check--on' : ''}`}
                    >
                      {selectedIds.includes(entry.id) ? <CheckIcon size={14} /> : null}
                    </span>
                  )}
                  <div className="doc-row__preview">
                    <PageImage
                      source={resolvePage(entry.document.pages[0])}
                      alt={entry.document.title}
                    />
                  </div>
                  <div className="doc-row__meta">
                    <h3>{entry.document.title}</h3>
                    <p>
                      {entry.document.pageCount} halaman ·{' '}
                      {dateFormatter.format(new Date(entry.document.createdAt))}
                    </p>
                  </div>
                </button>
                {!selectMode && (
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
                    onClick={() => onDelete(entry.id)}
                    aria-label={`Hapus ${entry.document.title}`}
                  >
                    <TrashIcon size={18} />
                  </button>
                )}
              </li>
            ) : (
              <li
                key={entry.id}
                className={`doc-row doc-row--cloud${selectMode ? ' doc-row--muted' : ''}`}
              >
                <button
                  type="button"
                  className="doc-row__open"
                  onClick={handleRowClick(entry)}
                  disabled={busy}
                  {...pressHandlers(entry)}
                >
                  {/* No page files on this phone yet, so there is nothing to preview. */}
                  <div className="doc-row__preview doc-row__preview--cloud">
                    <CloudIcon size={22} />
                  </div>
                  <div className="doc-row__meta">
                    <h3>{entry.backup.title}</h3>
                    <p>
                      {restoringId === entry.id
                        ? 'Memulihkan…'
                        : `${entry.backup.pageCount} halaman · ${formatBytes(entry.backup.sizeBytes)} · Di cloud`}
                    </p>
                  </div>
                </button>
                {!selectMode && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onRestore(entry.id)}
                    disabled={busy}
                    aria-label={`Pulihkan ${entry.backup.title} ke HP`}
                  >
                    <DownloadIcon size={18} />
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {showSelectBar && (
        <div className="select-bar">
          {/* Semua tier — lihat catatan gerbang tier di `documentExport`. */}
          <button
            type="button"
            className="button button--primary"
            disabled={isBatchBusy}
            onClick={onBatchExport}
          >
            <ExportIcon size={17} />
            <span>Ekspor PDF</span>
          </button>
          <button
            type="button"
            className="button button--danger"
            disabled={isBatchBusy}
            onClick={onBatchDelete}
          >
            <TrashIcon size={17} />
            <span>Hapus</span>
          </button>
        </div>
      )}
    </div>
  )
}
