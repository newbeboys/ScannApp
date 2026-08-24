# Fase 6 potongan B — Annotate & Tanda Tangan Digital (Pro)

**24 Agustus 2026.** Potongan kedua dari empat sisa Fase 6 (urutan di `TASKS.md`: B annotate + tanda tangan, C batch scan/export, D OCR + DOCX). Keduanya digabung dalam satu potongan karena berbagi satu pipeline: goresan di atas halaman, disimpan sebagai data, dirender ke satu berkas turunan.

**Tier:** Pro-exclusive, sesuai PRD Bagian 3 dan CLAUDE.md Bagian 6 — dua baris ini **tidak** ikut dipindahkan Boss Ali ke "semua tier" seperti reorder/filter/PNG.

---

## 1. Masalah

Kertas yang dipindai sering butuh satu hal kecil sebelum dikirim: lingkari angka yang salah, coret satu baris, bubuhkan tanda tangan. Hari ini satu-satunya jalan adalah mencetaknya, menulis di atasnya, lalu memindai ulang.

## 2. Keputusan model

### 2.1 Goresan disimpan sebagai data, bukan dibakar ke `edited`

`edited` menyimpan **geometri saja** — itu invariant yang membuat filter bisa diganti tanpa kehilangan crop (spec Fase 6 bagian 1, Bagian 2.2). Membakar tinta ke situ akan membuat filter Hitam-Putih ikut mengambang tanda tangan biru jadi hitam pekat, dan mengganti filter berarti kehilangan seluruh anotasi.

Jadi halaman naik ke **`schemaVersion: 4`** dengan dua ladang baru:

```ts
interface ScanPage {
  original: string
  edited?: string          // geometri (crop/putar)
  filter?: PageFilter
  filtered?: string        // turunan dari `edited ?? original`
  marks?: Mark[]           // BARU — vektor, koordinat 0..1
  annotated?: string       // BARU — turunan dari `filtered ?? edited ?? original` + marks
}
```

`resolvePage()` jadi `annotated ?? filtered ?? edited ?? original`. Karena **setiap** konsumen (daftar, editor, pratinjau, ekspor, merge, cadangan cloud) sudah lewat fungsi itu, tidak satu pun perlu disentuh — persis seperti saat filter ditambahkan.

### 2.2 Koordinat 0..1, ketebalan relatif terhadap sisi panjang

Sebuah goresan dibuat di atas pratinjau selebar ~340 px lalu dirender ke halaman 3000 px. Menyimpan piksel layar akan salah tempat begitu ukuran render berbeda. Ketebalan pun relatif (`0.004` = 0,4% sisi panjang), jadi pena setebal 3 px di layar tetap terlihat setebal itu di berkas ekspor.

### 2.3 Crop & putar memetakan ulang goresan, tidak membuangnya

Konsekuensi 2.2: koordinat normalisasi mengambang relatif terhadap **isi** halaman, jadi crop menggeser tinta terhadap kertasnya. Pemetaan ulangnya matematika murni dan pendek — `remapMarksForCrop`, `remapMarksForRotation` di `lib/annotations.ts`, seluruhnya diuji di suite node. Goresan yang seluruhnya jatuh di luar area crop dibuang.

Alternatif yang ditolak: mengunci tombol Potong/Putar setelah halaman dianotasi. Itu memindahkan biayanya ke user untuk menghemat 60 baris matematika.

### 2.4 Tanda tangan adalah berkas, bukan data URL di dalam index

Index dibaca ulang di setiap operasi penyimpanan. Menaruh PNG tanda tangan (beberapa KB base64) di dalamnya membuat setiap tulis index membawa muatan itu, dikalikan tiap halaman yang memakainya.

Tanda tangan ditulis ke `scans/signature-<cap waktu>.png`, dan `Mark` hanya menyimpan **path**-nya. Cap waktu di nama berkas, bukan nama tetap: kalau user menggambar ulang tanda tangannya, stempel yang **sudah** ditempel di dokumen lama tidak boleh ikut berubah. Path tanda tangan yang sedang aktif disimpan di `localStorage`.

### 2.5 Peralatan yang masuk, dan yang sengaja tidak

Masuk: **Pena** (tinta pekat), **Stabilo** (tembus pandang, `multiply`), **Tanda tangan** (stempel yang bisa digeser & diubah ukurannya), **Urungkan** (buang goresan terakhir), **Hapus semua**.

Sengaja tidak masuk di potongan ini: **kotak teks** dan **bentuk (panah/kotak)**. Teks butuh papan ketik melayang, ukuran huruf yang harus ikut skala halaman, dan pengeditan setelah dibuat — itu subsistem tersendiri, bukan varian dari goresan. Dicatat di `TASKS.md` sebagai sisa, bukan dilupakan.

### 2.6 Warna diambil dari yang sudah ada di kode

CLAUDE.md 9.2 melarang memperkenalkan warna baru. Keempat warna tinta semuanya sudah dipakai di tempat lain: hitam `#1b2740` (`--fg` tema terang), biru `#2563eb` (primary), merah `#e5484d` (`.icon-button--danger`), kuning `#f5c443` (`--pro-gold`, khusus stabilo). Tidak ada yang baru.

### 2.7 Gerbang Pro ditegakkan di library, bukan di UI

Pelajaran dari potongan sebelumnya (`resolveCompressionLevel`): menyembunyikan tombol saja bukan gerbang. `setPageMarks()` menolak dengan pesan yang jelas kalau tier bukan Pro, jadi jalur mana pun ke fungsi itu ikut terjaga.

## 3. Alur render

```
marks  +  filtered ?? edited ?? original   ──renderMarks()──►  annotated
```

Dirender ulang di tiga kesempatan, semuanya sudah punya tempatnya sendiri di `documentEditing.ts`:

| Kejadian | Yang terjadi pada goresan |
|---|---|
| Crop / putar | dipetakan ulang (2.3), `annotated` dirender ulang dari geometri baru |
| Ganti filter | koordinat tidak berubah, `annotated` dirender ulang di atas hasil filter baru |
| "Asli" (buang crop) | dipetakan balik tidak mungkin — goresan **dipertahankan apa adanya**, `annotated` dirender ulang di atas `original`. Sama seperti pilihan filter yang selamat dari "Asli": mengurungkan potongan bukan berarti mengurungkan tanda tangan |

`renderMarks` di-encode pada kualitas 0.95, alasan yang sama dengan `filterImage`: berkas ini yang jadi bahan ekspor & cadangan.

## 4. Yang tidak berubah

- **Merge** menyalin `resolvePage(page)` jadi `original` dokumen baru — tinta ikut terbakar di situ, sesuai perilaku yang sudah berlaku untuk crop ("yang dilihat itu yang digabung").
- **Ekspor, cadangan cloud, pemulihan** lewat `resolvePage()`. Nol perubahan.
- **Pratinjau layar penuh** juga lewat `resolvePage()`. Nol perubahan.
