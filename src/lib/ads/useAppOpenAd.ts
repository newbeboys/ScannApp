import { useEffect } from 'react'
import type { Tier } from '../tier'
import { showAppOpenAd } from './adsService'
import { resumeTracker } from './appOpenGate'

/**
 * How long we keep waiting for an ad to load on a cold start before giving up.
 *
 * An App Open ad is only appropriate while the user is still arriving. Past a
 * few seconds they have started reading, and a full-screen ad then is an
 * interruption rather than a loading screen — so it is dropped, not queued.
 */
const COLD_START_DEADLINE_MS = 4000
const POLL_MS = 400

/**
 * Shows the App Open ad when the app is opened, and when the user comes back
 * after being away for more than five seconds (keputusan Boss Ali 23 Agustus
 * 2026).
 *
 * `visibilitychange` rather than `@capacitor/app`: the WebView already reports
 * the Android activity going to the background through it, so the rule needs
 * no extra Capacitor plugin.
 *
 * Which returns actually deserve an ad is decided by `resumeTracker` — in
 * particular it suppresses the ad after excursions the app itself started
 * (scanner, share sheet, purchase), which would otherwise put a full-screen ad
 * at the end of every single scan.
 */
export function useAppOpenAd(enabled: boolean, tier: Tier): void {
  useEffect(() => {
    if (!enabled || tier === 'pro') return

    let cancelled = false

    const onVisibilityChange = () => {
      if (document.hidden) {
        // Also stops a cold-start attempt still in flight: by the time the
        // user is back, that ad would land on top of whatever they do next.
        cancelled = true
        resumeTracker.hidden()
        return
      }

      if (resumeTracker.visible(tier)) void showAppOpenAd(tier)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    // The app opening is itself one of the two moments that earn an ad, but
    // nothing is loaded in the first instant — so poll briefly rather than
    // miss it entirely.
    void (async () => {
      const deadline = Date.now() + COLD_START_DEADLINE_MS
      while (!cancelled && Date.now() < deadline) {
        if (await showAppOpenAd(tier)) return
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }
    })()

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, tier])
}
