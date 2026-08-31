# Fase 8 — Program Referral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User Basic/Pro bisa membagikan kode referral uniknya; teman yang mendaftar pakai kode itu dan menyelesaikan scan pertama memicu reward dua arah (referrer naik milestone bertahap, referred dapat 1 hari Pro), dengan verifikasi "sudah scan" dan pembekuan kolom yang benar-benar di sisi server.

**Architecture:** Signup metadata (`referred_by_code`) di-resolve jadi `referred_by` + row `referral_events` langsung di trigger `handle_new_user()` (Postgres). Aktivasi (setelah scan pertama) dan reward-granting berjalan di Edge Function baru `process-referral-activation`, memakai logika murni terpisah di `supabase/functions/_shared/referral.ts` (node-testable, mengikuti pola `quota.ts`). `expire-pro-status` jadi `pg_cron` job SQL langsung, bukan Edge Function terjadwal. Klien: field kode referral opsional di `AuthScreen`, layar baru `ReferralScreen` (kode + progres milestone), dan trigger otomatis sekali-seumur-install di `App.tsx` tepat setelah scan pertama tersimpan.

**Tech Stack:** React 19 + TypeScript + Vite + Capacitor 8, Supabase (Postgres + Edge Functions/Deno), `@capacitor/share` (sudah terpasang, tanpa dependency baru). Vitest suite `node` untuk logika murni (client & `_shared`), suite `browser` (Chromium via Playwright) untuk komponen.

**Spec:** `docs/superpowers/specs/2026-09-01-fase8-referral-design.md`

## Global Constraints

- **Angka final, jangan diubah** (CLAUDE.md Bagian 6 / PRD Bagian 5): milestone 5→7, 15→25, 30→60 hari Pro untuk referrer; 1 hari Pro untuk yang diundang (`referred_id`). `referral_milestones` **sudah ter-seed** — jangan buat migration seed baru.
- **Verifikasi "sudah scan" lewat `profiles.first_scan_completed_at`**, bukan `scan_documents` (tabel itu cuma terisi saat backup ke cloud, tidak semua user melakukannya). Ditulis **hanya** oleh Edge Function (service role).
- **`referral_code`, `referred_by`, `first_scan_completed_at` wajib dibekukan** di RLS `profiles_update_own` (Task 2) — celah keamanan nyata kalau tidak, lihat spec Bagian 3.
- **Milestone dicocokkan persis (`=`), bukan `>=`** — aktivasi diproses satu per satu, jadi hitungan hanya pernah naik 1 tiap panggilan (spec Bagian 5).
- **`pro_plan` tidak pernah ditimpa turun**: kalau profile sudah `monthly`/`yearly`, reward referral memperpanjang `tier_expires_at` tapi **tidak mengubah** `pro_plan` (supaya kuota 1GB/500MB tidak turun jadi 500MB referral). Hanya diisi `'referral'` kalau sebelumnya `null`.
- **Anti-abuse v1 = email + activation saja.** Tidak ada device-fingerprint di plan ini — dependency native baru, di luar cakupan (dicatat known gap di Task 12).
- **Tidak ada deep-link.** Kode referral dimasukkan manual di form Daftar. Jangan menambahkan `scannapp://` URL scheme atau App URL Open listener.
- **Edge Function baru mengikuti pola `confirm-upload`/`_shared/http.ts` yang sudah ada** — `serviceClient()`, `authenticate()`, `handler()` — jangan bikin pola baru. Logika multi-langkah TIDAK dibungkus satu transaksi SQL (non-atomik, konsisten dengan `confirm-upload`), aman karena idempotent lewat flag `activated`/`reward_granted`/`first_scan_completed_at`.
- **Bahasa komentar**: Inggris di semua `src/lib/**`, `src/screens/**`, `src/components/**`, dan `supabase/functions/**` yang disentuh plan ini (mengikuti tetangganya: `backupApi.ts`, `quota.ts`, `confirm-upload/index.ts` semuanya Inggris). Migration SQL: komentar Bahasa Indonesia (mengikuti `fase3_auth_profile_bootstrap.sql`, `fase5_freeze_pro_plan_in_rls.sql`). Teks yang dilihat user selalu Bahasa Indonesia. Jangan mencampur dua bahasa dalam satu berkas.
- **Dua suite test** (CLAUDE.md Bagian 4): `*.test.ts` → suite `node` (termasuk `supabase/functions/**/*.test.ts`, sudah ter-include di `vitest.config.ts`). `*.browser.test.tsx` → Chromium sungguhan. `render()` dari `vitest-browser-react` mengembalikan Promise — wajib `await`.
- **`index.ts` Edge Function tidak punya test file sendiri di codebase ini** (`confirm-upload/index.ts`, `revenuecat-webhook/index.ts` — tidak satu pun punya). Logika ditarik ke `_shared/*.ts` yang testable; `index.ts` cuma orkestrasi, diverifikasi lewat deploy (Deno typecheck saat deploy) + uji manual end-to-end di Task 12.
- **Migration SQL tidak punya test vitest** (tidak ada Postgres di suite node/browser) — precedent Fase 3/5 juga begitu. Verifikasi lewat apply ke project Supabase (`mcp__claude_ai_Supabase__apply_migration` atau `supabase db push`) + `execute_sql` sanity check per task.
- **AuthScreen belum pernah punya test file** — Task 9 jadi yang pertama, memakai `vi.mock('../auth/useAuth', ...)` (teknik standar mocking hook, konsisten dengan `vi.mock('./supabase', ...)` di `backupApi.test.ts`), bukan pola baru yang eksotis.
- Perintah: `npm run test:node`, `npm run test:browser`, `npm test` (keduanya), `npm run build` (typecheck + build), `npm run lint` (oxlint).
- **Basis test sekarang: 938 tes (67 file)** — 1 September 2026, setelah merge Fase 7A+7B ke `main`. Tiap task menyebut angka yang diharapkan setelahnya sebagai pemeriksaan kasar, bukan target.
- Commit per task, conventional commits, akhiri dengan `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Kerja di branch `fase8-program-referral` (sudah dibuat, jangan commit ke `main`).

---

### Task 1: Migration — signup wiring (`referred_by`, `referral_events`, kolom `first_scan_completed_at`)

**Files:**
- Create: `supabase/migrations/20260901090000_fase8_referral_signup_wiring.sql`

**Interfaces:**
- Consumes: fungsi `public.generate_referral_code()` dan trigger `public.handle_new_user()` yang sudah ada (migration `20260725174617_fase3_auth_profile_bootstrap.sql`).
- Produces: kolom `public.profiles.first_scan_completed_at`, dan `handle_new_user()` yang sekarang mengisi `referred_by` + insert `referral_events` — dipakai Task 2 (freeze RLS) dan Task 5 (Edge Function).

- [ ] **Step 1: Tulis migration**

Create `supabase/migrations/20260901090000_fase8_referral_signup_wiring.sql`:

```sql
-- Fase 8 — sambungkan kode referral yang dimasukkan saat signup ke referred_by,
-- dan tambah kolom bukti "sudah scan" (diisi Edge Function, bukan trigger ini).
-- Lihat docs/superpowers/specs/2026-09-01-fase8-referral-design.md Bagian 4.

alter table public.profiles
  add column if not exists first_scan_completed_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fallback_name text;
  referrer_id uuid;
  submitted_code text;
begin
  fallback_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    split_part(coalesce(new.email, 'pengguna'), '@', 1)
  );

  -- Kode referral opsional dari signup metadata (field "Kode referral" di
  -- AuthScreen). Kode kosong/tidak ketemu bukan error -- referrer_id tetap
  -- null dan signup jalan persis seperti sebelum referral ada.
  submitted_code := upper(trim(coalesce(new.raw_user_meta_data ->> 'referred_by_code', '')));

  if submitted_code <> '' then
    select id into referrer_id from public.profiles where referral_code = submitted_code;
  end if;

  insert into public.profiles (id, display_name, referral_code, referred_by)
  values (new.id, fallback_name, public.generate_referral_code(), referrer_id)
  on conflict (id) do nothing;

  insert into public.storage_usage (user_id, bytes_used, quota_bytes)
  values (new.id, 0, 104857600)
  on conflict (user_id) do nothing;

  if referrer_id is not null then
    insert into public.referral_events (referrer_id, referred_id)
    values (referrer_id, new.id);
  end if;

  return new;
end;
$$;
```

- [ ] **Step 2: Apply ke project Supabase**

Gunakan `mcp__claude_ai_Supabase__apply_migration` (name: `fase8_referral_signup_wiring`, isi query = SQL di atas) atau `supabase db push` kalau bekerja dari CLI yang sudah ter-link ke project.

- [ ] **Step 3: Verifikasi**

Jalankan lewat `mcp__claude_ai_Supabase__execute_sql` (atau `supabase db query`):

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'first_scan_completed_at';
```

Expected: 1 baris kembali (`first_scan_completed_at`).

```sql
select prosrc from pg_proc where proname = 'handle_new_user';
```

Expected: isinya memuat `referred_by_code` dan `insert into public.referral_events`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260901090000_fase8_referral_signup_wiring.sql
git commit -m "feat(fase8): trigger signup isi referred_by & referral_events

Kode referral dari signup metadata di-resolve jadi referred_by dan
row referral_events, langsung di handle_new_user(). Kolom baru
profiles.first_scan_completed_at ditambahkan (belum ditulis siapa
pun -- Task 5 yang mengisi lewat Edge Function).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration — bekukan `referral_code`/`referred_by`/`first_scan_completed_at` di RLS

**Files:**
- Create: `supabase/migrations/20260901093000_fase8_freeze_referral_columns_in_rls.sql`

**Interfaces:**
- Consumes: policy `profiles_update_own` yang sudah ada (dari `20260725093558_enable_rls_and_policies.sql`, diperluas `20260821211045_fase5_freeze_pro_plan_in_rls.sql`).
- Produces: policy `profiles_update_own` final, membekukan `tier`, `tier_expires_at`, `pro_plan`, `referral_code`, `referred_by`, `first_scan_completed_at` — tidak ada task lain yang mengonsumsi ini secara langsung, tapi Task 5 (Edge Function pakai service role) bergantung pada gerbang ini untuk keamanan.

- [ ] **Step 1: Tulis migration**

Create `supabase/migrations/20260901093000_fase8_freeze_referral_columns_in_rls.sql`:

```sql
-- Fase 8 — tutup celah: referral_code, referred_by, dan first_scan_completed_at
-- (kolom baru Task 1) bisa diubah sendiri oleh client lewat REST API, sama
-- seperti celah pro_plan yang ditutup migration 20260821211045.
--
-- Tanpa ini, first_scan_completed_at khususnya jadi lubang serius: user bisa
-- PATCH kolom itu sendiri jadi terisi, lalu panggil process-referral-activation
-- tanpa pernah benar-benar scan -- membatalkan seluruh gerbang "reward hanya
-- cair setelah scan sungguhan" (CLAUDE.md Aturan Keras #6).
--
-- Yang boleh mengubah ketiganya cuma handle_new_user() (referral_code/
-- referred_by, sekali saat signup) dan process-referral-activation
-- (first_scan_completed_at), keduanya lewat service role yang melewati RLS.

drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and tier = (select p.tier from public.profiles p where p.id = auth.uid())
    and tier_expires_at is not distinct from
        (select p.tier_expires_at from public.profiles p where p.id = auth.uid())
    and pro_plan is not distinct from
        (select p.pro_plan from public.profiles p where p.id = auth.uid())
    and referral_code is not distinct from
        (select p.referral_code from public.profiles p where p.id = auth.uid())
    and referred_by is not distinct from
        (select p.referred_by from public.profiles p where p.id = auth.uid())
    and first_scan_completed_at is not distinct from
        (select p.first_scan_completed_at from public.profiles p where p.id = auth.uid())
  );
```

- [ ] **Step 2: Apply ke project Supabase**

`mcp__claude_ai_Supabase__apply_migration` (name: `fase8_freeze_referral_columns_in_rls`) atau `supabase db push`.

- [ ] **Step 3: Verifikasi**

```sql
select polqual, polwithcheck from pg_policy
where polrelid = 'public.profiles'::regclass and polname = 'profiles_update_own';
```

Expected: `polwithcheck` memuat `referral_code`, `referred_by`, dan `first_scan_completed_at`.

Sanity check keamanan (jalankan sebagai role `authenticated` lewat client biasa, bukan service role — kalau ada akses ke dua akun test, coba `update profiles set first_scan_completed_at = now() where id = auth.uid()` dari klien; **harus ditolak** oleh RLS). Kalau tidak ada akun test siap pakai saat ini, cukup catat sebagai item checklist Task 12.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260901093000_fase8_freeze_referral_columns_in_rls.sql
git commit -m "fix(fase8): bekukan referral_code/referred_by/first_scan_completed_at di RLS

profiles_update_own sebelumnya cuma membekukan tier/tier_expires_at/
pro_plan. Tiga kolom referral yang ditambahkan Task 1 belum dibekukan
sama sekali -- client bisa PATCH langsung dan memalsukan status
referral/aktivasi. Ditutup dengan pola yang sama seperti pembekuan
pro_plan (migration 20260821211045).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Migration — `expire-pro-status` sebagai `pg_cron` job

**Files:**
- Create: `supabase/migrations/20260901100000_fase8_expire_pro_status_cron.sql`

**Interfaces:**
- Consumes: kolom `profiles.tier`/`tier_expires_at`/`pro_plan` yang sudah ada.
- Produces: job `pg_cron` bernama `expire-pro-status`, berjalan harian 00:00. Tidak dikonsumsi task lain — independen dari Task 1/2.

- [ ] **Step 1: Tulis migration**

Create `supabase/migrations/20260901100000_fase8_expire_pro_status_cron.sql`:

```sql
-- Fase 8 — job harian yang menurunkan Pro yang sudah lewat tier_expires_at
-- kembali ke Basic. Isinya cuma satu UPDATE, jadi dijadwalkan langsung lewat
-- pg_cron -- tidak perlu Edge Function + HTTP round-trip untuk ini.
-- Interval final: harian jam 00:00 (CLAUDE.md Bagian 6).

create extension if not exists pg_cron;

select cron.schedule(
  'expire-pro-status',
  '0 0 * * *',
  $$
    -- pro_plan ikut direset -- desain lama (BACKEND_API_DESIGN.md Bagian 7)
    -- melewatkan ini, dan tanpanya baris yang baru turun ke Basic tetap
    -- berlabel "Pro Bulanan"/"Pro dari Referral" dst di UI (tierLabel()
    -- membaca pro_plan).
    update public.profiles
    set tier = 'basic', tier_expires_at = null, pro_plan = null
    where tier = 'pro' and tier_expires_at is not null and tier_expires_at < now();
  $$
);
```

- [ ] **Step 2: Apply ke project Supabase**

`mcp__claude_ai_Supabase__apply_migration` (name: `fase8_expire_pro_status_cron`) atau `supabase db push`.

- [ ] **Step 3: Verifikasi**

```sql
select jobname, schedule, active from cron.job where jobname = 'expire-pro-status';
```

Expected: 1 baris, `schedule = '0 0 * * *'`, `active = true`.

Uji manual sekali (opsional tapi murah): jalankan isi query job secara langsung lewat `execute_sql` terhadap baris test (`tier='pro'`, `tier_expires_at` di masa lalu) untuk pastikan efeknya benar sebelum menunggu jadwal cron sungguhan.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260901100000_fase8_expire_pro_status_cron.sql
git commit -m "feat(fase8): jadwalkan expire-pro-status lewat pg_cron

Job harian 00:00, turunkan tier='pro' yang tier_expires_at-nya lewat
kembali ke basic. pro_plan ikut direset -- desain lama melewatkan ini.
pg_cron dipilih daripada Edge Function terjadwal karena isinya cuma
satu UPDATE, tidak perlu HTTP round-trip.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Logika referral murni (`supabase/functions/_shared/referral.ts`)

**Files:**
- Create: `supabase/functions/_shared/referral.ts`
- Test: `supabase/functions/_shared/referral.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module, mengikuti pola `quota.ts` — bebas dari Deno API supaya ikut suite `node`).
- Produces:
  - `export const REFERRED_USER_BONUS_DAYS = 1`
  - `export interface ProProfileRow { tier: string; tier_expires_at: string | null; pro_plan: string | null }`
  - `export function extendExpiry(profile: ProProfileRow, days: number, now?: Date): string`
  - `export function nextProPlan(profile: ProProfileRow): 'monthly' | 'yearly' | 'referral'`
  - `export interface Milestone { referral_count_required: number; pro_days_reward: number }`
  - `export function matchedMilestone(activatedCount: number, milestones: Milestone[]): Milestone | null`
  - Dipakai Task 5 (`process-referral-activation/index.ts`).

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/referral.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  extendExpiry,
  matchedMilestone,
  nextProPlan,
  REFERRED_USER_BONUS_DAYS,
  type Milestone,
  type ProProfileRow,
} from './referral.ts'

const NOW = new Date('2026-09-01T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function profile(overrides: Partial<ProProfileRow> = {}): ProProfileRow {
  return { tier: 'basic', tier_expires_at: null, pro_plan: null, ...overrides }
}

/** Angka final, CLAUDE.md Bagian 6. */
describe('REFERRED_USER_BONUS_DAYS', () => {
  it('is 1 day', () => {
    expect(REFERRED_USER_BONUS_DAYS).toBe(1)
  })
})

describe('extendExpiry', () => {
  it('extends from now for a Basic profile', () => {
    const result = extendExpiry(profile(), 7, NOW)
    expect(Date.parse(result)).toBe(NOW.getTime() + 7 * DAY)
  })

  it('extends from now for an expired Pro profile', () => {
    const expired = profile({ tier: 'pro', tier_expires_at: '2026-08-01T00:00:00Z' })
    const result = extendExpiry(expired, 7, NOW)
    expect(Date.parse(result)).toBe(NOW.getTime() + 7 * DAY)
  })

  it('extends from the current expiry for a running Pro subscription', () => {
    const running = profile({ tier: 'pro', tier_expires_at: '2026-09-10T00:00:00Z' })
    const result = extendExpiry(running, 7, NOW)
    expect(Date.parse(result)).toBe(Date.parse('2026-09-10T00:00:00Z') + 7 * DAY)
  })

  it('treats a corrupt pro row (tier pro, no expiry) as if it were expiring now', () => {
    const corrupt = profile({ tier: 'pro', tier_expires_at: null })
    const result = extendExpiry(corrupt, 1, NOW)
    expect(Date.parse(result)).toBe(NOW.getTime() + 1 * DAY)
  })
})

describe('nextProPlan', () => {
  it('gives a Basic profile the referral plan', () => {
    expect(nextProPlan(profile())).toBe('referral')
  })

  it('keeps a monthly subscriber on monthly (does not shrink their quota)', () => {
    expect(nextProPlan(profile({ tier: 'pro', pro_plan: 'monthly' }))).toBe('monthly')
  })

  it('keeps a yearly subscriber on yearly', () => {
    expect(nextProPlan(profile({ tier: 'pro', pro_plan: 'yearly' }))).toBe('yearly')
  })

  it('keeps an existing referral plan as referral', () => {
    expect(nextProPlan(profile({ tier: 'pro', pro_plan: 'referral' }))).toBe('referral')
  })
})

describe('matchedMilestone', () => {
  const milestones: Milestone[] = [
    { referral_count_required: 5, pro_days_reward: 7 },
    { referral_count_required: 15, pro_days_reward: 25 },
    { referral_count_required: 30, pro_days_reward: 60 },
  ]

  it('matches the exact count', () => {
    expect(matchedMilestone(5, milestones)).toEqual(milestones[0])
    expect(matchedMilestone(15, milestones)).toEqual(milestones[1])
    expect(matchedMilestone(30, milestones)).toEqual(milestones[2])
  })

  it('returns null for a count between milestones', () => {
    expect(matchedMilestone(6, milestones)).toBeNull()
    expect(matchedMilestone(29, milestones)).toBeNull()
  })

  it('returns null past the last milestone (no >= matching)', () => {
    expect(matchedMilestone(31, milestones)).toBeNull()
  })

  it('returns null for zero activations', () => {
    expect(matchedMilestone(0, milestones)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- referral.test`
Expected: FAIL — `Cannot find module './referral.ts'` (or similar).

- [ ] **Step 3: Write minimal implementation**

Create `supabase/functions/_shared/referral.ts`:

```ts
/**
 * Pure referral business logic, kept free of Deno APIs so the same file is
 * covered by the Vitest suite that runs in CI (mirrors the quota.ts pattern).
 */

/** Angka final, CLAUDE.md Bagian 6. */
export const REFERRED_USER_BONUS_DAYS = 1

export interface ProProfileRow {
  tier: string
  tier_expires_at: string | null
  pro_plan: string | null
}

/**
 * Extends a Pro grant by `days`, starting from whichever is later: the
 * profile's current expiry, or now. A Basic or expired profile always
 * extends from now -- CLAUDE.md Bagian 6, "tambahkan ke expiry saat ini,
 * atau ke now() kalau belum Pro". A `tier: 'pro'` row with no expiry is
 * corrupt data (CLAUDE.md Bagian 6) -- treated the same as expired.
 */
export function extendExpiry(profile: ProProfileRow, days: number, now: Date = new Date()): string {
  const current =
    profile.tier === 'pro' && profile.tier_expires_at ? Date.parse(profile.tier_expires_at) : NaN
  const base = !Number.isNaN(current) && current > now.getTime() ? current : now.getTime()
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Which `pro_plan` a referral reward should leave behind. A Basic profile
 * (no plan) becomes 'referral'. A profile already on a paying plan
 * (monthly/yearly) keeps its plan -- overwriting it with 'referral' would
 * shrink a yearly subscriber's 1GB quota down to referral's 500MB for no
 * reason (design doc Bagian 5).
 */
export function nextProPlan(profile: ProProfileRow): 'monthly' | 'yearly' | 'referral' {
  if (profile.pro_plan === 'monthly' || profile.pro_plan === 'yearly') return profile.pro_plan
  return 'referral'
}

export interface Milestone {
  referral_count_required: number
  pro_days_reward: number
}

/**
 * Finds the milestone this activation count exactly matches. Activations are
 * processed one referred user at a time, so the count only ever advances by
 * 1 per call -- an exact match is enough, no need for >= (design doc Bagian 5).
 */
export function matchedMilestone(activatedCount: number, milestones: Milestone[]): Milestone | null {
  return milestones.find((milestone) => milestone.referral_count_required === activatedCount) ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:node -- referral.test`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/referral.ts supabase/functions/_shared/referral.test.ts
git commit -m "feat(fase8): logika murni referral -- extendExpiry, nextProPlan, matchedMilestone

Ditarik ke _shared/referral.ts (bebas Deno API) supaya testable di
suite node, mengikuti pola quota.ts. Dipakai process-referral-activation
(Task 5).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Edge Function `process-referral-activation`

**Files:**
- Create: `supabase/functions/process-referral-activation/index.ts`

**Interfaces:**
- Consumes: `extendExpiry`, `nextProPlan`, `matchedMilestone`, `REFERRED_USER_BONUS_DAYS` (Task 4); `handler`, `json`, `serviceClient` (`_shared/http.ts`, sudah ada).
- Produces: endpoint HTTP `process-referral-activation`, dipanggil Task 11 (`referralApi.triggerReferralActivation()`) lewat nama fungsi ini persis.

- [ ] **Step 1: Tulis Edge Function**

Create `supabase/functions/process-referral-activation/index.ts`:

```ts
import { handler, json, serviceClient } from '../_shared/http.ts'
import { extendExpiry, matchedMilestone, nextProPlan, REFERRED_USER_BONUS_DAYS } from '../_shared/referral.ts'

Deno.serve(
  handler(async (_request, user) => {
    const db = serviceClient()

    const { data: caller } = await db
      .from('profiles')
      .select('referred_by')
      .eq('id', user.id)
      .maybeSingle()

    const referrerId = caller?.referred_by as string | null | undefined

    // Not a referred account -- nothing to do, and nothing written. This
    // function's only job is referral bookkeeping, not general activity
    // tracking for every user.
    if (!referrerId) return json({ activated: false })

    // Idempotent bookkeeping: only ever set once (guarded by `.is(..., null)`
    // below), harmless to repeat on every call.
    await db
      .from('profiles')
      .update({ first_scan_completed_at: new Date().toISOString() })
      .eq('id', user.id)
      .is('first_scan_completed_at', null)

    // Flip this event to activated -- but only the first time. Zero rows
    // updated means a previous call already did this; stop here rather than
    // re-granting a reward that already went out.
    const { data: justActivated } = await db
      .from('referral_events')
      .update({ activated: true, activated_at: new Date().toISOString() })
      .eq('referrer_id', referrerId)
      .eq('referred_id', user.id)
      .eq('activated', false)
      .select('id')

    if (!justActivated || justActivated.length === 0) {
      return json({ activated: false })
    }

    const eventId = justActivated[0].id as string

    // "Give X get Y": the referred user's own bonus, unconditional on
    // whether this activation also crosses a referrer milestone below.
    const { data: referredProfile } = await db
      .from('profiles')
      .select('id, tier, tier_expires_at, pro_plan')
      .eq('id', user.id)
      .maybeSingle()

    if (referredProfile) {
      await db
        .from('profiles')
        .update({
          tier: 'pro',
          tier_expires_at: extendExpiry(referredProfile, REFERRED_USER_BONUS_DAYS),
          pro_plan: nextProPlan(referredProfile),
        })
        .eq('id', user.id)
    }

    // Milestone check for the referrer.
    const { count } = await db
      .from('referral_events')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_id', referrerId)
      .eq('activated', true)

    const { data: milestones } = await db
      .from('referral_milestones')
      .select('referral_count_required, pro_days_reward')
      .eq('active', true)

    const milestone = matchedMilestone(count ?? 0, milestones ?? [])
    let milestoneReached: number | null = null

    if (milestone) {
      const { data: referrerProfile } = await db
        .from('profiles')
        .select('id, tier, tier_expires_at, pro_plan')
        .eq('id', referrerId)
        .maybeSingle()

      if (referrerProfile) {
        await db
          .from('profiles')
          .update({
            tier: 'pro',
            tier_expires_at: extendExpiry(referrerProfile, milestone.pro_days_reward),
            pro_plan: nextProPlan(referrerProfile),
          })
          .eq('id', referrerId)

        await db.from('referral_events').update({ reward_granted: true }).eq('id', eventId)
        milestoneReached = milestone.referral_count_required
      }
    }

    // NOTE: the steps above are separate round-trips, not one transaction --
    // same trade-off confirm-upload already makes. A network drop between
    // "activated=true" and "reward granted" leaves the event activated but
    // unrewarded, with no automatic retry (the client's local flag stops
    // calling again after any 200 response). Accepted for v1, same risk
    // class as confirm-upload's documented R2-orphan gap.
    return json({ activated: true, milestone_reached: milestoneReached })
  }),
)
```

- [ ] **Step 2: Deploy**

`mcp__claude_ai_Supabase__deploy_edge_function` (name: `process-referral-activation`) atau `supabase functions deploy process-referral-activation`. Deploy menjalankan typecheck Deno — kegagalan tipe akan gagal di sini.

- [ ] **Step 3: Verifikasi manual minimal**

Dengan dua akun test (kalau tersedia): daftar akun B pakai kode referral akun A, panggil endpoint sebagai B (lewat app setelah Task 11 selesai, atau `curl` dengan JWT B), lalu cek lewat `execute_sql`:

```sql
select activated, activated_at, reward_granted from public.referral_events
where referrer_id = '<id A>' and referred_id = '<id B>';
```

Expected: `activated = true`. Verifikasi penuh (termasuk milestone crossing) realistis baru dilakukan di Task 12 setelah UI klien ada.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/process-referral-activation/index.ts
git commit -m "feat(fase8): Edge Function process-referral-activation

Verifikasi referred_by, tulis first_scan_completed_at, aktivasi
referral_events sekali (idempotent lewat flag activated), reward 1 hari
ke referred_id, cek milestone persis untuk referrer. Non-atomik
langkah-demi-langkah, pola sama seperti confirm-upload.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Ekstrak `edgeFunctionClient.ts` dari `backupApi.ts`

**Files:**
- Create: `src/lib/edgeFunctionClient.ts`
- Test: `src/lib/edgeFunctionClient.test.ts`
- Modify: `src/lib/backupApi.ts:1-42`

**Interfaces:**
- Consumes: `src/lib/supabase.ts` (`supabase` client, sudah ada).
- Produces: `export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T>` — dipakai `backupApi.ts` (task ini) dan `referralApi.ts` (Task 8).

- [ ] **Step 1: Write the failing test**

Create `src/lib/edgeFunctionClient.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke } },
}))

const { callFunction } = await import('./edgeFunctionClient')

beforeEach(() => {
  invoke.mockReset()
})

describe('callFunction', () => {
  it('returns the data the function responded with', async () => {
    invoke.mockResolvedValue({ data: { activated: true }, error: null })

    const result = await callFunction<{ activated: boolean }>('process-referral-activation', {})

    expect(result).toEqual({ activated: true })
    expect(invoke).toHaveBeenCalledWith('process-referral-activation', { body: {} })
  })

  it('surfaces the server message when the Edge Function reports one', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { context: new Response(JSON.stringify({ message: 'Kuota penuh.' })) },
    })

    await expect(callFunction('generate-upload-url', {})).rejects.toThrow('Kuota penuh.')
  })

  it('falls back to a generic message when the error carries none', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: undefined } })

    await expect(callFunction('generate-upload-url', {})).rejects.toThrow(
      'Gagal menghubungi server. Periksa koneksi lalu coba lagi.',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- edgeFunctionClient.test`
Expected: FAIL — `Cannot find module './edgeFunctionClient'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/edgeFunctionClient.ts`:

```ts
import { supabase } from './supabase'

/** Errors carry an Indonesian message straight from the Edge Function. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })

  if (error) {
    // Supabase wraps non-2xx responses; dig out our own message when present.
    const context = (error as { context?: Response }).context
    const parsed = await context
      ?.json()
      .catch(() => null)
      .then((value: { message?: string } | null) => value?.message)

    throw new Error(parsed ?? 'Gagal menghubungi server. Periksa koneksi lalu coba lagi.')
  }

  return data as T
}
```

- [ ] **Step 4: Rewire `backupApi.ts`**

Read `src/lib/backupApi.ts:1-42` first. Replace the local `callFunction` definition with an import:

```ts
import { buildPdfFile } from './documentExport'
import { callFunction } from './edgeFunctionClient'
import type { LocalScanDocument } from './scanStorage'
import type { Tier } from './tier'
```

Remove the local `async function callFunction<T>(...)` block entirely (was lines ~27-42) — everything below it (`backupDocument` and the rest of the file) stays unchanged, since the extracted function has an identical signature and behaviour.

- [ ] **Step 5: Run both this test and the existing `backupApi.test.ts`**

Run: `npm run test:node -- edgeFunctionClient.test backupApi.test`
Expected: PASS, both files green (backupApi.test.ts behaviour is unchanged since `callFunction` moved, not modified).

- [ ] **Step 6: Commit**

```bash
git add src/lib/edgeFunctionClient.ts src/lib/edgeFunctionClient.test.ts src/lib/backupApi.ts
git commit -m "refactor(lib): ekstrak callFunction ke edgeFunctionClient.ts

Dipindah dari backupApi.ts supaya bisa dipakai ulang referralApi.ts
(Task 8) tanpa duplikasi. Perilaku tidak berubah -- backupApi.test.ts
tetap hijau tanpa modifikasi.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Flag lokal `referralActivation.ts`

**Files:**
- Create: `src/lib/referralActivation.ts`
- Test: `src/lib/referralActivation.test.ts`

**Interfaces:**
- Consumes: nothing (pure `Storage` wrapper, pola sama seperti `exportPreference.ts`).
- Produces: `export function hasSentReferralActivation(storage?: Storage): boolean`, `export function markReferralActivationSent(storage?: Storage): void` — dipakai Task 11 (`App.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/referralActivation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { hasSentReferralActivation, markReferralActivationSent } from './referralActivation'

/** Minimal in-memory Storage, mirrors the fakeStorage helper in adFrequency.test.ts. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

/** Storage that throws on every operation, like a locked-down WebView. */
function brokenStorage(): Storage {
  const boom = () => {
    throw new Error('storage disabled')
  }
  return {
    get length(): number {
      return boom()
    },
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  }
}

describe('hasSentReferralActivation / markReferralActivationSent', () => {
  it('is false before anything is marked', () => {
    expect(hasSentReferralActivation(fakeStorage())).toBe(false)
  })

  it('is true after marking', () => {
    const storage = fakeStorage()
    markReferralActivationSent(storage)
    expect(hasSentReferralActivation(storage)).toBe(true)
  })

  it('treats unreadable storage as not-yet-sent, so the call is retried', () => {
    expect(hasSentReferralActivation(brokenStorage())).toBe(false)
  })

  it('does not throw when storage rejects the write', () => {
    expect(() => markReferralActivationSent(brokenStorage())).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- referralActivation.test`
Expected: FAIL — `Cannot find module './referralActivation'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/referralActivation.ts`:

```ts
const SENT_KEY = 'scannapp.referral.activationSent'

/**
 * Whether this install has already told the server about its first scan, so
 * a pending referral (if any) could activate.
 *
 * Storage can be unavailable (private mode, a WebView with data cleared);
 * failing that read as "not sent yet" is the safe default -- worst case the
 * call fires again next scan, which the server already treats as a no-op.
 */
export function hasSentReferralActivation(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(SENT_KEY) === 'true'
  } catch {
    return false
  }
}

export function markReferralActivationSent(storage: Storage = localStorage): void {
  try {
    storage.setItem(SENT_KEY, 'true')
  } catch {
    // Remembering this is never worth failing a scan save over.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:node -- referralActivation.test`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/referralActivation.ts src/lib/referralActivation.test.ts
git commit -m "feat(fase8): flag lokal sekali-kirim untuk aktivasi referral

Pola sama seperti exportPreference.ts/adFrequency.ts. Dipakai App.tsx
(Task 11) supaya triggerReferralActivation() cuma dipanggil sekali
seumur install, bukan tiap scan.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `referralApi.ts` — progres & trigger aktivasi

**Files:**
- Create: `src/lib/referralApi.ts`
- Test: `src/lib/referralApi.test.ts`

**Interfaces:**
- Consumes: `callFunction` (Task 6, `edgeFunctionClient.ts`), `supabase` (`src/lib/supabase.ts`).
- Produces:
  - `export interface ReferralMilestone { count: number; proDays: number }`
  - `export interface ReferralProgress { activatedCount: number; milestones: ReferralMilestone[] }`
  - `export async function fetchReferralProgress(): Promise<ReferralProgress>`
  - `export async function triggerReferralActivation(): Promise<void>`
  - Dipakai Task 10 (`ReferralScreen.tsx`) dan Task 11 (`App.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/referralApi.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const from = vi.fn()

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke }, from },
}))

const { fetchReferralProgress, triggerReferralActivation } = await import('./referralApi')

beforeEach(() => {
  invoke.mockReset()
  from.mockReset()
})

describe('fetchReferralProgress', () => {
  /** Mimics the PostgREST count-only builder: select+eq resolves directly. */
  function countBuilder(count: number) {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(async () => ({ data: null, count, error: null })),
    }
    return builder
  }

  /** Mimics the milestone list builder: select+eq chain, order resolves. */
  function milestoneBuilder(rows: Record<string, unknown>[]) {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(async () => ({ data: rows, error: null })),
    }
    return builder
  }

  it('reports the activated count and the milestone ladder', async () => {
    from.mockImplementation((table: string) =>
      table === 'referral_events'
        ? countBuilder(6)
        : milestoneBuilder([
            { referral_count_required: 5, pro_days_reward: 7 },
            { referral_count_required: 15, pro_days_reward: 25 },
            { referral_count_required: 30, pro_days_reward: 60 },
          ]),
    )

    const progress = await fetchReferralProgress()

    expect(progress.activatedCount).toBe(6)
    expect(progress.milestones).toEqual([
      { count: 5, proDays: 7 },
      { count: 15, proDays: 25 },
      { count: 30, proDays: 60 },
    ])
  })

  it('reads zero activations as zero, not null', async () => {
    from.mockImplementation((table: string) =>
      table === 'referral_events' ? countBuilder(0) : milestoneBuilder([]),
    )

    expect((await fetchReferralProgress()).activatedCount).toBe(0)
  })
})

describe('triggerReferralActivation', () => {
  it('calls the Edge Function with no body', async () => {
    invoke.mockResolvedValue({ data: { activated: false }, error: null })

    await triggerReferralActivation()

    expect(invoke).toHaveBeenCalledWith('process-referral-activation', { body: {} })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- referralApi.test`
Expected: FAIL — `Cannot find module './referralApi'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/referralApi.ts`:

```ts
import { callFunction } from './edgeFunctionClient'
import { supabase } from './supabase'

export interface ReferralMilestone {
  count: number
  proDays: number
}

export interface ReferralProgress {
  activatedCount: number
  milestones: ReferralMilestone[]
}

interface MilestoneRow {
  referral_count_required: number
  pro_days_reward: number
}

/**
 * Own referral progress: how many invited friends have activated, and the
 * milestone ladder. RLS already scopes `referral_events` to rows where the
 * caller is the referrer, so no id has to be passed in.
 */
export async function fetchReferralProgress(): Promise<ReferralProgress> {
  const [{ count }, { data: milestoneRows }] = await Promise.all([
    supabase.from('referral_events').select('id', { count: 'exact', head: true }).eq('activated', true),
    supabase
      .from('referral_milestones')
      .select('referral_count_required, pro_days_reward')
      .eq('active', true)
      .order('referral_count_required', { ascending: true }),
  ])

  return {
    activatedCount: count ?? 0,
    milestones: ((milestoneRows ?? []) as MilestoneRow[]).map((row) => ({
      count: row.referral_count_required,
      proDays: row.pro_days_reward,
    })),
  }
}

/** Tells the server this install just finished its first scan, so a pending referral (if any) can activate. */
export async function triggerReferralActivation(): Promise<void> {
  await callFunction('process-referral-activation', {})
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:node -- referralApi.test`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/referralApi.ts src/lib/referralApi.test.ts
git commit -m "feat(fase8): referralApi.ts -- progres milestone & trigger aktivasi

fetchReferralProgress() dan triggerReferralActivation(), dipakai
ReferralScreen (Task 10) dan App.tsx (Task 11).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Field kode referral di `AuthScreen`

**Files:**
- Modify: `src/auth/authContext.ts:28`
- Modify: `src/auth/AuthProvider.tsx:112-123`
- Modify: `src/screens/AuthScreen.tsx`
- Test: `src/screens/AuthScreen.browser.test.tsx`

**Interfaces:**
- Consumes: nothing baru.
- Produces: `signUp(email, password, displayName, referredByCode?)` — signature baru, satu-satunya pemanggil adalah `AuthScreen.tsx` sendiri, jadi tidak ada task lain yang perlu disinkronkan.

- [ ] **Step 1: Write the failing test**

Create `src/screens/AuthScreen.browser.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

const signUp = vi.fn().mockResolvedValue({ signedIn: true })
const signIn = vi.fn().mockResolvedValue(undefined)

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ signIn, signUp }),
}))

const { AuthScreen } = await import('./AuthScreen')

async function renderAuth(mode: 'signin' | 'signup' = 'signup') {
  return await render(
    <AuthScreen mode={mode} onModeChange={() => {}} onBack={() => {}} onForgotPassword={() => {}} />,
  )
}

describe('AuthScreen — kode referral', () => {
  it('shows the referral code field only in signup mode', async () => {
    const signup = await renderAuth('signup')
    await expect.element(signup.getByLabelText('Kode referral (opsional)')).toBeVisible()

    const signin = await renderAuth('signin')
    await expect.element(signin.getByLabelText('Kode referral (opsional)')).not.toBeInTheDocument()
  })

  it('sends the trimmed, uppercased code to signUp', async () => {
    const screen = await renderAuth('signup')

    await screen.getByLabelText('Email').fill('user@example.com')
    await screen.getByLabelText('Password').fill('secret6')
    await screen.getByLabelText('Kode referral (opsional)').fill('  k7m2n9pq  ')
    await screen.getByRole('button', { name: 'Buat akun' }).click()

    expect(signUp).toHaveBeenCalledWith('user@example.com', 'secret6', '', 'K7M2N9PQ')
  })

  it('sends undefined when no code is entered', async () => {
    const screen = await renderAuth('signup')

    await screen.getByLabelText('Email').fill('user2@example.com')
    await screen.getByLabelText('Password').fill('secret6')
    await screen.getByRole('button', { name: 'Buat akun' }).click()

    expect(signUp).toHaveBeenCalledWith('user2@example.com', 'secret6', '', undefined)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:browser -- AuthScreen.browser.test`
Expected: FAIL — field "Kode referral (opsional)" tidak ditemukan, dan `signUp` dipanggil dengan 3 argumen bukan 4.

- [ ] **Step 3: Update `authContext.ts`**

Read `src/auth/authContext.ts` first. Change line 28:

```ts
  signUp: (
    email: string,
    password: string,
    displayName: string,
    referredByCode?: string,
  ) => Promise<SignUpOutcome>
```

- [ ] **Step 4: Update `AuthProvider.tsx`**

Read `src/auth/AuthProvider.tsx:112-123` first. Replace the `signUp` callback:

```ts
  const signUp = useCallback(
    async (address: string, password: string, displayName: string, referredByCode?: string) => {
      const { data, error } = await supabase.auth.signUp({
        email: address.trim(),
        password,
        options: {
          data: {
            display_name: displayName.trim(),
            ...(referredByCode ? { referred_by_code: referredByCode } : {}),
          },
        },
      })
      if (error) fail(error)

      // No session means the project still requires email confirmation; the UI
      // shows a "check your email" step instead of dropping the user inside.
      return { signedIn: data.session !== null }
    },
    [],
  )
```

- [ ] **Step 5: Update `AuthScreen.tsx`**

Read `src/screens/AuthScreen.tsx` first. Add state:

```ts
  const [referredByCode, setReferredByCode] = useState('')
```

In `switchMode`, clear it alongside the error reset:

```ts
  const switchMode = (next: AuthMode) => {
    setError(null)
    setReferredByCode('')
    onModeChange(next)
  }
```

In `handleSubmit`, pass the normalised code:

```ts
        const { signedIn } = await signUp(
          email,
          password,
          displayName,
          referredByCode.trim() ? referredByCode.trim().toUpperCase() : undefined,
        )
```

Add the field right after the Nama field (still inside `{mode === 'signup' && ...}` for Nama, but this is its own block since it needs its own `id`/`htmlFor` for `getByLabelText`):

```tsx
        {mode === 'signup' && (
          <label className="field">
            <span className="field__label">Kode referral (opsional)</span>
            <input
              className="field__input"
              type="text"
              autoCapitalize="characters"
              placeholder="Contoh: K7M2N9PQ"
              value={referredByCode}
              onChange={(event) => setReferredByCode(event.target.value)}
            />
          </label>
        )}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:browser -- AuthScreen.browser.test`
Expected: PASS, 3 tests.

- [ ] **Step 7: Full suite sanity check**

Run: `npm test`
Expected: no failures elsewhere — `signUp`'s new fourth parameter is optional, so no other caller breaks.

- [ ] **Step 8: Commit**

```bash
git add src/auth/authContext.ts src/auth/AuthProvider.tsx src/screens/AuthScreen.tsx src/screens/AuthScreen.browser.test.tsx
git commit -m "feat(fase8): field kode referral opsional di form Daftar

signUp() dapat parameter referredByCode opsional, dikirim sebagai
signup metadata referred_by_code yang di-resolve trigger handle_new_user
(Task 1). Kode dinormalisasi trim+uppercase sebelum dikirim.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Layar `ReferralScreen` — kode & progres

**Files:**
- Modify: `src/components/Icons.tsx` (tambah `GiftIcon`)
- Create: `src/screens/ReferralScreen.tsx`
- Modify: `src/auth.css` (kelas baru `.referral-*`)
- Test: `src/screens/ReferralScreen.browser.test.tsx`

**Interfaces:**
- Consumes: `fetchReferralProgress`, `type ReferralProgress` (Task 8); `useAuth` (untuk `profile.referralCode`, sudah ada); `GiftIcon`, `ChevronLeftIcon` (`Icons.tsx`).
- Produces: `ReferralScreen({ referralCode, onBack, onError, fetchProgress?, shareCode? }: ReferralScreenProps)` — dipakai Task 11 (`App.tsx`, tanpa perlu mengisi `fetchProgress`/`shareCode`, keduanya default ke fungsi asli).

**Catatan penting sebelum mulai:** Task 9 menemukan `vi.mock(...)` **tidak berfungsi sama sekali** di suite `browser` (Playwright) proyek ini — dikonfirmasi lewat reproduksi minimal terpisah, dan tidak ada satu pun `.browser.test.tsx` di codebase ini yang pernah memakainya. Karena itu Step 2 & Step 4 di bawah **sengaja berbeda** dari draf awal: `ReferralScreen` menerima `fetchProgress`/`shareCode` sebagai prop opsional (default ke `fetchReferralProgress`/`Share.share` asli) alih-alih meng-import & memanggilnya langsung — pola dependency-injection-lewat-prop, bukan `vi.mock`. `App.tsx` (Task 11) tidak perlu tahu soal ini sama sekali karena keduanya opsional dengan default.

- [ ] **Step 1: Tambah `GiftIcon` ke `Icons.tsx`**

Read `src/components/Icons.tsx` first. Append after the last icon (`TextIcon`), same file, same `base(size)` style:

```tsx
export function GiftIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="4" y="9.5" width="16" height="4" rx="1" />
      <rect x="5.5" y="13.5" width="13" height="7" rx="1.2" />
      <path d="M12 9.5v11" />
      <path d="M12 9.5c-1.4 0-3-1-3-2.6A2.4 2.4 0 0 1 11.4 4.5c1.7 0 2.6 2.6 2.6 5" />
      <path d="M12 9.5c1.4 0 3-1 3-2.6A2.4 2.4 0 0 0 12.6 4.5c-1.7 0-2.6 2.6-2.6 5" />
    </svg>
  )
}
```

- [ ] **Step 2: Write the failing test**

Create `src/screens/ReferralScreen.browser.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ReferralProgress } from '../lib/referralApi'
import { ReferralScreen } from './ReferralScreen'

const PROGRESS: ReferralProgress = {
  activatedCount: 6,
  milestones: [
    { count: 5, proDays: 7 },
    { count: 15, proDays: 25 },
    { count: 30, proDays: 60 },
  ],
}

describe('ReferralScreen', () => {
  it('shows the referral code', async () => {
    const screen = await render(
      <ReferralScreen
        referralCode="K7M2N9PQ"
        onBack={() => {}}
        onError={() => {}}
        fetchProgress={async () => PROGRESS}
        shareCode={async () => {}}
      />,
    )

    await expect.element(screen.getByText('K7M2N9PQ')).toBeVisible()
  })

  it('marks a milestone already crossed as reached', async () => {
    const screen = await render(
      <ReferralScreen
        referralCode="K7M2N9PQ"
        onBack={() => {}}
        onError={() => {}}
        fetchProgress={async () => PROGRESS}
        shareCode={async () => {}}
      />,
    )

    await expect.element(screen.getByText(/5 orang.*7 hari Pro.*Tercapai/)).toBeVisible()
  })

  it('does not mark an unreached milestone as reached', async () => {
    const screen = await render(
      <ReferralScreen
        referralCode="K7M2N9PQ"
        onBack={() => {}}
        onError={() => {}}
        fetchProgress={async () => PROGRESS}
        shareCode={async () => {}}
      />,
    )

    await expect.element(screen.getByText(/15 orang.*25 hari Pro/)).not.toHaveTextContent('Tercapai')
  })

  it('reports an error when progress fails to load', async () => {
    const onError = vi.fn()
    await render(
      <ReferralScreen
        referralCode="K7M2N9PQ"
        onBack={() => {}}
        onError={onError}
        fetchProgress={async () => {
          throw new Error('network down')
        }}
        shareCode={async () => {}}
      />,
    )

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Gagal memuat progres referral.'))
  })
})
```

Setiap test merender sekali saja (bukan dua kali seperti `AuthScreen.browser.test.tsx`), jadi masalah leak antar-render yang ditemukan Task 9 tidak relevan di sini — tidak perlu `.unmount()`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:browser -- ReferralScreen.browser.test`
Expected: FAIL — `Cannot find module './ReferralScreen'`.

- [ ] **Step 4: Write minimal implementation**

Create `src/screens/ReferralScreen.tsx`:

```tsx
import { Share } from '@capacitor/share'
import { useEffect, useState } from 'react'
import { ChevronLeftIcon, GiftIcon } from '../components/Icons'
import { fetchReferralProgress, type ReferralProgress } from '../lib/referralApi'

interface ReferralScreenProps {
  referralCode: string | null
  onBack: () => void
  onError: (message: string) => void
  /** Overridable for tests -- defaults to the real Edge Function-backed fetch. */
  fetchProgress?: () => Promise<ReferralProgress>
  /** Overridable for tests -- defaults to the real native share sheet. */
  shareCode?: (options: { title: string; text: string }) => Promise<void>
}

export function ReferralScreen({
  referralCode,
  onBack,
  onError,
  fetchProgress = fetchReferralProgress,
  shareCode = Share.share,
}: ReferralScreenProps) {
  const [progress, setProgress] = useState<ReferralProgress | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchProgress()
      .then((result) => {
        if (!cancelled) setProgress(result)
      })
      .catch(() => {
        if (!cancelled) onError('Gagal memuat progres referral.')
      })
    return () => {
      cancelled = true
    }
  }, [fetchProgress, onError])

  const handleShare = async () => {
    if (!referralCode) return
    try {
      await shareCode({
        title: 'Ajak teman pakai ScannApp',
        text: `Pakai kode referral ${referralCode} saat daftar di ScannApp -- kita berdua dapat hari Pro gratis! Masukkan kode ini di form Daftar.`,
      })
    } catch {
      // User cancelled the share sheet -- not an error worth surfacing.
    }
  }

  const activatedCount = progress?.activatedCount ?? 0

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Kembali">
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          <h1>Ajak Teman</h1>
          <p>Bagikan kodemu, dapat hari Pro gratis</p>
        </div>
      </header>

      <section className="card referral-code-card">
        <span className="referral-code-card__label">Kode referral kamu</span>
        <span className="referral-code-card__value">{referralCode ?? '—'}</span>
        <button
          type="button"
          className="button button--primary referral-code-card__share"
          onClick={handleShare}
          disabled={!referralCode}
        >
          <GiftIcon size={18} />
          <span>Bagikan kode</span>
        </button>
      </section>

      <h2 className="section-label">Progres</h2>

      <section className="card">
        <div className="card__row">
          <span className="card__row-label">Teman yang sudah aktif</span>
          <span className="card__row-value">{activatedCount} orang</span>
        </div>
      </section>

      <section className="card referral-milestones">
        {(progress?.milestones ?? []).map((milestone) => {
          const reached = activatedCount >= milestone.count
          const ratio = milestone.count > 0 ? activatedCount / milestone.count : 0

          return (
            <div
              key={milestone.count}
              className={`referral-milestone${reached ? ' referral-milestone--reached' : ''}`}
            >
              <div className="referral-milestone__track">
                <div
                  className="referral-milestone__fill"
                  style={{ width: `${Math.min(100, ratio * 100)}%` }}
                />
              </div>
              <span className="referral-milestone__label">
                {milestone.count} orang &rarr; {milestone.proDays} hari Pro
                {reached && ' · Tercapai'}
              </span>
            </div>
          )
        })}
      </section>
    </div>
  )
}
```

- [ ] **Step 5: Tambah CSS**

Read `src/auth.css` around line 607-614 first (`.quota__warning` ... `.card__row-icon`). Insert new rules right after `.quota__warning`'s closing brace:

```css
/* ---------- Ajak Teman (referral) ---------- */

.referral-code-card {
  align-items: center;
  text-align: center;
}

.referral-code-card__label {
  font-size: 0.83rem;
  color: var(--fg-dim);
}

.referral-code-card__value {
  font-size: 1.8rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--acc);
}

.referral-code-card__share {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.referral-milestones {
  gap: 16px;
}

.referral-milestone__track {
  height: 8px;
  border-radius: 999px;
  background: var(--chip);
  overflow: hidden;
}

.referral-milestone__fill {
  height: 100%;
  border-radius: 999px;
  background: var(--acc);
  transition: width 240ms ease-out;
}

.referral-milestone--reached .referral-milestone__fill {
  background: var(--pro-gold);
}

.referral-milestone__label {
  display: block;
  margin-top: 6px;
  font-size: 0.83rem;
  font-weight: 600;
  color: var(--fg-dim);
}

.referral-milestone--reached .referral-milestone__label {
  color: var(--fg);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:browser -- ReferralScreen.browser.test`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/Icons.tsx src/screens/ReferralScreen.tsx src/screens/ReferralScreen.browser.test.tsx src/auth.css
git commit -m "feat(fase8): layar ReferralScreen -- kode, bagikan, progres milestone

Kode ditampilkan besar + tombol Bagikan (@capacitor/share, teks
kode+instruksi, bukan link -- tidak ada infrastruktur deep-link).
Progres 3 milestone dengan track/fill mengikuti pola QuotaBar, warna
pro-gold untuk yang sudah tercapai.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Sambungkan ke `App.tsx` & `SettingsScreen.tsx`

**Files:**
- Modify: `src/screens/SettingsScreen.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `ReferralScreen` (Task 10), `hasSentReferralActivation`/`markReferralActivationSent` (Task 7), `triggerReferralActivation` (Task 8).
- Produces: nothing baru untuk task lain — ini titik penyambungan akhir.

- [ ] **Step 1: Tambah baris "Ajak Teman" di `SettingsScreen.tsx`**

Read `src/screens/SettingsScreen.tsx` first. Add `GiftIcon` to the icon import:

```ts
import { ChevronRightIcon, CloudIcon, GiftIcon, LogoutIcon, ScanIcon, TrashIcon } from '../components/Icons'
```

Add `onOpenReferral` to the props interface:

```ts
interface SettingsScreenProps {
  documentCount: number
  usedBytes: number
  quotaBytes: number
  onDeleteAll: () => void
  onSignOut: () => void
  onOpenBackups: () => void
  onOpenReferral: () => void
  onUpgrade: () => void
}
```

Destructure it in the function signature (add after `onOpenBackups`), then add a new row right after the "Cadangan di cloud" `<section className="card">` block (before `<h2 className="section-label">Preferensi</h2>`):

```tsx
      <section className="card">
        <button type="button" className="card__row card__row--button" onClick={onOpenReferral}>
          <span className="card__row-label">
            <GiftIcon size={17} className="card__row-icon" />
            Ajak Teman
          </span>
          <ChevronRightIcon size={18} />
        </button>
      </section>
```

- [ ] **Step 2: Tambah view `referral` di `App.tsx`**

Read the `View` type (`src/App.tsx:95-103`) and add a variant:

```ts
type View =
  | { kind: 'tabs' }
  | { kind: 'detail'; id: string }
  | { kind: 'editor'; id: string }
  | { kind: 'split'; id: string }
  | { kind: 'viewer'; id: string; pageIndex: number }
  | { kind: 'merge' }
  | { kind: 'backups' }
  | { kind: 'referral' }
  | { kind: 'upgrade' }
```

- [ ] **Step 3: Render block**

Read around `src/App.tsx:1140-1155` (the `if (view.kind === 'backups')` block) first, and add a sibling block right after it:

```tsx
  if (view.kind === 'referral') {
    return (
      <div className="app">
        <ReferralScreen
          referralCode={profile?.referralCode ?? null}
          onBack={() => setView({ kind: 'tabs' })}
          onError={setToast}
        />
        {toast && <p className="toast">{toast}</p>}
      </div>
    )
  }
```

- [ ] **Step 4: Import & wire the Settings row**

Add the import near the other screen imports (`src/App.tsx:66-80`):

```ts
import { ReferralScreen } from './screens/ReferralScreen'
```

Read around `src/App.tsx:1365-1375` (the `<SettingsScreen ...>` call) and add the new prop:

```tsx
        {tab === 'settings' && (
          <SettingsScreen
            documentCount={documents.length}
            usedBytes={usedBytes}
            quotaBytes={quotaBytes}
            onDeleteAll={handleDeleteAll}
            onSignOut={handleSignOut}
            onOpenBackups={() => setView({ kind: 'backups' })}
            onOpenReferral={() => setView({ kind: 'referral' })}
            onUpgrade={() => setView({ kind: 'upgrade' })}
          />
        )}
```

- [ ] **Step 5: Trigger aktivasi setelah scan pertama**

Add the imports near the other `lib` imports in `src/App.tsx`:

```ts
import { hasSentReferralActivation, markReferralActivationSent } from './lib/referralActivation'
import { triggerReferralActivation } from './lib/referralApi'
```

Read `src/App.tsx:440-460` (`handleSaveDocument`) first. Insert the trigger right after `await saveScanDocument(pendingPages)` succeeds, before `await refreshDocuments()`:

```ts
  const handleSaveDocument = async () => {
    if (!pendingPages) return
    setIsSaving(true)
    try {
      await saveScanDocument(pendingPages)

      // Fire-and-forget: a referral (if any) activates after the first ever
      // scan. Failure here must never surface as "Gagal menyimpan dokumen" --
      // the document is already saved. Retried next scan if it fails, since
      // the local flag is only set on success.
      if (!hasSentReferralActivation()) {
        triggerReferralActivation()
          .then(() => markReferralActivationSent())
          .catch((error) => console.error('Referral activation failed:', error))
      }

      await refreshDocuments()
      revokeStraightenedUris(pendingPages)
      setPendingPages(null)
      exitSplit()
      setTab('documents')
      setToast('Dokumen tersimpan.')
      // Counted per saved document, not per scanner launch: a cancelled scan
      // produced nothing, so it should not cost the user an ad.
      void maybeShowInterstitial('scan-saved', tier)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal menyimpan dokumen.')
    } finally {
      setIsSaving(false)
    }
```

(Baris-baris setelah `handleSaveDocument`'s try block, termasuk `finally`, tidak berubah — ini cuma menyisipkan satu blok baru di antara dua baris yang sudah ada.)

- [ ] **Step 6: Verifikasi build & lint**

Run: `npm run build`
Expected: PASS — typecheck + build tanpa error (App.tsx tidak punya test file di codebase ini, diverifikasi lewat build + lint + checklist manual, pola sama seperti task App.tsx di Fase 6/7A/7B).

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Full suite**

Run: `npm test`
Expected: PASS, sekitar 938 + (13+3+4+3+4) = **965 tes** (67+? file — jumlah file naik dari file test baru Task 4/6/7/8/9/10; jadikan pemeriksaan kasar, bukan target persis).

- [ ] **Step 8: Commit**

```bash
git add src/screens/SettingsScreen.tsx src/App.tsx
git commit -m "feat(fase8): sambungkan ReferralScreen ke Settings & trigger aktivasi

Baris 'Ajak Teman' di SettingsScreen membuka ReferralScreen baru.
handleSaveDocument memanggil triggerReferralActivation() sekali
seumur install, tepat setelah scan pertama tersimpan -- fire-and-forget,
tidak pernah mengganggu alur simpan dokumen.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: `TASKS.md` & verifikasi akhir

**Files:**
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: seluruh Task 1-11.
- Produces: nothing (task penutup).

- [ ] **Step 1: Update checklist Fase 8**

Read the `## Fase 8 — Program Referral` section of `TASKS.md` first (5 item tersisa setelah `referral_milestones` dicentang di commit spec). Centang kelima item, dan tambahkan checklist uji device di bawahnya:

```markdown
## Fase 8 — Program Referral

- [x] UI generate & share kode referral — `ReferralScreen`, tombol Bagikan lewat `@capacitor/share`
- [x] Edge Function `process-referral-activation`
- [x] Tabel `referral_milestones` diisi dengan angka final: 5 orang→7 hari, 15 orang→25 hari, 30 orang→60 hari Pro — sudah ter-seed sejak migration `20260725093606_seed_referral_milestones.sql` (Fase 3), baru disadari & dicentang saat mulai Fase 8 (31 Agustus 2026)
- [x] Edge Function terjadwal `expire-pro-status` — diimplementasikan sebagai `pg_cron` job langsung, bukan Edge Function terjadwal (isinya cuma satu UPDATE, lihat spec Bagian 4.4)
- [x] UI progress referral (berapa orang sudah invite, menuju milestone berikutnya)
- [ ] Uji anti-abuse: 1 device/akun tidak bisa refer diri sendiri berkali-kali — **anti-abuse v1 sengaja terbatas** (email + activation saja, lihat spec Bagian 2 keputusan #2); device-fingerprint di luar cakupan Fase 8, jadi **known gap**, dicatat di Fase 9 di bawah

### Uji device (checklist manual sebelum dianggap tuntas)

- [ ] Dua akun test: A share kode ke B lewat tombol Bagikan, B daftar dengan kode itu terisi (form Daftar) sebelum konfirmasi email.
- [ ] B scan 1 dokumen pertama kalinya → cek A menerima 7 hari Pro setelah 5 referral aktif ter-akumulasi (perlu 5 akun B berbeda untuk cek milestone pertama secara penuh; minimal cek 1 aktivasi tercatat & B sendiri dapat 1 hari Pro).
- [ ] B yang sudah Pro bulanan sebelum diundang: aktivasi tidak menurunkan `pro_plan`-nya jadi `'referral'` (quota tetap 500MB/1GB sesuai plan aslinya).
- [ ] Coba `PATCH` `first_scan_completed_at`/`referred_by`/`referral_code` langsung ke REST API Supabase sebagai user biasa (bukan lewat app) → harus ditolak RLS.
- [ ] Cek `cron.job` di dashboard Supabase menunjukkan `expire-pro-status` aktif dan pernah berjalan (tunggu ≥1 hari, atau uji manual lewat `execute_sql`).
```

- [ ] **Step 2: Tambahkan known gap di Fase 9**

Read the `## Fase 9 — QA & Hardening` section of `TASKS.md` first, and add a bullet near the existing RLS security-review item:

```markdown
- [ ] **Anti-abuse referral device-level** — Fase 8 v1 cuma menegakkan email unik + `referred_by`/`first_scan_completed_at` dibekukan RLS. Satu orang masih bisa bikin banyak akun email untuk refer diri sendiri berkali-kali. Butuh plugin native baru (`@capacitor/device` atau setara), known gap yang disengaja — lihat `docs/superpowers/specs/2026-09-01-fase8-referral-design.md` Bagian 2 & 7.
```

- [ ] **Step 3: Commit**

```bash
git add TASKS.md
git commit -m "docs(tasks): tandai Fase 8 selesai di kode, catat known gap anti-abuse

Semua item Fase 8 dicentang kecuali anti-abuse device-level (v1
sengaja terbatas ke email+activation, dipindah jadi known gap Fase 9).
Checklist uji device ditambahkan untuk verifikasi manual sebelum rilis.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Bagian 4.1 (kolom) → Task 1. Bagian 4.2 (trigger) → Task 1. Bagian 4.3 (freeze RLS) → Task 2. Bagian 4.4 (cron) → Task 3. Bagian 4.5 (seed sudah ada) → dicatat, tidak ada task baru. Bagian 5 (Edge Function) → Task 4+5. Bagian 6 (client: edgeFunctionClient, referralApi, referralActivation, AuthScreen, App.tsx, SettingsScreen, ReferralScreen) → Task 6-11. Bagian 7 (anti-abuse) → dicatat di Global Constraints + Task 12 known gap. Bagian 8 (testing) → tiap task punya test sendiri di suite yang benar.

**Placeholder scan:** Tidak ada TBD/TODO. Semua langkah kode berisi implementasi nyata, bukan deskripsi.

**Type consistency:** `ProProfileRow`/`Milestone` (Task 4) dipakai identik di Task 5. `ReferralProgress`/`ReferralMilestone` (Task 8) dipakai identik di Task 10. `callFunction<T>` (Task 6) dipakai identik di Task 8. `signUp(email, password, displayName, referredByCode?)` (Task 9) konsisten antara `authContext.ts`, `AuthProvider.tsx`, dan pemanggilan di `AuthScreen.tsx`. `hasSentReferralActivation`/`markReferralActivationSent` (Task 7) dipakai identik di Task 11.
