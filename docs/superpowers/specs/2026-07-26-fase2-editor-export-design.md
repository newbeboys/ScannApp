# Fase 2 — Editor Dasar + Export + Kompresi (Design Spec)

Status: **Disetujui Boss Ali** (2026-07-26)

Referensi: `TASKS.md` Fase 2, `PRD-aplikasi-scanner-dokumen.md` Bagian 3 & 8, `.env.example`.

---

## 1. Ruang Lingkup

Task dari `TASKS.md`:

- [ ] Fitur crop manual
- [ ] Fitur rotate halaman
- [ ] Export ke PDF
- [ ] Export ke JPG
- [ ] Kompresi otomatis (1 level standar untuk Basic)
- [ ] Watermark kecil di hasil export PDF (Basic only)
- [ ] Fitur merge dokumen (universal, limit 20 halaman Basic / unlimited Pro)

Dikerjakan di branch `feat/fase-2-editor-export`, 3 commit berurutan: (1) model data + editor, (2) export + kompresi + watermark, (3) merge + limit.

**Di luar cakupan (YAGNI, ditunda ke fase lain):** reorder halaman, filter B&W/magic color, slider kompresi manual, export DOCX/PNG, OCR — semua Fase 6 Pro. Upload ke R2 (Fase 4). Iklan interstitial setelah export (Fase 5). Flow beli Pro (Fase 5).

---

## 2. Model Data (`index.json` v1 → v2)

Saat ini `LocalScanDocument.pagePaths: string[]`. Karena hasil edit disimpan terpisah dari file asli (keputusan: "simpan asli + hasil edit", supaya ada "Reset ke asli"), struktur berubah:

```ts
interface ScanPage {
  original: string          // "scans/<id>/page-1.jpg" — tidak pernah diubah
  edited?: string           // "scans/<id>/page-1-edited.jpg" — ada kalau sudah diedit
}

interface LocalScanDocument {
  schemaVersion: 2
  id: string
  title: string
  createdAt: string
  pageCount: number
  pages: ScanPage[]
  sourceDocumentIds?: string[]   // diisi kalau dokumen ini hasil merge
}
```

**Migrasi otomatis:** dokumen v1 yang sudah ada di device Boss Ali (`pagePaths: string[]`, tanpa `schemaVersion`) dikonversi saat `readIndex()` dipanggil pertama kali: `pagePaths` → `pages: [{ original }]`, lalu index ditulis ulang sebagai v2. Tidak ada data hilang, tidak perlu aksi manual dari user.

Semua konsumen halaman (thumbnail, editor, export) memakai satu helper:

```ts
function resolvePage(page: ScanPage): string {
  return page.edited ?? page.original
}
```

"Reset ke asli" = hapus file `edited` dari disk + hapus field `edited` dari index.

---

## 3. Modul Baru

| File | Tugas | Bergantung pada |
|---|---|---|
| `src/lib/tier.ts` | Sumber tier sementara: `getCurrentTier()` selalu return `'basic'`. Fase 3 tinggal ganti isi fungsi ini ke Supabase; pemanggil tidak berubah. | — |
| `src/lib/exportLimits.ts` | Aturan tier murni (fungsi tanpa I/O, mudah diuji unit): `MAX_BASIC_MERGE_PAGES` (dari `import.meta.env.VITE_APP_BASIC_MAX_MERGE_PAGES`), `checkMergeAllowed(tier, pageCount)`, `shouldWatermark(tier)`. | — |
| `src/lib/imageEditor.ts` | Operasi canvas murni: `rotateImage(blob, 90\|180\|270)`, `cropImage(blob, rect)`, `compressImage(blob, opts)`. Terima Blob, kembalikan Blob. Tidak tahu apa-apa soal Capacitor. | Canvas API |
| `src/lib/pdfExport.ts` | Rakit PDF dari daftar JPEG + watermark opsional. Fungsi murni, jalan juga di Node (testable dengan Vitest). | `pdf-lib` |
| `src/lib/watermark.ts` | Definisi watermark: path vektor logo (dari `favicon.svg`, warna `#863bff`) + teks "ScannApp". | `pdf-lib` |
| `src/lib/exportShare.ts` | Tulis hasil export ke `Directory.Documents` + panggil share sheet Android. Native-only, tidak diuji unit. | `@capacitor/filesystem`, `@capacitor/share` |
| `src/lib/documentEditing.ts` | Orkestrasi: baca halaman → edit (`imageEditor`) → simpan varian `edited` → update index. | `scanStorage`, `imageEditor` |
| `src/lib/documentMerge.ts` | Gabung N dokumen jadi dokumen baru (salin file halaman ke folder baru), cek limit lebih dulu lewat `exportLimits`. | `scanStorage`, `exportLimits` |
| `src/lib/devSampleDocs.ts` | **Hanya aktif di `import.meta.env.DEV`.** Memuat gambar contoh dari `public/dev-samples/` sebagai `LocalScanDocument` palsu di memori, supaya alur editor/export bisa dicoba di browser tanpa Android. Tidak pernah ikut ke build produksi. | — |

`scanStorage.ts` (sudah ada) diperluas — bukan ditulis ulang — untuk: migrasi v1→v2, tulis/hapus varian `edited`, dan buat dokumen hasil merge.

---

## 4. Keputusan Teknis

**Library PDF — `pdf-lib`.** Dipilih atas `jsPDF` karena punya `drawSvgPath` (dipakai untuk logo watermark tanpa aset PNG terpisah), dan Fase 6 (OCR searchable PDF) butuh menyisipkan layer teks tak terlihat — kemampuan pdf-lib yang kuat, sedangkan jsPDF lebih terbatas di sana. Diimpor secara dinamis (`import()`) hanya saat user menekan tombol Export, supaya tidak menambah waktu buka app.

**Merge — salin file, bukan referensi.** Dokumen hasil merge berdiri sendiri (file halaman disalin ke folder barunya). Menghapus dokumen sumber setelah merge tidak merusak dokumen hasil merge. Trade-off: pemakaian disk sedikit lebih besar — dianggap wajar untuk app local-first di mana kebenaran data lebih penting daripada hemat beberapa MB.

**Ukuran halaman PDF — fit ke A4.** Setiap halaman di-render potret/lanskap otomatis mengikuti aspek gambar, dikontain di dalam A4 dengan margin 18pt. Konsisten dan enak dicetak/dikirim (default umum aplikasi scanner lain). Konsekuensi: scan dengan rasio tidak standar mendapat pita putih di sisinya.

**Watermark (Basic saja) — logo + teks "ScannApp".** Path vektor (bukan raster) dari `favicon.svg`, warna ungu `#863bff`, berdampingan teks "ScannApp". Posisi pojok kanan-bawah tiap halaman, tinggi ±11pt, opasitas 0,45, margin 20pt dari tepi. Vektor supaya tajam di segala zoom tanpa menambah aset gambar ke repo. Pro: watermark tidak muncul sama sekali (`shouldWatermark('pro') === false`).

**Kompresi Basic (1 level standar).** JPEG kualitas **0,75**, sisi terpanjang dibatasi **2400px** (~205dpi untuk A4 — teks masih tajam, ukuran file turun signifikan). Angka ini bukan angka bisnis dari PRD — ditetapkan sebagai keputusan implementasi teknis, bisa dikoreksi Boss Ali setelah melihat hasilnya di localhost. Pro mendapat slider kualitas manual di Fase 6 (tidak dikerjakan sekarang).

**Mode dev di web.** Karena scan asli hanya berjalan di Android, `devSampleDocs.ts` menyediakan dokumen contoh saat `import.meta.env.DEV` true, supaya seluruh alur crop → rotate → export PDF/JPG → merge bisa dinilai langsung di `localhost:5173` tanpa menunggu build APK. Di web (dev maupun produksi), export tidak memakai share sheet Android — hasilnya diunduh lewat mekanisme download browser biasa (`<a download>` dari Blob URL). Kode ini dipagari `import.meta.env.DEV` / deteksi `Capacitor.isNativePlatform()` sehingga tidak mengubah perilaku APK produksi.

---

## 5. Alur Layar

```
DocumentsScreen ──tap dokumen──▶ DocumentDetailScreen (grid halaman)
                 │                    ├──[Edit]───▶ EditorScreen (Crop / Putar / Reset)
                 │                    └──[Export]─▶ ExportSheet (PDF / JPG) ─▶ share sheet (native) / download (web)
                 └──[Gabungkan]──▶ MergeScreen (pilih & urutkan dokumen)
```

- **EditorScreen** — pratinjau halaman + toolbar `Crop | Putar | Reset ke asli`, tombol Simpan/Batal. Crop pakai overlay 4 sudut yang bisa digeser (drag handle di pojok, bukan library eksternal).
- **MergeScreen** — pilih beberapa dokumen (checkbox), penghitung halaman langsung terlihat (`14 / 20 halaman`). Basic yang melewati 20 halaman: tombol Gabungkan nonaktif + pesan jelas + info singkat "Pro tanpa batas" (tanpa tombol beli — itu Fase 5).
- **Export JPG multi-halaman** — tiap halaman jadi satu file JPG; di Android semuanya dibagikan sekaligus lewat satu share sheet (multiple attachment).

---

## 6. Izin & Konfigurasi Android

- `Directory.Documents` di Android adalah folder Documents publik (bisa diakses app lain) — sesuai kebutuhan "file muncul di file manager".
- `WRITE_EXTERNAL_STORAGE` hanya relevan di Android ≤10 (API ≤29). Ditambahkan di `AndroidManifest.xml` dengan `android:maxSdkVersion="29"`; `Filesystem.requestPermissions()` dipanggil hanya kalau `Capacitor.getPlatform() === 'android'` dan API level ≤29 — perangkat Android 11+ (yang dipakai Boss Ali untuk uji Fase 1) tidak akan dimintai izin apa pun.
- `file_paths.xml` yang sudah ada (`android/app/src/main/res/xml/file_paths.xml`) sudah mencakup `external-path` dan `cache-path`, cukup untuk `FileProvider` yang dipakai share sheet — tidak perlu diubah.
- Dependency baru: `@capacitor/share` (^8.0.1, cocok dengan `@capacitor/core` ^8.4.2 yang sudah dipakai), `pdf-lib` (^1.17.1).

---

## 7. Pengujian

Belum ada test runner di proyek ini. Ditambahkan **Vitest** (devDependency) untuk bagian logika murni yang paling berisiko salah diam-diam:

- `exportLimits` — batas 20 halaman Basic (dari env var), Pro tanpa batas, batas persis di angka 20 (boundary).
- `pdfExport` — jumlah halaman PDF sesuai jumlah halaman dokumen, watermark ada di Basic dan **tidak ada** di Pro.
- Migrasi index v1 → v2 — dokumen lama tidak rusak, `pageCount` tetap benar.
- `documentMerge` — urutan halaman hasil merge sesuai urutan dokumen dipilih, `sourceDocumentIds` terisi benar.

Bagian yang butuh hardware asli (crop di layar sentuh, share sheet Android, hasil kompresi visual di kondisi cahaya nyata) tetap diuji Boss Ali lewat APK dari GitHub Actions atau langsung di localhost (untuk bagian yang tidak native, lihat §4 mode dev web).

`npm run lint` (oxlint) dan `npm run build` (tsc + vite build) tetap wajib lulus sebelum commit, mengikuti CI yang sudah ada.

---

## 8. Ringkasan Keputusan yang Ditetapkan Sendiri (bukan angka bisnis PRD)

Boss Ali sudah menyetujui untuk lanjut dengan angka-angka berikut; dicatat eksplisit di sini supaya mudah dikoreksi kalau hasilnya di localhost tidak sesuai:

- Kompresi Basic: JPEG q=0.75, sisi terpanjang maks 2400px.
- PDF: fit ke A4, margin 18pt.
- Watermark: opasitas 0.45, tinggi ±11pt, margin 20pt dari pojok kanan-bawah.
- Library PDF: `pdf-lib`. Library share: `@capacitor/share`.
- Test runner baru: Vitest (unit test untuk logika murni saja).
- Mode dev-di-web ditambahkan untuk mempercepat review Boss Ali di localhost.
