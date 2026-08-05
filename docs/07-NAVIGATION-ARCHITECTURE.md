# Navigation & App Architecture: FieldScout Fantasy Football

**Version:** 1.0  
**Date:** April 23, 2026  
**Purpose:** Single source of truth for every route in the app, navigation structure across device sizes, and access rules by user type. Reference this before building any page or nav component.

---

## User Types & Access Tiers

| Type | Description |
|------|-------------|
| **Guest** | Unauthenticated visitor. Has a guest session ID in localStorage. Can read all public content and interact with the guest Big Board. |
| **Free** | Authenticated user. Full core experience with limits on private lists, teams, and custom scoring. |
| **Pro** | Paid subscriber. All limits lifted. Access to premium features. |

---

## Route Architecture

### Public Routes (no auth required)

These routes are server-rendered for SEO and accessible without a session.

| Route | Page | Notes |
|-------|------|-------|
| `/` | Home — guest Big Board + public feed | The product IS the landing page. No splash screen. |
| `/login` | Sign in | Redirects to `/app` if already authenticated |
| `/signup` | Create account | Redirects to `/app` if already authenticated |
| `/username` | Username selection | Shown once after first sign-up; accessible only with session |
| `/forgot-password` | Password reset request | |
| `/reset-password` | Password reset (via email link) | |
| `/u/[username]` | Public user profile | SSR. Shows Big Board, public lists, cred, accuracy |
| `/u/[username]/big-board` | User's season-long Big Board | SSR. Always public. |
| `/u/[username]/big-board/week/[week]` | User's weekly Big Board | SSR. Week 1–18. |
| `/u/[username]/lists/[listSlug]` | Public list detail | SSR. Shows player list, likes, comments (if enabled) |
| `/tag/[tag-slug]` | Tag feed | SSR. All public lists with this tag, sorted by recency + popularity |
| `/consensus` | Community consensus rankings | SSR. System-wide cred-weighted Big Board |
| `/consensus/[position]` | Position consensus | SSR. e.g., `/consensus/rb`, `/consensus/wr` |
| `/auth/callback` | Supabase OAuth callback | Handles Google OAuth redirect; not user-facing |

---

### Authenticated App Routes

All routes under `/app` require authentication. Unauthenticated users are redirected to `/login?redirect={original-path}`.

#### Home

| Route | Page |
|-------|------|
| `/app` | Home — Community tab (default) |
| `/app?tab=players` | Home — Players tab |
| `/app/explore` | Explore — trending lists, top rankers, tag browser, search results |

#### Big Board

| Route | Page |
|-------|------|
| `/app/big-board` | User's season-long Big Board (workspace, explicit save) |
| `/app/big-board/week/[week]` | Weekly Big Board for NFL week 1–18 (current week is editable; past weeks are read-only; future weeks are locked) |

#### Lists

| Route | Page |
|-------|------|
| `/app/lists` | My Lists — all lists the user owns, two-tab view (Lists + Side by Side) |
| `/app/lists/new` | Create new list |
| `/app/lists/[listId]` | List detail/edit — player cards, drag-to-reorder, Smart Order, Set as My Rank, tier toggle |
| `/app/lists/[listId]/tiers` | Tier view for a list (same URL, toggled via view mode control) |

#### My Stats

| Route | Page |
|-------|------|
| `/app/stats` | Personal stats dashboard — cred score, accuracy history, submission history, cred tier |

#### Weekly Ranks

| Route | Page |
|-------|------|
| `/app/weekly-ranks` | Weekly ranking submission — submit position rankings for the current week |
| `/app/weekly-ranks/history` | Past weekly submissions and accuracy scores |

#### Players

| Route | Page |
|-------|------|
| `/app/players` | Full player browser — searchable, filterable by position/team/status |
| `/app/players/[playerId]` | Individual player page — stats, news, lists they appear on, follow button |

#### Research

| Route | Page |
|-------|------|
| `/app/research` | Player research table — filterable, sortable stat table with scoring system selector |

#### Start or Sit

| Route | Page |
|-------|------|
| `/app/start-or-sit` | Start or Sit feed — open questions from followed users + community |
| `/app/start-or-sit/new` | Post a new Start or Sit question |
| `/app/start-or-sit/[questionId]` | Question detail — vote, see results after voting |

#### Teams

| Route | Page |
|-------|------|
| `/app/teams` | My teams — list of all teams |
| `/app/teams/[teamId]` | Team detail — roster, weekly scoring, set lineup |
| `/app/teams/[teamId]/live` | Live Mode — real-time game day scoring (active during NFL game windows only) |

#### Leagues *(Pro only)*

| Route | Page |
|-------|------|
| `/app/leagues` | My leagues — list of leagues the user is in |
| `/app/leagues/new` | Create league *(Pro only)* |
| `/app/leagues/[leagueId]` | League detail — standings, rosters, chat |
| `/app/leagues/[leagueId]/manage` | League management — matchup assignments, roster moves, point edits *(League Owner only)* |

#### Settings

| Route | Page |
|-------|------|
| `/app/settings` | Account settings — email, password, notifications |
| `/app/settings/profile` | Profile settings — avatar upload, bio. No name field: FieldScout stores no name for a person (ruling 2026-08-05) |
| `/app/settings/scoring` | Scoring systems — view/create custom scoring systems |
| `/app/settings/billing` | Pro subscription — upgrade, manage, cancel |

#### Notifications

| Route | Page |
|-------|------|
| `/app/notifications` | All notifications — likes, comments, follows, cred milestones |

---

## Navigation Structure

### Desktop (≥ 1024px) — Left Sidebar

The sidebar is the primary navigation surface on desktop. It lives on the left side of the layout and is always present (never hidden) while in the expanded or collapsed state.

#### Sidebar Layout Overview

```
┌──────────────────┬────────────────────────────────────┐
│                  │                                    │
│  Sidebar         │    Main Content Area               │
│  (default 240px) │    (fills remaining width)         │
│  min 180px       │                                    │
│  max 400px       │                                    │
│                  │                                    │
│  [←] Collapse    │                                    │
│  ─────────────   │                                    │
│  + New List      │                                    │
│  ─────────────   │                                    │
│  🏠 Home         │                                    │
│  📋 Big Board    │                                    │
│  📊 My Stats     │                                    │
│  📅 Weekly Ranks │                                    │
│  🏈 Players      │                                    │
│  📑 Lists      ▾ │                                    │
│    Favorites     │                                    │
│      My QB Tier  │                                    │
│      2025 Sleeprs│                                    │
│    Recent        │                                    │
│      Waiver Wire │                                    │
│      Week 3 WRs  │                                    │
│      ...         │                                    │
│                  │                                    │
│  ─────────────   │                                    │
│  🕓 History    ▾ │   ← sticks to bottom               │
│  👤 My Profile   │   ← sticks to bottom               │
└──────────────────┴────────────────────────────────────┘
```

---

#### Sidebar Interaction Model

**Resizable — drag to resize:**
- The sidebar width is user-adjustable. The user drags the right edge of the sidebar left or right to resize it.
- Default width: **240px**
- Minimum width: **180px** (below this, auto-collapse to icon-only mode)
- Maximum width: **400px**
- Width preference persists in `localStorage` across sessions.
- A subtle drag handle (1–2px vertical line, highlights on hover) sits on the right edge of the sidebar. On hover it shows a resize cursor (`col-resize`).

**Collapsed mode — icon only:**
- A toggle button at the top of the sidebar (e.g., `‹` chevron icon) collapses the sidebar to icon-only mode.
- In collapsed mode: the sidebar narrows to **52px** and shows only icons for each nav item. No labels.
- Hovering any icon in collapsed mode shows a **tooltip** to the right of the icon with the item's label.
- The collapse toggle flips to `›` in collapsed mode. Clicking it restores the expanded sidebar.
- Collapsed state persists in `localStorage`.
- Nested items (Lists sub-sections, History) are not visible in collapsed mode — clicking the Lists icon in collapsed mode navigates to `/app/lists` directly.

**Expanded mode — default:**
- Full-width sidebar with icons + labels.
- Nested sections (Lists sub-sections, History) are visible with expand/collapse toggles.
- The FIELDSCOUT wordmark is hidden from the sidebar itself — it appears in the top bar above the content area only.

---

#### Sidebar Nav Items

**Top section — primary action:**

| | Item | Behavior |
|---|------|---------|
| **+** | **New List** | Opens "Create List" modal or navigates to `/app/lists/new`. Visually distinct from nav items — treated as a primary action button, full-width, with a `+` icon. |

**Main navigation:**

| Icon | Label | Route | Notes |
|------|-------|-------|-------|
| 🏠 | Home | `/app` | Default active page on login |
| 📋 | Big Board | `/app/big-board` | |
| 📊 | My Stats | `/app/stats` | User's personal accuracy, cred, submission history |
| 📅 | Weekly Ranks | `/app/weekly-ranks` | Weekly ranking submission + history |
| 🏈 | Players | `/app/players` | Full player browser / search |
| 📑 | Lists | `/app/lists` | Expandable — see nested section below |

**Lists — nested sub-sections (visible in expanded mode):**

The Lists nav item has an inline expand/collapse toggle (▾ / ▸). When expanded, it reveals two labeled sub-sections:

```
📑 Lists                    ▾
   ── Favorites ──────────────
     ★ My QB Tier List        → /app/lists/[id]
     ★ 2025 Sleepers          → /app/lists/[id]
   ── Recent ──────────────────
     · Waiver Wire Week 4     → /app/lists/[id]
     · Week 3 WR Rankings     → /app/lists/[id]
     · My RB Depth Chart      → /app/lists/[id]
     [See all lists →]        → /app/lists
```

- **Favorites:** Lists the user has starred/favorited, in order of most recently favorited. A user can favorite any of their own lists. A star (★) icon on any list card or list detail page toggles favorite status. Maximum 3–5 shown in the sidebar; "See all" links to `/app/lists?tab=favorites`.
- **Recent:** All lists the user has created, in reverse chronological order (most recently updated first). Maximum 5 shown; "See all" links to `/app/lists`.
- Both sub-sections can be empty (show a subtle empty state: "No favorites yet" / "No lists yet").
- List items in the sidebar show the list title only (truncated with ellipsis if too long).

**Bottom section — sticks to bottom of sidebar:**

These two items are pinned to the bottom of the sidebar regardless of scroll position. They sit below a top divider.

| Icon | Label | Route | Notes |
|------|-------|-------|-------|
| 🕓 | History | Expandable panel | Chronological log of pages the user has visited |
| 👤 | My Profile | `/u/[username]` | Links to the user's public profile page |

**History — expandable panel:**

History shows a chronological reverse-ordered list of pages the user has recently visited. It is expandable/collapsible like the Lists section. Three content types are tracked:

- **User profiles** visited — shown as avatar + username
- **Player pages** visited — shown as player headshot + name + position/team
- **Lists** viewed — shown as list title + owner's username

History is stored client-side in `localStorage` (no server-side persistence needed in Phase 1). Maximum 20 entries shown; oldest entries are evicted automatically. The panel is limited in height — if expanded and there are many items it scrolls internally.

```
🕓 History                  ▾
   👤 @jsmith               → /u/jsmith
   🏈 Justin Jefferson · WR → /app/players/[id]
   📑 Top RBs by @mike23    → /u/mike23/lists/top-rbs
   👤 @fantasyguru          → /u/fantasyguru
   🏈 Patrick Mahomes · QB  → /app/players/[id]
```

---

### Mobile (< 1024px) — Bottom Tab Bar

On mobile, the sidebar is replaced with a fixed bottom tab bar for the 5 core destinations. Secondary destinations are accessible via a "More" bottom sheet.

```
┌─────────────────────────────────────────────────────┐
│  FIELDSCOUT                    🔔  [Avatar]           │  ← Top bar (h-14, sticky)
├─────────────────────────────────────────────────────┤
│                                                     │
│                 Main Content Area                   │
│                                                     │
│                                                     │
│                                                     │
│                                                     │
│                                                     │
├─────────────────────────────────────────────────────┤
│  🏠      📋     🏈     📑     ···                  │  ← Bottom tab bar (h-16, fixed)
│ Home  BigBoard  Players Lists  More                │
└─────────────────────────────────────────────────────┘
```

**Bottom tab bar items:**

| Tab | Route |
|-----|-------|
| Home | `/app` |
| Big Board | `/app/big-board` |
| Players | `/app/players` |
| Lists | `/app/lists` |
| More (···) | Opens bottom sheet |

**"More" bottom sheet contents:**
- My Stats → `/app/stats`
- Weekly Ranks → `/app/weekly-ranks`
- Start or Sit → `/app/start-or-sit`
- Teams → `/app/teams`
- Leagues → `/app/leagues`
- History (inline expandable list)
- My Profile → `/u/[username]`
- Settings → `/app/settings`
- Sign out

---

### Guest Navigation (unauthenticated)

When the user is not signed in, the top-level experience changes:

- **Desktop:** No sidebar. Minimal top bar with FIELDSCOUT wordmark (left) and "Sign in / Sign up" buttons (right).
- **Mobile:** No bottom tabs. Same minimal top bar with sign-in/sign-up.
- The home page (`/`) renders the guest Big Board + public feed with a persistent "Save your rankings — Sign up free" banner below the top bar.
- All `/u/[username]`, `/tag/[tag]`, and `/consensus` routes remain fully accessible.
- Contextual sign-up prompts appear inline when a guest attempts any persistent action.

**Guest sign-up prompt triggers:**
- Clicking "Save" on the guest Big Board
- Clicking "Create List"
- Clicking "Like" on any list
- Clicking "Follow" on any user or player
- Clicking "Vote" on a Start or Sit question
- Clicking "Comment" on any list

Prompts are value-framed. Examples:
- "Save your Big Board → Sign up free, it takes 30 seconds"
- "Track your accuracy over the season → Sign up free"
- "Share your rankings with your league → Sign up free"

---

## Home Page (`/app`)

The Home page is the default landing page for authenticated users. It is divided into two tabs at the top of the content area: **Community** (default) and **Players**.

---

### Tab: Community (default)

The Community tab is organized as a series of horizontally scrollable shelf sections at the top, followed by a full vertical activity feed below. The shelf sections are designed for scanning and quick re-entry. The vertical feed is the main content stream.

> **Product note:** The shelf sections listed below are the initial set. They are explicitly subject to reordering, removal, or replacement based on engagement data as we test. Build them as a data-driven list so the order can be changed without code changes.

#### Shelf Sections (horizontal scroll, in order)

Each section is a labeled horizontal row with a section heading on the left and a scrollable row of cards to the right. On desktop, 3–4 cards are visible before the user scrolls. On mobile, 1.5–2 cards are visible (partial card peek signals scrollability).

---

**1. Recently Viewed**
- Purpose: Fast re-entry. Shows the last content the user visited so they can pick up where they left off.
- Card types: user profiles, player pages, or lists — whatever the user last viewed (same data as History in the sidebar).
- Card contents: thumbnail/avatar + name + type label (e.g., "List", "Player", "User").
- Empty state: hidden if the user has no recent views (e.g., first session).
- Data source: same `localStorage` History store used by the sidebar.

---

**2. Trending Users**
- Purpose: Surface active community members to follow. Shows users with the most recent activity (lists created, rankings submitted, Start or Sit questions posted).
- Card contents: avatar, username, cred tier badge, a brief activity blurb (e.g., "Posted 3 lists this week"), follow button.
- Follow button state: "Follow" or "Following" (toggled optimistically).
- Data source: server — aggregate of recent user activity events, refreshed hourly.

---

**3. Start or Sit**
- Purpose: Surfaces the most active or controversial Start or Sit questions right now. Users can vote directly from the card or tap through to the full question thread.
- Card contents: Player A vs Player B (headshots + names), current vote split (shown as a percentage bar after voting), number of votes, brief optional note from the poster.
- Inline voting: tapping a player on the card casts a vote without navigating away. After voting, the vote split animates into view on the card.
- Viewing comments: tapping the comment count or a "View discussion" link opens the full Start or Sit question page.
- Data source: server — open Start or Sit questions sorted by vote count + recency, refreshed every few minutes.

---

**4. Top Ranked Users**
- Purpose: Highlights users with the highest prediction accuracy. Credibility signal and social proof.
- Card contents: avatar, username, accuracy percentage (e.g., "74% accurate"), cred tier badge, follow button.
- Period toggle (within the section header): "This Week" / "This Season" / "All Time" — switches the list without navigating away.
- Data source: server — sorted by accuracy score for the selected period.

---

**5. Trending Players**
- Purpose: Shows NFL players who are being added to or removed from lists at an unusually high rate — useful signal for roster moves, injuries, breakout candidates, or bust calls.
- Card contents: player headshot, name, position + team, trend direction indicator (▲ being added / ▼ being removed), a count or percentage (e.g., "+340 lists this week").
- Cards are split into two visual states: rising (green accent) and falling (red accent).
- Data source: server — delta in `list_players` inserts/deletes per player over the last 7 days.

---

**6. Top Performers**
- Purpose: Quick stat recap — top 5 scorers per position group for the most recent completed NFL week. Useful for validating rankings and spotting breakouts.
- Two sub-tabs within the section: **Standard** and **PPR** (switches the point values shown).
- Position groups shown: QB, RB, WR, TE, K, DEF — each is its own horizontal row (or a single row with a position filter toggle above it).
- Card contents: player headshot, name, position + team, fantasy points (large), key stat line (e.g., "312 pass yds, 3 TD").
- During offseason or before Week 1: show prior season totals and label it clearly ("2025 Season").
- Data source: server — `player_stats` joined with scoring system calculations for standard and PPR.

---

#### Vertical Activity Feed

Below the shelf sections is the main vertical activity feed. This is a chronological stream of all public user activity across the platform.

**Feed item types (interleaved):**
- New list created — list card with title, author, player count, position tag
- List updated / players added — "X added 3 players to [List Name]"
- Big Board update — "X updated their Big Board"
- Weekly ranking submitted — "[User] submitted their Week N rankings"
- Cred milestone — "[User] just hit All Pro 🎉"
- Start or Sit posted — question card with inline voting

**Sort controls (above the feed):**

| Option | Behavior |
|--------|---------|
| Recent | Chronological, newest first (default) |
| Popular | Sorted by engagement (likes + comments + views) in the last 24 hours |

**Personalization (authenticated users):**
- Default view shows activity from users you follow, mixed with popular community content.
- A "Following / Everyone" toggle above the feed lets users switch between personalized and global views.

**Guest version of Community tab:**
- Shelf sections 2–6 all render (no personalization needed — they're global data).
- "Recently Viewed" renders from localStorage if it has any entries.
- The activity feed shows the global/popular view (no follow graph yet).
- Sign-up CTAs appear inline on like, comment, and follow actions.

---

### Tab: Players

The Players tab is a browsable, position-organized view of trending players. It is not a search interface (search lives in `/app/players`) — it is a discovery surface showing who is hot right now.

#### Layout

The Players tab is a series of labeled horizontal scroll sections, one per position group, stacked vertically. No vertical feed — the entire tab is shelf-based.

#### Position Group Sections (in order)

| Section | Position | Notes |
|---------|----------|-------|
| Quarterback | QB | |
| Running Back | RB | |
| Wide Receiver | WR | |
| Flex | FLEX | RB/WR/TE eligibility; shows players trending in flex-specific contexts |
| Tight End | TE | |
| Defense | DEF / DST | Team defenses, not individual defensive players |
| Kicker | K | |

**Within each section:**
- Card contents: player headshot, name, position + team, trend indicator (▲/▼ or neutral), and a key stat or ranking note (e.g., "Consensus RB4", "Added to 210 lists this week", "ADP: 12.3").
- "See all [position]" link at the right end of each row navigates to `/app/players?position=QB` (or whichever position), filtered and sorted by trending activity.

**Data source:** Same trending player data as shelf section 5 (Community tab), filtered by position group.

**Guest access:** Fully accessible — player data is public. Sign-up CTAs appear on follow/add-to-list actions.

---

### Route Updates for Home Page

| Route | Page |
|-------|------|
| `/app` | Home — defaults to Community tab |
| `/app?tab=players` | Home — Players tab active (also accessible by clicking the tab) |

Tab state is reflected in the URL as a query param so links and back-navigation work correctly.

---

## My Lists Page (`/app/lists`)

My Lists is the user's personal list management hub. It shows every list they own and provides two distinct ways to view and interact with them.

---

### Page Structure

At the top of the page: the page title ("My Lists"), a **+ New List** button (primary action, top right), and two tabs — **Lists** (default) and **Side by Side**.

Tab state is reflected in the URL: `/app/lists?view=list` and `/app/lists?view=side-by-side`. Default is `list` if no param is present.

---

### Tab: Lists (default)

A single-column vertical list of all lists the user owns.

**Layout:**
- Each list is a full-width row showing: list title, position filter tag (if set), player count, last updated date, privacy badge (Private), and a favorite star toggle.
- The rows are dense but readable — similar to Notion's page list or a file manager view.
- Favorited lists show a filled star (★); unfavorited show an outline star on hover.

**Drag to reorder:**
- The user can drag any list row to a new position in the list. A drag handle (⠿) appears on the left side of each row on hover.
- This custom ordering is the user's personal sort — it persists server-side as an `order` field on the `lists` table (per user).
- Re-ordering is done via dnd-kit, consistent with the rest of the app.

**Sort override:**
- Above the list, a sort dropdown lets the user temporarily sort by: Custom Order (default, their drag order), Recently Updated, Recently Created, Most Players, Alphabetical.
- Selecting any sort other than Custom Order disables drag reordering for that session and shows a banner: "Sorted by [X] — drag to reorder returns to Custom Order."

**Empty state:**
- If the user has no lists: a centered illustration + "You haven't created any lists yet" + a prominent **Create your first list** button.

---

### Tab: Side by Side

Side by Side lets the user compare multiple lists simultaneously. Lists are displayed as vertical columns arranged horizontally. The user scrolls left and right to see all their lists; within each column, players scroll vertically.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  My Lists          [+ New List]                                         │
│  [Lists]  [Side by Side]                                                │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ← horizontal scroll →                                                  │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ My QB Tier   │  │ 2025 Sleepers│  │ Week 3 WRs   │  │ Waiver Wire│  │
│  │ 8 players    │  │ 12 players   │  │ 15 players   │  │ 6 players  │  │
│  │ ──────────── │  │ ──────────── │  │ ──────────── │  │ ──────────-│  │
│  │ 1. Mahomes   │  │ 1. J.Gibbs   │  │ 1. Jefferson │  │ 1. Achane  │  │
│  │ 2. Lamar     │  │ 2. Pennix    │  │ 2. St.Brown  │  │ 2. Conner  │  │
│  │ 3. Allen     │  │ 3. Odunze    │  │ 3. Hill      │  │ 3. Dobbs   │  │
│  │ 4. Stroud    │  │ 4. McConkey  │  │ 4. Lamb      │  │ ...        │  │
│  │ 5. Burrow    │  │ 5. Nabers    │  │ 5. Adams     │  │            │  │
│  │ ...          │  │ ...          │  │ ...          │  │            │  │
│  │              │  │              │  │              │  │            │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘  │
│                                                                    [+]  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Column specs:**
- Each list is rendered as a fixed-width column (default ~220px; consistent regardless of list title length).
- Column header: list title (truncated with ellipsis if too long), player count, and a ··· overflow menu (Edit list, Open list, Remove from view).
- Below the header: a numbered vertical stack of players. Each player row shows: rank number, player headshot (small, ~24px), name, and team abbreviation + position (e.g., "KC · QB").
- If a list has more players than fit in the viewport height, the column scrolls independently (each column is its own scrollable container).

**Horizontal scrolling:**
- The column container scrolls horizontally. On desktop: standard scroll + mouse wheel horizontal scroll (or trackpad swipe). On mobile: touch swipe.
- A subtle scroll shadow on the left/right edges of the container indicates more columns in that direction.

**List selection:**
- By default, Side by Side shows all of the user's lists, left to right in their custom order.
- A **Select Lists** button above the columns opens a picker where the user can choose which lists to include in the Side by Side view, and set their column order for this view.
- The selected columns for Side by Side are stored in `localStorage` — they don't affect the user's canonical list order.

**Add a new column:**
- A [+] button at the far right of the horizontal scroll area opens the "Create New List" flow, adding a new empty list as the rightmost column.

**Opening a list:**
- Clicking a list's column header title navigates to `/app/lists/[listId]` (the full list detail/edit view).

**Empty state:**
- If the user has no lists: same empty state as the Lists tab.
- If the user has exactly one list: Side by Side still renders with a single column and a prompt: "Add more lists to compare them side by side."

---

### Implementation Notes — My Lists

1. **Shared list order:** The drag order from the Lists tab and the default column order in Side by Side both derive from the same `order` field on the `lists` table. Changes in one tab are reflected in the other.

2. **Side by Side column selection:** Store the user's Side by Side column selection and order in `localStorage` (key: `fieldscout.sidebyside.columns`) as an array of list IDs. On load, filter out any IDs that no longer exist (deleted lists).

3. **Independent column scroll:** Each Side by Side column should be a flex column with `overflow-y: auto` and a fixed height equal to the viewport minus the header/tab bar. This lets each column scroll independently without affecting others.

4. **dnd-kit for row reorder:** Use dnd-kit's `SortableContext` with a vertical list strategy for the Lists tab drag reorder. On drag end, optimistically update the local order and fire a PATCH to `/api/lists/reorder` with the new order array.

5. **Favorite toggle:** The star toggle in the Lists tab writes to the database immediately (optimistic update). The sidebar Favorites section reads from the same data, so starring a list in My Lists makes it appear in the sidebar Favorites without a page reload.

---

## Layout Zones

### Root Layout (`src/app/layout.tsx`)
Applies to every route. Provides: HTML shell, global CSS, dark mode class strategy, React Query provider, Zustand provider, toast container.

### Auth Layout (`src/app/(auth)/layout.tsx`)
Applies to: `/login`, `/signup`, `/username`, `/forgot-password`, `/reset-password`. Provides: centered card layout, no nav, FIELDSCOUT wordmark at top.

### App Layout (`src/app/app/layout.tsx`)
Applies to: all `/app/*` routes. Provides: sidebar (desktop) or top bar + bottom tabs (mobile), main content area with max-width constraint.

### Public Profile Layout (`src/app/u/[username]/layout.tsx`)
Applies to: all `/u/[username]/*` routes. Provides: full-width SSR layout with minimal nav (wordmark + sign in/up buttons for guests, full top bar for authenticated users).

---

## Access Control Matrix

| Feature | Guest | Free | Pro |
|---------|-------|------|-----|
| View public lists, profiles, consensus | ✅ | ✅ | ✅ |
| Interact with guest Big Board | ✅ | — | — |
| Authenticated Big Board (season + weekly) | — | ✅ | ✅ |
| Create lists | — | ✅ unlimited public | ✅ unlimited public |
| Private lists | — | 1 | Unlimited |
| Like + comment | — | ✅ | ✅ |
| Follow users | — | ✅ | ✅ |
| Player Research | — | ✅ | ✅ |
| Save Research searches | — | — | ✅ |
| Custom scoring systems | — | 1 | Unlimited |
| Start or Sit — vote | — | ✅ | ✅ |
| Start or Sit — post | — | 1/week | Unlimited |
| Teams | — | 1 | Unlimited |
| Live Mode | — | ✅ (1 team) | ✅ (all teams) |
| Leagues — join | — | ✅ | ✅ |
| Leagues — create | — | — | ✅ |
| Multiple Big Boards (custom scoring) | — | — | ✅ |
| Pro badge on profile | — | — | ✅ |
| AI List Generation | — | — | ✅ |

---

## File Structure for Routes

Mapping every route to its file path in the Next.js App Router:

```
src/app/
├── layout.tsx                         # Root layout (providers, global CSS)
├── page.tsx                           # / — Guest home (Big Board + public feed)
│
├── (auth)/
│   ├── layout.tsx                     # Auth card layout
│   ├── login/page.tsx                 # /login
│   ├── signup/page.tsx                # /signup
│   ├── username/page.tsx              # /username
│   ├── forgot-password/page.tsx       # /forgot-password
│   └── reset-password/page.tsx        # /reset-password
│
├── auth/
│   └── callback/route.ts              # /auth/callback — Supabase OAuth handler
│
├── app/
│   ├── layout.tsx                     # App shell (sidebar/bottom tabs, auth guard)
│   ├── page.tsx                       # /app — Home feed
│   ├── explore/page.tsx               # /app/explore
│   │
│   ├── stats/
│   │   └── page.tsx                   # /app/stats — personal cred + accuracy dashboard
│   │
│   ├── weekly-ranks/
│   │   ├── page.tsx                   # /app/weekly-ranks — current week submission
│   │   └── history/page.tsx           # /app/weekly-ranks/history
│   │
│   ├── players/
│   │   ├── page.tsx                   # /app/players — player browser
│   │   └── [playerId]/page.tsx        # /app/players/[playerId] — player detail
│   │
│   ├── big-board/
│   │   ├── page.tsx                   # /app/big-board — Season-long Big Board
│   │   └── week/
│   │       └── [week]/page.tsx        # /app/big-board/week/[week]
│   │
│   ├── lists/
│   │   ├── page.tsx                   # /app/lists — My lists
│   │   ├── new/page.tsx               # /app/lists/new
│   │   └── [listId]/
│   │       └── page.tsx               # /app/lists/[listId] — List detail/edit
│   │
│   ├── research/
│   │   └── page.tsx                   # /app/research
│   │
│   ├── start-or-sit/
│   │   ├── page.tsx                   # /app/start-or-sit — Feed
│   │   ├── new/page.tsx               # /app/start-or-sit/new
│   │   └── [questionId]/page.tsx      # /app/start-or-sit/[questionId]
│   │
│   ├── teams/
│   │   ├── page.tsx                   # /app/teams — My teams
│   │   └── [teamId]/
│   │       ├── page.tsx               # /app/teams/[teamId] — Team detail
│   │       └── live/page.tsx          # /app/teams/[teamId]/live — Live Mode
│   │
│   ├── leagues/
│   │   ├── page.tsx                   # /app/leagues — My leagues
│   │   ├── new/page.tsx               # /app/leagues/new (Pro only)
│   │   └── [leagueId]/
│   │       ├── page.tsx               # /app/leagues/[leagueId] — League detail
│   │       └── manage/page.tsx        # /app/leagues/[leagueId]/manage
│   │
│   ├── settings/
│   │   ├── page.tsx                   # /app/settings
│   │   ├── profile/page.tsx           # /app/settings/profile
│   │   ├── scoring/page.tsx           # /app/settings/scoring
│   │   └── billing/page.tsx           # /app/settings/billing
│   │
│   └── notifications/page.tsx         # /app/notifications
│
├── u/
│   └── [username]/
│       ├── layout.tsx                 # Profile layout
│       ├── page.tsx                   # /u/[username] — Public profile
│       ├── big-board/
│       │   ├── page.tsx               # /u/[username]/big-board — Season Big Board
│       │   └── week/
│       │       └── [week]/page.tsx    # /u/[username]/big-board/week/[week]
│       └── lists/
│           └── [listSlug]/page.tsx    # /u/[username]/lists/[listSlug]
│
├── tag/
│   └── [tag]/page.tsx                 # /tag/[tag] — Tag feed (SSR)
│
├── consensus/
│   ├── page.tsx                       # /consensus — Community Big Board
│   └── [position]/page.tsx            # /consensus/rb, /consensus/wr, etc.
│
└── api/
    ├── lists/
    │   ├── route.ts                   # GET (my lists), POST (create)
    │   ├── reorder/route.ts           # PATCH (update custom sort order for My Lists page)
    │   └── [id]/
    │       ├── route.ts               # PATCH (update), DELETE (soft delete)
    │       ├── players/route.ts       # POST (add player)
    │       ├── players/[playerId]/route.ts  # DELETE (remove player)
    │       └── rank/route.ts          # PATCH (update order/tiers)
    ├── big-board/route.ts             # PATCH (save Big Board state)
    ├── teams/
    │   ├── route.ts                   # POST (create from list)
    │   └── [id]/lineup/route.ts       # PATCH (set weekly lineup)
    ├── leagues/route.ts               # POST (create league)
    ├── start-or-sit/
    │   ├── route.ts                   # POST (create question)
    │   └── [id]/vote/route.ts         # POST (cast vote)
    ├── follows/route.ts               # POST (follow), DELETE (unfollow)
    ├── likes/route.ts                 # POST (like), DELETE (unlike)
    ├── stripe/
    │   ├── checkout/route.ts          # POST (create checkout session)
    │   └── webhook/route.ts           # POST (Stripe webhook handler)
    └── ai/
        └── list-gen/route.ts          # POST (generate list with Claude)
```

---

## Middleware Logic (`src/middleware.ts`)

The middleware runs on every non-static request and handles auth routing:

```
Request comes in
  ↓
Is it a protected route (/app/*)?
  → YES, no session → redirect to /login?redirect={original-path}
  → YES, has session → allow through
  ↓
Is it an auth page (/login, /signup, /forgot-password)?
  → YES, has session, not /username or /reset-password → redirect to /app
  → NO → allow through
  ↓
Is /username?
  → Has session → allow (needed for post-signup flow)
  → No session → redirect to /login
```

**Matcher:** All routes except `_next/static`, `_next/image`, `favicon.ico`, and static assets.

---

## Navigation Component Files

| Component | Path | Purpose |
|-----------|------|---------|
| `AppShell` | `src/components/layout/app-shell.tsx` | Root wrapper: sidebar + top bar + content area. Manages sidebar width state. |
| `Sidebar` | `src/components/layout/sidebar.tsx` | Full sidebar including resize handle, collapse toggle, nav items, and bottom section |
| `SidebarNav` | `src/components/layout/sidebar-nav.tsx` | The nav item list (main items + Lists sub-sections) |
| `SidebarListsSection` | `src/components/layout/sidebar-lists-section.tsx` | Expandable Favorites + Recent sub-sections under Lists |
| `SidebarHistory` | `src/components/layout/sidebar-history.tsx` | History expandable panel pinned to sidebar bottom |
| `SidebarResizeHandle` | `src/components/layout/sidebar-resize-handle.tsx` | Draggable right-edge resize handle |
| `NavItem` | `src/components/layout/nav-item.tsx` | Single nav row: icon + label + optional badge. Supports collapsed (icon-only + tooltip) and expanded states. |
| `TopNav` | `src/components/layout/top-nav.tsx` | Top bar across all app pages (desktop: wordmark + notification bell + user avatar; mobile: full top bar) |
| `BottomTabs` | `src/components/layout/bottom-tabs.tsx` | Mobile bottom tab bar |
| `MoreSheet` | `src/components/layout/more-sheet.tsx` | "More" bottom sheet on mobile |
| `UserNav` | `src/components/layout/user-nav.tsx` | Avatar dropdown in top bar |
| `GuestBanner` | `src/components/layout/guest-banner.tsx` | "Save your rankings" strip for guests |
| `GuestSignupPrompt` | `src/components/layout/guest-signup-prompt.tsx` | Inline modal prompt on gated actions |

---

## Key Implementation Notes

1. **Route groups:** `(auth)` and the plain `app/` directory are both used. The auth pages are grouped in `(auth)` for layout isolation. The app shell uses the real `app/` directory (maps to `/app/*`) rather than a route group to keep the URL clean.

2. **Server vs Client for nav components:** All sidebar and nav components are client components — they need auth state, active route detection, and drag interaction. `TopNav` is a client component that composes them.

3. **Active state detection:** Use Next.js `usePathname()` in nav components to highlight the active route. Nested items (Lists sub-items) should highlight both the child item and the parent "Lists" row.

4. **Sidebar width state:** Store the user's sidebar width preference and collapsed state in `localStorage` (key: `fieldscout.sidebar.width` and `fieldscout.sidebar.collapsed`). Read on mount to avoid layout shift. The Zustand `ui-store` should expose `sidebarWidth`, `setSidebarWidth`, `isSidebarCollapsed`, and `toggleSidebarCollapsed`.

5. **Sidebar resize implementation:** Use a `mousedown` → `mousemove` → `mouseup` drag handler on the resize handle. During drag, update `sidebarWidth` in state (which drives the CSS width via an inline style). Clamp between 180px and 400px. If the user drags below 180px, snap to collapsed (52px) automatically. Use `pointer-capture` for smooth drag even if the cursor leaves the handle.

6. **Sidebar collapse animation:** Animate the width transition when the collapse toggle is clicked (CSS `transition: width 200ms ease`). Avoid animating on initial mount (add the transition class only after first render). In collapsed mode, icon tooltips use the Radix `Tooltip` component from shadcn/ui — delay 400ms, position `side="right"`.

7. **History store:** History is client-side only. Implement as a Zustand store slice that writes to `localStorage` (key: `fieldscout.history`). On every page navigation (via `usePathname` effect), push the current route + metadata (type, name, avatar/headshot URL) to the front of the array. Cap at 20 entries. The sidebar `SidebarHistory` and the Home "Recently Viewed" shelf both read from this store.

8. **Favorites:** Favoriting a list writes to the `lists` table (add an `is_favorited` boolean or a separate `list_favorites` junction table — TBD in schema). The sidebar `SidebarListsSection` reads the user's favorited lists via a React Query hook.

9. **Home tab state via URL:** The Community/Players tab on Home is driven by `?tab=community` / `?tab=players`. Use `useSearchParams()` in the page component. Default to `community` if no param is present. Use `router.replace` (not `push`) when switching tabs so the tab switch doesn't add a back-stack entry.

10. **Home shelf sections as a config array:** Define the shelf sections (Recently Viewed, Trending Users, etc.) as an ordered config array in a constants file. This makes it trivial to reorder, hide, or A/B test sections without touching component code. Each section entry specifies its `id`, `title`, `dataHook`, and `cardComponent`.

11. **Pro gating:** The Leagues nav item shows a ✦ Pro badge for free users. Clicking it navigates to `/app/leagues` where the page surfaces the upgrade prompt inline.

12. **Guest state transfer:** On sign-up, the `(auth)/username/page.tsx` completion triggers the guest state transfer function before navigating to `/app`. This must run atomically — if the transfer fails, show an error but still complete account creation.

13. **Week detection:** The Big Board "Week N" sidebar item should show the current NFL week number (or hide the Weekly sub-item entirely during the offseason). Pull from the `nfl_games` table or a config constant.

14. **Redirects after login:** The middleware sets `?redirect={path}` on the login URL. After successful authentication, read this param and navigate there instead of the default `/app`.
