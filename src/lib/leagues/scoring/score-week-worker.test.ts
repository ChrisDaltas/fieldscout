/**
 * score-week-worker.test.ts — the PURE half of L.D2.2 (tasks-M4 §6 item 5;
 * spec §7.3.3 / §23.5 / E61 / §23.3; PROGRESS D292 / D321; F22 + F23's
 * discharge pins, F262(d)'s lineage walk, Q42's reading).
 *
 * Every literal below is HAND-COMPUTED on paper before the first run (the
 * D62 discipline — the arithmetic is written out beside each pin, never
 * derived from the code under test). The stack half
 * (`score-week-worker-db.test.ts`) drives the same rows through the queue,
 * the map, and the door.
 *
 * THE F23 PIN + ITS NEGATIVE CONTROL: `scoreStarter` composes
 * `deriveTierIndicators` BEFORE `scorePlayerWeek`. The D/ST literal 15.00
 * can only be produced by that composition; the negative control runs the
 * same line WITHOUT the derive and shows the signature a skip leaves —
 * tier points delivered as ZERO (13.00) with every tier rules key pending —
 * which, through the worker, is a PENDING team (null), never a silent 13.00.
 * The DoD probe (delete the derive at the call site) reds the D/ST pin and
 * the team total; this file's negative control is what it reds INTO.
 */
import { describe, expect, it } from 'vitest'

import { scorePlayerWeek } from './calculator'
import { deliveredLine, instantMicros, type StatLineRow } from './score-week-worker'
import {
  ADVANCED_KEYS,
  applicableKeys,
  assertSnapshotScorable,
  bookOwnerForWeek,
  computeTeamWeek,
  cutsOf,
  irKeysOf,
  normalizePosition,
  scoreStarter,
  startersOf,
  type TeamRow,
} from './score-week-worker'
import { forkTemplateDoc, resolveRules } from './rules-doc'
import { SCORING_TEMPLATES } from './templates'

const template = (name: string): Record<string, number> => {
  const found = SCORING_TEMPLATES.find((t) => t.name === name)
  if (!found) throw new Error(`no template named ${name}`)
  return found.rules
}

const ESPN = template('ESPN Standard')

/** A `player_stats`-shaped row: the column surface as ingestion writes it
 *  (absent columns read 0 — the column DEFAULT), plus `advanced`. */
function row(playerId: string, columns: Record<string, number>, advanced: Record<string, number> = {}): StatLineRow {
  return { player_id: playerId, updated_at: '2099-09-13T20:00:00.000Z', advanced, ...columns }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Team ALPHA under ESPN Standard — six starters, hand-computed.
 *
 *   QB  pass_yards 312 × 0.04 = 12.48 · pass_tds 3 × 4 = 12 · INT 1 × −2 = −2
 *       · rush_yards 21 × 0.1 = 2.1 · sacks_taken 2 (qb_sack_taken — no ESPN
 *       rules key, ignored)                              → 12.48 + 12 − 2 + 2.1 = 24.58
 *   RB  rush_yards 87 × 0.1 = 8.7 · rush_tds 1 × 6 = 6 · receptions 4 × 0 = 0
 *       · receiving_yards 33 × 0.1 = 3.3 · fumbles_lost 1 × −2 = −2 → 8.7 + 6 + 3.3 − 2 = 16.00
 *   WR  receptions 7 × 0 = 0 · receiving_yards 115 × 0.1 = 11.5 · receiving_tds 1 × 6 = 6
 *       · rec_2pt 1 × 2 = 2                                            → 19.50
 *   K   fg_0_39 2 × 3 = 6 · fg_40_49 1 × 4 = 4 · fg_50_plus 1 × 5 = 5 · pat_made 3 × 1 = 3
 *       · fg_missed 1 × −1 = −1                                        → 17.00
 *       (`receptions` is an ESPN rules key a K can never deliver — INAPPLICABLE, not pending)
 *   DST def_sack 3 × 1 = 3 · def_int 1 × 2 = 2 · def_fumble_rec 1 × 2 = 2 · def_td 1 × 6 = 6
 *       · PA 19 → def_pa_18_27 (0) · YA 249 → def_ya_200_299 (+2)      → 13 + 0 + 2 = 15.00
 *       (L.A1.10's D/ST week under ESPN: the parity pin reads 15.00 too — the same pipeline)
 *   TE  no stat line                                                   → 0 (no_stat_row)
 *
 *   ALPHA = 24.58 + 16.00 + 19.50 + 17.00 + 15.00 + 0 = 92.08
 * ───────────────────────────────────────────────────────────────────────── */
const QB1 = row('sw-qb1', { pass_yards: 312, pass_tds: 3, interceptions: 1, rush_yards: 21, sacks_taken: 2 })
const RB1 = row('sw-rb1', { rush_yards: 87, rush_tds: 1, receptions: 4, receiving_yards: 33, fumbles_lost: 1 })
const WR1 = row('sw-wr1', { receptions: 7, receiving_yards: 115, receiving_tds: 1, rec_2pt: 1 })
const K1 = row('sw-k1', { fg_0_39: 2, fg_made_40_plus: 1, fg_made_50_plus: 1, xp_made: 3, fg_missed: 1 })
const DST1 = row('sw-dst1', {
  def_sacks: 3,
  def_interceptions: 1,
  def_fumble_recoveries: 1,
  def_tds: 1,
  def_points_allowed: 19,
  def_yards_allowed: 249,
})

const ALPHA_STARTERS = [
  { player_id: 'sw-qb1', position: 'QB' },
  { player_id: 'sw-rb1', position: 'RB' },
  { player_id: 'sw-wr1', position: 'WR' },
  { player_id: 'sw-k1', position: 'K' },
  { player_id: 'sw-dst1', position: 'DST' },
  { player_id: 'sw-te1', position: 'TE' },
]
const ALPHA_STATS = new Map<string, StatLineRow>([
  ['sw-qb1', QB1],
  ['sw-rb1', RB1],
  ['sw-wr1', WR1],
  ['sw-k1', K1],
  ['sw-dst1', DST1],
])

describe('the production composition — resolveRules ∘ deriveTierIndicators → scorePlayerWeek (F23), per-player rounding (F22)', () => {
  it('hand-computed per-starter literals under ESPN Standard (D62)', () => {
    expect(scoreStarter(ESPN, 'sw-qb1', 'QB', QB1)).toEqual({ player_id: 'sw-qb1', position: 'QB', points: 24.58, pending: [], reason: 'scored' })
    expect(scoreStarter(ESPN, 'sw-rb1', 'RB', RB1)).toEqual({ player_id: 'sw-rb1', position: 'RB', points: 16.0, pending: [], reason: 'scored' })
    expect(scoreStarter(ESPN, 'sw-wr1', 'WR', WR1)).toEqual({ player_id: 'sw-wr1', position: 'WR', points: 19.5, pending: [], reason: 'scored' })
    expect(scoreStarter(ESPN, 'sw-k1', 'K', K1)).toEqual({ player_id: 'sw-k1', position: 'K', points: 17.0, pending: [], reason: 'scored' })
    expect(scoreStarter(ESPN, 'sw-dst1', 'DST', DST1)).toEqual({ player_id: 'sw-dst1', position: 'DST', points: 15.0, pending: [], reason: 'scored' })
  })

  it('team ALPHA = 92.08 — the sum of the starters’ ROUNDED points; the TE without a line scores 0 and is NAMED (Q42), never pending', () => {
    const alpha = computeTeamWeek(ESPN, 'team-alpha', ALPHA_STARTERS, ALPHA_STATS)
    expect(alpha.points).toBe(92.08)
    expect(alpha.pending).toEqual([])
    expect(alpha.no_stat_row).toEqual(['sw-te1'])
    expect(alpha.starters.find((s) => s.player_id === 'sw-te1')).toEqual({
      player_id: 'sw-te1',
      position: 'TE',
      points: 0,
      pending: [],
      reason: 'no_stat_row',
    })
  })

  it('NEGATIVE CONTROL (the F23 signature): the same D/ST line WITHOUT the derive scores 13.00 with all 17 ESPN tier keys pending — the worker composes the derive, so the pin above reads 15.00', () => {
    const skipped = scorePlayerWeek(resolveRules(ESPN, 'DST'), deliveredLine(DST1, 'DST'))
    expect(skipped.total).toBe(13.0)
    const tierPending = skipped.pending.filter((k) => k.startsWith('def_pa_') || k.startsWith('def_ya_'))
    expect(tierPending).toHaveLength(17)
    // Through the worker that signature is LOUD: the D/ST tier keys are in
    // D/ST's scope, so a starter scored that way would be PENDING and his
    // team NULL — the probe reds the literal into a null, never a 13.00.
    expect([...applicableKeys('DST')].filter((k) => tierPending.includes(k))).toHaveLength(17)
  })

  it('F22 — per-player rounding happens BEFORE the team sum (§7.3.3): two starters at 10.025 are 10.03 + 10.03 = 20.06, not round(20.05) = 20.05', () => {
    // A 3-decimal coefficient is deliberate: templates pay 0.04 / 0.1 / 0.5,
    // which never land on a half-cent, so the discriminating literal needs
    // 0.025 × 401 = 10.025 per player (format 1 carries no bounds law).
    const doc = { pass_yards: 0.025 }
    const a = row('sw-a', { pass_yards: 401 })
    const b = row('sw-b', { pass_yards: 401 })
    const team = computeTeamWeek(
      doc,
      't',
      [
        { player_id: 'sw-a', position: 'QB' },
        { player_id: 'sw-b', position: 'QB' },
      ],
      new Map([
        ['sw-a', a],
        ['sw-b', b],
      ]),
    )
    expect(team.starters.map((s) => s.points)).toEqual([10.03, 10.03])
    expect(team.points).toBe(20.06)
    // And the JS value is what reaches the door: scale ≤ 2 (the door refuses
    // a third decimal — F22's no-DB-rounding pin lives at the writer,
    // shown on the stack).
    expect(String(team.points)).toMatch(/^-?\d+(\.\d{1,2})?$/)
  })

  it('float noise in a sum of two-decimal values is snapped, never stored (0.1 + 0.2 territory)', () => {
    const doc = { rush_yards: 0.1 }
    const team = computeTeamWeek(
      doc,
      't',
      [
        { player_id: 'p', position: 'RB' },
        { player_id: 'q', position: 'RB' },
        { player_id: 'r', position: 'RB' },
      ],
      new Map([
        ['p', row('p', { rush_yards: 1 })],
        ['q', row('q', { rush_yards: 2 })],
        ['r', row('r', { rush_yards: 4 })],
      ]),
    )
    expect(team.points).toBe(0.7) // 0.1 + 0.2 + 0.4 = 0.7000000000000001 in binary floats
  })
})

describe('E61 — pending, never zero; scoped to what the position can deliver', () => {
  /** A planted snapshot paying the D15 charted placeholder (no shipped doc
   *  can — the walls refuse a `reserved` key; the pipeline must still carry
   *  the two-phase semantics, §23.5). */
  const CHARTED = { ...ESPN, example_charted_yards: 0.1 }

  it('a starter whose line lacks a paid advanced key is PENDING and his team is null; the key arriving settles him (19.50 + 40 × 0.1 = 23.50)', () => {
    const before = computeTeamWeek(CHARTED, 'v1', [{ player_id: 'sw-wr1', position: 'WR' }], new Map([['sw-wr1', WR1]]))
    expect(before.points).toBeNull()
    expect(before.pending).toEqual([{ player_id: 'sw-wr1', keys: ['example_charted_yards'] }])
    expect(before.starters[0].points).toBe(19.5) // the provisional part, reported, never written as the score

    const settled = row('sw-wr1', { receptions: 7, receiving_yards: 115, receiving_tds: 1, rec_2pt: 1 }, { example_charted_yards: 40 })
    const after = computeTeamWeek(CHARTED, 'v1', [{ player_id: 'sw-wr1', position: 'WR' }], new Map([['sw-wr1', settled]]))
    expect(after.points).toBe(23.5)
    expect(after.pending).toEqual([])
  })

  it('an advanced key PRESENT at 0 is a delivered zero (scored), not pending', () => {
    const zero = row('sw-wr1', { receiving_yards: 115 }, { example_charted_yards: 0 })
    const team = computeTeamWeek(CHARTED, 'v1', [{ player_id: 'sw-wr1', position: 'WR' }], new Map([['sw-wr1', zero]]))
    expect(team.points).toBe(11.5)
    expect(team.pending).toEqual([])
  })

  it('a starter with NO line in a charted league is 0 by name, not pending (the bye/inactive/pre-kickoff family, §23.3 — Q42)', () => {
    const team = computeTeamWeek(CHARTED, 'v1', [{ player_id: 'sw-wr1', position: 'WR' }], new Map())
    expect(team.points).toBe(0)
    expect(team.no_stat_row).toEqual(['sw-wr1'])
  })

  it('position scope: a QB under ESPN has 17 tier keys + 5 kicking keys he can never deliver — INAPPLICABLE, so he is not pending; a K is not pending on `receptions`', () => {
    expect(scoreStarter(ESPN, 'sw-qb1', 'QB', QB1).pending).toEqual([])
    expect(scoreStarter(ESPN, 'sw-k1', 'K', K1).pending).toEqual([])
    expect(applicableKeys('K').has('receptions')).toBe(false)
    expect(applicableKeys('WR').has('receptions')).toBe(true)
    expect(applicableKeys('QB').has('def_pa_14_17')).toBe(false)
    expect(applicableKeys('DST').has('def_pa_14_17')).toBe(true)
    expect(applicableKeys('DST').has('def_ya_200_299')).toBe(true)
    for (const key of ADVANCED_KEYS) {
      expect(applicableKeys('K').has(key)).toBe(true) // advanced keys apply everywhere until the registry says otherwise (F263)
    }
  })

  it('a QB row’s def_points_allowed column (0 — the surface default) can never one-hot a shutout tier: the D/ST sources are delivered to D/ST lines only', () => {
    const line = deliveredLine(QB1, 'QB')
    expect(line).not.toHaveProperty('def_points_allowed')
    expect(line).not.toHaveProperty('def_yards_allowed')
    expect(deliveredLine(DST1, 'DST')).toMatchObject({ def_points_allowed: 19, def_yards_allowed: 249 })
    // And the whole scope is delivered as zeros when absent (a stored 0 is a
    // delivered zero — never pending): the QB's fumbles_lost reads 0.
    expect(line.fumbles_lost).toBe(0)
  })

  it('R58 — an unmappable D/ST source (a fractional PA) withholds the family: the starter is PENDING (loud), never an all-zero family', () => {
    const corrupt = row('sw-dst1', { def_sacks: 3, def_points_allowed: 13.5, def_yards_allowed: 249 })
    const s = scoreStarter(ESPN, 'sw-dst1', 'DST', corrupt)
    expect(s.pending.filter((k) => k.startsWith('def_pa_'))).toHaveLength(8)
    expect(s.pending.filter((k) => k.startsWith('def_ya_'))).toHaveLength(0)
  })

  it('a format-2 fork scores against its OWN cuts (§7.3.3.1(a)): an ESPN fork’s D/ST week is the same 15.00, and cutsOf hands the document’s tiers to the derive', () => {
    const fork = forkTemplateDoc(ESPN)
    expect(cutsOf(fork)).toEqual(fork.tier_cuts)
    expect(cutsOf(ESPN)).toBeUndefined()
    expect(scoreStarter(fork, 'sw-dst1', 'DST', DST1).points).toBe(15.0)
    expect(computeTeamWeek(fork, 'team-alpha', ALPHA_STARTERS, ALPHA_STATS).points).toBe(92.08)
  })
})

describe('D292 — the corrupt-snapshot gate (quarantine the league, never the batch)', () => {
  it('a non-finite coefficient throws the calculator’s TypeError naming the key', () => {
    expect(() => assertSnapshotScorable({ ...ESPN, pass_yards: 'corrupt' })).toThrow(/scoring_rules_snapshot corrupt: .*pass_yards/)
  })
  it('an unknown envelope version throws the resolver’s TypeError', () => {
    expect(() => assertSnapshotScorable({ format: 3, base: {}, positions: {} })).toThrow(TypeError)
  })
  it('a NULL snapshot is `snapshot_missing`', () => {
    expect(() => assertSnapshotScorable(null)).toThrow(/^snapshot_missing/)
  })
  it('a template and a fresh fork both pass', () => {
    expect(() => assertSnapshotScorable(ESPN)).not.toThrow()
    expect(() => assertSnapshotScorable(forkTemplateDoc(ESPN))).not.toThrow()
  })
})

describe('lineups — starters from the canonical slot_map; IR and bench excluded', () => {
  it('startersOf reads every starting-slot value and drops IR keys; a non-object map is null (named by the caller)', () => {
    const ir = irKeysOf({ ir_slots: [{ key: 'ir1' }, { key: 'ir2' }] })
    expect([...ir]).toEqual(['ir1', 'ir2'])
    expect(startersOf({ 'qb:0': 'a', 'rb:0': 'b', 'rb:1': 'c', 'ir1:0': 'd', 'wr:0': '' }, ir)).toEqual(['a', 'b', 'c'])
    expect(startersOf(null, ir)).toBeNull()
    expect(startersOf([], ir)).toBeNull()
    expect(startersOf({}, ir)).toEqual([])
    expect([...irKeysOf(null)]).toEqual([])
  })
})

describe('F262(d) — the book owner of a week walks the lineage backward', () => {
  const teams = new Map<string, TeamRow>([
    ['P', { id: 'P', status: 'retired', retired_at_week: 3, successor_team_id: 'S' }],
    ['S', { id: 'S', status: 'orphaned', retired_at_week: null, successor_team_id: null }],
    ['Q', { id: 'Q', status: 'active', retired_at_week: null, successor_team_id: null }],
    ['PP', { id: 'PP', status: 'retired', retired_at_week: 2, successor_team_id: 'P' }],
  ])
  it('P retired at week 3: weeks 1–2 are P’s book (and week 1 is PP’s, two seals back); week 3 on is S’s', () => {
    expect(bookOwnerForWeek('S', 1, teams)).toBe('PP')
    expect(bookOwnerForWeek('S', 2, teams)).toBe('P')
    expect(bookOwnerForWeek('S', 3, teams)).toBe('S')
    expect(bookOwnerForWeek('S', 9, teams)).toBe('S')
    expect(bookOwnerForWeek('Q', 1, teams)).toBe('Q')
  })
})

describe('position vocabulary', () => {
  it('the feed’s DEF is the document’s DST; case is normalised', () => {
    expect(normalizePosition('DEF')).toBe('DST')
    expect(normalizePosition('qb')).toBe('QB')
    expect(normalizePosition(' K ')).toBe('K')
  })
  it('a D/ST starter stored as DEF scores through the DST override path', () => {
    expect(scoreStarter(ESPN, 'sw-dst1', normalizePosition('DEF'), DST1).points).toBe(15.0)
  })
})

describe('R867 — instants at MICROSECOND precision (the readiness comparand; the ack never re-renders)', () => {
  // 2099-09-13T20:00:00Z on paper: 1970-01-01 → 2099-01-01 is 129 years with
  // 32 leap days (1972…2096) = 129 × 365 + 32 = 47,117 days; Jan–Aug of 2099
  // = 243 days, + 12 → 47,372 days; × 86,400 = 4,092,940,800 s; + 20 h
  // (72,000 s) = 4,093,012,800 s.
  const T = 4_093_012_800
  it('a millisecond ISO string and PostgREST’s +00:00 rendering are the same instant', () => {
    expect(instantMicros('2099-09-13T20:00:00.000Z')).toBe(T * 1_000_000)
    expect(instantMicros('2099-09-13T20:00:00+00:00')).toBe(T * 1_000_000)
    expect(instantMicros('2099-09-13 20:00:00+00')).toBe(T * 1_000_000) // Postgres text form
  })
  it('six fractional digits survive — and two stamps 1 µs apart are DIFFERENT instants (a Date round-trip made them equal)', () => {
    const a = instantMicros('2099-09-13T20:00:00.123456+00:00')
    const b = instantMicros('2099-09-13T20:00:00.123455Z')
    expect(a).toBe(T * 1_000_000 + 123_456)
    expect(a - b).toBe(1)
    // the millisecond round-trip the old readiness compare used:
    expect(new Date('2099-09-13T20:00:00.123456Z').toISOString()).toBe(new Date('2099-09-13T20:00:00.123455Z').toISOString())
  })
  it('trailing zeros trimmed by Postgres pad, not shift: .1 is 100,000 µs; .12 is 120,000', () => {
    expect(instantMicros('2099-09-13T20:00:00.1+00:00')).toBe(T * 1_000_000 + 100_000)
    expect(instantMicros('2099-09-13T20:00:00.12+00:00')).toBe(T * 1_000_000 + 120_000)
  })
  it('a non-UTC offset is honoured: 22:00+02:00 is 20:00Z', () => {
    expect(instantMicros('2099-09-13T22:00:00+02:00')).toBe(T * 1_000_000)
    expect(instantMicros('2099-09-13T22:00:00.5+0200')).toBe(T * 1_000_000 + 500_000)
  })
  it('garbage is refused loudly, never read as the epoch', () => {
    expect(() => instantMicros('nope')).toThrow(/unparseable instant/)
    expect(() => instantMicros('')).toThrow(/unparseable instant/)
  })
})
