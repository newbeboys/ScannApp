/**
 * Storage quota rules. Kept free of Deno APIs so the same file is covered by
 * the Vitest suite that runs in CI.
 *
 * The effective-tier rule deliberately mirrors `src/lib/tier.ts`: the two run
 * in different runtimes (Deno vs the browser bundle) and cannot share a module,
 * so both are tested to stop them drifting apart.
 */

const MB = 1024 * 1024

/** Angka final, CLAUDE.md Bagian 6. */
export const QUOTA_BYTES = {
  basic: 100 * MB,
  monthly: 500 * MB,
  yearly: 1024 * MB,
  referral: 500 * MB,
} as const

export interface ProfileRow {
  tier: string
  tier_expires_at: string | null
  pro_plan: string | null
}

/**
 * Pro is always time-limited, so a `pro` row without a live end date is corrupt
 * data — never a lifetime grant. Every doubtful case resolves to basic.
 */
export function effectiveTier(profile: ProfileRow, now: Date = new Date()): 'basic' | 'pro' {
  if (profile.tier !== 'pro' || !profile.tier_expires_at) return 'basic'

  const expiresAt = Date.parse(profile.tier_expires_at)
  if (Number.isNaN(expiresAt) || expiresAt <= now.getTime()) return 'basic'

  return 'pro'
}

export function quotaBytesFor(profile: ProfileRow, now: Date = new Date()): number {
  if (effectiveTier(profile, now) === 'basic') return QUOTA_BYTES.basic

  const plan = profile.pro_plan
  if (plan === 'monthly' || plan === 'yearly' || plan === 'referral') {
    return QUOTA_BYTES[plan]
  }

  // Pro with no plan recorded — treat conservatively rather than guessing high.
  return QUOTA_BYTES.basic
}

export interface QuotaCheck {
  used: number
  quota: number
  incoming: number
  /** Size of the object being overwritten, 0 for a first-time backup. */
  replacing: number
}

/**
 * Only the growth counts, because re-backing up a document overwrites the same
 * object key. That also keeps shrinking possible for an account whose usage
 * already sits above quota — which happens legitimately when a Pro reward ends
 * and the quota drops. Existing files are never deleted for that reason.
 */
export function fitsInQuota({ used, quota, incoming, replacing }: QuotaCheck): boolean {
  const growth = incoming - replacing
  if (growth <= 0) return true

  return used + growth <= quota
}
