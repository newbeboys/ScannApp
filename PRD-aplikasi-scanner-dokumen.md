# PRD — Aplikasi Scanner Dokumen (Boss Ali)

**Status:** v2 — semua open decision di v1 sudah diputuskan. Dokumen ini final untuk mulai implementasi, kecuali ada perubahan eksplisit dari Boss Ali.

---

## 1. Ringkasan Produk

Aplikasi scan dokumen untuk Android dengan dua tier: **Basic** (gratis, ad-supported) dan **Pro** (berbayar). Dibangun bertahap per subsistem, tidak sekaligus. iOS baru dipertimbangkan kalau ada permintaan nyata dari user.

**Arsitektur final:**
- Framework: Capacitor + React + Vite (konsisten dengan FinanceApp), akses ML Kit lewat plugin `@capacitor-mlkit/document-scanner`.
- Auth & Database: **Supabase project baru**, terpisah sepenuhnya dari project FinanceApp (kuota database tidak dibagi antar produk).
- Storage/backup file: **Cloudflare R2**, diakses lewat signed URL dari Supabase Edge Function (client tidak pernah pegang credential R2 langsung).
- Penyimpanan utama file tetap **lokal di HP user** (local-first) — cloud R2 murni untuk backup/sync opsional.

---

## 2. Scan Engine

- Menggunakan **Google ML Kit Document Scanner API** untuk semua tier (Basic maupun Pro).
- On-device, gratis, tanpa batas API call, tanpa biaya per-scan.
- Sudah mencakup: deteksi tepi otomatis, koreksi perspektif, filter dasar, hapus bayangan/noda, multi-halaman dalam satu sesi scan, output JPEG/PDF.
- Konsekuensi penting: karena engine ini sama untuk semua tier, **diferensiasi Basic vs Pro tidak berada di kualitas scan mentah**, melainkan di limit, fitur edit, dan fitur pendukung.

---

## 3. Perbandingan Fitur — Basic vs Pro

| Area | Basic (gratis, ada iklan) | Pro (berbayar, no ads) |
|---|---|---|
| Scan engine | ML Kit (kualitas penuh) | ML Kit (kualitas penuh, sama) |
| Edit dasar | Crop manual, rotate, reorder halaman, filter dokumen (5 pilihan) | Sama, plus edit lanjutan di bawah |
| Merge dokumen | ✅ Maksimal **20 halaman** per dokumen hasil merge | ✅ **Unlimited** |
| Edit dibantu AI ("AI Enhance") | ❌ Tidak tersedia | ✅ Auto-enhance gambar (cahaya/kontras/noise/ketajaman) + auto-deskew & auto-crop presisi |
| Edit lanjutan lain | ❌ | Annotate, tanda tangan digital |
| OCR (searchable text) | ❌ | ✅ |
| Export format | PDF, JPG, **PNG** (kompresi otomatis, 1 level) | PDF, JPG, PNG, DOCX + kontrol level kompresi manual (4 level) |
| Watermark hasil export | Ada (kecil) | Tidak ada |
| Batch scan/export | ❌ | ✅ |
| Iklan | Banner + interstitial tiap 5 scan, + interstitial setelah export | Tidak ada |
| Quota storage cloud (R2) | 100 MB | 500 MB (langganan bulanan) / **1 GB (langganan tahunan)** |

> **Direvisi 23 Agustus 2026:** reorder halaman dan filter dokumen **pindah dari Pro-exclusive ke tersedia untuk semua tier**, menggantikan baris "Edit lanjutan lain" versi sebelumnya yang mencantumkan keduanya sebagai Pro. Filter sekaligus naik dari 2 pilihan (B&W, magic color) jadi 5 (Magic Color, Cerah, Abu-abu, Hitam-Putih, Hemat Tinta) — lihat CLAUDE.md Bagian 6 & `TASKS.md` Fase 6. ~~Annotate dan tanda tangan digital tetap Pro-exclusive, belum diimplementasikan.~~
>
> **Direvisi lagi 25 Agustus 2026:** setelah uji device, Boss Ali memindahkan **anotasi, tanda tangan digital, pisah dokumen, dan ekspor banyak dokumen sekaligus** dari Pro ke **semua tier**. Yang tersisa sebagai nilai jual Pro dari baris-baris ini: kontrol level kompresi manual, ekspor DOCX, bebas iklan, tanpa watermark, merge tanpa batas halaman, dan kuota storage lebih besar. Lihat CLAUDE.md Bagian 6 & `TASKS.md` Fase 6 bagian 6.
>
> **Direvisi lagi 23 Agustus 2026 (sore):** **export PNG ikut pindah ke semua tier.** Baris "Export format" di atas sebelumnya menaruh PNG di kolom Pro; sekarang Basic juga bisa mengekspor PNG. Yang tetap Pro di baris itu hanya **DOCX** dan **kontrol level kompresi manual**. Alasannya sejalan dengan revisi sebelumnya: memilih format berkas adalah kebutuhan dasar, bukan nilai jual — yang dijual Pro adalah kendali atas mutu dan ukurannya. DOCX belum diimplementasikan dan menunggu OCR (tanpa lapisan teks, DOCX hanya berisi gambar yang tidak bisa diedit).

---

## 4. Fitur "AI Enhance" (Pro-exclusive)

**Cakupan:**
- (A) Auto-enhance kualitas gambar — koreksi cahaya/kontras, kurangi noise, tingkatkan ketajaman
- (B) Auto-deskew (luruskan halaman miring) + auto-crop yang lebih presisi dari deteksi tepi standar

**Keputusan arsitektur penting:**
Fitur ini **wajib berbasis on-device model (TensorFlow Lite)**, bukan cloud AI API dengan free tier. Alasan: free tier API pihak ketiga (mis. Gemini API atau sejenis) rawan dipangkas atau berubah kebijakan begitu jumlah user bertambah — ini bisa merusak fitur andalan Pro tier atau tiba-tiba menimbulkan biaya operasional yang tidak direncanakan. On-device model memastikan biaya tetap nol secara permanen, dengan trade-off kualitas enhancement yang lebih terbatas dibanding model cloud besar.

Kalau ke depan ingin upgrade ke cloud AI yang lebih canggih, itu harus jadi keputusan sadar dengan anggaran cadangan — bukan asumsi default di versi pertama.

---

## 5. Program Referral

**Mekanisme:**
- User Basic dapat kode referral unik untuk dibagikan (share link).
- Reward baru cair kalau teman yang diundang **install app + buat akun + berhasil menyelesaikan minimal 1 scan** (activation event) — bukan sekadar klik link. Ini mencegah abuse (akun kosong/bot).
- Skema reward: **milestone/tiered**, angka final:

  | Jumlah referral berhasil | Reward Pro |
  |---|---|
  | 5 orang | 7 hari |
  | 15 orang | 25 hari |
  | 30 orang | 60 hari |

- Teman yang diundang juga mendapat reward kecil (durasi final: lihat `.env.example` `REFERRAL_REFERRED_USER_BONUS_DAYS`) sebagai insentif dua arah ("give X get Y").

**Anti-abuse:**
- 1 kode referral per akun.
- Kode tidak bisa dipakai untuk akun yang device/email-nya sudah pernah terdaftar sebelumnya.

---

## 6. Model Monetisasi

- **Basic:** Gratis, didanai iklan — banner permanen + interstitial tiap 5 scan, ditambah interstitial setelah export dokumen.
- **Pro:** Berbayar, menghilangkan iklan + membuka semua fitur di tabel Bagian 3.
- **Skema harga:** Subscription — **Rp 15.000/bulan** atau **Rp 150.000/tahun** (setara ~Rp 12.500/bulan, insentif komitmen jangka panjang). Langganan tahunan juga mendapat quota storage R2 lebih besar (1GB vs 500MB bulanan — lihat Bagian 3).

---

## 7. Keputusan Final (sebelumnya open decision di v1)

1. **Limit Basic:** bukan berbasis jumlah scan/hari, melainkan **limit halaman merge dokumen** — Basic maksimal 20 halaman per dokumen hasil merge, Pro unlimited (lihat Bagian 3).
2. **Milestone referral:** 5→7 hari, 15→25 hari, 30→60 hari Pro (lihat Bagian 5).
3. **Harga Pro:** Rp 15.000/bulan atau Rp 150.000/tahun (lihat Bagian 6).
4. **Frekuensi iklan Basic:** banner + interstitial tiap 5 scan + interstitial setelah export (lihat Bagian 6).
5. **Quota storage R2:** Basic 100MB, Pro bulanan 500MB, Pro tahunan 1GB (lihat Bagian 3).

---

## 8. Urutan Pembangunan yang Disarankan (bertahap)

Detail per-task ada di `TASKS.md`. Ringkasan fase:

1. Capture & processing engine (integrasi ML Kit Document Scanner) — subsistem inti, harus solid duluan.
2. Editor dasar (crop, rotate) + export PDF/JPG + kompresi standar + merge dokumen (universal, dengan limit halaman sesuai Bagian 3).
3. Sistem tier & auth (Supabase project baru, Basic/Pro flag).
4. Backend storage/backup (Supabase Edge Function + Cloudflare R2).
5. Monetisasi iklan (Basic) + flow pembelian Pro.
6. Fitur Pro: OCR, edit lanjutan, export tambahan.
7. AI Enhance (on-device TFLite) — subsistem paling berat, disarankan paling akhir.
8. Program referral — bisa dibangun paralel dengan fitur Pro karena scope-nya cukup terisolasi.
