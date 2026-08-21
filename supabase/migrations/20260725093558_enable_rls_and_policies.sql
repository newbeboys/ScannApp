alter table public.profiles enable row level security;
alter table public.referral_milestones enable row level security;
alter table public.referral_events enable row level security;
alter table public.scan_documents enable row level security;
alter table public.storage_usage enable row level security;

-- profiles: read own row; update own row but tier/tier_expires_at are frozen for clients
-- (those columns only change via Edge Function/trigger using the service role, which bypasses RLS).
-- No INSERT policy: rows are only created by the on_auth_user_created trigger (Fase 3).
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and tier = (select p.tier from public.profiles p where p.id = auth.uid())
    and tier_expires_at is not distinct from (select p.tier_expires_at from public.profiles p where p.id = auth.uid())
  );

-- referral_milestones: read-only reference data for all authenticated users, managed manually by Boss Ali
create policy "referral_milestones_select_all" on public.referral_milestones
  for select to authenticated using (true);

-- referral_events: user can only see events where they are the referrer (to view their own progress)
-- No INSERT/UPDATE policy: only written by Edge Functions via the service role.
create policy "referral_events_select_own" on public.referral_events
  for select using (auth.uid() = referrer_id);

-- scan_documents: full CRUD but scoped to the owner
create policy "scan_documents_select_own" on public.scan_documents
  for select using (auth.uid() = owner_id);

create policy "scan_documents_insert_own" on public.scan_documents
  for insert with check (auth.uid() = owner_id);

create policy "scan_documents_update_own" on public.scan_documents
  for update using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "scan_documents_delete_own" on public.scan_documents
  for delete using (auth.uid() = owner_id);

-- storage_usage: read-only for the owning user; bytes_used/quota_bytes only change via Edge Function
create policy "storage_usage_select_own" on public.storage_usage
  for select using (auth.uid() = user_id);
