-- Postgres memberi EXECUTE ke PUBLIC secara bawaan, dan anon/authenticated
-- mewarisi hibah itu — jadi revoke ke kedua role saja tidak berpengaruh.
-- Cabut dari PUBLIC dulu, baru sisakan akses ke pemilik/service role.
revoke all on function public.generate_referral_code() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
