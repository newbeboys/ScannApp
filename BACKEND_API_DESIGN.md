# Backend & API Design — Scanner App

Backend logic dijalankan lewat **Supabase Edge Functions** (Deno runtime). Client (React app) tidak pernah berkomunikasi langsung dengan Cloudflare R2 — selalu lewat Edge Function sebagai perantara yang memverifikasi identitas & tier user dulu.

---

## 1. Prinsip Keamanan Wajib

- R2 access key & secret **hanya** disimpan sebagai environment variable di Edge Function (server-side), **tidak pernah** dikirim ke client. Nama secret yang sudah terpasang di Supabase: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET_NAME` — akses lewat `Deno.env.get('<NAMA>')`.
- Operasi yang butuh bypass RLS (update `profiles.tier`, `referral_events`, `storage_usage`) memakai Supabase secret key yang sudah tersimpan dengan nama `ScannAppsecret` — akses lewat `Deno.env.get('ScannAppsecret')`.
- Setiap Edge Function yang menyentuh data user wajib memverifikasi JWT Supabase (`supabase.auth.getUser()`) di awal — tolak request kalau tidak valid.
- Signed URL R2 punya masa berlaku pendek (rekomendasi: 5-10 menit) supaya tidak bisa dipakai ulang/disebarkan.
- **Menghapus row `auth.users`** (Admin API `DELETE /auth/v1/admin/users/{id}`) hanya boleh dipanggil dari Edge Function bermodal `ScannAppsecret` — client tidak pernah punya jalan langsung ke endpoint ini. Lihat Bagian 13 (`process-account-deletions`).

---

## 2. Edge Function: `generate-upload-url`

**Tujuan:** Menghasilkan signed URL untuk client upload file scan ke R2 (backup/sync).

**Alur:**
1. Client kirim request dengan JWT + metadata (`file_size_bytes`, `document_id`).
2. Function verifikasi JWT → dapatkan `user_id`.
3. Cek tabel `storage_usage`: apakah `bytes_used + file_size_bytes <= quota_bytes`?
   - Kalau melebihi kuota → return error `409 Conflict` dengan pesan "Kuota storage penuh", **jangan** generate signed URL.
4. Kalau kuota cukup → generate signed URL upload R2 (PUT), object key format: `users/{user_id}/{document_id}.{ext}`.
5. Return signed URL + object key ke client (masa berlaku 10 menit).
6. Client upload langsung ke R2 pakai signed URL tersebut (bukan lewat Edge Function — supaya file besar tidak lewat compute Supabase).
7. Setelah upload sukses, client panggil `confirm-upload` (lihat di bawah).

**Input:**
```json
{ "document_id": "uuid", "file_size_bytes": 2048000, "file_extension": "pdf" }
```

**Output (sukses):**
```json
{ "upload_url": "https://...", "object_key": "users/.../doc.pdf", "expires_in": 600 }
```

**Output (kuota penuh):**
```json
{ "error": "QUOTA_EXCEEDED", "message": "Kuota storage penuh untuk tier Anda" }
```

---

## 3. Edge Function: `confirm-upload`

**Tujuan:** Dipanggil client setelah upload ke R2 selesai, untuk update metadata di Supabase.

**Alur:**
1. Verifikasi JWT.
2. Update `scan_documents`: `local_only = false`, `r2_object_key = <object_key>`.
3. Update `storage_usage.bytes_used += file_size_bytes`.
4. Return status sukses.

**Catatan:** Kalau langkah ini gagal (mis. koneksi putus setelah upload R2 sukses), file sudah ada di R2 tapi metadata belum update — perlu job pembersihan berkala (lihat Bagian 6) untuk cek object R2 yang tidak punya referensi di `scan_documents`.

---

## 4. Edge Function: `generate-download-url`

**Tujuan:** Menghasilkan signed URL untuk user mengunduh/melihat file yang sudah dibackup.

**Alur:**
1. Verifikasi JWT.
2. Cek kepemilikan: `scan_documents.owner_id == user_id` untuk `document_id` yang diminta.
3. Generate signed URL GET R2 (masa berlaku 10 menit) untuk `r2_object_key` terkait.
4. Return signed URL.

---

## 5. Edge Function: `delete-backup`

**Tujuan:** Hapus file dari R2 saat user hapus dokumen yang sudah dibackup.

**Alur:**
1. Verifikasi JWT + kepemilikan dokumen.
2. Panggil R2 delete object.
3. Update `scan_documents` (hapus row atau set `local_only = true, r2_object_key = null` sesuai kebutuhan UX).
4. Kurangi `storage_usage.bytes_used`.

---

## 6. Edge Function: `process-referral-activation`

**Tujuan:** Dipanggil otomatis (dari client, setelah user baru berhasil menyelesaikan scan pertamanya) untuk memproses trigger reward referral.

**Alur:**
1. Verifikasi JWT → dapatkan `user_id` (ini adalah `referred_id`).
2. Cek `profiles.referred_by` untuk user ini — kalau `null`, tidak ada yang perlu diproses, return early.
3. Update row `referral_events` yang cocok: `activated = true`, `activated_at = now()`.
4. Hitung ulang jumlah `activated = true` untuk `referrer_id` terkait.
5. Cek tabel `referral_milestones` — apakah hitungan ini menyentuh milestone baru yang belum di-reward?
6. Kalau ya: update `profiles.tier = 'pro'` dan `tier_expires_at` untuk `referrer_id` (tambahkan `pro_days_reward` dari milestone ke tanggal expiry saat ini — atau ke `now()` kalau belum Pro), lalu tandai `reward_granted = true` di row `referral_events` yang relevan.
7. **Reward dua arah:** beri juga reward kecil (durasi Pro sesuai keputusan bisnis — lihat open decision) ke `referred_id` sebagai insentif "give X get Y".

**Catatan penting:** Fungsi ini harus idempotent — kalau dipanggil berkali-kali untuk activation yang sama, tidak boleh reward diberikan dobel. Gunakan flag `activated`/`reward_granted` sebagai guard.

---

## 7. Edge Function: `expire-pro-status` (scheduled/cron)

**Tujuan:** Job terjadwal (mis. tiap jam, pakai `pg_cron` atau Supabase Scheduled Function) untuk downgrade user yang `tier = 'pro'` tapi `tier_expires_at < now()` kembali ke `'basic'`.

**Alur:**
1. Query semua `profiles` dengan `tier = 'pro' AND tier_expires_at IS NOT NULL AND tier_expires_at < now()`.
2. Update `tier = 'basic'`, `tier_expires_at = null` untuk semua row yang cocok.

---

## 8. Ringkasan Alur Upload-Download (diagram)

```
Client (React/Capacitor)              Supabase Edge Function            Cloudflare R2
       │                                       │                             │
       │── request upload URL ────────────────>│                             │
       │                                       │── cek quota (DB) ──────────>│
       │<── signed upload URL ─────────────────│                             │
       │                                                                     │
       │── PUT file langsung ke R2 (bypass Edge Function) ─────────────────>│
       │                                                                     │
       │── confirm-upload ────────────────────>│                             │
       │                                       │── update metadata (DB) ────│
       │<── OK ─────────────────────────────────│                             │
```

---

## 9. Rate Limiting & Abuse Prevention

- `generate-upload-url` dan `generate-download-url` sebaiknya dibatasi rate per user (mis. maksimal 30 request/menit) untuk mencegah penyalahgunaan generate signed URL massal.
- `process-referral-activation` wajib dicek server-side bahwa `referred_id` benar-benar baru menyelesaikan scan pertama (cek ke tabel `scan_documents` — pastikan ada minimal 1 row untuk user tersebut), bukan cuma dipercaya dari client.

---

## 10. Keputusan Final Terkait Backend

- **Interval job `expire-pro-status`:** tiap hari (jam 00:00) — cukup untuk kasus reward referral yang sifatnya harian, tidak perlu presisi ke menit.
- **Signed URL R2:** tanpa proxy Cloudflare Worker tambahan di versi pertama. Alur tetap seperti diagram Bagian 8 (client ↔ Edge Function ↔ R2 langsung). Worker bisa dipertimbangkan lagi kalau nanti butuh fitur server-side tambahan (mis. resize gambar otomatis).
- **Reward referral untuk yang diundang (`referred_id`):** 1 hari akses Pro, dipakai di `process-referral-activation` (Bagian 6, langkah 7).
- **Grace period hapus akun:** 7 hari, dicek oleh `process-account-deletions` (Bagian 13). Selama itu user tetap bisa login normal & membatalkan.
- **Syarat hapus akun untuk user Pro:** wajib cancel subscription Play Store dulu (dicek via RevenueCat) — `request-account-deletion` (Bagian 11) menolak request selama entitlement masih aktif.
- **Data referral saat user dihapus:** dianonimkan (`referrer_id`/`referred_id` di-`NULL`-kan), bukan row-nya yang dihapus — lihat `DATABASE_SCHEMA.md` Bagian 2 & 8.

---

## 11. Edge Function: `request-account-deletion`

**Dibuat & di-deploy 5 September 2026. Lihat `TASKS.md` "Hapus Akun & Crash Reporting" dan `CLAUDE.md` Bagian 6.**

**Tujuan:** Memulai proses hapus akun (mengisi grace period), dipanggil user dari layar Pengaturan.

**Alur:**
1. Verifikasi JWT → dapatkan `user_id`.
2. Cek status entitlement Pro user lewat RevenueCat REST API (`GET /subscribers/{app_user_id}`, pakai `user_id` sebagai `app_user_id`).
3. Kalau ada entitlement aktif → return error, **jangan** ubah `deletion_requested_at`. Pesan harus jelas menyuruh user cancel subscription di Play Store dulu.
4. Kalau tidak ada entitlement aktif → `UPDATE profiles SET deletion_requested_at = now() WHERE id = <user_id>`.
5. Return status sukses + tanggal estimasi penghapusan (`now() + 7 hari`).

**Input:** tidak ada body — `user_id` diambil dari JWT.

**Output (sukses):**
```json
{ "status": "ok", "deletion_scheduled_at": "2026-09-12T00:00:00Z" }
```

**Output (masih Pro aktif):** HTTP **409**, bukan 400 — requestnya sendiri sah, akunnya yang sedang dalam keadaan yang melarang, dan keadaan itu bisa diubah user.
```json
{ "error": "ACTIVE_SUBSCRIPTION", "message": "Langganan Pro kamu masih aktif. Batalkan dulu langganannya di Play Store (…), lalu coba hapus akun lagi." }
```

**Tiga hal yang muncul saat implementasi, di luar alur di atas:**

1. **"Sudah cancel" tidak sama dengan "sudah habis".** RevenueCat menjaga entitlement tetap hidup sampai masa bayarnya lewat, jadi user yang sudah melakukan persis yang kita suruh masih terlihat aktif — sampai setahun untuk paket tahunan. Kalau itu ikut ditolak, perintah "batalkan dulu" jadi mustahil dipenuhi. Karena itu `readStoreEntitlement()` membedakan `cancelled` (ada `unsubscribe_detected_at`) dari `active`, dan hanya `active` yang memblokir.
2. **Cadangan saat RevenueCat tidak bisa ditanya.** Kalau `REVENUECAT_SECRET_API_KEY` belum diset, atau RevenueCat error/timeout, hasilnya `unknown` dan keputusan jatuh ke `profiles.tier`/`pro_plan`/`tier_expires_at` — cermin yang ditulis oleh webhook RevenueCat itu sendiri. Sengaja **tidak** menolak semuanya saat pihak ketiga tumbang: Google Play mewajibkan jalur hapus akun tersedia, jadi mematikannya total justru melanggar syarat itu. Yang memblokir cuma kalau cerminnya sendiri masih menunjukkan paket berbayar. `pro_plan = 'referral'` dikecualikan — Pro-nya tidak dari Play Store, jadi tidak ada yang bisa dibatalkan.
3. **Panggilan kedua tidak mengulang jam mulai.** Kalau `deletion_requested_at` sudah terisi, fungsi mengembalikan tanggal yang lama dengan `already_requested: true`. Menimpanya dengan `now()` akan diam-diam memperpanjang masa tunggu tiap kali tombolnya ditekan lagi.

---

## 12. Edge Function: `cancel-account-deletion`

**Dibuat & di-deploy 5 September 2026.**

**Tujuan:** Membatalkan proses hapus akun selama masih dalam grace period.

**Alur:**
1. Verifikasi JWT → dapatkan `user_id`.
2. `UPDATE profiles SET deletion_requested_at = NULL WHERE id = <user_id>`.
3. Return status sukses. Idempotent — kalau dipanggil saat `deletion_requested_at` sudah `NULL`, tetap return sukses (bukan error).

---

## 13. Edge Function: `process-account-deletions` (scheduled/cron)

**Dibuat & di-deploy 5 September 2026.**

**Tujuan:** Job terjadwal harian yang mem-purge permanen akun yang grace period-nya sudah lewat. **Dijalankan terpisah dari `expire-pro-status`** (Bagian 7) — supaya kegagalan satu job tidak mengganggu job lain, mengikuti pola `cleanup-orphan-r2` yang sudah ada di `TASKS.md` Fase 9.

**Alur:**
1. Query semua `profiles` dengan `deletion_requested_at IS NOT NULL AND deletion_requested_at <= now() - interval '7 days'`.
2. Untuk tiap user yang cocok:
   a. Ambil semua `scan_documents` miliknya yang `r2_object_key IS NOT NULL` → hapus object-nya dari R2 satu per satu (pola sama seperti `delete-backup`, Bagian 5).
   b. `UPDATE referral_events SET referrer_id = NULL WHERE referrer_id = <user_id>`.
   c. `UPDATE referral_events SET referred_id = NULL WHERE referred_id = <user_id>`.
   d. Panggil Supabase Admin API `DELETE /auth/v1/admin/users/{user_id}` pakai secret `ScannAppsecret` — ini men-cascade otomatis ke `profiles`, `storage_usage`, `scan_documents` (lihat migration di `DATABASE_SCHEMA.md` Bagian 8).
3. Log hasil tiap user (sukses/gagal) supaya bisa diaudit lewat Supabase Log Viewer.
4. **Wajib idempotent** — kalau job re-run dan user tertentu sudah terhapus duluan (langkah 2d sudah sukses di run sebelumnya tapi job gagal sebelum lanjut ke user berikutnya), user itu otomatis tidak lagi muncul di query langkah 1 (karena `profiles`-nya sudah tidak ada), jadi tidak perlu guard tambahan.

**Detail implementasi:**

- **Kredensial:** bukan JWT user — cron memanggil lewat `pg_net` dengan header `x-cron-secret`, dicocokkan `constantTimeEqual` terhadap Edge Function Secret `CRON_SECRET` yang **sama** dengan `cleanup-orphan-r2`. Karena itu fungsi ini di-deploy dengan `verify_jwt: false` dan tidak memakai `handler()` dari `_shared/http.ts`, persis pola `cleanup-orphan-r2`.
- **Jadwal:** harian **04:00** — setelah `expire-pro-status` (00:00) dan `cleanup-orphan-r2` (03:00), supaya tiga job tidak menumpuk beban di menit yang sama.
- **Batas per run:** maksimal 50 akun. Sisanya diambil run besok, telat sehari paling buruk — lebih baik daripada satu run yang mati di tengah tanpa catatan sampai mana. Query-nya diurutkan `deletion_requested_at` menaik supaya antrean terkuras sesuai urutan terbentuknya.
- **Bukan cuma tiga tabel yang ikut cascade:** `referral_milestone_grants` juga (lihat `DATABASE_SCHEMA.md` Bagian 8), begitu pula `auth.identities` yang memang milik Supabase Auth.

**Catatan urutan penting:** langkah 2a (hapus R2) **harus** selesai sebelum langkah 2d (hapus `auth.users`) — begitu `profiles` terhapus, `scan_documents` ikut cascade terhapus (Bagian 4), sehingga referensi `r2_object_key` hilang dan object itu jadi yatim permanen di R2 tanpa cara menemukannya lagi lewat `scan_documents`. Kalau langkah 2a gagal di tengah (sebagian object terhapus), **jangan lanjut ke 2d** untuk user itu di run yang sama — biarkan tertangkap job `cleanup-orphan-r2` yang sudah ada, lalu retry `process-account-deletions` di run berikutnya.
