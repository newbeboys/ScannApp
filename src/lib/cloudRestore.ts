import { downloadBackupBytes, type CloudBackup } from './backupApi'
import { readBackup } from './pdfImport'
import { restoreDocumentFromJpegs, type LocalScanDocument } from './scanStorage'

/**
 * Brings a document back from the cloud onto this phone.
 *
 * The return leg of the backup round trip: download the PDF, take the pages
 * back out of it, and write them into local storage under the identity the
 * cloud already has. What comes out is an ordinary document — openable,
 * editable, mergeable, exportable — not a read-only copy of a file.
 *
 * Nothing touches the disk until the download has arrived and parsed, so a
 * failure at either step leaves the phone exactly as it was.
 */
export async function restoreBackup(backup: CloudBackup): Promise<LocalScanDocument> {
  const pdf = await downloadBackupBytes(backup.id)
  const { pages, scannedAt } = await readBackup(pdf)

  return restoreDocumentFromJpegs(
    {
      id: backup.id,
      title: backup.title,
      // The file remembers when it was scanned; the database row only
      // remembers when it was first backed up. Prefer the file, and fall back
      // to the row for anything backed up before we started stamping it.
      createdAt: scannedAt ?? backup.createdAt,
    },
    pages,
  )
}
