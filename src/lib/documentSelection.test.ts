import { describe, expect, it } from 'vitest'
import type { DocumentEntry } from './documentEntries'
import {
  isAllSelected,
  isSelectable,
  selectableIds,
  summarizeSelection,
  toggleSelectAll,
  toggleSelection,
} from './documentSelection'
import type { LocalScanDocument } from './scanIndexMigration'

function local(id: string, pageCount: number): DocumentEntry {
  const document: LocalScanDocument = {
    schemaVersion: 5,
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

describe('selectableIds', () => {
  it('lists the local rows in list order and leaves cloud rows out', () => {
    expect(selectableIds([local('a', 1), cloud('b'), local('c', 1)])).toEqual(['a', 'c'])
  })
})

describe('isAllSelected', () => {
  /**
   * A cloud row can never be ticked, so counting it would leave "Semua" saying
   * there is more to select when every selectable row already is.
   */
  it('ignores the cloud rows it could never tick', () => {
    expect(isAllSelected([local('a', 1), cloud('b')], ['a'])).toBe(true)
  })

  it('is false while something selectable is still untouched', () => {
    expect(isAllSelected([local('a', 1), local('b', 1)], ['a'])).toBe(false)
  })

  /** A list with nothing to tick is not "all ticked" — there is no Kosongkan to offer. */
  it('is false when there is nothing selectable at all', () => {
    expect(isAllSelected([cloud('b')], [])).toBe(false)
  })
})

describe('toggleSelectAll', () => {
  it('ticks every local document from an empty selection', () => {
    expect(toggleSelectAll([local('a', 1), cloud('b'), local('c', 1)], [])).toEqual(['a', 'c'])
  })

  it('completes a partial selection rather than clearing it', () => {
    expect(toggleSelectAll([local('a', 1), local('b', 1)], ['a'])).toEqual(['a', 'b'])
  })

  it('clears once everything selectable is already ticked', () => {
    expect(toggleSelectAll([local('a', 1), cloud('c')], ['a'])).toEqual([])
  })
})
