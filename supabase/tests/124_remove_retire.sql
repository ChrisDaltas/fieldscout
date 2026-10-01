-- ============================================================================
-- 124 — a team is never retired: remove_manager refuses 'retire' by name in
--       every league state (migration 176; M6 L.E1.42; spec §7.2.1, §12.22,
--       §15.1; PROGRESS D467, D461 (retire parts superseded), F548 / Q41 moot)
-- ============================================================================
-- THE RULING (Chris, 2026-10-01): "you can't simply retire a Team, you can
-- change the manager but the Team lives." / "yes drop it". Two outcomes when
-- a manager goes: takeover and vacate.
--
-- What this file proves:
--   A. form and D137 in the database: one overload, SECURITY DEFINER,
--      search_path '', anon closed / authenticated open; the live md5 (a
--      stored literal); pg_temp.un176 reverses 176's three hunks to 173's
--      text (the md5 121 A3 stores); un176 an identity on every other body;
--      NO function body in the schema writes teams.status 'retired' or
--      teams.successor_team_id; the schema keeps the 'retired' CHECK value
--      and both columns (additive-safe — old rows could hold them).
--   B. retire is refused BY NAME, P0001, in every league state (setup,
--      drafting, in season, playoffs, complete), with or without a reason
--      or an action id, on a managed seat, an unmanaged seat and the
--      commissioner own seat — and NOTHING is written (teams, seats, stints,
--      ledger, receipts, posts, notifications: one census before / after).
--      The auth gates still run first (anon; a plain manager).
--   C. the replay of a retirement committed before 176 (planted — 176 cannot
--      write one) returns its stored payload byte for byte; the same action
--      id on another seat, or naming another verb, is refused by the retire
--      sentence (nothing to replay).
--   D. takeover and vacate are unchanged: the same team lives on with a new
--      manager / with no manager, one receipt each.
--   E. a client cannot write a league team row directly (RETURNING counts
--      per role — the only other road to a seal).
--
-- Break probes (the PR, reverted): P1 re-allow retire (173's body back
-- through pg_temp.un176, applied by psql) ⇒ A2 A3-pair / A5 / B / C2 / C3 red;
-- P2 drop the replay ⇒ C1 red.
--
-- World (fabricated inside this rolled-back transaction):
--   L1 b124…01 setup · L2 …02 drafting · L3 …03 in_season · L4 …04 playoffs ·
--   L5 …05 complete — u1 commissioner (t1), u2 manager (t2) in every league;
--   in L3 also u3 (t3), u4 (t4), and t5 an open seat that never had a manager.
--   u6 holds no seat (the takeover's new manager).
-- Descriptions carry no bare apostrophes (house rule).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

-- pg_temp.un176 — 176's three hunks reversed (derive_176.py: H1 the bad-mode
-- sentence, H2 the retire pre-block, H3 the retire arm re-inserted before the
-- vacate ELSE). Each replacement text occurs once, in remove_manager only.
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
  (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'remove_manager'),
  '0f820d233905ba8b23ced962622916fb',
  'A2 the live prosrc md5 — 176 as written (stored literal)');
select is(
  (select md5(pg_temp.un176(p.prosrc)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'remove_manager'),
  '3698941d72d6efa0f1f7fa599a607a40',
  'A3 D137: the live body with 176 reversed is 173 as written (the stored md5 pgTAP 121 A3 pins)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname <> 'remove_manager' and pg_temp.un176(p.prosrc) <> p.prosrc),
  0,
  'A4 un176 is an identity on every other body in the schema (the older suites apply it innermost — additive, R992)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.prosrc ~* 'status\s*=\s*''retired''\s*,' or p.prosrc ~* 'successor_team_id\s*=\s*v_'
          or p.prosrc ~* 'end_reason\s*=\s*''seat_retired''')),
  0,
  'A5 NO function body writes teams.status retired, teams.successor_team_id or a seat_retired stint any more (the retire arm was the one writer)');
select is(
  (select format('%s|%s|%s',
     (select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conrelid = 'public.teams'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%status%'),
     (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
      where a.attrelid = 'public.teams'::regclass and a.attname in ('retired_at_week', 'successor_team_id') and not a.attisdropped),
     (select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conrelid = 'public.team_managers'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%end_reason%'))),
  'CHECK ((status = ANY (ARRAY[''active''::text, ''orphaned''::text, ''retired''::text])))|retired_at_week,successor_team_id|'
  || 'CHECK (((end_reason IS NULL) OR (end_reason = ANY (ARRAY[''kicked''::text, ''left''::text, ''seat_retired''::text, ''replaced''::text]))))',
  'A6 the schema is left additive-safe: the retired status value, both lineage columns and the seat_retired stint value stay (old rows could hold them)');

-- ---------------------------------------------------------------------------
-- Fixtures (privileged, before any JWT claims — D49(7))
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('97124000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-e124-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "e124_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 6) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams,
                     playoff_start_week, scoring_system_id, scoring_rules_snapshot, faab_budget, settings)
select ('b1240000-0000-4000-8000-00000000000' || l)::uuid, '97124000-0000-4000-8000-000000000001',
       'pgtap-e124-L' || l, 2026,
       (array['setup', 'drafting', 'in_season', 'playoffs', 'complete'])[l],
       8, 14, case when l = 4 then 4 else 0 end, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       case when l <> 1 then (select rules from scoring_systems where is_template and name = 'ESPN Standard') end,
       100, '{}'::jsonb
from generate_series(1, 5) l;

insert into teams (id, owner_id, name, league_id)
select ('c124000' || l || '-0000-4000-8000-00000000000' || i)::uuid,
       case when i = 5 then '97124000-0000-4000-8000-000000000001'::uuid
            else ('97124000-0000-4000-8000-00000000000' || i)::uuid end,
       'e124-L' || l || '-t' || i,
       ('b1240000-0000-4000-8000-00000000000' || l)::uuid
from generate_series(1, 5) l, generate_series(1, 5) i
where l = 3 or i <= 2;
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, case when t.name like '%-t5' then null else t.owner_id end, t.id,
       case when t.name like '%-t1' then 'commissioner' else 'manager' end,
       t.name like '%-t5', 100
from teams t where t.id::text like 'c124000%';
insert into team_managers (league_id, team_id, user_id, role)
select t.league_id, t.id, t.owner_id, 'manager' from teams t
where t.id::text like 'c124000%' and t.name not like '%-t5';

-- The member id of league l, team i.
create function pg_temp.m(l int, i int) returns uuid language sql as $$
  select lm.id from public.league_members lm
  where lm.team_id = ('c124000' || l || '-0000-4000-8000-00000000000' || i)::uuid
$$;
-- Everything a retirement would have written, across the five leagues.
create function pg_temp.census() returns text language sql as $$
  select format('teams=%s sealed=%s seats=%s seated=%s stints=%s open=%s tx=%s ca=%s chat=%s notes=%s',
    (select count(*) from public.teams where league_id::text like 'b1240000-%'),
    (select count(*) from public.teams where league_id::text like 'b1240000-%' and (status = 'retired' or successor_team_id is not null or retired_at_week is not null)),
    (select count(*) from public.league_members where league_id::text like 'b1240000-%'),
    (select count(*) from public.league_members where league_id::text like 'b1240000-%' and user_id is not null),
    (select count(*) from public.team_managers where league_id::text like 'b1240000-%'),
    (select count(*) from public.team_managers where league_id::text like 'b1240000-%' and ended_at is null),
    (select count(*) from public.transactions where league_id::text like 'b1240000-%'),
    (select count(*) from public.commissioner_actions where league_id::text like 'b1240000-%'),
    (select count(*) from public.league_chat where league_id::text like 'b1240000-%'),
    (select count(*) from public.notifications where user_id::text like '97124000-%'))
$$;
create temp table _c0 as select pg_temp.census() as c;
select is((select c from _c0),
  'teams=13 sealed=0 seats=13 seated=12 stints=12 open=12 tx=0 ca=0 chat=0 notes=0',
  'B0 PREMISE (stored literal): thirteen teams, none sealed; twelve managed seats and one open seat that never had a manager (L3 t5)');

-- ---------------------------------------------------------------------------
-- B. retire is refused BY NAME in every state, on every kind of seat
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  format($$ select public.remove_manager('b1240000-0000-4000-8000-000000000003', %L, 'retire', NULL, NULL, 'a1240000-0000-4000-8000-000000000001') $$, pg_temp.m(3, 2)),
  '42501', 'remove_manager: must be signed in',
  'B1 anon is refused first (the auth gate still runs before the retire refusal)');
select set_config('request.jwt.claims', '{"sub": "97124000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.remove_manager('b1240000-0000-4000-8000-000000000003', %L, 'retire', NULL, NULL, 'a1240000-0000-4000-8000-000000000001') $$, pg_temp.m(3, 3)),
  '42501', 'remove_manager: not a commissioner of this league',
  'B2 a plain manager is refused as a non-commissioner (unchanged)');
select set_config('request.jwt.claims', '{"sub": "97124000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.remove_manager('b1240000-0000-4000-8000-000000000001', %L, 'retire', NULL, NULL, 'a1240000-0000-4000-8000-000000000011') $$, pg_temp.m(1, 2)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'B3 before the draft (setup): refused BY NAME');
select throws_ok(
  format($$ select public.remove_manager('b1240000-0000-4000-8000-000000000002', %L, 'retire', NULL, NULL, 'a1240000-0000-4000-8000-000000000012') $$, pg_temp.m(2, 2)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'B4 during the draft: refused BY NAME');
select throws_ok(
  format($$ select public.remove_manager('b1240000-0000-4000-8000-000000000003', %L, 'retire', NULL, 'moving away', 'a1240000-0000-4000-8000-000000000013') $$, pg_temp.m(3, 2)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'B5 in season, with a reason and an action id: refused BY NAME (was the arm 120 / 173 ran)');
select throws_ok(
  format($$ select public.remove_manager('b1240000-0000-4000-8000-000000000003', %L, 'retire') $$, pg_temp.m(3, 3)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'B6 in season, no reason and no action id: the same refusal (never the old action-id shape error)');
select throws_ok(
  format($$ select public.remove_manager('b1240000-0000-4000-8000-000000000004', %L, 'retire', NULL, NULL, 'a1240000-0000-4000-8000-000000000014') $$, pg_temp.m(4, 2)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'B7 in the playoffs: refused BY NAME (Q41 is moot)');
select throws_ok(
  format($$ select public.remove_manager('b1240000-0000-4000-8000-000000000005', %L, 'retire', NULL, NULL, 'a1240000-0000-4000-8000-000000000015') $$, pg_temp.m(5, 2)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'B8 after the season (complete): refused BY NAME');
select throws_ok(
  format($$ select public.remove_manager('b1240000-0000-4000-8000-000000000003', %L, 'retire', NULL, NULL, 'a1240000-0000-4000-8000-000000000016') $$, pg_temp.m(3, 5)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'B9 an open seat that never had a manager: the same refusal (F548 is moot)');
select throws_ok(
  format($$ select public.remove_manager('b1240000-0000-4000-8000-000000000003', %L, 'retire', NULL, NULL, 'a1240000-0000-4000-8000-000000000017') $$, pg_temp.m(3, 1)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'B10 the commissioner own seat: the same refusal');
select throws_ok(
  format($$ select public.remove_manager('b1240000-0000-4000-8000-000000000003', %L, 'RETIRE', NULL, NULL, NULL) $$, pg_temp.m(3, 2)),
  '22023', 'remove_manager: mode must be takeover or vacate (§7.2.1)',
  'B11 an unknown mode is refused by the bad-mode sentence, which names the two outcomes');
reset role;
select is(pg_temp.census(), (select c from _c0),
  'B12 NOTHING was written by any refusal: the census is byte-identical (no seal, no successor, no seat or stint change, no ledger row, receipt, post or notification)');

-- ---------------------------------------------------------------------------
-- C. The replay of a retirement committed before 176
-- ---------------------------------------------------------------------------
insert into transactions (league_id, type, status, payload, action_id)
values ('b1240000-0000-4000-8000-000000000003', 'commissioner_move', 'complete',
        jsonb_build_object('ok', true, 'mode', 'retire', 'verb', 'retire_franchise',
                           'action_id', 'a1240000-0000-4000-8000-0000000000e1', 'member_id', pg_temp.m(3, 4),
                           'retired_team_name', 'e124-L3-t4', 'successor_team_name', 'Team 9',
                           'retired_at_week', 3, 'reason', null),
        'a1240000-0000-4000-8000-0000000000e1');
insert into transactions (league_id, type, status, payload, action_id)
values ('b1240000-0000-4000-8000-000000000003', 'commissioner_move', 'complete',
        jsonb_build_object('ok', true, 'verb', 'replace_manager', 'member_id', pg_temp.m(3, 3)),
        'a1240000-0000-4000-8000-0000000000e2');
create temp table _c1 as select pg_temp.census() as c;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97124000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  public.remove_manager('b1240000-0000-4000-8000-000000000003', pg_temp.m(3, 4), 'retire', NULL, 'another reason',
                        'a1240000-0000-4000-8000-0000000000e1'),
  (select t.payload from transactions t where t.action_id = 'a1240000-0000-4000-8000-0000000000e1'),
  'C1 a retry of a pre-176 retirement returns its stored payload byte for byte (the refusal sits after the replay, L.D3.16 shape)');
select throws_ok(
  format($$ select public.remove_manager('b1240000-0000-4000-8000-000000000003', %L, 'retire', NULL, NULL, 'a1240000-0000-4000-8000-0000000000e1') $$, pg_temp.m(3, 2)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'C2 the same action id on ANOTHER seat replays nothing — the retire refusal');
select throws_ok(
  format($$ select public.remove_manager('b1240000-0000-4000-8000-000000000003', %L, 'retire', NULL, NULL, 'a1240000-0000-4000-8000-0000000000e2') $$, pg_temp.m(3, 3)),
  'P0001', 'remove_manager: a team can''t be retired — seat a new manager or leave it vacant (§7.2.1)',
  'C3 an action id naming ANOTHER verb replays nothing — the retire refusal');
reset role;
select is(pg_temp.census(), (select c from _c1), 'C4 …and the replay and both refusals wrote nothing');
select is(
  (select t.status || ':' || coalesce(t.successor_team_id::text, 'null') from teams t where t.id = 'c1240003-0000-4000-8000-000000000004'),
  'active:null',
  'C5 the team the planted payload names is untouched — a replay returns history, it never re-applies it');

-- ---------------------------------------------------------------------------
-- D. takeover and vacate are unchanged — the team lives on
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97124000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select jsonb_build_array(r ->> 'mode', r ->> 'team_id', r ->> 'successor_user_id', r ->> 'already_vacant')
   from (select public.remove_manager('b1240000-0000-4000-8000-000000000003', pg_temp.m(3, 2), 'takeover',
                                      '97124000-0000-4000-8000-000000000006') as r) x),
  '["takeover", "c1240003-0000-4000-8000-000000000002", "97124000-0000-4000-8000-000000000006", "false"]'::jsonb,
  'D1 takeover: the SAME team gets a new manager');
select is(
  (select jsonb_build_array(r ->> 'mode', r ->> 'team_id', r ->> 'already_vacant')
   from (select public.remove_manager('b1240000-0000-4000-8000-000000000003', pg_temp.m(3, 3), 'vacate') as r) x),
  '["vacate", "c1240003-0000-4000-8000-000000000003", "false"]'::jsonb,
  'D2 vacate: the SAME team stays, with no manager');
reset role;
select is(
  (select string_agg(t.name || '=' || t.status || ':' || coalesce(t.successor_team_id::text, 'null') || ':' || coalesce(lm.user_id::text, 'open'), ' ' order by t.name)
   from teams t join league_members lm on lm.team_id = t.id
   where t.id in ('c1240003-0000-4000-8000-000000000002', 'c1240003-0000-4000-8000-000000000003')),
  'e124-L3-t2=active:null:97124000-0000-4000-8000-000000000006 e124-L3-t3=orphaned:null:open',
  'D3 t2 is active under u6, t3 is orphaned (the commissioner runs it); neither has a successor');
select is(
  (select string_agg(ca.action_type || ':' || ca.target_id, ' ' order by ca.action_type)
   from commissioner_actions ca where ca.league_id = 'b1240000-0000-4000-8000-000000000003'),
  'replace_manager:c1240003-0000-4000-8000-000000000002 vacate_seat:c1240003-0000-4000-8000-000000000003',
  'D4 one receipt each — replace_manager and vacate_seat — and still no retire_franchise');
select is(
  (select count(*)::int from teams where league_id = 'b1240000-0000-4000-8000-000000000003'),
  5, 'D5 the league still fields its own five teams — none minted, none sealed');
select is(
  (select string_agg(tm.end_reason, ',' order by tm.end_reason) from team_managers tm
   where tm.league_id = 'b1240000-0000-4000-8000-000000000003' and tm.ended_at is not null),
  'kicked,replaced', 'D6 the closed stints are replaced and kicked — never seat_retired');

-- ---------------------------------------------------------------------------
-- E. No client writes a league team row directly (RETURNING counts)
-- ---------------------------------------------------------------------------
create temp table _n (who text, n int);
grant all on _n to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97124000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
with u as (update teams set status = 'retired', successor_team_id = 'c1240003-0000-4000-8000-000000000005'
           where id = 'c1240003-0000-4000-8000-000000000001' returning 1)
insert into _n select 'commish-own', count(*) from u;
with u as (update teams set status = 'retired' where league_id = 'b1240000-0000-4000-8000-000000000003' returning 1)
insert into _n select 'commish-all', count(*) from u;
select set_config('request.jwt.claims', '{"sub": "97124000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
with u as (update teams set status = 'retired', retired_at_week = 3
           where id = 'c1240003-0000-4000-8000-000000000004' returning 1)
insert into _n select 'manager-own', count(*) from u;
reset role;
select is((select string_agg(who || '=' || n, ' ' order by who) from _n),
  'commish-all=0 commish-own=0 manager-own=0',
  'E1 the commissioner (own team, whole league) and a manager (own team) seal 0 rows directly (RLS: a league team has no client writer — D53)');
select is(
  (select count(*)::int from teams where league_id::text like 'b1240000-%' and (status = 'retired' or successor_team_id is not null or retired_at_week is not null)),
  0, 'E2 …and no team anywhere in the five leagues is sealed or succeeded');

select * from finish();
rollback;
