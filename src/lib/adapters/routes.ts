import { config } from '../config'
import { DETOUR_FACTOR, ESTIMATE_SPEED_MPS, haversineMeters, type LatLng } from '../geo'
import type { CommuteMode, CommuteResult } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Commute, stage 2.
//
// Stage 1 (a straight-line radius, in the repo layer) has already cut the
// candidate set down. This module turns survivors into real durations.
//
// Note that the trust logic applies here too: an API-measured duration is
// `verified`, a straight-line estimate is `likely`. It would be easy to render
// an estimate as though it were measured, and it would be exactly the kind of
// false confidence this product exists to avoid.
// ─────────────────────────────────────────────────────────────────────────────

/** Routes API computeRouteMatrix caps elements per request; batch destinations. */
const BATCH_SIZE = 25

export function estimateCommute(origin: LatLng, dest: LatLng, mode: CommuteMode): CommuteResult {
  const straight = haversineMeters(origin, dest)
  const distance = straight * DETOUR_FACTOR[mode]
  return {
    mode,
    durationSeconds: Math.round(distance / ESTIMATE_SPEED_MPS[mode]),
    distanceMeters: Math.round(distance),
    method: 'estimated',
    trust: 'likely',
  }
}

interface MatrixElement {
  originIndex: number
  destinationIndex: number
  duration?: string
  distanceMeters?: number
  condition?: string
}

async function computeRouteMatrixBatch(
  origin: LatLng,
  destinations: LatLng[],
  mode: CommuteMode,
): Promise<Map<number, CommuteResult>> {
  const key = config.google.serverKey
  if (!key) throw new Error('Routes API key missing')

  const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
    },
    body: JSON.stringify({
      origins: [{ waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } } }],
      destinations: destinations.map((d) => ({
        waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
      })),
      travelMode: mode === 'walking' ? 'WALK' : 'DRIVE',
      ...(mode === 'driving' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
    }),
  })

  if (!res.ok) {
    throw new Error(`Routes API ${res.status}: ${await res.text()}`)
  }

  const rows = (await res.json()) as MatrixElement[]
  const out = new Map<number, CommuteResult>()
  for (const row of rows) {
    if (row.condition && row.condition !== 'ROUTE_EXISTS') continue
    if (!row.duration || row.distanceMeters === undefined) continue
    out.set(row.destinationIndex, {
      mode,
      durationSeconds: Math.round(Number(row.duration.replace(/s$/, ''))),
      distanceMeters: row.distanceMeters,
      method: 'measured',
      trust: 'verified',
    })
  }
  return out
}

/**
 * Resolve commute for a list of destinations, in index order.
 *
 * Degrades one destination at a time rather than all-or-nothing: if the Routes
 * call fails, every destination falls back to an estimate and is labelled as
 * such, so the search still returns something useful.
 */
export async function commuteMatrix(
  origin: LatLng,
  destinations: LatLng[],
  mode: CommuteMode,
): Promise<CommuteResult[]> {
  if (!config.google.routesEnabled) {
    return destinations.map((d) => estimateCommute(origin, d, mode))
  }

  const results: CommuteResult[] = destinations.map((d) => estimateCommute(origin, d, mode))

  for (let i = 0; i < destinations.length; i += BATCH_SIZE) {
    const slice = destinations.slice(i, i + BATCH_SIZE)
    try {
      const measured = await computeRouteMatrixBatch(origin, slice, mode)
      for (const [localIdx, value] of measured) {
        results[i + localIdx] = value
      }
    } catch (err) {
      console.warn('[routes] batch failed, keeping estimates for this slice:', (err as Error).message)
    }
  }

  return results
}
