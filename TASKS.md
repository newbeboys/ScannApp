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

- [ ] Fitur crop manual
- [ ] Fitur rotate halaman
- [ ] Export ke PDF
- [ ] Export ke JPG
- [ ] Kompresi otomatis (1 level standar untuk Basic)
- [ ] Watermark kecil di hasil export PDF (Basic only)
- [ ] Fitur merge dokumen (universal — Basic & Pro, lihat CLAUDE.md aturan #5), dengan enforcement limit **20 halaman untuk Basic**, unlimited untuk Pro

## Fase 3 — Sistem Auth & Tier

- [ ] Signup/login (Supabase Auth)
- [ ] Trigger `on_auth_user_created` (auto-buat `profiles` + `storage_usage` + `referral_code`)
- [ ] Logic pengecekan tier (`basic`/`pro`) di client untuk gating fitur
- [ ] UI status tier & (kalau Pro dari referral) sisa waktu aktif

## Fase 4 — Backend Storage/Backup (Supabase Edge Functions + R2)

- [ ] Edge Function `generate-upload-url`
- [ ] Edge Function `confirm-upload`
- [ ] Edge Function `generate-download-url`
- [ ] Edge Function `delete-backup`
- [ ] UI toggle "backup ke cloud" per dokumen (opsional, bukan otomatis)
- [ ] UI indikator sisa kuota storage per tier

## Fase 5 — Fitur Iklan & Monetisasi (Basic)

- [ ] Integrasi AdMob (atau provider iklan lain yang dipilih)
- [ ] Banner ad di layar utama
- [ ] Interstitial ad: tiap 5 scan + setelah export dokumen (`ADS_INTERSTITIAL_FREQUENCY=every_5_scans_plus_after_export`)
- [ ] Flow pembelian Pro (in-app purchase/subscription): Rp 15.000/bulan atau Rp 150.000/tahun

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
- [ ] Uji auto-pause Supabase free tier (setup keep-alive kalau perlu, mengingat riwayat kebijakan pause di Supabase/Appwrite)

---

## Status Keputusan

Semua angka bisnis & keputusan arsitektur untuk versi pertama sudah final (lihat PRD v2 Bagian 7 & CLAUDE.md Bagian 6-7). Tidak ada lagi open decision yang memblokir task di atas — implementasi bisa langsung jalan mengikuti urutan fase.
