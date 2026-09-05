import { CloseIcon, WarningIcon } from './Icons'
import { GRACE_PERIOD_DAYS } from '../lib/accountDeletion'
import { useScrollLock } from '../lib/useScrollLock'

interface DeleteAccountSheetProps {
  /**
   * True for a paid (monthly/yearly) plan that is still running. Referral Pro
   * is excluded on purpose — it never came from Play Store, so there is
   * nothing there to cancel and the warning would send the user on a hunt for
   * a subscription that does not exist.
   */
  requiresSubscriptionCancel: boolean
  isBusy: boolean
  /** Server's own message when the request was refused; shown verbatim. */
  error: string | null
  onConfirm: () => void
  onClose: () => void
}

/**
 * Confirmation for the one action in the app that cannot be undone by the app.
 *
 * Deliberately not a native `confirm()` like the other destructive actions
 * here: this one has to explain a grace period, a Play Store prerequisite, and
 * what survives on the phone afterwards. A single line of text cannot carry
 * that, and the alternative — a wall of prose inside `confirm()` — is exactly
 * the dialog people dismiss without reading.
 */
export function DeleteAccountSheet({
  requiresSubscriptionCancel,
  isBusy,
  error,
  onConfirm,
  onClose,
}: DeleteAccountSheetProps) {
  useScrollLock()

  return (
    <div className="sheet-backdrop" onClick={isBusy ? undefined : onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Hapus akun"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet__head">
          <div>
            <h2>Hapus Akun</h2>
            <p>Tindakan ini permanen setelah masa tunggu berakhir.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Tutup"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {requiresSubscriptionCancel && (
          <div className="danger-note" role="note">
            <WarningIcon size={18} className="danger-note__icon" />
            <p>
              Langganan Pro kamu masih aktif. <strong>Batalkan dulu di Play Store</strong> (Play
              Store → Menu → Langganan → ScannApp → Batalkan). Menghapus akun di sini tidak
              menghentikan tagihan Google.
            </p>
          </div>
        )}

        <ul className="delete-account__facts">
          <li>
            Akun ditandai untuk dihapus, lalu ada masa tunggu{' '}
            <strong>{GRACE_PERIOD_DAYS} hari</strong>. Selama itu kamu tetap bisa masuk seperti
            biasa, dan bisa membatalkannya kapan saja.
          </li>
          <li>
            Setelah masa tunggu lewat, profil, kuota, dan{' '}
            <strong>semua cadangan di cloud</strong> dihapus permanen — tidak bisa dipulihkan.
          </li>
          <li>
            Dokumen yang tersimpan di HP ini <strong>tidak ikut terhapus</strong>. Hapus lewat
            &ldquo;Hapus semua dokumen&rdquo; kalau kamu juga mau membuangnya.
          </li>
        </ul>

        {error && <p className="delete-account__error">{error}</p>}

        <div className="delete-account__actions">
          <button type="button" className="button" onClick={onClose} disabled={isBusy}>
            Batal
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={onConfirm}
            disabled={isBusy}
          >
            {isBusy ? 'Memproses…' : 'Hapus akun saya'}
          </button>
        </div>
      </div>
    </div>
  )
}
