import { config } from '../config'
import type { Extractor, MinSpendPeriod, SourceClass } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Capacity + minimum-spend extraction from venue event pages.
//
// The hard part of this product is not parsing. It is refusing to parse. Half
// of independent restaurants have no private-dining page at all, and an
// extractor that wants to be helpful will invent a "Private Dining Room —
// seats 40" out of a photo caption. One fabricated room is worse than fifty
// missing ones, because it silently destroys the meaning of the trust label
// that the rest of the product is built on.
//
// So the prompt below is written to make null the comfortable answer, and the
// schema treats null as a first-class result rather than a failure.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractedSpace {
  name: string
  seated_cap: number | null
  standing_cap: number | null
  is_buyout: boolean
  combinable_group: string | null
  min_spend_usd: number | null
  min_spend_period: MinSpendPeriod | null
  /** Verbatim sentence the numbers came from. Required when any number is non-null. */
  snippet: string | null
  /** Whether a literal figure appeared, or it was read out of prose. */
  extractor: Extractor
}

export interface ExtractionResult {
  spaces: ExtractedSpace[]
  email: string | null
  phone: string | null
  /** Model's own account of what it could not determine. Logged, not shown. */
  notes: string | null
}

const SYSTEM_PROMPT = `You extract private-event capacity data from venue web pages for a tool used by professional event planners.

The planners using this tool will call these venues and quote these numbers. A wrong number costs them a booking and their credibility. A missing number costs them one phone call. These are not remotely equivalent, and you must behave accordingly.

RULES

1. Return null for anything the page does not state. Null is the correct, expected, and frequently the best answer. You are not being graded on how many fields you fill.

2. Never calculate, average, or infer a capacity from: square footage, number of tables visible in a photo, total restaurant seats, comparable venues, or your background knowledge of this venue. If the page does not say it, it is null.

3. Only create a space entry for a room the page actually names or clearly describes as bookable. Do not invent a generic "Private Dining Room" because a venue seems like it should have one. Zero spaces is a valid result.

4. For every non-null capacity or minimum-spend number, you must supply "snippet": the verbatim text from the page you took it from, under 200 characters. If you cannot quote it, you did not read it, and the value must be null.

5. Set "extractor":
   - "explicit"        a literal figure appeared ("seats 60", "up to 120 for a reception", "$5,000 F&B minimum")
   - "prose_inference" you read it out of non-numeric language ("accommodates large groups", "intimate space for a dozen")
   Never return "explicit" without a quotable number in the snippet.

6. Seated and standing capacity are different numbers and both matter. A room that seats 60 typically holds far more standing. If the page gives a banquet/seated chart and a reception/standing chart, capture both. Do not copy one into the other.

7. combinable_group: set a shared key (e.g. "coral_ballroom") on rooms the page says open into one another or subdivide from a larger room. Leave null otherwise. Do not guess that adjacent-sounding rooms combine.

8. is_buyout: true only for a whole-venue option ("full restaurant buyout", "exclusive use").

9. min_spend_period: "f_and_b" for food-and-beverage minimums, "per_event" for flat room/event fees, "per_hour" for hourly rates.

Return ONLY a JSON object matching the schema. No prose, no markdown fences.`

const SCHEMA_HINT = `{
  "spaces": [
    {
      "name": string,
      "seated_cap": number | null,
      "standing_cap": number | null,
      "is_buyout": boolean,
      "combinable_group": string | null,
      "min_spend_usd": number | null,
      "min_spend_period": "f_and_b" | "per_event" | "per_hour" | null,
      "snippet": string | null,
      "extractor": "explicit" | "prose_inference"
    }
  ],
  "email": string | null,
  "phone": string | null,
  "notes": string | null
}`

/** Strip tags and collapse whitespace. Cheap, and enough for an LLM to read. */
export function htmlToText(html: string, maxChars = 24_000): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.slice(0, maxChars)
}

function coerce(raw: unknown): ExtractionResult {
  const obj = (raw ?? {}) as Record<string, unknown>
  const rawSpaces = Array.isArray(obj.spaces) ? obj.spaces : []

  const spaces: ExtractedSpace[] = rawSpaces
    .map((s): ExtractedSpace | null => {
      const o = (s ?? {}) as Record<string, unknown>
      const name = typeof o.name === 'string' ? o.name.trim() : ''
      if (!name) return null

      const num = (v: unknown): number | null => {
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : NaN
        return Number.isFinite(n) && n > 0 ? n : null
      }
      const snippet = typeof o.snippet === 'string' && o.snippet.trim() ? o.snippet.trim().slice(0, 240) : null

      let seated = num(o.seated_cap)
      let standing = num(o.standing_cap)
      let minSpend = num(o.min_spend_usd)

      // Rule 4, enforced rather than requested: a number without a quotable
      // source is discarded. This is the guardrail that keeps `verified` honest
      // even when the model gets enthusiastic.
      if (!snippet) {
        seated = null
        standing = null
        minSpend = null
      }

      return {
        name,
        seated_cap: seated,
        standing_cap: standing,
        is_buyout: Boolean(o.is_buyout),
        combinable_group:
          typeof o.combinable_group === 'string' && o.combinable_group.trim() ? o.combinable_group.trim() : null,
        min_spend_usd: minSpend,
        min_spend_period: (['f_and_b', 'per_event', 'per_hour'] as const).includes(o.min_spend_period as MinSpendPeriod)
          ? (o.min_spend_period as MinSpendPeriod)
          : null,
        snippet,
        extractor: o.extractor === 'explicit' && snippet ? 'explicit' : 'prose_inference',
      } satisfies ExtractedSpace
    })
    .filter((s): s is ExtractedSpace => s !== null)
    // A space with no capacity, no spend and no snippet carries no information.
    .filter((s) => s.seated_cap !== null || s.standing_cap !== null || s.min_spend_usd !== null)

  return {
    spaces,
    email: typeof obj.email === 'string' && obj.email.includes('@') ? obj.email.trim() : null,
    phone: typeof obj.phone === 'string' && obj.phone.trim() ? obj.phone.trim() : null,
    notes: typeof obj.notes === 'string' ? obj.notes.trim() : null,
  }
}

export const EMPTY_EXTRACTION: ExtractionResult = { spaces: [], email: null, phone: null, notes: null }

export async function extractFromPage(
  pageText: string,
  venueName: string,
  sourceUrl: string,
): Promise<ExtractionResult> {
  if (!config.llm.enabled) return EMPTY_EXTRACTION
  if (pageText.trim().length < 200) return EMPTY_EXTRACTION

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.llm.apiKey!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.llm.model,
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Venue: ${venueName}\nSource URL: ${sourceUrl}\n\nSchema:\n${SCHEMA_HINT}\n\nPage text:\n"""\n${pageText}\n"""`,
        },
      ],
    }),
  })

  if (!res.ok) {
    console.warn(`[extraction] ${res.status} for ${venueName}: ${await res.text()}`)
    return EMPTY_EXTRACTION
  }

  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
  const text = (json.content ?? []).find((c) => c.type === 'text')?.text ?? ''

  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) return EMPTY_EXTRACTION
    return coerce(JSON.parse(text.slice(start, end + 1)))
  } catch {
    console.warn(`[extraction] unparseable response for ${venueName}`)
    return EMPTY_EXTRACTION
  }
}

/**
 * Source class for an extracted page. Anything on the venue's own hostname is
 * `venue_domain`; known booking platforms are `partner_listing`; the rest are
 * aggregators.
 */
const PARTNER_HOSTS = ['tripleseat.com', 'eventup.com', 'partyslate.com', 'peerspace.com', 'cvent.com', 'thebash.com']
const AGGREGATOR_HOSTS = ['yelp.com', 'tripadvisor.com', 'opentable.com', 'resy.com', 'google.com', 'facebook.com']

export function classifySource(sourceUrl: string, venueWebsite: string | null): SourceClass {
  let host: string
  try {
    host = new URL(sourceUrl).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return 'aggregator'
  }

  if (venueWebsite) {
    try {
      const venueHost = new URL(venueWebsite).hostname.replace(/^www\./, '').toLowerCase()
      const root = (h: string) => h.split('.').slice(-2).join('.')
      if (root(host) === root(venueHost)) return 'venue_domain'
    } catch {
      /* fall through */
    }
  }

  if (PARTNER_HOSTS.some((h) => host.endsWith(h))) return 'partner_listing'
  if (AGGREGATOR_HOSTS.some((h) => host.endsWith(h))) return 'aggregator'
  return 'aggregator'
}

/** Fetch a page with a short timeout. Venue sites are frequently slow or dead. */
export async function fetchPage(url: string, timeoutMs = 12_000): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'PrivateDiningFinder/1.0 (venue research; +https://nowadays.ai)' },
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('html') && !ct.includes('text')) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
