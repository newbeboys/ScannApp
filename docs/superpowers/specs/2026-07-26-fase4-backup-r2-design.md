# Fase 4 — Backup ke Cloudflare R2 (desain)

Tanggal: 2026-07-26
Status: disetujui Boss Ali, siap diimplementasi

Menutup task Fase 4 di `TASKS.md`. Alur dan kontrak API mengikuti `BACKEND_API_DESIGN.md`; angka kuota mengikuti `CLAUDE.md` Bagian 6.

---

## 1. Keputusan Boss Ali di sesi ini

| Pertanyaan | Keputusan |
|---|---|
| Apa yang diunggah? | **PDF hasil export saja**, satu file per dokumen — sesuai `scan_documents.r2_object_key` yang memang tunggal |
| Termasuk pemulihan? | **Ya.** Layar "Cadangan di cloud" dengan tombol unduh per dokumen |
| Kuota Pro dari referral | **500 MB**, sama seperti Pro Bulanan (angka baru, belum ada di dokumen sebelumnya) |

Konsekuensi keputusan pertama: dokumen yang dipulihkan kembali sebagai PDF utuh, bukan halaman terpisah yang bisa di-crop ulang. Ini diterima — yang dicadangkan adalah berkasnya, bukan sesi editnya.

## 2. Alur

Persis diagram `BACKEND_API_DESIGN.md` Bagian 8 — tidak ada komponen infrastruktur baru (tanpa Cloudflare Worker, sesuai `CLAUDE.md` Bagian 6).

```
Client                     Edge Function                    R2
  │── minta URL upload ────────>│ verifikasi JWT + cek kuota
  │<── signed URL (10 menit) ───│
  │── PUT PDF langsung ke R2 ──────────────────────────────>│
  │── confirm-upload ──────────>│ tulis scan_documents + bytes_used
  │<── OK ──────────────────────│
```

File besar tidak melewati compute Supabase. Penandatanganan SigV4 memakai `aws4fetch` — pustaka kecil yang berjalan di Deno. Ini bukan dependency AI cloud, jadi tidak menyentuh aturan #4 `CLAUDE.md`.

## 3. Empat Edge Function

Semua memverifikasi JWT lewat `supabase.auth.getUser()` di awal dan menolak request tanpa token yang sah. Operasi tulis memakai secret `ScannAppsecret` (service role) karena harus melewati RLS.

**`generate-upload-url`** — terima `document_id`, `file_size_bytes`, `title`, `page_count`. Hitung kuota efektif dari profil, selaraskan `storage_usage.quota_bytes`, tolak dengan `409 QUOTA_EXCEEDED` bila `bytes_used - ukuran_lama + ukuran_baru > quota_bytes`. Bila lolos, kembalikan presigned PUT untuk `users/{user_id}/{document_id}.pdf`, berlaku 10 menit.

**`confirm-upload`** — upsert baris `scan_documents` (`local_only = false`, `r2_object_key`, `file_size_bytes`, `export_format = 'pdf'`), lalu sesuaikan `storage_usage.bytes_used` dengan **selisih** ukuran lama dan baru.

**`generate-download-url`** — verifikasi `owner_id`, kembalikan presigned GET 10 menit.

**`delete-backup`** — verifikasi kepemilikan, hapus object R2, kurangi `bytes_used`, lalu hapus baris `scan_documents`. Object R2 yang sudah hilang tidak dianggap error (operasi tetap idempoten).

## 4. Tiga lubang di rancangan lama yang ditutup di sini

**a. Baris `scan_documents` belum pernah dibuat.** Sampai Fase 3 selesai, tabel itu kosong — dokumen hanya hidup di index JSON lokal. Barisnya sekarang lahir dari `confirm-upload` di sisi server, memakai id lokal dokumen sebagai primary key. Satu dokumen, satu identitas di HP dan di cloud. Dokumen yang tidak pernah dicadangkan tetap tidak punya baris sama sekali — tetap local-first.

**b. Kuota tidak pernah naik saat user jadi Pro.** `quota_bytes` diisi 100 MB oleh trigger signup dan tidak ada apa pun yang mengubahnya. Alih-alih menambah job terjadwal, `generate-upload-url` menghitung ulang kuota efektif setiap kali dipanggil dan menyelaraskan kolomnya:

| Tier efektif | Kuota |
|---|---|
| Basic | 100 MB (104.857.600) |
| Pro Bulanan | 500 MB (524.288.000) |
| Pro Tahunan | 1 GB (1.073.741.824) |
| Pro dari referral | 500 MB (524.288.000) |

Tier efektif dihitung dengan aturan yang sama seperti client (`src/lib/tier.ts`): Pro tanpa `tier_expires_at` atau yang tanggalnya sudah lewat dihitung Basic. Logika ini sengaja ditulis ulang di `supabase/functions/_shared/` karena berjalan di runtime berbeda (Deno vs bundel browser); keduanya punya test sendiri agar tidak diam-diam berbeda.

**c. Backup ulang bisa menggandakan hitungan.** Dokumen yang dicadangkan dua kali (misalnya setelah diedit) akan menimpa object yang sama. Karena itu `bytes_used` disesuaikan dengan selisih, bukan ditambah penuh — dan pemeriksaan kuota di `generate-upload-url` juga memakai selisih supaya mengganti file 2 MB dengan file 2 MB tidak pernah ditolak meski kuota nyaris penuh.

## 5. Saat kuota penuh

Upload baru ditolak dengan pesan berbahasa Indonesia yang menyebut angka sebenarnya. **File yang sudah ada tidak pernah dihapus otomatis** — termasuk saat hadiah Pro seseorang berakhir dan kuotanya turun dari 500 MB ke 100 MB. Dalam kondisi itu pemakaian boleh melebihi kuota; yang diblokir hanya penambahan baru. Kehilangan data karena downgrade tidak boleh terjadi.

## 6. Modul & layar

| Berkas | Isi |
|---|---|
| `supabase/functions/_shared/quota.ts` | `QUOTA_BYTES`, tier efektif, `quotaBytesFor` — murni, punya test |
| `supabase/functions/_shared/storageKey.ts` | `buildObjectKey(userId, documentId)` |
| `supabase/functions/_shared/http.ts` | CORS, pembacaan JWT, pembungkus respons JSON |
| `supabase/functions/_shared/r2.ts` | Klien R2: presign PUT/GET, delete object |
| `src/lib/backupApi.ts` | Pemanggil keempat Edge Function dari client |
| `src/lib/formatBytes.ts` | "12,4 MB" dengan pemisah desimal Indonesia — punya test |

Layar: baris "Cadangkan ke cloud" di `DocumentDetailScreen`, bar kuota di `SettingsScreen`, dan layar baru `CloudBackupScreen` (daftar cadangan + unduh + hapus).

`exportPdf` di `src/lib/documentExport.ts` dijadikan fungsi terekspor agar byte PDF yang sama bisa dipakai untuk backup — supaya file yang dicadangkan identik dengan yang diekspor user, termasuk watermark Basic.

## 7. Pengujian

Unit test (melanjutkan 59 test Fase 3): tabel kuota per tier, tier kedaluwarsa turun ke Basic, perhitungan selisih kuota (mengganti file berukuran sama tidak ditolak saat hampir penuh), pembentukan object key, dan format ukuran berbahasa Indonesia. `vitest.config.ts` diperluas agar ikut menjalankan test di `supabase/functions/`.

Uji nyata setelah deploy: unggah satu dokumen sungguhan dari akun demo ke bucket `scanappstorage`, cek object benar-benar ada lewat MCP Cloudflare, cek `bytes_used` bertambah, unduh kembali, lalu hapus dan pastikan hitungannya kembali nol.

## 9. CORS bucket R2 — langkah manual yang wajib

Bucket R2 tidak punya kebijakan CORS secara bawaan, sehingga `PUT` dari WebView ke signed URL diblokir di tahap preflight. Ini ditemukan saat menguji lewat browser; uji lewat PowerShell tidak bisa menangkapnya karena bukan browser yang mengirim.

Kredensial R2 yang tersimpan di Edge Function Secrets hanya punya izin **Object Read & Write**, sedangkan `PutBucketCors` menuntut izin Admin — jadi jalur otomatis (`supabase/functions/admin-set-r2-cors/index.ts`, sumbernya tetap disimpan) berakhir `403 AccessDenied`. Deployment fungsi itu sudah dilumpuhkan.

Pasang lewat dashboard Cloudflare: **R2 → bucket `scanappstorage` → Settings → CORS Policy**, isi dengan:

```json
[
  {
    "AllowedOrigins": [
      "https://localhost",
      "http://localhost",
      "capacitor://localhost",
      "http://localhost:5173",
      "http://localhost:5199"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Tiga origin pertama untuk aplikasi Android (Capacitor), dua terakhir untuk `npm run dev`. Kalau nanti ada versi web di domain sendiri, tambahkan domainnya ke daftar. Membuka kebijakan ke `"*"` sebenarnya juga aman karena setiap URL sudah ditandatangani dan berumur 10 menit, tapi membatasi origin tidak merugikan apa pun.

Mengunduh **tidak** terpengaruh — cadangan dibuka lewat navigasi tab, bukan `fetch`, jadi CORS tidak berlaku di sana.

## 8. Ditunda dengan sengaja

Rate limiting 30 request/menit (`BACKEND_API_DESIGN.md` Bagian 9, kata-katanya "sebaiknya") ditunda ke Fase 9 bersama uji kuota dan pembersihan object yatim yang sudah terdaftar di sana. Menambahkannya sekarang berarti membangun tabel penghitung untuk masalah yang belum punya pengguna.

## 9. Adendum keamanan (22 Agustus 2026)

Ditemukan saat code-review Fase 5. Dua lubang di Fase 4 yang membolehkan penyimpanan R2 tanpa batas dan pengambilalihan metadata dokumen. Keduanya sudah ditutup; bagian ini mencatat sebabnya supaya polanya tidak terulang.

### 9.1 Kuota bisa dilewati — dari dua arah

Perhitungan kuota memakai `bytes_used - ukuran_lama + ukuran_baru` (Bagian 4c). Rumusnya benar; yang salah adalah **dari mana kedua angka itu datang**. Keduanya bisa dikendalikan client:

**Arah pertama — `ukuran_lama` (`replacing`).** Policy `scan_documents_insert_own` & `scan_documents_update_own` mengizinkan client menulis barisnya sendiri, termasuk kolom `file_size_bytes`. Isi kolom itu dengan angka raksasa, maka `growth` selalu negatif dan `fitsInQuota()` meloloskan unggahan sebesar apa pun. `confirm-upload` lalu menghitung `bytes_used` jatuh ke 0.

**Arah kedua — `ukuran_baru` (`incoming`).** `generate-upload-url` hanya memeriksa ukuran yang **diklaim** client, dan presigned PUT tidak membawa batas panjang sama sekali. Jadi: klaim 1 KB, unggah 5 GB, konfirmasi 1 KB.

Menutup satu arah saja tidak ada gunanya — hasil akhirnya sama.

Perbaikannya:

- Migration `20260822130000` **mencabut policy INSERT/UPDATE/DELETE** pada `scan_documents`. Client memang tidak pernah menulis tabel ini; penulisnya cuma `confirm-upload` dan `delete-backup` yang memakai service role. Ini menyamakan `scan_documents` dengan `storage_usage` dan `referral_events` yang sejak awal hanya punya policy SELECT. Policy SELECT dibiarkan — `listCloudBackups()` membacanya langsung dan itu aman.
- `confirm-upload` **mengukur ukuran sebenarnya dari R2** lewat `headObjectSize()`, bukan mempercayai angka dari client, lalu memeriksa kuota ulang terhadap angka itu. Kalau melebihi kuota, object-nya dihapus dan dibalas `409 QUOTA_EXCEEDED` — membiarkannya berarti tetap membayar penyimpanannya padahal tidak ada baris database yang menunjuk ke sana.

Pemeriksaan di `generate-upload-url` tetap ada dan tetap berguna: menolak lebih awal jauh lebih murah daripada membiarkan unggahan 5 GB berjalan sampai selesai baru ditolak. Ia sekarang berperan sebagai saringan pertama, bukan penjaga terakhir.

### 9.2 `confirm-upload` bisa merebut dokumen orang lain

Fungsi ini melakukan `upsert` dengan `onConflict: 'id'` memakai service role, tanpa memeriksa kepemilikan. Siapa pun yang tahu sebuah `document_id` bisa memanggilnya dan menimpa `owner_id` baris itu jadi miliknya — korban kehilangan baris metadata, dan cadangan R2-nya jadi yatim tanpa ada yang mengurangi `bytes_used` miliknya.

Diganti dengan **update-lalu-insert**, bukan cek-lalu-tulis: `update` dibatasi `owner_id = user.id`, dan kalau tidak ada baris yang cocok, `insert` membiarkan primary key yang memutuskan. Galat `23505` di situ berarti id-nya milik akun lain, dan database menetapkannya secara atomik — tidak ada celah balapan antara pemeriksaan dan penulisan.

`delete-backup` dan `generate-download-url` sudah benar sejak awal (keduanya memfilter `owner_id` dan memakai `isOwnedBy`), jadi tidak berubah.
