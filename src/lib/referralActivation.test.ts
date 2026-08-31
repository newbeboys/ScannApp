import { describe, expect, it } from 'vitest'
import { hasSentReferralActivation, markReferralActivationSent } from './referralActivation'

/** Minimal in-memory Storage, mirrors the fakeStorage helper in adFrequency.test.ts. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

/** Storage that throws on every operation, like a locked-down WebView. */
function brokenStorage(): Storage {
  const boom = () => {
    throw new Error('storage disabled')
  }
  return {
    get length(): number {
      return boom()
    },
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  }
}

describe('hasSentReferralActivation / markReferralActivationSent', () => {
  it('is false before anything is marked', () => {
    expect(hasSentReferralActivation(fakeStorage())).toBe(false)
  })

  it('is true after marking', () => {
    const storage = fakeStorage()
    markReferralActivationSent(storage)
    expect(hasSentReferralActivation(storage)).toBe(true)
  })

  it('treats unreadable storage as not-yet-sent, so the call is retried', () => {
    expect(hasSentReferralActivation(brokenStorage())).toBe(false)
  })

  it('does not throw when storage rejects the write', () => {
    expect(() => markReferralActivationSent(brokenStorage())).not.toThrow()
  })
})
