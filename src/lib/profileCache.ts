import type { Profile } from './tier'

const KEY = 'scannapp.profile'

/**
 * The app is local-first: it has to open and keep working in a tunnel. Caching
 * the last known profile lets tier gating stay correct offline, and the userId
 * check makes sure a second account on the same phone never inherits the
 * first account's Pro status.
 */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // storage disabled by the WebView
  }
}

function isProfile(value: unknown): value is Profile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.id === 'string' &&
    (candidate.tier === 'basic' || candidate.tier === 'pro') &&
    (candidate.tierExpiresAt === null || typeof candidate.tierExpiresAt === 'string')
  )
}

export function writeCachedProfile(profile: Profile): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(profile))
  } catch {
    // quota full or private mode — the app still works, just without the cache
  }
}

export function readCachedProfile(userId: string): Profile | null {
  const raw = storage()?.getItem(KEY)
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isProfile(parsed) || parsed.id !== userId) return null
    return parsed
  } catch {
    return null
  }
}

export function clearCachedProfile(): void {
  storage()?.removeItem(KEY)
}
