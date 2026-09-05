-- ============================================================================
-- The pool writers + `roster_add_drop` + game-day locks — migration 113 (task
-- L.D1.5, the L.D5 core; spec v2.16.16 → v2.16.19 by this PR's fold-back
-- (§13.1 / §12.9 / §12.19 annotations + the Q32/Q33 rulings + the R759
-- re-seat disclosure); §13.1 add/drop &
-- free agency / §7.3.4 the lock, cap and hold fields (`player_game_lock`,
-- `acquisitions_per_week` / `_per_season`, `fa_hold_hours`,
-- `waiver_period_hours`, `free_agency`, `waiver_type = none_fcfs`) / §12.19
-- `league_player_pool` / §12.9 `transactions` / §12.7 `league_rosters` /
-- §11.2 (the lineup-lock interplay) / E32 / E34 / E42 / §23.3 / §23.4;
-- CLAUDE.md business rule 7 (player exclusivity); tasks-M4 §4 standing
-- rules 1–11; D291 / D294; ledger F222(a) (the pool half — the CHECK is
-- TAKEN here) / F224(i) (the `slot_map` / `slot_key` duties — built here);
-- PROGRESS D309 (build mechanics), F227 (this task's deferrals).
--
-- Numbering: migration head measured 112 at task time (ls supabase/migrations/
-- | tail -1) ⇒ 113, pgTAP head 060 ⇒ 061 — the tasks-M4 §7 reservations
-- CONFIRMED, not inherited (D161/D166).
--
-- D137 provenance: NO existing function is replaced. `lineup_kickoff_internal`
-- (112 — the per-player kickoff datum for a player's NFL team), `schedule_
-- window_internal` (111 — the week datum chain), `lineup_current_week_internal`
-- (112) and `is_league_member` (052) are CALLED by name, never copied.
--
-- WHAT THIS MIGRATION DOES
--   1. `transactions.action_id UUID` (+ the partial unique index
--      `uniq_transactions_league_action ON (league_id, action_id) WHERE
--      action_id IS NOT NULL`) — the IDEMPOTENCY STAMP for `roster_add_drop`
--      (the 099 `draft_budget_adjustments` shape, D68/E2). Why a stamp and
--      not a third ledger table (111 `schedule_actions`, 112 `lineup_actions`
--      — D307(2)): those verbs' domain rows are DELETED or OVERWRITTEN by
--      later actions, so a stamp would be erased and a stale retry would
--      re-execute; a `transactions` row is APPEND-ONLY (§12.9 — its status
--      may flip to `reversed` in M6, the row never goes away), so the stamp
--      survives every later action and the replay is exact: `payload` IS the
--      verb's returned document and is returned byte-identically. A refused
--      call raises inside the transaction and writes nothing — the next
--      attempt re-evaluates (correct: nothing was executed). Kind-scoped
--      (R732): a stored row with the same action_id but another `type` (an
--      M5 claim, a trade) or another team refuses BY NAME rather than
--      replaying a foreign result. Additive to §12.9's printed DDL; every
--      other writer (M5 claims/trades, M6 commissioner moves) may leave it
--      NULL or stamp its own.
--   2. `league_player_pool` gains the CHECK `pool_waivers_until_iff_on_waivers`
--      — `(state = 'on_waivers') = (waivers_until IS NOT NULL)`: F222(a)'s
--      L.D1.5 half TAKEN as the schema constraint (R704), two-sided because
--      §12.19's own comment says "NULL unless on_waivers": an `on_waivers`
--      row without a clearing instant is a player nobody can ever add, and a
--      `free_agent`/`rostered` row carrying one is a stale instant the
--      waiver index (`idx_pool_waivers` is partial on the state) would not
--      even see. 061 pins both directions one unit apart.
--   3. `pool_game_lock_internal(season, week, nfl_team, at, enforced)` — E32's per-week
--      evaluation: the player's kickoff for that week through 112's
--      `lineup_kickoff_internal` (a week WITH game rows and none for the
--      team = BYE, never locked; a week with NO game rows = the week datum
--      chain for EVERY player — the conservative R740 posture, inherited
--      and pinned; ON THE REAL CALENDAR THIS IS A FREEZE: with zero 2026
--      `nfl_games` rows every week's datum is its `starts_at`, so add/drop
--      is FROZEN for the whole season until L.D2.1's ingestion (or L.D3.1's
--      back-fill) writes game rows — the dated dependency is PROGRESS F228:
--      rows must exist before 2026-09-09 04:00Z or the cohort cannot add or
--      drop at all — R755) and the week's `nfl_weeks.correction_window_ends_at`
--      (D294's letter: THE week's window, §23.4's Thursday 06:00 ET default;
--      the per-league `stat_correction_window` setting is NOT read here —
--      F227(c) routes the question of the per-league window to the task
--      that first computes one, 114/L.D2.x, so add/drop and finalization
--      read the same instant). Locked iff kickoff ≤ at < window end — closed
--      AT the kickoff (the E41 convention), OPEN at the window close ("until
--      the week clears" is strictly before). A week whose window end is NULL
--      after the kickoff refuses BY NAME **when the caller ENFORCES the lock**
--      (loud: the lock end is undefined until ingestion writes it — never an
--      unbounded lock read as free). `p_enforced = FALSE` — the caller's
--      `player_game_lock` is off, so nothing it returns can refuse anything —
--      reports `locked = TRUE` with a NULL `window_ends_at` instead of
--      raising (R765): a league that turned the lock OFF must never be
--      refused by the lock's own plumbing, and the still-not-"free" reading
--      is the loud one.
--   4. `pool_game_lock_any_internal(season, current_week, nfl_team, at,
--      enforced)` —
--      the lock across EVERY NFL week that could still bind: weeks ≤ the
--      league's current week whose correction window has not closed at
--      `at` (typically the current week and the previous one — a week's
--      window closes Thursday 06:00 ET of the NEXT week, so Wednesday and
--      early Thursday belong to two windows). Rule 9: evaluated from
--      `nfl_games.kickoff_at` at call time, NEVER from
--      `league_player_pool.locked_until` (that column is 114's maintained
--      state for the pool VIEW — `lineup_lock_tick` refreshes it; 113 never
--      reads it and never writes it) and never from the pool `state`
--      (`locked_in_game` is 114's vocabulary; an add evaluates the games
--      table whatever the stored state says).
--   5. `roster_add_drop_internal(league, team, add, drop, action_id, at)` —
--      the body at an injected instant (the rule-10 seam, postgres-only), and
--      `roster_add_drop(league, team, add, drop, action_id)` — SECURITY
--      DEFINER, `search_path = ''`, in-body auth, REVOKE FROM PUBLIC/anon,
--      transaction `now()` (D307(3)/D308: a client-facing verb never takes a
--      caller-supplied instant — a manager could pick the free window).
--
-- THE VALIDATION CHAIN (D294, in this order — each refusal BY NAME):
--   (0) `p_action_id` required (22023); at least one of add/drop (22023);
--       add ≠ drop (22023).
--   (1) LOCK the LEAGUE row FIRST (rule 8 — the house lock order; the one
--       serialization point D294 names: two managers racing one FCFS add
--       queue here, the second re-reads the roster after the first commits
--       and refuses on exclusivity).
--   (2) AUTH in-body: the manager of THIS team via `league_members.team_id`
--       (F35 — never a stint). One no-leak 42501 for "no such league", "not
--       a member", "not this team's manager" — INCLUDING a commissioner
--       acting on another team: a commissioner roster move is M6's
--       `commissioner_move` (§12.9's type, §15.4's override RPCs; F227(d)),
--       not an arm of the manager's verb.
--   (3) REPLAY by (league_id, action_id): the stored `payload`,
--       byte-identically; kind- and team-scoped (R732).
--   (4) League `in_season` or `playoffs`; the team a live franchise of THIS
--       league; the league's current week from the calendar table
--       (`lineup_current_week_internal`).
--   (5) THE DROP: the player must be on THIS team's roster (on another team
--       / unowned each named). E32 DROP LOCK when `player_game_lock` is on
--       (default TRUE): refused from his kickoff until the week clears —
--       independently of the add side (the DoD probe removes this clause
--       alone). `fa_hold_hours`: a `free_agent` acquisition held less than
--       the hold returns to FREE AGENCY, not waivers (an early drop is
--       ALLOWED — §7.3.4's "earlier drops return the player to FA"); held
--       ≥ the hold ⇒ the normal waiver entry; hold 0 ⇒ never early.
--   (6) THE ADD: the player must exist; EXCLUSIVITY (business rule 7 /
--       §12.7): a player on ANY roster in the league refuses with a friendly
--       P0001 naming the team — never a raw 23505 (the unique index is kept
--       as an UNPINNABLE backstop: under the league-row lock in (1) a racing
--       second manager always reaches this pre-check, so the handler below
--       cannot be driven red — said per D276/R757); pool state:
--       `on_waivers` with `waivers_until` ahead refuses (claims are M5's);
--       a LAPSED `waivers_until` is FCFS-addable under BOTH `free_agency`
--       values (Q33's M4 interim, below); a
--       `rostered` pool row with NO roster row is a broken mirror and refuses
--       loudly naming reconciliation (D294: asserted, not trusted — never
--       silently healed); E32 ADD LOCK when `player_game_lock` is on;
--       CAPACITY: the roster after the move must fit `roster_size` (§7.3.2:
--       Σ starting counts + bench + IR spots); CAPS: `acquisitions_per_week`
--       / `acquisitions_per_season` counted from `transactions` — a row
--       counts iff it is this team's, `status = 'complete'`, and its payload
--       carries `add_player_id` (an add-only or add+drop move; drop-only
--       never counts; M5's claim rows carry the same key — F227(a)); the
--       weekly count is scoped to `week = current`, the season count to the
--       league (a league is one season). BOTH counts are taken BEFORE step
--       (5) (R763) because the result reports them on EVERY move — a
--       drop-only call reported NULL to a capped league before the hoist,
--       which L.D4.2 would have rendered as "null of 3"; only the ADD side
--       enforces them.
--   (7) WRITES, one transaction: `league_rosters` DELETE (count asserted) /
--       INSERT (`slot_key = 'bn'`, `acquisition_type = 'free_agent'`,
--       `acquired_at = at`); the pool rows (lazy — created on first
--       transition, D294): the dropped player → `on_waivers` with
--       `waivers_until = at + waiver_period_hours` (`waiver_type =
--       none_fcfs` ⇒ `free_agent`, and the fa_hold early drop ⇒
--       `free_agent`), the added player → `rostered`; the lineup consequences
--       (below — the dropped player's slot always cleared, Q32); the `transactions` row (`type = 'add_drop'` — §13.1's
--       letter for this verb, whatever the shape; `payload` = the result
--       document; `week` = the current week; `action_id` = the stamp).
--   (8) POST-WRITE ASSERTIONS (R703-class, in-body): the added player has
--       exactly one roster row in the league and it is this team's; the
--       dropped player has none; the team's roster count ≤ roster_size; the
--       pool MIRROR for both touched players matches the roster truth
--       (`rostered` ⇔ a roster row exists) — D294's "asserted, not trusted".
--
-- `free_agency` — RULED, Q33 (Chris, 2026-09-03; PROGRESS §3 Q33, F229).
--   Chris described two real leagues neither `free_agency` nor
--   `waiver_period_hours` can express (daily waivers at a fixed local clock
--   with a Sunday-06:00-PT → Monday-night FA window; weekly Tuesday-midnight
--   waivers then FA all week; "re-waiver if no valid claim") and asked for a
--   separate waiver-settings investigation — F229, an Architect docs task
--   before M5's waivers build. THE M4 INTERIM (ruled by the orchestrator
--   under his direction): a lapsed `waivers_until` is FCFS-addable under
--   BOTH values (the §7.3.4 note's letter, "Unclaimed players become FCFS" —
--   the never-strand direction); `on_waivers` with `waivers_until` ahead
--   refuses (claims are M5's); a player with NO pool row is addable under
--   both values; the pool vocabulary is unchanged. 061 pins lapse −1s
--   refuses / AT adds under BOTH values.
--
-- THE LINEUP INTERPLAY (§11.2 × §13.1; F224(i)) — RULED, Q32 (Chris,
--   2026-09-03, verbatim): "a user can drop a player as long as that player
--   hasn't locked. for example, if its mid day sunday and all the users
--   starters are locked due to games starting but they have a player on
--   their Bench that doesn't play until Monday night, that player can be
--   dropped." Applied: droppability keys on the PLAYER's OWN kickoff (E32's
--   window), never on his lineup slot's lock state or the lineup-lock mode —
--   a player whose game has kicked off cannot be dropped until the week
--   clears; a player whose game has not started can be dropped even when
--   the rest of the lineup is locked (114 / Q34(A): `per_player_kickoff` is
--   the ONLY lineup lock — the whole-week mode is retired). Consequences:
--   there is NO kept-phantom branch (a
--   droppable player has not played, so nothing to keep — the #254
--   reviewer's R753 bypass-by-composition cannot arise); a dropped player's
--   `slot_map` entry is ALWAYS cleared from every `team_lineups` row of the
--   team from the current week on (the slot reads empty, `starters[]`
--   emptied, bench trimmed); 112's rule lets a player whose own kickoff
--   is ahead take the empty slot (114 retired the whole-week arm under
--   which an emptied slot stayed empty — 061 §H1 is re-cut to the
--   per-player composition); E34 stays M5's `bench_lock`-off
--   claim-processing path. RESIDUAL, recorded not asked (D309(3), the D220
--   shape for Chris's read): with `player_game_lock = OFF` §7.3.4/§13.1's
--   letter is lax incumbent behaviour — a PLAYED player may be dropped and
--   his slot CLEARS, and (R759, measured; 114: the only mode now) the very next
--   `set_lineup` MAY RE-SEAT the emptied slot with a player whose own
--   kickoff is still ahead (112 has nothing to lock once the stored
--   occupant is gone — 112:894), so the team loses the played player's
--   points AND gets a fresh choice for that slot after seeing his result.
--   That composition is pinned in 061 §H3 — it is the ACTUAL behaviour of
--   `player_game_lock = false` × `per_player_kickoff`, not an empty slot.
--   The ruling was given for the on-by-default case; whether the
--   player-level lock should bind drops REGARDLESS of the toggle (one
--   clause: `v_game_lock AND` → unconditional) was Chris's product call —
--   RULED 2026-09-05 (PROGRESS §3 Q34(B): the drop lock binds on the
--   player's own kickoff regardless of the toggle; release at the week's
--   `last_game_ends_at`) and BUILT by L.D1.5c, not here (Q35 holds the
--   add-half question). Q34(A) (the mode) is APPLIED by migration 114.
--   An added player lands on the bench of every row
--   from the current week on with `slot_key = 'bn'`; a bench-only drop
--   reports its rows with `slot: null` (R758). A drop of a player on a
--   RESTRICTED IR spot succeeds: §7.3.2's stint binds "moving a player OUT
--   of" the spot into the active roster, and a release is not a move
--   (pinned).
--
-- IDEMPOTENCY / LOUD EMPTINESS (rule 10): `p_action_id` REQUIRED; replay
--   byte-identical with zero writes; every DELETE/INSERT/UPDATE row count
--   asserted; a player not on the roster, an unknown player, a foreign team,
--   a retired team, a league not in season, a league with no calendar, both
--   sides empty, add = drop — each refused BY NAME.
--
-- Falsifiability (rule 9 / §4.3): pgTAP 061 pins E32 at kickoff−1s / AT /
-- +1s and at window-close−1s / AT / +1s for BOTH the add and the drop (D146
-- one-unit pairs, the datum moved inside the frozen txn — D307(3)); the lax
-- control (`player_game_lock = false`: both sides live inside the window);
-- E42 (a kickoff moved ahead re-opens the add); bye (never locked) and the
-- no-game-rows week (locked for everyone from the datum, arm named — R740);
-- exclusivity from both teams' sides; the same-league re-add honoring
-- waiver state at `waivers_until` −1s / AT (lapsed) under both `free_agency`
-- values; `none_fcfs`; fa_hold at hold−1s (FA) / +0 (waivers); caps at cap−1
-- (lives) / at cap (refuses) for week and season AND the drop-only `caps`
-- document as a literal (R763 — the counts a drop-only reports); the
-- `transactions` row as
-- a stored literal; replay byte-identity + kind/team scoping; the lineup
-- consequences (a dropped starter always leaves the current-week map; the Q32
-- example — Sunday midday, every starter kicked off, a bench player with a
-- Monday game drops and refuses once his game kicks off, a kicked-off
-- STARTER refuses by name; the composition cell — a drop followed by a
-- set_lineup on the same row never re-seats a whole-week-locked slot and
-- leaves no phantom; BOTH lax compositions — §H1 (L2, re-cut by 114 to the
-- only mode: the emptied slot re-seats only with an unstarted player) and §H3 (L5; R759: the baseline
-- re-seat is refused, the played starter drops, the slot clears, and the
-- next set_lineup DOES re-seat it); the add lands on the bench with `bn`);
-- the NULL-window arm both ways (R765: the enforcing league refuses by name,
-- the lock-off league adds and drops and reads `locked: true` with a NULL
-- window end); every
-- role; the CHECK both directions; F35 structurally; the held lock < 50 ms.
-- Break probe (PR body): the drop-side E32 clause removed → the drop-lock
-- cells red while the add-lock cells stay green.
--
-- Migration checklist (plan §8.1): additive (one column + one index + one
-- CHECK + four functions; no column dropped, no row rewritten — the CHECK is
-- satisfied vacuously by an empty table on every chain-built DB and by
-- construction on any 109-shaped row that followed §12.19's comment);
-- `IF NOT EXISTS` on the ADD COLUMN; staging-clone rehearsal disposed via
-- the R6 rule (fresh local `db reset` 001–113 is the recorded rehearsal);
-- realtime: NO trigger here — D296 lands the `transactions` INSERT trigger
-- in 117 with the activity feed's subscriber (the D38 dated disposition);
-- typegen + alias-block re-append in the same PR; grants doctrine
-- (D18→D23): no per-object GRANT on any table — RLS is the gate (the three
-- tables keep 109/072's member SELECT and NO client write policy); REVOKE on
-- every function.
--
-- HELD-FROM-PRODUCTION: this migration is registered (range → 082-113) in
-- the same PR. No launch-surface table is touched: `transactions` and
-- `league_player_pool` are 109's, `league_rosters` 072's, `team_lineups`
-- 001's-but-league-only (112's measurement); the only reads outside the
-- leagues chain are SELECTs on `players`, `nfl_games`, `nfl_weeks`, `teams`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. transactions.action_id — the idempotency stamp (banner §1)
-- ---------------------------------------------------------------------------
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS action_id UUID;   -- client-minted; dedupes retries of the executing verb (D68/E2); NULL for writers that stamp nothing

CREATE UNIQUE INDEX IF NOT EXISTS uniq_transactions_league_action
  ON transactions(league_id, action_id)
  WHERE action_id IS NOT NULL;

COMMENT ON COLUMN transactions.action_id IS
  'Idempotency key of the executing verb (113 roster_add_drop stamps it; the replay returns payload byte-identically). Kind-scoped: a replay checks type + initiator_team_id. NULL when the writer stamps nothing.';

-- ---------------------------------------------------------------------------
-- 2. league_player_pool — F222(a) taken as the CHECK (two-sided, §12.19's
--    "NULL unless on_waivers")
-- ---------------------------------------------------------------------------
ALTER TABLE league_player_pool
  ADD CONSTRAINT pool_waivers_until_iff_on_waivers
  CHECK ((state = 'on_waivers') = (waivers_until IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 3. pool_game_lock_internal — E32 for ONE week (banner §3)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pool_game_lock_internal(
  p_season   INTEGER,
  p_week     INTEGER,
  p_nfl_team TEXT,
  p_at       TIMESTAMPTZ,
  p_enforced BOOLEAN DEFAULT TRUE   -- R765: FALSE = the caller does not enforce this lock (player_game_lock off), so an undefined window END is reported, never raised
) RETURNS TABLE (
  locked          BOOLEAN,
  kickoff_at      TIMESTAMPTZ,
  window_ends_at  TIMESTAMPTZ,
  datum_arm       TEXT,
  on_bye          BOOLEAN
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_k RECORD;
BEGIN
  SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, p_nfl_team, p_at);
  kickoff_at := v_k.kickoff_at;
  datum_arm  := v_k.datum_arm;
  on_bye     := v_k.on_bye;
  SELECT w.correction_window_ends_at INTO window_ends_at
  FROM public.nfl_weeks w
  WHERE w.season = p_season AND w.week = p_week;

  IF kickoff_at IS NULL OR kickoff_at > p_at THEN
    locked := FALSE;                     -- bye, or the kickoff is still ahead
  ELSIF window_ends_at IS NULL THEN
    -- R765: the raise belongs to the ENFORCING caller only. A league that has
    -- turned `player_game_lock` off never refuses on this lock, so an
    -- unwritten window must not turn into a refusal there; the document it
    -- reads is informational, and `locked = TRUE` with `window_ends_at NULL`
    -- IS the loud reading ("he has kicked off; the end is not written yet").
    -- Never read as free in either arm.
    IF p_enforced THEN
      RAISE EXCEPTION
        'pool_game_lock_internal: % kicked off for week % of season % at % (%) but nfl_weeks.correction_window_ends_at is NULL — the E32 lock end is undefined until ingestion writes it (§23.4/§12.20); refusing rather than reading an unbounded lock as free',
        p_nfl_team, p_week, p_season, kickoff_at, datum_arm
        USING ERRCODE = 'P0001';
    END IF;
    locked := TRUE;
  ELSE
    locked := p_at < window_ends_at;     -- closed AT the kickoff, OPEN at the window close
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION pool_game_lock_internal(INTEGER, INTEGER, TEXT, TIMESTAMPTZ, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. pool_game_lock_any_internal — every week that could still bind (banner §4)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pool_game_lock_any_internal(
  p_season       INTEGER,
  p_current_week INTEGER,
  p_nfl_team     TEXT,
  p_at           TIMESTAMPTZ,
  p_enforced     BOOLEAN DEFAULT TRUE   -- R765: passed straight through to the per-week evaluation
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_w    RECORD;
  v_lock RECORD;
  v_last JSONB := NULL;
BEGIN
  -- Candidate weeks: on the calendar, not ahead of the current week, window
  -- not yet closed (or unknown). Newest first so the current week's datum
  -- is what an unlocked result reports.
  FOR v_w IN
    SELECT w.week
    FROM public.nfl_weeks w
    WHERE w.season = p_season
      AND w.week <= p_current_week
      AND (w.correction_window_ends_at IS NULL OR w.correction_window_ends_at > p_at)
    ORDER BY w.week DESC
  LOOP
    SELECT * INTO v_lock FROM public.pool_game_lock_internal(p_season, v_w.week, p_nfl_team, p_at, p_enforced);
    IF v_lock.locked THEN
      RETURN jsonb_build_object(
        'locked', TRUE, 'week', v_w.week, 'kickoff_at', v_lock.kickoff_at,
        'window_ends_at', v_lock.window_ends_at, 'datum_arm', v_lock.datum_arm, 'on_bye', v_lock.on_bye);
    END IF;
    IF v_last IS NULL THEN
      v_last := jsonb_build_object(
        'locked', FALSE, 'week', v_w.week, 'kickoff_at', v_lock.kickoff_at,
        'window_ends_at', v_lock.window_ends_at, 'datum_arm', v_lock.datum_arm, 'on_bye', v_lock.on_bye);
    END IF;
  END LOOP;
  RETURN COALESCE(v_last, jsonb_build_object(
    'locked', FALSE, 'week', p_current_week, 'kickoff_at', NULL, 'window_ends_at', NULL,
    'datum_arm', 'no_open_window', 'on_bye', FALSE));
END;
$$;
REVOKE EXECUTE ON FUNCTION pool_game_lock_any_internal(INTEGER, INTEGER, TEXT, TIMESTAMPTZ, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. roster_add_drop_internal — the body, at an injected instant (the seam)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roster_add_drop_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_add       TEXT,
  p_drop      TEXT,
  p_action_id UUID,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league        public.leagues;
  v_team          public.teams;
  v_txn           public.transactions;
  v_found         BOOLEAN;
  v_is_manager    BOOLEAN;
  v_current       INTEGER;
  v_mode          TEXT;
  v_game_lock     BOOLEAN;
  v_waiver_type   TEXT;
  v_period_hours  INTEGER;
  v_free_agency   TEXT;
  v_cap_week_txt  TEXT;
  v_cap_season_txt TEXT;
  v_cap_week      INTEGER;    -- NULL = unlimited
  v_cap_season    INTEGER;    -- NULL = unlimited
  v_hold_hours    INTEGER;
  v_roster_size   INTEGER;
  v_roster_count  INTEGER;
  v_after_count   INTEGER;
  v_used_week     INTEGER;
  v_used_season   INTEGER;
  v_drop_row      public.league_rosters;
  v_drop_p        public.players;
  v_add_p         public.players;
  v_owner_team    public.teams;
  v_pool          public.league_player_pool;
  v_pool_add_from TEXT;
  v_drop_to_state TEXT;
  v_drop_until    TIMESTAMPTZ;
  v_hold_early    BOOLEAN := FALSE;
  v_drop_lock     JSONB;
  v_add_lock      JSONB;
  v_txn_id        UUID := gen_random_uuid();
  v_result        JSONB;
  v_lineups       JSONB := '[]'::jsonb;
  v_row           public.team_lineups;
  v_map           JSONB;
  v_key           TEXT;
  v_locked        BOOLEAN;
  v_window        RECORD;
  v_k             RECORD;
  v_starters      JSONB;
  v_bench         JSONB;
  v_cnt           INTEGER;
  v_changed       BOOLEAN;
BEGIN
  -- (0) shape
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'roster_add_drop: p_action_id is required (idempotency key — one UUID per move, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_add IS NULL AND p_drop IS NULL THEN
    RAISE EXCEPTION 'roster_add_drop: nothing to do — give a player to add, a player to drop, or both (§13.1)'
      USING ERRCODE = '22023';
  END IF;
  IF p_add IS NOT NULL AND p_add = p_drop THEN
    RAISE EXCEPTION 'roster_add_drop: add and drop name the same player (%) — a move changes the roster (§13.1)', p_add
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (rule 8; D294's one serialization point).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) AUTH, in-body (F35): the manager of THIS team, never a stint. One
  --     no-leak 42501; a commissioner acting on another team is refused the
  --     same way (his roster move is M6's commissioner_move — banner §(2)).
  v_found := FOUND;
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  IF NOT v_found OR NOT v_is_manager THEN
    RAISE EXCEPTION 'roster_add_drop: not the manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2; kind- and team-scoped — R732).
  SELECT t.* INTO v_txn
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.action_id = p_action_id;
  IF FOUND THEN
    IF v_txn.type <> 'add_drop' THEN
      RAISE EXCEPTION
        'roster_add_drop: action_id % already names a % transaction in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_txn.type
        USING ERRCODE = 'P0001';
    END IF;
    IF v_txn.initiator_team_id IS DISTINCT FROM p_team_id THEN
      RAISE EXCEPTION
        'roster_add_drop: action_id % belongs to another team''s move in this league — an action_id identifies ONE submit (R732)',
        p_action_id
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_txn.payload;
  END IF;

  -- (4) league / team / calendar
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'roster_add_drop: league % is % — rosters change through add/drop only while in_season or in playoffs (§13.1)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'roster_add_drop: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'roster_add_drop: team % is retired — a sealed franchise makes no moves (§7.2.1)', p_team_id
      USING ERRCODE = 'P0001';
  END IF;
  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'roster_add_drop: league % has no league_weeks rows — no season calendar to evaluate locks and caps against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- settings (§7.3.4; typed column for waiver_type + lineup_lock, the blob for the rest)
  v_mode         := COALESCE(v_league.lineup_lock, 'per_player_kickoff');
  v_game_lock    := COALESCE((v_league.settings ->> 'player_game_lock')::boolean, TRUE);
  v_waiver_type  := COALESCE(v_league.waiver_type, 'faab');
  v_period_hours := COALESCE((v_league.settings ->> 'waiver_period_hours')::int, 48);
  v_free_agency  := COALESCE(v_league.settings ->> 'free_agency', 'immediate_after_waivers');
  v_hold_hours   := COALESCE((v_league.settings ->> 'fa_hold_hours')::int, 0);
  v_cap_week_txt   := COALESCE(v_league.settings ->> 'acquisitions_per_week', 'unlimited');
  v_cap_season_txt := COALESCE(v_league.settings ->> 'acquisitions_per_season', 'unlimited');
  v_cap_week   := CASE WHEN v_cap_week_txt   = 'unlimited' THEN NULL ELSE v_cap_week_txt::int   END;
  v_cap_season := CASE WHEN v_cap_season_txt = 'unlimited' THEN NULL ELSE v_cap_season_txt::int END;
  SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') s), 0)
       + COALESCE((v_league.roster_settings ->> 'bench')::int, 0)
       + COALESCE(jsonb_array_length(v_league.roster_settings -> 'ir_slots'), 0)
  INTO v_roster_size;
  SELECT count(*)::int INTO v_roster_count
  FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = p_team_id;

  -- CAPS, COUNTED BEFORE EITHER SIDE (§7.3.4; R763): this team's `complete`
  -- rows whose payload carries `add_player_id` (a drop-only move never counts
  -- — it is not an acquisition). These run here rather than inside the add
  -- branch because the RESULT reports `caps.used_week_after` /
  -- `used_season_after` on EVERY move: a drop-only call read them unassigned
  -- and reported NULL to a capped league, which L.D4.2 would render as
  -- "null of 3" (F227(f)). The enforcement below is still the add side's
  -- alone.
  SELECT count(*)::int INTO v_used_week
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = p_team_id
    AND t.status = 'complete' AND t.week = v_current
    AND (t.payload ->> 'add_player_id') IS NOT NULL;
  SELECT count(*)::int INTO v_used_season
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = p_team_id
    AND t.status = 'complete'
    AND (t.payload ->> 'add_player_id') IS NOT NULL;

  -- (5) THE DROP
  IF p_drop IS NOT NULL THEN
    SELECT p.* INTO v_drop_p FROM public.players p WHERE p.id = p_drop;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'roster_add_drop: no player with id % (drop)', p_drop USING ERRCODE = 'P0001';
    END IF;
    SELECT r.* INTO v_drop_row
    FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.player_id = p_drop;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'roster_add_drop: % (%) is not on %''s roster — nobody in league % rosters him (§13.1)',
        v_drop_p.full_name, p_drop, v_team.name, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_drop_row.team_id <> p_team_id THEN
      SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_drop_row.team_id;
      RAISE EXCEPTION 'roster_add_drop: % (%) is on %''s roster, not %''s — a manager drops only his own players (§13.1)',
        v_drop_p.full_name, p_drop, v_owner_team.name, v_team.name
        USING ERRCODE = 'P0001';
    END IF;
    -- E32, the DROP side (independent of the add side — the DoD probe).
    v_drop_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_drop_p.team, p_at, v_game_lock);
    IF v_game_lock AND (v_drop_lock ->> 'locked')::boolean THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is locked for drops — kicked off at % (%) and week % clears at % (the correction window, §13.1/E32; player_game_lock = true): no dropping a player mid-game',
        v_drop_p.full_name, p_drop, v_drop_lock ->> 'kickoff_at', v_drop_lock ->> 'datum_arm',
        v_drop_lock ->> 'week', v_drop_lock ->> 'window_ends_at'
        USING ERRCODE = 'P0001';
    END IF;
    -- fa_hold_hours (§7.3.4): an early drop of a free-agent add returns him
    -- to FA, not waivers. held ≥ hold ⇒ waivers (the boundary is inclusive).
    v_hold_early := v_drop_row.acquisition_type = 'free_agent'
                    AND v_hold_hours > 0
                    AND v_drop_row.acquired_at IS NOT NULL
                    AND p_at < v_drop_row.acquired_at + make_interval(hours => v_hold_hours);
    IF v_hold_early OR v_waiver_type = 'none_fcfs' THEN
      v_drop_to_state := 'free_agent';
      v_drop_until := NULL;
    ELSE
      v_drop_to_state := 'on_waivers';
      v_drop_until := p_at + make_interval(hours => v_period_hours);
    END IF;
  END IF;

  -- (6) THE ADD
  IF p_add IS NOT NULL THEN
    SELECT p.* INTO v_add_p FROM public.players p WHERE p.id = p_add;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'roster_add_drop: no player with id % (add)', p_add USING ERRCODE = 'P0001';
    END IF;
    -- EXCLUSIVITY (business rule 7 / §12.7) — friendly, never a raw 23505.
    SELECT t.* INTO v_owner_team
    FROM public.league_rosters r JOIN public.teams t ON t.id = r.team_id
    WHERE r.league_id = p_league_id AND r.player_id = p_add;
    IF FOUND THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is already on %''s roster in this league — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7)',
        v_add_p.full_name, p_add, v_owner_team.name
        USING ERRCODE = 'P0001';
    END IF;
    -- POOL STATE (lazy rows: no row = free_agent, D294).
    SELECT pp.* INTO v_pool FROM public.league_player_pool pp
    WHERE pp.league_id = p_league_id AND pp.player_id = p_add;
    IF NOT FOUND THEN
      v_pool_add_from := 'free_agent';
    ELSIF v_pool.state = 'on_waivers' THEN
      IF v_pool.waivers_until > p_at THEN
        RAISE EXCEPTION
          'roster_add_drop: % (%) is on waivers until % — waiver claims are M5''s; he is FCFS-addable once the period lapses (free_agency = %, §7.3.4/§13.1)',
          v_add_p.full_name, p_add, v_pool.waivers_until, v_free_agency
          USING ERRCODE = 'P0001';
      END IF;
      -- Q33 (Chris, 2026-09-03; the M4 interim ruled under his direction —
      -- PROGRESS §3 Q33, F229): a lapsed waivers_until is FCFS-addable under
      -- BOTH free_agency values (the §7.3.4 note's letter — "Unclaimed players
      -- become FCFS"), until the waiver-scheduling investigation redesigns
      -- the settings. No claim-only arm exists here.
      v_pool_add_from := 'on_waivers_lapsed';
    ELSIF v_pool.state = 'rostered' THEN
      -- No roster row (checked above) but a rostered pool row: the mirror is
      -- broken — asserted, not trusted (D294); reconciliation (L.D2.3) fixes.
      RAISE EXCEPTION
        'roster_add_drop: league_player_pool says % (%) is rostered in league % but league_rosters has no row — the pool mirror is broken; refusing until reconciliation (L.D2.3) repairs it (D294)',
        v_add_p.full_name, p_add, p_league_id
        USING ERRCODE = 'P0001';
    ELSE
      -- free_agent, or 114's locked_in_game (the games table decides below —
      -- never the stored state, rule 9).
      v_pool_add_from := v_pool.state;
    END IF;
    -- E32, the ADD side.
    v_add_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_add_p.team, p_at, v_game_lock);
    IF v_game_lock AND (v_add_lock ->> 'locked')::boolean THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is locked for adds — kicked off at % (%) and week % clears at % (the correction window, §13.1/E32; player_game_lock = true): no in-game pickups',
        v_add_p.full_name, p_add, v_add_lock ->> 'kickoff_at', v_add_lock ->> 'datum_arm',
        v_add_lock ->> 'week', v_add_lock ->> 'window_ends_at'
        USING ERRCODE = 'P0001';
    END IF;
    -- CAPACITY (§7.3.2 roster_size; §13.1 "drop one to stay within roster_size").
    v_after_count := v_roster_count + 1 - CASE WHEN p_drop IS NOT NULL THEN 1 ELSE 0 END;
    IF v_after_count > v_roster_size THEN
      RAISE EXCEPTION
        'roster_add_drop: %''s roster is full (% of % — §7.3.2 roster_size) — include a drop in the same move (§13.1)',
        v_team.name, v_roster_count, v_roster_size
        USING ERRCODE = 'P0001';
    END IF;
    -- CAPS (§7.3.4) — the counts were taken above (R763); only the ADD side
    -- enforces them.
    IF v_cap_week IS NOT NULL AND v_used_week >= v_cap_week THEN
      RAISE EXCEPTION
        'roster_add_drop: % has used % of % acquisitions in week % (acquisitions_per_week, §7.3.4) — no more adds this week',
        v_team.name, v_used_week, v_cap_week, v_current
        USING ERRCODE = 'P0001';
    END IF;
    IF v_cap_season IS NOT NULL AND v_used_season >= v_cap_season THEN
      RAISE EXCEPTION
        'roster_add_drop: % has used % of % acquisitions this season (acquisitions_per_season, §7.3.4) — no more adds this season',
        v_team.name, v_used_season, v_cap_season
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_after_count := v_roster_count - 1;
  END IF;

  -- (7) WRITES
  IF p_drop IS NOT NULL THEN
    DELETE FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = p_drop;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'roster_add_drop: the drop of % deleted % roster rows, expected 1', p_drop, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
    VALUES (p_league_id, p_drop, v_drop_to_state, v_drop_until, p_at)
    ON CONFLICT (league_id, player_id) DO UPDATE
      SET state = EXCLUDED.state, waivers_until = EXCLUDED.waivers_until, updated_at = EXCLUDED.updated_at;
  END IF;

  IF p_add IS NOT NULL THEN
    BEGIN
      INSERT INTO public.league_rosters
        (league_id, team_id, player_id, slot_key, acquisition_type, acquisition_cost, acquired_at)
      VALUES (p_league_id, p_team_id, p_add, 'bn', 'free_agent', 0, p_at);
    EXCEPTION WHEN unique_violation THEN
      -- 072's UNIQUE, kept as an UNPINNABLE backstop (R757/D276): the league
      -- row lock in (1) serializes every racer behind the exclusivity
      -- pre-check, so this branch is unreachable in practice — it exists so
      -- a raw 23505 can never reach the wire if that lock is ever weakened.
      RAISE EXCEPTION
        'roster_add_drop: % (%) was rostered by another team in this league a moment ago — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7)',
        v_add_p.full_name, p_add
        USING ERRCODE = 'P0001';
    END;
    INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
    VALUES (p_league_id, p_add, 'rostered', NULL, p_at)
    ON CONFLICT (league_id, player_id) DO UPDATE
      SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
  END IF;

  -- THE LINEUP CONSEQUENCES (banner: THE LINEUP INTERPLAY; F224(i)) — every
  -- row of this team from the current week on.
  FOR v_row IN
    SELECT tl.* FROM public.team_lineups tl
    WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week >= v_current
    ORDER BY tl.week
    FOR UPDATE
  LOOP
    v_map := COALESCE(v_row.slot_map, '{}'::jsonb);
    v_starters := COALESCE(v_row.starters, '[]'::jsonb);
    v_bench := COALESCE(v_row.bench, '[]'::jsonb);
    v_changed := FALSE;
    IF p_drop IS NOT NULL THEN
      SELECT e.key INTO v_key FROM jsonb_each_text(v_map) e WHERE e.value = p_drop LIMIT 1;
      IF v_key IS NOT NULL THEN
        -- Q32 (Chris, 2026-09-03): droppability keys on the PLAYER's own
        -- kickoff (E32), never on his slot's lock state — so a droppable
        -- player has not played and there is nothing to keep: the entry is
        -- ALWAYS cleared (the slot reads empty; 112 lets a player whose own
        -- kickoff is ahead take the empty slot — 114 retired the whole-week
        -- lock, so that is the only rule).
        -- IR keys are roster-level spots — cleared the same way.
        v_map := v_map - v_key;
        SELECT COALESCE(jsonb_agg(
                 CASE WHEN s ->> 'slot' = v_key
                      THEN s || jsonb_build_object('player_id', NULL, 'position', NULL, 'kickoff_at', NULL, 'flags', '["empty"]'::jsonb)
                      ELSE s END ORDER BY ord), '[]'::jsonb)
        INTO v_starters
        FROM jsonb_array_elements(v_starters) WITH ORDINALITY AS t(s, ord);
        v_lineups := v_lineups || jsonb_build_object('week', v_row.week, 'slot', v_key);
        v_changed := TRUE;
      END IF;
      IF v_bench ? p_drop THEN
        SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
        FROM jsonb_array_elements(v_bench) x WHERE (x #>> '{}') <> p_drop;
        -- R758: a bench-only drop reports its row too (slot NULL) — the
        -- result never under-reports which lineup rows the move touched.
        IF v_key IS NULL THEN
          v_lineups := v_lineups || jsonb_build_object('week', v_row.week, 'slot', NULL);
        END IF;
        v_changed := TRUE;
      END IF;
    END IF;
    IF p_add IS NOT NULL AND NOT (v_bench ? p_add) THEN
      SELECT COALESCE(jsonb_agg(x ORDER BY x #>> '{}'), '[]'::jsonb) INTO v_bench
      FROM jsonb_array_elements(v_bench || to_jsonb(p_add)) x;
      v_changed := TRUE;
    END IF;
    IF v_changed THEN
      UPDATE public.team_lineups SET slot_map = v_map, starters = v_starters, bench = v_bench
      WHERE id = v_row.id;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'roster_add_drop: lineup sync for week % touched % rows, expected 1', v_row.week, v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  -- (8) POST-WRITE ASSERTIONS (R703-class; D294's mirror asserted).
  IF p_add IS NOT NULL THEN
    IF (SELECT count(*) FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = p_add) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = p_add) THEN
      RAISE EXCEPTION 'roster_add_drop: after the add, % is not exactly once on %''s roster in league % — refusing', p_add, v_team.name, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT pp.state FROM public.league_player_pool pp WHERE pp.league_id = p_league_id AND pp.player_id = p_add) IS DISTINCT FROM 'rostered' THEN
      RAISE EXCEPTION 'roster_add_drop: the pool mirror for % is not rostered after the add (D294) — refusing', p_add
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF p_drop IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = p_drop) THEN
      RAISE EXCEPTION 'roster_add_drop: after the drop, % is still rostered in league % — refusing', p_drop, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT pp.state FROM public.league_player_pool pp WHERE pp.league_id = p_league_id AND pp.player_id = p_drop) IS DISTINCT FROM v_drop_to_state THEN
      RAISE EXCEPTION 'roster_add_drop: the pool mirror for % is not % after the drop (D294) — refusing', p_drop, v_drop_to_state
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  SELECT count(*)::int INTO v_cnt
  FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  IF v_cnt <> v_after_count OR v_cnt > v_roster_size THEN
    RAISE EXCEPTION 'roster_add_drop: %''s roster holds % players after the move, expected % (roster_size %) — refusing',
      v_team.name, v_cnt, v_after_count, v_roster_size
      USING ERRCODE = 'P0001';
  END IF;

  -- THE RESULT = the transactions payload (returned byte-identically on replay).
  v_result := jsonb_build_object(
    'transaction_id',        v_txn_id,
    'action_id',             p_action_id,
    'league_id',             p_league_id,
    'team_id',               p_team_id,
    'season',                v_league.season,
    'week',                  v_current,
    'type',                  'add_drop',
    'add_player_id',         p_add,
    'drop_player_id',        p_drop,
    'add', CASE WHEN p_add IS NULL THEN NULL ELSE jsonb_build_object(
      'player_id',        p_add,
      'name',             v_add_p.full_name,
      'position',         v_add_p.position,
      'nfl_team',         v_add_p.team,
      'from_state',       v_pool_add_from,
      'to_state',         'rostered',
      'acquisition_type', 'free_agent',
      'slot_key',         'bn',
      'acquired_at',      p_at,
      'game_lock',        v_add_lock) END,
    'drop', CASE WHEN p_drop IS NULL THEN NULL ELSE jsonb_build_object(
      'player_id',        p_drop,
      'name',             v_drop_p.full_name,
      'position',         v_drop_p.position,
      'nfl_team',         v_drop_p.team,
      'from_slot_key',    v_drop_row.slot_key,
      'to_state',         v_drop_to_state,
      'waivers_until',    v_drop_until,
      'fa_hold', jsonb_build_object(
        'hours',            v_hold_hours,
        'acquisition_type', v_drop_row.acquisition_type,
        'acquired_at',      v_drop_row.acquired_at,
        'early',            v_hold_early),
      'lineups',          v_lineups,
      'game_lock',        v_drop_lock) END,
    'roster', jsonb_build_object(
      'count_after', v_after_count,
      'roster_size', v_roster_size),
    'caps', jsonb_build_object(
      'acquisitions_per_week',   v_cap_week_txt,
      'acquisitions_per_season', v_cap_season_txt,
      -- both counts are assigned for EVERY move (R763) — a drop-only reports
      -- the unchanged totals, never NULL.
      'used_week_after',   v_used_week   + CASE WHEN p_add IS NULL THEN 0 ELSE 1 END,
      'used_season_after', v_used_season + CASE WHEN p_add IS NULL THEN 0 ELSE 1 END),
    'settings', jsonb_build_object(
      'player_game_lock',    v_game_lock,
      'lineup_lock',         v_mode,
      'waiver_type',         v_waiver_type,
      'waiver_period_hours', v_period_hours,
      'free_agency',         v_free_agency,
      'fa_hold_hours',       v_hold_hours),
    'evaluated_at',          p_at
  );

  INSERT INTO public.transactions (id, league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id)
  VALUES (v_txn_id, p_league_id, 'add_drop', 'complete', p_team_id, auth.uid(), v_result, v_current, p_action_id);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION roster_add_drop_internal(UUID, UUID, TEXT, TEXT, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. roster_add_drop — the client-facing verb: transaction now(), never a
--    caller-supplied instant (D307(3)); SECURITY DEFINER; in-body auth is the
--    internal body's step (2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roster_add_drop(
  p_league_id UUID,
  p_team_id   UUID,
  p_add       TEXT DEFAULT NULL,   -- the player to add (FCFS free agent / lapsed waivers)
  p_drop      TEXT DEFAULT NULL,   -- the player to drop (this team's)
  p_action_id UUID DEFAULT NULL    -- REQUIRED in-body (22023); DEFAULT NULL only so the sketch's order is kept
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.roster_add_drop_internal(p_league_id, p_team_id, p_add, p_drop, p_action_id, now());
END;
$$;
REVOKE EXECUTE ON FUNCTION roster_add_drop(UUID, UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon;
