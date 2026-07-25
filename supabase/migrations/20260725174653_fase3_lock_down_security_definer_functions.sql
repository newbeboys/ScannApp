-- Kedua fungsi ini hanya dipakai dari dalam trigger, bukan dari client.
-- Tanpa revoke, PostgREST mengeksposnya sebagai /rest/v1/rpc/... yang bisa
-- dipanggil siapa saja (temuan advisor 0028 & 0029).
revoke all on function public.generate_referral_code() from anon, authenticated;
revoke all on function public.handle_new_user() from anon, authenticated;
