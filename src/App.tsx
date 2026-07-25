import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { scanDocument } from './lib/documentScanner'
import {
  deleteScanDocument,
  getScanPageDisplayUri,
  listScanDocuments,
  saveScanDocument,
  type LocalScanDocument,
} from './lib/scanStorage'

function DocumentThumbnail({ pagePath }: { pagePath: string }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getScanPageDisplayUri(pagePath).then((uri) => {
      if (!cancelled) setSrc(uri)
    })
    return () => {
      cancelled = true
    }
  }, [pagePath])

  if (!src) return <div className="thumb thumb--empty" />
  return <img className="thumb" src={src} alt="" />
}

function App() {
  const [documents, setDocuments] = useState<LocalScanDocument[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isNative = Capacitor.isNativePlatform()

  const refreshDocuments = useCallback(async () => {
    setDocuments(await listScanDocuments())
  }, [])

  useEffect(() => {
    refreshDocuments()
  }, [refreshDocuments])

  const handleScan = async () => {
    setError(null)
    setIsScanning(true)
    try {
      const result = await scanDocument()
      if (Array.isArray(result)) {
        await saveScanDocument(result)
        await refreshDocuments()
      } else if (result.reason === 'error') {
        setError(result.message ?? 'Gagal memindai dokumen.')
      }
      // reason === 'cancelled': user backed out of the scanner, nothing to do
    } finally {
      setIsScanning(false)
    }
  }

  const handleDelete = async (id: string) => {
    await deleteScanDocument(id)
    await refreshDocuments()
  }

  return (
    <main className="scan-app">
      <header className="scan-app__header">
        <h1>ScannApp</h1>
        <p>Fase 1 — Capture &amp; Processing Engine</p>
      </header>

      {!isNative && (
        <p className="scan-app__notice">
          Fitur scan dokumen (ML Kit) hanya berjalan di build Android, bukan di browser.
        </p>
      )}

      <button
        type="button"
        className="scan-app__scan-button"
        onClick={handleScan}
        disabled={!isNative || isScanning}
      >
        {isScanning ? 'Memindai…' : 'Scan Dokumen'}
      </button>

      {error && <p className="scan-app__error">{error}</p>}

      <section className="scan-app__documents">
        <h2>Dokumen Tersimpan ({documents.length})</h2>
        {documents.length === 0 ? (
          <p className="scan-app__empty">Belum ada dokumen. Mulai scan untuk menambahkan.</p>
        ) : (
          <ul className="scan-app__document-list">
            {documents.map((doc) => (
              <li key={doc.id} className="scan-app__document-item">
                <DocumentThumbnail pagePath={doc.pagePaths[0]} />
                <div className="scan-app__document-meta">
                  <strong>{doc.title}</strong>
                  <p>
                    {doc.pageCount} halaman · {new Date(doc.createdAt).toLocaleString('id-ID')}
                  </p>
                </div>
                <button type="button" onClick={() => handleDelete(doc.id)}>
                  Hapus
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

export default App
