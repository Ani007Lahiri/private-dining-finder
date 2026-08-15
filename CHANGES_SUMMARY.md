# Changes — council-critique implementation pass

This pass implements every code-side bullet from the pessimistic council critique,
lowest-effort first. Everything type-checks (`tsc --noEmit` exit 0), builds
(`next build` exit 0, route `/` 37.4 kB / 140 kB), and the new tests run green.

**16 files: 12 modified, 4 new.** All changes are in the working tree on your Mac,
uncommitted.

---

## 1. Security & npm-audit triage → `SECURITY_NOTES.md` (new)

Ran `npm audit` and triaged all 3 high-severity advisories. All are build/dev-time
(postcss + sharp, transitive via Next), the only offered fix is a breaking Next 16 major
bump, and **neither vulnerable path is runtime-reachable** here: `next/image` is not
imported anywhere (sharp never runs), and postcss runs at build time on our own Tailwind
CSS. Documented as accepted-not-patched with the reasoning, plus the two key actions only
you can do (rotate the exposed Yelp key; referrer-restrict the Maps browser key).

## 2. Honest trust-stat labeling + commute legibility

- `trust.ts` — sharpened the "Verified" hint: it means a **citable authoritative
  source**, not that we re-confirmed the number is current.
- `page.tsx` — matching tooltip on the "N with verified capacity" header count.
- `VenueCard.tsx` — the commute now shows a visible **"measured" / "est."** qualifier and
  a `≈` prefix on estimated distances, so the distinction reads without hovering.

## 3. "Why this rank" rationale line

- `format.ts` — new `rankRationale()` condenses the score components into one line.
- `VenueCard.tsx` — each card now shows **"#3 because: strong capacity fit · well within
  walk limit · price not scored"**. (The drawer already had the full per-axis breakdown;
  this surfaces the reasoning without a click.)

## 4. Price-coverage guard

Only 7% of spaces publish a minimum spend, so the price axis silently contributed almost
nothing to the ranking. The per-venue math was already honest (unknown price → dropped,
weights renormalise). Added the **result-set-level** honesty:
- `search.ts` — computes `priceKnown` / `priceCoverage` / `priceScored` (floor 30%).
- `page.tsx` — an amber note when price didn't really shape the ranking: *"Only 3 of 15
  venues publish a minimum spend — treat it as a call-to-confirm field, not a filter."*

## 5. "Call these first" triage strip

- `ranking.ts` — `triageBucket()` / `triageSummary()`, **orthogonal to the score** (trust
  is never folded into ranking). "Ready" = verified capacity **and** contact on file.
- `page.tsx` — a strip with two clickable pills — **"N bookable from data · M need a
  call"** — that filter the list. This turns the 7%-price weakness into a decision aid.

## 6. Hardened Yelp matcher + distinct failure states

- `yelp.ts` — rewritten to return a **tagged outcome** (`matched` / `no_match` /
  `rate_limited` / `unavailable` / `disabled`) instead of a bare null, so a temporary
  throttle is never mistaken for "no reputation". Added **429 backoff** (2 retries
  honouring `Retry-After`) and an **ambiguity guard** that refuses to match when the top
  two candidates are near-tied on both distance and name — the exact class of the old
  hookah-bar mismatch.
- `types.ts` / `ranking.ts` / `search.ts` — `yelpStatus` threaded through.
- `ReputationBadge.tsx` — new `ReputationStatus` renders the rate-limited state distinctly
  ("try again shortly"); no-match/unavailable stay silent.
- Live re-tested through the proxy: Wayfare/Bond 45/Hilton/Carmine's matched, a nonsense
  venue correctly returned `no_match`.

## 7. Per-venue trust rollup

- `VenueCard.tsx` — a single dominant readiness chip at the top of each card
  (**"Ready to shortlist from data" / "Needs a call to confirm"**), so the eye lands on
  one trust signal. The per-field badges stay below (each attached to its own fact) and
  the full evidence trail stays in the drawer — the provenance thesis is intact, just no
  longer a wash of dots.

## 8. Mobile-responsive pass

- `page.tsx` — below `md`: the search panel becomes an off-canvas overlay toggled from a
  header **"Search"** button (with a scrim); the results list and map become a single
  pane with a **List / Map** switch; adapter chips hide on the narrowest screens. At `md+`
  the original side-by-side layout is unchanged. Usable on a phone/tablet now, which is
  where planners actually work.

## 9. Client-facing shortlist export

- `outreach.ts` — new `buildShortlistHtml()`: a clean, self-contained, printable document
  (inline styles, no scripts, escaped) with a Print/Save-as-PDF button, per-venue facts,
  plain-English trust pills, and a footer explaining the labels. No app chrome, no
  sliders, no scores.
- `ComparisonTray.tsx` — a **"Client shortlist (PDF)"** button opens it in a new tab
  (blob URL, no server route); the old plain-text export is relabeled "Copy text".
- A rendered sample is saved as `shortlist_sample.html` — open it in a browser to preview.

## 10. Solver + parser regression tests → `src/lib/__tests__/` (new)

- **23 tests, all green**, using `node:test` (zero new deps). `npm test` added to
  package.json (`tsx --test`).
- `parser.test.ts` (10) — encodes the **square-footage-as-capacity** bug as a named
  regression ("3,528 sq ft, banquet 320" → 320, not 3528), plus ranges, labelled figures,
  composites, and min-spend parsing.
- `capacity.test.ts` (13) — encodes the **double-counted subdivided ballroom** bug as a
  named regression (135 + 90 sections must not exceed the 225 whole-room ceiling), plus
  single/combination/cross-group/buyout/reception-standing/undershoot-tolerance/
  unknown-vs-infeasible/tightest-fit.

---

## Follow-ups that require you (cannot be done from the sandbox)

1. **Run the tests once on your Mac** to see them green in your own terminal:
   `npm test` (uses `tsx --test`).
2. **Rotate the Yelp API key** — it was shared in chat; regenerate it in the Yelp
   dashboard and update `.env.local`. See `SECURITY_NOTES.md`.
3. **Referrer-restrict the Google Maps key** in Google Cloud before any public demo URL.
4. **Run `eval:golden`** with an `ANTHROPIC_API_KEY` and record the extraction-precision
   number in WRITEUP.md — the one credibility number still missing.
5. **Verify the Supabase path end-to-end** (seed-push → a query round-trips PostGIS) and
   screenshot `/api/health` reporting `persistence: supabase`, so the required stack reads
   as demonstrably used.
6. **Record the 3–5 min video** — the only hard submission requirement still outstanding.
   Good things to show off now: the fixed drawer, the "why this rank" line, the triage
   strip, the client shortlist PDF, the mobile layout, and `npm test` going green.

## To commit

```bash
cd ~/Desktop/private-dining-finder
git add -A
git commit -m "Implement council-critique fixes: rank rationale, triage, price guard, Yelp hardening, mobile, shortlist export, solver tests"
git push
```

The full unified diff is in `CHANGES.diff`.
