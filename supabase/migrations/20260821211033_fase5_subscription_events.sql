-- Fase 5 — catatan event langganan dari RevenueCat.
-- Lihat docs/superpowers/specs/2026-08-22-fase5-iklan-monetisasi-design.md

-- event_id dari RevenueCat jadi primary key, dan itu yang menegakkan
-- idempotensi: RevenueCat mengirim ulang webhook yang gagal, dan RENEWAL yang
-- terproses dua kali tidak boleh memperpanjang Pro dua kali.
create table if not exists public.subscription_events (
  event_id text primary key,
  -- Tanpa foreign key ke profiles: event yang tiba untuk user yang sudah
  -- dihapus tetap harus tercatat untuk audit keuangan, bukan ditolak.
  user_id uuid,
  event_type text not null,
  product_id text,
  store text,
  environment text,
  -- Kapan event terjadi menurut RevenueCat, bukan kapan kita menerimanya.
  event_at timestamptz not null,
  -- Akhir masa langganan menurut event ini; null untuk event yang mencabut.
  expires_at timestamptz,
  -- Payload mentah disimpan utuh supaya sengketa pembayaran bisa ditelusuri
  -- tanpa bergantung pada kolom yang kebetulan kita pilih hari ini.
  payload jsonb not null,
  -- Dipisah dari keberadaan barisnya sendiri: baris ditulis lebih dulu (untuk
  -- mengunci event_id), perubahan tier menyusul. Kalau update tier gagal,
  -- kolom ini tetap false sehingga kiriman ulang dari RevenueCat memproses
  -- ulang alih-alih dianggap duplikat dan hilang selamanya.
  applied boolean not null default false,
  received_at timestamptz not null default now()
);

create index if not exists idx_subscription_events_user_id
  on public.subscription_events(user_id);

create index if not exists idx_subscription_events_event_at
  on public.subscription_events(event_at desc);

alter table public.subscription_events enable row level security;

-- User boleh melihat riwayat langganannya sendiri. Tidak ada policy tulis
-- sama sekali: hanya service role (Edge Function) yang menulis ke sini,
-- karena baris di tabel ini adalah bukti pembayaran.
drop policy if exists "subscription_events_select_own" on public.subscription_events;

create policy "subscription_events_select_own" on public.subscription_events
  for select using (auth.uid() = user_id);
