# Handoff: Player lists

## Overview

Player lists are how a Field Scout user builds, organizes and shares a board of
players — a big board, a positional shortlist, a set of auction targets. A list
holds an ordered set of players, can be grouped several ways (ranked, tiers,
rounds, average cost, budget share), renders in three view styles, and carries
a social layer (views, comments, share, save).

The feature covers four surfaces:

1. **Lists page** — browse your lists and saved lists, in three page modes:
   List (rail + open list), Cards (gallery), Side by side (compare columns).
2. **List detail** — the open list: hero, tabs (List / Details / Comments),
   toolbar, and the list body in one of three view styles.
3. **Pop-out window** — a draggable, resizable, dark-themed floating copy of a
   list that persists across app navigation. Built for live drafts.
4. **User profile** — a public page reached by clicking any `@handle`.

## About the design files

The files in `design/` are **design references created in HTML** — a working
prototype showing intended look and behavior, not production code to copy
directly. They are plain browser-babel JSX modules that attach components to
`window`, with mock data in `lists.js` / `players.js`.

The task is to **recreate these designs in the target codebase's existing
environment** (React, Vue, SwiftUI, native, etc.), using its established
patterns, state layer and component library. If no environment exists yet,
choose the framework that suits the project and implement there.

## Fidelity

**High fidelity.** Colors, type, spacing, control heights and interaction
states are final and should be matched. All values below are literal.

One environmental caveat: the prototype shell renders at `zoom: 0.8`, so 1px
borders paint as 0.8px hairlines. Several places therefore specify `1.25px` to
land on a whole device pixel. **In a normal 1× app, use 1px** wherever this
document says 1.25px.

---

## Design tokens

All from the Field Scout design system (neo-brutalist: light grey page, hard
1px black borders, solid un-blurred offset shadows, near-square corners).

### Color

| Token | Value | Use |
| --- | --- | --- |
| `--n-1` | `#000000` | Ink: borders, primary text, shadows |
| `--n-2` | `#161616` | Near-black surface (sidebar, pop-out window) |
| `--n-3` | `#5f646d` | Muted / secondary text |
| `--n-4` | `#e7e8e9` | Hairline rules, disabled fill |
| `--white` | `#ffffff` | — |
| `--surface-page` | `#E4E5E8` | Page background |
| `--surface-card` | `#ffffff` | Card / panel background |
| `--surface-sunken` | light grey | Recessed rows (drafted players) |
| `--accent` | `#1F6BF0` | Interaction: active states, selection, links |
| `--accent-soft` | pale blue | Hover wash, selected row |
| `--accent-strong` | deeper blue | Hover text on accent-soft |
| `--brand` | `#b4ff89` | Live / attention. Always carries ink text |
| `--positive` | green | Drafted checkbox fill |
| `--tier-1` … `--tier-6` | indigo ramp | Tier band fills (deepest = best) |
| Position colors | via `PositionBadge` | QB orange, RB blue, WR purple, TE teal |

**Rule:** brand green = "look here" (static, important). Accent blue = "do a
thing" (controls, selection). Never invert those roles.

### Type

Roboto Flex throughout; Roboto Mono (`.fs-num`) **only** in tables and for
numeric readouts like view/like counts — never for usernames.

Weights run lighter than the kit default, deliberately:

- Headings: 700
- UI labels / buttons: 600–700
- Body and data: 500
- Stat values on cards and list rows: 500
- Stat captions and any text ≤ 11.5px: 400–500 (never 600+ at small sizes)

### Geometry

- Radius: `--radius-sm` = 1px everywhere. Only avatars and dots are pill.
- Borders: 1px solid `#000` (1.25px in the 0.8× prototype).
- Shadows: solid, zero blur, offset down-right — `--shadow-4/6/8`.
- **Elevation is a hover affordance only.** Nothing carries a resting shadow:
  `.fs-lift` = `box-shadow: none` → `--shadow-4` on hover;
  `.fs-lift--lg` → `--shadow-8` on hover. Buttons press flat on `:active`.
- Motion: linear, 120–200ms, color/opacity/transform only.

### Control heights

Every toolbar control is **32px**. Page gutters 36px, header offset 92px.

---

## Data model

```
List {
  id, name, desc,
  author: { handle, avatar },      // handle only — no display names
  cover: { color, emoji|image },
  created: "YYYY-MM-DD",           // creation date, not last-updated
  fav: boolean,                    // the permanent "Favorites" list
  saved: boolean,                  // saved from another user
  kind: "ranking" | "list",
  scope: "predraft" | "week" | "ros",
  visibility: "private" | "link" | "public",
  org: "rank" | "tier" | "round" | "cost" | "budget",
  view: "list" | "table" | "card",
  cols: string[],                  // chosen stat ids, in order
  costBands: [{ key, label, min }],// editable labels for the cost grouping
  budget: number,
  tags: string[],
  links: [{ kind: "video"|"article", url, title }],
  stats: { views, likes },
  entries: Entry[]
}

Entry { name, tier, round, cost, drafted, note }
```

### Store rules that matter

- **`drafted` is global.** Toggling a player drafted sets the flag on that
  player in *every* list that contains him — a player taken in a draft is gone
  everywhere. Seed data is normalized at load for the same reason.
- **Order is the array order.** Drag-and-drop splices the entry; grouping
  changes never reorder, they only bucket.
- Moving an entry into a bucket assigns `tier` / `round` / `cost`, then keeps
  bucket members contiguous in the array.
- `Favorites` (`fav: true`) can't be deleted; the Delete item is omitted from
  its menus entirely, not disabled.

---

## Screens

### 1. Lists page

**Page header** (left to right):

- `Lists` heading (`--text-h3`, 700).
- View mode toggle — three segmented buttons, 32px tall, 12px/700 labels with
  a 15px icon: **List** (`list`), **Cards** (`layers`), **Side by side**
  (`table`). Active = `--accent` fill, white text. Inactive = transparent,
  ink text, `--accent-soft` wash on hover.
- Tabs **My lists** / **Saved**, each with its count in mono. Underline-free
  chip tabs: active = `--accent` text, inactive = full-contrast ink text
  (never grey), hover = `--accent-soft` wash. These drive both the rail and
  the gallery.
- Right: `New list` (accent-blue, shadow). In Side by side mode a
  `Change lists` button appears beside it once columns are showing.

**Critical implementation note:** resting/hover/active colors for these
segmented and tab controls live in CSS classes (`.fs-seg`, `.fs-tab`,
`.fs-trigger`, `.fs-bareselect`), not inline styles — an inline `background`
outranks the `:hover` rule and silently kills the hover state.

#### Mode: List (rail)

Two-column grid, `200px minmax(0, 1fr)`, **no gap** — the rail's right border
is removed so the two panels share one edge.

Rail: sticky at top 92px, max-height `calc(100vh - 150px)`, scrolls, carries
`.fs-lift`. Rows are 30px cover tile + name (13px/700) + `N players · Aug 8`
(10.5px/500, `--n-3`), 9px/10px padding, 1px `--n-4` bottom rule. Selected row
= `--accent-soft` fill with a 3px `--accent` left border. No per-row menu.

#### Mode: Cards (gallery)

Responsive grid of list cards. Cards rest flat and lift on hover. Clicking one
opens the list full-width with a back button in the page header.

#### Mode: Side by side

Purpose: run a live draft with several boards visible.

- **Picker** (shown when nothing is selected): heading "Pick the lists to
  compare", a 232px-min grid of selectable list cards each with a 16px
  checkbox (accent fill when on) and a 30px cover, then a primary button
  reading "Show N lists side by side".
- **Columns**: 300px fixed-width panels in a horizontal scroller. The scroller
  is **full-bleed** — `margin: 0 -36px; padding: 0 36px 8px` — so it runs edge
  to edge past the page gutter rather than stopping at the padding.
- Column header: 26px cover, name, live `18 of 24 left` count, and a stroked
  `dots` options button whose menu lists the five grouping modes (each column
  groups independently) plus `Remove column` under a separator.
- Rows: 38px, permanent drafted checkbox, `#N`, player name (links to the mini
  card), position badge, team. Tier/round headers carry through in color.

### 2. List detail

**Hero** — cover tile, then:

- List name, 20px/700, `-0.01em`. A pencil icon appears **on hover only** (and
  only for lists you own); clicking swaps the heading for an input with Save /
  Cancel, Enter saves, Esc cancels. No modal.
- Byline 4px below: xs avatar, `@handle` (clickable → user profile, underline
  appears on hover), `created Aug 8`, `· N players`.
- Right side, in order: **Share** (brand lime, ink text, shadow) → **options**
  (`dots`, stroke) → **expand** (custom glyph, stroke, List mode only) →
  **pop out** (`arrow-up-right`, stroke) → **close** (`close`, stroke).
  In the expanded view the expand button is replaced by **minimize**.

Options menu: Change image · List type (submenu: Pre-draft / This week / Rest
of season) · Visibility (Private / Link / Public) · Insights · — · Duplicate
(`layers`) · Archive (`save`) · Delete list (danger; omitted on Favorites).

**Tabs**: List · Details · Comments (count). Chip tabs, same treatment as the
page header. Views and likes sit right-aligned on the tab row.

**Toolbar** (all controls 32px):

1. **Grouping dropdown, far left** — a bare select: no border, no fill, 20px
   **bold** label with a 20px `arrow-bottom`, text-primary shifting to
   text-secondary on hover. Menu items carry no icons. This control doubles as
   the heading for the content below, so **sections must not repeat the word
   Tier/Round** — they show only the value.
2. View style toggle — icon-only segmented: List, Table, Cards.
3. **Stats** — gear icon + label + count. Opens the stat picker.
4. **Add players** — accent blue, shadow, pushed right.

#### View style: List

Sections stack vertically. Each section is a `.fs-lift` card with
`overflow-x: auto` and a computed `minWidth = 330 + cols.length * 72`, so rows
scroll rather than spilling outside the card.

Row: 60px tall, grip, `#N` (30px wide, mono, **ink**), 30px headshot, then a
stacked name block — name 14px/600 on line one (opens the player mini card on
click), position badge + team 11px/500 on line two — followed by **every**
selected stat as a 62px right-aligned cell (value 14px/500 tabular, caption
9.5px/400), then the row menu.

#### View style: Table

Dense 44px rows with a sticky column header, 26px headshot, and one column per
selected stat. Horizontal scroll with the same minWidth technique.

#### View style: Cards

Sections stack down the page; **cards wrap** inside each section (no
horizontal scrolling).

- Grouped lists (tiers / rounds / cost) get a **62px label rail** on the left,
  top-aligned with the first card, filled with the tier color: the number
  alone at 22px/700 (cost bands show their editable text label instead), plus
  a text-only `Add +`.
- **Ranked lists have no rail and no container at all** — the cards sit
  directly on the page.

**Player card** — 164px wide, `1.25px` ink border, rests flat, lifts on hover:

- **Top-left corner cell**, flush to the corner (no inset): `#N` at 13px/700,
  22px tall, 7px horizontal padding, closed by a right and bottom rule. Fill
  is the tier color when grouped, brand lime when simply ranked.
- **Top-right corner cell**, mirrored: position rank as an ordinal (`2nd`),
  ink text, closed by a left and bottom rule.
- Centered column, 6px/6px/7px padding, 5px gaps: 38px circular headshot
  (8px top margin), name 15px/600 centered (opens the mini card), then a row
  of position badge + team.
- The **drafted checkbox** appears at the head of the position/team row **on
  hover** (and stays visible once drafted): 14px box, 1.25px ink stroke,
  `--positive` fill with a 9px check.
- **Row menu** sits flush in the top-right corner on hover, in a white box
  with a 1.25px ink stroke, covering the position rank. Its menu omits
  "Mark drafted" (the checkbox covers it).
- **Stat strip** across the bottom: `repeat(N, 1fr)` grid, top rule 1.25px,
  no vertical rules. Value 15px/500 **Roboto Flex** with `tabular-nums`
  (not mono), caption 10px/400 `--n-3`, 6px/1px/5px padding.
- Card view renders the **first three** selected stats; the Stats modal says
  so. List and table views show all of them.

#### Drag and drop (all three views)

Rows never highlight themselves. Instead **the gap opens** where the player
will land: a slot expands to exactly the dragged element's `offsetHeight` /
`offsetWidth` (measure with offset\*, not `getBoundingClientRect`, which is
scaled by the shell zoom), filled `--accent-soft` with a dashed `--accent`
edge and the dragged player's name inside. Position is decided by which half
of the row (or which half horizontally, in card view) the pointer is over, so
the slot after the last player in a bucket is reachable. Gaps only exist while
a drag is running, and state only updates when the target slot actually
changes — updating on every `dragover` causes visible jank.

Dragging onto a tier/round/band header assigns that bucket. A dashed
"Drop a player here to start tier N" zone sits below the last section.

#### Notes

A note is a mark, not a paragraph: a single `comments` icon in `--accent`
beside the player's team. Hovering shows the note in a **white box, ink text,
1px stroke, modal-level shadow**, rendered into `document.body` and clamped to
the viewport so it can't be clipped by a scrolling column. "Add note" lives in
the row menu only.

### 3. Pop-out window

A list lifted out of the page into a floating window. Open several and set
them side by side.

- **Dark theme.** The window inverts: `--n-2` surface, white text, `--n-3`
  → `#b3b9c0`, `--n-4` → `rgba(255,255,255,.22)`, `--border` →
  `1px solid rgba(255,255,255,.24)`. Implement by scoping the color custom
  properties on an inner wrapper so children invert without restyling — and
  keep the Stats modal it opens *outside* that wrapper, since it belongs to
  the light page.
- **Outer stroke:** 1.25px in `--text-secondary`, shifting to `--brand` on
  hover. **No shadow** — a black offset shadow can't read on a black window,
  so the stroke carries the lift.
- Header (drag handle anywhere on it, 44px): cover, name 12.5px/600, then
  gear (stat picker), `dots` (grouping menu), collapse, close.
- Rows: 36px, 14px drafted checkbox with a `rgba(255,255,255,.75)` stroke,
  `#N`, name **13px/400** (Regular — heavier reads as a heading on ink),
  position badge, stat cells. Hover = `rgba(255,255,255,.09)` (the kit's light
  `.fs-rowh` wash is invisible here). Drafted rows dim to 45% with a 5% wash.
  Rows are drag-reorderable with the same gap model.
- Footer: views / comments, and a **brand-lime Share button with literal
  `#000` text** — inside the dark wrapper `--n-1` resolves to white, so a
  token-based ink color would render white-on-lime.
- **Resize:** a 16px grip in the bottom-right corner drags width and height
  (330–1200 × 220–900). Widening reveals more stat columns.
- **Persistence:** pop-outs are rendered by the **app shell**, not the Lists
  page, so they survive navigation and stay until closed.

### 4. Modals

- **Stats picker** — grouped stat catalog (groups ordered by how much of *this*
  list they cover, so a WR list leads with receiving), search, chosen stats as
  reorderable chips. Includes both `Cost PPR` and `Cost std` (non-PPR pricing:
  RBs ×1.14, pass-catchers ×0.86).
- **Add players** — search over the player pool, optionally targeting a bucket.
- **Change image** — cover color + upload. Name and description are edited
  inline, not here.
- **Share** — link, visibility, embed.
- **Note editor** — per-player note.

---

## Interactions

| Trigger | Result |
| --- | --- |
| Click player name | Player mini card (modal) |
| Click `@handle` | User profile page |
| Click drafted checkbox | Marks drafted **in every list containing him** |
| Drag row/card | Drop gap opens; release reorders or re-buckets |
| Drag onto section header | Assigns that tier / round / cost band |
| Click tier label (cost bands, owner only) | Inline rename |
| Hover list name (owner) | Rename pencil fades in |
| Expand | Full-width view; records origin |
| Minimize / Back | Returns to the recorded origin, list still selected |
| Pop out | Floating dark window, persists across navigation |
| Hover anything interactive | Must have a state — accent-soft wash or lift |

## State

Single observable store (`FS_LISTS`) with subscribe/bump:

- `lists[]`, `selId`, `openId`, `mode` (`rail` / `gallery` / `compare`),
  `tab` (`mine` / `saved`), `expandedFrom`, `compare[]` (column ids),
  `popouts[{ id, x, y, w, h, z, min }]`, `comments{}`, `liked{}`.
- Mutations: `patch`, `select`, `setOpen`, `setMode`, `setTab`, `expand`,
  `minimize`, `toggleDrafted` (global), `setNote`, `move`, `moveAfter`,
  `moveToBucket`, `remove`, `destroy`, `archive`, `newList`, `setCompare`,
  `toggleCompare`, `popout`, `movePopout`, `sizePopout`, `closePopout`,
  `setBandLabel`, `fmtCreated`.

## Copy

- **Usernames only.** The product has no real names or display names. Never
  render "You" as a person — show the `@handle`.
- **Never all caps.** Sentence case for every label, chip and header. Only
  genuine codes stay capitalized: QB/RB/WR/TE/FLEX, ADP/OPRK/PPR, team
  abbreviations.
- Dates: `Aug 8` for the current year, `Nov 9, 2025` otherwise.

## Custom icons

Two glyphs are **not** in the design system's icon set and were drawn to its
16×16 filled spec. Both are in `ListsCommon.jsx`:

- `Gear` (`GEAR_D`) — the Stats button. The kit has no cog.
- `Expand` (`EXPAND_D`) / `Collapse` (`COLLAPSE_D`) — two arrows to opposite
  corners, and their inward mirror.

If the target codebase has a real icon library, substitute its equivalents.

## Assets

No new image assets. Headshots and cover art come from the existing
`PlayerCard` / `CoverTile` components and the design system's avatar set.
Player names are real NFL players; **every stat, projection, ADP and cost is
illustrative mock data**.

## Files

| File | Contains |
| --- | --- |
| `design/ListsScreen.jsx` | Page header, rail, gallery, hero, tabs, details, comments, side-by-side |
| `design/ListsBody.jsx` | Toolbar, the three view styles, rows, player card, bucket headers |
| `design/ListsCommon.jsx` | Store hook, drag-and-drop, drop gap, modals, row menu, pop-out window, custom icons |
| `design/lists.js` | Data model, mock lists, all store mutations |
| `design/players.js` | Player pool, stat catalog, formatters |
| `design/UserProfile.jsx` | Public profile reached from `@handle` |
| `design/PlayerCard.jsx` | Player mini card, `PlayerLink`, `PlayerFace` |
| `design/AppShell.jsx` | Sidebar, header, and the app-level pop-out host |
| `design/index.html` | Entry point, route table, global style overrides |

To run the prototype, serve `design/` and open `index.html` — it expects the
Field Scout design system bundle at the path referenced in that file.
