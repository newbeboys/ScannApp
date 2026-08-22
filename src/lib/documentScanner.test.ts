import { beforeEach, describe, expect, it, vi } from 'vitest'

const scanDocumentMock = vi.fn()

vi.mock('@capacitor-mlkit/document-scanner', () => ({
  DocumentScanner: {
    scanDocument: (...args: unknown[]) => scanDocumentMock(...args),
  },
}))

/**
 * Meniru perilaku asli Capacitor.convertFileSrc di Android (lihat
 * native-bridge.js): file:// dan content:// dipetakan ke origin webview,
 * selain itu dikembalikan apa adanya.
 */
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    convertFileSrc: (path: string) => {
      if (path.startsWith('file://')) {
        return `https://localhost${path.replace('file://', '/_capacitor_file_')}`
      }
      if (path.startsWith('content://')) {
        return `https://localhost${path.replace('content:/', '/_capacitor_content_')}`
      }
      return path
    },
  },
}))

const { scanDocument } = await import('./documentScanner')

beforeEach(() => {
  scanDocumentMock.mockReset()
})

/**
 * Regresi 22 Agustus 2026: URI mentah diteruskan apa adanya, sehingga gambar
 * hasil pindai tampil sebagai ikon rusak dan menyimpan dokumen gagal dengan
 * "Failed to fetch" — webview berjalan di origin https://localhost dan tidak
 * bisa menyentuh skema file:// sama sekali.
 */
describe('scanDocument', () => {
  it('converts file:// URIs so the webview can actually read them', async () => {
    scanDocumentMock.mockResolvedValue({
      scannedImages: ['file:///data/user/0/com.newbeboys.scannapp/cache/page1.jpg'],
    })

    const result = await scanDocument()

    expect(result).toEqual([
      'https://localhost/_capacitor_file_/data/user/0/com.newbeboys.scannapp/cache/page1.jpg',
    ])
  })

  it('never lets a raw file:// URI reach the caller', async () => {
    scanDocumentMock.mockResolvedValue({
      scannedImages: ['file:///cache/a.jpg', 'file:///cache/b.jpg'],
    })

    const result = await scanDocument()

    expect(Array.isArray(result)).toBe(true)
    for (const uri of result as string[]) {
      expect(uri.startsWith('file://')).toBe(false)
      expect(uri.startsWith('content://')).toBe(false)
    }
  })

  it('converts content:// URIs too, which gallery imports can return', async () => {
    scanDocumentMock.mockResolvedValue({
      scannedImages: ['content://media/external/images/media/42'],
    })

    expect(await scanDocument()).toEqual([
      'https://localhost/_capacitor_content_/media/external/images/media/42',
    ])
  })

  it('converts every page, not just the first', async () => {
    scanDocumentMock.mockResolvedValue({
      scannedImages: ['file:///cache/a.jpg', 'file:///cache/b.jpg', 'file:///cache/c.jpg'],
    })

    expect(await scanDocument()).toEqual([
      'https://localhost/_capacitor_file_/cache/a.jpg',
      'https://localhost/_capacitor_file_/cache/b.jpg',
      'https://localhost/_capacitor_file_/cache/c.jpg',
    ])
  })

  it('reports a cancelled scan rather than an empty page list', async () => {
    scanDocumentMock.mockResolvedValue({ scannedImages: [] })

    expect(await scanDocument()).toEqual({ reason: 'cancelled' })
  })

  it('surfaces a scanner failure as an error outcome', async () => {
    scanDocumentMock.mockRejectedValue(new Error('modul scanner belum terpasang'))

    expect(await scanDocument()).toEqual({
      reason: 'error',
      message: 'modul scanner belum terpasang',
    })
  })
})
