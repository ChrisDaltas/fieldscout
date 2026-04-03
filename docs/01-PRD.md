# Product Requirements Document: Hadouken Fantasy Football

**Version:** 1.0
**Author:** Chris Daltas
**Date:** March 29, 2026
**Status:** Draft

---

## Vision

Hadouken is the all-in-one community app for fantasy football players. It combines player lists, rankings, stat research, league simulation, and social credibility into a single platform — starting with the NFL. Think of it as "Spotify for fantasy football rankings" meets "PFF for the people."

The north star is simple: **help fantasy football players make better decisions, prove they know what they're talking about, and have fun doing it.**

---

## Target Users

**Primary:** Hardcore fantasy football players who play in one or more leagues, consume fantasy content weekly, and argue about player rankings wiht friends and on social media sites like Youtube/Twitter/Reddit/Discord.

**Secondary:** Casual fantasy players who want an edge during draft season and weekly lineup decisions.

**Tertiary:** Fantasy football content creators who want to build an audience around their expertise.

---

## Product Principles

1. **Lists are the atomic unit.** Everything in the app flows from the concept of a list of players. Rankings, teams, research tables — they're all lists at their core.
2. **Social by default.** Public rankings create network effects. The more people rank, the better the aggregate data gets, and the more reason there is to be here.
3. **Earned credibility, not purchased.** Cred points come from accuracy, not money. Pro unlocks convenience features, never accuracy advantages.
4. **Your league, your rules.** Custom scoring systems ensure the app is relevant to each user's actual home league — not just generic projections.
5. **AI assists, humans decide.** AI recommendations surface insights but the user always makes the final call.
6. **Experts belong here.** Fantasy football influencers and analysts are first-class citizens. Their rankings are prominently featured, and Hadouken gives them a home for their content and an audience that takes it seriously.

---

## Core Concepts / Glossary

| Concept | Description |
|---------|-------------|
| **List** | A collection of NFL players curated by a user. Like a Spotify playlist — each player can only appear once per list. Every list has an order — that order is the ranking. Lists are public by default and have shareable links for social media, email, or text. Users can explore anyone's lists, duplicate them, edit and save. |
| **Ranking** | The default state of every list. Players are always in an order — top to bottom — and that order is their rank. There is no separate "ranked mode" to enable. A list is ranked unless the user explicitly marks it as unranked. |
| **Unranked List** | A list explicitly marked by the user as having no meaningful order — just a collection of players. Example: "Guys I'm watching this offseason." Unranked is an opt-out, not the default. |
| **Tiers** | An optional view mode on top of a ranked list. When tiers are enabled, the list is displayed as rows of player cards grouped by tier label (S, A, B, C, D, F — best to worst). Within each row, cards are ordered left to right from highest to lowest rank. Users can also switch to a stacked list view within tiers mode, which shows the same grouping vertically. The underlying rank order is always preserved — tiers is purely a way of viewing and presenting that rank, not a different system. Designed for hardcore rankers, draft content creators, and fantasy influencers sharing tier-based takes. Not on by default. |
| **Average Rank** | System-calculated aggregate ranking across all user rankings for a given position/context. Visible to everyone. |
| **Expert Consensus Rank** | System-calculated aggregate ranking across all high performing, defined as 80th percentile and better by prediction accuracy, user rankings for a given position/context. Visible to everyone. |
| **Cred** | Hadouken's reputation currency. A cumulative score earned through participation (submitting rankings and Start or Sit votes) and prediction accuracy. Distinct from accuracy — cred rewards showing up consistently as well as being right. Accumulates into a rank tier: Freshie → Sophomore → JV → Varsity → Rookie → Veteran → All Pro → Local Legend → Hall of Famer → GOAT. |
| **Accuracy** | A pure mathematical stat measuring how closely a user's submitted ranking matched actual fantasy point outcomes, calculated using Spearman rank correlation. Displayed as a percentage on a user's profile. Separate from cred — a user can have high cred (lots of participation) and average accuracy, or vice versa. |
| **Team** | A "locked-in" list that represents a fantasy roster. Tracks week-to-week performance. Converting a list to a team is like converting a playlist to an album. |
| **League** | A group of teams bound together. Each player can only exist on one team within a league. Simulates a user's real home league. This allows AI to make recommendations on who to pickup from the Waiver Wire or what trades to offer to improve their team. |
| **Scoring System** | A custom set of rules that determine how real NFL stats convert to fantasy points. Users can create their own custom scoring system based on their home league and apply it while doing their player research. |
| **Profile** | A user's public page showing their big board, lists, rankings, cred score, accuracy metrics, and follower count. Shareable link for bragging rights. |
| **Research Table** | A custom, filterable table of players and their stats. Users build these in the Research tab with their preferred scoring system applied. |
| **Big Board** | Every user's permanent, personal top-100 overall player list. Auto-created on signup. Cannot be deleted. Filters applied to a Big Board can be instantly converted into a new standalone list. |
| **Tag** | A label attached to a list that enables one-click discovery (e.g., "Week 3", "Sleepers", "Busts", "Rookies"). System tags are provided by Hadouken; users can also apply any custom tag text. Tags are browsable from the Explore/Homefeed. |
| **Start or Sit** | A community Q&A feature where users post a dilemma — two players, one slot — and the community votes on who to start. After the week's games, votes are scored for accuracy and cred points are awarded to correct voters. |
| **Expert Profile** | A profile representing a well-known fantasy football analyst or influencer (e.g., Matthew Berry, Field Yates). Expert profiles are claimed by the real person, who then controls their own rankings directly on Hadouken. Unclaimed profiles exist as placeholders with no rankings displayed. |
| **Claimed Profile** | An Expert Profile that has been verified and taken over by the real person. Claimed profiles have a verified badge and the expert manages their lists and rankings directly on Hadouken like any other user. |
| **Expert Rankings Hub** | A public, SEO-optimized section of Hadouken that aggregates rankings from claimed fantasy football experts in one place. Usable without an account. Only shows real rankings from real claimed experts — no AI-generated content. |

---

## Feature Breakdown: V1

### F0: Anonymous / Guest Experience (High Priority)

**Description:** Users who land on Hadouken — signed in or not — are dropped immediately into a product experience, an interactive "big board" where they can start to re-order the top 50 players and expand with a dropdown all the way to the top 300. They can also explore publicly created lists and search. There is no splash page. However, we will want a "sign up" with a strong marketing line that is fixed in place just below the top bar. But from a high level, the product IS the landing page. Users can explore lists, but will be prompted to sign up if they want to create or duplicate a list or do any activity that requires persistence, like saving changes to the big board they get dropped into. Any work they do as a guest carries over seamlessly when they sign up.

**The anonymous experience:**
- A new visitor landing on hadouken.gg is immediately presented with an interactive guest Big Board — a full list of NFL players they can start adding, reordering, and exploring right away. When they make edits a CTA to update their big board appears. This will prompt them to sign up if clicked.
- Guest state is stored in the browser (local storage) — no account required
- Public lists, consensus rankings, and expert profiles, are all viewable without an account.

**Contextual sign-up CTAs — not a wall:**
- Sign-up prompts appear only at natural moments when persistence is needed:
  - "Save this list" → prompts sign-up
  - "Save changes to big board" → prompts sign-up
  - "Follow this user" → prompts sign-up
  - "Like this list" → prompts sign-up
- CTAs are framed around the value: "Save your rankings", "Track your accuracy", "Share your Big Board" — not "Create an account to continue"
- Guests can always keep exploring without signing up.

**State transfer on sign-up (critical):**
- When a guest creates an account, everything they built as a guest transfers to their new profile automatically — their guest Big Board becomes their real Big Board, any lists they created become their lists
- This must work seamlessly — if the state transfer fails or the work disappears, the entire onboarding concept breaks
- Implementation: guest session state stored in local storage, migrated to the new Supabase profile row on account creation via a one-time transfer function

**Technical implications:**
- The `players` table RLS must allow anonymous (unauthenticated) reads so guest users can browse and add players
- Consensus rankings and public list pages must be fully server-rendered and accessible without auth (already planned for SEO)
- A guest session ID (stored in local storage) tracks anonymous activity for state transfer

---

### F1: User Accounts & Profiles

**Description:** Users sign up, create a profile, and get a shareable public profile page.

**Requirements:**
- Sign up via email only
- First and Last Name
- Username selection (unique, URL-safe, displayed publicly)
- Profile photo upload (optional)
- Professional teams they root for (optional)
- Profile page shows: username, photo, cred score, accuracy metrics, current rank tier (Freshie → GOAT), follower/following counts, big board, all public lists, all public teams, all public leagues
- Shareable profile URL: `hadouken.gg/u/{username}`
- Follow/unfollow other users
- Notification preferences (email digest frequency)

**Free vs Pro:**
- Free: Full profile functionality
- Pro: Verified badge (the purpose of the badge is to encourage free users to upgrade)

---

### F2: Player Lists

**Description:** The core feature. Users create, manage, and share lists of NFL players. Every list has an order — that order is the ranking. Ranking is not a separate mode; it is the default state of every list.

**How ordering works:**
- Players in a list always have an order. When adding players — whether to a new list or an existing one — they always go to the bottom. The order is always exactly what the user has set, nothing more.
- **Smart Order button:** At any point, the user can tap Smart Order to instantly re-sort the entire list by a chosen criterion: fantasy points (prior season or season-to-date), projected points, consensus rank, or ADP. This is the fast way to get a meaningful starting order before fine-tuning. Without Smart Order, the list stays in the order players were added.
- **Drag and drop:** After Smart Order (or at any time), players can be dragged to any position for granular manual adjustment.
- **"Set as My Rank":** Commits the current order as the user's personal ranking for that list, making it their official stance.
- **Unranked toggle:** A user can explicitly mark a list as "unranked" to signal to viewers that the order carries no meaning — it's just a collection. Unranked is the opt-out; ordered is always the default.

**View modes (available on all lists):**
- **Card view** — players displayed as a grid of cards
- **List view** — players displayed as a vertical stack, with two density options:
  - **Compact** — tight rows, more players visible at once
  - **Comfortable** — taller rows with more player detail visible
- The user's view preference persists per list

**Tiers (optional view mode):**
- Any list can have tiers enabled. Tiers are a view mode — a way of presenting a ranked list, not a separate ranking system. The underlying rank order is always preserved.
- When tiers are on, the list is grouped into tier rows (S through F, top to bottom) within whichever view mode the user has selected. In card view, cards run left to right from highest to lowest rank within each tier row. In list view, players stack vertically within each tier group.
- **Visual treatment:** Tier labels (S, A, B, C, D, F) appear as a vertical axis on the left side of the list. Each tier has a distinct color — following the widely recognized internet tier list convention (e.g., S = pink/red at the top, descending through the spectrum). Exact colors are defined in Figma; they should be visually distinct from one another and non-clashing.
- Turning tiers on or off does not change the underlying player order. It only changes how the list is presented.
- **Convert to Team:** When team mode is enabled from the options menu it will prompt a pop-up menu where a user names their team, selects a scoring system, adds roster spots, bench spots, and IR spots. Once a list converts to a team it will appear under the Teams section of the navigation bar. Teams will have 3 sections starters, bench, and IR. A teams scoring will be tracked and logged on a weekly basis. Teams will also have web sharable URLs for sending to friends. 

**Requirements:**
- Create a list with: title, optional description, optional link field to a source or youtube video, optional position filter (QB, RB, WR, TE, K, DEF, FLEX), private on or off, comments on or off, tags (up to 5)
- Add players via search (autocomplete by name, team, position)
- Remove players from a list
- Each player can only appear once per list
- Lists display player name, team, position, headshot, and key stats
- Public by default
- Users can have unlimited lists
- Lists have a shareable URL: `hadouken.gg/u/{username}/lists/{list-slug}`
- Lists show creation date, last updated date, and total player count
- Users can duplicate a list (fork it)
- Users can "like" other users' lists
- Users can comment on lists if comments are turned on
- Sort options available to the user: fantasy points (default), projected points, consensus rank, ADP
- "Set as My Rank" button commits the current sort order as the user's personal ranking
- Drag-and-drop reordering for fine-tuning individual player positions
- Ranking changes are timestamped (history of rank changes per player)

**Free vs Pro:**
- Free: Unlimited public lists, 1 private list
- Pro: Unlimited private lists

---

### F2A: Big Board

**Description:** Every user's permanent personal ranking — a visual, always-present home base on their profile. The Big Board is the simplest entry point to Hadouken: you don't need to submit rankings, create lists, or do anything formal. Just come in, move players around, and the system passively tracks how your ordering compares to real outcomes. It's the one thing a casual user might only ever use.

**Season-long (pre season) Big Board vs. Weekly Big Boards:**
- Every user has one **season-long Big Board** — their overall player rankings for the entire NFL season, set before the season starts. This is the primary "Big Board" during draft season and it can be used to quickly create positional ranks using filters for draft prep. It also has a "draft mode" so users can mark players as drafted during a live draft. Free accounts get one pre-season big board. Pro users can create multiple ie one for every league and select a custom scoring system for viewing last seasons and projected fantasy points. Once the season starts these lock and track accuracy through the season. 
- Once the regular season begins the weekly Big Board is activated, **weekly Big Boards for each NFL week (1–18) become available** — a separate ranking view scoped specifically to that week. Think of it like a team's weekly lineup: just because Jonathan Taylor is your RB1 season-long doesn't mean he should hold that spot in Week 8 if he's on a bye and not playing.
- **Weekly carryover — not from season-long:** Each week's Big Board defaults to carrying over from the *previous week's* Big Board, not from the season-long. Week 1 is the one exception — it is initially pre-populated from the season-long Big Board. From that point: Week 1 → Week 2 → Week 3, and so on. If a user hasn't touched a given week, it inherits whatever the prior week looked like.
- The season-long Big Board is a **separate, independent track** — it locks and weekly boards do not propagate changes back to it.
- Weekly big boards do not unlock until the current weeks big board lock. Once the first Sunday game kicks off that weeks board is locked. Thurday players will lock into their current position at the start of the Thursday game, the rest of the players will still be editable until first Sunday kickoff.
- **No future week editing:** Users can only edit the current week's Big Board. Future weeks are visible in the UI but locked. This is intentional — users should come back to the app each week to make updates, not front-load the entire season at once.
- **No special modes:** Big Boards are always ranked. The don't support Tiers, and cannot be converted to a team. They also cannot be rearranged with a filter applied.
- **Week navigation UI:** Once the season starts, the Big Board tab displays a horizontal week selector at the top of the screen — weeks 1 through 18 shown left to right, similar to a roster screen in a fantasy app. The current week is the active/selected state by default. Past weeks are viewable (read-only). Future weeks are visible but locked.
- Weekly Big Board URLs: `hadouken.gg/u/{username}/big-board/week/{week-number}`
- Weekly Big Boards are available for all 18 regular season weeks. Preseason and playoff weeks are out of scope for now.

**Size:**
- Default size is **top 50**. Users can configure their Big Board size anywhere from top 25 to top 300. Size setting applies to both season-long and weekly Big Boards.
- Players beyond the user's configured size are not shown but are not deleted — expanding the board later reveals them.

**Workspace behavior — explicit save required:**
- The Big Board is a **workspace**. When a user opens it and starts moving players around, those changes are in a working state only — they are not saved automatically.
- To commit changes, the user must hit **"Update Big Board."** This saves the current working state as the new official Big Board.
- If the user leaves without saving, the Big Board reverts to exactly what it was at the start of that session.
- This allows users to freely experiment — filter, rearrange, try things out — without fear of accidentally changing their public ranking.

**Creating lists from the Big Board:**
- At any point during a session (saved or unsaved state), the user can filter the Big Board by position or any other criteria and hit **"Create List."**
- This forks the current working view into a new, fully independent list. The new list has no ongoing connection to the Big Board — it is its own object from that point forward.
- Example: filter Big Board to RBs, hit Create List → "Week 3 RB Rankings" is now a standalone list. The Big Board itself is unchanged unless the user also hits Update Big Board.

**Multiple big boards:**
- Pro users can create multiple big boards with rankings using custom scoring, these can also be made private. They do not overwrite the stardard public big board. 

**Automatic accuracy tracking:**
- Every time a user hits Update Big Board, the system records that saved state and passively tracks how it performs against real fantasy point outcomes.
- The season-long Big Board is evaluated against cumulative season totals. Each weekly Big Board is evaluated against that week's actual fantasy point output.
- **Big Board season long and weekly accuracy are their own separate stats** — displayed on the profile distinctly. It is inherently more casual for most users, but for influencers and high-profile rankers whose Big Boards, both season long and weekly is their public identity, it is a key credibility signal.
- Every Updated Big Board action earns cred — both a base participation amount and additional cred proportional to how accurately that saved state predicted outcomes. This is the passive cred path for users who never explicitly submit weekly rankings.

**Other requirements:**
- Created automatically on signup, in the Big Board section of the navigation where there are two sub sections for Season and Weekly. Cannot be renamed, deleted, or converted to a team. Cannot be marked as unranked — it always has a meaningful order.
- View modes (card, compact list, comfortable list) available. Default is card for Big Board while lists are compact list.
- Always public — cannot be made private. It is a user's canonical public statement of how they rank players.
- Season-long Big Board URL: `hadouken.gg/u/{username}/big-board`
- **Consensus Big Board:** The platform maintains a system-wide Community Big Board — consensus top players across all user Big Boards, weighted by cred score.

**Free vs Pro:**
- Free: One big board, full functionality (season-long + all weekly Big Boards). Standard scoring systems only.
- Pro: Multiple Big Boards, supports multiple rankings via custom scoring.

---

### F2B: Tags

**Description:** Lists can be tagged with short labels that enable one-click discovery. Tags are the fastest way for users to categorize their content and for others to find lists on a specific theme.

**Requirements:**
- Tags are attached to a list at creation time or edited later
- Each list can have up to 5 tags
- **System tags** (provided by Hadouken, always available):
  - Week 1 through Week 18 (current and historical NFL weeks)
  - Sleepers, Busts, Must-Starts, Do not draft
  - Rookies, Veterans, First-Year Starters
  - Dynasty, Redraft, Best Ball, DFS, Superflex
  - PPR, Half-PPR, Standard, TE Premium
  - Draft Day, Waiver Wire, Trade Targets, Buy-Low, Sell-High
- **Custom tags:** Users can type any custom tag (max 20 characters, no special characters)
- Tags are displayed as chips/badges on list cards in the explore feed and on list detail pages
- Tags are browsable: clicking any tag takes the user to a tag feed showing all public lists with that tag, sorted by recency and popularity
- Tag feeds have their own URLs: `hadouken.gg/tag/{tag-slug}`
- Tag feeds are public and indexable (good for SEO — people searching "Week 5 RB sleepers" can find Hadouken lists)
- The Explore and Homefeed show a horizontal scrollable row of trending tags (most-used tags in the last 7 days)
- Search results can be filtered by tag

**Free vs Pro:**
- Free: Full tag functionality (all system and custom tags)
- Pro: No additional tag features (tags are a core discovery feature for the whole community)

---

### F3: Average Rankings (Consensus)

**Description:** System-calculated aggregate rankings derived from all user rankings.

**Requirements:**
- For each NFL position, calculate average rank across all user rankings that include that position
- Weight rankings by user cred score (higher cred = more influence on average)
- Display as a public leaderboard: "Consensus Top 100," "Consensus RB Rankings," "Consensus WR Rankings," etc.
- Show how each player's consensus rank has moved over time (trending up/down)
- Show total number of users who have ranked each player
- Update in near-real-time as users submit/update rankings
- Allow the user to show average and expert consensus rankings while looking at any users ranking list so they can see how different this users rankings or their own compared to consensus

---

### F4: Homefeed, Explore & Search

**Description:** The home feed is a single chronological stream of everything relevant to you — lists from people you follow, player news for players you follow, popular community content, and featured activity from around the platform. It is the default landing page for logged-in users and the primary daily touchpoint for the app.

**Home Feed Content Types (all interleaved, chronological):**
- **Lists from followed users** — new lists created or recently updated by people you follow
- **Player news** — injury reports, depth chart changes, roster moves, and notable performances for players you follow (see F7A)
- **Popular lists** — trending lists from the broader community (most liked/viewed in the last 7 days), even from users you don't follow
- **Hot Start or Sit** — the most active or controversial Start or Sit questions right now (during the season)
- **Submission highlights** — when a followed user submits a ranked list for the week or season, a card surfaces in the feed
- **Cred milestones** — when a followed user reaches a new cred rank tier (e.g., "Chris just hit All Pro"), surfaced as a lightweight social moment

Each feed item is visually distinct by type — player news looks different from a list card, which looks different from a Start or Sit prompt — so users can scan quickly.

**Explore & Discovery:**
- Search by: player name, username, list title, or tag
- Browse trending lists (most liked/viewed in last 7 days)
- Browse by position (Top QB lists, Top RB lists, etc.)
- Browse by week (Week 2 RB rankings, Week 11 QB rankings)
- Browse by tag: clicking any tag shows a feed of all public lists with that tag (`hadouken.gg/tag/{tag-slug}`)
- Trending tags row: horizontal scroll of the hottest tags right now
- Filter by: recency, popularity, cred score of author
- "Rising rankers" section: users whose cred score is climbing fastest
- "Weekly Top Scorers" section: users who scored the most cred points in the most recent completed week
- "Season Top Scorers" section: cumulative season leaderboard
- Suggested users to follow based on similar ranking patterns

**Feed for logged-out / guest users:**
- Guest users see a default version of the feed: popular lists from the community, top player news league-wide (not personalized), and trending Start or Sit questions. No followed-user content since there is no follow graph yet.

---

### F5: Cred System

**Description:** Cred is Hadouken's reputation currency — a cumulative score earned through participation and prediction accuracy. It is distinct from accuracy, which is a separate pure mathematical stat. Cred weights a user's influence on consensus rankings and determines their rank tier on the platform.

**Accuracy vs. Cred — they are different things:**
- **Accuracy** is a pure mathematical score: how closely did your submitted ranking match the actual fantasy point output? Measured using Spearman rank correlation, displayed as a percentage. It is a cold, objective measure of prediction quality — the delta between what you said would happen and what actually did.
- **Cred** is a cumulative reputation score that combines participation (submitting at all) and accuracy over time. A user who submits every week at mediocre accuracy still earns meaningful cred for consistently putting themselves on record. Think of it like XP — you earn some for showing up, more for being right.

**Accuracy measurement:**
- Primary accuracy metric: Spearman rank correlation between submitted player order and actual fantasy point output for that period
- Displayed as a percentage on the user's profile (e.g., "73% accurate this season")
- Secondary stat: **vs. consensus delta** — how a user's accuracy compared to the crowd that week. Shown on submission history as a fun insight ("You outperformed consensus by 12 points this week") but not factored into cred calculation
- A user's accuracy is always their own absolute performance — not relative to others

**Cred calculation:**
Cred is earned through three distinct activities, each tracked separately as accuracy stats but all contributing to the single cumulative cred score:

| Activity | How cred is earned |
|---|---|
| **Big Board updates** | Base participation cred every time user hits Update Big Board + accuracy bonus based on how that saved state predicted real outcomes |
| **Weekly / season-long submissions** | Base participation cred per submission + accuracy bonus proportional to Spearman correlation score |
| **Start or Sit votes** | Cred proportional to accuracy, with a contrarian bonus for correct minority votes |

- Cred decays slowly if a user stops participating during the season
- New users start at 0 cred and still contribute to consensus rankings with a weight of 1 until they earn cred

**Rank tier progression:**
Cred accumulates into a visible rank tier displayed on a user's profile. Tiers from lowest to highest:

| Tier | Name |
|------|------|
| 1 | Freshie |
| 2 | Sophomore |
| 3 | JV |
| 4 | Varsity |
| 5 | Rookie |
| 6 | Veteran |
| 7 | All Pro |
| 8 | Local Legend |
| 9 | Hall of Famer |
| 10 | GOAT |

**Other requirements:**
- Lifetime cred score and current tier displayed prominently on profile
- Accuracy percentage displayed separately from cred score on profile
- Weekly cred earned per submission visible on submission history
- Leaderboard: top cred earners this week, this season, all-time
- Users can view any other user's full submission history — which lists they submitted, for which weeks, and how they scored

---

### F5A: Start or Sit

**Description:** A community-driven Q&A feature where users post their weekly lineup dilemmas — two players competing for one roster spot — and the community votes on who to start. After the week's games complete, votes are scored for accuracy and cred points are awarded to voters who got it right. It's the fantasy equivalent of crowd-sourcing advice while also turning the crowd into accountable predictors. After a user votes on a Start Sit question, they can see how everyone else voted in a poll style view.

**Requirements:**

**Posting a question:**
- Any user can post a Start or Sit question
- A question consists of: Player A vs Player B (search to select), an optional note ("PPR league, need 20+ points"), the relevant NFL week (auto-filled to current week), and an optional scoring system context
- Questions are public
- Users can post 1 question per week (free), unlimited (Pro)

**Voting:**
- Other users see Start or Sit questions in their Homefeed and on a dedicated Start or Sit page
- Vote by tapping/clicking the player they'd start
- Voting closes at Sunday's first kickoff (same window as weekly rankings), or at the start of Thursday's game if one of the players is playing Thursday.
- Users can see the current vote split (e.g., "64% say Start Player A") after casting their own vote
- Users cannot vote on their own question
- Each user can only vote once and cannot change after.

**Scoring & cred:**
- After the week's games complete, the system determines the correct answer: whichever player scored more fantasy points wins
- Users who voted for the correct player earn cred points
- Cred points scale with confidence of the crowd: if 90% voted wrong and you voted right, you earn more cred than if the vote was 55/45
- The question poster does NOT earn cred from votes (they posed the question, not the prediction)
- If the vote is essentially tied (within 5% of 50/50), all correct voters earn a standard baseline amount
- If a game is cancelled or a player DNPs due to injury, the question is voided (no cred awarded)

**Discovery:**
- Dedicated "Start or Sit" tab in the main navigation
- Questions from followed users surface in the Homefeed
- Browse by: most votes, most recent (default), by position, by NFL week
- After resolution, questions show the outcome: who won, vote breakdown, and total cred distributed
- Users can see their Start or Sit history on their profile: questions asked, questions voted on, accuracy rate

**Leaderboard integration:**
- Start or Sit accuracy is tracked separately from weekly rankings accuracy but contributes to the overall cred score
- Profile shows Start or Sit stats: total votes cast, accuracy %

**Free vs Pro:**
- Free: Post up to 1 Start or Sit per week, unlimited votes
- Pro: Unlimited 

---

### F6: Player Research Tab

**Description:** A powerful stats exploration tool, like a spreadsheet, where users can customize the columns and the order.

**Requirements:**
- Default view: searchable table of all NFL players with core NFL stats
- Stats available: all major NFL stats (passing, rushing, receiving, defensive, kicking)
- Fantasy points column calculated based on selected scoring system
- Users can customize which columns are visible
- Filter by: year, week, week range, year range, position, team, years of experience
- Sort by any column
- Compare mode: select 2-4 players for side-by-side stat comparison
- Stat data sourced from a reliable NFL stats API
- Historical stats: current season + as far back as NFL stats API allows
- Per-game averages and season totals toggle
- Add any player from research directly to a list
- Ability to Save the Search and share it

**Data Sources:**
- NFL stats via ESPN API, SportsDataIO, or similar
- Updated weekly during season, daily during offseason for roster moves

---

### F6A: Player Following & News Feed

**Description:** Users can follow individual NFL players to receive a personalized stream of news and updates about those players on their home feed. If someone you follow gets injured, has a depth chart change, or is involved in a significant roster move, that surfaces automatically — no hunting required.

**Requirements:**
- Any player profile or player card has a **Follow** button. One tap adds that player to the user's followed list; tapping again unfollows.
- Users can follow as many players as they want. No limit.
- Following is personal and private — it does not appear on a user's public profile.
- **Home feed integration:** News items tied to followed players appear inline in the user's home feed alongside list activity and community content. Player news items are visually distinct (e.g., a "Player News" badge or player headshot) so users can scan quickly.
- **News types surfaced:**
  - Injury reports and practice status updates (Questionable, Doubtful, Out, IR)
  - Depth chart changes (e.g., named starter, benched, moved to second string)
  - Significant roster moves (trades, cuts, signings, suspensions)
  - Game-day inactives
  - Notable stat lines or performance alerts (e.g., 3 TD game)
- **News data source:** Aggregated from a third-party NFL news/injury API (e.g., Rotowire, SportsDataIO, FantasyPros injury feed). Hadouken does not generate its own news content — it surfaces and attributes stories from existing sources.
- Each news item links out to the original source article.
- News items are timestamped. During the season, injury and status updates should surface within minutes of the official report.
- **Player page:** Each player's profile page has a dedicated news tab showing all recent news for that player, regardless of whether the user follows them.
- **Notifications (future):** Push/email notifications for followed player news is out of scope for V1 but the data model should support it.

**Free vs Pro:**
- Free: No saved searches. See a Save button that says Pro only.
- Pro: Save searches from Player Research

---

### F7: Scoring Systems

**Description:** Users can apply custom scoring rules so fantasy points on lists, custom big boards, and Player Research tables reflect their actual home league. They can also set a scoring system as the Default for a list, or they can just add it as a column or data point on a list. So, a list might have stat for the default scoring system, and the users custom both displaying at the same time.

**Platform defaults:**
- The platform ships with two primary default scoring systems: **ESPN Standard** and **ESPN PPR** — the two most widely used formats. These are the platform defaults for all users.
- Additional built-in options: Yahoo Standard, Yahoo PPR, Half-PPR, Sleeper Standard, Sleeper PPR
- Users can change the default on any list or big board they created, but the system generated big boards respect the system standard scoring systems.


**Custom scoring transparency (viewing others' lists):**
- Any list where the owner used a non-default scoring system to establish their ranking displays a **"Custom Scoring"** badge at the top of the list.
- Hovering or tapping that badge opens a small details pane showing the key differences between this list's scoring system and the platform default — e.g., "6pt passing TDs (default: 4)", "1pt per reception (default: 0)", "TE premium: +0.5 per reception." Only differences are shown, not the full ruleset.
- This gives any viewer enough context to understand why the rankings look the way they do without overwhelming them with details.

**Requirements:**
- Scoring system defines point values for each stat category (e.g., passing TD = 4pts or 6pts, reception = 0/0.5/1 pt)
- In Player Research a custom scoring system will be applied as another column, so a user could have multiple scoring systems displayed side by side.
- Custom Scoring badge appears on any list built with a non-default scoring system, with a hover/tap details pane showing key differences from platform default

**Free vs Pro:**
- Free: All built-in default scoring systems + 1 custom scoring system
- Pro: Unlimited custom scoring systems

---

### F8: Teams

**Description:** Convert a list into a "Team" that tracks week-to-week performance.

**Requirements:**
- User can convert any list into a team
- A team has a roster structure: starting lineup + bench + IR based on what the user inputs to the Convert to Team modal window or Create Team modal window if they are creating from scratch.
- Team tracks weekly fantasy point totals based on applied scoring system
- Weekly performance history visible as a chart
- Team has a "set lineup" feature: choose starters vs bench each week
- Team inherits the scoring system selected by the user
- Team keeps track of total and weekly points, and start sit accuracy. For example, if a player on the bench outscores any of the players in the starting lineup that is a start sit miss.

**Free vs Pro:**
- Free: 1 team
- Pro: Unlimited teams

---

### F8A: Live Mode

**Description:** On game days, users can launch Live Mode for any team to watch their fantasy points update in real time as NFL games are played. Fantasy points are calculated live against the scoring system enabled for that team.

**Requirements:**

**Accessing Live Mode:**
- "Go Live" button appears on a team's page exclusively during active NFL game windows (Sunday 1pm–midnight ET, Thursday Night Football, Monday Night Football, Saturday games during weeks 15–18)
- Button is grayed out with a tooltip ("Live Mode is available during NFL game windows") outside of game hours
- Tapping "Go Live" transitions the team view into Live Mode

**Live Mode interface:**
- Full-screen optimized view (or a dedicated fullscreen toggle) built for leaving on a TV or second screen
- Header shows the team name, current total live fantasy points (starters only), and a live clock/indicator pulsing green
- Players are split into three sections that update dynamically as game statuses change:
  - **Now Playing** (green pulse): players whose game is currently in progress — shown with the current game quarter + clock, live stat line, and live fantasy points
  - **Done** (gray, checkmark): players whose game has ended — shown with final stat line and final fantasy points
  - **Up Next** (white, scheduled): players whose game hasn't kicked off yet — shown with kickoff time and current projected points (based on season average in the user's scoring system)
- Each player card shows: headshot, name, position, opponent (e.g., "vs DEN"), game clock, relevant live stats (passing yards, TDs for QBs, rec yards + receptions for WRs/TEs, etc.), and current fantasy point total in the team's scoring system
- **Starters score vs Bench score**: two running totals at the top — see what your lineup is producing and what's sitting on your bench
- **Best Ball indicator**: if your bench is outscoring your starters, a subtle callout appears: "⚠ Your bench is producing more points right now"
- Fantasy points update automatically without any page refresh — powered by Supabase Realtime subscriptions to the player_stats table
- Injury and status alerts: if a player gets a status update mid-game (questionable, out, IR), a banner notification appears in Live Mode

**Update frequency:**
- Live stats sync every 30–60 seconds during active game windows via the `sync-live-stats` cron
- Outside of game windows, falls back to the standard daily sync

**Live Mode across the app:**
- **Start or Sit**: questions for the current week show a live resolution preview as games play — the player currently leading in fantasy points is highlighted, though the question isn't officially resolved until all games finish
- **Weekly rankings**: a user's accuracy on their weekly submission starts updating live on Sundays as actual fantasy point totals accumulate

**Free vs Pro:**
- Free: Live Mode available for their 1 team
- Pro: Live Mode available for all teams simultaneously (multi-team game day view)

---

### F9: Leagues

**Description:** Groups of teams that simulate real fantasy leagues with player exclusivity.

**History Mode:** The League Owner can add history mode to a league they created for $5 per year. When History Mode is activated it keeps track of how each team performs, average points per week, win percentage and head to head matchup outcomes. For example, you should be able to see the head to head record between any two teams as long as History Mode was turned on for that season. History Mode can also be retroactively paid for an unlocked.

**Requirements:**
- Create a league: name, number of teams, scoring system, roster settings
- Invite other users to join with their teams OR create placeholder teams
- Within a league, each NFL player can only be on one team (exclusivity enforced)
- Trade recommendations: AI suggests trades based on team needs and player values
- Add/drop recommendations: AI suggests available players worth picking up
- Waiver wire simulation
- League chat (simple messaging)
- League standings based on weekly team performance
- League Owner has the ability to set head to head matchups each week
- League Owner has the to assign who won each game, even if the system had calculated the points differently
- League Owner has the ability to move players between rosters
- League Owner has the ability to manually edit fantasy points

**Free vs Pro:**
- Free: Can join unlimited leagues but cannot create any
- Pro: Can create or join unlimited leagues

---

### F10: Pro Subscription

**Description:** Premium tier that unlocks convenience and power-user features.

**Requirements:**
- Monthly and annual pricing options
- Payment via Stripe
- Features unlocked by Pro:
  - Unlimited private lists
  - Multiple Big Boards
  - Submit weekly rankings for all positions
  - Custom scoring systems
  - Unlimited teams
  - League creation
  - Ad-free experience
- 4-week free trial
- Cancel anytime

---

## V2 Features (Future — Not in Scope for V1)

- **Betting on Start Sit:** Users can bet on fantasy point outcomes (over/under on player performance, head-to-head matchups)
- **Real Fantasy Platform (V3):** Hadouken becomes an actual fantasy football hosting platform where users draft, trade, and compete for real.

---

## Success Metrics

| Metric | Target (3 months post-launch) |
|--------|-------------------------------|
| Registered users (3 months post-app-launch) | 10,000 |
| Weekly active users | 3,000 |
| Lists created | 50,000 |
| Big Boards with 10+ players | 6,000 |
| Weekly ranking submissions (during season) | 5,000/week |
| Start or Sit votes cast (during season) | 10,000/week |
| Pro conversion rate | 5% |
| Average session duration | 8+ minutes |
| User retention (week 4) | 40% |

---

## Non-Functional Requirements

- **Performance:** Page loads under 2 seconds on 4G. List operations feel instant (<200ms).
- **Scalability:** Architecture should support 100k users without re-architecture.
- **SEO:** Profile pages and consensus rankings should be indexable and shareable.
- **Accessibility:** WCAG 2.1 AA compliance.
- **Mobile:** Fully responsive — drag-and-drop rankings must work on touch devices.
- **Offline:** Not required for V1, but architecture should not preclude it.
