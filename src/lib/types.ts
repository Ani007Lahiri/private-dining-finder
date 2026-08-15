// ─────────────────────────────────────────────────────────────────────────────
// Domain types.
//
// The organising idea: a venue's facts are not stored as plain columns that we
// trust implicitly. Every fact that could be wrong — capacity, minimum spend,
// contact details — is backed by one or more `Evidence` rows, and its trust
// label is *derived* from that evidence rather than written by hand.
// ─────────────────────────────────────────────────────────────────────────────

/** Where a fact came from. Ordering matters — see SOURCE_CLASS_RANK in trust.ts. */
export type SourceClass =
  | 'venue_domain' // the venue's own website — highest authority
  | 'partner_listing' // Tripleseat / EventUp / PartySlate / Cvent structured listing
  | 'aggregator' // Yelp, TripAdvisor, OpenTable, press and blog roundups
  | 'heuristic' // we inferred it; nobody published this number

/** How the value was pulled out of that source. */
export type Extractor =
  | 'explicit' // a literal number appeared: "seats 60"
  | 'prose_inference' // inferred from language: "accommodates large groups"
  | 'heuristic' // estimated from floor area, seat counts, venue class

/** The label the planner actually sees. Derived, never assigned directly. */
export type TrustLabel = 'verified' | 'likely' | 'unverified'

export type VenueKind = 'restaurant' | 'hotel' | 'event_space' | 'bar' | 'museum' | 'rooftop'

/** Seated dinner, standing reception, or a mix. Selects which capacity column is tested. */
export type EventStyle = 'seated' | 'reception' | 'mixed'

export type CommuteMode = 'walking' | 'driving'

export type MinSpendPeriod = 'per_event' | 'per_hour' | 'f_and_b'

export type EvidenceField =
  | 'seated_cap'
  | 'standing_cap'
  | 'min_spend'
  | 'phone'
  | 'email'
  | 'address'

export interface Evidence {
  id: string
  venueId: string
  spaceId: string | null
  field: EvidenceField
  /** Stored as text so one table serves numeric and string facts alike. */
  value: string
  sourceUrl: string
  sourceClass: SourceClass
  /** The sentence we read it from. Shown verbatim in the UI so a planner can judge for themselves. */
  snippet: string
  extractor: Extractor
  extractedAt: string
}

export interface VenueSpace {
  id: string
  venueId: string
  name: string
  seatedCap: number | null
  standingCap: number | null
  /** True for the "entire restaurant" / "full resort buyout" row. */
  isBuyout: boolean
  /**
   * Rooms that physically open into one another share a group key. Only spaces
   * within the same group may be summed. The sum of *all* a venue's rooms is
   * almost never a real number — airwalls exist, kitchens don't move.
   */
  combinableGroup: string | null
  /**
   * True when this row already represents a combination the venue publishes
   * ("Coral I/II combined"). Composite rows are offered as single-space options
   * but excluded from the solver's own combination search, or we'd double-count.
   */
  isComposite: boolean
  minSpendCents: number | null
  minSpendPeriod: MinSpendPeriod | null
}

export interface Venue {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  /** True when coordinates were approximated rather than geocoded. */
  latlngApproximate: boolean
  phone: string | null
  email: string | null
  website: string | null
  eventsUrl: string | null
  cuisine: string | null
  venueKind: VenueKind
  /** Free-text caveats worth showing a planner. */
  notes: string | null
}

/** A venue with everything hanging off it. The unit the repo layer returns. */
export interface VenueRecord {
  venue: Venue
  spaces: VenueSpace[]
  evidence: Evidence[]
}

// ── Resolved facts ───────────────────────────────────────────────────────────

/**
 * A fact after evidence resolution: the winning value, the trust label that
 * falls out of its provenance, the sources behind it, and — when sources
 * materially disagree — the losing value too. Disagreement is not noise to be
 * hidden; it is precisely the signal that tells a planner to pick up the phone.
 */
export interface ResolvedFact<T> {
  value: T | null
  trust: TrustLabel
  sources: Evidence[]
  conflict: {
    values: string[]
    sources: Evidence[]
  } | null
  /** Set when there is no evidence at all. Distinct from a low-trust value. */
  unknown: boolean
}

// ── Capacity feasibility ─────────────────────────────────────────────────────

export type ConfigurationKind =
  | 'single' // one room fits
  | 'combination' // two or more rooms in the same combinable group, opened up
  | 'buyout' // the whole venue

/**
 * The solver's answer. Deliberately not a boolean: "fits 200" is much less
 * useful to a planner than "fits 200 if you take both salons".
 */
export interface CapacityConfiguration {
  kind: ConfigurationKind
  spaces: VenueSpace[]
  /** Effective capacity of this configuration under the requested event style. */
  capacity: number
  /** Weakest trust among the contributing capacity facts. */
  trust: TrustLabel
  /** True when standing capacity was unpublished and seated was used as a floor. */
  degradedFromSeated: boolean
  label: string
}

export interface CapacityAssessment {
  /** Best configuration found, or null. */
  best: CapacityConfiguration | null
  /** Alternatives, best-first, for the detail drawer. */
  alternatives: CapacityConfiguration[]
  /**
   * True when the venue publishes no usable capacity at all. Such venues are
   * NOT dropped — a venue shown as "capacity unknown, call to confirm" is more
   * useful than one shown with a confident wrong number, and far more useful
   * than one silently missing.
   */
  unknown: boolean
  /** Populated when capacity is known and nothing fits. */
  shortfallReason: string | null
}

// ── Commute ──────────────────────────────────────────────────────────────────

export interface CommuteResult {
  mode: CommuteMode
  durationSeconds: number
  distanceMeters: number
  /**
   * `measured` came from the Routes API. `estimated` is straight-line distance
   * times a street-detour factor — good enough to rank, not good enough to
   * promise. It carries a `likely` trust label for the same reason capacity does.
   */
  method: 'measured' | 'estimated'
  trust: TrustLabel
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface SearchParams {
  address: string
  lat: number
  lng: number
  headcount: number
  maxCommuteMinutes: number
  mode: CommuteMode
  eventStyle: EventStyle
  /** Optional total budget in cents. Absent means the price term drops out entirely. */
  budgetCents: number | null
  weights: RankingWeights
  /** Hide anything whose capacity fact is not `verified`. */
  verifiedCapacityOnly: boolean
  /** Include venues with no capacity data at all. Default true. */
  includeUnknownCapacity: boolean
}

export interface RankingWeights {
  capacity: number
  commute: number
  price: number
}

export interface ScoreComponent {
  key: 'capacity' | 'commute' | 'price'
  /** null means "not applicable / unknown" — the term is dropped and weights renormalised. */
  score: number | null
  weight: number
  explanation: string
}

export interface RankedResult {
  record: VenueRecord
  capacity: CapacityAssessment
  commute: CommuteResult | null
  minSpend: ResolvedFact<number>
  phone: ResolvedFact<string>
  email: ResolvedFact<string>
  /** Weakest trust across the facts a planner would act on. Badge + filter only — never in the score. */
  overallTrust: TrustLabel
  score: number
  components: ScoreComponent[]
  /**
   * Third-party reputation from Yelp, when the adapter is enabled and found a
   * confident match. An aggregator signal, so it carries `likely` trust and is
   * surfaced as display + an optional sort — never folded into the fit score,
   * for the same reason confidence is not: it would optimise for web presence.
   */
  yelp: YelpReputation | null
}

/** Reputation fields lifted from Yelp. Mirrors adapters/yelp.ts YelpEnrichment. */
export interface YelpReputation {
  rating: number
  reviewCount: number
  priceTier: number | null
  priceLabel: string | null
  url: string
  matchDistanceMeters: number
}

// ── Hydration ────────────────────────────────────────────────────────────────

export type HydrationStatus = 'cold' | 'hydrating' | 'warm' | 'stale' | 'unavailable'

export interface HydrationCell {
  geohash5: string
  mode: CommuteMode
  status: HydrationStatus
  venueCount: number
  hydratedAt: string | null
  expiresAt: string | null
  /** Why hydration could not run, when status is `unavailable`. */
  note: string | null
}

/** Events pushed over SSE (and mirrored by Supabase Realtime when configured). */
export type SearchStreamEvent =
  | { type: 'status'; cell: HydrationCell; message: string }
  | { type: 'results'; results: RankedResult[]; total: number }
  | { type: 'appended'; results: RankedResult[]; total: number }
  | { type: 'done'; total: number; elapsedMs: number }
  | { type: 'error'; message: string }
