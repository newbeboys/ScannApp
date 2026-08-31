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
/** The destination each delivery was asked for, so the routing can be checked. */
const destinations: string[] = []
/** The blobs handed to delivery, so a test can look inside the file itself. */
const deliveredBlobs: Blob[][] = []
const deliveredBlob = (index: number) => deliveredBlobs[index][0]

vi.mock('./exportShare', () => ({
  deliverExport: async (files: { name: string; blob: Blob }[], destination: string) => {
    delivered.push(files.map((file) => ({ name: file.name })))
    deliveredBlobs.push(files.map((file) => file.blob))
    destinations.push(destination)
    return { message: `${files.length} file`, cancelled: false }
  },
}))

/** Recognised layouts on disk, keyed by the path a page points at. */
const layouts: Record<string, unknown> = {}

/** Every options object the PDF builder was handed, in order. */
const pdfOptions: { text?: unknown[] }[] = []

vi.mock('./pdfExport', () => ({
  // Drained, because the real one is: pages now arrive as a generator that
  // encodes each one only as it is pulled, so a stand-in that ignores them
  // would report that nothing was ever encoded.
  buildPdf: async (
    pages: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
    options: { text?: unknown[] },
  ) => {
    for await (const _page of pages) void _page
    pdfOptions.push(options)
    return new Uint8Array([1, 2, 3])
  },
}))

vi.mock('./scanStorage', () => ({
  readPageText: async (page: { text?: string }) =>
    page.text ? ((layouts[page.text] as never) ?? null) : null,
}))

vi.mock('./blobBase64', () => ({
  blobToBytes: async (blob: Blob) => new Uint8Array([(await blob.text()).length]),
}))

const { buildPdfFile, exportDocument } = await import('./documentExport')

function doc(pageCount: number, title = 'Nota'): LocalScanDocument {
  return {
    schemaVersion: 6,
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
  deliveredBlobs.length = 0
  destinations.length = 0
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
  it('reaches the encoder', async () => {
    await exportDocument(doc(1), 'jpg', 'pro', { level: 'max' })

    expect(encodes[0].options.quality).toBe(COMPRESSION_PRESETS.max.quality)
    expect(encodes[0].options.maxEdgePx).toBe(COMPRESSION_PRESETS.max.maxEdgePx)
  })

  /**
   * The quality control stopped being Pro on 25 Agustus 2026. Kept as a test
   * rather than deleted: this is the tier that used to be pinned to standard
   * no matter what it asked for, so a regression to that would be silent.
   */
  it('reaches the encoder for Basic too', async () => {
    await exportDocument(doc(1), 'jpg', 'basic', { level: 'max' })

    expect(encodes[0].options.quality).toBe(COMPRESSION_PRESETS.max.quality)
    expect(encodes[0].options.maxEdgePx).toBe(COMPRESSION_PRESETS.max.maxEdgePx)
  })

  it('defaults to standard when the caller names no level', async () => {
    await exportDocument(doc(1), 'jpg', 'pro')

    expect(encodes[0].options.quality).toBe(COMPRESSION_PRESETS.standard.quality)
  })

  it('applies to every page, not just the first', async () => {
    await exportDocument(doc(3), 'jpg', 'pro', { level: 'small' })

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

describe('searchable PDF', () => {
  beforeEach(() => {
    for (const key of Object.keys(layouts)) delete layouts[key]
    pdfOptions.length = 0
  })

  function withText(pageCount: number): LocalScanDocument {
    const base = doc(pageCount)
    base.pages = base.pages.map((page) => ({ ...page, text: `${page.original}-ocr.json` }))
    return base
  }

  it('hands every page its recognised text', async () => {
    layouts['page-1.jpg-ocr.json'] = { blocks: [{ text: 'Satu', lines: [] }] }
    layouts['page-2.jpg-ocr.json'] = { blocks: [{ text: 'Dua', lines: [] }] }

    await exportDocument(withText(2), 'pdf', 'pro')

    expect(pdfOptions[0].text).toEqual([
      { blocks: [{ text: 'Satu', lines: [] }] },
      { blocks: [{ text: 'Dua', lines: [] }] },
    ])
  })

  /**
   * The builder matches text to pages by position, so a page without text has
   * to take up its slot. Filtering the gaps out instead would move every later
   * page's words onto the wrong page.
   */
  it('keeps a page without text in place as a gap', async () => {
    const base = withText(2)
    delete base.pages[0].text
    layouts['page-2.jpg-ocr.json'] = { blocks: [{ text: 'Dua', lines: [] }] }

    await exportDocument(base, 'pdf', 'pro')

    expect(pdfOptions[0].text).toEqual([null, { blocks: [{ text: 'Dua', lines: [] }] }])
  })

  /**
   * Unlike the compression level, which is deliberately kept out of backups:
   * an invisible layer costs a few kilobytes, touches no pixel and no quota,
   * and makes the copy that comes back out of R2 searchable wherever it lands.
   */
  it('carries the text layer into the cloud backup too', async () => {
    layouts['page-1.jpg-ocr.json'] = { blocks: [{ text: 'Satu', lines: [] }] }

    await buildPdfFile(withText(1), 'pro')

    expect(pdfOptions[0].text).toEqual([{ blocks: [{ text: 'Satu', lines: [] }] }])
  })

  it('asks for nothing at all when no page was ever recognised', async () => {
    await exportDocument(doc(2), 'pdf', 'pro')

    expect(pdfOptions[0].text).toEqual([null, null])
  })
})

describe('DOCX export', () => {
  beforeEach(() => {
    for (const key of Object.keys(layouts)) delete layouts[key]
  })

  function withText(pageCount: number): LocalScanDocument {
    const base = doc(pageCount)
    base.pages = base.pages.map((page) => ({ ...page, text: `${page.original}-ocr.json` }))
    return base
  }

  const layout = (text: string) => ({
    blocks: [{ text, lines: [{ text, words: [] }] }],
  })

  it('delivers one real Word archive named after the document', async () => {
    layouts['page-1.jpg-ocr.json'] = layout('Kwitansi')

    await exportDocument(withText(1), 'docx', 'pro')

    expect(delivered[0]).toEqual([{ name: 'Nota.docx' }])
    // The name alone proves nothing — the image path would happily produce a
    // JPEG called Nota.docx. These are the bytes of a ZIP local file header.
    const head = new Uint8Array(await deliveredBlob(0).slice(0, 4).arrayBuffer())
    expect(Array.from(head)).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  /**
   * The whole point of a text-only DOCX: it costs no image work at all. If the
   * encoder ran here, exporting a twenty-page scan to Word would re-encode
   * twenty 12 MP JPEGs to produce a file that contains none of them.
   */
  it('never re-encodes a single page image', async () => {
    layouts['page-1.jpg-ocr.json'] = layout('Kwitansi')

    await exportDocument(withText(2), 'docx', 'pro')

    expect(encodes).toEqual([])
  })

  it('carries the recognised text of every page into the file', async () => {
    layouts['page-1.jpg-ocr.json'] = layout('Halaman satu')
    layouts['page-2.jpg-ocr.json'] = layout('Halaman dua')

    await exportDocument(withText(2), 'docx', 'pro')

    // The archive is stored uncompressed, so the words are in it verbatim.
    const body = new TextDecoder().decode(await deliveredBlob(0).arrayBuffer())
    expect(body).toContain('Halaman satu')
    expect(body).toContain('Halaman dua')
  })

  /**
   * The sheet keeps DOCX unselectable until the document has been read, but
   * the rule lives here too: a Word file with nothing in it looks like the
   * export silently failed.
   */
  it('refuses a document that was never recognised', async () => {
    await expect(exportDocument(doc(1), 'docx', 'pro')).rejects.toThrow(/teks/i)
  })
})

describe('export destination', () => {
  /** A document the recogniser has already been over, so Word has something to write. */
  function withText(pageCount: number): LocalScanDocument {
    const base = doc(pageCount)
    base.pages = base.pages.map((page) => ({ ...page, text: `${page.original}-ocr.json` }))
    for (const page of base.pages) {
      layouts[page.text!] = { blocks: [{ text: 'Halo', lines: [{ text: 'Halo', words: [] }] }] }
    }
    return base
  }

  /**
   * Sharing unless told otherwise, matching the remembered preference's own
   * default: "Ekspor" opening a share sheet is what the button has always
   * done.
   */
  it('shares when the caller names no destination', async () => {
    await exportDocument(doc(1), 'pdf', 'pro')

    expect(destinations).toEqual(['share'])
  })

  it('carries the destination through to delivery', async () => {
    await exportDocument(doc(1), 'pdf', 'pro', { destination: 'device' })

    expect(destinations).toEqual(['device'])
  })

  /**
   * Word takes an early exit past the compressor — there are no images in the
   * file to compress — and that exit used to be the easy place to drop an
   * argument the other formats carry.
   */
  it('carries it on the Word path too, which skips the compressor', async () => {
    await exportDocument(withText(1), 'docx', 'pro', { destination: 'device' })

    expect(destinations).toEqual(['device'])
  })
})
