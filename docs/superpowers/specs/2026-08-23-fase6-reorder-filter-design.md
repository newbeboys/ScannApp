# Fase 6 (bagian 1) — Reorder Halaman & Filter Dokumen

Tanggal: 23 Agustus 2026
Status: disetujui Boss Ali, siap diimplementasikan

Bagian pertama Fase 6, sesuai urutan yang disetujui Boss Ali: **reorder halaman + filter lanjutan** dulu, karena keduanya paling dekat dengan kode editor yang sudah ada dan tidak butuh dependency baru. OCR, anotasi, dan tanda tangan menyusul terpisah.

Keduanya **fitur Pro** (PRD Bagian 3).

---

## 1. Masalah yang Diselesaikan

**Reorder.** Urutan halaman ditentukan urutan memindai. Salah urut berarti mengulang scan seluruh dokumen — tidak ada cara memperbaikinya di aplikasi.

**Filter.** Hasil pindai HP hampir selalu perlu perbaikan: latar kertas keabu-abuan, cahaya tidak rata, atau terlalu gelap. Tanpa filter, satu-satunya jalan adalah memindai ulang dengan cahaya lebih baik.

## 2. Keputusan Desain

### 2.1 Filter disimpan terpisah, tidak ditumpuk ke file hasil edit

Editor menyimpan crop dan putar secara menumpuk: semuanya ditulis ke satu file `edited`, dan tombol "Asli" membuang seluruhnya. Itu masuk akal untuk crop — orang jarang coba-coba memotong.

Filter beda: orang mencoba, melihat, lalu berubah pikiran. Kalau filter ikut dibakar ke `edited`, user yang sudah crop dan memutar halaman dengan rapi lalu tidak suka filternya **harus membuang crop dan putarannya juga**.

Jadi filter disimpan sebagai **pilihan**, bukan sebagai piksel yang menimpa hasil edit.

### 2.2 Crop/putar selalu dikerjakan pada rantai tanpa filter

Ini yang membuat 2.1 benar-benar bekerja, dan mudah salah kalau tidak disengaja.

Crop dan putar itu operasi **geometri**; filter itu operasi **warna**. Keduanya bisa ditukar urutannya tanpa mengubah hasil. Maka:

- `edited` **selalu** hanya berisi geometri — crop/putar dikerjakan pada `edited ?? original`, tidak pernah pada file berfilter
- file berfilter **selalu** diturunkan ulang dari `edited ?? original`

Tanpa aturan ini, memotong halaman yang sedang berfilter akan membakar filter itu ke dalam `edited`, dan mengganti filter setelahnya jadi mustahil.

### 2.3 Hasil filter disimpan sebagai file, bukan dihitung saat tampil

Dua pilihan yang dipertimbangkan:

| | Simpan file turunan (dipilih) | Hitung saat tampil |
|---|---|---|
| Yang membaca halaman | tetap membaca path file, tidak ada yang berubah | tiap penampil harus lewat canvas |
| Daftar dokumen 20 thumbnail | seperti sekarang | berat di HP kelas bawah |
| Ekspor & cadangan | tidak ada kerja tambahan | mengulang kerja yang sama tiap kali |
| Biaya | satu file ekstra per halaman berfilter; beberapa detik saat filter diganti | penyimpanan lebih hemat |

Dipilih yang pertama: aplikasi HP, dan biaya membacanya jauh lebih sering terjadi daripada biaya menulisnya.

### 2.4 Filter berlaku untuk seluruh dokumen, bisa dikecualikan per halaman

Kontrak 15 halaman yang dipindai memang mau hitam-putih semuanya, bukan halaman 3 saja. Memaksa user memilih filter 15 kali adalah menyiksa untuk hal yang hampir selalu seragam.

Tapi dokumen campuran itu nyata — teks hitam-putih dengan satu halaman grafik berwarna — jadi satu halaman tetap bisa dikecualikan.

Filter efektif sebuah halaman dihitung berjenjang: **pengecualian halaman → filter dokumen → tanpa filter**. Pengecualian halaman harus bisa menyatakan "sengaja tanpa filter" secara berbeda dari "ikut dokumen saja".

### 2.5 Lima filter (keputusan Boss Ali 23 Agustus 2026)

PRD Bagian 3 semula menyebut dua ("B&W, magic color"). Boss Ali menaikkannya jadi lima supaya user punya lebih banyak pilihan. Masing-masing punya alasan pakai yang berbeda — bukan lima variasi dari hal yang sama:

| Filter | Untuk apa |
|---|---|
| Magic Color | Serba guna: kontras otomatis, latar kertas jadi bersih |
| Cerah | Hasil pindai gelap / kurang cahaya |
| Abu-abu | Buang warna tapi pertahankan gradasi (foto, tanda tangan) |
| Hitam-Putih | Dokumen teks — ambang adaptif, file paling kecil |
| Hemat Tinta | Untuk dicetak: latar putih bersih, teks ditipiskan |

Semuanya deterministik dan murni canvas — **tidak ada dependency baru, tidak ada model AI**. AI Enhance tetap Fase 7 dengan TFLite on-device (CLAUDE.md Bagian 2), jalur yang sepenuhnya berbeda.

Hitam-Putih memakai **ambang adaptif lokal**, bukan ambang global: halaman yang tercahaya tidak rata (bayangan tangan, lampu dari samping) akan jadi bercak hitam besar dengan ambang global.

### 2.6 Reorder lewat tombol geser, bukan seret-lepas

Seret-lepas di layar sentuh paling rawan: mudah salah tangkap, bentrok dengan gulir strip halaman, dan butuh penanganan sentuhan sendiri karena proyek ini tidak punya library drag.

Tombol geser tidak pernah gagal dan jelas akibatnya. Urutan hasil scan biasanya cuma butuh koreksi satu-dua posisi, jadi kelemahannya (dokumen tebal butuh beberapa ketukan) jarang terasa.

Reorder hanya mengubah urutan di index. **Tidak ada file yang disentuh atau ditulis ulang.**

## 3. Model Data — `schemaVersion` naik ke 3

```ts
type DocumentFilter = 'magic' | 'bright' | 'grayscale' | 'bw' | 'ink-saver'

interface ScanPage {
  original: string
  /** Crop & putar saja — tidak pernah berisi filter. */
  edited?: string
  /** Pengecualian: filter, atau 'none' untuk sengaja polos. Kosong = ikut dokumen. */
  filter?: DocumentFilter | 'none'
  /** File hasil filter, diturunkan dari `edited ?? original`. */
  filtered?: string
}

interface LocalScanDocument {
  schemaVersion: 3
  // ...seperti v2
  /** Filter untuk seluruh dokumen. */
  filter?: DocumentFilter
}
```

`resolvePage()` jadi `filtered ?? edited ?? original`. **Satu perubahan itu** membuat ekspor, merge, cadangan, dan semua pratinjau ikut berfilter tanpa satu pun consumer disentuh.

Migrasi v2→v3 mengikuti pola v1→v2 yang sudah ada: setiap pembacaan index dilewatkan `migrateScanIndex`, hasilnya ditulis balik. Dokumen v2 naik ke v3 tanpa filter — tampilannya tidak berubah sama sekali.

## 4. Pembagian Modul

Piksel dipisahkan dari canvas supaya bisa diuji tanpa browser — sesuatu yang selama ini tidak bisa dilakukan untuk `imageEditor.ts`.

| Modul | Tugas |
|---|---|
| `lib/filters.ts` (baru) | Matematika piksel murni: `(data, width, height) => void`. Tanpa DOM, jadi bisa diuji di Node |
| `lib/imageEditor.ts` | Plumbing canvas: decode → panggil filter → encode |
| `lib/scanIndexMigration.ts` | Tipe v3, migrasi, `effectiveFilter(doc, page)`, `resolvePage` |
| `lib/scanStorage.ts` | `reorderPages`, menulis/menghapus file hasil filter |
| `lib/documentEditing.ts` | `setDocumentFilter`, `setPageFilter` — menurunkan ulang file yang perlu |
| `screens/EditorScreen.tsx` | Pemilih filter, kontrol reorder, gating Pro |

## 5. Gating Pro

Mengikuti pola merge yang sudah ada: tombolnya **tetap terlihat** oleh user Basic, diketuk → layar Upgrade. Menyembunyikannya berarti Basic tidak pernah tahu ada yang bisa dibeli.

Penegakannya di lapisan aksi, bukan cuma di UI.

## 6. Pengujian

Menyasar yang paling mungkin diam-diam salah:

- Migrasi v2→v3, dan dokumen v1 yang melompati dua versi sekaligus
- Filter efektif: pengecualian halaman menang atas filter dokumen; `'none'` berbeda dari kosong
- **Ganti filter tidak menghilangkan crop** — inti dari 2.1
- **Crop setelah filter tidak membakar filter ke `edited`** — inti dari 2.2
- Reorder: batas di halaman pertama & terakhir, urutan setelah beberapa geseran
- Matematika tiap filter pada piksel yang diketahui (bisa diuji di Node berkat 4)
- Basic tertahan paywall di lapisan aksi

## 7. Yang Sengaja Tidak Dikerjakan

- **Seret-lepas** — lihat 2.6; bisa ditambahkan nanti kalau tombolnya terasa kurang
- **Pratinjau filter berdampingan** — butuh merender lima varian tiap halaman; mahal di HP, dan pemilih filter sudah menampilkan hasilnya langsung saat dipilih
- **AI Enhance** — Fase 7, TFLite on-device, jalur berbeda
- **Kontrol level kompresi manual & export DOCX/PNG** — masih Fase 6 tapi bagian berikutnya
