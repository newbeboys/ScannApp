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
      url := 'https://ledqdwiftjqydgsiqjpc.supabase.co/functions/v1/cleanup-orphan-r2',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_orphan_r2_cron_secret')
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
