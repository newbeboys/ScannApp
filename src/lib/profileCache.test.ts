import { beforeEach, describe, expect, it } from 'vitest'
import { clearCachedProfile, readCachedProfile, writeCachedProfile } from './profileCache'
import type { Profile } from './tier'

const ALI: Profile = {
  id: 'user-1',
  displayName: 'Ali',
  tier: 'pro',
  tierExpiresAt: '2026-08-26T12:00:00Z',
  proPlan: 'monthly',
  referralCode: 'ABC23456',
}

/**
 * Vitest runs in the node environment here, which has no localStorage. The
 * cache only needs get/set/remove, so a tiny in-memory stand-in keeps the
 * suite dependency-free instead of pulling in jsdom for three methods.
 */
beforeEach(() => {
  const entries = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size
    },
  } satisfies Storage
})

describe('profileCache', () => {
  it('reads back what it stored', () => {
    writeCachedProfile(ALI)

    expect(readCachedProfile('user-1')).toEqual(ALI)
  })

  it('returns null when nothing is cached yet', () => {
    expect(readCachedProfile('user-1')).toBeNull()
  })

  /** Two accounts on one phone must never see each other's tier. */
  it('never hands another user their cached profile', () => {
    writeCachedProfile(ALI)

    expect(readCachedProfile('user-2')).toBeNull()
  })

  it('drops the cache on sign-out', () => {
    writeCachedProfile(ALI)
    clearCachedProfile()

    expect(readCachedProfile('user-1')).toBeNull()
  })

  it('survives a corrupted entry instead of crashing the app', () => {
    localStorage.setItem('scannapp.profile', '{ this is not json')

    expect(readCachedProfile('user-1')).toBeNull()
  })

  it('ignores a cached entry that lost its shape', () => {
    localStorage.setItem('scannapp.profile', JSON.stringify({ id: 'user-1' }))

    expect(readCachedProfile('user-1')).toBeNull()
  })
})
