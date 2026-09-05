-- ============================================================================
-- The game-day lock is a RULE — migration 115 (task L.D1.5c, the Q34(B) +
-- Q35 application; spec v2.16.20 → v2.16.21 by this PR's fold-back — §7.3.4
-- `player_game_lock` row RETIRED / §13.1 game-day locks / §12.19 comment /
-- §14 lineup-lock row / §16 free-agents note / E32 / E34; PROGRESS §3 Q34(B)
-- RULED by Chris 2026-09-05 + Q35 RULED (a) by Chris 2026-09-05; ledger F231
-- DISCHARGED here, F232's spec half DISCHARGED here (the `locked_until`
-- column half stays L.D1.6's), F236 APPLIED; tasks-M4 §4 standing rules
-- 1–11; D137; D312).
--
-- THE RULINGS (verbatim in PROGRESS §3):
--   Q34(B) — "once a player has kicked off for that weeks games they are
--   locked until all players go to waivers" / "or free agency depending on
--   league settings" / "players unlock after the last game has finished for
--   the week. usually midnight PST Monday."
--   Q35 (a) — `player_game_lock` is retired entirely: "we don't need this
--   toggle from what i can tell" and, on the add half, "picking up a player
--   mid-game makes no sense."
--
-- Numbering: migration head measured 114 at task time (ls supabase/migrations/
-- | tail -1) ⇒ 115, pgTAP head 062 ⇒ 063. The tasks-M4 §7 reservations
-- shift AGAIN (114–118 / 062–066 were L.D1.6 → L.D1.10's; L.D1.5b took 114/062,
-- this task takes 115/063; L.D1.6 → L.D1.10 confirm theirs with `ls` at task
-- time — D161/D166; D311(1); D312(1)).
--
-- D137 provenance: `pool_game_lock_internal`, `pool_game_lock_any_internal`
-- and `roster_add_drop_internal` are replaced against the CURRENT FILE TEXT
-- of their newest defining migration — 113_pool_add_drop.sql (file md5
-- 1459f769b9ad5a627c88a62ffd432299 at authoring) — NOT against
-- `pg_get_functiondef` (CLAUDE.md, migration discipline). 113 is merged to
-- main and is NOT edited (its banner and body comments are historical — they
-- describe what 113 built; this banner supersedes them and says so). The
-- three replacements were DERIVED mechanically: each function's text
-- extracted verbatim from 113 and 16 exact-match substitutions applied (4 +
-- 5 + 7), each asserted to hit exactly once; the script also asserts that
-- `p_enforced`, `v_game_lock`, `player_game_lock`, the correction-window
-- column and the 5-argument signature survive NOWHERE in the three bodies
-- and that the two helpers name `last_game_ends_at`; every other byte is
-- 113's (the derivation script rides in the PR body). The public verb
-- `roster_add_drop` (113 §6) is untouched — same signature, same DEFINER
-- shape, it still calls the seam. `lineup_kickoff_internal` (112),
-- `schedule_window_internal` (111) and `lineup_current_week_internal` (112)
-- are CALLED by name, never copied — the no-game-rows fallback datum (the
-- R740 posture) is not in the ruling and is untouched.
--
-- WHAT THIS MIGRATION DOES
--   1. Strips the retired key from every `leagues.settings` blob (`settings
--      - 'player_game_lock'`) — MEASURED 0 rows carrying it local (0 leagues
--      on the fresh chain + dev restore) and hosted (0 leagues; hosted head
--      081, `select count(*) filter (where settings ? 'player_game_lock')`)
--      at authoring, so the UPDATE is expected to touch nothing; its count is
--      RAISEd as a NOTICE either way (CLAUDE.md: never let "nothing
--      happened" mean "it worked" — here 0 is the expected value and it is
--      SAID).
--   2. `leagues_settings_no_player_game_lock` — CHECK (NOT (settings ?
--      'player_game_lock')). WHY A CHECK AND NOT A DROP COLUMN: the setting
--      never had a typed column — it lived only as a key of the `settings`
--      JSONB (113:544 was its ONLY reader in 001–114: `(v_league.settings
--      ->> 'player_game_lock')::boolean`; `\d leagues` and
--      `league-settings.ts:411` agree — the Zod catalog carried it in the
--      blob half of `splitSettings`). The JSONB analogue of DROP COLUMN is
--      exactly this pair: strip the key (§1) and refuse it at the table (§2),
--      so the value is UNSTORABLE — through a raw INSERT/UPDATE, through
--      `create_league` (077) and `update_league_settings` (105), both of
--      which write `p_settings` straight to the column and validate nothing
--      in-body (measured in 114's banner). The TS catalog is
--      `z.strictObject` (`league-settings.ts:364`), so the API refuses the
--      key at Zod first (400) and the table is the backstop (23514).
--      Grep census at authoring — every reader of the key, by name:
--      supabase/ → 113:544 (the read, replaced here), 113 comments, 109:274
--      (an inline column comment on `locked_until`, historical — that column
--      is L.D1.6's, F232's column half), 061 (fixtures/labels — re-cut);
--      src/ → `league-settings.ts:411` (the Zod key), `round-trip-fixture.ts:
--      99`, `split-merge.test.ts:252`, `league-settings.test.ts:70` (the
--      golden literal), `settings-panel.tsx:958-963` (the toggle row),
--      `roster-add-drop-db.test.ts:231` (a comment); e2e/ and scripts/ → 0.
--   3. `pool_game_lock_internal(season, week, nfl_team, at)` — the 5-arg
--      overload is DROPPED (a CREATE OR REPLACE cannot narrow a signature; a
--      surviving overload would be a second reading of the same lock) and
--      the 4-arg function created from 113's text with THREE changes: (a)
--      the release is `nfl_weeks.last_game_ends_at` — the week's LAST GAME
--      ENDING, 039's column, written by L.D2.1's ingestion at the all-final
--      instant (`ingest-week.ts:288`; pinned `ingest-week-db.test.ts:506` at
--      −1s/AT) and read by NOTHING until now — NOT `correction_window_ends_
--      at`, which is the §23.4 SCORING boundary (when stat corrections stop
--      auto-applying) and stays exactly where it is for scoring
--      (`finalize_matchups`, L.D1.6); (b) NULL semantics INVERT: the
--      correction window is a SCHEDULED value written ahead of time (039's
--      seed populates every 2026 week), so 113 raised when it was NULL (an
--      ingestion gap — R765); `last_game_ends_at` is an EVENT value that is
--      NULL BY DESIGN until the week's games all go final, so NULL means
--      "the week is not over — still locked" and must NOT raise — the NULL
--      branch keeps `locked := TRUE` and the raise goes; (c) `p_enforced` is
--      gone — there is no non-enforcing caller any more.
--   4. `pool_game_lock_any_internal(season, current_week, nfl_team, at)` —
--      the same DROP + create; the candidate-week filter reads `last_game_
--      ends_at IS NULL OR > at` (every week ≤ the current one whose last
--      game has not ended — or has not been OBSERVED to end); `p_enforced`
--      gone. Consequence, said out loud: a PAST week whose `last_game_ends_
--      at` is never written keeps binding every player who kicked off in it
--      (and, through the R740 no-game-rows fallback, EVERY player of a past
--      week with no game rows at all). That is the ruling's shape — the lock
--      releases on an EVENT, and the only recorded fact for that event is
--      this column — and it makes the ingestion path a transactional
--      dependency, not only a scoring one: F238 routes the reconciliation
--      duty (L.D2.3 asserts every all-final past week carries the stamp; a
--      week with no game rows ≤ the current week is a data defect to
--      surface, never a permanent freeze to accept silently).
--   5. `roster_add_drop_internal` — same signature, CREATE OR REPLACE'd
--      from 113's text: `v_game_lock` and its `COALESCE(… 'player_game_lock'
--      …, TRUE)` read are gone; the DROP gate (113:600-604) and the ADD gate
--      (113:670-674) are UNCONDITIONAL — `IF (lock ->> 'locked')::boolean`
--      — and both call the 4-arg helper; the refusal text names the week's
--      last game ending as the release and, when it is NULL, SAYS SO ("an
--      instant not yet recorded — … still locked") instead of printing
--      <NULL>; the result payload's `settings` object no longer echoes
--      `player_game_lock` (`lineup_lock`, `waiver_type`, `waiver_period_
--      hours`, `free_agency`, `fa_hold_hours` stay). Every other refusal,
--      write and post-write assertion is 113's byte for byte. The `game_
--      lock` sub-documents keep their keys — `window_ends_at` now carries
--      the week's `last_game_ends_at` (NULL = not yet ended); `datum_arm`
--      keeps its vocabulary incl. `no_open_window` (renaming a payload key
--      would ripple into L.D4.2's hook types for no behavioural gain).
--
-- LOCK SEMANTICS AFTER THIS MIGRATION (§13.1 v2.16.21 / §7.3.4 / E32 —
-- rule 9, never-weaken): a player LOCKS for adds AND drops at his OWN
-- kickoff (`nfl_games.kickoff_at ≤ at`, evaluated at call time, closed AT
-- the instant — E42-safe), UNCONDITIONALLY — no setting can turn it off —
-- and RELEASES at his week's `last_game_ends_at` (OPEN at the instant:
-- "until the week clears" is strictly before), or never while that column
-- is NULL; every NFL week ≤ the current one whose last game has not ended
-- can bind (R754's two-windows shape survives with the new datum: early in
-- a week the previous week binds until its MNF is observed final). A bye
-- (game rows, none for the team) never locks; a week with NO game rows
-- locks everyone from the week datum (R740 — inherited, not in the ruling).
-- Never-weaken check: NO refusal is relaxed — what changes is that two
-- refusals that a setting could DISABLE can no longer be disabled, and the
-- release moves from a scheduled scoring instant to the games-over event
-- the ruling names. What a dropped player becomes (waivers vs FA) is the
-- untouched `waiver_type` / `waiver_period_hours` / `free_agency` /
-- `fa_hold_hours` machinery ("or free agency depending on league
-- settings").
--
-- Falsifiability (rule 9 / §4.3): pgTAP 063 (independent fixture) pins the
-- CHECK's definition as a literal, the key refused 23514 on INSERT / UPDATE
-- / through `create_league` / through `update_league_settings` with the
-- key-free twin landing; exactly one overload of each helper with the
-- 4-arg identity as a literal and the 5-arg signatures gone by name
-- (`to_regprocedure` NULL); the prosrc sweep (no public function body names
-- `player_game_lock` / `p_enforced`; neither helper nor the seam names the
-- correction-window column; both helpers name `last_game_ends_at`); NULL
-- `last_game_ends_at` = LOCKED on both sides with the unstarted twins
-- living (no raise — the message names "not yet recorded"); a SET end
-- releases at exactly that instant (−1s refused / AT lives, add and drop);
-- kickoff −1s free / +1s locked for adds AND drops. pgTAP 061 is RE-CUT:
-- §A's F231 cell folds by deletion (the flag no longer exists — replaced by
-- the prosrc pin), §E2/§F2 and R754 move `last_game_ends_at`, §E6 flips
-- from the raise to NULL-=-locked, §H1/§H4 (the lax controls — the ONLY
-- cells that proved the toggle mattered) flip to refusing with their strict
-- twins named, §H3 flips from DISCLOSING the Q34(B) do-over to REFUSING it,
-- §H2's FCFS-at-lapse cells untouched; every fixture league loses the key
-- (the CHECK would refuse it). Break probes (PR body): (1) the release
-- swapped back to the correction window on the stack → the AT-release
-- cells red; (2) the drop gate's `AND` restored against a FALSE → the
-- unconditional-drop cells red; (3) the NULL raise re-introduced → the
-- NULL-=-locked cells abort.
--
-- Migration checklist (plan §8.1): one JSONB key strip (expected 0 rows,
-- counted), one CHECK, two DROP FUNCTION + two CREATE (the narrowed
-- helpers), one same-signature CREATE OR REPLACE; no column dropped, no
-- table beyond the constraint; RLS unchanged (no policy here); no ADD
-- COLUMN; staging-clone rehearsal disposed via the R6 rule (fresh local `db
-- reset` 001–115 is the recorded rehearsal); realtime: no trigger (the D38
-- dated disposition — 117 / L.D1.9 owns the `transactions` INSERT trigger);
-- typegen re-run in the same PR (the two helper signatures lose their
-- optional `p_enforced` arg in `Database['public']['Functions']` — a
-- deletion of the retired argument, said out loud; the alias block
-- re-appended); grants doctrine (D18→D23): no per-object GRANT; the REVOKEs
-- are stated on the NEW signatures (a fresh CREATE has PUBLIC EXECUTE by
-- default — the REVOKE is load-bearing here, not a restatement) and
-- restated on the replaced seam.
--
-- HELD-FROM-PRODUCTION: this migration is registered (range → 082-115) in
-- the same PR. No launch-surface table is touched: the strip and the CHECK
-- are on `leagues` (the leagues chain), the functions are 113's league-only
-- helpers/seam; reads outside the chain are 113's SELECTs on `players`,
-- `nfl_games`, `nfl_weeks`, `teams` (the `nfl_weeks` column read moves from
-- `correction_window_ends_at` to `last_game_ends_at`).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Strip the retired key (expected 0 — said out loud)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE leagues SET settings = settings - 'player_game_lock' WHERE settings ? 'player_game_lock';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '115: % league row(s) stripped of settings.player_game_lock (expected 0 — measured 0 local and hosted at authoring)', v_n;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The CHECK — the retired key is unstorable (the JSONB analogue of DROP
--    COLUMN; the backstop behind create_league (077) and
--    update_league_settings (105), neither of which validates p_settings)
-- ---------------------------------------------------------------------------
ALTER TABLE leagues
  ADD CONSTRAINT leagues_settings_no_player_game_lock
  CHECK (NOT (settings ? 'player_game_lock'));

COMMENT ON CONSTRAINT leagues_settings_no_player_game_lock ON leagues IS
  '115 / L.D1.5c (Q35 (a), Chris 2026-09-05): player_game_lock is RETIRED — the game-day add/drop lock is a rule (§13.1 v2.16.21), not a setting; the key can no longer be stored.';

-- ---------------------------------------------------------------------------
-- 3. Drop the 5-argument helpers — a CREATE OR REPLACE cannot narrow a
--    signature, and no overload may survive beside the new reading
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS pool_game_lock_any_internal(INTEGER, INTEGER, TEXT, TIMESTAMPTZ, BOOLEAN);
DROP FUNCTION IF EXISTS pool_game_lock_internal(INTEGER, INTEGER, TEXT, TIMESTAMPTZ, BOOLEAN);

-- ---------------------------------------------------------------------------
-- 4. pool_game_lock_internal — E32 for ONE week, the release =
--    last_game_ends_at, NULL = locked (banner §3; derived from 113 §3)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pool_game_lock_internal(
  p_season   INTEGER,
  p_week     INTEGER,
  p_nfl_team TEXT,
  p_at       TIMESTAMPTZ
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
  -- Q34(B) (115): the release is the week's LAST GAME ENDING —
  -- `nfl_weeks.last_game_ends_at` (039; written by L.D2.1's ingestion at
  -- the all-final instant) — NOT the §23.4 stat-correction window, which
  -- is a SCORING boundary and no longer governs transactions (113 read it).
  SELECT w.last_game_ends_at INTO window_ends_at
  FROM public.nfl_weeks w
  WHERE w.season = p_season AND w.week = p_week;

  IF kickoff_at IS NULL OR kickoff_at > p_at THEN
    locked := FALSE;                     -- bye, or the kickoff is still ahead
  ELSIF window_ends_at IS NULL THEN
    -- Q34(B) (115): `last_game_ends_at` is an EVENT datum — NULL by design
    -- until ingestion observes every game of the week final (§12.20,
    -- L.D2.1) — so NULL means "the week's games are not over" and a
    -- kicked-off player stays LOCKED. Never a raise: the R765 raise was
    -- designed for the SCHEDULED correction window (written ahead of
    -- time, so NULL there meant an ingestion gap) and is wrong for an
    -- event datum. Never read as free. `window_ends_at` NULL in the
    -- returned document IS the loud reading ("kicked off; the week's last
    -- game has not ended").
    locked := TRUE;
  ELSE
    locked := p_at < window_ends_at;     -- closed AT the kickoff, OPEN at the last game's end
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION pool_game_lock_internal(INTEGER, INTEGER, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. pool_game_lock_any_internal — every week whose last game has not ended
--    (banner §4; derived from 113 §4)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pool_game_lock_any_internal(
  p_season       INTEGER,
  p_current_week INTEGER,
  p_nfl_team     TEXT,
  p_at           TIMESTAMPTZ
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
  -- Candidate weeks: on the calendar, not ahead of the current week, whose
  -- LAST GAME has not ended at `at` — `last_game_ends_at` ahead, or NULL
  -- (an event datum: NULL = not yet observed all-final = the week is not
  -- over — Q34(B), 115). Newest first so the current week's datum is what
  -- an unlocked result reports. (113 read the §23.4 correction window
  -- here — a scoring boundary that no longer governs transactions.)
  FOR v_w IN
    SELECT w.week
    FROM public.nfl_weeks w
    WHERE w.season = p_season
      AND w.week <= p_current_week
      AND (w.last_game_ends_at IS NULL OR w.last_game_ends_at > p_at)
    ORDER BY w.week DESC
  LOOP
    SELECT * INTO v_lock FROM public.pool_game_lock_internal(p_season, v_w.week, p_nfl_team, p_at);
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
REVOKE EXECUTE ON FUNCTION pool_game_lock_any_internal(INTEGER, INTEGER, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. roster_add_drop_internal — both gates unconditional, the setting gone
--    from the echo (banner §5; derived from 113 §5; same signature —
--    the public verb roster_add_drop (113 §6) is untouched)
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
    -- Q34(B) (Chris, 2026-09-05; migration 115): UNCONDITIONAL — no setting
    -- turns it off (the toggle is RETIRED entirely, Q35 (a)); the release is
    -- the week's `last_game_ends_at` (NULL = still locked, said in the text).
    v_drop_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_drop_p.team, p_at);
    IF (v_drop_lock ->> 'locked')::boolean THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is locked for drops — kicked off at % (%); week % clears at % (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game',
        v_drop_p.full_name, p_drop, v_drop_lock ->> 'kickoff_at', v_drop_lock ->> 'datum_arm',
        v_drop_lock ->> 'week', COALESCE(v_drop_lock ->> 'window_ends_at', 'an instant not yet recorded — nfl_weeks.last_game_ends_at is NULL until every game of the week is final, so he stays locked')
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
      -- free_agent, or L.D1.6's locked_in_game (the games table decides below —
      -- never the stored state, rule 9).
      v_pool_add_from := v_pool.state;
    END IF;
    -- E32, the ADD side. Q34(B) + Q35 (a) (115): UNCONDITIONAL too —
    -- "picking up a player mid-game makes no sense" (Chris, 2026-09-05).
    v_add_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_add_p.team, p_at);
    IF (v_add_lock ->> 'locked')::boolean THEN
      RAISE EXCEPTION
        'roster_add_drop: % (%) is locked for adds — kicked off at % (%); week % clears at % (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
        v_add_p.full_name, p_add, v_add_lock ->> 'kickoff_at', v_add_lock ->> 'datum_arm',
        v_add_lock ->> 'week', COALESCE(v_add_lock ->> 'window_ends_at', 'an instant not yet recorded — nfl_weeks.last_game_ends_at is NULL until every game of the week is final, so he stays locked')
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
