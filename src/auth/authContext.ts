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
}

export const AuthContext = createContext<AuthContextValue | null>(null)
