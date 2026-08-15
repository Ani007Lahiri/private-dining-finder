/**
 * Seed corpus invariant audit.
 *
 * Runs with zero API keys and zero network. This is the verification artifact
 * for a dataset whose entire premise is calibrated uncertainty: if the corpus
 * itself contains contradictions, the trust labels computed from it are
 * decoration.
 *
 * Every check below is a property that must hold of REAL venue data. A failure
 * is either a transcription error or a genuine oddity worth a human look.
 *
 *   npm run audit:seed
 */

import { seedVenues, snippetSupportsValue } from '../src/data/seed'
import { assessCapacity } from '../src/lib/capacity'
import { resolveNumericFact, trustOf } from '../src/lib/trust'
import type { VenueRecord } from '../src/lib/types'

interface Finding {
  severity: 'error' | 'warn'
  venue: string
  check: string
  detail: string
}

const findings: Finding[] = []
const add = (severity: Finding['severity'], venue: string, check: string, detail: string) =>
  findings.push({ severity, venue, check, detail })

const records = seedVenues()

for (const record of records) {
  const name = record.venue.name

  // ── 1. Geometry sanity ─────────────────────────────────────────────────────
  const { lat, lng } = record.venue
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    add('error', name, 'coordinates', `out of range: ${lat},${lng}`)
  }

  // ── 2. Standing capacity should meet or exceed seated ──────────────────────
  // Physically, removing chairs never reduces how many people fit. A violation
  // is a transcription swap, and it matters: reception searches read the
  // standing column, so a swapped pair silently shrinks the venue.
  // Real hotel charts DO occasionally publish a reception figure slightly below
  // the banquet figure (fire code with bars and buffet stations in the room),
  // so only a material gap is worth surfacing.
  for (const space of record.spaces) {
    if (space.seatedCap !== null && space.standingCap !== null && space.standingCap < space.seatedCap * 0.8) {
      add(
        'warn',
        name,
        'standing << seated',
        `"${space.name}" seats ${space.seatedCap} but lists only ${space.standingCap} standing`,
      )
    }
  }

  // ── 3. A composite row must not be smaller than its parts ──────────────────
  const groups = new Map<string, typeof record.spaces>()
  for (const space of record.spaces) {
    if (!space.combinableGroup) continue
    const list = groups.get(space.combinableGroup) ?? []
    list.push(space)
    groups.set(space.combinableGroup, list)
  }
  for (const [group, members] of groups) {
    const composites = members.filter((m) => m.isComposite)
    const atomics = members.filter((m) => !m.isComposite)
    if (composites.length === 0 || atomics.length === 0) continue

    const ceiling = Math.max(...composites.map((c) => c.standingCap ?? c.seatedCap ?? 0))
    const largestAtomic = Math.max(...atomics.map((a) => a.standingCap ?? a.seatedCap ?? 0))
    if (ceiling > 0 && largestAtomic > ceiling) {
      add(
        'error',
        name,
        'group ceiling',
        `group "${group}": an atomic room (${largestAtomic}) exceeds the published full-room capacity (${ceiling})`,
      )
    }
  }

  // ── 4. Buyout should be the venue's largest option ─────────────────────────
  const buyouts = record.spaces.filter((s) => s.isBuyout)
  const nonBuyouts = record.spaces.filter((s) => !s.isBuyout && !s.combinableGroup)
  if (buyouts.length > 0 && nonBuyouts.length > 0) {
    const bMax = Math.max(...buyouts.map((b) => b.standingCap ?? b.seatedCap ?? 0))
    const nMax = Math.max(...nonBuyouts.map((n) => n.standingCap ?? n.seatedCap ?? 0))
    if (bMax > 0 && nMax > bMax) {
      add('warn', name, 'buyout smaller than a room', `buyout ${bMax} < largest single space ${nMax}`)
    }
  }

  // ── 5. Every `explicit` claim must be quotable ─────────────────────────────
  // This is the guardrail that makes `verified` mean something. If the snippet
  // does not contain the number, the claim was inferred, and calling it
  // verified is exactly the false confidence this product exists to avoid.
  for (const e of record.evidence) {
    if (e.extractor !== 'explicit') continue
    if (!e.snippet) {
      add('error', name, 'explicit without snippet', `${e.field} = ${e.value}`)
      continue
    }
    if (!snippetSupportsValue(e.snippet, e.value)) {
      add('error', name, 'snippet does not support value', `${e.field} = ${e.value} · “${e.snippet.slice(0, 80)}”`)
    }
  }

  // ── 6. Source URL host should match its claimed class ──────────────────────
  const KNOWN_PARTNERS = /tripleseat|eventup|partyslate|peerspace|cvent|thebash|opentable\.com\/private/i
  const KNOWN_AGGREGATORS = /yelp|tripadvisor|opentable|resy|facebook|instagram|eater\.com|timeout/i
  for (const e of record.evidence) {
    if (!e.sourceUrl) {
      if (e.sourceClass !== 'heuristic') {
        add('warn', name, 'no source url', `${e.field} claimed as ${e.sourceClass}`)
      }
      continue
    }
    if (e.sourceClass === 'venue_domain' && KNOWN_AGGREGATORS.test(e.sourceUrl)) {
      add('error', name, 'misclassified source', `${e.sourceUrl} claimed as venue_domain but is an aggregator`)
    }
    if (e.sourceClass === 'venue_domain' && KNOWN_PARTNERS.test(e.sourceUrl)) {
      add('warn', name, 'misclassified source', `${e.sourceUrl} claimed as venue_domain but is a partner listing`)
    }
  }

  // ── 7. Evidence must agree with the denormalised column ────────────────────
  for (const space of record.spaces) {
    for (const [field, column] of [
      ['seated_cap', space.seatedCap],
      ['standing_cap', space.standingCap],
    ] as const) {
      const ev = record.evidence.filter((e) => e.spaceId === space.id && e.field === field)
      if (ev.length === 0 || column === null) continue
      const resolved = resolveNumericFact(ev)
      if (resolved.value !== null && Math.abs(resolved.value - column) / Math.max(column, 1) > 0.15) {
        add(
          'error',
          name,
          'column vs evidence drift',
          `"${space.name}" ${field}: column ${column}, top evidence ${resolved.value}`,
        )
      }
    }
  }

  // ── 8. Every space needs a distinct id ─────────────────────────────────────
  const ids = new Set<string>()
  for (const space of record.spaces) {
    if (ids.has(space.id)) add('error', name, 'duplicate space id', space.id)
    ids.add(space.id)
  }
}

// ── 9. The three required scenarios must return usable results ───────────────
// A dataset that passes every invariant and still fails the brief is not a
// passing dataset.
const SCENARIOS = [
  { label: 'Times Square 50 seated', lat: 40.758, lng: -73.9855, headcount: 50, style: 'seated' as const },
  { label: 'Salesforce Tower 30 seated', lat: 37.7897, lng: -122.3972, headcount: 30, style: 'seated' as const },
  { label: 'Waikiki 200 reception', lat: 21.2825, lng: -157.8375, headcount: 200, style: 'reception' as const },
]

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000
  const p1 = (a.lat * Math.PI) / 180
  const p2 = (b.lat * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((b.lng - a.lng) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

const scenarioReport: string[] = []
for (const s of SCENARIOS) {
  const near = records.filter((r) => haversine(s, { lat: r.venue.lat, lng: r.venue.lng }) <= 1700)
  const feasible = near.filter((r) => assessCapacity(r.spaces, r.evidence, s.headcount, s.style).best !== null)
  scenarioReport.push(`  ${s.label.padEnd(28)} ${String(feasible.length).padStart(2)} feasible of ${near.length} within 1.7 km`)
  if (feasible.length === 0) {
    add('error', s.label, 'scenario returns nothing', 'no venue in the corpus can host this group')
  }
}

// ── Provenance profile ───────────────────────────────────────────────────────

function profile(records: VenueRecord[]) {
  const capEv = records.flatMap((r) => r.evidence.filter((e) => e.field === 'seated_cap' || e.field === 'standing_cap'))
  const verified = capEv.filter((e) => trustOf(e.sourceClass, e.extractor) === 'verified').length
  const likely = capEv.filter((e) => trustOf(e.sourceClass, e.extractor) === 'likely').length
  const unverified = capEv.length - verified - likely
  const spaces = records.reduce((n, r) => n + r.spaces.length, 0)
  const withCap = records.reduce(
    (n, r) => n + r.spaces.filter((s) => s.seatedCap !== null || s.standingCap !== null).length,
    0,
  )
  const withSpend = records.reduce((n, r) => n + r.spaces.filter((s) => s.minSpendCents !== null).length, 0)
  return { capEv: capEv.length, verified, likely, unverified, spaces, withCap, withSpend }
}

const p = profile(records)

// ── Report ───────────────────────────────────────────────────────────────────

const errors = findings.filter((f) => f.severity === 'error')
const warns = findings.filter((f) => f.severity === 'warn')

console.log('\n╭─ Seed corpus audit ────────────────────────────────────────────────────╮')
console.log(`│ ${records.length} venues · ${p.spaces} spaces · ${p.capEv} capacity evidence rows`)
console.log(`│ ${p.withCap}/${p.spaces} spaces have a published capacity (${Math.round((p.withCap / p.spaces) * 100)}%)`)
console.log(`│ ${p.withSpend}/${p.spaces} spaces have a published minimum spend (${Math.round((p.withSpend / p.spaces) * 100)}%)`)
console.log('╰────────────────────────────────────────────────────────────────────────╯')

console.log('\nCapacity evidence by derived trust label')
console.log(`  verified    ${String(p.verified).padStart(4)}  (${Math.round((p.verified / p.capEv) * 100)}%)`)
console.log(`  likely      ${String(p.likely).padStart(4)}  (${Math.round((p.likely / p.capEv) * 100)}%)`)
console.log(`  unverified  ${String(p.unverified).padStart(4)}  (${Math.round((p.unverified / p.capEv) * 100)}%)`)

console.log('\nRequired scenarios')
scenarioReport.forEach((line) => console.log(line))

if (findings.length === 0) {
  console.log('\n✓ All invariants hold.\n')
} else {
  console.log(`\n${errors.length} error(s), ${warns.length} warning(s)\n`)
  for (const f of [...errors, ...warns]) {
    const tag = f.severity === 'error' ? 'ERROR' : ' warn'
    console.log(`  ${tag}  ${f.venue.slice(0, 34).padEnd(34)} ${f.check.padEnd(28)} ${f.detail}`)
  }
  console.log('')
}

process.exit(errors.length > 0 ? 1 : 0)
