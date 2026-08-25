import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPRESSION_PRESETS, type CompressOptions } from './exportLimits'
import type { LocalScanDocument } from './scanIndexMigration'

/**
 * Stands in for the canvas work. PNG is made deliberately bulkier than JPEG so
 * a test can tell the two estimates apart by size alone.
 */
const asked: CompressOptions[] = []

vi.mock('./imageEditor', () => ({
  compressImagePair: async (_blob: Blob, options: CompressOptions) => {
    asked.push(options)
    return { jpeg: new Blob(['x'.repeat(100)]), png: new Blob(['x'.repeat(900)]) }
  },
}))

vi.mock('./documentEditing', () => ({
  loadPageBlob: async () => new Blob(['page']),
}))

const { estimateExportSizes } = await import('./exportEstimate')

function doc(pageCount: number): LocalScanDocument {
  return {
    schemaVersion: 5,
    id: 'doc-1',
    title: 'Nota',
    createdAt: '2026-03-04T00:00:00.000Z',
    pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => ({ original: `page-${index + 1}.jpg` })),
  }
}

beforeEach(() => {
  asked.length = 0
})

describe('estimateExportSizes', () => {
  /**
   * One page is encoded and multiplied out. Encoding all of them would make
   * every slider nudge on a 30-page document cost seconds.
   */
  /**
   * One decode, not one per format. Opening the sheet used to decode the page
   * twice — once for the JPEG figure and once for the PNG one — which on a
   * 12MP scan is around 270ms thrown away on a desktop and noticeably more on
   * a phone (diukur 24 Agustus 2026).
   */
  it('decodes the first page once and encodes both formats from it', async () => {
    await estimateExportSizes(doc(30), 'standard')

    expect(asked).toHaveLength(1)
  })

  it('scales the estimate by the page count', async () => {
    const one = await estimateExportSizes(doc(1), 'standard')
    const four = await estimateExportSizes(doc(4), 'standard')

    expect(four.jpg).toBe(one.jpg * 4)
  })

  it('estimates PNG from the PNG encoder, not the JPEG one', async () => {
    const sizes = await estimateExportSizes(doc(1), 'standard')

    expect(sizes.png).toBeGreaterThan(sizes.jpg)
  })

  it('counts a PDF as its JPEG pages plus a little structure', async () => {
    const sizes = await estimateExportSizes(doc(2), 'standard')

    expect(sizes.pdf).toBeGreaterThanOrEqual(sizes.jpg)
  })

  it('uses the level the caller asked for', async () => {
    await estimateExportSizes(doc(1), 'max')

    expect(asked[0].quality).toBe(COMPRESSION_PRESETS.max.quality)
  })

  /**
   * The estimate has to come out where the file does. A level this build does
   * not recognise — `localStorage` outliving a rename — resolves to standard
   * on the way into the export, so the preview must resolve it the same way.
   */
  it('resolves an unrecognised level the same way the export does', async () => {
    await estimateExportSizes(doc(1), 'enormous' as CompressionLevel)

    expect(asked[0].quality).toBe(COMPRESSION_PRESETS.standard.quality)
  })
})
