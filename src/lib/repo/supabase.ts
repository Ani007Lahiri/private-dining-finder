import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from '../config'
import type { LatLng } from '../geo'
import type {
  CommuteMode,
  CommuteResult,
  Evidence,
  HydrationCell,
  SearchParams,
  VenueRecord,
  VenueSpace,
} from '../types'
import type { VenueRepo } from './types'

/**
 * Postgres-backed repository.
 *
 * The stage-1 radius filter runs in the database via a `venues_within` RPC
 * wrapping `ST_DWithin` on a GEOGRAPHY column with a GiST index — see
 * supabase/migrations/0001_init.sql. Doing it in SQL rather than pulling every
 * venue into Node is the difference between this scaling past a few thousand
 * rows and not.
 */
export class SupabaseRepo implements VenueRepo {
  readonly kind = 'supabase' as const
  private client: SupabaseClient

  constructor() {
    if (!config.supabase.url) throw new Error('Supabase URL missing')
    // Prefer the service-role key on the server so the hydration worker can
    // write. Falls back to anon for read-only deployments.
    const key = config.supabase.serviceRoleKey ?? config.supabase.anonKey
    if (!key) throw new Error('Supabase key missing')
    this.client = createClient(config.supabase.url, key, {
      auth: { persistSession: false },
    })
  }

  private async hydrateRecords(venueRows: DbVenue[]): Promise<VenueRecord[]> {
    if (venueRows.length === 0) return []
    const ids = venueRows.map((v) => v.id)

    const [{ data: spaceRows }, { data: evidenceRows }] = await Promise.all([
      this.client.from('venue_spaces').select('*').in('venue_id', ids),
      this.client.from('evidence').select('*').in('venue_id', ids),
    ])

    const spacesByVenue = new Map<string, VenueSpace[]>()
    for (const row of (spaceRows ?? []) as DbSpace[]) {
      const list = spacesByVenue.get(row.venue_id) ?? []
      list.push(mapSpace(row))
      spacesByVenue.set(row.venue_id, list)
    }

    const evidenceByVenue = new Map<string, Evidence[]>()
    for (const row of (evidenceRows ?? []) as DbEvidence[]) {
      const list = evidenceByVenue.get(row.venue_id) ?? []
      list.push(mapEvidence(row))
      evidenceByVenue.set(row.venue_id, list)
    }

    return venueRows.map((v) => ({
      venue: mapVenue(v),
      spaces: spacesByVenue.get(v.id) ?? [],
      evidence: evidenceByVenue.get(v.id) ?? [],
    }))
  }

  async findVenuesWithin(center: LatLng, radiusMeters: number): Promise<VenueRecord[]> {
    const { data, error } = await this.client.rpc('venues_within', {
      origin_lat: center.lat,
      origin_lng: center.lng,
      radius_m: radiusMeters,
    })
    if (error) throw new Error(`venues_within failed: ${error.message}`)
    return this.hydrateRecords((data ?? []) as DbVenue[])
  }

  async getVenue(id: string): Promise<VenueRecord | null> {
    const { data } = await this.client.from('venues').select('*').eq('id', id).maybeSingle()
    if (!data) return null
    const [record] = await this.hydrateRecords([data as DbVenue])
    return record ?? null
  }

  async upsertVenues(records: VenueRecord[]): Promise<void> {
    if (records.length === 0) return

    const { error: vErr } = await this.client.from('venues').upsert(
      records.map((r) => ({
        id: r.venue.id,
        name: r.venue.name,
        address: r.venue.address,
        lat: r.venue.lat,
        lng: r.venue.lng,
        latlng_approximate: r.venue.latlngApproximate,
        phone: r.venue.phone,
        email: r.venue.email,
        website: r.venue.website,
        events_url: r.venue.eventsUrl,
        cuisine: r.venue.cuisine,
        venue_kind: r.venue.venueKind,
        notes: r.venue.notes,
      })),
      { onConflict: 'id' },
    )
    if (vErr) throw new Error(`venue upsert failed: ${vErr.message}`)

    const spaces = records.flatMap((r) =>
      r.spaces.map((s) => ({
        id: s.id,
        venue_id: s.venueId,
        name: s.name,
        seated_cap: s.seatedCap,
        standing_cap: s.standingCap,
        is_buyout: s.isBuyout,
        combinable_group: s.combinableGroup,
        is_composite: s.isComposite,
        min_spend_cents: s.minSpendCents,
        min_spend_period: s.minSpendPeriod,
      })),
    )
    if (spaces.length > 0) {
      const { error } = await this.client.from('venue_spaces').upsert(spaces, { onConflict: 'id' })
      if (error) throw new Error(`space upsert failed: ${error.message}`)
    }

    const evidence = records.flatMap((r) =>
      r.evidence.map((e) => ({
        id: e.id,
        venue_id: e.venueId,
        space_id: e.spaceId,
        field: e.field,
        value: e.value,
        source_url: e.sourceUrl,
        source_class: e.sourceClass,
        snippet: e.snippet,
        extractor: e.extractor,
        extracted_at: e.extractedAt,
      })),
    )
    if (evidence.length > 0) {
      const { error } = await this.client.from('evidence').upsert(evidence, { onConflict: 'id' })
      if (error) throw new Error(`evidence upsert failed: ${error.message}`)
    }
  }

  async getCell(geohash5: string, mode: CommuteMode): Promise<HydrationCell | null> {
    const { data } = await this.client
      .from('hydration_cells')
      .select('*')
      .eq('geohash5', geohash5)
      .eq('mode', mode)
      .maybeSingle()
    if (!data) return null
    const row = data as DbCell
    return {
      geohash5: row.geohash5,
      mode: row.mode as CommuteMode,
      status: row.status as HydrationCell['status'],
      venueCount: row.venue_count,
      hydratedAt: row.hydrated_at,
      expiresAt: row.expires_at,
      note: row.note,
    }
  }

  async upsertCell(cell: HydrationCell): Promise<void> {
    await this.client.from('hydration_cells').upsert(
      {
        geohash5: cell.geohash5,
        mode: cell.mode,
        status: cell.status,
        venue_count: cell.venueCount,
        hydrated_at: cell.hydratedAt,
        expires_at: cell.expiresAt,
        note: cell.note,
      },
      { onConflict: 'geohash5,mode' },
    )
  }

  async getCachedCommutes(
    originGeohash: string,
    venueIds: string[],
    mode: CommuteMode,
  ): Promise<Map<string, CommuteResult>> {
    if (venueIds.length === 0) return new Map()
    const { data } = await this.client
      .from('commute_cache')
      .select('*')
      .eq('origin_geohash', originGeohash)
      .eq('mode', mode)
      .in('venue_id', venueIds)

    const out = new Map<string, CommuteResult>()
    for (const row of (data ?? []) as DbCommute[]) {
      out.set(row.venue_id, {
        mode: row.mode as CommuteMode,
        durationSeconds: row.duration_s,
        distanceMeters: row.distance_m,
        method: row.method as 'measured' | 'estimated',
        trust: row.method === 'measured' ? 'verified' : 'likely',
      })
    }
    return out
  }

  async putCachedCommutes(
    originGeohash: string,
    mode: CommuteMode,
    entries: Array<{ venueId: string; result: CommuteResult }>,
  ): Promise<void> {
    if (entries.length === 0) return
    await this.client.from('commute_cache').upsert(
      entries.map(({ venueId, result }) => ({
        origin_geohash: originGeohash,
        venue_id: venueId,
        mode,
        duration_s: result.durationSeconds,
        distance_m: result.distanceMeters,
        method: result.method,
        fetched_at: new Date().toISOString(),
      })),
      { onConflict: 'origin_geohash,venue_id,mode' },
    )
  }

  async recordSearch(params: SearchParams, resultIds: string[]): Promise<void> {
    await this.client.from('searches').insert({ params, result_ids: resultIds })
  }
}

// ── Row shapes ───────────────────────────────────────────────────────────────

interface DbVenue {
  id: string
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
  notes: string | null
}

interface DbSpace {
  id: string
  venue_id: string
  name: string
  seated_cap: number | null
  standing_cap: number | null
  is_buyout: boolean
  combinable_group: string | null
  is_composite: boolean
  min_spend_cents: number | null
  min_spend_period: string | null
}

interface DbEvidence {
  id: string
  venue_id: string
  space_id: string | null
  field: string
  value: string
  source_url: string
  source_class: string
  snippet: string
  extractor: string
  extracted_at: string
}

interface DbCell {
  geohash5: string
  mode: string
  status: string
  venue_count: number
  hydrated_at: string | null
  expires_at: string | null
  note: string | null
}

interface DbCommute {
  venue_id: string
  mode: string
  duration_s: number
  distance_m: number
  method: string
}

function mapVenue(row: DbVenue): VenueRecord['venue'] {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    lat: Number(row.lat),
    lng: Number(row.lng),
    latlngApproximate: row.latlng_approximate,
    phone: row.phone,
    email: row.email,
    website: row.website,
    eventsUrl: row.events_url,
    cuisine: row.cuisine,
    venueKind: row.venue_kind as VenueRecord['venue']['venueKind'],
    notes: row.notes,
  }
}

function mapSpace(row: DbSpace): VenueSpace {
  return {
    id: row.id,
    venueId: row.venue_id,
    name: row.name,
    seatedCap: row.seated_cap,
    standingCap: row.standing_cap,
    isBuyout: row.is_buyout,
    combinableGroup: row.combinable_group,
    isComposite: row.is_composite,
    minSpendCents: row.min_spend_cents,
    minSpendPeriod: row.min_spend_period as VenueSpace['minSpendPeriod'],
  }
}

function mapEvidence(row: DbEvidence): Evidence {
  return {
    id: row.id,
    venueId: row.venue_id,
    spaceId: row.space_id,
    field: row.field as Evidence['field'],
    value: row.value,
    sourceUrl: row.source_url,
    sourceClass: row.source_class as Evidence['sourceClass'],
    snippet: row.snippet,
    extractor: row.extractor as Evidence['extractor'],
    extractedAt: row.extracted_at,
  }
}
