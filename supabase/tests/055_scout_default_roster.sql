-- ============================================================================
-- Scout default roster — pins for migration 107's column-DEFAULT swap
-- (task SC.2; spec v2.16.9 §7.3.2 as amended by the Scout entry —
-- Chris's 2026-08-26 ruled roster, wr 2 → 3; PROGRESS F186/D283).
--
-- Three properties, per the task cut:
--   §A  The column DEFAULT is the Scout roster: a row inserted WITHOUT
--       roster_settings reads back wr count 3 — behaviorally (A1/A2), as
--       RAW BYTES (A3), and at the catalog expression itself (A4).
--   §B  NO BACKFILL: an existing league's stored roster is untouched by the
--       migration — proved on a LIVE row, not asserted from the DDL's shape:
--       a pre-migration-style wr-2 row is seeded in-test, the migration's
--       operative ALTER is replayed byte-for-byte over it, and the row's
--       raw bytes are unchanged (B1/B2) while a fresh default insert still
--       reads Scout (B3).
--   TS≡SQL — the byte bridge (R601: raw bytes, never through a serializer
--       that could mask a literal difference): A1's expected value is the
--       TS-FORM LITERAL — the exact byte string `JSON.stringify(
--       DEFAULT_ROSTER_SETTINGS)` produces — and league-settings.test.ts
--       reads THAT string out of THIS file and compares it `===` against
--       the live stringify output (bytes, not parsed structures). So:
--       TS bytes ≡ this file's literal (vitest, byte compare) → this
--       file's literal ::jsonb ≡ the stored default (A1) → and A3 pins the
--       SQL side's own raw rendering. The wire half lives in
--       settings-round-trip-db.test.ts §H (raw fetch, response.text()).
--
-- Falsifiability notes (§4.3):
--   * A3 is NOT redundant with A1: jsonb equality compares numbers as
--     NUMERIC (('3'::jsonb = '3.0'::jsonb) is TRUE) while jsonb STORAGE
--     preserves a scalar's literal scale ('3.0'::jsonb::text is '3.0') —
--     so a default seeded with "count": 3.0 passes A1 and reds ONLY A3.
--     The expected text is the MEASURED normalized rendering (jsonb orders
--     keys by length then bytes and prints ", "/": " separators), stored
--     as a literal, never recomputed.
--   * The deliberate-break probe (the DoD's): revert the DEFAULT swap to
--     040's wr-2 literal in an outer transaction → A1–A4 red at 4 (B stays
--     green BECAUSE B2's replay re-applies the operative statement — which
--     is itself the proof that the replayed bytes are the operative ones).
--   * §B's replay embeds the operative statement byte-for-byte from 107.
--     If 107's literal and this file's drift apart, B3 pins the replayed
--     statement's result and A1/A4 pin the real chain's — a drifted copy
--     reds one side or the other, never neither.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(7);

-- ---------------------------------------------------------------------------
-- Seed: one real auth user → handle_new_user creates the owning profile
-- (the 005 §B pattern; this file's transaction rolls back everything).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'pgtap-sc2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "sc2_owner"}', now(), now());

-- ---------------------------------------------------------------------------
-- A. The column DEFAULT is the Scout roster (§7.3.2 as amended: 1 QB / 2 RB /
--    3 WR / 1 TE / 1 FLEX W-R-T / 1 K / 1 D/ST · bench 6 · 1 IR · swap 0).
-- ---------------------------------------------------------------------------
insert into leagues (owner_id, name, season)
values ('10000000-0000-4000-8000-0000000000a2', 'pgtap-sc2-default', 2026);

-- TS-FORM BYTE-BRIDGE LITERAL — the exact bytes JSON.stringify(DEFAULT_ROSTER_SETTINGS)
-- produces; league-settings.test.ts reads this string from this file and `===`s it.
select is(
  (select roster_settings from leagues where name = 'pgtap-sc2-default'),
  '{"starting_slots":[{"key":"qb","label":"QB","eligible":["QB"],"count":1},{"key":"rb","label":"RB","eligible":["RB"],"count":2},{"key":"wr","label":"WR","eligible":["WR"],"count":3},{"key":"te","label":"TE","eligible":["TE"],"count":1},{"key":"flex","label":"FLEX (W/R/T)","eligible":["WR","RB","TE"],"count":1},{"key":"k","label":"K","eligible":["K"],"count":1},{"key":"dst","label":"D/ST","eligible":["DST"],"count":1}],"bench":6,"ir_slots":[{"key":"ir1","type":"unrestricted","eligible_designations":["OUT","IR"]}],"swap_spots":0}'::jsonb,
  'A1: a row inserted without roster_settings carries the Scout roster (TS-form literal ::jsonb — the byte-bridge target)');

select is(
  (select (slot->>'count')::int
     from leagues, jsonb_array_elements(roster_settings->'starting_slots') slot
    where name = 'pgtap-sc2-default' and slot->>'key' = 'wr'),
  3,
  'A2: the defaulted wr slot counts 3 (the SC.2 delta — the ONE number that moved)');

select is(
  (select roster_settings::text from leagues where name = 'pgtap-sc2-default'),
  '{"bench": 6, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0, "starting_slots": [{"key": "qb", "count": 1, "label": "QB", "eligible": ["QB"]}, {"key": "rb", "count": 2, "label": "RB", "eligible": ["RB"]}, {"key": "wr", "count": 3, "label": "WR", "eligible": ["WR"]}, {"key": "te", "count": 1, "label": "TE", "eligible": ["TE"]}, {"key": "flex", "count": 1, "label": "FLEX (W/R/T)", "eligible": ["WR", "RB", "TE"]}, {"key": "k", "count": 1, "label": "K", "eligible": ["K"]}, {"key": "dst", "count": 1, "label": "D/ST", "eligible": ["DST"]}]}',
  'A3: RAW BYTES (R601) — the stored default''s ::text equals the measured normalized rendering (catches a "count": 3.0 that A1''s jsonb-numeric equality would mask)');

select is(
  (select pg_get_expr(d.adbin, d.adrelid)
     from pg_attrdef d
     join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'public.leagues'::regclass and a.attname = 'roster_settings'),
  quote_literal('{"bench": 6, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0, "starting_slots": [{"key": "qb", "count": 1, "label": "QB", "eligible": ["QB"]}, {"key": "rb", "count": 2, "label": "RB", "eligible": ["RB"]}, {"key": "wr", "count": 3, "label": "WR", "eligible": ["WR"]}, {"key": "te", "count": 1, "label": "TE", "eligible": ["TE"]}, {"key": "flex", "count": 1, "label": "FLEX (W/R/T)", "eligible": ["WR", "RB", "TE"]}, {"key": "k", "count": 1, "label": "K", "eligible": ["K"]}, {"key": "dst", "count": 1, "label": "D/ST", "eligible": ["DST"]}]}') || '::jsonb',
  'A4: the catalog DEFAULT expression itself is the Scout constant (a plain literal, not something that merely evaluated to Scout today)');

-- ---------------------------------------------------------------------------
-- B. NO BACKFILL — an existing league's stored roster survives the migration's
--    operative statement, proved on a live row (F186: "existing leagues keep
--    their chosen roster; a default is not a retrofit").
-- ---------------------------------------------------------------------------
-- A pre-migration-style row: 040's canonical wr-2 object stored EXPLICITLY,
-- exactly what every pre-107 league carries.
insert into leagues (owner_id, name, season, roster_settings)
values ('10000000-0000-4000-8000-0000000000a2', 'pgtap-sc2-pre107', 2026,
  '{"starting_slots":[{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 2}, {"key": "te", "label": "TE", "eligible": ["TE"], "count": 1}, {"key": "flex", "label": "FLEX (W/R/T)", "eligible": ["WR", "RB", "TE"], "count": 1}, {"key": "k", "label": "K", "eligible": ["K"], "count": 1}, {"key": "dst", "label": "D/ST", "eligible": ["DST"], "count": 1}], "bench": 6, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0}'::jsonb);

select is(
  (select roster_settings::text from leagues where name = 'pgtap-sc2-pre107'),
  '{"bench": 6, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0, "starting_slots": [{"key": "qb", "count": 1, "label": "QB", "eligible": ["QB"]}, {"key": "rb", "count": 2, "label": "RB", "eligible": ["RB"]}, {"key": "wr", "count": 2, "label": "WR", "eligible": ["WR"]}, {"key": "te", "count": 1, "label": "TE", "eligible": ["TE"]}, {"key": "flex", "count": 1, "label": "FLEX (W/R/T)", "eligible": ["WR", "RB", "TE"]}, {"key": "k", "count": 1, "label": "K", "eligible": ["K"]}, {"key": "dst", "count": 1, "label": "D/ST", "eligible": ["DST"]}]}',
  'B1: the pre-107-style row stores its wr-2 roster byte-exactly (baseline for B2)');

-- Replay 107's operative statement, byte-for-byte, over the live wr-2 row.
ALTER TABLE leagues ALTER COLUMN roster_settings SET DEFAULT
  '{"starting_slots":[{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 3}, {"key": "te", "label": "TE", "eligible": ["TE"], "count": 1}, {"key": "flex", "label": "FLEX (W/R/T)", "eligible": ["WR", "RB", "TE"], "count": 1}, {"key": "k", "label": "K", "eligible": ["K"], "count": 1}, {"key": "dst", "label": "D/ST", "eligible": ["DST"], "count": 1}], "bench": 6, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0}'::jsonb;

select is(
  (select roster_settings::text from leagues where name = 'pgtap-sc2-pre107'),
  '{"bench": 6, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0, "starting_slots": [{"key": "qb", "count": 1, "label": "QB", "eligible": ["QB"]}, {"key": "rb", "count": 2, "label": "RB", "eligible": ["RB"]}, {"key": "wr", "count": 2, "label": "WR", "eligible": ["WR"]}, {"key": "te", "count": 1, "label": "TE", "eligible": ["TE"]}, {"key": "flex", "count": 1, "label": "FLEX (W/R/T)", "eligible": ["WR", "RB", "TE"]}, {"key": "k", "count": 1, "label": "K", "eligible": ["K"]}, {"key": "dst", "count": 1, "label": "D/ST", "eligible": ["DST"]}]}',
  'B2: NO BACKFILL — the stored wr-2 roster is byte-identical after the operative ALTER replays over it');

insert into leagues (owner_id, name, season)
values ('10000000-0000-4000-8000-0000000000a2', 'pgtap-sc2-post-replay', 2026);

select is(
  (select (slot->>'count')::int
     from leagues, jsonb_array_elements(roster_settings->'starting_slots') slot
    where name = 'pgtap-sc2-post-replay' and slot->>'key' = 'wr'),
  3,
  'B3: a fresh default insert after the replay still reads wr 3 — the replayed bytes ARE the operative statement');

select * from finish();
rollback;
