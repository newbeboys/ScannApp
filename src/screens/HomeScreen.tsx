import { PageImage } from '../components/PageImage'
import { CloudIcon, ScanIcon } from '../components/Icons'
import type { DocumentEntry } from '../lib/documentEntries'
import { resolvePage } from '../lib/scanStorage'

interface HomeScreenProps {
  entries: DocumentEntry[]
  /** Which document is being fetched back from the cloud right now. */
  restoringId: string | null
  isRestoringAll: boolean
  isScanning: boolean
  canScan: boolean
  onScan: () => void
  onOpenDocuments: () => void
  onOpenDocument: (id: string) => void
  onRestore: (id: string) => void
}

export function HomeScreen({
  entries,
  restoringId,
  isRestoringAll,
  isScanning,
  canScan,
  onScan,
  onOpenDocuments,
  onOpenDocument,
  onRestore,
}: HomeScreenProps) {
  const recent = entries.slice(0, 4)
  const busy = isRestoringAll || restoringId !== null

  return (
    <div className="screen">
      <header className="app-header">
        <div className="app-header__badge">
          <ScanIcon size={22} />
        </div>
        <div className="app-header__titles">
          <h1>ScannApp</h1>
          <p>Digitalkan dokumen apa saja</p>
        </div>
        <span className="app-header__tier">Basic</span>
      </header>

      <button type="button" className="scan-hero" onClick={onScan} disabled={!canScan || isScanning}>
        <span className="scan-hero__glow" aria-hidden="true" />
        <span className="scan-hero__icon">
          <ScanIcon size={26} />
        </span>
        <span className="scan-hero__title">
          {isScanning ? 'Membuka pemindai…' : 'Pindai Dokumen Baru'}
        </span>
        <span className="scan-hero__subtitle">New scan · deteksi tepi otomatis</span>
      </button>

      <section className="section">
        <div className="section__head">
          <h2>Terakhir Dipindai</h2>
          {entries.length > 0 && (
            <button type="button" className="section__action" onClick={onOpenDocuments}>
              Lihat semua
            </button>
          )}
        </div>

        {recent.length === 0 ? (
          <p className="empty-note">
            Belum ada dokumen. Ketuk tombol di atas untuk memindai yang pertama.
          </p>
        ) : (
          <div className="doc-grid">
            {recent.map((entry) =>
              entry.kind === 'local' ? (
                <button
                  key={entry.id}
                  type="button"
                  className="doc-tile"
                  onClick={() => onOpenDocument(entry.id)}
                >
                  <div className="doc-tile__preview">
                    <PageImage
                      source={resolvePage(entry.document.pages[0])}
                      alt={entry.document.title}
                    />
                  </div>
                  <h3>{entry.document.title}</h3>
                  <p>{entry.document.pageCount} halaman</p>
                </button>
              ) : (
                <button
                  key={entry.id}
                  type="button"
                  className="doc-tile doc-tile--cloud"
                  onClick={() => onRestore(entry.id)}
                  disabled={busy}
                >
                  {/* Nothing to preview until the pages are on the phone. */}
                  <div className="doc-tile__preview doc-tile__preview--cloud">
                    <CloudIcon size={24} />
                  </div>
                  <h3>{entry.backup.title}</h3>
                  <p>{restoringId === entry.id ? 'Memulihkan…' : 'Di cloud · ketuk untuk pulihkan'}</p>
                </button>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  )
}
