# Spec: Player Following + News Feed

## Phase
Phase 7 — Player Following + News Feed

## Overview

Users follow individual NFL players and get a personalized stream of news, injuries, and roster moves in their home feed. Near-realtime updates during the season.

---

## Features

### Follow / Unfollow Players
- Follow button on any player card, player row, or player drawer
- No limit on how many players a user can follow

### Player News Feed
- Injury reports, practice status, depth chart changes, trades, cuts, inactives, and notable performances surface in the home feed for followed players
- Distinct visual treatment from list cards — news items look like news, not lists
- Links out to source article — FieldScout surfaces and attributes, does not generate original content

### Player Page — News Tab
- Dedicated news tab on every player's page showing all recent news regardless of follow status
- Available to all users

### Near-Realtime Updates
- Injury and status updates surface within minutes during the NFL season
- Powered by third-party NFL news/injury API (e.g. Rotowire, SportsDataIO)

---

## Data Source

Third-party NFL news API. Candidates: Rotowire, SportsDataIO, or equivalent. FieldScout does not generate original news content — it surfaces, attributes, and links to the source.

---

## Database

```sql
player_follows:
  id, user_id, player_id, created_at
  UNIQUE(user_id, player_id)

player_news:
  id, player_id, headline, body_preview, source_name,
  source_url, published_at, news_type (injury/trade/depth/performance)
```

---

## UI Components

- `src/components/players/follow-player-button.tsx`
- `src/components/feed/news-feed-item.tsx`
- `src/components/players/player-news-tab.tsx`
- `src/hooks/use-player-follows.ts`
- `scripts/sync-player-news.ts` (cron — runs every 5 min during season)
