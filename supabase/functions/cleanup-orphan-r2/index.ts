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
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
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

/**
 * PostgREST caps an unbounded `select` at 1000 rows and returns no error for
 * it — a query without `.range()` silently truncates. Past 1000 backed-up
 * documents, that would drop real, still-referenced keys out of the set this
 * job treats as "safe to keep", which is exactly the "partial reference set"
 * scenario the design spec says must never be allowed to reach a delete.
 */
const DB_PAGE_SIZE = 1000

async function fetchAllReferencedKeys(db: SupabaseClient): Promise<Set<string>> {
  const referencedKeys = new Set<string>()
  let offset = 0

  while (true) {
    const { data: rows, error } = await db
      .from('scan_documents')
      .select('r2_object_key')
      .not('r2_object_key', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + DB_PAGE_SIZE - 1)

    if (error) throw error

    for (const row of rows ?? []) referencedKeys.add(row.r2_object_key as string)
    if (!rows || rows.length < DB_PAGE_SIZE) break
    offset += DB_PAGE_SIZE
  }

  return referencedKeys
}

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

/** Deletes at most this many objects at once — enough to keep a large batch
 *  well clear of the Edge Function's wall-clock limit, not so many that a
 *  burst of DELETEs looks like abuse to R2. */
const DELETE_CONCURRENCY = 10

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

async function deleteCandidates(
  plan: CleanupPlan,
): Promise<{ deletedCount: number; deleteFailures: string[] }> {
  const deleteFailures: string[] = []
  let deletedCount = 0

  for (const batch of chunk(plan.candidates, DELETE_CONCURRENCY)) {
    const results = await Promise.allSettled(batch.map((candidate) => deleteObject(candidate.key)))

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        deletedCount += 1
      } else {
        console.error(`Gagal menghapus ${batch[i].key}:`, result.reason)
        deleteFailures.push(batch[i].key)
      }
    })
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

    let referencedKeys: Set<string>
    try {
      referencedKeys = await fetchAllReferencedKeys(db)
    } catch (caught) {
      console.error('Gagal membaca scan_documents:', caught)
      return new Response(JSON.stringify({ error: 'DB_ERROR' }), { status: 500 })
    }

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
