import type { Tier } from '../tier'

/**
 * `ADS_INTERSTITIAL_FREQUENCY=after_edit_merge_and_7_scan_streak` (CLAUDE.md
 * Bagian 6, keputusan Boss Ali 23 Agustus 2026). The numbers live here as the
 * single definition; the env var records the policy, these constants
 * implement it.
 */
export const SCAN_STREAK_LENGTH = 7
export const SCAN_STREAK_WINDOW_MS = 10 * 60 * 1000

const STREAK_KEY = 'scannapp.ads.scanTimes'

/** What made us consider showing an interstitial. */
export type AdTrigger = 'scan-saved' | 'document-edited' | 'merge-finished'

/**
 * When each recent scan was saved, oldest first.
 *
 * Persisted rather than kept in memory on purpose: a streak that resets on
 * every app start would let a user who restarts often never reach the seventh
 * scan, quietly turning off half the ad policy.
 *
 * Storage can be unavailable (private mode, WebView with data cleared), and a
 * broken counter must never break scanning — every failure path returns [].
 */
function readScanTimes(storage: Storage): number[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STREAK_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  } catch {
    return []
  }
}

function writeScanTimes(times: number[], storage: Storage): void {
  try {
    storage.setItem(STREAK_KEY, JSON.stringify(times))
  } catch {
    // Counting ads is never worth failing a scan over.
  }
}

/**
 * The scans that still count towards a streak: recent enough, and not dated
 * in the future.
 *
 * The future check is not paranoia — a phone whose clock jumps back (timezone
 * change, NTP correction) would otherwise hold a timestamp that never expires,
 * either freezing the streak or firing an ad hours later out of nowhere.
 */
function withinWindow(times: number[], now: number): number[] {
  return times.filter((time) => time <= now && now - time < SCAN_STREAK_WINDOW_MS)
}

/**
 * Decides whether this trigger earns an interstitial, and records the scan as
 * a side effect when the trigger is a saved scan.
 *
 * Pro never sees an ad, and — importantly — Pro does not record scans either.
 * Otherwise a subscription lapsing back to Basic would fire an interstitial
 * immediately on the next scan, which reads as a punishment.
 */
export function shouldShowInterstitial(
  trigger: AdTrigger,
  tier: Tier,
  storage: Storage = localStorage,
  now: number = Date.now(),
): boolean {
  if (tier === 'pro') return false

  // Finishing an edit or a merge is a natural pause in the work, so each one
  // earns an ad on its own — no streak involved.
  if (trigger !== 'scan-saved') return true

  const times = [...withinWindow(readScanTimes(storage), now), now]
  writeScanTimes(times, storage)

  // The streak is deliberately *not* cleared here. Clearing on the decision
  // rather than on the ad actually appearing would throw the ad away whenever
  // none had finished loading — and with a ten-minute window that ad is gone,
  // not postponed. `resetScanStreak` is called once one is really shown.
  return times.length >= SCAN_STREAK_LENGTH
}

/** Scans still to go before the next interstitial. Only used by dev tooling. */
export function scansUntilNextInterstitial(
  storage: Storage = localStorage,
  now: number = Date.now(),
): number {
  // Floored at zero: the streak keeps growing while no ad manages to load, so
  // the remaining count can otherwise go negative.
  return Math.max(0, SCAN_STREAK_LENGTH - withinWindow(readScanTimes(storage), now).length)
}

/** Clears the streak — called on sign-out so it never crosses accounts. */
export function resetScanStreak(storage: Storage = localStorage): void {
  writeScanTimes([], storage)
}
