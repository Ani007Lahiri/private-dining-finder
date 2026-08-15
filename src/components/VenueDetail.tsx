'use client'

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { RankedResult, SearchParams, VenueSpace } from '@/lib/types'
import { effectiveCapacity } from '@/lib/capacity'
import { resolveNumericFact } from '@/lib/trust'
import { EvidenceList, TrustBadge } from './TrustBadge'
import { ScoreBreakdown } from './ScoreBreakdown'
import { minutes, miles, money, spendPeriod } from '@/lib/format'
import { buildOutreachEmail, mailtoLink } from '@/lib/outreach'

/**
 * Venue detail drawer.
 *
 * The per-space table is the point. One capacity number per venue is what a
 * rubric-driven build produces; a planner needs to know which room, how big,
 * whether it combines, and what it costs — and then needs to see the sentence
 * we read it from.
 */
export function VenueDetail({
  result,
  params,
  onClose,
}: {
  result: RankedResult
  params: SearchParams
  onClose: () => void
}) {
  const { venue, spaces, evidence } = result.record
  const [tab, setTab] = useState<'rooms' | 'score' | 'outreach'>('rooms')

  const email = useMemo(() => buildOutreachEmail(result, params), [result, params])
  const [copied, setCopied] = useState(false)

  const orderedSpaces = useMemo(() => {
    return [...spaces].sort((a, b) => {
      const ca = effectiveCapacity(a, params.eventStyle, evidence).value ?? -1
      const cb = effectiveCapacity(b, params.eventStyle, evidence).value ?? -1
      return cb - ca
    })
  }, [spaces, evidence, params.eventStyle])

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onClose} className="flex-1 bg-ink-950/25 backdrop-blur-[1px]" />

      <div className="scroll-thin flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-ink-200 bg-white shadow-2xl">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-10 border-b border-ink-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-ink-900">{venue.name}</h2>
              <p className="mt-0.5 text-xs text-ink-500">{venue.address}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-600">
                <span className="uppercase tracking-wide text-ink-400">{venue.venueKind.replace('_', ' ')}</span>
                {venue.cuisine && <span>· {venue.cuisine}</span>}
                {result.commute && (
                  <span className="tabular">
                    · {minutes(result.commute.durationSeconds)} {params.mode} ·{' '}
                    {miles(result.commute.distanceMeters)}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded border border-ink-200 px-2 py-1 text-xs text-ink-500 hover:bg-ink-50"
            >
              Close
            </button>
          </div>

          <nav className="mt-3 flex gap-1">
            {(
              [
                ['rooms', 'Rooms & evidence'],
                ['score', 'Ranking'],
                ['outreach', 'Outreach'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={clsx(
                  'rounded px-2.5 py-1 text-xs font-medium transition',
                  tab === key ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100',
                )}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>

        <div className="flex-1 px-5 py-4">
          {tab === 'rooms' && (
            <div className="space-y-5">
              {result.capacity.best && (
                <section className="rounded-md border border-meter-fill/30 bg-blue-50/50 p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Recommended setup</h3>
                  <p className="mt-1 text-sm font-semibold text-ink-900">{result.capacity.best.label}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <TrustBadge trust={result.capacity.best.trust} />
                    <span className="text-[11px] text-ink-500">
                      {result.capacity.best.kind === 'combination'
                        ? 'Requires opening the airwall between these rooms — confirm with the venue.'
                        : result.capacity.best.kind === 'buyout'
                          ? 'Exclusive use of the whole venue.'
                          : 'Single room.'}
                    </span>
                  </div>
                  {result.capacity.alternatives.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-ink-500 hover:text-ink-800">
                        {result.capacity.alternatives.length} other workable configuration
                        {result.capacity.alternatives.length === 1 ? '' : 's'}
                      </summary>
                      <ul className="mt-1.5 space-y-1">
                        {result.capacity.alternatives.map((alt) => (
                          <li key={alt.spaces.map((s) => s.id).join('|')} className="flex items-center gap-2 text-xs">
                            <span className="text-ink-700">{alt.label}</span>
                            <TrustBadge size="xs" trust={alt.trust} />
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              )}

              {result.capacity.unknown && (
                <section className="rounded-md border border-ink-200 bg-ink-50 p-3">
                  <h3 className="text-sm font-semibold text-ink-900">Capacity not published</h3>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">
                    We could not find room capacities for this venue on its own site or on any listing we read. Rather
                    than estimate a number, it is shown as unknown. The outreach tab has a pre-written enquiry that
                    asks for exactly this.
                  </p>
                </section>
              )}

              {/* ── Per-space table ─────────────────────────────────────── */}
              {orderedSpaces.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                    All spaces ({orderedSpaces.length})
                  </h3>
                  <div className="overflow-hidden rounded-md border border-ink-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-ink-50 text-[10px] uppercase tracking-wide text-ink-500">
                        <tr>
                          <th className="px-2.5 py-1.5 font-semibold">Space</th>
                          <th className="tabular px-2 py-1.5 text-right font-semibold">Seated</th>
                          <th className="tabular px-2 py-1.5 text-right font-semibold">Standing</th>
                          <th className="tabular px-2.5 py-1.5 text-right font-semibold">Min spend</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-100">
                        {orderedSpaces.map((space) => (
                          <SpaceRow key={space.id} space={space} result={result} params={params} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-ink-400">
                    A dash means the venue does not publish that figure — not that the space cannot host that format.
                  </p>
                </section>
              )}

              {/* ── Contact + notes ─────────────────────────────────────── */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Contact</h3>
                <dl className="space-y-1.5 text-xs">
                  <ContactRow label="Phone" value={result.phone.value ?? venue.phone} href={(v) => `tel:${v}`} trust={result.phone.unknown ? null : result.phone.trust} />
                  <ContactRow label="Email" value={result.email.value ?? venue.email} href={(v) => `mailto:${v}`} trust={result.email.unknown ? null : result.email.trust} />
                  {venue.eventsUrl && (
                    <ContactRow label="Events page" value={venue.eventsUrl} href={(v) => v} trust={null} external />
                  )}
                  {venue.website && !venue.eventsUrl && (
                    <ContactRow label="Website" value={venue.website} href={(v) => v} trust={null} external />
                  )}
                </dl>
                {venue.notes && <p className="rounded bg-ink-50 px-2.5 py-2 text-[11px] leading-relaxed text-ink-600">{venue.notes}</p>}
                {venue.latlngApproximate && (
                  <p className="text-[11px] text-ink-400">
                    Coordinates for this venue are approximate, so the commute figure carries the same caveat.
                  </p>
                )}
              </section>
            </div>
          )}

          {tab === 'score' && (
            <div className="space-y-4">
              <ScoreBreakdown components={result.components} total={result.score} />
              <section className="rounded-md border border-ink-200 bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-600">
                <p className="mb-1.5 font-semibold text-ink-800">How capacity fit is scored</p>
                <p>
                  Asymmetric on purpose. A room 30% larger than the group scores worse than one 10% smaller — too small
                  usually means trimming a couple of names, too large means thirty guests in a room built for four
                  hundred. Weights are yours to change in the search panel.
                </p>
              </section>
            </div>
          )}

          {tab === 'outreach' && (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-ink-600">
                The questions below are generated from the gaps in our own data — every figure we could not verify for
                this venue becomes something the enquiry asks them to confirm.
              </p>
              <div className="rounded-md border border-ink-200">
                <div className="border-b border-ink-100 px-3 py-2 text-xs">
                  <span className="text-ink-400">To: </span>
                  <span className="text-ink-800">{email.to ?? 'no email published — call instead'}</span>
                  <br />
                  <span className="text-ink-400">Subject: </span>
                  <span className="text-ink-800">{email.subject}</span>
                </div>
                <pre className="whitespace-pre-wrap px-3 py-2.5 font-sans text-xs leading-relaxed text-ink-700">
                  {email.body}
                </pre>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(email.body)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1800)
                  }}
                  className="rounded-md border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
                >
                  {copied ? 'Copied' : 'Copy text'}
                </button>
                {email.to && (
                  <a
                    href={mailtoLink(email)}
                    className="rounded-md bg-meter-fill px-3 py-1.5 text-xs font-semibold text-white hover:bg-meter-strong"
                  >
                    Open in mail client
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ContactRow({
  label,
  value,
  href,
  trust,
  external,
}: {
  label: string
  value: string | null
  href: (v: string) => string
  trust: RankedResult['phone']['trust'] | null
  external?: boolean
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-20 shrink-0 text-ink-400">{label}</dt>
      <dd className="min-w-0 flex-1">
        {value ? (
          <a
            href={href(value)}
            target={external ? '_blank' : undefined}
            rel={external ? 'noreferrer noopener' : undefined}
            className="break-all text-meter-fill hover:underline"
          >
            {value}
          </a>
        ) : (
          <span className="text-ink-400">not published</span>
        )}
      </dd>
      {trust && <TrustBadge size="xs" trust={trust} />}
    </div>
  )
}

function SpaceRow({
  space,
  result,
  params,
}: {
  space: VenueSpace
  result: RankedResult
  params: SearchParams
}) {
  const [open, setOpen] = useState(false)
  const evidence = result.record.evidence
  const inConfig = result.capacity.best?.spaces.some((s) => s.id === space.id) ?? false

  const seatedEv = evidence.filter((e) => e.spaceId === space.id && e.field === 'seated_cap')
  const standingEv = evidence.filter((e) => e.spaceId === space.id && e.field === 'standing_cap')
  const spendEv = evidence.filter((e) => e.spaceId === space.id && e.field === 'min_spend')
  const anyEvidence = seatedEv.length + standingEv.length + spendEv.length > 0

  const seatedFact = resolveNumericFact(seatedEv)
  const standingFact = resolveNumericFact(standingEv)
  const spendFact = resolveNumericFact(spendEv)

  const fitsHere =
    (params.eventStyle === 'seated' ? space.seatedCap : (space.standingCap ?? space.seatedCap)) !== null &&
    (params.eventStyle === 'seated' ? space.seatedCap! : (space.standingCap ?? space.seatedCap)!) >= params.headcount

  return (
    <>
      <tr className={clsx(inConfig && 'bg-blue-50/60')}>
        <td className="px-2.5 py-1.5">
          <button
            onClick={() => anyEvidence && setOpen((o) => !o)}
            className={clsx('text-left', anyEvidence ? 'hover:text-meter-fill' : 'cursor-default')}
          >
            <span className="font-medium text-ink-900">{space.name}</span>
            {anyEvidence && <span className="ml-1 text-[10px] text-ink-400">{open ? '▾' : '▸'}</span>}
          </button>
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            {space.isBuyout && <Tag>buyout</Tag>}
            {space.isComposite && <Tag>combined</Tag>}
            {space.combinableGroup && !space.isComposite && <Tag>combinable</Tag>}
            {inConfig && <Tag tone="accent">recommended</Tag>}
            {fitsHere && !inConfig && <Tag tone="accent">fits alone</Tag>}
          </span>
        </td>
        <td className="tabular px-2 py-1.5 text-right text-ink-800">
          {space.seatedCap ?? <span className="text-ink-300">—</span>}
        </td>
        <td className="tabular px-2 py-1.5 text-right text-ink-800">
          {space.standingCap ?? <span className="text-ink-300">—</span>}
        </td>
        <td className="tabular px-2.5 py-1.5 text-right text-ink-800">
          {space.minSpendCents !== null ? (
            <>
              {money(space.minSpendCents)}
              <span className="block text-[10px] text-ink-400">{spendPeriod(space.minSpendPeriod)}</span>
            </>
          ) : (
            <span className="text-ink-300">—</span>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className="bg-ink-50/70 px-2.5 py-2.5">
            <div className="space-y-3">
              {seatedEv.length > 0 && (
                <EvidenceGroup title="Seated capacity" sources={seatedEv} conflict={seatedFact.conflict?.values ?? null} />
              )}
              {standingEv.length > 0 && (
                <EvidenceGroup
                  title="Standing capacity"
                  sources={standingEv}
                  conflict={standingFact.conflict?.values ?? null}
                />
              )}
              {spendEv.length > 0 && (
                <EvidenceGroup title="Minimum spend" sources={spendEv} conflict={spendFact.conflict?.values ?? null} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function EvidenceGroup({
  title,
  sources,
  conflict,
}: {
  title: string
  sources: RankedResult['record']['evidence']
  conflict: string[] | null
}) {
  return (
    <div>
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-500">{title}</h4>
      <EvidenceList sources={sources} conflict={conflict} />
    </div>
  )
}

function Tag({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'accent' }) {
  return (
    <span
      className={clsx(
        'rounded px-1 py-[1px] text-[9px] uppercase tracking-wide',
        tone === 'accent' ? 'bg-blue-100 text-meter-strong' : 'bg-ink-100 text-ink-500',
      )}
    >
      {children}
    </span>
  )
}
