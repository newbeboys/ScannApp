export interface ScanPage {
  /** Untouched scanner output. Never overwritten, so "reset to original" always works. */
  original: string
  /** Present once the page has been cropped/rotated. */
  edited?: string
}

export interface LocalScanDocument {
  schemaVersion: 2
  id: string
  title: string
  createdAt: string
  pageCount: number
  pages: ScanPage[]
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
  return doc.schemaVersion !== 2 && Array.isArray(doc.pagePaths)
}

/**
 * Brings any stored index entry up to the v2 shape.
 *
 * Documents scanned during Fase 1 were written as `{ pagePaths: string[] }`
 * with no schemaVersion. Those must keep working untouched after this
 * upgrade, so every read runs through here and the result is written back.
 * Malformed entries are dropped rather than crashing the whole list.
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
      pages = entry.pages.filter((page) => page && typeof page.original === 'string')
    } else {
      continue
    }

    if (pages.length === 0) continue

    migrated.push({
      schemaVersion: 2,
      id: entry.id,
      title: entry.title ?? 'Dokumen tanpa judul',
      createdAt: entry.createdAt ?? new Date(0).toISOString(),
      pageCount: pages.length,
      pages,
      ...(entry.sourceDocumentIds ? { sourceDocumentIds: entry.sourceDocumentIds } : {}),
    })
  }

  return migrated
}

/** Resolves which file a page should currently display/export: the edit if any, else the original. */
export function resolvePage(page: ScanPage): string {
  return page.edited ?? page.original
}

/** True when at least one page carries an edit that can be reverted. */
export function hasEdits(doc: LocalScanDocument): boolean {
  return doc.pages.some((page) => page.edited !== undefined)
}
