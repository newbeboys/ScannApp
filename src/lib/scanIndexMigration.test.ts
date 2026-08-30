import { describe, expect, it } from 'vitest'
import {
  annotationSource,
  effectiveFilter,
  enhanceSource,
  filterSource,
  hasEdits,
  migrateScanIndex,
  resolvePage,
} from './scanIndexMigration'

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

    expect(doc.schemaVersion).toBe(6)
    expect(doc.title).toBe('Surat Perjanjian')
    expect(doc.createdAt).toBe('2026-07-25T10:00:00.000Z')
    expect(doc.pageCount).toBe(2)
    expect(doc.pages).toEqual([
      { original: 'scans/doc-1/page-1.jpg' },
      { original: 'scans/doc-1/page-2.jpg' },
    ])
  })

  it('leaves already-migrated documents alone, including their edits', () => {
    const v4Document = {
      schemaVersion: 6 as const,
      id: 'doc-2',
      title: 'Invoice',
      createdAt: '2026-07-26T10:00:00.000Z',
      pageCount: 1,
      pages: [{ original: 'scans/doc-2/page-1.jpg', edited: 'scans/doc-2/page-1-edited.jpg' }],
    }

    expect(migrateScanIndex([v4Document])).toEqual([v4Document])
  })

  /**
   * Boss Ali has Fase 2 documents on his device with crop & rotation already
   * applied. Upgrading must not change how they look at all — the
   * filter comes back empty, so resolvePage keeps returning the same file.
   */
  it('upgrades Fase 2 documents to the current shape without changing how they look', () => {
    const v2Document = {
      schemaVersion: 2,
      id: 'doc-v2',
      title: 'Kontrak',
      createdAt: '2026-07-26T10:00:00.000Z',
      pageCount: 1,
      pages: [{ original: 'scans/doc-v2/page-1.jpg', edited: 'scans/doc-v2/page-1-edited.jpg' }],
    }

    const [doc] = migrateScanIndex([v2Document])

    expect(doc.schemaVersion).toBe(6)
    expect(doc.filter).toBeUndefined()
    expect(resolvePage(doc.pages[0])).toBe('scans/doc-v2/page-1-edited.jpg')
  })

  it('keeps the document filter and per-page exceptions', () => {
    const filtered = {
      schemaVersion: 6 as const,
      id: 'doc-f',
      title: 'Berfilter',
      createdAt: '2026-08-23T10:00:00.000Z',
      pageCount: 2,
      filter: 'bw' as const,
      pages: [
        { original: 'a.jpg', filtered: 'a-bw.jpg' },
        { original: 'b.jpg', filter: 'none' as const },
      ],
    }

    expect(migrateScanIndex([filtered])).toEqual([filtered])
  })

  /** An unrecognised stored filter (a downgrade, or a hand-edited index) is just dropped. */
  it('drops a stored filter it does not recognise instead of crashing', () => {
    const [doc] = migrateScanIndex([
      {
        schemaVersion: 3,
        id: 'doc-x',
        title: 'Aneh',
        createdAt: '2026-08-23T10:00:00.000Z',
        pageCount: 1,
        filter: 'sepia',
        pages: [{ original: 'a.jpg', filter: 'vintage' }],
      },
    ])

    expect(doc.filter).toBeUndefined()
    expect(doc.pages[0].filter).toBeUndefined()
  })

  it('keeps sourceDocumentIds on merged documents', () => {
    const merged = {
      schemaVersion: 6 as const,
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
    schemaVersion: 6 as const,
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

describe('effectiveFilter', () => {
  const doc = { filter: 'bw' as const }

  it('uses the document filter when the page carries no exception', () => {
    expect(effectiveFilter(doc, { original: 'a.jpg' })).toBe('bw')
  })

  it("lets a page's own exception win over the document filter", () => {
    expect(effectiveFilter(doc, { original: 'a.jpg', filter: 'magic' })).toBe('magic')
  })

  /**
   * The point of the mixed-document case: a black-and-white contract with one
   * colour chart in the middle. 'none' has to mean something different from
   * "not set at all".
   */
  it("treats 'none' as deliberately plain, not as following the document", () => {
    expect(effectiveFilter(doc, { original: 'a.jpg', filter: 'none' })).toBeNull()
  })

  it('applies no filter at all when the document has none either', () => {
    expect(effectiveFilter({}, { original: 'a.jpg' })).toBeNull()
  })
})

describe('resolvePage & filterSource', () => {
  const page = { original: 'a.jpg', edited: 'a-edited.jpg', filtered: 'a-bw.jpg' }

  it('shows the filter render when one exists', () => {
    expect(resolvePage(page)).toBe('a-bw.jpg')
  })

  /**
   * What lets swapping a filter keep the crop: a filter is always rendered
   * from the geometry chain, never from a previous filter render.
   */
  it('derives the filter from the geometry chain, not from a prior filter render', () => {
    expect(filterSource(page)).toBe('a-edited.jpg')
    expect(filterSource({ original: 'a.jpg', filtered: 'a-bw.jpg' })).toBe('a.jpg')
  })
})

describe('migrateScanIndex — a v4 document, from the OCR upgrade', () => {
  const v4 = [
    {
      schemaVersion: 4,
      id: 'doc-1',
      title: 'Kwitansi',
      createdAt: '2026-03-02T04:00:00.000Z',
      pageCount: 1,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg', filtered: 'a-bw.jpg' }],
    },
  ]

  it('lifts a v4 document to the current shape without touching a single page', () => {
    const [doc] = migrateScanIndex(v4)

    expect(doc.schemaVersion).toBe(6)
    expect(doc.pages).toEqual([{ original: 'a.jpg', edited: 'a-edited.jpg', filtered: 'a-bw.jpg' }])
  })

  it('keeps a recognised-text path', () => {
    const [doc] = migrateScanIndex([
      { ...v4[0], pages: [{ original: 'a.jpg', text: 'a-ocr.json' }] },
    ])

    expect(doc.pages[0].text).toBe('a-ocr.json')
  })

  it('drops a recognised-text field that is not a path', () => {
    const [doc] = migrateScanIndex([
      { ...v4[0], pages: [{ original: 'a.jpg', text: { blocks: [] } }] },
    ])

    expect(doc.pages[0]).toEqual({ original: 'a.jpg' })
  })
})

describe('schema v6 — Perbaiki Pencahayaan', () => {
  it('lifts a v5 document to v6 without losing anything', () => {
    const [doc] = migrateScanIndex([
      {
        schemaVersion: 5,
        id: 'doc-1',
        title: 'Kontrak',
        createdAt: '2026-08-25T00:00:00.000Z',
        pageCount: 1,
        filter: 'bw',
        pages: [{ original: 'scans/doc-1/page-1.jpg', edited: 'scans/doc-1/page-1-edited.jpg' }],
      },
    ])

    expect(doc.schemaVersion).toBe(6)
    expect(doc.filter).toBe('bw')
    expect(doc.pages[0].edited).toBe('scans/doc-1/page-1-edited.jpg')
    expect(doc.enhance).toBeUndefined()
  })

  it('keeps the lighting render while the document switch is on', () => {
    const [doc] = migrateScanIndex([
      {
        schemaVersion: 6,
        id: 'doc-1',
        title: 'Kontrak',
        createdAt: '2026-08-30T00:00:00.000Z',
        pageCount: 1,
        enhance: true,
        pages: [
          { original: 'scans/doc-1/page-1.jpg', enhanced: 'scans/doc-1/page-1-enhanced.jpg' },
        ],
      },
    ])

    expect(doc.enhance).toBe(true)
    expect(doc.pages[0].enhanced).toBe('scans/doc-1/page-1-enhanced.jpg')
  })

  /**
   * The same pairing rule the annotated render already follows. Without it a
   * document whose switch is off keeps displaying and exporting a corrected
   * page that nothing left in the index can explain, undo, or re-render.
   */
  it('drops the lighting render when the document switch is not on', () => {
    const [doc] = migrateScanIndex([
      {
        schemaVersion: 6,
        id: 'doc-1',
        title: 'Kontrak',
        createdAt: '2026-08-30T00:00:00.000Z',
        pageCount: 1,
        pages: [
          { original: 'scans/doc-1/page-1.jpg', enhanced: 'scans/doc-1/page-1-enhanced.jpg' },
        ],
      },
    ])

    expect(doc.enhance).toBeUndefined()
    expect(doc.pages[0].enhanced).toBeUndefined()
  })
})

describe('the derived chain with lighting in it', () => {
  const page = {
    original: 'a.jpg',
    edited: 'a-edited.jpg',
    enhanced: 'a-enhanced.jpg',
    filtered: 'a-filtered.jpg',
    annotated: 'a-annotated.jpg',
  }

  it('shows the ink render, which sits on top of everything', () => {
    expect(resolvePage(page)).toBe('a-annotated.jpg')
  })

  it('falls back to the lighting render when there is no filter and no ink', () => {
    expect(
      resolvePage({ original: 'a.jpg', edited: 'a-edited.jpg', enhanced: 'a-enhanced.jpg' }),
    ).toBe('a-enhanced.jpg')
  })

  it('renders a filter from the lighting fix, so the two stack', () => {
    expect(filterSource(page)).toBe('a-enhanced.jpg')
  })

  it('renders the lighting fix from geometry alone, never from a filter', () => {
    expect(enhanceSource(page)).toBe('a-edited.jpg')
  })

  it('draws ink on the filter first, then the lighting fix, then the crop', () => {
    expect(annotationSource(page)).toBe('a-filtered.jpg')
    expect(annotationSource({ original: 'a.jpg', enhanced: 'a-enhanced.jpg' })).toBe(
      'a-enhanced.jpg',
    )
  })
})
