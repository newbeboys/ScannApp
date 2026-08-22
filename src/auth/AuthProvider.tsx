import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { translateAuthError } from '../lib/authErrors'
import { fetchOwnProfile } from '../lib/profileApi'
import { forgetPurchaseIdentity, identifyForPurchases } from '../lib/purchases/purchasesService'
import { clearCachedProfile, readCachedProfile, writeCachedProfile } from '../lib/profileCache'
import { supabase } from '../lib/supabase'
import { resolveTier, type Profile } from '../lib/tier'
import { AuthContext, type AuthStatus } from './authContext'

/**
 * Delays between retries while waiting for the purchase webhook, in ms.
 * Front-loaded because the webhook usually lands almost immediately; the later
 * attempts only cover a slow round trip.
 */
const WEBHOOK_RETRY_DELAYS = [0, 1500, 3000, 6000]

/** Turns a Supabase error into an Error carrying an Indonesian message. */
function fail(error: { message?: string } | null): never {
  throw new Error(translateAuthError(error))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  /**
   * False for the moment between signing in and knowing which tier the user
   * is. `tier` says Basic in that gap — right for gating a Pro feature, wrong
   * for showing an ad, which a Pro user has paid not to see.
   */
  const [tierResolved, setTierResolved] = useState(false)

  /**
   * Cache-first: show the last known profile immediately so gating is correct
   * offline, then replace it with the server copy when the network allows.
   */
  const loadProfile = useCallback(async (id: string) => {
    const cached = readCachedProfile(id)
    setProfile(cached)
    // A cached profile is already an answer — the phone has seen this account
    // before, so nothing has to wait for the network to know the tier.
    if (cached) setTierResolved(true)

    try {
      const fresh = await fetchOwnProfile()
      if (!fresh) return // offline, or the signup trigger has not landed yet

      setProfile(fresh)
      writeCachedProfile(fresh)
    } finally {
      // Resolved either way: offline with no cache means Basic is the best
      // answer available, and waiting forever would mean no ads ever.
      setTierResolved(true)
    }
  }, [])

  /**
   * Re-reads the profile after something server-side may have changed it —
   * today that means a purchase landing via the RevenueCat webhook.
   */
  const refreshProfile = useCallback(async (options?: { untilPro?: boolean }) => {
    const delays = options?.untilPro ? WEBHOOK_RETRY_DELAYS : [0]

    for (const delay of delays) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))

      const fresh = await fetchOwnProfile()
      if (!fresh) continue

      setProfile(fresh)
      writeCachedProfile(fresh)

      // Stop as soon as the entitlement has actually landed.
      if (!options?.untilPro || resolveTier(fresh) === 'pro') return
    }
  }, [])

  useEffect(() => {
    // onAuthStateChange fires once with the restored session on startup, so it
    // covers both "already signed in" and every later sign-in/sign-out.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null

      setUserId(user?.id ?? null)
      setEmail(user?.email ?? null)
      setStatus(user ? 'signed-in' : 'signed-out')

      if (user) {
        void loadProfile(user.id)
        // Binds Play Store purchases to this Supabase user, so the webhook
        // can resolve app_user_id straight to profiles.id.
        void identifyForPurchases(user.id)
      } else {
        setProfile(null)
        setTierResolved(false)
        void forgetPurchaseIdentity()
      }
    })

    return () => data.subscription.unsubscribe()
  }, [loadProfile])

  const signIn = useCallback(async (address: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: address.trim(),
      password,
    })
    if (error) fail(error)
  }, [])

  const signUp = useCallback(async (address: string, password: string, displayName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: address.trim(),
      password,
      options: { data: { display_name: displayName.trim() } },
    })
    if (error) fail(error)

    // No session means the project still requires email confirmation; the UI
    // shows a "check your email" step instead of dropping the user inside.
    return { signedIn: data.session !== null }
  }, [])

  const signOut = useCallback(async () => {
    clearCachedProfile()
    const { error } = await supabase.auth.signOut()
    if (error) fail(error)
  }, [])

  const sendPasswordReset = useCallback(async (address: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(address.trim())
    if (error) fail(error)
  }, [])

  const value = useMemo(
    () => ({
      status,
      userId,
      email,
      profile,
      tier: resolveTier(profile),
      tierResolved,
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      refreshProfile,
    }),
    [
      status,
      userId,
      email,
      profile,
      tierResolved,
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      refreshProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
