# Architecture Plan — Next Phase (Duel, Highlights & Watch, Player Profiles v2, Manager Profiles & Versus)

Oct 18, 2026 · Architect pass · **DRAFT for Chris's review — no code until approved**

> **The PRDs win.** The source of truth is `spec-next-phase-index.md`, `spec-duel.md`, `spec-highlights-watch.md`, `spec-player-profiles.md` and `spec-manager-profiles-versus.md`. Where this plan and a PRD disagree, the PRD wins. This plan only chooses *how* to build what the PRDs say (table names, jobs, file layout, order). Anything that would change what a user sees or what the rules are is **not decided here** — it is filed in §4 as a question with a recommendation.
>
> **Measured at:** `origin/main` @ `1938191` (2026-10-21; first drafted against `8265752`, 2026-10-18, then refreshed). Since the draft, main gained migrations **197–201** (197 cred starts at 7; **198 player news** — `player_news` + `player_news_players`, a free name matcher and a 30-minute pg_cron ping, which Highlights reuses (C43); 199 retire schema removed; 200 bye players never locked; 201 lineup saves never refused) and pgTAP 147–151, plus PR #391 (the M7 breakdown) and ~55 mobile-restyle and league-fix PRs. **The active build is now M7 — Hardening & GA** (approved 2026-10-19), not M8 (C37, NP-Q1). Open PRs: M7 tasks #520–#524 and #527, docs #180. **Next free migration 202, next free pgTAP 152** — re-measured at every task start (§6.6).
>
> **Measured figures.** The hosted-database numbers in this plan (the playoff rows, Puka Nacua's 2025 line, the `players` counts, the database size) were re-measured by the orchestrator on 2026-10-21 with read-only SQL against the hosted project and are marked *(measured 2026-10-21)*. Anything still marked *(reported)* came from the research pass and is re-measured (query + environment + date recorded in PROGRESS) by the task named next to it before anything depends on it.
>
> **Product name, branding and domains are unchanged.** "Duel" is an internal working name. **Duel stays free.** No paid service is adopted by this document; §5 only proposes them for Chris's approval.

---

## 0. TL;DR for Chris

**What we found.** Most of what these four features need is already in FieldScout — the stats pipeline, the scoring engine, the job scheduler, the league records, the player view. The big exception is Duel: the free stats feed we use today (Sleeper) only gives each player's **weekly totals** (and its responses were cached for 5 minutes when we recorded them on 2026-09-27). It has no quarters and no "Q2 just ended" signal. Duel can't run live on it. Everything else can be built on free data.

Three other things worth knowing up front:

- **There's a live bug in the launched app.** Last season's numbers include playoff games. Puka Nacua's 2025 shows 2,047 receiving yards when his regular season was 1,715 — the extra 332 are his three playoff games *(measured 2026-10-21 on the hosted database)*. The hosted `player_stats` table holds playoff rows for every loaded season: 240 (2022), 247 (2023), 254 (2024) and 314 (2025), stored as weeks 19–22 *(measured 2026-10-21)*. The cause is in the repo: the history loader keeps every week nflverse returns, playoffs included (`scripts/load-historical-stats.py:106-116` never filters `season_type`; upsert on `player_id,season,week` at `:146`). That's in the Stats table (which opens on last season), the Lists stat columns and the player view. It's exactly the bar argument the Player Profiles PRD is about, and fixing it takes a few lines.
- **Leagues only last one season today.** There's no "renew league" button, so "all-time" records, rivalries and "pick a season" can only ever show this season until we build renewal or import. None of the PRDs mention renewal, so whether to add a commissioner "Renew league" is your call (NP-V1). If you want it, it has to ship before next draft season.
- **Playoff games can't be stored yet.** We drop playoff games from the schedule and from stats. Running Duel "through the playoffs" needs one shared fix before wildcard weekend.

**Recommended build order — biggest impact for the lowest cost first.** I checked this order against everything the research found in the code. It holds, with one addition at the top.

> **Pending your answer to NP-Q11.** You asked for one milestone at a time, starting with the Duel data spike. This order puts the playoff-stats fix and setup first, and §6.6 runs up to three tracks side by side. Neither happens unless you say yes to NP-Q11; if you say no, the build starts with the Duel data spike (D-M0) and runs one milestone at a time.

| # | What | Who sees it | Cost | Why here |
|---|---|---|---|---|
| 1 | **Fix "last season counts the playoffs"** (P.1.0) | Everyone, today | A few lines, no new data | Live bug in the launch surface |
| 2 | **Build setup**: flags, nav slots, build ledger (X.0–X.3) | Nobody yet | Small | Unblocks every track |
| 3 | **Highlights on the player view + NFL team page** (H1–H2) | Everyone | Low: free YouTube API, reuses our YouTube feed reader | First new feature people will notice, no league needed |
| 4 | **Duel data spike + $0 engine** (D-M0) | Nobody yet | Low until a feed is bought | The one big unknown; starts on day one, in parallel |
| 5 | **Single-game Duel vs bots, then vs friends** (D-M1 → D-M4) | Friends cohort first (your call, NP-Q3) | Medium + a paid feed | The headline new game, live by the playoffs if the feed is approved soon |
| 6 | **Playoff weeks stored as weeks 19–22** (X.5) | Indirect | Medium, touches ingest | Hard deadline: before wildcard weekend |
| 7 | **League highlights + the Watch tab** (H3–H4) | League cohort / everyone | Medium | Watch has no design yet |
| 8 | **Player Profiles v2**: history, leaderboards, claims, compare, share cards (P1–P4) | Everyone | Medium, all free nflverse data | Lives in the player modal people already use |
| 9 | **Versus + manager profile (+ renewal if you want it, NP-V1)** (V1–V4) | League cohort | Low for Versus, the data already exists; renewal, if ruled in, is the one large careful task | Must exist before next draft season |
| 10 | **Public SEO pages** (H5, P5) | Search engines | Low technically | Waits on your public-player-page ruling |
| 11 | **Quick Match/ratings and Sunday Duel** (D-M5–M6) | Duel players | Higher, lots of rulings | Built in Phase 2, played from Week 1 of next season |
| 11b | **Skill rank and history import** (V5–V6) | League cohort | Higher, lots of rulings | Phase 2, last, but still before next draft season (the index puts import there) |
| 12 | **Duel Week, brackets, live modes** (Phase 3) | Next season | Outline only | Per the index |

**What has to be decided or confirmed before build starts.** Eight items. Everything else can wait for its own milestone.

1. **Approve this plan**, and say how it shares the one local database with **M7 Hardening & GA**, which you approved on 2026-10-19 and which is in build now (its DB lane is rate limits → chaos drills → security fixes; its other lanes need no database). M8 also still has three open tasks. NP-Q1 has my recommendation. Also say whether we can start with the playoff-stats fix and setup and run up to three tracks at once, or go strictly one milestone at a time from the Duel spike, as you first asked (NP-Q11).
2. **A spike budget for a live Duel feed.** My recommendation is up to about $25 for one month on the cheapest trial (Tank01), a free SportsDataIO Replay account and a request for their quote. No account gets opened until you say so (NP-Q2, §5.1).
3. **Create the YouTube API key** in a Google Cloud project you own. This blocks Highlights (§5.2).
4. **Public player pages: yes or no?** On 2026-10-04 you ruled that player links open the modal and there's no public player page. Both new PRDs want public pages for search traffic. My recommendation: public pages live outside the app, and inside the app clicks still open the mini card, then the full view (NP-Q4).
5. **"Last season" = regular season only, everywhere?** This is the item #1 fix (NP-P1).
6. **Who gets Duel first, everyone or a friends list?** Today's feature switches are all-or-nothing for the whole site. A friends-only release needs a small beta list you control from Admin (NP-Q3).
7. **Confirm the Supabase plan** (Free or Pro). It decides how many people can watch live at once and how much history fits: the hosted database is already **447 MB** *(measured 2026-10-21)* against the Free plan's 500 MB (§5.5).
8. **Duel on phones**: build phone and web together for Duel (an exception to "web first"), and decide where Duel and Watch sit in the phone bar (NP-Q5, NP-Q6).

**The one hard dependency** is a **live feed with per-quarter player stats and quarter start/end events, updated at least every 15 seconds**. No free official source has it. The Sleeper feed is weekly totals, nflverse is next-day, and ESPN's endpoints are unofficial and their terms bar automated access. We can build and fully test the Duel engine for $0 on replayed past games. Going *live* needs a paid vendor you approve. If the feed isn't chosen by about mid-December, single-game Duel can't be live for the playoffs, and the fallback is a vs-bot and friends "replay" of past games, or waiting until next season.

---

## 1. What already exists that each PRD builds on

### 1.1 Duel

| Group | What exists | Path | How Duel uses it |
|---|---|---|---|
| Schema | `nfl_games` (nflverse ids, `kickoff_at`, `status`, unused `quarter`/`game_clock`, `operator_hold`) | `001_initial_schema.sql:84-98`, `184_game_status.sql:132-142` | `duel_slate_games` reference it; lock = first `kickoff_at` read at evaluation time; postponed games via `operator_hold` |
| Schema | `nfl_weeks` calendar (first kickoff, last game end, correction window) | `039_nfl_weeks.sql:42-55`, `158` | Tuesday slate generation |
| Schema | `player_weekly_projections` (Sleeper, hourly) | `136_player_weekly_projections.sql` | Auto-plan, bots, M6 pricing — no new projection source |
| Schema | `system_flags` (`stats_degraded`, poll instants) | `122_system_flags_and_deferral.sql:99-115` | New key `duel_stats_degraded` → "changes paused" banner |
| Schema | `notifications` + generic `notify_league_member_internal(user, type, title, body, data)` | `001:540-551`, `063:353-375` | Duel notifications (in-app bell, 60 s poll) |
| Stats pipeline | `StatsProvider` contract (5 methods, `core_box` tier; `ProviderGameState` has optional quarter/clock; stat lines are weekly) | `src/lib/leagues/stats/stats-provider.ts:35-83` | Extended additively with a period capability |
| Stats pipeline | `SleeperStatsProvider` (weekly totals, `season_type=regular` at `:182`; capabilities `core_box` only at `:253`; no quarter/clock in `getGameStates` at `:280`; `getInactives` returns `[]` at `:337-350`). The 5-minute cache is a recorded response header, not code: `cache-control public, s-maxage=300`, measured 2026-09-27 by L.E1.26 with plain curl (`src/lib/leagues/stats/fixtures/sleeper-def-yards-allowed-2026.json:2`) | `sleeper-stats-provider.ts:182,253,280,337-350` | **Cannot** serve Duel live; stays the weekly cross-check |
| Stats pipeline | `NflverseProvider` (kickoffs, game ids, T+1 inactives; drops non-REG rows) | `nflverse/nflverse-provider.ts:83-90,153-175,292-298` | Slate inputs; its release base also hosts play-by-play (unused today) → free quarter replay fixtures |
| Stats pipeline | Canonical calculator + `scoreStarter` composition; `CORE_OFFENSE` (= the PRD's PPR list, not exported) | `scoring/calculator.ts:45-96`, `score-week-worker.ts:414-433`, `scoring/templates.ts:102-116` | Duel scores quarters with the same engine (`DUEL_RULES` = ESPN Full PPR offensive keys) |
| Stats pipeline | `scoreWeeklyProjection` | `scoring/player-values.ts:236-274` | Projected Duel points |
| Stats pipeline | Replay harness: `TimeProvider`/`VirtualClock`, `FixtureReplayProvider`, `RecordingStatsProvider`, `SyntheticStatsProvider` (already derives a quarter), fixtures `fixtures/nfl/2025/wk02`, `2026/wk02`, `2026/wk03` | `src/lib/leagues/time/`, `stats/fixtures/`, `stats/synthetic/synthetic-stats-provider.ts:280` | The PRD's "build a replay harness early" largely exists; Duel adds period methods (format v2) |
| Jobs | `cron_ping_route` (pg_cron + pg_net → Vercel route); `sync-live` route (maxDuration 60, 20 s cadence in a 45 s budget) | `124_cron_ping_and_stall_check.sql:312-352`, `src/app/api/cron/sync-live/route.ts:53-78`, `src/lib/sync/live-poll.ts:86-101,434` | Template for a separate `/api/cron/duel-live` |
| Jobs | `draft_tick` (pure SQL, every 5 s, SKIP LOCKED, heartbeat with `clock_timestamp()`) | `068_draft_tick_autopick.sql:657-729,1212-1216,1265` | Template for `duel_tick` (windows, reveals, locks) |
| Jobs | DB-enforced rule exemplar (row lock + BEFORE trigger, `ENABLE ALWAYS`) | `154_one_start_per_week.sql:296-457` | "≤ 2 quarters per player", "≤ 1 QB", swap budget, four-quarter rule |
| Jobs | In-RPC per-user caps; AI daily quota; **M7 L.F2.6 "Rate limits" (FULL, first on M7's DB lane, not started)** | `102_mock_slot_choice.sql` (HEAD of `create_mock_draft`), `074_ai_generation_quota.sql`; `tasks-M7-hardening-ga.md:102-106` (chat 5 msgs/10 s, mutations 10/10 s/league, bids 5/s) | Pattern only today; L.F2.6 is where the shared limiter should be born, and X.8 reuses it (C42) |
| Jobs | M8 operator console + `job_pauses` (CHECK limited to league jobs) | `183_job_knobs.sql:89-125`, `186` | Freeze/void a slate; new jobs show in `op_platform_state` automatically |
| UI shell | Realtime spines `use-league-channel`, `use-draft` (clock offset); budget pin | `src/hooks/use-league-channel.ts`, `use-draft.ts:177-208`, `src/components/draft/single-room-tab.test.ts:94-126` | `use-duel-channel` = third spine, a reviewed budget event |
| UI shell | Draft room ops (pick clock, available players, auction budget mirror, recap, pause overlay, one-tab guard) | `src/components/draft/*-ops.ts`, `draft-recap.tsx`, `pause-overlay.tsx` | Composed into Duel screens; `draft-room.tsx` itself is not forked |
| UI shell | Player card → mini card → modal; `PlayerLink`; mobile shell/sheets; `ByLayout`; flags | `src/components/players/*`, `src/components/mobile/*`, `src/lib/feature-flags.ts` | Usage meter = a card variant; change sheet = `MobileSheet` |
| UI shell | `/join/[token]` pre-auth claim | `src/app/join/[token]/page.tsx`, `062:638,767` | Challenge links `/duel/c/[token]` |

### 1.2 Highlights & Watch

| Group | What exists | Path | How Highlights uses it |
|---|---|---|---|
| Data providers | YouTube Atom/RSS reader (free, no key) with watermarks; persona ingest engine | `src/lib/personas/feeds.ts:80,143,165-190`, `src/lib/personas/ingest.ts` | Moved to `src/lib/feeds/` (re-exported) for the free "what's new" check; Data API only for details |
| Data providers | oEmbed title lookup; URL helpers | `src/lib/lists/youtube-title.ts:73-112`, `src/utils/youtube.ts:15-36` | Error-shape template; ids/thumbnails |
| Schema | `players` (Sleeper id, `search_name`, `team`, `college`, `experience_years`; no slug/gsis/nickname; only fantasy-relevant active players) | `001:54-75`, `002:12-21`, `034:10`, `src/lib/sports-data/sleeper.ts:90-98` | Match dictionary (loaded with `pageAll`) |
| Schema | `league_week_player_points`, `league_rosters`, `player_stats` (public), `nfl_games` | `158:208-240`, `072:136-153`, `005` | "My players", league rows, points badges, recap linking |
| Stats pipeline | Player-view scoring (ESPN Standard default, canonical engine) and pool standings, cached 300 s | `src/lib/players/core-stats-ops.ts:66-88`, `core-stats-service.ts:139-217`, `api/players/[id]/core-stats/route.ts:23-40` | Watch points; shipped in 195/#446, this now lives in `preset-scoring.ts`. Never the legacy `src/lib/scoring/default.ts` |
| Stat Center & player view | `PlayerView`/`PlayerBody`, `PlayerDetailHeader`, mobile profile tabs | `player-detail-page-view.tsx:158-253`, `player-detail-header.tsx`, `mobile-player-profile.tsx:150,316-325` | Rows go between `SeasonTable` and `SectionToggles`; play button is a header prop |
| League & team pages | Team page + lineup editor, matchup view, league home, waiver table; in-app NFL team page | `src/components/leagues/team-page.tsx`, `matchup-view.tsx`, `league-home-season.tsx`, `players-page.tsx`, `src/app/app/(shell)/nfl/[team]/page.tsx` | H2/H3 surfaces |
| Jobs | Vercel crons (daily only on Hobby), pg_cron hourly ping template | `vercel.json`, `136:146-151` | One hourly ping; the route decides game-day vs nightly |
| UI shell | Admin console gate + persona-post review queue | `src/app/app/(shell)/admin/`, `src/lib/auth/require-admin.ts` | Low-confidence match review |
| UI shell | Public page pattern (`/u/[username]`, `GuestShell`), sitemap (personas only), Article JSON-LD with `<` escaping | `src/app/u/[username]/page.tsx`, `src/app/sitemap.ts`, `src/app/personas/[username]/posts/[slug]/page.tsx:120-146` | SEO pages |
| UI shell | `MobileSheet` (grab handle is decorative), Dialog primitive | `src/components/mobile/ui/mobile-sheet.tsx:9,40-42`, `src/components/ui/dialog.tsx` | The one new `VideoPlayerSheet` (needs your OK) |

There is **no** `videos` table, no Data API client, no iframe player, no ISR, no `robots.ts`, and no analytics/event capture.

### 1.3 Player Profiles v2

| Group | What exists | Path | How Profiles uses it |
|---|---|---|---|
| Schema | `players` (3,273 rows, 1,829 `Retired`, 11 distinct `status` values *(measured 2026-10-21, hosted)*; `draft_*` columns exist but nothing writes them) | `001:54-78`, `sleeper.ts:195-229` | Header; not widened with historical players |
| Schema | `player_stats` 2022–2025 + live 2026; **playoffs stored unlabelled as weeks 19–22** by the history loader. This overturns the orchestrator note "regular season weekly only": `load_weekly` (`:106-111`) applies no `season_type` filter, the row builder (`:161-195`) keeps every week, and the upsert is on `player_id,season,week` (`:146`), so POST weeks land as 19–22 | `001:116-172`, `scripts/load-historical-stats.py:106-195` | "This season" only; history moves to a new warehouse |
| Schema | `player_usage`, `scoring_templates`, `ai_generation_usage` (feature TEXT) | `036`, `058`/`templates.ts:289-361`, `074:40-52` | Efficiency, career fantasy, NL-compare fallback quota |
| Stats pipeline | nflverse CSV reader + team-code map; roster file carries `gsis_id` + `sleeper_id`; a DynastyProcess id crosswalk + combine loader shipped in 195/#446 | `nflverse/csv.ts:21,113,124`, `nflverse-provider.ts:106-109,153-175`, `src/lib/sync/combine.ts` (on main) | History importer and identity crosswalk |
| Stats pipeline | Ranking/aggregation helpers (`competitionRanks` = ties share a rank), key-stat formulas | `core-stats-ops.ts:19-35`, `key-stats-ops.ts:56,169` | Generalised into `src/lib/ranking/` and the stat registry |
| Stat Center & player view | Players/research table (opens on last season), player modal, mobile History tab, copy-link share (behind `/app`) | `players-spreadsheet.tsx:240`, `player-view-modal.tsx`, `profile-stats-tabs.tsx:192`, `player-detail-actions.tsx:89-90` | v2 lives in the existing modal; no "Stat Center" natural-language box exists |
| Specs | Unbuilt Scout spec: metric registry, licence tiers, attribution, **its own thin public player pages (§8.5)** | `spec-scout.md` §4–§5, §8.5; `docs/specs/scout-content/registry.ts` | One shared stat registry; reconcile the public page |
| Jobs | Vercel daily cron (maxDuration ≤ 300), pool-job pattern | `vercel.json`, `src/lib/leagues/scoring/player-values-job.ts` | Nightly leaderboard job |
| UI shell | `GuestShell`, `/u/[username]`, `sitemap.ts`, `PlayerLink`, `pageAll` | as above | Public `/players/[slug]`, `/leaders`, `/compare` |

### 1.4 Manager Profiles & Versus

| Group | What exists | Path | How Versus uses it |
|---|---|---|---|
| Schema | `matchups` (team-based, `round_type`, result) — **same name as the PRD table** | `109_inseason_tables.sql:153-193`, `118:308-309` | Reused; manager = stint holder that week |
| Schema | `team_week_results` (PF, H2H, median results) | `109:204-229`, `117` | Seasons, PPG, expected wins/luck |
| Schema | `transactions` — **same name as the PRD table** (team-based; trades credit proposer only; commissioner moves have NULL initiator) | `109:239-258`, `151:1183`, `127:1542` | Waiver hit rate, drop regret, trade value |
| Schema | `team_lineups` (slot map + bench, `edited_by_commish`), `league_week_player_points` (starters only), `league_weeks` (per-week rules) | `112`, `152`, `158:208-238`, `144:206-210` | Replaces the PRD's `lineup_decisions` (derived) |
| Schema | `team_managers` stints — **`started_week` is never written** (only NULL = preseason); `ended_week` was written only by the retire paths (`150:2246`, `169:978`, `173:414`) until 176 removed retire, so in practice only timestamps are reliable | `053:78-99`, writers `060…196` | Attribution by timestamp |
| Schema | `leagues` (one row = one season, `complete` terminal, `champion_team_id`; **no renew verb**), `teams`, `league_members`, `league_invites`, `draft_picks`, `trades`/`trade_items` | `001:475-505`, `118:303`, `052`, `055`, `065:154-175`, `148:121-237` | Titles, lineage, claims, draft score, rivalry trades |
| Schema | Dormant cred tables (`weekly_rankings`, `cred_scores` have no writer); `profiles.cred_score` **is displayed** (`/u/[username]`, `/app/profile`, top scouts, and the mobile Profile Cred card shipped in #468); `profiles` world-readable, no visibility column; one-way `follows` | `001:39,436,458,581` | Rankings accuracy has no pipeline; privacy needs a column |
| Stats pipeline | `weekScoringRules`, `scoreStarter`, readers | `score-week-worker.ts:378-562`, `player-values-job.ts:188-279` | Bench/dropped/traded players scored under the week's real rules |
| League & team pages | League Stats tab = per-team head-to-head ("records from past seasons aren't kept yet"); standings; bracket; mobile League history with a "Previous seasons" stub | `src/components/leagues/stats-page.tsx`, `stats-page-ops.ts:12,21`, `league-shell-ops.ts:17-116`, `league-menu-sheet.tsx:77-78` | Seed of Versus |
| UI shell | `/u/[username]`, `/app/profile`, `profile-stats.tsx` placeholders, mobile titles credit the **current** manager | `profile-ops.ts:84-91`, `use-mobile-profile-titles.ts` | Global profile, trophy shelf (fixed to stint credit) |
| UI shell | Streak rule (Chris 2026-10-16), `UsernameLink` | `src/components/mobile/league/streak-ops.ts`, `src/components/shared/username-link.tsx` | One streak count; every username links |
| Jobs | `finalize-matchups` hourly; `league-player-values` ping | `116:1344-1349`, `137:175` | Analytics job runs after weeks finalize |

---

## 2. Shared infrastructure, built once

Each piece below is built once by the milestone named in the last row, and every other track consumes it.

### 2.1 Quarter-level stats feed + `nfl_game_periods` + boundary events
- **Needed by:** Duel (live scoring, swaps, windows); Player Profiles later (quarter splits, 4th-quarter claims).
- **Exists today:** the contract, recorder, replay and synthetic providers. There is no period shape, and `nfl_games.quarter`/`game_clock` are never written.
- **Design:** an additive **period capability** on the provider seam. The new interface is `getGamePeriods(season, week)` and `getPeriodStats(season, week)`, plus a `period_splits` capability flag. It sits alongside the five league methods, so no league provider or test changes. Two global tables: **`nfl_game_periods`** (game, period 1–5 where 5 = OT, started/ended, `observed_at` server time) and **`player_period_stats`** (game, player, period, canonical stat JSONB). Both are written only by a SECURITY DEFINER write door in one transaction. Duel's fantasy points go in a Duel-owned **`duel_period_points`** table, written in the same transaction by the TS scorer under `DUEL_RULES`, so the shared stats table never bakes in one scoring system. Boundaries come from the vendor's period events. Window early-close maps "first snap of the next quarter" to "the feed's period-start event". Ingestion runs on its own route `/api/cron/duel-live`, fired by a **pg_cron '15 seconds' job** guarded in SQL so nothing is sent unless a game is near or live. Because `cron_ping_route` fires `net.http_get` with `timeout_milliseconds => 55000` and never waits (`124:312-352`), a 15 s ping can overlap a slow invocation, so the route is **single-flight**: one poll per invocation with a hard budget of 10 s (well under 15 s), taken under a Postgres advisory-lock lease (an overlapping invocation exits at once and records a skip), and a route test pins `maxDuration` > budget the same way `sync-live` pins its 45 s budget (`live-poll.ts:88-90`). The fallback D.0.5 may choose instead, if the spike shows a 15 s ping costs too much Vercel CPU, is the `sync-live` shape: a 60 s ping with 4 × 15 s rounds inside a 55 s budget. D.0.5 pins one of the two and says why. It uses its own degraded flag, so a Duel feed outage never trips the league `stats_degraded` banner or eats `sync-live`'s budget. No always-on Fly.io/Railway worker.
- **Owner:** D-M0 (D.0.2 contract + synthetic, D.0.3 replay fixtures, D.0.4 tables + door, D.0.5 poller, D.0.7 live adapter after approval).

### 2.2 Stats warehouse: `player_stats` scope and season type, historical identity, nflverse import
- **Needed by:** Player Profiles (career, ranks, claims, Playoffs toggle), Duel (playoff slates), Highlights (playoff recaps), Versus (indirectly: imported seasons need `nfl_weeks`).
- **Exists today:** `player_stats` is week-grain `UNIQUE(player_id, season, week)` with no `season_type`. The history loader (on the archived `nfl_data_py`) wrote 2022–2025 *including* unlabelled playoff weeks 19–22. nflverse and Sleeper live reads drop or ignore the postseason. `nfl_weeks` is seeded for 2026 weeks 1–18 only.
- **Design:**
  - **(a) Don't change `player_stats`' key.** It's the league scoring input, and changing it would break every upsert, including `ingest_write_batch`. It stays the live/current-season table.
  - **(b) Postseason = weeks 19–22 (X.5).** That means seed `nfl_weeks` 19–22, set `game_type 'post'`, keep nflverse POST rows, and teach the Sleeper stats/schedule/projection reads the postseason. This is the encoding the 2022–2025 history already uses. League seasons are capped at week 18 by the schedule engine (`110:404-423`), so no league scores a playoff week, and the task must prove it.
  - **(c) History lives in a new warehouse (P1).** `player_seasons` is keyed by gsis id with `season_type REG|POST` ("Both" is computed), imported by a TypeScript plain-fetch importer over nflverse release CSVs. No Python, and no archived package.
  - **(d) Readers of past seasons cap at week ≤ 18 (P.1.0)** until they move to the warehouse.
- **Owner:** X.5 (postseason), P.1.0 (cap), P.1.2–P.1.4 (warehouse).

### 2.3 Player and NFL-team references (identity, slugs, no NFL teams table, favorites)
- **Needed by:** all four.
- **Exists today:** `players.id` = Sleeper id. There's no `gsis_id` or slug, the retirees are patchy, and the Sleeper sync overwrites the table. Crosswalks exist in code: the nflverse roster file (`gsis_id` + `sleeper_id`) and the DynastyProcess crosswalk shipped in 195/#446 (`src/lib/sync/combine.ts`). NFL teams are 32 abbreviations in `src/lib/nfl-teams.ts`, and `teams` is the **fantasy** teams table.
- **Design:** one identity table, **`nfl_players`**:
  - Keyed by `gsis_id`, with `slug UNIQUE` (stable forever), `sleeper_id UNIQUE NULL` (a soft link, no FK), `pfr_id`, `espn_id`, draft data, college and headshot.
  - It holds every player since 1999 without touching `players`, so search, lists and draft pools don't fill with 1999-era retirees, and old code runs unchanged on the new schema.
  - Public URLs (`/players/[slug]`) resolve through it. In-app code keeps `players.id` and resolves `sleeper_id → gsis_id` when it needs history.
  - Video matching keeps using `players` (current players), with optional admin aliases in `player_aliases` so `players` stays sync-only.
  - NFL teams stay **TEXT abbreviations with a CHECK** on the 32 codes, pinned to `NFL_TEAMS` by a test. PRD columns `video_teams.team_id` and `user_favorites.nfl_team_id` become `nfl_team`. The public URL is `/nfl/[team]`, mirroring `/app/nfl/[team]`.
  - **`user_favorites`** is its own owner-only table, not `profiles` columns, because profiles are world-readable.
- **Owner:** X.4 (identity + slugs, before H5/P1); H.4.1 (favorites).

### 2.4 Public route group + ISR + sitemap + structured data
- **Needed by:** Highlights H5, Profiles P5, Manager public profile; later Duel result pages.
- **Exists today:** public pages outside `/app` (`/u/[username]`, `/consensus`, `/personas`) use the cookie-bound client, so they render dynamically. There's one `unstable_cache` use, no `revalidate`/`revalidateTag`, a personas-only sitemap, no `robots.ts`, and JSON-LD on one page.
- **Design:** a `src/app/(public)/` group on `GuestShell` (paths must not start with `/app`, `middleware.ts:4`). It includes:
  - a cookie-less anon server client (`src/lib/supabase/anon.ts`) so pages can be cached;
  - one tag vocabulary (`player:<id>`, `week:<season>:<week>`, `videos`, `player-profiles`), fired by the ingest/score/leaderboard jobs after writes;
  - `sitemap.ts` split into `generateSitemaps` families, each gated by its flag (never advertise a URL that doesn't serve);
  - a `robots.ts`;
  - one escaped JSON-LD helper generalised from the persona post page.

  In-app player clicks are unchanged: mini card first, Expand for the full modal.
- **Owner:** X.3.

### 2.5 Share-card images
- **Needed by:** Duel results, player claim/stat/compare cards, rivalry cards, OG images.
- **Exists today:** nothing (`next/og` ships with Next 15 but is unused).
- **Design:** one `next/og` `ImageResponse` route family (`/api/og/[kind]`, node runtime). It has a shared frame (logo, URL, scope line, source line), a token→hex module derived from the v7 tokens, bundled Inter (OFL) and per-kind templates. A `ShareButton` uses `navigator.share({files})`, falling back to download + copy link. Licensed or PFR-sourced numbers never go on cards until cleared (NP-P6).
- **Owner:** X.7; first consumer D.4.4 or P.4.4, whichever lands first.

### 2.6 Realtime channel budget
- **Needed by:** Duel only (Highlights, Profiles and Versus are request/response).
- **Exists today:** two spines (`league:<id>`, `draft:<id>`), broadcast-from-DB, private channels authorised by RLS on `realtime.messages`, at most 3 channels per socket, pinned by `single-room-tab.test.ts`.
- **Design:** a third refcounted spine, `use-duel-channel`. Topic `duel:<id>`, readable by the two participants only. Events are one score event per duel per changed poll (per-statement trigger) plus reveal events from `duel_tick`. Unrevealed picks or swaps never appear in a payload. The pin is updated in the same reviewed PR. Capacity is shared with live drafts: Supabase Free allows 200 concurrent connections, Pro 500 (§5.5).
- **Owner:** D.3.3.

### 2.7 Notifications
- **Needed by:** Duel (challenge, match found, lineup not set, player out, change took effect, final), Versus (import claim, league renewed), optionally Highlights.
- **Exists today:** `notify_league_member_internal(user, type, title, body, data)` is already generic despite its name: a plain insert, REVOKEd, and it swallows errors. The bell polls every 60 s. There's no push or email (M8 Q97).
- **Design:** reuse it from definer doors. Each consumer adds `notificationHref` arms + tests. Time-critical Duel nudges ("window opening") only reach an open app; web push is a question (NP-D9).
- **Owner:** X.9 (convention + arms), consumers add types.

### 2.8 Rate limiting
- **Needed by:** Duel (challenge creation, queue entry — the PRD's own rule, `spec-duel.md:360`). The other uses are this plan's proposals, not PRD lines: Highlights (report-unplayable, the H.2.6 play counter if NP-H17), Profiles (NL compare, popularity), Versus (import requests).
- **Exists today:** only bespoke caps (`create_mock_draft` HEAD `102`; AI quota `074`/`quota.ts`).
- **Design:** `rate_limits(key, window_start, count)` with RLS on and no policies, plus a REVOKEd SECURITY DEFINER `rate_limit_claim(p_key, p_window_s, p_max, p_now)` callable inside RPCs, plus a server helper `src/lib/rate-limit.ts`. `quota.ts` is unchanged.
- **M7 builds this first.** M7's L.F2.6 "Rate limits" (spec §22.5, F41; FULL; `tasks-M7-hardening-ga.md:102-106`) is the first task on M7's DB lane and is not started. It needs exactly this mechanism for chat, league mutations and bids. One limiter, not two: L.F2.6 ships the table + `rate_limit_claim` + helper; X.8 then only adds the Duel / Highlights keys and limits (C42). If this plan starts before L.F2.6, X.8 ships the mechanism and L.F2.6 adopts it — whichever lands first owns it, recorded in PROGRESS.
- **Owner:** M7 L.F2.6 (mechanism) → X.8 (next-phase keys; replaces the inventories' D.4.1 / H1.6 limiters).

### 2.9 Feature flags
- **Needed by:** all.
- **Exists today:** build-time `NEXT_PUBLIC_FLAG_*`, global, ON in dev, OFF when deployed unless set, surfaces only (never an RPC/auth path). Flag-off layouts `redirect('/app')` (`mocks/layout.tsx` precedent). There's no per-user cohort.
- **Design:** new flags `duel`, `duelMultiGame`, `duelWeek`, `highlights`, `watch`, `playerProfiles`, `publicPlayerPages`, `managerProfiles` (plus Phase 3's `highlightsPhase2`, `playerProfilesPhase2`, added in that pass), listed in §7.C. If you want a friends-first release, add a **beta allowlist**: an owner/operator-only `beta_memberships(user_id, feature)` table (RLS: you read your own rows, only the operator writes), read by page server components. Not a `profiles` column, because profiles are world-readable (001 policy) and that would make everyone's beta membership public — the same reason favorites get their own table (§2.3). The choice stays with you under NP-Q3. That's a FULL task because it's a permission.
- **Owner:** X.1 (flags), X.12 (allowlist, only if ruled).

### 2.10 Nav slots (desktop + mobile)
- **Needed by:** Duel, Watch (top level); Versus (inside leagues).
- **Exists today:** the desktop `sidebar.tsx` NAV_ITEMS uses flag spreads, plus `bottom-tabs.tsx`. The mobile `AccountTab` is fixed at `home|community|players|profile` (`mobile-nav.ts:11`, `mobile-dock.tsx:166-180`). The league tabs are in `league-shell-ops.ts:53-67`.
- **Design:** X.2 adds dark (flag-off) entries for Watch and Duel on desktop and the mobile route mapping. The phone bar's final layout is a ruling (NP-Q6). Versus is a league tab decided at V.2.2 (NP-V15).
- **Owner:** X.2.

### 2.11 The build's own PROGRESS and ACTIVE-BUILD files
- **Exists today:** `ACTIVE-BUILD.md` names exactly one build — **M7 Hardening & GA** since 2026-10-19 (M8 before that; M8's L.G1.1, L.G2.1 and L.G2.2 are still open, L.G2.1 blocked on the hosted test project, M7 §12 C1). There's no root `PROGRESS.md`; the leagues ledger is `PROGRESS-leagues.md`.
- **Design:** `docs/specs/PROGRESS-next-phase.md` holds one checklist per track (D/H/P/V/X), NP-prefixed Q/D/F ledgers so numbering never collides with leagues, the migration reservation log, and the push-debt list. Per-track task breakdowns follow the `tasks-M8` format (`tasks-NP-duel.md`, `-highlights.md`, `-profiles.md`, `-versus.md`). `ACTIVE-BUILD.md` points at `PROGRESS-next-phase.md` with a lane-precedence rule (§6.6). The CLAUDE.md "Active Builds" block gains a pointer.
- **Owner:** X.0.

### 2.12 Smaller shared pieces
- **nflverse reader:** `csv.ts`/`fetchText` move to `src/lib/nflverse/`, re-exported from the old path so league code and `combine.ts` (shipped in 195/#446) keep working. Owner: D.0.3 (first consumer).
- **Ranking + claims engine:** `competitionRanks` is generalised in `src/lib/ranking/`, and one claims engine serves player and manager headline claims. Owner: P.2.1/P.3.1.
- **Shared stat registry:** a code registry, not a table, unifying with Scout's. Owner: P.1.1.
- **Job recipe + health keys:** documented in X.11. A pg_cron "succeeded" status only means the ping was queued, so each route writes its own `system_flags` health key.
- **CI lanes + time fence:** add new `src/lib/<track>/**` directories to both `db.yml` path lists and `ci-stack-lane-trigger.test.ts`, and extend the `.eslintrc.json:5` determinism fence (today `src/lib/leagues/**` plus five `src/lib/sync/*` files) to `src/lib/duel/**` **and `src/lib/versus/**`**, plus any other league-touching analytics or import code (V.3.1 re-scores bench players under each week's league rules; V.1.4 renewal (if ruled in) and V6 import write league lifecycle rows). Provider fetches for import go through an injected adapter, matching the `StatsProvider` pattern, so the fence never needs an exception. Owner: X.10.
- **Attribution line:** "Data via nflverse" (CC-BY), plus vendor attribution. Owner: P.1.1 constant, shown by P.3.4.

---

## 3. Conflicts with existing specs and shipped code

| # | Conflict | Where | Resolution | Needs Chris? |
|---|---|---|---|---|
| C1 | Duel's hard dependency (per-quarter stats, boundary events, ≤ 15 s) is not met by the current provider | `spec-duel.md` §Data requirements vs `sleeper-stats-provider.ts:182` (weekly `season_type=regular`), `:253` (`core_box` only), `:280` (no quarter/clock); the 5-min cache is a recorded header (`fixtures/sleeper-def-yards-allowed-2026.json:2`, 2026-09-27), not code | Build the engine on synthetic + nflverse play-by-play replays ($0); the live adapter waits on an approved vendor (§5.1) | **Yes** (budget) |
| C2 | "Always-on ingestion worker (Fly.io/Railway)" | `spec-duel.md` §Services vs `124` pg_cron→route pattern | Reuse pg_cron: a gated '15 seconds' job → `/api/cron/duel-live`. Free; no second deploy target. An always-on worker is only justified for Phase 3 next-snap swaps | No (yes only if you prefer the worker) |
| C3 | Unofficial free live sources (ESPN site API) | House rule "official APIs/RSS/YouTube only" | Excluded from spike and production unless you rule otherwise | **Yes** (confirm) |
| C4 | Generic Duel table names (`slates`, `entries`, `swaps`, `ratings`, `challenges`, `duels`…) | `spec-duel.md` §Data model vs league schema; `lineup_swaps` (spec §12.16 name) | Prefix `duel_*`; the two global stat tables become `nfl_game_periods` + `player_period_stats` (Appendix A) | No |
| C5 | `player_period_points` stores points in shared stats data | `spec-duel.md` vs one-engine rule (D33; points computed in TS) | `player_period_stats` holds stat lines; `duel_period_points` holds Duel points, written by the TS scorer in the same transaction. Entry score stays a pure SQL sum, as the PRD wants | No |
| C6 | Manager PRD `matchups`, `transactions` already exist (team-keyed) | `109:153,239` | Reuse, never recreate; manager columns derived by stint | No |
| C7 | PRD `lineup_decisions`, `manager_seasons` duplicate captured data | `team_lineups`, `league_week_player_points`, `team_week_results` | Derive. Add only `league_week_roster_points` (bench/IR points under the week's rules); `manager_seasons` is an RPC | No |
| C8 | PRD `skill_stats`/`skill_ranks` generic names | vs `duel_ratings`, cred | `manager_skill_stats`, `manager_skill_ranks` | No |
| C9 | `video_teams.team_id`, `user_favorites.nfl_team_id` would point at fantasy `teams` | `001` `teams`; `src/lib/nfl-teams.ts` | `nfl_team TEXT` + CHECK on 32 codes; public URL `/nfl/[team]/…` (not `/teams/`) | **Yes** (the URL shapes are in NP-Q4) |
| C10 | `videos.game_id` can't reference NFL and college games | no college games table | `videos.nfl_game_id` FK; college linkage deferred to H6 | No |
| C11 | Public `/players/[slug]` reverses the 2026-10-04 "no public player surface" ruling; Scout §8.5 designs a second public player page | `src/app/app/(shell)/players/[playerId]/page.tsx`; `spec-scout.md` §8.5 | New public route group outside `/app`; the in-app redirect and mini card → modal stay; one public player URL absorbs Scout §8.5 | **Yes** |
| C12 | Two slug proposals (`players.slug` vs a new identity table) | Highlights / shared-infra vs Profiles inventories | `nfl_players.slug` (gsis-keyed) is the only public slug; `players` untouched (§2.3) | No |
| C13 | Playoffs already mixed into "last season" in shipped readers | `api/players/[id]/stats/route.ts:73`, `lib/stats/fetch-weekly-stats.ts:65` (builder + Lists via `aggregate-fantasy.ts`), `use-mobile-pprofile-stat-lines.ts:63-71`, `use-mobile-players-data.ts:124`, `lists/seed-big-board.ts:35` (also unpaged) | P.1.0 caps them at week ≤ 18; stored rows untouched | **Yes** (confirm rule) |
| C14 | Postseason not representable (nflverse drops POST; Sleeper reads hard-code regular; `nfl_weeks` seeded 1–18) | `nflverse-provider.ts:292-298`, `sleeper-stats-provider.ts:182`, `src/lib/sync/schedule.ts:10`, `weekly-projections.ts:96`, `039:63-83`, `src/lib/sports-data/nfl-state.ts:42` (postseason pins the current week to 18) | X.5: weeks 19–22, `game_type 'post'`, FULL rigour with a proof that no league scores them | **Yes** (confirm weeks 19–22) |
| C15 | `spec-youtube-highlights.md` Phase 2 (per-player search, `player_highlights` cache, Pro gate) and Phase 1 link-out | `spec-youtube-highlights.md` §Phase 1–2 | **Superseded** by the channel index; never create `player_highlights`; no Pro gate; Phase 1 link-out not built (moot) | No |
| C16 | `spec-leagues-live-mode.md` Live Mode, `sync-live-stats` Edge Function, MySportsFeeds, Pro gates, `nfl_games` sketch | `spec-leagues-live-mode.md` §Live Mode, §Live Stats Pipeline | **Superseded**: pipeline = shipped live-poll route; Pro gates stale (free-only); quarter-level live scoring is owned by `spec-duel.md`; Live Mode placeholder page stays until a "live modes" PRD exists | No |
| C17 | Pro gates in older specs (`spec-teams.md` "1 team", Live Mode, YouTube Phase 2, History Mode $5/yr idea `spec-redraft-leagues.md:770`) | free-only launch (CLAUDE.md, 2026-08-03) | No `is_pro` gate anywhere in this phase | No |
| C18 | Cred (Freshie…GOAT) vs skill rank tiers (Rookie…Hall of Fame) vs Duel rating "mapped into FieldScout rank tiers". Cred is live and still being tuned — migration 197 (2026-10-18) starts everyone at 7 cred | `src/lib/cred-tiers.ts:13-24`, `197_cred_starts_at_7.sql`, both PRDs | Separate `duel_ratings`; cred stays as it is; one headline ladder decided by you before V-M5 | **Yes** |
| C19 | "Mobile-first throughout" (Duel) vs "web first, then mobile" | `spec-duel.md` §Screens vs CLAUDE.md Redesign | Duel screens built web + mobile in the same milestone; other tracks follow web-first | **Yes** |
| C20 | Win probability on the Live Duel screen vs the v7 rule "features with no backend are left out" | `spec-duel.md` §Realtime; CLAUDE.md | Left out of M3; added later as a server-side projection sim if you want it | **Yes** |
| C21 | Duel M1 "pricing + cap-validated squad builder" isn't needed for the single-game launch target | `spec-duel.md` §Milestones | Proposed: pricing/roster builder, active intervals and the boundary processor move to D-M6 where first used (PRD milestone *names* kept). Pending NP-D18 | **Yes** (NP-D18) |
| C22 | Four-quarter guarantee "as a constraint on `active_intervals`" — no exclusion constraints in the repo | `spec-duel.md` §Integrity; repo uses triggers + row locks (`154`) | Duel Week materialises spent quarters as `duel_slot_quarters(ordinal 1..4)` with CHECK + UNIQUE (a literal constraint) + an overlap trigger; same guarantee, house pattern | No |
| C23 | Highlights "each Watch row is a SQL view" would need a second (SQL) scorer | `spec-highlights-watch.md` §Row queries vs canonical TS engine | Rows are a TS service scoring through the canonical preset scorer; SQL only selects videos | No |
| C24 | Hourly refresh "Thu/Sun/Mon" can't be a Vercel cron on Hobby; misses Saturday/holiday games | `vercel.json`; PRD §Refresh | One hourly pg_cron ping; the route works out game days from `nfl_games` | No |
| C25 | Favorites "ask during onboarding" — no onboarding beyond `/username` | `src/app/(auth)/username/page.tsx` | Ask once on first Watch visit (or an optional step after `/username`) | **Yes** |
| C26 | "My players: prompt to join or create a league" — leagues are invite-only this year | `NEXT_PUBLIC_FLAG_LEAGUES` | Fall back to players on your lists; prompt only for the league cohort | **Yes** |
| C27 | "Natural-language entry through the existing Stat Center" — none exists | `spec-scout.md` §6.4; Ask AI unbuilt | Compare search box on the Players page + overlay; rules parser first, optional Haiku fallback under the daily AI quota | **Yes** |
| C28 | Profiles "PPR or half?" reopens a ruled default (ESPN Standard, 2026-10-04) | `core-stats-ops.ts:66-88` | Keep ESPN Standard on "This season"; show PPR/Half/Standard career side by side | **Yes** |
| C29 | Combine/draft data are PFR-sourced via nflverse; 195/#446 (merged) already shows a 40 time in-app | `spec-scout.md` §2.2 Tier 2; `players.forty_time` (195/#446) | In-app only until cleared; one source for the 40 (no second, disagreeing value) | **Yes** |
| C30 | Leagues can't carry over seasons; "all-time" = this season | `001:485`, `stats-page-ops.ts:12`, `gap-list.md:174` | Lineage columns + commissioner `renew_league` (V.1.4) | **Yes** |
| C31 | Title credit goes to the *current* manager on mobile | `profile-ops.ts:84-91` | Credit the stint holder in the championship week | **Yes** |
| C32 | Former members fail `is_league_member`, so their own history would silently shrink | `052:86-94` | Global reads via stint-keyed SECURITY DEFINER RPCs that refuse loudly | No |
| C33 | Imported seasons must satisfy `league_weeks`→`nfl_weeks` FKs and the scoring-snapshot guard | `110:253-261`, `056:70`, `059:126-149`, `104:571` | One import RPC writes `league_weeks` (final) + a valid snapshot; seed past `nfl_weeks` with `sync-nflverse` | No |
| C34 | "Rankings accuracy" stat has no pipeline (cred tables dormant) | `001:436-470` | Out of the composite until weekly rankings return with scoring | **Yes** |
| C35 | Versus vs the existing league Stats tab ("delete nothing") | `league-shell-ops.ts:53-67` | Stats becomes Versus (route kept); today's H2H becomes the rivalry view | **Yes** |
| C36 | Feature flags are global; "friends first" can't be expressed. M7's beta ladder (L.F2.11, TD8: "no new gating mechanism, no per-user allowlist") gates leagues by invitation, which Duel can't use because a duel needs no league | `src/lib/feature-flags.ts:13-17`, `docs/runbooks/beta-ladder.md` §1 | Duel's friends rung is **challenge links only** (D-M4 before D-M5: no Quick Match, no public hub listing, so only people sent a link can play) — no new mechanism, in the ladder's spirit. X.12's allowlist is the fallback only if you want a hard list | **Yes** |
| C37 | One active build in ACTIVE-BUILD vs four tracks. **M7 Hardening & GA is active** (approved 2026-10-19): DB lane L.F2.6 → L.F2.3 → L.F2.8 → L.F2.12, parallel no-DB lanes (L.F2.1, L.F2.7, L.F1.1, L.F1.4 in PRs #520–#524), test-project lane blocked on C1. M8 still has L.G1.1, L.G2.1, L.G2.2 open | `ACTIVE-BUILD.md:12-16`, `PROGRESS-leagues.md:50-62` | Multi-track PROGRESS-next-phase + lane rule; M7's DB lane and this plan's schema lane share the one local DB and must be serialised; you decide the order | **Yes** |
| C38 | Prompt says "read PROGRESS.md" — no such file | repo root | `docs/specs/PROGRESS-next-phase.md` (X.0); `PROGRESS-leagues.md` stays leagues-only | No |
| C39 | `src/lib/scoring/default.ts` legacy calculator (F642) vs canonical preset scorer | 195/#446 / F576 | No new caller of the legacy calculator in any track | No |
| C40 | Sleeper API terms: free for non-commercial use; Duel/import add load | `docs.sleeper.com` | Email Sleeper before V-M6 import | **Yes** |
| C41 | Memory note "database.ts untracked" is stale (it is tracked) | `git ls-files` | Keep the re-append-alias rule; memory note to be corrected | No |
| C42 | X.8's rate limiter duplicates **M7 L.F2.6 "Rate limits"** (first on M7's DB lane, not started) | `tasks-M7-hardening-ga.md:102-106`, §2.8 | One mechanism: whichever lands first ships `rate_limits` + `rate_limit_claim`; the other adopts it. X.8 becomes keys-and-limits only | No (order via NP-Q1) |
| C43 | Highlights' matcher and ingest job would duplicate the **player-news** matcher and ingest that shipped 2026-10-18 | `198_player_news.sql`, `src/lib/news/{match,ingest,sources}.ts`, `/api/cron/ingest-player-news`, PR #492 | H.1.4 extends the news matcher (promoted to a shared lib); H.1.5 copies the news ingest's route + ping shape. Note 198's tables read `authenticated` only, while highlights need **public** read for SEO (H.1.1 states its own policy) | No |

---

## 4. Gaps, contradictions and ambiguities — questions for Chris

Each question is written as the rule a player would see. The recommendation is my default if you have no preference. None of these are decided here. PRD open questions are quoted word for word and marked **(PRD)**.

### 4.1 Cross-cutting (needed before or at the start of build)

| ID | Question | Why it matters | Recommendation |
|---|---|---|---|
| NP-Q1 | M7 Hardening & GA is the build in progress (your "do M7 next", 2026-10-19), and M8 still has three leftover tasks. Does this plan wait for M7's database lane, share it, or go ahead of it? | Only one builder can use the local database at a time. M7's database lane is rate limits → chaos drills → security fixes; its other lanes (load scripts, accessibility, Lighthouse, security review) need no database and keep running either way | Share it, in this order: M7's rate limits first (small, and this plan reuses it — C42), then this plan's schema lane (Duel tables, highlights tables, playoff weeks), with M7's chaos drills and security fixes slotted into quiet weeks. The Duel spike, Highlights UI and setup need no database and start on day one. M8's leftovers wait |
| NP-Q2 | Can we spend money on a live stats feed for Duel, and what's the monthly ceiling? | Duel can't go live without one | Approve a one-month spike up to ~$25 plus a free SportsDataIO Replay account and a quote request; choose the production vendor after the spike |
| NP-Q3 | When a new feature is ready, does it go to everyone on fieldscout.gg, or to friends first? | Today's switches are whole-site. Your beta ladder for leagues (2026-10-20) deliberately adds no per-person list: friends get in by invitation. Duel has no league to be invited into | Highlights and Profiles to everyone. Duel's friends rung is **challenge links only**: ship challenges (D-M4) before Quick Match (D-M5), hide duels you're not in from the hub, and only people you send a link can play. Open Quick Match once a full game window runs cleanly. A hard beta list (X.12) only if you want one |
| NP-Q4 | Can there be public player pages at fieldscout.gg/players/<name> (and /nfl/<team>, /leaders/…, /compare/…)? Inside the app, clicks still open the mini card, then the full view. | Reverses the 2026-10-04 ruling; both PRDs need it for search traffic; Scout planned its own version. Two PRD addresses change shape: the PRD's `/teams/<team>/highlights` becomes `/nfl/<team>/highlights` (in the app, "teams" already means fantasy teams, and the in-app NFL team page is `/app/nfl/<team>`), and `/week/<n>/top-plays` becomes `/nfl/<season>/week/<n>/top-plays` (so each season's week 1 gets its own page) | Yes, one set of public pages outside the app, absorbing Scout's planned page, at the addresses listed here |
| NP-Q5 | Is Duel the exception to "web first, then mobile", with phone and web screens built together? | Duel is a second-screen game played on phones during games | Yes, both in the same milestone |
| NP-Q6 | On phones, where do Watch and Duel sit in the bottom bar (today Home, [Community], Players, Profile)? | Two more tabs makes five or six | Home · Watch · Duel · Players · Profile while Community is off; until Duel launches, a Duel card on Home |
| NP-Q7 | Do playoff games count as weeks 19–22 everywhere (Duel slates, highlights, stats)? | Needed for Duel through the playoffs and the Playoffs toggle | Yes: wildcard 19, divisional 20, conference 21, Super Bowl 22. During the playoffs, the weekly-rankings, big-board, Lists and Explore pages keep showing week 18 as "this week" (today's documented behaviour, `nfl-state.ts:42`); only the stats sync and Duel read the playoff weeks |
| NP-Q8 | Is it OK that challenge invites and imported-league claims work by share link and the in-app bell only (no email)? | No email service is connected; adding one is a new vendor | Links + bell for 2026 |
| NP-Q9 | Is FieldScout (free, no ads) "non-commercial" under Sleeper's API terms, or should we ask Sleeper? | We already depend on Sleeper; import adds load | Send Sleeper a short email before building import |
| NP-Q10 | Do you want a Claude Design pass for the screens v7 doesn't show (Duel planner/live/results, Watch tab, Versus, Profile v2 sections)? | No mock exists for any of them | Yes for Duel live + Watch; the rest built in v7 language without one |
| NP-Q11 | You asked for one milestone at a time, starting with the Duel data spike. Can we instead (a) fix the "last season counts the playoffs" bug and do the small setup first, and (b) work on up to 3 tracks at once (Duel, Highlights, setup), with you still reviewing each finished piece, one at a time per track, before the next piece on that track starts? | It changes the order you asked for and how many things are in flight. The §0 order and §6.6 lanes are pending this answer | Yes. The playoff bug is live in the launched Stats table today and the fix is a few lines; setup is small and every track needs it. The Duel spike still starts on day one. Running Highlights next to it means something visible ships while the Duel feed is waiting on your budget decision. If you'd rather keep it strictly one at a time, the order becomes D-M0 → the rest of §0 in sequence |

### 4.2 Duel

| ID | Question | Why it matters | Recommendation |
|---|---|---|---|
| NP-D1 **(PRD)** | "Does the current stats provider supply live per-quarter player stats, and at what cost?" | The hard dependency | Answered by research: **no** (weekly totals, ~5-min cache). Cost depends on the vendor (§5.1); spike first |
| NP-D2 **(PRD)** | "Public name for Duel (trademark check vs. FanDuel)." | Needed before a public launch | Internal "duel" until you run the check; no product-name change in this plan |
| NP-D3 **(PRD)** | "Should the free-changes period in Duel Week also show the opponent's changes live, or keep them hidden until Sunday?" | Phase 3 only | Hidden until the next live game starts, like sealed reveals |
| NP-D4 **(PRD)** | "Include kickers and defenses later, or never?" | Squad shapes and pricing | Not at launch; revisit after a season of play data |
| NP-D5 **(PRD)** | "Should Duel results count toward the main FieldScout skill rank, or keep a separate Duel rating?" | Ties to the cred/skill ladder question | Separate Duel rating shown on the profile, fed in as one input to skill rank |
| NP-D6 | In a single-game duel the tiebreak is "fewer swaps used", but there are no swaps, only quarter picks. What counts? | Tiebreak 1 has no meaning otherwise | Lineup changes made after kickoff; planning before kickoff is free |
| NP-D7 | If a player you planned for a later quarter is ruled out, does the app swap him automatically? | Rule 5 only fills quarters you never set | Yes: best-projected available player with uses left, plus a notification |
| NP-D8 | "Ruled out before kickoff": our only pre-game signal is Sleeper's injury status "Out" (official inactives arrive next day). OK? | No live inactives feed unless the vendor has one | Use "Out" (and the vendor's inactives if it has them) and say so in the help text |
| NP-D9 | Should time-critical nudges ("window opening", "lineup not set") reach people with the app closed (web push, free, no vendor)? | The bell only shows when the app is open | Ship in-app first; decide push after the first playoff weekend |
| NP-D10 | Who can watch a duel: only the two players, or anyone? | Decides privacy rules and shareable pages | Participants only; the results share card is the public artifact |
| NP-D11 | Can one person be in several duels on the same game? | Squad reuse and abuse limits | One squad per person per game, reused across up to 5 duels |
| NP-D12 | Do bots have profiles you can click? | "Usernames always link to profiles" | No: a labelled "Bot (Hard)" with no profile and no rating change |
| NP-D13 | Do we run Duel in the NFL playoffs? | The index says "now through the playoffs"; needs weeks 19–22 + a feed | Yes for single-game duels |
| NP-D14 | If the feed goes down mid-game, void the duel or pause and score late? | PRD: freeze swaps; void if data can't be recovered | Freeze changes, keep the plan running, back-fill when the feed returns; void only if a quarter is still missing at final |
| NP-D15 | Show win probability on the live screen? | v7 rule says leave out features with no backend | Leave out at launch; add later as a simple projection sim if wanted |
| NP-D16 | Is "Hard" bot in single-game "re-plans Q3/Q4 at halftime away from players under projection"? | PRD defines Hard bot for rosters only | Yes |
| NP-D17 | The PRD's M3 lists "Open Swaps" (change any time, takes effect next quarter; 5 swaps for Sunday Early and Late). A single-game duel has no swaps — you pick by the quarter — so Open Swaps only means something on multi-game Sunday slates. OK to build Open Swaps and its 5-swap budget with Sunday slates (D-M6) instead of in M3? | The PRD names it in M3, but nothing in a single-game duel can use it | Yes: build it in D-M6 next to Sunday Swap Windows (D.6.6), and keep single-game M3 to the quarter planner |
| NP-D18 | Ship single-game Duel first, and build pricing, the 10,000-credit roster builder, "active intervals" and the quarter-boundary swap processor with Sunday slates (D-M6), instead of in the PRD's M1/M2? | The PRD's M1 is "Slates and pricing" and M2 is "Active intervals, boundary processor"; single-game duels have no cap and no bench, so none of it is used until Sunday slates. This changes what those PRD milestones deliver | Yes: M1/M2 deliver slates, the quarter planner and quarter scoring for single games; pricing, rosters, intervals and the boundary processor land in D-M6 where they're first used |

### 4.3 Highlights & Watch

| ID | Question | Why it matters | Recommendation |
|---|---|---|---|
| NP-H1 **(PRD)** | "Where does the "Top college prospects" ranking come from? It needs a draft prospect data source." | Phase 2 row has no source | Park until you pick a free official source |
| NP-H2 **(PRD)** | "Daily YouTube API quota: is 10,000 enough at full source count, or request an increase?" | An increase triggers a YouTube compliance audit | Enough: peak game day is under 10% of quota; no increase request |
| NP-H3 **(PRD)** | "Should the hero video autoplay on mobile data?" | Phones can't tell data from Wi-Fi; YouTube autoplay rules | Muted autoplay on desktop only; a still + play button on phones |
| NP-H4 | Which scoring do Watch point badges and "Top performances" use? | Should match the player view | ESPN Standard (the player-view default); in a league context, that league's points |
| NP-H5 | For people not in a league (almost everyone this year), what does "My players" show? | PRD prompts them to join a league that's invite-only | Players from your own lists; hide the row if none; league prompt only for the cohort |
| NP-H6 | Include YouTube Shorts? | Team channels post many; they play poorly in a 16:9 sheet | Index them but keep them out of rows and reels at launch |
| NP-H7 | Where is the favorite-team question asked? | There's no onboarding beyond the username step | A one-time card on the first Watch visit, editable in Settings › Profile |
| NP-H8 | Which college channels count as official at launch? | Quota and review load | The four power-conference channels; programs added later in Admin |
| NP-H9 | Can the College row for NFL players ship before a college player table exists? | `players.college` + draft year cover NFL players | Yes, as long as college videos are indexed: the row needs the college channels seeded by H.1.3b (NP-H8). If NP-H8 says no college channels at launch, the College row stays hidden until H6. The college player table waits for H6 either way |
| NP-H10 | Who reviews low-confidence matches, and what confidence shows publicly? | Only you are an admin | You, in Admin › Highlights. Show a clip on a player only when we're very sure it's him (≥ 0.8); clips we're fairly sure about (0.5–0.8) wait for your review; the rest are dropped |
| NP-H11 | What is the hero "top play of the week"? | YouTube has no "top play" signal | The featured clip of the week's highest-scoring player |
| NP-H12 | How far back does the index go on day one? | NFL career row vs the 30-day refresh policy | Back to the 2023 season for NFL + team channels |
| NP-H13 | Where do bench players rank in "League highlights" and "Your opponents' players"? | Only starters have stored points | By points scored for their team; bench only if the row is short |
| NP-H14 | "Under 50% rostered" (waiver tape) has no source. What instead? | No rostered-% data exists | "Not rostered in your league" + projection risers |
| NP-H15 | SEO recap line: fixed template or AI-written? | AI costs per page | Template from the stat line (the PRD example is a template) |
| NP-H16 | OK to add one new shared component, the in-app video player sheet? | New shared components need your approval | Yes: one video player (a pop-up window on desktop, a sheet you swipe down to close on phones; `VideoPlayerSheet` in code) |
| NP-H17 | Do you want to measure the Highlights success numbers from launch (share of weekly users who play a video, "Watch your week" plays per team, videos per session)? We record nothing about plays today. | The PRD's success metrics can't be read without a play count, and the full play log is Phase 3 (H6) | Yes, a small anonymous play counter from H2 (H.2.6): one row per play with video, surface and day, no viewer id, rate-limited; organic search visits need a search-console or web-analytics source, which isn't connected today (no analytics package in `package.json`), so that one waits for you to pick one |

### 4.4 Player Profiles

| ID | Question | Why it matters | Recommendation |
|---|---|---|---|
| NP-P1 | Past seasons in the app currently count playoff games (Puka Nacua's 2025 shows 2,047 yards; his regular season was 1,715). Should every "last season" number be regular season only, like ESPN/Yahoo/Sleeper? | Live bug in the Stats table, Lists, player view | Yes, everywhere today; playoffs only behind the profile's scope toggle |
| NP-P2 **(PRD)** | "Source for pre-1999 career totals?" | No open source; reference sites forbid scraping | Ship "#3 since 1999" wording everywhere; revisit licensing after launch |
| NP-P3 **(PRD)** | "Default fantasy scoring shown on profiles: PPR or half?" | You ruled ESPN Standard default on 2026-10-04 | Keep ESPN Standard on This season; show PPR, Half and Standard career totals side by side |
| NP-P4 **(PRD)** | "Which positions at launch: QB, RB, WR, TE only, or include kickers and defenses?" | Catalog only covers four | QB/RB/WR/TE; K and DEF keep today's view, no claims strip |
| NP-P5 | Who counts as an "active player" for "among active players"? | Sleeper marks some legends active | Played at least one regular-season game this season or last |
| NP-P6 | Combine and draft data come from Pro Football Reference through nflverse. OK to show publicly? (The app already shows a 40 time, shipped in #446.) | Licence read needed | In-app only until you confirm; off public pages and share cards |
| NP-P7 | Drop stats we can't get free (yards per route run, separation, yards after contact, QBR)? | Need PFF/FTN/NGS/ESPN licences | Yes; EPA per play stands in for QBR, as the PRD suggests |
| NP-P8 | Use FTN charting data (share-alike licence) at launch? | Licence terms on redistribution | No; launch on play-by-play-derived stats |
| NP-P9 | Where do people type "Manning vs Brady first 2 seasons"? There's no Stat Center search today. | PRD assumes a box that doesn't exist | A compare box on the Players page and in the Compare overlay; rules first, AI fallback under the daily limit |
| NP-P10 | "Same age" compare: is age on Sept 1 of each season good enough? | Game-level age needs more storage | Yes, labelled "seasons through age X" |
| NP-P11 | Era-adjusted: scale to which modern season? | PRD doesn't name a base | 2021–2025 average per position, scaled to 17 games |
| NP-P12 | Public profile for every player since 1999 (~6–8k pages) or only some? | Thin pages can hurt search | A page for every QB/RB/WR/TE who played; sitemap lists only players with a claim or active |
| NP-P13 | How do we pick "popular" comparisons for the sitemap? | Nothing records it today | Count how often each comparison is viewed or shared as an image; list the top 500 pairs |
| NP-P14 | Should Player Profiles and the Scout spec share one stat dictionary and one data-credit line? | Two specs define the same thing | Yes |
| NP-P15 | One public player page, or keep Scout §8.5's separate /scout player pages too? | Duplicate public pages | One: `/players/[slug]` |

### 4.5 Manager Profiles & Versus (the PRD's implicit questions)

| ID | Question | Why it matters | Recommendation |
|---|---|---|---|
| NP-V1 | When a season ends, does the commissioner hit "Renew league" to get next season with the same teams and managers, history linked? | No PRD mentions renewal (the Manager PRD only says to keep seasons and matchups across seasons). Without renewal or import, "all-time" is one season forever. V.1.4, V.1.5's renewal parts and `/api/leagues/[id]/renew` are only built if you say yes | Yes, a commissioner Renew on a finished league (ESPN/Yahoo/Sleeper all do it) |
| NP-V2 | Do the 2026 test leagues count toward permanent records, titles and platform rank? | 2026 leagues are "test leagues" | Count for records and titles, marked "test season"; out of platform percentiles |
| NP-V3 | If someone takes over a team mid-season, who gets credit for wins and a title? | We only record the moment someone took over a team, not which week that was | Each week to whoever was in charge when that week's games started; the title to the manager for the championship game |
| NP-V4 | Do weeks where the commissioner edited your lineup count toward start/sit accuracy? | Not your decision that week | Leave them out of start/sit and optimal lineup; they still count for record |
| NP-V5 | Which benched players count as a start/sit "call" (bye, out, IR)? | PRD: "both eligible for the slot" | Only bench players eligible for the slot who played that week; IR never |
| NP-V6 | What is "replacement level" for waiver hit rate? | Undefined in the PRD | Per league and position: best unrostered player that week; kept adjustable |
| NP-V7 | Drop regret and trade value: count all points afterwards, or only points in someone's starting lineup? | Changes the numbers a lot | Starter points only, from the move's week to season end |
| NP-V8 | Draft score: what's "average production at that slot" with only a few leagues? | Tiny sample in 2026 | Same pick across all real drafts that season, fallback to round; minimum sample |
| NP-V9 | Luck: regular season only, and do median games count? | Leagues can play median games | Regular-season head-to-head only; expected wins = how you'd have done if you played every team every week |
| NP-V10 | Which rank ladder is the profile headline: cred (Freshie…GOAT) or skill (Rookie…Hall of Fame)? Cred's tiers include "Rookie", "All Pro" and "Hall of Famer" (`src/lib/cred-tiers.ts:18,20,22`); the Manager PRD's skill tiers include "Rookie", "All-Pro" and "Hall of Fame". | Two ladders with clashing words. Cred is live: the profile pages show it, and the mobile Profile Cred card shipped today (#468), so renaming cred changes something people already see | One skill ladder (skill stats + Duel); cred stays as the rankings badge, renamed so names don't clash (this touches the shipped Cred card and every cred badge) |
| NP-V11 | Is "Rankings accuracy" in for launch? | Weekly rankings have no accuracy scoring today | Leave it out until weekly rankings return |
| NP-V12 | How are skill stats weighted, and what's the minimum before a rank shows? | PRD: "weighted and normalized, e.g. 4 weeks" | Equal weights, adjustable; 4 scored lineup weeks |
| NP-V13 | Show platform percentiles with a few dozen managers? | Meaningless at cohort size | Hide until at least 50 ranked managers; league ranks from day one |
| NP-V14 | Privacy: what does "Friends" mean? We only have one-way follows. | PRD option "Friends and leaguemates" | Friends = mutual follows; or ship Public / Leaguemates / Private |
| NP-V15 | Does Versus replace the league's Stats tab, or sit next to it? | "Delete nothing" + six tabs already | Rename Stats to Versus; today's head-to-head becomes the rivalry view |
| NP-V16 | On a public profile, can strangers see your league names on trophies? | League data is member-only | Show league name + year on trophies only |
| NP-V17 | What does a season "finish" mean? | Only the champion is stored | Champion / runner-up / third / lost in round N / missed playoffs, like ESPN history |
| NP-V18 | Imported seasons: records only, or skill stats too? | Other platforms' lineup data is uneven | Records, matchups, titles only |
| NP-V19 | Which import first? | Sleeper is free and open; Yahoo needs an app; ESPN needs users' login cookies | Sleeper, then Yahoo; ESPN parked |
| NP-V20 | Does renewal carry anything beyond settings, teams and managers (e.g. keepers, draft order by finish)? | Keepers aren't in scope this year | Settings, scoring, team names, seated managers only; keepers later |

---

## 5. External dependencies to confirm before building

Confidence labels come from the verified research (2026-10-18). "Contact sales" means no published price.

### 5.1 Live per-quarter feed (Duel's hard dependency)
**What we need:** per-player per-quarter stats, or play-by-play with a quarter on every play; quarter start/end events with low latency; at least 1 update per 15 s; inactives ~90 min before kickoff; stat corrections; playoff coverage; a licence for a free public consumer game; an attribution rule.

| Candidate | Facts | Confidence | Fit |
|---|---|---|---|
| SportsDataIO | Box Score Live (team quarter table), Play-by-Play Live (recommended 1-min interval), Box Score Delta; **no documented per-player quarter splits**; free **Replay** of select recorded weeks (2023 wk12/14, 2023 playoffs, 2025 wk1); commercial price **contact sales**, quote same business day; personal-use Discovery Lab can't back a public app | medium–high | Best-documented; check the play-by-play quarter field in the spike |
| Tank01 (RapidAPI) | Free 1,000 calls/month; Pro $10/mo (1,000/day); Ultra $25/mo (15,000/day); "real-time in-game stats" advertised; **play-by-play not advertised**, latency unproven; one game at 15 s ≈ 840 calls | low | Cheapest real trial |
| Sportradar NFL v7 | Play-by-play/box score 3 s TTL in game, push feeds for real-time customers, 30-day real-data trial (~1,000 calls); price **contact sales** (third-party ~$500–1,000+/mo, unverified) | high (TTL) / low (price) | Quality benchmark |
| Goalserve | $300 per month; live box scores and player stats; play-by-play/quarters not listed | medium | Fallback |
| MySportsFeeds | From CAD $39/mo core non-live; box score/play-by-play add-on and live prices unpublished | high (listed) | Weak |
| Rejected | ESPN unofficial API (terms bar automated access), Sleeper (weekly totals, 5-min cache), API-Sports (no player quarters), SportsGameOdds (odds product), nflverse (next-day; **replay fixtures only**) | — | — |

**What Chris must do:** approve a spike budget; open a SportsDataIO Replay account and request a quote; optionally subscribe Tank01 Pro/Ultra for one month in a game week; optionally start a Sportradar trial *only* in a week with games, because the trial is a 30-day clock.

**Spike measures:** whether each stat carries a quarter, quarter-end lag versus the real game, fantasy-point reproducibility versus nflverse next-day totals, calls and cost per Sunday at 15 s, correction behaviour Mon–Thu, gaps, and licence terms.

**Fallback if no feed:** single-game Duel ships as vs-bot and friends play on **replayed past games** (the $0 engine), and live play waits for next season.

### 5.2 YouTube Data API v3
**What we need:**
- `channels.list`, `playlistItems.list` and `videos.list` (1 unit per call of up to 50 items), against a default 10,000 units/day. Never `search.list`, which has its own 100/day bucket.
- Estimate: 33 NFL + 20 college channels comes to about 60 units for the nightly sweep, about 800 for hourly game-day polling, and about 15/day for the rolling refresh. Peak is about 900 units (under 10%), so **no quota increase or audit is needed** (high confidence).
- Policy: API-key data may be stored at most **30 days** before refresh or delete (Developer Policies III.E.4.d), so the refresh job covers the whole index in 28 days and hides anything older.
- Player rules: minimum 200×200 px, autoplay only when more than half visible and one at a time, no overlays, don't suppress the Referer.

**What Chris must do:** create a Google Cloud project, enable YouTube Data API v3, issue a server key restricted by API, and set `YOUTUBE_DATA_API_KEY` in Vercel (write-only) and `.env.local`. Accepting the YouTube API terms is the account owner's step. Then approve the channel list.

**Fallback:** the keyless channel RSS feed we already read for personas gives the latest ~15 uploads per channel with no duration or embeddable status. That's enough for a spike, not for launch.

### 5.3 Historical stats sources
- **nflverse** (free, CC-BY-4.0, high confidence): play-by-play, weekly and seasonal player stats (REG/POST via `season_type`), schedules and rosters from 1999; combine from 2000 and draft picks from 1980 (both PFR-sourced, so a licence question, NP-P6); NGS from 2016; FTN charting from 2022 (CC-BY-SA, NP-P8); id maps (gsis ↔ sleeper/espn/yahoo/sportradar/pfr). It refreshes nightly after game days, and a Wed→Thu night re-pull picks up corrections. `nfl_data_py` was archived 2025-09-25, so the importer uses direct release-file fetches in TypeScript (the house "plain fetch" pattern).
- **Pre-1999:** no open source. Sports Reference terms bar scraping and competing databases, so this needs a licensed source (contact sales; none chosen).
- **What Chris must do:** approve the "Data via nflverse" attribution line and rule NP-P2, P6 and P8.
- **Fallback:** "since 1999" labels (the PRD's own fallback).

### 5.4 League history import
| Platform | Facts | Confidence | Plan |
|---|---|---|---|
| Sleeper | Official read API, no auth, stay under ~1,000 calls/min; league (with `previous_league_id` for season chaining), rosters, users, matchups/week, transactions, drafts, brackets; **free for non-commercial use** | high | First; email Sleeper first (NP-Q9) |
| Yahoo | Official Fantasy API, OAuth 2.0 app (consumer key/secret), past seasons by per-season game id; a third-party report says new apps may be refused (unverified, check in a spike); rate limit not documented | high / low | Second; Chris registers the app; needs an owner-only encrypted token store |
| ESPN | No official API; unofficial endpoints; private leagues need users' `espn_s2`/`SWID` login cookies; Disney terms bar automated access | medium | **Parked** (credential handling + terms) |

**Fallback:** native renewal (V.1.4) gives history from 2026 onward with no import.

### 5.5 Platform limits
- **Vercel Hobby** (high confidence): Fluid Compute gives functions up to 300 s; 1M invocations, 4 h Active CPU and 100 GB transfer per month; crons once a day at most (±59 min), so all sub-daily work stays on pg_cron. Hobby is **non-commercial only**, so any ads, Pro tier or sponsorship forces Vercel Pro (paid). A 15 s Duel ping is ~240 invocations an hour while games are on; measure Active CPU during the spike.
- **Supabase** (confirm the plan): Realtime is 200 concurrent connections / 100 msgs/s on Free and 500/500 on Pro, shared with live drafts. The hosted database is **447 MB** *(measured 2026-10-21, `pg_database_size`, hosted)* against Free's 500 MB cap — up from the ~415 MB the research pass reported three days earlier — so the warehouse must be season-level (~55k rows), must never store raw play-by-play, and P.1.3 re-measures before it runs against hosted. Supabase recommends at most 8 concurrent cron jobs; we have 13 scheduled today (198 added `ingest-player-news-ping` every 30 minutes), and this phase adds `duel-live-ping` (15 s), `duel_tick` (5 s), `ingest-highlights-ping` (hourly) and analytics jobs.
- **What Chris must do:** confirm the plan before Duel Live and before the history import runs against hosted.

---

## 6. Milestone plan

Columns: **Size** S/M/L · **Rigour** FULL (adversarial review until clean, pgTAP per role, break probes: scoring, standings, permissions, production writes) or ONE PASS · **Mig** = adds a migration (numbers taken at task start, §6.6) · **Dep** = depends on.

### Phase 1 — now → the playoffs: Duel Live single-game + Highlights

#### NP0 — Setup (flag: none — infrastructure, see the flag note below) · **start immediately after approval (order pending NP-Q11)**
**Goal:** the build can run four tracks safely; the launched app's playoff bug is fixed.
**Exit/gate:** PROGRESS-next-phase + ACTIVE-BUILD live; flags read their env literally (unit); nav entries render only with flags on (render + route-group tests); the public route kit serves a signed-out page (e2e); P.1.0's week-19 fixture never reaches a season total.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| X.0 | PROGRESS-next-phase, ACTIVE-BUILD lanes, per-track task docs, supersession notes | S | ONE PASS | n | plan approved | `tasks-NP-*.md` in M8 format; mark C15/C16 superseded |
| X.1 | Flags `duel`, `duelMultiGame`, `duelWeek`, `highlights`, `watch`, `playerProfiles`, `publicPlayerPages`, `managerProfiles` | S | ONE PASS | n | X.0 | Literal env reads; `.env.example`; new `feature-flags.test.ts` |
| X.2 | Dark nav slots for Watch and Duel (desktop + mobile mapping) | S | ONE PASS | n | X.1 | Final phone layout per NP-Q6 |
| X.3 | Public route kit: `(public)` group, anon client, cache tags, sitemap families, `robots.ts`, JSON-LD helper | M | ONE PASS | n | X.1 | No public page content yet |
| X.8 | Rate-limit keys for Duel and Highlights on the shared limiter | S | FULL (permissions) | y if X.8 lands before M7 L.F2.6, else n | X.0, M7 L.F2.6 (C42) | Reuses L.F2.6's `rate_limits` + REVOKEd `rate_limit_claim`; ships the mechanism itself only if L.F2.6 hasn't landed (then L.F2.6 adopts it). Older schema: the server helper sees the RPC missing (`isDoorNotPushed`) and refuses the limited action with a named 503 — never allows it unlimited |
| X.9 | Notifier convention + `notificationHref` arms pattern | S | ONE PASS | n | X.0 | Reuse `notify_league_member_internal` |
| X.10 | CI lanes + time fence for `src/lib/{duel,highlights,profiles,versus}/**` | S | ONE PASS | n | X.0 | `db.yml` both lists, trigger test, `.eslintrc.json:5` fence extended to `src/lib/duel/**` and `src/lib/versus/**` (+ any league-touching analytics/import code); import fetches via an injected adapter |
| X.11 | Job recipe + health keys (docs) | S | ONE PASS | n | X.0 | pg_cron ping recipe; per-route `system_flags` key |
| X.12 | Beta allowlist (**fallback only — if NP-Q3 wants a hard list rather than the challenge-links rung**) | S | FULL (permissions) | y | X.1 | Owner/operator-only `beta_memberships` table (not a world-readable `profiles` column); operator-written; no self-grant. M7's beta ladder (TD8) chose no per-user list for leagues; this exists only if you want one for Duel. Older schema: table absent → every beta-gated surface treats the viewer as not on the list |
| P.1.0 | "Last season" = regular season only (**after NP-P1**) | S | ONE PASS | n | NP-P1 | Cap the five readers at week ≤ 18 (+ `pageAll` in `seed-big-board`) |

**Risks:** 195/#446 (merged) rewrote the builder route and `core-stats-service.ts`; P.1.0 and the H4 rows build on that merged shape, so no rebase dependency remains. X.12 is a permission change, so it gets FULL review.

**Flag note (for you to confirm).** NP0, X1 and H1 say "flag: none" because they have no user-facing surface: NP0 is setup and a bug fix, X1 changes how playoff weeks are stored, and H1 fills the video index. H1's one screen, the Admin review list, is admin-only (404 to everyone else) **and** also sits behind `highlights`, so it stays dark in production until you flip the flag. If you'd rather every milestone have its own flag, X1 can get a kill switch in `system_flags` instead (a build-time flag can't gate an ingest job).

#### D-M0 — Duel data spike (flag: `duel`, nothing user-facing)
**Goal:** prove the quarter engine for $0 and choose a feed.
**Exit/gate:** a recorded 2025 game replays through poller + write door at ≥ 64× and each player's quarter PPR sums to the Sleeper weekly line (gaps listed, not tolerated); the feed memo is decided by Chris; the 15 s guarded ping sends nothing when no game is near.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| D.0.1 | Feed decision memo (`docs/specs/duel-feed-decision.md`) | M | ONE PASS | n | NP-Q2 | Spike per §5.1; no paid account without approval |
| D.0.2 | Period capability contract + synthetic quarter splits + fixture format v2 | M | ONE PASS | n | X.10 | Additive `getGamePeriods`/`getPeriodStats`; v1 fixtures byte-identical |
| D.0.3 | nflverse play-by-play → quarter replay fixtures (2025) + move CSV reader to `src/lib/nflverse/` | M | ONE PASS | n | D.0.2 | Plain fetch; gsis→Sleeper via roster file; parity test |
| D.0.4 | Migration: `nfl_game_periods`, `player_period_stats`, `duel_period_points`, write door | M | FULL | y | D.0.2 | Public/signed-in read; service-only write; OT = period 5. Older schema: nothing reads these tables until D.0.5; the poller sees the door missing and records `duel_stats_degraded`, never writes elsewhere |
| D.0.5 | Duel poller + `/api/cron/duel-live` + gated '15 seconds' ping + `DUEL_RULES` | M | FULL | y | D.0.4 | Own degraded flag; export `CORE_OFFENSE` or derive from templates. **Single-flight pinned here** (§2.1): one poll per invocation, budget ≤ 10 s under an advisory-lock lease, or the 60 s ping × 4 rounds shape; route test pins `maxDuration` > budget. Older schema: the ping SQL ships in the same migration, so nothing calls the route before it's pushed; if called anyway, a missing door → named 503 |
| D.0.6 | `npm run duel:replay` harness CLI | S | ONE PASS | n | D.0.3, D.0.5 | Virtual clock at N× |
| D.0.7 | Live feed adapter (**only after Chris approves a feed**) | M | FULL | n | D.0.1, D.0.5 | Zod-validated, loud emptiness; record first live fixture |

**Risks:** no vendor gives per-player quarter splits directly, so the adapter may have to roll up play-by-play. Feed latency could exceed 15 s. A Duel feed failure must never affect league scoring (separate route, separate flag).

#### X1 — Postseason weeks (flag: none) · **deadline: on production before wildcard weekend**
**Goal:** playoff games, weeks and stat lines are stored as weeks 19–22.
**Exit/gate:** pgTAP seeds/constraints; a stack test where a synthetic wildcard week ingests and **no league row is written** (break probe: remove the guard and the test goes red); nflverse mapping unit tests; the sync-stats route requests week 19 when Sleeper reports `post` (unit, with `nfl-state` stubbed) while weekly-ranks still sees 18; the new code run against the 196 schema (no 19–22 rows) skips postseason work with a reason and writes nothing; the measured count of existing week ≥ 19 rows recorded in PROGRESS.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| X.5 | Postseason as weeks 19–22 across calendar, schedule, stats, projections | L | FULL | y | X.0, NP-Q7 | `nfl_weeks` 19–22 + phase; `game_type 'post'`; Sleeper postseason reads (check its week numbering); live-poll HOT normally; `src/lib/sports-data/nfl-state.ts:42` (`season_type === 'post'` → 18) and its `/api/cron/sync-stats` caller, so the Tuesday sync can request 19–22. Season-long boards (weekly-ranks, big-board/week, lists, explore) keep the documented 18 pin unless you rule otherwise (NP-Q7): the sync gets a separate postseason-aware read rather than a changed `getCurrentNflWeek`. **Older schema:** every postseason read (projections, stats, schedule) first reads whether `nfl_weeks` has rows for 19–22 and skips postseason work with a logged reason when it doesn't — never assumes them — because `player_weekly_projections` has an FK to `nfl_weeks` (`136:106`) and `ingest-week.ts:1193` throws "the calendar seed is missing" for an explicit week |

**Risk:** this changes production ingest *during the season*, and standard league play is the priority, so it gets FULL review, a break probe, and a push only in a quiet window agreed with Chris.

#### H1 — Video index (flag: `highlights` on its one surface, the admin review list; ingest has no flag — see the NP0 flag note)
**Goal:** official NFL + 32 team channel uploads indexed, matched to players, refreshed inside 30 days.
**Exit/gate:** pgTAP RLS per role on the four tables; matcher precision ≥ 0.95 at the shown threshold on ~100 real titles (goldens, no network); a 0-video ingest run states why; the refresh covers N rows within 28 days; non-admins get 404 on the review list.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| H.1.0 | Fold highlights rulings into the PRD changelog | S | ONE PASS | n | X.0 | Docs |
| H.1.1 | Migration: `video_sources`, `videos`, `video_players`, `video_teams` | M | FULL (RLS) | y | H.1.0 | Public read of live embeddable rows; service writes |
| H.1.2 | Shared feed lib + YouTube Data API client | M | ONE PASS | n | H.1.0, §5.2 key | Move `feeds.ts` to `src/lib/feeds/`; never call `search.list` |
| H.1.3 | Source seed: NFL + 32 team channels | S | ONE PASS | n | H.1.1, H.1.2 | Reviewed TS constant; ~33 units once |
| H.1.3b | Source seed: college conference channels (**after NP-H8**) | S | ONE PASS | n | H.1.3, NP-H8 | The four power-conference channels (recommended), so H2's College row has data; programs added later in Admin. If NP-H8 says none at launch, H2's College row stays hidden until H6 and NP-H9 changes to match |
| H.1.4 | Matcher + classifier (pure) — **extends the player-news name matcher**, never a second one | M | ONE PASS | n | H.1.2 | Build on `src/lib/news/match.ts` (198 / #492: `name_team` and `unique_name` rules over the rostered `players` table, with its tests); add nickname, opponent-in-title, publish-date-vs-roster disambiguation and a confidence score; shared-name guard; Shorts flag; matchup → `nfl_games`. Promote the matcher to a shared lib (`src/lib/matching/`) so news and video use one |
| H.1.5 | Ingest job: route, script, hourly pg_cron ping, backfill | M | FULL (prod writes) | y | H.1.1, H.1.3, H.1.4 | **Template is 198's news ingest** (`src/lib/news/ingest.ts` + `/api/cron/ingest-player-news` + the `ingest-player-news-ping` pg_cron row): plain fetch per source with per-source and whole-run budgets, capped bodies, idempotent upserts, one failing source reported never fatal. Watermarks; game-day gate from `nfl_games`; works if ping isn't pushed. Older schema: route sees the four tables missing → named 503 + `system_flags` health key says why; no partial writes |
| H.1.6 | Refresh job + report-unplayable route | S | FULL (prod writes) | n | H.1.5, X.8 | 30-day guarantee; re-check via API, never trust the client |
| H.1.7 | Admin review list + source toggles | M | ONE PASS | n | H.1.5 | `/app/admin/highlights`, 404 to others |

**Risks:** same-name defenders aren't in `players` (optional admin aliases, `player_aliases`, are an H1 implementation choice for the PRD's "Admin review list" — no separate PRD line; dropped if review overrides suffice); the 30-day policy must be honoured; YouTube key timing depends on Chris.

#### H2 — Highlights in the player view + NFL team page (flag: `highlights`) · **ships to everyone**
**Goal:** play button + This season / NFL career / College rows on desktop and mobile; team page recap strip.
**Exit/gate:** flag off = today's view exactly (render test); empty = one quiet line; the College row renders only when college videos exist (H.1.3b) and is hidden otherwise; a DB error returns 5xx, never an empty 200; video sheet error codes 100/101/150 skip and report.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| H.2.1 | Highlights read API + hooks (player, NFL team) | S | ONE PASS | n | H.1.5 | Threshold rule; anon cache tagged `videos` |
| H.2.2 | `VideoPlayerSheet` + video store (**needs NP-H16**) | M | ONE PASS | n | H.2.1 | IFrame API (nocookie), queue, muted pref, drag-to-dismiss prop on `MobileSheet` |
| H.2.3 | Desktop player view rows + play button | S | ONE PASS | n | H.2.2 | A `highlights` section beside the new `news` section (`player-detail-page-view.tsx:159-163`, #492), between `SeasonTable` and `SectionToggles`; the YouTube play mark is white or black on its surface, never red (CLAUDE.md, Chris 2026-10-18) |
| H.2.4 | Mobile player profile rows + play button | S | ONE PASS | n | H.2.2 | Summary tab, light/dark |
| H.2.5 | NFL team page highlights | S | ONE PASS | n | H.2.2 | Recap + top plays |
| H.2.6 | Anonymous play counter (**only if NP-H17 says measure from launch**) | S | ONE PASS | y | H.2.2, X.8 | `/api/highlights/play`: definer insert of (video, surface, day), no viewer id, behind X.8's limiter; feeds the PRD success metrics. Older schema: table absent → the route answers 204 and logs, never breaks playback. Phase 3's `video_plays` (H6) replaces or extends it |

#### D-M1 — Slates and the quarter planner, single-game first (flag: `duel`)
**Goal:** every NFL game has a single-game slate with projections; a user can plan Q1–Q4 × 3 on web and phone.
**Exit/gate:** pgTAP: a flexed game moves the lock, a postponed single-game slate voids, RLS read-only; `autoPlan` respects ≤ 2 quarters/player and ≤ 1 QB/quarter and is optimal on small fixtures; flag-off redirect pinned.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| D.1.1 | Migration: `duel_slates`, `duel_slate_games`, `duel_slate_players` + generator | M | FULL | y | D.0.4 | Tuesday + on schedule change; tightens the D.0.5 ping guard to open slates. Older schema: Duel pages read slates through a door that answers a named 503 and the hub shows "Duel isn't open yet" |
| D.1.2 | Duel hub + game picker (web) | M | ONE PASS | n | D.1.1, X.2 | Primetime first, then every game |
| D.1.3 | Quarter planner (web) + pure auto-plan | M | ONE PASS | n | D.1.2, NP-D18 | Usage meter = player-card variant; mini card first |
| D.1.4 | Mobile hub + planner | M | ONE PASS | n | D.1.3, NP-Q5 | `ByLayout`, m-* tokens |

#### D-M2 — Scoring engine (flag: `duel`)
**Goal:** server-authoritative plans, locks, carry-over, scores and results.
**Exit/gate:** `scripts/gate-duel-m2.sh`: ≥ 3 replayed 2025 games plus OT, postponed and feed-outage scenarios through poller + tick + finalizer; entry scores equal an independent per-quarter sum; every refusal named in pgTAP; concurrent double-submit serialised.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| D.2.1 | Migration: `duel_entries`, `duel_quarter_picks`, `duel_set_plan` | L | FULL | y | D.1.1 | Row lock + `ENABLE ALWAYS` trigger; locks from `nfl_game_periods` |
| D.2.2 | Entry score view + write-door refresh | M | FULL | y | D.2.1, D.0.5 | `CREATE OR REPLACE` the door from chain HEAD |
| D.2.3 | `duel_tick` (pg_cron 5 s, pure SQL) | M | FULL | y | D.2.1 | Lock next quarter, carry-over/auto-fill, freeze while degraded, heartbeat. Older schema: the cron job is created in the same migration as the function, so nothing fires before push; app code never calls `duel_tick` |
| D.2.4 | `duel_duels` + finalizer + tiebreakers + void | M | FULL | y | D.2.2 | Final = last game final + 2 h |
| D.2.5 | M2 gate | S | ONE PASS | n | D.0.6, D.2.3, D.2.4 | Output shown in PR (the gate *proves* the FULL tasks above; the script itself is not scoring of record) |

#### D-M3 — Live Duel vs bot, single-game (flag: `duel`) · **first playable (audience recommended: beta list, pending NP-Q3)**
**Goal:** play a full game against Easy/Medium/Hard bots, live or on replay.
**Exit/gate:** e2e vs bot on the synthetic provider; a non-participant can't read the topic; unrevealed picks never in a payload; bots deterministic under seed; operator void proven end to end.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| D.3.1 | Bot entries + `duel_create_vs_bot` + per-slate caps | M | FULL | y | D.2.4, X.8 | One squad per user per game |
| D.3.2 | Bot brains | S | ONE PASS | n | D.3.1, D.1.3 | Seeded `deriveStream` |
| D.3.3 | Realtime `duel:<id>` spine + policy + broadcast triggers | M | FULL | y | D.3.1, D.2.2 | Budget pin updated |
| D.3.4 | Live Duel screen + change sheet (web) | L | ONE PASS | n | D.3.3 | "Changes paused" banner; server-deadline countdowns |
| D.3.5 | Mobile Live Duel + change sheet | M | ONE PASS | n | D.3.4 | Light/dark |
| D.3.6 | Opponent picker (bot) + first-duel tutorial | S | ONE PASS | n | D.3.4 | Bot difficulty is new UI |
| D.3.7 | Duel notifications (in-app) | S | ONE PASS | y | D.3.1, X.9 | Lineup not set (30 min before lock), starter ruled out before kickoff, Duel final. (Challenge/match/window/change types are added by D.4.1, D.4.2, D.5.2, D.6.3; Duel Week slot types by D-M7) |
| D.3.8 | Operator freeze/void a slate | S | FULL | y | D.2.4 | M8 console verb + receipt |

#### D-M4 — Challenges, Swap Windows, results (flag: `duel`) · **PRD launch target: "against bots and friends"**
**Goal:** challenge a friend by link or username; sealed windows with reveal; results + share card.
**Exit/gate:** pgTAP: single-use token, expiry, rate limit, can't accept your own challenge; early window close, 2-change cap, simultaneous reveal decided by server time; OG route returns an image for a final duel and 404 otherwise.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| D.4.1 | `duel_challenges` + create/accept + `/duel/c/[token]` | M | FULL | y | D.3.1, X.8 | Unranked default, ranked toggle; notifications "challenge received" and "challenge accepted" |
| D.4.2 | Sealed swap windows (single-game: end Q1 90 s / half 5 min / end Q3 90 s) | M | FULL | y | D.2.3 | Replaces D.2.1's derived lock (`CREATE OR REPLACE` from HEAD); notifications "window opening" (only if opted in or your next quarter isn't set) and "your change took effect" |
| D.4.3 | Window takeover + reveal UI (web + mobile) | M | ONE PASS | n | D.4.2, D.3.5 | Offered, never forced |
| X.7 | Share-card / OG renderer | M | ONE PASS | n | X.3 | Shared frame + fonts + templates |
| D.4.4 | Results screen + Duel share card + highlights reel of deciding players | M | ONE PASS | n | D.2.4, X.7, H.2.2 | Best pick, both usage grids, rematch |

**Phase 1 risks:** the feed approval date sets the whole Duel calendar. Realtime connections are shared with drafts. Notifications only reach an open app. The playoff window is short, and a void path must exist for every failure. Standard league play stays the priority, so Duel ingest, ticks and realtime are all separate from league jobs, and X.5 carries a "no league row" proof.

#### H3 (league surfaces, flag `highlights` + `leagues`, cohort) and H4 (Watch tab, flag `watch`, everyone — recommended, pending NP-Q3) — Phase 1 tail
**Exit/gate:** icons only where a clip exists; reels ordered by points; rows with < 3 clips hidden; weekday ordering tested with a virtual clock; flag off = no nav item and the route redirects; a no-league user path exists.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| H.3.1 | Team page play icons + "Watch your week" | M | ONE PASS | n | H.2.2 | Batch latest-clip endpoint (Zod, capped) |
| H.3.2 | Matchup "Watch the matchup" | S | ONE PASS | n | H.3.1 | |
| H.3.3 | League home "League highlights this week" | S | ONE PASS | n | H.3.1 | Ranked by `league_week_player_points` |
| H.3.4 | Waiver play icons + research Trending icons | S | ONE PASS | n | H.3.1 | |
| H.4.1 | Migration: `user_favorites` + settings + one-time ask | M | FULL (RLS) | y | H.1.1, NP-H7 | Owner-only. Older schema: table absent → no ask card, settings section hidden, Watch rows fall back to no-favorites ordering |
| H.4.2 | Watch rows service | M | ONE PASS | n | H.2.1, H.4.1 | TS service; canonical preset scorer |
| H.4.3 | Watch tab desktop + nav | M | ONE PASS | n | H.4.2, NP-Q10 | Hero, chips, rows, See all |
| H.4.4 | Watch tab mobile + dock | M | ONE PASS | n | H.4.3, NP-Q6 | |

#### H5 — Public highlight pages (flag `publicPlayerPages`) · stretch for Phase 1, otherwise launched with P5
**Exit/gate:** pages serve signed-out from ISR (e2e with no cookie; a second request is a cache hit); `VideoObject`/`SportsEvent` JSON-LD validates against schema.org shapes (unit, with `<` escaping pinned); the sitemap lists only pages with ≥ 1 video (a 0-video player/team is absent); flag off = 404 and no sitemap family; slugs from X.4 never rewritten (pgTAP).

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| X.4 | Identity: `nfl_players` (gsis, slug, sleeper/pfr/espn ids, draft, headshot) + crosswalk sync | M | FULL (RLS on a new table + production writes by the crosswalk sync) | y | X.0; reuse the 195/#446 crosswalk | Slugs never rewritten; coverage measured (incl. re-measuring the `players` row counts quoted in §1.3). Older schema: public pages see the table missing → 404, never a guessed slug |
| H.5.1 | `/players/[slug]/highlights`, `/nfl/[team]/highlights` | M | ONE PASS | n | X.3, X.4, H.2.1, NP-Q4 | ISR, unique text, `VideoObject` JSON-LD |
| H.5.2 | `/nfl/[season]/week/[n]/top-plays`, `/games/[id]` | M | ONE PASS | n | H.5.1 | `SportsEvent` JSON-LD |
| H.5.3 | Sitemaps + revalidation after game days | S | ONE PASS | n | H.5.2 | Only pages with ≥ 1 video |

### Phase 2 — before next draft season: Manager profiles + history import + Versus + Player profiles v2 (+ Duel M5–M6 built for Week 1)

#### P1 — Stats foundation (flag `playerProfiles`)
**Exit/gate:** pgTAP RLS/CHECKs; the importer is idempotent (re-run writes 0); hand-checked report (e.g. Puka 2025 REG 1,715 yds); the daily refresh treats an unpublished file as "not yet published", never as zeros.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| P.1.1 | Shared stat registry (code) + attribution constant | M | ONE PASS | n | X.1 | Scout shape + PRD fields; NP-P14; includes the PRD's milestone stats (100+ yard games, "fastest to 10,000 yards") as registry entries |
| P.1.2 | Migration: `player_seasons`, `combine_results` | M | FULL (RLS) | y | X.4, P.1.1 | `season_type REG|POST`. Older schema: profile v2 sections see the tables missing → 503 and stay hidden (P2/P3 gate) |
| P.1.3 | nflverse history importer 1999–2025 (TS) | L | FULL (prod writes) | n | P.1.2, D.0.3, §5.5 size re-measured | Reuse the combine loader shipped in 195/#446; Chris runs it against hosted |
| P.1.4 | Daily current-season refresh | M | FULL | n | P.1.3 | One Vercel daily cron |

#### P2 — Leaderboards · P3 — Profile v2 (flag `playerProfiles`) · **ships to everyone**
**Exit/gate:** a mid-run failure leaves the previous run visible; ranks tie-correct; flag off = today's view exactly; `player-click-routing.test.ts` unchanged; missing tables → 503 and v2 hidden.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| P.2.1 | Ranking engine ops (pools, scopes, qualifiers, ties) | M | ONE PASS | n | P.1.1 | `src/lib/ranking/`; milestone-stat counts from the registry |
| P.2.2 | Migration: `leaderboard_runs`, `leaderboards`, `player_ranks`, `player_claims` | M | FULL (RLS) | y | P.1.2 | Latest-complete-run view |
| P.2.3 | Nightly leaderboard job | M | FULL (prod writes) | n | P.2.1, P.2.2, P.1.4 | Generation swap; `revalidateTag`; recompute after each game day for active players (the PRD rule), full rebuild nightly |
| P.2.4 | In-app leaderboard view + scope toggle (tabs variant) | M | ONE PASS | n | P.2.3 | "since 1999", "as of" |
| P.3.1 | Claims engine (shared with managers) | M | ONE PASS | n | P.2.3 | Thresholds per PRD |
| P.3.2 | Profile read API | M | ONE PASS | n | P.3.1 | Key = Sleeper id or slug |
| P.3.3 | Desktop player view v2 (modal) | L | ONE PASS | n | P.3.2 | Nothing removed; highlights slot |
| P.3.4 | Receipts popover | S | ONE PASS | n | P.3.3 | Definition, scope, source |
| P.3.5 | Mobile player profile v2 | M | ONE PASS | n | P.3.3 | History tab past ranks filled |

#### P4 — Compare + share cards · P5 — SEO launch (flags `playerProfiles`, `publicPlayerPages`)
**Exit/gate:** each compare mode (Career / Same age / First N / Peak 3) unit-tested on hand-checked pairs, including a tie and a player with a missing season; every share card carries the scope line (render test fails without it); `/compare/[a]-vs-[b]` redirects the reversed pair to canonical order; flag off = 404 on every public route and no sitemap family; signed-out ISR serve (e2e).

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| P.4.1 | Compare ops + API | M | ONE PASS | n | P.3.2 | Career / Same age / First N / Peak 3 |
| P.4.2 | Compare overlay + historical player picker | M | ONE PASS | n | P.4.1 | New Zustand store; up to four players on desktop (PRD) |
| P.4.3 | Natural-language compare entry | M | ONE PASS | n | P.4.2, NP-P9 | Rules parser; optional Haiku fallback with explicit limit |
| P.4.4 | Share cards (claim, stat, comparison) | M | ONE PASS | n | X.7, P.3.1, P.4.1 | Scope line always present |
| P.5.1 | Public `/players/[slug]` | L | ONE PASS | n | X.3, X.4, P.3.2, NP-Q4 | `Person`/`SportsTeam` JSON-LD; the auto-written summary sentence at the top, built from the player's top claims (the PRD's unique text for SEO) |
| P.5.2 | `/leaders/[stat]/[pool]`, `/compare/[a]-vs-[b]` | M | ONE PASS | n | P.5.1, P.2.4, P.4.1 | Canonical pair order |
| P.5.3 | Sitemaps (+ optional `compare_popularity`, **only if NP-P13 picks counting**) | M | ONE PASS (FULL if RPC) | opt | P.5.2, NP-P13 | The PRD asks for "popular comparisons" in the sitemap; the counter table is the plan's way to find them, not a PRD table |

#### V1 — History foundation · V2 — Versus tab (flags `managerProfiles` + `leagues`) · **league cohort**
**Exit/gate:** pgTAP for takeover between weeks, mid-week takeover, vacancy gap, second stint and former member (RLS walk anon / non-member / member / former member); renewal (only if NP-V1 = yes): commissioner only, from complete only, idempotent, stints opened, invites for vacated seats; two-season sim fixture; expected-wins math unit tests.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| V.1.1 | PRD changelog fold + Versus section in PROGRESS | S | ONE PASS | n | X.0 | Docs |
| V.1.2 | Stint-attributed matchup/week reads (by timestamp) | M | FULL (permissions, standings) | y | V.1.1 | SECURITY DEFINER member-gated reads. Older schema: every Versus/manager surface calls these through `isDoorNotPushed` → named 503, and the league Stats tab keeps today's view |
| V.1.3 | `manager_seasons` / `league_manager_seasons` RPCs | M | FULL | y | V.1.2 | Former members still see own history |
| V.1.4 | Lineage columns + `renew_league` (**contingent on NP-V1** — no PRD asks for renewal; built only if you say yes) | L | FULL (prod writes, permissions) | y | V.1.1, NP-V1 | `CREATE OR REPLACE` seat/assign doors from HEAD (196/169). Older schema: the Renew button is hidden when the RPC is missing; lineage columns are nullable, so old code is unaffected |
| V.1.5 | Lineage-aware reads + season picker (desktop + mobile "Previous seasons") | M | FULL (permissions: member-gated cross-season reads) | y | V.1.3, V.1.4 (renewal parts only if NP-V1 = yes; otherwise V6 import supplies past seasons) | Older schema: season picker hidden, "Previous seasons" keeps today's stub |
| V.2.1 | `league_versus` read: table + H2H matrix + luck | M | FULL (standings, permissions: member-gated definer read) | y | V.1.2 | Older schema: 503 → Stats tab unchanged |
| V.2.2 | Versus tab desktop + league table (**NP-V15**) | M | ONE PASS | n | V.2.1 | `UsernameLink` everywhere |
| V.2.3 | Head-to-head grid | S | ONE PASS | n | V.2.2 | Fill, no resting shadow |
| V.2.4 | Rivalry page | M | ONE PASS | n | V.2.1 | One streak rule; "Trades between you, with who won each one in hindsight" (PRD; uses V.3.3's trade value once it ships, hidden until then); "Challenge to a Duel" button once D-M4 ships (hidden before, never a stub) |
| V.2.5 | League records (results-based) | S | FULL (standings) | n | V.2.1 | Highest single-week score, longest win streak, most titles |
| V.2.5b | League records (draft and trade) | S | ONE PASS | n | V.2.5, V.3.3, V.3.4 | The PRD's "best and worst draft" and "most lopsided trade" |
| V.2.6 | Mobile Versus | M | ONE PASS | n | V.2.2–V.2.4 | |

#### V3 — Skill stats · V4 — Manager profile · V5 — Skill rank (flag `managerProfiles`)
**Exit/gate:** for every finalized week in the two-season sim fixture, starters' `league_week_roster_points` equal the stored `league_week_player_points` to the cent, and bench points are scored under that week's stored rules (break probe: score a bench player under the current rules and the test goes red); start/sit and optimal-lineup % unit-tested on hand-built weeks (commissioner-edited weeks excluded per NP-V4); platform percentiles hidden below 50 ranked managers (pgTAP); visibility RLS walk anon / stranger / leaguemate / owner for public, leaguemates and private; flag off = today's profile exactly.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| V.3.1 | `league_week_roster_points` + analytics job | M | FULL (scoring) | y | V.1.2 | Starters equal stored points to the cent |
| V.3.2 | Start/sit accuracy + optimal lineup % | M | ONE PASS | n | V.3.1, NP-V4/V5 | Lift slot model to `src/lib/leagues/lineup-slots.ts` |
| V.3.3 | Waiver hit rate, drop regret, trade value | M | ONE PASS | n | V.3.1, NP-V6/V7 | Credit by payload team + stint |
| V.3.4 | Draft score | S | ONE PASS | n | V.3.1, NP-V8 | Real, non-undone picks |
| V.3.5 | `manager_skill_stats` + weekly writer + Versus columns | M | FULL | y | V.3.2–V.3.4 | |
| V.4.1 | Visibility + leaguemate helper + profile summary RPC (**NP-V14**) | M | FULL (permissions) | y | V.1.3 | Loud refusal |
| V.4.2 | Visibility setting UI | S | ONE PASS | n | V.4.1 | |
| V.4.3 | Global manager view on `/u/[username]` + `/app/profile` | M | ONE PASS | n | V.4.1 | Trophy shelf; header with "years on the platform" and number of leagues; season-by-season timeline of finishes (NP-V17); "Challenge to a Duel" on someone else's profile once D-M4 ships |
| V.4.4 | League switcher view | M | ONE PASS | n | V.4.3, V.3.5 | League lore: best week, worst loss, biggest trade (the last after V.3.3) |
| V.4.5 | You-vs-them strip (+ Duel union when live) | S | ONE PASS | n | V.4.3, V.2.4 | No stub |
| V.4.6 | Mobile manager profile + stint-correct titles | M | ONE PASS | n | V.4.3 | |
| V.4.7 | Manager headline claims | S | ONE PASS | n | P.3.1, V.3.5 | |
| V.4.8 | Rivalry share card | S | ONE PASS | n | X.7, V.2.4 | |
| V.5.1 | `manager_skill_ranks` + composite job (**NP-V10/V12**) | M | FULL | y | V.3.5 | Percentiles hidden < 50 |
| V.5.2 | Tier badge everywhere | S | ONE PASS | n | V.5.1 | |

#### V6 — History import (flag `managerProfiles` + `leagues`)
**Exit/gate:** re-running an import on the same source writes 0 rows (pgTAP + stack test); a recorded Sleeper fixture imports a two-season league whose standings match the source; every claim reassign writes an audit row and refuses a second claim of the same seat; a running league's rows (schedule, lineups, standings) are byte-identical before and after an import into another league (break probe); flag off = no import entry point.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| V.6.0 | Import spike: Sleeper (+ Yahoo access check) | S | ONE PASS | n | NP-Q9, NP-V19 | Recorded fixtures only |
| V.6.1 | `league_external_managers` + `import_source` | M | FULL | y | V.1.4 (lineage columns; if NP-V1 = no, V.6.1 adds them itself) | Seed past `nfl_weeks`. Older schema: the wizard is hidden when the RPC is missing |
| V.6.2 | `import_league_history` RPC | L | FULL (prod writes) | y | V.6.1 | Writes `league_weeks` + valid snapshot; idempotent |
| V.6.3 | Sleeper adapter | M | ONE PASS | n | V.6.2, V.6.0 | |
| V.6.4 | Claim flow for imported managers | M | FULL | y | V.6.2 | Audited reassign |
| V.6.5 | Import wizard (web + mobile) | M | ONE PASS | n | V.6.3, V.6.4 | |

#### D-M5 / D-M6 — built in Phase 2, playable from Week 1 (flags `duel`, `duelMultiGame`)
**Exit/gate:** Glicko-2 fixtures match the published worked example and a draw counts half (unit); bots, unranked and friendly duels never change a rating (pgTAP); the matchmaker fills with a bot at lock − 10 min when no human is found (virtual-clock stack test); every cap, roster and swap refusal (over 10,000 credits, swapping out a finished player, swapping in a player in his final quarter, over the Open Swaps budget, over 2 changes per window) is named in pgTAP; `scripts/gate-duel-m6.sh` replays a multi-game Sunday slate (≥ 3 games finishing at different times, one OT) with both change modes, and entry scores equal an independent per-interval sum.

| ID | Title | Size | Rigour | Mig | Dep | Scope |
|---|---|---|---|---|---|---|
| D.5.1 | Glicko-2 ratings (weekly rating period) + finalizer hook | M | FULL | y | D.2.4, NP-D5 | Bots/unranked never change ratings |
| D.5.2 | Match queue + matchmaker | M | FULL | y | D.5.1, X.8 | Bots at lock − 10 min |
| D.5.2b | "Match found" notification | S | ONE PASS | n | D.5.2, X.9 | |
| D.5.3 | Quick Match UI + duel history + results view | M | ONE PASS | y | D.5.2 | Feeds manager profile |
| D.5.4 | Duel post-game stats per user | M | ONE PASS | y | D.5.3 | The PRD list: win/loss record by slate type and by opponent; swap value (swapped-in minus swapped-out points in the same quarters); best swap ever, biggest comeback, longest win streak. Swap value and best swap fill once D-M6 swaps exist; single-game duels count quarter-pick changes per NP-D6 |
| D.6.1 | Pricing (Tuesday lock) | S | ONE PASS | n | D.1.1, NP-D18 | ~14,000-credit best squad |
| D.6.2 | Rosters, intervals, swaps + RPCs | L | FULL | y | D.6.1, D.2.2 | Every PRD rule refused by name |
| D.6.3 | Multi-game windows + boundary swap application | M | FULL | y | D.6.2, D.4.2 | Notifications "window opening" and "your change took effect" for multi-game slates |
| D.6.4 | Roster builder (web + mobile) | M | ONE PASS | n | D.6.2 | Cap meter mirror |
| D.6.5 | Multi-game live screen + bots under the cap | M | ONE PASS | n | D.6.3, D.6.4 | |
| D.6.6 | Open Swaps mode + swap budget (**NP-D17**) | M | FULL | y | D.6.2, D.6.3 | The PRD's second change mode (change any time, takes effect at the next quarter boundary, opponent sees it once it takes effect); 5-swap budget for Sunday Early and Late; tiebreak 1 counts these swaps; change sheet shows swaps left |

**Phase 2 risks:** V.1.4 renewal and V.6.2 import write league lifecycle rows, so they get FULL review and must not disturb running leagues. The warehouse size depends on the Supabase plan. Profiles and Versus share the claims engine and share cards (whichever lands first owns them). Duel M5/M6 can only be played in season.

### Phase 3 — next season (task stubs; full breakdown in its own architect pass)
Phase 3 gets **its own architect pass after the NFL Draft (late April 2027)**, once Phase 1–2 play data and the feed contract are in hand and before the July build window. The stubs below map every PRD item to a task, flag and gate so nothing is lost; sizes and rigour are provisional.

#### D-M7 — Duel Week, brackets, next-snap swaps (flag `duelWeek`)
**Exit/gate (provisional):** pgTAP proves every slot spends exactly 4 quarters (CHECK + UNIQUE on `duel_slot_quarters` + overlap trigger, refusals named); a replayed Full Sunday slate scores equal to an independent per-slot sum; bracket advancement deterministic under seed; next-snap swaps only after the feed contract is signed off by you.

| ID | Title | PRD item |
|---|---|---|
| D.7.1 | `duel_slot_quarters` four-quarter rule + Duel Week entries | "Every slot gets exactly 4 quarters" |
| D.7.2 | Full Sunday / Full Week slates + week board | Duel Week slates |
| D.7.3 | Free-changes period (NP-D3) | Changes free when no games are live |
| D.7.4 | Duel Week slot notifications | "a slot's player kicks off, and a slot is done" |
| D.7.5 | `duel_brackets`, `duel_bracket_matches` + bracket UI | Brackets (phase 2 mode) |
| D.7.6 | Next-snap swaps (timestamped play-by-play; likely an always-on consumer — a new service for you to approve) | "Phase 2: next-snap swaps" |
| D.7.7 | Ghost opponents | "Later: ghost opponents" (Bots section) |

#### H6 — Phase 2 rows (flag `highlightsPhase2`)
**Exit/gate (provisional):** each new row hidden below 3 clips; the Trending row is computed from recorded plays only (no plays → row hidden, reason logged); prospects row stays off until NP-H1 names a source.

| ID | Title | PRD item |
|---|---|---|
| H.6.1 | `video_plays` play log (extends H.2.6 if built) | Trending + success metrics |
| H.6.2 | Waiver wire tape row | "waiver wire tape" |
| H.6.3 | Opponents row | "opponents" |
| H.6.4 | Conference row + college program sources | "conference" |
| H.6.5 | `college_players` + Top college prospects (blocked on NP-H1) | "prospects" |
| H.6.6 | Trending row | "trending" |

#### P6 — Advanced history (flag `playerProfilesPhase2`)
**Exit/gate (provisional):** era-adjusted values reproduce hand-checked examples under the NP-P11 base; play-by-play metrics match nflverse's own published aggregates for a sample season; nothing pre-1999 ships without a licence you've approved.

| ID | Title | PRD item |
|---|---|---|
| P.6.1 | Era adjustment (NP-P11) | P6 "Era adjustment"; Cross-era comparisons; Era-adjusted compare mode |
| P.6.2 | Play-by-play metrics (success rate, 4th-quarter comebacks) as season aggregates (never raw play-by-play, §5.5) | Catalog stats (QB 4th-quarter comebacks, RB success rate) |
| P.6.3 | Pre-1999 totals (blocked on a licence, NP-P2) | P6 "pre-1999 history" |

#### Also next season
- **Live modes for season-long leagues** and **the weekly "only goes up" points system:** no PRD yet. Not planned.
- **V6+:** Yahoo adapter (OAuth token store `external_oauth_tokens`, owner-only; only after NP-V19 and Yahoo app approval).

### 6.6 How the build runs
- **Pointer and ledger.** `ACTIVE-BUILD.md` names "Next Phase" and points at `docs/specs/PROGRESS-next-phase.md`. That file holds per-track checklists, the NP Q/D/F ledgers, the migration reservation log and push debt. Task text lives in `tasks-NP-duel.md`, `tasks-NP-highlights.md`, `tasks-NP-profiles.md`, `tasks-NP-versus.md` (and X tasks in PROGRESS).
- **Task-id prefixes:** `D.*` Duel, `H.*` Highlights, `P.*` Profiles, `V.*` Versus/manager, `X.*` shared.
- **Agents.** The orchestrator session dispatches each task to an `fs-builder` (isolation worktree) running Opus 5.5 at medium effort, then a **fresh** `fs-reviewer`. Fixes get at most 2 rounds, and auto-merge happens only on a clean review. Chris reviews each finished piece before the next piece *on the same track* starts ("one at a time, wait for go"). **Pending NP-Q11:** that per-track reading of "one at a time" is a proposal; if Chris says no, there is one builder, one milestone at a time, starting with D-M0.
- **Parallel tracks (pending NP-Q11).** At most **3 builder worktrees** at once and **one schema lane** across all tracks. There's only one local DB, so only one builder may `db reset` / `test:db` at a time. The other two work on UI/API against merged schema, mocks or pure libs. Suggested Phase 1 lanes: (1) the schema lane, in order D.0.4 → D.0.5 → H.1.1 → X.8 → D.1.1 → X.5 → D.2.1 → D.2.2 → D.2.3 → D.2.4 → H.1.5 → D.3.x → D.4.x → H.4.1; (2) a Duel UI/lib lane; (3) a Highlights/setup UI lane.
- **Migration numbers.** Taken **at task start**, one at a time, by whichever task holds the schema lane, and recorded in PROGRESS. **No pre-assigned per-track ranges.** A lower number that merges after a higher one has been pushed makes `supabase db push` refuse unless run with `--include-all`, which is the drift the migration-discipline rules warn about. 195 (#446) merged after 196 was already on main, so the builder checks whether 195 and 196 are both pushed before relying on order. The first expected numbers are **202 / pgTAP 152** (197–201 and pgTAP 147–151 landed 2026-10-18 → 10-20; M7's DB-lane tasks will take numbers too, so re-measure at task start). Every `CREATE OR REPLACE` is authored against the chain HEAD. Typegen runs against LOCAL, then the alias block is re-appended.
- **Older schema.** Every route calling a not-yet-pushed table or RPC answers a named 503 (`isDoorNotPushed`, `src/lib/supabase/postgrest-errors.ts`, as `trades-service.ts:61` already uses it) and the UI hides the surface. Each migration-bearing task states its own older-schema behaviour in its Scope cell (X.5, X.8, X.12, D.0.4, D.0.5, D.1.1, D.2.3, H.1.5, H.2.6, H.4.1, X.4, P.1.2, V.1.2, V.1.4, V.1.5, V.2.1, V.6.1 above); a task without one isn't ready to build. Each such task's tests include one run of the new code against the previous migration HEAD (today 196) proving the stated behaviour. Push debt stays at most one migration per track. Nothing is applied to production by hand, and Chris runs `db push`.
- **Review rigour.** FULL only for the four house categories, and each FULL task names its category in the table: **scoring** (Duel plans, locks, swaps, scores, finalizer and ratings; V.3.1); **standings** (X.5's "no league row" proof, V.1.2, V.2.1, V.2.5, manager records derived from standings); **permissions** (every RLS/definer-gated read or write: X.4, X.8, X.12, H.1.1, H.4.1, V.1.2–V.1.5, V.2.1, V.4.1); **production writes** (H.1.5, H.1.6, X.4's crosswalk sync, P.1.3–P.1.4, P.2.3, V.1.4, V.6.2). Contracts, fixtures, gate scripts and pricing (D.0.2, D.0.3, D.2.5, D.6.1) are ONE PASS — the FULL tasks they feed are where the rigour sits. ONE PASS for everything else; nits become follow-ups.
- **Flags per environment.**

  | Environment | Flags |
  |---|---|
  | Local dev | All ON (house default) |
  | Vercel previews | Set per branch to show the work |
  | Production | All OFF until Chris flips each one |

  Flip order: `highlights` → `duel` (beta list if ruled) → `watch` → `playerProfiles` → `publicPlayerPages` (after NP-Q4) → `managerProfiles`. `duelMultiGame` / `duelWeek` / `highlightsPhase2` / `playerProfilesPhase2` wait for their seasons.
- **Who sees what.**

  Audiences below are **recommended, pending NP-Q3**.

  | Audience (recommended, pending NP-Q3) | What they see |
  |---|---|
  | **Public app (everyone)** | P.1.0 fix, Highlights in the player view and NFL team pages (H2), Watch tab (H4), Player Profiles v2 (P1–P4), public pages (H5/P5) |
  | **League test cohort** | H3 league highlights, Versus/manager league views (V1–V5; renewal only if NP-V1 = yes), import (V6) |
  | **Duel** | Beta list or everyone per NP-Q3. Duel needs no league |

---

## 7. Appendix

### A. Data model delta (PRD table → final)

| PRD table | Action | Final name | Key columns | RLS |
|---|---|---|---|---|
| `slates` | new | `duel_slates` | id, season, week, kind, window_key, status, lock derived from kickoffs, config JSONB | signed-in read; definer jobs write |
| `slate_games` | new | `duel_slate_games` | slate_id, game_id → `nfl_games` | signed-in read |
| `game_periods` | new (shared) | `nfl_game_periods` | PK (game_id, period 1–5), started_at, ended_at, source, observed_at | public read; service write via door |
| `slate_players` | new | `duel_slate_players` | PK (slate_id, player_id), game_id, projection, price NULL (M6), status | signed-in read |
| `player_period_points` | split | `player_period_stats` (shared) + `duel_period_points` | PK (game_id, player_id, period); stats JSONB / points + rules_version | signed-in read; service write |
| `entries` | new | `duel_entries` | id, slate_id, user_id NULL (bot), bot_level, bot_seed, swaps_used, score, action_id; partial unique (slate_id, user_id) | owner via RPC; opponent after lock |
| — | new | `duel_quarter_picks` | PK (entry_id, period, slot), player_id, revealed_at, origin; trigger ≤ 2 quarters/player, ≤ 1 QB | owner; opponent only when revealed |
| `entry_players` | new (M6) | `duel_entry_players` | PK (entry_id, player_id), role, slot, price_paid | owner; opponent after lock |
| `active_intervals` | new (M6) | `duel_active_intervals` | entry, slot, player, start/end (game, period) | owner; opponent after effect |
| `swaps` | new (M6) | `duel_swaps` | entry, out/in, window_id, effective (game, period), status, action_id | owner; opponent when active/revealed |
| `swap_windows` | new (M4) | `duel_swap_windows` | slate, game NULL, after_period, opens/closes/closed/revealed | signed-in read |
| `duels` | new (M2) | `duel_duels` | entry_a, entry_b, kind, swap_mode, rated, result, tiebreak | participants |
| `match_queue` | new (M5) | `duel_match_queue` | PK (slate_id, user_id), rating, entered_at | owner |
| `challenges` | new (M4) | `duel_challenges` | from/to user, token UNIQUE, slate, ranked, status, action_id | from/to; token via definer lookup |
| `ratings` | new (M5) | `duel_ratings` | PK (user_id, scope), rating, deviation, volatility | public read; finalizer writes |
| `brackets`, `bracket_matches` | new (Ph3) | `duel_brackets`, `duel_bracket_matches` | — | — |
| — | new (Ph3) | `duel_slot_quarters` | PK (entry, slot, ordinal CHECK 1–4), UNIQUE (entry, slot, game, period) | owner |
| `video_sources` | new | `video_sources` | youtube_channel_id UNIQUE, uploads_playlist_id (from API), level, nfl_team, conference, active, watermarks | public read active; service write |
| `videos` | new | `videos` | youtube_id PK, source_id, published_at, duration_s, type, season, week, `nfl_game_id`, embeddable, is_short, removed_at, last_checked_at | public read live + embeddable + fresh |
| `video_players` | new | `video_players` | PK (video_id, player_id → `players`), focus, confidence, manual_override | public read; service write |
| `video_teams` | new (renamed col) | `video_teams` | PK (video_id, `nfl_team`), role | public read |
| `user_favorites` | new (renamed col) | `user_favorites` | user_id PK, `nfl_team`, college_team, conference, asked_at | owner only |
| — | new (opt, H1) | `player_aliases` | PK (player_id, alias) — no PRD line; an H1 matcher aid for the PRD's admin review, dropped if overrides suffice | service only |
| — | new (H2, only if NP-H17) | `video_play_counts` (video, surface, day, count) | — | definer increment; public read |
| — | new (Ph3) | `video_plays`, `college_players` | — | own insert / public read |
| (old spec) `player_highlights` | **do not create** | — | — | — |
| — | new (shared) | `nfl_players` | gsis_id PK, slug UNIQUE, sleeper_id UNIQUE NULL, pfr/espn ids, draft, birth_date, college, headshot | public read; service write |
| `player_seasons` | new | `player_seasons` | PK (gsis_id, season, season_type REG/POST), team(s), games, age, stats JSONB | public read |
| `stat_definitions` | **code registry** | `src/lib/stats/registry/` | key, kind, positions, qualifier, importance, source, licence tier | n/a |
| `leaderboards` | new | `leaderboard_runs` + `leaderboards` | run_id; (stat, pool, pool_key, scope, position, gsis) → rank, tied, value, total | public read |
| — | new | `player_ranks` | (run, gsis, scope) → ranks JSONB | public read |
| `player_claims` | new | `player_claims` | (run, gsis, scope, ordinal), stat, pool, rank, score, display_text | public read |
| `combine_results` | new | `combine_results` | PK (gsis, drill), value, percentile; one 40-yard source with `players.forty_time` (195/#446) | public read (display gated, NP-P6) |
| — | opt (P5, only if NP-P13) | `compare_popularity` | pair_key, views, shares — serves the PRD's "popular comparisons" sitemap line | public read; definer increment |
| `manager_seasons` | **RPC** | `manager_seasons()` / `league_manager_seasons()` | user, league, season, W-L-T, PF, PPG, finish, title | in-body auth |
| `matchups` | **reuse** | `matchups` (109) | manager derived per stint | member |
| `lineup_decisions` | **derive** | + `league_week_roster_points` | (league, season, week, team, player), role, slot, points | member read |
| `transactions` | **reuse** | `transactions` (109) | credit via payload team + stint | member |
| `skill_stats` | new (renamed) | `manager_skill_stats` | user, scope_league NULL, season NULL, stat_key, value, sample_n, percentile; NULLS NOT DISTINCT unique | league scope member; global via RPC |
| `skill_ranks` | new (renamed) | `manager_skill_ranks` | user PK, composite, tier, percentile, sample_weeks | via profile RPC |
| — | extend | `leagues.renewed_from_league_id`, `leagues.import_source`, `teams.renewed_from_team_id` | nullable | unchanged |
| — | extend | `profiles.manager_visibility` | CHECK public/leaguemates/private | unchanged |
| — | new (X.12, only if NP-Q3 = friends first) | `beta_memberships` | PK (user_id, feature) | owner read own; operator write only |
| — | new | `league_external_managers` (V6, PRD import), `league_week_baselines` (V3, or job JSON — an implementation choice for NP-V6's replacement level, no PRD table), Yahoo `external_oauth_tokens` (Ph3 only, after NP-V19) | — | member read / owner only |
| — | new (shared, X.8) | `rate_limits` | PK (key, window_start), count — PRD basis is Duel's queue/challenge limits (`spec-duel.md:360`); other tracks use it only for the limits this plan proposes (report-unplayable, play counter, NL compare, import), each a plan choice, not a PRD line | RLS on, no policies |
| — | reuse | `system_flags` keys `duel_stats_degraded`, `youtube_ingest:last_run`, `leaderboards:as_of`; `notifications` new types | — | unchanged |
| — | extend | `realtime.messages` policy for `duel:%` | participants | — |
| — | extend (opt) | `job_pauses` CHECK widened for duel jobs | — | — |
| — | extend | `nfl_weeks` weeks 19–22 + phase; `nfl_games.game_type 'post'` | — | unchanged |

### B. Jobs and schedules

| Job | Vehicle | Cadence | Owner |
|---|---|---|---|
| `duel-live-ping` → `/api/cron/duel-live` | pg_cron `'15 seconds'`, SQL-guarded (game near/live + open slate + kill switch); route single-flight under an advisory-lock lease, one poll ≤ 10 s per invocation (or the 60 s × 4 rounds fallback, pinned in D.0.5) | 15 s while hot; nothing otherwise | D.0.5 / D.1.1 |
| `duel_tick` | pg_cron `'5 seconds'`, pure SQL | 5 s | D.2.3 |
| Duel slate generator | route via pg_cron | Tuesdays + on schedule change | D.1.1 |
| Duel finalizer + ratings | route via pg_cron | after last game + 2 h; ratings weekly | D.2.4 / D.5.1 |
| Matchmaker | pure SQL pg_cron | 30 s | D.5.2 |
| `ingest-highlights-ping` → `/api/cron/ingest-highlights` | pg_cron hourly | hourly on game days, nightly otherwise (route decides from `nfl_games`) | H.1.5 |
| Highlights refresh | same route, refresh mode | nightly rolling batch (whole index ≤ 28 days) | H.1.6 |
| `sync-player-history` | Vercel daily cron | ~10:00 UTC | P.1.4 |
| `player-leaderboards` | Vercel daily cron (after history) | nightly | P.2.3 |
| `/api/cron/manager-analytics` | pg_cron ping | hourly, acts on newly final weeks + re-scores | V.3.1 |
| Skill stats / skill rank | same route | weekly | V.3.5 / V.5.1 |
| Identity crosswalk sync | script + weekly with `sync-stats` | weekly | X.4 |

### C. Feature flags

| Flag | Env var | Gates | Audience |
|---|---|---|---|
| `duel` | `NEXT_PUBLIC_FLAG_DUEL` | `/app/duel/**`, Duel nav, challenge pages | beta list or everyone (NP-Q3) |
| `duelMultiGame` | `NEXT_PUBLIC_FLAG_DUEL_MULTI_GAME` | Sunday windows, roster builder | Phase 2/3 |
| `duelWeek` | `NEXT_PUBLIC_FLAG_DUEL_WEEK` | Duel Week, brackets | Phase 3 |
| `highlights` | `NEXT_PUBLIC_FLAG_HIGHLIGHTS` | in-context video (player view, team pages, league surfaces with `leagues`), Admin › Highlights | everyone (recommended, pending NP-Q3) |
| `watch` | `NEXT_PUBLIC_FLAG_WATCH` | Watch tab + nav, favorites ask | everyone (recommended, pending NP-Q3) |
| `playerProfiles` | `NEXT_PUBLIC_FLAG_PLAYER_PROFILES` | v2 sections, leaderboards, compare, share cards | everyone (recommended, pending NP-Q3) |
| `publicPlayerPages` | `NEXT_PUBLIC_FLAG_PUBLIC_PLAYER_PAGES` | `/players/…`, `/nfl/…`, `/leaders/…`, `/compare/…`, `/games/…`, sitemap families | public (after NP-Q4) |
| `managerProfiles` | `NEXT_PUBLIC_FLAG_MANAGER_PROFILES` | Versus, manager profile, skill tiles (league parts also need `leagues`) | league cohort (recommended, pending NP-Q3) |
| `highlightsPhase2` | `NEXT_PUBLIC_FLAG_HIGHLIGHTS_PHASE2` | H6 rows | Phase 3 |
| `playerProfilesPhase2` | `NEXT_PUBLIC_FLAG_PLAYER_PROFILES_PHASE2` | P6 era/advanced/pre-1999 | Phase 3 |

### D. Routes

**Public (outside `/app`, `GuestShell`, ISR):** `/players/[slug]`, `/players/[slug]/highlights`, `/nfl/[team]/highlights`, `/nfl/[season]/week/[week]/top-plays`, `/games/[id]`, `/leaders/[stat]/[pool]`, `/compare/[pair]`, `/duel/c/[token]` (pre-auth challenge), `/u/[username]` (extended), `sitemap.xml` families, `robots.txt`.

**App:** `/app/duel`, `/app/duel/[duelId]`, `/app/watch`, `/app/watch/[row]`, `/app/admin/highlights`, `/app/leagues/[leagueId]/stats` (Versus) + `/stats/vs/[userId]`, `/app/profile` (manager view), settings favorites/visibility.

**API:** `/api/cron/{duel-live,duel-slates,duel-finalize,ingest-highlights,sync-player-history,player-leaderboards,manager-analytics}`, `/api/duel/{slates,duels,entries/[id]/plan,challenges}`, `/api/players/[id]/highlights`, `/api/nfl/[team]/highlights`, `/api/highlights/{latest,report-unplayable}`, `/api/highlights/play` (H.2.6, only if NP-H17), `/api/watch/rows`, `/api/me/favorites`, `/api/admin/highlights/*`, `/api/leaderboards`, `/api/player-profiles/[key]`, `/api/compare`, `/api/compare/parse`, `/api/og/[kind]`, `/api/leagues/[id]/{versus,import}`, `/api/leagues/[id]/renew` (V.1.4, only if NP-V1 = yes), `/api/managers/[username]`, `/api/managers/[username]/seasons`.

### E. PRD → older-spec supersession map

| Older spec part | Status | Superseded / extended by |
|---|---|---|
| `spec-youtube-highlights.md` Phase 1 (search link-out) | Superseded, not built | `spec-highlights-watch.md` index (H1–H2) |
| `spec-youtube-highlights.md` Phase 2 (per-player search, `player_highlights`, 7-day cache, Pro gate) | **Superseded** | channel index + `videos`/`video_players`; no Pro gate |
| `spec-leagues-live-mode.md` Live Mode (Go Live, Now/Done/Up Next, Pro gate) | Superseded for now; placeholder page stays | future "live modes for season-long leagues" PRD (not yet written) |
| `spec-leagues-live-mode.md` Live Stats Pipeline (`sync-live-stats` Edge Function, 30 s, MySportsFeeds) | **Superseded** by shipped code | `/api/cron/sync-live` + live-poll (D300); quarter-level live = `spec-duel.md` |
| `spec-leagues-live-mode.md` leagues/`nfl_games` sketch | Superseded | `spec-redraft-leagues.md` + shipped `nfl_games` |
| `spec-redraft-leagues.md` §11.6 History Mode, §7.2.1(a) stint display | Extended | Manager Profiles & Versus (stint attribution, renewal); $5/yr idea dropped (free-only) |
| `spec-redraft-leagues.md` §23.1 OQ14 (SportsDataIO/Sportradar) | Extended | D.0.1 feed decision |
| `spec-auth-profiles.md` profile page (cred badge "Freshie") | Extended | Manager profile on `/u/[username]`; ladder per NP-V10 |
| `spec-player-research.md` Compare Mode (never built), Player Detail Drawer | Superseded / extended | Player Profiles compare (P4); profile v2 in the existing modal |
| `spec-teams.md` "1 team" Pro rule | Stale (free-only) | n/a |
| `spec-scout.md` §4–§5 registry/attribution, §8.5 public player pages | Shared / reconciled | one stat registry (P.1.1); one public page `/players/[slug]` (NP-P15) |
| 2026-10-04 ruling "player links open the modal; no public player surface" | In-app part kept; public part reopened | NP-Q4 |
| Retired "Next-phase product roadmap + video build" prompt | Retired | `prompt-next-phase-architect-pass.md` + this plan |
