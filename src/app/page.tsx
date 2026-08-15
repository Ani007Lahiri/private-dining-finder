'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import clsx from 'clsx'
import { SearchForm } from '@/components/SearchForm'
import { VenueCard } from '@/components/VenueCard'
import { VenueDetail } from '@/components/VenueDetail'
import { ComparisonTray } from '@/components/ComparisonTray'
import { useVenueStream } from '@/components/useVenueStream'
import { DEFAULT_WEIGHTS } from '@/lib/ranking'
import { bandExplanation } from '@/lib/discovery'
import { SCENARIOS } from '@/lib/scenarios'
import { toSearchParams, type SearchRequest } from '@/lib/params'
import type { AdapterStatus } from '@/lib/config'
import type { SortMode } from '@/lib/ranking'

// Leaflet touches `window` at import time.
const MapPanel = dynamic(() => import('@/components/MapPanel').then((m) => m.MapPanel), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-ink-100" />,
})

const INITIAL_REQUEST: SearchRequest = {
  address: SCENARIOS[0].address,
  lat: SCENARIOS[0].lat,
  lng: SCENARIOS[0].lng,
  headcount: SCENARIOS[0].headcount,
  maxCommuteMinutes: SCENARIOS[0].maxCommuteMinutes,
  mode: SCENARIOS[0].mode,
  eventStyle: SCENARIOS[0].eventStyle,
  budgetCents: null,
  weights: DEFAULT_WEIGHTS,
  verifiedCapacityOnly: false,
  includeUnknownCapacity: true,
  sort: 'fit',
}

const SORT_LABELS: Record<SortMode, string> = {
  fit: 'Best fit',
  confidence_adjusted: 'Fit, confidence-adjusted',
  commute: 'Shortest commute',
  capacity: 'Largest capacity',
  reputation: 'Highest Yelp rating',
}

export default function Page() {
  const [request, setRequest] = useState<SearchRequest>(INITIAL_REQUEST)
  const [activeParams, setActiveParams] = useState(() => toSearchParams(INITIAL_REQUEST))
  const [openId, setOpenId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string[]>([])
  const [adapters, setAdapters] = useState<AdapterStatus | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const { state, search, mergePending, markEngaged } = useVenueStream()

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((j) => setAdapters(j.adapters as AdapterStatus))
      .catch(() => {})
  }, [])

  const runSearch = useCallback(
    (req: SearchRequest) => {
      setActiveParams(toSearchParams(req))
      setOpenId(null)
      setPinned([])
      search(req)
      listRef.current?.scrollTo({ top: 0 })
    },
    [search],
  )

  // Kick off the first scenario so the page is never an empty state.
  useEffect(() => {
    runSearch(INITIAL_REQUEST)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const results = state.results
  const openResult = useMemo(() => results.find((r) => r.record.venue.id === openId) ?? null, [results, openId])
  const pinnedResults = useMemo(
    () => pinned.map((id) => results.find((r) => r.record.venue.id === id)).filter((r) => r !== undefined),
    [pinned, results],
  )

  const togglePin = useCallback(
    (id: string) => {
      markEngaged()
      setPinned((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? p : [...p, id]))
    },
    [markEngaged],
  )

  const verifiedCount = results.filter((r) => r.capacity.best?.trust === 'verified').length
  const unknownCount = results.filter((r) => r.capacity.unknown).length

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-200 bg-white px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold tracking-tight text-ink-900">Private Dining Finder</h1>
          <span className="hidden text-[11px] text-ink-400 sm:inline">
            Ranked venue search with per-field provenance
          </span>
        </div>
        {adapters && (
          <div className="flex items-center gap-1.5 text-[10px]">
            <AdapterChip label="data" value={adapters.persistence === 'supabase' ? 'Supabase' : 'seed corpus'} live={adapters.persistence === 'supabase'} />
            <AdapterChip label="discovery" value={adapters.discovery === 'google_places' ? 'Places' : 'seed'} live={adapters.discovery === 'google_places'} />
            <AdapterChip label="commute" value={adapters.commute === 'google_routes' ? 'Routes' : 'estimated'} live={adapters.commute === 'google_routes'} />
            <AdapterChip label="extraction" value={adapters.extraction === 'llm' ? 'live' : 'off'} live={adapters.extraction === 'llm'} />
            <AdapterChip label="reputation" value={adapters.reputation === 'yelp' ? 'Yelp' : 'off'} live={adapters.reputation === 'yelp'} />
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Search panel ─────────────────────────────────────────────── */}
        <aside className="scroll-thin w-[340px] shrink-0 overflow-y-auto border-r border-ink-200 bg-ink-50/60 p-4">
          <SearchForm onSearch={runSearch} busy={state.loading} value={request} onChange={setRequest} />
        </aside>

        {/* ── Results ──────────────────────────────────────────────────── */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-ink-200 bg-white px-4 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-ink-700">
                  <strong className="tabular font-semibold text-ink-900">{results.length}</strong> venue
                  {results.length === 1 ? '' : 's'} within {activeParams.maxCommuteMinutes} min{' '}
                  {activeParams.mode === 'walking' ? 'walk' : 'drive'}
                  {results.length > 0 && (
                    <span className="text-ink-500">
                      {' '}
                      · {verifiedCount} with verified capacity
                      {unknownCount > 0 && ` · ${unknownCount} needing a call`}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-ink-400">
                  {bandExplanation(activeParams.headcount, activeParams.eventStyle)}
                </p>
              </div>

              <label className="flex items-center gap-1.5 text-[11px] text-ink-500">
                Sort
                <select
                  value={request.sort}
                  onChange={(e) => {
                    const next = { ...request, sort: e.target.value as SortMode }
                    setRequest(next)
                    runSearch(next)
                  }}
                  className="rounded border border-ink-200 bg-white px-1.5 py-1 text-[11px] text-ink-800 outline-none focus:border-meter-fill"
                >
                  {(Object.keys(SORT_LABELS) as SortMode[])
                    .filter((m) => m !== 'reputation' || adapters?.reputation === 'yelp')
                    .map((m) => (
                      <option key={m} value={m}>
                        {SORT_LABELS[m]}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            {state.statusMessage && (
              <p
                className={clsx(
                  'mt-1.5 rounded px-2 py-1 text-[11px]',
                  state.cell?.status === 'warm'
                    ? 'bg-ink-100 text-ink-600'
                    : state.cell?.status === 'unavailable'
                      ? 'bg-amber-50 text-amber-900'
                      : 'bg-blue-50 text-meter-strong',
                )}
              >
                {state.loading && state.cell?.status !== 'warm' && (
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle" />
                )}
                {state.statusMessage}
              </p>
            )}

            {state.pending && (
              <button
                onClick={mergePending}
                className="mt-1.5 w-full rounded bg-meter-fill px-2 py-1 text-[11px] font-medium text-white hover:bg-meter-strong"
              >
                {state.pending.length - results.length > 0
                  ? `${state.pending.length - results.length} more venues found — merge into list`
                  : 'Updated results available — refresh list'}
              </button>
            )}
          </div>

          <div className="flex min-h-0 flex-1">
            <div
              ref={listRef}
              onScroll={markEngaged}
              className="scroll-thin w-[440px] shrink-0 space-y-2.5 overflow-y-auto bg-ink-50/40 p-3"
              style={{ paddingBottom: pinnedResults.length > 0 ? 200 : undefined }}
            >
              {state.error && (
                <p className="rounded border border-trust-unverified/30 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                  {state.error}
                </p>
              )}

              {results.length === 0 && !state.loading && !state.error && (
                <div className="rounded-lg border border-dashed border-ink-300 bg-white px-4 py-8 text-center">
                  <p className="text-sm font-medium text-ink-700">No venues match these constraints</p>
                  <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-ink-500">
                    Try widening the commute, lowering the headcount, or switching the event style — a reception tests
                    standing capacity, which is often two to three times the seated figure.
                  </p>
                </div>
              )}

              {results.length === 0 &&
                state.loading &&
                Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="h-40 animate-pulse rounded-lg border border-ink-200 bg-white" />
                ))}

              {results.map((r, i) => (
                <VenueCard
                  key={r.record.venue.id}
                  result={r}
                  rank={i + 1}
                  params={activeParams}
                  pinned={pinned.includes(r.record.venue.id)}
                  onTogglePin={() => togglePin(r.record.venue.id)}
                  onOpen={() => {
                    markEngaged()
                    setOpenId(r.record.venue.id)
                  }}
                  onHover={setHoveredId}
                  highlighted={hoveredId === r.record.venue.id}
                />
              ))}
            </div>

            <div className="isolate min-w-0 flex-1">
              <MapPanel
                results={results}
                params={activeParams}
                highlightedId={hoveredId}
                onHover={setHoveredId}
                onOpen={setOpenId}
              />
            </div>
          </div>
        </section>
      </div>

      {openResult && (
        <VenueDetail result={openResult} params={activeParams} onClose={() => setOpenId(null)} />
      )}

      <ComparisonTray
        results={pinnedResults}
        params={activeParams}
        onRemove={(id) => setPinned((p) => p.filter((x) => x !== id))}
        onClear={() => setPinned([])}
        onOpen={setOpenId}
      />
    </main>
  )
}

function AdapterChip({ label, value, live }: { label: string; value: string; live: boolean }) {
  return (
    <span
      title={live ? `${label}: live adapter` : `${label}: local fallback (no API key configured)`}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5',
        live ? 'border-trust-verified/40 bg-emerald-50 text-emerald-900' : 'border-ink-200 bg-white text-ink-500',
      )}
    >
      <span aria-hidden className={live ? 'text-trust-verified' : 'text-ink-300'}>
        {live ? '●' : '○'}
      </span>
      <span className="uppercase tracking-wide">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  )
}
