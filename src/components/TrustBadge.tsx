'use client'

import clsx from 'clsx'
import type { Evidence, TrustLabel } from '@/lib/types'
import { TRUST_COPY } from '@/lib/trust'
import { hostOf } from '@/lib/format'

/**
 * Trust badge.
 *
 * Colour is never the only channel: every badge carries a shape glyph AND a
 * text label. That is a requirement of the status palette (yellow sits below
 * 3:1 on a light surface), and it is also just correct — a planner scanning a
 * list should not have to remember what amber meant.
 */

const GLYPH: Record<TrustLabel, string> = {
  verified: '●',
  likely: '◐',
  unverified: '○',
}

const STYLES: Record<TrustLabel, string> = {
  verified: 'border-trust-verified/45 text-emerald-900 bg-emerald-50',
  likely: 'border-trust-likely/60 text-amber-900 bg-amber-50',
  unverified: 'border-trust-unverified/40 text-rose-900 bg-rose-50',
}

const DOT: Record<TrustLabel, string> = {
  verified: 'text-trust-verified',
  likely: 'text-[#b07d00]', // darkened warning for legibility as inline text
  unverified: 'text-trust-unverified',
}

export function TrustBadge({
  trust,
  size = 'sm',
  className,
  title,
}: {
  trust: TrustLabel
  size?: 'xs' | 'sm'
  className?: string
  title?: string
}) {
  const copy = TRUST_COPY[trust]
  return (
    <span
      title={title ?? copy.hint}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap',
        size === 'xs' ? 'px-1.5 py-[1px] text-[10px]' : 'px-2 py-0.5 text-[11px]',
        STYLES[trust],
        className,
      )}
    >
      <span aria-hidden className={clsx('leading-none', DOT[trust])}>
        {GLYPH[trust]}
      </span>
      {copy.label}
    </span>
  )
}

/**
 * The citation list behind a fact. This is the feature that makes the trust
 * label mean something: a planner can read the exact sentence and decide for
 * themselves rather than taking our word for it.
 */
export function EvidenceList({ sources, conflict }: { sources: Evidence[]; conflict?: string[] | null }) {
  if (sources.length === 0) {
    return <p className="text-xs text-ink-500">No source found — this figure is not published anywhere we could read.</p>
  }

  return (
    <div className="space-y-2">
      {conflict && conflict.length > 1 && (
        <p className="rounded border border-trust-unverified/30 bg-rose-50 px-2 py-1.5 text-xs text-rose-900">
          <strong className="font-semibold">Sources disagree:</strong> {conflict.join(' vs ')}. Both are shown below.
          Confirm before quoting either.
        </p>
      )}
      <ul className="space-y-2">
        {sources.map((e) => (
          <li key={e.id} className="border-l-2 border-ink-200 pl-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="tabular text-xs font-semibold text-ink-900">{e.value}</span>
              <TrustBadge size="xs" trust={trustFromEvidence(e)} />
              <span className="text-[10px] uppercase tracking-wide text-ink-400">{e.sourceClass.replace('_', ' ')}</span>
            </div>
            {e.snippet && <p className="mt-1 text-xs italic leading-snug text-ink-600">“{e.snippet}”</p>}
            {e.sourceUrl && (
              <a
                href={e.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 inline-block text-[11px] text-meter-fill underline underline-offset-2 hover:text-meter-strong"
              >
                {hostOf(e.sourceUrl)}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function trustFromEvidence(e: Evidence): TrustLabel {
  if (e.extractor === 'heuristic' || e.sourceClass === 'heuristic') return 'unverified'
  if (e.extractor === 'explicit' && (e.sourceClass === 'venue_domain' || e.sourceClass === 'partner_listing')) {
    return 'verified'
  }
  return 'likely'
}
