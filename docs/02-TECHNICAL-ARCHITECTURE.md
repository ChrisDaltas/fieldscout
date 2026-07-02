# Technical Architecture: FieldScout Fantasy Football

**Version:** 1.0
**Date:** March 29, 2026

---

## Architecture Decision: Single App (Monorepo)

FieldScout ships as a **single Next.js web application** in a **monorepo structure**. This is the right call for several reasons:

1. **Speed to ship.** One app, one deploy, one domain. No cross-app auth, no API gateway, no microservice orchestration.
2. **Claude Code works best** with a single codebase it can navigate end-to-end.
3. **Feature interconnections are deep.** Lists feed into rankings feed into teams feed into leagues. Splitting these into separate apps would create painful data-sharing problems.
4. **Monorepo allows future extraction.** If a mobile app or separate service is needed later, shared logic lives in packages that can be consumed by any client.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Framework** | Next.js 14+ (App Router) | Server components for SEO (profiles, consensus rankings), API routes for backend logic, great Claude Code support |
| **Language** | TypeScript | Type safety catches bugs before runtime. Claude Code writes better TS than JS. |
| **Styling** | Tailwind CSS + shadcn/ui | Utility-first CSS, pre-built accessible components, fast iteration |
| **State Management** | React Query (TanStack Query) + Zustand | React Query for server state (API data), Zustand for client state (UI state, drag state) |
| **Drag & Drop** | dnd-kit | Best React DnD library, works on touch, accessible |
| **Database** | Supabase (PostgreSQL) | Managed Postgres with auth, realtime subscriptions, row-level security, generous free tier |
| **Auth** | Supabase Auth | Email + Google OAuth, JWT-based, integrates with RLS |
| **File Storage** | Supabase Storage | Profile photos, list cover images |
| **Payments** | Stripe | Industry standard, great docs, webhook-based subscription management |
| **Hosting** | Vercel | Native Next.js hosting, edge functions, preview deploys on every PR |
| **AI/LLM** | Claude API (Anthropic) | Trade recommendations, roster analysis, expert ranking generation, natural language player insights |
| **NFL Player Data** | Sleeper API (free) | Player profiles, headshots, rosters, injury designations, ADP, schedules — no API key required |
| **NFL Historical Stats** | nflverse / nfl_data_py (free) | Open-source library for loading clean historical weekly + season stats (2022–present) into Supabase via one-time script |
| **NFL Current + Live Stats** | MySportsFeeds (launch) → SportsDataIO (scale) | Weekly final stats, live in-game scoring during games. MySportsFeeds (~$50–100/mo) for Year 1; upgrade to SportsDataIO ($500+/mo) when Pro revenue supports it |
| **Web Scraping** | FireCrawl API | Structured extraction of publicly available expert profile data (bios, social links, employer info) and published ranking lists from free, non-paywalled pages (AI persona pipeline input — see spec-ai-expert-personas.md) |
| **Email** | Resend | Transactional emails (welcome, weekly digest, notifications, profile claim verification) |
| **Analytics** | PostHog | Open-source product analytics, session replay, feature flags |
| **Error Tracking** | Sentry | Error monitoring and performance tracking |
| **CI/CD** | GitHub Actions | Automated testing, linting, deployment via Vercel |
| **Design** | Figma MCP | Figma design specs pulled directly into Claude Code for pixel-perfect component generation |

---

## Monorepo Structure

```
fieldscout/
├── CLAUDE.md                    # Project-level instructions for Claude Code
├── package.json                 # Root package.json (workspace config)
├── turbo.json                   # Turborepo config for build orchestration
├── .env.example                 # Environment variables template
├── .github/
│   └── workflows/
│       ├── ci.yml               # Lint, type-check, test on PR
│       └── deploy.yml           # Deploy to Vercel on merge to main
│
├── apps/
│   └── web/                     # The Next.js application
│       ├── CLAUDE.md            # App-specific Claude Code instructions
│       ├── next.config.js
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       ├── public/
│       │   ├── fonts/
│       │   └── images/
│       ├── src/
│       │   ├── app/             # Next.js App Router
│       │   │   ├── layout.tsx           # Root layout (nav, providers)
│       │   │   ├── page.tsx             # Landing page (logged out) / Explore (logged in)
│       │   │   ├── (auth)/
│       │   │   │   ├── login/page.tsx
│       │   │   │   ├── signup/page.tsx
│       │   │   │   └── callback/page.tsx
│       │   │   ├── (app)/               # Authenticated app shell
│       │   │   │   ├── layout.tsx       # App layout with sidebar/nav
│       │   │   │   ├── explore/page.tsx
│       │   │   │   ├── lists/
│       │   │   │   │   ├── page.tsx             # My lists
│       │   │   │   │   ├── new/page.tsx         # Create list
│       │   │   │   │   └── [listId]/
│       │   │   │   │       ├── page.tsx         # View/edit list
│       │   │   │   │       └── rank/page.tsx    # Ranking interface
│       │   │   │   ├── rankings/
│       │   │   │   │   ├── page.tsx             # Weekly rankings submission
│       │   │   │   │   └── consensus/page.tsx   # Consensus rankings view
│       │   │   │   ├── research/
│       │   │   │   │   └── page.tsx             # Player research table
│       │   │   │   ├── teams/
│       │   │   │   │   ├── page.tsx             # My teams
│       │   │   │   │   └── [teamId]/page.tsx    # Team detail
│       │   │   │   ├── leagues/
│       │   │   │   │   ├── page.tsx             # My leagues
│       │   │   │   │   └── [leagueId]/page.tsx  # League detail
│       │   │   │   ├── settings/
│       │   │   │   │   ├── page.tsx             # Account settings
│       │   │   │   │   ├── scoring/page.tsx     # Scoring systems
│       │   │   │   │   └── billing/page.tsx     # Pro subscription
│       │   │   │   └── notifications/page.tsx
│       │   │   └── u/
│       │   │       └── [username]/               # Public profile (SSR for SEO)
│       │   │           ├── page.tsx              # Profile page
│       │   │           └── lists/
│       │   │               └── [listSlug]/page.tsx  # Public list view
│       │   │
│       │   ├── components/
│       │   │   ├── ui/                  # shadcn/ui components
│       │   │   ├── layout/              # Nav, sidebar, footer
│       │   │   ├── lists/               # List-related components
│       │   │   ├── rankings/            # Ranking/tier components
│       │   │   ├── players/             # Player cards, search, etc.
│       │   │   ├── research/            # Research table components
│       │   │   ├── teams/               # Team components
│       │   │   ├── leagues/             # League components
│       │   │   ├── experts/             # Expert profile, hub, claim components
│       │   │   └── shared/              # Reusable components
│       │   │
│       │   ├── lib/
│       │   │   ├── supabase/
│       │   │   │   ├── client.ts        # Browser Supabase client
│       │   │   │   ├── server.ts        # Server Supabase client
│       │   │   │   └── middleware.ts     # Auth middleware
│       │   │   ├── stripe/
│       │   │   │   └── client.ts
│       │   │   ├── claude/
│       │   │   │   ├── client.ts        # Claude API for AI recommendations
│       │   │   │   └── persona-gen.ts   # AI persona rationale generation prompts
│       │   │   ├── firecrawl/
│       │   │   │   └── client.ts        # FireCrawl for expert bios + persona source rankings
│       │   │   └── sports-data/
│       │   │       └── client.ts        # NFL stats API client
│       │   │
│       │   ├── hooks/                   # Custom React hooks
│       │   │   ├── use-lists.ts
│       │   │   ├── use-rankings.ts
│       │   │   ├── use-players.ts
│       │   │   ├── use-scoring.ts
│       │   │   ├── use-experts.ts
│       │   │   └── use-auth.ts
│       │   │
│       │   ├── stores/                  # Zustand stores
│       │   │   ├── ui-store.ts
│       │   │   └── draft-store.ts
│       │   │
│       │   ├── types/                   # TypeScript types
│       │   │   ├── database.ts          # Generated from Supabase schema
│       │   │   ├── api.ts
│       │   │   └── scoring.ts
│       │   │
│       │   └── utils/
│       │       ├── scoring.ts           # Fantasy point calculation engine
│       │       ├── cred.ts              # Cred point calculation
│       │       ├── rankings.ts          # Consensus ranking algorithm
│       │       └── formatting.ts        # Display helpers
│       │
│       └── supabase/
│           ├── migrations/              # SQL migrations (version controlled)
│           ├── seed.sql                 # Dev seed data
│           └── functions/               # Supabase Edge Functions
│               ├── calculate-cred/      # Weekly cred calculation (cron)
│               ├── update-consensus/    # Consensus ranking updates
│               ├── sync-stats/          # NFL stats sync — slow cadence (cron)
│               ├── sync-live-stats/     # NFL live stats sync — 30s during game windows (cron)
│               ├── refresh-persona-lists/      # Refresh persona lists (consumes persona_context)
│               ├── ingest-persona-content/     # Daily change-gated source ingestion → persona_context
│               └── generate-persona-content/   # Automated persona posts + themed lists (SEO)
│
├── packages/
│   ├── shared/                          # Shared utilities & types
│   │   ├── src/
│   │   │   ├── scoring-engine.ts        # Fantasy point math (reusable)
│   │   │   ├── types.ts                 # Shared TypeScript types
│   │   │   └── constants.ts             # NFL teams, positions, etc.
│   │   └── package.json
│   │
│   └── ui/                              # Shared UI components (future mobile reuse)
│       ├── src/
│       └── package.json
│
└── docs/                                # Project documentation
    ├── 01-PRD.md
    ├── 02-TECHNICAL-ARCHITECTURE.md
    ├── 03-DATA-MODEL.md
    ├── 04-BUILD-ROADMAP.md
    ├── 05-CLAUDE-CODE-PROMPTS.md
    └── 06-API-DESIGN.md
```

---

## Database Architecture (Supabase / PostgreSQL)

### Key Design Decisions

1. **Row-Level Security (RLS) everywhere.** Every table has RLS policies. Users can only read/write their own data unless content is explicitly public.
2. **Soft deletes.** Lists, teams, rankings all use `deleted_at` timestamps rather than hard deletes.
3. **Materialized views for consensus.** Consensus rankings are computed via materialized views refreshed on a schedule, not calculated per-request.
4. **JSONB for scoring systems.** Scoring rules are stored as JSONB to support arbitrary stat-to-point mappings without schema changes.
5. **Player data is read-only.** NFL player/stat data is synced from external APIs into local tables but never modified by users.

### Core Tables Overview

See `03-DATA-MODEL.md` for full schema.

- `profiles` — User profiles, linked to Supabase auth
- `follows` — User-to-user follow relationships
- `lists` — Player lists (core entity)
- `list_players` — Players in a list with optional rank/tier
- `tags` — System and custom tags for list categorization
- `list_tags` — Junction table: lists ↔ tags
- `list_comments` — Threaded comments on lists
- `players` — NFL player data (synced from API)
- `nfl_games` — Game schedule, live game state (quarter, clock, status)
- `player_stats` — NFL stat data by week/season + live in-progress stats during games
- `scoring_systems` — Scoring rule definitions (system defaults + user custom)
- `teams` — Locked-in roster lists
- `team_lineups` — Weekly lineup selections for teams
- `leagues` — League definitions
- `weekly_rankings` — User-submitted weekly position rankings
- `cred_scores` — Calculated accuracy/cred data
- `start_sit_questions` — Start or Sit community questions
- `start_sit_votes` — Individual votes on Start or Sit questions
- `expert_profiles` — Real-name analyst profiles, claimable placeholders only (no AI content)
- `ai_personas` — Parody-named AI analyst personas (see spec-ai-expert-personas.md)
- `persona_source_rankings` — Raw scraped source rankings powering persona lists (service-role only)
- `persona_sources` — Per-persona content sources to monitor; drives daily ingestion (service-role only)
- `persona_content_items` — Ingested non-ranking opinion content with extracted signals (service-role only)
- `persona_context` — Living, cited per-persona knowledge layer (the "context files") (service-role only)
- `persona_context_versions` — Snapshots of persona context over time (service-role only)
- `persona_posts` — Automated persona-voiced posts/themed lists for SEO (published rows public)
- `expert_claim_requests` — Profile claim verification requests
- `subscriptions` — Stripe subscription status

---

## Authentication Flow

```
New visitor lands on fieldscout.gg
  → No auth required — dropped directly into interactive guest experience
  → Guest session ID generated and stored in localStorage
  → Guest Big Board state stored in localStorage (player list, order, view prefs)
  → Guest can freely add/reorder players, browse public content

Guest hits a persistence CTA ("Save this list", "Submit ranking", etc.)
  → Sign-up prompt appears (email or Google OAuth)
  → On account creation, trigger creates `profiles` row
  → State transfer function runs: migrates localStorage guest state to new profile
    (guest Big Board → real Big Board, any guest lists → user's lists)
  → localStorage guest state cleared
  → JWT stored in HTTP-only cookie (via Supabase SSR helpers)
  → Middleware checks auth on protected routes going forward
  → RLS policies use `auth.uid()` for data access

Returning user
  → JWT cookie present → middleware validates → user is authenticated
  → No guest state in localStorage → normal authenticated session
```

**Anonymous access rules:**
- `players` table: readable by anyone (authenticated or not) — required for guest experience
- `lists` (public): readable by anyone — required for SEO and guest browsing
- `consensus_rankings` view: readable by anyone
- All write operations (creating lists, submitting rankings, liking, following): require authentication

---

## Key Technical Patterns

### Server vs Client Components

| Server Components (default) | Client Components (`"use client"`) |
|-----|-----|
| Profile pages (SEO) | Drag-and-drop ranking interface |
| Consensus rankings (SEO) | List editing/player search |
| Research table initial load | Research table filters/sorting |
| List view pages | Real-time like/follow buttons |
| Landing page | Notification bell |

### API Routes (Next.js Route Handlers)

All mutations go through API routes at `app/api/`:

```
POST   /api/lists              — Create a list
PATCH  /api/lists/[id]         — Update a list
DELETE /api/lists/[id]         — Soft delete a list
POST   /api/lists/[id]/players — Add player to list
DELETE /api/lists/[id]/players/[playerId] — Remove player
PATCH  /api/lists/[id]/rank    — Update rankings/tiers
POST   /api/rankings/weekly    — Submit weekly rankings
POST   /api/teams              — Convert list to team
PATCH  /api/teams/[id]/lineup  — Set weekly lineup
POST   /api/leagues            — Create league
POST   /api/stripe/checkout    — Create Stripe checkout session
POST   /api/stripe/webhook     — Handle Stripe webhooks
POST   /api/ai/trade-recs      — Get AI trade recommendations
POST   /api/ai/roster-moves    — Get AI add/drop suggestions
GET    /api/experts             — List all expert profiles
GET    /api/experts/[slug]      — Get a single expert profile with rankings
POST   /api/experts/[slug]/follow — Follow an expert
POST   /api/experts/[slug]/claim  — Submit a profile claim request
POST   /api/experts/claim/verify  — Verify a claim (Twitter OAuth callback or email token)
```

### Real-time Features (Supabase Realtime)

Supabase Realtime broadcasts Postgres row-level changes to subscribed clients. Live Mode is the primary use case — `sync-live-stats` writes to `player_stats` every 30–60 seconds during games, and all connected Live Mode clients receive the update automatically.

| Feature | Realtime table/channel | Client behavior |
|---------|----------------------|-----------------|
| **Live Mode player stats** | `player_stats` (INSERT/UPDATE) | Update player card points + stats in-place |
| **Live Mode game status** | `nfl_games` (UPDATE) | Move player between Now Playing / Done / Up Next sections |
| **Start or Sit live preview** | `player_stats` (UPDATE) | Highlight leading player on open questions |
| **Notification badge** | `notifications` (INSERT) | Increment unread count in nav |
| **League chat** | `league_chat` (INSERT) | Append new message to chat |
| **Like counts** | `lists` (UPDATE on like_count) | Optimistic update already done client-side; Realtime syncs truth |

### Cron Jobs (Supabase Edge Functions + pg_cron)

The stats pipeline operates at **two speeds**: a slow cadence for offseason/non-game-day work, and a fast cadence during active NFL game windows.

**Game window detection:** A game window is active if any `nfl_games` row has `status = 'in_progress'` or a game kickoff is within the next 15 minutes. The `sync-live-stats` cron checks this on every tick and no-ops instantly when no games are live.

| Job | Schedule | Description |
|-----|----------|-------------|
| `sync-live-stats` | **Every 30 seconds** (game windows only) | Pull live in-progress player stats from API; update `player_stats` with latest play-by-play totals; update `nfl_games` status and game clock |
| `sync-stats` | Every 15 min during game day, daily otherwise | Pull final stats post-game; update season totals; roster/injury changes |
| `calculate-cred` | Tuesday 6am ET (after Monday Night Football) | Score weekly rankings + Start or Sit votes, award cred |
| `resolve-start-or-sit` | Tuesday 6am ET (runs with calculate-cred) | Determine correct Start or Sit answers, score votes |
| `update-consensus` | Every 30 minutes | Refresh materialized views for consensus rankings |
| `decay-cred` | Weekly (offseason) | Apply small decay to inactive users' cred scores |
| `refresh-persona-lists` | Weekly in season, monthly off-season | Re-scrape persona source rankings (FireCrawl), regenerate persona lists + rationales (Claude API), snapshot prior versions |
| `ingest-persona-content` | Daily (change-gated) | Cheap check for new free-source content per persona; on change, FireCrawl fetch + Claude extraction into `persona_content_items`, resynthesize `persona_context`, snapshot prior version (see spec-ai-content-engine.md) |
| `generate-persona-content` | Persona-list cadence + on material-change flags | Generate persona-voiced themed lists + posts with justification/citations into `persona_posts` (draft → review → publish) for SEO (see spec-ai-content-engine.md) |

> **Cost note:** `sync-live-stats` running every 30 seconds for ~17 hours per Sunday (plus TNF and MNF) = ~2,000 API calls per week during the season. SportsDataIO's live stats endpoint supports this; verify the pricing tier covers it before launch.

---

## Third-Party Integrations

### NFL Data: Three-Layer Strategy

No single API does everything FieldScout needs at an acceptable price point. The three-layer approach matches the best tool to each job and phases costs in as the product grows.

---

#### Layer 1 — Player Database: Sleeper API (Free)

The de facto standard for fantasy football app development. No API key, no auth, no cost.

**What it provides:**
- 6,000+ NFL player profiles (name, position, team, jersey number, status)
- Hosted player headshot images (CDN-served)
- Real-time injury designations (Questionable, Doubtful, Out, IR, PUP)
- Current roster assignments + free agent status
- NFL schedule (game dates, times, matchups, bye weeks)
- ADP (Average Draft Position) data

**What it does NOT provide:** live in-game stats, historical stat lines, weekly scoring

**Used for:** player search, player cards, injury alerts in Live Mode, schedule/game window detection, weekly ranking player pools

**Rate limit:** 1,000 calls/minute (well within app needs)

---

#### Layer 2 — Historical Stats: nflverse / nfl_data_py (Free)

Open-source community project. Run once, store in Supabase, never pay for historical data.

**What it provides:**
- Clean, structured weekly player stats from 1999 → present (updated within 24–48 hours of game completion)
- Season totals
- Play-by-play data (not needed for v1 but available)
- Roster history, draft data, combine results

**How it's used:** A one-time Python script (`scripts/load-historical-stats.ts`) pulls the last 4 seasons of weekly data via nfl_data_py and inserts it into the `player_stats` table. After that, the Research tab's historical data requires zero API calls — it reads from your own database. Re-run the script each Tuesday during the season to load the previous week's final stats.

**Installation:** `pip install nfl_data_py`

---

#### Layer 3 — Current Season & Live Stats: Paid API

The only layer that costs money, and only needed once the NFL season starts (September). Two-phase approach:

**Phase A — Launch year: MySportsFeeds (~$50–100/month)**
- Weekly final stat lines (current season)
- Live in-game scoring (paid tier, ~60-second update frequency)
- Play-by-play data
- Injury/status feeds
- Projections (for Live Mode "Up Next" projected points)
- Free for non-commercial development; 14-day free trial for commercial testing
- Good docs, well-maintained

**Phase B — Scale: SportsDataIO ($500+/month, contact for pricing)**
Upgrade when Pro subscription revenue justifies it.
- Live stats at 15–30 second update frequency (faster than MySportsFeeds)
- Pre-calculated fantasy points for Yahoo, DraftKings, FanDuel scoring systems (can skip client-side calculation for standard systems)
- BAKER Engine: weekly projections per player with scenario modeling
- DFS salary data, news feeds
- The gold standard for fantasy sports API data

**Note on custom scoring systems:** Regardless of which paid API you use, the `calculateFantasyPoints()` utility in `src/utils/scoring.ts` is always used for Pro users' custom scoring rules. The paid API raw stats feed into this engine.

---

#### Data responsibility matrix

| Data type | Source | Cost |
|-----------|--------|------|
| Player profiles, headshots, rosters | Sleeper API | Free |
| Injury designations, game schedule | Sleeper API | Free |
| Historical stats (2022–present) | nflverse (pre-loaded) | Free |
| Current season weekly final stats | MySportsFeeds → SportsDataIO | Paid |
| Live in-game stats (Live Mode) | MySportsFeeds → SportsDataIO | Paid |
| Weekly projections (Live Mode "Up Next") | MySportsFeeds → SportsDataIO | Paid |
| Custom scoring calculation | Internal engine (scoring.ts) | Free |

**Two API endpoint modes (paid API):**
- **/stats/live** — in-progress player stats, polled every 30–60s during game windows
- **/stats/final** — post-game final stats (used to reconcile any live discrepancies)

### Stripe Integration

- Checkout Sessions for initial subscription
- Customer Portal for plan management
- Webhooks for: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- Store `stripe_customer_id` and `subscription_status` on profiles table

### Claude API (AI Features)

- Trade recommendation engine: given two teams in a league, suggest fair trades
- Add/drop suggestions: given a team's roster and available players, suggest moves
- **Persona rationale generation:** given a persona's `style_profile` and scraped source rankings, generate original per-player rationale text and persona-voiced list titles, clearly labeled as AI-generated (ranks mirror the source; prose is always original — see spec-ai-expert-personas.md)
- Natural language player insights in Research tab (stretch goal for V1)

### FireCrawl (Expert Profiles + Persona Source Rankings)

FireCrawl gathers two kinds of publicly available data:

1. **Expert profile information** — employer/affiliation, Twitter/X handle, YouTube channel, podcast name, brief professional bio. Factual data points used to populate expert profile cards.
2. **Published ranking lists** from free, non-paywalled pages only — ingested into `persona_source_rankings` as input for the AI persona pipeline (see spec-ai-expert-personas.md). Persona lists mirror source ranks exactly; rationale prose and titles are always Claude-generated, never copied. Raw scrapes are service-role only and never served to clients. Paywalled or subscription content is never scraped. Non-ranking opinion content (articles, video and podcast notes) is ingested into `persona_content_items` by the daily `ingest-persona-content` job and synthesized into each persona's `persona_context` (see spec-ai-content-engine.md).

Analysts' written articles and analysis text are never reproduced. Source URLs are stored with every scrape, and any takedown request is honored via soft-delete (see spec-ai-expert-personas.md takedown process).

---

## Deployment Architecture

```
[Vercel] ← Next.js app (Edge + Serverless)
    ↓
[Supabase] ← PostgreSQL + Auth + Realtime + Storage + Edge Functions
    ↓
[SportsDataIO] ← NFL stats API
    ↓
[Stripe] ← Payment processing
    ↓
[Resend] ← Transactional email
    ↓
[Claude API] ← AI features + persona rationale generation
    ↓
[FireCrawl] ← Expert profile data + persona source ranking scraping
    ↓
[PostHog] ← Analytics
    ↓
[Sentry] ← Error tracking
```

### Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_PRO_MONTHLY_PRICE_ID=
STRIPE_PRO_ANNUAL_PRICE_ID=

# NFL Data
SPORTS_DATA_API_KEY=

# Web Scraping (expert profile data only — not content)
FIRECRAWL_API_KEY=

# AI
ANTHROPIC_API_KEY=

# Email
RESEND_API_KEY=

# Analytics
NEXT_PUBLIC_POSTHOG_KEY=

# Error Tracking
NEXT_PUBLIC_SENTRY_DSN=
```

---

## Performance Strategy

1. **Server-side rendering** for public pages (profiles, consensus) — SEO + fast first paint
2. **React Query** with stale-while-revalidate for list/ranking data
3. **Optimistic updates** for list edits, likes, follows
4. **Image optimization** via Next.js `<Image>` component for player headshots
5. **Database indexes** on: `list_players(list_id)`, `players(position, team)`, `weekly_rankings(user_id, week)`, `profiles(username)`
6. **Edge caching** via Vercel for public pages (ISR with 60s revalidation)
7. **Pagination** — all list endpoints paginated (20 items default)

---

## Security Considerations

1. **RLS on every table** — no data leaks via direct Supabase client access
2. **API route validation** — Zod schemas on all API inputs
3. **Rate limiting** — Vercel edge middleware rate limits on auth and mutation endpoints
4. **CSRF protection** — built into Next.js server actions
5. **Content Security Policy** — strict CSP headers
6. **Stripe webhook verification** — always verify webhook signatures
7. **SQL injection prevention** — parameterized queries via Supabase client (never raw SQL interpolation)

---

## Figma ↔ Code Workflow

Since Chris is designing in Figma and building with Claude Code:

1. **Design in Figma** → export component specs via Figma MCP
2. **Claude Code reads Figma specs** → generates Tailwind + shadcn/ui components
3. **Iterate:** update designs in Figma → Claude Code updates code to match
4. **Design tokens:** Figma variables (colors, spacing, typography) → Tailwind config
5. **Component library:** shadcn/ui as the base, customized via Tailwind to match Figma designs
