-- ============================================================================
-- 128 — league posts and notices in plain English (migration 180; F569
--       part 2, F573; PROGRESS D490)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  FORM and D137 — each of the five bodies keeps its security, its
--       search_path '' and its client EXECUTE as before; the live prosrc md5s
--       are stored literals; with 180's 26 hunks reversed (pg_temp.un180)
--       each md5 is its newest definer's FILE TEXT (149:1924-1987,
--       118:1945-2218, 155:190-257, 155:551-724, 156:205-668 — stored
--       literals; 103 A7 and 105 A6 already held two of them).
--   §B  THE SETTINGS PANEL'S WORDS (F573) — every refused key's refused_why
--       is pinned character for character, partners share their sentence,
--       and no reason in the catalog carries a spec mark, a ledger code, a
--       line reference or a snake_case setting name.
-- The stored / sent sentences of finalize_matchups, trade_vote_veto_internal,
-- trade_tick and trade_execute_internal are pinned where they are produced
-- over real fixtures: 064 E11c, 099 D4 / G7 / F12 / I4 / I5, 103 D7 / D16 /
-- E4 / E7, 104 F3 / F4b, 122 X12 / X13 / Y7 (moved by 180).
-- Break probe (§4.3): put a code back into one refused_why (team_count's)
-- ⇒ A2, A3, B1, B13 and 077 E2 red (shown in the PR, reverted).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

-- pg_temp.un201 — migration 201's pairs reversed (derive_201.py; pgTAP 151
-- pins it). RE-PINNED BY D591 ("Allow illegal lineups" retired:
-- set_lineup_internal, commish_edit_lineup_internal, lineup_autopilot_internal
-- and commish_setting_policy changed; an identity on every other body —
-- additive, R992). Applied INNERMOST.
create function pg_temp.un201(s text) returns text language plpgsql as $un201$
begin
  -- set_lineup_internal
  s := replace(s, $n201$      -- The bye / OUT refusal that stood here is RETIRED with the setting: a bye or   -- 201 / D591
      -- injured starter, or an empty slot, never refuses a save. He keeps his flag (above)   -- 201 / D591
      -- and scores what he scores — 0 if he does not play. What still refuses a lineup:   -- 201 / D591
      -- the position fit (8), the kickoff locks (7), one start per week, and IR (9).   -- 201 / D591
$n201$,
                 $o201$      -- §7.3.6 allow_illegal_lineups = FALSE: a bye/OUT starter in an
      -- UNLOCKED slot blocks the submit by name.
      -- (a locked slot's bye/OUT player is not the manager's to change:
      --  exempt when the stored player's own game has kicked off, R739.)
      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0
         AND NOT ((v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
                  AND (v_stored ->> v_key) = v_pid)
         AND NOT (v_gone_kick ? v_pid) THEN   -- 154 / F445: a kept off-roster starter is not the manager's to change
        RAISE EXCEPTION
          'set_lineup: % is % for week % and allow_illegal_lineups is off — slot "%" is blocked at submit (§7.3.6); bench him or start someone who plays',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key
          USING ERRCODE = 'P0001';
      END IF;
$o201$);
  s := replace(s, $n201$  -- "Allow illegal lineups" is RETIRED (§7.3.6; Chris 2026-10-20: "That shouldn't be blocking   -- 201 / D591
  -- anyone from doing anything."): the stored value is ignored, and the result's   -- 201 / D591
  -- allow_illegal_lineups key stays for its readers, always TRUE.   -- 201 / D591
  v_allow := TRUE;   -- 201 / D591
$n201$,
                 $o201$  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);
$o201$);
  -- commish_edit_lineup_internal
  s := replace(s, $n201$      -- The bye / OUT refusal that stood here is RETIRED with the setting (it refused the   -- 201 / D591
      -- commissioner too — spec §7.3.6 / §11.1 said he is never refused): a bye or injured   -- 201 / D591
      -- starter, or an empty slot, never refuses a save. He keeps his flag (above) and   -- 201 / D591
      -- scores what he scores. The position fit (8) and one start per week still bind.   -- 201 / D591
$n201$,
                 $o201$      -- §7.3.6 allow_illegal_lineups = FALSE. KEPT (see WHAT IS NOT LIFTED).
      -- 166 / F500: R739's exemption, carried exactly as set_lineup_internal
      -- step (10) has it (157): a STORED starter whose own game has kicked
      -- off (his per-player datum, step (6)) and who stays at his stored key
      -- is not blocked — his game is under way or over, so keeping him where
      -- he stands is the week as it happened, not a submit. 123 dropped the
      -- clause as meaningless for a verb with no lock; without it a starter
      -- who played Thursday and was put on IR before Sunday refused every
      -- commissioner fix to that week unless he benched him (changing the
      -- score) — a save the manager may make: a TIMING refusal of the
      -- commissioner (standing rule (g)). Putting a bye / OUT player at any
      -- key he is not stored at (moving him, or starting one from the
      -- bench) is still refused by name, as it is for the manager. The
      -- stored-occupant test is spelled NULL-SAFE here: set_lineup's `=`
      -- yields NULL for a key that was empty, which cannot reach its gate
      -- (step (7b) refuses a kicked-off player entering a slot first) but
      -- would reach this one (no lock) and let a moved OUT starter through.
      -- The kept-start clause below (154 / F441) is spelled the same way
      -- (F503): its `=` let a kept OFF-ROSTER starter, now OUT, be moved
      -- into an empty key without the refusal.
      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0
         AND NOT ((v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
                  AND (v_stored ->> v_key) IS NOT DISTINCT FROM v_pid)   -- 166 / F500: R739, as set_lineup (null-safe)
         AND NOT (v_gone_kick ? v_pid AND (v_stored ->> v_key) IS NOT DISTINCT FROM v_pid) THEN   -- 154 / F441: a kept start where it stands is the week's record, not a submit (166 / F503: null-safe too — an empty key must not exempt a moved kept start)
        RAISE EXCEPTION
          'commish_edit_lineup: % is % for week % and this league doesn''t allow illegal lineups — slot "%" can''t be saved like this; bench him, start someone who plays, or turn on illegal lineups in the league settings',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key
          USING ERRCODE = 'P0001';
      END IF;
$o201$);
  s := replace(s, $n201$  -- "Allow illegal lineups" is RETIRED (§7.3.6; Chris 2026-10-20: "That shouldn't be blocking   -- 201 / D591
  -- anyone from doing anything."): the stored value is ignored, and the result's   -- 201 / D591
  -- allow_illegal_lineups key stays for its readers, always TRUE.   -- 201 / D591
  v_allow := TRUE;   -- 201 / D591
$n201$,
                 $o201$  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);
$o201$);
  -- lineup_autopilot_internal
  s := replace(s, $n201$  -- `v_tail`. An IR-held man, a seated (fixed) starter and a locked man are   -- 201 / D591
  -- never ordered by this pass, so they   -- 201 / D591
$n201$,
                 $o201$  -- `v_tail`. An IR-held man, a seated (fixed) starter, a locked man and one
  -- the allow = FALSE filter refused are never ordered by this pass, so they
$o201$);
  s := replace(s, $n201$          -- (the "league forbids illegal lineups" reason is retired with the setting)   -- 201 / D591
$n201$,
                 $o201$          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_filtered) x WHERE v_elig ? (x ->> 'position'))
            THEN 'no healthy eligible player at ' || upper(v_e ->> 'slot') || '; league forbids illegal lineups'
$o201$);
  s := replace(s, $n201$  -- remaining slots are offered to the unhealthy tail — the Doubtful men first, then   -- 201 / D591
  -- the blocked men — so a slot any unlocked eligible man could take is filled.   -- 201 / D591
$n201$,
                 $o201$  -- remaining slots are offered to the unhealthy tail — which, when the
  -- league forbids illegal lineups, holds only the Doubtful men (138), so a
  -- slot only a BLOCKED man could take stays `unfillable`.
$o201$);
  s := replace(s, $n201$      ELSE   -- a blocked man is always the tail: the allow = FALSE hard filter is retired   -- 201 / D591
        -- A PREFERENCE, not a filter: seated LAST, never left out, because an
        -- empty slot is the zero this task exists to remove (item 4c).
        v_tail := v_tail || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
      END IF;
$n201$,
                 $o201$      ELSIF v_allow THEN
        -- A PREFERENCE, not a filter: seated LAST, never left out, because an
        -- empty slot is the zero this task exists to remove (item 4c).
        v_tail := v_tail || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
      ELSE
        v_filtered := v_filtered || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position');
      END IF;
$o201$);
  s := replace(s, $n201$  -- §7.3.6's "Allow illegal lineups" is RETIRED (Chris 2026-10-20): the stored value is   -- 201 / D591
  -- ignored. A blocked man (bye / OUT / IR / PUP / NFI / Suspended) is always the TAIL —   -- 201 / D591
  -- seated LAST, behind every healthy and Doubtful candidate, never filtered out — and   -- 201 / D591
  -- the result's allow_illegal_lineups key stays for its readers, always TRUE.   -- 201 / D591
  v_allow := TRUE;   -- 201 / D591
$n201$,
                 $o201$  -- §7.3.6's per-league setting, read the way `set_lineup` reads it
  -- (`114:307`): absent ⇒ TRUE.
  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);
$o201$);
  s := replace(s, $n201$  v_locked_out  JSONB := '[]'::jsonb;        -- skipped_locked[]
  -- (v_filtered — the allow = FALSE hard filter's refusals — is gone with the setting)   -- 201 / D591
$n201$,
                 $o201$  v_locked_out  JSONB := '[]'::jsonb;        -- skipped_locked[]
  v_filtered    JSONB := '[]'::jsonb;        -- refused by the allow = FALSE hard filter
$o201$);
  -- commish_setting_policy
  s := replace(s, $n201$                                  'This setting has been retired: a waiver claim always fails if the player you''d drop has already played this week, just like a regular drop.')
    -- Chris 2026-10-20: "You can always start a player on a buy [bye]. … That shouldn't be blocking anyone   -- 201 / D591
    -- from doing anything." A lineup save is never refused over a bye or injured starter, or an empty   -- 201 / D591
    -- slot; a value already stored is simply ignored (no data rewrite, no CHECK).   -- 201 / D591
    WHEN p_key IN ('allow_illegal_lineups') THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',   -- 201 / D591
                                  'This setting has been retired: a lineup always saves, even with a player who is on a bye or injured — he scores only if he plays.')   -- 201 / D591
$n201$,
                 $o201$                                  'This setting has been retired: a waiver claim always fails if the player you''d drop has already played this week, just like a regular drop.')
$o201$);
  s := replace(s, $n201$         'auto_sub_inactives', 'stat_correction_window',   -- 201 / D591: allow_illegal_lineups is retired, refused below
$n201$,
                 $o201$         'allow_illegal_lineups', 'auto_sub_inactives', 'stat_correction_window',
$o201$);
  return s;
end
$un201$;
-- pg_temp.un199 — migration 199's hunks reversed for trade_execute_internal, trade_tick
-- (2 of 199's 81; generated by gen_un199.py from derive_199.py's pairs — each
-- replacement text occurs once across every live body, so this is an identity
-- on every other body). Applied INNERMOST.
create function pg_temp.un199(s text) returns text language plpgsql as $un199$
begin
  s := replace(s, $n199$        CASE WHEN v_league.deleted_at IS NOT NULL THEN 'deleted' WHEN v_league.status = 'complete' THEN 'over for the season' ELSE 'not in its season' END
        USING ERRCODE = 'P0001';$n199$,
                 $o199$        CASE WHEN v_league.deleted_at IS NOT NULL THEN 'deleted' WHEN v_league.status = 'complete' THEN 'over for the season' ELSE 'not in its season' END
        USING ERRCODE = 'P0001';
    END IF;
    IF v_proposer.status = 'retired' OR v_recipient.status = 'retired' THEN
      RAISE EXCEPTION 'trade_execute: % is retired and can''t make trades',
        CASE WHEN v_proposer.status = 'retired' THEN v_proposer.name ELSE v_recipient.name END
        USING ERRCODE = 'P0001';$o199$);
  s := replace(s, $n199$        ELSE
          SELECT tm.name || ' can no longer give $' || i.faab_amount || ' of FAAB — its balance is '
                 || COALESCE('$' || m.faab_balance, 'not set')
          INTO v_reason
          FROM public.trade_items i
          JOIN public.teams tm ON tm.id = i.from_team_id
          LEFT JOIN public.league_members m ON m.league_id = v_league.id AND m.team_id = i.from_team_id
          WHERE i.trade_id = v_t.id AND i.faab_amount IS NOT NULL
            AND (m.faab_balance IS NULL OR m.faab_balance < i.faab_amount)
          ORDER BY tm.name LIMIT 1;
        END IF;$n199$,
                 $o199$        ELSE
          SELECT tm.name || ' is retired and can''t make trades' INTO v_reason
          FROM public.teams tm
          WHERE tm.id IN (v_t.proposer_team_id, v_t.recipient_team_id) AND tm.status = 'retired'
          ORDER BY tm.name LIMIT 1;
          IF v_reason IS NULL THEN
            SELECT tm.name || ' can no longer give $' || i.faab_amount || ' of FAAB — its balance is '
                   || COALESCE('$' || m.faab_balance, 'not set')
            INTO v_reason
            FROM public.trade_items i
            JOIN public.teams tm ON tm.id = i.from_team_id
            LEFT JOIN public.league_members m ON m.league_id = v_league.id AND m.team_id = i.from_team_id
            WHERE i.trade_id = v_t.id AND i.faab_amount IS NOT NULL
              AND (m.faab_balance IS NULL OR m.faab_balance < i.faab_amount)
            ORDER BY tm.name LIMIT 1;
          END IF;
        END IF;$o199$);
  return s;
end
$un199$;

-- pg_temp.un180 — migration 180's 26 wording hunks reversed (generated by
-- gen_un180.py from derive_180.py's pairs); an identity on every body
-- 180 did not touch. Applied INNERMOST.
-- pg_temp.un212 — migration 212's inserted job lines removed (each ends
-- `-- 212 / F716…`; F716, the archive freeze — pgTAP 162 A9 pins them); an
-- identity on every body without them.
create function pg_temp.un212(p_src text) returns text language sql as $un212$
  select regexp_replace(p_src, E'\n[^\n]*-- 212 / F716[^\n]*', '', 'g')
$un212$;
-- pg_temp.un183 — migration 183's two inserted lines per job body removed
-- (each marked `183 / L.G1.3 (TD4)`); an identity on every other body.
create function pg_temp.un183(p_src text) returns text language sql as $un183$
  select regexp_replace(
           regexp_replace(p_src,
             E'\n\n  PERFORM public\\.job_pause_note_internal\\(''[a-z-]+'', p_league_id, p_now\\);   -- 183 / L\\.G1\\.3 \\(TD4\\)', '', 'g'),
           E'        AND NOT public\\.job_paused_internal\\(''[a-z-]+'', l\\.id\\)   -- 183 / L\\.G1\\.3 \\(TD4\\)\n', '', 'g')
$un183$;
create function pg_temp.un180(p_src text) returns text language sql as $un180$
  select replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(p_src,
    E'\'The playoff bracket has already been set from this, so it can\'\'t change once the playoffs start.\')\n    WHEN p_key IN (\'playoff_weeks_per_round\'',
    E'\'once the league is in playoffs (or complete) the bracket has been SEEDED from this key (118:1075-1077, :1338-1340); no verb re-seeds a bracket under played rounds\')\n    WHEN p_key IN (\'playoff_weeks_per_round\''),
    E'\'The playoff bracket has already been set from this, so it can\'\'t change once the playoffs start.\')\n    -- REFUSED',
    E'\'once the league is in playoffs (or complete) the bracket has been SEEDED from this key (118:1075-1077, :1338-1340); no verb re-seeds a bracket under played rounds\')\n    -- REFUSED'),
    E'\'The season\'\'s weeks and matchups are already set, so the length of the regular season and when the playoffs start can only change before the draft.\'',
    E'\'this key defines the SEASON WINDOW: league_weeks and matchups were generated for the stored plan (111:346, :422) and the standings cutoff reads it (D288), so moving it under rows that already exist re-plans nothing and re-cuts the standings; it is also coupled to its partner by Q10 (playoff_start_week = regular_season_weeks + 1), which one key at a time cannot keep. Pre-draft the route is update_league_settings, which validates the pair; post-draft no verb re-plans a season\''),
    E'\'The number of teams can only change before the draft — every team already has its place and its schedule.\'',
    E'\'team_count is PRE-DRAFT ONLY (§7.3, erratum v2.16.40 — Q65 ruled (b) by Chris 2026-09-15): seats (teams / league_members) and a schedule already exist for the stored count; pre-draft the route is update_league_settings (F28\'\'s seat floor lives there, 118:2499-2510); post-draft there is NO route — no verb raises this number in-season, and a placeholder seat cannot be added past the stored ceiling\''),
    E'\'The schedule has already been made from this, so it can only change before the draft.\'',
    E'\'this key defines the SCHEDULE SHAPE: primary, secondary and median rows are generated by the schedule engine (110/111) from it, and flipping it under rows that already exist leaves rows nothing reads or removes. Pre-draft the route is update_league_settings; post-draft no verb re-plans a schedule\''),
    E'\'Leagues are redraft only for now — there\'\'s nothing else to switch to.\'',
    E'\'pinned to redraft in v1 (§7.3.1) — there is no other value to change it to\''),
    E'\'Each player\'\'s lineup spot always locks when his own game kicks off — this can\'\'t be changed.\'',
    E'\'pinned to per_player_kickoff by 114\'\'s CHECK (Q34(A)) — any other value is a constraint violation\''),
    E'\'Divisions aren\'\'t available yet — the whole league plays as one group.\'',
    E'\'pinned to 1 (Q30 (d), v2.16.12) — the engine ignores the value\''),
    E'\'Playoff byes come from the number of playoff teams — change that instead.\'',
    E'\'derived from the bracket size (§7.3.1: the literal \'\'auto\'\') — not independently settable\''),
    E'\'This is set automatically when the schedule is made or reshuffled.\'',
    E'\'minted by the schedule engine and re-minted by a remix (F246) — never set by hand\''),
    E'\'This setting has been replaced: pick the days and time waivers run, and when free agency opens, instead. A dropped player stays on waivers until the next waiver run.\'',
    E'\'RETIRED by the waiver schedule (Q70, ruled 2026-09-27; spec §7.3.4 v2.16.59): when waivers run is waiver_run_days + waiver_run_time in waiver_time_zone, and when free agency is open is free_agency_opens (+ free_agency_open_day / free_agency_open_time); a dropped player is on waivers until the next run, so there is no waiver period to set\''),
    E'\'This setting has been retired: a waiver claim always fails if the player you\'\'d drop has already played this week, just like a regular drop.\'',
    E'\'RETIRED (Q73, ruled 2026-09-27; spec §7.3.4 v2.16.59): a waiver claim whose drop has already played this week always fails at the waiver run — the same rule as a manual drop — so there is nothing to switch\''),
    E'\'The draft is over, so its settings can\'\'t change now.\'',
    E'\'the §7.3.8 draft block: pre-draft it belongs to the wizard / update_league_settings; post-draft the draft has happened and the block has no subject\''),
    E'\' is final without the postponed game\' ||',
    E'\' was finalized without the postponed game\' ||'),
    E'\' — players in a game moved out of the week score 0 for the week. The commissioner can change a result.\',',
    E'\' — players in a game postponed out of the week score 0 for the week (§23.3/E43); the commissioner may override.\','),
    E'\' managers who can vote voted to veto, and the league needs \'',
    E'\' managers who can vote voted to veto, and the league\'\'s number is \''),
    E'is more than the managers who can vote)\'\n            ELSE \'\' END;',
    E'is more than the managers who can vote)\'\n            ELSE \'\' END\n    || \' (§13.3 / Q77)\';'),
    E'              || \' began (\' || (v_deadline ->> \'label\') || \')\',',
    E'              || \' began (\' || (v_deadline ->> \'label\') || \'; trade_deadline_week \' || (v_deadline ->> \'deadline_week\') || \', §13.3 / Q76)\','),
    E'          v_reason := \'the league is \' || CASE WHEN v_league.deleted_at IS NOT NULL THEN \'deleted\' WHEN v_league.status = \'complete\' THEN \'over for the season\' ELSE \'not in its season\' END\n                      || \' — trades only go through during the season and the playoffs\';',
    E'          v_reason := \'the league is \' || CASE WHEN v_league.deleted_at IS NOT NULL THEN \'deleted\' ELSE v_league.status END\n                      || \' — a trade goes through only while the league is in season or in the playoffs (§7.1 / §13.3)\';'),
    E'          SELECT tm.name || \' is retired and can\'\'t make trades\' INTO v_reason',
    E'          SELECT tm.name || \' is retired — a sealed franchise makes no trades (§7.2.1)\' INTO v_reason'),
    E'|| COALESCE(\'$\' || m.faab_balance, \'not set\')',
    E'|| COALESCE(\'$\' || m.faab_balance, \'not recorded\') || \' (§13.3)\''),
    E'      RAISE EXCEPTION \'trade_execute: the league is % — trades only go through during the season and the playoffs\',\n        CASE WHEN v_league.deleted_at IS NOT NULL THEN \'deleted\' WHEN v_league.status = \'complete\' THEN \'over for the season\' ELSE \'not in its season\' END',
    E'      RAISE EXCEPTION \'trade_execute: the league is % — a trade goes through only while the league is in season or in the playoffs (§7.1 / §13.3)\',\n        CASE WHEN v_league.deleted_at IS NOT NULL THEN \'deleted\' ELSE v_league.status END'),
    E'\'trade_execute: % is retired and can\'\'t make trades\',',
    E'\'trade_execute: % is retired — a sealed franchise makes no trades (§7.2.1)\','),
    E'\'trade_execute: % has no FAAB budget to receive $% into\',',
    E'\'trade_execute: % has no FAAB balance on record to receive $% into (§12.2)\','),
    E'\' already played this week, and this league cancels a trade like that instead of waiting for the week\'\'s last game to end\',',
    E'\' already kicked off this week and cannot change teams until the week\'\'s last game ends — this league fails such a trade instead of waiting (trade_lock_behavior = reject, E35)\','),
    E'\' already played this week, so the whole trade goes through right after the week\'\'s last game ends. Until then every player stays with his team.\',',
    E'\' already played this week, so the whole trade goes through right after the week\'\'s last game ends (E35); until then every player stays with his team\',')
$un180$;

-- ---------------------------------------------------------------------------
-- A. Form and D137
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_setting_policy', 'finalize_matchups', 'trade_execute_internal', 'trade_tick', 'trade_vote_veto_internal')),
  'commish_setting_policy:f:search_path="":f finalize_matchups:t:search_path="":f trade_execute_internal:f:search_path="":f trade_tick:f:search_path="":f trade_vote_veto_internal:f:search_path="":f',
  'A1 form unchanged: finalize_matchups SECURITY DEFINER, the rest not; search_path '''' on all five; anon executes none');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un183(pg_temp.un199(pg_temp.un201(pg_temp.un212(p.prosrc))))), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_setting_policy', 'finalize_matchups', 'trade_execute_internal', 'trade_tick', 'trade_vote_veto_internal')),
  'commish_setting_policy=2550d16b263ed670fecf42883931315e finalize_matchups=5239ab311af797a401bb91d00d78f9bd trade_execute_internal=dae3b9d576251356c39932bd7649177f trade_tick=c45ab31cf5c172eadc4e4566d7dd18b0 trade_vote_veto_internal=0e7abc429e88101e59a828c890eb65a0',
  'A2 the five live prosrc md5s — 180 as written (stored literals; 183''s two finalize_matchups pause lines reversed first — L.G1.3)');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un180(pg_temp.un183(pg_temp.un199(pg_temp.un201(pg_temp.un212(p.prosrc)))))), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_setting_policy', 'finalize_matchups', 'trade_execute_internal', 'trade_tick', 'trade_vote_veto_internal')),
  'commish_setting_policy=35c597336b625a6896981d3bda1b1fd9 finalize_matchups=023892388a95d6df2dd1cf44f4341928 trade_execute_internal=044fd0a7668adb67c2c81b0e452b8341 trade_tick=8ed5c0706d2fa7da12898deeda721c31 trade_vote_veto_internal=220794d66953336530f746e2d2b62f0e',
  'A3 D137: with 180''s hunks reversed each body is its newest definer''s FILE TEXT (stored literals) — 180 changed wording and nothing else');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_setting_policy', 'finalize_matchups', 'trade_execute_internal', 'trade_tick', 'trade_vote_veto_internal')
     and pg_temp.un180(p.prosrc) <> p.prosrc),
  5,
  'A4 …and every one of the five carries at least one of 180''s hunks');

-- ---------------------------------------------------------------------------
-- B. The settings panel's words (F573)
-- ---------------------------------------------------------------------------
select is(public.commish_setting_policy('team_count') ->> 'refused_why',
  'The number of teams can only change before the draft — every team already has its place and its schedule.',
  'B1 team_count');
select is(public.commish_setting_policy('regular_season_weeks') ->> 'refused_why',
  'The season''s weeks and matchups are already set, so the length of the regular season and when the playoffs start can only change before the draft.',
  'B2 regular_season_weeks');
select is(public.commish_setting_policy('schedule_mode') ->> 'refused_why',
  'The schedule has already been made from this, so it can only change before the draft.',
  'B3 schedule_mode');
select is(public.commish_setting_policy('playoff_teams') ->> 'refused_why',
  'The playoff bracket has already been set from this, so it can''t change once the playoffs start.',
  'B4 playoff_teams (class bracket)');
select is(public.commish_setting_policy('format') ->> 'refused_why',
  'Leagues are redraft only for now — there''s nothing else to switch to.', 'B5 format');
select is(public.commish_setting_policy('lineup_lock') ->> 'refused_why',
  'Each player''s lineup spot always locks when his own game kicks off — this can''t be changed.', 'B6 lineup_lock');
select is(public.commish_setting_policy('divisions') ->> 'refused_why',
  'Divisions aren''t available yet — the whole league plays as one group.', 'B7 divisions');
select is(public.commish_setting_policy('playoff_byes') ->> 'refused_why',
  'Playoff byes come from the number of playoff teams — change that instead.', 'B8 playoff_byes');
select is(public.commish_setting_policy('schedule_seed') ->> 'refused_why',
  'This is set automatically when the schedule is made or reshuffled.', 'B9 schedule_seed');
select is(public.commish_setting_policy('waiver_period_hours') ->> 'refused_why',
  'This setting has been replaced: pick the days and time waivers run, and when free agency opens, instead. A dropped player stays on waivers until the next waiver run.',
  'B10 the retired waiver timing keys');
select is(public.commish_setting_policy('bench_lock') ->> 'refused_why',
  'This setting has been retired: a waiver claim always fails if the player you''d drop has already played this week, just like a regular drop.',
  'B11 bench_lock');
select is(public.commish_setting_policy('draft') ->> 'refused_why',
  'The draft is over, so its settings can''t change now.', 'B12 draft');
select is(
  (select count(*)::int from unnest(array[
     'waiver_type', 'faab_budget', 'trade_review', 'trade_deadline_week', 'roster_settings', 'faab_min_bid', 'faab_tiebreaker',
     'waiver_run_days', 'waiver_run_time', 'waiver_time_zone', 'free_agency_opens', 'free_agency_open_day', 'free_agency_open_time',
     'acquisitions_per_week', 'acquisitions_per_season', 'fa_hold_hours', 'trade_veto_votes', 'trade_review_period_hours',
     'allow_faab_in_trades', 'allow_future_considerations', 'trade_lock_behavior', 'allow_illegal_lineups', 'auto_sub_inactives',
     'stat_correction_window', 'tiebreakers', 'playoff_reseed', 'scoring_system_id', 'playoff_teams', 'playoff_weeks_per_round',
     'consolation_bracket', 'third_place_game', 'regular_season_weeks', 'playoff_start_week', 'team_count', 'schedule_mode',
     'median_game', 'second_opponent', 'format', 'lineup_lock', 'divisions', 'playoff_byes', 'schedule_seed', 'waiver_process_day',
     'waiver_process_time', 'waiver_period_hours', 'free_agency', 'bench_lock', 'draft']) k
   where public.commish_setting_policy(k) ->> 'refused_why' ~ '§|[A-Z][0-9]|[a-z]_[a-z]|[0-9]:[0-9]|\(|\)|[A-Z]{3,}'),
  0,
  'B13 no refused_why in the catalog carries a spec mark, a ledger code, a line reference, brackets, SHOUTING or a snake_case setting name');
select is(
  (select string_agg(k || '=' || md5(public.commish_setting_policy(k) ->> 'refused_why'), ' ' order by k)
   from unnest(array['playoff_start_week', 'median_game', 'second_opponent', 'playoff_weeks_per_round', 'consolation_bracket',
                     'third_place_game', 'waiver_process_day', 'waiver_process_time', 'free_agency']) k)
  = (select string_agg(k || '=' || md5(public.commish_setting_policy(p) ->> 'refused_why'), ' ' order by k)
     from (values ('playoff_start_week', 'regular_season_weeks'), ('median_game', 'schedule_mode'), ('second_opponent', 'schedule_mode'),
                  ('playoff_weeks_per_round', 'playoff_teams'), ('consolation_bracket', 'playoff_teams'), ('third_place_game', 'playoff_teams'),
                  ('waiver_process_day', 'waiver_period_hours'), ('waiver_process_time', 'waiver_period_hours'), ('free_agency', 'waiver_period_hours')) v(k, p)),
  true,
  'B14 partners share their sentence (the season window, the schedule shape, the bracket, the retired waiver timing keys)');

select * from finish();
rollback;
