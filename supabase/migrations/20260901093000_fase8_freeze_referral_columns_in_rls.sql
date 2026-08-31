-- Fase 8 — tutup celah: referral_code, referred_by, dan first_scan_completed_at
-- (kolom baru Task 1) bisa diubah sendiri oleh client lewat REST API, sama
-- seperti celah pro_plan yang ditutup migration 20260821211045.
--
-- Tanpa ini, first_scan_completed_at khususnya jadi lubang serius: user bisa
-- PATCH kolom itu sendiri jadi terisi, lalu panggil process-referral-activation
-- tanpa pernah benar-benar scan -- membatalkan seluruh gerbang "reward hanya
-- cair setelah scan sungguhan" (CLAUDE.md Aturan Keras #6).
--
-- Yang boleh mengubah ketiganya cuma handle_new_user() (referral_code/
-- referred_by, sekali saat signup) dan process-referral-activation
-- (first_scan_completed_at), keduanya lewat service role yang melewati RLS.

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
    and referral_code is not distinct from
        (select p.referral_code from public.profiles p where p.id = auth.uid())
    and referred_by is not distinct from
        (select p.referred_by from public.profiles p where p.id = auth.uid())
    and first_scan_completed_at is not distinct from
        (select p.first_scan_completed_at from public.profiles p where p.id = auth.uid())
  );
