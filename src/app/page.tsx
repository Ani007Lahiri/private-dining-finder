'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import clsx from 'clsx'
import { SearchForm } from '@/components/SearchForm'
import { VenueCard } from '@/components/VenueCard'
import { VenueDetail } from '@/components/VenueDetail'
import { ComparisonTray } from '@/components/ComparisonTray'
import { useVenueStream } from '@/components/useVenueStream'
import { DEFAULT_WEIGHTS, triageBucket, triageSummary, type TriageBucket } from '@/lib/ranking'
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
  const [triageFilter, setTriageFilter] = useState<TriageBucket | null>(null)
  // Mobile layout state. On wide screens both are inert — the search panel and
  // the map are always visible side by side. Below `md`, the search panel is an
  // overlay and the results/map share one pane the planner toggles between.
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobilePane, setMobilePane] = useState<'list' | 'map'>('list')
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
      setTriageFilter(null)
      setSearchOpen(false)
      setMobilePane('list')
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

  // "Call these first" triage — orthogonal to the ranking. Groups the same
  // results by whether they can be shortlisted from data alone or need a call.
  const triage = useMemo(() => triageSummary(results), [results])
  const visibleResults = useMemo(
    () => (triageFilter === null ? results : results.filter((r) => triageBucket(r) === triageFilter)),
    [results, triageFilter],
  )

  // Price-coverage honesty. The price axis renormalises to nothing for any venue
  // with no published spend, so when almost none of the results carry one, price
  // did not meaningfully shape the ranking — and we say so rather than let the
  // slider imply otherwise.
  const priceKnownCount = results.filter((r) => r.minSpend.value !== null).length
  const priceCoverage = results.length === 0 ? 0 : priceKnownCount / results.length
  const priceReallyScored = activeParams.budgetCents !== null && priceCoverage >= 0.3

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            className="rounded border border-ink-300 px-2 py-1 text-[11px] font-medium text-ink-700 md:hidden"
            aria-expanded={searchOpen}
          >
            {searchOpen ? 'Close' : 'Search'}
          </button>
          <h1 className="text-sm font-semibold tracking-tight text-ink-900">Private Dining Finder</h1>
          <span className="hidden text-[11px] text-ink-400 sm:inline">
            Ranked venue search with per-field provenance
          </span>
        </div>
        {adapters && (
          <div className="hidden items-center gap-1.5 text-[10px] sm:flex sm:flex-wrap sm:justify-end">
            <AdapterChip label="data" value={adapters.persistence === 'supabase' ? 'Supabase' : 'seed corpus'} live={adapters.persistence === 'supabase'} />
            <AdapterChip label="discovery" value={adapters.discovery === 'google_places' ? 'Places' : 'seed'} live={adapters.discovery === 'google_places'} />
            <AdapterChip label="commute" value={adapters.commute === 'google_routes' ? 'Routes' : 'estimated'} live={adapters.commute === 'google_routes'} />
            <AdapterChip label="extraction" value={adapters.extraction === 'llm' ? 'live' : 'off'} live={adapters.extraction === 'llm'} />
            <AdapterChip label="reputation" value={adapters.reputation === 'yelp' ? 'Yelp' : 'off'} live={adapters.reputation === 'yelp'} />
          </div>
        )}
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* ── Search panel ─────────────────────────────────────────────────
             md+: a static left rail. Below md: an off-canvas overlay toggled from
             the header, with a scrim, so a phone gets the full width for results. */}
        {searchOpen && (
          <button
            type="button"
            aria-label="Close search"
            onClick={() => setSearchOpen(false)}
            className="absolute inset-0 z-30 bg-ink-900/30 md:hidden"
          />
        )}
        <aside
          className={clsx(
            'scroll-thin overflow-y-auto border-r border-ink-200 bg-ink-50/60 p-4',
            // md+: always-visible fixed-width rail.
            'md:w-[340px] md:shrink-0 md:translate-x-0',
            // below md: fixed overlay that slides in when open.
            'absolute inset-y-0 left-0 z-40 w-[85%] max-w-[340px] transition-transform md:static md:z-auto',
            searchOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full md:translate-x-0',
          )}
        >
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
                    <span
                      className="text-ink-500"
                      title="“Verified” means the capacity figure came from an authoritative source we can cite (the venue’s own page or a structured partner listing) — not that we re-confirmed the number is current."
                    >
                      {' '}
                      · {verifiedCount} with verified capacity
                      {unknownCount > 0 && ` · ${unknownCount} needing a call`}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-ink-400">
                  {bandExplanation(activeParams.headcount, activeParams.eventStyle)}
                </p>
                {results.length > 0 && !priceReallyScored && (
                  <p className="mt-0.5 text-[11px] text-amber-700">
                    {activeParams.budgetCents === null
                      ? 'No budget set — price is not part of this ranking.'
                      : `Only ${priceKnownCount} of ${results.length} venues publish a minimum spend — price barely shaped this ranking. Treat it as a “call to confirm” field, not a filter.`}
                  </p>
                )}

                {/* ── Call these first: triage by whether a venue can be acted on from data ── */}
                {results.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-ink-400">Triage:</span>
                    <button
                      type="button"
                      onClick={() => setTriageFilter((f) => (f === 'ready' ? null : 'ready'))}
                      title="Capacity is verified and the venue has a phone or email on file — enough to shortlist from data alone."
                      className={clsx(
                        'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                        triageFilter === 'ready'
                          ? 'border-trust-verified bg-trust-verified/10 text-trust-verified'
                          : 'border-ink-200 text-ink-600 hover:border-trust-verified/50',
                      )}
                    >
                      {triage.ready} bookable from data
                    </button>
                    <button
                      type="button"
                      onClick={() => setTriageFilter((f) => (f === 'call' ? null : 'call'))}
                      title="Capacity is inferred, or there is no verified contact — the honest next step is a phone call to confirm."
                      className={clsx(
                        'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                        triageFilter === 'call'
                          ? 'border-amber-500 bg-amber-50 text-amber-800'
                          : 'border-ink-200 text-ink-600 hover:border-amber-400',
                      )}
                    >
                      {triage.call} need a call
                    </button>
                    {triageFilter !== null && (
                      <button
                        type="button"
                        onClick={() => setTriageFilter(null)}
                        className="text-[11px] text-ink-400 underline underline-offset-2 hover:text-ink-600"
                      >
                        clear
                      </button>
                    )}
                  </div>
                )}
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

          {/* Mobile-only List / Map switch. Hidden at md+, where both panes show. */}
          <div className="flex shrink-0 gap-1 border-b border-ink-200 bg-white px-3 py-1.5 md:hidden">
            {(['list', 'map'] as const).map((pane) => (
              <button
                key={pane}
                type="button"
                onClick={() => setMobilePane(pane)}
                className={clsx(
                  'flex-1 rounded px-2 py-1 text-[11px] font-medium capitalize transition-colors',
                  mobilePane === pane ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600',
                )}
              >
                {pane === 'list' ? `List (${results.length})` : 'Map'}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1">
            <div
              ref={listRef}
              onScroll={markEngaged}
              className={clsx(
                'scroll-thin space-y-2.5 overflow-y-auto bg-ink-50/40 p-3',
                // md+: fixed-width rail alongside the map.
                'md:block md:w-[440px] md:shrink-0',
                // below md: full width, shown only when the List pane is active.
                'w-full',
                mobilePane === 'list' ? 'block' : 'hidden',
              )}
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

              {triageFilter !== null && visibleResults.length === 0 && (
                <p className="rounded border border-ink-200 bg-white px-3 py-2 text-xs text-ink-500">
                  No venues in this bucket. <button type="button" onClick={() => setTriageFilter(null)} className="underline underline-offset-2">Show all</button>
                </p>
              )}

              {visibleResults.map((r) => (
                <VenueCard
                  key={r.record.venue.id}
                  result={r}
                  rank={results.indexOf(r) + 1}
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

            <div
              className={clsx(
                'isolate min-w-0 flex-1',
                // below md: shown only when the Map pane is active.
                mobilePane === 'map' ? 'block' : 'hidden md:block',
              )}
            >
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
