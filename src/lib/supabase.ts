import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Missing env vars are a build/config mistake, not something a user can fix,
 * so fail loudly here rather than letting every auth call reject with a
 * confusing network error.
 */
if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY belum diisi. Lihat .env.example.',
  )
}

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    // The session lives in localStorage, which survives app restarts inside
    // the Android WebView — that is what lets the app open offline once the
    // user has signed in at least once.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})
