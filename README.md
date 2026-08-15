# Private Dining Finder

Ranked private dining and event-venue search for corporate event planners.
Built for the Nowadays Private Dining Finder challenge.

Enter an address, a headcount, a maximum commute and an event style; get back a
ranked shortlist where **every number carries the source it came from** and a
trust label derived from that source — not asserted by hand.

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. **No API keys, no database, no configuration.**
All three required scenarios are one click each in the left panel.

That works because the repository ships a real, hand-researched corpus of 49
venues across the three scenario cities — 305 named spaces and 292 evidence rows,
each with the URL and the verbatim sentence its figure came from. The app treats
it as a *warm cache*, not a mock: cells that happen to be pre-indexed serve
instantly, and an address anywhere else routes to the live pipeline.

### Turning on the live path

Copy `.env.example` to `.env.local` and fill in whichever adapters you want.
Each variable independently flips one adapter from `seed` to `live`; the header
bar shows which are active, and `/api/health` reports the same in JSON.

| Variable | Turns on |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Postgres persistence (from in-memory) |
| `SUPABASE_SERVICE_ROLE_KEY` | Hydration worker writes + Realtime |
| `GOOGLE_MAPS_API_KEY` | Places discovery, address autocomplete, measured commute times |
| `ANTHROPIC_API_KEY` | Runtime capacity/spend extraction from venue pages |

With none of them set the product still works end to end; it simply degrades to
seed discovery and straight-line commute estimates, and labels them as such.

### Supabase setup

```bash
# 1. Create a project at supabase.com, then run this in the SQL editor:
cat supabase/migrations/0001_init.sql

# 2. Put the URL + service-role key in .env.local, then:
npm run seed:push
```

The migration enables PostGIS, creates the six tables, adds a GiST index on a
generated `geography` column, defines the `venues_within` RPC used for the
stage-1 radius filter, sets up RLS, and publishes `venues` and
`hydration_cells` to the Realtime publication.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run audit:seed` | **Invariant audit of the seed corpus.** No keys, no network. |
| `npm run eval:golden` | **Extraction precision against hand-verified ground truth.** Needs `ANTHROPIC_API_KEY`. |
| `npm run seed:push` | Push the corpus into Supabase |

`npm run audit:seed` is worth running first — it prints the dataset's provenance
profile and checks nine invariants that must hold of real venue data. It is how
the double-counting bug described in `WRITEUP.md` was found.

---

## Architecture

### The core idea

Private dining capacity data does not exist in any clean API. It lives in PDF
banquet menus, in prose on a venue's events page, in Tripleseat and EventUp
listings, and in a lot of cases only in a sales manager's head. This is a
**provenance problem wearing a search problem's clothes** — so the trust label
is not a garnish on the results, it is the schema.

Every fact a planner would act on gets an `evidence` row: the value, the source
URL, the verbatim snippet, the source class, and how it was extracted. The trust
label is a pure function of that provenance:

| Label | Means |
|---|---|
| **Verified** | An explicit figure published by the venue itself or a structured partner listing. You can read the sentence. |
| **Likely** | Inferred from prose, taken from an aggregator, or two equally authoritative sources disagree. |
| **Needs a call** | Nothing published anywhere we could read. Not a guess — an admission. |

Clicking any figure in the UI shows the quote and links the source.

### Hydration, not ingestion

The unit of work is a **geographic cell** (geohash precision 5, ≈ 4.9 km), not a
venue. A search resolves its origin to a cell, checks the TTL, and responds
immediately from whatever the database already holds — even if that is nothing.
Enrichment runs behind the response and streams results in over SSE.

```
search ──► cell fresh? ──yes──► rank + return (instant)
              │
              no
              ▼
        return what exists NOW ──► SSE: results
              │
              ▼
        discover (Places, banded by headcount)
              ▼
        fetch events page ──► extract ──► write venue+spaces+evidence
              ▼
        re-rank ──► SSE: appended ──► "8 more venues found — merge"
```

The alternative — offline batch ingestion — demos beautifully for three
pre-chosen cities and returns an empty list the moment a planner types an
address in Austin, which looks broken rather than cold. This way arbitrary
addresses degrade to *slow*, never to *empty*, and the demo cities are honestly
just cells that happen to be warm.

Late-arriving results are held behind an explicit merge banner once the planner
has started scrolling, so the list never reorders under their cursor.

### Schema

```
venues            id, name, address, geog(Point,4326) [GiST], phone, email,
                  website, events_url, cuisine, venue_kind
venue_spaces      id, venue_id, name, seated_cap, standing_cap, is_buyout,
                  combinable_group, is_composite, min_spend_cents, min_spend_period
evidence          id, venue_id, space_id, field, value, source_url, source_class,
                  snippet, extractor, extracted_at
commute_cache     origin_geohash, venue_id, mode, duration_s, distance_m, method
hydration_cells   geohash5, mode, status, venue_count, hydrated_at, expires_at
searches          params, result_ids, created_at
```

Two decisions carry most of the weight:

**Capacity is per-space and per-configuration.** A room that seats 60 holds
about 110 standing. Store one `capacity` integer and the 200-person Waikiki
reception returns nothing. `seated_cap` and `standing_cap` are separate columns
and the event style selects which one is tested.

**`combinable_group` + `is_composite`.** The sum of a venue's rooms is not a real
number — airwalls exist, kitchens do not move. Only rooms in the same group may
be added, and rows that already represent a union ("Coral I/II combined",
"Diamond Head Ballroom – 3 sections") are excluded from the solver's own search
so they cannot be double-counted.

### Capacity feasibility

Not a comparison — a small solver. It asks whether *some* configuration works,
and returns the configuration rather than a boolean:

1. any single space, including venue-published composites and the buyout row
2. combinations of up to three atomic rooms within one `combinable_group`,
   bounded by the group's published full-room capacity
3. ranked by tightness of fit, tie-broken toward fewer moving parts

So the Waikiki card reads *"Honolulu Room + Kahuku Room — 200 standing
combined"*, not *"fits 200"*.

### Discovery branches on headcount

Two hundred people for a reception is not a restaurant search. Query "private
dining rooms near Waikiki" and you get izakayas with eight-top back rooms. The
venues that hold 200 standing are hotel ballrooms, resort lawns and beach clubs
— a different noun entirely. So the query set branches:

| Band | Searches |
|---|---|
| ≤ 40 | restaurants with private rooms, chef's tables, wine cellars |
| 41–100 | restaurant buyouts, brewery taprooms, gallery spaces |
| > 100 | hotel ballrooms, event venues, rooftops, beach clubs, museums |

Event style modifies it further — "reception" pulls in standing-capacity venues
a seated search correctly excludes. The banner above the results says which
branch was taken, in words.

### Commute — two stages

**Walking is the default mode**, with driving available as a toggle; the third
scenario specifies a 15-minute walk and the UI states the active mode on every
card.

1. **Prefilter.** PostGIS `ST_DWithin` on the geography column with a radius of
   `mode_speed × max_minutes`, using deliberately optimistic speeds. It is a
   straight-line ceiling, so it over-selects — false positives cost one matrix
   row, false negatives silently lose a venue that qualified. The translucent
   circle on the map is this exact radius.
2. **Measure.** Survivors batch through the Routes API, 25 destinations per call,
   cached in `commute_cache` against a precision-7 geohash of the origin (≈150 m)
   so two searches from the same block reuse one matrix.

Without a Routes key, commute falls back to crow-flies distance × a street-detour
factor, and is labelled `likely` rather than `verified`. The trust model applies
to our own computations too.

### Ranking

Hard filters first (commute, then capacity feasibility), then a score over three
axes with **weights exposed to the planner** as sliders:

- **Capacity fit, asymmetric.** A room 30% too big scores worse than one 10% too
  small. Too small means trimming a couple of names; too big means thirty guests
  in a room built for four hundred.
- **Commute**, normalised against the planner's stated maximum — not against the
  best result in the set.
- **Price fit**, neutral where unknown. A term that cannot be scored is dropped
  and the remaining weights renormalise, so an opaque website never counts
  against a venue.

**Confidence is deliberately not in the score.** An earlier revision folded it in
as a multiplier, which quietly optimises for the quality of a restaurant's web
presence rather than its suitability. Trust is surfaced as a badge, a filter
("only verified capacity") and an optional secondary sort
("fit, confidence-adjusted"). The planner decides how much risk to carry.

Every card exposes its component breakdown. "Ranked by fit" is only credible if
you can see why #2 beat #5.

### Extraction

The hard part is refusing to extract. Half of independent restaurants have no
private-dining page, and a helpful model will invent a "Private Dining Room —
seats 40" out of a photo caption. One fabricated room is worse than fifty missing
ones, because it destroys the meaning of the trust label everything else rests on.

So the prompt makes null the comfortable answer, and the adapter enforces it:
**any number without a quotable snippet is discarded before it reaches the
database**, and the same rule exists as a `CHECK` constraint in Postgres.

---

## Project layout

```
src/
  app/
    page.tsx                    planner shell — search, list, map, tray
    api/search/route.ts         synchronous search
    api/search/stream/route.ts  SSE: status → results → hydrate → appended → done
    api/venue/[id]/route.ts     single venue with full evidence
    api/health/route.ts         active adapters + computed dataset provenance
  components/                   search form, cards, detail drawer, map, tray
  lib/
    trust.ts                    trust derivation, precedence, conflicts, parsing
    capacity.ts                 feasibility solver
    ranking.ts                  asymmetric scoring
    discovery.ts                headcount-banded query templates
    hydration.ts                geographic-cell enrichment
    search.ts                   orchestration
    repo/                       Supabase | in-memory, one interface
    adapters/                   places · routes · extraction
  data/
    research/*.json             the researched corpus, as gathered
    seed.ts                     normalisation into evidence-backed records
    golden-set.ts               frozen ground truth for the eval
supabase/migrations/0001_init.sql
scripts/                        audit-seed · eval-golden · push-seed
```

## Tech

Next.js 15 (App Router) · React 19 · Tailwind · Supabase Postgres + PostGIS ·
Leaflet with OpenStreetMap tiles (no key required) · Zod · SSE for streaming,
with a Supabase Realtime path when configured.

See `WRITEUP.md` for decisions, trade-offs, what broke, and what I would do next.
