# Halaman Legal — Hapus Akun (Fase 8.5a)

**Status: SUDAH TAYANG** sejak 5 September 2026, commit
[`e362ba9`](https://github.com/newbeboys/scannapp-legal/commit/e362ba9) di repo
[`newbeboys/scannapp-legal`](https://github.com/newbeboys/scannapp-legal).
Dokumen ini menyimpan alasan tiap perubahannya, karena repo legal itu terpisah
dan tidak punya tempat untuk catatan sepanjang ini.

| URL | Sebelum | Sesudah |
|---|---|---|
| `https://newbeboys.github.io/scannapp-legal/` | **404** | **200** |
| `.../index.html` | tidak ada | **200** (baru) |
| `.../privacy-policy.html` | 200 | 200, +bagian 07 |
| `.../terms-of-service.html` | 200 | 200 |
| `.../confirmed.html` | 200 | 200 (tidak disentuh) |

---

## 1. Kenapa root-nya 404, dan apa yang memperbaikinya

Bukan salah konfigurasi. GitHub Pages-nya sehat — `gh api repos/.../pages`
menjawab `status: "built"`, sumber `main` branch path `/`, `https_enforced`.
Reponya memang **tidak punya `index.html`**; isinya cuma `confirmed.html`,
`privacy-policy.html`, `terms-of-service.html`, dan `scannapp-logo.png`.
Hosting statis tidak punya apa pun untuk disajikan di `/`, jadi 404.

Ini penting karena URL root itulah yang paling wajar didaftarkan di Data
Safety form Play Console, dan Google menolak URL yang tidak resolve.

`index.html` dibuat **memakai template yang sudah ada** (permintaan eksplisit
Boss Ali: jangan bikin template baru) — `<head>` dan blok `<style>` disalin
dari `privacy-policy.html`, header sticky yang sama, pil navigasi yang sama,
penomoran `.num` IBM Plex Mono yang sama, `.contact-card` dan `.callout` yang
sama, footer yang sama. Tidak ada kelas CSS baru dan tidak ada warna baru;
palet `--blue #2563EB` / `--coral #FF6B4A` tetap seperti aslinya, sesuai
`CLAUDE.md` Bagian 9.2.

Isinya: pengantar singkat, tautan ke kedua dokumen, **bagian hapus akun
lengkap**, dan kartu kontak. Bagian hapus akunnya sengaja dimuat utuh di
halaman root, bukan sekadar tautan — supaya URL root sendiri sudah sah
sebagai tujuan Data Safety tanpa Google harus mengikuti tautan lagi.

## 2. Perubahan di `privacy-policy.html`

- **Bagian 07 baru, "Menghapus Akun & Data Anda"** (`id="hapus-akun"`), berisi
  dua jalur (dalam aplikasi & email dari alamat pendaftaran sebagai verifikasi
  pemilik), masa tunggu 7 hari beserta cara membatalkan, daftar apa yang
  dihapus permanen, apa yang tidak (dokumen lokal, catatan transaksi anonim,
  catatan referral yang dianonimkan), dan peringatan bahwa menghapus akun
  **tidak** menghentikan tagihan Google Play.
- **Bagian 07–09 lama naik jadi 08–10.**
- **Bagian 05 diperbaiki dari "30 hari" jadi 7 hari.** 7 masih di dalam 30
  jadi bukan pelanggaran, tapi Google Play minta halamannya menggambarkan
  proses yang sebenarnya. Sekarang merujuk ke bagian 07.
- **Versi 1.0 → 1.1** dengan tanggal "Diperbarui 5 September 2026", tanggal
  "Berlaku sejak" dipertahankan. Isinya berubah materiil; menahannya di
  "Versi 1.0, berlaku sejak 13 Agustus" akan menyesatkan.
- `h2` diberi `scroll-margin-top:80px` supaya anchor `#hapus-akun` tidak
  mendarat di balik header sticky.

## 3. Perubahan di `terms-of-service.html`

Satu atribut: brand di header dari `href="#top"` jadi `href="index.html"`.
Perubahan yang sama juga di `privacy-policy.html`. Tanpa ini halaman root
jadi yatim — hanya bisa dicapai dengan mengetik URL-nya.

## 4. Alamat email

`supportscannapp@gmail.com`, dikonfirmasi Boss Ali 5 September 2026. Bukan
tebakan: alamat itu memang sudah tertulis di bagian 06 dan 09 halaman yang
tayang sebelumnya, dan sekarang dipakai konsisten di ketiga tempat.

## 5. Yang masih perlu tangan Boss Ali

- [ ] **Daftarkan URL di Data Safety form Play Console** — langkah manual di
      luar kode. Play Console → App content → Data safety → bagian penghapusan
      data. Pakai `https://newbeboys.github.io/scannapp-legal/` (sudah 200).
      Pilih opsi **hapus akun penuh**, bukan "hapus sebagian data" — yang
      ScannApp sediakan memang penghapusan akun seutuhnya. Centang juga bahwa
      app menyediakan jalur hapus akun **di dalam app** (Pengaturan → Hapus
      akun).

## 6. Dua catatan kecil, bukan penghalang

- **`scannapp-logo.png` ada di repo tapi tidak dipakai halaman mana pun.**
  Ketiga halaman legal memakai kotak biru yang digambar CSS (`.brand .mark`),
  bukan berkas logonya. Dibiarkan apa adanya supaya konsisten dengan template
  yang sudah ada — kalau mau dipakai (mis. jadi favicon, yang sekarang belum
  ada sehingga browser meminta `/favicon.ico` dan dapat 404), itu keputusan
  desain terpisah.
- **Bagian 01 Kebijakan Privasi menyebut "log error/crash" sebagai data yang
  dikumpulkan**, padahal crash reporting (Fase 8.5 bagian B, Crashlytics)
  belum dibangun. Mengumpulkan lebih sedikit dari yang diumumkan tidak
  merugikan user, tapi **Data Safety form harus konsisten dengan halaman
  ini** — kalau formnya diisi "tidak mengumpulkan crash log" sementara
  halamannya bilang iya, itu ketidakcocokan yang bisa dipersoalkan Google.
  Paling mudah: selesaikan Fase 8.5 B, lalu kalimat itu jadi benar.
