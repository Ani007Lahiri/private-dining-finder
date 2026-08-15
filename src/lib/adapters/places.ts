import { config } from '../config'
import type { LatLng } from '../geo'
import { BAND_PLACE_TYPES, bandFor, discoveryQueries } from '../discovery'
import type { EventStyle, VenueKind } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Venue discovery via Google Places (New) Text Search.
//
// Places gives us existence, location and contact details. It does NOT give us
// private-room capacity or minimum spend — nobody's Places record has a
// "Coral Ballroom holds 1,135 standing" field. Those come from the extraction
// step. A venue discovered here and never extracted is surfaced with capacity
// `unverified`, which is honest, rather than a guess, which is not.
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoveredPlace {
  placeId: string
  name: string
  address: string
  lat: number
  lng: number
  phone: string | null
  website: string | null
  venueKind: VenueKind
  primaryType: string | null
  rating: number | null
  userRatingCount: number | null
}

const TYPE_TO_KIND: Array<[RegExp, VenueKind]> = [
  [/hotel|lodging|resort/, 'hotel'],
  [/banquet|convention|event_venue|wedding/, 'event_space'],
  [/museum|art_gallery/, 'museum'],
  [/bar|pub|night_club|brewery/, 'bar'],
  [/restaurant|food|cafe|steak|meal/, 'restaurant'],
]

export function classifyKind(primaryType: string | null, types: string[] = []): VenueKind {
  const haystack = [primaryType ?? '', ...types].join(' ').toLowerCase()
  for (const [re, kind] of TYPE_TO_KIND) {
    if (re.test(haystack)) return kind
  }
  return 'event_space'
}

interface PlacesResponse {
  places?: Array<{
    id: string
    displayName?: { text: string }
    formattedAddress?: string
    location?: { latitude: number; longitude: number }
    nationalPhoneNumber?: string
    websiteUri?: string
    primaryType?: string
    types?: string[]
    rating?: number
    userRatingCount?: number
  }>
}

async function textSearch(
  query: string,
  center: LatLng,
  radiusMeters: number,
  includedType?: string,
): Promise<DiscoveredPlace[]> {
  const key = config.google.serverKey
  if (!key) return []

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.nationalPhoneNumber',
        'places.websiteUri',
        'places.primaryType',
        'places.types',
        'places.rating',
        'places.userRatingCount',
      ].join(','),
    },
    body: JSON.stringify({
      textQuery: query,
      // Places caps the circle at 50 km; our radii are far below that.
      locationBias: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: Math.min(radiusMeters, 50_000),
        },
      },
      ...(includedType ? { includedType } : {}),
      maxResultCount: 20,
    }),
  })

  if (!res.ok) {
    console.warn(`[places] ${res.status} for "${query}": ${await res.text()}`)
    return []
  }

  const json = (await res.json()) as PlacesResponse
  return (json.places ?? [])
    .filter((p) => p.location && p.displayName)
    .map((p) => ({
      placeId: p.id,
      name: p.displayName!.text,
      address: p.formattedAddress ?? '',
      lat: p.location!.latitude,
      lng: p.location!.longitude,
      phone: p.nationalPhoneNumber ?? null,
      website: p.websiteUri ?? null,
      venueKind: classifyKind(p.primaryType ?? null, p.types),
      primaryType: p.primaryType ?? null,
      rating: p.rating ?? null,
      userRatingCount: p.userRatingCount ?? null,
    }))
}

/**
 * Run the headcount-banded query set and dedupe by place id.
 *
 * Queries are issued in parallel because they are independent and the whole
 * hydration job is latency-bound; Places rate limits are generous enough for a
 * handful of concurrent text searches.
 */
export async function discoverVenues(
  center: LatLng,
  radiusMeters: number,
  headcount: number,
  style: EventStyle,
  locality: string,
): Promise<DiscoveredPlace[]> {
  if (!config.google.placesEnabled) return []

  const band = bandFor(headcount)
  const queries = discoveryQueries(headcount, style, locality)
  const allowedTypes = new Set(BAND_PLACE_TYPES[band])

  const batches = await Promise.all(queries.map((q) => textSearch(q, center, radiusMeters)))

  const byId = new Map<string, DiscoveredPlace>()
  for (const batch of batches) {
    for (const place of batch) {
      if (byId.has(place.placeId)) continue
      // Keep anything whose primary type is plausible for the band, plus
      // anything unclassified — a venue with a missing type is not evidence of
      // a bad venue, and the extraction step will sort it out.
      const typeOk =
        !place.primaryType ||
        allowedTypes.has(place.primaryType) ||
        [...allowedTypes].some((t) => place.primaryType!.includes(t))
      if (typeOk) byId.set(place.placeId, place)
    }
  }

  return [...byId.values()]
}

export interface AutocompleteSuggestion {
  placeId: string
  primaryText: string
  secondaryText: string
}

export async function autocompleteAddress(input: string): Promise<AutocompleteSuggestion[]> {
  const key = config.google.serverKey
  if (!key || input.trim().length < 3) return []

  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify({ input }),
  })
  if (!res.ok) return []

  const json = (await res.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId: string
        structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } }
      }
    }>
  }

  return (json.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      placeId: p.placeId,
      primaryText: p.structuredFormat?.mainText?.text ?? '',
      secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
    }))
}

export async function geocodePlaceId(placeId: string): Promise<{ lat: number; lng: number; address: string } | null> {
  const key = config.google.serverKey
  if (!key) return null

  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'location,formattedAddress' },
  })
  if (!res.ok) return null

  const json = (await res.json()) as {
    location?: { latitude: number; longitude: number }
    formattedAddress?: string
  }
  if (!json.location) return null
  return {
    lat: json.location.latitude,
    lng: json.location.longitude,
    address: json.formattedAddress ?? '',
  }
}
