# AI Features Implementation Plan — FieldScout

**Version:** 1.0
**Date:** July 2, 2026
**Scope:** The four AI features specced in `docs/specs/` — AI Expert Personas, AI List Generation, AI Persona Content Engine, and Ask AI.
**Audience:** Chris + Claude Code (implementation).

---

## 0. How to read this document

This is the build plan that sits on top of the four AI specs. It does not restate them — it says, concretely, **what to build, in what order, and how the pieces fit the codebase as it exists today.** Each feature section maps spec requirements to real files, migrations, routes, and components, with a task checklist you can hand to Claude Code one milestone at a time.

The source specs (read these for the "why" and the product detail):

- `docs/specs/spec-ai-expert-personas.md` — the persona roster, parody-naming firewall, exact-mirror ranked lists.
- `docs/specs/spec-ai-list-generation.md` — user-triggered "Generate with AI" list builder (Pro).
- `docs/specs/spec-ai-content-engine.md` — the per-persona context store, daily ingestion job, and automated posts/SEO engine.
- `docs/specs/spec-ask-ai.md` — the natural-language research assistant (Pro).

---

## 1. Executive summary

All four features are **greenfield.** Nothing AI-related is built yet: there is no `ai_personas` table (migrations run through `019`), no Supabase Edge Functions directory, and neither the Anthropic SDK nor a FireCrawl client is installed. The good news is that the substrate the AI features lean on already exists — `profiles.is_pro` with race-safe free-tier enforcement, a service-role admin client, the Sleeper + stats data layer, and the `big_board_snapshots` snapshot pattern the specs reuse.

The four features are **not peers.** They form a dependency chain:

1. **AI Expert Personas** is the foundation. It defines *who* the AI analysts are and lands the tables (`ai_personas`, `persona_source_rankings`, `lists.ai_persona_id`) that two of the other three features build on. Build it first.
2. **AI List Generation** is the fastest path to a *visible, shippable* AI feature. It has no hard dependency on personas (it degrades to generic "Consensus" style), so it can ship in parallel — but it gets materially better once personas and their context exist.
3. **AI Persona Content Engine** is the heaviest feature: a context store, a daily change-gated ingestion job, and an automated content/SEO engine. It depends on Personas and enriches List Generation. Build it in slices.
4. **Ask AI** is the most self-contained and the most external-dependency-heavy (Vegas odds + live web search). It shares the Claude client and Pro-gate plumbing but otherwise stands alone. Build it last.

**Recommended production build order** (detailed in §8): a shared foundation milestone, then Personas → List Generation → the Content Engine in two slices → Ask AI, with a hard "ship to real users" line drawn after List Generation.

---

## 2. Current-state assessment

### 2.1 What already exists (and helps)

| Capability | Where | Why it matters for AI |
|-----------|-------|----------------------|
| `profiles.is_pro` + `subscription_status` | `001_initial_schema.sql` | Pro gating for List Generation and Ask AI can check this column today. |
| Race-safe free-tier caps | `018_free_tier_caps_enforcement.sql` | Established pattern for enforcing limits server-side; reuse for per-user AI rate/usage caps. |
| Service-role admin client | `src/lib/supabase/admin.ts` | System-written persona/content tables need service-role writes — client already exists. |
| Sleeper data client | `src/lib/sports-data/sleeper.ts` | Player pool, injury status, ADP for the data packets. |
| Stats layer | `src/lib/stats/fetch-weekly-stats.ts`, `aggregate-fantasy.ts` | Recent-form + prior-season inputs for data packets. |
| Scoring engine | `src/lib/scoring/default.ts`, `vorp.ts` | Fantasy-point context for rankings and Ask AI. |
| Snapshot pattern | `010_big_board_snapshots.sql` | Directly reused by `persona_context_versions` and persona list snapshots. |
| Dev Pro user | `NEXT_PUBLIC_DEV_AUTH_EMAIL=dev-pro@fieldscout.local` | Lets you exercise Pro-gated AI locally before Stripe exists. |

### 2.2 What's missing (build these)

- **Anthropic SDK + client.** No `@anthropic-ai/sdk` in `package.json`; no `src/lib/claude/`. The architecture doc anticipates `src/lib/claude/client.ts` and `persona-gen.ts` — neither exists.
- **FireCrawl client.** No dependency, no `src/lib/firecrawl/`.
- **Supabase Edge Functions.** No `supabase/functions/` directory. The persona crons (`refresh-persona-lists`, `ingest-persona-content`, `generate-persona-content`) are specced but unscaffolded.
- **Persona data model.** None of the persona tables exist.
- **AI env vars.** `.env.example` has only Supabase + app + dev-auth. Missing: `ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`, `THE_ODDS_API_KEY`, `SPORTS_DATA_API_KEY`.
- **Stripe.** `src/lib/stripe/.gitkeep` is an empty placeholder. Pro *purchase* is Phase 4 and not built — see the gating note in §2.4.

### 2.3 Doc-vs-reality drift (use the real conventions)

The plan below uses the **actual** codebase layout, which differs from the older architecture/CLAUDE docs in three places. Flag these so nobody codes to the stale paths:

- **Next.js 15**, not 14 (`next ^15.5.19`). App Router semantics are the same; nothing blocking.
- **App routes live at `src/app/app/…`**, not the `(app)` route group the architecture doc draws. API routes are at `src/app/api/…`. Public profiles at `src/app/u/[username]/…`, tag feeds at `src/app/tag/[tag]/…`.
- **Migrations continue from `019`.** New AI migrations start at `020`.

### 2.4 The Pro-gating caveat (important)

Two features (List Generation, Ask AI) are Pro-only. `profiles.is_pro` exists and can be checked on the server today, but **Stripe checkout is not built** (Phase 4). Two viable paths:

- **Recommended:** Gate on `is_pro` now. Ship the AI feature behind the gate and use the dev-pro user / manual `is_pro` flips (or an admin toggle) for early access and beta. Wire Stripe in its own Phase-4 workstream. This decouples "the AI works" from "billing works."
- **Alternative:** Block the AI features until Stripe lands. Slower to a demoable AI feature; not recommended given the goal of shipping to real users.

Either way, the server route is the enforcement point — never trust a client-side `is_pro`.

---

## 3. Shared AI foundations (build once — Milestone M0)

Every feature depends on this layer. Build it first as its own small milestone so the four features don't each reinvent the client, gating, and cost controls.

### 3.1 Anthropic client & model tiering

Add the official SDK and a thin wrapper.

```
npm install @anthropic-ai/sdk
```

Create `src/lib/claude/client.ts` — a singleton server-only client reading `ANTHROPIC_API_KEY`, plus helpers for the two calling patterns the features need. **Never import this into a client component.** All Claude calls run in route handlers, scripts, or Edge Functions.

**Model tiering** (use the cheapest model that clears the quality bar for each job — this is the single biggest cost lever):

| Job | Recommended model | Rationale |
|-----|-------------------|-----------|
| High-volume extraction (content-engine ingestion: page → structured signals) | **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) | Cheap, fast, runs per-source on every material change. |
| User-facing generation (List Generation, Ask AI, persona rationales, context synthesis) | **Claude Sonnet 5** (`claude-sonnet-5`) | The quality/cost workhorse for anything a user reads. |
| Highest-stakes editorial (auto-published persona *posts*, if/when trusted) | **Claude Opus 4.8** (`claude-opus-4-8`) | Reserve for the small volume of long-form synthesized prose where tone/accuracy matter most. |

Pin model IDs in one config module (`src/lib/claude/models.ts`) so upgrades are one-line changes.

### 3.2 Structured output (do this the reliable way)

Every AI feature here returns JSON that the app parses. Do **not** rely on "please return JSON" in the prompt. The Anthropic SDK now ships **native Structured Outputs (GA)** via the `output_format` parameter and Zod helpers (`zodOutputFormat` / `messages.parse()`), which grammar-constrains the model to your schema.

- Define each response schema once as a **Zod schema** in `src/types/schemas/` (the folder already exists) and reuse it for both the Claude call and runtime validation.
- Prefer native `output_format`; where a hosted feature (e.g., web search tool) isn't compatible with strict output formatting in the same call, fall back to a single forced tool-call whose input schema is the desired output (`tool_choice`), then validate with the same Zod schema.
- Always validate the parsed result again server-side before it touches the DB or the UI.

### 3.3 Pro gating helper

Create `src/lib/auth/require-pro.ts` — a server helper used by the Pro-gated routes:

```ts
// pseudocode
export async function requireProUser() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 }
  const { data: profile } = await supabase.from('profiles').select('is_pro').eq('id', user.id).single()
  if (!profile?.is_pro) return { error: 'Pro required', status: 402 }
  return { user }
}
```

Return `402 Payment Required` (or `403`) so the client can show an upgrade prompt cleanly. Mirror the friendly-pre-check + hard-backstop pattern already used for free-tier caps.

### 3.4 Cost controls (set these before the first paid call ships)

- **Per-user rate limits** on `/api/lists/generate` and `/api/ask` (e.g., N calls/day even for Pro) via Vercel edge middleware — the security section of the architecture doc already calls for rate limiting on mutation endpoints.
- **Per-run caps** on all batch/cron jobs (max items per persona per run) as a runaway safety valve.
- **Monthly budget ceiling** for Anthropic + FireCrawl + The Odds API, tracked in code (a spend counter table or the provider dashboards) with alerting.
- **Change-gating** for the content engine (see §6) so quiet days cost ~$0.
- **Token/latency logging** on every Claude call (model, input/output tokens, ms, feature) to a lightweight `ai_call_log` table or Sentry/PostHog, so cost is attributable per feature from day one.

### 3.5 Cron/job execution model

The specs assume **Supabase Edge Functions on `pg_cron`** for the persona jobs, run with the service role. Scaffold `supabase/functions/` and adopt that. Two practical notes:

- For the **on-demand, Phase-0 precursors** (seeding, one-shot context builds), write them as `scripts/*.ts` run with the service-role key — matching the existing `scripts/sync-players.ts` pattern — before promoting them to scheduled Edge Functions.
- If Edge Function + `pg_cron` setup proves heavy, **Vercel Cron hitting a protected route handler** is an acceptable equivalent for the daily/weekly cadence. Pick one and standardize; the spec's default is Supabase Edge Functions.

### 3.6 Environment variables to add

Append to `.env.example` and set in Vercel + Supabase:

```env
# AI
ANTHROPIC_API_KEY=
# Web scraping (persona source rankings + content ingestion, free non-paywalled only)
FIRECRAWL_API_KEY=
# Ask AI — Vegas lines (free tier)
THE_ODDS_API_KEY=
# NFL current/live stats (already anticipated by architecture doc)
SPORTS_DATA_API_KEY=
```

### 3.7 M0 checklist

- [ ] `npm install @anthropic-ai/sdk` and a FireCrawl client dep.
- [ ] `src/lib/claude/client.ts`, `src/lib/claude/models.ts`, `src/lib/claude/structured.ts` (Zod output helpers).
- [ ] `src/lib/firecrawl/client.ts`.
- [ ] `src/lib/auth/require-pro.ts`.
- [ ] Rate-limit middleware for AI routes; per-run caps constant module.
- [ ] `ai_call_log` (or telemetry hook) for token/cost logging.
- [ ] `.env.example` updated; keys set in Vercel + Supabase.
- [ ] Scaffold `supabase/functions/` (or decide on Vercel Cron) and document the choice.

---

## 4. Feature 1 — AI Expert Personas (foundation)

**Spec:** `spec-ai-expert-personas.md` · **Roadmap phase:** 0 → 1 · **Build order:** first (after M0).

### 4.1 What ships

A roster of ~8 fictional, parody-named analyst personas (e.g., *Bathew Merry (AI)*), each with a public profile, a structured `style_profile`, and a set of AI-generated ranking lists (Big Board + position lists) that **mirror the real analyst's published ranks exactly** while the prose is **always original and Claude-generated.** Personas give the app browsable content from day one and land the tables the other AI features build on.

### 4.2 Why first

`ai_personas`, `persona_source_rankings`, and `lists.ai_persona_id` are prerequisites for both the Content Engine (§6) and the persona-grounded path of List Generation (§5). Personas also validate the parody firewall, the FireCrawl scrape path, and Claude rationale generation — the same primitives every later feature reuses.

### 4.3 Data model / migrations

| Migration | Contents |
|-----------|----------|
| `020_ai_personas.sql` | `ai_personas` table (RLS: public SELECT where `deleted_at IS NULL`; no client writes). Add nullable `lists.ai_persona_id UUID REFERENCES ai_personas(id)`. Establish the **system expert owner** account/id (`system_expert_owner_id`) that owns persona lists — decide whether it's a seeded `profiles` row or a config constant, and document it. |
| `021_persona_source_rankings.sql` | `persona_source_rankings` (raw scraped ranks; **service-role only**, no client policies). |

Follow the schemas verbatim from the spec (columns, RLS comments). Key invariants: a list is persona-owned when `owner_id = system_expert_owner_id AND ai_persona_id IS NOT NULL`; `source_url` is stored on every scrape for traceability/takedown; soft-delete everywhere.

### 4.4 Backend & scripts

Personas are **system-written**, so the write paths are scripts/Edge Functions with the service role — not app API routes. Read paths are ordinary server components/routes.

- `scripts/seed-ai-personas.ts` — insert the roster rows (username, display name, bio + parody disclaimer, `style_profile` JSONB, avatar). Then generate initial lists via Claude (ranks from source where available, else `style_profile`), writing persona-owned `lists` rows. **Phase 0:** player entries stored as text names in JSONB per `03-DATA-MODEL.md`.
- `scripts/scrape-persona-sources.ts` — FireCrawl fetch of each persona's free, non-paywalled published rankings into `persona_source_rankings` (source URL + publish date).
- `supabase/functions/refresh-persona-lists/` — regenerate lists on the data-pipeline cadence (weekly in-season, monthly off-season), snapshotting prior versions (reuse `big_board_snapshots` pattern). Runs with service role.
- `src/lib/claude/persona-gen.ts` — the rationale-generation prompt builder: takes `style_profile` + the FieldScout player data packet, returns original per-player rationale + persona-voiced titles. **Ranks mirror the source; words are always ours.**
- **Phase 1:** `scripts/match-expert-players.ts` — resolve text names → Sleeper player IDs, insert `list_players` rows so persona lists can participate in consensus (weight 1, same as cred-0 users).

### 4.5 Frontend

- `src/components/personas/persona-badge.tsx` — the `AI` badge (shadcn `Badge variant="outline"` + bot icon) rendered anywhere a persona name appears (feed cards, list headers, consensus attribution, comments).
- `src/components/personas/persona-card.tsx` — profile card for explore/feed.
- `src/app/app/personas/[username]/page.tsx` — persona profile (server-rendered, public, SEO). Must show the fixed disclaimer: *"…is a fictional, AI-generated analyst persona. It is a parody and is not affiliated with or endorsed by any real person."*
- List detail footer: "Generated by FieldScout AI" on persona-owned lists.
- Personas can be followed but never initiate follows/DMs.

> **Path note:** the spec writes `app/(main)/personas/…`; use `src/app/app/personas/…` (or a public route under `src/app/` for SEO — decide alongside where `u/[username]` lives). Keep it server-rendered either way.

### 4.6 The parody firewall (non-negotiable, enforced in code + review)

- Real analyst names **never** appear in `username`, `display_name`, `bio`, list titles, or rationale text. The resemblance lives only in the swapped-letter parody name + ranking style.
- All generated prose is original; the analyst's written blurbs are never copied.
- Only free, non-paywalled sources are scraped; `source_url` retained on everything.
- Takedown = `is_active = FALSE` on the persona (or `deleted_at` on specific lists). Content leaves feeds/consensus/SEO immediately, no schema work.

Add a lightweight **lint/test** that scans generated persona content for the real-name blocklist before publish — cheap insurance for an attribution-sensitive feature.

### 4.7 Verification

- Seed script runs idempotently; personas render with badge + disclaimer.
- Scraped ranks match source order exactly on a spot-checked persona; rationales are original (blocklist test passes).
- Takedown flow: flip `is_active = FALSE` → persona disappears from all surfaces.
- RLS: anon can read personas + published lists; cannot read `persona_source_rankings`.

### 4.8 Checklist

- [ ] `020_ai_personas.sql` (+ `lists.ai_persona_id`, system owner decision documented).
- [ ] `021_persona_source_rankings.sql`.
- [ ] `scripts/seed-ai-personas.ts` with v1 roster + `style_profile`s.
- [ ] `scripts/scrape-persona-sources.ts` (FireCrawl).
- [ ] `src/lib/claude/persona-gen.ts` (original-prose rationales).
- [ ] `supabase/functions/refresh-persona-lists/` (cadence + snapshots).
- [ ] Persona UI: badge, card, profile page, disclaimer, list footer.
- [ ] Real-name blocklist test in CI.
- [ ] (Phase 1) `scripts/match-expert-players.ts` → consensus participation.

---

## 5. Feature 2 — AI List Generation (first shippable AI, Pro)

**Spec:** `spec-ai-list-generation.md` · **Roadmap phase:** 1 · **Build order:** second — this is the fastest path to a visible AI feature.

### 5.1 What ships

A "Generate with AI" modal (on My Lists / Big Board) where a Pro user picks **position, scoring format, ranking style, and player count**, and Claude returns an ordered list with a one-line rationale per player, plus a `style_note`. The result saves as a new list and opens in the editor for customization. It's a *starting point*, not an oracle.

### 5.2 Dependency posture (why it can move early)

List Generation depends only on **M0 (Claude client, Pro gate, structured output)** and a **player data endpoint**. It does **not** hard-depend on Personas: the "Consensus" and analytical-bias styles work with zero persona data. Persona styles (`Bathew Merry (AI)`, etc.) simply inject the persona's `style_profile` — and later its live `persona_context` (§6) — into the `{style_description}` slot, degrading gracefully to `style_profile`-only or generic when absent. **This means List Generation can ship right after Personas' `style_profile`s exist, and improve as the Content Engine lands.**

### 5.3 Data model / migrations

None required for the core feature (generated lists reuse the existing `lists` / `list_players` tables). Optional: an `ai_generations` log row per generation for analytics and abuse/cost monitoring (ties into `ai_call_log` from M0).

### 5.4 Backend

- `src/app/api/lists/generate/route.ts` — the core route:
  1. `requireProUser()` (M0) — else `402` with an upgrade payload.
  2. Rate-limit check (per-user/day).
  3. Assemble the **player data packet** (§5.5) for the requested position.
  4. Build the prompt from the spec template; fill `{style_description}` from the selected style (analytical bias config, or persona `style_profile` + `persona_context` + latest `persona_source_rankings`).
  5. Call Claude (Sonnet 5) with the Zod `output_format` schema; validate.
  6. Return structured JSON; **do not** auto-persist — the user saves explicitly.
- `POST /api/lists` (existing) handles the actual save when the user clicks "Save as New List."

### 5.5 Player data packet

Assemble server-side before the Claude call, reusing existing data layers:

- Name, team, position, age — Sleeper (`src/lib/sports-data/sleeper.ts`).
- Prior-season fantasy points (std / PPR / half) — stats layer (`src/lib/stats/*`) + scoring engine.
- Prior-season target share (WR/TE), carry share (RB), snap % — stats layer.
- Injury status, ADP — Sleeper.
- Strength-of-schedule for remaining games — Sleeper schedule + a SoS helper.

Factor this into `src/lib/claude/player-packet.ts` so **List Generation, the Content Engine, and Ask AI all share one packet builder.** Cache per (position, scoring, week) to avoid rebuilding on every call.

### 5.6 AI layer

- Prompt: the spec's template verbatim; enforce "exactly N players," "≤20-word rationale," "exclude IR," "stay true to the style."
- Output schema (Zod): `{ position, scoring, style, player_count, players: [{ rank, player_id, player_name, team, rationale }], style_note }`.
- Resolve `player_name` → `player_id` server-side against the player table (don't trust model-produced IDs); drop/repair any hallucinated players not in the pool.

### 5.7 Frontend

- `src/components/lists/generate-ai-button.tsx` — trigger with Pro gate (free users see it, get upgrade prompt on click).
- `src/components/lists/generate-ai-modal.tsx` — input form (position, scoring, style, count) + results preview with loading state (~3–5s).
- `src/components/lists/ai-player-row.tsx` — player row with rationale on hover/tap.
- Actions: "Save as New List" (→ opens editor) or "Close."

### 5.8 Gating & UX

- Server route is the gate. Free users: button visible, upgrade prompt on submit.
- Handle Claude latency with a real loading state; handle failures with a retry + graceful error (no blank modal).
- Every generated list is labeled AI-assisted and fully editable immediately.

### 5.9 Verification

- Pro user generates a 10-WR PPR list; ranks are sensible, rationales ≤20 words, no IR players, all `player_id`s resolve.
- Free user is blocked at the route (`402`) and sees the upgrade prompt.
- Persona style with no `persona_context` degrades to `style_profile` cleanly.
- Rate limit trips after the configured daily cap.

### 5.10 Checklist

- [ ] `src/lib/claude/player-packet.ts` (shared data-packet builder).
- [ ] `src/app/api/lists/generate/route.ts` (Pro gate + rate limit + Claude + Zod validation + ID resolution).
- [ ] Zod schema in `src/types/schemas/`.
- [ ] Modal, button, player-row components.
- [ ] Save flow reuses `POST /api/lists`.
- [ ] `{style_description}` assembly supports: analytical bias, persona `style_profile`, and (when present) `persona_context`.
- [ ] Loading/error/upgrade states.

---

## 6. Feature 3 — AI Persona Content Engine (context store + ingestion + content)

**Spec:** `spec-ai-content-engine.md` · **Roadmap phase:** 0 (context store) → 1 (ingestion + content) · **Build order:** third, in two slices. This is the heaviest feature — build it in slices, not one push.

### 6.1 What ships

Three connected capabilities:

1. **A living, cited "context file" per persona** (`persona_context`) — each analyst's *current* sourced stances, synthesized from ingested content.
2. **A daily, change-gated ingestion job** that keeps that context fresh cheaply.
3. **An automated content engine** that turns context into persona-voiced themed lists + posts with citations, seeding the feed and SEO before the human community scales.

It **enriches List Generation** (use case 1: live context fills `{style_description}`) and **produces platform content** (use case 2: automated posts/lists).

### 6.2 Build in slices

The spec itself splits Phase 0 (schema + on-demand builder) from Phase 1 (daily cron + content engine). Respect that hard — the value ladder is:

- **Slice A (Phase 0):** tables + an **on-demand** `scripts/build-persona-context.ts`. This alone delivers "a context file per persona," runnable manually, no cron. It immediately upgrades List Generation.
- **Slice B (Phase 1):** the daily change-gated ingestion cron.
- **Slice C (Phase 1):** the automated content engine (`persona_posts` + generation + draft→review→publish + SEO routes).

Ship A, prove it improves List Generation, then B, then C. Don't gate A on B/C.

### 6.3 Data model / migrations

| Migration | Contents |
|-----------|----------|
| `022_persona_context_store.sql` | `persona_sources`, `persona_content_items`, `persona_context`, `persona_context_versions`. **All service-role only** (no client policies) — operational/synthesized data, never served raw. |
| `023_persona_posts.sql` | `persona_posts` (published rows public via RLS SELECT; all writes service-role). Themed *lists* reuse `lists` (persona-owned, tagged with system tags like `Busts`). |

Use the spec's schemas verbatim, including the `extracted` and `context` JSONB shapes and the `UNIQUE (ai_persona_id, content_hash)` / `UNIQUE (ai_persona_id, slug)` constraints.

### 6.4 Slice B — the daily ingestion job

`supabase/functions/ingest-persona-content/` — daily on `pg_cron`, service role. Per active persona × active non-paywalled source:

1. **Cheap change check first** (the cost gate): RSS/YouTube compare newest GUID/`pubDate` vs. `last_item_published_at`; web compare HTTP `ETag`/`Last-Modified`, else hash the listing vs. `last_listing_hash`. Nothing new → touch `last_checked_at`, stop.
2. **Fetch only new items** via FireCrawl (skip `is_paywalled`).
3. **Extract** structured signals with **Claude Haiku 4.5** (low temperature, `output_format` schema) → upsert `persona_content_items` (dedupe on `content_hash`; store only a short `raw_excerpt`, never full prose).
4. **Resynthesize `persona_context`** from recent items + `persona_source_rankings` + seed `style_profile` (Sonnet 5). Bump `version`, snapshot prior into `persona_context_versions`.
5. **Flag material change** → set `last_material_change_at` (the trigger the content engine and `refresh-persona-lists` listen for).

**Implementation approach = hybrid** (per the spec's recommendation): a **deterministic pipeline** in the daily hot path (predictable cost, auditable, easy to change-gate and allowlist), with **agentic behavior reserved** for two narrow, infrequent, allowlisted, human-reviewed jobs — (a) source discovery at setup / when a source goes stale, (b) optional corroboration when a material change fires. Keep the non-deterministic loop out of the daily, attribution-critical path. Every stance lands in `persona_content_items` with a real `source_url` regardless of path.

**Cost:** ~8 personas × a few sources, change-gated → most days do zero FireCrawl/Claude work (especially off-season). Cost rises only when analysts actually publish. Enforce a per-run item cap.

### 6.5 Slice C — the automated content engine

`supabase/functions/generate-persona-content/` — runs on the persona-list cadence and/or when `last_material_change_at` fires. Per theme × persona:

1. Pull the shared player data packet (§5.5) + the persona's `persona_context`.
2. **Claude (Sonnet 5)** generates ranked membership + per-player justification + a short post body in the persona's voice, citing `persona_content_items` source URLs.
3. Write the persona-owned `lists` row + `list_players` (Phase-1 text names, resolved later) + a `persona_posts` row with `status = 'draft'` and a `citations` array.
4. **Review gate:** admin view of drafts → approve → `status = 'published'`, `published_at = now()`. Human-in-the-loop is the Phase-1 default; trusted auto-publish is a later toggle.

**Theme catalog:** seed a small evergreen + seasonal set (Top Busts, Sleepers, Breakouts, Post-Hype WRs, Rookie RBs, in-season Weekly Risers/Fallers) as config constants; expand over time.

### 6.6 Use case 1 wiring (context → List Generation)

No new UI. In `src/app/api/lists/generate/route.ts` (§5), when a persona style is selected, assemble `{style_description}` from `style_profile` **+** current `persona_context` (`current_stances`, `recent_movements`, `themes_in_play`) **+** latest `persona_source_rankings` for that position/scoring. Empty context → degrade to `style_profile`. This is the concrete payoff of Slice A.

### 6.7 SEO integration (Slice C)

- New indexable, server-rendered routes: persona posts (`/personas/{username}/posts/{slug}`) + the themed lists they back. (Use the actual public route base — align with where persona profiles live from §4.5.)
- OG/Twitter meta + JSON-LD `Article` on post pages; sitemap entries for published posts.
- Themed lists tagged with existing system tags compound on the `/tag/{slug}` feeds people already search.
- AI badge + persona disclaimer on every post; visible "Sources" with outbound links; one-click takedown via `deleted_at`.

### 6.8 Guardrails (heightened — this synthesizes *opinions*)

Use case 2 goes a step beyond "mirror published ranks, original prose": it synthesizes opinions into new posts. Keep the firewall tight — the take belongs to the fictional persona, never the real analyst; justifications cite real public sources for underlying **facts** (e.g., "target share fell to 18%"), never invented quotes; keep the **draft→review gate** until tone/quality are trusted. Reuse the real-name blocklist test from §4.6 on all generated posts.

### 6.9 Scripts & jobs summary

- `scripts/seed-persona-sources.ts` — seed `persona_sources` (free RSS/YouTube/site URLs per persona).
- `scripts/build-persona-context.ts` — on-demand synthesis (Slice A precursor to the cron).
- `supabase/functions/ingest-persona-content/` — daily change-gated ingestion (Slice B).
- `supabase/functions/generate-persona-content/` — themed lists + posts (Slice C).
- Existing `refresh-persona-lists` — retained; now consumes `persona_context` + `last_material_change_at`.

### 6.10 Verification

- Slice A: `build-persona-context.ts` produces a sensible `rendered_md` context file for a persona; List Generation with that persona reflects current stances.
- Slice B: on a day with no new source items, the run does **zero** FireCrawl/Claude calls (change-gate works). On a new item, `persona_content_items` gets one deduped row and `version` bumps only on material change.
- Slice C: a themed post lands as `draft` with citations resolving to real URLs; approval publishes it; it appears on the persona profile, feed, `/tag/{slug}`, and sitemap; takedown removes it everywhere.
- Cost: per-run caps and monthly ceiling enforced; token log attributes spend to this feature.

### 6.11 Checklist

- [ ] `022_persona_context_store.sql`, `023_persona_posts.sql`.
- [ ] `scripts/seed-persona-sources.ts`.
- [ ] `scripts/build-persona-context.ts` (Slice A — ship first).
- [ ] Wire `persona_context` into `/api/lists/generate` (§6.6).
- [ ] `supabase/functions/ingest-persona-content/` (Slice B — change-gate + Haiku extraction + Sonnet synthesis + snapshots).
- [ ] `supabase/functions/generate-persona-content/` + theme config (Slice C).
- [ ] Admin drafts review UI; publish flow.
- [ ] SEO post route + OG/JSON-LD + sitemap.
- [ ] Real-name blocklist test on posts; per-run caps + budget ceiling.

---

## 7. Feature 4 — Ask AI (research assistant, Pro)

**Spec:** `spec-ask-ai.md` · **Roadmap phase:** 9 · **Build order:** last — most self-contained, most external dependencies.

### 7.1 What ships

A natural-language research assistant. The user asks any lineup question — start/sit, waiver, trade eval, bye week, FAAB — and Claude returns **factor-by-factor analysis with confidence scores**, rendered as cards. It shows its work and refuses to force a single answer ("52% / 48% — coin flip, go with your gut").

### 7.2 Dependency posture

Self-contained: depends on **M0** (Claude client, Pro gate, structured output) and the **shared player packet** (§5.5), plus **two new externals** — The Odds API (Vegas lines) and **Claude's server-side web search tool** (live expert consensus). No persona dependency. This is why it's last: it introduces the most new integrations for a single feature and isn't a prerequisite for anything else.

### 7.3 Data model / migrations

None required (Ask AI is request/response, not persisted state). **Optional:** an `ask_ai_queries` log (question, detected type, players, latency, tokens, cost) for analytics, rate-limit accounting, and eval — recommended, ties into `ai_call_log`.

### 7.4 Data sources (assembled per player before the Claude call)

| Source | Provider | Notes |
|--------|----------|-------|
| Recent performance (last 4 weeks) | `player_stats` (own DB) | Via stats layer. |
| Injury status (current week) | Sleeper | Already integrated. |
| Defensive matchup grade | nflverse (opponent vs. position) | Precompute a matchup table on the stats cadence. |
| Vegas implied totals | **The Odds API** (free tier) | New dep: `THE_ODDS_API_KEY`; add `src/lib/odds/client.ts`. Cache per slate. |
| Expert consensus | **Claude web search tool** at query time | FantasyPros, Rotowire, ESPN, The Ringer, Rotoworld — constrain with `allowed_domains`. |
| Season-long value (ADP trend) | Sleeper / FantasyPros | Reuse packet builder. |

### 7.5 Backend

- `src/app/api/ask/route.ts`:
  1. `requireProUser()` + rate limit.
  2. Parse the question; extract/attach players (from text or manual search).
  3. Assemble the multi-source packet (§7.4), including a fresh Odds API pull.
  4. Call Claude (**Sonnet 5**) with the **web search tool enabled** (allowlisted domains) for live consensus, plus the packet as context.
  5. Return structured JSON (Zod-validated) → cards.
- `src/lib/odds/client.ts` — thin The Odds API wrapper with caching + graceful degradation if the key/quota is unavailable (feature still works, Vegas factor shows "unavailable").

> **Structured output + web search:** if the hosted web-search tool can't be combined with strict `output_format` in a single call, use the two-step fallback from §3.2 (search-enabled call to gather consensus, then a forced-tool-call/`output_format` call to shape the final JSON), or run consensus retrieval as a discrete step. Validate with the shared Zod schema regardless.

### 7.6 AI layer

- Prompt: the spec's template — classify question type first (**start/sit, waiver, trade, streaming, bye**), then adapt output (waiver → FAAB %, trade → both sides compared, etc.).
- Output schema (Zod): per-player `{ player, position, team, factors: [{ label, value, note }], summary, short_term_value, long_term_value }`, plus the highest-floor/ceiling pick with a 0–100 confidence and the explicit "close call → trust your gut" branch (within 10 pts).
- Emphasize **factor statements over verdicts** — this is a research assistant, not an oracle.

### 7.7 Frontend

- `src/app/app/ask/page.tsx` — the Ask surface.
- `src/components/ask/ask-input.tsx`, `scoring-selector.tsx`, `player-eval-card.tsx`, `confidence-meter.tsx`, `options-summary.tsx`.
- Free users: full interface visible, upgrade prompt on submit.
- Handle multi-second latency (web search adds time) with staged loading; degrade gracefully if a source (Odds/consensus) is unavailable.

### 7.8 Gating & cost

- Pro gate on the route. Ask AI is the **most expensive per call** (web search + larger context + Sonnet), so the per-user daily cap and budget alerting from M0 matter most here.

### 7.9 Verification

- Start/sit question returns two comparable player cards with factors, a confidence split, and a coin-flip branch when close.
- Waiver question adds a FAAB %; trade question compares both sides — question-type detection works.
- Odds API outage → Vegas factor degrades to "unavailable," rest of the answer still renders.
- Web-search consensus cites allowlisted domains only; free user blocked at route.

### 7.10 Checklist

- [ ] `src/lib/odds/client.ts` (+ `THE_ODDS_API_KEY`).
- [ ] Defensive-matchup precompute (nflverse) on the stats cadence.
- [ ] `src/app/api/ask/route.ts` (Pro gate + rate limit + multi-source packet + Claude web search + Zod validation).
- [ ] Zod schema; question-type detection in prompt.
- [ ] Ask page + card/meter/summary components; scoring selector.
- [ ] `ask_ai_queries` log (optional but recommended).
- [ ] Graceful degradation for each external source.

---

## 8. Recommended build order (optimized for shipping to real users)

The roadmap slots these across Phases 0/1/9. To get *working, production-safe AI in front of real users as fast as the dependencies allow*, sequence the work as the milestones below rather than by phase number. Each milestone is independently shippable.

### 8.1 Dependency graph

```
M0  Shared AI foundations ─────────────┬──────────────┬───────────────┐
                                        │              │               │
M1  Personas (style_profile + lists) ───┤              │               │
        │                               │              │               │
        ▼                               ▼              │               │
M2  List Generation (Consensus/bias) ◄──┘  ← SHIP #1   │               │
        ▲                                              │               │
M3  Content Engine Slice A (context store) ────────────┘               │
        │  (enriches M2)                                               │
        ▼                                                              │
M4  Content Engine Slice B (daily ingestion)                          │
        ▼                                                              │
M5  Content Engine Slice C (auto posts + SEO)                         │
                                                                       │
M6  Ask AI ◄───────────────────────────────────────────────────────── ┘  (needs only M0)
```

### 8.2 Milestones

| # | Milestone | Depends on | Ships to users | Why here |
|---|-----------|-----------|----------------|----------|
| **M0** | Shared foundations (§3) | — | No (infra) | Everything needs the Claude client, Pro gate, structured output, cost controls. Do it once. |
| **M1** | Personas: tables + `style_profile` + seeded lists (§4) | M0 | Yes — browsable persona content + badges | Unlocks persona styles for M2 and all tables for M3–M5. High content value, low risk. |
| **M2** | **List Generation** (§5) | M0, M1 (soft) | **Yes — first interactive AI. Draw the "real users" line here.** | Fastest visible AI payoff; self-contained; Pro-gated revenue hook. Works with Consensus/bias even if M1 slips. |
| **M3** | Content Engine Slice A: context store + on-demand builder (§6.2) | M1 | Indirectly (better M2 lists) | Cheap, no cron, immediately upgrades persona-styled generation. |
| **M4** | Content Engine Slice B: daily ingestion (§6.4) | M3 | Indirectly (fresher context) | Keeps context current; change-gated so near-zero cost. |
| **M5** | Content Engine Slice C: auto posts + SEO (§6.5) | M4 | Yes — SEO pages + feed content | The growth/SEO flywheel; behind an editorial review gate. |
| **M6** | **Ask AI** (§7) | M0 | Yes — second interactive AI | Most externals for one feature; not a prerequisite for anything, so it comes last. Can be pulled earlier if it's a priority — it only needs M0. |

### 8.3 Sequencing rationale

- **M0 before anything.** Resist building the Claude client inside the first feature; three features would fork it.
- **Personas before List Generation, but List Generation doesn't *block* on it.** If persona scraping/tuning takes longer than expected, ship List Generation with Consensus + analytical biases and add persona styles when M1 lands. This protects the "ship fast" goal.
- **Content Engine strictly after Personas and in slices.** Slice A is high-value/low-cost and improves an already-shipped feature (M2). Slices B and C add cost and moving parts — land them only once A proves the context format is right.
- **Ask AI last but movable.** It shares only M0, so it can jump ahead if it becomes the priority — at the cost of standing up Odds API + web-search plumbing sooner.
- **Pro billing is a parallel track.** Gate M2/M6 on `is_pro` now (dev-pro user + manual flips for beta); land Stripe (Phase 4) independently so AI progress never waits on billing.

### 8.4 A pragmatic "first real-user" cut

If the goal is the **smallest set that puts trustworthy AI in front of paying users before draft season:** **M0 + M1 + M2.** That's the Claude foundation, browsable persona content, and a working Pro "Generate with AI" flow — shippable without the ingestion cron, the content engine, or Ask AI. Everything after M2 is additive.

---

## 9. Cross-cutting concerns & risks

**Legal / IP (highest-attention).** The parody firewall is the core mitigation: fictional swapped-letter names, `(AI)` suffix, original prose only, free non-paywalled sources only, `source_url` on everything, one-click soft-delete takedown. Enforce the real-name blocklist in CI (§4.6) and keep the editorial review gate on synthesized posts (§6.8). Never ingest paywalled content. Personas are never claimable and never carry a real analyst's name.

**Cost.** Anthropic + FireCrawl + Odds API are metered. Controls (§3.4): per-user daily caps on interactive features, per-run caps on jobs, change-gating on ingestion, model tiering (Haiku for extraction), and a monthly ceiling with alerting. Ask AI is the priciest call; the Content Engine is the biggest *aggregate* risk if change-gating regresses — add a test that asserts a no-new-content run makes zero paid calls.

**Content quality / hallucination.** Structured outputs + server-side validation + resolving `player_name → player_id` against the real pool (drop hallucinated players). Deterministic pipeline in the daily hot path; agentic behavior only in allowlisted, reviewed, off-path jobs. Draft→review gate before any synthesized post publishes.

**Prompt injection from scraped content.** Ingested pages are untrusted input. Treat FireCrawl output as data, not instructions: extract with a constrained schema, never let scraped text steer tool use, and keep extraction on the cheap model with low temperature and no tools.

**Security / RLS.** Persona operational tables (`persona_sources`, `persona_content_items`, `persona_context*`, `persona_source_rankings`) are **service-role only** — no client policies. Only `ai_personas` (public read), published `persona_posts`, and persona-owned public `lists` are client-readable. All AI writes go through the service role in routes/scripts/Edge Functions, never the browser client. Zod-validate every route input.

**Observability.** Token/latency/cost logging per call from day one (§3.4); Sentry on all AI routes and jobs; PostHog events on generate/ask/publish. You can't manage AI cost or quality you can't see.

**Data-pipeline prerequisite.** List Generation and Ask AI need the Phase-0 player/stats pipeline populated (Sleeper + nflverse historical + current-season stats). Confirm the packet builder has real data before enabling either in production.

---

## 10. Open decisions (consolidated from the specs)

Resolve these as you reach each milestone; none block M0.

1. **Consensus weighting of AI content.** Do persona lists / automated posts count toward consensus rankings (weight 1, like cred-0 users) or stay editorial-only? (Personas + Content Engine specs both raise this.)
2. **Synthesized opinions appetite.** Content Engine use case 2 synthesizes opinions, not just mirrors ranks. Confirm the draft→review gate is acceptable and who reviews.
3. **Launch scope.** How many personas × themes at launch — full v1 roster × full theme catalog, or a curated subset to control cost and review load?
4. **Auto-publish.** When (if ever) to move persona posts from human-reviewed to trusted auto-publish.
5. **Ingestion cadence vs. cost.** Confirm change-gated daily (recommended) vs. literal daily full refresh; set the monthly budget ceiling + per-run caps before enabling the cron.
6. **Pro billing timing.** Gate AI on `is_pro` now vs. wait for Stripe (recommend: gate now, §2.4).
7. **Product name.** Specs/docs say **FieldScout** / fieldscout.gg; the repo is labeled **Hadouken**. Decide whether the rename propagates before public SEO pages (M5) ship.
8. **"Follow a theme" hook.** Optional engagement feature (notify on new Busts, etc.) — in or out for v1?
9. **Public route base for persona profiles/posts.** Reconcile the spec's `app/(main)/…` with the actual `src/app/…` layout so SEO routes are server-rendered and consistent with `u/[username]`.

---

## 11. Appendix

### 11.1 New dependencies

- `@anthropic-ai/sdk` (Claude client + structured outputs).
- A FireCrawl client (SDK or fetch wrapper) for `src/lib/firecrawl/`.
- The Odds API: no SDK needed — thin fetch wrapper in `src/lib/odds/`.

### 11.2 New environment variables

`ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`, `THE_ODDS_API_KEY`, `SPORTS_DATA_API_KEY` (add to `.env.example`, Vercel, Supabase).

### 11.3 Migration numbering (continues from `019`)

| Migration | Feature |
|-----------|---------|
| `020_ai_personas.sql` | Personas (M1) + `lists.ai_persona_id` + system owner |
| `021_persona_source_rankings.sql` | Personas (M1) |
| `022_persona_context_store.sql` | Content Engine (M3) |
| `023_persona_posts.sql` | Content Engine (M5) |
| `024_ai_call_log.sql` *(optional)* | Foundations telemetry (M0) — or fold into existing analytics |
| `025_ask_ai_queries.sql` *(optional)* | Ask AI (M6) analytics |

### 11.4 Key new code paths (actual codebase conventions)

```
src/lib/claude/           client.ts · models.ts · structured.ts · persona-gen.ts · player-packet.ts
src/lib/firecrawl/        client.ts
src/lib/odds/             client.ts
src/lib/auth/             require-pro.ts
src/app/api/lists/generate/route.ts        (List Generation)
src/app/api/ask/route.ts                    (Ask AI)
src/app/app/personas/[username]/…           (persona profiles/posts — confirm public SEO base)
src/app/app/ask/page.tsx                     (Ask AI surface)
src/components/personas/   persona-badge.tsx · persona-card.tsx
src/components/lists/       generate-ai-button.tsx · generate-ai-modal.tsx · ai-player-row.tsx
src/components/ask/         ask-input.tsx · player-eval-card.tsx · confidence-meter.tsx · options-summary.tsx
scripts/                   seed-ai-personas.ts · scrape-persona-sources.ts · match-expert-players.ts
                           seed-persona-sources.ts · build-persona-context.ts
supabase/functions/        refresh-persona-lists/ · ingest-persona-content/ · generate-persona-content/
```

### 11.5 Note on adjacent, unspecced AI

`02-TECHNICAL-ARCHITECTURE.md` references two AI endpoints with **no spec in `docs/specs/`**: `POST /api/ai/trade-recs` and `POST /api/ai/roster-moves` (trade recommendation + add/drop engines, Leagues-era). They're out of scope for this plan but reuse the same M0 foundation and the shared player packet — spec them before building.

