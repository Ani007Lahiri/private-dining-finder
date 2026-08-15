import { minutes, money, spendPeriod } from './format'
import type { RankedResult, SearchParams } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Outreach export.
//
// Planners live in their inbox. A search tool that ends at "here is a list"
// leaves the last mile undone — the planner still has to open each venue's
// contact page, retype the group details, and remember which questions they
// needed answered for this particular room.
//
// So the shortlist exports as a ready-to-send enquiry, and — this is the part
// that matters — the questions are generated from the GAPS in our own data.
// Every field we could not verify becomes a line item the venue is asked to
// confirm. The uncertainty model earns its keep twice: once in the UI, once here.
// ─────────────────────────────────────────────────────────────────────────────

export interface OutreachEmail {
  to: string | null
  subject: string
  body: string
}

function eventStyleCopy(params: SearchParams): string {
  switch (params.eventStyle) {
    case 'reception':
      return 'a standing reception / happy hour'
    case 'seated':
      return 'a seated dinner'
    default:
      return 'a mixed seated and standing format'
  }
}

export function buildOutreachEmail(result: RankedResult, params: SearchParams): OutreachEmail {
  const { venue } = result.record
  const config = result.capacity.best

  const questions: string[] = []

  if (result.capacity.unknown) {
    questions.push(
      `What private spaces do you have, and what are their seated and standing capacities? We could not find these published.`,
    )
  } else if (config) {
    if (config.trust !== 'verified') {
      questions.push(
        `Can you confirm ${config.spaces.map((s) => s.name).join(' + ')} holds ${config.capacity} for ${eventStyleCopy(params)}? Our figure is from a secondary source.`,
      )
    }
    if (config.degradedFromSeated) {
      questions.push(
        `We only found a seated capacity for ${config.spaces.map((s) => s.name).join(' + ')} — what is the standing/reception capacity?`,
      )
    }
    if (config.kind === 'combination') {
      questions.push(
        `Can ${config.spaces.map((s) => s.name).join(' and ')} be opened into a single space for this group?`,
      )
    }
  }

  if (result.minSpend.unknown || result.minSpend.value === null) {
    questions.push('What is the food-and-beverage minimum or room fee for this date and group size?')
  } else if (result.minSpend.trust !== 'verified' || result.minSpend.conflict) {
    questions.push(
      `Is the minimum spend still ${money(result.minSpend.value)}${result.minSpend.conflict ? ' — we have seen conflicting figures' : ''}?`,
    )
  }

  questions.push('Do you have availability, and what is the deposit and cancellation policy?')
  questions.push('Can you accommodate dietary restrictions (vegetarian, vegan, gluten-free, allergies)?')

  const headline = config
    ? `${config.label}`
    : result.capacity.unknown
      ? 'space for our group'
      : 'a suitable space'

  const body = [
    `Hello${venue.name ? ` ${venue.name} events team` : ''},`,
    '',
    `I am planning a corporate event for ${params.headcount} guests and would like to enquire about ${headline}.`,
    '',
    'Details:',
    `  • Group size: ${params.headcount}`,
    `  • Format: ${eventStyleCopy(params)}`,
    `  • Location requirement: within ${params.maxCommuteMinutes} minutes' ${params.mode === 'walking' ? 'walk' : 'drive'} of ${params.address}`,
    result.commute
      ? `  • Your venue is ${minutes(result.commute.durationSeconds)} from there by our estimate`
      : null,
    params.budgetCents ? `  • Indicative budget: ${money(params.budgetCents)}` : null,
    '',
    'A few things I would like to confirm:',
    ...questions.map((q, i) => `  ${i + 1}. ${q}`),
    '',
    'Could you let me know availability and next steps?',
    '',
    'Many thanks,',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  return {
    to: result.email.value ?? venue.email,
    subject: `Private event enquiry — ${params.headcount} guests`,
    body,
  }
}

/** Plain-text shortlist for pasting into a doc or a message to a client. */
export function buildShortlistText(results: RankedResult[], params: SearchParams): string {
  const lines: string[] = [
    `Private dining shortlist — ${params.headcount} guests, ${eventStyleCopy(params)}`,
    `Near ${params.address} · within ${params.maxCommuteMinutes} min ${params.mode}`,
    '',
  ]

  results.forEach((r, i) => {
    const { venue } = r.record
    const config = r.capacity.best
    lines.push(`${i + 1}. ${venue.name}`)
    lines.push(`   ${venue.address}`)
    lines.push(
      `   Space: ${config ? config.label : 'capacity not published — call to confirm'}${
        config ? ` [${config.trust}]` : ''
      }`,
    )
    if (r.commute) {
      lines.push(
        `   Commute: ${minutes(r.commute.durationSeconds)} ${params.mode}${r.commute.method === 'estimated' ? ' (estimated)' : ''}`,
      )
    }
    lines.push(
      `   Minimum spend: ${
        r.minSpend.value !== null
          ? `${money(r.minSpend.value)} ${spendPeriod(r.record.spaces.find((s) => s.minSpendPeriod)?.minSpendPeriod ?? null)} [${r.minSpend.trust}]`
          : 'not published — call to confirm'
      }`,
    )
    const contact = [r.phone.value ?? venue.phone, r.email.value ?? venue.email].filter(Boolean).join(' · ')
    if (contact) lines.push(`   Contact: ${contact}`)
    if (venue.eventsUrl ?? venue.website) lines.push(`   ${venue.eventsUrl ?? venue.website}`)
    lines.push('')
  })

  lines.push('Trust labels: verified = published by the venue. likely = secondary source or inferred.')
  lines.push('needs a call = not published anywhere we could read.')

  return lines.join('\n')
}

export function mailtoLink(email: OutreachEmail): string {
  const params = new URLSearchParams({ subject: email.subject, body: email.body })
  return `mailto:${email.to ?? ''}?${params.toString()}`
}
