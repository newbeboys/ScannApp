import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalScanDocument } from './scanIndexMigration'

/**
 * `resolvePage` is real, tiny, and pure — already covered by
 * scanIndexMigration.test.ts — reimplemented here rather than imported so
 * this file stays free of Capacitor, which the real scanStorage.ts pulls in
 * at the top of the module.
 */
const scanStorage = {
  resolvePage: (page: {
    annotated?: string
    filtered?: string
    enhanced?: string
    edited?: string
    original: string
  }) => page.annotated ?? page.filtered ?? page.enhanced ?? page.edited ?? page.original,
  createDocumentFromPages: vi.fn(async (sources: { pagePath: string }[], title: string, sourceDocumentIds?: string[]) => ({
    schemaVersion: 2,
    id: 'merged-doc',
    title,
    createdAt: '2026-09-01T00:00:00.000Z',
    pageCount: sources.length,
    pages: sources.map((s) => ({ original: s.pagePath })),
    ...(sourceDocumentIds?.length ? { sourceDocumentIds } : {}),
  })),
}
vi.mock('./scanStorage', () => scanStorage)

const { mergeDocuments, planMerge, suggestMergeTitle } = await import('./documentMerge')

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

beforeEach(() => {
  scanStorage.createDocumentFromPages.mockClear()
})

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

/**
 * `planMerge`/`checkMergeAllowed` are pure and already proven in
 * exportLimits.test.ts — this describes the other half: that `mergeDocuments`
 * actually enforces the verdict at the one place a caller could skip the
 * check, and never touches storage when the answer is no.
 */
describe('mergeDocuments', () => {
  it('refuses fewer than two documents without touching storage', async () => {
    await expect(mergeDocuments([doc('a', 3)], 'basic')).rejects.toThrow(
      'Pilih minimal dua dokumen untuk digabungkan.',
    )
    expect(scanStorage.createDocumentFromPages).not.toHaveBeenCalled()
  })

  it('blocks a Basic merge over the 20-page limit before any file is copied', async () => {
    const docs = [doc('a', 12), doc('b', 9)]

    await expect(mergeDocuments(docs, 'basic')).rejects.toThrow('maksimal 20 halaman')
    expect(scanStorage.createDocumentFromPages).not.toHaveBeenCalled()
  })

  it('merges a Basic selection that lands exactly on the limit', async () => {
    const docs = [doc('a', 12), doc('b', 8)]

    const result = await mergeDocuments(docs, 'basic')

    expect(result.pageCount).toBe(20)
    expect(scanStorage.createDocumentFromPages).toHaveBeenCalledTimes(1)
  })

  it('lets Pro merge past the Basic limit', async () => {
    const docs = [doc('a', 12), doc('b', 9)]

    const result = await mergeDocuments(docs, 'pro')

    expect(result.pageCount).toBe(21)
    expect(scanStorage.createDocumentFromPages).toHaveBeenCalledTimes(1)
  })

  it('carries every edited page in its edited form, not the original scan', async () => {
    const withEdits: LocalScanDocument = {
      ...doc('a', 1),
      pages: [{ original: 'scans/a/page-1.jpg', filtered: 'scans/a/page-1-filtered.jpg' }],
    }

    await mergeDocuments([withEdits, doc('b', 1)], 'basic')

    const [sources] = scanStorage.createDocumentFromPages.mock.calls[0]
    expect(sources).toEqual([
      { pagePath: 'scans/a/page-1-filtered.jpg' },
      { pagePath: 'scans/b/page-1.jpg' },
    ])
  })

  it('records which documents were merged and falls back to the suggested title', async () => {
    const docs = [doc('a', 1, 'Invoice'), doc('b', 1, 'Kontrak')]

    await mergeDocuments(docs, 'basic')

    expect(scanStorage.createDocumentFromPages).toHaveBeenCalledWith(
      expect.any(Array),
      'Invoice +1',
      ['a', 'b'],
    )
  })

  it('uses a custom title when one is given', async () => {
    const docs = [doc('a', 1), doc('b', 1)]

    await mergeDocuments(docs, 'basic', 'Berkas Pajak')

    expect(scanStorage.createDocumentFromPages).toHaveBeenCalledWith(
      expect.any(Array),
      'Berkas Pajak',
      ['a', 'b'],
    )
  })
})
