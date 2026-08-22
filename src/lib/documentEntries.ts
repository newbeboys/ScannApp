import type { CloudBackup } from './backupApi'
import type { LocalScanDocument } from './scanStorage'

/**
 * One row in the document list, from whichever side it came.
 *
 * A `cloud` entry is a document the account owns but this phone does not have
 * yet — after a reinstall, or on a new phone. It carries no page files, so the
 * UI shows it as restorable rather than openable.
 */
export type DocumentEntry =
  | { kind: 'local'; id: string; document: LocalScanDocument }
  | { kind: 'cloud'; id: string; backup: CloudBackup }

/**
 * Builds the list the user actually sees: everything on the phone, plus every
 * backup that is not on the phone, newest first.
 *
 * Storage is still local-first — this changes nothing about where files live.
 * It only stops the list from claiming the account has no documents when the
 * account plainly does.
 *
 * The sort is explicit rather than inherited from the index. Restoring keeps a
 * document's original date but prepends it to the index, so relying on index
 * order would float a month-old scan to the top the moment it came back.
 */
export function mergeDocumentEntries(
  local: LocalScanDocument[],
  backups: CloudBackup[],
): DocumentEntry[] {
  const onPhone = new Set(local.map((doc) => doc.id))

  const entries: DocumentEntry[] = [
    ...local.map((document): DocumentEntry => ({ kind: 'local', id: document.id, document })),
    ...backups
      .filter((backup) => !onPhone.has(backup.id))
      .map((backup): DocumentEntry => ({ kind: 'cloud', id: backup.id, backup })),
  ]

  return entries.sort((a, b) => createdAt(b).localeCompare(createdAt(a)))
}

function createdAt(entry: DocumentEntry): string {
  return entry.kind === 'local' ? entry.document.createdAt : entry.backup.createdAt
}
