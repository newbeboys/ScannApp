import { describe, expect, it } from 'vitest'
import { filterEntriesByQuery } from './documentSearch'
import type { DocumentEntry } from './documentEntries'
import type { CloudBackup } from './backupApi'
import type { LocalScanDocument } from './scanStorage'

function local(id: string, title: string): DocumentEntry {
  const document: LocalScanDocument = {
    schemaVersion: 6,
    id,
    title,
    createdAt: '2026-08-20T00:00:00.000Z',
    pageCount: 1,
    pages: [{ original: `scans/${id}/page-1.jpg` }],
  }
  return { kind: 'local', id, document }
}

function cloud(id: string, title: string): DocumentEntry {
  const backup: CloudBackup = {
    id,
    title,
    pageCount: 1,
    sizeBytes: 1000,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  }
  return { kind: 'cloud', id, backup }
}

describe('filterEntriesByQuery', () => {
  it('returns everything when the query is empty', () => {
    const entries = [local('a', 'Kwitansi Agustus'), cloud('b', 'Kontrak Lama')]

    expect(filterEntriesByQuery(entries, '')).toEqual(entries)
  })

  it('returns everything when the query is only whitespace', () => {
    const entries = [local('a', 'Kwitansi Agustus')]

    expect(filterEntriesByQuery(entries, '   ')).toEqual(entries)
  })

  it('matches a partial, case-insensitive title on local documents', () => {
    const entries = [local('a', 'Kwitansi Agustus'), local('b', 'Surat Izin')]

    expect(filterEntriesByQuery(entries, 'agustus').map((e) => e.id)).toEqual(['a'])
    expect(filterEntriesByQuery(entries, 'KWITANSI').map((e) => e.id)).toEqual(['a'])
  })

  /**
   * A backup not yet on the phone still has a title -- the whole point of
   * letting search reach it is finding a document before restoring it.
   */
  it('matches cloud-only entries by their backup title', () => {
    const entries = [local('a', 'Kwitansi Agustus'), cloud('b', 'Kontrak Lama')]

    expect(filterEntriesByQuery(entries, 'kontrak').map((e) => e.id)).toEqual(['b'])
  })

  it('returns nothing when no title matches', () => {
    const entries = [local('a', 'Kwitansi Agustus'), cloud('b', 'Kontrak Lama')]

    expect(filterEntriesByQuery(entries, 'faktur')).toEqual([])
  })

  it('keeps the original order among matches', () => {
    const entries = [local('a', 'Nota A'), local('b', 'Nota B'), local('c', 'Surat C')]

    expect(filterEntriesByQuery(entries, 'nota').map((e) => e.id)).toEqual(['a', 'b'])
  })
})
