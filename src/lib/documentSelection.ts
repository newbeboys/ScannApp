import type { DocumentEntry } from './documentEntries'
import type { LocalScanDocument } from './scanStorage'

/**
 * How long a finger has to rest on a row before it becomes a selection.
 *
 * Exported so the component test can wait exactly this long rather than
 * guessing, and so the value has one definition rather than two.
 */
export const LONG_PRESS_MS = 450

/** Movement past this many pixels is a scroll, not a press. */
export const LONG_PRESS_MOVE_PX = 10

/**
 * Only documents that are on this phone can take part in a bulk action — a
 * cloud row has no page files here, so there is nothing to export and nothing
 * to delete.
 */
export function isSelectable(entry: DocumentEntry): boolean {
  return entry.kind === 'local'
}

/** Adds or removes one id, never mutating the array it was handed. */
export function toggleSelection(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]
}

/** Every row a bulk action can actually touch, in the order the list shows them. */
export function selectableIds(entries: DocumentEntry[]): string[] {
  return entries.filter(isSelectable).map((entry) => entry.id)
}

/**
 * Whether everything that *can* be ticked already is.
 *
 * Cloud rows are left out of the question entirely — they can never be ticked,
 * so counting them would leave "Semua" claiming there is more to select when
 * there is not.
 */
export function isAllSelected(entries: DocumentEntry[], selected: string[]): boolean {
  const ids = selectableIds(entries)
  return ids.length > 0 && ids.every((id) => selected.includes(id))
}

/**
 * What the header's "Semua" button hands back: everything, or nothing.
 *
 * One button rather than two. Ticking ten documents one at a time is ten taps
 * and the reason this exists (diminta Boss Ali 25 Agustus 2026); untick-all is
 * the same need in reverse, and the label follows the state.
 */
export function toggleSelectAll(entries: DocumentEntry[], selected: string[]): string[] {
  return isAllSelected(entries, selected) ? [] : selectableIds(entries)
}

export interface SelectionSummary {
  count: number
  pageCount: number
  /** In the order the user selected them. */
  documents: LocalScanDocument[]
}

/**
 * Resolves selected ids against the list as it stands right now.
 *
 * Ids that no longer resolve are dropped rather than trusted: the list
 * refreshes underneath the selection whenever a backup lands or a delete
 * finishes, and handing a stale id to the exporter would put a hole in the
 * array it iterates.
 */
export function summarizeSelection(
  entries: DocumentEntry[],
  selected: string[],
): SelectionSummary {
  const onPhone = new Map(
    entries.flatMap((entry) =>
      entry.kind === 'local' ? [[entry.id, entry.document] as const] : [],
    ),
  )

  const documents = selected.flatMap((id) => {
    const document = onPhone.get(id)
    return document ? [document] : []
  })

  return {
    count: documents.length,
    pageCount: documents.reduce((sum, document) => sum + document.pageCount, 0),
    documents,
  }
}
