/**
 * Pure decision logic for the orphan-R2-object cleanup job. No Deno APIs, no
 * network — the Vitest `node` suite covers every branch here; the I/O shell
 * around it (`cleanup-orphan-r2/index.ts`) is proven live in `LOG_ONLY` mode
 * instead, the same split every other `_shared/*.ts` module in this project
 * uses.
 */
import { constantTimeEqual } from './constantTimeEqual.ts'
import type { ListedR2Object } from './r2ListParser.ts'

/** An object younger than this might still be mid-upload; never touch it. */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000

/** Above this fraction of candidates-to-total, something is probably a bug. */
export const SAFETY_VALVE_RATIO = 0.5

/**
 * The valve only engages once there is enough data for a ratio to mean
 * anything — otherwise a bucket with three objects, all legitimately
 * orphaned, would trip it forever at 100% and never clean up.
 */
export const SAFETY_VALVE_MIN_CANDIDATES = 20

export interface CleanupPlan {
  candidates: ListedR2Object[]
  candidateBytes: number
  totalListed: number
  safetyValveTripped: boolean
  /** Whether this run is actually cleared to delete, dry-run setting and
   *  safety valve both folded in. */
  shouldDelete: boolean
}

export function planCleanup(
  listed: ListedR2Object[],
  referencedKeys: ReadonlySet<string>,
  now: Date,
  dryRunRequested: boolean,
): CleanupPlan {
  const candidates = listed.filter(
    (object) =>
      !referencedKeys.has(object.key) &&
      now.getTime() - object.lastModified.getTime() >= ORPHAN_MIN_AGE_MS,
  )

  const candidateBytes = candidates.reduce((sum, object) => sum + object.size, 0)
  const totalListed = listed.length

  const safetyValveTripped =
    candidates.length >= SAFETY_VALVE_MIN_CANDIDATES &&
    candidates.length / totalListed > SAFETY_VALVE_RATIO

  return {
    candidates,
    candidateBytes,
    totalListed,
    safetyValveTripped,
    shouldDelete: !dryRunRequested && !safetyValveTripped,
  }
}

/** Only the exact literal `"false"` turns real deletion on; anything else — unset, `"true"`, a typo — stays safe. */
export function resolveDryRun(rawEnvValue: string | undefined): boolean {
  return rawEnvValue !== 'false'
}

/** Cron's only credential: a shared secret header, not a user JWT. */
export function verifyCronSecret(headerValue: string | null, expectedSecret: string): boolean {
  if (!headerValue) return false
  return constantTimeEqual(headerValue, expectedSecret)
}
