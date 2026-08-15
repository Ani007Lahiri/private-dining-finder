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

// ─────────────────────────────────────────────────────────────────────────────
// Client-facing shortlist document.
//
// The clipboard export above is for the planner's own inbox. This is the version
// a planner hands to the client: a clean, printable HTML page (print → Save as
// PDF) with no app chrome, no weight sliders, no scores — just the venues, the
// facts, and the trust caveats made plain. It is deliberately self-contained
// (inline styles, no scripts) so it survives being saved, emailed, or printed.
// ─────────────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

const TRUST_WORD: Record<string, string> = {
  verified: 'Verified — published by the venue',
  likely: 'Likely — secondary source or inferred, confirm by phone',
  unverified: 'Needs a call — not published anywhere we could read',
}

function trustPill(trust: string): string {
  const color =
    trust === 'verified' ? '#0ca30c' : trust === 'likely' ? '#b07d00' : '#d03b3b'
  const glyph = trust === 'verified' ? '●' : trust === 'likely' ? '◐' : '○'
  return `<span style="color:${color};font-weight:600;white-space:nowrap">${glyph} ${esc(TRUST_WORD[trust] ?? trust)}</span>`
}

export function buildShortlistHtml(results: RankedResult[], params: SearchParams): string {
  const generated = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const rows = results
    .map((r, i) => {
      const { venue } = r.record
      const config = r.capacity.best
      const commute = r.commute
        ? `${minutes(r.commute.durationSeconds)} ${params.mode}${r.commute.method === 'estimated' ? ' (estimated)' : ' (measured)'}`
        : 'not available'
      const spend =
        r.minSpend.value !== null
          ? `${money(r.minSpend.value)} ${spendPeriod(
              r.record.spaces.find((s) => s.minSpendPeriod)?.minSpendPeriod ?? null,
            )}`
          : 'not published'
      const contact = [r.phone.value ?? venue.phone, r.email.value ?? venue.email]
        .filter((x): x is string => Boolean(x))
        .map(esc)
        .join(' · ')
      return `
      <section style="break-inside:avoid;margin:0 0 22px;padding:16px 18px;border:1px solid #e1e0d9;border-radius:10px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">
          <h2 style="margin:0;font-size:17px;color:#111">${i + 1}. ${esc(venue.name)}</h2>
          <span style="font-size:12px;color:#666">${esc(venue.venueKind.replace('_', ' '))}${venue.cuisine ? ' · ' + esc(venue.cuisine) : ''}</span>
        </div>
        <p style="margin:2px 0 12px;color:#555;font-size:13px">${esc(venue.address)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tbody>
            <tr><td style="padding:4px 8px 4px 0;color:#777;width:130px;vertical-align:top">Recommended space</td>
                <td style="padding:4px 0"><strong>${config ? esc(config.label) : 'Capacity not published'}</strong><br>${trustPill(config?.trust ?? 'unverified')}</td></tr>
            <tr><td style="padding:4px 8px 4px 0;color:#777;vertical-align:top">Commute</td>
                <td style="padding:4px 0">${esc(commute)}${r.commute ? '<br>' + trustPill(r.commute.trust) : ''}</td></tr>
            <tr><td style="padding:4px 8px 4px 0;color:#777;vertical-align:top">Minimum spend</td>
                <td style="padding:4px 0">${esc(spend)}${r.minSpend.value !== null ? '<br>' + trustPill(r.minSpend.trust) : ' <span style="color:#b07d00">— confirm by phone</span>'}</td></tr>
            ${contact ? `<tr><td style="padding:4px 8px 4px 0;color:#777;vertical-align:top">Contact</td><td style="padding:4px 0">${contact}</td></tr>` : ''}
            ${venue.eventsUrl || venue.website ? `<tr><td style="padding:4px 8px 4px 0;color:#777;vertical-align:top">Details</td><td style="padding:4px 0"><a href="${esc(venue.eventsUrl ?? venue.website ?? '')}" style="color:#2a78d6">${esc(venue.eventsUrl ?? venue.website ?? '')}</a></td></tr>` : ''}
          </tbody>
        </table>
      </section>`
    })
    .join('')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Private dining shortlist — ${esc(params.address)}</title>
<style>
  @media print { .no-print { display:none } body { margin:0 } }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#222; max-width:720px; margin:32px auto; padding:0 20px; line-height:1.45 }
</style></head>
<body>
  <button class="no-print" onclick="window.print()" style="float:right;padding:8px 14px;border:1px solid #ccc;border-radius:8px;background:#111;color:#fff;font-size:13px;cursor:pointer">Print / Save as PDF</button>
  <h1 style="margin:0 0 4px;font-size:22px">Private dining shortlist</h1>
  <p style="margin:0 0 4px;color:#444">${esc(String(params.headcount))} guests · ${esc(eventStyleCopy(params))}</p>
  <p style="margin:0 0 20px;color:#666;font-size:13px">Near ${esc(params.address)} · within ${esc(String(params.maxCommuteMinutes))} min ${esc(params.mode)} · prepared ${esc(generated)}</p>
  ${rows}
  <p style="margin-top:24px;padding-top:12px;border-top:1px solid #e1e0d9;color:#666;font-size:12px">
    Every figure carries the source it came from. <strong>Verified</strong> means published by the venue or a
    structured partner listing; <strong>likely</strong> means a secondary source or an inferred figure; <strong>needs
    a call</strong> means we found no published figure. Trust labels describe the <em>source</em>, not a guarantee the
    number is current — confirm the essentials before you commit.
  </p>
</body></html>`
}

export function mailtoLink(email: OutreachEmail): string {
  const params = new URLSearchParams({ subject: email.subject, body: email.body })
  return `mailto:${email.to ?? ''}?${params.toString()}`
}
