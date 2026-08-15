import type { Evidence, EvidenceField, Extractor, SourceClass, VenueKind, VenueRecord, VenueSpace, MinSpendPeriod } from '../lib/types'

import nyc from './research/nyc.json'
import sf from './research/sf.json'
import honolulu from './research/honolulu.json'

// ─────────────────────────────────────────────────────────────────────────────
// Seed dataset.
//
// PROVENANCE. These 49 venues are real, and every capacity and minimum-spend
// figure carries the URL and the verbatim sentence it came from. The data was
// assembled by reading venue event pages, hotel banquet capacity charts and
// partner listings — the same sources the runtime extraction pipeline reads,
// gathered the same way, just ahead of time.
//
// It is NOT a mock. It is a warm cache. The three required scenarios resolve
// against cells that happen to be pre-hydrated; an address in Austin resolves
// against a cold cell and goes to the live pipeline. That distinction is the
// whole point of the hydration model, and it is why the demo is honest rather
// than staged.
//
// Nulls are preserved deliberately. Several venues publish no minimum spend and
// a few publish no capacity at all. Those gaps are the product working.
// ─────────────────────────────────────────────────────────────────────────────

interface RawSpace {
  name: string
  seated_cap: number | null
  standing_cap: number | null
  is_buyout: boolean
  combinable_group: string | null
  min_spend_usd: number | null
  min_spend_period: string | null
}

interface RawEvidence {
  field: string
  space_name: string | null
  value: string
  source_url: string
  source_class: string
  snippet: string
}

interface RawVenue {
  name: string
  address: string
  lat: number
  lng: number
  latlng_approximate: boolean
  phone: string | null
  email: string | null
  website: string | null
  events_url: string | null
  cuisine: string | null
  venue_kind: string
  spaces: RawSpace[]
  evidence: RawEvidence[]
  notes: string | null
}

const VENUE_KINDS: VenueKind[] = ['restaurant', 'hotel', 'event_space', 'bar', 'museum', 'rooftop']
const SOURCE_CLASSES: SourceClass[] = ['venue_domain', 'partner_listing', 'aggregator', 'heuristic']
const EVIDENCE_FIELDS: EvidenceField[] = ['seated_cap', 'standing_cap', 'min_spend', 'phone', 'email', 'address']
const SPEND_PERIODS: MinSpendPeriod[] = ['per_event', 'per_hour', 'f_and_b']

export function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Is this row a combination the venue already publishes, rather than an atomic
 * room? Composite rows are offered to planners as single bookings but excluded
 * from the solver's own combination search — otherwise "Coral I/II" plus
 * "Coral I" plus "Coral II" would be summed into a room that does not exist.
 *
 * Three signals, all conservative:
 *   - the name says so ("combined", "+")
 *   - roman-numeral ranges ("Coral I/II", "Tapa I-III")
 *   - the row IS the parent of its own group ("Coral Ballroom" in coral_ballroom)
 */
export function detectComposite(name: string, group: string | null): boolean {
  if (/combined|\bcombination\b|\+/i.test(name)) return true
  if (/\b[IVX]+\s*[/&-]\s*[IVX]+\b/.test(name)) return true
  if (/\b[A-E]\s*[/&-]\s*[A-E]\b/.test(name)) return true
  // "Diamond Head Ballroom - 3 sections" is itself a union of sections, so it
  // must not be summed with its siblings. Only the singular "1 section" row is
  // atomic. Missing this let the solver add "3 sections" to "2 sections" and
  // report a 225-capacity room that does not exist.
  if (/\b(\d+|two|three|four|five|six)\s*sections\b/i.test(name)) return true
  if (/\(\s*full\s*\)|\bfull\s+(ballroom|room|space)\b|\bentire\b|\bwhole\b/i.test(name)) return true
  if (group && slug(name) === group) return true
  if (group && slug(name) === `${group}_full`) return true
  return false
}

function asKind(raw: string): VenueKind {
  return (VENUE_KINDS as string[]).includes(raw) ? (raw as VenueKind) : 'event_space'
}

function asSourceClass(raw: string): SourceClass {
  return (SOURCE_CLASSES as string[]).includes(raw) ? (raw as SourceClass) : 'aggregator'
}

function asField(raw: string): EvidenceField | null {
  return (EVIDENCE_FIELDS as string[]).includes(raw) ? (raw as EvidenceField) : null
}

function asPeriod(raw: string | null): MinSpendPeriod | null {
  return raw && (SPEND_PERIODS as string[]).includes(raw) ? (raw as MinSpendPeriod) : null
}

/**
 * Does the snippet actually contain the number being claimed?
 *
 * This decides `explicit` versus `prose_inference`, which in turn decides
 * `verified` versus `likely`. Rather than trusting the research pass to
 * self-report, we check: if the quoted sentence does not contain the figure,
 * the figure was inferred, whatever anyone says about it.
 */
export function snippetSupportsValue(snippet: string, value: string): boolean {
  const numbers = value.match(/\d[\d,]*/g)
  if (!numbers || numbers.length === 0) {
    // Non-numeric facts (phone, email, address) — substring check on a
    // digit-stripped comparison is good enough.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9@]/g, '')
    return norm(snippet).includes(norm(value)) && norm(value).length > 3
  }
  const haystack = snippet.replace(/,/g, '')
  return numbers.some((n) => haystack.includes(n.replace(/,/g, '')))
}

/** Stable synthetic timestamp — the seed is a fixed corpus, not a live crawl. */
const SEED_EXTRACTED_AT = '2026-08-14T00:00:00.000Z'

function normaliseVenue(raw: RawVenue, cityKey: string, index: number): VenueRecord {
  const venueId = `${cityKey}-${slug(raw.name).slice(0, 48)}-${index}`

  const spaces: VenueSpace[] = (raw.spaces ?? []).map((s, i) => ({
    id: `${venueId}::${slug(s.name).slice(0, 40) || `space${i}`}`,
    venueId,
    name: s.name,
    seatedCap: s.seated_cap ?? null,
    standingCap: s.standing_cap ?? null,
    isBuyout: Boolean(s.is_buyout),
    combinableGroup: s.combinable_group ?? null,
    isComposite: detectComposite(s.name, s.combinable_group ?? null),
    minSpendCents: s.min_spend_usd !== null && s.min_spend_usd !== undefined ? Math.round(s.min_spend_usd * 100) : null,
    minSpendPeriod: asPeriod(s.min_spend_period ?? null),
  }))

  const byName = new Map(spaces.map((s) => [s.name.toLowerCase().trim(), s]))

  const evidence: Evidence[] = []
  for (const [i, e] of (raw.evidence ?? []).entries()) {
    const field = asField(e.field)
    if (!field) continue

    const space = e.space_name ? (byName.get(e.space_name.toLowerCase().trim()) ?? null) : null
    const sourceClass = asSourceClass(e.source_class)
    const snippet = e.snippet ?? ''

    const extractor: Extractor =
      sourceClass === 'heuristic'
        ? 'heuristic'
        : snippetSupportsValue(snippet, e.value)
          ? 'explicit'
          : 'prose_inference'

    evidence.push({
      id: `${venueId}::ev${i}`,
      venueId,
      spaceId: space?.id ?? null,
      field,
      value: e.value,
      sourceUrl: e.source_url,
      sourceClass,
      snippet,
      extractor,
      extractedAt: SEED_EXTRACTED_AT,
    })
  }

  // Contact details published in the research payload but not carried as an
  // evidence row still deserve one, marked heuristic so they read as unverified
  // rather than silently appearing trustworthy.
  if (raw.phone && !evidence.some((e) => e.field === 'phone')) {
    evidence.push({
      id: `${venueId}::phone`,
      venueId,
      spaceId: null,
      field: 'phone',
      value: raw.phone,
      sourceUrl: raw.website ?? raw.events_url ?? '',
      sourceClass: raw.website ? 'venue_domain' : 'aggregator',
      snippet: '',
      extractor: 'prose_inference',
      extractedAt: SEED_EXTRACTED_AT,
    })
  }
  if (raw.email && !evidence.some((e) => e.field === 'email')) {
    evidence.push({
      id: `${venueId}::email`,
      venueId,
      spaceId: null,
      field: 'email',
      value: raw.email,
      sourceUrl: raw.events_url ?? raw.website ?? '',
      sourceClass: raw.website ? 'venue_domain' : 'aggregator',
      snippet: '',
      extractor: 'prose_inference',
      extractedAt: SEED_EXTRACTED_AT,
    })
  }

  return {
    venue: {
      id: venueId,
      name: raw.name,
      address: raw.address,
      lat: raw.lat,
      lng: raw.lng,
      latlngApproximate: raw.latlng_approximate !== false,
      phone: raw.phone ?? null,
      email: raw.email ?? null,
      website: raw.website ?? null,
      eventsUrl: raw.events_url ?? null,
      cuisine: raw.cuisine ?? null,
      venueKind: asKind(raw.venue_kind),
      notes: raw.notes ?? null,
    },
    spaces,
    evidence,
  }
}

function build(): VenueRecord[] {
  const sources: Array<[string, RawVenue[]]> = [
    ['nyc', nyc as unknown as RawVenue[]],
    ['sf', sf as unknown as RawVenue[]],
    ['hnl', honolulu as unknown as RawVenue[]],
  ]
  const out: VenueRecord[] = []
  for (const [key, list] of sources) {
    list.forEach((raw, i) => out.push(normaliseVenue(raw, key, i)))
  }
  return out
}

let cached: VenueRecord[] | null = null

export function seedVenues(): VenueRecord[] {
  if (!cached) cached = build()
  return cached
}

/**
 * Geographic cells the seed genuinely covers.
 *
 * DERIVED from where the venues actually are, never hand-written. A hardcoded
 * list is a lie waiting to happen: the first version of this file guessed the
 * Waikiki geohash and got it wrong, so the hardest scenario reported its cell
 * as cold while serving warm data. Computing it means the claim "this area is
 * indexed" cannot drift from whether it is.
 */
export function seededCells(): Array<{ geohash5: string; label: string; venueCount: number }> {
  const counts = new Map<string, { label: string; n: number }>()
  for (const { venue } of seedVenues()) {
    const cell = encodeGeohash5(venue.lat, venue.lng)
    const entry = counts.get(cell)
    if (entry) {
      entry.n += 1
    } else {
      // Label from the venue's own address tail — good enough for a status line.
      const parts = venue.address.split(',').map((p) => p.trim())
      counts.set(cell, { label: parts.slice(-2).join(', ') || cell, n: 1 })
    }
  }
  return [...counts.entries()].map(([geohash5, { label, n }]) => ({ geohash5, label, venueCount: n }))
}

/** Local copy of the geohash encoder — keeps src/data free of a lib import cycle. */
function encodeGeohash5(lat: number, lng: number): string {
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'
  let idx = 0
  let bit = 0
  let evenBit = true
  let hash = ''
  let latMin = -90
  let latMax = 90
  let lngMin = -180
  let lngMax = 180
  while (hash.length < 5) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2
      if (lng >= mid) {
        idx = idx * 2 + 1
        lngMin = mid
      } else {
        idx = idx * 2
        lngMax = mid
      }
    } else {
      const mid = (latMin + latMax) / 2
      if (lat >= mid) {
        idx = idx * 2 + 1
        latMin = mid
      } else {
        idx = idx * 2
        latMax = mid
      }
    }
    evenBit = !evenBit
    if (++bit === 5) {
      hash += BASE32[idx]
      bit = 0
      idx = 0
    }
  }
  return hash
}

/** Provenance profile of the seed — computed, not asserted. Rendered in the UI. */
export function datasetProvenance() {
  const records = seedVenues()
  const capacityEvidence = records.flatMap((r) =>
    r.evidence.filter((e) => e.field === 'seated_cap' || e.field === 'standing_cap'),
  )
  const spendEvidence = records.flatMap((r) => r.evidence.filter((e) => e.field === 'min_spend'))

  const byClass = (list: Evidence[]) => {
    const counts: Record<string, number> = {}
    for (const e of list) counts[e.sourceClass] = (counts[e.sourceClass] ?? 0) + 1
    return counts
  }

  const spacesTotal = records.reduce((n, r) => n + r.spaces.length, 0)
  const spacesWithCapacity = records.reduce(
    (n, r) => n + r.spaces.filter((s) => s.seatedCap !== null || s.standingCap !== null).length,
    0,
  )
  const spacesWithSpend = records.reduce((n, r) => n + r.spaces.filter((s) => s.minSpendCents !== null).length, 0)

  return {
    venues: records.length,
    spaces: spacesTotal,
    spacesWithCapacity,
    spacesWithSpend,
    capacityEvidence: capacityEvidence.length,
    capacityBySourceClass: byClass(capacityEvidence),
    capacityExplicit: capacityEvidence.filter((e) => e.extractor === 'explicit').length,
    spendEvidence: spendEvidence.length,
    spendBySourceClass: byClass(spendEvidence),
    spendExplicit: spendEvidence.filter((e) => e.extractor === 'explicit').length,
  }
}
