## League › League tab (matchups, standings, activity) and Transactions

**Sources**
- Markup in `FieldScout Mobile.dc.html`:
  - 13–22: global CSS, dark tokens and `::after` dock spacer.
  - 37–44: phone root and status bar.
  - 232–246: league header and scroller.
  - 251: Match-tab dots.
  - 302–308: Team-tab card and "Moves" tile.
  - 417–451: League tab.
  - 520–541: Transactions screen.
  - 627–644: dock.
  - 646–681 and 724: sheet and filter sheet.
  - 729–748: team view.
  - 823, 832, 859, 891, 1090: overlays.
  - 1117: toast.
- Script in the same file:
  - 1126–1129: `HS`, `HEAD`, `short`.
  - 1130–1143: TEAMS.
  - 1152: TRANS.
  - 1153–1159: ICON.
  - 1161–1162: `side`, MUPS.
  - 1163: JUMPS.
  - 1194: LEAGUES.
  - 1198: NOTIFS.
  - 1213: BENCH_ME.
  - 1414–1415: state.
  - 1473–1482: global search.
  - 1624: toast.
  - 1628: `go`.
  - 1660–1670: mups, standings, bracket.
  - 1687–1690: trans filter.
  - 1701: openTeam.
  - 1707–1714, 1723, 1726, 1736, 1743–1752, 1769–1777, 1784, 1794, 1796, 1819–1827, 1839–1847, 1857–1858.
- `FSHeadshot.dc.html`.
- README.
- Geometry marked **(measured)** was read from the prototype running in Chrome at 390×844 with Inter Display loaded.

**Conventions**
- Colours are given as `var(--x-token, light-fallback)`. In light mode no `--x-*` variables are defined, so the fallback hex is what renders. Dark values are in §6.
- Font is Inter Display everywhere, with `font-feature-settings:'tnum' 1,'cv11' 1`, antialiased. Line-height is `normal` unless stated.
- `*{box-sizing:border-box}` applies globally, so stated heights include borders.

---

### 1. Screens and states

| # | Screen / state | Exact state condition | Jump-panel entry (`n = index+1`) |
|---|---|---|---|
| A | League screen, League tab, **Matchups** sub-tab | `scr === "league" && tab === "league" && ltab === "matchups"`. Initial `ltab` is `"matchups"`. | 9 "League · matchups" |
| B | League tab, **Standings** sub-tab | `… && ltab === "standings"` | 10 "League · standings" |
| C | League tab, **Activity** sub-tab | `… && ltab === "activity"` | 11 "League · activity" |
| C′ | Activity with a filter active | `nFilt > 0`. See the definition below this table. | — |
| D | **Transactions** screen, league-wide | `scr === "trans" && !tMine`. Title "League transactions". | 13 "Transactions" |
| D′ | Transactions, **My moves** variant | `scr === "trans" && tMine` is truthy. Title "My moves". The team filter is hidden and the list is forced to manager `dalton`. | — (Team tab "Moves" tile) |
| D″ | Transactions pre-filtered to one team | Arrives with `tMine:false, tType:"All", tTeams:[ti]` from team view "See all". The pill reads "Filter · 1". | — |
| E | Transactions **empty state** | `trans.length === 0` after filtering (`transEmpty`). | — |
| E′ | D″ for a team with no moves | D″ opens **straight into E** ("No transactions match this filter"). Applies to sam, tara, nina, chris, owen, maya and raj. | — |
| F | **Transaction filters** bottom sheet | `sheet === "filters"`. Opens over C or over D/D′/D″. | 14 "Transaction filters" (opens D with the sheet up) |
| F′ | Filter sheet without the Teams section | `sheet === "filters" && myMoves`, where `showTeamFilter = !myMoves` | — |
| G | Team view overlay (another team) | `teamView != null`. Owned by the Team spec; covered here for entry and exit only. | — |

**Definitions used in the table:**
- `nFilt = (tType !== "All" ? 1 : 0) + (!myMoves && tTeams.length ? 1 : 0)`.
- `myMoves = scr === "trans" && tMine`. It is always false on the League screen.

**Initial state:** `tMine` and `mi` are **absent** from `state` (1414–1415), so both start as `undefined`. They are falsy, but they are not literally `false` or `0`. Code reads them as `s.tMine` (truthiness) and `s.mi || 0`. The initial values of the others are:
- `tType:"All"`
- `tTeams:[]`
- `ltab:"matchups"`
- `tab:"match"`
- `scr:"league"`
- `lg:0`
- `lsDx:0`
- `lsAnim:false`

**Important finding: League › Activity (C) shows no feed.**
- The prototype renders only the right-aligned Filter pill. Markup line 448 is an empty line where a list would go.
- The filtered `trans` list is rendered only on the Transactions screen (D).
- README line 4 and line 85 name "Activity" as a league screen, but describe no content for it.
- See open questions.

**Computed but not rendered:**
- `bracket`, the playoff bracket (1666–1670).
- `leagueTabs`, top underline tabs (1723).
- `m.a.open` / `m.b.open` on League › Matchups cards.

`bracket` and `leagueTabs` are recorded in §2.8 for a future build.

---

### 2. Layout, top to bottom

#### 2.0 Shared chrome on the League screen (A–C)

**Phone root**
- 390×844, radius 48, `overflow:hidden`, `position:relative`, flex column.
- `background:var(--x-b0,#fff)`, `color:var(--x-t1,#1D1D1F)`.
- Classes `fs-dark` (dark only) plus `dock-lg` on the League screen, or `dock-sm` on Transactions or when a profile, trade or settings overlay is open.

**Status bar** (flex none):
- Box: `height:50px; display:flex; align-items:center; justify-content:space-between; padding:6px 32px 0 40px`.
- **"9:41"**: 16px/600, inherited t1.
- Notch: `position:absolute; left:50%; top:11px; translateX(-50%)`, 120×34, radius 999, `#000` (literal). No z-index, so sheets dim it.
- Right group: flex, `gap:6px`.
  - Signal: svg 18×12, viewBox 18×12, `fill:currentColor` t1. Four rects, each 3 wide with rx 1, at x 0/5/10/15 with heights 4/7/9.5/12, bottom-aligned.
  - Battery: svg 25×12.
    - Outline: rect 21×11 at (0.5,0.5), rx 3.5, stroke t1, opacity .4.
    - Fill: rect 16×8 at (2,2), rx 2, t1.
    - Nub: rect 1.5×4 at (23,4), rx .75, opacity .4.

**League header** (flex none). **(measured)** y=50–99, 49px tall.
- Container: padding `0 12px`, `border-bottom:1px solid var(--x-b3,#EBEBEE)`.
- Row: `height:48px; display:flex; align-items:center; gap:10px`.
- Contents, left to right:
  1. **Logo tile:**
     - 28×28, flex none, `margin-left:4px`, radius 8, `#07D066`, centred.
     - Image `assets/fieldscout-logomark.svg`, alt "FieldScout", 15×15, display block.
     - **Not tappable.** No onClick. `goHomeLogo` exists but is bound only on Home and Community.
  2. **Home button** (`goHome`):
     - `title="Home"`, 38×38, flex none, `margin-left:-6px`, radius 50%, `color:t1`.
     - Pressed state `background:var(--x-b2,#F2F2F4)`.
     - svg 20×20, viewBox 16, stroke 1.5, round caps and joins.
     - Path `M2.5 7.2L8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5z`.
  3. **League name** `{{ lg.name }}` (e.g. "Sunday Funday League"):
     - `flex:1; min-width:0`, 13px/600, nowrap, ellipsis.
  4. **Right group:** `display:flex; align-items:center; gap:2px; flex:none`. Each button is 38×38, radius 50%, pressed `var(--x-b2,#F2F2F4)`. Each svg is 20×20, viewBox 16, stroke 1.5, colour t1.
     - **Search** (`openGS`):
       - `title="Search"`, round caps.
       - Paths `<circle cx=7 cy=7 r=4.8>` and `M10.6 10.6L14 14`.
     - **Notifications** (`goNotifs`):
       - `position:relative`, round caps and joins.
       - Path `M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14h3`.
       - Badge `#FF0028`.
     - **Messages** (`goDms`):
       - `position:relative`.
       - Path `M8 13.5c3.3 0 6-2.4 6-5.5S11.3 2.5 8 2.5 2 4.9 2 8c0 1.2.4 2.3 1.1 3.2L2.5 13.8l2.9-.9c.8.4 1.7.6 2.6.6z`.
       - Badge `#0088FF`.
     - Notifications and Messages have no `title`.
     - **Badge:**
       - `position:absolute; top:4px; right:4px; min-width:16px; height:16px; padding:0 4px; border-radius:999px`.
       - White 10px/600, centred.
       - Separation ring `box-shadow:0 0 0 2px var(--x-b0,#fff)`.
       - Values: both read **"3"**.
         - Notifications: `nUnread = notifRead ? 0 : 3`.
         - Messages: `dmCount` = number of truthy `unread` keys (league, marcus, nina) = 3.
       - Each badge is hidden when its count is 0.
- The header is static and does not scroll.

**Scroller** (line 246):
- `class="fsm-scroll"`, `scrollbar-width:none` (WebKit scrollbar hidden too), `flex:1; min-height:0; overflow-y:auto`.
- **(measured)** It spans y=99–**844**: it runs under the dock (see dock geometry).
- `::after` spacer: `content:""; display:block; flex:none; height:var(--x-dockpad)`. This is **150px** (`dock-lg`), so the last row clears the switcher plus the tab bar.
- The Match, Team, Players and League tabs all render inside this **one** scroller element.

**Scroll behaviour:**
- Everything below in A–C is inside the scroller. The segmented control scrolls with the content and is **not sticky**.
- **Scroll position is never reset.** No code touches `scrollTop`, and React keeps the same scroller element while `scr === "league"`. Consequences:
  - Switching `ltab`, switching tab-bar tabs, or tapping a matchup card into Match all keep the current offset. The browser clamps it to the new content height.
  - Chrome's scroll anchoring may shift it. **(measured)** 150 on Standings became 167.5 after switching to Matchups, then 301.5 after tapping a matchup card into Match.
  - A user scrolled down on Standings must scroll back up to reach the segmented control.
- Leaving for Transactions **unmounts** the scroller (`isLeague` becomes false). Returning via X remounts it at `scrollTop 0` **(measured)**. Transactions' own scroller always starts at the top.

**Dock geometry (League screen)** **(measured)**:

| Element | Box | Notes |
|---|---|---|
| Switcher wrapper | `flex:none; position:relative; z-index:4; margin-top:-148px; padding:6px 8px` | 68px tall: 6 + 56 + 6 |
| Tab bar | `margin-top:0` (`barMt:"0"`) | Its own `margin-top` is 0 here |

- The switcher wrapper sits at y=696–764. Its card is at x=8, y=702–758, 374×56.
- The tab bar sits at y=764–844.
- Both are translucent with **no backdrop blur**, so scrolling content is visible beneath them.

#### 2.1 Sub-tab segmented control (all of A–C)
- **Wrapper:** padding `12px 16px 4px`.
- **Track:** `display:flex; padding:3px; border-radius:999px; background:var(--x-b2,#F2F2F4)`. **(measured)** x=16, y=111, 358×36.
- **Segments:** 3, each `flex:1; height:30px; border-radius:999px`, centred text 13px/600, `cursor:pointer`. **(measured)** each is about 117.3px wide.
  - Text colour is inherited t1 `#1D1D1F` for both states. There is no separate foreground colour.
  - Labels: "Matchups", "Standings", "Activity".
  - Selected: `background:var(--x-b0,#fff); box-shadow:0 1px 3px rgba(0,0,0,.12)`. README says `0 1px 2px`; see §7.
  - Unselected: `transparent`, `box-shadow:none`.
  - No transition.

#### 2.2 Matchups (A)
- **List container:** padding `10px 12px 20px`, flex column, `gap:10px`. Cards are 366px wide at 390px.
- **There is no week label or week selector** on this sub-tab.

**League median card** (first item, static, not tappable). **(measured)** y=161, 366×58.5.
- Box: `display:flex; align-items:center; gap:10px; padding:12px; border-radius:16px; background:#FFF6E5`. This is a literal with no token and no dark variant.
- Avatar: 32×32 circle, flex none, `#FF8A00`, white "M" 13px/600.
- Text column: `flex:1`, column, `gap:2px`.
  - Line 1, 14px/600, inherited t1: **"League median 54.62 "** followed by an inline span (weight 500, `var(--x-t3,#6E6E73)`) reading **"· proj 88.94"**.
  - Line 2, 11.5px/500, t3, line-height 1.35: **"Beat the median to win an extra matchup this week."**

**Matchup card** (×6, in `MUPS` order). **(measured)** each is 366×99.5; tops at y=229.5, 339, 448.5, 558, 667.5, 777. Cards 5–6 start under the dock at scroll 0.
- Box: `cursor:pointer; border-radius:16px; background:var(--x-b1,#F5F5F7); padding:12px; display:grid; grid-template-columns:minmax(0,1fr) 26px minmax(0,1fr); gap:8px; align-items:center`.
- Side columns are about 150px each.
- No pressed state, and **no highlight on your own matchup** (k=0) beyond being first.
- **Left column (team A):** flex column, `gap:5px`, `min-width:0`.
  1. Row: flex, `align-items:center`, `gap:8px`.
     - Avatar 28×28 circle, flex none, `background:{{ m.a.av }}`, white initial 11px/600.
     - Flex spacer.
     - Score 17px/600 (e.g. "39.70").
  2. Win bar track: `height:4px; border-radius:999px; background:var(--x-b3,#E5E5EA); overflow:hidden`.
     - Fill: `height:100%; width:<win>%; background:winC`, anchored left.
     - **The fill has no border-radius of its own.** The track's radius and `overflow:hidden` round only the outer end; the inner end of the fill is **square**. The Home league card's bar differs: its fill has `border-radius:999px` (line 78).
  3. Team name: 13px/600, nowrap, ellipsis.
  4. Meta: 11px/500, t3, nowrap. Shows `{{ rec }} · ` then the win % in a span (600, `color:winC`). Example: "2-6 · **66%**".
- **Centre:** "vs", 11px/600, `var(--x-t4,#8E8E93)`, centred.
- **Right column (team B):** mirrored, with `text-align:right`.
  - Row 1 is score, spacer, avatar.
  - The bar track adds `display:flex; justify-content:flex-end`, so the fill grows from the right.
  - Meta order is reversed: win % (600, `winC`) then ` · {{ rec }}`. Example: "**34%** · 8-0".
- **winC:** `#07B85A` when win ≥ 50, else `#FF0028`. The same colour is used for the bar fill and the % text.
- **Edge cases:**
  - Win = 50 makes **both** sides green, because both are ≥ 50.
  - 0% or 100% gives an empty or full bar.
- **Not shown on this card:** projections, manager and streak. They are present in the data object but not bound.

#### 2.3 Standings (B)
- **Container:** padding `8px 12px 20px`.
- **Column grid** (header and rows): `grid-template-columns:30px minmax(0,1fr) 64px 50px; gap:8px`. **(measured)** The Team column is 190px.
- **Header row** **(measured)** y=159, 30px tall:
  - Box: padding `8px 4px`, 11px/500, t3 `#6E6E73`, `border-bottom:1px solid var(--x-b3,#EBEBEE)`.
  - Cells: "Rank" (left-aligned), "Team", "Waiver" (right), "PF" (right).
- **Rows** (×12, `cursor:pointer`, no pressed state). **(measured)** 53px tall; the rank-6 row is 54px. The first row is at y=189 and the last at y=773.
  - Box: `display:grid; align-items:center; padding:10px 4px; border-bottom:{{ t.line }}`.
    - `t.line` is **`2px solid #0088FF` on the rank-6 row** (playoff cutoff).
    - Every other row, including the last, gets `1px solid var(--x-b2,#F2F2F4)`.
  - **Rank cell:** column, `align-items:center`.
    - Rank number: 15px/600.
    - Movement below: 10px/600, `color:mvC`.
      - "+N" in green `#07A852`.
      - "-N" in red `#FF0028`, using an ASCII hyphen.
      - "–" (en dash) in `var(--x-t5,#AEAEB2)` for 0.
  - **Team cell:** flex, `align-items:center`, `gap:9px`, `min-width:0`.
    - Avatar 32×32 circle, flex none, team colour, white initial 11px/600.
    - Text column, `min-width:0`, `gap:1px`:
      - Name: 13.5px/600, nowrap, ellipsis.
      - Meta: 11px/500, t3, nowrap. Format `{{ rec }} · ` + streak span (`color:stkC`) + ` · {{ mgr }}`. Example: "8-0 · ▲8W · @marcus".
  - **Waiver cell:** right-aligned, 12px/500, t3. Example: "$103 (10)".
  - **PF cell:** right-aligned, 12px/600, t1. Example: "407.62".
- **Footer note:** padding `10px 4px`, 11px/500, t3: **"Top 6 make the playoffs. Line marks the cutoff."**
- **No row highlight** for your own team (Touchdown Tacos, rank 11).
- **(measured)** Scroll height is 930 (including the 150px spacer).

#### 2.4 Activity (C)
- **Container:** padding `4px 12px 24px`.
- **Row:** `display:flex; align-items:center; justify-content:flex-end; padding:6px 4px 0`. It holds only the **Filter pill**. **(measured)** The pill is at x=304.5, y=161, 69.5×30 when reading "Filter".
  - Box: `height:30px; display:flex; align-items:center; gap:6px; padding:0 12px; border-radius:999px; font-size:12px; font-weight:600; cursor:pointer`.
  - Colours:
    - No filters: `background:var(--x-b2,#F2F2F4)`, `color:var(--x-t1,#1D1D1F)`.
    - Any filter: `background:var(--x-gb,#E6F2FF)`, `color:var(--x-tb,#0074DB)`.
  - Icon: 12×12 svg, viewBox 16, `stroke:currentColor`, stroke-width 1.8, round caps. Path `M2.5 4.5h11M4.5 8h7M6.5 11.5h3` (three narrowing lines).
  - Label: **"Filter"**, or **"Filter · N"** where N is 1 or 2, joined with a U+00B7 middle dot.
- **Below:** nothing. No list and no empty message. The content is shorter than the scroller, so it does not scroll.

#### 2.5 Transactions screen (D / D′ / D″ / E)
This is a separate full screen in the phone's flex column. It has no league header and no league switcher.

1. **Status bar:** 50px (as §2.0).
2. **Top bar** (flex none). **(measured)** y=50–102.
   - Box: `height:52px; display:flex; align-items:center; gap:8px; padding:0 12px`.
   - Close button (`backTeam`):
     - 36×36, radius 50%, `cursor:pointer`, pressed `background:var(--x-b2,#F2F2F4)`.
     - It has **no `flex:none`**.
     - **X icon**: svg 16×16, viewBox 16, stroke-width 2, round caps, path `M4 4l8 8M12 4l-8 8`, colour t1.
   - Title: `flex:1; text-align:center`, 16px/600. Text is **"League transactions"**, or **"My moves"** when `tMine`.
   - Right spacer: a `<span>` 36px wide that keeps the title centred.
3. **Section row** (flex none). **(measured)** y=102–148, 46px tall.
   - Box: `display:flex; align-items:center; justify-content:space-between; padding:8px 16px`.
   - Left: **"Activity"** in 17px/600, letter-spacing −0.01em.
   - Right: the same **Filter pill** as §2.4, with identical specs and colour rules.
4. **List scroller:**
   - Box: `class="fsm-scroll"; scrollbar-width:none; flex:1; min-height:0; overflow-y:auto; padding:0 12px 20px`.
   - **(measured)** It spans y=148–844, 696px tall.
   - `::after` spacer: **84px** (`dock-sm`).
   - Rows are not tappable.
5. **Transaction row** (one per TRANS entry that passes the filter). **(measured)** 83px tall with one move, 123px with two.
   - Box: `padding:12px 4px; border-bottom:1px solid var(--x-b2,#F2F2F4); display:flex; flex-direction:column; gap:8px`.
   - **Meta line:** flex, `align-items:center`, `gap:6px`, 11.5px/500, t3. Items in order:
     - Manager `{{ t.mgr }}`: 600 weight, t1. This is the bare handle with no "@" (e.g. "dalton"), and it is **not a link**.
     - Type pill: `height:18px; padding:0 7px; border-radius:999px; display:flex; align-items:center`, 10.5px/600. Text **"Free agency" | "Waiver" | "Trade"**. Colours:
       - Trade: fg `var(--x-tb,#0074DB)`, bg `var(--x-gb,#E6F2FF)`.
       - Waiver: fg `#C98A1F` (waiver gold), bg `#FBF0DC`. Both are literal and untokenised.
       - Free agency: fg `#07A852`, bg `var(--x-gg,#E3F9EC)`.
     - Date, e.g. "Oct 11, 12:06 PM".
     - Spacer `flex:1`.
     - Only if the transaction has a bid: **"$11 bid"** in 13px/600, t1.
   - **Move line** (one per add or drop): flex, `align-items:center`, `gap:10px`. Items in order:
     - Icon slot: 16px wide, flex none, centred.
       - svg 12×12, viewBox 16, `stroke:{{ m.c }}`, stroke-width **2.4**, round caps.
       - Add: path `M8 3.5v9M3.5 8h9` (plus) in `#07A852`.
       - Drop: path `M3.5 8h9` (minus) in `#FF0028`.
     - **Headshot** (FSHeadshot, `size="32"`):
       - Root: `position:relative`, 32×32, flex none, radius 50%, `overflow:hidden`, `background:#EEEEF1`.
       - Ring: `box-shadow:0 0 0 1px #fff, 0 0 0 3px <team colour>`. The ring width is 2 because size ≥ 32.
       - Unknown team: ring falls back to `inset 0 0 0 1px rgba(0,0,0,.04)`.
       - `title` = the full player name, which gives a native hover tooltip (e.g. "Kendrick Bourne").
       - Image: `position:absolute; inset:0; width/height 100%; object-fit:cover; object-position:50% 15%; transform:scale(1.25) translateY(8%)`, alt = full name.
       - Initials: `font-size:max(9, round(size*0.36))`, which is 12px here; weight 700, `#6E6E73`.
     - Text column: `flex:1; min-width:0`, column, `gap:1px`.
       - Short name: 14px/600, e.g. "K. Bourne".
       - Sub: 11px/500, t3: `{{ pos }} · {{ team }}`, e.g. "WR · ARI".
     - Verb (right): 11px/600 in the move colour: **"Added"** or **"Dropped"**.
6. **Empty state (E)**, inside the scroller after the empty list. **(measured)** 124px tall at y=148.
   - Box: `padding:40px 16px; display:flex; flex-direction:column; align-items:center; gap:10px; text-align:center`.
   - Message: 14px/500, t3. Text is **"No moves match this filter"** when `tMine`, otherwise **"No transactions match this filter"**.
   - Link: **"Clear filter"** in 14px/600, `#0088FF`, `cursor:pointer`.

**Dock on Transactions:**
- No switcher.
- The tab bar has `margin-top:-80px` (`barMt`). This pulls it up over the last 80px of the scroller: **(measured)** the bar sits at y=764–844 over a scroller that ends at 844. That overlap is why the 84px `dock-sm` spacer exists.

#### 2.6 Transaction filters sheet (F / F′)
- **Backdrop:** `position:absolute; inset:0` (covers the status bar and notch too), `z-index:20`, `background:rgba(0,0,0,.32)`, `display:flex; align-items:flex-end`. README says .4; see §7.
- **Panel:** `width:100%; max-height:86%`, flex column, `border-radius:24px 24px 0 0`, `background:var(--x-b0,#fff)`, padding `8px 0 30px`.
- **Panel height** **(measured)**:
  - **F (Teams shown):** natural content is about 868px plus the spacer, so it always hits the cap: **725.84px**, top edge at **y≈118**. The Teams list scrolls behind the pinned Done button.
  - **F′ (My moves):** the sheet is short, **308.5px**, top edge at **y≈535.5**. That is 8 + handle 15 + header 39 + scroll body 154.5 (label ≈20.5 + chips 50 + 84px spacer) + footer 62 + 30. The 84px spacer shows as a visible blank gap between the chips and Done.
- **Grab handle:**
  - Row: flex none, centred, padding `2px 0 8px`.
  - Bar: 36×5, radius 999, `var(--x-b4,#D1D1D6)`.
  - Decorative only; there is no drag-to-dismiss.
- **Header:**
  - Box: flex none, `display:flex; align-items:flex-start; gap:12px; padding:4px 16px 12px 20px`.
  - Title: **"Transaction filters"** in 19px/600, letter-spacing −0.02em.
  - No subtitle (`hasSheetSub` is only for "grid") and no close X (the X is only on the "Switch league" sheet).
- **Scroll body:** `class="fsm-scroll"; scrollbar-width:none; flex:1; min-height:0; overflow-y:auto`.
  - The global `.fsm-scroll[style*="overflow-y"]::after` rule also gives it a trailing spacer. It is **150px** when opened from the League screen and **84px** when opened from Transactions. This looks like a prototype artefact.
  - **Section label** "Transaction type": padding `0 20px 6px`, 12px/600, t3.
  - **Type chips row:**
    - Row: `class="fsm-scroll"; scrollbar-width:none; display:flex; gap:6px; overflow-x:auto; padding:0 20px 14px`. It has no `overflow-y`, so it gets no `::after` spacer.
    - Chips: `flex:none; white-space:nowrap; height:36px; padding:0 16px; border-radius:999px; display:flex; align-items:center`, 13px/600, `cursor:pointer`.
    - Labels: **"All types"**, **"Trades"**, **"Free agents"**, **"Waivers"**.
    - Selected: background `#0088FF`, text `#fff`.
    - Unselected: background `var(--x-b2,#F2F2F4)`, text t1.
    - **(measured)** Chip widths are 83.84 / 72.67 / 102.61 / 79.84px. Row `scrollWidth` is 397 against `clientWidth` 390. **No chip is clipped:** "Waivers" ends at x≈377. Only 7px of the 20px trailing padding is off-screen, so the row scrolls horizontally by 7px.
  - **Teams section** (only when `!myMoves`):
    - Label "Teams": padding `0 20px 4px`, 12px/600, t3.
    - 13 rows: "All teams" first, then the 12 teams in **TEAMS array order** (not standings order).
    - Row box: `height:48px; display:flex; align-items:center; gap:12px; margin:0 20px; border-bottom:1px solid var(--x-b2,#F2F2F4); cursor:pointer`.
      - Avatar: 28×28 circle, flex none, white 11px/600.
        - "All teams" row: bg `var(--x-t5,#AEAEB2)`, glyph **"•"**. The data `ini` is "All", but the rendered glyph is "•".
        - Team rows: team colour, first character of the team name.
      - Name: `flex:1`, 14px/600.
        - "All teams" row: **"All teams"**.
        - Team rows: the manager handle without "@" ("dalton", "marcus", "priya", "devin", "sam", "tara", "leo", "nina", "chris", "owen", "maya", "raj"). Not links.
      - Check circle: 22×22, radius 50%, centred.
        - On: `background:#0088FF`, `box-shadow:none`.
        - Off: `background:var(--x-b0,#fff)`, `box-shadow:inset 0 0 0 1.5px var(--x-b4,#C7C7CC)`.
        - Check glyph: **always drawn**. svg 11×11, white, stroke 3, round caps and joins, path `M3 8.5l3.2 3L13 4.5`.
- **Footer** (`sheetDone`, outside the scroll body, pinned):
  - Box: flex none, padding `12px 20px 0`.
  - Button: `height:50px; border-radius:999px; background:#0088FF` (pressed `#0074DB`), white 16px/600, text **"Done"**.

#### 2.7 Toast (shared, raised from this area by league switching)
- Box: `position:absolute; left:50%; bottom:100px; transform:translateX(-50%); z-index:30; height:36px; padding:0 16px; border-radius:999px; background:var(--x-ink,#1D1D1F); color:#fff; display:flex; align-items:center`, 13px/500, nowrap.
- Placement:
  - On the League screen it sits at y=708–744, **directly on top of the switcher card** (y=702–758). So "Switched to <team>" covers the card.
  - On Transactions it floats 20px above the tab bar (bar top y=764).
- Timing: auto-hides **1800ms** after it is raised. Each new toast clears the previous timer. README says about 2.2s; see §7.

#### 2.8 Computed but unbound (record for a future build)

**`bracket`** (1663–1670). The Playoffs menu page (1796) states the intended placement: "The playoff bracket shows at the top of the League tab once the playoffs start in Week 15."
- **Round 1, "Week 15":**
  - seed 1 (Gridiron Gurus) vs **Bye**.
  - seed 4 (Sam's Sleepers) "0.00" vs seed 5 (Blitz Brigade) "0.00".
  - seed 2 (Priya's Punters) vs **Bye**.
  - seed 3 (End Zone Elite) "0.00" vs seed 6 (Leo's Lions) "0.00".
- **Round 2, "Week 16":**
  - seed 1 vs **TBD**.
  - seed 2 vs **TBD**.
- **Championship, "Week 17":** TBD vs TBD.
- Slot fields: `seed, av, name, pts, w, fg, line`.

| Slot type | av | fg | Weight |
|---|---|---|---|
| Team slot | team colour | `var(--x-t1,#1D1D1F)` | 600 |
| **TBD** | `var(--x-b4,#D1D1D6)` | `var(--x-t5,#AEAEB2)` | 500 |
| **Bye** | `var(--x-b3,#E5E5EA)` | `var(--x-t3,#6E6E73)` | 500 |

- Lines: the first slot of each game has `line:"1px solid var(--x-b3,#EBEBEE)"`; the second has `"0"`.
- Game ring: Championship gets `inset 0 0 0 1.5px #ECAD48` (gold); every other game gets `none`.

**`leagueTabs`** (1723):
- Labels: Match / Team / Players / League.
- `fg`: `var(--x-t1,#1D1D1F)` when on, `var(--x-t3,#6E6E73)` when off.
- On-state underline: `inset 0 -2px 0 #0088FF`. Off-state: `none`.
- Click runs `set({ tab:v, swap:null })`.

---

### 3. Interactions

**Segmented control (2.1).**
- Tap sets `ltab` to "matchups", "standings" or "activity". The change is instant with no animation.
- Scroll position is **not** reset (see §2.0).
- `ltab` persists across navigation: leave the League tab and come back and you land on the same sub-tab.
- Tapping the League tab-bar item again does **not** reset `ltab`.

**Median card.** No interaction.

**Matchup card.** Tapping anywhere runs `set({ tab: "match", mi: k })`, which switches to the **Match** tab showing matchup k (0-based; k = 0 is yours).
- The tab-bar highlight moves to Match.
- The Match tab shows **no "Matchup k of 6" label**:
  - `mxLabel`, `mxHint`, `mxPrev` and `mxNext` are computed but unbound.
  - Matchup k is indicated only by the dots row (line 251): 6 dots, `gap:4px`, height 6, radius 999, `cursor:pointer`, width transition `.2s linear`.
  - Active dot: 14px wide, `var(--x-ink,#1D1D1F)`. Inactive: 6px wide, `var(--x-b4,#D1D1D6)`.
- **`mi` persists.** Tapping Match in the tab bar from another tab keeps matchup k. Only a re-tap of Match while `s.tab === "match"` resets `mi:0`.
- That check reads `s.tab`, not `scr`. So on Transactions, if `tab` is still "match" (e.g. you came via jump 4 then jump 13), tapping Match also resets to matchup 0.
- There is no per-team tap target on this card. `m.a.open` / `m.b.open` exist but are unbound here; on the Match tab the team **names** are bound to them.

**Standings row.** Tap runs `openTeam(t.i)`:
- `t.i === 0` (Touchdown Tacos, your team): `set({ scr:"league", tab:"team", teamView:null, tradeOpen:null })`, which goes to the **Team** tab.
- Any other team: `set({ teamView: ti })` opens the **Team view overlay**: `position:absolute; top:50px; bottom:0; left/right 0; z-index:21`, `var(--x-b0)`. It covers the header and dock.
  - Back chevron (`tv.close`): 36×36, svg 18, path `M10 3L5 8l5 5`. It sets `teamView:null`, returning to Standings with scroll and state intact.
  - "Recent moves" lists that manager's first 3 TRANS entries, flattened into Added/Dropped chips:
    - Added: `var(--x-tg,#067A3E)` on `var(--x-gg,#E3F9EC)`.
    - Dropped: `var(--x-tr,#C8001C)` on `var(--x-gr,#FFE9EC)`.
    - The date is shortened to the part before the comma, e.g. "Oct 11".
  - "No moves this season" shows when there are none.
  - **"See all"** (13px/600, `#0088FF`) runs `set({ teamView:null, scr:"trans", tMine:false, tType:"All", tTeams:[ti] })`, which is D″ (or E′ for a team without moves).

**Filter pill** (League › Activity and Transactions). Tap runs `set({ sheet:"filters" })` and opens sheet F.

**Filter sheet.**
- **Type chips:** single-select. Tapping sets `tType` to "All", "Trades", "Free agents" or "Waivers". The list and pill update **live**, with no apply step.
  - "Trades" matches TRANS type "Trade".
  - "Free agents" matches "Free agency".
  - "Waivers" matches "Waiver".
- **Team rows:** multi-select.
  - Tapping a team toggles its TEAMS index in `tTeams`.
  - **"All teams"** sets `tTeams = []`.
  - "All teams" shows checked exactly when `tTeams` is empty.
  - Selecting all 12 teams individually does **not** collapse back to "All teams".
  - Matching: `TEAMS.findIndex(t => t.mgr === "@" + row.mgr)` must be in `tTeams`.
  - In My moves the team filter is ignored and every row must have manager `dalton`. A `tTeams` value left over from earlier is kept, but hidden.
- **Done**, a **backdrop tap**, or anything calling `closeSheet` runs `set({ sheet:null })`. Taps inside the panel are stopped (`stopPropagation`). There is no drag-to-dismiss and no animation: the sheet appears and disappears instantly.
- **Pill count:** `tType !== "All"` counts 1, and a non-empty `tTeams` counts 1, but the latter only when not in My moves. Maximum is 2.

**Transactions top-bar X** (`backTeam`). Runs `set({ scr:"league", tab:"team", sheet:null })`.
- It **always lands on your Team tab**, whatever the entry point (Team "Moves" tile, team view "See all", or the jump).
- The League scroller remounts at the top.
- `tType`, `tTeams` and `tMine` are **not** reset on exit.

**"Clear filter"** (empty state). Runs `set({ tType:"All", tTeams: myMoves ? tTeams : [] })`. In My moves the hidden team selection is preserved; otherwise both filters reset.

**Entry resets:**
- **Jump panel `go("trans", …)`** sets `tMine:false, tType:"All"` and clears `sheet`, `prof`, `trade`, `settings`, `tradeOpen` and `teamView`. Jump 14 then sets `sheet:"filters"`. `tTeams` and `tab` keep their previous values.
- **Team tab "Moves" tile** sets `scr:"trans", tMine:true, tType:"All"`; `tTeams` is untouched. The tile itself:
  - Source label is "Transactions", renamed "Moves" at 1736.
  - Box: 52px tall, radius 12, `var(--x-b0,#fff)` background, pressed `var(--x-b2,#EDEDF0)`. That fallback differs from the `#F2F2F4` used elsewhere.
  - Layout: flex column, centred, `gap:4px`.
  - Icon: `ICON.trans` = `M4 3.5h8v9H4zM6 6.5h4M6 9.5h4`, 16×16, stroke 1.6, round caps and joins, colour t1.
  - Label "Moves": 11px/600.
  - It is the third of four tiles: Schedule, Trade, Moves, News.
- **Team view "See all":** see Standings row above.

**Header actions (League screen):**
- **Home** (`goHome`): `set({ scr:"home", sheet:null })`.
- **Search** (`openGS`): `set({ gs:{ q:"", scope:"all" } })` opens the global-search overlay (z-index 29, `top:50px`).
  - Its People results for league managers close the search and call `openTeam(ti)`. This is another way into the team view (G), or the Team tab for yourself.
- **Notifications** (`goNotifs`): `set({ scr:"notifs", sheet:null, prevScr })`, where `prevScr` is the current `scr` ("league") unless you are already in dms, thread or notifs.
- **Messages** (`goDms`): `set({ scr:"dms", sheet:null, prevScr })`, with the same `prevScr` rule.
- **Logo tile:** no action.

**Transaction rows, manager names and headshots.** Not interactive: no profile links and no player card. Standings `@mgr` text is also not a separate link (the whole row opens the team). See §7 for the conflict with project rules.

**Headshot loading.**
- Photos come from `assets/headshots/<HEAD[name]>.jpg`. In TRANS only **Roschon Johnson** (`johnson.jpg`), **Jaylen Wright** (`wright.jpg`) and **Jahan Dotson** (`dotson.jpg`) have photos.
- Every other row has `src=""`, so it renders initials immediately.
- On `<img>` `onError` the component also swaps to initials.
- **Initials rule:**
  1. Remove a trailing " D/ST".
  2. Split on whitespace, `'` and `-`.
  3. Take the first letter of the first token plus the first letter of the last token, uppercased.
- Examples: "Efton Chism III" becomes "EI"; "Patriots D/ST" becomes "P".

**Menu tab.**
- On both the League screen and Transactions it runs `set({ sheet: sheet==="menu" ? null : "menu" })`.
- Once the menu sheet is open, its z-20 backdrop covers the tab bar. The toggle-off path is therefore unreachable: the sheet closes by backdrop tap or by choosing an item.

**Animations.**
- None inside these screens: the segmented control, sheet open/close and list updates are all instant.
- The only motion is in the dock:
  - Switcher swipe (§4).
  - Switcher dot width `.2s linear`.
  - Match-tab dot width `.2s linear`.

---

### 4. Navigation

**How the user arrives:**
- **League tab (A–C):**
  - Tab-bar item "League" (4th) runs `set({ scr:"league", tab:"league", sheet:null, swap:null })`.
  - Jump panel entries 9, 10 and 11 call `go("league","league",<sub>)`, which sets `ltab`.
- **Transactions (D):**
  - Team tab "Moves" tile opens D′.
  - Team view "See all" opens D″ or E′.
  - Jump entries 13 and 14 (14 also opens the filter sheet).
  - There is **no** entry from League › Activity.
- **Team view (G):**
  - Standings row (other teams).
  - Global search People result.
  - Owned by the Team spec.

**Bottom dock:**

| Screen | League switcher | Tab bar (`margin-top`) | Highlighted item | Scroll spacer |
|---|---|---|---|---|
| League tab (A–C) | Shown. `showSwitcher = scr==="league" && !prof && !trade && !settings` | League tab bar (`0`) | **League** (`#fff`); **Menu** instead while the menu sheet is open | 150px (`dock-lg`) |
| League tab with filter sheet (F) | Shown, dimmed under the backdrop | Same | League stays highlighted (`sheet !== "menu"`), dimmed | — |
| Transactions (D) | **Not shown**, because `showSwitcher` is false (`scr !== "league"`) | League tab bar, because `inLg` (scr "trans" is not home/community/me); margin `-80px` | **None**: all items `#A1A1A6` | 84px (`dock-sm`) |

**League switcher** (League screen only):
- **Wrapper:** `flex:none; position:relative; z-index:4; margin-top:-148px; padding:6px 8px; background:var(--x-dockA, rgba(29,29,31,.9))`.
- **Card:**
  - `position:relative; height:56px; overflow:hidden; border-radius:10px; background:var(--x-mini,#3A3A3C); box-shadow:inset 0 0 0 1px var(--x-miniline,transparent); color:#fff; touch-action:none; user-select:none; cursor:grab`.
  - Grab bar: `position:absolute; top:4px; left:50%; translateX(-50%)`, 28×3, radius 999, `rgba(255,255,255,.28)`.
- **Content row:**
  - `height:100%; display:flex; align-items:center; gap:10px; padding:6px 16px 0; transform:translateX(lsDx px); opacity:max(.2, 1−|lsDx|/200)`.
  - Transition `transform .14s linear, opacity .14s linear` when `lsAnim`, otherwise `none`.
  - League avatar: 34×34, flex none, radius 10, 12px/600, `color:lg.avFg`, `background:lg.av` (e.g. "SF" on ink).
  - Text column: `flex:1; min-width:0`, column, `gap:1px`.
    - Line 1: **team** 14px/600, nowrap, ellipsis, plus `" "` + record span 12px/500 `rgba(255,255,255,.62)`.
    - Line 2: league name 11px/500 `rgba(255,255,255,.62)`, nowrap, ellipsis.
  - Dots: flex, `gap:4px`, flex none. 4 dots, height 6, radius 999, width transition `.2s linear`.
    - Active: 14px wide, `var(--x-b0,#fff)`.
    - Inactive: 6px wide, `#636366`.
  - Chevron-up: svg 14×14, flex none, stroke 2, round caps and joins, `rgba(255,255,255,.62)`, path `M4 10l4-4 4 4`.
- **Gestures** (pointer events, 1771–1776):
  - **pointerdown:** records x/y, calls `setPointerCapture`, and sets `lsAnim:false`, so the drag has no transition.
  - **pointermove:**
    - If `|dx| > |dy|`, the row tracks the finger: `lsDx = clamp(dx, −140, 140)`, and opacity follows.
    - Otherwise, if `dy < −24` (upward, vertical-dominant), it **immediately, mid-gesture**, ends the gesture and sets `lsDx:0, sheet:"leagues"`. This opens the "Switch league" sheet.
  - **pointerup:**
    - If `|dx| > 50 && |dx| > |dy|`: commit (see below).
    - Else if (`|dx| < 8 && |dy| < 8`) — a tap — or `dy < −24`: `set({ lsDx:0, lsAnim:true, sheet:"leagues" })`.
    - Otherwise snap back: `lsDx:0` with the .14s linear transition.
  - **pointercancel:** snaps back to 0 with the transition.
  - **Commit:**
    - **Swipe left (dx < 0) → next league** (`lg+1`). **Swipe right → previous** (`lg−1`). Both wrap modulo 4.
    - `step(d)` runs as follows:
      1. **Toast "Switched to <new team>" fires synchronously on release.**
      2. `lsAnim:true, lsDx: d>0 ? −120 : +120` slides the content out over .14s.
      3. After **140ms**: `lg = n, lsAnim:false, lsDx: d>0 ? +120 : −120`. The content jumps to the opposite side.
      4. A double `requestAnimationFrame` then sets `lsAnim:true, lsDx:0`, so the content slides in to 0 over .14s.
    - Net effect of a left swipe: content exits left and the new league enters from the right.
  - **"Switch league" sheet rows:** set `lg` and close the sheet. They toast "Switched to <team>" only if the league changed.
- **League data:** the League tab content does **not** change with the selected league in the prototype. Only the header name, the switcher and the team view's league name follow `lg`.

**Tab bar:**
- Box: `flex:none; position:relative; z-index:4; margin-top:{{ barMt }}; height:80px; padding:6px 8px 0; display:flex; background:var(--x-barA, rgba(29,29,31,.94))`.
- 5 items, each `flex:1; height:48px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; cursor:pointer`.
  - Icon: svg 22×22, viewBox 16, stroke 1.5, round caps and joins.
  - Label: 10px/600.

  | Item | Icon path |
  |---|---|
  | Match | `M2.5 4.5h4v7h-4zM9.5 4.5h4v7h-4zM8 3v10` |
  | Team | `ICON.players` = `M5.5 6.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5` |
  | Players | `ICON.search` = `M7 2.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6zM10.6 10.6L14 14` |
  | League | `ICON.leaders` = `M3 13V9h3v4M6.5 13V5h3v8M10 13V7.5h3V13` |
  | Menu | `M2.5 4h11M2.5 8h11M2.5 12h11` |

- Active colour `#fff`; inactive `#A1A1A6`. There is no other active indicator.
- A tab is highlighted only when `scr==="league" && tab===v && sheet!=="menu"`. Menu is highlighted when `sheet==="menu"`.
- Click on Match/Team/Players/League runs `set({ scr:"league", tab:v, sheet:null, swap:null })`, plus `mi:0` on a Match re-tap (§3). From Transactions, tapping any of these returns to the League screen on that tab, scrolled to the top (the scroller remounts).

**Home indicator** (markup 644):
- `position:absolute; left:50%; bottom:8px; transform:translateX(-50%)`, 134×5, radius 999, `background:var(--x-b0,#fff)`, **no z-index**. **(measured)** x=128, y=831.
- The tab bar (`position:relative; z-index:4`) covers y=764–844, so the indicator **paints beneath the bar**. **(measured)** `elementFromPoint` at the indicator returns the tab bar.
- **Light:** white under 94% `#1D1D1F` composites to about `#2B2B2C`. That is the same as the bar over the white page around it, so the indicator is effectively invisible.
- **Dark:** `#121212` under `rgba(18,18,18,.92)` is fully invisible.
- Either build it as invisible, or, if a visible bar is intended, give it a z-index above the tab bar. See open questions.

**Z-order** (all overlays below are children of the phone root):

| Layer | z-index | Box | Reached from these screens via |
|---|---|---|---|
| Page content, scrollers | auto | — | — |
| Home indicator | auto (beneath the bar) | absolute | — |
| Switcher and tab bar | 4 | relative | — |
| Bottom sheets: filters, menu, "Switch league" | 20 | `inset:0` (dims the status bar and notch too) | Filter pill; Menu tab; switcher tap or swipe-up |
| Team view | 21 | `top:50px; bottom:0` | Standings row; global search |
| Player profile | 22 | `top:50px` | Team view starter or bench row |
| Settings | 23 | `top:50px` | **Unreachable.** `openSettings` is defined (1755) but bound nowhere, and no jump sets `settings:true` |
| Trade detail (`hasTd`) | 23 | `top:50px` | Not directly. Via header Notifications → "Trade offer from Marcus", or via Messages |
| Trade builder | 24 | `top:50px` | Team view "Propose trade" |
| Menu pages (`hasPage`) | 25 | `top:50px` | Menu sheet → League settings, Scoring, Playoffs, Draft results, League history, Previous seasons, or the "My team" card |
| Global search (`hasGS`) | 29 | `top:50px` | Header Search |
| Toast | 30 | absolute, bottom 100 | League switch |

Every z ≥ 21 overlay starts at `top:50px`, so the status bar stays visible above it. Sheets cover everything, including the dock.

**Back and close:**
- The League tab has no back control. The header Home button goes to Home.
- Transactions X always goes to League › Team (§3).
- The filter sheet closes on Done or a backdrop tap.
- The team view's chevron returns to the screen beneath it.

---

### 5. Data shown

**TEAMS** `[name, mgr, rec, stk, rank, av, waiver, pf]`. The array index is `t.i`; `ini` is the first character of the name.

| i | Team | Mgr | Rec | Streak shown | Rank | Avatar | Waiver | PF | Move (by rank) |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Touchdown Tacos (you) | @dalton | 2-6 | ▼2L | 11 | #0088FF | $64 (8) | 353.86 | +1 |
| 1 | Gridiron Gurus | @marcus | 8-0 | ▲8W | 1 | var(--x-ink,#1D1D1F) | $103 (10) | 407.62 | +1 |
| 2 | Priya's Punters | @priya | 7-1 | ▲3W | 2 | #9D70E9 | $149 (9) | 421.56 | +1 |
| 3 | End Zone Elite | @devin | 6-2 | ▲6W | 3 | #F75252 | $99 (11) | 433.58 | +2 |
| 4 | Sam's Sleepers | @sam | 6-2 | ▼2L | 4 | #ECAD48 | $134 (6) | 398.14 | -3 |
| 5 | Blitz Brigade | @tara | 5-3 | ▼2L | 5 | #5C7CE5 | $176 (2) | 373.10 | -1 |
| 6 | Leo's Lions | @leo | 4-4 | ▲2W | 6 (cutoff line) | #07A852 | $137 (3) | 382.80 | +1 |
| 7 | Hail Marys | @nina | 3-5 | ▼3L | 7 | #FF8A00 | $178 (4) | 377.44 | -1 |
| 8 | Fourth & Long | @chris | 3-5 | ▲1W | 8 | var(--x-t2,#3A3A3C) | $88 (5) | 360.02 | +1 |
| 9 | Red Zone Rebels | @owen | 3-5 | ▼1L | 9 | #00A6A3 | $121 (7) | 351.90 | – |
| 10 | Maya's Mavericks | @maya | 2-6 | ▲1W | 10 | #E5508A | $92 (12) | 340.18 | -1 |
| 11 | Raj's Rushers | @raj | 1-7 | ▼5L | 12 | var(--x-t3,#6E6E73) | $155 (1) | 322.40 | – |

**Standings rules:**
- Rows are sorted by the given `rank`, ascending. The rank is **supplied, not computed**.
- Movement array by rank 1–12: `[1,1,2,-3,-1,1,-1,1,0,-1,1,0]`. Positive values render "+N" in green, negative "-N" in red, and 0 renders "–" in t5.
- Streak: `(stk ends with "W" ? "▲" : "▼") + stk`. W is `#07A852`; L is `#FF0028`.
- **Waiver** is shown verbatim as `"$<FAAB left> (<n>)"`. The league settings pages give its meaning:
  - General page (1794): "Waiver type: FAAB · $200 budget" and "Waivers process: Wed 12:00 AM".
  - So it reads "$<FAAB remaining of $200> (<waiver priority>)". The priorities are unique, 1–12.
- PF is shown verbatim with 2 decimals.
- Cutoff line under rank 6. This matches the Playoffs page (1796):
  - "Playoff teams: 6"
  - "Weeks: 15, 16, 17"
  - "First-round byes: Top 2 seeds"
  - "Seeding: Record, then points for"
  - Also: "Consolation bracket: On", "Reseed each round: Off", "Tiebreaker: Bench points".
- **Real product data:** rank, rank change since last week, record, streak, manager handle, FAAB balance, waiver priority, PF, playoff-team count (from settings).

**Sample-data inconsistencies** (do not replicate as logic):
- Touchdown Tacos (2-6, PF 353.86) is ranked 11, below Maya's Mavericks (2-6, PF 340.18) at 10. That contradicts "Record, then points for".
- Records total **50 W / 46 L**, which is impossible.
- Records show **8 games played**, but the current week is **5** (`state.week = 5`; README "The current week is 5").
- NOTIFS says "Waiver claim processed · You added Kendrick Bourne for $1". TRANS has Bourne as **Free agency with no bid**; the $1 waiver claim was Ray Davis.
- The priya **Trade** row (+Jaylen Wright / −Jahan Dotson) conflicts with other data:
  - Wright is on THEIRS (Gridiron Gurus).
  - Dotson is on your BENCH_ME.
  - TRADES says Dotson went to leo ("Accepted", Sep 24).
- The trade row shows **no counterparty**.

**MUPS** `[aIdx, bIdx, aScore, aProj, aWin%, bScore, bProj]`. B's win is `100 − aWin`.

| k | Team A (score, win) | Team B (score, win) |
|---|---|---|
| 0 | Touchdown Tacos 39.70, 66% (green) | Gridiron Gurus 16.40, 34% (red) |
| 1 | Priya's Punters 59.70, 23% | Leo's Lions 33.42, 77% |
| 2 | Blitz Brigade 85.60, 90% | Sam's Sleepers 31.90, 10% |
| 3 | Hail Marys 54.74, 2% | End Zone Elite 54.50, 98% |
| 4 | Fourth & Long 41.50, 19% | Red Zone Rebels 89.10, 81% |
| 5 | Maya's Mavericks 62.30, 58% | Raj's Rushers 48.20, 42% |

**Matchup and median rules:**
- Projections are not displayed on these cards: 83.44/73.01, 71.52/86.98, 117.99/85.21, 63.79/113.74, 90.91/111.23, 88.10/80.40.
- Scores are strings with 2 decimals. Win % is an integer followed by "%".
- Your matchup is always first; there is no other sort.
- The median card values (54.62, proj 88.94) are **hard-coded copy**. The median of the 12 displayed scores is actually 51.35.
- **Real product data:** live scores, live win probability, records, the median (when league median scoring is on).

**TRANS** `[mgr, type, date, bid, moves[[add|drop, name, pos, team]]]`, shown in array order (newest first) with no date grouping.

| # | Mgr | Type | Date | Bid | Moves (short name · pos · team; headshot) |
|---|---|---|---|---|---|
| 1 | dalton | Free agency | Oct 11, 12:06 PM | — | + K. Bourne · WR · ARI (initials KB, ring #97233F) |
| 2 | dalton | Free agency | Oct 11, 12:06 PM | — | − R. Davis · RB · BUF (RD, #00338D) |
| 3 | leo | Free agency | Oct 11, 5:20 AM | — | + E. Chism III · WR · NE (EI, #002244); − Patriots D/ST · D/ST · NE (P, #002244) |
| 4 | devin | Waiver | Oct 11, 12:04 AM | $11 bid | + M. Washington · WR · MIA (MW, #008E97); − J. Love · QB · GB (JL, #203731) |
| 5 | dalton | Waiver | Oct 11, 12:04 AM | $1 bid | + R. Davis · RB · BUF (RD, #00338D); − D. Laube · RB · LV (DL, #000000) |
| 6 | marcus | Waiver | Oct 10, 9:04 AM | $2 bid | + R. Johnson · RB · CHI (photo johnson.jpg, #0B162A); − J. Burton · WR · CIN (JB, #FB4F14) |
| 7 | priya | Trade | Oct 9, 7:40 PM | — | + J. Wright · RB · MIA (photo wright.jpg, #008E97); − J. Dotson · WR · PHI (photo dotson.jpg, #004C54) |

**Transaction formatting:**
- Short name: `short(n)` is the first initial + ". " + the rest. The name is left unchanged if it ends in "D/ST" or its first token contains ".".
- Position "DST" displays as "D/ST".
- Date format is "Mon D, h:mm AM/PM" with no year.
- The bid is shown as "$N bid" only when present.
- A trade row lists only the trading manager's side, using Added/Dropped wording.

**Filter result counts:**

| Filter | League-wide | My moves |
|---|---|---|
| All | 7 rows | 3 (rows 1, 2, 5) |
| Trades | 1 (row 7) | 0 → empty state |
| Free agents | 3 (rows 1–3) | 2 (rows 1, 2) |
| Waivers | 3 (rows 4–6) | 1 (row 5) |

**Per-team counts** (league-wide, All types):
- dalton **3** (2 Free agency, 1 Waiver)
- leo **1** (Free agency)
- devin **1** (Waiver)
- marcus **1** (Waiver)
- priya **1** (Trade)
- sam, tara, nina, chris, owen, maya and raj: **0**

**Empty-state triggers:**
- Selecting only teams with 0 rows (alone or together) gives "No transactions match this filter".
- So does any type + team combination with no overlap, e.g. Trades + leo, or Free agents + devin.
- "Clear filter" then resets both `tType` and `tTeams`.

**Real product data:** league transactions (adds, drops, waiver claims with FAAB bid, trades), manager, timestamp, player position/team/headshot.

**LEAGUES:**

| League | Format | Avatar | Your team | Record |
|---|---|---|---|---|
| Sunday Funday League | 12-team standard | "SF" on `var(--x-ink,#1D1D1F)`, white text | Touchdown Tacos | 2-6 |
| Family Bragging Rights | 10-team standard | "FB" on #ECAD48, text #1D1D1F | Dalton's Dynasty | 3-1 |
| Joy to Us | 12-team PPR | "JU" on #9D70E9, white text | Taco Tuesday | Draft Aug 28 |
| Work League | 10-team half PPR | "WL" on #5C7CE5, white text | Spreadsheet Slingers | Draft Sep 2 |

Only the header, the switcher and the team-view subtitle read from LEAGUES. League tab content is the same for every league.

---

### 6. Dark mode (`.fs-dark` on the phone root)

**Tokens used in this area:**

| Token | Dark value |
|---|---|
| t1 | #FFFFFF |
| t2 | #D9D9D9 |
| t3 | #B3B3B3 |
| t4 | #A7A7A7 |
| t5 | #727272 |
| --x-tg | #1ED760 |
| --x-tr | #FF6B6B |
| --x-tb | #6FB5FF |
| b0 | #121212 |
| b1 | #282828 |
| b2 | #333333 |
| b3 | #3E3E3E |
| b4 | #575757 |
| ink | #4D4D4D |
| --x-gg | #12301F |
| --x-gr | #3A1A1D |
| --x-gb | #12263F |
| --x-dockA | rgba(18,18,18,.86) |
| --x-barA | rgba(18,18,18,.92) |
| --x-mini | #090909 |
| --x-miniline | transparent |

`color-scheme:dark` is also set.

**By element:**
- **Phone root and page:** background #121212, text white.
- **Status bar:** "9:41", signal and battery are #FFFFFF (battery outline and nub at .4 opacity). The notch stays `#000`.
- **League header:**
  - Bottom border #3E3E3E.
  - Home, Search, Notifications and Messages icons white; pressed #333333.
  - Logo tile `#07D066` unchanged.
  - Badge fills `#FF0028` and `#0088FF` unchanged; their separation ring becomes #121212.
- **Segmented control:** track #333333; selected segment #121212 with the same `0 1px 3px rgba(0,0,0,.12)` shadow; white text.
- **Matchup card:**
  - Background #282828, bar track #3E3E3E, "vs" #A7A7A7, meta #B3B3B3.
  - Win colours `#07B85A` / `#FF0028` are unchanged (literals).
- **Team avatars:**
  - Gridiron Gurus becomes #4D4D4D.
  - Fourth & Long uses `var(--x-t2)`, so it becomes **#D9D9D9 with white text** (low contrast).
  - Raj's Rushers becomes **#B3B3B3 with white text**.
- **Median card:** stays **#FFF6E5** (literal). Its primary text becomes #FFFFFF, which is unreadable on cream; the secondary text and "· proj" become #B3B3B3. This is a prototype defect.
- **Standings:**
  - Header rule #3E3E3E, header text #B3B3B3, row rules #333333.
  - Cutoff `#0088FF` unchanged.
  - Neutral movement "–" is #727272.
  - Up/down movement and streak colours `#07A852` / `#FF0028` are unchanged. README specifies #1ED760 / #FF6B6B for dark success and danger text; see §7.
- **Filter pill:** idle #333333 with white text; active #12263F with #6FB5FF text.
- **Transactions:**
  - Top bar: X icon white, pressed #333333, title white.
  - "Activity" heading white.
  - Row rules #333333, manager white, meta #B3B3B3.
  - Trade pill: #6FB5FF on #12263F.
  - Free agency pill: `#07A852` (literal) on #12301F.
  - Waiver pill: stays `#C98A1F` on **#FBF0DC** (both literal, so a light chip remains).
  - Add/drop icons and verbs `#07A852` / `#FF0028` unchanged.
- **Headshot:**
  - The fallback background #EEEEF1, initials #6E6E73 and the 1px **white** separation ring are literals and stay unchanged.
  - Team rings unchanged. D. Laube's LV ring `#000000` nearly disappears against #121212 outside the white gap.
- **Empty state:** text #B3B3B3; "Clear filter" `#0088FF`.
- **Filter sheet:**
  - Panel #121212, handle #575757, section labels #B3B3B3, title white.
  - Unselected chips #333333 with white text; selected `#0088FF` with white text.
  - Row rules #333333; "All teams" avatar #727272.
  - Unchecked circle is #121212 with a #575757 ring. **The white check glyph shows on unchecked rows** because it always renders.
  - Done `#0088FF` / pressed `#0074DB` unchanged. Backdrop `rgba(0,0,0,.32)` unchanged.
- **Team view (G) move chips:** Added #1ED760 on #12301F; Dropped #FF6B6B on #3A1A1D.
- **Moves tile:** #121212, pressed #333333, icon white.
- **Dock:**
  - Switcher wrapper rgba(18,18,18,.86), card #090909, inset ring transparent.
  - League avatar "SF" becomes #4D4D4D. "FB" stays #ECAD48 with #1D1D1F text.
  - Active switcher dot becomes `var(--x-b0)` = **#121212, nearly invisible on #090909**. Inactive dots stay #636366.
  - Tab bar rgba(18,18,18,.92); active `#fff`, inactive `#A1A1A6`.
  - Home indicator becomes #121212, and is beneath the bar regardless.
- **Toast:** background becomes #4D4D4D, white text.

---

### 7. Conflicts to flag for the build

**Project rules vs prototype** (from the project memory index):
- **"Usernames always link to profile" (2026-09-30).** In the prototype, no username is a link:
  - standings "@marcus"
  - the transaction manager "dalton"
  - the filter-sheet handles
  - the team view's "@mgr"
- **"Player click: mini card, then full" (2026-10-05).** Transaction player rows and headshots are not tappable at all.

**README vs code** (the spec above documents the code value):
- Sheet backdrop: README `rgba(0,0,0,.4)`; code `.32`.
- Segmented "on" shadow: README `0 1px 2px rgba(0,0,0,.12)`; code `0 1px 3px`.
- Toast: README "about 2.2s"; code 1800ms.
- Dark success/danger text: README #1ED760 / #FF6B6B; code uses the literals #07A852 / #FF0028 for:
  - standings movement and streaks
  - add/drop icons and verbs
  - the Free agency pill
- README names "Activity" as a league screen (lines 4 and 85), but the prototype's League › Activity has no content.

---

### Open questions
- Critic finding dropped: 'a matchup-card tap shows mxLabel "Matchup {k+1} of 6" on Match'. mxLabel, mxHint, mxPrev and mxNext are computed (1726-1727) but bound nowhere in markup. The Match tab shows only the 6 dots (line 251), and README says 'dots only, no label or arrows'. Confirmed in the running prototype, so the spec documents the active dot instead. The rest of that finding holds (mi persists; a Match re-tap resets it).
- Critic finding adjusted: Settings (z23) was listed as reachable. openSettings is defined (1755) but bound nowhere in markup, and no jump sets settings:true, so it cannot be reached in this prototype. It stays in the z-order table, marked unreachable. Trade detail (z23) is reachable only via Notifications or Messages, not directly from these screens.
- Critic finding adjusted: 'Waivers may be clipped' in the type-chip row. Measured in Chrome with Inter Display, the chips are 83.84/72.67/102.61/79.84px and the row's scrollWidth is 397 vs 390. No chip is clipped (Waivers ends at x≈377); 7px of the 20px trailing padding sits off-screen, so the row scrolls 7px.
- Critic finding refined: scroll position is never reset across ltab/tab switches. It is not simply 'kept (clamped)' either: Chrome scroll anchoring moved it in testing (150 → 167.5 → 301.5). Should switching sub-tab or tab scroll to the top, or make the segmented control sticky, so users scrolled down on Standings can reach it?
- League › Activity renders ONLY the Filter pill; there is no feed (markup line 448 is blank). Should it render the same transaction rows as the Transactions screen (lines 531-539, including the empty state)? Recommendation: yes, reuse the same row component.
- Transactions close (X → backTeam) always lands on the user's own Team tab, even when opened from another team's view via 'See all' (standings → team view → See all). Should it return to where the user came from instead (team view / League › Standings)?
- Home indicator (134×5) is painted beneath the z-4 tab bar and is invisible in both themes. Is a visible home-indicator bar intended above the dock, or should it be omitted (the real OS draws its own)?
- The toast (bottom 100px, y 708-744) lands directly on the league switcher card (y 702-758), so 'Switched to <team>' covers the card it refers to. Should the toast sit above the switcher on league screens?
- Menu tab toggle-off is unreachable: the menu sheet's z-20 backdrop covers the tab bar, so the Menu item can't be tapped to close it. Fine to close by backdrop tap only?
- Product-rule conflicts: per 'usernames always link to profile' (2026-09-30), should standings '@mgr', the transaction manager names and the filter-sheet handles be links? Per 'player click: mini card, then full' (2026-10-05), should transaction player rows/headshots open the mini card? The prototype makes none of them tappable.
- Manager names appear as '@marcus' in standings but as bare 'dalton' in transaction rows and the filter's team list. Which format is canonical?
- League median card is hard-coded ('League median 54.62 · proj 88.94'), while the median of the 12 displayed scores is 51.35. Confirm it should be computed live and shown only when the league has median scoring enabled.
- Median card background #FFF6E5 and the waiver pill #FBF0DC/#C98A1F are literals with no dark variant; the median card text becomes white on cream in dark mode. Use the orange tint tokens (light #FFF3E6 / dark #3A2A14, text #B25C00 / #FFB340) for both in dark mode?
- Filter sheet team checkboxes always draw a white check, so in dark mode it shows on unselected (#121212) circles. Assume the check renders only when selected?
- Standings order contradicts the stated seeding 'Record, then points for': Maya's Mavericks (2-6, PF 340.18) ranks 10th above Touchdown Tacos (2-6, PF 353.86) at 11th. Records also total 50-46 and show 8 games at Week 5. Placeholder only? Which tiebreaker should real standings use (Playoffs page also lists 'Tiebreaker: Bench points')?
- Trade transactions show only the trading manager's side with Added/Dropped wording (priya: + J. Wright, − J. Dotson) and no counterparty; the sample also conflicts with rosters and TRADES. Should a trade row show both teams and both sides?
- Matchup cards: tapping anywhere jumps to the Match tab at that matchup; there's no tap target to open either team on League › Matchups. Your own matchup and team are not highlighted in Matchups or Standings. Is that intended? Win = 50% makes both sides green; is that intended?
- League tab content (matchups, standings, transactions, 'Top 6 make the playoffs', median card) does not change when switching leagues, including 10-team and pre-draft leagues (Joy to Us 'Draft Aug 28', Work League 'Draft Sep 2'). What should Matchups/Standings/Activity show pre-draft? Should the playoff-spot count come from league settings?
- The playoff bracket is computed but never rendered, though the Playoffs page says it 'shows at the top of the League tab once the playoffs start in Week 15'. Build it as a section at the top of League › Matchups from Week 15, or as its own sub-tab? Its data and styling are recorded in §2.8.
- The global CSS adds an ::after spacer (150px on league screens, 84px on Transactions) to every vertical .fsm-scroll, including the filter sheet's body. That leaves a visible 84px gap in the My-moves sheet and extra space under the team list. Assume it's a prototype artefact and omit it inside sheets?
- README vs code: sheet backdrop rgba(0,0,0,.32) vs README .4; segmented 'on' shadow 0 1px 3px vs README 0 1px 2px; toast auto-hide 1800ms vs README about 2.2s; dark success/danger text literals #07A852/#FF0028 vs README #1ED760/#FF6B6B. Which wins?
- Sample copy: notification 'You added Kendrick Bourne for $1' (waiver) and Priya's DM about a $1 Bourne bid vs TRANS showing Bourne added via Free agency, with the $1 waiver bid for Ray Davis. Placeholder only, but confirm Free agency adds never show a bid.
- Headshot initials for suffixed names use the last token ('Efton Chism III' → 'EI'). Should suffixes (Jr., II, III) be skipped when deriving initials?
- Dark mode: team avatar colours that reference text tokens (Fourth & Long var(--x-t2) → #D9D9D9, Raj's Rushers var(--x-t3) → #B3B3B3) put white initials on light grey, and the active league-switcher dot uses var(--x-b0) → #121212 on #090909 (invisible). Should these use fixed colours in dark mode?

---

## Gap analysis vs the current app

## League › League tab (Matchups / Standings / Activity) and Transactions: gap analysis

**Worktree:** `/Users/chrisdaltas/Documents/Hadouken/.claude/worktrees/redesign-v7` (read-only)

### Summary

The data and behaviour behind these screens are mostly built already.
- **Matchups:** the week's live matchups, records, median results and the playoff bracket exist.
- **Standings:** league standings with FAAB balance and waiver priority exist.
- **Activity:** a filtered, paged activity feed with realtime updates exists.

What does not exist is the mobile information architecture. The app has no "League" tab that groups matchups, standings and activity. They are three separate routes today (`/matchup`, `/standings`, `/activity`), reached through a 6-tab sub-nav plus a More menu. There is also no league bottom dock, no league switcher and no standalone Transactions screen.

**Needs real backend work:**
- Win probability. No source exists; the code comments say so (F566).
- A live or projected league median during the week.
- Standings rank movement since last week.
- Multi-team transaction filtering.
- Message (DM) badges.

**Product questions:**
- What League › Activity should show. The prototype renders nothing there.
- Where the Commissioner log and Stat corrections go on mobile.
- Which desktop-only standings features survive on mobile.
- Team colours.
- Dark mode.

**Dark mode note:** this worktree's newest commit `27d455b` ("mobile(v1): theme tokens (light/dark), mob: variant, mobile-only dark mode switch", `src/stores/theme-store.ts` citing "Chris, 2026-10-15 — dark mode is mobile-only") already adds `m-*` light/dark tokens. That contradicts CLAUDE.md's single-theme rule, so it needs a CLAUDE.md update or confirmation.

### Feature table

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Status bar, notch, home indicator | out-of-scope-or-question | n/a | These are mock device chrome; the real phone provides them. Don't build the home indicator: it renders under the tab bar and is invisible anyway. |
| League header: logo tile, Home button, league name (ellipsis) | new-ui-on-existing-data | `leagues/league-shell.tsx` (mobile `desk:hidden` block = identity row + sub-nav), `hooks/use-league.ts` | The mobile header today is the identity row plus sub-nav, not this bar. League name comes from the league detail. The logo tile does nothing in the prototype. |
| Header Search | new-ui-on-existing-data | `shared/command-palette.tsx`, `layout/top-search.tsx` | The palette exists, but it searches players, lists and users. It has no scope for league managers, so "People → open team" is missing. |
| Header Notifications + unread badge | new-ui-on-existing-data | `hooks/use-notifications.ts` (`unreadCount`), `layout/rail/notifications-panel.tsx` | Real backend. Only the mobile header button and badge are new. |
| Header Messages + badge | needs-new-backend | `layout/rail/messages-panel.tsx` (mock composer), `featureFlags.messages` | DMs are mock data behind a flag. The badge count has no real source. |
| One scroller with dock spacer (150px League / 84px Transactions) | restyle-only | n/a | Layout only. Scroll persistence across sub-tabs is a prototype artefact; the app is route-based. |
| League bottom dock: Match / Team / Players / League / Menu | new-ui-on-existing-data | `layout/bottom-tabs.tsx` (app-wide Home/Lists/Players/Search/More), `leagues/league-shell-ops.ts` `leagueTabs` / `leagueMoreItems` | Every destination route exists. The league-specific dock and the "League" grouping (matchups + standings + activity) are new IA. Pre-season, the app disables the season tabs (`NOT_STARTED_REASON`); the dock needs that state too. |
| League switcher card: swipe left/right, swipe-up or tap opens sheet, dots, chevron | new-ui-on-existing-data | `hooks/use-leagues.ts` (`MyLeagueRow`: name, avatar_url, my_team_id, status), `hooks/use-standings.ts` | No switcher exists. The record for the active league comes from standings. A record for every league (the sheet) would mean N standings reads, or adding a field to `GET /api/leagues`. Leagues are a flag-gated test cohort (`featureFlags.leagues`). |
| "Switched to <team>" toast | restyle-only | `ui/toast.tsx`, `ui/toaster.tsx` | The primitive exists. The prototype hides it after 1800ms; the README says about 2.2s. |
| Segmented control: Matchups / Standings / Activity | new-ui-on-existing-data | `ui/tabs.tsx` (`Segment`/`SegmentItem`); today 3 routes: `(shell)/leagues/[leagueId]/matchup`, `/standings`, `/activity` | The control is a restyle. Combining three routes into one tab is new; the sub-tab could be a `?view=` param so it persists. |
| League-wide matchup list for the current week, yours first | new-ui-on-existing-data | `hooks/use-matchups` via `matchup-view.tsx` (`useMatchupsLive`, `MatchupList` "Around the league", `selectedMatchup`); `league-home-season.tsx` `LiveScoreboard`/`ScoreboardMatchup`; `api/leagues/[id]/matchups` | All rows, live scores and realtime exist. The mobile card is a new layout. |
| Live scores (2 decimals, pending) | restyle-only | `matchup-view-ops.ts` `scoreCell`, matchups service (NULL = pending) | A pending score shows "—", never 0.00. Keep that. |
| Team avatar colour circle + initial | out-of-scope-or-question | `league-cells.tsx` `Crest` (initials on neutral); `teams` table has no colour or avatar column | Choose between a deterministic palette from the team id (UI only) and a stored team colour or crest (schema). |
| Win-probability bar + % (green ≥50 / red) | needs-new-backend | `league-cells.tsx` `WinProbMeter` (unused); `matchup-view.tsx` and `league-home-season.tsx` comments: "there is no win-probability source (F566)" | Needs a server-side win-probability model and an API field. The client must not invent it. |
| Team record under name on matchup card | new-ui-on-existing-data | `api/leagues/[id]/standings` (`StandingsRow` wins/losses/ties), `standings-table-ops.ts` `formatRecord` | Join the standings read to the matchups. Ties render as W-L-T. |
| Matchup card tap → Match tab at that matchup | restyle-only | `(shell)/leagues/[leagueId]/matchup/[mid]/page.tsx` | The route exists and rows already link to it. The Match-tab dots are covered by the Match spec. |
| League median card ("League median X · proj Y", explainer copy) | needs-new-backend | `league_weeks.median_score` via matchups service; `matchup-view-ops.ts` `MEDIAN_PENDING_TITLE` ("renders once every score of the week is in"); `settings.median_game` | The median is stored only once the week is complete. There is no live median and no projected median. A median for finished weeks is existing data. Show the card only when `median_game` is on; the prototype shows it unconditionally. |
| No week label / selector on Matchups | out-of-scope-or-question | `matchup-view.tsx` `WeekStrip` (prev/next + Live / Final (pending corrections) badge) | The prototype has no way to reach past weeks or see the week's status. I'd keep the app's week strip. |
| Variants not in the prototype: byes, second-opponent games, total-points leaderboard, playoff weeks, ✸ overridden badge, stats-delayed / reconnecting / stale banners, skeleton / error | restyle-only | `matchup-view.tsx` (`TotalPointsWeek`, secondary list, `EmptyCard`), `status-banners.tsx` | These exist and need the mobile look, extending the design language (CLAUDE.md rule). |
| Standings rows: rank, team, record, PF, @manager | restyle-only | `standings-page.tsx`, `standings-table.tsx`, `standings-service.ts` (`league_standings` RPC), `managersByTeam` + `UsernameLink` | The data is server-ranked. Rank comes from the RPC, not the prototype's static list. The app highlights your own row (`bg-accent-soft`); the prototype doesn't. I'd keep the highlight. |
| Rank movement +N / −N / – | needs-new-backend | `league_standings(p_league_id)`: no as-of-week argument; no rank snapshot table | Needs last week's rank: an RPC argument, a stored per-week rank, or a column in the standings document. |
| Streak ▲nW / ▼nL | new-ui-on-existing-data | `hooks/use-schedule.ts` (matchups incl. `result`), `team_week_results.h2h_result` | Derivable from stored per-week results; nothing computes it today. The server-authoritative posture suggests adding it to the standings RPC instead of computing it on the client. |
| Waiver column "$FAAB (priority)" | restyle-only | `StandingsRow.faab_balance` / `waiver_priority`; `standings-table.tsx` FAAB column; `waiver-order-list.tsx` | Both values are on the same read. Today they show in two places. Leagues that aren't FAAB (`rolling_priority`, `reverse_standings`, `none_fcfs`) need a priority-only variant. |
| Playoff cutoff line + "Top N make the playoffs" note | new-ui-on-existing-data | `settings.playoff_teams` (`lib/leagues/settings/league-settings.ts`) | The table draws no cutoff today. Take N from the setting, not a hard-coded 6. |
| Standings row tap → own Team tab / other team's view | restyle-only | `league-cells.tsx` `TeamNameLink` → `/team/[teamId]` | Today the team name is the link, not the whole row. The @manager text must stay a profile link (rule below). |
| Desktop standings features absent from the mobile design | out-of-scope-or-question | `standings-page.tsx` / `standings-table.tsx` | Not in the mobile design: the Final \| Projected toggle (live projected standings, `league_standings_projected`), the Playoffs tab, the tiebreaker chain strip, Win %, PA, vs-median and 2nd-opponent records, the "Placed by" chip, the ✸ commissioner-adjusted marker and legend, the coin-flip note, the `no_final_weeks` empty copy and the waiver-order list. Decide what stays on mobile; design intent favours simpler. |
| League › Activity content | out-of-scope-or-question | `activity-page.tsx` (tabs All, Adds & drops, Trades, Commissioner, Stat corrections), `activity-feed.tsx`, `api/leagues/[id]/activity` | The prototype renders only a Filter pill, and the README describes no content. I'd render the same filtered feed as Transactions here. |
| Commissioner log + Stat corrections on mobile | out-of-scope-or-question | `activity-page.tsx` `CommishTab` (team/week filters, ✸ entry doors), `corrections-view.tsx` | The mobile design has no home for either. Both are live features. |
| Transactions screen: X, centred title, "Activity" heading + Filter pill, list | new-ui-on-existing-data | `hooks/use-league-activity.ts` (`useLeagueActivityPages`), `activity-service.ts` | The feed, paging and realtime exist; the standalone mobile screen doesn't. The X always lands on the Team tab, and filters persist after leaving. |
| Transaction row meta: manager, type pill (Free agency / Waiver / Trade), date, "$N bid" | new-ui-on-existing-data | `activity-feed-ops.ts` (`TRANSACTION_TYPE_LABELS`, `waiverClaimText` uses `faab_bid` / `faab_before`), `lineup-editor-ops.ts` `formatInstantWithDate` | Types `add` / `drop` / `add_drop` map to Free agency, `waiver_claim` to Waiver, `trade` to Trade. Rows are keyed by `initiator_team_id`, so the manager handle comes from the members map. The pill colours are untokenised literals in the prototype; map them to tokens. |
| Per-player move lines: headshot with team ring, short name, pos · team, Added / Dropped | new-ui-on-existing-data | Add/drop payload carries `player_id`, `name`, `position`, `nfl_team`; `players/player-image.tsx` `PlayerAvatarImage`; `lib/nfl-team-colors.ts`; `players/player-link.tsx` | Headshots need a players lookup by id. Trade payload `players` carries only id, name, from and to, so position and team need that lookup too. The app shows a team logo for D/ST where the prototype shows initials. |
| Trade row shows one side only, no counterparty | out-of-scope-or-question | Trade payload: `players` (from/to), `faab`, `summary`, `via` (`supabase/migrations/156_commish_force_or_reverse_trade.sql`) | The data has both sides plus FAAB legs. Decide how a trade reads; the spec itself flags its sample row as inconsistent. |
| Commissioner moves, trade reversals, vetoes, system posts | out-of-scope-or-question | `activity-service.ts` (`commissioner_move`, `TRADE_TRANSACTIONS_FILTER`, system posts), ✸ receipts | The prototype's types are only Free agency / Waiver / Trade. Decide whether these appear in Transactions. |
| "My moves" variant (Team tab "Moves" tile) | new-ui-on-existing-data | `team-transactions-panel.tsx` / `team-transactions-ops.ts` (own team only; merges pending, lost and invalid claims with moves); activity `team_id` filter | The app's version also lists pending, lost and invalid claims with Cancel and Edit. The prototype shows completed moves only. Decide whether pending claims stay. |
| D″ team pre-filter from team view "See all" + team view "Recent moves" (3) | new-ui-on-existing-data | Activity `team_id` param; `team-page.tsx` mounts the transactions panel only when `isOwnTeam` | Other teams' pages show no moves today. The single-team filter works. |
| Empty state "No transactions / moves match this filter" + "Clear filter" | new-ui-on-existing-data | `activity-page-ops.ts` `TAB_EMPTY_COPY` (different copy) | New copy and a reset action. |
| Paging ("Show older") | restyle-only | `activity-feed.tsx` `ShowOlderProps`, composite cursor | The prototype shows no paging. Keep the app's version in the new look. |
| Filter sheet chrome: backdrop, grab handle, title, pinned Done | restyle-only | `ui/sheet.tsx` (`side="bottom"`), `layout/more-sheet.tsx` | The primitive exists. Backdrop opacity is .32 in code and .4 in the README. The spare 150px/84px spacer inside the sheet is a prototype artefact; don't copy it. |
| Type chips (All types / Trades / Free agents / Waivers), single-select, live | new-ui-on-existing-data | Activity `type` (comma list) and `topic=trades` params | Maps directly onto the existing filter. |
| Teams multi-select + "All teams" | needs-new-backend | `activity-service.ts` `activityQuerySchema` (`team_id` single uuid; topic refuses a team; filter = `initiator_team_id` only) | Needs a small API change: a list of `team_id` values, and a way to combine Trades with a team. Today a team filter misses trades where the team was the recipient. |
| Filter pill "Filter · N" with active colours | new-ui-on-existing-data | n/a | UI state only. |
| Playoff bracket at top of League tab once playoffs start | restyle-only | `playoff-bracket.tsx`, `hooks/use-playoff-bracket.ts`, `league-home-season.tsx` `BracketCard` | It exists and the app shows it all season (Standings › Playoffs and the league home hero). Placement is a minor call. |
| Usernames and players not tappable in prototype | restyle-only | `shared/username-link.tsx`, `players/player-link.tsx` | Project rules win: every username links to its profile (2026-09-30), and a player tap opens the mini card (2026-10-05). Keep the existing links. |
| Light / dark mode (§6 tokens) | out-of-scope-or-question | `tailwind.config.ts` `m-*` tokens, `src/stores/theme-store.ts`, `src/app/globals.css` (commit 27d455b) | CLAUDE.md says single theme, but this branch already adds a mobile-only dark switch. The prototype's dark mode also has defects: unreadable median card, light waiver chip, white check on unchecked rows, invisible active switcher dot. |

**Files checked** (all under `/Users/chrisdaltas/Documents/Hadouken/.claude/worktrees/redesign-v7/`):

- Components:
  - `src/components/leagues/{standings-page,standings-table,standings-table-ops,activity-page,activity-page-ops,activity-feed,activity-feed-ops,team-transactions-panel,team-transactions-ops,league-shell,league-shell-ops,league-cells,matchup-view,matchup-view-ops,schedule-view,league-home-season,team-page,playoff-bracket}.ts(x)`
  - `src/components/layout/{bottom-tabs,more-sheet,top-search,layout-mode-frame}.tsx`
  - `src/components/layout/rail/messages-panel.tsx`
  - `src/components/shared/command-palette.tsx`
  - `src/components/players/player-image.tsx`
  - `src/components/ui/*`
- Routes: `src/app/app/(shell)/leagues/[leagueId]/{page,standings,activity,matchup,matchup/[mid]}`
- Services: `src/lib/leagues/api/{standings-service,matchups-service,activity-service,transactions-service}.ts`
- Hooks: `src/hooks/{use-league-activity,use-leagues,use-notifications,use-schedule}.ts`
- Config and schema:
  - `src/lib/feature-flags.ts`
  - `src/lib/leagues/settings/league-settings.ts`
  - `src/lib/nfl-team-colors.ts`
  - `src/stores/theme-store.ts`
  - `src/types/database.ts` (`teams`, `team_week_results`, `league_standings*`)
  - `supabase/migrations/156_commish_force_or_reverse_trade.sql`
