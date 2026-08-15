import { NextResponse } from 'next/server'
import { adapterStatus } from '@/lib/config'
import { getRepo } from '@/lib/repo'
import { datasetProvenance } from '@/data/seed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Which adapters are live, and what the seed corpus actually contains.
 *
 * The provenance block is computed from the evidence rows rather than asserted,
 * so it cannot drift from the data. It is the honest answer to "how much of
 * this do you actually know?"
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    adapters: adapterStatus(),
    repo: getRepo().kind,
    seed: datasetProvenance(),
  })
}
