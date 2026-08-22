/** Object layout in the `scanappstorage` bucket: one PDF per document. */

const SAFE_SEGMENT = /^[A-Za-z0-9-]+$/

function assertSafe(value: string, label: string): void {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(`${label} tidak valid.`)
  }
}

/**
 * Every object lives under its owner's prefix. Ids are validated rather than
 * escaped so a crafted document id can never walk out of that prefix and reach
 * another user's files.
 */
export function buildObjectKey(userId: string, documentId: string): string {
  assertSafe(userId, 'user id')
  assertSafe(documentId, 'document id')

  return `users/${userId}/${documentId}.pdf`
}

/** Second line of defence before signing or deleting a key from the database. */
export function isOwnedBy(objectKey: string, userId: string): boolean {
  return objectKey.startsWith(`users/${userId}/`)
}
