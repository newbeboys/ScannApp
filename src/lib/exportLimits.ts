import type { Tier } from './tier'

const DEFAULT_BASIC_MAX_MERGE_PAGES = 20

function readMaxMergePages(): number {
  const raw = import.meta.env.VITE_APP_BASIC_MAX_MERGE_PAGES
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BASIC_MAX_MERGE_PAGES
}

/** Basic tier ceiling for a merged document (PRD Bagian 3). Pro is unlimited. */
export const MAX_BASIC_MERGE_PAGES = readMaxMergePages()

/** Standard compression for Basic — one fixed level, no user control (Fase 6 adds the Pro slider). */
export const BASIC_COMPRESSION = {
  quality: 0.75,
  maxEdgePx: 2400,
} as const

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
