-- Fase 8 — sambungkan kode referral yang dimasukkan saat signup ke referred_by,
-- dan tambah kolom bukti "sudah scan" (diisi Edge Function, bukan trigger ini).
-- Lihat docs/superpowers/specs/2026-09-01-fase8-referral-design.md Bagian 4.

alter table public.profiles
  add column if not exists first_scan_completed_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fallback_name text;
  referrer_id uuid;
  submitted_code text;
begin
  fallback_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    split_part(coalesce(new.email, 'pengguna'), '@', 1)
  );

  -- Kode referral opsional dari signup metadata (field "Kode referral" di
  -- AuthScreen). Kode kosong/tidak ketemu bukan error -- referrer_id tetap
  -- null dan signup jalan persis seperti sebelum referral ada.
  submitted_code := upper(trim(coalesce(new.raw_user_meta_data ->> 'referred_by_code', '')));

  if submitted_code <> '' then
    select id into referrer_id from public.profiles where referral_code = submitted_code;
  end if;

  insert into public.profiles (id, display_name, referral_code, referred_by)
  values (new.id, fallback_name, public.generate_referral_code(), referrer_id)
  on conflict (id) do nothing;

  insert into public.storage_usage (user_id, bytes_used, quota_bytes)
  values (new.id, 0, 104857600)
  on conflict (user_id) do nothing;

  if referrer_id is not null then
    insert into public.referral_events (referrer_id, referred_id)
    values (referrer_id, new.id);
  end if;

  return new;
end;
$$;
