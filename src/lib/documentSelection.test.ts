import { describe, expect, it } from 'vitest'
import type { DocumentEntry } from './documentEntries'
import { isSelectable, summarizeSelection, toggleSelection } from './documentSelection'
import type { LocalScanDocument } from './scanIndexMigration'

function local(id: string, pageCount: number): DocumentEntry {
  const document: LocalScanDocument = {
    schemaVersion: 4,
    id,
    title: id,
    createdAt: '2026-08-25T00:00:00.000Z',
    pageCount,
    pages: Array.from({ length: pageCount }, (_, i) => ({ original: `${id}/page-${i + 1}.jpg` })),
  }
  return { kind: 'local', id, document }
}

function cloud(id: string): DocumentEntry {
  return {
    kind: 'cloud',
    id,
    backup: {
      id,
      title: id,
      createdAt: '2026-08-25T00:00:00.000Z',
      pageCount: 4,
      sizeBytes: 1024,
    },
  }
}

describe('isSelectable', () => {
  it('accepts a document that is on the phone', () => {
    expect(isSelectable(local('a', 2))).toBe(true)
  })

  /** A cloud row has no page files here — nothing to export and nothing to delete. */
  it('rejects a cloud-only row', () => {
    expect(isSelectable(cloud('b'))).toBe(false)
  })
})

describe('toggleSelection', () => {
  it('adds an id that was not selected', () => {
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('removes an id that was', () => {
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('leaves the original array untouched', () => {
    const before = ['a']
    toggleSelection(before, 'b')
    expect(before).toEqual(['a'])
  })
})

describe('summarizeSelection', () => {
  it('counts documents and their pages', () => {
    const summary = summarizeSelection([local('a', 2), local('b', 5)], ['a', 'b'])

    expect(summary.count).toBe(2)
    expect(summary.pageCount).toBe(7)
  })

  /**
   * The list refreshes underneath the selection — a backup landing, a delete
   * finishing. A stale id must not reach the exporter as a hole in the array.
   */
  it('drops ids that no longer resolve', () => {
    const summary = summarizeSelection([local('a', 2)], ['a', 'gone'])

    expect(summary.count).toBe(1)
    expect(summary.documents.map((doc) => doc.id)).toEqual(['a'])
  })

  it('drops a cloud row even if its id was somehow selected', () => {
    const summary = summarizeSelection([local('a', 2), cloud('b')], ['a', 'b'])

    expect(summary.count).toBe(1)
    expect(summary.pageCount).toBe(2)
  })

  it('keeps the order the user selected in', () => {
    const summary = summarizeSelection([local('a', 1), local('b', 1)], ['b', 'a'])

    expect(summary.documents.map((doc) => doc.id)).toEqual(['b', 'a'])
  })

  it('reports zero for an empty selection', () => {
    const summary = summarizeSelection([local('a', 3)], [])

    expect(summary).toEqual({ count: 0, pageCount: 0, documents: [] })
  })
})
