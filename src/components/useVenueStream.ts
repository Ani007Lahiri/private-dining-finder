'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { HydrationCell, RankedResult, SearchStreamEvent } from '@/lib/types'
import type { SearchRequest } from '@/lib/params'
import { toQuery } from '@/lib/params'

// ─────────────────────────────────────────────────────────────────────────────
// Streaming search client.
//
// Results arrive in waves: whatever the database already holds, then anything
// background hydration discovers. Re-ranking on arrival means the list can
// reorder under the planner's cursor, which is hostile.
//
// So: the first wave renders immediately, and later waves are HELD behind an
// explicit "N more venues found — merge" banner once the planner has started
// reading. If they have not scrolled and nothing is pinned, merging silently is
// fine and we do it. The rule is that we never move something they are looking at.
// ─────────────────────────────────────────────────────────────────────────────

export interface StreamState {
  results: RankedResult[]
  pending: RankedResult[] | null
  cell: HydrationCell | null
  statusMessage: string | null
  loading: boolean
  error: string | null
  elapsedMs: number | null
}

const INITIAL: StreamState = {
  results: [],
  pending: null,
  cell: null,
  statusMessage: null,
  loading: false,
  error: null,
  elapsedMs: null,
}

export function useVenueStream() {
  const [state, setState] = useState<StreamState>(INITIAL)
  const sourceRef = useRef<EventSource | null>(null)
  const engagedRef = useRef(false)

  const close = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
  }, [])

  useEffect(() => close, [close])

  /** Called by the results list when the planner scrolls or pins something. */
  const markEngaged = useCallback(() => {
    engagedRef.current = true
  }, [])

  const mergePending = useCallback(() => {
    setState((s) => (s.pending ? { ...s, results: s.pending, pending: null } : s))
    engagedRef.current = false
  }, [])

  const search = useCallback(
    (req: SearchRequest) => {
      close()
      engagedRef.current = false
      setState({ ...INITIAL, loading: true })

      const es = new EventSource(`/api/search/stream?${toQuery(req)}`)
      sourceRef.current = es

      es.onmessage = (message) => {
        let event: SearchStreamEvent
        try {
          event = JSON.parse(message.data) as SearchStreamEvent
        } catch {
          return
        }

        setState((prev) => {
          switch (event.type) {
            case 'status':
              return { ...prev, cell: event.cell, statusMessage: event.message }
            case 'results':
              return { ...prev, results: event.results, pending: null }
            case 'appended':
              // Only interrupt if they have not started reading.
              if (!engagedRef.current) return { ...prev, results: event.results, pending: null }
              return { ...prev, pending: event.results }
            case 'done':
              return { ...prev, loading: false, elapsedMs: event.elapsedMs }
            case 'error':
              return { ...prev, loading: false, error: event.message }
            default:
              return prev
          }
        })

        if (event.type === 'done' || event.type === 'error') close()
      }

      es.onerror = () => {
        setState((prev) =>
          prev.loading ? { ...prev, loading: false, error: 'Connection to the search stream was lost.' } : prev,
        )
        close()
      }
    },
    [close],
  )

  return { state, search, mergePending, markEngaged, close }
}
