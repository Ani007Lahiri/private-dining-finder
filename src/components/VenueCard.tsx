'use client'

import clsx from 'clsx'
import type { RankedResult, SearchParams } from '@/lib/types'
import { TrustBadge } from './TrustBadge'
import { ReputationBadge } from './ReputationBadge'
import { minutes, miles, money, modeVerb, pct } from '@/lib/format'

export function VenueCard({
  result,
  rank,
  params,
  pinned,
  onTogglePin,
  onOpen,
  onHover,
  highlighted,
}: {
  result: RankedResult
  rank: number
  params: SearchParams
  pinned: boolean
  onTogglePin: () => void
  onOpen: () => void
  onHover: (id: string | null) => void
  highlighted: boolean
}) {
  const { venue } = result.record
  const config = result.capacity.best

  return (
    <article
      onMouseEnter={() => onHover(venue.id)}
      onMouseLeave={() => onHover(null)}
      className={clsx(
        'animate-in-row rounded-lg border bg-white p-3.5 transition',
        highlighted ? 'border-meter-fill shadow-sm' : 'border-ink-200 hover:border-ink-300',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                'tabular inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold',
                rank <= 3 ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-500',
              )}
            >
              {rank}
            </span>
            <button
              onClick={onOpen}
              className="truncate text-left text-[15px] font-semibold text-ink-900 hover:text-meter-fill hover:underline"
            >
              {venue.name}
            </button>
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-500">{venue.address}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-400">
            {venue.venueKind.replace('_', ' ')}
            {venue.cuisine ? ` · ${venue.cuisine}` : ''}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <span
            title="Overall fit score"
            className="tabular rounded bg-ink-900 px-1.5 py-0.5 text-[11px] font-semibold text-white"
          >
            {pct(result.score)}
          </span>
          <button
            onClick={onTogglePin}
            title={pinned ? 'Remove from comparison' : 'Add to comparison'}
            className={clsx(
              'rounded border px-1.5 py-0.5 text-[11px] transition',
              pinned
                ? 'border-meter-fill bg-blue-50 text-meter-strong'
                : 'border-ink-200 text-ink-500 hover:border-ink-400 hover:text-ink-800',
            )}
          >
            {pinned ? '✓ Compared' : '+ Compare'}
          </button>
        </div>
      </div>

      {/* ── The three facts a planner scans for ─────────────────────────── */}
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-ink-100 pt-2.5">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-ink-400">Space</dt>
          <dd className="mt-0.5">
            {config ? (
              <>
                <span className="tabular block text-sm font-semibold text-ink-900">
                  {config.capacity}
                  <span className="ml-1 text-[11px] font-normal text-ink-500">
                    {params.eventStyle === 'seated' ? 'seated' : 'standing'}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-ink-600" title={config.label}>
                  {config.kind === 'buyout'
                    ? 'Full buyout'
                    : config.kind === 'combination'
                      ? config.spaces.map((s) => s.name).join(' + ')
                      : config.spaces[0].name}
                </span>
                <TrustBadge size="xs" trust={config.trust} className="mt-1" />
              </>
            ) : (
              <>
                <span className="block text-sm font-semibold text-ink-400">Unknown</span>
                <span className="mt-0.5 block text-[11px] text-ink-500">Not published</span>
                <TrustBadge size="xs" trust="unverified" className="mt-1" />
              </>
            )}
          </dd>
        </div>

        <div>
          <dt className="text-[10px] uppercase tracking-wide text-ink-400">{modeVerb(params.mode)}</dt>
          <dd className="mt-0.5">
            {result.commute ? (
              <>
                <span className="tabular block text-sm font-semibold text-ink-900">
                  {minutes(result.commute.durationSeconds)}
                </span>
                <span className="tabular mt-0.5 block text-[11px] text-ink-600">
                  {miles(result.commute.distanceMeters)}
                </span>
                <TrustBadge
                  size="xs"
                  trust={result.commute.trust}
                  className="mt-1"
                  title={
                    result.commute.method === 'measured'
                      ? 'Measured with the Routes API.'
                      : 'Straight-line estimate with a street-detour factor — no Routes API key configured.'
                  }
                />
              </>
            ) : (
              <span className="block text-sm text-ink-400">—</span>
            )}
          </dd>
        </div>

        <div>
          <dt className="text-[10px] uppercase tracking-wide text-ink-400">Min spend</dt>
          <dd className="mt-0.5">
            {result.minSpend.value !== null ? (
              <>
                <span className="tabular block text-sm font-semibold text-ink-900">
                  {money(result.minSpend.value)}
                </span>
                <span className="mt-0.5 block text-[11px] text-ink-600">
                  {result.minSpend.conflict ? 'sources disagree' : 'published'}
                </span>
                <TrustBadge size="xs" trust={result.minSpend.trust} className="mt-1" />
              </>
            ) : (
              <>
                <span className="block text-sm font-semibold text-ink-400">Unknown</span>
                <span className="mt-0.5 block text-[11px] text-ink-500">Not published</span>
                <TrustBadge size="xs" trust="unverified" className="mt-1" />
              </>
            )}
          </dd>
        </div>
      </dl>

      {config?.degradedFromSeated && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900">
          Standing capacity is not published for this space. Showing the seated figure as a conservative floor — the
          real reception capacity is almost certainly higher.
        </p>
      )}

      {result.capacity.unknown && (
        <p className="mt-2 rounded bg-ink-50 px-2 py-1 text-[11px] leading-snug text-ink-600">
          This venue looks plausible but publishes no capacity. Kept in the list rather than dropped — you may want to
          call.
        </p>
      )}

      {result.yelp && (
        <div className="mt-2 border-t border-ink-100 pt-2">
          <ReputationBadge yelp={result.yelp} compact />
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-100 pt-2 text-[11px]">
        {(result.phone.value ?? venue.phone) && (
          <a href={`tel:${result.phone.value ?? venue.phone}`} className="text-ink-600 hover:text-ink-900">
            {result.phone.value ?? venue.phone}
          </a>
        )}
        {(result.email.value ?? venue.email) && (
          <a
            href={`mailto:${result.email.value ?? venue.email}`}
            className="truncate text-ink-600 hover:text-ink-900"
          >
            {result.email.value ?? venue.email}
          </a>
        )}
        <button onClick={onOpen} className="ml-auto font-medium text-meter-fill hover:text-meter-strong">
          Rooms, evidence & score →
        </button>
      </div>
    </article>
  )
}
