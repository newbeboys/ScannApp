-- Fase 5 — tutup celah: pro_plan bisa diubah sendiri oleh client.
--
-- Policy profiles_update_own dibuat di Fase 0, sebelum kolom pro_plan ada
-- (kolom itu baru ditambahkan migration Fase 3). Akibatnya tier dan
-- tier_expires_at dibekukan, tapi pro_plan tidak — user Pro Bulanan bisa
-- meng-update barisnya sendiri jadi 'yearly' dan mendapat kuota 1GB, bukan
-- 500MB, tanpa membayar selisihnya.
--
-- Celah ini sudah ada sejak Fase 3, tapi baru bernilai sekarang: Fase 5 yang
-- membuat perbedaan paket itu berarti secara komersial.
--
-- pro_plan sekarang ikut dibekukan. Yang boleh mengubahnya cuma
-- revenuecat-webhook dan job referral (Fase 8), keduanya memakai service role
-- yang melewati RLS.

drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and tier = (select p.tier from public.profiles p where p.id = auth.uid())
    and tier_expires_at is not distinct from
        (select p.tier_expires_at from public.profiles p where p.id = auth.uid())
    and pro_plan is not distinct from
        (select p.pro_plan from public.profiles p where p.id = auth.uid())
  );
