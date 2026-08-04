-- ============================================================================
-- Broadcast-from-DB + realtime channel auth — migration 070 (task L.B1.5;
-- spec §9 ALL — the v2.0 transport rule is the point — §9.1/§9.2/§9.3,
-- §12.13/§12.14 (D89 erratum below), §16.3; delivery plan §8.4; tasks-M2
-- §4.5 (the realtime doctrine, now LITERAL) + §5 channels/payloads, D89/
-- D92/D99/D102; PROGRESS F8/F42; D109). THE REPO'S FIRST REALTIME.
--
-- What ships here (the F8 discharge):
--   1. Column-select payload functions (one per broadcast table) — the
--      §9.2 "broadcast only the columns clients render / nothing blind"
--      rule made a TESTABLE UNIT (pgTAP 024 pins each function's exact
--      jsonb key set + named sensitive-column negatives).
--   2. Broadcast trigger functions + triggers per the §9.2 printed pattern
--      (SECURITY DEFINER, SET search_path = ''), on:
--        * drafts        AFTER UPDATE            → topic draft:<id>
--        * draft_picks   AFTER INSERT OR UPDATE  → topic draft:<draft_id>
--        * league_chat   AFTER INSERT            → topic from context
--          (a 'draft:<draft_id>' context IS the topic string — D99/§12.13
--          grammar; everything else goes to league:<league_id>)
--        * leagues       AFTER UPDATE OF status, name, avatar_url
--                                                → topic league:<id>
--          (column-triggered: those three are the ONLY broadcast columns —
--          §5's "status/name/avatar_url only", the home-hero/draft-bar
--          flip — so a settings PATCH that touches nothing rendered emits
--          nothing. UPDATE OF fires when a named column is in the SET
--          list; a same-value write of a named column still broadcasts —
--          harmless, clients treat events as cache hints, §9.)
--      NEVER broadcast (§9.2, pinned trigger-less in 024): draft_queues
--      (spec-named sensitive) and draft_liveness (D102/D107(3) — deny-all,
--      Presence owns who's-online).
--   3. realtime.messages policies (Realtime Authorization — private
--      channels only, §9.1):
--        * SELECT 'league:%'  — the §9.2 PRINTED policy verbatim
--          (is_league_member(split_part(topic, ':', 2)::uuid)).
--        * SELECT 'draft:%'   — the §9.2 "equivalent policy … via the
--          drafts.league_id lookup", shaped as the R117 exact-grammar
--          text compare ('draft:' || d.id = topic): no ::uuid cast on a
--          hostile topic, and a trailing-junk topic ('draft:<id>:junk')
--          matches NO draft — refused (pinned).
--        * INSERT 'league:%' / 'draft:%' — presence-only write auth
--          (extension = 'presence'): §9's mechanism table gives members
--          Presence on their topics (§9.1 draft channel; §16.2
--          presence-bar) and Realtime Authorization gates presence track
--          on INSERT policies over realtime.messages. extension =
--          'broadcast' is DELIBERATELY excluded: a member with client-
--          broadcast write could FORGE a 'drafts'/'draft_picks'-shaped
--          event to the whole room, spoofing the server (clients would
--          treat it as a cache hint — §9.3 refetch limits the damage, but
--          the channel shouldn't exist). §9's "Client Broadcast" row
--          (typing, bid-button pulses) has NO M2 consumer; M3's auction UX
--          extends the policy deliberately if it wants it (recorded, D109
--          — not a new F-row: M3's task list owns its own surface).
--      MALFORMED-TOPIC RESIDUAL (recorded): the league SELECT policy is
--      the spec-printed split_part + ::uuid form, so a subscription to a
--      malformed 'league:<not-a-uuid>' topic errors (22P02) instead of
--      cleanly matching zero rows — a refusal either way (pinned in 024).
--      The draft policy's text-compare shape avoids the cast; the league
--      policy keeps the LAW's printed SQL (asymmetry recorded, D109).
--   4. The tick heartbeat (§9.1's clock-drift beat) is AMENDED INTO 068's
--      draft_tick (ARM 3 — unreleased chain, F12 precedent; see 068).
--      Vehicle finalized per the task latitude: one realtime.send() PER
--      TICK PASS (~5s) per live draft — see 068's ARM 3 comment + D109
--      for the cadence rationale and the R135/R141 lock discipline (a
--      LOCK-FREE read: the beat claims nothing, locks nothing).
--
-- ---------------------------------------------------------------------------
-- D89 ERRATUM (spec §12.14 — folded into the spec as v2.8.15, the
-- fold-back rule; flagged for Chris in the breakdown PR per D89):
-- §12.14's printed `ALTER PUBLICATION supabase_realtime ADD TABLE …` with
-- its "so Postgres Changes broadcast" rationale is v1.x text that §9's
-- v2.0 transport rule explicitly supersedes ("clients never use Postgres
-- Changes"). realtime.broadcast_changes()/realtime.send() write to
-- realtime.messages and need NO publication membership; adding the tables
-- would only re-enable the anti-pattern delivery plan §8.4 bans ("no new
-- Postgres Changes subscriptions anywhere"). THE PUBLICATION ALTER IS NOT
-- EXECUTED — §12.14 is rewritten as the Broadcast-from-DB trigger
-- inventory (M2 slice: drafts / draft_picks / league_chat / leagues here;
-- league_rosters at creation, 072/L.B1.7(3b); the no-subscriber M1 tables
-- ride F42 to M4). pgTAP 024 pins the publication CARRIES NONE of the
-- broadcast tables — D89 made falsifiable.
-- ---------------------------------------------------------------------------
--
-- Engineering adaptation (the sanctioned environment latitude, recorded):
-- the local stack's realtime.broadcast_changes() (signature verified live,
-- 2026-08-04) broadcasts the WHOLE NEW/OLD rows — for these tables that is
-- exactly the blind payload §9.2 bans (leagues carries invite_code +
-- settings + scoring_rules_snapshot; drafts carries config). The triggers
-- therefore compose the SAME envelope broadcast_changes builds
-- ({operation, table, schema, record}) with a COLUMN-SELECTED record and
-- call realtime.send() directly (the §9.2-sanctioned synthetic-event
-- vehicle; broadcast_changes itself is a thin wrapper over it). The
-- observable contract — private-channel Broadcast-from-DB + policy auth —
-- is preserved; old_record is deliberately omitted (clients patch caches
-- from `record`, §9.3 — no consumer renders pre-images). Event name =
-- the table name ('drafts' | 'draft_picks' | 'league_chat' | 'leagues';
-- synthetic beats use 'tick'), operation inside the payload — one topic
-- multiplexes four sources (§5 inventory), so the event key is the
-- client's dispatch discriminator. realtime.send() traps its own errors
-- (RAISE WARNING — verified from the local definition), so a realtime
-- outage can never fail a pick/chat/settings transaction; it also injects
-- an 'id' key into the payload when absent (delivery bookkeeping — the
-- stored-payload pins in 024 account for it).
--
-- Lock/latency note (§4.6): the triggers are AFTER ROW inside the writing
-- transaction — each adds one jsonb build + one realtime.messages INSERT
-- (~sub-ms) under the already-held draft lock; the held-lock < 50ms
-- assertions in the wire suites (020/023 families) run with these triggers
-- LIVE from this migration on and stay green.
--
-- Grants doctrine (tasks-M1 §4.1, D18→D23): trigger functions fire as the
-- table owner and are never client-called — REVOKEd from PUBLIC/anon/
-- authenticated anyway (hygiene, the 062-internal form); the payload
-- functions are plain (non-SECURITY-DEFINER) internals under the same
-- REVOKE. No table grants change; realtime.messages keeps its platform
-- grants (anon/authenticated hold INSERT/SELECT there by platform default
-- — RLS with the policies below is the effective gate, the 037 doctrine).
--
-- Staging rehearsal: R6 waiver — no staging clone exists (local + prod
-- only); rehearsal evidence = the fresh local `npx supabase db reset`
-- replay of 001–070 + pgTAP 024 in the same PR (session log 2026-08-04).
-- Hosted note: realtime.messages + realtime.send/broadcast_changes exist
-- on every current hosted project (Realtime Authorization GA); policies on
-- realtime.messages are the documented customer surface for private
-- channels — this migration applies cleanly under the migration role.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column-select payload functions (§9.2 "nothing blind", unit-pinned)
--    STABLE, not IMMUTABLE: jsonb encoding of timestamptz reads the
--    TimeZone GUC. Plain internals (062 form): triple-REVOKEd, called only
--    by the SECURITY DEFINER trigger functions below (and pgTAP).
-- ---------------------------------------------------------------------------

-- drafts → the §5 inventory columns + deadline_remaining_ms (rendered by
-- the §16.5.2 pause overlay — "broadcast only the columns clients render"
-- INCLUDES it; recorded extension, D109). updated_at is the D92
-- state_version. NOT broadcast: config (§7.3.8 blob — blind), auction
-- fields (M3), is_mock/ids (the topic identifies the draft).
CREATE OR REPLACE FUNCTION draft_broadcast_payload(d drafts)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'status',                d.status,
    'current_pick_number',   d.current_pick_number,
    'current_round',         d.current_round,
    'on_clock_team_id',      d.on_clock_team_id,
    'current_deadline',      d.current_deadline,
    'paused_at',             d.paused_at,
    'deadline_remaining_ms', d.deadline_remaining_ms,
    'updated_at',            d.updated_at);
$$;

REVOKE EXECUTE ON FUNCTION draft_broadcast_payload(drafts)
  FROM PUBLIC, anon, authenticated;

-- draft_picks → exactly the §5 six. NOT broadcast: action_id (another
-- client's idempotency key is nobody's business), picked_by/made_via/price
-- (not in the inventory; the board renders is_auto), ids (topic +
-- pick_number identify the cell).
CREATE OR REPLACE FUNCTION draft_pick_broadcast_payload(p draft_picks)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'pick_number', p.pick_number,
    'round',       p.round,
    'team_id',     p.team_id,
    'player_id',   p.player_id,
    'is_auto',     p.is_auto,
    'is_undone',   p.is_undone);
$$;

REVOKE EXECUTE ON FUNCTION draft_pick_broadcast_payload(draft_picks)
  FROM PUBLIC, anon, authenticated;

-- league_chat → what the chat pane renders (D99/§16.3): id (list key —
-- chat rows are list items, unlike the topic-identified singletons above),
-- author, text, context, the system flag, timestamp. league_id is NOT
-- broadcast (derivable from the topic on league rows; irrelevant on draft
-- rows).
CREATE OR REPLACE FUNCTION league_chat_broadcast_payload(c league_chat)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id',         c.id,
    'user_id',    c.user_id,
    'message',    c.message,
    'context',    c.context,
    'is_system',  c.is_system,
    'created_at', c.created_at);
$$;

REVOKE EXECUTE ON FUNCTION league_chat_broadcast_payload(league_chat)
  FROM PUBLIC, anon, authenticated;

-- leagues → §5's "status/name/avatar_url ONLY" (the home-hero + draft-bar
-- flip). The named negatives pinned in 024: settings,
-- scoring_rules_snapshot, invite_code, invite_slug — the §9.2 "nothing
-- blind" rule made falsifiable (THE DoD BREAK-PROBE TARGET: widen this to
-- to_jsonb(l) and the exact-key pin + negatives go RED).
CREATE OR REPLACE FUNCTION league_broadcast_payload(l leagues)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'status',     l.status,
    'name',       l.name,
    'avatar_url', l.avatar_url);
$$;

REVOKE EXECUTE ON FUNCTION league_broadcast_payload(leagues)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Trigger functions (§9.2 printed pattern: SECURITY DEFINER,
--    search_path = '', RETURN NULL) + triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION broadcast_draft_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'operation', TG_OP,
      'table',     TG_TABLE_NAME,
      'schema',    TG_TABLE_SCHEMA,
      'record',    public.draft_broadcast_payload(NEW)),
    'drafts',
    'draft:' || NEW.id::text,
    true);
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION broadcast_draft_update()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_broadcast_drafts
  AFTER UPDATE ON drafts
  FOR EACH ROW EXECUTE FUNCTION broadcast_draft_update();

CREATE OR REPLACE FUNCTION broadcast_draft_pick_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'operation', TG_OP,
      'table',     TG_TABLE_NAME,
      'schema',    TG_TABLE_SCHEMA,
      'record',    public.draft_pick_broadcast_payload(NEW)),
    'draft_picks',
    'draft:' || NEW.draft_id::text,
    true);
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION broadcast_draft_pick_change()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_broadcast_draft_picks
  AFTER INSERT OR UPDATE ON draft_picks
  FOR EACH ROW EXECUTE FUNCTION broadcast_draft_pick_change();

-- Topic from context (§12.13 grammar, D99): a draft-context row's context
-- IS its topic string ('draft:<draft_id>' — the 065 INSERT policy enforces
-- the exact grammar for client rows; the 069 system posts write the same
-- shape); everything else is league chat.
CREATE OR REPLACE FUNCTION broadcast_league_chat_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'operation', TG_OP,
      'table',     TG_TABLE_NAME,
      'schema',    TG_TABLE_SCHEMA,
      'record',    public.league_chat_broadcast_payload(NEW)),
    'league_chat',
    CASE WHEN NEW.context LIKE 'draft:%'
         THEN NEW.context
         ELSE 'league:' || NEW.league_id::text
    END,
    true);
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION broadcast_league_chat_insert()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_broadcast_league_chat
  AFTER INSERT ON league_chat
  FOR EACH ROW EXECUTE FUNCTION broadcast_league_chat_insert();

CREATE OR REPLACE FUNCTION broadcast_league_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'operation', TG_OP,
      'table',     TG_TABLE_NAME,
      'schema',    TG_TABLE_SCHEMA,
      'record',    public.league_broadcast_payload(NEW)),
    'leagues',
    'league:' || NEW.id::text,
    true);
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION broadcast_league_update()
  FROM PUBLIC, anon, authenticated;

-- Column-triggered: ONLY the broadcast columns fire it (§5 "status/name/
-- avatar_url only" — a settings/lifecycle write that touches nothing a
-- client renders emits nothing).
CREATE TRIGGER tr_broadcast_leagues
  AFTER UPDATE OF status, name, avatar_url ON leagues
  FOR EACH ROW EXECUTE FUNCTION broadcast_league_update();

-- ---------------------------------------------------------------------------
-- 3. realtime.messages policies (Realtime Authorization; §9.2)
-- ---------------------------------------------------------------------------

-- READ, league topics — the §9.2 PRINTED policy verbatim (see the banner's
-- malformed-topic residual note).
CREATE POLICY "members read league topics" ON realtime.messages
  FOR SELECT TO authenticated USING (
    (SELECT realtime.topic()) LIKE 'league:%'
    AND public.is_league_member(
          split_part((SELECT realtime.topic()), ':', 2)::uuid)
  );

-- READ, draft topics — §9.2's "equivalent policy via the drafts.league_id
-- lookup", in the R117 exact-grammar shape (no cast; trailing junk matches
-- no draft).
CREATE POLICY "members read draft topics" ON realtime.messages
  FOR SELECT TO authenticated USING (
    (SELECT realtime.topic()) LIKE 'draft:%'
    AND EXISTS (
      SELECT 1 FROM public.drafts d
      WHERE 'draft:' || d.id::text = (SELECT realtime.topic())
        AND public.is_league_member(d.league_id)
    )
  );

-- WRITE, presence only (banner item 3: Presence is a §9/§9.1 member
-- feature; client Broadcast is NOT opened — the server-spoof channel
-- stays closed, pinned).
CREATE POLICY "members track presence on league topics" ON realtime.messages
  FOR INSERT TO authenticated WITH CHECK (
    realtime.messages.extension = 'presence'
    AND (SELECT realtime.topic()) LIKE 'league:%'
    AND public.is_league_member(
          split_part((SELECT realtime.topic()), ':', 2)::uuid)
  );

CREATE POLICY "members track presence on draft topics" ON realtime.messages
  FOR INSERT TO authenticated WITH CHECK (
    realtime.messages.extension = 'presence'
    AND (SELECT realtime.topic()) LIKE 'draft:%'
    AND EXISTS (
      SELECT 1 FROM public.drafts d
      WHERE 'draft:' || d.id::text = (SELECT realtime.topic())
        AND public.is_league_member(d.league_id)
    )
  );

-- The §12.14 publication ALTER is NOT executed (D89 — see the banner
-- erratum block; pgTAP 024 pins the publication carries none of the
-- broadcast tables).
