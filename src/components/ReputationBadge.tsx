'use client'

import clsx from 'clsx'
import type { YelpReputation } from '@/lib/types'
import { TrustBadge } from './TrustBadge'

/**
 * Third-party reputation, from Yelp.
 *
 * Yelp is an aggregator, so this whole block carries a `likely` trust label —
 * it is a real signal from a third party, not something the venue published
 * about itself, and not something we verified against a primary source. The
 * rating and review count are shown together because a 4.5 from 12 reviews and
 * a 4.5 from 4,000 are not the same claim. Price tier is Yelp's coarse $–$$$$,
 * kept visually distinct from the minimum-spend figure, which is a different and
 * more specific thing.
 */
export function ReputationBadge({ yelp, compact = false }: { yelp: YelpReputation; compact?: boolean }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-2 gap-y-1', compact ? 'text-[11px]' : 'text-xs')}>
      <span className="inline-flex items-center gap-1 font-semibold text-ink-900">
        <span aria-hidden className="text-[#e8a13a]">
          ★
        </span>
        <span className="tabular">{yelp.rating.toFixed(1)}</span>
      </span>
      <span className="tabular text-ink-500">
        {yelp.reviewCount.toLocaleString()} review{yelp.reviewCount === 1 ? '' : 's'}
      </span>
      {yelp.priceLabel && <span className="tabular font-medium text-ink-700">{yelp.priceLabel}</span>}
      <TrustBadge
        size="xs"
        trust="likely"
        title={`Yelp rating — a third-party aggregator, matched ${yelp.matchDistanceMeters} m from this venue. Not a figure the venue published about itself.`}
      />
      {yelp.url && !compact && (
        <a
          href={yelp.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[11px] text-meter-fill underline underline-offset-2 hover:text-meter-strong"
        >
          Yelp
        </a>
      )}
    </div>
  )
}

/**
 * The honest rendering of "no Yelp rating shown" — but only for the states worth
 * telling the planner about. A rate-limit is temporary and retryable; saying so
 * is very different from implying the venue has no reputation. 'no_match',
 * 'unavailable', and 'off' are deliberately silent: a missing match is not a
 * signal, and a disabled adapter is not news.
 */
export function ReputationStatus({
  status,
  compact = false,
}: {
  status: 'matched' | 'no_match' | 'rate_limited' | 'unavailable' | 'off'
  compact?: boolean
}) {
  if (status !== 'rate_limited') return null
  return (
    <span
      className={clsx('inline-flex items-center gap-1 text-ink-400', compact ? 'text-[11px]' : 'text-xs')}
      title="Yelp rate-limited this lookup — the reputation is temporarily unavailable, not absent. Re-run the search in a moment."
    >
      <span aria-hidden className="text-[#e8a13a]">
        ★
      </span>
      Yelp rating rate-limited — try again shortly
    </span>
  )
}
