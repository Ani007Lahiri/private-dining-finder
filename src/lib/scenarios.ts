import type { CommuteMode, EventStyle } from './types'

/**
 * The three scenarios the brief requires. Wired as one-click presets so a
 * reviewer can reproduce each in a single interaction rather than retyping an
 * address and remembering that the third one is a walk, not a drive.
 */
export interface Scenario {
  id: string
  label: string
  address: string
  lat: number
  lng: number
  headcount: number
  maxCommuteMinutes: number
  mode: CommuteMode
  eventStyle: EventStyle
  /** Why this one is interesting — shown under the preset. */
  note: string
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'times-square',
    label: 'Times Square, New York',
    address: 'Times Square, New York, NY 10036',
    lat: 40.758,
    lng: -73.9855,
    headcount: 50,
    maxCommuteMinutes: 20,
    mode: 'walking',
    eventStyle: 'seated',
    note: '50 seated, 20 min. Mid-band: restaurant private rooms and buyouts.',
  },
  {
    id: 'salesforce-tower',
    label: 'Salesforce Tower, San Francisco',
    address: '415 Mission St, San Francisco, CA 94105',
    lat: 37.7897,
    lng: -122.3972,
    headcount: 30,
    maxCommuteMinutes: 15,
    mode: 'walking',
    eventStyle: 'seated',
    note: '30 seated, 15 min. Intimate band: private rooms, chef’s tables, wine cellars.',
  },
  {
    id: 'waikiki',
    label: 'Hilton Hawaiian Village, Waikiki',
    address: '2005 Kalia Rd, Honolulu, HI 96815',
    lat: 21.2825,
    lng: -157.8375,
    headcount: 200,
    maxCommuteMinutes: 15,
    mode: 'walking',
    eventStyle: 'reception',
    note: '200 standing, 15 min walk. Large band — ballrooms and resort lawns, not restaurants.',
  },
]

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id)
}
