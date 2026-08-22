/**
 * Google's official sample ad units. They always fill, never earn, and never
 * count as invalid traffic — which is exactly what we need while the real
 * AdMob account does not exist yet.
 *
 * @see https://developers.google.com/admob/android/test-ads
 */
const TEST_UNITS = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
} as const

function readEnv(name: string): string {
  const raw = import.meta.env[name]
  return typeof raw === 'string' ? raw.trim() : ''
}

export interface AdConfig {
  bannerUnitId: string
  interstitialUnitId: string
  /**
   * Passed to the plugin as `isTesting`. True whenever we are not certain we
   * are serving real ads to a real user from a release build.
   */
  isTesting: boolean
}

/**
 * Resolves which ad units to request.
 *
 * Two separate reasons to fall back to test units, and both matter:
 *
 * 1. The env vars are empty — no AdMob account yet, so real units do not exist.
 * 2. This is a dev build. Real units must never be requested from a dev build:
 *    repeated impressions from a developer's own device are invalid traffic,
 *    and AdMob suspends accounts for it.
 */
export function resolveAdConfig(): AdConfig {
  const banner = readEnv('VITE_ADMOB_BANNER_UNIT_ID')
  const interstitial = readEnv('VITE_ADMOB_INTERSTITIAL_UNIT_ID')
  const hasRealUnits = banner !== '' && interstitial !== ''
  const useTestUnits = !hasRealUnits || import.meta.env.DEV

  return {
    bannerUnitId: useTestUnits ? TEST_UNITS.banner : banner,
    interstitialUnitId: useTestUnits ? TEST_UNITS.interstitial : interstitial,
    isTesting: useTestUnits,
  }
}
