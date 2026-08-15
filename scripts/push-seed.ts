/**
 * Push the seed corpus into Supabase.
 *
 *   1. Run supabase/migrations/0001_init.sql in the SQL editor
 *   2. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *   3. npm run seed:push
 *
 * Idempotent — every row is upserted on its primary key, so re-running after a
 * corpus change updates in place rather than duplicating.
 */

import './load-env' // must precede any import that reads process.env (i.e. config)
import { createClient } from '@supabase/supabase-js'
import { seedVenues, seededCells } from '../src/data/seed'
import { config } from '../src/lib/config'

async function main() {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    console.error('\nNEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.')
    console.error('The anon key cannot write — RLS restricts inserts to the service role. See .env.example.\n')
    process.exit(2)
  }

  const client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  })

  const records = seedVenues()
  console.log(`Pushing ${records.length} venues…`)

  const chunk = <T,>(arr: T[], size: number): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  }

  // Venues first — spaces and evidence carry foreign keys onto them.
  for (const batch of chunk(records, 25)) {
    const { error } = await client.from('venues').upsert(
      batch.map((r) => ({
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
    if (error) throw new Error(`venues: ${error.message}`)
  }

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
  console.log(`Pushing ${spaces.length} spaces…`)
  for (const batch of chunk(spaces, 200)) {
    const { error } = await client.from('venue_spaces').upsert(batch, { onConflict: 'id' })
    if (error) throw new Error(`venue_spaces: ${error.message}`)
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
  console.log(`Pushing ${evidence.length} evidence rows…`)
  for (const batch of chunk(evidence, 200)) {
    const { error } = await client.from('evidence').upsert(batch, { onConflict: 'id' })
    if (error) throw new Error(`evidence: ${error.message}`)
  }

  // Mark the covered cells warm so searches there skip live hydration.
  const cells = seededCells()
  const expires = new Date(Date.now() + config.hydration.ttlHours * 3600_000).toISOString()
  const cellRows = cells.flatMap((c) =>
    (['walking', 'driving'] as const).map((mode) => ({
      geohash5: c.geohash5,
      mode,
      status: 'warm' as const,
      venue_count: c.venueCount,
      hydrated_at: new Date().toISOString(),
      expires_at: expires,
      note: `${c.venueCount} venues seeded near ${c.label}`,
    })),
  )
  console.log(`Marking ${cells.length} cells warm…`)
  const { error: cellErr } = await client.from('hydration_cells').upsert(cellRows, { onConflict: 'geohash5,mode' })
  if (cellErr) throw new Error(`hydration_cells: ${cellErr.message}`)

  console.log(`\n✓ Done. ${records.length} venues, ${spaces.length} spaces, ${evidence.length} evidence rows.\n`)
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}\n`)
  process.exit(1)
})
