import { CheckIcon, CloudIcon, TrashIcon } from './Icons'
import { formatBytes } from '../lib/formatBytes'

export type BackupStatus = 'local' | 'working' | 'backed-up'

interface BackupRowProps {
  status: BackupStatus
  sizeBytes: number | null
  onBackup: () => void
  onRemove: () => void
}

/**
 * One row, three honest states. Backup is opt-in per document (PRD: cloud is a
 * backup, the phone stays the primary home), so the resting state says plainly
 * that the file lives on the phone only.
 */
export function BackupRow({ status, sizeBytes, onBackup, onRemove }: BackupRowProps) {
  if (status === 'backed-up') {
    return (
      <section className="card backup-row backup-row--done">
        <span className="backup-row__icon backup-row__icon--done">
          <CheckIcon size={18} />
        </span>
        <div className="backup-row__body">
          <p className="backup-row__title">Tercadang di cloud</p>
          <p className="backup-row__note">
            {sizeBytes !== null ? `${formatBytes(sizeBytes)} · ` : ''}Aman kalau HP hilang
          </p>
        </div>
        <button
          type="button"
          className="icon-button icon-button--danger"
          onClick={onRemove}
          aria-label="Hapus cadangan dari cloud"
        >
          <TrashIcon size={18} />
        </button>
      </section>
    )
  }

  return (
    <section className="card backup-row">
      <span className="backup-row__icon">
        <CloudIcon size={18} />
      </span>
      <div className="backup-row__body">
        <p className="backup-row__title">
          {status === 'working' ? 'Sedang mencadangkan…' : 'Hanya tersimpan di HP'}
        </p>
        <p className="backup-row__note">
          {status === 'working'
            ? 'Mengunggah PDF ke cloud'
            : 'Cadangkan supaya tidak hilang bersama HP'}
        </p>
      </div>
      <button
        type="button"
        className="button backup-row__action"
        onClick={onBackup}
        disabled={status === 'working'}
      >
        {status === 'working' ? 'Menunggu…' : 'Cadangkan'}
      </button>
    </section>
  )
}
