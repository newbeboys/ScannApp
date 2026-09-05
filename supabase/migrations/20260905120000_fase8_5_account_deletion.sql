-- Fase 8.5a -- fondasi database untuk fitur hapus akun.
--
-- Dipicu error nyata saat mencoba hapus user test lewat Supabase Admin API:
--   update or delete on table "profiles" violates foreign key constraint
--   "storage_usage_user_id_fkey" on table "storage_usage"
--
-- Akar masalahnya: SEMUA foreign key ke public.profiles(id) dibuat tanpa
-- klausa ON DELETE, jadi defaultnya NO ACTION -- Postgres menolak menghapus
-- baris profiles selama masih ada baris anak yang menunjuk ke situ. Karena
-- profiles.id sendiri ber-ON DELETE CASCADE dari auth.users, penolakan itu
-- ikut menggagalkan DELETE /auth/v1/admin/users/{id}, yang artinya user
-- sungguhan pun tidak akan bisa menghapus akunnya lewat app.
--
-- Google Play mewajibkan app dengan fitur akun menyediakan jalur hapus akun
-- (in-app + web link) -- ini blocker submit Play Console, bukan nice-to-have.
--
-- Keputusan bisnis (grace period 7 hari, anonimisasi referral, syarat cancel
-- langganan Pro) ada di CLAUDE.md Bagian 6. Desain Edge Function-nya di
-- BACKEND_API_DESIGN.md Bagian 11-13.

-- ---------------------------------------------------------------------------
-- 1. Kolom penanda grace period
-- ---------------------------------------------------------------------------
-- NULL = tidak sedang dalam proses hapus. Diisi now() oleh
-- request-account-deletion, dikosongkan lagi oleh cancel-account-deletion.
alter table public.profiles
  add column if not exists deletion_requested_at timestamptz;

comment on column public.profiles.deletion_requested_at is
  'Kapan user meminta akunnya dihapus. NULL = tidak ada permintaan aktif. '
  'process-account-deletions mem-purge permanen setelah lewat 7 hari.';

-- Partial index: job harian hanya pernah menanyakan baris yang IS NOT NULL,
-- dan itu segelintir dari seluruh tabel. Index penuh akan ikut menyimpan
-- mayoritas baris NULL yang tidak pernah dibaca job ini.
create index if not exists idx_profiles_deletion_requested_at
  on public.profiles(deletion_requested_at)
  where deletion_requested_at is not null;

-- ---------------------------------------------------------------------------
-- 2. FK yang dihapus ikut induknya (CASCADE)
-- ---------------------------------------------------------------------------
-- Baris di dua tabel ini murni milik satu user dan tidak punya arti apa pun
-- tanpa dia -- tidak ada pihak lain yang datanya ikut hilang kalau baris ini
-- lenyap bersama akunnya.
--
-- PENTING: cascade ini TIDAK menyentuh object di R2. scan_documents yang
-- ikut terhapus membawa serta r2_object_key-nya, satu-satunya cara menemukan
-- object itu lagi. Karena itu process-account-deletions WAJIB menghapus
-- object R2 lebih dulu, sebelum baris auth.users dihapus.

alter table public.storage_usage
  drop constraint if exists storage_usage_user_id_fkey;

alter table public.storage_usage
  add constraint storage_usage_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.scan_documents
  drop constraint if exists scan_documents_owner_id_fkey;

alter table public.scan_documents
  add constraint scan_documents_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete cascade;

-- referral_milestone_grants: ledger idempoten anti-dobel-reward, kuncinya
-- (referrer_id, referral_count_required). Tugasnya cuma mencegah satu
-- referrer menerima milestone yang sama dua kali; begitu referrer-nya tidak
-- ada, tidak ada lagi yang perlu dicegah. SET NULL bukan pilihan di sini --
-- referrer_id bagian dari primary key, jadi tidak boleh NULL.
--
-- FK ini TIDAK disebut di dokumen desain (tabelnya baru dibuat setelahnya,
-- migration 20260901120000) tapi sama-sama memblokir DELETE.
alter table public.referral_milestone_grants
  drop constraint if exists referral_milestone_grants_referrer_id_fkey;

alter table public.referral_milestone_grants
  add constraint referral_milestone_grants_referrer_id_fkey
  foreign key (referrer_id) references public.profiles(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 3. FK yang dianonimkan, bukan dihapus (SET NULL)
-- ---------------------------------------------------------------------------
-- Baris referral_events menyangkut DUA orang. Menghapusnya saat salah satu
-- pihak pergi akan ikut menghapus bukti reward yang sudah cair ke pihak yang
-- masih ada (reward_granted = true) -- statistiknya jadi bohong dan
-- unclaimedMilestones() bisa mencairkan ulang milestone yang sudah dibayar.
-- Yang dibuang cuma penunjuk ke orangnya; barisnya tetap tinggal.

alter table public.referral_events
  alter column referrer_id drop not null;

alter table public.referral_events
  alter column referred_id drop not null;

alter table public.referral_events
  drop constraint if exists referral_events_referrer_id_fkey;

alter table public.referral_events
  add constraint referral_events_referrer_id_fkey
  foreign key (referrer_id) references public.profiles(id) on delete set null;

alter table public.referral_events
  drop constraint if exists referral_events_referred_id_fkey;

alter table public.referral_events
  add constraint referral_events_referred_id_fkey
  foreign key (referred_id) references public.profiles(id) on delete set null;

-- profiles.referred_by menunjuk BALIK ke referrer, jadi menghapus seorang
-- referrer akan tertahan oleh baris profil orang-orang yang dia undang --
-- justru kasus yang paling mungkin terjadi pada akun yang aktif merefer.
--
-- FK ini juga TIDAK disebut di dokumen desain, padahal skenario ujinya
-- ("akun test yang jadi referrer") pasti menabraknya. Perlakuannya disamakan
-- dengan referral_events: anonimkan, jangan hapus. Menghapus akun seseorang
-- tidak boleh ikut menghapus akun orang yang dia undang.
alter table public.profiles
  drop constraint if exists profiles_referred_by_fkey;

alter table public.profiles
  add constraint profiles_referred_by_fkey
  foreign key (referred_by) references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Bekukan deletion_requested_at dari client
-- ---------------------------------------------------------------------------
-- Sama alasannya dengan pro_plan (20260821211045) dan first_scan_completed_at
-- (20260901093000): client punya policy UPDATE ke barisnya sendiri, jadi tanpa
-- pembekuan ini user bisa PATCH deletion_requested_at lewat REST API.
--
-- Dua arah sama-sama berbahaya. Mengisinya sendiri melewati pengecekan
-- entitlement RevenueCat -- user Pro bisa menjadwalkan penghapusan akun
-- padahal langganannya masih menagih. Mengosongkannya sendiri juga tidak
-- boleh lewat jalur ini: satu-satunya pintu batal adalah
-- cancel-account-deletion, supaya ada satu tempat yang tercatat.
--
-- Kolom yang sudah dibekukan sebelumnya diulang di sini karena policy-nya
-- diganti utuh (CREATE POLICY tidak bisa menambah klausa ke yang sudah ada).
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
    and deletion_requested_at is not distinct from
        (select p.deletion_requested_at from public.profiles p where p.id = auth.uid())
  );
