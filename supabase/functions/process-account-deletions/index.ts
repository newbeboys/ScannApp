/**
 * Daily purge of accounts whose 7-day grace period has run out.
 *
 * Cron-triggered, not user-triggered: pg_cron calls this via pg_net (see
 * migration 20260905130000). Auth is a shared secret header, not a Supabase
 * JWT, so this deliberately does not use `_shared/http.ts`'s `handler()` —
 * same reasoning as `cleanup-orphan-r2` and `admin-set-r2-cors`.
 *
 * Kept as its own job rather than folded into `expire-pro-status`: a failure
 * in one must not stop the other from running (TASKS.md, Fase 8.5).
 *
 * BACKEND_API_DESIGN.md Bagian 13.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { purgeCutoff } from '../_shared/accountDeletion.ts'
import { serviceClient } from '../_shared/http.ts'
import { verifyCronSecret } from '../_shared/orphanCleanup.ts'
import { deleteObject } from '../_shared/r2.ts'

/**
 * Ceiling on accounts purged in one run. Deleting an account is a handful of
 * round trips to R2 plus one to the Admin API, and the Edge Function has a
 * wall clock; anything left over is picked up by tomorrow's run, one day late
 * at worst. Better a short delay than a run that dies halfway with no record
 * of where it stopped.
 */
const MAX_USERS_PER_RUN = 50

/** PostgREST silently truncates an unbounded select at 1000 rows. */
const DB_PAGE_SIZE = 1000

/** Enough parallelism to keep a big account quick, not enough to look abusive. */
const DELETE_CONCURRENCY = 10

interface DueProfile {
  id: string
  deletion_requested_at: string
}

interface UserOutcome {
  userId: string
  status: 'deleted' | 'already_gone' | 'failed'
  objectsDeleted: number
  referralRowsAnonymised: number
  reason?: string
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/** Every R2 key still referenced by this user's documents. */
async function fetchObjectKeys(db: SupabaseClient, userId: string): Promise<string[]> {
  const keys: string[] = []
  let offset = 0

  while (true) {
    const { data: rows, error } = await db
      .from('scan_documents')
      .select('r2_object_key')
      .eq('owner_id', userId)
      .not('r2_object_key', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + DB_PAGE_SIZE - 1)

    if (error) throw error

    for (const row of rows ?? []) keys.push(row.r2_object_key as string)
    if (!rows || rows.length < DB_PAGE_SIZE) break
    offset += DB_PAGE_SIZE
  }

  return keys
}

/** Deletes the user's backups from R2, reporting every key that would not go. */
async function deleteBackups(keys: string[]): Promise<{ deleted: number; failures: string[] }> {
  const failures: string[] = []
  let deleted = 0

  for (const batch of chunk(keys, DELETE_CONCURRENCY)) {
    const results = await Promise.allSettled(batch.map((key) => deleteObject(key)))

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        deleted += 1
      } else {
        console.error(`Gagal menghapus object R2 ${batch[index]}:`, result.reason)
        failures.push(batch[index])
      }
    })
  }

  return { deleted, failures }
}

/**
 * Drops the pointers to this user out of `referral_events` without touching
 * the rows themselves.
 *
 * The rows describe a relationship between two people, and the other one is
 * still here: deleting them would erase the proof behind rewards that have
 * already been paid out (`reward_granted = true`) and let
 * `unclaimedMilestones()` grant those milestones a second time.
 */
async function anonymiseReferrals(db: SupabaseClient, userId: string): Promise<number> {
  const { data: asReferrer, error: referrerError } = await db
    .from('referral_events')
    .update({ referrer_id: null })
    .eq('referrer_id', userId)
    .select('id')

  if (referrerError) throw referrerError

  const { data: asReferred, error: referredError } = await db
    .from('referral_events')
    .update({ referred_id: null })
    .eq('referred_id', userId)
    .select('id')

  if (referredError) throw referredError

  return (asReferrer?.length ?? 0) + (asReferred?.length ?? 0)
}

/**
 * Removes the `auth.users` row, which cascades to `profiles` and from there to
 * `storage_usage`, `scan_documents`, and `referral_milestone_grants` (see
 * migration 20260905120000).
 *
 * A user who is already gone counts as success — that is what keeps a re-run
 * after a half-finished batch from erroring out.
 */
async function deleteAuthUser(
  db: SupabaseClient,
  userId: string,
): Promise<'deleted' | 'already_gone'> {
  const { error } = await db.auth.admin.deleteUser(userId)
  if (!error) return 'deleted'

  const status = (error as { status?: number }).status
  if (status === 404 || /not.?found/i.test(error.message)) return 'already_gone'

  throw error
}

async function purgeUser(db: SupabaseClient, userId: string): Promise<UserOutcome> {
  const base = { userId, objectsDeleted: 0, referralRowsAnonymised: 0 }

  let keys: string[]
  try {
    keys = await fetchObjectKeys(db, userId)
  } catch (caught) {
    return { ...base, status: 'failed', reason: `Gagal membaca scan_documents: ${caught}` }
  }

  const { deleted, failures } = await deleteBackups(keys)

  /*
    Order matters, and this is the guard that enforces it. Removing the auth
    row cascades `scan_documents` away, and `r2_object_key` goes with it — the
    only handle left on those objects. Pressing on after a failed R2 delete
    would strand paid-for storage in the bucket with no row anywhere pointing
    at it. Leaving the account intact instead costs one more day of grace and
    lets the next run try again.
  */
  if (failures.length > 0) {
    return {
      ...base,
      objectsDeleted: deleted,
      status: 'failed',
      reason: `${failures.length} object R2 gagal dihapus; akun dibiarkan utuh untuk run berikutnya.`,
    }
  }

  let referralRowsAnonymised: number
  try {
    referralRowsAnonymised = await anonymiseReferrals(db, userId)
  } catch (caught) {
    return {
      ...base,
      objectsDeleted: deleted,
      status: 'failed',
      reason: `Gagal menganonimkan referral_events: ${caught}`,
    }
  }

  try {
    const status = await deleteAuthUser(db, userId)
    return { userId, status, objectsDeleted: deleted, referralRowsAnonymised }
  } catch (caught) {
    return {
      userId,
      objectsDeleted: deleted,
      referralRowsAnonymised,
      status: 'failed',
      reason: `Gagal menghapus auth.users: ${caught}`,
    }
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('CRON_SECRET belum di-set di Edge Function Secrets.')
    return new Response(JSON.stringify({ error: 'NOT_CONFIGURED' }), { status: 500 })
  }

  if (!verifyCronSecret(request.headers.get('x-cron-secret'), cronSecret)) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })
  }

  try {
    const db = serviceClient()
    const cutoff = purgeCutoff(new Date()).toISOString()

    const { data: due, error } = await db
      .from('profiles')
      .select('id, deletion_requested_at')
      .not('deletion_requested_at', 'is', null)
      .lte('deletion_requested_at', cutoff)
      // Oldest request first, so a backlog drains in the order it formed
      // instead of leaving the same unlucky account behind every night.
      .order('deletion_requested_at', { ascending: true })
      .limit(MAX_USERS_PER_RUN)
      .returns<DueProfile[]>()

    if (error) {
      console.error('Gagal membaca profiles yang jatuh tempo:', error)
      return new Response(JSON.stringify({ error: 'DB_ERROR' }), { status: 500 })
    }

    const outcomes: UserOutcome[] = []

    // Sequential on purpose: each account is several R2 deletes plus an Admin
    // API call, and interleaving accounts would only make a partial failure
    // harder to read in the logs.
    for (const profile of due ?? []) {
      const outcome = await purgeUser(db, profile.id)

      console.log(
        JSON.stringify({
          event: 'account_purge',
          ...outcome,
          requestedAt: profile.deletion_requested_at,
        }),
      )

      outcomes.push(outcome)
    }

    const summary = {
      dueCount: due?.length ?? 0,
      deleted: outcomes.filter((outcome) => outcome.status === 'deleted').length,
      alreadyGone: outcomes.filter((outcome) => outcome.status === 'already_gone').length,
      failed: outcomes.filter((outcome) => outcome.status === 'failed').length,
      // Hitting the cap is not an error, but it means there is a backlog —
      // worth seeing in the log before it turns into a pile-up.
      cappedAtLimit: (due?.length ?? 0) === MAX_USERS_PER_RUN,
    }

    console.log(JSON.stringify({ event: 'account_purge_summary', ...summary }))

    return new Response(JSON.stringify({ ...summary, outcomes }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (caught) {
    console.error(caught)
    return new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), { status: 500 })
  }
})
