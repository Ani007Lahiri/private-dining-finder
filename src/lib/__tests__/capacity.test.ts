import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessCapacity } from '../capacity'
import type { VenueSpace } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Feasibility solver regression + edge-case tests.
//
// The solver answers "is there SOME configuration of this venue's rooms that
// holds the group under this event style", and returns the configuration. It is
// the whole product — a wrong answer here is the app failing. These tests cover
// the two shipped bugs as named regressions plus the core edge cases.
//
// Fixtures use the denormalised seatedCap/standingCap columns on VenueSpace and
// pass no evidence rows, so they exercise the solver's combination/ceiling/
// buyout logic directly without depending on the parser.
// ─────────────────────────────────────────────────────────────────────────────

let seq = 0
function space(partial: Partial<VenueSpace> & { name: string }): VenueSpace {
  seq += 1
  return {
    id: `s${seq}`,
    venueId: 'v1',
    name: partial.name,
    seatedCap: partial.seatedCap ?? null,
    standingCap: partial.standingCap ?? null,
    isBuyout: partial.isBuyout ?? false,
    combinableGroup: partial.combinableGroup ?? null,
    isComposite: partial.isComposite ?? false,
    minSpendCents: partial.minSpendCents ?? null,
    minSpendPeriod: partial.minSpendPeriod ?? null,
  }
}

test('single room that fits is returned as a single configuration', () => {
  const spaces = [space({ name: 'Private Room', seatedCap: 60 })]
  const a = assessCapacity(spaces, [], 50, 'seated')
  assert.equal(a.unknown, false)
  assert.ok(a.best)
  assert.equal(a.best!.kind, 'single')
  assert.equal(a.best!.capacity, 60)
})

test('a room too small for the group is not returned as feasible', () => {
  const spaces = [space({ name: 'Small Room', seatedCap: 20 })]
  const a = assessCapacity(spaces, [], 80, 'seated')
  assert.equal(a.best, null)
  assert.equal(a.unknown, false)
  assert.match(a.shortfallReason ?? '', /holds 20.*need.*80/i)
})

test('combinable rooms in one group are summed to fit', () => {
  const spaces = [
    space({ name: 'Room A', seatedCap: 40, combinableGroup: 'loft' }),
    space({ name: 'Room B', seatedCap: 40, combinableGroup: 'loft' }),
  ]
  const a = assessCapacity(spaces, [], 70, 'seated')
  assert.ok(a.best)
  assert.equal(a.best!.kind, 'combination')
  assert.equal(a.best!.capacity, 80)
})

test('rooms in DIFFERENT groups are never summed', () => {
  const spaces = [
    space({ name: 'Room A', seatedCap: 40, combinableGroup: 'g1' }),
    space({ name: 'Room B', seatedCap: 40, combinableGroup: 'g2' }),
  ]
  // Neither single room fits 70, and they cannot be combined across groups.
  const a = assessCapacity(spaces, [], 70, 'seated')
  assert.equal(a.best, null)
})

test('REGRESSION: subdivided ballroom sections cannot combine past the whole-room ceiling', () => {
  // OUTRIGGER Reef: a ballroom published as (full)=225, "3 sections"=135,
  // "2 sections"=90. The bug summed 135 + 90 = 225 into a room that does not
  // exist and ranked it. The composite parent is a physical ceiling: the two
  // subsections must NOT combine into more than the whole they subdivide.
  const spaces = [
    space({ name: 'Grand Ballroom (full)', seatedCap: 225, combinableGroup: 'grand', isComposite: true }),
    space({ name: '3 sections', seatedCap: 135, combinableGroup: 'grand' }),
    space({ name: '2 sections', seatedCap: 90, combinableGroup: 'grand' }),
  ]
  const a = assessCapacity(spaces, [], 220, 'seated')
  // 220 is feasible ONLY via the real published full room (225), never via a
  // 135+90 combination that exceeds the ceiling.
  assert.ok(a.best)
  assert.ok(a.best!.capacity <= 225, `best capacity ${a.best!.capacity} must not exceed the 225 ceiling`)
  // No returned configuration anywhere may exceed the ceiling.
  for (const c of [a.best!, ...a.alternatives]) {
    assert.ok(c.capacity <= 225, `configuration "${c.label}" (${c.capacity}) exceeds the 225 group ceiling`)
  }
})

test('composite (published-combined) rows are offered as single options', () => {
  const spaces = [
    space({ name: 'Coral I/II combined', seatedCap: 110, combinableGroup: 'coral', isComposite: true }),
    space({ name: 'Coral I', seatedCap: 55, combinableGroup: 'coral' }),
    space({ name: 'Coral II', seatedCap: 55, combinableGroup: 'coral' }),
  ]
  const a = assessCapacity(spaces, [], 100, 'seated')
  assert.ok(a.best)
  // The published 110 composite fits and should win over recombining the parts.
  assert.equal(a.best!.capacity, 110)
})

test('reception uses standing capacity, which exceeds the seated figure', () => {
  const spaces = [space({ name: 'Hall', seatedCap: 100, standingCap: 200 })]
  // 180 does not fit seated (100) but does fit standing (200).
  assert.equal(assessCapacity(spaces, [], 180, 'seated').best, null)
  const rec = assessCapacity(spaces, [], 180, 'reception')
  assert.ok(rec.best)
  assert.equal(rec.best!.capacity, 200)
})

test('reception falls back to seated capacity as a safe floor when standing is unpublished', () => {
  const spaces = [space({ name: 'Room', seatedCap: 120, standingCap: null })]
  const a = assessCapacity(spaces, [], 110, 'reception')
  assert.ok(a.best)
  assert.equal(a.best!.capacity, 120)
  assert.equal(a.best!.degradedFromSeated, true) // flagged as an under-estimate
})

test('a full buyout is returned and labelled as a buyout', () => {
  const spaces = [
    space({ name: 'Private Room', seatedCap: 40 }),
    space({ name: 'Entire restaurant', seatedCap: 150, isBuyout: true }),
  ]
  const a = assessCapacity(spaces, [], 140, 'seated')
  assert.ok(a.best)
  assert.equal(a.best!.kind, 'buyout')
  assert.equal(a.best!.capacity, 150)
})

test('headcount exactly equal to capacity fits', () => {
  const spaces = [space({ name: 'Room', seatedCap: 50 })]
  const a = assessCapacity(spaces, [], 50, 'seated')
  assert.ok(a.best)
  assert.equal(a.best!.capacity, 50)
})

test('a room within the 5% undershoot tolerance still fits', () => {
  const spaces = [space({ name: 'Room', seatedCap: 96 })]
  const a = assessCapacity(spaces, [], 100, 'seated') // 96 >= 100*0.95 = 95
  assert.ok(a.best, 'a 4% undershoot should be feasible')
  assert.equal(a.best!.capacity, 96)
})

test('a room beyond the undershoot tolerance does not fit', () => {
  const spaces = [space({ name: 'Room', seatedCap: 90 })]
  const a = assessCapacity(spaces, [], 100, 'seated') // 90 < 95
  assert.equal(a.best, null)
})

test('no spaces with any known capacity reports unknown, not infeasible', () => {
  const spaces = [space({ name: 'Mystery Room', seatedCap: null, standingCap: null })]
  const a = assessCapacity(spaces, [], 50, 'seated')
  assert.equal(a.unknown, true)
  assert.equal(a.best, null)
})

test('the tightest-fitting single room is preferred over a looser one', () => {
  const spaces = [
    space({ name: 'Just right', seatedCap: 55 }),
    space({ name: 'Cavernous', seatedCap: 300 }),
  ]
  const a = assessCapacity(spaces, [], 50, 'seated')
  assert.ok(a.best)
  assert.equal(a.best!.capacity, 55) // tightest fit wins
})
