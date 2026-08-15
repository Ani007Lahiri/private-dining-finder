import { discoverVenues, type DiscoveredPlace } from './adapters/places'
import { classifySource, extractFromPage, fetchPage, htmlToText } from './adapters/extraction'
import { config } from './config'
import { encodeGeohash, prefilterRadiusMeters, type LatLng } from './geo'
import { getRepo } from './repo'
import { slug } from '../data/seed'
import type { Evidence, HydrationCell, SearchParams, VenueRecord, VenueSpace } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Hydration.
//
// The reframe that fixed the first architecture: the unit of work is a
// GEOGRAPHIC CELL, not a venue.
//
// A search resolves its origin to a geohash cell, checks whether that cell has
// been hydrated inside the TTL, and responds immediately from whatever Postgres
// already holds — even if that is nothing. Enrichment runs behind the response
// and streams results in as they land.
//
// This is what makes arbitrary addresses work. The alternative — offline batch
// ingestion — demos beautifully for three pre-chosen cities and returns an
// empty list the moment a planner types an address in Austin, which looks
// broken rather than cold.
// ─────────────────────────────────────────────────────────────────────────────

/** Precision 5 ≈ 4.9 km × 4.9 km. About the size of a downtown core. */
const CELL_PRECISION = 5

export function cellFor(origin: LatLng): string {
  return encodeGeohash(origin.lat, origin.lng, CELL_PRECISION)
}

/** In-process guard so two concurrent searches in one cell do not both enrich. */
const inFlight = new Map<string, Promise<HydrationOutcome>>()

export interface HydrationOutcome {
  cell: HydrationCell
  added: VenueRecord[]
}

function isFresh(cell: HydrationCell | null): boolean {
  if (!cell) return false
  if (cell.status !== 'warm') return false
  if (!cell.expiresAt) return true
  return Date.parse(cell.expiresAt) > Date.now()
}

export async function cellStatus(origin: LatLng, params: SearchParams): Promise<HydrationCell> {
  const repo = getRepo()
  const geohash5 = cellFor(origin)
  const existing = await repo.getCell(geohash5, params.mode)

  if (isFresh(existing)) return existing!

  if (!config.google.placesEnabled) {
    return {
      geohash5,
      mode: params.mode,
      status: 'unavailable',
      venueCount: existing?.venueCount ?? 0,
      hydratedAt: existing?.hydratedAt ?? null,
      expiresAt: null,
      note: 'Live enrichment is off (no GOOGLE_MAPS_API_KEY). Showing whatever this area already has.',
    }
  }

  return {
    geohash5,
    mode: params.mode,
    status: existing ? 'stale' : 'cold',
    venueCount: existing?.venueCount ?? 0,
    hydratedAt: existing?.hydratedAt ?? null,
    expiresAt: existing?.expiresAt ?? null,
    note: null,
  }
}

/**
 * Enrich a cell: discover venues, fetch their event pages, extract capacity and
 * spend, write venues + spaces + evidence.
 *
 * Extraction is capped by HYDRATION_MAX_EXTRACTIONS. When the cap bites, the
 * fact is logged and reported rather than silently truncating — a search that
 * quietly covered 15 of 60 candidates while looking complete is worse than one
 * that says so.
 */
export async function hydrateCell(origin: LatLng, params: SearchParams): Promise<HydrationOutcome> {
  const geohash5 = cellFor(origin)
  const key = `${geohash5}:${params.mode}:${params.headcount}:${params.eventStyle}`

  const existing = inFlight.get(key)
  if (existing) return existing

  const job = runHydration(origin, params, geohash5).finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, job)
  return job
}

async function runHydration(origin: LatLng, params: SearchParams, geohash5: string): Promise<HydrationOutcome> {
  const repo = getRepo()

  const hydrating: HydrationCell = {
    geohash5,
    mode: params.mode,
    status: 'hydrating',
    venueCount: 0,
    hydratedAt: null,
    expiresAt: null,
    note: null,
  }
  await repo.upsertCell(hydrating)

  if (!config.google.placesEnabled) {
    const cell: HydrationCell = {
      ...hydrating,
      status: 'unavailable',
      note: 'Live enrichment is off (no GOOGLE_MAPS_API_KEY).',
    }
    await repo.upsertCell(cell)
    return { cell, added: [] }
  }

  const radius = prefilterRadiusMeters(params.mode, params.maxCommuteMinutes)
  const locality = params.address || `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}`

  let discovered: DiscoveredPlace[] = []
  try {
    discovered = await discoverVenues(origin, radius, params.headcount, params.eventStyle, locality)
  } catch (err) {
    const cell: HydrationCell = {
      ...hydrating,
      status: 'unavailable',
      note: `Discovery failed: ${(err as Error).message}`,
    }
    await repo.upsertCell(cell)
    return { cell, added: [] }
  }

  // Skip anything we already hold, so re-hydration is incremental.
  const known = await repo.findVenuesWithin(origin, radius)
  const knownKeys = new Set(known.map((k) => normaliseKey(k.venue.name, k.venue.address)))
  const fresh = discovered.filter((d) => !knownKeys.has(normaliseKey(d.name, d.address)))

  const budget = Math.max(0, config.hydration.maxExtractions)
  const toExtract = fresh.slice(0, budget)
  const skipped = fresh.length - toExtract.length

  const records = await Promise.all(toExtract.map((place) => buildRecord(place)))
  const added = records.filter((r): r is VenueRecord => r !== null)

  if (added.length > 0) {
    try {
      await repo.upsertVenues(added)
    } catch (err) {
      console.warn('[hydration] upsert failed:', (err as Error).message)
    }
  }

  const now = new Date()
  const cell: HydrationCell = {
    geohash5,
    mode: params.mode,
    status: 'warm',
    venueCount: known.length + added.length,
    hydratedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + config.hydration.ttlHours * 3600_000).toISOString(),
    note:
      skipped > 0
        ? `Extraction capped at ${budget} venues this pass; ${skipped} discovered venues not yet enriched.`
        : null,
  }
  await repo.upsertCell(cell)

  return { cell, added }
}

function normaliseKey(name: string, address: string): string {
  return `${slug(name)}|${slug(address).slice(0, 24)}`
}

/**
 * Turn a discovered place into a full record by reading its event page.
 *
 * A venue whose page cannot be fetched, or yields nothing, is STILL returned —
 * with zero spaces and no capacity evidence, so it surfaces as "capacity
 * unknown, call to confirm". Dropping it would hide a real venue; inventing a
 * capacity for it would poison the trust label. Neither is acceptable.
 */
async function buildRecord(place: DiscoveredPlace): Promise<VenueRecord | null> {
  const venueId = `live-${place.placeId}`
  const spaces: VenueSpace[] = []
  const evidence: Evidence[] = []
  const now = new Date().toISOString()

  let eventsUrl: string | null = null
  let email: string | null = null
  let phone: string | null = place.phone

  if (place.website && config.llm.enabled) {
    eventsUrl = await findEventsUrl(place.website)
    const target = eventsUrl ?? place.website
    const html = await fetchPage(target)

    if (html) {
      const extracted = await extractFromPage(htmlToText(html), place.name, target)
      const sourceClass = classifySource(target, place.website)

      extracted.spaces.forEach((s, i) => {
        const spaceId = `${venueId}::${slug(s.name).slice(0, 40) || `space${i}`}`
        spaces.push({
          id: spaceId,
          venueId,
          name: s.name,
          seatedCap: s.seated_cap,
          standingCap: s.standing_cap,
          isBuyout: s.is_buyout,
          combinableGroup: s.combinable_group,
          isComposite: /combined|\+/i.test(s.name),
          minSpendCents: s.min_spend_usd !== null ? Math.round(s.min_spend_usd * 100) : null,
          minSpendPeriod: s.min_spend_period,
        })

        const push = (field: Evidence['field'], value: number | null) => {
          if (value === null || !s.snippet) return
          evidence.push({
            id: `${spaceId}::${field}`,
            venueId,
            spaceId,
            field,
            value: String(value),
            sourceUrl: target,
            sourceClass,
            snippet: s.snippet,
            extractor: s.extractor,
            extractedAt: now,
          })
        }
        push('seated_cap', s.seated_cap)
        push('standing_cap', s.standing_cap)
        push('min_spend', s.min_spend_usd)
      })

      email = extracted.email
      phone = extracted.phone ?? phone
    }
  }

  if (phone) {
    evidence.push({
      id: `${venueId}::phone`,
      venueId,
      spaceId: null,
      field: 'phone',
      value: phone,
      sourceUrl: place.website ?? '',
      sourceClass: place.phone === phone ? 'aggregator' : 'venue_domain',
      snippet: '',
      extractor: 'prose_inference',
      extractedAt: now,
    })
  }
  if (email) {
    evidence.push({
      id: `${venueId}::email`,
      venueId,
      spaceId: null,
      field: 'email',
      value: email,
      sourceUrl: eventsUrl ?? place.website ?? '',
      sourceClass: 'venue_domain',
      snippet: '',
      extractor: 'prose_inference',
      extractedAt: now,
    })
  }

  return {
    venue: {
      id: venueId,
      name: place.name,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      latlngApproximate: false,
      phone,
      email,
      website: place.website,
      eventsUrl,
      cuisine: null,
      venueKind: place.venueKind,
      notes: spaces.length === 0 ? 'No private-event details found on this venue’s site.' : null,
    },
    spaces,
    evidence,
  }
}

const EVENT_PATH_HINTS = [
  'private-dining',
  'private-events',
  'privatedining',
  'events',
  'groups',
  'banquet',
  'meetings',
  'parties',
  'celebrations',
  'buyout',
]

/**
 * Find the venue's events page from its homepage. Cheap heuristic link scan —
 * the alternative, an LLM call per site just to pick a URL, is not worth the
 * latency when a regex over anchor hrefs gets it right most of the time.
 */
async function findEventsUrl(website: string): Promise<string | null> {
  const html = await fetchPage(website, 8000)
  if (!html) return null

  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
  for (const hint of EVENT_PATH_HINTS) {
    const hit = hrefs.find((h) => h.toLowerCase().includes(hint))
    if (hit) {
      try {
        return new URL(hit, website).toString()
      } catch {
        continue
      }
    }
  }
  return null
}
