-- ============================================================================
-- Lineup autopilot for a seat with no manager — migration 125
-- (task L.E1.4 of M6A; spec §7.2.1(c) `spec:185`, §11.3 `spec:733`, §23's
-- worker table `spec:1603`; PROGRESS Q56 (the measurement) + F334 (the ledger
-- row this discharges); tasks-M6A §3 D337 / D338 / D339 / D340 / D354 and §4
-- rules 1-15; tasks-M4 §4 standing rules 1-11; D137).
--
-- THE PROMISE, verbatim and made exactly ONCE in the spec (§7.2.1(c),
-- `spec:185`): "Lineups auto-set (last valid, healthy-substitution per
-- existing autopick logic)." PROGRESS Q56(c) corrects an earlier over-claim —
-- it is promised once, not twice; §7.2's "autopick" is the DRAFT's
-- `league_members.is_autodraft`, which nothing in the in-season stack reads.
-- Only the draft half was ever built (`110:1033`).
--
-- WHY IT IS WORTH A MIGRATION OF ITS OWN. Measured against the 2026 cohort
-- league (Q56(b)): 12 franchises, 1 human, 11 unmanaged seats. The auto-carry
-- populates a lineup ONLY from an EARLIER week (`116:456`), so week 1 opened
-- with twelve `slot_map = '{}'` rows and the in-season half of the test
-- produces no signal at all — one real score against a zero, and five zeroes
-- against zeroes. THIS IS THE TASK THAT MAKES THAT LEAGUE SCORE.
--
-- WHAT THIS MIGRATION DOES
--   1. `lineup_autopilot_internal(league, team, season, week, at)` — a PURE
--      chooser: it reads the roster, the slots, the designations and the
--      kickoffs at the injected instant and RETURNS the row it would write.
--      It writes NOTHING. The caller writes (see (3)), which is what keeps
--      the `ROW_COUNT <> 1` assertion and the `team_lineups` UPDATE in one
--      place — the tick — exactly as tasks-M6A §5 sketches it.
--   2. `lineup_lock_tick` — CREATE OR REPLACE with a THIRD ARM (c). Arms (a)
--      (the pool view) and (b) (the lineup record) are BYTE-UNTOUCHED,
--      INCLUDING (b)'s SELECT list.
--   3. Arm (c) writes `slot_map`, `starters`, `bench` and `locked_at`
--      TOGETHER (114's row shape, `116:543-546`) — never `slot_map` alone.
--
-- WHAT THIS MIGRATION DOES NOT DO, AND IT IS STATED BECAUSE A SUPERSEDED
-- DRAFT OF THE BREAKDOWN DID ALL THREE (tasks-M6A §2.3 / D337):
--   `lineup_carry_internal` IS NOT CHANGED. `league_week_advance` IS NOT
--   CHANGED. `118:1825` (the carry's one live call site) IS NOT CHANGED.
--   Not one byte of any of them. Arm (c) CALLS `lineup_carry_internal`
--   (`116:369`) to materialize a missing row (D354) — calling it is not
--   changing it, and its INSERT-with-no-`ON CONFLICT` / `ROW_COUNT = 1`
--   contract (`116:541-551`) is inherited AS-IS, so a concurrent materialize
--   is a loud 23505 that lands in the tick's own `failures[]` rather than a
--   silent second row.
--
-- D137 PROVENANCE. `lineup_lock_tick` is authored `CREATE OR REPLACE` against
-- the CURRENT FILE TEXT of its newest defining migration —
-- `119_inseason_realtime.sql:696-918` — never against `pg_get_functiondef`
-- and never against `116:574`, which 119 superseded (CLAUDE.md migration
-- discipline). FOUR HUNKS, each of which must hit exactly once:
--   (H1) the DECLARE block gains the autopilot locals;
--   (H2) one statement before the batching LOOP: the kill switch, read ONCE
--        per invocation and not once per league;
--   (H3) arm (c), inserted after arm (b)'s `END LOOP` and before the
--        per-league `EXCEPTION WHEN OTHERS` — so a league whose autopilot
--        raises is contained exactly like one whose pool refresh raises;
--   (H4) the RETURN: five new keys plus `autopilot_reason`, and the existing
--        `reason` CASE gains `v_ap_writes` so a pass that autopiloted can
--        never report `no_changes`.
-- Everything else is byte-identical, and pgTAP 073 §K pins the posture.
--
-- WHY THE HOOK IS THE TICK AND NOT WEEK OPEN (D337, the must-fix that
-- invalidated a design rather than a citation). `lineup_carry_internal`'s one
-- live caller sits inside TWO one-shot gates — `lw.status = 'upcoming'`
-- (`118:1794`, whose first statement flips the week to `live`, `118:1799`) and
-- `NOT EXISTS (… team_lineups …)` (`118:1820-1822`) — and BOTH are already
-- spent for the live league's week 1. A hook there is structurally unreachable
-- for the league it was written for. The tick already walks those twelve empty
-- rows sixty times an hour and already steps over each empty slot by name
-- (`119:857-860`), §23's worker table already assigns the adjacent mechanic to
-- this cron (`spec:1603`), and §11.3 already hands autopilot its receipt
-- posture — "logged as a system — not commissioner — action" (`spec:733`).
--
-- WHY ARM (c) HAS ITS OWN DRIVING QUERY AND DOES NOT RIDE (b)'s LOOP (D354).
-- (b) reads FROM `team_lineups` (`119:839-850`), so it can only ever see a
-- seat that ALREADY HAS a row for the week. `add_placeholder_seat`
-- (`063:455-465`) mints a seat with NO `team_lineups` row, and the carry that
-- would have written one is one-shot and already spent. Such a seat would be
-- invisible to an UPDATE-only arm, would produce no line in any report field,
-- and would leave the slice's exit criterion false while every test passed —
-- "nothing happened" read as "it worked", in the one task written to abolish
-- it. So arm (c) drives off `teams` LEFT JOIN `team_lineups`, (b)'s SELECT
-- list is not touched at all, and a matching seat with `tl.id IS NULL` is
-- MATERIALIZED through the unchanged carry and then filled, named in
-- `seats_materialized[]`.
--
-- `lw.status = 'live'` IS READ EXPLICITLY, and that clause is load-bearing:
-- `tl.week = v_current` does NOT imply the week is live. `v_current` comes
-- from `lineup_current_week_internal` (`112:360-374`), which derives it from
-- `nfl_weeks.starts_at` — so the current week sits in `correction_window`
-- from the last whistle until finalize, and filling it then is a scoring
-- rewrite of a week that has been played. pgTAP 073 §P pins it with a
-- positive control at the SAME instant.
--
-- THE "NO MANAGER" PREDICATE READS `league_members`, NEVER `teams.status`
-- (D339). It is the exact complement of `set_lineup_internal`'s own auth
-- (`114:240-243`): `NOT EXISTS (SELECT 1 FROM league_members m WHERE
-- m.team_id = t.id AND m.user_id IS NOT NULL)`. That covers BOTH unmanaged
-- shapes with no `OR`, because they converge in that one table — a
-- placeholder seat is `(user_id NULL, is_placeholder TRUE, team_id SET)` on a
-- `teams` row that takes the DEFAULT status `'active'` and opens no stint
-- (`063:455-464`), while `remove_manager`'s vacate arm keeps the row and only
-- THEN sets `teams.status = 'orphaned'` (`120:645-659`). A predicate keyed on
-- `teams.status = 'orphaned'` misses all eleven of the live league's seats,
-- and one keyed on `is_placeholder` keys on a column that is
-- `BOOLEAN DEFAULT FALSE` with no NOT NULL (`052:69`) and so can be NULL.
--   THE UNSAFE FAILURE DIRECTION IS HANDLED AND NOT MERELY NOTED: `NOT
--   EXISTS` is ALSO true of "this team has no `league_members` row at all",
--   and in that case autopilot would seize a human's team. The invariant that
--   makes the predicate safe lives in code, not schema ("ONE league_members
--   row per seat, always (§12.2)", `120:558`) while `league_members.team_id`
--   is `ON DELETE SET NULL` (`052:67`). So such a team is NEVER autopiloted
--   and IS reported, by name, in `skipped[]` — CLAUDE.md's "never let
--   'nothing happened' mean 'it worked'" in its exact shape, a zero-row read
--   that means two different things.
--
-- AUTOPILOT IS A SYSTEM ACT (D338). It writes NO `commissioner_actions` row —
-- it could not as built (`actor_id` is `UUID … NOT NULL`, `123:278`, and
-- `auth.uid()` is NULL for pg_cron; inventing a synthetic actor would weaken
-- the column that makes the audit mean anything), and `spec:733` already
-- calls the analogous act a system action. It also DOES NOT INHERIT THE
-- COMMISSIONER'S LOCK EXEMPTION: PROGRESS standing-rule clause (g) exempts
-- `commish_edit_lineup` because a HUMAN takes responsibility with a receipt,
-- and autopilot has neither. Every candidate whose `kickoff_at <= p_at` (the
-- predicate `114:455-456` / `114:469-470`) is excluded from selection and
-- NAMED in `skipped_locked[]`. The lock is per-player, so a 12:59
-- substitution using a later-kickoff candidate is lawful and the per-minute
-- tick degrades gracefully instead of going all-or-nothing at the first
-- whistle.
--
-- PLACEMENT IS `lineup_fit_internal` (`112:439`) AND NOTHING ELSE (D340).
-- The matcher can CHOOSE a lineup, not only validate one: fed candidates with
-- `wanted = null, fixed = false`, its augmenting-path loop (`112:519-555`)
-- runs a BFS bipartite match in ARRAY ORDER, and because an augmenting path
-- only re-routes already-matched players, no player is ever unmatched once
-- matched. Input order is therefore a strict priority order and the matchable
-- sets form a transversal matroid — greedy-by-order is OPTIMAL, not
-- approximate. Two consequences, and the second is a trap:
--   · autopilot needs no new matcher and no placement policy, so "which
--     players start" reduces to ONE `ORDER BY` (Q62);
--   · the same function is invariant 2's oracle (`checkLineupLegality` reds on
--     `unplaced` or `rearranged`), so a map built THROUGH the matcher
--     satisfies the M4 season gate BY CONSTRUCTION — whereas the sim's own
--     `chooseStarterSlots` is a greedy FIRST-FIT over slots in order, so a
--     first-fit clone here reds the gate on a contested-flex roster. The PR's
--     first break probe is exactly that substitution.
--
-- THE SORT IS Q62's RECOMMENDATION, SHIPPED ON SILENCE, AND IT IS ONE CLAUSE.
-- `ORDER BY p.adp ASC NULLS LAST, r.player_id ASC` — the same order the draft
-- autopick's never-stall floor already uses (`095:3490`). It is a PLACEHOLDER
-- SIGNAL and the PR says so: no good WEEKLY signal exists in the schema
-- (`players` carries only season-total projections in three fixed scoring
-- variants, which would contradict a league's custom scoring — the cohort's
-- own feedback focus). It is deliberately isolated as ONE clause in ONE query
-- so a weekly-projection input is later a one-line swap and not a redesign
-- (the "build for flexibility" preference), and the PR's second break probe
-- deletes it and watches §B red.
--
-- THE SUBSTITUTION ARM IS Q63's RECOMMENDATION, SHIPPED ON SILENCE, AND IT IS
-- NARROW. A seat can be unmanaged TODAY while carrying last week's lineup
-- from a manager who left mid-season (`120:645-659` keeps the roster;
-- `116:456` carries the map). Filling an EMPTY slot is unambiguously right.
-- Replacing a departed manager's HEALTHY, unlocked starter with a
-- higher-ranked bench player is a different act, and autopilot does not do
-- it: a seated starter is vacated ONLY when he is UNLOCKED and carries a
-- blocking designation or is on bye, AND ONLY WHEN a healthy, unlocked,
-- eligible replacement actually takes the slot. Never on value alone, and
-- never into an empty slot: if nobody healthy claims the vacated key the
-- seated man is RESTORED to it unchanged. That matches `spec:733`'s trigger
-- word-for-word ("officially OUT/inactive") and keeps autopilot from silently
-- out-managing the ghost of a real person.
--
-- `allow_illegal_lineups` TAKES THE SAME SPLIT THE MANAGER'S VERB TAKES
-- (tasks-M6A L.E1.4 item 4c — decided by the breakdown, not by this Builder).
-- `set_lineup` refuses a bye/OUT starter in an UNLOCKED slot by name when the
-- setting is off (`114:603-616`) and the sim mirrors the split through
-- `opts.allowIllegalLineups`. So:
--   · setting ON (the default — `season-invariants.ts`'s checkLineupLegality
--     comment: a league "legally starts a bye/OUT player, who scores 0 and is
--     FLAGGED"): a blocking designation is a PREFERENCE. Such a candidate
--     sorts to the END of the candidate list and is seated LAST rather than
--     left out, because an empty slot is the zero this task exists to remove.
--   · setting OFF: the designation is a HARD FILTER on SEATING SOMEONE NEW.
--     A slot that then has no healthy eligible candidate is named in
--     `autopilot_unfillable[]` WITH ITS REASON ("no healthy eligible player
--     at FLEX; league forbids illegal lineups"), never left as a short map.
--     The filter governs FILLING; it does not evict a man who is already
--     sitting there — that is Q63's restore clause above, and it mirrors
--     `114:605-610`'s own exemption for the stored occupant of a slot. An
--     occupied slot is therefore never turned into an empty one by a setting.
-- AUTOPILOT LIFTS NOTHING. This is independent of Q59 (which is about the
-- COMMISSIONER's verb and was RULED: timing lifted, positional legality not).
--
-- THE KILL SWITCH, NAMED HERE SO IT IS OPERABLE UNDER PRESSURE AND NOT
-- DISCOVERED BY READING A MIGRATION. 122 ships a GENERIC table —
-- `system_flags(key TEXT PRIMARY KEY, value JSONB NOT NULL, CHECK
-- jsonb_typeof(value) = 'object')` (`122:99-104`) — whose documented keys are
-- `stats_degraded` and `ingest_poll:<season>:<week>`. There is no autopilot
-- key; THIS MIGRATION MINTS ONE:
--
--     key   = 'autopilot_disabled'
--     value = {"disabled": true}          -- an object, per the CHECK
--
-- It is read ONCE per tick invocation, not once per league. `system_flags` is
-- world-SELECT with NO WRITE POLICY FOR ANY ROLE (`122:111-114`: one SELECT
-- policy and nothing else), SO AN OPERATOR DISABLES AUTOPILOT WITH A
-- `service_role` WRITE AND NOTHING ELSE. Deleting the row (or setting
-- `{"disabled": false}`) re-enables it at the very next minute. When the flag
-- is set the tick writes no lineup and `autopilot_reason` NAMES the flag.
--
-- "NEVER LET 'NOTHING HAPPENED' MEAN 'IT WORKED'" IS THE DELIVERABLE HERE,
-- NOT A SENTIMENT (§4 rule 15). A pass that fills nothing SAYS WHY:
-- `autopilot_reason` distinguishes `no_unmanaged_seats` / `nothing_fillable` /
-- `every_candidate_locked` / `no_row_and_no_materialize` /
-- `disabled_by_system_flag:autopilot_disabled`, and every seat filled, seat
-- materialized, slot refused, candidate locked and team declined is NAMED in
-- an array. The UPDATE asserts `ROW_COUNT = 1` (`119:882-886`'s shape) rather
-- than letting 0 rows read as "nothing to do".
--
-- THE THREE COLUMNS ARE WRITTEN TOGETHER, AND THAT IS NOT TIDINESS.
-- `slot_map`, `starters` and `bench` are redundant projections of one truth:
-- `checkLineupLegality` reads `slot_map` while the box score and the scoring
-- worker read `starters`, so a partial write is silent until they disagree in
-- front of a user. `locked_at` goes with them because arm (b) would otherwise
-- re-derive it one minute later and make the write look like a second change.
-- `set_at` and `edited_by_commish` are deliberately NOT touched: item 3
-- enumerates four columns, autopilot is not a commissioner act (D338), and
-- `edited_by_commish` is a user-visible badge (`team-page.tsx`).
--
-- Staging rehearsal: R6 waiver — no staging clone; rehearsal evidence = the
-- fresh local `db reset` 001-125 + pgTAP 073 + the full `npm run test:db` and
-- the stack vitest suite `lineup-autopilot-score-db.test.ts` in this PR. No
-- launch-surface table is touched: one new function, one `CREATE OR REPLACE`
-- of an existing job RPC, zero DDL.
--
-- HOLD FILE: NO entry is added for 125, and that is deliberate. The
-- production hold was CLEARED 2026-09-09 (PR #282) and production has taken
-- 123 and 124. `docs/specs/tasks-M4-inseason.md` §4 rule 11 ("extend the
-- hold's closed range in the same PR") is RETIRED for M6A by the
-- breakdown's §2.5 and §4: a hold line here would keep this fix out of the
-- very league it is written for. 125 reaches production the ordinary way,
-- `npx supabase db push`, which is CHRIS'S to run after merge; `db-drift.yml`
-- is expected to be red between merge and that push, which is the drift check
-- working.
--
-- Numbering: migration head measured `124_cron_ping_and_stall_check.sql` by
-- `ls supabase/migrations/ | tail -1` (NOT the file count — the 041-047 gap is
-- intentional, D50) ⇒ 125; pgTAP head `072_cron_ping_and_stall_check.sql` by
-- `ls supabase/tests/ | tail -1` ⇒ 073.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. lineup_autopilot_internal — the PURE chooser
--
--    PLAIN plpgsql (never SECURITY DEFINER), `SET search_path = ''`, and
--    REVOKEd from PUBLIC/anon/authenticated — `lineup_carry_internal`'s
--    posture verbatim (`116:369-383`, `:567-568`). It is called in-body by
--    `lineup_lock_tick`, which IS the DEFINER.
--
--    It reads. It does not write. The row shape it returns is 114's
--    (`starters` elements: slot / slot_key / label / player_id / position /
--    kickoff_at / flags; `bench` = roster − starters − IR; `locked_at` = the
--    earliest STARTED kickoff), byte-compatible with what `set_lineup`
--    (`114:618-624`) and the carry (`116:528-533`) write — which is what arm
--    (b) of the tick depends on when it re-reads the row next minute.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_autopilot_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_season    INTEGER,
  p_week      INTEGER,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_row         public.team_lineups;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_by_pid      JSONB := '{}'::jsonb;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_kick        JSONB := '{}'::jsonb;
  v_map         JSONB := '{}'::jsonb;
  v_ir_held     TEXT[] := ARRAY[]::text[];
  v_seated      TEXT[] := ARRAY[]::text[];   -- players staying where they are
  v_fixed       JSONB := '[]'::jsonb;        -- fit input: those same players
  v_free        JSONB := '[]'::jsonb;        -- fit input: HEALTHY unlocked candidates
  v_tail        JSONB := '[]'::jsonb;        -- fit input: the unhealthy tail (allow = TRUE)
  v_displace    JSONB := '{}'::jsonb;        -- slot key → vacated unhealthy starter
  v_restored    JSONB := '[]'::jsonb;
  v_locked_out  JSONB := '[]'::jsonb;        -- skipped_locked[]
  v_filtered    JSONB := '[]'::jsonb;        -- refused by the allow = FALSE hard filter
  v_fit_a       JSONB;
  v_fit_b       JSONB;
  v_players_b   JSONB := '[]'::jsonb;
  v_assign      JSONB;
  v_filled      JSONB := '[]'::jsonb;
  v_subbed      JSONB := '[]'::jsonb;
  v_unfill      JSONB := '[]'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_locked_at   TIMESTAMPTZ;
  v_pflags      JSONB;
  v_empties     INTEGER := 0;
  v_sick        INTEGER := 0;               -- unhealthy UNLOCKED seated starters
  v_e           JSONB;
  v_p           JSONB;
  v_k           RECORD;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_elig        JSONB;
  v_locked      BOOLEAN;
  v_unhealthy   BOOLEAN;
  v_changed     BOOLEAN;
  v_reason      TEXT;
BEGIN
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lineup_autopilot_internal: league % not found', p_league_id USING ERRCODE = 'P0002';
  END IF;

  -- The row must EXIST. D354 puts materialization in the caller, under the
  -- league lock, through the unchanged carry — so an absent row here is a
  -- caller bug and must be loud, never a silently invented lineup.
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = p_season AND tl.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'lineup_autopilot_internal: no team_lineups row for team % season % week % — the caller materializes through lineup_carry_internal first (D354); refusing to invent one',
      p_team_id, p_season, p_week
      USING ERRCODE = 'P0002';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);

  -- §7.3.6's per-league setting, read the way `set_lineup` reads it
  -- (`114:307`): absent ⇒ TRUE.
  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- THE ROSTER, in 114/116's shape (positions normalised DEF → DST;
  -- designations bridged through `lineup_designation_internal`, 112:337),
  -- plus `adp` for the one sort below.
  --
  -- Q62's SORT, AND IT IS THE WHOLE SELECTION POLICY. Placement is free
  -- (D340 — the matcher CHOOSES, and greedy-by-input-order over a transversal
  -- matroid is optimal), so "which players start" is this ORDER BY and
  -- nothing else. `adp ASC NULLS LAST, player_id ASC` is the draft autopick's
  -- own never-stall order (`095:3490`). It is a DRAFT-DAY signal doing an
  -- in-season job, shipped as a placeholder on Q62's silence and kept to ONE
  -- CLAUSE on purpose: a weekly-projection input is a one-line swap here.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',      r.player_id,
           'name',           p.full_name,
           'position',       CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',    public.lineup_designation_internal(p.status),
           'nfl_team',       p.team,
           'adp',            p.adp,
           'ir_placed_week', r.ir_placed_week,
           'slot_key',       r.slot_key)
           ORDER BY p.adp ASC NULLS LAST, r.player_id ASC), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order WITH their eligibility (the matcher's
  -- input, `114:355-362`), and the IR spots by key.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', (s ->> 'key') || ':0', 'spot', s ->> 'key') ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- A team with no roster has nothing to seat. Reported, never raised: one
  -- empty roster must not fail a league's whole tick.
  IF jsonb_array_length(v_roster) = 0 THEN
    RETURN jsonb_build_object(
      'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
      'source', 'autopilot', 'slot_map', v_stored, 'starters', v_row.starters,
      'bench', v_row.bench, 'locked_at', v_row.locked_at,
      'filled', '[]'::jsonb, 'substituted', '[]'::jsonb, 'unfillable', '[]'::jsonb,
      'skipped_locked', '[]'::jsonb, 'restored', '[]'::jsonb,
      'allow_illegal_lineups', v_allow, 'changed', FALSE,
      'reason', 'empty_roster', 'evaluated_at', p_at);
  END IF;

  -- THE PER-PLAYER LOCK DATUM, read NOW from `nfl_games` at the injected
  -- instant (E42/§23.3) — the same helper and the same rendering 114 and 116
  -- use, so arm (b) finds nothing to change next minute.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_e ->> 'nfl_team', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
  END LOOP;

  -- IR KEYS ARE CARRIED VERBATIM. IR occupancy is ROSTER-level state
  -- (D308/§11.2) and autopilot never moves it; its occupants are not
  -- candidates for a starting slot.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_pid := v_val #>> '{}';
      v_map := v_map || jsonb_build_object(v_key, v_pid);
      v_ir_held := v_ir_held || v_pid;
    END IF;
  END LOOP;

  -- CLASSIFY EVERY STARTING SLOT.
  --   · empty (or holding a player who has since been dropped) ⇒ OPEN;
  --   · holding a LOCKED player ⇒ he stays, unconditionally (D338 — the lock
  --     binds autopilot exactly as it binds a manager);
  --   · holding a HEALTHY unlocked player ⇒ he stays (D340 — a carried or
  --     manager-set placement is NEVER overridden on value);
  --   · holding an UNLOCKED player who is on bye or carries a blocking
  --     designation ⇒ VACATED for the substitution pass, and restored below
  --     if no healthy replacement takes the key (Q63).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_stored ->> v_key;
    IF v_pid IS NULL OR NOT (v_by_pid ? v_pid) THEN
      v_empties := v_empties + 1;
      CONTINUE;
    END IF;
    v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
    v_unhealthy := COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                   OR (v_by_pid -> v_pid ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended');
    IF v_locked OR NOT v_unhealthy THEN
      v_seated := v_seated || v_pid;
      v_fixed := v_fixed || jsonb_build_object(
        'player_id', v_pid, 'position', v_by_pid -> v_pid ->> 'position',
        'wanted', v_key, 'fixed', TRUE);
    ELSE
      v_displace := v_displace || jsonb_build_object(v_key, v_pid);
      v_sick := v_sick + 1;
    END IF;
  END LOOP;

  -- THE SHORT-CIRCUIT (tasks-M6A L.E1.4 item 2), BEFORE ANY FIT CALL. Nothing
  -- to fill and nobody to substitute ⇒ no matcher runs and the caller writes
  -- nothing. It lives HERE, in the one place that holds both halves of the
  -- predicate, rather than being half-duplicated in the tick where the
  -- designations and kickoffs are not in scope — the load mitigation is the
  -- predicate, not the cadence.
  IF v_empties = 0 AND v_sick = 0 THEN
    RETURN jsonb_build_object(
      'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
      'source', 'autopilot', 'slot_map', v_stored, 'starters', v_row.starters,
      'bench', v_row.bench, 'locked_at', v_row.locked_at,
      'filled', '[]'::jsonb, 'substituted', '[]'::jsonb, 'unfillable', '[]'::jsonb,
      'skipped_locked', '[]'::jsonb, 'restored', '[]'::jsonb,
      'allow_illegal_lineups', v_allow, 'changed', FALSE,
      'reason', 'no_empty_slot_and_no_unhealthy_unlocked_starter', 'evaluated_at', p_at);
  END IF;

  -- THE CANDIDATE POOLS, in the roster's Q62 order.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_held);
    CONTINUE WHEN v_pid = ANY (v_seated);
    v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
    IF v_locked THEN
      -- D338: never lifted, and never silently dropped.
      v_locked_out := v_locked_out || jsonb_build_object(
        'player_id', v_pid, 'name', v_e ->> 'name', 'position', v_e ->> 'position',
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'reason', 'his game had already kicked off at the tick instant (§11.2, lineup_lock = per_player_kickoff) — autopilot does not inherit the commissioner''s exemption (D338)');
      CONTINUE;
    END IF;
    v_unhealthy := COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                   OR (v_e ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended');
    IF v_unhealthy THEN
      IF v_allow THEN
        -- A PREFERENCE, not a filter: seated LAST, never left out, because an
        -- empty slot is the zero this task exists to remove (item 4c).
        v_tail := v_tail || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
      ELSE
        v_filtered := v_filtered || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position');
      END IF;
      CONTINUE;
    END IF;
    v_free := v_free || jsonb_build_object(
      'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
  END LOOP;

  -- PASS 1 — the HEALTHY pass. Seated players are `fixed` at their own key;
  -- every vacated slot and every empty slot is contested by the healthy
  -- candidates in priority order. This is the pass that decides whether a
  -- substitution happens at all.
  v_fit_a := public.lineup_fit_internal(v_slots, v_fixed || v_free);

  -- Q63's RESTORE. A vacated unhealthy starter whose key nobody healthy took
  -- goes straight back where he was: autopilot substitutes only when a
  -- healthy, unlocked, eligible replacement ACTUALLY takes the slot, and it
  -- never turns an occupied slot into an empty one.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_displace) LOOP
    v_pid := v_val #>> '{}';
    IF (v_fit_a -> 'assignment' ->> v_key) IS NULL THEN
      v_restored := v_restored || jsonb_build_object(
        'slot', v_key, 'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        'reason', 'no healthy, unlocked, eligible replacement existed — left exactly as he was (Q63)');
      v_seated := v_seated || v_pid;
      v_players_b := v_players_b || jsonb_build_object(
        'player_id', v_pid, 'position', v_by_pid -> v_pid ->> 'position',
        'wanted', v_key, 'fixed', TRUE);
    ELSE
      v_subbed := v_subbed || jsonb_build_object(
        'slot', v_key, 'out', v_pid, 'out_name', v_by_pid -> v_pid ->> 'name',
        'in', v_fit_a -> 'assignment' ->> v_key,
        'in_name', v_by_pid -> (v_fit_a -> 'assignment' ->> v_key) ->> 'name',
        'reason', CASE WHEN COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                       THEN 'on bye' ELSE 'designated ' || (v_by_pid -> v_pid ->> 'designation') END);
    END IF;
  END LOOP;

  -- PASS 2 — the TAIL pass. Pass 1's whole assignment is re-seeded `fixed`
  -- (112:501-505 seeds a fixed player at his wanted key unconditionally, so
  -- pass 1's result is reproduced exactly), the restored men with it, and the
  -- remaining slots are offered to the unhealthy tail — which is empty when
  -- the league forbids illegal lineups, leaving those slots `unfillable`.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit_a -> 'assignment') LOOP
    v_players_b := v_players_b || jsonb_build_object(
      'player_id', v_val #>> '{}',
      'position', v_by_pid -> (v_val #>> '{}') ->> 'position',
      'wanted', v_key, 'fixed', TRUE);
  END LOOP;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_tail) LOOP
    CONTINUE WHEN (v_e ->> 'player_id') = ANY (v_seated);
    v_players_b := v_players_b || v_e;
  END LOOP;
  v_fit_b := public.lineup_fit_internal(v_slots, v_players_b);
  v_assign := v_fit_b -> 'assignment';
  v_map := v_map || v_assign;

  -- WHAT WAS FILLED, AND WHAT COULD NOT BE — with the slot KEY and a REASON
  -- string, never merely a short map (§4 rule 15).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_elig := v_e -> 'eligible';
    v_pid := v_assign ->> v_key;
    IF v_pid IS NULL THEN
      v_unfill := v_unfill || jsonb_build_object('slot', v_key, 'slot_key', v_e ->> 'slot',
        'reason', CASE
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_filtered) x WHERE v_elig ? (x ->> 'position'))
            THEN 'no healthy eligible player at ' || upper(v_e ->> 'slot') || '; league forbids illegal lineups'
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> 'position'))
            THEN 'no unlocked eligible player at ' || upper(v_e ->> 'slot') || '; every candidate''s game had kicked off'
          ELSE 'no eligible player at ' || upper(v_e ->> 'slot') || ' on the roster' END);
    ELSIF (v_stored ->> v_key) IS DISTINCT FROM v_pid AND NOT (v_displace ? v_key) THEN
      v_filled := v_filled || jsonb_build_object('slot', v_key, 'player_id', v_pid,
        'name', v_by_pid -> v_pid ->> 'name', 'position', v_by_pid -> v_pid ->> 'position');
    END IF;
  END LOOP;

  -- STARTERS + flags + `locked_at`, 114 (10)'s shape byte-for-byte
  -- (`114:618-624` / `116:528-533`). `bench` = roster − starters − IR.
  v_locked_at := NULL;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_map ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
    ELSE
      v_p := v_by_pid -> v_pid;
      v_started := v_started || v_pid;
      IF COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE) THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
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
    AND NOT ((e ->> 'player_id') = ANY (v_ir_held));

  -- THE NO-OP, BY VALUE. jsonb equality over the map — the same test
  -- `set_lineup` uses (`114:633`); the other three columns are projections of
  -- it, and arm (b) owns the kickoff refresh of an unchanged row.
  v_changed := (v_map IS DISTINCT FROM v_stored);
  v_reason := CASE
    WHEN v_changed THEN NULL
    WHEN jsonb_array_length(v_unfill) > 0 THEN 'nothing_fillable'
    ELSE 'no_change' END;

  RETURN jsonb_build_object(
    'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
    'source', 'autopilot',
    'slot_map', v_map, 'starters', v_starters, 'bench', v_bench, 'locked_at', v_locked_at,
    'filled', v_filled, 'substituted', v_subbed, 'unfillable', v_unfill,
    'skipped_locked', v_locked_out, 'restored', v_restored,
    'allow_illegal_lineups', v_allow,
    'changed', v_changed, 'reason', v_reason, 'evaluated_at', p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_autopilot_internal(UUID, UUID, INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION lineup_autopilot_internal(UUID, UUID, INTEGER, INTEGER, TIMESTAMPTZ) IS
  '§7.2.1(c) autopilot (125, L.E1.4 — D337/D338/D339/D340/D354, Q62/Q63). PURE: reads the roster, the slots, the designations and the per-player kickoffs at p_at and RETURNS the 114-shaped row it would write (slot_map/starters/bench/locked_at) plus filled[]/substituted[]/unfillable[]/skipped_locked[]/restored[]/changed/reason. Writes nothing — lineup_lock_tick arm (c) is the writer. Places exclusively through lineup_fit_internal (D340); candidate order is ONE clause (Q62: adp ASC NULLS LAST, player_id ASC); never lifts the per-player kickoff lock (D338); substitutes only an unlocked bye/OUT starter and only when a healthy replacement takes the key (Q63); allow_illegal_lineups = FALSE is a hard filter on FILLING only (item 4c).';

-- ---------------------------------------------------------------------------
-- 2. lineup_lock_tick — CREATE OR REPLACE against 119:696's FILE TEXT (D137),
--    FOUR HUNKS (H1 DECLARE · H2 the kill switch · H3 arm (c) · H4 the
--    report). Arms (a) and (b) are byte-untouched, INCLUDING (b)'s SELECT
--    list (D354 — arm (c) has its own driving query).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_lock_tick(
  p_now       TIMESTAMPTZ DEFAULT now(),
  p_league_id UUID        DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch     CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_seen           UUID[] := '{}';
  v_loops          INTEGER := 0;
  v_pass           INTEGER;
  v_lg             RECORD;
  v_league         public.leagues;
  v_current        INTEGER;
  v_pool           RECORD;
  v_lock           JSONB;
  v_new_until      TIMESTAMPTZ;
  v_new_state      TEXT;
  v_row            RECORD;
  v_e              JSONB;
  v_pid            TEXT;
  v_team           TEXT;
  v_k              RECORD;
  v_new_locked_at  TIMESTAMPTZ;
  v_new_starters   JSONB;
  v_changed        BOOLEAN;
  v_cnt            INTEGER;
  v_leagues        INTEGER := 0;
  v_pool_rows      INTEGER := 0;
  v_pool_updates   INTEGER := 0;
  v_lineups        INTEGER := 0;
  v_lineup_updates INTEGER := 0;
  v_pool_changed   INTEGER := 0;   -- 119: THIS league's pool rows changed this pass — the coalescing key (D296/F252(a))
  v_pool_events    INTEGER := 0;   -- 119: pool broadcasts sent this run (one per league per pass that changed ≥ 1 row)
  v_skipped        JSONB := '[]'::jsonb;
  v_failures       JSONB := '[]'::jsonb;
  -- 125 (H1) — AUTOPILOT, arm (c). D337/D338/D339/D340/D354.
  v_ap_off         BOOLEAN;        -- the kill switch, read ONCE per invocation (H2)
  v_ap             RECORD;
  v_ap_r           JSONB;
  v_ap_seats       INTEGER := 0;   -- unmanaged seats arm (c) EVALUATED
  v_ap_writes      INTEGER := 0;   -- lineup rows arm (c) wrote
  v_ap_no_member   INTEGER := 0;   -- teams declined: no league_members row at all (D339)
  v_ap_no_row      INTEGER := 0;   -- seats with no lineup row that were NOT materialized
  v_autopiloted    JSONB := '[]'::jsonb;
  v_ap_mat         JSONB := '[]'::jsonb;
  v_ap_unfill      JSONB := '[]'::jsonb;
  v_ap_locked      JSONB := '[]'::jsonb;
BEGIN
  -- A job, not a user verb: a JWT-bearing caller is refused in-body (rule 2
  -- — the REVOKE below narrows EXECUTE; this says why in the body).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'lineup_lock_tick: a job RPC is run by pg_cron or the service role, never by a signed-in user'
      USING ERRCODE = '42501';
  END IF;

  -- 125 (H2) — THE KILL SWITCH, read ONCE per invocation and not once per
  -- league (item 4b). `system_flags` is world-SELECT with NO WRITE POLICY FOR
  -- ANY ROLE (122:111-114), so an operator disables autopilot with a
  -- `service_role` write and nothing else:
  --     insert into system_flags (key, value)
  --     values ('autopilot_disabled', '{"disabled": true}')
  --     on conflict (key) do update set value = excluded.value, updated_at = now();
  -- Deleting the row re-enables it at the next minute. Nothing else in the
  -- tick is affected: the pool view and the lineup record keep running.
  SELECT COALESCE((f.value ->> 'disabled')::boolean, FALSE) INTO v_ap_off
  FROM public.system_flags f
  WHERE f.key = 'autopilot_disabled';
  v_ap_off := COALESCE(v_ap_off, FALSE);

  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    FOR v_lg IN
      SELECT l.id
      FROM public.leagues l
      WHERE l.status IN ('in_season', 'playoffs')
        AND l.deleted_at IS NULL
        AND (p_league_id IS NULL OR l.id = p_league_id)
        AND NOT (l.id = ANY (v_seen))
      ORDER BY l.id
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_lg.id;
      v_leagues := v_leagues + 1;

      BEGIN
        v_pool_changed := 0;
        SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_lg.id;
        v_current := public.lineup_current_week_internal(v_lg.id, p_now);
        IF v_current IS NULL THEN
          v_skipped := v_skipped || jsonb_build_object('league_id', v_lg.id, 'reason', 'no_league_weeks');
          CONTINUE;
        END IF;

        -- (a) THE POOL VIEW — what 115's helper says, and nothing else.
        FOR v_pool IN
          SELECT pp.player_id, pp.state, pp.locked_until, p.team AS nfl_team
          FROM public.league_player_pool pp
          JOIN public.players p ON p.id = pp.player_id
          WHERE pp.league_id = v_lg.id
          ORDER BY pp.player_id
        LOOP
          v_pool_rows := v_pool_rows + 1;
          v_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_pool.nfl_team, p_now);
          IF (v_lock ->> 'locked')::boolean THEN
            -- Locked: until the week's recorded last game end — or 'infinity'
            -- while that end is NOT YET RECORDED (F238's loud state; never a
            -- NULL that reads as unlocked, never a release the helper did
            -- not compute).
            v_new_until := COALESCE((v_lock ->> 'window_ends_at')::timestamptz, 'infinity'::timestamptz);
          ELSE
            v_new_until := NULL;
          END IF;
          v_new_state := CASE
            WHEN v_pool.state = 'free_agent'     AND v_new_until IS NOT NULL THEN 'locked_in_game'
            WHEN v_pool.state = 'locked_in_game' AND v_new_until IS NULL     THEN 'free_agent'
            ELSE v_pool.state END;   -- on_waivers / rostered keep their state (F222(a) CHECK; D294 mirror)
          IF v_new_until IS DISTINCT FROM v_pool.locked_until
             OR v_new_state IS DISTINCT FROM v_pool.state THEN
            UPDATE public.league_player_pool pp
            SET locked_until = v_new_until, state = v_new_state, updated_at = p_now
            WHERE pp.league_id = v_lg.id AND pp.player_id = v_pool.player_id;
            GET DIAGNOSTICS v_cnt = ROW_COUNT;
            IF v_cnt <> 1 THEN
              RAISE EXCEPTION 'lineup_lock_tick: pool refresh for % touched % rows, expected 1', v_pool.player_id, v_cnt
                USING ERRCODE = 'P0001';
            END IF;
            v_pool_updates := v_pool_updates + 1;
            v_pool_changed := v_pool_changed + 1;
          END IF;
        END LOOP;

        -- 119 (D296 / F252(a)): the pool's ONE broadcast — a per-league
        -- SUMMARY sent once per pass, only when this pass changed at least
        -- one pool row (a kickoff or a release instant; the guarded UPDATE
        -- above is diff-aware, so a quiet minute sends nothing). Never a
        -- row trigger (a slate kickoff would be one event per locked
        -- player per league — the broadcast storm §22.2 coalesces away),
        -- never per-player lines: the client refetches the rosters route.
        -- The 088 per-STATEMENT summary precedent: event = the table's
        -- name, `operation` UPDATE, `record` = the summary. realtime.send
        -- traps its own errors (070 banner) — an outage never fails a tick.
        IF v_pool_changed > 0 THEN
          PERFORM realtime.send(
            jsonb_build_object(
              'operation', 'UPDATE',
              'table',     'league_player_pool',
              'schema',    'public',
              'record',    jsonb_build_object(
                'season',  v_league.season,
                'week',    v_current,
                'changed', v_pool_changed,
                'at',      p_now)),
            'league_player_pool',
            'league:' || v_lg.id::text,
            true);
          v_pool_events := v_pool_events + 1;
        END IF;

        -- (b) THE LINEUP RECORD — locked_at + each starter's kickoff_at,
        --     re-evaluated from nfl_games at p_now (E42: a moved kickoff
        --     moves the record; E43: a postponed-out kickoff releases it).
        FOR v_row IN
          SELECT tl.id, tl.week, tl.starters, tl.locked_at
          FROM public.team_lineups tl
          JOIN public.teams t ON t.id = tl.team_id
          JOIN public.league_weeks lw
            ON lw.league_id = t.league_id AND lw.season = tl.season AND lw.week = tl.week
          WHERE t.league_id = v_lg.id
            AND tl.season = v_league.season
            AND tl.week <= v_current
            AND lw.status <> 'final'
            AND tl.slot_map IS NOT NULL
          ORDER BY tl.week, tl.team_id
        LOOP
          v_lineups := v_lineups + 1;
          v_new_locked_at := NULL;
          v_new_starters := '[]'::jsonb;
          v_changed := FALSE;
          FOR v_e IN SELECT * FROM jsonb_array_elements(v_row.starters) LOOP
            v_pid := v_e ->> 'player_id';
            IF v_pid IS NULL THEN
              v_new_starters := v_new_starters || v_e;
              CONTINUE;
            END IF;
            SELECT p.team INTO v_team FROM public.players p WHERE p.id = v_pid;
            SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_row.week, v_team, p_now);
            -- Compare INSTANTS, not rendered text (a session TimeZone renders
            -- the same instant differently — idempotence must not depend on it).
            IF (v_e ->> 'kickoff_at')::timestamptz IS DISTINCT FROM v_k.kickoff_at THEN
              v_changed := TRUE;
              v_new_starters := v_new_starters || (v_e || jsonb_build_object('kickoff_at', v_k.kickoff_at));
            ELSE
              v_new_starters := v_new_starters || v_e;
            END IF;
            IF v_k.kickoff_at IS NOT NULL THEN
              v_new_locked_at := LEAST(v_new_locked_at, v_k.kickoff_at);
            END IF;
          END LOOP;
          IF v_changed OR v_new_locked_at IS DISTINCT FROM v_row.locked_at THEN
            UPDATE public.team_lineups tl
            SET locked_at = v_new_locked_at,
                starters  = CASE WHEN v_changed THEN v_new_starters ELSE tl.starters END
            WHERE tl.id = v_row.id;
            GET DIAGNOSTICS v_cnt = ROW_COUNT;
            IF v_cnt <> 1 THEN
              RAISE EXCEPTION 'lineup_lock_tick: lineup record refresh for % touched % rows, expected 1', v_row.id, v_cnt
                USING ERRCODE = 'P0001';
            END IF;
            v_lineup_updates := v_lineup_updates + 1;
          END IF;
        END LOOP;

        -- 125 (H3) — (c) AUTOPILOT for a seat with NO MANAGER (§7.2.1(c),
        --     `spec:185`). Its OWN driving query, because (b) reads FROM
        --     `team_lineups` and a seat with no row for the week is invisible
        --     to it (D354). Inside the same per-league loop, so it inherits
        --     the `leagues FOR UPDATE SKIP LOCKED` row lock and the
        --     failure containment below — a league whose autopilot raises
        --     lands in `failures[]` and the next league still runs.
        IF NOT v_ap_off THEN
          FOR v_ap IN
            SELECT t.id AS team_id,
                   tl.id AS lineup_id,
                   EXISTS (SELECT 1 FROM public.league_members m WHERE m.team_id = t.id) AS has_member
            FROM public.teams t
            JOIN public.league_weeks lw
              ON lw.league_id = t.league_id
             AND lw.season = v_league.season
             AND lw.week = v_current
            LEFT JOIN public.team_lineups tl
              ON tl.team_id = t.id
             AND tl.season = v_league.season
             AND tl.week = v_current
            WHERE t.league_id = v_lg.id
              AND t.status <> 'retired'
              -- NEVER a past week in correction_window: `tl.week = v_current`
              -- does not imply `live` (112:360-374 derives v_current from
              -- nfl_weeks.starts_at, so the current week sits in
              -- correction_window from the last whistle until finalize, and
              -- filling it then is a scoring rewrite).
              AND lw.status = 'live'
              -- D339: the exact complement of set_lineup's own auth
              -- (114:240-243). Covers the placeholder seat AND the vacated
              -- seat with no OR, because they converge in this table.
              AND NOT EXISTS (
                SELECT 1 FROM public.league_members m
                WHERE m.team_id = t.id AND m.user_id IS NOT NULL)
            ORDER BY t.id
          LOOP
            -- D339's UNSAFE FAILURE DIRECTION, asserted and not inferred: the
            -- predicate above is ALSO true of a team with NO member row at
            -- all, and autopilot would then seize a human's team. Declined,
            -- and NAMED.
            IF NOT v_ap.has_member THEN
              v_ap_no_member := v_ap_no_member + 1;
              IF v_ap.lineup_id IS NULL THEN
                v_ap_no_row := v_ap_no_row + 1;
              END IF;
              v_skipped := v_skipped || jsonb_build_object(
                'league_id', v_lg.id, 'team_id', v_ap.team_id,
                'reason', 'no_league_members_row',
                'why', 'one league_members row per seat is a §12.2 invariant stated in code, not schema (120:558) — a seat with none is NOT proven unmanaged, so autopilot declines rather than seizing a human''s team (D339)');
              CONTINUE;
            END IF;

            -- D354: a seat with NO row for the live week — the mid-week
            -- `add_placeholder_seat` case (063:455-465) — is MATERIALIZED
            -- through the UNCHANGED carry and then filled. It is 0 rows
            -- because the week's one-shot carry loop (118:1816-1824) had
            -- ALREADY RUN for this week; the carry's own INSERT has no
            -- ON CONFLICT, so a concurrent materialize is a loud 23505 in
            -- `failures[]` rather than a silent second row (116:541-551).
            IF v_ap.lineup_id IS NULL THEN
              PERFORM public.lineup_carry_internal(v_lg.id, v_ap.team_id, v_league.season, v_current, p_now);
              v_ap_mat := v_ap_mat || jsonb_build_object(
                'league_id', v_lg.id, 'team_id', v_ap.team_id, 'week', v_current,
                'why_absent', 'the week''s one-shot auto-carry (118:1816-1824) had already run when this seat was minted');
            END IF;

            v_ap_r := public.lineup_autopilot_internal(
              v_lg.id, v_ap.team_id, v_league.season, v_current, p_now);
            v_ap_seats := v_ap_seats + 1;

            -- Reported whether or not anything was written: a refused slot and
            -- a locked candidate are facts about the pass, not about the write.
            FOR v_e IN SELECT * FROM jsonb_array_elements(v_ap_r -> 'unfillable') LOOP
              v_ap_unfill := v_ap_unfill || (v_e || jsonb_build_object('team_id', v_ap.team_id));
            END LOOP;
            FOR v_e IN SELECT * FROM jsonb_array_elements(v_ap_r -> 'skipped_locked') LOOP
              v_ap_locked := v_ap_locked || (v_e || jsonb_build_object('team_id', v_ap.team_id));
            END LOOP;

            IF (v_ap_r ->> 'changed')::boolean THEN
              -- The FOUR columns TOGETHER (116:543-546) — never `slot_map`
              -- alone: they are redundant projections of one truth and a
              -- partial write is silent until they disagree in front of a
              -- user. `set_at` / `edited_by_commish` are deliberately not
              -- touched (autopilot is a SYSTEM act — D338).
              UPDATE public.team_lineups tl
              SET slot_map  = v_ap_r -> 'slot_map',
                  starters  = v_ap_r -> 'starters',
                  bench     = v_ap_r -> 'bench',
                  locked_at = (v_ap_r ->> 'locked_at')::timestamptz
              WHERE tl.team_id = v_ap.team_id
                AND tl.season = v_league.season
                AND tl.week = v_current;
              GET DIAGNOSTICS v_cnt = ROW_COUNT;
              IF v_cnt <> 1 THEN
                RAISE EXCEPTION 'lineup_lock_tick: autopilot write for team % week % touched % rows, expected 1', v_ap.team_id, v_current, v_cnt
                  USING ERRCODE = 'P0001';
              END IF;
              v_ap_writes := v_ap_writes + 1;
              v_autopiloted := v_autopiloted || jsonb_build_object(
                'league_id',   v_lg.id,
                'team_id',     v_ap.team_id,
                'week',        v_current,
                'filled',      v_ap_r -> 'filled',
                'substituted', v_ap_r -> 'substituted',
                'restored',    v_ap_r -> 'restored',
                'slot_map',    v_ap_r -> 'slot_map',
                'locked_at',   v_ap_r -> 'locked_at',
                'materialized', v_ap.lineup_id IS NULL);
            END IF;
          END LOOP;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'lineup_lock_tick failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass < c_batch OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'at',             p_now,
    'scope',          p_league_id,
    'leagues',        v_leagues,
    'pool_rows',      v_pool_rows,
    'pool_updates',   v_pool_updates,
    'pool_events',    v_pool_events,
    'lineups',        v_lineups,
    'lineup_updates', v_lineup_updates,
    'skipped',        v_skipped,
    'failures',       v_failures,
    'loops',          v_loops,
    -- 125 (H4): autopilot's report. Every seat filled, every seat
    -- materialized, every slot refused AND WHY, every candidate left behind
    -- by the lock — and a reason when nothing was filled at all (§4 rule 15).
    'autopiloted',          v_autopiloted,
    'seats_materialized',   v_ap_mat,
    'autopilot_unfillable', v_ap_unfill,
    'skipped_locked',       v_ap_locked,
    'autopilot_reason', CASE
      WHEN v_ap_off THEN 'disabled_by_system_flag:autopilot_disabled'
      WHEN v_ap_writes > 0 THEN NULL                       -- the arrays say what happened
      -- Precisely worded on purpose: arm (c)'s driving query is bounded to
      -- `lw.status = 'live'`, so "saw nothing" also covers an unmanaged seat
      -- in a current week that has closed into `correction_window`. A bare
      -- "no unmanaged seats" there would be a plausible-looking silence about
      -- a seat that does exist (§4 rule 15).
      WHEN v_ap_seats = 0 AND v_ap_no_member = 0 THEN 'no_unmanaged_seats_in_a_live_current_week'
      WHEN v_ap_seats = 0 AND v_ap_no_row > 0 THEN 'no_row_and_no_materialize'
      WHEN jsonb_array_length(v_ap_unfill) = 0
           AND jsonb_array_length(v_ap_locked) > 0 THEN 'every_candidate_locked'
      ELSE 'nothing_fillable' END,
    'reason', CASE
      WHEN v_leagues = 0 THEN 'no_in_season_leagues'
      -- 125 (H4): `v_ap_writes` joins the two 119 counters, so a pass that
      -- autopiloted can never report `no_changes`.
      WHEN v_pool_updates + v_lineup_updates + v_ap_writes = 0 THEN 'no_changes'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_lock_tick(TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;
