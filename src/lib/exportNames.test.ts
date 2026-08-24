import { describe, expect, it } from 'vitest'
import { toSafeFilename, uniqueExportNames } from './exportNames'

describe('toSafeFilename', () => {
  it('strips characters Android and Windows reject', () => {
    expect(toSafeFilename('Nota/Agustus: 2026?')).toBe('Nota Agustus 2026')
  })

  it('falls back to a usable name when nothing survives', () => {
    expect(toSafeFilename('///')).toBe('Dokumen')
  })

  it('truncates at 60 characters', () => {
    expect(toSafeFilename('a'.repeat(80))).toHaveLength(60)
  })
})

describe('uniqueExportNames', () => {
  it('leaves already-distinct names alone', () => {
    expect(uniqueExportNames(['Nota.pdf', 'Kontrak.pdf'])).toEqual(['Nota.pdf', 'Kontrak.pdf'])
  })

  /**
   * The bug this locks out: two documents whose titles reduce to the same
   * filename used to write the same path, so the second silently overwrote the
   * first and the user got one file fewer than they selected.
   */
  it('numbers a repeat instead of letting it overwrite', () => {
    expect(uniqueExportNames(['Nota.pdf', 'Nota.pdf'])).toEqual(['Nota.pdf', 'Nota (2).pdf'])
  })

  it('keeps counting past a three-way collision', () => {
    expect(uniqueExportNames(['Nota.pdf', 'Nota.pdf', 'Nota.pdf'])).toEqual([
      'Nota.pdf',
      'Nota (2).pdf',
      'Nota (3).pdf',
    ])
  })

  it('puts the number before the extension so the file still opens as a PDF', () => {
    expect(uniqueExportNames(['Nota.pdf', 'Nota.pdf'])[1].endsWith('.pdf')).toBe(true)
  })

  /** Android and Windows both match filenames case-insensitively. */
  it('treats names differing only in case as a collision', () => {
    expect(uniqueExportNames(['Nota.pdf', 'NOTA.pdf'])).toEqual(['Nota.pdf', 'NOTA (2).pdf'])
  })

  /** A batch can already contain the very name the counter is about to mint. */
  it('skips a suffix that is already taken', () => {
    expect(uniqueExportNames(['Nota.pdf', 'Nota (2).pdf', 'Nota.pdf'])).toEqual([
      'Nota.pdf',
      'Nota (2).pdf',
      'Nota (3).pdf',
    ])
  })

  it('handles a name with no extension at all', () => {
    expect(uniqueExportNames(['Nota', 'Nota'])).toEqual(['Nota', 'Nota (2)'])
  })

  it('returns an empty list untouched', () => {
    expect(uniqueExportNames([])).toEqual([])
  })
})
