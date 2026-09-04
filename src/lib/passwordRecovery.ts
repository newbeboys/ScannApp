const KEY = 'scannapp.recovery-pending'

/**
 * Marks that a recovery OTP has been accepted but the new password has not
 * been saved yet.
 *
 * Why this has to outlive the process: `verifyOtp({ type: 'recovery' })`
 * returns a *real* session, and `persistSession` writes it to localStorage. So
 * a user who closes the app between "kode benar" and "password baru disimpan"
 * would reopen it fully signed in — straight to Beranda, with the old password
 * still in force and no way back to the screen that was about to replace it.
 * A flag stored beside that session is what lets the app tell this half-done
 * state apart from an ordinary signed-in one.
 */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // storage disabled by the WebView
  }
}

export function markRecoveryPending(email: string): void {
  try {
    storage()?.setItem(KEY, email.trim())
  } catch {
    // Quota full or private mode. The in-memory flag still guards this run;
    // only the survives-a-restart half is lost.
  }
}

/** The address being recovered, or null when no reset is half-finished. */
export function readRecoveryPending(): string | null {
  const raw = storage()?.getItem(KEY)
  return raw && raw.length > 0 ? raw : null
}

export function clearRecoveryPending(): void {
  storage()?.removeItem(KEY)
}
