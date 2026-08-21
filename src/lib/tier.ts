export type Tier = 'basic' | 'pro'

/** How the user got Pro. Null for Basic. Drives the storage quota in Fase 4. */
export type ProPlan = 'monthly' | 'yearly' | 'referral'

/** The slice of `public.profiles` the app actually reads. */
export interface Profile {
  id: string
  displayName: string | null
  tier: Tier
  /** ISO timestamp. Always set for Pro — there is no lifetime Pro. */
  tierExpiresAt: string | null
  proPlan: ProPlan | null
  referralCode: string | null
}

const MS_PER_DAY = 86_400_000

/**
 * Returns the timestamp Pro runs out, or null when the profile does not
 * describe a valid, unexpired Pro subscription.
 *
 * Every Pro plan is time-limited (1 month, 1 year, or a referral reward), so a
 * `pro` row without an end date is corrupt data rather than a lifetime grant.
 * Anything doubtful resolves to Basic — a bug must never hand out free Pro.
 */
function proEndsAt(profile: Profile | null, now: Date): number | null {
  if (!profile || profile.tier !== 'pro' || !profile.tierExpiresAt) return null

  const expiresAt = Date.parse(profile.tierExpiresAt)
  if (Number.isNaN(expiresAt) || expiresAt <= now.getTime()) return null

  return expiresAt
}

/**
 * The single source of truth for gating. Callers pass the profile they already
 * have (server or cache) so this stays synchronous and testable offline.
 */
export function resolveTier(profile: Profile | null, now: Date = new Date()): Tier {
  return proEndsAt(profile, now) === null ? 'basic' : 'pro'
}

/**
 * Days of Pro left, rounded up so the final partial day still reads as "1 hari".
 * Null whenever the user is effectively Basic.
 */
export function proDaysRemaining(profile: Profile | null, now: Date = new Date()): number | null {
  const expiresAt = proEndsAt(profile, now)
  if (expiresAt === null) return null

  return Math.ceil((expiresAt - now.getTime()) / MS_PER_DAY)
}

const PLAN_LABELS: Record<ProPlan, string> = {
  monthly: 'Pro Bulanan',
  yearly: 'Pro Tahunan',
  referral: 'Pro dari Referral',
}

/** Label for the account card in Settings. */
export function tierLabel(profile: Profile | null, now: Date = new Date()): string {
  if (resolveTier(profile, now) === 'basic') return 'Basic'
  return profile?.proPlan ? PLAN_LABELS[profile.proPlan] : 'Pro'
}
