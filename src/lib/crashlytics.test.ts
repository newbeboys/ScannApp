import { beforeEach, describe, expect, it, vi } from 'vitest'

let isNative = true

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNative,
  },
}))

const setEnabledMock = vi.fn()
vi.mock('@capacitor-firebase/crashlytics', () => ({
  FirebaseCrashlytics: {
    setEnabled: (...args: unknown[]) => setEnabledMock(...args),
  },
}))

const { initCrashlytics } = await import('./crashlytics')

beforeEach(() => {
  isNative = true
  setEnabledMock.mockReset().mockResolvedValue(undefined)
})

describe('initCrashlytics', () => {
  it('enables collection explicitly on native', async () => {
    await initCrashlytics()

    expect(setEnabledMock).toHaveBeenCalledWith({ enabled: true })
  })

  it('does nothing on web — Crashlytics has no Web SDK', async () => {
    isNative = false

    await initCrashlytics()

    expect(setEnabledMock).not.toHaveBeenCalled()
  })

  /**
   * A Crashlytics hiccup at boot must never be the thing that breaks the
   * app's startup — the whole point of this module is resilience against
   * exactly that kind of failure.
   */
  it('swallows a rejected setEnabled instead of throwing', async () => {
    setEnabledMock.mockRejectedValue(new Error('native plugin unavailable'))

    await expect(initCrashlytics()).resolves.toBeUndefined()
  })
})
