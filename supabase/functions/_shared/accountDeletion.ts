/**
 * Pure decision logic for account deletion, kept free of Deno APIs and of the
 * network so the Vitest `node` suite covers every branch (same split as
 * orphanCleanup.ts / referral.ts). The I/O shells around it live in
 * request-account-deletion, cancel-account-deletion, and
 * process-account-deletions.
 *
 * Business rules: CLAUDE.md Bagian 6. Flow: BACKEND_API_DESIGN.md Bagian 11-13.
 */

/** Angka final, CLAUDE.md Bagian 6. */
export const GRACE_PERIOD_DAYS = 7

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** When a request made at `requestedAt` becomes eligible for the purge. */
export function deletionScheduledAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + GRACE_PERIOD_DAYS * MS_PER_DAY)
}

/** The cutoff the daily job compares `deletion_requested_at` against. */
export function purgeCutoff(now: Date): Date {
  return new Date(now.getTime() - GRACE_PERIOD_DAYS * MS_PER_DAY)
}

/**
 * What the store says about this user's subscription.
 *
 * `cancelled` is deliberately separate from `active`: RevenueCat keeps an
 * entitlement alive until the paid period runs out, so a user who did exactly
 * what we told them to do — cancel in Play Store — still looks entitled for up
 * to a year afterwards. Blocking them that whole time would make the
 * instruction impossible to satisfy.
 *
 * `unknown` means we could not ask (key missing, RevenueCat down, HTTP error).
 */
export type StoreEntitlement = 'active' | 'cancelled' | 'inactive' | 'unknown'

/** The slice of `profiles` the eligibility check reads. */
export interface DeletionProfileRow {
  tier: string
  tier_expires_at: string | null
  pro_plan: string | null
}

/**
 * Shape of the parts of RevenueCat's `GET /v1/subscribers/{id}` we rely on.
 * Everything is optional — this is someone else's payload, not ours.
 */
interface RevenueCatSubscriberBody {
  subscriber?: {
    entitlements?: Record<
      string,
      { expires_date?: string | null; product_identifier?: string | null } | undefined
    >
    subscriptions?: Record<string, { unsubscribe_detected_at?: string | null } | undefined>
  }
}

/**
 * Reads one entitlement out of a RevenueCat subscriber payload.
 *
 * A missing `expires_date` means a non-expiring grant (lifetime purchase or a
 * promotional entitlement), which counts as active — there is no date to
 * compare against, and defaulting such a grant to "expired" would let a paying
 * user delete an account they are still being billed for.
 */
export function readStoreEntitlement(
  payload: unknown,
  entitlementId: string,
  now: Date,
): StoreEntitlement {
  const subscriber = (payload as RevenueCatSubscriberBody | null)?.subscriber
  const entitlement = subscriber?.entitlements?.[entitlementId]
  if (!entitlement) return 'inactive'

  const rawExpiry = entitlement.expires_date
  if (rawExpiry) {
    const expiresAt = Date.parse(rawExpiry)
    // An unparseable date is not evidence of anything. Saying "inactive" would
    // let a real subscriber through on a malformed field, so this stays
    // `unknown` and falls back to the profile below.
    if (Number.isNaN(expiresAt)) return 'unknown'
    if (expiresAt <= now.getTime()) return 'inactive'
  }

  const productId = entitlement.product_identifier
  const subscription = productId ? subscriber?.subscriptions?.[productId] : undefined

  return subscription?.unsubscribe_detected_at ? 'cancelled' : 'active'
}

/**
 * True when the stored profile describes a *paid* Pro plan that has not run
 * out yet.
 *
 * `pro_plan = 'referral'` is excluded on purpose: that Pro came from inviting
 * friends, not from Play Store, so there is no subscription to cancel and
 * telling such a user to go cancel one would be a dead end.
 */
export function hasPaidProInProfile(profile: DeletionProfileRow | null, now: Date): boolean {
  if (!profile || profile.tier !== 'pro') return false
  if (profile.pro_plan !== 'monthly' && profile.pro_plan !== 'yearly') return false
  if (!profile.tier_expires_at) return false // corrupt row; CLAUDE.md Bagian 6 reads it as Basic

  const expiresAt = Date.parse(profile.tier_expires_at)
  return !Number.isNaN(expiresAt) && expiresAt > now.getTime()
}

export type DeletionEligibility =
  | { allowed: true }
  | { allowed: false; code: 'ACTIVE_SUBSCRIPTION' }

/**
 * Whether a deletion request may proceed.
 *
 * RevenueCat is the authority whenever it answers. When it does not, the
 * profile stands in for it — the RevenueCat webhook is what writes
 * `profiles.tier` in the first place, so it is a reasonably fresh mirror of
 * the same fact.
 *
 * That fallback deliberately does not fail closed on every outage: Google Play
 * requires this deletion path to exist, and making it depend on a third party
 * being reachable would take the whole feature down with them. It only blocks
 * when the mirror itself still shows a paying subscription.
 */
export function resolveDeletionEligibility(
  storeEntitlement: StoreEntitlement,
  profile: DeletionProfileRow | null,
  now: Date,
): DeletionEligibility {
  if (storeEntitlement === 'active') return { allowed: false, code: 'ACTIVE_SUBSCRIPTION' }

  if (storeEntitlement === 'unknown' && hasPaidProInProfile(profile, now)) {
    return { allowed: false, code: 'ACTIVE_SUBSCRIPTION' }
  }

  return { allowed: true }
}

/** Shown to the user when the request is refused. */
export const ACTIVE_SUBSCRIPTION_MESSAGE =
  'Langganan Pro kamu masih aktif. Batalkan dulu langganannya di Play Store ' +
  '(Play Store → Menu → Langganan → ScannApp → Batalkan), lalu coba hapus akun lagi.'
