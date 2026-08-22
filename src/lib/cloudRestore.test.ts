import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { buildPdf } from './pdfExport'

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
  Capacitor: { isNativePlatform: () => true, convertFileSrc: (p: string) => p },
}))

/**
 * The real blobToBase64 needs FileReader, which Node has no business
 * providing — but stubbing it with a constant would hide whether the right
 * bytes reach the disk, which is the whole point of these tests. Buffer does
 * the same job faithfully.
 */
vi.mock('./blobBase64', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./blobBase64')>()),
  blobToBase64: async (blob: Blob) => Buffer.from(await blob.arrayBuffer()).toString('base64'),
}))

const downloadBackupBytes = vi.fn()
vi.mock('./backupApi', () => ({ downloadBackupBytes }))

const { restoreBackup } = await import('./cloudRestore')

const ONE_PIXEL_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA' +
  'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
  'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
  'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
  'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA' +
  'AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx' +
  'BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK' +
  'U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3' +
  'uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii' +
  'gD//2Q=='

/** Same trick as pdfImport.test.ts: a comment segment makes each page unique. */
function jpegPage(tag: string): Uint8Array {
  const base = new Uint8Array(Buffer.from(ONE_PIXEL_JPEG_BASE64, 'base64'))
  const text = new TextEncoder().encode(tag)
  const segmentLength = text.length + 2

  const out = new Uint8Array(base.length + text.length + 4)
  out.set(base.subarray(0, 2), 0)
  out.set([0xff, 0xfe, segmentLength >> 8, segmentLength & 0xff], 2)
  out.set(text, 6)
  out.set(base.subarray(2), 6 + text.length)
  return out
}

const backup = {
  id: '96903960-6bf5-4af9-9b08-5fade4699a91',
  title: 'Dok agent',
  pageCount: 2,
  sizeBytes: 340191,
  createdAt: '2026-08-22T18:46:10.365Z',
  updatedAt: '2026-08-22T18:46:10.219Z',
}

/**
 * Replaces the PDF's creation date with something unparseable.
 *
 * Standing in for a file whose date we cannot use — deleting the entry would
 * not do, because pdf-lib puts a fresh one back on every save.
 */
async function withUnreadableCreationDate(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes)
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info, PDFDict)
  info.set(PDFName.of('CreationDate'), PDFString.of('bukan tanggal'))
  return pdf.save()
}

/** What actually landed on disk for a given page, as raw bytes. */
function pageWrittenAt(path: string): Uint8Array {
  const call = fs.writeFile.mock.calls.find((c) => c[0].path === path)
  return new Uint8Array(Buffer.from(call![0].data, 'base64'))
}

beforeEach(() => {
  for (const fn of Object.values(fs)) fn.mockClear()
  fs.readFile.mockResolvedValue({ data: '[]' })
  downloadBackupBytes.mockReset()
})

describe('restoreBackup', () => {
  it('rebuilds the document on the phone, page for page', async () => {
    const pages = [jpegPage('halaman-satu'), jpegPage('halaman-dua')]
    downloadBackupBytes.mockResolvedValue(await buildPdf(pages, { watermark: false }))

    const doc = await restoreBackup(backup)

    expect(doc.pageCount).toBe(2)
    expect(pageWrittenAt(`scans/${backup.id}/page-1.jpg`)).toEqual(pages[0])
    expect(pageWrittenAt(`scans/${backup.id}/page-2.jpg`)).toEqual(pages[1])
  })

  it('restores it under the identity the cloud already knows', async () => {
    downloadBackupBytes.mockResolvedValue(
      await buildPdf([jpegPage('x')], { watermark: false }),
    )

    const doc = await restoreBackup(backup)

    expect(doc.id).toBe(backup.id)
    expect(doc.title).toBe('Dok agent')
  })

  /**
   * `backup.createdAt` is when the row was written — when the document was
   * first backed up. The scan date lives in the file, and it is the one the
   * document list is sorted by, so a scan from March must not come back dated
   * the day it happened to be uploaded.
   */
  it('dates the restored document from the scan, not from the backup', async () => {
    const scannedAt = '2026-03-04T09:15:00.000Z'
    downloadBackupBytes.mockResolvedValue(
      await buildPdf([jpegPage('lama')], { watermark: false, scannedAt }),
    )

    const doc = await restoreBackup(backup)

    expect(doc.createdAt).toBe(scannedAt)
  })

  /** An unreadable date leaves the row as the only thing to go on. */
  it('falls back to the backup date when the file has no usable date', async () => {
    downloadBackupBytes.mockResolvedValue(
      await withUnreadableCreationDate(await buildPdf([jpegPage('x')], { watermark: false })),
    )

    const doc = await restoreBackup(backup)

    expect(doc.createdAt).toBe(backup.createdAt)
  })

  /** A Basic user's backup is watermarked; what comes back must not be. */
  it('gives a Basic user back a clean scan', async () => {
    const original = jpegPage('tier-basic')
    downloadBackupBytes.mockResolvedValue(await buildPdf([original], { watermark: true }))

    await restoreBackup(backup)

    expect(pageWrittenAt(`scans/${backup.id}/page-1.jpg`)).toEqual(original)
  })

  it('writes nothing when the download fails', async () => {
    downloadBackupBytes.mockRejectedValue(new Error('Gagal mengunduh cadangan.'))

    await expect(restoreBackup(backup)).rejects.toThrow('Gagal mengunduh cadangan.')
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('writes nothing when the downloaded file is not a readable backup', async () => {
    downloadBackupBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))

    await expect(restoreBackup(backup)).rejects.toThrow('Berkas cadangan rusak atau tidak lengkap.')
    expect(fs.writeFile).not.toHaveBeenCalled()
  })
})
