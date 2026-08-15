# Written response

## What I built

A venue search tool for event planners where the ranking is the easy part and
**the honesty is the product**.

Enter an address, a headcount, a maximum commute and an event style. You get a
ranked shortlist in which every capacity, every minimum spend and every commute
time carries a trust label derived from where the number came from — and
clicking any of them shows the source URL and the verbatim sentence it was read
from.

It runs with an empty `.env`: `npm install && npm run dev` and all three
required scenarios work immediately.

---

## The framing decision

Before writing any code I spent a while on what kind of problem this actually
is, and concluded it is **a provenance problem wearing a search problem's
clothes**.

Private dining capacity data does not exist in any clean API. Google Places
knows a restaurant exists; it has no idea whether the back room seats forty. The
real data lives in PDF banquet menus, in prose on an events page, in Tripleseat
and PartySlate listings, and very often only in a sales manager's head. Any
system that surfaces it is going to be partly guessing.

Given that, the trust label in the brief is not a nice-to-have field to populate
— it is the honest admission that the data is partly guessed, made legible to
someone who has to decide whether to pick up the phone. So I made it structural:
there is no `trust` column anywhere. There is an `evidence` table, and the label
is a pure function of provenance computed at query time.

That one decision drove most of the rest of the design, and it is the thing I
would defend hardest.

---

## Key decisions

### 1. Capacity is per-space and per-configuration

A room that seats 60 holds about 110 standing. If you store one `capacity`
integer, the 200-person Waikiki reception returns nothing and it looks like you
did not read the brief. `seated_cap` and `standing_cap` are separate columns and
the event style selects which is tested.

More importantly, feasibility is a **small solver, not a comparison**. It asks
whether *some* configuration of the venue's rooms holds the group, and returns
that configuration:

- any single space, including venue-published composites and the buyout row
- combinations of up to three atomic rooms sharing a `combinable_group`
- bounded by the group's published full-room capacity

The Waikiki result card therefore reads *"Honolulu Room + Kahuku Room — 200
standing combined"*, which is a thing a planner can act on, rather than "fits
200", which is not.

### 2. Hydration by geographic cell, not batch ingestion

My first architecture had two offline pipelines writing into Postgres. It looked
clean and it was quietly dishonest: it works beautifully for three pre-chosen
cities and returns an empty list the moment someone types an address in Austin.
Empty looks broken, and I had papered over it by planning to precompute the demo
cities — fine for a video, not an architecture.

So the unit of work became a **geographic cell** (geohash-5, ≈4.9 km). A search
resolves its origin to a cell, checks a TTL, and responds immediately from
whatever exists — even nothing — while enrichment runs behind the response and
streams in over SSE.

Three things fall out of this. Arbitrary addresses degrade to *slow* rather than
*empty*. The demo cities are honestly just cells that happen to be warm, rather
than a staged special case. And streaming earns its place in the stack instead
of being decoration.

### 3. Confidence is not in the ranking score

My first scoring function multiplied the total by a confidence factor. I removed
it, and I think this is the most interesting judgement call in the project.

Folding trust into the score means an excellent venue with an opaque website
ranks below a mediocre one with a good events page. That is optimising for the
quality of a restaurant's web presence, which is emphatically not what the
planner is shopping for.

Instead trust is a badge, a filter ("only verified capacity"), and an optional
secondary sort ("fit, confidence-adjusted"). The behaviour is available; it is
just never applied silently inside a weight. The planner decides how much risk
they are willing to carry.

The same principle governs unknowns: a venue that publishes no capacity is
**kept in the results**, flagged, ranked with the capacity term dropped rather
than zeroed. "Capacity unknown, call to confirm" is a useful answer. Silent
omission is not, and a confident wrong number is worse than both.

### 4. Discovery branches on headcount

This is the correctness fix that makes scenario three work at all. Two hundred
people for a reception is not a restaurant search — query "private dining rooms
near Waikiki" and you get izakayas with eight-top back rooms. The venues that
hold 200 standing are hotel ballrooms, resort lawns and beach clubs.

So the discovery query set is templated by headcount band (≤40 / 41–100 / >100)
and modified by event style. The UI states which branch it took, in words, above
the results.

### 5. Asymmetric capacity fit

A room 30% too big scores worse than one 10% too small. Too small usually means
trimming a couple of names off the list; too big means thirty guests in a room
built for four hundred, which reads as a planning failure. The penalty above
target decays about 2.5× faster than below it.

### 6. Zero-config by construction

Every external dependency is optional and independently switchable. Supabase,
Places, Routes and the extraction LLM each flip one adapter from `seed` to
`live`; the header shows which are active. The repository layer has two
implementations behind one interface, and nothing above it knows which is
running.

This was partly pragmatism — a reviewer should not need four API keys to see the
product — but it also forced a genuinely better separation than I would have
written otherwise.

---

## Challenges, and how I worked through them

### The extraction problem is a refusal problem

The hard part is not parsing. It is **not** parsing. Half of independent
restaurants have no private-dining page, and a model that wants to be helpful
will happily invent a "Private Dining Room — seats 40" from a photo caption.

One fabricated room is worse than fifty missing ones. A miss costs the planner a
phone call; an invention destroys the meaning of every `verified` badge in the
product.

So the extraction prompt is written to make null the comfortable answer — "You
are not being graded on how many fields you fill" — and, because prompts are
requests rather than guarantees, the adapter **enforces** it: any number arriving
without a quotable snippet is discarded before it reaches the database. The same
rule exists as a `CHECK` constraint in Postgres, so it holds even if a future
writer bypasses the adapter.

### A double-counting bug the audit script caught

I wrote `scripts/audit-seed.ts` to check invariants that must hold of real venue
data. It immediately found something I had shipped and not noticed.

OUTRIGGER Reef publishes its ballroom as four rows: *(full)*, *3 sections*,
*2 sections*, *1 section*. My composite detection caught *(full)* but not the
section rows, so the solver added "3 sections" (135 standing) to "2 sections"
(90) and confidently reported a 225-capacity room **that does not exist**. It was
ranking third for the Waikiki scenario.

Two fixes. Broaden composite detection to treat any "N sections" row as a union.
And — the general fix — give every combinable group a **ceiling**: subsections
can never combine into more than the whole room they subdivide. That invariant
would have caught the bug regardless of how the rows were named.

### Compound capacity strings

The same audit then flagged fifteen "column vs evidence drift" errors. Real
capacity charts read `"3,528 sq ft, banquet 320, reception 300"`, and my numeric
parser took the first number it found — reporting a **square footage as a seated
capacity**.

Precisely the class of confident-but-wrong figure this whole product exists to
prevent, sitting in my own parser. The fix is a field-aware parser that strips
area tokens, looks for the labelled number, understands ranges ("15-60 guests"
means 60, not 15), and returns null rather than guessing when a string labels
only the other field.

Errors went 15 → 2 → 0. The eight remaining warnings are genuine oddities in
published data — the Westin lists reception capacity *below* banquet for several
small rooms, which is real and worth a human glance, not a bug.

I am including this section deliberately: the audit script is worth more to me
than the features it validated, and both bugs were invisible to the type checker,
the build, and a casual look at the results.

### Getting the Waikiki cell status right

The seeded-cell list was hand-written, and I guessed Waikiki's geohash wrong. The
hardest scenario reported its cell as cold while serving warm data — a small lie
in a product about not lying. Now the cell list is **derived** from where the
venues actually are, so the claim cannot drift from the fact.

---

## Verification

Not assertions — commands you can run.

```bash
npm run audit:seed     # 0 keys, 0 network
```

```
49 venues · 305 spaces · 178 capacity evidence rows
274/305 spaces have a published capacity (90%)
 21/305 spaces have a published minimum spend (7%)

Capacity evidence by derived trust label
  verified     168  (94%)
  likely        10  (6%)
  unverified     0  (0%)

Required scenarios
  Times Square 50 seated       13 feasible of 16 within 1.7 km
  Salesforce Tower 30 seated   17 feasible of 17 within 1.7 km
  Waikiki 200 reception        11 feasible of 16 within 1.7 km

0 error(s), 8 warning(s)
```

Nine invariants: coordinate sanity, standing-vs-seated plausibility, group
ceilings, buyout dominance, quotability of every `explicit` claim, source-class
vs URL host agreement, column-vs-evidence agreement, id uniqueness, and
non-empty results for all three required scenarios.

The 7% minimum-spend coverage is the honest headline. Most venues simply do not
publish an F&B minimum, which is exactly why the price term is neutral-when-
unknown and why the outreach email asks about it.

```bash
npm run eval:golden    # needs ANTHROPIC_API_KEY
```

Ten venues, 54 named spaces, verified by hand against the venues' own capacity
pages and frozen in `src/data/golden-set.ts`. The harness re-fetches each URL,
runs the live extraction adapter, and reports room recall, capacity precision
within ±10%, and — the number that matters — the candidate fabrication rate.

**I have not run this with a live key**, so I am not quoting a precision figure I
cannot stand behind. The harness is real and runnable; the number is the first
thing I would produce with an API key in hand.

---

## Trade-offs I made knowingly

**SSE as the primary streaming transport, Realtime as the secondary.** Supabase
Realtime is wired and the migration publishes the right tables, but SSE is what
the client actually consumes, because it behaves identically whether persistence
is Postgres or the in-memory corpus. Keeping the zero-config path honest was
worth more than using the more fashionable transport.

**Leaflet + OpenStreetMap rather than Google Maps.** No key required, so the map
works out of the box. Swapping the tile layer is one line if a key exists.

**A heuristic link scan to find each venue's events page**, rather than an LLM
call per site. Wrong sometimes; an extra model round-trip per venue purely to
choose a URL is not worth the latency in a path already fetching and extracting.

**Extraction capped at 15 venues per hydration pass.** Cost control. When the cap
bites, the cell note says so rather than silently truncating — a search that
quietly covered 15 of 60 candidates while looking complete is worse than one that
admits it.

**Combinations capped at three rooms.** Past three it stops being one event.

**No availability, no booking.** Explicitly out of scope per the brief, and the
outreach export is built on the assumption that a human closes the loop.

---

## What I would do next

**Run the golden eval and publish the number.** Top of the list. Everything else
here is architecture; that is evidence.

**Move hydration out of the request path.** It currently runs inside the SSE
handler, which is fine for a single user and wrong for many. It wants to be a
queue with a worker — the code is already structured for it (`hydrateCell` is
independently callable and idempotent per cell), it just needs somewhere to run.

**Sub-cell hydration granularity.** Geohash-5 is ~4.9 km, which is right for
Manhattan and coarse for a sparse suburb. Precision should adapt to venue density.

**Multi-source conflict resolution at scale.** The precedence rules and the
disagreement UI exist and work, but the corpus rarely has two independent
sources for the same figure. With Tripleseat and PartySlate ingestion running,
conflicts become common and the range display becomes a headline feature rather
than an edge case.

**Menus and dietary accommodation.** Both are in the brief's nice-to-haves and
both are extraction targets on pages we already fetch. I left them out to keep
the trust model tight on the two fields that decide bookings.

**Calibration, not just labels.** Right now `verified` is a rule. With enough
outreach outcomes logged, it could be a measured probability — "venues labelled
verified were correct 96% of the time" — which is a much stronger claim and
turns the whole thing into a feedback loop.

**Real accessibility and keyboard passes.** The map markers are mouse-first and
the drawer needs proper focus trapping.

---

## A note on the deadline

I built this after the 14 August cut-off had passed. It is submitted as a
portfolio piece rather than a contest entry, and I would rather say so plainly
than have it noticed. The problems in the brief — trust labelling, isochrone
filtering, ranking for fit rather than distance — were worth solving regardless.
