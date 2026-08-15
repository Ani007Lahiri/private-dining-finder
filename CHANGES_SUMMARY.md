# Changes — drawer fix, UI polish, Yelp enrichment

This session made three sets of changes to the working tree. Nothing is committed
yet. Everything type-checks (`tsc --noEmit` exit 0) and builds (`next build` exit 0).

**12 files: 10 modified, 2 new.**

---

## 1. Fixed the blank detail-drawer tabs (the reported bug)

**Root cause:** a z-index stacking-context escape, not a data crash. The drawer is
`fixed z-50`, but Leaflet's stylesheet assigns its own map panes z-index 200–700 and
its controls up to ~1000. Once real map tiles load (on a normal network) those opaque
panes paint *over* the drawer body — so the tabs looked blank. The prior session only
saw the drawer "work" because their sandbox blocked the tile CDN, leaving the panes
transparent. Confirmed by server-rendering the drawer with real seed data: 10,717 chars
of HTML, no throw.

- **`src/app/page.tsx`** — added `isolate` (CSS `isolation: isolate`) to the map's
  wrapper `<div>`. That creates a new stacking context which contains all of Leaflet's
  internal z-indexes, so the drawer (z-50) and comparison tray (z-40) sit above cleanly.
  One line, fixes the root cause, covers the tray too.
- **`src/app/globals.css`** — updated a now-stale comment that said leaflet CSS is
  CDN-loaded (it's an npm import since the earlier leaflet fix), and documented the
  `isolate` rationale.

## 2. Restrained UI polish

- **`src/app/globals.css`** — added `scrim-in` / `panel-in` keyframes and
  `.animate-scrim` / `.animate-panel` classes, plus a `prefers-reduced-motion` block
  that disables all row/drawer animation.
- **`src/components/VenueDetail.tsx`** — the drawer now:
  - slides in from the right with a fading scrim (240 ms eased);
  - closes on **Escape** and locks background scroll while open;
  - **traps focus** — Tab cycles within the drawer, focus moves into it on open and
    returns to the venue card that opened it on close. (This closes the accessibility
    gap the handoff named: "the drawer needs focus trapping.")
- **`src/components/VenueCard.tsx`** — the rank is now a filled pill for the top 3 and a
  light pill for the rest, so the ranked order reads at a glance.

## 3. Yelp enrichment adapter

Yelp is an **aggregator** in the app's provenance model, so everything it contributes
carries a **`likely`** trust label — never `verified`, and never folded into the fit
score (same principle as confidence: it would optimise for web presence, not fit).

**New files:**
- **`src/lib/adapters/yelp.ts`** — `enrichWithYelp(venue)` and batched
  `enrichVenuesWithYelp(venues, concurrency=5)`. Matches a seed venue to a Yelp business
  by name search sorted by distance, accepting on coordinates within 120 m **or**
  name-similarity ≥ 0.5 within 400 m; closest confident match wins. Returns rating,
  review count, price tier ($–$$$$), categories, deep link, and the match distance.
  A no-op with no key; never throws into the search path.
- **`src/components/ReputationBadge.tsx`** — star rating + review count + price tier +
  a `likely` trust badge, with a Yelp deep link. Compact variant on the card, full
  variant in the drawer header.

**Wiring:**
- **`src/lib/config.ts`** — new `yelp` config block (`YELP_API_KEY`), and
  `reputation: 'yelp' | 'off'` added to `AdapterStatus` / `adapterStatus()` so
  `/api/health` and the header report it.
- **`src/lib/types.ts`** — `RankedResult.yelp` field + `YelpReputation` type.
- **`src/lib/search.ts`** — `attachYelp()` runs after ranking, before the sort. It
  serves **both** search paths (`/api/search` and `/api/search/stream` both call
  `runSearch`). Best-effort: a Yelp outage or rate-limit degrades to no reputation,
  never a failed search.
- **`src/lib/ranking.ts`** — new `reputation` sort mode (rating, review count as
  tiebreaker; unmatched venues sort last, not dropped).
- **`src/lib/params.ts`** — `reputation` added to the sort zod enum and `sortModes`.
- **`src/app/page.tsx`** — `reputation` sort label + a `reputation` AdapterChip in the
  header; the sort option is hidden unless Yelp is enabled.

**Live-verified** against the real seed corpus: a Times Square search with the
reputation sort enriched 9/15 venues, correctly rating-sorted (Del Frisco's 4.2★/3,725,
Bond 45 4.1★/2,968, Carmine's 4.0★/5,603, …). The other 6 hit the trial key's rate
limit (HTTP 429) and gracefully carried no reputation while the search still returned
all 15.

---

## Two things you need to do by hand

The sandbox blocks writing any `.env*` file (including `.env.example`), so these two
edits could not be made for you:

**1. Add your Yelp key to `.env.local`** (create the file if it doesn't exist):

```
YELP_API_KEY=<your key from yelp.com/developers>
```

`.env.local` is already git-ignored. **Regenerate this key in the Yelp dashboard after
your demo** — it was shared in chat and should be treated as exposed.

**2. Add a Yelp section to `.env.example`** so the template documents the new variable.
Paste this in (anywhere before the `# ── Tuning ──` block):

```
# ── Yelp reputation ──────────────────────────────────────────────────────────
# Fusion API key -> third-party rating, review count, and price tier ($-$$$$)
# attached to each venue. Yelp is an aggregator, so these are surfaced with a
# `likely` trust label and are never folded into the fit score -- they enable the
# "Highest Yelp rating" sort and a reputation line on each result. Without this,
# results carry no reputation signal and the app behaves exactly as before.
# Get a key at https://www.yelp.com/developers (free tier).
YELP_API_KEY=
```

---

## To commit

```bash
cd ~/Desktop/private-dining-finder
git add -A
git commit -m "Fix drawer z-index, polish UI, add Yelp reputation enrichment"
git push
```

The full unified diff of the tracked-file changes is in `CHANGES.diff`.

## Note on the sandbox

`node`'s built-in `fetch` needed `NODE_USE_ENV_PROXY=1` to reach Yelp **inside this
sandbox only** (the sandbox has no direct DNS; traffic must go through its HTTP proxy).
**On your Mac, Node reaches Yelp directly with no flag** — the adapter code needs no
proxy configuration.
