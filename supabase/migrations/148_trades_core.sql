-- ============================================================================
-- 148_trades_core.sql — the trade tables, the trade verbs (propose / accept /
-- reject / cancel / counter) and the E37 invalidation trigger (M5 task
-- L.D3.2, FULL rigour — roster exclusivity + permissions).
-- Spec §13.3 (Trades), §7.3.5 (the trade settings), §12.11 (+ erratum C74,
-- folded in v2.16.56), §12.12 / §10.3 (the commissioner arm's receipt),
-- §9.2 / §12.14 (member broadcast), E36 (uneven trades need drops), E37 (a
-- pending trade goes invalid the instant one of its players leaves a
-- roster), CLAUDE.md rule 7 (a player is on ONE roster per league).
-- Breakdown tasks-M5-transactions.md §6 L.D3.2, TD4 / TD5 / TD9 / TD12 /
-- TD13 / TD16, §4 rules; Q70–Q79 RULED as recommended (Chris 2026-09-27) —
-- Q75 (defer), Q76 (deadline) and Q77 (league vote) are L.D3.3 / L.D3.4's and
-- NOTHING here contradicts them (see "WHAT THIS DOES NOT DO").
--
-- Numbering (D161 — measured at task time on main @ 54244a3):
-- `ls supabase/migrations | tail -1` → 147_commish_edit_faab.sql ⇒ 148;
-- `ls supabase/tests | tail -1` → 095_commish_edit_faab.sql ⇒ pgTAP 096.
-- NOT held: reaches production by `npx supabase db push` only (push debt
-- becomes 135–148).
--
-- WHAT THIS MIGRATION DOES
--   1. `trades` — §12.11 as printed PLUS (C74 / tasks-M5 §5) the statuses
--      `invalid` and `expired`, `status_reason`, `accepted_at` / `accepted_by`,
--      `resolved_by`, `execute_after` (L.D3.3's defer), `proposed_by`,
--      `countered_from` (a counter links to the offer it answers) and
--      `action_id` (UNIQUE per league). NOT NULL + CHECKs on status and on
--      the status ⇔ timestamp shapes.
--   2. `trade_items` — §12.11 as printed, + CHECKs: a leg is a player XOR a
--      positive FAAB amount; from ≠ to; a player once per trade; one FAAB
--      leg per giving team.
--   3. `trade_drops` — TD13: the players a team drops as part of the trade
--      (the proposer's at proposal, the receiving team's at acceptance — E36).
--   4. `trade_actions` — the two verbs' replay ledger (D350 shape: ZERO
--      policies; one (league, action_id) namespace, the stored verb refusing
--      a cross-verb reuse — R732).
--   RLS: `trades`, `trade_items`, `trade_drops` are SELECT-only for LEAGUE
--   MEMBERS — spec §12.11's own policies ("Trades viewable by league
--   members"), keyed on `is_league_member` (membership truth, 052). A trade
--   is not blind (§13.2's blindness is the waiver bid's alone). NO write
--   policy for any role (TD4): every write is a DEFINER verb or the trigger.
--   All four tables born without TRUNCATE for anon / authenticated (133) and
--   REVOKEd again explicitly (the D350 house form; 081 §A enforces).
--   5. `trade_propose` / `trade_respond` — DEFINER doors over PLAIN
--      triple-REVOKEd internals taking `p_at` (the TimeProvider rule). Every
--      internal: shape → `leagues` row FOR UPDATE (the ONE serialization point
--      shared with add/drop 115:410-414, the claim verbs 145 and every
--      commissioner roster verb 127) → in-body auth (the team's manager, or a
--      commissioner / co-commissioner acting for ANY team — TD5; ONE no-leak
--      42501) → replay → re-read everything under the lock → refuse by name →
--      write → exactly-one-row assertions → the commissioner receipt (his arm
--      only) → notifications (TD16) → ledger row.
--      `trade_respond(op)`: `accept` (the receiving team, naming its drops —
--      E36), `reject` (the receiving team), `cancel` (the proposing team),
--      `counter` (the receiving team: the offer is rejected with reason
--      "countered" and a NEW proposal in the other direction is created,
--      linked by `countered_from`). An accepted trade WAITS in `accepted` —
--      review and execution are L.D3.3's.
--   6. `trade_check_internal` — the one validator, run at proposal, at
--      acceptance (re-validating everything under the lock) and at a
--      counter: every player is on the team the trade names (EXCLUSIVITY —
--      rule 7); a team's roster fits `roster_size` after the trade INCLUDING
--      its drops (E36: overflow without drops is refused by name, naming how
--      many to drop; the receiving team's overflow is REPORTED at proposal
--      and ENFORCED at acceptance, when it names its drops); FAAB legs only
--      when `allow_faab_in_trades` in a FAAB league and never above the
--      giver's CURRENT balance (checked, never debited — execution moves it,
--      L.D3.3); a one-sided trade only when `allow_future_considerations`
--      (§7.3.5: "notes-only gentleman's trades" — the consideration lives in
--      the note).
--   7. THE E37 TRIGGER (TD12) — `AFTER DELETE` and `AFTER UPDATE OF team_id`
--      on `league_rosters`: every trade still in flight (`proposed`,
--      `accepted`, `in_review`) that names that player LEAVING that team — as
--      a trade leg or as one of the trade's drops — goes `invalid` in the
--      same transaction, with a reason, and BOTH teams' managers are
--      notified. It covers EVERY roster writer (add/drop 115, the claim
--      processor to come, the commissioner's 127 verbs, retire-and-succeed
--      120's re-point, a draft reset) without replacing any of them. The
--      trade being EXECUTED is exempt through the transaction-local GUC
--      `app.executing_trade_id` (L.D3.3 sets it — PROGRESS F413). `ENABLE
--      ALWAYS` (R616: a replica-mode session must not skip it).
--   8. Broadcast (§9.2 / §12.14): `trades` INSERT and UPDATE OF status emit
--      on `league:<id>` (event `trades`) with a column-selected payload —
--      never `action_id` or `proposed_by`. Items / drops are refetched.
--
-- WHAT THIS DOES NOT DO (and why nothing here contradicts Q75–Q77)
--   * No execution, no review, no deadline, no game-day lock check — L.D3.3
--     (Q75 defer-until-the-week-ends; Q76 deadline = until the next week
--     begins, pending offers EXPIRE — the `expired` status exists for it).
--     A proposal or acceptance here moves NO player and NO dollar, so the
--     lock (TD11) is decided where rosters actually change.
--   * No votes — L.D3.4 (Q77). `in_review` / `vetoed` exist in the status
--     vocabulary (§12.11) and nothing here writes them.
--   * E47 (a party's manager removed while an offer is pending) — L.D3.3's
--     tick, per its task text. A retired franchise's pending trades DO go
--     invalid here, through the trigger, because 120 re-points its roster.
--
-- CALLS INTO EXISTING CODE (none replaced — ZERO D137 hunks)
--   `log_commissioner_action_internal` (123:417), `notify_league_member_
--   internal` (063:353), `draft_actor_name` (069:512), `is_league_commish` /
--   `is_league_member` (052:86-96), `realtime.send` (070/119 shape).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   Additive: four new tables (RLS on, same file), three SELECT policies,
--   thirteen new functions (two DEFINER doors, two DEFINER trigger functions,
--   nine PLAIN internals incl. the broadcast payload), four new triggers (two
--   on league_rosters, two on trades). Replaces NO existing function. Typegen: additive (four tables,
--   the functions); the 42-export alias block re-appended.
--   Grants (D18 → D23 → 133): doors REVOKEd from PUBLIC + anon, EXECUTE for
--   authenticated (the in-body gate is the authorization); internals and
--   trigger functions REVOKEd from PUBLIC, anon, authenticated.
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–148 and the full pgTAP run in the PR. D38 realtime —
--   `trades` joins the member-authorized `league:<id>` topic (070's
--   realtime.messages policy), column-selected. No backfill: no trade exists
--   before this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. trades — §12.11 + erratum C74
-- ---------------------------------------------------------------------------
CREATE TABLE trades (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id         UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  proposer_team_id  UUID REFERENCES teams(id) NOT NULL,
  recipient_team_id UUID REFERENCES teams(id) NOT NULL,
  status            TEXT NOT NULL DEFAULT 'proposed'
                    CONSTRAINT trades_status_check
                    CHECK (status IN ('proposed', 'accepted', 'rejected', 'cancelled', 'in_review',
                                      'vetoed', 'complete', 'reversed', 'invalid', 'expired')),
  status_reason     TEXT,                                   -- why it left `proposed` (C74): "rejected by …", "countered by …", E37's player sentence …
  review_deadline   TIMESTAMPTZ,                            -- §12.11 as printed (L.D3.3)
  execute_after     TIMESTAMPTZ,                            -- L.D3.3's defer instant (TD11)
  note              TEXT
                    CONSTRAINT trades_note_length CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  countered_from    UUID REFERENCES trades(id),             -- the offer this one counters
  proposed_by       UUID REFERENCES profiles(id) NOT NULL,  -- the manager, or the commissioner acting for the team
  accepted_at       TIMESTAMPTZ,
  accepted_by       UUID REFERENCES profiles(id),
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID REFERENCES profiles(id),           -- NULL when a trigger / job resolved it
  action_id         UUID NOT NULL,                          -- the proposing verb's idempotency stamp
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trades_two_teams CHECK (proposer_team_id <> recipient_team_id),
  CONSTRAINT trades_action_unique UNIQUE (league_id, action_id),
  -- In flight ⇔ unresolved.
  CONSTRAINT trades_resolved_shape
    CHECK ((status IN ('proposed', 'accepted', 'in_review')) = (resolved_at IS NULL)),
  -- A status only an accepted trade can reach carries its acceptance.
  CONSTRAINT trades_accepted_shape
    CHECK (status NOT IN ('accepted', 'in_review', 'vetoed', 'complete', 'reversed')
           OR (accepted_at IS NOT NULL AND accepted_by IS NOT NULL)),
  -- Every way out of flight says why (C74; E37 "with a reason").
  CONSTRAINT trades_reason_shape
    CHECK (status IN ('proposed', 'accepted', 'in_review', 'complete') OR status_reason IS NOT NULL)
);

CREATE INDEX idx_trades_league_status ON trades(league_id, status, created_at DESC);
CREATE INDEX idx_trades_proposer ON trades(proposer_team_id);
CREATE INDEX idx_trades_recipient ON trades(recipient_team_id);
CREATE INDEX idx_trades_countered_from ON trades(countered_from) WHERE countered_from IS NOT NULL;

COMMENT ON TABLE trades IS
  'Trades (§12.11 + erratum C74; §13.3; migration 148). Readable by every league member (the spec''s own policy — a trade is not blind); NO write policy for any role (TD4): written only by trade_propose / trade_respond, the E37 roster trigger and (L.D3.3+) the executor / review. In flight = proposed / accepted / in_review; everything else is resolved with a status_reason. Broadcast on league:<id> (event trades), column-selected.';

-- ---------------------------------------------------------------------------
-- 2. trade_items — §12.11 as printed, with its shape CHECKed
-- ---------------------------------------------------------------------------
CREATE TABLE trade_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id     UUID REFERENCES trades(id) ON DELETE CASCADE NOT NULL,
  from_team_id UUID REFERENCES teams(id) NOT NULL,
  to_team_id   UUID REFERENCES teams(id) NOT NULL,
  player_id    TEXT REFERENCES players(id),            -- a player OR faab
  faab_amount  INTEGER,                                -- when trading FAAB (allow_faab_in_trades)
  CONSTRAINT trade_items_player_xor_faab CHECK ((player_id IS NULL) <> (faab_amount IS NULL)),
  CONSTRAINT trade_items_faab_positive CHECK (faab_amount IS NULL OR faab_amount >= 1),
  CONSTRAINT trade_items_two_teams CHECK (from_team_id <> to_team_id),
  CONSTRAINT trade_items_player_once UNIQUE (trade_id, player_id)
);
CREATE INDEX idx_trade_items_trade ON trade_items(trade_id);
CREATE INDEX idx_trade_items_player ON trade_items(player_id) WHERE player_id IS NOT NULL;   -- the E37 trigger's lookup
CREATE UNIQUE INDEX uq_trade_items_one_faab_leg
  ON trade_items(trade_id, from_team_id) WHERE faab_amount IS NOT NULL;

COMMENT ON TABLE trade_items IS
  'The legs of a trade (§12.11; migration 148): a player OR a positive FAAB amount moving from one party to the other. Member-readable through the parent trade; no write policy.';

-- ---------------------------------------------------------------------------
-- 3. trade_drops — TD13 / E36
-- ---------------------------------------------------------------------------
CREATE TABLE trade_drops (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id   UUID REFERENCES trades(id) ON DELETE CASCADE NOT NULL,
  team_id    UUID REFERENCES teams(id) NOT NULL,
  player_id  TEXT REFERENCES players(id) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trade_drops_player_once UNIQUE (trade_id, player_id)
);
CREATE INDEX idx_trade_drops_player ON trade_drops(player_id);   -- the E37 trigger's lookup

COMMENT ON TABLE trade_drops IS
  'Players a party drops AS PART of a trade so its roster fits after it (E36 / TD13; migration 148): the proposer names his at proposal, the receiving team at acceptance. They leave with the trade''s execution (L.D3.3), never before. Member-readable through the parent trade; no write policy.';

-- ---------------------------------------------------------------------------
-- 4. trade_actions — the replay ledger (D350). ZERO policies.
-- ---------------------------------------------------------------------------
CREATE TABLE trade_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,   -- the team the actor acted FOR
  verb       TEXT NOT NULL
             CONSTRAINT trade_actions_verb_check CHECK (verb IN ('trade_propose', 'trade_respond')),
  action_id  UUID NOT NULL,                      -- client-minted; dedupes retries (E2 / D68)
  actor_id   UUID NOT NULL REFERENCES profiles(id),
  result     JSONB NOT NULL,                     -- the verb's returned jsonb, replayed byte-identically
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trade_actions_unique UNIQUE (league_id, action_id)
);
CREATE INDEX idx_trade_actions_team ON trade_actions(team_id);

COMMENT ON TABLE trade_actions IS
  'Idempotency ledger for trade_propose / trade_respond (migration 148, D350). ZERO policies: the verbs are its only reader and writer. One (league, action_id) namespace across both verbs; the stored verb / team / trade / op refuse a cross-request reuse (R732). Not the audit log (§12.26).';

-- ---------------------------------------------------------------------------
-- RLS — §12.11's policies, TO authenticated (145's house form)
-- ---------------------------------------------------------------------------
ALTER TABLE trades        ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_drops   ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trades viewable by league members" ON trades FOR SELECT TO authenticated
  USING (public.is_league_member(league_id));
CREATE POLICY "Trade items viewable by league members" ON trade_items FOR SELECT TO authenticated
  USING (public.is_league_member((SELECT t.league_id FROM public.trades t WHERE t.id = trade_items.trade_id)));
CREATE POLICY "Trade drops viewable by league members" ON trade_drops FOR SELECT TO authenticated
  USING (public.is_league_member((SELECT t.league_id FROM public.trades t WHERE t.id = trade_drops.trade_id)));
-- No INSERT / UPDATE / DELETE policy for ANY role (TD4). pgTAP 096 §H walks
-- anon, a non-member, a non-party member, a party manager and the
-- commissioner with RETURNING counts.
REVOKE TRUNCATE ON TABLE trades        FROM PUBLIC, anon, authenticated;
REVOKE TRUNCATE ON TABLE trade_items   FROM PUBLIC, anon, authenticated;
REVOKE TRUNCATE ON TABLE trade_drops   FROM PUBLIC, anon, authenticated;
REVOKE TRUNCATE ON TABLE trade_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. trade_view_internal / trade_summary_internal — the ONE shape a trade is
--    reported in (results, notifications, posts). PLAIN, STABLE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_view_internal(p_trade_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id',                t.id,
    'league_id',         t.league_id,
    'status',            t.status,
    'status_reason',     t.status_reason,
    'proposer_team_id',  t.proposer_team_id,
    'recipient_team_id', t.recipient_team_id,
    'note',              t.note,
    'countered_from',    t.countered_from,
    'created_at',        t.created_at,
    'accepted_at',       t.accepted_at,
    'resolved_at',       t.resolved_at,
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'from_team_id', i.from_team_id,
                'to_team_id',   i.to_team_id,
                'player_id',    i.player_id,
                'player_name',  p.full_name,
                'faab_amount',  i.faab_amount)
              ORDER BY (i.from_team_id <> t.proposer_team_id), (i.faab_amount IS NOT NULL), i.player_id), '[]'::jsonb)
              FROM public.trade_items i LEFT JOIN public.players p ON p.id = i.player_id
              WHERE i.trade_id = t.id),
    'drops', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'team_id',     d.team_id,
                'player_id',   d.player_id,
                'player_name', p.full_name)
              ORDER BY (d.team_id <> t.proposer_team_id), d.player_id), '[]'::jsonb)
              FROM public.trade_drops d JOIN public.players p ON p.id = d.player_id
              WHERE d.trade_id = t.id))
  FROM public.trades t
  WHERE t.id = p_trade_id;
$$;
REVOKE EXECUTE ON FUNCTION trade_view_internal(UUID) FROM PUBLIC, anon, authenticated;

-- "WC Alpha gives WC A1, $5 FAAB; WC Bravo gives WC B1" — league-visible
-- (trades are member-readable), used by posts and notifications.
CREATE OR REPLACE FUNCTION trade_summary_internal(p_trade_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT string_agg(side.team_name || ' gives ' || side.gives, '; ' ORDER BY side.ord)
  FROM (
    SELECT s.ord, tm.name AS team_name,
           COALESCE((SELECT string_agg(COALESCE(p.full_name, i.player_id), ', ' ORDER BY p.full_name, i.player_id)
                     FROM public.trade_items i LEFT JOIN public.players p ON p.id = i.player_id
                     WHERE i.trade_id = t.id AND i.from_team_id = s.team_id AND i.player_id IS NOT NULL)
                    || COALESCE((SELECT ', $' || i.faab_amount || ' FAAB' FROM public.trade_items i
                                 WHERE i.trade_id = t.id AND i.from_team_id = s.team_id AND i.faab_amount IS NOT NULL), ''),
                    (SELECT '$' || i.faab_amount || ' FAAB' FROM public.trade_items i
                     WHERE i.trade_id = t.id AND i.from_team_id = s.team_id AND i.faab_amount IS NOT NULL),
                    'nothing (future considerations)') AS gives
    FROM public.trades t
    CROSS JOIN LATERAL (VALUES (1, t.proposer_team_id), (2, t.recipient_team_id)) AS s(ord, team_id)
    JOIN public.teams tm ON tm.id = s.team_id
    WHERE t.id = p_trade_id) side;
$$;
REVOKE EXECUTE ON FUNCTION trade_summary_internal(UUID) FROM PUBLIC, anon, authenticated;

-- Notify the seated manager of a team (TD16). Returns the user notified, or
-- NULL (an open seat, or — when p_skip_actor — the actor himself).
CREATE OR REPLACE FUNCTION trade_notify_team_internal(
  p_league_id  UUID,
  p_team_id    UUID,
  p_type       TEXT,
  p_title      TEXT,
  p_body       TEXT,
  p_data       JSONB,
  p_skip_actor BOOLEAN
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_user UUID;
BEGIN
  SELECT m.user_id INTO v_user
  FROM public.league_members m
  WHERE m.league_id = p_league_id AND m.team_id = p_team_id AND m.user_id IS NOT NULL;
  IF v_user IS NULL OR (p_skip_actor AND v_user IS NOT DISTINCT FROM auth.uid()) THEN
    RETURN NULL;
  END IF;
  PERFORM public.notify_league_member_internal(
    v_user, p_type, p_title, p_body,
    p_data || jsonb_build_object('league_id', p_league_id, 'team_id', p_team_id));
  RETURN v_user;
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_notify_team_internal(UUID, UUID, TEXT, TEXT, TEXT, JSONB, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. trade_receipt_internal — the commissioner arm's receipt (TD5 / D336):
--    ONE commissioner_actions row (target the trade, acting_as_team_id = the
--    team he acted for), the §10.3 system post, and that team's manager's
--    notification. Trades are league-visible, so the receipt names the deal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_receipt_internal(
  p_league_id   UUID,
  p_team        public.teams,
  p_action_type TEXT,
  p_act_text    TEXT,        -- e.g. 'accepted a trade for'
  p_trade_id    UUID,
  p_before      JSONB,
  p_after       JSONB,
  p_reason      TEXT,
  p_action_id   UUID,
  p_verb        TEXT,
  p_season      INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_audit_id UUID;
  v_trade    public.trades;
  v_summary  TEXT;
  v_message  TEXT;
  v_manager  UUID;
BEGIN
  SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = p_trade_id;
  v_summary := public.trade_summary_internal(p_trade_id);

  v_audit_id := public.log_commissioner_action_internal(
    p_league_id, auth.uid(), p_action_type, 'trade', p_trade_id::text, p_reason,
    p_before, p_after,
    jsonb_build_object(
      'verb',              p_verb,
      'season',            p_season,
      'action_id',         p_action_id,
      'team_name',         p_team.name,
      'trade_id',          p_trade_id,
      'summary',           v_summary,
      'affected_team_ids', jsonb_build_array(v_trade.proposer_team_id, v_trade.recipient_team_id),
      'bypassed',          '[]'::jsonb),
    p_team.id);
  IF v_audit_id IS NULL THEN
    RAISE EXCEPTION '%: the audit row was not written — refusing to let a commissioner act without its receipt (§10.3)', p_verb
      USING ERRCODE = 'P0001';
  END IF;

  v_message := public.draft_actor_name() || ' (commissioner) ' || p_act_text || ' ' || p_team.name
    || ': ' || v_summary
    || CASE WHEN p_reason IS NOT NULL THEN ' — reason: ' || p_reason ELSE '' END;
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

  v_manager := public.trade_notify_team_internal(
    p_league_id, p_team.id, 'league_trade_commissioner',
    'The commissioner ' || p_act_text || ' your team',
    v_summary || CASE WHEN p_reason IS NOT NULL THEN ' — reason: ' || p_reason ELSE '' END,
    jsonb_build_object('trade_id', p_trade_id, 'commissioner_action_id', v_audit_id),
    TRUE);

  RETURN jsonb_build_object(
    'commissioner_action_id', v_audit_id,
    'system_post',            v_message,
    'notified_user_id',       v_manager);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_receipt_internal(UUID, public.teams, TEXT, TEXT, UUID, JSONB, JSONB, TEXT, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. trade_check_internal — THE validator (exclusivity, E36, FAAB, sides).
--    p_items is the NORMALIZED leg list:
--      [{player_id | null, faab_amount | null, from_team_id, to_team_id}, …]
--    p_recipient_drops NULL = the receiving team has not answered yet (a
--    proposal): its overflow is REPORTED (`must_drop`), not enforced.
--    Raises by name on the first invalidity; returns the roster facts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_check_internal(
  p_verb            TEXT,
  p_league          public.leagues,
  p_proposer        public.teams,
  p_recipient       public.teams,
  p_items           JSONB,
  p_proposer_drops  TEXT[],
  p_recipient_drops TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_roster_size   INTEGER;
  v_item          RECORD;
  v_player        public.players;
  v_holder        public.league_rosters;
  v_holder_team   public.teams;
  v_allow_faab    BOOLEAN;
  v_allow_future  BOOLEAN;
  v_gives_p       INTEGER;
  v_gives_r       INTEGER;
  v_side          RECORD;
  v_drop          TEXT;
  v_seen          TEXT[];
  v_has_seat      BOOLEAN;
  v_balance       INTEGER;
  v_before        INTEGER;
  v_out           INTEGER;
  v_in            INTEGER;
  v_ndrops        INTEGER;
  v_after         INTEGER;
  v_facts         JSONB := '{}'::jsonb;
BEGIN
  SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(p_league.roster_settings -> 'starting_slots') s), 0)
       + COALESCE((p_league.roster_settings ->> 'bench')::int, 0)
       + COALESCE(jsonb_array_length(p_league.roster_settings -> 'ir_slots'), 0)
  INTO v_roster_size;

  -- (a) EXCLUSIVITY (rule 7 / §12.7): every player leg is on the roster of
  --     the team the trade says gives him — never another team's, never
  --     nobody's.
  FOR v_item IN
    SELECT i.player_id, i.from_team_id
    FROM jsonb_to_recordset(p_items) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID)
    WHERE i.player_id IS NOT NULL
    ORDER BY i.player_id
  LOOP
    SELECT p.* INTO v_player FROM public.players p WHERE p.id = v_item.player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%: no player with id % (trade leg)', p_verb, v_item.player_id USING ERRCODE = 'P0001';
    END IF;
    SELECT r.* INTO v_holder FROM public.league_rosters r
    WHERE r.league_id = p_league.id AND r.player_id = v_item.player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        '%: % (%) is not on any roster in this league — only a rostered player can be traded (§13.3)',
        p_verb, v_player.full_name, v_item.player_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_holder.team_id <> v_item.from_team_id THEN
      SELECT t.* INTO v_holder_team FROM public.teams t WHERE t.id = v_holder.team_id;
      RAISE EXCEPTION
        '%: % (%) is on %''s roster, not %''s — a trade can only move a player from the team that has him (player exclusivity, §13.3 / CLAUDE.md rule 7)',
        p_verb, v_player.full_name, v_item.player_id, v_holder_team.name,
        CASE WHEN v_item.from_team_id = p_proposer.id THEN p_proposer.name ELSE p_recipient.name END
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- (b) BOTH SIDES GIVE SOMETHING — unless the league allows future
  --     considerations (§7.3.5: "notes-only gentleman's trades").
  v_allow_faab   := COALESCE((p_league.settings ->> 'allow_faab_in_trades')::boolean, FALSE);
  v_allow_future := COALESCE((p_league.settings ->> 'allow_future_considerations')::boolean, FALSE);
  SELECT count(*) FILTER (WHERE i.from_team_id = p_proposer.id)::int,
         count(*) FILTER (WHERE i.from_team_id = p_recipient.id)::int
  INTO v_gives_p, v_gives_r
  FROM jsonb_to_recordset(p_items) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID);
  IF (v_gives_p = 0 OR v_gives_r = 0) AND NOT v_allow_future THEN
    RAISE EXCEPTION
      '%: % gives nothing in this trade — this league does not allow future considerations (allow_future_considerations is off, §7.3.5), so each team gives at least one player or FAAB',
      p_verb, CASE WHEN v_gives_p = 0 THEN p_proposer.name ELSE p_recipient.name END
      USING ERRCODE = 'P0001';
  END IF;

  -- (c) FAAB LEGS — only when allowed, only in a FAAB league, never above
  --     the giver's CURRENT balance (checked here, moved at execution).
  FOR v_item IN
    SELECT i.faab_amount, i.from_team_id
    FROM jsonb_to_recordset(p_items) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID)
    WHERE i.faab_amount IS NOT NULL
    ORDER BY i.from_team_id
  LOOP
    IF NOT v_allow_faab THEN
      RAISE EXCEPTION '%: FAAB cannot be traded in this league (allow_faab_in_trades is off, §7.3.5)', p_verb
        USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(p_league.waiver_type, 'faab') <> 'faab' THEN
      RAISE EXCEPTION
        '%: this league decides waivers by priority (%), not FAAB — there is no FAAB to trade (§7.3.4)',
        p_verb, p_league.waiver_type
        USING ERRCODE = 'P0001';
    END IF;
    v_has_seat := NULL;
    v_balance := NULL;
    SELECT TRUE, m.faab_balance INTO v_has_seat, v_balance
    FROM public.league_members m
    WHERE m.league_id = p_league.id AND m.team_id = v_item.from_team_id;
    IF v_has_seat IS NULL OR v_balance IS NULL THEN
      RAISE EXCEPTION
        '%: % has no FAAB balance on record (its league_members seat %) — refusing to trade money that is not recorded (§12.2)',
        p_verb, CASE WHEN v_item.from_team_id = p_proposer.id THEN p_proposer.name ELSE p_recipient.name END,
        CASE WHEN v_has_seat IS NULL THEN 'is missing' ELSE 'holds NULL' END
        USING ERRCODE = 'P0001';
    END IF;
    IF v_item.faab_amount > v_balance THEN
      RAISE EXCEPTION '%: % cannot give $% of FAAB — its balance is $% (§13.3)',
        p_verb, CASE WHEN v_item.from_team_id = p_proposer.id THEN p_proposer.name ELSE p_recipient.name END,
        v_item.faab_amount, v_balance
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- (d) EACH SIDE: its drops are its own, distinct, not already leaving in
  --     the trade; its roster fits after the trade (E36).
  FOR v_side IN
    SELECT * FROM (VALUES
      ('proposer'::text,  p_proposer.id,  p_proposer.name,  p_proposer_drops,  TRUE),
      ('recipient'::text, p_recipient.id, p_recipient.name, p_recipient_drops, p_recipient_drops IS NOT NULL)
    ) AS s(role, team_id, team_name, drops, enforce)
  LOOP
    v_seen := ARRAY[]::text[];
    FOREACH v_drop IN ARRAY COALESCE(v_side.drops, ARRAY[]::text[]) LOOP
      IF v_drop IS NULL THEN
        RAISE EXCEPTION '%: a drop for % is NULL — every drop names one player', p_verb, v_side.team_name
          USING ERRCODE = '22023';
      END IF;
      IF v_drop = ANY (v_seen) THEN
        RAISE EXCEPTION '%: % names the drop % twice — each player is dropped once', p_verb, v_side.team_name, v_drop
          USING ERRCODE = '22023';
      END IF;
      v_seen := v_seen || v_drop;
      SELECT p.* INTO v_player FROM public.players p WHERE p.id = v_drop;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%: no player with id % (drop)', p_verb, v_drop USING ERRCODE = 'P0001';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.league_rosters r
                     WHERE r.league_id = p_league.id AND r.team_id = v_side.team_id AND r.player_id = v_drop) THEN
        RAISE EXCEPTION
          '%: % (%) is not on %''s roster — a team can only drop its own players to make room (E36)',
          p_verb, v_player.full_name, v_drop, v_side.team_name
          USING ERRCODE = 'P0001';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID)
                 WHERE i.player_id = v_drop) THEN
        RAISE EXCEPTION
          '%: % (%) is already leaving % in this trade — he cannot also be one of its drops',
          p_verb, v_player.full_name, v_drop, v_side.team_name
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    SELECT count(*)::int INTO v_before
    FROM public.league_rosters r WHERE r.league_id = p_league.id AND r.team_id = v_side.team_id;
    SELECT count(*) FILTER (WHERE i.from_team_id = v_side.team_id)::int,
           count(*) FILTER (WHERE i.to_team_id = v_side.team_id)::int
    INTO v_out, v_in
    FROM jsonb_to_recordset(p_items) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID)
    WHERE i.player_id IS NOT NULL;
    v_ndrops := COALESCE(cardinality(v_side.drops), 0);
    v_after := v_before - v_out + v_in - v_ndrops;

    IF v_side.enforce AND v_after > v_roster_size THEN
      RAISE EXCEPTION
        '%: %''s roster would hold % players after this trade — % more than its % spots (§7.3.2 roster_size): name % more drop(s) as part of the trade (E36)',
        p_verb, v_side.team_name, v_after, v_after - v_roster_size, v_roster_size, v_after - v_roster_size
        USING ERRCODE = 'P0001';
    END IF;

    v_facts := v_facts || jsonb_build_object(v_side.role, jsonb_build_object(
      'team_id',      v_side.team_id,
      'count_before', v_before,
      'players_out',  v_out,
      'players_in',   v_in,
      'drops',        v_ndrops,
      'count_after',  v_after,
      'roster_size',  v_roster_size,
      'must_drop',    GREATEST(v_after - v_roster_size, 0),
      'enforced',     v_side.enforce));
  END LOOP;

  RETURN v_facts || jsonb_build_object(
    'allow_faab_in_trades',        v_allow_faab,
    'allow_future_considerations', v_allow_future);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_check_internal(TEXT, public.leagues, public.teams, public.teams, JSONB, TEXT[], TEXT[])
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. trade_propose_core_internal — shape the legs, validate, write ONE
--    proposal. Shared by trade_propose and trade_respond('counter'). The
--    caller holds the league lock and has authorized the actor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_propose_core_internal(
  p_verb           TEXT,
  p_league         public.leagues,
  p_from_team_id   UUID,
  p_to_team_id     UUID,
  p_items          JSONB,
  p_drops          TEXT[],
  p_note           TEXT,
  p_action_id      UUID,
  p_at             TIMESTAMPTZ,
  p_countered_from UUID
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_from     public.teams;
  v_to       public.teams;
  v_note     TEXT;
  v_elem     JSONB;
  v_bad      TEXT;
  v_leg_from UUID;
  v_norm     JSONB := '[]'::jsonb;
  v_amount   NUMERIC;
  v_check    JSONB;
  v_trade    public.trades;
  v_cnt      INTEGER;
BEGIN
  -- THE TWO TEAMS — franchises of this league, active, different.
  IF p_to_team_id IS NULL THEN
    RAISE EXCEPTION '%: the receiving team is required — a trade is between two teams', p_verb
      USING ERRCODE = '22023';
  END IF;
  SELECT t.* INTO v_from FROM public.teams t WHERE t.id = p_from_team_id;
  IF NOT FOUND OR v_from.league_id IS DISTINCT FROM p_league.id THEN
    RAISE EXCEPTION '%: team % is not a franchise of league %', p_verb, p_from_team_id, p_league.id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT t.* INTO v_to FROM public.teams t WHERE t.id = p_to_team_id;
  IF NOT FOUND OR v_to.league_id IS DISTINCT FROM p_league.id THEN
    RAISE EXCEPTION '%: team % is not a franchise of league %', p_verb, p_to_team_id, p_league.id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_from.id = v_to.id THEN
    RAISE EXCEPTION '%: % cannot trade with itself — a trade is between two different teams', p_verb, v_from.name
      USING ERRCODE = 'P0001';
  END IF;
  IF v_from.status = 'retired' OR v_to.status = 'retired' THEN
    RAISE EXCEPTION '%: % is retired — a sealed franchise makes no trades (§7.2.1)', p_verb,
      CASE WHEN v_from.status = 'retired' THEN v_from.name ELSE v_to.name END
      USING ERRCODE = 'P0001';
  END IF;

  -- THE NOTE — optional, trimmed, ≤ 500 (the league_chat bound).
  v_note := NULLIF(btrim(COALESCE(p_note, ''), E' \t\r\n'), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION '%: the note is % characters — at most 500', p_verb, char_length(v_note)
      USING ERRCODE = '22023';
  END IF;

  -- THE LEGS — shape-checked into the normalized list (22023 = a malformed
  -- request, never a business refusal).
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '%: p_items is required — a JSON array of legs, each {"player_id": …} or {"faab_amount": …} with its "from_team_id"; a trade moves at least one player or FAAB', p_verb
      USING ERRCODE = '22023';
  END IF;
  FOR v_elem IN SELECT e FROM jsonb_array_elements(p_items) AS x(e) LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION '%: every trade leg is a JSON object (got %)', p_verb, v_elem USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad
    FROM jsonb_object_keys(v_elem) AS k WHERE k NOT IN ('player_id', 'faab_amount', 'from_team_id');
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION '%: unknown key(s) % in trade leg % — a leg has player_id or faab_amount, and from_team_id', p_verb, v_bad, v_elem
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_elem -> 'from_team_id') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION '%: trade leg % has no from_team_id — every leg names the team that gives it', p_verb, v_elem
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_leg_from := (v_elem ->> 'from_team_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION '%: from_team_id % is not a team id', p_verb, v_elem ->> 'from_team_id' USING ERRCODE = '22023';
    END;
    IF v_leg_from NOT IN (v_from.id, v_to.id) THEN
      RAISE EXCEPTION '%: trade leg % comes from a team that is not in this trade (% or %)', p_verb, v_elem, v_from.name, v_to.name
        USING ERRCODE = '22023';
    END IF;
    IF (COALESCE(jsonb_typeof(v_elem -> 'player_id'), 'null') <> 'null') = (COALESCE(jsonb_typeof(v_elem -> 'faab_amount'), 'null') <> 'null') THEN
      RAISE EXCEPTION '%: trade leg % must be a player OR a FAAB amount — exactly one of player_id / faab_amount', p_verb, v_elem
        USING ERRCODE = '22023';
    END IF;
    IF COALESCE(jsonb_typeof(v_elem -> 'player_id'), 'null') <> 'null' THEN
      IF jsonb_typeof(v_elem -> 'player_id') <> 'string' OR btrim(v_elem ->> 'player_id') = '' THEN
        RAISE EXCEPTION '%: trade leg % has a player_id that is not a player id', p_verb, v_elem USING ERRCODE = '22023';
      END IF;
      v_norm := v_norm || jsonb_build_array(jsonb_build_object(
        'player_id', v_elem ->> 'player_id', 'faab_amount', NULL,
        'from_team_id', v_leg_from, 'to_team_id', CASE WHEN v_leg_from = v_from.id THEN v_to.id ELSE v_from.id END));
    ELSE
      IF jsonb_typeof(v_elem -> 'faab_amount') <> 'number' THEN
        RAISE EXCEPTION '%: trade leg % has a faab_amount that is not a number', p_verb, v_elem USING ERRCODE = '22023';
      END IF;
      v_amount := (v_elem ->> 'faab_amount')::numeric;
      IF v_amount <> trunc(v_amount) OR v_amount < 1 OR v_amount > 2147483647 THEN
        RAISE EXCEPTION '%: a FAAB leg of % is not a whole number of dollars from $1 up', p_verb, v_elem ->> 'faab_amount'
          USING ERRCODE = '22023';
      END IF;
      v_norm := v_norm || jsonb_build_array(jsonb_build_object(
        'player_id', NULL, 'faab_amount', v_amount::int,
        'from_team_id', v_leg_from, 'to_team_id', CASE WHEN v_leg_from = v_from.id THEN v_to.id ELSE v_from.id END));
    END IF;
  END LOOP;
  SELECT string_agg(DISTINCT i.player_id, ', ') INTO v_bad
  FROM jsonb_to_recordset(v_norm) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID)
  WHERE i.player_id IS NOT NULL
    AND (SELECT count(*) FROM jsonb_to_recordset(v_norm) AS j(player_id TEXT) WHERE j.player_id = i.player_id) > 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%: the trade names % more than once — each player is one leg', p_verb, v_bad USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_norm) AS i(faab_amount INTEGER, from_team_id UUID)
             WHERE i.faab_amount IS NOT NULL GROUP BY i.from_team_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION '%: a team gives FAAB in more than one leg — give one amount per team', p_verb USING ERRCODE = '22023';
  END IF;

  -- VALIDATE (the one validator; the receiving team's drops come at acceptance).
  v_check := public.trade_check_internal(p_verb, p_league, v_from, v_to, v_norm, COALESCE(p_drops, ARRAY[]::text[]), NULL);

  -- WRITE — the trade, its legs, the proposer's drops.
  INSERT INTO public.trades (
    league_id, proposer_team_id, recipient_team_id, status, note, countered_from,
    proposed_by, action_id, created_at)
  VALUES (
    p_league.id, v_from.id, v_to.id, 'proposed', v_note, p_countered_from,
    auth.uid(), p_action_id, p_at)
  RETURNING * INTO v_trade;

  INSERT INTO public.trade_items (trade_id, from_team_id, to_team_id, player_id, faab_amount)
  SELECT v_trade.id, i.from_team_id, i.to_team_id, i.player_id, i.faab_amount
  FROM jsonb_to_recordset(v_norm) AS i(player_id TEXT, faab_amount INTEGER, from_team_id UUID, to_team_id UUID);
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> jsonb_array_length(v_norm) THEN
    RAISE EXCEPTION '%: wrote % trade legs, expected %', p_verb, v_cnt, jsonb_array_length(v_norm) USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.trade_drops (trade_id, team_id, player_id, created_at)
  SELECT v_trade.id, v_from.id, d, p_at FROM unnest(COALESCE(p_drops, ARRAY[]::text[])) AS d;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> COALESCE(cardinality(p_drops), 0) THEN
    RAISE EXCEPTION '%: wrote % trade drops, expected %', p_verb, v_cnt, COALESCE(cardinality(p_drops), 0) USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('trade_id', v_trade.id, 'check', v_check);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_propose_core_internal(TEXT, public.leagues, UUID, UUID, JSONB, TEXT[], TEXT, UUID, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. trade_propose_internal + trade_propose
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_propose_internal(
  p_league_id    UUID,
  p_from_team_id UUID,
  p_to_team_id   UUID,
  p_items        JSONB,
  p_drops        TEXT[],
  p_note         TEXT,
  p_action_id    UUID,
  p_at           TIMESTAMPTZ,
  p_reason       TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league     public.leagues;
  v_found      BOOLEAN;
  v_is_manager BOOLEAN;
  v_is_commish BOOLEAN;
  v_ledger     public.trade_actions;
  v_reason     TEXT;
  v_core       JSONB;
  v_trade_id   UUID;
  v_trade      public.trades;
  v_from       public.teams;
  v_to         public.teams;
  v_summary    TEXT;
  v_notified   UUID;
  v_receipt    JSONB := NULL;
  v_result     JSONB;
BEGIN
  -- (0) SHAPE.
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'trade_propose: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_from_team_id IS NULL THEN
    RAISE EXCEPTION 'trade_propose: p_from_team_id is required — the team making the offer'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — the proposing team's manager, or a commissioner acting for
  --     ANY team (TD5). One no-leak 42501.
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_from_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'trade_propose: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY — after auth, before every business gate (R732 scoping).
  SELECT a.* INTO v_ledger
  FROM public.trade_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.verb <> 'trade_propose' OR v_ledger.team_id IS DISTINCT FROM p_from_team_id THEN
      RAISE EXCEPTION
        'trade_propose: action_id % already names a % for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_ledger.verb
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  -- (4) THE REASON, OPTIONAL (Q66 / 131). Stored only on the commissioner arm.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'trade_propose: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) LEAGUE STATE, under the lock.
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'trade_propose: league % is % — trades are made only while the league is in season or in the playoffs (§7.1 / §13.3)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- (6) VALIDATE + WRITE.
  v_core := public.trade_propose_core_internal(
    'trade_propose', v_league, p_from_team_id, p_to_team_id, p_items, p_drops, p_note, p_action_id, p_at, NULL);
  v_trade_id := (v_core ->> 'trade_id')::uuid;
  SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = v_trade_id;
  SELECT t.* INTO v_from FROM public.teams t WHERE t.id = v_trade.proposer_team_id;
  SELECT t.* INTO v_to FROM public.teams t WHERE t.id = v_trade.recipient_team_id;
  v_summary := public.trade_summary_internal(v_trade_id);

  -- (7) THE COMMISSIONER ARM (TD5): ONE audit row acting as the proposer.
  IF NOT v_is_manager THEN
    v_receipt := public.trade_receipt_internal(
      p_league_id, v_from, 'propose_trade', 'proposed a trade for', v_trade_id,
      NULL, jsonb_build_object('status', 'proposed'), v_reason, p_action_id, 'trade_propose', v_league.season);
  END IF;

  -- (8) THE RECEIVING TEAM IS TOLD (TD16).
  v_notified := public.trade_notify_team_internal(
    p_league_id, v_to.id, 'league_trade_proposed',
    v_from.name || ' sent you a trade offer',
    v_summary || CASE WHEN v_trade.note IS NOT NULL THEN ' — "' || v_trade.note || '"' ELSE '' END,
    jsonb_build_object('trade_id', v_trade_id, 'proposer_team_id', v_from.id, 'recipient_team_id', v_to.id),
    TRUE);

  v_result := jsonb_build_object(
    'verb',                   'trade_propose',
    'league_id',              p_league_id,
    'team_id',                p_from_team_id,
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'trade',                  public.trade_view_internal(v_trade_id),
    'summary',                v_summary,
    'rosters',                v_core -> 'check',
    'settled_by',             'the receiving team accepts (naming any drops its roster needs — E36), rejects or counters (§13.3); an accepted trade then waits for review and execution (L.D3.3). Nothing moves until it executes.',
    'notified_user_ids',      CASE WHEN v_notified IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_notified) END,
    'acted_as_commissioner',  NOT v_is_manager,
    'commissioner_action_id', v_receipt ->> 'commissioner_action_id',
    'system_post',            v_receipt ->> 'system_post',
    'reason',                 CASE WHEN NOT v_is_manager THEN v_reason END,
    'evaluated_at',           p_at);

  INSERT INTO public.trade_actions (league_id, team_id, verb, action_id, actor_id, result)
  VALUES (p_league_id, p_from_team_id, 'trade_propose', p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_propose_internal(UUID, UUID, UUID, JSONB, TEXT[], TEXT, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trade_propose(
  p_league_id    UUID,
  p_from_team_id UUID,
  p_to_team_id   UUID,
  p_items        JSONB,
  p_drops        TEXT[] DEFAULT NULL,   -- the proposer's drops (E36)
  p_note         TEXT DEFAULT NULL,
  p_action_id    UUID DEFAULT NULL,     -- REQUIRED in-body (22023)
  p_reason       TEXT DEFAULT NULL      -- OPTIONAL (Q66); stored only on the commissioner arm
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.trade_propose_internal(
    p_league_id, p_from_team_id, p_to_team_id, p_items, p_drops, p_note, p_action_id, now(), p_reason);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_propose(UUID, UUID, UUID, JSONB, TEXT[], TEXT, UUID, TEXT) FROM PUBLIC, anon;
COMMENT ON FUNCTION trade_propose(UUID, UUID, UUID, JSONB, TEXT[], TEXT, UUID, TEXT) IS
  '§13.3 (migration 148, L.D3.2): propose a trade. p_items = [{"player_id": …, "from_team_id": …} | {"faab_amount": n, "from_team_id": …}]. The proposing team''s manager, or a commissioner acting for any team (one commissioner_actions row). Refuses by name: not in season / playoffs, a retired or foreign team, a player not on the team that gives him (exclusivity), the proposer''s roster over roster_size after the trade without enough drops (E36), FAAB legs when not allowed / above the balance, a one-sided trade without allow_future_considerations. Moves nothing; replay by action_id is byte-identical.';

-- ---------------------------------------------------------------------------
-- 10. trade_respond_internal + trade_respond — accept / reject / cancel /
--     counter. The OP decides whose move it is: accept, reject and counter
--     are the RECEIVING team's; cancel is the PROPOSING team's. A
--     commissioner may make either side's move (TD5).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_respond_internal(
  p_league_id UUID,
  p_trade_id  UUID,
  p_op        TEXT,
  p_drops     TEXT[],
  p_items     JSONB,
  p_note      TEXT,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_verb        CONSTANT TEXT := 'trade_respond';
  v_league      public.leagues;
  v_found       BOOLEAN;
  v_trade       public.trades;
  v_trade_found BOOLEAN;
  v_side_id     UUID;       -- the team whose move this op is
  v_other_id    UUID;
  v_is_manager  BOOLEAN;
  v_is_other    BOOLEAN;
  v_is_commish  BOOLEAN;
  v_ledger      public.trade_actions;
  v_reason      TEXT;
  v_side        public.teams;
  v_proposer    public.teams;
  v_recipient   public.teams;
  v_items       JSONB;
  v_pdrops      TEXT[];
  v_check       JSONB := NULL;
  v_core        JSONB := NULL;
  v_new_id      UUID := NULL;
  v_cnt         INTEGER;
  v_summary     TEXT;
  v_status      TEXT;
  v_notified    JSONB := '[]'::jsonb;
  v_n           UUID;
  v_receipt     JSONB := NULL;
  v_result      JSONB;
BEGIN
  -- (0) SHAPE.
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'trade_respond: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_trade_id IS NULL THEN
    RAISE EXCEPTION 'trade_respond: p_trade_id is required — name the trade to answer'
      USING ERRCODE = '22023';
  END IF;
  IF p_op IS NULL OR p_op NOT IN ('accept', 'reject', 'cancel', 'counter') THEN
    RAISE EXCEPTION 'trade_respond: op % is not one of accept / reject / cancel / counter (§13.3)', COALESCE(p_op, 'NULL')
      USING ERRCODE = '22023';
  END IF;
  IF p_drops IS NOT NULL AND p_op NOT IN ('accept', 'counter') THEN
    RAISE EXCEPTION 'trade_respond: drops are named when accepting or countering, not when you % (E36)', p_op
      USING ERRCODE = '22023';
  END IF;
  IF p_op <> 'counter' AND (p_items IS NOT NULL OR p_note IS NOT NULL) THEN
    RAISE EXCEPTION 'trade_respond: players, FAAB and a note belong to a counter-offer — op % takes none', p_op
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) THE TRADE, under the league lock; AUTH on the side whose move it is.
  IF v_found THEN
    SELECT t.* INTO v_trade FROM public.trades t
    WHERE t.id = p_trade_id AND t.league_id = p_league_id
    FOR UPDATE;
    v_trade_found := FOUND;
  ELSE
    v_trade_found := FALSE;
  END IF;
  IF v_trade_found THEN
    v_side_id  := CASE WHEN p_op = 'cancel' THEN v_trade.proposer_team_id ELSE v_trade.recipient_team_id END;
    v_other_id := CASE WHEN p_op = 'cancel' THEN v_trade.recipient_team_id ELSE v_trade.proposer_team_id END;
  END IF;
  v_is_manager := v_trade_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = v_side_id);
  v_is_other := v_trade_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = v_other_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish OR v_is_other) THEN
    RAISE EXCEPTION 'trade_respond: not a party to this trade'
      USING ERRCODE = '42501';
  END IF;
  IF NOT v_trade_found THEN
    RAISE EXCEPTION 'trade_respond: no trade % in league %', p_trade_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  -- The OTHER party (not a commissioner) asked for this side's move — it is
  -- his trade too, so he is told by name which move is his.
  IF NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION '%',
      CASE WHEN p_op = 'cancel'
           THEN 'trade_respond: only the team that proposed a trade can cancel it — you received this offer, so reject it instead (§13.3)'
           ELSE 'trade_respond: only the team that received a trade can ' || p_op || ' it — you proposed this one, so cancel it instead (§13.3)' END
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) REPLAY — verb, team, trade and op scoped (R732).
  SELECT a.* INTO v_ledger
  FROM public.trade_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.verb <> v_verb OR v_ledger.team_id IS DISTINCT FROM v_side_id
       OR (v_ledger.result ->> 'trade_id') IS DISTINCT FROM p_trade_id::text
       OR (v_ledger.result ->> 'op') IS DISTINCT FROM p_op THEN
      RAISE EXCEPTION
        'trade_respond: action_id % already names a % for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_ledger.verb
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  -- (4) THE REASON, OPTIONAL.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'trade_respond: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  SELECT t.* INTO v_side FROM public.teams t WHERE t.id = v_side_id;
  SELECT t.* INTO v_proposer FROM public.teams t WHERE t.id = v_trade.proposer_team_id;
  SELECT t.* INTO v_recipient FROM public.teams t WHERE t.id = v_trade.recipient_team_id;

  -- (5) STATE — every op answers a trade still in `proposed`. Anything else
  --     is refused by name, with the reason it left (loud: a second accept
  --     never passes silently as a no-op — its drops would be ignored).
  IF v_trade.status <> 'proposed' THEN
    RAISE EXCEPTION 'trade_respond: this trade is already % (%) — only a proposed trade can be %',
      v_trade.status, COALESCE(v_trade.status_reason, 'no reason recorded'),
      CASE p_op WHEN 'accept' THEN 'accepted' WHEN 'reject' THEN 'rejected' WHEN 'cancel' THEN 'cancelled' ELSE 'countered' END
      USING ERRCODE = 'P0001';
  END IF;
  IF p_op IN ('accept', 'counter') AND v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'trade_respond: league % is % — a trade is accepted or countered only while the league is in season or in the playoffs (§7.1 / §13.3)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- (6) THE OP.
  IF p_op = 'accept' THEN
    IF v_proposer.status = 'retired' OR v_recipient.status = 'retired' THEN
      RAISE EXCEPTION 'trade_respond: % is retired — a sealed franchise makes no trades (§7.2.1)',
        CASE WHEN v_proposer.status = 'retired' THEN v_proposer.name ELSE v_recipient.name END
        USING ERRCODE = 'P0001';
    END IF;
    -- RE-VALIDATE EVERYTHING under the lock, the receiving team's drops
    -- now ENFORCED (E36).
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'player_id', i.player_id, 'faab_amount', i.faab_amount,
             'from_team_id', i.from_team_id, 'to_team_id', i.to_team_id) ORDER BY i.id), '[]'::jsonb)
    INTO v_items
    FROM public.trade_items i WHERE i.trade_id = p_trade_id;
    SELECT COALESCE(array_agg(d.player_id ORDER BY d.player_id), ARRAY[]::text[]) INTO v_pdrops
    FROM public.trade_drops d WHERE d.trade_id = p_trade_id AND d.team_id = v_trade.proposer_team_id;
    v_check := public.trade_check_internal(v_verb, v_league, v_proposer, v_recipient, v_items,
                                           v_pdrops, COALESCE(p_drops, ARRAY[]::text[]));

    INSERT INTO public.trade_drops (trade_id, team_id, player_id, created_at)
    SELECT p_trade_id, v_recipient.id, d, p_at FROM unnest(COALESCE(p_drops, ARRAY[]::text[])) AS d;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> COALESCE(cardinality(p_drops), 0) THEN
      RAISE EXCEPTION 'trade_respond: wrote % trade drops, expected %', v_cnt, COALESCE(cardinality(p_drops), 0) USING ERRCODE = 'P0001';
    END IF;

    v_status := 'accepted';
    UPDATE public.trades t
    SET status = 'accepted', accepted_at = p_at, accepted_by = auth.uid()
    WHERE t.id = p_trade_id AND t.status = 'proposed';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  ELSIF p_op = 'reject' THEN
    v_status := 'rejected';
    UPDATE public.trades t
    SET status = 'rejected', status_reason = 'rejected by ' || v_recipient.name, resolved_at = p_at, resolved_by = auth.uid()
    WHERE t.id = p_trade_id AND t.status = 'proposed';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  ELSIF p_op = 'cancel' THEN
    v_status := 'cancelled';
    UPDATE public.trades t
    SET status = 'cancelled', status_reason = 'cancelled by ' || v_proposer.name, resolved_at = p_at, resolved_by = auth.uid()
    WHERE t.id = p_trade_id AND t.status = 'proposed';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  ELSE
    -- COUNTER = reject + a new proposal the other way, linked (task text).
    v_status := 'rejected';
    UPDATE public.trades t
    SET status = 'rejected', status_reason = 'countered by ' || v_recipient.name, resolved_at = p_at, resolved_by = auth.uid()
    WHERE t.id = p_trade_id AND t.status = 'proposed';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  END IF;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'trade_respond: the % touched % trade rows, expected exactly 1 (trade %)', p_op, v_cnt, p_trade_id
      USING ERRCODE = 'P0001';
  END IF;

  IF p_op = 'counter' THEN
    v_core := public.trade_propose_core_internal(
      v_verb, v_league, v_recipient.id, v_proposer.id, p_items, p_drops, p_note, p_action_id, p_at, p_trade_id);
    v_new_id := (v_core ->> 'trade_id')::uuid;
    v_check := v_core -> 'check';
  END IF;

  v_summary := public.trade_summary_internal(COALESCE(v_new_id, p_trade_id));

  -- (7) THE COMMISSIONER ARM: ONE audit row acting as the side he moved for.
  IF NOT v_is_manager THEN
    v_receipt := public.trade_receipt_internal(
      p_league_id, v_side, p_op || '_trade',
      CASE p_op WHEN 'accept' THEN 'accepted a trade for' WHEN 'reject' THEN 'rejected a trade for'
                WHEN 'cancel' THEN 'cancelled a trade for' ELSE 'countered a trade for' END,
      COALESCE(v_new_id, p_trade_id),
      jsonb_build_object('status', 'proposed')
        || CASE WHEN v_new_id IS NOT NULL THEN jsonb_build_object('trade_id', p_trade_id) ELSE '{}'::jsonb END,
      jsonb_build_object('status', CASE WHEN v_new_id IS NOT NULL THEN 'proposed' ELSE v_status END)
        || CASE WHEN v_new_id IS NOT NULL THEN jsonb_build_object('trade_id', v_new_id, 'countered_from', p_trade_id) ELSE '{}'::jsonb END,
      v_reason, p_action_id, v_verb, v_league.season);
  END IF;

  -- (8) THE OTHER PARTY IS TOLD (TD16).
  v_n := public.trade_notify_team_internal(
    p_league_id, v_other_id,
    'league_trade_' || CASE p_op WHEN 'accept' THEN 'accepted' WHEN 'reject' THEN 'rejected'
                                 WHEN 'cancel' THEN 'cancelled' ELSE 'countered' END,
    v_side.name || ' ' || CASE p_op WHEN 'accept' THEN 'accepted your trade'
                                    WHEN 'reject' THEN 'rejected your trade'
                                    WHEN 'cancel' THEN 'cancelled its trade offer'
                                    ELSE 'countered your trade offer' END,
    v_summary,
    jsonb_build_object('trade_id', COALESCE(v_new_id, p_trade_id), 'answered_trade_id', p_trade_id, 'op', p_op),
    TRUE);
  IF v_n IS NOT NULL THEN
    v_notified := v_notified || jsonb_build_array(v_n);
  END IF;

  v_result := jsonb_build_object(
    'verb',                   v_verb,
    'op',                     p_op,
    'league_id',              p_league_id,
    'team_id',                v_side_id,
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'trade_id',               p_trade_id,
    'trade',                  public.trade_view_internal(p_trade_id),
    'counter_trade',          CASE WHEN v_new_id IS NOT NULL THEN public.trade_view_internal(v_new_id) END,
    'summary',                v_summary,
    'rosters',                v_check,
    'settled_by',             CASE p_op
                                WHEN 'accept'  THEN 'the trade now waits for review and execution (L.D3.3) — nothing moves until it executes, and it goes invalid if a player in it leaves his roster first (E37)'
                                WHEN 'counter' THEN 'the original offer is rejected; the counter-offer is a new proposal the other team answers (§13.3)'
                                ELSE 'closed — nothing moved' END,
    'notified_user_ids',      v_notified,
    'acted_as_commissioner',  NOT v_is_manager,
    'commissioner_action_id', v_receipt ->> 'commissioner_action_id',
    'system_post',            v_receipt ->> 'system_post',
    'reason',                 CASE WHEN NOT v_is_manager THEN v_reason END,
    'evaluated_at',           p_at);

  INSERT INTO public.trade_actions (league_id, team_id, verb, action_id, actor_id, result)
  VALUES (p_league_id, v_side_id, v_verb, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_respond_internal(UUID, UUID, TEXT, TEXT[], JSONB, TEXT, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trade_respond(
  p_league_id UUID,
  p_trade_id  UUID,
  p_op        TEXT,
  p_drops     TEXT[] DEFAULT NULL,   -- accept / counter: this team's drops (E36)
  p_items     JSONB DEFAULT NULL,    -- counter only: the counter-offer's legs
  p_note      TEXT DEFAULT NULL,     -- counter only
  p_action_id UUID DEFAULT NULL,     -- REQUIRED in-body (22023)
  p_reason    TEXT DEFAULT NULL      -- OPTIONAL (Q66); stored only on the commissioner arm
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.trade_respond_internal(
    p_league_id, p_trade_id, p_op, p_drops, p_items, p_note, p_action_id, now(), p_reason);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_respond(UUID, UUID, TEXT, TEXT[], JSONB, TEXT, UUID, TEXT) FROM PUBLIC, anon;
COMMENT ON FUNCTION trade_respond(UUID, UUID, TEXT, TEXT[], JSONB, TEXT, UUID, TEXT) IS
  '§13.3 (migration 148, L.D3.2): answer a proposed trade — accept (the receiving team, naming the drops its roster needs, E36; everything re-validated under the lock), reject (the receiving team), cancel (the proposing team), counter (the receiving team: the offer is rejected and a new proposal the other way is created, linked by countered_from). A commissioner may make either side''s move (one commissioner_actions row). Only a proposed trade can be answered; an accepted trade waits for review / execution (L.D3.3). Replay by action_id is byte-identical.';

-- ---------------------------------------------------------------------------
-- 11. THE E37 TRIGGER (TD12) — a pending trade goes invalid the moment one
--     of its players leaves the roster the trade takes him from.
--     SECURITY DEFINER: it must run whoever the roster writer is (a DEFINER
--     verb, the service role, a migration) and its writes (trades,
--     notifications) are its own business, not the writer's grants.
--     Time: `now()` — a trigger receives no p_at; it is the TRANSACTION
--     instant, which is exactly the instant the DEFINER door's `now()`
--     passed to the verb that moved the player.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_invalidate_on_roster_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exempt   UUID;
  v_player   TEXT;
  v_from     TEXT;
  v_to       TEXT;
  v_sentence TEXT;
  v_trade    public.trades;
BEGIN
  -- Only a real move out of the team counts (an UPDATE that leaves team_id
  -- alone never reaches here — the trigger's WHEN clause — but say it again
  -- so the function survives a trigger recreated without it).
  IF TG_OP = 'UPDATE' AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id THEN
    RETURN NULL;
  END IF;

  -- The trade the executor is running (L.D3.3 sets this transaction-locally
  -- before it moves the players — PROGRESS F413) is not invalidated by its
  -- own execution.
  BEGIN
    v_exempt := NULLIF(current_setting('app.executing_trade_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_exempt := NULL;
  END;

  SELECT p.full_name INTO v_player FROM public.players p WHERE p.id = OLD.player_id;
  SELECT t.name INTO v_from FROM public.teams t WHERE t.id = OLD.team_id;
  IF TG_OP = 'UPDATE' THEN
    SELECT t.name INTO v_to FROM public.teams t WHERE t.id = NEW.team_id;
  END IF;
  v_sentence := COALESCE(v_player, OLD.player_id) || ' (' || OLD.player_id || ') is no longer on '
    || COALESCE(v_from, 'his team') || '''s roster — '
    || CASE WHEN TG_OP = 'DELETE' THEN 'he was dropped'
            ELSE 'he moved to ' || COALESCE(v_to, 'another team') END
    || ' (E37)';

  FOR v_trade IN
    UPDATE public.trades t
    SET status = 'invalid', status_reason = v_sentence, resolved_at = now(), resolved_by = NULL
    WHERE t.league_id = OLD.league_id
      AND t.status IN ('proposed', 'accepted', 'in_review')
      AND t.id IS DISTINCT FROM v_exempt
      AND (EXISTS (SELECT 1 FROM public.trade_items i
                   WHERE i.trade_id = t.id AND i.player_id = OLD.player_id AND i.from_team_id = OLD.team_id)
        OR EXISTS (SELECT 1 FROM public.trade_drops d
                   WHERE d.trade_id = t.id AND d.player_id = OLD.player_id AND d.team_id = OLD.team_id))
    RETURNING t.*
  LOOP
    -- BOTH parties are told (E37 — "never fails silently"), the actor
    -- included: the manager who dropped the player may not know it killed
    -- his trade.
    PERFORM public.trade_notify_team_internal(
      v_trade.league_id, v_trade.proposer_team_id, 'league_trade_invalid',
      'A trade can no longer go through', v_sentence,
      jsonb_build_object('trade_id', v_trade.id, 'player_id', OLD.player_id), FALSE);
    PERFORM public.trade_notify_team_internal(
      v_trade.league_id, v_trade.recipient_team_id, 'league_trade_invalid',
      'A trade can no longer go through', v_sentence,
      jsonb_build_object('trade_id', v_trade.id, 'player_id', OLD.player_id), FALSE);
  END LOOP;

  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_invalidate_on_roster_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_trade_invalidate_on_roster_delete
  AFTER DELETE ON league_rosters
  FOR EACH ROW EXECUTE FUNCTION trade_invalidate_on_roster_change();
CREATE TRIGGER trg_trade_invalidate_on_roster_move
  AFTER UPDATE OF team_id ON league_rosters
  FOR EACH ROW
  WHEN (NEW.team_id IS DISTINCT FROM OLD.team_id)
  EXECUTE FUNCTION trade_invalidate_on_roster_change();
-- R616: a replica-mode session (db push, pg_restore, logical apply) skips an
-- ORIGIN-enabled trigger; the E37 invariant — no in-flight trade names a
-- player who left the team it takes him from — must hold on every path.
ALTER TABLE league_rosters ENABLE ALWAYS TRIGGER trg_trade_invalidate_on_roster_delete;
ALTER TABLE league_rosters ENABLE ALWAYS TRIGGER trg_trade_invalidate_on_roster_move;

-- ---------------------------------------------------------------------------
-- 12. Broadcast (§9.2 / §12.14) — trades on league:<id>, column-selected.
--     NOT: action_id (another client's idempotency key), proposed_by /
--     accepted_by / resolved_by (who pressed the button is the audit log's),
--     note (refetched with the legs).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_broadcast_payload(t trades)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id',                t.id,
    'status',            t.status,
    'status_reason',     t.status_reason,
    'proposer_team_id',  t.proposer_team_id,
    'recipient_team_id', t.recipient_team_id,
    'countered_from',    t.countered_from,
    'created_at',        t.created_at,
    'accepted_at',       t.accepted_at,
    'resolved_at',       t.resolved_at);
$$;
REVOKE EXECUTE ON FUNCTION trade_broadcast_payload(trades) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION broadcast_trade_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'operation', TG_OP,
      'table',     TG_TABLE_NAME,
      'schema',    TG_TABLE_SCHEMA,
      'record',    public.trade_broadcast_payload(NEW)),
    'trades',
    'league:' || NEW.league_id::text,
    true);
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION broadcast_trade_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_broadcast_trades_insert
  AFTER INSERT ON trades
  FOR EACH ROW EXECUTE FUNCTION broadcast_trade_change();
CREATE TRIGGER tr_broadcast_trades_status
  AFTER UPDATE OF status ON trades
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION broadcast_trade_change();
