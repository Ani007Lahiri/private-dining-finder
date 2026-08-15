import { z } from 'zod'
import { DEFAULT_WEIGHTS } from './ranking'
import type { SearchParams } from './types'
import type { SortMode } from './ranking'

export const searchParamsSchema = z.object({
  address: z.string().min(1).max(400),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  headcount: z.number().int().min(1).max(10_000),
  maxCommuteMinutes: z.number().int().min(1).max(180),
  mode: z.enum(['walking', 'driving']),
  eventStyle: z.enum(['seated', 'reception', 'mixed']),
  budgetCents: z.number().int().min(0).nullable().default(null),
  weights: z
    .object({
      capacity: z.number().min(0).max(1),
      commute: z.number().min(0).max(1),
      price: z.number().min(0).max(1),
    })
    .default(DEFAULT_WEIGHTS),
  verifiedCapacityOnly: z.boolean().default(false),
  includeUnknownCapacity: z.boolean().default(true),
  sort: z.enum(['fit', 'confidence_adjusted', 'commute', 'capacity']).default('fit'),
})

export type SearchRequest = z.infer<typeof searchParamsSchema>

export function toSearchParams(req: SearchRequest): SearchParams {
  return {
    address: req.address,
    lat: req.lat,
    lng: req.lng,
    headcount: req.headcount,
    maxCommuteMinutes: req.maxCommuteMinutes,
    mode: req.mode,
    eventStyle: req.eventStyle,
    budgetCents: req.budgetCents,
    weights: req.weights,
    verifiedCapacityOnly: req.verifiedCapacityOnly,
    includeUnknownCapacity: req.includeUnknownCapacity,
  }
}

/** Parse from a URLSearchParams, for the SSE endpoint which must be a GET. */
export function fromQuery(sp: URLSearchParams): SearchRequest {
  const num = (k: string, fallback?: number) => {
    const v = sp.get(k)
    if (v === null || v === '') return fallback
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  const bool = (k: string, fallback: boolean) => {
    const v = sp.get(k)
    if (v === null) return fallback
    return v === 'true' || v === '1'
  }

  return searchParamsSchema.parse({
    address: sp.get('address') ?? '',
    lat: num('lat'),
    lng: num('lng'),
    headcount: num('headcount'),
    maxCommuteMinutes: num('maxCommuteMinutes'),
    mode: sp.get('mode') ?? 'walking',
    eventStyle: sp.get('eventStyle') ?? 'seated',
    budgetCents: sp.get('budgetCents') ? num('budgetCents') : null,
    weights: {
      capacity: num('wCapacity', DEFAULT_WEIGHTS.capacity)!,
      commute: num('wCommute', DEFAULT_WEIGHTS.commute)!,
      price: num('wPrice', DEFAULT_WEIGHTS.price)!,
    },
    verifiedCapacityOnly: bool('verifiedCapacityOnly', false),
    includeUnknownCapacity: bool('includeUnknownCapacity', true),
    sort: sp.get('sort') ?? 'fit',
  })
}

export function toQuery(req: SearchRequest): string {
  const sp = new URLSearchParams({
    address: req.address,
    lat: String(req.lat),
    lng: String(req.lng),
    headcount: String(req.headcount),
    maxCommuteMinutes: String(req.maxCommuteMinutes),
    mode: req.mode,
    eventStyle: req.eventStyle,
    wCapacity: String(req.weights.capacity),
    wCommute: String(req.weights.commute),
    wPrice: String(req.weights.price),
    verifiedCapacityOnly: String(req.verifiedCapacityOnly),
    includeUnknownCapacity: String(req.includeUnknownCapacity),
    sort: req.sort,
  })
  if (req.budgetCents !== null) sp.set('budgetCents', String(req.budgetCents))
  return sp.toString()
}

export const sortModes: SortMode[] = ['fit', 'confidence_adjusted', 'commute', 'capacity']
