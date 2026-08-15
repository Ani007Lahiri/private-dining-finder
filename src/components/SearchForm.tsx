'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { SCENARIOS } from '@/lib/scenarios'
import { DEFAULT_WEIGHTS } from '@/lib/ranking'
import type { SearchRequest } from '@/lib/params'
import type { CommuteMode, EventStyle } from '@/lib/types'

interface Suggestion {
  placeId: string
  primaryText: string
  secondaryText: string
  lat?: number
  lng?: number
}

const STYLE_OPTIONS: Array<{ value: EventStyle; label: string; hint: string }> = [
  { value: 'seated', label: 'Seated dinner', hint: 'Tests seated capacity' },
  { value: 'reception', label: 'Reception', hint: 'Tests standing capacity' },
  { value: 'mixed', label: 'Mixed', hint: 'Standing where published' },
]

export function SearchForm({
  onSearch,
  busy,
  value,
  onChange,
}: {
  onSearch: (req: SearchRequest) => void
  busy: boolean
  value: SearchRequest
  onChange: (next: SearchRequest) => void
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [budgetInput, setBudgetInput] = useState('')
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowSuggestions(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function queryAutocomplete(text: string) {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(text)}`)
        const json = (await res.json()) as { suggestions?: Suggestion[] }
        setSuggestions(json.suggestions ?? [])
        setShowSuggestions((json.suggestions ?? []).length > 0)
      } catch {
        setSuggestions([])
      }
    }, 220)
  }

  async function pickSuggestion(s: Suggestion) {
    setShowSuggestions(false)
    if (s.lat !== undefined && s.lng !== undefined) {
      onChange({ ...value, address: s.secondaryText || s.primaryText, lat: s.lat, lng: s.lng })
      return
    }
    const res = await fetch(`/api/places/autocomplete?placeId=${encodeURIComponent(s.placeId)}`)
    if (!res.ok) return
    const json = (await res.json()) as { lat: number; lng: number; address: string }
    onChange({ ...value, address: json.address, lat: json.lat, lng: json.lng })
  }

  const canSearch = value.address.trim().length > 0 && Number.isFinite(value.lat) && Number.isFinite(value.lng)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (canSearch) onSearch(value)
      }}
      className="space-y-4"
    >
      {/* ── Scenario presets ─────────────────────────────────────────────── */}
      <div>
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Required scenarios
        </span>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {SCENARIOS.map((s) => {
            const active = value.address === s.address && value.headcount === s.headcount
            return (
              <button
                key={s.id}
                type="button"
                title={s.note}
                onClick={() => {
                  const next: SearchRequest = {
                    ...value,
                    address: s.address,
                    lat: s.lat,
                    lng: s.lng,
                    headcount: s.headcount,
                    maxCommuteMinutes: s.maxCommuteMinutes,
                    mode: s.mode,
                    eventStyle: s.eventStyle,
                  }
                  onChange(next)
                  onSearch(next)
                }}
                className={clsx(
                  'rounded-md border px-2.5 py-2 text-left text-xs transition',
                  active
                    ? 'border-meter-fill bg-blue-50 text-ink-900'
                    : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50',
                )}
              >
                <span className="block font-semibold">{s.label.split(',')[0]}</span>
                <span className="tabular text-[11px] text-ink-500">
                  {s.headcount} · {s.maxCommuteMinutes} min {s.mode === 'walking' ? 'walk' : 'drive'} ·{' '}
                  {s.eventStyle === 'reception' ? 'reception' : 'seated'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Address ───────────────────────────────────────────────────────── */}
      <div ref={boxRef} className="relative">
        <label htmlFor="address" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Address
        </label>
        <input
          id="address"
          type="text"
          autoComplete="off"
          value={value.address}
          onChange={(e) => {
            onChange({ ...value, address: e.target.value })
            queryAutocomplete(e.target.value)
          }}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          placeholder="Times Square, New York, NY"
          className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-ink-300 focus:border-meter-fill focus:ring-2 focus:ring-blue-100"
        />
        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-ink-200 bg-white shadow-lg">
            {suggestions.map((s) => (
              <li key={s.placeId}>
                <button
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-ink-50"
                >
                  <span className="font-medium text-ink-900">{s.primaryText}</span>
                  {s.secondaryText && <span className="block text-xs text-ink-500">{s.secondaryText}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Headcount + commute ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="headcount" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Headcount
          </label>
          <div className="flex items-stretch overflow-hidden rounded-md border border-ink-200 bg-white focus-within:border-meter-fill focus-within:ring-2 focus-within:ring-blue-100">
            <button
              type="button"
              aria-label="Decrease headcount"
              onClick={() => onChange({ ...value, headcount: Math.max(1, value.headcount - 5) })}
              className="px-2.5 text-ink-500 hover:bg-ink-50"
            >
              −
            </button>
            <input
              id="headcount"
              type="number"
              min={1}
              max={10000}
              value={value.headcount}
              onChange={(e) => onChange({ ...value, headcount: Math.max(1, Number(e.target.value) || 1) })}
              className="tabular w-full border-x border-ink-100 px-2 py-2 text-center text-sm outline-none"
            />
            <button
              type="button"
              aria-label="Increase headcount"
              onClick={() => onChange({ ...value, headcount: value.headcount + 5 })}
              className="px-2.5 text-ink-500 hover:bg-ink-50"
            >
              +
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-500">Travel by</label>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-ink-200">
            {(['walking', 'driving'] as CommuteMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ ...value, mode: m })}
                className={clsx(
                  'py-2 text-sm capitalize transition',
                  value.mode === m ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-ink-50',
                )}
              >
                {m === 'walking' ? 'Walk' : 'Drive'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label htmlFor="commute" className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Max commute
          </label>
          <span className="tabular text-xs font-medium text-ink-800">
            {value.maxCommuteMinutes} min {value.mode === 'walking' ? 'walk' : 'drive'}
          </span>
        </div>
        <input
          id="commute"
          type="range"
          min={5}
          max={60}
          step={5}
          value={value.maxCommuteMinutes}
          onChange={(e) => onChange({ ...value, maxCommuteMinutes: Number(e.target.value) })}
          className="w-full accent-meter-fill"
        />
      </div>

      {/* ── Event style ───────────────────────────────────────────────────── */}
      <div>
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-500">Event style</span>
        <div className="grid grid-cols-3 overflow-hidden rounded-md border border-ink-200">
          {STYLE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              title={o.hint}
              onClick={() => onChange({ ...value, eventStyle: o.value })}
              className={clsx(
                'px-1 py-2 text-xs transition',
                value.eventStyle === o.value ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-ink-50',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={!canSearch || busy}
        className="w-full rounded-md bg-meter-fill py-2.5 text-sm font-semibold text-white transition hover:bg-meter-strong disabled:cursor-not-allowed disabled:bg-ink-300"
      >
        {busy ? 'Searching…' : 'Find venues'}
      </button>

      {/* ── Advanced ──────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setAdvanced((a) => !a)}
        className="w-full text-left text-xs font-medium text-ink-500 hover:text-ink-800"
      >
        {advanced ? '▾' : '▸'} Priorities, budget and trust filters
      </button>

      {advanced && (
        <div className="space-y-4 rounded-md border border-ink-200 bg-white p-3">
          <div>
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              What matters most
            </span>
            {(['capacity', 'commute', 'price'] as const).map((k) => (
              <div key={k} className="mb-2 last:mb-0">
                <div className="flex items-baseline justify-between">
                  <label htmlFor={`w-${k}`} className="text-xs capitalize text-ink-700">
                    {k === 'capacity' ? 'Capacity fit' : k === 'commute' ? 'Commute' : 'Price fit'}
                  </label>
                  <span className="tabular text-[11px] text-ink-500">{Math.round(value.weights[k] * 100)}</span>
                </div>
                <input
                  id={`w-${k}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={value.weights[k]}
                  onChange={(e) =>
                    onChange({ ...value, weights: { ...value.weights, [k]: Number(e.target.value) } })
                  }
                  className="w-full accent-meter-fill"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => onChange({ ...value, weights: DEFAULT_WEIGHTS })}
              className="text-[11px] text-ink-400 underline hover:text-ink-700"
            >
              reset to defaults
            </button>
          </div>

          <div>
            <label htmlFor="budget" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              Total budget (optional)
            </label>
            <input
              id="budget"
              type="text"
              inputMode="numeric"
              value={budgetInput}
              placeholder="e.g. 15000"
              onChange={(e) => {
                setBudgetInput(e.target.value)
                const n = Number(e.target.value.replace(/[^0-9]/g, ''))
                onChange({ ...value, budgetCents: Number.isFinite(n) && n > 0 ? n * 100 : null })
              }}
              className="w-full rounded-md border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-meter-fill"
            />
            <p className="mt-1 text-[11px] leading-snug text-ink-400">
              Leave blank and price drops out of the ranking entirely rather than being guessed at.
            </p>
          </div>

          <div className="space-y-2">
            <label className="flex items-start gap-2 text-xs text-ink-700">
              <input
                type="checkbox"
                checked={value.verifiedCapacityOnly}
                onChange={(e) => onChange({ ...value, verifiedCapacityOnly: e.target.checked })}
                className="mt-0.5 accent-meter-fill"
              />
              <span>
                Only show verified capacity
                <span className="block text-[11px] text-ink-400">
                  Hides anything whose capacity came from a secondary source.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-ink-700">
              <input
                type="checkbox"
                checked={value.includeUnknownCapacity}
                onChange={(e) => onChange({ ...value, includeUnknownCapacity: e.target.checked })}
                className="mt-0.5 accent-meter-fill"
              />
              <span>
                Include venues with no published capacity
                <span className="block text-[11px] text-ink-400">
                  On by default. &ldquo;Call to confirm&rdquo; is a useful answer; silent omission is not.
                </span>
              </span>
            </label>
          </div>
        </div>
      )}
    </form>
  )
}
