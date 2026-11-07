# Manager Profiles & Versus — PRD

Oct 14, 2026 · @Chris

## Summary and goals

Every manager gets a permanent profile that measures how good they are at fantasy, across every league and season, plus a Versus tab for sizing up everyone in your league. Existing platforms reset every year like Craigslist listings; here, your record follows you.

**Goals**

- Answer instantly: "What's my record against Mike?" "Who's the best manager in our league, all-time?"
- Measure skill, not just results: start/sit, waivers, drops, trades, rankings.
- Give every manager a rank worth showing off.
- Make switching platforms feel like gaining your history, not losing it.

**Two levels of stats**

- **League-specific:** your record, titles and rivalries inside one league.
- **Global:** your combined record and skill across all your leagues, and your rank among everyone on the platform.

## Manager profile

The profile has a global view by default and a league switcher for league-specific stats.

**Header**

- Name, avatar, rank tier badge (e.g. "All-Pro"), years on the platform, number of leagues.
- Trophy shelf: championships, with the league and year on each.
- Headline claims, generated the same way as NFL player profiles: "Top 5% start/sit accuracy," "3 titles in 6 seasons," "#2 waiver hit rate in the Office League."

**Global view** (all leagues combined)

- All-time record, win %, playoff appearances, titles, points per game.
- Skill stats: start/sit accuracy, waiver hit rate, drop regret, trade value gained, rankings accuracy (definitions below).
- Platform rank: percentile among all managers, overall and per skill stat.
- Duel record and rating.
- Season-by-season timeline of finishes across leagues.

**League view** (switcher at the top)

- Record, titles and finishes in that league, every season.
- Rank within the league on each skill stat.
- Rivalries: head-to-head record against each leaguemate.
- League lore: best week, worst loss, biggest trade.

**Viewing someone else's profile**

- Same layout, plus a "You vs. them" strip at the top: head-to-head record, last meeting, and who's better on each skill stat.
- Challenge to a Duel button.

## Versus tab

A tab inside each league for exploring every manager in it: who's good, who's lucky, and how you stack up against each of them.

**League table** (default view)

- One row per manager. Columns: all-time record, win %, titles, points per game, start/sit accuracy, waiver hit rate, luck (actual wins minus expected wins).
- Sort by any column. Your row is pinned and highlighted.
- Toggle: All-time · This season · Pick a season.

**Head-to-head grid**

- A matrix of every manager against every other, showing the record in each cell ("7–3"), colored by who leads.
- Tap a cell for the rivalry page.

**Rivalry page** (you vs. one manager)

- All-time record, playoff meetings, current streak, biggest win and loss.
- Every matchup, newest first, with scores.
- Side-by-side skill stats.
- Trades between you, with who won each one in hindsight.
- Buttons: Challenge to a Duel, Share rivalry card.

**League records**

- Highest single-week score, longest win streak, most titles, best and worst draft, most lopsided trade.
- Each record links to the week or trade it came from.

## Stat catalog and calculations

Skill stats compare what a manager did against what they could have done, using actual results. Most come from actions managers already take, so nobody has to fill anything in.

| Stat | How it's calculated |
| --- | --- |
| Start/sit accuracy | For each lineup decision where a starter and a benched player were both eligible for a slot, did the started player outscore the benched one? Share of correct calls, weighted by the point gap. |
| Optimal lineup % | Points scored divided by the best possible lineup from the roster that week. |
| Waiver hit rate | Share of pickups that went on to be started and scored above replacement level within 3 weeks. |
| Drop regret | Points scored by dropped players on other teams over the rest of the season. Lower is better. |
| Trade value | Points gained minus points given up from each trade, from trade date to season end. |
| Draft score | Season points of drafted players compared with average production at that draft slot. |
| Rankings accuracy | For users who submit weekly rankings: correlation between their ranking and actual finish, per position. |
| Luck | Actual wins minus expected wins (wins you'd have if you played every team every week). |
| Duel rating | From Duel (see the Duel spec). |

**Skill rank**

- A composite score from the skill stats, weighted and normalized across the platform, recalculated weekly.
- Mapped to named tiers (e.g. Rookie, Starter, Pro Bowl, All-Pro, Hall of Fame) with a percentile shown.
- Minimum sample before a rank shows: e.g. 4 weeks of lineups.

## Privacy

- League-specific stats are visible to members of that league.
- Global profile visibility: Public (default), Friends and leaguemates, or Private.
- Public profiles show tier, titles and win % only; detailed skill stats need at least a leaguemate relationship unless the user opts in.

## History import

- Import past seasons from ESPN, Yahoo and Sleeper so new users arrive with their records.
- Claim flow: an imported league creates placeholder managers; each leaguemate claims theirs on joining.
- Feasibility depends on what each platform exposes (official APIs, public endpoints, user-authorized access) and their terms. Research before committing.

## Data model

| Table | Key columns |
| --- | --- |
| `manager_seasons` | user\_id, league\_id, season, wins, losses, ties, points\_for, finish |
| `matchups` | league\_id, season, week, manager\_a, manager\_b, score\_a, score\_b, playoff |
| `lineup_decisions` | league\_id, week, user\_id, slot, started\_player, benched\_player, points each |
| `transactions` | league\_id, user\_id, type (add, drop, trade), players, date |
| `skill_stats` | user\_id, scope (global or league\_id), season or all-time, stat\_key, value, percentile |
| `skill_ranks` | user\_id, composite, tier, percentile, updated\_at |

## Milestones

1. **M1 — History foundation:** persist manager seasons and matchups across seasons.
2. **M2 — Versus tab:** league table, head-to-head grid, rivalry page.
3. **M3 — Skill stats:** lineup decisions, transactions, calculations.
4. **M4 — Manager profile:** global and league views, claims, trophy shelf.
5. **M5 — Skill rank and tiers.**
6. **M6 — History import.**
