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
  /**
   * Whether the profile lookup has finished, however it turned out.
   *
   * `tier` reads Basic until the profile arrives, which is the safe default
   * for gating a feature but the wrong one for spending a Pro user's attention
   * on an ad. Anything that *costs* the user something on the strength of
   * being Basic must wait for this.
   */
  tierResolved: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (
    email: string,
    password: string,
    displayName: string,
    referredByCode?: string,
  ) => Promise<SignUpOutcome>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  /**
   * True while a recovery code has been accepted but the new password has not
   * been saved yet.
   *
   * verifyOtp({ type: 'recovery' }) hands back a full, persisted session, so
   * without this the app cannot tell a half-finished reset apart from an
   * ordinary sign-in — and would drop the user on Beranda still holding the
   * old password. Anything that routes on `status` alone must check this first.
   */
  recoveryPending: boolean
  /** Checks the emailed code and opens the recovery session. */
  verifyRecoveryOtp: (email: string, token: string) => Promise<void>
  /** Saves the new password, which is what ends the recovery state. */
  completeRecovery: (password: string) => Promise<void>
  /** Abandons a half-finished reset: signs out; the old password still stands. */
  cancelRecovery: () => Promise<void>
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
