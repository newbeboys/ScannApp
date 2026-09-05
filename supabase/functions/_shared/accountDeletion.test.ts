import { describe, expect, it } from 'vitest'
import {
  deletionScheduledAt,
  GRACE_PERIOD_DAYS,
  hasPaidProInProfile,
  purgeCutoff,
  readStoreEntitlement,
  resolveDeletionEligibility,
  type DeletionProfileRow,
} from './accountDeletion.ts'

const NOW = new Date('2026-09-05T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

/** Builds a RevenueCat subscriber payload with one entitlement. */
function subscriberPayload(options: {
  entitlementId?: string
  expiresDate?: string | null
  productId?: string | null
  unsubscribeDetectedAt?: string | null
}) {
  const productId = options.productId === undefined ? 'scannapp_pro_monthly' : options.productId

  return {
    subscriber: {
      entitlements: {
        [options.entitlementId ?? 'pro']: {
          expires_date: options.expiresDate === undefined ? null : options.expiresDate,
          product_identifier: productId,
        },
      },
      subscriptions: productId
        ? {
            [productId]: { unsubscribe_detected_at: options.unsubscribeDetectedAt ?? null },
          }
        : {},
    },
  }
}

function profile(overrides: Partial<DeletionProfileRow> = {}): DeletionProfileRow {
  return {
    tier: 'pro',
    tier_expires_at: new Date(NOW.getTime() + 30 * DAY).toISOString(),
    pro_plan: 'monthly',
    ...overrides,
  }
}

describe('grace period maths', () => {
  it('schedules the purge exactly 7 days after the request', () => {
    expect(GRACE_PERIOD_DAYS).toBe(7)
    expect(deletionScheduledAt(NOW).toISOString()).toBe('2026-09-12T12:00:00.000Z')
  })

  it('cuts off at 7 days before now, so a request made today is not purged today', () => {
    expect(purgeCutoff(NOW).toISOString()).toBe('2026-08-29T12:00:00.000Z')
    expect(purgeCutoff(NOW).getTime()).toBeLessThan(NOW.getTime())
  })

  it('round-trips: a request is due for purge the moment its scheduled date arrives', () => {
    const requestedAt = new Date('2026-08-01T09:30:00.000Z')
    const due = deletionScheduledAt(requestedAt)

    expect(requestedAt.getTime()).toBeLessThanOrEqual(purgeCutoff(due).getTime())
    expect(requestedAt.getTime()).toBeGreaterThan(purgeCutoff(new Date(due.getTime() - 1)).getTime())
  })
})

describe('readStoreEntitlement', () => {
  it('reads a future expiry as active', () => {
    const payload = subscriberPayload({ expiresDate: new Date(NOW.getTime() + DAY).toISOString() })

    expect(readStoreEntitlement(payload, 'pro', NOW)).toBe('active')
  })

  it('reads a past expiry as inactive', () => {
    const payload = subscriberPayload({ expiresDate: new Date(NOW.getTime() - DAY).toISOString() })

    expect(readStoreEntitlement(payload, 'pro', NOW)).toBe('inactive')
  })

  it('treats a missing expiry as a non-expiring grant, not as expired', () => {
    // A lifetime/promotional entitlement has no date. Reading that as expired
    // would let someone who is still being billed delete their account.
    const payload = subscriberPayload({ expiresDate: null })

    expect(readStoreEntitlement(payload, 'pro', NOW)).toBe('active')
  })

  it('reports cancelled when the user already unsubscribed but the period runs on', () => {
    const payload = subscriberPayload({
      expiresDate: new Date(NOW.getTime() + 200 * DAY).toISOString(),
      unsubscribeDetectedAt: '2026-09-01T00:00:00Z',
    })

    expect(readStoreEntitlement(payload, 'pro', NOW)).toBe('cancelled')
  })

  it('is inactive when the entitlement id is absent from the payload', () => {
    const payload = subscriberPayload({ entitlementId: 'something_else' })

    expect(readStoreEntitlement(payload, 'pro', NOW)).toBe('inactive')
  })

  it('is inactive for a subscriber that has never bought anything', () => {
    expect(readStoreEntitlement({ subscriber: { entitlements: {} } }, 'pro', NOW)).toBe('inactive')
  })

  it('does not crash on a payload that is nothing like RevenueCat', () => {
    expect(readStoreEntitlement(null, 'pro', NOW)).toBe('inactive')
    expect(readStoreEntitlement({}, 'pro', NOW)).toBe('inactive')
    expect(readStoreEntitlement('nope', 'pro', NOW)).toBe('inactive')
  })

  it('answers unknown — not inactive — when the expiry is unparseable', () => {
    const payload = subscriberPayload({ expiresDate: 'kemarin sore' })

    expect(readStoreEntitlement(payload, 'pro', NOW)).toBe('unknown')
  })

  it('stays active when the entitlement names a product with no subscription entry', () => {
    // Nothing says the user cancelled, so the safe reading is still active.
    const payload = {
      subscriber: {
        entitlements: { pro: { expires_date: null, product_identifier: 'scannapp_pro_yearly' } },
        subscriptions: {},
      },
    }

    expect(readStoreEntitlement(payload, 'pro', NOW)).toBe('active')
  })
})

describe('hasPaidProInProfile', () => {
  it('is true for an unexpired monthly or yearly plan', () => {
    expect(hasPaidProInProfile(profile({ pro_plan: 'monthly' }), NOW)).toBe(true)
    expect(hasPaidProInProfile(profile({ pro_plan: 'yearly' }), NOW)).toBe(true)
  })

  it('is false for referral Pro — there is no Play Store subscription to cancel', () => {
    expect(hasPaidProInProfile(profile({ pro_plan: 'referral' }), NOW)).toBe(false)
  })

  it('is false once the paid plan has expired', () => {
    const expired = profile({ tier_expires_at: new Date(NOW.getTime() - DAY).toISOString() })

    expect(hasPaidProInProfile(expired, NOW)).toBe(false)
  })

  it('is false for a pro row with no expiry — CLAUDE.md Bagian 6 calls that corrupt', () => {
    expect(hasPaidProInProfile(profile({ tier_expires_at: null }), NOW)).toBe(false)
  })

  it('is false for basic and for a missing profile', () => {
    expect(hasPaidProInProfile(profile({ tier: 'basic', pro_plan: null }), NOW)).toBe(false)
    expect(hasPaidProInProfile(null, NOW)).toBe(false)
  })
})

describe('resolveDeletionEligibility', () => {
  it('refuses while the store entitlement is active', () => {
    expect(resolveDeletionEligibility('active', profile(), NOW)).toEqual({
      allowed: false,
      code: 'ACTIVE_SUBSCRIPTION',
    })
  })

  it('allows a user who already cancelled, even mid paid period', () => {
    expect(resolveDeletionEligibility('cancelled', profile(), NOW)).toEqual({ allowed: true })
  })

  it('allows when the store says inactive, whatever a stale profile claims', () => {
    // RevenueCat is the authority when it answers; a profile the webhook has
    // not caught up on must not keep the user locked out of deleting.
    expect(resolveDeletionEligibility('inactive', profile(), NOW)).toEqual({ allowed: true })
  })

  it('falls back to the profile when RevenueCat could not be reached', () => {
    expect(resolveDeletionEligibility('unknown', profile(), NOW)).toEqual({
      allowed: false,
      code: 'ACTIVE_SUBSCRIPTION',
    })
  })

  it('still allows a basic user when RevenueCat could not be reached', () => {
    // Google Play requires this path to exist; it cannot go down with a
    // third party for users who plainly have nothing to cancel.
    const basic = profile({ tier: 'basic', pro_plan: null, tier_expires_at: null })

    expect(resolveDeletionEligibility('unknown', basic, NOW)).toEqual({ allowed: true })
    expect(resolveDeletionEligibility('unknown', null, NOW)).toEqual({ allowed: true })
  })

  it('allows a referral-Pro user even when RevenueCat is unreachable', () => {
    const referralPro = profile({ pro_plan: 'referral' })

    expect(resolveDeletionEligibility('unknown', referralPro, NOW)).toEqual({ allowed: true })
  })
})
