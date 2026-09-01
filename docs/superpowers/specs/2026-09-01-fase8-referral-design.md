# Fase 8 — Program Referral

**1 September 2026.** Spec ini menuliskan hasil brainstorm hari yang sama, setelah Fase 7A+7B (Perbaiki Pencahayaan + Luruskan Halaman) selesai di-merge ke `main`. Mekanisme dan angka bisnisnya sudah final sejak PRD Bagian 5 dan `CLAUDE.md` Bagian 6 — yang belum ada adalah rancangan teknis yang bisa dieksekusi, dan tiga keputusan baru yang muncul saat brainstorm (lihat Bagian 2).

---

## 1. Status awal — lebih siap dari catatan `TASKS.md`

Sebelum brainstorm ini, `TASKS.md` Fase 8 mencatat semuanya belum dikerjakan. Faktanya, sejak Fase 3 sudah ada:

- Tabel `profiles.referral_code` / `referred_by`, `referral_events`, `referral_milestones` — lengkap dengan RLS.
- `referral_milestones` **sudah ter-seed** dengan angka final (5→7, 15→25, 30→60 hari) di migration `20260725093606_seed_referral_milestones.sql`.
- Trigger `handle_new_user()` sudah generate `referral_code` unik per akun (fungsi `generate_referral_code()`).
- Client (`profileApi.ts`, `tier.ts`, `storageQuota.ts`) sudah membaca `referral_code` dan mengenal `pro_plan: 'referral'` (kuota 500MB).

Yang **belum ada sama sekali**: UI generate/share/progress, Edge Function `process-referral-activation`, job `expire-pro-status`, field input kode referral saat signup, dan — penting — `handle_new_user()` belum pernah mengisi `referred_by` (kolomnya ada, tapi tidak ada jalur yang menulisinya).

## 2. Tiga keputusan Boss Ali dari brainstorm ini

1. **Verifikasi "sudah scan"**: tabel `scan_documents` (yang disebut di `BACKEND_API_DESIGN.md` Bagian 6 & 9 sebagai sumber verifikasi) **hanya terisi saat dokumen di-backup ke cloud** — bukan saat scan disimpan lokal (arsitektur local-first, dan hak tulis client ke tabel itu sudah dicabut total di Fase 5). Diputuskan: tambah kolom `profiles.first_scan_completed_at`, ditulis oleh Edge Function (service role) saat client melapor scan pertama selesai — bukan bergantung pada `scan_documents`.
2. **Cakupan anti-abuse v1**: **email + activation saja** (1 email = 1 akun lewat Supabase Auth, 1 kode/akun, reward hanya cair lewat scan sungguhan). Device-fingerprint (butuh plugin native baru, tidak ada di app ini) **di luar cakupan Fase 8** — dicatat sebagai known gap untuk Fase 9, pola sama seperti noise-reduction di Fase 7A dan deteksi tepi otomatis di Fase 7B.
3. **Input kode referral**: field teks opsional di form Daftar. **Tidak ada deep-link** (`scannapp://ref/...` atau universal link) di v1 — tidak ada infrastruktur untuk itu di app ini, dan menambahkannya akan memperbesar cakupan Fase 8 secara signifikan.

## 3. Temuan keamanan yang ikut ditutup di sini

Policy `profiles_update_own` (dibuat Fase 0, diperluas Fase 5 untuk membekukan `pro_plan`) **tidak pernah membekukan `referral_code` maupun `referred_by`**. Tanpa perbaikan, user bisa `PATCH` langsung ke REST API Supabase dan mengubah kolom itu di barisnya sendiri — memalsukan siapa yang mereferensikannya. Kolom baru `first_scan_completed_at` (Bagian 2.1) rentan dengan cara yang sama: kalau bisa ditulis client, seluruh gerbang "reward hanya cair setelah scan sungguhan" runtuh, karena user tinggal `PATCH` kolom itu sendiri lalu memanggil `process-referral-activation`. Ketiganya dibekukan di migration Fase 8, pola persis seperti pembekuan `pro_plan` di `20260821211045_fase5_freeze_pro_plan_in_rls.sql`.

## 4. Perubahan database (migration baru)

**4.1 Kolom baru**

```sql
alter table public.profiles
  add column if not exists first_scan_completed_at timestamptz;
```

**4.2 `handle_new_user()` diperluas** — resolve kode referral dari signup metadata, isi `referred_by`, dan buat row `referral_events`:

```sql
-- di dalam handle_new_user(), sebelum insert profiles yang sudah ada:
declare
  referrer_id uuid;
  submitted_code text;
begin
  ...
  submitted_code := upper(trim(coalesce(new.raw_user_meta_data ->> 'referred_by_code', '')));

  if submitted_code <> '' then
    select id into referrer_id from public.profiles where referral_code = submitted_code;
  end if;

  insert into public.profiles (id, display_name, referral_code, referred_by)
  values (new.id, fallback_name, public.generate_referral_code(), referrer_id)
  on conflict (id) do nothing;

  if referrer_id is not null then
    insert into public.referral_events (referrer_id, referred_id)
    values (referrer_id, new.id);
  end if;
  ...
```

Kode tidak valid/kosong/tidak ketemu → `referrer_id` tetap null, `referred_by` null, tidak ada row `referral_events`, dan **signup tetap sukses** — kode referral yang salah ketik tidak boleh menggagalkan pendaftaran.

**4.3 Pembekuan RLS** — `profiles_update_own` di-recreate dengan tiga kolom tambahan di `with check` (pola sama seperti Bagian 3):

```sql
and referral_code is not distinct from (select p.referral_code from public.profiles p where p.id = auth.uid())
and referred_by is not distinct from (select p.referred_by from public.profiles p where p.id = auth.uid())
and first_scan_completed_at is not distinct from (select p.first_scan_completed_at from public.profiles p where p.id = auth.uid())
```

**4.4 `expire-pro-status` sebagai `pg_cron` job**, bukan Edge Function terjadwal — isinya cuma satu `UPDATE`, jadi HTTP round-trip tidak perlu:

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'expire-pro-status',
  '0 0 * * *', -- harian 00:00, sudah final di CLAUDE.md Bagian 6
  $$
    update public.profiles
    set tier = 'basic', tier_expires_at = null, pro_plan = null
    where tier = 'pro' and tier_expires_at is not null and tier_expires_at < now();
  $$
);
```

`pro_plan = null` ditambahkan di sini — desain lama di `BACKEND_API_DESIGN.md` Bagian 7 tidak menyebutnya, tapi tanpa ini baris yang baru turun ke Basic tetap berlabel "Pro Bulanan"/"Pro dari Referral" dst di UI (`tierLabel()` membaca `pro_plan`).

**4.5** `referral_milestones` sudah final — tidak ada migration baru untuk tabel ini.

## 5. Edge Function `process-referral-activation`

Pola sama seperti `confirm-upload` — langkah berurutan lewat `serviceClient()`, bukan satu transaksi SQL (konsisten dengan konvensi Edge Function lain di repo ini), aman diulang berkali-kali:

1. `authenticate()` → `referred_id`.
2. Baca `profiles.referred_by` milik `referred_id`. **Null → return `{ activated: false }`, tidak ada tulisan apa pun.** Fungsi ini murni urusan referral, bukan pencatat aktivitas umum untuk semua user.
3. Tulis `first_scan_completed_at = coalesce(first_scan_completed_at, now())`.
4. `UPDATE referral_events SET activated = true, activated_at = now() WHERE referrer_id = <referred_by> AND referred_id = <referred_id> AND activated = false`, minta baris yang ter-update kembali (`.select()`). **Nol baris ter-update → sudah pernah aktivasi, berhenti di sini** (idempotent — tidak re-grant apa pun).
5. Kalau tepat 1 baris ter-update (aktivasi baru):
   - **Reward `referred_id`** ("give X get Y", 1 hari — `REFERRAL_REFERRED_USER_BONUS_DAYS`): perpanjang `tier_expires_at` dari `max(now(), tier_expires_at saat ini)`. `pro_plan` diisi `'referral'` **hanya kalau sebelumnya `null`** (Basic) — kalau sudah `monthly`/`yearly`, jangan ditimpa, supaya kuota 1GB/500MB miliknya tidak turun jadi 500MB referral.
   - Hitung ulang `COUNT(*) WHERE referrer_id = <referred_by> AND activated = true`.
   - Cocokkan **persis** (`=`, bukan `>=`) ke `referral_milestones.referral_count_required WHERE active = true`. Match → beri `referrer_id` reward hari sesuai `pro_days_reward` (logika perpanjangan sama seperti di atas), tandai `reward_granted = true` di baris `referral_events` yang baru saja diaktivasi.
6. Return `{ activated: boolean, milestone_reached: number | null }` — sekadar buat logging, client tidak perlu menampilkannya.

Helper tanggal (`extendExpiry(current, days)`) ditulis sebagai fungsi murni terpisah supaya bisa di-unit-test di suite `node` tanpa Supabase.

## 6. Perubahan client

- **`src/lib/edgeFunctionClient.ts` baru** — `callFunction<T>()` diekstrak dari `backupApi.ts` (duplikat persis, sekarang dipakai 2 modul). `backupApi.ts` diubah untuk import dari sini, bukan definisi lokal.
- **`src/lib/referralApi.ts` baru** — `fetchReferralProgress()` (query `referral_events` milik sendiri + `referral_milestones`, RLS sudah mengizinkan), `triggerReferralActivation()` (panggil `process-referral-activation` lewat `edgeFunctionClient`).
- **`src/lib/referralActivation.ts` baru** — flag lokal `scannapp.referral.activationSent` (pola sama seperti `exportPreference.ts`/`adFrequency.ts`, `storage: Storage = localStorage` disuntikkan untuk test), supaya endpoint hanya dipanggil sekali seumur install, bukan tiap scan.
- **`AuthScreen.tsx`** (mode signup): field teks baru "Kode referral (opsional)" di bawah Nama → dikirim sebagai `options.data.referred_by_code` di `signUp()`.
- **`App.tsx`**: tepat setelah `saveScanDocument()` sukses (baris ~446), kalau flag `referralActivation` belum terkirim → panggil `triggerReferralActivation()`, lalu set flag (fire-and-forget, kegagalan jaringan tidak mengganggu alur scan — dicoba lagi di scan berikutnya kalau memang belum terkirim).
- **`SettingsScreen.tsx`**: baris baru "Ajak Teman" (pola sama seperti "Cadangan di cloud" → `onOpenBackups`) → `onOpenReferral` ke layar baru.
- **`ReferralScreen.tsx` baru**: kode sendiri ditampilkan besar + tombol "Bagikan" (`@capacitor/share`, pesan teks berisi kode + cara pakai — **bukan link**, konsisten dengan keputusan Bagian 2.3), dan progress 3 milestone (5/15/30) dengan jumlah aktivasi saat ini, milestone yang sudah tercapai ditandai, milestone berikutnya di-highlight.

## 7. Anti-abuse (final untuk v1)

- 1 email = 1 akun (Supabase Auth bawaan).
- 1 kode referral per akun (`generate_referral_code()`, sudah ada).
- `referred_by` diisi sekali di signup, dibekukan setelahnya (Bagian 3/4.3) — tidak bisa diubah lewat REST API.
- `first_scan_completed_at` hanya bisa ditulis service role (Bagian 3/4.3), tapi ini sinyal laporan-sendiri dari client, bukan bukti tervalidasi server bahwa scan benar-benar terjadi — akun mana pun yang sudah diautentikasi bisa memanggil `process-referral-activation` langsung (curl, devtools, client hasil modifikasi) dan mendapat bonus 1 hari Pro untuk dirinya sendiri tanpa pernah scan. Dampaknya kecil dan sudah tercakup oleh known-gap di baris berikutnya (satu orang, satu akun, maksimal untung 1 hari Pro sekali) — dicatat di sini supaya pembaca berikutnya tidak salah anggap ini verifikasi kuat.
- Reward idempotent lewat flag `activated`/`reward_granted` per baris `referral_events` (Bagian 5 langkah 4-5).
- **Known gap, dicatat di `TASKS.md` Fase 9**: tidak ada deteksi device-level (satu orang bikin banyak akun email untuk refer diri sendiri berkali-kali). Butuh plugin native baru (`@capacitor/device` atau setara) — di luar cakupan Fase 8.

## 8. Testing

- **Suite `node`**: `extendExpiry()` (perpanjangan tanggal, termasuk kasus belum-Pro vs sudah-Pro), logika pencocokan milestone (persis, bukan `>=`), flag `referralActivation.ts` (localStorage disuntik), `edgeFunctionClient.ts` (mock `fetch`/response shape, pola sama seperti test `backupApi` yang sudah ada).
- **Suite `browser`**: render `ReferralScreen` (vitest-browser-react) — kode tampil, milestone ter-render benar dari data mock; field kode referral di `AuthScreen` (muncul hanya di mode signup, terkirim ke `signUp()`).
- Edge Function TypeScript (`supabase/functions/process-referral-activation/*.test.ts`) ikut suite `node` (`vitest.config.ts` sudah meng-include `supabase/functions/**/*.test.ts`) — logika murni yang bisa dipisah dari `Deno.serve`.
