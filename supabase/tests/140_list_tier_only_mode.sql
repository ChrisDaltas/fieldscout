-- ============================================================================
-- Migration 191 — tiers without numbers (Chris, 2026-10-15: "allow tiers
-- without numbers").
--
-- `lists.ranking_mode` gains a fourth value, 'tier_only': players grouped
-- under Tier 1, Tier 2… headings with no 1-2-3 numbers. The Ranked and Tiers
-- switches are now independent, so the four values are exactly the four
-- combinations of the legacy boolean pair:
--
--   ranking_mode    hide_order  tiers_enabled   Ranked  Tiers
--   unranked        true        false           off     off
--   ranked          false       false           on      off
--   rank_and_tier   false       true            on      on
--   tier_only       true        true            off     on
--
-- Pinned here:
--   1. The CHECK accepts all four values and still refuses anything else
--      (23514), under its original name `lists_ranking_mode_check` — the API
--      recognises a pre-191 database by that name and answers a clear 409.
--   2. `duplicate_list` copies a tier-only list as tier-only, with the flag
--      pair above (hide_order true, tiers_enabled true) and its tiers; the
--      three older modes keep the pairs they always had. It stays SECURITY
--      INVOKER with its search_path pin.
--   3. A tier-only list (hide_order true) never feeds consensus rankings —
--      its order inside a tier is not a ranking — while a ranked one does.
--   0. 191 leaves no existing list whose legacy pair disagrees with its mode.
--      012 let hide_order win, so a legacy (hide_order true, tiers_enabled
--      true) row is `unranked` — a pair that reads `tier_only` under 191 —
--      and 191 re-derives it to (unranked, true, false). This reads the real
--      table before any fixture is made, with a positive control showing the
--      query does catch such a row.
--
-- Determinism: fixed UUIDs and literals, privileged fixture work only; the
-- duplicates run as the fixture owner (auth.uid() from request.jwt.claims).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(21);

-- ---------------------------------------------------------------------------
-- 0. Existing rows: the pair agrees with the mode (before any fixture).
-- ---------------------------------------------------------------------------
create temp view legacy_pair_mismatch as
  select id, ranking_mode, hide_order, tiers_enabled
    from lists
   where hide_order is distinct from (ranking_mode in ('unranked', 'tier_only'))
      or tiers_enabled is distinct from (ranking_mode in ('rank_and_tier', 'tier_only'));

select is(
  (select count(*)::int from legacy_pair_mismatch), 0,
  '191 left no list whose hide_order / tiers_enabled disagree with its ranking_mode');

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-tieronly1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "tier_only_owner"}', now(), now());

insert into players (id, full_name, position) values
  ('pgtap-tieronly-p1', 'PgTap TierOnly RB', 'RB'),
  ('pgtap-tieronly-p2', 'PgTap TierOnly WR', 'WR');

-- A plain ranked list to switch between modes.
insert into lists (id, owner_id, title, slug, ranking_mode) values
  ('99100000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
   'tier only probe', 'tier-only-probe', 'ranked');

select is(
  (select ranking_mode from lists where id = '99100000-0000-4000-8000-000000000001'),
  'ranked', 'positive control: the probe list exists, so a 0-row update below cannot pass for a guard');

-- Positive control for 0.: a legacy (unranked, true, true) row — what 012's
-- backfill made of hide_order + tiers — is exactly what the query catches.
insert into lists (id, owner_id, title, slug, ranking_mode, hide_order, tiers_enabled) values
  ('99100000-0000-4000-8000-000000000009', '91000000-0000-4000-8000-000000000001',
   'legacy hidden tiers', 'legacy-hidden-tiers', 'unranked', true, true);
select is(
  (select array_agg(id::text) from legacy_pair_mismatch
    where id = '99100000-0000-4000-8000-000000000009'),
  array['99100000-0000-4000-8000-000000000009'],
  'positive control: the mismatch query catches a legacy (unranked, hide_order, tiers_enabled) row');

-- ---------------------------------------------------------------------------
-- 1. The CHECK: four values, nothing else, same name.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update lists set ranking_mode = 'tier_only', hide_order = true, tiers_enabled = true
      where id = '99100000-0000-4000-8000-000000000001' $$,
  'tier_only is a valid ranking_mode');
select is(
  (select ranking_mode from lists where id = '99100000-0000-4000-8000-000000000001'),
  'tier_only', 'the tier_only write stuck (not a silent 0-row update)');

select lives_ok(
  $$ insert into lists (owner_id, title, slug, ranking_mode)
     select '91000000-0000-4000-8000-000000000001', 'mode ' || m, 'mode-' || replace(m, '_', '-'), m
       from unnest(array['unranked', 'ranked', 'rank_and_tier', 'tier_only']) as m $$,
  'all four modes are accepted on insert');

select throws_ok(
  $$ update lists set ranking_mode = 'tiers' where id = '99100000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an unknown mode is still refused (23514)');
select throws_ok(
  $$ update lists set ranking_mode = 'Tier_Only' where id = '99100000-0000-4000-8000-000000000001' $$,
  '23514', null, 'modes are exact (case-sensitive)');
select throws_like(
  $$ update lists set ranking_mode = '' where id = '99100000-0000-4000-8000-000000000001' $$,
  '%lists_ranking_mode_check%',
  'the refusal still names lists_ranking_mode_check — the name the API keys its "not yet" 409 on');

select is(
  (select string_agg(c.conname::text || ':' || (pg_get_constraintdef(c.oid) like '%tier_only%')::text, ',')
     from pg_constraint c
    where c.conrelid = 'public.lists'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%ranking_mode%'),
  'lists_ranking_mode_check:true',
  'lists_ranking_mode_check is the one CHECK on ranking_mode, and it names tier_only');

-- ---------------------------------------------------------------------------
-- 2. duplicate_list
-- ---------------------------------------------------------------------------
insert into list_players (id, list_id, player_id, position, tier) values
  ('a9100000-0000-4000-8000-000000000001', '99100000-0000-4000-8000-000000000001', 'pgtap-tieronly-p1', 1, 'S'),
  ('a9100000-0000-4000-8000-000000000002', '99100000-0000-4000-8000-000000000001', 'pgtap-tieronly-p2', 2, 'A');

insert into lists (id, owner_id, title, slug, ranking_mode, hide_order, tiers_enabled) values
  ('99100000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'dup unranked', 'dup-unranked', 'unranked', true, false),
  ('99100000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', 'dup ranked', 'dup-ranked', 'ranked', false, false),
  ('99100000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000001', 'dup tiered', 'dup-tiered', 'rank_and_tier', false, true);

select set_config('request.jwt.claims',
  '{"sub": "91000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

create temp table dup_out on commit drop as
  select 'tier_only'::text as src, d.* from duplicate_list('99100000-0000-4000-8000-000000000001', 'tier only probe (Copy)', 'tier-only-probe-copy') d
  union all
  select 'unranked', d.* from duplicate_list('99100000-0000-4000-8000-000000000002', 'dup unranked (Copy)', 'dup-unranked-copy') d
  union all
  select 'ranked', d.* from duplicate_list('99100000-0000-4000-8000-000000000003', 'dup ranked (Copy)', 'dup-ranked-copy') d
  union all
  select 'rank_and_tier', d.* from duplicate_list('99100000-0000-4000-8000-000000000004', 'dup tiered (Copy)', 'dup-tiered-copy') d;

reset role;

select is(
  (select count(*)::int from dup_out), 4,
  'positive control: all four duplicates were made');

select is(
  (select ranking_mode from dup_out where src = 'tier_only'), 'tier_only',
  'a tier-only list duplicates as tier-only');
select is(
  (select array[hide_order, tiers_enabled] from dup_out where src = 'tier_only'), array[true, true],
  'the tier-only copy carries hide_order = true, tiers_enabled = true');
select results_eq(
  $$ select lp.player_id, lp.tier, lp.position
       from list_players lp join dup_out d on d.id = lp.list_id
      where d.src = 'tier_only' order by lp.position $$,
  $$ values ('pgtap-tieronly-p1'::text, 'S'::text, 1), ('pgtap-tieronly-p2', 'A', 2) $$,
  'the tier-only copy keeps its players'' tiers and order');

select is(
  (select array[hide_order, tiers_enabled] from dup_out where src = 'unranked'), array[true, false],
  'unranked still duplicates with hide_order = true, tiers_enabled = false');
select is(
  (select array[hide_order, tiers_enabled] from dup_out where src = 'ranked'), array[false, false],
  'ranked still duplicates with hide_order = false, tiers_enabled = false');
select is(
  (select array[hide_order, tiers_enabled] from dup_out where src = 'rank_and_tier'), array[false, true],
  'rank_and_tier still duplicates with hide_order = false, tiers_enabled = true');
select is(
  (select array_agg(ranking_mode order by src) from dup_out),
  array['rank_and_tier', 'ranked', 'tier_only', 'unranked'],
  'every copy keeps its source''s mode');

select ok(
  (select not p.prosecdef and coalesce(p.proconfig, array[]::text[]) @> array['search_path=public, pg_temp']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'duplicate_list'),
  'duplicate_list stays SECURITY INVOKER with its search_path pin');

-- ---------------------------------------------------------------------------
-- 3. Consensus: a tier-only list is not a ranking.
-- ---------------------------------------------------------------------------
-- The probe list is tier-only (hide_order true) and public, with p1 at
-- overall_rank 1. Consensus must not count it.
update list_players set overall_rank = position
 where list_id = '99100000-0000-4000-8000-000000000001';
refresh materialized view consensus_rankings;
select is(
  (select count(*)::int from consensus_rankings where player_id = 'pgtap-tieronly-p1'), 0,
  'a tier-only list does not feed consensus rankings');

-- Flip the same list to ranked (the API's flag pair) — now it counts.
update lists set ranking_mode = 'ranked', hide_order = false, tiers_enabled = false
 where id = '99100000-0000-4000-8000-000000000001';
refresh materialized view consensus_rankings;
select is(
  (select ranker_count::int from consensus_rankings where player_id = 'pgtap-tieronly-p1'), 1,
  'positive control: the same list, ranked, does feed consensus');

select * from finish();
rollback;
