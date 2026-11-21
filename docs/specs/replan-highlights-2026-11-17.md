# Highlights — re-plan after Chris's 2026-11-17 clarifications

2026-11-17 · Architect re-plan · **for Chris's review — no code until he says go.** It supersedes the Highlights milestones (H1–H5) in `architecture-plan-next-phase.md` §6; the PRD `spec-highlights-watch.md` still wins where they disagree, except where Chris's quoted words below change it. Sources: the PRD and plan in this PR; code at `main` `08e7b65` (migration head 224). Markers like [V3] point to the checker's notes at the end.

## 1. What Chris said, and what changes

Verbatim, 2026-11-17 (in chat):
- (3) "So I would start with the highlight and do a spike on this salary cap league thing instead."
- (4) "…the highlights page in the app isn't just a single player view. It's literally, the idea is to have like a YouTube homepage style view, like at the top, it's like the best plays from last week. And then you get like, oh, here's the best players. And you click on them, and then you can see all the highlights for that player. But then just like all over the place, it's like, oh, highlights from the Broncos game, the Bengals game, blah, blah, blah. Just like different ways of looking at highlight views. But then the user can go search for a specific player and see all the videos of highlights associated with them. Just like how YouTube works."
- (5) "But also, yes, every player should have their own player detail page with all the stuff in it. So their career stats, their weekly stats, all their stats, their player profile, how they rank, but then also their games, and then another tab for their highlight reel."

2026-11-13: "there is no reason to check for highlights hourly. i would check once on Tuesday"; the feature and its tab are just "Highlights".

| Topic | PR #528 plan (was) | Now |
|---|---|---|
| Order | Index (H1) → player-view rows (H2) → league (H3) → "H4 Watch tab" last | Index (H1) → **Highlights hub (H2)** → **player detail page (H3)** → team page, league surfaces, public pages later |
| Hub | Netflix-style rows, personal first (PRD §Watch tab) | YouTube-homepage style: best plays last week → best players (tap → his clips) → per-game rows → cuts by position/team → player search |
| Player view | Modal only; `src/app/app/(shell)/players/[playerId]/page.tsx:10-20` redirects (2026-10-04 ruling) | A detail **page** with tabs: stats (career/weekly/all), profile, ranks, games, highlight reel |
| Ingest | Hourly ping; nightly + game-day hourly; nightly refresh (plan §B) | **One Tuesday run**, re-check included |
| Name | "Highlights & Watch", "Watch tab" | "Highlights" |

## 2. The Highlights hub (`/app/highlights`, flag `highlights`)

Flag off → `redirect('/app')` (`src/app/app/(shell)/mocks/layout.tsx:25`). `ByLayout` desktop + phone, v7: rounded cards, 1px border, shadow only on hover (CLAUDE.md:55-63).

**Sections, top to bottom**

| # | Section | Query (all from the latest finished NFL week, unless noted) |
|---|---|---|
| 1 | Hero: "Best plays from Week N" | The NFL channel's weekly top-plays video if indexed, else row 2's first clip; a still + play button [V2: NP-H3's recommendation is a still + play button on phones and muted autoplay on desktop only; the desktop choice is still open] |
| 2 | "Best plays" row | **Proposed, HQ-4:** clips classified as top plays or player highlights (PRD `videos.type` values, not tables [V1]) with a featured player from that week's games, ordered by his fantasy points that week (ESPN Standard, `src/lib/players/core-stats-ops.ts:88`); one per player |
| 3 | "Best players" row | Players with ≥1 clip, by points; tap → all his clips (H2: hub player view; after H3: his page's Highlights tab) |
| 4 | One row per game: "Broncos vs Bengals" | That week's `nfl_games` by kickoff; recap first, then clips whose `videos.game_id` is that game [V3] |
| 5 | Top QBs / RBs / WRs / TEs | Row 2's rule filtered by position (PRD row catalog) |
| 6 | Teams | 32 logos (codes `src/lib/nfl-teams.ts:25`; images `getTeamLogoUrl`, `src/lib/player-image.ts:89` [V4]); tap → that team's clips, newest first |
| 7 | New this week | Every live clip, newest first |

Rows under 3 clips are hidden (PRD). Personal rows (My players/My team) come after the hub; My team needs `user_favorites` (H.4.1), My players needs a player source (NP-H5: lists, or rosters for the league cohort) [V5].

**Card anatomy.** 16:9 YouTube thumbnail; duration chip bottom-right; play mark white or black, never red (CLAUDE.md:74); title, two lines max; meta line: player · team · "Wk 11" · points badge (neutral `n-*` tokens, not red); source label ("NFL", "Broncos"). Phone: `m-*` tokens, light and dark.

**Search.** Reuse `src/components/players/player-search.tsx` → `src/app/api/players/search/route.ts:26` (`src/lib/players/name-search.ts:30`). Result = his clips: featured before appears-in, newest first; none → "No highlights for {name} yet."

**States.** Loading: `Skeleton` rows. Error: rounded-rectangle notice, small red glyph, Retry; never an empty 200. Empty index: one quiet line, "Highlights are added every Tuesday."

**Player sheet** (`VideoPlayerSheet`, needs approval, NP-H16): YouTube IFrame API on `youtube-nocookie.com`; desktop Dialog (overlay, keeps its shadow), phone `MobileSheet` swipe-down. Queue ("Up next", auto-advance, skip), remembered mute, player name + week line below. Errors 100/101/150 skip and report. YouTube rules: ≥200×200, no overlays, one playing at a time.

**Nav.** Desktop: flag-spread `Highlights` in the `PRIMARY` array after Players (`src/components/layout/sidebar.tsx:32-71`, Players at :66-70) [V6]. Phone bar: Home · Community (flag) · Players · Profile (`src/components/mobile/shell/mobile-dock.tsx:169-180`, `src/components/mobile/shell/mobile-nav.ts:11`); Community is off in production (medium confidence), so 3 tabs show. Slot = HQ-3.

## 3. The player detail page

**Route.** `/app/players/[playerId]` redirects to `/app?player=` today (`page.tsx:16-20`; `src/components/players/player-page-ops.ts:308-312`). Recommendation: render the page — desktop adds `'page'` to `PlayerView`'s `variant` (only `'modal'` now, `src/components/players/player-detail-page-view.tsx:79`) with tabs; phone renders `MobilePlayerProfile` in page mode (`src/components/mobile/player/mobile-player-profile.tsx:82`). No fork. The modal (`src/stores/player-modal-store.ts:32`), the mini card's Expand (`src/components/players/player-window.tsx:75-83`) and `/app?player=` links keep working. [V8: tests pin today's shape and must change with H.3.1: `player-page.render.test.ts:216-217` (`playerPageHref` → `/app?player=`), `src/lib/route-groups.test.ts:109`; the Share link builds from `playerPageHref` (`player-detail-actions.tsx:93`).]

| Tab (Chris's words) | Fills it today | New |
|---|---|---|
| Profile | `PlayerDetailHeader` (`player-detail-header.tsx:38`), `BioPanel` (`player-detail-panels.tsx:192`; today shown only in the mini card's Bio tab, `player-window.tsx:98` [V7]), `ThisWeekBlock`, `KeyStatsPanel`, `PlayerNewsPanel` (`player-detail-page-view.tsx:249`), `DraftValue` (:385), `ActionsColumn` (:547) | Header play button (his reel) |
| Stats: career / weekly / all | Desktop `StatsPanel` (this, last and projected season, `player-detail-panels.tsx:33`); phone `HistoryTab` (`profile-stats-tabs.tsx:196`, 4 seasons, `use-mobile-pprofile-stat-lines.ts:58`); `WeeklyPointsList` (panels:509; mini card Overview tab only, `player-window.tsx:90` [V7]), `GameLogPanel` (panels:72) | Desktop 4-season career table; full career needs plan P1 |
| How he ranks | This season's position rank (core stats), ADP, auction value; past ranks are dashes (`profile-stats-tabs.tsx:190-195`) | Nothing now; claims/leaderboards wait for P2–P4 [V9: expert/consensus ranking sources already exist for the Rankings hub, `src/hooks/use-mobile-rankings-sources.ts`, flag-gated; not wired into the player view; medium confidence they fit "how they rank"] |
| His games | `SeasonTable` (`player-detail-page-view.tsx:456`); phone `GameLogTab` (`profile-stats-tabs.tsx:40`) | Play icon on games with a clip |
| Highlight reel | — | This season, then NFL career; featured first, newest first |

Phone tabs today: Summary, Game log, Leagues, Transactions, Team, History (`mobile-player-profile.tsx:329-335`; Leagues and Transactions only with the leagues switch on, Team only when he has a team [V10]); add Highlights, keep the rest. The modal gets a `Highlights` toggle beside News (`SECTIONS`, `player-detail-page-view.tsx:160-166`). **Ships now:** tabs, stats, game log, news, reel. **Waits for Profiles v2:** claims, leaderboards, compare, share cards, deep history.

## 4. Revised milestones (one PR each)

FULL rigour only for RLS and production writes. Wake cost is zero unless stated: reads are cached under a `videos` tag the Tuesday run revalidates.

**H1 — Index**

| ID | Status | Task | Size | Rigour | Mig | Depends on | Tests | Older schema |
|---|---|---|---|---|---|---|---|---|
| H.1.0 | kept | Rulings into PRD changelog | S | ONE PASS | n | — | — | — |
| H.1.1 | kept | `video_sources`, `videos`, `video_players`, `video_teams` | M | FULL | y | H.1.0 | pgTAP RLS | adds tables |
| H.1.2 | kept | Feed lib + Data API client; never `search.list` | M | ONE PASS | n | H.1.0 | recorded JSON | — |
| H.1.3 | kept | Seed NFL + 32 team channels | S | ONE PASS | n | H.1.1–2 | constant pinned to `NFL_TEAMS` | — |
| H.1.3b | **moved → H6** | College channels | — | — | — | HQ-5 | — | — |
| H.1.4 | kept | Matcher extending `src/lib/news/match.ts:121` (rules + namesake guard, :3-17) into a shared lib; adds type, week, game link, confidence | M | ONE PASS | n | H.1.2 | ~100 titles, precision ≥0.95 | — |
| H.1.5 | **changed** | Weekly ingest + re-check, `/api/cron/ingest-highlights` (copies `src/lib/news/ingest.ts:115`, budgets :42); one pg_cron row | M | FULL | y | H.1.1–4 | 0-video run says why; coverage test | tables missing → named 503 |
| H.1.6 | **refresh merged into H.1.5** | Report-unplayable route: server re-checks; per-person limit on the 213/214 pattern [V11] | S | FULL | y [V11] | H.1.5 | rate-limited | absent → sheet skips |
| H.1.7 | kept | Admin review list + source toggles, `/app/admin/highlights` | M | ONE PASS | n | H.1.5 | non-admin → 404 | — |
| H.1.8 | **new** | Backfill script run once by hand (range = HQ-7) | S | FULL | n | H.1.5 | idempotent re-run | — |

**How one Tuesday run meets YouTube's 30-day rule** (Developer Policies III.E.4, plan §5.2; high confidence on the 30 days):
- The run first pages each channel's uploads back to last week's watermark (~1 unit per 50 clips).
- Then it re-checks stored clips with `videos.list` (50 ids per unit), **oldest `last_checked_at` first**, refreshing title, thumbnail, embeddable and removed. Every clip is re-checked every 7 days; up to three missed Tuesdays still keeps it at 28.
- Backstop: the read API hides clips unchecked for 28 days, and the run deletes the YouTube-sourced fields of any clip unchecked at 30. [V12: that delete only happens when a run happens; four or more missed Tuesdays leave data stored past 30 days until the next run.]
- A test pins that one run's budget covers the whole index; if it can't, the run alerts by name. [V13: whether a season-sized index re-checks inside 60 s is unmeasured, low confidence either way.]
- Unknown: whether a bare video id may be kept past 30 days; assume not.

**Wake cost** (224's rules): one pg_cron row, `ingest-highlights-ping` at `'0 15 * * 2'` (Tuesday 15:00Z, after Monday night) via `cron_ping_route`, as in `224_wake_vercel_only_for_games.sql:649-672` (the `sync-live-sweep` row, :666-671). One wake a week, one pass, `maxDuration` ≤ 60 s, no loop. Quota estimate: a few hundred to ~2,000 units a run against 10,000/day. (Fact, unchanged here: news still wakes Vercel every 30 min, `198_player_news.sql:74`.)

**H2 — Hub** (flag `highlights`)

| ID | Status | Task | Size | Rigour | Mig | Depends on | Notes |
|---|---|---|---|---|---|---|---|
| H.2.0 | **new** | Dev fixtures: ~100 recorded clips seeded locally | S | ONE PASS | n | H.1.1 | lets UI start before the key |
| H.2.1 | **changed** | Read API + hooks: hub rows, player clips, team clips; ≥0.8 confidence shown; DB error → 5xx | M | ONE PASS | n | H.1.1, H.1.4 | absorbs plan H.4.2; tables missing → named 503, hub shows its error notice |
| H.2.2 | kept | `VideoPlayerSheet` + queue store | M | ONE PASS | n | H.2.1, NP-H16 | |
| H.2.3 | **new (was H.4.3)** | Hub desktop + sidebar entry | M | ONE PASS | n | H.2.2 | flag off = no nav, redirect |
| H.2.4 | **new (was H.4.4)** | Hub phone + dock slot | M | ONE PASS | n | H.2.3, HQ-3 | light/dark |
| H.2.5 | **new** | Search + a player's highlights view | S | ONE PASS | n | H.2.3 | reuses player search |
| H.2.6 | kept | Anonymous play counter, only if NP-H17 | S | ONE PASS | y | H.2.2 | table absent → 204 |

**H3 — Player detail page**

| ID | Status | Task | Size | Rigour | Mig | Depends on |
|---|---|---|---|---|---|---|
| H.3.1 | **new** | `/app/players/[id]` renders `PlayerView` `'page'` with tabs (desktop); `playerPageHref` per HQ-2 | M | ONE PASS | n | HQ-1, HQ-2 |
| H.3.2 | **new** | Phone page mode + Highlights tab | M | ONE PASS | n | H.3.1 |
| H.3.3 | **changed (was H.2.3/H.2.4)** | Highlight-reel tab + header play button; modal `Highlights` section | S | ONE PASS | n | H.2.2, H.3.1 |
| H.3.4 | **new** | Desktop career table (4 seasons) + game-row clip icons | S | ONE PASS | n | H.3.1 |

H3 tests: render tests per tab, flag off = no Highlights tab; older schema (video tables absent) → the tab is hidden; no wake cost.

**Later.** H.2.5-old NFL team page clips → **H.T.1 (moved; renamed from "H4.1", which clashed with the plan's H.4.1 favorites [V14])**. League surfaces, plan H.3.1–H.3.4 → **H.L.1–4 (moved; ids clash)**. Favorites H.4.1 → after the hub (kept). X.3, X.4 and H.5.1–5.3 public pages are unchanged and wait for HQ-1. H6 is unchanged and now includes college.

## 5. What blocks the start

**The key blocks live ingest only** (H.1.5 in production, H.1.8). Chris's steps:
1. console.cloud.google.com → New project ("FieldScout").
2. APIs & Services → Library → "YouTube Data API v3" → Enable.
3. Credentials → Create credentials → API key → restrict it to YouTube Data API v3.
4. Vercel → Settings → Environment Variables: `YOUTUBE_DATA_API_KEY` (Production + Preview), and the same line in `.env.local`.
5. Tell the orchestrator. Default quota is 10,000 units a day at no cost (high confidence).

**Can be built and tested without the key:** H.1.0, H.1.1, H.1.2 (recorded responses), H.1.4 (recorded titles), H.1.7, H.2.0–H.2.5 on fixtures, and all of H3.

**Keyless RSS stopgap.** Personas already parse YouTube Atom feeds (`src/lib/personas/feeds.ts:80,143`; `src/lib/personas/roster.ts:34`). A channel feed holds only the latest ~15 uploads, with no duration, embeddable or Shorts flag (medium confidence). Read weekly, it misses most NFL-channel clips. Good for development, not launch (plan §5.2 agrees); its terms status is unknown.

## 6. Questions for Chris

| ID | Question (plain language) | Recommended default |
|---|---|---|
| HQ-1 | Can signed-out visitors see player pages (Google traffic), or app-only for now? | App-only now (`src/middleware.ts:13`); public pages later (NP-Q4) |
| HQ-2 | When you tap a player, does the small card still open first, with Expand going to the full page? | Yes: small card first (your 2026-10-05 rule), Expand opens the page; in a live draft room Expand keeps the pop-up so you don't leave the draft |
| HQ-3 | Where does Highlights go on the phone's bottom bar? | Home · Highlights · Players · Profile; with Community on, five tabs |
| HQ-4 | What counts as the week's "best plays"? | The NFL's top-plays video first, then each player's clip ordered by his fantasy points (ESPN Standard) (replaces the plan's NP-H11/NP-H4 defaults [V15]) |
| HQ-5 | College highlights now or later? | Later; NFL + 32 team channels first |
| HQ-6 | Does Highlights go to everyone when it's ready? | Yes, behind its switch, flipped when you've seen it on the preview |
| HQ-7 | How far back on day one? | This season only; older later (the plan's NP-H12 recommended back to 2023 [V15]) |

## Verifier corrections

Checked 2026-11-17 against the working tree at `08e7b65` (migration head 224) and PR #528's branch `docs/next-phase-architecture-plan`. Every other path, line, table, function, migration and ruling reference in this file was confirmed by reading the code. Nothing contradicts Chris's 2026-11-17 messages or his 2026-11-13 (one Tuesday run) and 2026-11-14 (wake only during games) rulings. The one new cron row is a weekly ping that does one pass, which fits 224's rules: one pass per call, no loops (224 header §5).

- **V1** (§2 row 2). `top_plays`/`player_highlights` read like table names. They are the PRD's `videos.type` values ("Player highlights, game recap, top plays…"). The plan's C15 says never create a `player_highlights` table (the old `spec-youtube-highlights.md` cache). High confidence.
- **V2** (§2 row 1). The plan's NP-H3 recommends **muted autoplay on desktop only, with a still + play button on phones**. It is not a still everywhere. A still everywhere is a fine default, but it is not what NP-H3 says. High confidence.
- **V3** (§2 row 4). No `nfl_game_id` column exists anywhere. The PRD's `videos` column is `game_id`, which points at `nfl_games.id` (TEXT, `001_initial_schema.sql:85`; `kickoff_at` is at :91). High confidence.
- **V4** (§2 row 6). `NFL_TEAMS` holds the 32 codes, and there are exactly 32. The logo images come from `getTeamLogoUrl` (Sleeper CDN, lowercase path). High confidence.
- **V5** (§2). "My players" does not depend on `user_favorites`. Per the PRD, it reads rosters, and the plan's NP-H5 recommends the user's lists for people outside a league. Only "My team" needs favorites. High confidence.
- **V6** (§2 Nav). No `NAV_ITEMS` exists in `src/`. The plan used a stale name. The desktop sidebar's top-level list is `PRIMARY` (`sidebar.tsx:32-71`), with flag spreads, and `MORE_ITEMS` follows at :73-96. High confidence.
- **V7** (§3). `BioPanel` and `WeeklyPointsList` exist, but today they render only in the floating mini card (`player-window.tsx:86-99`: Overview, Stats, Game log and Bio tabs). The desktop `PlayerView`/`PlayerBody` does not use them. They are reusable for the page with no fork. High confidence.
- **V8** (§3 route). Turning the redirect into a page changes behaviour that tests pin: `player-page.render.test.ts:216-217`, `route-groups.test.ts:109`, and the page's own doc comment at `page.tsx:10-15`. The plan's P2/P3 gate also keeps `player-click-routing.test.ts` unchanged. Those tests change with H.3.1 and HQ-2. High confidence.
- **V9** (§3 ranks). The app already reads expert/consensus ranking sources for the Rankings hub (`use-mobile-rankings-sources.ts`; the `consensus` flag is at `feature-flags.ts:64`). The player view shows none of it. This is a fact for HQ planning, not a new task. Medium confidence that it covers part of "how they rank".
- **V10** (§3 phone tabs). The phone tab list is conditional: Leagues and Transactions appear only with the leagues switch on, and Team only when the player has a team. High confidence.
- **V11** (H.1.6). **The 209 `mutation` bucket cannot be reused.** `rate_limit_take` accepts only `mutation`/`bid`, with a scope that is a league or draft the caller belongs to (`209_rate_limits.sql:222-233`). A highlights report has neither, so the call is refused. The per-person precedent is 213's `report` bucket: 10 an hour, keyed to the user's own id (`213_comment_rules.sql:127,144`). 214 takes it through the REVOKEd `rate_limit_take_internal` inside a SECURITY DEFINER RPC (`214_content_reports.sql:347-348`). H.1.6 therefore needs a small RPC, which means a migration, so the Mig column changes from n to y. Sharing the `report` allowance versus adding a bucket (that means widening the CHECK at 213:127) is a build choice. The plan's X.8 design (`rate_limits` + `rate_limit_claim`) was superseded by 209's shipped shape. High confidence on the refusal; medium on the remedy.
- **V12** (30-day rule). The day-30 delete runs inside the Tuesday run, so it is not an independent backstop. If four or more Tuesdays fail in a row, YouTube-sourced fields stay stored past 30 days until a run succeeds. A pure-SQL pg_cron cleanup would close that gap without waking Vercel. Whether that is wanted is open. The 30-day figure (Developer Policies III.E.4.d) is carried from plan §5.2 and was not re-fetched here.
- **V13** (run budget). The quota estimate is plausible: `videos.list` costs about 1 unit per 50 ids. Whether one 60 s pass can re-check a full season's index has not been measured. The pinned budget test is the right guard. Low confidence.
- **V14** (Later). "H4.1" for NFL team page clips clashed with the plan's H.4.1 (`user_favorites`), which this file also keeps. It is renamed to H.T.1.
- **V15** (§6). HQ-4 replaces the plan's NP-H11 default ("featured clip of the week's highest-scoring player"). HQ-7 replaces NP-H12's default ("back to the 2023 season"). These are noted so the PRD changelog (H.1.0) records the change.
- Line fixes, with no change of meaning: `PlayerView` `variant` is at :79, not :78. `SECTIONS` is at :160-166, not :159-165. 224's job block is at :649-672, not :656-670.
- Confirmed absent, after harder greps: no `videos`/`video_*` tables, no `highlights` or `watch` flag, no `YOUTUBE_DATA_API_KEY` in `.env.example` or `.env.local`, no "Highlights" string in `src/`, and no highlights branch. The only highlights doc on main is the superseded `docs/specs/spec-youtube-highlights.md` (link-out, never built; plan C15).
