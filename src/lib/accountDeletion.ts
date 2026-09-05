import { callFunction } from './edgeFunctionClient'

/**
 * Client half of the account deletion flow. The grace period is the same 7
 * days the Edge Functions enforce (CLAUDE.md Bagian 6) — this copy only ever
 * decides what the banner says, never whether an account actually goes.
 */
export const GRACE_PERIOD_DAYS = 7

const MS_PER_DAY = 86_400_000

/** What `request-account-deletion` answers with. */
export interface DeletionSchedule {
  requestedAt: string
  /** ISO timestamp the purge becomes due — `requestedAt` plus 7 days. */
  deletionScheduledAt: string
  /** True when a request was already pending, so nothing was rescheduled. */
  alreadyRequested: boolean
}

interface DeletionResponse {
  requested_at?: string
  deletion_scheduled_at?: string
  already_requested?: boolean
}

/**
 * When the purge falls due for a request stamped at `requestedAt`.
 * Null for anything that is not a usable timestamp, including no request.
 */
export function deletionDueAt(requestedAt: string | null | undefined): Date | null {
  if (!requestedAt) return null

  const parsed = Date.parse(requestedAt)
  if (Number.isNaN(parsed)) return null

  return new Date(parsed + GRACE_PERIOD_DAYS * MS_PER_DAY)
}

/**
 * Whole days left before the account is purged, rounded up so the last partial
 * day still reads as "1 hari". Null when no deletion is pending; 0 once the
 * grace period has run out and the nightly job simply has not fired yet.
 */
export function daysUntilDeletion(
  requestedAt: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const dueAt = deletionDueAt(requestedAt)
  if (!dueAt) return null

  return Math.max(0, Math.ceil((dueAt.getTime() - now.getTime()) / MS_PER_DAY))
}

/** Banner wording. Kept here so the count and the sentence cannot drift apart. */
export function deletionBannerText(
  requestedAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const days = daysUntilDeletion(requestedAt, now)
  if (days === null) return null

  if (days === 0) return 'Akun ini akan dihapus permanen hari ini.'
  if (days === 1) return 'Akun ini akan dihapus permanen besok.'

  return `Akun ini akan dihapus permanen dalam ${days} hari.`
}

/**
 * Asks the server to start the grace period.
 *
 * Throws with the server's own Indonesian message when the account still has a
 * live Play Store subscription — that message names the exact steps to cancel,
 * so callers should show it as-is rather than substituting their own.
 */
export async function requestAccountDeletion(): Promise<DeletionSchedule> {
  const response = await callFunction<DeletionResponse>('request-account-deletion', {})

  const requestedAt = response.requested_at ?? new Date().toISOString()

  return {
    requestedAt,
    deletionScheduledAt:
      response.deletion_scheduled_at ?? (deletionDueAt(requestedAt)?.toISOString() ?? requestedAt),
    alreadyRequested: response.already_requested === true,
  }
}

/** Calls off a pending deletion. Safe to repeat — the server is idempotent. */
export async function cancelAccountDeletion(): Promise<void> {
  await callFunction<{ status?: string }>('cancel-account-deletion', {})
}
