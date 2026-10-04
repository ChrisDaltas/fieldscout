/**
 * friendly-messages.test.ts — the one cleaner between a server refusal and
 * the member's screen (friendly server messages, part 1; PROGRESS D481).
 *
 *   1. PHRASE PINS: every phrase-map fragment is asserted present in the
 *      newest defining migration's text, so a SQL rewording fails HERE
 *      rather than silently falling back to the generic cleanup.
 *   2. Each phrase renders from a stored-literal server sentence (values
 *      pulled out), and falls back to its generic form — never an invented
 *      value — when they can't be.
 *   3. GENERIC cells, one per cleanup rule.
 *   4. CENSUS: the 315 P0001 state refusals of the 2026-10-03 survey
 *      (`friendly-messages.census.json`, newest-definition text) come out
 *      with no `§`, no ledger code and no snake_case.
 *
 * Golden values are stored literals (§4.3). Pure — no stack required.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import census from './friendly-messages.census.json'
import { PHRASES, cleanServerText, friendlyMessage, matchPhrase } from './friendly-messages'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
/** SQL literal text: a doubled quote is one apostrophe. */
const sqlText = (file: string) => readFileSync(join(MIGRATIONS, file), 'utf8').replace(/''/g, "'")

const JARGON = { section: /§/, ledger: /\b(?:[EQRFD]\d+|M\d+)\b/, snake: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/ }

describe('phrase map — every fragment is in the CURRENT SQL text (drift fails loudly)', () => {
  it.each(PHRASES.map((p) => [p.id, p] as const))('%s', (_id, phrase) => {
    const text = sqlText(phrase.migration)
    for (const fragment of phrase.fragments) expect(text, `${phrase.migration} lost "${fragment}"`).toContain(fragment)
  })
  it('ids are unique and the map covers the survey’s top 10 and more (≥ 40)', () => {
    expect(new Set(PHRASES.map((p) => p.id)).size).toBe(PHRASES.length)
    expect(PHRASES.length).toBeGreaterThanOrEqual(40)
  })
})

// Server sentences as the RPCs raise them, `%` filled in (stored literals).
const CASES: ReadonlyArray<readonly [string, string, string]> = [
  ['lineup-kicked-off',
    `set_lineup: Josh Allen's game kicked off at 2099-09-13 17:00:00+00 (kickoff) — a player whose game has started cannot enter or move slots (§11.2, lineup_lock = per_player_kickoff); wanted "QB:0"`,
    'Josh Allen’s game has started — he’s locked and can’t be moved into or out of your lineup.'],
  ['lineup-slot-locked',
    `set_lineup: slot FLEX:0 is locked — Bijan Robinson kicked off at 2099-09-13 17:00:00+00 (kickoff) and a locked slot's player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable`,
    'That spot is locked — Bijan Robinson’s game has started.'],
  ['add-locked',
    'roster_add_drop: Puka Nacua (p-9) is locked for adds — kicked off at 2099-09-13 17:00 (kickoff); week 2 clears at 2099-09-15T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
    'Puka Nacua’s game has started — you can pick him up after the week’s games end.'],
  ['drop-locked',
    'roster_add_drop: Puka Nacua (p-9) is locked for drops — kicked off at 2099-09-13 17:00 (kickoff); week 2 clears at 2099-09-15T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game',
    'Puka Nacua’s game has started — you can’t drop him until the week’s games end.'],
  ['roster-full',
    "roster_add_drop: Alpha's roster is full (16 of 16 — §7.3.2 roster_size) — include a drop in the same move (§13.1)",
    'Your roster is full (16/16). Pick a player to drop.'],
  ['on-waivers-until',
    'roster_add_drop: Puka Nacua (p-9) is on waivers until the waiver run at 2099-09-16 07:00:00+00 (Wed 2099-09-16 03:00 America/New_York) — put in a waiver claim; he is not an instant pickup until that run has been processed (§7.3.4/§13.1)',
    'Puka Nacua is on waivers until Wed 2099-09-16 03:00 America/New_York. Put in a claim instead.'],
  ['trade-deadline',
    'trade_propose: the trade deadline has passed — trades could be proposed until week 12 began (Wed, Nov 25 12:00 AM ET; trade_deadline_week 11, §13.3 / Q76)',
    'The trade deadline has passed — trades closed when week 12 began (Wed, Nov 25 12:00 AM ET).'],
  ['trade-overflow',
    "trade_propose: Alpha's roster would hold 18 players after this trade — 2 more than its 16 spots (§7.3.2 roster_size): name 2 more drop(s) as part of the trade (E36)",
    'Alpha would be 2 over the roster limit — pick 2 more players to drop.'],
  ['auction-max-bid',
    'draft_place_bid: draft_place_bid: $40 is over your max bid of $31 — you have $45 for 15 open roster spots at a $1 per-slot reserve (§8.6.1/E5)',
    'Your max bid is $31 ($45 left for 15 open spots).'],
  ['lineup-played-starter',
    `set_lineup: Josh Allen already played this week — his start stays (slot "QB:0": his game kicked off at 2099-09-13 (kickoff); he has left Alpha's roster since, and a played starter is stuck in the lineup for the week — §11.2, Q32; the week is scored from this lineup, §7.3.3)`,
    'Josh Allen already played this week, so he stays in your lineup until the week ends.'],
  ['week-pickup-cap',
    'roster_add_drop: Alpha has used 3 of 3 acquisitions in week 4 (acquisitions_per_week, §7.3.4) — no more adds this week',
    'You’ve used all 3 pickups for week 4.'],
  ['min-bid',
    "waiver_claim_submit: a bid of $0 is below this league's minimum bid of $1 (faab_min_bid, §7.3.4)",
    'The minimum bid is $1.'],
]

describe('phrase map — renders the member’s sentence from the server’s own values', () => {
  it.each(CASES)('%s', (id, raw, want) => {
    expect(matchPhrase(raw)?.id).toBe(id)
    expect(friendlyMessage(raw)).toBe(want)
  })
  it('a value that can’t be pulled out gives the generic sentence — never an invented one', () => {
    // The fragments match but the leading "Name (id)" shape is gone.
    const odd = 'roster_add_drop: ??? is locked for adds — kicked off at x; no in-game pickups'
    expect(matchPhrase(odd)?.id).toBe('add-locked')
    expect(friendlyMessage(odd)).toBe('That player’s game has started — you can pick him up after the week’s games end.')
  })
})

describe('generic cleanup — one cell per rule', () => {
  it('drops a bracketed group citing §, a ledger code or a snake_case name; keeps a plain one', () => {
    expect(cleanServerText('x (§13.3 / Q77) y')).toBe('x y')
    expect(cleanServerText('x (E36)')).toBe('x')
    expect(cleanServerText('x (roster_size)')).toBe('x')
    expect(cleanServerText('x (2 of 3)')).toBe('x (2 of 3)')
    expect(cleanServerText('x (Wed, Nov 25; trade_deadline_week 11)')).toBe('x (Wed, Nov 25)')
    expect(cleanServerText('x (§8.6.7(c)/E27)')).toBe('x')
    expect(cleanServerText('x (Q34(B))')).toBe('x')
  })
  it('strips fn_name: prefixes anywhere, not just at the start', () => {
    expect(cleanServerText('draft_place_bid: draft_place_bid: your bid is low')).toBe('your bid is low')
    expect(cleanServerText('the vote failed — trade_vote: you can’t vote')).toBe('the vote failed — you can’t vote')
    expect(cleanServerText('Heads up: the draft is paused')).toBe('Heads up: the draft is paused')
  })
  it('cuts a trailing "— … (§/E…)" clause that explains the rule; keeps one that tells the member what to do', () => {
    expect(cleanServerText('slot is locked — a locked slot never moves (§11.2)')).toBe('slot is locked')
    expect(cleanServerText('you already have 3 active mock drafts — finish or delete one first (§22.5)')).toBe(
      'you already have 3 active mock drafts — finish or delete one first',
    )
  })
  it('swaps known setting names for words; any other snake_case is spaced out', () => {
    expect(cleanServerText('lineups are set only while in_season')).toBe('lineups are set only while in season')
    expect(cleanServerText('waiver type none_fcfs')).toBe('waiver type no waivers')
    expect(cleanServerText('no league_weeks rows')).toBe('no league weeks rows')
  })
  it('drops bare citations in running text', () => {
    expect(cleanServerText('the audited path (M6), per §7.3 and E32')).toBe('the audited path, per and')
  })
})

describe('census — the 315 P0001 refusals of the survey come out code-free', () => {
  const rows = census as Array<{ loc: string; fn: string; text: string }>
  it('the fixture is the survey’s full P0001 list', () => {
    expect(rows).toHaveLength(315)
  })
  it('no §, no ledger code, no snake_case remains in any of them', () => {
    const left = rows
      .map((r) => ({ loc: r.loc, out: friendlyMessage(r.text) }))
      .filter((r) => Object.values(JARGON).some((re) => re.test(r.out)))
    expect(left).toEqual([])
  })
  it('the phrase map takes the survey’s hand-rewritten rows', () => {
    const mapped = rows.filter((r) => matchPhrase(r.text) !== null).length
    expect(mapped).toBeGreaterThanOrEqual(55)
  })
})
