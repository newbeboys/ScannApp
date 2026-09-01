/**
 * Cron-triggered, not user-triggered: pg_cron calls this daily at 03:00 via
 * pg_net (see migration in Task 5). Auth is a shared secret header, not a
 * Supabase JWT, so this deliberately does not use `_shared/http.ts`'s
 * `handler()` (which requires one) — same reasoning as `admin-set-r2-cors`.
 *
 * Deletes nothing on its own the first time it runs: `CLEANUP_ORPHAN_R2_DRY_RUN`
 * defaults to dry-run (see `resolveDryRun`), and stays that way until it is
 * set to the exact literal `"false"` in Edge Function Secrets after a few
 * days of reviewing the logged candidates. See
 * docs/superpowers/specs/2026-09-01-fase9-cleanup-orphan-r2-design.md.
 */
import { serviceClient } from '../_shared/http.ts'
import {
  planCleanup,
  resolveDryRun,
  verifyCronSecret,
  type CleanupPlan,
} from '../_shared/orphanCleanup.ts'
import { deleteObject, listObjects } from '../_shared/r2.ts'
import type { ListedR2Object } from '../_shared/r2ListParser.ts'

const USERS_PREFIX = 'users/'
/** Generous headroom over any bucket size this app will have for a long
 *  while; a real guard against a pagination bug looping forever, not a
 *  limit meant to ever actually bind. */
const MAX_LIST_PAGES = 1000

async function listAllObjects(): Promise<{ objects: ListedR2Object[]; truncatedAtCap: boolean }> {
  const objects: ListedR2Object[] = []
  let continuationToken: string | undefined
  let pages = 0

  do {
    const page = await listObjects(USERS_PREFIX, continuationToken)
    objects.push(...page.objects)
    continuationToken = page.isTruncated ? (page.nextContinuationToken ?? undefined) : undefined
    pages += 1
  } while (continuationToken && pages < MAX_LIST_PAGES)

  return { objects, truncatedAtCap: Boolean(continuationToken) }
}

async function deleteCandidates(
  plan: CleanupPlan,
): Promise<{ deletedCount: number; deleteFailures: string[] }> {
  const deleteFailures: string[] = []
  let deletedCount = 0

  for (const candidate of plan.candidates) {
    try {
      await deleteObject(candidate.key)
      deletedCount += 1
    } catch (caught) {
      console.error(`Gagal menghapus ${candidate.key}:`, caught)
      deleteFailures.push(candidate.key)
    }
  }

  return { deletedCount, deleteFailures }
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
    const { data: rows, error } = await db
      .from('scan_documents')
      .select('r2_object_key')
      .not('r2_object_key', 'is', null)

    if (error) {
      console.error('Gagal membaca scan_documents:', error)
      return new Response(JSON.stringify({ error: 'DB_ERROR' }), { status: 500 })
    }

    const referencedKeys = new Set((rows ?? []).map((row) => row.r2_object_key as string))
    const { objects: listed, truncatedAtCap } = await listAllObjects()

    if (truncatedAtCap) {
      console.warn(
        JSON.stringify({ event: 'LIST_TRUNCATED_AT_CAP', pages: MAX_LIST_PAGES, listedSoFar: listed.length }),
      )
    }

    const dryRunRequested = resolveDryRun(Deno.env.get('CLEANUP_ORPHAN_R2_DRY_RUN'))
    const plan = planCleanup(listed, referencedKeys, new Date(), dryRunRequested)

    for (const candidate of plan.candidates) {
      console.log(
        JSON.stringify({
          event: 'orphan_candidate',
          key: candidate.key,
          sizeBytes: candidate.size,
          ageHours: Math.round((Date.now() - candidate.lastModified.getTime()) / 3_600_000),
        }),
      )
    }

    if (plan.safetyValveTripped) {
      console.warn(
        JSON.stringify({
          event: 'SAFETY_VALVE_TRIPPED',
          candidateCount: plan.candidates.length,
          totalListed: plan.totalListed,
        }),
      )
    }

    const { deletedCount, deleteFailures } = plan.shouldDelete
      ? await deleteCandidates(plan)
      : { deletedCount: 0, deleteFailures: [] as string[] }

    return new Response(
      JSON.stringify({
        dryRunRequested,
        safetyValveTripped: plan.safetyValveTripped,
        deletionsPerformed: plan.shouldDelete,
        totalListed: plan.totalListed,
        candidateCount: plan.candidates.length,
        candidateBytes: plan.candidateBytes,
        deletedCount,
        deleteFailures,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (caught) {
    console.error(caught)
    return new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), { status: 500 })
  }
})
