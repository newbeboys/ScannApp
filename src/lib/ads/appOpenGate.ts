import type { Tier } from '../tier'

/**
 * How long the user has to be away before coming back counts as "opening the
 * app again" (keputusan Boss Ali 23 Agustus 2026).
 */
export const RESUME_AWAY_MS = 5000

/**
 * How long a marked excursion stays valid before we assume it never happened.
 *
 * The mark is set just *before* the call that sends the user away, because
 * once that call is awaited we no longer get a turn. But those calls can fail
 * outright — no share sheet installed, the signed URL request timing out — and
 * then the app never goes anywhere. Without an expiry the mark would sit there
 * and silently swallow the next genuine return, possibly hours later.
 */
export const OWN_FLOW_GRACE_MS = 10_000

export interface ResumeTracker {
  /**
   * Called immediately before the app deliberately sends the user somewhere
   * else — including showing one of our own full-screen ads.
   *
   * This is the whole reason this module exists. The scanner, the Android
   * share sheet, the file picker, the Play purchase flow *and every AdMob
   * full-screen ad* are separate activities — from the WebView's point of view
   * the app was backgrounded and came back, exactly like the user leaving for
   * WhatsApp. Without this mark, every scan would end in a full-screen ad, a
   * purchase would land behind one, and an ad dismissed after five seconds
   * would immediately summon the next one.
   */
  leaveForOwnFlow(now?: number): void
  /** The app went to the background. */
  hidden(now?: number): void
  /** The app came back. Returns whether that earns an App Open ad. */
  visible(tier: Tier, now?: number): boolean
}

export function createResumeTracker(): ResumeTracker {
  /** When the app went to the background, or null while it is in front. */
  let hiddenSince: number | null = null
  /** That backgrounding was our own doing. */
  let hiddenByUs = false
  /** When we announced an excursion that has not backgrounded the app yet. */
  let expectingOwnHide: number | null = null

  return {
    leaveForOwnFlow(now = Date.now()) {
      expectingOwnHide = now
    },

    hidden(now = Date.now()) {
      hiddenSince = now
      hiddenByUs = expectingOwnHide !== null && now - expectingOwnHide < OWN_FLOW_GRACE_MS
      // Consumed either way: an announcement older than the grace window
      // belongs to something that never happened.
      expectingOwnHide = null
    },

    visible(tier, now = Date.now()) {
      const wasHiddenSince = hiddenSince
      const wasOurs = hiddenByUs
      hiddenSince = null
      hiddenByUs = false

      // Cleared above before returning: a Pro user's departures must not pile
      // up and fire an ad the moment a subscription lapses.
      if (tier === 'pro') return false
      if (wasOurs) return false

      // No recorded departure at all — the very first paint, or a visibility
      // event the WebView delivered without a matching hide. Nothing to
      // measure, so nothing to charge the user for.
      if (wasHiddenSince === null) return false

      return now - wasHiddenSince >= RESUME_AWAY_MS
    },
  }
}

/**
 * The tracker the app actually uses.
 *
 * A single shared instance rather than one per component: the flows that mark
 * an excursion (scanner, share sheet, purchase, our own ads) live nowhere near
 * the component that listens for the app coming back.
 */
export const resumeTracker = createResumeTracker()
