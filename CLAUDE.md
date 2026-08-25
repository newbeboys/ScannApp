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
- **Dua suite test, pilih yang benar** (ditetapkan 23 Agustus 2026, lihat `vitest.config.ts`):
  - `*.test.ts` → suite **node**, tanpa DOM. Untuk logika murni: perhitungan tier, migrasi index, kuota, matematika piksel filter. Ini mayoritas dan paling cepat.
  - `*.browser.test.ts` / `*.browser.test.tsx` → suite **browser**, Chromium sungguhan lewat Playwright. Untuk kode yang tugasnya memang bicara ke browser (`imageEditor` — kebenarannya ada di `canvas.toBlob` dan encoder JPEG/PNG) dan untuk komponen React (`vitest-browser-react`; `render()` mengembalikan Promise, jadi wajib `await`).
  - Jalankan salah satu saja dengan `npm run test:node` / `npm run test:browser`; `npm test` menjalankan keduanya.
  - **Jangan me-mock canvas untuk menguji kode canvas** — yang terbukti cuma bahwa mock-nya dipanggil. Kalau perlu bukti bahwa sebuah berkas benar-benar JPEG/PNG, periksa byte awalnya (`ff d8 ff` / `89 50 4e 47`), bukan nama atau tipe MIME-nya.

## 5. Alur Kerja yang Diharapkan

1. Sebelum coding, baca task terkait di `TASKS.md`.
2. Gunakan skill/plugin yang terpasang **hanya kalau relevan** dengan task yang sedang dikerjakan. Jangan aktifkan skill berat (`superpowers:test-driven-development`, alur brainstorm penuh) untuk perubahan kecil/config/typo — cukup edit langsung. Kalau ragu apakah suatu skill perlu diaktifkan, jalankan versi paling ringan dulu, baru eskalasi kalau memang perlu. Lihat kebijakan lengkap di Bagian 9.
3. Kerjakan satu task/subsistem per sesi kerja, ikuti urutan di `TASKS.md` (jangan lompat ke fitur Pro sebelum fondasi Basic selesai, kecuali diminta).
4. Setelah selesai satu task, update status di `TASKS.md`, lalu jalankan `/compact` sebelum lanjut ke task berikutnya dalam sesi yang sama.
5. Kalau menemukan keputusan yang belum ada di PRD/System Design (mis. angka limit yang belum ditentukan), **berhenti dan tanyakan ke Boss Ali** — jangan menebak angka bisnis sendiri.
6. Untuk polish desain dari **ScannApp Design Prototype**: boleh dikerjakan tanpa diminta ulang tiap kali, TAPI dengan batas:
   - Maksimal 1 subagent aktif untuk eksplorasi desain per sesi, kecuali Boss Ali minta lebih.
   - Kerjakan satu komponen/layar per sesi, jangan seluruh app sekaligus.
   - Sebelum mulai, sebutkan singkat rencana & estimasi cakupan (berapa file/komponen yang akan disentuh).
   - Tunjukkan hasilnya untuk Boss Ali putuskan sebelum lanjut ke komponen berikutnya — jangan lanjut berantai tanpa checkpoint.
7. Gunakan Bahasa Indonesia di setiap laporan yang dibuat dan setiap penjelasan kegiatan/tugas yang sedang dikerjakan, supaya Boss Ali bisa mengikuti.
8. Kalau pindah ke task atau subsistem yang tidak berhubungan dengan yang baru selesai, jalankan `/clear` — jangan bawa context lama yang sudah tidak relevan.

## 6. Angka Final yang Wajib Dipakai (bukan lagi open decision — lihat PRD v2 Bagian 7)

- **Limit merge dokumen:** Basic maksimal 20 halaman per dokumen hasil merge, Pro unlimited.
- **Milestone referral:** 5 orang→7 hari Pro, 15 orang→25 hari Pro, 30 orang→60 hari Pro.
- **Harga Pro:** Rp 15.000/bulan atau Rp 150.000/tahun.
- **Frekuensi iklan Basic** (direvisi 23 Agustus 2026, **mengganti** aturan lama "tiap 5 scan + setelah export"):
  - Banner di layar tab saja.
  - **Interstitial** setelah selesai edit dokumen, setelah selesai merge, dan setelah **7 scan berurutan dalam kurang dari 10 menit**. Export **tidak lagi** memicu iklan.
  - **App Open ad** saat aplikasi dibuka, dan saat user kembali setelah meninggalkan aplikasi **lebih dari 5 detik**. Kembali dari alur yang aplikasi sendiri yang memulai (pemindai, share sheet, file picker, pembelian) **tidak** dihitung — lihat `src/lib/ads/appOpenGate.ts`.
- **Quota storage R2:** Basic 100MB, Pro bulanan 500MB, Pro tahunan 1GB, **Pro dari referral 500MB** (ditetapkan 26 Juli 2026 saat Fase 4).
- **Paket Pro selalu berjangka:** hanya ada 1 bulan & 1 tahun — **tidak ada Pro permanen**. Baris `profiles` dengan `tier='pro'` tapi `tier_expires_at` kosong dianggap data rusak dan diperlakukan sebagai Basic (ditetapkan 26 Juli 2026 saat Fase 3).
- **Reward referral untuk teman yang diundang:** 1 hari akses Pro (reward dua arah "give X get Y").
- **Interval job `expire-pro-status`:** tiap hari (jam 00:00), bukan tiap jam.
- **Signed URL R2:** langsung dari Supabase Edge Function, **tanpa** Cloudflare Worker tambahan — jangan tambah komponen infrastruktur baru untuk ini kecuali ada kebutuhan eksplisit (mis. resize gambar server-side) di kemudian hari.
- **Reorder halaman & filter dokumen** (direvisi 23 Agustus 2026, **mengganti** PRD v2 Bagian 3 yang semula menandai keduanya Pro-exclusive): tersedia untuk **semua tier**, Basic maupun Pro — tidak ada gerbang tier untuk fitur ini. Filter naik dari 2 pilihan jadi **5**: Magic Color, Cerah, Abu-abu, Hitam-Putih, Hemat Tinta. ~~Annotate dan tanda tangan digital tetap Pro-exclusive.~~ — **dibatalkan 25 Agustus 2026**, lihat baris berikutnya.
- **Export PNG** (ditetapkan 23 Agustus 2026 sore, **mengganti** PRD v2 Bagian 3 yang menaruh PNG di kolom Pro): tersedia untuk **semua tier**. Yang tetap Pro dari baris "Export format" itu hanya **DOCX** dan **kontrol level kompresi manual**.
- **Level kompresi ekspor** (Pro): **4 takik**, bukan slider bebas 0–100 — Kecil (q 0.55 / 1600px), Standar (0.75 / 2400px), Tinggi (0.88 / 3200px), Maksimal (0.95 / 4000px). Standar identik dengan kompresi Basic yang lama, jadi tidak ada dokumen yang berubah hasilnya. Basic dipaksa ke Standar **di level library** (`resolveCompressionLevel`), bukan cuma disembunyikan di UI. Angka-angka ini teknis, bukan angka bisnis — boleh disetel ulang tanpa bertanya.
- **Anotasi, tanda tangan, pisah dokumen & ekspor banyak dokumen** (ditetapkan 25 Agustus 2026 setelah uji device, **mengganti** PRD v2 Bagian 3 dan baris "Annotate dan tanda tangan digital tetap Pro-exclusive" di atas): keempatnya tersedia untuk **semua tier**, Basic maupun Pro. Gerbangnya dilepas dari library juga (`setPageMarks`, `saveSplitScan`, `exportDocumentsBatch`), bukan cuma dari UI. Yang **tetap Pro** dari Fase 6: kontrol level kompresi manual (`canChooseCompression`), ekspor DOCX, bebas iklan, tanpa watermark, merge tanpa batas halaman, dan kuota storage lebih besar. Pola yang sama dengan dua pembatalan sebelumnya: **dasar untuk semua, Pro untuk kendali & mutu**.
- **Pisah dokumen tersimpan** (baru 25 Agustus 2026): kebalikan dari merge. Dokumen yang sudah disimpan bisa dipecah jadi beberapa dokumen dari layar detail. Dokumen asli **tidak** dihapus kecuali user mencentangnya, dan **tidak pernah** dihapus kalau ada satu kelompok yang gagal dibuat — halaman kelompok itu belum ada di tempat lain.
- **Cadangan cloud tidak mengikuti level kompresi** (keputusan Boss Ali 23 Agustus 2026): `buildPdfFile()` selalu memakai Standar. Pilihan di lembar Ekspor hanya mengatur berkas yang sedang disimpan/dibagikan — kalau ia ikut mengatur cadangan, satu pilihan di layar ekspor diam-diam menentukan konsumsi kuota R2 dan mutu maksimal yang bisa dikembalikan `cloudRestore`.

Angka-angka di atas dipakai langsung sebagai konstanta/env var (lihat `.env.example`) — jangan tanyakan ulang ke Boss Ali kecuali ada perubahan eksplisit.

## 7. Infrastruktur yang Sudah Terpasang (jangan buat ulang, langsung pakai)

- **Repo GitHub:** `newbeboys/ScannApp`
- **Project Supabase:** nama "ScannApp", region Asia Pacific (Tokyo)
- **Supabase Secret Key** (setara `service_role`) sudah disimpan di Edge Function Secrets dengan nama **`ScannAppsecret`** — panggil dengan `Deno.env.get('ScannAppsecret')` di dalam Edge Function, **jangan** menamai ulang atau bikin secret baru untuk ini.
- **Cloudflare R2 bucket:** nama `scanappstorage`, region Asia-Pacific (APAC), storage class Standard.
- **Akun AdMob sudah ada** (diberikan Boss Ali 23 Agustus 2026). Bukan rahasia — semuanya ikut terkirim di dalam APK, jadi tidak melanggar Aturan Keras #1:
  - App ID `ca-app-pub-1798871739591323~7781334359` — ditulis di `AndroidManifest.xml`
  - Banner `ca-app-pub-1798871739591323/4963599326`
  - Interstitial `ca-app-pub-1798871739591323/1215875677`
  - App Open `ca-app-pub-1798871739591323/5682085946`
  - **Unit asli hanya dipakai build rilis.** Build dev dan APK debug dari CI selalu memakai unit test resmi Google — impresi berulang dari HP developer sendiri itu invalid traffic dan AdMob menutup akun karenanya.
- **4 secret R2 sudah tersimpan di Supabase Edge Function Secrets** (bukan di `.env` client):
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `R2_ENDPOINT`
  - `R2_BUCKET_NAME`
- Akses ke lima secret ini di Edge Function selalu lewat `Deno.env.get('<NAMA_SECRET>')` — jangan hardcode nilainya di kode, dan jangan asumsikan nama secret lain dari yang tercantum di atas.

## 8. Filosofi Kerja Claude Code di Proyek Ini

Boss Ali ingin Claude Code berperan besar dalam implementasi — ambil inisiatif teknis, buat keputusan detail implementasi sendiri. **Yang wajib dieskalasi ke Boss Ali hanya:** keputusan bisnis/angka baru yang belum ada di dokumen (lihat Bagian 6 & PRD Bagian 7), perubahan arsitektur besar (mis. ganti provider, ganti framework), atau pilihan yang punya trade-off signifikan tanpa jawaban jelas dari dokumen yang ada. Keputusan implementasi teknis kecil (struktur komponen, nama variabel, cara menulis query) tidak perlu ditanyakan — langsung kerjakan sesuai konvensi di Bagian 4.

Inisiatif teknis ini **tetap tunduk pada kebijakan model & subagent di Bagian 9.5** — "ambil inisiatif" bukan berarti bebas dari batas cakupan, jumlah subagent, atau pilihan model.

## 9. Konvensi Plugin & Skill Claude Code

Plugin berikut sudah terpasang di scope user/project — **tidak perlu diinstall ulang atau ditanyakan lagi**, langsung dipakai sesuai konteks. Sebagian bersifat otomatis (model-invoked), sebagian butuh aturan tambahan supaya hasilnya konsisten dengan proyek ini.

### 9.1 Plugin otomatis (tidak butuh perintah manual)

- **security-guidance** — jalankan sebelum commit (bukan tiap penyimpanan file per-edit), untuk pola injection, XSS, secret ter-expose, IDOR. Kalau ada temuan, laporkan sebelum lanjut, jangan diamkan.
- **typescript-lsp** — diagnostik TypeScript real-time (type errors, jump-to-definition). Berjalan di background, tidak perlu dipanggil.
- **frontend-design** — aktif otomatis saat mengerjakan UI/frontend. **Lihat aturan wajib di 9.2 sebelum skill ini dipakai.**

### 9.2 Aturan wajib untuk frontend-design (mengikat, bukan saran)

Skill ini cenderung mendorong pemilihan font/warna/aksen baru yang "distinctive" demi menghindari tampilan AI generik. **Proyek ini sudah punya design token final (3-layer: primitive → semantic → component)** — blue `#2563EB` primary, coral `#FF6B4A` khusus elemen Pro/upgrade, amber `#F59E0B` warning, gold `#F5C443` badge Pro.

- **Wajib pakai token yang sudah ada.** Jangan perkenalkan palet warna atau font baru tanpa konfirmasi eksplisit dari Boss Ali, meskipun skill frontend-design menyarankan arah estetik berbeda demi "distinctiveness".
- Kebebasan skill ini **hanya berlaku** pada aspek yang belum ditentukan: layout, spacing, micro-interaction, tipografi pendukung (bukan warna brand), komposisi visual.
- Kalau ragu apakah suatu keputusan visual menyentuh token yang sudah final atau area bebas — berhenti dan tanyakan, jangan menebak (konsisten dengan Aturan Keras di Bagian 3).

### 9.3 Superpowers (alur brainstorm → plan → execute)

- **Task baru/besar** (subsistem baru, fitur belum ada sebelumnya): ikuti alur penuh — brainstorm dulu, baru write-plan, baru execute-plan. Sebelum mulai alur penuh ini, sebutkan dulu perkiraan skill/subagent apa saja yang akan terpakai (lihat Bagian 9.5).
- **Fix kecil / perubahan config / typo**: boleh skip langsung ke eksekusi kalau Boss Ali eksplisit bilang "langsung kerjakan" atau semacamnya — jangan paksakan proses penuh untuk perubahan trivial.
- Proses ini **tidak menggantikan** Aturan Keras di Bagian 3 & alur kerja Bagian 5 — kalau brainstorm/plan mengarah ke keputusan bisnis/angka yang belum ada di PRD/System Design, tetap berhenti dan tanya (bukan diputuskan sendiri oleh proses Superpowers).

### 9.4 code-review & commit-commands

- **code-review**: jalankan sebelum commit untuk perubahan yang menyentuh lebih dari satu file atau logic non-trivial. Untuk perubahan satu baris/config, boleh dilewati.
- **commit-commands**: pakai untuk format commit message, ikuti conventional commits — tidak perlu approval manual per commit message kecuali isinya menyangkut perubahan yang juga butuh review kode.

### 9.5 Kebijakan Model & Subagent (mengikat)

- Task ringan (baca file, cek error, edit satu-dua baris, cari string, fix typo) → **Sonnet**, bukan Opus.
- Opus dipakai hanya untuk: desain arsitektur, debugging kompleks lintas file, keputusan struktural besar.
- Jangan spawn lebih dari **2 subagent paralel** tanpa konfirmasi eksplisit ke Boss Ali dulu — termasuk subagent yang dibawa oleh plugin (bukan cuma yang didefinisikan sendiri di project). Proyek ini tidak punya subagent custom sendiri; semua subagent yang muncul kemungkinan besar dari plugin (mis. `superpowers`) — batas yang sama tetap berlaku.
- Sebelum menjalankan alur Superpowers penuh (brainstorm → plan → execute) untuk task besar, sebutkan dulu perkiraan skill/subagent apa saja yang akan terpakai, supaya Boss Ali bisa menilai cakupannya sebelum tereksekusi.
- Gunakan `/compact` setiap selesai satu fase kerja (mis. selesai satu task di `TASKS.md`). Gunakan `/clear` saat pindah ke task/subsistem yang tidak berhubungan.
- `CLAUDE_CODE_SUBAGENT_MODEL` sudah diset ke Sonnet lewat `.claude/settings.json` (env). Jangan override subagent ke Opus kecuali task itu memang butuh reasoning berat — kalau override diperlukan, beri tahu Boss Ali beserta alasannya sebelum dijalankan.
