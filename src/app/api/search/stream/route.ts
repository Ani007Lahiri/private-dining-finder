import { fromQuery, toSearchParams } from '@/lib/params'
import { runSearch } from '@/lib/search'
import { cellStatus, hydrateCell } from '@/lib/hydration'
import type { SearchStreamEvent } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Streaming search over Server-Sent Events.
 *
 * The sequence is always the same, and the first frame is always immediate:
 *
 *   status    → what this geographic cell is (warm / cold / stale / unavailable)
 *   results   → everything already in the database, ranked. May be empty.
 *   [hydrate] → if the cell is cold or stale, enrichment runs HERE, behind the
 *               response the planner is already reading
 *   appended  → the re-ranked set including anything enrichment discovered
 *   done
 *
 * SSE rather than Supabase Realtime as the primary transport, deliberately:
 * it works identically whether persistence is Postgres or the in-memory seed,
 * which keeps the zero-config path honest. When Supabase IS configured the
 * Realtime channel carries the same venue inserts, and the client subscribes to
 * both — see useVenueStream.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)

  let req: ReturnType<typeof fromQuery>
  try {
    req = fromQuery(url.searchParams)
  } catch (err) {
    return new Response(`Invalid search parameters: ${(err as Error).message}`, { status: 400 })
  }

  const params = toSearchParams(req)
  const started = Date.now()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (event: SearchStreamEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          closed = true
        }
      }

      // If the planner navigates away mid-hydration, stop writing.
      request.signal.addEventListener('abort', () => {
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      })

      try {
        const origin = { lat: params.lat, lng: params.lng }
        const cell = await cellStatus(origin, params)

        send({
          type: 'status',
          cell,
          message:
            cell.status === 'warm'
              ? `This area is already indexed (${cell.note ?? 'cached'}).`
              : cell.status === 'unavailable'
                ? (cell.note ?? 'Live enrichment unavailable.')
                : cell.status === 'stale'
                  ? 'This area was indexed a while ago — refreshing in the background.'
                  : 'First search in this area — discovering venues in the background.',
        })

        // Immediate response from whatever we already hold.
        const first = await runSearch(params, req.sort)
        send({ type: 'results', results: first.results, total: first.results.length })

        // Enrichment behind the response.
        if (cell.status === 'cold' || cell.status === 'stale') {
          const outcome = await hydrateCell(origin, params)
          if (outcome.added.length > 0) {
            const second = await runSearch(params, req.sort)
            send({ type: 'appended', results: second.results, total: second.results.length })
            send({ type: 'done', total: second.results.length, elapsedMs: Date.now() - started })
            closed = true
            controller.close()
            return
          }
          send({
            type: 'status',
            cell: outcome.cell,
            message: outcome.cell.note ?? 'Nothing new found in this area.',
          })
        }

        send({ type: 'done', total: first.results.length, elapsedMs: Date.now() - started })
      } catch (err) {
        console.error('[api/search/stream]', err)
        send({ type: 'error', message: (err as Error).message })
      } finally {
        if (!closed) {
          closed = true
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
