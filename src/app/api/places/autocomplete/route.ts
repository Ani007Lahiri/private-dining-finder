import { NextResponse } from 'next/server'
import { autocompleteAddress, geocodePlaceId } from '@/lib/adapters/places'
import { config } from '@/lib/config'
import { SCENARIOS } from '@/lib/scenarios'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Address autocomplete.
 *
 * Proxied server-side so the Places key is never shipped to the browser. With
 * no key configured this falls back to matching the three required scenario
 * addresses, which is enough to drive the whole product from the seed corpus.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const input = (url.searchParams.get('q') ?? '').trim()
  const placeId = url.searchParams.get('placeId')

  if (placeId) {
    const resolved = await geocodePlaceId(placeId)
    if (!resolved) return NextResponse.json({ error: 'Could not resolve place' }, { status: 404 })
    return NextResponse.json(resolved)
  }

  if (!config.google.placesEnabled) {
    const q = input.toLowerCase()
    const matches = SCENARIOS.filter(
      (s) => q.length === 0 || s.address.toLowerCase().includes(q) || s.label.toLowerCase().includes(q),
    ).map((s) => ({
      placeId: `seed:${s.id}`,
      primaryText: s.label,
      secondaryText: s.address,
      lat: s.lat,
      lng: s.lng,
    }))
    return NextResponse.json({ suggestions: matches, source: 'seed' })
  }

  const suggestions = await autocompleteAddress(input)
  return NextResponse.json({ suggestions, source: 'google' })
}
