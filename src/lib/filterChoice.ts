import {
  effectiveFilter,
  type DocumentFilter,
  type LocalScanDocument,
  type PageFilter,
  type ScanPage,
} from './scanIndexMigration'

/** Whether the picker is setting the whole document or just the open page. */
export type FilterScope = 'document' | 'page'

/**
 * Which chip should read as chosen.
 *
 * It has to answer for the scope the chips are about to act on. Always
 * answering with the open page's effective filter lit "Asli" whenever that
 * page carried a `'none'` exception, even while the document itself was
 * black-and-white — so the picker claimed the document was unfiltered, and
 * tapping that apparently inert chip cleared the filter from every other page.
 */
export function activeChip(
  scope: FilterScope,
  doc: Pick<LocalScanDocument, 'filter'>,
  page: ScanPage,
): DocumentFilter | null {
  return scope === 'document' ? (doc.filter ?? null) : effectiveFilter(doc, page)
}

/**
 * Turns "the user tapped this chip" into what should actually be stored.
 *
 * The same chip means two different things depending on the scope, and the
 * difference is easy to get subtly wrong: tapping "Asli" for the document
 * clears its filter, while tapping it for one page sets that page's exception
 * to `'none'` — deliberately plain, rather than falling back to whatever the
 * document says.
 */
export function pickToChoice(
  pick: DocumentFilter | 'none' | null,
  scope: FilterScope,
): { document: DocumentFilter | null } | { page: PageFilter | null } {
  if (scope === 'document') {
    return { document: pick === 'none' || pick === null ? null : pick }
  }
  return { page: pick }
}
