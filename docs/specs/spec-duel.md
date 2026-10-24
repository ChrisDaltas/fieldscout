# Duel — Game Design & Build Spec

Oct 14, 2026 · @Chris

## Overview

Duel is a free-to-play, head-to-head fantasy game played live during NFL games. Each player drafts a squad under a salary cap, then manages it like a coach: subbing players in and out from a bench while the games are on. Every lineup slot gets exactly four quarters of football to spend, in any games on the slate.

**Two formats**

|  | Duel Live | Duel Week |
| --- | --- | --- |
| Covers | One window (Thursday, Sunday Early, Sunday Late, Sunday Night or Monday) | Thursday through Monday |
| Length | About 3 hours | About 5 days |
| Core constraint | A swap budget | Every slot gets exactly 4 quarters |
| Best for | A quick game while you watch | Season-long strategy across the week |
| Launch order | First | Second |

**Core loop**

1. Pick a slate (a game window, like Sunday Early or Monday Night).
2. Buy a bench of players under the 10,000-credit cap, then start one at each lineup position.
3. Get matched against an opponent, or challenge someone directly.
4. During the games, move players between your bench and your starters. Each slot spends exactly 4 quarters, in whichever games you choose. Players only score while active.
5. Highest score wins. The result feeds your skill rating and your FieldScout profile.

**Design pillars**

- **Every quarter is a decision.** Each slot has exactly four, so when and where you spend them is the skill.
- **Fair to watch, not just to grind.** Swaps take effect at quarter boundaries, so stats-feed delays can't be exploited and you don't need to stare at the app every snap.
- **Readable in one glance.** The live screen answers: am I winning, how many swaps do I have, and who's playing for me right now.
- **No money.** Free to play, with no entry fees or cash prizes. Wins feed skill rank and bragging rights. This keeps Duel outside daily fantasy regulation.

**Working name.** "Duel" is internal only. "Fantasy Duel" is close to FanDuel, so the public name needs a trademark check before launch.

## Slates and game windows

A slate is the set of NFL games a duel covers. Your quarters idea is what makes every window work under one system: a slate is just a set of game-quarters, so a single Thursday game (4 quarters) and a full Sunday (roughly 50 quarters) run on the same rules.

| Slate | Games (typical) | Launch? |
| --- | --- | --- |
| Thursday Night | 1 | Yes |
| Sunday Early (1:00 ET) | 6–9 | Yes |
| Sunday Late (4:05/4:25 ET) | 3–5 | Yes |
| Sunday Night | 1 | Yes |
| Monday Night | 1–2 | Yes |
| Full Sunday (Early + Late) | 9–13 | Phase 2 |
| Full Week (Thu–Mon) | 14–16 | Phase 2 |

Single windows are Duel Live slates. Full Sunday and Full Week are Duel Week slates.

**Slate rules**

- Slates are generated automatically from the NFL schedule each Tuesday.
- A slate locks at its first kickoff. Squads can be edited freely until then.
- International morning games (9:30 ET) join Sunday Early, which then opens earlier.
- Monday doubleheaders are one slate.
- Flexed or rescheduled games move the slate's lock time. Postponed games are removed, and players from them score zero (or the slate is voided if it was a single-game slate).
- Bye weeks and short slates (e.g., Late with 2 games) still run; squad and swap numbers scale with game count (next section).

## Squads, salary cap and bench

Each manager buys a bench of players under a 10,000-credit cap, then starts one player at each lineup position from that bench. Only starters score; swaps move players between starters and the rest of the bench. Reserves are kept to 4–6 on purpose: a big bench lets everyone own every good player, and the cap stops forcing choices.

| Slate | Starters | Reserves | Total bought | Cap |
| --- | --- | --- | --- | --- |
| Single game (TNF, SNF, MNF, any game) | 3 per quarter (max 1 QB), picked each quarter | None | None | No cap (each player max 2 quarters) |
| Sunday Late (Duel Live) | 8: QB, RB, RB, WR, WR, TE, FLEX, FLEX | 4 | 12 | 10,000 |
| Sunday Early (Duel Live) | 8: QB, RB, RB, WR, WR, TE, FLEX, FLEX | 5 | 13 | 10,000 |
| Full Sunday (Duel Week) | 8: QB, RB, RB, WR, WR, TE, FLEX, FLEX | 5 | 13 | 10,000 |
| Full Week (Duel Week) | 8: QB, RB, RB, WR, WR, TE, FLEX, FLEX | 6 | 14 | 10,000 |

FLEX = RB, WR or TE (single-game FLEX also allows one QB). No kickers or defenses at launch; they score in lumps that make swaps feel random. These numbers are starting points to tune in playtests.

**Pricing**

- Each player gets a credit price per slate, set from projected points and locked when the slate opens Tuesday.
- Price = clamp(round to nearest 50(projected points × slate multiplier), 300, 3,000).
- The multiplier is set per slate so the best-projected full squad costs about 14,000 credits. That means roughly a third of your squad has to be value picks.
- Bench players cost the same as active players. Building a deep bench is a real trade-off against stars.

**Ownership**

- Players are not exclusive. Both duelists can own the same player.
- In single-game slates, heavy overlap is expected. Swap timing is what separates squads.

**Squad validation**

- Within cap, correct squad size, positions valid for every active slot.
- At most 4 players from one NFL team (single-game slates excepted).
- A player ruled out before his game can be replaced for free until his kickoff.

## Duel Week: quarters and swaps

Every starting slot gets exactly 4 quarters of football per duel, spent in any games on the slate. This is the core rule: no slot can ever score more than four quarters, however many games or windows it touches.

**Quarter rules**

1. Each slot has 4 quarters to spend. A quarter is spent when a player is in that slot during a real game quarter.
2. Every slot always has a player in it. A slot only spends quarters while its player's game is in progress; if his game hasn't kicked off yet, the slot waits and spends nothing.
3. One player per slot at a time, so a slot can never be active in two games during the same real quarter.
4. Spent quarters can't be undone.
5. When a slot has spent all 4 quarters, it's done and its player stops scoring.
6. A slot can only end short of 4 quarters if you put in a player too late in the slate's last games for him to use them. Those quarters score nothing.
7. Default: if you never make a change, each slot plays its starter's full game, exactly 4 quarters.
8. Overtime counts as part of Q4 and costs no extra quarter.

**Example: one WR slot over a Full Week slate**

| When | In the slot | Quarters spent |
| --- | --- | --- |
| Thursday, Q1–Q2 | Thursday-game WR | 2 of 4 |
| Halftime: you swap in a Sunday Early WR | Sunday WR, waiting for kickoff | 2 of 4 (slot waits) |
| Sunday Early, Q1–Q2 | Sunday WR | 4 of 4, slot done |

**Making changes**

- A change swaps a starter with a bench player. A slot is never empty. To save a slot's remaining quarters for later, swap in a player whose game hasn't started; the slot waits until his kickoff.
- The outgoing player stops at the end of his current quarter. The incoming player starts at the start of his game's next quarter (or at kickoff), never overlapping the outgoing player.
- There's no swap budget. The quarters are the budget.
- When no games are live (e.g. Friday through Sunday morning in a Full Week slate), changes are free and instant, because no quarters are in progress.
- Changes take effect only at quarter boundaries. TV runs ahead of stats feeds, so instant changes would let someone see a touchdown and put that player in before it registers.

**Two change modes**

|  | Swap Windows (default) | Open Swaps |
| --- | --- | --- |
| When you can change | Only during scheduled windows, plus any time no games are live | Any time |
| Opponent sees | Both sides' changes revealed at the same moment | Your changes once they take effect |
| Feel | Social and dramatic: the reveal | Strategic, timing-based |

**Swap window schedule**

- Single-game windows open on the live game clock: end of Q1 (90 seconds), halftime (5 minutes), end of Q3 (90 seconds). Each closes early if the feed shows the next quarter's first snap.
- Multi-game windows are three fixed 3-minute windows set from kickoff, where most games hit each break. Sunday Early: about 1:45, 2:35 and 3:30 PM ET.
- Changes made in a window take effect for the whole next quarter of each player's game, from its first snap. The window always closes before that snap.
- Up to 2 changes per window.

**Edge cases**

- Player ruled out before kickoff: he spends nothing; replace him freely before his game.
- Player injured mid-quarter: the slot still spends that quarter.
- Putting in a player whose game is final, or in a quarter that has already started: blocked until his next quarter.
- Pending changes are hidden from the opponent until they take effect or are revealed.
- In a single-game duel there's no later game, so every swap simply hands the slot's remaining quarters to the incoming player.

## Duel Live

Duel Live is the single-window format: one game window, about three hours, no quarter counting. Multi-game windows use the same rosters as Duel Week: buy a bench under the 10,000-credit cap from players in that window's games, then start one at each slot. Single-game duels drop the cap entirely. Each slot simply scores whatever its current player does while he's in.

**Rules**

1. Slates: Thursday Night, Sunday Early, Sunday Late, Sunday Night, Monday Night, plus any single game on the schedule (e.g. one Sunday Early matchup), so fans can duel on their own team's game. Single-game duels use their own rules (below).
2. Same bench under the 10,000-credit cap and same starter slots as the Squads table.
3. Swap budget, in Open Swaps mode: 5 for Sunday Early and Late. In Swap Windows mode: up to 2 per window, same windows as Duel Week.
4. Swaps take effect at the next quarter boundary, the same anti-cheating rule as Duel Week.
5. **No swapping out a player whose game is over.** Games in a window finish at different times; without this rule, a finished player could be swapped for one still in Q4 or overtime, giving that slot extra football.
6. No swapping in a player whose game is over or in its final quarter.

**Single-game Duel Live: pick by the quarter**

For one game (Thursday, Sunday or Monday night, or any game a fan picks), there's no cap and no bench. Before each quarter, you pick who plays for you that quarter from everyone in the game.

1. **3 lineup slots per quarter,** any positions, at most 1 QB.
2. **Each player can be used for at most 2 quarters** in the duel, in any quarters, consecutive or not. This replaces the cap: you can't ride the same stars all game, so when you spend them is the strategy.
3. Both duelists can pick the same player in the same quarter.
4. Before kickoff, you can set your lineup for all 4 quarters at once; the 2-quarter limit is checked across the whole plan. Q1 locks at kickoff. Each later quarter stays editable until the window before it closes (end of Q1, halftime, end of Q3), so you can set it and forget it or adjust live. At each quarter break, your lineup switches to the plan automatically, with no action needed and no app open required. Each quarter's lineup is revealed to your opponent only when that window closes; your plan for later quarters stays hidden.
5. If a later quarter was never set, the app carries over last quarter's lineup where those players have uses left, and fills any gaps with the best-projected available players.
6. Scoring is per quarter, so only that quarter's stats count for each pick. Overtime counts as part of Q4.
7. A usage meter on each player card shows 0, 1 or 2 quarters used, for both you and your opponent.

**Phase 2: next-snap swaps**

A swap takes effect on the incoming player's first snap after a 60-second lock, so it feels nearly real time. This needs a play-by-play feed with timestamps, which costs more than quarter-level stats. Ship once the feed is proven.

**Scoring in Duel Live**

- Quarter-boundary swaps: scored from per-quarter stats, same as Duel Week.
- Next-snap swaps: scored from play-by-play, counting only plays after the swap's effective time.

## Scoring, tiebreakers and ratings

Scoring is standard PPR, counted only for the quarters a player is active in your lineup.

**Scoring**

- PPR: 1 point per reception, 0.1 per rushing or receiving yard, 0.04 per passing yard, 6 per rushing or receiving TD, 4 per passing TD, −2 per interception or fumble lost, 2 per two-point conversion, 6 per return or fumble-recovery TD.
- Points are attributed to the quarter they happen in.
- Entry score = the sum, over each active interval, of that player's points in those game-quarters.
- Stat corrections after the game are applied until the slate is marked final (about 2 hours after the last game ends). After that, results are locked, even if the NFL issues official stat corrections later in the week.

**Tiebreakers, in order**

1. Fewer swaps used.
2. Highest single-player score in the duel.
3. Still tied: the duel is a draw (half a win for rating purposes).

**Skill rating**

- Each player has a Glicko-2 rating per slate type (single game vs. multi-game) plus an overall rating.
- Ratings drive matchmaking and map into the FieldScout rank tiers.
- Duels against bots and friendly challenges don't change ratings unless both players opt in ("ranked challenge").

**Post-game stats tracked per user**

- Win/loss record, by slate type and opponent.
- Swap value: points your swapped-in players scored minus what the swapped-out players scored in the same quarters. This is the stat that says you're a good coach.
- Best swap ever, biggest comeback, longest win streak.

## Modes

Launch with Quick Match and Challenges; add Brackets in phase 2. Bots are required from day one because there are no users yet.

**Quick Match (1v1, rated)**

- Pick a slate, build a squad, enter the queue.
- Matched by rating within the same slate and swap mode. The search widens over time.
- Matching closes 10 minutes before lock. Anyone unmatched gets a bot opponent.
- Opponent's squad is hidden until lock, then revealed.

**Challenges (1v1, friends)**

- Challenge a specific user (leaguemate, friend) or share a challenge link to the group chat.
- The challenger picks the slate and swap mode. The other player accepts and builds their own squad.
- Unrated by default, with an optional "ranked challenge" toggle.
- Results feed the head-to-head record on both profiles.

**Brackets (phase 2)**

A bracket spans a week's windows, one round per window, with a new squad each round:

| Bracket size | Round of 16 | Quarterfinals | Semifinals | Final |
| --- | --- | --- | --- | --- |
| 16 players | Thursday Night | Sunday Early | Sunday Late | Sunday or Monday Night |
| 8 players | — | Sunday Early | Sunday Late | Sunday or Monday Night |

- Public brackets fill by rating band. Private brackets are invite-only, which suits a fantasy league running a side competition.
- Losers can keep playing Quick Match, so nobody sits out the rest of the week.

**Bots**

- Three difficulty levels, labeled clearly as bots.
- Easy: random valid squad, swaps at random windows.
- Medium: best-projected squad under the cap, never swaps.
- Hard: best-projected squad, swaps out players who are underperforming their projection by halftime.
- Used for unmatched queues, the first-time tutorial duel, and practice.
- Later: "ghost" opponents built from real users' past squads and swaps, which feel more human.

## Screens and UX flows

Three formats share one hub, one live screen and one results screen; each adds one setup screen of its own. Mobile-first throughout.

**Screens**

| Screen | Used in | What it's for |
| --- | --- | --- |
| Duel hub | All | Upcoming games and slates, your live duels, open challenges, rating, a big Play button |
| Format and game picker | All | Choose Duel Live (single game or Sunday window) or Duel Week; single game shows primetime games first, then every game on the schedule |
| Opponent picker | All | Challenge a friend (link or username), Quick Match, or play a bot |
| Quarter planner | Single-game Live | A grid of Q1–Q4 × 3 slots; set every quarter up front |
| Roster builder | Multi-game Live, Week | Buy a bench under 10,000 credits, set starters |
| Week board | Week | Home screen for the 5-day duel: every slot's quarter meter and what's next |
| Live duel | All | Score, win probability, current lineups, ticker |
| Change sheet | All | Make a swap or edit a planned quarter |
| Window takeover and reveal | All (Swap Windows) | Countdown, last edits, then both sides revealed together |
| Results | All | Final, best move, rating change, rematch, share card |
| Duel history | All | Records by format and opponent; feeds the FieldScout profile |
| Tutorial | All | First duel against a bot, guided |

**Flow A: single-game Duel Live** (no cap, pick by the quarter)

1. **Start:** tap a friend's challenge link, or Play → Single game → choose a game (e.g. Seahawks vs. Rams).
2. **Opponent:** challenge a friend, Quick Match, or a bot.
3. **Quarter planner:** a 4-column grid (Q1–Q4) with 3 slots each. Tap a slot to pick from everyone in the game, sorted by projection. Each player card shows a usage meter (0/2, 1/2, 2/2); a player at 2/2 is greyed out. **Auto-plan** fills the whole grid with the best projected plan inside the limits. Save. Editable until kickoff.
4. **Kickoff:** Q1 lineups lock and both are revealed. The live screen opens.
5. **During each quarter:** the live screen shows this quarter's 3 players and points, the opponent's, and an "Up next" row with your planned lineup for the next quarter and an Edit button.
6. **At each break:** your lineup switches to the plan automatically. If you want to change it, edit Up next any time before the window closes; the window takeover is offered, never forced.
7. **Reveal:** when each window closes, both sides' next-quarter lineups appear together.
8. **Final:** results show your best pick ("Q4 QB: +9.1") and both usage grids side by side.

**Flow B: multi-game Duel Live** (Sunday Early or Late)

1. **Start:** Play → Sunday Early, or accept a challenge.
2. **Opponent:** friend, Quick Match or bot.
3. **Roster builder:** buy a bench under 10,000 credits from that window's games; cap meter; position filters; **Auto-fill** for the best projected roster. Set starters from the bench. Editable until first kickoff.
4. **Lock:** at first kickoff, the opponent's roster is revealed with a matchup preview.
5. **Live screen:** slot cards (player, game, quarter, points), swaps left, the bench with points each player would have scored, opponent's lineup, ticker.
6. **Changes:** Open Swaps: tap a bench player → change sheet shows who goes out, when each change takes effect, swaps left → confirm. Swap Windows: edit during the takeover. Blocked moves explain themselves ("His game is over; he can't be swapped out").
7. **Final:** results with best swap, swaps used, rating change.

**Flow C: Duel Week** (Thursday to Monday, four quarters per slot)

1. **Start:** Play → Duel Week (opens Tuesday), or accept a challenge.
2. **Opponent:** friend, Quick Match or bot.
3. **Roster builder:** 14 players under 10,000 credits from the whole week: 8 starters and 6 reserves. Each player shows his game day and time. Editable until Thursday kickoff.
4. **Week board** (the home screen all week): one row per slot with its player, game time, and a 4-segment quarter meter; a timeline of the week's windows; your score vs. your opponent's; and a banner when changes are free ("No games live: changes are instant until Sunday 10:00 AM").
5. **Thursday night:** the live screen for that game. Swap at a window; to save a slot's quarters, swap in a later-game player. The change sheet says what will happen: "Slot waits until Sun 10:00 AM · 3 quarters left."
6. **Friday and Saturday:** no games live. Edit freely from the week board.
7. **Sunday and Monday:** live screens per window. Slots that reach 4/4 show "Slot done."
8. **Final (Monday night):** results plus a week recap: points per slot, quarters used per game, best move of the week.

**Notifications**

- Lineup or roster not set, 30 minutes before lock.
- Challenge received or accepted; match found.
- Window opening, only if you opted in or your next quarter isn't set.
- Your change took effect.
- A starter ruled out before kickoff (free replacement).
- Duel Week: a slot's player kicks off, and a slot is done.
- Duel final.

## Backend

The whole game runs on the existing stack (Next.js, Supabase, Vercel) plus one always-on ingestion worker. The quarter-boundary rule keeps it simple: scoring is a sum over player-quarter totals.

**Data model (Supabase)**

| Table | Purpose | Key columns |
| --- | --- | --- |
| `slates` | A game window | id, type, swap\_mode, lock\_at, status (open, locked, live, final), squad/swap config |
| `slate_games` | Games in a slate | slate\_id, game\_id |
| `game_periods` | Quarter boundaries as they happen | game\_id, period (1–4, OT), started\_at, ended\_at |
| `slate_players` | Player prices per slate | slate\_id, player\_id, price, projection, status |
| `player_period_points` | Fantasy points per player per quarter | game\_id, player\_id, period, points, stats JSON, updated\_at |
| `entries` | A user's squad in a slate | id, slate\_id, user\_id, swaps\_used, locked\_at |
| `entry_players` | Squad members | entry\_id, player\_id, role (active slot or bench) |
| `active_intervals` | When each player counts | entry\_id, player\_id, slot, start (game\_id, period), end (game\_id, period) or open |
| `swaps` | Swap requests | entry\_id, out\_player, in\_player, submitted\_at, window\_id, status (pending, active, cancelled) |
| `swap_windows` | Scheduled windows | slate\_id, opens\_at, closes\_at, revealed\_at |
| `duels` | A matchup | id, slate\_id, entry\_a, entry\_b, kind (quick, challenge, bot, bracket), rated, result |
| `match_queue` | Matchmaking | user\_id, slate\_id, rating, entered\_at |
| `challenges` | Direct invites | from\_user, to\_user or link token, slate\_id, status |
| `ratings` | Glicko-2 per user | user\_id, scope, rating, deviation, volatility |
| `brackets`, `bracket_matches` | Phase 2 | size, rounds, slate per round |

**Scoring**

Entry score = sum of `player_period_points` over every `active_intervals` row for that entry. Implement as a Postgres view or function, recomputed when `player_period_points` changes. Live display adds the in-progress quarter.

**Services and jobs**

- **Stats ingestion worker** (always on during games, e.g. a small Fly.io or Railway service, since Vercel functions time out): polls or receives pushes every 10–15 seconds, upserts `player_period_points` and `game_periods`.
- **Boundary processor:** when a `game_periods` row closes, applies pending swaps involving that game (closes and opens `active_intervals`).
- **Window scheduler:** opens and closes `swap_windows`, then reveals sealed swaps.
- **Matchmaker** (runs every 30 seconds per open slate): pairs by rating, widens over time, assigns bots at cutoff.
- **Slate generator** (Tuesdays): builds slates from the schedule and prices players.
- **Finalizer:** marks slates final after stat corrections, writes results, updates ratings.

**Realtime**

- Supabase Realtime channel per duel: score, intervals, revealed swaps.
- Clients subscribe on the Live Duel screen. No polling from clients.
- Win probability: simple simulation from remaining projections, computed server-side per update.

**Integrity and security**

- All swap validation server-side (Postgres function with row locks), never trusting the client.
- Server timestamps decide which boundary a swap falls into.
- RLS: users write only their own entries and swaps. Opponents' pending swaps are never readable until revealed.
- Rate limits on queue entry and challenge creation.

**The four-quarter guarantee** is enforced in the database, not just the app: a constraint on `active_intervals` makes it impossible for any (entry, slot) to cover more than 4 game-quarters or two overlapping real-time quarters. Every change goes through one Postgres function that checks it, with a row lock on the entry.

## Data requirements and risks

The one hard dependency is a live stats feed with per-quarter player stats. Confirm what the current FieldScout provider offers, and its cost, before building anything else.

**What the feed must provide**

- Live player stats split by quarter (or play-by-play with a quarter on each play, which can be rolled up).
- Quarter start and end events per game, with low latency.
- Updates at least every 15 seconds during games.
- Injury and inactive designations before kickoff.
- Stat corrections after games.
- Schedule data for slate generation, and projections for pricing (your own model or the provider's).

**Risks**

| Risk | Mitigation |
| --- | --- |
| Live feed is expensive | Quarter-level data is cheaper than play-by-play. Negotiate a startup tier. Launch with fewer slates. |
| Feed delay or outage mid-game | Boundary rule tolerates delay. If a feed is down past a threshold, freeze swaps and show a banner. Void the slate if data can't be recovered. |
| Not enough players for matchmaking | Bots from day one, challenge links for friends, Swap Windows to concentrate activity. |
| Looks like daily fantasy gambling | No entry fees, no prizes, no paid boosts. Review before adding any paid feature. |
| Name conflict with FanDuel | Trademark check before choosing a public name. |

## Milestones and launch scope

The launch target is a playable single-game Duel against bots and friends, then Sunday slates. Each milestone ships behind a feature flag, with tests, following the Architect → Builder → Reviewer → Fix loop.

1. **M0 — Data spike.** Confirm the live feed supports per-quarter stats and boundary events. Build the ingestion worker writing `player_period_points` and `game_periods`. Replay a past game to test.
2. **M1 — Slates and pricing.** Slate generator, pricing, squad builder screen with cap validation.
3. **M2 — Scoring engine.** Active intervals, boundary processor, scoring view. Verified against replayed games.
4. **M3 — Live Duel vs. bot.** Live Duel screen, Open Swaps, swap sheet, bots, realtime. Duel Live on single-game slates only.
5. **M4 — Challenges and Swap Windows.** Challenge links, sealed windows with the reveal animation, results screen, share card.
6. **M5 — Quick Match and ratings.** Queue, matchmaker, Glicko-2, duel history.
7. **M6 — Sunday slates.** Sunday Early and Late, window scheduling for multi-game slates.
8. **M7 — Duel Week (four-quarter rule, Full Week and Full Sunday), Brackets, next-snap swaps for Duel Live** (phase 2).

**Build a replay harness early.** Re-running recorded game feeds at speed is the only practical way to test live scoring and swaps outside game days.

**Open questions**

- [ ] Does the current stats provider supply live per-quarter player stats, and at what cost?
- [ ] Public name for Duel (trademark check vs. FanDuel).
- [ ] Should the free-changes period in Duel Week also show the opponent's changes live, or keep them hidden until Sunday?
- [ ] Include kickers and defenses later, or never?
- [ ] Should Duel results count toward the main FieldScout skill rank, or keep a separate Duel rating?
