import type { CommuteMode } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Geometry and geohashing. No dependency — geohash is thirty lines and pulling
// a package for it would be the larger cost.
// ─────────────────────────────────────────────────────────────────────────────

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'
const EARTH_RADIUS_M = 6_371_000

export interface LatLng {
  lat: number
  lng: number
}

export function encodeGeohash(lat: number, lng: number, precision = 7): string {
  let idx = 0
  let bit = 0
  let evenBit = true
  let hash = ''
  let latMin = -90
  let latMax = 90
  let lngMin = -180
  let lngMax = 180

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2
      if (lng >= mid) {
        idx = idx * 2 + 1
        lngMin = mid
      } else {
        idx = idx * 2
        lngMax = mid
      }
    } else {
      const mid = (latMin + latMax) / 2
      if (lat >= mid) {
        idx = idx * 2 + 1
        latMin = mid
      } else {
        idx = idx * 2
        latMax = mid
      }
    }
    evenBit = !evenBit
    if (++bit === 5) {
      hash += BASE32[idx]
      bit = 0
      idx = 0
    }
  }
  return hash
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const dφ = φ2 - φ1
  const dλ = ((b.lng - a.lng) * Math.PI) / 180
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Speeds used for the stage-1 straight-line prefilter. These are deliberately
 * OPTIMISTIC — they are ceilings, so the radius over-selects. Over-selection
 * costs a few wasted Routes API rows; under-selection silently drops venues
 * that would have qualified, which is the failure mode that makes a search
 * tool untrustworthy.
 */
export const PREFILTER_SPEED_MPS: Record<CommuteMode, number> = {
  walking: 1.7,
  driving: 16,
}

/**
 * Realistic speeds and street-detour factors for the stage-2 fallback estimate,
 * used when no Routes API key is configured. Crow-flies distance times a
 * detour factor over a realistic speed.
 */
export const ESTIMATE_SPEED_MPS: Record<CommuteMode, number> = {
  walking: 1.35,
  driving: 7.5, // ~27 km/h — dense-urban average including signals
}

export const DETOUR_FACTOR: Record<CommuteMode, number> = {
  walking: 1.25,
  driving: 1.4,
}

export function prefilterRadiusMeters(mode: CommuteMode, maxMinutes: number): number {
  return PREFILTER_SPEED_MPS[mode] * maxMinutes * 60
}
