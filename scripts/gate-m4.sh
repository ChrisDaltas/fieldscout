#!/usr/bin/env bash
#
# gate-m4.sh — the M4 milestone gate (L.D6.3). Proves every tasks-M4 §1 exit
# criterion in ONE run and is the single entry point `npm run test:gate:m4`.
#
# Composition (tasks-M4 §6 L.D6.3 items 1-3; the L.A1.16/L.B7.1 precedent —
# the gate COMPOSES the existing proofs, it never rewrites them; F84 — every
# lane suite is enumerated BY NAME, never by glob):
#   [1/10] Fresh `supabase db reset` — the pristine, fully-migrated chain
#          (001-122 as of L.D6.3: 109-119 are the M4 in-season band, 120-122
#          the retire/claim/deferral tail). A reset-clean gate cannot pass on
#          residue or drift.
#   [2/10] `npm run test:db` — the FULL pgTAP suite (000-070). 057-070 are
#          the M4 band. D144(5) ORDERING CONSTRAINT, PINNED HERE: this stage
#          requires the EMPTY post-reset player pool — 022/025/026's autopick
#          fixtures assert fixture ids and go RED against real pool ids (10
#          failures observed at L.C6.1). It therefore runs BEFORE [3.5]'s
#          restore, and a session that re-runs `test:db` AFTER a restore
#          should expect reds that are ORDERING ARTIFACTS, not regressions.
#   [3/10] vitest -c vitest.gate-m4.config.ts — 71 files, enumerated by name
#          in that config (F84): every `src/**` test file ADDED during M4
#          plus 15 named pre-existing suites the in-season lane composes
#          onto. Serialized (the F52 discipline). Nothing in it needs the
#          restored pool, which is why it sits on this side of [3.5].
#   [3.5]  Draft-scope data restore (RESTORE_SCOPE=draft, local-pinned) —
#          the other half of D144(5): the season sim and the E2E suite draft
#          the REAL local pool (D123(11)/R286) and [1/10] emptied it.
#          F285(i): every stage below this line drafts the real pool.
#          INHERITED, F205: `RESTORE_SCOPE=draft` omits `sync-auction`, so
#          auction `$` columns render "-" for a DATA reason, not a code one.
#          It does not touch the season sim (season mode forces --type snake,
#          scripts/sim.ts:209); the M3 gate stage inherits the same note.
#   [3.6]  `npm run sim:census` PRE-FLIGHT — F199. A census only at the END
#          cannot tell a clean run from one that inherited someone else's
#          mess, so the gate reads it on both sides of the sim stages. Exit 1
#          on any residue. ITS BLIND SPOTS, stated because CLEAN is not the
#          same as clean (F199 is OPEN, its L.D6.1 discharge REVERSED at
#          R922): it has NO `players` cell, so `*-wire-*` fixture rows
#          stranded by an aborted vitest run survive it; and its `nfl_games`
#          cell is prefix-filtered to `simseason-`, so resident `dev-ld5*`
#          2099 rows survive every sweep.
#   [4/10] .. [4.8]  THE 100-LEAGUE SYNTHETIC RUN — NINE stages, one §23.6
#          scenario each, `--leagues 100 --weeks 2 --seed 42`, each writing
#          its `--report` JSON for [5/10] to transcribe (F135: never pipe a
#          full-suite invocation through a summary-only grep; capture it and
#          read the capture).
#          NINE STAGES IS A MECHANISM, NOT A PREFERENCE (season-runner.ts:
#          52-68): `nfl_games` has no league column and locks read it by
#          `(season, week, nfl_team)`, so a flexed kickoff planted for one
#          league moves it for EVERY league whose roster touches that club.
#          A hundred leagues on one synthetic season cannot each carry a
#          different scenario's slate.
#          100 IS THE CEILING, not a round number: `--leagues` validates
#          1..100 (scripts/sim.ts:216) and the id chunking that PostgREST's
#          URI limit forced is exactly 100 (`LEAGUE_ID_CHUNK` /
#          `ID_CHUNK`) — one chunk with ZERO head-room. Do not grow the
#          population without re-chunking. One unpaged read remains, the
#          postponement arm's own club-lock sample; it is a head/count query
#          and 100 ids fit the URI, but it is the read that breaks first.
#   [5/10] `gate-m4-evidence.ts` — reads the nine reports and re-derives the
#          D295 scenario->assertion map BY NAME, the run-wide clauses (zero
#          external calls; `source='synthetic'` on every stat row — D300/
#          F13), the D299 matrix coverage, the seating census (F288), the
#          reconciliation summary read by CLASSIFIED REASON (never a raw
#          alert total — at this scale `starter_final_game_no_line` alone is
#          thousands and every one lawful by construction), and the coverage
#          GAPS every run prints. A dropped or renamed scenario arm still
#          produces a GREEN run — it just produces one with fewer assertions
#          in it — so this stage fails the gate by name when a required
#          assertion is absent.
#          ITEM 2 ("reconciliation runs clean over the whole seeded
#          population") is discharged by the run's OWN in-run
#          `reconcileSeason` over `leagueStates.map(s => s.leagueId)` and NOT
#          by an `npm run reconcile` stage, for three measured reasons:
#          (a) the population is GONE by then — `cleanupSweep` runs in the
#          run's `finally` on every path and the season command has no
#          keep-leagues flag; (b) `scripts/reconcile.ts:72-75` exits 1 only
#          when `alerts > 0`, and `no_leagues_in_scope` exits 0 — a
#          post-sweep stage would be a textbook "nothing happened means it
#          worked"; (c) it loads `.env.local` and reads the URL/service key
#          with NO local-only guard (:25, :46-47), unlike sim.ts and
#          sim-census.ts. `scripts/reconcile.ts`'s own docblock says "the
#          gates (L.D6.3 / L.D6.4) invoke it by name"; L.D6.3 invokes the
#          LIBRARY by name, through the run (PROGRESS §3 Q46).
#   [6/10] `npm run sim:census` POST-FLIGHT — the other half of [3.6].
#   [7/10] The F56 bounded stack-health settle BEFORE Playwright (F285(ii)):
#          5 consecutive OK samples (HTTP 200 AND < 400ms), 1s cadence, 120s
#          budget, every sample logged, budget exhaustion exits 1 with the
#          trail. A diagnosed wait, never a sleep, never a retry.
#   [8/10] `npm run test:e2e` — exit criterion 3 (§18 Phase D: lineups ->
#          lock -> live -> finalize -> standings) in real browsers, the §8
#          proof map's row: L.D6.2's inseason trio plus the M1/M2/M3 suites.
#   [8.5]  The SAME settle AFTER Playwright — NEW at L.D6.3, and it is why
#          F298 exists. The stack lane is serialized against ITSELF
#          (vitest.config.ts, fileParallelism: false) but nothing serializes
#          it against the debris a just-finished browser run leaves on
#          Kong/PostgREST/Realtime. F298 measured it: two back-to-back full
#          Playwright runs then `npm run test` gave a cascade of PostgREST
#          500s across schedule-api-db / schedule-edit-api-db /
#          scoring-api-db, every one green in isolation seconds later, and a
#          third attempt on an idle stack was 217 files / 4,064 green first
#          try. In this gate's ordering that boundary is genuinely crossed:
#          [8] test:e2e -> [9] gate-m3, which resets and then runs its own
#          vitest lane full of `*-db` suites through PostgREST.
#   [9/10] `npm run test:gate:m3` — M3 continuity (its own fresh reset + full
#          pgTAP + the M3 vitest gate + the auction sim + E2E + M2 + M1 + M0).
#   [10/10] Banner. §1 criterion 1 is [2]+[3]+[4.x]+[5]; criterion 3 is [8];
#          criterion 4 (continuity) is [9/10] ALONE — see the next block for
#          why that is the whole of it. Criterion 2 (the real-2026 replay) is
#          L.D6.4's and is NOT claimed here.
#
# WHAT WAS CUT AND WHAT ALREADY COVERS IT (L.D6.3 fix round, 2026-09-09).
# The first shape of this gate ran FOUR explicit continuity stages —
# `[9] test:gate:m3`, `[10] test:gate:m2`, `[11] test:gate:m1`,
# `[12] test:gate` — on the L.B7.1 reading ("the task text names all four and
# paranoia is cheap"). That reading is WRONG here, because every milestone
# gate already invokes the one below it, by name, inside its own script:
#     gate-m3.sh:147,151,155  ->  test:gate:m2, test:gate:m1, test:gate
#     gate-m2.sh:93,97        ->  test:gate:m1, test:gate
#     gate-m1.sh:48           ->  test:gate
# So `[9/10]` does not merely overlap `[10]`-`[12]`; it SUBSUMES all three,
# minutes earlier, on the same tree, in the same process:
#   - `[10] test:gate:m2` was already run by gate-m3.sh's own `[6/9]`;
#   - `[11] test:gate:m1` was already run by gate-m2.sh's `[6/7]` within that;
#   - `[12] test:gate`    was already run by gate-m1.sh's `[4/4]` within that.
# COST OF THE THREE REMOVED STAGES, counted from those scripts: 3 further
# `db reset`s, 3 further full pgTAP suites, a second 25-league snake-draft sim
# (gate-m2.sh:78) and a FOURTH full 16-spec Playwright run (gate-m2.sh:89) —
# for ZERO assertions the run had not already made minutes before.
# THE CONTINUITY CLAIM IS UNCHANGED, and this is its honest form: nothing that
# ran once now runs zero times, the chain still reaches M0, and the evidence is
# `[9/10]`'s own stage log, which prints each nested gate's banner as it
# passes. The gate still proves continuity — it now proves it ONCE.
# (Reviewer check: the paranoia argument still holds INSIDE gate-m3.sh, where
# re-running m1/m0 costs a vitest lane measured in seconds. It does not hold at
# THIS level, where the redundancy cost a browser suite and three resets.)
#
# WHAT THIS GATE DOES NOT CLAIM (F284; the run prints the same list as
# `coverageGaps` on every scenario stage, and [5/10] transcribes it):
#   - An E32 lineup-edit LOCK REFUSAL at the door. `set_lineup` takes no
#     caller clock and season 2099 lies before every kickoff, so nothing this
#     harness submits is ever locked at submit (F284(a)/F296). The
#     `roster_add_drop` half IS walked, by [8]'s inseason-lock.spec.ts.
#   - E61 PENDING-NOT-ZERO on the D15 charted key at league level.
#     `example_charted_yards` is `scoring_surface: 'reserved'`
#     (stat-keys.ts:204); §23.5 (spec:2200) makes a reserved key "never
#     scorable in a format-2 doc, validation-rejected" and 103/104 refuse the
#     write (MEASURED: `scoring_rules_validate({...ESPN Standard,
#     example_charted_yards: 0.1})` -> '"example_charted_yards" cannot be
#     scored — it is a reserved key (§23.5)'). The two charted stages assert
#     §23.5's own league-level promise instead — ingested, enqueued, drained,
#     recomputed to `no_change`, no league cell moved, finalization timing
#     unmoved — under two NEW assertion names. PROGRESS §3 Q44 / F283.
#   - §7.3.6's BYE arm. MEASURED, not assumed: at the postponed game's
#     original kickoff `lineup_kickoff_internal` answers `on_bye=false
#     datum=nfl_games` for both its clubs, because ingest KEEPS a postponed
#     game's (season, week) row and 112:413-417 resolves the club's kickoff
#     with no status filter. F289.
#   - INVARIANT 4, the pool/roster mirror (§12.19/D294). `league_player_pool`
#     is written ONLY by `roster_add_drop_internal` (113:713/734, 115:646/667)
#     and the season harness drives no add/drops, so the table is EMPTY for
#     every sim league and the mirror loop iterates nothing — it returned clean
#     with the rule deleted. F300. The CLAIM is withdrawn rather than dressed
#     up, and the withdrawal is ENFORCED: [5/10] fails the gate if the
#     declaration goes missing from a report, or if `report.poolRows` is ever
#     non-zero (at which point the mirror is live and the declaration stale).
#   - WHICH OF "the window closed" AND "the week is final" GOVERNS a post-
#     window delta. §3 Q47 / F302, and the CAUSE is now established rather
#     than open: `finalize_matchups` lawfully holds a week on either of two
#     guards (118:2054 `games_not_final`, 118:2074 `pending_scores` /
#     `pending_results`) and both leave it at `correction_window` (118:2073),
#     which 119:570 admits — so a held week past its own
#     `correction_window_ends_at` is still open at the door. Demonstrated
#     ROLLED BACK on the 122 chain: cell NULL -> 123.45 after the window, with
#     the same week refused by name once `final`. The gate does not rule it —
#     [4.6] CLASSIFIES every such write with the finalize job's OWN reason and
#     fails only on a write it cannot explain, or one to a `final` week.
#   - D299's "strict/lax locks" axis, which is a RETIREMENT and not a gap:
#     Q34(A)/114 collapsed `lineup_lock` to one value and Q35/115 stripped
#     `player_game_lock` from settings. The surviving lock axis is
#     `allow_illegal_lineups`, which the matrix draws (sim-types.ts:86-102).
#
# FLAKE POLICY (the F113/F132 doctrine — a red is investigated against the
# NAMED mechanisms, never blanket-retried; an UNNAMED red FAILS the gate).
# ONE entry survives. The list is deliberately this short: an entry here is a
# licence to not-fail, so a mechanism that has been FIXED must lose its entry
# the moment it is fixed, or the gate begins certifying around live bugs.
#   - F132 (OPEN — the only one left): auction-api-db's "launcher bids FOR the
#     human seat" line, a same-transaction CPU answer inside the launcher's own
#     commit. Treat a red AT THAT EXACT LINE as F132, not a gate failure, IF it
#     fires once and isolates green:
#         npx vitest run src/lib/leagues/api/auction-api-db.test.ts
#     Rides stage [9/10] (gate-m3's own vitest lane).
# REMOVED at the L.D6.3 fix round, 2026-09-09, because each was FIXED AT THE
# CAUSE, and an entry for a fixed mechanism is worse than no entry at all:
#   - F56 (`e2e/auction-live.spec.ts:206`) and F297
#     (`e2e/auction-storm.spec.ts:347`) — both root-caused and fixed at PR
#     #279. F56 was an APPLICATION defect (the pre-start room had no
#     reconciliation of any kind, so one lost broadcast stranded it; it now
#     ASKS every 5 s while `scheduled`, and after #279's fix round the close
#     covers lost connectivity as well as lost broadcasts). F297 was the TEST
#     being wrong about a lawful engine behaviour (it asserted a state carrying
#     an anti-snipe deadline without ever saying so; the lot is now HELD
#     through D100's sanctioned virtual-time door, with a read-back that fails
#     BY NAME if the `draft_tick` cron got there first). Proven by three
#     CONSECUTIVE green full browser suites on a frozen tree.
#     A red at either line is now a NEW finding and FAILS this gate — and so is
#     a red at any OTHER line of either spec, which was never their signature.
#   - F74 (`draft-realtime-db`'s readiness-gate race) — fixed at PR #271
#     (D325(2)); the row is CLOSED and needs no containment here.
#   Anything else: the gate is RED. Investigate, do not re-run to green.
#
# THE COMPOSITION'S EXPOSURE — STATED, THEN CLOSED (PROGRESS §3 Q48 / B10).
# As first built this gate performed FOUR full 16-spec Playwright runs in one
# script, and two end-to-end attempts on 2026-09-08 both reached the M3-gate
# stage (numbered `[9/13]` then, `[9/10]` now — the same stage) with
# every M4-owned stage green and identical, then died in a COMPOSED M2/M3
# Playwright stage on a DIFFERENT pre-existing named intermittent each time
# (F56 at auction-live:206, F297 at auction-storm:347), each isolating green.
# BOTH HALVES OF THAT EXPOSURE ARE NOW GONE, and neither closed by relaxing
# anything: PR #279 root-caused and FIXED both intermittents (see FLAKE POLICY
# above), and this fix round cut the three SUBSUMED continuity stages, which
# removes the fourth browser run. Three Playwright runs remain — `[8/10]`'s
# own, `[9/10]`'s M3 gate, and that gate's own composed M2 gate — and each is
# load-bearing. Q48 is therefore ANSWERED BY REMOVING THE FLAKES rather than by
# widening a tolerance; B10 is cleared. The gate's bar is unchanged.
#   F292 IS DELIBERATELY NOT IN THIS BLOCK. It was a DETERMINISTIC red on
#   `main` (journey.spec.ts:79), fixed and merged at PR #277 before this gate
#   was built. This block names intermittent MECHANISMS; listing a
#   deterministic failure here would make the gate certify around a known
#   bug, which is the one thing a gate exists to prevent.
#   F294 IS ALSO NOT A FLAKE and needs no stage. The season sim's sweep
#   deletes season-2099 `player_stats`/`score_fanout` season-wide while the
#   e2e sweep is by prefix and by ledger, so the two could clobber each other
#   — but only if they ran CONCURRENTLY. This script runs under
#   `set -euo pipefail` with no `&` and no backgrounding, so its lanes run
#   strictly sequentially and each sweeps its own fixtures before the next
#   begins. The sequencing IS the mitigation; the narrowing stays a separate
#   fix. Related and NOT a flake either: `e2e/helpers/harness.ts:433`
#   `assertNoForeignSeasonFixtures` READS AND THROWS, deleting nothing — a
#   sim stage that dies before its `finally` makes [8] refuse loudly. That is
#   correct behaviour and means the previous stage left residue. Investigate;
#   never re-run.
#
# `set -euo pipefail` + no `&`/subshell swallowing: ANY partial failure
# aborts with that stage's non-zero exit (a partial pass must fail the whole
# command). NO RETRIES ANYWHERE, and the two settles are diagnosed waits, not
# sleeps. Requires the local Supabase stack up (`supabase start`) and network
# for stage [3.5]'s free sync APIs; a down stack fails loudly at [1/10],
# never skips (§4.3; D59(5)). LOCAL ONLY: `sim.ts`/`sim-census.ts` refuse any
# non-127.0.0.1 URL in body, and `.env.local` points at PRODUCTION.
#
# EXPECT HOURS, not minutes. COUNTED FROM THE SCRIPTS rather than estimated —
# the nested gates multiply, so this is what one `test:gate:m4` composes:
#   `db reset`             5  = [1/10] + gate-m3 + gate-m3's gate-m2 + that
#                               gate-m2's gate-m1 + gate-m3's own gate-m1
#   full pgTAP             5  = one `test:db` in each of those five
#   Playwright            3  = [8/10] + gate-m3's [7/9] + gate-m2's [5/7]
#   25-league draft sim    2  = gate-m3's auction sim + gate-m2's snake sim
#   100-league season run  9  = [4/10]..[4.8] (900 league-seasons)
# (Before the cut those lines were 8 / 8 / 4 / 3 — and the header as SHIPPED
# claimed 5 / 5 / 3 / 2 while the exposure block two paragraphs later said
# "FOUR full Playwright runs". They contradicted each other; the cut is what
# makes these numbers true.) Every stage prints its own elapsed seconds and the
# banner prints the total.
#
# AFTER a gate run the local DB holds only migration seeds + the draft-scope
# restore from the LAST reset ([9/10]'s, via the M3 -> M2 gate chain) —
# NOTHING ELSE. Re-create the local dev state per ACTIVE-BUILD before browser
# work: full `npm run restore:dev` (or RESTORE_SCOPE=draft) + the three
# Lists-v2 fixtures (R215 saved-list, R219 round-board, R247 player_count
# drift). The `.gate-m4/` report directory is gitignored and is overwritten
# by the next run.
set -euo pipefail

cd "$(dirname "$0")/.."

GATE_T0=$SECONDS
STAGE_T0=$SECONDS
stage() {
  STAGE_T0=$SECONDS
  echo ""
  echo "==> $1"
}
took() {
  echo "    [stage: $((SECONDS - STAGE_T0))s | elapsed: $((SECONDS - GATE_T0))s]"
}

echo "======================================================================"
echo "  M4 GATE (L.D6.3) — exit-criteria proof over the FULL migration chain"
echo "======================================================================"

echo ""
echo "!! THIS RESETS THE LOCAL DB — user-created local data (leagues, lists,"
echo "!! avatars) will be DESTROYED and cannot be restored; dev login and the"
echo "!! player pool are restored automatically (seed.sql + restore-dev.sh)."
echo "!! (L.C6.1 orchestrator ruling: the milestone gates are the sanctioned"
echo "!! exception to the no-ad-hoc-reset rule, and they announce themselves.)"

REPORT_DIR=.gate-m4
rm -rf "$REPORT_DIR"
mkdir -p "$REPORT_DIR"

stage "[1/10] Fresh local stack reset (pristine, fully-migrated chain 001-122)"
npx supabase db reset
took

stage "[2/10] Full pgTAP suite — test:db (057-070 are the M4 in-season files)"
echo "    (D144(5): this stage NEEDS the empty post-reset pool — before restore)"
npm run test:db
took

stage "[3/10] M4 vitest gate — 71 enumerated suites (F84; see the config header)"
npx vitest run -c vitest.gate-m4.config.ts
took

stage "[3.5] Draft-scope data restore (local-pinned; the sim/E2E pool)"
echo "    (D144(5)/F285(i): every stage below drafts the REAL restored pool)"
RESTORE_SCOPE=draft bash scripts/restore-dev.sh
took

stage "[3.6] Sim census PRE-FLIGHT (F199 — a run must not inherit a mess)"
npm run sim:census
took

# ---- [4/10] The 100-league synthetic run: NINE scenario stages -------------
# One scenario per run — a mechanism (season-runner.ts:52-68), not a taste.
# The ids are the library's own export, spelled here in SCENARIO_IDS order.
stage "[4/10] Synthetic season — happy_path, 100 leagues x 2 weeks, seed 42"
npm run sim -- season --leagues 100 --weeks 2 --seed 42 --scenario happy_path --report "$REPORT_DIR/happy_path.json"
took

stage "[4.1] Synthetic season — flex_move (E42: the lock follows the kickoff)"
npm run sim -- season --leagues 100 --weeks 2 --seed 42 --scenario flex_move --report "$REPORT_DIR/flex_move.json"
took

stage "[4.2] Synthetic season — postponement (E43: zero, locks, finalize without it)"
npm run sim -- season --leagues 100 --weeks 2 --seed 42 --scenario postponement --report "$REPORT_DIR/postponement.json"
took

stage "[4.3] Synthetic season — mass_inactives (scratched starters named, no crash)"
npm run sim -- season --leagues 100 --weeks 2 --seed 42 --scenario mass_inactives --report "$REPORT_DIR/mass_inactives.json"
took

stage "[4.4] Synthetic season — provider_outage (E45: raise, clear, back-fill)"
npm run sim -- season --leagues 100 --weeks 2 --seed 42 --scenario provider_outage --report "$REPORT_DIR/provider_outage.json"
took

stage "[4.5] Synthetic season — correction_in_window (E44's auto half)"
npm run sim -- season --leagues 100 --weeks 2 --seed 42 --scenario correction_in_window --report "$REPORT_DIR/correction_in_window.json"
took

stage "[4.6] Synthetic season — correction_post_window (D295(b): NO league cell)"
npm run sim -- season --leagues 100 --weeks 2 --seed 42 --scenario correction_post_window --report "$REPORT_DIR/correction_post_window.json"
took

stage "[4.7] Synthetic season — charted_late (E55/E57; see the coverage gap)"
npm run sim -- season --leagues 100 --weeks 2 --seed 42 --scenario charted_late --report "$REPORT_DIR/charted_late.json"
took

stage "[4.8] Synthetic season — charted_revision (E56; see the coverage gap)"
npm run sim -- season --leagues 100 --weeks 2 --seed 42 --scenario charted_revision --report "$REPORT_DIR/charted_revision.json"
took

stage "[5/10] Evidence — the D295 scenario->assertion map, transcribed by name"
npx tsx scripts/gate-m4-evidence.ts "$REPORT_DIR/"
took

stage "[6/10] Sim census POST-FLIGHT (F199 — the run left nothing behind)"
npm run sim:census
took

stage "[7/10] F56 bounded stack-health settle (diagnosed wait, never a sleep)"
npx tsx scripts/gate-settle.ts
took

stage "[8/10] Playwright E2E — §18 Phase D in real browsers (exit criterion 3)"
npm run test:e2e
took

stage "[8.5] The SAME settle AFTER Playwright (F298 — the lane boundary)"
npx tsx scripts/gate-settle.ts
took

stage "[9/10] M3 gate — continuity (own fresh reset + pgTAP + sim + E2E + M2/M1/M0)"
npm run test:gate:m3
took

echo ""
echo "======================================================================"
echo "  M4 GATE PASSED — tasks-M4 §1 exit criteria 1, 3 and 4 green"
echo "  (criterion 2, the real-2026 replay, is L.D6.4's and is NOT claimed)"
echo "  TOTAL: $((SECONDS - GATE_T0))s"
echo "======================================================================"
