import { checkMergeAllowed, type MergeCheck } from './exportLimits'
import { createDocumentFromPages, resolvePage, type LocalScanDocument } from './scanStorage'
import type { Tier } from './tier'

export interface MergePlan {
  pageCount: number
  check: MergeCheck
}

/**
 * Works out how big a merge would be and whether the tier permits it.
 * Pure, so the screen can call it on every checkbox tick to keep the
 * counter and the disabled state honest without touching storage.
 */
export function planMerge(docs: LocalScanDocument[], tier: Tier): MergePlan {
  const pageCount = docs.reduce((total, doc) => total + doc.pages.length, 0)
  return { pageCount, check: checkMergeAllowed(tier, pageCount) }
}

/** Default title: the first document's name plus how many others joined it. */
export function suggestMergeTitle(docs: LocalScanDocument[]): string {
  if (docs.length === 0) return 'Dokumen Gabungan'
  if (docs.length === 1) return docs[0].title
  return `${docs[0].title} +${docs.length - 1}`
}

/**
 * Merges documents in the order given. Pages are copied — not referenced —
 * so deleting a source document afterwards cannot break the result.
 *
 * Edited pages are carried over in their edited form, which is what the
 * user sees on screen and therefore what they expect to be merged.
 */
export async function mergeDocuments(
  docs: LocalScanDocument[],
  tier: Tier,
  title?: string,
): Promise<LocalScanDocument> {
  if (docs.length < 2) {
    throw new Error('Pilih minimal dua dokumen untuk digabungkan.')
  }

  const plan = planMerge(docs, tier)
  if (!plan.check.allowed) {
    throw new Error(plan.check.reason ?? 'Gabungan melebihi batas tier.')
  }

  const sources = docs.flatMap((doc) =>
    doc.pages.map((page) => ({ pagePath: resolvePage(page) })),
  )

  return createDocumentFromPages(
    sources,
    title ?? suggestMergeTitle(docs),
    docs.map((doc) => doc.id),
  )
}
