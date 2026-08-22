import { createContext } from 'react'
import type { Profile, Tier } from '../lib/tier'

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in'

export interface SignUpOutcome {
  /** False when Supabase requires email confirmation before the first sign-in. */
  signedIn: boolean
}

export interface AuthContextValue {
  status: AuthStatus
  userId: string | null
  email: string | null
  profile: Profile | null
  /** Effective tier — already accounts for an expired subscription. */
  tier: Tier
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<SignUpOutcome>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  /**
   * Re-reads the profile from the server.
   *
   * With `untilPro`, keeps retrying for a short while: after a purchase the
   * tier is written by the RevenueCat webhook, which lands a second or two
   * after the Play Store dialog closes. A single read right after the purchase
   * would usually still see Basic.
   */
  refreshProfile: (options?: { untilPro?: boolean }) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
