-- ═════════════════════════════════════════════════════════════════════════════
-- Private Dining Finder — initial schema
--
-- Run this in the Supabase SQL editor (or `supabase db push`) before
-- `npm run seed:push`.
--
-- Design notes worth reading before changing anything here:
--
--   * Capacity is per-SPACE and per-CONFIGURATION, never a single integer on
--     the venue. A room that seats 60 holds ~110 standing; collapsing that into
--     one number makes a 200-person reception search return nothing.
--
--   * `evidence` is the source of truth for anything a planner would act on.
--     The denormalised columns on venue_spaces are a read convenience; the
--     trust label is always derived from evidence rows at query time.
--
--   * `combinable_group` exists because the sum of a venue's rooms is not a
--     real number. Only rooms that physically open into one another may be
--     added, and `is_composite` marks rows that already represent such a union
--     so the solver does not double-count them.
-- ═════════════════════════════════════════════════════════════════════════════

create extension if not exists postgis;
create extension if not exists pg_trgm;

-- ── Enums ────────────────────────────────────────────────────────────────────

do $$ begin
  create type venue_kind as enum ('restaurant', 'hotel', 'event_space', 'bar', 'museum', 'rooftop');
exception when duplicate_object then null; end $$;

do $$ begin
  create type source_class as enum ('venue_domain', 'partner_listing', 'aggregator', 'heuristic');
exception when duplicate_object then null; end $$;

do $$ begin
  create type extractor_kind as enum ('explicit', 'prose_inference', 'heuristic');
exception when duplicate_object then null; end $$;

do $$ begin
  create type evidence_field as enum ('seated_cap', 'standing_cap', 'min_spend', 'phone', 'email', 'address');
exception when duplicate_object then null; end $$;

do $$ begin
  create type min_spend_period as enum ('per_event', 'per_hour', 'f_and_b');
exception when duplicate_object then null; end $$;

do $$ begin
  create type commute_mode as enum ('walking', 'driving');
exception when duplicate_object then null; end $$;

do $$ begin
  create type hydration_status as enum ('cold', 'hydrating', 'warm', 'stale', 'unavailable');
exception when duplicate_object then null; end $$;

-- ── venues ───────────────────────────────────────────────────────────────────

create table if not exists venues (
  id                 text primary key,
  name               text        not null,
  address            text        not null default '',
  lat                double precision not null,
  lng                double precision not null,
  -- Generated so it can never drift from lat/lng.
  geog               geography(Point, 4326)
                     generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  latlng_approximate boolean     not null default false,
  phone              text,
  email              text,
  website            text,
  events_url         text,
  cuisine            text,
  venue_kind         venue_kind  not null default 'event_space',
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- The stage-1 radius filter lives on this index.
create index if not exists venues_geog_idx on venues using gist (geog);
create index if not exists venues_name_trgm_idx on venues using gin (name gin_trgm_ops);

-- ── venue_spaces ─────────────────────────────────────────────────────────────

create table if not exists venue_spaces (
  id                text primary key,
  venue_id          text not null references venues(id) on delete cascade,
  name              text not null,
  seated_cap        integer,
  standing_cap      integer,
  is_buyout         boolean not null default false,
  -- Rooms sharing a group key physically open into one another.
  combinable_group  text,
  -- True when this row IS a union the venue publishes ("Coral I/II combined").
  -- Excluded from the solver's combination search to avoid double-counting.
  is_composite      boolean not null default false,
  min_spend_cents   bigint,
  min_spend_period  min_spend_period,
  created_at        timestamptz not null default now(),

  constraint seated_cap_sane   check (seated_cap   is null or (seated_cap   between 1 and 20000)),
  constraint standing_cap_sane check (standing_cap is null or (standing_cap between 1 and 50000)),
  constraint min_spend_sane    check (min_spend_cents is null or min_spend_cents >= 0)
);

create index if not exists venue_spaces_venue_idx on venue_spaces (venue_id);
create index if not exists venue_spaces_group_idx on venue_spaces (venue_id, combinable_group)
  where combinable_group is not null;
-- Partial indexes for the two capacity filters that actually get used.
create index if not exists venue_spaces_seated_idx   on venue_spaces (seated_cap)   where seated_cap   is not null;
create index if not exists venue_spaces_standing_idx on venue_spaces (standing_cap) where standing_cap is not null;

-- ── evidence ─────────────────────────────────────────────────────────────────
-- Every fact a planner would act on, with the URL and the sentence it came from.

create table if not exists evidence (
  id            text primary key,
  venue_id      text not null references venues(id) on delete cascade,
  space_id      text references venue_spaces(id) on delete cascade,
  field         evidence_field not null,
  -- Text, so one table serves numeric and string facts alike.
  value         text not null,
  source_url    text not null default '',
  source_class  source_class not null,
  -- Verbatim. Shown to the planner so they can judge the claim themselves.
  snippet       text not null default '',
  extractor     extractor_kind not null,
  extracted_at  timestamptz not null default now(),

  -- An `explicit` claim must be quotable. This is the database-level version of
  -- the same guardrail the extraction adapter enforces in code.
  constraint explicit_requires_snippet
    check (extractor <> 'explicit' or length(snippet) > 0)
);

create index if not exists evidence_venue_idx on evidence (venue_id);
create index if not exists evidence_space_field_idx on evidence (space_id, field);
create index if not exists evidence_field_idx on evidence (venue_id, field);

-- ── commute_cache ────────────────────────────────────────────────────────────
-- Keyed by a COARSE geohash of the origin (precision 7 ≈ 150 m) so two searches
-- from the same block reuse one Routes matrix instead of paying twice.

create table if not exists commute_cache (
  origin_geohash text not null,
  venue_id       text not null references venues(id) on delete cascade,
  mode           commute_mode not null,
  duration_s     integer not null,
  distance_m     integer not null,
  method         text not null default 'measured' check (method in ('measured', 'estimated')),
  fetched_at     timestamptz not null default now(),
  primary key (origin_geohash, venue_id, mode)
);

create index if not exists commute_cache_lookup_idx on commute_cache (origin_geohash, mode);

-- ── hydration_cells ──────────────────────────────────────────────────────────
-- The unit of enrichment work. Precision 5 ≈ 4.9 km square.

create table if not exists hydration_cells (
  geohash5     text not null,
  mode         commute_mode not null,
  status       hydration_status not null default 'cold',
  venue_count  integer not null default 0,
  hydrated_at  timestamptz,
  expires_at   timestamptz,
  note         text,
  primary key (geohash5, mode)
);

-- ── searches ─────────────────────────────────────────────────────────────────

create table if not exists searches (
  id         bigint generated always as identity primary key,
  params     jsonb not null,
  result_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists searches_created_idx on searches (created_at desc);

-- ── Stage-1 spatial prefilter ────────────────────────────────────────────────
-- ST_DWithin on the geography column. The radius passed in is a straight-line
-- CEILING derived from mode speed × max minutes, so it deliberately
-- over-selects: false positives cost a Routes matrix row, false negatives
-- silently lose a venue that qualified.

create or replace function venues_within(
  origin_lat double precision,
  origin_lng double precision,
  radius_m   double precision
)
returns setof venues
language sql
stable
as $$
  select v.*
  from venues v
  where st_dwithin(
    v.geog,
    st_setsrid(st_makepoint(origin_lng, origin_lat), 4326)::geography,
    radius_m
  )
  order by v.geog <-> st_setsrid(st_makepoint(origin_lng, origin_lat), 4326)::geography;
$$;

-- ── updated_at ───────────────────────────────────────────────────────────────

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists venues_touch on venues;
create trigger venues_touch before update on venues
  for each row execute function touch_updated_at();

-- ── Row level security ───────────────────────────────────────────────────────
-- This is a research tool over public business information: everything is
-- world-readable. Writes are restricted to the service role, which is what the
-- hydration worker runs as. `searches` is insert-only for anon so the client
-- can log a query without being able to read anyone else's.

alter table venues          enable row level security;
alter table venue_spaces    enable row level security;
alter table evidence        enable row level security;
alter table commute_cache   enable row level security;
alter table hydration_cells enable row level security;
alter table searches        enable row level security;

do $$ begin
  create policy "public read venues"          on venues          for select using (true);
  create policy "public read spaces"          on venue_spaces    for select using (true);
  create policy "public read evidence"        on evidence        for select using (true);
  create policy "public read commute"         on commute_cache   for select using (true);
  create policy "public read cells"           on hydration_cells for select using (true);
  create policy "anon insert searches"        on searches        for insert with check (true);
exception when duplicate_object then null; end $$;

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Publishing venues and hydration_cells lets the browser subscribe to a cell
-- and receive newly enriched venues as they land, rather than polling.

do $$ begin
  alter publication supabase_realtime add table venues;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table hydration_cells;
exception when duplicate_object then null; end $$;
