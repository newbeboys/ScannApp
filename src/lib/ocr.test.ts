import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Smallest JPEG whose SOF0 header reports a real size (600x400, no scan data). */
const JPEG_600x400 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x02, 0x58, 0x03, 0x01, 0x11, 0x00, 0x02,
  0x11, 0x01, 0x03, 0x11, 0x01,
])

const processImage = vi.fn(async () => ({
  text: 'Kwitansi',
  blocks: [
    {
      text: 'Kwitansi',
      lines: [
        {
          text: 'Kwitansi',
          elements: [{ text: 'Kwitansi', boundingBox: { left: 60, top: 40, right: 360, bottom: 80 } }],
        },
      ],
    },
  ],
}))

vi.mock('@capacitor-mlkit/text-recognition', () => ({
  TextRecognition: { processImage },
  Script: { Latin: 'LATIN' },
}))

const getUri = vi.fn(async ({ path }: { path: string }) => ({ uri: `file:///data/${path}` }))

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { getUri },
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
}))

/** The document the storage layer hands back, rebuilt as pages are recognised. */
let doc: {
  id: string
  pages: { original: string; filtered?: string; annotated?: string; text?: string }[]
}

const savePageText = vi.fn(async (_docId: string, index: number) => {
  doc.pages[index] = { ...doc.pages[index], text: `${doc.pages[index].original}-ocr` }
  return doc
})

const readPageBlob = vi.fn(async () => new Blob([JPEG_600x400]))

vi.mock('./scanStorage', async () => {
  const migration = await import('./scanIndexMigration')
  return {
    annotationSource: migration.annotationSource,
    getScanDocument: async () => doc,
    readPageBlob: (path: string) => readPageBlob(path),
    savePageText: (id: string, index: number, text: unknown) => savePageText(id, index, text),
  }
})

const { recognizeDocument } = await import('./ocr')

beforeEach(() => {
  processImage.mockClear()
  getUri.mockClear()
  savePageText.mockClear()
  readPageBlob.mockClear()
  processImage.mockResolvedValue({
    text: 'Kwitansi',
    blocks: [
      {
        text: 'Kwitansi',
        lines: [
          {
            text: 'Kwitansi',
            elements: [
              { text: 'Kwitansi', boundingBox: { left: 60, top: 40, right: 360, bottom: 80 } },
            ],
          },
        ],
      },
    ],
  })
  doc = { id: 'doc-1', pages: [{ original: 'a.jpg' }, { original: 'b.jpg' }] }
})

describe('recognizeDocument', () => {
  /**
   * The gate lives here rather than in the screen, the way `setPageMarks` and
   * `resolveCompressionLevel` once did. A hidden button is a suggestion; this
   * is the rule. Unlike those two, this one is meant to stay: OCR is the
   * engine Pro sells, not access to the user's own document.
   */
  it('refuses a Basic caller without running the engine once', async () => {
    await expect(recognizeDocument('doc-1', 'basic')).rejects.toThrow(/Pro/)

    expect(processImage).not.toHaveBeenCalled()
  })

  it('recognises every page and stores a layout for each', async () => {
    const result = await recognizeDocument('doc-1', 'pro')

    expect(result.recognized).toBe(2)
    expect(processImage).toHaveBeenCalledTimes(2)
    expect(savePageText).toHaveBeenCalledTimes(2)
  })

  it('normalises the boxes against the page it actually read', async () => {
    await recognizeDocument('doc-1', 'pro')

    // 60/600 and 40/400 for a 600x400 page.
    expect(savePageText.mock.calls[0][2]).toEqual({
      blocks: [
        {
          text: 'Kwitansi',
          lines: [{ text: 'Kwitansi', words: [{ text: 'Kwitansi', x: 0.1, y: 0.1, w: 0.5, h: 0.1 }] }],
        },
      ],
    })
  })

  /**
   * Ink on top of the words is noise to a recogniser, but a filter is not —
   * Hitam-Putih exists to make text crisper. So the source is the page without
   * its ink, which is exactly what `annotationSource` already means.
   */
  it('reads the page without its ink, but with its filter', async () => {
    doc.pages = [{ original: 'a.jpg', filtered: 'a-bw.jpg', annotated: 'a-ink.jpg' }]

    await recognizeDocument('doc-1', 'pro')

    expect(readPageBlob).toHaveBeenCalledWith('a-bw.jpg')
    expect(processImage).toHaveBeenCalledWith({ path: 'file:///data/a-bw.jpg', script: 'LATIN' })
  })

  /**
   * OCR on a long document is minutes of work. Leaving and coming back must
   * pick up where it stopped, and re-cropping one page must cost that page
   * only.
   */
  it('skips pages that already carry text', async () => {
    doc.pages = [{ original: 'a.jpg', text: 'a-ocr.json' }, { original: 'b.jpg' }]

    const result = await recognizeDocument('doc-1', 'pro')

    expect(processImage).toHaveBeenCalledTimes(1)
    expect(result.recognized).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('re-reads every page when asked to start over', async () => {
    doc.pages = [{ original: 'a.jpg', text: 'a-ocr.json' }, { original: 'b.jpg' }]

    const result = await recognizeDocument('doc-1', 'pro', { force: true })

    expect(processImage).toHaveBeenCalledTimes(2)
    expect(result.recognized).toBe(2)
  })

  it('reports progress as each page lands', async () => {
    const seen: { done: number; total: number }[] = []

    await recognizeDocument('doc-1', 'pro', { onProgress: (p) => seen.push({ ...p }) })

    expect(seen).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })

  /**
   * One unreadable page must not cost the other nineteen. The count comes back
   * so the screen can say so honestly instead of claiming a clean run.
   */
  it('keeps going when one page fails, and says how many did', async () => {
    processImage.mockRejectedValueOnce(new Error('ML Kit meledak'))

    const result = await recognizeDocument('doc-1', 'pro')

    expect(result.recognized).toBe(1)
    expect(result.failed).toBe(1)
    expect(savePageText).toHaveBeenCalledTimes(1)
  })

  it('counts a page whose size cannot be read as failed rather than storing nothing', async () => {
    readPageBlob.mockResolvedValueOnce(new Blob([new Uint8Array([1, 2, 3])]))

    const result = await recognizeDocument('doc-1', 'pro')

    expect(result.failed).toBe(1)
    expect(result.recognized).toBe(1)
  })
})
