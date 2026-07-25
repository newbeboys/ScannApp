import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useState } from 'react'
import { BottomNav, type TabId } from './components/BottomNav'
import { scanDocument } from './lib/documentScanner'
import {
  deleteAllScanDocuments,
  deleteScanDocument,
  listScanDocuments,
  saveScanDocument,
  type LocalScanDocument,
} from './lib/scanStorage'
import { DocumentsScreen } from './screens/DocumentsScreen'
import { HomeScreen } from './screens/HomeScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'

function App() {
  const [tab, setTab] = useState<TabId>('home')
  const [documents, setDocuments] = useState<LocalScanDocument[]>([])
  const [pendingPages, setPendingPages] = useState<string[] | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [isScanning, setIsScanning] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const isNative = Capacitor.isNativePlatform()

  const refreshDocuments = useCallback(async () => {
    setDocuments(await listScanDocuments())
  }, [])

  useEffect(() => {
    refreshDocuments()
  }, [refreshDocuments])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  const runScanner = async (): Promise<string[] | null> => {
    setIsScanning(true)
    try {
      const result = await scanDocument()
      if (Array.isArray(result)) return result
      if (result.reason === 'error') {
        setToast(result.message ?? 'Gagal membuka pemindai.')
      }
      return null
    } finally {
      setIsScanning(false)
    }
  }

  const handleStartScan = async () => {
    const pages = await runScanner()
    if (!pages) return
    setPendingPages(pages)
    setCurrentPage(0)
  }

  const handleAddPages = async () => {
    const pages = await runScanner()
    if (!pages) return
    setPendingPages((existing) => [...(existing ?? []), ...pages])
  }

  const handleRemovePage = (index: number) => {
    setPendingPages((existing) => {
      if (!existing) return existing
      const next = existing.filter((_, i) => i !== index)
      return next.length > 0 ? next : null
    })
    setCurrentPage((current) => (current > 0 ? current - 1 : 0))
  }

  const handleSaveDocument = async () => {
    if (!pendingPages) return
    setIsSaving(true)
    try {
      await saveScanDocument(pendingPages)
      await refreshDocuments()
      setPendingPages(null)
      setTab('documents')
      setToast('Dokumen tersimpan.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal menyimpan dokumen.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    await deleteScanDocument(id)
    await refreshDocuments()
    setToast('Dokumen dihapus.')
  }

  const handleDeleteAll = async () => {
    if (!confirm('Hapus semua dokumen tersimpan? Tindakan ini tidak bisa dibatalkan.')) return
    await deleteAllScanDocuments()
    await refreshDocuments()
    setToast('Semua dokumen dihapus.')
  }

  if (pendingPages) {
    return (
      <div className="app">
        <ReviewScreen
          pages={pendingPages}
          currentIndex={currentPage}
          isBusy={isSaving || isScanning}
          onSelectPage={setCurrentPage}
          onRemovePage={handleRemovePage}
          onAddPages={handleAddPages}
          onCancel={() => setPendingPages(null)}
          onSave={handleSaveDocument}
        />
        {toast && <p className="toast">{toast}</p>}
      </div>
    )
  }

  return (
    <div className="app">
      <main className="app__body">
        {tab === 'home' && (
          <HomeScreen
            documents={documents}
            isScanning={isScanning}
            canScan={isNative}
            onScan={handleStartScan}
            onOpenDocuments={() => setTab('documents')}
          />
        )}
        {tab === 'documents' && (
          <DocumentsScreen documents={documents} onDelete={handleDelete} />
        )}
        {tab === 'settings' && (
          <SettingsScreen documentCount={documents.length} onDeleteAll={handleDeleteAll} />
        )}
      </main>

      {!isNative && (
        <p className="platform-note">Pemindaian dokumen hanya berfungsi di aplikasi Android.</p>
      )}

      {toast && <p className="toast">{toast}</p>}

      <BottomNav active={tab} onChange={setTab} />
    </div>
  )
}

export default App
