/**
 * Starts the account deletion grace period.
 *
 * Nothing is destroyed here — this only stamps `profiles.deletion_requested_at`.
 * The purge itself happens 7 days later in `process-account-deletions`, and the
 * user can call `cancel-account-deletion` at any point in between.
 *
 * BACKEND_API_DESIGN.md Bagian 11. Business rules: CLAUDE.md Bagian 6.
 */
import {
  ACTIVE_SUBSCRIPTION_MESSAGE,
  deletionScheduledAt,
  readStoreEntitlement,
  resolveDeletionEligibility,
  type DeletionProfileRow,
  type StoreEntitlement,
} from '../_shared/accountDeletion.ts'
import { errorResponse, handler, json, serviceClient } from '../_shared/http.ts'

/** Must match the entitlement id in the RevenueCat dashboard (.env.example). */
const ENTITLEMENT_ID = Deno.env.get('REVENUECAT_ENTITLEMENT_ID') ?? 'pro'

/** Stops a slow RevenueCat from holding the whole request open. */
const REVENUECAT_TIMEOUT_MS = 5000

/**
 * Asks RevenueCat whether this user still has a live subscription.
 *
 * Every failure path answers `unknown` rather than throwing: the caller folds
 * that into the profile-based fallback, and a RevenueCat outage must not take
 * down a deletion route Google Play requires us to offer.
 */
async function fetchStoreEntitlement(userId: string, now: Date): Promise<StoreEntitlement> {
  const apiKey = Deno.env.get('REVENUECAT_SECRET_API_KEY')

  if (!apiKey) {
    console.warn(
      JSON.stringify({
        event: 'revenuecat_key_missing',
        detail: 'REVENUECAT_SECRET_API_KEY belum diset; jatuh ke pengecekan profiles.',
      }),
    )
    return 'unknown'
  }

  try {
    const response = await fetch(
      // app_user_id is the Supabase user id — Purchases.logIn() sets it at
      // sign-in, the same identity the RevenueCat webhook writes tiers under.
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(REVENUECAT_TIMEOUT_MS),
      },
    )

    // 404 means RevenueCat has never seen this user: they never opened a
    // purchase flow, so there is genuinely nothing to cancel.
    if (response.status === 404) return 'inactive'

    if (!response.ok) {
      console.error(
        JSON.stringify({ event: 'revenuecat_http_error', status: response.status }),
      )
      return 'unknown'
    }

    return readStoreEntitlement(await response.json(), ENTITLEMENT_ID, now)
  } catch (caught) {
    console.error(JSON.stringify({ event: 'revenuecat_unreachable' }), caught)
    return 'unknown'
  }
}

Deno.serve(
  handler(async (_request, user) => {
    const db = serviceClient()
    const now = new Date()

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('tier, tier_expires_at, pro_plan, deletion_requested_at')
      .eq('id', user.id)
      .maybeSingle<DeletionProfileRow & { deletion_requested_at: string | null }>()

    if (profileError) {
      console.error(profileError)
      return errorResponse('DB_ERROR', 'Gagal membaca data akun.', 500)
    }

    if (!profile) {
      return errorResponse('NOT_FOUND', 'Data akun tidak ditemukan.', 404)
    }

    // Already scheduled: report the existing date rather than restarting the
    // clock. Re-stamping now() would silently extend the wait every time the
    // user tapped the button again.
    if (profile.deletion_requested_at) {
      const requestedAt = new Date(profile.deletion_requested_at)
      return json({
        status: 'ok',
        already_requested: true,
        requested_at: profile.deletion_requested_at,
        deletion_scheduled_at: deletionScheduledAt(requestedAt).toISOString(),
      })
    }

    const storeEntitlement = await fetchStoreEntitlement(user.id, now)
    const eligibility = resolveDeletionEligibility(storeEntitlement, profile, now)

    if (!eligibility.allowed) {
      console.log(
        JSON.stringify({
          event: 'deletion_refused',
          userId: user.id,
          storeEntitlement,
          code: eligibility.code,
        }),
      )
      // 409, not 400: the request itself is well-formed, the account is simply
      // in a state that forbids it — and that state is one the user can change.
      return errorResponse(eligibility.code, ACTIVE_SUBSCRIPTION_MESSAGE, 409)
    }

    const requestedAt = now.toISOString()

    /*
      `.is(..., null)` is the real guard, not the early return above. The read
      that got us here happened before an awaited RevenueCat round trip, so two
      taps a second apart can both find null and both reach this point — and
      the second write would push the purge date later than the date the first
      response already promised the user. Letting the database decide who wins
      makes the check and the write one operation.
    */
    const { data: written, error: updateError } = await db
      .from('profiles')
      .update({ deletion_requested_at: requestedAt, updated_at: requestedAt })
      .eq('id', user.id)
      .is('deletion_requested_at', null)
      .select('deletion_requested_at')

    if (updateError) {
      console.error(updateError)
      return errorResponse('DB_ERROR', 'Gagal menjadwalkan penghapusan akun.', 500)
    }

    if (!written || written.length === 0) {
      // Lost the race, or the account went away underneath us. Report whatever
      // actually stands now rather than the date this call tried to set.
      const { data: current } = await db
        .from('profiles')
        .select('deletion_requested_at')
        .eq('id', user.id)
        .maybeSingle<{ deletion_requested_at: string | null }>()

      if (!current?.deletion_requested_at) {
        return errorResponse('NOT_FOUND', 'Data akun tidak ditemukan.', 404)
      }

      return json({
        status: 'ok',
        already_requested: true,
        requested_at: current.deletion_requested_at,
        deletion_scheduled_at: deletionScheduledAt(
          new Date(current.deletion_requested_at),
        ).toISOString(),
      })
    }

    console.log(
      JSON.stringify({
        event: 'deletion_requested',
        userId: user.id,
        storeEntitlement,
        requestedAt,
      }),
    )

    return json({
      status: 'ok',
      already_requested: false,
      requested_at: requestedAt,
      deletion_scheduled_at: deletionScheduledAt(now).toISOString(),
    })
  }),
)
