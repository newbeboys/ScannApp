import { CloudIcon, DownloadIcon, MergeIcon, ScanIcon, TrashIcon } from '../components/Icons'
import { PageImage } from '../components/PageImage'
import type { DocumentEntry } from '../lib/documentEntries'
import { formatBytes } from '../lib/formatBytes'
import { resolvePage } from '../lib/scanStorage'

interface DocumentsScreenProps {
  entries: DocumentEntry[]
  /** Which document is being fetched back from the cloud right now. */
  restoringId: string | null
  isRestoringAll: boolean
  onDelete: (id: string) => void
  onOpen: (id: string) => void
  onRestore: (id: string) => void
  onRestoreAll: () => void
  onMerge: () => void
}

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function DocumentsScreen({
  entries,
  restoringId,
  isRestoringAll,
  onDelete,
  onOpen,
  onRestore,
  onRestoreAll,
  onMerge,
}: DocumentsScreenProps) {
  const localCount = entries.filter((entry) => entry.kind === 'local').length
  const cloudCount = entries.length - localCount
  const busy = isRestoringAll || restoringId !== null

  return (
    <div className="screen">
      <header className="app-header">
        <div className="app-header__badge">
          <ScanIcon size={22} />
        </div>
        <div className="app-header__titles">
          <h1>ScannApp</h1>
          <p>Semua dokumen tersimpan</p>
        </div>
        <span className="app-header__tier">Basic</span>
      </header>

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

      {localCount >= 2 && (
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
                <button type="button" className="doc-row__open" onClick={() => onOpen(entry.id)}>
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
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  onClick={() => onDelete(entry.id)}
                  aria-label={`Hapus ${entry.document.title}`}
                >
                  <TrashIcon size={18} />
                </button>
              </li>
            ) : (
              <li key={entry.id} className="doc-row doc-row--cloud">
                <button
                  type="button"
                  className="doc-row__open"
                  onClick={() => onRestore(entry.id)}
                  disabled={busy}
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
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onRestore(entry.id)}
                  disabled={busy}
                  aria-label={`Pulihkan ${entry.backup.title} ke HP`}
                >
                  <DownloadIcon size={18} />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  )
}
