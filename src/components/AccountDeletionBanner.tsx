import { deletionBannerText } from '../lib/accountDeletion'
import { WarningIcon } from './Icons'

interface AccountDeletionBannerProps {
  /** ISO timestamp from `profiles.deletion_requested_at`. */
  requestedAt: string
  isBusy: boolean
  onCancel: () => void
}

/**
 * Standing reminder that this account is scheduled for deletion, with the way
 * out attached.
 *
 * Sits above the tab content rather than inside one screen: the countdown is
 * running whatever the user is doing, and burying the cancel button in
 * Pengaturan would make it findable only by someone who already remembered.
 */
export function AccountDeletionBanner({
  requestedAt,
  isBusy,
  onCancel,
}: AccountDeletionBannerProps) {
  const text = deletionBannerText(requestedAt)
  // Null only for a timestamp that could not be read; better no banner at all
  // than one counting down to nothing.
  if (!text) return null

  return (
    <div className="deletion-banner" role="status">
      <WarningIcon size={18} className="deletion-banner__icon" />
      <p className="deletion-banner__text">{text}</p>
      <button type="button" className="deletion-banner__action" onClick={onCancel} disabled={isBusy}>
        {isBusy ? 'Membatalkan…' : 'Batalkan'}
      </button>
    </div>
  )
}
