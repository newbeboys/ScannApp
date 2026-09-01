import { describe, expect, it } from 'vitest'
import {
  extendExpiry,
  nextProPlan,
  REFERRED_USER_BONUS_DAYS,
  unclaimedMilestones,
  type Milestone,
  type ProProfileRow,
} from './referral.ts'

const NOW = new Date('2026-09-01T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function profile(overrides: Partial<ProProfileRow> = {}): ProProfileRow {
  return { tier: 'basic', tier_expires_at: null, pro_plan: null, ...overrides }
}

/** Angka final, CLAUDE.md Bagian 6. */
describe('REFERRED_USER_BONUS_DAYS', () => {
  it('is 1 day', () => {
    expect(REFERRED_USER_BONUS_DAYS).toBe(1)
  })
})

describe('extendExpiry', () => {
  it('extends from now for a Basic profile', () => {
    const result = extendExpiry(profile(), 7, NOW)
    expect(Date.parse(result)).toBe(NOW.getTime() + 7 * DAY)
  })

  it('extends from now for an expired Pro profile', () => {
    const expired = profile({ tier: 'pro', tier_expires_at: '2026-08-01T00:00:00Z' })
    const result = extendExpiry(expired, 7, NOW)
    expect(Date.parse(result)).toBe(NOW.getTime() + 7 * DAY)
  })

  it('extends from the current expiry for a running Pro subscription', () => {
    const running = profile({ tier: 'pro', tier_expires_at: '2026-09-10T00:00:00Z' })
    const result = extendExpiry(running, 7, NOW)
    expect(Date.parse(result)).toBe(Date.parse('2026-09-10T00:00:00Z') + 7 * DAY)
  })

  it('treats a corrupt pro row (tier pro, no expiry) as if it were expiring now', () => {
    const corrupt = profile({ tier: 'pro', tier_expires_at: null })
    const result = extendExpiry(corrupt, 1, NOW)
    expect(Date.parse(result)).toBe(NOW.getTime() + 1 * DAY)
  })
})

describe('nextProPlan', () => {
  it('gives a Basic profile the referral plan', () => {
    expect(nextProPlan(profile())).toBe('referral')
  })

  it('keeps a monthly subscriber on monthly (does not shrink their quota)', () => {
    expect(nextProPlan(profile({ tier: 'pro', pro_plan: 'monthly' }))).toBe('monthly')
  })

  it('keeps a yearly subscriber on yearly', () => {
    expect(nextProPlan(profile({ tier: 'pro', pro_plan: 'yearly' }))).toBe('yearly')
  })

  it('keeps an existing referral plan as referral', () => {
    expect(nextProPlan(profile({ tier: 'pro', pro_plan: 'referral' }))).toBe('referral')
  })
})

describe('unclaimedMilestones', () => {
  const milestones: Milestone[] = [
    { referral_count_required: 5, pro_days_reward: 7 },
    { referral_count_required: 15, pro_days_reward: 25 },
    { referral_count_required: 30, pro_days_reward: 60 },
  ]

  it('returns the milestone when the count exactly reaches its threshold, nothing granted yet', () => {
    expect(unclaimedMilestones(5, milestones, [])).toEqual([milestones[0]])
    // Lower thresholds are pre-granted here so the assertion isolates just the
    // milestone being reached -- with grantedCounts=[], count=15 also still
    // owes milestone-5, which is covered separately below.
    expect(unclaimedMilestones(15, milestones, [5])).toEqual([milestones[1]])
    expect(unclaimedMilestones(30, milestones, [5, 15])).toEqual([milestones[2]])
  })

  it('regression: a count between milestones still returns the passed-but-unclaimed one (race that skipped the exact value)', () => {
    // The old exact-match matchedMilestone(6, milestones) returned null here --
    // this is the case that let a referrer silently and permanently lose a
    // milestone reward under concurrent activation (branch review, 2026-09-01).
    expect(unclaimedMilestones(6, milestones, [])).toEqual([milestones[0]])
  })

  it('excludes a milestone already in grantedCounts even though its threshold is <= the count', () => {
    expect(unclaimedMilestones(6, milestones, [5])).toEqual([])
  })

  it('returns every threshold passed at once, ascending, when none are granted yet', () => {
    expect(unclaimedMilestones(16, milestones, [])).toEqual([milestones[0], milestones[1]])
  })

  it('returns an empty array for zero activations', () => {
    expect(unclaimedMilestones(0, milestones, [])).toEqual([])
  })

  it('returns an empty array once every milestone up to the count is already granted', () => {
    expect(unclaimedMilestones(31, milestones, [5, 15, 30])).toEqual([])
  })
})
