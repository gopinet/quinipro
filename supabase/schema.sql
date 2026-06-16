-- ============================================================
-- quinipro — schema
-- Personal app, no auth. RLS stays OFF and all writes go through
-- the server using the service_role key. Do NOT expose anon key
-- with open write policies.
-- ============================================================

create table if not exists fixtures (
  id          bigint primary key,          -- api-sports fixture id
  league_id   int  not null,
  season      int  not null,
  home_id     int  not null,            -- api-sports team id (needed for stats)
  away_id     int  not null,
  home_team   text not null,
  away_team   text not null,
  home_logo   text,
  away_logo   text,
  referee     text,
  kickoff     timestamptz not null,        -- always UTC
  status      text not null default 'NS',  -- NS, LIVE, FT, etc.
  final_home  int,                         -- null until played
  final_away  int,
  stats       jsonb,                       -- cached stats snapshot for the LLM
  updated_at  timestamptz not null default now()
);

create index if not exists fixtures_kickoff_idx on fixtures (kickoff);
create index if not exists fixtures_league_season_idx on fixtures (league_id, season);

create table if not exists predictions (
  id          uuid primary key default gen_random_uuid(),
  fixture_id  bigint not null references fixtures(id) on delete cascade,
  source      text not null check (source in ('ai','me')),
  pred_home   int  not null,
  pred_away   int  not null,
  outcome     char(1) not null check (outcome in ('H','D','A')),
  confidence  numeric,                     -- AI only (0..1)
  reasoning   text,                        -- AI only: short synthesis
  report      jsonb,                       -- AI only: full 5-section report
  created_at  timestamptz not null default now(),
  -- one prediction per fixture per source: predictions are immutable
  unique (fixture_id, source)
);

create index if not exists predictions_fixture_idx on predictions (fixture_id);

-- RLS must be OFF: this is a personal app; all writes go through the server
-- with service_role. Supabase enables RLS by default on new projects.
alter table fixtures    disable row level security;
alter table predictions disable row level security;

-- Knowledge base: LLM-generated summaries of finished WC matches.
-- Used to inject tournament context into future predictions.
create table if not exists match_notes (
  fixture_id        integer primary key,
  home_team         text    not null,
  away_team         text    not null,
  home_id           integer not null,
  away_id           integer not null,
  final_home        integer not null,
  final_away        integer not null,
  events            jsonb,            -- raw events from api-sports (goals, cards)
  summary           text    not null, -- LLM narrative: what happened and why
  home_performance  text    not null, -- LLM assessment of home team
  away_performance  text    not null, -- LLM assessment of away team
  key_takeaways     text    not null, -- what to note in future matches
  created_at        timestamptz default now()
);

create index if not exists match_notes_home_idx on match_notes (home_id);
create index if not exists match_notes_away_idx on match_notes (away_id);
alter table match_notes disable row level security;

-- Idempotent migrations (safe to re-run on an existing DB) -----------------
alter table fixtures    add column if not exists referee text;
alter table predictions add column if not exists report  jsonb;
