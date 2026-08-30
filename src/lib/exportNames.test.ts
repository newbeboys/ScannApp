import { describe, expect, it } from 'vitest'
import { exportNameCandidates, toSafeFilename, uniqueExportNames } from './exportNames'

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

describe('exportNameCandidates', () => {
  /**
   * The order matters: the name the user asked for first, and a suffix only
   * once the folder has already refused it.
   */
  it('offers the asked-for name before any suffix', () => {
    const first = [...exportNameCandidates('Nota.pdf')].slice(0, 3)

    expect(first).toEqual(['Nota.pdf', 'Nota (2).pdf', 'Nota (3).pdf'])
  })

  it('keeps the extension so the file still opens as its type', () => {
    for (const candidate of exportNameCandidates('Nota.pdf')) {
      expect(candidate.endsWith('.pdf')).toBe(true)
    }
  })

  it('handles a name with no extension at all', () => {
    const first = [...exportNameCandidates('Nota')].slice(0, 2)

    expect(first).toEqual(['Nota', 'Nota (2)'])
  })

  /**
   * Bounded rather than endless. A caller that walks this to exhaustion is in
   * a folder with ninety-nine copies of one name, which is a situation to
   * report, not one to keep grinding through a `stat` at a time.
   */
  it('stops rather than running forever', () => {
    const all = [...exportNameCandidates('Nota.pdf')]

    expect(all).toHaveLength(99)
    expect(all.at(-1)).toBe('Nota (99).pdf')
  })
})

describe('toSafeFilename — names that must never reach open()', () => {
  const NUL = String.fromCharCode(0)
  const BS = String.fromCharCode(92)

  /**
   * A NUL ends a C string, so a name carrying one is written under whatever
   * came before it — the extension included. Found by probing the export
   * naming path on 26 Agustus 2026; no title in this app can hold one today,
   * which is exactly why nothing downstream checks.
   */
  it('drops control characters instead of passing them down', () => {
    expect(toSafeFilename('Nota' + NUL + '.exe')).toBe('Nota.exe')
    expect(toSafeFilename(NUL + NUL)).toBe('Dokumen')
  })

  it('never lets a name walk out of its folder', () => {
    for (const title of ['../../etc/passwd', '..', 'a/../b', 'C:' + BS + 'Windows']) {
      const name = toSafeFilename(title) + '.pdf'

      expect(name.includes('/')).toBe(false)
      expect(name.includes(BS)).toBe(false)
      expect(name).not.toBe('..')
    }
  })
})
