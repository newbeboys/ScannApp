import {
  MAX_TITLE_LENGTH,
  normalizeDocumentTitle,
} from '../../supabase/functions/_shared/documentTitle'
import { saveScanDocument, type LocalScanDocument } from './scanStorage'
import type { Tier } from './tier'

/**
 * Room kept for the " (n)" the numbering appends, inside the shared cap.
 *
 * Without it a 200-character name would have its number sliced off again by
 * the normaliser on the way to the cloud, and every document in the batch
 * would end up sharing one title.
 */
const MAX_SPLIT_BASE_LENGTH = MAX_TITLE_LENGTH - 8

/**
 * Splitting one scanning session into several documents.
 *
 * The whole state of the split screen is one set of cut positions: a cut at
 * index `i` means "a new document starts at page i". Everything else — the
 * ready-made patterns, the group headers, the footer count — is derived from
 * that set, so there is only ever one thing to keep correct.
 */

/** Groups page indices around the cuts. Pure; the screen only draws the result. */
export function planSplit(pageCount: number, cuts: readonly number[]): number[][] {
  if (pageCount <= 0) return []

  // Out-of-range and duplicate cuts are dropped rather than trusted. A cut at
  // 0 or past the last page would mint an empty document, and both arrive for
  // real: a half-successful save shrinks the page list underneath the cuts.
  const valid = [...new Set(cuts)]
    .filter((cut) => cut > 0 && cut < pageCount)
    .sort((a, b) => a - b)

  const groups: number[][] = []
  let start = 0
  for (const end of [...valid, pageCount]) {
    groups.push(Array.from({ length: end - start }, (_, offset) => start + offset))
    start = end
  }
  return groups
}

/** Adds or removes one cut, never mutating the array it was handed. */
export function toggleCut(cuts: readonly number[], at: number): number[] {
  return cuts.includes(at)
    ? cuts.filter((cut) => cut !== at)
    : [...cuts, at].sort((a, b) => a - b)
}

/** The ready-made patterns: a cut every `size` pages. */
export function everyNCuts(pageCount: number, size: number): number[] {
  if (size < 1) return []
  const cuts: number[] = []
  for (let at = size; at < pageCount; at += size) cuts.push(at)
  return cuts
}

/**
 * The cuts that separate a list of groups, renumbered from zero.
 *
 * Used after a partial save: the groups that failed become the new page list,
 * so the cuts around them cannot keep their old positions.
 */
export function boundaryCuts(groups: readonly { length: number }[]): number[] {
  const cuts: number[] = []
  let at = 0
  // The last group's end is the end of the list, which is not a cut.
  for (const group of groups.slice(0, -1)) {
    at += group.length
    cuts.push(at)
  }
  return cuts
}

/**
 * One name typed once becomes "Nama (1)", "Nama (2)", …
 *
 * Without it, scanning thirty receipts hands back thirty documents that are
 * identical except for a timestamp, and renaming them is thirty more taps.
 *
 * `startAt` continues the numbering after a partial save, so the retry does
 * not mint a second "Kwitansi (1)" next to the one that already landed.
 */
export function splitTitles(base: string, count: number, startAt = 0): (string | undefined)[] {
  const trimmed = base.trim()

  // Left undefined on purpose: saveScanDocument then falls back to its own
  // "Scan <tanggal>", exactly like saving without splitting.
  if (trimmed.length === 0) return Array.from({ length: count }, () => undefined)

  /*
    Put through the same normaliser as rename and confirm-upload. This field is
    the first place a typed title reaches local storage — saveScanDocument
    stores what it is handed — so without this a name with doubled spaces or
    past the length cap would read one way on the phone and another in the
    cloud the moment the document was backed up. Sliced by code point, like the
    normaliser itself, so an emoji on the boundary is not cut in half.
  */
  const clean = [...normalizeDocumentTitle(trimmed)]
    .slice(0, MAX_SPLIT_BASE_LENGTH)
    .join('')
    .trim()

  // A lone document is an ordinary save wearing a different button; numbering
  // it "(1)" would label something that has no "(2)".
  if (count === 1 && startAt === 0) return [clean]

  return Array.from({ length: count }, (_, index) => `${clean} (${startAt + index + 1})`)
}

/**
 * Splitting into two or more documents is Pro (PRD Bagian 3).
 *
 * Splitting into one is not: that is identical to the Simpan button next to
 * it, which every tier already has. Refusing it would be refusing something
 * already free through the neighbouring door — a bug, not an enforcement.
 */
export function canSplitScan(tier: Tier, groupCount: number): boolean {
  return tier === 'pro' || groupCount <= 1
}

export interface SplitSaveResult {
  saved: LocalScanDocument[]
  /** Groups that did not make it, in their original order. */
  remaining: string[][]
  /** Indonesian, ready for the toast. */
  message: string
}

/**
 * Saves one document per group, sequentially.
 *
 * Sequential rather than parallel for the same reason as the batch export:
 * these are 12 MP JPEGs being read and written, and starting eight at once
 * only makes them compete for the same memory on a phone.
 *
 * The failure rule is the important part. Saving eight documents is eight
 * writes, and the sixth can fail on a full disk. Rolling the whole thing back
 * would throw away five documents that are already safe; closing the screen
 * would take the three unsaved groups down with the scanning session, and a
 * scan that is gone cannot be recovered from anywhere. So: the groups that
 * succeeded leave, the groups that failed stay, and the caller puts them back
 * on screen. `saveScanDocument` already removes its own folder when it fails
 * part way through, so nothing is stranded on disk.
 */
export async function saveSplitScan(
  groups: string[][],
  base: string,
  tier: Tier,
  startAt = 0,
  onProgress?: (done: number, total: number) => void,
): Promise<SplitSaveResult> {
  const usable = groups.filter((group) => group.length > 0)
  if (usable.length === 0) {
    throw new Error('Tidak ada halaman untuk disimpan.')
  }
  // In the library rather than only in the screen: hiding a button is not the
  // same as refusing the action behind it.
  if (!canSplitScan(tier, usable.length)) {
    throw new Error('Memisah hasil pindai jadi beberapa dokumen hanya untuk akun Pro.')
  }

  const titles = splitTitles(base, usable.length, startAt)
  const saved: LocalScanDocument[] = []
  const remaining: string[][] = []

  for (let index = 0; index < usable.length; index++) {
    onProgress?.(index, usable.length)
    try {
      saved.push(await saveScanDocument(usable[index], titles[index]))
    } catch {
      // Counted by staying behind, not thrown: one group that will not save
      // must not take the other seven with it.
      remaining.push(usable[index])
    }
  }
  onProgress?.(usable.length, usable.length)

  return { saved, remaining, message: summarizeSplitSave(saved.length, remaining.length) }
}

/** One sentence for the toast, covering all-saved, partial and nothing-saved. */
export function summarizeSplitSave(saved: number, failed: number): string {
  if (saved === 0) {
    return 'Tidak ada dokumen yang tersimpan. Halamannya masih di sini — coba lagi.'
  }
  if (failed === 0) return `${saved} dokumen tersimpan.`
  return `${saved} dokumen tersimpan, ${failed} gagal. Halamannya masih di sini — coba simpan lagi.`
}
