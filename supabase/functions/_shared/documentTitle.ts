/** Longest title we store. Matches the column and keeps list rows sane. */
export const MAX_TITLE_LENGTH = 200

/** Shown when the user clears the name entirely rather than typing one. */
export const DEFAULT_TITLE = 'Dokumen'

/**
 * Normalises a user-supplied document title.
 *
 * Shared by confirm-upload and rename-document on purpose: if the two ever
 * disagreed, renaming a document could store a title that backing it up would
 * immediately rewrite, and the cloud list would flip between two spellings.
 *
 * Newlines are collapsed because the title is rendered on a single line and is
 * also used to build the export filename — a stray line break there produces a
 * file the user cannot find.
 */
export function normalizeDocumentTitle(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_TITLE

  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (collapsed === '') return DEFAULT_TITLE

  // Sliced by code point, not by UTF-16 unit. String.slice would cut an emoji
  // sitting on the boundary in half and leave a lone surrogate, which Postgres
  // rejects outright — the rename would then fail in the cloud with nothing on
  // screen to explain why. (A ZWJ sequence can still be split into its
  // component emoji; that renders fine and stores fine, so it is left alone.)
  return [...collapsed].slice(0, MAX_TITLE_LENGTH).join('').trim()
}
