import { describe, expect, it } from 'vitest'
import {
  QUOTA_BYTES,
  effectiveTier,
  fitsInQuota,
  quotaBytesFor,
  type ProfileRow,
} from './quota.ts'

const NOW = new Date('2026-07-26T12:00:00Z')

function row(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return { tier: 'basic', tier_expires_at: null, pro_plan: null, ...overrides }
}

/** Angka final CLAUDE.md Bagian 6. */
describe('QUOTA_BYTES', () => {
  it('matches the agreed megabyte figures', () => {
    expect(QUOTA_BYTES.basic).toBe(100 * 1024 * 1024)
    expect(QUOTA_BYTES.monthly).toBe(500 * 1024 * 1024)
    expect(QUOTA_BYTES.yearly).toBe(1024 * 1024 * 1024)
  })

  it('gives referral Pro the same room as monthly Pro', () => {
    expect(QUOTA_BYTES.referral).toBe(QUOTA_BYTES.monthly)
  })
})

describe('effectiveTier', () => {
  it('reads a plain basic profile as basic', () => {
    expect(effectiveTier(row(), NOW)).toBe('basic')
  })

  it('reads a running subscription as pro', () => {
    const profile = row({ tier: 'pro', pro_plan: 'yearly', tier_expires_at: '2027-01-01T00:00:00Z' })

    expect(effectiveTier(profile, NOW)).toBe('pro')
  })

  it('drops an expired subscription to basic', () => {
    const profile = row({ tier: 'pro', pro_plan: 'monthly', tier_expires_at: '2026-07-01T00:00:00Z' })

    expect(effectiveTier(profile, NOW)).toBe('basic')
  })

  /** Mirrors the client rule: there is no lifetime Pro. */
  it('drops pro without an end date to basic', () => {
    expect(effectiveTier(row({ tier: 'pro', pro_plan: 'yearly' }), NOW)).toBe('basic')
  })
})

describe('quotaBytesFor', () => {
  it('gives basic users 100MB', () => {
    expect(quotaBytesFor(row(), NOW)).toBe(QUOTA_BYTES.basic)
  })

  it('gives a yearly subscriber 1GB', () => {
    const profile = row({ tier: 'pro', pro_plan: 'yearly', tier_expires_at: '2027-01-01T00:00:00Z' })

    expect(quotaBytesFor(profile, NOW)).toBe(QUOTA_BYTES.yearly)
  })

  it('gives a monthly subscriber 500MB', () => {
    const profile = row({
      tier: 'pro',
      pro_plan: 'monthly',
      tier_expires_at: '2026-08-26T12:00:00Z',
    })

    expect(quotaBytesFor(profile, NOW)).toBe(QUOTA_BYTES.monthly)
  })

  it('gives a referral reward 500MB', () => {
    const profile = row({
      tier: 'pro',
      pro_plan: 'referral',
      tier_expires_at: '2026-08-01T12:00:00Z',
    })

    expect(quotaBytesFor(profile, NOW)).toBe(QUOTA_BYTES.referral)
  })

  it('falls back to basic when an expired Pro still names a plan', () => {
    const profile = row({ tier: 'pro', pro_plan: 'yearly', tier_expires_at: '2026-01-01T00:00:00Z' })

    expect(quotaBytesFor(profile, NOW)).toBe(QUOTA_BYTES.basic)
  })

  it('falls back to basic when pro_plan is missing', () => {
    const profile = row({ tier: 'pro', tier_expires_at: '2027-01-01T00:00:00Z' })

    expect(quotaBytesFor(profile, NOW)).toBe(QUOTA_BYTES.basic)
  })
})

describe('fitsInQuota', () => {
  const quota = 1000

  it('allows an upload that lands exactly on the limit', () => {
    expect(fitsInQuota({ used: 900, quota, incoming: 100, replacing: 0 })).toBe(true)
  })

  it('rejects an upload one byte past the limit', () => {
    expect(fitsInQuota({ used: 900, quota, incoming: 101, replacing: 0 })).toBe(false)
  })

  /**
   * Re-backing up an edited document overwrites the same object, so only the
   * size difference counts — otherwise a nearly full account could never
   * replace a file with one of the same size.
   */
  it('allows replacing a file of equal size when the quota is nearly full', () => {
    expect(fitsInQuota({ used: 1000, quota, incoming: 200, replacing: 200 })).toBe(true)
  })

  it('counts only the growth when a replacement is bigger', () => {
    expect(fitsInQuota({ used: 950, quota, incoming: 200, replacing: 150 })).toBe(true)
    expect(fitsInQuota({ used: 950, quota, incoming: 250, replacing: 150 })).toBe(false)
  })

  /** A downgrade can leave usage above quota; shrinking must stay possible. */
  it('allows a smaller replacement even when usage already exceeds quota', () => {
    expect(fitsInQuota({ used: 5000, quota, incoming: 100, replacing: 400 })).toBe(true)
  })

  it('blocks a brand new upload when usage already exceeds quota', () => {
    expect(fitsInQuota({ used: 5000, quota, incoming: 1, replacing: 0 })).toBe(false)
  })
})
