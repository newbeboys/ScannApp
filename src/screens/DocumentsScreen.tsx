import { ScanIcon, TrashIcon } from '../components/Icons'
import { PageImage } from '../components/PageImage'
import type { LocalScanDocument } from '../lib/scanStorage'

interface DocumentsScreenProps {
  documents: LocalScanDocument[]
  onDelete: (id: string) => void
}

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function DocumentsScreen({ documents, onDelete }: DocumentsScreenProps) {
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

      {documents.length === 0 ? (
        <p className="empty-note">Belum ada dokumen tersimpan.</p>
      ) : (
        <ul className="doc-list">
          {documents.map((doc) => (
            <li key={doc.id} className="doc-row">
              <div className="doc-row__preview">
                <PageImage source={doc.pagePaths[0]} alt={doc.title} />
              </div>
              <div className="doc-row__meta">
                <h3>{doc.title}</h3>
                <p>
                  {doc.pageCount} halaman · {dateFormatter.format(new Date(doc.createdAt))}
                </p>
              </div>
              <button
                type="button"
                className="icon-button icon-button--danger"
                onClick={() => onDelete(doc.id)}
                aria-label={`Hapus ${doc.title}`}
              >
                <TrashIcon size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
