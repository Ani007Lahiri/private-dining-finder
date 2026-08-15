import { commuteMatrix } from './adapters/routes'
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
