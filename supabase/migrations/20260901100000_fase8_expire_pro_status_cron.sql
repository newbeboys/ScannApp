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
