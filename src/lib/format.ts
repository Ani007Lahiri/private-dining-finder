import type { CommuteMode, MinSpendPeriod } from './types'

export function minutes(seconds: number): string {
  const m = Math.round(seconds / 60)
  return m < 1 ? '<1 min' : `${m} min`
}

export function distance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`
  return `${(meters / 1000).toFixed(1)} km`
}

export function miles(meters: number): string {
  const mi = meters / 1609.344
  return mi < 0.15 ? `${Math.round(meters * 3.28084)} ft` : `${mi.toFixed(1)} mi`
}

export function money(cents: number | null): string {
  if (cents === null) return '—'
  const dollars = cents / 100
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars % 1000 === 0 ? 0 : 1)}k`
  return `$${Math.round(dollars).toLocaleString()}`
}

export function spendPeriod(period: MinSpendPeriod | null): string {
  switch (period) {
    case 'f_and_b':
      return 'F&B minimum'
    case 'per_event':
      return 'event fee'
    case 'per_hour':
      return 'per hour'
    default:
      return 'minimum spend'
  }
}

export function modeVerb(mode: CommuteMode): string {
  return mode === 'walking' ? 'walk' : 'drive'
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 40)
  }
}

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

/**
 * A compact, human one-liner explaining a result's rank, condensed from the same
 * ScoreComponent values the drawer breakdown renders in full. The card shows this
 * so a planner sees the reasoning without opening the drawer; the drawer keeps the
 * per-axis meters. Kept to the axes that carry signal — a dropped (null) term is
 * summarised as "not scored" rather than silently omitted, so the planner can tell
 * a missing price from a bad one.
 */
export function rankRationale(
  components: Array<{ key: 'capacity' | 'commute' | 'price'; score: number | null }>,
  mode: CommuteMode,
): string {
  const parts: string[] = []
  for (const c of components) {
    if (c.key === 'capacity') {
      if (c.score === null) parts.push('capacity needs a call')
      else if (c.score >= 0.85) parts.push('strong capacity fit')
      else if (c.score >= 0.55) parts.push('workable capacity fit')
      else parts.push('tight capacity fit')
    } else if (c.key === 'commute') {
      if (c.score === null) parts.push('commute unknown')
      else if (c.score >= 0.66) parts.push(`well within ${mode === 'walking' ? 'walk' : 'drive'} limit`)
      else if (c.score >= 0.33) parts.push(`inside ${mode === 'walking' ? 'walk' : 'drive'} limit`)
      else parts.push(`near ${mode === 'walking' ? 'walk' : 'drive'} limit`)
    } else if (c.key === 'price') {
      if (c.score === null) parts.push('price not scored')
      else if (c.score >= 0.85) parts.push('within budget')
      else parts.push('over budget')
    }
  }
  return parts.join(' · ')
}
