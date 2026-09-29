-- ============================================================================
-- 162_trade_preview.sql — THE TRADE SCREEN NEVER LETS A MANAGER BUILD AN OFFER
-- THE LEAGUE WOULD REFUSE (M5 task L.D3.12 — ONE PASS for the UI, FULL care
-- for the two new read doors: permissions-adjacent). PROGRESS D426; closes
-- F452 and F462.
--
-- THE RULING (Chris, 2026-09-29, in chat, verbatim): "you can't propose
-- trades past the trade deadline. if you make a trade for 2 players, where
-- you give up one, and your roster is full then you have to select a player
-- to drop in the case that the trade is accepted or if you're accepting you
-- pick the player to drop. as far as i'm concerned there is no such thing as
-- trade that isn't legal so..." — the trade screen PREVENTS an illegal offer
-- (it cannot be built); the verbs' refusals stay as the backstop.
--
-- Spec §13.3 ("Validates both rosters would remain legal post-trade";
-- Deadline — Q76), §16.2 (`trade-builder` "two-sided selector w/ legality
-- preview"), §12.11 (trades are not blind — every member reads every trade),
-- §7.3.2 roster_size, §7.3.5 (allow_faab_in_trades,
-- allow_future_considerations, trade_deadline_week), E36.
--
-- Numbering: RESERVED by the orchestrator (162 / pgTAP 110) and measured at
-- build time: `ls supabase/migrations | tail -1` → 161_rescore_final_weeks.sql
-- on main @ 844685b. NOT held: reaches production by `npx supabase db push`
-- only.
--
-- ONE SOURCE OF TRUTH. The app never re-implements a trade rule. Both new
-- doors are READS over the two internals the verbs themselves call:
--   * the deadline instant is `trade_deadline_internal` (151 — week N+1's
--     `nfl_weeks.starts_at`, Q76), and "passed" is the verbs' own comparison
--     (`deadline_at <= p_at` — 151's trade_propose / trade_respond refuse on
--     exactly that);
--   * the offer's legality is `trade_check_internal` (148 / 151 — THE
--     validator: exclusivity, both sides give, FAAB legs, each side's drops,
--     the E36 roster fit), called with the verb `trade_preview`.
--
-- WHAT THIS MIGRATION DOES
--   1. `trade_check_internal` REPLACED against 151's FILE TEXT (D137 — 151 is
--      the newest definer: `grep -n "FUNCTION trade_check_internal"
--      supabase/migrations/*.sql | tail -1` → 151:214). ONE substitution:
--      under the verb `trade_preview` an E36 overflow is REPORTED (the side's
--      `must_drop` in the facts it already returns) instead of RAISED, so the
--      preview can say "pick N players to drop" for BOTH sides at once. Every
--      existing caller passes another verb literal ('trade_propose',
--      'trade_respond', 'trade_execute'), so for them the function behaves
--      exactly as 151's (pgTAP 110 §A: the prosrc with the one substitution
--      taken back out has 151's md5; 096 / 099 / 103 / 104 stay green).
--      `IS DISTINCT FROM`, so a NULL verb can never skip the refusal.
--   2. `trade_deadline_view_internal(league, p_at)` — PLAIN: 151's deadline
--      document plus `passed`, `ms_remaining` and `evaluated_at`.
--   3. `trade_deadline(league)` — SECURITY DEFINER door (F452): any MEMBER
--      of the league reads the deadline instant; a non-member (and a
--      soft-deleted league) is ONE no-leak 42501. Judged at the database's
--      now() — the SAME clock trade_propose / trade_respond refuse by (their
--      doors pass now(); R1236's lesson: one clock per decision).
--   4. `trade_preview(league, trade?, from?, to?, items?, drops?)` — SECURITY
--      DEFINER door (F462), STABLE, writes nothing. Two arms:
--        * OFFER (no trade id): the offering team, the team it trades with,
--          the legs (148's leg shape) and the offering team's drops — what
--          `trade_propose` / a counter-offer checks. The receiving team's
--          side is reported, not enforced (it names its drops at accept).
--        * ACCEPT (a trade id only): the offer's stored legs and the
--          proposer's stored drops, the receiving team's drops as given,
--          BOTH enforced — what `trade_respond('accept')` checks.
--      Answer: `ok`, the season state, the deadline document, the first
--      refusal the validator would raise (its own sentence, prefix
--      `trade_preview:`), and both sides' roster facts (count before / out
--      / in / drops / after / roster_size / must_drop). Any MEMBER may call
--      it — every roster, FAAB balance and trade it reads is already
--      member-visible (§12.11, D385(4)); non-members are ONE no-leak 42501.
--
-- NOT HERE: the game-day lock. A started player's 🔒 is the rosters read's
-- `game_lock` (the pool view the tick maintains), which the builder already
-- carries; no verb refuses a locked player at propose or accept (Q75 is
-- judged at EXECUTION — 151's trade_lock_internal).
--
-- D137 REPLACEMENT — against 151's FILE TEXT, derived by an exact-match
-- script (the substitution asserted to hit exactly once):
--   trade_check_internal   151:214-424   md5 7ba00e04   1 substitution (the
--                                        E36 raise skipped for 'trade_preview')
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   No new table (045's census unchanged). New functions: trade_deadline_
--   view_internal, trade_deadline_read_internal, trade_preview_internal
--   (PLAIN, triple-REVOKEd), trade_deadline and trade_preview (DEFINER doors,
--   REVOKEd from PUBLIC + anon — authenticated holds EXECUTE through the 037
--   default ACL; the in-body gate authorizes; search_path ''). One replaced
--   (trade_check_internal, REVOKE restated). RLS unchanged. Realtime: none
--   (reads). WAIVERS: R6 — no staging clone; the fresh local `db reset`
--   001–162 and the full pgTAP run are the rehearsal. D38 — no broadcast (a
--   read). Backfill: none. Typegen: additive (the two doors); the alias
--   block re-appended.
--
-- DEPLOY ORDER: the app deploys BEFORE `db push` (main → Vercel at once).
-- Until 162 is pushed the two doors are missing; the routes answer a named
-- 503 on PostgREST's PGRST202 for `trade_deadline` / `trade_preview` (or
-- 42883), and the trade screen falls back to today's behaviour (the week-
-- only deadline line; send the offer and render the refusal).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. D137 — trade_check_internal (151:214), the preview reports E36
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
      -- 151 (F414): the words name who can fix it. At execution nobody can
      -- name drops any more; at acceptance the PROPOSING team's overflow (it
      -- added players after proposing) is the proposer's to fix — the
      -- receiving manager cannot name drops for another team.
      IF p_verb = 'trade_execute' THEN
        RAISE EXCEPTION
          '%: %''s roster would hold % players after this trade — % more than its % spots (§7.3.2 roster_size): it has added players since the trade was agreed, so the trade cannot go through as agreed (E36)',
          p_verb, v_side.team_name, v_after, v_after - v_roster_size, v_roster_size
          USING ERRCODE = 'P0001';
      ELSIF v_side.role = 'proposer' AND p_recipient_drops IS NOT NULL THEN
        RAISE EXCEPTION
          '%: %''s roster no longer fits this offer — it would hold % players after the trade, % more than its % spots (§7.3.2 roster_size), because it has added players since proposing; only % can fix that, so ask them to cancel and re-propose with drops (E36)',
          p_verb, v_side.team_name, v_after, v_after - v_roster_size, v_roster_size, v_side.team_name
          USING ERRCODE = 'P0001';
      END IF;
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
-- 2. trade_deadline_view_internal — 151's deadline document, plus whether it
--    has passed at p_at (the verbs' own `deadline_at <= p_at`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_deadline_view_internal(p_league public.leagues, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_doc JSONB;
  v_at  TIMESTAMPTZ;
BEGIN
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'trade_deadline: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;
  v_doc := public.trade_deadline_internal(p_league);
  v_at := (v_doc ->> 'deadline_at')::timestamptz;
  RETURN v_doc || jsonb_build_object(
    'league_id',    p_league.id,
    -- 151's trade_propose / trade_respond: `IF deadline_at <= p_at THEN RAISE`.
    'passed',       COALESCE(v_at <= p_at, FALSE),
    'ms_remaining', CASE WHEN v_at > p_at THEN floor(extract(epoch FROM (v_at - p_at)) * 1000)::bigint END,
    'evaluated_at', p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_deadline_view_internal(public.leagues, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. trade_deadline_read_internal + trade_deadline — F452: a MEMBER reads the
--    deadline instant. One no-leak 42501 for no league / a deleted league /
--    not a member.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_deadline_read_internal(p_league_id UUID, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_league public.leagues;
BEGIN
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.league_members m WHERE m.league_id = p_league_id AND m.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'trade_deadline: not a member of this league' USING ERRCODE = '42501';
  END IF;
  RETURN public.trade_deadline_view_internal(v_league, p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_deadline_read_internal(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trade_deadline(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.trade_deadline_read_internal(p_league_id, now());
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_deadline(UUID) FROM PUBLIC, anon;
COMMENT ON FUNCTION trade_deadline(UUID) IS
  '§13.3 Deadline / Q76 (migration 162, L.D3.12; F452): for a league member, the trade deadline — its week (trade_deadline_week), its instant (week N+1''s nfl_weeks.starts_at; NULL when the league has none or it falls after the calendar''s last week), a label in the league''s zone, and whether it has passed at the database''s now() (the clock trade_propose / trade_respond refuse by). Non-members 42501. Reads only.';

-- ---------------------------------------------------------------------------
-- 4. trade_preview_internal + trade_preview — F462: what the verb would say,
--    before the manager sends it. Writes nothing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_preview_internal(
  p_league_id    UUID,
  p_trade_id     UUID,
  p_from_team_id UUID,
  p_to_team_id   UUID,
  p_items        JSONB,
  p_drops        TEXT[],
  p_at           TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_trade     public.trades;
  v_from      public.teams;
  v_to        public.teams;
  v_mode      TEXT;
  v_items     JSONB := '[]'::jsonb;
  v_pdrops    TEXT[];
  v_rdrops    TEXT[];
  v_elem      JSONB;
  v_bad       TEXT;
  v_leg_from  UUID;
  v_amount    NUMERIC;
  v_in_season BOOLEAN;
  v_deadline  JSONB;
  v_refusal   TEXT := NULL;
  v_facts     JSONB := NULL;
  v_ok        BOOLEAN;
BEGIN
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'trade_preview: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  -- (1) MEMBERSHIP — any member (every roster, balance and trade this reads
  --     is member-visible, §12.11). ONE no-leak 42501: no league, a deleted
  --     league, not a member.
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.league_members m WHERE m.league_id = p_league_id AND m.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'trade_preview: not a member of this league' USING ERRCODE = '42501';
  END IF;

  -- (2) THE OFFER.
  IF p_trade_id IS NOT NULL THEN
    -- ACCEPT — 151's accept arm in shape: the stored legs (id order), the
    -- proposer's stored drops, the receiving team's drops as given; both
    -- sides ENFORCED.
    IF p_from_team_id IS NOT NULL OR p_to_team_id IS NOT NULL OR p_items IS NOT NULL THEN
      RAISE EXCEPTION 'trade_preview: an accept preview names the trade only — its teams and legs are the offer''s'
        USING ERRCODE = '22023';
    END IF;
    v_mode := 'accept';
    SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = p_trade_id AND t.league_id = p_league_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'trade_preview: no trade % in league %', p_trade_id, p_league_id USING ERRCODE = 'P0001';
    END IF;
    SELECT t.* INTO v_from FROM public.teams t WHERE t.id = v_trade.proposer_team_id;
    SELECT t.* INTO v_to FROM public.teams t WHERE t.id = v_trade.recipient_team_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'player_id', i.player_id, 'faab_amount', i.faab_amount,
             'from_team_id', i.from_team_id, 'to_team_id', i.to_team_id) ORDER BY i.id), '[]'::jsonb)
    INTO v_items
    FROM public.trade_items i WHERE i.trade_id = p_trade_id;
    SELECT COALESCE(array_agg(d.player_id ORDER BY d.player_id), ARRAY[]::text[]) INTO v_pdrops
    FROM public.trade_drops d WHERE d.trade_id = p_trade_id AND d.team_id = v_trade.proposer_team_id;
    v_rdrops := COALESCE(p_drops, ARRAY[]::text[]);
    IF v_trade.status <> 'proposed' THEN
      v_refusal := format('trade_preview: this trade is already %s — only an offer still waiting for an answer can be accepted', v_trade.status);
    END IF;
  ELSE
    -- OFFER — what trade_propose (or a counter-offer) checks: the offering
    -- team's drops ENFORCED; the receiving team's side REPORTED (it names
    -- its drops when it accepts — E36).
    v_mode := 'offer';
    IF p_from_team_id IS NULL OR p_to_team_id IS NULL THEN
      RAISE EXCEPTION 'trade_preview: an offer preview names both teams — the offering team and the team it trades with'
        USING ERRCODE = '22023';
    END IF;
    SELECT t.* INTO v_from FROM public.teams t WHERE t.id = p_from_team_id;
    IF NOT FOUND OR v_from.league_id IS DISTINCT FROM p_league_id THEN
      RAISE EXCEPTION 'trade_preview: team % is not a franchise of league %', p_from_team_id, p_league_id USING ERRCODE = 'P0001';
    END IF;
    SELECT t.* INTO v_to FROM public.teams t WHERE t.id = p_to_team_id;
    IF NOT FOUND OR v_to.league_id IS DISTINCT FROM p_league_id THEN
      RAISE EXCEPTION 'trade_preview: team % is not a franchise of league %', p_to_team_id, p_league_id USING ERRCODE = 'P0001';
    END IF;
    IF v_from.id = v_to.id THEN
      RAISE EXCEPTION 'trade_preview: % cannot trade with itself — a trade is between two different teams', v_from.name
        USING ERRCODE = 'P0001';
    END IF;
    -- The legs, in 148's shape (trade_propose_core_internal's normalization:
    -- a malformed leg is a 22023, never a business refusal).
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'trade_preview: p_items is required — a JSON array of legs, each {"player_id": …} or {"faab_amount": …} with its "from_team_id"'
        USING ERRCODE = '22023';
    END IF;
    FOR v_elem IN SELECT e FROM jsonb_array_elements(p_items) AS x(e) LOOP
      IF jsonb_typeof(v_elem) <> 'object'
         OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_elem) AS k WHERE k NOT IN ('player_id', 'faab_amount', 'from_team_id'))
         OR jsonb_typeof(v_elem -> 'from_team_id') IS DISTINCT FROM 'string'
         OR (COALESCE(jsonb_typeof(v_elem -> 'player_id'), 'null') <> 'null') = (COALESCE(jsonb_typeof(v_elem -> 'faab_amount'), 'null') <> 'null') THEN
        RAISE EXCEPTION 'trade_preview: trade leg % must be {"player_id": …} or {"faab_amount": …} with its "from_team_id"', v_elem
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_leg_from := (v_elem ->> 'from_team_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'trade_preview: from_team_id % is not a team id', v_elem ->> 'from_team_id' USING ERRCODE = '22023';
      END;
      IF v_leg_from NOT IN (v_from.id, v_to.id) THEN
        RAISE EXCEPTION 'trade_preview: trade leg % comes from a team that is not in this trade (% or %)', v_elem, v_from.name, v_to.name
          USING ERRCODE = '22023';
      END IF;
      IF COALESCE(jsonb_typeof(v_elem -> 'player_id'), 'null') <> 'null' THEN
        IF jsonb_typeof(v_elem -> 'player_id') <> 'string' OR btrim(v_elem ->> 'player_id') = '' THEN
          RAISE EXCEPTION 'trade_preview: trade leg % has a player_id that is not a player id', v_elem USING ERRCODE = '22023';
        END IF;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'player_id', v_elem ->> 'player_id', 'faab_amount', NULL,
          'from_team_id', v_leg_from, 'to_team_id', CASE WHEN v_leg_from = v_from.id THEN v_to.id ELSE v_from.id END));
      ELSE
        IF jsonb_typeof(v_elem -> 'faab_amount') <> 'number' THEN
          RAISE EXCEPTION 'trade_preview: trade leg % has a faab_amount that is not a number', v_elem USING ERRCODE = '22023';
        END IF;
        v_amount := (v_elem ->> 'faab_amount')::numeric;
        IF v_amount <> trunc(v_amount) OR v_amount < 1 OR v_amount > 2147483647 THEN
          RAISE EXCEPTION 'trade_preview: a FAAB leg of % is not a whole number of dollars from $1 up', v_elem ->> 'faab_amount'
            USING ERRCODE = '22023';
        END IF;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'player_id', NULL, 'faab_amount', v_amount::int,
          'from_team_id', v_leg_from, 'to_team_id', CASE WHEN v_leg_from = v_from.id THEN v_to.id ELSE v_from.id END));
      END IF;
    END LOOP;
    SELECT string_agg(DISTINCT i.player_id, ', ') INTO v_bad
    FROM jsonb_to_recordset(v_items) AS i(player_id TEXT)
    WHERE i.player_id IS NOT NULL
      AND (SELECT count(*) FROM jsonb_to_recordset(v_items) AS j(player_id TEXT) WHERE j.player_id = i.player_id) > 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'trade_preview: the trade names % more than once — each player is one leg', v_bad USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_items) AS i(faab_amount INTEGER, from_team_id UUID)
               WHERE i.faab_amount IS NOT NULL GROUP BY i.from_team_id HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'trade_preview: a team gives FAAB in more than one leg — give one amount per team' USING ERRCODE = '22023';
    END IF;
    v_pdrops := COALESCE(p_drops, ARRAY[]::text[]);
    v_rdrops := NULL;
  END IF;

  -- (3) A RETIRED TEAM makes no trades (148's core / 151's accept arm).
  IF v_refusal IS NULL AND (v_from.status = 'retired' OR v_to.status = 'retired') THEN
    v_refusal := format('trade_preview: %s is retired — a sealed franchise makes no trades (§7.2.1)',
                        CASE WHEN v_from.status = 'retired' THEN v_from.name ELSE v_to.name END);
  END IF;

  -- (4) THE GATES THE VERBS REFUSE BY FIRST — the season, the deadline.
  v_in_season := v_league.status IN ('in_season', 'playoffs');
  v_deadline := public.trade_deadline_view_internal(v_league, p_at);

  -- (5) THE ONE VALIDATOR. Under 'trade_preview' an E36 overflow is the
  --     side's `must_drop` (the substitution in §1); every other refusal is
  --     the validator's own sentence.
  IF v_refusal IS NULL THEN
    BEGIN
      v_facts := public.trade_check_internal('trade_preview', v_league, v_from, v_to, v_items, v_pdrops, v_rdrops);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      v_refusal := SQLERRM;
    END;
  END IF;

  v_ok := v_in_season
          AND NOT (v_deadline ->> 'passed')::boolean
          AND v_refusal IS NULL
          AND v_facts IS NOT NULL
          AND (v_facts #>> '{proposer,must_drop}')::int = 0
          AND (v_mode = 'offer' OR (v_facts #>> '{recipient,must_drop}')::int = 0);

  RETURN jsonb_build_object(
    'mode',              v_mode,
    'league_id',         p_league_id,
    'trade_id',          p_trade_id,
    'proposer_team_id',  v_from.id,
    'recipient_team_id', v_to.id,
    'ok',                v_ok,
    'league_status',     v_league.status,
    'in_season',         v_in_season,
    'deadline',          v_deadline,
    'refusal',           v_refusal,
    'rosters',           CASE WHEN v_facts IS NULL THEN NULL
                              ELSE jsonb_build_object('proposer', v_facts -> 'proposer', 'recipient', v_facts -> 'recipient') END,
    'evaluated_at',      p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_preview_internal(UUID, UUID, UUID, UUID, JSONB, TEXT[], TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trade_preview(
  p_league_id    UUID,
  p_trade_id     UUID DEFAULT NULL,   -- ACCEPT: the offer being answered
  p_from_team_id UUID DEFAULT NULL,   -- OFFER: the offering team
  p_to_team_id   UUID DEFAULT NULL,   -- OFFER: the team it trades with
  p_items        JSONB DEFAULT NULL,  -- OFFER: 148's legs
  p_drops        TEXT[] DEFAULT NULL  -- OFFER: the offering team's drops; ACCEPT: the receiving team's
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.trade_preview_internal(p_league_id, p_trade_id, p_from_team_id, p_to_team_id, p_items, p_drops, now());
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_preview(UUID, UUID, UUID, UUID, JSONB, TEXT[]) FROM PUBLIC, anon;
COMMENT ON FUNCTION trade_preview(UUID, UUID, UUID, UUID, JSONB, TEXT[]) IS
  '§13.3 / §16.2 legality preview (migration 162, L.D3.12; F462): for a league member, what trade_propose (offer arm: from, to, items, the offering team''s drops) or trade_respond(''accept'') (accept arm: the trade id, the receiving team''s drops) would decide — through the verbs'' own validator, trade_check_internal — without writing anything: ok, the season state, the deadline, the first refusal (the validator''s sentence) and both rosters'' counts after the trade with the drops each still needs (must_drop, E36). Non-members 42501.';
