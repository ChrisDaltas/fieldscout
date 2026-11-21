# Highlights & Watch — PRD

Oct 14, 2026 · @Chris

## Summary and goals

Bring official NFL and college highlight videos into the app: on every page where a player or team appears, and in a dedicated Watch tab laid out like a streaming service. Every video plays through YouTube's official embed player from official channels only.

**Goals**

- Make the app somewhere people come to watch, not just check scores.
- Personalize video around what each user cares about: the players they roster, their team, their conference.
- Tie watching to decisions: a waiver pickup, a start/sit, a Duel swap.

**Non-goals (for now)**

- Licensed full-game or every-snap film. The player page is designed so it can be added later.
- Downloading, clipping or re-hosting any video.
- User-uploaded video.

## Video index

Every highlight surface reads from one index of videos, built by ingesting official channels' upload lists through the YouTube Data API v3. Per-player searches would exhaust the API quota (about 100 units per search against a default 10,000 a day); reading upload playlists costs about 1 unit per 50 videos.

**Sources** (kept in an editable `video_sources` table)

- NFL official channel.
- All 32 official team channels.
- Official college conference channels (SEC, Big Ten, ACC, Big 12, etc.) and major program channels.
- Optional later: official NFL Draft and Combine content.

**Matching videos to players and teams**

- Parse title and description against the player table: full name, common nicknames, team, opponent.
- Disambiguate shared names by team, season and publish date.
- Link the video to the NFL game or college game when the title names a matchup and date.
- Store a confidence score per match; low-confidence matches go to an admin review list with manual override.

College matching needs a college player table (name, school, position, class year, draft status) that links to the NFL player table once a player is drafted. Without it, college videos can't be matched to anyone who isn't in the NFL yet, which blocks the Prospects and My conference rows.

**Classification** (per video)

| Field | Values |
| --- | --- |
| Level | NFL, college |
| Type | Player highlights, game recap, top plays, analysis, other |
| Focus | Player-focused (one player featured) or appears in |
| Season and week | From the linked game, or publish date |
| Position tags | From matched players |

**Refresh**

- Nightly job: pull new uploads from every source.
- Hourly on game days (Thursday, Sunday, Monday): pull new uploads from NFL and team channels so recaps appear within hours.
- Re-check stored videos on a rolling basis and drop ones that are deleted, private or no longer embeddable. Follow YouTube API Services policies on how long API data can be stored before refreshing.

## Highlights across the app

Video shows up wherever a player or team already appears, so people watch in context without hunting for it.

| Page | What appears | Notes |
| --- | --- | --- |
| Player profile | Play button in the header (plays a reel); rows: This season, NFL career, College | Rows hidden when empty; player-focused videos first |
| Fantasy team page | Play icon on each player row with clips; "Watch your week" button | Plays every rostered player's latest highlights back to back |
| Matchup page | "Watch the matchup": both teams' players' highlights from that week | Great for Monday-morning recaps |
| League home | "League highlights this week": top performers rostered in your league | Ranked by fantasy points scored |
| Duel results | Highlights of the players who decided the duel | Includes your best swap's player |
| NFL team page | Team's latest game recap, top plays this season | From the team's own channel |
| Waiver wire | Play icon next to available players with recent clips | "See why he's trending" before you claim him |

**Player profile rows**

1. **This season:** NFL or team channel, current season, newest first.
2. **NFL career:** earlier NFL seasons, newest first.
3. **College:** college sources, published before the player's draft date.

Within each row, player-focused videos rank above game recaps where the player only appears. If a player has no videos at all, the section collapses to a single quiet line.

## Watch tab

A top-level tab laid out like Hulu or Netflix: a hero video, then horizontal rows of video cards, scrolling down through personal, weekly, positional, team and college content.

**Page layout**

- **Hero:** the week's top play, autoplaying muted, with the player's fantasy points.
- **Filter chips** across the top: All, NFL, College, My players, My team.
- **Rows**, each a horizontal scroller with a title, a "See all" link and 10–20 cards.
- **Card:** thumbnail, duration, player or matchup name, and a small fantasy-points badge when relevant. Players you roster get a highlight ring.

**Row catalog**

| Row | Contents | Personal? | Launch? |
| --- | --- | --- | --- |
| My players | Latest clips of everyone you roster across all leagues, sorted by points they scored for you | Yes | Yes |
| My team | Your favorite NFL team's latest recap and top plays | Yes | Yes |
| Top performances this week | Highlights ranked by fantasy points | No | Yes |
| New this week | Most recent official uploads | No | Yes |
| Top QBs / RBs / WRs / TEs of the week | One row per position, ranked by fantasy points | No | Yes |
| Rookies | Clips of first-year players, ranked by recent production | No | Yes |
| Game recaps | Every game this week, sorted by kickoff | No | Yes |
| Teams | A row of team logos; tap opens that team's videos | No | Yes |
| Waiver wire tape | Breakout players under 50% rostered | Partly | Phase 2 |
| Your opponents' players | Clips of this week's fantasy opponents | Yes | Phase 2 |
| My conference | Your favorite college conference's top plays | Yes | Phase 2 |
| Top college prospects | Clips of ranked draft prospects | No | Phase 2 |
| Trending | Most-watched in the app in the last 24 hours | No | Phase 2 |
| Throwback | Classic plays of today's opponents or this week's milestones | No | Phase 3 |

**Ordering the rows**

- Personal rows first when the user has rosters or favorites set; otherwise the weekly rows lead.
- Rows with fewer than 3 videos are hidden.
- Order changes by day: on Monday and Tuesday, "Top performances" leads; on Wednesday through Saturday, "Waiver wire tape" and "My players" lead; on game days, "New this week" moves up.

**Favorites setup**

- Ask once during onboarding: favorite NFL team, favorite college team or conference. Both optional, editable in settings.
- Don't infer from location.

## Playback, empty states and edge cases

Playback always uses YouTube's IFrame Player API, inside an in-app player sheet so people never leave the app.

**Playback**

- Tapping a card opens a full-width player sheet; swipe down to dismiss.
- Reels ("Watch your week," profile play button) use a queue: auto-advance to the next video, with an "Up next" strip and skip controls.
- Below the player: the player or matchup, that week's fantasy line, and a link to the player profile.
- Remember muted/unmuted preference.

**Empty states**

- A row with fewer than 3 videos is hidden.
- A player with no videos: one line, "No highlights yet," and no rows.
- "My players" with no rosters: replaced by a prompt to join or create a league.

**Edge cases**

- Video removed after indexing: the card disappears on next refresh; if tapped first, skip to the next video and drop it from the index.
- Region-blocked or age-restricted videos: skip silently.
- Same name, two players: show only matches above the confidence threshold.
- Traded or released players: the video keeps the team from its game date.

## Data model and jobs

Four tables and three jobs on the existing Supabase and Vercel stack.

| Table | Key columns |
| --- | --- |
| `video_sources` | id, youtube\_channel\_id, uploads\_playlist\_id, level (nfl, college), team\_id or conference, active |
| `videos` | youtube\_id, title, description, source\_id, published\_at, duration\_s, thumbnail\_url, level, type, season, week, game\_id, embeddable, last\_checked\_at |
| `video_players` | video\_id, player\_id, focus (featured, appears), confidence, manual\_override |
| `video_teams` | video\_id, team\_id |
| `user_favorites` | user\_id, nfl\_team\_id, college\_team\_id, conference |

**Jobs**

- **Ingest** (nightly; hourly on game days): read new items from each source's uploads playlist, insert videos, run matching.
- **Match:** title and description parser plus player lookup; writes `video_players` with confidence.
- **Refresh:** re-check a rolling batch of stored videos each night; mark deleted or non-embeddable ones.

**Row queries**

- Each Watch row is a SQL view or function (e.g. `watch_top_performances(week)` joins `videos` to weekly fantasy points).
- "My players" and "My team" take the user id and are cached per user for 10 minutes.
- Rows cached at the edge for 5 minutes on game days, 1 hour otherwise.

## SEO

Public highlight pages can bring in search traffic, but only if each page carries its own text. An embedded YouTube video alone won't rank; search engines credit the video to YouTube.

- Public, server-rendered pages (Next.js with incremental static regeneration): `/players/[slug]/highlights`, `/teams/[slug]/highlights`, `/week/[n]/top-plays`, `/games/[id]`.
- Each page pairs the videos with unique text: the stat line, fantasy points, game context and a short auto-written recap ("Nacua: 9 catches, 142 yards, 2 TD vs. SF").
- `VideoObject` structured data on each embedded video, plus `SportsEvent` on game pages.
- Sitemaps regenerated after each game day.
- Personal rows (My players, My team) stay behind login; everything else is public.

## Metrics, milestones and open questions

**Success metrics**

- Share of weekly active users who play at least one video.
- "Watch your week" plays per active team per week.
- Videos per session in the Watch tab.
- Organic search visits to public highlight pages.

**Milestones**

1. **H1 — Index:** sources table, ingestion, matching, refresh. Admin review list.
2. **H2 — Player profile highlights:** play button and three rows.
3. **H3 — Team page:** per-player play icons and "Watch your week."
4. **H4 — Watch tab v1:** launch rows from the row catalog, favorites setup.
5. **H5 — SEO pages:** public highlight pages, structured data, sitemaps.
6. **H6 — Phase 2 rows:** waiver wire tape, opponents, conference, prospects, trending.

**Open questions**

- [ ] Where does the "Top college prospects" ranking come from? It needs a draft prospect data source.
- [ ] Daily YouTube API quota: is 10,000 enough at full source count, or request an increase?
- [ ] Should the hero video autoplay on mobile data?
