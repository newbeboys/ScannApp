import { describe, expect, it } from 'vitest'
import {
  readScanCount,
  resetScanCount,
  SCANS_PER_INTERSTITIAL,
  scansUntilNextInterstitial,
  shouldShowInterstitial,
} from './adFrequency'

/** Minimal in-memory Storage so the policy can be tested without a browser. */
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

describe('shouldShowInterstitial — tiap 5 scan', () => {
  it('menahan iklan sampai scan kelima', () => {
    const storage = fakeStorage()
    const shown = Array.from({ length: SCANS_PER_INTERSTITIAL }, () =>
      shouldShowInterstitial('scan-saved', 'basic', storage),
    )

    expect(shown).toEqual([false, false, false, false, true])
  })

  it('mengulang siklus dengan jarak yang sama, bukan tiap scan setelahnya', () => {
    const storage = fakeStorage()
    const shown = Array.from({ length: 12 }, () =>
      shouldShowInterstitial('scan-saved', 'basic', storage),
    )

    // Iklan di scan ke-5 dan ke-10 saja.
    expect(shown.map((value, index) => (value ? index + 1 : null)).filter(Boolean)).toEqual([5, 10])
  })

  it('mereset penghitung setelah iklan tampil', () => {
    const storage = fakeStorage()
    for (let i = 0; i < SCANS_PER_INTERSTITIAL; i += 1) {
      shouldShowInterstitial('scan-saved', 'basic', storage)
    }

    expect(readScanCount(storage)).toBe(0)
  })

  it('melanjutkan hitungan yang tersimpan dari sesi sebelumnya', () => {
    // Aplikasi ditutup setelah 4 scan; scan berikutnya harus langsung memicu.
    const storage = fakeStorage({ 'scannapp.ads.scanCount': '4' })

    expect(shouldShowInterstitial('scan-saved', 'basic', storage)).toBe(true)
  })
})

describe('shouldShowInterstitial — setelah export', () => {
  it('memicu iklan tiap export, tanpa menunggu hitungan', () => {
    const storage = fakeStorage()

    expect(shouldShowInterstitial('export-finished', 'basic', storage)).toBe(true)
    expect(shouldShowInterstitial('export-finished', 'basic', storage)).toBe(true)
  })

  it('tidak ikut menaikkan penghitung scan', () => {
    const storage = fakeStorage()
    shouldShowInterstitial('export-finished', 'basic', storage)

    expect(readScanCount(storage)).toBe(0)
  })
})

describe('shouldShowInterstitial — gating Pro', () => {
  it('tidak pernah menampilkan iklan untuk Pro', () => {
    const storage = fakeStorage()
    const shown = Array.from({ length: 20 }, () =>
      shouldShowInterstitial('scan-saved', 'pro', storage),
    )

    expect(shown.some(Boolean)).toBe(false)
    expect(shouldShowInterstitial('export-finished', 'pro', storage)).toBe(false)
  })

  it('tidak menaikkan penghitung selama Pro, jadi turun ke Basic tidak langsung kena iklan', () => {
    const storage = fakeStorage()
    for (let i = 0; i < 10; i += 1) {
      shouldShowInterstitial('scan-saved', 'pro', storage)
    }

    expect(readScanCount(storage)).toBe(0)
    // Langganan habis: user mulai dari nol, bukan langsung disambut iklan.
    expect(shouldShowInterstitial('scan-saved', 'basic', storage)).toBe(false)
  })
})

describe('ketahanan terhadap storage bermasalah', () => {
  it('membaca 0 saat storage melempar error', () => {
    expect(readScanCount(brokenStorage())).toBe(0)
  })

  it('tidak melempar error saat menghitung scan', () => {
    expect(() => shouldShowInterstitial('scan-saved', 'basic', brokenStorage())).not.toThrow()
  })

  it('mengabaikan nilai tersimpan yang rusak', () => {
    expect(readScanCount(fakeStorage({ 'scannapp.ads.scanCount': 'entah' }))).toBe(0)
    expect(readScanCount(fakeStorage({ 'scannapp.ads.scanCount': '-3' }))).toBe(0)
  })
})

describe('resetScanCount', () => {
  it('mengosongkan penghitung, dipakai saat keluar akun', () => {
    const storage = fakeStorage({ 'scannapp.ads.scanCount': '3' })
    resetScanCount(storage)

    expect(readScanCount(storage)).toBe(0)
    expect(scansUntilNextInterstitial(storage)).toBe(SCANS_PER_INTERSTITIAL)
  })
})
