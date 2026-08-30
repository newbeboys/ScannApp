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

/** Recognised layouts on disk, keyed by the path a page points at. */
const layouts: Record<string, unknown> = {}

vi.mock('./scanStorage', () => ({
  readPageText: async (page: { text?: string }) => (page.text ? (layouts[page.text] ?? null) : null),
}))

vi.mock('./blobBase64', () => ({
  blobToBytes: async () => new Uint8Array([1]),
}))

/** Titles whose write should blow up, so failure paths can be exercised. */
const failWrites = new Set<string>()
const written: { name: string; destination: string }[] = []
const shared: { uris: string[]; title: string }[] = []
/** How many times the run wiped the staging folder. */
let staged = 0
/** What the share sheet does when the run reaches it. */
let shareOutcome: 'sent' | 'cancelled' | 'broken' = 'sent'

const CANCELLED = 'Ekspor dibatalkan — tidak ada berkas yang disimpan di HP.'

vi.mock('./exportShare', () => ({
  CANCELLED_MESSAGE: 'Ekspor dibatalkan — tidak ada berkas yang disimpan di HP.',
  prepareStaging: async () => {
    staged++
  },
  writeExportFiles: async (files: { name: string; blob: Blob }[], destination: string) => {
    for (const file of files) {
      if (failWrites.has(file.name)) throw new Error('Penyimpanan penuh.')
      written.push({ name: file.name, destination })
    }
    return files.map((file) => ({ name: file.name, uri: `file:///Documents/${file.name}` }))
  },
  shareFiles: async (uris: string[], title: string) => {
    // Mirrors the real function, which returns early on an empty list.
    if (uris.length === 0) return 'cancelled'
    shared.push({ uris, title })
    // The real one rethrows anything that is not a dismissal.
    if (shareOutcome === 'broken') throw new Error('Gagal membuka layar berbagi.')
    return shareOutcome
  },
  deliverExport: async () => ({ message: 'tidak dipakai di test ini', cancelled: false }),
}))

/** The names that reached disk, which is what most assertions here care about. */
const names = () => written.map((entry) => entry.name)

const { exportDocumentsBatch, summarizeBatchExport } = await import('./documentExport')

function doc(id: string, title: string, pageCount = 1): LocalScanDocument {
  return {
    schemaVersion: 6,
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
  staged = 0
  shareOutcome = 'sent'
  for (const key of Object.keys(layouts)) delete layouts[key]
})

describe('summarizeBatchExport', () => {
  it('names the folder when everything worked', () => {
    const message = summarizeBatchExport({
      total: 3,
      saved: ['A.pdf', 'B.pdf', 'C.pdf'],
      failed: [],
      cancelled: false,
      dismissed: false,
      destination: 'device',
      shareError: null,
    })

    expect(message).toBe('3 dokumen tersimpan di folder Documents.')
  })

  /**
   * The reason travels with the count. Without it a batch that failed reports
   * only *that* it failed, and the one thing that would explain why — the
   * message already collected per document — is thrown away before it reaches
   * anyone (Boss Ali dari HP, 26 Agustus 2026: tiga dokumen gagal terkirim
   * tanpa jejak apa pun).
   */
  it('counts both sides and carries the reason when some failed', () => {
    const message = summarizeBatchExport({
      total: 5,
      saved: ['A.pdf', 'B.pdf', 'C.pdf', 'D.pdf'],
      failed: [{ title: 'E', message: 'Penyimpanan penuh.' }],
      cancelled: false,
      dismissed: false,
      destination: 'device',
      shareError: null,
    })

    expect(message).toBe('4 dokumen tersimpan di folder Documents, 1 gagal: Penyimpanan penuh.')
  })

  /** One shared cause is stated once, not repeated per document. */
  it('states a shared cause once', () => {
    const message = summarizeBatchExport({
      total: 2,
      saved: [],
      failed: [
        { title: 'A', message: 'Penyimpanan penuh.' },
        { title: 'B', message: 'Penyimpanan penuh.' },
      ],
      cancelled: false,
      dismissed: false,
      destination: 'device',
      shareError: null,
    })

    expect(message).toBe('Tidak ada dokumen yang berhasil diekspor: Penyimpanan penuh.')
  })

  /** Different causes: the first is named, and the rest are acknowledged. */
  it('names the first cause and flags that others differ', () => {
    const message = summarizeBatchExport({
      total: 2,
      saved: [],
      failed: [
        { title: 'A', message: 'Berkas terkunci.' },
        { title: 'B', message: 'Penyimpanan penuh.' },
      ],
      cancelled: false,
      dismissed: false,
      destination: 'device',
      shareError: null,
    })

    expect(message).toBe(
      'Tidak ada dokumen yang berhasil diekspor: Berkas terkunci. (sebab lain juga muncul)',
    )
  })

  /** The stop button promises exactly this: finish the current one, then halt. */
  it('reports how far a stopped run got', () => {
    const message = summarizeBatchExport({
      total: 5,
      saved: ['A.pdf', 'B.pdf'],
      failed: [],
      cancelled: true,
      dismissed: false,
      destination: 'device',
      shareError: null,
    })

    expect(message).toBe('Dihentikan — 2 dari 5 dokumen tersimpan di folder Documents.')
  })

  it('handles a stop before anything was written', () => {
    const message = summarizeBatchExport({
      total: 5,
      saved: [],
      failed: [],
      cancelled: true,
      dismissed: false,
      destination: 'device',
      shareError: null,
    })

    expect(message).toBe('Dihentikan sebelum ada dokumen yang selesai.')
  })

  /**
   * Stopping and failing are not alternatives — a run can do both. Reporting
   * only the stop would drop the cause on exactly the run that has one.
   */
  it('keeps the reason when a run both failed and was stopped', () => {
    const message = summarizeBatchExport({
      total: 3,
      saved: ['B.pdf'],
      failed: [{ title: 'A', message: 'Penyimpanan penuh.' }],
      cancelled: true,
      dismissed: false,
      destination: 'device',
      shareError: null,
    })

    expect(message).toBe(
      'Dihentikan — 1 dari 3 dokumen tersimpan di folder Documents. 1 gagal: Penyimpanan penuh.',
    )
  })

  it('keeps the reason when a stopped run saved nothing', () => {
    const message = summarizeBatchExport({
      total: 3,
      saved: [],
      failed: [{ title: 'A', message: 'Penyimpanan penuh.' }],
      cancelled: true,
      dismissed: false,
      destination: 'device',
      shareError: null,
    })

    expect(message).toBe(
      'Dihentikan sebelum ada dokumen yang selesai. 1 gagal: Penyimpanan penuh.',
    )
  })
})

describe('exportDocumentsBatch', () => {
  it('writes one PDF per document, named after its title', async () => {
    const result = await exportDocumentsBatch(
      [doc('a', 'Kwitansi Agustus'), doc('b', 'Kontrak Sewa')],
      'pro',
    )

    expect(names()).toEqual(['Kwitansi Agustus.pdf', 'Kontrak Sewa.pdf'])
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

    expect(names()).toEqual(['Nota.pdf'])
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
    // The cause reaches the user, not just the count — see `describeFailures`.
    expect(result.message).toBe('2 dokumen dikirim, 1 gagal: Penyimpanan penuh.')
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

    await exportDocumentsBatch([doc('a', 'A'), doc('b', 'B')], 'pro', {
      onProgress: (progress) => seen.push(progress),
    })

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
      {
        onProgress: (progress) => {
          if (progress.index === 0) controller.abort()
        },
        signal: controller.signal,
      },
    )

    expect(result.saved).toEqual(['A.pdf'])
    expect(result.cancelled).toBe(true)
    expect(result.message).toBe('Dihentikan — 1 dari 3 dokumen dikirim.')
  })

  /**
   * "Simpan ke HP" is not a share with an extra step: no sheet opens at all,
   * so there is nothing to dismiss and nothing to clean up afterwards.
   */
  it('never opens the share sheet when saving to the phone', async () => {
    const result = await exportDocumentsBatch([doc('a', 'A'), doc('b', 'B')], 'pro', {
      destination: 'device',
    })

    expect(shared).toHaveLength(0)
    expect(staged).toBe(0)
    expect(written.map((entry) => entry.destination)).toEqual(['device', 'device'])
    expect(result.message).toBe('2 dokumen tersimpan di folder Documents.')
  })

  /**
   * The staging folder is wiped once for the whole run, not per document.
   * Wiping between documents would delete the ones already queued for the
   * single share sheet at the end — the batch would hand over its last file
   * and lose the rest.
   */
  it('wipes staging once for the run, not once per document', async () => {
    await exportDocumentsBatch([doc('a', 'A'), doc('b', 'B'), doc('c', 'C')], 'pro')

    expect(staged).toBe(1)
    expect(shared[0].uris).toHaveLength(3)
  })

  /**
   * Dismissing the sheet has to leave the phone as it was: the staged copies
   * are wiped again and the summary says so, rather than claiming three
   * documents were delivered to nobody.
   */
  it('wipes staging again and reports a cancel when the sheet is dismissed', async () => {
    shareOutcome = 'cancelled'

    const result = await exportDocumentsBatch([doc('a', 'A'), doc('b', 'B')], 'pro')

    expect(result.dismissed).toBe(true)
    expect(staged).toBe(2)
    expect(result.message).toBe(CANCELLED)
  })

  /**
   * A share that genuinely broke is not a share that was declined. Throwing
   * from there would discard a whole run's accounting — which documents were
   * built, which were lost and why — and leave one sentence about the sheet.
   */
  it('keeps the run accounting when the share sheet fails outright', async () => {
    shareOutcome = 'broken'

    const result = await exportDocumentsBatch([doc('a', 'A'), doc('b', 'B')], 'pro')

    expect(result.saved).toEqual(['A.pdf', 'B.pdf'])
    expect(result.dismissed).toBe(false)
    expect(result.shareError).toBe('Gagal membuka layar berbagi.')
    expect(result.message).toBe(
      '2 dokumen dibuat, tapi gagal dikirim: Gagal membuka layar berbagi.',
    )
    // Nothing landed, so the staged copies go the same way as on a cancel.
    expect(staged).toBe(2)
  })

  it('still names the documents it lost when the share sheet fails', async () => {
    shareOutcome = 'broken'
    failWrites.add('B.pdf')

    const result = await exportDocumentsBatch([doc('a', 'A'), doc('b', 'B')], 'pro')

    expect(result.message).toBe(
      '1 dokumen dibuat, tapi gagal dikirim: Gagal membuka layar berbagi. 1 gagal dibuat: Penyimpanan penuh.',
    )
  })

  /** A cancel still has to carry the reason documents never reached the sheet. */
  it('keeps the failure reason when the sheet is dismissed', async () => {
    shareOutcome = 'cancelled'
    failWrites.add('B.pdf')

    const result = await exportDocumentsBatch([doc('a', 'A'), doc('b', 'B')], 'pro')

    expect(result.message).toBe(`${CANCELLED} 1 gagal dibuat: Penyimpanan penuh.`)
  })

  it('still shares what it managed to write before stopping', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await exportDocumentsBatch(
      [doc('a', 'A')],
      'pro',
      { signal: controller.signal },
    )

    expect(result.saved).toEqual([])
    expect(result.cancelled).toBe(true)
    expect(shared).toHaveLength(0)
  })
})

describe('exportDocumentsBatch — Word', () => {
  /** A document whose pages all carry recognised text. */
  function recognized(id: string, title: string, pageCount = 1): LocalScanDocument {
    const base = doc(id, title, pageCount)
    base.pages = base.pages.map((page) => ({ ...page, text: `${page.original}-ocr.json` }))
    for (const page of base.pages) {
      layouts[page.text!] = { blocks: [{ text: title, lines: [{ text: title, words: [] }] }] }
    }
    return base
  }

  it('writes one .docx per document instead of a PDF', async () => {
    const result = await exportDocumentsBatch(
      [recognized('a', 'Kwitansi'), recognized('b', 'Kontrak')],
      'pro',
      { format: 'docx' },
    )

    expect(names()).toEqual(['Kwitansi.docx', 'Kontrak.docx'])
    expect(result.failed).toEqual([])
  })

  /**
   * The selection is made on the documents tab, which knows nothing about
   * which of them have been read. Skipping one quietly would leave the user
   * counting files to work out which; it is reported like any other failure.
   */
  it('reports a document that has no text rather than writing an empty file', async () => {
    const result = await exportDocumentsBatch(
      [recognized('a', 'Kwitansi'), doc('b', 'Belum Dibaca')],
      'pro',
      { format: 'docx' },
    )

    expect(names()).toEqual(['Kwitansi.docx'])
    expect(result.saved).toEqual(['Kwitansi.docx'])
    expect(result.failed).toEqual([
      { title: 'Belum Dibaca', message: 'Belum ada teks yang dikenali di dokumen ini.' },
    ])
  })

  it('numbers repeated titles against the Word extension', async () => {
    const result = await exportDocumentsBatch(
      [recognized('a', 'Nota'), recognized('b', 'Nota')],
      'pro',
      { format: 'docx' },
    )

    expect(result.saved).toEqual(['Nota.docx', 'Nota (2).docx'])
  })

  it('still defaults to PDF when no format is asked for', async () => {
    await exportDocumentsBatch([recognized('a', 'Nota')], 'pro')

    expect(names()).toEqual(['Nota.pdf'])
  })
})
