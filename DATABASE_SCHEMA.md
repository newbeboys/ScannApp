# Database Schema — Supabase (Project Scanner App)

**Catatan penting:** Ini adalah project Supabase yang **terpisah** dari FinanceApp. Jangan gunakan URL/anon key FinanceApp di project ini.

Storage file TIDAK ada di sini — file fisik hasil scan disimpan lokal di device dan/atau Cloudflare R2. Tabel di bawah hanya menyimpan **metadata**, bukan file binernya.

---

## 1. Tabel `profiles`

Extend dari `auth.users` bawaan Supabase (relasi 1:1).

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid (PK, FK → `auth.users.id`) | Sama dengan user id Supabase Auth |
| `display_name` | text | Nama tampilan user |
| `tier` | text | `'basic'` \| `'pro'` — default `'basic'` |
| `tier_expires_at` | timestamptz, nullable | Kapan status Pro berakhir. **Wajib terisi untuk setiap Pro** — tidak ada Pro permanen, paket pembelian hanya 1 bulan & 1 tahun (keputusan Boss Ali, Fase 3). `NULL` untuk Basic; `NULL` pada baris `tier='pro'` dianggap data tidak wajar dan diperlakukan sebagai Basic oleh client |
| `pro_plan` | text, nullable | `'monthly'` \| `'yearly'` \| `'referral'` — asal status Pro. Penentu kuota storage (500MB/1GB) dan label di UI. `NULL` untuk Basic. Ditambahkan di migration `fase3_auth_profile_bootstrap` |
| `referral_code` | text, unique | Kode referral unik milik user ini. Dibuat otomatis oleh trigger signup: 8 karakter dari alfabet `23456789ABCDEFGHJKMNPQRSTVWXYZ` (tanpa karakter yang gampang tertukar) |
| `referred_by` | uuid, nullable, FK → `profiles.id` | Diisi kalau user ini mendaftar lewat kode referral orang lain |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | default `now()`, di-update tiap perubahan |

**RLS Policy:**
- `SELECT`: user hanya bisa baca row miliknya sendiri (`auth.uid() = id`)
- `UPDATE`: user hanya bisa update row miliknya sendiri, dan **tidak boleh** update kolom `tier` / `tier_expires_at` secara langsung dari client (kolom ini hanya diubah lewat Edge Function/trigger server-side)
- `INSERT`: hanya lewat trigger otomatis saat signup (bukan insert manual dari client)

---

## 2. Tabel `referral_events`

Mencatat setiap kejadian referral (siapa mengundang siapa, sudah activated atau belum).

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid (PK) | default `gen_random_uuid()` |
| `referrer_id` | uuid, FK → `profiles.id` | User yang membagikan kode |
| `referred_id` | uuid, FK → `profiles.id` | User baru yang memakai kode |
| `activated` | boolean | default `false`. Jadi `true` setelah `referred_id` menyelesaikan scan pertamanya |
| `activated_at` | timestamptz, nullable | Diisi saat `activated` jadi `true` |
| `reward_granted` | boolean | default `false`. Jadi `true` setelah reward untuk milestone terkait sudah diberikan |
| `created_at` | timestamptz | default `now()` |

**RLS Policy:**
- `SELECT`: user hanya bisa lihat row di mana dia adalah `referrer_id` (untuk lihat progress referral-nya sendiri)
- `INSERT`/`UPDATE`: hanya lewat Edge Function (service role), tidak ada insert/update langsung dari client

**Catatan implementasi:** Milestone reward (skema tiered — lihat PRD Bagian 5) dihitung dengan `COUNT(*) WHERE referrer_id = X AND activated = true`, dibandingkan ke tabel milestone (lihat di bawah).

---

## 3. Tabel `referral_milestones`

Konfigurasi milestone (supaya angka bisa diubah tanpa deploy ulang kode).

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid (PK) | default `gen_random_uuid()` |
| `referral_count_required` | integer | Jumlah referral berhasil yang dibutuhkan |
| `pro_days_reward` | integer | Berapa hari akses Pro yang diberikan |
| `active` | boolean | default `true`, untuk menonaktifkan milestone tanpa hapus row |

**RLS Policy:** `SELECT` untuk semua authenticated user (read-only, supaya UI bisa tampilkan progress milestone). Tidak ada `INSERT`/`UPDATE`/`DELETE` dari client — dikelola manual dari dashboard oleh Boss Ali.

**Seed data final (lihat PRD v2 Bagian 5):**
```sql
INSERT INTO referral_milestones (referral_count_required, pro_days_reward, active) VALUES
  (5, 7, true),
  (15, 25, true),
  (30, 60, true);
```

---

## 4. Tabel `scan_documents` (metadata dokumen)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid (PK) | default `gen_random_uuid()` |
| `owner_id` | uuid, FK → `profiles.id` | Pemilik dokumen |
| `title` | text | Nama dokumen (bisa diedit user) |
| `page_count` | integer | Jumlah halaman |
| `file_size_bytes` | bigint | Ukuran file setelah kompresi |
| `export_format` | text | `'pdf'` \| `'jpg'` \| `'png'` \| `'docx'` |
| `local_only` | boolean | default `true`. `false` kalau sudah di-backup ke R2 |
| `r2_object_key` | text, nullable | Key object di R2 (diisi setelah backup berhasil) |
| `has_ocr` | boolean | default `false`. `true` kalau sudah diproses OCR (fitur Pro) |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | default `now()` |

**RLS Policy:**
- `SELECT`/`INSERT`/`UPDATE`/`DELETE`: user hanya bisa akses row miliknya sendiri (`auth.uid() = owner_id`)

**Catatan:** Tabel ini murni metadata untuk sinkronisasi status backup & pencarian dokumen — bukan tempat menyimpan isi file.

**Enforcement limit merge (final — PRD v2 Bagian 3):** Saat operasi merge dokumen, cek `profiles.tier` user. Kalau `tier = 'basic'` dan hasil merge akan membuat `page_count > 20`, tolak operasi di sisi client **dan** validasi ulang di server (Edge Function/trigger) sebelum insert row baru — jangan hanya mengandalkan validasi client karena bisa dilewati.

---

## 5. Tabel `storage_usage`

Untuk menegakkan quota per-user di R2 (lihat CLAUDE.md aturan #3 & PRD soal quota per-tier).

| Kolom | Tipe | Keterangan |
|---|---|---|
| `user_id` | uuid (PK, FK → `profiles.id`) | |
| `bytes_used` | bigint | default `0`, diupdate tiap upload/hapus berhasil |
| `quota_bytes` | bigint | Kuota sesuai tier (Basic: kecil, Pro: besar — angka final: open decision) |
| `updated_at` | timestamptz | default `now()` |

**RLS Policy:** `SELECT` hanya untuk row milik sendiri. `UPDATE` hanya lewat Edge Function (service role) — client tidak boleh mengubah `bytes_used`/`quota_bytes` sendiri (mencegah user memalsukan kuotanya).

---

## 6. Diagram Relasi (ringkas)

```
auth.users (Supabase bawaan)
    │ 1:1
    ▼
profiles ──┬── 1:N ──> scan_documents
            │
            ├── 1:1 ──> storage_usage
            │
            ├── 1:N ──> referral_events (sebagai referrer_id)
            └── 1:N ──> referral_events (sebagai referred_id)

referral_milestones (tabel konfigurasi, tidak berelasi langsung)
```

---

## 7. Trigger yang Perlu Dibuat

1. **`on_auth_user_created`** — ✅ **sudah dibuat di Fase 3** (migration `fase3_auth_profile_bootstrap`). Trigger di `auth.users` yang auto-insert row `profiles` + `storage_usage` (quota Basic 100MB) saat signup, sekaligus generate `referral_code` unik lewat fungsi `generate_referral_code()`. Kedua fungsi `security definer` ini sudah di-`revoke` dari role `anon`/`authenticated` supaya tidak bisa dipanggil sebagai endpoint RPC.
2. **`on_scan_document_backup`** — setelah `scan_documents.local_only` berubah jadi `false`, update `storage_usage.bytes_used` (+file_size_bytes).
3. **`on_scan_document_delete`** — kalau dokumen yang sudah di-backup dihapus, kurangi `storage_usage.bytes_used`.

Implementasi trigger #2 dan #3 sebaiknya lewat Edge Function (bukan Postgres trigger murni), karena perlu koordinasi dengan operasi hapus di R2 juga — lihat `BACKEND_API_DESIGN.md`.
