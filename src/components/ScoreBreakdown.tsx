'use client'

import type { ScoreComponent } from '@/lib/types'
import { pct } from '@/lib/format'

/**
 * Why this venue ranked where it did.
 *
 * "Ranked by fit" is only credible if a planner can see why #2 beat #5, so the
 * components are always available rather than hidden behind a debug flag.
 *
 * Visual form: three horizontal magnitude meters, one sequential hue (blue),
 * thin marks with rounded data-ends on a recessive track, each row directly
 * labelled. Not a categorical palette — these are three measures on one 0–100%
 * scale, so identity is carried by the row label, not by colour.
 */

const LABELS: Record<ScoreComponent['key'], string> = {
  capacity: 'Capacity fit',
  commute: 'Commute',
  price: 'Price fit',
}

export function ScoreBreakdown({ components, total }: { components: ScoreComponent[]; total: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Why this ranked here</span>
        <span className="tabular text-xs text-ink-600">
          overall <strong className="font-semibold text-ink-900">{pct(total)}</strong>
        </span>
      </div>

      <ul className="space-y-1.5">
        {components.map((c) => (
          <li key={c.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-ink-700">{LABELS[c.key]}</span>
              <span className="tabular text-xs text-ink-500">
                {c.score === null ? 'not scored' : pct(c.score)}
              </span>
            </div>

            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-meter-track">
              {c.score !== null ? (
                <div
                  className="h-full rounded-full bg-meter-fill"
                  style={{ width: `${Math.max(2, Math.round(c.score * 100))}%` }}
                />
              ) : (
                // A dropped term reads as absent, not as zero. Zero would be a
                // judgement we have not earned.
                <div className="h-full w-full bg-[repeating-linear-gradient(135deg,#e1e0d9_0_4px,#f2f1ec_4px_8px)]" />
              )}
            </div>

            <p className="mt-0.5 text-[11px] leading-snug text-ink-500">{c.explanation}</p>
          </li>
        ))}
      </ul>

      <p className="pt-0.5 text-[11px] leading-snug text-ink-400">
        Terms that cannot be scored are dropped and the remaining weights renormalise — an unpublished minimum spend
        never counts against a venue. Trust is deliberately not part of this score.
      </p>
    </div>
  )
}
