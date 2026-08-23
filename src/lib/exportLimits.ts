import type { Tier } from './tier'

const DEFAULT_BASIC_MAX_MERGE_PAGES = 20

function readMaxMergePages(): number {
  const raw = import.meta.env.VITE_APP_BASIC_MAX_MERGE_PAGES
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BASIC_MAX_MERGE_PAGES
}

/** Basic tier ceiling for a merged document (PRD Bagian 3). Pro is unlimited. */
export const MAX_BASIC_MERGE_PAGES = readMaxMergePages()

/** How a page is re-encoded on its way into an export. */
export interface CompressOptions {
  quality: number
  maxEdgePx: number
  /** JPEG unless an export format needs otherwise — see `png` in documentExport. */
  mimeType?: 'image/jpeg' | 'image/png'
}

/** Ordered smallest file first; the slider reads positions straight off this. */
export const COMPRESSION_LEVELS = ['small', 'standard', 'high', 'max'] as const

export type CompressionLevel = (typeof COMPRESSION_LEVELS)[number]

/**
 * Four stops rather than a free 0..100 slider.
 *
 * Nobody can see the difference between JPEG q=0.72 and q=0.75, so a
 * continuous control would promise a precision that does not exist and would
 * force a re-encode on every drag to show an honest size. Each stop below
 * lands somewhere visibly different.
 *
 * `max` is still capped: an uncapped long edge lets one oversized scan
 * exhaust the canvas memory of a low-end phone.
 */
export const COMPRESSION_PRESETS: Record<CompressionLevel, CompressOptions> = {
  small: { quality: 0.55, maxEdgePx: 1600 },
  standard: { quality: 0.75, maxEdgePx: 2400 },
  high: { quality: 0.88, maxEdgePx: 3200 },
  max: { quality: 0.95, maxEdgePx: 4000 },
}

export const COMPRESSION_LABELS: Record<CompressionLevel, string> = {
  small: 'Kecil',
  standard: 'Standar',
  high: 'Tinggi',
  max: 'Maksimal',
}

/** What each level is actually good for, shown under the slider. */
export const COMPRESSION_HINTS: Record<CompressionLevel, string> = {
  small: 'Paling ringan dikirim lewat chat atau diunggah ke formulir.',
  standard: 'Seimbang antara ukuran berkas dan ketajaman.',
  high: 'Teks kecil tetap tajam saat dicetak.',
  max: 'Hampir tanpa perkecilan — untuk arsip jangka panjang.',
}

export const DEFAULT_COMPRESSION_LEVEL: CompressionLevel = 'standard'

/**
 * Standard compression — what Basic always gets, and what the cloud backup is
 * pinned to whatever the user picks here (Boss Ali, 23 Agustus 2026: an export
 * choice must not silently change backup fidelity or quota use).
 */
export const BASIC_COMPRESSION = COMPRESSION_PRESETS[DEFAULT_COMPRESSION_LEVEL]

/** The manual quality control is Pro-only (PRD Bagian 3). PNG export is not — see `documentExport`. */
export function canChooseCompression(tier: Tier): boolean {
  return tier === 'pro'
}

/**
 * The single place that decides which level an export really runs at.
 *
 * Lives in the library rather than the sheet on purpose: hiding a control in
 * the UI is not the same as refusing it.
 */
export function resolveCompressionLevel(tier: Tier, requested: CompressionLevel): CompressionLevel {
  if (!canChooseCompression(tier)) return DEFAULT_COMPRESSION_LEVEL
  return COMPRESSION_LEVELS.includes(requested) ? requested : DEFAULT_COMPRESSION_LEVEL
}

export interface MergeCheck {
  allowed: boolean
  limit: number | null
  /** Null when allowed; a user-facing Indonesian message when blocked. */
  reason: string | null
}

/**
 * Merge is available to every tier (CLAUDE.md aturan #5) — only the page
 * ceiling differs. Pro has no ceiling at all.
 */
export function checkMergeAllowed(tier: Tier, pageCount: number): MergeCheck {
  if (tier === 'pro') {
    return { allowed: true, limit: null, reason: null }
  }

  if (pageCount > MAX_BASIC_MERGE_PAGES) {
    return {
      allowed: false,
      limit: MAX_BASIC_MERGE_PAGES,
      reason: `Dokumen gabungan Basic maksimal ${MAX_BASIC_MERGE_PAGES} halaman. Pilihan sekarang ${pageCount} halaman.`,
    }
  }

  return { allowed: true, limit: MAX_BASIC_MERGE_PAGES, reason: null }
}

/** Basic exports carry a small ScannApp watermark; Pro exports are clean (PRD Bagian 3). */
export function shouldWatermark(tier: Tier): boolean {
  return tier === 'basic'
}
