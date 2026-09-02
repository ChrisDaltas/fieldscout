-- ============================================================================
-- The clock is live in a mock — migration 101 (task MS.3; spec §8.7's v2.15
-- pause-first carve-out + §8.8; E15/E76; D219; PROGRESS D260). pgTAP file is
-- **049** (048 = MS.2's launcher gate; next free confirmed at task time with
-- `ls supabase/tests`).
--
-- WHAT THIS FILE PINS (tasks-MS §5 MS.3 item 8, clause by clause):
--   * §A FORM: 101's carve-out predicate in the gate's prosrc (the break
--     probe's target); both pause-first sentences still verbatim in the
--     gate; draft_set_clock's 100/E75 stays-shut sentence GONE from prosrc.
--   * §B SNAKE MOCK, RUNNING: the launcher edits the pick clock with NO
--     pause (stored literal); the RUNNING deadline is untouched by the
--     edit and the NEXT pick takes the new value at the exact boundary
--     instant (E15/D146 — txn-frozen now() makes the instants exact);
--     §4 rule 10's whole-row composite over the REAL league around the
--     edit, incl. the league:<id> broadcast topic (D218(6)).
--   * §C AUCTION MOCK, RUNNING: all three §7.3.8 timers land unpaused as
--     stored literals; the running nomination deadline untouched; the next
--     BID window opens at the NEW bid seconds (E76's own example); and R556 —
--     a MID-BID-WINDOW edit leaves the running window byte-untouched while
--     the NEXT bid's anti-snipe floor uses the NEW value (the floor reads
--     config live at bid time, by design — 087/D128).
--   * §D REAL DRAFTS DO NOT CHANGE (§4 rule 13): a running real snake and
--     a running real auction still refuse with the byte-identical
--     §8.7 v2.12.5 / v2.10 sentences — the probe reddens exactly these.
--   * §E THE OTHER FIVE stay shut on a RUNNING mock: the gate's own arm
--     per-verb (called directly — the D219(2) structure beneath the E75
--     fronting arms) and the E75 arms as the launcher.
--   * §F the two extend_current MOCK sentences (state-neutral, E15) as
--     stored literals; the machinery stays retired.
--   * §G STANDALONE: the same carve-out through the same gates; the chat
--     post carries a NULL league_id (095 banner item 3(b)); non-launchers
--     get the 42501 no-leak.
--   * §H identity on the league mock: commissioner and fellow member get
--     the launcher-gate P0001 (no bypass, D103(2)); outsider 42501.
-- ============================================================================
begin;
select plan(50);

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosrc like '%AND NOT (p_draft.is_mock AND p_verb = ''draft_set_clock'')%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_auction_pause_gate_internal'),
  'the 101 carve-out predicate is in the gate''s BODY — is_mock AND this verb, never the consumer set (D219(4); the break probe widens exactly this term)');
select ok(
  (select p.prosrc like '%pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)%'
      and p.prosrc like '%pause the draft first — commissioner controls run on a paused board (§8.7 v2.12.5)%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_auction_pause_gate_internal'),
  '…and both refusal sentences are byte-identical to 090''s (036:417–418''s twin — the UI mirror clauses cannot drift)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc like '%clock edits are not open in a practice yet%'),
  0,
  'the 100/E75 stays-shut sentence for the clock is GONE from every deployed body — the refusal retired WITH the behaviour (§4 rule 11: 048''s count pin re-pointed to ten, this pins the specific retirement)');

-- ---------------------------------------------------------------------------
-- Fixtures: mirrors 048's worlds, but the REAL drafts are LIVE (running) —
-- §D needs the pause-first refusal, not the scheduled arm. u1 commissions,
-- u2 launches every mock (human seat = their own t2, FIRST in the mock
-- orders so the boundary picks are the human's), u3 member, u4 outsider.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('90490000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-ms3-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "ms3_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 4) i;

insert into players (id, full_name, position, adp)
select 'ms3-rb' || lpad(i::text, 2, '0'), 'MS3 RB ' || lpad(i::text, 2, '0'), 'RB',
       0.520 + i / 1000.0
from generate_series(1, 5) i;
insert into players (id, full_name, position, adp) values
  ('ms3-k01', 'MS3 K 01', 'K', 0.990);

-- 110/L.D1.2 (F143): a drafting+ league must REFERENCE a scoring system (§7.3.8's other half — the guard now refuses a NULL scoring_system_id in drafting+); this fixture's reference is a template. A fixture change forced by 110, not a drive-by.
insert into leagues (id, owner_id, name, season, status, team_count,
                     scoring_system_id, settings, scoring_rules_snapshot)
values
  ('b0490000-0000-4000-8000-0000000000aa', '90490000-0000-4000-8000-000000000001',
   'pgtap-ms3-snake', 2026, 'drafting', 8, (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "pick_timer_seconds": 90, "disconnect_grace_seconds": 30}}'::jsonb, '{}'::jsonb),
  ('b0490000-0000-4000-8000-0000000000bb', '90490000-0000-4000-8000-000000000001',
   'pgtap-ms3-auction', 2026, 'drafting', 8, (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "auction_budget": 200,
      "auction_zero_dollar_nominations": false, "auction_nomination_seconds": 45,
      "auction_bid_seconds": 30, "auction_anti_snipe_seconds": 10,
      "disconnect_grace_seconds": 30, "pick_timer_seconds": 90}}'::jsonb, '{}'::jsonb);

update leagues
set roster_settings = '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                        "bench": 2, "ir_slots": [], "swap_spots": 0}'::jsonb
where name like 'pgtap-ms3-%';

insert into teams (id, owner_id, name, league_id)
select ('d0490000-0000-4000-8000-00' || w.sfx || '0000000' || i)::uuid,
       '90490000-0000-4000-8000-000000000001',
       'pgtap-ms3-' || w.sfx || '-t' || i,
       ('b0490000-0000-4000-8000-0000000000' || w.sfx)::uuid
from (values ('aa'), ('bb')) as w(sfx), generate_series(1, 8) i;

insert into league_members (league_id, user_id, team_id, role)
select ('b0490000-0000-4000-8000-0000000000' || w.sfx)::uuid,
       ('90490000-0000-4000-8000-00000000000' || m.u)::uuid,
       ('d0490000-0000-4000-8000-00' || w.sfx || '0000000' || m.t)::uuid,
       m.r
from (values ('aa'), ('bb')) as w(sfx),
     (values (1, 1, 'commissioner'), (2, 2, 'manager'), (3, 3, 'manager')) as m(u, t, r);

-- Two REAL drafts, LIVE (running — the §D refusals need the gate to fire),
-- two league-attached MOCKS (live, launched_by u2, human seat t2 FIRST in
-- the order), one standalone mock. The mock configs carry the 094 roster
-- snapshot (a mock never re-hydrates — D95).
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    draft_order, nomination_order, total_rounds, current_round,
                    current_pick_number, on_clock_team_id, current_deadline, started_at)
values
  ('e0490000-0000-4000-8000-0000000000aa', 'b0490000-0000-4000-8000-0000000000aa',
   'snake', 'live', false,
   '{"pick_timer_seconds": 90}'::jsonb,
   (select jsonb_agg(t.id order by t.name) from teams t
     where t.league_id = 'b0490000-0000-4000-8000-0000000000aa'),
   null, 3, 1, 1, 'd0490000-0000-4000-8000-00aa00000001', now() + interval '30 minutes', now()),
  ('e0490000-0000-4000-8000-0000000000ab', 'b0490000-0000-4000-8000-0000000000aa',
   'snake', 'live', true,
   '{"pick_timer_seconds": 90,
     "roster": {"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                "bench": 2, "ir_slots": [], "swap_spots": 0},
     "mock": {"human_team_id": "d0490000-0000-4000-8000-00aa00000002",
              "cpu_speed": "fast",
              "launched_by": "90490000-0000-4000-8000-000000000002"}}'::jsonb,
   '["d0490000-0000-4000-8000-00aa00000002", "d0490000-0000-4000-8000-00aa00000001",
     "d0490000-0000-4000-8000-00aa00000003", "d0490000-0000-4000-8000-00aa00000004",
     "d0490000-0000-4000-8000-00aa00000005", "d0490000-0000-4000-8000-00aa00000006",
     "d0490000-0000-4000-8000-00aa00000007", "d0490000-0000-4000-8000-00aa00000008"]'::jsonb,
   null, 3, 1, 1, 'd0490000-0000-4000-8000-00aa00000002', now() + interval '1 hour', now()),
  ('e0490000-0000-4000-8000-0000000000ba', 'b0490000-0000-4000-8000-0000000000bb',
   'auction', 'live', false,
   '{"auction_budget": 200, "auction_zero_dollar_nominations": false,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "pick_timer_seconds": 90}'::jsonb,
   (select jsonb_agg(t.id order by t.name) from teams t
     where t.league_id = 'b0490000-0000-4000-8000-0000000000bb'),
   (select jsonb_agg(t.id order by t.name) from teams t
     where t.league_id = 'b0490000-0000-4000-8000-0000000000bb'),
   3, 1, 1, 'd0490000-0000-4000-8000-00bb00000001', now() + interval '30 minutes', now()),
  ('e0490000-0000-4000-8000-0000000000bb', 'b0490000-0000-4000-8000-0000000000bb',
   'auction', 'live', true,
   '{"auction_budget": 200, "auction_zero_dollar_nominations": false,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "pick_timer_seconds": 90,
     "roster": {"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                "bench": 2, "ir_slots": [], "swap_spots": 0},
     "mock": {"human_team_id": "d0490000-0000-4000-8000-00bb00000002",
              "cpu_speed": "fast",
              "launched_by": "90490000-0000-4000-8000-000000000002"}}'::jsonb,
   '["d0490000-0000-4000-8000-00bb00000002", "d0490000-0000-4000-8000-00bb00000001",
     "d0490000-0000-4000-8000-00bb00000003", "d0490000-0000-4000-8000-00bb00000004",
     "d0490000-0000-4000-8000-00bb00000005", "d0490000-0000-4000-8000-00bb00000006",
     "d0490000-0000-4000-8000-00bb00000007", "d0490000-0000-4000-8000-00bb00000008"]'::jsonb,
   '["d0490000-0000-4000-8000-00bb00000002", "d0490000-0000-4000-8000-00bb00000001",
     "d0490000-0000-4000-8000-00bb00000003", "d0490000-0000-4000-8000-00bb00000004",
     "d0490000-0000-4000-8000-00bb00000005", "d0490000-0000-4000-8000-00bb00000006",
     "d0490000-0000-4000-8000-00bb00000007", "d0490000-0000-4000-8000-00bb00000008"]'::jsonb,
   3, 1, 1, 'd0490000-0000-4000-8000-00bb00000002', now() + interval '1 hour', now()),
  ('e0490000-0000-4000-8000-0000000000cc', null,
   'snake', 'live', true,
   '{"pick_timer_seconds": 90,
     "roster": {"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                "bench": 2, "ir_slots": [], "swap_spots": 0},
     "mock": {"cpu_speed": "fast",
              "launched_by": "90490000-0000-4000-8000-000000000002"}}'::jsonb,
   '[]'::jsonb, null, 1, 1, 1, null, now() + interval '1 hour', now());

-- ---------------------------------------------------------------------------
-- B. Snake mock, RUNNING: the unpaused edit, the untouched deadline, the
--    E15 boundary, and §4 rule 10's composite over the REAL league
-- ---------------------------------------------------------------------------
create temp table ms3_league_before as
  select * from leagues where id = 'b0490000-0000-4000-8000-0000000000aa';
create temp table ms3_real_before as
  select * from drafts where id = 'e0490000-0000-4000-8000-0000000000aa';
create temp table ms3_teams_before as
  select * from teams where league_id = 'b0490000-0000-4000-8000-0000000000aa';
create temp table ms3_members_before as
  select * from league_members where league_id = 'b0490000-0000-4000-8000-0000000000aa';
create temp table ms3_counts_before as
  select (select count(*) from team_managers) as managers,
         (select count(*) from league_rosters) as rosters,
         (select count(*) from league_invites) as invites,
         (select count(*) from league_weeks)   as weeks,
         (select count(*) from league_lists)   as lists,
         (select count(*) from notifications)  as notifications,
         (select count(*) from league_chat
           where league_id = 'b0490000-0000-4000-8000-0000000000aa'
             and context is distinct from 'draft:e0490000-0000-4000-8000-0000000000ab') as league_chat_outside_mock,
         (select count(*) from realtime.messages
           where topic = 'league:b0490000-0000-4000-8000-0000000000aa') as league_topic_msgs;
create temp table ms3_mock_clock_before as
  select on_clock_team_id, current_deadline from drafts
  where id = 'e0490000-0000-4000-8000-0000000000ab';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90490000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_clock('e0490000-0000-4000-8000-0000000000ab', 7) $$,
  'THE CARVE-OUT (E76): the launcher shortens the pick clock on a RUNNING mock with NO pause — pre-101 this exact call refused (048 pinned it shut by name)');
reset role;
select is(
  (select config->>'pick_timer_seconds'
   from drafts where id = 'e0490000-0000-4000-8000-0000000000ab'),
  '7',
  'the new timer lands in drafts.config as a stored literal (the D95 snapshot is the live room''s authority)');
select is(
  (select to_jsonb(y) from (
     select on_clock_team_id, current_deadline from drafts
     where id = 'e0490000-0000-4000-8000-0000000000ab') y),
  (select to_jsonb(b) from ms3_mock_clock_before b),
  'E15''s first half: the RUNNING deadline and the on-clock seat are untouched by the edit — the current clock is never rewritten');
select is(
  (select count(*)::int from league_chat
   where context = 'draft:e0490000-0000-4000-8000-0000000000ab'
     and message like 'Pick clock set to 7 seconds by %(applies to upcoming picks).'),
  1,
  '…and the D97 system post lands in the MOCK''s own chat context with the shipped wording');

-- The E15 boundary instant (D146): the human''s pick is made and the NEXT
-- clock opens at exactly now() + 7s — the new value, not the old 90.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90490000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_make_pick('e0490000-0000-4000-8000-0000000000ab', 'ms3-rb01',
       'a0490000-0000-4000-8000-000000000001') $$,
  'the launcher makes the human pick that closes the edited-under window');
reset role;
select is(
  (select current_deadline from drafts where id = 'e0490000-0000-4000-8000-0000000000ab'),
  now() + interval '7 seconds',
  'E15''s second half, AT THE BOUNDARY INSTANT: the next pick''s clock is exactly now() + 7s — the NEW value governs the next window (txn-frozen now() makes this exact)');
select isnt(
  (select current_deadline from drafts where id = 'e0490000-0000-4000-8000-0000000000ab'),
  now() + interval '90 seconds',
  '…and it is NOT the old 90s — the edit took effect at the very next clock, one window after the edit, never the running one (D146''s either-side check)');

-- §4 rule 10: the real league around the edit + pick, whole-row.
select is(
  (select count(*)::int from (
     select * from leagues where id = 'b0490000-0000-4000-8000-0000000000aa'
     except all select * from ms3_league_before) x),
  0,
  'ISOLATION (§4 rule 10): the whole leagues row is byte-identical around the unpaused clock edit + pick');
select is(
  (select count(*)::int from (
     select * from drafts where id = 'e0490000-0000-4000-8000-0000000000aa'
     except all select * from ms3_real_before) x),
  0,
  '…the REAL live snake draft''s whole row too — its own 30-minute clock untouched by the mock''s 7s');
select is(
  (select count(*)::int from (
     (select * from teams where league_id = 'b0490000-0000-4000-8000-0000000000aa'
      except all select * from ms3_teams_before)
     union all
     (select * from ms3_teams_before
      except all select * from teams where league_id = 'b0490000-0000-4000-8000-0000000000aa')) x),
  0,
  '…every teams row, whole-row both directions (a count cannot see an in-place UPDATE — D218(6))');
select is(
  (select count(*)::int from (
     (select * from league_members where league_id = 'b0490000-0000-4000-8000-0000000000aa'
      except all select * from ms3_members_before)
     union all
     (select * from ms3_members_before
      except all select * from league_members where league_id = 'b0490000-0000-4000-8000-0000000000aa')) x),
  0,
  '…every league_members row');
select is(
  (select to_jsonb(y) from (
     select (select count(*) from team_managers) as managers,
            (select count(*) from league_rosters) as rosters,
            (select count(*) from league_invites) as invites,
            (select count(*) from league_weeks)   as weeks,
            (select count(*) from league_lists)   as lists,
            (select count(*) from notifications)  as notifications,
            (select count(*) from league_chat
              where league_id = 'b0490000-0000-4000-8000-0000000000aa'
                and context is distinct from 'draft:e0490000-0000-4000-8000-0000000000ab') as league_chat_outside_mock,
            (select count(*) from realtime.messages
              where topic = 'league:b0490000-0000-4000-8000-0000000000aa') as league_topic_msgs) y),
  (select to_jsonb(b) from ms3_counts_before b),
  '…and the remaining league-scoped surfaces are unmoved, INCLUDING the league:<id> broadcast topic (D218(6)''s third dimension)');

-- ---------------------------------------------------------------------------
-- C. Auction mock, RUNNING: three timers, no pause; deadline untouched;
--    the next BID window opens at the NEW bid seconds (E76''s example)
-- ---------------------------------------------------------------------------
create temp table ms3_au_real_before as
  select * from drafts where id = 'e0490000-0000-4000-8000-0000000000ba';
create temp table ms3_au_mock_clock_before as
  select on_clock_team_id, current_deadline from drafts
  where id = 'e0490000-0000-4000-8000-0000000000bb';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90490000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_clock('e0490000-0000-4000-8000-0000000000bb',
       null, false, null, 6, 5, 2) $$,
  'all three §7.3.8 auction timers edited on the RUNNING mock in one unpaused call — nomination 6s, bid 5s, anti-snipe 2s');
reset role;
select is(
  (select (config->>'auction_nomination_seconds') || '|' ||
          (config->>'auction_bid_seconds') || '|' ||
          (config->>'auction_anti_snipe_seconds')
   from drafts where id = 'e0490000-0000-4000-8000-0000000000bb'),
  '6|5|2',
  'all three land in drafts.config as stored literals');
select is(
  (select to_jsonb(y) from (
     select on_clock_team_id, current_deadline from drafts
     where id = 'e0490000-0000-4000-8000-0000000000bb') y),
  (select to_jsonb(b) from ms3_au_mock_clock_before b),
  'the RUNNING nomination window is untouched by the edit (E15 — never the current clock)');
select is(
  (select count(*)::int from league_chat
   where context = 'draft:e0490000-0000-4000-8000-0000000000bb'
     and message like 'Auction clocks updated by %(applies to upcoming nominations).'),
  1,
  '…and the system post lands in the mock''s own chat context');
-- The boundary: the human nominates a KICKER (no CPU will answer — D163/
-- R406, the 038 idiom) and the BID window opens at the NEW 5 seconds.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90490000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_nominate('e0490000-0000-4000-8000-0000000000bb', 'ms3-k01', 3,
       'a0490000-0000-4000-8000-000000000002') $$,
  'the launcher nominates on the human seat — the first clock formed after the edit');
reset role;
select is(
  (select current_deadline from drafts where id = 'e0490000-0000-4000-8000-0000000000bb'),
  now() + interval '5 seconds',
  'THE E76 EXAMPLE, AT THE INSTANT: the bid window opens at exactly now() + 5s — the shortened bid clock governs the NEXT window');
select isnt(
  (select current_deadline from drafts where id = 'e0490000-0000-4000-8000-0000000000bb'),
  now() + interval '30 seconds',
  '…and not the old 30s (D146''s either-side check)');
select is(
  (select count(*)::int from (
     select * from drafts where id = 'e0490000-0000-4000-8000-0000000000ba'
     except all select * from ms3_au_real_before) x),
  0,
  'ISOLATION: the REAL live auction draft''s whole row is byte-identical around the mock''s clock edit + nomination');

-- R556 — THE SHARPEST CORNER 101 CREATED, PINNED. The anti-snipe floor
-- reads config LIVE at bid time (draft_place_bid_internal, 087/D128 shape:
-- GREATEST(standing deadline, now() + anti_snipe)) — uniform with real
-- drafts after a paused edit, so BY DESIGN, but 101 is the first migration
-- to make it reachable with NO pause on a LIVE bid window. Two pins:
-- (1) a mid-BID-window edit leaves the running window byte-untouched
-- (E15's rule holds at the edit); (2) the NEXT bid's floor uses the NEW
-- value (the live read, stated as the contract rather than discovered).
create temp table ms3_au_bid_window_before as
  select on_clock_team_id, current_deadline, current_nomination from drafts
  where id = 'e0490000-0000-4000-8000-0000000000bb';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90490000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_clock('e0490000-0000-4000-8000-0000000000bb',
       null, false, null, null, null, 40) $$,
  'R556 scaffold: the launcher raises anti-snipe 2 -> 40 MID-BID-WINDOW, unpaused (the E76 scenario walked one step further)');
reset role;
select is(
  (select to_jsonb(y) from (
     select on_clock_team_id, current_deadline, current_nomination from drafts
     where id = 'e0490000-0000-4000-8000-0000000000bb') y),
  (select to_jsonb(b) from ms3_au_bid_window_before b),
  'R556 pin 1: the RUNNING bid window is byte-untouched by the mid-window edit — still now()+5s, the nomination unchanged (E15 at the edit; the probe that floors the window at EDIT time reddens exactly this)');
-- The next bid: t3 raises to $4 through the internal writer (client bids
-- are launcher-only on a mock; the internal is the CPU/service path and is
-- what the reviewer probed — REVOKEd from clients, callable here as
-- postgres, the 048/049 direct-call idiom).
select lives_ok(
  $$ select public.draft_place_bid_internal('e0490000-0000-4000-8000-0000000000bb',
       'd0490000-0000-4000-8000-00bb00000003', 4,
       'a0490000-0000-4000-8000-000000000003', 'CPU') $$,
  'R556 scaffold: the next bid lands on the running window');
select is(
  (select current_deadline from drafts where id = 'e0490000-0000-4000-8000-0000000000bb'),
  now() + interval '40 seconds',
  'R556 pin 2: the bid''s anti-snipe floor is GREATEST(standing now()+5s, now() + THE NEW 40s) = now()+40s — the floor reads config LIVE at bid time, by design (087/D128; the stale-read probe reddens exactly this)');
select isnt(
  (select current_deadline from drafts where id = 'e0490000-0000-4000-8000-0000000000bb'),
  now() + interval '2 seconds',
  '…and NOT the old 2s floor (D146''s either-side check)');
select is(
  (select count(*)::int from (
     select * from drafts where id = 'e0490000-0000-4000-8000-0000000000ba'
     except all select * from ms3_au_real_before) x),
  0,
  '…and the REAL auction''s whole row is STILL byte-identical after the mid-window edit + floored bid (rule 10 re-closed over the new path)');

-- ---------------------------------------------------------------------------
-- D. Real drafts do not change (§4 rule 13): the byte-identical refusals
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90490000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_clock('e0490000-0000-4000-8000-0000000000aa', 60) $$,
  'P0001',
  'draft_set_clock: pause the draft first — commissioner controls run on a paused board (§8.7 v2.12.5)',
  'a RUNNING REAL snake draft still refuses the commissioner with the byte-identical v2.12.5 sentence — the carve-out is is_mock, never draft_type (E76; the break probe reddens this pin)');
select throws_ok(
  $$ select public.draft_set_clock('e0490000-0000-4000-8000-0000000000ba',
       null, false, null, 20, 15, 5) $$,
  'P0001',
  'draft_set_clock: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
  '…and a RUNNING REAL auction the byte-identical v2.10 sentence, on the identical three-timer edit that just succeeded on the mock');
reset role;

-- ---------------------------------------------------------------------------
-- E. The other five gate consumers stay shut on a RUNNING mock — both the
--    gate''s own arm (D219(2), structural) and the fronting E75 arms
-- ---------------------------------------------------------------------------
-- The gate itself, called directly as postgres: on the RUNNING mock row it
-- still refuses every verb except draft_set_clock. This is the pin that
-- fails if the carve-out is ever widened to `NOT p_draft.is_mock` alone —
-- the shape §8.7 v2.15 forbids ("covers draft_set_clock only").
select throws_ok(
  $$ select public.draft_auction_pause_gate_internal(d, 'draft_undo')
     from public.drafts d where d.id = 'e0490000-0000-4000-8000-0000000000ab' $$,
  'P0001',
  'draft_undo: pause the draft first — commissioner controls run on a paused board (§8.7 v2.12.5)',
  'the gate''s own arm still refuses draft_undo on the RUNNING mock — pause-first survives IN THE GATE for the other five, beneath the E75 fronting arms (D219(2))');
select throws_ok(
  $$ select public.draft_auction_pause_gate_internal(d, 'draft_reverse_won_bid')
     from public.drafts d where d.id = 'e0490000-0000-4000-8000-0000000000bb' $$,
  'P0001',
  'draft_reverse_won_bid: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
  '…and draft_reverse_won_bid on the running auction mock, with the auction sentence');
select lives_ok(
  $$ select public.draft_auction_pause_gate_internal(d, 'draft_set_clock')
     from public.drafts d where d.id = 'e0490000-0000-4000-8000-0000000000ab' $$,
  '…while draft_set_clock passes the same gate on the same running mock row — the carve-out is exactly one verb wide');
select throws_ok(
  $$ select public.draft_auction_pause_gate_internal(d, 'draft_set_clock')
     from public.drafts d where d.id = 'e0490000-0000-4000-8000-0000000000aa' $$,
  'P0001',
  'draft_set_clock: pause the draft first — commissioner controls run on a paused board (§8.7 v2.12.5)',
  '…and the SAME verb on the running REAL draft row still refuses — both terms of the carve-out are load-bearing');

-- The launcher, over the RPCs (the E75 fronting arms — unchanged by 101):
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90490000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_undo('e0490000-0000-4000-8000-0000000000ab') $$,
  'P0001', 'draft_undo: undo is not open in a practice yet (§8.8/E75)',
  'draft_undo: still shut on the running mock, by its own name');
select throws_ok(
  $$ select public.draft_reassign_pick('e0490000-0000-4000-8000-0000000000ab',
       'a0490000-0000-4000-8000-000000000099',
       p_team_id => 'd0490000-0000-4000-8000-00aa00000003') $$,
  'P0001', 'draft_reassign_pick: pick edits are not open in a practice yet (§8.8/E75)',
  'draft_reassign_pick: still shut');
select throws_ok(
  $$ select public.draft_move_player('e0490000-0000-4000-8000-0000000000ab', 'ms3-rb01',
       'd0490000-0000-4000-8000-00aa00000002', 'd0490000-0000-4000-8000-00aa00000003') $$,
  'P0001', 'draft_move_player: moving a drafted player is not open in a practice yet (§8.8/E75)',
  'draft_move_player: still shut');
select throws_ok(
  $$ select public.draft_reverse_won_bid('e0490000-0000-4000-8000-0000000000bb',
       'a0490000-0000-4000-8000-000000000099') $$,
  'P0001', 'draft_reverse_won_bid: reversing a won bid is not open in a practice yet (§8.8/E75)',
  'draft_reverse_won_bid: still shut');
select throws_ok(
  $$ select public.draft_cancel_nomination('e0490000-0000-4000-8000-0000000000bb') $$,
  'P0001', 'draft_cancel_nomination: cancelling a nomination is not open in a practice yet (§8.8/E75)',
  'draft_cancel_nomination: still shut');
reset role;

-- ---------------------------------------------------------------------------
-- F. The two extend_current MOCK sentences (state-neutral — true running
--    or paused); the real sentences are pinned untouched in 023/036
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90490000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_clock('e0490000-0000-4000-8000-0000000000ab', 45, true) $$,
  'P0001',
  'draft_set_clock: the pick clock cannot be extended in place — the current clock is never rewritten, and the new timer applies to upcoming picks (E15 / §8.7 v2.15)',
  'the SNAKE mock extend refusal: the shipped sentence presupposed a pause the mock no longer needs — the mock path gets a true, state-neutral sentence; the machinery stays retired (090:291–303)');
select throws_ok(
  $$ select public.draft_set_clock('e0490000-0000-4000-8000-0000000000bb',
       null, true, null, null, 25, null) $$,
  'P0001',
  'draft_set_clock: an auction clock cannot be extended in place — the current clock is never rewritten, and the new timer applies to upcoming nominations (E15 / §8.7 v2.15)',
  '…and the AUCTION mock twin');
reset role;
select is(
  (select config->>'pick_timer_seconds'
   from drafts where id = 'e0490000-0000-4000-8000-0000000000ab'),
  '7',
  '…and the refused extend wrote NOTHING — the config still holds §B''s 7s');

-- ---------------------------------------------------------------------------
-- G. Standalone: the same carve-out through the same gates
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90490000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_clock('e0490000-0000-4000-8000-0000000000cc', 4) $$,
  'STANDALONE: the launcher edits their league-free practice''s clock, running, no pause — 095''s member floor + 100''s launcher arm + 101''s carve-out are uniform across both mock worlds');
reset role;
select is(
  (select config->>'pick_timer_seconds'
   from drafts where id = 'e0490000-0000-4000-8000-0000000000cc'),
  '4',
  'the standalone mock''s stored literal');
select is(
  (select count(*)::int from league_chat
   where context = 'draft:e0490000-0000-4000-8000-0000000000cc'
     and league_id is null
     and message like 'Pick clock set to 4 seconds by %(applies to upcoming picks).'),
  1,
  '…and the system post is WRITTEN with a NULL league_id (095 banner item 3(b)) — the room reads it back by context');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90490000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_clock('e0490000-0000-4000-8000-0000000000cc', 60) $$,
  '42501',
  'draft_set_clock: not a commissioner of this draft''s league',
  '…while a NON-LAUNCHER cannot tell the standalone mock exists — the member floor answers the same 42501 as a nonexistent draft (no-leak)');
reset role;

-- ---------------------------------------------------------------------------
-- H. Identity on the league mock: no bypass, no leak (D103(2))
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90490000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_clock('e0490000-0000-4000-8000-0000000000ab', 60) $$,
  'P0001',
  'draft_set_clock: only the member practicing this mock can use its commissioner controls (§8.8/D103)',
  'NO BYPASS: the league''s actual commissioner is refused the clock on somebody else''s mock — authority moved to the launcher, it is not shared');
select set_config('request.jwt.claims',
  '{"sub": "90490000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_clock('e0490000-0000-4000-8000-0000000000ab', 60) $$,
  'P0001',
  'draft_set_clock: only the member practicing this mock can use its commissioner controls (§8.8/D103)',
  '…and so is a fellow member');
select set_config('request.jwt.claims',
  '{"sub": "90490000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_clock('e0490000-0000-4000-8000-0000000000ab', 60) $$,
  '42501',
  'draft_set_clock: not a commissioner of this draft''s league',
  '…while an outsider gets the pre-100 42501 no-leak, byte-identical (§4 rule 13)');
reset role;

select * from finish();
rollback;
