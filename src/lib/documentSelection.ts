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
