import { blobToBytes } from './blobBase64'
import { loadPageBlob } from './documentEditing'
import {
  BASIC_COMPRESSION,
  COMPRESSION_PRESETS,
  DEFAULT_COMPRESSION_LEVEL,
  resolveCompressionLevel,
  shouldWatermark,
  type CompressionLevel,
  type CompressOptions,
} from './exportLimits'
import { compressImage } from './imageEditor'
import { toSafeFilename } from './exportNames'
import { deliverExport, type DeliveryResult, type ExportFile } from './exportShare'
import type { LocalScanDocument } from './scanStorage'
import type { Tier } from './tier'

export type ExportFormat = 'pdf' | 'jpg' | 'png'

/** Which document a running batch is on, for the sheet's progress line. */
export interface BatchProgress {
  /** 0-based. */
  index: number
  total: number
  title: string
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
  return (await exportPdf(doc, tier, BASIC_COMPRESSION))[0]
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

  const pdf = await buildPdf(bytes, {
    watermark: shouldWatermark(tier),
    title: doc.title,
    // Carried into the file so a backup can hand the date back on restore —
    // and so an exported PDF is dated when it was scanned either way.
    scannedAt: doc.createdAt,
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
 * `level` is what the user asked for; `resolveCompressionLevel` decides what
 * they actually get. Enforcing the tier here rather than only in the sheet
 * means a hidden control is also a refused one.
 *
 * The format itself is not gated: PDF, JPG and PNG are all available to Basic
 * (Boss Ali, 23 Agustus 2026 — PNG moved out of Pro).
 */
export async function exportDocument(
  doc: LocalScanDocument,
  format: ExportFormat,
  tier: Tier,
  level: CompressionLevel = DEFAULT_COMPRESSION_LEVEL,
): Promise<DeliveryResult> {
  const options = COMPRESSION_PRESETS[resolveCompressionLevel(tier, level)]
  const files =
    format === 'pdf' ? await exportPdf(doc, tier, options) : await exportImages(doc, options, format)
  return deliverExport(files)
}
