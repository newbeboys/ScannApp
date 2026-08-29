# Fase 6 potongan C — Batch Scan & Batch Export (Pro)

**25 Agustus 2026.** Potongan ketiga dari empat sisa Fase 6 (urutan di `TASKS.md`: A kontrol export ✓, B annotate + tanda tangan ✓, **C batch scan/export**, D OCR + DOCX).

**Tier:** Pro-exclusive, sesuai PRD Bagian 3. Boss Ali menegaskan ini 25 Agustus 2026 — baris ini **tidak** ikut dipindahkan ke "semua tier" seperti reorder/filter/PNG. Alasannya: tiga baris yang dipindahkan itu soal **akses** ke dokumen sendiri (melihat, mengurutkan, memfilter, memilih format) — kebutuhan dasar. Batch bukan akses, melainkan **kecepatan saat volumenya banyak**, dan itu profil user yang membayar. Basic tetap bisa melakukan semuanya, hanya satu per satu.

---

## 1. Masalah

Dua keluhan yang berbeda ujungnya, satu baris di PRD.

**Di sisi masukan:** memindai setumpuk kwitansi berarti melewati Home → pemindai → Tinjau → Simpan, sekali untuk **tiap lembar**. Tiga puluh kwitansi = tiga puluh putaran penuh.

**Di sisi keluaran:** mengirim lima dokumen ke akuntan berarti membuka lima layar detail, lima lembar Ekspor, lima share sheet.

Keduanya sudah mungkin hari ini. Yang tidak ada cuma jalan pintasnya.

## 2. Cakupan & urutan pengerjaan

Potongan C dipecah jadi **dua fase dengan checkpoint di antaranya** (keputusan Boss Ali, pendekatan A):

| Fase | Isi |
|---|---|
| **C1** | Mode pilih di tab Dokumen + batch export PDF (Pro) + hapus banyak (semua tier) |
| **C2** | Pisah satu sesi pindai jadi beberapa dokumen (Pro) |

Keduanya tidak berbagi kode sama sekali — satu di sisi keluaran, satu di sisi masukan. Tiap fase punya commit, code-review, dan pembaruan `TASKS.md` sendiri. Spec-nya tetap satu karena ini satu baris PRD dengan satu keputusan tier.

**Yang sudah diputuskan dan tidak dibuka lagi:**

- **"Batch scan" = pisah satu sesi jadi banyak dokumen**, bukan mode pindai beruntun. Memindai banyak halaman jadi satu dokumen sudah bisa lewat tombol "Tambah" di layar Tinjau.
- **Batch export = PDF saja, 1 dokumen = 1 berkas.** Lima dokumen jadi lima PDF. JPG/PNG sengaja tidak masuk: lima dokumen dua puluh halaman dalam JPG adalah seratus berkas sekaligus ke folder Documents dan ke share sheet. Yang butuh gambar tetap lewat ekspor satuan. Membungkusnya jadi ZIP juga ditolak — dependency baru masuk APK, dan di Android kebanyakan orang tidak punya cara mudah membuka ZIP, jadi hasilnya justru lebih sulit dipakai.
- **Merge tidak ikut pindah ke mode pilih.** Urutan mencentang di layar Gabungkan itu bermakna — ia jadi urutan halaman hasilnya, makanya centangnya bernomor. Mode pilih biasa tidak punya urutan. `MergeScreen` tetap berdiri sendiri.

---

## 3. Fase C1 — Mode pilih & batch export

### 3.1 Dua jalan masuk, sengaja

- **Tekan lama** sebuah baris dokumen (±450 ms, toleransi geser 10 px) → masuk mode pilih, baris itu langsung tercentang.
- **Tombol "Pilih"** di kanan atas tab Dokumen.

Tombolnya bukan pemborosan: tekan lama tidak terlihat. Tanpa penanda kasatmata, fitur ini hanya ditemukan orang yang kebetulan menahan jarinya. Keluar lewat "Batal" atau tombol kembali Android.

**Jebakan yang sudah diantisipasi:** setelah tekan lama terpicu, `click` dari jari yang sama masih menyusul dan akan **membuka dokumennya**. Tekan lama menyalakan penanda yang menelan satu klik berikutnya. Ada test browser khusus untuk ini — pelajaran dari potongan sebelumnya, waktu tombol panah di layar pratinjau ternyata tidak pernah berfungsi karena `setPointerCapture` mengalihkan `pointerup`.

### 3.2 Baris cloud tidak bisa dipilih

Dokumen yang hanya ada di cloud tidak punya berkas halaman di HP — tidak ada yang bisa diekspor maupun dihapus dari situ. Barisnya jadi redup dan tidak menerima centang; tekan lama di atasnya memunculkan toast **"Pulihkan dulu ke HP sebelum bisa dipilih."** Diam saja akan terbaca sebagai aplikasi rusak.

### 3.3 Di mana state seleksi tinggal

**Daftar terpilih hidup di `App.tsx`**, dan `DocumentsScreen` tetap presentasional murni seperti sekarang.

Pola `MergeScreen` — yang memegang seleksinya sendiri — sempat jadi kandidat, tapi tidak cocok di sini: `MergeScreen` **hilang dari layar** begitu aksinya jalan, jadi state-nya ikut mati bersama layarnya. Tab Dokumen tetap terpasang selama lembar batch bekerja, jadi seleksinya harus dibereskan oleh pihak yang juga memiliki lembar itu. Menaruhnya di layar berarti `App` harus mengabari layar kapan harus mengosongkan diri — lewat prop kunci-reset atau `resolve` promise yang dititipkan di `ref`, dua-duanya lebih rumit daripada satu `useState` di tempat semua state lain sudah tinggal.

Yang tetap di dalam komponen hanyalah pewaktu tekan lama dan penanda penelan klik — itu urusan DOM, bukan state aplikasi.

Perilaku setelah aksi selesai:

- **berhasil** → `App` mengosongkan seleksi dan keluar dari mode pilih
- **gagal** → seleksinya **dipertahankan**, supaya user tidak mencentang ulang dua belas dokumen hanya untuk mencoba lagi

Logika himpunan pilihnya keluar ke `lib/documentSelection.ts` sebagai fungsi murni — centang/lepas, pilih semua, kosongkan, dan ringkasan "berapa dokumen, berapa halaman, mana yang benar-benar bisa diekspor". Itu bagian yang paling gampang salah dan paling mudah diuji tanpa DOM.

### 3.4 Bilah aksi

```
+----------------------------------------------+
|  3 dipilih - 17 halaman              [Batal] |  <- menggantikan header
+----------------------------------------------+
|                ... daftar dokumen ...        |
+----------------------------------------------+
|   [ Ekspor PDF  PRO ]        [ Hapus ]       |  <- di atas bottom nav
+----------------------------------------------+
```

- Bilah bawah hanya muncul saat ada yang tercentang.
- Bagi akun **Basic**, "Ekspor PDF" tetap terlihat dengan lencana Pro dan **membuka paywall**, bukan dinonaktifkan. Tombol mati tidak menjelaskan apa-apa; tombol yang membuka halaman upgrade menjelaskan sekaligus menjual.
- **Hapus** untuk semua tier — membereskan dokumen sendiri itu dasar, dan tanpanya user harus menghapus satu per satu padahal sudah berdiri di mode pilih. Satu konfirmasi yang menyebut jumlahnya, dan menyebut bahwa cadangan cloud tidak ikut terhapus (sama seperti hapus satuan sekarang). `pruneUnusedSignatures()` dipanggil **sekali** di akhir, bukan per dokumen.
- Banner iklan tetap tampil (ini masih layar tab), bilah aksi duduk di atasnya. **Tidak ada interstitial baru:** ekspor berhenti jadi pemicu sejak 23 Agustus 2026, dan hapus tidak pernah jadi pemicu.

### 3.5 Memecah `exportShare.ts`

Perubahan paling berisiko di fase ini, karena menyentuh jalur ekspor yang sudah jalan.

Sekarang `deliverExport(files)` melakukan dua hal sekaligus: menulis semua berkas ke folder Documents, lalu membuka share sheet. Untuk batch, keduanya harus terpisah — berkasnya ditulis satu per satu sambil jalan, share sheet-nya sekali di akhir.

```
sebelum:  deliverExport(files) --> tulis semua --> share

sesudah:  writeExportFiles(files) --> uri[]                     (baru, diekspor)
          shareFiles(uris, judul)                               (baru, diekspor)
          deliverExport(files) = writeExportFiles + shareFiles   <- perilaku tidak berubah
```

`deliverExport` tetap ada dengan tanda tangan dan perilaku persis sama, jadi **ekspor satuan tidak tersentuh sama sekali**. Ini pemecahan, bukan penulisan ulang.

### 3.6 Jalannya batch: berurutan, tulis lalu lepas

```
untuk tiap dokumen terpilih:
    bangun PDF-nya          <- puncak memori: SATU dokumen
    tulis ke disk           <- blob-nya langsung dilepas
    catat URI-nya
    laporkan progres
selesai:
    buka share sheet sekali dengan semua URI yang berhasil
```

Berurutan, bukan paralel — alasan yang sama dengan `handleRestoreAll` yang sudah ada: ini bukan pekerjaan yang jadi lebih cepat kalau ditumpuk, dan menumpuknya membuat HP memegang banyak PDF sekaligus.

Dokumen 20 halaman memuncak di sekitar 16 MB. Kalau lima dokumen dibangun dulu semua baru disimpan, angkanya jadi ~80 MB — persis kelas masalah yang membuat editor tersendat di uji device 24 Agustus (tabel `Float64Array` 92 MB di filter Hitam-Putih).

Bentuk fungsinya:

```ts
export interface BatchProgress {
  index: number        // 0-based, dokumen keberapa
  total: number
  title: string
}

export interface BatchExportResult {
  saved: string[]
  failed: { title: string; message: string }[]
  cancelled: boolean
  message: string      // kalimat siap-toast, dirakit summarizeBatchExport()
}

export async function exportDocumentsBatch(
  docs: LocalScanDocument[],
  tier: Tier,
  level: CompressionLevel,
  onProgress?: (p: BatchProgress) => void,
  signal?: AbortSignal,
): Promise<BatchExportResult>
```

### 3.7 Tabrakan nama berkas — bug sungguhan, bukan kehati-hatian berlebih

`toSafeFilename` memotong judul di 60 karakter dan membuang karakter terlarang. Dua dokumen berjudul mirip bisa menghasilkan **nama berkas identik**, dan yang kedua diam-diam menimpa yang pertama. User memilih lima dokumen, dapat empat berkas, tanpa ada yang memberi tahu.

Peluangnya kecil hari ini — nama bawaan memuat detik. Tapi **C2 justru pabriknya**: memisah satu sesi menghasilkan beberapa dokumen yang lahir bersamaan dengan nama berpola sama.

`uniqueExportNames(names)` — fungsi murni yang menyisipkan ` (2)`, ` (3)` **sebelum** ekstensi. Ia dan `toSafeFilename` pindah ke modul baru `lib/exportNames.ts`: keduanya matematika string murni, tapi `exportShare.ts` mengimpor Capacitor — selama mereka tinggal di sana, setiap test penamaan ikut menyeret tiruan plugin Filesystem & Share. Diuji di suite node, termasuk kasus judul berbeda yang jadi sama setelah dipotong 60 karakter.

`exportDocumentsBatch` membangun tiap PDF lewat jalur internal yang **sama persis** dengan ekspor satuan (`exportPdf`), jadi watermark, judul, dan tanggal pindai di metadata berperilaku identik — tidak ada cabang kedua yang bisa menyimpang diam-diam.

### 3.8 Gerbang Pro ditegakkan di library

Mengikuti `resolveCompressionLevel` dan `setPageMarks`: `exportDocumentsBatch()` **menolak** kalau tier bukan Pro, bukan sekadar disembunyikan di UI. `canBatchExport(tier)` masuk ke `exportLimits.ts`, tempat semua gerbang tier ekspor sudah tinggal.

Bedanya dengan level kompresi: di sana penurunan diam-diam ke Standar masuk akal karena ada versi yang lebih rendah. Di sini tidak ada "versi lebih rendah" dari ekspor lima dokumen, jadi satu-satunya jawaban jujur adalah menolak.

### 3.9 Kalau satu dokumen gagal, dan tombol Hentikan

Satu dokumen gagal **tidak** membatalkan sisanya — pola yang sama dengan `handleRestoreAll`: satu dokumen rusak tidak boleh menahan empat lainnya. Hasilnya dilaporkan apa adanya:

> "4 dokumen diekspor, 1 gagal." · "Dihentikan — 2 dari 5 dokumen tersimpan." · "Tidak ada dokumen yang berhasil diekspor."

Kalimatnya dirakit `summarizeBatchExport()` supaya bisa diuji tanpa menjalankan ekspor sungguhan. Share sheet hanya dibuka untuk yang berhasil; kalau nol berhasil, tidak ada share sheet sama sekali, cuma toast.

**Tombol Hentikan** dicek **di antara dokumen**, bukan di tengah satu dokumen — memotong pembangunan PDF di tengah jalan meninggalkan berkas separuh di folder Documents. Menekannya menyelesaikan dokumen yang sedang jalan lalu berhenti, dan toast-nya mengatakan persis itu.

### 3.10 Lembar batch & level kompresi

Menekan "Ekspor PDF" membuka lembar ringkas: jumlah dokumen & halaman, slider level 4 takik, tombol Ekspor. Selama berjalan, lembarnya tetap terbuka dan berubah jadi progres + tombol Hentikan.

Level-nya memakai pilihan yang sudah diingat `localStorage` untuk ekspor satuan, dan tetap lewat `resolveCompressionLevel` — tidak ada jalur pintas yang melewati gerbang tier.

Slider-nya dipindahkan keluar dari `ExportSheet.tsx` jadi `components/CompressionField.tsx` supaya dipakai dua lembar. Pemindahan murni, tanpa perubahan perilaku.

### 3.11 Yang sengaja TIDAK ada di C1

- **Tidak ada perkiraan ukuran.** Lembar ekspor satuan butuh ~1,2 detik untuk mengukur satu dokumen (angka terukur, uji device 24 Agustus). Mengukur lima dokumen berarti lembar kosong selama enam detik.
- **Tidak ada pilihan format.** PDF saja.
- **Cadangan cloud tidak tersentuh.** `buildPdfFile()` tetap dipaku ke Standar.
- **Tidak ada subfolder baru.** Berkasnya ke folder Documents seperti ekspor satuan, supaya orang mencarinya di satu tempat yang sama.
- **Tidak ada batas jumlah dokumen.** Share sheet Android memang bisa tersendat kalau berkasnya puluhan; itu sudah tertangkap `try/catch` yang ada dan berkasnya tetap tersimpan. Masuk daftar uji device, bukan angka batas karangan.

---

## 4. Fase C2 — Pisah satu sesi pindai

### 4.1 Alur

Layar Tinjau Hasil Pindai dapat **satu tombol baru** saja. Sisanya layar tersendiri.

```
Scanner -> Tinjau Hasil Pindai (30 halaman)
              |  [Simpan Dokumen (30 halaman)]        <- seperti sekarang
              +- [Pisah jadi Beberapa Dokumen  PRO]   <- baru
                        |
                        v
              Pisah Hasil Pindai
                        |
                        v
              [Simpan 6 Dokumen]  -> tab Dokumen
```

Layar sendiri, bukan disisipkan ke strip thumbnail yang ada: strip itu horizontal dan sudah penuh untuk lima halaman. Untuk tiga puluh halaman dengan penanda pisah di antaranya, ia jadi lorong panjang yang harus digeser jauh cuma untuk melihat sudah terbagi berapa.

### 4.2 Layar Pisah

```
+---------------------------------------------+
| <-   Pisah Hasil Pindai                     |
|      30 halaman -> 6 dokumen                |
+---------------------------------------------+
| Nama:  [ Kwitansi Agustus               ]   |
| Pola:  (Tiap 1 hal) (Tiap 2 hal) (Bersihkan)|
+---------------------------------------------+
|  Dokumen 1 - Kwitansi Agustus (1)           |
|   [hal 1]  [hal 2]                          |
|  --------------- x ---------------          |
|  Dokumen 2 - Kwitansi Agustus (2)           |
|   [hal 3]                                   |
+---------------------------------------------+
|             [ Simpan 6 Dokumen ]            |
+---------------------------------------------+
```

- **Pola siap pakai:** "Tiap 1 halaman" (setumpuk kwitansi/KTP — kasus utamanya), "Tiap 2 halaman" (bolak-balik), "Bersihkan pemisah".
- **Atur sendiri:** ketuk garis di antara dua halaman untuk memasang/melepas gunting.
- Pola dan manual **bukan mode terpisah** — memilih pola cuma mengisi guntingnya; setelah itu tetap bisa digeser-geser.

### 4.3 Isinya satu himpunan angka

Seluruh keadaan layar ini adalah **satu himpunan posisi gunting**. Gunting di posisi *i* berarti "dokumen baru dimulai di halaman *i*".

```
30 halaman, gunting di {2, 3, 6}  ->  [0,1] [2] [3,4,5] [6..29]
```

`planSplit(jumlahHalaman, gunting)` jadi fungsi murni di `lib/scanSplit.ts`. Layar Pisah hanya menggambar hasilnya. Yang dijaga test: pola siap pakai, gunting di posisi 0 dan di luar jangkauan yang harus diabaikan, gunting kembar, tanpa gunting sama sekali (= satu dokumen), gunting di tiap posisi (= N dokumen).

### 4.4 Penamaan

Kolom Nama diisi sekali, hasilnya `Nama (1)`, `Nama (2)`, … Dikosongkan pun aman: jatuh ke nama bawaan `Scan <tanggal>` seperti sekarang.

Satu kolom teks memang menambah kerja, tapi tanpanya orang yang memindai tiga puluh kwitansi dapat tiga puluh dokumen bernama identik kecuali nomornya — lalu harus mengubah nama tiga puluh kali.

### 4.5 Gerbang Pro, dengan satu pengecualian yang penting

Penegakannya di `saveSplitScan()`, bukan di UI. Tapi syaratnya bukan "fitur ini Pro", melainkan **"lebih dari satu dokumen butuh Pro"**:

> Memisah jadi 1 dokumen itu identik dengan menyimpan biasa. Menolaknya berarti menolak sesuatu yang sudah gratis lewat pintu sebelah — bug, bukan penegakan aturan.

Akun Basic yang menekan tombolnya dapat paywall, bukan layar yang mati.

### 4.6 Kalau menyimpan gagal di tengah — halamannya tidak boleh hilang

Bagian yang paling penting dibuat benar. Menyimpan delapan dokumen berarti delapan operasi tulis; yang keenam bisa gagal karena penyimpanan penuh.

**Yang ditolak:**

- Membatalkan semuanya — lima dokumen yang sudah aman ikut hilang.
- Menutup layar begitu saja — tiga kelompok sisanya lenyap bersama sesi pindainya, dan hasil pindai yang hilang tidak bisa dipulihkan dari mana pun.

**Yang dilakukan: kelompok yang berhasil pergi, kelompok yang gagal tetap tinggal.** Layar Pisah tetap terbuka, isinya menyusut jadi halaman-halaman yang belum tersimpan, guntingnya ikut disesuaikan, dan toast-nya berkata:

> "5 dokumen tersimpan, 3 gagal. Halamannya masih di sini — coba simpan lagi."

Menekan Simpan lagi tidak menghasilkan duplikat, karena yang berhasil sudah tidak ada di layar. `saveScanDocument` sendiri sudah membereskan foldernya saat gagal di tengah, jadi tidak ada sisa folder tanpa entri index.

### 4.7 Dua hal kecil yang sudah tertangani

- **Iklan:** interstitial `scan-saved` dipanggil **sekali** untuk seluruh sesi pisah, bukan sekali per dokumen. Praktisnya tidak pernah tampil (ini Pro-only), tapi kalau baris ini ditulis per dokumen, langganan yang habis di kemudian hari akan meledakkan delapan interstitial beruntun.
- **Memori 30 thumbnail:** halaman hasil pindai itu JPEG 12 MP. `PageImage` sudah memakai `loading="lazy"` + `decoding="async"` sejak pekerjaan pratinjau 24 Agustus, jadi layar ini menumpang perbaikan yang sudah ada.

---

## 5. Yang tidak berubah

- **`resolvePage()`, model halaman, `schemaVersion`.** Potongan ini tidak menyentuh isi halaman sama sekali — tidak ada ladang baru, tidak ada migrasi.
- **Ekspor satuan.** `deliverExport` dipertahankan utuh; yang berubah cuma bahwa isinya kini memanggil dua fungsi yang sudah dipisah.
- **Cadangan cloud & pemulihan.** Nol perubahan.
- **Merge.** `MergeScreen` tidak disentuh.
- **Kebijakan iklan.** Tidak ada pemicu baru.

## 6. Rencana test

**Suite node** (logika murni, tanpa DOM):

| Berkas | Yang dijaga |
|---|---|
| `documentSelection.test.ts` | centang/lepas, pilih semua, kosongkan; ringkasan jumlah dokumen & halaman; baris cloud tersaring keluar dari yang bisa diekspor |
| `exportNames.test.ts` | dua judul → nama sama, jadi ` (2)`; tabrakan tiga arah; judul berbeda yang jadi sama setelah dipotong 60 karakter; ekstensi tidak tergeser |
| `batchExport.test.ts` | `canBatchExport` per tier; `exportDocumentsBatch` menolak Basic; kalimat ringkasan untuk semua-berhasil / sebagian / nol / dihentikan |
| `scanSplit.test.ts` | `planSplit` (pola, gunting di luar jangkauan, gunting kembar, tanpa gunting, gunting penuh); penamaan `Nama (1)`; nama kosong → bawaan; gerbang Pro melewatkan 1 kelompok tapi menolak 2; sisa kelompok setelah gagal sebagian |

**Suite browser** (Chromium sungguhan, `vitest-browser-react`):

| Berkas | Yang dijaga |
|---|---|
| `DocumentsScreen.browser.test.tsx` | tekan lama masuk mode pilih; **klik yang menyusul tekan lama tidak membuka dokumen**; baris cloud tidak bisa dicentang; bilah aksi cuma muncul saat ada pilihan; Basic menekan Ekspor → `onUpgrade`, bukan `onBatchExport` |
| `SplitScanScreen.browser.test.tsx` | pola mengisi gunting; ketuk pemisah memasang & melepas; hitungan footer ikut berubah; Simpan mengirim kelompok yang benar |

Tekan lama itu urusan pointer event dan pewaktu — jenis kode yang test Node tidak bisa sentuh, dan jenis kode yang di potongan sebelumnya menyimpan bug (tombol panah di layar pratinjau).

**Test-nya harus terbukti menggigit.** Kode disabotase sebentar lalu dikembalikan:

- lepas penyisipan ` (2)` → test tabrakan nama harus merah
- lepas gerbang Pro di `exportDocumentsBatch` → test penolakan Basic harus merah
- lepas penelan-klik setelah tekan lama → test "tidak membuka dokumen" harus merah
- ubah gerbang split jadi menolak juga saat 1 kelompok → test pengecualian harus merah

**Yang sengaja tidak diuji otomatis:** penulisan berkas ke folder Documents, share sheet Android, pemindai ML Kit. Semuanya batas plugin Capacitor — test yang "membuktikannya" cuma membuktikan mock-nya dipanggil (CLAUDE.md Bagian 4). Itu masuk daftar uji device.

## 7. Daftar uji di HP (butuh Boss Ali)

**Setelah C1:**

- Tekan lama sebuah dokumen — masuk mode pilih, dan dokumennya tidak ikut terbuka
- Tekan lama baris dokumen cloud — muncul toast, bukan diam saja
- Pilih 3 dokumen → Ekspor PDF → 3 berkas di folder Documents, nama sesuai judulnya
- Dua dokumen berjudul sama persis → berkas kedua jadi `… (2)`, tidak menimpa yang pertama
- Ekspor 10+ dokumen — share sheet Android sanggup atau tidak
- Tekan Hentikan di tengah — berhenti setelah dokumen yang sedang jalan, jumlahnya sesuai toast
- Hapus 3 dokumen sekaligus — konfirmasi muncul, cadangan cloud tetap ada
- Akun Basic: tombol Ekspor berlencana Pro dan membuka paywall; Hapus tetap bisa dipakai

**Setelah C2:**

- Pindai 10 kwitansi sekali jalan → "Tiap 1 halaman" → 10 dokumen, urutannya benar
- Isi kolom Nama → semua dokumen bernama `Nama (1..10)`
- Kosongkan Nama → jatuh ke nama bawaan, tidak error
- Atur gunting sendiri di dokumen 30 halaman — layarnya masih enak digulir, thumbnail tidak membuat HP tersendat
- Akun Basic: tombol Pisah berlencana Pro dan membuka paywall
- Simpan hasil pisah, lalu langsung batch-export semuanya — nama berkasnya tidak bertabrakan (pertemuan C1 & C2)

## 8. Berkas yang tersentuh

**C1:**

| Berkas | Perubahan |
|---|---|
| `src/lib/documentSelection.ts` | **baru** — logika himpunan pilih (murni) |
| `src/lib/exportNames.ts` | **baru** — `toSafeFilename` (pindah) + `uniqueExportNames`, tanpa impor platform |
| `src/lib/exportShare.ts` | pecah jadi `writeExportFiles` + `shareFiles`; `deliverExport` tetap |
| `src/lib/documentExport.ts` | `exportDocumentsBatch`, `summarizeBatchExport` |
| `src/lib/exportLimits.ts` | `canBatchExport(tier)` |
| `src/screens/DocumentsScreen.tsx` | mode pilih, bilah aksi, tekan lama |
| `src/components/BatchExportSheet.tsx` | **baru** — lembar level + progres |
| `src/components/CompressionField.tsx` | **baru** — slider dipindah keluar dari `ExportSheet` |
| `src/components/ExportSheet.tsx` | memakai `CompressionField`, perilaku tidak berubah |
| `src/App.tsx` | `handleBatchExport`, `handleBatchDelete`, state progres |

**C2:**

| Berkas | Perubahan |
|---|---|
| `src/lib/scanSplit.ts` | **baru** — `planSplit`, pola, penamaan, `saveSplitScan` + gerbang Pro |
| `src/screens/SplitScanScreen.tsx` | **baru** — layar Pisah |
| `src/screens/ReviewScreen.tsx` | satu tombol |
| `src/App.tsx` | view `split`, handler simpan-banyak |
