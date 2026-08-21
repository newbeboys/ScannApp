import { useEffect, useState } from 'react'
import { ChevronLeftIcon, DownloadIcon, TrashIcon } from '../components/Icons'
import { QuotaBar } from '../components/QuotaBar'
import { backupDownloadUrl, deleteBackup, listCloudBackups, type CloudBackup } from '../lib/backupApi'
import { formatBytes } from '../lib/formatBytes'

interface CloudBackupScreenProps {
  quotaBytes: number
  onBack: () => void
  onError: (message: string) => void
  onNotice: (message: string) => void
}

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/**
 * The other half of backup. Lists what is in the cloud — including documents
 * whose local copy is long gone, which is exactly the case a backup exists for.
 */
export function CloudBackupScreen({
  quotaBytes,
  onBack,
  onError,
  onNotice,
}: CloudBackupScreenProps) {
  const [backups, setBackups] = useState<CloudBackup[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    listCloudBackups().then(setBackups)
  }, [])

  const usedBytes = (backups ?? []).reduce((total, backup) => total + backup.sizeBytes, 0)

  const handleDownload = async (backup: CloudBackup) => {
    setBusyId(backup.id)
    try {
      // Signed link, valid ten minutes — the browser or Android takes it from here.
      window.open(await backupDownloadUrl(backup.id), '_blank')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Gagal membuka cadangan.')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (backup: CloudBackup) => {
    if (!confirm(`Hapus cadangan "${backup.title}" dari cloud? Salinan di HP tidak ikut terhapus.`))
      return

    setBusyId(backup.id)
    try {
      await deleteBackup(backup.id)
      setBackups((current) => (current ?? []).filter((entry) => entry.id !== backup.id))
      onNotice('Cadangan dihapus dari cloud.')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Gagal menghapus cadangan.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Kembali">
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          <h1>Cadangan di cloud</h1>
          <p>Dokumen yang tersimpan di luar HP kamu</p>
        </div>
      </header>

      <QuotaBar usedBytes={usedBytes} quotaBytes={quotaBytes} />

      {backups === null && <p className="empty-note">Memuat…</p>}

      {backups?.length === 0 && (
        <p className="empty-note">
          Belum ada cadangan. Buka salah satu dokumen lalu tekan Cadangkan untuk menyimpan
          salinannya di cloud.
        </p>
      )}

      {backups && backups.length > 0 && (
        <div className="doc-list">
          {backups.map((backup) => (
            <div key={backup.id} className="doc-row backup-item">
              <div className="doc-row__meta">
                <h3>{backup.title}</h3>
                <p>
                  {backup.pageCount} halaman · {formatBytes(backup.sizeBytes)} ·{' '}
                  {dateFormatter.format(new Date(backup.updatedAt))}
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => handleDownload(backup)}
                disabled={busyId === backup.id}
                aria-label={`Unduh ${backup.title}`}
              >
                <DownloadIcon size={18} />
              </button>
              <button
                type="button"
                className="icon-button icon-button--danger"
                onClick={() => handleDelete(backup)}
                disabled={busyId === backup.id}
                aria-label={`Hapus cadangan ${backup.title}`}
              >
                <TrashIcon size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
