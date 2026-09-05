# Halaman Legal — Paragraf Hapus Akun (Fase 8.5a)

**Status: SIAP TEMPEL, BELUM DIPUBLISH.** Menerbitkan halaman publik itu
tindakan keluar yang tidak bisa ditarik diam-diam, jadi teksnya disiapkan di
sini dan menunggu keputusan Boss Ali. Repo tujuannya
[`newbeboys/scannapp-legal`](https://github.com/newbeboys/scannapp-legal)
(publik, terpisah dari repo aplikasi) — akses tulis ada, tinggal perintahnya.

---

## 1. Tiga hal yang perlu diputuskan Boss Ali sebelum publish

### a. Alamat email support — kemungkinan besar sudah benar, tinggal dikonfirmasi

Prompt meminta alamatnya dikonfirmasi, jangan ditebak. Tidak ditebak: alamat
di bawah **dibaca langsung dari halaman yang sudah tayang**,
`privacy-policy.html` bagian 06 dan 09:

```
supportscannapp@gmail.com
```

Formatnya sah (ada `@`, domain `gmail.com`). Konfirmasi yang dibutuhkan cuma:
**alamat ini masih dipakai dan masih dibaca?** Kalau ya, teks di bawah bisa
langsung dipasang apa adanya.

### b. URL root halaman legal saat ini 404 — ini memblokir Play Console

`https://newbeboys.github.io/scannapp-legal/` **mengembalikan HTTP 404**
(diperiksa 5 September 2026). Reponya tidak punya `index.html`; yang tayang
hanya tiga berkas spesifik:

| URL | Status |
|---|---|
| `https://newbeboys.github.io/scannapp-legal/` | **404** |
| `https://newbeboys.github.io/scannapp-legal/privacy-policy.html` | tayang |
| `https://newbeboys.github.io/scannapp-legal/terms-of-service.html` | tayang |

Google Play menolak URL yang tidak resolve. Dua jalan keluar:

1. **Daftarkan URL lengkapnya** ke Play Console
   (`.../scannapp-legal/privacy-policy.html`) — nol pekerjaan tambahan.
2. **Buat `index.html`** di repo legal sebagai halaman pengantar berisi tautan
   ke keduanya, lalu daftarkan URL root. Lebih rapi, tapi satu berkas baru
   yang harus dibuat & di-review dulu.

Rekomendasi: opsi 1 sekarang supaya submit tidak tertahan, opsi 2 menyusul
kalau memang mau dirapikan.

### c. Bagian 05 halaman itu menjanjikan 30 hari, implementasinya 7 hari

Teks yang sekarang tayang di bagian 05 "Berapa Lama Kami Menyimpan Data Anda":

> Jika Anda menghapus akun, data profil dan metadata dokumen dihapus dari
> sistem kami **dalam waktu 30 hari**, termasuk file backup di cloud.

Yang dibangun: masa tunggu **7 hari**, lalu purge permanen. 7 hari masih di
dalam janji "dalam waktu 30 hari", jadi ini **bukan pelanggaran** — tapi
angkanya sebaiknya disamakan supaya halaman legal menggambarkan proses yang
sebenarnya, sebagaimana diminta kebijakan Google Play. Usulan penggantinya ada
di bagian 3 di bawah.

---

## 2. Teks yang ditempel — bagian baru di `privacy-policy.html`

Sisipkan **setelah** blok bagian `06 Hak Anda` (tepat sebelum
`<h2><span class="num">07</span>Anak-Anak</h2>`), lalu naikkan nomor bagian
07/08/09 yang lama jadi 08/09/10.

```html
  <h2><span class="num">07</span>Menghapus Akun &amp; Data Anda</h2>
  <p>Anda dapat menghapus akun ScannApp beserta seluruh data yang tersimpan di server kami, kapan saja, lewat dua jalur berikut.</p>

  <p><strong>Lewat aplikasi (paling cepat).</strong> Buka ScannApp → tab <em>Pengaturan</em> → <em>Hapus akun</em>, lalu ikuti konfirmasinya. Akun langsung dijadwalkan untuk dihapus.</p>

  <p><strong>Lewat email.</strong> Kirim permintaan ke <a href="mailto:supportscannapp@gmail.com">supportscannapp@gmail.com</a> dari <strong>alamat email yang Anda pakai mendaftar</strong> — alamat itu yang kami pakai untuk memastikan permintaan datang dari pemilik akun. Tulis subjek <em>&ldquo;Hapus Akun&rdquo;</em>. Kami memproses permintaan dalam waktu maksimal 7 hari kerja sejak email diterima.</p>

  <div class="callout">Setelah permintaan dibuat, ada masa tunggu <strong>7 hari</strong>. Selama masa itu Anda masih bisa masuk seperti biasa dan membatalkan penghapusan lewat tombol <em>Batalkan Penghapusan</em> di aplikasi. Lewat 7 hari, penghapusan bersifat permanen dan tidak dapat dipulihkan.</div>

  <p><strong>Yang dihapus permanen:</strong> data profil (nama tampilan, alamat email, kata sandi), status langganan dan kuota penyimpanan, metadata dokumen, serta <strong>seluruh berkas cadangan Anda di penyimpanan cloud</strong>.</p>

  <p><strong>Yang tidak ikut terhapus:</strong></p>
  <ul>
    <li>Dokumen yang tersimpan lokal di perangkat Anda — file itu tidak pernah menyentuh server kami, jadi hapus sendiri lewat menu <em>Hapus semua dokumen</em> di aplikasi, atau dengan menghapus aplikasinya.</li>
    <li>Catatan transaksi pembelian, yang kami simpan dalam bentuk anonim (tanpa penunjuk ke identitas Anda) selama masih diwajibkan untuk keperluan akuntansi dan penyelesaian sengketa pembayaran.</li>
    <li>Catatan program referral, yang penunjuk identitasnya kami hapus (dianonimkan) namun barisnya dipertahankan agar hadiah yang sudah diterima pengguna lain tetap sah.</li>
  </ul>

  <p><strong>Jika Anda berlangganan Pro:</strong> batalkan dulu langganan Anda lewat Play Store (Play Store → Menu → Langganan → ScannApp → Batalkan). Menghapus akun di ScannApp <strong>tidak</strong> menghentikan tagihan Google Play, karena penagihan dikelola oleh Google, bukan oleh kami.</p>
```

---

## 3. Usulan pengganti bagian 05 (opsional, lihat 1c)

Kalau Boss Ali setuju menyamakan angkanya, ganti paragraf bagian 05 yang
sekarang dengan ini:

```html
  <p>Data akun disimpan selama akun Anda aktif. Jika Anda menghapus akun, seluruh data profil, metadata dokumen, dan berkas backup di cloud dihapus permanen setelah masa tunggu 7 hari — lihat bagian 07. Dokumen yang disimpan lokal di perangkat Anda tetap ada sampai Anda menghapusnya sendiri, karena file itu tidak pernah menyentuh server kami.</p>
```

---

## 4. Langkah manual di Play Console (di luar kode, tidak bisa dikerjakan Claude Code)

Setelah halaman di atas tayang:

1. Play Console → **App content** → **Data safety** → bagian penghapusan data.
2. Isi URL halamannya (lihat keputusan 1b soal URL mana yang dipakai).
3. Centang bahwa app menyediakan **jalur hapus akun di dalam app** — ini sudah
   ada: Pengaturan → Hapus akun.
4. Google membedakan "hapus akun" dan "hapus sebagian data". Yang ScannApp
   sediakan adalah **hapus akun penuh**, jadi pilih opsi itu.
