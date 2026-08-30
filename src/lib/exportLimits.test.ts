import { describe, expect, it } from 'vitest'
import {
  checkMergeAllowed,
  COMPRESSION_LABELS,
  COMPRESSION_LEVELS,
  COMPRESSION_PRESETS,
  MAX_BASIC_MERGE_PAGES,
  resolveCompressionLevel,
  shouldWatermark,
  type CompressionLevel,
} from './exportLimits'

/** Angka final dari PRD Bagian 3 / CLAUDE.md Bagian 6. */
describe('MAX_BASIC_MERGE_PAGES', () => {
  it('is 20 pages', () => {
    expect(MAX_BASIC_MERGE_PAGES).toBe(20)
  })
})

describe('checkMergeAllowed', () => {
  it('allows Basic right up to the limit', () => {
    expect(checkMergeAllowed('basic', 20).allowed).toBe(true)
  })

  it('blocks Basic one page past the limit', () => {
    const result = checkMergeAllowed('basic', 21)

    expect(result.allowed).toBe(false)
    expect(result.limit).toBe(20)
    expect(result.reason).toContain('20 halaman')
  })

  it('reports the attempted page count so the user knows how far over they are', () => {
    expect(checkMergeAllowed('basic', 34).reason).toContain('34')
  })

  it('never blocks Pro, however many pages', () => {
    const result = checkMergeAllowed('pro', 5000)

    expect(result.allowed).toBe(true)
    expect(result.limit).toBeNull()
    expect(result.reason).toBeNull()
  })

  it('allows an empty or single-page selection for Basic', () => {
    expect(checkMergeAllowed('basic', 0).allowed).toBe(true)
    expect(checkMergeAllowed('basic', 1).allowed).toBe(true)
  })
})

describe('shouldWatermark', () => {
  it('marks Basic exports', () => {
    expect(shouldWatermark('basic')).toBe(true)
  })

  it('leaves Pro exports clean', () => {
    expect(shouldWatermark('pro')).toBe(false)
  })
})

/**
 * Fase 6 potongan A: the manual compression control (Pro).
 *
 * The slider is only honest if the presets really do trade quality against
 * size in one direction, so that is asserted rather than assumed.
 */
describe('COMPRESSION_PRESETS', () => {
  it('lists the levels from smallest file to best quality', () => {
    expect(COMPRESSION_LEVELS).toEqual(['small', 'standard', 'high', 'max'])
  })

  it('leaves the standard level exactly where Basic has always been', () => {
    expect(COMPRESSION_PRESETS.standard).toEqual({ quality: 0.75, maxEdgePx: 2400 })
  })

  it('raises quality at every step up', () => {
    const qualities = COMPRESSION_LEVELS.map((level) => COMPRESSION_PRESETS[level].quality)

    expect(qualities).toEqual([...qualities].sort((a, b) => a - b))
    expect(new Set(qualities).size).toBe(qualities.length)
  })

  it('raises the pixel ceiling at every step up', () => {
    const edges = COMPRESSION_LEVELS.map((level) => COMPRESSION_PRESETS[level].maxEdgePx)

    expect(edges).toEqual([...edges].sort((a, b) => a - b))
    expect(new Set(edges).size).toBe(edges.length)
  })

  it('caps even the best level, so a huge scan cannot exhaust a low-end phone', () => {
    expect(COMPRESSION_PRESETS.max.maxEdgePx).toBeLessThanOrEqual(4000)
  })

  it('names every level in Indonesian for the slider', () => {
    for (const level of COMPRESSION_LEVELS) {
      expect(COMPRESSION_LABELS[level]).toBeTruthy()
    }
  })
})

describe('resolveCompressionLevel', () => {
  it('gives back every level it recognises, unchanged', () => {
    for (const level of COMPRESSION_LEVELS) {
      expect(resolveCompressionLevel(level)).toBe(level)
    }
  })

  /**
   * The reason this function still exists now that the Pro gate is gone
   * (25 Agustus 2026): the level comes back from `localStorage`, so it can be
   * anything — a value written by a future build, or a corrupted string. Left
   * unchecked it reaches `COMPRESSION_PRESETS` as `undefined` and the export
   * encodes at `quality: undefined`.
   */
  it('falls back to standard for a level it does not recognise', () => {
    expect(resolveCompressionLevel('enormous' as CompressionLevel)).toBe('standard')
  })
})
