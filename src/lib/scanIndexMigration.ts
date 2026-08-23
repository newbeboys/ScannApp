/**
 * The five document filters (keputusan Boss Ali 23 Agustus 2026, menaikkan
 * daftar dua filter di PRD Bagian 3).
 *
 * Each earns its place by serving a different problem rather than being a
 * variation of the same one — see the design doc, Bagian 2.5.
 */
export const DOCUMENT_FILTERS = ['magic', 'bright', 'grayscale', 'bw', 'ink-saver'] as const

export type DocumentFilter = (typeof DOCUMENT_FILTERS)[number]

/**
 * What a page says about its own filter.
 *
 * `'none'` is not the same as leaving this out: it means the user deliberately
 * excluded this page from the document's filter — the colour chart in the
 * middle of a black-and-white contract — whereas absent means "whatever the
 * document says".
 */
export type PageFilter = DocumentFilter | 'none'

export function isDocumentFilter(value: unknown): value is DocumentFilter {
  return DOCUMENT_FILTERS.includes(value as DocumentFilter)
}

export interface ScanPage {
  /** Untouched scanner output. Never overwritten, so "reset to original" always works. */
  original: string
  /**
   * Present once the page has been cropped/rotated.
   *
   * Geometry only — a filter is never baked in here. Cropping a filtered page
   * still works from this chain, which is what lets the filter be swapped
   * afterwards without losing the crop (design doc, Bagian 2.2).
   */
  edited?: string
  /** This page's exception to the document filter. Absent means it follows the document. */
  filter?: PageFilter
  /** The rendered filter result, derived from `edited ?? original`. */
  filtered?: string
}

export interface LocalScanDocument {
  schemaVersion: 3
  id: string
  title: string
  createdAt: string
  pageCount: number
  pages: ScanPage[]
  /** Applies to every page that does not override it. */
  filter?: DocumentFilter
  /** Set when this document was produced by merging others. */
  sourceDocumentIds?: string[]
}

/** The Fase 1 shape, still on Boss Ali's device. */
interface LegacyScanDocumentV1 {
  id: string
  title: string
  createdAt: string
  pageCount: number
  pagePaths: string[]
}

type UnknownDocument = Partial<LocalScanDocument> & Partial<LegacyScanDocumentV1>

function isV1(doc: UnknownDocument): boolean {
  return typeof doc.schemaVersion !== 'number' && Array.isArray(doc.pagePaths)
}

/** Keeps only the fields a page is allowed to carry, dropping anything malformed. */
function migratePage(page: ScanPage): ScanPage {
  return {
    original: page.original,
    ...(typeof page.edited === 'string' ? { edited: page.edited } : {}),
    // A v2 page has neither of these; a v3 page whose stored filter is not one
    // we recognise is treated as having none rather than crashing the list.
    ...(page.filter === 'none' || isDocumentFilter(page.filter) ? { filter: page.filter } : {}),
    ...(typeof page.filtered === 'string' ? { filtered: page.filtered } : {}),
  }
}

/**
 * Brings any stored index entry up to the v3 shape.
 *
 * Documents scanned during Fase 1 were written as `{ pagePaths: string[] }`
 * with no schemaVersion, and Fase 2 documents as v2 with no filters. Both must
 * keep working untouched after this upgrade, so every read runs through here
 * and the result is written back. Malformed entries are dropped rather than
 * crashing the whole list.
 *
 * A v2 document arrives with no filter at all, so it looks exactly as it did
 * before — the upgrade is invisible until the user picks one.
 */
export function migrateScanIndex(raw: unknown): LocalScanDocument[] {
  if (!Array.isArray(raw)) return []

  const migrated: LocalScanDocument[] = []

  for (const entry of raw as UnknownDocument[]) {
    if (!entry || typeof entry.id !== 'string') continue

    let pages: ScanPage[]
    if (isV1(entry) && entry.pagePaths) {
      pages = entry.pagePaths.map((path) => ({ original: path }))
    } else if (Array.isArray(entry.pages)) {
      pages = entry.pages
        .filter((page) => page && typeof page.original === 'string')
        .map(migratePage)
    } else {
      continue
    }

    if (pages.length === 0) continue

    migrated.push({
      schemaVersion: 3,
      id: entry.id,
      title: entry.title ?? 'Dokumen tanpa judul',
      createdAt: entry.createdAt ?? new Date(0).toISOString(),
      pageCount: pages.length,
      pages,
      ...(isDocumentFilter(entry.filter) ? { filter: entry.filter } : {}),
      ...(entry.sourceDocumentIds ? { sourceDocumentIds: entry.sourceDocumentIds } : {}),
    })
  }

  return migrated
}

/**
 * Which filter a page actually renders with: its own exception first, then the
 * document's choice, then none.
 */
export function effectiveFilter(
  doc: Pick<LocalScanDocument, 'filter'>,
  page: ScanPage,
): DocumentFilter | null {
  if (page.filter === 'none') return null
  if (page.filter) return page.filter
  return doc.filter ?? null
}

/**
 * Resolves which file a page should currently display/export.
 *
 * Every consumer — the document list, the editor, export, merge, backup —
 * goes through here, which is why adding filters needed no change in any of
 * them.
 */
export function resolvePage(page: ScanPage): string {
  return page.filtered ?? page.edited ?? page.original
}

/** What a filter render must start from: geometry only, never another filter. */
export function filterSource(page: ScanPage): string {
  return page.edited ?? page.original
}

/** True when at least one page carries an edit that can be reverted. */
export function hasEdits(doc: LocalScanDocument): boolean {
  return doc.pages.some((page) => page.edited !== undefined)
}
