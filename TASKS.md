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
- [x] Export tambahan: **PNG** — **semua tier** (lihat catatan di bawah) dan **DOCX** — **Pro**, dibuat bersama OCR di potongan D2 (lihat bagian 9)
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

### Dua temuan code-review di kode C2 — ditutup 25 Agustus 2026

Ketemu saat code-review menjelang commit D1. Keduanya di potongan C2 (pisah dokumen), bukan di OCR — tapi ditutup sekarang juga supaya tidak menumpuk lintas potongan.

- [x] **Nama pisah yang dikosongkan melewati normalizer.** Mengosongkan kolom nama membuat `splitTitles` mengembalikan `undefined`, dan pemanggilnya menambal itu dengan template mentah `${doc.title} (n)` — lewat begitu saja dari normalizer bersama **dan** batas panjangnya. Judul 200 karakter (panjang yang memang bisa diketik lewat Ubah Nama) ditambah " (1)" jadi 204, lebih panjang dari yang diizinkan `confirm-upload`, jadi nama di HP dan di cloud berbeda begitu hasil pisahnya dicadangkan. Sekarang judul dokumen dipakai sebagai **base** yang masuk `splitTitles`, bukan sebagai tambalan di hilirnya
- [x] **Pemisah bergeser diam-diam setelah halaman dihapus.** Keluar dari layar Pisah sengaja **menyimpan** cut-nya supaya percobaan ulang setelah simpan yang setengah berhasil tidak kehilangan penempatan — tapi layar Tinjau di baliknya masih bisa menghapus halaman. Masuk lagi ke layar Pisah lalu memakai cut lama terhadap daftar yang menyusut membuat tiap pemisah setelah halaman itu jatuh ke batas yang berbeda dari yang ditempatkan user. Ditutup dengan `remapCutsAfterRemoval()`: cut sesudah halaman yang dihapus turun satu, cut sebelumnya diam, dan pasangan yang mengapitnya melebur jadi satu — deduplikasinya di sini, bukan diserahkan ke `planSplit`, supaya yang digambar layar dan yang akan disimpan tidak bisa berbeda
- [x] `limitRows` dipindah dari `UpgradeScreen.tsx` ke `src/lib/upgradeLedger.ts`. Meng-export fungsi dari berkas komponen memang mematahkan Fast Refresh untuk berkas itu, dan oxlint menegurnya — modul sendiri lebih tepat untuk data yang memang bukan komponen
- [x] Test 683 → 694

### Fase 6 bagian 9 — Ekspor DOCX (D2) — 25 Agustus 2026

Tahap kedua dari potongan **D**, dan yang terakhir di Fase 6. Desain: `docs/superpowers/specs/2026-08-25-fase6-ocr-docx-design.md` Bagian 6.

- [x] **Penulis ZIP sendiri (`zipWriter.ts`), nol dependency baru.** Metode **STORE**, tanpa kompresi: DOCX berisi teks saja itu puluhan KB, jadi deflate menghemat lebih sedikit daripada ongkos menambah dependency (`docx` menyeret jszip) atau menulis deflate sendiri — dan entry ber-STORE sah sepenuhnya menurut OPC. Tanpa zip64, tanpa data descriptor, nama entry ASCII saja, dan **menolak** nama non-ASCII alih-alih menulis mojibake
- [x] **Cap waktu dari `createdAt` dokumen, bukan dari jam.** Itu yang membuat keluarannya **deterministik**: dokumen yang sama diekspor dua kali menghasilkan byte yang sama, dan tanpa itu tidak ada yang bisa dibandingkan persis di test
- [x] **`docxExport.ts` — empat part OOXML minimal**: `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `docProps/core.xml` (judul & tanggal, sejajar `setTitle`/`setCreationDate` di PDF)
- [x] **Satu paragraf per blok OCR, baris di dalamnya digabung spasi** — itu yang membuat teksnya bisa di-reflow saat diedit, yang memang arti "ubah scan jadi Word". Risikonya diakui terang-terangan di komentarnya: untuk struk dan formulir, di mana tiap baris adalah butir sendiri, menggabungkan baris membaca lebih buruk. Masuk daftar uji device, dan gantinya satu baris kode
- [x] **Escaping `& < > "` plus membuang karakter kontrol C0.** XML 1.0 menolak sebagian besar C0, dan satu byte nyasar dari OCR membuat Word menolak berkasnya sebagai "rusak" tanpa menyebut byte yang mana
- [x] **DOCX membawa karakter yang justru dibuang lapisan teks PDF.** Body-nya UTF-8, jadi 名前 selamat di sini sementara di PDF ia harus dibuang karena Helvetica/WinAnsi tidak punya glyph-nya
- [x] **Ekspor DOCX tidak menyentuh satu pun gambar halaman.** Itu intinya: menjalankan kompresor di jalur ini akan meng-encode ulang dua puluh JPEG 12 MP untuk membuat berkas yang tidak memuat satu pun dari mereka. Ada test yang menjaganya
- [x] **Perkiraan ukuran DOCX bukan perkiraan.** Format gambar harus meng-encode satu halaman lalu dikali karena meng-encode tiga puluh halaman akan makan detik tiap geseran slider; DOCX cukup dibuat betulan (milidetik, tanpa gambar) lalu diukur. Ditampilkan **tanpa "≈"**, dan `null` — bukan nol — saat belum ada teks, supaya "belum dikenali" tidak terbaca sebagai "berkas kosong"
- [x] **Baris Word di lembar Ekspor menawarkan pengenal teks saat belum ada teksnya**, bukan diam-diam mati. Baris mati terbaca sebagai aplikasi rusak, padahal jalan keluarnya satu layar saja
- [x] **Ekspor banyak dokumen menerima Word** lewat pilihan PDF/Word di lembarnya. Kontrol mutu **disembunyikan** saat Word dipilih — tidak ada gambar untuk dikompresi, dan di lembar ini memang ada keadaan "terpilih" untuk ditanggapi (beda dari lembar satu-dokumen, di mana mengetuk format langsung mengekspor). Dokumen yang belum dikenali teksnya dilaporkan sebagai gagal dengan pesannya sendiri, bukan dilewati diam-diam — pemilihannya dilakukan di tab Dokumen, yang tidak tahu dokumen mana yang sudah dibaca
- [x] **`exportDocumentsBatch` dirapikan jadi objek opsi** (`{ level, format, onProgress, signal }`). Menambahkan `format` sebagai argumen keenam setelah `signal` akan jadi tanda tangan yang beberapa bulan lagi terbaca sebagai kekeliruan
- [x] **CSS kontrol segmented dipakai bersama, bukan disalin** — selektor `.filter-scope` di editor digabung dengan `.format-switch` yang baru. Dua salinan aturan yang sama pasti berbeda cepat atau lambat
- [x] **Gerbang tier: tidak ada, dan itu disengaja.** DOCX itu Pro, tapi gerbangnya tetap satu — `recognizeDocument()`. Menambah cek tier di jalur ekspor akan menyandera teks yang sudah dibayar kalau langganan habis, persis yang sudah dihindari di lapisan teks PDF. Akun Basic tidak punya cara membuat teksnya, jadi DOCX praktis tetap Pro tanpa gerbang kedua
- [x] **Test 694 → 756.** Lima mutasi dijalankan untuk membuktikan test-nya menggigit: metode STORE diganti deflate → merah; CRC dinolkan → merah; pembuang karakter kontrol dilepas → merah; page break dihapus → dua test merah; ekspor DOCX dibuat ikut meng-encode halaman → merah. Semua dikembalikan
- [x] **CRC-32 diuji terhadap implementasi terpisah** yang dihitung bit-per-bit tanpa tabel, bukan terhadap angka emas — tabel yang disalin dari sumber yang sama dengan kode produksi akan setuju dengan kode itu meski dua-duanya salah
- [x] **Kesahihan XML dibuktikan parser sungguhan** di suite browser (`DOMParser` Chromium), bukan cuma dengan mencocokkan string. Markup buatan tangan itu persis jenis hal yang terbaca benar tapi tetap gagal di-parse

**Dua temuan code-review ditutup sebelum commit:**

- [x] **Cap waktu ZIP bocor timezone device.** `dosDateTime` membaca `Date` dengan getter waktu lokal (`getHours`, `getDate`, dst.), padahal `createdAt` yang dibungkusnya adalah ISO UTC. Efeknya dua: klaim "diekspor dua kali menghasilkan byte yang sama" jadi bergantung timezone mesin yang mengekspor, dan cap ZIP bisa jatuh di hari yang beda dari `dcterms:created` (yang tetap string ISO asli) untuk device yang bukan UTC — termasuk WIB. Diganti ke getter `getUTC*`, dengan komentar yang menjelaskan kenapa. Test lama diam-diam lolos di kedua versi karena ia membaca ulang dengan getter lokal yang sama (mem-vonis mock, bukan perilaku); test baru menuliskan bagian tanggal/jam sebagai literal UTC dari `MODIFIED`, dan mutasi baliknya (kembali ke getter lokal) terbukti merah
- [x] **Toast OCR menutupi halaman kosong.** `ocr.ts` sudah membedakan `empty` (mesin jalan, kertas kosong) dari `failed`, tapi `App.tsx` cuma mengecek `outcome.failed > 0` — dokumen yang semua halamannya kosong (foto, kertas polos) dilaporkan "Teks dokumen sudah dikenali." padahal `recognized` tetap 0 dan tombol Word tetap menolak dengan "belum ada teks yang dikenali", persis kontradiksi yang coba dihindari `ocr.ts`, cuma pindah satu lapisan ke atas. Ditambahkan `describeOcrOutcome()` di `ocr.ts` sebagai satu-satunya tempat yang tahu cara merangkai keempat angka jadi satu kalimat, dipakai `App.tsx` menggantikan ternary lama

**Terverifikasi di luar kode kita** (sekali saat pengerjaan, seperti verifikasi Chromium waktu potongan kontrol export). Berkas `.docx` sungguhan dibuat lalu dibuka **tiga pembaca independen**:

- **`tar.exe` bawaan Windows** (bsdtar) mengekstraknya bersih, keempat part keluar, exit code 0 — dan ekstraksinya memverifikasi CRC tiap entry
- **.NET `System.IO.Compression.ZipFile`** membaca keempat entry dan isinya, lalu `XmlDocument` mem-parse `word/document.xml`: 4 paragraf, escaping `&amp;`/`&lt;` benar, baris yang terbungkus tergabung jadi satu paragraf seperti rancangannya
- **.NET `System.IO.Packaging.Package`** — abstraksi OPC yang sama yang dipakai Word — membuka paketnya, mengenali kedua content type, dan menemukan kedua relationship

**Fase 6 selesai** setelah ini.

**Menunggu keputusan Boss Ali:** keputusan 22 Agustus — "flow pembelian Pro tidak dibuka ke publik sebelum Fase 6 selesai" — **sudah tidak terhalang apa pun**. Kodenya siap dan sudah diuji sejak Fase 5; yang ditunda hanya pembukaannya ke user. Ini keputusan Boss Ali, bukan sesuatu yang diambil kode ini.

**Diverifikasi di device fisik 29 Agustus 2026** (Boss Ali):

- [x] **DOCX dibuka di WPS/Word di HP** — ini bukti yang sebenarnya; tiga pembaca di atas mesin dev, bukan Android
- [x] **Penggabungan baris dalam satu blok: cek di struk & formulir.** Titik keputusan yang sengaja ditunda sampai lihat keluaran ML Kit di dokumen Indonesia sungguhan — kalau hasilnya jelek, ganti ke satu paragraf per baris
- [x] Page break mendarat di tempat yang benar untuk dokumen banyak halaman
- [x] Ekspor banyak dokumen ke Word: dokumen yang belum dikenali dilaporkan gagal dengan pesannya, sisanya tetap tersimpan
- [x] Judul & tanggal dokumen terbaca benar di properti berkas Word

Penggabungan baris per blok **dipertahankan** — titik keputusan yang ditunda di baris kedua di atas sekarang tertutup: keluaran ML Kit di dokumen Indonesia sungguhan cukup baik, jadi tidak jadi diganti ke satu paragraf per baris.

## Impor via Share Sheet Android — Gambar & PDF — 26 Agustus 2026

Dipicu temuan Boss Ali: ScannApp tidak muncul di daftar "Bagikan ke..." saat berbagi
dari WPS Office/CamScanner. Bukan soal Play Store — fitur penerimaan share intent
memang belum pernah dibangun. Desain: `docs/superpowers/specs/2026-08-26-share-target-import-design.md`.

- [x] **Plugin Capacitor native kecil (`SharedImportPlugin.java`), nol dependency baru.** Satu titik masuk, `handleOnNewIntent` — dikonfirmasi lewat pembacaan langsung `BridgeActivity.java` di node_modules bahwa `onCreate` sudah memutar ulang intent peluncuran lewat jalur yang sama, jadi kasus dingin dan hangat tidak perlu dua method terpisah
- [x] **PDF pihak ketiga dirasterisasi lewat `PdfRenderer` bawaan Android**, bukan reuse `pdfImport.ts` — itu cuma jalan untuk PDF buatan ScannApp sendiri (satu JPEG mentah per halaman)
- [x] **`retainUntilConsumed=true` bawaan Capacitor menggantikan kebutuhan method pull terpisah** — listener yang baru dipasang tetap menerima share yang tiba sebelum app selesai mount
- [x] **Tier: semua tier, tanpa gerbang** — menerima file itu akses, bukan mesin baru (pola yang sama dengan reorder/filter/PNG/anotasi/pisah)
- [x] **Masuk lewat `pendingPages` yang sudah ada, tanpa layar baru** — append kalau user sedang di tengah review lain, replace kalau kosong; tidak pernah menimpa kerja yang belum disimpan
- [x] **Ditunda ke spec terpisah: `.docx` sebagai lampiran.** `LocalScanDocument` strict berbentuk `pages: ScanPage[]`, dipakai di 31 berkas — kind dokumen baru tanpa pages itu subsistem sendiri, bukan bagian kecil dari fitur ini
- [x] **Test node: 647 → 653** (6 test baru di `sharedImport.test.ts`, Task 2; ganti angka ini kalau hasil `npm run test:node` di Step 3 ternyata beda)
- [x] **Build native sungguhan lolos**, bukan cuma typecheck: `gradlew.bat assembleDebug` → `BUILD SUCCESSFUL`, dexing termasuk. Sempat mentok tiga lapis environment mesin dev ini (tidak ada JDK, tidak ada Android SDK, lalu modul `capacitor-android` butuh JDK 21 spesifik sementara modul lain butuh 17) sebelum ketiganya beres — dicatat sebagai infrastruktur di memory harness, bukan di sini
- [x] **Tiga temuan review ditutup, semuanya kode yang saya (plan) tulis sendiri yang salah — bukan kesalahan implementer transkripsi:**
  - Task 1, round 1/5: `resolver.getType(uri)` sempat di luar try/catch per-item — satu file rusak bisa menggagalkan `notifyListeners` untuk seluruh share, bukan cuma file itu; dan `handleOnNewIntent` sempat memproses semua file secara sinkron di main thread (risiko ANR untuk PDF banyak halaman) — dipindah ke `ExecutorService` satu thread
  - Task 2: ditemukan sendiri sebelum dispatch (bukan lewat review) — `handlePromise` dari `addListener()` yang reject tanpa pernah di-unsubscribe (kasus normal `App.tsx`) akan jadi unhandled rejection; `.catch()` dipasang segera saat promise dibuat, bukan cuma di closure unsubscribe
  - Task 3, round 1/5: cabang fresh-start efek share menyalin ulang 4 dari 5 reset milik `exitSplit()` dan lupa `setSplitSaved(0)` — lewat `handleRemovePage` yang mengosongkan `pendingPages` tanpa memanggil `exitSplit()`, nomor dokumen hasil pisah berikutnya bisa mulai dari angka sisa yang salah. Diperbaiki dengan memanggil `exitSplit()` langsung alih-alih menyalin daftar reset-nya
- [x] **Task 4 (code-review + security-review): `/code-review` mengembalikan 9 temuan atas diff Task 1–3 (`b3a84a3..HEAD`) — 5 ditutup dengan fix nyata, 4 dijawab dan sengaja tidak diterapkan (bukan diam-diam diabaikan), semuanya diverifikasi ke kode Capacitor di `node_modules` dan ke spec, bukan diterima/ditolak mentah dari laporan skill:**
  - **Ditutup (5), semua di `SharedImportPlugin.java`/`sharedImport.ts`:**
    - `notifyListeners()` dipanggil langsung dari `importExecutor` (thread sendiri) sementara `addListener()` dari JS jalan di thread `taskHandler` milik Bridge ("CapacitorPlugins") — keduanya menulis ke `HashMap` yang sama di `Plugin` tanpa sinkronisasi, race persis di jalur cold-launch yang jadi alasan fitur ini ada. Diperbaiki dengan `execute(() -> notifyListeners(...))`, method bawaan `Plugin` yang mem-post balik ke thread `taskHandler` yang sama
    - `catch (Exception e)` di loop per-file tidak menangkap `OutOfMemoryError` (dia `Error`, bukan `Exception`) — bitmap `ARGB_8888` penuh per halaman PDF bisa melempar itu di HP yang sudah tertekan memori, dan sebelumnya itu akan lolos dari loop lalu membatalkan `notifyListeners` untuk seluruh share. Diperbaiki jadi `catch (Exception | OutOfMemoryError e)`
    - Closure unsubscribe di `sharedImport.ts` (`handlePromise.then((handle) => handle.remove())`) bikin promise baru yang terpisah dari `handlePromise` — `.catch()` yang sudah dipasang di Task 2 cuma menandai `handlePromise` sendiri sebagai "ditangani", bukan promise turunan dari `.then()` ini. Kalau `handlePromise` reject dan unsubscribe sempat dipanggil (mis. React StrictMode double-mount di dev), ini jadi unhandled rejection kedua — bug yang sama persis, tempat baru. Ditutup dengan `.catch(() => {})` tambahan di ujung chain
    - `copyImageToCache` tidak membersihkan berkas JPEG setengah-tertulis kalau `fos.write` gagal di tengah jalan (mis. disk penuh) — file rusak itu tertinggal permanen di `cache/shared-import/`. Ditutup dengan `out.delete()` di catch block sebelum melempar ulang exception-nya
    - Docstring `copyImageToCache` bilang harus sinkron karena grant `content://` "cuma valid selama diproses" — sudah tidak akurat sejak proses dipindah ke `ExecutorService` di Task 1 round 1 (jalan async), dan grant URI sebenarnya bertahan selama Activity penerima hidup. Diganti dengan penjelasan yang akurat
  - **Dijawab, sengaja tidak diterapkan (4):** (1) PDF >50 halaman dipotong tanpa menambah `skippedCount` — sudah keputusan desain eksplisit di spec §9 tabel ("Dipotong di 50, tanpa gagal total"), bukan bug; (2) share masuk saat `status==='signed-out'` bisa hilang kalau proses Android direklaim — risiko arsitektur lama yang berlaku ke semua `pendingPages` in-memory di app ini, bukan regresi baru dari fitur ini; (3) App Open ad bisa muncul saat kembali dari share masuk — laporan itu salah kaitkan ke pengecualian "share sheet" di `appOpenGate.ts`, yang ternyata (diverifikasi ke `exportShare.ts`) soal share **keluar** ScannApp sendiri yang memicu `leaveForOwnFlow()`, bukan share **masuk** dari app lain; ScannApp tidak pernah memulai excursion itu jadi memang seharusnya kena App Open ad seperti resume biasa; (4) tidak ada intent-filter `SEND_MULTIPLE`+`application/pdf` di manifest — diverifikasi ke spec §3.1, cuma 3 kombinasi yang sengaja didaftarkan (`SEND+image/*`, `SEND+application/pdf`, `SEND_MULTIPLE+image/*`), cabang PDF di loop `SEND_MULTIPLE` di kode adalah defensive coding untuk kasus campuran yang lolos, bukan manifest yang lupa ditambah
  - `/security-review` (fokus khusus path traversal nama berkas per brief task): dikonfirmasi **bukan** celah — nama berkas keluaran (`shared-<nanoTime>[-index].jpg`) murni dari `System.nanoTime()` dan index loop milik kode sendiri, tidak pernah disentuh data dari URI yang dibagikan. Nol temuan HIGH/MEDIUM lain di diff fitur ini

**Belum diverifikasi di device fisik** (butuh Boss Ali — disalin dari spec §9):

- [ ] Share 1 foto dari galeri/app lain ke ScannApp saat app tertutup → app terbuka, langsung di layar review dengan foto itu
- [ ] Share 1 foto saat ScannApp sedang di foreground (bukan di tengah review) → langsung ke review
- [ ] Share saat sedang di tengah review scan lain yang belum disimpan → foto baru ditambahkan, bukan menimpa halaman yang sudah ada
- [ ] Share beberapa foto sekaligus (pilih multi di galeri → share) → semua masuk sebagai halaman, urutannya sesuai
- [ ] Share PDF dari WPS Office → tiap halaman PDF jadi halaman terpisah di review, kualitas gambar terbaca jelas
- [ ] Share PDF hasil CamScanner → sama, dan pastikan bukan cuma halaman pertama yang muncul
- [ ] Share file docx dari WPS Office → tidak muncul di daftar app (mime type tidak didaftarkan di manifest sesi ini) — perilaku yang diharapkan, bukan bug
- [ ] Share PDF terenkripsi/rusak sengaja → toast error, app tidak crash
- [ ] Ukuran APK & waktu build setelah plugin Java baru — tidak ada regresi mencolok

## Tujuan Ekspor: Bagikan vs Simpan ke HP — 27 Agustus 2026

Menutup **tiga sisa temuan uji device 26 Agustus** yang sengaja ditunda menunggu pesan
error asli dari HP (lihat pesan commit `467361a`), plus satu bug baru yang Boss Ali
temukan saat menguji ulang. Ketiga temuan lama ternyata **dua akar penyebab**, bukan tiga.

**Akar penyebab 1 — scoped storage menolak menimpa berkas yang bukan milik install ini.**
Ekspor menulis lewat path mentah ke `/storage/emulated/0/Documents`
(`Environment.getExternalStoragePublicDirectory`). Sejak Android 11 aplikasi boleh
**membuat** berkas di folder Documents bersama tapi hanya boleh **membuka ulang** yang
masih miliknya, dan kepemilikan itu tidak selamat dari pemasangan ulang aplikasi — jadi
dokumen yang diekspor build kemarin, bagi build hari ini, adalah berkas aplikasi lain.
Pola tes Boss Ali sendiri yang membuktikannya: nama sama → gagal tiap kali, nama diganti
→ berhasil, batch 3 dokumen → yang gagal cuma yang namanya sudah ada di folder itu.
Temuan lama "batch multi-dokumen tidak terkirim" **sebab yang sama**: ketiganya gagal
ditulis → `uris` kosong → `shareFiles` langsung `return`, share sheet tidak pernah
terbuka dan tidak ada apa pun di layar yang menjelaskannya.

**Akar penyebab 2 — "batal" tidak berarti batal.** `deliverExport()` menulis ke folder
publik **dulu**, baru membuka share sheet, dengan komentar yang menyatakannya sebagai
fitur: "kalau sheet ditutup, berkasnya tetap ada". Boss Ali menutup share sheet dan
menemukan berkasnya sudah mendarat di file manager.

**Keputusan Boss Ali 27 Agustus 2026: pisahkan tujuannya, jangan lakukan dua-duanya.**
Lembar Ekspor dapat sakelar **Tujuan** di atas daftar format, sejajar kontrol Mutu yang
sudah ada — pilihannya harus sudah dibuat sebelum format diketuk, karena mengetuk format
langsung mengekspor. Bawaannya **Bagikan**, dan pilihannya diingat (`localStorage`,
divalidasi terhadap daftar seperti level kompresi).

- [x] **Bagikan: berkas ditulis ke cache privat aplikasi (`cache/exports/`), bukan ke folder publik.** Tidak butuh izin, scoped storage tidak ikut campur, dan `file_paths.xml` sudah mengekspos `cache-path` ke FileProvider yang dipakai plugin Share. Batal → folder staging dihapus, nol jejak di HP
- [x] **Benarnya tidak bergantung pada deteksi "cancel".** Ini yang membuat rancangan ini dipilih dan bukan "tulis dulu, hapus kalau batal": sebagian OEM menghentikan Activity kita saat share sheet tampil, dan plugin Share lalu melapor sukses walau user membatalkan. Di rancangan ini kegagalan mendeteksi batal cuma membuat satu toast keliru — bukan berkas nyasar di HP
- [x] **Simpan ke HP: tidak pernah membuka share sheet sama sekali**, dan **tidak pernah menimpa** berkas yang sudah ada di folder Documents — nama dinaikkan jadi `Dok agent (2).pdf`. Dua masalah dijawab satu perbaikan: EACCES hilang, dan ekspor kedua tidak lagi menghancurkan yang pertama
- [x] **Ada percobaan ulang setelah tulis ditolak, bukan cuma cek `stat` di depan.** `stat` tidak selalu bisa melihat berkas yang bukan milik install ini, jadi nama yang ia laporkan kosong masih bisa ditolak `writeFile` sesudahnya. Dibatasi 3 percobaan supaya disk penuh tidak berubah jadi 99 penulisan sia-sia, dan error terakhir tetap sampai ke user apa adanya
- [x] **Toast membaca nama dari yang benar-benar ditulis**, bukan dari yang diminta — menyebut `Nota.pdf` padahal yang mendarat `Nota (2).pdf` akan menyuruh user mencari berkas yang tidak ada
- [x] **Share sheet yang gagal beneran dibedakan dari yang ditutup user.** Plugin menolak dengan string `"Share canceled"` saat ditutup; apa pun selain itu dilempar ulang. Menyamarkan kegagalan nyata jadi "user membatalkan" persis cara sebuah sebab hilang sebelum ada yang bisa menindaklanjutinya
- [x] **Batch menyimpan catatannya saat share sheet gagal beneran** (temuan code-review): jalur batch sudah membangun apa yang bisa dibangun dan tahu dokumen mana yang hilang di jalan; melempar exception dari situ membuang semuanya dan menyisakan satu kalimat soal sheet. Jalur satu-dokumen tetap melempar — di sana tidak ada catatan yang perlu diselamatkan, jadi sebab aslinya memang seluruh ceritanya
- [x] **Staging dihapus sekali per run, bukan per dokumen.** Menghapus di antara dokumen akan membuang dokumen yang sudah antre untuk satu share sheet di akhir — batch akan menyerahkan berkas terakhirnya dan kehilangan sisanya
- [x] **Tier: tidak tersentuh.** Satu-satunya tempat tier masih menyentuh jalur ekspor tetap `shouldWatermark()`

**DOCX kosong — paketnya kurang lengkap, penulisnya tidak rusak.** Diverifikasi dengan
**Microsoft Word 16.0 sungguhan lewat COM** di mesin dev: berkas dari kode lama terbuka
benar (6 paragraf, 2 halaman, escaping utuh), jadi masalahnya bukan XML-nya. Yang kurang
adalah **default yang paketnya serahkan ke pembaca**: tanpa `word/styles.xml` tidak ada
`docDefaults`, dan run tanpa `rPr` mewarisi dari sana — pembaca yang menyelesaikan
ukuran font yang hilang jadi nol membuka berkas dengan sempurna dan tidak menampilkan
apa pun. Tanpa `sectPr` tidak ada geometri halaman sama sekali.

- [x] **Tiga part/elemen ditambahkan**: `word/styles.xml` (docDefaults: Calibri 11pt + jarak paragraf, plus style `Normal`), `word/_rels/document.xml.rels` (satu relasi, ke stylesheet), dan `<w:sectPr>` A4 2,54 cm yang menutup body. `[Content_Types].xml` ikut menyebut stylesheet-nya
- [x] **Diverifikasi lagi di Word setelah perbaikan**: ukuran kertas **595,3 × 841,9 poin** (A4 — sebelumnya Word jatuh ke Letter 612), font bawaan **Calibri 11pt** kini datang dari stylesheet kita, teks & jumlah halaman tetap benar
- [x] **Tetap belum terbukti di WPS Android** — itu pembaca yang sebenarnya bermasalah dan tidak ada di mesin dev. Yang bisa dinyatakan jujur: ketiga sebab yang diketahui bisa membuat pembaca yang taat menampilkan halaman kosong sudah tidak ada lagi. Masuk daftar uji device

**Satu temuan dari probe keamanan sendiri** (bukan celah — judul dokumen berasal dari
user yang sama, tidak ada batas hak akses yang dilewati):

- [x] **`toSafeFilename` meloloskan karakter kontrol, NUL termasuk.** Pass `\s+` sudah menelan newline/tab/CR, tapi sisa C0 lolos dan akan diserahkan langsung ke `open()`, di mana nama berkas itu C string dan segalanya setelah NUL berhenti ada. Ditutup satu baris, dengan test yang juga menahan `../`, `..`, dan backslash tidak pernah bisa keluar dari foldernya

**Test 775 → 825**, semuanya lulus (`npm test`), tsc & oxlint bersih. **Sebelas mutasi
dijalankan** untuk membuktikan test-nya menggigit: cek nama-sudah-dipakai dilepas → merah;
percobaan ulang dilepas → merah; staging tidak dihapus saat batal → merah; jalur Bagikan
diarahkan ke folder publik → merah; `isDismissal` dibuat selalu benar → merah; staging
dihapus per dokumen → merah; `<w:sz>` dihapus → merah; `sectPr` dihapus → merah;
`document.xml.rels` dihapus → merah; pembuang karakter kontrol dilepas → merah; batch
dibuat melempar ulang kegagalan share → merah. Semua dikembalikan.

**Diverifikasi di device fisik 29 Agustus 2026** (Boss Ali):

- [x] Ekspor PDF dengan **Bagikan**, lalu **tutup share sheet** → toast "Ekspor dibatalkan", dan **tidak ada berkas baru** di file manager
- [x] Ekspor dokumen yang **namanya sudah pernah diekspor**, tujuan **Simpan ke HP** → berhasil, toast menyebut `(2)`, berkas lama tetap utuh
- [x] Ekspor 3 dokumen sekaligus dengan **Simpan ke HP** → ketiganya mendarat, tidak ada share sheet
- [x] Ekspor 3 dokumen dengan **Bagikan** → satu share sheet di akhir berisi ketiganya
- [x] Pilihan Tujuan masih sama setelah aplikasi ditutup dan dibuka lagi
- [x] **DOCX dibuka di WPS Office di HP** → teksnya terlihat, kertasnya A4

## Fase 7 — Perbaikan Gambar ("Perbaiki Pencahayaan" klasik, "AI Enhance" model menyusul) — subsistem paling berat

**Dipecah dua (29 Agustus 2026, saat brainstorm).** Baris lama menggabungkan dua
subsistem yang tidak berbagi kode apa pun, sehingga tidak bisa dieksekusi bertahap:

- **7A — mutu gambar:** cahaya/bayangan, dan nanti noise/ketajaman.
- **7B — geometri:** auto-deskew + auto-crop presisi. Perlu dicatat bahwa pemindai
  sudah jalan di `scannerMode: 'FULL'`, jadi ML Kit **sudah** melakukan deteksi sudut
  dan koreksi perspektif untuk halaman yang masuk lewat pemindai. Yang benar-benar
  telanjang adalah **jalur impor** — foto share sheet dan hasil rasterisasi PDF masuk
  ke `pendingPages` tanpa deteksi tepi sama sekali. Itu lubang yang sebenarnya.

### Hasil riset model TFLite (29 Agustus 2026) — tidak ada yang siap pakai

Butir "riset & pilih model" **sudah dikerjakan**, dan hasilnya negatif:

- [x] **Tidak ada model shadow-removal dokumen yang bisa langsung dipasang di HP.**
  `LP-IOANet` (ICASSP 2023) satu-satunya yang dirancang real-time di HP — **tidak pernah
  merilis kode maupun bobot**. Kaggle Models & MediaPipe tidak punya model untuk tugas ini.
- [x] **Yang tersedia & berlisensi MIT terlalu besar 30–100×.** `DocShadow/FSENet`
  (ICCV 2023, ada ekspor ONNX MIT) **29,34 juta parameter**, **7,93 detik per halaman
  resolusi penuh di GPU desktop**; penulisnya sendiri menulis model itu tidak bisa jalan
  di perangkat tepi seperti HP. Int8 pun ±29 MB, di APK yang sudah dipangkas 8,6 MB
  demi ukuran.
- [x] **Melatih sendiri tidak bisa di mesin ini.** Dataset SD7K (7.000+ pasang, MIT)
  tersedia, tapi mesin dev punya RAM **3,4 GB** dan GPU AMD terintegrasi 512 MB.
  Pelatihan harus di notebook GPU luar — berminggu-minggu, dengan risiko hasil di
  bawah baseline klasik.

**Keputusan Boss Ali 29 Agustus 2026: klasik dulu, seam untuk model.** PRD Bagian 4
menulis AI Enhance **wajib** TFLite; alasan yang PRD tulis untuk mandat itu adalah
**menolak cloud AI** ("free tier rawan dipangkas, biaya tak terduga") — dan metode
klasik memenuhi alasan itu lebih baik lagi: nol biaya, nol jaringan, selamanya.
Jalur TFLite tidak dibuang, ia jadi penggantian isi satu fungsi (`enhancePage()`)
tanpa menyentuh schema, storage, atau UI. **PRD Bagian 4 perlu direvisi mengikuti ini.**

### 7A — Perbaiki Pencahayaan (v1, metode klasik, semua tier)

Keputusan desain yang sudah diambil saat brainstorm:

- [x] **Tahap terpisah, bukan filter keenam.** Rantainya jadi
  `original → edited → enhanced → filtered → annotated`, jadi Perbaiki Pencahayaan bisa dipakai
  **bersamaan** dengan Hitam-Putih — dan justru di situ nilainya paling terasa, karena
  Hitam-Putih pada halaman berbayang sekarang menghasilkan bercak hitam pekat.
  `ScanPage.enhanced`, `LocalScanDocument.enhance`, `schemaVersion` **5 → 6**.

  **Selesai 30 Agustus 2026** di `scanIndexMigration.ts`. `filterSource()` sekarang
  membaca `enhanced ?? edited ?? original`, jadi filter dirender **di atas** hasil
  koreksi cahaya — itulah yang membuat keduanya menumpuk alih-alih saling meniadakan.
  `enhanceSource()` sengaja tidak membaca `filtered`: mengoreksi cahaya di halaman
  yang sudah di-threshold berarti menaksir cahaya dari citra yang greys-nya sudah
  dibuang. Berkas `enhanced` dipasangkan dengan sakelar `enhance` dokumen — sakelar
  mati, berkasnya ikut dilepas saat migrasi, meniru aturan `annotated`+`marks` yang
  sudah ada. Dokumen v1–v5 naik ke v6 tanpa kehilangan apa pun; keduanya sekadar
  datang tanpa field baru ini.
- [x] **Algoritma:** kisi 16×16 ubin di citra kerja ±256 px, persentil ke-95 per ubin,
  penolakan pencilan **lokal** (median + MAD jendela 5×5, `σ̂ = max(1,4826 × MAD, 4)`,
  tolak bila `p_i < m − 3σ̂`), tambal dari tetangga, katup batal >50% ubin ditolak,
  batas penguatan 2,5×. Latar **tidak pernah dimaterialisasi** seukuran halaman —
  diinterpolasi bilinear langsung dari kisi (halaman 12 MP = buffer 50 MB).

  **Selesai 30 Agustus 2026** di `src/lib/enhance.ts` (murni matematika, tanpa DOM,
  suite node) dan `enhancePage()` di `src/lib/imageEditor.ts` (sisi kanvas, suite
  browser).
- [x] **Batch dengan `signal`, bukan on-demand.** `applyDocumentFilter` yang ada
  punya `onProgress` tapi **tidak punya pembatalan**; enhance harus punya, karena
  Basic mentok 20 halaman tapi **Pro tidak terbatas**.

  **Selesai 30 Agustus 2026** — `applyDocumentEnhance()` di `scanStorage.ts`, dengan
  `applyPageEnhance()` sebagai pendampingnya untuk satu halaman sesudah crop/rotate.
  Signal diperiksa **antar halaman**, tidak pernah di tengah satu halaman: berhenti
  di tengah render hanya menyisakan berkas separuh tulis. Jalan yang dibatalkan
  menyimpan yang sudah jadi **dan** tetap mencatat sakelar yang diminta user —
  sakelar merekam niat, berkasnya merekam sejauh mana. Jalan kedua melewati halaman
  yang sudah benar, jadi melanjutkan itu murah. Sambungan UI-nya menyusul.
- [x] **Ukur sebelum merancang UI progres.** `enhancePage()` dulu, ukur di Chromium
  pada halaman 12 MP sungguhan, kalikan 4 untuk mid-range. **Kalau proyeksi 20 halaman
  melewati ±30 detik, rancangannya berubah** (resolusi kerja lebih kecil, atau hanya
  saat simpan). Ini menggantikan butir lama "uji performa di device low-end" sebagai
  gerbang, bukan sebagai pemeriksaan di akhir.

  **Hasil ukur 30 Agustus 2026** (Chromium desktop, halaman 3000×4000, empat kali
  jalan — `src/lib/enhanceBench.browser.test.ts`):

  | | total | decode + getImageData | estimasi | koreksi | encode |
  |---|---|---|---|---|---|
  | jalan 1 | 492 ms | 131 ms | 71 ms | 274 ms | 125 ms |
  | jalan 2 | 499 ms | 154 ms | 53 ms | 276 ms | 111 ms |
  | jalan 3 | 508 ms | 272 ms | 42 ms | 277 ms | 122 ms |
  | jalan 4 | 540 ms | 124 ms | 18 ms | 214 ms | 110 ms |

  Proyeksi mid-range (×4) untuk 20 halaman: **39–43 detik**. Gerbang ±30 detik:
  **TIDAK LOLOS**.

  Yang penting dari rinciannya: **koreksi per piksel yang paling mahal** (±260 ms,
  separuh total), bukan decode/encode seperti yang dikhawatirkan saat menulis plan.
  (Catatan: angka "koreksi" jalan 1–4 masih memuat `putImageData` di dalamnya;
  setelah dipisah, `putImageData` ternyata cuma 11–18 ms.)

- [x] **Optimasi loop koreksi — dicoba atas keputusan Boss Ali 30 Agustus 2026,
  gerbang tetap tidak lolos.** Tiga perubahan, semuanya di `correctLighting`:
  interpolasi sumbu-y diangkat jadi 16 angka per baris (dari 3 interpolasi per
  piksel jadi 1), indeks piksel dijalankan maju alih-alih dihitung ulang, dan
  **pembagian dikeluarkan dari loop terdalam** — gain dihitung tiap 4 piksel lalu
  diinterpolasi.

  **Hasil (5 kali jalan, mesin yang sama):** koreksi **200–265 ms → 133–187 ms**,
  total **±500 ms → 397–543 ms (median 437)**, proyeksi **35 detik** (rentang
  32–43). Gerbang ±30 detik: **masih TIDAK LOLOS**.

  **Kenapa loop tidak bisa menyelamatkannya.** Decode ±150 ms + encode ±140 ms =
  **±290 ms yang tidak bisa dihindari** selama keluarannya resolusi penuh — itu
  saja sudah **23 detik** dari jatah 30 detik. Koreksi nol pun proyeksinya masih
  ±24 detik, dan koreksi seoptimal apa pun hari ini ±140 ms. Jadi sisa pilihannya
  memang menyentuh rancangan, bukan aritmetika.

  **Biaya di dua resolusi lain, diukur di hari yang sama** (3 kali jalan tiap
  ukuran) — angka untuk keputusan berikutnya, karena satu-satunya tuas yang
  tersisa adalah berapa piksel yang disentuh tahap ini:

  | ukuran halaman | per halaman | proyeksi 20 halaman |
  |---|---|---|
  | 3000×4000 (12 MP, apa adanya) | 397–543 ms | 32–43 detik |
  | 3200×2400 (7,7 MP = preset Tinggi) | 259–405 ms | 21–32 detik |
  | **2400×1800 (4,3 MP = preset Standar)** | **179–228 ms** | **14–18 detik** |

  Yang membuat baris terakhir menarik: jalur ekspor **sudah** memampatkan ke
  2400 px di preset Standar, dan cadangan cloud **selalu** Standar (`CLAUDE.md`
  Bagian 6). Jadi membatasi sisi panjang hasil koreksi di 2400 px tidak terlihat
  sama sekali di ekspor bawaan maupun cadangan — yang berkurang hanya ekspor
  Tinggi & Maksimal, dan hanya selama sakelarnya menyala (`original` tidak pernah
  disentuh, jadi mematikan sakelar mengembalikan resolusi penuh).

  **Satu jalan yang ditolak, dicatat supaya tidak dicoba lagi:** menghitung gain
  cuma di 16 simpul kisi lalu menginterpolasinya (tanpa langkah 4 piksel) memang
  paling cepat, tapi `target / cahaya` itu cembung — di tepi bayangan tajam
  hasilnya **meleset 24 level** dari pembagian eksak, berupa pita terang persis
  di jenis tepi yang fitur ini ada untuk menghilangkannya. Tiap 16 piksel masih
  meleset 5 level; tiap 4 piksel meleset 1–2 level di halaman ukuran penuh.
  Dijaga tes `correctLighting against the exact division` di `enhance.test.ts`.

- [x] **Batas 2400 px + resampler menurut rasio — gerbang LOLOS** (keputusan Boss
  Ali 30 Agustus 2026). Sisi panjang hasil koreksi dibatasi **2400 px**
  (`ENHANCED_EDGE` di `enhance.ts`), sama dengan preset Standar.

  **Batasnya sendiri hampir tidak menolong.** Diukur setelah dipasang: 427–523 ms
  per halaman, dari 397–543 ms sebelumnya — proyeksi tetap 34–42 detik. Biayanya
  **pindah, bukan hilang**: menyusutkan 12 MP jadi 4,3 MP dengan resampler kualitas
  tinggi memakan **305–357 ms**, dan sama mahalnya di mana pun dikerjakan — lewat
  `createImageBitmap({ resizeQuality })` saat decode maupun lewat `drawImage` ke
  kanvas yang lebih kecil. Decode-nya sendiri cuma ±65 ms; **resampler-nya yang
  mahal**, bukan decode seperti yang diduga sebelumnya.

  **Yang menyelesaikannya: pilih resampler menurut rasio penyusutan**
  (`resamplerFor()` di `imageEditor.ts`). Bilinear membaca tetangga 2×2, jadi ia
  masih melihat setiap piksel sumber selama penyusutan belum melewati setengah,
  dan baru mulai melewatkan piksel di bawah itu. Diukur pada halaman berisi teks
  badan + garis rambut, dibandingkan hasil resampler kualitas tinggi: beda
  rata-rata **1,34 level di 0,6×** — dan 0,6× justru persis kasus kita (12 MP →
  2400) — lalu 3,43 level di 0,45×, dan 6,72 level di 0,3× dengan garis rambut
  hilang seluruhnya. Aturannya jadi: **murah di atas setengah, hati-hati di
  bawahnya.**

  | | per halaman | proyeksi 20 halaman |
  |---|---|---|
  | sebelum (12 MP, resolusi penuh) | 397–543 ms (median 437) | 32–43 detik |
  | batas 2400 saja, resampler tinggi | 427–523 ms | 34–42 detik |
  | **batas 2400 + resampler menurut rasio** | **243–339 ms (median 265)** | **19–27 detik** |

  Rincian per tahap sesudahnya: decode+getImageData 131 ms, estimasi 14 ms,
  koreksi 44 ms, `putImageData` 5 ms, encode 36 ms. Gerbang ±30 detik: **LOLOS**,
  jadi rancangan UI di spec Bagian 7 tetap berlaku dan Task 4 boleh jalan.

  **Ekspor ikut kena, dan itu disengaja.** `compressImage` memakai `decodeCapped`
  yang sama, jadi ekspor Standar dari halaman 3000 px (rasio 1,25×) sekarang juga
  memakai bilinear dan juga lebih cepat. Ekspor Kecil dari halaman 4000 px (rasio
  2,5×) tetap memakai resampler kualitas tinggi seperti sebelumnya.

  **Yang hilang, dan kenapa dianggap murah:** ekspor Tinggi & Maksimal tidak lagi
  bisa melampaui 2400 px **selama sakelarnya menyala**. Berkas `original` tidak
  pernah disentuh, jadi mematikan sakelar mengembalikan resolusi penuh. Ekspor
  bawaan (Standar) dan cadangan cloud — yang **selalu** Standar, `CLAUDE.md`
  Bagian 6 — tidak berubah sama sekali.
- [x] Toggle on/off per dokumen — **selesai 30 Agustus 2026.** `EnhancePanel` di editor,
  mode `'enhance'` di sebelah Filter. **Tiga keadaan diam, bukan dua:** mati,
  hidup-dan-lengkap, dan hidup-tapi-baru-sebagian — yang tersisa setelah dibatalkan,
  dan juga tempat berhenti permanen buat dokumen yang sebagian halamannya ditolak
  estimator. Keadaan tengah menampilkan "12 dari 20 halaman diperbaiki" plus tombol
  **Lanjutkan**; membulatkannya ke salah satu ujung membuat user tidak punya cara tahu
  kenapa satu halaman masih tampak seperti semula. `AbortController` dipegang di
  `useRef`, bukan state — membatalkan tidak boleh menunggu render ulang. Tanpa badge
  Pro, tanpa jalur upgrade, dan **ada tes yang menjaga panel ini tidak pernah menyebut
  dirinya "AI"**.
- [x] **Tier & penamaan — final (Boss Ali, 29 Agustus 2026).** **Tier: semua tier**,
  Basic maupun Pro, setara. Argumen paywall di PRD Bagian 4 berdiri di atas **biaya
  cloud AI**, sementara metode klasik nol biaya marjinal — tidak ada yang dibiayai,
  jadi tidak ada yang perlu ditahan. Status **Pro-exclusive baru berlaku khusus untuk
  versi model TFLite** saat model itu selesai dilatih & diintegrasikan. Sampai itu
  terjadi, jangan tulis satu pun cek tier di jalur ini. **Nama: "Perbaiki
  Pencahayaan"** — **dilarang** menyebutnya "AI Enhance" di UI maupun copy mana pun,
  karena isinya matematika deterministik dan klaim "AI" menyesatkan user. Nama "AI
  Enhance" disimpan untuk versi model. Nama internal kode tetap netral
  (`enhancePage()`, `ScanPage.enhanced`) supaya seam-nya bisa diisi model nanti tanpa
  rename berantai. Sudah diterapkan ke PRD Bagian 4 & tabel tier, CLAUDE.md Bagian 2/3/6,
  SYSTEM_DESIGN.md, dan komentar `filters.ts`

**Known gap yang sengaja dikeluarkan dari v1 — jangan sampai baru ketahuan saat QA
Fase 9:** PRD Bagian 4 menulis cakupan AI Enhance mencakup **noise reduction** dan
**peningkatan ketajaman**. Keduanya **tidak** ada di 7A v1. Alasannya: denoise dan
sharpening adalah dua operasi yang berlawanan dan setengah matang hasilnya lebih buruk
daripada tidak sama sekali; keluhan "berbintik" pada dokumen sebagian besar sebenarnya
bayangan belang, yang justru diselesaikan 7A; dan noise/ketajaman persis wilayah di mana
model belajar mengalahkan matematika klasik — jadi itu muatan pertama yang masuk akal
untuk seam TFLite, bukan tambalan konvolusi hari ini.

**Menunggu uji di device fisik (Xiaomi T15) — ini tugas Boss Ali, bukan Claude:**

- [x] Dokumen berbayang (foto halaman dengan bayangan tangan) → sakelar **Aktif** → bayangan
  rata, teks tetap terbaca
- [x] Sakelar **Aktif** lalu filter **Hitam-Putih** → tidak ada lagi bercak hitam pekat di
  daerah bayangan; keduanya berlaku bersamaan, menyalakan salah satu tidak mencabut yang lain
- [x] Dokumen 20 halaman → progres berjalan per halaman, tombol **Batal** benar-benar
  menghentikan (bukan cuma menutup panel)
- [x] Setelah **Batal**: panel bilang "N dari 20 halaman diperbaiki", tombol **Lanjutkan**
  meneruskan dari halaman N+1, bukan mengulang dari awal
- [x] Sakelar **Nonaktif** → halaman kembali seperti semula, berkas `-enhanced.jpg` hilang
- [x] Crop satu halaman saat sakelar menyala → halaman itu diperbaiki ulang, filternya ikut benar
- [x] Tutup & buka ulang aplikasi → sakelar dan hasilnya masih sama
- [~] Ekspor PDF dengan sakelar menyala → yang keluar halaman hasil perbaikan. **Isinya benar,
  tapi lambat:** 20 halaman makan **lebih dari 1 menit, sekali sampai 1 menit 30 detik**
  (dilaporkan dari HP, 31 Agustus 2026). Sudah ditelusuri & jalur ekspornya diperbaiki —
  lihat bagian di bawah. **Perlu diuji ulang** untuk mengukur hasilnya.
- [ ] Waktu nyata per halaman di HP dibanding proyeksi Task 3 (265 ms desktop → target
  di bawah ±1,5 detik/halaman, 20 halaman di bawah ±30 detik)
- [x] Tidak ada satu pun kata "AI" di layar mana pun

### Ekspor 20 halaman lambat — ditelusuri & diperbaiki 31 Agustus 2026

Dugaan awal saat melapor: penyebabnya halaman yang sempat di-crop dan diberi filter
Hitam-Putih. **Diukur, dan dugaan itu tidak terbukti — arahnya justru terbalik.** Diukur di
Chromium pada halaman foto 3000×4000 yang berbintik (bench sementara, sudah dihapus lagi):

| sumber halaman | kompres 20 halaman | PDF 20 halaman |
|---|---|---|
| sakelar **mati** (asli 12 MP) | **6,2 detik** | 25,1 MB |
| sakelar **hidup** (2400 px) | **2,9 detik** | 29,3 MB |
| sakelar **hidup** + Hitam-Putih | **2,5 detik** | 31,3 MB |

Sakelar pencahayaan **mempercepat** tahap kompresi, bukan memperlambat — halaman hasil
perbaikan sudah 2400 px, jadi ekspor tidak perlu lagi menyusutkan 12 MP. Hitam-Putih malah
yang tercepat. Yang benar-benar berubah karena sakelar cuma satu: **berkasnya ±17% lebih
besar** (bayangan yang diangkat ikut mengangkat bintik, dan halaman melewati satu putaran
JPEG lebih banyak).

**Biang yang sebenarnya: berapa banyak byte yang menyeberangi jembatan Capacitor, dan
berapa salinannya di memori.** Seluruh kerja JavaScript-nya cuma 2,9–6,7 detik di desktop;
sisanya ada di luar JS. PDF 20 halaman ±25–31 MB dikirim ke Java sebagai **satu string
base64 33–42 MB dalam sekali panggil** — plugin ini memang hanya menerima base64 di native —
dan string sebesar itu disalin ulang di tiap tahap: dibangun di JS, disalin `JSON.stringify`,
diurai lagi jadi `String` di Java, baru didekode jadi byte. Riwayat repo ini sendiri sudah
menunjuk ke sana: `DERIVED_QUALITY` diturunkan 25 Agustus 2026 justru karena menyimpan
**satu** halaman 4 MB lewat jembatan yang sama sudah jadi hal paling lambat di editor.

Yang diperbaiki:

- [x] **Halaman dialirkan satu per satu ke pdf-lib.** `buildPdf` sekarang menerima iterable,
  dan `exportPdf` memberinya generator. Dulu 20 blob **dan** 20 array byte ditahan bersamaan
  padahal `embedJpg` menyimpan salinannya sendiri — dokumen yang sama ada dua kali sebelum
  `save()` mengalokasikan yang ketiga.
- [x] **Salinan cuma-cuma dihapus.** `new Uint8Array(pdf)` hanya ada untuk memuaskan tipe
  `BlobPart`; diganti cast, hemat satu salinan penuh (±25 MB) persis saat heap paling tinggi.
- [x] **Penulisan berkas dipotong jadi irisan 1,5 MB** (`WRITE_CHUNK_BYTES` di
  `exportShare.ts`): `writeFile` untuk irisan pertama, `appendFile` untuk sisanya. Jumlah
  byte yang menyeberang **identik** (diukur: 41.943.040 karakter base64 di kedua cara,
  1,5 MB kelipatan 3 jadi tidak ada padding terbuang), tapi string terbesar yang pernah ada
  di memori turun dari ±42 MB jadi 2 MB.
- [x] **Penjaga berkas terpotong.** Ukuran di disk dicocokkan dengan ukuran blob sesudah
  irisan terakhir; kalau kurang, berkasnya dihapus dan ekspornya gagal terang-terangan —
  PDF terpotong yang "berhasil" jauh lebih berbahaya, apalagi di jalur Simpan ke HP. Kalau
  `stat` sendiri tidak bisa menjawab, penjaganya diam saja supaya tidak pernah membatalkan
  ekspor yang sebenarnya sehat.

**Yang belum bisa dipastikan dari mesin dev:** bahwa jembatan itu memang biang 60–90 detiknya.
Itu cuma bisa diukur di HP. Yang pasti terukur: byte yang menyeberang tidak bertambah,
puncak memorinya turun jauh, dan hasil PDF-nya byte-for-byte sama (dijaga tes
`builds the same document from a generator as from an array`).

**Di luar kendali aplikasi:** sesudah lembar Bagikan muncul, aplikasi penerima menyalin
sendiri berkas 25–31 MB itu. Itu sebabnya menekan **Batal** terasa jauh lebih cepat — yang
dilewati bukan ekspornya, tapi penyalinan oleh aplikasi tujuan.

### 7B — Auto-deskew & auto-crop presisi (menyusul)

- [x] Spec ditulis & disetujui Boss Ali 31 Agustus 2026:
  `docs/superpowers/specs/2026-08-31-fase7b-auto-deskew-design.md`. Plan:
  `docs/superpowers/plans/2026-08-31-fase7b-auto-deskew.md`.
- [x] **Alat luruskan manual — selesai.** Kuadrilateral 4-sudut bebas
  (`QuadOverlay`), koreksi perspektif lewat homografi pemetaan-balik
  (`perspective.ts` + `imageEditor.warpImage()`). Bukan tahap baru di rantai
  turunan — `straightenPage()` sejajar `cropPage`/`rotatePage`, menulis ke
  `edited` lewat `editPage()` yang sudah ada. Tidak ada `schemaVersion` baru.
- [x] Layar `StraightenScreen` menyela jalur impor (share sheet & rasterisasi
  PDF) sebelum `ReviewScreen` — satu halaman per satu, selalu menunggu
  konfirmasi (Luruskan/Lewati), tidak pernah auto-terap. Halaman scanner
  ML Kit tidak pernah masuk layar ini.
- [x] Tombol **Luruskan** permanen di editor, sejajar Potong/Putar — bisa
  dipakai ulang kapan saja lewat "Reset ke asli", sama seperti crop/rotate.
- [x] Semua tier, tanpa gerbang tier di mana pun di jalur ini.
- [x] **Tidak ada deteksi tepi otomatis di v1** — sudut awal selalu persegi
  inset 5%, bukan hasil analisis piksel. Fast-follow tercatat sebagai
  known gap, sama pola dengan noise-reduction di Fase 7A: seam-nya cuma
  mengganti titik asal sudut default, tidak menyentuh warpImage/
  straightenPage/data model apa pun.
- [x] Test bertambah 39 (total 938).

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] Impor foto miring dari galeri/aplikasi lain lewat share sheet →
  `StraightenScreen` muncul otomatis sebelum layar Tinjau, dengan sudut awal
  persegi inset — geser sudut ke tepi kertas sungguhan, tekan **Luruskan**,
  hasilnya tampak lurus di layar Tinjau berikutnya
- [ ] Impor PDF pihak ketiga (bukan buatan ScannApp sendiri) lewat share sheet
  → tiap halamannya juga melalui `StraightenScreen`
- [ ] Tekan **Lewati** untuk halaman yang sudah lurus → halaman masuk ke
  Tinjau apa adanya, tanpa terpotong
- [ ] Scan biasa lewat kamera pemindai (bukan impor) → **tidak pernah**
  masuk `StraightenScreen`, langsung ke Tinjau seperti sebelumnya
- [ ] Share baru datang saat sudah berada di layar Tinjau (sesi campuran) →
  hanya halaman baru itu yang memicu `StraightenScreen`, bukan yang sudah
  ada di daftar
- [ ] Tombol kembali (chevron) di `StraightenScreen` membatalkan **seluruh**
  impor yang sedang berjalan, bukan cuma halaman itu
- [ ] Tombol **Luruskan** permanen di editor (sejajar Potong/Putar) pada
  dokumen yang sudah tersimpan — bekerja dan bisa dibatalkan lewat **Asli**
- [ ] Waktu nyata meluruskan satu halaman 12 MP di HP dibanding proyeksi
  Task 3 (bench `warpBench.browser.test.ts`). **Proyeksi acuannya (Chromium
  desktop, 31 Agustus 2026):** halaman 3000×4000 kuadrilateral realistis, 4
  kali jalan, median **1151ms** (`1178/1124/904/1206`) → proyeksi mid-range
  ×4 = **~5 detik per halaman**. Keputusan Boss Ali saat itu: tetap resolusi
  sumber penuh, terima ~5 detik/halaman, tanpa batas resolusi atau tuas
  resampler tambahan (lihat plan Task 3 Step 2). Isi angka HP sungguhan di
  sini setelah diuji, untuk dibandingkan dengan proyeksi di atas.

## Fase 8 — Program Referral

- [x] UI generate & share kode referral — `ReferralScreen`, tombol Bagikan lewat `@capacitor/share`
- [x] Edge Function `process-referral-activation`
- [x] Tabel `referral_milestones` diisi dengan angka final: 5 orang→7 hari, 15 orang→25 hari, 30 orang→60 hari Pro — sudah ter-seed sejak migration `20260725093606_seed_referral_milestones.sql` (Fase 3), baru disadari & dicentang saat mulai Fase 8 (31 Agustus 2026)
- [x] Edge Function terjadwal `expire-pro-status` — diimplementasikan sebagai `pg_cron` job langsung, bukan Edge Function terjadwal (isinya cuma satu UPDATE, lihat spec Bagian 4.4)
- [x] UI progress referral (berapa orang sudah invite, menuju milestone berikutnya)
- [ ] Uji anti-abuse: 1 device/akun tidak bisa refer diri sendiri berkali-kali — **anti-abuse v1 sengaja terbatas** (email + activation saja, lihat spec Bagian 2 keputusan #2); device-fingerprint di luar cakupan Fase 8, jadi **known gap**, dicatat di Fase 9 di bawah

### Uji device (checklist manual sebelum dianggap tuntas)

Dites & dinyatakan berhasil oleh Boss Ali di HP fisik, 1 September 2026 — branch `fase8-program-referral` sudah di-merge ke `main` (fast-forward) setelah ini.

- [x] Dua akun test: A share kode ke B lewat tombol Bagikan, B daftar dengan kode itu terisi (form Daftar) sebelum konfirmasi email.
- [x] B scan 1 dokumen pertama kalinya → cek A menerima 7 hari Pro setelah 5 referral aktif ter-akumulasi (perlu 5 akun B berbeda untuk cek milestone pertama secara penuh; minimal cek 1 aktivasi tercatat & B sendiri dapat 1 hari Pro).
- [x] B yang sudah Pro bulanan sebelum diundang: aktivasi tidak menurunkan `pro_plan`-nya jadi `'referral'` (quota tetap 500MB/1GB sesuai plan aslinya).
- [x] Coba `PATCH` `first_scan_completed_at`/`referred_by`/`referral_code` langsung ke REST API Supabase sebagai user biasa (bukan lewat app) → harus ditolak RLS.
- [x] Cek `cron.job` di dashboard Supabase menunjukkan `expire-pro-status` aktif dan pernah berjalan (tunggu ≥1 hari, atau uji manual lewat `execute_sql`).

## Fase 9 — QA & Hardening

- [x] Uji limit merge dokumen Basic (20 halaman) & quota storage R2 per tier (100MB/500MB/1GB) sesuai angka final — sisi kode sudah dituntaskan 1 September 2026: `checkMergeAllowed`/angka 20 halaman sudah lama teruji, tapi titik penegakannya sendiri (`mergeDocuments`, yang benar-benar melempar error & tidak pernah menyentuh storage saat melebihi limit) belum punya test — ditambahkan di `documentMerge.test.ts`. Sisi quota R2 (`fitsInQuota`/`quotaBytesFor`/`QUOTA_BYTES`) sudah lama teruji pas dengan angka final, dan wiring-nya di `confirm-upload/index.ts` ditinjau ulang: ukuran diukur nyata dari R2 (bukan klaim client), bukan mock. **Uji hidup di project Supabase+R2 sungguhan selesai 1-2 September 2026**: `storage_usage.bytes_used` akun `demofimance@gmail.com` diset persis ke `quota_bytes` (100 MB, akun Basic) untuk memaksa kondisi penuh, lalu Boss Ali mengonfirmasi upload berikutnya ditolak 409 di HP fisik. Setelahnya `bytes_used` dikembalikan ke 666.870 byte — jumlah asli dari 2 dokumen yang sungguh tercadang (`Test 1` 326.679 + `Sof agent` 340.191) — lewat `execute_sql` langsung, bukan re-upload; diverifikasi dengan `SELECT` sebelum dan sesudah.
- [~] Uji job pembersihan object R2 yatim (tidak punya referensi di `scan_documents`) — job-nya sendiri **belum pernah ada** sampai 1 September 2026 (baris ini mewarisi kalimat dari `BACKEND_API_DESIGN.md` yang cuma catatan kaki, referensinya sendiri sudah salah alamat). Dibangun lewat brainstorm→spec→plan penuh (lihat `docs/superpowers/specs/2026-09-01-fase9-cleanup-orphan-r2-design.md`): Edge Function baru `cleanup-orphan-r2`, dipicu `pg_cron`→`pg_net` harian jam 03:00, ditutup lewat header `x-cron-secret` vs Edge Function Secret `CRON_SECRET`. Margin aman 24 jam sebelum object dianggap yatim, katup pengaman menolak hapus kalau kandidat >50% dari total (dengan lantai minimum 20 kandidat supaya bucket kecil tidak macet permanen). **Sudah dites hidup di produksi** (bukan simulasi) 1 September 2026: dipanggil manual dengan secret benar → 200, menemukan 1 kandidat yatim nyata (192 byte) dalam mode `LOG_ONLY`, tidak menghapus apa pun; dipanggil dengan secret salah → 401. Alasan `[~]` bukan `[x]`: job jalan dalam mode `LOG_ONLY` sampai Boss Ali meninjau beberapa hari log kandidat lewat Supabase Dashboard, baru menyalakan mode hapus nyata lewat `CLEANUP_ORPHAN_R2_DRY_RUN = "false"`.
- [~] Security review RLS policy (pastikan tidak ada cross-user data leak) — dimajukan sebagian, lihat di bawah
- [ ] **Anti-abuse referral device-level** — Fase 8 v1 cuma menegakkan email unik + `referred_by`/`first_scan_completed_at` dibekukan RLS. Satu orang masih bisa bikin banyak akun email untuk refer diri sendiri berkali-kali, dan `first_scan_completed_at` sendiri adalah laporan-sendiri client (bukan bukti scan tervalidasi server) — dampaknya kecil (maksimal 1 hari Pro per akun, sekali). Butuh plugin native baru (`@capacitor/device` atau setara), known gap yang disengaja — lihat `docs/superpowers/specs/2026-09-01-fase8-referral-design.md` Bagian 2 & 7.
- [ ] Nyalakan **Leaked Password Protection** di Supabase (Authentication → Policies) — cek password terhadap HaveIBeenPwned, satu-satunya temuan advisor yang tersisa per 26 Juli 2026
- [ ] Tinjau ulang setelan **Confirm email** sebelum rilis publik (lihat catatan Fase 3)
- [ ] Uji auto-pause Supabase free tier (setup keep-alive kalau perlu, mengingat riwayat kebijakan pause di Supabase/Appwrite)

### Sudah ditutup lebih awal (22 Agustus 2026)

Ditemukan saat code-review Fase 5, diperbaiki atas permintaan Boss Ali sebelum lanjut ke Fase 6. Rincian sebabnya di `docs/superpowers/specs/2026-07-26-fase4-backup-r2-design.md` Bagian 9.

- [x] **Kuota R2 bisa dilewati** — dari dua arah sekaligus: client bisa menulis sendiri `scan_documents.file_size_bytes` lewat RLS (`replacing` jadi raksasa), dan presigned PUT tidak membatasi panjang (klaim 1 KB, unggah 5 GB). Ditutup dengan mencabut policy tulis `scan_documents` (migration `20260821211059`) **dan** mengukur ukuran sebenarnya dari R2 di `confirm-upload`.
- [x] **`confirm-upload` bisa merebut dokumen orang lain** — upsert `onConflict: 'id'` dengan service role tanpa cek kepemilikan. Diganti update-lalu-insert yang atomik.
- [x] **`pro_plan` tidak dibekukan RLS** — user Pro Bulanan bisa menaikkan diri ke kuota 1GB tanpa membayar (migration `20260821211045`).

Yang **belum** dicakup dan tetap jadi tugas Fase 9: telaah menyeluruh seluruh policy (bukan cuma tiga temuan di atas), termasuk `profiles`, `referral_events`, dan `referral_milestones`, plus uji cross-user beneran dengan dua akun.

## Pencarian Dokumen — 2 September 2026

Diminta Boss Ali setelah seluruh fase & test selesai. Bagian pertama dari dua permintaan (referensi gambar 1 & 2 dari file manager Android); impor file dari folder/Google Drive dibahas terpisah sebagai subsistem baru — lihat brainstorm yang menyusul di bawah.

- [x] Kolom pencarian di tab Dokumen (`DocumentsScreen.tsx`), selalu tampil di bawah header selama tidak sedang di mode pilih — cocok sebagian & tanpa peduli huruf besar/kecil terhadap judul, lewat `filterEntriesByQuery()` baru di `src/lib/documentSearch.ts`
- [x] Ikut mencakup dokumen berstatus "Di cloud" (belum dipulihkan ke HP) lewat judul cadangannya, bukan cuma dokumen yang sudah ada page file-nya di HP
- [x] Disembunyikan (bukan disaring) saat mode pilih aktif — menghindari ambiguitas "Semua" berarti semua dokumen atau cuma yang lolos filter; banner cloud & tombol "Gabungkan Dokumen" tetap menghitung dari daftar penuh supaya tidak berkedip hilang saat mengetik
- [x] Pesan kosong baru saat pencarian tidak menemukan apa pun, beda dari pesan "Belum ada dokumen tersimpan" yang sudah ada untuk kondisi benar-benar kosong
- [x] Gaya kolom (bentuk pil, ikon di kiri, tombol × di kanan saat ada teks) memakai ulang `.field__input`/`.field__reveal` yang sudah ada di `auth.css`, bukan menduplikasi — temuan code-review sebelum commit
- [x] Test bertambah: `documentSearch.test.ts` (suite node, 6 test) + 5 test interaksi baru di `DocumentsScreen.browser.test.tsx` (total suite: 860 node + 158 browser)

Satu temuan code-review lain ditutup sebelum commit: fixture test baru sempat memakai `schemaVersion: 2` alih-alih `6` (`CURRENT_SCHEMA_VERSION` saat ini) — salah tempel dari pola lama, tidak tertangkap `tsc` karena `tsconfig.test.json` mewarisi `exclude` berkas test dari `tsconfig.app.json` (celah pra-ada, di luar cakupan perubahan ini, dicatat di sini supaya tidak hilang).

## Impor File Aktif (Gambar/PDF) di Menu Dokumen — 2 September 2026

Bagian kedua dari dua permintaan Boss Ali di menu Dokumen (bagian pertama:
pencarian nama dokumen, lihat section di atas). Desain:
`docs/superpowers/specs/2026-09-02-dokumen-impor-file-design.md`, plan:
`docs/superpowers/plans/2026-09-02-dokumen-impor-file.md`.

- [x] **`SharedImportPlugin.java` diperluas, bukan plugin baru.** Logika
      konversi URI→JPEG yang sudah ada (salin gambar / rasterisasi PDF lewat
      `PdfRenderer`) diekstrak jadi `convertUris()`, dipakai bersama oleh
      jalur pasif (share sheet) yang sudah ada **dan** jalur aktif baru
      (`pickFiles()` via `Intent.ACTION_OPEN_DOCUMENT` +
      `startActivityForResult`/`@ActivityCallback`)
- [x] **Tidak ada izin runtime baru** — SAF memberi akses baca per-URI lewat
      grant sistem, bukan `READ_EXTERNAL_STORAGE`
- [x] **Boleh pilih banyak file sekaligus** (`EXTRA_ALLOW_MULTIPLE`), dan
      picker sistem Android otomatis mengagregasi folder lokal + provider
      cloud terpasang (Google Drive, dst) tanpa integrasi API per provider
- [x] **Membatalkan picker bukan error** — resolve kosong, tidak ada toast,
      sama seperti membatalkan alur lain di aplikasi ini
- [x] **`App.tsx`: `ingestImportedFiles()` baru** memakai ulang persis
      logika "gambar masuk → antre tinjau" yang sebelumnya cuma dipakai
      listener share pasif — sekarang dipakai bersama oleh listener itu dan
      tombol impor baru, tidak ada logika yang digandakan
- [x] **Tombol ikon baru di header layar Dokumen**, sebelum tombol "Pilih",
      nonaktif selama proses impor berjalan
- [x] **Tier: semua tier, tanpa gerbang** — pola yang sama dengan
      reorder/filter/PNG/anotasi/pisah/share-pasif
- [x] **DOCX sengaja tidak dicakup** — dipisah jadi sub-proyek tersendiri,
      mewarisi keputusan 26 Agustus 2026
- [x] **Test bertambah: 6 di `sharedImport.test.ts` (node) + 3 di
      `DocumentsScreen.browser.test.tsx` (browser)** — total suite kini
      **866 node + 161 browser**, semuanya lolos
- [x] **Build native sungguhan lolos**, bukan cuma typecheck:
      `gradlew.bat assembleDebug` → `BUILD SUCCESSFUL`

**Empat temuan code-review ditutup sebelum commit terakhir:**

1. **Picker memicu App Open ad.** `pickFiles()` tidak memanggil
   `resumeTracker.leaveForOwnFlow()`, padahal picker itu activity terpisah
   persis seperti pemindai/share sheet/pembelian — user Basic yang menelusuri
   Google Drive lebih dari 5 detik akan disambut iklan layar penuh saat
   kembali. Ini yang dilarang CLAUDE.md Bagian 6, dan `appOpenGate.ts`
   menyebut "the file picker" di kontraknya sendiri. Ditutup + 2 test, yang
   dibuktikan menggigit (perbaikannya dilepas → test merah).
2. **`handleImportFiles` tanpa `catch`.** HP tanpa document provider menjawab
   `ACTION_OPEN_DOCUMENT` dengan `ActivityNotFoundException`, yang sampai ke
   JS sebagai rejection — tanpa `catch` jadi unhandled rejection dan tombol
   yang seolah tidak bereaksi. Sekarang bertoast, sama seperti panggilan
   native lain di file itu.
3. **Ikon impor berbentuk ikon ekspor.** `ImportIcon` awalnya memakai panah
   keluar dari baki — struktur yang sama persis dengan `ExportIcon`. Diganti
   folder + panah masuk; sengaja **bukan** bentuk baki, karena `ExportIcon`
   (Ekspor PDF) dan `DownloadIcon` (pulihkan baris cloud) dua-duanya juga
   tampil di layar Dokumen.
4. **Payload JS digandakan di sisi Java** antara `handleOnNewIntent` dan
   `handlePickResult`, padahal perubahan ini justru mengekstrak `convertUris`
   untuk alasan yang sama — diekstrak jadi `toPayload()`.

Temuan kelima (**guard `Array.isArray` di `pickFiles`**) **ditolak, bukan
dilewat**: JS dan Java ikut satu APK yang sama, jadi bentuk payload tidak bisa
melenceng antar versi seperti kontrak jaringan, dan setelah temuan #2 ditutup,
payload rusak pun berakhir sebagai toast, bukan crash. Guard tanpa jalan masuk
cuma menambah cabang yang tidak bisa diuji.

**Security-review:** tidak ada temuan. Yang diperiksa khusus — nama berkas
tujuan (`shared-<nanoTime>[-<index>].jpg`) diturunkan **sepenuhnya** dari
`System.nanoTime()` dan indeks loop; nama asli berkas dari provider tidak
pernah dibaca (tidak ada query `OpenableColumns` sama sekali), jadi tidak ada
jalan path traversal. Tujuan tulisnya `getCacheDir()` (cache privat aplikasi,
bukan penyimpanan eksternal), dan URI tanpa grant membuat `openInputStream`
melempar `SecurityException` yang sudah tertangkap batch-catch — jadi
dilewati sebagai `skippedCount`, bukan crash atau eskalasi hak.

**Catatan untuk plan berikutnya:** `npx tsc --noEmit` yang tertulis di plan
ini **tidak memeriksa apa pun** — `tsconfig.json` root memakai project
references dengan `"files": []`, jadi typecheck yang sebenarnya adalah
`npx tsc -b` (yang dipakai `npm run build`). Perbedaan ini sempat menyembunyikan
prop yang belum diteruskan di `App.tsx`.

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] Ketuk tombol impor → picker sistem Android terbuka, menampilkan folder
      lokal **dan** akun Google Drive yang terpasang di HP
- [ ] Pilih beberapa gambar sekaligus → semuanya masuk ke alur tinjau yang
      sama seperti hasil scan
- [ ] Pilih satu PDF pihak ketiga (bukan hasil ScannApp) → dirasterisasi
      jadi beberapa halaman, masuk ke alur tinjau
- [ ] Batalkan picker (tombol kembali/back gesture) → tidak ada toast, tidak
      ada perubahan pada layar Dokumen
- [ ] Impor saat sedang di tengah sesi tinjau (habis scan, belum simpan) →
      halaman baru nambah di akhir, bukan sesi baru
- [ ] **Akun Basic: pilih file lama-lama di Google Drive (>5 detik), lalu
      kembali → TIDAK boleh ada App Open ad.** Ini temuan review #1; kalau
      iklan tetap muncul, penanda alur internalnya tidak bekerja

## Perbaikan Uji Device — 2 September 2026

Dua temuan Boss Ali di HP fisik saat menguji "Impor File Aktif" & "Pencarian
Dokumen" (tangkapan layar), di luar dua checklist di atas.

- [x] **Banner iklan naik menimpa konten saat kolom pencarian difokus.**
      Banner AdMob adalah native view yang posisinya dihitung dari tinggi
      window, bukan layout WebView — saat keyboard terbuka, area terlihat
      menyusut dan banner ikut "naik", berakhir di tengah layar alih-alih
      diam di bawah. Ditutup dengan field baru `BannerContext.searchActive`
      di `bannerGate.ts`: `DocumentsScreen` melaporkan fokus/blur kolom
      pencarian ke `App.tsx` lewat prop `onSearchActiveChange`, banner
      disembunyikan selama kolom itu difokus (pola yang sama dengan
      `sheetOpen`). Test baru di `bannerGate.test.ts`.
- [x] **Logo aplikasi ditambahkan di pojok kiri atas dalam app** — badge
      header (Home/Dokumen/Pengaturan) sebelumnya memakai `ScanIcon`
      generik, bukan logo asli yang sudah dipakai untuk ikon Android &
      watermark PDF (`src/assets/logo.svg`, commit 509aca6). Komponen baru
      `AppLogo` menampilkan logo itu apa adanya (warna teal+hitam asli,
      tidak direcolor ke token aksen — konsisten dengan keputusan yang sama
      di watermark & ikon launcher); badge diberi latar putih (bukan
      `var(--acc)`) supaya kontrasnya konsisten di keempat tema.

Suite bertambah jadi 874 node + 161 browser test, semuanya lolos.
`npm run build` sukses.

**Belum diverifikasi di device fisik:**

- [ ] Ketuk kolom pencarian di tab Dokumen, keyboard terbuka → banner iklan
      hilang, tidak lagi menimpa konten
- [ ] Tutup keyboard (ketuk di luar kolom / tombol kembali) → banner muncul
      lagi seperti biasa
- [ ] Logo ScannApp tampil di badge kiri atas header Home/Dokumen/
      Pengaturan, bukan ikon kotak generik — kontrasnya cukup di tema yang
      sedang dipakai

---

## Crash Reporting (Client) — Fase 8.5b, 5 September 2026

Bagian B dari brainstorm "Hapus Akun & Crash Reporting" (Bagian A — hapus
akun — dikerjakan terpisah di cabang/PR `feat/hapus-akun`, sesuai aturan
satu subsistem per sesi CLAUDE.md Bagian 1; kalau PR itu sudah lebih dulu
gabung ke `main`, bagian ini perlu digabung manual dengan bagian A di
`TASKS.md`, bukan konflik sungguhan — keduanya cuma dua subseksi dari
brainstorm yang sama).

Backend tidak disentuh — log Edge Function sudah otomatis ada di Supabase
Log Viewer, cukup untuk kebutuhan pasif. Gap-nya murni di client: sebelum
ini, crash/force-close di HP user tidak meninggalkan jejak apa pun.

- [x] Project Firebase baru `scannapp-project` (akun `jangkahadevv@gmail.com`, dibuat & dikonfigurasi Boss Ali 5 September 2026), app Android terdaftar dengan package `com.newbeboys.scannapp` — cocok dengan `applicationId` yang sudah ada, tidak perlu ubah apa pun di sisi itu.
- [x] `@capacitor-firebase/crashlytics@8.5.1` diinstal — versi terbaru yang mendukung `@capacitor/core >=8.0.0` (proyek ini di `^8.4.2`). Nol dependency vulnerability baru: `npm audit` menunjukkan 3 isu, ketiganya dari `@capacitor/cli`/`vite` yang sudah ada sebelumnya, dilacak lewat `npm ls --all`.
- [x] Gradle: classpath `com.google.firebase:firebase-crashlytics-gradle:2.9.9` di root `build.gradle`, `apply plugin: 'com.google.firebase.crashlytics'` di app `build.gradle` — disatukan ke dalam blok `try/catch` yang sudah ada untuk `com.google.gms.google-services` (keduanya sama-sama butuh `google-services.json`, sama-sama tidak berguna diterapkan tanpanya).
- [x] **Google Services classpath ternyata sudah ada** (`com.google.gms:google-services:4.4.4` di root `build.gradle`, kemungkinan bawaan template Capacitor Android untuk Push Notifications) — tidak perlu ditambah, cuma `google-services.json`-nya yang sebelumnya belum ada.
- [x] **`android/app/google-services.json` di-commit langsung ke repo (termasuk yang publik `newbeboys/ScannApp`) — keputusan eksplisit, bukan diam-diam diasumsikan**, sesuai yang diminta prompt. Alasannya: Google sendiri menyatakan berkas ini tidak perlu dirahasiakan untuk app Android — isinya App ID + API key yang dibatasi package name, bukan kredensial server, dan berkas yang sama sudah ikut terbundel di dalam APK yang dikirim ke semua user (bisa diekstrak dari situ kapan saja oleh siapa pun). Pola yang sama persis dengan App ID/unit AdMob yang sudah lebih dulu di-commit (`CLAUDE.md` Bagian 7). **Sengaja TIDAK dipindah ke GitHub Secret + langkah decode di CI** — itu menambah titik gagal (kelas bug yang sama dengan riwayat `VITE_SUPABASE_URL/ANON_KEY` hilang saat build CI, commit `dd6a7f1`) untuk berkas yang memang tidak butuh dirahasiakan. Dicatat eksplisit di `CLAUDE.md` Bagian 7.
- [x] **Ditemukan & diperbaiki saat implementasi:** AGP 8+ berhenti men-generate `BuildConfig` secara default. Tanpa `buildFeatures { buildConfig true }` di app `build.gradle`, `compileDebugJavaWithJavac` gagal dengan "cannot find symbol: variable BuildConfig" — bukan class kosong, class-nya memang tidak ada sama sekali.
- [x] **`DebugBuildPlugin.java`** (native, custom) — mengekspos `BuildConfig.DEBUG` ke JS. **`import.meta.env.DEV` tidak bisa dipakai untuk ini**: `ci.yml`'s `assembleDebug` dan `build-aab.yml`'s `assembleRelease`/`bundleRelease` sama-sama menjalankan `npm run build` (Vite production) dulu baru `npx cap sync android` — payload JS yang masuk ke APK debug dan release itu identik, tidak ada pembeda level Vite di dalamnya. `BuildConfig.DEBUG` sebaliknya digenerate per build type Gradle dan tidak bisa dipalsukan dari JS — literally `false` di build yang dikirim CI ke Play Store.
- [x] `src/lib/crashlytics.ts` — `initCrashlytics()` (native-only, `setEnabled(true)` eksplisit; deteksi native crash sendiri sudah aktif sejak process start lewat ContentProvider Firebase, terlepas dari panggilan ini), `isDebugBuild()` (gagal ke `false`, bukan `true`, kalau plugin native error — supaya tombol uji coba gagal ke arah *sembunyi*, bukan muncul di build yang tidak bisa membuktikan dirinya debug), `triggerTestCrash()`. 9 unit test.
- [x] `initCrashlytics()` dipanggil di `main.tsx` (entry point sungguhan), fire-and-forget, sebelum React mount.
- [x] UI: baris "Picu Crash Uji Coba" di `SettingsScreen`, hanya render kalau `isDebugBuild()` sudah resolve `true` (state dimulai `false`, tidak optimistic) — dengan `confirm()` dulu sebelum memicu, sama seperti aksi lain di app ini yang tidak bisa dibatalkan (crash sungguhan = force-close). 3 browser test.
- [x] **Diverifikasi lewat `assembleDebug` sungguhan di mesin dev** (JDK 21 Temurin, `BUILD SUCCESSFUL` 18m24s — lebih lama dari baseline karena dependency Firebase baru pertama kali di-download): APK segar diperiksa langsung —
  - `android/app/build/generated/source/buildConfig/debug/.../BuildConfig.java` berisi `DEBUG = Boolean.parseBoolean("true")` — bukan diasumsikan dari nama task.
  - String `DebugBuildPlugin` ditemukan di `classes15.dex` hasil ekstrak APK — kelasnya sungguh ter-compile & masuk APK, bukan cuma ada di source.
  - `FirebaseCrashlytics`/`firebase.crashlytics` ditemukan di tiga file dex — SDK Crashlytics sungguh ter-bundle.
  - `android/app/build/generated/res/processDebugGoogleServices/values/values.xml` berisi `google_app_id`, `google_api_key`, `project_id` yang **persis sama** dengan `google-services.json` yang diberikan Boss Ali (`1:772046303206:android:d11fdeb29f8b4b8845f027`, `scannapp-project`) — bukti config yang benar yang terpakai, bukan config lain/kosong.
- [~] **`assembleRelease` gagal di mesin dev — bukan bug kode.** `hs_err_pid*.log` yang dihasilkan Gradle daemon menyebut eksplisit mesin ini cuma punya **3GB RAM fisik**; crash-nya "Native memory allocation (mmap) failed... system out of physical RAM" persis di task `mergeExtDexRelease`, setelah dependency Firebase menambah jumlah dex eksternal yang digabung sampai lewat batas heap daemon (`-Xmx1536m`, sudah ada sebelum task ini, bukan diubah). Debug build dengan dependency identik sukses (lihat poin di atas) — jadi ini murni keterbatasan RAM mesin dev, bukan kesalahan konfigurasi Gradle. **Dicatat di memory harness** (`android-build-env-jdk-sdk.md`) supaya sesi berikutnya tidak salah simpul jadi "Gradle-nya rusak".
- [x] **`assembleRelease`/`bundleRelease` diverifikasi sungguhan lewat CI** — `gh workflow run build-aab.yml --ref feat/fase8-5b-crash-reporting` (run [`33971699239`](https://github.com/newbeboys/ScannApp/actions/runs/33971699239)), langkah "Build signed AAB + APK" sukses **3m44s** di runner GitHub (RAM jauh lebih lega daripada mesin dev 3GB) — pembuktian yang representatif untuk build yang sungguh dikirim ke Play Store. `ci.yml` juga otomatis jalan atas push branch ini (run [`33971675975`](https://github.com/newbeboys/ScannApp/actions/runs/33971675975)): job "Web build & typecheck" (57s, termasuk 1047 test) dan "Android debug build" (`assembleDebug`, 3m56s) dua-duanya sukses. Ketiganya hijau — Gradle/Firebase wiring terbukti benar di lingkungan yang representatif, terlepas dari keterbatasan mesin dev.
- [ ] **Uji di device fisik/emulator — tidak bisa dikerjakan dari sesi ini.** Mesin dev tidak punya emulator Android terpasang (`Sdk/emulator` tidak ada) maupun device fisik tersambung (`adb devices` kosong). Boss Ali perlu: install APK debug hasil build (lokal atau dari artifact CI `ci.yml`), buka Pengaturan → scroll ke bawah → "Picu Crash Uji Coba" → konfirmasi → app force-close → buka lagi aplikasinya (laporan terkirim saat proses berikutnya start) → cek Firebase Console (project `scannapp-project` → Crashlytics) dalam beberapa menit.
- [ ] Setelah terverifikasi di device fisik, putuskan: hapus baris UI-nya, atau biarkan (gerbangnya sudah `BuildConfig.DEBUG` asli, bukan bisa dipalsukan dari JS, jadi aman ditinggal permanen sebagai alat uji ulang kapan pun perlu — direkomendasikan dibiarkan, tapi keputusan akhir tetap Boss Ali sesuai instruksi task).

**Suite setelah perubahan ini: 1047 node+browser test, semuanya lolos** (dijalankan sendiri, terisolasi dari build Gradle — percobaan pertama menjalankan keduanya bersamaan sempat membuat both proses crash kehabisan memori di mesin 3GB yang sama; itu bukan kegagalan test, cuma pelajaran untuk tidak membarengi dua proses berat di mesin ini).

**CI PR sempat gagal di trigger `pull_request` (run `33972024211`) — ditutup, `vitest.config.ts` ikut diperbaiki.** Commit yang sama lolos di trigger `push`-nya (soal timing, bukan soal kode): `PageViewerScreen.browser.test.tsx` gagal diimpor dengan "Vitest failed to find the runner", gara-gara Vite melakukan "optimized dependencies changed. reloading" di tengah suite jalan pada cache dingin (runner CI selalu segar) — dependency baru (termasuk `@capacitor-firebase/crashlytics`) ditemukan lambat oleh crawler Vite, memutus dynamic import file lain yang kebetulan sedang diproses saat itu.

Direproduksi lokal dengan `rm -rf node_modules/.vite` (memaksa cache dingin persis seperti runner CI), bukan diasumsikan dari baca log saja — gagal persis dengan pola sama, sekaligus menyingkap dependency **kedua** yang juga telat ditemukan: `pdf-lib` (statically imported, jadi bukan soal dynamic-vs-static import — crawler awal Vite memang tidak selalu menjangkau seluruh graph sebelum eksekusi test dimulai). Ditutup dengan menambahkan keenamnya (`react`, `react-dom`, `react-dom/client`, `react/jsx-dev-runtime` sudah ada; ditambah lima plugin Capacitor + `pdf-lib`) ke `optimizeDeps.include`, persis saran Vite sendiri di pesan errornya. Diverifikasi **tiga run cold-cache berturut-turut**, semuanya bersih tanpa satu pun "reloading" — bukan cuma "lolos sekali, kebetulan". Setelah dipush ulang, kedua trigger CI (`push` dan `pull_request`) lolos bersih.

**Di luar cakupan sesi ini (sesuai batas task):** notifikasi aktif
(email/Telegram/dsb), tracking kegagalan alur bisnis (upload/pembayaran/OCR
gagal) — topik terpisah yang belum dibahas.

---

## Status Keputusan

Semua angka bisnis & keputusan arsitektur untuk versi pertama sudah final (lihat PRD v2 Bagian 7 & CLAUDE.md Bagian 6-7). Tidak ada lagi open decision yang memblokir task di atas — implementasi bisa langsung jalan mengikuti urutan fase.

**Keputusan Boss Ali, 22 Agustus 2026:** flow pembelian Pro **tidak dibuka ke publik sebelum Fase 6 selesai**. Alasannya: hari ini Pro cuma benar-benar memberi 4 hal (bebas iklan, tanpa watermark, merge tanpa batas, kuota storage lebih besar), dan paywall sengaja hanya menjual itu. OCR, anotasi, dan tanda tangan di Fase 6 yang akan membuat harganya masuk akal. Kodenya sendiri sudah siap dan sudah diuji — yang ditunda hanya pembukaannya ke user.
