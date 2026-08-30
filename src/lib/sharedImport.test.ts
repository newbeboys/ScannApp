import { beforeEach, describe, expect, it, vi } from 'vitest'

let isNative = true
let registeredListener: ((data: { paths: string[]; skippedCount: number }) => void) | null = null
const removeMock = vi.fn().mockResolvedValue(undefined)
const addListenerMock = vi.fn(
  (_eventName: string, cb: (data: { paths: string[]; skippedCount: number }) => void) => {
    registeredListener = cb
    return Promise.resolve({ remove: removeMock })
  },
)

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNative,
    convertFileSrc: (path: string) =>
      path.startsWith('file://')
        ? `https://localhost${path.replace('file://', '/_capacitor_file_')}`
        : path,
  },
  registerPlugin: () => ({
    addListener: addListenerMock,
  }),
}))

const { onSharedFilesReceived } = await import('./sharedImport')

beforeEach(() => {
  isNative = true
  registeredListener = null
  addListenerMock.mockClear()
  removeMock.mockClear()
})

describe('onSharedFilesReceived', () => {
  it('converts each path so the webview can read it', () => {
    const results: string[][] = []
    onSharedFilesReceived((result) => results.push(result.images))

    registeredListener?.({ paths: ['file:///cache/a.jpg', 'file:///cache/b.jpg'], skippedCount: 0 })

    expect(results).toEqual([
      [
        'https://localhost/_capacitor_file_/cache/a.jpg',
        'https://localhost/_capacitor_file_/cache/b.jpg',
      ],
    ])
  })

  it('passes skippedCount through untouched', () => {
    const results: number[] = []
    onSharedFilesReceived((result) => results.push(result.skippedCount))

    registeredListener?.({ paths: ['file:///cache/a.jpg'], skippedCount: 2 })

    expect(results).toEqual([2])
  })

  it('still calls back on an all-skipped share, with an empty image list', () => {
    const callback = vi.fn()
    onSharedFilesReceived(callback)

    registeredListener?.({ paths: [], skippedCount: 1 })

    expect(callback).toHaveBeenCalledWith({ images: [], skippedCount: 1 })
  })

  it('never registers the native listener on web', () => {
    isNative = false
    const unsubscribe = onSharedFilesReceived(vi.fn())

    expect(addListenerMock).not.toHaveBeenCalled()
    expect(() => unsubscribe()).not.toThrow()
  })

  it('returns an unsubscribe function that removes the native listener', async () => {
    const unsubscribe = onSharedFilesReceived(vi.fn())
    unsubscribe()
    await Promise.resolve()

    expect(removeMock).toHaveBeenCalledTimes(1)
  })

  it('does not leave an unhandled rejection when native addListener itself rejects', async () => {
    // App.tsx registers this once on mount and (in practice) never calls the
    // returned unsubscribe function during normal operation, so a rejection
    // must be caught right away -- not only inside the unsubscribe closure,
    // which may never run.
    addListenerMock.mockImplementationOnce(() => Promise.reject(new Error('plugin not implemented')))

    expect(() => onSharedFilesReceived(vi.fn())).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    // No assertion beyond "got here": an uncaught rejection here would fail
    // the test file via vitest's unhandled-rejection detection.
  })
})
