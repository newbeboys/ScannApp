# Fase 9 — Job Pembersihan Object R2 Yatim

Disetujui Boss Ali, 1 September 2026, lewat brainstorming (arsitektur, alur
data, error handling, testing dikonfirmasi per bagian).

## 1. Kenapa job ini belum ada padahal TASKS.md bilang "uji job"

`BACKEND_API_DESIGN.md` Bagian 3 sudah lama mencatat kebutuhannya (catatan
kaki `confirm-upload`: kalau koneksi putus setelah PUT ke R2 sukses tapi
sebelum `confirm-upload` dipanggil, object sudah ada di bucket tapi
`scan_documents` tidak pernah tahu — jadi biaya storage jalan terus tanpa ada
yang mengurangi lewat `delete-backup`). Tapi tidak pernah didesain sampai
tuntas — cuma referensi "lihat Bagian 6" yang sekarang salah alamat (Bagian 6
sudah jadi `process-referral-activation` sejak Fase 8 menambah section baru).
TASKS.md Fase 9 mewarisi kalimat "uji job pembersihan" seolah job-nya sudah
ada; nyatanya belum ada Edge Function maupun `pg_cron` job untuk ini sama
sekali. Spec ini mengisi kekosongan itu.

## 2. Arsitektur & trigger

Tidak bisa jadi SQL murni seperti `expire-pro-status` (satu `UPDATE`) karena
job ini harus bicara ke Cloudflare R2 lewat S3 API (`ListObjectsV2`, lalu
`DELETE` per object) — butuh signing AWS SigV4, yang jauh lebih mudah di Deno
lewat `aws4fetch` (sudah dipakai `_shared/r2.ts`) daripada di `plpgsql`.

- **Trigger:** migration baru mendaftarkan `pg_cron` job `cleanup-orphan-r2`,
  jadwal harian **03:00** (beda jam dari `expire-pro-status` yang jalan
  00:00, supaya tidak numpuk beban di menit yang sama).
- **Pemicu ke Edge Function:** job memanggil `pg_net.http_post` ke
  `https://<project>.supabase.co/functions/v1/cleanup-orphan-r2`, dengan
  header `x-cron-secret` diisi dari Postgres Vault secret yang nilainya sama
  dengan Edge Function Secret baru **`CRON_SECRET`**.
- **Fungsi baru `cleanup-orphan-r2`:** `verify_jwt = false` di
  `supabase/config.toml` (bukan dipanggil user berJWT), tapi menolak (401)
  setiap request yang header `x-cron-secret`-nya tidak cocok dengan
  `Deno.env.get('CRON_SECRET')`. Pola secret baru ini konsisten dengan yang
  sudah ada (`REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_PRODUCT_MONTHLY/YEARLY`
  di `revenuecat-webhook`) — bukan salah satu dari 5 secret resmi CLAUDE.md
  Bagian 7, tapi menambah secret baru untuk kebutuhan baru sudah jadi
  kebiasaan proyek ini.
- `CRON_SECRET` perlu di-generate (string acak panjang) dan disimpan manual
  oleh Boss Ali di dua tempat: Edge Function Secrets (`CRON_SECRET`) dan
  Postgres Vault (dibaca migration lewat `vault.create_secret`/
  `select decrypted_secret from vault.decrypted_secrets`). Langkah manual ini
  didokumentasikan di plan implementasi, bukan sesuatu yang bisa saya
  jalankan dari sesi ini (butuh akses dashboard).

## 3. Alur data

1. Query `scan_documents.r2_object_key` (semua baris yang tidak null) →
   `Set<string>` berisi key yang dianggap valid/masih dipakai.
2. `ListObjectsV2` terhadap bucket dengan prefix `users/`, mengikuti
   `NextContinuationToken` sampai `IsTruncated=false` — semua dalam satu
   invocation function (bucket masih kecil di tahap ini; paginasi lintas
   invocation sengaja belum dibangun, YAGNI sampai benar-benar perlu).
3. Untuk tiap object hasil listing: **yatim** kalau key-nya **tidak ada** di
   Set referensi **dan** `LastModified` lebih tua dari **24 jam** dari waktu
   job berjalan (margin aman supaya upload yang baru saja `PUT` tapi
   `confirm-upload`-nya belum sempat jalan tidak salah kena).
4. **Mode `LOG_ONLY` (default, dan status awal saat pertama di-deploy):**
   catat daftar kandidat (key, ukuran, umur dalam jam) lewat `console.log`
   terstruktur (satu baris JSON per kandidat, gampang di-grep dari Supabase
   Logs) dan kembalikan ringkasan JSON (`candidateCount`, `candidateBytes`,
   `dryRun: true`) — **tidak menghapus apa pun**.
5. **Mode hapus sungguhan:** dikendalikan oleh Edge Function Secret
   `CLEANUP_ORPHAN_R2_DRY_RUN` — tidak diset atau bernilai apa pun selain
   literal `"false"` berarti dry-run; diset eksplisit ke `"false"` menyalakan
   penghapusan nyata. Menyalakannya tidak perlu deploy ulang kode, cukup ubah
   nilai secret di dashboard — cocok untuk masa observasi sebelum go-live.

## 4. Error handling & katup pengaman

- Query `scan_documents` gagal, atau `ListObjectsV2` gagal (network/auth) →
  batalkan seluruh run (500, log error lengkap), **tidak pernah** melanjut
  dengan Set referensi yang kosong/parsial — itu skenario terburuk karena
  semua object akan terlihat yatim.
- Gagal menghapus satu object tertentu (mode nyata) → tidak menggagalkan
  seluruh batch; lanjut ke object berikutnya, kumpulkan kegagalan ke daftar
  terpisah di ringkasan (`deleteFailures`). Idempotent — run berikutnya akan
  menemukannya lagi karena objectnya belum benar-benar hilang.
- **Katup pengaman:** kalau jumlah kandidat yatim melebihi **50%** dari total
  object yang berhasil di-list, run itu menolak menghapus apa pun **walau**
  mode nyata sedang aktif — cuma log peringatan `SAFETY_VALVE_TRIPPED` dan
  kembalikan `dryRun: true` di ringkasan meskipun secret-nya bilang lain.
  Indikasi paling mungkin dari rasio setinggi itu adalah bug (query salah,
  prefix salah, pagination putus di tengah), bukan situasi yatim yang wajar.

## 5. Testing

Logika murni — diff key R2 terhadap Set referensi, penerapan margin 24 jam,
keputusan log-vs-hapus, dan katup pengaman 50% — diekstrak ke
`supabase/functions/_shared/orphanCleanup.ts`, mengambil `now` sebagai
parameter supaya bisa diuji penuh tanpa jam sungguhan, mengikuti pola
`_shared/quota.ts`. Semua path (yatim vs valid, tepat di batas 24 jam,
katup pengaman tersulut vs tidak, mode dry-run vs nyata) diuji lewat suite
node.

Bagian I/O (`index.ts`: panggilan HTTP nyata ke R2 & Supabase) sengaja tidak
di-unit-test, konsisten dengan konvensi proyek ini — tidak ada satupun
`index.ts` handler Edge Function yang punya test sendiri, semua kebenarannya
ada di modul `_shared/*.ts` yang dipanggilnya. Pembuktian jalur I/O ini
adalah: deploy dalam mode `LOG_ONLY`, biarkan jalan harian beberapa hari,
Boss Ali tinjau log kandidatnya di Supabase Dashboard, baru nyalakan mode
hapus nyata secara sadar. Ini memenuhi item checklist "uji job pembersihan"
di TASKS.md Fase 9 secara harfiah — uji hidup, bukan simulasi.

## 6. Cakupan yang sengaja tidak dibangun (YAGNI)

- Paginasi lintas invocation untuk bucket sangat besar — bucket masih kecil,
  satu run yang mengikuti seluruh `NextContinuationToken` dalam satu
  request cukup untuk sekarang.
- Notifikasi (email/Slack) saat katup pengaman tersulut — cukup log,
  ditinjau manual lewat Supabase Logs untuk versi pertama.
- Rate limiting terhadap panggilan job ini sendiri — endpointnya sudah
  ditutup dari luar lewat `CRON_SECRET`, satu-satunya pemanggil sah adalah
  `pg_cron` milik project sendiri.
