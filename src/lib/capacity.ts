import type {
  CapacityAssessment,
  CapacityConfiguration,
  Evidence,
  EventStyle,
  TrustLabel,
  VenueSpace,
} from './types'
import { resolveNumericFact, weakest } from './trust'

// ─────────────────────────────────────────────────────────────────────────────
// Capacity feasibility.
//
// This is a small solver, not a comparison. The question is not "is
// venue.capacity >= headcount" — it is "is there SOME configuration of this
// venue's rooms that holds the group under the requested event style", and the
// answer a planner wants back is the configuration itself.
//
// Two facts drive the design:
//   1. A room that seats 60 holds ~110 standing. Storing one capacity integer
//      makes the 200-person Waikiki reception return nothing.
//   2. The sum of all a venue's rooms is not a real number. Only rooms that
//      physically open into each other may be added, hence `combinableGroup`.
// ─────────────────────────────────────────────────────────────────────────────

/** Cap on how many rooms we will ask a planner to combine. Beyond three it stops being one event. */
const MAX_COMBINATION_SIZE = 3

/**
 * How much under the headcount we still call feasible. A room 5% small is a
 * real option — planners trim guest lists constantly — and excluding it is how
 * you end up with an empty result page for a 200-person search.
 */
const UNDERSHOOT_TOLERANCE = 0.05

export interface SpaceCapacity {
  value: number | null
  trust: TrustLabel
  degradedFromSeated: boolean
}

/**
 * Effective capacity of one space under an event style.
 *
 * Reception falls back to seated capacity when standing is unpublished. That
 * is a deliberate *under*-estimate — standing capacity is always the larger
 * number — so the fallback can only cost us a false negative, never a false
 * promise. It is flagged so the UI can say so.
 */
export function effectiveCapacity(
  space: VenueSpace,
  style: EventStyle,
  evidence: Evidence[],
): SpaceCapacity {
  const seatedEv = evidence.filter((e) => e.spaceId === space.id && e.field === 'seated_cap')
  const standingEv = evidence.filter((e) => e.spaceId === space.id && e.field === 'standing_cap')

  const seated = resolveNumericFact(seatedEv)
  const standing = resolveNumericFact(standingEv)

  const seatedVal = space.seatedCap ?? seated.value
  const standingVal = space.standingCap ?? standing.value

  if (style === 'seated') {
    return {
      value: seatedVal,
      trust: seatedVal === null ? 'unverified' : seated.unknown ? 'unverified' : seated.trust,
      degradedFromSeated: false,
    }
  }

  // reception | mixed — standing is the right column; seated is the safe floor.
  if (standingVal !== null) {
    return {
      value: standingVal,
      trust: standing.unknown ? 'unverified' : standing.trust,
      degradedFromSeated: false,
    }
  }
  if (seatedVal !== null) {
    return {
      value: seatedVal,
      trust: seated.unknown ? 'unverified' : seated.trust,
      degradedFromSeated: true,
    }
  }
  return { value: null, trust: 'unverified', degradedFromSeated: false }
}

function fits(capacity: number, headcount: number): boolean {
  return capacity >= headcount * (1 - UNDERSHOOT_TOLERANCE)
}

function describe(kind: CapacityConfiguration['kind'], spaces: VenueSpace[], capacity: number, style: EventStyle): string {
  const unit = style === 'seated' ? 'seated' : 'standing'
  if (kind === 'buyout') return `Full buyout — ${capacity} ${unit}`
  if (kind === 'single') return `${spaces[0].name} — ${capacity} ${unit}`
  return `${spaces.map((s) => s.name).join(' + ')} — ${capacity} ${unit} combined`
}

/** All subsets of size 2..MAX within one combinable group. Groups are small; exhaustive is fine. */
function* combinations(spaces: VenueSpace[]): Generator<VenueSpace[]> {
  const n = spaces.length
  for (let size = 2; size <= Math.min(MAX_COMBINATION_SIZE, n); size++) {
    const idx = Array.from({ length: size }, (_, i) => i)
    while (true) {
      yield idx.map((i) => spaces[i])
      let k = size - 1
      while (k >= 0 && idx[k] === n - size + k) k--
      if (k < 0) break
      idx[k]++
      for (let j = k + 1; j < size; j++) idx[j] = idx[j - 1] + 1
    }
  }
}

export function assessCapacity(
  spaces: VenueSpace[],
  evidence: Evidence[],
  headcount: number,
  style: EventStyle,
): CapacityAssessment {
  const withCap = spaces.map((space) => ({ space, cap: effectiveCapacity(space, style, evidence) }))
  const known = withCap.filter((s) => s.cap.value !== null)

  if (known.length === 0) {
    return {
      best: null,
      alternatives: [],
      unknown: true,
      shortfallReason: null,
    }
  }

  const configs: CapacityConfiguration[] = []

  // 1. Single spaces. Includes venue-published composite rows ("Coral I/II") and
  //    the buyout row, because from the planner's side those are one booking.
  for (const { space, cap } of known) {
    if (!fits(cap.value!, headcount)) continue
    configs.push({
      kind: space.isBuyout ? 'buyout' : 'single',
      spaces: [space],
      capacity: cap.value!,
      trust: cap.trust,
      degradedFromSeated: cap.degradedFromSeated,
      label: describe(space.isBuyout ? 'buyout' : 'single', [space], cap.value!, style),
    })
  }

  // 2. Combinations within a shared group. Atomic rooms only — composite rows
  //    already contain their parts, and adding both would double-count.
  const groups = new Map<string, typeof known>()
  for (const entry of known) {
    const g = entry.space.combinableGroup
    if (!g || entry.space.isComposite || entry.space.isBuyout) continue
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(entry)
  }

  // A group's published parent row ("Coral Ballroom", "Diamond Head Ballroom
  // (full)") is a physical CEILING: subsections cannot be combined into more
  // than the whole room they subdivide. Without this, a venue listing "3
  // sections" and "2 sections" of one ballroom appears to hold the sum of both.
  const groupCeiling = new Map<string, number>()
  for (const { space, cap } of known) {
    const g = space.combinableGroup
    if (!g || !space.isComposite || cap.value === null) continue
    groupCeiling.set(g, Math.max(groupCeiling.get(g) ?? 0, cap.value))
  }

  for (const [groupKey, members] of groups.entries()) {
    if (members.length < 2) continue
    const ceiling = groupCeiling.get(groupKey) ?? Infinity
    for (const combo of combinations(members.map((m) => m.space))) {
      const caps = combo.map((s) => known.find((k) => k.space.id === s.id)!.cap)
      const total = caps.reduce((sum, c) => sum + (c.value ?? 0), 0)
      if (total > ceiling) continue
      if (!fits(total, headcount)) continue
      configs.push({
        kind: 'combination',
        spaces: combo,
        capacity: total,
        trust: weakest(caps.map((c) => c.trust)),
        degradedFromSeated: caps.some((c) => c.degradedFromSeated),
        label: describe('combination', combo, total, style),
      })
    }
  }

  if (configs.length === 0) {
    const largest = Math.max(...known.map((k) => k.cap.value!))
    return {
      best: null,
      alternatives: [],
      unknown: false,
      shortfallReason: `Largest available configuration holds ${largest}; you need ${headcount}.`,
    }
  }

  // Prefer the tightest fit. Break ties toward fewer moving parts: one room beats
  // two rooms beats taking over the whole building, at equal capacity.
  const kindPenalty: Record<CapacityConfiguration['kind'], number> = { single: 0, combination: 1, buyout: 2 }
  configs.sort((a, b) => {
    const slackA = a.capacity - headcount
    const slackB = b.capacity - headcount
    // Configurations that are actually big enough beat ones relying on the
    // undershoot tolerance, regardless of tightness.
    const shortA = slackA < 0 ? 1 : 0
    const shortB = slackB < 0 ? 1 : 0
    if (shortA !== shortB) return shortA - shortB
    if (Math.abs(slackA) !== Math.abs(slackB)) return Math.abs(slackA) - Math.abs(slackB)
    return kindPenalty[a.kind] - kindPenalty[b.kind]
  })

  // Deduplicate labels so the drawer does not list five near-identical combos.
  const seen = new Set<string>()
  const unique = configs.filter((c) => {
    const key = c.spaces.map((s) => s.id).sort().join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    best: unique[0],
    alternatives: unique.slice(1, 6),
    unknown: false,
    shortfallReason: null,
  }
}
