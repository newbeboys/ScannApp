import { resolveTier, type Profile } from './tier'

const MB = 1024 * 1024

/**
 * Angka final CLAUDE.md Bagian 6. These mirror
 * `supabase/functions/_shared/quota.ts`, which is what actually enforces them —
 * this copy exists only so the indicator can show what the user is entitled to
 * before their first upload syncs the stored value. The expiry logic itself is
 * not duplicated: it comes from resolveTier().
 */
export const QUOTA_BYTES = {
  basic: 100 * MB,
  monthly: 500 * MB,
  yearly: 1024 * MB,
  referral: 500 * MB,
} as const

export function quotaBytesFor(profile: Profile | null, now: Date = new Date()): number {
  if (resolveTier(profile, now) === 'basic') return QUOTA_BYTES.basic

  const plan = profile?.proPlan
  return plan ? QUOTA_BYTES[plan] : QUOTA_BYTES.basic
}
