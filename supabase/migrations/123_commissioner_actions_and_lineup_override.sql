-- ============================================================================
-- The commissioner audit spine + `commish_edit_lineup` — migration 123
-- (task L.E1.1/L.E1.2 of M6A; spec §10.3 / §12.12 / §11.2 / §15.4:1695;
-- PROGRESS §3 STANDING RULE "THE COMMISSIONER CAN DO ANYTHING" clauses (b),
-- (e) and (g), ruled by Chris 2026-08-09 and restated twice 2026-09-09;
-- tasks-M4 §4 standing rules 1-11; D137; F40 discharged in part).
--
-- THE RULING (clause (g), verbatim): "an LM should be able to set the lineup
-- even after the games have started. it's the entire point of having LM
-- powers." And clause (b), the one condition, also verbatim: "no receipt if
-- nothing is done. only when something is done."
--
-- WHAT THIS MIGRATION DOES
--   1. `commissioner_actions` — §12.12's audit log. Append-only, immutable,
--      league-visible. Every future §15.4 override writes exactly one row
--      here, in the SAME transaction as its state change (§10.3 "Scope").
--   2. `commish_actions_immutable_internal` + an ENABLE ALWAYS trigger — the
--      backstop §12.12's own caveat asks for, because policy-absence does
--      NOT restrain the table owner (see IMMUTABILITY below).
--   3. `log_commissioner_action_internal` — §10.3's `logCommissionerAction()`
--      in SQL, and the setter of §12.12's `app.commish_action_id` GUC.
--   4. The three FKs 056/109 parked "M6 adds the FK with the table".
--   5. `commish_lineup_actions` — the new verb's own idempotency ledger, in
--      111/112's shape (see LEDGER below for why it is not shared).
--   6. `commish_edit_lineup` / `commish_edit_lineup_internal` — the
--      LOCK-EXEMPT, REASON-REQUIRED, AUDITED lineup verb (§15.4:1695).
--
-- WHAT THIS MIGRATION DOES NOT DO, DELIBERATELY
--   `set_lineup` and `set_lineup_internal` ARE NOT TOUCHED. Not re-authored,
--   not re-granted, not one byte. §7.3.4/§11.2 lock semantics are on
--   CLAUDE.md's never-weaken list and they still bind every manager AND every
--   commissioner calling the manager's verb. Clause (g) closes on exactly
--   this point: "The exemption is a property of the commissioner verb, never
--   a relaxation of the rule the manager verb enforces." 114's two lock arms
--   (114:449-462 arm (a), 114:464-476 arm (b)) remain the HEAD of that
--   function and pgTAP 071 §F pins both refusal strings still present in
--   `set_lineup_internal`'s prosrc and still red for a manager.
--
-- D137 PROVENANCE. `commish_edit_lineup_internal` is a NEW function DERIVED
-- from the CURRENT FILE TEXT of `set_lineup_internal`'s newest defining
-- migration — 114_retire_first_game_of_week.sql:153-755 — never from
-- `pg_get_functiondef` (CLAUDE.md migration discipline). 114 is merged and is
-- NOT edited. Every step of 114's body is carried verbatim except the ones
-- enumerated under THE DIFFERENCES; the `team_lineups` row this verb writes
-- is therefore BYTE-COMPATIBLE with the one `set_lineup` writes, which is
-- what `lineup_lock_tick` (116:686-733, which rewrites `starters[]` elements
-- in place and recomputes `locked_at`) and the scoring worker
-- (`score-week-worker.ts:922`, which reads `slot_map` and nothing else)
-- both depend on. The helpers are REUSED BY NAME AND UNCHANGED:
-- `lineup_fit_internal` (112:439-578), `lineup_kickoff_internal` (112:380),
-- `schedule_window_internal` (111:234), `lineup_current_week_internal`
-- (112:360), `lineup_designation_internal` (112:337).
--
-- THE DIFFERENCES from `set_lineup_internal`, exhaustively. The line this
-- verb draws is: **a TIMING refusal is lifted; a LEGALITY refusal is not.**
--   (A) THE LOCK IS LIFTED — the whole point. Three sites, not two:
--       (A1) 114:449-462 arm (a) — a stored starter whose game kicked off may
--            not leave his key. NOT COPIED.
--       (A2) 114:464-476 arm (b) — a kicked-off player may not enter or move
--            slots. NOT COPIED.
--       (A3) 114:490-493 — the `fixed` column of `lineup_fit_internal`'s
--            input. This is the matcher's OWN copy of the lock: a `fixed`
--            player is seeded at his `wanted` slot unconditionally
--            (112:498-505) and a fixed-owned slot is never traversed by the
--            BFS (112:518). Every player here is passed `'fixed', FALSE`,
--            which leaves `lineup_fit_internal` reusable BYTE-UNCHANGED and
--            still enforcing position eligibility.
--            SCOPE, MEASURED rather than assumed (the break probe in the PR
--            body reinstates 114's computation and watches pgTAP 071 §J red):
--            carrying `fixed` over would NOT break the common case, because
--            `wanted` comes from the SUBMITTED map — a straight swap of two
--            kicked-off players is seeded identically either way. It bites
--            when the matcher must RE-SEAT: a submitted placement that is
--            position-ineligible can only be rescued along an augmenting path,
--            and a locked player's slot is a wall to that path. So the
--            failure it prevents is narrower than "the verb silently does
--            nothing" — it is "an arrangement the commissioner is entitled to
--            is refused as E16-illegal". That is still a refusal of the
--            commissioner on lock grounds, which is exactly what clause (g)
--            removes, so FALSE is correct; the claim is just smaller than it
--            first looks and is stated at its true size here.
--       (A4) The two IR LOCK-TIMING gates (114's "lock for week % has
--            passed") and the two Restricted-IR STINT gates. NOT COPIED —
--            the stint because §11.2:727 names the override in so many words
--            ("Restricted stint still applies; commissioner can override"),
--            the timing because it is the IR analogue of (A1)/(A2). Every
--            gate skipped is NAMED in the audit row's `metadata.bypassed`.
--   (B) THE PAST-WEEK AND CLOSED-WEEK GATES ARE LIFTED (114:293-305). Both
--       refusal texts literally say the change goes "through the audited
--       commissioner override (§11.2, M6)" — this verb is that override, and
--       §11.2:730 states it as law: "Commissioner can edit any lineup,
--       including retroactively and past lock (audited)".
--   (C) AUTH IS COMMISSIONER-ONLY (`is_league_commish`, 052:96). A manager
--       uses `set_lineup`; being the team's own manager is not sufficient
--       here. One no-leak 42501.
--   (D) `p_reason` IS REQUIRED UNCONDITIONALLY (§15.4:1689's header, "all
--       require `reason`"), normalised with R745's explicit whitespace class
--       and bounded at 500.
--   (E) ONE `commissioner_actions` ROW is written INSIDE the no-op guard, and
--       `edited_by_commish` is the literal TRUE.
--   (F) THE SCORE IS MADE TO FOLLOW, OR THE VERB SAYS IT DID NOT. See
--       SCORING below — this is the CLAUDE.md "never let 'nothing happened'
--       mean 'it worked'" clause and it has no analogue in `set_lineup`,
--       which cannot create the situation.
--   (G) `set_at = p_at` (the seam), where 114:645 writes `now()`. Identical
--       in production — the wrapper passes `now()` — and it is the correct
--       reading of the time rule; `lineup_carry_internal` (116:546) already
--       writes `set_at = p_at`. Stated so the divergence is deliberate.
--
-- WHAT IS **NOT** LIFTED, and this is a deliberate, reviewable line:
--   E16's bipartite-fit refusal (114:497-507), the `allow_illegal_lineups`
--   gate (114:605-616), the IR DESIGNATION eligibility gate, and every
--   shape/ownership gate. §11.1:721 ("Illegal rosters are blocked on normal
--   actions ... but never block the commissioner") arguably lifts the first
--   two, and §11.2:725's annotation defers that to M6 as F224(c). It is NOT
--   taken here, for a measured reason: the season gate invariant 2
--   (`checkLineupLegality`, src/lib/leagues/sim/season-invariants.ts:303-337)
--   reds when ANY stored lineup has `unplaced` players or is REARRANGED by
--   `lineup_fit_internal` — for every week of the season, final weeks
--   included. Lifting E16 here would make a LAWFUL commissioner lineup red a
--   quality gate, and teaching that invariant provenance is real work that
--   belongs with the verb that needs it. Chris's ruling (g) is verbatim about
--   games having STARTED; it names the lock and nothing else. F324 files the
--   legality half.
--
-- IMMUTABILITY (§12.12), AND WHY THE POLICIES ARE NOT ENOUGH. §12.12 says
-- "Because there is no UPDATE or DELETE policy, even a commissioner cannot
-- alter or remove an entry — Postgres denies it." That is true for `anon`,
-- `authenticated` and `service_role`; it is FALSE for the table OWNER, and
-- the owner is the role every SECURITY DEFINER function in this schema runs
-- as. MEASURED on the local stack, in a rolled-back transaction: as
-- `postgres`, INSERT/UPDATE/DELETE all succeeded against a fresh table with
-- RLS ENABLED and ZERO policies, and no table in this repo sets FORCE ROW
-- LEVEL SECURITY (0 hits across supabase/migrations). So the audit log would
-- have been rewritable by exactly the code path that writes it. The
-- BEFORE UPDATE OR DELETE trigger below is what actually closes it, and it
-- is `ENABLE ALWAYS` per R616 (104:489-502): a trigger left at the default
-- `tgenabled = 'O'` is SKIPPED ENTIRELY under `session_replication_role =
-- 'replica'`, which is the mode `pg_restore`, logical apply and
-- `supabase db push` run in — i.e. the default would leave the log mutable
-- through the very tool CLAUDE.md mandates for reaching production.
--
-- IT TAKES THREE PIECES, NOT ONE, AND THE FIRST CUT SHIPPED ONE (R966/R967):
--   (i)   the row trigger above — UPDATE and DELETE, refused;
--   (ii)  ONE exemption inside it, because `league_id ... ON DELETE CASCADE`
--         and a blanket refusal cannot both be true. A cascade is an ordinary
--         DELETE on this table, so the trigger turned every hard league delete
--         into a P0001 — measured, and it is also the teardown ~10 db suites
--         run. The arm fires only when the parent league is ALREADY GONE, so
--         the log dies with its league and never one entry at a time;
--   (iii) a BEFORE TRUNCATE STATEMENT trigger plus a REVOKE, because a row
--         trigger never sees TRUNCATE, RLS does not apply to it, and the
--         Supabase default hands TRUNCATE on a new public table to `anon` and
--         `authenticated` — measured to succeed and to cascade into
--         `league_weeks`, `matchups`, `transactions` and `team_week_results`
--         through the three FKs below, while the RLS cells stayed green.
--         (The permissive default is SCHEMA-WIDE — `TRUNCATE public.matchups`
--         as `authenticated` succeeds too, and the repo has zero hits for
--         FORCE ROW LEVEL SECURITY / REVOKE TRUNCATE / BEFORE TRUNCATE. That
--         is NOT this migration's to fix table by table; it is filed as F327
--         so the sweep is a decision rather than an oversight.)
--
-- THE §12.12 MATCHUPS BACKSTOP IS DEFERRED, ON PURPOSE. §12.12:1216-1218
-- sketches a `BEFORE UPDATE` trigger on `matchups` refusing an override
-- without the GUC. No verb in THIS migration writes `matchups.is_overridden`
-- (measured: nothing in 109-122 writes it at all; `commish_edit_score` will
-- be its first writer), so the trigger here would be pure hot-path risk on a
-- table 111/116/117/119 UPDATE in loops. The GUC IS set by the logging
-- helper below so the backstop has its input the day it lands. F325 carries
-- it, WITH the defect already found in the printed sketch: `IF (NEW.
-- is_overridden AND guc = '')` breaks `finalize_matchups`, which UPDATEs an
-- already-overridden row to flip only its status from a pg_cron job that
-- sets no GUC (116:1135-1140). The predicate must be
-- `NEW.is_overridden IS DISTINCT FROM OLD.is_overridden` — narrower (a
-- status flip on an overridden row passes) and wider (a TRUE→FALSE
-- un-override is guarded too, which the sketch misses).
--
-- LEDGER. The new verb gets its OWN idempotency ledger rather than sharing
-- `lineup_actions` or folding into `commissioner_actions`. §12.26:1559 is the
-- reason and it is explicit: "an `action_id` is an idempotency key, **not**
-- an audit record". Sharing `lineup_actions` would put two verbs in one
-- `(league_id, action_id)` namespace, where a collision replays the WRONG
-- verb's result — 111:628-635 (R732) had to grow a `kind` discriminator for
-- exactly this — and fixing that direction would mean editing `set_lineup`,
-- which is forbidden here. Folding the ledger INTO `commissioner_actions`
-- would be worse: §12.12 prints a client INSERT policy for commissioners, so
-- a commissioner could pre-plant a row carrying an `action_id` his client is
-- about to send and a fabricated `result`, and the replay would return it
-- having moved nothing — a receipt with no change, CLAUDE.md's "nothing
-- happened" rule inverted. A separate ZERO-POLICY ledger makes both
-- impossible rather than merely refused. §12.13's "M6 decides its fold" is
-- hereby decided: NOT FOLDED. F326 records it.
--
-- SCORING — the failure this verb would otherwise cause SILENTLY, and the
-- HALF OF IT THAT LIVES IN THE WORKER (R965). A lineup edit enqueues nothing:
-- `score_fanout` (109:294-308) is a PLAYER-keyed delta queue whose only writer
-- is stat ingestion, and the worker marks a team `affected` only when one of
-- its CURRENT starters appears in a claimed stat batch
-- (score-week-worker.ts:938-946). So a post-kickoff edit whose players all
-- have final stats moves the lineup and moves NO score, indefinitely —
-- exactly Chris's case (benching a SEA player on Wednesday for a bench player
-- whose game is also final).
--
-- AN ENQUEUE ALONE DOES NOT FIX THAT, AND THE FIRST CUT OF THIS MIGRATION
-- BELIEVED IT DID. The players this verb queues are the ones whose STARTER
-- STATUS changed — and the removed one is, by definition, no longer a starter.
-- The drain looks him up in the week's `slot_map`s, finds him starting
-- nowhere, reports `toCompute.size === 0 ⇒ outcome 'skipped'` and DELETES the
-- row (score-week-worker.ts:982-986, :1241-1251). The lineup moved, the row
-- was consumed, and the stored points still carry the benched player, for
-- ever. Enqueuing the UNION instead of the symmetric difference only makes
-- the common case likely, not correct: on a Thursday-night week 1 the other
-- starters have no stat lines yet, so the union is the removed player alone
-- and the drain skips exactly the same way.
--
-- The team therefore has to be forced from the DRAIN side, and the drain
-- already reads the row that says so. `team_lineups.edited_by_commish` is
-- TRUE on precisely the rows a commissioner touched, the worker's own
-- `team_lineups` read is where it lives, and the drain returns early on a
-- `final` week — so the force costs one extra (idempotent) team recompute per
-- drain of an OPEN week, and nothing at all afterwards. Over-computing a team
-- writes the same value (`no_change`); under-computing it is the bug. Ordinary
-- stat-driven drains are untouched: a bench player's delta still recomputes
-- nobody. The enqueue below is what makes the drain VISIT this league-week;
-- `edited_by_commish` is what makes it compute THIS team once it is there.
-- The two halves are pinned on both sides — pgTAP 071 §H (the row is queued,
-- the flag is TRUE, the queued player starts nowhere) and
-- score-week-worker-db.test.ts (the drain recomputes him anyway).
--
-- The enqueue is the symmetric difference of old and new starters, and the
-- stamp is the trap: the
-- worker's readiness rule is `player_stats.updated_at >= enqueued_at`
-- (score-week-worker.ts:1142), so a row stamped `now()` is `not_ready`
-- FOREVER — deferred every drain (122) and never scored, which is worse than
-- doing nothing. Each row is stamped with that player's OWN MIN
-- `player_stats.updated_at` for the week (MIN, not MAX: the worker's line map
-- keeps an arbitrary row per player when several exist, so the minimum is the
-- only stamp that guarantees `landed`), `ON CONFLICT DO NOTHING` so an
-- existing healthy row is never re-stamped, and a player with no stats row is
-- skipped — he needs no enqueue, because the worker recomputes EVERY starter
-- of an affected team via `extraStats` once any one teammate drains, and an
-- absent line scores 0 either way. Every skipped player is NAMED in
-- `score_not_enqueued` with its reason (`no_stat_row` / `stats_unstamped`),
-- and the `stats_unstamped` case — a line that exists but carries a NULL
-- `updated_at`, which the queue cannot stamp — sets `score_stale` rather than
-- being folded into silence. On a
-- `final` week NOTHING is enqueued: the write door raises `week_final`
-- (119:566-568) and the worker consumes the row with no cell changed
-- (:892-895), so an enqueue there would be actively deceptive. The result
-- says which happened, by name, in `score_stale` / `score_stale_reason` /
-- `score_enqueued`. This verb NEVER sets `matchups.is_overridden`: on an open
-- week that would freeze the cell out of the write door (119:634, :654) —
-- the exact recompute the edit exists to cause.
--
-- HOLD FILE. NO hold line is added for 123, and the now-STALE `082-122` line
-- is DELETED in the same PR. MEASURED 2026-09-09 against production
-- (`list_migrations`): every version 082 through 122 IS applied, and
-- `.github/scripts/drift_compare.py:89-92` fails on `holds & remote` with
-- "Declared held, but production already HAS these — the hold is stale" —
-- so db-drift is red RIGHT NOW, before this migration existed. The file's own
-- rule 2 says holds expire loudly. `docs/specs/tasks-M4-inseason.md` §4 rule
-- 11 ("extend the hold's closed range in the same PR") is SUPERSEDED: this
-- migration is the fix for a live league and following that rule would hold
-- it out of the league it exists to fix. 123 reaches production the ordinary
-- way, `npx supabase db push`.
--
-- Numbering: migration head measured 122 by `ls supabase/migrations/ | tail`
-- (NOT derived from the file count — the 041-047 gap is intentional, D50)
-- ⇒ 123; pgTAP head 070 ⇒ 071.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. commissioner_actions — §12.12:1184-1210, with the deviations named
-- ---------------------------------------------------------------------------
CREATE TABLE commissioner_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  actor_id UUID REFERENCES profiles(id) NOT NULL,
  action_type TEXT NOT NULL,
    -- §12.12's vocabulary: edit_score | set_result | move_player | force_add |
    -- force_drop | reverse_trade | force_trade | edit_faab | edit_standings |
    -- edit_schedule | edit_lineup | draft_undo | draft_reassign | draft_reset |
    -- change_setting | reassign_team | promote_member | reopen_week |
    -- lifecycle_change. Deliberately NOT a CHECK: §15.4's verb list is still
    -- growing (PROGRESS §3(d) adds commish_rename_team, which §12.12 does not
    -- list), and a CHECK here would make every future verb a schema change.
  target_type TEXT,          -- matchup | team | player | trade | draft_pick | setting | member | schedule
  target_id TEXT,            -- TEXT, not UUID, on purpose: players.id is TEXT (109's league_player_pool),
                             -- so action_type = 'move_player' is unrepresentable under a UUID column.
  -- DEVIATION 1 from §12.12:1195, which prints `CHECK (length(btrim(reason)) > 0)`.
  -- btrim's default strips SPACES ONLY, so a tab- or newline-only reason passes
  -- it — the exact hole R745 had to fix once already at 112:756/114:315. The
  -- explicit class is carried here, and F40's recorded 500-character bound (the
  -- league_chat bound, R746) becomes the CHECK F40 says it should be.
  reason TEXT NOT NULL
    CHECK (length(btrim(reason, E' \t\r\n')) > 0 AND length(reason) <= 500),
  before JSONB,
  after JSONB,
  metadata JSONB,            -- { week, affected_team_ids[], ... }
  -- §10.3:701 lists `acting_as_team_id` among the captured fields and §12.12's
  -- DDL omits it; the prose is authoritative and the DDL is the erratum, so the
  -- column arrives with the table rather than costing a migration later. Unused
  -- by this verb (Act-as-Manager is its own task) and nullable.
  acting_as_team_id UUID REFERENCES teams(id),
  reverts_action_id UUID REFERENCES commissioner_actions(id),  -- if this undoes a prior action
  prev_hash TEXT,            -- Phase F tamper-evidence (§10.3, §12.12:1200-1201); shipped unused
  row_hash TEXT,
  -- DEVIATION 2 from §12.12:1202, which prints this nullable. Both existing
  -- ledgers make it NOT NULL (111:220, 112:324) and this is the audit log's
  -- ORDERING column: the League Activity feed pages on a COMPOSITE
  -- (created_at, id) cursor (R770), and a NULL is unreachable by any cursor
  -- predicate — a row that exists but appears on no page is the worst possible
  -- failure for a transparency surface. R43-class: NOT NULLs at creation.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE commissioner_actions IS
  'The §10.3 audit log (migration 123): append-only, immutable, league-visible. Every §15.4 override writes exactly one row in the SAME transaction as its state change, and only when something actually changed (PROGRESS §3 standing rule (b), Chris: "no receipt if nothing is done. only when something is done."). This is NOT an idempotency ledger — §12.26 is explicit that "an action_id is an idempotency key, not an audit record" — so replay keys live in the per-verb ledgers (lineup_actions 112, schedule_actions 111, commish_lineup_actions 123). The ABSENCE of UPDATE and DELETE policies is deliberate (§12.12:1205) and is backed by trg_commish_actions_immutable, because policy-absence does not restrain the table OWNER, which is the role every SECURITY DEFINER writer runs as.';
COMMENT ON COLUMN commissioner_actions.row_hash IS
  'Phase F tamper-evidence (§10.3, §12.12:1200-1201); unused in 123. Any chain MUST be computed at or before INSERT — a post-insert UPDATE to fill it in is refused by trg_commish_actions_immutable.';

CREATE INDEX idx_commish_actions_league ON commissioner_actions(league_id, created_at DESC);  -- §12.12:1210

ALTER TABLE commissioner_actions ENABLE ROW LEVEL SECURITY;
-- §12.12:1205 verbatim: VISIBLE TO ALL MEMBERS (transparency); INSERT only by
-- commissioners; NO UPDATE POLICY AND NO DELETE POLICY — that absence IS the
-- immutability, and it is deliberate. Do not add one.
-- (052:28-39: is_league_member / is_league_commish are the documented REVOKE
--  exception — they are RLS policy predicates evaluated as the calling role,
--  not RPCs, so they are never revoked from `authenticated`.)
CREATE POLICY "Audit log readable by all league members"
  ON commissioner_actions FOR SELECT USING (is_league_member(league_id));
CREATE POLICY "Only commish can append"
  ON commissioner_actions FOR INSERT
  WITH CHECK (is_league_commish(league_id) AND actor_id = auth.uid());

-- The backstop RLS cannot provide (§12.12:1212's own caveat; see IMMUTABILITY
-- in the banner for the measurement).
CREATE OR REPLACE FUNCTION commish_actions_immutable_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- THE ONE EXEMPTION, and it is not a hole: the audit log dies WITH its
  -- league and only with it. `league_id ... ON DELETE CASCADE` (above) issues
  -- an ordinary DELETE on this table, which a blanket refusal turns into a
  -- hard P0001 — so the declared CASCADE could never execute and a league that
  -- had ever been audited became undeletable (R966: MEASURED before the fix,
  -- `DELETE FROM leagues` → `ERROR: commissioner_actions is append-only ...
  -- CONTEXT: SQL statement "DELETE FROM ONLY public.commissioner_actions
  -- WHERE $1 = league_id"`, which is also every db-suite teardown that runs
  -- `service.from('leagues').delete()`).
  --
  -- The predicate is the FACT, not a mode flag: during an ON DELETE CASCADE
  -- the parent row is already gone when this row trigger fires (MEASURED on
  -- the local stack — the arm is taken at pg_trigger_depth() = 2 and the
  -- cascade completes; a DIRECT delete while the league still exists is
  -- refused in the same transaction). league_id is NOT NULL with an FK, so a
  -- row can only reach this arm because its league is being destroyed.
  -- §12.12's promise is intact: no client can reach it at all (no DELETE
  -- policy, and RLS still shows a client zero rows), and no verb, cron or
  -- DEFINER writer can remove ONE entry — only the deletion of the whole
  -- league takes the whole log with it.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = OLD.league_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'commissioner_actions is append-only: a % on the audit log is refused (§12.12/§10.3 — "undoing" an override is a NEW row referencing the original, never an edit to it)',
    TG_OP
    USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER trg_commish_actions_immutable
  BEFORE UPDATE OR DELETE ON commissioner_actions
  FOR EACH ROW EXECUTE FUNCTION commish_actions_immutable_internal();
-- R616 (104:489-502): the default tgenabled='O' is skipped ENTIRELY under
-- session_replication_role='replica' — the mode `supabase db push`,
-- `pg_restore` and logical apply all run in. ALWAYS or it is not a backstop.
ALTER TABLE commissioner_actions
  ENABLE ALWAYS TRIGGER trg_commish_actions_immutable;

-- TRUNCATE IS THE SAME HOLE ONE OPERATION OVER (R967). A row trigger does not
-- fire for TRUNCATE and TRUNCATE is not subject to RLS at all, and Supabase's
-- default grants on a new public table hand TRUNCATE to `anon` and
-- `authenticated` (MEASURED: `SET LOCAL ROLE authenticated; DELETE FROM
-- commissioner_actions` → `DELETE 0` as designed, then `TRUNCATE ... CASCADE`
-- → succeeded, cascading into league_weeks / matchups / transactions /
-- team_week_results through the three FKs this migration adds). PostgREST
-- exposes no TRUNCATE verb, so it is not remotely reachable today — but this
-- is the PR that asserts the log cannot be removed, so it closes it here:
-- a statement trigger that refuses, AND the grant taken away.
CREATE OR REPLACE FUNCTION commish_actions_no_truncate_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'commissioner_actions is append-only: a TRUNCATE on the audit log is refused (§12.12 — a row trigger never sees TRUNCATE and RLS does not apply to it, so this statement trigger is what makes "even a commissioner cannot remove an entry" true)'
    USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER trg_commish_actions_no_truncate
  BEFORE TRUNCATE ON commissioner_actions
  FOR EACH STATEMENT EXECUTE FUNCTION commish_actions_no_truncate_internal();
ALTER TABLE commissioner_actions
  ENABLE ALWAYS TRIGGER trg_commish_actions_no_truncate;
REVOKE TRUNCATE ON TABLE commissioner_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. log_commissioner_action_internal — §10.3's logCommissionerAction(), in
--    SQL. PLAIN (not DEFINER): every caller is already a DEFINER verb running
--    as the owner, so this is a seam, not a door (the 112:1213 posture).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_commissioner_action_internal(
  p_league_id         UUID,
  p_actor_id          UUID,
  p_action_type       TEXT,
  p_target_type       TEXT,
  p_target_id         TEXT,
  p_reason            TEXT,
  p_before            JSONB,
  p_after             JSONB,
  p_metadata          JSONB,
  p_acting_as_team_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.commissioner_actions (
    league_id, actor_id, action_type, target_type, target_id, reason,
    before, after, metadata, acting_as_team_id)
  VALUES (
    p_league_id, p_actor_id, p_action_type, p_target_type, p_target_id, p_reason,
    p_before, p_after, p_metadata, p_acting_as_team_id)
  RETURNING id INTO v_id;

  -- §12.12:1215's transaction-local backstop input. Set here so it is
  -- impossible for a verb to write state having "forgotten" to log — the log
  -- write IS what arms it. The matchups trigger that consumes it is F325's
  -- (see the banner); the GUC is correct and free today.
  PERFORM set_config('app.commish_action_id', v_id::text, true);
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION log_commissioner_action_internal(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The three FKs parked "M6 adds the FK with the table". All three columns
--    hold zero non-NULL values today, so each ALTER validates trivially.
-- ---------------------------------------------------------------------------
ALTER TABLE matchups      ADD CONSTRAINT matchups_override_action_id_fkey
  FOREIGN KEY (override_action_id)    REFERENCES commissioner_actions(id);   -- 109:169
ALTER TABLE transactions  ADD CONSTRAINT transactions_related_action_id_fkey
  FOREIGN KEY (related_action_id)     REFERENCES commissioner_actions(id);   -- 109:249
ALTER TABLE league_weeks  ADD CONSTRAINT league_weeks_reopened_by_action_id_fkey
  FOREIGN KEY (reopened_by_action_id) REFERENCES commissioner_actions(id);   -- 056:68

-- ---------------------------------------------------------------------------
-- 4. commish_lineup_actions — the new verb's idempotency ledger (the 111/112
--    shape; see LEDGER in the banner for why it is its own table)
-- ---------------------------------------------------------------------------
CREATE TABLE commish_lineup_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  action_id  UUID NOT NULL,                       -- client-minted; dedupes retries (the E2/D68 replay key)
  actor_id   UUID NOT NULL REFERENCES profiles(id),
  result     JSONB NOT NULL,                      -- the verb's returned jsonb, replayed byte-identically
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, action_id)                   -- the race backstop behind the select-then-insert
);
CREATE INDEX idx_commish_lineup_actions_team ON commish_lineup_actions(team_id);

ALTER TABLE commish_lineup_actions ENABLE ROW LEVEL SECURITY;
-- ZERO policies: the DEFINER RPC is the only reader and writer (112:330's
-- posture). This is also what makes the replay unpoisonable — no client can
-- pre-plant a row here at all, which is not true of commissioner_actions.
-- RLS does NOT cover TRUNCATE and the Supabase default grants it to anon and
-- authenticated (R967, measured on this very table), so a client could have
-- emptied the replay ledger even though it can read nothing in it. Taken away
-- here. No trigger: this is an idempotency ledger, not the audit log — losing
-- it re-evaluates a retry, it does not erase a record.
REVOKE TRUNCATE ON TABLE commish_lineup_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. commish_edit_lineup_internal — DERIVED from 114:153-755 (D137). PLAIN,
--    search_path='', takes the instant as an argument. Read THE DIFFERENCES
--    in the banner before diffing this against 114.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_edit_lineup_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_week      INTEGER,
  p_slot_map  JSONB,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_team        public.teams;
  v_row         public.team_lineups;
  v_lw          public.league_weeks;
  v_found       BOOLEAN;
  v_result      JSONB;
  v_current     INTEGER;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_e           JSONB;
  v_p           JSONB;
  v_seen        JSONB := '{}'::jsonb;
  v_by_pid      JSONB := '{}'::jsonb;   -- player_id → roster element
  v_kick        JSONB := '{}'::jsonb;   -- player_id → {kickoff_at, datum_arm, on_bye} for p_week
  v_kick_cur    JSONB := '{}'::jsonb;   -- the same for the CURRENT week (IR moves)
  v_window      RECORD;
  v_window_cur  RECORD;
  v_k           RECORD;
  v_reason      TEXT;
  v_message     TEXT;
  v_fit_players JSONB := '[]'::jsonb;
  v_fit         JSONB;
  v_canon       JSONB := '{}'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB := '[]'::jsonb;
  v_ir_out      JSONB := '[]'::jsonb;
  v_flags_bye   JSONB := '[]'::jsonb;
  v_flags_out   JSONB := '[]'::jsonb;
  v_flags_empty JSONB := '[]'::jsonb;
  v_flags_irin  JSONB := '[]'::jsonb;
  v_ir_placed   JSONB := '[]'::jsonb;
  v_ir_removed  JSONB := '[]'::jsonb;
  v_pflags      JSONB;
  v_locked_at   TIMESTAMPTZ;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_expected    INTEGER;
  v_spot        JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_ir_now      TEXT[] := ARRAY[]::text[];  -- player ids under an IR key in the submitted map
  -- NEW in 123 (the differences)
  v_audit_id    UUID;
  v_bypassed    JSONB := '[]'::jsonb;   -- every lock/stint gate this edit walked past, NAMED
  v_moved_lock  JSONB := '[]'::jsonb;   -- the players a manager could not have moved
  v_old_start   TEXT[] := ARRAY[]::text[];
  v_rescore     TEXT[] := ARRAY[]::text[];
  v_enqueued    JSONB := '[]'::jsonb;
  v_not_enq     JSONB := '[]'::jsonb;   -- rescore players with NO queue row, each with its reason
  v_unstamped   TEXT[] := ARRAY[]::text[];
  v_score_stale BOOLEAN;
  v_stale_why   TEXT;
  v_before      JSONB;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'commish_edit_lineup: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_slot_map IS NULL OR jsonb_typeof(p_slot_map) <> 'object' THEN
    RAISE EXCEPTION
      'commish_edit_lineup: p_slot_map must be a JSON object of "<slot_key>:<index>" → player_id (§12.13); got %',
      COALESCE(jsonb_typeof(p_slot_map), 'null')
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8). Every other
  --     row lock in this body comes after it — reversing them would invert the
  --     lock order against every other league RPC.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) AUTH — COMMISSIONER ONLY (difference (C)). A manager, including this
  --     team's own manager, uses `set_lineup`; this verb is the exception
  --     path and it is audited. One no-leak 42501 for "no such league" and
  --     "not a commissioner" alike.
  v_found := FOUND;
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_edit_lineup: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2): the same action_id returns the stored result, byte-
  -- identically — nothing re-evaluated, nothing written. Placed BEFORE every
  -- business gate exactly as 114:250-257 places it, so a retry replays even
  -- when the league or the week has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_lineup_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'commish_edit_lineup: league % is % — a lineup has no meaning outside a season (§11.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'commish_edit_lineup: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'commish_edit_lineup: team % is retired — a sealed franchise has no lineup to set (§7.2.1)', p_team_id
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'commish_edit_lineup: league % has no league_weeks rows — no season calendar to set a lineup against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'commish_edit_lineup: week % is not on league %''s calendar (season %; league_weeks holds weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),
      (SELECT max(week) FROM public.league_weeks WHERE league_id = p_league_id)
      USING ERRCODE = 'P0001';
  END IF;
  -- DIFFERENCE (B): 114:293-305's past-week and closed-week refusals are NOT
  -- copied. Both of them say, in their own text, that the change goes
  -- "through the audited commissioner override (§11.2, M6)". This is it.
  -- §11.2:730: "Commissioner can edit any lineup, including retroactively and
  -- past lock (audited)."
  IF p_week < v_current THEN
    v_bypassed := v_bypassed || to_jsonb('past_week'::text);
  END IF;
  IF v_lw.status IN ('correction_window', 'final') THEN
    v_bypassed := v_bypassed || to_jsonb(('closed_week:' || v_lw.status)::text);
  END IF;

  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- DIFFERENCE (D): the reason is REQUIRED unconditionally (§15.4:1689's
  -- header, "all require `reason`"), not "when the actor is not the manager".
  -- Blank = nothing but whitespace INCLUDING tabs/newlines (R745 — btrim's
  -- default strips spaces only); bounded at 500, the league_chat bound (R746)
  -- and the table CHECK's.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION
      'commish_edit_lineup: a reason is required — this verb writes an audited commissioner_actions row the whole league can read (§15.4, §10.3)'
      USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'commish_edit_lineup: the reason is % characters — at most 500 (the league_chat bound; §12.13)',
      char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (3) THE ROSTER (positions normalized to the roster vocabulary — DEF → DST,
  --     the 086 shape; designations bridged). Verbatim 114:329-349 — the DST
  --     normalisation is what `lineup_fit_internal`'s eligibility test matches
  --     on, so a defense is unplaceable without it.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',          r.player_id,
           'name',               p.full_name,
           'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',        public.lineup_designation_internal(p.status),
           'nfl_team',           p.team,
           'ir_placed_week',     r.ir_placed_week,
           'ir_lock_until_week', r.ir_lock_until_week,
           'slot_key',           r.slot_key) ORDER BY r.player_id), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  IF jsonb_array_length(v_roster) = 0 THEN
    RAISE EXCEPTION
      'commish_edit_lineup: team % has no rostered players in league % — a lineup exists only over a roster (§11.1)',
      p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order + IR spots (verbatim 114:350-370). The
  -- canonical order of v_slots IS the order starters[] is emitted in.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',          (s ->> 'key') || ':0',
           'spot',         s ->> 'key',
           'type',         s ->> 'type',
           'designations', s -> 'eligible_designations',
           'min_weeks',    (s ->> 'min_weeks')::int) ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- (4) THE LINEUP ROW — created on first touch, then locked (rule 8: after
  --     the league row). Loud emptiness: FOUND is asserted.
  INSERT INTO public.team_lineups (team_id, season, week, starters, bench)
  VALUES (p_team_id, v_league.season, p_week, '[]'::jsonb, '[]'::jsonb)
  ON CONFLICT (team_id, season, week) DO NOTHING;
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week = p_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commish_edit_lineup: no lineup row for team % season % week % after create — refusing to continue',
      p_team_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);
  -- The `before` image the audit row carries — captured before anything moves.
  v_before := jsonb_build_object(
    'slot_map', v_stored, 'starters', COALESCE(v_row.starters, '[]'::jsonb),
    'bench', COALESCE(v_row.bench, '[]'::jsonb), 'locked_at', v_row.locked_at,
    'edited_by_commish', v_row.edited_by_commish, 'set_at', v_row.set_at);

  -- (5) VALIDATE THE SUBMITTED MAP (verbatim 114:388-422): keys are slot
  --     instances or IR spots, values are this team's rostered players, each
  --     player exactly once. These are SHAPE and OWNERSHIP gates, not timing
  --     gates — they bind the commissioner (see WHAT IS NOT LIFTED).
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'commish_edit_lineup: slot % must map to a player_id string (§12.13); got %', v_key, jsonb_typeof(v_val)
        USING ERRCODE = '22023';
    END IF;
    v_pid := v_val #>> '{}';
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      RAISE EXCEPTION
        'commish_edit_lineup: "%" is not a slot of league %''s roster (§7.3.2 starting_slots: %; IR spots: %)',
        v_key, p_league_id,
        (SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_slots) s),
        COALESCE((SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_ir_spots) s), 'none')
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_by_pid ? v_pid) THEN
      RAISE EXCEPTION 'commish_edit_lineup: player % is not on team %''s roster in league % (§11.1)', v_pid, p_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_seen ? v_pid THEN
      RAISE EXCEPTION
        'commish_edit_lineup: % (%) appears at both "%" and "%" — each player fills exactly one slot (E16)',
        v_by_pid -> v_pid ->> 'name', v_pid, v_seen ->> v_pid, v_key
        USING ERRCODE = 'P0001';
    END IF;
    v_seen := v_seen || jsonb_build_object(v_pid, v_key);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_ir_now := v_ir_now || v_pid;
      v_canon := v_canon || jsonb_build_object(v_key, v_pid);
    ELSE
      v_started := v_started || v_pid;
    END IF;
  END LOOP;

  -- (6) KICKOFF DATA, read NOW from nfl_games (E42/§23.3) — verbatim
  --     114:424-442. Still needed in full even though the lock is lifted:
  --     v_kick feeds locked_at, starters[].kickoff_at and the bye flag.
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, p_week, p_at);
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, p_week, v_e ->> 'nfl_team', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_current, v_e ->> 'nfl_team', p_at);
      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
        'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    END IF;
  END LOOP;
  IF v_current = p_week THEN
    v_kick_cur := v_kick;
    v_window_cur := v_window;
  ELSE
    SELECT * INTO v_window_cur FROM public.schedule_window_internal(v_league.season, v_current, p_at);
  END IF;

  -- (7) THE LOCK — DIFFERENCE (A1)/(A2). 114:444-476's two arms are NOT here.
  --     A stored starter whose game kicked off MAY leave his key, and a
  --     player whose game has started MAY enter or move slots. That is the
  --     entire purpose of this verb (PROGRESS §3 clause (g), Chris: "an LM
  --     should be able to set the lineup even after the games have started").
  --     The arms stay byte-identical in `set_lineup_internal` for every
  --     caller, commissioner included — never weaken the rule, add the
  --     exception path.
  --     What replaces them is a RECORD, not a refusal: every player this edit
  --     moved whose game had already kicked off is named, and rides into the
  --     audit row's metadata so the league can see exactly what the override
  --     did that a manager could not have.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN NOT (v_by_pid ? v_pid);
    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
    IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
       AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid THEN
      v_moved_lock := v_moved_lock || jsonb_build_object(
        'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        'from', v_key, 'to', v_seen ->> v_pid,
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'datum_arm', v_kick -> v_pid ->> 'datum_arm');
    END IF;
  END LOOP;
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
    IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
       AND (v_stored ->> v_key) IS DISTINCT FROM v_pid
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_moved_lock) m WHERE m ->> 'player_id' = v_pid) THEN
      v_moved_lock := v_moved_lock || jsonb_build_object(
        'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        -- His PRIOR slot, or NULL when he was on the bench. (R970: this was
        -- wrapped in `CASE WHEN v_stored ? v_pid THEN NULL ELSE …` — a
        -- key-existence test against a slot_map keyed by SLOT, so it asked
        -- whether a PLAYER ID was a slot key and was dead by construction.
        -- The subquery alone was always the whole computation; the guard only
        -- misled, in the permanent record of what the override did.)
        'from', (SELECT e.key FROM jsonb_each(v_stored) e WHERE e.value #>> '{}' = v_pid LIMIT 1),
        'to', v_key,
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'datum_arm', v_kick -> v_pid ->> 'datum_arm');
    END IF;
  END LOOP;
  IF jsonb_array_length(v_moved_lock) > 0 THEN
    v_bypassed := v_bypassed || to_jsonb('per_player_kickoff_lock'::text);
  END IF;

  -- (8) THE FIT (E16) — 114:479-496 with DIFFERENCE (A3): every player is
  --     passed `fixed = FALSE`. THIS IS LOAD-BEARING, not cosmetic. In
  --     `lineup_fit_internal` a fixed player is seeded at his `wanted` slot
  --     UNCONDITIONALLY (112:498-505) and a fixed-owned slot is never
  --     traversed by the BFS (112:518) — `fixed` IS the matcher's own copy of
  --     the lock. Carrying 114's computation here would silently re-pin every
  --     kicked-off player at his stored slot, and the verb would look like it
  --     worked while refusing to move the one player it exists to move.
  --     With FALSE throughout, `lineup_fit_internal` is reused BYTE-UNCHANGED
  --     and still enforces position eligibility.
  --     Input order is then just submitted-key ordinality — still deterministic.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id', v_by_pid -> x.pid ->> 'player_id',
           'position',  v_by_pid -> x.pid ->> 'position',
           'wanted',    x.key,
           'fixed',     FALSE) ORDER BY x.ord), '[]'::jsonb)
  INTO v_fit_players
  FROM (
    SELECT e.key, e.value #>> '{}' AS pid, e.ord
    FROM jsonb_each(p_slot_map) WITH ORDINALITY AS e(key, value, ord)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key)
  ) x;
  v_fit := public.lineup_fit_internal(v_slots, v_fit_players);
  -- E16 is NOT lifted — see WHAT IS NOT LIFTED in the banner (season gate
  -- invariant 2 reds on any stored lineup the fit cannot seat, F324).
  IF jsonb_array_length(v_fit -> 'unplaced') > 0 THEN
    v_pid := v_fit -> 'unplaced' ->> 0;
    v_key := v_seen ->> v_pid;
    RAISE EXCEPTION
      'commish_edit_lineup: % (%) cannot be placed — no legal arrangement fills the slots (E16): "%" accepts % and every slot % could take is held by a player with nowhere else to go (unplaced: %)',
      v_by_pid -> v_pid ->> 'name', v_by_pid -> v_pid ->> 'position', v_key,
      (SELECT string_agg(x #>> '{}', '/') FROM jsonb_array_elements((SELECT s -> 'eligible' FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)) x),
      v_by_pid -> v_pid ->> 'name',
      v_fit -> 'unplaced'
      USING ERRCODE = 'P0001';
  END IF;
  v_canon := v_canon || (v_fit -> 'assignment');

  -- (9) IR MOVES, against the CURRENT week — 114:514-579 with DIFFERENCE (A4):
  --     the two Restricted-IR STINT refusals and the two IR LOCK-TIMING
  --     refusals are NOT copied. §11.2:727 names the stint override in so many
  --     words ("Restricted stint still applies; commissioner can override");
  --     the timing gates are the IR analogue of the two lock arms. The
  --     DESIGNATION eligibility gate IS kept — it is a legality rule, and the
  --     already-placed-but-ineligible case stays a FLAG exactly as 114 has it.
  --     Every gate walked past is recorded in v_bypassed.
  FOR v_spot IN SELECT * FROM jsonb_array_elements(v_ir_spots) LOOP
    v_pid := v_canon ->> (v_spot ->> 'key');
    CONTINUE WHEN v_pid IS NULL;
    v_e := v_by_pid -> v_pid;
    IF (v_e ->> 'ir_placed_week') IS NULL OR (v_e ->> 'slot_key') IS DISTINCT FROM (v_spot ->> 'key') THEN
      IF (v_e ->> 'ir_placed_week') IS NOT NULL AND (v_e ->> 'ir_lock_until_week') IS NOT NULL
         AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
        v_bypassed := v_bypassed || to_jsonb(('ir_restricted_stint:' || v_pid)::text);
      END IF;
      IF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
        RAISE EXCEPTION
          'commish_edit_lineup: % holds designation % — IR spot % accepts only % (§7.3.2 IR slot rules)',
          v_e ->> 'name', COALESCE(v_e ->> 'designation', 'none'), v_spot ->> 'spot',
          (SELECT string_agg(x #>> '{}', ', ') FROM jsonb_array_elements(v_spot -> 'designations') x)
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
        v_bypassed := v_bypassed || to_jsonb(('ir_lock_timing:' || v_pid)::text);
      END IF;
      v_ir_placed := v_ir_placed || jsonb_build_object(
        'player_id', v_pid, 'spot', v_spot ->> 'key', 'type', v_spot ->> 'type',
        'ir_placed_week', v_current,
        'ir_lock_until_week', CASE WHEN v_spot ->> 'type' = 'restricted'
                                   THEN v_current + COALESCE((v_spot ->> 'min_weeks')::int, 4) END);
    ELSIF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
      v_flags_irin := v_flags_irin || to_jsonb(v_pid);
    END IF;
    v_ir_out := v_ir_out || jsonb_build_object(
      'slot', v_spot ->> 'key', 'player_id', v_pid, 'position', v_e ->> 'position',
      'designation', v_e ->> 'designation',
      'ir_placed_week', COALESCE((SELECT (x ->> 'ir_placed_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid), (v_e ->> 'ir_placed_week')::int),
      'ir_lock_until_week', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 THEN (SELECT (x ->> 'ir_lock_until_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 ELSE (v_e ->> 'ir_lock_until_week')::int END,
      'flags', CASE WHEN v_flags_irin ? v_pid THEN '["ir_ineligible"]'::jsonb ELSE '[]'::jsonb END);
  END LOOP;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    CONTINUE WHEN (v_e ->> 'ir_placed_week') IS NULL;
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_now);
    IF (v_e ->> 'ir_lock_until_week') IS NOT NULL AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
      v_bypassed := v_bypassed || to_jsonb(('ir_restricted_stint:' || v_pid)::text);
    END IF;
    IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
      v_bypassed := v_bypassed || to_jsonb(('ir_lock_timing:' || v_pid)::text);
    END IF;
    v_ir_removed := v_ir_removed || jsonb_build_object('player_id', v_pid, 'spot', v_e ->> 'slot_key');
  END LOOP;

  -- (10) STARTERS (derived render state) + flags; bench = roster − starters − IR.
  --      Verbatim 114:581-631. The starters[] element shape
  --      {slot, slot_key, label, player_id, position, kickoff_at, flags} is a
  --      HARD cross-file contract: `lineup_lock_tick` walks each element,
  --      reads `player_id`, compares `kickoff_at` as an INSTANT and rewrites
  --      it in place (116:701-726). A different shape either crashes that
  --      league's arm of the hourly job — whose handler swallows it into a
  --      WARNING (116:734-738), so the failure would be SILENT — or churns the
  --      row every hour.
  --      `locked_at` is the LEAST over EVERY occupied starting slot whose
  --      player has a non-NULL kickoff — NOT only those already kicked off.
  --      The tick recomputes it the same way (116:718-720) and would overwrite
  --      any other value.
  v_locked_at := NULL;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_canon ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
      v_flags_empty := v_flags_empty || to_jsonb(v_key);
    ELSE
      v_p := v_by_pid -> v_pid;
      IF (v_kick -> v_pid ->> 'on_bye')::boolean THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
        v_flags_bye := v_flags_bye || to_jsonb(v_pid);
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
        v_flags_out := v_flags_out || to_jsonb(v_pid);
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
      -- §7.3.6 allow_illegal_lineups = FALSE. KEPT (see WHAT IS NOT LIFTED).
      -- 114's R739 clause is dropped from the predicate rather than carried:
      -- it exempts "the stored player's own game has kicked off and he is the
      -- stored occupant", i.e. "not the manager's to change" — and for a verb
      -- with no lock there is no such thing, so carrying it would be a clause
      -- that means nothing. The gate is therefore the plain one.
      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0 THEN
        RAISE EXCEPTION
          'commish_edit_lineup: % is % for week % and allow_illegal_lineups is off — slot "%" is blocked at submit (§7.3.6); bench him, start someone who plays, or turn the setting on',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_starters := v_starters || jsonb_build_object(
      'slot', v_key, 'slot_key', v_e ->> 'slot', 'label', v_e ->> 'label',
      'player_id', v_pid,
      'position', CASE WHEN v_pid IS NULL THEN NULL ELSE v_by_pid -> v_pid ->> 'position' END,
      'kickoff_at', CASE WHEN v_pid IS NULL THEN NULL ELSE v_kick -> v_pid ->> 'kickoff_at' END,
      'flags', v_pflags);
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(e ->> 'player_id') ORDER BY e ->> 'player_id'), '[]'::jsonb)
  INTO v_bench
  FROM jsonb_array_elements(v_roster) e
  WHERE NOT ((e ->> 'player_id') = ANY (v_started))
    AND NOT ((e ->> 'player_id') = ANY (v_ir_now));

  -- (11) NO-OP BY NAME (rule 10, and Chris's one condition). DETECTED, never
  --      inferred from an empty write: the canonical map equals the stored map
  --      and no IR move. jsonb equality, so key order is irrelevant.
  v_no_changes := (v_canon = v_stored)
                  AND jsonb_array_length(v_ir_placed) = 0
                  AND jsonb_array_length(v_ir_removed) = 0;

  -- Which starters changed — the enqueue set (see SCORING). Computed here so
  -- the result can report it whether or not the write happens.
  SELECT COALESCE(array_agg(e.value #>> '{}'), ARRAY[]::text[])
  INTO v_old_start
  FROM jsonb_each(v_stored) e
  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key);
  v_rescore := ARRAY(
    SELECT x FROM unnest(v_old_start) x WHERE NOT (x = ANY (v_started))
    UNION
    SELECT x FROM unnest(v_started) x WHERE NOT (x = ANY (v_old_start)));

  v_score_stale := FALSE;
  v_stale_why   := NULL;

  IF NOT v_no_changes THEN
    -- (12) WRITE — the lineup row, then the roster's slot_key/IR columns.
    --       DIFFERENCE (E): edited_by_commish is the literal TRUE.
    --       DIFFERENCE (G): set_at rides the seam.
    UPDATE public.team_lineups
    SET slot_map          = v_canon,
        starters          = v_starters,
        bench             = v_bench,
        locked_at         = v_locked_at,
        edited_by_commish = TRUE,
        set_at            = p_at
    WHERE id = v_row.id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_edit_lineup: updated % lineup rows for team % week %, expected 1', v_cnt, p_team_id, p_week
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_placed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week     = (v_e ->> 'ir_placed_week')::int,
          ir_lock_until_week = (v_e ->> 'ir_lock_until_week')::int,
          slot_key           = v_e ->> 'spot'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'commish_edit_lineup: IR placement of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_removed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week = NULL, ir_lock_until_week = NULL, slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'commish_edit_lineup: IR removal of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- (12b) THE SCORE. A lineup edit enqueues nothing on its own and the
    --       worker only notices a team through a STARTER's stat delta, so
    --       without this a post-kickoff edit moves the lineup and never moves
    --       the score. Read SCORING in the banner before touching the stamp.
    IF v_lw.status IN ('live', 'correction_window') AND array_length(v_rescore, 1) > 0 THEN
      INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
      SELECT v_league.season, p_week, ps.player_id, min(ps.updated_at)
      FROM public.player_stats ps
      WHERE ps.season = v_league.season AND ps.week = p_week
        AND ps.player_id = ANY (v_rescore)
        AND ps.updated_at IS NOT NULL
      GROUP BY ps.player_id
      ON CONFLICT (season, week, player_id) DO NOTHING;   -- never re-stamp a healthy row
      -- WHAT THIS FIELD MEANS, because a receipt that over-claims is the bug
      -- this whole banner is about: "a claimable queue row EXISTS for him",
      -- not "this statement inserted one". An untouched healthy row left by
      -- ON CONFLICT drains just as well, so it counts — but a player the
      -- INSERT could not queue is NEVER folded into silence.
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x), '[]'::jsonb) INTO v_enqueued
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.score_fanout f
                    WHERE f.season = v_league.season AND f.week = p_week AND f.player_id = x);
      -- R968 — THE OMISSION, NAMED. `player_stats.updated_at` is NULLABLE
      -- (measured: information_schema.columns → is_nullable = YES), so a
      -- partial ingestion can leave a scoreable line the enqueue cannot stamp.
      -- That player is dropped from the queue silently unless we say so.
      SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_unstamped
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.player_stats ps
                    WHERE ps.season = v_league.season AND ps.week = p_week AND ps.player_id = x)
        AND NOT EXISTS (SELECT 1 FROM public.player_stats ps
                        WHERE ps.season = v_league.season AND ps.week = p_week AND ps.player_id = x
                          AND ps.updated_at IS NOT NULL);
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'player_id', x,
               'why', CASE WHEN x = ANY (v_unstamped) THEN 'stats_unstamped' ELSE 'no_stat_row' END) ORDER BY x), '[]'::jsonb)
      INTO v_not_enq
      FROM unnest(v_rescore) x
      WHERE NOT EXISTS (SELECT 1 FROM public.score_fanout f
                        WHERE f.season = v_league.season AND f.week = p_week AND f.player_id = x);
      IF array_length(v_unstamped, 1) > 0 THEN
        -- A line exists and may carry points; we could not give it a
        -- claimable stamp. That is a lineup that moved and a score that may
        -- not follow — the one thing this verb must never report as success.
        v_score_stale := TRUE;
        v_stale_why   := 'stats_unstamped';
      END IF;
      -- A rescore player with NO stat line at all is NOT stale: the worker
      -- scores an absent line as 0 (`no_stat_row`), so adding or removing him
      -- moves no points. He is still named in `score_not_enqueued` rather
      -- than inferred from an empty array.
    ELSIF v_lw.status = 'final' AND array_length(v_rescore, 1) > 0 THEN
      -- The write door raises `week_final` (119:566-568) and the worker
      -- consumes the queue row with no cell changed (:892-895) — an enqueue
      -- here would delete itself having done nothing. Say so instead.
      -- R969: gated on v_rescore like the other two arms. A pure slot
      -- rearrangement or an IR-only move on a final week changes NO starter
      -- set, so there is no score to chase and a `score_stale` there is a
      -- false alarm in the one field whose whole job is to be believed.
      v_score_stale := TRUE;
      v_stale_why   := 'week_final';
    ELSIF array_length(v_rescore, 1) > 0 THEN
      -- `upcoming`: nothing has been scored yet, so there is nothing stale.
      v_stale_why := NULL;
    END IF;

    -- (12c) THE RECEIPT (§10.3, §15.4:1689). Exactly one audit row, in THIS
    --       transaction, INSIDE the no-op guard — Chris's one condition:
    --       "no receipt if nothing is done. only when something is done."
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'edit_lineup', 'team', p_team_id::text, v_reason,
      v_before,
      jsonb_build_object(
        'slot_map', v_canon, 'starters', v_starters, 'bench', v_bench,
        'locked_at', v_locked_at, 'edited_by_commish', TRUE, 'set_at', p_at),
      jsonb_build_object(
        'week',                p_week,
        'current_week',        v_current,
        'season',              v_league.season,
        'week_status',         v_lw.status,
        'team_name',           v_team.name,
        'action_id',           p_action_id,
        -- The whole point of the verb, made legible: every rule this edit
        -- walked past, and every kicked-off player it moved.
        'bypassed',            v_bypassed,
        'locked_players_moved', v_moved_lock,
        'ir_moves',            jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
        'flags',               jsonb_build_object('bye', v_flags_bye, 'out', v_flags_out,
                                                  'empty', v_flags_empty, 'ir_ineligible', v_flags_irin),
        'score_enqueued',      v_enqueued,
        'score_not_enqueued',  v_not_enq,
        'score_stale',         v_score_stale,
        'score_stale_reason',  v_stale_why),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_edit_lineup: the audit row was not written — refusing to let the edit stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- §10.3: override system messages auto-post to league chat and CANNOT be
    -- disabled. D97/D290's in-txn post, reworded as the override post.
    v_message := 'Week ' || p_week || ' lineup for ' || v_team.name || ' edited by '
      || public.draft_actor_name() || ' (commissioner override'
      || CASE WHEN jsonb_array_length(v_moved_lock) > 0
              THEN ', ' || jsonb_array_length(v_moved_lock) || ' player'
                   || CASE WHEN jsonb_array_length(v_moved_lock) = 1 THEN '' ELSE 's' END
                   || ' moved after kickoff'
              ELSE '' END
      || ') — reason: ' || v_reason;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

    IF p_week = v_current THEN
      -- slot_key describes the ACTIVE week only, so a RETROACTIVE edit
      -- correctly leaves it alone — 114's guard is right as written.
      v_expected := 0;
      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit -> 'assignment') LOOP
        UPDATE public.league_rosters r SET slot_key = v_key
        WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = (v_val #>> '{}');
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        v_expected := v_expected + v_cnt;
      END LOOP;
      IF v_expected <> COALESCE(array_length(v_started, 1), 0) THEN
        RAISE EXCEPTION 'commish_edit_lineup: wrote slot_key for % starters, expected %', v_expected, COALESCE(array_length(v_started, 1), 0)
          USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.league_rosters r SET slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id
        AND r.player_id = ANY (SELECT x #>> '{}' FROM jsonb_array_elements(v_bench) x);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> jsonb_array_length(v_bench) THEN
        RAISE EXCEPTION 'commish_edit_lineup: wrote slot_key = bn for % players, expected %', v_cnt, jsonb_array_length(v_bench)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'season',                 v_league.season,
    'week',                   p_week,
    'current_week',           v_current,
    'action_id',              p_action_id,
    'lineup_lock',            v_league.lineup_lock,
    'allow_illegal_lineups',  v_allow,
    'no_changes',             v_no_changes,
    'rearranged',             (v_fit ->> 'rearranged')::boolean,
    'moved',                  v_fit -> 'moved',
    'slot_map',               v_canon,
    'starters',               v_starters,
    'bench',                  v_bench,
    'ir',                     v_ir_out,
    'ir_moves',               jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
    'flags', jsonb_build_object(
      'illegal',       jsonb_array_length(v_flags_bye) + jsonb_array_length(v_flags_out) + jsonb_array_length(v_flags_irin) > 0,
      'bye',           v_flags_bye,
      'out',           v_flags_out,
      'empty',         v_flags_empty,
      'ir_ineligible', v_flags_irin),
    'locked_at',              v_locked_at,
    'edited_by_commish',      TRUE,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at,
    'week_datum', jsonb_build_object(
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'kicked_off',       NOT v_window.free),
    'current_week_datum', jsonb_build_object(
      'first_kickoff_at', v_window_cur.first_kickoff_at,
      'datum_arm',        v_window_cur.datum_arm,
      'kicked_off',       NOT v_window_cur.free),
    -- 123's own keys. The receipt, what the override walked past, and whether
    -- the SCORE followed — said by name, never left to be inferred.
    'commissioner_action_id', v_audit_id,      -- NULL on a no-op, and that is the point
    'week_status',            v_lw.status,
    'bypassed',               v_bypassed,
    'locked_players_moved',   v_moved_lock,
    'score_enqueued',         v_enqueued,
    'score_not_enqueued',     v_not_enq,
    'score_stale',            v_score_stale,
    'score_stale_reason',     v_stale_why
  );

  -- The idempotency ledger row is written for a NO-OP TOO (114:748's posture):
  -- an action_id is consumed by its submit whether or not anything moved, so a
  -- retry replays instead of re-evaluating. This is the OPPOSITE rule from the
  -- audit row above, and deliberately so — §12.26: "an action_id is an
  -- idempotency key, not an audit record".
  INSERT INTO public.commish_lineup_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_edit_lineup_internal(UUID, UUID, INTEGER, JSONB, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. commish_edit_lineup — the client-facing verb (§15.4:1695). Transaction
--    now(), never a caller-supplied instant (D307(3)); SECURITY DEFINER;
--    in-body auth is the internal body's step (2). Mirrors 112:1221-1237.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_edit_lineup(
  p_league_id UUID,
  p_team_id   UUID,
  p_week      INTEGER,
  p_slot_map  JSONB,
  p_reason    TEXT DEFAULT NULL,  -- REQUIRED in-body (22023) — §15.4:1689, "all require reason"
  p_action_id UUID DEFAULT NULL   -- REQUIRED in-body (22023); DEFAULT only to keep §15.4's argument order
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.commish_edit_lineup_internal(
    p_league_id, p_team_id, p_week, p_slot_map, p_action_id, now(), p_reason);
END;
$$;
-- The DEFINER wrapper is the client door: `authenticated` keeps EXECUTE, the
-- in-body commissioner gate is the authorization (112:1237's posture).
REVOKE EXECUTE ON FUNCTION commish_edit_lineup(UUID, UUID, INTEGER, JSONB, TEXT, UUID) FROM PUBLIC, anon;
