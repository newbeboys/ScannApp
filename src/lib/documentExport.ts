import { blobToBytes } from './blobBase64'
import { loadPageBlob } from './documentEditing'
import { shouldWatermark } from './exportLimits'
import { compressImage } from './imageEditor'
import { deliverExport, toSafeFilename, type DeliveryResult, type ExportFile } from './exportShare'
import type { LocalScanDocument } from './scanStorage'
import type { Tier } from './tier'

export type ExportFormat = 'pdf' | 'jpg'

/**
 * Every export runs through the standard Basic compression level, so the
 * page bytes that reach the PDF or the JPG files are already resized and
 * re-encoded (PRD Bagian 3: one fixed level for Basic; Fase 6 adds the Pro
 * quality slider).
 */
async function compressedPages(doc: LocalScanDocument): Promise<Blob[]> {
  const out: Blob[] = []
  for (const page of doc.pages) {
    out.push(await compressImage(await loadPageBlob(page)))
  }
  return out
}

/**
 * Exported so the cloud backup uploads byte-for-byte the same PDF the user
 * would get from the export sheet — watermark and compression included.
 */
export async function buildPdfFile(doc: LocalScanDocument, tier: Tier): Promise<ExportFile> {
  return (await exportPdf(doc, tier))[0]
}

async function exportPdf(doc: LocalScanDocument, tier: Tier): Promise<ExportFile[]> {
  // Loaded on demand so pdf-lib stays out of the initial app bundle.
  const { buildPdf } = await import('./pdfExport')

  const pages = await compressedPages(doc)
  const bytes: Uint8Array[] = []
  for (const page of pages) {
    bytes.push(await blobToBytes(page))
  }

  const pdf = await buildPdf(bytes, {
    watermark: shouldWatermark(tier),
    title: doc.title,
  })

  return [
    {
      name: `${toSafeFilename(doc.title)}.pdf`,
      // Copied into a fresh buffer so the Blob gets a plain ArrayBuffer view.
      blob: new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }),
    },
  ]
}

async function exportJpg(doc: LocalScanDocument): Promise<ExportFile[]> {
  const pages = await compressedPages(doc)
  const base = toSafeFilename(doc.title)

  // Single-page documents keep a clean name; multi-page ones get numbered.
  return pages.map((blob, index) => ({
    name: pages.length === 1 ? `${base}.jpg` : `${base}-${index + 1}.jpg`,
    blob,
  }))
}

export async function exportDocument(
  doc: LocalScanDocument,
  format: ExportFormat,
  tier: Tier,
): Promise<DeliveryResult> {
  const files = format === 'pdf' ? await exportPdf(doc, tier) : await exportJpg(doc)
  return deliverExport(files)
}
