# FieldScout Mobile: gap list

*15 Oct 2026. Covers the "FieldScout Mobile" Claude Design handoff, built on real data on the mobile/v1 branch, which is not live yet. Sizes: S is under a day, M is a few days, L is a week or more.*

## Summary

1. **Built:** all eight areas of the handoff are built on real data, with phone-only dark mode. That closes 232 designed items (section 6).
2. **Still open:** 225 findings from the areas plus 5 from my own check. After removing duplicates: **48 decisions**, **45 that need new data or server work**, **31 we can build now**, **18 restyles** and **11 prototype bugs we didn't copy**.
3. **Biggest gaps that need new data:** live scoring and win probability, player news and rostered/started %, direct messages, start-or-sit polls, and the full rankings loop (Scout AI, experts, submitting, grading).
4. **Biggest gaps we can close now:** league and account pages with no phone screen still show the desktop layout and stay light in dark mode. After that come full-screen search and the desktop list tools that phones lost (position group, drafted marks).
5. **What's blocking:** decisions 1, 3, 4 and 5 below (2 is done). Every other decision already has a recommendation, and "accept all quick calls" settles 16–48.
6. **Fixed after this list was drafted:** switched-off features are now hidden on phones (decision 2, which the launch scope already rules), and account pages with no phone screen (Settings, Mock drafts, Trash, NFL teams, Leagues…) now get the same back-and-title bar as the league pages (Restyle, step 1).

---

## 1. Decisions for you

> **Rulings, 15 Oct 2026**
> - **1 go live:** agreed, once the toast is built. **3 toast:** built (dark pill, ~2s for a one-line confirmation, 4.5s for errors and longer messages, above the bottom bar). **4 Rankings:** phones and desktop switch on together (same switches). **5 private lists:** cap lifted — migration 187 for the database, which **needs `db push`**; until then the app behaves as before.
> - **6** full profile on phone taps — agreed (desktop keeps mini card first). **7** keep the gear — agreed. **8** person avatars: the profile photo, two letters when there's none. **9** six cover colours, position colour as default — agreed. **10** desktop's tier palette everywhere — agreed. **11** YouTube title lookup — agreed. **12** leave League legend out — agreed (it was never built). **13 Commissioner note** — see Follow-ups below. **14** red dot when something needs you — agreed. **15** remove Scout AI and Top waiver adds from phone **and desktop** Home.
> - **16** Lists: edits are a draft — **Update** saves, Back/Cancel discards (asks "Discard changes?" when there are edits). A player's profile opened from your list has a visible **Remove** (in the editor it's part of the draft; from the list view it removes at once). **17** Rankings: **Publish updates** is the only commit (saving is what counts; no save-without-publish); Back/Cancel discards. **18** agreed. **19** list stats: pick PPR / Half / Quarter / Standard. **20** see Follow-ups below. **21** Rankings: this week + 3 weeks out + rest of season. **22** trades only inside a league (and a DM chat once DMs exist) — the Trades tab left Messages. **23** pager dots: swipe only. **24** agreed. (Gap #17, Tiers forcing Ranked: see Follow-ups below.)
> - **11 corrected:** real YouTube titles **or nothing** — never a placeholder (migration 189).
> - **Follow-ups:** **13 Commissioner note** — built on the **league** home (League tab card + Menu row on phones, top of League Home on desktop), commissioner-edited and logged; members get a notification when it changes (migration 192, **needs `db push`**). **Gap #17** — Tiers no longer force Ranked: a list can be grouped into tiers **without numbers** (migration 191, **needs `db push`**). **20** keep both list pages as built (Community is everyone's lists, your profile has yours) — closed. Desktop rankings also open this week + 3 weeks ahead; desktop Home's sample Injury report now shows the real feed; desktop Edit list's "All players" bug fixed; tier chips use darker shades of the same colours so white text is readable (one place, phone and desktop).
> - **25** slim sticky bar (Back · title · Edit) and pinned column names on long lists — agreed. **26** settled by 27. **27 Back always goes to where you came from — period** (app-wide on phones; a parent screen only when nothing in the app is behind). **28** Rankings: "Mine" is a tab beside Experts / Scout AI / Users, and Profile opens it — agreed. **29** phone Big Board: ADP and Auction tabs plus a FLEX chip (team filter and search later). **30** rankings scoring: PPR, Half, 0.25 and Standard. **31** top 36 per position. **32** a new ranking starts on the position you last used — agreed. **33** movement arrows measure against your **previous update** (the last publish); only current-vs-last is kept. A switch shows them — **on** when you look at someone else's rankings, **off** while you edit your own (migration 190, **needs `db push`**). **34** white tab underline in dark mode — agreed.
> - **35** For you: a **Latest** section, strictly newest first; everything else is popular + recent. **36** a ranking saves the scoring it was made for when published; Community keeps its scoring filter (Any scoring + the four; older rankings only under Any). **37** topic buttons are automatic (what people post about), plus an always-there **Injuries** button. **38** dark letters on gold league tiles everywhere. **39** streak on Match too, counted the same way on Match, the team page and Standings. **40** Standings: points against; median and second-opponent records only where the league uses them; a one-line tiebreak note; no Win % or waiver order. **41** settled by 27. **42** inside pick-lists, tapping a name ticks it (an exception to "usernames link to the profile"). **43** trend arrows coloured by better/worse. **44** "Rostered in all your leagues" / "Pre-draft". **45** depth-chart names open that player; Back returns. **46** profile Transactions: one timeline, newest first, each row names its league. **47** conversations open at the newest message and follow new ones. **48** no longer applies — that card was in the Messages Trades tab, which 22 removed.
> - **Defaults, 16 Oct 2026:** **list numbers** — one rule on phone and desktop (Chris: "make sure they work consistently, your call"): numbers only on a Ranked list, tier headings only with Tiers on, a plain list shows neither — list screens, the share page, Community, and the draft room's cheat sheet; desktop owners switch it under List options › Numbers. **Clearing the Commissioner note** sends no notification (an unread one about the old note is withdrawn). **Streaks** count every result — every head-to-head game, playoffs included, plus the win/loss against the median when the league uses it. **No scoring chosen = Half PPR** for a ranking (an AI expert keeps its usual scoring). **Latest** is a horizontal shelf with See all → a plain newest-first page. **#45** × becomes Back after drilling into a teammate — agreed.
> - **Pro on hold, 16 Oct 2026:** no list caps for free accounts — the one-team cap is lifted as well as the private-list cap (migration 187, **needs `db push`**); custom scoring is open to every account (PR #441).

### A. Launch blockers (please answer these first)

1. **When should mobile go live?** At the moment everything sits on mobile/v1. Merging it into main puts it on fieldscout.gg straight away.
   → **Recommend:** merge once decision 3 is built. Decision 2 and the title-and-close bars are already done. Everything in the launch scope (Lists, player research, the player profile) is built, and the rest stays behind its switch.
2. ~~**Should switched-off features be hidden at launch?**~~ **Done** — the launch scope already rules this, so it's built: with Community off the bar is Home · Players · Profile, the chat icon shows only while Leagues or Messages is on, Start-or-sit and Rankings pieces follow their switches, and the My stuff tiles share the row. What was there before:
   - **Design:** Community is a main tab and a Menu tile, a chat icon sits in the Home header, For you opens with a Start-or-sit shelf, and My stuff shows 3 tiles.
   - **Built:** the Community tab and tile bounce you back to Home, the chat icon opens an empty Messages screen, the Start-or-sit shelf and tab always say "No questions yet", and the Lists tile sits alone in a third of its row.
   → **Recommend:** hide each one until its switch is on, so the bar is Home · Players · Profile. Show the chat icon only when Leagues or Messages is on, and let the remaining My stuff tiles share the row. (S)
3. **Which style should pop-up messages (toasts) use?**
   - **Design:** the two prototype files disagree. The main one uses a dark 13px pill that shows for about 2 s with no slide. The Lists & Rankings file uses a full-width card.
   - **Built:** the desktop toast, an 11px pill that slides in and stays 4.5 s. On league tabs it covers the league switcher.
   → **Recommend:** use the main prototype's dark pill everywhere, for about 2 s with no slide, and lift it above whichever bottom bar is showing. (S)
4. **When should Rankings be switched on for phones?** The design treats Rankings as a full section. We built it for phones, and it sits behind the Rankings and Big Board switches (on in testing, off on the live site).
   → **Recommend:** switch phones and desktop on together, because both edit the same rankings and the same draft-room board.
5. **Should the one-private-list limit be lifted?** In the design the Public switch flips freely. The app currently refuses a second private list with "Upgrade to Pro".
   → **Recommend:** lift it. It's one of the suspended Pro rules. (S)

### B. Where the phone differs from an existing ruling or needs your input

| # | Question | Design vs built | Recommend |
|---|---|---|---|
| 6 | Should a player tap open the full profile on phones? | The design opens the full profile straight away, in six tabs. We built it that way, which breaks your 2026-10-05 "mini card first" rule and desktop's calm view. | Keep it on phones and leave the desktop rule as it is. ESPN, Yahoo and Sleeper all open a full card. |
| 7 | Should the settings gear on Profile stay? | The design has only the Dark/Light pill, so there's no way to account settings outside a league. We added a gear beside the pill. | Keep it. ESPN, Yahoo and Sleeper all put settings on the profile tab. |
| 8 | Should avatars show one letter or two? | The design shows one letter. The app rule is two letters for a handle. | Keep the app rule. |
| 9 | How should list cover colours work? | The design lets you pick from 6 colours. We follow your 2026-08-11 rule (colour by position group), but phones can't set a position group, so every list made on a phone is blue. | Add the design's 6 colours with the position colour as the default, so existing lists don't change (one new list setting). Either way, phones get the position-group choice (Build now #3). |
| 10 | Tier 1 is blue on a phone and pink on desktop. Which palette wins? | The phone uses blue/purple/green/gold/red/teal. Desktop uses pink/red/orange/gold/green/teal. | Use one palette everywhere: desktop's, since it's already live. |
| 11 | Can we look up the titles of attached videos? | The design shows each video's title. Every video attached on a phone is called "YouTube video". | Look the title up through YouTube's official title service (not scraping). If that breaks the RSS/YouTube-only rule, add a title field like desktop has. |
| 12 | What should League legend explain? | The design has a tile that only shows a toast and has no content. | Leave it out until you say what it should explain. |
| 13 | How should the Commissioner note work? | The design has a Menu row. We show "screen coming next". | One note from the commissioner, shown on the League tab and in the Menu, like ESPN's LM Note. It goes in the league description, which nothing uses yet. (M) |
| 14 | When should the red dot show on a Home league card? | The design shows a red dot with no rule for it. We show nothing. | Show it when something needs you: a trade offer waiting for your answer, or a starter who is out, on IR, on bye or an empty slot. Leave chat out, because the app doesn't track what you've read. (M) |
| 15 | Should the Scout AI card and Top waiver adds go on phone Home? | The design has neither. On desktop both show sample data. | Keep them off until they run on real data. |

### C. Quick calls with a recommendation ready (say "accept all", or name the ones to change)

**Keep as built**

| # | Question | Recommend |
|---|---|---|
| 16 | Lists save as you go ("Done"), while Rankings use Save with "Discard changes?". The design saves both with a button and quietly throws edits away on Back. | Keep as built. |
| 17 | Turning Tiers on also turns Ranked on. The design keeps them separate. | Keep them linked, since tiers need an order. |
| 18 | List stat columns and time frame last only for your session (your D3 ruling). | Keep. |
| 19 | List stats are always PPR. | Keep, and add a switch if testers ask. |
| 20 | A list opens on two different pages: the Community page and the Lists view. | Keep both while Community is off, then pick one when it ships. |
| 21 | Rankings only allow this week. The design lets you rank 3 weeks ahead. | Keep this week only for 2026 (it matches desktop). |
| 22 | The Messages › Trades tab covers all your leagues, and its badge counts only offers waiting on you. | Keep. |
| 23 | The matchup pager dots are hard to tap side to side. | Keep. Swiping is the main way to move. |
| 24 | Bench order and bench-to-bench swaps aren't offered. | Leave them out. ESPN and Yahoo sort the bench for you. |

**Change from the design**

| # | Question | Recommend |
|---|---|---|
| 25 | On a long list, Back, Edit and the column names scroll away. | Show a slim bar with Back, the title and Edit once the cover scrolls off, and keep the column names pinned. |
| 26 | Back on My start/sit goes to Home. | Go back to Profile and light the Profile tab. |
| 27 | Back on Rankings always goes to Profile. | Go back to the screen you came from, and fall back to Profile. |
| 28 | Experts / Users rankings are only reachable through New ranking. | Open Profile's Rankings rows on the Rankings Mine tab, so those tabs are one tap away. |
| 29 | On phones the Big Board drops ADP, Auction values, Overall/FLEX, the team filter and search. | Add ADP and Auction tabs after Users plus a FLEX chip, with the team filter and search later. (M) |
| 30 | Rankings offer only PPR and Standard. | Add Half PPR. The stats already support it. |
| 31 | Rankings lists stop at 24 players. | Show the whole position, or add "Show more". |
| 32 | A new ranking always starts on RB. | Start on the position you last ranked or viewed. |
| 33 | The +/– movement numbers stay after Save. | Reset them on Save. |
| 34 | In dark mode the Rankings active-tab underline is barely visible. | Make it white in dark mode. |
| 35 | Community's "For you" just shows the newest lists. | Sort by most liked, then newest, like desktop's Trending. |
| 36 | Community's PPR/Standard chips hide every member's ranking. | Hide the chips for now. Later, the new-ranking steps ask which scoring a ranking is for. |
| 37 | The design has fixed topic pills and an "Injuries" pill. | Keep the automatic pills. Add Injuries only to mean "lists with a player on this week's injury report". |
| 38 | Gold league avatars use white letters on Home and dark letters in the switcher. | Use dark letters everywhere. |
| 39 | The Match card has no win/loss streak, and Team view and Standings count streaks differently. | Show the streak on Match too, and count it the same way on all three. |
| 40 | Which standings details belong on phones? | Add points against. Show median and second-opponent records only in leagues that use them. Explain tiebreaks in one line, and leave Win % and waiver order off. (M) |
| 41 | The × on Transactions always goes to your own team. | Go back to the screen you came from. |
| 42 | In the filter lists, manager names aren't profile links. | Allow that inside pickers, where tapping a name ticks it. |
| 43 | Profile trend arrows are green when a stat goes up, even interceptions. | Colour them by better or worse. |
| 44 | The ownership row says "Not available" when he's rostered everywhere or it's preseason. | Say "Rostered in all your leagues", and show "Pre-draft" for leagues that haven't drafted yet. |
| 45 | Names on the depth chart can't be tapped. | Make each name open that player, with Back returning to the first player. (M) |
| 46 | Profile › Transactions is grouped by league. | Show one timeline, newest first, with each row naming its league. |
| 47 | A conversation opens at the oldest message. | Open at the newest message and follow new ones as they arrive. |
| 48 | Accept on a Trades list card completes the trade in one tap. | Ask "are you sure?" before Accept. Decline stays one tap. |

---

## 2. Needs new data or server work (backend)

### Live scoring and odds
| Gap | Screens | Size | Note |
|---|---|---|---|
| Win probability ("66% win" and its bar) | Match card, Team card, Home league cards, League › Matchups | L | Needs a model built from projections and live scores. |
| Live play-by-play: the latest play on the matchup card, a live feed with down & distance and points per play, and "your player scored a TD" alerts | Match, live feed, Notifications | L | Needs a play-by-play provider. |
| A player's live "points so far" | Profile this-week card, Game log | M | Live stats are stored, but they aren't scored until the week is final. |
| Live and projected league median | League › Matchups | M | Today it appears only once every score is final. |
| TV network, NFL team records and team stat totals | Game screen | M | Needs a provider that sends them. Records could come from final scores. |

### Player data
| Gap | Screens | Size | Note |
|---|---|---|---|
| Player and team news, with times, newest first and See all | Home injury news, Team tab News tile, profile Recent news | L | RSS/YouTube only. Recording when an injury status changes would give Home its times sooner (M). |
| Add/drop trends, % rostered (with weekly change), % started | Home Trending (Adds/Drops), League › Players tiles and columns, Team lineup rows, profile stat strip | L | Choose a source first: counts from FieldScout leagues (small in 2026) or an outside trending feed. Today's tabs are Risers/Fallers. |
| Advanced stats: air yards, aDOT, CPOE, YAC, YPRR, route %, RYOE, yards after contact, broken tackles, red-zone attempts | Customize stats, Lists › Add stats, profile key stats | L | Needs an advanced-stats provider. |
| Rush share column | Customize stats | S | Add team carries to the weekly usage update. |
| Weekly snap %, weekly position rank, kicker's longest FG | Profile Game log | M | |
| Past seasons: his team, opponents, and points and ranks on today's scoring | Profile Game log, History › Career | M | Past seasons use an older points calculator today. |
| NFL team offense rank tiles | Profile Team tab | M | |
| Position and overall rank in your league's scoring | League › Players | M | Needs one read that ranks the whole player pool. |
| Past weeks and last season in league scoring | League › Players period filter | M | Needs each week's projection saved. |
| Free agents beyond the top 300 | League › Players | M | The "+" on the count marks the cutoff today. |
| This week's projection for a whole list | Community list page | M | Label it "Season proj" until then (Build now #29). |

### Messages and social
| Gap | Screens | Size | Note |
|---|---|---|---|
| Direct messages: one-to-one chats, unread count, Message button on a team page, "Message @manager" on a trade, "Send a DM" when proposing, Seen | Home and league headers, Messages, Team view, trade detail and builder | L | The design never says what the pencil, info and attachment buttons do. Write those up when DMs get the go-ahead. |
| Unread league board posts (bold, dot, count on the icon) | Messages, chat icon | M | Needs a "last read" mark for each member. |
| Unread dot on followed ranking updates | Community | S | |

### Notifications
| Gap | Screens | Size | Note |
|---|---|---|---|
| "Your starter is out" and "lineup locks in 2 hours" alerts | Notifications | M | Scheduled check before kickoff. |
| "@user updated their ranking" | Notifications | M | Comes with Rankings. |
| Notification settings, per league and for your account | League Menu, Account settings | M | Today's account switches reset on reload because they're never saved. |

### Community: start-or-sit and trade questions
| Gap | Screens | Size | Note |
|---|---|---|---|
| Start-or-sit polls: 2–6 players, "pick N", start or sit, a headline, voting and results, and Ask from Create, Profile and My start/sit | Community, Create, Profile, My start/sit, search | L | Today only two-player questions exist, with no way to post or vote. Voting closes at the earliest kickoff. |
| Settling questions after the games: actual points, "you started him", the verdict, "Your calls right" | My start/sit | L | |
| Trade questions (an Accept/Decline poll) | Community, Create | L | Reuses the poll voting. |
| Attaching your roster to a question | Question cards, Ask screen | M | Saves the roster as it was when posted. |

### Rankings
| Gap | Screens | Size | Note |
|---|---|---|---|
| Scout AI ranking: its tab and column, "Recommended" as a starting point, "Scout AI #N" in Add players, Lists stat and import | Rankings, New ranking, Lists | L | Can be built from the projections we already pull in. |
| Experts for every position: AI expert boards for TE, K and D/ST, with real expert consensus later | Experts tab, Compare sources, Lists | L | Keep the AI experts clearly labelled for 2026. |
| Users average recalculated on a schedule, with a ranker count and an updated time | Users tab, New ranking | M | Today it never updates and can be empty. |
| Separate rankings for each week, rest of season and pre-draft, by scoring and position, with titles and "started from", plus weekly versions in the hub | Rankings hub, New ranking, editor, My rankings | L | |
| Tiers in your own rankings, plus Auto tiers | Ranking editor | M | |
| Movement arrows (▲4 / ▼3) | Hub rows, Community "Updated…" rows, ranking pages | M | Needs a dated copy saved on each update. |
| Submitting: Submit sheet, Submitted screen, statuses, "Show on my profile", "N submitted" on Home | Editor, My rankings, Home, Profile | L | |
| Accuracy grading: "Top 18%" and an accuracy rank on Profile | My rankings, Profile, Submit sheet | L | Profile shows Cred score until grading exists. |
| Members' published rankings, with Follow (follows the person), Community, search and notifications | Rankings, Community, search | L | |

### Leagues
| Gap | Screens | Size | Note |
|---|---|---|---|
| Team colour or photo, and player nicknames | Menu › My team, every team avatar | M | |
| All-time league history, previous seasons, start/sit accuracy | League Menu | L | Needs leagues to carry over between seasons. This season's head-to-head is Build now #16. |
| Co-owners | League Menu | L | The league spec holds this until after v1. |
| Trade offers that expire | Trade builder, trade detail | M | Recommend leaving it out. Today's behaviour matches the design's "Never". |
| Standings movement since last week | Standings | M | |
| Vetoed trades drop out of the team filter | Activity, Transactions | S | |

### Lists and search
| Gap | Screens | Size | Note |
|---|---|---|---|
| Cover colour choice | Lists | S | Waits on decision 9. |
| Using the video's frame as the cover, or going back to the collage after an upload | New list, Edit details | S | |
| More than 6 tiers | List editor | M | Keep 6 for launch. |
| Trending topics in search | Search | M | Risers can stand in until then (Build now #1). |

---

## 3. Can build now on data we already have

Most impact first. Launch-scope screens come before leagues, and leagues come before switched-off features.

**Everywhere**
| # | What | Size |
|---|---|---|
| 1 | Full-screen search: All / Players / People / Posts chips, recent searches kept on the phone, trending from Risers. Inside a league it also finds managers (opens their team) and labels players Your team / Waivers / Free agent. For now Posts searches public lists. | M |
| 2 | A "Your mocks" link on Home's Practice card. Past mock drafts are otherwise only reachable from a league's pre-draft screen. | S |

**Lists**
| # | What | Size |
|---|---|---|
| 3 | Desktop list tools in the list's ⋯ sheet: position group and team lists (this also fixes the all-blue covers), drafted check-off and Clear drafted, player notes, side-by-side compare, and round/cost groups. | M |
| 4 | New list: a Public switch, and up to 10 videos instead of one. | M |
| 5 | Import into a list from My lists or My rankings. Scout AI and Experts come later. | M |
| 6 | Back from a list opened on Profile goes straight to Profile. | S |
| 7 | Return on the keyboard moves on once the list has a name, and the editor shows "2 of 2". | S |
| 8 | A list started from Community returns you to Community, refreshed, with "List created". | S |
| 9 | "Users" rank stat column, once community rankings are switched on. | S |

**League (test cohort)**
| # | What | Size |
|---|---|---|
| 10 | Rename your own team from Menu › My team (desktop already can). Drop "and avatar" from the card. | S |
| 11 | Lineup check card above Starters: starters set N/N, injured or bye starters named, projected score vs your opponent. | S |
| 12 | Lost and failed waiver claims, with the reason, in Transactions › My moves. Every waiver notification opens there. | M |
| 13 | Edit a pending claim: bid, drop and claim order. | M |
| 14 | When standings fail to load, the Team card says "Couldn't load the standings" with Try again (today it says "No games played yet"). | S |
| 15 | Draft results by round: round chips, with your picks in blue. | M |
| 16 | League history for this season: head-to-head with record, PF and PA. | M |
| 17 | NFL game screen with a box score, opened from a starter's game line. It doesn't need play-by-play. | L |

**Player profile**
| # | What | Size |
|---|---|---|
| 18 | A scoring chip in the stat strip. Desktop has this picker, phones don't. | S |
| 19 | This week's card shows "Q4 2:00 · 31-7" or "Final W 31-20", not just Live/Final. | S |

**Home and league switcher**
| # | What | Size |
|---|---|---|
| 20 | Pre-draft cards and the switcher show "Draft Aug 28 · 7:00 PM" or "Draft live". Today they say "Pre-draft" even during a live draft, or show a stray 0-0. Also: scoring in the Switch league sheet ("12-team PPR"), your team name in "Switched to…", and the league photo when one is uploaded. | S |

**Profile**
| # | What | Size |
|---|---|---|
| 21 | Bio under the handle, a slim Cred card (Scout tier and progress bar), and Following kept beside Followers. | S |
| 22 | Ranking rows show one row per position ranking, marked Saved or Finalized, and open the ranking you tap. | S |

**Messages**
| # | What | Size |
|---|---|---|
| 23 | Older league board posts load as you scroll up. Only the latest 30 load today. | S |
| 24 | Conversations sorted by latest message. | S |
| 25 | Who's online (green dot, "Active now") everywhere, not just in the draft room. | M |

**Community (off at launch)**
| # | What | Size |
|---|---|---|
| 26 | Like (with a count) and Comments on the list page. Top scouts and trending tags as For you shelves. These exist on desktop. | M |
| 27 | The season ranking is called Rest of season or Pre-draft by the calendar, with its own chip. "Rankings this week" shows only this week's and season rankings. | S |
| 28 | Tapping an AI expert's ranking opens it in Rankings, with "Start my ranking from this". | S |
| 29 | Label projections "Season proj" until weekly ones exist. | S |
| 30 | Search and filters cover every public list, not just the newest 100. There are 51 today, so this is needed before 100. | M |

**Rankings (off at launch)**
| # | What | Size |
|---|---|---|
| 31 | Add players marks who's on bye that week and drops the redundant "All" chip. | S |

---

## 4. Doesn't match the design yet (restyle)

This also covers desktop features the design left out, which we bring back in the phone look.

**Everywhere**
- **Pages with no phone screen** show the desktop layout and stay light in dark mode. **(M, then L)**
  - **League pages:** League settings / Scoring / Playoffs, Draft results, Schedule, Members, League stats and Commissioner tools. These have a phone close-and-title bar.
  - **Other pages:** account Settings, Leagues list, Mock drafts and reports, NFL teams, Trash, Rankings history and Start-or-sit question pages. **Done:** these now have a back-and-title bar too.
  - ~~**Step 1:** give them the same close-and-title bar.~~ Done.
  - **Step 2:** restyle each page in the phone look. Start with League settings / Scoring / Playoffs and Draft results (the design draws these), then account Settings.
- **Join league, Create league and Mock draft pop-ups** from Home are still the old desktop dialogs and stay light in dark mode. Rebuild them as phone sheets. **(M)**
- **Bottom sheets:** add an optional blue Done / Cancel / Submit pill in the header (Lists and Rankings sheets), slide up, and swipe down to close. **(S)**
- **Number columns don't line up.** Use even-width digits and Inter's single-storey "a" across the phone layout. **(S)**
- **Seahawks headshot ring** is lime. Make it navy (this changes desktop too). **(S)**
- **Green and red text doesn't brighten in dark mode** on the Profile start/sit rows, the Lists video-link error and the Tier 3 label. **(S)**

**League switcher**
- The "you are here" dash disappears in dark mode. Make it white in both themes. **(S)**
- Two quick swipes move only one league and show the message twice. Queue the swipes. **(S)**

**League tab**
- Add a week picker with a Live/Final label on Matchups. **(S)**
- Show second-opponent games in their own group. **(S)**
- Tint your own standings row and matchup card. **(S)**
- Use @handle everywhere. Transaction rows and the filter list drop the @ today. **(S)**

**Players**
- Add a search field to the league Players tab. It's the quick way to find a deep free agent. **(S)**

**Team**
- Overtime shows "Q5 2:31" on Team rows. Make it "OT" like Match. **(S)**

**Community**
- Projected points are black. Make them dark blue, per your D497 ruling. **(S)**

**Rankings**
- The compare note says "him" for kickers and defenses. Use neutral wording. **(S)**
- Short names clash: A.J. Brown shows as "A. Brown" next to "A. St. Brown", and DK becomes "D. Metcalf". Keep A.J., DK and CJ. **(S)**

**Player profile**
- Pills, tabs, season chips and league rows don't change when pressed. Add the pressed tint. **(S)**

---

## 5. Design issues we deliberately didn't copy (FYI)

- **Draft picks as trade pieces.** Redraft leagues have no future picks (league spec), and ESPN, Yahoo and Sleeper only allow pick trades in keeper and dynasty leagues.
- **League chat pop-up.** Nothing opened it, and it posted into the wrong conversation. Each league's board is its group chat in Messages instead.
- **Play reactions and comments.** These were unused data in the prototype, not a designed feature.
- **Hidden Players sub-tabs** (Search / Trending / Available / Leaders / Trade). They never appeared on screen.
- **Tapping a person in search** opens their profile, not a filtered Community, per your "usernames link to profile" rule.
- **Sorting bugs.** The prototype sorted blanks as −1, and removing the sorted column kept sorting by it.
- **Dark-mode colours that didn't switch:** an unreadable median card, a light waiver pill, ticks on unticked teams, white text on gold team headers, and a white cover swatch that vanished.
- **Made-up or frozen data:** a bell badge stuck at 3, a made-up bye week, three different rostered % for one player, owners that disagreed between tabs, Drops shown as Adds reversed, a hard-coded "Today" and a fake "Seen".
- **Navigation slips:** opening on League › Match, the player profile hidden under the trade, "Message @marcus" ending on Home, Back landing on stale screens, the composer hidden under the bottom bar, scroll position shared between tabs, and rows that only showed a toast.
- **Trade slips:** Withdraw shown as "Declined", Counter dropping players, and the league badge following the selected league instead of the trade's league.
- **Small leftovers:** an extra gap at the bottom of the profile, key-stat tiles that looked tappable, an "FA" fallback for unknown players, notifications out of time order, and the broken ranking composer.

**Also watching:** while testing, one warning appeared once on the Match page that the screen didn't match the server's copy on first load. It didn't come back in 6 reloads.

---

## 6. Closed by the build

| Area | Closed |
|---|---|
| Frame (bottom bar, headers, league switcher, Menu, sheets, dark mode) | 26 |
| Home and Notifications | 28 |
| Community | 25 |
| Profile and Lists | 37 |
| Rankings | 24 |
| Match and Team (including trades) | 26 |
| League tab and Players | 28 |
| Player profile and Messages | 38 |
| **Total** | **232** |

Two items reported as open turned out to be done already on phones, so they aren't counted above:
- Add players finds players by team code ("PHI").
- Trade notifications open that trade.
