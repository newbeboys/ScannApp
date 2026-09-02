import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckIcon,
  CloseIcon,
  CloudIcon,
  DownloadIcon,
  ExportIcon,
  ImportIcon,
  MergeIcon,
  ScanIcon,
  SearchIcon,
  TrashIcon,
} from '../components/Icons'
import { PageImage } from '../components/PageImage'
import type { DocumentEntry } from '../lib/documentEntries'
import {
  isAllSelected,
  isSelectable,
  LONG_PRESS_MOVE_PX,
  LONG_PRESS_MS,
  summarizeSelection,
} from '../lib/documentSelection'
import { filterEntriesByQuery } from '../lib/documentSearch'
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
  /** Opens the system file picker (folders, Google Drive, etc). */
  onImportFiles: () => void
  /** True while the picker/conversion from onImportFiles is running. */
  isImporting: boolean
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
  onImportFiles,
  isImporting,
}: DocumentsScreenProps) {
  const localCount = entries.filter((entry) => entry.kind === 'local').length
  const cloudCount = entries.length - localCount
  const busy = isRestoringAll || restoringId !== null

  /**
   * Search only ever narrows the rendered rows -- the cloud banner and the
   * merge button above the list keep counting from `entries`, not this, so
   * typing a query never makes "Gabungkan Dokumen" flicker away because the
   * filtered local count momentarily dropped below two.
   *
   * Hidden entirely in select mode rather than kept and filtered: an active
   * search narrowing what "Semua" ticks while the header no longer shows the
   * field that caused it would be confusing, so search and select simply
   * don't overlap.
   */
  const [searchQuery, setSearchQuery] = useState('')
  const visibleEntries = useMemo(
    () => (selectMode ? entries : filterEntriesByQuery(entries, searchQuery)),
    [entries, searchQuery, selectMode],
  )

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
          <button
            type="button"
            className="app-header__icon-btn"
            onClick={onImportFiles}
            disabled={isImporting}
            aria-label="Impor file"
          >
            <ImportIcon size={20} />
          </button>
          {entries.some(isSelectable) && (
            <button type="button" className="link-button" onClick={() => onEnterSelect('')}>
              Pilih
            </button>
          )}
          <span className="app-header__tier">{tier === 'pro' ? 'Pro' : 'Basic'}</span>
        </header>
      )}

      {/* Hidden in select mode -- see the comment on `visibleEntries` above. */}
      {!selectMode && entries.length > 0 && (
        <div className="search-field">
          <SearchIcon size={18} className="search-field__icon" />
          <input
            type="search"
            inputMode="search"
            className="field__input"
            placeholder="Cari nama dokumen"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="Cari nama dokumen"
          />
          {searchQuery !== '' && (
            <button
              type="button"
              className="field__reveal"
              onClick={() => setSearchQuery('')}
              aria-label="Bersihkan pencarian"
            >
              <CloseIcon size={14} />
            </button>
          )}
        </div>
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
      ) : visibleEntries.length === 0 ? (
        <p className="empty-note">Tidak ada dokumen yang cocok dengan &quot;{searchQuery.trim()}&quot;.</p>
      ) : (
        <ul className="doc-list">
          {visibleEntries.map((entry) =>
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
