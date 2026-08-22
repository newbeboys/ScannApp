-- Fase 3 — bootstrap profil otomatis saat signup.
-- Lihat docs/superpowers/specs/2026-07-26-fase3-auth-tier-design.md

-- 1. Paket Pro selalu berjangka (bulanan/tahunan/hadiah referral).
--    Kolom ini label tampilan + penentu kuota storage di Fase 4;
--    otoritas Pro tetap pada tier + tier_expires_at.
alter table public.profiles
  add column if not exists pro_plan text;

alter table public.profiles
  drop constraint if exists profiles_pro_plan_check;

alter table public.profiles
  add constraint profiles_pro_plan_check
  check (pro_plan is null or pro_plan in ('monthly', 'yearly', 'referral'));

-- 2. Kode referral 8 karakter, tanpa karakter yang gampang tertukar
--    saat dibacakan atau diketik ulang (I, L, O, U, 0, 1 dibuang).
create or replace function public.generate_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate text;
  attempt int := 0;
begin
  loop
    candidate := '';
    for _ in 1..8 loop
      candidate := candidate || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
    end loop;

    exit when not exists (select 1 from public.profiles where referral_code = candidate);

    attempt := attempt + 1;
    if attempt > 50 then
      raise exception 'Gagal membuat referral_code unik setelah % percobaan', attempt;
    end if;
  end loop;

  return candidate;
end;
$$;

-- 3. Trigger signup: profiles + storage_usage (kuota Basic 100MB).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fallback_name text;
begin
  fallback_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    split_part(coalesce(new.email, 'pengguna'), '@', 1)
  );

  insert into public.profiles (id, display_name, referral_code)
  values (new.id, fallback_name, public.generate_referral_code())
  on conflict (id) do nothing;

  insert into public.storage_usage (user_id, bytes_used, quota_bytes)
  values (new.id, 0, 104857600)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
