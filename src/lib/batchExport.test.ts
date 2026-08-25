import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompressOptions } from './exportLimits'
import type { LocalScanDocument, ScanPage } from './scanIndexMigration'
import type { BatchProgress } from './documentExport'

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
    schemaVersion: 5,
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

describe('exportDocumentsBatch', () => {
  it('writes one PDF per document, named after its title', async () => {
    const result = await exportDocumentsBatch(
      [doc('a', 'Kwitansi Agustus'), doc('b', 'Kontrak Sewa')],
      'pro',
    )

    expect(written).toEqual(['Kwitansi Agustus.pdf', 'Kontrak Sewa.pdf'])
    expect(result.saved).toEqual(['Kwitansi Agustus.pdf', 'Kontrak Sewa.pdf'])
    expect(result.failed).toEqual([])
  })

  /**
   * The Pro gate here was lifted by Boss Ali on 25 Agustus 2026. Kept as a test
   * rather than deleted: this is the tier that used to be refused outright, so
   * a regression to that would otherwise be silent.
   */
  it('exports for Basic too', async () => {
    const result = await exportDocumentsBatch([doc('a', 'Nota')], 'basic')

    expect(written).toEqual(['Nota.pdf'])
    expect(result.saved).toEqual(['Nota.pdf'])
  })

  it('refuses an empty selection', async () => {
    await expect(exportDocumentsBatch([], 'pro')).rejects.toThrow(
      'Tidak ada dokumen untuk diekspor.',
    )
  })

  /** Two documents can share a title; the second must not overwrite the first. */
  it('numbers a repeated title instead of overwriting it', async () => {
    const result = await exportDocumentsBatch([doc('a', 'Nota'), doc('b', 'Nota')], 'pro')

    expect(result.saved).toEqual(['Nota.pdf', 'Nota (2).pdf'])
  })

  it('opens one share sheet at the end, not one per document', async () => {
    await exportDocumentsBatch([doc('a', 'A'), doc('b', 'B')], 'pro')

    expect(shared).toHaveLength(1)
    expect(shared[0].uris).toEqual(['file:///Documents/A.pdf', 'file:///Documents/B.pdf'])
  })

  /** One unreadable document must not keep the rest off the phone. */
  it('carries on past a failure and reports it', async () => {
    failWrites.add('B.pdf')

    const result = await exportDocumentsBatch(
      [doc('a', 'A'), doc('b', 'B'), doc('c', 'C')],
      'pro',
    )

    expect(result.saved).toEqual(['A.pdf', 'C.pdf'])
    expect(result.failed).toEqual([{ title: 'B', message: 'Penyimpanan penuh.' }])
    expect(result.message).toBe('2 dokumen diekspor, 1 gagal. Coba lagi untuk sisanya.')
  })

  it('shares only the documents that made it', async () => {
    failWrites.add('B.pdf')

    await exportDocumentsBatch([doc('a', 'A'), doc('b', 'B')], 'pro')

    expect(shared[0].uris).toEqual(['file:///Documents/A.pdf'])
  })

  it('skips the share sheet entirely when nothing was written', async () => {
    failWrites.add('A.pdf')

    await exportDocumentsBatch([doc('a', 'A')], 'pro')

    expect(shared).toHaveLength(0)
  })

  it('reports progress before each document, not after', async () => {
    const seen: BatchProgress[] = []

    await exportDocumentsBatch([doc('a', 'A'), doc('b', 'B')], 'pro', 'standard', (progress) =>
      seen.push(progress),
    )

    expect(seen).toEqual([
      { index: 0, total: 2, title: 'A' },
      { index: 1, total: 2, title: 'B' },
    ])
  })

  /**
   * Stopping is checked between documents, never inside one: aborting midway
   * through a PDF would leave half a file in the Documents folder.
   */
  it('stops between documents once aborted, finishing the one in flight', async () => {
    const controller = new AbortController()

    const result = await exportDocumentsBatch(
      [doc('a', 'A'), doc('b', 'B'), doc('c', 'C')],
      'pro',
      'standard',
      (progress) => {
        if (progress.index === 0) controller.abort()
      },
      controller.signal,
    )

    expect(result.saved).toEqual(['A.pdf'])
    expect(result.cancelled).toBe(true)
    expect(result.message).toBe('Dihentikan — 1 dari 3 dokumen tersimpan.')
  })

  it('still shares what it managed to write before stopping', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await exportDocumentsBatch(
      [doc('a', 'A')],
      'pro',
      'standard',
      undefined,
      controller.signal,
    )

    expect(result.saved).toEqual([])
    expect(result.cancelled).toBe(true)
    expect(shared).toHaveLength(0)
  })
})
