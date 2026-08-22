import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  isWithinTolerance,
  parseSignatureHeader,
  verifyWebhookSignature,
} from './webhookSignature.ts'

const SECRET = 'whsec_test_signing_secret'

/**
 * Independent reference implementation via Node's built-in `node:crypto`,
 * deliberately not the module under test's own `crypto.subtle` path — a
 * fixture built from the same code it verifies would only prove the function
 * agrees with itself.
 */
function sign(secret: string, timestampSeconds: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex')
}

function header(timestampSeconds: number, signatureHex: string): string {
  return `t=${timestampSeconds},v1=${signatureHex}`
}

const NOW = new Date('2026-08-22T12:00:00Z')
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)
const BODY = '{"event":{"id":"evt_1","type":"INITIAL_PURCHASE"}}'

describe('parseSignatureHeader', () => {
  it('mem-parse header yang valid', () => {
    expect(parseSignatureHeader('t=1700000000,v1=abcdef0123456789')).toEqual({
      timestampSeconds: 1700000000,
      signatureHex: 'abcdef0123456789',
    })
  })

  it('mengecilkan huruf besar di hex signature', () => {
    expect(parseSignatureHeader('t=1700000000,v1=ABCDEF')).toEqual({
      timestampSeconds: 1700000000,
      signatureHex: 'abcdef',
    })
  })

  it('mengembalikan null untuk header kosong/null', () => {
    expect(parseSignatureHeader(null)).toBeNull()
    expect(parseSignatureHeader('')).toBeNull()
  })

  it('mengembalikan null untuk bentuk yang tidak sesuai, bukan mencoba menyelamatkan sebagian', () => {
    expect(parseSignatureHeader('v1=abcdef')).toBeNull() // tanpa t=
    expect(parseSignatureHeader('t=1700000000')).toBeNull() // tanpa v1=
    expect(parseSignatureHeader('t=abc,v1=abcdef')).toBeNull() // t bukan angka
    expect(parseSignatureHeader('t=1700000000,v1=zzz')).toBeNull() // v1 bukan hex
    expect(parseSignatureHeader('t=1700000000;v1=abcdef')).toBeNull() // pemisah salah
  })
})

describe('isWithinTolerance', () => {
  it('menerima timestamp yang sama persis', () => {
    expect(isWithinTolerance(NOW_SECONDS, NOW, 300)).toBe(true)
  })

  it('menerima tepat di batas toleransi', () => {
    expect(isWithinTolerance(NOW_SECONDS - 300, NOW, 300)).toBe(true)
    expect(isWithinTolerance(NOW_SECONDS + 300, NOW, 300)).toBe(true)
  })

  it('menolak satu detik lewat batas, ke arah manapun', () => {
    expect(isWithinTolerance(NOW_SECONDS - 301, NOW, 300)).toBe(false)
    expect(isWithinTolerance(NOW_SECONDS + 301, NOW, 300)).toBe(false)
  })
})

describe('verifyWebhookSignature', () => {
  it('menerima signature yang valid dan segar', async () => {
    const signature = sign(SECRET, NOW_SECONDS, BODY)

    const result = await verifyWebhookSignature(
      SECRET,
      header(NOW_SECONDS, signature),
      BODY,
      NOW,
    )

    expect(result).toEqual({ ok: true })
  })

  it('menolak saat header tidak ada', async () => {
    expect(await verifyWebhookSignature(SECRET, null, BODY, NOW)).toEqual({
      ok: false,
      reason: 'missing_header',
    })
  })

  it('menolak header yang bentuknya salah', async () => {
    expect(await verifyWebhookSignature(SECRET, 'bukan-header-valid', BODY, NOW)).toEqual({
      ok: false,
      reason: 'malformed_header',
    })
  })

  it('menolak timestamp yang lewat 5 menit (default tolerance) — replay attack', async () => {
    const staleTimestamp = NOW_SECONDS - 301
    // Signature-nya SAH untuk timestamp itu — membuktikan yang menolak
    // memang usia timestamp-nya, bukan signature-nya.
    const signature = sign(SECRET, staleTimestamp, BODY)

    const result = await verifyWebhookSignature(
      SECRET,
      header(staleTimestamp, signature),
      BODY,
      NOW,
    )

    expect(result).toEqual({ ok: false, reason: 'stale_timestamp' })
  })

  it('menolak timestamp yang terlalu jauh di masa depan', async () => {
    const futureTimestamp = NOW_SECONDS + 301
    const signature = sign(SECRET, futureTimestamp, BODY)

    const result = await verifyWebhookSignature(
      SECRET,
      header(futureTimestamp, signature),
      BODY,
      NOW,
    )

    expect(result).toEqual({ ok: false, reason: 'stale_timestamp' })
  })

  it('menghormati toleransi kustom', async () => {
    const timestamp = NOW_SECONDS - 30
    const signature = sign(SECRET, timestamp, BODY)

    expect(
      await verifyWebhookSignature(SECRET, header(timestamp, signature), BODY, NOW, 60),
    ).toEqual({ ok: true })

    expect(
      await verifyWebhookSignature(SECRET, header(timestamp, signature), BODY, NOW, 10),
    ).toEqual({ ok: false, reason: 'stale_timestamp' })
  })

  it('menolak signature yang salah untuk body & timestamp yang benar', async () => {
    const wrongSignature = sign('secret-yang-salah', NOW_SECONDS, BODY)

    const result = await verifyWebhookSignature(
      SECRET,
      header(NOW_SECONDS, wrongSignature),
      BODY,
      NOW,
    )

    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  /**
   * Ini yang membuktikan alasan raw body wajib dipakai. Body yang di-parse
   * lalu di-stringify ulang (spasi berbeda di sini, JSON.parse->JSON.stringify
   * biasanya juga mengubah ini) menghasilkan byte berbeda dari yang
   * ditandatangani RevenueCat, jadi signature yang sah untuk body ASLI harus
   * ditolak untuk body yang sudah "diproses ulang".
   */
  it('menolak body yang sudah diformat ulang meski isinya sama, karena byte-nya beda', async () => {
    const signature = sign(SECRET, NOW_SECONDS, BODY)
    const reformatted = JSON.stringify(JSON.parse(BODY), null, 2)

    expect(reformatted).not.toBe(BODY) // pastikan uji ini memang mengubah byte-nya

    const result = await verifyWebhookSignature(
      SECRET,
      header(NOW_SECONDS, signature),
      reformatted,
      NOW,
    )

    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('menolak body yang diubah walau cuma satu karakter', async () => {
    const signature = sign(SECRET, NOW_SECONDS, BODY)
    const tampered = BODY.replace('INITIAL_PURCHASE', 'INITIAL_PURCHASX')

    const result = await verifyWebhookSignature(
      SECRET,
      header(NOW_SECONDS, signature),
      tampered,
      NOW,
    )

    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' })
  })
})
