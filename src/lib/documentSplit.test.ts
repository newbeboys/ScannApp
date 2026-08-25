import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalScanDocument, ScanPage } from './scanIndexMigration'

/** Titles whose creation should blow up, so the failure path can be exercised. */
const failTitles = new Set<string>()
const created: { paths: string[]; title: string; sourceDocumentIds?: string[] }[] = []
const deleted: string[] = []
let deleteThrows = false

vi.mock('./scanStorage', () => ({
  // The real one copies files; only the arguments matter here.
  createDocumentFromPages: async (
    sources: { pagePath: string }[],
    title: string,
    sourceDocumentIds?: string[],
  ): Promise<LocalScanDocument> => {
    if (failTitles.has(title)) throw new Error('Penyimpanan penuh.')
    created.push({ paths: sources.map((source) => source.pagePath), title, sourceDocumentIds })
    return {
      schemaVersion: 4,
      id: `new-${created.length}`,
      title,
      createdAt: '2026-08-25T00:00:00.000Z',
      pageCount: sources.length,
      pages: sources.map((source) => ({ original: source.pagePath })),
    }
  },
  deleteScanDocument: async (id: string): Promise<void> => {
    if (deleteThrows) throw new Error('Berkas terkunci.')
    deleted.push(id)
  },
  /** The same precedence the real one has: ink, then filter, then edit, then scan. */
  resolvePage: (page: ScanPage): string =>
    page.annotated ?? page.filtered ?? page.edited ?? page.original,
}))

const { splitDocument, summarizeDocumentSplit } = await import('./documentSplit')

function doc(pages: ScanPage[], title = 'Gabungan'): LocalScanDocument {
  return {
    schemaVersion: 4,
    id: 'source-1',
    title,
    createdAt: '2026-08-25T00:00:00.000Z',
    pageCount: pages.length,
    pages,
  }
}

const plain = (n: number): ScanPage[] =>
  Array.from({ length: n }, (_, i) => ({ original: `scans/source-1/page-${i + 1}.jpg` }))

beforeEach(() => {
  failTitles.clear()
  created.length = 0
  deleted.length = 0
  deleteThrows = false
})

describe('splitDocument', () => {
  it('makes one document per group, numbered from the name it was given', async () => {
    const result = await splitDocument(doc(plain(3)), [[0, 1], [2]], 'Kwitansi')

    expect(created).toEqual([
      {
        paths: ['scans/source-1/page-1.jpg', 'scans/source-1/page-2.jpg'],
        title: 'Kwitansi (1)',
        sourceDocumentIds: undefined,
      },
      {
        paths: ['scans/source-1/page-3.jpg'],
        title: 'Kwitansi (2)',
        sourceDocumentIds: undefined,
      },
    ])
    expect(result.saved).toHaveLength(2)
    expect(result.message).toBe('2 dokumen dibuat. Dokumen asli masih ada.')
  })

  /**
   * The page the user is looking at, not the scan underneath it — the same rule
   * merge follows. A split that handed back the unfiltered, uncropped original
   * would look like it had undone every edit on the document.
   */
  it('copies the page as it is displayed, through resolvePage', async () => {
    const pages: ScanPage[] = [
      { original: 'p1.jpg', edited: 'p1-edited.jpg', filtered: 'p1-filtered.jpg' },
      { original: 'p2.jpg', annotated: 'p2-annotated.jpg', filtered: 'p2-filtered.jpg' },
    ]

    await splitDocument(doc(pages), [[0], [1]], 'Nota')

    expect(created.map((entry) => entry.paths)).toEqual([
      ['p1-filtered.jpg'],
      ['p2-annotated.jpg'],
    ])
  })

  /** `sourceDocumentIds` means "this is a merge"; a split is the opposite. */
  it('never marks the results as a merge', async () => {
    await splitDocument(doc(plain(2)), [[0], [1]], 'Nota')

    expect(created.every((entry) => entry.sourceDocumentIds === undefined)).toBe(true)
  })

  it('leaves the source alone unless asked', async () => {
    await splitDocument(doc(plain(2)), [[0], [1]], 'Nota')

    expect(deleted).toEqual([])
  })

  it('deletes the source when asked, once every group has landed', async () => {
    const result = await splitDocument(doc(plain(2)), [[0], [1]], 'Nota', {
      deleteOriginal: true,
    })

    expect(deleted).toEqual(['source-1'])
    expect(result.originalRemoved).toBe(true)
    expect(result.message).toBe('2 dokumen dibuat, dokumen asli dihapus.')
  })

  /**
   * The pages of a group that failed exist nowhere else yet. Deleting the source
   * on a partial run would take them with it, and a page that is gone cannot be
   * recovered from anywhere on the phone.
   */
  it('keeps the source when a group failed, even with delete asked for', async () => {
    failTitles.add('Nota (2)')

    const result = await splitDocument(doc(plain(2)), [[0], [1]], 'Nota', {
      deleteOriginal: true,
    })

    expect(deleted).toEqual([])
    expect(result.originalRemoved).toBe(false)
    expect(result.remaining).toEqual([[1]])
  })

  /** The new documents are already safe; a source that will not go is untidy, not fatal. */
  it('still reports success when the source refuses to delete', async () => {
    deleteThrows = true

    const result = await splitDocument(doc(plain(2)), [[0], [1]], 'Nota', {
      deleteOriginal: true,
    })

    expect(result.saved).toHaveLength(2)
    expect(result.originalRemoved).toBe(false)
    expect(result.message).toBe('2 dokumen dibuat. Dokumen asli masih ada.')
  })

  it('carries on past a group that failed rather than losing the rest', async () => {
    failTitles.add('Nota (2)')

    const result = await splitDocument(doc(plain(3)), [[0], [1], [2]], 'Nota')

    expect(result.saved).toHaveLength(2)
    expect(result.remaining).toEqual([[1]])
    expect(result.message).toContain('2 dokumen dibuat, 1 gagal')
  })

  it('refuses a document that has not been cut at all', async () => {
    await expect(splitDocument(doc(plain(3)), [[0, 1, 2]], 'Nota')).rejects.toThrow(
      'Belum ada pemisah',
    )
    expect(created).toEqual([])
  })

  it('refuses when there is nothing to split', async () => {
    await expect(splitDocument(doc(plain(2)), [], 'Nota')).rejects.toThrow('Tidak ada halaman')
  })

  /** A stale cut can name a page that is no longer there; it must not mint an empty document. */
  it('drops page indices the document does not have', async () => {
    await splitDocument(doc(plain(2)), [[0], [1, 7], [9]], 'Nota')

    expect(created.map((entry) => entry.paths)).toEqual([
      ['scans/source-1/page-1.jpg'],
      ['scans/source-1/page-2.jpg'],
    ])
  })

  it('continues the numbering from startAt', async () => {
    await splitDocument(doc(plain(2)), [[0], [1]], 'Nota', { startAt: 4 })

    expect(created.map((entry) => entry.title)).toEqual(['Nota (5)', 'Nota (6)'])
  })

  it('reports progress from zero through to done', async () => {
    const seen: string[] = []

    await splitDocument(doc(plain(2)), [[0], [1]], 'Nota', {}, (done, total) =>
      seen.push(`${done}/${total}`),
    )

    expect(seen).toEqual(['0/2', '1/2', '2/2'])
  })
})

describe('summarizeDocumentSplit', () => {
  it('says the source is still there when it is', () => {
    expect(summarizeDocumentSplit(3, 0, false)).toBe('3 dokumen dibuat. Dokumen asli masih ada.')
  })

  it('says the source is gone when it is', () => {
    expect(summarizeDocumentSplit(3, 0, true)).toBe('3 dokumen dibuat, dokumen asli dihapus.')
  })

  /** Not "coba lagi": the source still holds every page, so a retry would duplicate. */
  it('tells a partial run to clear up before retrying', () => {
    expect(summarizeDocumentSplit(2, 1, false)).toContain('hapus hasil yang sudah jadi')
  })

  it('does not claim anything was made when nothing was', () => {
    expect(summarizeDocumentSplit(0, 2, false)).toBe(
      'Tidak ada dokumen yang dibuat. Dokumen aslinya masih utuh — coba lagi.',
    )
  })
})
