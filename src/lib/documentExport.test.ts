import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPRESSION_PRESETS, type CompressOptions } from './exportLimits'
import type { LocalScanDocument, ScanPage } from './scanIndexMigration'

/** What the encoder was asked to do, in order — the point of every assertion below. */
const encodes: { source: string; options: CompressOptions }[] = []

vi.mock('./imageEditor', () => ({
  compressImage: async (blob: Blob, options: CompressOptions) => {
    encodes.push({ source: await blob.text(), options })
    return new Blob([`encoded:${await blob.text()}`])
  },
}))

vi.mock('./documentEditing', () => ({
  loadPageBlob: async (page: ScanPage) =>
    new Blob([page.filtered ?? page.edited ?? page.original]),
}))

const delivered: { name: string }[][] = []

vi.mock('./exportShare', () => ({
  deliverExport: async (files: { name: string; blob: Blob }[]) => {
    delivered.push(files.map((file) => ({ name: file.name })))
    return { message: `${files.length} file` }
  },
  toSafeFilename: (title: string) => title,
}))

vi.mock('./pdfExport', () => ({
  buildPdf: async () => new Uint8Array([1, 2, 3]),
}))

vi.mock('./blobBase64', () => ({
  blobToBytes: async (blob: Blob) => new Uint8Array([(await blob.text()).length]),
}))

const { buildPdfFile, exportDocument } = await import('./documentExport')

function doc(pageCount: number, title = 'Nota'): LocalScanDocument {
  return {
    schemaVersion: 3,
    id: 'doc-1',
    title,
    createdAt: '2026-03-04T00:00:00.000Z',
    pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => ({ original: `page-${index + 1}.jpg` })),
  }
}

beforeEach(() => {
  encodes.length = 0
  delivered.length = 0
})

/**
 * Boss Ali, 23 Agustus 2026: PNG is available to Basic as well as Pro,
 * replacing the PRD Bagian 3 line that listed it as Pro-only. The manual
 * quality control stays Pro.
 */
describe('PNG export', () => {
  it('is available to Basic, not only Pro', async () => {
    await exportDocument(doc(1), 'png', 'basic')

    expect(delivered[0]).toEqual([{ name: 'Nota.png' }])
  })

  /**
   * The trap this locks out: encoding PNG from the JPEG intermediate yields a
   * lossless copy of already-lossy pixels — a much bigger file that is no
   * better to look at.
   */
  it('asks the encoder for PNG, never JPEG', async () => {
    await exportDocument(doc(1), 'png', 'basic')

    expect(encodes[0].options.mimeType).toBe('image/png')
  })

  it('numbers the files only when there is more than one page', async () => {
    await exportDocument(doc(1), 'png', 'basic')
    await exportDocument(doc(3), 'png', 'basic')

    expect(delivered[0]).toEqual([{ name: 'Nota.png' }])
    expect(delivered[1]).toEqual([
      { name: 'Nota-1.png' },
      { name: 'Nota-2.png' },
      { name: 'Nota-3.png' },
    ])
  })

  it('still encodes JPG as JPEG', async () => {
    await exportDocument(doc(1), 'jpg', 'basic')

    expect(encodes[0].options.mimeType).toBe('image/jpeg')
    expect(delivered[0]).toEqual([{ name: 'Nota.jpg' }])
  })
})

describe('compression level', () => {
  it('reaches the encoder for a Pro export', async () => {
    await exportDocument(doc(1), 'jpg', 'pro', 'max')

    expect(encodes[0].options.quality).toBe(COMPRESSION_PRESETS.max.quality)
    expect(encodes[0].options.maxEdgePx).toBe(COMPRESSION_PRESETS.max.maxEdgePx)
  })

  it('is forced back to standard for Basic, whatever was asked for', async () => {
    await exportDocument(doc(1), 'jpg', 'basic', 'max')

    expect(encodes[0].options.quality).toBe(COMPRESSION_PRESETS.standard.quality)
    expect(encodes[0].options.maxEdgePx).toBe(COMPRESSION_PRESETS.standard.maxEdgePx)
  })

  it('defaults to standard when the caller names no level', async () => {
    await exportDocument(doc(1), 'jpg', 'pro')

    expect(encodes[0].options.quality).toBe(COMPRESSION_PRESETS.standard.quality)
  })

  it('applies to every page, not just the first', async () => {
    await exportDocument(doc(3), 'jpg', 'pro', 'small')

    expect(encodes.map((entry) => entry.options.quality)).toEqual([
      COMPRESSION_PRESETS.small.quality,
      COMPRESSION_PRESETS.small.quality,
      COMPRESSION_PRESETS.small.quality,
    ])
  })
})

/**
 * `buildPdfFile` is what the cloud backup uploads, and `cloudRestore` reads the
 * pages back out of it. Boss Ali's decision on 23 Agustus 2026: an export
 * choice must never change backup fidelity or how fast the R2 quota is spent.
 */
describe('cloud backup PDF', () => {
  it('is encoded at standard quality even for a Pro account', async () => {
    await buildPdfFile(doc(1), 'pro')

    expect(encodes[0].options.quality).toBe(COMPRESSION_PRESETS.standard.quality)
    expect(encodes[0].options.maxEdgePx).toBe(COMPRESSION_PRESETS.standard.maxEdgePx)
  })

  it('is a JPEG-bearing PDF, never a PNG one', async () => {
    await buildPdfFile(doc(1), 'pro')

    expect(encodes[0].options.mimeType).toBe('image/jpeg')
  })
})
