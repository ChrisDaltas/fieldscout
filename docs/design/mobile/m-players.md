## League › Players tab (trending, available, leaders), filters, grid, column tips

Sources in `FieldScout Mobile.dc.html`:
- Markup: lines 344–416 (Players tab); 627–644 (dock); 646–651 and 724 (bottom-sheet shell and Done button); 674–691 (Transaction filters sheet and Customize stats sheet); 1108–1117 (column tip and toast).
- Script: `pVals()` (lines 1420–1470); the constants `PCOLS`, `PCOLMETA`, `PCOL_DEF`, `PPER`, `PSTAT`, `PPOS` and the function `pstat()` (1369–1400); `TREND`, `AVAIL` and `LEAD` (1148–1150); `HEAD`, `head` and `short` (1127–1129); `TEAMS` (1130–1143); `ICON` (1153); `TC`, `seeded`, `ord`, `TINT` and `STATUS` (1201–1208); `PDB` (1216–1221); `ownerOf` (1249–1253); `toast()` (1624); `go()` and jumps (1628–1629); the dock, tab bar and sheet values in `renderVals()` (1626–1858).
- Headshot: `FSHeadshot.dc.html`.

Every computed example below was checked by running the prototype's own script in Node.

> **Important: the "ptab trend/avail/leaders" design is dead code.** `renderVals` still computes several values from `s.ptab` and `TREND`/`AVAIL`/`LEAD` (lines 1650–1659 and 1738–1742): `pTabs` (Search / Trending / Available / Leaders / Trade), `pRows`, `posChips`, `trendTabs` (Adds/Drops), `pTitle`, `isTrend` and `isLeaders`. **The markup binds none of them.**
>
> `pVals` also computes `trendSeg` (Trending/Recommended) and `top2`. A second local `gridGroups` (View / Week or season / Year, line 1691) exists in `renderVals`. None of these is rendered.
>
> The jump-panel entries "Players · trending", "Players · available" and "Players · leaders" therefore **all show the identical screen** described below. `TREND`, `AVAIL` and `LEAD` still matter as data sources: they seed the player DB, ownership, roster % and the Trending tiles.

---

### 1. Screens & states

All of these live inside the League screen (`scr === "league"`) when `tab === "players"` (`tabPlayers`).

| State | Exact condition | What shows |
|---|---|---|
| Players tab, base | `s.scr==="league" && s.tab==="players"` | Sticky filter bar, optional Trending section, list header, then one of three views |
| Quick-pick popover open | `s.pmenu ∈ {"status","per","pos","team"}` (`pMenuOpen = !!s.pmenu`) | Transparent full-viewport backdrop and a popover card under the filter bar |
| Trending section visible | `showTrendCard = ["all","avail","fa","w"].includes(pf2.status) && pf2.team === "All"` | "Trending" header row. Position and period do **not** affect it |
| Trending expanded | `showTrendCard && s.trendOpen` (default `true`) | Horizontal tile row |
| Trending collapsed | `showTrendCard && !s.trendOpen` | Header row only, chevron rotated 180° |
| List view | `s.pview === "list"` (**default**) | `pIsList` rows, each with its own horizontal stat strip |
| Cards view ("Stats under each player") | `s.pview === "cards"` | `pIsCards` two-line rows with the stat strip underneath |
| Sheet view | `s.pview === "sheet"` | `pIsSheet` spreadsheet: player column locked left, stat columns scroll sideways together |
| Empty result | `pNone = rows.length === 0` after filtering | "No players match these filters" inside the active view. In Sheet view the two header rows still render above it |
| Capped result | `rows.slice(0,40)` leaves exactly 40 rows (any time ≥ 40 match) | Count reads "40+" |
| Sort column hidden | `s.psort` is not in `s.pcols` (the active sort column was removed in Customize) | The list stays sorted by the hidden column and nothing indicates it (see §3) |
| Column tip (modal) | `s.colTip` is a column key (`hasColTip`) | Centred modal card over the whole phone frame |
| Customize stats sheet | `s.sheet === "grid"` (`sheetGrid`) | Bottom sheet titled "Customize stats" with column chips |
| Transaction filters sheet | `s.sheet === "filters"` (`sheetFilters`). It sits in markup range 674–681 but belongs to the Transactions screen. The Teams block shows only when `showTeamFilter = !myMoves`, where `myMoves = s.scr==="trans" && s.tMine` | Bottom sheet "Transaction filters" |
| Toast | `s.toast` non-empty | Dark pill, bottom-centred, cleared after **1800 ms** |
| Player profile over the tab | `s.prof` set (`hasProf`) | Profile overlay, z 22 (documented elsewhere) |
| Trade builder over the tab | `s.trade` set (`hasTrade`) | Trade builder, z 24 (documented elsewhere) |

**Reachable empty states.** These come from the Team filter, because some NFL teams have no player in `PDB`:
- With the default **Available** status, 12 teams render the empty state: ARI, CHI, CIN, CLE, DAL, JAX, LV, NE, NO, NYG, TEN and WAS.
- With **All players**, 6 teams are empty: CIN, JAX, LV, NYG, TEN and WAS.
- In every team-filtered state the Trending section is also hidden, because team ≠ All.

**Default state:**
- `pf2 = { status:"avail", per:"w5", pos:"All", team:"All" }`
- `pmenu:null`, `pview:"list"`, `pcols:PCOL_DEF`, `psort:"proj"`, `trendOpen:true`, `colTip:null`

---

### 2. Layout top-to-bottom

**Global type and colour:**
- Font: `'InterDisplay'` (Inter Display, loaded from rsms.me/inter) with `font-feature-settings:'tnum' 1,'cv11' 1`, antialiased.
- Line-height is `normal` unless noted.
- Text colour defaults to t1 `#1D1D1F` (`var(--x-t1)`).
- Every horizontal scroller uses class `fsm-scroll` plus `scrollbar-width:none` (the WebKit scrollbar is hidden too).

#### 2.0 Frame around the tab (league chrome, for context)

- **Status bar:** 50px.
- **League header** (outside the scroller): `padding:0 12px`, `border-bottom:1px solid` b3 `#EBEBEE`, row height 48px (49px with the border), gap 10. Contents, left to right:
  - Logo tile: 28×28, radius 8, `#07D066`, 15px logomark, margin-left 4px.
  - Home button: 38×38 circle, margin-left −6px, 20px house icon at stroke 1.5. Active state: b2 background.
  - League name `lg.name` ("Sunday Funday League"): 13px/600, ellipsis, flex 1.
  - Search, Notifications and Messages buttons: each a 38×38 circle with a 20px icon and an active state of b2.
  - Badges: 16px pills, 10px/600 white. Notifications use `#FF0028`, Messages use `#0088FF`. Each has a ring of `0 0 0 2px` b0.
- **Page scroller:** one vertical scroller (`flex:1; min-height:0; overflow-y:auto`, class `fsm-scroll`).
  - It sets no `position` or `z-index`, so it creates **no stacking context**.
  - The Players content starts at its top.
  - A CSS rule (`.fsm-scroll[style*="overflow-y"]::after`) appends a **150px** spacer. The height comes from `--x-dockpad`, which class `dock-lg` sets on league screens. This lets the last row clear the dock.
- **Dock:** overlays the bottom 148px, measured from the bottom up:
  - Tab bar: 80px, from 0 to 80px.
  - League switcher strip: 68px, from 80 to 148px. The 56px card sits inside `padding:6px 8px`, so it spans 86 to 142px.
  - Home indicator: 134×5, b0, `bottom:8px`. It is `position:absolute` with `z-index:auto`, so it paints **beneath** the z-4 tab bar and shows only through the bar's 6% transparency. It is effectively invisible.

#### 2.1 Sticky filter bar

**Container:**
- `position:sticky; top:0; z-index:6`.
- Background b0 `#FFFFFF`, `padding:10px 0 8px`, `border-bottom:1px solid` b2 `#F2F2F4`.
- Padding box: 10 + 30 + 8 = 48px. With the border the bar is 49px tall.
- It pins directly under the league header while the list scrolls.
- Because it is positioned with a z-index, it creates its own stacking context. See §4.

**Pill row:** a horizontal scroller, `display:flex; gap:6px; padding:0 12px`. It holds four pills, in this order:

| # | Key | Label when not set | Label when set | "On" when |
|---|---|---|---|---|
| 1 | `status` | "All" (when status = all) | The PSTAT label: "Available", "Free agents", "Waivers", "Rostered" or "My team" | `status !== "all"`. **The default "avail" is therefore ON (filled)** |
| 2 | `per` | "Week 5" | "Week 4", "Season" or "2025" | `per !== "w5"` |
| 3 | `pos` | "Position" | "QB", "RB", "WR", "TE", "FLEX", "K" or "D/ST" | `pos !== "All"` |
| 4 | `team` | "Teams" | The NFL abbreviation, e.g. "KC" | `team !== "All"` |

**Pill style:**
- `flex:none; height:30px; padding:0 10px 0 12px; border-radius:999px; gap:5px`, 13px/600, nowrap.
- Trailing chevron-down: a 10×10 svg on viewBox 16, path `M4 6l4 4 4-4`, stroke 2.4, round caps and joins, `currentColor`.
- On: `#fff` text on ink `#1D1D1F`.
- Off: t1 `#1D1D1F` text on b2 `#F2F2F4`.
- Ring: `inset 0 0 0 1.5px` ink, applied **only when this pill's popover is open and the pill is off**. Otherwise `none`. An "on" pill gets no ring when its menu is open.

**Quick-pick popover** (when `pmenu` is set). It is rendered inside the sticky bar.

*Backdrop:*
- `position:fixed; inset:0; z-index:7`, transparent.
- No ancestor has a transform, so it covers the **entire viewport**:
  - In the prototype, that is the whole browser window, including the jump panel outside the phone.
  - In the app, it is the whole screen: league header, list and dock.

*Card:*
- `position:absolute; left:12px; right:12px; top:calc(100% + 4px); z-index:8`.
- `100%` resolves against the sticky bar's **padding box (48px)**. The card's top edge is therefore 52px below the bar's top, which is **3px below the bar's 1px bottom border**.
- `max-height:340px; overflow-y:auto; padding:12px; border-radius:16px`, background b0.
- `box-shadow:0 10px 30px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.05)` (the README "Menus" shadow).
- Column flex, gap 10.

*Header row* (space-between):
- Title: 12px/600 t3 `#6E6E73`.
- "Reset": 12px/600 `#0088FF`, shown only when `hasReset`.

*Options grid:* `grid-template-columns:repeat(cols, minmax(0,1fr)); gap:6px`.

*Option:* `height:36px; padding:0 8px; border-radius:10px`, centred, 13px/600, nowrap.
- Selected: `#fff` on ink `#1D1D1F`.
- Unselected: t1 on b2 `#F2F2F4`.

| Popover | Title | cols | Options (in order) | Reset shown when → resets to |
|---|---|---|---|---|
| status | "Show" | 2 | All players · Available · Free agents · Waivers · Rostered · My team | `status !== "avail"` → `avail` |
| per | "Stats for" | 2 | Week 5 · Week 4 · Season · 2025 | `per !== "w5"` → `w5` |
| pos | "Position" | 4 | All · QB · RB · WR · TE · FLEX · K · D/ST | `pos !== "All"` → `All` |
| team | "NFL team" | 4 | "All teams", then all 32 `TC` keys in alphabetical order: ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS | `team !== "All"` → `All` |

The team popover has 33 options in 9 rows. That is taller than 340px, so it scrolls inside the card.

#### 2.2 Trending section (when `showTrendCard`)

**Wrapper:** `margin:10px 0 0; padding:0`.

**Header row** (the whole row is tappable): `height:28px; padding:0 16px; gap:6px`.
- Leading icon: 13×13 `ICON.trend`, path `M2.5 11.5l4-4 3 3 4-5M10 5.5h3.5V9`, stroke 1.9, colour t1.
- Label "Trending": 13px/600, flex 1.
- Trailing chevron: 11×11, path `M4 10l4-4 4 4` (points up), stroke 2.2, colour t4 `#8E8E93`.
  - Open: `transform:none`.
  - Collapsed: `rotate(180deg)` (points down).
  - No transition is set.

**Tile row** (only when `trendOpen`): horizontal scroller, `display:flex; gap:6px; padding:4px 12px 2px`.

**Tile:** `flex:none; width:190px; padding:10px; border-radius:14px`, background b1 `#F5F5F7`, column flex, gap 8. About 92px tall.
- **Top row** (tappable, opens the profile, **headshot included**): flex, gap 8.
  - FSHeadshot at size 36.
  - Text column (gap 1):
    - Line 1: `{short}` at 13px/600, ellipsis, then a space and `{pos}` at 10px (inherits 600) in `posC`.
    - Line 2: `{team} · {game}` at 10px/500 t3, ellipsis. Example: "CHI · Final L 7-31 @ GB".
  - **Tiles show no injury status.** J. Hill's "Q" does not appear here.
- **Bottom row:** `align-items:flex-end; gap:8px`.
  - Left column (flex 1, gap 1):
    - `Rost {rost} {chg}` at 11px/600 t1, nowrap. `chg` is coloured `chgC`: `#07A852` when ≥ 0, else `#FF0028`. Example: "Rost 14.8% +4.5".
    - `{adds} adds · Proj {proj}` at 10px/500 t3, nowrap. Example: "502.1K adds · Proj 15.7".
  - Right: the action pill. `height:28px; padding:0 12px; border-radius:999px`, 12px/600, `#fff` on `actC`, label `actLabel` ("Add", "Claim" or "Trade").

**Which tiles show:**
- `TREND` names, excluding any player on my team (`ownerOf().kind !== "mine"`), up to 8.
- Tiles ignore the status, position, period and team values. Status and team only decide whether the section shows. For example, with "Waivers" selected the tiles are unchanged.
- With the sample data there are 5 tiles:

  | Tile | Action | Rost | Change | Adds | Proj |
  |---|---|---|---|---|---|
  | R. Johnson | Trade | 14.8% | +4.5 | 502.1K | 15.7 |
  | J. Blue | Trade | 54.9% | +3.5 | 388.6K | 12.5 |
  | S. Tucker | Trade | 10.5% | +2.7 | 301.3K | 8.3 |
  | C. Kolar | Add | 26.8% | +2.1 | 236.5K | 9.2 |
  | J. Hill | Add | 18.2% | +1.8 | 198.2K | 7.0 |

- K. Bourne and J. Dotson are excluded because they are on my bench (`BENCH_ME`).

#### 2.3 List header row

Container: `display:flex; align-items:center; gap:8px; padding:16px 12px 6px 16px`.

**Title** (flex 1, ellipsis): `{pListTitle}` at 15px/600, then a space and `{pCount}` at 12px/500 t3. Example: "Available 34".
- `pListTitle` is "All players" when status = all, otherwise the PSTAT label.
- `pCount` is the row count, with "+" appended when it equals 40.

**View toggle** (segmented):
- Track: `padding:2px; border-radius:999px`, background b2.
- Three buttons, each `32×26`, radius 999, with a centred 14×14 icon (stroke 1.7, round caps and joins).
- On: background b0 `#fff`, colour t1, shadow `0 1px 2px rgba(0,0,0,.12)` (README segmented "on").
- Off: transparent, colour t3.

| value | `title` / aria label | icon path |
|---|---|---|
| `list` | "List" | `M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01` |
| `cards` | "Stats under each player" | `M2.5 3h11v4h-11zM2.5 9h11v4h-11z` |
| `sheet` | "Sheet" | `M2.5 3h11v10h-11zM2.5 6.5h11M2.5 9.8h11M6 3v10` |

**Customize button:**
- `height:30px; padding:0 10px; border-radius:999px; gap:5px`, 12px/600, background b2, text t1.
- Icon: 13×13 sliders, path `M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M10 3v3M6 10v3`, stroke 1.7, round caps.
- Copy: "Customize". It is a literal string; the `gridLabel` binding is unused.

#### 2.4 List view (`pIsList`, default)

Container: `padding:0 12px 20px`.

**Row:** `display:flex; align-items:center; gap:9px; min-height:58px; padding:6px 0; border-bottom:1px solid` b2 `#F2F2F4`. Contents, left to right:

1. **Action circle:** 28×28, radius 50%, `#fff` on `actC`, `title=actTip`.
   - Waiver players show the letter "W" at 11px/700, line-height 1.
   - Everyone else shows a 13×13 svg at stroke 2.4, path `actIcon`.
2. **FSHeadshot at size 36.** Not tappable.
3. **Name block:** `flex:none; width:150px; min-width:0`, column, gap 1. **Tap opens the profile.**
   - Line 1 (baseline-aligned, gap 5, nowrap):
     - `{short}` at 14px/600, ellipsis
     - `{pos}` at 10px/600 in `posC`
     - `{team}` at 10px/500 t3
     - when `hasStatus`: `{status}` ("Q") at 10px/700 `#FF0028`
   - Line 2: `{ownLabel} · Rost {rost} {chg}` at 11px/500 t3, ellipsis. `chg` is weight 600 in `chgC`: `#07A852` when > 0, `#FF0028` when < 0, t3 when 0. Example: "Free agent · Rost 12% +1.0".
   - Line 3: `{game} ({oprk})` at 11px/500 t3, ellipsis. `(oprk)` is weight 600 in `oprkC`: `#07A852` when ≥ 23, `#FF0028` when ≤ 10, `#FF8A00` otherwise. Example: "Sun 5:20 PM vs BAL (9th)".
4. **Stat strip:** a horizontal scroller, `flex:1; min-width:0; display:flex; gap:2px; margin-right:-12px; padding-right:12px`, so it bleeds to the screen edge.
   - **Each row's strip is its own scroller.** Rows are not scroll-synchronised. Only Sheet view moves every row's stats together.
   - Right-edge fade: `mask-image:linear-gradient(90deg,#000 88%,transparent)`, plus the `-webkit-` version.
   - One cell per selected column: `flex:none; width:44px`, column, `align-items:flex-end` (right-aligned), gap 1. **Tap opens the column tip for that column.**
     - Label: 9px/600 t3, nowrap, using the PCOLMETA abbreviation.
     - Value: 14px/600, nowrap, colour `c.fg` (see §5). There is no cell background in this view.
   - **Visible width:** the row content is 366px (390 − 2×12). After the circle (28), headshot (36), name block (150) and 3×9px gaps, 125px is left. Adding the 12px negative margin makes the strip box **137px**. That holds **3 full cells** (3×44 + 2×2 = 136px).
   - The mask is opaque up to about 120.6px and transparent at 137px. The third cell (92–136px) sits in the fade, so its right-aligned value is partly faded.
   - **There is no sort indicator in this view.** It shows neither a header nor the `gb` fill.

**Empty state:** `padding:36px 0`, centred, 13px/500 t3, "No players match these filters".

#### 2.5 Cards view (`pIsCards`, "Stats under each player")

Container: `padding:0 12px 20px`.

**Row:** `padding:10px 0; border-bottom:1px solid` b2. Column flex, gap 8.

**Top line** (flex, centred, gap 9):
- Action circle: 28px, identical to List view, with its own tap handler.
- FSHeadshot at size 36. **Not tappable.**
- Info block (`flex:1; min-width:0`). **Only this block opens the profile.**
  - Line 1: identical to List view line 1.
  - Line 2: `{game} ({oprk}) · {ownLabel}` at 11px/500 t3, ellipsis. `(oprk)` is weight 600 in `oprkC`. **This view has no Rost or +/- line.**

**Strip:** a horizontal scroller, one per row and not synchronised. `display:flex; gap:16px; margin-right:-12px; padding:0 12px 0 37px`.
- The 37px left inset aligns the strip under the headshot (28 + 9).
- Each item is `flex:none`, column, gap 1. Tapping it opens the column tip.
  - Label: 10px/500 t3, nowrap.
  - Value: 13px/600, colour `fg`.
- No mask.
- No sort indicator.

**Empty state:** same as List view.

#### 2.6 Sheet view (`pIsSheet`)

**Outer:** a horizontal scroller (`overflow-x:auto; padding-bottom:20px`). It is the only horizontal scroller in this view. Vertical scrolling uses the page scroller, and the header rows do **not** stick vertically.

**Inner:** `display:inline-flex; flex-direction:column; min-width:100%; padding-right:12px`. With the default 13 columns it is 818px wide (156 + 13×50 + 12).

**Group header row** (`align-items:flex-end`):
- First cell: an empty 156px cell, `position:sticky; left:0; z-index:2`, background b0, `align-self:stretch`.
- Then one cell per consecutive run of columns from the same group:
  - `width = n×50px`, `padding:0 4px 4px 6px`, 10px/600 t1, ellipsis.
  - `box-shadow:inset 1px 0 0` b3 `#EBEBEE` (a left divider line).
  - Label: the full group name when the run has 3 or more columns, otherwise the short name below.

  | Group | Short name |
  |---|---|
  | Fantasy | "Fantasy" |
  | Ownership | "Owned" |
  | Matchup | "Match" |
  | Base stats | "Base" |
  | Usage | "Usage" |
  | Advanced passing | "Adv pass" |
  | Advanced rushing | "Adv rush" |
  | Advanced receiving | "Adv rec" |

- Default render, left to right: Fantasy (250px) · Owned (100) · Match (50) · Usage (50) · Adv rec (100) · Adv rush (50) · Base (50).

**Column header row:** `height:26px; border-bottom:1px solid` b3.
- Sticky "Player" cell: 156px wide, `left:0; z-index:2`, `padding-left:12px`, background b0, 10px/600 t3.
- Column cells: `width:50px`, centred, gap 2, 10px/600, nowrap.
  - Colour: `#0088FF` for the sort column, otherwise t3.
  - The sort column also shows an 8×8 chevron-down (path `M4 6l4 4 4-4`, stroke 2.6).
  - **Tapping a header toggles the column tip. It does not sort directly.**

**Data row:** `height:46px; border-bottom:1px solid` b1 `#F5F5F7`, a lighter divider than List view.
- **Locked player cell:** `position:sticky; left:0; z-index:1; width:156px`, flex, gap 6, `padding-left:12px`, background b0, `box-shadow:inset -1px 0 0` b3 (a right divider). Contents:
  - Action circle: 22×22. Waiver players show "W" at 9px/700; everyone else an 11×11 icon at stroke 2.4.
  - FSHeadshot at size 26. **Not tappable.**
  - Name block (flex 1, `padding-right:6px`, tap opens the profile):
    - `{short}` at 12px/600, ellipsis.
    - `{pos}` at 9.5px/600 in `posC`, then a space and `{team}` at weight 500 in t3.
- **Stat cells:** `width:50px; padding:0 2px`. The inner pill is `height:24px; border-radius:6px`, centred, 12px/600, colour `c.fg` on `c.bg`. Cells are not tappable.
  - **"–" cells still get a fill:** b1 `#F5F5F7`, or gb `#E6F2FF` in the sort column, with text in t5 `#AEAEB2`.

**Empty state:** after the table, inside the horizontal scroller. Same copy and style as List view.

#### 2.7 Column tip modal (`hasColTip`, lines 1108–1116)

**Backdrop:**
- `position:absolute; inset:0` over the whole 390×844 phone, including the status bar and the dock.
- `z-index:30; background:rgba(0,0,0,.18)`, flex-centred, `padding:24px`.

**Card:**
- `width:100%; max-width:300px; padding:16px; border-radius:18px`, background b0.
- `box-shadow:0 12px 32px rgba(0,0,0,.2)`. The README says "No other shadows", but the prototype uses this one.
- Column, gap 8. Taps on the card stop propagation.

**Header row** (`align-items:flex-start; gap:8px`):
- Text column (flex 1, gap 2):
  - Abbreviation (`PCOLMETA[k][0]`, e.g. "Snap%"): 11px/600 t3.
  - Full name (`PCOLMETA[k][1]`, e.g. "Snap share"): 17px/700, letter-spacing −0.01em.
- Close button: 28×28 circle, background b2, colour t1. X icon 12×12, path `M4 4l8 8M12 4l-8 8`, stroke 2.2.

**Description:** `PCOLMETA[k][2]` at 13px/500, line-height 1.45, t2 `#3A3A3C`, `text-wrap:pretty`.

**Sort button:** `margin-top:4px; height:36px; border-radius:999px`, centred, 13px/600.
- When this column is not the sort column: "Sort by this", `#fff` on `#0088FF`.
- When it is: "Sorted by this", t2 `#3A3A3C` on b3 (the fallback here is **`#E5E5EA`**).

#### 2.8 Customize stats bottom sheet (`sheet === "grid"`)

**Sheet shell** (shared by all sheets; lines 646–651 and 724):
- **Backdrop:** `position:absolute; inset:0; z-index:20; background:rgba(0,0,0,.32)`, flex with `align-items:flex-end`.
  - It is a direct child of the 390×844 phone root, so it **dims the whole phone**: the 50px status bar, the league header, the page and the dock.
  - The README says `rgba(0,0,0,.4)`; the prototype uses **.32**.
- **Panel:** `width:100%; max-height:86%`, column, `border-radius:24px 24px 0 0`, background b0, `padding:8px 0 30px`.
- **Grab handle:** a 36×5 pill in b4 `#D1D1D6`, wrapper `padding:2px 0 8px`.
- **Header:** `padding:4px 16px 12px 20px`, gap 12.
  - Title "Customize stats": 19px/600, letter-spacing −0.02em.
  - Subtitle (grid sheet only): "Pick the stats shown in the list and sheet views", 13px/500 t3, gap 2 below the title.
  - There is no close X. The X appears only on the league switcher sheet.
- **Body:** `flex:1; min-height:0; overflow-y:auto`, class `fsm-scroll`. Because of that class, the body also picks up the 150px dock spacer.
- **Footer** (filters and grid sheets only): wrapper `padding:12px 20px 0`.
  - Button: `height:50px; border-radius:999px`, background `#0088FF`, white 16px/600 "Done".
  - Active state: `#0074DB`.

**Grid body:** one block per group, in this order: Fantasy, Ownership, Matchup, Base stats, Usage, Advanced passing, Advanced rushing, Advanced receiving.
- Group label: `padding:4px 20px 6px`, 12px/600 t3.
- Chip wrap: `display:flex; gap:6px; flex-wrap:wrap; padding:0 20px 16px`.
- Chip: `flex:none; min-width:0; padding:8px 14px; border-radius:14px`, column. About 33px tall.
  - Label: 14px/600, nowrap, using the `PCOLS[1]` long label (e.g. "Avg pts", "Snap %", "Rush share").
  - On: `#fff` on `#0088FF`.
  - Off: t1 on b2.
  - No sub-line (`hasSub` is false).

#### 2.9 Transaction filters bottom sheet (`sheet === "filters"`, lines 674–681)

Title "Transaction filters", no subtitle, with the Done footer.

**"Transaction type"** label: `padding:0 20px 6px`, 12px/600 t3.

**Type chips:** a horizontal scroller, gap 6, `padding:0 20px 14px`.
- Chip: `flex:none; height:36px; padding:0 16px; border-radius:999px`, 13px/600, nowrap.
- Selected: `#fff` on `#0088FF`. Unselected: t1 on b2.
- Chips: "All types", "Trades", "Free agents", "Waivers". Their values are All, Trades, Free agents and Waivers.

**"Teams"** block (only when `!myMoves`):
- Label: `padding:0 20px 4px`, 12px/600 t3.
- Row: `height:48px; gap:12px; margin:0 20px; border-bottom:1px solid` b2.
- Avatar: a 28px circle with an 11px/600 white initial on the team's `av`.
- Name: 14px/600, flex 1.
- Check circle: 22px.
  - On: `#0088FF`.
  - Off: background b0 with ring `inset 0 0 0 1.5px` b4 (the fallback here is `#C7C7CC`).
  - **The white check svg is always rendered**: 11px, colour `#fff`, stroke 3, path `M3 8.5l3.2 3L13 4.5`. When unchecked it is invisible in light mode (white on `#fff`) but shows as a white check in dark mode (§6).

Rows, in order:

| Row | Name shown | Initial | Avatar `av` |
|---|---|---|---|
| All teams | "All teams" | "•" | t5 `#AEAEB2` |
| TEAMS[0] | dalton | T | `#0088FF` (see note below) |
| TEAMS[1] | marcus | G | ink `#1D1D1F` |
| TEAMS[2] | priya | P | `#9D70E9` |
| TEAMS[3] | devin | E | `#F75252` |
| TEAMS[4] | sam | S | `#ECAD48` |
| TEAMS[5] | tara | B | `#5C7CE5` |
| TEAMS[6] | leo | L | `#07A852` |
| TEAMS[7] | nina | H | `#FF8A00` |
| TEAMS[8] | chris | F | t2 `#3A3A3C` |
| TEAMS[9] | owen | R | `#00A6A3` |
| TEAMS[10] | maya | M | `#E5508A` |
| TEAMS[11] | raj | R | t3 `#6E6E73` |

Notes on the rows:
- Names are the manager handles shown without "@".
- Saving "My team" settings mutates `TEAMS[0].av` and `.ini`, so the first manager row picks up the user's chosen colour and the first letter of the new team name. The row name stays "dalton".
- Checking all 12 managers does **not** collapse back to "All teams". "All teams" shows as checked only when `tTeams` is empty.

#### 2.10 Toast (line 1117)

- `position:absolute; left:50%; bottom:100px; transform:translateX(-50%); z-index:30`.
- `height:36px; padding:0 16px; border-radius:999px`, background ink `#1D1D1F`, `#fff` text, 13px/500, nowrap.
- On this screen it spans 100–136px from the phone bottom, so it **sits on top of the league switcher card** (86–142px).
- Duration: the prototype clears it after **1800 ms**. The README says "about 2.2s".

#### 2.11 FSHeadshot as used here

| Size | Ring | Initials font |
|---|---|---|
| 36px | `0 0 0 1px #fff, 0 0 0 3px {TC[team]}` | 13px/700 `#6E6E73` |
| 26px | `0 0 0 1px #fff, 0 0 0 2.5px {TC[team]}` | 9px/700 `#6E6E73` |

**Base styles:**
- The root has `title={player}`, the full name as a hover tooltip.
- The image's `alt` is the full name.
- Fallback background `#EEEEF1`. Font `'InterDisplay'`.
- When the team is unknown, the ring is `inset 0 0 0 1px rgba(0,0,0,.04)`.

**Image:**
- `src = "assets/headshots/" + HEAD[name] + ".jpg"`, e.g. `assets/headshots/robinson.jpg`.
- Style: `position:absolute; inset:0; object-fit:cover; object-position:50% 15%; transform:scale(1.25) translateY(8%)`.
- On error it falls back to initials.

**Initials:**
- Strip a trailing " D/ST", split on `/[\s'-]+/`, then take the first letter of the first part and of the last part, **uppercased**.
- Suffixes count as the last part.
- Examples:
  - "Michael Penix Jr." → "MJ" (row 1 of the default list)
  - "Eagles D/ST" → "E"
  - "49ers D/ST" → "4"
  - "Ka'imi Fairbairn" → "KF"
  - "DK Metcalf" → "DM"

**Players with a headshot file** (the 19 `HEAD` players; everyone else shows initials): Bijan Robinson, A.J. Brown, Alvin Kamara, James Conner, Shedeur Sanders, Jameson Williams, Isiah Pacheco, Evan Engram, Darnell Mooney, Braelon Allen, Cole Kmet, Adonai Mitchell, Jaylen Wright, Jahan Dotson, Justice Hill, Sean Tucker, Jaydon Blue, Roschon Johnson and Charlie Kolar.

**Team colours (`TC`):** ARI #97233F, ATL #A71930, BAL #241773, BUF #00338D, CAR #0085CA, CHI #0B162A, CIN #FB4F14, CLE #FF3C00, DAL #003594, DEN #FB4F14, DET #0076B6, GB #203731, HOU #03202F, IND #002C5F, JAX #006778, KC #E31837, LV #000000, LAC #0080C6, LAR #003594, MIA #008E97, MIN #4F2683, NE #002244, NO #D3BC8D, NYG #0B2265, NYJ #125740, PHI #004C54, PIT #FFB612, SF #AA0000, SEA #002244, TB #D50A0A, TEN #4B92DB, WAS #5A1414. The headshot file also maps WSH to #5A1414.

---

### 3. Interactions

| Element | Effect |
|---|---|
| Filter pill | `set({ pmenu: s.pmenu === k ? null : k })` toggles that pill's popover. **While any popover is open, the transparent fixed backdrop covers the entire screen**: the pills, the league header buttons, the list and the dock tab bar. See §4 for why it sits above the dock. The first tap anywhere outside the card only closes the popover (`closePMenu`) and does not reach the element underneath. Opening a different pill takes a second tap. |
| Popover option | `setF({[k]: v})` merges into `pf2` **and closes the popover** (`pmenu:null`). The list re-filters and re-sorts at once. No animation. |
| Popover "Reset" | Sets that key back to its default (status `avail`, per `w5`, pos `All`, team `All`) and closes. |
| Trending header row | Toggles `trendOpen`. The chevron rotates to 0° (open) or 180° (closed) and the tile row mounts or unmounts, with no transition. The state lasts for the app session. |
| Tile top area (headshot + name) | `openProf(n)` opens the Player profile with `prof:n, pfTab:"summary", pfYear:"2026", pfAvail:false`. |
| Tile action pill / row action circle | See `actOf` in §5. **Trade:** `openTrade(ownerOf(n).ti, [n])` opens the Trade builder (z 24), pre-filled with `{opp: ownerTeamIndex, theirs:[n], mine:[], review:false, exp:"Never", dm:true, hide:false}`. **Add / Claim / Drop:** toast only, text `"{actTip}: {full name}"`, e.g. "Add: Michael Penix Jr.", "Claim off waivers: Jordan Love", "Drop: Bijan Robinson". No confirmation and no data change; the player stays in the list. |
| Name block (List, Sheet) / info block (Cards) | `openProf(n)`. **Headshots in List, Cards and Sheet rows are not tappable.** Only trend-tile headshots are. |
| Stat strip cell (List, Cards) | `set({ colTip: k })` opens the column tip for that column. |
| Sheet column header | `set({ colTip: s.colTip === k ? null : k })` opens the tip. It never sorts directly. |
| Column tip backdrop or X | `colTip:null`. |
| Column tip "Sort by this" / "Sorted by this" | `set({ psort: colTip, colTip: null })` sorts by that column (always descending) and closes. "Sorted by this" just closes. |
| View toggle button | `set({ pview: v })` with "list", "cards" or "sheet". Filters, columns and sort carry over. |
| Customize | `set({ sheet: "grid" })` opens the Customize stats sheet. |
| Column chip (grid sheet) | **On → off:** `pcols = pcols.filter(z => z !== k)` keeps the existing order. **Off → on:** `pcols` becomes the PCOLS order filtered to k plus the already-selected columns, so **adding any column re-sorts every selected column into catalogue order**. For example, after adding Start the order is proj, avg, tot, prk, ovr, rost, chg, start, oprk, totyd, snap, ratt, tgt, tshare. The sheet stays open and the page behind updates live. There is no minimum or maximum, so zero columns is allowed: the strips are empty and Sheet shows only the Player column. **Removing the active sort column does not reset `psort`.** The list stays sorted by the now-hidden column, no view indicates it, and its tip cannot be opened until the column is re-added. |
| Sheet backdrop / Done | `sheet:null`. No swipe-to-dismiss and no X. |
| Transaction-type chip | `set({ tType: v })`. Single select; the sheet stays open. |
| Team row | "All teams" sets `tTeams = []`. Any other row toggles that team index in `tTeams` (multi-select). Selecting all 12 does not switch back to "All teams". |
| Toast | `toast(t)` clears the previous timer, shows the toast, and clears it after **1800 ms**. |

**Press states and animation:**
- No Players-tab element has a press state (`style-active`), and there are no long-press or swipe gestures.
- The only active states nearby are the sheet's Done button (`#0074DB`) and the league-header buttons (b2).
- The README's global transition rule is linear, about 200ms, on colour, opacity, width and transform only. None are declared on these elements.

---

### 4. Navigation

**Ways in:**
1. **League tab bar → "Players":** `set({ scr:"league", tab:"players", sheet:null, swap:null })`. It does **not** reset `pf2`, `pview`, `pcols`, `psort`, `trendOpen`, `pmenu` or `colTip`, so the tab reopens exactly as it was left.
2. **Home → "Trending players" → "See all"** (`homeTrendAll`): `set({ scr:"league", tab:"players", pf2:{...pf2, status:"avail"}, trendOpen:true, trendTab:"trend" })`. Status is forced to Available and Trending is expanded. Period, position and team are kept.
3. **Jump panel (prototype only):** `go(scr, tab, sub)`.
   - It sets `{ scr, sheet:null, prof:null, trade:null, settings:false, tradeOpen:null, teamView:null }`, plus `tab` when given.
   - For `league/players` with a sub other than `grid`, it also sets `ptab = sub`, which is unused. So "Players · trending / · available / · leaders" all render the same screen.
   - "Player grid settings" (`sub:"grid"`) sets `sheet:"grid"` and leaves `ptab` unchanged.
   - "Transaction filters" goes to `scr:"trans"` with `tMine:false, tType:"All", sheet:"filters"`.
   - `go()` does **not** clear `colTip` or `pmenu`, so an open column tip or popover survives a jump.
4. **Outside a league:** the root tab bar's "Players" item only toasts "Not part of this prototype".

**Back / close:**
- The Players tab is a root tab and has no back button.
- The header house icon calls `goHome`: `set({ scr:"home", sheet:null })`.
- Closing the profile (`prof:null`) or the trade builder returns to the tab with all its state intact.

**Dock on this screen:**
- **League switcher:** shown when `showSwitcher = scr==="league" && !prof && !trade && !settings`.
  - Wrapper: `position:relative; z-index:4; margin-top:-148px; padding:6px 8px`, background `rgba(29,29,31,.9)` (`--x-dockA`).
  - Card: 56px tall, radius 10, background mini `#3A3A3C`, with a 28×3 grab bar at `rgba(255,255,255,.28)`.
  - Swipe and tap are documented in the switcher section.
- **Tab bar:** `position:relative; z-index:4; margin-top:{barMt}` (0 on this screen), height 80px, `padding:6px 8px 0`, background `rgba(29,29,31,.94)` (`--x-barA`).
  - Items: Match · Team · **Players** · League · Menu.
  - Each item: flex 1, 48px tall, a 22px icon at stroke 1.5, gap 3, label 10px/600.
  - **Players is highlighted (`#fff`)** when `scr==="league" && tab==="players" && sheet!=="menu"`. Every other item is `#A1A1A6`.
  - The Players icon is the **search magnifier** `ICON.search` (`M7 2.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6zM10.6 10.6L14 14`).
  - When the Menu sheet is open, Menu turns white and Players greys out.
  - On league-context screens with `scr ≠ "league"` (e.g. `trans`, where the Transaction filters sheet lives, or `feed`), the league tab bar still shows (`inLg`) but **no item is highlighted**, even though `s.tab` is still "players".
- **Switching leagues** (swipe or the switcher sheet) changes only `s.lg`. In the prototype, Players data does not depend on the league.

**Stacking / z-order.** The phone root is `position:relative` with no z-index, and the page scroller sets neither position nor z-index. So almost everything competes in one stacking context. Bottom to top:

| Layer | z-index | Notes |
|---|---|---|
| Page scroller content (non-positioned) | — | |
| Sheet-view sticky player cells (data rows) | 1 | In the shared context, so they slide **under** the dock and the filter bar |
| Sheet-view sticky header cells (group spacer, "Player") | 2 | Same, so they scroll under the filter bar vertically |
| Home indicator | auto | Painted beneath the tab bar (§2.0) |
| Dock (switcher strip + tab bar) | 4 | |
| Sticky filter bar | 6 | **Creates its own stacking context** |
| ↳ popover backdrop (`position:fixed; inset:0`) | 7, inside the bar | Effectively at level 6: above the league header, page and dock; below sheets |
| ↳ popover card | 8, inside the bar | Effectively at level 6. It scrolls with the pinned bar and is clipped by the page scroller (its bottom edge, at most 392px below the bar's top, never reaches the dock) |
| Bottom sheets (Customize stats, Transaction filters, Menu, …) | 20 | Absolute `inset:0` on the phone root, covering the status bar, header, page and dock |
| Live TV | 21 | |
| Player profile | 22 | `top:50px`; hides the switcher, `barMt:-80px`, `dock-sm` |
| Settings / Trade detail | 23 | |
| Trade builder | 24 | |
| Page | 25 | |
| Community detail | 26 | |
| Composer | 27 | |
| Pick | 28 | |
| Global search | 29 | |
| Column tip | 30 | |
| Toast | 30 | Later in the DOM, so it sits above the column tip |

---

### 5. Data shown

**Player universe (`PDB`, 67 players):**
- Insertion order: `MINE`, `THEIRS`, `BENCH_ME`, `BENCH_THEM`, then `TREND` and `AVAIL` (only if not already present), then `LEAD` and `EXTRA`, then 7 kickers and 7 D/STs.
- Each entry is `{name,pos,team,bye,pts,proj,game}`.
- Players that come only from `LEAD`, `EXTRA` or the K/D/ST lists get `game:"Sun 1:00 PM"` with no opponent.
- `EXTRA` players (e.g. Jalen Hurts, Puka Nacua, George Kittle) are free agents here, because `ownerOf` doesn't know about `rosterOf`.

**`TREND` columns:** name, pos, team, bye, game, status, adds, add%, owner, action, rost%, wk4 pts, wk5 proj. Example: `["Roschon Johnson","RB","CHI",10,"Final L 7-31 @ GB","","+502.1K",100,"→ marcus","trade","14.8%","2.3","5.6"]`. The other rows are Jaydon Blue, Sean Tucker, Kendrick Bourne, Charlie Kolar, Justice Hill and Jahan Dotson.

| TREND index | Field | Used by the live UI? |
|---|---|---|
| 0–3 | name, pos, team, bye | Yes, identity |
| 4 | game | Yes, but only for TREND-only players. Bourne and Dotson take their game from `BENCH_ME` |
| 5 | status | **Ignored.** The `STATUS` constant is used instead |
| 6 | adds | Yes, tile adds |
| 7 | add% | Yes, becomes `chg` |
| 8 | owner | Yes, `ownerOf` |
| 9 | action | **Ignored.** The action comes from `ownerOf`, so Jahan Dotson's "add" becomes "Drop" in the list and he is excluded from the tiles |
| 10 | rost% | Yes, rost |
| 11 | wk4 pts | **Ignored** |
| 12 | wk5 proj | **Ignored.** Tile Proj is `pstat(n,"w5").proj`, so R. Johnson shows "Proj 15.7", not 5.6 |

**`AVAIL` rows:** each is `[name,pos,team,bye,game,"w"|"a",[[label,val]…]]`.
- Rows: Jordan Love (w), Malik Willis (w), Michael Penix Jr. (a), Justin Herbert (a), Braelon Allen (a), Adonai Mitchell (w).
- Only the w/a flag and the game string feed the live UI.
- Braelon Allen and Adonai Mitchell are in `THEIRS`, so they show as @marcus / Trade. Only Love and Willis end up as waiver players.

**`LEAD` rows:** each is `[name,pos,team,bye,"→ mgr",pts,[stats]]`. The rows are Josh Allen → marcus, Brock Purdy → devin, Bijan Robinson → you, Dak Prescott → nina and Alvin Kamara → marcus. Only the owner field feeds the live UI.

**Ownership (`ownerOf`):**

| Case | `kind` | ownLabel | Action |
|---|---|---|---|
| In my `slots` or `bench` | mine | "Your team" | Drop |
| In `THEIRS`/`BENCH_THEM` (→ @marcus), or TREND/LEAD owner "→ mgr" other than "you" | other | The owner's handle, e.g. "@marcus", "@nina" | Trade |
| AVAIL flag "w" and not owned | fa, waiver | "Waivers · Wed" | Claim (the circle shows the letter "W") |
| Anyone else | fa | "Free agent" | Add |

**`actOf` (in pVals):**

| Kind | `actC` | Icon | `actTip` | `actLabel` |
|---|---|---|---|---|
| trade | `#0088FF` | `M3 5.5h9.5L10 3M13 10.5H3.5L6 13` | "Propose trade" | "Trade" |
| drop | `#FF0028` | `M3.5 8h9` | "Drop" | "Drop" |
| add | `#07B85A` (green fill) | `M8 3.5v9M3.5 8h9` | "Add" | "Add" |
| w | `#C98A1F` (waiver gold) | the add icon, but the circle renders the letter "W" | "Claim off waivers" | "Claim" |

**Status filter (`stOk`):**

| Status | Rule | Count with sample data |
|---|---|---|
| `all` | Everyone | 67; the list shows 40 and the count reads "40+" |
| `avail` | `kind==="fa"` | 34 |
| `fa` | Free agents not on waivers | 32 |
| `w` | Waiver players | 2 (M. Willis, J. Love) |
| `rost` | `kind!=="fa"` | 33 |
| `mine` | My roster | 14 |

**Position filter (`posOk`):** "All", an exact match, "D/ST" (matches `DST`), or "FLEX" (matches RB, WR and TE).

**Team filter:** exact NFL team abbreviation. See §1 for the teams that produce an empty list.

**Sort:** always **descending** on `numOf`; there is no ascending toggle.
- Ties keep `PDB` insertion order (stable sort).
- Sorting runs over every matching player, then the result is **capped at 40 rows**.
- `rost`, `start`, `chg`, `oprk`: the raw number. For `oprk` this puts the easiest matchup (32nd) first.
- `prk`: −(digits only), so the best rank comes first regardless of position. Example: K14 sorts before QB16.
- `ovr`: −parseInt, so the best comes first.
- Everything else: `parseFloat(value) || -1`. "–", 0 and −1.0 all sort as −1. The resulting order is:
  1. positive values
  2. values between −1 and 0
  3. the "–"/0/−1.0 block, in PDB order
  4. values below −1
- Example, Available sorted by CPOE: M. Willis 4.1, J. Herbert 0.7, J. Love −0.2, M. Penix Jr. −0.2, then all 28 "–" players (non-QBs, kickers, D/STs), then B. Mayfield −1.2 and J. Hurts −3.1 last.
- The same edge applies to RYOE and RB receiving aDOT, which can be negative. For example, R. Johnson's −1.0 ties with blanks.

**Sort visibility:**
- The current sort is visible only in Sheet view: a blue header, the chevron and the `gb` fill on untiered cells.
- It also shows in the column tip ("Sorted by this").
- List and Cards views show no sort indication at all.

**Default list** (Available, Week 5, sorted by Proj), first rows:
1. M. Penix Jr. QB ATL · Free agent · Rost 12% +1.0 · Sun 5:20 PM vs BAL (9th) · Proj 22.4
2. J. Herbert QB LAC · Free agent · 22% +0.5 · Sun 1:05 PM vs DEN (23rd) · 22.0
3. M. Willis QB MIA · Waivers · Wed · 28% −1.3 · Q4 2:19 · 18-28 vs CIN (26th) · 20.3
4. J. Love QB GB · Waivers · Wed · 20% −0.5 · Q4 2:00 · 31-7 vs CHI (3rd) · 20.2
5. J. Hurts QB PHI · Free agent · 26% +1.5 · Sun 1:00 PM (26th) · 15.9

The full order (34 rows): M. Penix Jr., J. Herbert, M. Willis, J. Love, J. Hurts, C. Hubbard, K. Williams, B. Mayfield, D. Metcalf, C. Boswell, Z. Flowers, J. Taylor, C. Kolar, C. Sutton, B. McManus, Eagles D/ST, Y. Koo, P. Nacua, G. Kittle, Texans D/ST, Bills D/ST, J. Hill, G. Wilson, J. Myers, Jets D/ST, 49ers D/ST, K. Fairbairn, J. Elliott, Broncos D/ST, Lions D/ST, T. Kelce, H. Butker, C. Dicker, Vikings D/ST.

**Field formats:**
- `short`:
  - "F. Last …" for most names.
  - Names ending in "D/ST" are kept whole ("Eagles D/ST").
  - A first name containing "." is kept whole ("A.J. Brown").
  - "Michael Penix Jr." becomes "M. Penix Jr.".
- `pos`: "D/ST" for DST.
- `posC`: the POSTXT text-on-white colours: QB `#E03E3E`, RB `#4A68D4`, WR `#8656D8`, TE `#C98A1F`, K `#5E8C8C`, D/ST `#A68A00`.
- `status`: only the `STATUS` constant drives the red badge, so "Q" appears for James Conner and Justice Hill only. Players the Home injury card lists (line 1716) show **no** status in the Players list: Puka Nacua "Out", George Kittle "IR", Chuba Hubbard "Questionable". Production should drive the designation from injury data using the same 10px/700 `#FF0028` style.
- `game` is passed through verbatim and is **static**. The 7-second `livePlay` interval updates `gstate`/`extra` for the live games only, never these strings. Formats seen:
  - "Sun 1:00 PM vs DET"
  - "Mon 8:15 PM @ LAR"
  - "Q4 2:19 · 18-28 vs CIN" (live)
  - "Final L 7-31 @ GB"
  - "W 19-17 vs PHI"
  - "L 16-24 vs TB"
  - plain "Sun 1:00 PM"
- `rost`:
  - TREND players use `parseFloat(TREND rost%)` and keep the decimal ("14.8%", "26.8%"; "22.0%" renders as "22%").
  - Other free agents get a seeded integer from 2 to 32 ("12%").
  - Rostered players get an integer from 45 to 99.
- `chg`:
  - TREND players use `add%/22` to one decimal ("+4.5").
  - Everyone else gets the seeded `(r−.45)×3`, so the displayed range is **−1.4 to +1.6**. The sample data spans −1.3 to +1.5.
  - A "+" prefix appears when > 0, an ASCII "-" when < 0, and plain "0.0" at zero (e.g. T. Allgeier, J. Fields), shown untinted in t3.
- `start`: `round(rost × 0.35–0.85)` + "%".
- `oprk`: seeded 1–32, rendered as an ordinal ("1st", "2nd", "3rd", "4th", "11th", "21st", "23rd").
- Trend tile `adds`: the TREND adds string with "+" removed ("502.1K").
- Trend tile `proj`: always the Week 5 projection.

**Stat values (`pstat(name, per)`):** the period multiplier `G` is 1 for w5, 1 for w4, 4 for season and 17 for 2025. `wk` is the player's Week 5 projection, or a seeded base when it has none.

**What the period filter changes:**

| Columns | Week 5 | Week 4 | Season | 2025 |
|---|---|---|---|---|
| Proj `(wk×G).toFixed(1)` | wk | **same as Week 5** | wk×4 | wk×17 (always 1 decimal) |
| Avg | — | **identical in every period** (tot/gp cancels gp) | — | — |
| Tot | wk×4×(0.8–1.2) | same | same | wk×17×(same factor) |
| Counting stats via `sc()`: PaYd, PaTD, Int, RuAtt, RuYd, RuTD, Tgt, Rec, ReYd, ReTD, Att, AirYd, Sk, RZAtt, YAC, BTkl; and sums TotYd, TotTD, Tch, Opp | 1 decimal | whole number, re-randomised (×0.8–1.2) | ×4, whole | ×17, whole |
| RYOE `fx((r0−.4)×22×G)` | 1 decimal | whole, same magnitude as Week 5 | ×4 | ×17 |
| Pass aDOT, rec aDOT, YCO (via `d1()`, period-seeded) | Re-randomised within the same range each period, always 1 decimal, not scaled | | | |
| PosRk, OvrRk, Snap%, Cmp%, CPOE, RuSh%, TgtSh, Ctch%, YPRR, Rost%, Start%, +/-, OPRK | Never change with the period | | | |

Examples:
- J. Hurts: Proj 15.9 / 15.9 / 63.5 / 269.7. Avg 13.0 in every period. Tot 52.0 / 52.0 / 52.0 / 221.0. PaYd 174.5 / 189 / 994 / 3766. Pass aDOT 7.9 / 6.5 / 8.6 / 7.8. CPOE −3.1 in every period.
- B. Robinson: RYOE −6.3 / −6 / −25 / −107.

**Other stat formats:**
- `avg` and `tot` use 1 decimal; `tot` covers 4 games, or 17 for 2025.
- `prk` is POS + n ("QB18", "RB16"), with "D" + n for D/ST ("D17"). `ovr` is a whole number.
- Whole-number percentages: Snap%, Cmp%, RuSh%, TgtSh, Ctch%.
- One decimal: pass aDOT, YCO, rec aDOT, CPOE. The sign shows only when negative.
- Two decimals: YPRR.
- Missing values show "–" (U+2013 en dash).

**Blank ("–") columns by position.** These come from pstat's per-position `S` table plus explicit overrides. Verified with every column on:

| Pos | "–" columns | Columns that show |
|---|---|---|
| QB | ReYd, ReTD, Tgt, Rec, TgtSh, Ctch%, YAC, rec aDOT, YPRR, RYOE, BTkl | PaYd, PaTD, Int, Att, Cmp%, AirYd, pass aDOT, Sk, CPOE, RuAtt, RuYd, RuTD, RZAtt, RuSh%, YCO, Tch (= carries), Opp (= carries), TotYd, TotTD, Snap% |
| RB | PaYd, PaTD, Int, Att, Cmp%, AirYd, pass aDOT, Sk, CPOE | Everything else. Rec aDOT uses `d1(-1,2)` and **can be negative** (e.g. A. Kamara −0.7, R. Johnson −1.0) |
| WR | PaYd, PaTD, Int, **RuTD**, Att, Cmp%, AirYd, pass aDOT, Sk, CPOE, **RuSh%, YCO, RYOE, BTkl** | RuAtt, RuYd and **RZAtt** show, plus all receiving, usage and fantasy columns |
| TE | PaYd, PaTD, Int, **RuAtt, RuYd, RuTD, RZAtt**, Att, Cmp%, AirYd, pass aDOT, Sk, CPOE, RuSh%, YCO, RYOE, BTkl | Receiving columns, **Tch and Opp** (from Rec and Tgt), TotYd, TotTD, Snap%, fantasy columns |
| K, D/ST | Every stat column, including TotYd, TotTD, Snap%, Tch and Opp | Proj, Avg, Tot, PosRk, OvrRk, Rost%, Start%, +/-, OPRK |

**Colour rules (`cellOf` / `tierOf`):**
- **Value "–":** text t5 `#AEAEB2`. The background follows the untiered rule (b1, or gb in the sort column), which is visible in Sheet view.
- **Tiered value:** text is the tier text colour; background is the tier fill (the fill shows in Sheet view only).

  | Tier | Fill (bg) | Text (fg) |
  |---|---|---|
  | good | gg `#E3F9EC` | tg `#067A3E` |
  | mid | go `#FFF3E6` | to `#B25C00` |
  | bad | gr `#FFE9EC` | tr `#C8001C` |

- **Untiered value:** text t1 `#1D1D1F`. Background is gb `#E6F2FF` when the cell is in the current sort column, otherwise b1 `#F5F5F7`. A tier fill always wins over the sort highlight.
- **Tiered columns:**
  - oprk: ≥ 23 good, ≤ 10 bad, otherwise mid
  - chg: > 0 good, < 0 bad, 0 untiered
  - ryoe and cpoe: > 0 good, < 0 bad, 0 or "–" untiered
  - snap: ≥ 80 good, < 50 bad, otherwise mid
  - tshare: ≥ 22 good, < 12 bad, otherwise mid
  - rshare: ≥ 55 good, < 30 bad, otherwise mid
- **Separate hard-coded line colours** (these are not tints):
  - List line-2 `chg`: `#07A852` / `#FF0028` / t3
  - Tile `chg`: `#07A852` when ≥ 0, else `#FF0028`
  - OPRK in name lines: `#07A852` / `#FF0028` / `#FF8A00`

**Column catalogue** (`PCOLS` + `PCOLMETA`). "Default" gives the position in `PCOL_DEF`.

| Group | key | Chip label | Header/strip abbr | Tip name | Tip description | Default | Tier rule |
|---|---|---|---|---|---|---|---|
| Fantasy | `proj` | Proj | Proj | Projected points | FieldScout's projected fantasy points for this period. | yes (1) | — |
| Fantasy | `avg` | Avg pts | Avg | Average points | Fantasy points per game played this season, in your league's scoring. | yes (2) | — |
| Fantasy | `tot` | Total pts | Tot | Total points | Fantasy points scored this season, in your league's scoring. | yes (3) | — |
| Fantasy | `prk` | Pos rk | PosRk | Position rank | Where the player ranks at his position in total fantasy points. | yes (4) | — |
| Fantasy | `ovr` | Ovr rk | OvrRk | Overall rank | Where the player ranks among all players in total fantasy points. | yes (5) | — |
| Ownership | `rost` | Rost | Rost% | Rostered | Share of leagues where the player is on a roster. | yes (6) | — |
| Ownership | `chg` | +/- | +/- | Roster change | Change in rostered % over the last 7 days. | yes (7) | >0 good · <0 bad |
| Ownership | `start` | Start | Start% | Started | Share of leagues where the player is in a starting lineup. | | — |
| Matchup | `oprk` | OPRK | OPRK | Opponent rank | How generous this week's defense is to the position. Higher means an easier matchup. | yes (8) | ≥23 good · ≤10 bad · else mid |
| Base stats | `totyd` | Tot yds | TotYd | Total yards | Passing, rushing and receiving yards combined. | yes (13) | — |
| Base stats | `tottd` | Tot TD | TotTD | Total touchdowns | Passing, rushing and receiving touchdowns combined. | | — |
| Base stats | `pyd` | Pass yds | PaYd | Passing yards | Yards gained through the air. | | — |
| Base stats | `ptd` | Pass TD | PaTD | Passing touchdowns | Touchdown passes thrown. | | — |
| Base stats | `int` | Int | Int | Interceptions | Passes caught by the defense. | | — |
| Base stats | `ryd` | Rush yds | RuYd | Rushing yards | Yards gained on carries. | | — |
| Base stats | `rtd` | Rush TD | RuTD | Rushing touchdowns | Touchdowns scored on carries. | | — |
| Base stats | `recyd` | Rec yds | ReYd | Receiving yards | Yards gained on catches. | | — |
| Base stats | `rectd` | Rec TD | ReTD | Receiving touchdowns | Touchdowns scored on catches. | | — |
| Usage | `snap` | Snap % | Snap% | Snap share | Share of the team's offensive snaps the player was on the field for. | yes (9) | ≥80 good · <50 bad · else mid |
| Usage | `touch` | Touches | Tch | Touches | Carries plus receptions. | | — |
| Usage | `opp` | Opps | Opp | Opportunities | Carries plus targets. A volume measure that doesn't depend on efficiency. | | — |
| Advanced passing | `patt` | Att | Att | Pass attempts | Passes thrown. | | — |
| Advanced passing | `cmp` | Cmp % | Cmp% | Completion % | Share of passes completed. | | — |
| Advanced passing | `airyd` | Air yds | AirYd | Air yards | Yards the ball travels past the line of scrimmage on all attempts. | | — |
| Advanced passing | `padot` | aDOT | aDOT | Average depth of target | Average air yards per pass attempt. Higher means more downfield throws. | | — |
| Advanced passing | `sack` | Sacks | Sk | Sacks taken | Times the quarterback was sacked. | | — |
| Advanced passing | `cpoe` | CPOE | CPOE | Completion % over expected | Completion rate compared with what an average QB would hit on the same throws. | | >0 good · <0 bad |
| Advanced rushing | `ratt` | Rush att | RuAtt | Rush attempts | Carries. | yes (12) | — |
| Advanced rushing | `rshare` | Rush share | RuSh% | Rush share | Share of the team's carries. | | ≥55 good · <30 bad · else mid |
| Advanced rushing | `yco` | YCO/att | YCO | Yards after contact per attempt | Average yards gained after the first defender makes contact. | | — |
| Advanced rushing | `ryoe` | RYOE | RYOE | Rush yards over expected | Rushing yards above what an average back would gain on the same carries. Positive means the runner is creating. | | >0 good · <0 bad |
| Advanced rushing | `btk` | Broken tkl | BTkl | Broken tackles | Tackle attempts the runner broke or avoided. | | — |
| Advanced rushing | `rz` | RZ att | RZAtt | Red zone attempts | Carries inside the opponent's 20 yard line. | | — |
| Advanced receiving | `tgt` | Tgt | Tgt | Targets | Passes thrown to the player. | yes (10) | — |
| Advanced receiving | `tshare` | Tgt share | TgtSh | Target share | Share of the team's targets that went to this player. | yes (11) | ≥22 good · <12 bad · else mid |
| Advanced receiving | `rec` | Rec | Rec | Receptions | Passes caught. | | — |
| Advanced receiving | `catch` | Catch % | Ctch% | Catch rate | Receptions divided by targets. | | — |
| Advanced receiving | `yac` | YAC | YAC | Yards after the catch | Yards gained after securing the catch. | | — |
| Advanced receiving | `radot` | aDOT | aDOT | Average depth of target | Average air yards on targets. Higher means a more downfield role. | | — |
| Advanced receiving | `yprr` | YPRR | YPRR | Yards per route run | Receiving yards divided by routes run. One of the strongest signals of a real breakout. | | — |

`PCOL_DEF` order is `proj, avg, tot, prk, ovr, rost, chg, oprk, snap, tgt, tshare, ratt, totyd`. This is **not** catalogue order, so the default sheet shows split group headers.

**Cross-screen inconsistency (flag for a single data source).** The Players tab computes Rost%, Start% and OPRK from `info()` (seeded `n+"own"` and `n+"op"`). The Team tab's `rowFor` (line 1638–1640) uses different sources:
- hard-coded rost `[55,99,92,98,76,62,88,71,44]` and start `[47,98,84,91,38,39,70,65,30]` for my starters
- a hard-coded `OPRK` table
- a different seeded formula for everyone else
- an OPRK "good" threshold of **≥ 20**, against **≥ 23** here

For example, B. Robinson is 90% rostered on Players and 99% on Team.

**Which parts are real product data:**
- **From the league backend** (UI-only and mock for now, per CLAUDE.md): roster ownership (mine, another manager, free agent, waivers), the waiver clear day (League settings shows "Waivers process: Wed 12:00 AM"), and the Add, Claim, Drop and Trade actions.
- **From the stats/projections provider:** player identity, position, NFL team, injury status, the game / kickoff / live-score string, opponent rank, per-period stats and projections, snap, target and rush share, and advanced metrics.
- **Platform-wide aggregates:** Rost%, Start%, 7-day +/-, and trending adds.
- **Placeholder in the prototype:** every number is seeded or random (the `seeded()` LCG). Only names, teams and positions are real.

---

### 6. Dark mode

Dark mode applies `.fs-dark` on the phone root. Light values are the `var()` fallbacks.

| Token | Light | Dark | Used here for |
|---|---|---|---|
| `--x-t1` | #1D1D1F | #FFFFFF | Names, off-pill text, values, "Trending", list title |
| `--x-t2` | #3A3A3C | #D9D9D9 | Tip description, "Sorted by this" text, @chris avatar in the team filter |
| `--x-t3` | #6E6E73 | #B3B3B3 | Meta lines, count, labels, popover title, off segment icons, unsorted headers, @raj avatar |
| `--x-t4` | #8E8E93 | #A7A7A7 | Trending chevron |
| `--x-t5` | #AEAEB2 | #727272 | "–" values, "All teams" avatar |
| `--x-b0` | #FFFFFF | #121212 | Page, sticky filter bar, popover card, segmented "on", sticky sheet column, tip card, bottom sheet, unchecked team circle, home indicator |
| `--x-b1` | #F5F5F7 | #282828 | Trend tiles, sheet cell fill (including "–" cells), sheet row divider |
| `--x-b2` | #F2F2F4 | #333333 | Off pills and options, segmented track, Customize button, list dividers, filter-bar divider, tip close button, grid chips (off), type chips (off) |
| `--x-b3` | #EBEBEE (#E5E5EA in the tip button) | #3E3E3E | Sheet header and column dividers, "Sorted by this" background |
| `--x-b4` | #D1D1D6 (#C7C7CC in the team check ring) | #575757 | Sheet grab handle, unchecked ring |
| `--x-ink` | #1D1D1F | #4D4D4D | On pills, selected popover options, pill focus ring, toast, @marcus avatar |
| `--x-gg` / `--x-tg` | #E3F9EC / #067A3E | #12301F / #1ED760 | Good tier |
| `--x-go` / `--x-to` | #FFF3E6 / #B25C00 | #3A2A14 / #FFB340 | Mid tier |
| `--x-gr` / `--x-tr` | #FFE9EC / #C8001C | #3A1A1D / #FF6B6B | Bad tier |
| `--x-gb` | #E6F2FF | #12263F | Sorted-column cell fill (including "–" cells) |
| `--x-dockA` / `--x-barA` / `--x-mini` | rgba(29,29,31,.9) / rgba(29,29,31,.94) / #3A3A3C | rgba(18,18,18,.86) / rgba(18,18,18,.92) / #090909 | Switcher strip, tab bar, switcher card |

**Dark-mode details for the Transaction filters sheet:**
- The **always-rendered white check** inside an unchecked team circle becomes visible: a white check on #121212 with a #575757 ring. In light mode it is invisible (white on #fff). This needs a deliberate decision.
- The @chris avatar (t2) becomes #D9D9D9 with a white "F", which is very low contrast.
- The @marcus avatar becomes #4D4D4D, @raj #B3B3B3, and "All teams" #727272.

**Values that stay the same in dark mode:**
- Accent and action colours: `#0088FF` (sort header, Reset, Sort-by button, grid chip on, type chip on, Done, Trade), `#07B85A`, `#FF0028`, `#C98A1F`, and the white text on them.
- Team-filter avatar colours that are hard-coded hex: #0088FF, #9D70E9, #F75252, #ECAD48, #5C7CE5, #07A852, #FF8A00, #00A6A3, #E5508A.
- Hard-coded line colours: `#07A852`, `#FF0028`, `#FF8A00` (chg and OPRK in name lines). These are not the README's dark success text #1ED760.
- POSTXT position colours.
- Popover and tip shadows, and the backdrops `rgba(0,0,0,.18)` (tip) and `.32` (sheet).
- Headshot white gap ring `#fff`, fallback background `#EEEEF1`, and initials `#6E6E73`.
- Tab-bar item colours `#fff` / `#A1A1A6`.

---

### Open questions
- Critic finding partly disproved (period filter): the critic said pass aDOT, rec aDOT and YCO never change with the period. They do: d1() uses the period-seeded r(), so they re-randomise each period within the same range, unscaled and always 1 decimal (e.g. J. Hurts pass aDOT 7.9 / 6.5 / 8.6 / 7.8). Only PosRk, OvrRk, Avg, Snap%, Cmp%, CPOE, RuSh%, TgtSh, Ctch%, YPRR, Rost%, Start%, +/- and OPRK stay fixed. The rest of that finding holds and is incorporated. Production should show real per-period values for these metrics; confirm.
- Critic finding refined (sort edge): the critic said negative values sort below '–' and 0. Only values below −1 do. Values between −1 and 0 (e.g. CPOE −0.2) sort above the blank block, and exactly −1.0 ties with blanks (e.g. R. Johnson rec aDOT −1.0). The critic's own CPOE example matches this and is incorporated. Should blanks always sort last, with negatives sorting normally?
- Transaction filters sheet: the white check svg is always rendered, so an unchecked team circle shows a white check in dark mode but nothing in light mode. Render the check only when selected?
- Checking all 12 managers in the Teams filter does not collapse back to 'All teams'. Should it?
- Removing the active sort column in Customize stats leaves psort on a hidden column: the list stays sorted by it, nothing indicates it, and its tip cannot be reopened. Reset the sort to Proj, or block removing the sort column?
- List and Cards views show no sort indication (no header and no gb fill); only Sheet view and the tip ('Sorted by this') do. Add an indicator to List and Cards?
- Injury status in the list comes only from the STATUS constant (Q for James Conner and Justice Hill). Puka Nacua (Out), George Kittle (IR) and Chuba Hubbard (Questionable) from the Home injury card show nothing on Players. Confirm production drives the badge from injury data, and which letters to show for Out, IR, Doubtful and so on.
- The Players tab and the Team tab disagree on Rost%, Start% and OPRK (e.g. B. Robinson 90% vs 99% rostered), and on the OPRK 'good' threshold (≥23 here, ≥20 on Team). Confirm one data source and one threshold (the README says ≥23).
- On the Players tab the toast (bottom 100px, 36px tall, z 30) sits directly over the league switcher card (86–142px from the bottom). Keep this position, or raise the toast above the dock on league screens?
- The popover backdrop is position:fixed inside the z-6 sticky bar, so it covers the league header and the dock too. A tap on the tab bar or header while a popover is open only closes the popover. Replicate this, or let header and dock taps through?
- The home indicator (z auto) paints beneath the z-4 tab bar and is effectively invisible. Is that intended, or should it sit above the bar? (This belongs to the dock section; noted here because it shares the stacking context.)
- README conflicts: the bottom-sheet backdrop is rgba(0,0,0,.32) in code vs .4 in the README; the toast clears after 1800 ms in code vs about 2.2s in the README; the README says 'No other shadows' but the column tip card uses 0 12px 32px rgba(0,0,0,.2). Which wins?
- The ptab design (Search/Trending/Available/Leaders/Trade tabs with Adds/Drops, built from TREND/AVAIL/LEAD), the Trending/Recommended segmented control (trendSeg) and a second gridGroups (View / Week or season / Year) are all computed in the script but never rendered. The jump-panel entries 'Players · trending/available/leaders' all show the same screen. Confirm these are intentionally dropped and should not be built.
- The status pill is filled black at the default 'Available' (on = status !== 'all'), while its Reset link is hidden (the reset target is 'avail'). Is a filled pill in the default state intended?
- The README says 'List/Sheet toggle', but the prototype has three views: List, 'Stats under each player' (cards) and Sheet. Build all three?
- Tapping a Sheet column header opens the column tip rather than sorting. Sorting happens only through 'Sort by this' and is always descending, with no ascending toggle. Rank columns sort best-first; OPRK sorts easiest-first. Confirm, and say whether ascending is wanted.
- Rost% renders with a decimal for trending players (e.g. '14.8%', '26.8%') and as a whole number for everyone else. Which format should production use?
- The list is capped at 40 rows and the count reads '40+', even when exactly 40 match. Production needs a real pagination or infinite-scroll rule.
- Add, Claim and Drop only show a toast ('Add: {name}', 'Claim off waivers: {name}', 'Drop: {name}'). There is no confirmation and no roster change, and Drop on my own player has no confirm. What should the real flows be? (The league backend is UI-only, so stub for now.)
- The bottom-sheet scroller has class fsm-scroll and overflow-y, so the global CSS adds a 150px dock spacer at the bottom of the Customize stats sheet. Is this a prototype artifact to drop?
- Column order: the default PCOL_DEF is not in catalogue order (Tot yds sits last; Usage comes before Adv rec and Adv rush). Adding any column re-sorts all selected columns into catalogue order; removing keeps the order. Should columns always follow catalogue order, or keep the user's order?
- Customize allows zero columns, with no minimum or maximum. Is that OK?
- When a filter popover is open, a transparent backdrop eats the next tap, so switching to another pill takes two taps. Replicate this, or let a tap on another pill switch directly?
- Trending tiles ignore the status, position and period filters, always show the Week 5 projection, cap at 8 and exclude my own players. The Team filter and the Rostered/My team statuses hide the whole section. Confirm.
- 'Waivers · Wed' is a hard-coded clear day; League settings shows 'Waivers process: Wed 12:00 AM'. Should the label come from league waiver settings?
- Twelve NFL teams return the empty state under the default Available filter (six have no players at all in the sample DB). Is the generic 'No players match these filters' copy fine for a team-filtered empty list?
- The jump panel's go() does not clear colTip or pmenu, so an open column tip or popover survives a jump (prototype only). Should leaving the Players tab in the app close the tip and popover?

---

## Gap analysis vs the current app

## League › Players tab: gap analysis (mobile spec vs app at `redesign-v7` HEAD 27d455b)

**Files checked:**
- `src/app/app/(shell)/leagues/[leagueId]/players/page.tsx`
- `src/components/leagues/players-page.tsx`, `players-page-ops.ts`, `league-shell.tsx`, `league-shell-ops.ts`, `my-team-ops.ts`, `drop-player-dialog.tsx`, `claim-dialog.tsx`, `league-cells.tsx`, `activity-page-ops.ts`
- `src/components/players/players-spreadsheet.tsx`, `player-image.tsx`, `player-page-ops.ts`, `player-detail-page-view.tsx`, `player-card-league-ops.ts`
- `src/components/home/trending-players-card.tsx`, `waiver-adds-card.tsx`
- `src/components/layout/bottom-tabs.tsx`
- `src/components/ui/{sheet,popover,toast,toaster,tabs}.tsx`
- Hooks: `use-draft-pool.ts`, `use-pool-values.ts`, `use-player-usage.ts`, `use-nfl-week-games.ts`, `use-league.ts`, `use-leagues.ts`
- Server and data: `src/lib/leagues/api/pool-values-service.ts`, `activity-service.ts`, `src/lib/players/core-stats-service.ts`, `src/lib/leagues/stats/stat-keys.ts`, `src/lib/sync/usage.ts`
- Other: `src/lib/nfl-team-colors.ts`, `src/lib/feature-flags.ts`, `src/stores/theme-store.ts`, `tailwind.config.ts`
- Schema in `src/types/database.ts`: `player_stats` (incl. `advanced` JSONB), `player_usage`, `nfl_games`, `defense_position_splits`
- Migrations `036_player_usage_table.sql`, `109_inseason_tables.sql`

**Where the app is today:**
- The league Players page (`players-page.tsx`) is a desktop-style page with these parts, top to bottom:
  - a "Roster move" panel
  - a search input
  - a position Segment: All, QB, RB, WR, TE, K, D/ST (no FLEX)
  - an availability Segment: Free agents, On rosters, All
  - one table with columns Player (sticky), Opp, Proj, Pts, Avg, Status (lock), Availability and Move
- Its data is real and server-backed:
  - the player search window: `useDraftPool`, ADP-ordered, 300 rows
  - rosters and the waiver pool: `useRostersLive`, `useLeaguePoolLive`
  - league-scored projection and season points: `/api/leagues/[id]/player-values`
  - this week's opponent: `nfl_games`
- No mobile league component exists yet. The `m-*` tokens added at HEAD are not used anywhere.
- **Advanced stats are deliberately unfunded.** `stat-keys.ts` says "advanced stats punted until funded", and `player_stats.advanced` stays `{}`.
- **No roster %, start %, 7-day change or trending-adds data exists anywhere.**
  - Home `TrendingPlayersCard` substitutes a projection-vs-last-season delta and is marked TODO(data).
  - `WaiverAddsCard` is mock data.

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| League header: logo tile, Home button, league name, Search / Notifications / Messages buttons with badges | new-ui-on-existing-data | `league-shell.tsx` (`LeagueHeaderParts`: identity plus a sideways-scrolling subnav on mobile); `use-notifications.ts`; command palette / `top-search.tsx`; `rail/messages-panel.tsx` | Notifications are real. Messages are mock behind `featureFlags.messages`, so the Messages badge is mock until a DM backend exists. |
| League tab bar dock: Match · Team · Players · League · Menu; Players uses the magnifier icon and is white when active; no highlight on `trans`/`feed` | new-ui-on-existing-data | `bottom-tabs.tsx` (global Home / Lists / Players→`/app/players` / Search / More); `league-shell-ops.ts` `leagueTabs` (Home, My Team, Matchup, Players, Schedule, Stats + More) | Needs a league-context bottom bar. Which current tabs fold into "League" and "Menu" is an IA mapping covered in other sections. |
| League switcher strip (56px card above the tab bar, swipe to switch) | new-ui-on-existing-data | `use-leagues.ts`, `leagues-index.tsx` | Documented in the switcher section. Players data is per league in the app (unlike the prototype), so switching must refetch. |
| 150px dock-clearance spacer under the scroller | restyle-only | n/a | Layout only. |
| Tab state kept across tab switches (filters, view, columns, sort, Trending open) | new-ui-on-existing-data | `players-page.tsx` keeps everything in local `useState`, so it is lost on navigation | Needs a Zustand UI store (CLAUDE.md: client UI state goes in Zustand). |
| Home "Trending players" → "See all" deep link (forces Available, expands Trending) | new-ui-on-existing-data | `home/trending-players-card.tsx` (no See all; global, not league) | The link is trivial. The league Trending it lands on depends on the trending backend below. |
| Sticky filter bar: 4 pills with chevrons; on = ink fill, off = b2; ring when the pill's own menu is open | restyle-only | `players-page.tsx` uses `Input` + two `Segment`s | Replaces the Segments. Status and Position behaviour exist; Period and Team pills are new (rows below). |
| Quick-pick popover: backdrop, card under the bar, title, Reset, option grid, closes on select | restyle-only | `ui/popover.tsx` | Radix Popover covers the outside-tap-to-close behaviour. The fixed backdrop that swallows the first tap is the prototype's mechanism; match it only if wanted. |
| Status filter: All players · Available · Free agents · Waivers · Rostered · My team (default Available) | new-ui-on-existing-data | `players-page-ops.ts` `PoolScope` (free_agents / rostered / all), `Availability` kinds `free_agent` / `on_waivers` / `rostered{mine}` | Every split is derivable from `poolRows` data. The app's default "Free agents" scope already includes waivers, so it equals the design's "Available". |
| Period filter: Week N · Week N-1 · Season · prior season | new-ui-on-existing-data | `pool-values-service.ts` (this week's projection + points before `week` only); `/api/players/builder` (`stats_current` / `stats_last`, preset scoring) | Weekly lines exist in `player_stats`, but the league values read needs a period param. Needs a product definition: the prototype's "Week 4 Proj = Week 5 Proj" and "Avg identical in every period" are placeholder artefacts, not intent. |
| Position filter incl. FLEX (RB/WR/TE) | new-ui-on-existing-data | `POSITIONS` in `players-page-ops.ts`; `use-draft-pool.ts` filters `.eq('position')` | FLEX needs an `in` filter. D/ST maps to DEF. |
| NFL team filter (All teams + 32) | new-ui-on-existing-data | `players.team`; `players-spreadsheet.tsx` already has a "Pro team" select over `NFL_TEAM_COLORS` | `useDraftPool` has no team param; add one server-side. Never filter the 300-row window client-side (the 1000-row lesson). |
| In-tab player search | out-of-scope-or-question | `players-page.tsx` "Search players" input (server-side `ilike`) | The design has no search on the tab; the header Search button is global search. Keep a search on the mobile tab, or rely on global search? |
| Trending section: collapsible header, chevron, shown only for status ∈ all/avail/fa/w and team = All | needs-new-backend | none | The toggle is UI-only, but the section has nothing real to show without trending data. |
| Trending tiles: headshot, short name, pos, team · game, Rost % + change, adds count, Proj, action pill; excludes my players | needs-new-backend | `trending-players-card.tsx` (proxy delta, TODO(data)); `waiver-adds-card.tsx` (mock) | No adds / rost% / roster-change source exists. Product question: FieldScout-wide league aggregates (tiny 2026 cohort) or an external trending feed (e.g. Sleeper trending; no-scraping rule applies)? |
| List header: title + count ("Available 34", "40+") | new-ui-on-existing-data | `players-page.tsx` (no count) | The app sorts inside a 300-row ADP window (`POOL_WINDOW`), not over all matches as the spec does. Sorting by Proj can miss deep free agents. Show the cap honestly. |
| View toggle: List / Stats under each player (Cards) / Sheet | new-ui-on-existing-data | single table in `PoolTable`; `ui/tabs.tsx` Segment | Three renderings of the same rows. |
| Customize button + "Customize stats" bottom sheet (grouped chips, live update, catalogue-order re-sort, Done) | new-ui-on-existing-data | `ui/sheet.tsx` (side=bottom); precedent: `players-spreadsheet.tsx` `CustomizePopover` / bands; the league table has fixed columns | Offer only columns that have data (see the column rows). The prototype allows zero columns; decide a minimum. |
| Action circle: Add (green +), Claim (gold "W"), Drop (red −), Trade (blue ⇄) | restyle-only | `players-page.tsx` `MoveButton`: one green "+" via `acquireAction` (add or claim, `data-acquire`), Drop button, Trade link | All four verbs exist. The circle needs the claim/add kind (already computed) to show "W". |
| Add / Claim behaviour (prototype: toast only, no confirm) | restyle-only | `claim-dialog.tsx` (FAAB bid / priority, optional drop), `useAddDrop`, `useSubmitClaim`, `moveReadout` | Keep the app's "Always confirm first" ruling (D481(n)). Restyle the dialog as a mobile bottom sheet; the server readout replaces the "Add: name" toast. |
| Drop from the Players tab | out-of-scope-or-question | `players-page.tsx` arms the desktop "Roster move" panel; `drop-player-dialog.tsx` `DropConfirm` exists | The design has no Move panel. On mobile, use `DropConfirm` (as on the team page) and drop the panel? |
| "Roster move" panel (add slot, drop select, Make move, roster fill) | out-of-scope-or-question | `players-page.tsx` `MovePanel` | Not in the design; keep, fold into the confirm sheet, or remove on mobile? |
| Trade action → trade builder pre-filled with the owner team + player | restyle-only | `tradesHref(leagueId, {teamId, playerId})` | The app hides Trade past the deadline (L.D3.12) and for unmanaged teams (R1410). Keep those rules. |
| Headshot 36 / 26 with team-colour ring and initials fallback | restyle-only | `players/player-image.tsx` (`headshot_url`), `lib/nfl-team-colors.ts` | D/ST shows the team logo in the app, not the prototype's "E" initials. Keep the logo. |
| Name line: short "F. Last", pos colour, team, red injury badge ("Q") | restyle-only | `PoolTable` shows `full_name`, `PositionBadge`, and "· Questionable" from `players.status` | Injury data is real (the spec asks production to use it). Needs abbreviation mapping (Q / O / IR / D) and short-name formatting. |
| Ownership line: "Free agent" / "Waivers · Wed" / "Your team" / "@handle" | restyle-only | `AvailabilityCell` (`waivers_until`, `TeamNameLink`); `use-league.ts` `members[].profiles.username` | The app shows the team name; the design shows the manager handle. Any handle shown must link to the profile (ruling 2026-09-30). The "Rost x% ±y" part needs new backend (see below). |
| Game line: kickoff / live score + clock / Final W-L + tinted OPRK ordinal | new-ui-on-existing-data | `opponentOf` → "vs DAL" / "@ DAL" / "BYE" only; `nfl_games` has `kickoff_at`, `status`, scores, `quarter`, `game_clock`; `oprkOf` / `oprkTone` / `OPRK_PILL` in `my-team-ops.ts` | OPRK is used on My Team and the player page, not on the league Players page yet. The app's single band rule (D486(16): 1–10 red, 23–32 green) already matches the spec and resolves the spec's Players-vs-Team inconsistency. Make the line live off `nfl_games`, not static strings. |
| Game-lock 🔒 state, locked Add/Drop | restyle-only | `PoolTable` Status column, `LockTag`, `lockBadgeFor` | Not in the design; extend the design language (CLAUDE.md: keep app states). |
| List view: per-row horizontal stat strip (44px cells, about 3 visible, right fade, tap → column tip) | new-ui-on-existing-data | none | Each row scrolls on its own (no sync). |
| Cards view: two-line row with the stat strip underneath (37px inset) | new-ui-on-existing-data | none | |
| Sheet view: sticky 156px player column, group header bands, 50px cells, blue sort header + chevron, tier / sort fills | new-ui-on-existing-data | `PoolTable` already has a sticky Player column + sideways scroll; `players-spreadsheet.tsx` has group bands | Mostly a restyle of existing patterns, plus the new columns. |
| Column tip modal: abbreviation, full name, description, "Sort by this" / "Sorted by this" | new-ui-on-existing-data | `players-spreadsheet.tsx` `COLUMNS[].full` has full names; no descriptions exist | New copy (descriptions are in the spec catalogue). |
| Sort model: descending only, set from the tip; header tap opens the tip; sort indicator only in Sheet; a removed sort column keeps sorting invisibly; "–"/0/−1 all sort as −1 | out-of-scope-or-question | `nextSort` (header tap toggles asc/desc); `sortPoolRows` (missing values sink to the bottom) | Should mobile drop ascending sort? The hidden-sort-column and "–"-as-−1 behaviours look like prototype bugs; recommend keeping the app's null-sinks rule and resetting the sort when its column is removed. |
| Tier colouring (good / mid / bad): OPRK, +/-, RYOE, CPOE, Snap%, TgtSh, RuSh%; sort-column gb fill | new-ui-on-existing-data | `OPRK_PILL` tokens; `m-gg` / `m-tg` / `m-gr` / `m-tr` / `m-gb` added in `tailwind.config.ts` at HEAD | Rules only matter for columns that have data. |
| Empty state "No players match these filters" | restyle-only | `emptyCopy(scope, hadSearch)` + Card in `PoolTable` | The app's copy is reason-specific. Keep that, restyled. |
| Loading / error-retry / stale / reconnecting / values-problem / waiver-window / waivers-paused / no-seat states | restyle-only | `players-page.tsx` (`PlayersSkeleton`, `ProblemCard`, `StatusBanner`s, `NO_SEAT_COPY`) | Not in the prototype; extend the design language. |
| Toast (ink pill, bottom 100px, 1.8s) | restyle-only | `ui/toast.tsx`, `ui/toaster.tsx` | Spec 1.8s vs README 2.2s; pick one. It overlaps the switcher card. |
| Name tap → player profile | restyle-only | `PlayerLink` + `leagueCardContext` | The app opens the mini card first, then Expand (ruling 2026-10-05). The prototype's direct `openProf` is superseded. Only trend-tile headshots are tappable. |
| Fantasy columns: Proj, Avg, Tot | restyle-only | `usePoolValues` → `projected_points`, `season_points`, avg via `valueCells` | The app's "Pts" is season-to-date before this week. |
| Position rank / overall rank columns | new-ui-on-existing-data | `core-stats-service.ts` computes positional + overall rank (whole-pool `seasonToDate`) for one player | Expose the ranks in the list values read. The research grid derives ranks client-side. |
| Rost%, Start%, +/- (7-day) columns and the list line | needs-new-backend | none (`waiver-adds-card.tsx` is mock) | Platform-wide ownership / start / trend aggregates; needs a source decision. |
| OPRK column | new-ui-on-existing-data | `defense_position_splits`, `oprkOf` | Same data as the game-line OPRK. |
| Base stats: TotYd, TotTD, PaYd, PaTD, Int, RuYd, RuTD, ReYd, ReTD | new-ui-on-existing-data | `player_stats` columns; `/api/players/builder` season totals | The league page doesn't fetch box stats yet. Per-period values depend on the Period row. |
| Usage: Snap% | new-ui-on-existing-data | `player_usage.snap_pct` (season-level), `use-player-usage.ts` | Season-level only (QB/RB/WR/TE), which matches the spec's "never changes with period". |
| Usage: Touches, Opps | new-ui-on-existing-data | derived from `rush_attempts` + `receptions` / `targets` | Pure derivation. |
| Advanced passing: Att, Cmp%, Sacks | new-ui-on-existing-data | `pass_attempts`, `pass_completions`, `sacks_taken` | Cmp% is derived. |
| Advanced passing: Air yds, aDOT, CPOE | needs-new-backend | `stat-keys.ts` (advanced punted); `player_stats.advanced` empty | Needs a funded advanced feed. |
| Advanced rushing: Rush att | new-ui-on-existing-data | `rush_attempts` | |
| Advanced rushing: Rush share | needs-new-backend | `lib/sync/usage.ts` computes snap% / target share only | Small: extend the usage sync (team rush-attempt sums) like `target_share`. |
| Advanced rushing: YCO, RYOE, Broken tkl, RZ att | needs-new-backend | not stored | Needs a tracking / charting feed. |
| Advanced receiving: Tgt, Rec, Catch% | new-ui-on-existing-data | `targets`, `receptions` | Catch% is derived. |
| Advanced receiving: Tgt share | new-ui-on-existing-data | `player_usage.target_share` | Season-level. |
| Advanced receiving: YAC, rec aDOT, YPRR | needs-new-backend | not stored | YPRR needs route data. |
| Per-position "–" blanks (en dash) | restyle-only | the app uses "—" (em dash) | Cosmetic. Blank-vs-zero must stay honest (null ≠ 0, as `pointsText` already does). |
| Transaction filters sheet: type chips All types / Trades / Free agents / Waivers | new-ui-on-existing-data | `activity-service.ts` (`type` CSV of `transactions.type` incl. `waiver_claim`, `topic=trades`); `activity-page-ops.ts` tabs All / Adds & drops / Trades / Commissioner / Stat corrections | The FA-vs-waivers split is possible through `type`. Note `topic=trades` can't be combined with `type` / `team_id`. |
| Transaction filters sheet: Teams multi-select (avatars, check circles, All teams, hidden for My moves) | new-ui-on-existing-data | `activity-service.ts` `team_id` (single); `Crest` initials; `team-transactions-panel.tsx` (My moves on My Team) | Multi-select needs the API to take several teams. Team avatar colours are not stored (`Crest` = initials on neutral); colour comes from the My-team settings section. |
| Dark mode for this tab (incl. the visible white check in unchecked team circles, low-contrast @chris / @raj avatars) | out-of-scope-or-question | `stores/theme-store.ts`, `globals.css`, `tailwind.config.ts` (HEAD 27d455b: "mobile-only dark mode switch", Chris 2026-10-15) | CLAUDE.md still says single theme with no dark mode, but the worktree HEAD adds a mobile-only dark switch. Confirm the ruling. If dark mode stays, render the unchecked check only when checked. |
| Dead prototype design: ptab Search / Trending / Available / Leaders / Trade, Adds/Drops tabs, Trending/Recommended segment, gridGroups | out-of-scope-or-question | n/a | Unbound in the markup. Recommend not building it; "Leaders" is just sort-by-Tot with status All. |
| Seeded placeholder numbers and static game strings | out-of-scope-or-question | n/a | Prototype-only; never port the `seeded()` values. |
