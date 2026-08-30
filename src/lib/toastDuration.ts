/**
 * How long a toast stays on screen, based on how much there is to read.
 *
 * Was a flat 2600 ms for every message. That was fine while every message was
 * a short confirmation, but export failures now carry their cause — and the
 * native ones carry a file path with it — so the longest and most important
 * sentences in the app were the ones with the least time to be read. Removing
 * the ellipsis from `.toast` without this would only move the truncation from
 * space into time.
 */

/** The old flat duration, now the floor: short confirmations behave as before. */
export const MIN_TOAST_MS = 2600

/** A toast is not a dialog; past this it is in the way rather than informative. */
export const MAX_TOAST_MS = 10_000

/**
 * Roughly a comfortable reading pace on a phone, plus a fixed moment to notice
 * the toast at all before starting to read it.
 */
const PER_CHARACTER_MS = 55
const NOTICE_MS = 1200

export function toastDurationMs(message: string): number {
  const read = NOTICE_MS + message.length * PER_CHARACTER_MS
  return Math.min(Math.max(read, MIN_TOAST_MS), MAX_TOAST_MS)
}
