import { describe, expect, it } from 'vitest'
import {
  resetScanStreak,
  scansUntilNextInterstitial,
  SCAN_STREAK_LENGTH,
  SCAN_STREAK_WINDOW_MS,
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

const MINUTE = 60_000

describe('shouldShowInterstitial — 7 scan berurutan dalam 10 menit', () => {
  it('menahan iklan sampai scan ketujuh', () => {
    const storage = fakeStorage()
    const shown = Array.from({ length: SCAN_STREAK_LENGTH }, (_, i) =>
      shouldShowInterstitial('scan-saved', 'basic', storage, i * MINUTE),
    )

    expect(shown).toEqual([false, false, false, false, false, false, true])
  })

  /**
   * Inti aturannya: yang dihitung bukan jumlah scan seumur hidup, tapi tujuh
   * scan yang benar-benar berdempetan. Scan yang santai — sekali tiap
   * beberapa menit — tidak boleh pernah memicu iklan.
   */
  it('tidak memicu apa pun kalau scan-nya berjarak lebih dari 10 menit', () => {
    const storage = fakeStorage()
    const shown = Array.from({ length: 20 }, (_, i) =>
      shouldShowInterstitial('scan-saved', 'basic', storage, i * 11 * MINUTE),
    )

    expect(shown.some(Boolean)).toBe(false)
  })

  it('menjatuhkan scan yang sudah keluar dari jendela 10 menit', () => {
    const storage = fakeStorage()
    // Enam scan cepat, lalu jeda panjang: scan ketujuh datang saat enam yang
    // pertama sudah kedaluwarsa, jadi ia memulai rentetan baru dari nol.
    for (let i = 0; i < 6; i += 1) {
      shouldShowInterstitial('scan-saved', 'basic', storage, i * 1000)
    }

    expect(shouldShowInterstitial('scan-saved', 'basic', storage, 30 * MINUTE)).toBe(false)
  })

  it('memperlakukan tepat 10 menit sebagai terlalu lama — aturannya "kurang dari"', () => {
    const storage = fakeStorage()
    // Scan pertama di 0, lima berikutnya berdempetan, ketujuh pas di menit ke-10.
    shouldShowInterstitial('scan-saved', 'basic', storage, 0)
    for (let i = 1; i < 6; i += 1) {
      shouldShowInterstitial('scan-saved', 'basic', storage, i * 1000)
    }

    expect(
      shouldShowInterstitial('scan-saved', 'basic', storage, SCAN_STREAK_WINDOW_MS),
    ).toBe(false)
  })

  it('memulai rentetan baru setelah iklan benar-benar tampil', () => {
    const storage = fakeStorage()
    for (let i = 0; i < SCAN_STREAK_LENGTH; i += 1) {
      shouldShowInterstitial('scan-saved', 'basic', storage, i * 1000)
    }
    // Yang dipanggil adsService setelah iklannya sungguh tampil.
    resetScanStreak(storage)

    const shown = Array.from({ length: SCAN_STREAK_LENGTH - 1 }, (_, i) =>
      shouldShowInterstitial('scan-saved', 'basic', storage, 8000 + i * 1000),
    )

    expect(shown.some(Boolean)).toBe(false)
  })

  /**
   * Rentetan sengaja TIDAK dihapus saat keputusannya dibuat, tapi saat
   * iklannya sungguh tampil. Kalau dihapus lebih awal, scan ketujuh yang
   * kebetulan datang sebelum ada iklan termuat akan membuang iklannya — dan
   * dengan jendela 10 menit, iklan itu hilang, bukan tertunda.
   */
  it('tetap menagih iklan selama belum ada yang tampil', () => {
    const storage = fakeStorage()
    const shown = Array.from({ length: 9 }, (_, i) =>
      shouldShowInterstitial('scan-saved', 'basic', storage, i * 1000),
    )

    expect(shown.slice(SCAN_STREAK_LENGTH - 1)).toEqual([true, true, true])
  })

  it('melanjutkan rentetan yang tersimpan dari sesi sebelumnya', () => {
    // Aplikasi ditutup setelah 6 scan cepat; scan berikutnya masih dalam
    // jendela yang sama, jadi harus langsung memicu.
    const times = JSON.stringify([1, 2, 3, 4, 5, 6].map((n) => n * 1000))
    const storage = fakeStorage({ 'scannapp.ads.scanTimes': times })

    expect(shouldShowInterstitial('scan-saved', 'basic', storage, 7000)).toBe(true)
  })
})

describe('shouldShowInterstitial — selesai edit & selesai merge', () => {
  it('memicu iklan tiap selesai edit, tanpa menunggu rentetan', () => {
    const storage = fakeStorage()

    expect(shouldShowInterstitial('document-edited', 'basic', storage)).toBe(true)
    expect(shouldShowInterstitial('document-edited', 'basic', storage)).toBe(true)
  })

  it('memicu iklan tiap selesai merge', () => {
    const storage = fakeStorage()

    expect(shouldShowInterstitial('merge-finished', 'basic', storage)).toBe(true)
  })

  it('tidak ikut menghitung sebagai scan', () => {
    const storage = fakeStorage()
    shouldShowInterstitial('document-edited', 'basic', storage)
    shouldShowInterstitial('merge-finished', 'basic', storage)

    expect(scansUntilNextInterstitial(storage)).toBe(SCAN_STREAK_LENGTH)
  })
})

describe('shouldShowInterstitial — gating Pro', () => {
  it('tidak pernah menampilkan iklan untuk Pro', () => {
    const storage = fakeStorage()
    const shown = Array.from({ length: 20 }, (_, i) =>
      shouldShowInterstitial('scan-saved', 'pro', storage, i * 1000),
    )

    expect(shown.some(Boolean)).toBe(false)
    expect(shouldShowInterstitial('document-edited', 'pro', storage)).toBe(false)
    expect(shouldShowInterstitial('merge-finished', 'pro', storage)).toBe(false)
  })

  it('tidak mencatat rentetan selama Pro, jadi turun ke Basic tidak langsung kena iklan', () => {
    const storage = fakeStorage()
    for (let i = 0; i < 10; i += 1) {
      shouldShowInterstitial('scan-saved', 'pro', storage, i * 1000)
    }

    expect(scansUntilNextInterstitial(storage)).toBe(SCAN_STREAK_LENGTH)
    // Langganan habis: user mulai dari nol, bukan langsung disambut iklan.
    expect(shouldShowInterstitial('scan-saved', 'basic', storage, 11_000)).toBe(false)
  })
})

describe('ketahanan terhadap storage & jam bermasalah', () => {
  it('tidak melempar error saat storage mati total', () => {
    expect(() => shouldShowInterstitial('scan-saved', 'basic', brokenStorage())).not.toThrow()
    expect(scansUntilNextInterstitial(brokenStorage())).toBe(SCAN_STREAK_LENGTH)
  })

  it('mengabaikan nilai tersimpan yang rusak', () => {
    expect(scansUntilNextInterstitial(fakeStorage({ 'scannapp.ads.scanTimes': 'entah' }))).toBe(
      SCAN_STREAK_LENGTH,
    )
    expect(
      scansUntilNextInterstitial(fakeStorage({ 'scannapp.ads.scanTimes': '{"bukan":"array"}' })),
    ).toBe(SCAN_STREAK_LENGTH)
  })

  /**
   * Jam HP bisa mundur (user ganti timezone, atau sinkron NTP). Cap waktu di
   * masa depan tidak boleh dihitung sebagai bagian rentetan — kalau dibiarkan,
   * satu cap rusak bisa menahan atau memicu iklan berjam-jam kemudian.
   */
  it('membuang cap waktu di masa depan', () => {
    const storage = fakeStorage({
      'scannapp.ads.scanTimes': JSON.stringify([50 * MINUTE, 60 * MINUTE]),
    })

    expect(scansUntilNextInterstitial(storage, 1000)).toBe(SCAN_STREAK_LENGTH)
  })
})

describe('resetScanStreak', () => {
  it('mengosongkan rentetan, dipakai saat keluar akun', () => {
    const storage = fakeStorage({ 'scannapp.ads.scanTimes': JSON.stringify([1000, 2000]) })
    resetScanStreak(storage)

    expect(scansUntilNextInterstitial(storage, 3000)).toBe(SCAN_STREAK_LENGTH)
  })
})
