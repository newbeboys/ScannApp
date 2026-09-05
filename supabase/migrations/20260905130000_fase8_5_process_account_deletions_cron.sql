-- Fase 8.5a -- job harian yang mem-purge permanen akun yang grace period-nya
-- (7 hari, CLAUDE.md Bagian 6) sudah lewat.
--
-- Sengaja TIDAK digabung ke expire-pro-status: dua job yang tidak berhubungan
-- di satu jadwal berarti kegagalan salah satunya ikut menggagalkan yang lain,
-- dan expire-pro-status adalah satu UPDATE murni yang tidak pantas ikut
-- terhenti gara-gara R2 sedang tidak bisa dihubungi.
--
-- Seperti cleanup-orphan-r2, isinya tidak bisa jadi SQL biasa: job ini harus
-- bicara ke Cloudflare R2 (S3 API) dan ke Supabase Admin API, jadi dipanggil
-- lewat Edge Function memakai pg_net.
--
-- Jam 04:00 -- setelah expire-pro-status (00:00) dan cleanup-orphan-r2
-- (03:00), supaya tiga job tidak menumpuk beban di menit yang sama.
--
-- KREDENSIAL: memakai Edge Function Secret CRON_SECRET yang SAMA dengan
-- cleanup-orphan-r2 -- satu nilai untuk semua pemanggil cron, bukan satu per
-- job. Karena itu jadwal ini membaca baris Vault yang sudah ada,
-- 'cleanup_orphan_r2_cron_secret' (namanya historis, dibuat saat job cron
-- pertama; isinya nilai CRON_SECRET). Tidak ada secret baru yang perlu
-- dibuat manual untuk migration ini.

create extension if not exists pg_net;

select cron.schedule(
  'process-account-deletions',
  '0 4 * * *',
  $$
    select net.http_post(
      url := 'https://ledqdwiftjqydgsiqjpc.supabase.co/functions/v1/process-account-deletions',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_orphan_r2_cron_secret')
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
