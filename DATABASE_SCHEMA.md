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
| `referred_by` | uuid, nullable, FK → `profiles.id` (`ON DELETE SET NULL` — **diubah 5 September 2026**, sebelumnya `NO ACTION`) | Diisi kalau user ini mendaftar lewat kode referral orang lain. FK ini menunjuk **balik** ke referrer, jadi tanpa `SET NULL` seorang referrer tidak akan pernah bisa menghapus akunnya — tertahan oleh baris profil orang-orang yang dia undang. Menghapus akun seseorang tidak boleh ikut menghapus akun orang yang dia undang, jadi yang dibuang cuma penunjuknya |
| `deletion_requested_at` | timestamptz, nullable | **Baru — hasil brainstorm 5 September 2026, lihat `TASKS.md` "Hapus Akun & Crash Reporting".** Diisi `now()` saat user request hapus akun lewat `request-account-deletion`. `NULL` = tidak sedang dalam proses hapus. Grace period **7 hari** sebelum job `process-account-deletions` mem-purge permanen |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | default `now()`, di-update tiap perubahan |

**RLS Policy:**
- `SELECT`: user hanya bisa baca row miliknya sendiri (`auth.uid() = id`)
- `UPDATE`: user hanya bisa update row miliknya sendiri, dan **tidak boleh** update kolom `tier` / `tier_expires_at` / `deletion_requested_at` secara langsung dari client (kolom-kolom ini hanya diubah lewat Edge Function/trigger server-side — `deletion_requested_at` khususnya hanya lewat `request-account-deletion`/`cancel-account-deletion`, karena butuh pengecekan entitlement RevenueCat dulu sebelum diisi)
- `INSERT`: hanya lewat trigger otomatis saat signup (bukan insert manual dari client)

---

## 2. Tabel `referral_events`

Mencatat setiap kejadian referral (siapa mengundang siapa, sudah activated atau belum).

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid (PK) | default `gen_random_uuid()` |
| `referrer_id` | uuid, nullable, FK → `profiles.id` (`ON DELETE SET NULL` — **diubah 5 September 2026**, sebelumnya `NOT NULL` + `NO ACTION`) | User yang membagikan kode. Di-null-kan otomatis saat user ini menghapus akunnya lewat `process-account-deletions` — statistik & reward yang sudah `reward_granted = true` **tetap valid** walau pointer usernya hilang (anonimisasi, bukan hapus row) |
| `referred_id` | uuid, nullable, FK → `profiles.id` (`ON DELETE SET NULL` — **diubah 5 September 2026**, sebelumnya `NOT NULL` + `NO ACTION`) | User baru yang memakai kode. Perlakuan sama seperti `referrer_id` di atas saat user ini yang hapus akun |
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
| `owner_id` | uuid, FK → `profiles.id` (`ON DELETE CASCADE` — **ditambahkan 5 September 2026**, sebelumnya `NO ACTION`) | Pemilik dokumen. Row ini ikut terhapus otomatis kalau `profiles` induknya dihapus — **tapi object R2 tidak ikut terhapus oleh cascade ini**, harus dihapus eksplisit oleh Edge Function `process-account-deletions` sebelum baris `profiles` dihapus, atau akan jadi object yatim di R2 |
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
| `user_id` | uuid (PK, FK → `profiles.id`, `ON DELETE CASCADE` — **ditambahkan 5 September 2026**, sebelumnya `NO ACTION`. Ini FK yang sebelumnya memblokir hapus user lewat Admin API dengan error `storage_usage_user_id_fkey`, lihat `TASKS.md` "Hapus Akun & Crash Reporting") | |
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

---

## 8. Migration untuk Fitur Hapus Akun (diterapkan 5 September 2026)

Dipicu error nyata saat mencoba hapus user test lewat Supabase Admin API:
`update or delete on table "profiles" violates foreign key constraint
"storage_usage_user_id_fkey" on table "storage_usage"`. Akar masalahnya:
**semua** FK ke `profiles.id` dibuat tanpa klausa `ON DELETE`, jadi defaultnya
`NO ACTION` — Postgres menolak hapus `profiles` selama masih ada row anak yang
menunjuk ke situ. Karena `profiles.id` sendiri ber-`ON DELETE CASCADE` dari
`auth.users`, penolakan itu ikut menggagalkan `DELETE /auth/v1/admin/users/{id}`,
yang artinya user sungguhan pun tidak akan bisa menghapus akunnya lewat app.

**Jumlahnya enam, bukan empat.** Dokumen brainstorm menyebut empat; dua lagi
ketinggalan dan sama-sama memblokir. Keduanya ditemukan saat implementasi
dengan membaca `pg_constraint` di database live, bukan dari dokumen:

| FK | Perlakuan | Kenapa |
|---|---|---|
| `storage_usage.user_id` (Bagian 5) | `CASCADE` | Baris milik satu user, tanpa arti tanpa dia. Ini FK yang muncul di pesan error |
| `scan_documents.owner_id` (Bagian 4) | `CASCADE` | Sama. **Tapi object R2-nya tidak ikut** — lihat catatan urutan di bawah |
| `referral_milestone_grants.referrer_id` | `CASCADE` | **Di luar daftar brainstorm.** Tabelnya baru dibuat di migration `20260901120000`, setelah dokumen desain ditulis, jadi belum punya bagian sendiri di file ini. Isinya ledger anti-dobel-reward milik satu referrer. `SET NULL` mustahil: `referrer_id` bagian dari primary key |
| `referral_events.referrer_id` (Bagian 2) | nullable + `SET NULL` | Barisnya menyangkut dua orang; menghapusnya ikut menghapus bukti reward yang sudah cair ke pihak yang masih ada |
| `referral_events.referred_id` (Bagian 2) | nullable + `SET NULL` | Sama |
| `profiles.referred_by` (Bagian 1) | `SET NULL` | **Di luar daftar brainstorm.** Menunjuk balik ke referrer, jadi tanpa ini seorang referrer tidak akan pernah bisa menghapus akunnya |

Ditambah:

- `profiles.deletion_requested_at` — kolom baru (Bagian 1), plus partial index
  `where deletion_requested_at is not null` untuk query job harian.
- Policy `profiles_update_own` ditulis ulang supaya `deletion_requested_at`
  ikut beku dari client — **dua arah**. Mengisinya sendiri akan melewati
  pengecekan entitlement RevenueCat; mengosongkannya sendiri melewati
  satu-satunya pintu batal yang tercatat. Terbukti: `PATCH /rest/v1/profiles`
  untuk kedua arah dijawab `42501` (5 September 2026).

**Catatan urutan yang menentukan benar-salahnya job:** `CASCADE` di
`scan_documents` **tidak** menyentuh object di R2. Begitu `profiles` terhapus,
baris `scan_documents` ikut hilang dan membawa serta `r2_object_key` —
satu-satunya cara menemukan object itu lagi. Karena itu
`process-account-deletions` wajib menghapus object R2 **lebih dulu**, dan
kalau ada satu saja yang gagal, akunnya dibiarkan utuh untuk run berikutnya
(lihat `BACKEND_API_DESIGN.md` Bagian 13).

Task implementasi lengkap (Edge Function, UI, hasil uji) ada di `TASKS.md`
bagian "Hapus Akun & Crash Reporting". Keputusan bisnis (grace period 7 hari,
syarat cancel subscription Pro, dll) ada di `CLAUDE.md` Bagian 6.
