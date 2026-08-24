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

**~~Terblokir — CORS bucket `scanappstorage`~~ — ternyata tidak memblokir aplikasi native.** Diperiksa langsung di database produksi 23 Agustus 2026: dua dokumen milik `demofimance@gmail.com` benar-benar tercatat di `scan_documents` dengan `local_only=false` — 326.679 dan 340.191 byte, berjumlah **persis** sama dengan `storage_usage.bytes_used` (666.870). Ukuran itu bukan klaim client: `confirm-upload` mengambilnya dari HTTP HEAD sungguhan ke R2, jadi barisnya tidak akan ada kalau objeknya tidak benar-benar sampai. Entah CORS sudah dipasang Boss Ali tanpa dicatat di sini, atau lapisan native memang tidak melewati preflight browser — yang jelas unggahan dari HP berhasil. Kalau nanti ada versi web (bukan APK), CORS perlu ditinjau ulang; JSON-nya ada di spec Fase 4 Bagian 9.

- [x] Cadangkan dokumen sungguhan dari HP — terbukti dari dua baris di atas
- [ ] Unduh cadangan di HP (harus membuka/menyimpan PDF)

## Fase 5 — Fitur Iklan & Monetisasi (Basic)

Desain: `docs/superpowers/specs/2026-08-22-fase5-iklan-monetisasi-design.md`

### A. Iklan

- [x] Integrasi AdMob — `@capacitor-community/admob` 8.1.0
- [x] Banner ad di layar utama — hanya di layar tab, tidak di alur scan/editor/merge/paywall
- [x] ~~Interstitial ad: tiap 5 scan + setelah export~~ — **aturan ini diganti 23 Agustus 2026**, lihat bagian "Kebijakan Iklan Baru" di bawah
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

- [x] ~~Buat akun AdMob, isi unit ID di `.env`, ganti `APPLICATION_ID` di `AndroidManifest.xml`~~ — **selesai 23 Agustus 2026.** ID diberikan Boss Ali, semuanya sudah terpasang (lihat CLAUDE.md Bagian 7)
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

## Ubah Nama Dokumen (semua tier) — 23 Agustus 2026

Diminta Boss Ali saat uji device. Bukan fitur Pro: menamai dokumen sendiri itu kebutuhan dasar, bukan nilai jual.

- [x] Ubah nama dokumen di HP (`renameScanDocument`) — local-first, tidak pernah butuh jaringan
- [x] Sinkron nama ke salinan cloud lewat Edge Function `rename-document` — client sengaja tidak punya izin tulis ke `scan_documents` (dicabut migration `20260821211059`), jadi rename lewat service role dengan cek kepemilikan dan hanya kolom `title` yang bisa disentuh
- [x] Normalisasi judul dipakai bersama `confirm-upload` (`_shared/documentTitle.ts`) supaya mencadangkan dokumen tidak menimpa nama yang baru diubah
- [x] ~~**Deploy `rename-document` + redeploy `confirm-upload`**~~ — **sudah live 23 Agustus 2026** atas persetujuan Boss Ali (`rename-document` v1, `confirm-upload` v4, keduanya `verify_jwt=true`). Diverifikasi langsung ke endpoint produksi: tanpa token ditolak gateway 401, dan dengan anon key sebagai bearer ditolak 401 dengan pesan milik `handler()` kita sendiri — membuktikan kode kita yang berjalan, dependency `_shared` teresolusi, dan anon key yang bocor tetap tidak bisa mengubah nama dokumen siapa pun. Baris uji tidak tersentuh oleh kedua percobaan itu.
- [ ] Uji di HP: ubah nama, lalu cek daftar cadangan cloud ikut berubah; ubah nama saat offline harus tetap berhasil di HP dengan pesan bahwa cloud menyusul

## Pulihkan Cadangan Cloud ke HP — 23 Agustus 2026

Lubang di Fase 4: mencadangkan sudah jalan, tapi setelah install ulang aplikasi tampil kosong seolah dokumennya hilang — satu-satunya jalan kembali adalah tombol Unduh di layar Cadangan, yang cuma membuka PDF, bukan mengembalikan dokumen yang bisa diedit/digabung.

- [x] Daftar dokumen menggabungkan isi HP + cadangan cloud (`mergeDocumentEntries`) — cadangan yang belum ada di HP tampil sebagai baris "Di cloud", diurutkan bersama, terbaru dulu
- [x] Pulihkan satu dokumen (ketuk barisnya) & "Pulihkan semua" — dijalankan berurutan, satu kegagalan tidak membatalkan sisanya
- [x] `readBackup` mengambil kembali JPEG asli dari PDF cadangan lewat lookup XObject/DCTDecode, tanpa rasterisasi — hasilnya byte-identik dengan halaman aslinya, dan **watermark Basic tidak ikut** (digambar sebagai teks di atas gambar, bukan dibakar ke piksel), jadi cadangkan-pulihkan-cadangkan tidak menumpuk watermark
- [x] Dokumen dipulihkan memakai **id yang sama** dengan barisnya di `scan_documents` — id baru akan membuat backup berikutnya menulis baris kedua, menghitung byte yang sama dua kali terhadap kuota, dan meninggalkan objek lama jadi yatim
- [x] Tanggal pindai dibawa di dalam PDF-nya sendiri (`BuildPdfOptions.scannedAt` → creation date). `scan_documents.created_at` adalah waktu **cadangan pertama**, bukan waktu pindai, jadi tanpa ini dokumen Maret yang dicadangkan Agustus akan kembali bertanggal Agustus dan melompat ke puncak daftar. Cadangan lama tetap bisa dipulihkan, jatuh ke tanggal baris
- [x] Ubah nama menyegarkan judul di daftar cloud — kalau tidak, memulihkan dokumen yang sudah dihapus dari HP akan menulis balik nama lama
- [x] Test bertambah 36 (total 208); 4 temuan code-review ditutup sebelum commit (judul basi, semantik tanggal, folder dokumen yang sudah ada, dan index yang bisa terinjak kalau user memindai selama "Pulihkan semua" berjalan)

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] Install ulang aplikasi (atau hapus dokumen dari HP), buka daftar — dokumen harus muncul sebagai "Di cloud", bukan daftar kosong
- [ ] Ketuk untuk memulihkan — dokumen harus bisa dibuka, diedit, dan digabung seperti dokumen biasa
- [ ] Cadangkan ulang dokumen hasil pulihan — `bytes_used` **tidak boleh** naik dua kali lipat (bukti id-nya dipakai ulang dengan benar)
- [ ] Pulihkan dokumen milik akun Basic — hasilnya harus bersih tanpa watermark ganda

## Kebijakan Iklan Baru + Akun AdMob Asli — 23 Agustus 2026

Keputusan Boss Ali, **mengganti** aturan lama di CLAUDE.md Bagian 6 ("interstitial tiap 5 scan + setelah export").

- [x] Akun AdMob asli terpasang: App ID di `AndroidManifest.xml`, tiga unit ID (banner, interstitial, app open) di `.env`
- [x] **Interstitial** sekarang dipicu tiga hal: selesai edit dokumen, selesai merge, dan **7 scan berurutan dalam kurang dari 10 menit**. Export tidak lagi memicu iklan
- [x] Rentetan scan dihitung dengan jendela geser cap waktu di localStorage, bukan penghitung sederhana — supaya "berurutan" benar-benar berarti berdempetan, dan scan santai sekali beberapa menit tidak pernah memicu apa pun. Cap waktu di masa depan dibuang (jam HP bisa mundur saat ganti timezone)
- [x] Iklan setelah edit hanya muncul kalau **ada yang benar-benar diubah** — membuka editor lalu keluar lagi bukan "selesai edit"
- [x] **App Open ad** saat aplikasi dibuka & saat user kembali setelah pergi >5 detik, lewat `visibilitychange` (tanpa menambah plugin Capacitor baru)
- [x] **Kembali dari alur yang kita sendiri yang memulai tidak dihitung** — pemindai ML Kit, share sheet, file picker, dan pembelian Play semuanya activity terpisah, jadi WebView melihatnya persis seperti user pergi ke aplikasi lain. Tanpa penanda ini, tiap selesai memindai user langsung disambut iklan layar penuh, dan pembelian mendarat di balik iklan
- [x] Unit asli **hanya** masuk build rilis (`build-aab.yml`). APK debug dari CI tetap memakai unit test resmi Google — impresi berulang dari HP Boss Ali sendiri itu invalid traffic yang bisa menutup akun AdMob
- [x] Test bertambah 15 (total 223)

Empat temuan code-review ditutup sebelum commit, semuanya di kode iklan baru:

1. **Iklan beruntun tanpa henti.** Iklan layar penuh AdMob juga activity terpisah, jadi menampilkannya membuat WebView background. Menutup interstitial setelah >5 detik akan langsung memanggil App Open ad di atasnya — dan App Open ad menutup dirinya dengan cara yang sama, jadi rantainya tidak berhenti. Sekarang iklan kita sendiri ikut ditandai sebagai kepergian internal.
2. **User Pro bisa kena iklan.** `tier` membaca Basic sampai profil termuat, dan `status` jadi `signed-in` sebelum itu. User Pro yang login di HP baru bisa disambut App Open ad. Ditutup dengan flag `tierResolved` baru di AuthProvider.
3. **Penanda alur internal bisa nyangkut** kalau panggilan yang mengirim user pergi ternyata gagal (mis. permintaan signed URL timeout) — penanda itu lalu memakan kepergian sungguhan berikutnya. Sekarang penandanya kedaluwarsa sendiri setelah 10 detik.
4. **Iklan hilang, bukan tertunda.** Rentetan 7 scan dikosongkan saat keputusan dibuat, padahal iklannya bisa gagal tampil karena belum termuat. Sekarang rentetan hanya habis setelah iklannya sungguh tampil.

**Langkah manual Boss Ali (memblokir pendapatan iklan, bukan rilisnya):**

- [ ] Set 3 secret di GitHub → Settings → Secrets → Actions: `VITE_ADMOB_BANNER_UNIT_ID`, `VITE_ADMOB_INTERSTITIAL_UNIT_ID`, `VITE_ADMOB_APP_OPEN_UNIT_ID` (nilainya ada di CLAUDE.md Bagian 7). **Kalau tidak di-set, aplikasi rilis tidak crash — ia diam-diam menyajikan iklan test yang tidak menghasilkan apa pun.**

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] Scan 7 dokumen cepat berturut-turut → interstitial muncul di yang ketujuh; scan santai (jeda >10 menit) tidak memicu apa pun
- [ ] Selesai edit → iklan muncul. Buka editor lalu langsung keluar tanpa mengubah apa pun → **tidak** ada iklan
- [ ] Selesai merge → iklan muncul
- [ ] Pindah ke aplikasi lain >5 detik lalu kembali → App Open ad muncul. Pindah sekejap (<5 detik) → tidak muncul
- [ ] **Paling penting:** selesai memindai, dan selesai share hasil export → **tidak boleh** ada App Open ad. Kalau muncul, penanda alur internalnya tidak bekerja
- [ ] Akun Pro → tidak ada iklan sama sekali, termasuk App Open

## Fase 6 — Fitur Pro: OCR & Edit Lanjutan

**Urutan disetujui Boss Ali 23 Agustus 2026:** mulai dari **reorder halaman + filter lanjutan** (paling dekat dengan kode editor, tanpa dependency baru), baru sisanya.

Desain: `docs/superpowers/specs/2026-08-23-fase6-reorder-filter-design.md`

- [ ] Integrasi OCR (searchable PDF)
- [x] Annotate (coret/tulis di atas dokumen) — **Pro**, lihat bagian 3 di bawah
- [x] Tanda tangan digital — **Pro**, lihat bagian 3 di bawah
- [x] Reorder halaman — tombol geser kiri/kanan (bukan seret-lepas, lihat spec Bagian 2.6). **Semua tier**
- [x] Filter lanjutan — **5 filter** (Boss Ali menaikkan dari 2 di PRD Bagian 3): Magic Color, Cerah, Abu-abu, Hitam-Putih (ambang adaptif lokal), Hemat Tinta. Berlaku untuk seluruh dokumen, bisa dikecualikan per halaman. **Semua tier**
- [x] Export tambahan: **PNG** — **semua tier** (lihat catatan di bawah). DOCX belum: tanpa OCR isinya cuma gambar tertempel, jadi dipindah ke potongan yang sama dengan OCR
- [x] Kontrol level kompresi manual (slider kualitas vs ukuran) — **4 takik**, tetap Pro
- [ ] Batch scan/export

**Diubah 23 Agustus 2026 (keputusan Boss Ali):** reorder halaman & filter dokumen semula Pro-exclusive, sekarang **tersedia untuk Basic maupun Pro** — bukan cuma akun Pro. Menggantikan baris di PRD Bagian 3 dan CLAUDE.md Bagian 6; lihat catatan di kedua file itu. Annotate dan tanda tangan digital di daftar di atas tetap Pro-exclusive (belum dikerjakan).

Catatan tambahan di luar daftar asli (lihat spec Bagian 2 & 3):

- [x] Model halaman naik ke `schemaVersion: 3` — filter disimpan terpisah dari `edited`, tidak ditumpuk seperti crop/putar, supaya ganti filter tidak menghapus crop. File hasil filter diturunkan ulang dari rantai geometri (`edited ?? original`), tidak pernah dari filter sebelumnya, jadi crop setelah filter tidak membakar filter ke `edited`. Migrasi otomatis dari v2, dokumen Fase 2 tidak berubah tampilannya
- [x] `resolvePage()` jadi satu-satunya titik yang tahu urutan `filtered ?? edited ?? original` — ekspor, merge, dan cadangan cloud otomatis ikut berfilter tanpa satu pun disentuh
- [x] Nama file hasil edit/filter diturunkan dari `original` (stabil, sekali dibuat), bukan dari posisi array — reorder tidak menyentuh file, jadi kalau namanya berbasis index, halaman yang pindah posisi bisa menimpa file halaman lain
- [x] Unit test bertambah 43 (total 277) — termasuk matematika lima filter di piksel yang diketahui (bisa diuji tanpa canvas), migrasi v3, tabrakan nama file akibat reorder
- [x] Code-review 3-sudut (correctness + reuse + simplification/efficiency) sebelum commit — 4 temuan correctness ditutup (tabrakan nama file, filter tidak dirender ulang setelah "Asli", gating Pro yang sebelumnya cuma di UI, campur bahasa komentar), beberapa temuan kerapian ikut dibereskan (token warna badge Pro yang salah, duplikasi logika render-ulang-filter). Gating Pro yang sempat ditambahkan di `documentEditing.ts` lalu **dilepas lagi** menyusul keputusan Boss Ali di atas

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] Reorder halaman terasa enak dipakai dengan jempol di HP sungguhan
- [ ] Filter untuk dokumen 15+ halaman tidak terasa lama/macet (progress bar muncul selama proses)
- [ ] Hasil Hitam-Putih tetap bersih di halaman yang tercahaya tidak rata (foto dokumen dengan bayangan tangan)
- [ ] Akun Basic melihat tombol Filter & Urutkan **tanpa** lencana "Pro" dan bisa langsung memakainya

### Fase 6 bagian 2 — Kontrol Export (23 Agustus 2026)

Sisa Fase 6 dipecah jadi empat potongan yang bisa jalan sendiri-sendiri; ini yang pertama. Urutan sisanya: **B** annotate + tanda tangan (satu pipeline kanvas), **C** batch scan/export, **D** OCR + DOCX (paling berat, butuh engine OCR on-device — perlu spike memilih engine dulu).

Pengelompokan `Export tambahan: DOCX, PNG` di daftar asli dipecah: PNG masuk ke potongan ini (cuma varian encoder dari export JPG yang sudah ada), DOCX ikut OCR karena DOCX tanpa lapisan teks isinya hanya gambar tertempel.

- [x] **Export PNG — semua tier.** PNG diturunkan langsung dari halaman hasil `resolvePage()`, hanya lewat bagian perkecilan dari level yang dipilih, lalu di-encode `image/png`. **Tidak pernah** lewat encoder JPEG dulu: PNG dari hasil JPEG adalah salinan lossless dari piksel yang sudah lossy — berkasnya membengkak tanpa satu piksel pun jadi lebih baik
- [x] **Slider kompresi manual (Pro) — 4 takik**, bukan 0–100 bebas. Mata tidak membedakan q=0.72 dari q=0.75, jadi slider bebas menjanjikan presisi yang tidak ada dan memaksa encode ulang tiap geseran. Standar = 0.75/2400px, identik dengan nilai Basic yang lama
- [x] Gerbang Pro ditegakkan di `resolveCompressionLevel()`, bukan cuma di UI — Basic yang meminta level apa pun tetap dapat Standar
- [x] Pilihan level diingat di `localStorage`; nilai rusak/hilang/storage terkunci semuanya jatuh ke Standar tanpa melempar error
- [x] **Perkiraan ukuran per format** di lembar Ekspor (`≈ 2,3 MB` / `≈ 17 MB`) — halaman pertama saja yang di-encode lalu dikali jumlah halaman, supaya menggeser slider di dokumen 30 halaman tidak makan waktu. Angka PNG yang jauh lebih besar jadi terlihat sendiri, tidak perlu kalimat peringatan
- [x] Perkiraannya memakai tier yang sama dengan ekspor sungguhan, jadi Basic tidak pernah diperlihatkan ukuran yang tidak bisa ia dapatkan
- [x] Test bertambah 31 (total 308)

**Cadangan cloud sengaja tidak ikut level ini** (keputusan Boss Ali): `buildPdfFile()` dipaku ke Standar. Kalau ikut, satu pilihan di lembar Ekspor diam-diam menentukan berapa kuota R2 yang dimakan sebuah cadangan dan mutu maksimal yang bisa dikembalikan `cloudRestore` — dua hal yang tidak sedang dipikirkan user saat menekan tombol ekspor.

**Diubah 23 Agustus 2026 (sore):** export PNG semula Pro-exclusive di PRD Bagian 3, sekarang **semua tier** atas permintaan Boss Ali. Menggantikan baris "Export format" di PRD; lihat catatan di PRD Bagian 3 dan CLAUDE.md Bagian 6.

**Tiga perbaikan dari code-review, dikerjakan sebelum lanjut ke potongan B (permintaan Boss Ali):**

- [x] **Filter per-halaman bisa jalan dobel.** `FilterPicker` cuma menerima `progress`, yang hanya diisi untuk scope dokumen — chip tetap hidup selama render satu halaman, dan ketukan kedua memulai render kedua yang menulis file dan index yang sama. Sekarang komponennya menerima `isBusy`
- [x] **Chip "Asli" bisa menghapus filter seluruh dokumen.** Chip yang tersorot selalu diambil dari filter efektif halaman yang terbuka, padahal scope bisa "Semua halaman": dokumen Hitam-Putih dengan halaman yang dikecualikan menyalakan "Asli", jadi terlihat seolah dokumen tidak berfilter — dan menekannya (tampak tanpa efek) justru menjalankan `setDocumentFilter(null)`. Sekarang sorotan mengikuti scope
- [x] **Seleksi pindah walau geseran gagal.** `run()` menelan error, jadi `setPageIndex` tetap jalan dan geseran berikutnya mengenai halaman yang salah. `run()` sekarang melaporkan berhasil/gagal

Temuan keempat (**file filter yatim kalau `applyDocumentFilter` gagal di tengah**) **tidak diubah** — itu trade-off yang memang disengaja dan sudah tertulis di komentarnya: satu tulisan index di akhir, bukan dua puluh. Yang diperbaiki komentarnya, yang tadinya menjanjikan lebih dari yang sebenarnya dijamin. Keadaan setelah gagal terlihat oleh user, sembuh sendiri saat filter diterapkan lagi (nama file turunan tetap per halaman, jadi ditimpa), dan tidak ada yang hilang — `original` dan `edited` tidak pernah disentuh di situ. Membuatnya benar-benar atomik butuh nama file yang memuat nama filter, yaitu perubahan tata letak penyimpanan, bukan perbaikan loop.

**Terverifikasi di Chromium sungguhan** (bukan di HP — lihat catatan di bawah). `imageEditor.compressImage` dijalankan langsung di browser lewat halaman uji sekali pakai:

- JPEG keluar sebagai JPEG (`ff d8 ff e0`), PNG keluar sebagai PNG (`89 50 4e 47`) — jalur PNG betul-betul memakai encoder PNG
- Batas sisi terpanjang dipatuhi: 3000×4200 → 1714×2400 di Standar, → 2857×4000 di Maksimal, rasio terjaga
- Ukuran menurun monoton menurut level: 200 KB (Kecil) → 395 KB (Standar) → 956 KB (Maksimal)
- **Jebakan PNG-dari-JPEG terbukti nyata:** PNG dari halaman asli 102 KB, PNG dari hasil JPEG 191 KB — 87% lebih berat tanpa satu piksel pun membaik
- **PNG vs JPEG sangat bergantung isi halaman:** scan kamera ber-noise 11,3× lebih besar; bercahaya rata 13,8× lebih besar; setelah filter Hitam-Putih justru **4× lebih kecil**. Rentang ini yang membuat perkiraan ukuran harus **diukur dari halamannya**, bukan ditebak dengan rumus — dan yang membenarkan teks "pas untuk Hitam-Putih" di lembar Ekspor

### Fase 6 bagian 3 — Anotasi & Tanda Tangan (Pro) — 24 Agustus 2026

Potongan **B** dari empat sisa Fase 6. Tetap **Pro-exclusive** — dua baris ini tidak ikut dipindahkan Boss Ali ke "semua tier" seperti reorder/filter/PNG.

Desain: `docs/superpowers/specs/2026-08-24-fase6-annotate-tandatangan-design.md`

- [x] **Goresan disimpan sebagai data, bukan dibakar ke `edited`.** Halaman naik ke `schemaVersion: 4` dengan `marks` (vektor, koordinat 0..1) dan `annotated` (hasil render). Membakar tinta ke `edited` akan membuat filter Hitam-Putih ikut menghitamkan tanda tangan biru, dan mengganti filter berarti kehilangan seluruh anotasi
- [x] `resolvePage()` jadi `annotated ?? filtered ?? edited ?? original` — **ekspor, merge, cadangan cloud, dan pratinjau layar penuh tidak disentuh sama sekali**, persis seperti waktu filter ditambahkan
- [x] **Crop & putar memetakan ulang goresan**, tidak membuangnya (`remapMarksForCrop`, `remapMarksForRotation`). Koordinat normalisasi mengambang relatif terhadap isi halaman, jadi crop akan menggeser tinta terhadap kertasnya. Goresan yang seluruhnya jatuh di luar area crop dibuang; ketebalan ikut diskalakan supaya garis tidak menipis saat halaman diperbesar oleh crop
- [x] **Alat:** Pena, Stabilo (`multiply`, bukan alpha biasa — teks di bawahnya harus tetap hitam dan terbaca), Tanda tangan, Urungkan, Hapus semua. **Sengaja tidak masuk:** kotak teks & bentuk — teks butuh papan ketik melayang, ukuran huruf yang ikut skala halaman, dan pengeditan setelah dibuat; itu subsistem tersendiri
- [x] **4 warna tinta, semuanya sudah ada di kode**: `#1b2740` (`--fg` terang), `#2563eb` (primary), `#e5484d` (danger), `#f5c443` (`--pro-gold`). Tidak ada warna baru (CLAUDE.md 9.2), dan ada test yang menjaganya
- [x] **Tanda tangan digambar di kotak selebar layar**, bukan langsung di halaman. Menandatangani di kotak kecil di sudut halaman menghasilkan coretan besar dan gemetar; hasilnya dipangkas ke kotak tinta-nya sendiri (`trimToInk`) supaya stempelnya bukan sebagian besar ruang kosong
- [x] Berkas tanda tangan bernama `signature-<cap waktu>.png`, bukan nama tetap: menggambar ulang tidak boleh diam-diam mengganti tanda tangan di dokumen yang **sudah** ditandatangani, termasuk yang sudah dicadangkan
- [x] **Gerbang Pro ditegakkan di library** (`setPageMarks`), bukan cuma menyembunyikan tombol — pelajaran yang sama dengan `resolveCompressionLevel`
- [x] Goresan hidup di draft memori sampai ditekan Simpan. Menulis per goresan berarti meng-encode ulang JPEG 12 MP tiap kali jari diangkat
- [x] Test bertambah 74 (total 453 — 418 node + 35 browser), termasuk 10 test `renderMarks` di **Chromium sungguhan**: tinta mendarat di piksel yang dituju, mata pena ikut skala halaman, stabilo membiarkan teks di bawahnya tetap hitam, stempel tanda tangan pas di kotaknya, dan merender goresan yang sama dua kali **tidak** menebalkannya
- [x] **Test-nya dibuktikan menggigit:** `multiply` dilepas → test stabilo merah; faktor lebar stabilo dilepas → test lebar merah; sumber render tinta diubah jadi berkas hasilnya sendiri → 2 test penumpukan merah. Semua dikembalikan setelah itu

**Delapan temuan code-review ditutup sebelum commit:**

- [x] **Tanda tangan bergerak setengah kecepatan jari.** Drag membaca stempel dari `marks` hasil render terakhir sambil memajukan `lastX` tiap pointermove — dua gerakan dalam satu frame keduanya membaca kotak pra-drag, tapi hanya satu deltanya terpakai. Sekarang drag menyimpan stempel awalnya dan tiap gerakan dihitung dari situ
- [x] **Crop/putar merender tinta dua kali.** `reapplyFilter` sudah ikut merender tinta (di koordinat pra-crop), lalu ditimpa pass kedua — satu siklus render 12 MP terbuang, dan kalau pass kedua gagal, tinta tersimpan permanen di posisi salah. `applyPageDerived` sekarang membangun keduanya dalam satu pass. `reapplyFilter`/`reapplyMarks` hilang sama sekali
- [x] **`revertPage` juga merender tinta dua kali** — hilang dengan perbaikan yang sama
- [x] **`resizeSignature` merusak rasio secara permanen.** Tinggi dibatasi di tepi bawah halaman, lalu resize berikutnya membaca kotak yang sudah gepeng itu sebagai rasio aslinya — stempel yang digeser ke kaki halaman jadi penyet selamanya. Tinggi tidak lagi dibatasi; lebar minimum juga tidak lagi bisa ditembus di tepi kanan
- [x] **Berkas tanda tangan jadi sampah permanen.** PNG ditulis begitu digambar (overlay butuh berkasnya untuk menampilkan stempel saat digeser), tapi tidak ada yang pernah menghapusnya — batal lewat tombol kembali, atau menghapus dokumen terakhir yang memakainya. `pruneUnusedSignatures()` menyapu yang tak lagi dirujuk, dipanggil saat hapus dokumen dan **setelah editor ditutup** (bukan saat draft masih terbuka — tanda tangan draft belum ada di index)
- [x] **Tombol kembali di mode anotasi membuang coretan tanpa bertanya** dan meninggalkan `draftMarks` basi. Sekarang lewat `closeAnnotate()` dengan konfirmasi kalau ada yang belum disimpan
- [x] **`setSelectedMark` dipanggil di dalam updater `setDraftMarks`** — updater harus murni; React boleh memanggilnya lebih dari sekali
- [x] **Pratinjau: pointer di tombol panah bisa mengakhiri gestur jari lain.** Pointer itu sengaja tidak masuk `pointers`, tapi `pointerup`-nya tetap menutup geseran yang sedang jalan memakai **koordinat tombol** — halaman bisa melompat. Sekarang `endPointer` mengabaikan pointer yang tidak pernah memulai gestur

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] Menggambar dengan jempol terasa mengikuti, tidak tertinggal — termasuk di halaman 12 MP
- [ ] Stabilo di atas teks: teksnya **tetap terbaca**, tidak tertutup blok kuning
- [ ] Tanda tangan: gambar di kotak lebar, tempel, geser, ubah ukuran — geserannya sepadan dengan jari dan bentuknya tidak pernah gepeng
- [ ] Simpan anotasi pada dokumen 12 MP — berapa lama? Kalau terasa lama, ini kandidat pertama untuk indikator progres
- [ ] **Potong halaman yang sudah dianotasi** — tinta harus ikut pindah, bukan melayang ke tempat lain
- [ ] **Putar halaman yang sudah dianotasi** — tinta ikut berputar
- [ ] **Ganti filter dokumen setelah menandatangani** — tanda tangan biru harus tetap biru, tidak ikut jadi hitam pekat, dan tidak menghilang
- [ ] Ekspor PDF & cadangkan ke cloud — tinta ikut ke dua-duanya
- [ ] Akun **Basic**: tombol "Anotasi & Tanda Tangan" berlencana Pro dan membuka paywall, bukan editornya
- [ ] Tekan tombol kembali dengan coretan belum disimpan — muncul konfirmasi, bukan hilang diam-diam

### Temuan uji device pertama — 24 Agustus 2026

Boss Ali menjalankan seluruh rencana uji A–E di Xiaomi T15. **Semua test fungsional lulus**, termasuk yang paling menentukan: angka perkiraan PNG berbalik jadi lebih kecil dari JPG setelah filter Hitam-Putih diterapkan, yang membuktikan perkiraannya benar-benar diukur dari halamannya. Tiga masalah tampilan & performa dilaporkan, semuanya sudah ditutup sebelum lanjut ke potongan B.

**1. Lembar Ekspor tembus pandang, tulisannya tidak terbaca.** `--surface` sengaja hanya 5% putih di tema gelap — benar untuk kartu yang duduk di atas halaman, salah untuk lembar bawah yang backdrop-nya juga tembus pandang, sehingga dokumen di belakangnya terbaca menembus teks. Token baru `--surface-solid` diambil dari **warna gradien latar milik tema itu sendiri** (stop tengahnya), jadi tidak ada warna baru yang diperkenalkan — sesuai CLAUDE.md 9.2. Hanya `.sheet` yang diubah; kartu lain tetap tembus pandang karena memang disengaja.

**2. Ukuran tampilan dokumen tidak konsisten antara potret & lanskap.** `.editor-stage` dipaksa selebar 100% dengan rasio dari gambar dan **tanpa batas tinggi**, jadi halaman potret jadi lebih tinggi dari layar dan mendorong toolbar keluar jangkauan, sementara lanskap muat pas. Sekarang **lebarnya** yang dibatasi (`min(100%, 46vh × rasio)`), bukan tingginya — membatasi tinggi akan merusak rasio, dan overlay potong bekerja dalam koordinat 0..1 yang mempercayai kotak ini persis seukuran gambar. Mode potong dapat 58vh karena butuh presisi dan tidak berebut ruang dengan baris tombol. Diverifikasi di tiga bentuk halaman: potret A4, lanskap, dan halaman sangat tinggi — ketiganya kini setinggi sama dengan toolbar tetap terlihat.

**3. Editor terasa lambat di HP padahal lancar di localhost.** Diukur di Chromium pada halaman 3000×4200 (ukuran hasil scan HP flagship), lalu diperbaiki:

| | Sebelum | Sesudah |
|---|---|---|
| Filter Hemat Tinta | 1556 ms | **287 ms** |
| Perkiraan ukuran di lembar Ekspor | 2305 ms | **1168 ms** |
| Alokasi tabel filter Hitam-Putih | 92 MB | **17 MB** |
| Decode per pratinjau halaman | 2× | **1×** |

- **Hemat Tinta** memanggil `Math.pow` per piksel — 12 juta kali. Diganti tabel 256 entri, hasil piksel meleset paling banyak satu level (dijaga test tersendiri).
- **Hitam-Putih** mengalokasikan tabel `Float64Array` seukuran satu float per piksel: 92 MB sekali minta, sementara buffer piksel 46 MB sudah terbuka. HP akan tersendat mengumpulkan sampah atau menolak sama sekali. Tabelnya kini dibangun pada skala 1/4 untuk halaman besar — rata-rata lokal itu sinyal frekuensi rendah, jadi **nol piksel berubah** saat diukur. Halaman kecil tetap memakai tabel presisi penuh, jadi test perilaku di atasnya tetap menggambarkan hal yang sebenarnya.
- **Lembar Ekspor** men-decode halaman dua kali, sekali untuk angka JPEG dan sekali untuk PNG, padahal pikselnya identik. `compressImagePair()` sekarang meng-encode keduanya dari satu decode.
- **Pratinjau editor** men-decode tiap halaman dua kali: sekali untuk mengukur rasionya, sekali oleh `<img>`. Ukurannya kini dibaca dari `naturalWidth/naturalHeight` saat gambar selesai dimuat.

**Satu optimasi dicoba lalu dibatalkan.** Filter Magic Color juga sempat diberi tabel serupa. Pengukuran A/B pada data yang sama menunjukkan untungnya cuma 390→360 ms, dan **8,1 juta kanal piksel berubah** — sebab `Uint8ClampedArray` membulatkan saat menyimpan, jadi kanal masuk ke tahap saturasi sebagai bilangan bulat, bukan pecahan seperti semula. Tidak sepadan; dibatalkan, dan alasannya ditulis di kodenya supaya tidak dicoba ulang.

**Belum terjawab — butuh keputusan Boss Ali kalau HP masih terasa berat:** halaman disimpan pada resolusi penuh hasil scanner (12 MP). Menurunkannya akan mempercepat **semua** operasi sekaligus, tapi menurunkan pula batas atas mutu level ekspor "Maksimal". Lihat catatan di laporan sesi ini.

### Pratinjau Dokumen (layar penuh) — 24 Agustus 2026

Diminta Boss Ali setelah uji device: aplikasi scanner selalu punya cara melihat hasil pindai, dan yang ada di sini cuma petak kecil di layar detail yang tidak bisa diketuk. **Semua tier** — melihat dokumen sendiri itu kebutuhan dasar, bukan nilai jual (alasan yang sama dengan ubah nama & filter).

- [x] `PageViewerScreen` — layar penuh, geser antar halaman, cubit untuk memperbesar (1×–4×), ketuk dua kali untuk zoom ke titik yang disentuh, ketuk sekali untuk menyingkirkan bilah atas/bawah
- [x] Dibuka dari **tiga** tempat: tombol "Lihat" di layar detail, ketukan pada petak halaman mana pun di layar itu, dan ketukan pada halaman besar di layar Tinjau Hasil Pindai — yang terakhir penting karena di situlah user memutuskan sebuah pindaian layak disimpan atau tidak, dan teks buram tidak terlihat pada 46vh
- [x] Sumber halaman lewat `resolvePage()`, jadi yang tampil adalah halaman **setelah** crop/putar/filter — sama persis dengan yang diekspor dan yang dicadangkan
- [x] **Hanya 3 halaman yang ada di DOM** (`isPageMounted`): halaman yang dilihat plus dua tetangganya. Halaman hasil pindai itu JPEG 12 MP; dokumen 40 halaman dengan semuanya di DOM adalah gigabyte bitmap terdekode. Dengan ini biaya memori pratinjau tidak lagi ditentukan jumlah halaman dokumen
- [x] `PageImage` dapat `loading="lazy"` + `decoding="async"` — layar detail merender satu gambar per halaman, jadi dokumen 30 halaman sebelumnya mendekode 360 MP sebelum user sempat menggulir ke baris kedua
- [x] Seluruh gestur digerakkan sendiri lewat pointer event, bukan scroll-snap. Wadah gulir asli memang memberi momentum gratis, tapi ia juga **memiliki** sentuhannya — halaman yang diperbesar harus merebut kembali geseran satu jari darinya, dan keduanya berebut tiap gestur. Konsekuensi bagusnya: seluruh matematikanya (`lib/pageViewer.ts`) jadi fungsi murni yang bisa diuji di suite node — batas zoom, titik fokus cubit, batas geser, ambang & kecepatan geseran, rubber band di halaman pertama/terakhir
- [x] Latar tinta pekat `#080a12`, bukan gradien tema. Halaman pindai hampir selalu kertas putih: di atas latar terang tepinya lenyap. Nilainya diambil dari tinta yang sudah dipakai `.sheet-backdrop`, jadi **tidak ada warna baru** yang masuk ke palet (CLAUDE.md 9.2)
- [x] Test bertambah 50 (total 379 — 354 node + 25 browser)

**Tiga temuan code-review ditutup sebelum commit:**

- [x] **Tombol Ekspor di dalam pratinjau seolah tidak berfungsi.** `.viewer` semula `z-index: 40`, di atas lembar bawah (30) dan toast (20) yang justru dibuka **dari** dalamnya — lembarnya benar-benar terbuka, hanya tergambar di belakang latar tinta yang solid. Turun ke 15: tetap di atas bottom nav (10), yang memang tidak pernah tampil bersamaan dengannya
- [x] **Ketuk dua kali tidak bekerja saat halaman diperbesar.** `endPointer` keluar lebih awal untuk gestur `pan`, dan halaman yang diperbesar **selalu** memulai gestur `pan` — jadi cabang "zoom keluar" di `handleTap` tidak pernah tercapai. Kombinasi terburuknya: sembunyikan bilah lalu perbesar, dan tombol Tutup hilang tanpa cara mengembalikannya. Sekarang jari yang tidak berpindah dihitung sebagai ketukan, apa pun gestur asalnya
- [x] **Cubit sebelum gambar selesai dimuat malah menggeser halaman.** Kalau `measure()` gagal (belum ada kotak untuk diukur), fungsi keluar tanpa mengganti gestur — gestur geser satu jari tetap hidup dengan dua pointer terlacak, `dx` melompat antar jari, dan saat dilepas `swipeTarget` berpindah halaman padahal user cuma mencubit

**Satu bug ditemukan oleh test-nya sendiri, bukan oleh review:** tombol panah kiri/kanan di dalam panggung tidak pernah berfungsi. `setPointerCapture` di panggung mengalihkan `pointerup`, jadi `click` tidak pernah sampai ke tombolnya — dan tekanan itu malah terbaca sebagai ketukan yang menyembunyikan tombol yang baru saja ditekan. Sekarang gestur tidak dimulai kalau pointer mendarat di atas `<button>`; ada test regresinya.

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] Geser antar halaman terasa mengikuti jempol, bukan tersendat — termasuk pada dokumen 20+ halaman
- [ ] Cubit untuk memperbesar: titik yang dicubit tetap di bawah jari, tidak melayang
- [ ] Ketuk dua kali memperbesar ke titik yang disentuh; ketuk dua kali lagi kembali pas ke layar
- [ ] Halaman yang diperbesar tidak bisa digeser sampai memperlihatkan latar di balik tepinya
- [ ] Ketuk sekali menyembunyikan bilah, ketuk lagi memunculkannya — **dan tombol Tutup selalu bisa dikembalikan**
- [ ] Buka pratinjau dokumen 30+ halaman, geser cepat sampai halaman terakhir — HP tidak kehabisan memori dan tidak ada halaman kosong
- [ ] Tombol "Ekspor" di dalam pratinjau membuka lembar Ekspor yang bisa dipakai (bukti perbaikan z-index)
- [ ] Ketuk halaman besar di layar Tinjau Hasil Pindai — pratinjau terbuka pada halaman itu, dan geser di dalamnya ikut memindahkan halaman terpilih di layar tinjau

### Lingkungan test browser (23 Agustus 2026)

Dipasang atas keputusan Boss Ali sebelum masuk annotate + tanda tangan — potongan itu seluruhnya kanvas dan interaksi sentuh, persis jenis kode yang tidak bisa dijaga test Node.

- [x] Vitest dipecah jadi dua suite (`vitest.config.ts`): **node** untuk logika murni, **browser** untuk Chromium sungguhan lewat Playwright. `npm test` menjalankan keduanya; `npm run test:node` / `npm run test:browser` untuk satu saja
- [x] `imageEditor.browser.test.ts` — 10 test menjalankan `compressImage`/`rotateImage`/`cropImage` di browser asli: format dibuktikan dari **byte awal berkas** (`ff d8 ff` / `89 50 4e 47`), batas sisi terpanjang, tidak memperbesar gambar kecil, ukuran naik monoton per level, dan jebakan PNG-dari-JPEG
- [x] `FilterPicker.browser.test.tsx` — 4 test komponen React lewat `vitest-browser-react`. Ini yang menutup temuan "filter per-halaman bisa jalan dobel"
- [x] `activeChip()` dipindah dari JSX ke `filterChoice.ts` supaya temuan "chip Asli menghapus filter dokumen" punya test regresi di suite node (7 test baru)
- [x] **Test-nya dibuktikan menggigit, bukan cuma hijau.** Kode sengaja disabotase sementara: `mimeType` diabaikan → test PNG merah; batas piksel dihapus → test perkecilan merah; `isBusy` dilepas dari `FilterPicker` → 2 test komponen merah. Semua dikembalikan setelah itu
- [x] Test PNG-dari-JPEG diperkuat setelah ketahuan **lolos** saat `mimeType` disabotase (dua-duanya jadi JPEG, perbandingan ukurannya kebetulan tetap benar) — sekarang ikut memeriksa byte awal kedua berkas
- [x] CI menginstal Chromium (`npx playwright install --with-deps chromium`) sebelum `npm test`
- [x] Artefak kegagalan test browser (`__screenshots__/`, `.vitest-attachments/`) masuk `.gitignore`

Total test 308 → **329** (295 node + 14 browser).

**Catatan dependency:** `npm audit` melaporkan 2 kerentanan "high" (`brace-expansion`, `nanoid`). Keduanya **bukan** dari paket test yang baru dipasang — `brace-expansion` datang dari `@capacitor/cli` → rimraf → glob → minimatch, `nanoid` dari `vite` → postcss. Dua-duanya devDependency yang hanya jalan saat build dan tidak ikut ke dalam APK. Menutupnya berarti menaikkan Vite/Capacitor, jadi ditinggalkan sebagai keputusan tersendiri.

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] Geser slider di HP — takiknya terasa jelas dengan jempol, tidak meleset antar level
- [ ] Ekspor PNG dokumen **tanpa filter** — angkanya bisa puluhan MB (11× JPEG). Pastikan HP tidak kehabisan memori saat menulis & membagikannya
- [ ] Filter satu halaman: ketuk cepat dua chip berbeda — chip harus terkunci sejak ketukan pertama
- [ ] Dokumen berfilter Hitam-Putih dengan satu halaman dikecualikan: buka Filter di halaman itu dengan scope "Semua halaman" — chip yang menyala harus **Hitam-Putih**, bukan "Asli"
- [ ] Perkiraan ukuran muncul dalam waktu wajar untuk dokumen 15+ halaman, dan tidak membuat lembar Ekspor terasa macet saat slider digeser cepat
- [ ] Ekspor PNG dari akun **Basic** berhasil — tidak ada paywall yang menghadang
- [ ] Bandingkan ukuran berkas sungguhan dengan angka perkiraan; kalau melenceng jauh, `PDF_STRUCTURE_BYTES_PER_PAGE` perlu disetel ulang
- [ ] Akun Basic: slider terkunci di Standar & baris "Pro" membuka paywall
- [ ] Cadangkan dokumen setelah memilih level Maksimal — ukuran di layar Cadangan **tidak boleh** ikut membengkak (bukti cadangan tetap Standar)

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
