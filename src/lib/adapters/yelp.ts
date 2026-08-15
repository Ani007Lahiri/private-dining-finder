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
// When the top two candidates are almost equally good, a "match" is a coin flip
// — exactly the failure that once tied a venue to a same-named hookah bar down
// the block. If neither distance nor name breaks the tie, we refuse to match and
// report no confident result rather than guess and mislabel it "likely".
const AMBIGUITY_DISTANCE_M = 40
const AMBIGUITY_SIMILARITY = 0.15
// 429 backoff: two short retries honouring Retry-After, then give up and report
// the venue as rate-limited (distinct from "no match") so the UI can say so.
const MAX_RETRIES = 2

/**
 * The outcome of trying to reach Yelp for one venue. Distinguishing these is the
 * whole point of the hardening: a rate-limited venue is a *temporary* gap the
 * planner can retry, while a no-match is a *stable* fact about that venue. They
 * must not both collapse to "no reputation".
 */
export type YelpStatus = 'matched' | 'no_match' | 'rate_limited' | 'unavailable' | 'disabled'

export type YelpMatch =
  | { status: 'matched'; enrichment: YelpEnrichment }
  | { status: 'no_match' | 'rate_limited' | 'unavailable' | 'disabled' }

type FetchOutcome =
  | { status: 'ok'; businesses: YelpBusiness[] }
  | { status: 'rate_limited' }
  | { status: 'unavailable' }
  | { status: 'disabled' }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function searchYelp(term: string, lat: number, lng: number): Promise<FetchOutcome> {
  const key = config.yelp.apiKey
  if (!key) return { status: 'disabled' }

  const url = `${YELP_SEARCH}?term=${encodeURIComponent(term)}&latitude=${lat}&longitude=${lng}&limit=5&sort_by=distance`

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } })
    } catch (err) {
      console.warn('[yelp] request failed:', (err as Error).message)
      return { status: 'unavailable' }
    }

    if (res.status === 429) {
      // Honour Retry-After when present, else exponential-ish backoff, but only
      // for a bounded number of attempts — a search must not hang on Yelp.
      if (attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 300 * (attempt + 1)
        await sleep(Math.min(waitMs, 1500))
        continue
      }
      console.warn(`[yelp] rate-limited (429) for "${term}" after ${MAX_RETRIES} retries`)
      return { status: 'rate_limited' }
    }

    if (!res.ok) {
      console.warn(`[yelp] ${res.status} for "${term}"`)
      return { status: 'unavailable' }
    }

    const json = (await res.json()) as YelpSearchResponse
    return { status: 'ok', businesses: (json.businesses ?? []).filter((b) => !b.is_closed) }
  }
  // Unreachable, but keeps the type total.
  return { status: 'rate_limited' }
}

/**
 * Find the Yelp business that corresponds to a seed venue. Returns a tagged
 * outcome rather than a bare null so the caller can tell a temporary
 * rate-limit / outage apart from a genuine no-match.
 */
export async function enrichWithYelp(venue: {
  name: string
  lat: number
  lng: number
}): Promise<YelpMatch> {
  if (!config.yelp.enabled) return { status: 'disabled' }

  const outcome = await searchYelp(venue.name, venue.lat, venue.lng)
  if (outcome.status !== 'ok') return { status: outcome.status }
  if (outcome.businesses.length === 0) return { status: 'no_match' }

  const origin = { lat: venue.lat, lng: venue.lng }
  const scored: Array<{ biz: YelpBusiness; dist: number; sim: number }> = []

  for (const biz of outcome.businesses) {
    if (!biz.coordinates) continue
    const dist = haversineMeters(origin, {
      lat: biz.coordinates.latitude,
      lng: biz.coordinates.longitude,
    })
    const sim = nameSimilarity(venue.name, biz.name)
    const accept = dist <= MAX_MATCH_DISTANCE_M || (sim >= MIN_NAME_SIMILARITY && dist <= NAME_MATCH_DISTANCE_M)
    if (accept) scored.push({ biz, dist, sim })
  }

  if (scored.length === 0) return { status: 'no_match' }

  // Rank confident candidates: closest first, name similarity as the tiebreak.
  scored.sort((a, b) => (Math.abs(a.dist - b.dist) <= 1 ? b.sim - a.sim : a.dist - b.dist))
  const best = scored[0]
  const runnerUp = scored[1]

  // Ambiguity guard: if a second candidate is essentially as close AND as
  // name-similar, we cannot honestly say which is the venue. Refuse rather than
  // attach a coin-flip reputation to the wrong business.
  if (runnerUp) {
    const distClose = Math.abs(best.dist - runnerUp.dist) <= AMBIGUITY_DISTANCE_M
    const simClose = Math.abs(best.sim - runnerUp.sim) <= AMBIGUITY_SIMILARITY
    if (distClose && simClose) {
      console.warn(`[yelp] ambiguous match for "${venue.name}" — two near-tied candidates, refusing`)
      return { status: 'no_match' }
    }
  }

  const priceLabel = best.biz.price ?? null
  return {
    status: 'matched',
    enrichment: {
      yelpId: best.biz.id,
      rating: best.biz.rating ?? 0,
      reviewCount: best.biz.review_count ?? 0,
      priceTier: priceLabel ? priceLabel.length : null,
      priceLabel,
      categories: (best.biz.categories ?? []).map((c) => c.title),
      url: best.biz.url ?? '',
      matchDistanceMeters: Math.round(best.dist),
    },
  }
}

/**
 * Enrich many venues, with a small concurrency cap so a search that survived the
 * commute filter with twenty candidates does not open twenty sockets at once.
 * Returns a per-venue outcome for every venue attempted — matched OR not — so
 * the caller can surface "rate-limited" distinctly from "no confident match".
 */
export async function enrichVenuesWithYelp(
  venues: Array<{ id: string; name: string; lat: number; lng: number }>,
  concurrency = 5,
): Promise<Map<string, YelpMatch>> {
  const out = new Map<string, YelpMatch>()
  if (!config.yelp.enabled || venues.length === 0) return out

  let cursor = 0
  async function worker() {
    while (cursor < venues.length) {
      const v = venues[cursor++]
      try {
        out.set(v.id, await enrichWithYelp(v))
      } catch {
        // A single venue's enrichment failing must never fail the batch.
        out.set(v.id, { status: 'unavailable' })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, venues.length) }, worker))
  return out
}
