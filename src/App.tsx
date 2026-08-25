import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useAuth } from './auth/useAuth'
import { BatchExportSheet } from './components/BatchExportSheet'
import { BottomNav, type TabId } from './components/BottomNav'
import { ExportSheet } from './components/ExportSheet'
import { CropIcon, ExportIcon } from './components/Icons'
import { resetScanStreak } from './lib/ads/adFrequency'
import { maybeShowInterstitial } from './lib/ads/adsService'
import { useAdBanner } from './lib/ads/useAdBanner'
import { useAppOpenAd } from './lib/ads/useAppOpenAd'
import {
  backupDocument,
  deleteBackup,
  fetchStorageUsage,
  listCloudBackups,
  renameCloudDocument,
  type CloudBackup,
} from './lib/backupApi'
import { restoreBackup } from './lib/cloudRestore'
import { mergeDocumentEntries } from './lib/documentEntries'
import { quotaBytesFor } from './lib/storageQuota'
import { exportDocument, exportDocumentsBatch, type BatchProgress, type ExportFormat } from './lib/documentExport'
import { summarizeSelection, toggleSelectAll, toggleSelection } from './lib/documentSelection'
import { splitDocument } from './lib/documentSplit'
import { estimateExportSizes, type ExportSizeEstimate } from './lib/exportEstimate'
import { readExportLevel, writeExportLevel } from './lib/exportPreference'
import type { CompressionLevel } from './lib/exportLimits'
import { mergeDocuments } from './lib/documentMerge'
import { scanDocument } from './lib/documentScanner'
import { boundaryCuts, everyNCuts, saveSplitScan } from './lib/scanSplit'
import {
  deleteAllScanDocuments,
  deleteScanDocument,
  listScanDocuments,
  pruneUnusedSignatures,
  renameScanDocument,
  resolvePage,
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
import { PageViewerScreen } from './screens/PageViewerScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SplitScanScreen } from './screens/SplitScanScreen'
import { SplashScreen } from './screens/SplashScreen'
import { UpgradeScreen } from './screens/UpgradeScreen'

/** Which full-screen flow is on top of the tabs, if any. */
type View =
  | { kind: 'tabs' }
  | { kind: 'detail'; id: string }
  | { kind: 'editor'; id: string }
  | { kind: 'split'; id: string }
  | { kind: 'viewer'; id: string; pageIndex: number }
  | { kind: 'merge' }
  | { kind: 'backups' }
  | { kind: 'upgrade' }

/** Which screen the signed-out visitor is looking at. */
type AuthView = { kind: 'landing' } | { kind: 'auth'; mode: AuthMode } | { kind: 'forgot' }

function App() {
  const { status, tier, tierResolved, profile, signOut, refreshProfile } = useAuth()
  const [authView, setAuthView] = useState<AuthView>({ kind: 'landing' })
  const [tab, setTab] = useState<TabId>('home')
  const [view, setView] = useState<View>({ kind: 'tabs' })
  const [documents, setDocuments] = useState<LocalScanDocument[]>([])
  const [pendingPages, setPendingPages] = useState<string[] | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  /** Which freshly-scanned page is open full-screen, if any. */
  const [reviewPreview, setReviewPreview] = useState<number | null>(null)
  /** Split screen is on top of the review screen, and what it is holding. */
  const [splitting, setSplitting] = useState(false)
  const [splitCuts, setSplitCuts] = useState<number[]>([])
  const [splitName, setSplitName] = useState('')
  /**
   * How many documents this split session has already saved.
   *
   * Only non-zero after a save that half succeeded: the retry continues the
   * numbering rather than minting a second "Kwitansi (1)".
   */
  const [splitSaved, setSplitSaved] = useState(0)
  const [splitProgress, setSplitProgress] = useState<{ done: number; total: number } | null>(null)
  /**
   * The split screen for a document that is *already saved* — the inverse of
   * Gabungkan Dokumen. Kept apart from the scan-split state above because the
   * two flows can be entered from opposite ends of the app and neither should
   * be able to inherit the other's half-finished cuts or typed name.
   */
  const [docSplitCuts, setDocSplitCuts] = useState<number[]>([])
  const [docSplitName, setDocSplitName] = useState('')
  const [docSplitDeleteOriginal, setDocSplitDeleteOriginal] = useState(false)
  const [isSplittingDoc, setIsSplittingDoc] = useState(false)
  const [docSplitProgress, setDocSplitProgress] = useState<
    { done: number; total: number } | null
  >(null)
  const [isScanning, setIsScanning] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
  const [exportTarget, setExportTarget] = useState<string | null>(null)
  // Read once at mount: what the user chose on a previous export.
  const [exportLevel, setExportLevel] = useState<CompressionLevel>(() => readExportLevel())
  const [exportEstimate, setExportEstimate] = useState<ExportSizeEstimate | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  /** Every document this account has in the cloud, whether or not it is on the phone. */
  const [backups, setBackups] = useState<CloudBackup[]>([])
  const [backupBusyId, setBackupBusyId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [isRestoringAll, setIsRestoringAll] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  /**
   * Whether anything was actually changed in the editor session that is open.
   *
   * "Selesai edit" earns an interstitial, but opening the editor and backing
   * straight out is not an edit — charging an ad for a look would be the kind
   * of unexpected full-screen ad that makes people uninstall.
   */
  const [editedInSession, setEditedInSession] = useState(false)
  const [usedBytes, setUsedBytes] = useState(0)
  /** Documents tab is in select mode, and what is ticked in it right now. */
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  /** Open when the batch export sheet is showing. */
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null)
  const [isBatchBusy, setIsBatchBusy] = useState(false)
  const batchAbort = useRef<AbortController | null>(null)
  const isNative = Capacitor.isNativePlatform()
  const quotaBytes = quotaBytesFor(profile)

  // Banner only on the tab screens — never over a scan review, editor, merge
  // or paywall, where it would sit in the middle of a task (spec Bagian 3.3).
  const bannerPx = useAdBanner(
    status === 'signed-in' && view.kind === 'tabs' && pendingPages === null,
    tier,
  )

  // Waits for `tierResolved`, not just for being signed in: `tier` reads Basic
  // until the profile lands, so a Pro user signing in on a new phone would be
  // met with a full-screen ad they have paid not to see.
  useAppOpenAd(status === 'signed-in' && tierResolved, tier)

  const refreshDocuments = useCallback(async () => {
    setDocuments(await listScanDocuments())
  }, [])

  /** What the account has in the cloud, and how much room it is using. */
  const refreshBackupState = useCallback(async () => {
    const [cloud, usage] = await Promise.all([listCloudBackups(), fetchStorageUsage()])

    setBackups(cloud)
    setUsedBytes(usage?.usedBytes ?? 0)
  }, [])

  /** Sizes of documents that have a cloud copy, keyed by document id. */
  const backedUp = useMemo(
    () => Object.fromEntries(backups.map((backup) => [backup.id, backup.sizeBytes])),
    [backups],
  )

  /**
   * The list the user sees: what is on the phone, plus every backup that is
   * not. Without the second half, a reinstall shows an empty app even though
   * the account still owns the documents.
   */
  const entries = useMemo(
    () => mergeDocumentEntries(documents, backups),
    [documents, backups],
  )

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

  /**
   * Measures what each format would weigh at the chosen level, so the export
   * sheet can put a number next to every option instead of asking the user to
   * trade quality against a size they cannot see.
   *
   * Held back by a short delay rather than started on every step. Each run
   * decodes a full-resolution page and encodes it twice — once of that is
   * cheap, four overlapping copies of it on a low-end phone is not, and a drag
   * from Kecil to Maksimal passes through every stop on the way. `cancelled`
   * covers the run already in flight when the next one starts, so a slower
   * earlier measurement cannot land last and label the wrong level.
   */
  useEffect(() => {
    const doc = documents.find((entry) => entry.id === exportTarget)
    if (!doc) {
      setExportEstimate(null)
      return
    }

    let cancelled = false
    // Cleared straight away: a stale number under a level the user just moved
    // off is worse than no number at all.
    setExportEstimate(null)

    const timer = setTimeout(() => {
      estimateExportSizes(doc, tier, exportLevel)
        .then((sizes) => {
          if (!cancelled) setExportEstimate(sizes)
        })
        .catch(() => {
          // No number is better than a wrong one; the sheet simply shows none.
          if (!cancelled) setExportEstimate(null)
        })
    }, 220)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [documents, exportTarget, exportLevel, tier])

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

  /** Leaves split mode and forgets everything it was holding. */
  const exitSplit = () => {
    setSplitting(false)
    setSplitCuts([])
    setSplitName('')
    setSplitSaved(0)
    setSplitProgress(null)
  }

  const handleStartScan = async () => {
    const pages = await runScanner()
    if (!pages) return
    setPendingPages(pages)
    setCurrentPage(0)
    // A preview left open from the previous scan would reopen over the new one.
    setReviewPreview(null)
    // Same reasoning for the split screen: cuts belong to the scan that made
    // them, and a new scan is a new set of pages.
    exitSplit()
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
      exitSplit()
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

  const handleStartSplit = () => {
    // Opens on "one document per page" — the case the feature exists for — but
    // only when this split session has nothing of its own yet. Re-entering
    // after a save that half succeeded (Kembali, then Pisah again) must keep
    // the cuts rebuilt around what is left, the name that was typed, and
    // `splitSaved`; resetting the last of those would number the retry from
    // "(1)" again, straight into the titles round one already saved.
    setSplitCuts((current) =>
      current.length > 0 ? current : everyNCuts(pendingPages?.length ?? 0, 1),
    )
    setSplitting(true)
  }

  const handleSplitSave = async (groups: string[][]) => {
    setIsSaving(true)
    try {
      const result = await saveSplitScan(groups, splitName, splitSaved, (done, total) =>
        setSplitProgress({ done, total }),
      )
      await refreshDocuments()
      setToast(result.message)

      if (result.remaining.length === 0) {
        setPendingPages(null)
        exitSplit()
        setTab('documents')
      } else {
        // The groups that failed stay on screen with their cuts rebuilt around
        // them, so Simpan can be pressed again without scanning anything twice.
        setPendingPages(result.remaining.flat())
        setSplitCuts(boundaryCuts(result.remaining))
        setSplitSaved((count) => count + result.saved.length)
        setCurrentPage(0)
      }

      // Once for the whole split session, not once per document: written per
      // document, a subscription that lapses later would fire eight
      // interstitials back to back.
      if (result.saved.length > 0) void maybeShowInterstitial('scan-saved', tier)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal menyimpan dokumen.')
    } finally {
      setIsSaving(false)
      setSplitProgress(null)
    }
  }

  const handleDelete = async (id: string) => {
    const hadBackup = id in backedUp
    await deleteScanDocument(id)
    // Signature files live outside any one document because the same signature
    // is stamped across many. Deleting a document can therefore leave the last
    // reference to one behind — nothing else would ever collect it.
    await pruneUnusedSignatures()
    await refreshDocuments()
    setView({ kind: 'tabs' })
    // The cloud copy is deliberately kept — surviving a local delete is the
    // whole point of a backup — but say so, or it looks like a leak.
    setToast(hadBackup ? 'Dokumen dihapus dari HP. Cadangan di cloud tetap ada.' : 'Dokumen dihapus.')
  }

  const handleDeleteAll = async () => {
    if (!confirm('Hapus semua dokumen tersimpan? Tindakan ini tidak bisa dibatalkan.')) return
    const hadBackups = backups.length > 0
    await deleteAllScanDocuments()
    await pruneUnusedSignatures()
    await refreshDocuments()
    // Same reasoning as handleDelete: the cloud copies survive on purpose, and
    // they are about to reappear in the list as restorable — say so first.
    setToast(
      hadBackups
        ? 'Semua dokumen dihapus dari HP. Cadangan di cloud tetap ada.'
        : 'Semua dokumen dihapus.',
    )
  }

  const handleExport = async (format: ExportFormat) => {
    const doc = documents.find((entry) => entry.id === exportTarget)
    if (!doc) return
    setIsExporting(true)
    try {
      const result = await exportDocument(doc, format, tier, exportLevel)
      setExportTarget(null)
      setToast(result.message)
      // No ad here any more. Exporting stopped being a trigger when Boss Ali
      // rewrote the policy on 23 Agustus 2026 — see CLAUDE.md Bagian 6.
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
      // Fired after the result is on screen, so the user sees what they made
      // before the ad rather than after dismissing it.
      void maybeShowInterstitial('merge-finished', tier)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal menggabungkan dokumen.')
    } finally {
      setIsMerging(false)
    }
  }

  /**
   * Opens the split screen on a document that is already saved.
   *
   * Starts on "one document per page", which is the case it exists for: a
   * merge done by mistake, or a stack of receipts scanned as one document.
   * Every separator can still be moved by hand from there.
   */
  const handleOpenDocumentSplit = (doc: LocalScanDocument) => {
    setDocSplitCuts(everyNCuts(doc.pageCount, 1))
    setDocSplitName(doc.title)
    // Off every time this opens. Deleting the source is the one irreversible
    // thing on that screen, so it must never arrive already ticked from a
    // previous document.
    setDocSplitDeleteOriginal(false)
    setView({ kind: 'split', id: doc.id })
  }

  const handleDocumentSplit = async (doc: LocalScanDocument, groups: number[][]) => {
    // Read before the split runs: the delete below takes the row out of the
    // index, and `refreshDocuments` would leave nothing to ask afterwards.
    const hadBackup = doc.id in backedUp

    setIsSplittingDoc(true)
    try {
      const result = await splitDocument(
        doc,
        groups,
        docSplitName,
        { deleteOriginal: docSplitDeleteOriginal },
        (done, total) => setDocSplitProgress({ done, total }),
      )
      await refreshDocuments()
      // The cloud copy survives a local delete on purpose — that is what a
      // backup is for — but saying nothing here makes the original look like
      // it came back from the dead as a "Di cloud" row a moment later. Same
      // reasoning as `handleDelete`.
      setToast(
        result.originalRemoved && hadBackup
          ? `${result.message} Cadangan di cloud tetap ada.`
          : result.message,
      )

      // Anything that landed is worth showing. Only a run that produced
      // nothing at all leaves the user on the split screen to try again —
      // after a partial run the source still holds every page, so pressing
      // Pisah a second time would duplicate the groups that succeeded.
      if (result.saved.length > 0) {
        setTab('documents')
        setView({ kind: 'tabs' })
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal memisah dokumen.')
    } finally {
      setIsSplittingDoc(false)
      setDocSplitProgress(null)
    }
  }

  const exitSelect = () => {
    setSelectMode(false)
    setSelectedIds([])
  }

  const handleEnterSelect = (id: string) => {
    setSelectMode(true)
    // The header's "Pilih" button enters without ticking anything; a long
    // press ticks the row it was held on.
    if (id) setSelectedIds([id])
  }

  const handleBatchExport = async () => {
    const chosen = summarizeSelection(entries, selectedIds).documents
    if (chosen.length === 0) return

    const controller = new AbortController()
    batchAbort.current = controller
    setIsBatchBusy(true)
    try {
      const result = await exportDocumentsBatch(
        chosen,
        tier,
        exportLevel,
        setBatchProgress,
        controller.signal,
      )
      setToast(result.message)
      // The selection survives a partial failure or a stop, so the rest can be
      // retried without re-ticking everything from scratch.
      if (result.failed.length === 0 && !result.cancelled) exitSelect()
      setBatchOpen(false)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal mengekspor dokumen.')
    } finally {
      batchAbort.current = null
      setBatchProgress(null)
      setIsBatchBusy(false)
    }
  }

  const handleBatchDelete = async () => {
    const chosen = summarizeSelection(entries, selectedIds).documents
    if (chosen.length === 0) return
    if (
      !confirm(`Hapus ${chosen.length} dokumen dari HP? Cadangan di cloud tidak ikut terhapus.`)
    ) {
      return
    }

    setIsBatchBusy(true)
    let removed = 0
    try {
      for (const doc of chosen) {
        try {
          await deleteScanDocument(doc.id)
          removed++
        } catch {
          // Counted by the gap between chosen.length and removed below; one
          // document refusing to delete must not hold up the rest.
        }
      }
    } finally {
      try {
        // Once at the end, not per document: a signature is shared across
        // documents, so sweeping it mid-loop could delete a file still
        // referenced by a document that has not been deleted yet.
        await pruneUnusedSignatures()
        await refreshDocuments()
      } catch {
        // The documents are already gone from local storage either way; if
        // this cleanup step fails, the busy flag must still release below
        // rather than getting stuck open on a best-effort step.
      }
      // The busy flag always releases so the action bar never gets stuck
      // disabled, but the selection itself only clears on a clean run —
      // `removed` was declared above the try block, so it is still in scope
      // here even though the count is only known once the loop is done.
      // Same rule as handleBatchExport: a partial failure keeps the
      // selection so the stragglers can be retried without re-ticking them.
      setIsBatchBusy(false)
      if (removed === chosen.length) exitSelect()
    }

    const failed = chosen.length - removed
    setToast(
      failed > 0
        ? `${removed} dokumen dihapus, ${failed} gagal.`
        : `${removed} dokumen dihapus dari HP.`,
    )
  }

  // Select mode belongs to the Documents tab. Leaving for Home and coming
  // back to find the action bar still hanging around would be unexplainable.
  useEffect(() => {
    if (tab !== 'documents') exitSelect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

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

  /**
   * Pulls one cloud-only document back onto the phone.
   *
   * Both lists offer this, and neither hands over the backup itself, so it is
   * looked up here — the id they pass came out of `backups` to begin with.
   */
  const handleRestore = async (id: string) => {
    const backup = backups.find((entry) => entry.id === id)
    if (!backup) return

    setRestoringId(id)
    try {
      const doc = await restoreBackup(backup)
      await refreshDocuments()
      setToast(`"${doc.title}" dipulihkan ke HP — ${doc.pageCount} halaman.`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal memulihkan dokumen.')
    } finally {
      setRestoringId(null)
    }
  }

  /**
   * Restores every document the list shows as cloud-only, one after another.
   *
   * Sequential on purpose: these are whole PDFs over a phone connection, and
   * starting them all at once would only make them compete for the same
   * bandwidth. One failure does not abandon the rest — a single unreadable
   * backup should not keep every other document off the phone.
   */
  const handleRestoreAll = async () => {
    const pending = entries.flatMap((entry) => (entry.kind === 'cloud' ? [entry.backup] : []))
    if (pending.length === 0) return

    setIsRestoringAll(true)
    let restored = 0
    try {
      for (const backup of pending) {
        setRestoringId(backup.id)
        try {
          await restoreBackup(backup)
          restored++
        } catch {
          // Counted by omission — the summary below reports how many failed.
        }
      }
    } finally {
      setRestoringId(null)
      setIsRestoringAll(false)
      // Whatever did land belongs on screen, even if the rest did not.
      await refreshDocuments()
    }

    const failed = pending.length - restored
    if (restored === 0) {
      setToast('Tidak ada dokumen yang berhasil dipulihkan. Periksa koneksi lalu coba lagi.')
    } else if (failed > 0) {
      setToast(`${restored} dokumen dipulihkan, ${failed} gagal. Coba lagi untuk sisanya.`)
    } else {
      setToast(`${restored} dokumen dipulihkan ke HP.`)
    }
  }

  /**
   * Local-first: the name changes on the phone straight away, then we try to
   * point the cloud copy at it. A failed sync is reported but never rolls the
   * local rename back — and the next backup carries the current name up anyway.
   */
  const handleRename = async (id: string, title: string) => {
    setRenamingId(id)
    try {
      const updated = await renameScanDocument(id, title)
      applyDocumentChange(updated)

      // Always asked, never guessed from `backedUp`: that map is empty whenever
      // listCloudBackups() failed, which would skip the sync for the whole
      // session while still reporting success.
      const result = await renameCloudDocument(id, updated.title)
      if (result === 'synced') {
        // Keeps the cloud list from holding the old name: after this document
        // is deleted from the phone it reappears as a cloud entry, and
        // restoring it would write that stale name back into local storage.
        setBackups((current) =>
          current.map((backup) =>
            backup.id === id ? { ...backup, title: updated.title } : backup,
          ),
        )
      }

      setToast(
        result === 'failed'
          ? 'Nama diubah di HP. Nama di cloud menyusul saat dicadangkan lagi.'
          : 'Nama dokumen diubah.',
      )
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal mengubah nama dokumen.')
    } finally {
      setRenamingId(null)
    }
  }

  /** Local files stay on the device; only the session is dropped. */
  const handleSignOut = async () => {
    if (!confirm('Keluar dari akun ini? Dokumen yang tersimpan di HP tidak ikut terhapus.')) return
    try {
      await signOut()
      // The scan counter is per person, not per device — the next account to
      // sign in should not inherit someone else's progress toward an ad.
      resetScanStreak()
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
      level={exportLevel}
      estimate={exportEstimate}
      onLevelChange={(next) => {
        setExportLevel(next)
        writeExportLevel(next)
      }}
      onExport={handleExport}
      onUpgrade={() => {
        setExportTarget(null)
        setView({ kind: 'upgrade' })
      }}
      onClose={() => setExportTarget(null)}
    />
  )

  const batchSelection = summarizeSelection(entries, selectedIds)
  const batchSheet = batchOpen && (
    <BatchExportSheet
      count={batchSelection.count}
      pageCount={batchSelection.pageCount}
      tier={tier}
      level={exportLevel}
      progress={batchProgress}
      isBusy={isBatchBusy}
      onLevelChange={(next) => {
        setExportLevel(next)
        writeExportLevel(next)
      }}
      onExport={handleBatchExport}
      onStop={() => batchAbort.current?.abort()}
      onUpgrade={() => {
        setBatchOpen(false)
        setView({ kind: 'upgrade' })
      }}
      onClose={() => setBatchOpen(false)}
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

  /*
    Checked before `pendingPages` on purpose: the review screen returns from
    inside that block, so anything opened over the top of it has to be handled
    ahead of it or it never gets a chance to render. Nothing in the review flow
    opens the paywall any more — splitting stopped being Pro on 25 Agustus 2026
    — but the ordering still holds for whatever opens it next, and closing the
    paywall leaves `pendingPages` untouched, so the scan is still waiting
    underneath.
  */
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

  if (pendingPages) {
    if (splitting) {
      return (
        <div className="app">
          <SplitScanScreen
            pages={pendingPages}
            cuts={splitCuts}
            name={splitName}
            startAt={splitSaved}
            isBusy={isSaving}
            progress={splitProgress}
            onCutsChange={setSplitCuts}
            onNameChange={setSplitName}
            onBack={() => setSplitting(false)}
            /* The screen deals in page indices; the scanner URIs live here. */
            onSave={(groups) =>
              handleSplitSave(groups.map((group) => group.map((index) => pendingPages[index])))
            }
          />
          {toast && <p className="toast">{toast}</p>}
        </div>
      )
    }

    // Full-screen look at a page that has not been saved yet. The pages are
    // still scanner URIs at this point, hence `raw`.
    if (reviewPreview !== null && reviewPreview < pendingPages.length) {
      return (
        <div className="app">
          <PageViewerScreen
            title="Hasil Pindai"
            sources={pendingPages}
            raw
            initialIndex={reviewPreview}
            // Paging inside the preview moves the review screen behind it too,
            // so closing does not throw away where the user got to.
            onPageChange={setCurrentPage}
            onClose={() => setReviewPreview(null)}
          />
        </div>
      )
    }

    return (
      <div className="app">
        <ReviewScreen
          pages={pendingPages}
          currentIndex={currentPage}
          isBusy={isSaving || isScanning}
          onSelectPage={setCurrentPage}
          onPreview={setReviewPreview}
          onRemovePage={handleRemovePage}
          onAddPages={handleAddPages}
          onCancel={() => {
            setPendingPages(null)
            exitSplit()
          }}
          onSave={handleSaveDocument}
          onSplit={handleStartSplit}
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

  if (activeDocument && view.kind === 'viewer') {
    const openPage = view.pageIndex
    return (
      <div className="app">
        <PageViewerScreen
          title={activeDocument.title}
          // The same resolution the exporter and the cloud backup use, so the
          // preview shows the filtered, cropped page rather than the raw scan.
          sources={activeDocument.pages.map(resolvePage)}
          initialIndex={openPage}
          onClose={() => setView({ kind: 'detail', id: activeDocument.id })}
          actions={
            <>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setEditedInSession(false)
                  setView({ kind: 'editor', id: activeDocument.id })
                }}
              >
                <CropIcon size={17} />
                <span>Edit</span>
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => setExportTarget(activeDocument.id)}
              >
                <ExportIcon size={17} />
                <span>Ekspor</span>
              </button>
            </>
          }
        />
        {exportSheet}
        {toast && <p className="toast">{toast}</p>}
      </div>
    )
  }

  if (activeDocument && view.kind === 'split') {
    const splitDoc = activeDocument
    return (
      <div className="app">
        <SplitScanScreen
          pages={splitDoc.pages.map(resolvePage)}
          /* Stored paths, not scanner URIs — these still need resolving. */
          raw={false}
          cuts={docSplitCuts}
          name={docSplitName}
          startAt={0}
          isBusy={isSplittingDoc}
          progress={docSplitProgress}
          heading="Pisah Dokumen"
          saveLabel={(count) => `Pisah jadi ${count} Dokumen`}
          busyLabel="Memisah…"
          options={
            <label className="split-option">
              <input
                type="checkbox"
                checked={docSplitDeleteOriginal}
                onChange={(event) => setDocSplitDeleteOriginal(event.target.checked)}
                disabled={isSplittingDoc}
              />
              <span>Hapus dokumen asli setelah dipisah</span>
            </label>
          }
          onCutsChange={setDocSplitCuts}
          onNameChange={setDocSplitName}
          onBack={() => setView({ kind: 'detail', id: splitDoc.id })}
          onSave={(groups) => handleDocumentSplit(splitDoc, groups)}
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
          onDocumentChange={(updated) => {
            setEditedInSession(true)
            applyDocumentChange(updated)
          }}
          onClose={() => {
            setView({ kind: 'detail', id: activeDocument.id })
            // Safe only here, once the editor is gone: a signature that is
            // still in an unsaved annotate draft is not in the index yet, and
            // pruning while the draft is open would delete it out from under
            // the overlay showing it.
            void pruneUnusedSignatures()
            if (!editedInSession) return
            setEditedInSession(false)
            // After the editor has closed, so the document is on screen behind
            // the ad rather than the ad interrupting the save.
            void maybeShowInterstitial('document-edited', tier)
          }}
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
          isRenaming={renamingId === activeDocument.id}
          onRename={(title) => handleRename(activeDocument.id, title)}
          onBack={() => setView({ kind: 'tabs' })}
          onPreview={(pageIndex) =>
            setView({ kind: 'viewer', id: activeDocument.id, pageIndex })
          }
          onEdit={() => {
            // Fresh session: an edit made an hour ago must not make merely
            // opening the editor now count as editing.
            setEditedInSession(false)
            setView({ kind: 'editor', id: activeDocument.id })
          }}
          onExport={() => setExportTarget(activeDocument.id)}
          onSplit={() => handleOpenDocumentSplit(activeDocument)}
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
            entries={entries}
            restoringId={restoringId}
            isRestoringAll={isRestoringAll}
            isScanning={isScanning}
            canScan={isNative}
            onScan={handleStartScan}
            onOpenDocuments={() => setTab('documents')}
            onOpenDocument={(id) => setView({ kind: 'detail', id })}
            onRestore={handleRestore}
          />
        )}
        {tab === 'documents' && (
          <DocumentsScreen
            entries={entries}
            tier={tier}
            restoringId={restoringId}
            isRestoringAll={isRestoringAll}
            selectMode={selectMode}
            selectedIds={selectedIds}
            isBatchBusy={isBatchBusy}
            onDelete={handleDelete}
            onOpen={(id) => setView({ kind: 'detail', id })}
            onRestore={handleRestore}
            onRestoreAll={handleRestoreAll}
            onMerge={() => setView({ kind: 'merge' })}
            onEnterSelect={handleEnterSelect}
            onToggleSelect={(id) => setSelectedIds((current) => toggleSelection(current, id))}
            onToggleSelectAll={() =>
              setSelectedIds((current) => toggleSelectAll(entries, current))
            }
            onExitSelect={exitSelect}
            onBatchExport={() => setBatchOpen(true)}
            onBatchDelete={handleBatchDelete}
            onNotice={setToast}
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
      {batchSheet}

      {toast && <p className="toast">{toast}</p>}

      <BottomNav active={tab} onChange={setTab} />
    </div>
  )
}

export default App
