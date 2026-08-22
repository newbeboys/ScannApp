-- profiles: 1:1 extension of auth.users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  tier text not null default 'basic' check (tier in ('basic', 'pro')),
  tier_expires_at timestamptz,
  referral_code text unique,
  referred_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_profiles_referred_by on public.profiles(referred_by);

-- referral_milestones: config table, no direct relation
create table public.referral_milestones (
  id uuid primary key default gen_random_uuid(),
  referral_count_required integer not null,
  pro_days_reward integer not null,
  active boolean not null default true
);

-- referral_events: tracks referrer/referred activation
create table public.referral_events (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id),
  referred_id uuid not null references public.profiles(id),
  activated boolean not null default false,
  activated_at timestamptz,
  reward_granted boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_referral_events_referrer_id on public.referral_events(referrer_id);
create index idx_referral_events_referred_id on public.referral_events(referred_id);

-- scan_documents: metadata only, physical file lives on-device and/or R2
create table public.scan_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  title text not null,
  page_count integer not null,
  file_size_bytes bigint not null,
  export_format text not null check (export_format in ('pdf', 'jpg', 'png', 'docx')),
  local_only boolean not null default true,
  r2_object_key text,
  has_ocr boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_scan_documents_owner_id on public.scan_documents(owner_id);

-- storage_usage: enforces per-user R2 quota by tier
create table public.storage_usage (
  user_id uuid primary key references public.profiles(id),
  bytes_used bigint not null default 0,
  quota_bytes bigint not null,
  updated_at timestamptz not null default now()
);
