import { BackupRow, type BackupStatus } from '../components/BackupRow'
import { ChevronLeftIcon, CropIcon, ExportIcon, TrashIcon } from '../components/Icons'
import { PageImage } from '../components/PageImage'
import { resolvePage, type LocalScanDocument } from '../lib/scanStorage'

interface DocumentDetailScreenProps {
  document: LocalScanDocument
  backupStatus: BackupStatus
  backupSizeBytes: number | null
  onBack: () => void
  onEdit: () => void
  onExport: () => void
  onDelete: () => void
  onBackup: () => void
  onRemoveBackup: () => void
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
  onBack,
  onEdit,
  onExport,
  onDelete,
  onBackup,
  onRemoveBackup,
}: DocumentDetailScreenProps) {
  const editedCount = doc.pages.filter((page) => page.edited).length

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Kembali">
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          <h1>{doc.title}</h1>
          <p>
            {doc.pageCount} halaman · {dateFormatter.format(new Date(doc.createdAt))}
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
          <div key={page.original} className="doc-tile">
            <div className="doc-tile__preview">
              <PageImage source={resolvePage(page)} alt={`Halaman ${index + 1}`} />
            </div>
            <p>Halaman {index + 1}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
