// ─────────────────────────────────────────────────────────────────────────────
// Adapter configuration.
//
// Every external dependency is optional. The app is designed to boot and serve
// all three required scenarios with an entirely empty environment, then swap
// each adapter from `seed` to `live` as keys appear. /api/health reports which.
// ─────────────────────────────────────────────────────────────────────────────

function env(key: string): string | null {
  const v = process.env[key]
  return v && v.trim().length > 0 ? v.trim() : null
}

export const config = {
  supabase: {
    url: env('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: env('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    get enabled() {
      return Boolean(this.url && this.anonKey)
    },
    get canWrite() {
      return Boolean(this.url && this.serviceRoleKey)
    },
  },
  google: {
    serverKey: env('GOOGLE_MAPS_API_KEY'),
    browserKey: env('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'),
    get placesEnabled() {
      return Boolean(this.serverKey)
    },
    get routesEnabled() {
      return Boolean(this.serverKey)
    },
  },
  llm: {
    apiKey: env('ANTHROPIC_API_KEY'),
    model: env('EXTRACTION_MODEL') ?? 'claude-sonnet-4-5',
    get enabled() {
      return Boolean(this.apiKey)
    },
  },
  hydration: {
    ttlHours: Number(env('HYDRATION_TTL_HOURS') ?? 168),
    maxExtractions: Number(env('HYDRATION_MAX_EXTRACTIONS') ?? 15),
  },
  commute: {
    geohashPrecision: Number(env('COMMUTE_CACHE_GEOHASH_PRECISION') ?? 7),
  },
} as const

export interface AdapterStatus {
  persistence: 'supabase' | 'memory'
  discovery: 'google_places' | 'seed'
  commute: 'google_routes' | 'estimated'
  extraction: 'llm' | 'disabled'
  realtime: 'supabase_realtime' | 'sse_only'
}

export function adapterStatus(): AdapterStatus {
  return {
    persistence: config.supabase.enabled ? 'supabase' : 'memory',
    discovery: config.google.placesEnabled ? 'google_places' : 'seed',
    commute: config.google.routesEnabled ? 'google_routes' : 'estimated',
    extraction: config.llm.enabled ? 'llm' : 'disabled',
    realtime: config.supabase.enabled ? 'supabase_realtime' : 'sse_only',
  }
}
