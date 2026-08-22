import { describe, expect, it } from 'vitest'
import { checkMergeAllowed, MAX_BASIC_MERGE_PAGES, shouldWatermark } from './exportLimits'

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
