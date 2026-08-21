# Fase 5 — Iklan & Monetisasi (desain)

Tanggal: 2026-08-22
Status: siap diimplementasi

Menutup task Fase 5 di `TASKS.md`. Angka iklan & harga mengikuti `CLAUDE.md` Bagian 6 dan `PRD` Bagian 3 & 6 — tidak ada angka baru yang ditebak di sini.

---

## 1. Dua subsistem yang tidak saling bergantung

Fase 5 sebenarnya dua subsistem terpisah. Dikerjakan berurutan, di-commit terpisah, supaya kalau salah satu bermasalah yang lain tidak ikut ditarik:

| Subsistem | Isi | Bergantung pada |
|---|---|---|
| **A. Iklan** | AdMob banner + interstitial, gating Pro | Fase 3 (tier) |
| **B. Pembelian Pro** | RevenueCat, paywall, webhook verifikasi | Fase 3 (tier) + Fase 4 (pola Edge Function) |

Keduanya bertemu di satu titik: **tier**. Pro tidak melihat iklan; pembelian Pro-lah yang mengubah tier.

## 2. Prinsip: tier adalah otoritas, bukan RevenueCat

`profiles.tier` + `tier_expires_at` tetap satu-satunya sumber kebenaran untuk gating — persis seperti Fase 3. RevenueCat **tidak** dibaca langsung oleh logika gating di client.

Alasannya: Pro bisa datang dari referral (Fase 8), bukan cuma dari pembelian. Kalau gating membaca `customerInfo.entitlements` dari RevenueCat, user Pro-dari-referral akan terlihat Basic. Jadi alurnya satu arah:

```
Pembelian di Play Store
      │
      v
RevenueCat  ──webhook──>  Edge Function  ──>  profiles.tier / tier_expires_at / pro_plan
                                                        │
                                                        v
                                              resolveTier()  ──>  gating & iklan
```

`resolveTier()` dari Fase 3 dipakai apa adanya, tanpa perubahan. Konsekuensinya: setelah pembelian sukses, client harus **me-refresh profil** — bukan menebak dari hasil purchase lokal.

## 3. Subsistem A — Iklan

### 3.1 Plugin & ID

`@capacitor-community/admob` 8.x (mendukung Capacitor 8).

`ADMOB_APP_ID`, `ADMOB_BANNER_UNIT_ID`, `ADMOB_INTERSTITIAL_UNIT_ID` di `.env` **masih kosong** — akun AdMob belum dibuat Boss Ali. Karena itu:

- ID dibaca dari env dengan prefiks `VITE_` (harus sampai ke client).
- Kalau kosong, jatuh ke **ID test resmi Google**, dan mode test dinyalakan.
- Kalau ID asli terisi tapi build-nya `DEV`, tetap pakai ID test — mencegah invalid traffic yang bisa membuat akun AdMob diblokir.

Konsekuensi: aplikasi bisa dibangun dan diuji sekarang tanpa akun AdMob; begitu Boss Ali mengisi env, iklan asli aktif tanpa ubah kode.

### 3.2 Frekuensi (`ADS_INTERSTITIAL_FREQUENCY=every_5_scans_plus_after_export`)

Dipecah jadi logika murni di `src/lib/ads/adFrequency.ts` supaya bisa diuji tanpa device:

- **Tiap 5 scan** — penghitung naik saat satu sesi scan **berhasil disimpan** jadi dokumen, bukan saat scanner dibuka. Membuka lalu membatalkan scanner tidak menghasilkan nilai apa pun untuk user, jadi tidak pantas dibayar dengan iklan.
- **Setelah export** — tiap export sukses memicu interstitial, tanpa penghitung.
- Penghitung disimpan di `localStorage` supaya tidak reset tiap aplikasi dibuka ulang (kalau tidak, user yang rajin restart tidak akan pernah kena interstitial).

### 3.3 Aturan tampil

- Banner: hanya di layar tab utama (home/documents/settings), tidak di layar alur (scanner review, editor, merge, paywall). Iklan di tengah alur kerja merusak alurnya.
- Interstitial: tidak pernah ditampilkan bersamaan dengan share sheet Android — dipicu **setelah** `deliverExport` selesai.
- **Pro: tidak ada iklan sama sekali.** Satu penjaga di titik masuk service, bukan disebar di tiap pemanggil.
- Iklan hanya jalan di native. Di browser (dev) semua operasi jadi no-op diam.

## 4. Subsistem B — Pembelian Pro

### 4.1 Plugin & pembersihan Android

`@revenuecat/purchases-capacitor` 13.x. Bersamaan dengan pemasangannya, dua utang teknis di `TASKS.md` ditutup:

1. **Hapus** baris `com.android.billingclient:billing` di `android/app/build.gradle` — RevenueCat sudah membawa Play Billing sendiri, dua deklarasi berisiko bentrok versi.
2. **Ubah** `android:launchMode` MainActivity dari `singleTask` ke `singleTop` — `singleTask` berisiko membuang callback hasil pembelian lewat `onNewIntent()`.

### 4.2 Identitas user

`Purchases.logIn({ appUserID: <supabase user id> })` dipanggil setiap kali sesi Supabase berubah. Ini yang menyambungkan pembelian di Play Store ke baris `profiles` yang benar — webhook nanti membaca `app_user_id` sebagai `profiles.id`.

Anonymous ID RevenueCat sengaja **tidak** dipakai: aplikasi ini mewajibkan login (keputusan Fase 3), jadi selalu ada user id yang stabil.

### 4.3 Kunci & identifier

| Hal | Nilai | Di mana |
|---|---|---|
| Public SDK key Android | `goog_...` (dari Boss Ali) | `VITE_REVENUECAT_ANDROID_KEY` di `.env` |
| Entitlement | `pro` | dashboard RevenueCat |
| Produk bulanan | `scannapp_pro_monthly` | Play Console + RevenueCat |
| Produk tahunan | `scannapp_pro_yearly` | Play Console + RevenueCat |

Public SDK key memang dirancang untuk ada di client (bukan secret), tapi tetap lewat env var — konsisten dengan Aturan Keras #1 `CLAUDE.md`: tidak ada credential yang di-hardcode di kode.

### 4.4 Harga yang ditampilkan

Harga diambil dari **offering RevenueCat** (`product.priceString`), bukan dari konstanta. Play Store yang menentukan format & mata uang yang dilihat user, dan harga bisa berbeda per negara. `PRICING_PRO_MONTHLY_IDR`/`YEARLY_IDR` di `.env` hanya dipakai sebagai **fallback tampilan** kalau offering gagal dimuat (mis. offline), supaya paywall tidak pernah tampil kosong.

### 4.5 Paywall

Layar penuh `UpgradeScreen`, dipanggil dari:
- Settings → baris "Upgrade ke Pro" (hanya untuk Basic)
- Layar merge, saat Basic menabrak limit 20 halaman

Memakai token yang sudah final di `CLAUDE.md` Bagian 9.2: coral `#FF6B4A` untuk elemen upgrade, gold `#F5C443` untuk badge Pro. Keduanya **tidak** ikut berubah mengikuti tema — Pro harus terlihat sama di keempat tema, itu elemen merek, bukan elemen tema.

Wajib ada (aturan Google Play): tombol **"Pulihkan pembelian"**, keterangan langganan berulang, dan keterangan cara membatalkan.

## 5. Verifikasi di server — Edge Function `revenuecat-webhook`

Satu-satunya jalan `profiles.tier` berubah karena pembelian. Client **tidak pernah** menulis `tier` sendiri — kalau bisa, siapa pun yang memegang anon key bisa memberi dirinya Pro.

- Autentikasi: header `Authorization` dicocokkan dengan `REVENUECAT_WEBHOOK_SECRET` (di-set Boss Ali di dashboard RevenueCat + Supabase Edge Function Secrets). Perbandingannya konstan-waktu.
- Berbeda dari 4 Edge Function Fase 4, fungsi ini **tidak** memakai `handler()` — pemanggilnya RevenueCat, bukan user ber-JWT.
- Event yang menaikkan/memperpanjang Pro: `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE`, `SUBSCRIPTION_EXTENDED`.
- Event yang mencabut: `EXPIRATION`, `REFUND`, `SUBSCRIPTION_PAUSED`.
- `CANCELLATION` **tidak** mencabut apa pun — user membatalkan perpanjangan tapi tetap Pro sampai periode berjalan habis. Pencabutan menunggu `EXPIRATION`.

### 5.1 Pro dari referral tidak boleh terinjak

Ini jebakan utamanya. Kalau webhook menulis `tier = 'basic'` mentah-mentah saat `EXPIRATION`, user yang langganannya habis **tapi masih punya sisa Pro dari referral** akan kehilangan haknya.

Aturan yang dipakai:
- Saat memberi Pro: `tier_expires_at` = **yang paling jauh** antara nilai sekarang dan `expiration_at_ms` dari event. Sisa hari referral tidak hangus karena membeli.
- Saat mencabut: hanya turunkan ke Basic bila `pro_plan` memang `monthly`/`yearly`. Kalau `pro_plan = 'referral'`, event pembelian tidak menyentuhnya.

### 5.2 Tabel `subscription_events`

Migration baru. Menyimpan tiap event webhook (id event, tipe, user, produk, waktu) untuk audit dan **idempotensi** — RevenueCat mengirim ulang webhook yang gagal, dan `RENEWAL` yang diproses dua kali tidak boleh memperpanjang Pro dua kali. `event_id` jadi primary key; event yang sudah ada langsung dibalas 200 tanpa efek samping.

RLS: user boleh membaca barisnya sendiri, tidak ada policy tulis untuk client — hanya service role yang menulis.

## 6. Yang tidak dikerjakan di fase ini

- Membuat akun AdMob & produk di Play Console — langkah manual Boss Ali di luar repo.
- Iklan reward (rewarded ads) — tidak ada di PRD.
- Layar riwayat transaksi — belum diminta.
- iOS (`VITE_REVENUECAT_IOS_KEY`) — iOS belum digarap sama sekali (`CLAUDE.md` Bagian 2).
