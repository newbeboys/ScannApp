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

- [x] Integrasi OCR (searchable PDF) — **Pro** (bersama DOCX; kontradiksi tier di dokumen ditutup Boss Ali 25 Agustus 2026 malam). Lihat bagian 8. DOCX-nya menyusul di D2
- [x] Annotate (coret/tulis di atas dokumen) — ~~**Pro**~~ **semua tier sejak 25 Agustus 2026**, lihat bagian 3 & bagian 6 di bawah
- [x] Tanda tangan digital — ~~**Pro**~~ **semua tier sejak 25 Agustus 2026**, lihat bagian 3 & bagian 6 di bawah
- [x] Reorder halaman — tombol geser kiri/kanan (bukan seret-lepas, lihat spec Bagian 2.6). **Semua tier**
- [x] Filter lanjutan — **5 filter** (Boss Ali menaikkan dari 2 di PRD Bagian 3): Magic Color, Cerah, Abu-abu, Hitam-Putih (ambang adaptif lokal), Hemat Tinta. Berlaku untuk seluruh dokumen, bisa dikecualikan per halaman. **Semua tier**
- [x] Export tambahan: **PNG** — **semua tier** (lihat catatan di bawah). DOCX belum: tanpa OCR isinya cuma gambar tertempel, jadi dipindah ke potongan yang sama dengan OCR
- [x] Kontrol level kompresi manual (slider kualitas vs ukuran) — **4 takik**, ~~tetap Pro~~ **semua tier sejak 25 Agustus 2026** (bagian 6)
- [x] Batch scan/export — C1 & C2 selesai (lihat bagian 4 & 5 di bawah). ~~Ekspor banyak dokumen Pro~~ → **semua tier sejak 25 Agustus 2026**, lihat bagian 6
- [x] Pisah dokumen yang **sudah tersimpan** (kebalikan merge) — di luar daftar asli, diminta Boss Ali 25 Agustus 2026, lihat bagian 6

**Diubah 23 Agustus 2026 (keputusan Boss Ali):** reorder halaman & filter dokumen semula Pro-exclusive, sekarang **tersedia untuk Basic maupun Pro** — bukan cuma akun Pro. Menggantikan baris di PRD Bagian 3 dan CLAUDE.md Bagian 6; lihat catatan di kedua file itu. ~~Annotate dan tanda tangan digital di daftar di atas tetap Pro-exclusive (belum dikerjakan).~~ — **dibatalkan 25 Agustus 2026**, keduanya ikut pindah ke semua tier (bagian 6).

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
- [x] **Slider kompresi manual — 4 takik** (~~Pro~~ **semua tier sejak 25 Agustus 2026**, bagian 6), bukan 0–100 bebas. Mata tidak membedakan q=0.72 dari q=0.75, jadi slider bebas menjanjikan presisi yang tidak ada dan memaksa encode ulang tiap geseran. Standar = 0.75/2400px, identik dengan nilai Basic yang lama
- [x] ~~Gerbang Pro ditegakkan di `resolveCompressionLevel()`, bukan cuma di UI — Basic yang meminta level apa pun tetap dapat Standar~~ — **dicabut 25 Agustus 2026** (bagian 6). Fungsinya tetap ada, tapi tugasnya sekarang cuma menjaga nilai rusak dari `localStorage`
- [x] Pilihan level diingat di `localStorage`; nilai rusak/hilang/storage terkunci semuanya jatuh ke Standar tanpa melempar error
- [x] **Perkiraan ukuran per format** di lembar Ekspor (`≈ 2,3 MB` / `≈ 17 MB`) — halaman pertama saja yang di-encode lalu dikali jumlah halaman, supaya menggeser slider di dokumen 30 halaman tidak makan waktu. Angka PNG yang jauh lebih besar jadi terlihat sendiri, tidak perlu kalimat peringatan
- [x] ~~Perkiraannya memakai tier yang sama dengan ekspor sungguhan, jadi Basic tidak pernah diperlihatkan ukuran yang tidak bisa ia dapatkan~~ — tier tidak lagi menyentuh perkiraan sejak 25 Agustus 2026; yang tetap berlaku: perkiraan melewati resolver yang sama dengan ekspor, jadi level asing jatuh ke Standar di kedua tempat
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

### Fase 6 bagian 3 — Anotasi & Tanda Tangan — 24 Agustus 2026

Potongan **B** dari empat sisa Fase 6. ~~Tetap **Pro-exclusive** — dua baris ini tidak ikut dipindahkan Boss Ali ke "semua tier" seperti reorder/filter/PNG.~~ — **dibatalkan 25 Agustus 2026**: keduanya menyusul ke semua tier, lihat bagian 6.

Desain: `docs/superpowers/specs/2026-08-24-fase6-annotate-tandatangan-design.md`

- [x] **Goresan disimpan sebagai data, bukan dibakar ke `edited`.** Halaman naik ke `schemaVersion: 4` dengan `marks` (vektor, koordinat 0..1) dan `annotated` (hasil render). Membakar tinta ke `edited` akan membuat filter Hitam-Putih ikut menghitamkan tanda tangan biru, dan mengganti filter berarti kehilangan seluruh anotasi
- [x] `resolvePage()` jadi `annotated ?? filtered ?? edited ?? original` — **ekspor, merge, cadangan cloud, dan pratinjau layar penuh tidak disentuh sama sekali**, persis seperti waktu filter ditambahkan
- [x] **Crop & putar memetakan ulang goresan**, tidak membuangnya (`remapMarksForCrop`, `remapMarksForRotation`). Koordinat normalisasi mengambang relatif terhadap isi halaman, jadi crop akan menggeser tinta terhadap kertasnya. Goresan yang seluruhnya jatuh di luar area crop dibuang; ketebalan ikut diskalakan supaya garis tidak menipis saat halaman diperbesar oleh crop
- [x] **Alat:** Pena, Stabilo (`multiply`, bukan alpha biasa — teks di bawahnya harus tetap hitam dan terbaca), Tanda tangan, Urungkan, Hapus semua. **Sengaja tidak masuk:** kotak teks & bentuk — teks butuh papan ketik melayang, ukuran huruf yang ikut skala halaman, dan pengeditan setelah dibuat; itu subsistem tersendiri
- [x] **4 warna tinta, semuanya sudah ada di kode**: `#1b2740` (`--fg` terang), `#2563eb` (primary), `#e5484d` (danger), `#f5c443` (`--pro-gold`). Tidak ada warna baru (CLAUDE.md 9.2), dan ada test yang menjaganya
- [x] **Tanda tangan digambar di kotak selebar layar**, bukan langsung di halaman. Menandatangani di kotak kecil di sudut halaman menghasilkan coretan besar dan gemetar; hasilnya dipangkas ke kotak tinta-nya sendiri (`trimToInk`) supaya stempelnya bukan sebagian besar ruang kosong
- [x] Berkas tanda tangan bernama `signature-<cap waktu>.png`, bukan nama tetap: menggambar ulang tidak boleh diam-diam mengganti tanda tangan di dokumen yang **sudah** ditandatangani, termasuk yang sudah dicadangkan
- [x] ~~**Gerbang Pro ditegakkan di library** (`setPageMarks`)~~ — **dicabut 25 Agustus 2026** (bagian 6). Waktu masih ada, ia ditegakkan di library, bukan cuma menyembunyikan tombol — pelajaran yang sama dengan `resolveCompressionLevel`
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
- [x] ~~Akun **Basic**: tombol "Anotasi & Tanda Tangan" berlencana Pro dan membuka paywall~~ — **tidak berlaku lagi** sejak 25 Agustus 2026, anotasi & tanda tangan jadi semua tier (bagian 6)
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
- [x] ~~Akun Basic: slider terkunci di Standar & baris "Pro" membuka paywall~~ — **tidak berlaku lagi** sejak 25 Agustus 2026. Yang perlu diuji sekarang: slidernya bisa digeser penuh oleh Basic dan **tidak ada** baris "Pro" di bawahnya
- [ ] Cadangkan dokumen setelah memilih level Maksimal — ukuran di layar Cadangan **tidak boleh** ikut membengkak (bukti cadangan tetap Standar)

### Fase 6 bagian 4 — Mode Pilih & Batch Export (C1) — 25 Agustus 2026

Potongan **C** dari empat sisa Fase 6 (yang pertama dari dua: **C1** mode pilih + batch export atas dokumen yang sudah ada, **C2** pisah satu sesi pindai jadi banyak dokumen — menyusul).

Desain: `docs/superpowers/specs/2026-08-25-fase6-batch-scan-export-design.md`

- [x] **Mode pilih di tab Dokumen** — tekan lama sebuah dokumen untuk masuk, atau tombol "Pilih" di header untuk masuk tanpa mencentang apa pun. Baris cloud tidak bisa dipilih (belum ada berkasnya di HP) dan menampilkan toast alih-alih diam saja
- [x] **Tekan lama + penelan klik.** `click` asli yang menyusul tekan lama dari jari yang sama ditelan (`swallowClick`), supaya memilih dokumen tidak sekaligus membukanya. Jari yang bergeser lebih dari `LONG_PRESS_MOVE_PX` membatalkan tekanan (dianggap menggulir, bukan menahan)
- [x] **Ekspor banyak dokumen sebagai PDF** — ~~Pro~~ **semua tier sejak 25 Agustus 2026** (bagian 6). Satu dokumen jadi satu berkas PDF, berurutan (bukan paralel — lihat catatan memori di potongan sebelumnya soal beban RAM), lembar berbagi terbuka sekali di akhir dengan apa pun yang berhasil ditulis
- [x] **Hapus banyak dokumen — semua tier.** Tidak ada gerbang tier: merapikan dokumen sendiri bukan sesuatu yang harus dibeli
- [x] **Tabrakan nama berkas** dalam satu batch ditangani lebih dulu (`uniqueExportNames`) — dokumen kedua berjudul sama persis jadi `… (2)`, tidak menimpa yang pertama
- [x] ~~**Gerbang Pro ditegakkan di `exportDocumentsBatch()` (library)**~~ — **dicabut 25 Agustus 2026** (bagian 6). Waktu masih ada, ia ditegakkan di library, bukan cuma di bilah aksi — pelajaran yang sama dengan `resolveCompressionLevel` dan `setPageMarks`. Diverifikasi ulang setelah pemasangan: akun Basic yang menekan "Ekspor PDF" di bilah aksi diarahkan ke `onUpgrade()` dan tidak pernah memanggil `onBatchExport()`, dan `exportDocumentsBatch()` sendiri melempar kalau tetap dipanggil untuk Basic
- [x] **Tombol Hentikan** di tengah batch — berhenti setelah dokumen yang sedang berjalan selesai (tidak pernah di tengah penulisan satu PDF), toast melaporkan berapa yang sempat tersimpan
- [x] **Kegagalan sebagian tidak menggagalkan semuanya.** Satu dokumen yang gagal diekspor/dihapus dihitung lewat selisih, sisanya tetap jalan. Seleksi **dipertahankan** kalau ekspor berhenti atau ada yang gagal (supaya sisanya bisa dicoba lagi tanpa mencentang ulang dari nol), dan **dikosongkan** hanya kalau semuanya berhasil tanpa dihentikan
- [x] `pruneUnusedSignatures()` dipanggil **sekali** di akhir hapus massal, bukan per dokumen — sama seperti alasannya di potongan anotasi: tanda tangan dipakai lintas dokumen, menyapunya di tengah loop bisa menghapus berkas yang masih dirujuk dokumen yang belum sempat dihapus
- [x] Mode pilih otomatis keluar kalau tab Dokumen ditinggalkan — bilah aksi yang masih menggantung di tab lain adalah keadaan yang tidak bisa dijelaskan
- [x] Test bertambah 12 (total 508 → **520** — 466 node + 54 browser), termasuk `DocumentsScreen.browser.test.tsx` di **Chromium sungguhan**: tekan lama masuk mode pilih, klik yang menyusulnya ditelan, tap biasa tetap membuka dokumen, baris cloud melapor lewat toast, bilah aksi menghitung dengan benar, Basic diarahkan ke paywall bukan mengekspor, Basic tetap bisa menghapus, Batal keluar dari mode pilih, timer tekan lama tidak menembak `onEnterSelect` kalau layarnya sudah dilepas duluan (temuan review 25 Agustus, lihat laporan)
- [x] **Test-nya dibuktikan menggigit:** blok penelan klik dilepas → test "swallows the click" merah; gerbang Pro di bilah aksi diganti pemanggilan langsung → test "sends Basic to the paywall" merah; cabang `isSelectable` di pewaktu tekan lama dihapus → test baris cloud merah. Semua dikembalikan setelah itu

**Catatan token & lencana tier:**

- [x] Baris tier di header tab Dokumen tadinya **dipatok** ke teks "Basic" apa pun tier akunnya — sudah tersentuh karena `tier` baru masuk sebagai prop di potongan ini, jadi diperbaiki sekalian: sekarang mengikuti `tier` sungguhan (Pro/Basic)
- [x] Token CSS di rencana kerja awal ternyata tidak semuanya ada di `App.css` (`--primary`, `--border`, `--bottom-nav-height`, `.button--ghost`) — dipetakan ke token yang sudah ada (`--acc`, `--chip-border`, `--nav-height`, `.link-button`). `.button--danger` baru ditambahkan, memakai warna `#e5484d` yang sudah dipakai `.icon-button--danger` — tidak ada warna atau token baru (CLAUDE.md 9.2)

**Dua temuan review ditutup sebelum lanjut (25 Agustus 2026, rinciannya di laporan sesi):**

- [x] **Timer tekan lama bisa menembak setelah layar dilepas.** `DocumentsScreen` tidak membersihkan `pressTimer` saat unmount — pindah tab di tengah tekan lama membiarkan `setTimeout` tetap berbunyi dan memanggil `onEnterSelect`/`onNotice` **setelah** `App.tsx` sudah menutup mode pilih lewat efek pindah tab, diam-diam membukanya lagi. Ditambahkan `useEffect` pembersih yang membatalkan timer saat unmount, dengan test regresi baru
- [x] **`handleBatchDelete` bisa macet permanen kalau `pruneUnusedSignatures()`/`refreshDocuments()` gagal.** Keduanya berjalan tanpa penangkap di blok `finally`, jadi kalau salah satunya melempar, `setIsBatchBusy(false)` dan `exitSelect()` (baris setelahnya, di blok yang sama) tidak pernah tereksekusi — tombol bilah aksi tetap `disabled` selamanya walau dokumennya sudah terhapus. Sekarang dibungkus try/catch sendiri di dalam `finally`, supaya kedua reset state itu tidak bersyarat pada berhasilnya langkah pembersihan

**Terverifikasi di device fisik — Boss Ali, 25 Agustus 2026.** Seluruh daftar uji di bawah dijalankan di HP dan hasilnya sesuai:

- [x] Tekan lama sebuah dokumen — masuk mode pilih, dan dokumennya tidak ikut terbuka
- [x] Tekan lama baris dokumen cloud — muncul toast, bukan diam saja
- [x] Pilih 3 dokumen → Ekspor PDF → 3 berkas di folder Documents, nama sesuai judulnya
- [x] Dua dokumen berjudul sama persis → berkas kedua jadi `… (2)`, tidak menimpa yang pertama
- [x] Ekspor 10+ dokumen — share sheet Android sanggup atau tidak
- [x] Tekan Hentikan di tengah — berhenti setelah dokumen yang sedang jalan, jumlahnya sesuai toast
- [x] Hapus 3 dokumen sekaligus — konfirmasi muncul, cadangan cloud tetap ada
- [x] Akun Basic: tombol Ekspor berlencana Pro dan membuka paywall; Hapus tetap bisa dipakai

### Fase 6 bagian 5 — Pisah Hasil Pindai (C2) — 25 Agustus 2026

Potongan **C** yang kedua, penutup potongan C. Satu sesi pindai (mis. 30 kwitansi sekali jalan) bisa dipecah jadi beberapa dokumen tanpa memindai ulang.

Desain: `docs/superpowers/specs/2026-08-25-fase6-batch-scan-export-design.md` Bagian 4
Rencana kerja: `docs/superpowers/plans/2026-08-25-fase6-c2-pisah-hasil-pindai.md`

- [x] **Satu himpunan angka jadi sumber kebenarannya.** Seluruh keadaan layar Pisah adalah himpunan posisi gunting; `planSplit()` di `src/lib/scanSplit.ts` menerjemahkannya jadi kelompok halaman dan layar hanya menggambar hasilnya. Gunting kembar, gunting di posisi 0, dan gunting di luar jangkauan dibuang — bukan kehati-hatian berlebih, karena simpan yang gagal sebagian memang membuat daftar halaman menyusut di bawah gunting yang sudah terpasang
- [x] **Layar tersendiri, bukan penanda di strip thumbnail layar Tinjau.** Strip itu horizontal dan sudah penuh untuk lima halaman; tiga puluh halaman dengan pemisah di antaranya jadi lorong panjang yang harus digeser jauh cuma untuk melihat sudah terbagi berapa
- [x] **Pola siap pakai + gunting manual, bukan dua mode terpisah.** "Tiap 1 halaman" (setumpuk kwitansi/KTP — kasus utamanya), "Tiap 2 halaman" (bolak-balik), "Bersihkan pemisah". Pola cuma mengisi guntingnya; setelah itu tiap pemisah tetap bisa diketuk satu-satu. Pemisahnya tombol setinggi jempol, bukan garis rambut
- [x] **Satu kolom Nama untuk seluruh batch** → `Nama (1)`, `Nama (2)`, … Dikosongkan pun aman: jatuh ke nama bawaan `Scan <tanggal>` seperti menyimpan biasa. Tanpa kolom ini, memindai tiga puluh kwitansi berarti tiga puluh dokumen yang identik kecuali detiknya, lalu tiga puluh kali ubah nama
- [x] ~~**Gerbang Pro ditegakkan di `saveSplitScan()` (library), dan syaratnya "lebih dari satu dokumen butuh Pro"**~~ — **dicabut 25 Agustus 2026** (bagian 6). Waktu masih ada, syaratnya — bukan "fitur ini Pro". Memisah jadi 1 dokumen identik dengan tombol Simpan di sebelahnya yang sudah gratis untuk semua tier; menolaknya berarti menolak sesuatu yang sudah gratis lewat pintu sebelah. Akun Basic yang menekan tombolnya dapat paywall, bukan layar mati
- [x] **Kalau menyimpan gagal di tengah, halamannya tidak hilang.** Kelompok yang berhasil pergi, kelompok yang gagal tetap tinggal di layar dengan guntingnya disusun ulang (`boundaryCuts()`), dan toast-nya berkata berapa yang tersimpan. Membatalkan semuanya akan membuang dokumen yang sudah aman; menutup layarnya akan membawa kelompok sisanya ikut hilang bersama sesi pindainya — dan hasil pindai yang hilang tidak bisa dipulihkan dari mana pun. Menekan Simpan lagi tidak menghasilkan duplikat karena yang berhasil sudah tidak ada di layar
- [x] **Penomoran lanjut setelah gagal sebagian** (`Kwitansi (6)`, bukan `Kwitansi (1)` lagi) — supaya percobaan kedua tidak menabrak judul yang sudah tersimpan di ronde pertama
- [x] **Interstitial `scan-saved` dipanggil sekali untuk seluruh sesi pisah**, bukan per dokumen. Praktisnya tidak pernah tampil (ini Pro-only), tapi kalau ditulis per dokumen, langganan yang habis di kemudian hari akan meledakkan delapan interstitial beruntun
- [x] **Gotcha di `App.tsx` yang ditemukan saat menyambungkan:** blok `if (pendingPages)` mengembalikan layar Tinjau **sebelum** `if (view.kind === 'upgrade')` sempat dibaca, jadi paywall dari tombol Pisah tidak akan tampil sama sekali dan tombolnya terlihat mati untuk akun Basic. Blok paywall dipindahkan ke atas blok `pendingPages`; menutupnya mengembalikan user ke layar Tinjau karena `pendingPages` tidak disentuh
- [x] Test bertambah 55 (total 520 → **575** — 505 node + 70 browser), termasuk `SplitScanScreen.browser.test.tsx` (12) dan `ReviewScreen.browser.test.tsx` (4) di **Chromium sungguhan**
- [x] **Test-nya dibuktikan menggigit:** gerbang Pro dipatok ke 2 → test pengecualian 1 kelompok merah; `remaining.push` diganti `throw` → dua test kegagalan sebagian merah; filter jangkauan gunting dilepas → test gunting di luar jangkauan merah; `onSave` diganti mengirim seluruh halaman sebagai satu kelompok → test kelompok merah; `disabled={isBusy}` dilepas → test tombol terkunci merah; `startAt` dilepas dari `splitTitles` di layar → test penomoran lanjutan merah. Semua dikembalikan setelah itu

**Tiga temuan review ditutup sebelum lanjut (25 Agustus 2026):**

- [x] **Penomoran lanjutan hilang saat masuk ulang ke layar Pisah.** `handleStartSplit` mereset `splitSaved` dan `splitName` tiap kali layar dibuka, termasuk saat sesi yang sama masih hidup: 3 dokumen tersimpan, 2 gagal → tekan Kembali → tekan Pisah lagi → percobaan kedua menyimpan `Kwitansi (1)` yang menabrak judul ronde pertama, dan nama yang sudah diketik ikut hilang. Sekarang gunting bawaan hanya dipasang kalau sesi ini belum punya gunting sendiri; `exitSplit()` tetap membersihkan semuanya di titik yang memang akhir sesi (pindai baru, simpan biasa, batal dari layar Tinjau)
- [x] **Pratinjau nama di layar Pisah berbohong setelah gagal sebagian.** Header memanggil `splitTitles` tanpa `startAt`, jadi tertulis "Dokumen 1 — Kwitansi (1)" padahal yang benar-benar disimpan "Kwitansi (4)". `startAt` kini prop, dan nomor "Dokumen N" ikut dihitung dari situ supaya dua bagian barisnya tidak bisa berbeda
- [x] **Judul hasil pisah tidak lewat `normalizeDocumentTitle`** (ditemukan saat security review). Kolom Nama adalah tempat pertama judul ketikan user masuk ke `saveScanDocument`, dan fungsi itu menyimpan apa adanya — tidak seperti `renameScanDocument`. Nama berspasi ganda atau lebih dari 200 karakter jadi tersimpan beda antara HP dan cloud begitu dicadangkan, persis hal yang normalizer bersama itu ada untuk mencegah. `splitTitles` kini memakai normalizer yang sama, dengan sisa ruang untuk ` (n)` supaya nomornya tidak ikut terpotong

**Security review: nihil temuan.** Judul tidak pernah jadi path berkas (berkas halaman memakai id dokumen, nama ekspor lewat `toSafeFilename`), tidak ada `dangerouslySetInnerHTML`, dan C2 tidak menyentuh Supabase, R2, maupun signed URL.

**Belum diverifikasi di device fisik** (butuh Boss Ali — walkthrough browser belum dijalankan lagi sesi ini karena app tetap mensyaratkan login Supabase dan tidak ada akun uji/dev bypass; kebenarannya sejauh ini dari 575 test otomatis, termasuk 16 test layar di Chromium sungguhan):

- [ ] Pindai 10 kwitansi sekali jalan → "Tiap 1 halaman" → 10 dokumen, urutannya benar
- [ ] Isi kolom Nama → semua dokumen bernama `Nama (1..10)`
- [ ] Kosongkan Nama → jatuh ke nama bawaan, tidak error
- [ ] Atur gunting sendiri di dokumen 30 halaman — layarnya masih enak digulir, thumbnail tidak membuat HP tersendat
- [x] ~~Akun Basic: tombol Pisah berlencana Pro dan membuka paywall…~~ — **tidak berlaku lagi** sejak 25 Agustus 2026, Pisah jadi semua tier (bagian 6). Yang perlu diuji sekarang: tombolnya **tanpa** lencana dan langsung membuka layar Pisah
- [ ] Simpan hasil pisah, lalu langsung batch-export semuanya — nama berkasnya tidak bertabrakan (pertemuan C1 & C2)

### Fase 6 bagian 6 — Temuan Uji Device Kedua & Pembukaan Gerbang Pro — 25 Agustus 2026

Boss Ali menguji C1 & C2 di Xiaomi T15 dan melaporkan lima hal sekaligus, empat di antaranya bug tampilan/performa dan satu permintaan fitur. Di penutup laporannya ia juga **mencabut gerbang Pro** untuk semua fitur yang disebut di situ.

**Keputusan tier (mengganti PRD Bagian 3 & CLAUDE.md Bagian 6):** anotasi, tanda tangan digital, pisah dokumen, dan ekspor banyak dokumen sekaligus jadi **semua tier**. Ini pembatalan ketiga dengan pola yang sama seperti dua sebelumnya (reorder/filter, lalu PNG): **yang mendasar untuk semua, Pro untuk kendali & mutu**. Yang tetap Pro dari Fase 6: kontrol level kompresi manual, ekspor DOCX, bebas iklan, tanpa watermark, merge tanpa batas halaman, kuota storage lebih besar.

- [x] **Gerbangnya dilepas dari library, bukan cuma dari UI** — `canBatchExport()` dan `canSplitScan()` dihapus seluruhnya (bukan diubah jadi `return true`, yang cuma menyisakan abstraksi bohong), parameter `tier` ikut hilang dari `saveSplitScan()` dan `setPageMarks()` karena tidak ada lagi yang membacanya. Lencana "Pro" dan cabang `onUpgrade()` hilang dari layar Dokumen, Tinjau, dan Editor
- [x] **Test gerbang tidak dihapus, dibalik** — tier yang dulu ditolak sekarang diuji berhasil (`exports for Basic too`, `splits into several documents for Basic too`, `lets Basic export in bulk`). Menghapusnya akan membuat regresi ke perilaku lama lewat tanpa suara
- [x] **Konsekuensi yang ikut ketahuan:** baris terkunci "Atur sendiri kualitas & ukuran berkas" di lembar Ekspor Banyak Dokumen dulu cuma **menutup lembarnya**, dengan alasan tertulis bahwa tombol yang membukanya Pro-only sehingga akun Basic tidak akan pernah sampai ke sana. Alasan itu mati bersama gerbangnya. Sekarang ia membuka paywall seperti di lembar satu dokumen — kontrol kualitasnya sendiri **tetap Pro**

**Susulan beberapa jam kemudian — kontrol level kompresi & DOCX ikut dibuka.** Boss Ali menutup laporan berikutnya dengan meminta dua sisa Pro dari daftar di atas ikut dibuka.

- [x] `canChooseCompression()` dihapus; `resolveCompressionLevel()` **tidak lagi menerima `tier`**. Fungsinya tidak ikut dihapus karena separuh tugasnya tidak pernah soal tier: level datang dari `localStorage`, jadi bisa berupa nilai yang build ini tidak kenal, dan tanpa penjagaan itu ia sampai ke `COMPRESSION_PRESETS` sebagai `undefined` lalu meng-encode di `quality: undefined`
- [x] `BASIC_COMPRESSION` diganti nama jadi `STANDARD_COMPRESSION` — "yang selalu didapat Basic" sudah tidak berarti apa-apa, dan nama yang berkata sebaliknya adalah komentar yang berbohong di tiap berkas yang memakainya. Dua pemakainya tetap: cadangan cloud (`buildPdfFile`, sengaja dipaku ke Standar) dan bawaan `compressImage`
- [x] `estimateExportSizes()` kehilangan parameter `tier`-nya — dulu ada semata karena tier bisa mengubah level yang diminta jadi level lain
- [x] Baris terkunci "Atur sendiri kualitas & ukuran berkas" **hilang seluruhnya**, bersama prop `tier`/`onUpgrade` di `CompressionField` yang cuma ada untuk menggambarnya, prop `onUpgrade` di kedua lembar ekspor, dan CSS `.export-quality__lock`. Termasuk `onUpgrade` yang baru saja ditambahkan beberapa jam sebelumnya di lembar Ekspor Banyak — umurnya satu commit
- [x] **DOCX belum ada kodenya sama sekali** (`ExportFormat` masih `'pdf' | 'jpg' | 'png'`), jadi tidak ada gerbang untuk dicabut. Keputusannya dicatat untuk nanti: saat DOCX dibuat bersama OCR, langsung semua tier
- [x] **Yang masih dijual Pro setelah ini:** bebas iklan, tanpa watermark, merge tanpa batas halaman, kuota storage, dan nanti OCR. Itu persis empat baris yang sudah ditampilkan `UpgradeScreen`, jadi paywall-nya **tidak perlu diubah** — ia memang tidak pernah menjual kontrol kualitas. Satu-satunya tempat tier masih menyentuh jalur ekspor: `shouldWatermark()`
- [x] **Cadangan cloud tidak ikut terpengaruh.** `buildPdfFile()` tetap dipaku ke Standar, jadi Basic yang memilih Maksimal tidak diam-diam menghabiskan kuota R2-nya lebih cepat — keputusan Boss Ali 23 Agustus 2026 masih berlaku dan justru jadi lebih penting sekarang

**1. Layar di belakang popup masih bisa digulir.** Backdrop `position: fixed` menutupi layar tapi tidak memiliki gestur di atasnya: jari yang menggeser di atasnya tetap menggulir wadah gulir terdekat, jadi daftar dokumen ikut bergeser di belakang lembar Ekspor yang sedang jalan.

- [x] `useScrollLock()` — hook yang memasang kelas di `document.body` selama komponennya hidup, dipakai oleh **ketiga** lembar (`ExportSheet`, `BatchExportSheet`, `SignaturePad`), jadi ini bukan tambalan satu layar
- [x] **Dihitung, bukan bendera** — lembar bisa bertumpuk (papan tanda tangan terbuka di atas alat anotasi), dan bendera akan melepas kunci begitu yang dalam ditutup padahal yang luar masih menutupi layar. Ada test regresinya di Chromium sungguhan
- [x] CSS menyebut **kedua** wadah gulirnya: `.app__body` di layar tab, dan viewport itu sendiri di layar alur penuh yang menggulir `body`
- [x] `.sheet` dapat `max-height: 88vh; overflow-y: auto` — begitu halaman di belakangnya dibekukan, lembarnya sendiri harus bisa mencapai tombolnya di layar pendek

**2. Tidak ada tombol "Semua" di mode pilih.** Memilih sepuluh dokumen berarti sepuluh ketukan.

- [x] Satu tombol yang labelnya mengikuti keadaan — **Semua** → **Kosongkan** — bukan dua tombol dengan salah satunya selalu mati. Logikanya di `documentSelection.ts` (`selectableIds`, `isAllSelected`, `toggleSelectAll`), jadi bisa diuji tanpa DOM
- [x] Baris cloud **tidak** ikut dihitung: ia tidak punya berkas halaman di HP ini, jadi tidak akan pernah bisa dicentang. Menghitungnya akan membuat "Semua" mengaku masih ada yang tersisa padahal semua yang bisa dicentang sudah tercentang

**3. Dokumen terakhir terpotong bilah Ekspor/Hapus.** Bilahnya `position: fixed`, jadi ia menutupi ujung daftar alih-alih mendorongnya naik.

- [x] `.screen--select-bar` menyisakan tinggi bilah (`--select-bar-height`) selama bilah itu tampil. Kondisinya (`showSelectBar`) dipakai bersama oleh padding dan bilahnya sendiri, supaya keduanya tidak bisa berbeda pendapat

**4. Tombol "Hentikan" putih tidak terbaca** (terlihat di tangkapan layar Boss Ali). Ditemukan saat menelusuri laporan pertama, bukan dilaporkan terpisah.

- [x] `.button` polos ternyata tidak pernah menetapkan latar & warna sama sekali — yang selama ini menyelamatkannya adalah `.editor-actions .button`, `.viewer__actions .button`, dan `.split-entry`. Tombol "Hentikan" di lembar Ekspor Banyak Dokumen tidak duduk di salah satunya, jadi ia jatuh ke tombol bawaan browser: kotak putih dengan teks gelap di atas tema gelap. Latar & warna dasar kini ada di `.button` sendiri; varian `--primary`/`--danger`/`--upgrade` menetapkan miliknya sendiri jadi tidak ada yang berubah di sana

**5. Tidak ada cara memisah dokumen yang sudah tersimpan.** Merge sepuluh dokumen jadi satu tidak punya kebalikan — merge yang salah cuma bisa dibatalkan dengan memindai ulang semuanya.

- [x] **`splitDocument()` di `documentSplit.ts`**, memakai kembali seluruh geometri gunting milik `scanSplit` (`planSplit`, `toggleCut`, `everyNCuts`, `splitTitles`). Yang berbeda cuma dari mana halamannya datang dan apa yang terjadi pada asalnya
- [x] **Halaman disalin lewat `resolvePage()`**, persis seperti merge — jadi tiap dokumen baru membawa halaman yang dilihat user (sudah dipotong, difilter, dianotasi), bukan hasil pindai mentah di bawahnya
- [x] **Hasil pisah tidak ditandai sebagai gabungan.** `createDocumentFromPages` dulu selalu menulis `sourceDocumentIds`; array kosong itu *truthy*, jadi layar detail akan menulis "Hasil gabungan dari 0 dokumen". Parameternya kini opsional dan hanya ditulis kalau berisi
- [x] **Dokumen asli tidak dihapus kecuali dicentang**, dan **tidak pernah** dihapus kalau ada kelompok yang gagal dibuat — halaman kelompok itu belum ada di tempat lain, jadi menghapus asalnya berarti menghilangkannya. Centangnya juga selalu mulai dari mati tiap kali layar dibuka
- [x] **Cadangan cloud yang selamat ikut dikatakan** — sama seperti `handleDelete`, kalau tidak, dokumen asli terlihat "hidup lagi" sebagai baris Di cloud beberapa saat kemudian
- [x] **Gagal sebagian tidak menyuruh "coba lagi"** seperti pisah hasil pindai. Di sana kelompok yang berhasil pergi dari layar; di sini dokumen asalnya masih memegang semua halaman, jadi menekan Pisah lagi akan menduplikasi kelompok yang sudah jadi. Pesannya menyuruh membereskan hasil yang sudah jadi dulu
- [x] `SplitScanScreen` dipakai bersama kedua alur (`raw`, `heading`, `saveLabel`, `busyLabel`, `options`) dan `onSave` kini menyerahkan **indeks halaman**, bukan halamannya — supaya layar itu tidak perlu tahu ia sedang memegang URI pemindai atau path tersimpan
- [x] Ikon `SplitIcon` baru, cerminan `MergeIcon` di grid stroke yang sama, supaya keduanya terbaca sebagai lawan saat berdampingan

**6. Ekspor 10 dokumen sangat lama & simpan anotasi sangat lambat.**

- [x] **Izin storage diminta sekali per sesi, bukan sekali per berkas.** `writeExportFiles()` memanggil `checkPermissions()` + kadang `requestPermissions()` untuk **tiap** dokumen — batch 10 dokumen menjalankan pasangan itu sepuluh kali, dua-duanya menyeberangi jembatan Capacitor dan yang kedua bisa memunculkan dialog sistem. Ini kandidat terkuat penyebab "seperti menggantung"
- [x] **Halaman diperkecil saat di-decode, bukan setelahnya.** Ukuran piksel dibaca dari header JPEG (`jpegSize.ts`, ~60 baris, diuji di suite node dengan berkas yang dirakit byte demi byte), lalu `createImageBitmap` diminta mengecilkan sekalian — bukan men-decode 12 MP utuh lalu membuang tiga perempatnya di kanvas sesaat kemudian. Ekspor membayar decode penuh itu sekali per halaman, dan batch 10 dokumen membayarnya sepuluh kali
- [x] **Hanya satu dimensi yang diminta, rasio diserahkan ke browser.** Meminta keduanya akan **merusak bentuk** halaman ber-tag rotasi EXIF: `imageOrientation: 'from-image'` menukar sumbunya sementara ukuran dari header tidak, jadi keduanya jadi berbeda pendapat soal mana yang lebar. Dengan satu dimensi, hal terburuk yang bisa dilakukan rotasi adalah membatasi sisi pendek — hasilnya tetap lebih kecil dari aslinya, tetap berbentuk benar, dan `scaledCanvas` menyelesaikan sisanya
- [x] **Mutu berkas turunan 0,95 → 0,90.** Berkas hasil filter & hasil tinta harus di-base64, diseberangkan lewat jembatan, ditulis Java, lalu dibaca & di-decode lagi untuk ditampilkan — ukurannya dibayar empat kali di HP. **Diukur di Chromium** pada halaman mirip-pindaian 3000×4200: **5,76 MB pada 0,95 → 3,96 MB pada 0,90, yaitu 31% lebih sedikit byte** untuk selisih yang tidak selamat sampai kertas. Ini angka teknis (CLAUDE.md Bagian 6), bukan angka bisnis — kalau di HP ternyata terlihat, boleh dinaikkan lagi
- [x] **Test membuktikan jalur cepatnya benar-benar dipakai**, bukan cuma bahwa hasilnya benar — keluarannya identik dengan atau tanpa optimasi, jadi test kebenaran saja tidak akan menyadari jalur cepat itu hilang

**Test: total 575 → 610 (531 node + 79 browser),** semuanya lulus (`npm test`). Angka bersihnya menutupi lebih banyak test baru dari yang terlihat: sepuluh test gerbang tier dihapus atau **dibalik** seiring gerbangnya dilepas.

**Test-nya dibuktikan menggigit:** hitungan `useScrollLock` diganti bendera → test lembar bertumpuk merah; syarat `remaining.length === 0` dilepas dari penghapusan dokumen asli → test "kelompok gagal" merah; cabang orientasi `resizeWidth`/`resizeHeight` ditukar → test jalur cepat merah (dan test ukuran **tetap hijau**, yang justru membuktikan jaring pengaman `scaledCanvas` bekerja). Semua dikembalikan setelah itu.

**Security review: nihil temuan.** Tidak menyentuh Supabase, R2, maupun signed URL. Dua permukaan baru diperiksa: `readJpegSize()` mengurai byte yang tidak dipercaya — semua akses indeks berpagar, dan `at += length` dengan `length >= 2` dijamin selalu maju sehingga tidak bisa berputar selamanya; `splitDocument()` menghapus dokumen lewat id dari index kita sendiri (UUID buatan sendiri), dan `deleteScanDocument` memastikan id-nya ada di index sebelum `rmdir` — tidak ada path yang berasal dari ketikan user.

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] Buka lembar Ekspor / Ekspor Banyak / Tanda Tangan → coba gulir layar di belakangnya: **tidak boleh bergerak sama sekali**
- [ ] Lembar Ekspor di layar pendek — tombol formatnya masih bisa dicapai (lembarnya sendiri yang bergulir)
- [ ] Tombol "Hentikan" saat batch berjalan sekarang terbaca (bukan kotak putih)
- [ ] Mode pilih → **Semua** mencentang semua dokumen HP, baris "Di cloud" tetap tidak tercentang; tombolnya berubah jadi **Kosongkan**
- [ ] Gulir ke bawah dengan bilah Ekspor/Hapus tampil — dokumen terakhir **utuh**, tidak terpotong
- [ ] Ekspor 10 dokumen lagi — **berapa detik sekarang** dibanding sebelumnya? (angka sebelum/sesudah dari HP yang sama)
- [ ] Simpan anotasi di halaman 12 MP — **berapa detik sekarang** dibanding sebelumnya?
- [ ] Hasil anotasi & filter pada mutu 0,90 masih tajam saat dicetak/di-zoom — kalau tidak, angkanya boleh dinaikkan lagi
- [ ] Gabung 10 dokumen → buka detailnya → **Pisah jadi Beberapa Dokumen** → "Tiap 1 halaman" → 10 dokumen kembali, isinya benar & urutannya benar
- [ ] Pisah **tanpa** mencentang hapus asli — dokumen asli masih ada
- [ ] Pisah **dengan** mencentang hapus asli — dokumen asli hilang dari HP; kalau ia punya cadangan, toast-nya menyebut cadangan cloud tetap ada
- [ ] Pisah dokumen yang halamannya sudah difilter/dipotong/dianotasi — hasilnya membawa halaman yang **terlihat**, bukan pindaian mentah
- [ ] Akun **Basic**: tombol Anotasi & Tanda Tangan, Pisah, dan Ekspor PDF banyak dokumen **tanpa lencana Pro** dan langsung bisa dipakai

### Fase 6 bagian 7 — Temuan Uji Device Ketiga — 25 Agustus 2026

Boss Ali menguji lagi di Xiaomi T15 dan melaporkan dua hal. Yang pertama **tidak bisa diperbaiki dari kode kita** dan butuh keputusannya; yang kedua ternyata bukan bug tampilan seperti dugaannya, tapi tetap ada yang salah dan sudah diperbaiki.

**1. Pemindai selalu terbuka di "Ambil otomatis", diminta bawaannya "Manual".** Auto-capture menjepret sebelum dokumen siap.

- [x] **Terhalang di sisi Google, bukan di sisi kita — perlu keputusan Boss Ali.** `GmsDocumentScannerOptions.Builder` hanya punya empat setter: `setGalleryImportAllowed`, `setPageLimit`, `setResultFormats`, `setScannerMode`. Tidak ada `setCaptureMode`. Konstanta `CAPTURE_MODE_AUTO`/`CAPTURE_MODE_MANUAL` **ada** di kelas itu tapi tidak pernah bisa diserahkan ke method publik manapun — itu persis isi bug report [googlesamples/mlkit#846](https://github.com/googlesamples/mlkit/issues/846), yang pelapornya menyerahkannya ke `setScannerMode()` dan diam-diam mendapat `SCANNER_MODE_BASE_WITH_FILTER` karena kebetulan keduanya bernilai `2`. Layar pemindainya milik Google Play services, bukan layar kita, jadi tidak ada CSS/prop yang bisa mengubahnya
- [x] **Diputuskan Boss Ali 25 Agustus 2026: (A) terima apa adanya.** Tidak ada perubahan kode — toggle "Manual" di layar pemindai Google tetap sekali ketuk per sesi pindai. Pilihannya cuma dua: **(A)** terima — toggle "Manual" tetap ada di layar itu, sekali ketuk; atau **(B)** ganti mesin pindai dengan kamera sendiri, yang berarti membuat ulang deteksi tepi, koreksi perspektif, dan pembersihan noda dari nol (ganti stack — CLAUDE.md Bagian 2). Rekomendasi: **(A)**

**2. Di layar Pisah Dokumen, halaman terakhir tidak punya "Dokumen baru mulai di sini" — diduga tertutup tombol simpan.**

- [x] **Dugaan "tertutup" dibuktikan salah.** Struktur DOM & CSS layar itu direproduksi persis di Chromium 412x870 dan diukur: `.flow-footer` itu `margin-top: auto` di aliran normal, bukan `fixed` seperti `.select-bar` yang memang menutupi daftar di temuan kemarin. Kartu halaman terakhir berakhir di 1996px, tombolnya mulai di 2018px — tidak bersentuhan, dan tangkapan layar reproduksinya sama persis dengan tangkapan layar dari HP
- [x] **Yang sebenarnya salah: daftarnya berhenti tanpa berkata apa-apa.** Pemisah memang tidak ada setelah halaman terakhir — pemisah di situ akan melahirkan dokumen tanpa halaman, dan `planSplit()` memang membuang cut `>= pageCount`. Tapi irama "halaman - pemisah - halaman - pemisah" putus begitu saja di ujung, jadi pembacanya menyimpulkan ada yang hilang. Perbaikannya menjawab pertanyaan itu langsung: baris penutup **"Halaman terakhir. Pemisah hanya bisa dipasang di antara dua halaman."**
- [x] Test regresinya memeriksa **dua-duanya** — baris penutupnya ada, *dan* pemisahnya benar-benar cuma `pages.length - 1` buah. Tanpa bagian kedua, test itu masih hijau seandainya suatu saat ada pemisah nyasar di ujung daftar

**Test: 610 -> 611,** semuanya lulus (`npm test`).

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] Layar Pisah Dokumen digulir sampai mentok — baris "Halaman terakhir..." terbaca utuh di atas tombol, dan kartu halaman terakhir tidak terpotong

### Fase 6 bagian 8 — OCR on-device & PDF Bisa Dicari (D1) — 25 Agustus 2026

Potongan **D** dari empat sisa Fase 6, tahap pertama dari dua. Desain: `docs/superpowers/specs/2026-08-25-fase6-ocr-docx-design.md`.

**Kontradiksi tier ditutup dulu sebelum kode ditulis.** CLAUDE.md Bagian 6 menulis dua baris yang tidak bisa keduanya benar: OCR sebagai nilai jual Pro, tapi DOCX "langsung semua tier" — padahal DOCX yang berguna isinya hasil OCR. **Keputusan Boss Ali: keduanya Pro.** Ini membalik arah tiga pembatalan gerbang Pro sebelumnya dan itu disengaja — reorder, filter, PNG, anotasi, dan pisah dokumen soal **akses ke dokumen sendiri**; OCR adalah **mesin baru** yang mengubah gambar jadi teks. Baris yang bertabrakan sudah dikoreksi di `CLAUDE.md` Bagian 6 dan PRD Bagian 3.

- [x] **Engine: `@capacitor-mlkit/text-recognition` 8.2.0** — sekeluarga dengan pemindai yang sudah dipakai, on-device, model dibundel di APK jadi **tidak pernah butuh jaringan**. Tesseract.js ditolak (data latih ±25 MB, puluhan detik per halaman 12 MP di HP kelas menengah, memori WASM gampang membunuh WebView); cloud OCR ditolak (Aturan Keras #4)
- [x] **±8,6 MB model skrip non-Latin dibuang dari APK** lewat `exclude` di `android/app/build.gradle`. Ukurannya diukur langsung dari Maven Google, bukan ditebak: Latin 1,38 MB, Mandarin 2,04, Devanagari 2,02, Jepang 2,63, Korea 1,90. Aman karena pemilih skrip di plugin cuma `switch` biasa dan adapter kita memaku `Script.Latin` — cabang yang tidak pernah dieksekusi tidak pernah memuat kelasnya. `-dontwarn` ditulis sekarang meski `minifyEnabled` masih false, supaya menyalakan minify nanti tidak berubah jadi build gagal yang sebabnya tidak ada yang ingat
- [x] Model halaman naik ke **`schemaVersion: 5`** — `text` berisi **path** ke JSON, bukan tata letaknya. Satu halaman padat ±500 kata; menaruhnya di index berarti ratusan KB yang di-parse tiap aplikasi dibuka cuma untuk menggambar daftar dokumen. Nama berkasnya diturunkan dari `original`, jadi reorder halaman tidak menabrakkan berkas antar halaman
- [x] **Koordinat dinormalisasi 0..1**, konvensi yang sama dengan `Mark` — ekspor memperkecil halaman menurut level kompresi (1600px sampai 4000px), jadi koordinat piksel akan menggeser tiap kata begitu levelnya diganti
- [x] **Crop & putar membuang hasil OCR halaman itu; ganti filter & menggambar tidak.** Beda perlakuan dari goresan tinta yang justru dipetakan ulang: goresan tidak bisa dibuat ulang oleh mesin, hasil OCR bisa — dan hasil OCR di halaman yang sudah dicrop justru lebih baik daripada hasil lama yang dipetakan ulang. Membiarkannya berarti salah tempat yang **tidak akan pernah terlihat** siapa pun karena teksnya memang tak terlihat; ia cuma diam-diam merusak salin-tempel dan pencarian
- [x] Sumber gambar OCR = `annotationSource(page)` yang sudah ada — halaman **tanpa tintanya** tapi **dengan filternya**. Dua-duanya disengaja: coretan pena dan tanda tangan di atas teks jadi sampah huruf, sedangkan Hitam-Putih dan Magic Color justru menaikkan akurasi
- [x] **Lapisan teks tak terlihat di PDF** lewat `pdf-lib` yang sudah terpasang: `3 Tr` (mode tak terlihat baku yang dipakai semua alat OCR, bukan `opacity: 0`) + `Tz` yang menyetel tiap kata **pas selebar kotaknya**. Tanpa `Tz`, menyorot satu kata di pembaca PDF akan menyorot separuh kalimat — keluhan yang orang laporkan sebagai "OCR-nya rusak". Nol dependency baru untuk bagian ini
- [x] **Penyaring WinAnsi** sebelum `drawText`, yang **melempar error** pada karakter yang tidak bisa di-encode: satu glyph nyasar dari OCR akan menggagalkan ekspor dua puluh halaman. Tidak ada font yang dibenamkan — Helvetica ada di setiap pembaca PDF dan seluruh Bahasa Indonesia masuk WinAnsi
- [x] **Cadangan cloud ikut membawa lapisan teksnya** — beda dari level kompresi yang sengaja tidak diikutkan. Beberapa KB, tidak menyentuh mutu gambar maupun kuota, dan `readBackup` tetap bekerja apa adanya karena ia mencari XObject gambar, bukan teks
- [x] **Gerbang Pro ditegakkan di `recognizeDocument()`**, bukan di UI. Tapi teks yang **sudah** dikenali tetap dipakai saat ekspor walau tier turun ke Basic: gerbangnya di titik mesin dijalankan, bukan di titik data milik user sendiri dibaca
- [x] Menyimpan **setelah tiap halaman**, beda dari filter dokumen yang menulis index sekali di akhir — memfilter 20 halaman itu hitungan detik, membacanya hitungan menit, dan user yang keluar di tengah tidak boleh kehilangan semuanya. Efek sampingnya: tombol yang sama sekaligus jadi "lanjutkan" dan "perbaiki halaman yang baru di-crop"
- [x] Satu halaman gagal dibaca **tidak** membatalkan sisanya; jumlahnya dilaporkan di toast supaya tidak mengaku bersih
- [x] Baris **"Teks Dokumen"** di layar detail dengan tiga keadaan jujur (belum dikenali / "X dari Y halaman dikenali" / "Teks dikenali · Y halaman") plus progress per halaman. Akun Basic melihatnya berlencana Pro dan diarahkan ke layar Upgrade, bukan tombol mati
- [x] **Paywall bertambah baris kelima** ("Teks dokumen · PDF bisa dicari & Word"). `limitRows` di-export supaya ada test yang menahannya tetap jujur — tiga baris pernah **dihapus** dari ledger ini sepanjang Agustus saat gerbang Pro dicabut satu per satu, jadi ledger itu klaim tentang produk, bukan hiasan
- [x] **Test 611 → 683**, semuanya lulus (`npm test`). Enam mutasi dijalankan untuk membuktikan test-nya menggigit: `Tz` dilepas → test lebar merah; baseline dipindah ke tepi atas kotak → test posisi merah; penyaring WinAnsi dilepas → test karakter merah; sumber OCR diganti jadi ikut tinta → merah; gerbang Pro dilepas → merah; lewati-halaman-sudah-ada dilepas → merah. Semua dikembalikan setelah itu
- [x] Penyaring WinAnsi tidak diuji dengan tabel encoding yang disalin tangan: test-nya **menyapu seluruh rentang kode 0x00–0x2FFF plus emoji**, menyanitasi tiap karakter, lalu menyerahkan hasilnya ke `Helvetica` sungguhan dari pdf-lib. Ada juga ujian arah sebaliknya, supaya penyaring yang mengembalikan string kosong tidak lolos
- [x] Satu bug lama ikut ketangkap: `scanStorage` membandingkan versi skema dengan angka **4** yang ditulis tangan terpisah dari migrasinya, jadi tiap kenaikan skema akan membuat index ditulis ulang di **setiap** pembacaan. Sekarang keduanya memakai `CURRENT_SCHEMA_VERSION`, dengan test yang menjaganya

**Belum dikerjakan — D2 (ekspor DOCX):** penulis ZIP STORE + OOXML minimal, DOCX sebagai format keempat di lembar Ekspor. Rancangannya sudah lengkap di spec Bagian 6.

**Konsekuensi yang perlu keputusan Boss Ali:** keputusan 22 Agustus — "flow pembelian Pro tidak dibuka ke publik sebelum Fase 6 selesai" — tinggal menunggu D2. Membukanya keputusan Boss Ali, bukan sesuatu yang diambil kode ini.

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] "Kenali Teks" pada dokumen 10+ halaman selesai tanpa aplikasi terasa beku; progress-nya bergerak
- [ ] PDF hasil ekspor dibuka di pembaca PDF HP → cari satu kata yang ada di dokumen, sorotannya **mendarat di kata yang benar**, bukan bergeser
- [ ] Salin-tempel satu kalimat dari PDF itu ke aplikasi catatan — hasilnya terbaca, bukan huruf acak
- [ ] Akurasi pada dokumen Indonesia sungguhan: kwitansi termal, surat ketikan, tulisan tangan (yang terakhir memang diharapkan jelek)
- [ ] Halaman yang di-crop setelah OCR kehilangan teksnya, dan tombolnya berubah jadi "Kenali Sisanya"
- [ ] Filter Hitam-Putih dulu lalu OCR → akurasinya naik atau setidaknya tidak turun
- [ ] Akun Basic: baris "Teks Dokumen" berlencana Pro dan membuka layar Upgrade
- [ ] **Ukuran APK rilis setelah `exclude`** — bertambah ±1,4 MB, bukan ±10 MB
- [ ] **Build AAB di CI lolos** setelah plugin baru + `exclude`

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
