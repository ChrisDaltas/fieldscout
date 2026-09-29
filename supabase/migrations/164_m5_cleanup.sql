-- ============================================================================
-- 164_m5_cleanup.sql — the M5 cleanup batch (task L.D3.14): the
-- commissioner's receipts read the PLAYED lock (F467), the kept-start rule
-- uses the locks' real-kickoff guard (F468(b)), and the one-time re-score
-- door is retired (F489). FULL rigour for §1–§3 (locks / lineups). No
-- product rule changes: every item is ruled or ruling-free (PROGRESS D428).
-- Spec §10 / standing rule (g) (the commissioner stands OUTSIDE the timing
-- rules — nothing here binds him; only what his receipt SAYS changes),
-- §11.2 (the per-player lock; the one-start bullet), §13.1 (the game-day
-- lock), §11.4 / §23.4 (the re-score — "used once, 2026-09-29, then
-- retired", v2.16.73). PROGRESS D420 (157's played lock), D413 (154's
-- kept-starter judgment), D425 (161's door), F488 (its one production run).
--
-- Numbering: reserved by the orchestrator (164 / pgTAP 112) and measured at
-- build time (D161) — `ls supabase/migrations | tail -1` →
-- 163_waiver_order_from_draft.sql, `ls supabase/tests | tail -1` →
-- 111_waiver_order_from_draft.sql, main @ f6ce0a7. Reaches production by
-- `npx supabase db push` only (production is at 163; push debt: 164).
--
-- §1 F468(b) — lineup_kept_starter_internal (154) ARM (ii). 154 keeps an
--    off-roster stored starter when the lineup's own record of his slot
--    (`starters[].kickoff_at`) has passed — ANY passed instant. 157's
--    locks count a record only when it is a REAL kickoff of the week (a
--    non-postponed game of that week kicks off at that instant) and his
--    current team's game is not postponed (`lineup_record_kicked_off_
--    internal` — the guard that keeps E42 / E43: a flexed or postponed game
--    leaves no game at the old instant, so its record is stale, not
--    history). So on a stale postponed record the kept-start rule said
--    "kept" while every lock said "not played". Arm (ii) now calls that
--    guard: one line. Arms (i), (iii), (iv) and the not-kept arm are
--    byte-identical; a record that fails the guard falls through to the
--    stat line (iii), the closed week (iv), or opens (a bye / not played —
--    exactly as before for a record that was NULL). F468(a) (does Sleeper
--    ever emit a stat line before a player's own game starts?) is a
--    measurement at the next slate, not code — it stays open.
--    Readers (unedited — the signature and the returned row are unchanged):
--    set_lineup_internal (157), lineup_autopilot_internal (157),
--    commish_edit_lineup_internal (§3).
--
-- §2 F467 — commish_roster_override_internal (153): the `bypassed[]`
--    receipt lines `e32_drop_lock:<player>` / `e32_add_lock:<player>` and
--    the receipt's `drop_game_lock` / `add_game_lock` documents read the
--    lock from the player's CURRENT NFL team (153's pool_game_lock_any_
--    internal). A player who played this week and was then released or
--    traded by the NFL read as unlocked, so the receipt did not name the
--    lock the commissioner walked past. They now read 157's per-player lock
--    (`pool_game_lock_player_internal` — the one roster_add_drop, the claim
--    submit / run and the trade lock enforce). Nothing is refused: the two
--    reads feed only `bypassed[]` and the two receipt documents (measured —
--    `grep -n "v_lose_lock\|v_gain_lock"` over 153:971-1973: the two
--    assignments, the two IFs that append to v_bypassed, and the audit
--    metadata / returned document).
--
-- §3 F467 — commish_edit_lineup_internal (154): `locked_players_moved` (and
--    the `per_player_kickoff_lock` bypass it implies) and the IR
--    `ir_lock_timing:<player>` receipt lines read v_kick / v_kick_cur —
--    lineup_kickoff_internal for the player's CURRENT NFL team. They now
--    read two parallel maps, v_lock_kick / v_lock_kick_cur, built in the
--    same step (6) loop from 157's `lineup_player_kickoff_internal` (the
--    datum set_lineup has enforced since 157; (4b)'s kept off-roster
--    starters merged in exactly as v_kick merges them). RECEIPT ONLY, by
--    construction: v_kick and v_kick_cur are untouched, so the stored
--    record (`starters[].kickoff_at`), `locked_at`, the §7.3.6 bye gate and
--    flags are computed exactly as before, and step (7) never refused
--    anything (difference (A)). The one-start trigger (154) still binds
--    him. (The stored record still reads the current NFL team here, unlike
--    set_lineup since 157 — F497; out of this task's receipt-only scope.)
--
-- §4 F489 — admin_rescore_final_week (161) RETIRED. Used once, 2026-09-29,
--    on Chris's ruling ("re-score weeks 1 and 2 with the actual yards" —
--    PROGRESS F488: production weeks 1–2, audit rows ee2a43f8… / 2ffaebe7…).
--    REVOKE EXECUTE FROM service_role: no role but the owner can run it.
--    The function, its replay ledger (`admin_rescore_actions`), the lock's
--    exit (161 §3 — it demands a `rescore_final_week` audit row of THAT
--    league-week, which only this door writes) and every audit row stay:
--    history is kept, and re-granting on a NEW recorded ruling is one
--    migration — `GRANT EXECUTE ON FUNCTION public.admin_rescore_final_week(
--    uuid, integer, jsonb, text, text, uuid, uuid, boolean) TO service_role`
--    (the CLI's refusal names it). Callers measured (`grep -rn
--    admin_rescore_final_week` over src / scripts / supabase / e2e): the
--    rescore library + `npm run rescore:final-weeks` only — now refused by
--    name (the library probes the door first) — and pgTAP 109, which runs
--    as the owner. No cron, route, job or other function calls it.
--
-- D137 — each replaced body is derived from its NEWEST definer's FILE TEXT
-- (measured by grep over 001–163: no later migration defines any of them)
-- by an exact-match script (derive_164.py — every substitution asserted to
-- hit its expected count, its reversal (pgTAP 112's pg_temp.un164) asserted
-- to reproduce the source byte for byte; the source prosrc md5 equals the
-- live one, pgTAP 105 A6's stored literals):
--   lineup_kept_starter_internal      154:179-249   prosrc md5 3266056c… → 3f60bb97…  1 hunk  (+1 / -1)
--   commish_roster_override_internal  153:971-1973  prosrc md5 32972a1a… → a078d3e9…  2 hunks (+2 / -2)
--   commish_edit_lineup_internal      154:1057-1886 prosrc md5 60662cff… → 9bcdc00d…  6 hunks (+30 / -12)
-- Every older suite that pins one of these bodies reverses 164's
-- substitutions INNERMOST (pg_temp.un164 — additive, the R992 shape) so its
-- literal stands; pgTAP 112 A pins 164's own.
--
-- DEPLOY BEFORE PUSH. SQL, plus the rescore CLI / library refusal and test
-- files. No route, page, job or type the app reads changes shape: the
-- receipts keep their keys (`bypassed[]` may name one more player;
-- `locked_players_moved[].datum_arm` may read `lineup_record` /
-- `stat_line`, measured — `grep -rn "datum_arm\|locked_players_moved\|e32_" src`
-- reads them only to count and display them). Safe against a pre-164 database: the
-- new CLI refusal reads the door's own answer (a granted door runs as
-- before).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   New: nothing (no table, column, policy, index, trigger, cron row or
--   function). Three bodies replaced, signatures unchanged (ACLs kept;
--   REVOKEs restated); all three PLAIN, search_path '' (unchanged). One
--   privilege narrowed (§4). Time only through p_at (no clock read). The
--   league row lock is unchanged — both commissioner verbs take it first
--   (rule 8); §1 only reads. Typegen: no change expected (no signature or
--   new function; the retired door stays in `Functions` — its type is
--   history, and a call is refused by the database). Realtime: none.
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–164 and the full pgTAP run in the PR. D38 — nothing to
--   backfill: receipts already written stay as written (§12.12 — an audit
--   row is never edited), and §1 re-judges only on the next read.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. lineup_kept_starter_internal — CREATE OR REPLACE against 154:179-249's
--    FILE TEXT (D137; 154 the only definer), 1 hunk (+1 / -1): arm (ii)
--    counts the lineup's record only through 157's real-kickoff /
--    postponed-team guard (F468(b)).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_kept_starter_internal(
  p_season    INTEGER,
  p_week      INTEGER,
  p_player_id TEXT,
  p_slot      TEXT,          -- the slot_map key he holds ("<slot_key>:<index>")
  p_starters  JSONB,         -- the lineup row's stored starters[] (its record of each slot), or NULL
  p_at        TIMESTAMPTZ
) RETURNS TABLE (
  kept       BOOLEAN,
  kickoff_at TIMESTAMPTZ,    -- his game's kickoff as known (NULL when only a stat line says he played)
  datum_arm  TEXT,           -- lineup_kickoff_internal's arm, 'lineup_record' or 'stat_line'
  on_bye     BOOLEAN,        -- FALSE whenever kept (a kept start is never a bye)
  why        TEXT,           -- kept: 'kicked_off' | 'stat_line' | 'week_closed'; not: 'bye' | 'not_played'
  detail     TEXT            -- the reason in words, for a refusal
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_team    TEXT;
  v_live    RECORD;
  v_rec     JSONB;
  v_rec_at  TIMESTAMPTZ;
  v_stat    BOOLEAN;
  v_release TIMESTAMPTZ;
BEGIN
  -- (i) his CURRENT NFL team's game for the week (152's arm; E42: read now).
  SELECT p.team INTO v_team FROM public.players p WHERE p.id = p_player_id;
  SELECT * INTO v_live FROM public.lineup_kickoff_internal(p_season, p_week, v_team, p_at);
  -- (ii) the lineup's own record of this slot (set by the writer that seated
  --      him, re-read by the tick from players.team — so it helps only until
  --      the tick re-reads a released player, which is why (iii) exists).
  SELECT s INTO v_rec
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_starters) = 'array' THEN p_starters ELSE '[]'::jsonb END) s
  WHERE s ->> 'slot' = p_slot AND s ->> 'player_id' = p_player_id
  LIMIT 1;
  v_rec_at := (v_rec ->> 'kickoff_at')::timestamptz;
  -- (iii) F442: a stat line of his for the week — he played, for whichever
  --       NFL team he was on then (player_stats is keyed player/season/week;
  --       the StatsProvider's store, read in SQL as 131's score enqueue does).
  v_stat := EXISTS (SELECT 1 FROM public.player_stats ps
                    WHERE ps.player_id = p_player_id AND ps.season = p_season AND ps.week = p_week);
  -- (iv) the week's lock release (153): the recorded end, or the ceiling.
  SELECT public.week_lock_release_internal(w.last_game_ends_at, w.starts_at) INTO v_release
  FROM public.nfl_weeks w
  WHERE w.season = p_season AND w.week = p_week;

  on_bye := FALSE;
  IF v_live.kickoff_at IS NOT NULL AND v_live.kickoff_at <= p_at THEN
    kept := TRUE; kickoff_at := v_live.kickoff_at; datum_arm := v_live.datum_arm; why := 'kicked_off';
    detail := format('his game kicked off at %s (%s)', v_live.kickoff_at, v_live.datum_arm);
  ELSIF public.lineup_record_kicked_off_internal(p_season, p_week, p_player_id, v_rec_at, p_at) THEN   -- 164 / F468(b): a REAL, passed kickoff of the week and his team's game not postponed (157's guard — the locks' own judgment)
    kept := TRUE; kickoff_at := v_rec_at; datum_arm := 'lineup_record'; why := 'kicked_off';
    detail := format('his game kicked off at %s (lineup_record)', v_rec_at);
  ELSIF v_stat THEN
    kept := TRUE; kickoff_at := NULL; datum_arm := 'stat_line'; why := 'stat_line';
    detail := format('he has a week-%s stat line — he played, for the NFL team he was on then (F442)', p_week);
  ELSIF v_release IS NOT NULL AND v_release <= p_at AND NOT v_live.on_bye THEN
    kept := TRUE; kickoff_at := v_live.kickoff_at; datum_arm := v_live.datum_arm; why := 'week_closed';
    detail := format('week %s closed to moves at %s (its lock release — the last game''s end or the Wednesday 00:00 Pacific ceiling, §11.2 / Q78) before he left, and his game (kickoff %s) is still to be played: its points stay with this lineup (D412(5))',
                     p_week, v_release, COALESCE(v_live.kickoff_at::text, 'not scheduled'));
  ELSE
    kept := FALSE; kickoff_at := v_live.kickoff_at; datum_arm := v_live.datum_arm; on_bye := v_live.on_bye;
    why := CASE WHEN v_live.on_bye THEN 'bye' ELSE 'not_played' END;
    detail := CASE WHEN v_live.on_bye THEN 'no game this week (a bye) — he scores nothing; the slot opens'
                   ELSE 'his game has not kicked off and the week is open to moves' END;
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_kept_starter_internal(INTEGER, INTEGER, TEXT, TEXT, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. commish_roster_override_internal — CREATE OR REPLACE against
--    153:971-1973's FILE TEXT (D137; definers 127 / 131 / 149 / 152 / 153 —
--    153 newest), 2 hunks (+2 / -2): the drop-side and add-side receipt
--    reads are 157's per-player lock (F467). The DEFINER doors
--    commish_force_add_drop / commish_move_player (127) are untouched.
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
  v_sched         JSONB;         -- 149 (Q70): the league's waiver schedule
  v_fa_window     JSONB;         -- 149 (Q70): the free-agency window at p_at
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
  v_week_end      TIMESTAMPTZ;   -- 152 / F437: the current week's end (153: its lock release — Q78's ceiling)
  v_from_week     INTEGER;       -- 152 / F437: the first unfinished week
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

  -- (4) THE REASON, OPTIONAL under Q66 (migration 131 / L.E1.15, F362;
  --     spec v2.16.41 §10.3 / §15.4): NORMALISED, never refused. Absent or
  --     whitespace-only in the explicit E' \t\r\n' class (R745) ⇒ NULL
  --     (130 §0 stores it); otherwise trimmed, bounded at 500 below (the
  --     league_chat bound and the commissioner_actions CHECK). The 500
  --     check is NULL-safe as written.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
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
  -- `('active','orphaned','retired')`; **four statements across two functions
  -- write `'active'` and all four are guarded by the same
  -- `CASE WHEN status = 'orphaned' THEN 'active' ELSE status END`** — `seat_league_member_internal` (`062:282-285`, newest
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
  v_sched        := public.waiver_schedule_internal(v_league.settings, v_waiver_type);   -- 149: replaces the retired waiver_period_hours
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
      v_lose_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, v_lose_player, p_at);   -- 164 / F467: the receipt judges the lock per player (played this week), as 157's writers do
      IF (v_lose_lock ->> 'locked')::boolean THEN
        v_bypassed := v_bypassed || to_jsonb(('e32_drop_lock:' || v_lose_player)::text);
      END IF;
    END IF;
    IF v_gain_player IS NOT NULL AND NOT v_is_move THEN
      v_gain_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, v_gain_player, p_at);   -- 164 / F467: the receipt judges the lock per player (played this week), as 157's writers do
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
        -- 149: a hold whose run is due but not yet settled is still a hold (E8).
        IF v_pool.state = 'on_waivers'
           AND (v_pool.waivers_until > p_at
                OR (v_league.waiver_next_run_at IS NOT NULL AND v_pool.waivers_until >= v_league.waiver_next_run_at)) THEN
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
      -- 149 (Q70): the league's free-agency window is a `when` too — outside
      -- it every unowned player is claim-only for a MANAGER; the commissioner
      -- walks past it (TD5) and the receipt NAMES it under the same
      -- `waiver_period:<player>` entry (one name for "not an instant pickup").
      v_fa_window := public.waiver_window_internal(v_league, p_at);
      IF NOT (v_fa_window ->> 'free_agency_open')::boolean
         AND NOT (v_bypassed @> to_jsonb(ARRAY['waiver_period:' || v_gain_player])) THEN
        v_bypassed := v_bypassed || to_jsonb(('waiver_period:' || v_gain_player)::text);
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
          v_drop_until := public.waiver_next_run_internal(v_sched, p_at);   -- 149 (Q70): until the next run
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
    --      signal with it (D346). Every week from the first UNFINISHED one on
    --      (152 / F437), for both sides of a move. `p_current` stays the
    --      current week: once it is finished the sync never visits it, so
    --      nothing is vacated and nothing re-scores a finished week.
    -- F437: the first UNFINISHED week is the current week while its last
    -- game has not ended, the next one once it has (151's trade executor's
    -- rule, D410(5)). A finished week's lineup is
    -- the record the score worker and the nightly reconcile score it from
    -- (score-week-worker.ts step 5 reads THE WEEK's slot_map), and stat
    -- corrections re-score it until its window closes — clearing a played
    -- starter from it would erase his points from the team that played him.
    -- 153 / F333 (Q78): the week ENDS at its lock release — the recorded end,
    -- or its Wednesday 00:00 Pacific ceiling when that comes first. The
    -- ceiling releases a played starter, so it must finish the week for
    -- lineups too: otherwise, in a league's LAST week (no week N+1 row to
    -- flip the current week), a move at the ceiling would clear his start.
    SELECT public.week_lock_release_internal(w.last_game_ends_at, w.starts_at) INTO v_week_end FROM public.nfl_weeks w
    WHERE w.season = v_league.season AND w.week = v_current;
    v_from_week := CASE WHEN v_week_end IS NOT NULL AND v_week_end <= p_at THEN v_current + 1 ELSE v_current END;
    v_sync := public.commish_roster_lineup_sync_internal(
      p_league_id, v_team_a.id, v_league.season, v_from_week, v_current,
      CASE WHEN v_lose_team = v_team_a.id THEN v_lose_player END,
      CASE WHEN v_gain_team = v_team_a.id THEN v_gain_player END,
      v_ir_keys);
    v_lineups := v_lineups || jsonb_build_object('team_id', v_team_a.id, 'rows', v_sync -> 'rows');
    v_vacated := v_sync ->> 'vacated_current_slot';
    IF v_is_move THEN
      v_sync := public.commish_roster_lineup_sync_internal(
        p_league_id, v_team_b.id, v_league.season, v_from_week, v_current,
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
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
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
REVOKE EXECUTE ON FUNCTION commish_roster_override_internal(UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. commish_edit_lineup_internal — CREATE OR REPLACE against
--    154:1057-1886's FILE TEXT (D137; definers 123 / 131 / 154 — 154
--    newest), 6 hunks (+30 / -12): DECLARE (two maps); step (6) builds them
--    from 157's per-player datum beside v_kick / v_kick_cur; step (7)'s
--    locked_players_moved and step (9)'s ir_lock_timing read them (F467).
--    The DEFINER wrapper commish_edit_lineup (123) is untouched.
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
  v_lock_kick   JSONB := '{}'::jsonb;   -- 164 / F467: the RECEIPT's datum for p_week, per PLAYER (157's lineup_player_kickoff_internal)
  v_lock_kick_cur JSONB := '{}'::jsonb; -- 164 / F467: the same for the CURRENT week (the IR timing receipt)
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
  -- 154 / F441 (R1209): stored STARTERS off this roster whom the week keeps
  -- (player_id → {kickoff_at, datum_arm, on_bye}).
  v_gone_kick   JSONB := '{}'::jsonb;
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

  -- DIFFERENCE (D), RE-READ UNDER Q66 (migration 131 / L.E1.15, PROGRESS
  -- F362; spec v2.16.41 §10.3 / §15.4): the reason is OPTIONAL. It is
  -- NORMALISED here, never refused — absent or nothing but whitespace in the
  -- explicit E' \t\r\n' class (R745) ⇒ NULL, which 130 §0's column change
  -- stores; otherwise trimmed and bounded at 500 below (the league_chat
  -- bound, R746, and the table CHECK's). The 500 check is NULL-safe as
  -- written (char_length(NULL) > 500 is NULL, and IF NULL does not fire).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
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

  -- (4b) 154 / F441 (R1209) — A START THE WEEK KEEPS IS NOT ERASED BY A FIX.
  --      A stored STARTING slot whose player has left this roster since — a
  --      player who played, or whose week closed to moves before he left
  --      (lineup_kept_starter_internal: the ONE judgment set_lineup (4b) and
  --      autopilot share — F442 / F445) — is the week's record: 152 / 153
  --      keep it there, and the week is scored from it. The editor never
  --      holds an unrostered player (placementFromStored), so an OMITTED key
  --      is CARRIED, never read as "empty it", and a submit that names him at
  --      his key is accepted (131's roster check refused it — so any
  --      commissioner fix to that week silently dropped his points). The
  --      commissioner still walks past the lock (difference (A)): a submit
  --      that gives his key to someone else, or seats him at another key,
  --      does exactly that and is recorded in locked_players_moved. An IR
  --      spot is roster state, so it is refused for him. He joins v_by_pid
  --      (never v_roster: no bench, no roster write).
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN v_by_pid ? v_pid;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key);
    SELECT jsonb_build_object(
             'player_id',          p.id,
             'name',               p.full_name,
             'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
             'designation',        public.lineup_designation_internal(p.status),
             'nfl_team',           p.team,
             'ir_placed_week',     NULL,
             'ir_lock_until_week', NULL,
             'slot_key',           NULL,
             'off_roster',         TRUE)
    INTO v_e
    FROM public.players p WHERE p.id = v_pid;
    CONTINUE WHEN v_e IS NULL;
    SELECT * INTO v_k FROM public.lineup_kept_starter_internal(v_league.season, p_week, v_pid, v_key, v_row.starters, p_at);
    CONTINUE WHEN NOT v_k.kept;   -- a bye / a game gone from the week: the slot opens, as before
    IF EXISTS (SELECT 1 FROM jsonb_each(p_slot_map) x
               WHERE (x.value #>> '{}') = v_pid
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = x.key)) THEN
      RAISE EXCEPTION
        'commish_edit_lineup: % has left %''s roster — an IR spot holds only a rostered player (§11.2); his week-% start at "%" can stay, move or be removed, never go to IR',
        v_e ->> 'name', v_team.name, p_week, v_key
        USING ERRCODE = 'P0001';
    END IF;
    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);
    v_gone_kick := v_gone_kick || jsonb_build_object(v_pid, jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF NOT (p_slot_map ? v_key)
       AND NOT EXISTS (SELECT 1 FROM jsonb_each(p_slot_map) x WHERE (x.value #>> '{}') = v_pid) THEN
      p_slot_map := p_slot_map || jsonb_build_object(v_key, v_pid);   -- carried
    END IF;
  END LOOP;

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
    -- 164 / F467: what the RECEIPT says is judged per PLAYER — his current
    -- NFL team's kickoff, or the kickoff he PLAYED in this week (157) — so
    -- a player the NFL released or traded after he played is named as
    -- moved past the lock. Receipt only: v_kick (the stored record,
    -- locked_at, the bye flags) is unchanged, and nothing here refuses.
    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, p_week, v_e ->> 'player_id', p_at);
    v_lock_kick := v_lock_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_current, v_e ->> 'nfl_team', p_at);
      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
        'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
      SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, v_current, v_e ->> 'player_id', p_at);   -- 164 / F467
      v_lock_kick_cur := v_lock_kick_cur || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
        'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    END IF;
  END LOOP;
  v_kick := v_kick || v_gone_kick;   -- 154 / F441: (4b)'s kept, since-unrostered starters
  v_lock_kick := v_lock_kick || v_gone_kick;   -- 164 / F467: (4b)'s kept starters, as v_kick
  IF v_current = p_week THEN
    v_kick_cur := v_kick;
    v_lock_kick_cur := v_lock_kick;   -- 164 / F467
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
  --     164 / F467: judged by v_lock_kick — per PLAYER, the lock a manager
  --     faces since 157 — so the record names every player a manager
  --     could not have moved.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN NOT (v_by_pid ? v_pid);
    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
    IF (((v_lock_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_lock_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at)
        OR v_gone_kick ? v_pid)   -- 154 / F441: a kept off-roster starter moved or removed is recorded too
       AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid THEN
      v_moved_lock := v_moved_lock || jsonb_build_object(
        'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        'from', v_key, 'to', v_seen ->> v_pid,
        'kickoff_at', v_lock_kick -> v_pid ->> 'kickoff_at',
        'datum_arm', v_lock_kick -> v_pid ->> 'datum_arm');
    END IF;
  END LOOP;
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
    IF (v_lock_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_lock_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
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
        'kickoff_at', v_lock_kick -> v_pid ->> 'kickoff_at',
        'datum_arm', v_lock_kick -> v_pid ->> 'datum_arm');
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
      IF (v_lock_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_lock_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
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
    IF (v_lock_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_lock_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
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
      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0
         AND NOT (v_gone_kick ? v_pid AND (v_stored ->> v_key) = v_pid) THEN   -- 154 / F441: a kept start where it stands is the week's record, not a submit
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
      || ')' || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

    IF p_week = v_current THEN
      -- slot_key describes the ACTIVE week only, so a RETROACTIVE edit
      -- correctly leaves it alone — 114's guard is right as written.
      v_expected := 0;
      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit -> 'assignment') LOOP
        CONTINUE WHEN v_gone_kick ? (v_val #>> '{}');   -- 154 / F441: off this roster — no roster row of his to write
        UPDATE public.league_rosters r SET slot_key = v_key
        WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = (v_val #>> '{}');
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        v_expected := v_expected + v_cnt;
      END LOOP;
      IF v_expected <> COALESCE(array_length(v_started, 1), 0)
                       - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick) g WHERE g = ANY (v_started)) THEN
        RAISE EXCEPTION 'commish_edit_lineup: wrote slot_key for % starters, expected %', v_expected,
          COALESCE(array_length(v_started, 1), 0) - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick) g WHERE g = ANY (v_started))
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
-- 4. admin_rescore_final_week — RETIRED (F489). Used once, 2026-09-29
--    (F488). The function, its ledger and its audit history stay; only the
--    service role's EXECUTE goes. Re-granting (a NEW recorded ruling) is one
--    migration: GRANT EXECUTE ON FUNCTION public.admin_rescore_final_week(
--    uuid, integer, jsonb, text, text, uuid, uuid, boolean) TO service_role.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION admin_rescore_final_week(UUID, INTEGER, JSONB, TEXT, TEXT, UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION admin_rescore_final_week(UUID, INTEGER, JSONB, TEXT, TEXT, UUID, UUID, BOOLEAN) IS
  'RETIRED by migration 164 (M5 L.D3.14; PROGRESS F489, D428; spec §11.4 v2.16.73): used once, 2026-09-29, then retired — no role but the owner may execute it. Migration 161 (M5 L.D3.13; PROGRESS D425): the ONE sanctioned re-score of a FINAL league-week, on a recorded product ruling (Chris 2026-09-29: "re-score weeks 1 and 2 with the actual yards"; run in production per F488). Re-writes the week''s non-overridden scores + the E38 result with them, the per-player rows (source rescore), then the results math finalization calls (rebuild_team_week_results); one audit row, one league post, a notification per manager whose result changed. Dry run (the default) = the apply rolled back. Replay by action_id; no change ⇒ no_changes. Re-granting it on a NEW recorded ruling is one migration: GRANT EXECUTE ... TO service_role.';
