# Claude Code Prompts: Phase-by-Phase Build Guide

> These are copy-paste prompts for Cursor Composer (Agent mode). Each one corresponds to a phase from the build roadmap. Work through them in order, one task at a time. After each task, review the output, test in the browser, and iterate before moving to the next.

---

## How to Use These Prompts

1. Open your `fantasy-app/` folder in Cursor
2. Open Composer with `Cmd+I` and make sure it is set to **Agent** mode
3. Copy the prompt for your current task
4. Paste it into Composer and let it run — it will create files, install packages, and run commands
5. Review the result, test in the browser, and ask for fixes if needed
6. When a task is done, ask: *"Commit these changes with a good message"*
7. Move to the next task

**Important:** Work through tasks one at a time. Do not paste an entire phase at once.

---

## Phase 0: Foundation

### Task 0.1 — Initialize the Project

```
I'm building a fantasy football app called Hadouken. Please read CLAUDE.md before doing anything — it contains the full stack conventions and patterns you must follow.

Set up the project:

1. Create a new Next.js 14 app using App Router (NOT Pages Router) at the root of this directory
2. Configure TypeScript in strict mode
3. Install and configure Tailwind CSS with dark mode support (class strategy)
4. Install and set up shadcn/ui — initialize it and add these base components: button, card, input, badge, dialog, dropdown-menu, toast, toaster, skeleton, avatar, tabs, separator, popover, command, sheet
5. Set up ESLint and Prettier with reasonable defaults
6. Create the full folder structure:
   src/app/           → Routes and layouts only
   src/components/    → Organized by feature: ui/, layout/, lists/, players/, research/, teams/, shared/
   src/lib/           → Third-party client setup: supabase/, stripe/
   src/hooks/         → One hook per file
   src/stores/        → Zustand stores
   src/types/         → TypeScript types and Zod schemas
   src/utils/         → Pure utility functions
   scripts/           → One-off data pipeline scripts
   supabase/migrations/ → Database migrations
7. Create .env.local template (.env.example) with these variables:
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   NEXT_PUBLIC_APP_URL=http://localhost:3000
8. Install additional dependencies: @tanstack/react-query, zustand, zod, @supabase/supabase-js, @supabase/ssr, lucide-react, date-fns, clsx, tailwind-merge

Brand: app name is "Hadouken", primary color is Spotify green (#1DB954), app background is #121212, font is Inter, dark mode only. Read docs/06-DESIGN-SYSTEM.md for the full design system before building any UI.
```

### Task 0.2 — Supabase Setup + Database Schema

```
Set up Supabase and the initial database schema for Hadouken. Read CLAUDE.md and docs/03-DATA-MODEL.md before starting.

1. Create the Supabase client utilities:
   - src/lib/supabase/client.ts — browser client using createBrowserClient from @supabase/ssr
   - src/lib/supabase/server.ts — server client using createServerClient from @supabase/ssr (async, uses cookies)
   - src/middleware.ts — Next.js middleware that refreshes Supabase auth session on every request

2. Create supabase/migrations/001_initial_schema.sql with these tables:

   profiles:
   - id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
   - username TEXT UNIQUE NOT NULL (3-30 chars, alphanumeric + underscores only)
   - display_name TEXT
   - avatar_url TEXT
   - bio TEXT (max 300 chars)
   - cred_score INTEGER DEFAULT 0
   - is_pro BOOLEAN DEFAULT FALSE
   - stripe_customer_id TEXT UNIQUE
   - subscription_status TEXT DEFAULT 'free'
   - follower_count INTEGER DEFAULT 0
   - following_count INTEGER DEFAULT 0
   - created_at TIMESTAMPTZ DEFAULT NOW()
   - updated_at TIMESTAMPTZ DEFAULT NOW()

   players (read-only, populated by sync scripts):
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - sleeper_id TEXT UNIQUE
   - full_name TEXT NOT NULL
   - first_name TEXT
   - last_name TEXT
   - position TEXT (QB/RB/WR/TE/K/DEF)
   - team TEXT
   - headshot_url TEXT
   - status TEXT DEFAULT 'active' (active/injured/ir/out/questionable/doubtful/suspended)
   - experience_years INTEGER DEFAULT 0
   - bye_week INTEGER
   - adp DECIMAL
   - search_name TEXT (lowercased, no spaces — for fuzzy search)
   - created_at TIMESTAMPTZ DEFAULT NOW()
   - updated_at TIMESTAMPTZ DEFAULT NOW()

   player_stats:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - player_id UUID REFERENCES players(id) ON DELETE CASCADE
   - season INTEGER NOT NULL
   - week_number INTEGER (NULL for season totals)
   - is_season_total BOOLEAN DEFAULT FALSE
   - completions INTEGER DEFAULT 0
   - attempts INTEGER DEFAULT 0
   - passing_yards INTEGER DEFAULT 0
   - passing_tds INTEGER DEFAULT 0
   - interceptions INTEGER DEFAULT 0
   - carries INTEGER DEFAULT 0
   - rushing_yards INTEGER DEFAULT 0
   - rushing_tds INTEGER DEFAULT 0
   - targets INTEGER DEFAULT 0
   - receptions INTEGER DEFAULT 0
   - receiving_yards INTEGER DEFAULT 0
   - receiving_tds INTEGER DEFAULT 0
   - fumbles_lost INTEGER DEFAULT 0
   - fantasy_points_standard DECIMAL DEFAULT 0
   - fantasy_points_ppr DECIMAL DEFAULT 0
   - is_live BOOLEAN DEFAULT FALSE
   - source TEXT DEFAULT 'nflverse'
   - UNIQUE(player_id, season, week_number)

   scoring_systems:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - name TEXT NOT NULL
   - description TEXT
   - owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE (NULL for platform defaults)
   - is_platform_default BOOLEAN DEFAULT FALSE
   - rules JSONB NOT NULL
   - created_at TIMESTAMPTZ DEFAULT NOW()

3. RLS policies:
   - profiles: public read, owner write
   - players: public read (no auth required — needed for guest experience)
   - player_stats: public read
   - scoring_systems: platform defaults are public read; custom systems readable by owner only

4. Database trigger: when a new user signs up (insert into auth.users), auto-create their profile row with a generated username placeholder.

5. Seed file supabase/seed.sql: insert the 2 platform default scoring systems:
   - ESPN Standard: passing TD=4pts, passing yard=0.04pts, rushing TD=6pts, rushing yard=0.1pts, receiving TD=6pts, receiving yard=0.1pts, reception=0pts, fumble lost=-2pts, interception=-2pts
   - ESPN PPR: same as Standard but reception=1pt

6. Generate TypeScript types: run `npx supabase gen types typescript --local > src/types/database.ts`

Reference docs/03-DATA-MODEL.md for the full schema including any fields I may have omitted.
```

### Task 0.3 — Authentication

```
Build the authentication flow for Hadouken. Email/password only — no OAuth. Read CLAUDE.md before starting.

1. Auth pages:
   - app/(auth)/login/page.tsx — email + password login form
   - app/(auth)/signup/page.tsx — email, password, confirm password
   - app/(auth)/username/page.tsx — username selection shown after signup (if profile has no username yet)
   - app/(auth)/forgot-password/page.tsx — email input, sends Supabase password reset email
   - app/(auth)/reset-password/page.tsx — new password + confirm (reached via link in reset email)

2. Username selection page:
   - Input with real-time availability check (debounced 400ms, queries profiles table)
   - Shows green checkmark when available, red X when taken
   - Validates: 3-30 chars, alphanumeric + underscores only, starts with a letter
   - On submit: update profile username, redirect to /explore

3. Password reset flow:
   - Forgot password page calls supabase.auth.resetPasswordForEmail() with redirect URL pointing to /auth/reset-password
   - Reset password page calls supabase.auth.updateUser({ password: newPassword })
   - Show success toast and redirect to /login after reset

4. Email verification:
   - Supabase sends a confirmation email on signup automatically (configure in Supabase dashboard: Authentication → Email Templates)
   - After signup, show a "Check your email to confirm your account" message before redirecting
   - Unverified users can still browse but should be prompted to verify before submitting rankings

5. Auth middleware (already created in Task 0.2): protect all /app/* routes. Redirect unauthenticated users to /login. Redirect authenticated users away from /login and /signup.

6. src/hooks/use-auth.ts — custom hook exposing: user, session, profile, isLoading, signOut

7. Zustand store src/stores/auth-store.ts: stores current profile data, updated after login/signup and profile edits

8. Nav user menu: avatar + dropdown with "My Profile", "Settings", "Sign Out"

Design: auth pages should be centered cards on a dark background with the Hadouken wordmark above. Clean, minimal, sports-energy. Mobile-first.

Note on admin: Supabase dashboard (supabase.com → your project) is used for all admin tasks during early development — viewing users, editing rows, running SQL for usage stats, manually flipping is_pro=true, removing content. No custom admin panel needed until the user base justifies it.
```

### Task 0.4 — NFL Player Data Pipeline

```
Set up the NFL player data pipeline for Hadouken. This has three layers. Read CLAUDE.md before starting.

--- LAYER 1: Sleeper API (player profiles) ---

1. Create src/lib/sports-data/sleeper.ts — typed client for the Sleeper API:
   - fetchAllPlayers(): GET https://api.sleeper.app/v1/players/nfl (no API key needed)
   - mapSleeperPlayerToDb(): maps Sleeper fields to our players table schema
   - Sleeper headshot URL format: https://sleepercdn.com/content/nfl/players/thumb/{sleeper_id}.jpg

2. Create scripts/sync-players.ts:
   - Fetches all active NFL players from Sleeper (active=true, position in QB/RB/WR/TE/K/DEF)
   - Maps and upserts into players table (conflict on sleeper_id)
   - Logs: "Synced [N] players"
   - Add npm script: "sync:players": "npx tsx scripts/sync-players.ts"

--- LAYER 2: nflverse historical stats ---

3. Create scripts/load-historical-stats.py using nfl_data_py:
   - Loads weekly stats for seasons 2022–2025 into player_stats table
   - Maps nflverse column names to our schema
   - Upserts in batches of 500 (conflict on player_id + season + week_number)
   - Install: pip install nfl_data_py supabase pandas --break-system-packages
   - Add npm script: "sync:history": "python3 scripts/load-historical-stats.py"

--- LAYER 3: mock current-season stats ---

4. Create scripts/generate-mock-current-stats.ts:
   - Generates plausible 2026 season stats for weeks 1-4 using players already in DB
   - Per-position stat ranges: QB (280-380 pass yds, 1-3 TDs), RB (70-110 rush yds, 0-1 TDs, 3-6 rec), WR (60-110 rec yds, 0-1 TDs, 4-8 rec), TE (30-70 rec yds, 0-1 TDs, 2-5 rec)
   - Marks all records: source='mock', is_live=false
   - Add npm script: "sync:mock-stats": "npx tsx scripts/generate-mock-current-stats.ts"

--- PLAYER SEARCH ---

5. Create app/api/players/search/route.ts:
   - Query params: q (search string), position (optional), limit (default 20)
   - Searches full_name with ILIKE %q% OR search_name ILIKE
   - Returns: id, sleeper_id, full_name, position, team, headshot_url, status, adp

6. Create src/components/players/player-search.tsx:
   - Autocomplete using shadcn/ui Command component
   - Shows headshot, name, team badge, position pill in results
   - Injury status badge if applicable
   - Debounced 300ms
   - Loading skeleton while searching

Run scripts in this order after setup:
1. npm run sync:players
2. npm run sync:history (takes a few minutes)
3. npm run sync:mock-stats
```

### Task 0.5 — App Shell

```
Build the app shell for Hadouken. Read CLAUDE.md before starting.

1. Root layout app/layout.tsx:
   - Inter font
   - Dark mode class on html element by default
   - ReactQueryProvider and Toaster wrappers

2. Authenticated app layout app/(app)/layout.tsx:
   - Desktop: fixed left sidebar (240px wide)
     Nav items: Home, Big Board, My Lists, Rankings, Research, Teams, Settings
     Bottom of sidebar: user avatar, display name, cred score badge, sign out
   - Mobile: bottom tab bar with icons for: Home, Lists, Big Board, Research, Profile
   - Top bar (mobile only): Hadouken logo + global search icon
   - Active route highlighting

3. Logged-out landing page app/page.tsx:
   - Hero: "Rank Players. Earn Cred. Win Your League."
   - Subtext: "Hadouken is the fantasy football app for players who actually know ball."
   - Two CTAs: "Start Ranking Free" (→ /signup) and "See How It Works" (→ scrolls to features)
   - Feature section: 3 cards — Build Your Big Board, Earn Cred for Accuracy, Draft With Confidence
   - Clean, dark, sports-energy. Electric blue accents. Mobile responsive.

4. Basic placeholder pages (just shell + heading, content comes in Phase 1):
   - app/(app)/explore/page.tsx — "Explore"
   - app/(app)/big-board/page.tsx — "My Big Board"
   - app/(app)/lists/page.tsx — "My Lists"
   - app/(app)/research/page.tsx — "Research"
   - app/(app)/teams/page.tsx — "Teams"

5. Global search bar in top nav (desktop):
   - Opens a command palette (shadcn Command in a Dialog)
   - Searches players, lists, users
   - Keyboard shortcut: Cmd+K
   - Results grouped by type: Players, Lists, Users
   - Wires up to the /api/players/search and /api/search endpoints

The whole app should feel like a premium sports product. Read docs/06-DESIGN-SYSTEM.md for the full design spec before building anything — colors, typography, component patterns, and layout are all defined there.
```

---

## Phase 1: MVP

> This is the launch. When Phase 1 is done, real users can sign up, build their draft rankings, share them, and engage with the community. The north star: *a user opens Hadouken before their fantasy draft, builds their rankings, and uses them as a cheat sheet while on the clock.*

### Task 1.1 — Lists Database & API

```
Build the database and API layer for player lists in Hadouken. Read CLAUDE.md and docs/03-DATA-MODEL.md before starting.

1. Create supabase/migrations/002_lists.sql:

   lists table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE
   - title TEXT NOT NULL
   - slug TEXT NOT NULL
   - description TEXT
   - position_filter TEXT (QB/RB/WR/TE/K/DEF/FLEX — NULL means all positions)
   - hide_order BOOLEAN DEFAULT FALSE (TRUE = unranked; Big Board can NEVER be TRUE)
   - tiers_enabled BOOLEAN DEFAULT FALSE
   - is_big_board BOOLEAN DEFAULT FALSE
   - is_private BOOLEAN DEFAULT FALSE
   - comments_enabled BOOLEAN DEFAULT TRUE
   - player_count INTEGER DEFAULT 0
   - like_count INTEGER DEFAULT 0
   - view_count INTEGER DEFAULT 0
   - deleted_at TIMESTAMPTZ (soft delete)
   - created_at TIMESTAMPTZ DEFAULT NOW()
   - updated_at TIMESTAMPTZ DEFAULT NOW()
   - UNIQUE(owner_id, slug)

   list_players table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - list_id UUID REFERENCES lists(id) ON DELETE CASCADE
   - player_id UUID REFERENCES players(id) ON DELETE CASCADE
   - position INTEGER NOT NULL (1-based, order within list — new players always get MAX(position)+1)
   - tier TEXT (S/A/B/C/D/F — NULL if tiers not set)
   - rank_in_tier INTEGER
   - overall_rank INTEGER
   - added_at TIMESTAMPTZ DEFAULT NOW()
   - UNIQUE(list_id, player_id)

   list_likes table:
   - list_id UUID REFERENCES lists(id) ON DELETE CASCADE
   - user_id UUID REFERENCES profiles(id) ON DELETE CASCADE
   - created_at TIMESTAMPTZ DEFAULT NOW()
   - PRIMARY KEY(list_id, user_id)

   list_comments table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - list_id UUID REFERENCES lists(id) ON DELETE CASCADE
   - author_id UUID REFERENCES profiles(id) ON DELETE CASCADE
   - parent_id UUID REFERENCES list_comments(id) ON DELETE CASCADE (NULL for top-level)
   - body TEXT NOT NULL (max 1000 chars)
   - deleted_at TIMESTAMPTZ
   - created_at TIMESTAMPTZ DEFAULT NOW()

   tags table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - name TEXT UNIQUE NOT NULL
   - slug TEXT UNIQUE NOT NULL
   - is_system_tag BOOLEAN DEFAULT FALSE
   - use_count INTEGER DEFAULT 0

   list_tags junction:
   - list_id UUID REFERENCES lists(id) ON DELETE CASCADE
   - tag_id UUID REFERENCES tags(id) ON DELETE CASCADE
   - PRIMARY KEY(list_id, tag_id)

2. RLS policies: owner full access, public read for non-private non-deleted lists.

3. Triggers:
   - Auto-update lists.player_count on list_players insert/delete
   - Auto-update lists.like_count on list_likes insert/delete
   - Auto-update tags.use_count on list_tags insert/delete
   - Update handle_new_user trigger to auto-create a Big Board list for each new user (is_big_board=TRUE, title='My Big Board', slug='big-board', hide_order=FALSE)

4. Seed system tags: Sleepers, Busts, Breakouts, Bounceback, Must-Start, Avoid, Deep Cuts, Rookies, Veterans, Dynasty, Redraft, Best Ball, DFS, Superflex, PPR, Half-PPR, Standard, TE Premium, Draft Day, Waiver Wire, Trade Targets, Buy-Low, Sell-High, Week 1 through Week 18

5. API routes:
   - POST /api/lists — create list (Zod validation: title, description?, position_filter?, tags?, is_private?, comments_enabled?)
   - GET /api/lists — current user's lists (exclude Big Board, return paginated)
   - GET /api/lists/big-board — current user's Big Board
   - GET /api/lists/[id] — single list with players and tags
   - PATCH /api/lists/[id] — update (block rename/delete on Big Board)
   - DELETE /api/lists/[id] — soft delete (block on Big Board)
   - POST /api/lists/[id]/players — add player (new players go to bottom: position = MAX + 1). Return 409 with friendly message on duplicate.
   - DELETE /api/lists/[id]/players/[playerId] — remove player
   - PATCH /api/lists/[id]/players/reorder — update positions for all players (full array of {playerId, position})
   - POST /api/lists/[id]/like — toggle like (optimistic-friendly)
   - POST /api/lists/[id]/duplicate — duplicate list for current user
   - GET /api/lists/[id]/comments — paginated comments
   - POST /api/lists/[id]/comments — add comment
   - DELETE /api/lists/[id]/comments/[commentId] — soft delete (author or list owner)
   - GET /api/tags — all available tags
   - GET /api/tags/[slug] — tag info + public lists with that tag

6. React Query hooks in src/hooks/:
   - use-lists.ts: useLists, useList, useBigBoard, useCreateList, useUpdateList, useDeleteList, useAddPlayer, useRemovePlayer, useReorderPlayers, useToggleLike, useDuplicateList
   - use-tags.ts: useTags, useTagFeed
   - use-comments.ts: useComments, useAddComment, useDeleteComment

Business rules to enforce in API:
- Big Board: cannot be deleted, cannot be made private, slug is permanent
- Free users: max 1 private list (check count before allowing is_private=true)
- Max 5 tags per list
- Players always added to the bottom (no auto-sort)
```

### Task 1.2 — Lists UI

```
Build the list UI for Hadouken. Read CLAUDE.md before starting. Use React Query hooks from Task 1.1.

1. My Lists page (app/(app)/lists/page.tsx):
   - "My Big Board" entry pinned at top with a distinctive look (star icon, subtle gradient border)
   - Grid of list cards below (2 col mobile, 3 col desktop)
   - Each card: title, description preview, player count, like count, position filter badge if set, private badge if private, up to 3 tag chips
   - "Create New List" button (top right, prominent)
   - Sort: Recent / Most Liked / Alphabetical
   - Loading: skeleton cards

2. Create List flow (app/(app)/lists/new/page.tsx):
   - Title (required), description (optional)
   - Position filter dropdown: All / QB / RB / WR / TE / K / DEF
   - Tag selector: searchable dropdown (system + custom tags, max 20 chars for custom). Max 5. Shows selected as removable chips.
   - Toggle: "Hide ranking order" (default OFF — lists are ranked by default)
   - Toggle: "Allow comments" (default ON)
   - Toggle: "Private" — if free user already has 1 private list, show upgrade prompt instead
   - On submit: create via API, redirect to list detail

3. List Detail page (app/(app)/lists/[id]/page.tsx):
   - Header: title, description, tags, owner avatar + username, like button (optimistic), share button (copies URL), edit button (owner only)
   - Player search bar at top (use PlayerSearch component) to add players — new players go to bottom
   - Player rows: rank number (if hide_order=false), headshot, name, team, position, injury status badge, remove button (owner only)
   - Smart Order button (owner only): dropdown with Sort by Fantasy Points / Projected Points / Consensus Rank / ADP. On select: reorders all players instantly and saves. Toast: "Reordered by [criterion]"
   - Comment section at bottom (if comments_enabled): comment input, threaded comments (1 level), delete on own comments
   - If hide_order=TRUE: don't show rank numbers, disable drag-and-drop

4. Drag-and-drop reordering:
   - Install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
   - Players are draggable. Handle on left side of each row.
   - After drag ends: call reorder API with new positions array
   - Works on touch (mobile) using dnd-kit touch sensor

5. Public list page (app/u/[username]/lists/[slug]/page.tsx):
   - Server-rendered for SEO
   - OG meta tags: title, description, player count
   - Read-only for non-owners
   - 404 if private and viewer is not owner

6. Tag feed pages (app/tag/[slug]/page.tsx):
   - Server-rendered, SEO-optimized
   - Header: tag name, list count
   - Grid of public lists with this tag
   - Sort: Recent / Most Popular

Styling: player rows should be clean and dense — circular headshot, bold name, muted team+position. Tag chips use soft colored backgrounds (deterministic color from tag slug). Drag handles are subtle until hovered.
```

### Task 1.3 — Big Board

```
Build the full Big Board feature for Hadouken. Read CLAUDE.md and the Big Board section of docs/01-PRD.md (F2A) before starting.

Key Big Board rules to understand before writing any code:
- The Big Board is a WORKSPACE. Changes are not saved until the user hits "Update Big Board".
- If user leaves without saving, the board reverts to the last saved state.
- Players always go to the BOTTOM when added — no auto-sort on add.
- The Big Board can NEVER be deleted, made private, or set to hide_order=TRUE.
- Every "Update Big Board" saves a snapshot for accuracy tracking and cred.

1. Database additions (new migration supabase/migrations/003_big_board.sql):
   - big_board_snapshots table:
     id, user_id, snapshot_data JSONB (full ordered player list at save time), saved_at TIMESTAMPTZ
     — stores a record every time user hits "Update Big Board"
   - big_board_weekly table:
     id, user_id, week_number INTEGER (1-18), season INTEGER, list_id UUID (FK to lists), created_at
     — one row per user per week per season; list_id points to a lists row with is_big_board=TRUE

2. My Big Board page (app/(app)/big-board/page.tsx):
   Working state management:
   - On page load: fetch saved Big Board state into local React state (the "working state")
   - All edits (add, remove, reorder) modify only the working state — NOT saved to DB
   - "Update Big Board" button: saves working state to DB (updates list_players, creates big_board_snapshots entry). Shows "Saving..." then "Saved ✓"
   - "Discard Changes" button (appears only when working state differs from saved): resets working state to saved state
   - Subtle dirty indicator ("Unsaved changes") when working state differs from saved state

   UI:
   - Configurable size: gear icon → "Board Size" slider: 10 to 300 players (default 25). Saved per user.
   - Player rows: rank number, headshot, name, position, team, drag handle
   - Player search at top to add players (go to bottom)
   - Smart Order button: sort by Fantasy Points / Projected Points / Consensus Rank / ADP — applies to working state only
   - "Create List" button: opens position filter dialog → forks current working view into a new standalone list (does NOT save or affect the Big Board). Redirect to new list after creation.
   - Tiers toggle: enable/disable tier view mode (see Task 1.5)

   Week selector (shown once NFL season begins — controlled by a season_config table or env var):
   - Horizontal tab row at top: "Season" tab + Week 1 through Week 18
   - Season tab = the season-long Big Board
   - Each Week tab = that week's Big Board (pre-populated from previous week if user hasn't edited it)
   - Only current week tab is editable; future weeks are locked (grayed out)
   - Past weeks are read-only

3. Change history + rollback (accessible via "History" button in Big Board header):
   - Shows a timeline of all big_board_snapshots for this user
   - Each entry: timestamp, "X players moved" summary
   - "Restore" button on each entry: loads that snapshot into working state (user still needs to hit Update Big Board to make it official)

4. Public Big Board page (app/u/[username]/big-board/page.tsx):
   - Server-rendered for SEO
   - Read-only view of saved Big Board
   - OG tags: "@{username}'s Big Board — Hadouken"

5. API routes needed:
   - GET /api/big-board — get current user's saved Big Board state
   - POST /api/big-board/save — save current working state (creates snapshot, updates list_players)
   - GET /api/big-board/history — get all snapshots for current user
   - POST /api/big-board/restore/[snapshotId] — load snapshot into working state response (does not save — client applies it)
   - GET /api/big-board/week/[weekNumber] — get (or auto-generate) weekly Big Board for a given week
```

### Task 1.4 — Tier View Mode

```
Build the tier view mode for Hadouken lists and Big Board. Read the tier view section of docs/01-PRD.md (F2) before starting.

Key concept: tiers are a VIEW MODE OVERLAY. They do not change the underlying player order. The player order (position field in list_players) is always the source of truth. Tiers only change how the list is visually presented.

1. Tier data:
   - Tiers are assigned per-player in list_players.tier (S/A/B/C/D/F). NULL = unassigned.
   - Enabling tiers on a list does not auto-assign tiers — players start unassigned.
   - Tier colors: S=gold (#FFD700), A=green (#22C55E), B=blue (#3B82F6), C=yellow (#EAB308), D=orange (#F97316), F=red (#EF4444)

2. Tier toggle: "Tiers" button in list/Big Board header. Toggles tiers_enabled on the list (saved to DB). When OFF: standard list view. When ON: tier view mode.

3. Tier view — List mode (default):
   - Players grouped into tier sections (S at top, F at bottom)
   - Each section has a colored tier label on the LEFT (large letter: S, A, B, C, D, F)
   - Within each section, players shown as rows in their position order
   - Unassigned players shown at the bottom in a gray "Unranked" section
   - Owner can drag players between tier sections (updates tier field)
   - Owner can click a player's tier badge to cycle through tiers (S→A→B→C→D→F→null)

4. Tier view — Card mode:
   - Toggle between List mode and Card mode via a view switcher icon in the toolbar
   - Players in each tier displayed as a horizontal row of cards (left = highest ranked within that tier)
   - Cards show: headshot, name, position, team
   - Tier label on the left side of each row

5. Both views must work on mobile. Card mode uses a horizontally scrollable row per tier on mobile.

6. Non-owners can see tiers in read-only mode but cannot edit tier assignments.

7. Zustand store for view state (src/stores/list-view-store.ts):
   - viewMode: 'list' | 'card' (persisted to localStorage per list)
   - tiersEnabled: mirrors DB value but cached locally

Apply this to both regular lists AND the Big Board.
```

### Task 1.5 — Home Feed

```
Build the home feed for Hadouken. Read docs/01-PRD.md (F5) before starting.

The home feed is a simple chronological stream of all public lists created or updated by any user on the platform. No algorithm — newest first. This is the default logged-in landing page.

1. API route GET /api/feed:
   - Returns paginated public lists (not deleted, not private) sorted by updated_at DESC
   - Each item includes: list id, title, slug, description, owner (username, avatar, cred_score), position_filter, tags (up to 3), player_count, like_count, comment_count, updated_at
   - Pagination: cursor-based (use updated_at + id as cursor)
   - Page size: 20

2. Home feed page (app/(app)/explore/page.tsx — rename to home feed):
   - Infinite scroll using React Query's useInfiniteQuery
   - Feed items are list cards (see below)
   - Loading skeleton for initial load (6 placeholder cards)
   - "Load more" or auto-load on scroll
   - Empty state: "Nothing here yet. Be the first to create a list!"

3. List card component (src/components/lists/list-card.tsx):
   - Owner avatar (circular, 32px) + username + cred tier badge + time since posted ("2h ago", "3d ago")
   - List title (bold, large)
   - Description preview (1 line, truncated)
   - Position filter badge if set (e.g., "RBs only")
   - Up to 3 tag chips
   - Bottom row: player count, like button (with count, optimistic toggle), comment icon (with count, links to list detail)
   - Clicking card title or body → list detail page

4. Guest feed:
   - Logged-out users visiting / or /explore see the same feed (public content, no personalization)
   - Show a sticky "Sign up to start building your Big Board →" banner at the bottom of the page (not a modal, not a blocker)

5. Navigation update:
   - Rename "Explore" nav item to "Home" with a home icon
   - This page is the default redirect after login
```

### Task 1.6 — Guest Experience

```
Build the anonymous / guest experience for Hadouken. Read the F0 section of docs/01-PRD.md before starting.

This is HIGH PRIORITY. Users should be able to start using the app without signing up.

1. Guest Big Board (localStorage-backed):
   - When a user visits hadouken.gg without being logged in, redirect them to /big-board (not a landing page)
   - The guest Big Board works exactly like the real Big Board UI (add players, reorder, Smart Order, tiers) but is stored in localStorage under the key 'hadouken_guest_big_board'
   - Guest Big Board state shape: { players: [{playerId, position, tier}], savedAt: ISO string, size: number }
   - No "Update Big Board" button for guests — their changes auto-save to localStorage on every action (no explicit save needed since it's local only)
   - Guest can add players, reorder them, enable tiers, use Smart Order — full functionality

2. Guest list creation:
   - Guests can also create lists, stored in localStorage under 'hadouken_guest_lists'
   - Up to 3 guest lists allowed (to avoid bloat)

3. Persistent sign-up CTA (non-blocking):
   - A slim persistent banner at the top of the page (not a modal): "Save your rankings and track your accuracy — [Create free account]"
   - Dismissible per session (stored in sessionStorage)
   - CTA links to /signup with a `?transfer=true` query param

4. State transfer on signup:
   - After a user creates an account, if ?transfer=true is in the URL OR localStorage has guest data:
     - Read guest Big Board from localStorage
     - Upsert those players into the new user's real Big Board (preserving order)
     - Read guest lists from localStorage
     - Create those lists under the new user's account
     - Clear localStorage guest data
     - Show toast: "Your rankings have been saved to your account!"
   - This should be a server action: src/lib/transfer-guest-state.ts

5. API access for guests:
   - Players endpoint (/api/players/search) is already public
   - Feed endpoint (/api/feed) is already public
   - All write endpoints require auth — guests writing to localStorage never hit the API

6. Guest indicator in nav:
   - Instead of user avatar, show: "Guest" label + "Sign Up" button (prominent, electric blue)
```

### Task 1.7 — Social (Likes, Comments) + Basic Search

```
Complete the social layer and search for Hadouken Phase 1.

LIKES (already have DB + API from Task 1.1 — just verify UI):
- Like button on list cards in feed: heart icon, count, filled/unfilled state. Optimistic toggle.
- Like button on list detail page header. Same behavior.
- Liking requires auth. If guest clicks like: show "Create a free account to like rankings →" toast with link to /signup.

COMMENTS (already have DB + API from Task 1.1 — build UI):
1. Comment section component (src/components/lists/comment-section.tsx):
   - Only shown if list.comments_enabled = true
   - Text input at top ("Add a comment..."), submit button
   - Comments list below: avatar + username + timestamp + body
   - Reply button on each top-level comment → indented reply thread (1 level deep)
   - Delete button (trash icon) on own comments (or any comment if list owner)
   - "Comments are turned off" message if comments_enabled=false
   - Commenting requires auth. If guest tries to comment: "Sign up to join the conversation →" prompt.

BASIC SEARCH:
2. Update the global search (Cmd+K command palette from Task 0.5) to search across:
   - Players: by name, returns headshot + name + position + team
   - Lists: by title, returns title + owner + player count (public lists only)
   - Users: by username or display_name, returns avatar + username + cred tier

3. Search API route GET /api/search?q=&type= (type = 'all'|'players'|'lists'|'users'):
   - Players: ILIKE search on full_name
   - Lists: ILIKE search on title (public, not deleted)
   - Users: ILIKE search on username and display_name
   - Return top 5 of each type when type=all
   - All results include the fields needed to render result rows

4. Search results page (app/search/page.tsx):
   - Reached by hitting Enter in the search bar or navigating to /search?q=
   - Tabbed results: All / Players / Lists / Users
   - List results rendered as list cards (same as feed)
   - Player results: headshot, name, position, team — clicking goes to player profile (placeholder page for now)
   - User results: avatar, username, cred badge — clicking goes to profile

USER PROFILES:
5. Basic profile page (app/u/[username]/page.tsx):
   - Server-rendered for SEO
   - Avatar, display name, username, bio, cred score badge
   - "My Lists" section: grid of their public lists
   - "Big Board" link: "See @{username}'s Big Board →"
   - Edit profile button (visible to owner only) → /settings/profile

6. Profile settings (app/(app)/settings/profile/page.tsx):
   - Edit display name, bio, avatar (upload to Supabase Storage)
```

---

## Phase 2: Teams

### Task 2.1 — Teams

```
Build the Teams feature for Hadouken. Read CLAUDE.md and the Teams section of docs/01-PRD.md (F9) before starting.

A team is a persistent list with a scoring system locked in at creation time. It is not meaningfully different from a list at this stage — the key distinction is that the scoring system is embedded permanently so fantasy point values are always consistent.

1. Database migration supabase/migrations/004_teams.sql:
   - teams table:
     id UUID PRIMARY KEY DEFAULT gen_random_uuid()
     owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE
     list_id UUID REFERENCES lists(id) ON DELETE CASCADE (team IS a list — reuses list infrastructure)
     name TEXT NOT NULL
     scoring_system_id UUID REFERENCES scoring_systems(id) NOT NULL (locked at creation — cannot change)
     season INTEGER NOT NULL DEFAULT 2026
     deleted_at TIMESTAMPTZ
     created_at TIMESTAMPTZ DEFAULT NOW()
   - RLS: owner full access, public read for non-deleted teams

2. API routes:
   - POST /api/teams — create team (name, scoring_system_id, optional: convert from existing list_id)
   - GET /api/teams — current user's teams
   - GET /api/teams/[id] — single team with players + scoring system
   - DELETE /api/teams/[id] — soft delete
   - POST /api/teams/from-list/[listId] — convert an existing list into a team (user selects scoring system)

3. Create Team flow:
   - Modal or page with: team name, scoring system selector (shows ESPN Standard, ESPN PPR, + any custom systems the user has)
   - Optional: "Convert from existing list" — dropdown of user's lists, pre-populates players
   - On submit: creates a lists row (is_big_board=FALSE, title=team name) + teams row linking to it
   - Free users: max 1 team (enforce in API)

4. Teams page (app/(app)/teams/page.tsx):
   - List of user's teams, each showing: name, player count, scoring system badge, season
   - "Create Team" button
   - "Convert List to Team" option

5. Team detail page (app/(app)/teams/[id]/page.tsx):
   - Inherits the list detail UI (player rows, drag-to-reorder, add players)
   - Scoring system badge always visible in header (e.g., "ESPN PPR")
   - Fantasy points for each player calculated using the team's locked scoring system (regardless of user's current session-level scoring toggle)
   - Fantasy points column shown next to each player

6. Fantasy points calculation utility (src/utils/calculate-fantasy-points.ts):
   - Takes a player's stats object + a scoring system rules JSONB object
   - Returns calculated fantasy points
   - Used everywhere fantasy points need to be displayed with a specific scoring system
```

---

## Phase 3: Player Research + Scoring Systems

### Task 3.1 — Research Table + Scoring Systems

```
Build the Player Research tab and custom scoring systems for Hadouken. Read CLAUDE.md and docs/01-PRD.md (F7, F8) before starting.

RESEARCH TABLE:
1. Research page (app/(app)/research/page.tsx):
   - Default view: filterable, sortable data table of all NFL players
   - Columns (configurable): Player, Position, Team, Bye, Fantasy Pts, Pass Yds, Pass TDs, Rush Yds, Rush TDs, Rec, Rec Yds, Rec TDs, Targets
   - Column visibility: user can toggle columns on/off (saved to localStorage)
   - Filters: position, team, bye week
   - Sortable: click any column header
   - Per-game vs. season toggle
   - Season selector: 2022, 2023, 2024, 2025, 2026 (mock)
   - "Add to List" button on each row: opens a list picker to add that player to one of the user's lists

2. Compare mode:
   - "Compare" button in toolbar → enter compare mode
   - User selects 2-4 players (checkboxes on rows)
   - Side-by-side stat comparison view
   - Exit compare mode returns to table

SCORING SYSTEMS:
3. Session-level scoring selector:
   - Dropdown in Research page toolbar: "Scoring: ESPN Standard ▾"
   - Options: ESPN Standard, ESPN PPR, + user's custom systems
   - Selecting a system recalculates the Fantasy Pts column using calculate-fantasy-points utility
   - Session-level only — resets to default when user navigates away

4. Custom scoring systems (src/app/(app)/settings/scoring/page.tsx):
   - List of user's custom scoring systems
   - "Create New" button opens a form:
     - Name (required)
     - Per-stat point values (matching the scoring_systems.rules JSONB schema)
     - Save → creates scoring_systems row with owner_id = current user
   - Free users: max 1 custom system. Show upgrade prompt if limit reached.
   - Pro users: unlimited

5. API routes:
   - GET /api/scoring-systems — platform defaults + current user's custom systems
   - POST /api/scoring-systems — create custom system
   - PATCH /api/scoring-systems/[id] — update (owner only)
   - DELETE /api/scoring-systems/[id] — delete (owner only, cannot delete platform defaults)
```

---

## Phase 4: Pro Subscription

### Task 4.1 — Stripe Integration + Pro Gates

```
Build the Pro subscription system for Hadouken. Read CLAUDE.md and docs/01-PRD.md (F11) before starting.

1. Install: npm install stripe @stripe/stripe-js

2. Environment variables to add to .env.example:
   STRIPE_SECRET_KEY=
   STRIPE_PUBLISHABLE_KEY=
   STRIPE_WEBHOOK_SECRET=
   STRIPE_MONTHLY_PRICE_ID=
   STRIPE_ANNUAL_PRICE_ID=

3. Stripe client (src/lib/stripe/client.ts):
   - Server-side Stripe instance
   - Helper: getOrCreateStripeCustomer(userId) — looks up stripe_customer_id on profile or creates new

4. API routes:
   - POST /api/stripe/create-checkout-session — creates Stripe Checkout Session (monthly or annual), returns URL
   - POST /api/stripe/create-portal-session — creates Customer Portal session for managing subscription
   - POST /api/stripe/webhook — handles Stripe webhook events:
     - checkout.session.completed → set is_pro=TRUE, subscription_status='active', store stripe_customer_id
     - customer.subscription.updated → update subscription_status
     - customer.subscription.deleted → set is_pro=FALSE, subscription_status='canceled'

5. Pricing page (app/pro/page.tsx):
   - Monthly vs. Annual toggle (annual shows savings %)
   - Two columns: Free tier vs. Pro tier
   - Feature comparison list
   - "Start 7-Day Free Trial" CTA → calls create-checkout-session
   - If already Pro: show "Manage Subscription" → calls create-portal-session

6. Billing settings (app/(app)/settings/billing/page.tsx):
   - Current plan status
   - Next billing date (fetch from Stripe)
   - "Manage Subscription" button → portal

7. Pro gate enforcement — add is_pro checks to:
   - Private lists (max 1 free → unlimited Pro)
   - Teams (max 1 free → unlimited Pro)
   - Custom scoring systems (max 1 free → unlimited Pro)
   - Leagues (Pro only — coming Phase 8)

8. Upgrade prompt component (src/components/shared/upgrade-prompt.tsx):
   - Reusable component shown when user hits a free tier limit
   - Shows what they're missing + "Upgrade to Pro" CTA → /pro
   - Use as a modal or inline callout depending on context

9. 7-day free trial: pass trial_period_days: 7 in the Stripe subscription creation.
```

---

## Phase 5: Ranking Submissions + Cred + Start or Sit

### Task 5.1 — Submissions Database + API

```
Build the ranking submission system for Hadouken. Read CLAUDE.md and docs/01-PRD.md (F3, F6) before starting.

1. Database migration supabase/migrations/005_submissions.sql:

   submissions table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE
   - source_list_id UUID REFERENCES lists(id) (the list this was submitted from)
   - submission_type TEXT NOT NULL ('weekly' or 'season_long')
   - week_number INTEGER (NULL for season_long)
   - season INTEGER NOT NULL DEFAULT 2026
   - position_filter TEXT (QB/RB/WR/TE — what position this submission covers)
   - snapshot JSONB NOT NULL (ordered array of player IDs at submission time)
   - accuracy_score DECIMAL (NULL until evaluated)
   - cred_earned INTEGER DEFAULT 0
   - evaluated_at TIMESTAMPTZ
   - created_at TIMESTAMPTZ DEFAULT NOW()
   - NOTE: submissions are immutable — no updated_at, no soft delete

   cred_events table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - user_id UUID REFERENCES profiles(id) ON DELETE CASCADE
   - event_type TEXT ('big_board_update' | 'weekly_submission' | 'season_submission' | 'start_sit_vote')
   - reference_id UUID (submission_id, snapshot_id, or vote_id)
   - base_cred INTEGER DEFAULT 0
   - accuracy_bonus INTEGER DEFAULT 0
   - total_cred INTEGER DEFAULT 0
   - created_at TIMESTAMPTZ DEFAULT NOW()

2. API routes:
   - POST /api/submissions — submit a list (validates submission window is open, creates frozen snapshot, awards base cred). Return 409 if window closed.
   - GET /api/submissions — current user's submissions history
   - GET /api/submissions/[id] — single submission with accuracy score (if evaluated)

3. Submission window logic (src/utils/submission-windows.ts):
   - isWeeklyWindowOpen(): returns true if current time is between Tuesday 12:00am and Sunday first kickoff
   - getCurrentWeek(): returns current NFL week number
   - Hardcode week dates for 2026 season or fetch from a season_config table

4. Free tier enforcement: max 2 position submissions per week (count by owner_id + week_number + season)
```

### Task 5.2 — Cred System + Consensus Rankings

```
Build the cred system and consensus rankings for Hadouken. Read docs/01-PRD.md (F4, F6) before starting.

1. Accuracy calculation (src/utils/calculate-accuracy.ts):
   - Implement Spearman rank correlation between submitted player order and actual fantasy point rankings
   - Input: submittedOrder (player IDs in submitted order), actualPoints (map of playerId → fantasyPoints)
   - Output: correlation coefficient converted to a percentage (0-100)

2. Cred tier thresholds (src/utils/cred-tiers.ts):
   - Freshie: 0–99
   - Sophomore: 100–299
   - JV: 300–599
   - Varsity: 600–999
   - Rookie: 1,000–1,999
   - Veteran: 2,000–3,999
   - All Pro: 4,000–6,999
   - Local Legend: 7,000–9,999
   - Hall of Famer: 10,000–14,999
   - GOAT: 15,000+
   - getCredTier(score): returns tier name and color

3. Evaluation cron (src/app/api/cron/evaluate-submissions/route.ts):
   - Runs after games complete each week (POST endpoint, called by Vercel cron or manually)
   - For each unevaluated submission from the completed week:
     - Fetch actual fantasy point totals for that week
     - Calculate Spearman accuracy score
     - Update submission.accuracy_score and submission.evaluated_at
     - Calculate cred earned: base=10 + accuracy_bonus=(accuracy_score × 0.9, max 90)
     - Insert into cred_events
     - Increment profile.cred_score

4. Consensus rankings:
   - Database view (in migration): consensus_rankings — aggregates all user Big Boards weighted by cred_score, per position. Uses average rank weighted by cred_score.
   - GET /api/consensus?position= — returns consensus rankings for a position
   - Consensus page (app/(app)/rankings/page.tsx): overall + per-position tabs, paginated table

5. Profile cred display:
   - Add to profile page: cred score badge (shows tier name + score), accuracy chart (chart.js line chart of accuracy over time)
   - Cred tier badge component (src/components/shared/cred-badge.tsx): pill with tier name, colored by tier
```

### Task 5.3 — Start or Sit

```
Build the Start or Sit feature for Hadouken. Read docs/01-PRD.md (F6A) before starting.

1. Database migration (add to supabase/migrations/005_submissions.sql or new 006 migration):

   start_sit_questions table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - author_id UUID REFERENCES profiles(id) ON DELETE CASCADE
   - player_a_id UUID REFERENCES players(id)
   - player_b_id UUID REFERENCES players(id)
   - context_note TEXT (optional, max 200 chars)
   - week_number INTEGER NOT NULL
   - season INTEGER NOT NULL DEFAULT 2026
   - vote_count INTEGER DEFAULT 0
   - result TEXT ('player_a' | 'player_b' | 'void' — set after evaluation)
   - evaluated_at TIMESTAMPTZ
   - created_at TIMESTAMPTZ DEFAULT NOW()

   start_sit_votes table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - question_id UUID REFERENCES start_sit_questions(id) ON DELETE CASCADE
   - voter_id UUID REFERENCES profiles(id) ON DELETE CASCADE
   - vote TEXT NOT NULL ('player_a' | 'player_b')
   - cred_earned INTEGER DEFAULT 0
   - created_at TIMESTAMPTZ DEFAULT NOW()
   - UNIQUE(question_id, voter_id)

2. API routes:
   - POST /api/start-sit — post a question (free: max 5 per week)
   - GET /api/start-sit — browse questions (filter by week, position, sort by votes/recency)
   - POST /api/start-sit/[id]/vote — cast a vote (cannot vote on own question, one vote per question)
   - GET /api/start-sit/[id] — question detail with vote counts (reveals split after user votes)

3. Start or Sit page (app/(app)/start-or-sit/page.tsx):
   - Feed of open questions, sorted by vote count
   - Each card: two player headshots side by side, player names, context note, vote count, week
   - Before voting: shows both players, tap to vote
   - After voting: shows vote split (% for each player), your choice highlighted
   - "Ask a Question" button at top

4. Post question flow:
   - Two player search inputs (PlayerSearch component)
   - Optional context note text input
   - Week auto-filled (current week)
   - Submit

5. Home feed integration: Hot Start or Sit questions (most votes this week) appear in the home feed as a distinct card type.
```

---

## Phases 6–10

Prompts for Phase 6 (Full Social + Explore), Phase 7 (Player Following + News Feed), Phase 8 (Leagues + Live Mode), Phase 9 (AI Features), and Phase 10 (Polish + Launch) will be written as development reaches those phases.
