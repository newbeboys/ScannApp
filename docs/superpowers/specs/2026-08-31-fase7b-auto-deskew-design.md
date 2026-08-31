# Fase 7B — Auto-deskew & auto-crop presisi (jalur impor)

**31 Agustus 2026.** Hasil brainstorm sesi ini, setelah Fase 7A (Perbaiki Pencahayaan)
selesai diverifikasi sebagian besar di device fisik. `TASKS.md` menandai 7B sebagai
"belum di-brainstorm; spec sendiri saat 7A selesai" — inilah spec itu.

**Keputusan Boss Ali yang mengikat seluruh dokumen ini (brainstorm 31 Agustus 2026):**

1. **Selalu konfirmasi user, tidak pernah auto-terap.** Deteksi/tebakan sudut cuma jadi
   titik awal yang bisa digeser; tidak ada jalur yang menyimpan hasil tanpa user melihat
   dan (bisa) menyesuaikan sudutnya dulu.
2. **v1 tidak membangun algoritma deteksi tepi otomatis sama sekali.** Yang dibangun
   adalah **kemampuannya**: alat luruskan 4-sudut bebas (bukan cuma persegi), dengan
   tebakan awal = batas gambar apa adanya (bukan hasil analisis piksel). Deteksi cerdas
   jadi known-gap tercatat untuk fast-follow, persis pola noise-reduction di 7A.
3. **Alat ini permanen di editor** (sejajar Potong/Putar), bukan cuma sekali muncul saat
   impor — konsisten dengan "tidak ada yang final" yang sudah dipakai crop/filter/anotasi.
4. **Rumus warp: pemetaan-balik per piksel (homografi asli)**, bukan pendekatan 2-segitiga
   — supaya tidak ada jahitan di diagonal, konsisten standar yang sudah dipegang di 7A.

---

## 1. Masalah

Pemindai ML Kit (`scannerMode: 'FULL'`) sudah melakukan deteksi sudut & koreksi
perspektif untuk halaman yang masuk lewat kamera pemindai — jalur itu **tidak** butuh
apa-apa dari 7B. Yang telanjang adalah **jalur impor**: foto dari share sheet aplikasi
lain (WPS, CamScanner, kamera bawaan) dan halaman hasil rasterisasi PDF pihak ketiga
(`SharedImportPlugin.rasterizePdfToCache`) masuk ke `pendingPages` apa adanya — kalau
fotonya diambil miring atau dari sudut, tidak ada satu pun cara di app ini untuk
meluruskannya. `CropOverlay` yang ada sekarang cuma persegi sumbu-lurus; ia bisa
memotong, tapi tidak bisa mengoreksi perspektif.

## 2. Kenapa bukan deteksi otomatis penuh di v1

Sudah dipertimbangkan tiga pendekatan saat brainstorm (dicatat di sini supaya tidak
ditanyakan ulang):

- **Deteksi tepi/kontur dari nol** (Canny/Hough/pencarian kuadrilateral) — tidak ada
  library CV di proyek ini dan `@capacitor-mlkit/document-scanner` tidak punya API
  berdiri sendiri untuk foto yang sudah ada di disk (satu-satunya API-nya,
  `scanDocument()`, adalah sesi kamera interaktif penuh). Membangunnya dari nol adalah
  proyek CV yang genap ukurannya, dengan hasil yang secara historis sulit dibuat andal
  tanpa OpenCV — dan menambah OpenCV bertentangan dengan disiplin ukuran APK yang sudah
  dipegang proyek ini (lihat pemangkasan 8,6 MB model OCR non-Latin).
- **Heuristik murah + fallback manual** — nilai tambahnya nyata (sudut awal sering sudah
  pas), tapi tetap pekerjaan CV nyata dengan hasil "kadang bagus kadang meleset" yang
  bisa membingungkan lebih dari membantu di sesi pertama.
- **Alat manual dulu, deteksi menyusul (dipilih).** Lubang yang sebenarnya di
  `TASKS.md` bukan "tebakannya tidak sempurna" — lubangnya adalah **tidak ada cara sama
  sekali** untuk meluruskan foto impor yang miring. Alat manual saja sudah menutup itu.
  Menambahkan tebakan cerdas nanti tidak mengubah UI/data model sama sekali — hanya
  mengganti titik awal 4 sudut dari "batas gambar" jadi "hasil deteksi", di satu fungsi.

## 3. Tempatnya di arsitektur yang sudah ada

**Bukan tahap baru di rantai turunan** (`original → edited → enhanced → filtered →
annotated`) dan **bukan field baru** di `ScanPage`. `documentEditing.editPage()` sudah
generik — `cropPage`/`rotatePage` cuma pembungkus tipis di atasnya:

```ts
async function editPage(
  doc, pageIndex,
  transform: (blob: Blob) => Promise<Blob>,
  remap: (marks: Mark[]) => Mark[],
): Promise<LocalScanDocument>
```

`straightenPage()` masuk sebagai pembungkus ketiga yang sama bentuknya:

```ts
export async function straightenPage(
  doc: LocalScanDocument,
  pageIndex: number,
  quad: Quad,
): Promise<LocalScanDocument> {
  return editPage(doc, pageIndex, (blob) => warpImage(blob, quad), (marks) =>
    remapMarksForWarp(marks, quad),
  )
}
```

Konsekuensinya gratis, sama seperti crop/rotate: `revertPage` ("Reset ke asli")
membatalkannya, `rebuildDerived` merender ulang enhance/filter/tinta di atas hasilnya,
dan ekspor/merge/cadangan cloud otomatis ikut lewat `resolvePage()` — tidak ada satu
titik lain yang perlu tahu tahap ini ada. **Tidak ada `schemaVersion` naik.**

### 3.1 Pra-simpan vs pasca-simpan

Dua titik pakai untuk satu mesin (`warpImage` + `Quad` + `remapMarksForWarp`):

- **Pra-simpan (jalur impor, `StraightenScreen`).** Belum ada `ScanPage`/dokumen untuk
  dilekati `editPage`. Warp diterapkan langsung ke blob mentah, dan hasilnya yang jadi
  `original` saat dokumen akhirnya disimpan — menyamakan posisi halaman impor dengan
  halaman scanner (yang `original`-nya memang sudah terkoreksi ML Kit sejak awal).
- **Pasca-simpan (editor, tombol "Luruskan").** `straightenPage()` lewat `editPage()`
  seperti di atas — hasilnya masuk `edited`, `original` tidak pernah tersentuh, "Asli"
  selalu bisa mengembalikan.

## 4. Alur layar: `StraightenScreen`

Pola yang sama dengan `SplitScanScreen` yang sudah ada — layar penuh terpisah,
dirender kondisional di `App.tsx` sebelum `ReviewScreen`, lewat flag baru (mis.
`straightening`), persis seperti `splitting` sekarang.

1. **`pendingPages` naik levelnya** dari `string[]` jadi array objek yang membawa asal
   halaman: `{ uri: string; source: 'scanner' | 'import' }[]`. Tidak ada perubahan
   native — `onSharedFilesReceived` dan `runScanner()` sudah dua titik panggil yang
   berbeda di JS, jadi asalnya sudah diketahui di titik itu tanpa perlu plugin native
   mengirim penanda apa pun.
2. Begitu ada halaman `'import'` yang belum dikonfirmasi, `StraightenScreen` muncul
   **sebelum** `ReviewScreen` — satu halaman per satu, `QuadOverlay` dengan 4 sudut
   awal berupa **persegi inset 5% dari tiap tepi** (angka yang sama dengan `FULL_CROP`
   yang sudah dipakai mode crop) supaya gagang sudut mudah dipegang tanpa memotong isi
   secara default — bukan hasil analisis piksel apa pun.
3. Tombol **Luruskan** (menerapkan warp dari posisi sudut sekarang) dan **Lewati**
   (halaman dianggap sudah lurus, dilanjutkan apa adanya) — keduanya maju ke halaman
   berikutnya.
4. Halaman `'scanner'` tidak pernah masuk layar ini — langsung ke `ReviewScreen` seperti
   sekarang, tanpa perubahan perilaku.
5. Sesi campuran (share baru masuk saat sudah di `ReviewScreen`): hanya halaman `import`
   yang **baru datang dan belum dikonfirmasi** yang memicu `StraightenScreen`; yang
   sudah dikonfirmasi/discan sebelumnya tidak diulang. Dilacak lewat satu antrean indeks
   (`straightenQueue: number[]`) berisi indeks `pendingPages` yang masih menunggu
   keputusan — Luruskan maupun Lewati sama-sama mengeluarkan indeksnya dari antrean;
   halaman impor baru yang datang lewat `onSharedFilesReceived` menambahkan indeksnya
   sendiri ke ujung antrean. Layar ini tampil selama antrean tidak kosong.
6. Setelah semua halaman `import` yang tertunda diputuskan, alur lanjut ke
   `ReviewScreen` seperti sekarang — tidak berubah sama sekali dari titik itu.

**Tidak perlu `AbortController`/pembatalan batch** seperti Perbaiki Pencahayaan — ini
interaktif satu halaman per satu (user menekan Luruskan/Lewati tiap halaman), bukan
proses latar untuk puluhan halaman sekaligus. Lingkupnya sengaja lebih sempit dari 7A
di titik ini.

## 5. Matematika perataan

### 5.1 Kenapa pemetaan-balik, bukan 2-segitiga

Dua cara umum melakukan koreksi perspektif di Canvas 2D tanpa WebGL/library:

1. **Pemetaan-balik per piksel** — hitung matriks homografi 3×3 dari 4 pasang titik
   (sudut kuadrilateral sumber → sudut persegi hasil), lalu untuk tiap piksel hasil,
   baca baliknya lewat matriks itu ke koordinat sumber, ambil sampel bilinear. Proyeksi
   sungguhan, bukan pendekatan.
2. **Potong jadi 2 segitiga, `setTransform` affine per segitiga** — lebih murah, tapi
   meninggalkan **jahitan** di garis diagonal pada foto dengan perspektif nyata,
   terutama tembus di teks yang memotong garis itu.

**Dipilih cara 1**, konsisten dengan standar yang sudah dipegang di 7A — jalur
pendekatan gain 16-titik ditolak justru karena meninggalkan pita terang yang terlihat
di tepi bayangan (lihat `TASKS.md` Fase 7A Task 3); jahitan segitiga di sini masalahnya
sama persisnya, di halaman yang isinya justru teks.

### 5.2 Ukuran keluaran

Lebar/tinggi target diturunkan dari **panjang tepi kuadrilateral itu sendiri** di
piksel sumber (rata-rata sisi atas & bawah untuk lebar, rata-rata sisi kiri & kanan
untuk tinggi) — bukan dipaksa sama dengan foto aslinya, supaya rasio hasil mengikuti
bentuk kertas fisik, bukan bingkai foto yang miring.

### 5.3 Kuadrilateral degenerate

Homografi dari 4 titik nyaris segaris (atau kuadrilateral yang sisi-sisinya
bersilangan) singular atau nyaris singular — `computeHomography` harus menolaknya
secara eksplisit (bukan menghasilkan `NaN`/`Infinity` diam-diam yang lolos ke
`putImageData`). `QuadOverlay` sendiri sudah menahan sebagian besar kasus ini dengan
penjaga luas minimum (pola yang sama dengan `MIN_SIZE` di `CropOverlay`), tapi lapisan
matematika tetap harus aman berdiri sendiri — komponen UI bukan satu-satunya penjaga.

## 6. Sisi kanvas: `warpImage()`

Di `imageEditor.ts`, mengikuti pola `cropImage`/`filterImage`: modul ini yang punya
kanvas, `perspective.ts` yang punya homografinya (murni, tanpa DOM — pola sama dengan
`enhance.ts`).

```ts
// src/lib/perspective.ts — matematika murni, tanpa DOM, pola sama dengan enhance.ts
export interface Point {
  x: number
  y: number
}

// Koordinat ternormalisasi 0..1 relatif isi gambar, sama seperti CropRect —
// bukan piksel absolut, supaya cocok dipakai lewat overlay yang di-drag di
// layar dengan skala berapa pun.
export interface Quad {
  topLeft: Point
  topRight: Point
  bottomLeft: Point
  bottomRight: Point
}

// src/lib/imageEditor.ts — sisi kanvas, pola sama dengan cropImage/filterImage
export async function warpImage(blob: Blob, quad: Quad): Promise<Blob>
```

**Gerbang pengukuran yang sama disiplinnya dengan 7A Bagian 8** — ukur di Chromium pada
foto 12 MP sungguhan sebelum detail UI progres/nyaman-tidaknya dirancang lebih jauh.
Bedanya dengan 7A: ini operasi **sekali per halaman saat impor** (dan sesekali lagi
kalau user membuka "Luruskan" di editor), bukan proses berulang tiap ekspor — jadi
bujet waktunya tidak seketat gerbang 30 detik/20 halaman 7A, tapi tetap **diukur, bukan
ditebak**. Kalau ternyata berat, taktik yang sudah terbukti di 7A (batasi sisi
terpanjang lewat `ENHANCED_EDGE`/`decodeCapped`, `resamplerFor()` menurut rasio
penyusutan) siap dipakai ulang tanpa riset baru.

## 7. UI editor

**Baris geometri per-halaman**, bukan baris dokumen — sejajar Potong/Putar/Asli di
`EditorScreen` (baris pertama `.editor-actions`, lihat kode saat ini), karena
"Luruskan" sama sifatnya dengan crop/rotate: operasi geometri satu halaman, bukan
operasi seluruh dokumen seperti Filter/Cahaya/Urutkan.

- Tombol baru **"Luruskan"** di baris itu, ikon baru `StraightenIcon` (mengikuti pola
  `CropIcon`/`RotateIcon` yang sudah ada di `Icons.tsx`).
- Menekannya membuka `QuadOverlay` di atas halaman — sejajar cara `CropOverlay` dibuka
  oleh `startCrop`.
- Tombol **Terapkan** memanggil `straightenPage()`; **Batal** menutup tanpa mengubah
  apa pun (pola yang sama dengan mode crop yang sudah ada).
- Tidak ada badge Pro, tidak ada jalur upgrade — **semua tier**, mengikuti pola yang
  sudah berlaku untuk crop/rotate/filter di app ini; tidak ada argumen biaya yang bisa
  dipakai untuk menahannya di belakang paywall (ini matematika, sama seperti 7A).

## 8. Sengaja di luar cakupan v1

- **Deteksi tepi otomatis.** Ditunda sebagai fast-follow, lihat Bagian 2. Titik masuknya
  nanti: ganti titik awal `QuadOverlay` dari "batas gambar" jadi hasil satu fungsi
  deteksi — tidak menyentuh `warpImage`, `straightenPage`, `StraightenScreen`, atau
  data model apa pun di sini.
- **Halaman hasil rasterisasi PDF berkualitas rendah/miring dari sisi rendering PDF
  itu sendiri** (mis. PDF hasil scan lain yang sudah miring di dalam PDF-nya) — tetap
  masuk `StraightenScreen` seperti foto biasa, tidak ada penanganan khusus.
- **Pembatalan batch** — lihat Bagian 4, sengaja tidak dibangun; alurnya interaktif per
  halaman.

## 9. Rencana pengujian

| Lapis | Suite | Yang dibuktikan |
|---|---|---|
| Homografi (`perspective.ts`) | node | Kuadrilateral = persis batas gambar → transformasi identik; titik sampel di hasil cocok hitungan tangan untuk kuadrilateral miring yang diketahui; kuadrilateral degenerate ditolak, tidak menghasilkan `NaN`/`Infinity` |
| `warpImage()` | browser (Chromium) | Keluaran JPEG sungguhan (`ff d8 ff`); piksel sampel pada gambar uji kotak-kotak cocok pemetaan yang diketahui; ukuran keluaran mengikuti panjang tepi kuadrilateral |
| `remapMarksForWarp()` | node | Tinta ikut berpindah sesuai homografi yang sama, pola sama dengan test `remapMarksForCrop`/`remapMarksForRotation` yang sudah ada |
| `QuadOverlay` | browser (`vitest-browser-react`) | Penjaga luas minimum menahan kolaps/silang sendiri, drag tiap sudut independen |
| Bench | browser | Milidetik per halaman 12 MP untuk gerbang Bagian 6, dicatat ke `TASKS.md` seperti pola 7A |
| `straightenPage()` / orkestrasi | node | Warp masuk `edited` (bukan `original`) di jalur editor; enhance/filter/tinta dirender ulang lewat `rebuildDerived`; "Asli" membatalkannya |
| `StraightenScreen` + `pendingPages` bertipe baru | browser/node campuran sesuai isinya | Halaman `scanner` tidak pernah masuk layar ini; sesi campuran hanya menanyakan halaman `import` yang baru; hasil warp pra-simpan menjadi `original` |

Tidak ada canvas yang di-mock — `CLAUDE.md` Bagian 4.

## 10. Seam untuk deteksi otomatis nanti

Ketika/kalau deteksi tepi otomatis dibangun (klasik atau model), yang berubah hanya
titik asal 4 sudut default `QuadOverlay` saat `StraightenScreen`/tombol Luruskan
dibuka — dari "batas gambar" jadi hasil satu fungsi deteksi yang dipanggil sekali per
halaman. `warpImage`, `straightenPage`, data model `pendingPages`, dan seluruh
penyimpanan tidak berubah. Ini pola seam yang sama dengan `enhancePage()` di 7A.
