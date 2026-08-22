import { describe, expect, it } from 'vitest'
import {
  classifyEvent,
  planFromProductId,
  resolveProfileUpdate,
  type ProductIds,
  type ProfileState,
  type SubscriptionEvent,
} from './subscriptionEvents.ts'

const PRODUCTS: ProductIds = {
  monthly: 'scannapp_pro_monthly',
  yearly: 'scannapp_pro_yearly',
}

const JAN = Date.parse('2026-01-01T00:00:00Z')
const FEB = Date.parse('2026-02-01T00:00:00Z')
const JUN = Date.parse('2026-06-01T00:00:00Z')

const basic: ProfileState = { tier: 'basic', tier_expires_at: null, pro_plan: null }

function event(overrides: Partial<SubscriptionEvent> = {}): SubscriptionEvent {
  return {
    type: 'INITIAL_PURCHASE',
    appUserId: 'user-1',
    productId: PRODUCTS.monthly,
    expiresAtMs: FEB,
    eventAtMs: JAN,
    ...overrides,
  }
}

describe('classifyEvent', () => {
  it('memberi Pro untuk pembelian dan perpanjangan', () => {
    for (const type of [
      'INITIAL_PURCHASE',
      'RENEWAL',
      'UNCANCELLATION',
      'PRODUCT_CHANGE',
      'SUBSCRIPTION_EXTENDED',
    ]) {
      expect(classifyEvent(type)).toBe('grant')
    }
  })

  it('mencabut Pro saat langganan habis atau di-refund', () => {
    for (const type of ['EXPIRATION', 'REFUND']) {
      expect(classifyEvent(type)).toBe('revoke')
    }
  })

  it('TIDAK mencabut saat SUBSCRIPTION_PAUSED', () => {
    // Play Store menjadwalkan jeda setelah periode berbayar habis, jadi
    // mencabut sekarang mengambil hari yang sudah dibayar. EXPIRATION yang
    // menutupnya nanti.
    expect(classifyEvent('SUBSCRIPTION_PAUSED')).toBe('ignore')
  })

  it('TIDAK bertindak atas TRANSFER — payload-nya berbeda bentuk', () => {
    expect(classifyEvent('TRANSFER')).toBe('ignore')
  })

  it('TIDAK mencabut saat CANCELLATION', () => {
    // User mematikan perpanjangan otomatis, tapi periode yang sudah dibayar
    // masih berjalan. Mencabut di sini berarti mengambil waktu yang dia beli.
    expect(classifyEvent('CANCELLATION')).toBe('ignore')
  })

  it('mengabaikan event yang tidak dikenal, bukan mencabut', () => {
    // RevenueCat menambah tipe event dari waktu ke waktu; tipe baru tidak
    // boleh membuat user berbayar kehilangan Pro-nya.
    expect(classifyEvent('SOMETHING_NEW')).toBe('ignore')
    expect(classifyEvent('')).toBe('ignore')
  })
})

describe('planFromProductId', () => {
  it('mengenali format "produk:base plan" dari Google Play', () => {
    expect(planFromProductId('scannapp_pro_yearly:yearly-auto', PRODUCTS)).toBe('yearly')
  })

  it('mengembalikan null untuk produk asing, bukan menebak', () => {
    expect(planFromProductId('produk_lain', PRODUCTS)).toBeNull()
    expect(planFromProductId(null, PRODUCTS)).toBeNull()
  })
})

describe('grant — pembelian', () => {
  it('menaikkan Basic jadi Pro sampai tanggal dari event', () => {
    const update = resolveProfileUpdate(basic, event(), PRODUCTS)

    expect(update).toEqual({
      tier: 'pro',
      tier_expires_at: new Date(FEB).toISOString(),
      pro_plan: 'monthly',
    })
  })

  it('mencatat paket tahunan supaya kuota 1GB ikut benar', () => {
    const update = resolveProfileUpdate(
      basic,
      event({ productId: `${PRODUCTS.yearly}:yearly-auto` }),
      PRODUCTS,
    )

    expect(update?.pro_plan).toBe('yearly')
  })

  it('jatuh ke monthly untuk produk tak dikenal — kuota kecil arah aman', () => {
    const update = resolveProfileUpdate(basic, event({ productId: 'produk_asing' }), PRODUCTS)

    expect(update?.tier).toBe('pro')
    expect(update?.pro_plan).toBe('monthly')
  })

  it('TIDAK memendekkan sisa Pro yang sudah lebih panjang', () => {
    // Sisa Pro dari referral sampai Juni; beli bulanan yang habis Februari.
    // Membeli tidak boleh menghanguskan hadiah referral.
    const withReferral: ProfileState = {
      tier: 'pro',
      tier_expires_at: new Date(JUN).toISOString(),
      pro_plan: 'referral',
    }

    const update = resolveProfileUpdate(withReferral, event({ expiresAtMs: FEB }), PRODUCTS)

    expect(update?.tier_expires_at).toBe(new Date(JUN).toISOString())
  })

  it('mengabaikan event tanpa tanggal kedaluwarsa', () => {
    expect(resolveProfileUpdate(basic, event({ expiresAtMs: null }), PRODUCTS)).toBeNull()
  })

  it('memperlakukan RENEWAL berulang secara idempoten untuk tanggal yang sama', () => {
    const pro: ProfileState = {
      tier: 'pro',
      tier_expires_at: new Date(FEB).toISOString(),
      pro_plan: 'monthly',
    }
    const renewal = event({ type: 'RENEWAL', expiresAtMs: FEB })

    // Tanggal tidak maju dua kali kalau event yang sama terkirim ulang.
    expect(resolveProfileUpdate(pro, renewal, PRODUCTS)?.tier_expires_at).toBe(
      new Date(FEB).toISOString(),
    )
  })
})

describe('revoke — langganan berakhir', () => {
  const proMonthly: ProfileState = {
    tier: 'pro',
    tier_expires_at: new Date(FEB).toISOString(),
    pro_plan: 'monthly',
  }

  it('menurunkan ke Basic saat langganan habis', () => {
    const update = resolveProfileUpdate(
      proMonthly,
      event({ type: 'EXPIRATION', expiresAtMs: FEB }),
      PRODUCTS,
    )

    expect(update).toEqual({ tier: 'basic', tier_expires_at: null, pro_plan: null })
  })

  it('MEMPERTAHANKAN sisa Pro yang melampaui langganan (mis. hadiah referral)', () => {
    // Jebakan utama: profil punya waktu sampai Juni karena referral, tapi
    // langganan hanya sampai Februari. Turun ke Basic akan mencuri hadiahnya.
    const mixed: ProfileState = {
      tier: 'pro',
      tier_expires_at: new Date(JUN).toISOString(),
      pro_plan: 'monthly',
    }

    const update = resolveProfileUpdate(
      mixed,
      event({ type: 'EXPIRATION', expiresAtMs: FEB }),
      PRODUCTS,
    )

    // Profil dibiarkan apa adanya: apa pun yang tercatat ditulis oleh event
    // yang lebih tahu, dan menimpanya di sini justru merusak kasus upgrade.
    expect(update).toBeNull()
  })

  it('TIDAK menurunkan paket tahunan saat EXPIRATION lama menyusul', () => {
    // User upgrade bulanan -> tahunan. PRODUCT_CHANGE sudah memberi tahunan
    // sampai Juni; lalu EXPIRATION produk lama (Februari) baru tiba. Kalau
    // pro_plan ditimpa jadi referral, pelanggan berbayar turun 1GB -> 500MB.
    const upgraded: ProfileState = {
      tier: 'pro',
      tier_expires_at: new Date(JUN).toISOString(),
      pro_plan: 'yearly',
    }

    expect(
      resolveProfileUpdate(upgraded, event({ type: 'EXPIRATION', expiresAtMs: FEB }), PRODUCTS),
    ).toBeNull()
  })

  it('mencabut segera saat refund, memakai waktu event', () => {
    const update = resolveProfileUpdate(
      proMonthly,
      // Refund tidak selalu membawa expiration; waktu event yang dipakai.
      event({ type: 'REFUND', expiresAtMs: null, eventAtMs: JUN }),
      PRODUCTS,
    )

    expect(update).toEqual({ tier: 'basic', tier_expires_at: null, pro_plan: null })
  })

  it('refund tetap tidak menghanguskan referral yang berlaku lebih lama', () => {
    const mixed: ProfileState = {
      tier: 'pro',
      tier_expires_at: new Date(JUN).toISOString(),
      pro_plan: 'monthly',
    }

    const update = resolveProfileUpdate(
      mixed,
      event({ type: 'REFUND', expiresAtMs: null, eventAtMs: JAN }),
      PRODUCTS,
    )

    // Tidak diubah: sisa waktunya bukan berasal dari langganan yang di-refund.
    expect(update).toBeNull()
  })

  it('tidak menulis apa-apa untuk profil yang memang sudah Basic', () => {
    expect(
      resolveProfileUpdate(basic, event({ type: 'EXPIRATION', expiresAtMs: FEB }), PRODUCTS),
    ).toBeNull()
  })
})

describe('ignore', () => {
  it('CANCELLATION tidak mengubah profil sama sekali', () => {
    const pro: ProfileState = {
      tier: 'pro',
      tier_expires_at: new Date(JUN).toISOString(),
      pro_plan: 'yearly',
    }

    expect(resolveProfileUpdate(pro, event({ type: 'CANCELLATION' }), PRODUCTS)).toBeNull()
  })
})
