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

const { saveScanDocument } = await import('./scanStorage')

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
