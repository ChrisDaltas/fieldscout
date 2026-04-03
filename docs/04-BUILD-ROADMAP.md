# Build Roadmap: Hadouken Fantasy Football

**Target:** Real users by fantasy draft season (late July / early August 2026)
**Builder:** Chris (product designer) + Claude Code (implementation)
**Method:** Phase-by-phase. Each phase ships something real. No dates — we move as fast as quality allows.

---

## Phase Overview

| Phase | Focus | Goal |
|-------|-------|------|
| **Phase 0** | Foundation | Working infrastructure — nothing user-facing yet |
| **Phase 1** | MVP | A usable pre-draft tool with a social layer. Real users, real use. |
| **Phase 2** | Teams | Persistent lists with a locked scoring system |
| **Phase 3** | Player Research + Scoring | Deep stat exploration with custom scoring |
| **Phase 4** | Pro Subscription | Stripe-powered Pro tier |
| **Phase 5** | Submissions + Cred + Start or Sit | Competitive layer for in-season use |
| **Phase 6** | Full Social + Explore | Rich profiles, follow graph, full discovery |
| **Phase 7** | Player Following + News Feed | Personalized player news on the home feed |
| **Phase 8** | Leagues + Live Mode | League simulation and real-time game day scoring |
| **Phase 9** | AI Features | Claude-powered trade and roster recommendations |
| **Phase 10** | Polish + Launch | Production-ready, open registration |

---

## Phase 0: Foundation

**Goal:** Working infrastructure. No user-facing features. A deployed skeleton that is ready to build on.

### Tasks

1. **Initialize project**
   - Create Next.js 14 app with App Router
   - Configure TypeScript, Tailwind, ESLint, Prettier
   - Install and configure shadcn/ui and theme tokens
   - Set up Vercel project + GitHub repo

2. **Supabase setup**
   - Create Supabase project
   - Run initial migration: `profiles`, `players`, `player_stats`, `scoring_systems` tables
   - Set up RLS policies
   - Create auth trigger for auto-creating a profile on signup
   - Seed the 2 platform default scoring systems (ESPN Standard, ESPN PPR)

3. **Authentication**
   - Sign up page (email + Google OAuth)
   - Login page
   - Username selection flow (post-signup)
   - Auth middleware for protected routes
   - Supabase SSR auth helpers configured

4. **NFL player data pipeline**
   - **Layer 1 (Sleeper API — free):** `scripts/sync-players.ts` — fetch all active NFL players from `https://api.sleeper.app/v1/players/nfl`. No API key needed. Populates `players` table with profiles, headshots, injury status, ADP.
   - **Layer 2 (nflverse — free):** `scripts/load-historical-stats.py` using `nfl_data_py` — backfill weekly stats for seasons 2022–2025 into `player_stats`. One-time load, refreshed each new season.
   - **Layer 3 (mock data):** `scripts/generate-mock-current-stats.ts` — plausible 2026 season stats for development. Real live stats wired up in Phase 6.
   - Player search endpoint (by name, position, team)

5. **App shell**
   - Root layout with navigation (sidebar on desktop, bottom tabs on mobile)
   - Basic responsive layout
   - Loading states and error boundaries
   - Dark mode support from day one (`class` strategy)

### Deliverable
A deployed Vercel app where developers can sign up, log in, and see a searchable list of NFL players. Nothing a real user would care about yet.

---

## Phase 1: MVP

**Goal:** A usable pre-draft tool with a social layer. The north star: *"I can open Hadouken before my fantasy draft, build out my rankings, and use them as my cheat sheet while I'm on the clock."* Real users should be able to sign up, start ranking, share their lists, and engage with other people's rankings.

### Tasks

#### Guest / Anonymous Experience
1. A new visitor landing on hadouken.gg is immediately placed into an interactive guest Big Board — no sign-up required
2. Guest state (Big Board, any lists created) is stored in localStorage
3. On signup, guest state transfers automatically to the new account — their guest Big Board becomes their real Big Board
4. CTAs are value-framed: "Save your rankings", "Share your Big Board", "Track your accuracy" — not "Create an account to continue"

#### Authentication + Profiles
5. Basic profile page: avatar, display name, username, bio, list of public lists, Big Board link
6. Profile editing: update avatar (Supabase Storage), bio, display name

#### Big Board
7. **Database:** Migration for `lists`, `list_players` tables + RLS. `handle_new_user` trigger auto-creates a Big Board on signup.
8. Season-long Big Board page (`hadouken.gg/u/{username}/big-board`): full drag-and-drop ranking interface, configurable size (10–300, default 25), explicit "Update Big Board" save button, working state vs. saved state behavior
9. Weekly Big Boards: horizontal week selector (weeks 1–18) at top of Big Board tab once the season starts. Week 1 seeds from season-long; each subsequent week carries over from the prior week. Only the current week is editable — future weeks are locked. Past weeks are read-only.
10. Big Board rollback: change history log with timestamps and a log of what moved. Users can restore any prior saved state as their new working state.
11. Smart Order button: sort the full board by fantasy points, projected points, consensus rank, or ADP. Players always go to the bottom of the list when added — no auto-sort on add.
12. "Create List" fork: filter Big Board by position or criteria, hit Create List → forks into a new independent list. Big Board unchanged.

#### Player Lists
13. Create list flow: title, description, position filter, tags (up to 5, system + custom), comments toggle, private toggle
14. Add players to list: search + autocomplete, add button, duplicate prevention (toast on duplicate)
15. Drag-and-drop reorder within lists (dnd-kit)
16. Smart Order button on lists (same as Big Board)
17. List detail page: player rows with name, team, position, headshot, key stats. Tags shown at top. Comments section at bottom (if enabled).
18. My Lists page: grid of user's lists, sorted by recency. Big Board always pinned at top.
19. Public list URLs: `hadouken.gg/u/{username}/lists/{slug}`
20. List actions: edit title/description/tags, duplicate, soft delete (Big Board cannot be deleted), toggle private, toggle comments
21. Free tier enforcement: 1 private list max for free users
22. Tags system: seed all system tags in migration. Tag chips on list cards. Tag feed pages (`hadouken.gg/tag/{slug}`) — server-rendered for SEO.

#### Tier View Mode
23. Tiers are a **view mode overlay**, not a separate data structure. They do not change the underlying player order.
24. Toggle tiers on/off per list. When enabled, players are grouped into tier rows (S / A / B / C / D / F) with color-coded labels on the left side.
25. **Card view** (default when tiers on): players displayed as cards, left-to-right = highest rank within that tier row
26. **List view** (compact): players displayed as a stack, tier label on the left
27. Both views available for all lists and the Big Board
28. `tiers_enabled BOOLEAN DEFAULT FALSE` on the `lists` table

#### Home Feed
29. Home feed is a simple chronological stream of all public lists created or updated by any user on the platform. No algorithm — newest first.
30. Feed items are list cards: title, author, position filter if set, tags, like count, comment count, time since posted
31. Home feed is the default landing page for logged-in users
32. Guest users see the same feed (public content, no personalization needed)

#### Social — Likes + Comments
33. Like/unlike button on list cards and list detail pages (optimistic UI)
34. Comment form on list detail (if comments enabled), threaded replies (1 level deep), author can delete any comment on their list
35. Like and comment counts shown on list cards in the feed

#### Search
36. Basic search: search by player name, username, or list title
37. Search results page with tabs: Players / Lists / Users

### Deliverable
A live app at hadouken.gg where users (or guests) can build ranked player lists and a Big Board, share them publicly, like and comment on each other's rankings, and use their lists as a draft cheat sheet. The product is genuinely useful before and during fantasy draft season.

### Claude Code Prompt → See `05-CLAUDE-CODE-PROMPTS.md` Phase 1

---

## Phase 2: Teams

**Goal:** Users can create a persistent fantasy team — a list with a scoring system locked in. A team is not meaningfully different from a list at this stage; the key distinction is that the scoring system is embedded at creation time and stays fixed, so your team's fantasy point values are always evaluated consistently. No leagues, no live mode, no lineups yet — those come in Phase 7.

### Tasks

1. **Database:** Migration for `teams` table + RLS. A team has a foreign key to `lists` (it IS a list, with extra metadata) and a locked `scoring_system_id`.
2. **Convert list to team:** Any list can be converted into a team. User selects a scoring system at conversion time — this becomes the team's permanent scoring system and cannot be changed after conversion.
3. **Create team from scratch:** Same flow as creating a list, but with a scoring system selector as a required step.
4. **Team page:** Identical to a list detail page but with the scoring system badge always visible. Fantasy points for each player are always calculated against the team's locked scoring system, regardless of the user's current session-level scoring toggle.
5. **My Teams page:** Teams listed separately from lists in the user's profile. Teams are always pinned above regular lists.
6. **Free tier limit:** 1 team for free users.

### Deliverable
Users can create a team, lock in their league's scoring system, and see accurate fantasy point values for every player on their roster — no matter what scoring toggle they have set elsewhere in the app.

---

## Phase 3: Player Research + Scoring Systems

**Goal:** Powerful stat exploration tool with custom scoring. Users can dig into player data and apply their own league's rules to see real fantasy point values.

### Tasks

1. **Research table:** Filterable, sortable table of all players with stats
2. **Column customization:** Users choose which stat columns to show
3. **Filters:** Position, team, bye week, experience
4. **Per-game vs. season toggle**
5. **Historical data:** Toggle between current and past 3 seasons
6. **Compare mode:** Select 2–4 players for side-by-side comparison
7. **Add to list from research:** Quick-add button on each player row
8. **Scoring system selector:** Session-level dropdown to apply different scoring systems. Resets when user leaves the page.
9. **Dynamic fantasy points:** Recalculate fantasy points column based on selected scoring
10. **Custom scoring systems:** Free users get 1 custom system. No limit for Pro. Custom Scoring badge on lists when a non-default system is applied, with a hover pane showing how each player's value shifts vs. the platform default.
11. **Database:** Migration for `scoring_systems` custom entries + RLS

### Deliverable
Users can deep-dive into player stats with their league's scoring applied, and see how custom scoring changes their rankings.

---

## Phase 4: Pro Subscription

**Goal:** Stripe-powered subscription unlocking premium features.

### Tasks

1. **Stripe integration:** Checkout Sessions, Customer Portal, webhooks
2. **Pricing page:** Monthly and annual options
3. **Pro gate enforcement:** Audit and enforce `is_pro` checks on all gated features
4. **Billing settings page:** Manage subscription, view invoices
5. **7-day free trial**
6. **Upgrade prompts:** Contextual CTAs at every free tier limit

### Deliverable
Working payment system with Pro tier unlocking all premium features.

---

## Phase 5: Ranking Submissions + Cred + Start or Sit

**Goal:** The competitive, in-season layer. Users submit their rankings for real evaluation, earn cred for accuracy, and debate Start or Sit decisions publicly.

### Tasks

1. **Database:** Migration for `submissions`, `cred_scores`, `start_sit_questions`, `start_sit_votes`, `ranking_history` tables + RLS
2. **Weekly submission UI:** Any ranked list has a "Submit" button during open windows (Tuesday open → Sunday kickoff lock). Submission is a frozen snapshot of the list's current order.
3. **Season-long submission:** Submit before Week 1 kickoff, evaluated against cumulative season totals.
4. **Submission immutability:** Submitted snapshots cannot be edited or deleted.
5. **Accuracy calculation:** Spearman rank correlation scoring after games complete. Displayed as a percentage on profile ("73% accurate this season").
6. **Cred calculation:** Base participation cred per Update Big Board / submission + accuracy bonus proportional to Spearman score.
7. **Cred rank tiers:** Freshie → Sophomore → JV → Varsity → Rookie → Veteran → All Pro → Local Legend → Hall of Famer → GOAT. Displayed on profile.
8. **Consensus rankings:** Materialized view of all user Big Boards weighted by cred score. Consensus page at `hadouken.gg/consensus`. Set up refresh cron.
9. **My rank vs. consensus:** Side-by-side comparison view on list pages.
10. **Start or Sit — post a question:** Search two players, add optional context, post publicly.
11. **Start or Sit — vote:** Feed of open questions. Tap to vote. See split after voting. Cannot vote on own question.
12. **Start or Sit — resolution cron:** After games, score votes (correct player = higher fantasy points). Award cred proportionally with contrarian bonus.
13. **Start or Sit — browse page:** `/start-or-sit`. Browse by most votes, most recent, by position, by week. Post-resolution: show outcome + vote breakdown.
14. **Free tier limits:** 2 position submissions per week; votes unlimited.
15. **Home feed integration:** Hot Start or Sit questions and submission highlights appear in the home feed.
16. **Cred leaderboards:** Weekly, season, all-time.

### Deliverable
Full in-season competitive experience — rankings get evaluated, cred gets earned, Start or Sit drives daily engagement.

---

## Phase 6: Full Social + Explore

**Goal:** Rich user profiles, follow graph, and a full content discovery experience. The platform starts to feel like a community.

### Tasks

1. **Rich profile page:** Cred score + rank tier badge, accuracy stats (Big Board, submission, Start or Sit), lists, submission history, Start or Sit history, follower/following counts
2. **Follow/unfollow:** Button on profiles, follower/following lists
3. **Home feed personalization:** When a user follows others, their home feed prioritizes followed users' content while still surfacing popular content from the broader community
4. **Full Explore page:**
   - Trending lists (most liked/viewed in last 7 days)
   - Browse by position and by week
   - Trending tags row (horizontal scroll)
   - Tag feed pages (`hadouken.gg/tag/{slug}`)
   - Filter by recency, popularity, author cred score
   - "Rising rankers" section
   - Weekly and season top scorers leaderboard
   - Suggested users to follow
5. **Notifications system:** Follow notifications, like notifications, comment replies
6. **SEO:** Server-rendered profile and list pages with OG tags, structured data, sitemap

### Deliverable
Social experience — follow users, discover content, get notified, build a reputation.

---

## Phase 7: Player Following + News Feed

**Goal:** Users follow individual NFL players and get a personalized stream of news, injuries, and roster moves on their home feed.

### Tasks

1. **Follow/unfollow players:** Follow button on any player card or player profile. No limit.
2. **Player news feed integration:** Injury reports, practice status, depth chart changes, trades, cuts, inactives, notable performances surface in the home feed for followed players. Distinct visual treatment from list cards.
3. **News data source:** Third-party NFL news/injury API (e.g., Rotowire, SportsDataIO). Hadouken surfaces and attributes — does not generate original content. Links out to source.
4. **Player page:** Dedicated news tab showing all recent news for any player, regardless of follow status.
5. **Near-realtime updates:** Injury and status updates should surface within minutes during the season.
6. **Database:** `player_follows`, `player_news` tables + RLS. Schema supports push notifications for future use.

### Deliverable
Personalized player news on the home feed. Users stay on top of the injury wire without leaving the app.

---

## Phase 8: Leagues + Live Mode

**Goal:** Full league simulation and real-time game day scoring. Teams from Phase 2 now compete inside leagues, set weekly lineups, and watch their fantasy points update live on Sunday.

### Tasks

1. **Database:** Migration for `team_players`, `leagues`, `league_members`, `nfl_games` tables + RLS. Add `game_id`, `is_live`, `game_quarter`, `game_clock`, `player_game_status` to `player_stats`.
2. **Roster structure:** Add starting lineup slots + bench to teams (based on league format).
3. **Set weekly lineup:** Drag players between starter/bench slots.
4. **Team performance tracking:** Weekly points, season total, W/L record.
5. **Wire up real live stats:** MySportsFeeds (or equivalent) for current-season + live stats. Replaces mock data from Phase 0.
6. **Live stats pipeline:** `sync-live-stats` Edge Function polling live stats API every 30 seconds during game windows. Upserts `player_stats` with live totals and game clock. Updates `nfl_games` status.
7. **Live Mode UI:** "Go Live" button on team page. Active only during game windows. Shows players split into Now Playing / Done / Up Next with live stat lines, live fantasy points (calculated client-side), and real-time updates via Supabase Realtime.
8. **Create league:** Name, settings, scoring system, roster rules, invite code.
9. **Player exclusivity:** One player per team within a league.
10. **League standings**
11. **League chat:** Simple real-time messaging via Supabase Realtime.
12. **Free tier limits:** Leagues are Pro only. Live Mode for 1 team free, all teams simultaneously Pro.

### Deliverable
Full team and league system with real-time Live Mode for game day.

---

## Phase 9: AI Features

**Goal:** Claude-powered recommendations for trades and roster moves.

### Tasks

1. **Trade recommendation engine:** Given two league teams, suggest fair trades
2. **Add/drop suggestions:** Analyze roster + available players, recommend moves
3. **Claude API integration:** API calls from Next.js route handlers
4. **UI:** Recommendation cards with reasoning

### Deliverable
AI-powered fantasy football assistant within the league experience.

---

## Phase 10: Polish + Launch

**Goal:** Production-ready. Open registration. Real users.

### Tasks

1. **Performance audit:** Lighthouse scores, Core Web Vitals
2. **Mobile polish:** Test every flow on real mobile devices
3. **Error handling:** Graceful errors everywhere, no blank screens
4. **Loading states:** Skeleton screens for all data-heavy pages
5. **SEO finalization:** Full sitemap, robots.txt, structured data
6. **Analytics:** PostHog events on all key actions
7. **Error tracking:** Sentry integration
8. **Email flows:** Welcome email, weekly digest
9. **Landing page:** Marketing page for logged-out users
10. **Domain setup:** hadouken.gg pointed to Vercel
11. **Beta testing:** Invite 20–50 users for feedback
12. **Bug fixes from beta**
13. **Launch:** Open registration, share on Twitter/Reddit/fantasy communities

### Deliverable
Production app live at hadouken.gg with real users.

---

## How to Work With Claude Code

Each phase has a corresponding prompt in `05-CLAUDE-CODE-PROMPTS.md`. The workflow for each phase:

1. **Read the phase prompt** in the prompts doc
2. **Open Claude Code** in the `hadouken/` repo directory
3. **Paste the phase prompt** — Claude Code will implement the tasks
4. **Review the output** — test in browser, check for issues
5. **Iterate** — ask Claude Code to fix issues, adjust styling, etc.
6. **Design sync** — use Figma MCP to pull design specs into Claude Code for pixel-perfect components
7. **Commit and deploy** — push to GitHub, Vercel auto-deploys

### Tips for Working With Claude Code as a Non-Coder

- **Always have CLAUDE.md at the root.** This is the project's instruction manual for Claude Code. It knows the stack, conventions, and patterns.
- **Be specific in your asks.** Instead of "make the list page better," say "add a skeleton loading state to the list page that shows 6 placeholder cards while data loads."
- **Work in small chunks.** Don't ask Claude Code to build an entire phase at once. Break it into the individual tasks listed above.
- **Test after each task.** Run `npm run dev` and check the result before moving on.
- **Use `git diff` to review changes.** Even as a non-coder, reading diffs helps you understand what changed.
- **Leverage Figma MCP.** Design a component in Figma, then tell Claude Code: "Match this Figma component: [link]." It can pull the design specs and generate matching code.
- **Don't be afraid to undo.** `git stash` or `git checkout .` reverts all uncommitted changes. You won't break anything permanently.
