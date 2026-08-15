import { config } from '../config'
import { MemoryRepo } from './memory'
import { SupabaseRepo } from './supabase'
import type { VenueRepo } from './types'

export type { VenueRepo } from './types'

let instance: VenueRepo | null = null

/**
 * Single repository instance per server process.
 *
 * Supabase when configured, in-memory seed otherwise. A Supabase construction
 * failure falls back rather than crashing the route — a misconfigured database
 * URL should degrade the product, not take it offline.
 */
export function getRepo(): VenueRepo {
  if (instance) return instance

  if (config.supabase.enabled) {
    try {
      instance = new SupabaseRepo()
      return instance
    } catch (err) {
      console.warn('[repo] Supabase unavailable, falling back to seed:', (err as Error).message)
    }
  }

  instance = new MemoryRepo()
  return instance
}

/** Test hook. */
export function resetRepo(): void {
  instance = null
}
