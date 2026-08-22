# TASKS.md — Roadmap Pembangunan Scanner App

Status: `[ ]` belum dikerjakan · `[~]` sedang dikerjakan · `[x]` selesai

Urutan mengikuti PRD Bagian 8. **Jangan lompat ke fase berikutnya sebelum fase sebelumnya selesai**, kecuali ada alasan eksplisit dari Boss Ali.

---

## Fase 0 — Setup Proyek

- [x] Init project Capacitor + React + Vite (repo baru, terpisah dari FinanceApp)
- [x] Buat project Supabase baru khusus Scanner App (catat URL & anon key ke `.env`)
- [x] Setup akun Cloudflare R2 + buat bucket khusus scanner app
- [x] Jalankan migration SQL untuk semua tabel di `DATABASE_SCHEMA.md`
- [x] Setup RLS policy sesuai `DATABASE_SCHEMA.md`
- [x] Konfigurasi `.env` berdasarkan `.env.example`
- [x] Setup CI/CD dasar (bisa contek pola dari FinanceApp: Node 22, Java 21 Temurin)

## Fase 1 — Capture & Processing Engine (subsistem inti, harus solid dulu)

- [x] Install & konfigurasi `@capacitor-mlkit/document-scanner`
- [x] Implementasi flow: buka scanner → capture → hasil balik ke app (single page dulu)
- [x] Uji multi-page capture dalam satu sesi — diuji manual oleh Boss Ali di device fisik, berhasil
- [x] Simpan hasil scan ke storage lokal device (belum ke cloud) — via `@capacitor/filesystem`, `Directory.Data/scans/<id>/page-N.jpg` + index JSON
- [x] Uji kualitas hasil scan di berbagai kondisi cahaya (baseline sebelum lanjut ke fitur lain) — diuji manual oleh Boss Ali di device fisik, kualitas bagus

## Fase 2 — Editor Dasar + Export + Kompresi (Basic tier)

Desain: `docs/superpowers/specs/2026-07-26-fase2-editor-export-design.md`

- [x] Fitur crop manual — overlay 4 sudut (`CropOverlay.tsx`), koordinat ternormalisasi 0..1
- [x] Fitur rotate halaman — kelipatan 90°, bisa ditumpuk
- [x] Export ke PDF — `pdf-lib`, tiap halaman di-fit ke A4 (otomatis lanskap), margin 18pt
- [x] Export ke JPG — 1 file per halaman, dinomori kalau lebih dari satu halaman
- [x] Kompresi otomatis (1 level standar untuk Basic) — JPEG q=0.75, sisi terpanjang maks 2400px
- [x] Watermark kecil di hasil export PDF (Basic only) — logo vektor + teks "ScannApp", pojok kanan bawah
- [x] Fitur merge dokumen (universal — Basic & Pro, lihat CLAUDE.md aturan #5), dengan enforcement limit **20 halaman untuk Basic**, unlimited untuk Pro

Catatan tambahan di luar daftar asli (lihat spec Bagian 2 & 4):

- [x] Model halaman naik ke v2 (`{ original, edited? }`) — file scan asli tidak pernah ditimpa, ada "Reset ke asli". Dokumen Fase 1 dimigrasi otomatis saat dibaca.
- [x] Simpan hasil export ke folder Documents + share sheet Android; di browser jatuh ke unduhan biasa
- [x] Unit test (Vitest, 33 test) — migrasi index v1→v2, limit tier, bukti watermark ada di Basic & tidak ada di Pro, hitung halaman merge
- [x] CI menjalankan `npm test` dan ikut membuild APK untuk branch `feat/**`

**Belum diverifikasi di device fisik** (butuh Boss Ali, seperti Fase 1):

- [ ] Crop dengan jari di layar sentuh (drag 4 sudut) terasa enak dipakai
- [ ] Share sheet Android muncul & file benar-benar tersimpan di folder Documents
- [ ] Kualitas hasil kompresi (q=0.75 / 2400px) masih terbaca untuk dokumen teks kecil
- [ ] Watermark tidak mengganggu isi dokumen saat PDF dibuka/dicetak

## Fase 3 — Sistem Auth & Tier

Desain: `docs/superpowers/specs/2026-07-26-fase3-auth-tier-design.md`

- [x] Signup/login (Supabase Auth) — email + password, **login wajib** (tidak ada mode tamu). Landing bermerek → layar masuk/daftar bertab → lupa password
- [x] Trigger `on_auth_user_created` (auto-buat `profiles` + `storage_usage` 100MB + `referral_code` 8 karakter) — diuji langsung di database, profil & kuota terbentuk otomatis
- [x] Logic pengecekan tier (`basic`/`pro`) di client untuk gating fitur — `resolveTier()`, semua keraguan jatuh ke Basic
- [x] UI status tier & sisa waktu aktif — kartu akun di Settings (nama, email, badge tier, sisa hari, tombol Keluar)

Catatan tambahan di luar daftar asli:

- [x] **Pro selalu berjangka** (keputusan Boss Ali): tidak ada Pro permanen. Kolom baru `profiles.pro_plan` (`monthly`/`yearly`/`referral`) membedakan paket — dipakai untuk kuota storage di Fase 4
- [x] Sesi & profil di-cache di device (cache-first), jadi aplikasi tetap jalan offline setelah login pertama
- [x] Pesan error Supabase diterjemahkan ke Bahasa Indonesia yang manusiawi
- [x] Semua migration SQL disimpan ke `supabase/migrations/` — termasuk backfill migration Fase 0 yang sebelumnya hanya ada di dashboard
- [x] Fungsi `security definer` di-`revoke` dari `anon`/`authenticated` (menutup temuan advisor Supabase 0028 & 0029)
- [x] Unit test bertambah 26 (total 59): perhitungan tier, cache profil antar akun, terjemahan error

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] Daftar akun sungguhan dengan `demofimance@gmail.com` di HP, lalu cek profil & kode referral terbentuk
- [ ] Keluar lalu masuk lagi — sesi tersimpan dengan benar
- [ ] Buka aplikasi dalam mode pesawat setelah pernah login — harus tetap bisa masuk & memindai
- [ ] Putuskan apakah "Confirm email" di dashboard Supabase dimatikan (lebih mudah saat uji coba) atau dibiarkan aktif

## Fase 4 — Backend Storage/Backup (Supabase Edge Functions + R2)

Desain: `docs/superpowers/specs/2026-07-26-fase4-backup-r2-design.md`

- [x] Edge Function `generate-upload-url` — verifikasi JWT, hitung ulang kuota dari tier, tolak 409 kalau penuh, presigned PUT 10 menit
- [x] Edge Function `confirm-upload` — upsert `scan_documents` + sesuaikan `bytes_used` dengan **selisih** (backup ulang tidak dihitung dobel)
- [x] Edge Function `generate-download-url` — presigned GET 10 menit, dicek kepemilikannya dua kali
- [x] Edge Function `delete-backup` — hapus object R2 + baris DB + kurangi `bytes_used`, idempoten
- [x] UI toggle "backup ke cloud" per dokumen (opsional, bukan otomatis) — baris status di detail dokumen
- [x] UI indikator sisa kuota storage per tier — bar kuota di Settings & layar cadangan

Catatan tambahan di luar daftar asli:

- [x] Layar **"Cadangan di cloud"** (unduh & hapus) — backup tanpa cara mengambil kembali bukan backup
- [x] Kuota naik otomatis saat user jadi Pro: dihitung ulang tiap upload, tidak perlu job terjadwal. Kuota **Pro dari referral = 500MB** (angka baru, dicatat di CLAUDE.md Bagian 6)
- [x] File yang sudah ada **tidak pernah** dihapus otomatis saat kuota turun (mis. hadiah Pro berakhir) — yang diblokir hanya penambahan baru
- [x] Menghapus dokumen dari HP tidak menghapus cadangannya; toast menyebutkan itu supaya tidak terasa bocor
- [x] Unit test bertambah 29 (total 88); `vitest.config.ts` kini ikut menguji helper Edge Function
- [x] Uji nyata ke R2: unggah, unduh (isi identik), tolak tanpa token (401), hapus (object 404 & hitungan kembali 0)
- [x] Semua peringatan advisor `SECURITY DEFINER` ditutup, termasuk `rls_auto_enable()` peninggalan setup awal. Fungsinya dipertahankan (jaring pengaman yang menyalakan RLS otomatis tiap `CREATE TABLE`), hanya hak EXECUTE role publik yang dicabut — diverifikasi jaring pengamannya masih bekerja setelah itu

**Terblokir — butuh Boss Ali (5 menit di dashboard Cloudflare):**

- [ ] **Pasang kebijakan CORS di bucket `scanappstorage`.** Tanpa ini, unggah dari aplikasi diblokir preflight browser. Kredensial R2 yang tersimpan cuma punya izin Object Read & Write, jadi `PutBucketCors` ditolak 403 — harus lewat dashboard. JSON-nya ada di spec Fase 4 Bagian 9.

**Belum diverifikasi di device fisik:**

- [ ] Cadangkan dokumen sungguhan dari HP setelah CORS dipasang
- [ ] Unduh cadangan di HP (harus membuka/menyimpan PDF)

## Fase 5 — Fitur Iklan & Monetisasi (Basic)

Desain: `docs/superpowers/specs/2026-08-22-fase5-iklan-monetisasi-design.md`

### A. Iklan

- [x] Integrasi AdMob — `@capacitor-community/admob` 8.1.0
- [x] Banner ad di layar utama — hanya di layar tab, tidak di alur scan/editor/merge/paywall
- [x] Interstitial ad: tiap 5 scan + setelah export (`ADS_INTERSTITIAL_FREQUENCY=every_5_scans_plus_after_export`) — penghitung disimpan di localStorage supaya restart aplikasi tidak meresetnya, dan naik hanya saat dokumen benar-benar tersimpan
- [x] Gating Pro: tanpa iklan, dan penghitung scan tidak ikut naik selama Pro (langganan yang habis tidak langsung disambut interstitial)

### B. Pembelian Pro

- [x] Fondasi Android: dependency Google Play Billing Library 9.1.0 + permission `com.android.vending.BILLING`
- [x] Jembatan ke layer JS/React via **RevenueCat** (`@revenuecat/purchases-capacitor` 13.4.1) — baris `com.android.billingclient:billing` sudah dihapus dari `android/app/build.gradle`
- [x] `android:launchMode` MainActivity diubah `singleTask` → `singleTop`
- [x] Paywall `UpgradeScreen` — harga diambil dari offering RevenueCat, fallback Rp 15.000/Rp 150.000 saat offline. Ada tombol "Pulihkan pembelian" & keterangan langganan berulang (wajib aturan Google Play)
- [x] Verifikasi purchase di server: Edge Function `revenuecat-webhook` + tabel `subscription_events` (idempoten lewat `event_id` sebagai primary key)
- [x] Sisa Pro dari referral tidak terinjak oleh event pembelian — 18 test menutup kasus ini

Total test naik dari 100 ke 123.

**Catatan penting:** paywall sengaja hanya menjual 4 hal yang benar-benar sudah jalan — bebas iklan, tanpa watermark, merge tanpa batas, kuota storage lebih besar. OCR/anotasi/tanda tangan masih Fase 6 dan **tidak** dijual di paywall.

**Langkah manual Boss Ali (di luar repo, memblokir rilis):**

- [ ] Buat akun AdMob, lalu isi `VITE_ADMOB_BANNER_UNIT_ID` & `VITE_ADMOB_INTERSTITIAL_UNIT_ID` di `.env`, dan ganti `APPLICATION_ID` di `AndroidManifest.xml` (sekarang masih App ID test resmi Google)
- [ ] Buat produk subscription di Play Console: `scannapp_pro_monthly` (Rp 15.000) & `scannapp_pro_yearly` (Rp 150.000)
- [ ] Di dashboard RevenueCat: hubungkan ke Play Console, buat entitlement `pro`, buat offering berisi kedua produk
- [x] Set `REVENUECAT_WEBHOOK_SECRET` — **HMAC signing secret** dari toggle "HMAC webhook signing" di integrasi webhook RevenueCat (bukan Authorization header, ganti keputusan awal setelah audit 22 Agustus 2026), sudah di-set Boss Ali di Supabase Edge Function Secrets
- [x] ~~Jalankan 3 migration baru~~ — sudah diterapkan ke production 22 Agustus 2026 lewat MCP, exploit-nya diverifikasi manual:
  - `20260821211033_fase5_subscription_events.sql`
  - `20260821211045_fase5_freeze_pro_plan_in_rls.sql`
  - `20260821211059_fase5_revoke_client_writes_on_scan_documents.sql`
- [x] ~~Redeploy `confirm-upload`~~ — sudah live di production (version 2, 22 Agustus 2026). Celah pengambilalihan dokumen ditutup di production, tidak menunggu deploy Fase 5.
- [ ] Deploy Edge Function `revenuecat-webhook` (menunggu `REVENUECAT_WEBHOOK_SECRET` di-set)

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] **Aplikasi terbuka sampai layar Landing (versi 2.0.2 / versionCode 4).** Ini prasyarat semua uji di bawahnya. Kalau yang muncul bukan Landing melainkan layar diagnostik putih berisi teks error + UA, screenshot teks itu — isinya menyebut persis apa yang gagal, termasuk versi WebView HP. Kalau layarnya putih polos tanpa teks sama sekali, berarti yang terpasang masih APK lama; cek versinya di Setelan → Aplikasi → ScannApp (harus 2.0.2).
- [ ] Banner muncul dan tidak menutupi bottom nav
- [ ] Interstitial benar-benar muncul di scan ke-5 dan setelah export
- [ ] Pembelian test di Play Console berhasil, lalu `tier` di `profiles` berubah jadi `pro`
- [ ] Callback pembelian tidak hilang setelah `launchMode` diubah — uji juga buka app dari launcher setelah di-background, dan kembali dari share sheet/file picker
- [ ] "Pulihkan pembelian" bekerja setelah aplikasi di-install ulang
- [x] ~~**Backup ke cloud masih jalan setelah `confirm-upload` v2.**~~ **Terverifikasi 23 Agustus 2026** dari HP Boss Ali. Dokumen `6f05fafd-…` (1 halaman, PDF) tercatat di `scan_documents` dengan `file_size_bytes` 326.679 dan `local_only=false`, serta `storage_usage.bytes_used` cocok persis. Angka itu **bukan** klaim client: `confirm-upload` mengambilnya dari `headObjectSize()`, yaitu HTTP HEAD sungguhan ke R2 — kalau objeknya tidak ada, R2 balas 404 dan fungsi menolak dengan `UPLOAD_NOT_FOUND` tanpa menulis baris apa pun. Jadi keberadaan baris itu membuktikan objeknya fisik ada di R2. Jalur HEAD terbukti bekerja terhadap R2 sungguhan.

## Fase 6 — Fitur Pro: OCR & Edit Lanjutan

- [ ] Integrasi OCR (searchable PDF)
- [ ] Annotate (coret/tulis di atas dokumen)
- [ ] Tanda tangan digital
- [ ] Reorder halaman
- [ ] Filter lanjutan (B&W, magic color/enhance kontras)
- [ ] Export tambahan: DOCX, PNG
- [ ] Kontrol level kompresi manual (slider kualitas vs ukuran)
- [ ] Batch scan/export

## Fase 7 — AI Enhance (Pro, on-device TFLite) — subsistem paling berat

- [ ] Riset & pilih model TFLite untuk image enhancement (cahaya/kontras/noise/ketajaman)
- [ ] Integrasi model ke pipeline Android (via Capacitor plugin custom bila perlu)
- [ ] Fitur auto-deskew + auto-crop presisi
- [ ] Uji performa di device low-end (pastikan tidak terlalu berat/lambat)
- [ ] Toggle on/off AI Enhance per dokumen

## Fase 8 — Program Referral

- [ ] UI generate & share kode referral
- [ ] Edge Function `process-referral-activation`
- [ ] Tabel `referral_milestones` diisi dengan angka final: 5 orang→7 hari, 15 orang→25 hari, 30 orang→60 hari Pro
- [ ] Edge Function terjadwal `expire-pro-status`
- [ ] UI progress referral (berapa orang sudah invite, menuju milestone berikutnya)
- [ ] Uji anti-abuse: 1 device/akun tidak bisa refer diri sendiri berkali-kali

## Fase 9 — QA & Hardening

- [ ] Uji limit merge dokumen Basic (20 halaman) & quota storage R2 per tier (100MB/500MB/1GB) sesuai angka final
- [ ] Uji job pembersihan object R2 yatim (tidak punya referensi di `scan_documents`)
- [~] Security review RLS policy (pastikan tidak ada cross-user data leak) — dimajukan sebagian, lihat di bawah
- [ ] Nyalakan **Leaked Password Protection** di Supabase (Authentication → Policies) — cek password terhadap HaveIBeenPwned, satu-satunya temuan advisor yang tersisa per 26 Juli 2026
- [ ] Tinjau ulang setelan **Confirm email** sebelum rilis publik (lihat catatan Fase 3)
- [ ] Uji auto-pause Supabase free tier (setup keep-alive kalau perlu, mengingat riwayat kebijakan pause di Supabase/Appwrite)

### Sudah ditutup lebih awal (22 Agustus 2026)

Ditemukan saat code-review Fase 5, diperbaiki atas permintaan Boss Ali sebelum lanjut ke Fase 6. Rincian sebabnya di `docs/superpowers/specs/2026-07-26-fase4-backup-r2-design.md` Bagian 9.

- [x] **Kuota R2 bisa dilewati** — dari dua arah sekaligus: client bisa menulis sendiri `scan_documents.file_size_bytes` lewat RLS (`replacing` jadi raksasa), dan presigned PUT tidak membatasi panjang (klaim 1 KB, unggah 5 GB). Ditutup dengan mencabut policy tulis `scan_documents` (migration `20260821211059`) **dan** mengukur ukuran sebenarnya dari R2 di `confirm-upload`.
- [x] **`confirm-upload` bisa merebut dokumen orang lain** — upsert `onConflict: 'id'` dengan service role tanpa cek kepemilikan. Diganti update-lalu-insert yang atomik.
- [x] **`pro_plan` tidak dibekukan RLS** — user Pro Bulanan bisa menaikkan diri ke kuota 1GB tanpa membayar (migration `20260821211045`).

Yang **belum** dicakup dan tetap jadi tugas Fase 9: telaah menyeluruh seluruh policy (bukan cuma tiga temuan di atas), termasuk `profiles`, `referral_events`, dan `referral_milestones`, plus uji cross-user beneran dengan dua akun.

---

## Status Keputusan

Semua angka bisnis & keputusan arsitektur untuk versi pertama sudah final (lihat PRD v2 Bagian 7 & CLAUDE.md Bagian 6-7). Tidak ada lagi open decision yang memblokir task di atas — implementasi bisa langsung jalan mengikuti urutan fase.

**Keputusan Boss Ali, 22 Agustus 2026:** flow pembelian Pro **tidak dibuka ke publik sebelum Fase 6 selesai**. Alasannya: hari ini Pro cuma benar-benar memberi 4 hal (bebas iklan, tanpa watermark, merge tanpa batas, kuota storage lebih besar), dan paywall sengaja hanya menjual itu. OCR, anotasi, dan tanda tangan di Fase 6 yang akan membuat harganya masuk akal. Kodenya sendiri sudah siap dan sudah diuji — yang ditunda hanya pembukaannya ke user.
