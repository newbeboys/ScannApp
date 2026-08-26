import { blobToBytes } from './blobBase64'
import { loadPageBlob } from './documentEditing'
import {
  COMPRESSION_PRESETS,
  DEFAULT_COMPRESSION_LEVEL,
  resolveCompressionLevel,
  shouldWatermark,
  STANDARD_COMPRESSION,
  type CompressionLevel,
  type CompressOptions,
} from './exportLimits'
import { compressImage } from './imageEditor'
import { toSafeFilename, uniqueExportNames } from './exportNames'
import {
  deliverExport,
  shareFiles,
  writeExportFiles,
  type DeliveryResult,
  type ExportFile,
} from './exportShare'
import type { PageText } from './ocrLayout'
import { readPageText, type LocalScanDocument } from './scanStorage'
import type { Tier } from './tier'

export type ExportFormat = 'pdf' | 'jpg' | 'png' | 'docx'

/** The formats that are pages of pixels, as opposed to a document of text. */
export function isImageFormat(format: ExportFormat): format is 'jpg' | 'png' {
  return format === 'jpg' || format === 'png'
}

/**
 * True once a document has text to put in a Word file.
 *
 * The one thing DOCX depends on, kept here so the export sheet and the export
 * itself cannot disagree about when it is offered.
 */
export function canExportDocx(doc: LocalScanDocument): boolean {
  return doc.pages.some((page) => page.text)
}

/** Which document a running batch is on, for the sheet's progress line. */
export interface BatchProgress {
  /** 0-based. */
  index: number
  total: number
  title: string
}

/** What a whole selection is turned into. Narrower than ExportFormat on purpose:
 * one image file per page across five documents is a hundred files at once. */
export type BatchFormat = 'pdf' | 'docx'

export interface BatchExportOptions {
  level?: CompressionLevel
  /** Word instead of PDF. The compression level has nothing to compress there. */
  format?: BatchFormat
  onProgress?: (progress: BatchProgress) => void
  signal?: AbortSignal
}

export interface BatchExportResult {
  /** How many were asked for — not the same as saved + failed once stopped. */
  total: number
  /** Filenames actually written, in order. */
  saved: string[]
  failed: { title: string; message: string }[]
  cancelled: boolean
  /** Ready-to-toast Indonesian summary. */
  message: string
}

/**
 * Turns a finished batch into the one sentence the user sees.
 *
 * Split out from the run itself so every wording can be tested without
 * encoding a single page.
 */
export function summarizeBatchExport(result: Omit<BatchExportResult, 'message'>): string {
  const saved = result.saved.length
  const failed = result.failed.length

  if (result.cancelled) {
    return saved === 0
      ? 'Dihentikan sebelum ada dokumen yang tersimpan.'
      : `Dihentikan — ${saved} dari ${result.total} dokumen tersimpan.`
  }

  if (saved === 0) {
    return failed === 0
      ? 'Tidak ada dokumen yang diekspor.'
      : 'Tidak ada dokumen yang berhasil diekspor. Periksa ruang penyimpanan lalu coba lagi.'
  }

  if (failed > 0) {
    return `${saved} dokumen diekspor, ${failed} gagal. Coba lagi untuk sisanya.`
  }

  return `${saved} dokumen diekspor ke folder Documents.`
}

/** Re-encodes every page at one level. The only place export bytes are produced. */
async function compressedPages(doc: LocalScanDocument, options: CompressOptions): Promise<Blob[]> {
  const out: Blob[] = []
  for (const page of doc.pages) {
    out.push(await compressImage(await loadPageBlob(page), options))
  }
  return out
}

/**
 * Exported so the cloud backup uploads byte-for-byte the same PDF the export
 * sheet would produce at the standard level — watermark and compression
 * included.
 *
 * Deliberately takes no level. The manual control added in Fase 6 governs the
 * file the user is saving right now and nothing else: letting it reach here
 * would make a choice in the export sheet silently decide how much R2 quota a
 * backup costs, and what quality `cloudRestore` can ever hand back (Boss Ali,
 * 23 Agustus 2026).
 */
export async function buildPdfFile(doc: LocalScanDocument, tier: Tier): Promise<ExportFile> {
  return (await exportPdf(doc, tier, STANDARD_COMPRESSION))[0]
}

async function exportPdf(
  doc: LocalScanDocument,
  tier: Tier,
  options: CompressOptions,
): Promise<ExportFile[]> {
  // Loaded on demand so pdf-lib stays out of the initial app bundle.
  const { buildPdf } = await import('./pdfExport')

  const pages = await compressedPages(doc, { ...options, mimeType: 'image/jpeg' })
  const bytes: Uint8Array[] = []
  for (const page of pages) {
    bytes.push(await blobToBytes(page))
  }

  const text = await pageTexts(doc)

  const pdf = await buildPdf(bytes, {
    watermark: shouldWatermark(tier),
    title: doc.title,
    // Carried into the file so a backup can hand the date back on restore —
    // and so an exported PDF is dated when it was scanned either way.
    scannedAt: doc.createdAt,
    text,
  })

  return [
    {
      name: `${toSafeFilename(doc.title)}.pdf`,
      // Copied into a fresh buffer so the Blob gets a plain ArrayBuffer view.
      blob: new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }),
    },
  ]
}

/**
 * Reads every page's recognised text, keeping the gaps.
 *
 * Index-aligned on purpose: both consumers match text to pages by position, so
 * dropping a page that was never recognised would move every later page's
 * words onto the wrong page.
 *
 * No tier check here or in either consumer. The gate is on running the engine
 * (`recognizeDocument`), not on reading text the user already has: a lapsed
 * subscription stops selling the machine, it does not confiscate what the
 * machine produced.
 */
async function pageTexts(doc: LocalScanDocument): Promise<(PageText | null)[]> {
  const text: (PageText | null)[] = []
  for (const page of doc.pages) {
    text.push(await readPageText(page))
  }
  return text
}

/**
 * The recognised text as an editable Word document.
 *
 * Touches no page image at all — that is the point of it. Running the
 * compressor here would re-encode twenty 12 MP JPEGs to build a file that
 * contains none of them.
 *
 * No tier check, for the same reason the PDF text layer has none: the gate is
 * on running the recogniser (`recognizeDocument`), not on reading text the
 * user already has. In practice that makes DOCX Pro anyway — a Basic account
 * has no way to produce the text this needs.
 */
async function exportDocx(doc: LocalScanDocument): Promise<ExportFile[]> {
  // Loaded on demand, like pdf-lib: neither belongs in the initial bundle.
  const { buildDocx } = await import('./docxExport')

  const docx = buildDocx(await pageTexts(doc), { title: doc.title, createdAt: doc.createdAt })

  return [
    {
      name: `${toSafeFilename(doc.title)}.docx`,
      blob: new Blob([new Uint8Array(docx)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    },
  ]
}

/**
 * One image file per page, JPG or PNG.
 *
 * PNG runs the same resize but a different encoder — it is never derived from
 * the JPEG one. Re-wrapping an already-compressed page losslessly produces a
 * far larger file without recovering a single pixel of what JPEG discarded:
 * measured in Chromium on a 3000x4200 page, PNG from the original came to
 * 102 KB against 191 KB for PNG from the JPEG intermediate — 87% heavier for
 * nothing.
 *
 * The same measurements are why the sheet shows a size per format rather than
 * describing PNG in words. Against JPEG, PNG came out 11x larger on a noisy
 * camera scan, 14x larger on an evenly lit one, and 4x *smaller* once the
 * Hitam-Putih filter had reduced the page to two colours. No rule of thumb
 * survives that spread, so the number is measured from the page itself.
 */
async function exportImages(
  doc: LocalScanDocument,
  options: CompressOptions,
  extension: 'jpg' | 'png',
): Promise<ExportFile[]> {
  const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg'
  const pages = await compressedPages(doc, { ...options, mimeType })
  const base = toSafeFilename(doc.title)

  // Single-page documents keep a clean name; multi-page ones get numbered.
  return pages.map((blob, index) => ({
    name: pages.length === 1 ? `${base}.${extension}` : `${base}-${index + 1}.${extension}`,
    blob,
  }))
}

/**
 * Nothing here is gated by tier any more except the watermark.
 *
 * The formats went first (PNG, 23 Agustus 2026), then the quality level
 * (25 Agustus 2026). `tier` survives as a parameter because `shouldWatermark`
 * still reads it — a clean export is what Pro buys on this screen.
 */
export async function exportDocument(
  doc: LocalScanDocument,
  format: ExportFormat,
  tier: Tier,
  level: CompressionLevel = DEFAULT_COMPRESSION_LEVEL,
): Promise<DeliveryResult> {
  if (format === 'docx') return deliverExport(await exportDocx(doc))

  const options = COMPRESSION_PRESETS[resolveCompressionLevel(level)]
  const files =
    format === 'pdf' ? await exportPdf(doc, tier, options) : await exportImages(doc, options, format)
  return deliverExport(files)
}

/**
 * Exports several documents as one PDF each. Available to every tier.
 *
 * The Pro gate this used to carry was lifted by Boss Ali on 25 Agustus 2026,
 * alongside split and annotate: exporting the documents you already own is a
 * basic need, not something to be sold. The quality control followed the same
 * day, so what Pro buys here is now only the absence of the watermark.
 *
 * Sequential, and each PDF is written to disk before the next is built. The
 * same reasoning as `handleRestoreAll`: this is not work that gets faster by
 * being piled up, and piling it up means holding every PDF in memory at once
 * — a 20-page document peaks around 16 MB, so five of them together is the
 * kind of allocation that made the editor stutter on a real phone.
 *
 * The share sheet opens once, at the end, with whatever actually landed.
 */
export async function exportDocumentsBatch(
  docs: LocalScanDocument[],
  tier: Tier,
  batch: BatchExportOptions = {},
): Promise<BatchExportResult> {
  if (docs.length === 0) {
    throw new Error('Tidak ada dokumen untuk diekspor.')
  }

  const { level = DEFAULT_COMPRESSION_LEVEL, format = 'pdf', onProgress, signal } = batch
  const options = COMPRESSION_PRESETS[resolveCompressionLevel(level)]
  // Decided up front, because only this function can see the whole batch:
  // the per-document builders name one at a time and cannot know that another
  // document in the same run reduces to the same filename.
  const names = uniqueExportNames(docs.map((doc) => `${toSafeFilename(doc.title)}.${format}`))

  const saved: string[] = []
  const failed: { title: string; message: string }[] = []
  const uris: string[] = []
  let cancelled = false

  for (let index = 0; index < docs.length; index++) {
    // Checked between documents, never inside one: stopping midway through a
    // PDF would leave a half-written file in the Documents folder.
    if (signal?.aborted) {
      cancelled = true
      break
    }

    const doc = docs[index]
    onProgress?.({ index, total: docs.length, title: doc.title })

    try {
      // A document nobody has run the recogniser over throws here, from
      // `buildDocx`, and lands in `failed` with its own message. That is the
      // right place for it: the selection is made on the documents tab, which
      // has no idea which documents have been read.
      const [built] =
        format === 'docx' ? await exportDocx(doc) : await exportPdf(doc, tier, options)
      uris.push(...(await writeExportFiles([{ ...built, name: names[index] }])))
      saved.push(names[index])
    } catch (error) {
      // Counted, not thrown: one unreadable document must not keep the rest
      // off the phone.
      failed.push({
        title: doc.title,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await shareFiles(uris, 'Dokumen ScannApp')

  const outcome = { total: docs.length, saved, failed, cancelled }
  return { ...outcome, message: summarizeBatchExport(outcome) }
}
