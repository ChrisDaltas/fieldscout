-- ============================================================================
-- The launcher is the commissioner of their own mock — migration 100
-- (task MS.2; spec §8.8's v2.15 block + §8.7; E75; D217/D218/D222;
-- PROGRESS D259). pgTAP file is **048** (047 = budget-adjust idempotency;
-- next free confirmed at task time with `ls`).
--
-- WHAT THIS FILE PINS. 100's two gate changes at all eleven §8.7 RPC sites:
--   * THE GATE ORDER (D217(5)): member floor → (real ⇒ commissioner) →
--     (mock ⇒ launcher). Pre-100 `is_league_commish` fired first, so a
--     non-commissioner launcher got a bare 42501 and the friendly refusal
--     was unreachable. REAL drafts are byte-unchanged (§4 rule 13) — §C
--     re-proves the 42501 floor on a real draft against 023/036's text.
--   * THE LAUNCHER ARM (D226(3)'s one predicate): non-launchers —
--     commissioner included, D103(2) no bypass — get the friendly P0001.
--     The launcher reaches each verb's own answer: draft_set_order OPENS
--     (the only control whose route-level isolation was measured, MS.7/
--     D258); the others refuse with per-verb E75 reasons (the MS.1
--     audit is parked — tasks-MP §7 — and §8.8 v2.15 says enablement is
--     "settled by MEASUREMENT, per control, not by reading the code").
--
-- Falsifiability notes (§4.3):
--   * §A FORM: the helper's DEFINER/search_path/REVOKE posture; the ONE
--     predicate; ELEVEN callers by name; the retired class sentence in
--     ZERO deployed bodies (§4 rule 11's sweep, at the pg_proc layer).
--   * §B THE OPENED CONTROL, with §4 rule 10's composite: the launcher's
--     snake-mock order edit lands as stored literals, and around it the
--     real league is whole-row identical (leagues, the real draft, teams,
--     league_members via EXCEPT ALL; the remaining league-scoped tables by
--     count object; realtime `league:<id>` topic count unmoved — D218(6)'s
--     broadcast dimension). **Break probe 1 reddens §B/§C/§E's friendly-
--     refusal pins** (helper neutered ⇒ non-launchers fall through to the
--     per-verb refusals or the open body).
--   * §C IDENTITY: no-bypass (commissioner + member refused by name), the
--     42501 no-leak floor (outsider/nonexistent byte-identical to
--     pre-100), and the REAL-draft arm untouched — **break probe 2
--     (widening one real-draft arm) reddens 036 §M's 42501 pins**.
--   * §D THE TEN E75 REFUSALS, as the LAUNCHER, each message a stored
--     literal — the reason-naming contract E75 adds (auction-only verbs
--     are exercised on the SNAKE mock deliberately: the mock refusal must
--     precede the draft-type arm, or a launcher would learn about auction
--     controls from a snake practice).
--   * §E THE AUCTION ARM: nomination_order through the same RPC (§8.3's
--     other half — the F126 wire pin (e)'s SQL-layer twin), on_clock and
--     the running deadline untouched (087's no-recompute property).
--   * §F STANDALONE: shut with its own reason (the body's permutation
--     validation is league-derived — F128 carries the arm forward), and
--     the no-leak floor for a stranger.
-- ============================================================================
begin;
select plan(42);

-- ---------------------------------------------------------------------------
-- A. Form: the ONE gate helper, its posture, its eleven callers, and the
--    retired sentence swept to zero (tasks-M1 §4.1; §4 rule 11)
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     or p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_mock_launcher_gate_internal'),
  'draft_mock_launcher_gate_internal is SECURITY DEFINER with a pinned search_path (§4.1)');
select ok(
  (select not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_mock_launcher_gate_internal'),
  '…and REVOKEd from anon + authenticated — callable only from the DEFINER bodies');
select ok(
  (select p.prosrc like '%config->''mock''->>''launched_by'' IS DISTINCT FROM auth.uid()::text%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_mock_launcher_gate_internal'),
  'the ONE ownership predicate (D226(3)/R117): launched_by TEXT-compared to auth.uid() — NULL key fails closed for everyone');
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname <> 'draft_mock_launcher_gate_internal'
     and p.prosrc like '%draft_mock_launcher_gate_internal%'),
  array['draft_adjust_budget','draft_cancel_nomination','draft_end','draft_force_pick',
        'draft_move_player','draft_reassign_pick','draft_reset','draft_reverse_won_bid',
        'draft_set_clock','draft_set_order','draft_undo'],
  'ALL ELEVEN §8.7 sites call the helper — cleared AND excluded (D217(5): a reorder scoped to the cleared set would ship LAW the code cannot honour)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc like '%mock drafts have no commissioner controls%'),
  0,
  'the retired class sentence appears in ZERO deployed bodies — it stopped being true when order opened, and every shut control now names its own reason (§4 rule 11/E75)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc like '%draft_mock_launcher_gate_internal%'
     and p.prosrc like '%is_league_member(v_draft.league_id)%'
     and p.prosrc like '%is_standalone_mock_launcher(v_draft.id)%'
     and p.proname <> 'draft_mock_launcher_gate_internal'),
  11,
  'the member floor (league member OR standalone launcher) is present at all eleven sites — the pause idiom (069/095), one shape everywhere');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%(§8.8/E75)%'),
  10,
  'TEN bodies carry an E75 reason-naming refusal: the nine shut controls plus draft_set_order''s standalone arm (was eleven — 101/MS.3 retired draft_set_clock''s arm when the clock opened; the pin moved WITH the behaviour, §4 rule 11)');

-- ---------------------------------------------------------------------------
-- Fixtures: one snake world (real scheduled draft + live league-attached
-- mock launched by u2), one auction world (same shape), one standalone
-- mock. u1 commissions both leagues; u2 launches every mock; u3 is a plain
-- member; u4 is an outsider.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('90480000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-ms2-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "ms2_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 4) i;

insert into leagues (id, owner_id, name, season, status, team_count,
                     scoring_system_id, settings, scoring_rules_snapshot)
values
  ('b0480000-0000-4000-8000-0000000000aa', '90480000-0000-4000-8000-000000000001',
   'pgtap-ms2-snake', 2026, 'drafting', 8, null,
   '{"draft": {"draft_type": "snake", "pick_timer_seconds": 90, "disconnect_grace_seconds": 30}}'::jsonb, '{}'::jsonb),
  ('b0480000-0000-4000-8000-0000000000bb', '90480000-0000-4000-8000-000000000001',
   'pgtap-ms2-auction', 2026, 'drafting', 8, null,
   '{"draft": {"draft_type": "auction", "auction_budget": 200,
      "auction_zero_dollar_nominations": false, "auction_nomination_seconds": 45,
      "auction_bid_seconds": 30, "auction_anti_snipe_seconds": 10,
      "disconnect_grace_seconds": 30, "pick_timer_seconds": 90}}'::jsonb, '{}'::jsonb);

update leagues
set roster_settings = '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                        "bench": 2, "ir_slots": [], "swap_spots": 0}'::jsonb
where name like 'pgtap-ms2-%';

insert into teams (id, owner_id, name, league_id)
select ('d0480000-0000-4000-8000-00' || w.sfx || '0000000' || i)::uuid,
       '90480000-0000-4000-8000-000000000001',
       'pgtap-ms2-' || w.sfx || '-t' || i,
       ('b0480000-0000-4000-8000-0000000000' || w.sfx)::uuid
from (values ('aa'), ('bb')) as w(sfx), generate_series(1, 8) i;

insert into league_members (league_id, user_id, team_id, role)
select ('b0480000-0000-4000-8000-0000000000' || w.sfx)::uuid,
       ('90480000-0000-4000-8000-00000000000' || m.u)::uuid,
       ('d0480000-0000-4000-8000-00' || w.sfx || '0000000' || m.t)::uuid,
       m.r
from (values ('aa'), ('bb')) as w(sfx),
     (values (1, 1, 'commissioner'), (2, 2, 'manager'), (3, 3, 'manager')) as m(u, t, r);

-- The two REAL drafts (scheduled — the composites' untouched targets) and
-- the two league-attached MOCKS (live, launched_by u2 — D103(2)'s key).
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    draft_order, nomination_order, total_rounds, current_round,
                    current_pick_number, on_clock_team_id, current_deadline, started_at)
values
  ('e0480000-0000-4000-8000-0000000000aa', 'b0480000-0000-4000-8000-0000000000aa',
   'snake', 'scheduled', false,
   '{"pick_timer_seconds": 90}'::jsonb,
   (select jsonb_agg(t.id order by t.name) from teams t
     where t.league_id = 'b0480000-0000-4000-8000-0000000000aa'),
   null, 3, 1, 1, null, null, null),
  ('e0480000-0000-4000-8000-0000000000ab', 'b0480000-0000-4000-8000-0000000000aa',
   'snake', 'live', true,
   '{"pick_timer_seconds": 90,
     "mock": {"human_team_id": "d0480000-0000-4000-8000-00aa00000002",
              "cpu_speed": "fast",
              "launched_by": "90480000-0000-4000-8000-000000000002"}}'::jsonb,
   (select jsonb_agg(t.id order by t.name) from teams t
     where t.league_id = 'b0480000-0000-4000-8000-0000000000aa'),
   null, 3, 1, 1, 'd0480000-0000-4000-8000-00aa00000001', now() + interval '1 hour', now()),
  ('e0480000-0000-4000-8000-0000000000ba', 'b0480000-0000-4000-8000-0000000000bb',
   'auction', 'scheduled', false,
   '{"auction_budget": 200, "auction_zero_dollar_nominations": false,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "pick_timer_seconds": 90}'::jsonb,
   (select jsonb_agg(t.id order by t.name) from teams t
     where t.league_id = 'b0480000-0000-4000-8000-0000000000bb'),
   (select jsonb_agg(t.id order by t.name) from teams t
     where t.league_id = 'b0480000-0000-4000-8000-0000000000bb'),
   3, 1, 1, null, null, null),
  ('e0480000-0000-4000-8000-0000000000bb', 'b0480000-0000-4000-8000-0000000000bb',
   'auction', 'live', true,
   '{"auction_budget": 200, "auction_zero_dollar_nominations": false,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "pick_timer_seconds": 90,
     "mock": {"human_team_id": "d0480000-0000-4000-8000-00bb00000002",
              "cpu_speed": "fast",
              "launched_by": "90480000-0000-4000-8000-000000000002"}}'::jsonb,
   (select jsonb_agg(t.id order by t.name) from teams t
     where t.league_id = 'b0480000-0000-4000-8000-0000000000bb'),
   (select jsonb_agg(t.id order by t.name) from teams t
     where t.league_id = 'b0480000-0000-4000-8000-0000000000bb'),
   3, 1, 1, 'd0480000-0000-4000-8000-00bb00000001', now() + interval '1 hour', now()),
  ('e0480000-0000-4000-8000-0000000000cc', null,
   'snake', 'live', true,
   '{"pick_timer_seconds": 90,
     "mock": {"cpu_speed": "fast",
              "launched_by": "90480000-0000-4000-8000-000000000002"}}'::jsonb,
   '[]'::jsonb, null, 1, 1, 1, null, now() + interval '1 hour', now());

-- ---------------------------------------------------------------------------
-- B. The opened control: the LAUNCHER (u2 — a plain member, NOT the
--    commissioner) edits the snake mock's order, bracketed by §4 rule 10's
--    composite over the REAL league. Pre-100 this exact call answered
--    42501 (the gate-order bug); the composite is what makes the 200 legal.
-- ---------------------------------------------------------------------------
create temp table ms2_league_before as
  select * from leagues where id = 'b0480000-0000-4000-8000-0000000000aa';
create temp table ms2_real_before as
  select * from drafts where id = 'e0480000-0000-4000-8000-0000000000aa';
create temp table ms2_teams_before as
  select * from teams where league_id = 'b0480000-0000-4000-8000-0000000000aa';
create temp table ms2_members_before as
  select * from league_members where league_id = 'b0480000-0000-4000-8000-0000000000aa';
create temp table ms2_counts_before as
  select (select count(*) from team_managers) as managers,
         (select count(*) from league_rosters) as rosters,
         (select count(*) from league_invites) as invites,
         (select count(*) from league_weeks)   as weeks,
         (select count(*) from league_lists)   as lists,
         (select count(*) from notifications)  as notifications,
         (select count(*) from league_chat
           where league_id = 'b0480000-0000-4000-8000-0000000000aa'
             and context is distinct from 'draft:e0480000-0000-4000-8000-0000000000ab') as league_chat_outside_mock,
         (select count(*) from realtime.messages
           where topic = 'league:b0480000-0000-4000-8000-0000000000aa') as league_topic_msgs;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90480000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_order('e0480000-0000-4000-8000-0000000000ab', array[
       'd0480000-0000-4000-8000-00aa00000002', 'd0480000-0000-4000-8000-00aa00000001',
       'd0480000-0000-4000-8000-00aa00000003', 'd0480000-0000-4000-8000-00aa00000004',
       'd0480000-0000-4000-8000-00aa00000005', 'd0480000-0000-4000-8000-00aa00000006',
       'd0480000-0000-4000-8000-00aa00000007', 'd0480000-0000-4000-8000-00aa00000008']::uuid[]) $$,
  'THE ENABLEMENT PIN: the LAUNCHER — a plain member, not a commissioner — sets their own mock''s order (D222 parity; pre-100 this was the unreachable-refusal 42501)');
reset role;
select is(
  (select draft_order from drafts where id = 'e0480000-0000-4000-8000-0000000000ab'),
  '["d0480000-0000-4000-8000-00aa00000002", "d0480000-0000-4000-8000-00aa00000001",
    "d0480000-0000-4000-8000-00aa00000003", "d0480000-0000-4000-8000-00aa00000004",
    "d0480000-0000-4000-8000-00aa00000005", "d0480000-0000-4000-8000-00aa00000006",
    "d0480000-0000-4000-8000-00aa00000007", "d0480000-0000-4000-8000-00aa00000008"]'::jsonb,
  'the MOCK''s stored order is the launcher''s permutation, as a stored literal (t2 first — the launcher put themselves on the clock)');
select is(
  (select on_clock_team_id from drafts where id = 'e0480000-0000-4000-8000-0000000000ab'),
  'd0480000-0000-4000-8000-00aa00000002'::uuid,
  '…and the E31 live arm re-derived the on-clock seat from the new order at pick 1 (same engine, literally — §8.8)');
select is(
  (select count(*)::int from league_chat
   where context = 'draft:e0480000-0000-4000-8000-0000000000ab'
     and message like 'Draft order changed by %'),
  1,
  '…with the system line posted into the MOCK''s own chat context (D222(5): the negotiated-property line lands where the act happened, nowhere else)');
select is(
  (select count(*)::int from (
     select * from leagues where id = 'b0480000-0000-4000-8000-0000000000aa'
     except all select * from ms2_league_before) x),
  0,
  'ISOLATION (§4 rule 10): the whole leagues row is byte-identical around the launcher''s success');
select is(
  (select count(*)::int from (
     select * from drafts where id = 'e0480000-0000-4000-8000-0000000000aa'
     except all select * from ms2_real_before) x),
  0,
  '…the REAL scheduled draft''s whole row too — the R468 class, pinned at the SQL layer with both drafts alive in one league');
select is(
  (select count(*)::int from (
     (select * from teams where league_id = 'b0480000-0000-4000-8000-0000000000aa'
      except all select * from ms2_teams_before)
     union all
     (select * from ms2_teams_before
      except all select * from teams where league_id = 'b0480000-0000-4000-8000-0000000000aa')) x),
  0,
  '…every teams row, whole-row both directions (a count cannot see an in-place UPDATE — D218(6))');
select is(
  (select count(*)::int from (
     (select * from league_members where league_id = 'b0480000-0000-4000-8000-0000000000aa'
      except all select * from ms2_members_before)
     union all
     (select * from ms2_members_before
      except all select * from league_members where league_id = 'b0480000-0000-4000-8000-0000000000aa')) x),
  0,
  '…every league_members row (the autopick breach''s target table — unreached from here)');
select is(
  (select to_jsonb(y) from (
     select (select count(*) from team_managers) as managers,
            (select count(*) from league_rosters) as rosters,
            (select count(*) from league_invites) as invites,
            (select count(*) from league_weeks)   as weeks,
            (select count(*) from league_lists)   as lists,
            (select count(*) from notifications)  as notifications,
            (select count(*) from league_chat
              where league_id = 'b0480000-0000-4000-8000-0000000000aa'
                and context is distinct from 'draft:e0480000-0000-4000-8000-0000000000ab') as league_chat_outside_mock,
            (select count(*) from realtime.messages
              where topic = 'league:b0480000-0000-4000-8000-0000000000aa') as league_topic_msgs) y),
  (select to_jsonb(b) from ms2_counts_before b),
  '…and the remaining league-scoped surfaces are unmoved, INCLUDING the league:<id> broadcast topic (D218(6)''s third dimension) and league chat outside the mock''s context');

-- ---------------------------------------------------------------------------
-- C. Identity: no bypass, no leak, and the REAL draft byte-unchanged
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90480000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_order('e0480000-0000-4000-8000-0000000000ab', array[
       'd0480000-0000-4000-8000-00aa00000001', 'd0480000-0000-4000-8000-00aa00000002',
       'd0480000-0000-4000-8000-00aa00000003', 'd0480000-0000-4000-8000-00aa00000004',
       'd0480000-0000-4000-8000-00aa00000005', 'd0480000-0000-4000-8000-00aa00000006',
       'd0480000-0000-4000-8000-00aa00000007', 'd0480000-0000-4000-8000-00aa00000008']::uuid[]) $$,
  'P0001',
  'draft_set_order: only the member practicing this mock can use its commissioner controls (§8.8/D103)',
  'NO BYPASS (D103(2)): the league''s actual commissioner is refused on somebody else''s mock — authority moved to the launcher, it is not shared');
select set_config('request.jwt.claims',
  '{"sub": "90480000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_order('e0480000-0000-4000-8000-0000000000ab', array[
       'd0480000-0000-4000-8000-00aa00000001', 'd0480000-0000-4000-8000-00aa00000002',
       'd0480000-0000-4000-8000-00aa00000003', 'd0480000-0000-4000-8000-00aa00000004',
       'd0480000-0000-4000-8000-00aa00000005', 'd0480000-0000-4000-8000-00aa00000006',
       'd0480000-0000-4000-8000-00aa00000007', 'd0480000-0000-4000-8000-00aa00000008']::uuid[]) $$,
  'P0001',
  'draft_set_order: only the member practicing this mock can use its commissioner controls (§8.8/D103)',
  '…and so is a fellow member: one launcher, one driver (D103(2))');
select set_config('request.jwt.claims',
  '{"sub": "90480000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_order('e0480000-0000-4000-8000-0000000000ab', array[
       'd0480000-0000-4000-8000-00aa00000001']::uuid[]) $$,
  '42501',
  'draft_set_order: not a commissioner of this draft''s league',
  'an OUTSIDER answers the pre-100 42501 byte-identically — the member floor holds the no-leak line (§4 rule 13)');
select throws_ok(
  $$ select public.draft_set_order('e0480000-0000-4000-8000-000000000999', array[
       'd0480000-0000-4000-8000-00aa00000001']::uuid[]) $$,
  '42501',
  'draft_set_order: not a commissioner of this draft''s league',
  '…and a NONEXISTENT draft the same way (is_league_member(NULL) and is_standalone_mock_launcher(NULL) are both FALSE — fail closed)');
select set_config('request.jwt.claims',
  '{"sub": "90480000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_order('e0480000-0000-4000-8000-0000000000aa', array[
       'd0480000-0000-4000-8000-00aa00000001', 'd0480000-0000-4000-8000-00aa00000002',
       'd0480000-0000-4000-8000-00aa00000003', 'd0480000-0000-4000-8000-00aa00000004',
       'd0480000-0000-4000-8000-00aa00000005', 'd0480000-0000-4000-8000-00aa00000006',
       'd0480000-0000-4000-8000-00aa00000007', 'd0480000-0000-4000-8000-00aa00000008']::uuid[]) $$,
  '42501',
  'draft_set_order: not a commissioner of this draft''s league',
  'REAL DRAFTS DO NOT CHANGE (§4 rule 13): a member-but-not-commissioner on the real draft gets the identical pre-100 42501 — the floor passed them, the commissioner arm refused them, same sentence');
select set_config('request.jwt.claims',
  '{"sub": "90480000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_order('e0480000-0000-4000-8000-0000000000aa', array[
       'd0480000-0000-4000-8000-00aa00000008', 'd0480000-0000-4000-8000-00aa00000007',
       'd0480000-0000-4000-8000-00aa00000006', 'd0480000-0000-4000-8000-00aa00000005',
       'd0480000-0000-4000-8000-00aa00000004', 'd0480000-0000-4000-8000-00aa00000003',
       'd0480000-0000-4000-8000-00aa00000002', 'd0480000-0000-4000-8000-00aa00000001']::uuid[]) $$,
  '…and the COMMISSIONER''s real-draft edit still works exactly as shipped — the reorder moved the gates, not the authority');
reset role;
select is(
  (select draft_order from drafts where id = 'e0480000-0000-4000-8000-0000000000aa'),
  '["d0480000-0000-4000-8000-00aa00000008", "d0480000-0000-4000-8000-00aa00000007",
    "d0480000-0000-4000-8000-00aa00000006", "d0480000-0000-4000-8000-00aa00000005",
    "d0480000-0000-4000-8000-00aa00000004", "d0480000-0000-4000-8000-00aa00000003",
    "d0480000-0000-4000-8000-00aa00000002", "d0480000-0000-4000-8000-00aa00000001"]'::jsonb,
  '…landing on the REAL draft as a stored literal (the pre-start arm — "Draft order updated by")');

-- ---------------------------------------------------------------------------
-- D. The still-shut controls, as the LAUNCHER: each names ITS OWN
--    reason (E75). On the SNAKE mock deliberately — the mock refusal must
--    precede every draft-type arm. (Ten at MS.2; the clock opened with
--    101/MS.3 and its line below re-pointed to a lives_ok.)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90480000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_clock('e0480000-0000-4000-8000-0000000000ab', 60) $$,
  'draft_set_clock: OPEN since 101/MS.3 (the D219 carve-out this pin used to name as its owner) — the launcher edits the clock unpaused; 049 carries the full contract, this line re-points rather than deletes (§4 rule 11)');
select throws_ok(
  $$ select public.draft_undo('e0480000-0000-4000-8000-0000000000ab') $$,
  'P0001', 'draft_undo: undo is not open in a practice yet (§8.8/E75)',
  'draft_undo: shut by its own name');
select throws_ok(
  $$ select public.draft_reassign_pick('e0480000-0000-4000-8000-0000000000ab',
       'a0480000-0000-4000-8000-000000000099',
       p_team_id => 'd0480000-0000-4000-8000-00aa00000003') $$,
  'P0001', 'draft_reassign_pick: pick edits are not open in a practice yet (§8.8/E75)',
  'draft_reassign_pick: shut by its own name');
select throws_ok(
  $$ select public.draft_move_player('e0480000-0000-4000-8000-0000000000ab', 'ms2-rb01',
       'd0480000-0000-4000-8000-00aa00000001', 'd0480000-0000-4000-8000-00aa00000002') $$,
  'P0001', 'draft_move_player: moving a drafted player is not open in a practice yet (§8.8/E75)',
  'draft_move_player: shut by its own name');
select throws_ok(
  $$ select public.draft_force_pick('e0480000-0000-4000-8000-0000000000ab', 'ms2-rb01') $$,
  'P0001', 'draft_force_pick: picking for another seat is not open in a practice yet (§8.8/E75)',
  'draft_force_pick: shut by its own name (draft_complete_internal''s guard is unmeasured from this caller — tasks-MS §5 MS.1 item 5)');
select throws_ok(
  $$ select public.draft_reverse_won_bid('e0480000-0000-4000-8000-0000000000ab',
       'a0480000-0000-4000-8000-000000000099') $$,
  'P0001', 'draft_reverse_won_bid: reversing a won bid is not open in a practice yet (§8.8/E75)',
  'draft_reverse_won_bid: shut by its own name — and on a SNAKE mock, proving the mock arm precedes the auction-only arm');
select throws_ok(
  $$ select public.draft_adjust_budget('e0480000-0000-4000-8000-0000000000ab',
       'd0480000-0000-4000-8000-00aa00000002', 5) $$,
  'P0001', 'draft_adjust_budget: budget adjustments are not open in a practice yet (§8.8/E75)',
  'draft_adjust_budget: shut by its own name');
select throws_ok(
  $$ select public.draft_cancel_nomination('e0480000-0000-4000-8000-0000000000ab') $$,
  'P0001', 'draft_cancel_nomination: cancelling a nomination is not open in a practice yet (§8.8/E75)',
  'draft_cancel_nomination: shut by its own name');
select throws_ok(
  $$ select public.draft_end('e0480000-0000-4000-8000-0000000000ab') $$,
  'P0001', 'draft_end: a practice cannot be ended early — delete the practice instead (§8.8/E75)',
  'draft_end: shut by its own name, and the way out is named (delete_mock_draft — the served-another-way exit)');
select throws_ok(
  $$ select public.draft_reset('e0480000-0000-4000-8000-0000000000ab') $$,
  'P0001', 'draft_reset: a practice cannot be reset — delete it and start a new one (§8.8/E75)',
  'draft_reset: shut by its own name — the live-proven leagues writer stays with MS.4/D220');
reset role;

-- ---------------------------------------------------------------------------
-- E. The auction arm: nomination_order through the same RPC (§8.3), the
--    F126 pin (e)'s SQL-layer twin
-- ---------------------------------------------------------------------------
create temp table ms2_au_league_before as
  select * from leagues where id = 'b0480000-0000-4000-8000-0000000000bb';
create temp table ms2_au_real_before as
  select * from drafts where id = 'e0480000-0000-4000-8000-0000000000ba';
create temp table ms2_au_mock_clock_before as
  select on_clock_team_id, current_deadline from drafts
  where id = 'e0480000-0000-4000-8000-0000000000bb';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90480000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_order('e0480000-0000-4000-8000-0000000000bb', array[
       'd0480000-0000-4000-8000-00bb00000003', 'd0480000-0000-4000-8000-00bb00000001',
       'd0480000-0000-4000-8000-00bb00000002', 'd0480000-0000-4000-8000-00bb00000004',
       'd0480000-0000-4000-8000-00bb00000005', 'd0480000-0000-4000-8000-00bb00000006',
       'd0480000-0000-4000-8000-00bb00000007', 'd0480000-0000-4000-8000-00bb00000008']::uuid[]) $$,
  'the launcher edits their AUCTION mock''s NOMINATION order through the same RPC (§8.3''s other arm — D222''s parity covers both order kinds)');
reset role;
select is(
  (select nomination_order from drafts where id = 'e0480000-0000-4000-8000-0000000000bb'),
  '["d0480000-0000-4000-8000-00bb00000003", "d0480000-0000-4000-8000-00bb00000001",
    "d0480000-0000-4000-8000-00bb00000002", "d0480000-0000-4000-8000-00bb00000004",
    "d0480000-0000-4000-8000-00bb00000005", "d0480000-0000-4000-8000-00bb00000006",
    "d0480000-0000-4000-8000-00bb00000007", "d0480000-0000-4000-8000-00bb00000008"]'::jsonb,
  'the mock''s nomination_order holds the launcher''s permutation as a stored literal');
select is(
  (select to_jsonb(y) from (
     select on_clock_team_id, current_deadline from drafts
     where id = 'e0480000-0000-4000-8000-0000000000bb') y),
  (select to_jsonb(b) from ms2_au_mock_clock_before b),
  '…and neither the on-clock seat nor the running deadline moved — 087''s deliberate no-recompute (the seat mid-nomination keeps its turn; the new order takes effect at the next advance)');
select is(
  (select count(*)::int from league_chat
   where context = 'draft:e0480000-0000-4000-8000-0000000000bb'
     and message like 'Nomination order changed by %'),
  1,
  '…with the system line in the mock''s own chat context');
select is(
  (select count(*)::int from (
     select * from leagues where id = 'b0480000-0000-4000-8000-0000000000bb'
     except all select * from ms2_au_league_before) x),
  0,
  'ISOLATION: the auction league''s whole leagues row is byte-identical around the nomination-order edit');
select is(
  (select count(*)::int from (
     select * from drafts where id = 'e0480000-0000-4000-8000-0000000000ba'
     except all select * from ms2_au_real_before) x),
  0,
  '…and the REAL scheduled auction draft''s whole row too');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90480000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_order('e0480000-0000-4000-8000-0000000000bb', array[
       'd0480000-0000-4000-8000-00bb00000001', 'd0480000-0000-4000-8000-00bb00000002',
       'd0480000-0000-4000-8000-00bb00000003', 'd0480000-0000-4000-8000-00bb00000004',
       'd0480000-0000-4000-8000-00bb00000005', 'd0480000-0000-4000-8000-00bb00000006',
       'd0480000-0000-4000-8000-00bb00000007', 'd0480000-0000-4000-8000-00bb00000008']::uuid[]) $$,
  'P0001',
  'draft_set_order: only the member practicing this mock can use its commissioner controls (§8.8/D103)',
  'no bypass on the auction mock either — the commissioner is not the launcher');
reset role;

-- ---------------------------------------------------------------------------
-- F. Standalone: shut by its own reason; strangers learn nothing
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90480000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_order('e0480000-0000-4000-8000-0000000000cc', array[
       'd0480000-0000-4000-8000-00aa00000001']::uuid[]) $$,
  'P0001',
  'draft_set_order: a standalone practice cannot edit its order yet — delete it and launch a new one for a fresh order (§8.8/E75)',
  'a STANDALONE mock''s launcher passes the gate but the order editor refuses with its own reason — the permutation validation is league-derived, and the standalone arm is F128''s follow-up, not an exclusion');
select set_config('request.jwt.claims',
  '{"sub": "90480000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_order('e0480000-0000-4000-8000-0000000000cc', array[
       'd0480000-0000-4000-8000-00aa00000001']::uuid[]) $$,
  '42501',
  'draft_set_order: not a commissioner of this draft''s league',
  '…and a NON-LAUNCHER cannot tell the standalone mock exists: the member floor answers the same 42501 as a nonexistent draft (no-leak)');
reset role;

select * from finish();
rollback;
