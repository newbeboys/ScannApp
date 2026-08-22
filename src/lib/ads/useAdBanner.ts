import { useEffect, useState } from 'react'
import type { Tier } from '../tier'
import { BANNER_HEIGHT_PX, hideBanner, showBanner, syncAdsToTier } from './adsService'

/**
 * Shows the AdMob banner while `enabled` holds, and reports how much room the
 * app must leave for it.
 *
 * The banner is a native view sitting on top of the WebView, so the layout
 * cannot discover its height on its own — the fixed bottom nav would end up
 * underneath it. The returned value is fed to a CSS variable that lifts the
 * nav and the toast clear of the ad.
 *
 * Returns 0 for Pro, on the web, and while nothing is showing, which makes the
 * "no ads" case cost exactly no layout space.
 */
export function useAdBanner(enabled: boolean, tier: Tier): number {
  const [reservedPx, setReservedPx] = useState(0)

  // Warm up (Basic) or tear down (Pro) the whole subsystem when the tier
  // resolves or changes — including the interstitial, not just the banner.
  useEffect(() => {
    void syncAdsToTier(tier)
  }, [tier])

  useEffect(() => {
    const wanted = enabled && tier === 'basic'

    if (!wanted) {
      setReservedPx(0)
      void hideBanner()
      return
    }

    let cancelled = false
    void showBanner(tier).then(() => {
      // A late resolve after the user has already left the tab screen must not
      // re-reserve space for a banner we are about to remove.
      if (!cancelled) setReservedPx(BANNER_HEIGHT_PX)
    })

    return () => {
      cancelled = true
      void hideBanner()
    }
  }, [enabled, tier])

  return reservedPx
}
