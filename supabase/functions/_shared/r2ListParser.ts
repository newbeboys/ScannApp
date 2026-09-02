/**
 * Parses the XML body of an S3-compatible `ListObjectsV2` response.
 *
 * A hand-rolled regex parser rather than a real XML library: every key this
 * bucket ever produces matches `users/{uuid}/{uuid}.pdf` (see
 * `storageKey.ts`), which never contains an XML metacharacter, so there is
 * nothing here a real parser would handle differently — and it is one fewer
 * dependency in a function with no Deno APIs, kept free of them so the same
 * Vitest suite that runs in CI covers it.
 */

export interface ListedR2Object {
  key: string
  size: number
  lastModified: Date
}

export interface ListObjectsPage {
  objects: ListedR2Object[]
  isTruncated: boolean
  nextContinuationToken: string | null
}

const CONTENTS_BLOCK = /<Contents>([\s\S]*?)<\/Contents>/g
const FIELD = (tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`)

function parseContentsBlock(block: string): ListedR2Object | null {
  const key = FIELD('Key').exec(block)?.[1]
  const sizeRaw = FIELD('Size').exec(block)?.[1]
  const lastModifiedRaw = FIELD('LastModified').exec(block)?.[1]

  if (!key || sizeRaw === undefined || !lastModifiedRaw) return null

  const size = Number(sizeRaw)
  const lastModified = new Date(lastModifiedRaw)
  if (!Number.isFinite(size) || Number.isNaN(lastModified.getTime())) return null

  return { key, size, lastModified }
}

export function parseListObjectsXml(xml: string): ListObjectsPage {
  const objects: ListedR2Object[] = []

  for (const match of xml.matchAll(CONTENTS_BLOCK)) {
    const parsed = parseContentsBlock(match[1])
    if (parsed) objects.push(parsed)
  }

  return {
    objects,
    isTruncated: /<IsTruncated>true<\/IsTruncated>/.test(xml),
    nextContinuationToken: FIELD('NextContinuationToken').exec(xml)?.[1] ?? null,
  }
}
