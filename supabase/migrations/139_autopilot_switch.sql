-- ============================================================================
-- 139_autopilot_switch.sql — autopilot OFF BY DEFAULT + the commissioner's
-- per-team "Put on autopilot" switch (M6A task L.E1.22, added by ruling
-- 2026-09-27; PROGRESS Q63 (RULED), F380 (this task), F392 (discharged here),
-- D354 / D356 / D371 / D375 / D376; spec v2.16.47 §7.2 Kick/replace,
-- §7.2.1(c), §10.1 Membership, §12.12, §23 `lineup-lock`; tasks-M6A §6's
-- 2026-09-27 amendment, L.E1.22; tasks-M6A §4 rules 11-15).
--
-- Numbering (D161 — measured at task time, not trusted from any plan):
-- `ls supabase/migrations | tail -1` → 138_autopilot_q62_order.sql ⇒ 139;
-- `ls supabase/tests | tail -1` → 086_autopilot_q62_order.sql ⇒ pgTAP 087.
-- NOT held: reaches production by `npx supabase db push` like any other
-- migration. Production is at 134 — push debt becomes 135–139.
--
-- ---------------------------------------------------------------------------
-- ⚠ WHAT PUSHING THIS DOES IN PRODUCTION, SAID IN WORDS (D371(7))
-- ---------------------------------------------------------------------------
-- EVERY EXISTING TEAM GOES TO AUTOPILOT **OFF** — INCLUDING THE UNMANAGED
-- SEATS AUTOPILOT FILLS IN PRODUCTION TODAY. The switch is stored as a row
-- in `team_autopilot`, and NO ROW MEANS OFF; this migration writes no row
-- (no backfill — the ruling's default). So from the first minute after the
-- push, `lineup_lock_tick` stops filling or substituting ANY unmanaged seat
-- until the commissioner flips that team's switch on. In Chris's live league
-- the unmanaged seats will play the lineup they have (empty slots score
-- zero — "that is fine", Q63) until he turns autopilot on per team.
--
-- ---------------------------------------------------------------------------
-- THE RULING (Chris, 2026-09-27 — PROGRESS §3 Q63, spec §7.2.1(c))
-- ---------------------------------------------------------------------------
-- "the default would be the commissioner has to manage the team, but give
-- the [commissioner] a button that lets them put the team on autopilot." A
-- vacated or never-filled seat is NOT auto-managed; the commissioner and
-- co-commissioners manage it with the existing override tools and get a
-- per-team switch (on / off) — audited like every commissioner action,
-- reason optional (Q66), shown in League Home's activity section. With the
-- switch off the team plays the lineup it has; empty or unplayable slots
-- score zero. NO ADDITIONAL REMINDERS for this case. When ON, autopilot
-- behaves exactly as shipped (125 + 138; Q62 / Q63's substitution rule).
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES
-- ---------------------------------------------------------------------------
--   1. `team_autopilot` — the switch, one row per team that has EVER been
--      switched; NO ROW = OFF. RLS: league members read; NO write policy for
--      any role (the DEFINER verb and the service role are the only writers);
--      `REVOKE TRUNCATE`.
--   2. `commish_autopilot_actions` — this verb's OWN zero-policy replay
--      ledger (D350), `UNIQUE (league_id, action_id)` + `REVOKE TRUNCATE`.
--   3. `commish_set_autopilot_internal` + `commish_set_autopilot` — the
--      audited commissioner verb on D336's seven parts (listed below).
--   4. `lineup_autopilot_internal` — CREATE OR REPLACE against 138's FILE
--      TEXT, ONE hunk (F392).
--   5. `lineup_lock_tick` — CREATE OR REPLACE against 138's FILE TEXT, FIVE
--      hunks (arm (c) gains the switch).
--
-- ---------------------------------------------------------------------------
-- WHY ITS OWN TABLE AND NOT A `teams` COLUMN (the task left it to the Builder)
-- ---------------------------------------------------------------------------
--   (a) `teams` is WORLD-READABLE: its SELECT policy is `USING (true)`
--       (`001:845`). A column there would publish a league's commissioner
--       setting to every signed-in AND anonymous caller; league data is
--       member-scoped everywhere else (§12). This table's SELECT policy is
--       `is_league_member` through the team's league.
--   (b) `teams` HAS A CLIENT UPDATE POLICY (`095:636-639`,
--       `auth.uid() = owner_id AND league_id IS NULL`). It excludes every
--       league franchise today, but a column on that table is client-writable
--       for the rows the policy does admit, and the flag's safety would then
--       rest on a second conjunct written for a different reason. A table
--       with NO write policy for any role makes "only the verb writes it"
--       structural rather than conditional.
--   (c) `teams`' broadcast trigger (`120:1117-1162`) diffs a fixed column
--       list (name / status / retired_at_week / successor_team_id). A column
--       outside it would change silently on the wire (nothing broadcast);
--       inside it, it would be sent to every league subscriber. A separate
--       table touches neither — no realtime change at all (D38 waiver below);
--       the verb's hook re-reads the rosters document on success and error.
--   (d) "No row = OFF" makes the ruled default — and D371(7)'s "existing
--       seats migrate OFF, no backfill" — true BY CONSTRUCTION: there is
--       nothing to backfill and no DEFAULT to get wrong.
--
-- ---------------------------------------------------------------------------
-- THE VERB — WHO, WHAT, AND THE TWO DIRECTIONS
-- ---------------------------------------------------------------------------
-- `commish_set_autopilot(league, team, on, reason?, action_id)`. Commissioner
-- AND co-commissioner (`is_league_commish` — `052:96-105` reads
-- `role IN ('commissioner','co_commissioner')`; pgTAP 087 lands one as a
-- co-commissioner), ONE no-leak 42501 otherwise.
--   · ON is settable on an UNMANAGED seat only — D339's predicate, the same
--     one arm (c) reads: a `league_members` row for the team AND no such row
--     carrying a non-NULL `user_id`. Refused BY NAME on a MANAGED seat
--     (autopilot never runs for a seated manager — arm (c)'s predicate), on
--     a team with NO `league_members` row (D339's unsafe direction — arm (c)
--     DECLINES such a team, so the switch would be a receipt for nothing),
--     and on a RETIRED franchise (it plays no more weeks; arm (c) excludes
--     `status = 'retired'` — its successor is the seat to switch).
--   · OFF is accepted on ANY franchise of the league. OFF is the ruled
--     default and can never seize a team. It is also the ONLY way to disarm
--     a stored ON before a later vacate resumes it (next paragraph) — refusing
--     it on a managed seat would be a reachability defect, not a rule.
-- THE BUILDER'S DESIGN NOTE (tasks-M6A L.E1.22 item 2 — confirmed 2026-09-27,
-- no ruling needed): a stored ON flag is LEFT UNTOUCHED when a manager later
-- claims the seat. Arm (c)'s predicate already stops autopilot for a managed
-- seat, so nothing runs while he is seated — and A LATER VACATE RESUMES IT:
-- the next tick after `remove_manager`'s vacate arm finds the seat unmanaged
-- with its switch still ON and fills it. The commissioner turns it OFF first
-- (always accepted, above) if he does not want that.
-- NO STATUS GATE: a switch set during setup / pre-season is meaningful (the
-- commissioner arms autopilot before week 1); arm (c) only ever runs in an
-- `in_season` / `playoffs` league with a `live` current week.
--
-- D336's SEVEN PARTS, AND WHERE EACH ONE IS
--   (1) the ledger      → §2, `commish_autopilot_actions` (its own namespace;
--                         the pre-planted-row attack `123:333-335` allows on
--                         `commissioner_actions` is why it is not that table)
--   (2) ONE audit row   → §3 step (10), `log_commissioner_action_internal`
--                         (`123:417-453`), INSIDE the no-op guard, AFTER the
--                         state write, `IF v_audit_id IS NULL RAISE`;
--                         `action_type = 'set_autopilot'`, `target_type =
--                         'team'`, `before`/`after` = `{autopilot: bool}`
--                         (the activity feed reads the KEY SET — F355)
--   (3) the no-op       → §3 step (8), by value: the stored switch (no row =
--                         OFF) already equals the request ⇒ nothing written,
--                         no receipt, no post; the ledger row IS written
--   (4) the chat post   → §3 step (11), in-txn, non-disableable (§10.3);
--                         the reason clause only when a reason was given
--   (5) the posture     → PLAIN `search_path=''` internal taking `p_at`,
--                         triple-REVOKEd, under a SECURITY DEFINER wrapper
--                         passing `now()` (D307(3)); `leagues FOR UPDATE`
--                         FIRST, then the re-read; in-body auth as ONE no-leak
--                         42501; the replay AFTER auth, BEFORE every gate
--   (6) the reason      → OPTIONAL (Q66 / 131): normalised, ≤ 500, never
--                         required
--   (7) the result      → echoes `verb` / `action_id` / `team_id` /
--                         `requested` (the route's F65(b) identity guard
--                         compares them), names the seat's state and why,
--                         `affected_team_ids`, `bypassed = []` WITH its why,
--                         and `commissioner_action_id` — NULL on a no-op
--
-- ---------------------------------------------------------------------------
-- ARM (c) — THE SWITCH, AND WHAT AN OFF SEAT STILL GETS (D354 KEPT)
-- ---------------------------------------------------------------------------
-- The driving query selects every unmanaged seat exactly as before and adds
-- the switch (`autopilot_on`, no row ⇒ FALSE). The D339 decline and the D354
-- MATERIALIZE run first, unchanged, for ON and OFF seats alike; then an OFF
-- seat is REPORTED by name in the new `commissioner_managed[]` array (reason
-- `unmanaged_autopilot_off`, "unmanaged, autopilot off — commissioner-
-- managed") and skipped — the chooser is never called for it. A pass that
-- evaluated no seat because every unmanaged seat it reached is OFF says so
-- in a new ordered `autopilot_reason` arm,
-- `every_unmanaged_seat_commissioner_managed_autopilot_off` — placed after
-- `no_row_and_no_materialize` and AHEAD of the D339 decline arm (with an OFF
-- seat present "every unmanaged-looking seat was declined" would be false).
-- `seats_materialized[]` still names an OFF seat whose row the carry wrote.
-- THE D354 MEASUREMENT (the task asked for it; pinned by pgTAP 087): a seat
-- with NO `team_lineups` row WOULD hold a `total_points` week pending for
-- ever — the scoring worker writes no provisional `team_week_results` row for
-- a team with no lineup row (`score-week-worker.ts` step (6b): "no
-- team_lineups row for week … the week is held by name until one exists,
-- F241(b)"), and `week_results_pending_internal` (`120:1059-1084`) then
-- reports `pending_results` naming it, so `finalize_matchups` never
-- finalizes the week. (An `h2h` week is not held — its pending test reads
-- the matchups' score columns, `120:1048-1056`.) So materializing an OFF
-- seat is kept: the carry writes its (empty) row, the worker writes its
-- provisional zero, and the week finalizes. The `autopilot_disabled` kill
-- switch is UNCHANGED — it still short-circuits the whole arm.
--
-- ---------------------------------------------------------------------------
-- D137 PROVENANCE — TWO `CREATE OR REPLACE`s, EACH AGAINST 138's FILE TEXT
-- ---------------------------------------------------------------------------
-- Measured: `grep -ln "FUNCTION lineup_autopilot_internal"` over
-- supabase/migrations → 125, 138 (138 newest); `grep -ln "FUNCTION
-- lineup_lock_tick"` → 116, 119, 125, 138 (138 newest). Both bodies below
-- are 138's FILE TEXT (`138:183-682` and `138:702-1128`) with these hunks,
-- counted by `diff -u` (shown in the PR):
--   lineup_autopilot_internal — ONE hunk (F392 / R1126): `order_basis`'s
--     WHERE gains `AND NOT ((e ->> 'player_id') = ANY (v_seated))` — a
--     vacated-then-RESTORED starter is skipped by pass 2 as seated, so the
--     pass never ordered him and he is not a candidate. REPORT-ONLY: no seat
--     choice changes. Everything else byte-identical (the `c_max_age` line
--     and all three `unfillable[]` reason strings included — the TS
--     file-text pins read the newest definer).
--   lineup_lock_tick — FIVE hunks, all in arm (c) or its report: (T1)
--     DECLARE gains the OFF-seat counter + list; (T2) the driving query
--     selects `autopilot_on` (one line gains a comma); (T3) the OFF branch
--     after the materialize step; (T4) `commissioner_managed[]` in the
--     report; (T5) the new `autopilot_reason` arm. Arms (a) and (b), the kill
--     switch, the D339 decline, the materialize, the chooser call, the write,
--     every existing reason string and every existing report key are
--     byte-identical. pgTAP 087 pins the new prosrc md5s AND proves each
--     prosrc with 139's hunks reversed is 138's md5 byte for byte.
-- Signatures and return types unchanged for both.
--
-- ---------------------------------------------------------------------------
-- POSTURE, CHECKLIST, WAIVERS
-- ---------------------------------------------------------------------------
-- MIGRATION CHECKLIST (tasks-M* §4.4): additive — two NEW tables (RLS on,
-- zero write policies, `REVOKE TRUNCATE`), two NEW functions (a plain
-- internal, triple-REVOKEd; a DEFINER wrapper, REVOKEd from PUBLIC / anon),
-- two `CREATE OR REPLACE`s of existing functions (above). No column added to
-- or dropped from an existing table, no existing policy / grant / trigger
-- touched. Typegen: the two tables + the two new functions appear
-- (additive); the 42-export alias block re-appended.
-- WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
-- `db reset` 001–139 + pgTAP 087 (and every suite that ticks an unmanaged
-- seat, re-cut to switch it ON with the premise asserted) + the stack suites
-- + the synthetic season sim in the same PR. D38 realtime waiver — nothing
-- new is broadcast: `team_autopilot` carries no trigger, and `team_lineups`'
-- own trigger fires on the tick's UPDATE exactly as before (an OFF seat's
-- row is never updated by arm (c)). NO BACKFILL — by the ruling (D371(7)).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. team_autopilot — the switch. NO ROW = OFF (the ruled default).
-- ---------------------------------------------------------------------------
CREATE TABLE team_autopilot (
  team_id    UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  is_on      BOOLEAN NOT NULL,
  set_at     TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE team_autopilot IS
  'The commissioner''s per-team "Put on autopilot" switch (§7.2.1(c); Q63 RULED 2026-09-27; migration 139). NO ROW = OFF — the ruled default; every team that predates 139 has no row (no backfill, D371(7)). lineup_lock_tick arm (c) fills / substitutes an UNMANAGED seat only when is_on is TRUE; an OFF unmanaged seat is materialized (D354) and named in commissioner_managed[], never filled. Written ONLY by commish_set_autopilot (the audited verb — its commissioner_actions row, action_type ''set_autopilot'', says who and when). Members read; no write policy for any role.';
COMMENT ON COLUMN team_autopilot.is_on IS
  'TRUE ⇒ autopilot runs for this team while its seat is unmanaged (D339''s predicate). A stored TRUE survives a manager''s later claim (arm (c) stops for a managed seat) and resumes after a later vacate.';
COMMENT ON COLUMN team_autopilot.set_at IS
  'The verb''s transaction instant (the internal''s p_at) of the last change.';

ALTER TABLE team_autopilot ENABLE ROW LEVEL SECURITY;

-- League members read the switch of their own league's teams (the rosters
-- document carries it to the team page). `teams` is world-SELECT (001:845),
-- so the subquery sees the team row for every caller.
CREATE POLICY "Autopilot switch viewable by league members"
  ON team_autopilot FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_autopilot.team_id
      AND t.league_id IS NOT NULL
      AND public.is_league_member(t.league_id)));
-- No INSERT / UPDATE / DELETE policy for ANY role: the DEFINER verb (owner)
-- and the service role are the only writers. pgTAP 087 §C walks every role
-- with RETURNING counts.
REVOKE TRUNCATE ON TABLE team_autopilot FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. commish_autopilot_actions — this verb's OWN replay ledger (D350).
--    Never shared with the other commish_* ledgers and never folded into
--    commissioner_actions (§12.12 ships a client INSERT policy, `123:333-335`,
--    so a pre-planted row carrying a to-be-sent action_id and a fabricated
--    result would replay as a switch nobody flipped). ZERO policies.
-- ---------------------------------------------------------------------------
CREATE TABLE commish_autopilot_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  action_id  UUID NOT NULL,                       -- client-minted; dedupes retries (the E2/D68 replay key)
  actor_id   UUID NOT NULL REFERENCES profiles(id),
  result     JSONB NOT NULL,                      -- the verb's returned jsonb, replayed byte-identically
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, action_id)                   -- the race backstop behind the select-then-insert
);
CREATE INDEX idx_commish_autopilot_actions_team ON commish_autopilot_actions(team_id);

COMMENT ON TABLE commish_autopilot_actions IS
  'Idempotency ledger for commish_set_autopilot (migration 139, D350). ZERO policies: the DEFINER verb is the only reader and writer. NOT the audit log — §12.26: "an action_id is an idempotency key, not an audit record" — so a row is written for a NO-OP too, while commissioner_actions is not.';

ALTER TABLE commish_autopilot_actions ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON TABLE commish_autopilot_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. commish_set_autopilot_internal + commish_set_autopilot
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_set_autopilot_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_on        BOOLEAN,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league     public.leagues;
  v_found      BOOLEAN;
  v_team       public.teams;
  v_reason     TEXT;
  v_has_member BOOLEAN;
  v_managed    BOOLEAN;
  v_seat       TEXT;
  v_seat_why   TEXT;
  v_before     BOOLEAN;
  v_no_changes BOOLEAN;
  v_audit_id   UUID;
  v_message    TEXT;
  v_result     JSONB;
  v_cnt        INTEGER;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and never answered with
  --     `no_changes: true` (126's rule — a success document for a request
  --     that never said what it wanted).
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'commish_set_autopilot: p_team_id is required — a switch that names no franchise is not a switch'
      USING ERRCODE = '22023';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'commish_set_autopilot: p_on is required — TRUE puts the team on autopilot, FALSE takes it off'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_set_autopilot: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8 — the same
  --     serialization point `lineup_lock_tick` takes per league, `FOR UPDATE
  --     SKIP LOCKED`), so a switch flip and a tick pass over the same league
  --     never interleave: the tick either sees the switch before this call
  --     or after it, never half of it.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — commissioner OR co-commissioner (`is_league_commish`,
  --     052:96-105), in-body, as ONE no-leak 42501 covering "no such league"
  --     and "not a commissioner" alike (D336 part 5).
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_set_autopilot: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), AFTER auth and BEFORE every business gate
  --     (`123:602-609`'s placement): a retry replays byte-identically even
  --     when the seat or the switch has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_autopilot_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (4) THE REASON, OPTIONAL (Q66; 131's normalisation verbatim): absent or
  --     whitespace-only in the explicit E' \t\r\n' class ⇒ NULL; otherwise
  --     trimmed and bounded at 500 (the league_chat bound).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'commish_set_autopilot: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) THE FRANCHISE, re-read under the league lock.
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id FOR UPDATE;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'commish_set_autopilot: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (6) THE SEAT, read the way arm (c) reads it (D339 — `league_members`,
  --     never `teams.status` and never `is_placeholder`).
  v_has_member := EXISTS (SELECT 1 FROM public.league_members m WHERE m.team_id = p_team_id);
  v_managed := EXISTS (SELECT 1 FROM public.league_members m WHERE m.team_id = p_team_id AND m.user_id IS NOT NULL);
  v_seat := CASE WHEN v_managed THEN 'managed'
                 WHEN v_has_member THEN 'unmanaged'
                 ELSE 'no_league_members_row' END;
  v_seat_why := CASE v_seat
    WHEN 'managed' THEN 'a manager is seated (a league_members row carries a user_id) — autopilot never runs for a managed seat (arm (c), D339)'
    WHEN 'unmanaged' THEN 'no manager is seated (the seat''s league_members row carries no user_id) — arm (c) runs for this seat exactly when the switch is ON'
    ELSE 'this team has NO league_members row at all — not proven unmanaged, so arm (c) declines it by name (D339)' END;

  -- (7) ON: THREE REFUSALS, EACH BY NAME. OFF has none (see the banner).
  IF p_on THEN
    IF v_team.status = 'retired' THEN
      RAISE EXCEPTION
        'commish_set_autopilot: franchise % is RETIRED — a sealed franchise plays no more weeks (spec:183, §7.2.1(b)) and autopilot never runs for it; put its successor (%) on autopilot instead',
        p_team_id, COALESCE(v_team.successor_team_id::text, 'none recorded')
        USING ERRCODE = 'P0001';
    END IF;
    IF v_seat = 'managed' THEN
      RAISE EXCEPTION
        'commish_set_autopilot: team % has a manager — autopilot is for a seat with NO manager (§7.2.1(c)); to set this team''s lineup, use the lineup override',
        p_team_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_seat = 'no_league_members_row' THEN
      RAISE EXCEPTION
        'commish_set_autopilot: team % has no league_members row — it is not proven unmanaged, and autopilot declines such a seat rather than risk seizing a human''s team (D339); seat it first',
        p_team_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (8) THE NO-OP, BY VALUE (D336 part 3): the stored switch — NO ROW IS
  --     OFF — already equals the request. Nothing written, no receipt, no
  --     post; the ledger row below is written anyway.
  SELECT sw.is_on INTO v_before FROM public.team_autopilot sw WHERE sw.team_id = p_team_id FOR UPDATE;
  v_before := COALESCE(v_before, FALSE);
  v_no_changes := (v_before = p_on);

  IF NOT v_no_changes THEN
    -- (9) THE STATE WRITE, with the loud ROW_COUNT assertion (`119:882-886`).
    INSERT INTO public.team_autopilot (team_id, is_on, set_at)
    VALUES (p_team_id, p_on, p_at)
    ON CONFLICT (team_id) DO UPDATE SET is_on = EXCLUDED.is_on, set_at = EXCLUDED.set_at;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_set_autopilot: the switch write touched % rows, expected exactly 1 (team %)', v_cnt, p_team_id
        USING ERRCODE = 'P0001';
    END IF;

    -- (10) D336 part 2 — EXACTLY ONE audit row, AFTER the state write.
    --      `before` / `after` carry the ONE key this verb changes, so the
    --      activity feed reads the act from the key set (F355).
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'set_autopilot', 'team', p_team_id::text, v_reason,
      jsonb_build_object('autopilot', v_before),
      jsonb_build_object('autopilot', p_on),
      jsonb_build_object(
        'verb',              'commish_set_autopilot',
        'season',            v_league.season,
        'action_id',         p_action_id,
        'team_name',         v_team.name,
        'team_status',       v_team.status,
        'seat',              v_seat,
        'affected_team_ids', jsonb_build_array(p_team_id),
        'bypassed',          '[]'::jsonb),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_set_autopilot: the audit row was not written — refusing to let the switch stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- (11) §10.3: override system messages auto-post to league chat and
    --      CANNOT be disabled. No other notification — Q63: "we don't need
    --      any additional reminders for this exception case".
    v_message := v_team.name
      || CASE WHEN p_on THEN ' is now on autopilot' ELSE ' is off autopilot — the commissioner manages its lineup' END
      || ' — set by ' || public.draft_actor_name() || ' (commissioner override)'
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_set_autopilot',
    'action_type',            'set_autopilot',
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'team_id',                p_team_id,
    'team_name',              v_team.name,
    'team_status',            v_team.status,
    -- The switch AFTER this call, what it was, and what was asked — the
    -- route's F65(b) guard compares `requested` with the body it sent.
    'autopilot',              CASE WHEN v_no_changes THEN v_before ELSE p_on END,
    'previous',               v_before,
    'requested',              p_on,
    'seat',                   v_seat,
    'seat_why',               v_seat_why,
    -- What the switch DOES, said once so no caller has to infer it (rule 15).
    'effect',                 CASE
      WHEN NOT (CASE WHEN v_no_changes THEN v_before ELSE p_on END) THEN
        'off — the commissioner manages this team: lineup_lock_tick never fills or substitutes it; it plays the lineup it has and an empty slot scores zero (Q63)'
      WHEN v_seat = 'unmanaged' THEN
        'on — from the next lineup-lock tick (every minute on game days) autopilot fills empty starting slots and substitutes a starter who cannot play, while the seat has no manager and its week is live (§7.2.1(c))'
      ELSE
        'on, and INERT while a manager is seated — arm (c) runs only for an unmanaged seat; it resumes if the seat is vacated (the stored switch is left untouched by a claim)' END,
    'affected_team_ids',      jsonb_build_array(p_team_id),
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                CASE WHEN v_before THEN 'already_on — the team was already on autopilot, so nothing was written and no receipt was issued'
                                     ELSE 'already_off — the team was already off autopilot (a team never switched has no row, which is OFF — the ruled default), so nothing was written and no receipt was issued' END END,
    'commissioner_action_id', v_audit_id,             -- NULL on a no-op, and that is the point
    'bypassed',               '[]'::jsonb,
    'bypassed_why',           'nothing to bypass — the switch is not gated by the per-player kickoff lock, the week status or the scoring snapshot; it changes what the NEXT tick does, never a lineup already written',
    'reason',                 v_reason,
    'system_post',            v_message,              -- NULL on a no-op
    'evaluated_at',           p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (`123:1259-1266`'s
  -- posture) — §12.26: "an action_id is an idempotency key, not an audit
  -- record".
  INSERT INTO public.commish_autopilot_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_set_autopilot_internal(UUID, UUID, BOOLEAN, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- The client door. Transaction `now()`, never a caller-supplied instant
-- (D307(3)); SECURITY DEFINER; in-body auth is the internal's step (2). The
-- tail arguments carry DEFAULT NULL and the required ones are refused in-body
-- (22023) — 128's shape.
CREATE OR REPLACE FUNCTION commish_set_autopilot(
  p_league_id UUID,
  p_team_id   UUID,
  p_on        BOOLEAN DEFAULT NULL,  -- REQUIRED in-body (22023)
  p_reason    TEXT DEFAULT NULL,     -- OPTIONAL (Q66)
  p_action_id UUID DEFAULT NULL      -- REQUIRED in-body (22023)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.commish_set_autopilot_internal(
    p_league_id, p_team_id, p_on, p_action_id, now(), p_reason);
END;
$$;
-- `authenticated` keeps EXECUTE; the in-body commissioner gate is the
-- authorization (112:1237's posture).
REVOKE EXECUTE ON FUNCTION commish_set_autopilot(UUID, UUID, BOOLEAN, TEXT, UUID)
  FROM PUBLIC, anon;

COMMENT ON FUNCTION commish_set_autopilot(UUID, UUID, BOOLEAN, TEXT, UUID) IS
  '§7.2.1(c) / §10.1 Membership (Q63 RULED 2026-09-27; migration 139): the commissioner''s per-team "Put on autopilot" switch. Commissioner or co-commissioner; ON only for an unmanaged, non-retired seat with a league_members row (D339), OFF for any franchise; no-op by value; one commissioner_actions row (set_autopilot, {autopilot} before/after), a §10.3 chat post, its own replay ledger (D350); reason optional (Q66).';

-- ---------------------------------------------------------------------------
-- 4. lineup_autopilot_internal — CREATE OR REPLACE against `138:183-682`'s
--    FILE TEXT (D137). ONE hunk — F392's candidate scoping of order_basis.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_autopilot_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_season    INTEGER,
  p_week      INTEGER,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_row         public.team_lineups;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_by_pid      JSONB := '{}'::jsonb;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_kick        JSONB := '{}'::jsonb;
  v_map         JSONB := '{}'::jsonb;
  v_ir_held     TEXT[] := ARRAY[]::text[];
  v_seated      TEXT[] := ARRAY[]::text[];   -- players staying where they are
  v_fixed       JSONB := '[]'::jsonb;        -- fit input: those same players
  v_free        JSONB := '[]'::jsonb;        -- fit input: HEALTHY unlocked candidates
  v_tail        JSONB := '[]'::jsonb;        -- fit input: the unhealthy tail (allow = TRUE)
  v_displace    JSONB := '{}'::jsonb;        -- slot key → vacated unhealthy starter
  v_restored    JSONB := '[]'::jsonb;
  v_locked_out  JSONB := '[]'::jsonb;        -- skipped_locked[]
  v_filtered    JSONB := '[]'::jsonb;        -- refused by the allow = FALSE hard filter
  v_fit_a       JSONB;
  v_fit_b       JSONB;
  v_players_b   JSONB := '[]'::jsonb;
  v_assign      JSONB;
  v_filled      JSONB := '[]'::jsonb;
  v_subbed      JSONB := '[]'::jsonb;
  v_unfill      JSONB := '[]'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_locked_at   TIMESTAMPTZ;
  v_pflags      JSONB;
  v_empties     INTEGER := 0;
  v_sick        INTEGER := 0;               -- unhealthy UNLOCKED seated starters
  v_e           JSONB;
  v_p           JSONB;
  v_k           RECORD;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_elig        JSONB;
  v_locked      BOOLEAN;
  v_unhealthy   BOOLEAN;
  v_changed     BOOLEAN;
  v_reason      TEXT;
  -- 138 (L.E1.21, Q62): the read-side freshness bound (F387's read half /
  -- F389(c)) — the SAME six hours as the compute half's
  -- `PROJECTION_MAX_AGE_MS` (`player-values.ts`), pinned equal by a unit cell.
  c_max_age     CONSTANT INTERVAL := interval '6 hours';
  v_tail_d      JSONB := '[]'::jsonb;        -- fit input: the DOUBTFUL tail — ahead of v_tail, under BOTH settings
  v_blocked     BOOLEAN;                     -- bye or a §7.3.6 blocking designation (Doubtful is NOT one)
  v_basis       JSONB;                       -- order_basis: what ordered this pass, and why a key was absent
BEGIN
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lineup_autopilot_internal: league % not found', p_league_id USING ERRCODE = 'P0002';
  END IF;

  -- The row must EXIST. D354 puts materialization in the caller, under the
  -- league lock, through the unchanged carry — so an absent row here is a
  -- caller bug and must be loud, never a silently invented lineup.
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = p_season AND tl.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'lineup_autopilot_internal: no team_lineups row for team % season % week % — the caller materializes through lineup_carry_internal first (D354); refusing to invent one',
      p_team_id, p_season, p_week
      USING ERRCODE = 'P0002';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);

  -- §7.3.6's per-league setting, read the way `set_lineup` reads it
  -- (`114:307`): absent ⇒ TRUE.
  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- THE ROSTER, in 114/116's shape (positions normalised DEF → DST;
  -- designations bridged through `lineup_designation_internal`, 112:337),
  -- plus the four keys of the one sort below and an `order` object that says
  -- which key ordered each player and why an earlier key was absent.
  --
  -- Q62's SORT, AS RULED (Chris 2026-09-27; 138, L.E1.21), AND IT IS STILL
  -- THE WHOLE SELECTION POLICY. Placement is free (D340 — the matcher
  -- CHOOSES, and greedy-by-input-order over a transversal matroid is
  -- optimal), so "which players start" is this ORDER BY and nothing else:
  -- (1) THIS week's projected points, (2) season-to-date points, (3) preseason
  -- projected points — each under the league's scoring (§12.28, 137) — then
  -- (4) ADP, then player_id. POINTS, never ranks: across positions (a FLEX
  -- slot) Chris ruled "total scored points", and within a position points
  -- order exactly as positional rank does. ONE LEXICOGRAPHIC ORDER BY, PER
  -- PLAYER (the task's READING, flagged): a player with a key outranks every
  -- player without it; the later keys order only what the earlier leave NULL.
  --
  -- F389's JOIN CONTRACT. (a) A LEFT JOIN — a rostered player with no values
  -- row (acquired since the last hourly run; a league-week the job failed)
  -- stays in the pool with all three keys NULL and is NAMED in order_basis;
  -- (b) only the POINTS columns are sort keys — `*_missing` / `*_unscored`
  -- never are; (c) F387's READ HALF — a row whose `computed_at` is older than
  -- `c_max_age` at `p_at` is ABSENT (the values job has died), and a
  -- projection whose `projection_fetched_at` is older than `c_max_age` at
  -- `p_at` is ABSENT (the projections sync has died) ⇒ the next key orders.
  -- ALL FOUR JOIN PREDICATES ARE LOAD-BEARING (R1120, #316's fix round).
  -- The job writes the CURRENT and the NEXT week for every rostered player of
  -- every league, and one real player is rostered in many leagues: without
  -- `v.week = p_week` (or the season) he joins TWICE — two roster entries, and
  -- the matcher could seat one man in two slots — and without the league
  -- predicate he is ordered by ANOTHER league's scoring. pgTAP 086 gives a
  -- §C1 player a reversing row in each of those three places.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',      r.player_id,
           'name',           p.full_name,
           'position',       CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',    public.lineup_designation_internal(p.status),
           'nfl_team',       p.team,
           'adp',            p.adp,
           'ir_placed_week', r.ir_placed_week,
           'slot_key',       r.slot_key,
           'order',          jsonb_build_object(
             'ordered_by',       CASE WHEN k.projected_points IS NOT NULL THEN 'projected_points'
                                      WHEN k.season_points    IS NOT NULL THEN 'season_points'
                                      WHEN k.preseason_points IS NOT NULL THEN 'preseason_points'
                                      WHEN p.adp              IS NOT NULL THEN 'adp'
                                      ELSE 'player_id' END,
             'projected_points', k.projected_points,
             'season_points',    k.season_points,
             'preseason_points', k.preseason_points,
             'adp',              p.adp,
             'value_row',        f.value_row,
             'projected_why',    CASE WHEN k.projected_points IS NOT NULL THEN NULL
                                      WHEN f.value_row <> 'fresh' THEN f.value_row
                                      WHEN v.projected_points IS NULL THEN v.projected_missing
                                      ELSE 'stale_line_at_read' END))
           ORDER BY k.projected_points DESC NULLS LAST, k.season_points DESC NULLS LAST,
                    k.preseason_points DESC NULLS LAST, p.adp ASC NULLS LAST, r.player_id ASC), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  LEFT JOIN public.league_player_values v
    ON v.league_id = r.league_id AND v.season = p_season AND v.week = p_week AND v.player_id = r.player_id
  CROSS JOIN LATERAL (SELECT CASE WHEN v.player_id IS NULL THEN 'no_value_row'
                                  WHEN v.computed_at < p_at - c_max_age THEN 'stale_row'
                                  ELSE 'fresh' END AS value_row) f
  CROSS JOIN LATERAL (SELECT
           CASE WHEN f.value_row = 'fresh' AND v.projection_fetched_at >= p_at - c_max_age
                THEN v.projected_points END AS projected_points,
           CASE WHEN f.value_row = 'fresh' THEN v.season_points END AS season_points,
           CASE WHEN f.value_row = 'fresh' THEN v.preseason_points END AS preseason_points) k
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order WITH their eligibility (the matcher's
  -- input, `114:355-362`), and the IR spots by key.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', (s ->> 'key') || ':0', 'spot', s ->> 'key') ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- A team with no roster has nothing to seat. Reported, never raised: one
  -- empty roster must not fail a league's whole tick.
  IF jsonb_array_length(v_roster) = 0 THEN
    RETURN jsonb_build_object(
      'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
      'source', 'autopilot', 'slot_map', v_stored, 'starters', v_row.starters,
      'bench', v_row.bench, 'locked_at', v_row.locked_at,
      'filled', '[]'::jsonb, 'substituted', '[]'::jsonb, 'unfillable', '[]'::jsonb,
      'skipped_locked', '[]'::jsonb, 'restored', '[]'::jsonb,
      'allow_illegal_lineups', v_allow, 'changed', FALSE,
      'reason', 'empty_roster', 'evaluated_at', p_at);
  END IF;

  -- THE PER-PLAYER LOCK DATUM, read NOW from `nfl_games` at the injected
  -- instant (E42/§23.3) — the same helper and the same rendering 114 and 116
  -- use, so arm (b) finds nothing to change next minute.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_e ->> 'nfl_team', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
  END LOOP;

  -- IR KEYS ARE CARRIED VERBATIM. IR occupancy is ROSTER-level state
  -- (D308/§11.2) and autopilot never moves it; its occupants are not
  -- candidates for a starting slot.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_pid := v_val #>> '{}';
      v_map := v_map || jsonb_build_object(v_key, v_pid);
      v_ir_held := v_ir_held || v_pid;
    END IF;
  END LOOP;

  -- CLASSIFY EVERY STARTING SLOT.
  --   · empty (or holding a player who has since been dropped) ⇒ OPEN;
  --   · holding a LOCKED player ⇒ he stays, unconditionally (D338 — the lock
  --     binds autopilot exactly as it binds a manager);
  --   · holding a HEALTHY unlocked player ⇒ he stays (D340 — a carried or
  --     manager-set placement is NEVER overridden on value);
  --   · holding an UNLOCKED player who is on bye or carries a blocking
  --     designation ⇒ VACATED for the substitution pass, and restored below
  --     if no healthy replacement takes the key (Q63).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_stored ->> v_key;
    IF v_pid IS NULL OR NOT (v_by_pid ? v_pid) THEN
      v_empties := v_empties + 1;
      CONTINUE;
    END IF;
    v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
    -- THE `COALESCE` AROUND THE `IN` IS LOAD-BEARING, AND IT WAS MISSING UNTIL
    -- #295's fix round CAUGHT IT WITH §J. `lineup_designation_internal`
    -- returns NULL for a healthy player (112:337 — measured: 'Active' ⇒ NULL),
    -- and `NULL IN (…)` is NULL, not FALSE. Unguarded, `v_unhealthy` was NULL
    -- for EVERY healthy seated starter, `NOT NULL` is NULL, and the `IF` fell
    -- to the ELSE: a healthy, manager-set or carried starter was DISPLACED and
    -- re-contested on value — a D340 violation — and, because such a man also
    -- re-entered the candidate pool below, `v_restored` could seat him at his
    -- old key while pass 1 had already placed him elsewhere, writing ONE PLAYER
    -- INTO TWO SLOTS. Invisible to every other cell in 073 because no other
    -- fixture ran the pass over a map with a HEALTHY SEATED STARTER in it; §J
    -- is that fixture, and it reds on the unguarded form.
    -- 138 (L.E1.21, Q62 RULED): `Doubtful` SITS — an unlocked Doubtful
    -- starter is VACATED here like a bye/OUT man, and pass 1 below either
    -- gives his key to a HEALTHY replacement or the restore clause puts him
    -- back ("yes start the doubtful"). He is NOT in the `out` starter flag
    -- further down: a Doubtful start is legal for a manager (114:596).
    v_unhealthy := COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                   OR COALESCE((v_by_pid -> v_pid ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended', 'Doubtful'), FALSE);
    IF v_locked OR NOT v_unhealthy THEN
      v_seated := v_seated || v_pid;
      v_fixed := v_fixed || jsonb_build_object(
        'player_id', v_pid, 'position', v_by_pid -> v_pid ->> 'position',
        'wanted', v_key, 'fixed', TRUE);
    ELSE
      v_displace := v_displace || jsonb_build_object(v_key, v_pid);
      v_sick := v_sick + 1;
    END IF;
  END LOOP;

  -- THE SHORT-CIRCUIT (tasks-M6A L.E1.4 item 2), BEFORE ANY FIT CALL. Nothing
  -- to fill and nobody to substitute ⇒ no matcher runs and the caller writes
  -- nothing. It lives HERE, in the one place that holds both halves of the
  -- predicate, rather than being half-duplicated in the tick where the
  -- designations and kickoffs are not in scope — the load mitigation is the
  -- predicate, not the cadence.
  IF v_empties = 0 AND v_sick = 0 THEN
    RETURN jsonb_build_object(
      'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
      'source', 'autopilot', 'slot_map', v_stored, 'starters', v_row.starters,
      'bench', v_row.bench, 'locked_at', v_row.locked_at,
      'filled', '[]'::jsonb, 'substituted', '[]'::jsonb, 'unfillable', '[]'::jsonb,
      'skipped_locked', '[]'::jsonb, 'restored', '[]'::jsonb,
      'allow_illegal_lineups', v_allow, 'changed', FALSE,
      'reason', 'no_empty_slot_and_no_unhealthy_unlocked_starter', 'evaluated_at', p_at);
  END IF;

  -- THE CANDIDATE POOLS, in the roster's Q62 order.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_held);
    CONTINUE WHEN v_pid = ANY (v_seated);
    v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
    IF v_locked THEN
      -- D338: never lifted, and never silently dropped.
      v_locked_out := v_locked_out || jsonb_build_object(
        'player_id', v_pid, 'name', v_e ->> 'name', 'position', v_e ->> 'position',
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'reason', 'his game had already kicked off at the tick instant (§11.2, lineup_lock = per_player_kickoff) — autopilot does not inherit the commissioner''s exemption (D338)');
      CONTINUE;
    END IF;
    -- Same `COALESCE` as the classification loop above, for the same reason and
    -- stated once there. Benign on this side (`IF NULL THEN` does not fire, so a
    -- healthy man landed in `v_free` anyway) and written explicitly regardless:
    -- the two loops must classify one player identically or the pools disagree.
    -- 138 (L.E1.21): the SAME unhealthy test as the classification loop
    -- (Doubtful included), split in two because the two halves take different
    -- paths. A BLOCKED man (bye / OUT / IR / PUP / NFI / Suspended) keeps
    -- 125's item-4c split exactly. A DOUBTFUL man is a PREFERENCE under BOTH
    -- settings — never the hard filter, since a Doubtful start is legal
    -- (114:596) — and his tail is offered AHEAD of the blocked tail, which is
    -- where he stood before this migration (he was healthy then): Doubtful
    -- now sits behind every healthy candidate and nothing else changed.
    v_blocked := COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                 OR COALESCE((v_e ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended'), FALSE);
    v_unhealthy := v_blocked OR COALESCE((v_e ->> 'designation') = 'Doubtful', FALSE);
    IF v_unhealthy THEN
      IF NOT v_blocked THEN
        v_tail_d := v_tail_d || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
      ELSIF v_allow THEN
        -- A PREFERENCE, not a filter: seated LAST, never left out, because an
        -- empty slot is the zero this task exists to remove (item 4c).
        v_tail := v_tail || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
      ELSE
        v_filtered := v_filtered || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position');
      END IF;
      CONTINUE;
    END IF;
    v_free := v_free || jsonb_build_object(
      'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
  END LOOP;

  -- PASS 1 — the HEALTHY pass. Seated players are `fixed` at their own key;
  -- every vacated slot and every empty slot is contested by the healthy
  -- candidates in priority order. This is the pass that decides whether a
  -- substitution happens at all.
  v_fit_a := public.lineup_fit_internal(v_slots, v_fixed || v_free);

  -- Q63's RESTORE. A vacated unhealthy starter whose key nobody healthy took
  -- goes straight back where he was: autopilot substitutes only when a
  -- healthy, unlocked, eligible replacement ACTUALLY takes the slot, and it
  -- never turns an occupied slot into an empty one.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_displace) LOOP
    v_pid := v_val #>> '{}';
    IF (v_fit_a -> 'assignment' ->> v_key) IS NULL THEN
      v_restored := v_restored || jsonb_build_object(
        'slot', v_key, 'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        'reason', 'no healthy, unlocked, eligible replacement existed — left exactly as he was (Q63)');
      v_seated := v_seated || v_pid;
      v_players_b := v_players_b || jsonb_build_object(
        'player_id', v_pid, 'position', v_by_pid -> v_pid ->> 'position',
        'wanted', v_key, 'fixed', TRUE);
    ELSE
      v_subbed := v_subbed || jsonb_build_object(
        'slot', v_key, 'out', v_pid, 'out_name', v_by_pid -> v_pid ->> 'name',
        'in', v_fit_a -> 'assignment' ->> v_key,
        'in_name', v_by_pid -> (v_fit_a -> 'assignment' ->> v_key) ->> 'name',
        'reason', CASE WHEN COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                       THEN 'on bye' ELSE 'designated ' || (v_by_pid -> v_pid ->> 'designation') END,
        -- 138: which Q62 key ordered the man who came IN, and why an earlier
        -- key was absent (§4 rule 15) — rides through the tick's autopiloted[].
        'order', v_by_pid -> (v_fit_a -> 'assignment' ->> v_key) -> 'order');
    END IF;
  END LOOP;

  -- PASS 2 — the TAIL pass. Pass 1's whole assignment is re-seeded `fixed`
  -- (112:501-505 seeds a fixed player at his wanted key unconditionally, so
  -- pass 1's result is reproduced exactly), the restored men with it, and the
  -- remaining slots are offered to the unhealthy tail — which, when the
  -- league forbids illegal lineups, holds only the Doubtful men (138), so a
  -- slot only a BLOCKED man could take stays `unfillable`.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit_a -> 'assignment') LOOP
    v_players_b := v_players_b || jsonb_build_object(
      'player_id', v_val #>> '{}',
      'position', v_by_pid -> (v_val #>> '{}') ->> 'position',
      'wanted', v_key, 'fixed', TRUE);
  END LOOP;
  -- 138: the Doubtful tail FIRST, then the blocked tail (see the pool loop).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_tail_d || v_tail) LOOP
    CONTINUE WHEN (v_e ->> 'player_id') = ANY (v_seated);
    v_players_b := v_players_b || v_e;
  END LOOP;
  v_fit_b := public.lineup_fit_internal(v_slots, v_players_b);
  v_assign := v_fit_b -> 'assignment';
  v_map := v_map || v_assign;

  -- WHAT WAS FILLED, AND WHAT COULD NOT BE — with the slot KEY and a REASON
  -- string, never merely a short map (§4 rule 15).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_elig := v_e -> 'eligible';
    v_pid := v_assign ->> v_key;
    IF v_pid IS NULL THEN
      v_unfill := v_unfill || jsonb_build_object('slot', v_key, 'slot_key', v_e ->> 'slot',
        'reason', CASE
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_filtered) x WHERE v_elig ? (x ->> 'position'))
            THEN 'no healthy eligible player at ' || upper(v_e ->> 'slot') || '; league forbids illegal lineups'
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> 'position'))
            THEN 'no unlocked eligible player at ' || upper(v_e ->> 'slot') || '; every candidate''s game had kicked off'
          ELSE 'no eligible player at ' || upper(v_e ->> 'slot') || ' on the roster' END);
    ELSIF (v_stored ->> v_key) IS DISTINCT FROM v_pid AND NOT (v_displace ? v_key) THEN
      v_filled := v_filled || jsonb_build_object('slot', v_key, 'player_id', v_pid,
        'name', v_by_pid -> v_pid ->> 'name', 'position', v_by_pid -> v_pid ->> 'position',
        'order', v_by_pid -> v_pid -> 'order');
    END IF;
  END LOOP;

  -- STARTERS + flags + `locked_at`, 114 (10)'s shape byte-for-byte
  -- (`114:618-624` / `116:528-533`). `bench` = roster − starters − IR.
  v_locked_at := NULL;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_map ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
    ELSE
      v_p := v_by_pid -> v_pid;
      v_started := v_started || v_pid;
      IF COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE) THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
    END IF;
    v_starters := v_starters || jsonb_build_object(
      'slot', v_key, 'slot_key', v_e ->> 'slot', 'label', v_e ->> 'label',
      'player_id', v_pid,
      'position', CASE WHEN v_pid IS NULL THEN NULL ELSE v_by_pid -> v_pid ->> 'position' END,
      'kickoff_at', CASE WHEN v_pid IS NULL THEN NULL ELSE v_kick -> v_pid ->> 'kickoff_at' END,
      'flags', v_pflags);
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(e ->> 'player_id') ORDER BY e ->> 'player_id'), '[]'::jsonb)
  INTO v_bench
  FROM jsonb_array_elements(v_roster) e
  WHERE NOT ((e ->> 'player_id') = ANY (v_started))
    AND NOT ((e ->> 'player_id') = ANY (v_ir_held));

  -- THE NO-OP, BY VALUE. jsonb equality over the map — the same test
  -- `set_lineup` uses (`114:633`); the other three columns are projections of
  -- it, and arm (b) owns the kickoff refresh of an unchanged row.
  v_changed := (v_map IS DISTINCT FROM v_stored);
  v_reason := CASE
    WHEN v_changed THEN NULL
    WHEN jsonb_array_length(v_unfill) > 0 THEN 'nothing_fillable'
    ELSE 'no_change' END;

  -- 138 (L.E1.21): WHAT ORDERED THIS PASS, AND WHY A KEY WAS ABSENT (§4 rule
  -- 15; F389(a)). Over this pass's CANDIDATES: how many players each Q62 key
  -- ordered, every candidate with NO values row and every candidate whose row
  -- was STALE at `p_at` by name, and — when no candidate had any points key at
  -- all — that the pass FELL BACK TO ADP and the measured reason, never a
  -- quiet ADP order that looks like a projection order.
  -- THE CANDIDATES, NOT THE ROSTER (R1125, #316's fix round): only the men the
  -- pass actually OFFERED to the matcher un-fixed — `v_free`, `v_tail_d`,
  -- `v_tail`. An IR-held man, a seated (fixed) starter, a locked man and one
  -- the allow = FALSE filter refused are never ordered by this pass, so they
  -- are never counted: one valued IR man must not report "ordered by
  -- projection" for a pass whose every real candidate was ordered by ADP. A
  -- pass with NO candidate (an empty slot and nobody left to offer) says
  -- `candidates = 0` and did not fall back — nothing was ordered.
  SELECT jsonb_build_object(
           'candidates',        count(*),
           'by_key',            jsonb_build_object(
             'projected_points', count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'projected_points'),
             'season_points',    count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'season_points'),
             'preseason_points', count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'preseason_points'),
             'adp',              count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'adp'),
             'player_id',        count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'player_id')),
           'no_value_row',      COALESCE(jsonb_agg(e ->> 'player_id' ORDER BY e ->> 'player_id')
                                  FILTER (WHERE e -> 'order' ->> 'value_row' = 'no_value_row'), '[]'::jsonb),
           'stale_value_row',   COALESCE(jsonb_agg(e ->> 'player_id' ORDER BY e ->> 'player_id')
                                  FILTER (WHERE e -> 'order' ->> 'value_row' = 'stale_row'), '[]'::jsonb),
           'max_age',           c_max_age::text,
           'fell_back_to_adp',  count(*) > 0 AND count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by'
                                  IN ('projected_points', 'season_points', 'preseason_points')) = 0,
           'fallback_why',      CASE
             WHEN count(*) = 0 THEN NULL
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by'
                    IN ('projected_points', 'season_points', 'preseason_points')) > 0 THEN NULL
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'no_value_row') = count(*)
               THEN 'no_value_rows: league_player_values holds no row for any of this pass''s candidates for this league-week — the league-player-values job has not valued them; every candidate was ordered by ADP, then player_id (Q62 key 4)'
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'stale_row') = count(*)
               THEN 'all_value_rows_stale: every one of this pass''s candidates'' league_player_values rows for this league-week was computed more than ' || c_max_age::text || ' before the tick instant — the job has stopped landing, so the rows were treated as absent (F387) and every candidate was ordered by ADP, then player_id'
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'fresh') = 0
               THEN 'no_fresh_value_row: every candidate''s values row was absent or stale at the tick instant; every candidate was ordered by ADP, then player_id'
             ELSE 'no_points_in_any_value_row: fresh values rows exist but none carries a usable projected, season-to-date or preseason value (see each player''s order.projected_why); every candidate was ordered by ADP, then player_id' END)
  INTO v_basis
  FROM jsonb_array_elements(v_roster) e
  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_free || v_tail_d || v_tail) c
                WHERE c ->> 'player_id' = e ->> 'player_id')
    -- 139 (L.E1.22, F392 / R1126): a vacated-then-RESTORED starter is back in
    -- `v_seated` and pass 2 skips him as seated, so the pass never ORDERED him —
    -- he is not a candidate, and counting him let one valued restored man
    -- report "ordered by projection" for a pass whose every real candidate
    -- was ordered by ADP (spec §7.2.1(c): "counted over the pass's candidates
    -- only").
    AND NOT ((e ->> 'player_id') = ANY (v_seated));

  RETURN jsonb_build_object(
    'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
    'source', 'autopilot',
    'slot_map', v_map, 'starters', v_starters, 'bench', v_bench, 'locked_at', v_locked_at,
    'filled', v_filled, 'substituted', v_subbed, 'unfillable', v_unfill,
    'skipped_locked', v_locked_out, 'restored', v_restored,
    'allow_illegal_lineups', v_allow,
    'order_basis', v_basis,
    'changed', v_changed, 'reason', v_reason, 'evaluated_at', p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_autopilot_internal(UUID, UUID, INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. lineup_lock_tick — CREATE OR REPLACE against `138:702-1128`'s FILE TEXT
--    (D137). FIVE hunks, all in arm (c) or its report (T1-T5 in the banner):
--    the switch is read in the driving query, an OFF seat is materialized
--    (D354, unchanged) and then REPORTED by name and skipped, and a pass whose
--    every reached unmanaged seat is OFF says so in its own reason arm. Arms
--    (a) and (b), the kill switch and every existing key are byte-identical.
--    SECURITY DEFINER, `search_path = ''`, the in-body JWT refusal and the
--    triple REVOKE — 138's posture verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_lock_tick(
  p_now       TIMESTAMPTZ DEFAULT now(),
  p_league_id UUID        DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch     CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_seen           UUID[] := '{}';
  v_loops          INTEGER := 0;
  v_pass           INTEGER;
  v_lg             RECORD;
  v_league         public.leagues;
  v_current        INTEGER;
  v_pool           RECORD;
  v_lock           JSONB;
  v_new_until      TIMESTAMPTZ;
  v_new_state      TEXT;
  v_row            RECORD;
  v_e              JSONB;
  v_pid            TEXT;
  v_team           TEXT;
  v_k              RECORD;
  v_new_locked_at  TIMESTAMPTZ;
  v_new_starters   JSONB;
  v_changed        BOOLEAN;
  v_cnt            INTEGER;
  v_leagues        INTEGER := 0;
  v_pool_rows      INTEGER := 0;
  v_pool_updates   INTEGER := 0;
  v_lineups        INTEGER := 0;
  v_lineup_updates INTEGER := 0;
  v_pool_changed   INTEGER := 0;   -- 119: THIS league's pool rows changed this pass — the coalescing key (D296/F252(a))
  v_pool_events    INTEGER := 0;   -- 119: pool broadcasts sent this run (one per league per pass that changed ≥ 1 row)
  v_skipped        JSONB := '[]'::jsonb;
  v_failures       JSONB := '[]'::jsonb;
  -- 125 (H1) — AUTOPILOT, arm (c). D337/D338/D339/D340/D354.
  v_ap_off         BOOLEAN;        -- the kill switch, read ONCE per invocation (H2)
  v_ap             RECORD;
  v_ap_r           JSONB;
  v_ap_seats       INTEGER := 0;   -- unmanaged seats arm (c) EVALUATED
  v_ap_writes      INTEGER := 0;   -- lineup rows arm (c) wrote
  v_ap_no_member   INTEGER := 0;   -- teams declined: no league_members row at all (D339)
  v_ap_no_row      INTEGER := 0;   -- seats that REACHED the materialize step and STILL had no row (R998/R999: counted after the carry, never on the D339 path)
  v_autopiloted    JSONB := '[]'::jsonb;
  v_ap_mat         JSONB := '[]'::jsonb;
  v_ap_unfill      JSONB := '[]'::jsonb;
  v_ap_locked      JSONB := '[]'::jsonb;
  -- 139 (L.E1.22, Q63 RULED): the per-team switch. An unmanaged seat whose
  -- switch is OFF — the DEFAULT — is COMMISSIONER-MANAGED: materialized (D354)
  -- but never filled, and NAMED here rather than read as a quiet zero.
  v_ap_cm          INTEGER := 0;   -- unmanaged seats left alone because the switch is OFF
  v_ap_cm_list     JSONB := '[]'::jsonb;
BEGIN
  -- A job, not a user verb: a JWT-bearing caller is refused in-body (rule 2
  -- — the REVOKE below narrows EXECUTE; this says why in the body).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'lineup_lock_tick: a job RPC is run by pg_cron or the service role, never by a signed-in user'
      USING ERRCODE = '42501';
  END IF;

  -- 125 (H2) — THE KILL SWITCH, read ONCE per invocation and not once per
  -- league (item 4b). `system_flags` is world-SELECT with NO WRITE POLICY FOR
  -- ANY ROLE (122:111-114), so an operator disables autopilot with a
  -- `service_role` write and nothing else:
  --     insert into system_flags (key, value)
  --     values ('autopilot_disabled', '{"disabled": true}')
  --     on conflict (key) do update set value = excluded.value, updated_at = now();
  -- Deleting the row re-enables it at the next minute. Nothing else in the
  -- tick is affected: the pool view and the lineup record keep running.
  SELECT COALESCE((f.value ->> 'disabled')::boolean, FALSE) INTO v_ap_off
  FROM public.system_flags f
  WHERE f.key = 'autopilot_disabled';
  v_ap_off := COALESCE(v_ap_off, FALSE);

  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    FOR v_lg IN
      SELECT l.id
      FROM public.leagues l
      WHERE l.status IN ('in_season', 'playoffs')
        AND l.deleted_at IS NULL
        AND (p_league_id IS NULL OR l.id = p_league_id)
        AND NOT (l.id = ANY (v_seen))
      ORDER BY l.id
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_lg.id;
      v_leagues := v_leagues + 1;

      BEGIN
        v_pool_changed := 0;
        SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_lg.id;
        v_current := public.lineup_current_week_internal(v_lg.id, p_now);
        IF v_current IS NULL THEN
          v_skipped := v_skipped || jsonb_build_object('league_id', v_lg.id, 'reason', 'no_league_weeks');
          CONTINUE;
        END IF;

        -- (a) THE POOL VIEW — what 115's helper says, and nothing else.
        FOR v_pool IN
          SELECT pp.player_id, pp.state, pp.locked_until, p.team AS nfl_team
          FROM public.league_player_pool pp
          JOIN public.players p ON p.id = pp.player_id
          WHERE pp.league_id = v_lg.id
          ORDER BY pp.player_id
        LOOP
          v_pool_rows := v_pool_rows + 1;
          v_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_pool.nfl_team, p_now);
          IF (v_lock ->> 'locked')::boolean THEN
            -- Locked: until the week's recorded last game end — or 'infinity'
            -- while that end is NOT YET RECORDED (F238's loud state; never a
            -- NULL that reads as unlocked, never a release the helper did
            -- not compute).
            v_new_until := COALESCE((v_lock ->> 'window_ends_at')::timestamptz, 'infinity'::timestamptz);
          ELSE
            v_new_until := NULL;
          END IF;
          v_new_state := CASE
            WHEN v_pool.state = 'free_agent'     AND v_new_until IS NOT NULL THEN 'locked_in_game'
            WHEN v_pool.state = 'locked_in_game' AND v_new_until IS NULL     THEN 'free_agent'
            ELSE v_pool.state END;   -- on_waivers / rostered keep their state (F222(a) CHECK; D294 mirror)
          IF v_new_until IS DISTINCT FROM v_pool.locked_until
             OR v_new_state IS DISTINCT FROM v_pool.state THEN
            UPDATE public.league_player_pool pp
            SET locked_until = v_new_until, state = v_new_state, updated_at = p_now
            WHERE pp.league_id = v_lg.id AND pp.player_id = v_pool.player_id;
            GET DIAGNOSTICS v_cnt = ROW_COUNT;
            IF v_cnt <> 1 THEN
              RAISE EXCEPTION 'lineup_lock_tick: pool refresh for % touched % rows, expected 1', v_pool.player_id, v_cnt
                USING ERRCODE = 'P0001';
            END IF;
            v_pool_updates := v_pool_updates + 1;
            v_pool_changed := v_pool_changed + 1;
          END IF;
        END LOOP;

        -- 119 (D296 / F252(a)): the pool's ONE broadcast — a per-league
        -- SUMMARY sent once per pass, only when this pass changed at least
        -- one pool row (a kickoff or a release instant; the guarded UPDATE
        -- above is diff-aware, so a quiet minute sends nothing). Never a
        -- row trigger (a slate kickoff would be one event per locked
        -- player per league — the broadcast storm §22.2 coalesces away),
        -- never per-player lines: the client refetches the rosters route.
        -- The 088 per-STATEMENT summary precedent: event = the table's
        -- name, `operation` UPDATE, `record` = the summary. realtime.send
        -- traps its own errors (070 banner) — an outage never fails a tick.
        IF v_pool_changed > 0 THEN
          PERFORM realtime.send(
            jsonb_build_object(
              'operation', 'UPDATE',
              'table',     'league_player_pool',
              'schema',    'public',
              'record',    jsonb_build_object(
                'season',  v_league.season,
                'week',    v_current,
                'changed', v_pool_changed,
                'at',      p_now)),
            'league_player_pool',
            'league:' || v_lg.id::text,
            true);
          v_pool_events := v_pool_events + 1;
        END IF;

        -- (b) THE LINEUP RECORD — locked_at + each starter's kickoff_at,
        --     re-evaluated from nfl_games at p_now (E42: a moved kickoff
        --     moves the record; E43: a postponed-out kickoff releases it).
        FOR v_row IN
          SELECT tl.id, tl.week, tl.starters, tl.locked_at
          FROM public.team_lineups tl
          JOIN public.teams t ON t.id = tl.team_id
          JOIN public.league_weeks lw
            ON lw.league_id = t.league_id AND lw.season = tl.season AND lw.week = tl.week
          WHERE t.league_id = v_lg.id
            AND tl.season = v_league.season
            AND tl.week <= v_current
            AND lw.status <> 'final'
            AND tl.slot_map IS NOT NULL
          ORDER BY tl.week, tl.team_id
        LOOP
          v_lineups := v_lineups + 1;
          v_new_locked_at := NULL;
          v_new_starters := '[]'::jsonb;
          v_changed := FALSE;
          FOR v_e IN SELECT * FROM jsonb_array_elements(v_row.starters) LOOP
            v_pid := v_e ->> 'player_id';
            IF v_pid IS NULL THEN
              v_new_starters := v_new_starters || v_e;
              CONTINUE;
            END IF;
            SELECT p.team INTO v_team FROM public.players p WHERE p.id = v_pid;
            SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_row.week, v_team, p_now);
            -- Compare INSTANTS, not rendered text (a session TimeZone renders
            -- the same instant differently — idempotence must not depend on it).
            IF (v_e ->> 'kickoff_at')::timestamptz IS DISTINCT FROM v_k.kickoff_at THEN
              v_changed := TRUE;
              v_new_starters := v_new_starters || (v_e || jsonb_build_object('kickoff_at', v_k.kickoff_at));
            ELSE
              v_new_starters := v_new_starters || v_e;
            END IF;
            IF v_k.kickoff_at IS NOT NULL THEN
              v_new_locked_at := LEAST(v_new_locked_at, v_k.kickoff_at);
            END IF;
          END LOOP;
          IF v_changed OR v_new_locked_at IS DISTINCT FROM v_row.locked_at THEN
            UPDATE public.team_lineups tl
            SET locked_at = v_new_locked_at,
                starters  = CASE WHEN v_changed THEN v_new_starters ELSE tl.starters END
            WHERE tl.id = v_row.id;
            GET DIAGNOSTICS v_cnt = ROW_COUNT;
            IF v_cnt <> 1 THEN
              RAISE EXCEPTION 'lineup_lock_tick: lineup record refresh for % touched % rows, expected 1', v_row.id, v_cnt
                USING ERRCODE = 'P0001';
            END IF;
            v_lineup_updates := v_lineup_updates + 1;
          END IF;
        END LOOP;

        -- 125 (H3) — (c) AUTOPILOT for a seat with NO MANAGER (§7.2.1(c),
        --     `spec:185`). Its OWN driving query, because (b) reads FROM
        --     `team_lineups` and a seat with no row for the week is invisible
        --     to it (D354). Inside the same per-league loop, so it inherits
        --     the `leagues FOR UPDATE SKIP LOCKED` row lock and the
        --     failure containment below — a league whose autopilot raises
        --     lands in `failures[]` and the next league still runs.
        IF NOT v_ap_off THEN
          FOR v_ap IN
            SELECT t.id AS team_id,
                   tl.id AS lineup_id,
                   EXISTS (SELECT 1 FROM public.league_members m WHERE m.team_id = t.id) AS has_member,
                   -- 139 (L.E1.22, Q63): the commissioner's per-team switch —
                   -- NO ROW IS OFF (the ruled default; no backfill).
                   COALESCE((SELECT sw.is_on FROM public.team_autopilot sw WHERE sw.team_id = t.id), FALSE) AS autopilot_on
            FROM public.teams t
            JOIN public.league_weeks lw
              ON lw.league_id = t.league_id
             AND lw.season = v_league.season
             AND lw.week = v_current
            LEFT JOIN public.team_lineups tl
              ON tl.team_id = t.id
             AND tl.season = v_league.season
             AND tl.week = v_current
            WHERE t.league_id = v_lg.id
              AND t.status <> 'retired'
              -- NEVER a past week in correction_window: `tl.week = v_current`
              -- does not imply `live` (112:360-374 derives v_current from
              -- nfl_weeks.starts_at, so the current week sits in
              -- correction_window from the last whistle until finalize, and
              -- filling it then is a scoring rewrite).
              AND lw.status = 'live'
              -- D339: the exact complement of set_lineup's own auth
              -- (114:240-243). Covers the placeholder seat AND the vacated
              -- seat with no OR, because they converge in this table.
              AND NOT EXISTS (
                SELECT 1 FROM public.league_members m
                WHERE m.team_id = t.id AND m.user_id IS NOT NULL)
            ORDER BY t.id
          LOOP
            -- D339's UNSAFE FAILURE DIRECTION, asserted and not inferred: the
            -- predicate above is ALSO true of a team with NO member row at
            -- all, and autopilot would then seize a human's team. Declined,
            -- and NAMED.
            IF NOT v_ap.has_member THEN
              -- R999: this seat is DECLINED, and the report says exactly that.
              -- It does NOT touch `v_ap_no_row` — the decline happens BEFORE
              -- the materialize step is reached, so calling it "no row and no
              -- materialize" would report a failure that never happened
              -- (§4 rule 15's own shape, in the field built to abolish it).
              v_ap_no_member := v_ap_no_member + 1;
              v_skipped := v_skipped || jsonb_build_object(
                'league_id', v_lg.id, 'team_id', v_ap.team_id,
                'reason', 'no_league_members_row',
                'why', 'one league_members row per seat is a §12.2 invariant stated in code, not schema (120:558) — a seat with none is NOT proven unmanaged, so autopilot declines rather than seizing a human''s team (D339)');
              CONTINUE;
            END IF;

            -- D354: a seat with NO row for the live week — the mid-week
            -- `add_placeholder_seat` case (063:455-465) — is MATERIALIZED
            -- through the UNCHANGED carry and then filled. It is 0 rows
            -- because the week's one-shot carry loop (118:1816-1824) had
            -- ALREADY RUN for this week; the carry's own INSERT has no
            -- ON CONFLICT, so a concurrent materialize is a loud 23505 in
            -- `failures[]` rather than a silent second row (116:541-551).
            IF v_ap.lineup_id IS NULL THEN
              PERFORM public.lineup_carry_internal(v_lg.id, v_ap.team_id, v_league.season, v_current, p_now);
              -- THE MATERIALIZE IS ASSERTED, NOT ASSUMED (R999). The carry's
              -- contract is INSERT-or-RAISE (`116:541-551`), so this re-read
              -- can only come back empty if that contract is ever weakened —
              -- and THAT is what `no_row_and_no_materialize` means. Without
              -- this check the chooser below would raise P0002 into
              -- `failures[]` and the reason field would say nothing about the
              -- seat; with it, the pass NAMES the seat and why.
              IF NOT EXISTS (
                SELECT 1 FROM public.team_lineups tl
                WHERE tl.team_id = v_ap.team_id
                  AND tl.season = v_league.season
                  AND tl.week = v_current)
              THEN
                v_ap_no_row := v_ap_no_row + 1;
                v_skipped := v_skipped || jsonb_build_object(
                  'league_id', v_lg.id, 'team_id', v_ap.team_id, 'week', v_current,
                  'reason', 'no_row_and_no_materialize',
                  'why', 'lineup_carry_internal returned without leaving a team_lineups row for this (team, season, week) — its own contract is INSERT-or-RAISE (116:541-551), so this is a contract violation reported rather than a 0-row UPDATE read as "nothing to do" (§4 rule 15)');
                CONTINUE;
              END IF;
              v_ap_mat := v_ap_mat || jsonb_build_object(
                'league_id', v_lg.id, 'team_id', v_ap.team_id, 'week', v_current,
                'why_absent', 'the week''s one-shot auto-carry (118:1816-1824) had already run when this seat was minted');
            END IF;

            -- 139 (L.E1.22, Q63 RULED 2026-09-27): "the default would be the
            -- commissioner has to manage the team, but give the [commissioner]
            -- a button that lets them put the team on autopilot." A seat whose
            -- switch is OFF is left EXACTLY as the carry (or the commissioner)
            -- left it — never filled, never substituted — and it is NAMED, so
            -- an empty slot there reads as the ruled state ("that is fine"),
            -- never as autopilot having silently done nothing. It still passed
            -- the materialize step above (D354): a seat with NO row would hold a
            -- total_points week pending for ever (the worker writes no
            -- provisional row without one — score-week-worker.ts step (6b) —
            -- so week_results_pending_internal reports it), and a lineup row is
            -- what the commissioner's own override edits.
            IF NOT v_ap.autopilot_on THEN
              v_ap_cm := v_ap_cm + 1;
              v_ap_cm_list := v_ap_cm_list || jsonb_build_object(
                'league_id', v_lg.id, 'team_id', v_ap.team_id, 'week', v_current,
                'reason', 'unmanaged_autopilot_off',
                'why', 'unmanaged, autopilot off — commissioner-managed (Q63, ruled 2026-09-27): the seat has no manager and the commissioner has not switched autopilot on, so it plays the lineup it has and an empty slot scores zero',
                'materialized', v_ap.lineup_id IS NULL);
              CONTINUE;
            END IF;

            v_ap_r := public.lineup_autopilot_internal(
              v_lg.id, v_ap.team_id, v_league.season, v_current, p_now);
            v_ap_seats := v_ap_seats + 1;

            -- Reported whether or not anything was written: a refused slot and
            -- a locked candidate are facts about the pass, not about the write.
            FOR v_e IN SELECT * FROM jsonb_array_elements(v_ap_r -> 'unfillable') LOOP
              v_ap_unfill := v_ap_unfill || (v_e || jsonb_build_object('team_id', v_ap.team_id));
            END LOOP;
            FOR v_e IN SELECT * FROM jsonb_array_elements(v_ap_r -> 'skipped_locked') LOOP
              v_ap_locked := v_ap_locked || (v_e || jsonb_build_object('team_id', v_ap.team_id));
            END LOOP;

            IF (v_ap_r ->> 'changed')::boolean THEN
              -- The FOUR columns TOGETHER (116:543-546) — never `slot_map`
              -- alone: they are redundant projections of one truth and a
              -- partial write is silent until they disagree in front of a
              -- user. `set_at` / `edited_by_commish` are deliberately not
              -- touched (autopilot is a SYSTEM act — D338).
              UPDATE public.team_lineups tl
              SET slot_map  = v_ap_r -> 'slot_map',
                  starters  = v_ap_r -> 'starters',
                  bench     = v_ap_r -> 'bench',
                  locked_at = (v_ap_r ->> 'locked_at')::timestamptz
              WHERE tl.team_id = v_ap.team_id
                AND tl.season = v_league.season
                AND tl.week = v_current;
              GET DIAGNOSTICS v_cnt = ROW_COUNT;
              IF v_cnt <> 1 THEN
                RAISE EXCEPTION 'lineup_lock_tick: autopilot write for team % week % touched % rows, expected 1', v_ap.team_id, v_current, v_cnt
                  USING ERRCODE = 'P0001';
              END IF;
              v_ap_writes := v_ap_writes + 1;
              v_autopiloted := v_autopiloted || jsonb_build_object(
                'league_id',   v_lg.id,
                'team_id',     v_ap.team_id,
                'week',        v_current,
                'filled',      v_ap_r -> 'filled',
                'substituted', v_ap_r -> 'substituted',
                'restored',    v_ap_r -> 'restored',
                'slot_map',    v_ap_r -> 'slot_map',
                'locked_at',   v_ap_r -> 'locked_at',
                -- 138 (L.E1.21, R1122): the chooser's order_basis for this
                -- pass: which Q62 key ordered its candidates and, when none had
                -- a usable value, that it FELL BACK TO ADP and why (rule 15).
                'order_basis', v_ap_r -> 'order_basis',
                'materialized', v_ap.lineup_id IS NULL);
            END IF;
          END LOOP;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'lineup_lock_tick failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass < c_batch OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'at',             p_now,
    'scope',          p_league_id,
    'leagues',        v_leagues,
    'pool_rows',      v_pool_rows,
    'pool_updates',   v_pool_updates,
    'pool_events',    v_pool_events,
    'lineups',        v_lineups,
    'lineup_updates', v_lineup_updates,
    'skipped',        v_skipped,
    'failures',       v_failures,
    'loops',          v_loops,
    -- 125 (H4): autopilot's report. Every seat filled, every seat
    -- materialized, every slot refused AND WHY, every candidate left behind
    -- by the lock — and a reason when nothing was filled at all (§4 rule 15).
    'autopiloted',          v_autopiloted,
    'seats_materialized',   v_ap_mat,
    'autopilot_unfillable', v_ap_unfill,
    'skipped_locked',       v_ap_locked,
    -- 139 (L.E1.22, Q63): every unmanaged seat left alone because its switch
    -- is OFF, BY NAME — the commissioner manages it.
    'commissioner_managed', v_ap_cm_list,
    -- THE ARMS ARE ORDERED, AND THE ORDER IS THE POINT (R999, #295's fix
    -- round). Each arm names a condition that was actually MEASURED on this
    -- pass; none of them describes work the pass did not attempt.
    'autopilot_reason', CASE
      WHEN v_ap_off THEN 'disabled_by_system_flag:autopilot_disabled'
      WHEN v_ap_writes > 0 THEN NULL                       -- the arrays say what happened
      -- A seat that reached the materialize step and STILL had no row: the
      -- carry's INSERT-or-RAISE contract broke. Ahead of the `v_ap_seats = 0`
      -- arms because such a seat is CONTINUEd before `v_ap_seats` is
      -- incremented, and "no unmanaged seats" would then be a lie about it.
      WHEN v_ap_no_row > 0 THEN 'no_row_and_no_materialize'
      -- 139 (L.E1.22, Q63): the pass evaluated NO seat because every unmanaged
      -- seat it reached has its switch OFF. Ahead of the D339 decline arm:
      -- with an OFF seat present, "every unmanaged-looking seat was declined"
      -- would be false (`skipped[]` still names each declined team).
      WHEN v_ap_seats = 0 AND v_ap_cm > 0
        THEN 'every_unmanaged_seat_commissioner_managed_autopilot_off'
      -- EVERY unmanaged-LOOKING seat was declined for want of a
      -- `league_members` row (D339's unsafe failure direction). Before the
      -- fix round this fell through to `nothing_fillable` — "nothing was
      -- fillable" about seats the pass deliberately never evaluated — or, when
      -- the seat also had no lineup row, to `no_row_and_no_materialize`, a
      -- materialization failure that never happened. `skipped[]` names each
      -- team; this says why the pass as a whole was silent.
      WHEN v_ap_seats = 0 AND v_ap_no_member > 0
        THEN 'every_unmanaged_looking_seat_declined_no_league_members_row'
      -- Precisely worded on purpose: arm (c)'s driving query is bounded to
      -- `lw.status = 'live'`, so "saw nothing" also covers an unmanaged seat
      -- in a current week that has closed into `correction_window`. A bare
      -- "no unmanaged seats" there would be a plausible-looking silence about
      -- a seat that does exist (§4 rule 15).
      WHEN v_ap_seats = 0 THEN 'no_unmanaged_seats_in_a_live_current_week'
      WHEN jsonb_array_length(v_ap_unfill) = 0
           AND jsonb_array_length(v_ap_locked) > 0 THEN 'every_candidate_locked'
      ELSE 'nothing_fillable' END,
    'reason', CASE
      WHEN v_leagues = 0 THEN 'no_in_season_leagues'
      -- 125 (H4): `v_ap_writes` joins the two 119 counters, so a pass that
      -- autopiloted can never report `no_changes`.
      WHEN v_pool_updates + v_lineup_updates + v_ap_writes = 0 THEN 'no_changes'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_lock_tick(TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;
