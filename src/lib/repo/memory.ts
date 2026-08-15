import { haversineMeters, type LatLng } from '../geo'
import { seedVenues, seededCells } from '../../data/seed'
import { config } from '../config'
import type { CommuteMode, CommuteResult, HydrationCell, SearchParams, VenueRecord } from '../types'
import type { VenueRepo } from './types'

/**
 * In-memory repository over the committed seed corpus.
 *
 * This exists so `npm install && npm run dev` produces a working product with
 * an empty .env. It is not a stub: it implements the same spatial prefilter,
 * the same commute cache and the same cell semantics as the Postgres version,
 * just with a linear scan instead of a GiST index. At 49 venues that is faster
 * than a network round trip anyway.
 */
export class MemoryRepo implements VenueRepo {
  readonly kind = 'memory' as const

  private venues = new Map<string, VenueRecord>()
  private cells = new Map<string, HydrationCell>()
  private commutes = new Map<string, CommuteResult>()
  private searches: Array<{ params: SearchParams; resultIds: string[]; at: string }> = []

  constructor() {
    for (const record of seedVenues()) {
      this.venues.set(record.venue.id, record)
    }
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + config.hydration.ttlHours * 3600_000).toISOString()
    for (const cell of seededCells()) {
      for (const mode of ['walking', 'driving'] as CommuteMode[]) {
        this.cells.set(`${cell.geohash5}:${mode}`, {
          geohash5: cell.geohash5,
          mode,
          status: 'warm',
          venueCount: cell.venueCount,
          hydratedAt: now,
          expiresAt: expires,
          note: `${cell.venueCount} venues already indexed near ${cell.label}`,
        })
      }
    }
  }

  async findVenuesWithin(center: LatLng, radiusMeters: number): Promise<VenueRecord[]> {
    const out: VenueRecord[] = []
    for (const record of this.venues.values()) {
      const d = haversineMeters(center, { lat: record.venue.lat, lng: record.venue.lng })
      if (d <= radiusMeters) out.push(record)
    }
    return out
  }

  async getVenue(id: string): Promise<VenueRecord | null> {
    return this.venues.get(id) ?? null
  }

  async upsertVenues(records: VenueRecord[]): Promise<void> {
    for (const r of records) this.venues.set(r.venue.id, r)
  }

  async getCell(geohash5: string, mode: CommuteMode): Promise<HydrationCell | null> {
    return this.cells.get(`${geohash5}:${mode}`) ?? null
  }

  async upsertCell(cell: HydrationCell): Promise<void> {
    this.cells.set(`${cell.geohash5}:${cell.mode}`, cell)
  }

  async getCachedCommutes(
    originGeohash: string,
    venueIds: string[],
    mode: CommuteMode,
  ): Promise<Map<string, CommuteResult>> {
    const out = new Map<string, CommuteResult>()
    for (const id of venueIds) {
      const hit = this.commutes.get(`${originGeohash}:${mode}:${id}`)
      if (hit) out.set(id, hit)
    }
    return out
  }

  async putCachedCommutes(
    originGeohash: string,
    mode: CommuteMode,
    entries: Array<{ venueId: string; result: CommuteResult }>,
  ): Promise<void> {
    for (const { venueId, result } of entries) {
      this.commutes.set(`${originGeohash}:${mode}:${venueId}`, result)
    }
  }

  async recordSearch(params: SearchParams, resultIds: string[]): Promise<void> {
    this.searches.push({ params, resultIds, at: new Date().toISOString() })
    if (this.searches.length > 200) this.searches.shift()
  }
}
