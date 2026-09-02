-- ============================================================================
-- `draft_adjust_budget` joins the E2 contract — migration 099 (task AP.6;
-- spec v2.16.4 E69, §8.1's idempotency bullet, §8.7's budget row
-- (store: §12.26, v2.16.5 — this PR's erratum); D203;
-- discharges F82). pgTAP file is **047** (046 = manual nomination order;
-- next free confirmed at task time with `ls`).
--
-- THE DEFECT THIS FILE PINS AGAINST (F82, shown live in the AP.6 PR body
-- against the shipped 092 body before this migration was applied): the same
-- POST twice moved twice the money — first call adjustment_after -10,
-- retried call -20, budget_adjustments doubled. E69 rules the fix and D203
-- adds the requirement the row left implicit: **the replay returns the
-- ORIGINAL result**, not a fresh success.
--
-- Falsifiability notes (§4.3 — what each section catches; the DoD break
-- probe is: remove the replay lookup from the installed body):
--   * §A FORM: exactly ONE draft_adjust_budget in the catalog (the 4-arg
--     signature is GONE — the D201(2) overload trap, where CREATE OR
--     REPLACE beside the old signature leaves the un-fixed body callable);
--     DEFINER + search_path='' + the grant posture on the NEW signature.
--   * §B THE STORE'S POSTURE (§4.2): RLS on, the partial unique's indexdef
--     as a stored literal, member SELECT works, non-member SELECT sees 0,
--     and the no-write pattern per role with RETURNING counts (INSERT
--     42501; UPDATE/DELETE RETURNING-0 against a privileged row-exists
--     pin) — rows arrive only through the DEFINER verb.
--   * §C THE REPLAY (the point of the task — **the break probe reddens
--     here**): same (draft, team, delta, action_id) twice ⇒ ONE movement
--     and the byte-identical ORIGINAL payload; ONE store row; and after
--     the draft PAUSES the replay still answers the ORIGINAL (its draft
--     blob says 'live' — the D203 originality discriminator, which a
--     fresh-success implementation cannot fake). 4-arg and 3-arg call
--     texts still bind (the pre-099 behaviour, executable).
--   * §D COMPOSITION IS THE FEATURE, NOT THE BUG: a DIFFERENT action_id
--     with the same delta composes cumulatively; NULL action_id composes
--     exactly as today (no dedupe), and every landed edit leaves a record
--     row. The partial-unique arbiter is proven directly (privileged
--     duplicate INSERT ⇒ 23505).
--   * The D138 mock refusal is NOT re-pinned here — it is pinned at
--     038:1402 with the exact message and survives 099 untouched (092's
--     text verbatim; the suite run over the full chain is the proof).
-- ============================================================================
begin;
select plan(35);

-- ---------------------------------------------------------------------------
-- A. Form: one function, the right posture, the grants moved with the
--    signature (tasks-M1 §4.1)
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_adjust_budget'),
  1,
  'ONE draft_adjust_budget in the catalog — the 4-arg body was DROPPED, not overloaded beside (the D201(2) trap: an overload would leave the double-charging body callable by every existing call text)');
select is(
  (select pg_get_function_identity_arguments(p.oid)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_adjust_budget'),
  'p_draft_id uuid, p_team_id uuid, p_delta integer, p_reason text, p_action_id uuid',
  'p_action_id is LAST and defaulted — every 3- and 4-argument call text binds to NULL (the pre-099 behaviour)');
select ok(
  (select p.prosecdef and p.proconfig::text like '%search_path=%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_adjust_budget'),
  'SECURITY DEFINER with a pinned search_path (§4.1)');
select ok(
  not has_function_privilege('anon', 'public.draft_adjust_budget(uuid,uuid,integer,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_adjust_budget(uuid,uuid,integer,text,uuid)', 'EXECUTE'),
  'grants moved WITH the signature: anon revoked, authenticated keeps EXECUTE (in-body auth is the gate)');

-- ---------------------------------------------------------------------------
-- B. The store's posture (§4.2) — fixture first, so the write probes have a
--    row to not-touch
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('8ea60000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-ap6-' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "ap6_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 2) i;
-- user 1 = the commissioner; user 2 = a non-member (the SELECT-scope probe).

-- 110/L.D1.2 (F143): a drafting+ league must REFERENCE a scoring system (§7.3.8's other half — the guard now refuses a NULL scoring_system_id in drafting+); this fixture's reference is a template. A fixture change forced by 110, not a drive-by.
insert into leagues (id, owner_id, name, season, status, team_count,
                     scoring_system_id, settings, scoring_rules_snapshot)
values ('b8a60000-0000-4000-8000-0000000000aa', '8ea60000-0000-4000-8000-000000000001',
        'pgtap-ap6-LA', 2026, 'drafting', 8, (select id from scoring_systems where is_template and name = 'ESPN Standard'),
        '{"draft": {"auction_budget": 200, "auction_zero_dollar_nominations": false,
           "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
           "auction_anti_snipe_seconds": 10, "pick_timer_seconds": 90}}'::jsonb,
        '{}'::jsonb);
insert into teams (id, owner_id, name, league_id)
select ('c8a60000-0000-4000-8000-00000000000' || i)::uuid,
       '8ea60000-0000-4000-8000-000000000001', 'pgtap-ap6-t' || i,
       'b8a60000-0000-4000-8000-0000000000aa'
from generate_series(1, 2) i;
insert into league_members (league_id, user_id, team_id, role) values
  ('b8a60000-0000-4000-8000-0000000000aa', '8ea60000-0000-4000-8000-000000000001',
   'c8a60000-0000-4000-8000-000000000001', 'commissioner');
insert into drafts (id, league_id, draft_type, status, is_mock, config, total_rounds,
                    current_round, current_pick_number, current_deadline, started_at)
values ('e8a60000-0000-4000-8000-0000000000aa', 'b8a60000-0000-4000-8000-0000000000aa',
        'auction', 'live', false,
        '{"auction_budget": 200, "auction_zero_dollar_nominations": false,
          "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
          "auction_anti_snipe_seconds": 10, "pick_timer_seconds": 90}'::jsonb,
        3, 1, 1, now() + interval '1 hour', now());

select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'draft_budget_adjustments'),
  'RLS is ENABLED on draft_budget_adjustments');
select is(
  (select indexdef from pg_indexes
   where schemaname = 'public' and indexname = 'uniq_draft_budget_adjust_action'),
  'CREATE UNIQUE INDEX uniq_draft_budget_adjust_action ON public.draft_budget_adjustments USING btree (draft_id, action_id) WHERE (action_id IS NOT NULL)',
  'the dedupe unique is PARTIAL — the C39/uniq_draft_bid_action pattern as a stored literal (NULL rows coexist; every stamped retry dedupes)');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'draft_budget_adjustments'
     and cmd <> 'SELECT'),
  0,
  'NO write policy exists for any role or command — rows arrive only through the DEFINER verb (§8.1)');

-- ---------------------------------------------------------------------------
-- C. The replay (E69/D203) — the break probe's target
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8ea60000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select is(
  public.draft_adjust_budget('e8a60000-0000-4000-8000-0000000000aa',
    'c8a60000-0000-4000-8000-000000000001', -10, 'ap6 first',
    'ac000000-0000-4000-8000-0000000000a1')->>'adjustment_after',
  '-10',
  'the FIRST stamped call lands: one -$10 edit, adjustment_after -10');
select is(
  public.draft_adjust_budget('e8a60000-0000-4000-8000-0000000000aa',
    'c8a60000-0000-4000-8000-000000000001', -10, 'ap6 first',
    'ac000000-0000-4000-8000-0000000000a1'),
  (select a.result from draft_budget_adjustments a
   where a.draft_id = 'e8a60000-0000-4000-8000-0000000000aa'
     and a.action_id = 'ac000000-0000-4000-8000-0000000000a1'),
  'THE REPLAY RETURNS THE ORIGINAL, byte-identically: the second identical POST answers the stored first payload, not a fresh computation (E69/D203). **THE BREAK PROBE REDDENS HERE.**');
select is(
  (select budget_adjustments->>'c8a60000-0000-4000-8000-000000000001'
   from drafts where id = 'e8a60000-0000-4000-8000-0000000000aa'),
  '-10',
  '…and the money moved ONCE: the same POST twice is -10, never -20 — F82''s exact defect, closed (the pre-099 body answered -20 here, shown in the PR body)');
select is(
  (select count(*)::int from draft_budget_adjustments
   where draft_id = 'e8a60000-0000-4000-8000-0000000000aa'
     and action_id = 'ac000000-0000-4000-8000-0000000000a1'),
  1,
  '…and ONE store row exists for the action — the replay wrote nothing');
select is(
  public.draft_adjust_budget('e8a60000-0000-4000-8000-0000000000aa',
    'c8a60000-0000-4000-8000-000000000001', -99, 'ap6 different delta',
    'ac000000-0000-4000-8000-0000000000a1')->>'adjustment_after',
  '-10',
  'A RETRIED action_id CARRYING A DIFFERENT DELTA still replays the ORIGINAL (R552): the lookup keys on (draft, action) ONLY, so -99 under action A answers the stored -10 payload and moves nothing — a lookup that matched delta too would land this as a fresh -99 edit');
select is(
  (select budget_adjustments->>'c8a60000-0000-4000-8000-000000000001'
   from drafts where id = 'e8a60000-0000-4000-8000-0000000000aa'),
  '-10',
  '…and the map still reads -10 (the mismatched retry moved nothing)');

-- The originality discriminator: move the draft on, then replay. A
-- fresh-success implementation would answer with the CURRENT (paused) draft
-- and could not fake this; the stored payload says 'live' forever.
reset role;
update drafts set status = 'paused'
where id = 'e8a60000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8ea60000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  public.draft_adjust_budget('e8a60000-0000-4000-8000-0000000000aa',
    'c8a60000-0000-4000-8000-000000000001', -10, 'ap6 first',
    'ac000000-0000-4000-8000-0000000000a1')->'draft'->>'status',
  'live',
  'the replay answers the ORIGINAL even after the draft moved on (066:915''s placement — before the status checks): its draft blob still says live, because it IS the first call''s payload');
select is(
  (select budget_adjustments->>'c8a60000-0000-4000-8000-000000000001'
   from drafts where id = 'e8a60000-0000-4000-8000-0000000000aa'),
  '-10',
  '…and the post-pause replay moved nothing either');
reset role;
update drafts set status = 'live'
where id = 'e8a60000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8ea60000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- The old call texts still bind (the D201(2) executable-compat pin).
select lives_ok(
  $$ select public.draft_adjust_budget('e8a60000-0000-4000-8000-0000000000aa',
       'c8a60000-0000-4000-8000-000000000001', -5, 'ap6 4-arg') $$,
  'the 4-argument call text still binds (p_action_id defaults to NULL)');
select lives_ok(
  $$ select public.draft_adjust_budget('e8a60000-0000-4000-8000-0000000000aa',
       'c8a60000-0000-4000-8000-000000000001', -5) $$,
  'the 3-argument call text still binds (both trailing defaults)');
select is(
  (select budget_adjustments->>'c8a60000-0000-4000-8000-000000000001'
   from drafts where id = 'e8a60000-0000-4000-8000-0000000000aa'),
  '-20',
  '…and both landed: -10 -5 -5 = -20 — unstamped calls compose exactly as before 099');

-- ---------------------------------------------------------------------------
-- D. Composition is the feature; NULL is un-deduped; the arbiter is real
-- ---------------------------------------------------------------------------
select is(
  public.draft_adjust_budget('e8a60000-0000-4000-8000-0000000000aa',
    'c8a60000-0000-4000-8000-000000000001', -10, 'ap6 second intent',
    'ac000000-0000-4000-8000-0000000000a2')->>'adjustment_after',
  '-30',
  'a DIFFERENT action_id with the SAME delta composes: -20 -10 = -30 — cumulative composition is the feature, not the bug; only the SAME action replays');
select is(
  (select budget_adjustments->>'c8a60000-0000-4000-8000-000000000001'
   from drafts where id = 'e8a60000-0000-4000-8000-0000000000aa'),
  '-30',
  '…stored');
select lives_ok(
  $$ select public.draft_adjust_budget('e8a60000-0000-4000-8000-0000000000aa',
       'c8a60000-0000-4000-8000-000000000001', -10, 'ap6 null 2') $$,
  'a second NULL-stamped call with an identical delta LANDS (no dedupe without a key — exactly today''s behaviour, D203''s "no existing caller breaks")');
select is(
  (select budget_adjustments->>'c8a60000-0000-4000-8000-000000000001'
   from drafts where id = 'e8a60000-0000-4000-8000-0000000000aa'),
  '-40',
  '…and composed to -40');
select is(
  (select count(*)::int from draft_budget_adjustments
   where draft_id = 'e8a60000-0000-4000-8000-0000000000aa'),
  5,
  'FIVE store rows for five LANDED edits (2 stamped + 3 unstamped) — the replays wrote none; every landed edit leaves its record');
select is(
  (select count(*)::int from draft_budget_adjustments
   where draft_id = 'e8a60000-0000-4000-8000-0000000000aa' and action_id is null),
  3,
  '…three of them NULL-stamped and coexisting freely under the PARTIAL unique (C39)');
select is(
  (select (a.result->>'adjustment_before') || '/' || (a.result->>'adjustment_after')
   from draft_budget_adjustments a
   where a.action_id = 'ac000000-0000-4000-8000-0000000000a2'),
  '-20/-30',
  'the record carries the ORIGINAL before/after pair — what makes D203''s byte-identical replay possible at all');

-- A refused edit leaves NO record (the RAISE rolls the whole thing back —
-- 092's write-first-then-re-derive shape, unchanged).
select throws_ok(
  $$ select public.draft_adjust_budget('e8a60000-0000-4000-8000-0000000000aa',
       'c8a60000-0000-4000-8000-000000000001', -1000, 'ap6 refused',
       'ac000000-0000-4000-8000-0000000000a3') $$,
  'P0001',
  'draft_adjust_budget: that leaves pgtap-ap6-t1 $840 short of the $0 already spent — reverse a won bid instead, or make the adjustment smaller (E28)',
  'E28 still refuses (arm 1, 092''s text verbatim: 200 - 40 - 1000 = -840 remaining)…');
select is(
  (select count(*)::int from draft_budget_adjustments
   where action_id = 'ac000000-0000-4000-8000-0000000000a3'),
  0,
  '…and the refusal left NO store row: a refused action_id is NOT consumed, so the corrected retry with the same id can land (the RAISE rolls the record back with the money)');

reset role;
-- The arbiter, proven directly (R310's lesson: partial and non-partial are
-- behaviorally distinguishable — this is the race backstop under two
-- concurrent stamped calls).
select throws_ok(
  $$ insert into draft_budget_adjustments
       (draft_id, league_id, team_id, delta, adjustment_after, action_id, result)
     values ('e8a60000-0000-4000-8000-0000000000aa', 'b8a60000-0000-4000-8000-0000000000aa',
             'c8a60000-0000-4000-8000-000000000001', -1, -41,
             'ac000000-0000-4000-8000-0000000000a1', '{}'::jsonb) $$,
  '23505',
  'duplicate key value violates unique constraint "uniq_draft_budget_adjust_action"',
  'the partial unique is a real arbiter: a duplicate (draft, action) row is 23505 even for a privileged writer');
select is(
  (select count(*)::int from draft_budget_adjustments
   where draft_id = 'e8a60000-0000-4000-8000-0000000000aa'
     and delta = 0),
  0,
  'no zero-delta row exists (the CHECK mirrors the RPC''s 22023 refusal at the store)');

-- §B's write probes, per role, RETURNING counts (§4.2) — run AFTER §C/§D so
-- a real row exists to not-touch.
select is(
  (select count(*)::int from draft_budget_adjustments
   where draft_id = 'e8a60000-0000-4000-8000-0000000000aa'),
  5,
  'row-exists pin for the write probes below: five rows, privileged read');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8ea60000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select count(*)::int from draft_budget_adjustments
   where draft_id = 'e8a60000-0000-4000-8000-0000000000aa'),
  5,
  'a league MEMBER (the commissioner) reads the records (SELECT policy — the 083 pattern)');
select throws_ok(
  $$ insert into draft_budget_adjustments
       (draft_id, league_id, team_id, delta, adjustment_after, action_id, result)
     values ('e8a60000-0000-4000-8000-0000000000aa', 'b8a60000-0000-4000-8000-0000000000aa',
             'c8a60000-0000-4000-8000-000000000001', -1, -41, null, '{}'::jsonb) $$,
  '42501', null,
  'member INSERT is refused outright (no write policy) — the record is written only inside the DEFINER verb (§8.1)');
select results_eq(
  $$ with w as (update draft_budget_adjustments set delta = 99
                where draft_id = 'e8a60000-0000-4000-8000-0000000000aa' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'member UPDATE affects 0 rows (RETURNING-count; sees 5, changes none — the record of a landed edit is append-only)');
select results_eq(
  $$ with d as (delete from draft_budget_adjustments
                where draft_id = 'e8a60000-0000-4000-8000-0000000000aa' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'member DELETE affects 0 rows (RETURNING-count)');
select set_config('request.jwt.claims',
  '{"sub": "8ea60000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select count(*)::int from draft_budget_adjustments
   where draft_id = 'e8a60000-0000-4000-8000-0000000000aa'),
  0,
  'a NON-MEMBER sees 0 rows (the SELECT policy scopes by league membership, proven against the privileged row-exists pin above)');
reset role;

select * from finish();
rollback;
