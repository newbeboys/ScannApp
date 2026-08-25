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

const { saveScanDocument, renameScanDocument, restoreDocumentFromJpegs, listScanDocuments } = await import(
  './scanStorage'
)

/** Menaruh satu dokumen di index yang dibaca readIndex(). */
function seedIndex(title: string) {
  fs.readFile.mockResolvedValue({
    data: JSON.stringify([
      {
        schemaVersion: 5,
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
  const call = fs.writeFile.mock.calls.filter((c) => c[0].path === 'scans/index.json').at(-1)
  return JSON.parse(call![0].data)
}

/** Direktori dokumen yang dibuat pada pemanggilan terakhir. */
function createdDocDir(): string {
  return fs.mkdir.mock.calls.at(-1)![0].path
}

beforeEach(() => {
  for (const fn of Object.values(fs)) fn.mockClear()
  fs.readFile.mockResolvedValue({ data: '[]' })
  // mockClear() menyimpan implementasi; dikembalikan supaya satu test yang
  // membuat mkdir gagal tidak menular ke test berikutnya.
  fs.mkdir.mockImplementation(async () => {})
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

describe('restoreDocumentFromJpegs', () => {
  const cloudDoc = {
    id: '96903960-6bf5-4af9-9b08-5fade4699a91',
    title: 'Dok agent',
    createdAt: '2026-08-22T18:46:10.365Z',
  }

  it('writes one file per page and indexes the restored document', async () => {
    const doc = await restoreDocumentFromJpegs(cloudDoc, [new Uint8Array([1]), new Uint8Array([2])])

    expect(doc.pageCount).toBe(2)
    // 2 halaman + 1 tulis index.json
    expect(fs.writeFile).toHaveBeenCalledTimes(3)
    expect(writtenIndex()[0].pages).toEqual([
      { original: `scans/${cloudDoc.id}/page-1.jpg` },
      { original: `scans/${cloudDoc.id}/page-2.jpg` },
    ])
  })

  /**
   * Yang membuat pemulihan tidak merusak apa pun. Kalau dokumen hasil pulihan
   * mendapat id baru, mencadangkannya lagi akan menulis baris kedua di
   * `scan_documents` dan menghitung byte yang sama dua kali terhadap kuota —
   * cadangan lama pun jadi yatim, tidak lagi dikenali sebagai dokumen ini.
   */
  it('keeps the id the cloud copy already has', async () => {
    const doc = await restoreDocumentFromJpegs(cloudDoc, [new Uint8Array([1])])

    expect(doc.id).toBe(cloudDoc.id)
    expect(writtenIndex()[0].id).toBe(cloudDoc.id)
  })

  it('keeps the original scan date rather than dating it today', async () => {
    const doc = await restoreDocumentFromJpegs(cloudDoc, [new Uint8Array([1])])

    expect(doc.createdAt).toBe(cloudDoc.createdAt)
  })

  it('removes the half-written directory when a page cannot be written', async () => {
    fs.writeFile.mockRejectedValueOnce(new Error('disk penuh'))

    await expect(
      restoreDocumentFromJpegs(cloudDoc, [new Uint8Array([1])]),
    ).rejects.toThrow('disk penuh')

    expect(fs.rmdir).toHaveBeenCalledWith(
      expect.objectContaining({ path: `scans/${cloudDoc.id}`, recursive: true }),
    )
    expect(fs.writeFile).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'scans/index.json' }),
    )
  })

  /**
   * Memulihkan dokumen yang salinan lokalnya masih ada akan menimpa berkas
   * halaman yang mungkin sudah diedit di HP. UI tidak pernah menawarkannya,
   * tapi lapisan penyimpanan tidak boleh bergantung pada itu.
   */
  it('refuses to overwrite a document that is still on the phone', async () => {
    fs.readFile.mockResolvedValue({
      data: JSON.stringify([
        {
          schemaVersion: 5,
          id: cloudDoc.id,
          title: 'Dok agent',
          createdAt: cloudDoc.createdAt,
          pageCount: 1,
          pages: [{ original: `scans/${cloudDoc.id}/page-1.jpg` }],
        },
      ]),
    })

    await expect(restoreDocumentFromJpegs(cloudDoc, [new Uint8Array([1])])).rejects.toThrow(
      'Dokumen ini sudah ada di HP.',
    )
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  /**
   * Beda dengan saveScanDocument: id-nya dipakai ulang dari cloud, jadi folder
   * `scans/<id>/` bisa sudah ada — misalnya kalau rmdir saat menghapus dokumen
   * gagal padahal index tetap dibersihkan. Folder yang sudah ada bukan alasan
   * untuk menolak memulihkan.
   */
  it('restores even when the document folder is already there', async () => {
    // Hanya folder dokumennya yang sudah ada; `scans/` sendiri dibuat seperti
    // biasa — kalau keduanya ditolak, ensureScansDir yang menelan errornya dan
    // test ini tidak menguji apa pun.
    fs.mkdir.mockImplementation(async ({ path }: { path: string }) => {
      if (path === `scans/${cloudDoc.id}`) throw new Error('Directory exists')
    })

    const doc = await restoreDocumentFromJpegs(cloudDoc, [new Uint8Array([1])])

    expect(doc.pageCount).toBe(1)
    expect(writtenIndex()[0].id).toBe(cloudDoc.id)
  })

  /**
   * Index dibaca ulang tepat sebelum ditulis, sama seperti saveScanDocument.
   * Kalau memakai salinan yang diambil sebelum unduhan dimulai, dokumen yang
   * dipindai selama "Pulihkan semua" berjalan akan lenyap dari index padahal
   * berkasnya sudah telanjur ada di disk.
   */
  it('keeps a document saved while the download was still running', async () => {
    const scannedMeanwhile = {
      schemaVersion: 5,
      id: 'dipindai-saat-memulihkan',
      title: 'Scan baru',
      createdAt: '2026-08-23T01:00:00.000Z',
      pageCount: 1,
      pages: [{ original: 'scans/dipindai-saat-memulihkan/page-1.jpg' }],
    }

    // Pembacaan pertama (cek duplikat) melihat HP masih kosong; pembacaan
    // kedua — setelah halaman ditulis — sudah memuat dokumen barusan.
    fs.readFile.mockResolvedValueOnce({ data: '[]' })
    fs.readFile.mockResolvedValue({ data: JSON.stringify([scannedMeanwhile]) })

    await restoreDocumentFromJpegs(cloudDoc, [new Uint8Array([1])])

    expect(writtenIndex().map((doc: { id: string }) => doc.id)).toEqual([
      cloudDoc.id,
      scannedMeanwhile.id,
    ])
  })
})

describe('readIndex — menulis ulang index yang masih versi lama', () => {
  beforeEach(() => {
    for (const fn of Object.values(fs)) fn.mockClear()
  })

  /**
   * Baris penentunya di scanStorage membandingkan schemaVersion tersimpan
   * dengan versi sekarang. Kalau angkanya ketinggalan saat skema naik, dokumen
   * lama tetap dimigrasikan di memori tapi tidak pernah tersimpan — jadi
   * migrasinya diulang tiap aplikasi dibuka, dan halaman yang dibuang karena
   * rusak muncul lagi setiap kali.
   */
  it('menulis ulang index v4 ke disk sebagai v5', async () => {
    fs.readFile.mockResolvedValue({
      data: JSON.stringify([
        {
          schemaVersion: 4,
          id: 'doc-lama',
          title: 'Kwitansi',
          createdAt: '2026-03-02T04:00:00.000Z',
          pageCount: 1,
          pages: [{ original: 'scans/doc-lama/page-1.jpg' }],
        },
      ]),
    })

    await listScanDocuments()

    expect(writtenIndex()[0].schemaVersion).toBe(5)
  })

  it('tidak menulis apa pun kalau index sudah versi sekarang', async () => {
    seedIndex('Kwitansi')

    await listScanDocuments()

    expect(fs.writeFile).not.toHaveBeenCalled()
  })
})
