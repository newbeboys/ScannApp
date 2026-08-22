import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TITLE,
  MAX_TITLE_LENGTH,
  normalizeDocumentTitle,
} from './documentTitle.ts'

describe('normalizeDocumentTitle', () => {
  it('keeps an ordinary name as typed', () => {
    expect(normalizeDocumentTitle('KTP Ali')).toBe('KTP Ali')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeDocumentTitle('   Faktur Mei   ')).toBe('Faktur Mei')
  })

  /**
   * Judul dipakai juga untuk menyusun nama berkas ekspor, jadi baris baru di
   * dalamnya menghasilkan berkas yang tidak bisa ditemukan user.
   */
  it('collapses newlines and runs of spaces into one space', () => {
    expect(normalizeDocumentTitle('Surat\n\nJalan\t  2026')).toBe('Surat Jalan 2026')
  })

  it('falls back to a default when the name is empty or only whitespace', () => {
    expect(normalizeDocumentTitle('')).toBe(DEFAULT_TITLE)
    expect(normalizeDocumentTitle('    ')).toBe(DEFAULT_TITLE)
    expect(normalizeDocumentTitle('\n\t ')).toBe(DEFAULT_TITLE)
  })

  it('falls back to a default for anything that is not a string', () => {
    expect(normalizeDocumentTitle(undefined)).toBe(DEFAULT_TITLE)
    expect(normalizeDocumentTitle(null)).toBe(DEFAULT_TITLE)
    expect(normalizeDocumentTitle(42)).toBe(DEFAULT_TITLE)
    expect(normalizeDocumentTitle({ title: 'nakal' })).toBe(DEFAULT_TITLE)
  })

  it('caps an overlong name at the storage limit', () => {
    const result = normalizeDocumentTitle('a'.repeat(500))

    expect(result).toHaveLength(MAX_TITLE_LENGTH)
  })

  /**
   * String.slice memotong per unit UTF-16, jadi emoji yang duduk tepat di batas
   * akan terbelah dan menyisakan surrogate tunggal — Postgres menolaknya, dan
   * rename di cloud gagal tanpa penjelasan apa pun di layar.
   */
  it('never splits an emoji in half when capping', () => {
    // Tiap emoji ini 2 unit UTF-16, jadi batasnya jatuh persis di tengah satu.
    const result = normalizeDocumentTitle('a'.repeat(MAX_TITLE_LENGTH - 1) + '😀😀')

    expect(result).toBe('a'.repeat(MAX_TITLE_LENGTH - 1) + '😀')
    // Surrogate tunggal: high D800-DBFF atau low DC00-DFFF yang tidak berpasangan.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result)).toBe(
      false,
    )
  })

  /** Memotong di tengah bisa menyisakan spasi menggantung di ujung. */
  it('does not leave a trailing space after capping', () => {
    const result = normalizeDocumentTitle(`${'a'.repeat(MAX_TITLE_LENGTH - 1)} bbbb`)

    expect(result).toBe('a'.repeat(MAX_TITLE_LENGTH - 1))
    expect(result.endsWith(' ')).toBe(false)
  })
})
