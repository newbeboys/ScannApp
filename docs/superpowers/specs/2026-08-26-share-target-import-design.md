# Impor via share sheet Android — gambar & PDF

**26 Agustus 2026.** Dipicu temuan Boss Ali saat uji manual: berbagi file dari WPS Office dan CamScanner tidak menampilkan ScannApp di daftar "Bagikan ke...". Bukan soal Play Store — kemunculan di share sheet ditentukan murni lokal oleh `intent-filter` di `AndroidManifest.xml`, dibaca `PackageManager` saat install, tidak peduli status publikasi. Penyebab sebenarnya: fitur ini memang belum pernah dibangun — tidak ada `intent-filter` untuk `ACTION_SEND`, tidak ada plugin penerimanya, tidak tercatat di manapun di `TASKS.md`/PRD.

**Tier: semua tier.** Menerima file itu soal akses, bukan mesin baru — pola yang sama dengan reorder/filter/PNG/anotasi/pisah (CLAUDE.md Bagian 6).

---

## 1. Cakupan

**Sesi ini: gambar (JPG/PNG) dan PDF saja**, masuk lewat alur review yang sudah ada.

**Ditunda ke spec terpisah:** menerima `.docx` (atau tipe berkas non-gambar lain) sebagai "lampiran mentah". Alasan dipisah: `LocalScanDocument` ( `scanIndexMigration.ts` ) strict berbentuk `pages: ScanPage[]`, dan asumsi itu dipakai di 31 berkas (daftar dokumen, detail, merge, split, export, kuota, OCR, cloud backup). Sebuah "kind" dokumen baru tanpa `pages` berarti cabang baru di sebagian besar dari 31 tempat itu — subsistem sendiri, bukan bagian kecil dari fitur share-target. CLAUDE.md Bagian 1: satu subsistem per sesi.

---

## 2. Kenapa PDF butuh rasterisasi, bukan reuse `pdfImport.ts`

`pdfImport.ts` (`readBackup`) sudah ada dan membaca PDF jadi gambar per halaman — tapi hanya jalan untuk PDF **buatan ScannApp sendiri**: `buildPdf` menaruh tepat satu JPEG mentah (`DCTDecode`) per halaman, jadi membacanya balik itu pencarian XObject, bukan render. PDF dari CamScanner/WPS tidak menjamin bentuk itu — bisa berisi banyak objek gambar per halaman, encoding beda, atau elemen non-gambar. `readBackup` akan gagal diam-diam atau salah pada PDF pihak ketiga.

**Solusi: `android.graphics.pdf.PdfRenderer`** — API bawaan Android sejak API 21, bukan dependency baru. Konsisten dengan pola proyek (OCR & DOCX writer juga dipilih on-device, nol dependency baru). Tiap halaman dirender ke bitmap → JPEG di cache app, sisi terpanjang ditarget ~2400px (setara preset Standar). Batas ~50 halaman per PDF yang dibagikan — angka teknis untuk mencegah hang di file raksasa, bukan angka bisnis.

---

## 3. Native — manifest & plugin

### 3.1 `AndroidManifest.xml`

Tambah `intent-filter` pada `<activity>` `MainActivity` yang sudah ada (selain MAIN/LAUNCHER), terpisah per kombinasi action+mimeType (pola standar Android, satu `<data>` per filter):

- `ACTION_SEND` + `image/*`
- `ACTION_SEND` + `application/pdf`
- `ACTION_SEND_MULTIPLE` + `image/*`

`MainActivity` sudah `launchMode="singleTop"` — share masuk saat app berjalan tidak membuat instance baru, cukup `onNewIntent`. `BridgeActivity` (kelas induk) sudah meneruskan `onNewIntent` ke tiap plugin lewat `Bridge`, jadi `MainActivity.java` sendiri tidak perlu override `onNewIntent` manual — cukup mendaftarkan plugin baru di `onCreate` (sebelum `super.onCreate`).

### 3.2 Plugin `SharedImportPlugin`

Berkas baru: `android/app/src/main/java/com/newbeboys/scannapp/SharedImportPlugin.java`.

- `load()` — dipanggil sekali saat bridge siap. Cek `getActivity().getIntent()`: kalau app dibuka dingin lewat share, intent-nya ada di sini.
- `handleOnNewIntent(Intent)` — dipanggil otomatis oleh bridge saat share masuk ke app yang sudah berjalan.
- Kedua jalur bermuara ke satu fungsi pemroses: baca `EXTRA_STREAM` (URI tunggal untuk `SEND`, `ArrayList<Uri>` untuk `SEND_MULTIPLE`), saring hanya `image/*` dan `application/pdf` per item (mimeType dari `ContentResolver`, bukan cuma percaya ekstensi nama file), lalu:
  - Gambar → disalin langsung ke cache app lewat `ContentResolver.openInputStream` (izin baca `content://` dari share cuma valid selama diproses, jadi harus segera).
  - PDF → dirender per halaman lewat `PdfRenderer` (lihat §2), tiap halaman jadi satu JPEG di cache.
- Hasil disangga jadi satu daftar path `file://` terurut, lalu dikirim ke JS lewat event `sharedFilesReceived`. Kalau belum ada listener JS terpasang saat event ditembak (kasus dingin), plugin menyimpannya sampai `getPendingShare()` dipanggil — idiom yang sama dengan `App.getLaunchUrl()` bawaan Capacitor.

---

## 4. Jembatan JS — `src/lib/sharedImport.ts`

Pola yang sama dengan `documentScanner.ts`: satu-satunya berkas yang tahu plugin native ini ada, mengonversi tiap path lewat `Capacitor.convertFileSrc` sebelum diserahkan ke pemanggil, supaya tidak ada URI mentah bocor ke UI.

```ts
export interface SharedImportResult {
  images: string[] // sudah convertFileSrc, urutan dipertahankan
}

export function onSharedFilesReceived(cb: (result: SharedImportResult) => void): () => void
export async function getPendingSharedFiles(): Promise<SharedImportResult>
```

Tidak ada implementasi web/iOS — plugin Android-only, sama seperti `documentScanner.ts` menyatakan itu di komentarnya.

---

## 5. Integrasi `App.tsx`

Dipasang sekali saat mount: daftarkan `onSharedFilesReceived`, dan panggil `getPendingSharedFiles()` untuk menangkap share yang membuka app dari kondisi dingin. Keduanya bermuara ke satu handler, mengikuti pola `handleStartScan`/`handleAddPages` yang sudah ada:

- `pendingPages` kosong → sama seperti `handleStartScan`: isi `pendingPages` dengan hasilnya, buka `ReviewScreen` (yang sudah dirender tanpa syarat tab saat `pendingPages` terisi — lihat `App.tsx:892`).
- `pendingPages` sudah terisi (user sedang di tengah review scan lain) → **append**, sama seperti `handleAddPages`. Tidak pernah menimpa kerja yang belum disimpan.

Tidak ada layar baru. 100% reuse `ReviewScreen` — crop, filter, reorder, simpan berjalan persis seperti untuk hasil kamera.

---

## 6. Penanganan error

| Kondisi | Perilaku |
|---|---|
| Mime type di luar `image/*`/`application/pdf` lolos ke plugin | Diabaikan per item, bukan gagal total |
| Semua item dalam satu share ditolak | Toast: "Format file ini tidak didukung." |
| PDF gagal dibuka `PdfRenderer` (korup/terenkripsi) | PDF itu dilewati, toast: "Sebagian file tidak bisa dibuka." |
| Share tanpa `EXTRA_STREAM` valid / kosong | Tidak melakukan apa-apa — tidak membuka review dengan 0 halaman |
| PDF > 50 halaman | Dipotong di 50, tanpa gagal total (angka teknis, boleh disetel ulang) |

---

## 7. Berkas yang disentuh

**Baru:**
- `android/app/src/main/java/com/newbeboys/scannapp/SharedImportPlugin.java`
- `src/lib/sharedImport.ts` + `sharedImport.test.ts`

**Disentuh:**
- `android/app/src/main/AndroidManifest.xml` (intent-filter)
- `android/app/src/main/java/com/newbeboys/scannapp/MainActivity.java` (registerPlugin)
- `src/App.tsx` (wiring ke `pendingPages`)
- `TASKS.md`

---

## 8. Rencana test

Suite **node**: `sharedImport.ts` dites dengan plugin native di-mock (persis pola `documentScanner.test.ts` memock `@capacitor-mlkit/document-scanner`) — kontrak `onSharedFilesReceived`/`getPendingSharedFiles`, urutan hasil dipertahankan, `convertFileSrc` diterapkan ke tiap path.

Logika append-vs-replace ke `pendingPages` di `App.tsx`: tidak ada `App.browser.test.tsx` hari ini (dicek — belum pernah dibuat), dan `handleStartScan`/`handleAddPages` yang sudah ada pun tidak punya test komponen. Titik integrasi baru ini mengikuti pola yang sama: diverifikasi manual di HP (lihat §9), bukan dipaksa jadi test baru untuk satu pemanggilan state setter.

**Kode Java native (manifest, `PdfRenderer`, penyalinan `content://`) tidak tercakup vitest sama sekali** — di luar jangkauan kedua suite, murni Android. Verifikasi lewat daftar uji HP di bawah.

---

## 9. Daftar uji di HP (butuh Boss Ali)

- [ ] Share 1 foto dari galeri/app lain ke ScannApp saat app tertutup → app terbuka, langsung di layar review dengan foto itu
- [ ] Share 1 foto saat ScannApp sedang di foreground (bukan di tengah review) → langsung ke review
- [ ] Share saat sedang di tengah review scan lain yang belum disimpan → foto baru **ditambahkan**, bukan menimpa halaman yang sudah ada
- [ ] Share beberapa foto sekaligus (pilih multi di galeri → share) → semua masuk sebagai halaman, urutannya sesuai
- [ ] Share PDF dari WPS Office → tiap halaman PDF jadi halaman terpisah di review, kualitas gambar terbaca jelas
- [ ] Share PDF hasil CamScanner → sama, dan pastikan bukan cuma halaman pertama yang muncul
- [ ] Share file docx dari WPS Office → **tidak muncul** di daftar app (mime type tidak didaftarkan di manifest sesi ini) — perilaku yang diharapkan, bukan bug
- [ ] Share PDF terenkripsi/rusak sengaja → toast error, app tidak crash
- [ ] Ukuran APK & waktu build setelah plugin Java baru — tidak ada regresi mencolok
