import { beforeEach, describe, expect, it, vi } from 'vitest'

let isNative = true

const isDebugMock = vi.fn()
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNative,
  },
  registerPlugin: () => ({
    isDebug: (...args: unknown[]) => isDebugMock(...args),
  }),
}))

const setEnabledMock = vi.fn()
const crashMock = vi.fn()
vi.mock('@capacitor-firebase/crashlytics', () => ({
  FirebaseCrashlytics: {
    setEnabled: (...args: unknown[]) => setEnabledMock(...args),
    crash: (...args: unknown[]) => crashMock(...args),
  },
}))

const { initCrashlytics, isDebugBuild, triggerTestCrash } = await import('./crashlytics')

beforeEach(() => {
  isNative = true
  isDebugMock.mockReset()
  setEnabledMock.mockReset().mockResolvedValue(undefined)
  crashMock.mockReset().mockResolvedValue(undefined)
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

describe('isDebugBuild', () => {
  it('is false on web without ever asking the native plugin', async () => {
    isNative = false

    const result = await isDebugBuild()

    expect(result).toBe(false)
    expect(isDebugMock).not.toHaveBeenCalled()
  })

  it('is true only when the native plugin reports a debug build', async () => {
    isDebugMock.mockResolvedValue({ debug: true })

    expect(await isDebugBuild()).toBe(true)
  })

  it('is false for a release build', async () => {
    isDebugMock.mockResolvedValue({ debug: false })

    expect(await isDebugBuild()).toBe(false)
  })

  /**
   * A missing/broken plugin must fail toward *hiding* the crash-test row —
   * showing it in a build that cannot actually prove it is debug-only would
   * defeat the entire point of gating it.
   */
  it('fails closed to false when the native call rejects', async () => {
    isDebugMock.mockRejectedValue(new Error('plugin not registered'))

    await expect(isDebugBuild()).resolves.toBe(false)
  })
})

describe('triggerTestCrash', () => {
  it('forces a native crash with an identifiable message', async () => {
    await triggerTestCrash()

    expect(crashMock).toHaveBeenCalledWith({
      message: 'Uji Crashlytics manual dari layar Pengaturan',
    })
  })

  it('does nothing on web', async () => {
    isNative = false

    await triggerTestCrash()

    expect(crashMock).not.toHaveBeenCalled()
  })
})
