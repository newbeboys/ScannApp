function readEnv(name: string, fallback = ''): string {
  const raw = import.meta.env[name]
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value === '' ? fallback : value
}

/**
 * Public SDK key. RevenueCat designs this one to ship inside the app — it can
 * only read offerings and start purchases, never grant entitlements — but it
 * still comes from an env var rather than the source, per CLAUDE.md Aturan
 * Keras #1.
 */
export const REVENUECAT_ANDROID_KEY = readEnv('VITE_REVENUECAT_ANDROID_KEY')

/** Entitlement configured in the RevenueCat dashboard. */
export const PRO_ENTITLEMENT_ID = readEnv('VITE_REVENUECAT_ENTITLEMENT_ID', 'pro')

/**
 * Play Console product ids. Used to tell a monthly purchase from a yearly one
 * when the RevenueCat package type is not conclusive — the storage quota
 * differs between them (500MB vs 1GB, CLAUDE.md Bagian 6).
 */
export const PRODUCT_IDS = {
  monthly: readEnv('VITE_REVENUECAT_PRODUCT_MONTHLY', 'scannapp_pro_monthly'),
  yearly: readEnv('VITE_REVENUECAT_PRODUCT_YEARLY', 'scannapp_pro_yearly'),
} as const

/**
 * Prices shown when the offering cannot be loaded (offline, or the products
 * are not live in Play Console yet). The real paywall always prefers the
 * store's own `priceString`, which carries the correct currency and format for
 * the user's country — these are only there so the screen is never blank.
 *
 * Angka final PRD Bagian 6.
 */
export const FALLBACK_PRICES = {
  monthly: 'Rp 15.000',
  yearly: 'Rp 150.000',
} as const

/** False when no SDK key is configured, which makes buying impossible. */
export function purchasesConfigured(): boolean {
  return REVENUECAT_ANDROID_KEY !== ''
}

export type PlanId = 'monthly' | 'yearly'

/**
 * Maps a store product identifier to one of our two plans.
 *
 * Google Play reports a subscription as `productId:basePlanId` (for example
 * `scannapp_pro_monthly:monthly-autorenew`), so an exact comparison against the
 * configured product id would never match on a real device. Only the part
 * before the colon identifies the product.
 *
 * Returns null for anything unrecognised rather than guessing — an unknown
 * product must not be silently treated as a yearly plan and handed a 1GB quota.
 */
export function matchPlanId(productIdentifier: string): PlanId | null {
  const productId = productIdentifier.split(':')[0]

  if (productId === PRODUCT_IDS.monthly) return 'monthly'
  if (productId === PRODUCT_IDS.yearly) return 'yearly'
  return null
}
