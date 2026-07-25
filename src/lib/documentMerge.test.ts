import { describe, expect, it } from 'vitest'
import { planMerge, suggestMergeTitle } from './documentMerge'
import type { LocalScanDocument } from './scanIndexMigration'

function doc(id: string, pageCount: number, title = id): LocalScanDocument {
  return {
    schemaVersion: 2,
    id,
    title,
    createdAt: '2026-07-26T00:00:00.000Z',
    pageCount,
    pages: Array.from({ length: pageCount }, (_, i) => ({
      original: `scans/${id}/page-${i + 1}.jpg`,
    })),
  }
}

describe('planMerge', () => {
  it('adds up pages across every selected document', () => {
    expect(planMerge([doc('a', 3), doc('b', 4)], 'basic').pageCount).toBe(7)
  })

  it('allows a Basic merge that lands exactly on the 20-page limit', () => {
    const plan = planMerge([doc('a', 12), doc('b', 8)], 'basic')

    expect(plan.pageCount).toBe(20)
    expect(plan.check.allowed).toBe(true)
  })

  it('blocks a Basic merge one page over the limit', () => {
    const plan = planMerge([doc('a', 12), doc('b', 9)], 'basic')

    expect(plan.pageCount).toBe(21)
    expect(plan.check.allowed).toBe(false)
  })

  it('lets Pro merge far beyond the Basic limit', () => {
    const plan = planMerge([doc('a', 40), doc('b', 60)], 'pro')

    expect(plan.pageCount).toBe(100)
    expect(plan.check.allowed).toBe(true)
    expect(plan.check.limit).toBeNull()
  })

  it('treats an empty selection as zero pages', () => {
    expect(planMerge([], 'basic').pageCount).toBe(0)
  })
})

describe('suggestMergeTitle', () => {
  it('names the result after the first document plus a count', () => {
    expect(suggestMergeTitle([doc('a', 1, 'Invoice'), doc('b', 1, 'Kontrak')])).toBe('Invoice +1')
  })

  it('counts every extra document, not just the second', () => {
    expect(
      suggestMergeTitle([doc('a', 1, 'Invoice'), doc('b', 1), doc('c', 1), doc('d', 1)]),
    ).toBe('Invoice +3')
  })

  it('falls back to a generic name for an empty selection', () => {
    expect(suggestMergeTitle([])).toBe('Dokumen Gabungan')
  })
})
