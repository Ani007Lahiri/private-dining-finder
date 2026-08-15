import type { LatLng } from '../geo'
import type { CommuteMode, CommuteResult, HydrationCell, SearchParams, VenueRecord } from '../types'

/**
 * Persistence boundary.
 *
 * Two implementations: Supabase/Postgres (the shipping target, with PostGIS
 * doing the stage-1 radius filter) and an in-memory store over the committed
 * seed corpus (so the app boots and demos with an empty environment). Every
 * caller above this line is written against the interface and does not know
 * or care which is live.
 */
export interface VenueRepo {
  readonly kind: 'supabase' | 'memory'

  /** Stage-1 spatial prefilter. Straight-line radius, deliberately over-selecting. */
  findVenuesWithin(center: LatLng, radiusMeters: number): Promise<VenueRecord[]>

  getVenue(id: string): Promise<VenueRecord | null>

  /** Upsert venues discovered and extracted by the hydration worker. */
  upsertVenues(records: VenueRecord[]): Promise<void>

  getCell(geohash5: string, mode: CommuteMode): Promise<HydrationCell | null>
  upsertCell(cell: HydrationCell): Promise<void>

  getCachedCommutes(
    originGeohash: string,
    venueIds: string[],
    mode: CommuteMode,
  ): Promise<Map<string, CommuteResult>>

  putCachedCommutes(
    originGeohash: string,
    mode: CommuteMode,
    entries: Array<{ venueId: string; result: CommuteResult }>,
  ): Promise<void>

  recordSearch(params: SearchParams, resultIds: string[]): Promise<void>
}
