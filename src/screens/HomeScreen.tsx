import { PageImage } from '../components/PageImage'
import { ScanIcon } from '../components/Icons'
import type { LocalScanDocument } from '../lib/scanStorage'

interface HomeScreenProps {
  documents: LocalScanDocument[]
  isScanning: boolean
  canScan: boolean
  onScan: () => void
  onOpenDocuments: () => void
}

export function HomeScreen({
  documents,
  isScanning,
  canScan,
  onScan,
  onOpenDocuments,
}: HomeScreenProps) {
  const recent = documents.slice(0, 4)

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
          {documents.length > 0 && (
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
            {recent.map((doc) => (
              <article key={doc.id} className="doc-tile">
                <div className="doc-tile__preview">
                  <PageImage source={doc.pagePaths[0]} alt={doc.title} />
                </div>
                <h3>{doc.title}</h3>
                <p>{doc.pageCount} halaman</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
