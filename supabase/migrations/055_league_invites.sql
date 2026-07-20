-- ============================================================================
-- league_invites + invite_slug — M1 task L.A1.4 (tasks-M1-league-foundation.md
-- §6/§7: migration 055, renumbered from the stale 043 reservation — 054 went
-- to the batch-2 review-fix migration; spec-redraft-leagues.md §7.2 (invite
-- requirements) + §12.23 (+ erratum v2.7.1 D46/D48).
--
-- NUMBERING: tasks-M1 §7 reserved 043 for this task; the chain moved past
-- the reservation (048 C15 fix; 049–051 L.A1.1 review fixes; 052 L.A1.2;
-- 053 L.A1.3; 054 the Q8/batch-2 server-authoritative fix). Next free number
-- at task time is 055 — the §7 table already reflects this correction.
--
-- 1. citext extension (installed by 040, ahead of any consumer) backs
--    invite_slug/invited_username/invited_email — the first CITEXT columns
--    actually shipped; 040 only installed the extension.
-- 2. leagues.invite_slug: optional custom share slug (§7.2 invite path 1 —
--    fieldscout.gg/join/<slug>, commissioner-set); NULL falls back to the
--    existing random leagues.invite_code (pre-epic column, unchanged).
-- 3. league_invites per §12.23 verbatim + the D46 send-tracking columns
--    (created_at/last_sent_at — erratum v2.7.1/C18: §7.2 requires "every
--    send/claim/revoke is recorded", the printed §12.23 DDL had neither).
--    One table serves all three seat-targeted invite paths (§7.2 items
--    2–4): target_team_id NULL = general league invite; invited_email OR
--    invited_username set = restricts claim to that login identity (email
--    is v1's primary path; username is secondary, requires an existing
--    account); neither set = open link, commissioner may raise max_uses.
-- 4. RLS: ONE policy, "Invites viewable by commish" (SELECT). NO write
--    policy for any role, including the commissioner — same shape as
--    team_managers (053) and for the same reason (Q8/D52 precedent, M1
--    batch-2 review): create/revoke/claim all move through SECURITY
--    DEFINER RPCs (L.A1.14), so there is no legitimate client-write shape
--    to carve a policy for here (unlike league_members' placeholder seats,
--    which do have one, 054). The pre-auth claim *preview* is deliberately
--    NOT an RLS carve-out either — it's a SECURITY DEFINER RPC (L.A1.14)
--    exposing only league name + team label + inviter display name (§12.23
--    as amended by D48/erratum v2.7.1), keyed by token, with its own
--    documented anon EXECUTE carve-out per §4.1 when that RPC ships.
--
-- Grants: none — 037 default-ACL model (D23); no new functions in this
-- migration, so the §4.1 REVOKE discipline has no target here. No realtime
-- triggers (D38 waiver: no live subscriber in the M1 UI slice).
--
-- §8.1 staging-rehearsal waiver (R6 rule): no staging clone exists; the
-- fresh local `db reset` over 001–055 + the pgTAP suite is the rehearsal
-- evidence. Prod-safe: one additive UNIQUE column on leagues (NULL default,
-- zero leagues rows in prod per 040's verified precondition) + one new
-- table with RLS enabled and its policy in the same migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. leagues.invite_slug (§7.2 path 1)
-- ----------------------------------------------------------------------------
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS invite_slug CITEXT UNIQUE;

-- ----------------------------------------------------------------------------
-- 2. league_invites (§12.23 verbatim + D46 additive columns)
-- ----------------------------------------------------------------------------
CREATE TABLE league_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  target_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,  -- NULL = general league invite
  invited_username CITEXT,                                     -- optional: restrict claim to this handle
  invited_email CITEXT,                                        -- optional: restrict claim to this login email (never league-visible)
  created_by UUID REFERENCES profiles(id) NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,                         -- general links may set higher
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '14 days',
  revoked_at TIMESTAMPTZ,
  claimed_by UUID REFERENCES profiles(id),
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- D46: initial send for email invites
  last_sent_at TIMESTAMPTZ                        -- D46: updated on re-send
);

CREATE INDEX idx_league_invites_league ON league_invites(league_id);

ALTER TABLE league_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Invites viewable by commish"
  ON league_invites FOR SELECT USING (is_league_commish(league_id));
-- No write policy for any role: create/revoke/claim all via SECURITY
-- DEFINER RPCs (L.A1.14). The pre-auth claim preview is a separate RPC
-- carve-out, not an RLS policy on this table (item 4 above).
