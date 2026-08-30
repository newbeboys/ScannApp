# System Design — Scanner App

Dokumen ini adalah rujukan arsitektur teknis tunggal untuk Claude Code. Kalau ada pertanyaan "bagaimana komponen A terhubung ke B", jawabannya ada di sini — bukan ditebak ulang.

---

## 1. Arsitektur Tingkat Tinggi

```
┌─────────────────────────────────────────────────────────────┐
│                     Android Device (User)                     │
│                                                                 │
│   ┌───────────────────────────────────────────────────────┐   │
│   │        React App (jalan di dalam Capacitor WebView)     │   │
│   │  UI, state, logic edit, tier gating, referral UI, dst   │   │
│   └───────────────────────┬───────────────────────────────┘   │
│                            │ Capacitor Bridge                  │
│   ┌────────────────────────▼──────────────────────────────┐   │
│   │   Native Plugin: @capacitor-mlkit/document-scanner      │   │
│   │   (akses kamera + Google ML Kit Document Scanner)       │   │
│   └──────────────────────────────────────────────────────┘   │
│                            │                                   │
│   ┌────────────────────────▼──────────────────────────────┐   │
│   │      Local Storage Device (penyimpanan utama file)      │   │
│   └──────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                            │ HTTPS (opsional, hanya saat backup/auth)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Supabase (Project: ScannApp)                │
│                                                                 │
│   ┌───────────────┐   ┌────────────────┐   ┌───────────────┐  │
│   │  Supabase Auth │   │   PostgreSQL   │   │ Edge Functions │  │
│   │  (login/signup)│   │  (lihat        │   │  (lihat        │  │
│   │                │   │ DATABASE_      │   │ BACKEND_API_   │  │
│   │                │   │ SCHEMA.md)     │   │ DESIGN.md)     │  │
│   └───────────────┘   └────────────────┘   └───────┬───────┘  │
└──────────────────────────────────────────────────────┼─────────┘
                                                          │ S3-compatible API
                                                          ▼
                                          ┌───────────────────────────┐
                                          │   Cloudflare R2            │
                                          │   Bucket: scanappstorage   │
                                          │   (backup/sync file, opsional)│
                                          └───────────────────────────┘
```

**Prinsip kunci:** Client (React app di HP) **tidak pernah** bicara langsung ke R2. Semua akses R2 wajib lewat Supabase Edge Function sebagai perantara (lihat `BACKEND_API_DESIGN.md` untuk detail signed URL).

---

## 2. Komponen & Tanggung Jawab

| Komponen | Tanggung Jawab | Tidak Bertanggung Jawab Atas |
|---|---|---|
| React App (client) | UI, state lokal, orkestrasi panggilan ke plugin/Supabase, tier gating di level tampilan | Validasi bisnis final (itu tugas RLS/Edge Function — client tidak dipercaya penuh) |
| Capacitor Plugin (ML Kit) | Akses kamera, deteksi tepi, koreksi perspektif, output gambar/PDF mentah | Edit lanjutan (crop manual, filter, dst — itu logic React/JS) |
| Local Storage Device | Penyimpanan utama file hasil scan | Sinkronisasi antar device (tidak ada, karena local-first) |
| Supabase Auth | Identitas user, JWT | Otorisasi detail per-row (itu tugas RLS) |
| Supabase Database (Postgres + RLS) | Metadata (tier, referral, dokumen, quota), aturan akses per-row | Menyimpan file biner (itu tugas R2/lokal) |
| Supabase Edge Functions | Logic yang butuh privilege tinggi (bypass RLS terkontrol), generate signed URL R2, proses referral, job expire | Rendering UI (tidak ada UI di sini, murni backend logic) |
| Cloudflare R2 | Penyimpanan file backup/sync | Auth atau validasi bisnis apa pun (R2 tidak tahu siapa user-nya — itu semua ditangani sebelum signed URL dibuat) |

---

## 3. Alur Data Utama

### 3.1 Alur Scan Dokumen (tidak menyentuh backend sama sekali)

```
User buka app → tap "Scan" → Capacitor Plugin buka ML Kit Document Scanner
→ user capture (1 atau banyak halaman) → ML Kit proses (deteksi tepi,
koreksi perspektif) → hasil balik ke React app → simpan ke Local Storage
Device. SELESAI — tidak ada tulisan ke backend sama sekali.
```

Alur ini **sepenuhnya offline**, tanpa pengecualian. Dokumen hasil scan hidup di `Directory.Data/scans/<id>/` plus satu index JSON, dan seluruh daftar dokumen di UI (`HomeScreen`, `DocumentsScreen`, `DocumentDetailScreen`, `MergeScreen`) dibaca dari sana lewat `listScanDocuments()`.

**Baris di `scan_documents` hanya lahir dari `confirm-upload`** saat user menekan "Cadangkan ke cloud" (Bagian 3.2), dan selalu dengan `local_only = false`. Client tidak punya hak tulis apa pun ke tabel itu — policy INSERT/UPDATE/DELETE-nya dicabut 22 Agustus 2026 karena `file_size_bytes` yang bisa ditulis client membuat kuota R2 bisa dilewati (rincian di spec Fase 4 Bagian 9).

> **Versi awal dokumen ini menulis** bahwa client melakukan "(opsional) insert metadata ke tabel `scan_documents` via Supabase client SDK (`local_only = true`)". Langkah itu **tidak pernah dibangun**, dan sekarang tidak mungkin dibangun lewat jalur itu.

Dua hal yang mengikat siapa pun yang nanti mengerjakan sinkronisasi metadata offline (Bagian 6, Open Item):

1. **Sinkronisasinya wajib lewat Edge Function, bukan insert langsung dari client.** Mengembalikan hak tulis client ke `scan_documents` berarti membuka lagi bypass kuota yang persis sama — ukuran file yang dipakai menghitung kuota tidak boleh berasal dari pihak yang diuntungkan kalau angkanya salah.
2. **Baris `local_only = true` belum pernah ada, dan begitu ada, ia mengubah arti tabel ini.** `listCloudBackups()` sudah memfilter `local_only = false` sejak sekarang supaya siap. Tanpa filter itu, layar "Cadangan di cloud" akan mendaftar dokumen yang tidak punya salinan cloud, dan badge cadangan di `DocumentDetailScreen` akan menyatakan dokumen aman padahal belum diunggah ke mana pun.

### 3.2 Alur Backup File ke Cloud (opsional, lihat `BACKEND_API_DESIGN.md` untuk detail signed URL)

```
User tap "Backup ke cloud" pada satu dokumen
→ Client panggil Edge Function generate-upload-url
→ Edge Function cek quota (tabel storage_usage)
→ Edge Function balikan signed URL
→ Client PUT file langsung ke R2 pakai signed URL (bypass Edge Function)
→ Client panggil Edge Function confirm-upload
→ Edge Function update scan_documents.local_only = false + storage_usage.bytes_used
```

### 3.3 Alur Auth & Tier

```
User signup → Supabase Auth buat entry di auth.users
→ Trigger on_auth_user_created otomatis insert row di profiles (tier='basic')
  + storage_usage (quota default Basic) + generate referral_code
→ Client simpan session JWT, dipakai di semua request berikutnya
→ Setiap request ke Edge Function/Database disertai JWT ini,
  RLS & Edge Function verifikasi identitas dari situ
```

### 3.4 Alur Referral (ringkas — detail lengkap di `BACKEND_API_DESIGN.md` Bagian 6)

```
User A share referral_code miliknya → User B daftar pakai kode itu
(profiles.referred_by User B = User A, insert row di referral_events)
→ User B scan dokumen pertamanya → Client panggil Edge Function
  process-referral-activation → cek milestone → kalau memenuhi,
  update profiles.tier User A jadi 'pro' + kasih reward 1 hari ke User B
```

---

## 4. Keputusan Arsitektur & Alasannya (ringkasan — detail lengkap ada di riwayat brainstorming/PRD)

| Keputusan | Alasan Singkat |
|---|---|
| Capacitor + React, bukan native Android murni | Supaya bisa ekspansi ke iOS nanti tanpa bangun ulang seluruh app dari nol |
| ML Kit Document Scanner (on-device) | Gratis tanpa batas, kualitas setara SDK komersial, tidak ada risiko biaya cloud API |
| Local-first storage | Cloud storage (R2) rawan cepat habis kuota kalau semua file otomatis diupload; local-first mengurangi beban itu drastis |
| Supabase project terpisah dari FinanceApp | Isolasi kuota database & keamanan RLS antar dua produk berbeda |
| R2 dipilih atas Appwrite/Firebase untuk storage | Kuota lebih besar (10GB vs 2GB Appwrite), nol biaya egress, riwayat harga lebih stabil |
| Signed URL langsung dari Edge Function, tanpa Cloudflare Worker | Lebih sederhana untuk versi pertama, cukup untuk kebutuhan saat ini |
| Perbaikan gambar on-device (klasik dulu, TFLite menyusul), bukan cloud API | Cloud API "gratis" rawan berubah kebijakan/kena biaya begitu user bertambah. Versi klasik memenuhi alasan yang sama dengan lebih kuat: nol biaya, nol jaringan, nol tambahan bobot APK |

---

## 5. Yang BUKAN Cakupan Dokumen Ini

- Skema database detail → `DATABASE_SCHEMA.md`
- Spesifikasi tiap Edge Function → `BACKEND_API_DESIGN.md`
- Angka bisnis (harga, quota, milestone) → `PRD-aplikasi-scanner-dokumen.md`
- Desain visual/UI/UX (warna, layout, komponen tampilan) → **belum ada dokumennya**, akan dibuat terpisah setelah sesi brainstorming UI/UX

---

## 6. Open Item Arsitektur (belum diputuskan, dicatat supaya tidak lupa)

- Strategi sinkronisasi metadata dokumen saat app dipakai offline lalu online kembali (queue lokal? retry otomatis?) — belum dirancang detail.
- Strategi konflik kalau user pakai app di lebih dari satu device dengan akun yang sama (saat ini asumsi: 1 user = 1 device aktif, belum ada multi-device sync).

7. kamu bisa lihat pada folder atau file yang di ScannApp Design Prototap kemungkinan seperti itu design aplikasiku, kamu bisa membuatnya lebih bagus atau smoot dengan menggunakan skill/plugin yang tersedia tanpa aku perintahkan, tinggal kamu kerjakan jikan selesai tunjukan nanti aku akan membuat keputusannya.
