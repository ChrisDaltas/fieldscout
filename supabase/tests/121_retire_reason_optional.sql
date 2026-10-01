-- ============================================================================
-- 121 — retiring a team: the reason is OPTIONAL (migration 173; M6 L.E1.40;
--       F363(a), F546, F262(a); spec §7.2.1(b), §10.3, §12.12, §15.1, E49;
--       PROGRESS Q66 / C82, D290, D320, D450, D461)
-- ============================================================================
-- What this file proves, over REAL calls of remove_manager(mode = retire):
--   * no reason (absent / blank / whitespace / a tab and a newline) RETIRES
--     the team: the payload, the ledger row (transactions commissioner_move)
--     and the receipt (commissioner_actions retire_franchise) carry reason
--     NULL, the league post has NO "— reason:" tail, the removed manager is
--     still notified, and the audit is written all the same (E49's
--     "audited override" is the audit, not the reason);
--   * a reason given is stored TRIMMED on all three and closes the post;
--   * the 500 bound: 500 characters retire, 501 are refused BY NAME with the
--     seam's sentence and nothing is written;
--   * what did NOT move: the action_id is still required (22023 by name),
--     the replay returns the stored payload byte-identical, the playoffs
--     still refuse by name (pending Q41), before the draft still refuses
--     (D42's text), a complete league retires "after the season", and
--     vacate / takeover are untouched;
--   * D137 in the database: pg_temp.un173 reverses 173's three hunks to
--     169's live body (the md5 pgTAP 117 A4 stores).
--
-- RE-CUT BY 176 (M6 L.E1.42 — Chris 2026-10-01: a team is never retired;
-- "yes drop it"). The retire arm is gone: every call above is refused BY
-- NAME and writes nothing; each cell keeps its id and says what it was.
-- A2 / A3 read the live body through pg_temp.un176 INNERMOST (additive,
-- R992 — the literals 169 / 173 stored are unchanged); pgTAP 124 pins 176.
--
-- Worlds (fabricated inside this rolled-back transaction):
--   LI b121…01  in_season, weeks 1–5 final, week 6 live — u1 commissioner
--               (t1), u2..u7 managers (t2..t7)
--   LP b121…02  playoffs — u1 (t1), u2 (t2)
--   LS b121…03  setup — u1 (t1), u2 (t2)
--   LC b121…04  complete, every week final — u1 (t1), u2 (t2)
--   u8 holds no seat (the takeover's successor).
-- Descriptions carry no bare apostrophes (house rule).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(41);

-- pg_temp.un173 — 173's three hunks reversed (derive_173.py; each
-- replacement text occurs once, in remove_manager only).
create function pg_temp.un173(s text) returns text language plpgsql as $un$
begin
  s := replace(s, $r$    -- (b) The audit stamp and the reason (E49 "audited override"; D290's
    --     interim posture: reason REQUIRED, stored on the ledger row).
    --     173 / F363(a) — Q66 (v2.16.41, C82): the reason is OPTIONAL. Blank
    --     or whitespace-only (the explicit class, 123:295 — R1328: the same
    --     class the receipt seam trims) is NULL; past 500 characters the
    --     receipt seam refuses it BY NAME (168:196) and the whole retirement
    --     rolls back. The action_id stays REQUIRED (the replay stamp).
$r$, $o$    -- (b) The audit stamp and the reason (E49 "audited override"; D290's
    --     interim posture: reason REQUIRED, stored on the ledger row).
$o$);
  s := replace(s, $r$    v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
$r$, $o$    v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'remove_manager: retiring a franchise is an audited override — a reason is required (E49 / D290)'
        USING ERRCODE = '22023';
    END IF;
$o$);
  s := replace(s, $r$      || ' (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b))'
      -- 173 / Q66: no reason, no "— reason:" tail (league_chat.message is
      -- NOT NULL — `|| NULL` would null the whole post).
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;
$r$, $o$      || ' (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b)) — reason: ' || v_reason;
$o$);
  return s;
end
$un$;

-- pg_temp.un176 — 176's three hunks reversed (derive_176.py; pgTAP 124).
create function pg_temp.un176(s text) returns text language plpgsql as $un$
begin
  s := replace(s, $r$    RAISE EXCEPTION 'remove_manager: mode must be takeover or vacate (§7.2.1)'
$r$, $o$    RAISE EXCEPTION 'remove_manager: mode must be takeover, retire, or vacate (§7.2.1)'
$o$);
  s := replace(s, $r$  -- 176 (L.E1.42 — Chris 2026-10-01): a team is NEVER retired. "you can't
  -- simply retire a Team, you can change the manager but the Team lives."
  -- When a manager goes there are two outcomes: takeover (a new manager
  -- inherits the team whole) or vacate (the team stays; the commissioner
  -- runs it). 'retire' stays a NAMED mode so it is refused in plain words,
  -- in every league state. The refusal sits AFTER the replay (L.D3.16's
  -- shape): a retry of a retirement committed before 176 still returns its
  -- stored payload byte-identical (none exist in production — measured
  -- 2026-10-01). Nothing below this block can see p_mode = 'retire'.
  IF p_mode = 'retire' THEN
    IF p_action_id IS NOT NULL THEN
      SELECT t.type, t.payload INTO v_replay
      FROM public.transactions t
      WHERE t.league_id = p_league_id AND t.action_id = p_action_id;
      IF FOUND
         AND v_replay.type = 'commissioner_move'
         AND v_replay.payload ->> 'verb' = 'retire_franchise'
         AND (v_replay.payload ->> 'member_id')::uuid = p_member_id THEN
        RETURN v_replay.payload;
      END IF;
    END IF;
    RAISE EXCEPTION 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)'
      USING ERRCODE = 'P0001';
  END IF;
$r$, $o$  -- 120 (L.D1.10): retire-and-succeed is REAL now (§7.2.1(b) / D301 / F31).
  IF p_mode = 'retire' THEN
    -- (a) The status gate. Before the draft D42's refusal stands byte for
    --     byte (017 J pins it; a franchise has no roster or record to
    --     inherit). `in_season` (the LAW's "mid-season … audited override")
    --     and `complete` ("primarily an offseason action") proceed.
    --     `playoffs` REFUSES BY NAME: §7.2.1(b) / §11.5 print nothing about
    --     a retired franchise's bracket line (does the successor play it,
    --     or is it forfeited?) and 118's sync derives later rounds from the
    --     played rows' team ids — PROGRESS Q41 carries the question; this
    --     arm is a refusal, never a fold (R801).
    IF v_league.status IN ('setup', 'scheduled', 'drafting') THEN
      RAISE EXCEPTION 'remove_manager: retiring a franchise isn''t available before the draft — use takeover or vacate (§7.2.1; retire-and-succeed arrives with the in-season milestone)'
        USING ERRCODE = 'P0001';
    ELSIF v_league.status = 'playoffs' THEN
      RAISE EXCEPTION 'remove_manager: retiring a franchise during the playoffs is not defined yet — what the bracket does with a retired franchise''s line is PROGRESS Q41; use takeover or vacate now, or retire the franchise after the season (§7.2.1(b))'
        USING ERRCODE = 'P0001';
    ELSIF v_league.status NOT IN ('in_season', 'complete') THEN
      RAISE EXCEPTION 'remove_manager: league status % admits no retirement (§7.1)', v_league.status
        USING ERRCODE = 'P0001';
    END IF;
    -- (a′) R858: the actor's OWN seat. §7.2.1 gives the leaver no choice of
    --      outcome — leave_league is the voluntary path — and the route's
    --      self-DELETE dispatches there; a co-commissioner calling the RPC
    --      directly must not get the choice back. (A plain manager never
    --      reaches here: not a commissioner, 42501 above.)
    IF v_target.user_id = v_uid THEN
      RAISE EXCEPTION 'remove_manager: you cannot retire your own franchise — a leaver has no choice of outcome (§7.2.1); leave the league, or have the commissioner act on your seat'
        USING ERRCODE = '42501';
    END IF;
    -- (b) The audit stamp and the reason (E49 "audited override"; D290's
    --     interim posture: reason REQUIRED, stored on the ledger row).
    --     173 / F363(a) — Q66 (v2.16.41, C82): the reason is OPTIONAL. Blank
    --     or whitespace-only (the explicit class, 123:295 — R1328: the same
    --     class the receipt seam trims) is NULL; past 500 characters the
    --     receipt seam refuses it BY NAME (168:196) and the whole retirement
    --     rolls back. The action_id stays REQUIRED (the replay stamp).
    IF p_action_id IS NULL THEN
      RAISE EXCEPTION 'remove_manager: retire requires action_id (idempotency key — one UUID per retirement, reused on retry; 113''s contract)'
        USING ERRCODE = '22023';
    END IF;
    v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
    -- (c) REPLAY by (league_id, action_id) — 113's contract (R732): the
    --     stored payload byte-identical; the same stamp on another verb or
    --     another member is a shape violation. Checked BEFORE the seat
    --     checks below: after a committed retirement the seat is an open
    --     placeholder and would otherwise refuse the retry by name.
    SELECT t.type, t.payload INTO v_replay
    FROM public.transactions t
    WHERE t.league_id = p_league_id AND t.action_id = p_action_id;
    IF FOUND THEN
      IF v_replay.type <> 'commissioner_move'
         OR v_replay.payload ->> 'verb' IS DISTINCT FROM 'retire_franchise'
         OR (v_replay.payload ->> 'member_id')::uuid IS DISTINCT FROM p_member_id THEN
        RAISE EXCEPTION 'remove_manager: action_id % already names another action in this league — an action_id identifies ONE submit of ONE verb (R732)', p_action_id
          USING ERRCODE = '22023';
      END IF;
      RETURN v_replay.payload;
    END IF;
  END IF;
$o$);
  s := replace(s, $r$  ELSE
    -- vacate (§7.2.1(c)) — the stint closes with no successor.
$r$, $o$  ELSIF p_mode = 'retire' THEN
    -- (d) F1: the lineage this franchise sits in must be ACYCLIC before it
    --     is extended. The successor minted below is a NEW row (it cannot
    --     close a cycle by construction — said, D267), so the walk is over
    --     the PREDECESSOR chain as STORED: only privileged writes can
    --     corrupt it (D53: the column has no client writer), and a corrupt
    --     chain is refused BY NAME rather than misreported as "already
    --     sealed" (068 F; the DoD probe drops this block).
    WITH RECURSIVE lineage AS (
      SELECT t.id, 0 AS depth FROM public.teams t WHERE t.id = v_team.id
      UNION ALL
      SELECT p.id, l.depth + 1
      FROM lineage l JOIN public.teams p ON p.successor_team_id = l.id
      WHERE l.depth < 64
    ) CYCLE id SET is_cycle USING path
    SELECT l.is_cycle, array_length(l.path, 1) - 1 AS len INTO v_cycle
    FROM lineage l WHERE l.is_cycle
    ORDER BY array_length(l.path, 1) LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'remove_manager: % sits in a succession CYCLE of length % (the successor_team_id chain revisits a franchise) — refused; repair the lineage before extending it (§12.22 / F1)', v_team_name, v_cycle.len
        USING ERRCODE = 'P0001';
    END IF;
    IF v_team.status = 'retired' OR v_team.successor_team_id IS NOT NULL THEN
      RAISE EXCEPTION 'remove_manager: % is already sealed (status %, successor %) — a retired franchise cannot be retired again (§7.2.1(b))', v_team_name, v_team.status, v_team.successor_team_id
        USING ERRCODE = 'P0001';
    END IF;
    -- (d′) R855: an UNMANAGED seat (vacated / left — 'orphaned', §7.2.1(c))
    --      is admitted when the franchise has a CLOSED stint: the seal
    --      names the LAST manager (History Mode reads the stints; nothing
    --      else is written under a name), no stint is open to close (the
    --      (h) UPDATE matches nothing — D63), no one is notified,
    --      removed_user_id is NULL in the payload. A franchise that has
    --      NEVER had a manager — 120's own successor until it is claimed,
    --      or a placeholder seat autopick-drafted and never claimed — has
    --      no name to seal under and refuses BY NAME.
    IF v_removed_user IS NULL THEN
      PERFORM 1 FROM public.team_managers tm
      WHERE tm.team_id = v_team.id AND tm.ended_at IS NOT NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'remove_manager: % has never had a manager — there is no one to seal it under; use assign-manager to seat someone on it first (§7.2.1(b))', v_team_name
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- (e) The founding week of the successor's book — the first week the
    --     league has NOT yet played: 1 + its last correction_window/final
    --     week (a reopened earlier week stays the predecessor's), else the
    --     first league week. NULL when that week does not exist (the
    --     season is over — `complete`, or every week played): nothing is
    --     re-pointed and History reads the whole book as the retired
    --     franchise's; retired_at_week / ended_week are NULL (§12.22's
    --     "NULL preseason" reading, extended to "outside the season").
    SELECT w.week INTO v_week
    FROM public.league_weeks w
    WHERE w.league_id = p_league_id AND w.season = v_league.season
      AND w.week = COALESCE(
        (SELECT max(x.week) + 1 FROM public.league_weeks x
         WHERE x.league_id = p_league_id AND x.season = v_league.season
           AND x.status IN ('correction_window', 'final')),
        (SELECT min(x.week) FROM public.league_weeks x
         WHERE x.league_id = p_league_id AND x.season = v_league.season));

    -- (f) The successor: a NEW franchise in the same slot (§7.2.1(b)),
    --     named by D74(5)'s series over the league's WHOLE franchise count
    --     (retired included — a retired franchise keeps its number, so the
    --     name cannot collide with a seat's default), owned by the acting
    --     commissioner like every placeholder (add_placeholder_seat),
    --     'orphaned': no manager until a takeover (§7.2.1(c)'s holding
    --     state; assign_manager / a seat claim return it to 'active' —
    --     D74(2)). It counts as seated in every capacity count.
    SELECT count(*)::int INTO v_franchises FROM public.teams t WHERE t.league_id = p_league_id;
    v_successor_name := 'Team ' || (v_franchises + 1)::text;
    INSERT INTO public.teams (owner_id, name, league_id, list_id, status)
    VALUES (v_uid, v_successor_name, p_league_id, NULL, 'orphaned')
    RETURNING id INTO v_successor_id;

    -- (g) SEAL the franchise: status, the partition week, the link. owner_id
    --     moves to the acting commissioner for the vacate arm's reason (the
    --     removed user's profile deletion would CASCADE the sealed franchise
    --     away — 001:495); name and record are frozen by the absence of any
    --     writer (§7.2.1(b)).
    UPDATE public.teams
    SET status = 'retired',
        retired_at_week = v_week,
        successor_team_id = v_successor_id,
        owner_id = v_uid,
        updated_at = now()
    WHERE id = v_team.id;

    -- (h) The stint closes `seat_retired` — the one §12.22 value M1 never
    --     wrote (D74(9)); the F3 close shape; a missing open stint is a
    --     no-op (D63). No stint opens: the successor has no manager yet.
    UPDATE public.team_managers
    SET ended_at = now(),
        ended_week = v_week,
        end_reason = 'seat_retired',
        ended_by = v_uid
    WHERE team_id = v_team.id AND ended_at IS NULL;

    -- (i) The seat: ONE league_members row per seat, always (§12.2) — the
    --     cache row is re-pointed at the successor as an OPEN placeholder
    --     (assign_manager / a seat-targeted invite fill it). faab_balance is
    --     deliberately NOT re-seeded: (b)'s "inherits FAAB" is the seat's
    --     balance carrying, which the in-place UPDATE does for free (D301:
    --     vacuous until M5 makes the balance live; the transfer line M5 need
    --     not write is this one).
    UPDATE public.league_members
    SET user_id = NULL,
        is_placeholder = TRUE,
        role = 'manager',
        team_id = v_successor_id
    WHERE id = v_target.id;

    -- (j) THE INHERITANCE, every re-point COUNTED (rule 10). The roster
    --     whole (072's per-row trigger broadcasts each row on league:<id>);
    --     the CURRENT and future weeks' lineups, matchups and results — the
    --     successor's book opens at v_week; past weeks stay the
    --     predecessor's (History partitions at retired_at_week — E49).
    --     league_player_pool carries no team reference (109); transactions,
    --     lineup_actions and the draft rows are history under the
    --     predecessor. A game-day lock is per PLAYER, evaluated from
    --     nfl_games at call time (115/Q34(B)) — a re-point unlocks no one.
    UPDATE public.league_rosters SET team_id = v_successor_id
    WHERE league_id = p_league_id AND team_id = v_team.id;
    GET DIAGNOSTICS v_n_rosters = ROW_COUNT;
    IF v_week IS NOT NULL THEN
      UPDATE public.team_lineups SET team_id = v_successor_id
      WHERE team_id = v_team.id AND season = v_league.season AND week >= v_week;
      GET DIAGNOSTICS v_n_lineups = ROW_COUNT;
      UPDATE public.matchups SET home_team_id = v_successor_id, updated_at = now()
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND home_team_id = v_team.id;
      GET DIAGNOSTICS v_n_matchups = ROW_COUNT;
      UPDATE public.matchups SET away_team_id = v_successor_id, updated_at = now()
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND away_team_id = v_team.id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_n_matchups := v_n_matchups + v_n;
      UPDATE public.team_week_results SET team_id = v_successor_id
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND team_id = v_team.id;
      GET DIAGNOSTICS v_n_results = ROW_COUNT;
      UPDATE public.team_week_results SET opponent_team_id = v_successor_id
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND opponent_team_id = v_team.id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_n_results := v_n_results + v_n;
      UPDATE public.team_week_results SET second_opponent_team_id = v_successor_id
      WHERE league_id = p_league_id AND season = v_league.season AND week >= v_week AND second_opponent_team_id = v_team.id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_n_results := v_n_results + v_n;
    END IF;

    -- (k) The payload — also the LEDGER row's, so a replay is byte-identical.
    v_result := jsonb_build_object(
      'ok', true, 'mode', p_mode, 'verb', 'retire_franchise', 'action_id', p_action_id,
      'member_id', v_target.id, 'team_id', v_team.id,
      'removed_user_id', v_removed_user, 'successor_user_id', NULL, 'already_vacant', false,
      'retired_team_id', v_team.id, 'retired_team_name', v_team_name,
      'successor_team_id', v_successor_id, 'successor_team_name', v_successor_name,
      'season', v_league.season, 'retired_at_week', v_week, 'reason', v_reason,
      'repointed', jsonb_build_object(
        'rosters', v_n_rosters, 'lineups', v_n_lineups, 'matchups', v_n_matchups, 'results', v_n_results),
      'inherits', jsonb_build_object(
        'roster', true, 'record', 'seeding_only', 'h2h_history', false, 'faab', 'seat_balance_kept'));
    -- (l) The ledger (D290 interim; 113's shape): ONE transactions row of
    --     type commissioner_move, commissioner-initiated (no initiator team),
    --     stamped with p_action_id; 119's trigger carries it to the feed.
    INSERT INTO public.transactions
      (league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id)
    VALUES (p_league_id, 'commissioner_move', 'complete', NULL, v_uid, v_result, v_week, p_action_id);
    -- (m) The D97 in-transaction system post (111/113's shape).
    v_message := v_team_name || ' was retired by ' || public.draft_actor_name()
      || CASE WHEN v_removed_user IS NULL
           THEN ' — the vacant franchise is sealed under its last manager (§7.2.1(c)); '
           ELSE ' — the franchise is sealed under its final manager; ' END
      || v_successor_name
      || ' takes its slot' || CASE WHEN v_week IS NULL THEN ' after the season' ELSE ' from Week ' || v_week::text END
      || ' (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b))'
      -- 173 / Q66: no reason, no "— reason:" tail (league_chat.message is
      -- NOT NULL — `|| NULL` would null the whole post).
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, v_uid, v_message, 'league', TRUE);
  ELSE
    -- vacate (§7.2.1(c)) — the stint closes with no successor.
$o$);
  return s;
end
$un$;

-- ---------------------------------------------------------------------------
-- A. Form, and D137 in the database
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', pg_get_function_identity_arguments(p.oid), p.prosecdef,
                            array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'remove_manager'),
  'p_league_id uuid, p_member_id uuid, p_mode text, p_successor_user_id uuid, p_reason text, p_action_id uuid:t:search_path="":f:t',
  'A1 remove_manager keeps ONE overload, its six arguments, SECURITY DEFINER, search_path empty, anon closed, authenticated open');
select is(
  (select md5(pg_temp.un173(pg_temp.un176(p.prosrc))) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'remove_manager'),
  '06921fe6b49594376fdf7f521ba41c36',
  'A2 D137: the live body with 173 reversed is 169 as written (the stored md5 pgTAP 117 A4 pins)');
select is(
  (select md5(pg_temp.un176(p.prosrc)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'remove_manager'),
  '3698941d72d6efa0f1f7fa599a607a40',
  'A3 RE-CUT (176): the live prosrc with 176 reversed — 173 as written (stored literal; 124 A2 pins the live md5)');
select ok(
  (select p.prosrc not like '%a reason is required%' and p.prosrc not like '%SET status = ''retired''%'
          and p.prosrc like '%a team can''''t be retired%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'remove_manager'),
  'A4 RE-CUT (176): no reason-required refusal, no seal (the retire arm is gone), and the plain refusal is there');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname <> 'remove_manager' and pg_temp.un173(p.prosrc) <> p.prosrc),
  0,
  'A5 un173 is an identity on every other body in the schema (the older suites apply it innermost — additive, R992)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (privileged, before any JWT claims — D49(7))
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('97121000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-e121-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "e121_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 8) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams,
                     playoff_start_week, scoring_system_id, scoring_rules_snapshot, faab_budget, settings)
select ('b1210000-0000-4000-8000-00000000000' || l)::uuid, '97121000-0000-4000-8000-000000000001',
       'pgtap-e121-L' || l, 2026,
       case l when 1 then 'in_season' when 2 then 'playoffs' when 3 then 'setup' else 'complete' end,
       8, 14, case when l = 2 then 4 else 0 end, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       case when l <> 3 then (select rules from scoring_systems where is_template and name = 'ESPN Standard') end,
       100, '{}'::jsonb
from generate_series(1, 4) l;

-- LI seats t1..t7; LP / LS / LC seats t1..t2.
insert into teams (id, owner_id, name, league_id)
select ('c121000' || l || '-0000-4000-8000-00000000000' || i)::uuid,
       ('97121000-0000-4000-8000-00000000000' || i)::uuid,
       'e121-L' || l || '-t' || i,
       ('b1210000-0000-4000-8000-00000000000' || l)::uuid
from generate_series(1, 4) l, generate_series(1, 7) i
where l = 1 or i <= 2;
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '97121000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false, 100
from teams t where t.id::text like 'c121000%';
insert into team_managers (league_id, team_id, user_id, role)
select t.league_id, t.id, t.owner_id, 'manager' from teams t where t.id::text like 'c121000%';

-- LI: weeks 1–5 final, week 6 live (the successor book opens at week 6).
insert into league_weeks (league_id, season, week)
select 'b1210000-0000-4000-8000-000000000001', 2026, w from generate_series(1, 14) w;
update league_weeks set status = 'live'              where league_id = 'b1210000-0000-4000-8000-000000000001' and week <= 6;
update league_weeks set status = 'correction_window' where league_id = 'b1210000-0000-4000-8000-000000000001' and week <= 5;
update league_weeks set status = 'final'             where league_id = 'b1210000-0000-4000-8000-000000000001' and week <= 5;
-- LC: every week final (no week left to open a book — "after the season").
insert into league_weeks (league_id, season, week)
select 'b1210000-0000-4000-8000-000000000004', 2026, w from generate_series(1, 14) w;
update league_weeks set status = 'live'              where league_id = 'b1210000-0000-4000-8000-000000000004';
update league_weeks set status = 'correction_window' where league_id = 'b1210000-0000-4000-8000-000000000004';
update league_weeks set status = 'final'             where league_id = 'b1210000-0000-4000-8000-000000000004';

-- The member id of league l, user i.
create function pg_temp.m(l int, i int) returns uuid language sql as $$
  select lm.id from public.league_members lm
  where lm.league_id = ('b1210000-0000-4000-8000-00000000000' || l)::uuid
    and lm.user_id = ('97121000-0000-4000-8000-00000000000' || i)::uuid
$$;
-- What the retirement of team (l, i) left behind — the ledger payload reason,
-- the receipt reason, and the post (one each, or the count when not one).
create function pg_temp.trail(l int, i int) returns jsonb language sql as $$
  select jsonb_build_object(
    'ledger', (select jsonb_agg(t.payload -> 'reason') from public.transactions t
               where t.league_id = ('b1210000-0000-4000-8000-00000000000' || l)::uuid
                 and t.type = 'commissioner_move'
                 and t.payload ->> 'retired_team_id' = 'c121000' || l || '-0000-4000-8000-00000000000' || i),
    'receipt', (select jsonb_agg(to_jsonb(ca.reason)) from public.commissioner_actions ca
                where ca.league_id = ('b1210000-0000-4000-8000-00000000000' || l)::uuid
                  and ca.action_type = 'retire_franchise'
                  and ca.target_id = 'c121000' || l || '-0000-4000-8000-00000000000' || i),
    'post', (select jsonb_agg(c.message) from public.league_chat c
             where c.league_id = ('b1210000-0000-4000-8000-00000000000' || l)::uuid
               and c.is_system and c.message like 'e121-L' || l || '-t' || i || ' was retired by %'))
$$;

-- ---------------------------------------------------------------------------
-- RE-CUT BY 176 (M6 L.E1.42 — Chris 2026-10-01: "you can't simply retire a
-- Team, you can change the manager but the Team lives" / "yes drop it").
-- Every section below pinned a RETIREMENT landing (with no reason, a blank,
-- a tab, a trimmed reason, 500 characters, after the season, an unmanaged
-- seat). Each cell keeps its id and is re-cut to the ruled behaviour: the
-- call is refused BY NAME in every league state — whatever the reason, the
-- action id or the seat — and nothing is written (no seal, no successor, no
-- ledger row, receipt, post or notification). The one thing a pre-176
-- retirement still gets is its REPLAY (F2, over a planted ledger row — 176
-- cannot write one). Vacate is untouched (F4 / F5).
-- ---------------------------------------------------------------------------
-- C. No reason — refused (LI, in season)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97121000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000001', %L, 'retire', NULL, NULL,
                                          'a1210000-0000-4000-8000-000000000002') $$, pg_temp.m(1, 2)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'C1 RE-CUT (176): no reason — retiring is refused BY NAME (was: the team retired, successor Team 8)');
select is(pg_temp.trail(1, 2),
  '{"ledger": null, "receipt": null, "post": null}'::jsonb,
  'C2 RE-CUT (176): …no ledger row, no receipt, no post (was: one of each, reason null)');
reset role;
select is(
  (select count(*)::int from notifications n
   where n.user_id = '97121000-0000-4000-8000-000000000002' and n.data ->> 'event' = 'retired'),
  0, 'C3 RE-CUT (176): …and the manager is not notified (was: notified, event retired)');
select is(
  (select t.status || ':' || coalesce(t.retired_at_week::text, 'null') || ':' || coalesce(t.successor_team_id::text, 'null')
   from teams t where t.id = 'c1210001-0000-4000-8000-000000000002'),
  'active:null:null', 'C4 RE-CUT (176): the team lives — active, no retired week, no successor (was: retired:6)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97121000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000001', %L, 'retire', NULL, '    ',
                                          'a1210000-0000-4000-8000-000000000003') $$, pg_temp.m(1, 3)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'C5 RE-CUT (176): a blank reason — refused the same way (was: retired with the reason null)');
select is(pg_temp.trail(1, 3) -> 'receipt', 'null'::jsonb, 'C6 RE-CUT (176): no receipt (was: one, reason NULL)');
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000001', %L, 'retire', NULL, E'\t\n \r',
                                          'a1210000-0000-4000-8000-000000000004') $$, pg_temp.m(1, 4)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'C7 RE-CUT (176): a tab and a newline — refused the same way');
select is(pg_temp.trail(1, 4),
  '{"ledger": null, "receipt": null, "post": null}'::jsonb,
  'C8 RE-CUT (176): …nothing written');

-- ---------------------------------------------------------------------------
-- D. A reason given — refused all the same (t5)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000001', %L, 'retire', NULL, E'  moving away \t',
                                          'a1210000-0000-4000-8000-000000000005') $$, pg_temp.m(1, 5)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'D1 RE-CUT (176): a real reason does not open retire (was: stored trimmed)');
select is(pg_temp.trail(1, 5),
  '{"ledger": null, "receipt": null, "post": null}'::jsonb,
  'D2 RE-CUT (176): …nothing written');

-- ---------------------------------------------------------------------------
-- E. The 500 bound — the refusal comes first, at any length (t6)
-- ---------------------------------------------------------------------------
reset role;
create temp table _before as
select (select count(*) from teams where league_id = 'b1210000-0000-4000-8000-000000000001') as teams,
       (select count(*) from transactions where league_id = 'b1210000-0000-4000-8000-000000000001') as tx,
       (select count(*) from commissioner_actions where league_id = 'b1210000-0000-4000-8000-000000000001') as ca,
       (select count(*) from league_chat where league_id = 'b1210000-0000-4000-8000-000000000001') as chat,
       (select count(*) from notifications where user_id = '97121000-0000-4000-8000-000000000006') as notes;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97121000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000001', %L, 'retire', NULL, %L,
                                          'a1210000-0000-4000-8000-000000000006') $$,
         pg_temp.m(1, 6), '  ' || repeat('x', 501) || '  '),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'E1 RE-CUT (176): a 501-character reason meets the retire refusal, not the seam (was: the seam sentence, 22023)');
reset role;
select is(
  (select jsonb_build_array(
     (select count(*) from teams where league_id = 'b1210000-0000-4000-8000-000000000001') - b.teams,
     (select count(*) from transactions where league_id = 'b1210000-0000-4000-8000-000000000001') - b.tx,
     (select count(*) from commissioner_actions where league_id = 'b1210000-0000-4000-8000-000000000001') - b.ca,
     (select count(*) from league_chat where league_id = 'b1210000-0000-4000-8000-000000000001') - b.chat,
     (select count(*) from notifications where user_id = '97121000-0000-4000-8000-000000000006') - b.notes,
     (select t.status from teams t where t.id = 'c1210001-0000-4000-8000-000000000006'))
   from _before b),
  '[0, 0, 0, 0, 0, "active"]'::jsonb,
  'E2 …and NOTHING was written: no successor, no ledger row, no receipt, no post, no notification; t6 still active (unchanged)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97121000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000001', %L, 'retire', NULL, %L,
                                          'a1210000-0000-4000-8000-000000000006') $$, pg_temp.m(1, 6), repeat('y', 500)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'E3 RE-CUT (176): exactly 500 characters — refused the same way (was: retired)');
select is(pg_temp.trail(1, 6) -> 'receipt', 'null'::jsonb, 'E4 RE-CUT (176): …no receipt (was: one)');

-- ---------------------------------------------------------------------------
-- F. The action id, the replay, vacate, the own seat (LI)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000001', %L, 'retire', NULL, NULL) $$, pg_temp.m(1, 7)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'F1 RE-CUT (176): no action id — the same refusal (was: 22023 retire requires action_id)');
-- F2: a retirement COMMITTED BEFORE 176 (planted — 176 cannot write one;
-- production holds none) replays its stored payload byte for byte.
reset role;
insert into transactions (league_id, type, status, payload, action_id)
values ('b1210000-0000-4000-8000-000000000001', 'commissioner_move', 'complete',
        jsonb_build_object('ok', true, 'mode', 'retire', 'verb', 'retire_franchise',
                           'action_id', 'a1210000-0000-4000-8000-0000000000e2', 'member_id', pg_temp.m(1, 2),
                           'retired_team_name', 'e121-L1-t2', 'reason', null),
        'a1210000-0000-4000-8000-0000000000e2');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97121000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  public.remove_manager('b1210000-0000-4000-8000-000000000001', pg_temp.m(1, 2), 'retire', NULL, 'a reason on the retry',
                        'a1210000-0000-4000-8000-0000000000e2'),
  (select t.payload from transactions t where t.action_id = 'a1210000-0000-4000-8000-0000000000e2'),
  'F2 RE-CUT (176): REPLAY of a pre-176 retirement returns its stored payload byte for byte (the refusal sits after the replay)');
select is(pg_temp.trail(1, 2) -> 'receipt', 'null'::jsonb,
  'F3 RE-CUT (176): …and writes nothing — no receipt');
select is(
  (select jsonb_build_array(r ->> 'mode', r ->> 'already_vacant', r ? 'reason')
   from (select public.remove_manager('b1210000-0000-4000-8000-000000000001', pg_temp.m(1, 7), 'vacate', NULL, '   ') as r) x),
  '["vacate", "false", false]'::jsonb,
  'F4 vacate is untouched: a blank reason lands and its seven-key result carries no reason (063 shape, 068 I1)');
select is(
  (select jsonb_build_array(ca.action_type, ca.reason)
   from commissioner_actions ca
   where ca.league_id = 'b1210000-0000-4000-8000-000000000001' and ca.target_id = 'c1210001-0000-4000-8000-000000000007'),
  '["vacate_seat", null]'::jsonb,
  'F5 …its receipt reason NULL (the seam, as 169 wrote it)');
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000001', %L, 'retire', NULL, NULL,
                                          'a1210000-0000-4000-8000-0000000000f7') $$, pg_temp.m(1, 1)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'F6 RE-CUT (176): the commissioner own seat — the same refusal (was: 42501, the own-seat guard)');

-- ---------------------------------------------------------------------------
-- G. Every league state refuses (LP / LS / LC)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000002', %L, 'retire', NULL, NULL,
                                          'a1210000-0000-4000-8000-0000000000b2') $$, pg_temp.m(2, 2)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'G1 RE-CUT (176): the playoffs — the same refusal (was: refused pending Q41; Q41 is moot)');
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000003', %L, 'retire', NULL, NULL,
                                          'a1210000-0000-4000-8000-0000000000b3') $$, pg_temp.m(3, 2)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'G2 RE-CUT (176): before the draft — the same refusal (was: D42 text)');
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000004', %L, 'retire', NULL, '',
                                          'a1210000-0000-4000-8000-0000000000b4') $$, pg_temp.m(4, 2)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'G3 RE-CUT (176): a complete league — the same refusal (was: retired after the season)');
select is(pg_temp.trail(4, 2) -> 'post', 'null'::jsonb, 'G4 RE-CUT (176): …no post');

-- ---------------------------------------------------------------------------
-- H. An UNMANAGED seat — the same refusal (t7, vacated in F4)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000001', %L, 'retire', NULL, NULL,
                                          'a1210000-0000-4000-8000-0000000000c7') $$,
         (select m.id from league_members m where m.team_id = 'c1210001-0000-4000-8000-000000000007')),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'H1 RE-CUT (176): a VACATED team — the same refusal (was: retired, sealed under its last manager)');
select is(
  (select t.status || ':' || coalesce(t.successor_team_id::text, 'null') from teams t where t.id = 'c1210001-0000-4000-8000-000000000007'),
  'orphaned:null',
  'H2 RE-CUT (176): …it stays orphaned — the commissioner runs it (was: a never-managed successor refused by name; no successor exists any more)');
reset role;
select is(
  (select count(*)::int from notifications n where n.user_id = '97121000-0000-4000-8000-000000000007' and n.data ->> 'event' = 'retired'),
  0, 'H3 no one is notified of a retirement (unchanged count)');

-- ---------------------------------------------------------------------------
-- I. Totals — nothing above wrote a retirement
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from transactions
   where league_id = 'b1210000-0000-4000-8000-000000000001' and type = 'commissioner_move' and payload ->> 'verb' = 'retire_franchise'),
  1, 'I1 RE-CUT (176): LI holds ONE retire ledger row — the planted pre-176 one F2 replayed (was: six)');
select is(
  (select count(*)::int from commissioner_actions
   where league_id = 'b1210000-0000-4000-8000-000000000001' and action_type = 'retire_franchise'),
  0, 'I2 RE-CUT (176): no retire_franchise receipt (was: six)');
select is(
  (select count(*)::int from commissioner_actions
   where league_id in ('b1210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-000000000002',
                       'b1210000-0000-4000-8000-000000000003', 'b1210000-0000-4000-8000-000000000004')
     and action_type = 'retire_franchise'),
  0, 'I3 RE-CUT (176): none in any of the four leagues');
select is(
  (select count(*)::int from league_chat
   where league_id = 'b1210000-0000-4000-8000-000000000001' and is_system and message like '% was retired by %'),
  0, 'I4 RE-CUT (176): no retirement post (was: four without a tail)');
select is(
  (select count(*)::int from league_chat
   where league_id = 'b1210000-0000-4000-8000-000000000004' and is_system and message like '% was retired by %'),
  0, 'I5 RE-CUT (176): none in the complete league either (was: two with a tail)');
select is(
  (select count(*)::int from teams where league_id::text like 'b1210000-%' and (status = 'retired' or successor_team_id is not null)),
  0, 'I6 RE-CUT (176): no team sealed or succeeded in any league (was: six)');
select is(
  (select count(*)::int from teams where league_id = 'b1210000-0000-4000-8000-000000000001'),
  7, 'I7 RE-CUT (176): LI still fields its own seven teams — none minted (was: seven non-retired of thirteen)');
select is(
  (select count(*)::int from league_members where league_id = 'b1210000-0000-4000-8000-000000000001'),
  7, 'I8 still seven seats — no seat row minted or deleted');
select is(
  (select count(*)::int from team_managers
   where league_id::text like 'b1210000-%' and end_reason = 'seat_retired'),
  0, 'I9 RE-CUT (176): no stint closed seat_retired (was: five)');

select * from finish();
rollback;
