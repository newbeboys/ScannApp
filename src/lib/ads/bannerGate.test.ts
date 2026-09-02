import { describe, expect, test } from 'vitest'
import { shouldShowBanner, type BannerContext } from './bannerGate'

/** Layar tab biasa, tanpa apa pun yang menutupinya. */
const onTabs: BannerContext = {
  signedIn: true,
  onTabs: true,
  reviewingScan: false,
  sheetOpen: false,
  searchActive: false,
}

describe('shouldShowBanner', () => {
  test('tampil di layar tab yang tidak tertutup apa pun', () => {
    expect(shouldShowBanner(onTabs)).toBe(true)
  })

  test('mati sebelum user masuk akun', () => {
    expect(shouldShowBanner({ ...onTabs, signedIn: false })).toBe(false)
  })

  test('mati di luar layar tab — editor, pemindai, paywall', () => {
    expect(shouldShowBanner({ ...onTabs, onTabs: false })).toBe(false)
  })

  test('mati saat hasil pindai sedang ditinjau', () => {
    expect(shouldShowBanner({ ...onTabs, reviewingScan: true })).toBe(false)
  })

  /**
   * Inti temuan Boss Ali dari HP (26 Agustus 2026): lembar Ekspor muncul di
   * *atas* layar tab, jadi `onTabs` masih true dan banner ikut tampil — persis
   * menutupi tombol "Ekspor 3 PDF" yang sedang dituju user.
   */
  test('mati saat ada lembar yang menutupi layar tab', () => {
    expect(shouldShowBanner({ ...onTabs, sheetOpen: true })).toBe(false)
  })

  /**
   * Temuan Boss Ali dari HP (2 September 2026): fokus ke kolom pencarian
   * membuka keyboard, dan banner native ikut "naik" menimpa konten di tengah
   * layar alih-alih diam di bawah.
   */
  test('mati saat kolom pencarian difokus', () => {
    expect(shouldShowBanner({ ...onTabs, searchActive: true })).toBe(false)
  })
})
