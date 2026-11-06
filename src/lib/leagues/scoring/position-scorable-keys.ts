/**
 * The position-scope map, on its own (K0). Its text and values are unchanged;
 * it moved out of `validate-rules-doc.ts` because that file pulls in zod, and
 * `score-week-worker.ts` (which client hooks now reach through
 * `src/lib/players/preset-scoring.ts`) only needs this map.
 */
import {
  DEF_PA_PREFIX,
  DEF_YA_PREFIX,
  ESPN_PA_CUTS,
  SHARED_PA_CUTS,
  YA_CUTS,
  tierKeysFromCuts,
} from './tier-cuts'
import type { ScoringPosition } from './rules-doc'

/**
 * §7.3.3.1's section catalog, transcribed from the spec sentence and grouped
 * by the position whose page renders it — **the position-scope law of
 * guardrail 3**.
 *
 * *Why this lives in the engine and not in the editor.* D167 puts the editor's
 * own catalog (sections, labels, ordering, D173's `gated` flag) in
 * `scoring-editor-ops.ts` — that is rendering. Which keys are LEGAL under which
 * position is validation law: SE.4 mirrors this exact mapping in SQL, and
 * SE.4b's trigger enforces it on every write. **SE.7 must COMPOSE this map
 * rather than re-transcribe the catalog** (ledger F136) — two copies of the
 * catalog would let the editor offer a key the validator refuses, which is the
 * silent-drop shape §7.3.3.1 is written against.
 *
 * The transcription is not trusted: `validate-rules-doc.test.ts` proves the six
 * position sets are pairwise disjoint and that their union ≡ the registry's
 * scorable set, so a drift on either side reds.
 */
export const POSITION_SCORABLE_KEYS: Readonly<
  Record<ScoringPosition, readonly string[]>
> = (() => {
  // The five sections every position except K and D/ST carries (§7.3.3.1's
  // product-shape bullet (3)): Passing · Rushing · Receiving · Special Teams ·
  // Turnovers. `return_yards` is deliberately absent — Q13/D173 ship Special
  // Teams with `return_td` only, and the registry entry does not exist until
  // the data task lands (F71).
  const offense: readonly string[] = [
    // Passing
    'pass_yards',
    'pass_tds',
    'pass_2pt',
    'qb_sack_taken',
    // Rushing
    'rush_yards',
    'rush_tds',
    'rush_2pt',
    // Receiving
    'receptions',
    'receiving_yards',
    'receiving_tds',
    'rec_2pt',
    // Special Teams
    'return_td',
    // Turnovers
    'interceptions',
    'fumbles_lost',
    'fumble_recovery_td',
  ]

  return {
    QB: offense,
    RB: offense,
    WR: offense,
    TE: offense,
    // The K page — one single-section page (Q12, ruled 2026-08-16).
    // F871 / 218: `fg_60_plus` is the 60+ make's top-up on `fg_50_plus`.
    K: ['fg_0_39', 'fg_40_49', 'fg_50_plus', 'fg_60_plus', 'pat_made', 'fg_missed', 'pat_missed'],
    // The D/ST page — the event categories PLUS the doc's tier tables. The
    // tier half is the GENERATED names (§23.5(b) cut lists), never a second
    // literal list: a family the generator can produce is a family the D/ST
    // page can pay.
    DST: [
      'def_sack',
      'def_int',
      'def_fumble_rec',
      'def_td',
      'def_safety',
      'def_block',
      'def_return_td',
      'def_2pt_return', // F871 / 218
      ...new Set([
        ...tierKeysFromCuts(DEF_PA_PREFIX, SHARED_PA_CUTS),
        ...tierKeysFromCuts(DEF_PA_PREFIX, ESPN_PA_CUTS),
        ...tierKeysFromCuts(DEF_YA_PREFIX, YA_CUTS),
      ]),
    ],
  }
})()
