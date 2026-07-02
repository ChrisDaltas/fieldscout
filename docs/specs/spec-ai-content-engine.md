# Spec: AI Persona Content Engine

## Phase
Phase 0 (context store schema + on-demand context builder) → Phase 1 (daily ingestion agent, context-grounded list generation, automated content + SEO posts).

Builds directly on [spec-ai-expert-personas.md](spec-ai-expert-personas.md) and [spec-ai-list-generation.md](spec-ai-list-generation.md). Read those first — this spec is the connective layer between them, not a replacement.

---

## Overview

The persona system already defines *who* the AI analysts are ([spec-ai-expert-personas.md](spec-ai-expert-personas.md)) and *how a user generates a list in a persona's voice* ([spec-ai-list-generation.md](spec-ai-list-generation.md)). What's missing is the layer in between: a **living, cited knowledge store per persona** that captures each analyst's latest published opinions, the **scheduled job that keeps it fresh**, and an **automated content engine** that turns that knowledge into persona-voiced lists and posts for engagement and SEO.

Two outcomes this enables:

1. **Better user-triggered AI lists (use case 1).** When a user picks a persona in the Generate-with-AI flow, the persona's current, sourced stances ground the output — not just a static style description.
2. **Automated platform content (use case 2).** Persona-voiced themed lists and posts ("Top Busts for 2026," "[Persona]'s weekly risers") are generated and published on a schedule, each with justification and source links — seeding the feed and indexable SEO pages before the human community reaches scale.

---

## How this maps to the original ask

| You said | In this architecture it becomes |
|----------|--------------------------------|
| "context files for each AI influencer profile" | `persona_context` — one living, versioned, cited context record per persona, with a human-readable `rendered_md` "context file" for inspection |
| "agents that … check for new content daily" | `ingest-persona-content` — a daily, change-gated Supabase Edge Function (pg_cron) that iterates personas and refreshes their context |
| use case 1: "Create List with AI" (influencer, position, scoring, count → generate) | Already specced in [spec-ai-list-generation.md](spec-ai-list-generation.md). This spec feeds live `persona_context` into its `{style_description}` slot |
| use case 2: "automatically creating posts and lists … based on influencer opinions … with justification" | The **Automated Content Engine** section below (`generate-persona-content` + `persona_posts`) |

> **On "agents":** in this stack a daily "agent" is a scheduled Edge Function running with the service role that iterates over personas — the same pattern as the existing `refresh-persona-lists`, `sync-stats`, and `calculate-cred` crons. It is not a long-lived process. The per-persona mental model still holds: each persona is processed independently and can be enabled/disabled via `ai_personas.is_active`.

---

## Current State & Dependencies

As of this writing the persona system is **specced but not yet built** — the latest migration is `016_team_lists_and_folders.sql`, and there are no `ai_personas` or `persona_source_rankings` tables in the database yet. This spec depends on landing the persona foundation first:

1. **Migrate the persona foundation** from [spec-ai-expert-personas.md](spec-ai-expert-personas.md): `ai_personas`, `persona_source_rankings`, the `lists.ai_persona_id` column, and the `system_expert_owner_id` system account.
2. **Then** add this spec's tables (`persona_sources`, `persona_content_items`, `persona_context`, `persona_context_versions`, `persona_posts`).

The snapshot pattern referenced below already exists in `010_big_board_snapshots.sql`.

---

## Core principles (inherited and extended)

1. **Parody-persona firewall.** All generated content is the *persona's* AI-generated take (e.g., "Bathew Merry (AI)"), never attributed to the real analyst. The real person's name never appears in titles, bios, body text, or rationale. (Carried from [spec-ai-expert-personas.md](spec-ai-expert-personas.md).)
2. **Ground, don't invent.** Every generated stance traces to a real, public, free-to-access source captured in `persona_content_items`. Ranks may mirror a published list exactly; **prose is always original**; opinions are synthesized from cited material, not fabricated.
3. **Change-gated daily checks.** The daily job does a cheap "has anything new been published?" check first and only runs expensive extraction + regeneration when something actually changed. Daily cadence, near-zero cost on quiet days.
4. **Free, non-paywalled sources only.** Paywalled/subscription content is never ingested. `source_url` is stored on everything; any takedown is honored via soft-delete, same as the existing persona takedown process.
5. **Editorial gate before publish.** Automated posts land as `draft` and are promoted to `published` after review (human-in-the-loop in Phase 1; can move to trusted auto-publish later).

---

## Data Model

All new tables follow project conventions: RLS enabled, soft deletes via `deleted_at`, snake_case columns, `system_expert_owner_id` for persona-owned content. System-written tables are **service-role only** (no client policies), matching `persona_source_rankings`.

### persona_sources

Where to look for each persona's content. Drives the daily checker.

```sql
CREATE TABLE persona_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_persona_id UUID REFERENCES ai_personas(id) NOT NULL,
  type TEXT NOT NULL,                    -- 'rss' | 'youtube' | 'web' | 'podcast'
  url TEXT NOT NULL,
  label TEXT,                            -- 'NBC weekly rankings', 'YouTube channel', etc.
  is_paywalled BOOLEAN DEFAULT FALSE,    -- if TRUE, never ingested
  -- change-detection state
  etag TEXT,                             -- HTTP ETag / Last-Modified, when available
  last_listing_hash TEXT,               -- hash of the listing/feed for diffing
  last_item_published_at TIMESTAMPTZ,    -- newest item seen so far
  last_checked_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE persona_sources ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only. Operational metadata, never served to clients.
```

> **Source guidance.** RSS is the most reliable (many analyst sites and *every* YouTube channel expose a per-channel RSS feed). Web pages work via FireCrawl. Podcasts via their RSS feed + episode notes. **X/Twitter is largely not fetchable and should be treated as best-effort/optional** — do not make any persona depend on it as its only source.

### persona_content_items

Each discrete piece of content ingested for a persona. Generalizes `persona_source_rankings` (which stays specialized for exact ranked-list scrapes) to non-ranking opinion content.

```sql
CREATE TABLE persona_content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_persona_id UUID REFERENCES ai_personas(id) NOT NULL,
  source_id UUID REFERENCES persona_sources(id),
  source_url TEXT NOT NULL,
  source_type TEXT,                      -- 'rss' | 'youtube' | 'web' | 'podcast'
  title TEXT,
  published_at TIMESTAMPTZ,
  content_hash TEXT NOT NULL,            -- dedupe key
  extracted JSONB NOT NULL,              -- structured signals from Claude (see shape)
  raw_excerpt TEXT,                      -- short excerpt for traceability only
  ingested_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (ai_persona_id, content_hash)
);

ALTER TABLE persona_content_items ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only. Never served to clients; raw_excerpt is for audit/takedown traceability.
```

`extracted` JSONB shape (Claude output — opinions/signals, never verbatim prose):

```json
{
  "player_takes": [
    { "player_name": "Bijan Robinson", "team": "ATL", "stance": "up", "summary": "league-winning RB1 ceiling on a fixed offense", "strength": 0.8 }
  ],
  "themes": ["post-hype WRs", "rookie RB workloads"],
  "format": "PPR",
  "kind": "rankings_article"            // 'rankings_article' | 'opinion' | 'video' | 'podcast'
}
```

### persona_context

The living "context file" — one current row per persona, synthesized from `persona_content_items` + `persona_source_rankings` + the seed `style_profile`.

```sql
CREATE TABLE persona_context (
  ai_persona_id UUID PRIMARY KEY REFERENCES ai_personas(id),
  context JSONB NOT NULL,                -- synthesized living context (shape below)
  rendered_md TEXT,                      -- human-readable rendering for inspection/QA
  version INTEGER DEFAULT 1,
  source_item_count INTEGER DEFAULT 0,
  last_material_change_at TIMESTAMPTZ,   -- set when a refresh meaningfully changed stances
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE persona_context ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only. Read by server-side generation routes via the service role.
```

`context` JSONB shape:

```json
{
  "as_of": "2026-06-18",
  "voice": "optimistic, story-first, loves a breakout narrative",
  "current_stances": [
    {
      "player_name": "Bijan Robinson", "team": "ATL", "stance": "RB1 with league-winning upside",
      "confidence": 0.8, "source_url": "https://…", "observed_at": "2026-06-15"
    }
  ],
  "signature_takes": ["always has a 'my guy' sleeper", "rounds early on hyped sophomores"],
  "recent_movements": [
    { "player_name": "…", "direction": "up", "note": "…", "source_url": "https://…" }
  ],
  "themes_in_play": ["post-hype WRs", "new-coach offenses"],
  "source_log": [
    { "url": "https://…", "type": "rss", "published_at": "2026-06-15", "ingested_at": "2026-06-18" }
  ]
}
```

### persona_context_versions

Lightweight history so context changes are auditable and so persona accuracy can feed the cred system later (mirrors the snapshot pattern in [spec-big-board.md](spec-big-board.md)).

```sql
CREATE TABLE persona_context_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_persona_id UUID REFERENCES ai_personas(id) NOT NULL,
  version INTEGER NOT NULL,
  context JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE persona_context_versions ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.
```

### persona_posts

Automated editorial content for use case 2. Themed *lists* reuse the existing `lists` table (persona-owned, `ai_persona_id` set, tagged with system tags like `Busts`). `persona_posts` holds the narrative post + justification wrapped around an optional backing list.

```sql
CREATE TABLE persona_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_persona_id UUID REFERENCES ai_personas(id) NOT NULL,
  list_id UUID REFERENCES lists(id),     -- optional backing list (e.g., the ranked "busts" list)
  kind TEXT NOT NULL,                    -- 'themed_list' | 'take' | 'weekly_movers'
  title TEXT NOT NULL,                   -- persona-voiced, parody name only
  slug TEXT NOT NULL,
  dek TEXT,                              -- subtitle / summary
  body_md TEXT NOT NULL,                 -- original AI prose with per-player justification
  citations JSONB NOT NULL,              -- [{ "claim": "...", "source_url": "...", "published_at": "..." }]
  status TEXT DEFAULT 'draft',           -- 'draft' | 'published'
  published_at TIMESTAMPTZ,
  view_count INTEGER DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (ai_persona_id, slug)
);

ALTER TABLE persona_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Published persona posts are viewable by everyone"
  ON persona_posts FOR SELECT USING (status = 'published' AND deleted_at IS NULL);
-- No insert/update/delete policies: written by service role (generation job + admin review) only.
```

---

## The Daily Ingestion Agent

`ingest-persona-content` — Supabase Edge Function on pg_cron, **daily**, service role.

Per active persona (`ai_personas.is_active = TRUE`), per active source:

1. **Cheap change check first.** RSS/YouTube: compare newest item GUID / `pubDate` against `last_item_published_at`. Web: compare HTTP `ETag`/`Last-Modified`, else hash the listing and compare to `last_listing_hash`. If nothing new → update `last_checked_at` and stop. This is the gate that keeps daily runs near-free.
2. **Fetch only new items** via FireCrawl (free, non-paywalled pages only; skip `is_paywalled`).
3. **Extract** structured signals with the Claude API into the `extracted` shape; upsert into `persona_content_items` (dedupe on `content_hash`). Store only a short `raw_excerpt` for traceability — never full article prose.
4. **Recompute `persona_context`** by synthesizing recent items + existing `persona_source_rankings` + the seed `style_profile`. Bump `version`, snapshot the prior version into `persona_context_versions`.
5. **Flag material changes.** If stances shifted meaningfully, set `last_material_change_at` — this is the trigger the content engine and `refresh-persona-lists` listen for.

```
for persona in active_personas:
  for source in persona.sources where is_active and not is_paywalled:
    if not source.has_new_content():        # ETag / pubDate / listing hash
        source.touch(last_checked_at); continue
    items = firecrawl.fetch_new(source)
    signals = claude.extract(items)          # → extracted JSONB
    upsert persona_content_items(signals)
  ctx = claude.synthesize(persona, recent_items, source_rankings, style_profile)
  if material_change(ctx, persona.context):
      snapshot(persona.context); persona.context = ctx
      persona.last_material_change_at = now()
```

**Cadence reconciliation.** The existing `refresh-persona-lists` cron (weekly in season / monthly off-season — see [02-TECHNICAL-ARCHITECTURE.md](../02-TECHNICAL-ARCHITECTURE.md)) regenerates the heavyweight persona *lists*. Keep it. `ingest-persona-content` becomes the cheap daily front door: it watches sources every day, and the expensive list regeneration still runs on its own cadence but now consumes fresh context and can be nudged early by a `last_material_change_at` flag. Net effect: daily freshness, no daily cost spike.

**Cost.** ~8 personas × a handful of sources, change-gated, means most days do zero FireCrawl/Claude work — especially off-season (now). Cost rises only when analysts actually publish (in-season Tue–Wed rankings drops). Add a per-run item cap as a safety valve.

### Implementation approach: deterministic pipeline vs. autonomous agent

"Agents vs. FireCrawl" is really a choice of *orchestration style* — FireCrawl only fetches and cleans a page, so an LLM (Claude) still has to turn that page into opinions either way. The two real options:

- **Deterministic pipeline (recommended for the daily hot path).** `persona_sources` → cheap change check → FireCrawl fetch of the known URL → one fixed Claude extraction call (low temperature, structured output) → `persona_content_items` → context synthesis. Predictable cost and latency, easy to cache, diff, and change-gate, fully auditable, and trivial to constrain to free/non-paywalled URLs (compliance + takedown). Weakness: no discovery — it only looks where told — and some sources (YouTube transcripts, podcasts) need small per-type adapters.
- **Autonomous agent (Claude with search/fetch tools).** The model decides what to search, read, and follow, then synthesizes. Strengths: discovery of new posts/sources, resilience to page-layout changes, one flexible loop for heterogeneous content. Weaknesses that matter here: non-determinism and hallucination risk — acute for an *attribution*-sensitive feature, where an agent could invent a stance or a citation — plus variable/higher cost and latency at daily × N personas, weaker compliance control (must hard-allowlist domains and block paywalls), and harder observability, testing, and change-gating.

**Recommendation: hybrid.** Run the deterministic pipeline daily over known sources (the 90% case — each persona has 1–3 stable feeds). Reserve agentic behavior for two narrow, infrequent, allowlisted, human-reviewed jobs: (a) **source discovery** — find or refresh a persona's `persona_sources` at setup or when one goes stale; (b) **investigation** — optionally gather corroborating context when a material change is flagged. This buys the agent's flexibility for discovery without putting a non-deterministic loop in the daily, cost-sensitive, attribution-critical path. Every stance lands in `persona_content_items` with a real `source_url` regardless of which path produced it.

---

## Use Case 1 — Grounding AI List Generation

No new UI; this extends the existing flow in [spec-ai-list-generation.md](spec-ai-list-generation.md). When a user selects a persona ranking style, the server route (`app/api/lists/generate/route.ts`) assembles the `{style_description}` slot from:

- the persona's seed `style_profile` (voice, biases — always present), **plus**
- the persona's current `persona_context` (`current_stances`, `recent_movements`, `themes_in_play`) where available, **plus**
- the latest `persona_source_rankings` for that position/scoring where a published list exists.

This makes a persona-styled list reflect what the analyst is *actually saying now*, with the persona firewall and "Generated by FieldScout AI" labeling unchanged. If `persona_context` is empty (persona not yet ingested), the flow degrades gracefully to `style_profile` only.

---

## Use Case 2 — Automated Content Engine

`generate-persona-content` — Edge Function, run on the persona-list cadence and/or triggered by `last_material_change_at` flags.

**What it produces**

- **Themed persona lists:** a persona-owned `lists` row (membership + order) tagged with the relevant system tag — e.g., "Top Busts for 2026" tagged `Busts`, "Sleeper WRs" tagged `Sleepers`. These automatically flow into the existing tag SEO feeds (`/tag/{slug}`).
- **Posts with justification:** a `persona_posts` row wrapping that list — persona-voiced title, a dek, original body prose explaining each pick, and a `citations` array linking the public sources behind each claim.

**Theme catalog.** Seed a small set of evergreen + seasonal themes (Top Busts, Sleepers, Breakouts, Post-Hype WRs, Rookie RBs to Target, Weekly Risers/Fallers in season). Store as config/constants; expand over time.

**Pipeline per theme × persona**

1. Pull the player data packet (reuse the assembly from [spec-ai-list-generation.md](spec-ai-list-generation.md)) + the persona's `persona_context`.
2. Claude generates the ranked membership + per-player justification + a short post body, in the persona's voice, citing `persona_content_items` source URLs.
3. Write the persona-owned `lists` row + `list_players` (Phase 1: text names in JSONB per [03-DATA-MODEL.md](../03-DATA-MODEL.md); resolved to `player_id` by `match-expert-players.ts`) + a `persona_posts` row with `status = 'draft'`.
4. **Review gate:** an admin view lists drafts; approve → `status = 'published'`, `published_at = now()`. (Phase 1 default. Trusted auto-publish is a later toggle.)

**Publishing surfaces & guardrails**

- Server-rendered, public, SEO routes: `app/(main)/personas/[username]/posts/[slug]/page.tsx` and the post appears on the persona profile and home/explore feeds.
- AI badge + persona disclaimer on every post (carried from [spec-ai-expert-personas.md](spec-ai-expert-personas.md)).
- Original prose only; visible "Sources" with outbound links; one-click takedown via `deleted_at`.

> **Heightened-sensitivity note.** Use case 2 synthesizes *opinions* into new posts, which is a step beyond the existing "mirror published rankings, original prose" posture. The parody name is the firewall: the take belongs to **"Bathew Merry (AI)"**, a fictional analyst, and is never framed as the real person's opinion. Justifications cite real public sources for the underlying facts (e.g., "target share fell to 18%"), not for invented quotes. Keep the draft→review gate until output quality and tone are trusted.

---

## SEO Integration

The pieces are already SEO-friendly (public lists, tag feeds, persona profiles are all server-rendered per [02-TECHNICAL-ARCHITECTURE.md](../02-TECHNICAL-ARCHITECTURE.md)). This feature adds:

- New indexable URLs: persona posts (`/personas/{username}/posts/{slug}`) and the themed lists they back.
- OG/Twitter meta tags and JSON-LD `Article` structured data on post pages.
- Sitemap entries for published posts; internal links from posts → backing list → player → tag feed.
- Themed lists tagged with existing system tags means content compounds on the `/tag/{slug}` pages people already search for ("2026 busts", "WR sleepers").

---

## Scripts & Jobs

- `scripts/seed-persona-sources.ts` — seed `persona_sources` for the v1 roster (free RSS/YouTube/site URLs per persona).
- `scripts/build-persona-context.ts` — on-demand context synthesis (Phase 0; the manual precursor to the daily cron).
- `supabase/functions/ingest-persona-content/` — daily, change-gated ingestion (Phase 1).
- `supabase/functions/generate-persona-content/` — themed list + post generation (Phase 1).
- Existing `refresh-persona-lists` — retained; now consumes `persona_context` and `last_material_change_at`.

All run with the service-role key, never from application code (player and persona/system data are read-only / system-written from the app's perspective).

---

## Phase Plan

**Phase 0 (now):**
- Migrations for `persona_sources`, `persona_content_items`, `persona_context`, `persona_context_versions`.
- Seed `persona_sources` for the v1 persona roster.
- `build-persona-context.ts` synthesizes an initial `persona_context` from existing/seed data — this delivers the "context file per influencer" immediately, runnable on demand. No cron yet.

**Phase 1:**
- `ingest-persona-content` daily cron (change-gated).
- Wire `persona_context` into the AI list generation route (`{style_description}`).
- `persona_posts` + `generate-persona-content` with the draft→review gate, plus the SEO post route.

**Later (in-season / scale):**
- Raise ingestion/generation cadence in-season; consider trusted auto-publish.
- If the context corpus grows large, add embeddings + retrieval instead of passing whole context.
- Feed persona post/list accuracy into the cred system ("beat the AI experts").

---

## Constraints & Open Decisions

1. **Daily check vs. cost.** Recommendation: change-gated daily (cheap check → conditional heavy work), not unconditional daily regeneration. Confirm this is acceptable vs. literal daily full refresh.
2. **Exact-mirror vs. synthesized opinion.** The existing personas mirror published rankings with original prose. Use case 2 synthesizes opinions. Recommendation: allow synthesized content but keep it strictly persona-attributed (parody firewall), cited, and behind the review gate. Confirm appetite here.
3. **Source coverage.** Each persona needs ≥1 reliable free source (RSS/site/YouTube). X/Twitter is best-effort only. Some analysts' best content may be paywalled and therefore off-limits — those personas will lean more on `style_profile`.
4. **Editorial human-in-the-loop.** Recommendation: required in Phase 1, optional later. Confirm who reviews drafts.
5. **Cost ceiling.** Set a monthly FireCrawl/Claude budget + per-run caps before enabling the daily cron.
6. **Product name.** All `/docs` use **FieldScout** / fieldscout.gg; this project is labeled **Hadouken**. This spec uses FieldScout to match the existing docs — flag if the rename should propagate.
7. **Ingestion implementation — pipeline vs. agent.** Recommendation: hybrid — a deterministic FireCrawl + fixed Claude extraction step in the daily hot path, with agentic discovery/investigation as occasional, allowlisted, human-reviewed add-ons. See *Implementation approach* under The Daily Ingestion Agent.

---

## Proposed Updates to Sibling Docs (not yet applied)

- **[02-TECHNICAL-ARCHITECTURE.md](../02-TECHNICAL-ARCHITECTURE.md)** cron table: add `ingest-persona-content` (daily, change-gated) and `generate-persona-content`; note both feed and complement `refresh-persona-lists`. Add new tables to the Core Tables overview.
- **[03-DATA-MODEL.md](../03-DATA-MODEL.md):** add `persona_sources`, `persona_content_items`, `persona_context`, `persona_context_versions`, `persona_posts` to the tables list.
- **[04-BUILD-ROADMAP.md](../04-BUILD-ROADMAP.md):** link this spec under Phase 0 (context store) and Phase 1 (ingestion + content engine).
- **[spec-ai-list-generation.md](spec-ai-list-generation.md):** note that `{style_description}` now incorporates live `persona_context`, not just `style_profile`.
- **[spec-ai-expert-personas.md](spec-ai-expert-personas.md):** cross-link; note persona content is broadened beyond exact ranking mirrors to context-grounded synthesized content under the same guardrails.

---

## Open Questions

1. Do automated persona posts count toward consensus rankings, or stay editorial-only? (Mirrors the open consensus-weight question in [spec-ai-expert-personas.md](spec-ai-expert-personas.md).)
2. Should users be able to *follow a theme* (e.g., "notify me when any persona posts new Busts") as an engagement hook?
3. How many personas and themes at launch — full v1 roster × full theme catalog, or a curated subset to control cost and review load?
