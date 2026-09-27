-- ============================================================================
-- 138_autopilot_q62_order.sql — autopilot's selection order (Q62, as RULED)
-- and `Doubtful` sits (M6A task L.E1.21, added by ruling 2026-09-27; PROGRESS
-- Q62 / Q63 (RULED), F379 last third, D375; discharges F389 and F387's read
-- half; spec v2.16.45 §7.2.1(c) (the v2.16.42 Q62/Q63 ruling note) + §12.28;
-- tasks-M6A §6's 2026-09-27 amendment, L.E1.21; tasks-M6A §4 rules 11-15).
--
-- Numbering (D161 — measured at task time, not trusted from any plan):
-- `ls supabase/migrations | tail -1` → 137_league_player_values.sql ⇒ 138;
-- `ls supabase/tests | tail -1` → 085_league_player_values.sql ⇒ pgTAP 086.
-- NOT held: reaches production by `npx supabase db push` like any other
-- migration. Production is at 134 — push debt becomes 135–138.
--
-- EDITED IN PLACE BY #316's FIX ROUND (2026-09-27; R1120–R1125; D375(12)) —
-- UNPUSHED, so the file is amended rather than followed by a 139 (the 129 /
-- 135 precedent). What the round changed here: the tick joins this migration
-- with ONE hunk forwarding `order_basis` into `autopiloted[]` (R1122, §2
-- below); `order_basis` counts the pass's CANDIDATES, never IR-held / seated /
-- locked / filtered men (R1125); the values join's four predicates are
-- commented as load-bearing (R1120 — the pins are in pgTAP 086).
--
-- ---------------------------------------------------------------------------
-- THE RULING (Chris, 2026-09-27 — PROGRESS §3 Q62, spec §7.2.1(c))
-- ---------------------------------------------------------------------------
-- Autopilot starts the eligible player with the HIGHEST PROJECTED POINTS:
-- (1) this week's projected points under the league's scoring; (2) season-to-
-- date fantasy points under the league's scoring — across positions (a FLEX
-- slot) "total scored points"; (3) Week 1 / no games yet: preseason projected
-- points (its SOURCE is the docs session's reading, built by L.E1.20 — R1093);
-- (4) ADP, then player_id. And `Doubtful` SITS: swapped out only when a
-- healthy, unlocked, eligible replacement takes his key — otherwise "yes start
-- the doubtful" — and `Questionable` still plays. Q63 (ruled the same day):
-- autopilot keeps a set lineup and substitutes ONLY a starter who cannot play.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES — TWO FUNCTIONS, `CREATE OR REPLACE` (the second
-- added by the fix round, R1122)
-- ---------------------------------------------------------------------------
-- (1) `lineup_autopilot_internal` (the PURE chooser, D356(1)) is replaced against
-- the CURRENT FILE TEXT of its newest defining migration —
-- `125_lineup_autopilot.sql:328-704` (measured: grep for its CREATE across
-- supabase/migrations → 125 only; 126 and 127 merely NAME it in comments) —
-- never against `pg_get_functiondef` (D137). NINE HUNKS by `diff -u` against
-- that range, each named:
--   (H1) DECLARE: the freshness constant `c_max_age` (6 hours), the Doubtful
--        tail, the blocked flag and the order basis;
--   (H2) the roster query's comment block;
--   (H3) the roster query ITSELF: LEFT JOIN `league_player_values` (137)
--        for (league, season, week), the freshness gate, the per-player
--        `order` object, and THE ONE ORDER BY —
--          projected DESC NULLS LAST, season DESC NULLS LAST,
--          preseason DESC NULLS LAST, adp ASC NULLS LAST, player_id ASC;
--   (H4) the slot-classification test (`125:514`) gains 'Doubtful';
--   (H5) the candidate-pool test (`125:563`) gains 'Doubtful' SPLIT from
--        the blocked designations (see DOUBTFUL below);
--   (H6) `substituted[]` entries carry the incoming man's `order`, the pass-2
--        comment is corrected, and pass 2 offers the Doubtful tail AHEAD of
--        the blocked tail;
--   (H7) `filled[]` entries carry the seated man's `order`;
--   (H8) `order_basis` is computed; (H9) and returned.
-- Everything else in the function is byte-identical — including the `out`
-- starter flag (`125:664`), all three `unfillable[]` reason strings (pinned
-- to the newest definer's file text by `season-invariants.test.ts`, R1076),
-- the two early RETURNs (`empty_roster`, the short-circuit — nothing is
-- picked there, so there is no order to report), the kickoff lock (D338),
-- the IR carry, the restore clause (Q63) and the matcher calls (D340).
-- (2) `lineup_lock_tick` (the SECURITY DEFINER writer) — replaced against
-- `125:715-1137`'s file text with EXACTLY ONE hunk (R1122): arm (c)'s
-- `autopiloted[]` entry gains `order_basis`. The per-pick `order` fields
-- already reached the tick's report, because arm (c) forwards `filled` /
-- `substituted` verbatim (`125:1060-1063`); the PASS-level `order_basis` did
-- not, so the build's "a pass with no usable value says it fell back to ADP"
-- was true of the chooser and false of the report. Now it is true of every
-- WRITTEN seat's report entry (a pass that changed nothing writes no entry —
-- 125's rule, unchanged). pgTAP 086 A7 pins the new prosrc md5 and A7b proves
-- the prosrc minus the hunk's text is 125's md5, byte for byte.
--
-- ---------------------------------------------------------------------------
-- THE READING THIS TASK CARRIES, FLAGGED FOR ITS REVIEWER (tasks-M6A L.E1.21)
-- ---------------------------------------------------------------------------
-- The fallback chain is ONE LEXICOGRAPHIC ORDER BY, PER PLAYER: any player
-- with a projection outranks every player without one, and the season /
-- preseason / ADP keys order only the players the earlier keys leave NULL or
-- tied. The OTHER reading — fall back for the WHOLE league-week only when
-- projections are absent — is NOT taken. Built as the task specifies; not
-- re-decided here.
--
-- ---------------------------------------------------------------------------
-- F389 — THE VALUES' JOIN CONTRACT, DISCHARGED
-- ---------------------------------------------------------------------------
-- (a) LEFT JOIN, never inner: a rostered player with NO values row stays in
--     the pool with all three points keys NULL (so he sorts by ADP after
--     every valued player) and is NAMED — `order.value_row = 'no_value_row'`
--     on his entry and his id in `order_basis.no_value_row[]`.
-- (b) The sort reads ONLY `projected_points` / `season_points` /
--     `preseason_points`. `projected_missing` is REPORTED (as
--     `order.projected_why`), `*_unscored` is not read at all; neither is a
--     sort key.
-- (c) = F387's READ HALF, below.
--
-- F387's READ HALF — A STALE VALUE IS ABSENT ⇒ THE NEXT KEY. Two bounds, both
-- `c_max_age` = 6 hours at the injected instant `p_at` (never a wall clock):
--   · the ROW: `computed_at < p_at - 6h` ⇒ the whole row is treated as absent
--     (`value_row = 'stale_row'`) — the values job has stopped landing
--     (F388's silent-tail shape is exactly this), so its season / preseason
--     numbers are as suspect as its projection;
--   · the PROJECTION: `projection_fetched_at < p_at - 6h` ⇒ the projected key
--     alone is absent (`projected_why = 'stale_line_at_read'`) and season
--     points order him — the projections sync has stopped landing even though
--     the values job is still re-scoring the last good line.
-- Six hours is the compute half's own `PROJECTION_MAX_AGE_MS`
-- (`player-values.ts:116`, D374(7)) with its own boundary (age ≤ 6h is
-- fresh), so a line the job would still score is a line the read still
-- trusts; a unit cell pins the two constants equal. A `computed_at` AFTER
-- `p_at` is not stale (the age is negative — the compute half's rule too).
--
-- ---------------------------------------------------------------------------
-- DOUBTFUL — A PREFERENCE, NEVER THE HARD FILTER (RULED: "yes start the
-- doubtful")
-- ---------------------------------------------------------------------------
-- `Doubtful` joins the two CLASSIFICATION sites and NOT the `out` starter
-- flag: a Doubtful start is LEGAL for a manager (`114:596` lists five
-- designations and not Doubtful; `season-invariants.test.ts` pins that), so:
--   · a SEATED, unlocked Doubtful starter is vacated for pass 1 and either a
--     HEALTHY replacement takes his key (`substituted[]`, reason
--     'designated Doubtful') or the restore clause puts him back
--     (`restored[]`) — a slot is never emptied on his account;
--   · a Doubtful CANDIDATE is never in pass 1 (healthy only) and is offered
--     in pass 2 UNDER BOTH `allow_illegal_lineups` values — never
--     `v_filtered`, so never an `unfillable[]` "league forbids illegal
--     lineups" slot;
--   · pass 2 offers the Doubtful tail AHEAD of the blocked tail (bye / OUT /
--     IR / PUP / NFI / Suspended, allow = TRUE only). Before this migration a
--     Doubtful man was HEALTHY and so always ahead of every blocked man; the
--     ruling moves him behind every healthy candidate and says nothing about
--     the blocked men, so his place relative to THEM is kept, not re-decided
--     (flagged for the reviewer — D375(4)).
-- A CONSEQUENCE BUILT AS THE RULING READS AND RECORDED, NOT DECIDED (Q68):
-- an UNLOCKED OUT (or bye) starter whose only unlocked eligible bench
-- replacement is Doubtful is NO LONGER substituted — Q63's ruled rule is
-- "only when a HEALTHY, unlocked, eligible replacement exists", and Doubtful
-- now "sits". Before 138 that Doubtful man counted as healthy and took the
-- key. pgTAP 086 pins the built behaviour by name; a different answer is a
-- one-hunk migration.
--
-- ---------------------------------------------------------------------------
-- WHAT THE RESULT GAINS (§4 rule 15 — "nothing happened" is never "it worked")
-- ---------------------------------------------------------------------------
--   · every `filled[]` / `substituted[]` entry: `order` = { ordered_by
--     ('projected_points' | 'season_points' | 'preseason_points' | 'adp' |
--     'player_id'), the three points values as READ (NULL when absent or
--     stale), adp, value_row ('fresh' | 'no_value_row' | 'stale_row'),
--     projected_why (NULL | 'no_line' | 'stale_line' | 'stale_line_at_read'
--     | 'no_value_row' | 'stale_row') };
--   · `order_basis` = { candidates, by_key counts, no_value_row[],
--     stale_value_row[], max_age, fell_back_to_adp, fallback_why } — over the
--     pass's CANDIDATES only (R1125) — a week with NO usable value SAYS it
--     fell back to ADP and WHY ('no_value_rows' / 'all_value_rows_stale' /
--     'no_fresh_value_row' / 'no_points_in_any_value_row', each with a
--     plain-words tail); forwarded into the tick's `autopiloted[]` (R1122).
--
-- ---------------------------------------------------------------------------
-- POSTURE, CHECKLIST, WAIVERS
-- ---------------------------------------------------------------------------
-- The chooser stays PLAIN plpgsql (never SECURITY DEFINER), `SET search_path
-- = ''`, every relation schema-qualified, REVOKEd from PUBLIC / anon /
-- authenticated — 125's posture verbatim; its one caller is the DEFINER tick.
-- The tick stays SECURITY DEFINER with `search_path = ''`, its in-body JWT
-- refusal (tasks-M* §4.1) and the triple REVOKE — 125's text verbatim.
-- Signatures and return types unchanged ⇒ typegen is a 0-line diff (measured).
-- MIGRATION CHECKLIST (tasks-M* §4.4): ZERO DDL; one `CREATE OR REPLACE` of a
-- PLAIN internal + its REVOKE + its COMMENT, and one `CREATE OR REPLACE` of
-- the DEFINER tick + its REVOKE (the tick has never carried a COMMENT —
-- measured across 116 / 119 / 125). No table, policy, grant or trigger
-- changes. WAIVERS: R6 — no staging clone; rehearsal evidence = the
-- fresh local `db reset` 001–138 + pgTAP 086 (and 073 re-run with its new
-- premise cell) + the stack suites + the synthetic season sim in the same
-- PR. D38 realtime waiver — nothing broadcast changes (`team_lineups`' own
-- trigger fires on the tick's UPDATE exactly as before). No backfill: the
-- next tick after deploy orders by the values that exist.
-- ============================================================================

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
  -- 138 (L.E1.21, Q62): the read-side freshness bound (F387's read half /
  -- F389(c)) — the SAME six hours as the compute half's
  -- `PROJECTION_MAX_AGE_MS` (`player-values.ts`), pinned equal by a unit cell.
  c_max_age     CONSTANT INTERVAL := interval '6 hours';
  v_tail_d      JSONB := '[]'::jsonb;        -- fit input: the DOUBTFUL tail — ahead of v_tail, under BOTH settings
  v_blocked     BOOLEAN;                     -- bye or a §7.3.6 blocking designation (Doubtful is NOT one)
  v_basis       JSONB;                       -- order_basis: what ordered this pass, and why a key was absent
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
  -- plus the four keys of the one sort below and an `order` object that says
  -- which key ordered each player and why an earlier key was absent.
  --
  -- Q62's SORT, AS RULED (Chris 2026-09-27; 138, L.E1.21), AND IT IS STILL
  -- THE WHOLE SELECTION POLICY. Placement is free (D340 — the matcher
  -- CHOOSES, and greedy-by-input-order over a transversal matroid is
  -- optimal), so "which players start" is this ORDER BY and nothing else:
  -- (1) THIS week's projected points, (2) season-to-date points, (3) preseason
  -- projected points — each under the league's scoring (§12.28, 137) — then
  -- (4) ADP, then player_id. POINTS, never ranks: across positions (a FLEX
  -- slot) Chris ruled "total scored points", and within a position points
  -- order exactly as positional rank does. ONE LEXICOGRAPHIC ORDER BY, PER
  -- PLAYER (the task's READING, flagged): a player with a key outranks every
  -- player without it; the later keys order only what the earlier leave NULL.
  --
  -- F389's JOIN CONTRACT. (a) A LEFT JOIN — a rostered player with no values
  -- row (acquired since the last hourly run; a league-week the job failed)
  -- stays in the pool with all three keys NULL and is NAMED in order_basis;
  -- (b) only the POINTS columns are sort keys — `*_missing` / `*_unscored`
  -- never are; (c) F387's READ HALF — a row whose `computed_at` is older than
  -- `c_max_age` at `p_at` is ABSENT (the values job has died), and a
  -- projection whose `projection_fetched_at` is older than `c_max_age` at
  -- `p_at` is ABSENT (the projections sync has died) ⇒ the next key orders.
  -- ALL FOUR JOIN PREDICATES ARE LOAD-BEARING (R1120, #316's fix round).
  -- The job writes the CURRENT and the NEXT week for every rostered player of
  -- every league, and one real player is rostered in many leagues: without
  -- `v.week = p_week` (or the season) he joins TWICE — two roster entries, and
  -- the matcher could seat one man in two slots — and without the league
  -- predicate he is ordered by ANOTHER league's scoring. pgTAP 086 gives a
  -- §C1 player a reversing row in each of those three places.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',      r.player_id,
           'name',           p.full_name,
           'position',       CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',    public.lineup_designation_internal(p.status),
           'nfl_team',       p.team,
           'adp',            p.adp,
           'ir_placed_week', r.ir_placed_week,
           'slot_key',       r.slot_key,
           'order',          jsonb_build_object(
             'ordered_by',       CASE WHEN k.projected_points IS NOT NULL THEN 'projected_points'
                                      WHEN k.season_points    IS NOT NULL THEN 'season_points'
                                      WHEN k.preseason_points IS NOT NULL THEN 'preseason_points'
                                      WHEN p.adp              IS NOT NULL THEN 'adp'
                                      ELSE 'player_id' END,
             'projected_points', k.projected_points,
             'season_points',    k.season_points,
             'preseason_points', k.preseason_points,
             'adp',              p.adp,
             'value_row',        f.value_row,
             'projected_why',    CASE WHEN k.projected_points IS NOT NULL THEN NULL
                                      WHEN f.value_row <> 'fresh' THEN f.value_row
                                      WHEN v.projected_points IS NULL THEN v.projected_missing
                                      ELSE 'stale_line_at_read' END))
           ORDER BY k.projected_points DESC NULLS LAST, k.season_points DESC NULLS LAST,
                    k.preseason_points DESC NULLS LAST, p.adp ASC NULLS LAST, r.player_id ASC), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  LEFT JOIN public.league_player_values v
    ON v.league_id = r.league_id AND v.season = p_season AND v.week = p_week AND v.player_id = r.player_id
  CROSS JOIN LATERAL (SELECT CASE WHEN v.player_id IS NULL THEN 'no_value_row'
                                  WHEN v.computed_at < p_at - c_max_age THEN 'stale_row'
                                  ELSE 'fresh' END AS value_row) f
  CROSS JOIN LATERAL (SELECT
           CASE WHEN f.value_row = 'fresh' AND v.projection_fetched_at >= p_at - c_max_age
                THEN v.projected_points END AS projected_points,
           CASE WHEN f.value_row = 'fresh' THEN v.season_points END AS season_points,
           CASE WHEN f.value_row = 'fresh' THEN v.preseason_points END AS preseason_points) k
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
    -- THE `COALESCE` AROUND THE `IN` IS LOAD-BEARING, AND IT WAS MISSING UNTIL
    -- #295's fix round CAUGHT IT WITH §J. `lineup_designation_internal`
    -- returns NULL for a healthy player (112:337 — measured: 'Active' ⇒ NULL),
    -- and `NULL IN (…)` is NULL, not FALSE. Unguarded, `v_unhealthy` was NULL
    -- for EVERY healthy seated starter, `NOT NULL` is NULL, and the `IF` fell
    -- to the ELSE: a healthy, manager-set or carried starter was DISPLACED and
    -- re-contested on value — a D340 violation — and, because such a man also
    -- re-entered the candidate pool below, `v_restored` could seat him at his
    -- old key while pass 1 had already placed him elsewhere, writing ONE PLAYER
    -- INTO TWO SLOTS. Invisible to every other cell in 073 because no other
    -- fixture ran the pass over a map with a HEALTHY SEATED STARTER in it; §J
    -- is that fixture, and it reds on the unguarded form.
    -- 138 (L.E1.21, Q62 RULED): `Doubtful` SITS — an unlocked Doubtful
    -- starter is VACATED here like a bye/OUT man, and pass 1 below either
    -- gives his key to a HEALTHY replacement or the restore clause puts him
    -- back ("yes start the doubtful"). He is NOT in the `out` starter flag
    -- further down: a Doubtful start is legal for a manager (114:596).
    v_unhealthy := COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                   OR COALESCE((v_by_pid -> v_pid ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended', 'Doubtful'), FALSE);
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
    -- Same `COALESCE` as the classification loop above, for the same reason and
    -- stated once there. Benign on this side (`IF NULL THEN` does not fire, so a
    -- healthy man landed in `v_free` anyway) and written explicitly regardless:
    -- the two loops must classify one player identically or the pools disagree.
    -- 138 (L.E1.21): the SAME unhealthy test as the classification loop
    -- (Doubtful included), split in two because the two halves take different
    -- paths. A BLOCKED man (bye / OUT / IR / PUP / NFI / Suspended) keeps
    -- 125's item-4c split exactly. A DOUBTFUL man is a PREFERENCE under BOTH
    -- settings — never the hard filter, since a Doubtful start is legal
    -- (114:596) — and his tail is offered AHEAD of the blocked tail, which is
    -- where he stood before this migration (he was healthy then): Doubtful
    -- now sits behind every healthy candidate and nothing else changed.
    v_blocked := COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                 OR COALESCE((v_e ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended'), FALSE);
    v_unhealthy := v_blocked OR COALESCE((v_e ->> 'designation') = 'Doubtful', FALSE);
    IF v_unhealthy THEN
      IF NOT v_blocked THEN
        v_tail_d := v_tail_d || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
      ELSIF v_allow THEN
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
                       THEN 'on bye' ELSE 'designated ' || (v_by_pid -> v_pid ->> 'designation') END,
        -- 138: which Q62 key ordered the man who came IN, and why an earlier
        -- key was absent (§4 rule 15) — rides through the tick's autopiloted[].
        'order', v_by_pid -> (v_fit_a -> 'assignment' ->> v_key) -> 'order');
    END IF;
  END LOOP;

  -- PASS 2 — the TAIL pass. Pass 1's whole assignment is re-seeded `fixed`
  -- (112:501-505 seeds a fixed player at his wanted key unconditionally, so
  -- pass 1's result is reproduced exactly), the restored men with it, and the
  -- remaining slots are offered to the unhealthy tail — which, when the
  -- league forbids illegal lineups, holds only the Doubtful men (138), so a
  -- slot only a BLOCKED man could take stays `unfillable`.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit_a -> 'assignment') LOOP
    v_players_b := v_players_b || jsonb_build_object(
      'player_id', v_val #>> '{}',
      'position', v_by_pid -> (v_val #>> '{}') ->> 'position',
      'wanted', v_key, 'fixed', TRUE);
  END LOOP;
  -- 138: the Doubtful tail FIRST, then the blocked tail (see the pool loop).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_tail_d || v_tail) LOOP
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
        'name', v_by_pid -> v_pid ->> 'name', 'position', v_by_pid -> v_pid ->> 'position',
        'order', v_by_pid -> v_pid -> 'order');
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

  -- 138 (L.E1.21): WHAT ORDERED THIS PASS, AND WHY A KEY WAS ABSENT (§4 rule
  -- 15; F389(a)). Over this pass's CANDIDATES: how many players each Q62 key
  -- ordered, every candidate with NO values row and every candidate whose row
  -- was STALE at `p_at` by name, and — when no candidate had any points key at
  -- all — that the pass FELL BACK TO ADP and the measured reason, never a
  -- quiet ADP order that looks like a projection order.
  -- THE CANDIDATES, NOT THE ROSTER (R1125, #316's fix round): only the men the
  -- pass actually OFFERED to the matcher un-fixed — `v_free`, `v_tail_d`,
  -- `v_tail`. An IR-held man, a seated (fixed) starter, a locked man and one
  -- the allow = FALSE filter refused are never ordered by this pass, so they
  -- are never counted: one valued IR man must not report "ordered by
  -- projection" for a pass whose every real candidate was ordered by ADP. A
  -- pass with NO candidate (an empty slot and nobody left to offer) says
  -- `candidates = 0` and did not fall back — nothing was ordered.
  SELECT jsonb_build_object(
           'candidates',        count(*),
           'by_key',            jsonb_build_object(
             'projected_points', count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'projected_points'),
             'season_points',    count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'season_points'),
             'preseason_points', count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'preseason_points'),
             'adp',              count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'adp'),
             'player_id',        count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'player_id')),
           'no_value_row',      COALESCE(jsonb_agg(e ->> 'player_id' ORDER BY e ->> 'player_id')
                                  FILTER (WHERE e -> 'order' ->> 'value_row' = 'no_value_row'), '[]'::jsonb),
           'stale_value_row',   COALESCE(jsonb_agg(e ->> 'player_id' ORDER BY e ->> 'player_id')
                                  FILTER (WHERE e -> 'order' ->> 'value_row' = 'stale_row'), '[]'::jsonb),
           'max_age',           c_max_age::text,
           'fell_back_to_adp',  count(*) > 0 AND count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by'
                                  IN ('projected_points', 'season_points', 'preseason_points')) = 0,
           'fallback_why',      CASE
             WHEN count(*) = 0 THEN NULL
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by'
                    IN ('projected_points', 'season_points', 'preseason_points')) > 0 THEN NULL
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'no_value_row') = count(*)
               THEN 'no_value_rows: league_player_values holds no row for any of this pass''s candidates for this league-week — the league-player-values job has not valued them; every candidate was ordered by ADP, then player_id (Q62 key 4)'
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'stale_row') = count(*)
               THEN 'all_value_rows_stale: every one of this pass''s candidates'' league_player_values rows for this league-week was computed more than ' || c_max_age::text || ' before the tick instant — the job has stopped landing, so the rows were treated as absent (F387) and every candidate was ordered by ADP, then player_id'
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'fresh') = 0
               THEN 'no_fresh_value_row: every candidate''s values row was absent or stale at the tick instant; every candidate was ordered by ADP, then player_id'
             ELSE 'no_points_in_any_value_row: fresh values rows exist but none carries a usable projected, season-to-date or preseason value (see each player''s order.projected_why); every candidate was ordered by ADP, then player_id' END)
  INTO v_basis
  FROM jsonb_array_elements(v_roster) e
  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_free || v_tail_d || v_tail) c
                WHERE c ->> 'player_id' = e ->> 'player_id');

  RETURN jsonb_build_object(
    'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
    'source', 'autopilot',
    'slot_map', v_map, 'starters', v_starters, 'bench', v_bench, 'locked_at', v_locked_at,
    'filled', v_filled, 'substituted', v_subbed, 'unfillable', v_unfill,
    'skipped_locked', v_locked_out, 'restored', v_restored,
    'allow_illegal_lineups', v_allow,
    'order_basis', v_basis,
    'changed', v_changed, 'reason', v_reason, 'evaluated_at', p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_autopilot_internal(UUID, UUID, INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION lineup_autopilot_internal(UUID, UUID, INTEGER, INTEGER, TIMESTAMPTZ) IS
  '§7.2.1(c) autopilot (125, L.E1.4 — D337/D338/D339/D340/D354; 138, L.E1.21 — Q62/Q63 RULED, D375). PURE: reads the roster, the slots, the designations, the per-player kickoffs and the league-scored values (137) at p_at and RETURNS the 114-shaped row it would write (slot_map/starters/bench/locked_at) plus filled[]/substituted[] (each with its `order`)/unfillable[]/skipped_locked[]/restored[]/order_basis/changed/reason. Writes nothing — lineup_lock_tick arm (c) is the writer. Places exclusively through lineup_fit_internal (D340); candidate order is ONE lexicographic clause (Q62: this week''s projected points DESC, season-to-date points DESC, preseason points DESC — each NULLS LAST, a values row or projection older than 6h at p_at treated as absent (F387/F389) — then adp ASC NULLS LAST, player_id ASC); never lifts the per-player kickoff lock (D338); substitutes only an unlocked bye/blocked/Doubtful starter and only when a HEALTHY replacement takes the key, else restores him (Q63; "yes start the doubtful"); Doubtful is a preference under both allow_illegal_lineups values, never the hard filter and never the out flag; allow_illegal_lineups = FALSE is a hard filter on FILLING with a blocked man only (item 4c).';

-- ---------------------------------------------------------------------------
-- 2. lineup_lock_tick — CREATE OR REPLACE against `125:715-1137`'s FILE TEXT
--    (D137; measured: `grep -n "FUNCTION lineup_lock_tick"` across
--    supabase/migrations → 116, 119, 125 — 125 is the NEWEST definer, and
--    nothing after it names the tick outside comments). ADDED BY #316's FIX
--    ROUND (R1122): EXACTLY ONE `diff -u` hunk, inside arm (c)'s
--    `autopiloted[]` entry — the chooser's `order_basis` is forwarded beside
--    `filled` / `substituted` / `restored`, so "a pass with no usable value
--    says it fell back to ADP and why" reaches the tick's REPORT, not only the
--    chooser's return value. Arms (a) and (b), the kill switch, the driving
--    query, the write, every reason string and the report's other keys are
--    byte-identical (pgTAP 086 A7b: the prosrc with the hunk's text removed
--    has 125's md5). SECURITY DEFINER, `search_path = ''`, the in-body
--    JWT refusal and the triple REVOKE — 125's posture verbatim.
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
  v_ap_no_row      INTEGER := 0;   -- seats that REACHED the materialize step and STILL had no row (R998/R999: counted after the carry, never on the D339 path)
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
              -- R999: this seat is DECLINED, and the report says exactly that.
              -- It does NOT touch `v_ap_no_row` — the decline happens BEFORE
              -- the materialize step is reached, so calling it "no row and no
              -- materialize" would report a failure that never happened
              -- (§4 rule 15's own shape, in the field built to abolish it).
              v_ap_no_member := v_ap_no_member + 1;
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
              -- THE MATERIALIZE IS ASSERTED, NOT ASSUMED (R999). The carry's
              -- contract is INSERT-or-RAISE (`116:541-551`), so this re-read
              -- can only come back empty if that contract is ever weakened —
              -- and THAT is what `no_row_and_no_materialize` means. Without
              -- this check the chooser below would raise P0002 into
              -- `failures[]` and the reason field would say nothing about the
              -- seat; with it, the pass NAMES the seat and why.
              IF NOT EXISTS (
                SELECT 1 FROM public.team_lineups tl
                WHERE tl.team_id = v_ap.team_id
                  AND tl.season = v_league.season
                  AND tl.week = v_current)
              THEN
                v_ap_no_row := v_ap_no_row + 1;
                v_skipped := v_skipped || jsonb_build_object(
                  'league_id', v_lg.id, 'team_id', v_ap.team_id, 'week', v_current,
                  'reason', 'no_row_and_no_materialize',
                  'why', 'lineup_carry_internal returned without leaving a team_lineups row for this (team, season, week) — its own contract is INSERT-or-RAISE (116:541-551), so this is a contract violation reported rather than a 0-row UPDATE read as "nothing to do" (§4 rule 15)');
                CONTINUE;
              END IF;
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
                -- 138 (L.E1.21, R1122): the chooser's order_basis for this
                -- pass: which Q62 key ordered its candidates and, when none had
                -- a usable value, that it FELL BACK TO ADP and why (rule 15).
                'order_basis', v_ap_r -> 'order_basis',
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
    -- THE ARMS ARE ORDERED, AND THE ORDER IS THE POINT (R999, #295's fix
    -- round). Each arm names a condition that was actually MEASURED on this
    -- pass; none of them describes work the pass did not attempt.
    'autopilot_reason', CASE
      WHEN v_ap_off THEN 'disabled_by_system_flag:autopilot_disabled'
      WHEN v_ap_writes > 0 THEN NULL                       -- the arrays say what happened
      -- A seat that reached the materialize step and STILL had no row: the
      -- carry's INSERT-or-RAISE contract broke. Ahead of the `v_ap_seats = 0`
      -- arms because such a seat is CONTINUEd before `v_ap_seats` is
      -- incremented, and "no unmanaged seats" would then be a lie about it.
      WHEN v_ap_no_row > 0 THEN 'no_row_and_no_materialize'
      -- EVERY unmanaged-LOOKING seat was declined for want of a
      -- `league_members` row (D339's unsafe failure direction). Before the
      -- fix round this fell through to `nothing_fillable` — "nothing was
      -- fillable" about seats the pass deliberately never evaluated — or, when
      -- the seat also had no lineup row, to `no_row_and_no_materialize`, a
      -- materialization failure that never happened. `skipped[]` names each
      -- team; this says why the pass as a whole was silent.
      WHEN v_ap_seats = 0 AND v_ap_no_member > 0
        THEN 'every_unmanaged_looking_seat_declined_no_league_members_row'
      -- Precisely worded on purpose: arm (c)'s driving query is bounded to
      -- `lw.status = 'live'`, so "saw nothing" also covers an unmanaged seat
      -- in a current week that has closed into `correction_window`. A bare
      -- "no unmanaged seats" there would be a plausible-looking silence about
      -- a seat that does exist (§4 rule 15).
      WHEN v_ap_seats = 0 THEN 'no_unmanaged_seats_in_a_live_current_week'
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
