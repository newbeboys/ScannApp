import { supabase } from './supabase'
import type { Profile } from './tier'

/** Row shape as it comes back from `public.profiles` (snake_case). */
interface ProfileRow {
  id: string
  display_name: string | null
  tier: string
  tier_expires_at: string | null
  pro_plan: string | null
  referral_code: string | null
  deletion_requested_at: string | null
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    // Anything unexpected in `tier` degrades to basic; resolveTier applies the
    // same rule to the expiry date.
    tier: row.tier === 'pro' ? 'pro' : 'basic',
    tierExpiresAt: row.tier_expires_at,
    proPlan:
      row.pro_plan === 'monthly' || row.pro_plan === 'yearly' || row.pro_plan === 'referral'
        ? row.pro_plan
        : null,
    referralCode: row.referral_code,
    deletionRequestedAt: row.deletion_requested_at,
  }
}

/**
 * Reads the signed-in user's own profile. RLS already scopes this to
 * `auth.uid()`, so no user id has to be passed in.
 *
 * Returns null when offline or when the signup trigger has not finished yet;
 * callers fall back to the cached profile, and from there to Basic.
 */
export async function fetchOwnProfile(): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, tier, tier_expires_at, pro_plan, referral_code, deletion_requested_at')
    .maybeSingle<ProfileRow>()

  if (error || !data) return null
  return toProfile(data)
}
