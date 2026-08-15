import type {
  CapacityAssessment,
  CommuteResult,
  RankedResult,
  RankingWeights,
  ResolvedFact,
  ScoreComponent,
  SearchParams,
  VenueRecord,
} from './types'
import { assessCapacity } from './capacity'
import { resolveNumericFact, resolveStringFact, weakest } from './trust'

// ─────────────────────────────────────────────────────────────────────────────
// Ranking.
//
// Three scored axes: capacity fit, commute, price fit. Weights are exposed to
// the planner as a priority control rather than hardcoded, because "best fit"
// means different things to someone booking a board dinner and someone booking
// an all-hands.
//
// Confidence is deliberately ABSENT from the score. An earlier revision folded
// it in as a multiplier, which quietly optimises for the quality of a
// restaurant's web presence — burying an excellent venue with an opaque site
// beneath a mediocre one with a good events page. That is not the thing the
// planner is shopping for. Trust is surfaced as a badge, a filter, and an
// optional secondary sort, so the planner decides how much risk to carry.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_WEIGHTS: RankingWeights = { capacity: 0.5, commute: 0.35, price: 0.15 }

/**
 * Asymmetric capacity fit.
 *
 * A room 30% too big is worse than one 10% too small. Too-small usually means
 * trimming a guest list by a couple of people; too-big means a cavernous room
 * with your thirty guests huddled in one corner, which reads as a planning
 * failure. So the penalty above target decays roughly 2.5x faster than below.
 */
export function capacityFitScore(capacity: number, headcount: number): number {
  if (headcount <= 0) return 0
  const ratio = (capacity - headcount) / headcount
  if (ratio >= 0) return Math.exp(-ratio / 0.6) // 10% over -> 0.85, 50% over -> 0.43
  return Math.exp(ratio / 1.5) // 10% under -> 0.94
}

/** Normalised against the planner's STATED maximum, not against the best result in the set. */
export function commuteScore(durationSeconds: number, maxMinutes: number): number {
  const max = Math.max(maxMinutes, 1) * 60
  return Math.max(0, Math.min(1, 1 - durationSeconds / max))
}

/**
 * Price fit. Returns null — meaning "not applicable" — when either the venue's
 * minimum spend or the planner's budget is unknown. A null term is dropped and
 * the remaining weights renormalise, so an opaque website costs a venue
 * nothing. Penalising unknowns would systematically bury good venues for the
 * crime of not publishing their F&B minimum.
 */
export function priceFitScore(minSpendCents: number | null, budgetCents: number | null): number | null {
  if (minSpendCents === null || budgetCents === null || budgetCents <= 0) return null
  const ratio = minSpendCents / budgetCents
  if (ratio <= 1) return 1
  return Math.max(0, Math.exp(-(ratio - 1) / 0.35))
}

function combine(components: ScoreComponent[]): number {
  const active = components.filter((c) => c.score !== null && c.weight > 0)
  const totalWeight = active.reduce((s, c) => s + c.weight, 0)
  if (totalWeight === 0) return 0
  return active.reduce((s, c) => s + c.weight * (c.score as number), 0) / totalWeight
}

function minSpendOf(record: VenueRecord, assessment: CapacityAssessment): ResolvedFact<number> {
  const spaceIds = assessment.best ? assessment.best.spaces.map((s) => s.id) : []

  // Prefer evidence attached to the rooms actually being recommended.
  const scoped = record.evidence.filter(
    (e) => e.field === 'min_spend' && e.spaceId !== null && spaceIds.includes(e.spaceId),
  )
  if (scoped.length > 0) {
    const fact = resolveNumericFact(scoped)
    return { ...fact, value: fact.value === null ? null : Math.round(fact.value * 100) }
  }

  const anySpend = record.evidence.filter((e) => e.field === 'min_spend')
  if (anySpend.length === 0) {
    // Fall back to a structured column if the seed carried one without evidence.
    const fromColumn = assessment.best?.spaces.find((s) => s.minSpendCents !== null)?.minSpendCents ?? null
    if (fromColumn !== null) {
      return { value: fromColumn, trust: 'unverified', sources: [], conflict: null, unknown: false }
    }
    return { value: null, trust: 'unverified', sources: [], conflict: null, unknown: true }
  }

  const fact = resolveNumericFact(anySpend)
  return { ...fact, value: fact.value === null ? null : Math.round(fact.value * 100) }
}

export function rankVenue(
  record: VenueRecord,
  commute: CommuteResult | null,
  params: SearchParams,
): RankedResult {
  const capacity = assessCapacity(record.spaces, record.evidence, params.headcount, params.eventStyle)
  const minSpend = minSpendOf(record, capacity)

  const phone = resolveStringFact(record.evidence.filter((e) => e.field === 'phone'))
  const email = resolveStringFact(record.evidence.filter((e) => e.field === 'email'))

  const components: ScoreComponent[] = []

  if (capacity.best) {
    const s = capacityFitScore(capacity.best.capacity, params.headcount)
    const slack = capacity.best.capacity - params.headcount
    components.push({
      key: 'capacity',
      score: s,
      weight: params.weights.capacity,
      explanation:
        slack === 0
          ? `Exact fit at ${capacity.best.capacity}.`
          : slack > 0
            ? `${capacity.best.capacity} capacity for ${params.headcount} — ${slack} spare.`
            : `${capacity.best.capacity} capacity for ${params.headcount} — ${Math.abs(slack)} over, would need a small trim.`,
    })
  } else if (capacity.unknown) {
    // Unknown capacity is not scored as bad, it is not scored at all. The venue
    // still appears, flagged, because "call to confirm" beats silent exclusion.
    components.push({
      key: 'capacity',
      score: null,
      weight: params.weights.capacity,
      explanation: 'No published capacity found — call to confirm.',
    })
  } else {
    components.push({
      key: 'capacity',
      score: 0,
      weight: params.weights.capacity,
      explanation: capacity.shortfallReason ?? 'Too small for this group.',
    })
  }

  if (commute) {
    components.push({
      key: 'commute',
      score: commuteScore(commute.durationSeconds, params.maxCommuteMinutes),
      weight: params.weights.commute,
      explanation: `${Math.round(commute.durationSeconds / 60)} min ${params.mode} of a ${params.maxCommuteMinutes} min limit${
        commute.method === 'estimated' ? ' (estimated)' : ''
      }.`,
    })
  } else {
    components.push({
      key: 'commute',
      score: null,
      weight: params.weights.commute,
      explanation: 'Commute could not be computed.',
    })
  }

  const price = priceFitScore(minSpend.value, params.budgetCents)
  components.push({
    key: 'price',
    score: price,
    weight: params.weights.price,
    explanation:
      price === null
        ? minSpend.value === null
          ? 'No published minimum spend — neutral, not penalised.'
          : 'No budget set — price not scored.'
        : `Minimum spend $${Math.round((minSpend.value ?? 0) / 100).toLocaleString()} against a $${Math.round(
            (params.budgetCents ?? 0) / 100,
          ).toLocaleString()} budget.`,
  })

  const trustInputs = [capacity.best?.trust ?? 'unverified']
  if (minSpend.value !== null) trustInputs.push(minSpend.trust)

  return {
    record,
    capacity,
    commute,
    minSpend,
    phone,
    email,
    overallTrust: weakest(trustInputs),
    score: combine(components),
    components,
  }
}

export type SortMode = 'fit' | 'confidence_adjusted' | 'commute' | 'capacity'

const TRUST_FACTOR = { verified: 1, likely: 0.85, unverified: 0.65 } as const

/**
 * Sorting. `fit` is the default and is trust-blind by design. The planner can
 * opt into `confidence_adjusted`, which applies trust as a multiplier — the
 * behaviour we refuse to impose silently, offered explicitly.
 */
export function sortResults(results: RankedResult[], mode: SortMode): RankedResult[] {
  const out = [...results]
  switch (mode) {
    case 'confidence_adjusted':
      return out.sort((a, b) => b.score * TRUST_FACTOR[b.overallTrust] - a.score * TRUST_FACTOR[a.overallTrust])
    case 'commute':
      return out.sort(
        (a, b) => (a.commute?.durationSeconds ?? Infinity) - (b.commute?.durationSeconds ?? Infinity),
      )
    case 'capacity':
      return out.sort((a, b) => (b.capacity.best?.capacity ?? 0) - (a.capacity.best?.capacity ?? 0))
    case 'fit':
    default:
      return out.sort((a, b) => b.score - a.score)
  }
}
