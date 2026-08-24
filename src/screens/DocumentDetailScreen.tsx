import { useState } from 'react'
import { BackupRow, type BackupStatus } from '../components/BackupRow'
import {
  ChevronLeftIcon,
  CropIcon,
  ExportIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
} from '../components/Icons'
import { PageImage } from '../components/PageImage'
import { MAX_TITLE_LENGTH } from '../../supabase/functions/_shared/documentTitle'
import { resolvePage, type LocalScanDocument } from '../lib/scanStorage'

interface DocumentDetailScreenProps {
  document: LocalScanDocument
  backupStatus: BackupStatus
  backupSizeBytes: number | null
  isRenaming?: boolean
  onBack: () => void
  onEdit: () => void
  /** Opens the full-screen preview at the page the user tapped. */
  onPreview: (pageIndex: number) => void
  onExport: () => void
  onDelete: () => void
  onBackup: () => void
  onRemoveBackup: () => void
  onRename: (title: string) => void
}

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function DocumentDetailScreen({
  document: doc,
  backupStatus,
  backupSizeBytes,
  isRenaming = false,
  onBack,
  onEdit,
  onPreview,
  onExport,
  onDelete,
  onBackup,
  onRemoveBackup,
  onRename,
}: DocumentDetailScreenProps) {
  const editedCount = doc.pages.filter((page) => page.edited).length
  const [draft, setDraft] = useState<string | null>(null)
  const isEditingName = draft !== null

  const commit = () => {
    // Submitted even when the text is unchanged. That is the only way to retry
    // a cloud sync that failed earlier — the alternative would be re-uploading
    // the whole PDF just to correct a name that is already right on the phone.
    if (draft !== null && draft.trim() !== '') onRename(draft)
    setDraft(null)
  }

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Kembali">
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          {isEditingName ? (
            <form
              className="rename"
              onSubmit={(event) => {
                event.preventDefault()
                commit()
              }}
            >
              <input
                className="rename__input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={MAX_TITLE_LENGTH}
                aria-label="Nama dokumen"
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                onFocus={(event) => event.target.select()}
                // Escape cancels; Enter is handled by the form's submit.
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setDraft(null)
                }}
              />
              <button type="submit" className="rename__save" disabled={draft.trim() === ''}>
                Simpan
              </button>
              <button type="button" className="rename__cancel" onClick={() => setDraft(null)}>
                Batal
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="flow-header__rename"
              onClick={() => setDraft(doc.title)}
              aria-label={`Ubah nama dokumen. Nama sekarang: ${doc.title}`}
            >
              <h1>{doc.title}</h1>
              <PencilIcon size={15} className="flow-header__rename-icon" />
            </button>
          )}
          <p>
            {isRenaming
              ? 'Menyimpan nama baru…'
              : `${doc.pageCount} halaman · ${dateFormatter.format(new Date(doc.createdAt))}`}
          </p>
        </div>
        <button
          type="button"
          className="icon-button icon-button--danger"
          onClick={onDelete}
          aria-label="Hapus dokumen"
        >
          <TrashIcon size={18} />
        </button>
      </header>

      {(editedCount > 0 || doc.sourceDocumentIds) && (
        <p className="detail-note">
          {doc.sourceDocumentIds
            ? `Hasil gabungan dari ${doc.sourceDocumentIds.length} dokumen.`
            : `${editedCount} halaman sudah diedit.`}
        </p>
      )}

      <div className="editor-actions">
        <button type="button" className="button" onClick={() => onPreview(0)}>
          <EyeIcon size={17} />
          <span>Lihat</span>
        </button>
        <button type="button" className="button" onClick={onEdit}>
          <CropIcon size={17} />
          <span>Edit</span>
        </button>
        <button type="button" className="button button--primary" onClick={onExport}>
          <ExportIcon size={17} />
          <span>Ekspor</span>
        </button>
      </div>

      <BackupRow
        status={backupStatus}
        sizeBytes={backupSizeBytes}
        onBackup={onBackup}
        onRemove={onRemoveBackup}
      />

      <div className="doc-grid">
        {doc.pages.map((page, index) => (
          <button
            key={page.original}
            type="button"
            className="doc-tile doc-tile--page"
            onClick={() => onPreview(index)}
            aria-label={`Lihat halaman ${index + 1}`}
          >
            <div className="doc-tile__preview">
              {/* Named by the button around it; a second label would read the page twice. */}
              <PageImage source={resolvePage(page)} alt="" />
            </div>
            <p>Halaman {index + 1}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
