import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth/useAuth'
import { BottomNav, type TabId } from './components/BottomNav'
import { ExportSheet } from './components/ExportSheet'
import { exportDocument, type ExportFormat } from './lib/documentExport'
import { mergeDocuments } from './lib/documentMerge'
import { scanDocument } from './lib/documentScanner'
import {
  deleteAllScanDocuments,
  deleteScanDocument,
  listScanDocuments,
  saveScanDocument,
  type LocalScanDocument,
} from './lib/scanStorage'
import { AuthScreen, type AuthMode } from './screens/AuthScreen'
import { DocumentDetailScreen } from './screens/DocumentDetailScreen'
import { DocumentsScreen } from './screens/DocumentsScreen'
import { EditorScreen } from './screens/EditorScreen'
import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LandingScreen } from './screens/LandingScreen'
import { MergeScreen } from './screens/MergeScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SplashScreen } from './screens/SplashScreen'

/** Which full-screen flow is on top of the tabs, if any. */
type View =
  | { kind: 'tabs' }
  | { kind: 'detail'; id: string }
  | { kind: 'editor'; id: string }
  | { kind: 'merge' }

/** Which screen the signed-out visitor is looking at. */
type AuthView = { kind: 'landing' } | { kind: 'auth'; mode: AuthMode } | { kind: 'forgot' }

function App() {
  const { status, tier, signOut } = useAuth()
  const [authView, setAuthView] = useState<AuthView>({ kind: 'landing' })
  const [tab, setTab] = useState<TabId>('home')
  const [view, setView] = useState<View>({ kind: 'tabs' })
  const [documents, setDocuments] = useState<LocalScanDocument[]>([])
  const [pendingPages, setPendingPages] = useState<string[] | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [isScanning, setIsScanning] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
  const [exportTarget, setExportTarget] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const isNative = Capacitor.isNativePlatform()

  const refreshDocuments = useCallback(async () => {
    setDocuments(await listScanDocuments())
  }, [])

  useEffect(() => {
    if (status !== 'signed-in') return
    refreshDocuments()
  }, [refreshDocuments, status])

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
    setView({ kind: 'tabs' })
    setToast('Dokumen dihapus.')
  }

  const handleDeleteAll = async () => {
    if (!confirm('Hapus semua dokumen tersimpan? Tindakan ini tidak bisa dibatalkan.')) return
    await deleteAllScanDocuments()
    await refreshDocuments()
    setToast('Semua dokumen dihapus.')
  }

  const handleExport = async (format: ExportFormat) => {
    const doc = documents.find((entry) => entry.id === exportTarget)
    if (!doc) return
    setIsExporting(true)
    try {
      const result = await exportDocument(doc, format, tier)
      setExportTarget(null)
      setToast(result.message)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal mengekspor dokumen.')
    } finally {
      setIsExporting(false)
    }
  }

  const handleSeedSamples = async () => {
    const { seedSampleDocuments } = await import('./lib/devSampleDocs')
    const count = await seedSampleDocuments()
    await refreshDocuments()
    setTab('documents')
    setToast(`${count} dokumen contoh dibuat.`)
  }

  const handleMerge = async (ids: string[]) => {
    const chosen = ids
      .map((id) => documents.find((doc) => doc.id === id))
      .filter((doc): doc is LocalScanDocument => doc !== undefined)

    setIsMerging(true)
    try {
      const merged = await mergeDocuments(chosen, tier)
      await refreshDocuments()
      setView({ kind: 'detail', id: merged.id })
      setToast(`Dokumen digabung — ${merged.pageCount} halaman.`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal menggabungkan dokumen.')
    } finally {
      setIsMerging(false)
    }
  }

  /** Keeps the open detail/editor screen pointed at fresh data after an edit. */
  const activeDocument =
    view.kind === 'tabs' || view.kind === 'merge'
      ? null
      : (documents.find((doc) => doc.id === view.id) ?? null)

  const applyDocumentChange = (updated: LocalScanDocument) => {
    setDocuments((existing) =>
      existing.map((doc) => (doc.id === updated.id ? updated : doc)),
    )
  }

  /** Local files stay on the device; only the session is dropped. */
  const handleSignOut = async () => {
    if (!confirm('Keluar dari akun ini? Dokumen yang tersimpan di HP tidak ikut terhapus.')) return
    try {
      await signOut()
      setTab('home')
      setView({ kind: 'tabs' })
      setAuthView({ kind: 'landing' })
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal keluar.')
    }
  }

  const exportDoc = documents.find((doc) => doc.id === exportTarget) ?? null
  const exportSheet = exportDoc && (
    <ExportSheet
      pageCount={exportDoc.pageCount}
      tier={tier}
      isBusy={isExporting}
      onExport={handleExport}
      onClose={() => setExportTarget(null)}
    />
  )

  if (status === 'loading') {
    return (
      <div className="app">
        <SplashScreen />
      </div>
    )
  }

  if (status === 'signed-out') {
    return (
      <div className="app">
        {authView.kind === 'landing' && (
          <LandingScreen
            onSignUp={() => setAuthView({ kind: 'auth', mode: 'signup' })}
            onSignIn={() => setAuthView({ kind: 'auth', mode: 'signin' })}
          />
        )}
        {authView.kind === 'auth' && (
          <AuthScreen
            mode={authView.mode}
            onModeChange={(mode) => setAuthView({ kind: 'auth', mode })}
            onBack={() => setAuthView({ kind: 'landing' })}
            onForgotPassword={() => setAuthView({ kind: 'forgot' })}
          />
        )}
        {authView.kind === 'forgot' && (
          <ForgotPasswordScreen onBack={() => setAuthView({ kind: 'auth', mode: 'signin' })} />
        )}
      </div>
    )
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

  if (view.kind === 'merge') {
    return (
      <div className="app">
        <MergeScreen
          documents={documents}
          tier={tier}
          isBusy={isMerging}
          onCancel={() => setView({ kind: 'tabs' })}
          onMerge={handleMerge}
        />
        {toast && <p className="toast">{toast}</p>}
      </div>
    )
  }

  if (activeDocument && view.kind === 'editor') {
    return (
      <div className="app">
        <EditorScreen
          document={activeDocument}
          onDocumentChange={applyDocumentChange}
          onClose={() => setView({ kind: 'detail', id: activeDocument.id })}
          onError={setToast}
        />
        {toast && <p className="toast">{toast}</p>}
      </div>
    )
  }

  if (activeDocument && view.kind === 'detail') {
    return (
      <div className="app">
        <DocumentDetailScreen
          document={activeDocument}
          onBack={() => setView({ kind: 'tabs' })}
          onEdit={() => setView({ kind: 'editor', id: activeDocument.id })}
          onExport={() => setExportTarget(activeDocument.id)}
          onDelete={() => handleDelete(activeDocument.id)}
        />
        {exportSheet}
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
            onOpenDocument={(id) => setView({ kind: 'detail', id })}
          />
        )}
        {tab === 'documents' && (
          <DocumentsScreen
            documents={documents}
            onDelete={handleDelete}
            onOpen={(id) => setView({ kind: 'detail', id })}
            onMerge={() => setView({ kind: 'merge' })}
          />
        )}
        {tab === 'settings' && (
          <SettingsScreen
            documentCount={documents.length}
            onDeleteAll={handleDeleteAll}
            onSignOut={handleSignOut}
          />
        )}
      </main>

      {!isNative && (
        <p className="platform-note">Pemindaian dokumen hanya berfungsi di aplikasi Android.</p>
      )}

      {import.meta.env.DEV && !isNative && (
        <div className="dev-bar">
          <span>Mode dev — buat dokumen contoh untuk mencoba editor & ekspor.</span>
          <button type="button" onClick={handleSeedSamples}>
            Buat contoh
          </button>
        </div>
      )}

      {exportSheet}

      {toast && <p className="toast">{toast}</p>}

      <BottomNav active={tab} onChange={setTab} />
    </div>
  )
}

export default App
