import { describe, expect, it } from 'vitest'
import { mergeDocumentEntries } from './documentEntries'
import type { CloudBackup } from './backupApi'
import type { LocalScanDocument } from './scanStorage'

function local(id: string, createdAt: string): LocalScanDocument {
  return {
    schemaVersion: 2,
    id,
    title: `Dokumen ${id}`,
    createdAt,
    pageCount: 1,
    pages: [{ original: `scans/${id}/page-1.jpg` }],
  }
}

function cloud(id: string, createdAt: string): CloudBackup {
  return {
    id,
    title: `Dokumen ${id}`,
    pageCount: 1,
    sizeBytes: 1000,
    createdAt,
    updatedAt: createdAt,
  }
}

describe('mergeDocumentEntries', () => {
  it('lists documents held on the phone', () => {
    const entries = mergeDocumentEntries([local('a', '2026-08-20T00:00:00.000Z')], [])

    expect(entries).toEqual([
      { kind: 'local', id: 'a', document: expect.objectContaining({ id: 'a' }) },
    ])
  })

  /**
   * The whole point of the fix. After a reinstall the phone holds nothing, so
   * every backup has to show up on its own — otherwise the list is empty and
   * the documents look lost.
   */
  it('surfaces backups that have no copy on the phone', () => {
    const entries = mergeDocumentEntries([], [cloud('a', '2026-08-20T00:00:00.000Z')])

    expect(entries).toEqual([
      { kind: 'cloud', id: 'a', backup: expect.objectContaining({ id: 'a' }) },
    ])
  })

  /** A document that is both on the phone and backed up is still one document. */
  it('shows a backed-up document once, as the local copy', () => {
    const entries = mergeDocumentEntries(
      [local('a', '2026-08-20T00:00:00.000Z')],
      [cloud('a', '2026-08-20T00:00:00.000Z')],
    )

    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('local')
  })

  /**
   * Restoring puts the document back with its original date, and storage
   * prepends to the index — so without an explicit sort a document scanned
   * last month would jump to the top the moment it came back.
   */
  it('orders the two sources together, newest first', () => {
    const entries = mergeDocumentEntries(
      [local('lokal-lama', '2026-08-01T00:00:00.000Z'), local('lokal-baru', '2026-08-22T00:00:00.000Z')],
      [cloud('cloud-tengah', '2026-08-10T00:00:00.000Z')],
    )

    expect(entries.map((entry) => entry.id)).toEqual(['lokal-baru', 'cloud-tengah', 'lokal-lama'])
  })

  it('returns nothing when there is nothing anywhere', () => {
    expect(mergeDocumentEntries([], [])).toEqual([])
  })
})
