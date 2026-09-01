import { describe, expect, it } from 'vitest'

import { LeaguePatchError } from '@/hooks/use-league'
import { scorePlayerWeek } from '@/lib/leagues/scoring/calculator'
import { deriveTierIndicators } from '@/lib/leagues/scoring/derive-stats'
import {
  espnFork,
  template,
  yahooFork,
} from '@/lib/leagues/scoring/parity-fixture'
import {
  resolveRules,
  SCORING_POSITIONS,
  type ScoringPosition,
  type ScoringRulesDocV2,
} from '@/lib/leagues/scoring/rules-doc'
import { YA_CUTS } from '@/lib/leagues/scoring/tier-cuts'
import { SCORABLE_KEYS } from '@/lib/leagues/scoring/validate-rules-doc'

import {
  applyEdit,
  applyTierEdit,
  describeSaveRefusal,
  dstTierTables,
  SAMPLE_PLAYERS,
  sampleLineTotal,
} from './scoring-editor-ops'

/**
 * SE.8 pins: the six live sample lines + the D/ST tier tables
 * (spec §7.3.3.1's sample-players table and D/ST bullet; tasks-SE §5
 * SE.8(1)–(4); D171, D62, F178).
 *
 * Falsifiability notes (§4 rules 3/9; D267/D272(20)):
 *  - every total below is a HAND-COMPUTED stored literal (D62) — the
 *    arithmetic is written out beside each table, never derived by calling
 *    the function under test.
 *  - the prescribed break probe — hand-one-hotting the Seahawks tiers and
 *    bypassing `deriveTierIndicators` — reds the shared-family D/ST pin
 *    (14.00 expected, 13.00 computed); shown on the PR, reverted byte-copy.
 *  - the tier-LABEL derivation pin feeds a NON-published cut list and
 *    asserts the labels follow it (the Q26/F59 seam) — hardcoding the
 *    published families' labels reds it; also shown on the PR.
 *
 * WHY THESE ARE NOT `template-parity.test.ts`'s FIXTURES (the cross-pin
 * question, answered): the parity suite's five canonical weeks are QA lines
 * chosen for template comparison (QB 287 yds / D/ST PA=19, YA=249 — its
 * Scout pins 27.75/19.60/18.10/11.00/15.00). §7.3.3.1 pins six DIFFERENT
 * product-voice lines (QB 335 yds / D/ST PA=17, YA=289 — its own straddle),
 * and the spec's amendment window closed when #161 merged unamended
 * (tasks-SE §6). Both suites pin the SAME pipeline on different inputs;
 * neither's totals can cross-check the other's.
 */

const POSITIONS: readonly ScoringPosition[] = SCORING_POSITIONS

describe('SAMPLE_PLAYERS — the §7.3.3.1 table as stored literals (D171)', () => {
  it('each line delivers exactly the scoring-relevant stats — context aggregates OMITTED, never zeroed', () => {
    // The spec's context numbers (24-of-36, 22 carries, 3-of-4 FG…) render
    // as flavor only; the stat objects must not carry them, so a doc that
    // (illegally) paid an aggregate surfaces as pending, not silently 0.
    // Key sets re-stated here as literals — a drive-by edit to the fixture
    // has to change two files.
    expect(Object.keys(SAMPLE_PLAYERS.QB.stats).sort()).toStrictEqual(
      ['interceptions', 'pass_tds', 'pass_yards', 'qb_sack_taken', 'rush_yards'].sort(),
    )
    expect(Object.keys(SAMPLE_PLAYERS.RB.stats).sort()).toStrictEqual(
      ['fumbles_lost', 'receiving_yards', 'receptions', 'rush_tds', 'rush_yards'].sort(),
    )
    expect(Object.keys(SAMPLE_PLAYERS.WR.stats).sort()).toStrictEqual(
      ['receiving_tds', 'receiving_yards', 'receptions', 'return_td', 'rush_yards'].sort(),
    )
    expect(Object.keys(SAMPLE_PLAYERS.TE.stats).sort()).toStrictEqual(
      ['rec_2pt', 'receiving_tds', 'receiving_yards', 'receptions'].sort(),
    )
    expect(Object.keys(SAMPLE_PLAYERS.K.stats).sort()).toStrictEqual(
      ['fg_0_39', 'fg_40_49', 'fg_50_plus', 'fg_missed', 'pat_made'].sort(),
    )
    expect(Object.keys(SAMPLE_PLAYERS.DST.stats).sort()).toStrictEqual(
      [
        'def_fumble_rec',
        'def_int',
        'def_points_allowed',
        'def_sack',
        'def_td',
        'def_yards_allowed',
      ].sort(),
    )
  })

  it('the Seahawks line stores the RAW sources and NO tier-indicator keys — the one-hot happens in deriveTierIndicators, nowhere else', () => {
    const keys = Object.keys(SAMPLE_PLAYERS.DST.stats)
    expect(keys.filter((k) => k.startsWith('def_pa_') || k.startsWith('def_ya_'))).toStrictEqual([])
    expect(SAMPLE_PLAYERS.DST.stats.def_points_allowed).toBe(17)
    expect(SAMPLE_PLAYERS.DST.stats.def_yards_allowed).toBe(289)
  })

  it('every delivered key is scorable or a raw tier source — nothing a valid doc could never pay', () => {
    const rawSources = new Set(['def_points_allowed', 'def_yards_allowed'])
    for (const position of POSITIONS) {
      for (const key of Object.keys(SAMPLE_PLAYERS[position].stats)) {
        expect(
          SCORABLE_KEYS.has(key) || rawSources.has(key),
          `${position} sample delivers '${key}'`,
        ).toBe(true)
      }
    }
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * The six live totals, hand-computed (D62) under two template forks —
 * one ESPN-family (ESPN Full PPR), one shared-family (Yahoo Half PPR),
 * the parity fixture's own builders. Arithmetic, worked before first run:
 *
 * ESPN Full PPR fork (receptions 1, INT −2, ESPN kicking incl. fg_missed −1,
 * ESPN split D/ST):
 *   Marino  (QB): 335×0.04=13.40 + 3×4=12.00 + 6×0.1=0.60 − 1×2=2.00 = 24.00
 *                 (qb_sack_taken delivered, no rules key → unscored)
 *   Peterson(RB): 121×0.1=12.10 + 1×6=6.00 + 4×1=4.00 + 23×0.1=2.30
 *                 − 1×2=2.00                                        = 22.40
 *   Moss    (WR): 9×1=9.00 + 145×0.1=14.50 + 2×6=12.00 + 12×0.1=1.20
 *                 + 1×6=6.00                                        = 42.70
 *   Gronk   (TE): 7×1=7.00 + 89×0.1=8.90 + 1×6=6.00 + 1×2=2.00      = 23.90
 *   Rackers (K):  2×3=6 + 1×4=4 + 1×5=5 + 3×1=3 − 1×1=1             = 17.00
 *   Seahawks(DST): events 3×1+1×2+1×2+1×6 = 13.00;
 *                 PA=17 → def_pa_14_17 hot ×1 = +1 (cold buckets ×0);
 *                 YA=289 → def_ya_200_299 hot ×2 = +2               = 16.00
 *
 * Yahoo Half PPR fork (receptions 0.5, INT −1, Yahoo kicking — NO miss
 * penalties, shared single-model D/ST — PA only):
 *   Marino:   13.40 + 12.00 + 0.60 − 1.00                           = 25.00
 *   Peterson: 12.10 + 6.00 + 4×0.5=2.00 + 2.30 − 2.00               = 20.40
 *   Moss:     9×0.5=4.50 + 14.50 + 12.00 + 1.20 + 6.00              = 38.20
 *   Gronk:    7×0.5=3.50 + 8.90 + 6.00 + 2.00                       = 20.40
 *   Rackers:  6 + 4 + 5 + 3   (fg_missed delivered, no key → unscored)
 *                                                                   = 18.00
 *   Seahawks: events 13.00; PA=17 → def_pa_14_20 hot ×1 = +1;
 *             no def_ya_* keys paid                                 = 14.00
 * ──────────────────────────────────────────────────────────────────────── */
const ESPN_FULL_PPR_TOTALS: Record<ScoringPosition, number> = {
  QB: 24,
  RB: 22.4,
  WR: 42.7,
  TE: 23.9,
  K: 17,
  DST: 16,
}
const YAHOO_HALF_PPR_TOTALS: Record<ScoringPosition, number> = {
  QB: 25,
  RB: 20.4,
  WR: 38.2,
  TE: 20.4,
  K: 18,
  DST: 14,
}

describe('the six live sample totals — hand-computed literals under two forks (SE.8(3)(a), D62)', () => {
  for (const position of POSITIONS) {
    it(`ESPN Full PPR fork × ${position} = ${ESPN_FULL_PPR_TOTALS[position].toFixed(2)}`, () => {
      expect(sampleLineTotal(espnFork(), position)).toBe(ESPN_FULL_PPR_TOTALS[position])
    })
    it(`Yahoo Half PPR fork × ${position} = ${YAHOO_HALF_PPR_TOTALS[position].toFixed(2)}`, () => {
      expect(sampleLineTotal(yahooFork(), position)).toBe(YAHOO_HALF_PPR_TOTALS[position])
    })
  }

  it('the D/ST 16.00 vs 14.00 decomposes as the spec’s straddle: ESPN pays def_pa_14_17 AND def_ya_200_299; shared pays def_pa_14_20 only', () => {
    const line = SAMPLE_PLAYERS.DST.stats
    const espn = espnFork()
    const espnBreakdown = scorePlayerWeek(
      resolveRules(espn, 'DST'),
      deriveTierIndicators(line, espn.tier_cuts),
    )
    expect(espnBreakdown.perKey.def_pa_14_17).toBe(1)
    expect(espnBreakdown.perKey.def_ya_200_299).toBe(2)
    expect(espnBreakdown.perKey).not.toHaveProperty('def_pa_14_20')

    const yahoo = yahooFork()
    const yahooBreakdown = scorePlayerWeek(
      resolveRules(yahoo, 'DST'),
      deriveTierIndicators(line, yahoo.tier_cuts),
    )
    expect(yahooBreakdown.perKey.def_pa_14_20).toBe(1)
    expect(yahooBreakdown.perKey).not.toHaveProperty('def_pa_14_17')
    expect(Object.keys(yahooBreakdown.perKey).filter((k) => k.startsWith('def_ya_'))).toStrictEqual(
      [],
    )
  })

  it('a fresh fork scores each sample line exactly as its template (fork-equivalence at the sample lines — cuts path ≡ literals path through the REAL derive)', () => {
    // The template (format 1) derives against the shipped literal tables;
    // the fork (format 2) derives against its own inherited tier_cuts —
    // §7.3.3.1(a)'s agreement clause, exercised on the spec's own lines.
    for (const position of POSITIONS) {
      expect(sampleLineTotal(template('ESPN Full PPR'), position)).toBe(
        ESPN_FULL_PPR_TOTALS[position],
      )
      expect(sampleLineTotal(template('Yahoo Half PPR'), position)).toBe(
        YAHOO_HALF_PPR_TOTALS[position],
      )
    }
  })

  it('SE.8(3)(b): a TE-scoped receptions override moves EXACTLY Gronk’s total (7×2=14 for 7×1=7 → 30.90); the other five hold their pins', () => {
    const doc = applyEdit(espnFork(), {
      section: 'receiving',
      key: 'receptions',
      scope: 'TE',
      value: 2,
    })
    expect(sampleLineTotal(doc, 'TE')).toBe(30.9)
    for (const position of POSITIONS) {
      if (position === 'TE') continue
      expect(sampleLineTotal(doc, position)).toBe(ESPN_FULL_PPR_TOTALS[position])
    }
  })
})

describe('dstTierTables — labels derive from the document’s OWN cuts (F178; the F59/Q26 seam)', () => {
  it('an ESPN-family fork shows BOTH tables, in PA-then-YA order, with the generated labels and the template’s payouts', () => {
    const tables = dstTierTables(espnFork())
    expect(tables.map((t) => t.family)).toStrictEqual(['def_pa', 'def_ya'])

    const [pa, ya] = tables
    expect(pa.rows.map((r) => r.label)).toStrictEqual([
      '0',
      '1–6',
      '7–13',
      '14–17',
      '18–27',
      '28–34',
      '35–45',
      '46+',
    ])
    // ESPN's published PA payouts, as seeded (templates.ts ESPN_DEF_PA).
    expect(pa.rows.map((r) => r.payout)).toStrictEqual([5, 4, 3, 1, 0, -1, -3, -5])
    expect(ya.rows.map((r) => r.label)).toStrictEqual([
      '0–99',
      '100–199',
      '200–299',
      '300–349',
      '350–399',
      '400–449',
      '450–499',
      '500–549',
      '550+',
    ])
  })

  it('a shared-family fork shows the PA table ONLY (its YA cut list is carried but pays no keys — table presence = what the doc pays)', () => {
    const tables = dstTierTables(yahooFork())
    expect(tables.map((t) => t.family)).toStrictEqual(['def_pa'])
    expect(tables[0].rows.map((r) => r.label)).toStrictEqual([
      '0',
      '1–6',
      '7–13',
      '14–20',
      '21–27',
      '28–34',
      '35+',
    ])
  })

  it('THE DERIVATION PIN: a NON-published cut list relabels the rows — a re-cut league’s labels follow ITS cuts, never the published families’ (D272(20); reds if labels are hardcoded)', () => {
    // No shipped doc carries these cuts; only genuine derivation from the
    // document in hand can produce these labels. This is exactly the seam
    // F59's boundary editor will walk through — the editor is already
    // honest about it.
    const doc: ScoringRulesDocV2 = {
      format: 2,
      base: { def_pa_0_9: 5 },
      positions: {},
      tier_cuts: { def_pa: [0, 10, 20], def_ya: [...YA_CUTS] },
    }
    const tables = dstTierTables(doc)
    expect(tables.map((t) => t.family)).toStrictEqual(['def_pa'])
    expect(tables[0].rows.map((r) => r.label)).toStrictEqual(['0–9', '10–19', '20+'])
    // The Seahawks' 17 PA one-hots the doc's OWN [10, 19] tier — the hot
    // marker follows the cuts through the REAL derive path too.
    expect(tables[0].rows.map((r) => r.sampleHot)).toStrictEqual([false, true, false])
    // Unpaid generated tiers still render (payout undefined, addable).
    expect(tables[0].rows.map((r) => r.payout)).toStrictEqual([5, undefined, undefined])
  })

  it('the sample straddle is marked through the REAL derive: ESPN hot = 14–17 + 200–299; shared hot = 14–20 (§7.3.3.1’s own note, visible)', () => {
    const [espnPa, espnYa] = dstTierTables(espnFork())
    expect(espnPa.rows.filter((r) => r.sampleHot).map((r) => r.key)).toStrictEqual([
      'def_pa_14_17',
    ])
    expect(espnYa.rows.filter((r) => r.sampleHot).map((r) => r.key)).toStrictEqual([
      'def_ya_200_299',
    ])
    expect(espnPa.sampleValue).toBe(17)
    expect(espnYa.sampleValue).toBe(289)

    const [sharedPa] = dstTierTables(yahooFork())
    expect(sharedPa.rows.filter((r) => r.sampleHot).map((r) => r.key)).toStrictEqual([
      'def_pa_14_20',
    ])
  })

  it('a format-1 document detects its family from its own key set (read-only view); an undetectable flat doc renders no tables rather than guessing', () => {
    const espnTemplate = dstTierTables(template('ESPN Standard'))
    expect(espnTemplate.map((t) => t.family)).toStrictEqual(['def_pa', 'def_ya'])
    expect(espnTemplate[0].rows.map((r) => r.label)).toContain('14–17')

    // No PA keys at all → undetectable → no tables, no throw.
    expect(dstTierTables({ receptions: 1 })).toStrictEqual([])
    // The four shared key names are members of BOTH families → ambiguous →
    // no tables rather than a silently re-cut display.
    expect(dstTierTables({ def_pa_0: 5 })).toStrictEqual([])
  })
})

describe('applyTierEdit — the tables’ one write path (F178; §7.3.3.1(b))', () => {
  it('writes base, keeps tier_cuts and positions untouched, and returns the normalized doc', () => {
    const doc = espnFork()
    const next = applyTierEdit(doc, 'def_pa_0', 6)
    expect(next.base.def_pa_0).toBe(6)
    expect(next.tier_cuts).toStrictEqual(doc.tier_cuts)
    expect(next.positions).toStrictEqual({})
    // …and the edit is visible to the sample line (16.00 held: PA=17 does
    // not touch def_pa_0 — the cold-bucket delivered-zero pays 6×0).
    expect(sampleLineTotal(next, 'DST')).toBe(16)
    // Editing the HOT tier moves the total: def_pa_14_17 1 → 3 is +2.
    expect(sampleLineTotal(applyTierEdit(doc, 'def_pa_14_17', 3), 'DST')).toBe(18)
  })

  it('normalizes: writing base under an equal DST override strips the no-op override (the normal-form law rides every edit)', () => {
    const doc: ScoringRulesDocV2 = {
      ...espnFork(),
      positions: { DST: { def_pa_0: 6 } },
    }
    const next = applyTierEdit(doc, 'def_pa_0', 6)
    expect(next.positions).toStrictEqual({})
  })

  it('refuses a key the document’s own cuts do not generate — the other family’s tier, a non-tier key, and (typed away but pinned) a format-1 doc', () => {
    expect(() => applyTierEdit(espnFork(), 'def_pa_14_20', 1)).toThrow(/own tier cuts/)
    expect(() => applyTierEdit(espnFork(), 'def_sack', 2)).toThrow(/own tier cuts/)
    expect(() =>
      applyTierEdit(template('ESPN Standard') as unknown as ScoringRulesDocV2, 'def_pa_0', 6),
    ).toThrow(/format-2/)
  })
})

describe('describeSaveRefusal — 401 says “sign in again”, never “try again” (R683)', () => {
  it('classifies 401 as refused with the sign-in sentence', () => {
    const refusal = describeSaveRefusal(new LeaguePatchError(401, 'Unauthorized'))
    expect(refusal.kind).toBe('refused')
    expect(refusal).toMatchObject({ status: 401 })
    if (refusal.kind === 'refused') {
      expect(refusal.message).toMatch(/sign in/i)
      expect(refusal.message).not.toMatch(/try again/i)
    }
  })
})
