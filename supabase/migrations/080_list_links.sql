-- ============================================================================
-- list_links — the THIRD and final schema exception in the Lists v2 build
-- (delivery-plan-lists-v2.md v3.7 §1/§2.2, design decision **D6**, task
-- **LV.8**). Design LAW is docs/design/lists/README.md; the screen this serves
-- is `docs/design/lists/screens/detail-tab-details.png`.
--
-- THE RULING THAT AUTHORISES IT — Chris, 2026-08-11, verbatim:
--   *"lets create the table for storing the link, we need a way to link back
--   to resources used and a way for creators to attached videos to their
--   lists."*
--
-- Two stated purposes, and they are the whole scope of this table:
--   1. **Attribution** — linking back to the resources a list drew on.
--   2. **Creator video** — attaching a video to a list you made.
-- Both are the author speaking about their own list. That is why READS follow
-- the list and WRITES are owner-only (§3 below): a link is the author's
-- attribution, not a viewer's annotation.
--
-- Plan §1 said "two exceptions" and D6 said "two server-side changes" through
-- v3.6. Both are updated to THREE by this task; the header, §1, D6 and the
-- changelog all name this table. **The budget is now closed at three** — a
-- fourth needs its own ruling.
--
-- WHAT IT STORES, AND WHAT IT DELIBERATELY DOES NOT.
-- The handoff's data model is `links: [{ kind: "video"|"article", url, title
-- }]`; the screenshot renders more than that — a card carrying the title, a
-- source line ("Field Scout on YouTube"), a duration ("18:42") and a remove
-- control, in a visibly ordered list. Every column below is one of those
-- rendered facts, and nothing is here that no pixel asks for.
--
-- **Nothing is fetched, scraped, or derived.** `source_label` and
-- `duration_label` are typed by the person attaching the link. That is a
-- standing rule, not a shortcut (CLAUDE.md / the "no FireCrawl — RSS + YouTube
-- only" memory): ingestion is plain fetch of RSS/YouTube feeds and nothing
-- here may reintroduce a scraping service. Auto-filling the title/duration
-- from a YouTube URL is a follow-up to PROPOSE, never to smuggle in.
--
-- Migration checklist (delivery-plan-redraft-leagues.md §8.1 — the house
-- standard, applied here per the LV.1.2 precedent):
--   * ADDITIVE ONLY — one new table. `lists` is not touched: no column added,
--     no policy added, no policy altered. The 001+067 policy sets on `lists`
--     and `list_players` survive byte-for-byte (pinned by pgTAP 029 with
--     `policies_are`).
--   * RLS enabled + all policies in the SAME migration as the table (§3).
--   * Indexes for every FK used in policies or joins — see the index note.
--   * `IF NOT EXISTS` guards on the table and index; policies use the house
--     `DROP POLICY IF EXISTS` + `CREATE POLICY` form (Postgres has no
--     `CREATE POLICY IF NOT EXISTS`), so the whole file is re-runnable.
--   * Staging-clone rehearsal: **R6 waiver cited** — no staging environment
--     exists for this project. The recorded rehearsal evidence is a fresh
--     `npx supabase db reset` replaying the full 001→080 chain plus
--     `supabase test db`, both shown in the PR.
--   * Typegen (`src/types/database.ts`) regenerated and committed in the same
--     PR, with the hand-written alias block preserved byte-identically.
--   * Realtime broadcast trigger: **not owed**. A link is authored by the list
--     owner alone and read on page load; there is no live subscriber and
--     nothing collaborative to broadcast (same reasoning as 079).
--   * Reaches production via `npx supabase db push` — NEVER by hand, never
--     through the dashboard or the database API (CLAUDE.md migration
--     discipline; the 36-unapplied-migrations lesson). **This migration has
--     been applied LOCALLY ONLY.** Pushing it is Chris's separate step.
--
-- ============================================================================
-- THE URL IS THE SECURITY-SHAPED PART, AND IT IS GUARDED IN TWO PLACES.
--
-- `url` is user input that renders as an `href` on a PUBLIC, server-rendered
-- page (`/u/[username]/lists/[slug]`, SEO-critical per plan §3 **D7**). A
-- `javascript:` or `data:` href there is stored XSS with a click.
--
--   * **Layer 1 — this CHECK.** `^https?://` admits exactly two schemes, so
--     `javascript:`, `data:`, `vbscript:`, `file:` and every other scheme are
--     rejected by the DATABASE, on every path, including paths that never
--     touch Zod. That last clause is the whole argument for a DB-side check
--     rather than validation alone, and it is the lesson `duplicate_list`
--     already taught this codebase: that RPC copies `list_players.tier`
--     verbatim and never passes through the API's validation, which is why
--     Q2/D4 kept a CHECK on that column instead of dropping it.
--   * **Layer 2 — `src/lib/lists/links-service.ts`.** Parses with the WHATWG
--     `new URL()` and asserts `protocol` is `http:`/`https:`, then stores
--     `parsed.href`. Parse-then-check beats regex-on-raw-input on the one case
--     a regex misses: browsers strip TAB and newline out of a scheme, so
--     `java<TAB>script:alert(1)` is a live `javascript:` URL that
--     `^https?://` on the RAW string would... also reject, but which
--     `new URL()` normalises INTO `javascript:` where the protocol check
--     catches it explicitly. Storing `.href` is what makes the two layers
--     agree: it is percent-encoded, whitespace-free and scheme-normalised, so
--     it always satisfies the CHECK below.
--
-- Neither layer is redundant. The service gives a friendly 400 naming the
-- reason; the CHECK is what is still true when someone writes a new route, a
-- new RPC, or a seed script.
--
-- The `[^[:space:]]` clause is not decoration either: it forbids a stored URL
-- containing a newline or tab, which is what a smuggling attempt looks like
-- after it survives a naive prefix test.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS list_links (
  -- A surrogate id, unlike 079's natural key. 079 could use (user, list,
  -- player) because row PRESENCE was the entire state; a link has a mutable
  -- payload and needs a stable handle for `DELETE .../links/[linkId]` and for
  -- the reorder contract to name rows by.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links belong to the LIST, not to a viewer — that is the ruling's "link
  -- back to resources used" and "creators attach videos to THEIR lists".
  -- Contrast 079, which is keyed by user because a drafted mark is the
  -- viewer's private scratch state.
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,

  -- The handoff's own two-value union. Closed at the DB so the renderer's
  -- glyph switch is total and can never fall through to a blank tile.
  kind TEXT NOT NULL,

  url TEXT NOT NULL,

  -- The card's bold first line.
  title TEXT NOT NULL,

  -- The muted second line, left of the middot: "Field Scout on YouTube".
  -- NULLABLE — a bare link with no attribution line is a legitimate card, and
  -- with no scraping there is nothing to fill it in from.
  source_label TEXT,

  -- The muted second line, right of the middot: "18:42". NULLABLE for the
  -- same reason, and always absent for most articles.
  duration_label TEXT,

  -- The design renders an ORDERED list, so order is stored, not incidental.
  -- 0-based and contiguous, assigned by the service. Deliberately NOT UNIQUE
  -- per list: a unique (list_id, position) would force every reorder into a
  -- two-phase shuffle to dodge transient collisions, for no gain — the read
  -- path orders by (position, created_at, id), which is TOTAL, so even a
  -- duplicated position renders in a stable, deterministic order.
  position INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Maintained explicitly by the reorder path, the way `lists.updated_at` is
  -- maintained by `/api/lists/[id]` — there is no trigger and this file does
  -- not add one.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT list_links_kind_check
    CHECK (kind IN ('video', 'article')),

  -- LAYER 1 of the URL guard — see the banner. http/https ONLY, no embedded
  -- whitespace.
  CONSTRAINT list_links_url_scheme_check
    CHECK (url ~* '^https?://[^[:space:]]+$'),
  -- Bounded so a single link cannot carry a payload-sized string onto a public
  -- page. 2048 is the conventional practical URL ceiling; 8 is `http://a`.
  CONSTRAINT list_links_url_length_check
    CHECK (char_length(url) BETWEEN 8 AND 2048),

  -- A blank title would render an unlabelled card with a remove button.
  CONSTRAINT list_links_title_check
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),

  CONSTRAINT list_links_source_label_check
    CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 80),

  -- A CLOCK duration, not free text: `18:42` or `1:02:33`. The screenshot
  -- renders it as a bare figure next to the source, so a closed shape keeps
  -- that line from becoming a second, unbounded caption on a public page.
  CONSTRAINT list_links_duration_label_check
    CHECK (duration_label IS NULL OR duration_label ~ '^[0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?$'),

  CONSTRAINT list_links_position_check
    CHECK (position >= 0),

  -- Attaching the same resource twice is a mistake, not an intent, and the
  -- service normalises through `new URL().href` first so `https://x` and
  -- `https://x/` collide as they should. The service maps 23505 to a specific
  -- 409 saying so, rather than a silent second card.
  CONSTRAINT list_links_list_url_key UNIQUE (list_id, url)
);

-- ---------------------------------------------------------------------------
-- 2. Indexes (§8.1)
-- ---------------------------------------------------------------------------
-- `list_id` is the FK used by EVERY policy below and by the only read the
-- feature has ("this list's links, in order"), so it is indexed with the sort
-- key trailing: the read is an index-ordered range scan rather than a scan
-- plus sort. The PK on `id` serves DELETE-by-id and nothing else.
CREATE INDEX IF NOT EXISTS idx_list_links_list_position
  ON list_links(list_id, position);

-- ---------------------------------------------------------------------------
-- 3. RLS — reads follow the LIST, writes are OWNER-ONLY
-- ---------------------------------------------------------------------------

ALTER TABLE list_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "list_links readable with the list" ON list_links;
DROP POLICY IF EXISTS "list_links owner insert" ON list_links;
DROP POLICY IF EXISTS "list_links owner update" ON list_links;
DROP POLICY IF EXISTS "list_links owner delete" ON list_links;

-- READ — "if you can see the list, you can see its links".
--
-- The `EXISTS` carries NO visibility conjunct ON PURPOSE, exactly as 079's
-- INSERT policy does. Policy expressions are evaluated as the invoking role,
-- so this subquery runs under `lists`'s OWN RLS — 001's
-- `(is_private = FALSE AND deleted_at IS NULL) OR auth.uid() = owner_id`, plus
-- 067's "League-shared lists readable by league members". The rule it encodes
-- is therefore *exactly* the list's own visibility, for every case `lists`
-- knows about now and every case it learns later.
--
-- Spelling the visibility out inline — the `is_private = FALSE OR owner_id =
-- auth.uid()` form that 013 `list_favorites` uses — would SILENTLY exclude
-- 067's league-shared private lists. That is not hypothetical: it is the
-- review finding (R173) that LV.1.2's identical policy was rewritten for, and
-- it is pinned here the same way. pgTAP 029 asserts all three directions —
-- a stranger CAN read a public list's links, CANNOT read a plain private
-- list's, and CAN read a private list's when it is shared with a league they
-- both belong to. **The third pin is the load-bearing one**: substitute the
-- 013 form and it is the only assertion in the file that reddens.
--
-- No `deleted_at IS NULL` conjunct either, and that is also deliberate: 001
-- already lets an owner SELECT their own trashed list, so its links should
-- follow it into the trash and back out again. Adding the conjunct here would
-- make a restore silently lose them.
CREATE POLICY "list_links readable with the list"
  ON list_links FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = list_links.list_id
    )
  );

-- WRITE — owner-only, and here the ownership IS spelled out.
--
-- "Owner-only" is a DIFFERENT rule from "readable", so it gets its own
-- predicate rather than deferring: a link is the author's attribution, not a
-- viewer's annotation (the ruling). A league member who can read a shared
-- private list must NOT be able to staple their own video onto it — which is
-- precisely the case the read policy's deference lets through, and the case
-- these three predicates stop.
--
-- `deleted_at IS NULL` on INSERT/UPDATE mirrors 079 hardening 2: a trashed
-- list accepts no new attachments and no reordering, even from its owner.
CREATE POLICY "list_links owner insert"
  ON list_links FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = list_links.list_id
        AND lists.owner_id = auth.uid()
        AND lists.deleted_at IS NULL
    )
  );

-- UPDATE exists for exactly one caller: the reorder route rewriting `position`.
-- Both USING and WITH CHECK are owner-scoped, so a link cannot be moved from a
-- list you own onto one you do not.
CREATE POLICY "list_links owner update"
  ON list_links FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = list_links.list_id
        AND lists.owner_id = auth.uid()
        AND lists.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = list_links.list_id
        AND lists.owner_id = auth.uid()
        AND lists.deleted_at IS NULL
    )
  );

-- DELETE is owner-only but carries NO `deleted_at` conjunct — you must always
-- be able to clean up your own rows, including on a list that has since gone
-- into the trash (079's DELETE policy takes the same position for the same
-- reason).
CREATE POLICY "list_links owner delete"
  ON list_links FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = list_links.list_id
        AND lists.owner_id = auth.uid()
    )
  );

COMMENT ON TABLE list_links IS
  'Resources attached to a list (Lists v2, Chris 2026-08-11): attribution links back to what the list drew on, and creator videos. Reads follow the list''s own visibility; writes are owner-only. url is http/https only, CHECK-enforced, because it renders as an href on the public share page. Nothing here is scraped — every label is typed by the author.';
