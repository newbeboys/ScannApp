import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalScanDocument } from './scanIndexMigration'

/** Titles whose save should blow up, so the failure path can be exercised. */
const failTitles = new Set<string | undefined>()
const savedCalls: { uris: string[]; title: string | undefined }[] = []

vi.mock('./scanStorage', () => ({
  saveScanDocument: async (uris: string[], title?: string): Promise<LocalScanDocument> => {
    if (failTitles.has(title)) throw new Error('Penyimpanan penuh.')
    savedCalls.push({ uris, title })
    return {
      schemaVersion: 4,
      id: `doc-${savedCalls.length}`,
      title: title ?? 'Scan bawaan',
      createdAt: '2026-08-25T00:00:00.000Z',
      pageCount: uris.length,
      pages: uris.map((uri) => ({ original: uri })),
    }
  },
}))

const {
  boundaryCuts,
  canSplitScan,
  everyNCuts,
  planSplit,
  saveSplitScan,
  splitTitles,
  summarizeSplitSave,
  toggleCut,
} = await import('./scanSplit')

beforeEach(() => {
  failTitles.clear()
  savedCalls.length = 0
})

describe('planSplit', () => {
  it('groups pages around the cuts', () => {
    expect(planSplit(7, [2, 3, 6])).toEqual([[0, 1], [2], [3, 4, 5], [6]])
  })

  it('is one document when there are no cuts', () => {
    expect(planSplit(3, [])).toEqual([[0, 1, 2]])
  })

  it('is one document per page when every position is cut', () => {
    expect(planSplit(3, [1, 2])).toEqual([[0], [1], [2]])
  })

  it('ignores duplicate cuts', () => {
    expect(planSplit(4, [2, 2, 2])).toEqual([[0, 1], [2, 3]])
  })

  it('ignores cuts at 0 and past the last page', () => {
    // A cut at 0 would mint an empty first document; a cut past the end would
    // mint an empty last one. Both arrive for real after a half-successful
    // save shrinks the page list under the cuts.
    expect(planSplit(3, [0, 1, 3, 9, -2])).toEqual([[0], [1, 2]])
  })

  it('sorts cuts that arrive out of order', () => {
    expect(planSplit(4, [3, 1])).toEqual([[0], [1, 2], [3]])
  })

  it('has nothing to group when there are no pages', () => {
    expect(planSplit(0, [1])).toEqual([])
  })
})

describe('toggleCut', () => {
  it('adds a cut, keeping the list sorted', () => {
    expect(toggleCut([1, 5], 3)).toEqual([1, 3, 5])
  })

  it('removes a cut that is already there', () => {
    expect(toggleCut([1, 3, 5], 3)).toEqual([1, 5])
  })

  it('never mutates the array it was handed', () => {
    const cuts = [1, 5]
    toggleCut(cuts, 3)
    expect(cuts).toEqual([1, 5])
  })
})

describe('everyNCuts', () => {
  it('cuts after every page', () => {
    expect(everyNCuts(4, 1)).toEqual([1, 2, 3])
  })

  it('cuts after every second page', () => {
    expect(everyNCuts(5, 2)).toEqual([2, 4])
  })

  it('never cuts past the last page', () => {
    expect(everyNCuts(4, 2)).toEqual([2])
  })

  it('returns nothing for a nonsensical size', () => {
    expect(everyNCuts(4, 0)).toEqual([])
  })
})

describe('boundaryCuts', () => {
  it('rebuilds the cuts that separate a list of groups', () => {
    // What a half-successful save needs: the groups that failed become the new
    // page list, so their boundaries have to be renumbered from zero.
    expect(boundaryCuts([[1, 2], [3], [4, 5, 6]])).toEqual([2, 3])
  })

  it('has no boundary for a single group', () => {
    expect(boundaryCuts([[1, 2]])).toEqual([])
  })

  it('has no boundary for no groups at all', () => {
    expect(boundaryCuts([])).toEqual([])
  })
})

describe('splitTitles', () => {
  it('numbers every document from the one name typed', () => {
    expect(splitTitles('Kwitansi', 3)).toEqual(['Kwitansi (1)', 'Kwitansi (2)', 'Kwitansi (3)'])
  })

  it('trims the name before numbering it', () => {
    expect(splitTitles('  Kwitansi  ', 2)).toEqual(['Kwitansi (1)', 'Kwitansi (2)'])
  })

  it('leaves an empty name undefined so storage falls back to "Scan <tanggal>"', () => {
    expect(splitTitles('   ', 2)).toEqual([undefined, undefined])
  })

  it('does not number a lone document', () => {
    expect(splitTitles('Kwitansi', 1)).toEqual(['Kwitansi'])
  })

  it('continues the numbering after a partial save', () => {
    expect(splitTitles('Kwitansi', 2, 5)).toEqual(['Kwitansi (6)', 'Kwitansi (7)'])
  })
})

describe('canSplitScan', () => {
  it('lets Pro split into several documents', () => {
    expect(canSplitScan('pro', 6)).toBe(true)
  })

  it('refuses Basic more than one document', () => {
    expect(canSplitScan('basic', 2)).toBe(false)
  })

  it('lets Basic through when it is really just an ordinary save', () => {
    // Splitting into one document is what the Simpan button next door already
    // does for free. Refusing it would be a bug wearing the clothes of a rule.
    expect(canSplitScan('basic', 1)).toBe(true)
  })
})

describe('saveSplitScan', () => {
  const pages = ['uri-1', 'uri-2', 'uri-3']

  it('saves one document per group, in order, with the numbered names', async () => {
    const result = await saveSplitScan([[pages[0], pages[1]], [pages[2]]], 'Kwitansi', 'pro')

    expect(savedCalls).toEqual([
      { uris: ['uri-1', 'uri-2'], title: 'Kwitansi (1)' },
      { uris: ['uri-3'], title: 'Kwitansi (2)' },
    ])
    expect(result.saved).toHaveLength(2)
    expect(result.remaining).toEqual([])
    expect(result.message).toBe('2 dokumen tersimpan.')
  })

  it('leaves the groups that failed on screen and reports them', async () => {
    failTitles.add('Kwitansi (2)')

    const result = await saveSplitScan([[pages[0]], [pages[1]], [pages[2]]], 'Kwitansi', 'pro')

    expect(result.saved).toHaveLength(2)
    // The pages of a scan that failed cannot be recovered from anywhere, so
    // they stay put rather than being thrown away with the screen.
    expect(result.remaining).toEqual([['uri-2']])
    expect(result.message).toBe(
      '2 dokumen tersimpan, 1 gagal. Halamannya masih di sini — coba simpan lagi.',
    )
  })

  it('reports a total failure without claiming anything was saved', async () => {
    failTitles.add('Kwitansi (1)')
    failTitles.add('Kwitansi (2)')

    const result = await saveSplitScan([[pages[0]], [pages[1]]], 'Kwitansi', 'pro')

    expect(result.saved).toEqual([])
    expect(result.remaining).toEqual([['uri-1'], ['uri-2']])
    expect(result.message).toBe(
      'Tidak ada dokumen yang tersimpan. Halamannya masih di sini — coba lagi.',
    )
  })

  it('continues the numbering when a retry follows a partial save', async () => {
    await saveSplitScan([[pages[0]]], 'Kwitansi', 'pro', 5)

    expect(savedCalls[0].title).toBe('Kwitansi (6)')
  })

  it('leaves the title undefined when no name was typed', async () => {
    await saveSplitScan([[pages[0]], [pages[1]]], '  ', 'pro')

    expect(savedCalls.map((call) => call.title)).toEqual([undefined, undefined])
  })

  it('refuses Basic more than one document, before writing anything', async () => {
    await expect(saveSplitScan([[pages[0]], [pages[1]]], 'Kwitansi', 'basic')).rejects.toThrow(
      'akun Pro',
    )
    expect(savedCalls).toEqual([])
  })

  it('lets Basic save a single group — that is an ordinary save', async () => {
    const result = await saveSplitScan([[pages[0], pages[1]]], 'Kwitansi', 'basic')

    expect(result.saved).toHaveLength(1)
    expect(savedCalls).toEqual([{ uris: ['uri-1', 'uri-2'], title: 'Kwitansi' }])
  })

  it('drops empty groups rather than saving a document with no pages', async () => {
    const result = await saveSplitScan([[pages[0]], []], 'Kwitansi', 'basic')

    expect(savedCalls).toHaveLength(1)
    expect(result.saved).toHaveLength(1)
  })

  it('refuses when there is nothing to save at all', async () => {
    await expect(saveSplitScan([], 'Kwitansi', 'pro')).rejects.toThrow('Tidak ada halaman')
  })

  it('reports progress from zero through to done', async () => {
    const seen: string[] = []

    await saveSplitScan([[pages[0]], [pages[1]]], 'Kwitansi', 'pro', 0, (done, total) =>
      seen.push(`${done}/${total}`),
    )

    expect(seen).toEqual(['0/2', '1/2', '2/2'])
  })
})

describe('summarizeSplitSave', () => {
  it('says nothing about failures when there were none', () => {
    expect(summarizeSplitSave(3, 0)).toBe('3 dokumen tersimpan.')
  })

  it('names both halves of a partial run', () => {
    expect(summarizeSplitSave(1, 2)).toBe(
      '1 dokumen tersimpan, 2 gagal. Halamannya masih di sini — coba simpan lagi.',
    )
  })
})

describe('splitTitles and the shared title rules', () => {
  it('collapses runs of whitespace, like rename and confirm-upload do', () => {
    // The split field is the first place a typed title reaches local storage.
    // If it skipped the shared normaliser, a document would read one way on the
    // phone and another in the cloud the moment it was backed up.
    expect(splitTitles('Kwitansi   Agustus', 2)).toEqual([
      'Kwitansi Agustus (1)',
      'Kwitansi Agustus (2)',
    ])
  })

  it('caps a very long name with room left for the numbering', () => {
    const [first] = splitTitles('K'.repeat(400), 3)

    expect(first?.endsWith(' (1)')).toBe(true)
    expect([...(first ?? '')].length).toBeLessThanOrEqual(200)
  })
})
