import { NextResponse } from 'next/server'
import { z } from 'zod'
import { searchParamsSchema, toSearchParams } from '@/lib/params'
import { runSearch } from '@/lib/search'
import { cellStatus } from '@/lib/hydration'
import { bandExplanation } from '@/lib/discovery'
import { adapterStatus } from '@/lib/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Synchronous search.
 *
 * Returns whatever the database already holds, immediately. It never blocks on
 * enrichment — the cell status in the response tells the client whether a
 * hydration pass is worth starting, and /api/search/stream is where that
 * happens.
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = searchParamsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid search parameters', issues: z.treeifyError(parsed.error) },
      { status: 400 },
    )
  }

  const params = toSearchParams(parsed.data)

  try {
    const [outcome, cell] = await Promise.all([
      runSearch(params, parsed.data.sort),
      cellStatus({ lat: params.lat, lng: params.lng }, params),
    ])

    return NextResponse.json({
      results: outcome.results,
      rejected: outcome.rejected,
      stats: outcome.stats,
      cell,
      strategy: bandExplanation(params.headcount, params.eventStyle),
      adapters: adapterStatus(),
    })
  } catch (err) {
    console.error('[api/search]', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
