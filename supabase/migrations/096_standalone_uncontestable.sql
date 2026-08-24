-- ============================================================================
-- 096 — A STANDALONE PRACTICE AUCTION GETS ITS BIDDING BACK (ledger **F121**;
-- spec §8.6.9 / §8.6.1 / §8.6.3 unchanged — this migration changes no rule,
-- it gives an existing rule the team set it was always asking about on a
-- draft that has no league; tasks-MP §5 / §4 rules 1-16; D137 head rule;
-- D146 boundary rule; D245(7) and its R523 correction).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 1 — THE DEFECT, MEASURED.
-- ---------------------------------------------------------------------------
-- `draft_nomination_uncontestable` (head **093:590-652**, scan at 093:643-650)
-- asks §8.6.9's question — *"can any OTHER franchise reach high + $1?"* — over
--
--     FROM public.teams t ... WHERE t.league_id = v_league_id
--
-- On a standalone mock (095) `v_league_id` is **NULL**, so that predicate
-- matches NO SEAT, `NOT EXISTS` is TRUE, and §8.6.9's instant award fires on
-- **every** nomination. Reached from all three nomination paths
-- (093:1937 / 093:2101 / 093:2336, the last two re-emitted at 095:2817).
--
-- Measured before this file, on a DB deliberately holding **TWO** standalone
-- auction mocks of 8 seats each: the shipped predicate answers `t` for a
-- nomination that 7 of the nominator's own rivals could comfortably raise,
-- and over the wire a 12-tick drive reported `auction_cpu_raised: 0` /
-- `auction_cpu_nominated: 0` with `current_nomination: null` immediately
-- after a 200 nominate. **A standalone practice auction was not an auction.**
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 2 — THE FIX IS 095's IDIOM, AND THE ONE-LINER IS RULED WRONG.
-- ---------------------------------------------------------------------------
-- The tempting fix is `t.league_id IS NOT DISTINCT FROM v_league_id`.
-- **095's own banner item 4 already rules that wrong for this exact shape** —
-- said there of `draft_team_budget`/`draft_auction_solvent`, which sweep the
-- same unanchored `FROM public.teams`: *"it would make 'every standalone team
-- in the database' the team set."* This scan has no anchor to the draft
-- either (unlike `draft_queues.team_id`, where `IS NOT DISTINCT FROM` was
-- correct at 095 because the JOIN anchored it).
--
-- **Re-probed with two mocks present, because the original single-mock
-- reading could not tell the two apart (D245(7)):** the widened scan admits
-- **15** teams for an 8-seat mock, **8 of them the OTHER mock's seats**, and
-- it never gets as far as counting them — `draft_team_budget` RAISES P0002
-- (*"team ... is not a seat in standalone mock ... (the draft order IS the
-- team set)"*) on the first foreign seat, so the widening would abort the
-- predicate rather than answer it. **A count taken on an empty database
-- cannot distinguish a correctly-scoped scan from an unscoped one; the
-- fixture has to contain the thing the scope is supposed to exclude.**
--
-- So this file does what 095 did one level down: a `v_league_id IS NULL` arm
-- whose team set is the mock's OWN seat map (`drafts.draft_order`, the
-- permutation `create_mock_draft` validated against the seats it minted),
-- with **the league branch left as 093's text byte-unchanged**.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 3 — §4 RULE 11: NO DIFF IS VISIBLE ON A LEAGUE DRAFT.
-- ---------------------------------------------------------------------------
-- The new arm is guarded by `v_league_id IS NULL`. A REAL draft's
-- `league_id` is NOT NULL by construction (095 dropped the constraint only so
-- that a MOCK could be league-less; `drafts.is_mock = FALSE` rows are all
-- league-attached, and `one_active_real_draft_per_league` still keys on it),
-- so on a real draft the arm is provably unreachable and the RETURN executed
-- is the same 8 lines 093 shipped. **041's suite is the pin and it passes
-- untouched** (61/61); pgTAP 044 §D re-drives the league boundary beside the
-- standalone one so the claim is a test rather than this paragraph.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 4 — D137 HEAD PROVENANCE (re-derived here, not recalled).
-- ---------------------------------------------------------------------------
-- Re-derived with
--   `for f in supabase/migrations/*.sql; do grep -qE '^CREATE (OR REPLACE )?
--    FUNCTION +(public\.)?draft_nomination_uncontestable\(' "$f" && echo "$f";
--    done`
-- -> **exactly one file**, `093_uncontestable_instant_award.sql`. So:
--   draft_nomination_uncontestable   **093:590-652**   (THREE hunks)
-- The body below was produced by TEXTUAL SUBSTITUTION against that exact
-- range with the occurrence count asserted per hunk (1/1/1), never retyped;
-- `diff -U0` of head-range against the emitted body reports **three** hunks
-- and **one** deleted line (hunk 2's `SELECT`). The other two are pure
-- insertions, which is why the league RETURN is byte-identical.
--   HUNK 1 (093:609, +6)  the `v_draft_order JSONB` declare.
--   HUNK 2 (093:617, 1->2) the same SELECT, reading `draft_order` beside
--                          `league_id` — one statement, not a second probe.
--   HUNK 3 (093:623, +40) the `v_league_id IS NULL` arm, INSERTED ABOVE the
--                          league branch's OWN COMMENT BLOCK, so that block
--                          and the RETURN under it do not move a byte.
--
-- ---------------------------------------------------------------------------
-- Migration checklist (delivery plan §8.1 / tasks-M3 §4.4):
--  * DDL: NONE. No table, no column, no constraint, no index, no policy.
--  * Functions: ONE `CREATE OR REPLACE`. **The signature does not move**
--    (`draft_nomination_uncontestable(UUID, UUID, INTEGER) -> BOOLEAN`), so
--    **typegen produces no diff, and that is MEASURED rather than assumed.**
--    The function DOES appear in `src/types/database.ts`
--    (`Functions.draft_nomination_uncontestable`, :3445) — but that entry is
--    derived from the argument and return types, and neither moves. Verified
--    by regenerating against the local stack WITH 096 applied: the emitted
--    `Args: { p_draft_id; p_high_bid; p_nominator }` / `Returns: boolean`
--    entry is **byte-identical** to the committed one. Nothing was written
--    back, so the hand-written alias block is untouched by construction.
--  * §4.1 posture: plain (not SECURITY DEFINER — 093's own reasoning:
--    no client ever asks this question), `search_path = ''` kept verbatim,
--    and the REVOKE is **re-issued after the replace** (093/095 precedent).
--  * D38 BACKFILL: none is owed, and the reason is measured rather than
--    assumed. The function is STABLE and writes nothing; the rows it could
--    have mispriced are `draft_picks` already awarded on standalone mocks,
--    and a mock is disposable practice with a 72h expiry (§8.8 / 071's
--    `mock_draft_expire`) — there is no durable record to correct. No real
--    league's rows are reachable from this change at all (banner item 3).
--  * R6 STAGING WAIVER, cited: no staging clone exists (environments are
--    local + prod only). The recorded rehearsal is `npx supabase migration
--    up` against the local stack plus the FULL pgTAP suite and the
--    stack-backed vitest files. **NO `db reset` was run** — `migration up`
--    replays this file against the deployed chain, and F110's lesson stands:
--    destroying the dev machine's login and data to rehearse what
--    `migration up` already exercises is a cost with no evidence attached.
--  * Rollback = re-apply 093:590-652 verbatim, then re-issue the REVOKE.
--    Nothing else in the schema is touched, so the rollback is one function.
--  * F12 note: prod's migration history still ends pre-league-schema; this
--    lands with the next normal push.
-- ============================================================================

CREATE OR REPLACE FUNCTION draft_nomination_uncontestable(
  p_draft_id UUID,
  p_nominator UUID,
  p_high_bid INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  -- §8.6.3/§8.6.9: THE BID INCREMENT IS $1, FIXED, IN EVERY LEAGUE AND IN
  -- BOTH COLUMNS OF THE $0 TOGGLE. It is NAMED here and compared as
  -- `p_high_bid + c_bid_increment` rather than written as `> p_high_bid`,
  -- per §8.6.9's first bullet: the two forms agree only while the increment
  -- is 1, and the loose form would be a latent bug with no symptom. It is
  -- deliberately NOT a setting and NOT the nomination floor — 092/D214(2)
  -- separated those jobs and this constant is the third one.
  c_bid_increment CONSTANT INTEGER := 1;
  v_league_id UUID;
  -- 096/F121: the standalone team set. A mock with no league has no
  -- "active franchise of the league" to scan, so its seat map IS the
  -- team set — `drafts.draft_order`, the permutation `create_mock_draft`
  -- built from the seats it minted (095 banner item 4's authority,
  -- reused rather than re-decided).
  v_draft_order JSONB;
BEGIN
  IF p_draft_id IS NULL OR p_nominator IS NULL OR p_high_bid IS NULL THEN
    RAISE EXCEPTION
      'draft_nomination_uncontestable: draft, nominator and high bid are all required — an unknown answer would open a bid clock nobody can enter (§8.6.9)'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.league_id, d.draft_order INTO v_league_id, v_draft_order
    FROM public.drafts d WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'draft_nomination_uncontestable: draft % not found', p_draft_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 096/F121 — THE STANDALONE ARM. On a mock with no league `v_league_id` is
  -- NULL, `t.league_id = v_league_id` matches NO ROW, `NOT EXISTS` is TRUE,
  -- and EVERY nomination is declared uncontestable and awarded instantly at
  -- its opening bid: a standalone practice auction has no bidding at all.
  --
  -- The obvious one-liner — widening the league branch to
  -- `t.league_id IS NOT DISTINCT FROM v_league_id` — is WRONG, and 095's own
  -- banner item 4 already ruled it wrong for this identical unanchored
  -- `FROM public.teams` shape: it would make "every standalone team in the
  -- database" the team set. Measured on a DB holding TWO standalone mocks,
  -- the widened scan admits 15 teams for an 8-seat mock, 8 of them ANOTHER
  -- mock's seats, and `draft_team_budget` RAISES P0002 on those (095 §17's
  -- own seat guard) rather than counting them — so the widening does not
  -- merely over-count, it aborts the predicate.
  --
  -- So: the same arm 095 gave `draft_team_budget` and `draft_auction_solvent`
  -- one level down, over the mock's OWN `draft_order`. Same question, same
  -- increment, same boundary — a different authority for the SET.
  --
  --   s.seat <> p_nominator — unchanged in meaning: the nominator holds the
  --                           standing high bid and cannot outbid itself.
  --   no `status <> 'retired'` — the draft order IS the team set on this arm
  --                           (095 §17's precedent, both functions). A mock's
  --                           seats are minted by `create_mock_draft` and
  --                           there is no retire path for one; filtering on a
  --                           column the set is not defined by would be a
  --                           second, disagreeing authority.
  --   the money test is the SAME two conjuncts, because §8.6.1/§8.6.7(d) are
  --                           properties of a budget, not of a league.
  IF v_league_id IS NULL THEN
    RETURN NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(v_draft_order, '[]'::jsonb)) AS s(seat)
      CROSS JOIN LATERAL public.draft_team_budget(p_draft_id, s.seat::uuid) b
      WHERE s.seat::uuid <> p_nominator
        AND b.open_slots >= 1
        AND b.max_bid >= p_high_bid + c_bid_increment
    );
  END IF;

  -- "No OTHER eligible franchise can reach high + increment."
  --   t.id <> p_nominator   — the nominator holds the standing high bid and
  --                           cannot outbid itself (085's self-raise refusal).
  --   t.status <> 'retired' — the §8.6.8 team set (§7.2/D96), the same set
  --                           draft_auction_solvent sweeps.
  --   b.open_slots >= 1     — DOCUMENTATION (D199(2)). E27's complete rosters
  --                           already fail the money test, because
  --                           draft_team_budget forces max_bid = 0 at
  --                           open_slots <= 0 and high + 1 >= 1 > 0 at every
  --                           legal floor, the $0 one included. Kept because
  --                           saying what you mean is free; NEVER removed on
  --                           the grounds that it is redundant (v2.13.3 —
  --                           redundancy between two arms is not vacuity),
  --                           and never what correctness rests on.
  --   b.max_bid >= …        — §8.6.7(d)'s $1-max-bid team is a CONTESTANT at
  --                           a $0 opening and is not one at a $1 opening.
  --                           That boundary is the rule (041 §D).
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.teams t
    CROSS JOIN LATERAL public.draft_team_budget(p_draft_id, t.id) b
    WHERE t.league_id = v_league_id
      AND t.status <> 'retired'
      AND t.id <> p_nominator
      AND b.open_slots >= 1
      AND b.max_bid >= p_high_bid + c_bid_increment
  );
END;
$$;


-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION draft_nomination_uncontestable(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
