import { describe, expect, it } from 'vitest'
import { readExportLevel, writeExportLevel } from './exportPreference'

/** A Storage stand-in; setting `fail` makes it throw like a locked-down WebView. */
function fakeStorage(seed: Record<string, string> = {}): Storage & { fail?: 'get' | 'set' } {
  const data = new Map(Object.entries(seed))
  const storage = {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem(key: string) {
      if (storage.fail === 'get') throw new Error('storage disabled')
      return data.get(key) ?? null
    },
    setItem(key: string, value: string) {
      if (storage.fail === 'set') throw new Error('quota exceeded')
      data.set(key, value)
    },
    removeItem: (key: string) => void data.delete(key),
  } as Storage & { fail?: 'get' | 'set' }
  return storage
}

describe('readExportLevel', () => {
  it('starts at standard before the user has ever chosen', () => {
    expect(readExportLevel(fakeStorage())).toBe('standard')
  })

  it('remembers what was written, so a Pro user picks it once', () => {
    const storage = fakeStorage()

    writeExportLevel('small', storage)

    expect(readExportLevel(storage)).toBe('small')
  })

  /**
   * A value written by an older build, or hand-edited, must not decide how
   * every later export is encoded.
   */
  it('falls back to standard for a value it does not recognise', () => {
    expect(readExportLevel(fakeStorage({ 'scannapp.export.level': 'enormous' }))).toBe('standard')
  })

  it('falls back to standard when storage refuses to be read', () => {
    const storage = fakeStorage()
    storage.fail = 'get'

    expect(readExportLevel(storage)).toBe('standard')
  })
})

describe('writeExportLevel', () => {
  it('never throws when storage refuses to be written', () => {
    const storage = fakeStorage()
    storage.fail = 'set'

    expect(() => writeExportLevel('max', storage)).not.toThrow()
  })
})
