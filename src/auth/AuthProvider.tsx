import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { translateAuthError } from '../lib/authErrors'
import { fetchOwnProfile } from '../lib/profileApi'
import { forgetPurchaseIdentity, identifyForPurchases } from '../lib/purchases/purchasesService'
import {
  clearRecoveryPending,
  markRecoveryPending,
  readRecoveryPending,
} from '../lib/passwordRecovery'
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
   * Seeded straight from storage, before the first paint: the whole point is
   * that a reset interrupted by the app closing is still known to be pending
   * when it reopens. Reading it lazily would let one frame of Beranda through.
   */
  const [recoveryPending, setRecoveryPending] = useState(() => readRecoveryPending() !== null)

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
        /*
          No session, so there is no recovery to finish — clear the flag rather
          than strand the user on a set-password screen that cannot save.
          This is the crash-in-the-gap case: the flag is written just *before*
          verifyOtp (see below), so a process killed in between would otherwise
          reopen pending forever, with no session to update.
        */
        clearRecoveryPending()
        setRecoveryPending(false)
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

  const signUp = useCallback(
    async (address: string, password: string, displayName: string, referredByCode?: string) => {
      const { data, error } = await supabase.auth.signUp({
        email: address.trim(),
        password,
        options: {
          data: {
            display_name: displayName.trim(),
            ...(referredByCode ? { referred_by_code: referredByCode } : {}),
          },
        },
      })
      if (error) fail(error)

      // No session means the project still requires email confirmation; the UI
      // shows a "check your email" step instead of dropping the user inside.
      return { signedIn: data.session !== null }
    },
    [],
  )

  const signOut = useCallback(async () => {
    clearCachedProfile()
    const { error } = await supabase.auth.signOut()
    if (error) fail(error)
  }, [])

  const sendPasswordReset = useCallback(async (address: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(address.trim())
    if (error) fail(error)
  }, [])

  /**
   * Exchanges the emailed 6-digit code for a session.
   *
   * The flag is raised *before* the call, not after, and that ordering is the
   * point: verifyOtp notifies its auth-state subscribers from inside the await,
   * so the listener above flips status to 'signed-in' while this function is
   * still suspended. Marking afterwards would leave one render — the render
   * that shows Beranda — where a session exists and nothing says a password is
   * still owed. Raising it first means the signed-in state is never seen
   * unguarded; a rejected code lowers it again in the catch.
   */
  const verifyRecoveryOtp = useCallback(async (address: string, token: string) => {
    const trimmed = address.trim()
    markRecoveryPending(trimmed)
    setRecoveryPending(true)

    try {
      const { error } = await supabase.auth.verifyOtp({
        email: trimmed,
        token: token.trim(),
        type: 'recovery',
      })
      if (error) fail(error)
    } catch (caught) {
      clearRecoveryPending()
      setRecoveryPending(false)
      throw caught
    }
  }, [])

  /** Saves the new password; only success ends the recovery state. */
  const completeRecovery = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) fail(error)

    clearRecoveryPending()
    setRecoveryPending(false)
  }, [])

  /**
   * Leaves a reset unfinished on purpose. Signing out is what makes this safe:
   * the recovery session is the only thing the code bought, and the account
   * keeps the password it already had.
   */
  const cancelRecovery = useCallback(async () => {
    clearCachedProfile()

    /*
      The session goes first, and the flag only after it. Lowering the flag up
      front would open the route while the session was still alive, and for the
      frame between the two the app would look like an ordinary signed-in user
      — Beranda, flashed on the way out of a reset that was just abandoned.
    */
    const { error } = await supabase.auth.signOut()
    // A global sign-out has to reach the server to revoke the refresh token,
    // so it fails in a tunnel — and a surviving session would land the user on
    // Beranda, which is the one place a cancelled reset must not go. The local
    // scope needs no network, so fall back to it and drop the session anyway.
    if (error) await supabase.auth.signOut({ scope: 'local' })

    // The listener above clears these when the session goes; repeated here so
    // the state is right even if that event is ever missed.
    clearRecoveryPending()
    setRecoveryPending(false)
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
      recoveryPending,
      verifyRecoveryOtp,
      completeRecovery,
      cancelRecovery,
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
      recoveryPending,
      verifyRecoveryOtp,
      completeRecovery,
      cancelRecovery,
      refreshProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
