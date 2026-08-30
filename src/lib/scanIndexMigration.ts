import { sanitizeMarks, type Mark } from './annotations'

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
  /**
   * The lighting-corrected render, derived from `edited ?? original`.
   *
   * A stage of its own rather than a sixth filter, so it can be used together
   * with one — Hitam-Putih on a shadowed page is exactly where it earns its
   * place (design doc Fase 7A, Bagian 3). Only ever present while the
   * document's `enhance` switch is on.
   */
  enhanced?: string
  /** This page's exception to the document filter. Absent means it follows the document. */
  filter?: PageFilter
  /** The rendered filter result, derived from `enhanced ?? edited ?? original`. */
  filtered?: string
  /**
   * What the user has drawn on this page (Pro). Vectors, not pixels — see the
   * annotate design doc, Bagian 2.1.
   */
  marks?: Mark[]
  /** The rendered composite of `filtered ?? enhanced ?? edited ?? original` plus `marks`. */
  annotated?: string
  /**
   * Path to this page's recognised text, laid out in page fractions (Pro).
   *
   * A path rather than the layout itself: a dense page holds some five hundred
   * words, so a twenty-page document would put hundreds of kilobytes of JSON
   * into the index — parsed on every app start just to draw the document list.
   * The filter and annotation renders live as files for the same reason.
   */
  text?: string
}

/**
 * The shape `migrateScanIndex` produces.
 *
 * Exported so the reader can tell a stored index apart from a current one
 * without repeating the number. When this was written by hand in two places,
 * raising it in one and not the other made every read rewrite the index — see
 * the test in `scanStorageSave.test.ts`.
 */
export const CURRENT_SCHEMA_VERSION = 6

export interface LocalScanDocument {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION
  id: string
  title: string
  createdAt: string
  pageCount: number
  pages: ScanPage[]
  /** Applies to every page that does not override it. */
  filter?: DocumentFilter
  /**
   * Whether "Perbaiki Pencahayaan" is on for this document. Every tier — there
   * is deliberately no tier check anywhere on this path (CLAUDE.md Bagian 6).
   */
  enhance?: boolean
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
function migratePage(page: ScanPage, enhanceOn: boolean): ScanPage {
  const marks = sanitizeMarks(page.marks)

  return {
    original: page.original,
    ...(typeof page.edited === 'string' ? { edited: page.edited } : {}),
    /*
      Paired with the document's switch, the way the annotated render is paired
      with its marks: a page that keeps a lighting render after the switch is
      off would display and export a correction that nothing left in the index
      can explain, undo, or re-render.
    */
    ...(enhanceOn && typeof page.enhanced === 'string' ? { enhanced: page.enhanced } : {}),
    // A v2 page has neither of these; a v3 page whose stored filter is not one
    // we recognise is treated as having none rather than crashing the list.
    ...(page.filter === 'none' || isDocumentFilter(page.filter) ? { filter: page.filter } : {}),
    ...(typeof page.filtered === 'string' ? { filtered: page.filtered } : {}),
    ...(marks.length > 0 ? { marks } : {}),
    /*
      The annotated render is only kept while the marks that produced it
      survive. Without that pairing, a page whose marks were dropped as
      malformed would keep displaying and exporting ink that nothing left in
      the index can explain, undo, or re-render — the file would outlive every
      trace of what put it there.
    */
    ...(marks.length > 0 && typeof page.annotated === 'string'
      ? { annotated: page.annotated }
      : {}),
    // A v4 page simply has none. Unlike the annotated render, this is not
    // paired with anything: recognised text stands on its own, and the page
    // image it was read from is still there whatever else was dropped.
    ...(typeof page.text === 'string' ? { text: page.text } : {}),
  }
}

/**
 * Brings any stored index entry up to the v6 shape.
 *
 * Documents scanned during Fase 1 were written as `{ pagePaths: string[] }`
 * with no schemaVersion, Fase 2 documents as v2 with no filters, and v3
 * documents with no annotations. All three must keep working untouched after
 * this upgrade, so every read runs through here and the result is written
 * back. Malformed entries are dropped rather than crashing the whole list.
 *
 * A v5 document arrives with no lighting stage at all, which is exactly how a
 * document whose switch has never been turned on looks anyway.
 *
 * Each older shape arrives simply missing the newer fields, so it looks
 * exactly as it did before — every upgrade is invisible until the user uses
 * the feature that added it.
 */
export function migrateScanIndex(raw: unknown): LocalScanDocument[] {
  if (!Array.isArray(raw)) return []

  const migrated: LocalScanDocument[] = []

  for (const entry of raw as UnknownDocument[]) {
    if (!entry || typeof entry.id !== 'string') continue

    const enhanceOn = entry.enhance === true

    let pages: ScanPage[]
    if (isV1(entry) && entry.pagePaths) {
      pages = entry.pagePaths.map((path) => ({ original: path }))
    } else if (Array.isArray(entry.pages)) {
      pages = entry.pages
        .filter((page) => page && typeof page.original === 'string')
        .map((page) => migratePage(page, enhanceOn))
    } else {
      continue
    }

    if (pages.length === 0) continue

    migrated.push({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: entry.id,
      title: entry.title ?? 'Dokumen tanpa judul',
      createdAt: entry.createdAt ?? new Date(0).toISOString(),
      pageCount: pages.length,
      pages,
      ...(isDocumentFilter(entry.filter) ? { filter: entry.filter } : {}),
      ...(enhanceOn ? { enhance: true } : {}),
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
 * goes through here, which is why adding filters, and later the lighting
 * stage, needed no change in any of them.
 */
export function resolvePage(page: ScanPage): string {
  return page.annotated ?? page.filtered ?? page.enhanced ?? page.edited ?? page.original
}

/**
 * What a filter render must start from: the page with its geometry and its
 * lighting settled, never another filter.
 *
 * Reading the lighting render here is what makes the two stack — Hitam-Putih
 * applied to a page whose shadows have already been flattened, which is the
 * whole point of keeping them separate.
 */
export function filterSource(page: ScanPage): string {
  return page.enhanced ?? page.edited ?? page.original
}

/**
 * What a lighting render must start from: geometry only.
 *
 * Never the filter render — correcting a thresholded page means estimating the
 * light on an image that has already thrown its greys away — and never its own
 * previous output, which would compound the correction every time.
 */
export function enhanceSource(page: ScanPage): string {
  return page.edited ?? page.original
}

/**
 * What an annotation render must start from: the paper, without the previous
 * render of the ink. Reading the annotated file back would draw every stroke a
 * second time on top of itself, and undo would never remove anything.
 */
export function annotationSource(page: ScanPage): string {
  return page.filtered ?? page.enhanced ?? page.edited ?? page.original
}

/** True when at least one page carries an edit that can be reverted. */
export function hasEdits(doc: LocalScanDocument): boolean {
  return doc.pages.some((page) => page.edited !== undefined)
}

/** How many marks a page is carrying — 0 when it has never been annotated. */
export function markCount(page: ScanPage): number {
  return page.marks?.length ?? 0
}
