const SENT_KEY = 'scannapp.referral.activationSent'

/**
 * Whether this install has already told the server about its first scan, so
 * a pending referral (if any) could activate.
 *
 * Storage can be unavailable (private mode, a WebView with data cleared);
 * failing that read as "not sent yet" is the safe default -- worst case the
 * call fires again next scan, which the server already treats as a no-op.
 */
export function hasSentReferralActivation(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(SENT_KEY) === 'true'
  } catch {
    return false
  }
}

export function markReferralActivationSent(storage: Storage = localStorage): void {
  try {
    storage.setItem(SENT_KEY, 'true')
  } catch {
    // Remembering this is never worth failing a scan save over.
  }
}
