import { Capacitor } from '@capacitor/core'
import {
  LOG_LEVEL,
  Purchases,
  type PurchasesOffering,
  type PurchasesPackage,
} from '@revenuecat/purchases-capacitor'
import {
  FALLBACK_PRICES,
  matchPlanId,
  type PlanId,
  PRO_ENTITLEMENT_ID,
  REVENUECAT_ANDROID_KEY,
  purchasesConfigured,
} from './purchaseConfig'

/** One buyable plan as the paywall needs it. */
export interface PlanOption {
  id: PlanId
  /** Price already formatted by the store, in the user's own currency. */
  priceString: string
  /** Null when this plan came from the fallback and cannot actually be bought. */
  pkg: PurchasesPackage | null
}

export type PurchaseOutcome =
  | { status: 'purchased' }
  | { status: 'cancelled' }
  | { status: 'unavailable'; message: string }

let configured = false

function available(): boolean {
  return Capacitor.isNativePlatform() && purchasesConfigured()
}

/**
 * Configures the SDK once per app run and binds it to the signed-in user.
 *
 * The app user id is the Supabase user id on purpose: the webhook receives it
 * back as `app_user_id` and uses it directly as `profiles.id`. RevenueCat's
 * anonymous ids are deliberately unused — login is mandatory in this app
 * (Fase 3), so a stable id always exists.
 */
export async function identifyForPurchases(userId: string): Promise<void> {
  if (!available()) return

  try {
    if (!configured) {
      await Purchases.setLogLevel({
        level: import.meta.env.DEV ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR,
      })
      await Purchases.configure({
        apiKey: REVENUECAT_ANDROID_KEY,
        appUserID: userId,
      })
      configured = true
      return
    }

    // Already configured — a different account signed in on the same device.
    const { appUserID } = await Purchases.getAppUserID()
    if (appUserID !== userId) await Purchases.logIn({ appUserID: userId })
  } catch (error) {
    console.warn('[purchases] identify', error)
  }
}

/**
 * Detaches the device from the account on sign-out, so the next person to sign
 * in on this phone is not handed the previous user's entitlements.
 */
export async function forgetPurchaseIdentity(): Promise<void> {
  if (!available() || !configured) return

  try {
    await Purchases.logOut()
  } catch (error) {
    console.warn('[purchases] logOut', error)
  }
}

/**
 * The two plans the paywall offers, priced by the store.
 *
 * Always returns both, even when the offering cannot be loaded — a paywall
 * that renders empty because the user is offline is worse than one showing
 * indicative prices with the buy button disabled.
 */
export async function loadPlans(): Promise<PlanOption[]> {
  const fallback: PlanOption[] = [
    { id: 'monthly', priceString: FALLBACK_PRICES.monthly, pkg: null },
    { id: 'yearly', priceString: FALLBACK_PRICES.yearly, pkg: null },
  ]

  if (!available()) return fallback

  let offering: PurchasesOffering | null = null
  try {
    offering = (await Purchases.getOfferings()).current
  } catch (error) {
    console.warn('[purchases] getOfferings', error)
  }
  if (!offering) return fallback

  return fallback.map((plan) => {
    const pkg = offering.availablePackages.find(
      (entry) => matchPlanId(entry.product.identifier) === plan.id,
    )
    return pkg ? { ...plan, priceString: pkg.product.priceString, pkg } : plan
  })
}

/** True when RevenueCat currently considers the Pro entitlement active. */
function hasProEntitlement(info: { entitlements: { active: Record<string, unknown> } }): boolean {
  return PRO_ENTITLEMENT_ID in info.entitlements.active
}

/**
 * Starts the Play Store purchase flow.
 *
 * Note what this does *not* do: it never writes the tier. Entitlement reaches
 * `profiles` only through the RevenueCat webhook, because a client that could
 * grant itself Pro would make the paywall decorative. A successful return here
 * just means the caller should re-read the profile.
 */
export async function purchasePlan(plan: PlanOption): Promise<PurchaseOutcome> {
  if (!available() || !plan.pkg) {
    return {
      status: 'unavailable',
      message: 'Pembelian belum tersedia. Coba lagi setelah terhubung internet.',
    }
  }

  try {
    const result = await Purchases.purchasePackage({ aPackage: plan.pkg })
    return hasProEntitlement(result.customerInfo)
      ? { status: 'purchased' }
      : {
          status: 'unavailable',
          message: 'Pembayaran belum selesai diproses Google Play. Cek lagi beberapa saat lagi.',
        }
  } catch (error) {
    // The SDK reports a user backing out as an error, not a result.
    if ((error as { code?: string; userCancelled?: boolean })?.userCancelled) {
      return { status: 'cancelled' }
    }
    console.warn('[purchases] purchasePackage', error)
    return { status: 'unavailable', message: 'Pembelian gagal. Coba lagi.' }
  }
}

/**
 * Restores purchases made on another device or before a reinstall.
 *
 * Required by Google Play policy, and genuinely needed here: entitlement lives
 * server-side, so a user who reinstalls has no local record of having paid.
 */
export async function restorePurchases(): Promise<PurchaseOutcome> {
  if (!available()) {
    return { status: 'unavailable', message: 'Pemulihan hanya bisa dilakukan di aplikasi Android.' }
  }

  try {
    const { customerInfo } = await Purchases.restorePurchases()
    return hasProEntitlement(customerInfo)
      ? { status: 'purchased' }
      : {
          status: 'unavailable',
          message: 'Tidak ada langganan aktif di akun Google Play ini.',
        }
  } catch (error) {
    console.warn('[purchases] restorePurchases', error)
    return { status: 'unavailable', message: 'Gagal memulihkan pembelian. Coba lagi.' }
  }
}
