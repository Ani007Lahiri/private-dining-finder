/**
 * Golden-set evaluation of the extraction pipeline.
 *
 *   npm run eval:golden            # all ten venues
 *   npm run eval:golden -- --venue "Wayfare"
 *
 * Requires ANTHROPIC_API_KEY. Without it the script says so and exits rather
 * than printing a fabricated score — a made-up precision number in a document
 * about calibrated uncertainty would be a special kind of embarrassing.
 *
 * WHAT IS MEASURED
 *
 *   room recall        did we find the named space at all?
 *   capacity precision of the capacities we reported, how many match truth?
 *   fabrication rate   how many rooms did we invent that do not exist?
 *
 * Fabrication rate is the one that matters most. Missing a room costs the
 * planner a phone call. Inventing one destroys the meaning of every `verified`
 * badge in the product.
 */

import './load-env' // must precede any import that reads process.env (i.e. config)
import { GOLDEN_SET } from '../src/data/golden-set'
import { extractFromPage, fetchPage, htmlToText } from '../src/lib/adapters/extraction'
import { config } from '../src/lib/config'
import type { GoldenSpace } from '../src/lib/golden-types'

const TOLERANCE = 0.1 // within 10% counts as a match; charts round.

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(the|room|space|private|dining|suite)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function matches(a: number | null, b: number | null): boolean | null {
  if (a === null || b === null) return null
  return Math.abs(a - b) / Math.max(a, b, 1) <= TOLERANCE
}

async function main() {
  if (!config.llm.enabled) {
    console.error('\nANTHROPIC_API_KEY is not set — extraction is disabled, so there is nothing to evaluate.')
    console.error('Set it in .env.local and re-run. See .env.example.\n')
    process.exit(2)
  }

  const filterArg = process.argv.indexOf('--venue')
  const filter = filterArg !== -1 ? process.argv[filterArg + 1]?.toLowerCase() : null
  const targets = filter ? GOLDEN_SET.filter((g) => g.venue.toLowerCase().includes(filter)) : GOLDEN_SET

  let expectedRooms = 0
  let foundRooms = 0
  let capacityChecked = 0
  let capacityCorrect = 0
  let fabricated = 0
  let extractedTotal = 0
  let unreachable = 0

  const rows: string[] = []

  for (const golden of targets) {
    process.stderr.write(`  fetching ${golden.venue}…\r`)
    const html = await fetchPage(golden.url, 20_000)
    if (!html) {
      unreachable++
      rows.push(`  ${golden.venue.slice(0, 40).padEnd(40)}  PAGE UNREACHABLE`)
      continue
    }

    const result = await extractFromPage(htmlToText(html), golden.venue, golden.url)
    extractedTotal += result.spaces.length

    const truthByName = new Map<string, GoldenSpace>(golden.spaces.map((s) => [norm(s.name), s]))
    const matchedTruth = new Set<string>()

    for (const got of result.spaces) {
      const key = norm(got.name)
      // Exact normalised match, then substring either direction — venues write
      // "Sinatra Room" on one page and "The Sinatra" on another.
      let truth = truthByName.get(key)
      if (!truth) {
        for (const [tKey, tVal] of truthByName) {
          if (tKey.length > 3 && (tKey.includes(key) || key.includes(tKey))) {
            truth = tVal
            break
          }
        }
      }

      if (!truth) {
        // Not in the golden set. That is not automatically a fabrication — the
        // page may list rooms we did not record — so it is counted separately
        // and only flagged when it carries a capacity we cannot corroborate.
        if (got.seated_cap !== null || got.standing_cap !== null) fabricated++
        continue
      }

      matchedTruth.add(norm(truth.name))

      for (const [gotVal, truthVal] of [
        [got.seated_cap, truth.seated],
        [got.standing_cap, truth.standing],
      ] as const) {
        const verdict = matches(gotVal, truthVal)
        if (verdict === null) continue
        capacityChecked++
        if (verdict) capacityCorrect++
      }
    }

    expectedRooms += golden.spaces.length
    foundRooms += matchedTruth.size

    rows.push(
      `  ${golden.venue.slice(0, 40).padEnd(40)}  rooms ${String(matchedTruth.size).padStart(2)}/${String(golden.spaces.length).padEnd(2)}  extracted ${String(result.spaces.length).padStart(2)}`,
    )
  }

  const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${Math.round((n / d) * 100)}%`)

  console.log('\n╭─ Golden-set extraction evaluation ─────────────────────────────────────╮')
  console.log(`│ ${targets.length} venues · ${expectedRooms} known spaces · model ${config.llm.model}`)
  console.log('╰────────────────────────────────────────────────────────────────────────╯\n')
  rows.forEach((r) => console.log(r))
  console.log('')
  console.log(`  Room recall           ${foundRooms}/${expectedRooms}  (${pct(foundRooms, expectedRooms)})`)
  console.log(`  Capacity precision    ${capacityCorrect}/${capacityChecked}  (${pct(capacityCorrect, capacityChecked)}) within ±${TOLERANCE * 100}%`)
  console.log(`  Unmatched w/ numbers  ${fabricated}/${extractedTotal}  (${pct(fabricated, extractedTotal)}) — candidate fabrications`)
  if (unreachable > 0) console.log(`  Unreachable pages     ${unreachable}`)
  console.log('')
  console.log('  Read the fabrication line first. A miss costs a phone call; an invention')
  console.log('  costs the credibility of every verified badge in the product.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
