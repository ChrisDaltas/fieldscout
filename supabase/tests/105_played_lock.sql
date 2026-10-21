-- ============================================================================
-- A rostered player's game-day lock is judged by whether HE has played this
-- week — pgTAP 105 (task L.D2.16; migration 157; PROGRESS F447 — R1216's live
-- probe, R1234; D411 / D412 / D413 / D416; spec §11.2, §13.1, §13.2, §13.3).
--
-- Numbering: reserved and measured (157 / 105). OWN FIXTURE: users 9157…,
-- leagues b157…, teams c157…, action ids a157…, claims d157…, players pl-*,
-- NFL teams P*. Every instant is passed explicitly (the TimeProvider rule);
-- internals are called as postgres with the actor's JWT claims set.
--
-- THE SHAPE (R1216): a player plays Thursday; afterwards the NFL trades him
-- to a team that plays Sunday (`players.team` = 'PB') or releases him (NULL
-- — read as a bye). At Sunday 12:00 ET (10-18 16:00Z) every reader before
-- 157 judged him from his CURRENT team: unlocked.
--
-- BREAK PROBES (the PR body; measured), each injected right after
-- pg_temp.un157 inside this transaction (the ROLLBACK ends it); accepted
-- paths run through pg_temp.try so a probe reds cells instead of aborting
-- the run. A one-site break is one body put back to its pre-157 text with
-- pg_temp.un157, or one helper arm switched off:
--   (1) roster_add_drop_internal ⇒ A5 A7 C1 C2 C3 C4 C5 C7 C8 C9 T1 T2 T3
--       G2 red (R1216 re-appears: the drops and adds are accepted, and the
--       downstream cells see the moved players);
--   (2) set_lineup_internal ⇒ A5 A8 C6 C7 C8 C9 T1 red (the played bench
--       man starts; A One / D One benched);
--   (3) lineup_lock_tick ⇒ A5 T1 T2 red (records re-read to NULL / to the
--       Sunday kickoff; the played free agents shown free);
--   (4) lineup_autopilot_internal ⇒ A5 A8 E1 E2 red;
--   (5) trade_lock_internal ⇒ A5 A7 F1 F2 F3 red (the trade completes at
--       Sunday 12:00 and G One's played start leaves the live week);
--   (6) waiver_claim_submit_internal ⇒ A5 A7 D1 D2 red;
--       process_waivers_internal ⇒ A5 A7 D2 D3 red;
--   (7) lineup_played_internal's RECORD arm off ⇒ B3 B7 C1 C3 C7 C8 T1 red;
--       its STAT-LINE arm off ⇒ B3 B4 B5 C4 C5 C6 T2 T3 E1 E2 D1 D2 D3 G2
--       red; lineup_record_kicked_off_internal's real-kickoff test off ⇒ B1
--       red here and pgTAP 064 D7b D7c D7d (E42 — a flexed kickoff's
--       record must move) red; its postponed-team test off ⇒ B2 red.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(39);

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

-- pg_temp.un205 — migration 205's inserted lines removed (each ends
-- `-- 205 / D593`; 205 changes no line of 199's text); an identity on every
-- other body (pgTAP 155 A5). RE-PINNED by D593: applied INNERMOST in the cells
-- that fingerprint roster_add_drop / waiver_claim_submit / process_waivers /
-- waiver_claim_notify, so they pin exactly what they pinned (additive, R992).
create function pg_temp.un205(p_src text) returns text language sql as $un205$
  select regexp_replace(p_src, E'\n[^\n]*   -- 205 / D593', '', 'g')
$un205$;
-- pg_temp.un199 — migration 199's hunks reversed for commish_edit_lineup_internal, commish_rename_team_internal, commish_roster_override_internal, process_waivers_internal, remove_manager, roster_add_drop_internal, set_lineup_internal, trade_execute_internal, trade_respond_internal, trade_tick, waiver_claim_submit_internal
-- (35 of 199's 81; generated by gen_un199.py from derive_199.py's pairs — each
-- replacement text occurs once across every live body, so this is an identity
-- on every other body). Applied INNERMOST.
create function pg_temp.un199(s text) returns text language plpgsql as $un199$
begin
  s := replace(s, $n199$  END IF;
  v_old_name := v_team.name;

  -- (7) THE COLLISION REPORT — measured, never a refusal. There is no UNIQUE$n199$,
                 $o199$  END IF;
  v_old_name := v_team.name;

  -- (6) THE ONE REFUSAL, AND IT IS THE SPEC'S OWN (`spec:183`, §7.2.1(b)):
  --     a retired franchise is SEALED and its "name/record frozen". A
  --     LEGALITY gate, not a timing one, so PROGRESS standing rule (i) binds
  --     the commissioner too — the sealed franchise IS the record History
  --     Mode shows under its last manager's name, and renaming it changes
  --     what the league's history says rather than fixing what went wrong.
  --     The message names F354 instead of a remedy nobody built (R1020's
  --     lesson from 127): NO verb un-retires a franchise today.
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION
      'commish_rename_team: franchise % is RETIRED — its name is FROZEN, because a sealed franchise is the record History Mode shows under its last manager (spec:183, §7.2.1(b)). This is a legality gate and it binds the commissioner too (PROGRESS standing rule (i)). NO VERB UN-RETIRES A FRANCHISE TODAY (F354), so there is no "un-retire first" to offer; rename the SUCCESSOR franchise (%) instead',
      p_team_id, COALESCE(v_team.successor_team_id::text, 'none recorded')
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) THE COLLISION REPORT — measured, never a refusal. There is no UNIQUE$o199$);
  s := replace(s, $n199$    -- is EXPLAINED rather than left to be guessed at (§4 rule 15).
    'bypassed',               '[]'::jsonb,
    'bypassed_why',           'nothing to bypass — a franchise name is not gated by the per-player kickoff lock (114:449-476), the week status, or the scoring snapshot',
    'propagation', jsonb_build_object(
      -- Item 4's finding, in the document as well as the banner.$n199$,
                 $o199$    -- is EXPLAINED rather than left to be guessed at (§4 rule 15).
    'bypassed',               '[]'::jsonb,
    'bypassed_why',           'nothing to bypass — a franchise name is not gated by the per-player kickoff lock (114:449-476), the week status, or the scoring snapshot; the only gate on it is the sealed-franchise refusal above, which is a LEGALITY gate and binds the commissioner too (standing rule (i))',
    'propagation', jsonb_build_object(
      -- Item 4's finding, in the document as well as the banner.$o199$);
  s := replace(s, $n199$  v_live        public.teams;
  v_claim       public.waiver_claims;$n199$,
                 $o199$  v_live        public.teams;
  v_depth       INTEGER;
  v_claim       public.waiver_claims;$o199$);
  s := replace(s, $n199$  -- The round-1 order as drafted (draft_order is the resolved order for
  -- every draft type — 098's draft_start writes it for an auction too).
  SELECT d.draft_order INTO v_draft_raw$n199$,
                 $o199$  -- The round-1 order as drafted (draft_order is the resolved order for
  -- every draft type — 098's draft_start writes it for an auction too),
  -- each franchise mapped to the live one its successor chain leads to.
  SELECT d.draft_order INTO v_draft_raw$o199$);
  s := replace(s, $n199$    SELECT t.* INTO v_live FROM public.teams t WHERE t.id = (v_x #>> '{}')::uuid;
    v_draft := v_draft || jsonb_build_array(COALESCE(v_live.id::text, v_x #>> '{}'));$n199$,
                 $o199$    SELECT t.* INTO v_live FROM public.teams t WHERE t.id = (v_x #>> '{}')::uuid;
    v_depth := 0;
    WHILE FOUND AND v_live.status = 'retired' AND v_live.successor_team_id IS NOT NULL AND v_depth < 64 LOOP
      SELECT t.* INTO v_live FROM public.teams t WHERE t.id = v_live.successor_team_id;
      v_depth := v_depth + 1;
    END LOOP;
    v_draft := v_draft || jsonb_build_array(COALESCE(v_live.id::text, v_x #>> '{}'));$o199$);
  s := replace(s, $n199$  v_removed_user UUID;
  v_team_name TEXT;
BEGIN
  v_uid := auth.uid();$n199$,
                 $o199$  v_removed_user UUID;
  v_team_name TEXT;
  -- 120 (L.D1.10): the retire arm.
  v_reason TEXT;
  v_replay RECORD;
  v_cycle RECORD;
  v_week INTEGER;
  v_franchises INTEGER;
  v_successor_id UUID;
  v_successor_name TEXT;
  v_n INTEGER;
  v_n_rosters INTEGER := 0;
  v_n_lineups INTEGER := 0;
  v_n_matchups INTEGER := 0;
  v_n_results INTEGER := 0;
  v_message TEXT;
  v_result JSONB;
BEGIN
  v_uid := auth.uid();$o199$);
  s := replace(s, $n199$  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('takeover', 'vacate') THEN
    RAISE EXCEPTION 'remove_manager: mode must be takeover or vacate (§7.2.1)'
      USING ERRCODE = '22023';$n199$,
                 $o199$  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('takeover', 'retire', 'vacate') THEN
    RAISE EXCEPTION 'remove_manager: mode must be takeover or vacate (§7.2.1)'
      USING ERRCODE = '22023';$o199$);
  s := replace(s, $n199$    RAISE EXCEPTION 'remove_manager: no such member in this league'
      USING ERRCODE = '42501';
  END IF;
$n199$,
                 $o199$    RAISE EXCEPTION 'remove_manager: no such member in this league'
      USING ERRCODE = '42501';
  END IF;

  -- 176 (L.E1.42 — Chris 2026-10-01): a team is NEVER retired. "you can't
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
$o199$);
  s := replace(s, $n199$
  -- 120 (R855): an UNMANAGED seat refuses takeover here as 063 wrote it and
  -- vacate stays idempotent.
  IF v_target.user_id IS NULL THEN
    IF p_mode = 'vacate' THEN
      -- Idempotent (D63): the seat is already an open placeholder.$n199$,
                 $o199$
  -- 120 (R855): an UNMANAGED seat refuses takeover here as 063 wrote it and
  -- vacate stays idempotent; RETIRE passes through — §7.2.1(c) is LAW
  -- ("Orphaned is a holding state that resolves into (a) or (b)") and the
  -- retire arm's (d′) decides, by the franchise's stint history, whether
  -- there is a manager to seal it under.
  IF v_target.user_id IS NULL AND p_mode <> 'retire' THEN
    IF p_mode = 'vacate' THEN
      -- Idempotent (D63): the seat is already an open placeholder.$o199$);
  s := replace(s, $n199$
  -- teams AFTER leagues (lock order).
  SELECT t.id, t.name, t.status INTO v_team
  FROM public.teams t
  WHERE t.id = v_target.team_id AND t.league_id = p_league_id$n199$,
                 $o199$
  -- teams AFTER leagues (lock order).
  SELECT t.id, t.name, t.status, t.successor_team_id INTO v_team
  FROM public.teams t
  WHERE t.id = v_target.team_id AND t.league_id = p_league_id$o199$);
  s := replace(s, $n199$    WHERE id = v_target.id;

    -- 'orphaned': the team lives on with no manager.
    -- owner_id moves to the acting commissioner (NOT NULL; leaving it on the
    -- removed user would let their profile deletion CASCADE the franchise).$n199$,
                 $o199$    WHERE id = v_target.id;

    -- 'orphaned', never 'retired': every capacity count is
    -- `status <> 'retired'`, so retiring would silently free a seat.
    -- owner_id moves to the acting commissioner (NOT NULL; leaving it on the
    -- removed user would let their profile deletion CASCADE the franchise).$o199$);
  s := replace(s, $n199$
  -- 169/L.E1.30 (F32) — THE RECEIPT, one per removal, the outcome NAMED
  -- (§7.2.1: takeover / vacate). before / after are the seat as it stood
  -- and as it stands now (read back, never inferred).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'remove_manager',
    CASE p_mode WHEN 'takeover' THEN 'replace_manager'
                ELSE 'vacate_seat' END,
    'team', v_team.id::text, p_reason,$n199$,
                 $o199$
  -- 169/L.E1.30 (F32) — THE RECEIPT, one per removal, the outcome NAMED
  -- (§7.2.1: takeover / retire / vacate). before / after are the seat as
  -- it stood and as it stands now (read back, never inferred).
  PERFORM public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'remove_manager',
    CASE p_mode WHEN 'takeover' THEN 'replace_manager'
                WHEN 'retire'   THEN 'retire_franchise'
                ELSE 'vacate_seat' END,
    'team', v_team.id::text, p_reason,$o199$);
  s := replace(s, $n199$    jsonb_build_object(
      'manager_user_id', (SELECT lm.user_id FROM public.league_members lm WHERE lm.id = v_target.id),
      'team_status',     (SELECT t.status FROM public.teams t WHERE t.id = v_team.id)),
    jsonb_build_object('mode', p_mode, 'member_id', v_target.id, 'team_name', v_team_name,
                       'affected_team_ids', jsonb_build_array(v_team.id)));

  -- §7.2.1:190 — the removed user is notified with the outcome category.
  -- Takeover and vacate always carry a user here (refused above otherwise).
  IF v_removed_user IS NOT NULL THEN
  PERFORM public.notify_league_member_internal($n199$,
                 $o199$    jsonb_build_object(
      'manager_user_id', (SELECT lm.user_id FROM public.league_members lm WHERE lm.id = v_target.id),
      'team_status',     (SELECT t.status FROM public.teams t WHERE t.id = v_team.id))
    || CASE WHEN p_mode = 'retire' THEN jsonb_build_object(
         'successor_team_id', v_successor_id, 'successor_team_name', v_successor_name,
         'retired_at_week', v_week) ELSE '{}'::jsonb END,
    jsonb_build_object('mode', p_mode, 'member_id', v_target.id, 'team_name', v_team_name,
                       'affected_team_ids', CASE WHEN p_mode = 'retire'
                                                 THEN jsonb_build_array(v_team.id, v_successor_id)
                                                 ELSE jsonb_build_array(v_team.id) END)
    || CASE WHEN p_mode = 'retire' THEN jsonb_build_object(
         'action_id', p_action_id, 'repointed', v_result -> 'repointed') ELSE '{}'::jsonb END);

  -- §7.2.1:190 — the removed user is notified with the outcome category.
  -- 120 (R855): an unmanaged seat's retirement has no one to notify (its
  -- last manager was notified when the seat closed — vacate / leave);
  -- takeover and vacate always carry a user here (refused above otherwise).
  IF v_removed_user IS NOT NULL THEN
  PERFORM public.notify_league_member_internal($o199$);
  s := replace(s, $n199$    CASE WHEN p_mode = 'takeover'
      THEN v_team_name || ' has a new manager. Your record with the franchise stays in its history.'
      ELSE 'Your seat in ' || v_league.name || ' (' || v_team_name || ') was closed by the commissioner.'
    END,$n199$,
                 $o199$    CASE WHEN p_mode = 'takeover'
      THEN v_team_name || ' has a new manager. Your record with the franchise stays in its history.'
      WHEN p_mode = 'retire'
      THEN v_team_name || ' was retired by the commissioner. The franchise is sealed under your name — its record and history stay yours.'
      ELSE 'Your seat in ' || v_league.name || ' (' || v_team_name || ') was closed by the commissioner.'
    END,$o199$);
  s := replace(s, $n199$      'league_id', p_league_id,
      'team_id', v_team.id,
      'event', CASE WHEN p_mode = 'takeover' THEN 'replaced' ELSE 'removed' END));
  END IF;
$n199$,
                 $o199$      'league_id', p_league_id,
      'team_id', v_team.id,
      'event', CASE WHEN p_mode = 'takeover' THEN 'replaced' WHEN p_mode = 'retire' THEN 'retired' ELSE 'removed' END));
  END IF;

  IF p_mode = 'retire' THEN
    RETURN v_result;
  END IF;
$o199$);
  s := replace(s, $n199$      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'commish_edit_lineup: league % has no season schedule yet, so there is no week to set a lineup in',
      p_league_id
      USING ERRCODE = 'P0001';$n199$,
                 $o199$      USING ERRCODE = 'P0001';
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
      USING ERRCODE = 'P0001';$o199$);
  s := replace(s, $n199$  IF NOT FOUND THEN
    RAISE EXCEPTION
      'commish_edit_lineup: week % is not on league %''s schedule for season % (it runs weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),$n199$,
                 $o199$  IF NOT FOUND THEN
    RAISE EXCEPTION
      'commish_edit_lineup: week % is not on league %''s calendar (season %; league_weeks holds weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),$o199$);
  s := replace(s, $n199$         AND NOT (v_gone_kick ? v_pid AND (v_stored ->> v_key) IS NOT DISTINCT FROM v_pid) THEN   -- 154 / F441: a kept start where it stands is the week's record, not a submit (166 / F503: null-safe too — an empty key must not exempt a moved kept start)
        RAISE EXCEPTION
          'commish_edit_lineup: % is % for week % and this league doesn''t allow illegal lineups — slot "%" can''t be saved like this; bench him, start someone who plays, or turn on illegal lineups in the league settings',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key$n199$,
                 $o199$         AND NOT (v_gone_kick ? v_pid AND (v_stored ->> v_key) IS NOT DISTINCT FROM v_pid) THEN   -- 154 / F441: a kept start where it stands is the week's record, not a submit (166 / F503: null-safe too — an empty key must not exempt a moved kept start)
        RAISE EXCEPTION
          'commish_edit_lineup: % is % for week % and allow_illegal_lineups is off — slot "%" is blocked at submit (§7.3.6); bench him, start someone who plays, or turn the setting on',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key$o199$);
  s := replace(s, $n199$    END IF;
  END IF;
  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      '%: league % has no season schedule yet, so there is no week to place the move in', p_verb, p_league_id
      USING ERRCODE = 'P0001';
  END IF;$n199$,
                 $o199$    END IF;
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
  END IF;$o199$);
  s := replace(s, $n199$    -- whole scoring arm below fall through both its IFs and report nothing.
    RAISE EXCEPTION
      '%: league % has no schedule row for season % week % — the schedule changed while this move was being made; try again', p_verb, p_league_id, v_league.season, v_current
      USING ERRCODE = 'P0001';
  END IF;$n199$,
                 $o199$    -- whole scoring arm below fall through both its IFs and report nothing.
    RAISE EXCEPTION
      '%: league % has no league_weeks row for season % week % — the calendar moved under this transaction (§12.17)', p_verb, p_league_id, v_league.season, v_current
      USING ERRCODE = 'P0001';
  END IF;$o199$);
  s := replace(s, $n199$    IF NOT FOUND THEN
      RAISE EXCEPTION
        '%: % isn''t on any roster in this league — a move needs a team to move him from; to bring in a free agent, add him to a roster instead',
        p_verb, v_lose_p.full_name
        USING ERRCODE = 'P0001';
    END IF;$n199$,
                 $o199$    IF NOT FOUND THEN
      RAISE EXCEPTION
        '%: % (%) is on no roster in league % — a move needs a source roster; to bring a free agent in, use commish_force_add_drop (§15.4:1695)',
        p_verb, v_lose_p.full_name, p_player_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;$o199$);
  s := replace(s, $n199$          SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_lose_row.team_id;
          RAISE EXCEPTION
            '%: % is on %''s roster, not %''s — pick the team he is actually on, or move him from there',
            p_verb, v_lose_p.full_name, v_owner_team.name, v_team_a.name
            USING ERRCODE = 'P0001';
        END IF;$n199$,
                 $o199$          SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_lose_row.team_id;
          RAISE EXCEPTION
            '%: % (%) is on %''s roster, not %''s — name the roster he is actually on, or move him with commish_move_player (§15.4:1694)',
            p_verb, v_lose_p.full_name, p_drop, v_owner_team.name, v_team_a.name
            USING ERRCODE = 'P0001';
        END IF;$o199$);
  s := replace(s, $n199$      IF FOUND AND v_owner_team.id <> p_team_id THEN
        RAISE EXCEPTION
          '%: % is already on %''s roster — a player can be on only one team in a league, and that applies to the commissioner too. To take him off % and put him on %, move him instead',
          p_verb, v_gain_p.full_name, v_owner_team.name, v_owner_team.name, v_team_a.name
          USING ERRCODE = 'P0001';
      END IF;$n199$,
                 $o199$      IF FOUND AND v_owner_team.id <> p_team_id THEN
        RAISE EXCEPTION
          '%: % (%) is already on %''s roster in this league — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7), and that binds a commissioner too: it is the shape of the game, not its timing (PROGRESS standing rule (i)). To take him off % and put him on %, use commish_move_player (§15.4:1694)',
          p_verb, v_gain_p.full_name, p_add, v_owner_team.name, v_owner_team.name, v_team_a.name
          USING ERRCODE = 'P0001';
      END IF;$o199$);
  s := replace(s, $n199$      IF v_exp_b > v_roster_size THEN
        RAISE EXCEPTION
          '%: %''s roster is full (% of %) — drop a player from it first. A roster can''t go over the league''s roster size, and that applies to the commissioner too',
          p_verb, v_team_b.name, v_count_b, v_roster_size
          USING ERRCODE = 'P0001';$n199$,
                 $o199$      IF v_exp_b > v_roster_size THEN
        RAISE EXCEPTION
          '%: %''s roster is full (% of % — §7.3.2 roster_size) — free a spot with commish_force_add_drop first. A roster over its own league''s size is a shape the rules do not have, so this gate binds the commissioner too (PROGRESS standing rule (i))',
          p_verb, v_team_b.name, v_count_b, v_roster_size
          USING ERRCODE = 'P0001';$o199$);
  s := replace(s, $n199$    IF v_exp_a > v_roster_size THEN
      RAISE EXCEPTION
        '%: %''s roster is full (% of %) — include a drop in the same move. A roster can''t go over the league''s roster size, and that applies to the commissioner too',
        p_verb, v_team_a.name, v_count_a, v_roster_size
        USING ERRCODE = 'P0001';$n199$,
                 $o199$    IF v_exp_a > v_roster_size THEN
      RAISE EXCEPTION
        '%: %''s roster is full (% of % — §7.3.2 roster_size) — include a drop in the same move (§13.1). A roster over its own league''s size is a shape the rules do not have, so this gate binds the commissioner too (PROGRESS standing rule (i))',
        p_verb, v_team_a.name, v_count_a, v_roster_size
        USING ERRCODE = 'P0001';$o199$);
  s := replace(s, $n199$      USING ERRCODE = 'P0001';
  END IF;
  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'roster_add_drop: league % has no season schedule yet, so there is no week to check game-day locks and pickup limits against',
      p_league_id
      USING ERRCODE = 'P0001';$n199$,
                 $o199$      USING ERRCODE = 'P0001';
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
      USING ERRCODE = 'P0001';$o199$);
  s := replace(s, $n199$      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: league % has no season schedule yet, so there is no week to set a lineup in',
      p_league_id
      USING ERRCODE = 'P0001';$n199$,
                 $o199$      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'set_lineup: team % is retired — a sealed franchise has no lineup to set (§7.2.1)', p_team_id
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: league % has no league_weeks rows — no season calendar to set a lineup against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';$o199$);
  s := replace(s, $n199$  IF NOT FOUND THEN
    RAISE EXCEPTION
      'set_lineup: week % is not on league %''s schedule for season % (it runs weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),$n199$,
                 $o199$  IF NOT FOUND THEN
    RAISE EXCEPTION
      'set_lineup: week % is not on league %''s calendar (season %; league_weeks holds weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),$o199$);
  s := replace(s, $n199$        CASE WHEN v_league.deleted_at IS NOT NULL THEN 'deleted' WHEN v_league.status = 'complete' THEN 'over for the season' ELSE 'not in its season' END
        USING ERRCODE = 'P0001';$n199$,
                 $o199$        CASE WHEN v_league.deleted_at IS NOT NULL THEN 'deleted' WHEN v_league.status = 'complete' THEN 'over for the season' ELSE 'not in its season' END
        USING ERRCODE = 'P0001';
    END IF;
    IF v_proposer.status = 'retired' OR v_recipient.status = 'retired' THEN
      RAISE EXCEPTION 'trade_execute: % is retired and can''t make trades',
        CASE WHEN v_proposer.status = 'retired' THEN v_proposer.name ELSE v_recipient.name END
        USING ERRCODE = 'P0001';$o199$);
  s := replace(s, $n199$  IF p_op = 'accept' THEN
    -- RE-VALIDATE EVERYTHING under the lock, the receiving team's drops$n199$,
                 $o199$  IF p_op = 'accept' THEN
    IF v_proposer.status = 'retired' OR v_recipient.status = 'retired' THEN
      RAISE EXCEPTION 'trade_respond: % is retired — a sealed franchise makes no trades (§7.2.1)',
        CASE WHEN v_proposer.status = 'retired' THEN v_proposer.name ELSE v_recipient.name END
        USING ERRCODE = 'P0001';
    END IF;
    -- RE-VALIDATE EVERYTHING under the lock, the receiving team's drops$o199$);
  s := replace(s, $n199$    -- answered. Refused BY NAME before any write — D339's predicate, as
    -- trade_propose's; the offer itself can still be turned down.
    IF NOT EXISTS (SELECT 1 FROM public.league_members m
                       WHERE m.league_id = p_league_id AND m.team_id = v_proposer.id AND m.user_id IS NOT NULL) THEN$n199$,
                 $o199$    -- answered. Refused BY NAME before any write — D339's predicate, as
    -- trade_propose's; the offer itself can still be turned down. A retired
    -- proposer falls through to the core's own sentence.
    IF v_proposer.status <> 'retired'
       AND NOT EXISTS (SELECT 1 FROM public.league_members m
                       WHERE m.league_id = p_league_id AND m.team_id = v_proposer.id AND m.user_id IS NOT NULL) THEN$o199$);
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
  s := replace(s, $n199$      USING ERRCODE = 'P0001';
  END IF;

  v_waiver_type := COALESCE(v_league.waiver_type, 'faab');$n199$,
                 $o199$      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'waiver_claim_submit: % is retired — a sealed franchise makes no claims (§7.2.1)', v_team.name
      USING ERRCODE = 'P0001';
  END IF;

  v_waiver_type := COALESCE(v_league.waiver_type, 'faab');$o199$);
  s := replace(s, $n199$  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'waiver_claim_submit: league % has no season schedule yet, so there is no week to check the game-day lock against',
      p_league_id
      USING ERRCODE = 'P0001';$n199$,
                 $o199$  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'waiver_claim_submit: league % has no league_weeks rows — no season calendar to evaluate the game-day lock against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';$o199$);
  s := replace(s, $n199$    IF v_has_seat IS NULL OR v_balance IS NULL THEN
      RAISE EXCEPTION
        'waiver_claim_submit: % has no FAAB balance on record, so it can''t bid — ask the commissioner to set the team''s FAAB',
        v_team.name
        USING ERRCODE = 'P0001';
    END IF;$n199$,
                 $o199$    IF v_has_seat IS NULL OR v_balance IS NULL THEN
      RAISE EXCEPTION
        'waiver_claim_submit: % has no FAAB balance on record (its league_members seat %) — refusing to accept a bid against money that is not recorded (§12.2)',
        v_team.name, CASE WHEN v_has_seat IS NULL THEN 'is missing' ELSE 'holds NULL' END
        USING ERRCODE = 'P0001';
    END IF;$o199$);
  return s;
end
$un199$;

-- pg_temp.un181 — migration 181's one tick hunk removed (pgTAP 129 pins it);
-- an identity on every other body. Applied INNERMOST.
create function pg_temp.un181(p_src text) returns text language sql as $un181$
  select replace(p_src, $h$        -- 181 (D496): every ROSTERED player has a pool row before the view
        -- runs. A drafted player never passed through the pool (072's draft
        -- writes league_rosters only; pool rows are lazy, D294), so the view
        -- below never judged him and My Team showed him unlocked while
        -- set_lineup refused him. The row is the D294 mirror's own shape
        -- ('rostered'); an existing row of any state is left alone.
        INSERT INTO public.league_player_pool (league_id, player_id, state, updated_at)
        SELECT r.league_id, r.player_id, 'rostered', p_now
        FROM public.league_rosters r
        WHERE r.league_id = v_lg.id
        ON CONFLICT (league_id, player_id) DO NOTHING;

$h$, '')
$un181$;

-- RE-PINNED BY 180 (F569 part 2 / F573 — wording only): the golden md5s
-- below read the live bodies with 180's hunks reversed (pg_temp.un180);
-- pgTAP 128 pins 180's own.
-- pg_temp.un180 — migration 180's 26 wording hunks reversed (generated by
-- gen_un180.py from derive_180.py's pairs); an identity on every body
-- 180 did not touch. Applied INNERMOST.
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

-- L.E1.31 (migration 170 — additive, the R992 shape): pg_temp.un170 reverses
-- 170's ONE hunk in each of commish_edit_lineup_internal,
-- commish_roster_override_internal and commish_rename_team_internal (D451 —
-- acting_as_team_id on the override twins) and is an identity on every other
-- body (pgTAP 118 A5). Generated by derive_170.py from the same pairs the
-- migration was derived with; applied INNERMOST below.
create function pg_temp.un170(p_src text) returns text language sql as $un170$
  select replace(replace(replace(p_src,
    -- commish_edit_lineup_internal
    E'        \'score_stale_reason\',  v_stale_why),\n      -- 170/L.E1.31 (D451) — acting_as_team_id = THE TEAM. The commissioner\n      -- set this team\'s lineup: a manager\'s act done for the team (§10.3:711\n      -- "set when the commissioner acts on behalf of any team, most commonly\n      -- an orphaned one"). set_lineup\'s commissioner arm has written the same\n      -- action_type with it since 169; one action_type, one shape. His OWN\n      -- team is his own act, not one on its behalf: NULL (169\'s arm, R1334).\n      CASE WHEN EXISTS (SELECT 1 FROM public.league_members m\n                        WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id)\n           THEN NULL ELSE p_team_id END);\n    IF v_audit_id IS NULL THEN',
    E'        \'score_stale_reason\',  v_stale_why),\n      NULL);\n    IF v_audit_id IS NULL THEN'),
    -- commish_roster_override_internal
    E'        \'score_stale_reason\',  v_stale_why),\n      -- 170/L.E1.31 (D451) — acting_as_team_id = THE TEAM on the force\n      -- add / drop arm: the commissioner made this team\'s roster move, the\n      -- act roster_add_drop gives its manager (§10.3:711; TD16 — the manager\n      -- verb\'s commissioner door is this override, standing rule (h)). A MOVE\n      -- acts on two teams and for neither: NULL, both ride in\n      -- affected_team_ids (D353). His OWN team is his own act: NULL (R1334).\n      CASE WHEN v_is_move OR EXISTS (SELECT 1 FROM public.league_members m\n                                     WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id)\n           THEN NULL ELSE p_team_id END);\n    IF v_audit_id IS NULL THEN',
    E'        \'score_stale_reason\',  v_stale_why),\n      NULL);\n    IF v_audit_id IS NULL THEN'),
    -- commish_rename_team_internal
    E'        \'frozen_receipts_for_this_team\', v_frozen),\n      -- 170/L.E1.31 (D451) — acting_as_team_id = THE TEAM: the commissioner\n      -- renamed it, the act rename_own_team gives its manager (§10.3:711;\n      -- TD16 — the manager verb\'s commissioner door is this override). His\n      -- OWN team is his own act: NULL (R1334).\n      CASE WHEN EXISTS (SELECT 1 FROM public.league_members m\n                        WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id)\n           THEN NULL ELSE p_team_id END);\n    IF v_audit_id IS NULL THEN',
    E'        \'frozen_receipts_for_this_team\', v_frozen),\n      NULL);\n    IF v_audit_id IS NULL THEN')
$un170$;

-- L.E1.30 (migration 169 — additive, the R992 shape): pg_temp.un169 reverses
-- 169's ONE hunk in set_lineup_internal (F514 — the commissioner arm's
-- receipt) and is an identity on every other body (pgTAP 117 A3 / A5).
-- Generated by derive_169.py from the same pair the migration was derived
-- with; applied INNERMOST below.
create function pg_temp.un169(p_src text) returns text language sql as $un169$
  select replace(p_src,
    E'      INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)\n      VALUES (p_league_id, auth.uid(), v_message, \'league\', TRUE);\n      -- 169/L.E1.30 (F514) — THE RECEIPT: a commissioner setting a team he\n      -- does not manage is a commissioner action (D363(2)) — one row per\n      -- changed lineup, the team acted for in acting_as_team_id (§10.3). The\n      -- no-op re-save wrote nothing above; a manager\'s own save (the\n      -- commissioner\'s own team included) is not this arm.\n      PERFORM public.draft_commish_receipt_internal(\n        p_league_id, FALSE, \'set_lineup\', \'edit_lineup\', \'team\', p_team_id::text, v_reason,\n        jsonb_build_object(\'slot_map\', v_stored),\n        jsonb_build_object(\'slot_map\', v_canon)\n          || CASE WHEN jsonb_array_length(v_ir_placed) + jsonb_array_length(v_ir_removed) > 0\n                  THEN jsonb_build_object(\'ir_moves\', jsonb_build_object(\'placed\', v_ir_placed, \'removed\', v_ir_removed))\n                  ELSE \'{}\'::jsonb END,\n        jsonb_build_object(\'week\', p_week, \'current_week\', v_current, \'season\', v_league.season,\n                           \'week_status\', v_lw.status, \'team_name\', v_team.name, \'action_id\', p_action_id),\n        p_team_id);\n    END IF;\n',
    E'      INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)\n      VALUES (p_league_id, auth.uid(), v_message, \'league\', TRUE);\n    END IF;\n')
$un169$;

-- L.D2.20 (migration 166 — additive, the R992 shape): pg_temp.un166 reverses
-- 166's substitutions in the two bodies it replaced (commish_edit_lineup_
-- internal, lineup_player_kickoff_internal) and is an identity on every
-- other body (pgTAP 114 A3 / A5). Generated by derive_166.py from the same
-- pairs the migration was derived with; applied INNERMOST below.
create function pg_temp.un166(p_src text) returns text language sql as $un166$
  select replace(replace(replace(p_src,
    E'      -- §7.3.6 allow_illegal_lineups = FALSE. KEPT (see WHAT IS NOT LIFTED).\n      -- 166 / F500: R739\'s exemption, carried exactly as set_lineup_internal\n      -- step (10) has it (157): a STORED starter whose own game has kicked\n      -- off (his per-player datum, step (6)) and who stays at his stored key\n      -- is not blocked — his game is under way or over, so keeping him where\n      -- he stands is the week as it happened, not a submit. 123 dropped the\n      -- clause as meaningless for a verb with no lock; without it a starter\n      -- who played Thursday and was put on IR before Sunday refused every\n      -- commissioner fix to that week unless he benched him (changing the\n      -- score) — a save the manager may make: a TIMING refusal of the\n      -- commissioner (standing rule (g)). Putting a bye / OUT player at any\n      -- key he is not stored at (moving him, or starting one from the\n      -- bench) is still refused by name, as it is for the manager. The\n      -- stored-occupant test is spelled NULL-SAFE here: set_lineup\'s `=`\n      -- yields NULL for a key that was empty, which cannot reach its gate\n      -- (step (7b) refuses a kicked-off player entering a slot first) but\n      -- would reach this one (no lock) and let a moved OUT starter through.\n      -- The kept-start clause below (154 / F441) is spelled the same way\n      -- (F503): its `=` let a kept OFF-ROSTER starter, now OUT, be moved\n      -- into an empty key without the refusal.\n      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0\n         AND NOT ((v_kick -> v_pid ->> \'kickoff_at\') IS NOT NULL\n                  AND (v_kick -> v_pid ->> \'kickoff_at\')::timestamptz <= p_at\n                  AND (v_stored ->> v_key) IS NOT DISTINCT FROM v_pid)   -- 166 / F500: R739, as set_lineup (null-safe)\n         AND NOT (v_gone_kick ? v_pid AND (v_stored ->> v_key) IS NOT DISTINCT FROM v_pid) THEN   -- 154 / F441: a kept start where it stands is the week\'s record, not a submit (166 / F503: null-safe too — an empty key must not exempt a moved kept start)\n',
    E'      -- §7.3.6 allow_illegal_lineups = FALSE. KEPT (see WHAT IS NOT LIFTED).\n      -- 114\'s R739 clause is dropped from the predicate rather than carried:\n      -- it exempts "the stored player\'s own game has kicked off and he is the\n      -- stored occupant", i.e. "not the manager\'s to change" — and for a verb\n      -- with no lock there is no such thing, so carrying it would be a clause\n      -- that means nothing. The gate is therefore the plain one.\n      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0\n         AND NOT (v_gone_kick ? v_pid AND (v_stored ->> v_key) = v_pid) THEN   -- 154 / F441: a kept start where it stands is the week\'s record, not a submit\n'),
    E'  v_k    RECORD;\n  v_p    RECORD;\n  v_stat TIMESTAMPTZ;   -- 166 / F501\nBEGIN\n',
    E'  v_k    RECORD;\n  v_p    RECORD;\nBEGIN\n'),
    E'      RETURN NEXT;\n      RETURN;\n    END IF;\n  ELSE\n    -- 166 / F501: his current team\'s kickoff HAS passed. When he PLAYED\n    -- earlier this week in another game — the NFL traded him after it to a\n    -- team that has also kicked off since — the datum is the game he played\n    -- in, never his new team\'s later one: an earlier start this league\n    -- recorded for a real, passed kickoff of the week (lineup_played_\n    -- internal (ii), guarded by lineup_record_kicked_off_internal), else his\n    -- stat line\'s game (a real, passed kickoff of the week, not postponed).\n    -- Both instants have passed, so every lock reads the same; only the\n    -- record (and locked_at, and the instant a refusal names) stays on the\n    -- game he played. A stat line that names no game carries no instant he\n    -- played at (157\'s fallback there is the week\'s first kickoff) and\n    -- never displaces his team\'s kickoff.\n    SELECT * INTO v_p FROM public.lineup_played_internal(p_league_id, p_season, p_week, p_player_id, p_at);\n    IF v_p.played AND v_p.datum_arm = \'lineup_record\' AND v_p.kickoff_at < v_k.kickoff_at THEN\n      kickoff_at := v_p.kickoff_at; datum_arm := v_p.datum_arm; on_bye := FALSE;\n      RETURN NEXT;\n      RETURN;\n    END IF;\n    SELECT min(g.kickoff_at) INTO v_stat\n    FROM public.player_stats ps\n    JOIN public.nfl_games g ON g.id = ps.game_id\n    WHERE ps.player_id = p_player_id AND ps.season = p_season AND ps.week = p_week\n      AND g.season = p_season AND g.week = p_week\n      AND g.status IS DISTINCT FROM \'postponed\'\n      AND g.kickoff_at <= p_at;\n    IF v_stat < v_k.kickoff_at THEN\n      kickoff_at := v_stat; datum_arm := \'stat_line\'; on_bye := FALSE;\n      RETURN NEXT;\n      RETURN;\n    END IF;\n  END IF;\n  kickoff_at := v_k.kickoff_at; datum_arm := v_k.datum_arm; on_bye := v_k.on_bye;\n',
    E'      RETURN NEXT;\n      RETURN;\n    END IF;\n  END IF;\n  kickoff_at := v_k.kickoff_at; datum_arm := v_k.datum_arm; on_bye := v_k.on_bye;\n')
$un166$;

-- L.D2.19 (migration 165 — additive, the R992 shape): pg_temp.un165 reverses
-- 165 substitutions in the two bodies it replaced (commish_edit_lineup_
-- internal, lineup_carry_internal) and is an identity on every other body
-- (pgTAP 113 A3 / A6). Generated by derive_165.py from the same pairs the
-- migration was derived with; applied INNERMOST below.
create function pg_temp.un165(p_src text) returns text language sql as $un165$
  select replace(replace(replace(replace(replace(replace(replace(p_src,
    E'  v_p           JSONB;\n  v_seen        JSONB := \'{}\'::jsonb;\n  v_by_pid      JSONB := \'{}\'::jsonb;   -- player_id → roster element\n  v_kick        JSONB := \'{}\'::jsonb;   -- player_id → {kickoff_at, datum_arm, on_bye} for p_week (165 / F497: per PLAYER — 157\'s lineup_player_kickoff_internal; 164\'s receipt map folded in)\n  v_kick_cur    JSONB := \'{}\'::jsonb;   -- the same for the CURRENT week (IR moves)\n  v_window      RECORD;\n  v_window_cur  RECORD;\n  v_k           RECORD;\n',
    E'  v_p           JSONB;\n  v_seen        JSONB := \'{}\'::jsonb;\n  v_by_pid      JSONB := \'{}\'::jsonb;   -- player_id → roster element\n  v_kick        JSONB := \'{}\'::jsonb;   -- player_id → {kickoff_at, datum_arm, on_bye} for p_week\n  v_kick_cur    JSONB := \'{}\'::jsonb;   -- the same for the CURRENT week (IR moves)\n  v_lock_kick   JSONB := \'{}\'::jsonb;   -- 164 / F467: the RECEIPT\'s datum for p_week, per PLAYER (157\'s lineup_player_kickoff_internal)\n  v_lock_kick_cur JSONB := \'{}\'::jsonb; -- 164 / F467: the same for the CURRENT week (the IR timing receipt)\n  v_window      RECORD;\n  v_window_cur  RECORD;\n  v_k           RECORD;\n'),
    E'  --     114:424-442. Still needed in full even though the lock is lifted:\n  --     v_kick feeds locked_at, starters[].kickoff_at and the bye flag.\n  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, p_week, p_at);\n  -- 165 / F497: each player\'s kickoff is judged per PLAYER, exactly as\n  -- set_lineup has recorded it since 157 (lineup_player_kickoff_internal —\n  -- his current NFL team\'s game, or, when that is still ahead or he has no\n  -- team, the kickoff he PLAYED in this week: a start this league recorded\n  -- for a real, passed kickoff, or his stat line). A player the NFL released\n  -- or traded after he played keeps his kickoff record, his place in\n  -- locked_at and no bye flag through a commissioner edit (164 read his\n  -- current team here: NULL + "bye" for a release, the new team\'s later\n  -- game for a trade). The receipt reads the same map (164\'s parallel\n  -- v_lock_kick / v_lock_kick_cur, folded in). Nothing here refuses.\n  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP\n    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, p_week, v_e ->> \'player_id\', p_at);   -- 165 / F497\n    v_kick := v_kick || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n      \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n    IF v_current <> p_week THEN\n      SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, v_current, v_e ->> \'player_id\', p_at);   -- 165 / F497\n      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n        \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n    END IF;\n  END LOOP;\n  v_kick := v_kick || v_gone_kick;   -- 154 / F441: (4b)\'s kept, since-unrostered starters\n  IF v_current = p_week THEN\n    v_kick_cur := v_kick;\n    v_window_cur := v_window;\n  ELSE\n    SELECT * INTO v_window_cur FROM public.schedule_window_internal(v_league.season, v_current, p_at);\n',
    E'  --     114:424-442. Still needed in full even though the lock is lifted:\n  --     v_kick feeds locked_at, starters[].kickoff_at and the bye flag.\n  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, p_week, p_at);\n  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP\n    SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, p_week, v_e ->> \'nfl_team\', p_at);\n    v_kick := v_kick || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n      \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n    -- 164 / F467: what the RECEIPT says is judged per PLAYER — his current\n    -- NFL team\'s kickoff, or the kickoff he PLAYED in this week (157) — so\n    -- a player the NFL released or traded after he played is named as\n    -- moved past the lock. Receipt only: v_kick (the stored record,\n    -- locked_at, the bye flags) is unchanged, and nothing here refuses.\n    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, p_week, v_e ->> \'player_id\', p_at);\n    v_lock_kick := v_lock_kick || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n      \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n    IF v_current <> p_week THEN\n      SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_current, v_e ->> \'nfl_team\', p_at);\n      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n        \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n      SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, v_current, v_e ->> \'player_id\', p_at);   -- 164 / F467\n      v_lock_kick_cur := v_lock_kick_cur || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n        \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n    END IF;\n  END LOOP;\n  v_kick := v_kick || v_gone_kick;   -- 154 / F441: (4b)\'s kept, since-unrostered starters\n  v_lock_kick := v_lock_kick || v_gone_kick;   -- 164 / F467: (4b)\'s kept starters, as v_kick\n  IF v_current = p_week THEN\n    v_kick_cur := v_kick;\n    v_lock_kick_cur := v_lock_kick;   -- 164 / F467\n    v_window_cur := v_window;\n  ELSE\n    SELECT * INTO v_window_cur FROM public.schedule_window_internal(v_league.season, v_current, p_at);\n'),
    E'  --     moved whose game had already kicked off is named, and rides into the\n  --     audit row\'s metadata so the league can see exactly what the override\n  --     did that a manager could not have.\n  --     164 / F467: judged per PLAYER — the lock a manager faces since 157 —\n  --     so the record names every player a manager could not have moved\n  --     (165 / F497: that datum is v_kick itself now; 164\'s parallel map\n  --     is folded into it).\n  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP\n    v_pid := v_val #>> \'{}\';\n    CONTINUE WHEN NOT (v_by_pid ? v_pid);\n    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> \'key\' = v_key);\n    IF (((v_kick -> v_pid ->> \'kickoff_at\') IS NOT NULL\n         AND (v_kick -> v_pid ->> \'kickoff_at\')::timestamptz <= p_at)\n        OR v_gone_kick ? v_pid)   -- 154 / F441: a kept off-roster starter moved or removed is recorded too\n       AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid THEN\n      v_moved_lock := v_moved_lock || jsonb_build_object(\n        \'player_id\', v_pid, \'name\', v_by_pid -> v_pid ->> \'name\',\n        \'from\', v_key, \'to\', v_seen ->> v_pid,\n        \'kickoff_at\', v_kick -> v_pid ->> \'kickoff_at\',\n        \'datum_arm\', v_kick -> v_pid ->> \'datum_arm\');\n    END IF;\n  END LOOP;\n  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP\n    v_pid := v_val #>> \'{}\';\n    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> \'key\' = v_key);\n    IF (v_kick -> v_pid ->> \'kickoff_at\') IS NOT NULL\n       AND (v_kick -> v_pid ->> \'kickoff_at\')::timestamptz <= p_at\n       AND (v_stored ->> v_key) IS DISTINCT FROM v_pid\n       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_moved_lock) m WHERE m ->> \'player_id\' = v_pid) THEN\n      v_moved_lock := v_moved_lock || jsonb_build_object(\n',
    E'  --     moved whose game had already kicked off is named, and rides into the\n  --     audit row\'s metadata so the league can see exactly what the override\n  --     did that a manager could not have.\n  --     164 / F467: judged by v_lock_kick — per PLAYER, the lock a manager\n  --     faces since 157 — so the record names every player a manager\n  --     could not have moved.\n  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP\n    v_pid := v_val #>> \'{}\';\n    CONTINUE WHEN NOT (v_by_pid ? v_pid);\n    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> \'key\' = v_key);\n    IF (((v_lock_kick -> v_pid ->> \'kickoff_at\') IS NOT NULL\n         AND (v_lock_kick -> v_pid ->> \'kickoff_at\')::timestamptz <= p_at)\n        OR v_gone_kick ? v_pid)   -- 154 / F441: a kept off-roster starter moved or removed is recorded too\n       AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid THEN\n      v_moved_lock := v_moved_lock || jsonb_build_object(\n        \'player_id\', v_pid, \'name\', v_by_pid -> v_pid ->> \'name\',\n        \'from\', v_key, \'to\', v_seen ->> v_pid,\n        \'kickoff_at\', v_lock_kick -> v_pid ->> \'kickoff_at\',\n        \'datum_arm\', v_lock_kick -> v_pid ->> \'datum_arm\');\n    END IF;\n  END LOOP;\n  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP\n    v_pid := v_val #>> \'{}\';\n    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> \'key\' = v_key);\n    IF (v_lock_kick -> v_pid ->> \'kickoff_at\') IS NOT NULL\n       AND (v_lock_kick -> v_pid ->> \'kickoff_at\')::timestamptz <= p_at\n       AND (v_stored ->> v_key) IS DISTINCT FROM v_pid\n       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_moved_lock) m WHERE m ->> \'player_id\' = v_pid) THEN\n      v_moved_lock := v_moved_lock || jsonb_build_object(\n'),
    E'        -- misled, in the permanent record of what the override did.)\n        \'from\', (SELECT e.key FROM jsonb_each(v_stored) e WHERE e.value #>> \'{}\' = v_pid LIMIT 1),\n        \'to\', v_key,\n        \'kickoff_at\', v_kick -> v_pid ->> \'kickoff_at\',\n        \'datum_arm\', v_kick -> v_pid ->> \'datum_arm\');\n    END IF;\n  END LOOP;\n  IF jsonb_array_length(v_moved_lock) > 0 THEN\n',
    E'        -- misled, in the permanent record of what the override did.)\n        \'from\', (SELECT e.key FROM jsonb_each(v_stored) e WHERE e.value #>> \'{}\' = v_pid LIMIT 1),\n        \'to\', v_key,\n        \'kickoff_at\', v_lock_kick -> v_pid ->> \'kickoff_at\',\n        \'datum_arm\', v_lock_kick -> v_pid ->> \'datum_arm\');\n    END IF;\n  END LOOP;\n  IF jsonb_array_length(v_moved_lock) > 0 THEN\n'),
    E'          (SELECT string_agg(x #>> \'{}\', \', \') FROM jsonb_array_elements(v_spot -> \'designations\') x)\n          USING ERRCODE = \'P0001\';\n      END IF;\n      IF (v_kick_cur -> v_pid ->> \'kickoff_at\') IS NOT NULL\n         AND (v_kick_cur -> v_pid ->> \'kickoff_at\')::timestamptz <= p_at THEN\n        v_bypassed := v_bypassed || to_jsonb((\'ir_lock_timing:\' || v_pid)::text);\n      END IF;\n      v_ir_placed := v_ir_placed || jsonb_build_object(\n',
    E'          (SELECT string_agg(x #>> \'{}\', \', \') FROM jsonb_array_elements(v_spot -> \'designations\') x)\n          USING ERRCODE = \'P0001\';\n      END IF;\n      IF (v_lock_kick_cur -> v_pid ->> \'kickoff_at\') IS NOT NULL\n         AND (v_lock_kick_cur -> v_pid ->> \'kickoff_at\')::timestamptz <= p_at THEN\n        v_bypassed := v_bypassed || to_jsonb((\'ir_lock_timing:\' || v_pid)::text);\n      END IF;\n      v_ir_placed := v_ir_placed || jsonb_build_object(\n'),
    E'    IF (v_e ->> \'ir_lock_until_week\') IS NOT NULL AND v_current < (v_e ->> \'ir_lock_until_week\')::int THEN\n      v_bypassed := v_bypassed || to_jsonb((\'ir_restricted_stint:\' || v_pid)::text);\n    END IF;\n    IF (v_kick_cur -> v_pid ->> \'kickoff_at\') IS NOT NULL\n       AND (v_kick_cur -> v_pid ->> \'kickoff_at\')::timestamptz <= p_at THEN\n      v_bypassed := v_bypassed || to_jsonb((\'ir_lock_timing:\' || v_pid)::text);\n    END IF;\n    v_ir_removed := v_ir_removed || jsonb_build_object(\'player_id\', v_pid, \'spot\', v_e ->> \'slot_key\');\n',
    E'    IF (v_e ->> \'ir_lock_until_week\') IS NOT NULL AND v_current < (v_e ->> \'ir_lock_until_week\')::int THEN\n      v_bypassed := v_bypassed || to_jsonb((\'ir_restricted_stint:\' || v_pid)::text);\n    END IF;\n    IF (v_lock_kick_cur -> v_pid ->> \'kickoff_at\') IS NOT NULL\n       AND (v_lock_kick_cur -> v_pid ->> \'kickoff_at\')::timestamptz <= p_at THEN\n      v_bypassed := v_bypassed || to_jsonb((\'ir_lock_timing:\' || v_pid)::text);\n    END IF;\n    v_ir_removed := v_ir_removed || jsonb_build_object(\'player_id\', v_pid, \'spot\', v_e ->> \'slot_key\');\n'),
    E'\n  -- Per-starter kickoff at the injected instant (112\'s datum, E42/§23.3).\n  FOREACH v_pid IN ARRAY v_started LOOP\n    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, p_season, p_week, v_pid, p_at);   -- 165 / F497: per PLAYER (157), as set_lineup records it — a player who played and was since released / traded keeps his kickoff (D354: a carry can run after a kickoff)\n    v_kick := v_kick || jsonb_build_object(v_pid, jsonb_build_object(\n      \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n  END LOOP;\n',
    E'\n  -- Per-starter kickoff at the injected instant (112\'s datum, E42/§23.3).\n  FOREACH v_pid IN ARRAY v_started LOOP\n    SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_by_pid -> v_pid ->> \'nfl_team\', p_at);\n    v_kick := v_kick || jsonb_build_object(v_pid, jsonb_build_object(\n      \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n  END LOOP;\n')
$un165$;

-- L.D3.14 (migration 164 — additive, the R992 shape): pg_temp.un164 reverses
-- 164's substitutions in the three bodies it replaced (an identity on every
-- other body), applied INNERMOST so A6 still prove what they proved;
-- pgTAP 112 A3 / A4 pin 164's own.
create function pg_temp.un164(p_src text) returns text language sql as $un164$
  select replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(p_src,
    E'  ELSIF public.lineup_record_kicked_off_internal(p_season, p_week, p_player_id, v_rec_at, p_at) THEN   -- 164 / F468(b): a REAL, passed kickoff of the week and his team\'s game not postponed (157\'s guard — the locks\' own judgment)\n',
    E'  ELSIF v_rec_at IS NOT NULL AND v_rec_at <= p_at THEN\n'),
    E'      v_lose_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, v_lose_player, p_at);   -- 164 / F467: the receipt judges the lock per player (played this week), as 157\'s writers do\n',
    E'      v_lose_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_lose_p.team, p_at);\n'),
    E'      v_gain_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, v_gain_player, p_at);   -- 164 / F467: the receipt judges the lock per player (played this week), as 157\'s writers do\n',
    E'      v_gain_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_gain_p.team, p_at);\n'),
    E'  v_lock_kick   JSONB := \'{}\'::jsonb;   -- 164 / F467: the RECEIPT\'s datum for p_week, per PLAYER (157\'s lineup_player_kickoff_internal)\n  v_lock_kick_cur JSONB := \'{}\'::jsonb; -- 164 / F467: the same for the CURRENT week (the IR timing receipt)\n',
    E''),
    E'    -- 164 / F467: what the RECEIPT says is judged per PLAYER — his current\n    -- NFL team\'s kickoff, or the kickoff he PLAYED in this week (157) — so\n    -- a player the NFL released or traded after he played is named as\n    -- moved past the lock. Receipt only: v_kick (the stored record,\n    -- locked_at, the bye flags) is unchanged, and nothing here refuses.\n    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, p_week, v_e ->> \'player_id\', p_at);\n    v_lock_kick := v_lock_kick || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n      \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n',
    E''),
    E'      SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, v_current, v_e ->> \'player_id\', p_at);   -- 164 / F467\n      v_lock_kick_cur := v_lock_kick_cur || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n        \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n',
    E''),
    E'  v_lock_kick := v_lock_kick || v_gone_kick;   -- 164 / F467: (4b)\'s kept starters, as v_kick\n',
    E''),
    E'    v_lock_kick_cur := v_lock_kick;   -- 164 / F467\n',
    E''),
    E'  --     164 / F467: judged by v_lock_kick — per PLAYER, the lock a manager\n  --     faces since 157 — so the record names every player a manager\n  --     could not have moved.\n',
    E''),
    E'v_lock_kick_cur -> v_pid',
    E'v_kick_cur -> v_pid'),
    E'v_lock_kick -> v_pid',
    E'v_kick -> v_pid')
$un164$;


-- L.D2.16 (migration 157 — additive, the R992 shape): pg_temp.un157 reverses
-- 157's substitutions in the seven bodies it replaced (an identity on every
-- other body), applied INNERMOST so the literals below still prove what
-- they proved; pgTAP 105 A6 / A7 pin 157's own.
create function pg_temp.un157(p_src text) returns text language sql as $un157$
  select replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(p_src,
    E'  -- 157 / F447: each ROSTERED player\'s kickoff is judged per PLAYER — his\n  -- current NFL team\'s game, or, when that is still ahead (or he has no\n  -- team), a start this league recorded for a game that kicked off or his\n  -- stat line for the week (lineup_player_kickoff_internal): a player the\n  -- NFL released or traded AFTER he played is still locked for the week.\n  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP\n    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, p_week, v_e ->> \'player_id\', p_at);\n',
    E'  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP\n    SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, p_week, v_e ->> \'nfl_team\', p_at);\n'),
    E'      SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, v_current, v_e ->> \'player_id\', p_at);   -- 157 / F447\n',
    E'      SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_current, v_e ->> \'nfl_team\', p_at);\n'),
    E'  -- 157 / F447: judged per PLAYER (set_lineup\'s step (6) helper) — a player\n  -- the NFL released or traded after he played is locked, never OPEN.\n  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP\n    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, p_season, p_week, v_e ->> \'player_id\', p_at);\n',
    E'  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP\n    SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_e ->> \'nfl_team\', p_at);\n'),
    E'    v_drop_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p_drop, p_at);   -- 157 / F447: judged per player (played this week)\n',
    E'    v_drop_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_drop_p.team, p_at);\n'),
    E'    v_add_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p_add, p_at);   -- 157 / F447: judged per player (played this week)\n',
    E'    v_add_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_add_p.team, p_at);\n'),
    E'  )\n  -- 157 / F447: judged per PLAYER — a player the NFL released or traded\n  -- after he played this week is locked at the run (Q73 / Q74).\n  SELECT COALESCE(jsonb_agg(p.id ORDER BY p.id COLLATE "C"), \'[]\'::jsonb) INTO v_locked\n  FROM public.players p JOIN claim_players cp ON cp.pid = p.id\n  WHERE (public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p.id, p_at) ->> \'locked\')::boolean;\n',
    E'  ), nfl AS (\n    SELECT DISTINCT p.team FROM public.players p JOIN claim_players cp ON cp.pid = p.id WHERE p.team IS NOT NULL\n  ), locked_nfl AS (\n    SELECT n.team FROM nfl n\n    WHERE (public.pool_game_lock_any_internal(v_league.season, v_current, n.team, p_at) ->> \'locked\')::boolean\n  )\n  SELECT COALESCE(jsonb_agg(p.id ORDER BY p.id COLLATE "C"), \'[]\'::jsonb) INTO v_locked\n  FROM public.players p JOIN claim_players cp ON cp.pid = p.id JOIN locked_nfl ln ON ln.team = p.team;\n'),
    E'  v_add_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p_add, p_at);   -- 157 / F447: judged per player (played this week)\n',
    E'  v_add_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_add_p.team, p_at);\n'),
    E'    v_lock := public.pool_game_lock_player_internal(p_league.id, p_league.season, v_current, v_p.player_id, p_at);   -- 157 / F447: judged per player (played this week)\n',
    E'    v_lock := public.pool_game_lock_any_internal(p_league.season, v_current, v_p.nfl_team, p_at);\n'),
    E'          v_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_pool.nfl_team, p_now);\n          -- 157 / F447: the view agrees with the lock every writer enforces —\n          -- per PLAYER: unlocked by his current team, but he PLAYED this week\n          -- (a start recorded for a real kickoff, or his stat line) ⇒ locked.\n          IF NOT (v_lock ->> \'locked\')::boolean THEN\n            v_lock := COALESCE(public.lineup_played_lock_internal(v_lg.id, v_league.season, v_current, v_pool.player_id, p_now), v_lock);\n          END IF;\n',
    E'          v_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_pool.nfl_team, p_now);\n'),
    E'            SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_row.week, v_team, p_now);\n            -- 157 / F447: a PASSED kickoff this record holds STAYS when it is a\n            -- real kickoff of the week and his current team\'s game is not\n            -- postponed — he played, and the NFL has released or traded him\n            -- since: never re-read to NULL or to his new team\'s later game.\n            -- A flexed or postponed game still moves it (E42 / E43).\n            IF (v_e ->> \'kickoff_at\')::timestamptz IS DISTINCT FROM v_k.kickoff_at\n               AND public.lineup_record_kicked_off_internal(v_league.season, v_row.week, v_pid, (v_e ->> \'kickoff_at\')::timestamptz, p_now) THEN\n              v_k.kickoff_at := (v_e ->> \'kickoff_at\')::timestamptz;\n            END IF;\n',
    E'            SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_row.week, v_team, p_now);\n')
$un157$;

-- L.D2.17 (migration 160 — additive, the R992 shape): pg_temp.un160 reverses
-- 160's ONE substitution in process_waivers_internal (the no-key tiebreaker
-- fallback; an identity on every other body), applied INNERMOST so the
-- literals below still prove what they proved; pgTAP 108 A pins 160's own.
create function pg_temp.un160(p_src text) returns text language sql as $un160$
  select replace(p_src,
    '  v_tb := COALESCE(v_league.settings ->> ''faab_tiebreaker'', ''rolling_priority'');   -- 160 / L.D2.17: no stored key => the rolling order (Chris 2026-09-29)',
    '  v_tb := COALESCE(v_league.settings ->> ''faab_tiebreaker'', ''reverse_standings'');')
$un160$;

-- ---------------------------------------------------------------------------
-- A. Form pins, D137 in the database, the neighbours untouched
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('lineup_record_kicked_off_internal', 'lineup_played_internal', 'lineup_player_kickoff_internal',
                                                 'lineup_played_lock_internal', 'pool_game_lock_player_internal')),
  'lineup_played_internal:f:search_path="":f:f lineup_played_lock_internal:f:search_path="":f:f lineup_player_kickoff_internal:f:search_path="":f:f lineup_record_kicked_off_internal:f:search_path="":f:f pool_game_lock_player_internal:f:search_path="":f:f',
  'A1 the five new helpers: one overload each, PLAIN, search_path empty, closed to anon and authenticated');
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup_internal', 'lineup_autopilot_internal', 'roster_add_drop_internal',
                                                 'waiver_claim_submit_internal', 'process_waivers_internal', 'trade_lock_internal', 'lineup_lock_tick')),
  'lineup_autopilot_internal:f:search_path="":f:f lineup_lock_tick:t:search_path="":f:f process_waivers_internal:f:search_path="":f:f roster_add_drop_internal:f:search_path="":f:f set_lineup_internal:f:search_path="":f:f trade_lock_internal:f:search_path="":f:f waiver_claim_submit_internal:f:search_path="":f:f',
  'A2 the seven replaced bodies: one overload each (signatures unchanged), the tick still the only DEFINER, search_path empty, closed to anon and authenticated');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0
      and p.proname in ('lineup_record_kicked_off_internal', 'lineup_played_internal', 'lineup_player_kickoff_internal',
                        'lineup_played_lock_internal', 'pool_game_lock_player_internal',
                        'set_lineup_internal', 'lineup_autopilot_internal', 'roster_add_drop_internal',
                        'waiver_claim_submit_internal', 'process_waivers_internal', 'trade_lock_internal', 'lineup_lock_tick')),
  'A3 PUBLIC holds EXECUTE on none of the twelve (REVOKEs restated)');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un157(pg_temp.un160(pg_temp.un169(pg_temp.un181(pg_temp.un199(pg_temp.un201(pg_temp.un205(p.prosrc)))))))), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup_internal', 'lineup_autopilot_internal', 'roster_add_drop_internal',
                                                 'waiver_claim_submit_internal', 'process_waivers_internal', 'trade_lock_internal', 'lineup_lock_tick')),
  'lineup_autopilot_internal=0eb0586b35c3a22559e2323ba25b58a5 lineup_lock_tick=540946257b7f6b2f2739e4d27f5cf584 process_waivers_internal=7b3dad5e6e9483ed0edc82bd8f055ada roster_add_drop_internal=f4879cd129747a28d52bab277108265e set_lineup_internal=991dfe0a36e1e9d3f823e81999bf3190 trade_lock_internal=0e8a591bdac064d7c3d06eb0e4a414f4 waiver_claim_submit_internal=33aaaaa0bf94e620c3f03f836aa888f7',
  'A4 D137: each live body with 157''s substitutions reversed is its NEWEST definer''s FILE TEXT (154:372 / 154:1899 / 153:422 / 150:1397 / 153:1981 / 151:689 / 139:1045 — the stored md5 literals 102 A8, 101 A13 and 087 A7 pin)');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un160(pg_temp.un169(pg_temp.un181(pg_temp.un199(pg_temp.un201(pg_temp.un205(p.prosrc))))))), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup_internal', 'lineup_autopilot_internal', 'roster_add_drop_internal',
                                                 'waiver_claim_submit_internal', 'process_waivers_internal', 'trade_lock_internal', 'lineup_lock_tick')),
  'lineup_autopilot_internal=544d32c67abd3f3243ff1bfa568360ad lineup_lock_tick=bcc10f9a40e99f7a1cf83e1c94f813f0 process_waivers_internal=440a595061f1bdd26715ee381b5d6afa roster_add_drop_internal=d0e6afde7fdd872cb0d9576de91bcf7e set_lineup_internal=ca3307414057469da7ed5c0af0b29fe6 trade_lock_internal=cfdbf2451a0287cc6bf6bb1ee166b553 waiver_claim_submit_internal=5822e363acddfb8f781dc3ea6fb7e448',
  'A5 the seven live prosrc md5s — 157 as written (stored literals)');
-- pg_temp.un184 — migration 184's inserted lines removed (each ends
-- `-- 184 / L.G1.4 (TD7)`; pgTAP 132 pins them). RE-PINNED BY L.G1.4's fix
-- round (R1546 — lineup_kickoff_internal gained one line; additive, R992).
create function pg_temp.un184(p_src text) returns text language sql as $un184$
  select regexp_replace(p_src, E'\n[^\n]*   -- 184 / L\\.G1\\.4 \\(TD7\\)', '', 'g')
$un184$;
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un164(pg_temp.un165(pg_temp.un166(pg_temp.un170(pg_temp.un180(pg_temp.un184(pg_temp.un199(pg_temp.un201(p.prosrc))))))))), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('trade_execute_internal', 'commish_roster_override_internal', 'commish_edit_lineup_internal',
                                                 'lineup_kept_starter_internal', 'lineup_kickoff_internal', 'pool_game_lock_any_internal')),
  'commish_edit_lineup_internal=60662cff534f641b2674201b999681c8 commish_roster_override_internal=32972a1a5183c748be5a90c8ffdad7f1 lineup_kept_starter_internal=3266056c8506911d20ef8f96fd76cbb3 lineup_kickoff_internal=80b9c63efa3cb5bbef7b79863e9801a7 pool_game_lock_any_internal=c04027b390f46cf19247fab2ff2e1990 trade_execute_internal=044fd0a7668adb67c2c81b0e452b8341',
  'A6 UNTOUCHED (stored literals): the executor (156 — R1234 needs no hunk), the two commissioner verbs (they stand outside the lock), 154''s kept-starter judgment, 112''s team datum and 153''s team lock — untouched BY 157 (164 later changed three of them: reversed innermost here, pgTAP 112 pins them)');
select is(
  (select string_agg(p.proname || ':' || (length(p.prosrc) - length(replace(p.prosrc, 'public.pool_game_lock_any_internal(', ''))) / length('public.pool_game_lock_any_internal(')
                     || '/' || (length(p.prosrc) - length(replace(p.prosrc, 'public.pool_game_lock_player_internal(', ''))) / length('public.pool_game_lock_player_internal('),
                     ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('roster_add_drop_internal', 'waiver_claim_submit_internal', 'process_waivers_internal', 'trade_lock_internal')),
  'process_waivers_internal:0/1 roster_add_drop_internal:0/2 trade_lock_internal:0/1 waiver_claim_submit_internal:0/1',
  'A7 every lock a manager, a claim, a run or a trade meets is judged PER PLAYER: no enforcing body reads 153''s team lock directly any more (team-lock calls / per-player calls)');
select is(
  (select string_agg(p.proname || ':' || (length(p.prosrc) - length(replace(p.prosrc, 'public.lineup_kickoff_internal(', ''))) / length('public.lineup_kickoff_internal(')
                     || '/' || (length(p.prosrc) - length(replace(p.prosrc, 'public.lineup_player_kickoff_internal(', ''))) / length('public.lineup_player_kickoff_internal('),
                     ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup_internal', 'lineup_autopilot_internal')),
  'lineup_autopilot_internal:0/1 set_lineup_internal:0/2',
  'A8 set_lineup and autopilot read every ROSTERED player''s datum per player (team-datum calls / per-player calls)');

-- ---------------------------------------------------------------------------
-- FIXTURE
-- ---------------------------------------------------------------------------
-- THE CALENDAR (2026 seeds; only the stamps are rewritten): weeks 1–5 over;
-- WEEK 6 — PA @ PZ Thu 10-16 00:15Z, PB @ PY Sun 10-18 17:00Z, PC on bye,
-- its last game recorded ending Tue 10-20 03:30Z. Every OTHER week carries a
-- dummy game so no week falls to the no-game-rows datum chain (which locks
-- everyone). "Sunday 12:00" (R1216's probe) = 10-18 16:00Z: after the
-- Thursday game, before the Sunday one.
update nfl_weeks w
set last_game_ends_at = case when w.week <= 5 then w.starts_at + interval '6 days'
                             when w.week = 6 then '2026-10-20 03:30:00+00'::timestamptz end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at)
select 'pl-dummy-' || w.week, 2026, w.week, 'KC', 'BUF', w.starts_at + interval '1 day' from nfl_weeks w where w.season = 2026 and w.week <= 14 and w.week <> 6;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('pl-g6a', 2026, 6, 'PA', 'PZ', '2026-10-16 00:15:00+00'), ('pl-g6b', 2026, 6, 'PB', 'PY', '2026-10-18 17:00:00+00');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('91570000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-pl' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'pl_user' || i)::jsonb, now(), now()
from generate_series(1, 8) i;

-- LP: instant pickups (none_fcfs), trades with no review — §B §C §E §F §G.
-- LW: FAAB, a run every day at 16:00 UTC, the next one Sunday 16:00Z — §D.
insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review,
                     settings, roster_settings, waiver_next_run_at)
select l.id, '91570000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', 12, 14, 0, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.wt, 100, 'none', l.st::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 2}], "bench": 3, "ir_slots": [], "swap_spots": 0}'::jsonb,
       l.nx
from (values
 ('b1570000-0000-4000-8000-000000000001'::uuid, 'pgtap-pl-LP', 'none_fcfs', '{}', null::timestamptz),
 ('b1570000-0000-4000-8000-000000000002'::uuid, 'pgtap-pl-LW', 'faab',
  '{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "16:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"}',
  '2026-10-18 16:00:00+00')
) as l(id, nm, wt, st, nx);

insert into teams (id, owner_id, name, league_id, status)
select t.id::uuid, ('91570000-0000-4000-8000-00000000000' || t.u)::uuid, t.nm, ('b1570000-0000-4000-8000-00000000000' || t.lg)::uuid, 'active'
from (values
 ('c1570000-0000-4000-8000-000000000011', 1, 'PL Commish', 1), ('c1570000-0000-4000-8000-000000000012', 2, 'PL Alpha', 1),
 ('c1570000-0000-4000-8000-000000000013', 3, 'PL Delta', 1),   ('c1570000-0000-4000-8000-000000000014', 4, 'PL Echo', 1),
 ('c1570000-0000-4000-8000-000000000015', 5, 'PL Foxtrot', 1), ('c1570000-0000-4000-8000-000000000016', 6, 'PL Golf', 1),
 ('c1570000-0000-4000-8000-000000000017', 7, 'PL Hotel', 1),
 ('c1570000-0000-4000-8000-000000000021', 1, 'PW Commish', 2), ('c1570000-0000-4000-8000-000000000022', 2, 'PW Whiskey', 2),
 ('c1570000-0000-4000-8000-000000000023', 3, 'PW Yankee', 2)
) as t(id, u, nm, lg);

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '91570000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false, 100
from teams t where t.id::text like 'c1570000-%';

insert into league_weeks (league_id, season, week)
select l.id, 2026, w from leagues l cross join generate_series(1, 14) w where l.id::text like 'b1570000-%';
-- (F4's transition guard: upcoming → live → correction_window → final, one step at a time.)
update league_weeks set status = 'live'              where league_id::text like 'b1570000-%' and week <= 6;
update league_weeks set status = 'correction_window' where league_id::text like 'b1570000-%' and week <= 5;
update league_weeks set status = 'final'             where league_id::text like 'b1570000-%' and week <= 5;

insert into drafts (league_id, status, completed_at, draft_order)
select l.id, 'complete', '2026-09-06 06:00:00+00',
       (select jsonb_agg(t.id order by t.id) from teams t where t.league_id = l.id)
from leagues l where l.id::text like 'b1570000-%';

-- Every player is on the team his name says at the Thursday kickoff; the
-- NFL's moves (a trade to PB, a release to no team) are applied below, after
-- the week's Thursday game — the F447 shape.
insert into players (id, full_name, position, team, status, adp)
select p.id, p.nm, 'QB', p.nfl, 'Active', p.adp
from (values
 ('pl-a1', 'PL A One (Thu)', 'PA', 100), ('pl-a2', 'PL A Two (Sun)', 'PB', 100), ('pl-a3', 'PL A Three (bye)', 'PC', 100),
 ('pl-d1', 'PL D One (Thu)', 'PA', 100), ('pl-d2', 'PL D Two (Sun)', 'PB', 100), ('pl-d3', 'PL D Three (bye)', 'PC', 100),
 ('pl-e1', 'PL E One (Sun)', 'PB', 100), ('pl-e2', 'PL E Two (bye)', 'PC', 100), ('pl-e3', 'PL E Three (Thu)', 'PA', 100),
 ('pl-f1', 'PL F One (Thu)', 'PA', 100), ('pl-f2', 'PL F Two (Sun)', 'PB', 50),  ('pl-f3', 'PL F Three (Thu)', 'PA', 10),
 ('pl-g1', 'PL G One (Thu)', 'PA', 100), ('pl-g2', 'PL G Two (bye)', 'PC', 100),
 ('pl-h1', 'PL H One (bye)', 'PC', 100), ('pl-h2', 'PL H Two (bye)', 'PC', 100),
 ('pl-x1', 'PL X One (Thu)', 'PA', 100), ('pl-x2', 'PL X Two (Thu)', 'PA', 100), ('pl-x3', 'PL X Three (Sun)', 'PB', 100),
 ('pl-w1', 'PL W One (Thu)', 'PA', 100), ('pl-w2', 'PL W Two (bye)', 'PC', 100),
 ('pl-wx', 'PL WX (Thu)', 'PA', 100), ('pl-wz', 'PL WZ (Thu)', 'PA', 100), ('pl-wy', 'PL WY (Sun)', 'PB', 100),
 ('pl-y1', 'PL Y One (bye)', 'PC', 100), ('pl-y2', 'PL Y Two (bye)', 'PC', 100)
) as p(id, nm, nfl, adp);

insert into league_rosters (league_id, team_id, player_id, slot_key)
select t.league_id, t.id, r.pid, 'bn'
from (values
 ('PL Alpha', 'pl-a1'), ('PL Alpha', 'pl-a2'), ('PL Alpha', 'pl-a3'),
 ('PL Delta', 'pl-d1'), ('PL Delta', 'pl-d2'), ('PL Delta', 'pl-d3'),
 ('PL Echo', 'pl-e1'), ('PL Echo', 'pl-e2'), ('PL Echo', 'pl-e3'),
 ('PL Foxtrot', 'pl-f1'), ('PL Foxtrot', 'pl-f2'), ('PL Foxtrot', 'pl-f3'),
 ('PL Golf', 'pl-g1'), ('PL Golf', 'pl-g2'), ('PL Hotel', 'pl-h1'), ('PL Hotel', 'pl-h2'),
 ('PW Whiskey', 'pl-w1'), ('PW Whiskey', 'pl-w2'), ('PW Yankee', 'pl-y1'), ('PW Yankee', 'pl-y2')
) as r(team, pid)
join teams t on t.name = r.team and t.id::text like 'c1570000-%';
insert into league_player_pool (league_id, player_id, state)
select 'b1570000-0000-4000-8000-000000000001', p, 'free_agent' from unnest(array['pl-x1', 'pl-x2', 'pl-x3']) p;
insert into league_player_pool (league_id, player_id, state)
select 'b1570000-0000-4000-8000-000000000001', r.player_id, 'rostered' from league_rosters r where r.league_id = 'b1570000-0000-4000-8000-000000000001';

-- Lineups in 114's shape; p_k0 / p_k1 = each slot's RECORDED kickoff (the
-- starters[] record the writer that seated him left — here the Thursday
-- kickoff for every Thursday starter).
create function pg_temp.team(p_name text) returns uuid language sql as $$ select id from teams where name = p_name and id::text like 'c1570000-%' $$;
create function pg_temp.put(p_team text, p_week int, p_q0 text, p_q1 text, p_bench jsonb, p_k0 timestamptz default null, p_k1 timestamptz default null)
returns void language sql as $$
  insert into team_lineups (team_id, season, week, slot_map, starters, bench)
  values (pg_temp.team(p_team), 2026, p_week,
          jsonb_strip_nulls(jsonb_build_object('qb:0', p_q0, 'qb:1', p_q1)),
          jsonb_build_array(
            jsonb_build_object('slot', 'qb:0', 'player_id', p_q0, 'kickoff_at', p_k0, 'flags', case when p_q0 is null then '["empty"]'::jsonb else '[]'::jsonb end),
            jsonb_build_object('slot', 'qb:1', 'player_id', p_q1, 'kickoff_at', p_k1, 'flags', case when p_q1 is null then '["empty"]'::jsonb else '[]'::jsonb end)),
          p_bench)
$$;
select pg_temp.put(t.team, 6, t.q0, t.q1, t.bench::jsonb, t.k0::timestamptz, t.k1::timestamptz)
from (values
 ('PL Alpha',   'pl-a1', 'pl-a2', '["pl-a3"]',          '2026-10-16 00:15:00+00', '2026-10-18 17:00:00+00'),
 ('PL Delta',   'pl-d1', 'pl-d2', '["pl-d3"]',          '2026-10-16 00:15:00+00', '2026-10-18 17:00:00+00'),
 ('PL Echo',    'pl-e1', null,    '["pl-e2", "pl-e3"]', '2026-10-18 17:00:00+00', null),
 ('PL Foxtrot', 'pl-f1', null,    '["pl-f2", "pl-f3"]', '2026-10-16 00:15:00+00', null),
 ('PL Golf',    'pl-g1', null,    '["pl-g2"]',          '2026-10-16 00:15:00+00', null),
 ('PL Hotel',   'pl-h1', null,    '["pl-h2"]',          null, null),
 ('PW Whiskey', 'pl-w1', null,    '["pl-w2"]',          '2026-10-16 00:15:00+00', null),
 ('PW Yankee',  'pl-y1', null,    '["pl-y2"]',          null, null)
) as t(team, q0, q1, bench, k0, k1);
select pg_temp.put(t.team, 7, t.q0, null, t.bench::jsonb)
from (values ('PL Golf', 'pl-g1', '["pl-g2"]'), ('PL Hotel', 'pl-h1', '["pl-h2"]')) as t(team, q0, bench);

-- THE THURSDAY GAME'S STAT LINES (he played): the starters D One, F One, G
-- One, W One; the BENCH men E Three and F Three; the free agents X One, X Two,
-- WX, WZ. A One has NONE — his lineup record alone says he played. X Two's
-- line names no game (the week's first kickoff stands in).
insert into player_stats (player_id, season, week, stat_type, game_id, updated_at)
select p, 2026, 6, 'weekly', case when p = 'pl-x2' then null else 'pl-g6a' end, '2026-10-16 03:30:00+00'
from unnest(array['pl-d1', 'pl-f1', 'pl-g1', 'pl-w1', 'pl-e3', 'pl-f3', 'pl-x1', 'pl-x2', 'pl-wx', 'pl-wz']) p;

-- THE NFL MOVES, after the Thursday game: traded to PB (plays Sunday
-- 17:00Z) or released (no team — read as a bye).
update players set team = 'PB' where id in ('pl-d1', 'pl-e3', 'pl-f3', 'pl-g1', 'pl-x1', 'pl-w1', 'pl-wx');
update players set team = null where id in ('pl-a1', 'pl-f1', 'pl-x2', 'pl-wz');

-- Post-reset race guard (067's): today's + tomorrow's realtime.messages partitions.
do $part$
declare
  d date;
  part_name text;
begin
  foreach d in array array[current_date, current_date + 1] loop
    part_name := 'messages_' || to_char(d, 'YYYY_MM_DD');
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'realtime' and c.relname = part_name) then
      execute format('create table realtime.%I partition of realtime.messages for values from (%L) to (%L)',
                     part_name, d::timestamp, (d + 1)::timestamp);
    end if;
  end loop;
end
$part$;

create temp table r105 (tag text primary key, r jsonb not null);
create function pg_temp.as_user(p_n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '91570000-0000-4000-8000-00000000000' || p_n, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.lg(p_n int) returns uuid language sql as $$ select ('b1570000-0000-4000-8000-00000000000' || p_n)::uuid $$;
create function pg_temp.act(p_n int) returns uuid language sql as $$ select ('a1570000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.lu(p_team text, p_week int) returns text language sql as $$
  select format('%s | %s | %s', tl.slot_map::text,
                (select string_agg(coalesce(s ->> 'player_id', '-'), ',' order by o) from jsonb_array_elements(tl.starters) with ordinality x(s, o)),
                tl.bench::text)
  from team_lineups tl where tl.team_id = pg_temp.team(p_team) and tl.season = 2026 and tl.week = p_week $$;
create function pg_temp.rec(p_team text, p_pid text) returns text language sql as $$
  select coalesce((select s ->> 'kickoff_at' from team_lineups tl, jsonb_array_elements(tl.starters) s
                   where tl.team_id = pg_temp.team(p_team) and tl.week = 6 and s ->> 'player_id' = p_pid), 'null') $$;
create function pg_temp.roster_of(p_pid text) returns text language sql as $$
  select coalesce((select t.name from league_rosters r join teams t on t.id = r.team_id where r.player_id = p_pid and r.league_id::text like 'b1570000-%'), '(none)') $$;
create function pg_temp.ad(p_tag text, p_user int, p_team text, p_add text, p_drop text, p_at timestamptz, p_act int) returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r105 select p_tag, public.roster_add_drop_internal(pg_temp.lg(1), pg_temp.team(p_team), p_add, p_drop, pg_temp.act(p_act), p_at);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r105 where tag = p_tag);
end $$;
create function pg_temp.sl(p_tag text, p_user int, p_team text, p_map jsonb, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r105 select p_tag, public.set_lineup_internal(pg_temp.lg(1), pg_temp.team(p_team), 6, p_map, pg_temp.act(p_act), p_at, null);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r105 where tag = p_tag);
end $$;
create function pg_temp.claim(p_tag text, p_user int, p_team text, p_add text, p_drop text, p_bid int, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r105 select p_tag, public.waiver_claim_submit_internal(pg_temp.lg(2), pg_temp.team(p_team), p_add, p_drop, p_bid, pg_temp.act(p_act), p_at, null);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r105 where tag = p_tag);
end $$;
-- An ACCEPTED path is called through pg_temp.try: a refusal is recorded as
-- {"error": …} under its tag instead of aborting the transaction, so a break
-- probe reds the cell (and every later cell still runs).
create function pg_temp.try(p_tag text, p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform set_config('request.jwt.claims', '', true);
exception when others then
  perform set_config('request.jwt.claims', '', true);
  insert into r105 values (p_tag, jsonb_build_object('error', sqlstate || ': ' || sqlerrm)) on conflict (tag) do nothing;
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  perform set_config('request.jwt.claims', '', true);
  return 'ACCEPTED';
exception when others then
  perform set_config('request.jwt.claims', '', true);
  return sqlstate || ': ' || sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- B. The judgment itself — the three records, the boundary instants
-- ---------------------------------------------------------------------------
select is(
  format('%s|%s|%s|%s|%s',
         public.lineup_record_kicked_off_internal(2026, 6, 'pl-d1', '2026-10-16 00:15:00+00', '2026-10-16 00:15:00+00'),
         public.lineup_record_kicked_off_internal(2026, 6, 'pl-d1', '2026-10-16 00:15:00+00', '2026-10-16 00:14:59+00'),
         public.lineup_record_kicked_off_internal(2026, 6, 'pl-d1', '2026-10-16 02:15:00+00', '2026-10-18 16:00:00+00'),
         public.lineup_record_kicked_off_internal(2026, 6, 'pl-d1', null, '2026-10-18 16:00:00+00'),
         public.lineup_record_kicked_off_internal(2026, 7, 'pl-d1', '2026-10-16 00:15:00+00', '2026-10-18 16:00:00+00')),
  't|f|f|f|f',
  'B1 a recorded kickoff is REAL AND PASSED only AT/after a kickoff a game of THAT week has (Thu 00:15Z at 00:15:00 yes, at 00:14:59 no); an instant no game of the week has (a stale, flexed record), NULL, or another week''s game never counts');
update nfl_games set status = 'postponed' where id = 'pl-g6b';
select is(
  format('%s|%s', public.lineup_record_kicked_off_internal(2026, 6, 'pl-d1', '2026-10-16 00:15:00+00', '2026-10-18 16:00:00+00'),
                  public.lineup_record_kicked_off_internal(2026, 6, 'pl-a1', '2026-10-16 00:15:00+00', '2026-10-18 16:00:00+00')),
  'f|t',
  'B2 E43: while his CURRENT team''s game (PB) is postponed his record does not count (D One, now PB); a released player (A One, no team) is unaffected');
update nfl_games set status = 'scheduled' where id = 'pl-g6b';
select is(
  (select string_agg(format('%s=%s/%s/%s', x.p, y.played, coalesce(to_char(y.kickoff_at at time zone 'UTC', 'MM-DD HH24:MI'), '-'), coalesce(y.datum_arm, '-')), ' ' order by x.p)
   from unnest(array['pl-a1', 'pl-d1', 'pl-e3', 'pl-x2', 'pl-e1', 'pl-x3']) x(p)
   cross join lateral public.lineup_played_internal(pg_temp.lg(1), 2026, 6, x.p, '2026-10-18 16:00:00+00') y),
  'pl-a1=t/10-16 00:15/lineup_record pl-d1=t/10-16 00:15/lineup_record pl-e1=f/-/- pl-e3=t/10-16 00:15/stat_line pl-x2=t/10-16 00:15/stat_line pl-x3=f/-/-',
  'B3 played, by the records: A One by his start''s record alone; D One by his record (first); E Three (a bench man) and X Two (a free agent whose line names no game — the week''s first kickoff stands in) by their stat lines; E One and X Three (Sunday, still to play) not');
select is(
  format('%s|%s',
         (select played from public.lineup_played_internal(pg_temp.lg(1), 2026, 6, 'pl-x1', '2026-10-16 00:14:59+00')),
         (select played from public.lineup_played_internal(pg_temp.lg(1), 2026, 6, 'pl-x1', '2026-10-16 00:15:00+00'))),
  'f|t',
  'B4 BOUNDARY: a stat line counts from its game''s kickoff — 00:14:59 no, 00:15:00 yes (the evaluation instant never precedes the game it records)');
select is(
  format('%s || %s',
         (select format('%s/%s/%s', (d ->> 'locked'), d ->> 'kickoff_at', d ->> 'datum_arm') from public.pool_game_lock_any_internal(2026, 6, 'PB', '2026-10-18 16:00:00+00') d),
         (select format('%s/%s/%s/%s/%s', (d ->> 'locked'), d ->> 'week', d ->> 'kickoff_at', d ->> 'window_ends_at', d ->> 'datum_arm')
          from public.pool_game_lock_player_internal(pg_temp.lg(1), 2026, 6, 'pl-x1', '2026-10-18 16:00:00+00') d)),
  'false/2026-10-18T17:00:00+00:00/nfl_games || true/6/2026-10-16T00:15:00+00:00/2026-10-20T03:30:00+00:00/stat_line',
  'B5 PREMISE + FIX: at Sunday 12:00 ET his CURRENT team (PB) reads UNLOCKED (153''s team lock — every reader before 157); the per-player lock reads him LOCKED — he played Thursday — until week 6''s recorded end');
select is(
  format('%s|%s|%s',
         (select d ->> 'locked' from public.pool_game_lock_player_internal(pg_temp.lg(1), 2026, 6, 'pl-x1', '2026-10-20 03:29:59+00') d),
         (select d ->> 'locked' from public.pool_game_lock_player_internal(pg_temp.lg(1), 2026, 6, 'pl-x1', '2026-10-20 03:30:00+00') d),
         (select d ->> 'locked' from public.pool_game_lock_player_internal(pg_temp.lg(1), 2026, 6, 'pl-x3', '2026-10-18 16:00:00+00') d)),
  'true|false|false',
  'B6 BOUNDARY: the lock still RELEASES at the week''s lock release (153) — locked at 03:29:59, open at 03:30:00; a Sunday player who has not played is open at Sunday 12:00 (positive control)');
select is(
  (select format('%s/%s/%s', k.kickoff_at at time zone 'UTC', k.datum_arm, k.on_bye)
   from public.lineup_player_kickoff_internal(pg_temp.lg(1), 2026, 6, 'pl-a1', '2026-10-18 16:00:00+00') k)
  || ' || ' ||
  (select format('%s/%s/%s', k.kickoff_at at time zone 'UTC', k.datum_arm, k.on_bye)
   from public.lineup_player_kickoff_internal(pg_temp.lg(1), 2026, 6, 'pl-e1', '2026-10-18 16:00:00+00') k),
  '2026-10-16 00:15:00/lineup_record/f || 2026-10-18 17:00:00/nfl_games/f',
  'B7 the lineup datum per player: A One (released — his team reads as a BYE) carries the Thursday kickoff he played in, never a bye; E One (Sunday) is his team''s kickoff, unchanged');

-- ---------------------------------------------------------------------------
-- C. R1216's live probe, as cells — the drop, the add, the start (Sunday)
-- ---------------------------------------------------------------------------
select is(
  pg_temp.err($$ select pg_temp.ad('C1', 3, 'PL Delta', null, 'pl-d1', '2026-10-18 16:00:00+00', 1) $$),
  'P0001: roster_add_drop: PL D One (Thu) (pl-d1) is locked for drops — kicked off at 2026-10-16T00:15:00+00:00 (lineup_record); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game',
  'C1 R1216: at Sunday 12:00 his manager''s DROP of D One (played Thursday, since traded to a Sunday team) is REFUSED by name — before 157 it was accepted and his week-6 start was cleared');
select is(pg_temp.roster_of('pl-d1') || ' | ' || pg_temp.lu('PL Delta', 6),
  'PL Delta | {"qb:0": "pl-d1", "qb:1": "pl-d2"} | pl-d1,pl-d2 | ["pl-d3"]',
  'C2 …so he stays on PL Delta and in its week-6 start — nothing moved');
select is(
  pg_temp.err($$ select pg_temp.ad('C3', 2, 'PL Alpha', null, 'pl-a1', '2026-10-18 16:00:00+00', 2) $$),
  'P0001: roster_add_drop: PL A One (Thu) (pl-a1) is locked for drops — kicked off at 2026-10-16T00:15:00+00:00 (lineup_record); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game',
  'C3 the RELEASE variant: A One (no NFL team now — read as a bye before 157; no stat line) is refused too, by his start''s record');
select is(
  pg_temp.err($$ select pg_temp.ad('C4', 4, 'PL Echo', 'pl-x1', null, '2026-10-18 16:01:00+00', 3) $$),
  'P0001: roster_add_drop: PL X One (Thu) (pl-x1) is locked for adds — kicked off at 2026-10-16T00:15:00+00:00 (stat_line); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
  'C4 R1216''s other half: another team''s ADD of X One (a free agent who played Thursday, since traded to a Sunday team) is REFUSED — his Thursday points cannot join a second team this week');
select is(
  pg_temp.err($$ select pg_temp.ad('C5', 4, 'PL Echo', 'pl-x2', null, '2026-10-18 16:01:00+00', 4) $$),
  'P0001: roster_add_drop: PL X Two (Thu) (pl-x2) is locked for adds — kicked off at 2026-10-16T00:15:00+00:00 (stat_line); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
  'C5 the RELEASE variant of the add: X Two (no NFL team, a stat line naming no game) is refused the same way');
select is(
  pg_temp.err($$ select pg_temp.sl('C6', 4, 'PL Echo', '{"qb:0": "pl-e1", "qb:1": "pl-e3"}', '2026-10-18 16:02:00+00', 5) $$),
  'P0001: set_lineup: PL E Three (Thu)''s game kicked off at 2026-10-16T00:15:00+00:00 (stat_line) — a player whose game has started cannot enter or move slots (§11.2, lineup_lock = per_player_kickoff); wanted "qb:1"',
  'C6 the START: E Three sat on PL Echo''s bench Thursday and played, then was traded to a Sunday team — his manager cannot move him into a starting slot at Sunday 12:00 (his Thursday points would join the start)');
select is(
  pg_temp.err($$ select pg_temp.sl('C7', 2, 'PL Alpha', '{"qb:0": "pl-a3", "qb:1": "pl-a2"}', '2026-10-18 16:02:00+00', 6) $$),
  'P0001: set_lineup: slot qb:0 is locked — PL A One (Thu) kicked off at 2026-10-16T00:15:00+00:00 (lineup_record) and a locked slot''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable',
  'C7 BENCH-AFTER-RELEASE: A One''s manager cannot bench him at Sunday 12:00 in the week he already played (released — before 157 he read as a bye, unlocked)');
select is(
  pg_temp.err($$ select pg_temp.sl('C8', 3, 'PL Delta', '{"qb:0": "pl-d3", "qb:1": "pl-d2"}', '2026-10-18 16:02:00+00', 7) $$),
  'P0001: set_lineup: slot qb:0 is locked — PL D One (Thu) kicked off at 2026-10-16T00:15:00+00:00 (lineup_record) and a locked slot''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable',
  'C8 …and the TRADE variant: D One (now on a Sunday team) cannot be benched either');
select pg_temp.try('C9', $$ select pg_temp.sl('C9', 3, 'PL Delta', '{"qb:0": "pl-d1", "qb:1": "pl-d3"}', '2026-10-18 16:03:00+00', 8) $$);
select is(
  format('%s || %s', coalesce((select r ->> 'error' from r105 where tag = 'C9'), (select r ->> 'slot_map' from r105 where tag = 'C9')), pg_temp.rec('PL Delta', 'pl-d1')),
  '{"qb:0": "pl-d1", "qb:1": "pl-d3"} || 2026-10-16T00:15:00+00:00',
  'C9 POSITIVE CONTROL: a submit that KEEPS him goes through — the unlocked slot (D Two, Sunday) is changed freely, and his record keeps the Thursday kickoff he played in');
select pg_temp.try('C10', $$ select pg_temp.ad('C10', 4, 'PL Echo', 'pl-x3', 'pl-e2', '2026-10-18 16:04:00+00', 9) $$);
select is(
  format('%s|%s|%s', coalesce((select r ->> 'error' from r105 where tag = 'C10'), 'ok'), pg_temp.roster_of('pl-x3'), pg_temp.roster_of('pl-e2')),
  'ok|PL Echo|(none)',
  'C10 POSITIVE CONTROL: players who have NOT played this week move exactly as before — PL Echo adds X Three (Sunday) and drops E Two (bye) at Sunday 12:04');

-- ---------------------------------------------------------------------------
-- T. lineup_lock_tick — the record is kept; the pool view agrees
-- ---------------------------------------------------------------------------
select set_config('pgtap.t1', public.lineup_lock_tick('2026-10-18 16:05:00+00', pg_temp.lg(1))::text, true);
select is(
  format('%s|%s|%s|%s', pg_temp.rec('PL Alpha', 'pl-a1'), pg_temp.rec('PL Delta', 'pl-d1'), pg_temp.rec('PL Foxtrot', 'pl-f1'), pg_temp.rec('PL Alpha', 'pl-a2')),
  '2026-10-16T00:15:00+00:00|2026-10-16T00:15:00+00:00|2026-10-16T00:15:00+00:00|2026-10-18T17:00:00+00:00',
  'T1 F447: the tick KEEPS each passed Thursday record — A One and F One (released: before 157 re-read to NULL), D One (traded: before 157 re-read to his new team''s Sunday kickoff); A Two''s Sunday record is untouched');
select is(
  (select string_agg(pp.player_id || '=' || pp.state || ':' || coalesce(pp.locked_until::text, 'null'), ' ' order by pp.player_id)
   from league_player_pool pp where pp.league_id = pg_temp.lg(1) and pp.player_id in ('pl-x1', 'pl-x2', 'pl-d1', 'pl-e1')),
  'pl-d1=rostered:2026-10-20 03:30:00+00 pl-e1=rostered:null pl-x1=locked_in_game:2026-10-20 03:30:00+00 pl-x2=locked_in_game:2026-10-20 03:30:00+00',
  'T2 the pool VIEW agrees with the lock every writer enforces: the played free agents X One / X Two are locked_in_game until week 6''s end, the rostered D One carries it too; E One (Sunday) is open');
select set_config('pgtap.t3', public.lineup_lock_tick('2026-10-20 03:30:00+00', pg_temp.lg(1))::text, true);
select is(
  (select string_agg(pp.player_id || '=' || pp.state || ':' || coalesce(pp.locked_until::text, 'null'), ' ' order by pp.player_id)
   from league_player_pool pp where pp.league_id = pg_temp.lg(1) and pp.player_id in ('pl-x1', 'pl-x2')),
  'pl-x1=free_agent:null pl-x2=free_agent:null',
  'T3 …and releases at the week''s recorded end, as every lock does (153 unchanged)');

-- ---------------------------------------------------------------------------
-- E. Autopilot — a played starter is locked; a played bench man never seated
-- ---------------------------------------------------------------------------
insert into r105 select 'E1', public.lineup_autopilot_internal(pg_temp.lg(1), pg_temp.team('PL Foxtrot'), 2026, 6, '2026-10-18 16:00:00+00');
select is(
  (select format('%s|%s', r ->> 'changed', r -> 'slot_map') from r105 where tag = 'E1'),
  'true|{"qb:0": "pl-f1", "qb:1": "pl-f2"}',
  'E1 autopilot at Sunday 12:00: F One (played Thursday, released) is LOCKED at qb:0 — never read as a bye and benched; the open qb:1 goes to F Two (Sunday), not to F Three');
select is(
  (select string_agg(e ->> 'player_id', ',' order by e ->> 'player_id') from r105, jsonb_array_elements(r -> 'skipped_locked') e where tag = 'E1'),
  'pl-f3',
  'E2 …F Three (a bench man who played Thursday, since traded to a Sunday team) is NAMED in skipped_locked — his Thursday points never enter the start');

-- ---------------------------------------------------------------------------
-- F. The trade executor (R1234) — a manager accept DEFERS, the release runs it
-- ---------------------------------------------------------------------------
select pg_temp.as_user(6);
insert into r105 select 'F0', public.trade_propose_internal(pg_temp.lg(1), pg_temp.team('PL Golf'), pg_temp.team('PL Hotel'),
  jsonb_build_array(jsonb_build_object('player_id', 'pl-g1', 'from_team_id', pg_temp.team('PL Golf')),
                    jsonb_build_object('player_id', 'pl-h1', 'from_team_id', pg_temp.team('PL Hotel'))),
  null, null, pg_temp.act(31), '2026-10-18 15:00:00+00', null);
select pg_temp.as_user(7);
select pg_temp.try('F1', $$ insert into r105 select 'F1', public.trade_respond_internal(pg_temp.lg(1), (select (r #>> '{trade,id}')::uuid from r105 where tag = 'F0'),
  'accept', null, null, null, pg_temp.act(32), '2026-10-18 16:00:00+00', null) $$);
select set_config('request.jwt.claims', '', true);
create function pg_temp.f_trade() returns uuid language sql as $$ select (r #>> '{trade,id}')::uuid from r105 where tag = 'F0' $$;
select is(
  (select format('%s|%s|%s || %s / %s', coalesce(r ->> 'error', r #>> '{execution,outcome}'), r #>> '{execution,execute_after}',
                 (select t.status || ':' || coalesce(t.execute_after::text, 'null') from trades t where t.id = pg_temp.f_trade()),
                 pg_temp.roster_of('pl-g1'), pg_temp.roster_of('pl-h1'))
   from r105 where tag = 'F1'),
  'deferred|2026-10-20T03:30:00+00:00|accepted:2026-10-20 03:30:00+00 || PL Golf / PL Hotel',
  'F1 R1234: PL Hotel accepts at Sunday 12:00 a trade naming G One (played Thursday, since traded to a Sunday team) — the executor DEFERS it to week 6''s end; nothing moves (before 157 it completed at once and his played start left the live week, with no re-score)');
insert into r105 select 'F2', public.trade_tick('2026-10-20 03:29:59+00', pg_temp.lg(1));
insert into r105 select 'F3', public.trade_tick('2026-10-20 03:30:00+00', pg_temp.lg(1));
select is(
  format('%s|%s || %s / %s', (select r ->> 'executed' from r105 where tag = 'F2'), (select r ->> 'executed' from r105 where tag = 'F3'),
         pg_temp.roster_of('pl-g1'), pg_temp.roster_of('pl-h1')),
  '0|1 || PL Hotel / PL Golf',
  'F2 BOUNDARY: the tick at week 6''s end − 1 s leaves it parked; AT the end it goes through — both players move together');
select is(
  format('%s || %s || %s', pg_temp.lu('PL Golf', 6), pg_temp.lu('PL Golf', 7), pg_temp.lu('PL Hotel', 7)),
  '{"qb:0": "pl-g1"} | pl-g1,- | ["pl-g2"] || {} | -,- | ["pl-g2", "pl-h1"] || {} | -,- | ["pl-g1", "pl-h2"]',
  'F3 the played start STAYS in PL Golf''s week 6 (the week closed to moves at its end — the first-unfinished-week rule); the move starts at week 7, each man on his new team''s bench');
select is(
  (select count(*)::int from score_fanout f where f.season = 2026 and f.week = 6 and f.player_id like 'pl-%'),
  0,
  'F4 …so nothing needs re-scoring: the executor queued no re-score and none is owed (only the commissioner''s force can move a played starter out of a live week, and it queues one — 156, D416)');

-- ---------------------------------------------------------------------------
-- D. Waivers (LW) — Q74 at submit, Q73 / Q74 at the run
-- ---------------------------------------------------------------------------
select is(
  pg_temp.err($$ select pg_temp.claim('D1', 2, 'PW Whiskey', 'pl-wx', null, 5, '2026-10-18 16:00:00+00', 41) $$),
  'P0001: waiver_claim_submit: PL WX (Thu) (pl-wx) is locked for adds — kicked off at 2026-10-16T00:15:00+00:00 (stat_line); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
  'D1 Q74 per player: a NEW claim on WX (played Thursday, since traded to a Sunday team) is refused at submit, the same words as the pickup lock');
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by) values
 ('d1570000-0000-4000-8000-000000000001', pg_temp.lg(2), pg_temp.team('PW Whiskey'), 'pl-wz', null,     4,  1, pg_temp.act(42), '91570000-0000-4000-8000-000000000002'),
 ('d1570000-0000-4000-8000-000000000002', pg_temp.lg(2), pg_temp.team('PW Whiskey'), 'pl-wy', 'pl-w1', 10, 2, pg_temp.act(43), '91570000-0000-4000-8000-000000000002'),
 ('d1570000-0000-4000-8000-000000000003', pg_temp.lg(2), pg_temp.team('PW Yankee'),  'pl-wy', null,     3,  1, pg_temp.act(44), '91570000-0000-4000-8000-000000000003');
insert into r105 select 'D2', public.process_waivers_internal(pg_temp.lg(2), '2026-10-18 16:00:00+00');
select is(
  (select string_agg(right(c.id::text, 1) || '=' || c.status || ':' || coalesce(c.result_reason, '-'), ' ' order by c.id)
   from waiver_claims c where c.league_id = pg_temp.lg(2)),
  '1=invalid:add_locked 2=invalid:drop_locked 3=won:-',
  'D2 the Sunday-12:00 run: the claim for WZ (played, RELEASED — the old run judged teams and skipped a player with none) fails add_locked; the claim dropping W One (played, traded) fails drop_locked; the $3 claim for WY (Sunday, not played) wins');
select is(
  format('%s|%s || %s', pg_temp.roster_of('pl-w1'), pg_temp.roster_of('pl-wz'), pg_temp.lu('PW Whiskey', 6)),
  'PW Whiskey|(none) || {"qb:0": "pl-w1"} | pl-w1,- | ["pl-w2"]',
  'D3 …so W One stays on PW Whiskey and in its week-6 start, WZ joins nobody');

-- ---------------------------------------------------------------------------
-- G. The commissioner stands outside the lock (timing) — and the lock stays
-- ---------------------------------------------------------------------------
select pg_temp.as_user(1);
select pg_temp.try('G1', $$ insert into r105 select 'G1', public.commish_roster_override_internal(pg_temp.lg(1), pg_temp.team('PL Delta'), null, 'pl-d1', null, null, null,
  pg_temp.act(51), '2026-10-18 16:10:00+00', 'pgtap 105', 'commish_force_add_drop') $$);
select set_config('request.jwt.claims', '', true);
select is(
  format('%s|%s', coalesce((select r ->> 'error' from r105 where tag = 'G1'), 'ok'), pg_temp.roster_of('pl-d1')),
  'ok|(none)',
  'G1 NOT BOUND: the commissioner''s force-drop of D One goes through at Sunday 12:10 — the timing rules never bind him (§10; F440 as ruled clears the start and re-scores)');
select is(
  pg_temp.err($$ select pg_temp.ad('G2', 4, 'PL Echo', 'pl-d1', 'pl-e1', '2026-10-18 16:11:00+00', 10) $$),
  'P0001: roster_add_drop: PL D One (Thu) (pl-d1) is locked for adds — kicked off at 2026-10-16T00:15:00+00:00 (stat_line); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
  'G2 …and the lock does not leave with his start: another manager still cannot add him this week (his stat line says he played)');

select * from finish();
rollback;
