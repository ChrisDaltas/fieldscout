# Design System: Hadouken

> This document is the source of truth for all visual and UX decisions. Claude Code should read this file whenever building UI components, pages, or layouts. Every design decision made here should be reflected consistently across the entire app.

---

## Brand Vibe

**Spotify meets PFF (Pro Football Focus).**

- From Spotify: clean dark UI, bold typography, card-based layouts, generous whitespace, music-player-level polish. Content is the star — the UI gets out of the way.
- From PFF: dense and trustworthy data presentation, stat tables that feel authoritative, sports credibility. Information is the product.
- The result: a fantasy football app that feels premium, modern, and built for people who take the game seriously — not the clunky ESPN/Yahoo experience. Smart, opinionated, clean.

---

## Color Palette

### Primary
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-primary` | `#1DB954` | Primary CTAs, active states, highlights, cred badges, key interactive elements |
| `--color-primary-hover` | `#1AAE4D` | Hover state for primary green |
| `--color-primary-muted` | `#1DB95420` | Subtle green tint backgrounds (e.g. active nav item) |

### Backgrounds
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg-base` | `#121212` | App background (Spotify's exact dark bg) |
| `--color-bg-elevated` | `#1E1E1E` | Cards, sidebars, modals |
| `--color-bg-elevated-2` | `#282828` | Hover states on cards, nested elements |
| `--color-bg-elevated-3` | `#333333` | Input backgrounds, secondary surfaces |

### Text
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-text-primary` | `#FFFFFF` | Headings, primary labels |
| `--color-text-secondary` | `#B3B3B3` | Subtext, metadata, muted labels (Spotify's secondary text) |
| `--color-text-tertiary` | `#6B6B6B` | Placeholder text, timestamps, disabled states |

### Accents
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-error` | `#E5534B` | Errors, F-tier, negative states |
| `--color-warning` | `#F97316` | D-tier, warnings |
| `--color-yellow` | `#EAB308` | C-tier |
| `--color-blue` | `#3B82F6` | B-tier, informational |
| `--color-green` | `#1DB954` | A-tier (reuses primary) |
| `--color-gold` | `#FFD700` | S-tier, GOAT badge, #1 rank |

### Tier Colors (used across lists, Big Board, rankings)
| Tier | Color | Hex |
|------|-------|-----|
| S | Gold | `#FFD700` |
| A | Green | `#1DB954` |
| B | Blue | `#3B82F6` |
| C | Yellow | `#EAB308` |
| D | Orange | `#F97316` |
| F | Red | `#E5534B` |

### Borders & Dividers
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-border` | `#282828` | Card borders, dividers |
| `--color-border-subtle` | `#1E1E1E` | Very subtle separators |

---

## Typography

**Font:** Inter (Google Fonts). Load weights 400, 500, 600, 700.

| Role | Size | Weight | Usage |
|------|------|--------|-------|
| Display | 32–48px | 700 | Hero headings, page titles |
| Heading 1 | 24px | 700 | Section headers |
| Heading 2 | 20px | 600 | Card titles, modal headers |
| Heading 3 | 16px | 600 | Sub-section labels |
| Body | 14px | 400 | Default body text |
| Small | 12px | 400 | Metadata, timestamps, tags |
| Label | 12px | 500 | Badges, chips, nav labels |
| Mono | 13px | 400 | Stats, numbers, rank numbers — use `font-variant-numeric: tabular-nums` |

**Hierarchy rules:**
- Player names: 14px, weight 600, white
- Team + position: 12px, weight 400, `--color-text-secondary`
- Rank numbers: 13px, weight 700, tabular-nums, `--color-text-secondary`
- Stat values: 13px, weight 600, tabular-nums, white

---

## Spacing

Use Tailwind's default spacing scale. Standard internal padding for cards is `p-4` (16px). Gaps between list items are `gap-2` (8px). Section gaps are `gap-6` (24px) or `gap-8` (32px).

---

## Component Patterns

### Cards
- Background: `--color-bg-elevated` (`#1E1E1E`)
- Border: 1px solid `--color-border` (`#282828`)
- Border radius: `rounded-lg` (8px)
- Hover: background shifts to `--color-bg-elevated-2` (`#282828`), subtle transition (150ms)
- No drop shadows — use border + background contrast instead (Spotify style)

### Player Rows
- Height: 56px (comfortable) or 44px (compact)
- Left: rank number (tabular, muted) → circular headshot (32px) → name + team/position
- Right: stat values → action buttons (appear on hover)
- Drag handle: appears on hover, left side, `cursor-grab`
- Hover background: `#282828`
- Divider: 1px `#282828` between rows (or no divider with hover background — pick one and be consistent)

### Buttons
- **Primary:** `bg-[#1DB954]` text-black font-semibold, hover `bg-[#1AAE4D]`, border-radius `rounded-full` (pill shape — Spotify style)
- **Secondary:** `bg-transparent border border-[#6B6B6B]` text-white, hover `border-white`
- **Ghost:** no border, no bg, text `--color-text-secondary`, hover text-white
- **Destructive:** `bg-[#E5534B]` text-white
- Sizes: sm (`h-8 px-4 text-sm`), md (`h-10 px-6 text-sm`), lg (`h-12 px-8 text-base`)
- All buttons: `rounded-full` (pill) for primary actions, `rounded-md` for secondary/utility

### Badges & Chips
- Tag chips: `rounded-full`, small, `bg-[#282828]` text `--color-text-secondary`, hover `bg-[#333333]`
- Position badges (QB, RB, etc.): colored pill, small font, position-specific colors:
  - QB: purple `#8B5CF6`
  - RB: green `#1DB954`
  - WR: blue `#3B82F6`
  - TE: orange `#F97316`
  - K: gray `#6B6B6B`
  - DEF: red `#E5534B`
- Injury badges: `bg-[#E5534B20]` text `#E5534B`, tiny, pill-shaped

### Cred Tier Badges
Pill-shaped badge showing tier name. Colors:
- Freshie: gray
- Sophomore: gray-blue
- JV: blue `#3B82F6`
- Varsity: blue (brighter)
- Rookie: green (light)
- Veteran: green `#1DB954`
- All Pro: gold `#FFD700`
- Local Legend: gold (brighter)
- Hall of Famer: orange-gold gradient
- GOAT: animated gradient (green → gold)

### Inputs
- Background: `--color-bg-elevated-3` (`#333333`)
- Border: `1px solid transparent`, focus: `1px solid #1DB954`
- Border radius: `rounded-md`
- Text: white, placeholder `--color-text-tertiary`
- Height: 40px (md), 36px (sm)

### Navigation

**Sidebar (desktop):**
- Width: 240px, fixed
- Background: `#000000` (pure black, like Spotify)
- Logo at top: "Hadouken" wordmark in white, bold
- Nav items: 14px, `--color-text-secondary`, hover text-white + `bg-[#282828]`, active: text-white + `bg-[#1DB95420]` with green left border (2px)
- User section at bottom: avatar, display name, cred badge

**Bottom tabs (mobile):**
- Background: `#000000`
- Icon + label, inactive: `--color-text-secondary`, active: `#1DB954`
- Top border: 1px `#282828`

### Modals & Sheets
- Overlay: `bg-black/70` backdrop
- Modal: `bg-[#282828]` rounded-xl, max-w-md centered
- Sheet (mobile): slides up from bottom, `bg-[#1E1E1E]` rounded-t-xl

---

## Motion & Animation

Keep it fast and subtle — like Spotify. Nothing that makes the app feel slow.

- Hover transitions: 150ms ease
- Page transitions: none (instant navigation)
- Optimistic UI: no loading state shown for likes, reorders — assume success
- Toasts: slide in from bottom-right, 3s auto-dismiss
- Skeleton loading: pulse animation, `bg-[#282828]` → `bg-[#333333]`
- Drag and drop: `scale(1.02)` on dragged item + subtle shadow while dragging
- Number changes (live stats): animate with a brief flash or count-up

---

## Layout

- Max content width: 1280px, centered
- Default page padding: `px-6` (24px) on desktop, `px-4` (16px) on mobile
- Sidebar + content: sidebar is fixed, content area scrolls independently
- Feed layouts: single column on mobile, single column (max 680px) on desktop — content-focused, not grid

---

## Iconography

Use **Lucide React** for all icons. Keep icon size consistent:
- Nav icons: 20px
- Inline icons (within text/buttons): 16px
- Large feature icons: 24px

---

## Voice & Tone

- **Confident, not arrogant.** This is for people who know ball. Speak to them like peers.
- **Concise.** No filler copy. No "Welcome to your dashboard!" nonsense.
- **Sports-native language.** Use terms real fantasy players use: "Big Board", "cred", "Start or Sit", "waiver wire". Don't sanitize it.
- **Empty states should motivate.** Instead of "No lists yet", say "Build your first list. Your Big Board is waiting."

---

## Do's and Don'ts

**Do:**
- Dark backgrounds everywhere (no white backgrounds in the app)
- Green for all primary interactive elements
- Pill-shaped primary buttons
- Circular player headshots
- Tabular numbers for stats and ranks
- Consistent 8px spacing grid

**Don't:**
- No light mode (dark only for V1)
- No drop shadows (use background contrast instead)
- No blue links (links are white or green)
- No card borders that are too bright — they should be barely visible
- No gradients except on GOAT badge and hero sections
- No emoji in UI unless user-generated
