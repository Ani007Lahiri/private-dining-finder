# Private Dining Finder — Pessimistic Council Critique

A deliberately adversarial review. Six hostile reviewers each attacked one dimension;
this is the synthesis. The tone is pessimistic **by design** — you asked for everything
wrong, not a balanced grade. Read it as a pre-mortem, not a verdict. Where the council
overreached on a factual point, I've corrected it inline (marked **[Correction]**) rather
than pass along a false criticism.

---

## The three findings every reviewer converged on

These came up independently from multiple seats. That convergence is the signal — fix
these first.

### 1. Zero tests on the two subsystems that have *already* shipped bugs
This was the single most-repeated finding — raised by the Staff Engineer, the Data
Skeptic, the Correctness Auditor, and the Hiring Reviewer, all independently.

- The **capacity/feasibility solver** decides whether 200 people fit. It is the entire
  product — everything else is decoration around "can this group physically fit here."
  It has **zero unit tests**.
- The **field-aware capacity parser** has already produced **two confirmed bugs** this
  project (double-counted subdivided ballrooms; square-footage parsed as capacity). Both
  were caught by eyeballing output, not by a harness. Nothing stops a third, or a
  regression of the first two, the next time anyone edits the parser.
- The **`eval:golden` harness has never run** — no `ANTHROPIC_API_KEY` was supplied, so
  there is no precision number anywhere. Every claim about extraction viability is
  unfalsified.
- An audit script (a data linter) and a never-run eval harness are **aspirational
  tooling, not tests**.

**Why it's fatal in a hiring context:** the project's headline pitch is *correctness of
the capacity math*. Shipping it with confirmed defect density and no regression net
contradicts the pitch. A reviewer who sees this reads "polish ordered before
correctness."

**Fix (~2–3 hrs, highest priority of anything here):** 15–20 unit tests on the solver +
parser. Encode the two known bugs as regression fixtures. Cover: single room, combinable
rooms, buyout-only, headcount == capacity, over-capacity rejection, missing-data spaces.

### 2. The default run mode never touches the required stack
The brief's one non-negotiable stack line is **PostgreSQL-on-Supabase**. You built a
complete Supabase adapter — PostGIS migration, RLS, Realtime, a seed-push script — and
then ship a build that runs **in-memory by default and never initializes Supabase**.

Raised by both the Staff Engineer and the Hiring Reviewer as "the worst of both worlds":
full implementation cost, zero demonstrated compliance. A reviewer who clones the repo and
runs `npm run dev` per your README (zero-config) **never sees Postgres fire once**. A
built-but-unexercised adapter is a *claim*, not a deliverable.

**Fix (~30 min):** run the seed script once against a free Supabase project, confirm a
query round-trips through PostGIS, and put a screenshot / short clip in the README showing
`/api/health` reporting `persistence: supabase`. Demote in-memory to "offline fallback for
reviewers without a DB." If you can't verify it end-to-end before submitting, WRITEUP.md
must say **explicitly** "stack requirement implemented but not runtime-verified" — don't
let the reviewer discover that gap themselves.

### 3. The video does not exist, and the scope/time story is a red flag
- **No video.** It's a hard deliverable ("3–5 min"), and it's how a reviewer doing 50+
  take-homes decides in 90 seconds whether to keep reading. Missing it reads as "ran out
  of runway."
- **6,447 lines against a 4–6 hour estimate.** The Hiring Reviewer was blunt: this is
  either 10× over the brief's scope (a judgment/scoping failure — the brief's time
  estimate is itself a signal about what "good" looks like) or largely AI-scaffolded and
  lightly reviewed. **The single git commit erases the one piece of evidence** — iterative
  history — that would distinguish the two. Silence on this in the writeup is, in the
  Hiring Reviewer's words, "disqualifying by itself."

**Fix:** Record the video (1–2 hrs). And add a paragraph to WRITEUP.md that **owns the
scope honestly**: state the real hours, why it grew past the estimate, and what you'd cut
for a true 6-hour version. Turning "smart but won't ship on time" into "deliberately built
a reference architecture, here's what the 6-hour cut would be" is the difference between a
reject and an interview.

---

## Dimension-by-dimension

### Scope & over-engineering (Staff Engineer)
- The **geohash hydration-cell model** is infrastructure for thousands of live-discovered
  venues. Your corpus is 49 venues in memory. **There is no scale problem** — the
  hydration layer is decoration around a flat array lookup. Worse, it routes work to an
  LLM-extraction path whose accuracy was *never measured*. You built the pipe before
  validating the thing it feeds.
- Sequencing was backwards: the last work went into a drawer focus-trap and a Yelp
  adapter, while the required video and the solver tests went unwritten.

### The trust premise (Data/ML Skeptic)
- **"verified 94%" is a lie of framing.** It's a *count of rows tagged `venue_domain`*,
  not a measured accuracy rate. The label is derived from **source class, not from any
  check against reality** — a venue's own website with a stale/wrong number is "verified"
  purely by provenance. An event planner reading "verified" assumes someone confirmed it;
  nobody did. **Fix:** either rename to what's actually measured
  ("venue-published" / "third-party" / "inferred"), or gate the word "verified" on a
  second signal (≥2 independent sources agreeing), not source class alone. This is the
  most intellectually honest single change you could make, and it strengthens the pitch
  rather than weakening it.
- **Price signal is 93% empty** (21/305 spaces have a published min spend) yet it's a
  weighted ranking axis with a user-facing slider. You're weighting an axis populated for
  1 row in 14. **Fix:** suppress the price axis from scoring when coverage for the result
  set is below a threshold, and label it "excluded from score — insufficient data" so a
  planner knows whether price actually moved the ranking.
- **The Yelp hookah-bar mismatch is not a fixed bug — it's proof the matcher is
  unsound.** Name+distance matching fails exactly in dense blocks (Times Square), which is
  where you tested. Tightening one venue's coords patches the case you noticed; the class
  of error recurs silently on any data refresh and still gets labeled "likely."

### Does a planner actually want this (Product/UX)
- **[Correction] "There is no output / no shortlist" is partly wrong.** A
  `ComparisonTray` with a **"Copy shortlist"** button exists (`buildShortlistText` →
  clipboard), and a per-venue **outreach email draft** exists (`buildOutreachEmail`) — and
  it's cleverer than the council assumed: it generates the questions to ask *from the gaps
  in your own data*. So the "last mile" is not entirely missing. **But the valid core of
  the critique stands:** the takeaway is plain clipboard text, not a client-facing
  document (PDF / shareable link). The polished artifact a planner hands to an exec
  doesn't exist yet.
- **Trust-labels-everywhere is cognitive load, not a decision aid.** A pill on every
  number across 49 venues means the eye can't prioritize; the genuinely important signal
  (7% price coverage) drowns in a wash of green/yellow dots. **Fix:** collapse field-level
  trust into a per-venue rollup ("Ready to book from data" / "Needs a call"), with the
  granular evidence behind a "why this rank" click — not painted on by default.
- **Desktop-only.** Two `sm:` breakpoints, a hardcoded `w-[340px]` sidebar,
  `max-w-[1600px]` container. Event planners work from phones and tablets constantly. This
  one is *visible in the video the reviewer watches*, unlike tests. **Fix (2–3 hrs, not a
  full rework):** collapse the sidebar to a bottom sheet below `md:`, single-column
  results with a map toggle.

### Correctness & security (Auditor)
- **[Correction] "Straight-line commute is a correctness lie" is substantially wrong.**
  Commute *is* a haversine estimate, but it applies a mode-specific detour factor and
  speed model, and it is **honestly labeled**: estimated routes are `likely`, API-measured
  routes are `verified` (`routes.ts` is explicit about this being exactly the kind of thing
  it refuses to misrepresent). This is the labeling the auditor demanded — the critique is
  already satisfied. *One residual valid point:* make sure the "estimate vs measured"
  distinction is legible in the **card/list** view, not only a drawer tooltip.
- **Valid and urgent — the Yelp API key.** It was shared in chat; treat it as **burned**
  and rotate it before the repo goes anywhere public. Separately, confirm
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is **HTTP-referrer-restricted** in Google Cloud — if
  not, it's a live billing/abuse vector the moment a demo URL is shared.
- **The 429 degrade path is unverified as *correct*.** "6/15 gracefully degraded" — to
  what? It must resolve to "reputation unavailable," never a stale or best-guess match
  wearing a "likely" label. **Fix:** a test asserting a rate-limited call returns *no
  match*, plus a distinct UI state for "rate-limited" vs "not found," plus backoff so a
  planner doing several searches doesn't 429 the majority of venues routinely.
- **Three high-severity npm advisories, untriaged.** Costs almost nothing to convert "we
  ignored a security scan" into "we triaged it." **Fix (~30 min):** `npm audit`, paste the
  advisory IDs + one line each on exploitability/fix status into WRITEUP.md.
- **Live-demo landmines:** map tiles from `cartocdn` and Yelp 429s both fail in front of a
  reviewer. Pre-warm or screen-record the demo rather than doing it live on a flaky
  network.

### Will this make top 5 (Hiring Reviewer)
- The deadline has passed — get **written confirmation** a late submission will even be
  read before investing more, or treat it explicitly as a portfolio piece.
- The one thing that flips "impressive but exhausting" → "hire this person": **a real
  eval:golden number** (even a bad one) plus **an honest scope paragraph**. Both convert
  hopes into engineering claims.

---

## Differentiating extras — ranked by impact / effort

The Strategist's kill list first, because *adding* features to an untested core makes a
sharp reviewer trust the new features **less**, not more.

**Kill (noise given current state):**
- **Menus / dietary extraction** — with price coverage already at 7%, structured
  menu/dietary data will be even sparser. Building it advertises the corpus's thinness.
- **More venues** — hand-research doesn't scale in the time left; the live-discovery path
  is unproven. Adding volume multiplies the unverified-label problem.

**Build (high leverage, cheap, demoable):**

1. **"Why this rank" explanation — impact HIGH / effort LOW.** The scorer already computes
   the three axis components; you're currently throwing the intermediates away. Render
   them: *"#2: fits in 2 combinable rooms (110% margin) · 14 min under commute cap · price
   unverified (heuristic)."* This is the single most interview-relevant feature — it turns
   "a tool that ranks" into "a tool that reasons like a planner." Ship first.
2. **Confidence-aware "call these first" triage — impact HIGH / effort LOW-MED.** A strip:
   *"3 venues bookable from data alone · 12 need a call to confirm min spend."* This
   **launders your real weakness (7% price coverage) into a feature.** Keep it orthogonal
   to the score (don't fold trust into ranking — that separation is correct as-is).
3. **Client-facing shortlist doc — impact MED / effort MED.** You already have the
   clipboard shortlist and the outreach draft; the missing piece is a *clean printable /
   shareable* version (print stylesheet or a static serialized route) that strips the
   internal sliders and shows 3–5 venues with trust caveats visible. Do this only after
   #1 and #2 — it's presentation, not new reasoning.

**Already built (don't re-invent — showcase instead):**
- Per-venue **outreach email draft** (`buildOutreachEmail`) — questions generated from
  data gaps. This is the Strategist's proposed differentiator #3, already done. **Put it in
  the video** — it's the most "I understand a planner's actual day" artifact you have.
- **Copy-shortlist** from the ComparisonTray. Show it; then position the PDF/share version
  above as the natural next step.

---

## The honest bottom line

Strip the pessimism and the shape is: **a genuinely well-conceived architecture whose core
correctness is unproven and whose packaging is unfinished.** The council's fatal findings
are not about the design — the design is better than most submissions. They're about
*evidence*: no tests on the fragile core, no measured precision number, no video, no
runtime proof of the required stack, one commit hiding the process. Every one of those is
fixable in under a day combined, and none requires rebuilding anything.

If you do exactly four things — **(1)** solver/parser regression tests, **(2)** run
`eval:golden` once and publish the number, **(3)** verify + screenshot the Supabase path,
**(4)** record the video with an honest scope paragraph — you convert the entire "smart but
didn't finish / can't scope" narrative into "reference-quality build with the receipts to
prove it." That's a top-5 packet.
