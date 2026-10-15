# Mobile build report (2026-10-15)

## home  (review findings: 9)

### Built
I checked all 9 review findings against the spec and fixed every one; I rejected none. tsc shows no errors in my files, eslint is clean, and the area's vitest passes (31/31, home and notifications).

1. Sample data: I took Scout AI and Top waiver adds off mobile Home. Both were copies of the desktop's hard-coded TODO(live-draft) mocks. The AI experts shelf uses real data, so it stays. CLAUDE.md's "keep AI features" rule doesn't apply here, because there is no AI behind the Scout AI card.
2. Rankings and Start/Sit tiles now only show while featureFlags.weeklyRanks / startOrSit are on. Those are the same flags Profile uses to offer those segments. The grid keeps 3 columns, so each tile stays its designed size.
3. A league in `drafting` no longer shows "Pre-draft". Cards now go by league phase:
   - pre-draft (setup / scheduled): the orange pill; opens the League tab's Matchups segment, which is the draft home (checklist, countdown, lobby). I force that segment so it opens there even if Standings was last open.
   - draft-live (drafting): a new green "Draft live" pill; opens the draft room `/app/leagues/{id}/draft` with `useRoomEntryTarget`.
   - season: opens the Match tab.
   The week label and data reads only use leagues whose season is in play.
4. The Rankings count now comes from `useMobileProfileRankings`, the same read Profile › Rankings lists. Start/Sit uses `useMobileProfileStartSit` with `ssCounts` from profile-ops. So the tile count and the Profile rows always match.
5. A trade notification opens that trade's detail: `/app/leagues/{id}/trades?trade={trade_id}`. If the row has no trade_id, it falls back to the Trades list. This lives in a new mobile-only helper; the shared notificationHref is untouched.
6. Trending now has "See all" (13px/600, accent, tap area padded to 30px). It opens `/app/leagues/{id}/players?status=avail` for the first in-season league, otherwise the first unfinished one. It is hidden when there is no such league.
7. Injury news: a roster read that never loaded now shows the section's error with Try again, instead of a list missing "On your roster". Finished leagues no longer count as "On your roster".
8. A failed My stuff count now shows "Couldn't load" on the tile, plus "Couldn't load some of your counts." with Try again under the tiles.
9. Waiver-claim notifications now link to Transactions: "My moves" for a won claim, league-wide for a lost or failed one.

I added tests for each change: card routes, the Draft live pill, flag-gated tiles, the count error, the roster error, the absence of mock content, the See all link, and the notification doors.

### How to reach
Use the mobile layout (touch device, or pick the mobile layout on desktop):
- Home: `/app`.
- My stuff tiles open `/app/profile?tab=lists`, plus `?tab=rankings` and `?tab=ss` when the weeklyRanks / startOrSit flags are on (they are on in dev).
- League cards (leagues flag): an in-season card opens `/app/leagues/{id}/matchup`; a pre-draft card opens `/app/leagues/{id}` on Matchups (the draft home); a drafting card shows "Draft live" and opens `/app/leagues/{id}/draft`.
- Trending: tap "See all" to reach `/app/leagues/{id}/players?status=avail`.
- Notifications: tap the Home bell to reach `/app/notifications`. A trade row opens `/app/leagues/{id}/trades?trade={tradeId}` (the detail overlay). A waiver row opens `/app/leagues/{id}/activity/transactions` (`?mine=1` when won).
- To see the launch tiles, set NEXT_PUBLIC_FLAG_WEEKLY_RANKS=false and NEXT_PUBLIC_FLAG_START_OR_SIT=false: only the Lists tile shows.

### Gaps
- League card win-probability bar + "66% win" — the design shows a win-prob fill and a coloured % — the app has no win-probability model (F566); I left a spacer between the scores
- League card red alert dot — the design shows an 8px red dot — the design defines no trigger (Q9) and the app has no matching signal
- Rankings tile "· M submitted" — the design shows "3 rankings · 2 submitted" — the app stores no submitted state, so the tile shows "N rankings" (Profile › Rankings' rows)
- Rankings and Start/Sit tiles — the design always shows 3 tiles — both surfaces are flag-off at the 2026 launch, so at launch only the Lists tile shows, in the left column of the 3-column grid. Chris may prefer a different launch layout
- "Draft live" pill on drafting leagues — the design never shows a league mid-draft — I added a green-tint version of the Pre-draft pill with a live dot; the card opens the draft room
- Trending Adds/Drops — the design shows add/drop counts ("+502.1K") and "% rostered" — there is no source for add/drop counts or % rostered. The rows use the app's only trend signal (projection vs last season), labelled Risers/Fallers, with the meta line "RB · CHI · Proj 160.0 · Last yr 100.0"
- Trending "See all" — the design opens League › Players with the Trending tile row and segment open — the Players screen has no Trending section (no source), so the link lands on the Available list without it
- Injury news time + newest-first — the design shows "2h"/"1d", newest first — the feed has no news timestamp, so I left the time out; rows are ordered your players first, then by relevance
- Injury news "See all" — the design only shows a toast — no destination exists, so I left it out
- Scout AI card and Top waiver adds (desktop Home only) — not in the design — both are hard-coded samples on desktop (no insights source, no waiver feed), so mobile leaves them out until a real source exists
- Notification types: player scored a TD, out-and-in-your-lineup, lineup-lock reminder, followed user updated a ranking — the design shows them — the backend generates none of these. Their colours are mapped in case they arrive
- Waiver-claim notification → Transactions — the design only shows a toast — a lost or failed claim has no row of its own in Transactions. A lost claim shows the winner's add league-wide; a failed claim shows nothing specific
- Trade detail's "Message @marcus" — the design leaves via DMs — there is no DM backend (handled by the Trades area)
- Messages header badge — the design shows the DM unread count — there is no DM backend; the badge appears only with featureFlags.messages (mock), via the shared HeaderActions
- Join or create a league — the design only shows a toast — I built a MobileSheet chooser that opens the existing JoinLeagueDialog / LeagueCreateModal. Those dialogs, and MockLaunchDialog from the Practice card, still use the desktop style
- Deliberate departures: tapping a notification marks it read (the app's desktop rule; the prototype never does this). I built the pressed backgrounds the design declares but never renders. "Mark all read" and "See all" are padded to a 30–31px tap area without moving them

### Requests
- room-entry.test.ts (draft owner): its pinned list of links into the draft room now fails. It needs ['src/components/mobile/home/home-matchups.tsx', 1] (the Draft live card; a Link with the useRoomEntryTarget split), ['src/components/mobile/home/home-practice.tsx', 1] (router.push after the MockLaunchDialog POST, in place like home-quick-actions) and the League area's ['src/components/mobile/league/league/preseason.tsx', 3]
- LogoLockup / LogoTile (frame owner): the mark renders at 62% of 28px, about 17px; the spec is 15px on a 28px tile
- MSegmented (frame owner): the default item radius is `rounded-lg`, which this config sets to 10px (spec 8px), and it has `transition-colors` (spec: no transitions). I overrode both via itemClassName; the defaults may be worth fixing
- A shadow token for the 1.5px inset b3 outline (`inset 0 0 0 1.5px #E5E5EA`, Join button). I used `border-[1.5px] border-m-b3s`, which looks the same
- `initials()` in use-league-card gives "JT" for "Joy to Us" (the prototype shows "JU"). It's a shared helper; I left it as is so Home matches the switcher
- Avatar text colour on the gold league avatar: the Home spec says always white, but the switcher uses ink (leagueAvClass). Home follows its spec; one of the two specs should be picked (Q12)
- position-badge.test ALLOWED list needs the mobile shared files (use-league-card.ts, m-pos-chip.tsx and other areas' files). It currently fails on bg-pos-* in files I don't own

## profile  (review findings: 8)

### Built
All 8 review findings held, and all 8 are fixed. None rejected. Checks: whole-repo `tsc --noEmit` passes with 0 errors, eslint is clean on my files, and `vitest src/components/mobile/profile` passes 16/16.

1. Titles (medium): the third stat card is now "Titles" while the leagues flag is on. It counts the leagues whose `champion_team_id` equals the user's `my_team_id` (new hook use-mobile-profile-titles, pure `countTitles`), and shows "–" while loading or if the read fails. With leagues off there is nothing to count, so the card shows Following to keep three cards. This is now recorded as a gap.
2. My start/sit (medium): now reads the user's real `start_sit_questions` (new hook use-mobile-profile-start-sit: voided questions excluded, same rule as Home; errors if the 1000-row cap would truncate). Built:
   - Questions and Votes received (sum of a+b), plus live chip counts.
   - Sort per spec §5: open questions newest first, then closed by season/week descending.
   - Outlined cards: green "Start 1 of 2" pill; Open pill with dot and the real close time ("closes Sun 1:00 PM"), or a grey Closed pill; posted time; title (context_note, or "I. Pacheco or T. Allgeier?" when there is none); two 28px headshot rows with % bars and the top option highlighted; footer "N votes · crowd leans X".
   - The Profile Start/Sit preview shows up to 4 rows ("Start 1 of 2 · Open · 58 votes", green while open), each opening My start/sit.
3. Rankings rows (medium): every row now opens My rankings at `/app/weekly-ranks?view=mine`, the design's #mine. "New ranking" opens `?new=1` (#new-ranking). A test checks both against the Rankings area's `parseRankingsParams`.
4. Settings (medium): I added a 34px b2 gear button to `/app/settings` next to the theme pill. `/app/settings/profile` already redirects there. The @handle link still covers "View public profile".
5. Identity (low): the tier is removed. The second line is now "N leagues" while leagues are on, and is absent otherwise.
6. Weekly boards (low): weekly boards (`big_board_weekly` ids) are now left out of the Lists preview. It reads `useLists(1,100)`, the same query Home uses.
7. List kinds (low): now Ranked | Video | Tiers. "Video" comes from `list_links` kind='video'. An unranked list with no video gets no kind word, and "Unranked" is gone.
8. Date test (low): relativeAgo now dates against the passed-in `now` through a new `shortDate`, so the 2027 failure is gone (there is a test for it).

Copy choices I made on OQs: "1 vote" in the singular (OQ9); "crowd leans" hidden at 0 votes and on a tie (OQ8); the preview always shows all questions, unfiltered (OQ5).

### How to reach
Use the mobile layout (a touch device, or pick the mobile layout on desktop).
- Profile: tap the Profile tab, or go to /app/profile. Lists is the first segment; /app/profile?tab=rankings, ?tab=lists or ?tab=ss picks one (Rankings needs NEXT_PUBLIC_FLAG_WEEKLY_RANKS, Start/Sit needs NEXT_PUBLIC_FLAG_START_OR_SIT).
- Titles card and 'N leagues' line: need NEXT_PUBLIC_FLAG_LEAGUES.
- Settings: tap the gear left of the Dark/Light pill → /app/settings.
- @handle: opens your public profile.
- Rankings rows: tap any row → /app/weekly-ranks?view=mine. 'New ranking' → /app/weekly-ranks?new=1.
- Lists rows: tap a row → /app/lists/<id>. Weekly boards are excluded, and an unranked list with a video reads '· Video ·'.
- My start/sit: tap any Profile › Start/Sit row, or go to /app/start-or-sit (startOrSit flag on). Use the All / Open / Closed chips to filter. Back goes Home.
- Cards appear only for a user who has rows in start_sit_questions; otherwise you see 'No questions here yet'.

### Gaps
- Ranking accuracy stat — design shows '#312 Ranking accuracy' — the app has no grading job, so cred_rank and accuracy_score are never written. Shows the real Cred score instead.
- Titles stat while leagues are off — design always shows 'Titles' — leagues are a flag-gated test cohort, so there is nothing to count at launch. That slot shows Following until the leagues flag is on; then it is the real Titles count.
- Display name — design shows 'Dalton' above '@dalton · 4 leagues' — the app has no name column (the handle is the only name, ruling 2026-08-05). The @handle is the 18/700 name line; the t3 line is 'N leagues' while leagues are on, and is absent at launch.
- Rankings row status — design shows Submitted (green), Saved (blue) and Finalized · top 18% (t4), with '· PPR' — the app has no submit, grading, percentile or per-board scoring. Every row reads 'Saved · updated …' and the title is '<period> · All positions'.
- List kind for an unranked list without a video — design's set is only Ranked | Video | Tiers — there is no word for it, so the sub is '<n> players · Updated …'.
- Start/Sit question model — design shows Sit mode, 'Start N of M' with 3–6 options, trade questions (give/get, Accept/Decline), 'roster attached', actual-points lines ('18.4 pts · you started him') and the verdict box — the app's start_sit_questions holds 2 players, start only, with no roster column, no stored decision and no resolution job. Cards are 'Start 1 of 2' with no points, no verdict and no roster note.
- 'Your calls right' stat — design shows '2/2' — it needs the poster's actual start decision and the actual points, which the app doesn't store. Shows '–' (the design's own no-data value).
- Start/Sit title — design shows the poster's headline ('FLEX spot: who starts?') — the app has only an optional context_note. When there is no note the title is the matchup, e.g. 'I. Pacheco or T. Allgeier?'.
- 'Ask a question' (the Profile Start/Sit create button and the My start/sit '+') — design opens the poll composer — the app has no start/sit composer or create API. Omitted.
- My start/sit entry — design enters only from Profile's Start/Sit rows — a user with no questions has no rows, so the screen is reachable only by URL. /app/start-or-sit also requires the startOrSit flag.
- Segments follow their launch flags — Rankings (weeklyRanks) and Start/Sit (startOrSit) disappear when their flag is off, as CLAUDE.md requires for gated surfaces; the design always shows all three.
- Account settings door — not in the design (the Profile header has only the theme pill) — on mobile the only other route to /app/settings is the league Menu sheet, which needs the leagues flag. Added a 34px gear button beside the theme pill; needs Chris's OK as a design addition.

### Requests
- Create-button outline: the spec wants an inset 1.5px b3 (#E5E5EA) shadow. No token exists, so I used border-[1.5px] border-m-b3s, which looks the same. A shadow token 'm-outline-15' (inset 0 0 0 1.5px rgb(var(--m-b3s))) would match the spec exactly.
- Page-header guard: src/components/layout/page-header-rule.test.ts bans <h1>/<header> under src/components, so the mobile screen titles are h2s. If mobile screens should own an h1, the guard needs a mobile exception (not my file).
- Cross-area dependency (Rankings): Profile's Rankings rows link to /app/weekly-ranks?view=mine and 'New ranking' links to /app/weekly-ranks?new=1, following rankings-ops parseRankingsParams. The Rankings area needs to mount its mobile hub on /app/weekly-ranks with ByLayout. Until then these links open the desktop weekly-ranks page. profile-ops.test.ts checks the URL contract, so a rename on their side will fail it.

## community  (review findings: 14)

### Built
I fixed 13 of the 14 review findings. I rejected one: the league sub-pages, because they sit outside the files I own. Details follow.

FIXED
- [high] Create › Ranking now opens the new-ranking wizard at /app/weekly-ranks?new=1, on the current week. A test feeds that URL through the Rankings area's parseRankingsParams and checks that it opens the wizard at step 1.
- Create › List, and the empty state's 'Create a list', now open the mobile New list screen at /app/lists/new. The old desktop ListFormDialog is no longer used on mobile.
- Handles are now written at each place they render, so the username census sees every one: the 3 card bylines, the AI persona handle on the detail, and the search text. The census now flags exactly these 5 lines. They need the ALLOWED entries listed under requests (that test file isn't mine to edit). An AI persona's handle links to /personas/... when the personas flag is on.
- Player-match errors are no longer silent. If a player-topic or player-name search fails, the screen shows an error with 'Try again' instead of a partial or empty result. A player topic shows a loading skeleton until the server answers, rather than first guessing from the cover players.
- The 'Start or sit · Week N' shelf header now always renders, with 'See all' (goes to the Start or sit tab) and an empty card 'No start or sit questions yet'. N is the real NFL week. It is read in a server component that loads separately, so it never holds up the desktop page; the desktop markup is unchanged.
- Removed the shelf caps. The rankings shelf, the lists masonry and 'Updated by people you follow' show everything, as the spec does.
- The ranking-row tile now uses the author's colour.
- Rankings filter chips are now fixed as the spec draws them: 'Any scoring · PPR · Standard', and 'All types · Weekly · Pre-draft' (no Rest of season). Half PPR rankings appear only under 'Any scoring'.
- Detail accessibility: the detail is now a Radix modal dialog. It is named by the list title, Escape goes back, focus stays inside it (so the dock and the feed underneath can't be reached by keyboard or screen reader), and focus returns to the card that opened it.
- Cards now open the detail instantly with history.pushState, the same way the Rankings area does, so there is no server fetch. Back pops that history entry. Ctrl/Cmd-click and middle-click still open a new tab.
- The 100-list pool cap is now visible. The feed hook reports when the pool came back full. Filtered views then say 'Showing the 100 most recently updated lists and rankings'. The Following tab only says 'Follow people…' when you follow nobody.
- Removed my duplicate YouTube and cover-colour helpers; I now use the Lists area's versions. One visible effect: covers of all-players lists are now blue instead of ink, the same as on the Lists screens.

REJECTED
- League sub-pages (My team, League settings / Scoring / Playoffs, Draft results, League history, Previous seasons): the shell's league Menu sheet opens these, and they would live under the league routes. Neither is in this area's files. I've listed them under gaps and requests.

CHECKS
- tsc: clean for all community files. The 7 errors in the project are all in src/components/mobile/league/match/*, which another agent is still editing.
- eslint: clean.
- vitest src/components/mobile/community: 2 files, 23 tests passing. I updated the existing tests where they pinned behaviour I deliberately changed (chip rows, caps, removed helpers, empty-state copy), and added tests for the Create routes, the author-colour tile, uncapped updates and the Following empty copy.

### How to reach
Use the mobile layout (a touch device, or a desktop with the mobile layout picked) with NEXT_PUBLIC_FLAG_COMMUNITY on.
- Community: tap the Community tab in the dock, or go to /app/explore. 'For you' shows 'Start or sit · Week N' (with its empty card), then 'Rankings this week', then 'Lists for you'. 'See all' switches tab.
- Search: tap the magnifier and type. 'Cancel' closes it. Matches on player names join a moment later; if that lookup fails, an error with 'Try again' replaces the results.
- Tabs: Following (try it while following nobody, then while following someone), Start or sit (empty state), Rankings (three fixed chip rows; Pre-draft + K gives 'Nothing matches these filters' with 'Clear filters'), Lists.
- Topic: tap a pill. A player pill shows a skeleton until the server answers.
- Detail: tap any list card, ranking row or 'Updated by' row. It opens at /app/explore?list=<id> instantly. Close it with the cover's Back button, Escape or the OS back gesture; focus returns to the card. Tapping a player row opens the player profile on top. Save and Share are on the detail.
- Create: tap the blue + to open the sheet. Ranking (shown only when NEXT_PUBLIC_FLAG_WEEKLY_RANKS is on) goes to /app/weekly-ranks?new=1, the new-ranking wizard. List goes to /app/lists/new.
- Pool-cap note: appears in filtered views only once there are 100 or more public lists (today there are 51).

### Gaps
- Start or sit polls — the design shows the 'Start or sit · Week N' carousel, start/sit and trade poll cards, voting, 'Roster attached' and Create › Start or sit — the app has no poll backend (start_sit_questions holds only 2 players and has no API routes). The shelf header and 'See all' now render with an empty card 'No start or sit questions yet'; the tab shows the same message; the Create row is left out.
- Updated-by details — the design shows '4 changes · C. Hubbard ▲4, J. Conner ▼3' and a blue unread dot — the app has no per-player move history (ranking_history is never written) and no per-viewer read state. Rows show 'Updated 40m ago' only. 'Updated' means a followed author's ranking was edited after creation within the last 7 days.
- Ranking moves on the detail page — the design shows +4 / −3 per player — the app has no move history. Left out.
- Rank type 'Rest of season' — the design shows the chip — the app has no field for it, so it is left out of the fixed type row. Weekly is read from the weekly board's permanent slug, because big_board_weekly can only be read by its owner. Pre-draft = is_big_board.
- Scoring — the design's chips are PPR / Standard — lists never carry a scoring_system_id. Only AI-expert boards have a scoring (the persona's default), and Half PPR ones appear only under 'Any scoring'.
- Author colour — the design gives each author a colour — the app has no colour column. Each author gets a stable colour hashed from their id (used for avatars and the ranking tile), and their photo when they have one.
- Cover colour — the design uses the author's or the list's colour — the app has neither. Covers use the position-group fill from Chris's 2026-08-11 ruling, through the Lists area's helper, so all-players lists are blue, the same as on the Lists screens.
- Projection on detail rows — the design shows a weekly projection in t1 — the app has only season-long projected_pts_* (no bulk weekly read). Shown in t1 per the design, which conflicts with D497 (projections are dark blue site-wide). Needs a ruling.
- Topic list — the design shows a curated set, including an 'Injuries' trend pill — the app has no curated topics and no injury topic. Pills are built from the feed's own tags and shared players; there is no trend pill.
- Create › List — the design's composer collects name, players, videos and colour in one flow — the app uses the Lists area's two-step New list screen (/app/lists/new, then the editor), with no colour swatch because there's no colour column.
- Ranking rows and 'Updated by' rows — the design sends them to the Rankings area's view of someone else's ranking (#view-<id>, lr-hub S4) — the mobile Rankings area has no such view for people's rankings (its p:<persona> source covers AI experts' boards only). They open the Community detail's ranking variant (D4) instead, which the spec calls unreachable.
- Feed pool — the prototype filters every post — the app filters the 100 most recently updated public lists on the client. Older lists are left out of search, topics and Following; when the pool is full the screen says so.
- League sub-pages (My team rename, League settings / Scoring / Playoffs rows, Draft results with round chips, League history H2H, Previous seasons) — the design shows them as overlays opened from the league Menu sheet — not built here: they belong to the shell's Menu sheet and the league routes, outside this area. My team rename, the settings rows, draft picks and current-season H2H can be built from existing data; the all-time history, team avatar colour/photo and Previous seasons need backend.
- Video card — the design shows the toast 'Opens in YouTube' — I made it a real link to the video instead.
- Likes, comments, top scouts and trending tags (desktop) — the design shows none of them — left off mobile.

### Requests
- Username census: add these 3 ALLOWED entries to src/components/shared/username-link.render.test.ts. Until they're added, the census fails on the 5 community lines (by design, per the review): (1) { file: 'src/components/mobile/community/community-cards.tsx', contains: '@{item.author.username}', lines: 3, why: 'Community card bylines (ranking row, updated-by row, list card): each card is one link that opens the list detail, so the handle sits inside that link; the detail page’s author is a UsernameLink' }; (2) { file: 'src/components/mobile/community/community-detail.tsx', contains: 'const handle = `@${username}`', why: 'an AI persona’s handle — its page is /personas/… (linked when that flag is on), not a person’s profile' }; (3) { file: 'src/components/mobile/community/community-ops.ts', contains: '`@${item.author.username}`', why: 'the Community search text — matched against the query, never rendered' }. (The same test also flags messages-ops.ts:216, which belongs to another area.)
- Lists area: closeNew() on /app/lists/new returns to Community through history when it was opened from Community's Create sheet. Today it falls back to /app/lists because memory.newFromGrid is false.
- Shell / league owner: build the league Menu sub-pages (My team rename, League settings / Scoring / Playoffs, Draft results, League history) on existing data. The Menu currently sends these rows to desktop routes, or to the 'screen coming next' toast.
- Global search: /app/explore?list=<id> is a mobile-only URL, because the desktop Community page ignores ?list=. On mobile, list results can use it; on desktop they must keep going to /app/lists/<id>.
- iOS zoom on focus: the design's 15px search input makes iOS Safari zoom in when it gets focus. This needs one app-wide decision (for example maximum-scale in the viewport, or 16px inputs), since every mobile area will hit it.
- A shared helper for person and author avatar colours (the handoff palette, hashed by id). Community has its own copy (authorBgClass in community-ops.ts), and the dock, profile and messages will want the same colours.
- The shell's dock should unlight the Community tab while a sheet is open (the navgraph says the Create sheet does this). Minor, since the backdrop covers the dock anyway.

## match  (review findings: 12)

### Built
Fixed 11 of the 12 review findings. One is partly rejected (finding 8).

1. [high] Back now opens on the matchup in the URL. The selected matchup and the week both come from `routeMatchupId(pathname)` first, then the page props. A render test pins it.
2. [medium] Match keeps where you left it. A new per-league in-memory store (`match-store.ts`) remembers the swiped matchup and any week other than the current one. Arriving on the bare `/matchup` from another tab, Home or the switcher restores them: a matchup goes into the URL with `replaceState`, a week with `router.replace`, so a reload or Back shows the same screen. Tapping a bare Match link while Match is on screen (the dock re-tap) clears the memory, so you land on your matchup and the current week. The dock did not need changing. One difference from the prototype: it also resets when Match is tapped from Notifications or Messages opened from Match. Here, arriving from any other screen restores.
3. [medium] The correction note and the override panel are rebuilt in the mobile style (`match-correction-note.tsx`, `match-override.tsx`). They use the same hooks, ops and rules as desktop:
   - the lock gate, and no controls if the lock read fails
   - the confirm step before declaring a winner
   - score-only on a bye
   - no reason field
   - the pending save locks Turn off
   - the server's sentences shown word for word
   Only themed mobile colour tokens are used.
4. [medium] The Total row is back on both boards: each side's own box sum, or the word "pending".
5. [medium] Avatar colours now use fixed fills (`n-2`/`n-3` instead of the themed `m-t2`/`m-t3`). The League and Team areas now call this helper, so all three tabs agree.
6. [low] A playoff card shows "Week N · Playoffs". The total-points leaderboard has its "Total points" label again.
7. [low] My header copy is deleted. Match now uses the League area's `MobileLeagueHeader`, which gives the logo `role="img"` and `aria-label="FieldScout"`. The logo tile's colour and size come from a shared component (`LogoTile`), so I filed that as a request.
8. [low] Pager dots, partly rejected. The tap area is 30px tall and already as wide as one dot plus half the gap on each side (10px). Any wider would cover the next dot. Getting 30px of width means spreading the dots apart, or making a tap step one matchup like an iPhone page control instead of jumping to that dot. That is Chris's call.
9. [low] The active dot is now `m-t1`: the same as before in light mode, white in dark. It can be reverted if Q8 rules otherwise.
10. [low] The duplicate colour map in `match-ops.ts` is gone. Slot chips now use the shared `MPosChip` at 26px with radius 8. Non-position slots other than FLEX get `MPosChip`'s neutral fill.
11. [low] The swipe hook's decisions are now plain functions (`swipeStart`/`swipeMove`/`swipeEnd`) with 6 unit tests. A second finger can no longer take over the first finger's drag or end it. Before, a second finger lifting also cleared the first finger's drag and left it stuck.
12. [low] Records show a placeholder while standings load. If standings or projections fail, the screen says "Couldn’t load the records/projections." with Try again.

Checks: `tsc` is clean for my files. The only errors are in other agents' `tx-feed.tsx` and `league-players-screen.tsx`. `eslint` is clean. `vitest` passes 56/56 across the match folder and the swipe test. I updated my own tests where they pinned things I changed on purpose (`slotChipClass` was removed; the bench chip classes are now checked one by one).

### How to reach
Use the mobile layout: a touch device, or a desktop user who has picked the mobile layout.
- Match tab: open /app/leagues/<leagueId>/matchup, or tap Match in the league dock. Swipe the card left or right, or tap a dot.
- A named matchup: /app/leagues/<leagueId>/matchup/<matchupId>, or League › Matchups › tap a row.
- Back fix: swipe to another matchup, tap the opponent's team name, press Back. The same matchup shows, matching the URL and dots.
- Remembering: swipe to a matchup (or step to another week with ‹ ›), tap Team in the dock, then Match. You land where you were. Tap Match again while on Match: your matchup, current week.
- Total row: the last row of Starters on both sides ("pending" until the sums are in).
- Playoffs label: open a playoff week's matchup.
- Total-points leaderboard: open Match in a total_points league.
- Records/projections errors: shown under the card when those reads fail.
- Override panel: as commissioner, turn on override mode (League settings or the Commissioner console), then open Match.
- Correction note: a live or final week whose teams had stat corrections.
- Dark mode: Profile › Dark (the active dot turns white; avatars keep their fixed fills).

### Gaps
- Win probability — design shows 4px win bars and "66% win" on the card (and a 66% bar in the feed header) — app has no win-probability model (F566); the bars are left out, and the line shows the stored Won/Lost/Tied once the matchup is decided
- Streak — design shows "▲8W / ▼2L" in the card meta — standings have no streak field and the client must not compute one; left out (the League area agent derives a streak on the client with streakOf, so the two tabs disagree — needs a ruling)
- Live-play row on the card — design shows the latest play, situation, a Live dot, +0.9 and a chevron into the feed — app has no play-by-play data; left out
- Live game feed screen (My players, game picker cards, game header with possession/down/network, field strip, play rows, New and TD pills, per-play fantasy points) — design shows a full realtime feed — app has no play-by-play, possession, down-and-distance, TV network or per-play scoring; not built, and nothing links to it
- Box score screen — design shows team stats (yards, first downs, 3rd down, turnovers, possession) and Passing/Rushing/Receiving groups — app has no team-game stats table, and the player groups would need a new per-game read or API; not built
- Per-team avatar colour — design gives each team a stored colour — teams table has no colour column; derived from the TEAMS palette in league order (oldest first) with your team always accent blue, as fixed fills (the prototype's var(--x-t2)/var(--x-t3) avatars replaced with #3A3A3C/#6E6E73 so white initials stay readable in dark)
- Week navigator — prototype only changes the label and clamps 1–17 silently — mobile loads the real week from the schedule and greys the chevron at the ends of the season (the app's existing behaviour)
- "Yet to play" line — prototype shows static text on every matchup — shown only in live weeks, from each starter's stored game status
- Bench on Match — README lists it but the prototype doesn't render it — built from the box read's bench lines, using the Team tab's BN chip (#EDEDF0 with ink text)
- Header Search opens the app's command palette, not the design's full-screen search (scope chips, Recent, Trending); the Messages badge is mock data behind featureFlags.messages (frame-owned)
- Re-tap reset from Notifications/Messages — prototype resets to your matchup when Match is tapped from a screen opened while Match was the active tab — the app has no 'tab stays Match' state across routes; arriving at Match from any other screen restores where it was left

### Requests
- src/components/leagues/league-shell.tsx: the `data-league-header-mobile` block is still `desk:hidden`, so it renders above every mobile league screen (Match, Team, League) — needs `mob:hidden` (not in my ownership)
- One shared mobile league header: Match now reuses the League area's `MobileLeagueHeader`; team/league-header.tsx (`TeamLeagueHeader`) is the remaining copy and its logo has no accessible name
- Shared team-avatar helper: the League (league-tab-ops.ts) and Team (team-ops.ts) areas now delegate to match-ops `teamAvatarClass` (you blue, fixed fills) — consider moving it to src/components/mobile/ui; league-tab-ops.test.ts:192 still expects `bg-m-pos-wr` and now fails (the helper returns the spec's #9D70E9 fill `bg-pos-wr`)
- LogoLockup/LogoTile renders fs-green #00D167 with a ~17px mark; the spec's league-header tile is #07D066 (brand) with a 15px mark — shell primitive, not mine
- Ruling (Chris): pager dots — a 30px-wide tap area per dot is impossible at the design's 10px dot pitch; either spread the dots or make the dots row step ±1 like an iPhone page control (instead of tap-to-jump)
- Ruling (Q8): active pager dot is now m-t1 (identical in light, white in dark) instead of copying the design's near-invisible #4D4D4D-on-#575757 dark-mode dot

## team  (review findings: 12)

### Built
All 12 review findings checked against m-team.md, and all 12 held. Each one is fixed in my owned files. Two could only be fixed part-way: the exact knob shadow has no token, and the Match tab's own header copy is in another area's file.
- Team colours: the avatar colour now follows the Match tab's rule (`teamAvatarClass` in match-ops). Your team is always #0088FF, and the other teams take the palette in league order with yours left out. `TeamAvatar` now takes `teamIds` and `myTeamId`. Every Team-tab, Team-view and trade avatar passes the viewer's team, so the builder's left head is always blue. The selected-chip ring is now the `ring-on-ink-border` token instead of `white/50`.
- Moves tile → `/activity/transactions?mine=1`. See all → `?team=<id>`. Both use the existing `TransactionsScreen` via `transactionsHref`, and the bespoke `MovesOverlay` is deleted. That screen doesn't list pending waiver claims, so a "Pending claims" section with Cancel now sits under the lineup on the Team tab. It shows only when you have a claim, or when the read fails.
- Commissioner tools: new `commish-tools.tsx` has mobile versions of rename, autopilot, FAAB edit and move/drop/add. They use the same hooks and copy as desktop, drawn with m-* tokens: b0 fields and pills on the b1 card, `MSwitch`, tinted notes and a native pill select. No desktop components remain.
- Chip radius: view chip is `rounded-md` (8px); the trade-detail league tag is `rounded` (6px).
- Quick actions: fixed `grid-cols-4` with 80px tiles; the News cell stays empty. The Trade tile is always shown. When trades are closed it is dimmed with `aria-disabled`, and a tap gives a toast with the reason (NOT_IN_SEASON_TRADE_COPY or DEADLINE_PASSED_TITLE). Its opponent now comes from this week's pairing in the schedule, not the week being viewed.
- swap-ops: a tapped IR seat whose occupant is on a Restricted stint no longer offers bench players. New test added.
- Recent moves: new `recentMoveRows` skips transactions that didn't complete before taking 3. If older pages exist, it reads on before showing "No moves this season". New test added.
- Message button (Team view) and "Message @mgr" chip (Trade detail) removed: there is no DM backend.
- `MSwitch` knob now uses `shadow-knob` (alpha .2).
- The Team tab and team screen use the shared `MobileLeagueHeader`; my local copy is deleted.
- Accessibility: filled and kept rows no longer override their visible text with `aria-label`. The lock icon has `role="img"`. The builder's "Pick a team" placeholder is no longer `aria-hidden`. The drop sheet can't be closed (backdrop, Escape or Keep him) while the drop is in flight.
- Checks: `tsc` shows no errors in my files; the remaining errors are in other agents' lists and rankings files. `eslint` is clean. `vitest` for team, trades, messages and match: 126/126 pass. One existing test was updated: the trades test's "no Message" title, because Message is now never shown. New tests cover the colours, the Moves link and See all.

### How to reach
Team tab: `/app/leagues/{leagueId}/team/mine`, or the dock's Team tab.
- Moves tile → `/app/leagues/{leagueId}/activity/transactions?mine=1` (its × returns to the Team tab).
- Trade tile → builder against this week's opponent; dimmed preseason or after the deadline, and a tap explains why.
- Pending claims appear under the bench once you have a pending claim.

Team view: `/app/leagues/{leagueId}/team/{otherTeamId}` (or tap another team on Match or Standings).
- Propose trade → builder.
- See all → `/app/leagues/{leagueId}/activity/transactions?team={otherTeamId}`.

Trades: `/app/leagues/{leagueId}/trades`, or `?trade={tradeId}` for a trade's detail. Check the league tag (6px corners); there is no Message chip.

Commissioner tools: turn on override mode in League settings, then open the Team tab or any Team view → Commissioner section (rename, autopilot for an unmanaged team, FAAB edit in a FAAB league, move/drop/add).

Drop sheet: Team tab → tap a slot chip → Drop.

### Gaps
- Win probability — design shows "72% win" and a bar — the app has no win-probability data, so it's left out.
- Ownership line — design shows "99% rostered · 98% start" — the app has no rostered or start % data, so it's left out.
- News tile — design shows a News quick action — the app has no player or team news feed. Its cell in the 4-column grid stays empty.
- Offer expiry — design shows "· expires in 2 days" and an "Offer expires in" picker — offers only expire at the trade deadline, so both are left out.
- Messaging — design shows a Message button (Team view), a "Message @mgr" chip (Trade detail) and a "Send a direct message" toggle — DMs have no backend and the app can't open a conversation, so all three are left out.
- Draft picks — design shows picks as trade assets — redraft leagues have no future picks. FAAB amounts are shown in that spot instead.
- Bench order — design allows bench-to-bench swaps and a movable Empty row — the bench has no stored order, so these swaps aren't offered.
- Team colours — design gives each team its own colour — teams have no colour field, so colours are worked out on the device by the Match tab's rule (yours blue, the others take the palette in league order).
- Pending waiver claims — design has no claims on the Team screens — the Transactions screen lists only moves that went through, so a 'Pending claims' section with Cancel sits on the Team tab. Desktop's bid editing and claim-order panel aren't on mobile.
- Trades in Messages — design lists trades under Messages › Trades — Messages is mock, so trades live on the league Trades page.
- Team rename — design puts it under League Menu › My team — it isn't on my Team tab. A commissioner in override mode can rename from the Commissioner section.
- Desktop-only lineup tools — Lineup check, matchup strip, Customize columns, drag-and-drop, 'Locks from…' and the save indicator have no mobile version. Mobile uses tap-to-swap, toasts and a lock icon on each row.
- Opponent chip — tapping the chip that's already selected does nothing; the prototype cleared their picks, which would lose the user's selections.
- @handle in Trade detail — design taps the name to open the team view — here the @handle links to the profile ('usernames always link'), and the team-name line opens the team view.

### Requests
- league-shell.tsx: the `data-league-header-mobile` block is only `desk:hidden`, so the old league header and sub-nav still render above every mobile league screen. It needs `mob:hidden` (shell or foundation owner).
- messages-ops.ts L376 and thread-screen.tsx L116: pass the viewer's team as the third argument, e.g. `teamAvClass(other.team_id, order, me)`. Until then team-ops keeps the old rule for them (the league's first team is blue), so Messages' colours can differ from Match and Team.
- League tab colour palette: TEAM_AV in league-tab-ops.ts uses the text tokens `m-pos-*`, `fs-ink-3` and `fs-text-3` instead of the `pos-*` fills, so its purple, red, gold and blue are darker than on Match, Team and the trade screens. Better: move `teamAvatarClass` into one shared file, e.g. src/components/mobile/ui/team-colors.ts.
- Match tab: its local LeagueHeader duplicates the shared MobileLeagueHeader (league/league/league-header.tsx), which Team now uses.
- A switch-knob shadow token, 0 1px 2px rgba(0,0,0,.2). I used `shadow-knob` (0 1px 3px .2).
- notification-href.ts: deep-link `league_trade_*` notifications to `/app/leagues/{id}/trades?trade={trade_id}`. The mobile Trades page already opens that trade.
- Optional: if the Transactions screen's 'My moves' listed pending waiver claims, the Team tab's 'Pending claims' section could move there.

## players  (review findings: 14)

### Built
Review fixes (checks: tsc has no errors in my files; the 5 that remain are in other agents' lists/profile files. eslint is clean. vitest passes 23 tests in src/components/mobile/players, 5 of them new. The render test was updated to seed the reads the screen now waits for.)

FIXED
1. Waivers status: every on-waivers player from the pool document is now fetched by id, the same way rostered players are. Waivers is a complete set and has no "+" on the count; Available includes all waiver players. Only free agents still come from the ADP window.
2. Schedule: the list now waits for the schedule. If the schedule read fails, a notice explains it and offers Try again. A league with no schedule yet says so.
3. Near-duplicate components: the Players tab now uses the mobile profile's PlayerMoveSheet for Add, Claim and Drop, so the move ends with a toast and the sheet closing, the same as the profile. It uses MobileLeagueHeader for the header. My own sheets and LeaguePlayersHeader are deleted. players-actions.tsx now holds only ActionCircle and the new ActionPill.
4. Research add-to-list: it now opens the mobile ListPickerSheet instead of the desktop popover.
5. Favourites star: added to research rows next to the add-to-list button, matching the desktop table. The star is disabled until the favourites set loads, because the server toggles the value. A failed toggle shows a toast, and a failed load shows a notice with a retry. In Sheet view the locked player column on the research tab is 26px wider to fit both controls.
6. Periods: under Week N−1, Proj is that week's projection, which is usually "–" because past projections go stale (the tip says so). Under the prior season, Proj, Avg and Tot are "–" and a notice explains why. In the league's last scheduled week, a notice explains that Week N's points can't be read.
7. Loading cues: lines and usage keep their previous data only when the period hasn't changed, so a period change shows loading. The values read had a keepPreviousData option that does nothing inside useQueries, so I removed it. Loading now also waits for the next-week, previous-week and usage reads. The header shows "· Updating…" while a filter or season change is still loading. A Scoring change on the research tab now shows loading instead of keeping the old scoring's numbers.
8. Trending: built in players-trending.tsx. It has the header, a collapse chevron whose state lasts the session, and Home's "See all" link opens it expanded. Tiles come from Home's risers (the same cache), exclude my own players and stop at 8. Each tile has the headshot, short name, position, team and game, then "+x vs last yr" where the design puts Rost/change, then Proj (this week, league scoring) and an Add / Claim / Trade pill. It has its own loading, error-with-retry and empty states.
9. Column catalogue: the league tab now offers only the spec's columns. Fumbles and the Kicking and Defense groups appear only on the research tab, because the desktop research table has them.
10. Research seasons: no year is ever guessed. The read throws if the response has no seasons or players, and the pill reads "This season" until the data arrives.
11. The add/claim confirm button that wasn't in the pinned footer is gone with my sheet. The shared PlayerMoveSheet has the same problem (see requests).

REJECTED OR PARTLY REJECTED
- Pos rk / Ovr rk on the league tab: not added. The only league-scored rank comes from /api/players/[id]/core-stats?league=, one player per call, and each call re-scores the whole player pool with no cache. Sorting a list would mean hundreds of those calls. I reworded the gap; it was already listed in the earlier report.
- Waiver weekday time zone: kept in the viewer's own time. That is how the app shows times (formatInstantWithDate's `.local`, and the desktop availability cell). I added the league-time tooltip the desktop has.
- Tip shadow: it was already in the earlier requests. I added a code comment at the spot.

### How to reach
Use the mobile layout (a touch device, or a desktop user who picked the mobile layout). League tab: /app/leagues/{leagueId}/players, or tap Players in the league dock. Trending sits above the list under the Available, All, Free agents and Waivers statuses with Teams set to All. Tap the header to collapse it, tap a tile's top area to open the profile, and tap its pill to Add, Claim or Trade. From Home, Trending players → See all opens /app/leagues/{id}/players?status=avail with Trending expanded. Status pill → Waivers lists every waiver player, including ones outside the ADP top 300. The Period pill offers Week N, Week N−1, Season and the prior season (with its notice). The row circle opens the profile's move sheet (Add / Claim / Drop) or the trade builder. Customize on this tab shows the spec's columns only. Account tab: /app/research or /app/players, or tap Players in the account dock. Each row has a star (favourite) and a + that opens the mobile 'Add to list' sheet. The Season pill reads 'This season' until the data loads, then the year. Sheet view shows the wider locked column.

### Gaps
- Trending tiles — design shows Rost %, 7-day change, add counts — app has no ownership/adds data; tiles use the app's only trend signal (Home's season projection vs last season, `useMobileHomeTrending`), shown as '+x vs last yr' in that slot
- Ownership columns Rost%, +/-, Start% and the list's 'Rost x% ±y' line — design shows them in the catalogue and on line 2 — app has no platform ownership or start aggregates; line 2 shows only the ownership label
- Air yds, pass aDOT, CPOE, Rush share, YCO, RYOE, Broken tkl, RZ att, YAC, rec aDOT, YPRR — design catalogue — no tracking or advanced feed (player_stats.advanced is empty) — dropped from Customize
- Pos rk and Ovr rk on the league tab — design shows them (PCOL_DEF 4–5) — league-scored ranks exist only per player (/api/players/[id]/core-stats?league=, which re-scores the whole pool on every call, uncached), so a list can't show or sort them without a bulk league-ranks read; the research tab ranks over the whole pool in preset scoring
- Proj per period — design scales Proj by period — app has one league-scored projection per week: Season shows this week's; Week N−1 shows that week's stored projection, usually '–' because past lines go stale (the tip says so); the prior season shows '–'
- Prior-season period on the league tab — design shows its points — no league-scored read for a past season, so Proj/Avg/Tot are '–' with a notice saying so (box stats are real)
- Week N Tot in the league's last scheduled week — design shows week points — a week's points are season-to-date at N+1 minus at N, and the player-values route reads only weeks on the league's schedule; a notice says Tot can't be shown
- Snap % and Target share per period — design varies some usage by period — app stores season-level usage only (current season, or the prior one for that period)
- Deep free agents — design sorts over every match — free agents are browsed from the 300-player ADP window like desktop (the count shows '+' when the window is full); rostered and waiver players are now complete sets read by id
- Waiver day label — design hard-codes 'Waivers · Wed' — built from each player's real waivers_until weekday in the viewer's time, with league time on hover (no gap, noted)
- OPRK on the account tab — no week context outside a league — not offered there
- Account Players tab — design has only a 'soon' toast — built from the existing research table, with the desktop table's favourites star and add-to-list in the row

### Requests
- shadow-m-tip token (0 12px 32px rgba(0,0,0,.2)) for the column tip card — shadow-m-menu used meanwhile (commented at the spot)
- One shared league header: Players now uses MobileLeagueHeader (src/components/mobile/league/league/league-header.tsx); src/components/mobile/league/team/league-header.tsx (TeamLeagueHeader) is a third copy — fold it in and move the one header to components/mobile/ui (owners: league + team areas)
- PlayerMoveSheet (src/components/mobile/player/player-move-sheet.tsx, pprofile area): put Cancel / Add / Place claim in MobileSheet's pinned `footer` — on a full roster the drop picker lists every droppable player at 48px, pushing the confirm below the fold
- ListPickerSheet: a 'Save to favorites' row would give the mobile profile a favourite toggle too (no other mobile surface has one; the research rows now do)
- src/components/mobile/home/home-trending.tsx comment says League › Players 'has no Trending section' — now stale (See all lands with Trending expanded on the same risers)
- LogoTile draws the mark at 17px at size 28; the mobile spec wants 15px

## league  (review findings: 11)

### Built
Review findings, one by one:
1. [high] Nothing opens the Transactions screen. The finding holds, but the fix lives in Team-area files I don't own, so the screen can still only be reached by typing its URL. To make the switch a clean swap, My moves now does everything the Team area's MovesOverlay does: it lists your pending waiver claims (bid, Cancel) above your moves. The exact wiring is under requests.
2. [medium] Team avatar colours. Fixed. teamAvatarClass now uses the Match tab's palette from match-ops (the spec's TEAMS fills #9D70E9/#F75252/#ECAD48/#5C7CE5, plus m-t2/m-t3). A team now has the same colour on the Match and League tabs. My files contain no bg-pos-* classes.
3. [medium] Desktop components inside mobile screens. Fixed; none are mounted any more:
   - Stat corrections is a new mobile list (week chips, every state kept).
   - The invite panel is replaced by a Managers card: the seats, the claimed count, the share link with Copy, and a door to Members.
   - "Add a draft list" opens a bottom sheet (the one-tap suggestion, the list picker, the two toggles).
   - Practice drafts use a new mobile row.
4. [medium] Team filters miss moves. Fixed in the app, with no backend change. Each team's own adds, drops and claims are still one read per team. Trades and commissioner moves are now read league-wide and kept when the stored move names the team, so trades a team received and commissioner reversals now show. Trades with a team selected now use the full Trades topic. A trade is shown from the selected team's side. The list reads older pages on its own before it says "No … match". This limit was already listed in the earlier gaps.
5. [medium] Standings features. Partly fixed. Added the ✸ marker (it links to the commissioner log for that team), its legend, a note when overrides could not be checked, a Final | Projected switch, the weeks-counted line, and a Hide button on the bracket. Still not on mobile, for Chris to decide: the "Placed by" tiebreak chip, the waiver-order list (the Waiver column already shows each team's waiver priority), the tiebreaker chain, and the Win %, PA, vs-median and second-opponent columns.
6. [low] Usernames as plain text. Fixed. "Trade with …", a trade's roster drops and a commissioner move's from → to now link to profiles. The player line uses a full-width tap target, with the username links sitting above it.
7. [low] Waiver pill colour. Rejected. bg-pos-te-tint would fail position-badge.test.ts, which allows bg-pos-* only inside PositionBadge. The pill keeps bg-m-go, and the token request stays below (it was in the earlier requests too).
8. [low] "Traded" wording. Fixed: trade rows now say Added/Dropped, and a player cut to make room says "Roster drop".
9. [low] Address rewrite problems. Fixed. On mount, the page reads the segment and the bracket from the address, not from the route file that rendered it. While the bracket shows, the address keeps ?tab=playoffs; leaving Standings closes the bracket; replaceState now keeps history.state.
10. [low] Switcher under the subscreens. Fixed. The Commissioner log and Stat corrections now have their own addresses, /activity/commissioner and /activity/corrections, so the switcher is hidden and no tab is lit. Each address checks league membership on the server. On mobile, the desktop ?tab= links forward to these screens.
11. [low] Test count. The reviewer was right: there were 36, not 38. There are now 48 passing in the area's 4 test files, and 131 across src/components/mobile/league.
Checks: tsc reports no errors in my files (the only errors left are in mobile/rankings) and ESLint is clean. position-badge.test.ts fails only on other areas' files.

### How to reach
Mobile layout:
- **League tab:** /app/leagues/<id>. Opens on Matchups, or the segment you used last; tap Standings or Activity to switch.
- **Standings:** /app/leagues/<id>/standings.
  - The Final | Projected switch is above the table.
  - A ✸ shows beside a team whose matchup score or result a commissioner set; it opens /activity/commissioner?team=<teamId>.
  - /standings?tab=playoffs shows the bracket over the table; Hide closes it.
- **Activity:** /app/leagues/<id>/activity.
  - The Filter pill opens the filter sheet.
  - The 'Commissioner log' row at the bottom opens /app/leagues/<id>/activity/commissioner. The ✸ on a feed row opens the log at that entry (?entry=).
- **Stat corrections:** /app/leagues/<id>/activity/corrections (also via Menu › Stat corrections).
- **Transactions** (until the Team area links to it, only by typing the URL):
  - /app/leagues/<id>/activity/transactions
  - My moves, with pending claims and Cancel at the top: ?mine=1
  - One team: ?team=<teamId>
  - The × goes to your Team tab.
- **Before the draft:** a league in setup or scheduled → League tab → Matchups shows:
  - the Managers card (seats, share link and Copy for the commissioner, 'Manage members' → /members)
  - 'Add a draft list', which opens a sheet
  - your practice drafts.

### Gaps
- Win probability: the design shows a win bar and win % on each matchup card; the app has no win-probability source (F566), so only the record shows
- League median: the design shows a live 'League median X · proj Y'; only the finalized league_weeks.median_score exists, with no live or projected median, so the card waits until every score is in and shows no proj
- Rank movement: the design shows +N / -N / – under each rank; the standings RPC has no rank snapshot and no as-of-week, so it is left out
- Streak: the design shows ▲nW / ▼nL; there is no server field, so it is worked out on the client from the stored final head-to-head results in the schedule read (worth adding to the standings RPC)
- Team filters: the design allows any number of teams; the API filters by one starting team only. Trades and commissioner moves are now read league-wide and kept when they name a selected team, so received trades and reversals show. League-vote vetoes are posts with no team id, so they can't be tied to a team and drop out once teams are selected
- Trade rows: the design shows one side only with no counterparty; rows tell the selected team's side (Added/Dropped) and add 'Trade with @mgr · $N FAAB sent/received', plus the other team's roster drops with that manager's name
- Team avatar colours: the design shows per-team colours; teams store no colour, so a fixed palette is used (you = blue, the others in league order), shared with the Match tab
- Waiver pill and median card: the design uses literal #FBF0DC/#C98A1F and cream with no dark variant; the pill uses m-go/m-gold, and the median card uses fixed ink/#6E6E73 text so it stays readable in dark mode
- My moves: pending claims now show with Cancel; desktop's Edit claim is not on mobile
- Filter sheet: usernames in the Teams rows are plain text, because each row is a toggle and can't contain a link
- Filter sheet: the check glyph is drawn only when a row is selected; the prototype always draws it, which shows a white check on unselected rows in dark mode
- Standings desktop-only features, for Chris to rule on: the Placed-by tiebreak chip, the waiver-order list (the Waiver column already shows each team's priority), the tiebreaker chain, the Win %, PA, vs-median and second-opponent columns, and the coin-flip note
- Managers card: invites, adding seats or filling them all, roles, removing a manager and leaving the league stay on the Members page (/members), which is still the desktop MembersPage on mobile

### Requests
- BLOCKING (Team area): nothing opens Transactions yet. In my-team-tab.tsx:110, point the Moves tile at transactionsHref(leagueId, { mine: true }) (from @/components/mobile/league/league/league-tab-ops) and remove the moves state and the MovesOverlay mount at :217. In team-view.tsx:200, make 'See all' a Link to transactionsHref(leagueId, { team: teamId }) and remove allMoves and the mount at :230. Then delete MovesOverlay from moves.tsx: My moves now lists pending claims with Cancel. Optionally, build 'Recent moves' from useMobileLeagueActivity(leagueId, feedStreams({ type: 'All', teams: [teamId] }, false, null)) so trades a team received are included
- CRITICAL (still open): src/components/leagues/league-shell.tsx:77 draws its identity and sub-nav block with desk:hidden, so it appears above every mobile league screen. It should be mob:hidden or 'hidden desk:flex'
- Shared team-avatar helper: League now uses match-ops' teamAvatarClass. The Team area's team-ops teamAvClass still differs (created_at order, no 'you = blue'). Move one helper to src/components/mobile/ui and add it to the ALLOWED list in position-badge.test.ts, with the reason that team avatars are not position tags. match-ops currently fails that guard
- Waiver pill token: add a fixed m-* tint for #FBF0DC, or allow it in the guard; until then the pill uses bg-m-go
- Members page (/members) has no mobile version; the Managers card's 'Manage members' link lands on the desktop page
- Shared mobile league header: merge team/league-header.tsx with mine
- Shell (minor): the Menu's 'Stat corrections' could link straight to /app/leagues/[id]/activity/corrections instead of hopping through /corrections → /activity?tab=corrections

## pprofile  (review findings: 11)

### Built
I checked every review finding against m-pprofile. Fixes:

1. [high] Propose trade now opens the existing mobile TradeBuilderOverlay on top of the profile, from the header pill and from the Leagues-tab Trade button. He is pre-asked from the team that holds him. Closing the builder returns to the profile as it was, with focus back on the button that opened it. Send closes both. The builder reports close and send through one `onClose`, so a sent proposal is spotted from the shared mutation cache. Escape closes the builder, but not while it is sending. To let the builder take taps and focus, the profile's Radix root is now `modal={false}`. It keeps `aria-modal`, Tab looping, and is never dismissed by an outside tap.
2. Key-stat tiles now show "▲/▼ last 3 Δ" in green/red, 10px/600. It compares his last 3 completed games with his season rate, from the weekly box lines. No trend is shown when he has 3 or fewer games, when Δ rounds to 0, or for Snap % and Tgt share (season-only data).
3. The current week is now the week of his live game. Otherwise it is the NFL calendar week (core-stats `week`), then `thisWeek`. The ring and pill no longer jump to next week during a game. The current-week card shows Projected plus "Game · Live/Final" and the box line. The cards wait for the scoring read, so the strip is placed on the right week.
4. History's career table now has the Position rank [Std, PPR] group. This season's ranks come from core-stats under espn_standard and ppr (read only when History is open) and are tinted. Fpts is tinted by the Std rank. Past seasons show dashes.
5. The draft context is kept. The redirect carries the draft seat in the profile store, matched to the player and cleared on close. The header action becomes the draft card's Queue ("Add to queue" / "In your queue"). This works in mock drafts too. It uses the same rules: a fresh read before the replace, and never treats an unread queue as empty.
6. The Game log year is now held by the profile. It resets when a profile opens and stays across tab switches.
8. Tabs follow the WAI-ARIA tabs pattern: ids, aria-controls, aria-labelledby, one tab stop, and Arrow/Home/End keys. The error state shows plain copy ("Player not found", or "Couldn't load this player" with Try again) and never the raw error.
9. Partly done. The ownership probe now reads only rosters and the pool per league (the players page's `poolRows`). It reads nothing for leagues that are not in season or playoffs, or where the viewer has no team. Paging of moves is unchanged: it only runs on its tab and stops at the end of the feed.

Not changed:
- (7) I kept "Not available". It was already listed as a gap and is now an open question for Chris.
- (11) Avatar colours stay matched to the dock switcher. This is a spec conflict and is recorded.
- (10) Past-season Fpts basis is now recorded as a gap and noted in the code.
- (3) I did not build "Points so far". Total minus completed weeks would rely on a total cached for 5 minutes and could show a wrong number.

Checks: tsc is clean for my files, eslint exits 0, and the area's vitest passes 61/61. In the wider `src/components/players` run, `position-badge.test.ts` fails, but only on other agents' mobile files.

### How to reach
Use the mobile layout (a touch device, or pick the mobile layout on desktop). Tapping any player anywhere opens the profile.
- Trade builder: inside a league (/app/leagues/[id], Team, Match or Players tab), open a player on another manager's team. The header shows 'Propose trade'; tap it and the builder opens on top. × or Escape returns to the profile; Send closes both and shows the toast. The same happens from the Leagues tab, 'Trade' on a 'Rostered by @…' row.
- Draft Queue: in a draft room (league or mock), tap any available player. The header shows 'Add to queue', then 'In your queue'.
- Current week: during a game, the live week's card has the blue ring and pill, with 'Game · Live' and the live box line.
- Key-stat trends: open a player with 4 or more completed games; each tile shows '▲/▼ last 3 …'.
- Game log year: Game log, pick 2025, go to Summary, return to Game log; 2025 is still selected.
- History: Career shows the Position rank [Std, PPR] group, with this season tinted.
- Tabs: with a keyboard, focus the tab strip and use Left/Right/Home/End.
- Error state: open a removed player id via `/app?player=<bad-id>` to see 'Player not found'.

### Gaps
- Rostered % and its weekly change — design shows '99% / Rost +0.5' as the 4th strip cell — app has no rostered-% source; strip has 4 cells.
- Recent news card and its Analysis box — design shows one news item with analysis — no player-news feed (F575), and D486 forbids app-written advice; section left out.
- Advanced key stats — design shows aDOT, CPOE, YPRR, Route %, RZ touches etc. — not stored (F578); the app's stored and derived tiles are shown. The '▲/▼ last 3' line is built for every tile with weekly data; Snap % and Tgt share (season-only player_usage) get no trend line.
- Key-stat trend colour — design always shows ▲ green and ▼ red, even for lower-is-better stats (INT, Pts allowed/gm) — built as designed; the spec flags this as an open question.
- Current-week 'Points so far' and live score string — design shows 'Points so far 9.60' and 'Q4 2:00 · 31-7' — core-stats scores completed weeks only, and the schedule read has no score or clock. The current-week card shows Projected plus 'Game · Live/Final' and the live box line. Weeks with no stored projection show '–'.
- Game log Snap % and weekly Rank columns, and kicker 'Long' — not stored or computed per week; columns left out.
- Game log for past seasons — design shows the Opp column tinted for every season — no past schedule is linked to the player, so it is a dash.
- Past-season Fpts basis (F576) — design implies one basis — past seasons are scored with the legacy preset calculator (no D/ST points-allowed tiers, no missed-kick penalties; a league basis falls back to Standard), so they are not on the same basis as the current season's core-stats points. These are the same numbers the desktop game log shows.
- History Position rank for past seasons — design shows Std/PPR ranks for every season — only the current season is ranked (core-stats); past seasons show dashes and their Fpts is untinted. History Team column — design shows a team every season — no per-season team is stored, so it shows only for the current season.
- Team tab 'Team rank' tiles — design shows 7 offense-rank tiles — app stores no team offense stats; left out.
- Profile opened with no league context (no league where it was opened, not inside a league, and 0 or 2+ leagues) — design always shows an action for league 0 — no header action pill; the ownership row reads 'Your leagues' with the summary.
- Ownership summary when available in 0 leagues — design says 'All leagues' (the spec flags it as reading the opposite) — built as 'Not available', awaiting Chris's ruling.
- Closed actions (locked, preseason, deadline passed) — design has no closed state — pill is dimmed and tapping it shows a toast with the server rule's reason.
- Draft-room profile — design has no draft-context header — the draft card's Queue is kept as the header pill ('Add to queue' / 'In your queue'), per the existing desktop behaviour.
- Transactions — design is seeded data — real moves come from each league's activity feed (paged, up to 1,000 items per league, with an 'older moves aren't shown' note) plus the draft pick. A 'Traded' kind was added (not in the design) using the 'other' style.
- League avatar colours — spec §2.7 order is ink, gold, purple, blue — built in the dock switcher's order (ink, purple, blue, gold) so a league is the same colour everywhere; spec conflict, not changed here.
- D/ST headshot shows the team logo (existing app rule) instead of initials.
- Profile is a non-modal Radix dialog (aria-modal set, Tab loops inside, outside taps never dismiss it) so the trade builder overlay can sit on top of it — focus is not hard-trapped.
- Prototype quirks not copied: switching tabs resets body scroll; 28px bottom padding instead of 112px; PIT/NO keep dark text in dark mode. A bye in the current week gets the current-week pill and ring.
- The no-op key-stat tap is not built (spec says do not build it).

### Requests
- Export the bulk-add and create-then-add list calls from `add-to-list-popover.tsx` as a shared op. `list-picker-sheet.tsx` repeats the same two fetch calls.
- Consider making `src/components/mobile/player/player-move-sheet.tsx` (the mobile Add / Claim / Drop confirm sheet) shared, so the Players and Team agents can reuse it.
- A mobile base that sets line-height normal and tabular numbers (the prototype sets both globally). I set them on the profile overlay root only.
- Toast offset: the spec puts the toast 100px from the bottom while the profile is open; the shared Toaster uses 84px (`mob:bottom-[84px]`).
- TradeBuilderOverlay (trades owner): add an explicit `onSent` callback. The profile currently spots a sent proposal by watching the shared mutation cache for a successful `trade_propose`, because close and send share `onClose`.
- MOverlay (`m-overlay.tsx`): its Escape check skips whenever any `[role=dialog][data-state=open]` exists, even one underneath it. The profile works around this by handling Escape for the builder itself. Comparing stack order would be cleaner.
- Ruling for Chris: wording when the player is available in 0 leagues — design 'All leagues' vs built 'Not available'.
- FYI: `src/components/players/position-badge.test.ts` fails on other areas' mobile files (community-ops, match-ops, team-ops, lists-model, messages-*, use-league-card, m-pos-chip). None are in this area.
- Backend, out of scope: rostered % with weekly change, live partial points in core-stats weekly, a live score/clock in the schedule read, weekly snap % and position rank, past-season ranks and engine-scored past-season points, per-season team, team offense ranks, and a player news feed.

## messages  (review findings: 9)

### Built
I checked all 9 review findings against the spec. 8 needed code changes. Finding 7 needed only a comment fix (see below). Full-project tsc: 0 errors. eslint passes on my files. The area's vitest passes (35 tests). I updated both test files to match the deliberate changes below.

1. [high] The Trades tab now shows real league trades. Each league where you manage a team is read live with useTradesLive and useLeague, from a new LeagueTradesSource in messages-trades.tsx. All trades you sent or got are merged, newest first.
   - Cards: manager name, handle and photo; colour from teamAvClass (the same as the Team view and trade screens); "Sent to you / You sent · 8m"; "You get" / "You give", including FAAB.
   - Status pill: "Pending" while the offer is out. Every other state uses the trade screens' own word (Accepted, Completed, Declined, Withdrawn, Under review…).
   - The badge counts offers waiting on your answer.
   - Accept, Decline and Counter follow tradeActions, with Accept checked by acceptGate (the trade preview). Accept and Decline call useTradeAction and toast "Trade accepted with Marcus" / "Trade declined".
   - When accepting needs drops, Accept opens the offer, where the drop picker is. When the league won't take an accept, Accept is hidden and the card shows the reason.
   - Tapping a card opens TradeDetailOverlay (S4) over the list. Counter opens TradeBuilderOverlay seeded from the offer.
   - Loading, per-league error with Retry, "No trade offers" and no-match states are all handled. DM-carried mock offers and their session-only answers are removed.
2. Compose, Info (i) and "+" are removed, along with their invented toasts. They are now listed as gaps.
3. League boards (list rows and the group thread) are gated by featureFlags.leagues only. Direct messages stay behind featureFlags.messages.
4. The All/Trades segments now have the spec's 8px radius.
5. The thread no longer auto-scrolls (useFollowLatest removed). It is top-anchored as the spec says. Whether it should open on the newest message is raised as a ruling.
6. When the member list fails to load, the board row names no sender instead of saying "Former member". This is pinned by a test of the new boardSender helper.
7. Already handled, no code change. The no-unread gap for board rows was in the earlier gaps list; I fixed the code comment and kept the gap.
8. The card's label is now "Open trade offer from/to {name}" and it opens S4.
9. On desktop, /app/messages now only redirects Home. It no longer writes to the persisted rail store. I did not make it a 404: calling notFound() in the desktop branch would also 404 phones, because ByLayout renders the desktop tree during SSR.

### How to reach
Use the mobile layout (a touch device, or pick the mobile layout).
- Messages list: tap the chat icon in the Home or League header, or go to /app/messages.
- All tab: one row per league message board (needs the leagues flag and league membership). Tap a board row to open /app/messages/league-<leagueId>, the group thread with its composer. The thread's Back returns to the list.
- Trades tab: tap the "Trades" segment. The blue badge counts offers waiting on you. Each card is a trade you sent or got in any of your leagues.
  - Tap a card body to open the offer screen (S4) over the list. Close (X) returns to the list.
  - On an incoming pending offer, Decline and Accept act straight from the card. Counter opens "Propose a trade", seeded from the offer.
  - To create one, go to /app/leagues/<id>/trades in a league that is in season and use "Propose a trade" from another manager's account.
- Search filters board names on All, and manager name, @handle, team or player on Trades.
- A DM thread (/app/messages/<anything else>) shows "Conversation not found", because the DM feed is empty.
- On desktop, /app/messages and /app/messages/<id> redirect to /app.

### Gaps
- Direct messages: the design shows 1:1 conversations, the people row, unread dots and the header unread count. The app has no conversation, message or read-marker tables, and its DM feed (`RailDmThread[]`) is always empty, so none of these appear.
- DM sending: the design posts into the conversation. With no DM backend, sends in a DM are kept in memory for the session only, as in the desktop panel.
- Group-row unread state: the design shows a bold name and preview, a blue dot and a count on the header icon. `league_chat` has no per-member read marker, so league boards always look read.
- Online presence: the design shows a green dot and 'Active now · {team}'. The app tracks presence only inside the draft room, so neither is shown.
- 'Seen' receipt: the design shows it under your last message. The app has no read receipts, so it is left out.
- Compose (pencil): the design only toasts 'Not part of this prototype', and the app has no new-conversation flow or DM backend. The button is left out.
- Info (i) in the thread header and '+' in the composer: the design only toasts 'Not part of this prototype', and the app has no info screen or attachments. Both are left out.
- Accept from a card when the roster would overflow: the design accepts at once. The app needs drops picked first (E36), and the card has no drop picker, so Accept opens the offer (S4) and the card says why.
- Trade offer expiry ('expires in 2 days') and draft-pick assets: the app has no per-offer expiry, and redraft has no draft picks. Cards and the offer screen show players and FAAB only.
- Message history depth: a league board loads its latest 30 posts (`LEAGUE_CHAT_WINDOW`), and older posts cannot be loaded.
- League chat sheet (S5): the prototype has no way to open it. Not built; the group thread replaces it.
- Manager avatar colours: the design gives each team its own colour, with you always blue. The app stores no team colour, so colours come from the team's place in the league (`teamAvClass`, the same as the Team view and trade screens), and your own team is not always blue.

### Requests
- Ruling needed (spec open question): should a thread open on the newest message and follow new ones? It is built top-anchored with no auto-scroll, as the spec says. With a 30-post board, the newest posts start below the fold.
- Ruling needed: scope of the Trades tab. It is built as every league where you manage a team, newest first, finished trades included, and the badge counts only offers waiting on your answer. The prototype is single-league and also counts outgoing Pending offers.
- Confirm desktop /app/messages: it now redirects Home and changes nothing else. Before this route existed it was a 404.
- Move `teamAvClass`/`teamOrder` from `league/team/team-ops.ts` into `src/components/mobile/ui`. Messages now imports them so the same manager gets the same colour everywhere; `seatColor`/`MY_COLOR` remain only for the DM placeholders.
- A shell-level fix for iOS zooming in on 15px text fields: either `maximumScale: 1` in the root viewport, or a 16px rule for mobile inputs. The spec's 15px search field and composer will zoom on focus.
- A token for an inset 1px ring in b3s (#E5E5EA). I used `ring-1 ring-inset ring-m-b3s`, which renders correctly.
- Somewhere for the Messages session store to live. Ownership rules kept it in `src/components/mobile/messages/messages-store.ts` instead of `src/stores/`.

## lists  (review findings: 14)

### Built
I fixed 12 of the 14 findings. One I rejected, and one I fixed only in part. tsc shows no errors in my files, and eslint is clean. vitest on src/components/mobile/lists passes 27 of 27, including new tests for the stat catalogue, the Video badge, the time-frame label and the case where Auto tiers finds no breaks. (list-windows-host.test.ts fails, but on app-shell.tsx, which isn't my file.)

FIXED:
- Stats: added a Rankings group with Pos rk (the player's rank at his position by season points, the same rule the editor uses) and a Usage group with Snap % and Tgt share (season values from player_usage, whole percent, "–" for positions that don't have them). Groups now follow the design's order, with the app's Draft and Schedule groups after. The file comment that said these had no data source is corrected.
- Video badge on grid cards: a new hook reads list_links through the Supabase client. While it loads or if it fails, cards just show no badge.
- Failed reads are now loud: in both the List view and the editor, a failed read shows an "Some stats could not be loaded. Try again" strip, and its cells stay blank instead of showing "–".
- The time-frame control shows whenever the list has at least one stat. "Week N" is now the season's last completed week, the same for every list: the latest week with a finished, real (not live, not mock) game in player_stats.
- An empty list's "Add players" button opens the editor with the Add players sheet already up.
- Done: a blur and a tap in the same gesture now send one rename, not two. Done waits for any write still in flight, including writes from the Add players sheet, and shows "Saving…" meanwhile. It says "List saved" only when every write landed; if one failed, the editor stays open.
- Auto tiers: when no gap is big enough for a break, nothing is written, your existing tiers stay, and the toast says "No clear tier breaks in this order."
- Partial save failures: if one write of a change fails after others landed, the ones that landed are now undone on the server, so the claim that a failed change is rolled back holds. If an undo also fails, the error says so.
- Navigation: replaced the module-level memory flags with a `from=grid` / `from=view` value in each screen's URL. On-screen Back is history back only when the expected parent is the entry behind and that entry is in the app; otherwise the screen is replaced by its parent. Back on the grid goes to Profile when Lists was opened from outside the app. /app/lists/new is now wrapped in Suspense.
- Small tap targets: the stat-chip ✕, the tier Merge ✕ and the time-frame segments now have 30px tap areas; their drawn size is unchanged.
- Attach to league now opens a mobile sheet using the same reads, request and toast copy as the desktop modal.
- Edit details now adds the new video before removing the old one, so a failed attach keeps the list's existing video.

REJECTED:
- Finding 1 (blue "Done" pill in the sheet header): the reviewer is right that it is off-spec, but I had already reported it under gaps and requests. The fix belongs in MobileSheet, which isn't my file. A Lists-only sheet would copy MobileSheet, which the brief and CLAUDE.md rule out. Laying a pill over the shared header would cover the Add stats subtitle on 375px-wide phones.

PARTLY FIXED:
- Finding 14: the overlays that bypass MobileScreen are kept. They are the only way to cover the dock, the rankings, trades, community and player screens do the same, and this was already filed under requests. The video ordering part is fixed (see above).

### How to reach
Use the mobile layout (a touch device, or pick the mobile layout on desktop).
- **Grid:** /app/lists, with My lists and Saved (/app/lists?tab=saved). Cards whose list has a video link show the "Video" badge top-left.
- **List view:** tap a card (URL /app/lists?list=<id>&from=grid). The time-frame control (Week N | Last 3 | Season) appears beside "Players · n" whenever the list has a stat. If a stats read fails, a "Some stats could not be loaded. Try again" strip appears above the table.
- **Empty list:** open a list with 0 players and tap "Add players". The editor opens with the Add players sheet already up.
- **Editor:** tap Edit on the cover (&edit=1&from=view).
  - Tap "Add stat" for the Add stats sheet, which now starts with Rankings (Pos rk), Fantasy and Usage (Snap %, Tgt share).
  - Turn Tiers on, then tap Auto tiers on an evenly spread or unsorted list to see the "No clear tier breaks in this order." toast.
  - Done shows "Saving…" while writes are still in flight.
- **List options:** tap the "⋯" on the cover for Edit details and, with the leagues flag on, Attach to league (now a mobile sheet).
- **History check:** tap + in the grid header (/app/lists/new?from=grid), name the list, then Next (editor with Add players up), then Done (List view), then Back. You land on the grid, and OS back from there leaves Lists instead of returning to the list.
- **Leaving Lists:** Back on the grid goes to the previous in-app page, or to /app/profile when Lists was opened from outside the app.

### Gaps
- Colour swatches — design shows 6 cover colours — the lists table has no colour column; a cover takes its colour from the list's position group (default accent blue)
- Video-frame thumbnail — design lets the YouTube frame be the cover — the app can only store an uploaded image (thumbnail_url); option left out
- Switching an uploaded cover back to the collage — design allows it — no route clears thumbnail_url; the Collage tile is disabled in Edit details when a list already has a cover image
- Import a ranking — design shows the sheet (Scout AI / Experts / Mine) — the app has no Scout AI or Experts rankings, and weekly ranks / big board are behind flags; tool and sheet left out
- 'Scout AI #N' in Add players and Scout AI sort — app has neither; players sort by projection and the label is left out
- Stats with no data source — ECR, Scout AI (no expert or AI rankings stored), Users (consensus view behind the off consensus flag), Route %, Rush share (player_usage has only snaps and target share), YAC, aDOT, YPRR, YCO/att, RYOE (player_stats.advanced is empty) — left out of Add stats. Snap % and Tgt share are season-only (no weekly usage) so they ignore the time frame; Pos rk is the season-points rank because there is no ECR
- 'Week N' label — design hard-codes the current week (5) — the app has no client-readable current week (nfl-state.ts is server-only), so Week N is the latest week with a final, non-mock game in player_stats
- Stats and time frame saved with the list — design saves them per list — the D3 ruling keeps them per session (shared display store plus a session store)
- Save model — design uses a draft with Save, and Back discards — the app saves every change at once; pill reads 'Done' (it waits for writes still in flight) and nothing is ever discarded
- Ranked off with Tiers on — design allows it — ranking_mode has 3 values; turning Tiers on turns Ranked on, and turning Ranked off turns Tiers off
- More than 6 tiers — design allows 8 — tiers are stored as S–F; Add tier line stops at 6 and Auto tiers makes at most 5 breaks
- Players added elsewhere with no tier letter show under an 'Ungrouped' tier label (the design has no such state)
- Position group, team list type and the clear-drafted action from desktop aren't editable on mobile (drafted marks aren't shown on mobile)
- Sheet header 'Done'/'Cancel' blue pill — MobileSheet has no header action, so the shared close (X) is used instead
- Name field Enter does nothing (as in the design); the Next button is truly disabled until the list has a name rather than showing a toast

### Requests
- MobileSheet: an optional header action slot for the Lists sheets' 32px blue 'Done'/'Cancel' pill (Lists sheets also want a 17/600 title, 12/500 subtitle, radius 22 and a .4 backdrop) — this closes review finding 1
- mobile-nav.ts: highlight the Profile tab for /app/lists* (the design lights Profile on Lists screens; right now no tab is lit)
- Profile 'New list' button (mobile-profile.tsx) should open /app/lists/new on mobile instead of the desktop ListFormDialog (pass ?from= only if the grid is behind it; without it, back from New list goes to the grid)
- Shadow token for the switch knob: 0 1px 2px rgba(0,0,0,.2) (I used shadow-knob, which is 0 1px 3px)
- A full-screen-without-dock primitive in the shell (with the safe-area top inset), so the Lists editor, New list and Edit details — and the rankings, trades, community and player screens, which do the same — stop using their own fixed z-[45]/z-50 overlays

## rankings  (review findings: 15)

### Built
I fixed all 15 findings. Three were only partly fixable inside my files: #6, #9 and #11 (details below). I rejected none outright.

1. [high] Board created on a phone's first load. New `DesktopBranch` (desktop-branch.tsx) wraps the desktop tree on all three routes. On a phone it holds that tree in a suspended Suspense boundary during hydration, so its queries never fire and no week board or season seed gets created. Desktop and server rendering are unchanged. ByLayout itself needs the same fix (see requests).
2. Source tabs are now Experts · Scout AI · Users · [author] · Mine, with Experts as the default. ADP and Auction are gone.
   - Experts = the consensus of the app's AI expert boards: one board per expert (their board for the position, else their overall board), ranked by mean rank. Each expert's own rank feeds the real Best / Worst / Std dev numbers.
   - Scout AI shows an empty state.
3. "You already have…" is now checked per board and position.
4. Browser/OS Back or a swipe from an editor with unsaved edits re-opens the editor in the same render (the draft is kept) and asks "Discard changes?". Reload and tab close also warn. An editor opened straight from a link gets a My rankings entry under it, so Back stays guarded.
5. Tier tools removed (Auto tiers, Add tier line, tier lines, Merge, the Tier 1 header). The app can't store tiers, so the editor no longer shows edits that Save would drop.
6. Built:
   - comparison columns with the ±3 red/green rule, and the comparison names on the right of the info line;
   - the tap-to-expand breakdown, "Your rank" (from your season ranking) and the agreement note.
   Scout AI's column and cell are left out because it has no data. A row tap now expands the breakdown; the headshot opens the player.
7. Step 2 offers: Your latest ranking (desktop's default carry-over) / Expert consensus / Users average / Start blank. Each starts from the top 20, with bye-week players removed for weekly rankings.
8. A new ranking is an unsaved draft: Save is blue and the footer says "Unsaved changes". Nothing is fetched or created until Save, which creates the week's board at that point.
9. Add players now has the All + position chips and a fixed-colour placeholder. The "Done" pill still needs a MobileSheet slot (request).
10. Author card:
    - replaces the filter bar;
    - title and meta read "Type · Pos · Scoring";
    - avatar colour is picked per expert;
    - a confirm sheet appears before a copy would replace your existing ranking.
11. Lighting the Profile tab is in a shell file I don't own (request).
12. Saves now write only the edited position's rows, into that position's own slots, so other positions' cards keep their dates. The empty copy for the Saved filter is fixed.
13. Step counter reads "1 of 2" / "2 of 2". The title stays a static heading (gap).
14. /app/big-board is synchronous again. On a phone it redirects to /app/weekly-ranks. An invalid week on mobile shows "That week doesn't exist".
15. The author view loads any AI expert board by id. Escape closes the menu.

Checks: tsc 0 errors, eslint clean on my files, vitest 23/23 (tests updated for the removed helpers and the new save / consensus / URL logic). I couldn't check anything in a browser: no dev server was running and the brief forbids starting one.

### How to reach
Use a touch device, or desktop forced into the mobile layout, with the weeklyRanks and bigBoard flags on (they're on in dev):

- **Hub, Experts (S1):** /app/weekly-ranks. Tap a row to expand Compare sources; tap the headshot to open the player.
- **Other hub tabs:** /app/weekly-ranks?src=ai (Scout AI, empty state) and ?src=users (Users).
- **Menus:** tap the type or scoring pill. Escape or an outside tap closes it.
- **Author view (S4):** /app/weekly-ranks?src=p:<AI expert board list id>, then tap 'Start my ranking from this'. If you already have that ranking, a confirm sheet appears first.
- **My rankings:** /app/weekly-ranks?view=mine (Profile › Rankings rows), or the Mine tab.
- **New ranking:** /app/weekly-ranks?new=1, or + in the header.
  - Pick a position you haven't ranked to reach step 2 (Continue).
  - In season, an unstarted current week opens step 2 straight away. That week's 'This week · not started' card now shows after a full page reload.
- **Editor:**
  - Tap any ranking card, or open /app/weekly-ranks?edit=season&ep=RB or ?edit=w<current>&ep=RB.
  - A week with no board opens as an unsaved draft.
  - Drag a row, then press browser Back to see the Discard prompt.
- **Week route:** /app/big-board/week/<n> opens that week's editor; /app/big-board/week/abc shows 'That week doesn't exist'.
- **Big board:** /app/big-board redirects to /app/weekly-ranks on mobile.

### Gaps
- Experts source — design shows 'Consensus of 5 experts' — the app has no expert feed; it's built from the app's AI expert boards and labelled 'Consensus of N AI experts'. It ignores scoring (each AI expert ranks in their own default), and TE/K/D/ST have few or no AI expert ranks
- Scout AI — design shows a ranking per type/scoring/position — the app has none. The tab shows 'No Scout AI ranking yet'. Its comparison column, breakdown cell, step-2 card and 'Recommended' badge are left out. The pick sheet shows 'Proj #N' instead of 'Scout AI #N'
- Users source — design shows 'Average of 2,418 user rankings · updated …' — consensus_rankings has no total count and no refresh time, so the line reads 'Average of user rankings'
- Movement arrows ▲/▼ — app keeps no rank history for sources
- Week types in the hub's type menu — every source is season-long, so the menu offers only the season type
- Separate Rest of season and Pre-draft — app has one season board, labelled by time of year
- Weeks 5–8 open — app edits the current week only
- Scoring per ranking (PPR / Standard) — app boards have no scoring, so step 1 has no Scoring block, titles read 'Week 6 · RB', and scoring only changes the stats. Half PPR not offered
- Submit, Submitted / Unsubmitted / Draft, the Submit sheet, the Submitted screen, the '#2,419' submission number, 'Show on my profile' and accuracy grading — app has no submission record or grading
- Tier lines — app boards can't store them, so the editor has no Auto tiers, Add tier line, tier lines, Merge or Tier 1 header. Step 2 drops 'Starting from a ranking gives you auto tiers you can adjust'. The hub still shows tiers computed from each source
- Editable title, custom titles and card meta 'N tiers · started from X' — not stored; the editor title is a static heading
- Follow pill, accuracy line and follows count on the author card — AI experts have none, so the card shows 'AI expert · N players'
- Community user-ranking view (#view-id) — users have no published rankings; only AI expert boards open as the author view (?src=p:<listId>), and nothing in the app links there yet
- FLEX chip (desktop has it) — the design has no FLEX
- Production gate — routes stay behind the weeklyRanks and bigBoard flags (on in dev, off in prod)

### Requests
- ByLayout (frame owner): don't mount the desktop tree when data-layout=mobile during hydration. Today its queries fire before the swap; I hold it with DesktopBranch (suspend-on-mobile Suspense) on the Rankings routes only. Other routes' desktop trees still run their effects on a phone's first load
- mobile-nav.ts: map /app/weekly-ranks* and /app/big-board* to accountTab 'profile'. The design lights Profile there; today no tab is lit, and the league bar can stay up after coming from a league
- MobileSheet: an optional header action pill (the design's 'Done' / 'Submit'); I used showClose instead
- Community / Home cards for an AI expert board could link to /app/weekly-ranks?src=p:<listId>, the hub's author view (design S4)
- Optional tier colour tokens. I mapped them to m-pos-rb / m-pos-wr / positive-strong / m-gold / m-pos-qb / m-pos-k. Author avatar colours use accent / pos-qb / pos-te / pos-rb / positive-strong
