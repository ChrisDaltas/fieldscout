/**
 * matchup-override-ops.test.ts — the pure half of the commissioner's matchup
 * override panel (M6A L.E1.12; tasks-M6A §4 rule 15 / R971; PROGRESS §3(h)).
 *
 * The fixtures are 126's OWN `live_scoring_frozen_why` strings
 * (`126:560-571`), so a branch is selected by what the verb really says —
 * never by a test-only spelling (§4 rule 14: the premise is the real one).
 *
 * Probes of the PR (each shown red, then restored):
 *   P2 — `no_changes` answered with a "Saved…" sentence → the no_changes cell;
 *   P3 — the `standings_rebuilt` arm moved ABOVE the freeze arm → the order cell;
 *   P4 — an empty score field coerced to 0 → the parse + gate cells.
 */
import { describe, expect, it } from 'vitest'

import {
  LIVE_SCORING_STOPPED_COPY,
  NO_CHANGES_COPY,
  STANDINGS_AT_FINALIZATION_COPY,
  STANDINGS_REBUILT_COPY,
  WILL_BE_OVERWRITTEN_COPY,
  bypassedCopy,
  overrideOutcome,
  parseScoreDraft,
  scoreDraftOf,
  scoreGate,
  shownScoreDraft,
} from './matchup-override-ops'

const WHY = {
  already: 'already_frozen — this row was overridden before this edit; live scoring was already skipping it (119:634)',
  frozen: 'frozen_by_this_override — score_write_week_batch will skip this matchup for the rest of the week (119:634/:654); un-freezing is a second audited act',
  notFrozen: 'not_frozen — the override flag was NOT set, so score_write_week_batch will overwrite this number on its next drain (119:654); nothing here is permanent until the week closes',
  matchupFinal: 'matchup_already_final — the write door skips a final row regardless of the flag (119:634)',
  weekFinal: 'week_final — live scoring for this week is over; the write door refuses a final week outright (119:566-568)',
} as const

const doc = (over: Partial<Parameters<typeof overrideOutcome>[0]>) => ({
  no_changes: false,
  live_scoring_frozen: false,
  live_scoring_frozen_why: WHY.weekFinal,
  standings_rebuilt: false,
  ...over,
})

describe('overrideOutcome — one sentence per branch of 126’s result document, never a bare "Saved."', () => {
  it('no_changes is its OWN state and does NOT say "saved" — nothing was written (Chris’s one condition)', () => {
    // A no-op document as 126 writes it: nothing frozen BY THIS call, nothing rebuilt.
    const out = overrideOutcome(doc({ no_changes: true, live_scoring_frozen: true, live_scoring_frozen_why: WHY.already, standings_rebuilt: false }))
    expect(out.branch).toBe('no_changes')
    expect(out.text).toBe(NO_CHANGES_COPY)
    expect(out.text).not.toMatch(/saved/i)
    expect(out.tone).toBe('neutral')
  })

  it('Q61’s freeze: "saved, and live scoring for this matchup has stopped" — for a fresh freeze and an already-frozen row alike', () => {
    for (const why of [WHY.frozen, WHY.already]) {
      const out = overrideOutcome(doc({ live_scoring_frozen: true, live_scoring_frozen_why: why }))
      expect(out.branch, why).toBe('live_scoring_stopped')
      expect(out.text).toBe(LIVE_SCORING_STOPPED_COPY)
      expect(out.text).toMatch(/^Saved, and live scoring for this matchup has stopped/)
    }
  })

  it('a FINAL week: "saved, standings rebuilt"', () => {
    const out = overrideOutcome(doc({ standings_rebuilt: true, live_scoring_frozen_why: WHY.weekFinal }))
    expect(out.branch).toBe('standings_rebuilt')
    expect(out.text).toBe(STANDINGS_REBUILT_COPY)
    expect(out.text).toMatch(/^Saved, standings rebuilt/)
  })

  it('an open week with nothing frozen by it (a final matchup row): "saved, standings will follow at finalization"', () => {
    const out = overrideOutcome(doc({ live_scoring_frozen_why: WHY.matchupFinal }))
    expect(out.branch).toBe('standings_at_finalization')
    expect(out.text).toBe(STANDINGS_AT_FINALIZATION_COPY)
  })

  it('126’s `not_frozen` state — the write will be OVERWRITTEN — is said, in caution, never as a plain save', () => {
    const out = overrideOutcome(doc({ live_scoring_frozen_why: WHY.notFrozen }))
    expect(out.branch).toBe('will_be_overwritten')
    expect(out.text).toBe(WILL_BE_OVERWRITTEN_COPY)
    expect(out.tone).toBe('caution')
  })

  it('ORDER (R971 / rule 15): a consequence arm wins over the standings arm when a document carries both', () => {
    // Not a shape 126 emits today (a final week is never frozen) — which is
    // exactly why the ORDER is pinned rather than left to the fixture.
    expect(overrideOutcome(doc({ live_scoring_frozen: true, live_scoring_frozen_why: WHY.frozen, standings_rebuilt: true })).branch).toBe('live_scoring_stopped')
    expect(overrideOutcome(doc({ live_scoring_frozen_why: WHY.notFrozen, standings_rebuilt: true })).branch).toBe('will_be_overwritten')
    // …and no_changes wins over everything.
    expect(overrideOutcome(doc({ no_changes: true, live_scoring_frozen_why: WHY.notFrozen, standings_rebuilt: true })).branch).toBe('no_changes')
  })

  it('every "it saved" sentence names a consequence — none is a bare "Saved."', () => {
    for (const text of [WILL_BE_OVERWRITTEN_COPY, LIVE_SCORING_STOPPED_COPY, STANDINGS_REBUILT_COPY, STANDINGS_AT_FINALIZATION_COPY]) {
      expect(text).toMatch(/^Saved/)
      expect(text.replace(/^Saved[.,—\s]*/, '').length).toBeGreaterThan(20)
    }
  })
})

describe('bypassedCopy — the rules the override walked past, rendered back', () => {
  it('names them; says nothing when there are none', () => {
    expect(bypassedCopy(['week_final', 'matchup_final'])).toBe('This correction walked past: week_final, matchup_final.')
    expect(bypassedCopy([])).toBeNull()
    expect(bypassedCopy(null)).toBeNull()
  })
})

describe('the score draft — an empty field is NOT a zero', () => {
  it('parses what a fantasy score looks like, and nothing else', () => {
    expect(parseScoreDraft('71.5')).toBe(71.5)
    expect(parseScoreDraft(' 102.25 ')).toBe(102.25)
    expect(parseScoreDraft('0')).toBe(0)
    expect(parseScoreDraft('-3.2')).toBe(-3.2)
    // R1063: the two shapes a person types on the way to a number ARE numbers.
    expect(parseScoreDraft('.5')).toBe(0.5)
    expect(parseScoreDraft('12.')).toBe(12)
    expect(parseScoreDraft('-.25')).toBe(-0.25)
    for (const bad of ['', '   ', 'abc', '12.345', '.125', '1e3', '.', '-', '-.', 'NaN', 'Infinity', '7,5']) {
      expect(parseScoreDraft(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('R1064: an UNTOUCHED field follows the stored score through a live tick; TYPED text — the empty string included — is never overwritten', () => {
    expect(shownScoreDraft(null, 71.5)).toBe('71.5')
    expect(shownScoreDraft(null, 74.1)).toBe('74.1') // the tick landed: the field moved with it
    expect(shownScoreDraft(null, null)).toBe('')
    expect(shownScoreDraft('80', 74.1)).toBe('80')
    expect(shownScoreDraft('', 74.1)).toBe('') // he cleared it — clearing is typing
  })

  it('a pending (NULL) stored score starts as an EMPTY field, a stored one as its number', () => {
    expect(scoreDraftOf(null)).toBe('')
    expect(scoreDraftOf(71.5)).toBe('71.5')
    expect(scoreDraftOf(0)).toBe('0')
  })
})

describe('scoreGate — why Save is disabled is SAID (standing rule (h))', () => {
  const names = { homeName: 'Alpha', awayName: 'Bravo' }

  it('both numbers ⇒ ok, carrying the numbers that will be sent', () => {
    expect(scoreGate({ ...names, homeDraft: '71.5', awayDraft: '35' })).toStrictEqual({ ok: true, home: 71.5, away: 35 })
  })

  it('a missing or malformed side ⇒ not ok, and the sentence names WHICH team', () => {
    const home = scoreGate({ ...names, homeDraft: '', awayDraft: '35' })
    expect(home.ok).toBe(false)
    expect(!home.ok && home.why).toContain('Alpha')
    const away = scoreGate({ ...names, homeDraft: '71.5', awayDraft: 'x' })
    expect(away.ok).toBe(false)
    expect(!away.ok && away.why).toContain('Bravo')
  })

  it('an UNCHANGED pair is NOT gated here — the no-op is the verb’s to name (`no_changes`), across every dimension', () => {
    expect(scoreGate({ ...names, homeDraft: '71.5', awayDraft: '35' }).ok).toBe(true)
  })
})