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

- **Cukup satu override: `handleOnNewIntent(Intent)`.** Dicek langsung di source `BridgeActivity.java` (node_modules): `onCreate` → `load()` sudah memanggil `this.onNewIntent(getIntent())` di baris terakhirnya, yang dari `BridgeActivity.onNewIntent` diteruskan ke `Bridge.onNewIntent(intent)`, yang memanggil `handleOnNewIntent` di **setiap plugin terdaftar** — termasuk untuk intent peluncuran awal. Jadi kasus dingin (app dibuka lewat share) dan kasus hangat (`singleTop` menerima intent baru saat app jalan) lewat satu jalur kode yang sama persis. Tidak perlu override `load()` terpisah.
- Fungsi pemroses tunggal: baca `EXTRA_STREAM` (URI tunggal untuk `SEND`, `ArrayList<Uri>` untuk `SEND_MULTIPLE`), saring hanya `image/*` dan `application/pdf` per item (mimeType dari `ContentResolver`, bukan cuma percaya ekstensi nama file), lalu:
  - Gambar → disalin langsung ke cache app lewat `ContentResolver.openInputStream` (izin baca `content://` dari share cuma valid selama diproses, jadi harus segera).
  - PDF → dirender per halaman lewat `PdfRenderer` (lihat §2), tiap halaman jadi satu JPEG di cache.
- Hasil disangga jadi satu daftar path `file://` terurut, lalu dikirim ke JS lewat `notifyListeners("sharedFilesReceived", data, /* retainUntilConsumed */ true)`. Argumen ketiga itu bawaan Capacitor (dicek di `Plugin.java`): kalau belum ada listener JS terpasang saat event ditembak — persis kasus dingin, karena `handleOnNewIntent` jalan sebelum WebView sempat memanggil `addListener` — Capacitor sendiri yang menyimpannya di `retainedEventArguments` dan mengirimkannya begitu listener pertama didaftarkan. Tidak perlu penyangga buatan sendiri atau method pull terpisah.

---

## 4. Jembatan JS — `src/lib/sharedImport.ts`

Pola yang sama dengan `documentScanner.ts`: satu-satunya berkas yang tahu plugin native ini ada, mengonversi tiap path lewat `Capacitor.convertFileSrc` sebelum diserahkan ke pemanggil, supaya tidak ada URI mentah bocor ke UI.

```ts
export interface SharedImportResult {
  images: string[] // sudah convertFileSrc, urutan dipertahankan
  skippedCount: number // lihat §6 -- item yang gagal menghasilkan halaman
}

export function onSharedFilesReceived(cb: (result: SharedImportResult) => void): () => void
```

Tidak ada implementasi web/iOS — plugin Android-only, sama seperti `documentScanner.ts` menyatakan itu di komentarnya.

---

## 5. Integrasi `App.tsx`

Dipasang sekali saat mount: daftarkan `onSharedFilesReceived`. Berkat `retainUntilConsumed` (§3.2), satu listener ini saja sudah menangkap baik share yang membuka app dari kondisi dingin maupun share yang masuk saat app sudah berjalan — tidak ada method pull terpisah yang perlu dipanggil. Mengikuti pola `handleStartScan`/`handleAddPages` yang sudah ada:

- `images.length === 0` → tidak melakukan apa-apa selain toast (lihat §6), `pendingPages` tidak disentuh.
- `pendingPages` kosong → sama seperti `handleStartScan`: isi `pendingPages` dengan hasilnya, buka `ReviewScreen` (yang sudah dirender tanpa syarat tab saat `pendingPages` terisi — lihat `App.tsx:892`).
- `pendingPages` sudah terisi (user sedang di tengah review scan lain) → **append**, sama seperti `handleAddPages`. Tidak pernah menimpa kerja yang belum disimpan.
- `skippedCount > 0` → `setToast(...)` dengan salah satu dari dua pesan di §6, tergantung apakah `images` ikut berisi sesuatu atau tidak.

Tidak ada layar baru. 100% reuse `ReviewScreen` — crop, filter, reorder, simpan berjalan persis seperti untuk hasil kamera.

---

## 6. Penanganan error

Native menghitung, JS yang menyapa user — plugin tidak tahu kata-kata apa yang pas untuk toast, jadi ia cuma melaporkan angka. Payload event `sharedFilesReceived` membawa `skippedCount` di samping `paths`: jumlah item dalam share yang gagal menghasilkan satu pun halaman (mime type tidak dikenali, atau `PdfRenderer` gagal buka file korup/terenkripsi). Dua penyebab itu digabung jadi satu angka, bukan dua field terpisah — dalam praktiknya nyaris selalu berarti "file rusak", karena manifest (§3.1) sudah menyaring tipe di level Android sebelum ScannApp ditawarkan sebagai tujuan sama sekali; kasus tipe campuran dalam satu `SEND_MULTIPLE` cukup jarang untuk tidak perlu pesan terpisah.

| Kondisi | Perilaku |
|---|---|
| `paths` berisi hasil, `skippedCount` 0 | Langsung ke review, tanpa toast |
| `paths` berisi hasil, `skippedCount` > 0 | Tetap ke review dengan yang berhasil, toast: "Sebagian file tidak bisa diimpor." |
| `paths` kosong, `skippedCount` > 0 | Tidak membuka review, toast: "Tidak ada file yang bisa diimpor." |
| Share tanpa `EXTRA_STREAM` valid / kosong (keduanya nol) | Event tidak dikirim sama sekali — tidak melakukan apa-apa |
| PDF > 50 halaman | Dipotong di 50, halaman yang terpotong tidak dihitung sebagai skip (angka teknis, boleh disetel ulang) |

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

Suite **node**: `sharedImport.ts` dites dengan plugin native di-mock (persis pola `documentScanner.test.ts` memock `@capacitor-mlkit/document-scanner`) — kontrak `onSharedFilesReceived`, urutan hasil dipertahankan, `convertFileSrc` diterapkan ke tiap path.

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
