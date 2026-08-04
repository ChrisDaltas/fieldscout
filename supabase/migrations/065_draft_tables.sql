-- ============================================================================
-- Draft tables: drafts + draft_picks + draft_queues + the league_chat draft
-- extension — migration 065 (task L.B1.1; spec §12.3/§12.4/§12.6/§12.13,
-- §8.1 concurrency model, §9.2 broadcast rules; tasks-M2 §2–§4, D95/D99).
-- Schema lane opener for M2 (Phase B — snake draft engine).
--
-- NO RPCs in this migration — tables, constraints, indexes, RLS only
-- (draft_create/draft_start/draft_make_pick land in 066, L.B1.2).
--
--   1. `drafts` — §12.3 DDL verbatim, plus the R43-lesson CHECKs (the
--      printed enum COMMENTS become CHECK constraints at creation):
--      status IN ('scheduled','live','paused','complete') and
--      draft_type IN ('snake','auction','linear'). Member SELECT only; NO
--      client write policy — every write is a SECURITY DEFINER RPC (§8.1).
--      Indexes: the printed idx_drafts_league + idx_drafts_active, plus
--        * idx_drafts_due ON drafts(current_deadline) WHERE status='live'
--          (§22.3 — the draft-tick's SKIP-LOCKED scan target, 068/L.B1.3);
--        * one_active_real_draft_per_league — partial UNIQUE(league_id)
--          WHERE is_mock = FALSE AND status IN ('scheduled','live','paused')
--          (D95: one live/scheduled non-mock draft per league at a time; a
--          draft row is reusable across reschedules; mocks are exempt —
--          §8.8/E60 a live mock and a real scheduled draft coexist).
--      NOTE (amended 2026-08-03, R118 — batch-1 fix): §12.3 prints
--      `is_mock BOOLEAN DEFAULT FALSE` without NOT NULL; shipped verbatim
--      it left a NULL escape from the D95 partial predicate (review live
--      probe: a privileged NULL-is_mock 'live' draft coexisted with the
--      league's real scheduled draft). is_mock is now NOT NULL DEFAULT
--      FALSE — the same one-line R43-lesson class as the CHECKs (empty,
--      unreleased table); pgTAP 019 pins it (shape + behavioral 23502).
--
--   2. `draft_picks` — §12.4 DDL verbatim. Member SELECT; no client writes.
--        * uniq_draft_player_live UNIQUE(draft_id, player_id) WHERE
--          is_undone = FALSE — the E1 double-pick impossibility (§8.1:
--          row lock + this index make double-picks impossible under race;
--          undone picks return the player to the pool, §8.7).
--        * uniq_draft_action UNIQUE(draft_id, action_id) WHERE action_id
--          IS NOT NULL — E2 idempotency (client retries are no-ops; system/
--          cron picks carry NULL action_id and coexist freely, §12.4).
--        * idx_draft_picks_draft ON (draft_id, pick_number).
--
--   3. `draft_queues` — §12.6 DDL verbatim: the ONE spec-sanctioned
--      client-writable draft table (plan §8.2 names it; §9.3's write rule
--      excepts nothing else). Own-team SELECT + own-team FOR ALL, keyed on
--      teams.owner_id per the printed policy (M1 keeps owner_id synced with
--      the open stint — the R90 departure sweep — so owner-keyed ≡
--      membership on every RPC-created franchise). §12.6's commissioner
--      read-all comment ("for autopick debugging") is deliberately NOT
--      shipped as a policy until a debugging surface consumes it — F48
--      routes it to M6's commissioner console. NEVER broadcast (§9.2 —
--      "Sensitive tables (waiver_claims, draft_queues) are never
--      broadcast"); owners poll/refetch their own rows.
--      RECORDED (R120, record-only): the §12.6-printed policies validate
--      TEAM ownership only — an owner can insert queue rows for their team
--      against ANY draft_id (incl. another league's). Harmless while queue
--      rows are advisory; 068's autopick MUST join draft→league (or treat
--      queue rows as untrusted hints) rather than trust rows' draft_id.
--      AMENDED IN PLACE 2026-08-04 (L.B1.6/071 — unreleased chain, F12):
--      both policies gained the D103(3) MOCK-LAUNCHER carve-out (an OR
--      arm: the draft is a mock, the caller is config.mock.launched_by,
--      and the row is the human seat's queue) — the launcher owns their
--      practice seat's queue regardless of stint. See the policy comment.
--
--   4. `league_chat` §12.13 extension + the C11/F18(chat half) policy
--      replacement (D99): ADD context TEXT DEFAULT 'league' ('league' |
--      'draft:<draft_id>') + is_system BOOLEAN DEFAULT FALSE. The two 001
--      teams-keyed policies (ownership proxy via teams.league_id — the C11
--      defect: a teams-row owner with no membership could read AND post) are
--      DROPPED and replaced with membership truth:
--        * SELECT: is_league_member(league_id) — members see all chat incl.
--          system posts (§16.3: the room sees every commissioner override).
--        * INSERT: is_league_member AND user_id = auth.uid() AND
--          is_system = FALSE (no client can forge a system post — those are
--          written only by the §8.7 RPCs, D97/069) AND char_length(message)
--          BETWEEN 1 AND 500 (§12.13/§22.5 shape; the lower bound is R119 —
--          spec silent, empty posts refused; rate limits proper are M7 —
--          F41) AND draft-context validity by EXACT grammar match (context
--          = 'league', or context equals the FULL 'draft:' || d.id string
--          of a draft in THIS league — cross-league, malformed, AND
--          trailing-junk ('draft:<valid-id>:junk') contexts all refused).
--          Amended 2026-08-03 (R117): the original split_part(context,':',2)
--          check validated only segment 2 and accepted trailing junk. The
--          text compare keeps the no-::uuid-cast property — a malformed
--          context fails the policy, not a cast.
--        * NO UPDATE/DELETE for anyone — chat is append-only in v1 (D99).
--      Direct client INSERT retained: §9.3 sanctions exactly one direct
--      client write, league_chat — no chat route is added (D99).
--
-- Realtime (standing rule 5, tasks-M2 §4.5): drafts, draft_picks, and
-- league_chat get their Broadcast-from-DB triggers in MIGRATION 070
-- (L.B1.5 — the schema lane's realtime task; no subscriber exists until
-- L.B3.1 wires the first client). draft_queues never gets one (§9.2).
-- The §12.14 supabase_realtime publication ALTER is NOT executed (D89).
--
-- Grants doctrine (tasks-M1 §4.1, D18→D23): no per-object GRANTs — 037's
-- default ACLs already expose the tables and RLS is the only effective
-- gate; no SECURITY DEFINER routine is created here, so no REVOKE is owed.
--
-- Staging rehearsal: R6 waiver — no staging clone exists (environments are
-- local + prod only); the recorded rehearsal evidence is the fresh local
-- `npx supabase db reset` replay of the full 001–065 chain (session log
-- 2026-08-03) plus pgTAP 019 in the same PR.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. drafts (§12.3 + the R43-lesson CHECKs + D95/§22.3 indexes)
-- ---------------------------------------------------------------------------

CREATE TABLE drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  draft_type TEXT NOT NULL DEFAULT 'snake',        -- snake | auction | linear
  status TEXT NOT NULL DEFAULT 'scheduled',        -- scheduled | live | paused | complete
  is_mock BOOLEAN NOT NULL DEFAULT FALSE,           -- NOT NULL: R118 (D95 predicate escape closed)
  config JSONB NOT NULL DEFAULT '{}',              -- snapshot of draft settings (§7.3.8) at scheduling
  draft_order JSONB,                               -- ordered array of team_ids (snake/linear)
  nomination_order JSONB,                          -- ordered array of team_ids (auction)
  total_rounds INTEGER,                            -- derived from roster_size (snake; D91: starters + bench, IR excluded)
  current_round INTEGER DEFAULT 1,
  current_pick_number INTEGER DEFAULT 1,           -- 1-based overall pick index
  on_clock_team_id UUID REFERENCES teams(id),      -- team currently picking / nominating
  current_nomination JSONB,                        -- auction: { player_id, high_bid, high_bidder_team_id }
  current_deadline TIMESTAMPTZ,                    -- server-authoritative clock end
  paused_at TIMESTAMPTZ,
  deadline_remaining_ms INTEGER,                   -- v2.0: remaining clock persisted on pause (§8.7)
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT drafts_status_check
    CHECK (status IN ('scheduled', 'live', 'paused', 'complete')),
  CONSTRAINT drafts_draft_type_check
    CHECK (draft_type IN ('snake', 'auction', 'linear'))
);

ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drafts viewable by league members"
  ON drafts FOR SELECT USING (is_league_member(league_id));
-- No client write policy: all writes via SECURITY DEFINER RPCs (§8.1; 066+).

CREATE INDEX idx_drafts_league ON drafts(league_id);
CREATE INDEX idx_drafts_active ON drafts(status) WHERE status IN ('live', 'paused');
-- §22.3: the draft-tick worker's due-deadline scan (068/L.B1.3).
CREATE INDEX idx_drafts_due ON drafts(current_deadline) WHERE status = 'live';
-- D95: one live/scheduled non-mock draft per league at a time.
CREATE UNIQUE INDEX one_active_real_draft_per_league
  ON drafts(league_id)
  WHERE is_mock = FALSE AND status IN ('scheduled', 'live', 'paused');

-- ---------------------------------------------------------------------------
-- 2. draft_picks (§12.4)
-- ---------------------------------------------------------------------------

CREATE TABLE draft_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES drafts(id) ON DELETE CASCADE NOT NULL,
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  pick_number INTEGER NOT NULL,                    -- overall pick index (snake/linear); sequence # (auction)
  round INTEGER,
  team_id UUID REFERENCES teams(id) NOT NULL,
  player_id TEXT REFERENCES players(id) NOT NULL,  -- players.id is TEXT (Sleeper id) per Phase 0 schema
  price INTEGER,                                   -- auction winning bid; NULL for snake
  is_auto BOOLEAN DEFAULT FALSE,                   -- autopicked
  is_undone BOOLEAN DEFAULT FALSE,                 -- soft-undo (kept for audit)
  picked_by UUID REFERENCES profiles(id),          -- the user who made it (manager or commissioner)
  made_via TEXT DEFAULT 'manager',                 -- manager | autopick | commissioner
  action_id UUID,                                  -- client-generated; dedupes retries (NULL for system/cron picks)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE draft_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Picks viewable by league members"
  ON draft_picks FOR SELECT USING (is_league_member(league_id));
-- No client write policy: picks are written only by the draft RPCs (§8.1).

-- exclusivity within a draft (ignores undone picks) — E1:
CREATE UNIQUE INDEX uniq_draft_player_live
  ON draft_picks(draft_id, player_id) WHERE is_undone = FALSE;
-- idempotency (replay-safe picks) — E2; system/cron picks carry NULL:
CREATE UNIQUE INDEX uniq_draft_action
  ON draft_picks(draft_id, action_id) WHERE action_id IS NOT NULL;
CREATE INDEX idx_draft_picks_draft ON draft_picks(draft_id, pick_number);

-- ---------------------------------------------------------------------------
-- 3. draft_queues (§12.6 — the one client-writable draft table; F48: the
--    commissioner read-all policy is deliberately absent until M6)
-- ---------------------------------------------------------------------------

CREATE TABLE draft_queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES drafts(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  player_id TEXT REFERENCES players(id) NOT NULL,
  rank INTEGER NOT NULL,                            -- order within this team's queue
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(draft_id, team_id, player_id)
);

ALTER TABLE draft_queues ENABLE ROW LEVEL SECURITY;

-- A manager sees/edits only their own queue (§12.6 printed policies), OR —
-- the D103(3) mock-launcher carve-out (amended in place by L.B1.6/071,
-- unreleased chain F12) — the caller launched a MOCK draft and the row is
-- the HUMAN seat's queue for that mock: the launcher owns their practice
-- seat's queue regardless of stint (the chosen seat may be a placeholder
-- or another user's franchise — §8.8 "any seat selectable"). Config values
-- compared as TEXT (the R117 no-cast rule). The seat's REAL owner also
-- matches via the printed owner arm (the R120 advisory-rows class,
-- recorded — queue rows are hints, the autopick reads them launcher-keyed
-- for mocks, 068). Behavior pinned in pgTAP 025; 019's name/cmd pins are
-- unchanged.
CREATE POLICY "Own queue read" ON draft_queues FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM drafts d
      WHERE d.id = draft_queues.draft_id
        AND d.is_mock
        AND d.config->'mock'->>'launched_by' = auth.uid()::text
        AND d.config->'mock'->>'human_team_id' = draft_queues.team_id::text
    )
  );
CREATE POLICY "Own queue write" ON draft_queues FOR ALL
  USING (
    EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM drafts d
      WHERE d.id = draft_queues.draft_id
        AND d.is_mock
        AND d.config->'mock'->>'launched_by' = auth.uid()::text
        AND d.config->'mock'->>'human_team_id' = draft_queues.team_id::text
    )
  );

CREATE INDEX idx_draft_queues_team ON draft_queues(draft_id, team_id, rank);

-- ---------------------------------------------------------------------------
-- 4. league_chat: §12.13 extension + D99 policy replacement (C11 fix,
--    F18 chat half)
-- ---------------------------------------------------------------------------

ALTER TABLE league_chat
  ADD COLUMN IF NOT EXISTS context TEXT DEFAULT 'league',   -- 'league' | 'draft:<draft_id>'
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE; -- system posts for commissioner actions (non-deletable)

-- The 001 teams-keyed policies (the C11 ownership proxy) are replaced with
-- membership truth. Old semantics a ghost teams-row owner enjoyed (read +
-- post with no membership) are pinned CLOSED in pgTAP 019 — the 052
-- policy-swap falsifiability pattern, both directions.
DROP POLICY "League members can view chat" ON league_chat;
DROP POLICY "League members can send messages" ON league_chat;

CREATE POLICY "Chat viewable by league members"
  ON league_chat FOR SELECT USING (is_league_member(league_id));

CREATE POLICY "Members post their own chat"
  ON league_chat FOR INSERT WITH CHECK (
    is_league_member(league_id)
    AND user_id = auth.uid()
    AND is_system = FALSE                          -- system posts are RPC-only (D97/D99)
    AND char_length(message) BETWEEN 1 AND 500     -- lower bound: R119 (empty refused)
    AND (
      context = 'league'
      -- R117: EXACT grammar match — context must equal the full
      -- 'draft:<draft_id>' string of a draft in THIS league. (The original
      -- split_part segment-2 check let 'draft:<valid-id>:junk' through and
      -- store verbatim — a league-visible shadow channel.) Text concat
      -- keeps the no-::uuid-cast property: malformed contexts fail the
      -- policy, never a cast.
      OR EXISTS (
        SELECT 1 FROM drafts d
        WHERE 'draft:' || d.id::text = league_chat.context
          AND d.league_id = league_chat.league_id
      )
    )
  );

-- NO UPDATE/DELETE policies for anyone: chat is append-only in v1 (D99).
