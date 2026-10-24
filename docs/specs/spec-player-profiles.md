# NFL Player Profiles — PRD

Oct 14, 2026 · @Chris

## Summary and goals

Player profiles lead with what people actually argue about at the bar: where a player ranks all-time and right now, stated plainly with its scope, instead of age, height and a table of seasons.

Today that answer means opening three sites and adding up columns, and someone always included the playoffs. The profile does the comparison for you and shows its work.

**Goals**

- Every profile opens with 3–6 ranked claims ("3rd all-time in receiving TDs") that are true, scoped and current.
- Compare any two players, across eras, in one tap.
- Every number is shareable as a card with its definition attached.
- Public profiles become a source of search traffic.

**Non-goals**

- Scouting reports or written analysis.
- Licensed tracking data at launch (see Data sources).

## Page layout

Top to bottom, the page goes from the bar-argument answer to the deep detail.

1. **Header:** name, team, position, number, photo, a play button for the highlight reel, and a "Compare" button. Age, college and draft slot sit in one small line under the name: available, not the lead.
2. **Claims strip:** 3–6 rank badges, each a big rank and a short line. Examples: "#3 all-time · receiving TDs," "#1 this season · yards after catch," "#4 among active QBs · passing yards." Tap any badge to see the full leaderboard with this player highlighted.
3. **Scope toggle:** Regular season · Playoffs · Both. Applies to the whole page and is always visible.
4. **This season:** stat line, weekly fantasy points sparkline, league rank at position, recent games.
5. **Career:** totals and per-game averages, each with its all-time and active rank beside it.
6. **Efficiency:** rate stats (yards per target, EPA per play, catch rate, etc.) with rank among qualified players.
7. **Athletic profile:** combine results (40-yard dash, vertical, broad jump, etc.) with percentile at position.
8. **Fantasy:** career fantasy points, finishes by season (e.g. "WR3, WR7, WR1"), and consistency.
9. **Highlights:** This season, NFL career, College rows (see the Highlights PRD).
10. **Season-by-season table:** the classic table, at the bottom, for people who want it.

On mobile, the claims strip scrolls horizontally and each section collapses after its first few rows.

## Stat catalog

Every stat below gets ranked in four pools: all-time, active players, this season, and same draft class.

| Position | Counting stats | Rate and efficiency | Athletic |
| --- | --- | --- | --- |
| QB | Pass yards, pass TDs, INTs, rush yards, rush TDs, wins as starter, 4th-quarter comebacks | Completion %, yards per attempt, TD %, INT %, passer rating, EPA per dropback, sack rate | 40, height, hand size |
| RB | Rush yards, rush TDs, receptions, receiving yards, total TDs, scrimmage yards | Yards per carry, yards after contact (if licensed), success rate, targets per game | 40, 10-yd split, broad, vertical, weight |
| WR | Receptions, receiving yards, receiving TDs, 100-yard games, targets | Catch rate, yards per route run, yards per target, target share, air yards share, separation (if licensed) | 40, vertical, broad, 3-cone |
| TE | Receptions, receiving yards, receiving TDs | Catch rate, yards per route run, target share | 40, vertical, broad |

**Fantasy (all positions)**

- Career fantasy points (PPR, half, standard), and rank all-time at position.
- Seasonal finishes at position, top-12 and top-24 counts.
- Points per game, consistency (share of weeks as a top-24 player).

**Milestone stats**

- Games with 100+ yards, 3+ TDs, 300+ passing yards.
- Fastest to milestones ("2nd-fastest to 10,000 receiving yards, in N games").

## Ranking engine

The claims strip is generated, not hand-written: a nightly job ranks every player in every stat and pool, then picks the most impressive true claims for each profile.

**Computing ranks**

- For every stat × pool × scope (regular season, playoffs, both), compute a leaderboard and store each player's rank, value and the total number ranked.
- Rate stats need qualifiers (e.g. minimum attempts or targets per game played), shown on the leaderboard.
- Ties share a rank ("T-4th").
- Recompute nightly, and after each game day for active players.

**Choosing claims for the strip**

Score every candidate claim, then show the top 3–6:

- Better rank scores higher; all-time beats active, active beats season.
- Stats people care about for the position score higher (receiving TDs for a WR outrank 2-point conversions).
- Rank must clear a threshold: top 10 all-time, top 5 active, or top 3 this season.
- No two claims on the same stat; mix career and current when possible.
- Rookies and new players fall back to draft-class and this-season claims.

**Cross-era comparisons**

- Alongside raw totals, show era-adjusted versions: each season's value divided by that season's league average for the position, then scaled to a modern season.
- Per-game rates as well as totals, since season lengths changed (14, 16, 17 games).
- Label adjusted stats clearly; raw numbers always stay one tap away.

## Receipts, comparisons and share cards

Every number on the page can defend itself: it says exactly what it counts, and it can be shared with that definition attached.

**Receipts**

- Tap any stat to see its definition: regular season or playoffs, seasons included, games counted, qualifier, source.
- The scope toggle (Regular season · Playoffs · Both) applies everywhere.
- "As of" date on every leaderboard.

**Compare**

- "Compare" opens a side-by-side of two players (up to four on desktop).
- Same stats, same scope, ranks beside each value, the leader in each row highlighted.
- Modes: Career · Same age (stats through age X) · First N seasons · Peak 3 seasons · Era-adjusted.
- Natural-language entry through the existing Stat Center: "Peyton Manning vs Tom Brady first 2 seasons regular season."

**Share cards**

- One tap creates an image for a stat, a claim or a comparison.
- Each card shows the numbers, the scope line ("Regular season only, 1998–1999"), the source and the app's logo and URL.
- Opens the native share sheet; the card's link lands on the public comparison page.

## Data sources and licensing

Most of the catalog can be built from open data and the current stats provider. All-time ranks before 1999 and a few named metrics need licensing decisions. Confirm each source's terms before building on it.

| Need | Likely source | Status |
| --- | --- | --- |
| Play-by-play, EPA, success rate (1999 to now) | nflverse open data | Open; confirm license terms |
| Combine results, draft data, rosters | nflverse open data | Open; confirm license terms |
| Current-season live stats | Current FieldScout provider | Check coverage |
| Career totals before 1999 (needed for true all-time ranks) | Licensed historical database | Needs a source; scraping reference sites is generally against their terms |
| Separation, speed, other tracking metrics | NFL Next Gen Stats | Licensed; defer |
| QBR | ESPN proprietary | Licensed; use EPA per play instead |
| Player grades | PFF | Licensed; defer |

Until pre-1999 data is sourced, label all-time ranks honestly: "#3 since 1999." A wrong "all-time" claim is exactly the bar argument the product is supposed to settle.

## SEO

Player profiles are the biggest search opportunity in the product: thousands of pages, each answering questions people already type ("most receiving touchdowns all time," "Brady vs Manning first two seasons").

- Public, server-rendered profiles at `/players/[slug]` with incremental static regeneration after each game day.
- Public leaderboard pages per stat and pool: `/leaders/receiving-tds/all-time`.
- Public comparison pages at `/compare/[player-a]-vs-[player-b]` for comparisons that get shared or searched.
- Auto-written summary sentence at the top of each profile from its top claims, so the page has unique text.
- Structured data (`Person`, `SportsTeam`), canonical URLs, and sitemaps for players, leaderboards and popular comparisons.

## Data model

| Table | Key columns |
| --- | --- |
| `player_seasons` | player\_id, season, team, scope, stats JSON |
| `stat_definitions` | stat\_key, label, positions, kind (count, rate), qualifier rule, importance weight per position |
| `leaderboards` | stat\_key, pool, scope, player\_id, rank, value, total\_ranked, as\_of |
| `player_claims` | player\_id, stat\_key, pool, scope, rank, score, display text |
| `combine_results` | player\_id, drill, value, percentile at position |

## Milestones and open questions

1. **P1 — Stats foundation:** import nflverse history, `player_seasons`, `stat_definitions`.
2. **P2 — Leaderboards:** nightly ranking job, leaderboard pages.
3. **P3 — Profile v2:** claims strip, scope toggle, new layout.
4. **P4 — Compare and share cards.**
5. **P5 — SEO launch:** public pages, structured data, sitemaps.
6. **P6 — Era adjustment and pre-1999 history.**

- [ ] Source for pre-1999 career totals?
- [ ] Default fantasy scoring shown on profiles: PPR or half?
- [ ] Which positions at launch: QB, RB, WR, TE only, or include kickers and defenses?
