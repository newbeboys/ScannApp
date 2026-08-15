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

- [ ] Integrasi AdMob (atau provider iklan lain yang dipilih)
- [ ] Banner ad di layar utama
- [ ] Interstitial ad: tiap 5 scan + setelah export dokumen (`ADS_INTERSTITIAL_FREQUENCY=every_5_scans_plus_after_export`)
- [ ] Flow pembelian Pro (in-app purchase/subscription): Rp 15.000/bulan atau Rp 150.000/tahun
- [ ] Pasang RevenueCat (`purchases-capacitor`). **Bersamaan dengan ini**, ubah `android:launchMode` MainActivity di [android/app/src/main/AndroidManifest.xml](android/app/src/main/AndroidManifest.xml) dari `singleTask` ke `singleTop` — `singleTask` berisiko membuat callback hasil pembelian dari Play Store hilang lewat `onNewIntent()`. Uji ulang di device asli dalam satu siklus: buka app dari launcher setelah di-background, kembali dari share sheet/file picker, dan alur pembelian itu sendiri (ditetapkan 12 Agustus 2026 saat audit manifest, lihat [[project_scannapp_progress]])

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
- [ ] Security review RLS policy (pastikan tidak ada cross-user data leak)
- [ ] Nyalakan **Leaked Password Protection** di Supabase (Authentication → Policies) — cek password terhadap HaveIBeenPwned, satu-satunya temuan advisor yang tersisa per 26 Juli 2026
- [ ] Tinjau ulang setelan **Confirm email** sebelum rilis publik (lihat catatan Fase 3)
- [ ] Uji auto-pause Supabase free tier (setup keep-alive kalau perlu, mengingat riwayat kebijakan pause di Supabase/Appwrite)

---

## Status Keputusan

Semua angka bisnis & keputusan arsitektur untuk versi pertama sudah final (lihat PRD v2 Bagian 7 & CLAUDE.md Bagian 6-7). Tidak ada lagi open decision yang memblokir task di atas — implementasi bisa langsung jalan mengikuti urutan fase.
