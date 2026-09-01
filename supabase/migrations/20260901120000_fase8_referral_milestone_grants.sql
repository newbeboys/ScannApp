-- Fase 8 -- perbaikan race condition milestone: dua referred user berbeda
-- dari referrer yang sama bisa mengaktivasi nyaris bersamaan, membuat kedua
-- query hitung (COUNT activated) sama-sama membaca angka akhir (misal 6)
-- tanpa pernah membaca angka pas milestone (5) -- pencocokan persis (=) di
-- matchedMilestone() lantas tidak pernah cocok, dan referrer kehilangan
-- reward yang sebenarnya sudah layak, permanen dan diam-diam. Ditemukan di
-- review akhir cabang fase8-program-referral (1 September 2026).
--
-- Ditutup dengan ledger idempoten per (referrer, milestone): sebelum memberi
-- reward suatu milestone, Edge Function coba INSERT baris ke tabel ini.
-- Baris unik lewat primary key (referrer_id, referral_count_required) --
-- percobaan kedua yang bentrok otomatis gagal (23505) tanpa efek samping,
-- pola sama seperti confirm-upload/index.ts dan revenuecat-webhook/index.ts.
-- Dikombinasikan dengan pencocokan >= (bukan lagi persis =, lihat
-- unclaimedMilestones() di _shared/referral.ts), race yang tadinya
-- melompati angka pas kini tetap tertangkap: begitu ada permintaan apa pun
-- yang membaca count sudah lewat ambang batas dan baris ledger-nya belum
-- ada, ia berhasil INSERT dan reward tetap cair.
--
-- Hanya diakses lewat service role (Edge Function) -- RLS aktif, sengaja
-- tanpa policy apa pun untuk anon/authenticated (deny-by-default), sama
-- seperti pola referral_events untuk INSERT/UPDATE (tidak ada policy tulis
-- sama sekali di 20260725093558_enable_rls_and_policies.sql).

create table public.referral_milestone_grants (
  referrer_id uuid not null references public.profiles(id),
  referral_count_required integer not null,
  granted_at timestamptz not null default now(),
  primary key (referrer_id, referral_count_required)
);

alter table public.referral_milestone_grants enable row level security;
