import type { Evidence, EvidenceField, ResolvedFact, SourceClass, TrustLabel, Extractor } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Trust derivation.
//
// The rule the whole product rests on: a trust label is a *function of
// provenance*, not a column somebody filled in. Given the evidence rows for a
// field, this module decides which value wins, how much to believe it, and
// whether the sources disagree badly enough that the planner should just call.
// ─────────────────────────────────────────────────────────────────────────────

/** Higher wins. Precedence is by source class first — the venue knows its own rooms. */
export const SOURCE_CLASS_RANK: Record<SourceClass, number> = {
  venue_domain: 3,
  partner_listing: 2,
  aggregator: 1,
  heuristic: 0,
}

/** Within a class, an explicit number beats something we inferred from prose. */
const EXTRACTOR_RANK: Record<Extractor, number> = {
  explicit: 2,
  prose_inference: 1,
  heuristic: 0,
}

const TRUST_RANK: Record<TrustLabel, number> = {
  verified: 2,
  likely: 1,
  unverified: 0,
}

/**
 * Two numbers this far apart are treated as a real disagreement rather than
 * rounding. 15% is deliberately loose: "seats 58" vs "seats 60" is the same
 * room described twice, and flagging it would train planners to ignore the flag.
 */
const MATERIAL_DISAGREEMENT = 0.15

export function trustOf(sourceClass: SourceClass, extractor: Extractor): TrustLabel {
  // Anything we made up is unverified no matter how authoritative the page was.
  if (extractor === 'heuristic' || sourceClass === 'heuristic') return 'unverified'

  // An explicit number, published by the venue or a structured partner listing,
  // is the only thing that earns `verified`. You can point at the sentence.
  if (extractor === 'explicit' && (sourceClass === 'venue_domain' || sourceClass === 'partner_listing')) {
    return 'verified'
  }

  // Everything else — prose inference, or an aggregator's number — is `likely`.
  return 'likely'
}

export function weakest(labels: TrustLabel[]): TrustLabel {
  if (labels.length === 0) return 'unverified'
  return labels.reduce((a, b) => (TRUST_RANK[b] < TRUST_RANK[a] ? b : a))
}

export function downgrade(label: TrustLabel): TrustLabel {
  return label === 'verified' ? 'likely' : label === 'likely' ? 'unverified' : 'unverified'
}

function authority(e: Evidence): number {
  // Source class dominates; extractor strength breaks ties inside a class.
  return SOURCE_CLASS_RANK[e.sourceClass] * 10 + EXTRACTOR_RANK[e.extractor]
}

function materiallyDifferent(a: string, b: string, field?: EvidenceField): boolean {
  const na = field ? parseFieldValue(a, field) : parseNumeric(a)
  const nb = field ? parseFieldValue(b, field) : parseNumeric(b)
  if (na !== null && nb !== null) {
    const denom = Math.max(Math.abs(na), Math.abs(nb), 1)
    return Math.abs(na - nb) / denom > MATERIAL_DISAGREEMENT
  }
  return a.trim().toLowerCase() !== b.trim().toLowerCase()
}

export function parseNumeric(value: string): number | null {
  // Handles "230", "$6,000", "up to 120 guests", "1508 reception".
  const cleaned = value.replace(/[$,]/g, '')
  const match = cleaned.match(/-?\d+(\.\d+)?/)
  if (!match) return null
  const n = Number(match[0])
  return Number.isFinite(n) ? n : null
}

/**
 * Field-aware numeric extraction.
 *
 * Evidence values are quoted from real capacity charts, and real capacity
 * charts are compound: "3,528 sq ft, banquet 320, reception 300". Taking the
 * first number in that string yields 3,528 — a square footage rendered as a
 * seated capacity, which is the exact class of confident-but-wrong figure this
 * product exists to prevent. The audit script caught fifteen of these.
 *
 * So the parser is told which field it is reading and looks for the labelled
 * number, falling back to a bare number only when the string is unambiguous.
 */

/** Square footage must be removed before anything else or it wins every match. */
function stripArea(s: string): string {
  return s.replace(/\d+(?:\.\d+)?\s*(?:sq\.?\s*(?:ft|m)|square\s*(?:feet|foot|metres|meters)|ft2|m2)\b/g, ' ')
}

const SEATED_WORDS = String.raw`seated|seating|banquet|sit-?down|dinner|dining|rounds?|theatre|theater|classroom`
const STANDING_WORDS = String.raw`standing|reception|cocktail|flow|mingling`

/** "15-35 seated" means 35 — the ceiling is the capacity. */
function pickFromRange(match: RegExpMatchArray): number | null {
  const nums = match
    .slice(1)
    .filter((g): g is string => typeof g === 'string' && g.length > 0)
    .map(Number)
    .filter((n) => Number.isFinite(n))
  if (nums.length === 0) return null
  return Math.max(...nums)
}

function findLabelled(text: string, words: string): number | null {
  // number(s) BEFORE the label: "up to 120 guests standing", "15-35 seated"
  const before = text.match(new RegExp(String.raw`(\d+)(?:\s*[-–—to]+\s*(\d+))?\s*(?:\w+\s+){0,3}?(?:${words})\b`))
  if (before) {
    const v = pickFromRange(before)
    if (v !== null) return v
  }
  // number AFTER the label: "banquet 320", "reception: 300"
  const after = text.match(new RegExp(String.raw`(?:${words})\b[^\d\n]{0,14}(\d+)(?:\s*[-–—to]+\s*(\d+))?`))
  if (after) {
    const v = pickFromRange(after)
    if (v !== null) return v
  }
  return null
}

export function parseFieldValue(raw: string, field: EvidenceField): number | null {
  if (field === 'phone' || field === 'email' || field === 'address') return null

  const text = stripArea(raw.toLowerCase().replace(/,(?=\d{3}\b)/g, ''))

  if (field === 'min_spend') {
    // Drop parentheticals so "(lunch $3,000)" does not outrank the headline figure.
    const primary = text.replace(/\([^)]*\)/g, ' ')
    const dollar = primary.match(/\$\s*(\d+(?:\.\d+)?)\s*(k\b)?/)
    if (dollar) {
      const n = Number(dollar[1]) * (dollar[2] ? 1000 : 1)
      return Number.isFinite(n) ? n : null
    }
    return parseNumeric(primary)
  }

  const wanted = field === 'seated_cap' ? SEATED_WORDS : STANDING_WORDS
  const other = field === 'seated_cap' ? STANDING_WORDS : SEATED_WORDS

  // A composite row quoting "14 per sub-room; 52 combined" means 52.
  const combined = text.match(new RegExp(String.raw`(\d+)\s*(?:\w+\s+){0,2}?combined`))
  if (combined && field === 'seated_cap') {
    const n = Number(combined[1])
    if (Number.isFinite(n)) return n
  }

  const labelled = findLabelled(text, wanted)
  if (labelled !== null) return labelled

  // No label for the field we want. If the string labels the OTHER field, this
  // value does not describe our field at all — better null than a wrong number.
  if (findLabelled(text, other) !== null) return null

  // Unlabelled range — "15-60 guests", "75-100". The CEILING is the capacity;
  // taking the floor understates the room and can drop it from a search it
  // would have passed.
  const bareRange = text.match(/(\d+)\s*[-–—]\s*(\d+)/)
  if (bareRange) return Math.max(Number(bareRange[1]), Number(bareRange[2]))

  return parseNumeric(text)
}

/**
 * Resolve a set of evidence rows for one field into a single believable fact.
 *
 * Precedence: source class, then extractor strength, then recency.
 * Conflict: if the *top class* contains two materially different values, the
 * label is downgraded one step and both values are retained. We surface the
 * disagreement instead of silently picking a winner, because a planner seeing
 * "80–120, sources disagree" learns something true, and a planner seeing a
 * confident "80" learns something false.
 */
export function resolveFact<T extends string | number>(
  evidence: Evidence[],
  parse: (raw: string) => T | null,
): ResolvedFact<T> {
  if (evidence.length === 0) {
    return { value: null, trust: 'unverified', sources: [], conflict: null, unknown: true }
  }

  const sorted = [...evidence].sort((a, b) => {
    const byAuthority = authority(b) - authority(a)
    if (byAuthority !== 0) return byAuthority
    return Date.parse(b.extractedAt) - Date.parse(a.extractedAt)
  })

  const winner = sorted[0]
  const topClass = winner.sourceClass
  const sameClass = sorted.filter((e) => e.sourceClass === topClass)

  const dissenting = sameClass.filter((e) => materiallyDifferent(e.value, winner.value, winner.field))
  const hasConflict = dissenting.length > 0

  let trust = trustOf(winner.sourceClass, winner.extractor)
  if (hasConflict) trust = downgrade(trust)

  return {
    value: parse(winner.value),
    trust,
    sources: sorted,
    conflict: hasConflict
      ? {
          values: Array.from(new Set([winner.value, ...dissenting.map((d) => d.value)])),
          sources: [winner, ...dissenting],
        }
      : null,
    unknown: false,
  }
}

/**
 * Numeric resolution that knows which field it is reading, so a capacity chart
 * quoting square footage alongside two capacities yields the right one.
 */
export function resolveNumericFact(evidence: Evidence[]): ResolvedFact<number> {
  const field = evidence[0]?.field
  return resolveFact<number>(evidence, (raw) => (field ? parseFieldValue(raw, field) : parseNumeric(raw)))
}

export function resolveStringFact(evidence: Evidence[]): ResolvedFact<string> {
  return resolveFact<string>(evidence, (raw) => (raw.trim() ? raw.trim() : null))
}

export const TRUST_COPY: Record<TrustLabel, { label: string; hint: string }> = {
  verified: {
    label: 'Verified',
    hint: 'Published explicitly by the venue or a structured partner listing. Click to read the source.',
  },
  likely: {
    label: 'Likely',
    hint: 'Inferred from prose, taken from a third-party aggregator, or sources disagree. Worth confirming.',
  },
  unverified: {
    label: 'Needs a call',
    hint: 'No published figure found. Estimated, or simply unknown. Confirm before you commit.',
  },
}
