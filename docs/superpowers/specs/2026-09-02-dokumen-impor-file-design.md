# Impor File Aktif (Gambar/PDF) di Menu Dokumen

Disetujui Boss Ali, 2 September 2026, lewat brainstorming (klasifikasi
arsitektural, cakupan tipe, jumlah pilihan, penempatan tombol, dan desain
per bagian dikonfirmasi).

## 1. Latar belakang & cakupan

Boss Ali meminta dua hal untuk menu Dokumen: pencarian nama dokumen (selesai
& sudah commit, lihat commit `feat(documents): pencarian dokumen berdasarkan
nama`) dan opsi impor file dari folder HP/Google Drive/provider cloud lain
(referensi: tombol "Impor File" pada aplikasi file manager Android — gambar
2 dari Boss Ali).

ScannApp sudah punya jalur **pasif**: file yang di-*share* **dari** aplikasi
lain (WPS Office, CamScanner, galeri, dll) lewat Android share sheet
ditangkap `SharedImportPlugin.java` (`ACTION_SEND`/`ACTION_SEND_MULTIPLE`)
dan masuk ke alur tinjau yang sama dengan hasil scan baru. Yang belum ada
adalah jalur **aktif**: ScannApp sendiri yang membuka Storage Access
Framework (SAF) Android lewat `Intent.ACTION_OPEN_DOCUMENT` — yang secara
otomatis mengagregasi folder lokal *dan* provider cloud terpasang (Google
Drive, Dropbox, OneDrive, dst) tanpa ScannApp perlu integrasi API per
provider.

Diminta juga cakupan DOCX sekaligus dengan picker ini. Dipisah jadi
sub-proyek tersendiri (spec & plan terpisah, dikerjakan setelah ini) karena
bentuk teknisnya sangat berbeda — picker ini nyaris seluruhnya kerja Android
native, sementara DOCX (`mammoth.js` → tata halaman → rasterisasi) nyaris
seluruhnya kerja JS baru setara subsistem sendiri. Ini konsisten dengan
keputusan Boss Ali 26 Agustus 2026 yang sudah menjadikan impor DOCX task
tersendiri, ditunda sampai jalur ekspor sehat (sudah selesai 27 Agustus
2026). **Spec ini hanya mencakup Gambar + PDF.**

## 2. Arsitektur

**Prinsip utama: perluas `SharedImportPlugin.java`, jangan buat plugin
baru.** Logika konversi per-URI yang sudah ada di jalur pasif — salin
gambar ke cache aplikasi, atau rasterisasi PDF pihak ketiga halaman per
halaman lewat `PdfRenderer` bawaan Android (dibatasi `MAX_PDF_PAGES = 50`,
target sisi terpanjang `PDF_RENDER_TARGET_PX = 2400`) — persis yang
dibutuhkan jalur aktif ini. Plugin terpisah berarti menduplikasi seluruh
logika itu (atau menariknya ke kelas util bersama, lebih banyak berkas
untuk hal yang sama).

- Logika konversi yang sekarang inline di `handleOnNewIntent` diekstrak
  jadi method privat `convertUris(List<Uri> uris, ContentResolver resolver)`
  yang mengembalikan `{outputPaths, skippedCount}` — dipakai baik oleh jalur
  pasif yang sudah ada maupun jalur aktif baru. Perilaku per file (tipe
  MIME, penanganan `Exception`/`OutOfMemoryError`) **tidak berubah**, cuma
  dipindah lokasi.
- Method baru `@PluginMethod public void pickFiles(PluginCall call)`:
  membangun `Intent(Intent.ACTION_OPEN_DOCUMENT)` dengan
  `addCategory(Intent.CATEGORY_OPENABLE)`, `type = "*/*"`,
  `putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*",
  "application/pdf"})`, `putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)`, lalu
  `startActivityForResult(call, intent, "handlePickResult")` (API Capacitor
  8.4.2 yang sudah terpasang — dikonfirmasi lewat
  `node_modules/@capacitor/android/.../Plugin.java`).
- Method baru `@ActivityCallback private void handlePickResult(PluginCall
  call, ActivityResult result)`: kalau `resultCode != Activity.RESULT_OK`
  atau `result.getData() == null` (user membatalkan picker), `call.resolve`
  dengan `{paths: [], skippedCount: 0}` — **bukan** error, sama seperti
  membatalkan alur lain di aplikasi ini. Kalau ada data, ambil URI dari
  `getClipData()` (banyak file) atau `getData()` (satu file), jalankan lewat
  `importExecutor` (executor background yang sama dengan jalur pasif) →
  `convertUris()` → `call.resolve({paths, skippedCount})`.
- **Tidak ada izin runtime baru.** SAF memberi akses baca per-URI lewat
  grant sistem saat picker mengembalikan hasil — beda dari
  `READ_EXTERNAL_STORAGE`/`READ_MEDIA_IMAGES` yang butuh dialog izin
  terpisah. Ini salah satu alasan `ACTION_OPEN_DOCUMENT` dipilih dibanding
  pendekatan lain.
- `MainActivity.java` **tidak berubah** — `SharedImportPlugin` sudah
  terdaftar, method baru otomatis ikut terdaftar sebagai bagian plugin yang
  sama.

## 3. Alur data (JS)

- `src/lib/sharedImport.ts` (berkas yang sudah ada, bukan berkas baru)
  dapat satu export baru: `pickFiles(): Promise<SharedImportResult>`,
  memakai ulang tipe `SharedImportResult` yang sama dengan
  `onSharedFilesReceived`. Alasan satu berkas: keduanya membungkus plugin
  native yang sama dan bentuk hasilnya identik — bedanya cuma bentuk
  pemanggilan (event yang bisa datang kapan saja vs pemanggilan sekali
  jalan dari tombol), bukan konsep yang cukup beda untuk dipisah berkas.
  Di web/non-native, mengembalikan `{images: [], skippedCount: 0}` tanpa
  memanggil native apa pun — pola yang sama dengan `onSharedFilesReceived`.
- `App.tsx`: blok yang sekarang cuma dipakai listener `onSharedFilesReceived`
  (mendorong `images` ke `pendingPages`/`straightenQueue`, lalu toast kalau
  `skippedCount > 0`) diekstrak jadi fungsi `ingestImportedFiles(result:
  SharedImportResult)`. Listener share pasif memanggilnya persis seperti
  sekarang; handler tombol impor baru (`handleImportFiles`) memanggilnya
  juga setelah `pickFiles()` selesai — **tidak ada logika yang digandakan**.
  Pesan toast `skippedCount` (`'Sebagian file tidak bisa diimpor.'` /
  `'Tidak ada file yang bisa diimpor.'`) dipakai apa adanya, tidak ada teks
  baru untuk jalur ini.
- State baru `isImporting` (pola yang sama dengan `isScanning` di
  `HomeScreen`) — `true` selama `pickFiles()` berjalan, dipakai buat
  menonaktifkan tombol impor supaya tidak bisa dipencet dobel selagi picker
  atau rasterisasi PDF masih berjalan.

## 4. UI

- `DocumentsScreen.tsx`: tombol ikon baru di header (varian non-select),
  diletakkan sebelum tombol "Pilih". Ikon-only + `aria-label="Impor file"`
  (bukan ikon+label teks) — header sudah memuat badge, judul, dan dua
  kontrol lain (tier badge, "Pilih"); menambah teks lagi membuatnya sesak
  di layar sempit.
- Ikon baru `ImportIcon` di `Icons.tsx`: tray/kotak di bawah + panah masuk
  dari atas, gaya stroke sama dengan ikon lain (`viewBox 0 0 24 24`, stroke
  `currentColor`). Tidak ada warna baru (CLAUDE.md 9.2).
- Tombol nonaktif selama `isImporting` — cukup lewat `disabled`, tanpa
  aset spinner baru (konsisten dengan `HomeScreen` yang cuma mengganti teks
  label, bukan menambah animasi, selama `isScanning`).
- Disembunyikan saat `selectMode` aktif — tombol ini hanya dirender di
  cabang header non-select, sama seperti tombol "Pilih" itu sendiri.

## 5. Error handling & edge case

- **User membatalkan picker sistem** → resolve kosong, tidak ada toast
  (senyap, sama seperti membatalkan share sheet ekspor).
- **Sebagian/semua file gagal dikonversi** (korup, tidak terbaca, PDF
  >50 halaman terpotong ke 50) → jalur yang **sama persis** dengan share
  pasif: `skippedCount` naik, `convertUris()` melanjut ke file berikutnya
  (tidak ada satu file rusak yang menggagalkan seluruh batch), toast di
  `App.tsx` muncul lewat `ingestImportedFiles()` yang sudah ada.
- **Tombol dipencet dua kali cepat** → dicegah `disabled={isImporting}`,
  bukan debounce terpisah.
- **Sedang di tengah sesi tinjau (`pendingPages` sudah terisi)** saat impor
  dijalankan → `ingestImportedFiles()` mengikuti percabangan yang sudah ada
  di listener share pasif: kalau sedang meninjau, gambar baru ditambahkan
  ke akhir sesi yang berjalan; kalau tidak, sesi tinjau baru dimulai
  (`exitSplit()` dulu, sama seperti sekarang).

## 6. Testing

- `pickFiles()` di `sharedImport.test.ts` (suite node) — pola mock yang
  sama persis dengan test `onSharedFilesReceived` yang sudah ada di berkas
  itu (`vi.mock('@capacitor/core', …)`), menguji: hasil diteruskan &
  dikonversi lewat `Capacitor.convertFileSrc` sama seperti jalur pasif,
  kembali kosong di non-native tanpa memanggil plugin, `skippedCount`
  diteruskan apa adanya.
- `ingestImportedFiles()` di `App.tsx` — **tidak ada test otomatis baru**,
  konsisten dengan `App.tsx` yang sekarang memang tidak punya berkas test
  sendiri (logikanya sengaja tipis; kebenaran intinya sudah ada di
  `sharedImport.ts`/`documentSelection.ts`/dll yang teruji). Diverifikasi
  manual di HP, masuk daftar "belum diverifikasi di device fisik".
- Sisi native Java (`SharedImportPlugin.java`) **tidak ada test otomatis**
  — konsisten dengan berkas itu sendiri yang sekarang juga tidak
  punya test, kebenarannya diverifikasi lewat share sungguhan di HP.
  Verifikasi manual yang perlu Boss Ali lakukan di HP fisik:
  - Ketuk tombol impor → picker sistem Android terbuka, menampilkan folder
    lokal **dan** akun Google Drive yang terpasang di HP
  - Pilih beberapa gambar sekaligus → semuanya masuk ke alur tinjau yang
    sama seperti hasil scan
  - Pilih satu PDF pihak ketiga (bukan hasil ScannApp) → dirasterisasi jadi
    beberapa halaman, masuk ke alur tinjau
  - Batalkan picker (tombol kembali/back gesture) → tidak ada toast, tidak
    ada perubahan pada layar Dokumen
  - Pilih campuran (gambar + PDF sekaligus, kalau UI providernya
    mengizinkan) → semuanya masuk dalam satu sesi tinjau
  - Impor saat sedang di tengah sesi tinjau (habis scan, belum simpan) →
    halaman baru nambah di akhir, bukan sesi baru

## 7. Cakupan yang sengaja tidak dibangun (YAGNI / dipisah)

- **DOCX** — dipisah jadi sub-proyek sendiri (lihat Bagian 1), mewarisi
  keputusan 26 Agustus 2026 soal kesetiaan teks/struktur dasar.
- **Tipe file lain** (TXT, XLSX, dll) — tidak diminta, di luar cakupan.
- **Progress bar granular selama rasterisasi PDF** — jalur pasif yang sudah
  ada juga tidak punya ini (cuma `isImporting`/tombol nonaktif). Kalau
  nanti terasa lama di HP untuk PDF banyak halaman, ini kandidat perbaikan
  terpisah, sama seperti catatan performa Fase 6 lain di `TASKS.md`.
- **Plugin/berkas JS terpisah dari `SharedImportPlugin`/`sharedImport.ts`**
  — sengaja tidak dilakukan, lihat alasan reuse di Bagian 2 & 3.
