-- Bizvyra initial schema (T001). Written only; applied by the owner, not by agents.
-- Accessed server-side only with the service role key. RLS is enabled on every table with
-- no policies, so the anon and authenticated roles can read or write nothing.

-- gen_random_uuid() is built into PostgreSQL 13+ (Supabase).

-- targets: what is being tested. protected_assets and canary are needed by the judge;
-- they are never copied into findings in clear.
create table public.targets (
  id               uuid primary key default gen_random_uuid(),
  module           text not null check (module in ('chatbot', 'web_email')),
  name             text not null check (char_length(name) between 1 and 80),
  config           jsonb not null default '{}'::jsonb,
  protected_assets text[] not null default '{}',
  canary           text not null,
  owner_token_hash text not null check (owner_token_hash ~ '^[a-f0-9]{64}$'),
  owner_user_id    uuid null, -- reserved for login after the hackathon (no FK until auth is used)
  created_at       timestamptz not null default now()
);
create index targets_owner_token_hash_idx on public.targets (owner_token_hash);

create table public.scans (
  id          uuid primary key default gen_random_uuid(),
  target_id   uuid not null references public.targets (id) on delete cascade,
  module      text not null check (module in ('chatbot', 'web_email')),
  kind        text not null check (kind in ('baseline', 'retest')),
  level       smallint not null check (level between 0 and 2),
  status      text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  score       numeric(5, 2) null check (score between 0 and 100),
  grade       text null check (grade in ('A', 'B', 'C', 'D', 'F')),
  summary     jsonb null,
  created_at  timestamptz not null default now(),
  finished_at timestamptz null
);
create index scans_target_id_idx on public.scans (target_id);

-- findings: per the shared Finding shape. evidence and response are redacted before insert.
create table public.findings (
  id                 uuid primary key default gen_random_uuid(),
  scan_id            uuid not null references public.scans (id) on delete cascade,
  module             text not null check (module in ('chatbot', 'web_email')),
  check_id           text not null,
  title_en           text not null,
  title_ur           text not null,
  status             text not null check (status in ('breach', 'pass', 'error', 'skipped')),
  severity           smallint not null check (severity between 1 and 3),
  standard           text not null,
  evidence           text not null default '' check (char_length(evidence) <= 1000),
  judged_by          text not null check (judged_by in ('canary', 'asset', 'overlap', 'llm', 'rule', 'none')),
  business_impact_en text not null,
  business_impact_ur text not null,
  lang               text null check (lang in ('en', 'ur', 'roman_ur')),
  technique          text null,
  intent             text null,
  prompt             text null check (char_length(prompt) <= 4000),
  response           text null check (char_length(response) <= 1000),
  latency_ms         integer not null default 0 check (latency_ms >= 0),
  created_at         timestamptz not null default now(),
  unique (scan_id, check_id)
);
create index findings_scan_id_idx on public.findings (scan_id);

create table public.fixes (
  id         uuid primary key default gen_random_uuid(),
  target_id  uuid not null references public.targets (id) on delete cascade,
  module     text not null check (module in ('chatbot', 'web_email')),
  level      smallint not null check (level between 1 and 2),
  content    jsonb not null,
  created_at timestamptz not null default now()
);
create index fixes_target_id_idx on public.fixes (target_id);

-- reports: scan_ids is an array, so it cannot carry a foreign key; the app checks it on insert.
create table public.reports (
  id         uuid primary key default gen_random_uuid(),
  share_slug text not null unique check (share_slug ~ '^[A-Za-z0-9_-]{8,64}$'),
  scan_ids   uuid[] not null check (cardinality(scan_ids) between 1 and 10),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table public.leads (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 100),
  business   text not null check (char_length(business) between 1 and 120),
  contact    text not null check (char_length(contact) between 3 and 120),
  target_id  uuid null references public.targets (id) on delete set null,
  message    text not null default '' check (char_length(message) <= 2000),
  created_at timestamptz not null default now()
);
create index leads_target_id_idx on public.leads (target_id);

-- verifications: endpoint ownership checks (used after the hackathon).
create table public.verifications (
  id          uuid primary key default gen_random_uuid(),
  target_id   uuid not null references public.targets (id) on delete cascade,
  method      text not null check (method in ('dns_txt', 'http_file', 'meta_tag')),
  code        text not null,
  verified_at timestamptz null,
  created_at  timestamptz not null default now()
);
create index verifications_target_id_idx on public.verifications (target_id);

-- usage: free-tier counters, one row per key (e.g. hashed IP) per day.
create table public.usage (
  key   text not null,
  day   date not null,
  count integer not null default 0 check (count >= 0),
  primary key (key, day)
);

alter table public.targets       enable row level security;
alter table public.scans         enable row level security;
alter table public.findings      enable row level security;
alter table public.fixes         enable row level security;
alter table public.reports       enable row level security;
alter table public.leads         enable row level security;
alter table public.verifications enable row level security;
alter table public.usage         enable row level security;
