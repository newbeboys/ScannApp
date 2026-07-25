export type Tier = 'basic' | 'pro'

/**
 * Single source of truth for the current user's tier.
 *
 * Fase 3 replaces the body of this function with a real Supabase profile
 * lookup. Every caller already goes through here, so nothing else has to
 * change when that happens.
 */
export function getCurrentTier(): Tier {
  return 'basic'
}
