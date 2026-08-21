-- ============================================================================
-- Auction realtime — migration 088 (task L.C1.6; spec §9 ALL/§9.1/§9.2/
-- §9.3, §12.5 (`voided_at`, v2.12.2/v2.12.4), §12.14 (the trigger
-- inventory's draft_bids row, v2.12.6); delivery plan §8.4; tasks-M3 §4
-- rule 5 (realtime doctrine, LITERAL), §6 L.C1.6 AS AMENDED (R372/R379);
-- D133/D134/D137/D109/D162; PROGRESS F58 + F69 — BOTH discharged here).
-- pgTAP file is **037** (036 = auction commissioner controls; next free
-- confirmed at task time — 088 is the next-free MIGRATION above 087 with
-- 090 already landed, tasks-M3 §7's confirm-at-task-time policy).
--
-- Falsifiability notes (§4.3):
--   * PAYLOAD-SHAPE UNIT PINS (task item 4): the bid payload's EXACT key
--     set (6 — `voided_at` IN it, F69 (a)) + named negatives (action_id —
--     THE DoD break-probe target — ids); the VOID summary payload's exact
--     key set (3) + a stored-literal golden over an out-of-order, duplicate
--     -pair input (ordering + DISTINCT proven, not assumed) + named
--     negatives (no amounts/teams/ids — the bulk rule's per-row payload by
--     another name); the drafts payload at 10 keys (+current_nomination,
--     +budget_adjustments — D134) still excluding config/is_mock/ids/orders;
--     the picks payload at 7 (+price) still excluding action_id/picked_by/
--     made_via/ids; each as stored-literal arrays.
--     THE DoD BREAK PROBE (shown + reverted in the PR): widen
--     draft_bid_broadcast_payload to to_jsonb(b) → the exact-key pin, the
--     named-negative pin, the exact-record wire pin AND the wire-level
--     action_id negative go RED.
--   * THE F69 DECISION IS BEHAVIORALLY PINNED, not asserted: through the
--     REAL VERBS (nominate → raise → pause → cancel → resume → renominate →
--     budget edit → reset; and a paused cascade UNDO on a second world),
--     realtime.messages is read back after each step — the INSERT event's
--     exact record, the void event's EXACT record ({voided_at,
--     voided_count, nominations}), ONE void event per void STATEMENT (cancel
--     = 1; undo = 2 — the helper's live void then the rewind sweep, each
--     its own statement and its own event, with DIFFERENT nominations
--     named; reset = 1 for the whole run), and the BULK pin — a 40-row /
--     10-nomination sweep in ONE statement emits EXACTLY ONE event (not
--     40) while the 40 INSERTs emitted 40 (the per-row INSERT trigger as the
--     positive control). The column discriminator is pinned from three
--     sides: a zero-row stamp, a non-void-column UPDATE, and a RE-stamp of
--     already-voided rows each add NOTHING.
--   * D133 (Client Broadcast stays closed) re-pinned on an AUCTION topic:
--     the four 070 policies exactly; a MEMBER's extension='broadcast'
--     INSERT refused (42501) while presence is allowed; outsider refused.
--   * CHANNEL AUTH for the new event: a MEMBER reads the draft_bids rows on
--     their draft topic; an OUTSIDER and ANON read ZERO (the behavioral
--     half of the wire suite's "a non-member hears nothing").
--   * F58 MADE FALSIFIABLE (the 065/070 inventory-pin pattern, landed HERE
--     because this is the migration that makes broadcast real for the 083
--     family): after the draft_bids triggers exist, draft_dnd_marks carries
--     ZERO non-internal triggers and appears in NO publication; NO pg_proc
--     body in `public` references `draft_dnd_marks` (the engine never reads
--     it — C42); the publication still carries none of the M3 tables (D89
--     re-pinned); and draft_bids carries EXACTLY its two broadcast triggers
--     (the positive control that the inventory query sees triggers).
--   * All privileged fixture work runs BEFORE any JWT claims (D49(7));
--     mid-test privileged pins use `reset role` (013/014/018 pattern).
--     realtime.send() does SET LOCAL realtime.topic as a side effect, so
--     every role-scoped read sets its own realtime.topic explicitly.
--   * A DO-block guard creates today's realtime.messages partition if the
--     realtime service hasn't yet (post-reset race) — rolled back with the
--     rest of the file. The whole file rolls back; the live Realtime
--     service never sees these rows.
--   * Golden values are stored literals (§4.3); counts on the fixture's own
--     topics are EXACT (the topics are minted here — no concurrent actor
--     can write to them).
-- ============================================================================
begin;
select plan(74);

-- ---------------------------------------------------------------------------
-- A. Form pins (§4.1 grants doctrine; §9.2 printed pattern; D137 — the 070
--    trigger functions are NOT replaced, the payload functions are)
-- ---------------------------------------------------------------------------
select has_function('public', 'draft_bid_broadcast_payload', array['draft_bids'],
  'draft_bid_broadcast_payload(draft_bids) exists (the bid column-select unit — 088 item 1)');
select has_function('public', 'draft_bid_void_broadcast_payload', array['draft_bids[]'],
  'draft_bid_void_broadcast_payload(draft_bids[]) exists (the per-statement VOID summary unit — 088 item 3)');
select ok(
  (select count(*) = 2 and bool_and(not p.prosecdef)
       and bool_and(array_to_string(p.proconfig, ',') = 'search_path=""')
       and bool_and(p.provolatile = 's')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_bid_broadcast_payload', 'draft_bid_void_broadcast_payload')),
  'both bid payload functions are PLAIN (non-SECURITY-DEFINER), STABLE internals with the exact search_path (the 062/070 form)');
select ok(
  not has_function_privilege('anon', 'public.draft_bid_broadcast_payload(public.draft_bids)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_bid_broadcast_payload(public.draft_bids)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_bid_void_broadcast_payload(public.draft_bids[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_bid_void_broadcast_payload(public.draft_bids[])', 'EXECUTE'),
  'both bid payload functions are REVOKEd from anon AND authenticated');
select ok(
  (select count(*) = 2 and bool_and(p.prosecdef)
       and bool_and(array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('broadcast_draft_bid_insert', 'broadcast_draft_bid_void')),
  'both bid trigger functions are SECURITY DEFINER with the exact §9.2 search_path (printed pattern)');
select ok(
  not has_function_privilege('anon', 'public.broadcast_draft_bid_insert()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.broadcast_draft_bid_insert()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.broadcast_draft_bid_void()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.broadcast_draft_bid_void()', 'EXECUTE'),
  'both bid trigger functions are REVOKEd from anon AND authenticated (hygiene — they fire as owner)');

select has_trigger('public', 'draft_bids', 'tr_broadcast_draft_bids',
  'draft_bids carries its INSERT broadcast trigger (088; §12.14 row filled — standing rule 5 literal)');
select is(
  (select array_agg(distinct event_manipulation::text || '/' || action_orientation::text
                    order by event_manipulation::text || '/' || action_orientation::text)
   from information_schema.triggers
   where trigger_schema = 'public' and trigger_name = 'tr_broadcast_draft_bids'),
  array['INSERT/ROW'],
  'tr_broadcast_draft_bids fires on INSERT only, FOR EACH ROW (a bid is never bulk — one event per bid row)');
select has_trigger('public', 'draft_bids', 'tr_broadcast_draft_bids_void',
  'draft_bids carries its VOID broadcast trigger (088 banner item 2 — the F69 decision)');
select is(
  (select array_agg(distinct event_manipulation::text || '/' || action_orientation::text
                    order by event_manipulation::text || '/' || action_orientation::text)
   from information_schema.triggers
   where trigger_schema = 'public' and trigger_name = 'tr_broadcast_draft_bids_void'),
  array['UPDATE/STATEMENT'],
  'tr_broadcast_draft_bids_void fires on UPDATE, FOR EACH STATEMENT — one event per void statement, never per row (the R379 bulk rule)');
select is(
  (select t.tgoldtable || '|' || t.tgnewtable
   from pg_trigger t where t.tgrelid = 'public.draft_bids'::regclass
     and t.tgname = 'tr_broadcast_draft_bids_void'),
  'before_rows|after_rows',
  'the void trigger declares BOTH transition tables (OLD before_rows / NEW after_rows) — the in-body NULL→non-NULL discrimination needs both (Postgres forbids `UPDATE OF col` alongside transition tables)');
select is(
  (select count(*) from pg_trigger t
   where t.tgrelid = 'public.draft_bids'::regclass and not t.tgisinternal),
  2::bigint,
  'draft_bids carries EXACTLY two non-internal triggers — the INSERT and the VOID broadcast (the positive control for the F58 absence pins below: the inventory query sees triggers where they exist)');

-- The 070 payload functions were REPLACED (D137, at HEAD); their 070
-- trigger callers were not — one definition each, still the 070 bodies.
select ok(
  (select count(*) = 2 and bool_and(p.prosecdef)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('broadcast_draft_update', 'broadcast_draft_pick_change')),
  '070''s drafts/draft_picks trigger functions still exist as SECURITY DEFINER singletons — 088 replaced the PAYLOAD units they call, not the callers (D137 head rule: 070 is the only prior definition of both payload functions)');

-- F58 (a): draft_dnd_marks — NO trigger of any kind, NO publication.
select is(
  (select count(*) from pg_trigger t
   where t.tgrelid = 'public.draft_dnd_marks'::regclass and not t.tgisinternal),
  0::bigint,
  'F58(a): draft_dnd_marks carries ZERO non-internal triggers AFTER 088 created the draft_bids triggers — never broadcast (§9.2 blind prep; 083 banner)');
select is(
  (select count(*) from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('draft_dnd_marks', 'draft_bids', 'drafts', 'draft_picks',
                       'draft_queues', 'draft_liveness')),
  0::bigint,
  'F58(a) + D89 re-pinned: the supabase_realtime publication carries NONE of the draft-family tables — draft_dnd_marks AND draft_bids included (Broadcast-from-DB needs no publication; Postgres Changes stays off)');
-- F58 (b): the engine never reads draft_dnd_marks — source-level sweep.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%draft_dnd_marks%'),
  0::bigint,
  'F58(b): ZERO pg_proc bodies in public reference draft_dnd_marks — no RPC/trigger/worker joins it (C42 display-only, ruled; the 065/070 prosrc-sweep pattern)');

-- D133: the realtime.messages policy surface is EXACTLY 070's.
select policies_are('realtime', 'messages', array[
    'members read league topics',
    'members read draft topics',
    'members track presence on league topics',
    'members track presence on draft topics'],
  'D133: realtime.messages still carries EXACTLY the four 070 policies — 088 opened NO client-broadcast write (Client Broadcast stays closed)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any JWT claims; D49(7)).
--    u1 commissions LA (auction) + LS (snake); u2 manages LA's t2; u3 is a
--    member of NO league (the outsider). Worlds:
--      LA/DA  the REAL-VERB world: nominate → raise → pause → cancel →
--             resume → renominate → budget edit → reset         §C
--      LB/DB  the BULK world: 40 privileged bid rows, 10 nominations, one
--             sweep statement; + a priced pick for the price pin   §D
--      LC/DC  the UNDO world: paused, two awarded picks (seq 1, 2) with
--             their bids + a live nomination at seq 3 with two bids — a
--             cascade undo to seq 1 emits TWO void events         §E
--      LS/DS  the SNAKE world: a reset emits ZERO draft_bids events §F
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('96000000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated',
  'pgtap-rt6-u' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  ('{"username": "rt6_user_' || i || '"}')::jsonb,
  now(), now()
from generate_series(1, 3) i;

insert into players (id, full_name, position, adp)
select 'rt6-rb' || lpad(i::text, 2, '0'), 'RT6 RB ' || lpad(i::text, 2, '0'),
       'RB', i / 1000.0
from generate_series(1, 14) i;

-- Three auction leagues (8 seats — the smallest legal team_count), 3
-- draftable slots each (1 starter + 2 bench — D91), $200 / min $1.
insert into leagues (id, owner_id, name, season, status, team_count,
                     scoring_system_id, settings, scoring_rules_snapshot, roster_settings)
select ('b6000000-0000-4000-8000-0000000000' || w.sfx)::uuid,
       '96000000-0000-4000-8000-000000000001',
       'pgtap-rt6-' || w.nm, 2026, 'drafting', 8, null,
       ('{"draft": {"auction_budget": 200, "auction_zero_dollar_nominations": false,
          "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
          "auction_anti_snipe_seconds": 10, "disconnect_grace_seconds": 30,
          "pick_timer_seconds": 90}}')::jsonb,
       '{}'::jsonb,
       '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
         "bench": 2, "ir_slots": [], "swap_spots": 0}'::jsonb
from (values ('aa', 'LA-verbs'), ('bb', 'LB-bulk'), ('cc', 'LC-undo'), ('dd', 'LS-snake')) as w(sfx, nm);

insert into teams (id, owner_id, name, league_id)
select ('c6000000-0000-4000-8000-00' || w.sfx || '0000000' || i)::uuid,
       '96000000-0000-4000-8000-000000000001',
       'pgtap-rt6-' || w.sfx || '-t' || i,
       ('b6000000-0000-4000-8000-0000000000' || w.sfx)::uuid
from (values ('aa'), ('bb'), ('cc'), ('dd')) as w(sfx), generate_series(1, 8) i;

-- u1 commissions every world on t1; u2 manages t2 in every world.
insert into league_members (league_id, user_id, team_id, role)
select ('b6000000-0000-4000-8000-0000000000' || w.sfx)::uuid,
       ('96000000-0000-4000-8000-00000000000' || m.u)::uuid,
       ('c6000000-0000-4000-8000-00' || w.sfx || '0000000' || m.t)::uuid,
       m.r
from (values ('aa'), ('bb'), ('cc'), ('dd')) as w(sfx),
     (values (1, 1, 'commissioner'), (2, 2, 'manager')) as m(u, t, r);

-- DA (live, nominating, t1 on the clock) + DB (live, idle fixture target).
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    draft_order, nomination_order, total_rounds, current_round,
                    current_pick_number, on_clock_team_id, current_deadline,
                    started_at)
select ('d6000000-0000-4000-8000-0000000000' || w.sfx)::uuid,
       ('b6000000-0000-4000-8000-0000000000' || w.sfx)::uuid,
       'auction', 'live', false,
       '{"auction_budget": 200, "auction_zero_dollar_nominations": false,
         "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
         "auction_anti_snipe_seconds": 10, "disconnect_grace_seconds": 30,
         "pick_timer_seconds": 90}'::jsonb,
       (select jsonb_agg(t.id order by t.name) from teams t
        where t.league_id = ('b6000000-0000-4000-8000-0000000000' || w.sfx)::uuid),
       (select jsonb_agg(t.id order by t.name) from teams t
        where t.league_id = ('b6000000-0000-4000-8000-0000000000' || w.sfx)::uuid),
       3, 1, 1,
       ('c6000000-0000-4000-8000-00' || w.sfx || '00000001')::uuid,
       now() + interval '1 hour', now() - interval '1 minute'
from (values ('aa'), ('bb')) as w(sfx);

-- DC: PAUSED mid-BIDDING at seq 3 (t3 nominated rt6-rb13, t4 raised to $6)
-- with seq 1 and seq 2 already AWARDED (picks + their bid rows).
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    draft_order, nomination_order, total_rounds, current_round,
                    current_pick_number, on_clock_team_id, current_nomination,
                    current_deadline, deadline_remaining_ms, started_at)
values ('d6000000-0000-4000-8000-0000000000cc',
        'b6000000-0000-4000-8000-0000000000cc', 'auction', 'paused', false,
        '{"auction_budget": 200, "auction_zero_dollar_nominations": false,
          "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
          "auction_anti_snipe_seconds": 10, "disconnect_grace_seconds": 30,
          "pick_timer_seconds": 90}'::jsonb,
        (select jsonb_agg(t.id order by t.name) from teams t
         where t.league_id = 'b6000000-0000-4000-8000-0000000000cc'),
        (select jsonb_agg(t.id order by t.name) from teams t
         where t.league_id = 'b6000000-0000-4000-8000-0000000000cc'),
        3, 1, 3,
        'c6000000-0000-4000-8000-00cc00000003',
        '{"player_id": "rt6-rb13", "high_bid": 6,
          "high_bidder_team_id": "c6000000-0000-4000-8000-00cc00000004"}'::jsonb,
        null, 20000, now() - interval '1 minute');
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via) values
  ('d6000000-0000-4000-8000-0000000000cc', 'b6000000-0000-4000-8000-0000000000cc',
   1, null, 'c6000000-0000-4000-8000-00cc00000001', 'rt6-rb11', 3, false, 'manager'),
  ('d6000000-0000-4000-8000-0000000000cc', 'b6000000-0000-4000-8000-0000000000cc',
   2, null, 'c6000000-0000-4000-8000-00cc00000003', 'rt6-rb12', 4, false, 'manager');
-- Bid history consistent with the two awards above: seq 1 (t1 opens $1,
-- t2 raises to $2, t1 retakes at $3 — t1 won at $3); seq 2 (t2 opens $2,
-- t3 raises to $4 — t3 won at $4); seq 3 LIVE (t3 opens $3, t4 raises to
-- $6). created_at staggered so the opening row is the earliest per seq
-- (087's on-clock recovery reads the earliest row at the rewound seq).
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id,
                        amount, created_at) values
  ('d6000000-0000-4000-8000-0000000000cc', 'b6000000-0000-4000-8000-0000000000cc',
   1, 'rt6-rb11', 'c6000000-0000-4000-8000-00cc00000001', 1, now() - interval '50 seconds'),
  ('d6000000-0000-4000-8000-0000000000cc', 'b6000000-0000-4000-8000-0000000000cc',
   1, 'rt6-rb11', 'c6000000-0000-4000-8000-00cc00000002', 2, now() - interval '49 seconds'),
  ('d6000000-0000-4000-8000-0000000000cc', 'b6000000-0000-4000-8000-0000000000cc',
   1, 'rt6-rb11', 'c6000000-0000-4000-8000-00cc00000001', 3, now() - interval '48 seconds'),
  ('d6000000-0000-4000-8000-0000000000cc', 'b6000000-0000-4000-8000-0000000000cc',
   2, 'rt6-rb12', 'c6000000-0000-4000-8000-00cc00000002', 2, now() - interval '40 seconds'),
  ('d6000000-0000-4000-8000-0000000000cc', 'b6000000-0000-4000-8000-0000000000cc',
   2, 'rt6-rb12', 'c6000000-0000-4000-8000-00cc00000003', 4, now() - interval '39 seconds'),
  ('d6000000-0000-4000-8000-0000000000cc', 'b6000000-0000-4000-8000-0000000000cc',
   3, 'rt6-rb13', 'c6000000-0000-4000-8000-00cc00000003', 3, now() - interval '30 seconds'),
  ('d6000000-0000-4000-8000-0000000000cc', 'b6000000-0000-4000-8000-0000000000cc',
   3, 'rt6-rb13', 'c6000000-0000-4000-8000-00cc00000004', 6, now() - interval '29 seconds');

-- DS: the SNAKE world, live, pick 2 on the clock (one pick made — a reset
-- has something to reset).
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    draft_order, total_rounds, current_round,
                    current_pick_number, on_clock_team_id, current_deadline,
                    started_at)
values ('d6000000-0000-4000-8000-0000000000dd',
        'b6000000-0000-4000-8000-0000000000dd', 'snake', 'live', false,
        '{"pick_timer_seconds": 90, "disconnect_grace_seconds": 30}'::jsonb,
        (select jsonb_agg(t.id order by t.name) from teams t
         where t.league_id = 'b6000000-0000-4000-8000-0000000000dd'),
        3, 1, 2,
        'c6000000-0000-4000-8000-00dd00000002',
        now() + interval '1 hour', now() - interval '1 minute');
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, is_auto, made_via) values
  ('d6000000-0000-4000-8000-0000000000dd', 'b6000000-0000-4000-8000-0000000000dd',
   1, 1, 'c6000000-0000-4000-8000-00dd00000001', 'rt6-rb14', false, 'manager');

-- Post-reset race guard (the 024 pattern): today's + tomorrow's
-- realtime.messages partitions exist for the stored-row reads below.
do $part$
declare
  d date;
  part_name text;
begin
  foreach d in array array[current_date, current_date + 1] loop
    part_name := 'messages_' || to_char(d, 'YYYY_MM_DD');
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'realtime' and c.relname = part_name
    ) then
      execute format(
        'create table realtime.%I partition of realtime.messages for values from (%L) to (%L)',
        part_name, d::timestamp, (d + 1)::timestamp);
    end if;
  end loop;
end
$part$;

-- The fixture INSERTs above already fired the INSERT trigger on DC's and
-- the pick trigger on DC/DS — clear the decks so every topic count below is
-- EXACT and attributable to the step that produced it.
delete from realtime.messages where topic like 'draft:d6000000-0000-4000-8000-0000000000%';

-- ---------------------------------------------------------------------------
-- C. Payload-shape unit pins (task item 4 — stored literals)
-- ---------------------------------------------------------------------------
-- A constructed bid row with EVERY column populated (action_id set, voided
-- NULL) — the unit must drop action_id and the ids and keep the six.
create temporary table rt6_bid_row on commit drop as
select row('e6000000-0000-4000-8000-000000000001'::uuid,
           'd6000000-0000-4000-8000-0000000000aa'::uuid,
           'b6000000-0000-4000-8000-0000000000aa'::uuid,
           4, 'rt6-rb01', 'c6000000-0000-4000-8000-00aa00000002'::uuid, 12,
           'aa000000-0000-4000-8000-000000000099'::uuid,
           '2026-08-19T12:00:00+00'::timestamptz, null::timestamptz)::draft_bids as b;
select is(
  (select array_agg(k order by k) from rt6_bid_row x, jsonb_object_keys(public.draft_bid_broadcast_payload(x.b)) k),
  array['amount', 'created_at', 'nomination_seq', 'player_id', 'team_id', 'voided_at'],
  'bid payload = EXACTLY {nomination_seq, player_id, team_id, amount, created_at, voided_at} — 6 keys, voided_at IN the set (F69 (a)), stored literal');
select ok(
  (select not public.draft_bid_broadcast_payload(x.b) ?| array['action_id', 'id', 'draft_id', 'league_id']
   from rt6_bid_row x),
  'bid payload NEVER carries action_id (another client''s idempotency key — THE break-probe target), id, draft_id or league_id (named negatives)');
select is(
  (select public.draft_bid_broadcast_payload(x.b) from rt6_bid_row x),
  '{"amount": 12, "team_id": "c6000000-0000-4000-8000-00aa00000002", "player_id": "rt6-rb01", "voided_at": null, "created_at": "2026-08-19T12:00:00+00:00", "nomination_seq": 4}'::jsonb,
  'bid payload exact-jsonb golden on a fully populated row (action_id present on the row, absent on the wire; voided_at carried as NULL)');

-- The VOID summary: three rows, TWO nominations, fed OUT OF ORDER with a
-- duplicate (seq, player) pair — the unit must DISTINCT and ORDER.
create temporary table rt6_void_rows on commit drop as
select array[
  row(gen_random_uuid(), 'd6000000-0000-4000-8000-0000000000aa'::uuid, 'b6000000-0000-4000-8000-0000000000aa'::uuid,
      2, 'rt6-rb02', 'c6000000-0000-4000-8000-00aa00000003'::uuid, 9, null::uuid,
      '2026-08-19T12:00:05+00'::timestamptz, '2026-08-19T12:10:00+00'::timestamptz)::draft_bids,
  row(gen_random_uuid(), 'd6000000-0000-4000-8000-0000000000aa'::uuid, 'b6000000-0000-4000-8000-0000000000aa'::uuid,
      1, 'rt6-rb01', 'c6000000-0000-4000-8000-00aa00000001'::uuid, 5, 'aa000000-0000-4000-8000-000000000098'::uuid,
      '2026-08-19T12:00:01+00'::timestamptz, '2026-08-19T12:10:00+00'::timestamptz)::draft_bids,
  row(gen_random_uuid(), 'd6000000-0000-4000-8000-0000000000aa'::uuid, 'b6000000-0000-4000-8000-0000000000aa'::uuid,
      1, 'rt6-rb01', 'c6000000-0000-4000-8000-00aa00000002'::uuid, 7, null::uuid,
      '2026-08-19T12:00:02+00'::timestamptz, '2026-08-19T12:10:00+00'::timestamptz)::draft_bids
] as rows_;
select is(
  (select array_agg(k order by k) from rt6_void_rows x, jsonb_object_keys(public.draft_bid_void_broadcast_payload(x.rows_)) k),
  array['nominations', 'voided_at', 'voided_count'],
  'void payload = EXACTLY {voided_at, voided_count, nominations} — 3 keys (088 banner item 2), stored literal');
select is(
  (select public.draft_bid_void_broadcast_payload(x.rows_) from rt6_void_rows x),
  '{"voided_at": "2026-08-19T12:10:00+00:00", "nominations": [{"player_id": "rt6-rb01", "nomination_seq": 1}, {"player_id": "rt6-rb02", "nomination_seq": 2}], "voided_count": 3}'::jsonb,
  'void payload GOLDEN: 3 rows / 2 nominations fed out of order with a duplicate pair → voided_count 3, nominations DISTINCT and ORDERED by (seq, player), voided_at = the stamp (exact-jsonb equality)');
select ok(
  (select not (public.draft_bid_void_broadcast_payload(x.rows_) ?| array['amount', 'team_id', 'action_id', 'created_at', 'id', 'rows'])
       and not (public.draft_bid_void_broadcast_payload(x.rows_)->'nominations'->0 ?| array['amount', 'team_id', 'action_id', 'created_at', 'id'])
   from rt6_void_rows x),
  'void payload carries NO per-row data (no amounts/teams/created_ats/ids, top level or per nomination) — the bulk rule''s per-row payload by another name is excluded (named negatives)');
select is(
  public.draft_bid_void_broadcast_payload(array[]::draft_bids[]),
  '{"voided_at": null, "nominations": [], "voided_count": 0}'::jsonb,
  'void payload is TOTAL: an empty row set yields a well-formed {null, [], 0} (the trigger never sends it — zero voided rows ⇒ no send — but the unit does not throw)');

-- drafts (10 keys) + draft_picks (7 keys) — the D134 extensions.
select is(
  (select array_agg(k order by k)
   from drafts d, jsonb_object_keys(public.draft_broadcast_payload(d)) k
   where d.id = 'd6000000-0000-4000-8000-0000000000aa'),
  array['budget_adjustments', 'current_deadline', 'current_nomination', 'current_pick_number',
        'current_round', 'deadline_remaining_ms', 'on_clock_team_id', 'paused_at', 'status',
        'updated_at'],
  'drafts payload = the 070 eight + current_nomination + budget_adjustments (D134) — 10 keys, stored literal');
select ok(
  (select not public.draft_broadcast_payload(d) ?| array['config', 'is_mock', 'id', 'league_id',
                                                         'draft_order', 'nomination_order',
                                                         'started_at', 'completed_at', 'created_at']
   from drafts d where d.id = 'd6000000-0000-4000-8000-0000000000aa'),
  'drafts payload STILL excludes config (blind), is_mock, ids, BOTH orders and the lifecycle stamps (088 banner item 1''s stays-out list; started_at deliberately NOT a wire run key — item 3)');
select is(
  (select array_agg(k order by k)
   from (select row(gen_random_uuid(), 'd6000000-0000-4000-8000-0000000000bb'::uuid,
                    'b6000000-0000-4000-8000-0000000000bb'::uuid, 1, null::integer,
                    'c6000000-0000-4000-8000-00bb00000001'::uuid, 'rt6-rb01', 17,
                    false, false, null::uuid, 'manager', 'aa000000-0000-4000-8000-000000000097'::uuid, now())::draft_picks as p) x,
        jsonb_object_keys(public.draft_pick_broadcast_payload(x.p)) k),
  array['is_auto', 'is_undone', 'pick_number', 'player_id', 'price', 'round', 'team_id'],
  'draft_picks payload = the §5 six + price (D134) — 7 keys, stored literal');
select ok(
  (select public.draft_pick_broadcast_payload(x.p)->>'price' = '17'
       and not public.draft_pick_broadcast_payload(x.p) ?| array['action_id', 'picked_by', 'made_via',
                                                                 'id', 'league_id', 'draft_id']
   from (select row(gen_random_uuid(), 'd6000000-0000-4000-8000-0000000000bb'::uuid,
                    'b6000000-0000-4000-8000-0000000000bb'::uuid, 1, null::integer,
                    'c6000000-0000-4000-8000-00bb00000001'::uuid, 'rt6-rb01', 17,
                    false, false, null::uuid, 'manager', 'aa000000-0000-4000-8000-000000000097'::uuid, now())::draft_picks as p) x),
  'draft_picks payload carries price (17 on an auction row) and STILL excludes action_id / picked_by / made_via / ids (named negatives)');

-- ---------------------------------------------------------------------------
-- D. THE REAL-VERB WORLD (DA) — nominate → raise → pause → cancel → resume →
--    renominate → budget edit → reset, reading realtime.messages after each
--    step. u1 = commissioner on t1 (the nominator), u2 = manager on t2.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_nominate('d6000000-0000-4000-8000-0000000000aa',
       'rt6-rb01', 5, '66000000-0000-4000-8000-0000000000a1') $$,
  'DA: the on-clock manager (u1/t1) nominates rt6-rb01 at $5 through the real verb (085)');
select set_config('request.jwt.claims',
  '{"sub": "96000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_place_bid('d6000000-0000-4000-8000-0000000000aa', 7,
       '66000000-0000-4000-8000-0000000000a2', 1, 'rt6-rb01') $$,
  'DA: u2/t2 raises to $7 through the real verb (the R330 identity pair sent)');
reset role;

select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'INSERT'),
  2::bigint,
  'nominate + raise ⇒ EXACTLY two ''draft_bids'' INSERT events on draft:<DA> — one per bid row (the opening bid IS a row, F62/D157(1))');
select is(
  (select m.payload->'record' from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'INSERT'
     and (m.payload->'record'->>'amount')::int = 5),
  (select jsonb_build_object('nomination_seq', 1, 'player_id', 'rt6-rb01',
                             'team_id', 'c6000000-0000-4000-8000-00aa00000001',
                             'amount', 5, 'created_at', b.created_at, 'voided_at', null)
   from draft_bids b
   where b.draft_id = 'd6000000-0000-4000-8000-0000000000aa' and b.amount = 5),
  'the OPENING bid''s wire record = exactly {seq 1, rt6-rb01, t1, $5, the row''s created_at, voided_at NULL} (exact-jsonb equality against the stored row)');
select ok(
  (select bool_and(not (m.payload->'record' ? 'action_id'))
       and bool_and(m.payload->>'table' = 'draft_bids')
       and bool_and(m.payload->>'schema' = 'public')
   from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa' and m.event = 'draft_bids'),
  'NEITHER bid event carries action_id on the wire (both verbs were called WITH one) — the envelope is 070''s {operation, table, schema, record} (the wire half of the break-probe target)');
select is(
  (select m.payload->'record'->>'team_id' || '|' || (m.payload->'record'->>'amount')
   from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa'
     and m.event = 'draft_bids' and (m.payload->'record'->>'amount')::int = 7),
  'c6000000-0000-4000-8000-00aa00000002|7',
  'the RAISE''s wire record names t2 at $7 (the second event is the second row — per-row INSERT granularity)');
-- The accompanying 'drafts' events now carry the D134 pair. (Within one
-- pgTAP transaction every stored row shares one now(), so "latest" is not
-- orderable — the pins are EXISTS/COUNT over records only the named step
-- could have produced.)
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa' and m.event = 'drafts'
     and m.payload->'record'->'current_nomination'
         = '{"high_bid": 7, "player_id": "rt6-rb01", "high_bidder_team_id": "c6000000-0000-4000-8000-00aa00000002"}'::jsonb),
  1::bigint,
  'EXACTLY ONE ''drafts'' event carries current_nomination = {rt6-rb01, $7, t2} — the raise''s; the room''s centerpiece rides the drafts event (D134; 065:121''s shape)');
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa' and m.event = 'drafts'
     and m.payload->'record'->'current_nomination'
         = '{"high_bid": 5, "player_id": "rt6-rb01", "high_bidder_team_id": "c6000000-0000-4000-8000-00aa00000001"}'::jsonb),
  1::bigint,
  '…and EXACTLY ONE carries the OPENING {rt6-rb01, $5, t1} — the nomination''s (E26 structural: the nominator is seated as high bidder at $5)');
select ok(
  (select bool_and(m.payload->'record' ? 'budget_adjustments')
       and bool_and(m.payload->'record'->'budget_adjustments' = '{}'::jsonb)
   from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa' and m.event = 'drafts'),
  '…and EVERY drafts event so far carries budget_adjustments = {} (the key rides every event; the E28 edit below moves it)');

-- Pause → cancel (D143, paused-only): THE VOID EVENT.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok($$ select public.draft_pause('d6000000-0000-4000-8000-0000000000aa') $$, 'pause DA');
select lives_ok(
  $$ select public.draft_cancel_nomination('d6000000-0000-4000-8000-0000000000aa') $$,
  'DA: the commissioner cancels the live nomination on the PAUSED auction (D143 — voids both bid rows through draft_void_nomination_internal)');
reset role;
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'UPDATE'),
  1::bigint,
  'THE F69 PIN: the cancel emitted EXACTLY ONE ''draft_bids'' UPDATE (void) event — two rows stamped in one statement, one event (never one per row)');
select is(
  (select m.payload->'record' from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'UPDATE'),
  (select jsonb_build_object('voided_at', max(b.voided_at), 'voided_count', 2,
                             'nominations', '[{"player_id": "rt6-rb01", "nomination_seq": 1}]'::jsonb)
   from draft_bids b
   where b.draft_id = 'd6000000-0000-4000-8000-0000000000aa' and b.voided_at is not null),
  'the void event''s record = exactly {voided_at = the stamp, voided_count 2, nominations [{seq 1, rt6-rb01}]} — the client can strike the right rows from the event alone (exact-jsonb equality)');
select is(
  (select (m.payload->'record'->>'voided_count')::bigint from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'UPDATE'),
  (select count(*) from draft_bids b
   where b.draft_id = 'd6000000-0000-4000-8000-0000000000aa' and b.voided_at is not null),
  'voided_count on the wire = the number of rows now carrying voided_at in the table (cross-checked against the truth, not the literal)');
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa' and m.event = 'drafts'
     and jsonb_typeof(m.payload->'record'->'current_nomination') = 'null'
     and (m.payload->'record'->>'current_pick_number')::int = 1),
  2::bigint,
  'the cancel''s TWO drafts writes (the void helper clears the nomination; the verb then restores the nomination clock remainder — 087) are the only ''drafts'' events so far showing current_nomination NULL with current_pick_number still 1 (nominate/raise/pause all carried a live nomination): the phase truth rides beside the void, and a client patching from either hint lands in the nominating phase at seq 1 (D143: the seq is NOT consumed)');

-- The column discriminator, from three sides (privileged statements):
update draft_bids set voided_at = now()
where draft_id = 'd6000000-0000-4000-8000-0000000000aa' and voided_at is null;   -- 0 rows
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'UPDATE'),
  1::bigint,
  'a ZERO-ROW stamp (the helper''s `voided_at IS NULL` guard on a repeat — the statement fires the trigger, the transition table is empty) emits NOTHING — still one void event');
update draft_bids set amount = amount
where draft_id = 'd6000000-0000-4000-8000-0000000000aa';                           -- 2 rows, non-void column
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'UPDATE'),
  1::bigint,
  'an UPDATE touching a NON-void column (amount = amount, 2 rows) emits NOTHING — the in-body OLD.voided_at IS NULL → NEW IS NOT NULL discrimination, not "any UPDATE"');
update draft_bids set voided_at = now() + interval '1 second'
where draft_id = 'd6000000-0000-4000-8000-0000000000aa' and voided_at is not null; -- 2 rows, already voided
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'UPDATE'),
  1::bigint,
  'a RE-stamp of ALREADY-voided rows (OLD.voided_at NOT NULL) emits NOTHING — a void is one-way and is announced once');

-- Resume → the SAME nominator renominates the SAME player at the SAME
-- amount (the D162 tie case) — a fresh INSERT event whose tuple differs
-- from the voided row by created_at alone.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok($$ select public.draft_resume('d6000000-0000-4000-8000-0000000000aa') $$, 'resume DA');
select lives_ok(
  $$ select public.draft_nominate('d6000000-0000-4000-8000-0000000000aa',
       'rt6-rb01', 5, '66000000-0000-4000-8000-0000000000a3') $$,
  'DA: t1 renominates rt6-rb01 at $5 — same seq, same player, same amount (D143 cancel-and-renominate; the D162 tie)');
reset role;
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'INSERT'),
  3::bigint,
  'the renomination is a THIRD INSERT event (seq 1 again — the seq was not consumed)');
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'INSERT'
     and (m.payload->'record'->>'amount')::int = 5
     and jsonb_typeof(m.payload->'record'->'voided_at') = 'null'),
  2::bigint,
  'BOTH $5 openings (the voided one and the renomination) rode the wire with voided_at NULL — an INSERT never carries a stamp; the void reached the client as its own event, so a client that struck seq 1 on the void and then appends this INSERT holds exactly the live history (the wire contract a post-088 reducer implements)');

-- A budget edit (E28-legal, +$5 on t2 — not pause-gated) moves
-- budget_adjustments on the NEXT drafts event.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_adjust_budget('d6000000-0000-4000-8000-0000000000aa',
       'c6000000-0000-4000-8000-00aa00000002', 5) $$,
  'DA: the commissioner adjusts t2''s budget by +$5 (E28-legal; §8.7)');
reset role;
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa' and m.event = 'drafts'
     and m.payload->'record'->'budget_adjustments' = '{"c6000000-0000-4000-8000-00aa00000002": 5}'::jsonb),
  1::bigint,
  'EXACTLY ONE ''drafts'' event carries budget_adjustments = {t2: 5} — the adjust''s: §8.7 transparency, a budget edit is room-visible on the wire (D134)');

-- Reset (situation (c), R379): ONE void event for the whole run.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok($$ select public.draft_reset('d6000000-0000-4000-8000-0000000000aa') $$,
  'DA: the commissioner RESETS the auction (the run ends; 087 stamps the run''s live bid history — D162 (c))');
reset role;
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'UPDATE'),
  2::bigint,
  'the reset emitted EXACTLY ONE more void event (two total on DA: the cancel''s and the reset''s) — the run-end sweep is one statement, one event');
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'UPDATE'
     and (m.payload->'record') - 'voided_at'::text
         = '{"nominations": [{"player_id": "rt6-rb01", "nomination_seq": 1}], "voided_count": 1}'::jsonb),
  1::bigint,
  'the reset''s void event names ONLY the row that was still live (count 1, nominations [{1, rt6-rb01}] — the renomination); the two earlier-voided rows are not re-announced (the cancel''s event had count 2 — the two are distinguishable)');
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000aa' and m.event = 'drafts'
     and m.payload->'record'->>'status' = 'scheduled'
     and jsonb_typeof(m.payload->'record'->'current_nomination') = 'null'
     and m.payload->'record'->'budget_adjustments' = '{}'::jsonb),
  1::bigint,
  'EXACTLY ONE ''drafts'' event shows status scheduled + current_nomination NULL + budget_adjustments {} — the reset''s (R302 hygiene on the wire — a client sees the run end on the same channel that announced the void)');

-- ---------------------------------------------------------------------------
-- E. THE BULK WORLD (DB): 40 privileged bid rows across 10 nominations, then
--    ONE sweep statement — the per-statement rule at reset scale; plus the
--    priced-pick wire pin.
-- ---------------------------------------------------------------------------
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount)
select 'd6000000-0000-4000-8000-0000000000bb', 'b6000000-0000-4000-8000-0000000000bb',
       s, 'rt6-rb' || lpad(s::text, 2, '0'),
       ('c6000000-0000-4000-8000-00bb0000000' || (1 + (r % 8)))::uuid,
       r
from generate_series(1, 10) s, generate_series(1, 4) r;
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000bb'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'INSERT'),
  40::bigint,
  'BULK positive control: 40 bid rows in one INSERT statement ⇒ 40 INSERT events (FOR EACH ROW — the INSERT trigger counts rows)');
update draft_bids set voided_at = now()
where draft_id = 'd6000000-0000-4000-8000-0000000000bb' and voided_at is null;
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000bb'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'UPDATE'),
  1::bigint,
  'THE BULK PIN (R379): a 40-row / 10-nomination sweep in ONE statement (the reset shape) emits EXACTLY ONE void event — not 40 (FOR EACH STATEMENT — the void trigger counts statements)');
select is(
  (select (m.payload->'record'->>'voided_count')::int || '|'
          || jsonb_array_length(m.payload->'record'->'nominations')::text
   from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000bb'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'UPDATE'),
  '40|10',
  '…carrying voided_count 40 and EXACTLY 10 nominations (bounded by nominations, not bids)');
select is(
  (select array_agg((n->>'nomination_seq')::int order by ord)
   from realtime.messages m,
        jsonb_array_elements(m.payload->'record'->'nominations') with ordinality as e(n, ord)
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000bb'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'UPDATE'),
  array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  '…with the nominations ORDERED by seq 1..10 (stored literal — deterministic for the client''s strike loop)');
-- A priced pick rides the wire with its price (D134).
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via)
values ('d6000000-0000-4000-8000-0000000000bb', 'b6000000-0000-4000-8000-0000000000bb',
        1, null, 'c6000000-0000-4000-8000-00bb00000001', 'rt6-rb01', 17, false, 'manager');
select is(
  (select m.payload->'record' from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000bb' and m.event = 'draft_picks'),
  '{"price": 17, "round": null, "is_auto": false, "team_id": "c6000000-0000-4000-8000-00bb00000001", "is_undone": false, "player_id": "rt6-rb01", "pick_number": 1}'::jsonb,
  'an AUCTION pick INSERT broadcasts the §5 six + price 17 (round NULL — the §12.4 auction shape) on the draft topic (exact-jsonb equality)');

-- ---------------------------------------------------------------------------
-- F. THE UNDO WORLD (DC): a paused cascade undo to seq 1 voids the LIVE
--    nomination (seq 3 — the helper, statement 1) and then SWEEPS seq > 1
--    (seq 2's rows — statement 2): TWO void events, DIFFERENT nominations.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_undo('d6000000-0000-4000-8000-0000000000cc', 1) $$,
  'DC: cascade undo to seq 1 on the PAUSED auction (E29/D131(2): the live nomination is voided FIRST, then the reverted nominations)');
reset role;
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000cc'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'UPDATE'),
  2::bigint,
  'the cascade undo emitted EXACTLY TWO void events — one per void STATEMENT (the helper''s live void + the rewind sweep), the 088 banner''s stated consequence');
select is(
  (select array_agg((m.payload->'record'->'nominations')::text || '|' || (m.payload->'record'->>'voided_count')
                    order by (m.payload->'record'->'nominations'->0->>'nomination_seq')::int)
   from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000cc'
     and m.event = 'draft_bids' and m.payload->>'operation' = 'UPDATE'),
  array['[{"player_id": "rt6-rb12", "nomination_seq": 2}]|2',
        '[{"player_id": "rt6-rb13", "nomination_seq": 3}]|2'],
  'the two events name DIFFERENT nominations: the sweep''s (seq 2 / rt6-rb12, 2 rows) and the live void''s (seq 3 / rt6-rb13, 2 rows) — seq 1''s rows stay live and are named by neither; seq 3''s already-stamped rows are NOT re-announced by the sweep (keyed by seq here — stored rows share one now() in this transaction, so emission order is 087''s statement order, not something this file can read back)');
select is(
  (select count(*) from draft_bids b
   where b.draft_id = 'd6000000-0000-4000-8000-0000000000cc' and b.voided_at is null),
  3::bigint,
  '…and the table agrees: exactly seq 1''s three rows remain live (the on-clock recovery rewound to t1, seq 1''s nominator)');

-- ---------------------------------------------------------------------------
-- G. THE SNAKE WORLD (DS): a reset emits ZERO draft_bids events (the sweep
--    statement runs, matches no rows — nothing sent), while the reset's
--    other events do land (positive control).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok($$ select public.draft_reset('d6000000-0000-4000-8000-0000000000dd') $$,
  'DS: the commissioner resets the SNAKE draft (087''s sweep is not restricted to auctions — a measured no-op here)');
reset role;
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000dd' and m.event = 'draft_bids'),
  0::bigint,
  'a snake reset emits ZERO ''draft_bids'' events (no bid rows ⇒ empty transition table ⇒ no send)');
select ok(
  (select count(*) filter (where m.event = 'drafts') >= 1
       and count(*) filter (where m.event = 'draft_picks' and m.payload->>'operation' = 'UPDATE') = 1
   from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000dd'),
  '…while its ''drafts'' event(s) and the ONE undone-pick ''draft_picks'' UPDATE did land (positive control — the topic was delivering)');

-- ---------------------------------------------------------------------------
-- H. D133 on an AUCTION topic — the WRITE matrix (presence yes, broadcast
--    no, outsider nothing) and the READ matrix for the new event.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "96000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select set_config('realtime.topic', 'draft:d6000000-0000-4000-8000-0000000000bb', true);
select lives_ok(
  $$ insert into realtime.messages (topic, extension, payload, event, private)
     values ('draft:d6000000-0000-4000-8000-0000000000bb', 'presence', '{}', 'presence', true) $$,
  'a MEMBER may track presence on the AUCTION draft topic (§9.1 Presence — unchanged by 088)');
select throws_ok(
  $$ insert into realtime.messages (topic, extension, payload, event, private)
     values ('draft:d6000000-0000-4000-8000-0000000000bb', 'broadcast', '{"record": {"amount": 999}}', 'draft_bids', true) $$,
  '42501', null,
  'D133: a MEMBER may NOT client-broadcast a ''draft_bids''-shaped event on the auction topic — the server-spoof channel stays closed (070''s negative re-run with the auction event name)');
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000bb' and m.event = 'draft_bids'),
  41::bigint,
  'a MEMBER reads the draft_bids rows on their draft topic (40 INSERTs + 1 void = 41 — the §9.2 draft READ policy admits the new event like any other)');
-- Outsider u3: nothing.
select set_config('request.jwt.claims',
  '{"sub": "96000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into realtime.messages (topic, extension, payload, event, private)
     values ('draft:d6000000-0000-4000-8000-0000000000bb', 'presence', '{}', 'presence', true) $$,
  '42501', null,
  'an OUTSIDER may not even track presence on the auction topic');
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000bb' and m.event = 'draft_bids'),
  0::bigint,
  'an OUTSIDER reads ZERO draft_bids rows on the auction topic (the behavioral half of the wire suite''s "hears nothing")');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select set_config('realtime.topic', 'draft:d6000000-0000-4000-8000-0000000000bb', true);
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d6000000-0000-4000-8000-0000000000bb' and m.event = 'draft_bids'),
  0::bigint,
  'ANON reads ZERO draft_bids rows (policies are TO authenticated)');
reset role;

select * from finish();
rollback;
