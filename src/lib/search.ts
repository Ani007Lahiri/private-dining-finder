import { commuteMatrix } from './adapters/routes'
import { enrichVenuesWithYelp } from './adapters/yelp'
import { config } from './config'
import { encodeGeohash, prefilterRadiusMeters, type LatLng } from './geo'
import { getRepo } from './repo'
import { rankVenue, sortResults, type SortMode } from './ranking'
import type { RankedResult, SearchParams, VenueRecord } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Search orchestration.
//
// Hard filters first, then score. In order:
//   1. Straight-line radius prefilter (cheap, over-selects on purpose)
//   2. Commute resolution, cache-first, batched
//   3. Commute hard filter against the planner's stated maximum
//   4. Capacity feasibility + ranking
//   5. Trust filters, which the planner controls and we never apply silently
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchOutcome {
  results: RankedResult[]
  /** Everything that survived the radius but failed a hard filter, with the reason. */
  rejected: Array<{ venueId: string; name: string; reason: string }>
  stats: {
    prefiltered: number
    withinCommute: number
    ranked: number
    commuteCacheHits: number
    commuteMeasured: number
    elapsedMs: number
  }
}

export async function runSearch(params: SearchParams, sort: SortMode = 'fit'): Promise<SearchOutcome> {
  const started = Date.now()
  const repo = getRepo()
  const origin: LatLng = { lat: params.lat, lng: params.lng }

  // ── 1. Spatial prefilter ───────────────────────────────────────────────────
  const radius = prefilterRadiusMeters(params.mode, params.maxCommuteMinutes)
  const candidates = await repo.findVenuesWithin(origin, radius)

  const rejected: SearchOutcome['rejected'] = []
  if (candidates.length === 0) {
    return {
      results: [],
      rejected,
      stats: {
        prefiltered: 0,
        withinCommute: 0,
        ranked: 0,
        commuteCacheHits: 0,
        commuteMeasured: 0,
        elapsedMs: Date.now() - started,
      },
    }
  }

  // ── 2. Commute, cache-first ────────────────────────────────────────────────
  const originGeohash = encodeGeohash(params.lat, params.lng, config.commute.geohashPrecision)
  const ids = candidates.map((c) => c.venue.id)
  const cached = await repo.getCachedCommutes(originGeohash, ids, params.mode)

  const misses = candidates.filter((c) => !cached.has(c.venue.id))
  if (misses.length > 0) {
    const computed = await commuteMatrix(
      origin,
      misses.map((m) => ({ lat: m.venue.lat, lng: m.venue.lng })),
      params.mode,
    )
    const entries = misses.map((m, i) => ({ venueId: m.venue.id, result: computed[i] }))
    for (const { venueId, result } of entries) cached.set(venueId, result)
    // Fire-and-forget: a cache write failing must not fail the search.
    void repo.putCachedCommutes(originGeohash, params.mode, entries).catch((err) => {
      console.warn('[search] commute cache write failed:', (err as Error).message)
    })
  }

  // ── 3. Commute hard filter ─────────────────────────────────────────────────
  const maxSeconds = params.maxCommuteMinutes * 60
  const withinCommute: VenueRecord[] = []
  for (const record of candidates) {
    const commute = cached.get(record.venue.id)
    if (!commute) continue
    if (commute.durationSeconds > maxSeconds) {
      rejected.push({
        venueId: record.venue.id,
        name: record.venue.name,
        reason: `${Math.round(commute.durationSeconds / 60)} min ${params.mode} — over the ${params.maxCommuteMinutes} min limit`,
      })
      continue
    }
    withinCommute.push(record)
  }

  // ── 4. Capacity feasibility + scoring ──────────────────────────────────────
  let ranked = withinCommute.map((record) => rankVenue(record, cached.get(record.venue.id) ?? null, params))

  const infeasible = ranked.filter((r) => !r.capacity.best && !r.capacity.unknown)
  for (const r of infeasible) {
    rejected.push({
      venueId: r.record.venue.id,
      name: r.record.venue.name,
      reason: r.capacity.shortfallReason ?? 'No configuration fits this group',
    })
  }
  ranked = ranked.filter((r) => r.capacity.best || r.capacity.unknown)

  // ── 5. Planner-controlled trust filters ────────────────────────────────────
  // Applied last and only on request. Unknown-capacity venues are included by
  // default: "call to confirm" is a useful answer, silent omission is not.
  if (!params.includeUnknownCapacity) {
    const dropped = ranked.filter((r) => r.capacity.unknown)
    for (const r of dropped) {
      rejected.push({
        venueId: r.record.venue.id,
        name: r.record.venue.name,
        reason: 'No published capacity (hidden by your filter)',
      })
    }
    ranked = ranked.filter((r) => !r.capacity.unknown)
  }

  if (params.verifiedCapacityOnly) {
    const dropped = ranked.filter((r) => r.capacity.best?.trust !== 'verified')
    for (const r of dropped) {
      rejected.push({
        venueId: r.record.venue.id,
        name: r.record.venue.name,
        reason: 'Capacity not verified (hidden by your filter)',
      })
    }
    ranked = ranked.filter((r) => r.capacity.best?.trust === 'verified')
  }

  // ── 6. Reputation enrichment (Yelp) ────────────────────────────────────────
  // Optional and best-effort. Attaches a third-party rating + price tier to each
  // survivor so the planner can weigh reputation, and so the `reputation` sort
  // has something to sort by. Enriched BEFORE the sort for that reason. A no-op
  // and cost-free when YELP_API_KEY is unset; failures degrade to no reputation
  // rather than failing the search.
  await attachYelp(ranked)

  const sorted = sortResults(ranked, sort)

  void repo.recordSearch(params, sorted.map((r) => r.record.venue.id)).catch(() => {})

  return {
    results: sorted,
    rejected,
    stats: {
      prefiltered: candidates.length,
      withinCommute: withinCommute.length,
      ranked: sorted.length,
      commuteCacheHits: candidates.length - misses.length,
      commuteMeasured: [...cached.values()].filter((c) => c.method === 'measured').length,
      elapsedMs: Date.now() - started,
    },
  }
}

/**
 * Attach Yelp reputation to a set of ranked results, in place. Best-effort: when
 * the adapter is disabled or a venue has no confident match, the result's `yelp`
 * field simply stays null. Batched with a concurrency cap inside the adapter.
 */
async function attachYelp(results: RankedResult[]): Promise<void> {
  if (!config.yelp.enabled || results.length === 0) return
  try {
    const byId = await enrichVenuesWithYelp(
      results.map((r) => ({
        id: r.record.venue.id,
        name: r.record.venue.name,
        lat: r.record.venue.lat,
        lng: r.record.venue.lng,
      })),
    )
    for (const r of results) {
      const e = byId.get(r.record.venue.id)
      if (e) {
        r.yelp = {
          rating: e.rating,
          reviewCount: e.reviewCount,
          priceTier: e.priceTier,
          priceLabel: e.priceLabel,
          url: e.url,
          matchDistanceMeters: e.matchDistanceMeters,
        }
      }
    }
  } catch (err) {
    console.warn('[search] Yelp enrichment failed, continuing without it:', (err as Error).message)
  }
}
