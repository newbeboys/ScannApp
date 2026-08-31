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
 * Finds the milestone this activation count exactly matches. Activations are
 * processed one referred user at a time, so the count only ever advances by
 * 1 per call -- an exact match is enough, no need for >= (design doc Bagian 5).
 */
export function matchedMilestone(activatedCount: number, milestones: Milestone[]): Milestone | null {
  return milestones.find((milestone) => milestone.referral_count_required === activatedCount) ?? null
}
