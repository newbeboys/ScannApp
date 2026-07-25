import { describe, expect, it } from 'vitest'
import { hasEdits, migrateScanIndex, resolvePage } from './scanIndexMigration'

/**
 * Boss Ali already has Fase 1 documents on a real device. If this suite
 * ever fails, upgrading the app would silently lose those scans.
 */
describe('migrateScanIndex', () => {
  const v1Document = {
    id: 'doc-1',
    title: 'Surat Perjanjian',
    createdAt: '2026-07-25T10:00:00.000Z',
    pageCount: 2,
    pagePaths: ['scans/doc-1/page-1.jpg', 'scans/doc-1/page-2.jpg'],
  }

  it('converts Fase 1 documents without losing pages', () => {
    const [doc] = migrateScanIndex([v1Document])

    expect(doc.schemaVersion).toBe(2)
    expect(doc.title).toBe('Surat Perjanjian')
    expect(doc.createdAt).toBe('2026-07-25T10:00:00.000Z')
    expect(doc.pageCount).toBe(2)
    expect(doc.pages).toEqual([
      { original: 'scans/doc-1/page-1.jpg' },
      { original: 'scans/doc-1/page-2.jpg' },
    ])
  })

  it('leaves already-migrated documents alone, including their edits', () => {
    const v2Document = {
      schemaVersion: 2 as const,
      id: 'doc-2',
      title: 'Invoice',
      createdAt: '2026-07-26T10:00:00.000Z',
      pageCount: 1,
      pages: [{ original: 'scans/doc-2/page-1.jpg', edited: 'scans/doc-2/page-1-edited.jpg' }],
    }

    expect(migrateScanIndex([v2Document])).toEqual([v2Document])
  })

  it('keeps sourceDocumentIds on merged documents', () => {
    const merged = {
      schemaVersion: 2 as const,
      id: 'doc-3',
      title: 'Gabungan',
      createdAt: '2026-07-26T11:00:00.000Z',
      pageCount: 1,
      pages: [{ original: 'scans/doc-3/page-1.jpg' }],
      sourceDocumentIds: ['doc-1', 'doc-2'],
    }

    expect(migrateScanIndex([merged])[0].sourceDocumentIds).toEqual(['doc-1', 'doc-2'])
  })

  it('recomputes pageCount rather than trusting a stale stored value', () => {
    const stale = { ...v1Document, pageCount: 99 }
    expect(migrateScanIndex([stale])[0].pageCount).toBe(2)
  })

  it('drops malformed entries instead of throwing away the whole index', () => {
    const result = migrateScanIndex([v1Document, null, { id: 'no-pages' }, { pagePaths: [] }])
    expect(result.map((doc) => doc.id)).toEqual(['doc-1'])
  })

  it('returns an empty list when the stored index is not an array', () => {
    expect(migrateScanIndex(undefined)).toEqual([])
    expect(migrateScanIndex({ corrupted: true })).toEqual([])
  })
})

describe('resolvePage', () => {
  it('prefers the edited file when one exists', () => {
    expect(resolvePage({ original: 'a.jpg', edited: 'a-edited.jpg' })).toBe('a-edited.jpg')
  })

  it('falls back to the original scan', () => {
    expect(resolvePage({ original: 'a.jpg' })).toBe('a.jpg')
  })
})

describe('hasEdits', () => {
  const base = {
    schemaVersion: 2 as const,
    id: 'd',
    title: 't',
    createdAt: '2026-07-26T00:00:00.000Z',
    pageCount: 2,
  }

  it('is true when any page carries an edit', () => {
    expect(
      hasEdits({ ...base, pages: [{ original: 'a.jpg' }, { original: 'b.jpg', edited: 'b2.jpg' }] }),
    ).toBe(true)
  })

  it('is false for an untouched document', () => {
    expect(hasEdits({ ...base, pages: [{ original: 'a.jpg' }, { original: 'b.jpg' }] })).toBe(false)
  })
})
