/**
 * template-parity.test.ts — L.A1.10: template parity fixtures + tests
 * (the M1 gate's item 4; joins the L.A1.16 gate suite per the task text).
 *
 * Spec: §7.3.3 (parity guarantee + precision), Appendix B, §19.2 E38/E61;
 * PROGRESS D44 (derive-at-scoring-time), D57 (calculator), D59 (templates).
 *
 * Five canonical player-weeks as stored literals, each scored under all six
 * v1 parity templates: 30 pinned totals. EVERY pin below is HAND-COMPUTED —
 * the arithmetic is shown line-by-line in comments and was worked out on
 * paper BEFORE the suite first ran (never pasted from calculator output —
 * that would be a recompute pin, the §4.3 fraud class; a recompute pin can
 * only ever agree with the code it claims to check).
 *
 * Composition under test (F23 interim proof-of-pattern — PROGRESS ledger §6):
 *   scorePlayerWeek(template.rules, deriveTierIndicators(rawStats))
 * i.e. deriveTierIndicators runs BEFORE scorePlayerWeek, exactly the
 * composition the L.D1 `score-league-week` worker must use in M4. The D/ST
 * fixture proves the composition is load-bearing, not decorative: a negative
 * control skips derive and shows every tier rules key falling to §23.5
 * pending (E61) and the ESPN total losing its tier points. The FULL
 * discharge of F23 (pinning the composition at the production worker)
 * stays with L.D1/M4 — this file is the interim pattern proof only.
 *
 * F14 re-confirmation (PROGRESS ledger §6): the exact ESPN bucket
 * boundaries are re-confirmed here against the RECORDED evidence — the Q9
 * source pass of 2026-07-21 (PROGRESS §3 Q9 items 1–3: Scoring-Formats
 * article 360003914032, D/ST article 115003847231, and ESPN's in-product
 * leaguedefaults/1 + /3 payloads) and D56(1)/(2) — with ZERO external
 * calls; the boundary literals in the F14 block below are transcribed from
 * that recorded evidence, and the standard PA bucketization is the one the
 * product renders (Q9 F19(b) resolution).
 *
 * Named parity exceptions (spec v2.8.5): the K week deliberately contains
 * NO 60+ FG make — that is a documented ESPN exception, not a scorable
 * category, and this suite does not manufacture one (orchestrator charter;
 * templates.test.ts pins that no 60+/PAT-micro key exists anywhere).
 */
import { describe, expect, it } from 'vitest'

import { roundHalfUp, scorePlayerWeek } from './calculator'
import {
  DEF_PA_BUCKETS,
  DEF_YA_BUCKETS,
  deriveTierIndicators,
} from './derive-stats'
import { SCORING_TEMPLATES } from './templates'

const byName = (name: string) => {
  const t = SCORING_TEMPLATES.find((t) => t.name === name)
  if (!t) throw new Error(`template not found: ${name}`)
  return t
}

/** The production composition (F23 pattern): derive BEFORE score. */
const score = (templateName: string, raw: Record<string, number>) =>
  scorePlayerWeek(byName(templateName).rules, deriveTierIndicators(raw))

/* ────────────────────────────────────────────────────────────────────────
 * The five canonical player-weeks (fixtures as literals — canonical
 * registry keys only; context keys that no v1 template scores are
 * deliberately present to exercise "stat keys without rules are ignored").
 * ──────────────────────────────────────────────────────────────────────── */

/** QB week: INT + 2-pt + sack context (`qb_sack_taken` is a registry key no
 *  v1 parity template scores — ignored, never pending). */
const QB_WEEK: Record<string, number> = {
  pass_yards: 287,
  pass_tds: 2,
  interceptions: 1,
  pass_2pt: 1,
  qb_sack_taken: 3, // context: unscored by all 6 templates (B.3 is Ultra-only, punted)
  rush_yards: 14,
  rush_tds: 0, // delivered zero — a real perKey 0, not pending
  receptions: 0, // delivered zero — PPR delta on this week is exactly 0
}

/** RB week: a fumble, and rush_yards ≥ 100 as the 100-yd bonus ABSENCE
 *  check — no v1 template carries `rush_100_bonus` (App B.4: bonuses are
 *  v1.1 catalog), so 112 rushing yards must add nothing beyond 0.1/yd. */
const RB_WEEK: Record<string, number> = {
  rush_yards: 112,
  rush_attempts: 24, // context: unscored
  rush_tds: 1,
  rush_2pt: 1,
  fumbles_lost: 1,
  receptions: 3,
  receiving_yards: 24,
  receiving_tds: 0,
}

/** WR/TE week: 8 receptions differentiate Std (0) / Half (0.5) / Full (1). */
const WR_TE_WEEK: Record<string, number> = {
  receptions: 8,
  targets: 11, // context: unscored
  receiving_yards: 94,
  receiving_tds: 1,
  rec_2pt: 1,
  rush_yards: 7, // end-around
  fumbles_lost: 0,
}

/** K week: one make in EACH distance bucket + an FG miss + a PAT miss.
 *  No 60+ make — named parity exception (v2.8.5), not a scorable category.
 *  `receptions` is deliberately NOT delivered: it is a rules key in all 6
 *  templates, so it lands on the §23.5/E61 pending path here (asserted). */
const K_WEEK: Record<string, number> = {
  fg_0_39: 1,
  fg_40_49: 1,
  fg_50_plus: 1,
  fg_missed: 1,
  pat_made: 3,
  pat_missed: 1,
  fg_made: 3, // context: unscored raw totals
  fg_attempted: 4,
}

/** D/ST week: PA=19 and YA=249 exercise a PA tier AND a YA tier such that
 *  the ESPN split model visibly diverges from Yahoo/Sleeper single:
 *  PA=19 → ESPN `def_pa_18_27` (0 pts) vs shared `def_pa_14_20` (+1);
 *  YA=249 → ESPN-only `def_ya_200_299` (+2). Split 15.00 ≠ single 14.00. */
const DST_WEEK: Record<string, number> = {
  def_points_allowed: 19,
  def_yards_allowed: 249,
  def_sack: 3,
  def_int: 1,
  def_fumble_rec: 1,
  def_td: 1,
  def_safety: 0, // delivered zeros — real perKey 0s, not pending
  def_block: 0,
  def_return_td: 0,
}

const FIXTURES: Record<string, Record<string, number>> = {
  qb: QB_WEEK,
  rb: RB_WEEK,
  wr_te: WR_TE_WEEK,
  k: K_WEEK,
  dst: DST_WEEK,
}

/* ────────────────────────────────────────────────────────────────────────
 * The 30 hand-computed pins (6 templates × 5 weeks), to the cent.
 *
 * QB week — delivered-key arithmetic, common part (all six templates):
 *   pass_yards   287 × 0.04 = 11.48
 *   pass_tds       2 × 4    =  8.00
 *   pass_2pt       1 × 2    =  2.00
 *   rush_yards    14 × 0.1  =  1.40
 *   rush_tds       0 × 6    =  0.00
 *   receptions     0 × c    =  0.00
 *   common = 11.48 + 8 + 2 + 1.4 = 22.88
 *   ESPN   (INT −2): 22.88 − 2×1 = 20.88
 *   Yahoo/Sleeper (INT −1): 22.88 − 1 = 21.88
 *
 * RB week — common part (receptions at 0):
 *   rush_yards  112 × 0.1 = 11.20   (≥100 — and NO bonus: no rush_100_bonus key)
 *   rush_tds      1 × 6   =  6.00
 *   rush_2pt      1 × 2   =  2.00
 *   fumbles_lost  1 × −2  = −2.00
 *   receiving_yards 24 × 0.1 = 2.40
 *   receiving_tds 0 × 6   =  0.00
 *   common = 11.2 + 6 + 2 − 2 + 2.4 = 19.60
 *   Std (rec 0): 19.60 · Full PPR: +3×1 = 22.60 · Half PPR: +3×0.5 = 21.10
 *
 * WR/TE week — common part (receptions at 0):
 *   receiving_yards 94 × 0.1 = 9.40
 *   receiving_tds    1 × 6   = 6.00
 *   rec_2pt          1 × 2   = 2.00
 *   rush_yards       7 × 0.1 = 0.70
 *   fumbles_lost     0 × −2  = 0.00
 *   common = 9.4 + 6 + 2 + 0.7 = 18.10
 *   Std: 18.10 · Full PPR: +8×1 = 26.10 · Half PPR: +8×0.5 = 22.10
 *
 * K week — per platform table (receptions undelivered → pending, adds 0):
 *   makes: fg_0_39 1×3 + fg_40_49 1×4 + fg_50_plus 1×5 = 12 · pat_made 3×1 = 3
 *   ESPN:    12 + 3 + fg_missed 1×−1 = 14.00   (no pat_missed key — stat ignored)
 *   Yahoo:   12 + 3                  = 15.00   (no miss-penalty keys at all)
 *   Sleeper: 12 + 3 − 1 − 1          = 13.00   (fg_missed −1 AND pat_missed −1)
 *
 * D/ST week — events common to all six:
 *   def_sack 3×1 = 3 · def_int 1×2 = 2 · def_fumble_rec 1×2 = 2 · def_td 1×6 = 6
 *   def_safety/def_block/def_return_td 0 × c = 0
 *   events = 3 + 2 + 2 + 6 = 13.00
 *   ESPN (split): PA=19 → def_pa_18_27 hot, 1×0 = 0; YA=249 → def_ya_200_299
 *     hot, 1×2 = +2; every cold bucket 0×c = 0 → 13 + 0 + 2 = 15.00
 *   Yahoo/Sleeper (single): PA=19 → def_pa_14_20 hot, 1×1 = +1 → 14.00
 * ──────────────────────────────────────────────────────────────────────── */
const PINNED_TOTALS: Record<string, Record<string, number>> = {
  'ESPN Standard': { qb: 20.88, rb: 19.6, wr_te: 18.1, k: 14, dst: 15 },
  'ESPN Full PPR': { qb: 20.88, rb: 22.6, wr_te: 26.1, k: 14, dst: 15 },
  'Yahoo Standard': { qb: 21.88, rb: 19.6, wr_te: 18.1, k: 15, dst: 14 },
  'Yahoo Half PPR': { qb: 21.88, rb: 21.1, wr_te: 22.1, k: 15, dst: 14 },
  'Sleeper Standard': { qb: 21.88, rb: 19.6, wr_te: 18.1, k: 13, dst: 14 },
  'Sleeper Full PPR': { qb: 21.88, rb: 22.6, wr_te: 26.1, k: 13, dst: 14 },
}

describe('parity matrix — 6 templates × 5 canonical player-weeks, to the cent', () => {
  for (const [templateName, weeks] of Object.entries(PINNED_TOTALS)) {
    for (const [weekId, pinned] of Object.entries(weeks)) {
      it(`${templateName} × ${weekId} week = ${pinned.toFixed(2)}`, () => {
        expect(score(templateName, FIXTURES[weekId]).total).toBe(pinned)
      })
    }
  }

  it('breakdown invariant: perKey keys ⊎ pending ≡ the template’s rules keys, disjoint (E61)', () => {
    for (const t of SCORING_TEMPLATES) {
      for (const [weekId, raw] of Object.entries(FIXTURES)) {
        const b = scorePlayerWeek(t.rules, deriveTierIndicators(raw))
        const perKeyKeys = Object.keys(b.perKey)
        const union = new Set([...perKeyKeys, ...b.pending])
        expect(union.size, `${t.name}/${weekId} overlap`).toBe(
          perKeyKeys.length + b.pending.length,
        )
        expect([...union].sort(), `${t.name}/${weekId} coverage`).toEqual(
          Object.keys(t.rules).sort(),
        )
      }
    }
  })

  it('delivered zeros are perKey 0 entries, never pending (rush_tds=0, def_safety=0)', () => {
    const qb = score('ESPN Standard', QB_WEEK)
    expect(qb.perKey.rush_tds).toBe(0)
    expect(qb.pending).not.toContain('rush_tds')
    const dst = score('Sleeper Standard', DST_WEEK)
    expect(dst.perKey.def_safety).toBe(0)
    expect(dst.pending).not.toContain('def_safety')
  })

  it('context stats no template scores (qb_sack_taken, targets, fg_made) are ignored — no perKey entry, no pending entry', () => {
    for (const t of SCORING_TEMPLATES) {
      const qb = scorePlayerWeek(t.rules, deriveTierIndicators(QB_WEEK))
      expect(qb.perKey.qb_sack_taken, t.name).toBeUndefined()
      expect(qb.pending, t.name).not.toContain('qb_sack_taken')
    }
  })
})

describe('cross-platform assertions (§7.3.3 parity guarantee examples)', () => {
  it('QB week: ESPN INT −2 vs Yahoo/Sleeper −1 produces the pinned delta of exactly −1.00 per INT', () => {
    // 1 interception × (−2 − (−1)) = −1.00 — hand-computed: 20.88 − 21.88.
    const espn = score('ESPN Standard', QB_WEEK).total
    const yahoo = score('Yahoo Standard', QB_WEEK).total
    const sleeper = score('Sleeper Standard', QB_WEEK).total
    expect(roundHalfUp(espn - yahoo)).toBe(-1)
    expect(roundHalfUp(espn - sleeper)).toBe(-1)
  })

  it('E38: Yahoo Standard and Sleeper Standard tie the QB week at exactly two decimals (21.88 = 21.88) — a real tie, no hidden precision', () => {
    expect(score('Yahoo Standard', QB_WEEK).total).toBe(21.88)
    expect(score('Sleeper Standard', QB_WEEK).total).toBe(21.88)
  })

  const PPR_PAIRS: Array<[string, string, number]> = [
    ['ESPN Standard', 'ESPN Full PPR', 1],
    ['Yahoo Standard', 'Yahoo Half PPR', 0.5],
    ['Sleeper Standard', 'Sleeper Full PPR', 1],
  ]

  it('PPR variants differ by exactly receptions × coefficient on every week (pinned deltas)', () => {
    // Delivered receptions per week: qb 0 · rb 3 · wr_te 8 · k/dst undelivered.
    const deliveredReceptions: Record<string, number> = {
      qb: 0,
      rb: 3,
      wr_te: 8,
      k: 0, // undelivered → pending on BOTH sides → delta 0 (asserted below)
      dst: 0,
    }
    for (const [stdName, pprName, coeff] of PPR_PAIRS) {
      for (const [weekId, raw] of Object.entries(FIXTURES)) {
        const delta = roundHalfUp(
          score(pprName, raw).total - score(stdName, raw).total,
        )
        // Hand-computed: rb×1 = 3.00 · rb×0.5 = 1.50 · wr_te×1 = 8.00 ·
        // wr_te×0.5 = 4.00 · everything else 0.00.
        expect(delta, `${pprName} − ${stdName} on ${weekId}`).toBe(
          roundHalfUp(deliveredReceptions[weekId] * coeff),
        )
      }
    }
  })

  it('K/DST weeks: `receptions` is pending on BOTH sides of every PPR pair (undelivered ≠ zero, §23.5/E61)', () => {
    for (const [stdName, pprName] of PPR_PAIRS) {
      for (const raw of [K_WEEK, DST_WEEK]) {
        expect(score(stdName, raw).pending).toContain('receptions')
        expect(score(pprName, raw).pending).toContain('receptions')
      }
    }
  })

  it('RB week: 112 rushing yards add nothing beyond 0.1/yd — the 100-yd bonus is absent from every v1 template', () => {
    for (const t of SCORING_TEMPLATES) {
      expect('rush_100_bonus' in t.rules, t.name).toBe(false)
      const b = scorePlayerWeek(t.rules, deriveTierIndicators(RB_WEEK))
      // Hand-computed: 112 × 0.1 = 11.20 exactly — no bonus on top.
      expect(roundHalfUp(b.perKey.rush_yards), t.name).toBe(11.2)
      expect(b.pending, t.name).not.toContain('rush_100_bonus')
    }
  })

  it('K week: the platform K-table spread is visible in the pinned totals (Yahoo 15 > ESPN 14 > Sleeper 13 on the same leg line)', () => {
    // Same fixture, three platform tables: Yahoo penalizes no misses,
    // ESPN penalizes the FG miss only, Sleeper penalizes both.
    expect(score('Yahoo Standard', K_WEEK).total).toBe(15)
    expect(score('ESPN Standard', K_WEEK).total).toBe(14)
    expect(score('Sleeper Standard', K_WEEK).total).toBe(13)
  })

  it('D/ST week: ESPN split model visibly ≠ Yahoo/Sleeper single model (15.00 vs 14.00 on identical raw stats)', () => {
    expect(score('ESPN Standard', DST_WEEK).total).toBe(15)
    expect(score('Yahoo Standard', DST_WEEK).total).toBe(14)
    expect(score('Sleeper Standard', DST_WEEK).total).toBe(14)
  })
})

describe('D/ST bucket-edge boundary pins (§4.3(b) — template-total altitude, edge and one past)', () => {
  it('ESPN PA 17→18 boundary: def_pa_14_17 (+1) gives way to def_pa_18_27 (0) — 16.00 then 15.00', () => {
    // events 13 + PA tier + YA 249 tier (+2):
    // PA=17: 13 + 1 + 2 = 16.00 · PA=18: 13 + 0 + 2 = 15.00
    expect(score('ESPN Standard', { ...DST_WEEK, def_points_allowed: 17 }).total).toBe(16)
    expect(score('ESPN Standard', { ...DST_WEEK, def_points_allowed: 18 }).total).toBe(15)
  })

  it('ESPN YA 299→300 boundary: def_ya_200_299 (+2) gives way to def_ya_300_349 (0) — 15.00 then 13.00', () => {
    // PA=19 tier is 0 throughout: YA=299: 13 + 0 + 2 = 15.00 · YA=300: 13.00
    expect(score('ESPN Standard', { ...DST_WEEK, def_yards_allowed: 299 }).total).toBe(15)
    expect(score('ESPN Standard', { ...DST_WEEK, def_yards_allowed: 300 }).total).toBe(13)
  })

  it('shared PA 20→21 boundary (Yahoo/Sleeper): def_pa_14_20 (+1) gives way to def_pa_21_27 (0) — 14.00 then 13.00', () => {
    for (const name of ['Yahoo Standard', 'Sleeper Standard']) {
      expect(score(name, { ...DST_WEEK, def_points_allowed: 20 }).total, name).toBe(14)
      expect(score(name, { ...DST_WEEK, def_points_allowed: 21 }).total, name).toBe(13)
    }
  })
})

describe('F23 interim proof-of-pattern: derive BEFORE score is load-bearing', () => {
  it('with derive: no def_pa_*/def_ya_* rules key is pending for any template on the D/ST week (F20 delivered-zero)', () => {
    for (const t of SCORING_TEMPLATES) {
      const b = scorePlayerWeek(t.rules, deriveTierIndicators(DST_WEEK))
      const tierPending = b.pending.filter(
        (k) => k.startsWith('def_pa_') || k.startsWith('def_ya_'),
      )
      expect(tierPending, t.name).toEqual([])
    }
  })

  it('negative control — skipping derive leaves EVERY tier rules key pending and drops the ESPN total to events-only 13.00', () => {
    // The exact failure mode F23 exists to prevent at the M4 worker: raw
    // stats fed straight to scorePlayerWeek carry no indicator keys, so all
    // 8 ESPN def_pa_* + 9 def_ya_* rules keys pend and the split-model tier
    // points (0 + 2 here) silently vanish from the total.
    const b = scorePlayerWeek(byName('ESPN Standard').rules, DST_WEEK)
    const tierPending = b.pending.filter(
      (k) => k.startsWith('def_pa_') || k.startsWith('def_ya_'),
    )
    expect(tierPending).toHaveLength(17)
    expect(b.total).toBe(13)
  })

  it('derive is a pass-through for the four non-D/ST weeks (no raw source key → no family emitted)', () => {
    for (const raw of [QB_WEEK, RB_WEEK, WR_TE_WEEK, K_WEEK]) {
      expect(deriveTierIndicators(raw)).toEqual(raw)
    }
  })
})

describe('F14 re-confirmation — ESPN bucket boundaries, from the RECORDED Q9/D56 evidence (zero external calls)', () => {
  it('ESPN standard PA buckets are 0 / 1–6 / 7–13 / 14–17 / 18–27 / 28–34 / 35–45 / 46+ (the STANDARD bucketization the product renders, Q9 F19(b))', () => {
    // Transcribed from PROGRESS §3 Q9 item 1 (Scoring-Formats 360003914032,
    // retrieved 2026-07-21) + D56(2); the ESPN templates score the four
    // divergent buckets plus the four genuinely-shared ones (v2.8.3).
    const byKey = new Map(DEF_PA_BUCKETS.map((b) => [b.key, [b.lo, b.hi]]))
    expect(byKey.get('def_pa_0')).toEqual([0, 0])
    expect(byKey.get('def_pa_1_6')).toEqual([1, 6])
    expect(byKey.get('def_pa_7_13')).toEqual([7, 13])
    expect(byKey.get('def_pa_14_17')).toEqual([14, 17])
    expect(byKey.get('def_pa_18_27')).toEqual([18, 27])
    expect(byKey.get('def_pa_28_34')).toEqual([28, 34])
    expect(byKey.get('def_pa_35_45')).toEqual([35, 45])
    expect(byKey.get('def_pa_46_plus')).toEqual([46, Infinity])
  })

  it('ESPN YA buckets are <100 / 100–199 / 200–299 / 300–349 / 350–399 / 400–449 / 450–499 / 500–549 / 550+ — the nine the ESPN templates score', () => {
    // Transcribed from PROGRESS §3 Q9 items 1–3 (article buckets + the
    // in-product ids 128–136 in published-bucket order) + D56(1).
    expect(DEF_YA_BUCKETS.map((b) => [b.key, b.lo, b.hi])).toEqual([
      ['def_ya_0_99', -Infinity, 99],
      ['def_ya_100_199', 100, 199],
      ['def_ya_200_299', 200, 299],
      ['def_ya_300_349', 300, 349],
      ['def_ya_350_399', 350, 399],
      ['def_ya_400_449', 400, 449],
      ['def_ya_450_499', 450, 499],
      ['def_ya_500_549', 500, 549],
      ['def_ya_550_plus', 550, Infinity],
    ])
  })

  it('every ESPN-template tier rules key maps onto exactly one confirmed bucket (rules ⊆ boundaries)', () => {
    const bucketKeys = new Set(
      [...DEF_PA_BUCKETS, ...DEF_YA_BUCKETS].map((b) => b.key),
    )
    for (const name of ['ESPN Standard', 'ESPN Full PPR']) {
      const tierKeys = Object.keys(byName(name).rules).filter(
        (k) => k.startsWith('def_pa_') || k.startsWith('def_ya_'),
      )
      expect(tierKeys, name).toHaveLength(17) // 8 PA + 9 YA
      for (const k of tierKeys) {
        expect(bucketKeys.has(k), `${name}: ${k}`).toBe(true)
      }
    }
  })
})
