import {
  AdMob,
  AppOpenAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
  InterstitialAdPluginEvents,
} from '@capacitor-community/admob'
import { Capacitor } from '@capacitor/core'
import type { Tier } from '../tier'
import { resolveAdConfig } from './adConfig'
import { resetScanStreak, shouldShowInterstitial, type AdTrigger } from './adFrequency'
import { resumeTracker } from './appOpenGate'

/**
 * Height reserved under the bottom nav so the banner never covers it. Matches
 * BannerAdSize.BANNER (50dp) plus a little breathing room.
 */
export const BANNER_HEIGHT_PX = 58

const config = resolveAdConfig()

let initialized = false
/** A prepared interstitial is waiting to be shown. */
let interstitialReady = false
/** A prepare() is in flight — stops us stacking duplicate load requests. */
let preparing = false
let bannerVisible = false
/** An App Open ad is loaded and waiting. */
let appOpenReady = false
let loadingAppOpen = false

/**
 * Ads only exist on the device. In the browser every entry point below turns
 * into a silent no-op rather than throwing, so the dev server stays usable.
 */
function available(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * Ad failures are never worth surfacing to the user or breaking a flow over —
 * a scan that saved correctly should not report an error because a banner
 * could not load. Logged, then swallowed.
 */
function ignore(context: string): (error: unknown) => void {
  return (error: unknown) => {
    console.warn(`[ads] ${context}`, error)
  }
}

export async function initializeAds(): Promise<void> {
  if (!available() || initialized) return
  initialized = true

  try {
    await AdMob.initialize({ initializeForTesting: config.isTesting })

    // Keep the "is one ready?" flag honest: the plugin discards the prepared
    // ad once it is shown or fails, so the next request must load a new one.
    await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
      interstitialReady = false
      void prepareInterstitial()
    })
    await AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => {
      interstitialReady = false
    })
    await AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, () => {
      interstitialReady = false
      preparing = false
    })

    // Same bookkeeping for App Open: the plugin drops the loaded ad once it
    // has been shown, so the next resume needs a freshly loaded one.
    await AdMob.addListener(AppOpenAdPluginEvents.Closed, () => {
      appOpenReady = false
      void loadAppOpen()
    })
    await AdMob.addListener(AppOpenAdPluginEvents.FailedToShow, () => {
      appOpenReady = false
    })
    await AdMob.addListener(AppOpenAdPluginEvents.FailedToLoad, () => {
      appOpenReady = false
      loadingAppOpen = false
    })
  } catch (error) {
    initialized = false
    ignore('initialize')(error)
  }
}

/**
 * Loads an interstitial ahead of time. Interstitials take seconds to fetch, so
 * requesting one only at the moment we want to show it would either stall the
 * user or miss the moment entirely.
 */
async function prepareInterstitial(): Promise<void> {
  if (!available() || interstitialReady || preparing) return

  preparing = true
  try {
    await AdMob.prepareInterstitial({
      adId: config.interstitialUnitId,
      isTesting: config.isTesting,
    })
    interstitialReady = true
  } catch (error) {
    ignore('prepareInterstitial')(error)
  } finally {
    preparing = false
  }
}

/**
 * Loads an App Open ad ahead of time.
 *
 * Warmed up well before it is wanted for the same reason as the interstitial,
 * only more so: the moment it is needed is the moment the user is looking at
 * the app again, and fetching then would show the ad *over* work they have
 * already resumed — the one thing an App Open ad must never do.
 */
async function loadAppOpen(): Promise<void> {
  if (!available() || appOpenReady || loadingAppOpen) return

  loadingAppOpen = true
  try {
    await AdMob.loadAppOpen({ adId: config.appOpenUnitId })
    appOpenReady = true
  } catch (error) {
    ignore('loadAppOpen')(error)
  } finally {
    loadingAppOpen = false
  }
}

/**
 * Single gate for the whole ads subsystem. Called whenever the tier is
 * resolved or changes: Basic gets ads warmed up, Pro gets everything torn
 * down. Keeping the tier check here means no caller has to remember it.
 */
export async function syncAdsToTier(tier: Tier): Promise<void> {
  if (!available()) return

  if (tier === 'pro') {
    await hideBanner()
    interstitialReady = false
    appOpenReady = false
    return
  }

  await initializeAds()
  await prepareInterstitial()
  await loadAppOpen()
}

export async function showBanner(tier: Tier): Promise<void> {
  if (!available() || tier === 'pro' || bannerVisible) return

  await initializeAds()
  try {
    await AdMob.showBanner({
      adId: config.bannerUnitId,
      adSize: BannerAdSize.BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      // Cleared above the bottom nav, which is the app's own bottom furniture.
      margin: 0,
      isTesting: config.isTesting,
    })
    bannerVisible = true
  } catch (error) {
    ignore('showBanner')(error)
  }
}

export async function hideBanner(): Promise<void> {
  if (!available() || !bannerVisible) return

  bannerVisible = false
  // removeBanner rather than hideBanner: the banner is gone for a while
  // (a full-screen flow, or an upgrade to Pro), so stop paying for refreshes.
  await AdMob.removeBanner().catch(ignore('removeBanner'))
}

/**
 * Runs the frequency policy for a trigger and shows an interstitial if it is
 * earned. Returns whether one was actually shown, which the caller uses only
 * for dev diagnostics.
 *
 * Deliberately awaits the ad: callers fire this *after* the user-visible work
 * has finished (document saved, share sheet closed), so nothing is left
 * hanging behind the ad.
 */
export async function maybeShowInterstitial(trigger: AdTrigger, tier: Tier): Promise<boolean> {
  // The counter has to advance even in the browser, or the dev-mode indicator
  // would never move — so run the policy before the platform check.
  if (!shouldShowInterstitial(trigger, tier)) return false
  if (!available()) return false

  if (!interstitialReady) {
    // Nothing loaded in time. Skip this one and warm up for the next trigger
    // rather than blocking the user behind a fresh network fetch.
    void prepareInterstitial()
    return false
  }

  try {
    // The ad is its own activity, so showing it backgrounds the WebView. Left
    // unmarked, dismissing it after five seconds would read as the user coming
    // back from another app and summon an App Open ad on top of it.
    resumeTracker.leaveForOwnFlow()
    await AdMob.showInterstitial()
    interstitialReady = false
    // Only now is the streak spent — see the note in adFrequency.
    if (trigger === 'scan-saved') resetScanStreak()
    return true
  } catch (error) {
    ignore('showInterstitial')(error)
    interstitialReady = false
    return false
  }
}

/**
 * Shows the App Open ad if one is loaded, for a Basic user, on a device.
 *
 * Whether the moment *deserves* an ad is not decided here — that is
 * `resumeTracker`'s job, and it is the part with the interesting rules (see
 * appOpenGate.ts). This function only answers "is there one ready to show?".
 *
 * Nothing is fetched on the spot when none is ready: an ad that arrives
 * seconds after the user has resumed reads as an ad appearing out of nowhere
 * on top of their work, which is exactly what the format exists to avoid.
 */
export async function showAppOpenAd(tier: Tier): Promise<boolean> {
  if (!available() || tier === 'pro') return false

  await initializeAds()

  if (!appOpenReady) {
    void loadAppOpen()
    return false
  }

  try {
    // Same as the interstitial, and here it matters even more: an App Open ad
    // dismissed after five seconds would otherwise qualify as a return from
    // being away and show the next App Open ad, forever.
    resumeTracker.leaveForOwnFlow()
    await AdMob.showAppOpen()
    appOpenReady = false
    return true
  } catch (error) {
    ignore('showAppOpen')(error)
    appOpenReady = false
    return false
  }
}
