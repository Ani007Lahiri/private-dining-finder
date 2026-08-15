import type { EventStyle } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Discovery query templating.
//
// The single most important correctness fix between the first and second cut of
// this design. Two hundred people for a reception is NOT a restaurant search.
// Querying "private dining rooms near Waikiki" returns izakayas with eight-top
// back rooms. The venues that actually hold 200 standing are hotel ballrooms,
// resort lawns, event spaces and beach clubs — a different noun entirely.
//
// So the query set branches on headcount band, and event style modifies it.
// ─────────────────────────────────────────────────────────────────────────────

export type HeadcountBand = 'intimate' | 'mid' | 'large'

export function bandFor(headcount: number): HeadcountBand {
  if (headcount <= 40) return 'intimate'
  if (headcount <= 100) return 'mid'
  return 'large'
}

const BAND_QUERIES: Record<HeadcountBand, string[]> = {
  intimate: [
    'restaurant with private dining room',
    "chef's table restaurant",
    'wine cellar private dining',
    'private room for small group dinner',
  ],
  mid: [
    'restaurant private event buyout',
    'brewery taproom private events',
    'gallery space event rental',
    'private dining room large party',
  ],
  large: [
    'hotel ballroom events',
    'event venue large group',
    'rooftop bar private events',
    'beach club private events',
    'museum event rental',
    'conference and banquet centre',
  ],
}

const STYLE_QUERIES: Record<EventStyle, string[]> = {
  seated: ['private dining seated dinner'],
  reception: ['cocktail reception venue', 'happy hour buyout venue', 'standing reception space'],
  mixed: ['private event space food and drinks'],
}

/** Venue kinds worth keeping for a band. Filters obvious Places noise. */
export const BAND_PLACE_TYPES: Record<HeadcountBand, string[]> = {
  intimate: ['restaurant', 'bar', 'cafe'],
  mid: ['restaurant', 'bar', 'event_venue', 'banquet_hall'],
  large: ['event_venue', 'banquet_hall', 'hotel', 'convention_center', 'bar', 'restaurant'],
}

export function discoveryQueries(headcount: number, style: EventStyle, locality: string): string[] {
  const band = bandFor(headcount)
  const base = [...BAND_QUERIES[band], ...STYLE_QUERIES[style]]
  return base.map((q) => `${q} near ${locality}`)
}

/**
 * Human-readable explanation of the branch taken. Rendered in the UI, because a
 * planner who can see "searching hotel ballrooms and event spaces, not
 * restaurants" understands immediately why the results look the way they do.
 */
export function bandExplanation(headcount: number, style: EventStyle): string {
  const band = bandFor(headcount)
  const styleNote =
    style === 'reception'
      ? ' Reception style, so standing capacity is the figure being tested.'
      : style === 'seated'
        ? ' Seated dinner, so seated capacity is the figure being tested.'
        : ' Mixed format, so standing capacity is tested where published.'

  switch (band) {
    case 'intimate':
      return `${headcount} guests: searching restaurants with private rooms, chef's tables and wine cellars.${styleNote}`
    case 'mid':
      return `${headcount} guests: searching restaurant buyouts, taprooms and gallery spaces.${styleNote}`
    case 'large':
      return `${headcount} guests: searching hotel ballrooms, event venues, rooftops and beach clubs — not restaurant private rooms, which top out well below this.${styleNote}`
  }
}
