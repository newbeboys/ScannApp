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
      schemaVersion: 6,
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
  everyNCuts,
  planSplit,
  remapCutsAfterRemoval,
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

describe('saveSplitScan', () => {
  const pages = ['uri-1', 'uri-2', 'uri-3']

  it('saves one document per group, in order, with the numbered names', async () => {
    const result = await saveSplitScan([[pages[0], pages[1]], [pages[2]]], 'Kwitansi')

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

    const result = await saveSplitScan([[pages[0]], [pages[1]], [pages[2]]], 'Kwitansi')

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

    const result = await saveSplitScan([[pages[0]], [pages[1]]], 'Kwitansi')

    expect(result.saved).toEqual([])
    expect(result.remaining).toEqual([['uri-1'], ['uri-2']])
    expect(result.message).toBe(
      'Tidak ada dokumen yang tersimpan. Halamannya masih di sini — coba lagi.',
    )
  })

  it('continues the numbering when a retry follows a partial save', async () => {
    await saveSplitScan([[pages[0]]], 'Kwitansi', 5)

    expect(savedCalls[0].title).toBe('Kwitansi (6)')
  })

  it('leaves the title undefined when no name was typed', async () => {
    await saveSplitScan([[pages[0]], [pages[1]]], '  ')

    expect(savedCalls.map((call) => call.title)).toEqual([undefined, undefined])
  })

  /**
   * The Pro gate here was lifted by Boss Ali on 25 Agustus 2026. Kept as a test
   * rather than deleted: splitting into several documents is exactly what used
   * to be refused for this tier.
   */
  it('splits into several documents for Basic too', async () => {
    const result = await saveSplitScan([[pages[0]], [pages[1]]], 'Kwitansi')

    expect(result.saved).toHaveLength(2)
    expect(savedCalls).toEqual([
      { uris: ['uri-1'], title: 'Kwitansi (1)' },
      { uris: ['uri-2'], title: 'Kwitansi (2)' },
    ])
  })

  it('drops empty groups rather than saving a document with no pages', async () => {
    const result = await saveSplitScan([[pages[0]], []], 'Kwitansi')

    expect(savedCalls).toHaveLength(1)
    expect(result.saved).toHaveLength(1)
  })

  it('refuses when there is nothing to save at all', async () => {
    await expect(saveSplitScan([], 'Kwitansi')).rejects.toThrow('Tidak ada halaman')
  })

  it('reports progress from zero through to done', async () => {
    const seen: string[] = []

    await saveSplitScan([[pages[0]], [pages[1]]], 'Kwitansi', 0, (done, total) =>
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

/**
 * Temuan code-review 25 Agustus 2026. Keluar dari layar Pisah sengaja
 * *menyimpan* cut-nya (supaya percobaan ulang setelah simpan yang setengah
 * berhasil tidak kehilangan penempatan), tapi layar Tinjau di baliknya masih
 * bisa menghapus halaman. Masuk lagi ke layar Pisah lalu memakai cut lama
 * terhadap daftar yang sudah menyusut membuat pemisahnya diam-diam bergeser
 * ke batas halaman yang berbeda dari yang ditempatkan user.
 */
describe('remapCutsAfterRemoval', () => {
  it('membiarkan cut yang ada sebelum halaman yang dihapus', () => {
    expect(remapCutsAfterRemoval([2], 4, 5)).toEqual([2])
  })

  it('menggeser turun cut yang ada sesudah halaman yang dihapus', () => {
    expect(remapCutsAfterRemoval([4], 1, 5)).toEqual([3])
  })

  /**
   * Cut tepat sebelum dan tepat sesudah halaman yang dihapus menunjuk ke batas
   * yang sama begitu halaman di antaranya hilang. Dua pemisah di satu batas
   * akan melahirkan dokumen tanpa halaman.
   */
  it('melebur dua cut yang mengapit halaman yang dihapus jadi satu', () => {
    expect(remapCutsAfterRemoval([2, 3], 2, 4)).toEqual([2])
  })

  it('membuang cut yang jatuh ke ujung daftar', () => {
    expect(remapCutsAfterRemoval([4], 4, 4)).toEqual([])
  })

  it('membuang cut yang jatuh ke nol, yang akan membuat dokumen kosong di depan', () => {
    expect(remapCutsAfterRemoval([1], 0, 3)).toEqual([])
  })

  it('mengembalikan hasilnya terurut', () => {
    expect(remapCutsAfterRemoval([5, 1, 3], 2, 5)).toEqual([1, 2, 4])
  })

  it('tidak mengarang cut untuk daftar yang belum punya', () => {
    expect(remapCutsAfterRemoval([], 1, 3)).toEqual([])
  })

  /** Yang sebenarnya harus tetap benar: planSplit memakainya tanpa mengeluh. */
  it('menghasilkan kelompok yang tidak pernah kosong', () => {
    const cuts = remapCutsAfterRemoval([1, 2, 3], 1, 3)

    for (const group of planSplit(3, cuts)) {
      expect(group.length).toBeGreaterThan(0)
    }
  })
})
