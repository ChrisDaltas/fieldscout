-- ============================================================================
-- Retire-and-succeed — pgTAP 068 (task L.D1.10; migration 120; spec v2.16.28
-- §7.2.1(b) / §12.22 / §11.5 / §12.2 / §12.9 / §15.1 / E49; PROGRESS D42 /
-- D53 / D74 / D137 / D290 / D301 / D314(6) / D320; F1 / F31 / F42 / F256(e);
-- tasks-M4 §4 rules 1–11).
--
-- Numbering: pgTAP head measured 067 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 068.
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * THE §7.2.1(b) GOLDEN (§C/§D) is a 4-team h2h season built on paper:
--     A and X both 2-1 / PF 300 after the three FINAL weeks; A beat X in
--     week 1, so head-to-head puts A FIRST (X's row separated_by
--     head_to_head — the BEFORE literal). A's PA 280 < X's PA 285 — chosen
--     so that once A retires into S (which inherits A's line for SEEDING),
--     the S–X tie has NO head-to-head (S never played X; X's loss was to A)
--     and falls to Points Against, where the HIGHER PA ranks first (065's
--     direction pin) — X FIRST, S second, separated_by points_against. The
--     ORDER FLIPS because the successor's H2H history does not inherit —
--     pinned from BOTH sides (S's key against X and X's key against S are
--     both 0). The PR's probe 3 folds the lineage into the h2h CTE and D2
--     / D2b go RED (the order reverts to S, X by head_to_head).
--   * HISTORY INTEGRITY (§C): the re-point is COUNTED and pinned per week —
--     weeks 1–4 (final / correction_window) keep A on every lineup, matchup
--     and result row; weeks 5–6 (live / upcoming) carry S. The PR's probe 2
--     lets the re-point touch week 4 and C7 / C8 / C9 go RED.
--   * THE LOCK (§E): a KC player on A's roster kicked off one second before
--     the retirement; after S is claimed, dropping him is refused by name
--     (E32) while the DAL player (three hours out) drops — the guard RUNS
--     and its sibling passes one unit away (D146). The PR's probe 4 clears
--     the lock on the re-pointed roster and E2 goes RED.
--   * F1 (§F): the cycle fixtures are PRIVILEGED corruption (the RPC's own
--     successor is always a fresh row, so no RPC sequence can build a cycle
--     — said, D267): A→B→A and A→B→C→A, each refused BY NAME with its
--     length; the linear chain A→S→S' is the sibling — it SUCCEEDS and S'
--     folds BOTH predecessors (depth 2). The DoD probe drops the cycle walk:
--     F1 / F2 go RED (the fixture is then misreported as "already sealed",
--     a different message).
--   * PENDING THROUGH THE LINEAGE (§G): a total_points league whose
--     correction_window week holds the predecessor's provisional row is NOT
--     pending after the retirement; a genuinely missing team still is. The
--     PR's probe 5 restores 117's read and G2 goes RED.
--   * REPLAY (§C10–C12): the same action_id returns the stored payload
--     byte-identical and mints no second successor; the same stamp on
--     another member is 22023.
--   * EVERY REFUSAL BY NAME beside its success twin (rule 9 / D272(20)):
--     playoffs (Q41) / setup (D42's text, byte-identical) / a manager on
--     his own seat / anon / no action_id / blank reason / already sealed.
--     [173 / L.E1.40 (F363(a), Q66): a blank reason is NO LONGER refused —
--     C0d is re-cut to the ruled behaviour (the retirement proceeds with the
--     reason null, run inside a rolled-back subtransaction so the golden
--     below is untouched); pgTAP 121 pins the landed shape.]
--   * GOLDENS AS STORED LITERALS (D62): every count and rendering below is
--     a literal written before the first run.
--   * THE #266 FIX ROUND (R855–R862; 120 edited in place, its md5 moved):
--     (§J) R855 — a VACATED franchise (orphaned, a closed stint) retires:
--     sealed under its last manager, the closed stint untouched, no
--     notification, removed_user_id NULL, the successor + ledger + post
--     written; a franchise that NEVER had a manager (C13: 120's own
--     successor; J3: an autopick-drafted placeholder, active) refuses BY
--     NAME. The PR's probe (1) restores 063's early "no manager" refusal
--     and J2–J2h go RED. R858 — a co-commissioner retiring HIS OWN seat is
--     refused 42501 by name (J1); probe (3) drops the guard and J1/J1b go
--     RED. (§A/§C/§G/§J) R856 — the `teams` broadcast trigger: per
--     statement, diff-aware (OLD/NEW), ONE event per retirement carrying
--     the sealed row (C14–C14d), the h2h and total_points event censuses
--     as stored literals (C14 / G1c — R859), the other writers' shape (J0:
--     a takeover of a MANAGED franchise and an updated_at touch emit
--     nothing; a claim / vacate one each); probe (2) drops the trigger and
--     A11 / A11b / C14 / C14b–d / G1c / J0 / J2h go RED.
--
--   * RE-CUT BY 176 (M6 L.E1.42 — Chris 2026-10-01: "you can't simply
--     retire a Team, you can change the manager but the Team lives" / "yes
--     drop it"). The live remove_manager REFUSES retire by name in every
--     state and no longer carries the arm (pgTAP 124 pins that, and 121 /
--     117 / 111 / 094 re-cut their retire cells to the refusal). The schema
--     keeps teams.status 'retired', retired_at_week and successor_team_id
--     (additive-safe — an old row could hold them), and the READ paths this
--     suite proves over such rows stay live: the standings' seeding
--     lineage (§D), pending through the lineage (§G), the teams broadcast
--     (§A11 / C14 / J0), the lock riding the player (§E). So §A pins the
--     LIVE schema (A10 re-cut: no function carries the cycle walk any
--     more), and from §C on the suite restores 173's body INSIDE this
--     rolled-back transaction (pg_temp.un176 over the live definition) as
--     the only faithful builder of retired-shaped rows. §C–§J are HISTORY
--     pins over that restored body, not the live verb's behaviour.
--
--   * RE-CUT BY 199 (F562 — Chris's go 2026-10-19; PROGRESS D560): the
--     retire schema is GONE — teams.status 'retired', retired_at_week,
--     successor_team_id and the 'seat_retired' stint value are dropped, and
--     the read paths this suite proved over retired-shaped rows (the
--     standings' seeding lineage, pending through the lineage, the lineage
--     walk in the waiver order, the broadcast's lineage keys) are removed
--     from their bodies. 173's restored body can no longer build those rows
--     (it writes the dropped columns), and no live code reads them, so
--     §B–§J are deleted: they pinned history over a state that cannot exist
--     (production held none — measured 2026-10-19). What stays is §A, the
--     shape that is still live (A11b re-worded for the narrower diff).
--     pgTAP 149 pins 199: the columns and CHECK arms gone, the lineage
--     reads replaced by 117/118's own, and the `teams` broadcast over this
--     suite's realtime harness (149 §E — R1605): an updated_at-only
--     statement and a takeover of a MANAGED team emit no event, a real
--     vacate emits exactly one whose record row is {id, name, status} (§J0's
--     non-retire cells, carried over). The takeover / vacate arms themselves
--     are 124 §D's.
--
-- (199: the fixture calendar and §B–§J are gone — see above.)
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);   -- 108 until 199 deleted §B–§J (see the header)

-- ---------------------------------------------------------------------------
-- A. Shape: the signature moved (DROP + CREATE, D137), ACLs, the wrappers
--    untouched by md5, the internals plain.
-- ---------------------------------------------------------------------------
select hasnt_function('public', 'remove_manager', array['uuid','uuid','text','uuid','text'],
  'A1 the 063 five-argument remove_manager is GONE (DROP + CREATE — no overload left behind)');
select has_function('public', 'remove_manager', array['uuid','uuid','text','uuid','text','uuid'],
  'A2 remove_manager carries p_action_id (sixth argument, DEFAULT NULL — every 3/4/5-argument call still resolves)');
select is_definer('public', 'remove_manager', array['uuid','uuid','text','uuid','text','uuid'],
  'A3 remove_manager is SECURITY DEFINER');
select is(
  (select array_to_string(p.proconfig, ',') from pg_proc p
   where p.oid = 'public.remove_manager(uuid,uuid,text,uuid,text,uuid)'::regprocedure),
  'search_path=""', 'A4 remove_manager pins search_path='''' exactly (R70)');
select ok(
  not has_function_privilege('anon', 'public.remove_manager(uuid,uuid,text,uuid,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.remove_manager(uuid,uuid,text,uuid,text,uuid)', 'EXECUTE'),
  'A5 anon holds NO EXECUTE; authenticated keeps it (the in-body commissioner check is the gate)');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
   where p.oid = 'public.remove_manager(uuid,uuid,text,uuid,text,uuid)'::regprocedure),
  'p_league_id uuid, p_member_id uuid, p_mode text, p_successor_user_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_action_id uuid DEFAULT NULL::uuid',
  'A6 the argument list, exact (the route sends the first five by name)');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   and not has_function_privilege('anon', p.oid, 'EXECUTE'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('league_standings_internal', 'week_results_pending_internal')),
  'A7 the two replaced internals stay PLAIN, search_path='''', REVOKEd from every client role (117/118''s posture re-asserted)');
-- The two DEFINER wrappers are 118's, byte for byte (stored literals from
-- 118 as applied — a 120 that touched either reds here). RE-CUT BY 210
-- (M7 L.F2.8, F719): one gate condition changed in each — a caller with no
-- uid is refused unless it is the server; the literals are 210's FILE bodies
-- as applied (118's were ab1e6ff4… / 96e70a95…). Still nothing about lineage.
select is(
  md5((select p.prosrc from pg_proc p where p.oid = 'public.league_standings(uuid)'::regprocedure)),
  'c5070e59b0a6e09d25606e1c0a2b9c02',
  'A8 league_standings(uuid) is 210''s body (md5 literal; 118''s gate re-cut by 210) — the lineage lives in the internal only');
select is(
  md5((select p.prosrc from pg_proc p where p.oid = 'public.league_standings_projected(uuid)'::regprocedure)),
  '6761c5ef0ed946145b75d677c754adb3',
  'A9 league_standings_projected(uuid) is 210''s body (md5 literal; 118''s gate re-cut by 210)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%CYCLE id SET is_cycle USING path%'),
  0, 'A10 RE-CUT (176): NO live function carries the F1 cycle walk — the retire arm is gone (was: exactly one, remove_manager)');
-- R856 (the #266 fix round): the `teams` trigger ships — F42 DISCHARGED for
-- teams (a trigger ships with its first subscriber: the standings page and
-- the league detail, whose first in-season writer is this retirement).
select has_trigger('public', 'teams', 'tr_broadcast_teams',
  'A11 teams: the broadcast trigger EXISTS (120 §4 / R856 — F42 discharged for teams; 067 B5c and 024 amended in place)');
select is(
  (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid = 'public.teams'::regclass and t.tgname = 'tr_broadcast_teams'),
  'CREATE TRIGGER tr_broadcast_teams AFTER UPDATE ON public.teams REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION broadcast_teams_statement()',
  'A11b …per STATEMENT with BOTH transition tables (the diff-aware shape: a row counts only when name / status CHANGED — 199 dropped the two lineage columns from the diff — PG 17 refuses UPDATE OF <cols> with a transition table); no INSERT / DELETE trigger');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'broadcast_teams_statement')
  and
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'team_broadcast_payload'),
  'A11d the trigger function is DEFINER + search_path='''' + REVOKEd from every client role; the payload function plain + REVOKEd (119''s shape)');
select has_trigger('public', 'league_rosters', 'tr_broadcast_league_rosters',
  'A12 league_rosters keeps 072''s per-row trigger — the roster re-point rides it');

select * from finish();
rollback;
