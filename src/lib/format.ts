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
