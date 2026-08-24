-- ============================================================================
-- The engine reads its own config, not a league — migration 094 (task MP.2;
-- spec v2.16 §8.8 + §7.3.2/§7.3.3, **D95**; D234(8); tasks-MP §5 MP.2 and §4
-- rules 1–16). pgTAP file is **042** (041 = the uncontestable award; next free
-- confirmed at task time with `ls supabase/tests/`).
--
-- WHAT THIS FILE PINS, AND WHY IT DID NOT EXIST BEFORE.
--   §8.8/D95 promise that "a mock never re-hydrates": it snapshots the
--   league's settings at launch and is thereafter immune to edits. That was
--   true of the clocks, the type, the budget and every auction knob — and
--   FALSE of the ROSTER SHAPE, because `roster_settings` is a separate COLUMN
--   on `leagues` and the launch snapshot only ever copied `settings->'draft'`.
--   `draft_autopick_resolve` and `draft_mock_cpu_need` therefore went back to
--   the LIVE league for the slot shape on every autopick and every bot bid.
--   038's config pin could not see it: it asserted the DRAFT BLOCK, which was
--   complete. The hole was in what the block does not contain.
--
-- Falsifiability notes (§4.3 — every section names the defect it catches; the
-- shipped break probes are in the PR):
--   * §A THE SNAPSHOT EXISTS AND EQUALS ITS SOURCE. Reddens if
--     `create_mock_draft` stops writing `config->'roster'`, or writes
--     something other than the league's roster at launch. Also pins the
--     NEGATIVE: a REAL draft gets no `roster` key, because nothing reads one
--     (094 banner item 3).
--   * §B THE NO-CHANGE PIN, and it is the reason §C is not circular. On an
--     UNEDITED league the snapshot and the live league are the same object,
--     so the mock and a real draft in the same league must answer
--     IDENTICALLY. Every value here is what the pre-094 engine returned.
--   * §C THE D95 PIN — the defect this migration exists for. The league's
--     roster is edited mid-mock (QB seat → RB seat); the mock's answers must
--     not move. RED against the shipped bodies (the PR shows it), GREEN after.
--   * §D REAL DRAFTS KEEP THE LIVE READ, STATED AS A PIN RATHER THAN A
--     SENTENCE. The same edit DOES move an `is_mock = FALSE` draft's autopick.
--     094 deliberately does not decide snapshot-at-start for real drafts
--     (their settings edits go through D141's pause-first controls); this
--     section is what makes that decision visible and reversible on purpose
--     rather than by accident.
--   * §E THE SWEEP, AS A STRUCTURAL PIN (the 039 §A / 041 §6 shape). The
--     claim MP's whole lane rests on — "no live function on a mock's path
--     reads league settings" — is a `pg_proc` fact, so it is asserted as one.
--     `draft_mock_cpu_need` names no league AT ALL; `draft_autopick_resolve`
--     names one only inside its `is_mock = FALSE` arm.
--   * §F THE BOUNDARY (D146), computed from the SNAPSHOT. Greedy step d
--     engages when picks-remaining ≤ holes; one pick either side of that
--     instant is pinned, both on the same draft, so the FORCED 0 and the OPEN
--     0.5 for the same player discriminate the arm rather than the value.
--
-- FIXTURE NOTE (D235/F110, and both halves apply): every fixture ADP is in
-- the fractional band (0, 1) — 0.201…0.412, strictly below the real pool's
-- measured global minimum of 1.8 — so a fixture wins BY VALUE on a seeded
-- machine and, being the only players in play, on an empty one too. No
-- assertion in this file states a premise about what the shared `players`
-- table does NOT contain.
--
-- Conventions: fixtures in the postgres role BEFORE any JWT claims (D49(7));
-- goldens are stored literals (§4.3); the whole file rolls back.
-- ============================================================================
begin;
select plan(29);

-- ---------------------------------------------------------------------------
-- Fixtures. Users u01…u08. Players: 12 QBs (0.201…0.212), 12 RBs
-- (0.301…0.312), 3 WRs (0.401…0.403 — the filler picks, eligible for NO seat
-- in either roster shape, which is what makes them pure hole-counters).
-- World LS (b6…a1): 8 seats (u01 commish), an AUCTION league whose roster is
-- {QB:1, bench:1} ⇒ 2 draftable rounds; a REAL live draft beside it (the §B/§D
-- control) and u01's mock launched off it.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('96100000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pgtap-mp2-' || lpad(i::text, 2, '0') || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  jsonb_build_object('username', 'pgtap_mp2_user_' || lpad(i::text, 2, '0')),
  now(), now()
from generate_series(1, 8) i;

insert into players (id, full_name, position, adp)
select 'mp2-qb' || lpad(i::text, 2, '0'), 'MP2 QB ' || lpad(i::text, 2, '0'), 'QB',
       0.200 + i / 1000.0
from generate_series(1, 12) i;
insert into players (id, full_name, position, adp)
select 'mp2-rb' || lpad(i::text, 2, '0'), 'MP2 RB ' || lpad(i::text, 2, '0'), 'RB',
       0.300 + i / 1000.0
from generate_series(1, 12) i;
insert into players (id, full_name, position, adp)
select 'mp2-wr' || lpad(i::text, 2, '0'), 'MP2 WR ' || lpad(i::text, 2, '0'), 'WR',
       0.400 + i / 1000.0
from generate_series(1, 3) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('b6000000-0000-4000-8000-0000000000a1', '96100000-0000-4000-8000-000000000001',
   'pgtap-mp2-LS', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 200, "auction_zero_dollar_nominations": false,
     "auction_nomination_seconds": 30, "auction_bid_seconds": 20,
     "auction_anti_snipe_seconds": 10, "disconnect_grace_seconds": 30,
     "pick_timer_seconds": 90,
     "draft_order": ["c6000000-0000-4000-8000-00a100000001", "c6000000-0000-4000-8000-00a100000002",
                     "c6000000-0000-4000-8000-00a100000003", "c6000000-0000-4000-8000-00a100000004",
                     "c6000000-0000-4000-8000-00a100000005", "c6000000-0000-4000-8000-00a100000006",
                     "c6000000-0000-4000-8000-00a100000007", "c6000000-0000-4000-8000-00a100000008"]}}');
update leagues
set roster_settings = '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}],
    "bench": 1, "ir_slots": [], "swap_spots": 0}'
where id = 'b6000000-0000-4000-8000-0000000000a1';

insert into teams (id, owner_id, name, league_id)
select ('c6000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       ('96100000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-mp2-t' || lpad(i::text, 2, '0'),
       'b6000000-0000-4000-8000-0000000000a1'
from generate_series(1, 8) i;

insert into league_members (league_id, user_id, team_id, role)
select 'b6000000-0000-4000-8000-0000000000a1',
       ('96100000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c6000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 8) i;

-- The REAL draft (§B/§D control). Deadline NULL so the tick never claims it —
-- 022's resolve-only fixture idiom.
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    total_rounds, current_round, current_pick_number, draft_order) values
  ('e6000000-0000-4000-8000-0000000000d1', 'b6000000-0000-4000-8000-0000000000a1',
   'auction', 'live', false, '{}', 2, 1, 1,
   '["c6000000-0000-4000-8000-00a100000001", "c6000000-0000-4000-8000-00a100000002",
     "c6000000-0000-4000-8000-00a100000003", "c6000000-0000-4000-8000-00a100000004",
     "c6000000-0000-4000-8000-00a100000005", "c6000000-0000-4000-8000-00a100000006",
     "c6000000-0000-4000-8000-00a100000007", "c6000000-0000-4000-8000-00a100000008"]');

-- T5's one filler pick in the REAL draft: a WR fills no seat under EITHER
-- roster shape, so it advances the pick count without touching the holes —
-- which is exactly what puts the seat one pick from greedy step d.
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id, is_auto, made_via) values
  ('e6000000-0000-4000-8000-0000000000d1', 'b6000000-0000-4000-8000-0000000000a1',
   1, 1, 'c6000000-0000-4000-8000-00a100000005', 'mp2-wr03', true, 'autopick');

-- ---------------------------------------------------------------------------
-- A. THE LAUNCH SNAPSHOT (094 §1). u01 launches on their own seat T1.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "96100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b6000000-0000-4000-8000-0000000000a1') $$,
  'the mock launches (auction, full seat map, solvent at $200 over 2 draftable spots)');
reset role;

create temp table mp2_mock as
select id from drafts where league_id = 'b6000000-0000-4000-8000-0000000000a1' and is_mock;
grant select on mp2_mock to authenticated;

select is(
  (select d.config->'roster' from drafts d join mp2_mock m on m.id = d.id),
  '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}],
    "bench": 1, "ir_slots": [], "swap_spots": 0}'::jsonb,
  'THE SNAPSHOT EXISTS, as a stored literal: config.roster carries the WHOLE roster object at launch — the one setting D95 promised and never delivered (094 §1)');
select is(
  (select d.config->'roster' from drafts d join mp2_mock m on m.id = d.id),
  (select l.roster_settings from leagues l where l.id = 'b6000000-0000-4000-8000-0000000000a1'),
  '…and it equals its SOURCE at launch — the league''s roster_settings column, copied, not re-derived');
select is(
  (select d.total_rounds from drafts d join mp2_mock m on m.id = d.id),
  2,
  'total_rounds (starters + bench, D91) still agrees with the shape it was derived from: 1 + 1 = 2 — the count and the slots now come to rest in the same row');
select is(
  (select d.config ? 'roster' from drafts d where d.id = 'e6000000-0000-4000-8000-0000000000d1'),
  false,
  'THE NEGATIVE, stated at the width it is measured at (R494): create_mock_draft stamps no roster key on a SIBLING REAL DRAFT in the same league. It says nothing about §2''s backfill, which ran before this fixture existed — that guard is replayed on its own two tests down');

-- R494: §2's backfill carries its own `is_mock` guard, and no test could see
-- it — the migration ran long before this fixture existed. Replay the
-- statement VERBATIM here, on a real draft that lacks the key, and show it
-- stays untouched. (The mock already has one, so the guard's positive half is
-- §A above; this is the half a REAL draft depends on.)
UPDATE public.drafts d
SET config = jsonb_set(d.config, '{roster}',
                       COALESCE(l.roster_settings, '{}'::jsonb))
FROM public.leagues l
WHERE l.id = d.league_id
  AND d.is_mock
  AND d.config->'roster' IS NULL;
select is(
  (select d.config ? 'roster' from drafts d where d.id = 'e6000000-0000-4000-8000-0000000000d1'),
  false,
  '…and §2''s BACKFILL statement, replayed verbatim, leaves the real draft alone too — the is_mock guard is in the statement, not in the accident of what the table held on migration day (tasks-MP §4 rule 11)');

-- T2's filler pick in the MOCK (the forced-arm seat) and T4's (the §F forced
-- CPU seat). T3 stays empty — the §F open seat, one pick behind them.
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id, is_auto, made_via)
select m.id, 'b6000000-0000-4000-8000-0000000000a1', 1, 1,
       'c6000000-0000-4000-8000-00a100000002', 'mp2-wr01', true, 'autopick' from mp2_mock m;
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id, is_auto, made_via)
select m.id, 'b6000000-0000-4000-8000-0000000000a1', 2, 1,
       'c6000000-0000-4000-8000-00a100000004', 'mp2-wr02', true, 'autopick' from mp2_mock m;

-- ---------------------------------------------------------------------------
-- B. THE NO-CHANGE PIN. Nothing has been edited yet, so the snapshot and the
--    live league are the same object and every answer below is what the
--    pre-094 engine returned. This is what makes §C a pin on RE-HYDRATION
--    rather than a pin on the new code path.
-- ---------------------------------------------------------------------------
select is(
  (select public.draft_autopick_resolve(m.id, 'c6000000-0000-4000-8000-00a100000002') from mp2_mock m),
  'mp2-qb01',
  'MOCK, unedited: the forced seat (1 filler pick, 1 hole, 1 pick left) takes the best-ADP QB — greedy step d over need = [QB]');
select is(
  public.draft_autopick_resolve('e6000000-0000-4000-8000-0000000000d1',
                                'c6000000-0000-4000-8000-00a100000005'),
  'mp2-qb01',
  'REAL draft, unedited: the identical answer on the identical board — the two engines agree while the league sits still');
select is(
  (select public.draft_mock_cpu_need(m.id, 'c6000000-0000-4000-8000-00a100000003', 'mp2-qb01') from mp2_mock m),
  1.0,
  'CPU need, unedited: a QB is a STARTER under this roster ⇒ 1.0 (OPEN mode, S+1 weights)');
select is(
  (select public.draft_mock_cpu_need(m.id, 'c6000000-0000-4000-8000-00a100000003', 'mp2-rb01') from mp2_mock m),
  0.5,
  '…and an RB fills no starting seat ⇒ 0.5, the bench weight. Both numbers come from the SLOT SHAPE, which is why the shape''s source is the whole question');

-- ---------------------------------------------------------------------------
-- C. THE D95 PIN. The commissioner edits the league's roster WHILE the mock
--    is live: the QB seat becomes an RB seat. Every §B answer for the MOCK
--    must be unchanged. Against the shipped (pre-094) bodies this section is
--    RED at four tests — shown in the PR and reverted.
-- ---------------------------------------------------------------------------
update leagues
set roster_settings = '{"starting_slots": [
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
    "bench": 1, "ir_slots": [], "swap_spots": 0}'
where id = 'b6000000-0000-4000-8000-0000000000a1';

select is(
  (select d.config->'roster'->'starting_slots'->0->>'key' from drafts d join mp2_mock m on m.id = d.id),
  'qb',
  'the stored snapshot is untouched by the edit — a mock''s settings are a COPY, not a view');
select is(
  (select public.draft_autopick_resolve(m.id, 'c6000000-0000-4000-8000-00a100000002') from mp2_mock m),
  'mp2-qb01',
  'THE PIN: the mock''s autopick STILL fills the snapshotted QB seat. Before 094 this returned mp2-rb01 — a commissioner moved the bots under the launcher mid-practice (D95, §8.8)');
select is(
  (select public.draft_mock_cpu_need(m.id, 'c6000000-0000-4000-8000-00a100000003', 'mp2-qb01') from mp2_mock m),
  1.0,
  '…and the CPU value model still prices a QB as a starter (1.0, was 0.5 live) — the same defect on the hot path of every bot bid');
select is(
  (select public.draft_mock_cpu_need(m.id, 'c6000000-0000-4000-8000-00a100000003', 'mp2-rb01') from mp2_mock m),
  0.5,
  '…and an RB is still bench (0.5, was 1.0 live) — the pair, not either alone, shows the shape came from the draft row');

-- ---------------------------------------------------------------------------
-- D. REAL DRAFTS KEEP THE LIVE READ — the decision, pinned. 094 changes the
--    MOCK path only; whether a real draft should snapshot its roster at start
--    is a bigger question (D141 pause-first commissioner controls) and is
--    deliberately not settled by this task.
-- ---------------------------------------------------------------------------
select is(
  public.draft_autopick_resolve('e6000000-0000-4000-8000-0000000000d1',
                                'c6000000-0000-4000-8000-00a100000005'),
  'mp2-rb01',
  'REAL draft: the SAME edit DOES move it — the live read is unchanged, byte-for-byte 086''s behaviour (tasks-MP §4 rule 11)');
select isnt(
  (select public.draft_autopick_resolve(m.id, 'c6000000-0000-4000-8000-00a100000002') from mp2_mock m),
  public.draft_autopick_resolve('e6000000-0000-4000-8000-0000000000d1',
                                'c6000000-0000-4000-8000-00a100000005'),
  'the whole change in one line: on the same league, at the same instant, the mock and the real draft now DISAGREE — and that disagreement is the D95 promise being kept');

-- ---------------------------------------------------------------------------
-- E. THE SWEEP AS A STRUCTURAL PIN (039 §A / 041 §6 shape). "No live function
--    on a mock's path reads league settings" is a pg_proc fact.
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(distinct p.proname::text order by p.proname::text)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname ~ '^(draft|create_mock|delete_mock|mock_draft)'
      -- R495: alias-agnostic. §1.2's query hard-coded the alias `l.`, so a
      -- future body that writes `lg.settings` would escape the sweep that is
      -- supposed to be exhaustive.
      and p.prosrc ~ '(roster_settings|[a-z_]+\.settings)'),
  array['create_mock_draft', 'draft_autopick_resolve', 'draft_create_internal',
        'draft_start_internal', 'draft_tick'],
  'THE SWEEP, as a stored literal: exactly five functions in the draft family read league settings at all — three are LAUNCH-TIME (create_mock_draft, draft_create_internal, draft_start_internal), draft_tick''s is the D94 auto-start arm, which scans scheduled LEAGUES and reaches drafts only through draft_start_internal''s is_mock = FALSE filter (R495 — the earlier wording said it scanned drafts, which it does not), and draft_autopick_resolve''s is its non-mock arm (next test). draft_mock_cpu_need is NO LONGER IN THIS SET');
select ok(
  (select p.prosrc !~ 'public\.leagues'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'draft_mock_cpu_need'),
  'draft_mock_cpu_need names NO league at all — the JOIN is deleted, not guarded (094 §4). A body that "handles the NULL" instead reddens here');
select ok(
  (select p.prosrc like '%v_draft.config->''roster''->''starting_slots''%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'draft_autopick_resolve')
  and (select p.prosrc like '%IF v_draft.is_mock THEN%v_draft.config->''roster''->''starting_slots''%ELSE%SELECT l.* INTO v_league FROM public.leagues%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'draft_autopick_resolve'),
  'draft_autopick_resolve''s ONLY executable league read sits inside the is_mock = FALSE arm — the mock branch reaches the snapshot and never the league (094 §3)');
select ok(
  (select p.provolatile = 's' and not p.prosecdef
          and array_to_string(p.proconfig, ',') = 'search_path=""'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'draft_mock_cpu_need')
  and (select array_to_string(p.proconfig, ',') = 'search_path=""'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'draft_autopick_resolve')
  and (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_mock_draft'),
  'FORM SURVIVES THE REPLACE (§4.1): cpu_need STABLE + INVOKER + search_path='''' (038:145''s shape), autopick search_path='''', create_mock_draft SECURITY DEFINER + search_path=''''');
select ok(
  not has_function_privilege('anon', 'public.create_mock_draft(uuid, uuid, text, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_mock_draft(uuid, uuid, text, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_autopick_resolve(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_autopick_resolve(uuid, uuid)', 'EXECUTE'),
  '…and so do the GRANTS (D18→D23): create_mock_draft REVOKEd from anon only, draft_autopick_resolve from anon AND authenticated — the server picks, a client never asks');
select ok(
  has_function_privilege('authenticated', 'public.draft_mock_cpu_need(uuid, uuid, text)', 'EXECUTE')
  and has_function_privilege('anon', 'public.draft_mock_cpu_need(uuid, uuid, text)', 'EXECUTE'),
  'RECORDED, NOT ENDORSED (R497): draft_mock_cpu_need is EXECUTE-able by anon AND authenticated — 089 shipped it with no REVOKE and 094 preserves that exactly, because changing a grant is not a settings-reader fix. It is a STABLE read-only pricing helper, so the exposure is a value not a write; the question of whether it should be revoked goes to MP.3 (F112). This pin exists so the state is a measured fact rather than an assumption, and so a future REVOKE reddens here and gets read');

-- ---------------------------------------------------------------------------
-- F. THE BOUNDARY (D146), and it is computed from the SNAPSHOT. Greedy step d
--    engages when (total_rounds − picks) ≤ holes. T4 has one filler pick ⇒
--    1 left, 1 hole ⇒ FORCED. T3 has none ⇒ 2 left, 1 hole ⇒ OPEN. One pick
--    apart, on the same draft, with the league STILL EDITED to RB — so a body
--    that regressed to the live read reddens on every line here too.
-- ---------------------------------------------------------------------------
select is(
  (select public.draft_mock_cpu_need(m.id, 'c6000000-0000-4000-8000-00a100000004', 'mp2-qb01') from mp2_mock m),
  1.0,
  'FORCED side: 1 pick left, 1 hole ⇒ only a hole-filler is worth anything, and the snapshot says the hole takes a QB ⇒ 1.0');
select is(
  (select public.draft_mock_cpu_need(m.id, 'c6000000-0000-4000-8000-00a100000004', 'mp2-rb01') from mp2_mock m),
  0.0,
  '…and an RB is worth EXACTLY 0 on that side — not 0.5. The forced arm has no bench weight (D163/R406), which is what makes the next line a boundary and not a repetition');
select is(
  (select public.draft_mock_cpu_need(m.id, 'c6000000-0000-4000-8000-00a100000003', 'mp2-rb01') from mp2_mock m),
  0.5,
  'ONE PICK EARLIER, same player, same draft, same edited league: 2 left > 1 hole ⇒ OPEN ⇒ 0.5. The unit that separates 0 from 0.5 is one pick, and it is counted off total_rounds — the number the snapshot''s own shape produced');
select is(
  (select public.draft_autopick_resolve(m.id, 'c6000000-0000-4000-8000-00a100000004') from mp2_mock m),
  'mp2-qb01',
  'and the autopick agrees with the need model on the forced side — one implementation of the greedy shape, two readers, one snapshot');


-- ---------------------------------------------------------------------------
-- G. R491 — AN UNSNAPSHOTTED MOCK IS A LOUD FAILURE, NOT AN EMPTY ROSTER.
--    Strip the key (what MP.3's nullable league_id and MP.4's settings writer
--    could each produce) and both readers must REFUSE. Before the guard this
--    section is the migration's own defect wearing a different hat: autopick
--    still returns a player and every position prices at 0.5, with no error
--    anywhere. Keyed on KEY ABSENCE — an all-bench roster (`starting_slots:
--    []` present) is legal and must still price, which is the last test here.
-- ---------------------------------------------------------------------------
update drafts d set config = d.config - 'roster' from mp2_mock m where m.id = d.id;

select throws_ok(
  $$ select public.draft_autopick_resolve((select id from mp2_mock),
       'c6000000-0000-4000-8000-00a100000002') $$,
  'P0001',
  null,
  'autopick REFUSES an unsnapshotted mock (P0001) instead of pricing it as an all-filled roster — CLAUDE.md: assert the REASON for emptiness, never infer it');
select throws_ok(
  $$ select public.draft_mock_cpu_need((select id from mp2_mock),
       'c6000000-0000-4000-8000-00a100000003', 'mp2-qb01') $$,
  'P0001',
  null,
  '…and so does the CPU need model — the worse of the two sites, because an unguarded collapse there prices EVERY position identically and the bots go on bidding while nothing reports a fault');

-- The discriminator that keeps the guard honest: an all-bench roster is a
-- LEGAL roster and must price, so the guard cannot key on an empty array.
update drafts d
set config = jsonb_set(d.config, '{roster}',
      '{"starting_slots": [], "bench": 2, "ir_slots": [], "swap_spots": 0}'::jsonb)
from mp2_mock m where m.id = d.id;
select is(
  (select public.draft_mock_cpu_need(m.id, 'c6000000-0000-4000-8000-00a100000003', 'mp2-qb01') from mp2_mock m),
  0.5,
  'AN ALL-BENCH ROSTER STILL PRICES (0.5, the bench weight): the guard keys on the KEY being absent, not on the slot list being empty — a guard that conflated the two would refuse a legal league');

select * from finish();
rollback;
