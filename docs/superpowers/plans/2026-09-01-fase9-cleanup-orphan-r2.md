# Job Pembersihan Object R2 Yatim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bangun job terjadwal yang mendeteksi (dan, setelah masa observasi, menghapus) object R2 yang tidak punya baris `scan_documents` yang merujuknya.

**Architecture:** `pg_cron` (migration SQL) memanggil `pg_net.http_post` ke Edge Function baru `cleanup-orphan-r2` setiap hari jam 03:00, dengan header rahasia `x-cron-secret`. Function itu mengambil daftar `r2_object_key` yang valid dari `scan_documents`, me-list seluruh object R2 di prefix `users/` lewat S3 `ListObjectsV2`, lalu untuk tiap object yang tidak ada di daftar valid dan lebih tua dari 24 jam, mencatatnya sebagai kandidat yatim. Mode `LOG_ONLY` adalah default; mode hapus nyata dikendalikan lewat Edge Function Secret terpisah, jadi bisa dinyalakan tanpa deploy ulang.

**Tech Stack:** Deno Edge Function (TypeScript), `aws4fetch` (sudah dipakai `_shared/r2.ts`), `pg_cron` + `pg_net` (ekstensi Postgres), Vitest (suite `node`) untuk logika murni.

**Spec:** `docs/superpowers/specs/2026-09-01-fase9-cleanup-orphan-r2-design.md`

## Global Constraints

- Margin aman: object dianggap kandidat yatim hanya kalau `LastModified` **≥ 24 jam** lebih tua dari waktu job berjalan.
- Mode awal setelah deploy: **`LOG_ONLY`** — tidak pernah menghapus sampai secara sadar dinyalakan lewat secret `CLEANUP_ORPHAN_R2_DRY_RUN = "false"`.
- Katup pengaman: penghapusan nyata ditolak (jatuh balik ke perilaku log-saja) kalau kandidat yatim melebihi 50% dari total object yang di-list.
- Query referensi (`scan_documents.r2_object_key`) atau listing R2 gagal → seluruh run dibatalkan, tidak ada penghapusan sama sekali.
- Tidak ada `index.ts` Edge Function lain di proyek ini yang punya test sendiri — logika selalu diekstrak ke `_shared/*.ts` bebas Deno API supaya suite `node` (Vitest) mencakupnya. Pola yang sama berlaku di sini.
- Object key selalu berbentuk `users/{uuid}/{uuid}.pdf` (lihat `_shared/storageKey.ts`) — tidak pernah memuat karakter metacharacter XML, jadi parsing response `ListObjectsV2` dengan regex (bukan XML parser penuh) aman dan sengaja dipilih untuk nol dependency baru.

---

## Task 1: Parser murni untuk response `ListObjectsV2`

**Files:**
- Create: `supabase/functions/_shared/r2ListParser.ts`
- Test: `supabase/functions/_shared/r2ListParser.test.ts`

**Interfaces:**
- Produces: `interface ListedR2Object { key: string; size: number; lastModified: Date }`, `interface ListObjectsPage { objects: ListedR2Object[]; isTruncated: boolean; nextContinuationToken: string | null }`, `function parseListObjectsXml(xml: string): ListObjectsPage`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/_shared/r2ListParser.test.ts
import { describe, expect, it } from 'vitest'
import { parseListObjectsXml } from './r2ListParser.ts'

const ENVELOPE = (contents: string, truncated = false, token = '') => `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Name>scanappstorage</Name>
  <Prefix>users/</Prefix>
  <IsTruncated>${truncated}</IsTruncated>
  ${token ? `<NextContinuationToken>${token}</NextContinuationToken>` : ''}
  ${contents}
</ListBucketResult>`

const ONE_OBJECT = `<Contents>
  <Key>users/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.pdf</Key>
  <LastModified>2026-08-30T10:00:00.000Z</LastModified>
  <Size>204800</Size>
</Contents>`

describe('parseListObjectsXml', () => {
  it('parses one object with key, size and lastModified', () => {
    const page = parseListObjectsXml(ENVELOPE(ONE_OBJECT))

    expect(page.objects).toEqual([
      {
        key: 'users/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.pdf',
        size: 204800,
        lastModified: new Date('2026-08-30T10:00:00.000Z'),
      },
    ])
  })

  it('parses every <Contents> entry, not just the first', () => {
    const second = `<Contents>
      <Key>users/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf</Key>
      <LastModified>2026-08-31T00:00:00.000Z</LastModified>
      <Size>1000</Size>
    </Contents>`

    const page = parseListObjectsXml(ENVELOPE(ONE_OBJECT + second))

    expect(page.objects).toHaveLength(2)
    expect(page.objects[1].size).toBe(1000)
  })

  it('reports isTruncated=false and no token for a complete listing', () => {
    const page = parseListObjectsXml(ENVELOPE(ONE_OBJECT))

    expect(page.isTruncated).toBe(false)
    expect(page.nextContinuationToken).toBeNull()
  })

  it('carries the continuation token when the listing is truncated', () => {
    const page = parseListObjectsXml(ENVELOPE(ONE_OBJECT, true, 'abc123=='))

    expect(page.isTruncated).toBe(true)
    expect(page.nextContinuationToken).toBe('abc123==')
  })

  it('returns an empty list for a bucket prefix with nothing in it', () => {
    const page = parseListObjectsXml(ENVELOPE(''))

    expect(page.objects).toEqual([])
  })

  it('skips a Contents block missing a required field rather than crashing', () => {
    const broken = `<Contents>
      <Key>users/x/y.pdf</Key>
      <Size>10</Size>
    </Contents>` // no <LastModified>

    const page = parseListObjectsXml(ENVELOPE(broken + ONE_OBJECT))

    expect(page.objects).toHaveLength(1)
    expect(page.objects[0].size).toBe(204800)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project node r2ListParser`
Expected: FAIL — `Cannot find module './r2ListParser.ts'` (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```typescript
// supabase/functions/_shared/r2ListParser.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project node r2ListParser`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/r2ListParser.ts supabase/functions/_shared/r2ListParser.test.ts
git commit -m "feat(r2): parser murni untuk response ListObjectsV2"
```

---

## Task 2: `listObjects()` di `_shared/r2.ts`

**Files:**
- Modify: `supabase/functions/_shared/r2.ts`

**Interfaces:**
- Consumes: `parseListObjectsXml` and both types from Task 1 (`./r2ListParser.ts`)
- Produces: `function listObjects(prefix: string, continuationToken?: string): Promise<ListObjectsPage>`

No test for this step — it is a live R2 HTTP call, same as every other function already in `r2.ts` (`headObjectSize`, `deleteObject`), none of which have unit tests; the parsing logic it depends on is already covered by Task 1.

- [ ] **Step 1: Add the import and function**

Add near the top of `supabase/functions/_shared/r2.ts`:

```typescript
import { parseListObjectsXml, type ListObjectsPage } from './r2ListParser.ts'
```

Add at the end of the file:

```typescript
/**
 * One page of `ListObjectsV2` under `prefix`. The caller drives pagination —
 * pass back `nextContinuationToken` while `isTruncated` is true.
 */
export async function listObjects(
  prefix: string,
  continuationToken?: string,
): Promise<ListObjectsPage> {
  const { client, base } = config()

  const url = new URL(`${base}/`)
  url.searchParams.set('list-type', '2')
  url.searchParams.set('prefix', prefix)
  if (continuationToken) url.searchParams.set('continuation-token', continuationToken)

  const response = await client.fetch(url.toString(), { method: 'GET' })
  if (!response.ok) {
    throw new Error(`Gagal me-list object R2: ${response.status}`)
  }

  return parseListObjectsXml(await response.text())
}
```

- [ ] **Step 2: Sanity-check the edit**

Run: `npx vitest run --project node r2ListParser` (confirms Task 1's tests are untouched and still pass — `r2.ts` itself cannot be imported from Vitest because of its `npm:aws4fetch` specifier, which Node does not resolve; this is expected and matches every other function in the file).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/r2.ts
git commit -m "feat(r2): tambah listObjects untuk ListObjectsV2 R2"
```

---

## Task 3: Logika murni job pembersihan

**Files:**
- Create: `supabase/functions/_shared/orphanCleanup.ts`
- Test: `supabase/functions/_shared/orphanCleanup.test.ts`

**Interfaces:**
- Consumes: `ListedR2Object` type from Task 1 (`./r2ListParser.ts`)
- Produces: `ORPHAN_MIN_AGE_MS`, `SAFETY_VALVE_RATIO`, `SAFETY_VALVE_MIN_CANDIDATES` constants; `interface CleanupPlan { candidates: ListedR2Object[]; candidateBytes: number; totalListed: number; safetyValveTripped: boolean; shouldDelete: boolean }`; `function planCleanup(listed: ListedR2Object[], referencedKeys: ReadonlySet<string>, now: Date, dryRunRequested: boolean): CleanupPlan`; `function resolveDryRun(rawEnvValue: string | undefined): boolean`; `function verifyCronSecret(headerValue: string | null, expectedSecret: string): boolean`

- [ ] **Step 1: Write the failing tests**

```typescript
// supabase/functions/_shared/orphanCleanup.test.ts
import { describe, expect, it } from 'vitest'
import {
  ORPHAN_MIN_AGE_MS,
  planCleanup,
  resolveDryRun,
  verifyCronSecret,
} from './orphanCleanup.ts'
import type { ListedR2Object } from './r2ListParser.ts'

const NOW = new Date('2026-09-01T03:00:00.000Z')

function object(key: string, ageMs: number, size = 1000): ListedR2Object {
  return { key, size, lastModified: new Date(NOW.getTime() - ageMs) }
}

const DAY = 24 * 60 * 60 * 1000

describe('planCleanup', () => {
  it('never flags a referenced key, however old', () => {
    const listed = [object('users/a/1.pdf', 10 * DAY)]
    const plan = planCleanup(listed, new Set(['users/a/1.pdf']), NOW, false)

    expect(plan.candidates).toEqual([])
  })

  it('does not flag an unreferenced object younger than the 24h margin', () => {
    const listed = [object('users/a/1.pdf', DAY - 1000)]
    const plan = planCleanup(listed, new Set(), NOW, false)

    expect(plan.candidates).toEqual([])
  })

  it('flags an unreferenced object exactly at the 24h margin', () => {
    const listed = [object('users/a/1.pdf', ORPHAN_MIN_AGE_MS)]
    const plan = planCleanup(listed, new Set(), NOW, false)

    expect(plan.candidates).toHaveLength(1)
  })

  it('flags an unreferenced object well past the margin', () => {
    const listed = [object('users/a/1.pdf', 10 * DAY)]
    const plan = planCleanup(listed, new Set(), NOW, false)

    expect(plan.candidates).toHaveLength(1)
  })

  it('sums candidateBytes across every candidate', () => {
    const listed = [object('users/a/1.pdf', 10 * DAY, 500), object('users/a/2.pdf', 10 * DAY, 1500)]
    const plan = planCleanup(listed, new Set(), NOW, false)

    expect(plan.candidateBytes).toBe(2000)
  })

  it('never deletes when dry run is requested, even with clean candidates', () => {
    const listed = [object('users/a/1.pdf', 10 * DAY)]
    const plan = planCleanup(listed, new Set(), NOW, true)

    expect(plan.shouldDelete).toBe(false)
  })

  it('allows deletion when dry run is off, candidates are few, and the ratio is low', () => {
    const listed = [
      object('users/a/1.pdf', 10 * DAY), // candidate
      ...Array.from({ length: 19 }, (_, i) => object(`users/a/kept-${i}.pdf`, DAY)),
    ]
    const referenced = new Set(listed.slice(1).map((o) => o.key))
    const plan = planCleanup(listed, referenced, NOW, false)

    expect(plan.candidates).toHaveLength(1)
    expect(plan.safetyValveTripped).toBe(false)
    expect(plan.shouldDelete).toBe(true)
  })

  it('trips the safety valve when candidates exceed 50% of a large-enough listing', () => {
    const listed = Array.from({ length: 40 }, (_, i) => object(`users/a/${i}.pdf`, 10 * DAY))
    // Only 10 of the 40 are referenced -> 75% candidates.
    const referenced = new Set(listed.slice(0, 10).map((o) => o.key))
    const plan = planCleanup(listed, referenced, NOW, false)

    expect(plan.safetyValveTripped).toBe(true)
    expect(plan.shouldDelete).toBe(false)
  })

  it('does not trip the safety valve below the minimum candidate floor, even at 100%', () => {
    // 3 objects, all orphaned -- 100% ratio, but far below the 20-candidate
    // floor. An early, near-empty bucket must not be permanently unable to
    // clean up because every object it has happens to be orphaned.
    const listed = Array.from({ length: 3 }, (_, i) => object(`users/a/${i}.pdf`, 10 * DAY))
    const plan = planCleanup(listed, new Set(), NOW, false)

    expect(plan.safetyValveTripped).toBe(false)
    expect(plan.shouldDelete).toBe(true)
  })

  it('handles an empty bucket listing without dividing by zero', () => {
    const plan = planCleanup([], new Set(), NOW, false)

    expect(plan.totalListed).toBe(0)
    expect(plan.safetyValveTripped).toBe(false)
    expect(plan.shouldDelete).toBe(true)
  })
})

describe('resolveDryRun', () => {
  it('defaults to dry run when the env var is unset', () => {
    expect(resolveDryRun(undefined)).toBe(true)
  })

  it('stays dry run for anything other than the exact literal "false"', () => {
    expect(resolveDryRun('')).toBe(true)
    expect(resolveDryRun('true')).toBe(true)
    expect(resolveDryRun('False')).toBe(true)
    expect(resolveDryRun('FALSE')).toBe(true)
  })

  it('turns real deletion on only for the exact literal "false"', () => {
    expect(resolveDryRun('false')).toBe(false)
  })
})

describe('verifyCronSecret', () => {
  const SECRET = 'a-very-long-random-cron-secret-value'

  it('accepts the matching secret', () => {
    expect(verifyCronSecret(SECRET, SECRET)).toBe(true)
  })

  it('rejects a missing header', () => {
    expect(verifyCronSecret(null, SECRET)).toBe(false)
  })

  it('rejects a wrong value of the same length', () => {
    const wrong = 'b' + SECRET.slice(1)
    expect(verifyCronSecret(wrong, SECRET)).toBe(false)
  })

  it('rejects a wrong value of a different length', () => {
    expect(verifyCronSecret('short', SECRET)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project node orphanCleanup`
Expected: FAIL — `Cannot find module './orphanCleanup.ts'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// supabase/functions/_shared/orphanCleanup.ts
/**
 * Pure decision logic for the orphan-R2-object cleanup job. No Deno APIs, no
 * network — the Vitest `node` suite covers every branch here; the I/O shell
 * around it (`cleanup-orphan-r2/index.ts`) is proven live in `LOG_ONLY` mode
 * instead, the same split every other `_shared/*.ts` module in this project
 * uses.
 */
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

function constantTimeEqual(a: string, b: string): boolean {
  const bytesA = new TextEncoder().encode(a)
  const bytesB = new TextEncoder().encode(b)
  if (bytesA.length !== bytesB.length) return false

  let diff = 0
  for (let i = 0; i < bytesA.length; i += 1) diff |= bytesA[i] ^ bytesB[i]
  return diff === 0
}

/** Cron's only credential: a shared secret header, not a user JWT. */
export function verifyCronSecret(headerValue: string | null, expectedSecret: string): boolean {
  if (!headerValue) return false
  return constantTimeEqual(headerValue, expectedSecret)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project node orphanCleanup`
Expected: PASS — 17 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/orphanCleanup.ts supabase/functions/_shared/orphanCleanup.test.ts
git commit -m "feat(r2): logika murni job pembersihan object yatim"
```

---

## Task 4: Edge Function `cleanup-orphan-r2`

**Files:**
- Create: `supabase/functions/cleanup-orphan-r2/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `serviceClient` from `../_shared/http.ts`; `listObjects`, `deleteObject` from `../_shared/r2.ts`; `planCleanup`, `resolveDryRun`, `verifyCronSecret` from `../_shared/orphanCleanup.ts`; `ListedR2Object` type from `../_shared/r2ListParser.ts`

No test for this task — see Global Constraints; verified live in Task 6.

- [ ] **Step 1: Write the handler**

```typescript
// supabase/functions/cleanup-orphan-r2/index.ts
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

async function deleteCandidates(plan: CleanupPlan): Promise<{ deletedCount: number; deleteFailures: string[] }> {
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
```

- [ ] **Step 2: Register it in `config.toml`**

Append to `supabase/config.toml`:

```toml

# Pemanggilnya pg_cron lewat pg_net, bukan user — tidak ada JWT Supabase yang
# bisa dikirim. Endpoint ini menolak sendiri (401) request yang header
# x-cron-secret-nya tidak cocok dengan CRON_SECRET (lihat
# _shared/orphanCleanup.ts verifyCronSecret dan migration cron-nya).
[functions.cleanup-orphan-r2]
verify_jwt = false
```

- [ ] **Step 3: Typecheck**

Run: `npx vitest run --project node` (confirms Tasks 1 and 3's tests are still green; `cleanup-orphan-r2/index.ts` itself has no automated check available in this repo — see Global Constraints — so this step is a regression check, not a check of the new file).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/cleanup-orphan-r2/index.ts supabase/config.toml
git commit -m "feat(r2): Edge Function cleanup-orphan-r2"
```

---

## Task 5: Migration — jadwal `pg_cron`

**Files:**
- Create: `supabase/migrations/20260901130000_fase9_cleanup_orphan_r2_cron.sql`

**Interfaces:**
- Consumes: the deployed `cleanup-orphan-r2` function's URL (fetched live, not hardcoded from memory)

- [ ] **Step 1: Get the live project URL**

Run the Supabase MCP tool `get_project_url` (or `supabase status` / the Supabase dashboard if the MCP tool is unavailable in this session) to get the real `https://<project-ref>.supabase.co` base. Do not guess or reuse a URL from another project.

- [ ] **Step 2: Write the migration**

```sql
-- Fase 9 — job harian yang mendeteksi (dan, setelah masa observasi, meng-
-- hapus) object R2 yang tidak punya baris scan_documents yang merujuknya.
--
-- Beda dari expire-pro-status (satu UPDATE murni): job ini harus bicara ke
-- Cloudflare R2 lewat S3 API (ListObjectsV2 + DELETE), yang jauh lebih mudah
-- disign (AWS SigV4) di Deno lewat aws4fetch daripada langsung di SQL --
-- karena itu dipanggil lewat Edge Function cleanup-orphan-r2 lewat pg_net,
-- bukan dieksekusi langsung sebagai SQL seperti expire-pro-status.
--
-- Endpoint-nya ditutup dari luar lewat header x-cron-secret, dicocokkan di
-- dalam function terhadap Edge Function Secret CRON_SECRET. Nilainya yang
-- sama HARUS sudah dibuat lebih dulu di Vault dengan nama
-- 'cleanup_orphan_r2_cron_secret' -- dijalankan MANUAL sekali lewat SQL
-- editor/execute_sql, BUKAN oleh migration ini (nilai secret tidak boleh
-- ikut ter-commit ke git):
--   select vault.create_secret(
--     '<nilai-acak-panjang-yang-sama-persis-dengan-Edge-Function-Secret-CRON_SECRET>',
--     'cleanup_orphan_r2_cron_secret'
--   );
--
-- Interval: harian jam 03:00 -- beda jam dari expire-pro-status (00:00)
-- supaya dua job tidak numpuk beban di menit yang sama. Job ini deploy dalam
-- mode LOG_ONLY (lihat CLEANUP_ORPHAN_R2_DRY_RUN di orphanCleanup.ts) --
-- tidak menghapus apa pun sampai secara sadar dinyalakan.
--
-- Spec: docs/superpowers/specs/2026-09-01-fase9-cleanup-orphan-r2-design.md

create extension if not exists pg_net;

select cron.schedule(
  'cleanup-orphan-r2',
  '0 3 * * *',
  $$
    select net.http_post(
      url := 'https://<PROJECT_REF>.supabase.co/functions/v1/cleanup-orphan-r2',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_orphan_r2_cron_secret')
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
```

Replace `<PROJECT_REF>` with the real value from Step 1 before saving the file — the committed migration must contain the literal project URL (public, not a secret), never the placeholder.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260901130000_fase9_cleanup_orphan_r2_cron.sql
git commit -m "feat(r2): jadwalkan cleanup-orphan-r2 lewat pg_cron + pg_net"
```

---

## Task 6: Deploy, aktifkan secret, jalankan suite penuh, catat status

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Buat `CRON_SECRET`**

Generate satu string acak panjang (mis. `openssl rand -hex 32`). Simpan sebagai Edge Function Secret bernama `CRON_SECRET` di dashboard Supabase, dan jalankan `select vault.create_secret('<nilai-yang-sama>', 'cleanup_orphan_r2_cron_secret');` sekali lewat SQL editor/`execute_sql` — nilai yang sama persis di kedua tempat, tidak pernah ditulis ke file yang ter-commit.

- [ ] **Step 2: Deploy function & apply migration**

Deploy `cleanup-orphan-r2` (mis. lewat Supabase MCP `deploy_edge_function` atau `supabase functions deploy cleanup-orphan-r2`), lalu apply migration Task 5 (`apply_migration` atau `supabase db push`).

- [ ] **Step 3: Uji manual sekali (tanpa menunggu jadwal 03:00)**

Panggil function langsung dengan `CRON_SECRET` yang benar, verifikasi respons `200` dengan `dryRunRequested: true` dan `deletionsPerformed: false`. Lalu ulangi dengan header salah/kosong, verifikasi `401`.

- [ ] **Step 4: Jalankan suite test penuh**

Run: `npm test`
Expected: seluruh suite `node` + `browser` hijau (termasuk 17 test baru dari Task 3 dan 6 dari Task 1 — total 23 test baru).

- [ ] **Step 5: Update TASKS.md**

Ubah baris "Uji job pembersihan object R2 yatim" di Fase 9 dari `[ ]` menjadi `[~]`, jelaskan: kode & logika sudah dibangun+teruji, job berjalan di mode `LOG_ONLY` sejak `<tanggal deploy>`, menunggu beberapa hari observasi log kandidat sebelum Boss Ali menyalakan mode hapus nyata lewat `CLEANUP_ORPHAN_R2_DRY_RUN`.

- [ ] **Step 6: Commit**

```bash
git add TASKS.md
git commit -m "docs(tasks): job cleanup-orphan-r2 deployed, mode LOG_ONLY"
```
