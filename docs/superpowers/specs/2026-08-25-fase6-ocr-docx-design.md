# Fase 6 potongan D — OCR on-device & Ekspor DOCX (Pro)

**25 Agustus 2026.** Potongan terakhir dari empat sisa Fase 6 (urutan di `TASKS.md`: A kontrol export ✓, B annotate + tanda tangan ✓, C batch scan/export ✓, **D OCR + DOCX**). Setelah ini Fase 6 selesai.

**Tier: Pro-exclusive, keduanya.** Ini menutup satu kontradiksi di dokumen sendiri. `CLAUDE.md` Bagian 6 menulis dua baris yang tidak bisa keduanya benar: "yang masih dijual Pro … dan nanti **OCR**", tapi juga "ekspor **DOCX** … saat dibuat bersama OCR, langsung **semua tier**". DOCX yang berguna isinya hasil OCR, jadi DOCX semua tier berarti mesin OCR-nya bocor lewat pintu belakang — atau Basic dapat DOCX berisi gambar tertempel, yang persis alasan DOCX ditunda dulu.

**Keputusan Boss Ali 25 Agustus 2026: OCR Pro, DOCX ikut Pro.** Baris "DOCX semua tier" dikoreksi di `CLAUDE.md`, `TASKS.md`, dan PRD sebagai bagian dari potongan ini.

Ini juga membalik arah tiga pembatalan gerbang Pro sebelumnya, dan itu disengaja. Pola lamanya — "dasar untuk semua, Pro untuk kendali & mutu" — tetap berlaku: reorder, filter, PNG, anotasi, dan pisah dokumen itu soal **akses ke dokumen sendiri**. OCR bukan akses; ia **mesin baru** yang mengubah gambar jadi teks, dan itulah satu-satunya hal di Fase 6 yang membuat harga Pro masuk akal.

---

## 1. Masalah

Dokumen hasil pindai hari ini adalah gambar. Tidak bisa dicari, tidak bisa disalin, tidak bisa diedit. Mencari satu kwitansi di antara tiga puluh berarti membuka satu per satu dan membacanya dengan mata.

Dua keluaran yang menyelesaikannya, dari satu mesin yang sama:

- **PDF bisa dicari** — gambarnya tetap seperti sekarang, tapi ada lapisan teks tak terlihat di atasnya. Cari-di-dokumen bekerja, salin-tempel bekerja, dan tampilannya sama persis.
- **DOCX** — teksnya saja, bisa diedit di Word/WPS/Google Docs.

---

## 2. Mesin OCR

### 2.1 `@capacitor-mlkit/text-recognition`, bukan Tesseract

Tiga kandidat, satu yang menang telak.

**ML Kit Text Recognition v2 lewat `@capacitor-mlkit/text-recognition@8.2.0` — dipakai.** Sekeluarga dengan `@capacitor-mlkit/document-scanner` yang sudah jadi mesin pindai kita, jadi bukan vendor baru. On-device, gratis, tanpa kuota. Modelnya dibundel di APK, jadi **tidak pernah butuh jaringan** — penting untuk aplikasi yang seluruh premisnya local-first.

**Tesseract.js (WASM) di WebView — ditolak.** Menariknya ia jalan juga di browser, jadi bisa diuji di Chromium seperti `renderMarks`. Tapi data latih `ind`+`eng` ±25 MB harus dibundel atau diunduh, satu halaman scan 12 MP butuh puluhan detik di HP kelas menengah, dan memori WASM-nya gampang membunuh WebView. Xiaomi T15 mungkin lolos; HP target kita tidak — dan baseline kita justru bilang kalau T15 terasa lambat, mid-range jauh lebih parah.

**Cloud OCR — ditolak.** Aturan Keras #4, dan biayanya.

### 2.2 Bentuk API-nya pas dengan yang dibutuhkan

`processImage({ path, script })` mengembalikan blok → baris → **elemen (kata)**, masing-masing dengan `boundingBox` dalam piksel. Itu persis dua hal yang dibutuhkan dua keluaran kita: kotak per kata untuk lapisan teks PDF, teks per blok untuk paragraf DOCX.

Android-nya memanggil `InputImage.fromFilePath(context, Uri.parse(path))`, jadi ia menerima `file://` URI apa adanya — yang sudah bisa kita ambil dari `Filesystem.getUri()`. Tidak ada berkas yang perlu disalin atau di-base64-kan.

### 2.3 Empat model skrip dibuang dari APK

Plugin itu menarik **kelima** model sekaligus. Diukur langsung dari Maven Google (versi 16.0.1):

| Model | Ukuran AAR |
|---|---|
| `text-recognition` (Latin) | 1,38 MB |
| `text-recognition-chinese` | 2,04 MB |
| `text-recognition-devanagari` | 2,02 MB |
| `text-recognition-japanese` | 2,63 MB |
| `text-recognition-korean` | 1,90 MB |

±8,6 MB untuk skrip yang tidak akan pernah dipakai aplikasi berbahasa Indonesia. Blok `exclude` di `android/app/build.gradle` membuangnya, dengan `group: "com.google.mlkit"` dan `module` masing-masing.

Kelas Java yang hilang hanya disentuh di cabang `Script.CHINESE` dan kawan-kawannya — cabang yang tidak pernah kita panggil, karena adapter kita memaku `Script.Latin`. R8 perlu `-dontwarn com.google.mlkit.vision.text.{chinese,devanagari,japanese,korean}.**` supaya build rilis tidak berhenti di peringatan kelas hilang.

Risikonya nyata tapi terlihat: kalau plugin di-update dan strukturnya berubah, **build rilis di CI yang berteriak duluan**, bukan HP user. Karena itu build AAB di CI jadi bagian dari definisi selesai untuk potongan ini.

**Pilihan yang ditolak:** menulis plugin Capacitor native sendiri (±80 baris Java) yang hanya memakai model Latin, atau varian *unbundled* yang menaruh model di Play services (0 MB di APK). Lebih ramping, tapi memulai kebiasaan memelihara kode Java sendiri di proyek yang selama ini murni web + plugin pihak ketiga — dan varian unbundled melanggar janji "tidak butuh jaringan".

---

## 3. Model data: `schemaVersion: 5`

### 3.1 Satu field, berisi path — bukan isinya

```ts
export interface ScanPage {
  original: string
  edited?: string
  filter?: PageFilter
  filtered?: string
  marks?: Mark[]
  annotated?: string
  /** Path ke JSON tata letak teks, diturunkan dari `filtered ?? edited ?? original`. */
  text?: string
}
```

Mengikuti pola `filtered`/`annotated` persis: berkas turunan hidup sebagai **berkas**, index cuma memegang path-nya.

Alasannya bukan kerapian. Satu halaman padat berisi ±500 kata; dua puluh halaman berarti ratusan KB JSON yang harus di-parse **setiap aplikasi dibuka**, cuma untuk menggambar daftar dokumen. Nama berkasnya diturunkan dari `original` (stabil, sekali dibuat), sama seperti nama berkas turunan lain — kalau diturunkan dari posisi array, reorder halaman akan membuat satu halaman menimpa berkas halaman lain.

### 3.2 Bentuk isinya

```ts
export interface OcrWord  { text: string; x: number; y: number; w: number; h: number }
export interface OcrLine  { text: string; words: OcrWord[] }
export interface OcrBlock { text: string; lines: OcrLine[] }
export interface PageText { blocks: OcrBlock[] }
```

Koordinat **dinormalisasi 0..1**, konvensi yang sama dengan `Mark`. Ini bukan gaya-gayaan: ekspor memperkecil halaman menurut level kompresi (Kecil 1600px, Maksimal 4000px), jadi koordinat piksel akan menggeser tiap kata begitu levelnya diganti.

Hanya **kata** yang membawa kotak. Blok dan baris cuma membawa teks, karena cuma itu yang dipakai: PDF butuh kotak per kata, DOCX butuh teks per blok. Menyimpan kotak di ketiga tingkat berarti tiga salinan informasi yang sama.

### 3.3 Sumber gambar untuk OCR

`annotationSource(page)` — helper yang **sudah ada**, artinya "halaman ini tanpa tintanya", yaitu `filtered ?? edited ?? original`.

Dua-duanya disengaja. Filter **ikut**: Hitam-Putih dan Magic Color justru menaikkan akurasi OCR, itu memang tugas mereka. Tinta **tidak ikut**: coretan pena dan tanda tangan di atas teks cuma jadi sampah huruf di hasilnya.

Ukuran piksel gambarnya dibaca dengan **`jpegSize.ts` yang sudah ada** — header JPEG saja, tanpa decode. Itu pembagi untuk normalisasi. Semua berkas turunan di proyek ini JPEG (`imageEditor.toBlob` default JPEG), jadi jalurnya seragam.

### 3.4 Apa yang membatalkan hasil OCR

| Perubahan | `text` |
|---|---|
| Crop | **dibuang** (berkasnya dihapus) |
| Putar | **dibuang** |
| Ganti filter | tetap |
| Menggambar / tanda tangan | tetap |

Crop dan putar menggeser kertas terhadap koordinatnya. Karena teksnya **tak terlihat**, salah tempat tidak akan pernah kelihatan oleh siapa pun — ia cuma diam-diam menghasilkan salin-tempel yang kacau dan pencarian yang menyorot tempat yang salah. Kegagalan yang tidak terlihat lebih buruk daripada yang terlihat.

Beda dengan goresan tinta, yang **dipetakan ulang** (`remapMarksForCrop`) alih-alih dibuang: goresan tidak bisa dibuat ulang oleh mesin, hasil OCR bisa — dan hasil OCR pada halaman yang sudah dicrop justru lebih baik daripada hasil lama yang dipetakan ulang.

Filter tidak menyentuh geometri sama sekali, jadi tidak ada alasan membuangnya. Tinta tidak memindahkan kertasnya.

### 3.5 Migrasi v4 → v5

`migratePage` menerima `text` hanya kalau ia string, sama seperti `filtered` dan `annotated`. Dokumen v4 di HP Boss Ali naik ke v5 tanpa satu piksel pun berubah.

---

## 4. `src/lib/ocr.ts` — satu-satunya yang tahu plugin itu ada

Pola yang sama dengan `documentScanner.ts`.

- `recognizePage(page)` — ambil `file://` URI dari `annotationSource(page)`, panggil plugin dengan `Script.Latin`, baca ukuran dari header JPEG, normalisasi tiap kotak.
- `recognizeDocument(doc, onProgress)` — **berurutan per halaman**, dan **menyimpan setelah tiap halaman**.

Yang terakhir sengaja berbeda dari filter dokumen, yang justru menulis index sekali di akhir. Alasannya jelas: memfilter dua puluh halaman itu hitungan detik, OCR dua puluh halaman itu hitungan menit. User yang keluar di tengah tidak boleh kehilangan sepuluh halaman yang sudah dikenali. Ongkosnya satu tulisan index per halaman, yang di sebelah ongkos OCR itu sendiri tidak terasa.

**Gerbang Pro ditegakkan di sini, bukan di UI** — pelajaran yang sama dengan `setPageMarks` dan `resolveCompressionLevel`. Bedanya kali ini gerbangnya memang dipertahankan.

Plugin tidak punya implementasi web. Adapter mengembalikan kegagalan yang bisa dibaca, persis seperti `documentScanner` menangani platform yang tidak didukung — bukan melempar error mentah ke layar.

---

## 5. Lapisan teks tak terlihat di PDF

### 5.1 Opsi baru di `buildPdf`

```ts
export interface BuildPdfOptions {
  watermark: boolean
  title?: string
  scannedAt?: string
  /** Tata letak teks per halaman, sejajar indeks dengan `jpegPages`. */
  text?: (PageText | null)[]
}
```

Kalau kosong, keluarannya **byte-identik** dengan hari ini. Itu diuji.

### 5.2 Cara menggambarnya

Per kata: kotak 0..1 dipetakan ke persegi gambar yang **sudah dihitung `buildPdf`** (`drawWidth`/`drawHeight`, sudah memperhitungkan margin 18pt dan A4 yang berputar jadi lanskap saat scan-nya melebar). Tidak ada matematika halaman yang ditulis dua kali.

Digambar dengan `setTextRenderingMode(TextRenderingMode.Invisible)` — Tr 3, cara baku yang dipakai semua alat OCR. Bukan `opacity: 0`, yang menghasilkan efek yang mirip tapi lewat ExtGState dan bukan cara pembaca PDF mengenali "ini lapisan OCR".

Dua detail yang menentukan kualitasnya:

- **`setCharacterSqueeze`** (operator `Tz`) menyetel lebar tiap kata supaya **pas** dengan kotaknya: `squeeze = lebarKotak / font.widthOfTextAtSize(kata, ukuran) * 100`. Tanpa ini, panjang teks tak terlihatnya asal-asalan — menyorot satu kata akan menyorot separuh kalimat, dan itu keluhan yang orang laporkan sebagai "OCR-nya rusak".
- **Penyaring WinAnsi.** `StandardFonts.Helvetica` memakai encoding WinAnsi; karakter di luar jangkauannya membuat `drawText` **melempar error dan menggagalkan seluruh ekspor**. ML Kit bisa mengembalikan apa saja. Jadi ada penyaring yang menggantinya dengan padanan ASCII kalau ada, membuangnya kalau tidak. Satu berkas rusak tidak boleh membunuh ekspor dua puluh halaman.

Tidak ada font yang dibenamkan: Helvetica ada di setiap pembaca PDF, dan seluruh Bahasa Indonesia masuk WinAnsi. Membenamkan font berarti menambah ratusan KB ke tiap berkas untuk sesuatu yang tak terlihat.

### 5.3 Cadangan cloud ikut membawanya

Beda dengan level kompresi, yang sengaja **tidak** diikutkan ke `buildPdfFile()` (keputusan Boss Ali 23 Agustus: satu pilihan di lembar Ekspor tidak boleh diam-diam menentukan konsumsi kuota R2).

Lapisan teks tidak punya masalah itu: beberapa KB, tidak menyentuh mutu gambar, tidak berarti terhadap kuota. Dan `cloudRestore.readBackup` tetap bekerja apa adanya — ia mencari XObject `DCTDecode`, tidak peduli ada teks di halaman atau tidak. Hasilnya PDF cadangan yang diunduh dari mana pun tetap bisa dicari.

---

## 6. Ekspor DOCX

### 6.1 Penulis ZIP sendiri, bukan dependency baru

`.docx` itu ZIP berisi XML. Empat berkas:

| Entry | Isi |
|---|---|
| `[Content_Types].xml` | tipe untuk `.rels`, `.xml`, dan override untuk document & core properties |
| `_rels/.rels` | menunjuk ke `word/document.xml` dan `docProps/core.xml` |
| `word/document.xml` | isinya |
| `docProps/core.xml` | judul & tanggal — sejajar `setTitle`/`setCreationDate` di PDF |

ZIP-nya ditulis dengan metode **STORE** (tanpa kompresi): local file header + central directory + EOCD + CRC32 per entry, tanpa zip64, tanpa data descriptor, nama entry ASCII semua.

STORE dipilih dengan sadar. DOCX berisi teks saja itu puluhan KB — deflate paling menghemat beberapa puluh KB, tidak sebanding dengan menambah dependency (`docx` menyeret jszip) atau menulis deflate sendiri. Entry ber-STORE sah sepenuhnya menurut OPC; Word membukanya.

Cap waktu entry diambil dari `createdAt` dokumen, bukan `Date.now()`. Keluarannya jadi **deterministik** — dua kali membangun dokumen yang sama menghasilkan byte yang sama, yang membuatnya bisa diuji dengan sungguh-sungguh.

### 6.2 Pemetaan isinya

- **Satu paragraf per blok OCR**, baris-baris di dalamnya digabung dengan spasi. Ini yang orang harapkan dari "scan jadi Word": paragraf yang bisa di-reflow saat diedit.
- Antar halaman: page break. Halaman yang tidak menghasilkan teks tidak menulis paragraf apa pun.
- Escaping `&`, `<`, `>`, `"` — plus membuang karakter kontrol C0. XML 1.0 menolak sebagian besar di antaranya, dan satu byte nyasar dari OCR membuat berkasnya ditolak Word tanpa pesan yang berguna.

**Risiko yang diakui:** menggabungkan baris dalam satu blok bisa salah untuk struk dan formulir, di mana tiap baris adalah butir tersendiri. Ini masuk daftar uji device. Kalau di dokumen sungguhan hasilnya jelek, ganti ke satu paragraf per baris cuma satu baris kode — tapi menebaknya sekarang tanpa melihat keluaran ML Kit di dokumen Indonesia yang sungguhan itu menebak.

### 6.3 Yang tidak ada di DOCX

Gambar halaman (keputusan Boss Ali: teks saja), deteksi tabel, deteksi kolom, gaya/heading. Dokumen keluarannya polos dan bisa diedit; yang butuh tampilan aslinya sudah punya PDF.

---

## 7. Lembar Ekspor & tier

`ExportFormat` jadi `'pdf' | 'jpg' | 'png' | 'docx'`.

- **PDF tidak dipecah jadi dua pilihan.** Kalau dokumennya punya teks, PDF-nya otomatis bisa dicari. Lapisan teksnya beberapa KB — memberi user pilihan kelima cuma menambah keputusan tanpa menambah kendali atas apa pun yang bisa ia rasakan.
- **DOCX** jadi format keempat, berlencana Pro. Kalau dokumennya belum di-OCR, DOCX tidak bisa dipilih — tapi dengan jalan keluar yang langsung ("Kenali teks dulu" + tombol yang membawa ke sana), bukan sekadar dimatikan tanpa penjelasan.
- Field level kompresi **disembunyikan** saat DOCX dipilih. Tidak ada gambar untuk dikompresi, dan menampilkan kontrol yang tidak berpengaruh itu berbohong.
- **Perkiraan ukuran DOCX tidak menebak.** JPEG/PNG harus meng-encode halaman pertama lalu dikali jumlah halaman, karena meng-encode semuanya terlalu mahal. DOCX cukup dibuat betulan — tanpa encode gambar, ongkosnya milidetik — lalu diukur. Angkanya persis.
- **Ekspor banyak dokumen** ikut menerima DOCX; dokumen yang belum punya teks dilewati dengan alasan tercatat. `exportDocumentsBatch` sudah punya jalur gagal-per-dokumen.
- Watermark tidak pernah jadi soal di sini: DOCX itu Pro, dan Pro tidak berwatermark. `shouldWatermark()` tidak disentuh.

**Tier yang lapse.** Kalau user Pro menjalankan OCR lalu turun ke Basic, teks yang sudah ada **tetap** dipakai saat ekspor. Gerbangnya di `recognizeDocument`, yaitu di titik mesinnya dijalankan — bukan di titik data miliknya sendiri dibaca. Menyandera hasil yang sudah dibayar itu beda dengan menjual mesinnya.

---

## 8. UI — "Kenali Teks" di layar Detail Dokumen

Satu baris aksi baru dengan lencana Pro (token `--pro-gold` yang sudah ada — tidak ada warna baru, CLAUDE.md 9.2).

- Saat jalan: progress "Halaman 3 dari 12", pola yang sama dengan filter dokumen.
- Tombolnya **memproses halaman yang belum punya teks**. Jadi ia sekaligus tombol "lanjutkan" setelah user keluar di tengah, dan tombol "perbaiki" setelah satu halaman di-crop dan kehilangan teksnya. Kalau semua halaman sudah punya teks, labelnya jadi "Kenali ulang" dan memaksa semuanya.
- Statusnya jujur: "Teks dikenali · 12 halaman" atau "9 dari 12 halaman".
- Akun Basic melihat tombolnya; menekannya membuka `UpgradeScreen` yang sudah ada.

### 8.1 Paywall bertambah satu baris

`CLAUDE.md` bilang paywall tidak perlu diubah — itu ditulis saat OCR belum ada. Sesudah potongan ini OCR jadi nyata, jadi `UpgradeScreen` bertambah baris kelima: **"PDF bisa dicari & ekspor Word"**.

Dan konsekuensi yang lebih besar: keputusan 22 Agustus — "flow pembelian Pro tidak dibuka ke publik sebelum Fase 6 selesai" — jadi **tidak lagi terhalang apa pun** sesudah potongan ini. Itu keputusan Boss Ali, bukan keputusan yang diambil kode ini. Ditandai di `TASKS.md`, tidak dieksekusi.

---

## 9. Cakupan & pembagian kerja

Terlalu besar untuk satu commit. Dua tahap, masing-masing berdiri sendiri dan punya commit + code-review + pembaruan `TASKS.md` sendiri:

| Tahap | Isi |
|---|---|
| **D1** | Model v5, `ocr.ts`, lapisan teks PDF, tombol "Kenali Teks", gerbang Pro, `exclude` Gradle. Setelah ini PDF sudah bisa dicari. |
| **D2** | Penulis ZIP, OOXML, DOCX sebagai format keempat, baris kelima di paywall. |

D2 bergantung penuh pada D1 (tidak ada teks, tidak ada DOCX), tapi D1 berguna sendirian.

**Berkas baru:** `src/lib/ocr.ts`, `src/lib/ocrLayout.ts` (normalisasi & penyaring — murni, node-testable), `src/lib/docxExport.ts`, `src/lib/zipWriter.ts`, plus berkas test masing-masing.

**Berkas disentuh:** `scanIndexMigration.ts`, `scanStorage.ts`, `documentEditing.ts`, `pdfExport.ts`, `documentExport.ts`, `exportEstimate.ts`, `ExportSheet.tsx`, `DocumentDetailScreen.tsx`, `UpgradeScreen.tsx`, `android/app/build.gradle`, `android/app/proguard-rules.pro`, `package.json` — plus koreksi baris DOCX di `CLAUDE.md`, `TASKS.md`, dan PRD.

---

## 10. Rencana test

Suite **node** (mayoritas — semua ini logika murni):

- Normalisasi kotak piksel → 0..1; `boundingBox` yang absen (opsional di API plugin) dilewati tanpa menggagalkan halaman; kotak di luar batas gambar dijepit
- Migrasi v4 → v5; `text` yang bukan string dibuang
- Crop & putar membuang `text`; filter & anotasi **tidak**. Dua-duanya diuji — test yang cuma memeriksa "dibuang" tetap hijau seandainya suatu saat semua edit membuangnya
- Penyaring WinAnsi: karakter di luar jangkauan tidak pernah menggagalkan ekspor
- Lapisan teks PDF: stream-nya benar-benar memuat operator `3 Tr` dan kata-katanya; **dan** PDF tanpa `text` byte-nya tidak berubah dari hari ini
- DOCX: CRC32 tiap entry dihitung ulang oleh implementasi terpisah di dalam test, offset central directory & EOCD konsisten, `word/document.xml` lolos parser XML sungguhan, escaping benar, jumlah page break = halaman − 1, keluaran deterministik untuk masukan yang sama

**Yang sengaja tidak jadi test permanen:** membuktikan ZIP-nya sah lewat pembaca luar. `tar -xf` membaca ZIP di Windows (bsdtar) tapi tidak di GNU tar milik runner CI. Test yang lulus di satu mesin dan gagal di mesin lain lebih buruk daripada tidak ada test sama sekali. Gantinya, **sekali saja saat pengerjaan**: berkasnya diekstrak dengan `tar.exe` dan hasilnya dicatat di `TASKS.md` sebagai bukti — persis seperti verifikasi Chromium waktu potongan kontrol export. Bukti sungguhannya tetap: DOCX-nya dibuka di WPS/Word di HP Boss Ali.

---

## 11. Daftar uji di HP (butuh Boss Ali)

- [ ] "Kenali Teks" pada dokumen 10+ halaman selesai tanpa aplikasi terasa beku; progress-nya bergerak
- [ ] PDF hasil ekspor dibuka di pembaca PDF HP → cari satu kata yang ada di dokumen, sorotannya **mendarat di kata yang benar**, bukan bergeser
- [ ] Salin-tempel satu kalimat dari PDF itu ke aplikasi catatan — hasilnya terbaca, bukan huruf acak
- [ ] Akurasi pada dokumen Indonesia sungguhan: kwitansi termal, surat ketikan, tulisan tangan (yang terakhir memang diharapkan jelek)
- [ ] Halaman yang di-crop setelah OCR kehilangan teksnya, dan tombolnya menawarkan mengenali sisanya
- [ ] Filter Hitam-Putih dulu lalu OCR → akurasinya naik atau setidaknya tidak turun
- [ ] DOCX dibuka di WPS/Word di HP: paragrafnya masuk akal, page break-nya di tempat yang benar
- [ ] Blok yang digabung jadi satu paragraf: **cek di struk/formulir** apakah penggabungan barisnya merusak — ini titik keputusan yang sengaja ditunda sampai lihat keluaran sungguhan
- [ ] Akun Basic: tombol "Kenali Teks" berlencana Pro dan membuka layar Upgrade; DOCX tidak bisa dipilih
- [ ] Ukuran APK rilis setelah `exclude` — tidak bertambah ±10 MB, hanya ±1,4 MB
- [ ] Build AAB di CI lolos setelah `exclude` + `-dontwarn`
