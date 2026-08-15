import { config } from '../config'

// ─────────────────────────────────────────────────────────────────────────────
// Yelp enrichment.
//
// Yelp is an AGGREGATOR in this app's provenance model: it never sees the inside
// of a venue's private-dining page, so it cannot tell us a room capacity or a
// minimum spend. What it does carry is reputation — a star rating and a review
// count — and a coarse price tier ($–$$$$). Both are surfaced with a `likely`
// trust label, because that is exactly what an aggregator figure is worth: a
// real signal from a third party, not something the venue published about
// itself.
//
// The adapter is optional in the same way every other external is. With no
// YELP_API_KEY it is a no-op and the app behaves exactly as before; /api/health
// reports `yelp: off`. It never throws into the search path — a Yelp outage
// degrades the reputation signal, it does not fail a search.
// ─────────────────────────────────────────────────────────────────────────────

export interface YelpEnrichment {
  /** Yelp's business id, for debugging and de-duplication. */
  yelpId: string
  /** 0–5 stars, in half-star increments. */
  rating: number
  reviewCount: number
  /** 1–4, derived from the number of '$' Yelp returns. Null when Yelp omits price. */
  priceTier: number | null
  /** The raw '$'..'$$$$' string, for display. */
  priceLabel: string | null
  categories: string[]
  /** Deep link to the Yelp listing — the source a planner can click through to. */
  url: string
  /** Metres between the seed venue's coordinates and Yelp's, at match time. */
  matchDistanceMeters: number
}

interface YelpBusiness {
  id: string
  name: string
  rating?: number
  review_count?: number
  price?: string
  categories?: Array<{ alias: string; title: string }>
  coordinates?: { latitude: number; longitude: number }
  location?: { address1?: string; city?: string; zip_code?: string }
  url?: string
  is_closed?: boolean
}

interface YelpSearchResponse {
  businesses?: YelpBusiness[]
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Normalise a venue name for comparison: lowercase, drop punctuation and common suffixes. */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|restaurant|tavern|grill|bar|kitchen|sf|nyc|san francisco|new york|honolulu|waikiki)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Token-overlap similarity in [0,1]. Cheap and good enough to disambiguate hits. */
function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normaliseName(a).split(' ').filter(Boolean))
  const tb = new Set(normaliseName(b).split(' ').filter(Boolean))
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / Math.max(ta.size, tb.size)
}

const YELP_SEARCH = 'https://api.yelp.com/v3/businesses/search'

// A candidate is accepted when it is either physically the same place
// (coordinates within ~120 m) or an unambiguous name match nearby. Both guards
// exist because a bare name search near a dense downtown will surface a
// same-named chain outlet a mile away, and a pure-distance match will grab the
// wrong restaurant in the same building.
const MAX_MATCH_DISTANCE_M = 120
const MIN_NAME_SIMILARITY = 0.5
const NAME_MATCH_DISTANCE_M = 400

async function searchYelp(term: string, lat: number, lng: number): Promise<YelpBusiness[]> {
  const key = config.yelp.apiKey
  if (!key) return []

  const url = `${YELP_SEARCH}?term=${encodeURIComponent(term)}&latitude=${lat}&longitude=${lng}&limit=5&sort_by=distance`
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } })
  } catch (err) {
    console.warn('[yelp] request failed:', (err as Error).message)
    return []
  }
  if (!res.ok) {
    console.warn(`[yelp] ${res.status} for "${term}"`)
    return []
  }
  const json = (await res.json()) as YelpSearchResponse
  return (json.businesses ?? []).filter((b) => !b.is_closed)
}

/**
 * Find the Yelp business that corresponds to a seed venue, and return its
 * reputation and price signal. Returns null when Yelp is disabled, unreachable,
 * or has no confident match — the caller treats a null exactly like an absent
 * key, so there is one code path for "no Yelp signal".
 */
export async function enrichWithYelp(venue: {
  name: string
  lat: number
  lng: number
}): Promise<YelpEnrichment | null> {
  if (!config.yelp.enabled) return null

  const businesses = await searchYelp(venue.name, venue.lat, venue.lng)
  if (businesses.length === 0) return null

  const origin = { lat: venue.lat, lng: venue.lng }
  let best: { biz: YelpBusiness; dist: number; sim: number } | null = null

  for (const biz of businesses) {
    if (!biz.coordinates) continue
    const dist = haversineMeters(origin, {
      lat: biz.coordinates.latitude,
      lng: biz.coordinates.longitude,
    })
    const sim = nameSimilarity(venue.name, biz.name)
    const accept = dist <= MAX_MATCH_DISTANCE_M || (sim >= MIN_NAME_SIMILARITY && dist <= NAME_MATCH_DISTANCE_M)
    if (!accept) continue
    // Prefer the closest confident match; break ties on name similarity.
    if (!best || dist < best.dist - 1 || (Math.abs(dist - best.dist) <= 1 && sim > best.sim)) {
      best = { biz, dist, sim }
    }
  }

  if (!best) return null

  const priceLabel = best.biz.price ?? null
  return {
    yelpId: best.biz.id,
    rating: best.biz.rating ?? 0,
    reviewCount: best.biz.review_count ?? 0,
    priceTier: priceLabel ? priceLabel.length : null,
    priceLabel,
    categories: (best.biz.categories ?? []).map((c) => c.title),
    url: best.biz.url ?? '',
    matchDistanceMeters: Math.round(best.dist),
  }
}

/**
 * Enrich many venues, with a small concurrency cap so a search that survived the
 * commute filter with twenty candidates does not open twenty sockets at once.
 * Yelp's trial rate limits are modest; this keeps us well inside them.
 */
export async function enrichVenuesWithYelp(
  venues: Array<{ id: string; name: string; lat: number; lng: number }>,
  concurrency = 5,
): Promise<Map<string, YelpEnrichment>> {
  const out = new Map<string, YelpEnrichment>()
  if (!config.yelp.enabled || venues.length === 0) return out

  let cursor = 0
  async function worker() {
    while (cursor < venues.length) {
      const v = venues[cursor++]
      try {
        const enrichment = await enrichWithYelp(v)
        if (enrichment) out.set(v.id, enrichment)
      } catch {
        // A single venue's enrichment failing must never fail the batch.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, venues.length) }, worker))
  return out
}
