import { describe, expect, test } from 'vitest'
import { MAX_TOAST_MS, MIN_TOAST_MS, toastDurationMs } from './toastDuration'

describe('toastDurationMs', () => {
  test('short confirmations keep the original 2,6 detik', () => {
    expect(toastDurationMs('Dokumen tersimpan.')).toBe(MIN_TOAST_MS)
  })

  test('an empty message still gets the floor rather than 0', () => {
    expect(toastDurationMs('')).toBe(MIN_TOAST_MS)
  })

  /**
   * The point of removing the ellipsis was that a failure can be read. A
   * failure that is legible but gone in 2,6 detik is the same problem wearing
   * a different hat.
   */
  test('a failure with its cause gets longer than a bare confirmation', () => {
    const withCause = toastDurationMs('2 dokumen diekspor, 1 gagal: Penyimpanan penuh.')

    expect(withCause).toBeGreaterThan(MIN_TOAST_MS)
  })

  test('a long native error gets longer still', () => {
    const short = toastDurationMs('2 dokumen diekspor, 1 gagal: Penyimpanan penuh.')
    const long = toastDurationMs(
      "'writeFile' failed with: /storage/emulated/0/Documents/Dok agent.pdf: open failed: EACCES (Permission denied)",
    )

    expect(long).toBeGreaterThan(short)
  })

  test('never outstays its welcome, however long the message', () => {
    expect(toastDurationMs('x'.repeat(5000))).toBe(MAX_TOAST_MS)
  })
})
