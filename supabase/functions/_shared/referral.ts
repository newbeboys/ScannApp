/**
 * Pure referral business logic, kept free of Deno APIs so the same file is
 * covered by the Vitest suite that runs in CI (mirrors the quota.ts pattern).
 */

/** Angka final, CLAUDE.md Bagian 6. */
export const REFERRED_USER_BONUS_DAYS = 1

export interface ProProfileRow {
  tier: string
  tier_expires_at: string | null
  pro_plan: string | null
}

/**
 * Extends a Pro grant by `days`, starting from whichever is later: the
 * profile's current expiry, or now. A Basic or expired profile always
 * extends from now -- CLAUDE.md Bagian 6, "tambahkan ke expiry saat ini,
 * atau ke now() kalau belum Pro". A `tier: 'pro'` row with no expiry is
 * corrupt data (CLAUDE.md Bagian 6) -- treated the same as expired.
 */
export function extendExpiry(profile: ProProfileRow, days: number, now: Date = new Date()): string {
  const current =
    profile.tier === 'pro' && profile.tier_expires_at ? Date.parse(profile.tier_expires_at) : NaN
  const base = !Number.isNaN(current) && current > now.getTime() ? current : now.getTime()
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Which `pro_plan` a referral reward should leave behind. A Basic profile
 * (no plan) becomes 'referral'. A profile already on a paying plan
 * (monthly/yearly) keeps its plan -- overwriting it with 'referral' would
 * shrink a yearly subscriber's 1GB quota down to referral's 500MB for no
 * reason (design doc Bagian 5).
 */
export function nextProPlan(profile: ProProfileRow): 'monthly' | 'yearly' | 'referral' {
  if (profile.pro_plan === 'monthly' || profile.pro_plan === 'yearly') return profile.pro_plan
  return 'referral'
}

export interface Milestone {
  referral_count_required: number
  pro_days_reward: number
}

/**
 * Which milestones this referrer has newly earned but not yet been granted:
 * every milestone whose threshold the activated count has reached or passed
 * (>=, not exact match), excluding milestones already recorded in the grants
 * ledger. >= instead of exact match matters under concurrency: two different
 * referred users activating close together can make both requests' COUNT
 * query observe the same post-both-increments total, so neither ever sees an
 * intermediate exact value -- >= plus an idempotent per-milestone ledger
 * means the reward still lands the next time anything reads a count that has
 * passed the threshold (branch review, 2026-09-01).
 *
 * Sorted ascending. Normally at most one entry, but tolerates more than one
 * being unclaimed at once (e.g. several checks in a row all raced and lost)
 * by granting each in turn -- the caller applies them additively via
 * extendExpiry, one at a time.
 */
export function unclaimedMilestones(
  activatedCount: number,
  milestones: Milestone[],
  grantedCounts: number[],
): Milestone[] {
  const granted = new Set(grantedCounts)
  return milestones
    .filter(
      (milestone) =>
        milestone.referral_count_required <= activatedCount &&
        !granted.has(milestone.referral_count_required),
    )
    .sort((a, b) => a.referral_count_required - b.referral_count_required)
}
