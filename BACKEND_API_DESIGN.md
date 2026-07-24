# Backend & API Design — Scanner App

Backend logic dijalankan lewat **Supabase Edge Functions** (Deno runtime). Client (React app) tidak pernah berkomunikasi langsung dengan Cloudflare R2 — selalu lewat Edge Function sebagai perantara yang memverifikasi identitas & tier user dulu.

---

## 1. Prinsip Keamanan Wajib

- R2 access key & secret **hanya** disimpan sebagai environment variable di Edge Function (server-side), **tidak pernah** dikirim ke client. Nama secret yang sudah terpasang di Supabase: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET_NAME` — akses lewat `Deno.env.get('<NAMA>')`.
- Operasi yang butuh bypass RLS (update `profiles.tier`, `referral_events`, `storage_usage`) memakai Supabase secret key yang sudah tersimpan dengan nama `ScannAppsecret` — akses lewat `Deno.env.get('ScannAppsecret')`.
- Setiap Edge Function yang menyentuh data user wajib memverifikasi JWT Supabase (`supabase.auth.getUser()`) di awal — tolak request kalau tidak valid.
- Signed URL R2 punya masa berlaku pendek (rekomendasi: 5-10 menit) supaya tidak bisa dipakai ulang/disebarkan.

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
