import { beforeEach, describe, expect, it, vi } from 'vitest'

const fs = {
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => ({ data: '[]' })),
  rmdir: vi.fn(async () => {}),
  getUri: vi.fn(async () => ({ uri: 'file:///data/x' })),
}

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: fs,
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    convertFileSrc: (path: string) =>
      path.startsWith('file://')
        ? `https://localhost${path.replace('file://', '/_capacitor_file_')}`
        : path,
  },
}))

vi.mock('./blobBase64', () => ({
  blobToBase64: async () => 'BASE64',
  base64ToBlob: () => new Blob(),
}))

const { saveScanDocument, renameScanDocument } = await import('./scanStorage')

/** Menaruh satu dokumen di index yang dibaca readIndex(). */
function seedIndex(title: string) {
  fs.readFile.mockResolvedValue({
    data: JSON.stringify([
      {
        schemaVersion: 2,
        id: 'doc-1',
        title,
        createdAt: '2026-08-23T00:00:00.000Z',
        pageCount: 1,
        pages: [{ original: 'scans/doc-1/page-1.jpg' }],
      },
    ]),
  })
}

/** Index yang ditulis kembali ke disk pada pemanggilan terakhir. */
function writtenIndex() {
  const call = fs.writeFile.mock.calls.find((c) => c[0].path === 'scans/index.json')
  return JSON.parse(call![0].data)
}

/** Direktori dokumen yang dibuat pada pemanggilan terakhir. */
function createdDocDir(): string {
  return fs.mkdir.mock.calls.at(-1)![0].path
}

beforeEach(() => {
  for (const fn of Object.values(fs)) fn.mockClear()
  fs.readFile.mockResolvedValue({ data: '[]' })
})

describe('saveScanDocument', () => {
  it('writes one file per page and indexes the document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob() })),
    )

    const doc = await saveScanDocument([
      'https://localhost/_capacitor_file_/cache/a.jpg',
      'https://localhost/_capacitor_file_/cache/b.jpg',
    ])

    expect(doc.pageCount).toBe(2)
    // 2 halaman + 1 tulis index.json
    expect(fs.writeFile).toHaveBeenCalledTimes(3)
    expect(fs.rmdir).not.toHaveBeenCalled()
  })

  /**
   * Index ditulis paling akhir, jadi kegagalan di tengah loop meninggalkan
   * direktori tanpa entri apa pun yang menunjuk ke sana — dan
   * deleteScanDocument hanya bekerja lewat index, sehingga byte-nya tidak akan
   * pernah bisa diklaim kembali.
   */
  it('removes the half-written directory when a page cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, blob: async () => new Blob() })),
    )

    await expect(saveScanDocument(['https://localhost/_capacitor_file_/cache/a.jpg'])).rejects.toThrow()

    expect(fs.rmdir).toHaveBeenCalledWith(
      expect.objectContaining({ path: createdDocDir(), recursive: true }),
    )
    // Tidak boleh ada dokumen setengah jadi yang masuk index.
    expect(fs.writeFile).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'scans/index.json' }),
    )
  })

  it('cleans up when fetch rejects outright, not just on a bad status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    await expect(saveScanDocument(['file:///cache/a.jpg'])).rejects.toThrow('Failed to fetch')

    expect(fs.rmdir).toHaveBeenCalledWith(
      expect.objectContaining({ path: createdDocDir(), recursive: true }),
    )
  })

  it('still surfaces the original failure if cleanup itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, blob: async () => new Blob() })),
    )
    fs.rmdir.mockRejectedValueOnce(new Error('rmdir gagal'))

    await expect(saveScanDocument(['https://localhost/_capacitor_file_/cache/a.jpg'])).rejects.toThrow(
      /HTTP 500/,
    )
  })
})

describe('renameScanDocument', () => {
  it('stores the new name in the index', async () => {
    seedIndex('Scan 22/8/2026')

    const doc = await renameScanDocument('doc-1', 'KTP Ali')

    expect(doc.title).toBe('KTP Ali')
    expect(writtenIndex()[0].title).toBe('KTP Ali')
  })

  /**
   * Judul ikut menyusun nama berkas ekspor, jadi normalisasinya harus sama
   * persis dengan yang dipakai Edge Function — kalau berbeda, mencadangkan
   * dokumen akan menulis ulang judul yang baru saja diubah.
   */
  it('normalises the name the same way the server does', async () => {
    seedIndex('lama')

    const doc = await renameScanDocument('doc-1', '  Surat\n\nJalan   2026  ')

    expect(doc.title).toBe('Surat Jalan 2026')
  })

  it('falls back to a default rather than storing an empty name', async () => {
    seedIndex('lama')

    expect((await renameScanDocument('doc-1', '   ')).title).toBe('Dokumen')
  })

  it('never writes anything for a document that does not exist', async () => {
    seedIndex('lama')

    await expect(renameScanDocument('tidak-ada', 'X')).rejects.toThrow('Dokumen tidak ditemukan.')
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('leaves the pages untouched', async () => {
    seedIndex('lama')

    await renameScanDocument('doc-1', 'Baru')

    expect(writtenIndex()[0].pages).toEqual([{ original: 'scans/doc-1/page-1.jpg' }])
    expect(writtenIndex()[0].pageCount).toBe(1)
  })
})
