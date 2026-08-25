import { MAX_BASIC_MERGE_PAGES } from './exportLimits'
import { formatBytes } from './formatBytes'
import type { PlanId } from './purchases/purchaseConfig'
import { QUOTA_BYTES } from './storageQuota'

export interface LimitRow {
  label: string
  basic: string
  pro: string
}

/**
 * What Basic gives up, and what Pro gives back — the only claims the paywall
 * makes.
 *
 * Deliberately lists only what the app enforces today. Three rows were
 * *deleted* from it during August as Boss Ali moved reorder, filters, PNG,
 * annotation, signatures, split and batch export out to every tier, and the
 * OCR row was added the day the engine shipped. A paywall that keeps selling a
 * limit that was lifted is a refund request waiting to happen, so this lives
 * apart from the screen and has a test holding it against reality.
 */
export function limitRows(plan: PlanId): LimitRow[] {
  return [
    {
      label: 'Halaman per dokumen gabungan',
      basic: `${MAX_BASIC_MERGE_PAGES} halaman`,
      pro: 'Tanpa batas',
    },
    {
      label: 'Penyimpanan cadangan cloud',
      basic: formatBytes(QUOTA_BYTES.basic),
      pro: formatBytes(QUOTA_BYTES[plan]),
    },
    { label: 'Iklan', basic: 'Banner & sisipan', pro: 'Tidak ada' },
    { label: 'Watermark di PDF', basic: 'Ada', pro: 'Tidak ada' },
    // Added the day OCR shipped (Fase 6 potongan D). DOCX is named here even
    // though it lands in D2: the two come out of one engine, and the row would
    // otherwise have to be rewritten a day later.
    { label: 'Teks dokumen', basic: 'Tidak bisa dicari', pro: 'PDF bisa dicari & Word' },
  ]
}
