import type { Tier } from './tier'

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

  // A lone document is an ordinary save wearing a different button; numbering
  // it "(1)" would label something that has no "(2)".
  if (count === 1 && startAt === 0) return [trimmed]

  return Array.from({ length: count }, (_, index) => `${trimmed} (${startAt + index + 1})`)
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
