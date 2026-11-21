# Trade Calculator — PRD

Oct 21, 2026 · @Chris

## Summary and goals

A redraft trade calculator. Pick your league's PPR setting and team count, add up to four teams and the players each one sends, and see who comes out ahead. Values come from our own formula: player projections, adjusted by what managers are actually paying in real Sleeper trades this season.

**Goals**

- Answer instantly: "Is this trade fair?" "Who wins this three-way deal?"
- One value per player that reflects both what he should score and what the market pays for him.
- Show when the two disagree, so managers can spot buy-low and sell-high players.

**Out of scope for now**

- Dynasty and keeper leagues, draft picks in trades.
- Custom scoring. Users pick the closest PPR option.
- Superflex / 2-QB leagues. Every league is valued as 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX.
- Importing a user's real roster.

## Settings

- **PPR:** No PPR · .25 PPR · Half PPR · Full PPR. Users pick whichever is closest to their league.
- **Teams:** 8 · 10 · 12 · 14 · 16 *(suggested; Chris to confirm)*.

## The calculator

- Starts as a two-team trade. **Add team** goes up to four.
- Each team has a player picker. In a three- or four-team trade, every player also gets a **sends to** team, because "Team A sends Chase" doesn't say where he goes.
- The result is per team: what it gave, what it got, and the difference — "Team A +120, Team B −40, Team C −80." A deal can look fair overall and still be lopsided for one team, so there is no single overall verdict.
- Each player shows his value, and a short note when projections and the market disagree: "projections like him more than the market does."

## Player values

**1. Projection value.** Projected points for the chosen PPR setting, minus the projected points of the best player likely still on waivers at his position (replacement level). Replacement level moves with team count: deeper waivers in 8-team leagues, thinner in 16.

- We already store no-PPR, half and full PPR projections. The gap between them is exactly the player's projected catches × 0.5, so .25 PPR is the midpoint of no-PPR and half. All four options are exact.
- Replacement level reuses the existing VORP engine (`src/lib/scoring/vorp.ts`), which today assumes 12 teams.

**2. Market value.** What managers are paying in real trades, from this season's Sleeper redraft leagues (below). Every trade says "each team got about what it gave"; solving across all trades gives every player a value. Multi-team trades count too: a three-team trade is three of those statements.

**3. The blend.** Every player starts at his projection value. If the market pays more or less, the value moves toward the market — **how far depends on how many trades back it up**. A star traded 2,000 times this season is mostly market value; a backup traded 15 times stays mostly projection.

- Recent trades count far more than old ones. In redraft a player's value changes every week with injuries, byes and schedule.
- Values recalculate daily.
- The knobs are adjustable without rebuilding: how strongly trades pull the value, how fast old trades fade, how many trades it takes for the market to dominate. Tuned by eye at first — there is no answer key for trade value.

## Trade data from Sleeper

We already use Sleeper's public API for player data and projections. League trades come from the same API.

- **Finding leagues:** there is no "list all leagues" call, so a background job snowballs — users → their leagues → those leagues' members → their other leagues.
- **Redraft only:** each league says whether it is redraft, keeper or dynasty; we keep redraft.
- **This season only:** last season's redraft trades say nothing about today.
- **Bucketing:** each league tells us its PPR value and team count, so trades are grouped by our four PPR options and five team sizes.
- **Thin buckets** (e.g. 8-team .25 PPR) borrow from the nearest bucket, or fall back to projections, until they have enough trades.
- Stay under Sleeper's stated limit of about 1,000 requests a minute.

## Open questions for Chris

1. **Sleeper's terms of service.** Reading leagues one at a time is clearly fine; collecting trades across many leagues for our own product needs a read of their terms before we build the crawler.
2. **New data source.** The crawler is a new ongoing ingestion job alongside RSS and YouTube — approve adding it.
3. **Team counts:** 8, 10, 12, 14, 16?
4. **Where it lives:** a public page anyone can use (good for search traffic), signed-in only, or both?
5. **Launch order:** where this sits relative to the other next-phase PRDs.
