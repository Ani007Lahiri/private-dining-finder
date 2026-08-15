'use client'

import { useState } from 'react'
import clsx from 'clsx'
import type { RankedResult, SearchParams } from '@/lib/types'
import { TrustBadge } from './TrustBadge'
import { minutes, money, pct } from '@/lib/format'
import { buildShortlistText, buildShortlistHtml } from '@/lib/outreach'

/**
 * Comparison tray.
 *
 * The thing a planner actually does with a result list is narrow it to three or
 * four and put them side by side. Rows are aligned across venues so the eye can
 * scan one attribute at a time, and every cell carries its own trust label —
 * because the useful comparison is often "this one is verified at 180, that one
 * is a guess at 220".
 */
export function ComparisonTray({
  results,
  params,
  onRemove,
  onClear,
  onOpen,
}: {
  results: RankedResult[]
  params: SearchParams
  onRemove: (id: string) => void
  onClear: () => void
  onOpen: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  if (results.length === 0) return null

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/97 shadow-[0_-4px_20px_rgba(11,11,11,0.08)] backdrop-blur">
      <div className="mx-auto max-w-[1600px] px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-2 text-xs font-semibold text-ink-800 hover:text-meter-fill"
          >
            <span>{expanded ? '▾' : '▴'}</span>
            Comparing {results.length} venue{results.length === 1 ? '' : 's'}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                // Client-facing document: open the printable shortlist in a new
                // tab via a blob URL — no server route, survives Save-as-PDF.
                const html = buildShortlistHtml(results, params)
                const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
                window.open(url, '_blank', 'noopener,noreferrer')
                // Revoke after the tab has had time to load the document.
                setTimeout(() => URL.revokeObjectURL(url), 60_000)
              }}
              className="rounded-md border border-ink-900 bg-ink-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-ink-700"
            >
              Client shortlist (PDF)
            </button>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(buildShortlistText(results, params))
                setCopied(true)
                setTimeout(() => setCopied(false), 1800)
              }}
              className="rounded-md border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              {copied ? 'Copied' : 'Copy text'}
            </button>
            <button onClick={onClear} className="text-xs text-ink-400 hover:text-ink-700">
              Clear
            </button>
          </div>
        </div>

        {expanded && (
          <div className="scroll-thin mt-2.5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead>
                <tr className="border-b border-ink-200">
                  <th className="w-28 py-1.5 pr-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                    Attribute
                  </th>
                  {results.map((r) => (
                    <th key={r.record.venue.id} className="px-2 py-1.5 align-bottom">
                      <div className="flex items-start justify-between gap-1">
                        <button
                          onClick={() => onOpen(r.record.venue.id)}
                          className="text-left text-[13px] font-semibold text-ink-900 hover:text-meter-fill hover:underline"
                        >
                          {r.record.venue.name}
                        </button>
                        <button
                          onClick={() => onRemove(r.record.venue.id)}
                          aria-label={`Remove ${r.record.venue.name}`}
                          className="shrink-0 text-ink-300 hover:text-ink-700"
                        >
                          ×
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <Row label="Overall fit">
                  {results.map((r) => (
                    <Cell key={r.record.venue.id}>
                      <span className="tabular font-semibold text-ink-900">{pct(r.score)}</span>
                    </Cell>
                  ))}
                </Row>

                <Row label="Recommended space">
                  {results.map((r) => (
                    <Cell key={r.record.venue.id}>
                      {r.capacity.best ? (
                        <>
                          <span className="block text-ink-800">{r.capacity.best.label}</span>
                          <TrustBadge size="xs" trust={r.capacity.best.trust} className="mt-1" />
                        </>
                      ) : (
                        <>
                          <span className="block text-ink-400">not published</span>
                          <TrustBadge size="xs" trust="unverified" className="mt-1" />
                        </>
                      )}
                    </Cell>
                  ))}
                </Row>

                <Row label="Rooms listed">
                  {results.map((r) => (
                    <Cell key={r.record.venue.id}>
                      <span className="tabular text-ink-800">{r.record.spaces.length || '—'}</span>
                    </Cell>
                  ))}
                </Row>

                <Row label={`Commute (${params.mode})`}>
                  {results.map((r) => (
                    <Cell key={r.record.venue.id}>
                      {r.commute ? (
                        <>
                          <span className="tabular text-ink-800">{minutes(r.commute.durationSeconds)}</span>
                          <TrustBadge size="xs" trust={r.commute.trust} className="ml-1.5" />
                        </>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </Cell>
                  ))}
                </Row>

                <Row label="Minimum spend">
                  {results.map((r) => (
                    <Cell key={r.record.venue.id}>
                      {r.minSpend.value !== null ? (
                        <>
                          <span className="tabular text-ink-800">{money(r.minSpend.value)}</span>
                          <TrustBadge size="xs" trust={r.minSpend.trust} className="ml-1.5" />
                        </>
                      ) : (
                        <span className="text-ink-400">not published</span>
                      )}
                    </Cell>
                  ))}
                </Row>

                <Row label="Contact">
                  {results.map((r) => {
                    const phone = r.phone.value ?? r.record.venue.phone
                    const email = r.email.value ?? r.record.venue.email
                    return (
                      <Cell key={r.record.venue.id}>
                        {phone && <span className="block text-ink-700">{phone}</span>}
                        {email && <span className="block truncate text-ink-500">{email}</span>}
                        {!phone && !email && <span className="text-ink-400">—</span>}
                      </Cell>
                    )
                  })}
                </Row>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th className="py-1.5 pr-2 text-left align-top text-[11px] font-medium text-ink-500">{label}</th>
      {children}
    </tr>
  )
}

function Cell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={clsx('px-2 py-1.5 align-top', className)}>{children}</td>
}
