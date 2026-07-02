# Spec: YouTube Highlights

## Overview

Every player detail drawer includes a Highlights button that surfaces YouTube video content for that player. Shipped in two phases: Phase 1 is a simple link-out requiring zero API integration; Phase 3 brings an embedded in-app experience.

---

## Phase 1: Link-Out Button (Phase 1 — MVP)

### Behavior

A "Highlights" button on the player detail drawer opens a YouTube search results page in a new browser tab. No API key required. No quota. No caching.

### URL Construction

```
https://www.youtube.com/results?search_query={firstName}+{lastName}+NFL+highlights+2026
```

Example for Ja'Marr Chase:
```
https://www.youtube.com/results?search_query=Ja%27Marr+Chase+NFL+highlights+2026
```

- Player name components should be URL-encoded
- Append the current NFL season year for more relevant results
- Open in a new tab (`target="_blank"`, `rel="noopener noreferrer"`)

### Prerequisites

This feature requires the player detail drawer, which is introduced in Phase 3 (`spec-player-research.md`). For Phase 1, add a lightweight player detail modal/drawer to the player row component so the Highlights button has a surface to live on.

### UI

- Button label: "Highlights ↗"
- Icon: YouTube logo or external link icon (Lucide `ExternalLink`)
- Placement: player detail drawer, below the stat summary
- Styling: ghost button, secondary treatment — not a primary CTA

### Components

- `src/components/players/player-drawer.tsx` — add Highlights button
- `src/utils/youtube.ts` — `buildYouTubeSearchUrl(playerName: string, season: number): string`

### Gating

- Available to all users (free and Pro) in Phase 1

---

## Phase 2: Embedded In-App Player (Phase 3 — Player Research)

### Behavior

A "Highlights" tab on the player detail drawer shows a grid of YouTube video thumbnails sourced via the YouTube Data API. Users can play videos inline without leaving the app.

### YouTube Data API

- API: YouTube Data API v3 (free, requires Google Cloud project)
- Endpoint: `GET https://www.googleapis.com/youtube/v3/search`
- Query: `"{player name}" NFL highlights {season} -shorts`
  - `-shorts` excludes YouTube Shorts for better result quality
  - Quoted player name improves precision
- `type=video`, `maxResults=6`, `order=relevance`
- API key: `YOUTUBE_DATA_API_KEY` added to `.env.local`

### Quota Management

YouTube Data API free tier: **10,000 units/day**. Each search request costs **100 units** = 100 searches/day before hitting the ceiling.

**Caching strategy (required):**
- Cache results in a `player_highlights` Supabase table keyed by `(player_id, season)`
- Cache TTL: 7 days — refresh on next request after expiry
- Serve from cache on repeat views; only call the API on first load or cache miss
- This keeps quota consumption proportional to unique player/week combinations, not page views

### Search Quality

YouTube search is not deterministic. To improve result quality:
- Use specific query structure: `"First Last" NFL highlights 2026 -shorts`
- Filter `videoCategoryId=17` (Sports) where supported
- Display results as thumbnails with video title — let users choose the clip they want rather than auto-playing the first result

### Data Structure

```json
{
  "video_id": "dQw4w9WgXcQ",
  "title": "Ja'Marr Chase Week 12 Highlights",
  "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
  "channel_name": "NFL",
  "published_at": "2026-11-18T00:00:00Z"
}
```

### Database

```sql
player_highlights:
  id, player_id, season, videos (jsonb array of video objects),
  fetched_at, expires_at
```

### In-App Player

- Clicking a thumbnail opens the YouTube IFrame Player in a modal
- IFrame embed URL: `https://www.youtube.com/embed/{video_id}?autoplay=1`
- YouTube IFrame embeds are fully ToS-compliant
- Modal closes on backdrop click or Escape key

### Gating

- Embedded highlights tab is a **Pro-only feature** in Phase 3
- Free users see the link-out button (Phase 1 behavior) permanently
- Pro gate shown as an upgrade prompt on the highlights tab for free users

### Components

- `src/components/players/highlights-tab.tsx`
- `src/components/players/highlight-thumbnail.tsx`
- `src/components/players/highlight-player-modal.tsx`
- `app/api/players/[id]/highlights/route.ts` — checks cache, calls YouTube API if needed
- `src/utils/youtube.ts` — shared URL utilities (extended from Phase 1)

### API Keys Needed

- `YOUTUBE_DATA_API_KEY` — YouTube Data API v3 (Google Cloud Console)
