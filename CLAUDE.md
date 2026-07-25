# CLAUDE.md — Aturan Kerja Proyek Scanner App

Dokumen ini adalah konteks kerja untuk Claude Code di proyek ini. Baca file ini di awal setiap sesi sebelum mengerjakan task apa pun. Referensi lengkap ada di `PRD-aplikasi-scanner-dokumen.md`, `SYSTEM_DESIGN.md`, `DATABASE_SCHEMA.md`, dan `BACKEND_API_DESIGN.md` — jangan menebak keputusan yang sudah didokumentasikan di file-file itu.

---

## 1. Ringkasan Proyek

Aplikasi scan dokumen Android, dua tier (Basic gratis+iklan, Pro berbayar). Dibangun bertahap per subsistem — **jangan mengerjakan banyak subsistem sekaligus dalam satu sesi/PR** kecuali diminta eksplisit.

## 2. Tech Stack (wajib diikuti, jangan diganti tanpa persetujuan eksplisit)

| Layer | Teknologi |
|---|---|
| Framework app | React + Vite + Capacitor |
| Platform | Android (native plugin), iOS belum digarap |
| Scan engine | `@capacitor-mlkit/document-scanner` (ML Kit Document Scanner, on-device) |
| Auth & Database | Supabase (project baru, **terpisah dari project FinanceApp** — jangan pernah pakai kredensial FinanceApp) |
| Storage/backup file | Cloudflare R2 (S3-compatible API), diakses lewat signed URL dari Supabase Edge Function — **client tidak pernah menyimpan R2 access key langsung** |
| Penyimpanan utama file | Lokal di device user (local-first). Cloud (R2) hanya untuk backup/sync opsional |
| AI Enhance (Pro) | Model on-device TensorFlow Lite — **dilarang** memanggil cloud AI API berbayar/free-tier pihak ketiga untuk fitur ini kecuali ada keputusan baru yang eksplisit dari Boss Ali |

## 3. Aturan Keras (Hard Rules)

1. **Jangan pernah hardcode credential** (Supabase keys, R2 access key/secret) di kode client. Semua lewat environment variable, ikuti `.env.example`.
2. **Jangan generate signed URL R2 di sisi client.** Signed URL hanya boleh dibuat di Supabase Edge Function setelah verifikasi user & tier.
3. **Semua akses tabel Supabase wajib lewat RLS policy** — jangan matikan RLS "sementara untuk testing" lalu lupa dinyalakan lagi.
4. **Jangan tambah dependency AI cloud berbayar** untuk fitur AI Enhance tanpa konfirmasi eksplisit — ini keputusan sadar karena isu biaya (lihat PRD Bagian 4).
5. **Fitur merge dokumen tersedia untuk semua tier** (Basic & Pro) — jangan taruh di belakang paywall. Tapi tetap tegakkan limit: **Basic maksimal 20 halaman per dokumen hasil merge**, Pro unlimited.
6. **Reward referral hanya cair setelah teman yang diundang menyelesaikan minimal 1 scan** (activation event) — jangan trigger reward hanya dari klik link atau instalasi.
7. Setiap subsistem baru yang disentuh, cek dulu apakah ada limit tier (Basic vs Pro) yang relevan — lihat tabel di PRD Bagian 3 sebelum implementasi fitur edit/export.

## 4. Konvensi Kode

- Bahasa komentar kode: Bahasa Indonesia atau Inggris konsisten per file (jangan campur dalam satu file).
- Penamaan file/folder: `kebab-case` untuk file, `PascalCase` untuk komponen React.
- State management: gunakan pola yang sama dengan FinanceApp kecuali ada alasan kuat untuk berbeda (konsistensi antar proyek Boss Ali).
- Setiap fitur baru yang menyentuh tabel Supabase wajib menyertakan migration SQL, bukan perubahan manual lewat dashboard.

## 5. Alur Kerja yang Diharapkan

1. Sebelum coding, baca task terkait di `TASKS.md`.
2. gunakan skill/plugin yang tersedia atau terpasang agar pekerjaanmu lebih baik gunakan itu jika memeang per
3. Kerjakan satu task/subsistem per sesi kerja, ikuti urutan di `TASKS.md` (jangan lompat ke fitur Pro sebelum fondasi Basic selesai, kecuali diminta).
4. Setelah selesai satu task, update status di `TASKS.md`.
5. Kalau menemukan keputusan yang belum ada di PRD/System Design (mis. angka limit yang belum ditentukan), **berhenti dan tanyakan ke Boss Ali** — jangan menebak angka bisnis sendiri.

6. kamu bisa lihat pada folder atau file yang di ScannApp Design Prototap kemungkinan seperti itu design aplikasiku, kamu bisa membuatnya lebih bagus atau smoot dengan menggunakan skill/plugin yang tersedia tanpa aku perintahkan, tinggal kamu kerjakan jikan selesai tunjukan nanti aku akan membuat keputusannya.

7. gunakan bahasa indonesia disetiap laporan yang kamu buat dan kegiatan/tugas apa yang kamu sedeng kerjan pastikan kmau menggunakan bahasa indonesia agar aku memahami mu.

## 6. Angka Final yang Wajib Dipakai (bukan lagi open decision — lihat PRD v2 Bagian 7)

- **Limit merge dokumen:** Basic maksimal 20 halaman per dokumen hasil merge, Pro unlimited.
- **Milestone referral:** 5 orang→7 hari Pro, 15 orang→25 hari Pro, 30 orang→60 hari Pro.
- **Harga Pro:** Rp 15.000/bulan atau Rp 150.000/tahun.
- **Frekuensi iklan Basic:** banner + interstitial tiap 5 scan, ditambah interstitial setelah export.
- **Quota storage R2:** Basic 100MB, Pro bulanan 500MB, Pro tahunan 1GB.
- **Reward referral untuk teman yang diundang:** 1 hari akses Pro (reward dua arah "give X get Y").
- **Interval job `expire-pro-status`:** tiap hari (jam 00:00), bukan tiap jam.
- **Signed URL R2:** langsung dari Supabase Edge Function, **tanpa** Cloudflare Worker tambahan — jangan tambah komponen infrastruktur baru untuk ini kecuali ada kebutuhan eksplisit (mis. resize gambar server-side) di kemudian hari.

Angka-angka di atas dipakai langsung sebagai konstanta/env var (lihat `.env.example`) — jangan tanyakan ulang ke Boss Ali kecuali ada perubahan eksplisit.

## 7. Infrastruktur yang Sudah Terpasang (jangan buat ulang, langsung pakai)

- **Repo GitHub:** `newbeboys/ScannApp`
- **Project Supabase:** nama "ScannApp", region Asia Pacific (Tokyo)
- **Supabase Secret Key** (setara `service_role`) sudah disimpan di Edge Function Secrets dengan nama **`ScannAppsecret`** — panggil dengan `Deno.env.get('ScannAppsecret')` di dalam Edge Function, **jangan** menamai ulang atau bikin secret baru untuk ini.
- **Cloudflare R2 bucket:** nama `scanappstorage`, region Asia-Pacific (APAC), storage class Standard.
- **4 secret R2 sudah tersimpan di Supabase Edge Function Secrets** (bukan di `.env` client):
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `R2_ENDPOINT`
  - `R2_BUCKET_NAME`
- Akses ke lima secret ini di Edge Function selalu lewat `Deno.env.get('<NAMA_SECRET>')` — jangan hardcode nilainya di kode, dan jangan asumsikan nama secret lain dari yang tercantum di atas.

## 8. Filosofi Kerja Claude Code di Proyek Ini

Boss Ali ingin Claude Code berperan besar dalam implementasi — ambil inisiatif teknis, buat keputusan detail implementasi sendiri. **Yang wajib dieskalasi ke Boss Ali hanya:** keputusan bisnis/angka baru yang belum ada di dokumen (lihat Bagian 6 & PRD Bagian 7), perubahan arsitektur besar (mis. ganti provider, ganti framework), atau pilihan yang punya trade-off signifikan tanpa jawaban jelas dari dokumen yang ada. Keputusan implementasi teknis kecil (struktur komponen, nama variabel, cara menulis query) tidak perlu ditanyakan — langsung kerjakan sesuai konvensi di Bagian 4.
