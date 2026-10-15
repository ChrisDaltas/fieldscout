## Global frame, bottom dock, tab bars, league switcher, sheets and menus

Source: `design_handoff_fieldscout_mobile/FieldScout Mobile.dc.html`.
- Markup lines covered: 1–45, 603–728 (DM composer, Notifications screen, dock, sheets), 823–831 and 1108–1121. Navigation entry and exit points elsewhere are cited by line.
- Script parts covered: initial `state` (line 1414), `componentDidMount` (1402), `toast` (1624), `renderVals` (1626–1858), `pVals.gridGroups`, `pVals.colTip` and `pVals.pColsV` (1463–1465), and the tables `LEAGUES`, `SETTINGS`, `ICON`, `JUMPS`, `NOTIFS`, `TEAMS`, `POS`/`POSFG` and `short()`.
- Also covered: `FSHeadshot.dc.html`, where it appears in the Swap sheet.

Geometry was checked by rendering the prototype and measuring with `getBoundingClientRect`. All y values are measured from the top of the 390×844 screen.

**Notation**
- `var(--x-b2,#F2F2F4)` means README token **b2**. The light value is the fallback written in the source at that spot. The dark value comes from `.fs-dark` (line 19).
- The source does not use one light fallback per token. b3 appears as both `#EBEBEE` and `#E5E5EA`, and the pressed b2 as both `#F2F2F4` and `#EDEDF0`. Each element below gives the exact value written at its spot.
- Icons use a 16×16 viewBox with stroke paths: `stroke="currentColor"`, round caps, and round joins unless noted.
- "Pressed" means the source's `style-active` attribute. support.js compiles it to `:active`, and `style-hover` to `:hover`.

---

### 0. Global frame and runtime (presentation shell and global rules)

**Initial state (line 1414). This is what the app opens on.**
- `scr:"league"`, `tab:"match"`, `lg:0` (Sunday Funday League), `sheet:null`.
- `mi` is not in the state; `s.mi || 0` makes it "Your matchup".
- `ptab:"trend"`, `ltab:"matchups"`, `prevScr:"league"`, `notifRead:false`.
- `unread = UNREAD0 = {league:true, marcus:true, nina:true}`.
- `game:"mine"`, `msg:""`, `toast:""`, `lsDx:0`, `lsAnim:false`.
- `dark` is undefined, so the app starts light.
- **The first frame is therefore the League screen, Match tab, with the large dock** (switcher card plus the in-league bar, Match highlighted). It is not Home.

**Page shell (presentation only, lines 12–25)**
- Global CSS:
  - `body{margin:0;background:#F5F5F7}`
  - `a{color:#0088FF;text-decoration:none}`, `a:hover{color:#0074DB}`
  - `*{box-sizing:border-box}`
  - `input::placeholder{color:#6E6E73}`. This is global and is **not** re-themed in dark mode.
  - `.fsm-scroll::-webkit-scrollbar{display:none}`. Every scroller also has inline `scrollbar-width:none`.
- Wrapper:
  - `min-height:100vh`, flex, `align-items:flex-start`, `justify-content:center`, `gap:40px`, wrap, `padding:32px 24px 48px`.
  - Font `'InterDisplay',sans-serif` (stylesheet `https://rsms.me/inter/inter.css`).
  - `font-feature-settings:'tnum' 1,'cv11' 1`, `-webkit-font-smoothing:antialiased`, `color:var(--x-t1,#1D1D1F)`.
- **Jump panel** (line 27, presentation only):
  - Column, width 240, `flex:none`, `gap:14px`, `padding-top:8px`.
  - Title group: column, gap 4.
    - Title "FieldScout mobile": 20/600, letter-spacing −0.02em.
    - Subtitle "League screens. Tap inside the phone or jump to a screen.": 13/500, t3 `#6E6E73`, line-height 1.4.
  - **Dark mode row** (line 29):
    - Row: height 34, flex, centred, gap 8, padding 0 12px, radius 10, 13/600, `#1D1D1F` on `#EBEBEE`.
    - Label "Dark mode" at `flex:1`.
    - Switch: 36×22, `flex:none`, radius 999, padding 2. Background `#07B85A` when on, `#C7C7CC` when off.
    - Knob: 18×18, `border-radius:50%`, white, justified `flex-end` when on and `flex-start` when off.
    - Tap runs `toggleDark`.
  - **Jump list** (lines 30–34): column, gap 2.
    - Item: height 34, padding 0 12px, radius 10, gap 8, 13px, nowrap.
    - Active item: weight 600, t1, background b0 `#fff`.
    - Inactive item: weight 500, t2 `#3A3A3C`, transparent.
    - Hover: b3 `#EBEBEE`.
    - Index number: width 18, 11/500, t4 `#8E8E93`.
  - **Highlight rule** (`jumps`, line 1629). Presentation only. An entry is on when:
    - sub is "profile": `!!prof && !trade`.
    - sub is "trade": `!!trade`.
    - sub is "settings": `!!settings`.
    - Otherwise all of these must hold:
      - `!prof && !trade && !settings`, `scr` matches, and `tab` matches if given.
      - If sub is given it must also match: Players entries use `ptab===sub`, League entries use `ltab===sub`, and all others use `sheet===sub`.
      - An entry with no sub additionally needs `!sheet`, unless `scr` is home.
  - Consequences of the rule:
    - #19 and #25 highlight together while the Menu sheet is open, and #4 Matchup un-highlights.
    - #17 Conversation (sub "convo") and #24 Trade offer (sub "tradeoffer") **never** highlight, because `sheet` is never "convo" or "tradeoffer".
  - The panel sits outside the `.fs-dark` scope, so it always stays light.
- **Bezel** (line 37):
  - 410×864, padding 10, radius 58.
  - Background `var(--x-ink,#1D1D1F)`. It is outside the dark scope, so it is always `#1D1D1F`.
  - Shadow `0 30px 80px -30px rgba(0,0,0,.45)`.

**Device screen (line 38). This is what the app recreates.**
- `position:relative`, 390×844, radius 48, `overflow:hidden`.
- `background:var(--x-b0,#fff)`, `color:var(--x-t1,#1D1D1F)`, `display:flex; flex-direction:column`.
- Class `{{ themeCls }}` = `(dark ? "fs-dark" : "") + (" dock-lg" | " dock-sm")`.
- Children of the flex column, in order:
  1. Status bar.
  2. The active screen's children: header(s) at `flex:none` and a scroller at `flex:1; min-height:0; overflow-y:auto`.
  3. League switcher, when shown.
  4. Tab bar.
  5. Home indicator.
  6. Absolute overlays, sheets, the column tip popover and the toast.

**Status bar (lines 40–44).** Use the OS status bar or `safe-area-inset-top` in the web app.
- `flex:none`, height 50, flex, `align-items:center`, `justify-content:space-between`, `padding:6px 32px 0 40px`, 16/600.
- Left: "9:41".
- Dynamic island: absolute, `left:50%; top:11px; translateX(-50%)`, 120×34, radius 999, `#000`.
- Right: a group with gap 6.
  - Signal SVG, 18×12, `fill=currentColor` (t1). Bars are rects at (x0,y8,3×4), (x5,y5,3×7), (x10,y2.5,3×9.5) and (x15,y0,3×12), each `rx=1`.
  - Battery SVG, 25×12:
    - Outline rect at (0.5,0.5), 21×11, `rx 3.5`, stroke currentColor, opacity .4.
    - Fill rect at (2,2), 16×8, `rx 2`.
    - Cap rect at (23,4), 1.5×4, `rx .75`, opacity .4.
- Full-screen overlays start at `top:50px`, so they never cover the status bar. The sheet backdrop (`inset:0`) and the column-tip backdrop **do** dim it.

**Home indicator (line 644).**
- `position:absolute; left:50%; bottom:8px; translateX(-50%)`, 134×5, radius 999, `background:var(--x-b0,#fff)`.
- It has no z-index. The tab bar (z 4) covers the same area, so the indicator paints **under** the bar and only shows faintly through it (measured y = 831).
- In the product, use the OS indicator.

**Theme and runtime (`componentDidMount`, line 1402; `toggleDark`, line 1858)**
- On mount:
  - `setInterval(livePlay, 7000)`. Every 7 s this simulates one play: it advances the clock, ball position and score of one game, adds the play with a timestamp, and the "N new play(s)" label counts plays under 20 s old.
  - Which game is targeted: `s.game` when it is not "mine", otherwise a random key of GAMES (cin, min, chi).
    - `game` starts as "mine", so plays start out random.
    - `goFeed` sets `game:"min"`, and nothing outside the Feed chips resets it. **After the first visit to Live plays, every later simulated play goes to the MIN game** until the user taps the "My players" chip.
  - `localStorage.getItem("fieldscout-theme") === "dark"` sets `dark:true`.
    - This runs in `componentDidMount`, after the first render, so a saved dark preference **flashes light first**.
    - The product should read the preference before paint.
- `toggleDark`:
  - Flips `dark` and writes `"dark"` or `"light"` to `localStorage["fieldscout-theme"]`. Each read and write is wrapped in try/catch.
  - The Profile header pill uses the same handler.
    - Label `themeLabel`: "Dark" when light, "Light" when dark.
    - Tooltip: "Switch to dark mode" or "Switch to light mode".
    - Icon when light (moon): `M13.5 9.6A5.5 5.5 0 0 1 6.4 2.5a5.5 5.5 0 1 0 7.1 7.1z`.
    - Icon when dark (sun): `M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1`.
- `.fs-dark` also sets `color-scheme:dark` on the frame and on its inputs and textareas.

**Placeholder action.** `soon()` shows the toast "Not part of this prototype".

**Dead bindings, defined in `renderVals` but never bound in the markup:**
- `leagueTabs`: an in-page Match/Team/Players/League strip. There is **no** in-page tab strip; the bottom bar is the only switcher between the four league tabs.
- `dockCls`: `themeCls` does that job.
- `menuLeagues`, `openChat`, `openSettings`.
- The local `pick` inside `ls`, and the `gridGroups` built at line 1691 (View / Week or season / Year). The sheet uses `pVals.gridGroups` (line 1465) instead.

---

### 1. Screens and states in this area (with exact conditions)

| Element | Shown when |
|---|---|
| Outside-league tab bar (Home, Community, Players, Profile) | `scr ∈ {"home","community","me"}` (`inLg` is false) |
| In-league tab bar (Match, Team, Players, League, Menu) | Every other `scr`: `"league"`, `"myss"`, `"feed"`, `"trans"`, `"dms"`, `"thread"`, `"notifs"`. This includes Messages and Notifications opened from Home, and My start/sit opened from Profile. |
| League switcher card | `showSwitcher = scr==="league" && !prof && !trade && !settings` |
| Large dock (switcher + bar = 148 px; scroller pad 150) | Same condition as the switcher: `barMt="0"`, class `dock-lg` |
| Small dock (bar only = 80 px; scroller pad 84) | Otherwise: `barMt="-80px"`, class `dock-sm` |
| Notifications screen | `scr==="notifs"` (see 2.10) |
| Bottom sheet (any) | `hasSheet = !!sheet` |
| Sheet "Create" | `sheet==="create"` |
| Sheet "Switch league" | `sheet==="leagues"` |
| Sheet "Transaction filters" | `sheet==="filters"`. The Teams section shows only when `showTeamFilter = !(scr==="trans" && tMine)`. |
| Sheet "Customize stats" | `sheet==="grid"`. This is the only sheet with a subtitle. |
| Sheet "Swap player" | `sheet==="swap"` with `swapFor` set. "No eligible players for this slot" shows when `sw.none`. |
| Sheet "Menu" | `sheet==="menu"` |
| Sheet "League chat" | `sheet==="chat"`. **Unreachable in the prototype.** No control sets it, and no JUMPS entry passes `"chat"`. |
| Done button footer | `sheet==="filters" \|\| sheet==="grid"` |
| Chat composer footer | `sheet==="chat"` |
| Close (×) in the sheet header | `sheet==="leagues"` only |
| League settings overlay | `hasSettings = !!settings`. **Unreachable in the prototype.** `openSettings` is not bound in the markup, and JUMPS #25 "Menu · league settings" actually opens the Menu sheet. |
| Column tip popover | `hasColTip = !!colTip` |
| Toast | `hasToast = !!toast` |
| DM composer "Send" pill | `hasMsg = !!msg.trim()` (Conversation screen) |
| Unread bell badge (Home and League headers) | `nUnread > 0`, where `nUnread = notifRead ? 0 : 3` (hard-coded) |
| Unread chat badge (Home and League headers) | `dmCount > 0`, where `dmCount` = number of truthy values in `unread` |

**Unreachable edge case.** `sheet==="swap"` without `swapFor` would render the default `sw`:
- An empty 4 px b1 box (the 2 px padding only).
- The "Choose a player to swap" divider.
- "No eligible players for this slot".

Nothing sets `sheet:"swap"` without `swapFor`.

**Stacking order (all z-indexes on the screen), lowest to highest:**

| z | Layer |
|---|---|
| auto | Status bar and screen content |
| 1–2 | Sticky table columns (Players sheet view lines 405–408; profile tables 815–817, inside the profile overlay's own context) |
| auto | Home indicator, painted under the bar |
| 4 | League switcher strip and tab bar |
| 6 | Players sticky filter header (line 345). Its quick-pick backdrop (z 7, `position:fixed`) and popover (z 8) live **inside** this z-6 stacking context, so relative to the dock and sheets they paint at level 6: above the dock, below sheets. The fixed backdrop has no transformed ancestor, so it is not clipped to the 390×844 frame and covers the whole browser viewport. The popover (max-height 340, starting below the header) does not reach the dock. |
| 20 | Bottom sheet backdrop and panel. Covers the dock and the status bar. |
| 21 | Other team's page (`teamView`, line 730) |
| 22 | Player profile (`prof`, line 750) |
| 23 | League settings (824); trade offer detail (`tradeOpen`, 833) |
| 24 | Trade builder (`trade`, 860) |
| 25 | Menu/settings sub-pages (`page`, 892) |
| 26 | Community detail (`cmOpen`, 959) |
| 27 | Composer (`cmp`, 982) |
| 28 | Player picker (`pick`, 1074) |
| 29 | Global search (`gs`, 1091) |
| 30 | Column tip popover (1109), then the toast (1117). The toast is later in the DOM, so it sits above the popover. It also sits above any open sheet. |

- Every full-screen overlay at z ≥ 21 is `position:absolute; left:0; right:0; top:50px; bottom:0; background:b0`. It completely hides the dock, so **no tab bar or switcher is visible inside any full-screen overlay**.
- `prof`, `trade` and `settings` also switch the dock to small mode underneath. `teamView`, `tradeOpen`, `page`, `cmOpen`, `cmp`, `pick` and `gs` leave the dock state unchanged.

---

### 2. Layout, top to bottom

#### 2.1 Bottom dock (overlay model)
- The dock is part of the flex column but is pulled up over the screen with negative margins, so content scrolls behind it.
- The fills are translucent with **no backdrop blur**. Content shows through at 6–14%.
- The **switcher strip and the tab bar are two separate surfaces** with different alphas: light .90 vs .94, dark .86 vs .92. This leaves a visible tone step (seam) at y = 764 between them. Do not build them as one surface.
- **Large dock** (league screen), measured:
  - Switcher strip at y 696–764 (68 px).
  - Tab bar at y 764–844 (80 px).
  - The strip has `margin-top:-148px`, so it overlays the bottom 148 px of the screen.
- **Small dock**: the tab bar has `margin-top:-80px` and overlays the bottom 80 px.
- **Hit areas**:
  - Each tab-bar item reacts only inside its own 48 px tall box.
  - The bar's top 6 px, its side 8 px and its bottom 26 px have no handler. Neither do the switcher strip's 6/8 px padding around the card.
  - These areas sit at z 4 above the content, so they **swallow taps** without doing anything.
- **Scroller clearance**:
  - Rule: `.fsm-scroll[style*="overflow-y"]::after{content:"";display:block;flex:none;height:var(--x-dockpad,0px)}`, with `.dock-lg{--x-dockpad:150px}` and `.dock-sm{--x-dockpad:84px}`. Without a dock class the spacer falls back to 0 px.
  - Every vertical scroller (class `fsm-scroll` plus inline `overflow-y`) gets a trailing spacer of 150 px (2 px more than the dock) or 84 px (4 px more than the bar).
  - `::after` is the last child **inside** the content box, so it comes **before** the scroller's own `padding-bottom`.
  - In flex-column scrollers with `gap`, the gap is also inserted between the last item and the spacer. Total trailing space = gap + spacer + padding-bottom.
  - Bottom paddings per scroller:

    | Scroller | Bottom padding | Gap |
    |---|---|---|
    | Home, Profile, My start/sit, Community (lines 47, 109, 123, 148) | 24 | — |
    | Transactions (530) | 20 | — |
    | League, Messages, Notifications, sheet body (246, 557, 616, 651) | 0 | — |
    | Conversation (589) | 16 | 4 |
    | Trade detail (838) | 24 | 20 |
    | Trade review (877) | 16 | 20 |

  - On the 2-column grid scroller at line 868, the spacer becomes a grid item in the next cell, after a 10 px row gap.
  - The spacer also applies to scrollers inside sheets and overlays (see 2.4).
  - Horizontal scrollers (`overflow-x`) do not get it.

#### 2.2 League switcher (lines 627–638)
- **Strip** (wrapper):
  - `flex:none; position:relative; z-index:4; margin-top:-148px; padding:6px 8px`.
  - `background:var(--x-dockA, rgba(29,29,31,.9))`.
- **Card** (the pointer target):
  - Measured at x 8–382 (374 wide), y 702–758.
  - `position:relative; height:56px; overflow:hidden; border-radius:10px`.
  - `background:var(--x-mini,#3A3A3C)` (README token **mini**).
  - `box-shadow:inset 0 0 0 1px var(--x-miniline,transparent)`, which draws nothing in either theme.
  - `color:#fff; touch-action:none; user-select:none; cursor:grab`.
- **Grab pill**: absolute, `top:4px`, centred, 28×3, radius 999, `rgba(255,255,255,.28)`. It does **not** move during a swipe.
- **Content row** (the only part that moves):
  - `height:100%`, flex, `align-items:center`, `gap:10px`, `padding:6px 16px 0`.
  - `transform:translateX({{ls.x}})`, `opacity:{{ls.op}}`, `transition:{{ls.tr}}`.
  - The card background stays put, and the card's `overflow:hidden` clips the sliding row.
- Row contents, left to right:
  1. **League avatar**: 34×34, radius 10, 12/600. Text `lg.ini` on `lg.av`, text colour `lg.avFg`. `avFg` is `#1D1D1F` when the avatar is `#ECAD48`, otherwise `#fff`.
  2. **Text column**: `flex:1; min-width:0`, column, gap 1.
     - Line 1: 14/600, nowrap, ellipsis. `"{lg.team} "` plus an inner span at 12/500 `rgba(255,255,255,.62)` with `{lg.rec}`.
     - Line 2: 11/500, `rgba(255,255,255,.62)`, nowrap, ellipsis. `{lg.name}`.
  3. **Dots**: flex, gap 4, `flex:none`, one per league (4 dots, about 44 px total).
     - Each dot is 6 px tall, radius 999, with a static `transition:width .2s linear`.
     - Active: width 14, `var(--x-b0,#fff)`.
     - Inactive: width 6, `#636366` (not a README token).
  4. **Chevron up**: 14×14, path `M4 10l4-4 4 4`, stroke `rgba(255,255,255,.62)`, width 2, round caps and joins, `flex:none`.

#### 2.3 Tab bars (lines 639–643)
- **Bar**:
  - `flex:none; position:relative; z-index:4; margin-top:{{barMt}}` (`0` or `-80px`).
  - Height 80, `padding:6px 8px 0`, `display:flex`.
  - `background:var(--x-barA, rgba(29,29,31,.94))`.
- **Item**:
  - `flex:1` (4 items are 93.5 px each; 5 items are 74.8 px each).
  - Height 48, column, centred, gap 3, `cursor:pointer`, `color:{{b.fg}}`.
  - No pressed state and no colour transition.
  - Icon: SVG 22×22 (viewBox 16), stroke currentColor, `stroke-width:1.5`, round caps and joins.
  - Label: 10/600.
- Space below the items: 80 − 6 − 48 = **26 px**, the home-indicator zone.
- **Colours**: active `#fff`, inactive `#A1A1A6`. `#A1A1A6` is not a README token, and it is the same in both themes.
- **No tab-bar item has a badge.** Unread badges are on the header bell and chat icons (see 5).

**Outside a league** (`scr` is home, community or me):

| # | Label | Icon | Active when |
|---|---|---|---|
| 1 | Home | `ICON.home` `M2.5 7.5L8 3l5.5 4.5V13h-11z` | `scr==="home"` |
| 2 | Community | star `M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z` | `scr==="community"` |
| 3 | Players | `ICON.players` `M5.5 6.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5` | never (`scr` is never "players") |
| 4 | Profile | **avatar** instead of an icon | `scr==="me"` |

- **Profile avatar**:
  - 22×22 circle, 10/600, white text "D" (hard-coded), background `myAv` (default `#0088FF`).
  - Ring when active: `box-shadow: 0 0 0 2px var(--x-ink,#1D1D1F), 0 0 0 3.5px var(--x-b0,#fff)`. That is a 2 px ink band, then a 1.5 px b0 ring. Inactive: `none`.
  - The label follows the same `#fff` / `#A1A1A6` rule.

**Inside a league** (all other `scr`):

| # | Label | Icon path | Active when |
|---|---|---|---|
| 1 | Match | `M2.5 4.5h4v7h-4zM9.5 4.5h4v7h-4zM8 3v10` | `scr==="league" && tab==="match" && sheet!=="menu"` |
| 2 | Team | `ICON.players` (person) | same pattern, `tab==="team"` |
| 3 | Players | `ICON.search` `M7 2.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6zM10.6 10.6L14 14` | `tab==="players"` |
| 4 | League | `ICON.leaders` `M3 13V9h3v4M6.5 13V5h3v8M10 13V7.5h3V13` | `tab==="league"` |
| 5 | Menu | `M2.5 4h11M2.5 8h11M2.5 12h11` | `sheet==="menu"` |

- On `feed`, `trans`, `dms`, `thread`, `notifs` and `myss`, no tab is highlighted, because tabs 1–4 need `scr==="league"`.
- While the Menu sheet is open, tabs 1–4 are forced inactive. The highlighted Menu tab is hidden under the sheet panel.

#### 2.4 Bottom sheet anatomy (lines 646–727)
- **Backdrop**:
  - `position:absolute; inset:0` (the whole 390×844, status bar included), `z-index:20`.
  - `background:rgba(0,0,0,.32)`. The source says **.32**; the README says .4.
  - `display:flex; align-items:flex-end`.
- **Panel**:
  - `width:100%; max-height:86%` (725.84 px, measured 726). Column, `border-radius:24px 24px 0 0`, `background:var(--x-b0,#fff)`, `padding:8px 0 30px`.
  - The panel is bottom-anchored, and its minimum height is 8 + 15 + 39 + spacer (84 or 150) + 30 = 176 or 242 px. So **with any sheet open, the panel always covers the whole dock** (tab bar, and the switcher on the league screen).
- **Grab handle row**: `flex:none`, centred, `padding:2px 0 8px` (a 15 px row). The handle is 36×5, radius 999, `var(--x-b4,#D1D1D6)`. It is decorative only, with no drag behaviour.
- **Header row**: `flex:none`, `align-items:flex-start`, gap 12, `padding:4px 16px 12px 20px`.
  - Title column: `flex:1; min-width:0`, gap 2.
    - Title `{{sheetTitle}}`: 19/600, letter-spacing −0.02em.
    - Subtitle (grid sheet only): 13/500 t3, "Pick the stats shown in the list and sheet views".
  - Close button (leagues sheet only):
    - 32×32 circle, `flex:none`, `var(--x-b2,#F2F2F4)`, colour t1. Pressed: `var(--x-b3,#E5E5EA)`.
    - × icon 14×14, path `M4 4l8 8M12 4l-8 8`, stroke 2.2, round caps.
  - The header is 39 px tall without the button and 48 px with it.
- **Body**: `.fsm-scroll`, `flex:1; min-height:0; overflow-y:auto`.
  - It **also gets the dock spacer**: 150 px on the league screen, 84 px elsewhere. Sheets therefore carry visible empty space under their content.
  - Measured on "Switch league": panel 528 px = 8 + 15 + 48 + 277 content + **150 spacer** + 30.
  - On a tall sheet (Menu) the panel is capped at 726 and the body scrolls (scrollHeight 937 = 787 content + 150).
- **Footer** (`flex:none`, outside the scroller): the chat composer or the Done button (see 2.5).
- **Sheet titles** (`sheetTitle` map):

| `sheet` | Title |
|---|---|
| create | Create |
| leagues | Switch league |
| filters | Transaction filters |
| grid | Customize stats |
| chat | League chat |
| menu | Menu |
| swap | Swap player |

- No open or close animation. The sheet mounts and unmounts instantly.

#### 2.5 Sheet contents

**A. Create** (`sheetCreate`, lines 653–661)
- Container: `padding:0 12px 6px`, column, gap 2.
- Row:
  - `min-height:64px`, flex, centred, gap 12, padding 8, radius 14, `cursor:pointer`. Pressed: `var(--x-b2,#F2F2F4)`.
  - Icon tile: 44×44, radius 12, background `o.bg`. White SVG 20×20 at stroke 1.6.
  - Text: `flex:1; min-width:0`, gap 2. Label 15/600; sub 12/500 t3 with `text-wrap:pretty`.
  - Trailing chevron: 12×12, `M6 3l5 5-5 5`, stroke 2, t5 `#AEAEB2`.

| Label | Sub (exact) | Icon | Tile bg |
|---|---|---|---|
| Start or sit | Ask who to start, or whether to take a trade | `M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5` | `#07B85A` |
| Ranking | Rank players for a week, rest of season or the draft | `ICON.rank` `M4 13V8M8 13V3M12 13V6` | `#0088FF` |
| List | Group players for research, targets or stashes | `ICON.lists` `M3 4h10M3 8h10M3 12h6` | `var(--x-t1,#1D1D1F)` |

**B. Switch league** (`sheetLeagues`, lines 663–672)
- Container: `padding:0 12px 6px`, gap 2.
- Row:
  - `min-height:60px` (measured 60), gap 12, padding 8, radius 14.
  - Background `var(--x-b1,#F5F5F7)` on the current league, otherwise transparent. Pressed: `var(--x-b2,#F2F2F4)`.
  - Avatar: 40×40, radius 12, 13/600, `o.ini` on `o.av`, text colour `o.avFg`.
  - Text column: `flex:1; min-width:0`, gap 2.
    - Line 1: 15/600, nowrap, ellipsis. `"{team} "` plus a span at 12/500 t3 with `{rec}`.
    - Line 2: 12/500 t3, nowrap, ellipsis. `"{name} · {sub}"`.
  - Current league shows a check: 18×18, `flex:none`, `#0088FF`, stroke 2.2, path `M3 8.5l3.2 3L13 4.5`.
- Footer text (inside the scroller): "Swipe the bar left or right to switch faster". 12/500 t3, centred, `padding:8px 8px 0`.

**C. Transaction filters** (`sheetFilters`, lines 674–681)
- Label "Transaction type": `padding:0 20px 6px`, 12/600 t3.
- Chip row:
  - Horizontal `.fsm-scroll`, gap 6, `padding:0 20px 14px`.
  - Chip: `flex:none`, height 36, `padding:0 16px`, radius 999, 13/600, nowrap. **No pressed state.**
  - On: `#0088FF` background, `#fff` text. Off: `var(--x-b2,#F2F2F4)` background, t1 text.
  - Labels: "All types", "Trades", "Free agents", "Waivers".
- Teams section (only when `showTeamFilter`):
  - Label "Teams": `padding:0 20px 4px`, 12/600 t3.
  - Row: height 48, flex, centred, gap 12, `margin:0 20px`, `border-bottom:1px solid var(--x-b2,#F2F2F4)` (the last row too). **No pressed state.**
    - Avatar: 28 circle, 11/600 white text, background `c.av`.
    - Name: 14/600, `flex:1`.
    - Round checkbox: 22×22.
      - Checked: `#0088FF` fill, no ring.
      - Unchecked: `var(--x-b0,#fff)` fill with `inset 0 0 0 1.5px var(--x-b4,#C7C7CC)`.
      - The white check (11×11, stroke 3, `M3 8.5l3.2 3L13 4.5`) is **always** drawn.
  - Rows in order:
    1. "All teams": avatar `var(--x-t5,#AEAEB2)`, initials "•".
    2. Then the 12 managers in TEAMS order, named by handle without the @: dalton, marcus, priya, devin, sam, tara, leo, nina, chris, owen, maya, raj.
       - Avatar colours: `#0088FF`, `var(--x-ink,#1D1D1F)`, `#9D70E9`, `#F75252`, `#ECAD48`, `#5C7CE5`, `#07A852`, `#FF8A00`, `var(--x-t2,#3A3A3C)`, `#00A6A3`, `#E5508A`, `var(--x-t3,#6E6E73)`.
       - Initials (first letter of the team name): T, G, P, E, S, B, L, H, F, R, M, R.
       - The "dalton" row reflects My team edits (see 3, My team save).
- Footer **Done** button:
  - Wrapper: `padding:12px 20px 0`.
  - Button: height 50, radius 999, `#0088FF`, white 16/600 "Done". Pressed: `#0074DB`.

**D. Customize stats** (`sheetGrid`, lines 683–690; data from `pVals.gridGroups`, line 1465)
- Eight groups, each with:
  - Label: `padding:4px 20px 6px`, 12/600 t3.
  - Options: wrapping row, gap 6, `padding:0 20px 16px`.
  - Option pill:
    - `flex:none; min-width:0`, `padding:8px 14px`, radius 14.
    - Flex column, gap 2 (only one child is ever rendered, because `hasSub` is false).
    - Label: 14/600, nowrap.
    - **No pressed state.**
    - On: `#0088FF` background, `#fff` text. Off: `var(--x-b2,#F2F2F4)` background, t1 text.
- Groups and options (PCOLS labels, in PCOLS order within each group):

| Group | Options |
|---|---|
| Fantasy | Proj, Avg pts, Total pts, Pos rk, Ovr rk |
| Ownership | Rost, +/-, Start |
| Matchup | OPRK |
| Base stats | Tot yds, Tot TD, Pass yds, Pass TD, Int, Rush yds, Rush TD, Rec yds, Rec TD |
| Usage | Snap %, Touches, Opps |
| Advanced passing | Att, Cmp %, Air yds, aDOT, Sacks, CPOE |
| Advanced rushing | Rush att, Rush share, YCO/att, RYOE, Broken tkl, RZ att |
| Advanced receiving | Tgt, Tgt share, Rec, Catch %, YAC, aDOT, YPRR |

- Default on (`PCOL_DEF`, in this exact order): proj, avg, tot, prk, ovr, rost, chg, oprk, snap, tgt, tshare, ratt, totyd. This is **not** canonical order: Tot yds is last.
- Footer: Done button, as in C.

**E. Swap player** (`sheetSwap`, lines 692–701)
- Container: `padding:0 12px 8px`.
- Selected-player box: `padding:2px`, radius 14, `var(--x-b1,#F5F5F7)`, holding one row. That row has a pressed state, but its click is a no-op.
- Row (the same in all three lists):
  - Flex, centred, gap 10, `padding:8px 6px`, radius 12, `cursor:pointer`. Pressed: `var(--x-b2,#F2F2F4)`.
  - Slot chip: 44×28, `flex:none`, radius 9, 11/600, text `r.slot` (DST is shown as "D/ST").
    - Background from `POS`: QB `#F75252`, RB `#5C7CE5`, WR `#9D70E9`, TE `#ECAD48`, K `#D2E8E8`, DST `#FFE75E`, FLEX `var(--x-ink,#1D1D1F)`.
    - BN uses the **literal** `#EDEDF0` (`rowFor`), not `POS.BN`.
    - Text colour from `POSFG`: `#1D1D1F` for K, DST and BN; `#fff` otherwise.
  - Then one of:
    - A filled slot: `FSHeadshot` at size 34. Spec:
      - 34×34 circle, `overflow:hidden`, background `#EEEEF1`, `title` = full player name.
      - Ring `0 0 0 1px #fff, 0 0 0 3px {TC[team]}` (ring width 2 because size ≥ 32). An unknown team gets `inset 0 0 0 1px rgba(0,0,0,.04)` instead.
      - Image: absolute `inset:0`, `object-fit:cover`, `object-position:50% 15%`, `transform:scale(1.25) translateY(8%)`.
      - If there is no file, or `onError` fires, it shows initials: 12/700 (`max(9, round(34×.36))`), colour `#6E6E73`.
      - Initials rule: strip a trailing " D/ST", split on spaces, apostrophes and hyphens, then take the first letter of the first part plus the first letter of the last part, uppercased. Examples: Kendrick Bourne → "KB" (no headshot file); A.J. Brown → "AB"; Steelers D/ST → "S".
    - An empty slot: an empty 34 circle with `inset 0 0 0 1.5px var(--x-b3,#E5E5EA)`.
  - Text column: `flex:1; min-width:0`, gap 1.
    - Line 1: 14/600, nowrap, ellipsis, colour `r.nameC`. `"{short(name)} "` plus a span at 11/500 t3 with `"{POS} · {TEAM} ({bye})"`.
    - Line 2: 11/500 t3, nowrap, ellipsis. `"{game} "` plus a span at weight 600, coloured `rkC`, with `"({opp rank ordinal})"`.
  - Projection: 13/600, `flex:none`.
- Divider: flex, centred, gap 10, `padding:14px 8px 6px`. Two `flex:1` 1 px `var(--x-b3,#EBEBEE)` lines around "Choose a player to swap" at 12/600 t3.
- Then the starter candidates.
- Then "Bench" (13/600, `padding:12px 8px 4px`) when there are bench candidates, followed by those candidates.
- Or the empty state "No eligible players for this slot": `padding:16px 8px`, 13/500 t3, centred.
- In the Team tab, the lineup or bench slot chip being swapped gets the ring `0 0 0 2px #fff, 0 0 0 4px #0088FF` while this sheet is open (`rowFor`, when `sheet==="swap"` and `swapFor` matches kind and index).

**F. Menu** (`sheetMenu`, lines 703–716)

The JUMPS labels "Menu · leagues & app" (#19) and "Menu · league settings" (#25) open the same sheet.

1. **My team card**:
   - `margin:0 12px 14px`, flex, centred, gap 12, padding 12, radius 16, `var(--x-b1,#F5F5F7)`. Pressed: `var(--x-b2,#EDEDF0)`.
   - Avatar: 44 circle, 16/600 white, background `myTeam.av` (= `myAv`, default `#0088FF`). Initial is `myName[0]` ("T"), and it is not uppercased.
   - Text column: `flex:1; min-width:0`, gap 1.
     - Name: 15/600, nowrap, ellipsis. "Touchdown Tacos" (= `myName`).
     - Sub: 12/500 t3, "My team · edit name and avatar".
   - Chevron: 12, t5.
2. **Section label** `{{lg.name}}` (for example "Sunday Funday League"): `padding:0 20px 6px`, 12/600 t3.
3. **League list**:
   - Wrapper: column, `padding:0 12px 14px`.
   - Row: height 48, gap 12, `padding:0 8px`, radius 12. Pressed: `var(--x-b2,#F2F2F4)`.
   - Icon tile: 32×32, radius 9, `var(--x-b2,#F2F2F4)`, holding a t1 16×16 icon at stroke 1.5.
   - Label: 15/600, `flex:1; min-width:0`.
   - Sub: 12/500 t3, nowrap.
   - Chevron: 12, t5.

   | Label | Sub | Icon |
   |---|---|---|
   | League settings | 12 teams | `ICON.leaders` |
   | Scoring | Standard | `M3 13h10M5 10V6M8 10V3M11 10V7` |
   | Playoffs | Weeks 15–17 | `M3 3.5h3v3H3zM3 9.5h3v3H3zM6 5h2.5v6H6M8.5 8H13` |
   | Draft results | Aug 30 | `ICON.lists` |
   | League history | Since 2023 | `M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5` |
   | Previous seasons | 3 | `ICON.sched` `M3 4.5h10v8.5H3zM3 7.5h10M6 3v3M10 3v3` |
   | Notifications | (empty) | `M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14h3` |
   | Co-owners | None | `M6 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13c.4-2 2-3.2 4-3.2s3.6 1.2 4 3.2M11 7.5a1.8 1.8 0 1 0 0-3.6M12 9.9c1.3.4 2.2 1.5 2.5 3.1` |
   | Commissioner note | (empty) | `ICON.news` `M3.5 3.5h9v9h-9zM5.5 6h5M5.5 8.5h5M5.5 11h3` |
   | Stat corrections | (empty) | `M3 13h10M4.5 10.5l6.8-6.8 1.5 1.5-6.8 6.8H4.5z` |

4. **Section label "FieldScout"**: `padding:0 20px 8px`, 12/600 t3.
5. **App grid**:
   - `grid-template-columns:repeat(3,minmax(0,1fr))`, gap 8, `padding:0 20px 8px`.
   - Tile: height 76, radius 16, `var(--x-b1,#F5F5F7)`, column, centred, gap 6. Pressed: `var(--x-b2,#EDEDF0)`.
   - Icon 22×22, t1, stroke 1.5. Label 12/600.
   - Tiles in order (row 1 has three tiles, row 2 has two):
     - Home: `ICON.home`
     - Community: star
     - Stats: `M3 13V9h3v4M6.5 13V5h3v8M10 13V7.5h3V13`
     - Profile: `ICON.profile` `M8 8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 14c.8-2.6 3-4 5.5-4s4.7 1.4 5.5 4`
     - Settings: gear `M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1`
- The Menu sheet has no × and no Done button.
- Content height is 787: card 82 + label ≈21 + list 494 + label ≈22 + grid 168. The panel is always capped at 726.
- With the body scrolled to the top, the area where the Menu tab sits (x 307–382, y 770–818) holds:
  - the league list's bottom padding and the "FieldScout" label (y ≈ 770–799);
  - then the top edge of the **Stats** tile (y ≈ 799–814; tile x ≈ 259–370);
  - then the panel's 30 px bottom padding (from y 814).

**G. League chat** (`sheetChat`, lines 717–723; unreachable)
- Body: column, gap 14, `padding:0 20px 12px`.
- Message row: flex, gap 10.
  - Avatar: 30 circle, 11/600 white, initial `who[0]`. Background is `TEAMS[i].av`, or `var(--x-t5,#AEAEB2)` for system messages.
  - Text column: gap 3, `min-width:0`.
    - Meta line: 12.5/600, `"{who} "` plus `{time}` at 500 t3.
    - Text: 14/500, line-height 1.4, `text-wrap:pretty`. Colour t1, or t3 for system messages.
- Sample messages:
  - Priya (i 2, `#9D70E9`), 12:41 PM: "Who's starting Shough over Love? Bold."
  - Leo (i 6, `#07A852`), 12:44 PM: "Watson for 53 to the house. Missing people report is over."
  - League (system, t5), 12:58 PM: "You added K. Bourne (WR · ARI)"
- Footer (`flex:none; padding:8px 16px 0`):
  - Pill: flex, centred, gap 6, height 44, `padding:0 6px 0 16px`, radius 999, `var(--x-b2,#F2F2F4)`.
  - Input: placeholder "Message the league", 15/500, t1, borderless and transparent.
  - Send circle: 34 diameter, `#0088FF`, white up-arrow 14×14 at stroke 2.2, path `M8 13V3M3.5 7.5L8 3l4.5 4.5`.
  - The Send circle is **always shown, never disabled, with no pressed state**.

#### 2.6 DM composer (Conversation screen, lines 603–605)
- Row: `flex:none`, flex, centred, gap 8, `padding:8px 12px 10px`, `border-top:1px solid var(--x-b3,#EBEBEE)`. The row is 59 px tall.
- "+" button:
  - 36 circle, `flex:none`, `var(--x-b2,#F2F2F4)`. **No pressed state.**
  - Icon 16, t1, `M8 3v10M3 8h10`, stroke 1.8, round caps only.
  - Tap: `soon()` → toast "Not part of this prototype".
- Field:
  - `flex:1`, flex, centred, height 40, `padding:0 6px 0 14px`, radius 999, `box-shadow:inset 0 0 0 1px var(--x-b3,#E5E5EA)`.
  - Input: single-line, placeholder "Message", 15/500, t1, `flex:1; min-width:0`, borderless, transparent, `font-family:inherit`.
  - "Send" pill, shown only when `hasMsg`: height 30, `padding:0 12px`, radius 999, `#0088FF`, white 13/600. **No pressed state.**
- **Measured defect:** on Conversation, the small dock (tab bar at y 764–844, z 4) completely covers this composer (y 785–844).

#### 2.7 League settings overlay (`hasSettings`, lines 823–831; unreachable, see 1)
- Container: absolute, `top:50px; bottom:0`, z 23, b0, column.
- Header: height 48, `padding:0 12px`.
  - Close button: 36 circle, `var(--x-b2,#F2F2F4)`, × 14 at stroke 2.2. **No pressed state.**
- Scroller: `padding:4px 16px 32px`, plus the 84 px spacer (settings forces `dock-sm`).
- Title block: `padding:0 4px 16px`, gap 2.
  - "Sunday Funday League" (hard-coded, not `lg.name`): 24/700, letter-spacing −0.02em.
  - "League settings": 14/500 t3.
- Grid: `repeat(2,minmax(0,1fr))`, gap 8.
- Tile:
  - `min-height:116px`, padding 14, radius 16, `var(--x-b1,#F5F5F7)`, column, gap 5. Pressed: `var(--x-b2,#EDEDF0)`.
  - Icon: 18, t1, stroke 1.5, `flex:none`, `margin-bottom:6px`.
  - Label: 15/600.
  - Sub: 12/500, line-height 1.4, t3, `text-wrap:pretty`.
- The 13 SETTINGS tiles, in order (line 1339):

| Label | Sub | Icon path |
|---|---|---|
| My team | Team name, avatar and player nicknames | `ICON.profile` |
| General | League name, size and roster | `M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4` (a different gear from the Menu "Settings" tile) |
| Draft | Draft type, order and pick timer | `M2.5 3.5h11v9h-11zM2.5 6.5h11M6 3.5v9M9.5 3.5v9` |
| Playoffs | Teams, weeks and seeding | `M3 3.5h3v3H3zM3 9.5h3v3H3zM6 5h2.5v6H6M8.5 8H13` |
| Scoring | Point values for every stat | `ICON.leaders` |
| Notifications | Choose which alerts you get | `M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14h3` |
| Commissioner note | Notes from your commissioner | `ICON.news` |
| Co-owners | Share control of your team | `M6 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13c.4-2 2-3.2 4-3.2s3.6 1.2 4 3.2M11 7.5a1.8 1.8 0 1 0 0-3.6M12 9.9c1.3.4 2.2 1.5 2.5 3.1` |
| Draft results | Every pick from this season's draft | `ICON.lists` |
| League legend | What the icons and labels mean | `M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 7.5V11M8 5h.01` |
| League history | Past champions and all-time stats | `M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5` |
| Previous seasons | Open this league from past years | `ICON.sched` |
| Stat corrections | Recent scoring changes from the NFL | `M3 13h10M4.5 10.5l6.8-6.8 1.5 1.5-6.8 6.8H4.5z` |

#### 2.8 Column tip popover (lines 1108–1116)
- Backdrop: absolute `inset:0`, z 30, `rgba(0,0,0,.18)`, flex, centred, padding 24.
- Card:
  - Width 100%, `max-width:300px`, padding 16, radius 18, b0.
  - `box-shadow:0 12px 32px rgba(0,0,0,.2)`.
  - Column, gap 8.
- Header row: `align-items:flex-start`, gap 8.
  - Text column: `flex:1; min-width:0`, gap 2.
    - Abbreviation: 11/600 t3, `PCOLMETA[k][0]` (for example "Proj").
    - Full name: 17/700, letter-spacing −0.01em, `PCOLMETA[k][1]` (for example "Projected points").
  - Close button: 28 circle, `flex:none`, `var(--x-b2,#F2F2F4)`, t1, × 12 at stroke 2.2. **No pressed state.**
- Description: 13/500, line-height 1.45, `var(--x-t2,#3A3A3C)`, `text-wrap:pretty`. Copy is `PCOLMETA[k][2]`, for example "FieldScout's projected fantasy points for this period."
- Sort button: `margin-top:4px`, height 36, radius 999, 13/600, centred. No pressed state.
  - When this column is not the sort: "Sort by this", `#0088FF` background, white text.
  - When it already is: "Sorted by this", `var(--x-b3,#E5E5EA)` background, `var(--x-t2,#3A3A3C)` text.

#### 2.9 Toast (line 1117)
- `position:absolute; left:50%; bottom:100px; translateX(-50%)`, z 30.
- Height 36, `padding:0 16px`, radius 999, `background:var(--x-ink,#1D1D1F)`, `#fff` 13/500, nowrap.
- **No max-width.** A long string overflows sideways and is clipped by the 390 px frame.
- It occupies y 708–744.
  - On the league screen it **overlaps the switcher card** (y 702–758). This was confirmed in the render.
  - Elsewhere it sits 20 px above the tab bar.
  - It sits above any open sheet.
- No enter or exit animation.

#### 2.10 Notifications screen (`scr==="notifs"`, lines 609–626)
- **Header** (line 610): `flex:none`, height 52, flex, centred, gap 8, `padding:0 12px`.
  - **Back pill**:
    - Height 36, flex, centred, gap 2, `padding:0 8px 0 4px`, radius 999, `#0088FF` text at 15/500. Pressed: `var(--x-b2,#F2F2F4)`.
    - Chevron 18×18, `M10 3L5 8l5 5`, stroke 2, round caps and joins. Label "Back".
    - Tap calls `backFromDms`.
  - Spacer `flex:1`.
  - **"Mark all read"**: 14/600 `#0088FF`, `padding:0 6px`. No pressed state. It is always shown, even after everything is read. Tap sets `notifRead:true`.
- **Title** (line 615): `flex:none`, "Notifications", 28/600, letter-spacing −0.03em, `padding:0 16px 8px`.
- **Scroller** (line 616): `flex:1`, no padding, plus the 84 px spacer.
- **Row** (line 618):
  - Flex, gap 12, `padding:12px 16px`. No dividers.
  - Background `var(--x-gb2,#F5FAFF)` when unread, otherwise `var(--x-b0,#fff)`. Pressed: `var(--x-b1,#F5F5F7)`.
  - Icon circle: 40, `flex:none`, background `n.iconBg`. SVG 18×18 with `stroke={n.iconC}` at 1.7, round caps and joins.
  - Text column: `flex:1; min-width:0`, gap 2.
    - Title: 14px, weight 600 when unread and 500 otherwise, line-height 1.35, `text-wrap:pretty`, t1.
    - Meta: 12/500 t3, `"{sub} · {time}"`.
  - Unread dot: 9×9, `flex:none`, `margin-top:6px`, circle, `#0088FF`. Shown only when unread.
- **Unread rule**: `!notifRead && k < 4`.
  - The first **four** rows render unread, while the bell badge says **3** (hard-coded, `nUnread = notifRead ? 0 : 3`).
  - Tapping a single row does not mark it read or change the badge.
- **Rows** (`NOTIFS`, line 1198, in this fixed order; the times are not sorted):

| k | Title | Sub | Time | Icon | Stroke | Circle bg |
|---|---|---|---|---|---|---|
| 0 | Trade offer from Marcus | Darnell Mooney + 2026 3rd for James Conner | 8m | `ICON.trade` `M3 5.5h9.5L10 3M13 10.5H3.5L6 13` | `#0088FF` | `var(--x-gb,#E6F2FF)` |
| 1 | @shahranks updated Week 5 · RB · PPR | Hubbard ▲4, Conner ▼3 · 4 changes | 40m | `M3 13.5V9M8 13.5V3M13 13.5V6.5` | `#9D70E9` | `var(--x-gp,#F3EDFD)` |
| 2 | Jameson Williams scored a TD | +7.6 pts · Touchdown Tacos | 22m | `M3 8.5l3.2 3L13 4.5` | `#07A852` | `var(--x-gg,#E3F9EC)` |
| 3 | Waiver claim processed | You added Kendrick Bourne for $1 | 12h | `M8 3.5v9M3.5 8h9` | `#07A852` | `var(--x-gg,#E3F9EC)` |
| 4 | T.J. Hockenson is out this week | He's in your TE slot. Set your lineup. | 1d | `M8 4.5v4M8 11h.01` | `#FF0028` | `var(--x-gr,#FFE9EC)` |
| 5 | Lineup locks in 2 hours | Sun 1:00 PM games | 2d | `M8 4.5V8l2.5 1.5` | `#FF8A00` | `var(--x-go,#FFF3E6)` |

- **Row taps**:
  - k 0: `set({tradeOpen:"marcus"})`. The trade offer detail opens at z 23 over Notifications, and closing it returns to Notifications.
  - k 1: navigates to `FieldScout Mobile Lists and Rankings.dc.html#view-r1`.
  - k 2–5: toast the row's own title, for example "Waiver claim processed".
- Dock: in-league bar, no tab highlighted, small dock.

---

### 3. Interactions

**Tab bar, outside a league**
- **Home**, **Community**, **Profile**: `set({scr:v, sheet:null})`. Tapping the active tab again does nothing else: no scroll-to-top and no reset.
- **Players**: toast "Not part of this prototype".

**Tab bar, inside a league**
- **Match**, **Team**, **Players**, **League**: `set({scr:"league", tab:v, sheet:null, swap:null})`.
  - `swap` is an unused key. The handler does **not** clear `swapFor`.
  - When v is "match" and the current `tab` is already "match", it also sets `mi:0`, which returns to "Your matchup". The check is on `tab` only, so it also fires when coming back from Feed, Messages and similar screens while `tab` is still "match".
  - These tabs work from `feed`, `trans`, `dms`, `thread`, `notifs` and `myss`. They return to the league screen, where the switcher reappears.
- **Menu**: toggles `sheet` between `"menu"` and `null`. It does not change `scr`, so the Menu sheet can open over Feed, Messages and the other non-league screens.
- **While any sheet is open, the tab bar cannot be used.** The sheet panel always covers the whole dock (see 2.4), and the panel has `onClick={{ stop }}`.
  - A tap where the Menu tab was hits panel content and nothing closes. If the tap lands on the Stats tile edge, the toast "Not part of this prototype" shows.
  - **The Menu tab's toggle-to-null branch is therefore unreachable.** The Menu sheet closes only via the backdrop above the panel or via a navigating item.
- **Scroll position**: all four league tabs render inside **one** scroller (lines 246–452). Switching Match, Team, Players and League keeps the current `scrollTop`, clamped to the new content's height. Switching between `scr` screens unmounts the screen, which resets scroll to the top.

**League switcher gestures** (`ls`, lines 1771–1776; pointer events on the 56 px card only)
- `pointerdown`:
  - Stores the start x and y.
  - Calls `setPointerCapture`.
  - Sets `lsAnim:false`. This also kills an in-flight transition.
- `pointermove`:
  - Horizontal-dominant (`|dx|>|dy|`): `lsDx = clamp(dx, −140, 140)`.
    - **There is no dead zone.** Any horizontal-dominant move, even 1 px, translates the row. The row follows the finger with no transition.
    - Opacity is `max(0.2, 1 − |lsDx|/200)`: 1.0 at 0, 0.4 at 120, 0.3 at 140.
  - Vertical-dominant with `dy < −24` (upward more than 24 px): opens the "Switch league" sheet **immediately, mid-gesture**. Tracking stops, and `lsDx` is set to 0 with no animation.
  - Vertical-dominant downward, or upward by 24 px or less: nothing happens. `lsDx` stays **frozen at its last horizontal value** until release.
- `pointerup` outcomes:

| Condition | Effect |
|---|---|
| `abs(dx) > 50` and `abs(dx) > abs(dy)` | `step(dx<0 ? +1 : −1)`: swipe **left = next** league, **right = previous**, wrapping (index mod 4) |
| tap (`abs(dx) < 8` and `abs(dy) < 8`) **or** `dy < −24` | animated snap back to 0, and the "Switch league" sheet opens |
| anything else (short drag, downward drag) | animated return to 0 |

- `pointercancel`: animated return to 0.
- **Step animation**:
  1. Set `lsAnim:true`, and `lsDx` to −120 for next or +120 for previous. The current content slides out in the swipe direction with `transform .14s linear, opacity .14s linear`; opacity goes to 0.4.
  2. After 140 ms: set `lg` to the new index, `lsAnim:false`, and `lsDx` to the opposite side (+120 for next, −120 for previous). This is an instant jump.
  3. After two `requestAnimationFrame`s: set `lsAnim:true` and `lsDx:0`, so the new content slides in over .14 s linear.
  4. The dots animate width over `.2s linear` (14↔6).
  5. The toast "Switched to {new team}" fires at the start of the step, for example "Switched to Dalton's Dynasty".
- **No guard against a second swipe during the 140 ms step.**
  - `step()` reads `s.lg` from the render closure, and `lg` does not change until the timeout.
  - So a second swipe within 140 ms recomputes from the **same** league: both timeouts set the same new `lg`, and the toast repeats.
  - A double swipe therefore advances only one league.
- What changes on a switch:
  - The switcher card (avatar, team, record, league name, dots).
  - The league header name (`lg.name`, line 237).
  - The Menu sheet section label.
  - The team-view league name (`tv.lgName`).
  - The trade-detail league line, which shows `LEAGUES[lg].sub` (for example "12-team standard"), **not** the name.
  - The League settings page "League name" row (`pg.general`, `LEAGUES[s.lg].name`).
- All other league content (matchups, roster, standings) is static sample data and does not change in the prototype.

**Switch league sheet rows**
- Tap: `set({lg:i, sheet:null})`.
- If the row is not the current league, it also toasts "Switched to {team}".
- In this path the switcher's row slide and fade does **not** run. The dots still animate width 6↔14 over `.2s linear`, because the transition is static on each dot.

**Opening and closing sheets**

| Sheet | Opened by | Closed by |
|---|---|---|
| Create | Community header "+" (line 149): 34 circle, `#0088FF`, white, pressed `#0074DB` | backdrop tap, or choosing an option |
| Switch league | tap, or upward swipe, on the switcher card | × button, backdrop tap, or choosing a row |
| Transaction filters | The "Filter" pill (height 30, `padding:0 12px`, gap 6, 12/600, filter icon 12 `M2.5 4.5h11M4.5 8h7M6.5 11.5h3` at stroke 1.8) on League › Activity (line 447) and on Transactions (line 528). Label is "Filter", or "Filter · N" where N = (type ≠ All) + (any teams selected, when not in My moves). Colours are `var(--x-gb,#E6F2FF)` / `var(--x-tb,#0074DB)` when N > 0, otherwise `var(--x-b2,#F2F2F4)` / t1. | Done, backdrop tap |
| Customize stats | "Customize" pill on Players | Done, backdrop tap |
| Swap player | Three entry points: (1) a starter's slot chip (44×30, line 316); (2) a **bench** row's "BN" chip (44×30, line 330); (3) for an **empty** slot, the name column too (`rowFor` sets `openP = swap`). All set `{sheet:"swap", swapFor:{t:"s"\|"b", i}}`. | backdrop tap, or choosing a candidate |
| Menu | Menu tab | backdrop tap above the panel, or a navigating item (see below) |

- `closeSheet` sets `sheet:null` only. It does not clear `swapFor`.
- The panel stops click propagation, so taps inside the panel never close the sheet.
- There is no swipe-down to dismiss and no Escape handling.
- These also set `sheet:null` when they fire: tab taps, `go()`, `goDms`, `goNotifs`, `goHome`, `goHomeLogo`, the Menu's page rows and its Home/Community/Profile tiles. A tap on the backdrop closes the sheet before anything under it can be reached.

**Create sheet options**
- **Start or sit**: `sheet:null` and `cmp = {kind:"poll", qtype:"ss", q:"", mode:"start", pickN:1, opts:[null,null,null], give:[null], get:[null], roster:null, scoring:"PPR", close:"kickoff"}`. This opens the composer overlay (z 27).
- **Ranking**: `window.location.href = "FieldScout Mobile Lists and Rankings.dc.html#new-ranking"` (the new-ranking flow). The sheet is not closed first.
- **List**: `sheet:null` and `cmp = {kind:"list", step:1, name:"", desc:"", pub:true, players:[], videos:[], link:"", color:"#0088FF"}`.

**Transaction filters**
- Type chips are single-select: `tType` ∈ All, Trades, Free agents, Waivers.
- Team rows are multi-select: `tTeams` is an array of team indices.
  - "All teams" is checked when the array is empty. Tapping it clears the array.
  - Tapping a team toggles it.
- Changes apply live to the list behind the sheet. Done only closes.
- **The filter state is shared.** `tType` and `tTeams` are one state used by League › Activity and by Transactions.
  - League › Activity (lines 445–450) renders only the Filter pill and no list. Filters set there have no visible effect until the user opens Transactions, where they carry over.
  - `go("trans")` and the Team "Moves" action reset `tType` to "All" but **not** `tTeams`.
  - A team page's "All moves" sets `tTeams:[ti]`.
  - In My moves (`tMine`), the team filter is ignored and the Teams section is hidden.

**Customize stats**
- Each pill toggles its column. There is no minimum: every column can be removed.
- **Order**: the Players table renders columns in `s.pcols` order (`pVals`, `cols = s.pcols.filter(...)`).
  - **Removing** a column keeps the current order.
  - **Adding** a column rebuilds the whole array in canonical PCOLS order (`PCOLS.map(z=>z[0]).filter(z => z===k || s.pcols.includes(z))`).
  - So the first add also moves "Tot yds" from last (where PCOL_DEF puts it) to right after "OPRK".
- Removing the sorted column (default `psort:"proj"`) leaves the rows sorted by the now-hidden column. Nothing resets `psort`.
- Changes apply live. Done only closes.

**Swap player**
- A target (t2, i2) qualifies when all of these hold:
  - It is not the selected slot itself.
  - At least one of the two slots holds a player.
  - The selected player fits the target slot.
  - The target's player fits the selected slot.
- `fits`:
  - An empty slot fits anything.
  - BN accepts any player.
  - FLEX accepts RB, WR or TE.
  - Any other slot needs an exact position match.
- Bench candidates are the filled bench slots that qualify, plus only the **first** empty bench slot.
- Tapping a candidate swaps the two slots, sets `sheet:null, swapFor:null`, and shows one of these toasts. Names use `short()`, and slots use the raw SLOTS key (`"DST"`, `"FLEX"`), not "D/ST":
  - "Swapped {A} and {B}"
  - "Moved {A} to bench"
  - "Moved {A} to {SLOT}"
  - "Moved {B} to {SLOT or bench}"
- Tapping the selected row (top box) does nothing, although it shows the pressed fill.
- Example (JUMPS #21, `swapFor {t:"s", i:3}`, the WR slot holding A.J. Brown):
  - The selected row reads "A.J. Brown" (kept in full by `short()`).
  - Starter candidates: J. Williams (WR). FLEX is excluded because Pacheco (RB) does not fit WR.
  - Bench candidates: K. Bourne, J. Dotson, and Empty (the 6th bench slot).
  - Toast example: "Swapped A.J. Brown and J. Williams".

**Menu sheet**
- **My team card** (`openMyTeam`): `set({sheet:null, page:"myteam", draftName:myName, draftAv:myAv})`. This opens the "My team" page overlay (z 25, back chevron `M10 3L5 8l5 5` in `#0088FF`).
- **League rows** (`menuLeagueItems`, line 1784): `k ? set({sheet:null, page:k}) : toast(label + ": screen coming next")`.
  - These rows set `sheet:null` and open a page:
    - League settings → page "general" (title "League settings")
    - Scoring → "scoring" ("Scoring")
    - Playoffs → "playoffs" ("Playoffs")
    - Draft results → "draft" ("Draft results")
    - League history → "history" ("League history")
    - Previous seasons → "seasons" ("Previous seasons")
  - None of these rows seed `draftName`/`draftAv`; no league row opens My team.
  - **Notifications, Co-owners, Commissioner note and Stat corrections only toast**, for example "Co-owners: screen coming next". **The sheet stays open**, and the toast (z 30) shows above it.
  - Closing a page (`page:null`) returns to the underlying screen **without** reopening the Menu.
- **App tiles**:
  - Home → `scr:"home"`, Community → `scr:"community"`, Profile → `scr:"me"`. All three also set `sheet:null`.
  - **Stats** and **Settings** call `soon()`. They toast "Not part of this prototype" and **leave the sheet open**.

**League settings tiles** (unreachable overlay)
- My team, General, Scoring, Playoffs, Draft results, League history and Previous seasons set `page` to the matching key, with `draftName = myName` and `draftAv = myAv`. The page opens at z 25 over settings (z 23), so closing the page returns to settings.
- The other tiles toast "{label} settings: screens coming next": Draft, Notifications, Commissioner note, Co-owners, League legend, Stat corrections.
- × sets `settings:false`.

**My team save** (`pg.save`, line 1792): global side effects that reach this area.
- Save mutates the module tables `TEAMS[0].name`, `TEAMS[0].av`, `TEAMS[0].ini` (= the new name's first character, **not** uppercased) and `LEAGUES[0].team`, then sets `myName`, `myAv` and `page:null`, and toasts "Team updated".
- After a rename:
  - League 0's switcher card, its Switch league row and its "Switched to …" toast show the new name.
  - The filter sheet's "dalton" row takes the new colour and initial.
  - The Profile tab avatar and the Menu my-team avatar follow `myAv`. The Menu card initial follows `myName[0]`.
  - The Profile tab initial stays "D".

**Column tip popover**
- Opened from:
  - (a) a **Sheet view** column header (line 406, `pColsV.sort`). This toggles `colTip`, so tapping the same header again closes the popover.
  - (b) a **List view** stat-strip cell (line 384, `c.tip`).
  - (c) a **Cards view** ("Stats under each player") strip cell (line 396, `x.tip`).
- The Player profile key-stat tiles also bind `k.tip` (line 769), but it is a no-op (`tip: () => {}`, line 1313).
- Closed by a backdrop tap or ×.
- The sort button sets `psort:k` and `colTip:null`, even when that column is already the sort.

**Toast**
- `toast(t)` (line 1624) clears the previous timer and shows `t`. It hides after **1800 ms**; the README says about 2.2 s.
- A new toast replaces the current one immediately.

**DM composer and chat composer**
- `msg` is **one** state value shared by the Conversation composer and the chat sheet.
- `openConvo` sets `{scr:"thread", convo:id, unread[id]:false, msg:""}`, so opening a conversation clears any draft.
- `onChange` writes `msg`. Enter (`onKeyDown`, key "Enter") or the Send button calls `send()`.
- `send()` trims the text. If the text is empty **or there is no open conversation** (`convo`), it does nothing.
- Otherwise it appends `["me",0,text]` to `threads[convo]` and clears `msg`.
- The chat sheet uses the same `send()`, so it would post into the open DM thread, not into `chat`.

**Pressed and hover feedback**
- These have a pressed state:
  - Sheet × (b3 `#E5E5EA`).
  - Create rows, Switch league rows and Swap rows (b2 `#F2F2F4`).
  - Menu card and app tiles (b2 `#EDEDF0`), and Menu league rows (b2 `#F2F2F4`).
  - Done (`#0074DB`) and the Community header "+" (`#0074DB`).
  - Header icon circles and the Back pill (b2 `#F2F2F4`).
  - League settings tiles (b2 `#EDEDF0`).
  - Notification rows (b1 `#F5F5F7`).
- These have **no** pressed state:
  - Tab-bar items, the switcher card and the toast.
  - League settings × (line 825) and column-tip × (line 1111).
  - DM composer "+" (604), the Send pill (605) and the chat Send circle (723).
  - Filter type chips (676), team-check rows (679) and Customize-stats pills (687).
  - The column-tip sort button and "Mark all read".
- Cursor: `grab` on the switcher card, `pointer` elsewhere.

**Animation summary**

| Element | Animation |
|---|---|
| Switcher slide and fade | `transform .14s linear, opacity .14s linear`; 140 ms out, then in |
| Switcher dots | `width .2s linear` (also when switching from the sheet) |
| Sheets, popover, overlays, toast | none (instant mount and unmount) |

---

### 4. Navigation

**Getting into a league (`scr:"league"`)**
- App launch: the initial state is league / match (see 0).
- Home › Matchups › "Sunday Funday League" card (`homeLeagues`, line 1718): `set({scr:"league", tab:"match"})`.
  - It does **not** set `lg:0` or `mi:0`. If the user swiped to another league earlier, they land in that league from a Sunday Funday card.
- The other three Home league cards (Joy to Us, Work League, Family Bragging Rights) only call `soon()` (toast "Not part of this prototype").
- Home › "Trending players" › "See all" (`homeTrendAll`, line 88): `set({scr:"league", tab:"players", pf2:{...status:"avail"}, trendOpen:true, trendTab:"trend"})`. This does not reset `lg`.
- `openTeam(0)` (my own team from standings, a matchup side or global search): `set({scr:"league", tab:"team", teamView:null, tradeOpen:null})`.
- In-league tab bar from feed, trans, dms, thread, notifs or myss (see 3).
- Back and close buttons:
  - Live plays back circle (line 459, `backLeague`): `{scr:"league", tab:"match"}`. It does not clear `sheet`.
  - Transactions × (line 522, `backTeam`): **always** `{scr:"league", tab:"team", sheet:null}`, whatever the origin (Team "Moves", a team page's "All moves", or JUMPS).

**Leaving a league**
- **League header Home button** (line 236). This is the main exit.
  - 38×38 circle, `flex:none`, `margin-left:-6px` (it sits right after the non-tappable 28×28 green logomark tile).
  - `title="Home"`, colour t1. Pressed `var(--x-b2,#F2F2F4)`.
  - 20×20 icon at stroke 1.5, path `M2.5 7.2L8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5z`.
  - `goHome` sets `{scr:"home", sheet:null}`, which swaps in the outside-league bar.
- Menu sheet tiles Home, Community and Profile.
- The header bell and chat icons go to `notifs` and `dms`. These keep the in-league bar.

**Where the bell and chat buttons exist**
- They exist **only** on the Home header (lines 52–53) and the League header (lines 240–241). Each is a 38×38 circle, pressed b2 `#F2F2F4`, with a 20×20 icon at stroke 1.5 and round caps and joins.
  - Bell path: `M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14h3`.
  - Chat path: `M8 13.5c3.3 0 6-2.4 6-5.5S11.3 2.5 8 2.5 2 4.9 2 8c0 1.2.4 2.3 1.1 3.2L2.5 13.8l2.9-.9c.8.4 1.7.6 2.6.6z`.
- Community, Profile, Feed, Transactions, My start/sit, Messages and Notifications have neither.
- Conversation has a back circle (line 584: 36, `#0088FF`, chevron 20 at stroke 2) that calls `goDms`.

**Per-screen dock and highlighted tab**

| `scr` (screen) | Dock | Highlighted | Scroller pad | Back or close target |
|---|---|---|---|---|
| home (Home) | outside bar | Home | 84 | — |
| community (Community) | outside bar | Community | 84 | — |
| me (Profile) | outside bar | Profile (avatar ring) | 84 | — |
| league, tab = match / team / players / league | switcher + in-league bar | that tab (or Menu while the Menu sheet is open) | 150 | Home button → home |
| myss (My start/sit, from Profile) | in-league bar | none | 84 | back circle (line 124: 34, b2, no pressed state) → **`goHome` → Home, not Profile** |
| feed (Live plays) | in-league bar | none | 84 | back → league / match |
| trans (Transactions) | in-league bar | none | 84 | × → league / team |
| dms (Messages) | in-league bar (also when opened from Home) | none | 84 | Back → `prevScr \|\| "league"` |
| thread (Conversation) | in-league bar (covers the composer) | none | 84 | back → Messages (`goDms`) |
| notifs (Notifications) | in-league bar (also when opened from Home) | none | 84 | Back → `prevScr \|\| "league"` |
| any + `prof` / `trade` / `settings` | dock hidden under the overlay; switcher unmounted; small dock | — | 84 | overlay's own ×/back |
| any + `teamView` / `tradeOpen` / `page` / `cmOpen` / `cmp` / `pick` / `gs` | dock unchanged but covered by the overlay | — | unchanged | overlay's own ×/back |
| any + `sheet` | dock unchanged but fully covered by the sheet panel | — | unchanged | backdrop |

**Other navigation rules**
- `goDms` / `goNotifs`:
  - Set `scr`, `sheet:null`, and `prevScr` = the current `scr`.
  - If you are already on dms, thread or notifs, `prevScr` keeps its earlier value.
  - `backFromDms` goes to `prevScr || "league"`. The initial `prevScr` is "league".
- Full-screen overlays close with their own ×, back or Close buttons, which clear their state key. The underlying screen and dock state are kept.
- **JUMPS** (presentation-only, line 1163; equivalent to deep links):
  - `go(scr, tab, sub)` always sets `sheet:null, prof:null, trade:null, settings:false, tradeOpen:null, teamView:null`. It sets `tab` only when given.
  - `go()` does **not** clear `page`, `cmOpen`, `cmp`, `pick`, `gs`, `colTip`, `swapFor` or `tTeams`. A jump while one of those overlays is open leaves it on top.
  - For `"trans"`, it also sets `tMine:false, tType:"All"`.

| # | Label | State |
|---|---|---|
| 1 | Home · leagues | home |
| 2 | Community | community |
| 3 | Profile · lists & rankings | me |
| 4 | Matchup | league / match |
| 5 | Team | league / team |
| 6 | Players · trending | league / players, `ptab:"trend"` |
| 7 | Players · available | league / players, `ptab:"avail"` |
| 8 | Players · leaders | league / players, `ptab:"leaders"` |
| 9 | League · matchups | league / league, `ltab:"matchups"` |
| 10 | League · standings | league / league, `ltab:"standings"` |
| 11 | League · activity | league / league, `ltab:"activity"` |
| 12 | Live plays | feed (does not set `game`; `goFeed` sets "min") |
| 13 | Transactions | trans, with `tMine:false`, `tType:"All"` |
| 14 | Transaction filters | trans + `sheet:"filters"` |
| 15 | Player grid settings | league / players + `sheet:"grid"` |
| 16 | Messages | dms (`prevScr` not updated) |
| 17 | Conversation | thread, `convo:"marcus"`. Unlike `openConvo`, this does **not** clear `unread.marcus` or `msg`. |
| 18 | Notifications | notifs |
| 19 | Menu · leagues & app | league / match + `sheet:"menu"` |
| 20 | League switcher | league / match only (see below) |
| 21 | Swap player | league / team + `sheet:"swap"`, `swapFor:{t:"s", i:3}` |
| 22 | Player profile | league / team + `prof:"Bijan Robinson"`, `pfTab:"summary"`. It does not reset `pfYear`/`pfAvail`, which `openProf` does. |
| 23 | Propose a trade | league / team + trade builder (opponent index 1, theirs `["Josh Allen"]`, mine `["Shedeur Sanders"]`) |
| 24 | Trade offer | dms + `tradeOpen:"marcus"`, `dmFilter:"trades"` |
| 25 | Menu · league settings | same as #19 |

- JUMPS #20: `go()` has no branch for `"leagues"`, so the sheet does **not** open from this jump. It opens only from a tap or upward swipe on the switcher card. The jump-panel entry does highlight whenever that sheet is open on league / match.

---

### 5. Data shown

- **LEAGUES** (line 1194). This is real product data: the user's leagues in a fixed order, which is also the swipe order and the dot order.

| i | name | sub (format) | ini | avatar bg | avFg | my team | rec |
|---|---|---|---|---|---|---|---|
| 0 | Sunday Funday League | 12-team standard | SF | `var(--x-ink,#1D1D1F)` | #fff | Touchdown Tacos (renamed by My team save) | 2-6 |
| 1 | Family Bragging Rights | 10-team standard | FB | `#ECAD48` | #1D1D1F | Dalton's Dynasty | 3-1 |
| 2 | Joy to Us | 12-team PPR | JU | `#9D70E9` | #fff | Taco Tuesday | Draft Aug 28 |
| 3 | Work League | 10-team half PPR | WL | `#5C7CE5` | #fff | Spreadsheet Slingers | Draft Sep 2 |

  - `rec` is "W-L" in season, or "Draft {Mon D}" before the draft.
  - The current league is `lg` (state, default 0).
  - The switcher card shows team, record and league name.
  - Sheet line 2 shows "{name} · {sub}".
  - **Conflicts with the Home league cards** (`homeLeagues`, lines 1717–1722):
    - Home order is SF, JU, WL, FB. LEAGUES order is SF, FB, JU, WL.
    - Work League is "12-team PPR · 2026" on Home but "10-team half PPR" in LEAGUES.
    - On Family Bragging Rights, the user's team is "Touchdown Tacos (3-1)" on Home but "Dalton's Dynasty" in LEAGUES.
- **Unread badges** (headers only, never the tab bar):
  - Bell: red `#FF0028`. Count is a **hard-coded 3** (`nUnread = notifRead ? 0 : 3`), hidden after "Mark all read".
    - It does **not** match the Notifications list, which renders **4** unread rows (k < 4).
    - It does not drop when single notifications are tapped.
  - Chat: blue `#0088FF`. Count = number of conversations with `unread` true: 3 at start (league, marcus, nina). Opening a conversation via `openConvo` clears its flag (JUMPS #17 does not).
  - Badge style: absolute `top:4px; right:4px`, `min-width:16px`, height 16, `padding:0 4px`, radius 999, 10/600 white, centred, ring `0 0 0 2px var(--x-b0,#fff)`. It sits on a 38×38 circular header button.
- **My team / profile**:
  - `myName` "Touchdown Tacos" and `myAv` `#0088FF`, both editable on the My team page.
  - The Profile tab avatar initial is a hard-coded "D" (the user's display name, Dalton).
- **Swap rows**:
  - Name: `short(name)` (line 1129).
    - Names ending in "D/ST", and names whose first token contains "." (A.J. Brown, T.J. Hockenson), are shown **in full**.
    - Everything else becomes "A. Lastname", for example "J. Williams".
    - Empty slot: "Empty" in t5 `#AEAEB2` with an empty ring, and no meta, game, rank or projection.
  - `meta` is "{POS} · {TEAM} ({bye})". DST is displayed as "D/ST".
  - `game` is a string such as "Sun 4:25 PM vs SF".
  - Opponent rank "(13th)" uses ordinals.
    - The 9 players in `MINE` (the original starters) take `OPRK` by their **MINE index**, and the value follows the player after a swap: Shedeur Sanders 13th, Bijan Robinson 9th, James Conner 17th, A.J. Brown 8th, Jameson Williams 22nd, Evan Engram 16th, Isiah Pacheco 5th, Jake Bates 28th, Steelers D/ST 3rd.
    - Every other player, including the bench (Kendrick Bourne, Tyler Allgeier, Jahan Dotson, Rhamondre Stevenson, Dalton Kincaid), gets a seeded `ord(1 + floor(seeded(name+"own")() × 32))`.
    - Colour: ≥ 20 `#07A852`, ≤ 10 `#FF0028`, otherwise `#FF8A00`. This threshold is 20; the README rule is ≥ 23.
  - Projection is a 2-decimal string.
  - Headshots: `assets/headshots/{key}.jpg` from `HEAD`. Jake Bates, Steelers D/ST, Kendrick Bourne, Tyler Allgeier, Rhamondre Stevenson and Dalton Kincaid have no file, so they show initials.
- **Customize stats**: the columns are product configuration. The table renders them in `s.pcols` order (see 3); the sheet lists them in PCOLS order within each group.
- **Column tip**: the abbreviation, name and description come from `PCOLMETA` (product copy).
- **Menu subs** ("12 teams", "Standard", "Weeks 15–17", "Aug 30", "Since 2023", "3", "None") are league settings data.
- **Settings tile subs** are static copy.
- **Notifications** (`NOTIFS`) are real product data in the shape {title, sub, relative time, type icon, colour}. The prototype order is not sorted by time.
- **Toast strings** are real copy (see section 3).

---

### 6. Dark mode (`.fs-dark` on the 390×844 frame; values for this area)

- **Token values** (line 19):

| Token | Light (fallback) | Dark value |
|---|---|---|
| t1 | #1D1D1F | #FFFFFF |
| t2 | #3A3A3C | #D9D9D9 |
| t3 | #6E6E73 | #B3B3B3 |
| t4 | #8E8E93 | #A7A7A7 |
| t5 | #AEAEB2 | #727272 |
| b0 | #fff | #121212 |
| b1 | #F5F5F7 | #282828 |
| b2 | #F2F2F4 / #EDEDF0 | #333333 |
| b3 | #EBEBEE / #E5E5EA | #3E3E3E |
| b4 | #D1D1D6 / #C7C7CC | #575757 |
| ink | #1D1D1F | #4D4D4D |
| tb | #0074DB | #6FB5FF |
| tg / tr / to | #067A3E / #C8001C / #B25C00 | #1ED760 / #FF6B6B / #FFB340 |
| gb | #E6F2FF | #12263F |
| gb2 | #F5FAFF | #16212E |
| gp | #F3EDFD | #261E36 |
| gg / gr / go | #E3F9EC / #FFE9EC / #FFF3E6 | #12301F / #3A1A1D / #3A2A14 |

- **Dock**:
  - Switcher strip `--x-dockA` = `rgba(18,18,18,.86)` (light `rgba(29,29,31,.9)`).
  - Tab bar `--x-barA` = `rgba(18,18,18,.92)` (light `rgba(29,29,31,.94)`). The seam between the two surfaces at y 764 remains.
  - Switcher card `--x-mini` = `#090909` (light `#3A3A3C`).
  - `--x-miniline` is transparent in both themes.
  - `--x-bar` (#121212) and `--x-dock` (#121212) are defined but never used.
- **Tab colours**: unchanged (`#fff` / `#A1A1A6`).
  - The Profile avatar ring becomes a 2 px `#4D4D4D` band plus a 1.5 px `#121212` band, so the outer ring nearly disappears against the bar.
  - If the user picked the `var(--x-t1,#1D1D1F)` swatch on My team, the Profile tab avatar renders `#FFFFFF` behind the white "D", so the initial is invisible.
- **Switcher**:
  - Card text and the .62/.28 white alphas are unchanged. The inactive dot stays `#636366`.
  - The **active dot is `var(--x-b0)` = `#121212`, which is nearly invisible on `#090909`.** Confirmed in a render: three grey dots with a gap where the active one should be.
  - The SF league avatar becomes `#4D4D4D`.
- **Sheets**:
  - Backdrop unchanged at `rgba(0,0,0,.32)`.
  - Panel `#121212`, handle `#575757`, title `#FFFFFF`, subtitle `#B3B3B3`.
  - × button `#333333`, pressed `#3E3E3E`.
  - Pressed rows `#333333`. Current-league row `#282828`. Chevrons `#727272`.
  - Chips and pills: off is `#333333` with white text; on stays `#0088FF` with white text. Done stays `#0088FF`.
  - Switch league: the SF avatar `#4D4D4D` sits on the `#282828` current-row fill.
  - Transaction filters:
    - Team-row dividers `#333333`.
    - Unchecked checkbox: `#121212` fill with a `#575757` ring. Because the white check glyph is always drawn, **unchecked boxes show a white check in dark mode**.
    - Team avatars:
      - Gridiron Gurus (ink) → `#4D4D4D`.
      - Fourth & Long (`var(--x-t2)`) → `#D9D9D9` under a white "F", which is near-invisible.
      - Raj's Rushers (`var(--x-t3)`) → `#B3B3B3` under a white "R", which is low contrast.
      - "All teams" (t5) → `#727272`.
      - Touchdown Tacos with the t1 swatch → `#FFFFFF` under a white "T", which is invisible.
  - Menu:
    - Card and tiles `#282828` (pressed `#333333`). Icon tiles `#333333`. Icons `#FFFFFF`. Section labels `#B3B3B3`.
    - With the t1 swatch, the my-team avatar is `#FFFFFF` under a white initial, which is invisible.
  - Create: the "List" tile background is `var(--x-t1)` = `#FFFFFF` behind a white icon, so **the icon is invisible**.
  - Swap:
    - Selected box `#282828`. Empty headshot ring `#3E3E3E`. Divider lines `#3E3E3E`.
    - The BN slot chip uses the literal `#EDEDF0` with `#1D1D1F` text, so it stays light. FLEX uses ink `#4D4D4D`.
    - **FSHeadshot is unthemed**: the 1 px `#fff` gap ring, the `#EEEEF1` fallback background and the `#6E6E73` initials all stay light.
    - The Team-tab swap ring `0 0 0 2px #fff, 0 0 0 4px #0088FF` keeps its literal white inner band.
  - Chat: composer pill `#333333`. System avatar `#727272`. System text `#B3B3B3`.
- **League settings overlay**: background `#121212`, tiles `#282828` (pressed `#333333`), icons `#FFFFFF`, close button `#333333`, sub-copy `#B3B3B3`.
- **Column tip**:
  - Card `#121212`, × `#333333`, abbreviation `#B3B3B3`, name `#FFFFFF`, description `#D9D9D9`.
  - "Sorted by this" is `#3E3E3E` with `#D9D9D9` text.
  - The backdrop `rgba(0,0,0,.18)` and the shadow are unchanged.
- **Toast**: background ink `#4D4D4D`, white text.
- **Unread badges**: the ring `0 0 0 2px var(--x-b0)` becomes `#121212`. The fills `#FF0028` and `#0088FF` are unchanged.
- **Notifications screen**:
  - Unread row `#16212E`, read row `#121212`, pressed `#282828`.
  - Icon circles: gb `#12263F`, gp `#261E36`, gg `#12301F`, gr `#3A1A1D`, go `#3A2A14`. The icon strokes are literal and unchanged.
  - Meta `#B3B3B3`. Back pill pressed `#333333`. The Back and "Mark all read" text stays `#0088FF`.
- **DM composer**:
  - Border and field ring `#3E3E3E`. "+" button `#333333`. Input text `#FFFFFF`.
  - The placeholder stays `#6E6E73`, because the global CSS is not themed.
- **Frame**:
  - Screen background `#121212`. Status bar glyphs `#FFFFFF`. The island stays `#000`.
  - Home indicator `#121212`, invisible under the bar.
  - The bezel and the jump panel stay light, because they are outside the `.fs-dark` scope.

---

### Open questions
- Dropped critic claim: the critic listed League › Activity as one of the routes into the Transactions screen. The source disproves this. League › Activity (lines 445–450) renders only a Filter pill with no list and no link, and the only things that set scr:"trans" are the Team "Moves" action (line 1736), a team page's "All moves" (line 1826) and JUMPS. Should League › Activity show the transactions list, given that filters set there only show up once the user opens Transactions?
- Corrected critic claim: the critic said a Swap sheet with no swapFor shows an empty 4 px box plus the empty-state message. It actually also shows the "Choose a player to swap" divider, because line 695 has no condition. Nothing can reach this state, so no decision is needed.
- Partly true but harmless (kept only as a note): the Menu's league rows don't pre-fill the draft name and colour that the Menu's My team card pre-fills. None of those rows opens the My team page, so this changes nothing on screen.
- The tab bar covers the message composer on the Conversation screen. The bar is 80 px at z-index 4, and the composer sits at y 785–844 (measured). Should Conversation hide the tab bar, or should the composer sit above it?
- Messages and Notifications opened from Home, and My start/sit opened from Profile, all show the in-league tab bar (Match, Team, Players, League, Menu) with no tab highlighted, because `inLg` only excludes home, community and me. Is that intended, or should each of these keep the bar of the place it was opened from?
- The back button on My start/sit goes to Home, even though the screen is opened from Profile. Should it go back to Profile (the Start/Sit tab)?
- Sheets and full-screen overlays carry the 150 px or 84 px dock spacer at the bottom of their scroll area. On the league screen, 150 px of the 528 px Switch league sheet is empty. Should production keep that whitespace, or size sheets to their content?
- The prototype and the README disagree on two values. The sheet backdrop is rgba(0,0,0,.32) in code but .4 in the README. The toast hides after 1800 ms in code but after "about 2.2s" in the README. Which values should production use?
- In dark mode the switcher's active dot is var(--x-b0) = #121212 on a #090909 card, so it can't be seen (confirmed in a render). Should the dark active dot be #FFFFFF?
- In dark mode the Create sheet's "List" icon tile is var(--x-t1) = #FFFFFF behind a white icon, so the icon disappears. The same happens with the t1 colour swatch on My team (the Profile tab avatar, the Menu my-team avatar and the filter row all go white-on-white), and with the Fourth & Long and Raj's Rushers filter avatars (t2 and t3 behind white initials). What should these colours be in dark mode?
- In dark mode, unchecked team checkboxes in Transaction filters show a white check, because the check is always drawn and the unchecked fill is #121212. Should the check be hidden when the box is unchecked?
- In dark mode, FSHeadshot (the #fff gap ring, the #EEEEF1 fallback background and the #6E6E73 initials), the white inner band of the Team-tab swap ring and the light BN slot chip (#EDEDF0) all stay light. Should they be themed?
- The League settings overlay (13 tiles, title hard-coded "Sunday Funday League") can't be reached: nothing in the markup opens it, and the jump labelled "Menu · league settings" opens the Menu sheet. Has the Menu sheet's league section (10 rows) replaced it, or should it still be built, and if so where is it opened from?
- The League chat sheet can't be reached, and its Send posts into whichever direct-message conversation is open, not into the league chat. Should we drop it or build it properly?
- Jump #20 "League switcher" doesn't open the Switch league sheet, because go() has no case for it. In the prototype the sheet only opens from a tap or an upward swipe on the switcher card. Please confirm there's no other way in.
- The toast sits 100 px from the bottom on every screen, so on league screens it covers the switcher card (toast y 708–744, card y 702–758). It has no maximum width either. Should it move above the 148 px dock when the switcher is showing, and should long text wrap or be truncated?
- Safe areas: the prototype hard-codes a 50 px status bar and an 80 px tab bar (6 px top padding, 48 px items, 26 px bottom zone). An iPhone 14 reserves 47 px at the top and 34 px at the bottom. Should production honour env(safe-area-inset-*), for example a bottom zone of max(26px, the inset)? If so, should the scroll clearance (84 and 150 px) grow by the same amount?
- When you switch league, the prototype only updates the switcher, the header name, the Menu section label, the team-page league name, the trade-detail line and the League settings name row. Matchups and roster stay the same. Please confirm that production reloads all league content and remembers the selected league when you leave the league screen and come back.
- The Home "Sunday Funday League" card and Home's "Trending players › See all" both enter the league screen without resetting the selected league. If you swiped to another league earlier, you land in that league instead. Should tapping a league card on Home select that league?
- The Swap sheet colours the opponent rank green at 20 and above, red at 10 and below and orange in between. The README says green at 23 and above. Which threshold applies?
- Inactive tab #A1A1A6, the inactive switcher dot #636366, the pressed fill #EDEDF0 and the BN slot chip #EDEDF0 (which stays light in dark mode) are not README tokens. Should we add them as tokens, or map them to the nearest existing ones?
- The leagues appear in different orders and with different details. The switcher swipes in the fixed LEAGUES order (Sunday Funday, Family Bragging Rights, Joy to Us, Work League), but Home lists Sunday Funday, Joy to Us, Work League, Family Bragging Rights. Home also says Work League is "12-team PPR" where LEAGUES says "10-team half PPR", and shows "Touchdown Tacos (3-1)" for Family Bragging Rights where LEAGUES says "Dalton's Dynasty". Which order and which values are correct?
- The bell badge is hard-coded to 3, but Notifications shows 4 unread rows, and tapping a single notification doesn't mark it read. Should the badge equal the number of unread rows, and should tapping a row mark it read?
- Three Menu rows behave unevenly. The "coming next" rows (Notifications, Co-owners, Commissioner note, Stat corrections) and the Stats and Settings tiles show a toast and leave the Menu sheet open, while every other item closes it. Is that intended? Also, while any sheet is open the tab bar can't be tapped (the panel always covers it), so tapping Menu again never closes the Menu. Should a second tap on the Menu tab close it?
- In Customize stats, adding a column puts every column back in the standard order, so on the first add "Tot yds" jumps from last to just after OPRK, while removing a column keeps the current order. Removing the column the list is sorted by leaves the list sorted by a hidden column. Should added columns go at the end instead, and should the sort fall back (for example to Proj) when its column is removed?
- Swiping the league switcher twice within 140 ms only moves one league, and the "Switched to …" toast shows twice. Should production queue the second swipe, or ignore swipes during the animation?
- The transaction filters (type and teams) are shared between League › Activity and Transactions, and opening Transactions resets the type but not the selected teams. Should each screen keep its own filters, and should the team selection reset too?

---

## Gap analysis vs the current app

## Gap analysis: global frame, bottom dock, tab bars, league switcher, sheets and menus

**Worktree:** `/Users/chrisdaltas/Documents/Hadouken/.claude/worktrees/redesign-v7` at HEAD `27d455b` ("mobile(v1): theme tokens (light/dark), mob: variant, mobile-only dark mode switch").

**Files checked**
- **Layout:** `src/components/layout/{app-shell,bottom-tabs,more-sheet,top-nav,layout-mode-frame}.tsx` and `src/components/layout/rail/{messages-panel,research-rail,notifications-panel-ops}.*`
- **UI primitives:** `src/components/ui/{sheet,toaster,user-avatar}.tsx` and `src/hooks/use-toast.ts`
- **Leagues:** `src/components/leagues/{league-shell,league-shell-ops,lineup-editor,lineup-editor-ops,my-team-ops,activity-page,activity-page-ops,settings-index-ops,league-message-board,players-page}.*`
- **Players and stats:** `src/components/players/{players-spreadsheet,player-link}.tsx`
- **Notifications:** `src/components/notifications/{notifications-feed,notification-href}.ts(x)`
- **Home:** `src/components/home/your-leagues.tsx`
- **Hooks and stores:** `src/hooks/{use-leagues,use-notifications,use-league-activity,use-defense-splits,use-layout-mode}.ts` and `src/stores/theme-store.ts`
- **Routes and API:** `src/app/layout.tsx`, `src/app/app/(shell)/**` (leagues/[leagueId]/*, notifications, start-or-sit, settings, profile), `src/app/api/leagues/[id]/{activity,teams/[tid]/name}/route.ts`
- **Flags and schema:** `src/lib/feature-flags.ts`, `src/lib/sync/usage.ts`, `src/types/database.ts` (`teams`, `leagues`, `profiles`, `player_stats`, `player_usage`, `league_chat`), `supabase/migrations/*` (notification inserts, `150_waiver_processor.sql`, `109_inseason_tables.sql`)

### What exists today (mobile layout)
- **Bottom bar:** one opaque bar, `BottomTabs` (fixed, h-16, `bg-ink`), with Home, Lists, Players, Search and More. More opens a `MoreSheet` (Radix bottom sheet).
- **Top bar:** a global `TopNav` with logo, a bell that links to `/app/notifications` on mobile, a Create dropdown and the avatar.
- **In a league:** a horizontal sub-nav at the top of the page (`LeagueHeaderParts`) with Home, My Team, Matchup, Players, Schedule, Stats and More.
- **Already landed in the last commit:** mobile `m-*` light/dark tokens (including `m-dock` / `m-bar-a`), a `mob:` variant, a `useThemeStore` that stores `localStorage["fieldscout-theme"]`, and a pre-paint head script. **No toggle UI uses them yet.**

### Feature table

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| App opens on League › Match with the large dock (initial state) | out-of-scope-or-question | `src/app/app/(shell)/page.tsx` (Home is `/app`) | The app opens on Home. Leagues are a flag-gated test cohort, so opening in a league only works for members. Chris's call. |
| Presentation shell: jump panel, bezel, `body #F5F5F7`, JUMPS list | out-of-scope-or-question | n/a | Prototype-only. Do not build. JUMPS map onto real URLs, which already deep-link. |
| Status bar, dynamic island and home indicator → OS safe areas | restyle-only | `src/app/layout.tsx` (no `viewport` export) | Nothing in `src` uses `viewport-fit=cover` or `env(safe-area-inset-*)`. Needed for the top inset and the 26px home-indicator zone under the tabs. |
| Inter Display, `tnum`/`cv11`, antialiasing | restyle-only | `layout.tsx` (Inter with `opsz` axis), `fs-num` | Inter Display is covered by the `opsz` axis. Check `cv11` is set. |
| Screen = fixed headers + one vertical scroller | restyle-only | `app-shell.tsx` (`main overflow-y-auto`), `top-nav.tsx` | Mobile needs per-screen headers instead of the global TopNav. |
| **Dark mode** (toggle, Profile header pill, `.fs-dark` values, saved preference) | out-of-scope-or-question | `src/stores/theme-store.ts`, `use-layout-mode.ts` head script, `globals.css` `--m-*` dark block | The worktree CLAUDE.md still says single theme, no toggle. Commit 27d455b cites a "Chris, 2026-10-15: dark mode is mobile-only" ruling and adds the tokens, store and no-flash head script. **No toggle UI exists.** The conflict needs Chris to settle it in CLAUDE.md. If it goes ahead, do not copy the prototype's dark-mode defects: invisible active switcher dot, white check on unchecked boxes, invisible "List" Create icon, white-on-white t1 avatar swatch, unthemed FSHeadshot and placeholder. |
| `soon()` "Not part of this prototype" placeholders | out-of-scope-or-question | n/a | Most have real destinations in the app: Players tab → `/app/players`, Stats → `/app/stats`, Settings → `/app/settings`. The DM "+" has none. |
| Dock overlay model: translucent bar over scrolling content, no blur, switcher/bar seam, scroller clearance 84/150 | restyle-only | `bottom-tabs.tsx`, `app-shell.tsx` (`pb-20`) | Tokens `bg-m-dock` / `bg-m-bar-a` already exist. Build clearance as scroller padding plus the safe-area inset. Do not copy the prototype's tap-swallowing dead padding or the dock spacer inside sheet bodies. |
| Outside-league tab bar (Home, Community, Players, Profile avatar) | out-of-scope-or-question | `bottom-tabs.tsx` (Home, Lists, Players, Search, More) | Lists is the launch surface but has no tab in the design. Community (`featureFlags.community`) is off at launch. Search (command palette) and More drop out. Needs a ruling on the tab set. |
| Profile tab avatar (22px, initial, colour, active ring) | restyle-only | `ui/user-avatar.tsx`, `profiles.avatar_url/username` | No per-user colour column exists. Use `avatar_url` or a derived colour. |
| In-league tab bar (Match, Team, Players, League, Menu) and its active-tab rules | new-ui-on-existing-data | `league-shell-ops.ts` `leagueTabs` / `leagueMoreItems` / `activeLeagueSection`; routes `matchup`, `team/[teamId]`, `players`, `standings`, `schedule`, `activity` | All routes exist; the bar and mapping are new. "League" = the schedule/standings/activity sub-tabs. Pre-draft disabled tabs (`NOT_STARTED_REASON`) need a mobile treatment. |
| League Home, Schedule and Stats pages have no slot in the 4-tab league bar | out-of-scope-or-question | `leagues/[leagueId]/page.tsx` (League Home with message board), `schedule`, `stats` | "Delete nothing" means they need a home: Menu, or a League sub-tab. |
| Re-tapping Match returns to "Your matchup" | restyle-only | `/matchup` vs `/matchup/[mid]` | Falls out of the routes. |
| One shared scroller across the four league tabs (scroll position carried over) | out-of-scope-or-question | n/a | Prototype artefact. In the app each tab is a route, and resetting scroll is fine. |
| League switcher card (avatar, team + record, league name, dots, chevron) in the large dock | new-ui-on-existing-data | `top-nav.tsx` `LeagueSwitcher` (desktop-only dropdown), `use-leagues.ts` `MyLeagueRow`, `use-league`, `use-standings`, `use-draft-pool` `useLeagueScoringFamily` | `/api/leagues` returns name, avatar_url, team_count, status and my_team_id. It does **not** return my team name, record, format or draft date. Extend that read (query only, no new table) or fan out per league. |
| League avatar colours (ink, amber, purple, blue + `avFg`) | restyle-only | `league-cells.tsx` `Crest`, `leagues.avatar_url` | No league colour column exists. Use `avatar_url` with the ink initials fallback, or a fixed palette. A stored colour would be new backend. |
| Switcher gestures: swipe left = next / right = previous with wrap, slide/fade 140ms, upward swipe or tap opens the sheet, dot width animation, "Switched to {team}" toast | new-ui-on-existing-data | none; no gesture library (no vaul or use-gesture) | Hand-rolled pointer events. A switch must route to the same tab in the other league, and the my-team id differs per league. Guard the prototype's double-swipe race. |
| "Switch league" sheet (rows, current-league check, ×, swipe hint) | new-ui-on-existing-data | `top-nav.tsx` dropdown (name, role, check) | Row line 2 "{name} · {12-team PPR}" = team_count + scoring family. Same data gap as the switcher card. |
| Bottom-sheet anatomy (backdrop .32, 24px top radius, grab handle, 19/600 title, optional subtitle, × on some sheets only, max-h 86%, footer slot) | restyle-only | `ui/sheet.tsx` (Radix, `side="bottom"`, overlay black/40, always renders ×, `shadow-hard-8`, 200ms slide) | Add a mobile CVA variant. Keep Radix Escape and focus trap, which the prototype lacks. Neither has swipe-to-dismiss. |
| Create sheet (Start or sit / Ranking / List) | restyle-only | `top-nav.tsx` `CreateMenu`, `ListFormDialog` via `ui-store`, `/app/start-or-sit/new`, `/app/weekly-ranks` | List works today. Start or sit (`startOrSit`) and Ranking (`weeklyRanks`) are flag-off at launch. The sheet is opened from the Community "+", and Community is off. The app's "Create or join a league" and "Start a mock draft" rows are missing from the design (question). |
| Transaction filters sheet: type chips, multi-select teams with round checks, Done, "Filter · N" pill | new-ui-on-existing-data | `activity-page.tsx` / `activity-page-ops.ts` (URL tabs: All, Adds & drops, Trades, Commissioner, Stat corrections), `api/leagues/[id]/activity` (`type` csv + single `team_id`), `team-transactions-panel.tsx` (My moves) | Free agents vs Waivers splits on `transactions.type` (`add` vs `waiver_claim`). **Multi-team needs `team_id` to accept a list** (small route change). Keep the Commissioner and Stat corrections views. |
| Customize stats sheet, shell + base columns (Proj, Total pts, base passing/rushing/receiving stats, Att, Sacks, Tgt, Rec, Rush att) | new-ui-on-existing-data | `players-spreadsheet.tsx` `CustomizePopover` / `COLUMNS` (research page only); `leagues/players-page.tsx` has fixed value columns and no Customize | Convert the popover to pill groups and add it to the league Players page. |
| Customize stats, derived columns (Avg pts, Pos rk, Ovr rk, Cmp %, Catch %, Touches, Opps, Snap %, Tgt share, OPRK) | new-ui-on-existing-data | `player_stats`, `player_usage` (`snap_pct`, `target_share`; season look-back via `lib/sync/usage.ts`), `defense_position_splits` + `oprkOf` | All computable from stored data. |
| Customize stats, new-data columns (Rost %, +/-, Start %, Air yds, aDOT, CPOE, Rush share, YCO/att, RYOE, Broken tkl, RZ att, YAC, YPRR) | needs-new-backend | `player_stats.advanced` JSONB exists (109) but nothing fills it | Needs platform ownership data and an advanced-stats provider or sync. Rush share needs team rush totals in the usage sync. |
| Column tip popover (abbreviation, full name, description, Sort by this / Sorted by this) | new-ui-on-existing-data | `players-spreadsheet.tsx` `SortableTh` (`title={column.full}`, sorting) | Description copy (PCOLMETA) does not exist; it is copy, not backend. Reset sort when the sorted column is hidden; the prototype leaves it sorted. |
| Swap player sheet (selected box, starter and bench candidates, slot chips, headshots, game + OPRK, projection, toasts, ring on the slot being swapped) | restyle-only | `lineup-editor.tsx` (dnd + "move" DropdownMenu), `lineup-editor-ops.ts` `planMove` / `positionMatches`, `my-team-ops.ts` `moveOptions` / `moveToastCopy` / `oprkOf` / `oprkTone`, `PlayerFace`, `useSetLineup` autosave | Eligibility, swap and autosave all exist; only the sheet presentation is new. **Keep Chris's OPRK band** (1–10 red, 23+ green, D486), not the prototype's 20. Keep the app's lock and IR states, which the design doesn't show. |
| Menu sheet: "My team" card, edit **name** | new-ui-on-existing-data | `api/leagues/[id]/teams/[tid]/name` (`rename_own_team`) | Exists. |
| Menu sheet: "My team" card, edit **avatar/colour** | needs-new-backend | `teams` has no avatar or colour column | Needs a column plus an RPC. |
| Menu league rows that exist: League settings, Scoring, Playoffs, Draft results, Stat corrections | new-ui-on-existing-data | `settings?section=` (`settings-index-ops.ts`), `playoff-bracket.tsx`, `draft/recap`, `corrections` page / `activity?tab=corrections` | Row subs ("12 teams", "Weeks 15–17", draft date) come from `indexRows`. |
| Menu league rows with no backend: League history, Previous seasons, Co-owners, Commissioner note, per-league Notifications | needs-new-backend | none (no season linkage, co-owner model, note field or notification-preference table) | `leagues.description` exists but is unused; it could serve as the Commissioner note (question). |
| Menu app grid (Home, Community, Stats, Profile, Settings) | new-ui-on-existing-data | `/app`, `/app/explore` (`community` off), `/app/stats`, `userProfileHref`, `/app/settings` | Routes exist. |
| Current More-sheet items with no place in the design (Mock drafts, Big board, Rankings, Start or sit, Teams, Leagues index, History, Sign out, Search) | out-of-scope-or-question | `more-sheet.tsx`, `bottom-tabs.tsx` | Where they live on mobile needs a ruling. |
| League chat sheet (messages, system lines, composer) | restyle-only | `league_chat` table, `use-league-chat`, `league-message-board.tsx` | Data, send and system posts exist. Do not copy the prototype's shared `msg` draft, which posts chat into the open DM. |
| League settings overlay, 13-tile grid | restyle-only | `settings-index-ops.ts` (Teams & members, Season & playoffs, Scoring, Roster & lineups, Draft, Waivers & trades), commish console | Keep the app sections the design lacks. Tiles that need backend are covered by the Menu rows above. |
| League legend tile | new-ui-on-existing-data | none | Static copy only. |
| Toast (ink pill, 36px, bottom 100px, 1.8s, replaces the current toast) | restyle-only | `ui/toaster.tsx`, `use-toast.ts` (limit 1, 4500ms, icon + close, swipe down) | Add max-width and truncation (the prototype overflows). Place it above the dock, not over the switcher. |
| DM composer (Conversation: "+", pill input, Send pill when text is present) | needs-new-backend | `rail/messages-panel.tsx` (mock `RailDmThread`, `featureFlags.messages`) | DMs have no backend. The dock must not cover the composer (a prototype defect). "+" is a placeholder. |
| Header chat button + unread-conversations badge | needs-new-backend | `research-rail.tsx` (`dmUnreadCount()` = 0) | Needs DM threads and read state. The league thread exists, but `league_chat` has no read marker. |
| Header bell + red unread count (Home and League headers only) | restyle-only | `top-nav.tsx` `NotificationBell` (real `unreadCount`, 9+ cap, accent badge) | Use the real count; the prototype hard-codes 3. |
| Notifications screen: rows (unread tint + dot, 40px coloured icon circle, "{sub} · {time}") | restyle-only | `notifications-feed.tsx` (`notificationKind` tone, `notificationIcon`, `relativeTime`), `/api/notifications` | Real data exists. |
| Notifications screen: Back pill + "Mark all read" | new-ui-on-existing-data | `useMarkNotificationsRead` (all or ids) | The page currently **auto-marks everything read on open**. Keeping or replacing that is a question. |
| Notification row destinations | restyle-only | `notification-href.ts` | Trades → `/trades` and invites → `/join`. **`league_waiver_claim` has no href arm**, so the row is inert. |
| Notification types that exist: trade offer, waiver claim processed, followed list updated | restyle-only | migrations 148/151 (trade notify), 150 (`league_waiver_claim`), 019 (`list_updated`) | Ranking updates depend on `weeklyRanks` (flag off). |
| Notification types that don't exist: "{player} scored a TD", "{player} is out — in your lineup", "Lineup locks in 2 hours" | needs-new-backend | none | Needs live scoring events, an injury-vs-lineup alert job and a lock reminder job. |
| Overlay stacking: full-screen overlays hide the dock, sheets above the dock, toast on top | restyle-only | player view modal / mini card, trade builder, `CommandPalette`, `ListWindowsHost` | Define a z-order. |
| Navigation: header Home button leaves the league, Back returns to the previous screen, Transactions × → Team | restyle-only | routes + `router.back` | Do not copy the prototype's quirks: My start/sit back goes to Home, and Messages/Notifications keep the in-league bar even when opened from Home. |
| Pressed (`:active`) feedback instead of hover | restyle-only | all components | Mobile pressed-state tokens (`m-b2`, `m-b2h`) exist. |
| Live plays feed and the 7s simulated plays | needs-new-backend | none | Referenced here only for dock state; covered in the Live plays section. |
| Inconsistent prototype league data (Home vs LEAGUES order, formats, team names) | out-of-scope-or-question | `/api/leagues` order | Use one real order everywhere. |

### Prototype defects not to copy
- The composer is hidden under the dock.
- The bell says 3 while 4 rows are unread.
- The toast overlaps the switcher.
- The dock padding swallows taps.
- The sheet body carries the 150/84px dock spacer.
- `tTeams` stays applied across screens.
- The Menu tab's close branch can never be reached.
- `swapFor` is never cleared.
- A double swipe advances only one league.
- The unchecked check glyph and the active-dot colour are wrong in dark mode.
