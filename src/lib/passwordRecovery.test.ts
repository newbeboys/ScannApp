import { beforeEach, describe, expect, it } from 'vitest'
import { clearRecoveryPending, markRecoveryPending, readRecoveryPending } from './passwordRecovery'

/** The node suite has no DOM, so stand in for the WebView's localStorage. */
function installStorage(): void {
  const map = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    },
  })
}

describe('passwordRecovery', () => {
  beforeEach(installStorage)

  it('reports nothing pending on a clean install', () => {
    expect(readRecoveryPending()).toBeNull()
  })

  it('remembers the address across a restart, so a half-done reset is recoverable', () => {
    markRecoveryPending('user@example.com')
    expect(readRecoveryPending()).toBe('user@example.com')
  })

  it('trims the address, which arrives straight from a text field', () => {
    markRecoveryPending('  user@example.com  ')
    expect(readRecoveryPending()).toBe('user@example.com')
  })

  it('forgets the reset once the new password is saved', () => {
    markRecoveryPending('user@example.com')
    clearRecoveryPending()
    expect(readRecoveryPending()).toBeNull()
  })

  it('treats an empty stored value as nothing pending', () => {
    markRecoveryPending('   ')
    expect(readRecoveryPending()).toBeNull()
  })

  it('degrades to no-op when the WebView denies storage', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage disabled')
      },
    })

    expect(() => markRecoveryPending('user@example.com')).not.toThrow()
    expect(readRecoveryPending()).toBeNull()
    expect(() => clearRecoveryPending()).not.toThrow()
  })
})
