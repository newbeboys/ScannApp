# Fase 7A — Perbaiki Pencahayaan (metode klasik, semua tier)

**30 Agustus 2026.** Spec ini menuliskan hasil brainstorm 29 Agustus 2026 yang keputusannya sudah tercatat di `TASKS.md` Fase 7 dan sudah masuk PRD Bagian 4, `CLAUDE.md` Bagian 2/3/6, dan `SYSTEM_DESIGN.md`. Yang belum ada adalah rancangan teknis yang bisa dieksekusi — itu isi dokumen ini.

**Dua keputusan Boss Ali yang mengikat seluruh dokumen ini:**

- **Tier: semua tier.** Basic dan Pro setara. **Jangan tulis satu pun cek tier di jalur ini** — tidak di UI, tidak di library. Status Pro-exclusive baru berlaku khusus untuk versi model TFLite nanti.
- **Nama: "Perbaiki Pencahayaan".** **Dilarang** menyebutnya "AI Enhance" di UI maupun copy mana pun. Isinya matematika deterministik; klaim "AI" akan menyesatkan user. Nama "AI Enhance" disimpan untuk versi model.

Nama internal di kode tetap netral (`enhancePage()`, `ScanPage.enhanced`, `LocalScanDocument.enhance`) supaya seam-nya bisa diisi model TFLite nanti tanpa rename berantai — ini juga keputusan yang sudah tercatat di `CLAUDE.md` Bagian 6.

---

## 1. Masalah

Halaman yang difoto atau dipindai di meja hampir tidak pernah mendapat cahaya rata. Ada bayangan tangan, bayangan badan HP sendiri, atau satu sisi lebih terang karena jendela. Akibatnya bukan sekadar "kurang cantik":

- **Hitam-Putih jadi bercak hitam pekat.** Filter `bw` sudah memakai ambang lokal, yang menahan sebagian besar masalah ini, tapi pada bayangan yang tajam batasnya tetap terlihat.
- **Magic Color menaikkan seluruh halaman dengan satu angka.** `whitePoint()` adalah satu persentil untuk seluruh citra, jadi kalau separuh halaman gelap, ia tidak bisa melayani dua sisi sekaligus.
- **Hasil ekspor & OCR ikut kena.** ML Kit membaca dari `annotationSource` — halaman berbayang menghasilkan kata yang tidak terbaca.

Yang diperbaiki di sini adalah **penyebabnya**, satu tahap sebelum filter: ratakan dulu cahayanya, baru filter bekerja pada halaman yang cahayanya sudah rata.

## 2. Kenapa metode klasik, bukan model

Sudah diriset dan hasilnya negatif — angkanya lengkap di `TASKS.md` Fase 7. Ringkasnya: tidak ada model shadow-removal dokumen yang muat di HP; yang berlisensi MIT (`DocShadow/FSENet`) 29,34 juta parameter dan 7,93 detik per halaman **di GPU desktop**; melatih sendiri tidak mungkin di mesin dev dengan RAM 3,4 GB.

Metode klasik memenuhi alasan yang PRD tulis untuk mandat TFLite (menolak cloud AI: biaya tak terduga, free tier rawan dipangkas) dengan lebih kuat lagi: nol biaya, nol jaringan, nol tambahan bobot APK, nol dependency baru.

## 3. Tempatnya di rantai turunan

Perbaiki Pencahayaan adalah **tahap terpisah, bukan filter keenam**. Rantainya jadi:

```
original → edited → enhanced → filtered → annotated
```

Ini keputusan brainstorm, dan alasannya praktis: nilainya paling terasa justru **bersamaan** dengan Hitam-Putih, bukan sebagai penggantinya. Kalau ia jadi chip keenam di `FilterPicker`, memilihnya berarti membatalkan Hitam-Putih — persis kombinasi yang paling dibutuhkan.

Konsekuensinya pada `scanIndexMigration.ts`:

| Fungsi | Sebelum | Sesudah |
|---|---|---|
| `resolvePage` | `annotated ?? filtered ?? edited ?? original` | `annotated ?? filtered ?? enhanced ?? edited ?? original` |
| `filterSource` | `edited ?? original` | `enhanced ?? edited ?? original` |
| `annotationSource` | `filtered ?? edited ?? original` | `filtered ?? enhanced ?? edited ?? original` |
| `enhanceSource` | — | `edited ?? original` (baru — geometri saja) |

`filterSource` berubah arti: bukan lagi "geometri saja", tapi "geometri **dan** cahaya, tidak pernah filter lain". Komentarnya wajib ikut diperbarui — komentar lama akan jadi bohong.

**Schema `5 → 6`:** `ScanPage.enhanced?: string` (path hasil render) dan `LocalScanDocument.enhance?: boolean` (sakelar per dokumen).

**Aturan pasangan:** `enhanced` hanya disimpan selama `enhance === true`, sama seperti `annotated` yang hanya disimpan selama `marks` masih ada. Tanpa itu, dokumen yang sakelarnya mati bisa tetap menampilkan berkas hasil koreksi yang tidak bisa dijelaskan, dimatikan, atau di-render ulang oleh apa pun yang tersisa di index.

## 4. Algoritma

Dua fungsi murni di `src/lib/enhance.ts`, tanpa DOM, sehingga bisa diuji di suite `node` melawan piksel yang jawabannya diketahui — pola yang sama dengan `filters.ts`.

### 4.1 Peta cahaya dari kisi 16×16

Estimasi dilakukan pada **citra kerja** yang sisi panjangnya ±256 px, bukan pada halaman penuh. Peta cahaya adalah sinyal frekuensi rendah — ia menggambarkan pencahayaan di seluruh halaman, bukan tintanya — jadi sampel yang jarang tidak kehilangan apa pun, dan biayanya turun dari 12 juta piksel jadi 65 ribu.

Halaman dibagi 16×16 ubin. Nilai tiap ubin adalah **persentil ke-95 luminansi** di dalam ubin itu — bukan rata-rata, bukan maksimum. Rata-rata akan ikut tertarik turun oleh tinta; maksimum akan dikuasai satu titik pantulan.

### 4.2 Penolakan pencilan lokal (median + MAD)

Ubin yang isinya foto tempel atau blok hitam akan melaporkan "di sini gelap" padahal kertasnya tidak gelap. Kalau nilai itu dipakai, ubin tersebut akan dinaikkan 2,5× dan fotonya jadi pudar.

Penolakannya **lokal**, bukan global — jendela 5×5 ubin di sekeliling ubin yang dinilai:

```
m  = median(jendela 5×5)
MAD = median(|nilai − m|) di jendela yang sama
σ̂  = max(1,4826 × MAD, 4)
tolak ubin i bila  p_i < m − 3σ̂
```

Global tidak bisa dipakai: halaman yang separuhnya memang lebih gelap karena bayangan besar akan menolak separuh ubinnya sendiri, padahal justru itu yang harus diukur. Semua keputusan tolak/terima dihitung dari kisi **mentah** lalu diterapkan sekaligus — kalau ubin yang sudah ditolak ikut mempengaruhi penilaian tetangganya, penolakan akan merambat.

Lantai `σ̂ ≥ 4` ada karena MAD bisa nol persis di daerah kertas polos, dan pembagi nol akan menolak apa pun yang berbeda satu level.

Ubin yang ditolak **ditambal** dari tetangganya: rata-rata ubin tidak-ditolak di cincin radius 1, lalu radius 2, dan seterusnya sampai ketemu. Deterministik, tidak ada tebakan.

### 4.3 Katup batal

Dua hal dihitung sebagai ubin ditolak: pencilan di 4.2, dan **ubin kosong** (tidak ada piksel yang jatuh di dalamnya — terjadi pada citra kerja yang jauh lebih kecil dari kisinya, mis. gambar 5×5 px hasil impor yang rusak).

Kalau ubin yang ditolak **lebih dari 50%**, estimasi dibatalkan: `estimateLightGrid` mengembalikan `null`, dan halaman itu **dibiarkan apa adanya**. Lebih baik tidak melakukan apa-apa daripada mengalikan halaman dengan peta cahaya yang tidak bisa dipercaya.

Jujur soal jangkauannya: dengan penolakan berbasis median lokal, jalur pencilan hampir tidak mungkin sendirian menembus 50% — sebuah ubin hanya ditolak kalau ia minoritas di jendelanya sendiri, dan mayoritas tidak bisa jadi minoritas di mana-mana sekaligus. Pemicu yang benar-benar terjadi adalah **ubin kosong**. Katup ini tetap dipasang karena ia murah dan menutup kelas kegagalan yang tidak terlihat, tapi jangan menulis tes yang berpura-pura jalur pencilannya bisa menembus 50% dengan halaman yang wajar.

### 4.4 Koreksi: pembagian dengan batas penguatan

```
target = max(peta cahaya)
bg(x,y) = interpolasi bilinear peta cahaya di (x,y)
gain    = min(target / max(bg, 1), 2,5)
keluar  = clamp255(kanal × gain)   // R, G, B; alpha tidak pernah disentuh
```

**Kenapa `target = max(grid)` dan bukan 245 atau 255.** Target tetap akan mengubah tahap ini dari "meratakan cahaya" jadi "mencerahkan halaman", dan mencerahkan sudah punya rumahnya sendiri (`bright`, `magic` — keduanya menarik ke `whitePoint`). Dengan `max(grid)`, daerah paling terang halaman **tidak berubah sama sekali** dan daerah gelap dinaikkan sampai setara dengannya. Efeknya: `gain ≥ 1` selalu, tahap ini **tidak pernah menggelapkan** apa pun, dan filter setelahnya tetap mendapat halaman yang bentuknya ia kenali.

**Batas penguatan 2,5×** menahan satu kegagalan yang khas: sudut yang nyaris hitam akan minta penguatan 20× dan yang keluar adalah noise sensor yang diperbesar, bukan kertas.

**Kalau `target ≤ 1`** (halaman hitam seluruhnya), koreksi tidak dijalankan — tidak ada kertas untuk dijadikan acuan.

### 4.5 Latar tidak pernah dimaterialisasi

Peta cahaya seukuran halaman untuk halaman 12 MP adalah `Float32Array` 48 MB, diminta dalam satu alokasi ketika buffer piksel 48 MB sudah terbuka. HP akan tersendat atau menolak. Karena itu `correctLighting` menginterpolasi bilinear **langsung dari kisi 256 angka** saat menyusuri piksel; yang dialokasikan hanya tiga array selebar gambar untuk bobot sumbu-x (3 × 3000 float, ±36 KB).

Ini pelajaran yang sudah dibayar sekali di `blackAndWhite` — lihat komentar `COARSE_TABLE_MIN_EDGE` di `filters.ts`.

## 5. Sisi kanvas: `enhancePage()`

Di `imageEditor.ts`, mengikuti pola `filterImage`: modul ini yang punya kanvas, `enhance.ts` yang punya matematikanya.

```ts
export async function enhancePage(blob: Blob): Promise<Blob | null>
```

1. Decode halaman → kanvas ukuran penuh → `getImageData`.
2. Gambar bitmap yang sama ke kanvas kerja (sisi panjang 256) → `getImageData` → `estimateLightGrid`.
3. `null` dari estimator → kembalikan `null` (halaman dibiarkan; lihat 4.3).
4. `correctLighting` di buffer resolusi penuh → `putImageData` → encode `DERIVED_QUALITY` (0,9), sama dengan `filterImage` dan `renderMarks`, dan untuk alasan yang sama: berkas ini yang dibaca ekspor dan cadangan cloud.

Nama `enhancePage` (bukan `enhanceImage`) dipakai sesuai keputusan yang sudah tercatat: inilah seam yang isinya diganti model TFLite nanti.

## 6. Orkestrasi penyimpanan

### 6.1 Dua fungsi baru, bukan pembongkaran tanda tangan yang sudah ada

`applyDocumentFilter`, `applyPageFilter`, dan `applyPageDerived` **tidak diubah tanda tangannya**. Alternatifnya — membundel ketiga renderer jadi satu objek `PageRenderers` — memaksa perubahan di sepuluh lebih titik panggil di `scanStorageFilter.test.ts` dan `documentEditing.test.ts` untuk keuntungan nol: begitu `filterSource` sudah membaca `enhanced`, render filter otomatis mulai dari berkas yang benar tanpa tahu apa-apa soal tahap baru ini.

Yang ditambahkan:

```ts
export type EnhanceRenderer = (source: Blob) => Promise<Blob | null>

export interface EnhanceOutcome {
  changed: number     // dirender (atau dihapus) di jalan ini
  skipped: number     // sudah sesuai, dilewati
  unchanged: number   // estimator menolak — halaman dibiarkan
  failed: number      // render melempar
  cancelled: boolean
}

export async function applyDocumentEnhance(
  docId: string,
  enabled: boolean,
  renderEnhance: EnhanceRenderer,
  renderFilter: FilterRenderer,
  renderMarks: MarkRenderer,
  options?: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal },
): Promise<{ document: LocalScanDocument; outcome: EnhanceOutcome }>

export async function applyPageEnhance(
  docId: string,
  pageIndex: number,
  render: EnhanceRenderer,
): Promise<LocalScanDocument>
```

`renderFilter` dan `renderMarks` ikut karena menyalakan/mematikan tahap ini mengubah **sumber** render filter, jadi filter dan tinta di bawahnya wajib dirender ulang — itu justru `renderPageDerived` yang sudah ada, dipakai apa adanya.

### 6.2 Pembatalan, dan kenapa `signal` bukan `onProgress` saja

`applyDocumentFilter` punya `onProgress` tapi tidak punya pembatalan, dan itu bisa diterima karena filter dipakai di dokumen yang halamannya terbatas dan biayanya beberapa detik. Perbaiki Pencahayaan mendekode ulang tiap halaman pada resolusi penuh, dan **Pro tidak punya batas jumlah halaman**. Satu dokumen 60 halaman tanpa tombol Batal berarti user hanya bisa membunuh aplikasi.

`signal?.aborted` diperiksa **di awal tiap halaman**, bukan di tengah render satu halaman: menghentikan satu halaman di tengah jalan hanya akan menyisakan berkas setengah tertulis.

### 6.3 Apa yang tersisa setelah dibatalkan

Index tetap ditulis dengan halaman yang sudah selesai, dan sakelar `enhance` diisi sesuai **niat user** (`enabled`), bukan sesuai berapa yang sempat selesai. Jadi keadaan setengah jalan itu:

- **terlihat** — panel bilang "12 dari 20 halaman", dengan tombol "Lanjutkan";
- **bisa dilanjutkan** — jalan berikutnya melewati halaman yang sudah punya `enhanced` (saat menyalakan) atau yang sudah tidak punya (saat mematikan), jadi melanjutkan hanya membayar sisanya;
- **tidak merusak apa pun** — `original` dan `edited` tidak pernah disentuh di jalur ini.

Halaman yang ditolak estimator (4.3) tidak akan pernah punya `enhanced`, jadi hitungan "12 dari 20" bisa berhenti di bawah total selamanya untuk dokumen semacam itu. Itu sebabnya hasil tiap jalan dilaporkan lewat toast (`describeEnhanceOutcome`), mengikuti pola `describeOcrOutcome` yang sudah ada — kalau angkanya tidak pernah penuh, user diberi tahu alasannya, bukan dibiarkan menekan "Lanjutkan" berulang tanpa penjelasan.

### 6.4 Setelah crop/rotate

`savePageEdit` dan `resetPageEdit` membuang berkas turunan yang geometrinya sudah tidak berlaku. `enhanced` masuk daftar itu — ia dibuat dari geometri lama persis seperti `filtered`.

Yang mengisinya kembali adalah `documentEditing.rebuildDerived`, yang kini memanggil `applyPageEnhance` **lebih dulu** (hanya kalau `doc.enhance === true`), baru `applyPageDerived`. Dua penulisan index berturut-turut, bukan satu — tapi tiap tahap tetap dirender **sekali**, dan itu yang mahal. Menggabungnya berarti membongkar tanda tangan `applyPageDerived`, yang sudah ditolak di 6.1.

## 7. UI

**Di editor, bukan di layar detail.** OCR dapat barisnya sendiri di `DocumentDetailScreen` karena hasilnya bukan gambar. Perbaiki Pencahayaan mengubah tampilan halaman, jadi ia harus berada di tempat user melihat halamannya sambil mengubahnya — dan di sebelah Filter, karena keduanya dipakai bersamaan.

- Baris tombol dokumen di `EditorScreen` naik dari dua jadi tiga: **Filter · Urutkan · Cahaya**, ikon baru `SunIcon`.
- Mode baru `'enhance'` membuka `EnhancePanel`, judul header **"Perbaiki Pencahayaan"**.
- Panel berisi: sakelar dua pilihan **Nonaktif / Aktif** (memakai kelas `.filter-scope` yang sudah dipakai bersama `.format-switch`), satu baris keterangan, baris progres saat berjalan, dan tombol **Batal**.
- **Tidak ada badge Pro, tidak ada jalur upgrade.** Ini bukan kelalaian — ini keputusan tier di kepala dokumen ini.
- **Tidak ada kata "AI" di mana pun di panel ini.** Ada tes komponen yang menjaga itu, karena aturannya mengikat dan pelanggarannya berupa satu kata yang mudah lolos review.

Copy yang dipakai:

| Tempat | Teks |
|---|---|
| Tombol editor | `Cahaya` |
| Judul panel | `Perbaiki Pencahayaan` |
| Keterangan | `Meratakan cahaya dan menghapus bayangan sebelum filter diterapkan.` |
| Sakelar | `Nonaktif` / `Aktif` |
| Progres | `Memperbaiki halaman 3 dari 20…` |
| Sebagian | `12 dari 20 halaman diperbaiki` + tombol `Lanjutkan` |
| Toast selesai | `Pencahayaan 20 halaman diperbaiki.` / `Perbaikan pencahayaan dimatikan.` |
| Toast sebagian | `Pencahayaan 18 halaman diperbaiki, 2 halaman dilewati.` |

## 8. Gerbang pengukuran

Ini **bukan** pemeriksaan di akhir; ini gerbang yang menghentikan rancangan UI kalau angkanya jelek — begitu bunyi keputusan brainstorm.

Setelah `enhancePage()` ada (Task 2) dan **sebelum** UI dibuat (Task 7), ukur di Chromium pada halaman 3000×4000 sungguhan, lalu **kalikan 4** sebagai proyeksi mid-range (baseline device: Xiaomi T15 flagship — kalau ia terasa lambat, mid-range jauh lebih parah).

- **Proyeksi 20 halaman ≤ ±30 detik** → lanjut sesuai rancangan ini.
- **Lebih dari itu** → **berhenti dan lapor ke Boss Ali**. Dua arah yang sudah dipikirkan: turunkan resolusi kerja koreksi (koreksi di citra setengah lalu upsample gain-nya), atau jalankan hanya saat menyimpan/ekspor, bukan saat sakelar dinyalakan. Keduanya mengubah rancangan UI, jadi tidak boleh diputuskan setelah UI-nya jadi.

Angkanya dicatat di `TASKS.md` Fase 7A, bukan hanya di transcript.

## 9. Sengaja di luar versi pertama

- **Noise reduction & peningkatan ketajaman.** PRD Bagian 4 menyebut keduanya sebagai cakupan; keduanya **tidak** ada di sini. Alasannya di `TASKS.md`: denoise dan sharpening berlawanan arah dan versi setengah matang lebih buruk daripada tidak ada, sementara di situlah model belajar mengalahkan matematika klasik. Sudah tercatat sebagai known gap supaya tidak muncul sebagai kejutan saat QA Fase 9.
- **ReviewScreen (sebelum dokumen disimpan).** Sakelarnya per dokumen tersimpan; halaman yang belum disimpan belum punya index untuk menyimpan `enhance`. Bisa menyusul, bukan bagian dari 7A.
- **7B (auto-deskew & auto-crop).** Subsistem terpisah, belum di-brainstorm.
- **Pratinjau sebelum-sesudah.** Halaman di belakang panel sudah menampilkan hasilnya begitu jalan selesai; membangun pratinjau berdampingan berarti me-render halaman dua kali untuk gambar sebesar perangko.

## 10. Rencana pengujian

| Lapis | Suite | Yang dibuktikan |
|---|---|---|
| `enhance.ts` | node | Peta cahaya mengikuti bayangan; ubin tinta ditambal, bukan diikuti; tidak pernah menggelapkan; batas 2,5× ditegakkan; katup batal mengembalikan `null`; halaman hitam dibiarkan |
| `enhancePage()` | browser (Chromium) | Keluarannya JPEG sungguhan (`ff d8 ff`), ukuran piksel sama, beda kertas kiri-kanan mengecil, `null` diteruskan apa adanya |
| Bench | browser | Angka milidetik per halaman 12 MP untuk gerbang Bagian 8 |
| Migrasi v6 | node | v5 naik tanpa kehilangan apa pun; `enhanced` gugur kalau sakelarnya mati; urutan rantai benar di empat fungsi resolusi |
| Penyimpanan | node | Render mulai dari berkas yang benar; filter dirender ulang di atas hasil koreksi; batal berhenti dan menyimpan yang sudah jadi; lanjut melewati yang sudah selesai; sakelar mati membersihkan berkas |
| Panel | browser | Keadaan sakelar, kunci saat berjalan, catatan sebagian, **dan tidak ada kata "AI"** |

Tidak ada canvas yang di-mock — `CLAUDE.md` Bagian 4: yang terbukti dari canvas palsu cuma bahwa palsunya dipanggil.

## 11. Seam untuk versi model

Ketika model TFLite ada, yang berubah hanya isi `enhancePage()` di `imageEditor.ts` (atau modul baru yang dipanggil dari sana) — plus satu gerbang tier, karena versi model **memang** Pro-exclusive. Tidak ada perubahan schema, tidak ada perubahan penyimpanan, tidak ada perubahan UI selain nama yang saat itu boleh jadi "AI Enhance". Itulah yang dibeli dengan menaruh tahap ini di rantai turunan sebagai tahapnya sendiri, bukan sebagai chip filter.
