import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompressOptions } from './exportLimits'
import type { LocalScanDocument, ScanPage } from './scanIndexMigration'

vi.mock('./imageEditor', () => ({
  compressImage: async (blob: Blob, _options: CompressOptions) =>
    new Blob([`encoded:${await blob.text()}`]),
}))

vi.mock('./documentEditing', () => ({
  loadPageBlob: async (page: ScanPage) => new Blob([page.original]),
}))

vi.mock('./pdfExport', () => ({
  buildPdf: async () => new Uint8Array([1, 2, 3]),
}))

vi.mock('./blobBase64', () => ({
  blobToBytes: async () => new Uint8Array([1]),
}))

/** Titles whose write should blow up, so failure paths can be exercised. */
const failWrites = new Set<string>()
const written: string[] = []
const shared: { uris: string[]; title: string }[] = []

vi.mock('./exportShare', () => ({
  writeExportFiles: async (files: { name: string; blob: Blob }[]) => {
    for (const file of files) {
      if (failWrites.has(file.name)) throw new Error('Penyimpanan penuh.')
      written.push(file.name)
    }
    return files.map((file) => `file:///Documents/${file.name}`)
  },
  shareFiles: async (uris: string[], title: string) => {
    // Mirrors the real function, which returns early on an empty list.
    if (uris.length === 0) return
    shared.push({ uris, title })
  },
  deliverExport: async () => ({ message: 'tidak dipakai di test ini' }),
}))

const { exportDocumentsBatch, summarizeBatchExport } = await import('./documentExport')

function doc(id: string, title: string, pageCount = 1): LocalScanDocument {
  return {
    schemaVersion: 4,
    id,
    title,
    createdAt: '2026-08-25T00:00:00.000Z',
    pageCount,
    pages: Array.from({ length: pageCount }, (_, i) => ({ original: `${id}/page-${i + 1}.jpg` })),
  }
}

beforeEach(() => {
  failWrites.clear()
  written.length = 0
  shared.length = 0
})

describe('summarizeBatchExport', () => {
  it('names the folder when everything worked', () => {
    const message = summarizeBatchExport({
      total: 3,
      saved: ['A.pdf', 'B.pdf', 'C.pdf'],
      failed: [],
      cancelled: false,
    })

    expect(message).toBe('3 dokumen diekspor ke folder Documents.')
  })

  it('counts both sides when some failed', () => {
    const message = summarizeBatchExport({
      total: 5,
      saved: ['A.pdf', 'B.pdf', 'C.pdf', 'D.pdf'],
      failed: [{ title: 'E', message: 'Penyimpanan penuh.' }],
      cancelled: false,
    })

    expect(message).toBe('4 dokumen diekspor, 1 gagal. Coba lagi untuk sisanya.')
  })

  it('says plainly when nothing landed', () => {
    const message = summarizeBatchExport({
      total: 2,
      saved: [],
      failed: [
        { title: 'A', message: 'x' },
        { title: 'B', message: 'y' },
      ],
      cancelled: false,
    })

    expect(message).toBe(
      'Tidak ada dokumen yang berhasil diekspor. Periksa ruang penyimpanan lalu coba lagi.',
    )
  })

  /** The stop button promises exactly this: finish the current one, then halt. */
  it('reports how far a stopped run got', () => {
    const message = summarizeBatchExport({
      total: 5,
      saved: ['A.pdf', 'B.pdf'],
      failed: [],
      cancelled: true,
    })

    expect(message).toBe('Dihentikan — 2 dari 5 dokumen tersimpan.')
  })

  it('handles a stop before anything was written', () => {
    const message = summarizeBatchExport({ total: 5, saved: [], failed: [], cancelled: true })

    expect(message).toBe('Dihentikan sebelum ada dokumen yang tersimpan.')
  })
})
