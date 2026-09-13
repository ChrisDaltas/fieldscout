-- ============================================================================
-- `commish_move_player` / `commish_force_add_drop` — the commissioner's roster
-- overrides — migration 127 (task L.E1.6 of M6A; spec §15.4:1694-1695, §13.1,
-- E32, §12.7, §10.3, §12.12; CLAUDE.md business rule 7; tasks-M6A §3
-- D336 / D346 / D350 / D353 and §4 rules 1-15; PROGRESS §3 STANDING RULE
-- clauses (a), (b), (g), (i); D137).
--
-- WHAT THIS MIGRATION DOES
--   1. `commish_roster_actions` — this verb family's OWN zero-policy replay
--      ledger (D350), `UNIQUE (league_id, action_id)` + `REVOKE TRUNCATE`.
--   2. `commish_roster_lineup_sync_internal` — the lineup consequence, shared
--      by both verbs: 115's interplay loop (`115:673-730`) with D346's
--      `edited_by_commish = TRUE` added and the vacated CURRENT-week STARTING
--      slot returned so the caller can compute the score enqueue (an IR spot
--      is not a starting slot — R1018).
--   3. `commish_roster_override_internal` — ONE internal, TWO verbs behind a
--      `p_verb` discriminator (126's proven shape), writing `league_rosters`,
--      `league_player_pool`, `team_lineups` and `transactions` in one
--      transaction with exactly one `commissioner_actions` receipt.
--   4. `commish_move_player` (`spec:1694`) and `commish_force_add_drop`
--      (`spec:1695`) — the two SECURITY DEFINER client doors.
--
-- NO SCHEMA CHANGE BEYOND THE LEDGER. Measured before writing: `transactions`
-- already carries `type = 'commissioner_move'` in its CHECK, `initiator_team_id`
-- nullable with the comment *"NULL when commissioner-initiated"*, and
-- `related_action_id` whose FK to `commissioner_actions(id)` landed at
-- `123:461-462` (`109:239-250`). `league_rosters.acquisition_type` already
-- documents a `'commissioner'` value and carries NO CHECK (`072:142`).
-- **THIS VERB IS `transactions.related_action_id`'s FIRST WRITER** — `grep -c
-- related_action_id supabase/migrations/*.sql` finds it only in 109 (the
-- column), 123 (the FK) and here.
--
-- ── D137 PROVENANCE, AND THE DECOY ──────────────────────────────────────────
-- `roster_add_drop_internal`'s newest defining body is **`115:338-823`**, and
-- everything this migration copies from the manager's verb is copied from
-- THAT FILE TEXT — never from `pg_get_functiondef` and never from a deployed
-- body (CLAUDE.md's migration discipline; 073 once silently reverted three
-- migrations' guards exactly that way). `113:407` is the SUPERSEDED body and
-- PROGRESS Q56(b) cites it; it is not followed here. The same applies to the
-- D294 pool-mirror clauses: the broken-mirror refusal is `115:589-595` and the
-- post-write assertions are `115:732-753`; `113:658-661` / `113:799-820` are
-- the superseded copies. The table itself is `109:268-277` — NOT 072, which is
-- `CREATE TABLE league_rosters` and mentions `league_player_pool` zero times
-- (`grep -c league_player_pool supabase/migrations/072_draft_completion_rosters.sql`
-- → 0).
--
-- **115 IS NOT TOUCHED — NOT ONE BYTE (§4 rule 13).** The commissioner
-- exemption is a property of the NEW verb, never a relaxation of the manager's.
-- `roster_add_drop_internal` keeps its manager-only 42501 (`115:416-426`) and
-- both unconditional E32 arms (`115:528-537` drop, `115:601-608` add), and
-- pgTAP 075 §K pins all three in `prosrc` plus the one-overload count, the
-- `071:835-867` way. A verb built by adding a commissioner arm to 115 would
-- weaken a never-weaken surface and would red nothing that exists today — and
-- 061's own no-leak cell (the COMMISSIONER on another team is refused) stays
-- green **unmodified**, which is itself the evidence the split is right.
--
-- ── WHAT IS LIFTED AND WHAT BINDS (standing rule (g) and (i); F324) ─────────
-- Clause (i), Chris 2026-09-11: *"it's not fixing something that's broken,
-- it's changing the game entirely."* Commissioner powers repair a state that
-- went wrong INSIDE the rules; they do not redefine the rules. Applied here,
-- item by item, and each LIFT is NAMED in `bypassed[]` rather than performed
-- silently:
--
--   LIFTED — TIMING and REACHABILITY:
--     * **E32, both arms** (`115:528-537` drop, `115:601-608` add). The
--       game-day lock is the named application of clause (g). The lock's own
--       evaluation still RUNS — `pool_game_lock_any_internal` (`115:283`) is
--       called for every player this verb moves — and a locked player is
--       recorded as `e32_drop_lock:<id>` / `e32_add_lock:<id>` in `bypassed[]`
--       with the whole lock document in `metadata`. A rule walked past in
--       silence is not a receipt.
--     * **The waiver period** (`115:576-582`): `on_waivers` with
--       `waivers_until` still ahead refuses the MANAGER because claims are
--       M5's. That is a *when*, not a *what* — lifted, and named
--       `waiver_period:<id>`.
--     * **The acquisition caps** (`115:621-632`): a league throttle on how
--       often a manager may act. Lifted, and named `acquisitions_per_week` /
--       `acquisitions_per_season` when the count would in fact have refused.
--       **AND A CONSEQUENCE, STATED HERE RATHER THAN DISCOVERED (§4 rule 15):**
--       a commissioner force-add does not CONSUME the team's budget either,
--       because `115:497-506` counts `transactions` rows by
--       `initiator_team_id = p_team_id` and D353's shape writes that column
--       NULL. The result says so in `caps.commissioner_move_not_counted`.
--     * **The manager-only auth** (`115:416-426`), replaced by the
--       commissioner check in-body as ONE no-leak 42501.
--
--   BINDING — LEGALITY / VALIDITY, and these bind the commissioner too:
--     * **PLAYER EXCLUSIVITY** (`072:147`'s `UNIQUE(league_id, player_id)`,
--       CLAUDE.md business rule 7, §12.7). A force-ADD of a player rostered
--       on another team in this league is **REFUSED BY NAME**, never silently
--       moved — a roster on which one player sits twice is not a state the
--       game has. The refusal NAMES the lawful route (`commish_move_player`),
--       the F351 posture: a capability gap that is routed, not left. A MOVE
--       preserves exclusivity by construction (it is an UPDATE of `team_id`
--       on the one row, not a second INSERT).
--     * **`roster_size`** (§7.3.2). A roster over its own league's size is
--       likewise a shape the rules do not have; the refusal names the remedy
--       (send a drop in the same `commish_force_add_drop` call, or free a spot
--       on the receiving team first).
--     * **A `retired` franchise** (`spec:183` — *"name/record frozen"*,
--       §7.2.1). A sealed franchise is not a place a roster move can land.
--       **F352** records it so the next reader finds a decision and not an
--       oversight.
--     * **THE D294 POOL MIRROR** (`115:589-595` + `115:732-753`). This is not
--       a rule about who may act at all — it is an integrity assertion, and
--       the whole point of it is that it must NOT fire. Both refusal and
--       assertions are carried verbatim.
--     * The league must be `in_season` or `playoffs` (`115:449-453`, 126's
--       posture). Rosters do not exist before draft completion, which is what
--       flips the status (`066:823`, `086:448`, `110:882`).
--
-- **F324 IS RECORDED HERE, NOT DECIDED.** §11.1:721's *"illegal rosters …
-- never block the commissioner"* has a LEGALITY half that is Q59's and is
-- Chris's. Q59 was RULED for the lineup verb (*"even a commish cannot break
-- the positional rules"*) and clause (i) generalises it; M6A lifts timing
-- everywhere and legality nowhere. This migration builds to that shipped line
-- and says so. **L.E1.6 is F324's SECOND SITE** (routed by R986 at L.E1.2's
-- fix round); if Chris rules the other way it is a one-clause change per gate
-- above, each one already isolated and named.
--
-- ── THE NO-OP, AND WHY IT IS REACHABLE (D336(3), Chris's clause (b)) ────────
-- *"no receipt if nothing is done. only when something is done."* For this
-- family a no-op is NOT "the arguments were empty" — that is a malformed call
-- and is refused by name (126's rule). It is **the requested END STATE already
-- holds**:
--   * `commish_move_player` — the player is already on `p_to_team_id`. His
--     being on the wrong source team is exactly the stale-view case a retry
--     under a fresh `action_id` produces, and answering it with a refusal
--     would make the verb non-idempotent in the one direction a fallback verb
--     most needs to be.
--   * `commish_force_add_drop` — the add player (if any) is already on
--     `p_team_id` AND the drop player (if any) is already on no roster in this
--     league.
-- Detected BY VALUE across every dimension the verb can change (the roster
-- row's owning team, and the roster row's existence), never inferred from an
-- empty write. On a no-op: NO `commissioner_actions` row, NO `league_chat`
-- post, NO `transactions` row, NO lineup write — and the replay-ledger row IS
-- written anyway (§12.26: *"an `action_id` is an idempotency key, not an audit
-- record"*), the 123:1259-1266 posture.
--
-- ── THE SCORING CLAUSE (D346 — DECIDED BY THE ARCHITECT, NOT HERE) ──────────
-- These verbs lift E32, so they can take a player whose game is FINAL out of a
-- starting slot. That inherits `123:196-250`'s entire scoring clause, which
-- `roster_add_drop` never needed and therefore never built (measured: `grep -c
-- score_fanout` over 113 and 115 → 0 each; correct, because a manager can
-- never move a kicked-off player at all).
--
-- `123:196-250` already PROVED that an enqueue alone is insufficient: the
-- evicted player starts NOWHERE afterwards, so the drain finds
-- `toCompute.size === 0`, reports `skipped` and DELETES the row — *"the lineup
-- moved, the row was consumed, and the stored points still carry the benched
-- player, for ever"*. It takes BOTH halves:
--   (a) **THE DRAIN-SIDE FORCE.** The eviction is routed THROUGH the
--       `team_lineups` row and sets `edited_by_commish = TRUE`, which
--       `score-week-worker.ts` already reads (the `team_id, slot_map,
--       edited_by_commish` select and `if (row.edited_by_commish === true)
--       commishEdited.add(row.team_id)`, then `for (const teamId of
--       commishEdited) toCompute.add(teamId)` — step (5b)/R965). Zero worker
--       cost; `league_rosters` has no analogue, which is why the eviction goes
--       through the lineup row rather than through a second signal.
--   (b) **THE ENQUEUE, AND THE STAMP IS THE TRAP.** The symmetric difference
--       of the CURRENT week's starter sets, stamped with each player's OWN MIN
--       `player_stats.updated_at` for the week — **never `now()`**. The
--       worker's readiness rule is `player_stats.updated_at >= enqueued_at`,
--       so a `now()` stamp is `not_ready` FOREVER: deferred every drain and
--       never scored, which is worse than doing nothing. MIN and not MAX
--       because the worker's line map keeps an arbitrary row per player when
--       several exist. `ON CONFLICT DO NOTHING` so an existing healthy row is
--       never re-stamped, and every player the queue could not stamp is NAMED
--       in `score_not_enqueued` with `no_stat_row` / `stats_unstamped` — the
--       `stats_unstamped` arm setting `score_stale` rather than being folded
--       into silence. Nothing is enqueued on a `final` week (the write door
--       raises `week_final`, `119:566-568`, and the worker consumes the row
--       with no cell changed) and the result says `score_stale_reason =
--       'week_final'` instead.
--
-- **AND A THIRD HALF D346 DID NOT ANTICIPATE, FOUND BY THE STACK TEST AND NOT
-- BY READING (F353): A DROPPED PLAYER'S ENQUEUE REACHES NO LEAGUE AT ALL.**
-- The two halves above are 123's, and 123's premise is that the player it
-- benches STAYS ON THE ROSTER. The worker maps a queued player to LEAGUES
-- through the roster index — its own docblock, step 3: *"ready players →
-- leagues through `idx_league_rosters_player` … The LEAGUE comes from the
-- roster index"*, implemented in `readRosterLeagues` as a `league_rosters`
-- read filtered to the season's `in_season|playoffs` leagues. **A force-DROP
-- deletes that roster row**, so the queue row this verb writes for the dropped
-- player maps to NOTHING: the drain never visits the league-week, the
-- `edited_by_commish` force never gets a chance to fire, and the stored points
-- keep the dropped player for ever — 123's own failure one layer further out.
-- **MEASURED, not reasoned:** the first cut of this migration shipped exactly
-- the two halves above, and `score-week-worker-db.test.ts`'s new cell reded
-- with `report.leagues: []` on the drain AFTER the drop while the identical
-- drain BEFORE it reported the league `written`.
-- So the verb also queues a **REACH SET** — players the league STILL rosters,
-- drawn from the affected teams' remaining rosters, each with its own stamp and
-- `ON CONFLICT DO NOTHING`. They are not queued to be re-scored for their own
-- sake (the drain recomputes every starter of an affected team through
-- `extraStats` once it arrives); they are queued so the drain ARRIVES. And
-- reachability is then **measured against the state about to be committed** —
-- "does a queued row for this season-week name a player THIS league rosters?",
-- the worker's own predicate — and a NO sets `score_stale` with
-- `score_stale_reason = 'unreachable'` rather than reporting a success.
-- `score_reach_enqueued[]` and `score_reachable` are on the receipt and in the
-- audit metadata. A MOVE never needs this (the player stays rostered, on the
-- other team) and gets it anyway, which costs at most `roster_size` rows per
-- touched team.
--
-- **AND THE COST IS NOT ONLY THIS LEAGUE'S, WHICH IS STATED HERE RATHER THAN
-- DISCOVERED (R1023).** `score_fanout` is keyed `(season, week, player_id)`
-- with no league column — that is the queue's design, and it is why the worker
-- has to map a player back to leagues through the roster index at all. So
-- every row this verb writes, primary and reach set alike, makes those players
-- re-drain for **every other in-season league that also rosters them**, which
-- in a popular player's case is all of them. It is harmless — the drain is
-- idempotent, recomputes the same numbers and consumes the row — but it is a
-- real fan-out in shared infrastructure and a future load question (§22.6 is
-- M7's), not a per-league cost. Narrowing it would mean a league-scoped queue,
-- which is a schema change and a worker change, and is NOT taken here.
--
-- **F344 — THE FLAG IS WIDENED, IN D346's OWN WORDS, AND THAT IS STATED HERE
-- RATHER THAN DISCOVERED IN THE UI.** `team_lineups.edited_by_commish` meant
-- *"a commissioner SET this lineup"* (`commish-lineup-service.ts` sets it as a
-- literal `true`). After this migration it means *"a commissioner CHANGED this
-- lineup row"* — which a force-drop out of a starting slot genuinely is, **but
-- a week a manager set himself now carries it.** Its six other readers see the
-- wider meaning: `team-page.tsx`'s `✸ commissioner-set` badge (the
-- `edited_by_commish` badge), `use-lineup.ts` (the type and the select list),
-- `lineup-service.ts`, and `box-score-service.ts` (three sites). The widening
-- is ACCEPTED, not denied; pgTAP 075 §J pins the flag and
-- `team-page.render.test.ts` pins what the badge renders at the same fixture
-- state, so the user-visible consequence is asserted in the task that causes
-- it. L.E1.13 re-reads the copy against the wider meaning. The rejected
-- alternative — a distinct column or a second signal — loses on cost with its
-- number stated: the worker selects exactly `team_id, slot_map,
-- edited_by_commish`, so a new signal is a migration PLUS a worker change PLUS
-- a new never-weaken surface, to re-express something the row already says.
--
-- `set_at` is deliberately NOT written (four columns, not five — the D356(5)
-- posture): nobody SET this lineup, a roster move changed it underneath. The
-- flag is written on EVERY lineup row this verb changes, current week and
-- future weeks alike, because that is literally what the widened sentence
-- says; only the current week's flag can reach the drain (a `final` week
-- returns early and an `upcoming` week is held).
--
-- ── `commish_force_add_drop`'s SIGNATURE, WHICH `spec:1695` DOES NOT PRINT ──
-- §15.4 prints the verb as `commish_force_add_drop(...)` — literally an
-- ellipsis, the only §15.4 line with no argument list. The task's DoD requires
-- the list to be written into the banner with its reasoning, so:
--
--     commish_force_add_drop(p_league_id, p_team_id, p_add, p_drop,
--                            p_reason, p_action_id)
--
-- and it is NOT a guess. (1) It is `roster_add_drop`'s own argument list
-- (`113:900-905`: `p_league_id, p_team_id, p_add, p_drop, p_action_id`) plus
-- §15.4's mandatory `reason`, in the position every other verb in the list
-- puts it — and this verb IS the manager verb with the timing gates lifted, so
-- a different shape would be a second contract for one operation. (2) It is
-- what tasks-M6A §5's interface sketch prints, and §5's names are
-- **contractual** ("Builder finalizes exact fields; names below are
-- contractual"). (3) It matches the sibling `commish_move_player`, whose list
-- §15.4 DOES print (`player_id, from, to, reason`) and which takes
-- `p_league_id` first and `p_action_id` last for the same reason every verb in
-- this slice does: `p_league_id` is the auth subject and `p_action_id` is the
-- idempotency key, neither of which §15.4 prints for ANY verb because §15.4
-- prints route bodies, not SQL signatures (`commish_edit_lineup` shipped the
-- same way at `123:1279-1286`). Nothing about it is genuinely ambiguous, so
-- there is no §11 question to file — the DoD's STOP branch is not taken, and
-- this paragraph is the reason why.
--
-- Both `p_reason` and `p_action_id` carry `DEFAULT NULL` and are REQUIRED
-- in-body (22023) — the default exists only to keep §15.4's printed order, the
-- `123:1284-1285` posture.
--
-- ── F350, MEASURED OUT OF ITS OWN ROUTING ──────────────────────────────────
-- F350 (`lineup_fit_internal` has no duplicate-player guard, `112:500-512`)
-- was routed to this task on the premise that *"`commish_move_player` seeds
-- fixed placements the same way — the next caller that could pass a
-- duplicate"*. **Measured on this file: it does not call the matcher at all.**
-- `grep -c lineup_fit_internal supabase/migrations/127_commish_roster_moves.sql`
-- → 0, for a structural reason rather than an accident: a roster move is not a
-- re-fit. It copies `roster_add_drop_internal`'s lineup interplay
-- (`115:673-730`), which REMOVES the evicted player's own key by name and
-- APPENDS an added player to the bench behind a `NOT (v_bench ? p_add)` guard.
-- The map this verb writes is always the stored map MINUS one key, so it can
-- neither introduce a duplicate nor hand one to the matcher, and §2's helper
-- carries its own post-write assertion (the added player appears in NO
-- `slot_map` value and EXACTLY ONCE in `bench`, on every row it touched), with
-- pgTAP 075 §I as the cell. **F350 is therefore RE-ROUTED, not discharged:**
-- the matcher still has no guard, its three callers (`set_lineup_internal`,
-- `commish_edit_lineup_internal`, `lineup_autopilot_internal`) still rely on
-- their own COALESCE discipline (D356(7c)), and no remaining M6A task adds or
-- replaces a caller. The owner is the next migration that does — M5's trade
-- verbs are the next candidate.
--
-- ── AND THE THREE-VALUED READ THAT SHIPPED A BUG ONE TASK AGO (D356(7c)) ───
-- `NULL IN (…)` is NULL, so any boolean built from a nullable read and then
-- NEGATED needs `COALESCE(…, FALSE)`. This file does not read `designation` at
-- all, and every nullable-sourced boolean it does build — the two game-lock
-- reads — is compared with the explicit `(v_lock ->> 'locked')::boolean` form
-- inside a plain `IF`, which is 115's own shape and does not fire on NULL. The
-- rule is restated here because the next reader of this family will be
-- tempted to add a designation gate.
--
-- ── WHAT THIS MIGRATION DOES NOT DO, DELIBERATELY ──────────────────────────
--   * `roster_add_drop_internal` / `roster_add_drop` (115/113),
--     `pool_game_lock_internal` / `pool_game_lock_any_internal` (115),
--     `set_lineup_internal` (114), `lineup_fit_internal` (112) and
--     `score_write_week_batch` (119) are NOT touched — not one byte (rule 13).
--     pgTAP 075 §K pins the ones this verb's exemption mirrors.
--   * No new column on `commissioner_actions` (D336: that would be a spec
--     question, not a migration). `action_type` is `move_player` / `force_add`
--     / `force_drop` and `target_type` is `player` — all four already in
--     §12.12's printed vocabulary (`123:280-286`), and `target_id` is TEXT on
--     purpose because `players.id` is TEXT (`123:288-289`).
--   * No FAAB and no trade (F340 — deferred WITH M5 for want of a subject).
--     `acquisition_cost` is written 0 on every row this verb creates or moves;
--     a commissioner move is not a purchase.
--   * No `HELD-FROM-PRODUCTION.txt` entry. The hold was cleared 2026-09-09
--     (PR #282) and `npx supabase db push` is Chris's to run after merge.
--     **Migrations 125 and 126 are merged and NOT yet pushed**, so this one is
--     authored against the repo's migration chain and never against a deployed
--     body; a red `db-drift.yml` between merge and push is that check working.
--
-- ── THE FIX ROUND (PR #297, 2026-09-13) — FIVE SHOULD-FIXES AND THREE NITS ─
-- 127 is EDITED IN PLACE and no new number is minted: 125, 126 and 127 all
-- still await Chris's `npx supabase db push`, so there is no deployed body to
-- diverge from, and 128 is L.E1.7's. What changed and where:
--   * **R1016** — the PRIMARY (symmetric-difference) enqueue had ZERO
--     coverage: every §C/§D/§H arm of the first cut made it non-inserting
--     (`unrostered`, `stats_unstamped`, `no_stat_row`, `week_final`), so
--     stamping it `now()` reded nothing. The build round's own probe 2 changed
--     BOTH enqueue sites at once and therefore could not tell them apart —
--     the vacuous-proof species §4 rule 14 exists for. pgTAP 075 **§P** is the
--     cell that walks it, and the reviewer's isolated probe (only the primary
--     stamp → `p_at`) is now a red-by-name.
--   * **R1017** — a raw 23505 could escape to the wire: `action_id` is a
--     SHARED `(league_id, action_id)` namespace with the manager's verb.
--     Guarded by name at step (3b), 115's R732 check mirrored.
--   * **R1018** — an IR spot was treated as a vacated STARTING slot. Filtered
--     with the scoring worker's own predicate; see section 2's banner.
--   * **R1019** — `action_type` / `arm` keyed on the PARAMETERS, so an
--     add-no-op + real drop was stamped `force_add`. Keyed on the normalized
--     plan; see step (7).
--   * **R1020** — the retired-franchise refusal named a remedy nobody built.
--     Re-measured and re-worded; **F354** owns the missing capability.
--   * **R1021 / R1022 / R1023** — 075's C2 pins the manager's refusal BY
--     MESSAGE (the suite header's claim made true); 075 I3 scans all four
--     functions, not two; the `caps` counts follow the ACQUIRING team and the
--     receipt names it; the reach set's cross-league fan-out is stated in
--     SCORING above.
--
-- MIGRATION CHECKLIST (tasks-M4 §4 rule 5): additive only — one new table,
-- THREE new functions, ZERO functions replaced (so there is no D137 hunk count
-- to state: nothing existing is re-authored). No column dropped, no constraint
-- weakened, no grant widened: the ledger takes `REVOKE TRUNCATE` (D350), the
-- two internals are PLAIN + `search_path=''` + triple-REVOKEd, and the two
-- client doors keep EXECUTE for `authenticated` only with the commissioner
-- check in-body. No R6/D38 waiver is claimed. Numbers confirmed with
-- `ls supabase/migrations/ | tail -1` → `126_commish_matchup_override.sql` and
-- `ls supabase/tests/ | tail -1` → `074_commish_matchup_override.sql` at task
-- time (D161/D166 — never a number read from a planning document) ⇒ 127 / 075.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. commish_roster_actions — this verb family's OWN replay ledger (D350).
--    Never shared with commish_lineup_actions or commish_matchup_actions, and
--    never folded into commissioner_actions: §12.12 ships a client INSERT
--    policy (`123:333-335`), so a commissioner could pre-plant a row carrying
--    an action_id his client is about to send and a fabricated `result`, and
--    the replay would return it having moved nothing. A separate ZERO-POLICY
--    table makes that impossible rather than merely refused.
--
--    BOTH verbs share this namespace on purpose — they are one verb family
--    over one league's rosters, so a `commish_move_player` retry and a
--    `commish_force_add_drop` retry carrying the same action_id must return
--    the same document, not two. (`transactions.action_id` is a SECOND replay
--    key over the same submit, and it is kind-scoped by 115's R732 check — but
--    it cannot be this family's ledger, because a NO-OP writes no transactions
--    row at all and a retry of a no-op must still replay.)
-- ---------------------------------------------------------------------------
CREATE TABLE commish_roster_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,  -- the team acted ON (a MOVE records the destination)
  action_id  UUID NOT NULL,                       -- client-minted; dedupes retries (the E2/D68 replay key)
  actor_id   UUID NOT NULL REFERENCES profiles(id),
  result     JSONB NOT NULL,                      -- the verb's returned jsonb, replayed byte-identically
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, action_id)                   -- the race backstop behind the select-then-insert
);
CREATE INDEX idx_commish_roster_actions_team ON commish_roster_actions(team_id);

COMMENT ON TABLE commish_roster_actions IS
  'Idempotency ledger for commish_move_player / commish_force_add_drop (migration 127, D350). ZERO policies: the DEFINER verbs are the only reader and writer. NOT the audit log — §12.26: "an action_id is an idempotency key, not an audit record" — so a row is written for a NO-OP too, while commissioner_actions is not.';

ALTER TABLE commish_roster_actions ENABLE ROW LEVEL SECURITY;
-- ZERO policies (112:330's posture). RLS does NOT cover TRUNCATE and the
-- Supabase default grants it to anon and authenticated (R967, measured on
-- commish_lineup_actions at `123:485-491`), so a client could otherwise have
-- emptied a ledger it can read nothing in. Taken away here — §4 rule 12, and
-- F349's app-wide sweep (deferred by Chris's ruling 2026-09-13, "we currently
-- have no users so it's fine") is deliberately NOT widened by this table.
-- Asserted PER ROLE with has_table_privilege in pgTAP 075 §B: a pg_policies
-- cell structurally cannot see a TRUNCATE grant, which is how F348's hole
-- survived 070.
REVOKE TRUNCATE ON TABLE commish_roster_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. commish_roster_lineup_sync_internal — THE LINEUP CONSEQUENCE, shared.
--
--    Derived from `roster_add_drop_internal`'s interplay loop (`115:673-730`,
--    D137 — that file text, not 113's superseded copy) with exactly two
--    differences, both named:
--      (A) `edited_by_commish = TRUE` rides the same UPDATE (D346). `set_at`
--          does NOT: nobody SET this lineup, a roster move changed it
--          underneath (the D356(5) four-columns-not-five posture).
--      (B) it RETURNS the CURRENT week's vacated STARTING slot key, so the
--          caller can compute the score enqueue from measured before/after
--          starter sets rather than from an assumption about where the player
--          sat.
--
--    **AN IR SPOT IS NOT A STARTING SLOT, AND THE FILTER IS THE WORKER'S OWN
--    (R1018).** `123:1022-1029` excludes `v_ir_spots` keys when it builds the
--    old starter set, and the first cut of this file dropped that filter — so
--    a move out of `ir1:0` reported a vacated slot, set `score_stale`, queued
--    a row and told the whole league *"a week-N starting slot was emptied"*
--    when the starter set had not changed at all: the R969 false alarm, in the
--    field whose only job is to be believed. The predicate used here is the
--    SCORING WORKER's rather than 123's, deliberately: `startersOf`
--    (`score-week-worker.ts:415-425`) splits the map key on `':'` and tests
--    the PREFIX against `irKeysOf`'s BARE keys (`:397-407`), while 123 matches
--    the whole instance key `'<key>:0'`. The two agree on every map 123 can
--    write; they differ on an `ir1:1`, and this field exists to predict what
--    the WORKER will see. `p_ir_keys` therefore carries bare keys and the test
--    is on `split_part(key, ':', 1)`.
--
--    Q32 (Chris, 2026-09-03) still governs the removal: the entry is ALWAYS
--    cleared — there is no kept phantom — and IR keys are roster-level spots
--    cleared the same way. Every week from `p_first_week` on is touched,
--    exactly as the manager's verb does.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_roster_lineup_sync_internal(
  p_league_id  UUID,
  p_team_id    UUID,
  p_season     INTEGER,
  p_first_week INTEGER,
  p_current    INTEGER,
  p_remove     TEXT,
  p_add        TEXT,
  p_ir_keys    TEXT[]      -- the league's BARE ir_slots keys (R1018); never NULL-meaning-none by accident
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_row      public.team_lineups;
  v_map      JSONB;
  v_starters JSONB;
  v_bench    JSONB;
  v_key      TEXT;
  v_changed  BOOLEAN;
  v_cnt      INTEGER;
  v_rows     JSONB := '[]'::jsonb;
  v_vacated  TEXT  := NULL;   -- the CURRENT week's vacated slot, or NULL
BEGIN
  FOR v_row IN
    SELECT tl.* FROM public.team_lineups tl
    WHERE tl.team_id = p_team_id AND tl.season = p_season AND tl.week >= p_first_week
    ORDER BY tl.week
    FOR UPDATE
  LOOP
    v_map      := COALESCE(v_row.slot_map, '{}'::jsonb);
    v_starters := COALESCE(v_row.starters, '[]'::jsonb);
    v_bench    := COALESCE(v_row.bench, '[]'::jsonb);
    v_changed  := FALSE;
    v_key      := NULL;

    IF p_remove IS NOT NULL THEN
      SELECT e.key INTO v_key FROM jsonb_each_text(v_map) e WHERE e.value = p_remove LIMIT 1;
      IF v_key IS NOT NULL THEN
        v_map := v_map - v_key;
        SELECT COALESCE(jsonb_agg(
                 CASE WHEN s ->> 'slot' = v_key
                      THEN s || jsonb_build_object('player_id', NULL, 'position', NULL, 'kickoff_at', NULL, 'flags', '["empty"]'::jsonb)
                      ELSE s END ORDER BY ord), '[]'::jsonb)
        INTO v_starters
        FROM jsonb_array_elements(v_starters) WITH ORDINALITY AS t(s, ord);
        v_rows := v_rows || jsonb_build_object('week', v_row.week, 'slot', v_key, 'arm', 'removed');
        -- R1018: only a STARTING slot counts as vacated. An IR spot is not in
        -- the worker's starter set (`startersOf` skips any key whose prefix is
        -- an `ir_slots` key), so emptying one changes no score and must not
        -- raise `score_stale`, queue a row, or tell the league a starting slot
        -- was emptied. The row itself is still reported in `rows` above — the
        -- lineup DID change, and under-reporting that would be its own lie.
        IF v_row.week = p_current
           AND NOT (split_part(v_key, ':', 1) = ANY (COALESCE(p_ir_keys, ARRAY[]::text[]))) THEN
          v_vacated := v_key;
        END IF;
        v_changed := TRUE;
      END IF;
      IF v_bench ? p_remove THEN
        SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
        FROM jsonb_array_elements(v_bench) x WHERE (x #>> '{}') <> p_remove;
        -- R758: a bench-only removal reports its row too (slot NULL), so the
        -- result never under-reports which lineup rows the move touched.
        IF v_key IS NULL THEN
          v_rows := v_rows || jsonb_build_object('week', v_row.week, 'slot', NULL, 'arm', 'removed');
        END IF;
        v_changed := TRUE;
      END IF;
    END IF;

    IF p_add IS NOT NULL AND NOT (v_bench ? p_add) THEN
      SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
      FROM jsonb_array_elements(v_bench || to_jsonb(p_add)) x;
      v_rows := v_rows || jsonb_build_object('week', v_row.week, 'slot', NULL, 'arm', 'added');
      v_changed := TRUE;
    END IF;

    IF v_changed THEN
      -- DIFFERENCE (A): edited_by_commish rides the same statement (D346).
      UPDATE public.team_lineups
      SET slot_map = v_map, starters = v_starters, bench = v_bench, edited_by_commish = TRUE
      WHERE id = v_row.id;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'commish_roster_lineup_sync: the week-% sync touched % rows, expected 1', v_row.week, v_cnt
          USING ERRCODE = 'P0001';
      END IF;

      -- F350's site-local answer, asserted rather than argued: after this
      -- write the added player is in NO slot_map value and EXACTLY ONCE on the
      -- bench, and the removed player is nowhere on the row at all. The
      -- matcher's missing duplicate guard is not this verb's exposure (it
      -- never calls it), but a duplicate WRITTEN here would double-count in
      -- `startersOf`, so the claim is measured on every row rather than
      -- reasoned about once in a banner.
      IF p_add IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM jsonb_each_text(v_map) e WHERE e.value = p_add)
           OR (SELECT count(*) FROM jsonb_array_elements(v_bench) x WHERE (x #>> '{}') = p_add) <> 1 THEN
          RAISE EXCEPTION
            'commish_roster_lineup_sync: after the week-% sync % is not exactly once on the bench and off every slot of team % (F350 — a duplicate here would double-count in the scoring worker) — refusing',
            v_row.week, p_add, p_team_id
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
      IF p_remove IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM jsonb_each_text(v_map) e WHERE e.value = p_remove)
           OR v_bench ? p_remove THEN
          RAISE EXCEPTION
            'commish_roster_lineup_sync: after the week-% sync % is still named by team %''s lineup row — refusing', v_row.week, p_remove, p_team_id
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('rows', v_rows, 'vacated_current_slot', v_vacated);
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_roster_lineup_sync_internal(UUID, UUID, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT[])
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. commish_roster_override_internal — ONE internal, TWO verbs (126's shape).
--    PLAIN (not DEFINER), search_path='', triple-REVOKEd, taking the instant
--    as an argument (the TimeProvider seam pgTAP drives) — 123:498-505's
--    posture verbatim.
--
--    D336's seven parts, and where each one is:
--      (1) the ledger      → `commish_roster_actions` above, zero policies
--      (2) ONE audit row   → `log_commissioner_action_internal`, INSIDE the
--                            no-op guard and AFTER the state write, with
--                            `IF v_audit_id IS NULL RAISE`
--      (3) the no-op       → DETECTED by value across every dimension the verb
--                            can change; ledger row written anyway
--      (4) the chat post   → in-txn, non-disableable, inside the guard
--      (5) the posture     → this PLAIN internal + two DEFINER wrappers
--      (6) the reason gate → the explicit E' \t\r\n' class, bounded at 500
--      (7) the result      → names every rule bypassed and every downstream
--                            that did or did not follow, by name
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_roster_override_internal(
  p_league_id    UUID,
  p_team_id      UUID,          -- force_add_drop's team (NULL for a move)
  p_add          TEXT,
  p_drop         TEXT,
  p_player_id    TEXT,          -- move's player (NULL for add/drop)
  p_from_team_id UUID,
  p_to_team_id   UUID,
  p_action_id    UUID,
  p_at           TIMESTAMPTZ,
  p_reason       TEXT,
  p_verb         TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league        public.leagues;
  v_found         BOOLEAN;
  v_is_move       BOOLEAN;
  v_result        JSONB;
  v_reason        TEXT;
  v_current       INTEGER;
  v_lw            public.league_weeks;
  v_week_status   TEXT;
  v_roster_size   INTEGER;
  v_hold_hours    INTEGER;
  v_period_hours  INTEGER;
  v_waiver_type   TEXT;
  v_cap_week_txt  TEXT;
  v_cap_season_txt TEXT;
  v_cap_week      INTEGER;
  v_cap_season    INTEGER;
  v_used_week     INTEGER;
  v_used_season   INTEGER;
  -- the normalized plan: who loses a player, who gains one
  v_lose_team     UUID;
  v_gain_team     UUID;
  v_lose_player   TEXT;
  v_gain_player   TEXT;
  v_lose_row      public.league_rosters;
  v_lose_p        public.players;
  v_gain_p        public.players;
  v_owner_team    public.teams;
  v_team_a        public.teams;         -- the move's FROM team / the add-drop team
  v_team_b        public.teams;         -- the move's TO team
  v_pool          public.league_player_pool;
  v_pool_from     TEXT;
  v_drop_to_state TEXT;
  v_drop_until    TIMESTAMPTZ;
  v_hold_early    BOOLEAN := FALSE;
  v_lose_lock     JSONB;
  v_gain_lock     JSONB;
  v_no_changes    BOOLEAN;
  v_audit_id      UUID;
  v_action_type   TEXT;
  v_arm           TEXT;
  v_bypassed      JSONB := '[]'::jsonb;
  v_affected      JSONB := '[]'::jsonb;
  v_lineups       JSONB := '[]'::jsonb;
  v_sync          JSONB;
  v_vacated       TEXT := NULL;
  v_ir_keys       TEXT[] := ARRAY[]::text[];   -- R1018: the league's BARE ir_slots keys
  v_txn_type      TEXT;                        -- R1017: the verb that already owns this action_id
  v_cap_team      UUID;                        -- R1022: the team the acquisition counts are ABOUT
  v_before        JSONB;
  v_before_drop   JSONB;
  v_after         JSONB;
  v_rescore       TEXT[] := ARRAY[]::text[];
  v_enqueued      JSONB := '[]'::jsonb;
  v_not_enq       JSONB := '[]'::jsonb;
  v_reach         TEXT[] := ARRAY[]::text[];
  v_reach_enq     JSONB := '[]'::jsonb;
  v_reachable     BOOLEAN := FALSE;
  v_unstamped     TEXT[] := ARRAY[]::text[];
  v_score_stale   BOOLEAN := FALSE;
  v_stale_why     TEXT := NULL;
  v_txn_id        UUID := gen_random_uuid();
  v_message       TEXT;
  v_cnt           INTEGER;
  v_count_a       INTEGER;
  v_count_b       INTEGER;
  v_exp_a         INTEGER;
  v_exp_b         INTEGER;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and is never answered with
  --     `no_changes: true` — a success document for a request that never said
  --     what it wanted is 126's rule, and it is this family's too.
  IF p_verb IS NULL OR p_verb NOT IN ('commish_move_player', 'commish_force_add_drop') THEN
    RAISE EXCEPTION
      'commish_roster_override_internal: p_verb must be commish_move_player or commish_force_add_drop (got %) — the internal is not a client door', COALESCE(p_verb, 'null')
      USING ERRCODE = '22023';
  END IF;
  v_is_move := (p_verb = 'commish_move_player');

  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      '%: p_action_id is required (idempotency key — one UUID per submit, reused on retry)', p_verb
      USING ERRCODE = '22023';
  END IF;

  IF v_is_move THEN
    IF p_player_id IS NULL OR p_from_team_id IS NULL OR p_to_team_id IS NULL THEN
      RAISE EXCEPTION
        '%: p_player_id, p_from_team_id and p_to_team_id are all required (§15.4:1694 — commish_move_player(player_id, from, to, reason))', p_verb
        USING ERRCODE = '22023';
    END IF;
    IF p_from_team_id = p_to_team_id THEN
      RAISE EXCEPTION
        '%: from and to name the same franchise (%) — a move changes which roster holds the player (§13.1)', p_verb, p_from_team_id
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_team_id IS NULL THEN
      RAISE EXCEPTION '%: p_team_id is required', p_verb USING ERRCODE = '22023';
    END IF;
    IF p_add IS NULL AND p_drop IS NULL THEN
      RAISE EXCEPTION
        '%: nothing to do — give a player to add, a player to drop, or both (§13.1); an override that names no player is not an override', p_verb
        USING ERRCODE = '22023';
    END IF;
    IF p_add IS NOT NULL AND p_add = p_drop THEN
      RAISE EXCEPTION '%: add and drop name the same player (%) — a move changes the roster (§13.1)', p_verb, p_add
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8; D294's one
  --     serialization point — the same one the manager's verb takes).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — COMMISSIONER ONLY, in-body, as ONE no-leak 42501 covering "no
  --     such league" and "not a commissioner" alike (D336 part 5). This
  --     REPLACES the manager-only check at `115:416-426`; 115 keeps its own.
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION '%: not a commissioner of this league', p_verb
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), placed AFTER auth but BEFORE every business gate
  --     (123:602-609's placement), so a retry replays byte-identically even
  --     when the league has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_roster_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (3b) THE SECOND REPLAY KEY, GUARDED BY NAME (R1017; 115's R732 check at
  --      `115:429-443` is the mirror of this one, and it guards only its own
  --      direction). `uniq_transactions_league_action` (`113:283-285`) is a
  --      SHARED `(league_id, action_id)` namespace across the manager's verb
  --      and this one, so an action_id already spent on a `roster_add_drop`
  --      submit would otherwise reach (17)'s INSERT and escape as a raw 23505
  --      — a 500 at the client, because `mapInSeasonRpcError` has no 23505
  --      arm. This family's OWN ledger (step 3) has already answered every
  --      retry of THIS verb, so reaching here means a DIFFERENT verb owns the
  --      key: refuse by name and say which.
  SELECT t.type INTO v_txn_type
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.action_id = p_action_id;
  IF FOUND THEN
    RAISE EXCEPTION
      '%: action_id % already names a "%" transaction in this league — an action_id identifies ONE submit of ONE verb (R732/R1017). Mint a new action_id for this override, or retry the verb that owns that one',
      p_verb, p_action_id, v_txn_type
      USING ERRCODE = 'P0001';
  END IF;

  -- (4) THE REASON, required unconditionally (§15.4:1690's header, "all
  --     require reason"). Blank = nothing but whitespace INCLUDING tabs and
  --     newlines (R745 — plain btrim strips SPACES only); bounded at 500, the
  --     league_chat bound and the commissioner_actions CHECK (123:295-296).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION
      '%: a reason is required — this verb writes an audited commissioner_actions row the whole league can read (§15.4, §10.3)', p_verb
      USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      '%: the reason is % characters — at most 500 (the league_chat bound; §12.13)', p_verb, char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) LEAGUE / TEAMS / CALENDAR. Rosters do not exist before draft
  --     completion, which is what flips the status (066:823 / 086:448 /
  --     110:882), so the manager verb's season gate (115:449-453) binds here
  --     too — it is not a timing constraint on WHO may act, it is the absence
  --     of a subject.
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      '%: league % is % — rosters change only while in_season or in playoffs (§13.1)', p_verb, p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team_a FROM public.teams t
  WHERE t.id = CASE WHEN v_is_move THEN p_from_team_id ELSE p_team_id END;
  IF NOT FOUND OR v_team_a.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION '%: team % is not a franchise of league %', p_verb,
      CASE WHEN v_is_move THEN p_from_team_id ELSE p_team_id END, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_is_move THEN
    SELECT t.* INTO v_team_b FROM public.teams t WHERE t.id = p_to_team_id;
    IF NOT FOUND OR v_team_b.league_id IS DISTINCT FROM p_league_id THEN
      RAISE EXCEPTION '%: team % is not a franchise of league %', p_verb, p_to_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- A `retired` franchise is SEALED (spec:183 — "name/record frozen";
  -- §7.2.1). Under standing rule (i) this is a LEGALITY gate, not a timing
  -- one: a sealed franchise is not a place a roster move can land. F352.
  --
  -- R1020 — THE MESSAGE NAMES A DOOR THAT EXISTS, OR IT SAYS THAT NONE DOES.
  -- The first cut said *"Un-retire the franchise first"*. Measured by
  -- exhausting every `UPDATE … teams` in migrations 001-127 (eleven of them,
  -- `grep -n 'UPDATE public\.teams'`): the column's CHECK is
  -- `('active','orphaned','retired')`; **three sites write `'active'` and all
  -- three are guarded by the same `CASE WHEN status = 'orphaned' THEN 'active'
  -- ELSE status END`** — `seat_league_member_internal` (`062:282-285`, newest
  -- body `077:442-445`) and `remove_manager`'s successor arm (`063:903-906`,
  -- newest body `120:454-457`). **NOT ONE SITE READS `'retired'` AND WRITES
  -- ANYTHING ELSE.** So an ORPHANED franchise can be re-activated by a new
  -- owner claiming the seat, and a RETIRED one cannot be un-retired by any
  -- verb that exists — the remedy the first message named was a route to
  -- nowhere, which is the F351 posture ("route it, don't leave it") failing in
  -- its worst direction. The message now says the capability is missing rather
  -- than implying it exists, and offers the route that DOES exist. **F354**
  -- owns the gap; building the verb is not this task's scope.
  IF v_team_a.status = 'retired'
     OR (v_is_move AND v_team_b.status = 'retired') THEN
    RAISE EXCEPTION
      '%: a retired franchise is sealed — its roster and record are frozen (§7.2.1, spec:183). This is a legality gate and it binds the commissioner too (PROGRESS standing rule (i), F352). The franchise would have to be un-retired first, and NO VERB DOES THAT TODAY — every site that writes teams.status = active is guarded "WHEN status = orphaned", so nothing un-retires a franchise (F354). Until one exists, move these players to another franchise instead', p_verb
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      '%: league % has no league_weeks rows — no season calendar to place the move on (§12.17)', p_verb, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = v_current;
  IF NOT FOUND THEN
    -- LOUD, never a silent skip (§4 rule 15). `lineup_current_week_internal`
    -- derives the week FROM `league_weeks`, so its absence one statement later
    -- means the calendar changed under us — and a NULL status would make the
    -- whole scoring arm below fall through both its IFs and report nothing.
    RAISE EXCEPTION
      '%: league % has no league_weeks row for season % week % — the calendar moved under this transaction (§12.17)', p_verb, p_league_id, v_league.season, v_current
      USING ERRCODE = 'P0001';
  END IF;
  v_week_status := v_lw.status;

  -- Settings read exactly as 115:472-485 reads them.
  v_waiver_type  := COALESCE(v_league.waiver_type, 'faab');
  v_period_hours := COALESCE((v_league.settings ->> 'waiver_period_hours')::int, 48);
  v_hold_hours   := COALESCE((v_league.settings ->> 'fa_hold_hours')::int, 0);
  v_cap_week_txt   := COALESCE(v_league.settings ->> 'acquisitions_per_week', 'unlimited');
  v_cap_season_txt := COALESCE(v_league.settings ->> 'acquisitions_per_season', 'unlimited');
  v_cap_week   := CASE WHEN v_cap_week_txt   = 'unlimited' THEN NULL ELSE v_cap_week_txt::int   END;
  v_cap_season := CASE WHEN v_cap_season_txt = 'unlimited' THEN NULL ELSE v_cap_season_txt::int END;
  SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') s), 0)
       + COALESCE((v_league.roster_settings ->> 'bench')::int, 0)
       + COALESCE(jsonb_array_length(v_league.roster_settings -> 'ir_slots'), 0)
  INTO v_roster_size;
  -- R1018: the league's BARE `ir_slots` keys, in the scoring worker's own
  -- shape (`irKeysOf`, `score-week-worker.ts:397-407`). Passed to the lineup
  -- sync so an IR spot can never be mistaken for a vacated starting slot.
  SELECT COALESCE(array_agg(s ->> 'key'), ARRAY[]::text[])
  INTO v_ir_keys
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) s
  WHERE COALESCE(s ->> 'key', '') <> '';

  -- The acquisition counts, hoisted here and assigned for EVERY call (R763 —
  -- 115:489-506 had to hoist them for exactly this reason: a branch that left
  -- them unassigned reported NULL to a capped league). They are read twice
  -- below — to decide whether a cap WOULD have refused (so `bypassed[]` names
  -- a real refusal and not a hypothetical one) and to report the league's own
  -- numbers back unchanged.
  --
  -- **THEY ARE COUNTED FOR THE TEAM THAT ACQUIRES, AND THE RECEIPT SAYS WHICH
  -- TEAM THAT IS (R1022).** An acquisition cap throttles the team a player
  -- ARRIVES on; the first cut counted `v_team_a`, which on a MOVE is the team
  -- the player LEAVES — so `caps.used_week_before` reported the wrong
  -- franchise's budget in a field the league is invited to read. On a move
  -- that is `v_team_b`; on an add/drop it is the one team named. `caps.team_id`
  -- is on the receipt so the number can never again be read against the wrong
  -- roster.
  v_cap_team := CASE WHEN v_is_move THEN v_team_b.id ELSE v_team_a.id END;
  SELECT count(*)::int INTO v_used_week
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = v_cap_team
    AND t.status = 'complete' AND t.week = v_current
    AND (t.payload ->> 'add_player_id') IS NOT NULL;
  SELECT count(*)::int INTO v_used_season
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = v_cap_team
    AND t.status = 'complete'
    AND (t.payload ->> 'add_player_id') IS NOT NULL;

  -- (6) THE PLAN, NORMALIZED. Both verbs reduce to "this team loses a player"
  --     and/or "that team gains one"; the writes below are then uniform.
  IF v_is_move THEN
    SELECT p.* INTO v_lose_p FROM public.players p WHERE p.id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%: no player with id %', p_verb, p_player_id USING ERRCODE = 'P0001';
    END IF;
    v_gain_p := v_lose_p;
    SELECT r.* INTO v_lose_row FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.player_id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        '%: % (%) is on no roster in league % — a move needs a source roster; to bring a free agent in, use commish_force_add_drop (§15.4:1695)',
        p_verb, v_lose_p.full_name, p_player_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_lose_row.team_id = p_to_team_id THEN
      -- THE NO-OP (see the banner): the requested END STATE already holds.
      v_lose_team := NULL; v_gain_team := NULL;
      v_lose_player := NULL; v_gain_player := NULL;
    ELSIF v_lose_row.team_id <> p_from_team_id THEN
      SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_lose_row.team_id;
      RAISE EXCEPTION
        '%: % (%) is on %''s roster, not %''s — neither the source nor the destination you named. Re-read the roster and send the move again with the right `from`',
        p_verb, v_lose_p.full_name, p_player_id, v_owner_team.name, v_team_a.name
        USING ERRCODE = 'P0001';
    ELSE
      v_lose_team   := p_from_team_id;
      v_gain_team   := p_to_team_id;
      v_lose_player := p_player_id;
      v_gain_player := p_player_id;
    END IF;
  ELSE
    -- ── force add / drop ────────────────────────────────────────────────────
    IF p_drop IS NOT NULL THEN
      SELECT p.* INTO v_lose_p FROM public.players p WHERE p.id = p_drop;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%: no player with id % (drop)', p_verb, p_drop USING ERRCODE = 'P0001';
      END IF;
      SELECT r.* INTO v_lose_row FROM public.league_rosters r
      WHERE r.league_id = p_league_id AND r.player_id = p_drop;
      IF FOUND THEN
        IF v_lose_row.team_id <> p_team_id THEN
          SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_lose_row.team_id;
          RAISE EXCEPTION
            '%: % (%) is on %''s roster, not %''s — name the roster he is actually on, or move him with commish_move_player (§15.4:1694)',
            p_verb, v_lose_p.full_name, p_drop, v_owner_team.name, v_team_a.name
            USING ERRCODE = 'P0001';
        END IF;
        v_lose_team   := p_team_id;
        v_lose_player := p_drop;
      END IF;
      -- NOT FOUND ⇒ he is already on no roster in this league: the drop side's
      -- requested end state already holds (the banner's no-op rule).
    END IF;
    IF p_add IS NOT NULL THEN
      SELECT p.* INTO v_gain_p FROM public.players p WHERE p.id = p_add;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%: no player with id % (add)', p_verb, p_add USING ERRCODE = 'P0001';
      END IF;
      -- EXCLUSIVITY (072:147's UNIQUE, CLAUDE.md business rule 7, §12.7) —
      -- A LEGALITY GATE, AND IT BINDS THE COMMISSIONER (standing rule (i)).
      -- Refused BY NAME and never silently converted into a move: the verb the
      -- commissioner wanted is the one the message names.
      SELECT t.* INTO v_owner_team
      FROM public.league_rosters r JOIN public.teams t ON t.id = r.team_id
      WHERE r.league_id = p_league_id AND r.player_id = p_add;
      IF FOUND AND v_owner_team.id <> p_team_id THEN
        RAISE EXCEPTION
          '%: % (%) is already on %''s roster in this league — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7), and that binds a commissioner too: it is the shape of the game, not its timing (PROGRESS standing rule (i)). To take him off % and put him on %, use commish_move_player (§15.4:1694)',
          p_verb, v_gain_p.full_name, p_add, v_owner_team.name, v_owner_team.name, v_team_a.name
          USING ERRCODE = 'P0001';
      END IF;
      IF NOT FOUND THEN
        v_gain_team   := p_team_id;
        v_gain_player := p_add;
      END IF;
      -- FOUND and already on THIS team ⇒ the add side's end state holds.
    END IF;
  END IF;

  -- (7) THE NO-OP, DETECTED BY VALUE across every dimension this verb can
  --     change — which roster row exists and which team it names (D336 part 3,
  --     §4 rule 15). Never inferred from an empty write.
  v_no_changes := (v_lose_player IS NULL AND v_gain_player IS NULL);

  v_affected := CASE
    WHEN v_is_move THEN jsonb_build_array(p_from_team_id, p_to_team_id)
    ELSE jsonb_build_array(p_team_id) END;                       -- D353
  -- R1019 — THE AUDIT ROW DESCRIBES THE PLAN THAT EXECUTED, NEVER THE
  -- PARAMETERS THAT WERE SENT. The first cut keyed both on `p_add IS NOT
  -- NULL`, so a call whose ADD arm was a no-op (he is already on this roster)
  -- and whose DROP arm executed was stamped `action_type = 'force_add'` with
  -- `added_player_id` NULL — and tasks-M6A §5 calls this shape contractual
  -- *"so the activity feed can render them without a special case"*, which
  -- means the feed would render a pure drop as an add. Keyed on the NORMALIZED
  -- plan (`v_gain_player` / `v_lose_player`) the stamp is what happened.
  --
  -- The one place the PARAMETERS are still the honest answer is a total no-op:
  -- nothing executed, no audit row is written at all, and the returned
  -- document's job there is to say what was ASKED and that it changed nothing
  -- (`no_changes` + `no_changes_why` carry the rest).
  v_action_type := CASE
    WHEN v_is_move                 THEN 'move_player'
    WHEN v_no_changes              THEN CASE WHEN p_add IS NOT NULL THEN 'force_add' ELSE 'force_drop' END
    WHEN v_gain_player IS NOT NULL THEN 'force_add'
    ELSE 'force_drop' END;
  v_arm := CASE
    WHEN v_is_move    THEN 'move'
    WHEN v_no_changes THEN CASE
                             WHEN p_add IS NOT NULL AND p_drop IS NOT NULL THEN 'add+drop'
                             WHEN p_add IS NOT NULL THEN 'add'
                             ELSE 'drop' END
    WHEN v_gain_player IS NOT NULL AND v_lose_player IS NOT NULL THEN 'add+drop'
    WHEN v_gain_player IS NOT NULL THEN 'add'
    ELSE 'drop' END;

  IF NOT v_no_changes THEN
    -- (8) WHAT THIS OVERRIDE WALKS PAST, made legible (D336 part 7). Standing
    --     rule (g): the timing rules do not bind a commissioner. None of these
    --     is a refusal here — each is a receipt line, and each one is
    --     EVALUATED (not assumed) so the receipt is true as measured.
    IF v_lose_player IS NOT NULL THEN
      v_lose_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_lose_p.team, p_at);
      IF (v_lose_lock ->> 'locked')::boolean THEN
        v_bypassed := v_bypassed || to_jsonb(('e32_drop_lock:' || v_lose_player)::text);
      END IF;
    END IF;
    IF v_gain_player IS NOT NULL AND NOT v_is_move THEN
      v_gain_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_gain_p.team, p_at);
      IF (v_gain_lock ->> 'locked')::boolean THEN
        v_bypassed := v_bypassed || to_jsonb(('e32_add_lock:' || v_gain_player)::text);
      END IF;
      -- The waiver period (115:576-582) — a `when`, not a `what`.
      SELECT pp.* INTO v_pool FROM public.league_player_pool pp
      WHERE pp.league_id = p_league_id AND pp.player_id = v_gain_player;
      IF NOT FOUND THEN
        v_pool_from := 'free_agent';
      ELSE
        v_pool_from := v_pool.state;
        IF v_pool.state = 'on_waivers' AND v_pool.waivers_until > p_at THEN
          v_bypassed := v_bypassed || to_jsonb(('waiver_period:' || v_gain_player)::text);
        END IF;
        IF v_pool.state = 'rostered' THEN
          -- D294's BROKEN-MIRROR REFUSAL (115:589-595), carried verbatim: no
          -- roster row (checked above) but a `rostered` pool row means the
          -- mirror is broken. Asserted, not trusted — and it binds the
          -- commissioner because it is an integrity claim about the data, not
          -- a rule about who may act.
          RAISE EXCEPTION
            '%: league_player_pool says % (%) is rostered in league % but league_rosters has no row — the pool mirror is broken; refusing until reconciliation (L.D2.3) repairs it (D294)',
            p_verb, v_gain_p.full_name, v_gain_player, p_league_id
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
      -- The acquisition caps (115:621-632) — a league throttle. The counts
      -- were taken above (R763); only an ADD could ever have been refused by
      -- them, so only this branch reads them.
      IF v_cap_week IS NOT NULL AND v_used_week >= v_cap_week THEN
        v_bypassed := v_bypassed || to_jsonb('acquisitions_per_week'::text);
      END IF;
      IF v_cap_season IS NOT NULL AND v_used_season >= v_cap_season THEN
        v_bypassed := v_bypassed || to_jsonb('acquisitions_per_season'::text);
      END IF;
    ELSIF v_is_move AND v_gain_player IS NOT NULL THEN
      v_pool_from := 'rostered';
    END IF;

    -- (9) CAPACITY (§7.3.2 roster_size) — A LEGALITY GATE, and it binds the
    --     commissioner. The refusal names the remedy.
    SELECT count(*)::int INTO v_count_a
    FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_a.id;
    v_exp_a := v_count_a
             - CASE WHEN v_lose_team = v_team_a.id THEN 1 ELSE 0 END
             + CASE WHEN v_gain_team = v_team_a.id THEN 1 ELSE 0 END;
    IF v_is_move THEN
      SELECT count(*)::int INTO v_count_b
      FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_b.id;
      v_exp_b := v_count_b
               - CASE WHEN v_lose_team = v_team_b.id THEN 1 ELSE 0 END
               + CASE WHEN v_gain_team = v_team_b.id THEN 1 ELSE 0 END;
      IF v_exp_b > v_roster_size THEN
        RAISE EXCEPTION
          '%: %''s roster is full (% of % — §7.3.2 roster_size) — free a spot with commish_force_add_drop first. A roster over its own league''s size is a shape the rules do not have, so this gate binds the commissioner too (PROGRESS standing rule (i))',
          p_verb, v_team_b.name, v_count_b, v_roster_size
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_exp_a > v_roster_size THEN
      RAISE EXCEPTION
        '%: %''s roster is full (% of % — §7.3.2 roster_size) — include a drop in the same move (§13.1). A roster over its own league''s size is a shape the rules do not have, so this gate binds the commissioner too (PROGRESS standing rule (i))',
        p_verb, v_team_a.name, v_count_a, v_roster_size
        USING ERRCODE = 'P0001';
    END IF;

    -- (10) THE BEFORE DOCUMENT, read before the writes (D353: `before`/`after`
    --      mirror each other key-for-key over THE ROW THAT CHANGED).
    --      `target_id` is the added or moved player when there is one, else
    --      the dropped one, and these two documents describe THAT player's
    --      `league_rosters` row. A combined add+drop's drop side is fully
    --      described in `metadata` (`drop_player_id`, `drop_before`,
    --      `drop_to_state`) rather than crammed into a shape that has room for
    --      one row — the audit row's headline is the row that arrived.
    v_before_drop := CASE WHEN v_lose_player IS NULL THEN NULL ELSE jsonb_build_object(
      'team_id',          v_lose_row.team_id,
      'slot_key',         v_lose_row.slot_key,
      'acquisition_type', v_lose_row.acquisition_type) END;
    v_before := CASE
      WHEN v_is_move                 THEN v_before_drop
      WHEN v_gain_player IS NOT NULL THEN jsonb_build_object('team_id', NULL, 'slot_key', NULL, 'acquisition_type', NULL)
      ELSE v_before_drop END;

    -- (11) THE WRITES.
    IF v_is_move THEN
      -- A MOVE is an UPDATE of the ONE roster row, so exclusivity is preserved
      -- BY CONSTRUCTION — there is never a second row to collide with
      -- (072:147). The IR stint is a property of the franchise the player is
      -- leaving, so it is cleared with him; acquisition_cost is 0 because a
      -- commissioner move is not a purchase (FAAB is M5's, F340).
      UPDATE public.league_rosters r
      SET team_id            = p_to_team_id,
          slot_key           = 'bn',
          acquisition_type   = 'commissioner',
          acquisition_cost   = 0,
          ir_placed_week     = NULL,
          ir_lock_until_week = NULL,
          acquired_at        = p_at
      WHERE r.league_id = p_league_id AND r.player_id = p_player_id;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION '%: the move updated % roster rows for %, expected exactly 1', p_verb, v_cnt, p_player_id
          USING ERRCODE = 'P0001';
      END IF;
      -- The pool mirror stays `rostered` (he never left a roster); the stamp
      -- moves so the mirror's own freshness is not silently stale.
      INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
      VALUES (p_league_id, p_player_id, 'rostered', NULL, p_at)
      ON CONFLICT (league_id, player_id) DO UPDATE
        SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
    ELSE
      IF v_lose_player IS NOT NULL THEN
        -- fa_hold_hours (§7.3.4), 115:540-552 verbatim: an early drop of a
        -- free-agent add returns him to FA, not waivers. held >= hold ⇒
        -- waivers (the boundary is inclusive).
        v_hold_early := v_lose_row.acquisition_type = 'free_agent'
                        AND v_hold_hours > 0
                        AND v_lose_row.acquired_at IS NOT NULL
                        AND p_at < v_lose_row.acquired_at + make_interval(hours => v_hold_hours);
        IF v_hold_early OR v_waiver_type = 'none_fcfs' THEN
          v_drop_to_state := 'free_agent';
          v_drop_until := NULL;
        ELSE
          v_drop_to_state := 'on_waivers';
          v_drop_until := p_at + make_interval(hours => v_period_hours);
        END IF;
        DELETE FROM public.league_rosters r
        WHERE r.league_id = p_league_id AND r.team_id = v_lose_team AND r.player_id = v_lose_player;
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt <> 1 THEN
          RAISE EXCEPTION '%: the drop of % deleted % roster rows, expected 1', p_verb, v_lose_player, v_cnt
            USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
        VALUES (p_league_id, v_lose_player, v_drop_to_state, v_drop_until, p_at)
        ON CONFLICT (league_id, player_id) DO UPDATE
          SET state = EXCLUDED.state, waivers_until = EXCLUDED.waivers_until, updated_at = EXCLUDED.updated_at;
      END IF;
      IF v_gain_player IS NOT NULL THEN
        BEGIN
          INSERT INTO public.league_rosters
            (league_id, team_id, player_id, slot_key, acquisition_type, acquisition_cost, acquired_at)
          VALUES (p_league_id, v_gain_team, v_gain_player, 'bn', 'commissioner', 0, p_at);
        EXCEPTION WHEN unique_violation THEN
          -- 072's UNIQUE, kept as an UNPINNABLE backstop (R757/D276, 115's
          -- posture): the league row lock in (1) serializes every racer behind
          -- the exclusivity pre-check, so this branch is unreachable in
          -- practice — it exists so a raw 23505 can never reach the wire if
          -- that lock is ever weakened.
          RAISE EXCEPTION
            '%: % (%) was rostered by another team in this league a moment ago — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7)',
            p_verb, v_gain_p.full_name, v_gain_player
            USING ERRCODE = 'P0001';
        END;
        INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
        VALUES (p_league_id, v_gain_player, 'rostered', NULL, p_at)
        ON CONFLICT (league_id, player_id) DO UPDATE
          SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
      END IF;
    END IF;

    -- (12) THE LINEUP CONSEQUENCE, and the eviction that carries the score
    --      signal with it (D346). Every week from the current one on, for both
    --      sides of a move.
    v_sync := public.commish_roster_lineup_sync_internal(
      p_league_id, v_team_a.id, v_league.season, v_current, v_current,
      CASE WHEN v_lose_team = v_team_a.id THEN v_lose_player END,
      CASE WHEN v_gain_team = v_team_a.id THEN v_gain_player END,
      v_ir_keys);
    v_lineups := v_lineups || jsonb_build_object('team_id', v_team_a.id, 'rows', v_sync -> 'rows');
    v_vacated := v_sync ->> 'vacated_current_slot';
    IF v_is_move THEN
      v_sync := public.commish_roster_lineup_sync_internal(
        p_league_id, v_team_b.id, v_league.season, v_current, v_current,
        CASE WHEN v_lose_team = v_team_b.id THEN v_lose_player END,
        CASE WHEN v_gain_team = v_team_b.id THEN v_gain_player END,
        v_ir_keys);
      v_lineups := v_lineups || jsonb_build_object('team_id', v_team_b.id, 'rows', v_sync -> 'rows');
      v_vacated := COALESCE(v_vacated, v_sync ->> 'vacated_current_slot');
    END IF;

    -- (13) POST-WRITE ASSERTIONS (R703-class; D294's mirror asserted —
    --      115:732-753's shape, extended to both sides of a move).
    IF v_gain_player IS NOT NULL THEN
      IF (SELECT count(*) FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = v_gain_player) <> 1
         OR NOT EXISTS (SELECT 1 FROM public.league_rosters r
                        WHERE r.league_id = p_league_id AND r.team_id = v_gain_team AND r.player_id = v_gain_player) THEN
        RAISE EXCEPTION '%: after the write, % is not exactly once on the destination roster in league % — refusing', p_verb, v_gain_player, p_league_id
          USING ERRCODE = 'P0001';
      END IF;
      IF (SELECT pp.state FROM public.league_player_pool pp
          WHERE pp.league_id = p_league_id AND pp.player_id = v_gain_player) IS DISTINCT FROM 'rostered' THEN
        RAISE EXCEPTION '%: the pool mirror for % is not rostered after the write (D294) — refusing', p_verb, v_gain_player
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_lose_player IS NOT NULL AND NOT v_is_move THEN
      IF EXISTS (SELECT 1 FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = v_lose_player) THEN
        RAISE EXCEPTION '%: after the drop, % is still rostered in league % — refusing', p_verb, v_lose_player, p_league_id
          USING ERRCODE = 'P0001';
      END IF;
      IF (SELECT pp.state FROM public.league_player_pool pp
          WHERE pp.league_id = p_league_id AND pp.player_id = v_lose_player) IS DISTINCT FROM v_drop_to_state THEN
        RAISE EXCEPTION '%: the pool mirror for % is not % after the drop (D294) — refusing', p_verb, v_lose_player, v_drop_to_state
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    SELECT count(*)::int INTO v_cnt
    FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_a.id;
    IF v_cnt <> v_exp_a OR v_cnt > v_roster_size THEN
      RAISE EXCEPTION '%: %''s roster holds % players after the move, expected % (roster_size %) — refusing',
        p_verb, v_team_a.name, v_cnt, v_exp_a, v_roster_size
        USING ERRCODE = 'P0001';
    END IF;
    IF v_is_move THEN
      SELECT count(*)::int INTO v_cnt
      FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_b.id;
      IF v_cnt <> v_exp_b OR v_cnt > v_roster_size THEN
        RAISE EXCEPTION '%: %''s roster holds % players after the move, expected % (roster_size %) — refusing',
          p_verb, v_team_b.name, v_cnt, v_exp_b, v_roster_size
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- (14) THE SCORE (D346). The starter set of the CURRENT week changed
    --      exactly when the losing side's player occupied a slot in it — which
    --      is MEASURED by the sync helper and returned, not assumed. An added
    --      player lands on the BENCH and so is never in the symmetric
    --      difference; the assertion that keeps that true is (12)'s own
    --      post-write check. Read SCORING in the banner before touching the
    --      stamp.
    IF v_vacated IS NOT NULL THEN
      v_rescore := ARRAY[v_lose_player];
    END IF;
    IF array_length(v_rescore, 1) > 0 AND v_week_status IN ('live', 'correction_window') THEN
      -- A CHANGED STARTER IS QUEUED ONLY IF THIS LEAGUE STILL ROSTERS HIM
      -- (F353). The worker maps a queued player to leagues through
      -- `league_rosters`, so a row for a player nobody rosters is consumed with
      -- `report.unmapped += 1` and deleted having done nothing — it is not a
      -- queue poison (measured: `toDelete.push(row)`), but it is a row that
      -- claims to chase a score it cannot reach, and `score_enqueued` would
      -- then mean less than it says. He is NAMED `unrostered` below instead.
      INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
      SELECT v_league.season, v_current, ps.player_id, min(ps.updated_at)
      FROM public.player_stats ps
      WHERE ps.season = v_league.season AND ps.week = v_current
        AND ps.player_id = ANY (v_rescore)
        AND ps.updated_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.league_rosters r
                    WHERE r.league_id = p_league_id AND r.player_id = ps.player_id)
      GROUP BY ps.player_id
      ON CONFLICT (season, week, player_id) DO NOTHING;   -- never re-stamp a healthy row

      -- (14b) THE REACH SET — AND THE REASON IT HAS TO EXIST IS A DIFFERENCE
      --       BETWEEN THIS VERB AND 123's, MEASURED RATHER THAN ASSUMED
      --       (F353). The worker maps a queued player to LEAGUES through the
      --       roster index — its own docblock, step 3: *"ready players →
      --       leagues through `idx_league_rosters_player` … The LEAGUE comes
      --       from the roster index"* — and the query behind it is
      --       `readRosterLeagues`, a read of `league_rosters` filtered to the
      --       season's `in_season|playoffs` leagues.
      --
      --       `commish_edit_lineup` never hits this, because the player it
      --       benches STAYS ON THE ROSTER: he maps to the league, the drain
      --       visits the league-week, and `edited_by_commish` then forces the
      --       team. **A force-DROP deletes the roster row**, so the very row
      --       this verb queues maps to NO league and the drain never arrives —
      --       the enqueue is consumed having reached nothing and the stored
      --       points keep the dropped player, for ever. That is 123's own
      --       failure one layer out, and D346 did not anticipate it because it
      --       was written from the lineup verb's case.
      --
      --       So the verb ALSO queues players the league STILL rosters, drawn
      --       from the affected teams' remaining rosters. They are not there to
      --       be re-scored for their own sake — the drain recomputes every
      --       starter of an affected team through `extraStats` anyway — they
      --       are there to make the drain VISIT this league-week at all. Each
      --       carries its OWN stamp and `ON CONFLICT DO NOTHING`, so a healthy
      --       existing row is never re-stamped and the set costs at most
      --       `roster_size` rows per touched team — plus the CROSS-LEAGUE
      --       fan-out named in the banner (R1023): the queue is keyed
      --       `(season, week, player_id)` with no league column, so these rows
      --       re-drain these players for every other in-season league that
      --       rosters them. Idempotent, and deliberately not narrowed here.
      SELECT COALESCE(array_agg(DISTINCT r.player_id), ARRAY[]::text[]) INTO v_reach
      FROM public.league_rosters r
      WHERE r.league_id = p_league_id
        AND r.team_id IN (v_team_a.id, COALESCE(v_team_b.id, v_team_a.id))
        AND NOT (r.player_id = ANY (v_rescore));
      IF array_length(v_reach, 1) > 0 THEN
        INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
        SELECT v_league.season, v_current, ps.player_id, min(ps.updated_at)
        FROM public.player_stats ps
        WHERE ps.season = v_league.season AND ps.week = v_current
          AND ps.player_id = ANY (v_reach)
          AND ps.updated_at IS NOT NULL
        GROUP BY ps.player_id
        ON CONFLICT (season, week, player_id) DO NOTHING;
        SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x), '[]'::jsonb) INTO v_reach_enq
        FROM unnest(v_reach) x
        WHERE EXISTS (SELECT 1 FROM public.score_fanout f
                      WHERE f.season = v_league.season AND f.week = v_current AND f.player_id = x);
      END IF;
      -- WHAT THIS FIELD MEANS (123:1088-1092): "a claimable queue row EXISTS
      -- for him", not "this statement inserted one". An untouched healthy row
      -- left by ON CONFLICT drains just as well — but a player the INSERT
      -- could not queue is NEVER folded into silence.
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x), '[]'::jsonb) INTO v_enqueued
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.score_fanout f
                    WHERE f.season = v_league.season AND f.week = v_current AND f.player_id = x);
      -- R968 — `player_stats.updated_at` is NULLABLE, so a partial ingestion
      -- can leave a scoreable line the enqueue cannot stamp. Named, never
      -- dropped silently.
      SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_unstamped
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.player_stats ps
                    WHERE ps.season = v_league.season AND ps.week = v_current AND ps.player_id = x)
        AND NOT EXISTS (SELECT 1 FROM public.player_stats ps
                        WHERE ps.season = v_league.season AND ps.week = v_current AND ps.player_id = x
                          AND ps.updated_at IS NOT NULL);
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'player_id', x,
               'why', CASE
                 WHEN NOT EXISTS (SELECT 1 FROM public.league_rosters r
                                  WHERE r.league_id = p_league_id AND r.player_id = x)
                   THEN 'unrostered'
                 WHEN x = ANY (v_unstamped) THEN 'stats_unstamped'
                 ELSE 'no_stat_row' END) ORDER BY x), '[]'::jsonb)
      INTO v_not_enq
      FROM unnest(v_rescore) x
      WHERE NOT EXISTS (SELECT 1 FROM public.score_fanout f
                        WHERE f.season = v_league.season AND f.week = v_current AND f.player_id = x);
      -- (14c) REACHABILITY, MEASURED AFTER THE WRITES AND NEVER INFERRED: is
      --       there a queued player for this season-week that THIS league
      --       still rosters? That is the exact predicate the worker's map
      --       evaluates, asked of the state this transaction is about to
      --       commit. If the answer is no, the lineup moved and the score
      --       CANNOT follow — the one thing this verb must never report as
      --       success (F353).
      SELECT EXISTS (
        SELECT 1 FROM public.score_fanout f
        JOIN public.league_rosters r
          ON r.player_id = f.player_id AND r.league_id = p_league_id
        WHERE f.season = v_league.season AND f.week = v_current)
      INTO v_reachable;

      -- An `unrostered` changed starter is NOT stale, and the reason is the
      -- mechanism rather than an opinion: the drop's score does not follow
      -- from HIS queue row at all — it follows from the team being recomputed
      -- (reachable + `edited_by_commish`) against the CURRENT lineup, which no
      -- longer contains him. What WOULD be stale is a league-week the drain
      -- cannot reach, and that is the arm below.
      IF NOT v_reachable THEN
        v_score_stale := TRUE;
        v_stale_why   := 'unreachable';
      ELSIF array_length(v_unstamped, 1) > 0 THEN
        v_score_stale := TRUE;
        v_stale_why   := 'stats_unstamped';
      END IF;
    ELSIF array_length(v_rescore, 1) > 0 AND v_week_status = 'final' THEN
      -- The write door raises `week_final` (119:566-568) and the worker
      -- consumes the queue row with no cell changed — an enqueue here would
      -- delete itself having done nothing. Say so instead.
      v_score_stale := TRUE;
      v_stale_why   := 'week_final';
    END IF;
    -- `upcoming`: nothing has been scored yet, so there is nothing stale. A
    -- move that vacated no CURRENT-week slot changes no starter set at all, so
    -- there is no score to chase and a `score_stale` there would be a false
    -- alarm in the one field whose whole job is to be believed (R969).

    -- (15) THE RECEIPT (§10.3, §15.4:1690). Exactly one audit row, in THIS
    --      transaction, INSIDE the no-op guard and AFTER the state write —
    --      D336 part (2) in its plain order, because nothing here forces
    --      126's inversion: no trigger guards these tables and the only FK to
    --      `commissioner_actions` is the `transactions` row written BELOW.
    v_after := CASE
      WHEN v_gain_player IS NOT NULL THEN jsonb_build_object(
        'team_id', v_gain_team, 'slot_key', 'bn', 'acquisition_type', 'commissioner')
      ELSE jsonb_build_object('team_id', NULL, 'slot_key', NULL, 'acquisition_type', NULL) END;
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), v_action_type, 'player',
      COALESCE(v_gain_player, v_lose_player), v_reason,
      v_before, v_after,
      jsonb_build_object(
        'verb',                p_verb,
        'arm',                 v_arm,
        'season',              v_league.season,
        'current_week',        v_current,
        'week_status',         v_week_status,
        'action_id',           p_action_id,
        'affected_team_ids',   v_affected,                 -- D353
        'from_team_id',        v_lose_team,
        'to_team_id',          v_gain_team,
        'from_team_name',      CASE WHEN v_lose_team = v_team_a.id THEN v_team_a.name
                                    WHEN v_is_move AND v_lose_team = v_team_b.id THEN v_team_b.name END,
        'to_team_name',        CASE WHEN v_gain_team = v_team_a.id THEN v_team_a.name
                                    WHEN v_is_move AND v_gain_team = v_team_b.id THEN v_team_b.name END,
        'add_player_id',       v_gain_player,
        'drop_player_id',      v_lose_player,
        'drop_before',         v_before_drop,
        'drop_to_state',       v_drop_to_state,
        'player_name',         COALESCE(v_gain_p.full_name, v_lose_p.full_name),
        'transaction_id',      v_txn_id,
        -- The whole point of the verb, made legible: every rule this override
        -- walked past, with the lock documents that prove each claim.
        'bypassed',            v_bypassed,
        'drop_game_lock',      v_lose_lock,
        'add_game_lock',       v_gain_lock,
        'lineups',             v_lineups,
        'score_enqueued',      v_enqueued,
        'score_not_enqueued',  v_not_enq,
        'score_reach_enqueued', v_reach_enq,
        'score_reachable',     v_reachable,
        'score_stale',         v_score_stale,
        'score_stale_reason',  v_stale_why),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION '%: the audit row was not written — refusing to let the roster move stand without its receipt (§10.3)', p_verb
        USING ERRCODE = 'P0001';
    END IF;

    -- (16) §10.3: override system messages auto-post to league chat and CANNOT
    --      be disabled. D97/D290's in-txn post, worded as the roster override.
    v_message := CASE WHEN v_is_move
      THEN v_lose_p.full_name || ' moved from ' || v_team_a.name || ' to ' || v_team_b.name
      ELSE v_team_a.name || ': '
           || CASE WHEN v_gain_player IS NOT NULL THEN 'added ' || v_gain_p.full_name ELSE '' END
           || CASE WHEN v_gain_player IS NOT NULL AND v_lose_player IS NOT NULL THEN ', ' ELSE '' END
           || CASE WHEN v_lose_player IS NOT NULL THEN 'dropped ' || v_lose_p.full_name ELSE '' END
      END
      || ' by ' || public.draft_actor_name() || ' (commissioner override'
      || CASE WHEN jsonb_array_length(v_bypassed) > 0
              THEN ', ' || jsonb_array_length(v_bypassed) || ' rule'
                   || CASE WHEN jsonb_array_length(v_bypassed) = 1 THEN '' ELSE 's' END || ' bypassed'
              ELSE '' END
      || ')'
      || CASE WHEN v_vacated IS NOT NULL
              THEN ' — a week-' || v_current || ' starting slot was emptied'
              ELSE '' END
      || ' — reason: ' || v_reason;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   p_verb,
    'action_type',            v_action_type,
    'arm',                    v_arm,
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'week',                   v_current,
    'week_status',            v_week_status,
    'team_id',                CASE WHEN v_is_move THEN p_to_team_id ELSE p_team_id END,
    'from_team_id',           CASE WHEN v_is_move THEN p_from_team_id ELSE NULL END,
    'to_team_id',             CASE WHEN v_is_move THEN p_to_team_id ELSE NULL END,
    'player_id',              p_player_id,
    'add_player_id',          CASE WHEN v_is_move THEN NULL ELSE p_add END,
    'drop_player_id',         CASE WHEN v_is_move THEN NULL ELSE p_drop END,
    'moved_player_id',        CASE WHEN v_is_move THEN v_gain_player ELSE NULL END,
    'added_player_id',        CASE WHEN v_is_move THEN NULL ELSE v_gain_player END,
    'dropped_player_id',      CASE WHEN v_is_move THEN NULL ELSE v_lose_player END,
    'drop_to_state',          v_drop_to_state,
    'drop_waivers_until',     v_drop_until,
    'pool_from_state',        v_pool_from,
    'acquisition_type',       CASE WHEN v_gain_player IS NULL THEN NULL ELSE 'commissioner' END,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                CASE WHEN v_is_move
                                  THEN 'already_on_destination — the requested end state already held, so nothing was written and no receipt was issued (PROGRESS standing rule (b))'
                                  ELSE 'end_state_already_held — the add is already on this roster and/or the drop is already on none, so nothing was written and no receipt was issued (PROGRESS standing rule (b))'
                                END END,
    'commissioner_action_id', v_audit_id,      -- NULL on a no-op, and that is the point
    'transaction_id',         CASE WHEN v_no_changes THEN NULL ELSE v_txn_id END,
    'affected_team_ids',      v_affected,      -- D353
    'bypassed',               v_bypassed,
    'drop_game_lock',         v_lose_lock,
    'add_game_lock',          v_gain_lock,
    'lineups',                v_lineups,
    'vacated_current_slot',   v_vacated,
    'roster', jsonb_build_object(
      'roster_size',   v_roster_size,
      'count_after_a', CASE WHEN v_no_changes THEN NULL ELSE v_exp_a END,
      'count_after_b', CASE WHEN v_no_changes OR NOT v_is_move THEN NULL ELSE v_exp_b END),
    'caps', jsonb_build_object(
      'acquisitions_per_week',   v_cap_week_txt,
      'acquisitions_per_season', v_cap_season_txt,
      -- STATED, NOT DISCOVERED (§4 rule 15): 115:497-506 counts a team's
      -- acquisitions by `initiator_team_id`, and D353's shape writes that
      -- column NULL — so a commissioner force-add neither obeys the cap nor
      -- consumes it. Said here so a league reading its own budget is not
      -- surprised by a number that did not move.
      'commissioner_move_not_counted', TRUE,
      -- R1022: WHOSE counts these are, said in the document. A cap throttles
      -- the ACQUIRING team, which on a move is the destination — not v_team_a.
      'team_id',            v_cap_team,
      'used_week_before',   v_used_week,
      'used_season_before', v_used_season),
    'score_enqueued',         v_enqueued,
    'score_not_enqueued',     v_not_enq,
    -- F353: the players queued ONLY so the drain REACHES this league-week,
    -- because the worker maps a queued player to leagues through
    -- `league_rosters` and a DROPPED player maps to none. `score_reachable` is
    -- the measured answer to that question, not an inference from the above.
    'score_reach_enqueued',   v_reach_enq,
    'score_reachable',        v_reachable,
    'score_stale',            v_score_stale,
    'score_stale_reason',     v_stale_why,
    'edited_by_commish',      NOT v_no_changes,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at);

  IF NOT v_no_changes THEN
    -- (17) THE TRANSACTIONS ROW — §12.9's unified in-season activity log, and
    --      the FIRST writer of `related_action_id` (109:239-250; the FK landed
    --      at 123:461-462). `initiator_team_id` is NULL because no TEAM
    --      initiated this, which is the column's documented meaning and is
    --      also what keeps the move out of the team's acquisition count.
    --      Written after the receipt because it REFERENCES it.
    INSERT INTO public.transactions
      (id, league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id, related_action_id)
    VALUES (v_txn_id, p_league_id, 'commissioner_move', 'complete', NULL, auth.uid(), v_result, v_current, p_action_id, v_audit_id);
  END IF;

  -- The idempotency ledger row is written for a NO-OP TOO (123:1259-1266's
  -- posture): an action_id is consumed by its submit whether or not anything
  -- moved, so a retry replays instead of re-evaluating. This is the OPPOSITE
  -- rule from the audit row above, and deliberately so — §12.26: "an action_id
  -- is an idempotency key, not an audit record".
  INSERT INTO public.commish_roster_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, CASE WHEN v_is_move THEN p_to_team_id ELSE p_team_id END, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_roster_override_internal(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The two client doors (§15.4:1694-1695). Transaction `now()`, never a
--    caller-supplied instant (D307(3)); SECURITY DEFINER; in-body auth is the
--    internal's step (2). Two verbs, ONE internal, ONE replay namespace.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_move_player(
  p_league_id    UUID,
  p_player_id    TEXT,
  p_from_team_id UUID,
  p_to_team_id   UUID,
  p_reason       TEXT DEFAULT NULL,  -- REQUIRED in-body (22023) — §15.4:1690, "all require reason"
  p_action_id    UUID DEFAULT NULL   -- REQUIRED in-body (22023); DEFAULT only to keep §15.4's argument order
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.commish_roster_override_internal(
    p_league_id, NULL, NULL, NULL, p_player_id, p_from_team_id, p_to_team_id,
    p_action_id, now(), p_reason, 'commish_move_player');
END;
$$;
-- The DEFINER wrapper is the client door: `authenticated` keeps EXECUTE, the
-- in-body commissioner gate is the authorization (112:1237's posture).
REVOKE EXECUTE ON FUNCTION commish_move_player(UUID, TEXT, UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION commish_force_add_drop(
  p_league_id UUID,
  p_team_id   UUID,
  p_add       TEXT DEFAULT NULL,   -- the player to force onto this roster
  p_drop      TEXT DEFAULT NULL,   -- the player to force off it
  p_reason    TEXT DEFAULT NULL,   -- REQUIRED in-body (22023)
  p_action_id UUID DEFAULT NULL    -- REQUIRED in-body (22023)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.commish_roster_override_internal(
    p_league_id, p_team_id, p_add, p_drop, NULL, NULL, NULL,
    p_action_id, now(), p_reason, 'commish_force_add_drop');
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_force_add_drop(UUID, UUID, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon;
