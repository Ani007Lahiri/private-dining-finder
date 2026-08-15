import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFieldValue } from '../trust'

// ─────────────────────────────────────────────────────────────────────────────
// Field-aware capacity/spend parser regression tests.
//
// The parser exists because real capacity charts are compound strings, and the
// naive "first number wins" reading produced confident-but-wrong figures. Two
// of those bugs are encoded here as named regression fixtures — if either ever
// comes back, one of these fails.
// ─────────────────────────────────────────────────────────────────────────────

test('REGRESSION: square footage is not parsed as a seated capacity', () => {
  // The exact class the audit script caught 15 of: "3,528 sq ft, banquet 320,
  // reception 300". First-number parsing yields 3528 (a square footage). The
  // field-aware parser must strip the area token and read the labelled figure.
  assert.equal(parseFieldValue('3,528 sq ft, banquet 320, reception 300', 'seated_cap'), 320)
  assert.equal(parseFieldValue('3,528 sq ft, banquet 320, reception 300', 'standing_cap'), 300)
})

test('square footage in other unit spellings is stripped', () => {
  assert.equal(parseFieldValue('2,000 square feet — seated dinner for 150', 'seated_cap'), 150)
  assert.equal(parseFieldValue('180 m2 space, reception 240', 'standing_cap'), 240)
})

test('a labelled number after the label is read', () => {
  assert.equal(parseFieldValue('banquet 320', 'seated_cap'), 320)
  assert.equal(parseFieldValue('reception: 300', 'standing_cap'), 300)
})

test('a labelled number before the label is read', () => {
  assert.equal(parseFieldValue('up to 120 guests standing', 'standing_cap'), 120)
  assert.equal(parseFieldValue('15-35 seated', 'seated_cap'), 35) // range → ceiling
})

test('a range resolves to its ceiling, not its floor or first token', () => {
  assert.equal(parseFieldValue('seats 40 to 60 for dinner', 'seated_cap'), 60)
})

test('a "combined" composite figure is read for seated capacity', () => {
  assert.equal(parseFieldValue('14 per sub-room; 52 combined', 'seated_cap'), 52)
})

test('asking for a field the string does not label returns null, never the other field', () => {
  // The string only labels standing/reception; asking for seated must not
  // borrow the reception number.
  assert.equal(parseFieldValue('reception 300', 'seated_cap'), null)
})

test('minimum spend parses dollars and k-suffix, ignoring parentheticals', () => {
  assert.equal(parseFieldValue('$5,000 food & beverage minimum', 'min_spend'), 5000)
  assert.equal(parseFieldValue('$8k minimum spend', 'min_spend'), 8000)
  // A parenthetical lunch figure must not outrank the headline.
  assert.equal(parseFieldValue('$10,000 dinner minimum (lunch $3,000)', 'min_spend'), 10000)
})

test('non-numeric fields are never parsed as numbers', () => {
  assert.equal(parseFieldValue('+1 415 772 9060', 'phone'), null)
  assert.equal(parseFieldValue('events@venue.com', 'email'), null)
})
