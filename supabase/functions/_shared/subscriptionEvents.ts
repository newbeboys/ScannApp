/**
 * Rules for turning a RevenueCat webhook event into a `profiles` update.
 *
 * Kept free of Deno APIs so the Vitest suite in CI covers it — this is the one
 * place in the codebase where a bug either hands out Pro for free or takes away
 * Pro somebody paid for.
 */

export type EventEffect = 'grant' | 'revoke' | 'ignore'

/** Product ids as configured in Play Console. Mirrors the client's env vars. */
export interface ProductIds {
  monthly: string
  yearly: string
}

export interface ProfileState {
  tier: string
  tier_expires_at: string | null
  pro_plan: string | null
}

export interface SubscriptionEvent {
  type: string
  /** RevenueCat `app_user_id` — the Supabase user id, set at logIn(). */
  appUserId: string
  productId: string | null
  /** `expiration_at_ms` from the event, when present. */
  expiresAtMs: number | null
  /** `event_timestamp_ms`. */
  eventAtMs: number
}

export interface ProfileUpdate {
  tier: 'basic' | 'pro'
  tier_expires_at: string | null
  pro_plan: 'monthly' | 'yearly' | 'referral' | null
}

/**
 * What an event type does to entitlement.
 *
 * CANCELLATION is deliberately an `ignore`: the user turned off auto-renew but
 * has already paid for the current period and stays Pro until it runs out.
 * Revoking there would take away time they bought. EXPIRATION is what actually
 * ends it.
 *
 * Unknown types also ignore rather than revoke — RevenueCat adds event types
 * over time, and an unrecognised one must never cost a paying user their Pro.
 */
export function classifyEvent(type: string): EventEffect {
  switch (type.toUpperCase()) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
    case 'SUBSCRIPTION_EXTENDED':
      return 'grant'
    case 'EXPIRATION':
    case 'REFUND':
      return 'revoke'
    // SUBSCRIPTION_PAUSED fires when a pause is *scheduled*, not when it takes
    // effect — Google Play runs the paid period out first. Revoking here would
    // take away days the user already paid for, the same mistake CANCELLATION
    // avoids above. EXPIRATION arrives when the period genuinely ends.
    case 'SUBSCRIPTION_PAUSED':
    // TRANSFER moves an entitlement between app_user_ids. Its payload names
    // `transferred_from`/`transferred_to` rather than a single app_user_id, so
    // it is not safe to interpret with the fields read here. Recorded but not
    // acted on — see the manual verification note in TASKS.md.
    case 'TRANSFER':
      return 'ignore'
    default:
      return 'ignore'
  }
}

/**
 * Maps a store product id to a plan.
 *
 * Google Play reports subscriptions as `productId:basePlanId`, so only the part
 * before the colon identifies the product. Unrecognised products return null
 * rather than a guess — guessing `yearly` would hand out a 1GB quota.
 */
export function planFromProductId(
  productId: string | null,
  products: ProductIds,
): 'monthly' | 'yearly' | null {
  if (!productId) return null

  const base = productId.split(':')[0]
  if (base === products.monthly) return 'monthly'
  if (base === products.yearly) return 'yearly'
  return null
}

function parseTime(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Entitlement granted by a purchase.
 *
 * `tier_expires_at` takes the later of what the profile already has and what
 * this event grants, so a subscription can only ever extend Pro, never shorten
 * it. That matters because referral rewards (Fase 8) write to the same column:
 * buying a month must not cancel referral days that run further out.
 */
export function resolveGrant(
  profile: ProfileState,
  event: SubscriptionEvent,
  products: ProductIds,
): ProfileUpdate | null {
  if (event.expiresAtMs === null) return null

  const current = parseTime(profile.tier_expires_at) ?? 0
  const granted = Math.max(current, event.expiresAtMs)

  return {
    tier: 'pro',
    tier_expires_at: new Date(granted).toISOString(),
    // Falls back to monthly for an unknown product: the smaller quota is the
    // safe direction to be wrong in, and the user is genuinely Pro either way.
    pro_plan: planFromProductId(event.productId, products) ?? 'monthly',
  }
}

/**
 * Entitlement after a subscription ends or is refunded.
 *
 * The tricky case: the profile may hold more time than this subscription ever
 * granted. Two ways that happens, and both must survive:
 *
 *  - a referral reward (Fase 8) extended the same column further out;
 *  - the user upgraded, so PRODUCT_CHANGE already granted the new plan, and
 *    this is the *old* product's late EXPIRATION arriving afterwards.
 *
 * Comparing the stored expiry against this subscription's own end separates
 * them. When time survives, the profile is left exactly as it is rather than
 * rewritten — whatever plan is recorded was written by a later, better-informed
 * event, and overwriting it here would silently drop a paying yearly subscriber
 * from a 1GB quota to 500MB.
 *
 * Returns null when nothing should change.
 */
export function resolveRevoke(
  profile: ProfileState,
  event: SubscriptionEvent,
): ProfileUpdate | null {
  // A refund ends entitlement now; an expiry ends it at its own date.
  const subscriptionEndsAt = event.expiresAtMs ?? event.eventAtMs
  const storedExpiry = parseTime(profile.tier_expires_at)

  // Time outlives this subscription, so it did not come from here. Leave it.
  if (storedExpiry !== null && storedExpiry > subscriptionEndsAt) return null

  // Nothing left. Already-Basic profiles need no write at all.
  if (profile.tier !== 'pro') return null

  return { tier: 'basic', tier_expires_at: null, pro_plan: null }
}

/** The single entry point: what should this event do to the profile? */
export function resolveProfileUpdate(
  profile: ProfileState,
  event: SubscriptionEvent,
  products: ProductIds,
): ProfileUpdate | null {
  switch (classifyEvent(event.type)) {
    case 'grant':
      return resolveGrant(profile, event, products)
    case 'revoke':
      return resolveRevoke(profile, event)
    default:
      return null
  }
}
