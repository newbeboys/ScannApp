import type { Tier } from '../tier'

/**
 * `ADS_INTERSTITIAL_FREQUENCY=every_5_scans_plus_after_export` (CLAUDE.md
 * Bagian 6). The "5" lives here as the single definition; the env var records
 * the policy, this constant implements it.
 */
export const SCANS_PER_INTERSTITIAL = 5

const COUNTER_KEY = 'scannapp.ads.scanCount'

/** What made us consider showing an interstitial. */
export type AdTrigger = 'scan-saved' | 'export-finished'

/**
 * Reads the persisted scan counter.
 *
 * Persisted rather than kept in memory on purpose: a counter that resets on
 * every app start would let a user who restarts often never reach the fifth
 * scan, quietly turning off half the ad policy.
 *
 * Storage can be unavailable (private mode, WebView with data cleared), and a
 * broken counter must never break scanning — every failure path returns 0.
 */
export function readScanCount(storage: Storage = localStorage): number {
  try {
    const parsed = Number.parseInt(storage.getItem(COUNTER_KEY) ?? '', 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  } catch {
    return 0
  }
}

function writeScanCount(value: number, storage: Storage): void {
  try {
    storage.setItem(COUNTER_KEY, String(value))
  } catch {
    // Counting ads is never worth failing a scan over.
  }
}

/**
 * Decides whether this trigger earns an interstitial, and advances the counter
 * as a side effect when the trigger is a saved scan.
 *
 * Pro never sees an ad, and — importantly — Pro does not advance the counter
 * either. Otherwise a subscription lapsing back to Basic would fire an
 * interstitial immediately on the next scan, which reads as a punishment.
 */
export function shouldShowInterstitial(
  trigger: AdTrigger,
  tier: Tier,
  storage: Storage = localStorage,
): boolean {
  if (tier === 'pro') return false

  // Every export is worth an ad; no counter involved (PRD Bagian 6).
  if (trigger === 'export-finished') return true

  const next = readScanCount(storage) + 1
  const reached = next >= SCANS_PER_INTERSTITIAL

  // Reset on the fifth scan so the next cycle starts clean, rather than
  // letting the number grow and relying on a modulo that drifts if the
  // stored value is ever tampered with.
  writeScanCount(reached ? 0 : next, storage)

  return reached
}

/** Scans still to go before the next interstitial. Only used by dev tooling. */
export function scansUntilNextInterstitial(storage: Storage = localStorage): number {
  return SCANS_PER_INTERSTITIAL - readScanCount(storage)
}

/** Clears the counter — called on sign-out so it never crosses accounts. */
export function resetScanCount(storage: Storage = localStorage): void {
  writeScanCount(0, storage)
}
