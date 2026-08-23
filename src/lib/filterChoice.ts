import type { DocumentFilter, PageFilter } from './scanIndexMigration'

/** Whether the picker is setting the whole document or just the open page. */
export type FilterScope = 'document' | 'page'

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
