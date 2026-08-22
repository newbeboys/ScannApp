# Fase 3 — Sistem Auth & Tier (desain)

Tanggal: 2026-07-26
Status: disetujui Boss Ali, siap diimplementasi

Dokumen ini menutup semua task di `TASKS.md` Fase 3. Angka bisnis mengikuti `CLAUDE.md` Bagian 6; skema tabel mengikuti `DATABASE_SCHEMA.md`.

---

## 1. Keputusan yang diambil Boss Ali

| Pertanyaan | Keputusan |
|---|---|
| Login wajib atau opsional? | **Wajib.** Tidak ada mode tamu. Akun admin/testing: `demofimance@gmail.com` |
| Metode login | **Email + password.** Tanpa Google Sign-In dan tanpa magic link di versi ini (keduanya butuh setup kredensial/domain di luar kode) |
| Bentuk layar awal | **Landing bermerek → layar masuk/daftar.** Bukan onboarding bergambar tiga slide |
| Masa berlaku Pro | **Selalu berjangka.** Paket pembelian hanya 1 bulan dan 1 tahun — **tidak ada Pro permanen** |

Konsekuensi keputusan terakhir: `profiles.tier_expires_at` wajib terisi untuk setiap Pro. Kalimat "NULL = Pro permanen (dari pembelian)" di `DATABASE_SCHEMA.md` baris 18 sudah tidak berlaku dan diganti aturan di Bagian 4 dokumen ini.

## 2. Arsitektur — cache-first

Sesi dan profil disimpan di device; tier dibaca dari cache lokal dan disegarkan di latar belakang setiap aplikasi dibuka.

Alasan memilih ini di atas dua alternatif (selalu menembak server, atau langganan realtime): dokumen hasil scan disimpan di HP untuk semua tier, jadi tidak ada alasan aplikasi berhenti bekerja saat sinyal hilang. Tier adalah data yang berubah sebulan sekali — tidak sepadan dengan koneksi websocket permanen. Harga yang dibayar: setelah upgrade ke Pro, status baru terlihat paling lambat pada pembukaan aplikasi berikutnya.

```
Aplikasi dibuka
   │
   ├─ ada sesi tersimpan? ── ya ──→ ambil profil di latar belakang ──→ TAB UTAMA
   │                                     └─ gagal / offline → pakai profil dari cache
   └─ tidak ──→ LANDING ──→ MASUK ──→ TAB UTAMA
                    └────→ DAFTAR ──→ (perlu verifikasi email? → layar "Cek email kamu")
                               │
                          LUPA PASSWORD
```

## 3. Perubahan database (satu migration)

Nama migration: `fase3_auth_profile_bootstrap`.

**a. Kolom baru `profiles.pro_plan`** — `text`, nullable, `check (pro_plan in ('monthly','yearly','referral'))`.

Diperlukan karena kuota storage Pro berbeda menurut paket (bulanan 500MB, tahunan 1GB — `CLAUDE.md` Bagian 6) sementara kolom `tier` hanya mengenal `basic`/`pro`. Kolom ini juga yang membuat UI bisa menulis "Pro Bulanan" alih-alih sekadar "Pro". Kosong untuk pengguna Basic. Ditambahkan sekarang, bukan di Fase 5, supaya tidak perlu migrasi ulang saat pembelian masuk.

**b. Fungsi `handle_new_user()`** — `security definer`, `set search_path = public`, dipicu trigger `on_auth_user_created` (`after insert on auth.users`). Satu kali jalan saat signup:

1. Membuat `referral_code` unik 8 karakter dari alfabet tanpa karakter ambigu (`23456789ABCDEFGHJKMNPQRSTVWXYZ` — tanpa `I`, `L`, `O`, `U`, `0`, `1`), diulang sampai mendapat kode yang belum terpakai.
2. Insert `profiles`: `display_name` diambil dari `raw_user_meta_data->>'display_name'`, jatuh ke bagian email sebelum `@` bila kosong. `tier` dibiarkan default `'basic'`.
3. Insert `storage_usage` dengan `quota_bytes = 104857600` (100 MB, kuota Basic).

Semua insert memakai `on conflict do nothing` agar aman bila trigger terpanggil dua kali.

**c. RLS tidak diubah.** Policy yang ada sudah benar dan sudah diverifikasi lewat `pg_policies`:

- `profiles` tidak punya policy `INSERT` sama sekali — baris profil hanya bisa lahir dari trigger `security definer` di atas.
- `profiles_update_own` memakai `WITH CHECK` yang membandingkan `tier` dan `tier_expires_at` dengan nilai lamanya, sehingga client tidak bisa menaikkan dirinya sendiri jadi Pro.
- Kolom baru `pro_plan` **tidak** dilindungi klausa itu. Ini diterima untuk sekarang karena `pro_plan` murni label tampilan — otoritas Pro tetap ada pada `tier` + `tier_expires_at` yang terkunci. Saat Fase 4 memakai `pro_plan` untuk menentukan kuota R2, klausa `WITH CHECK` harus diperluas ke kolom ini.

## 4. Perhitungan tier

`getCurrentTier()` yang sekarang mengembalikan `'basic'` mati diganti fungsi murni `resolveTier(profile, now)`:

| Kondisi profil | Hasil |
|---|---|
| profil `null` (belum termuat / gagal diambil / offline tanpa cache) | `basic` |
| `tier = 'basic'` | `basic` |
| `tier = 'pro'`, `tier_expires_at` **kosong** | `basic` — Pro permanen sudah tidak ada, data begini dianggap tidak wajar |
| `tier = 'pro'`, `tier_expires_at` masih di depan `now` | `pro` |
| `tier = 'pro'`, `tier_expires_at` sudah lewat | `basic` |

Prinsipnya: setiap keraguan jatuh ke `basic`. Bug atau data rusak tidak boleh berujung Pro gratis. Baris terakhir membuat client tetap benar walaupun job harian `expire-pro-status` (Fase 8) belum jalan atau gagal.

Fungsi pendamping `proDaysRemaining(profile, now)` mengembalikan sisa hari (dibulatkan ke atas) untuk ditampilkan di Settings, atau `null` bila bukan Pro.

Nilai `tier` mengalir dari `useAuth()` di `App.tsx` ke `ExportSheet` dan `MergeScreen`. Keduanya sudah menerima `tier` sebagai prop sejak Fase 2, jadi limit merge 20 halaman untuk Basic dan watermark pada export PDF Basic ikut benar tanpa perubahan logika di sana.

## 5. Modul baru

| Berkas | Isi |
|---|---|
| `src/lib/supabase.ts` | Singleton client. Membaca `VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY`, `persistSession: true`, `autoRefreshToken: true` |
| `src/lib/tier.ts` | `resolveTier`, `proDaysRemaining`, tipe `Tier` & `Profile` (menggantikan isi lama) |
| `src/lib/authErrors.ts` | Menerjemahkan pesan error Supabase ke Bahasa Indonesia yang manusiawi |
| `src/lib/profileCache.ts` | Simpan/baca profil terakhir di `localStorage`, dikunci per `userId` |
| `src/lib/profileApi.ts` | Query `profiles` milik user aktif |
| `src/auth/AuthProvider.tsx` | Context: `status`, `user`, `profile`, `tier`, `signIn`, `signUp`, `signOut`, `resetPassword` |
| `src/auth/useAuth.ts` | Hook pembaca context |

Layar baru di `src/screens/`: `SplashScreen`, `LandingScreen`, `AuthScreen` (masuk & daftar dalam satu layar bertab), `ForgotPasswordScreen`.

`SplashScreen` ada supaya pengguna yang sudah login tidak melihat kedipan landing sekilas saat sesi masih dicek.

## 6. Tampilan

Landing dan layar auth dibangun di atas sistem tema yang sudah ada (`src/theme/themes.ts`), sehingga ikut keempat tema (Putih, Samudra, Senja, Lime) dan tidak terasa seperti layar tempelan. Variabel CSS yang dipakai sama dengan layar lain: `--acc`, `--surface`, `--fg`, `--fg-dim`, `--chip`, `--shadow`.

Landing memuat logo, nama aplikasi, satu kalimat nilai jual, tiga poin fitur singkat, tombol utama "Buat akun" dan tautan "Sudah punya akun? Masuk".

Kartu akun di `SettingsScreen` menggantikan kartu paket yang sekarang masih hardcode "Paket Basic": menampilkan nama, email, badge tier, sisa hari bila Pro, dan tombol Keluar.

## 7. Verifikasi email

Project Supabase baru secara bawaan mewajibkan konfirmasi email, dan MCP tidak menyediakan tombol untuk mematikannya. Karena itu UI dibuat tahan dua kemungkinan: bila `signUp` langsung mengembalikan sesi, pengguna masuk seketika; bila tidak, muncul layar "Cek email kamu". Tidak ada deep link yang perlu disiapkan — setelah pengguna menekan tautan di email, ia cukup kembali ke aplikasi dan masuk dengan passwordnya.

Batas kirim email pada Supabase free tier cukup rendah, jadi fitur "Lupa password" perlu diuji secukupnya saja.

## 8. Batasan yang diterima sadar

**Dokumen lokal tidak diberi label pemilik.** Bila dua akun berbeda login di HP yang sama, keduanya melihat dokumen lokal yang sama. Pelabelan pemilik baru benar-benar diperlukan di Fase 4 saat dokumen naik ke R2 dan `scan_documents.owner_id` mulai dipakai, jadi ditunda ke sana ketimbang menambah migrasi index v2→v3 sekarang.

**Akun `demofimance@gmail.com` didaftarkan lewat flow signup aplikasi**, bukan lewat SQL, supaya trigger benar-benar teruji di jalur yang sama dengan pengguna sungguhan. Password ditentukan Boss Ali sendiri dan tidak pernah masuk repo. Untuk menguji tampilan Pro, akun itu di-set `tier='pro'`, `pro_plan='yearly'`, dan `tier_expires_at` berjangka dari sisi server lewat MCP.

## 9. Pengujian

Unit test (Vitest, melanjutkan 33 test Fase 2):

- `tier.test.ts` — kelima kondisi di tabel Bagian 4, plus `proDaysRemaining` (pembulatan ke atas, dan `null` untuk Basic).
- `profileCache.test.ts` — simpan lalu baca; cache milik user lain tidak terbaca setelah ganti akun; cache rusak tidak membuat aplikasi jatuh.
- `authErrors.test.ts` — "Invalid login credentials" jadi "Email atau password salah", pesan tak dikenal jatuh ke pesan umum berbahasa Indonesia.

Setelah migration diterapkan, jalankan `get_advisors` (MCP Supabase) untuk memastikan tidak ada peringatan keamanan baru — khususnya `function_search_path_mutable` yang biasa muncul pada fungsi `security definer`.

Verifikasi manual di device fisik oleh Boss Ali: daftar akun baru → cek baris `profiles` + `storage_usage` + `referral_code` terbentuk otomatis; keluar lalu masuk lagi; buka aplikasi dalam mode pesawat setelah pernah login.
