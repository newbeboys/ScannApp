import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useAuth } from './auth/useAuth'
import { BottomNav, type TabId } from './components/BottomNav'
import { ExportSheet } from './components/ExportSheet'
import { resetScanCount } from './lib/ads/adFrequency'
import { maybeShowInterstitial } from './lib/ads/adsService'
import { useAdBanner } from './lib/ads/useAdBanner'
import {
  backupDocument,
  deleteBackup,
  fetchStorageUsage,
  listCloudBackups,
} from './lib/backupApi'
import { quotaBytesFor } from './lib/storageQuota'
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
import { CloudBackupScreen } from './screens/CloudBackupScreen'
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
import { UpgradeScreen } from './screens/UpgradeScreen'

/** Which full-screen flow is on top of the tabs, if any. */
type View =
  | { kind: 'tabs' }
  | { kind: 'detail'; id: string }
  | { kind: 'editor'; id: string }
  | { kind: 'merge' }
  | { kind: 'backups' }
  | { kind: 'upgrade' }

/** Which screen the signed-out visitor is looking at. */
type AuthView = { kind: 'landing' } | { kind: 'auth'; mode: AuthMode } | { kind: 'forgot' }

function App() {
  const { status, tier, profile, signOut, refreshProfile } = useAuth()
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
  /** Sizes of documents that have a cloud copy, keyed by document id. */
  const [backedUp, setBackedUp] = useState<Record<string, number>>({})
  const [backupBusyId, setBackupBusyId] = useState<string | null>(null)
  const [usedBytes, setUsedBytes] = useState(0)
  const isNative = Capacitor.isNativePlatform()
  const quotaBytes = quotaBytesFor(profile)

  // Banner only on the tab screens — never over a scan review, editor, merge
  // or paywall, where it would sit in the middle of a task (spec Bagian 3.3).
  const bannerPx = useAdBanner(
    status === 'signed-in' && view.kind === 'tabs' && pendingPages === null,
    tier,
  )

  const refreshDocuments = useCallback(async () => {
    setDocuments(await listScanDocuments())
  }, [])

  /** Which local documents already have a cloud copy, and how big it is. */
  const refreshBackupState = useCallback(async () => {
    const [backups, usage] = await Promise.all([listCloudBackups(), fetchStorageUsage()])

    setBackedUp(Object.fromEntries(backups.map((backup) => [backup.id, backup.sizeBytes])))
    setUsedBytes(usage?.usedBytes ?? 0)
  }, [])

  useEffect(() => {
    if (status !== 'signed-in') return
    refreshDocuments()
    refreshBackupState()
  }, [refreshDocuments, refreshBackupState, status])

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
      // Counted per saved document, not per scanner launch: a cancelled scan
      // produced nothing, so it should not cost the user an ad.
      void maybeShowInterstitial('scan-saved', tier)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal menyimpan dokumen.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    const hadBackup = id in backedUp
    await deleteScanDocument(id)
    await refreshDocuments()
    setView({ kind: 'tabs' })
    // The cloud copy is deliberately kept — surviving a local delete is the
    // whole point of a backup — but say so, or it looks like a leak.
    setToast(hadBackup ? 'Dokumen dihapus dari HP. Cadangan di cloud tetap ada.' : 'Dokumen dihapus.')
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
      // After delivery, so the ad never races the Android share sheet.
      void maybeShowInterstitial('export-finished', tier)
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
    view.kind === 'tabs' ||
    view.kind === 'merge' ||
    view.kind === 'backups' ||
    view.kind === 'upgrade'
      ? null
      : (documents.find((doc) => doc.id === view.id) ?? null)

  const applyDocumentChange = (updated: LocalScanDocument) => {
    setDocuments((existing) =>
      existing.map((doc) => (doc.id === updated.id ? updated : doc)),
    )
  }

  const handleBackup = async (doc: LocalScanDocument) => {
    setBackupBusyId(doc.id)
    try {
      await backupDocument(doc, tier)
      await refreshBackupState()
      setToast('Dokumen tercadang di cloud.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal mencadangkan dokumen.')
    } finally {
      setBackupBusyId(null)
    }
  }

  /** Removes the cloud copy only — the document stays on the phone. */
  const handleRemoveBackup = async (id: string) => {
    if (!confirm('Hapus cadangan dari cloud? Dokumen di HP tidak ikut terhapus.')) return

    setBackupBusyId(id)
    try {
      await deleteBackup(id)
      await refreshBackupState()
      setToast('Cadangan dihapus dari cloud.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal menghapus cadangan.')
    } finally {
      setBackupBusyId(null)
    }
  }

  /** Local files stay on the device; only the session is dropped. */
  const handleSignOut = async () => {
    if (!confirm('Keluar dari akun ini? Dokumen yang tersimpan di HP tidak ikut terhapus.')) return
    try {
      await signOut()
      // The scan counter is per person, not per device — the next account to
      // sign in should not inherit someone else's progress toward an ad.
      resetScanCount()
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

  if (view.kind === 'upgrade') {
    return (
      <div className="app">
        <UpgradeScreen
          onClose={() => setView({ kind: 'tabs' })}
          onUpgraded={() => {
            // Tier ditulis webhook RevenueCat, bukan oleh client — jadi
            // profil dibaca ulang beberapa kali sampai entitlement mendarat.
            void refreshProfile({ untilPro: true })
            refreshBackupState()
          }}
          onNotice={setToast}
        />
        {toast && <p className="toast">{toast}</p>}
      </div>
    )
  }

  if (view.kind === 'backups') {
    return (
      <div className="app">
        <CloudBackupScreen
          quotaBytes={quotaBytes}
          onBack={() => {
            refreshBackupState()
            setView({ kind: 'tabs' })
          }}
          onError={setToast}
          onNotice={setToast}
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
          onUpgrade={() => setView({ kind: 'upgrade' })}
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
          backupStatus={
            backupBusyId === activeDocument.id
              ? 'working'
              : activeDocument.id in backedUp
                ? 'backed-up'
                : 'local'
          }
          backupSizeBytes={backedUp[activeDocument.id] ?? null}
          onBack={() => setView({ kind: 'tabs' })}
          onEdit={() => setView({ kind: 'editor', id: activeDocument.id })}
          onExport={() => setExportTarget(activeDocument.id)}
          onDelete={() => handleDelete(activeDocument.id)}
          onBackup={() => handleBackup(activeDocument)}
          onRemoveBackup={() => handleRemoveBackup(activeDocument.id)}
        />
        {exportSheet}
        {toast && <p className="toast">{toast}</p>}
      </div>
    )
  }

  return (
    // The banner is a native view laid over the WebView, so its height has to
    // be handed to CSS explicitly — nothing in the layout can measure it.
    <div className="app" style={{ '--ad-banner-height': `${bannerPx}px` } as CSSProperties}>
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
            usedBytes={usedBytes}
            quotaBytes={quotaBytes}
            onDeleteAll={handleDeleteAll}
            onSignOut={handleSignOut}
            onOpenBackups={() => setView({ kind: 'backups' })}
            onUpgrade={() => setView({ kind: 'upgrade' })}
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
