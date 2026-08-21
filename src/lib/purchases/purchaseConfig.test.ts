import { describe, expect, it } from 'vitest'
import { FALLBACK_PRICES, matchPlanId, PRODUCT_IDS } from './purchaseConfig'

describe('matchPlanId', () => {
  it('mengenali product id polos', () => {
    expect(matchPlanId(PRODUCT_IDS.monthly)).toBe('monthly')
    expect(matchPlanId(PRODUCT_IDS.yearly)).toBe('yearly')
  })

  it('mengenali format "produk:base plan" dari Google Play', () => {
    // Bentuk inilah yang benar-benar dikirim device; kalau dibandingkan
    // mentah-mentah, paywall tidak akan pernah menemukan paketnya.
    expect(matchPlanId(`${PRODUCT_IDS.monthly}:monthly-autorenew`)).toBe('monthly')
    expect(matchPlanId(`${PRODUCT_IDS.yearly}:yearly-autorenew`)).toBe('yearly')
  })

  it('menolak produk yang tidak dikenal, bukan menebak', () => {
    // Menebak berarti produk asing bisa kebagian kuota 1GB milik paket tahunan.
    expect(matchPlanId('scannapp_pro_lifetime')).toBeNull()
    expect(matchPlanId('')).toBeNull()
    expect(matchPlanId('scannapp_pro_monthly_v2')).toBeNull()
  })

  it('tidak tertukar antara bulanan dan tahunan', () => {
    expect(PRODUCT_IDS.monthly).not.toBe(PRODUCT_IDS.yearly)
  })
})

describe('FALLBACK_PRICES', () => {
  it('memakai harga final PRD Bagian 6', () => {
    expect(FALLBACK_PRICES.monthly).toBe('Rp 15.000')
    expect(FALLBACK_PRICES.yearly).toBe('Rp 150.000')
  })
})
