## Home and Notifications

**Sources** (all in `FieldScout Mobile.dc.html` unless another file is named):

- **Markup**
  - Home: l.46–107 (`isHome`)
  - Notifications: l.609–626 (`isNotifs`)
  - League switcher: l.627–638
  - Tab bar: l.639–643
  - Home indicator: l.644
  - Bottom sheet shell: l.646 onwards; Menu sheet body: l.703–716
  - Overlays: team view l.730, profile l.750, settings l.824, trade detail l.833, trade builder l.859–860, full page l.892, Community detail l.959, composer l.982, picker l.1074, global search l.1091
  - Column-tip backdrop: l.1109. Toast: l.1117.
- **Script constants**
  - `MINE` l.1145, `TREND` **l.1148**, `TRANS` l.1152
  - `ICON` **l.1153–1159**, `side()` l.1161, `MUPS` l.1162, `JUMPS` l.1163
  - `CONVOS` l.1185–1193, `LEAGUES` l.1194, `TRADES` l.1195
  - `UNREAD0` **l.1197**, `NOTIFS` **l.1198**, `TC` l.1201
  - `PDB` / `pinfo` l.1216–1221, `ownerOf` l.1249
- **Component**
  - Initial `state`: l.1414. `openProf`: l.1417.
  - `pVals()`: `showTrendCard` l.1456 and `homeTrend*` l.1467–1469.
  - `ssVals()`: l.1487. `toast()`: l.1624.
- **renderVals()**
  - `soon` l.1627, `go()` l.1628
  - `dmCount` **l.1699**, `nUnread` l.1700, `openTeam` l.1701, `openConvo` l.1703
  - `inLg` / `lgTabbar` l.1708–1710, `goHome` l.1714
  - Home values l.1715–1722
  - `meTabs` l.1810, `openGS` / `goHomeLogo` l.1819
  - Trade detail l.1828–1838, `sheetMenu` l.1843
  - Navigation and badges l.1844–1847
  - `notifs` l.1853, `markRead` l.1854, `menuLeagues` l.1855 (unused), `menuApps` l.1856
  - `tabbar` l.1857, `barMt` / `themeCls` l.1858
- **Other files**
  - Runtime `support.js`: `collectProps` l.384–399 and `createPseudoSheet` l.1351–1366.
  - `FieldScout Mobile Lists and Rankings.dc.html`: l.368–369, l.405, l.416–417, l.436, and markup l.49.
  - `FSHeadshot.dc.html`.
- **Rendered measurements** come from running the prototype in headless Chromium (Playwright, Inter Display loaded from rsms.me, 390×844 frame). The critic's figures from a second renderer are given as "alt".

### 0. Frame facts that apply to this area

**Light-mode colours are the fallbacks.**
- The `--x-*` variables are defined only under `.fs-dark` (helmet `<style>`, l.19). In light mode every `var(--x-foo, #hex)` renders its fallback hex.
- One token can therefore have two light values. For example, `--x-b2` falls back to `#F2F2F4` on header buttons and the segmented track, but to `#EDEDF0` on the (unrendered, see below) pressed state of tiles and league cards.
- Copy each fallback exactly as listed.

**Colour key (README token → value used here):**

| README name | Light | Used for in this area |
|---|---|---|
| t1 Primary text | #1D1D1F | text, header icons, IR pill bg |
| t2 Strong secondary | #3A3A3C | injury note |
| t3 Secondary text | #6E6E73 | meta, subs, segment off |
| b0 Page | #FFFFFF | page, segment on, read row, badge cut-out |
| b1 Cards | #F5F5F7 | tiles, league cards, practice card |
| b2 Chips/segmented track | #F2F2F4 | segmented track, row dividers, button pressed |
| b3 Dividers/bar tracks | #E5E5EA | win-prob track, Join outline |
| ink Selected fill | #1D1D1F | tile icon squares, SF avatar, Start pill, toast |
| Accent | #0088FF | links, Back, Mark all read, DM badge, unread dot, roster line |
| Brand green | #07D066 | logo tile |
| Filled green | #07B85A | win ≥ 50% |
| Success text | #07A852 | trending adds, TD/waiver notif icon |
| Danger | #FF0028 | notif badge, alert dot, Out pill, drops, win < 50% |
| Warning/orange | #FF8A00 | Questionable pill, lineup-lock icon |
| Orange tint bg / text | #FFF3E6 / #B25C00 (`--x-go` / `--x-to`) | Pre-draft pill |
| Blue tint bg | #E6F2FF (`--x-gb`) | trade notif icon bg |
| Green tint bg | #E3F9EC (`--x-gg`) | TD/waiver notif icon bg |
| Red tint bg | #FFE9EC (`--x-gr`) | injury notif icon bg |
| (not in README) | #F5FAFF (`--x-gb2`) | unread notification row bg |
| (not in README) | #F3EDFD (`--x-gp`) | ranking notif icon bg |
| WR / RB / TE position chip bg | #9D70E9 / #5C7CE5 / #ECAD48 | league avatars JU / WL / FB |

**Font**
- Family `'InterDisplay', sans-serif`, with `font-feature-settings: 'tnum' 1, 'cv11' 1` and `-webkit-font-smoothing: antialiased`. Root text colour is `t1`.
- **Every text node in this area uses `line-height: normal`.** The only exception is the notification title at 1.35 (l.620).
- Inter Display's `normal` line box is ascender 0.96875 + descender 0.2421875, which is about 1.2109 × font size.
- Chromium rounds the ascent and the descent separately, which gives these rendered line boxes:

  | Font size | Rendered line box (Chromium) | Unrounded 1.2109× |
  |---|---|---|
  | 10px | 12px | 12.1 |
  | 11px | 14px | 13.3 |
  | 12px | 15px | 14.5 |
  | 13px | 16px | 15.7 |
  | 14px | 17px | 16.95 |
  | 15px | 19px | 18.2 |
  | 17px | 20px | 20.6 |
  | 19px | 23px | 23.0 |
  | 20px | 24px | 24.2 |
  | 28px | 34px | 33.9 |

- In Tailwind 3, `text-sm`, `text-base` and the other size classes add their own line-heights, and **`leading-normal` is `1.5`, not CSS `normal`**. Set explicit line-heights from this table (e.g. `leading-[20px]` for 17px) or use `leading-[normal]` with the same font. Otherwise every height below drifts.

**Phone frame and status bar**
- Phone frame: 390×844, `display:flex; flex-direction:column`, bg `b0` (`#FFFFFF`), `overflow:hidden`, radius 48 (the bezel is presentation-only).
- Status bar: 50px, `flex:none`, padding `6px 32px 0 40px`.
  - Left: "9:41", 16px/600, colour inherits `t1`.
  - Dynamic island: 120×34, radius 999, `#000`, top 11, centred.
  - Right: signal glyph (18×12) and battery glyph (25×12), gap 6, both coloured `var(--x-t1,#1D1D1F)`.

**Pressed states: declared, but mostly not rendered.**
- `style-active="…"` is compiled by the runtime into a generated class rule `.scpN:active{…}` with no `!important` (`support.js` l.397, l.1365).
- React applies `style` inline, and inline styles beat class rules. So **any element that has an inline `background` never shows its declared `:active` background.**
- Verified by forcing `:active` in Chromium:
  - A My-stuff tile stays `rgb(245,245,247)`.
  - The header Search button turns `rgb(242,242,244)`.
- **Visibly pressed in the prototype:**
  - the Home header Search, Bell and Messages buttons (l.51–53)
  - the Notifications Back button (l.611)
- **Declared, not rendered (design intent only):**
  - My-stuff tiles `:active var(--x-b2,#EDEDF0)` (l.58)
  - league cards `:active var(--x-b2,#EDEDF0)` (l.66)
  - notification rows `:active var(--x-b1,#F5F5F7)` (l.618)
- Nothing in this area has a hover state.

**Dock spacer**
- Helmet CSS: `.fsm-scroll[style*="overflow-y"]::after{content:"";display:block;flex:none;height:var(--x-dockpad,0px)}`.
- Both screens get frame class `dock-sm` (`--x-dockpad:84px`), because the `dock-lg` condition `scr==="league" && !prof && !trade && !settings` is false.
- Every vertical scroller here therefore ends with an 84px empty block. The block sits inside the content, before the scroller's own bottom padding.

**No transitions.** None are declared in this area, so every state change (segment switch, mark read, badge hide, screen change) is instant.

**README vs code (the code wins and is what is specified here):**

| Topic | README says | Code does |
|---|---|---|
| Toast duration | "about 2.2s" | **1800ms** (l.1624) |
| Sheet backdrop | `rgba(0,0,0,.4)` | **`.32`** (l.647) |
| Page title | 26–28/**700** | Notifications title is **28/600** (l.615) |
| Transitions | "linear, about 200ms" | none in this area |
| Dark success / danger text | dark #1ED760 / #FF6B6B | this area uses literal `#07A852` / `#FF0028`, which **do not** switch in dark |
| Hit targets | at least 30px | "Mark all read" is 17×96px, "See all" is 16×40px |
| Accent pressed | #0074DB | not applied here; the links are `<span>`s with no pressed style |

---

### 1. Screens and states

| # | Screen / state | Exact condition |
|---|---|---|
| H1 | **Home** | `state.scr === "home"` (`isHome`). Initial state is `scr:"league", tab:"match"` (l.1414), so the prototype opens on League › Match, not Home. |
| H1a | Notification badge visible (red, "3") | `hasNotifBadge = nUnread > 0`, where `nUnread = s.notifRead ? 0 : 3` (l.1700, hard-coded 3) |
| H1b | Notification badge hidden | `s.notifRead === true` (after "Mark all read") |
| H1c | DM badge visible (blue, count) | `dmCount > 0`, where `dmCount = Object.values(s.unread).filter(Boolean).length` (l.1699). `UNREAD0 = {league:true, marcus:true, nina:true}` (l.1197) gives **3**. Opening a conversation (`openConvo`, l.1703) sets that id to `false` and the count drops. At 0 the badge is hidden. |
| H1d | League card, live matchup | `l.live === true` (Sunday Funday League, Family Bragging Rights) |
| H1e | League card, pre-draft | `l.pre === true`. Shows the orange "Pre-draft" pill and no score block (Joy to Us, Work League). |
| H1f | League card red alert dot | `l.hasDot === true` (only Sunday Funday League) |
| H1g | Trending, Adds | `(s.homeTrend \|\| "adds") === "adds"` (initial `homeTrend:"adds"`) |
| H1h | Trending, Drops | `s.homeTrend === "drops"` |
| H1i | Injury row with "On your roster" line | `r.hasMine` (non-empty `mine`): Conner, Hill, Kittle |
| H1j | Toast over Home | `s.toast !== ""`. Set by `soon()` → "Not part of this prototype". |
| H1k | Global search over Home | `s.gs != null` (`hasGS`), z 29 (other area) |
| H1l | Player profile over Home | `s.prof != null` (`hasProf`), z 22 (other area). Home stays mounted underneath, so its scroll position is kept. |
| H1m | Home under a Community overlay (presentation artefact) | Jump panel #1 `go("home")` (l.1628) does not clear `cmOpen`, `cmp`, `pick`, `gs` or `page`. Home can therefore sit under a Community detail (z26), composer (z27), picker (z28), global search (z29) or full page (z25). Not reachable by tapping inside the phone. |
| N1 | **Notifications** | `state.scr === "notifs"` (`isNotifs`) |
| N1a | Row unread | `!s.notifRead && k < 4` (rows 0–3) |
| N1b | Row read | `s.notifRead === true`, or `k >= 4` (rows 4–5 are always read) |
| N1c | All read | after `markRead` sets `notifRead:true`. All 6 rows are read, no dots, every notification badge hidden. |
| N1d | Trade detail over Notifications | `s.tradeOpen === "marcus"` (`hasTd`), z 23 (other area) |
| N1e | Toast over Notifications | rows 2–5, and the trade-detail Accept/Decline toasts |
| N1f | Menu sheet over Notifications | `s.sheet === "menu"` (in-league tab bar → Menu). Backdrop and sheet at z 20 cover the dock. |
| N1g | Team view over Notifications | trade detail → tap the opponent side → `tradeOpen:null` + `openTeam(1)` → `teamView:1`, z 21 |
| N1h | Trade builder over Notifications | trade detail → Counter → `tradeOpen:null, trade:newTrade(…)`, z 24 |
| N1i | Profile hidden **under** trade detail (edge) | Tapping a player asset inside trade detail calls `openProf(n)` but leaves `tradeOpen` set. The profile (z22) renders beneath the trade detail (z23), so nothing visibly changes until ✕ closes the detail and reveals the profile over Notifications. |
| — | Empty, loading, error, overflow | **Not designed** for either screen. See §7. |

---

### 2. Layout, top to bottom

#### 2A. Home (`isHome`)

**The whole screen is one scroller. The header is not sticky.**
- Scroller: `class="fsm-scroll"`, `flex:1; min-height:0; overflow-y:auto; scrollbar-width:none` (WebKit scrollbar `display:none`), padding `0 16px 24px`.
- Viewport 390×794, starting at frame y=50. Content width 358px.
- The last item is followed by the 84px dock spacer plus 24px padding (108px clearance). The tab bar (80px) overlays the bottom of the scroller.
- **Rendered content offsets** (y inside the scroller, Chromium; alt-renderer values in parentheses):

  | Block | y | Height |
  |---|---|---|
  | header | 0 | 48 |
  | "My stuff" | 62 | 20 (20.5) |
  | tiles | 90 (90.5) | 98 (97) |
  | "Matchups" | 212 (211.5) | 20 |
  | cards | 242 | 440 = 141 + 64 + 64 + 141 + 3×10 |
  | Join | 692 (690) | 44 |
  | "Trending players" | 760 (758) | 20 |
  | segment | 790 (788.5) | 34 |
  | trending list | 828 (826.5) | 275 = 5×55 |
  | "Injury news" | 1127 (1125.5) | 20 |
  | injury list | 1151 (1150) | 335 = 71 + 71 + 61 + 71 + 61 |
  | "Practice" | 1508 (1502.5) | 20 |
  | card | 1538 (1533) | 68 |

  `scrollHeight` is **1714** (1709).

**1. Header row:** height 48px, `display:flex; align-items:center; justify-content:space-between`.
- **Logo group** (tappable, `goHomeLogo`): flex, `align-items:center`, `gap:8px`, cursor pointer.
  - Logo tile: 28×28, `border-radius:8px`, bg **`#07D066`** (Brand green), flex-centred, `flex:none`.
    - Contains `<img src="assets/fieldscout-logomark.svg" alt="">` at **15×15**, display block.
    - The SVG has a 45×45 viewBox and a black fill (`fill="black"`).
    - The empty `alt` here differs from the League header copy, which uses `alt="FieldScout"` (l.235).
  - Wordmark: **"FieldScout"**, 19px / 700, `letter-spacing:-0.03em`, `t1`, line box 23px.
- **Right icon group:** flex, `align-items:center`, `gap:2px`, `flex:none`, 118px wide in total. It holds three buttons.
  - Each button: **38×38**, `border-radius:50%`, flex-centred, cursor pointer, `:active` background `var(--x-b2,#F2F2F4)` (this pressed state does render).
  - Each icon: SVG 20×20, `viewBox 0 0 16 16`, `fill:none`, `stroke:currentColor`, colour `var(--x-t1,#1D1D1F)`, `stroke-width:1.5`, `stroke-linecap:round`.
  1. **Search** (`title="Search"`, `openGS`): `<circle cx="7" cy="7" r="4.8">` + `<path d="M10.6 10.6L14 14">` (no linejoin).
  2. **Notifications** (`goNotifs`, no `title` / accessible label): `position:relative`. Path `M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14h3`, `stroke-linejoin:round`.
     - Badge (if `hasNotifBadge`):
       - Geometry: `position:absolute; top:4px; right:4px`, `min-width:16px; height:16px; padding:0 4px; border-radius:999px`.
       - Fill and text: bg **`#FF0028`** (Danger), text `#fff` 10px/600, flex-centred.
       - Ring: `box-shadow:0 0 0 2px var(--x-b0,#fff)`, a 2px page-colour cut-out.
       - Text is `notifBadge`, which is "3". It renders 16×16.
  3. **Messages** (`goDms`, no `title`): `position:relative`. Path `M8 13.5c3.3 0 6-2.4 6-5.5S11.3 2.5 8 2.5 2 4.9 2 8c0 1.2.4 2.3 1.1 3.2L2.5 13.8l2.9-.9c.8.4 1.7.6 2.6.6z`, `stroke-linejoin:round`.
     - Badge (if `hasDmBadge`): identical geometry, bg **`#0088FF`** (Accent). Text is `dmBadge`, initially "3".

**2. "My stuff" title:** `margin-top:14px`, 17px / 600, `letter-spacing:-0.01em`, `t1`. Copy: **"My stuff"**.

**3. My stuff tiles:** `display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:8px`.
- Each tile is 114px wide with 90px of content width.
- Rendered height is **98px (alt 97px), not 92**. Content exceeds `min-height:92`: 12 + 32 + 10 + 17 + 1 + 14 + 12.
- Tile: `min-height:92px; padding:12px; border-radius:16px; background:var(--x-b1,#F5F5F7)`, `display:flex; flex-direction:column; justify-content:space-between; gap:10px`, cursor pointer.
  - Declared `:active` background `var(--x-b2,#EDEDF0)`, which is **not rendered** (see §0).
  - Icon square: 32×32, `border-radius:10px`, bg `var(--x-ink,#1D1D1F)`, flex-centred. SVG 16×16, viewBox 16, stroke `#fff`, `stroke-width:1.6`, round cap and join, `<path d="{{t.icon}}">`.
  - Text stack: flex column, `gap:1px`.
    - Label: 14px / 600, `t1`.
    - Sub: 11px / 500, `var(--x-t3,#6E6E73)`, `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`.
- **Truncation at 390px:** only the Rankings sub truncates. "3 rankings · 2 submitted" needs 120px in 90px, so it shows an ellipsis. "3 lists" and "1 open · 3 closed" fit.
- Subs are **static literals** (l.1715). They never recompute.

| Tile | Icon path | Label | Sub |
|---|---|---|---|
| 1 | `ICON.rank` = `M4 13V8M8 13V3M12 13V6` | Rankings | 3 rankings · 2 submitted |
| 2 | `ICON.lists` = `M3 4h10M3 8h10M3 12h6` | Lists | 3 lists |
| 3 | `M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5` (up and down arrows) | Start/Sit | 1 open · 3 closed |

**4. Matchups header:** `display:flex; align-items:baseline; justify-content:space-between; margin-top:24px`.
- Left: **"Matchups"**, 17px / 600, -0.01em.
- Right: **"Week 5"** (literal string), 12px / 500, `t3`.

**5. League cards list:** flex column, `gap:10px; margin-top:10px`.
- Order is fixed: Sunday Funday League, Joy to Us, Work League, Family Bragging Rights.
- Rendered heights: **live 141px (alt 140), pre-draft 64px**.
- Card: `padding:14px; border-radius:18px; background:var(--x-b1,#F5F5F7)`, cursor pointer, flex column `gap:12px`. Content width 330px.
  - Declared `:active var(--x-b2,#EDEDF0)`, **not rendered**.
- **Header row:** flex, `align-items:center; gap:10px`. Height 36px.
  - Avatar: 36×36, `flex:none; border-radius:10px` (rounded square, not a circle), flex-centred, 13px/600, text **always `#fff`**, bg `l.av`. Text is `l.ini` (2 letters).
  - Name stack: `flex:1; min-width:0`, column, `gap:2px`.
    - Name: 15px/600, `t1`, no ellipsis declared.
    - Sub: 12px/500, `t3`.
    - Rendered width: SF 266px, FB 284px, pre-draft 206px.
  - Pre-draft pill (if `l.pre`): height 24 (rendered ≈68px wide), `padding:0 10px; border-radius:999px`, `white-space:nowrap; flex:none`, bg `var(--x-go,#FFF3E6)` (Orange tint bg), text `var(--x-to,#B25C00)` (Orange tint text), 11px/600. Copy: **"Pre-draft"**.
  - Alert dot (if `l.hasDot`): 8×8 circle, `#FF0028`.
- **Live block** (if `l.live`): flex column, `gap:6px`. Height 15 + 6 + 24 + 6 + 14 = 65px.
  - Row a: flex `align-items:baseline; justify-content:space-between; gap:8px`, 12px/500, `t3`, nowrap. Left `l.me`, right `l.opp`.
  - Row b: flex `align-items:center; gap:10px`.
    - `l.myPts`: 20px/600, `letter-spacing:-0.02em`, `t1`.
    - Bar: `flex:1` (rendered 200px on both live cards), `height:6px; border-radius:999px; background:var(--x-b3,#E5E5EA); overflow:hidden`.
    - Bar fill: `height:100%; width:{{l.winW}}; border-radius:999px; background:{{l.winC}}`. It grows from the left; its width is **my** win probability.
    - `l.oppPts`: 20px/600, -0.02em.
  - Row c: flex `justify-content:space-between; gap:8px`, 11px/500, `t3`, nowrap.
    - Left: `Proj {{myProj}} · `, then a span at weight 600 in `l.winC` reading `{{win}} win`.
    - Right: `Proj {{oppProj}}`.

**6. "Join or create a league" button:**
- Box: `margin-top:10px; height:44px`, flex-centred `gap:6px`, `border-radius:14px`.
- Fill: **none**. Outline `box-shadow:inset 0 0 0 1.5px var(--x-b3,#E5E5EA)`.
- Text: 14px/600, `t1`. Cursor pointer, no `:active` style.
- Plus icon: SVG 12×12, viewBox 16, `stroke:currentColor`, `stroke-width:2.2`, round cap, path `M8 3v10M3 8h10`.
- Copy: **"Join or create a league"**.

**7. Trending header:** flex, `align-items:center` (centre, not baseline), `justify-content:space-between; margin-top:24px`.
- **"Trending players"**: 17px/600, -0.01em.
- **"See all"**: 13px/600, `#0088FF`, cursor pointer (`homeTrendAll`). Tap target 40×16px.

**8. Adds/Drops segmented control:** `display:grid; grid-template-columns:1fr 1fr; gap:2px; margin-top:10px; padding:2px; border-radius:10px; background:var(--x-b2,#F2F2F4)`. Total height 34px.
- Segment: height 30px, `border-radius:8px`, flex-centred, 13px/600, cursor pointer.
  - On: colour `var(--x-t1,#1D1D1F)`, bg `var(--x-b0,#fff)`, `box-shadow:0 1px 2px rgba(0,0,0,.12)` (README "Segmented on").
  - Off: colour `var(--x-t3,#6E6E73)`, bg `transparent`, shadow `none`.
- Labels: **"Adds"**, **"Drops"**.

**9. Trending list:** flex column, `margin-top:4px`. Exactly **5** rows, each **55px** (9 + 36 + 9 + 1 border).
- Row: flex `align-items:center; gap:12px; padding:9px 0; border-bottom:1px solid var(--x-b2,#F2F2F4)`, cursor pointer. The last row also has the border. No `:active` style.
  - `FSHeadshot` size **36**.
  - Text: `flex:1; min-width:0` (rendered 240px wide), column, `gap:1px`.
    - Name: 14px/600, nowrap with ellipsis. Full name; none truncate at 390.
    - Meta: 11px/500, `t3`, `{{meta}} · {{rost}}`, for example "RB · CHI · 14.8% rostered".
  - Change: 14px/600, colour `r.chgC`, e.g. "+502.1K" (`#07A852`) or "−150.9K" (`#FF0028`).
    - The drops minus is **U+2212 "−"**, not a hyphen.

**10. Injury news header:** flex `align-items:baseline; justify-content:space-between; margin-top:24px`.
- **"Injury news"**: 17px/600, -0.01em.
- **"See all"**: 13px/600, `#0088FF` (`soon`).

**11. Injury list:** flex column, `margin-top:4px`. Exactly 5 rows.
- Rendered heights: **61px** without the roster line; **71px (alt 69.5)** with it (10 + 17 + 2 + 15 + 2 + 14 + 10 + 1 border).
- Row: flex `align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--x-b2,#F2F2F4)`, cursor pointer.
  - `FSHeadshot` size **40**.
  - Text: `flex:1; min-width:0`, column, `gap:2px`.
    - Width depends on the status pill: **211px** for "Questionable" rows (pill ≈83px), **260px** for "Out", **268px** for "IR".
    - Line 1: name 14px/600, nowrap with ellipsis, then a space and an inline span `r.meta` (11px/500, `t3`, e.g. "RB · ARI").
    - Line 2: `r.note`, 12px/500, `var(--x-t2,#3A3A3C)`, nowrap with ellipsis.
      - **Two notes truncate at 390px:** "Missed Wednesday practice, back injury" (Justice Hill, 217 > 211) and "Full practice Thursday, expected to play" (Chuba Hubbard, 215 > 211).
    - Line 3 (if `hasMine`): `r.mine`, 11px/600, **`#0088FF`**, nowrap with ellipsis, e.g. "On your roster · Touchdown Tacos". None truncate.
  - Right column: `flex:none`, column, `align-items:flex-end; gap:4px` (38px tall).
    - Status pill: height 22, `padding:0 8px; border-radius:999px`, nowrap, flex centre, 11px/600, text `#fff`, bg `r.sBg`.
    - Time: 10px/500, `t3`.

**12. Practice:**
- Title **"Practice"**: `margin-top:22px` (22, not 24), 17px/600, -0.01em.
- Card (`soon`): `margin-top:10px`, flex `align-items:center; gap:12px; padding:14px; border-radius:18px; background:var(--x-b1,#F5F5F7)`, cursor pointer. Rendered **68px** tall. No `:active` style.
  - Icon tile: 40×40, `border-radius:12px`, bg `var(--x-ink,#1D1D1F)`. SVG 18×18, viewBox 16, stroke `#fff`, width 1.6, round cap and join: `<rect x="2.5" y="2.5" width="11" height="11" rx="2">` + `<path d="M2.5 6.5h11M6.5 2.5v11">` (a draft-grid glyph).
  - Text: `flex:1` (rendered 208px), column, `gap:2px`.
    - **"Mock draft"**: 15px/600.
    - **"Practice against AI drafters"**: 12px/500, `t3`.
  - Pill **"Start"**: height 30, `padding:0 14px; border-radius:999px`, bg `var(--x-ink,#1D1D1F)`, text `#fff` 13px/600. Visual only; the whole card is the tap target.

**FSHeadshot spec (sizes 36 and 40):**
- Wrapper:
  - `position:relative; width/height = size; flex:none; border-radius:50%; overflow:hidden; background:#EEEEF1`.
  - `display:flex; align-items:center; justify-content:center; font-family:'InterDisplay',sans-serif`.
  - `title="{{player}}"`, so the player's full name shows as a native tooltip.
- Ring: `box-shadow: 0 0 0 1px #fff, 0 0 0 3px <teamColor>`.
  - Ring width is 2px because size ≥ 32 (1.5px below 32).
  - The 1px gap is literal `#fff` in both themes.
  - If the team is unknown: `inset 0 0 0 1px rgba(0,0,0,.04)`.
- Image: `<img alt="{{player}}">`, `position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:50% 15%; transform:scale(1.25) translateY(8%)`.
- Initials fallback, shown on a load error or a missing `src` (`state.failed === src`):
  - Name prep: strip a trailing " D/ST", then split on the regex `[\s'-]+`.
  - Letters: first letter of the first part + first letter of the last part, uppercase.
  - Font size `max(9, round(size*0.36))`, which is **13px** at 36 and **14px** at 40. Weight 700, colour `#6E6E73`.
- Team ring colours used here: CHI `#0B162A`, DAL `#003594`, TB `#D50A0A`, ARI `#97233F`, LAC `#0080C6`, BAL `#241773`, PHI `#004C54`, LAR `#003594`, SF `#AA0000`, CAR `#0085CA`. The full map also has `WAS` and `WSH` (both `#5A1414`).
- Players with a photo file (`assets/headshots/<key>.jpg`): Roschon Johnson, Jaydon Blue, Sean Tucker, Charlie Kolar, Justice Hill, Jahan Dotson, James Conner.
- Players shown with initials: Kendrick Bourne "KB", Puka Nacua "PN", George Kittle "GK", Chuba Hubbard "CH".

#### 2B. Notifications (`isNotifs`)

The top bar and the title are fixed (`flex:none`). Only the list scrolls, and with 6 rows **it does not actually scroll**: content is 6×64 + 84 = 468px in a 700px viewport.

**1. Top bar:** `flex:none; height:52px`, flex `align-items:center; gap:8px; padding:0 12px`. Frame y 50–102.
- **Back** (`backFromDms`): height 36 (rendered 66×36), flex `align-items:center; gap:2px; padding:0 8px 0 4px; border-radius:999px`, colour `#0088FF`, 15px/**500**, `:active` background `var(--x-b2,#F2F2F4)` (this pressed state renders).
  - Chevron: SVG 18×18, viewBox 16, `stroke:currentColor`, width 2, round cap and join, path `M10 3L5 8l5 5`.
  - Copy: **"Back"**.
- Spacer: `flex:1`.
- **"Mark all read"** (`markRead`):
  - Style: 14px/600, `#0088FF`, `padding:0 6px`, cursor pointer.
  - Tap target: rendered 96×17px, a single line box.
  - No pressed or disabled styling. It stays visible after everything is read.

**2. Title:** `flex:none`, **"Notifications"**, 28px / 600, `letter-spacing:-0.03em`, padding `0 16px 8px`. Block height **42px** (34 + 8).

**3. List scroller:** `class="fsm-scroll"`, `flex:1; min-height:0; overflow-y:auto; scrollbar-width:none`, no padding. It starts at frame **y=144** (50 + 52 + 42), is 700px tall, and ends with the 84px dock spacer. 6 rows, **no dividers**.
- Row: flex `gap:12px; padding:12px 16px` (default `align-items:stretch`, so the fixed-size children sit at the top), cursor pointer. Rendered **64px** each.
  - No title wraps at 390px; each title line box is 18.9px.
- Background: unread `var(--x-gb2,#F5FAFF)`, read `var(--x-b0,#fff)`. Declared `:active var(--x-b1,#F5F5F7)` is **not rendered** (inline bg wins).
- Icon circle: 40×40, `flex:none; border-radius:50%`, bg `n.iconBg`. SVG 18×18, viewBox 16, `fill:none`, `stroke = n.iconC`, `stroke-width:1.7`, round cap and join, `<path d="{{n.icon}}">`.
- Text: `flex:1; min-width:0`, column, `gap:2px`.
  - Width: **285px when unread, 306px when read**.
  - Title: 14px, weight **600 if unread / 500 if read**, `line-height:1.35`, `text-wrap:pretty`. Wraps, not truncated.
  - Sub line: 12px/500, `t3`, `{{sub}} · {{time}}`. Wraps if long.
- Unread dot (if `n.unread`): 9×9, `flex:none; margin-top:6px; border-radius:50%`, bg `#0088FF`. Its top is 18px below the row top.

#### 2C. Bottom dock on these two screens

**No league switcher** on either screen. `showSwitcher = s.scr === "league" && !prof && !trade && !settings` is false.

**Tab bar**
- Container: `flex:none; position:relative; z-index:4; margin-top:-80px`.
  - `barMt = "-80px"`, so the bar overlays the bottom 80px of the scroller.
  - `height:80px; padding:6px 8px 0; display:flex`; bg `var(--x-barA, rgba(29,29,31,.94))`.
  - No blur or backdrop-filter.
  - Over white content the bar renders as **#2A2A2C** (measured).
- Item: `flex:1; height:48px`, flex column centred, `gap:3px`, colour **`#fff` when on, `#A1A1A6` when off**.
  - Icon: SVG 22×22, viewBox 16, stroke 1.5, round cap and join.
  - Label: 10px/600.
- Avatar item: 22×22 circle, bg `s.myAv` (`#0088FF`), text "D" 10px/600 `#fff`.
  - On: `box-shadow:0 0 0 2px var(--x-ink,#1D1D1F), 0 0 0 3.5px var(--x-b0,#fff)`.
  - Off: `none`.

**Home** shows the outside-league bar (`inLg` is false for `home`). Each item is 93.5px wide.

| Tab | Icon | State on Home | Action |
|---|---|---|---|
| Home | `ICON.home` = `M2.5 7.5L8 3l5.5 4.5V13h-11z` | **on** | `set({scr:"home", sheet:null})` |
| Community | star `M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z` | off | `set({scr:"community", sheet:null})` |
| Players | `ICON.players` = `M5.5 6.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5` | off | `soon` toast |
| Profile | avatar "D" | off, no ring | `set({scr:"me", sheet:null})`. Does **not** set `meTab`. |

**Notifications shows the in-league bar.**
- `inLg = !["home","community","me"].includes(s.scr)` is **true** for `"notifs"`.
- Five items, each 74.8px wide:

  | Tab | Icon |
  |---|---|
  | Match | `M2.5 4.5h4v7h-4zM9.5 4.5h4v7h-4zM8 3v10` |
  | Team | `ICON.players` |
  | Players | `ICON.search` = `M7 2.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6zM10.6 10.6L14 14` |
  | League | `ICON.leaders` = `M3 13V9h3v4M6.5 13V5h3v8M10 13V7.5h3V13` |
  | Menu | `M2.5 4h11M2.5 8h11M2.5 12h11` |

- **No tab is highlighted**, because the "on" test is `s.scr === "league" && s.tab === v && s.sheet !== "menu"`.
- Menu's colour becomes `#fff` while `sheet === "menu"`, but the open sheet (z20) covers the bar, so that change is never visible.

**Home indicator**
- Geometry: `position:absolute; left:50%; bottom:8px; transform:translateX(-50%)`, 134×5, radius 999, bg `var(--x-b0,#fff)`.
- Stacking: it has `z-index:auto`, so it paints **beneath** the tab bar (`position:relative; z-index:4`). `elementFromPoint` on it returns the tab bar.
- Rendered result: pixel sampling shows the indicator area and the bar around it are the same colour (**#2A2A2C**) on both screens. **It is invisible in light mode, not a white pill.** In dark mode (`#121212` under `rgba(18,18,18,.92)`) it is also invisible.
- To get the intended iOS look, the build needs it above z 4. See §7.

#### 2D. Toast (shared)

- Style: `position:absolute; left:50%; bottom:100px; transform:translateX(-50%); z-index:30; height:36px; padding:0 16px; border-radius:999px; background:var(--x-ink,#1D1D1F); color:#fff`, 13px/500, nowrap.
- On these screens its bottom edge sits at frame y 744, 20px above the tab bar's top.
- Auto-clears after **1800ms**. `toast()` calls `clearTimeout` on the previous timer, sets the text, then `setTimeout(…,1800)`.
- No enter or exit animation.
- Same z (30) as the column-tooltip backdrop. The toast comes later in the DOM, so it paints on top.

---

### 3. Interactions

#### Home
| Element | Effect |
|---|---|
| Logo group | `goHomeLogo` → `set({scr:"home", sheet:null})`. On Home this is a no-op and does not scroll to top. The same handler sits on the Community header logo (l.149). |
| Search (38px) | `openGS` → `set({gs:{q:"", scope:"all"}})`. Opens the global search overlay (z 29, frame top 50 → bottom 0, covers the dock) in its empty state (recent searches, trending topics). Its close sets `gs:null` and returns to Home with scroll kept. |
| Bell | `goNotifs` → `set({scr:"notifs", sheet:null, prevScr: ["dms","thread","notifs"].includes(s.scr) ? s.prevScr : s.scr})`. From Home, `prevScr = "home"`. |
| Messages | `goDms` → `set({scr:"dms", sheet:null, prevScr:…})`, same prevScr rule. From Home, `prevScr = "home"`. |
| My stuff: Rankings | `set({scr:"me", sheet:null, meTab:"rankings"})`. Profile opens with the Rankings segment selected. |
| My stuff: Lists | `set({scr:"me", sheet:null, meTab:"lists"})` |
| My stuff: Start/Sit | `set({scr:"me", sheet:null, meTab:"ss"})` |
| League card: Sunday Funday League | `set({scr:"league", tab:"match"})` → League › Match. It does **not** set `lg`, so the league shown is the current `s.lg` (default 0, Sunday Funday). It does not reset `mi`. |
| League cards: Joy to Us, Work League, Family Bragging Rights | `soon` → toast "Not part of this prototype" |
| Join or create a league | `soon` → toast |
| Trending "See all" | `homeTrendAll` (see below) |
| Adds / Drops segment | `set({homeTrend:"adds"\|"drops"})`. Instant swap of the 5 rows and their colours. Persists for the session. |
| Trending row | `openProf(name)` → `set({prof:name, pfTab:"summary", pfYear:"2026", pfAvail:false})`. Opens the player profile overlay (z 22); close (`prof:null`) returns to Home with scroll kept. |
| Injury row | `openProf(name)` (same) |
| Injury "See all" | `soon` → toast |
| Practice card (including the Start pill) | `soon` → toast |
| Profile tab | `set({scr:"me", sheet:null})`. Initial `meTab` is `"lists"` (l.1414), so the first tap opens Profile on the **Lists** segment. After a My-stuff tile tap, the Profile tab reopens on that tile's segment, because `meTab` persists. |
| Other tabs | See §2C |

**Trending "See all" (`homeTrendAll`):**
- Call: `set({scr:"league", tab:"players", pf2:{...pf2, status:"avail"}, trendOpen:true, trendTab:"trend"})`.
- Result: League › Players for the current `lg`, with status set to Available, the Trending tile row expanded, and the "Trending" segment selected.
- Kept (not reset):
  - `pf2.per`, `pf2.pos` and `pf2.team`
  - `pmenu` (an open filter popover stays open), `pview` and `psort`
- Edge case: the Trending card only appears when `showTrendCard = ["all","avail","fa","w"].includes(status) && team === "All"` (l.1456). **If a team filter was set earlier, the Trending card does not appear**, even though `trendOpen:true`.

#### Notifications
| Element | Effect |
|---|---|
| Back | `backFromDms` → `set({scr: s.prevScr \|\| "league"})`. From Home it returns to Home. The target screen re-mounts, so its scroll resets to top. |
| Mark all read | `set({notifRead:true})`. All rows become read (weight 500, `b0` bg, no dot). The bell badge disappears on Home and on the League header. No toast, no undo. |
| Row 0 "Trade offer from Marcus" | `set({tradeOpen:"marcus"})` → trade detail overlay (z 23). Details below. |
| Row 1 "@shahranks updated Week 5 · RB · PPR" | Full page load: `window.location.href = "FieldScout Mobile Lists and Rankings.dc.html#view-r1"`. Details below. |
| Rows 2–5 | `toast(title)`. The row title becomes the toast text, e.g. "Jameson Williams scored a TD". |
| Any row tap | Does **not** mark that row read. Only "Mark all read" changes read state. |
| In-league tab Match / Team / Players / League | `set({scr:"league", tab:v, sheet:null, swap:null})`. **Match** also adds `mi:0` when the last league tab was already `"match"`, which resets the matchup carousel to index 0. |
| In-league tab Menu | `set({sheet: s.sheet === "menu" ? null : "menu"})` opens the Menu sheet over Notifications. Details below. |

**Row 0, trade detail paths** (l.1828–1838):
- What it shows (other area):
  - Darnell Mooney + 2026 3rd round pick for James Conner, status Pending, "Sent to you 8m · expires in 2 days".
  - Its league line is `LEAGUES[s.lg].sub`, the **currently selected** league, not necessarily Sunday Funday.
  - Because the offer is incoming and Pending (`isIncoming`), it shows **Decline / Counter / Accept**. "Withdraw offer" exists only for outgoing offers and never appears here.
- ✕ → `tradeOpen:null`, back to Notifications.
- Accept → sets `tradeStatus.marcus`, closes the detail and toasts "Trade accepted with @marcus".
- Decline → same, toast "Trade declined".
- After Accept or Decline:
  - The notification row does **not** change: same title, same read state.
  - Re-opening row 0 shows the Accepted or Declined status.
- Counter → `tradeOpen:null, trade:newTrade(1, …)` → trade builder (z 24) over Notifications.
- Tap the opponent side → `tradeOpen:null` + `openTeam(1)` → team view (z 21) over Notifications.
- Tap a player asset → `openProf(n)` without closing the detail. The profile (z22) is hidden under the detail (z23) until ✕.
- "Message @marcus" → `tradeOpen:null` + `openConvo("marcus")` → `scr:"thread"`, `prevScr` unchanged. From there:
  - thread Back (`goDms`, l.584) goes to DMs and keeps `prevScr`;
  - DMs Back returns to the original `prevScr` (e.g. Home).
  - **The user never returns to Notifications on this path.**

**Row 1, ranking deep link:**
- On load, the Rankings file reads `COMM.r1` (by @shahranks, type `w5`, scoring `ppr`, pos `RB`). It sets `rk = {src:"c:r1", type:"w5", scoring:"ppr", pos:"RB"}`, which drives the author source tab and the author card (l.369, l.431–436).
- It also sets `fromComm:true`, but **`fromComm` is never read**. It is dead state.
- **Return path:**
  - The visible back chevron (`goProfile`, l.416, markup l.49) does `window.location.href = APP` with no hash. `cv.back` (l.436) does the same, but nothing binds it.
  - That file's tab bar (l.417) sends Home, Community and League to the same `APP`.
  - The main app ignores the hash and **reloads to its initial state**: League › Match, `notifRead:false`, DM unread back to 3, `homeTrend:"adds"`, `tradeStatus:{}`. It does **not** return to Notifications or Home. Only the theme survives (localStorage).

**Menu sheet over Notifications** (l.703–716):
- Contents:
  - "My team" row → `page:"myteam"`, full page z 25.
  - The current `lg.name` as a heading.
  - League items: League settings, Scoring, Playoffs, Draft results, League history, Previous seasons each `set({sheet:null, page:k})`. Notifications, Co-owners, Commissioner note and Stat corrections toast "<label>: screen coming next".
  - "FieldScout" apps: Home, Community and Profile navigate; Stats and Settings call `soon`.
- **There is no league list in this sheet.** `menuLeagues` (l.1855) is never bound in markup.
- A backdrop tap closes the sheet.

The prototype has no swipe, long-press or drag gestures on either screen.

---

### 4. Navigation

**Arriving at Home:**
- the outside-league tab bar's Home tab
- the in-league Menu sheet → "Home" (`menuApps`: `set({scr:"home", sheet:null})`)
- the League header home icon (`goHome`, l.236, `title="Home"`)
- the My start/sit back chevron (`goHome`, l.124)
- Back from Notifications or Messages when `prevScr === "home"`
- the logo on Community (`goHomeLogo`, l.149)
- jump panel #1 "Home · leagues": `go("home")` clears `sheet`, `prof`, `trade`, `settings`, `tradeOpen` and `teamView`, but **not** `gs`, `page`, `cmOpen`, `cmp` or `pick` (state H1m)

**Arriving at Notifications:**
- the bell on the Home header (l.52)
- the bell on the League header (l.240, same badge binding)
- jump panel #18 "Notifications": `go("notifs")` does not set `prevScr`, so Back goes to whatever `prevScr` was last set (initially `"league"`)
- Not an entry point: the Menu sheet's "Notifications" league item only toasts "Notifications: screen coming next".

**Back and close:**
- Home has no back.
- Notifications Back returns to `prevScr`. That is the screen you came from, except that dms, thread and notifs pass the original origin through.
- Overlays opened from Notifications or Home and closed with ✕ return to them with state intact: profile, trade detail, team view, trade builder, global search, Menu sheet.
- **Exceptions:**
  - trade detail → "Message @marcus" leaves through thread → DMs → `prevScr`, never back to Notifications;
  - the row 1 deep link reloads the app into League › Match with all state reset.

**Dock per screen:**
- **Home:** outside-league bar with Home highlighted, no switcher.
- **Notifications:** in-league bar (Match / Team / Players / League / Menu) with nothing highlighted, no switcher.
  - Match / Team / Players / League → `scr:"league"` on that tab (switcher appears there).
  - Menu → Menu sheet over Notifications.
- **Destinations:** Profile highlights the avatar (ring). League screens show the switcher plus the in-league bar with the active tab highlighted.

**Z-order (phone frame):**

| Layer | z-index |
|---|---|
| screen content (non-positioned) | auto |
| home indicator (positioned, paints under the bar) | auto |
| league switcher, tab bar | 4 |
| bottom sheets (backdrop `rgba(0,0,0,.32)`) | 20 |
| team view | 21 |
| player profile | 22 |
| trade detail, league settings overlay | 23 |
| trade builder | 24 |
| full page (settings pages, My team) | 25 |
| Community detail | 26 |
| composer | 27 |
| player picker | 28 |
| global search | 29 |
| column-tooltip backdrop and toast | 30 (toast is later in DOM, so it wins) |

All full-screen overlays span `left:0; right:0; top:50px; bottom:0`, below the status bar, so they cover the dock.

---

### 5. Data shown (all placeholder; described as real product data)

**Header badges**
- **Notifications:** unread notification count. The prototype hard-codes 3 while the list marks 4 rows unread (§7).
- **Messages:** number of conversations with unread messages, not a message count.
- **Display:** `String(count)`. The pill grows horizontally via `min-width:16` + `padding:0 4`. There is no "9+" cap.

**My stuff tile subs (the user's own content counts; static literals in the prototype)**

| Tile | Sub format | Prototype value |
|---|---|---|
| Rankings | `N rankings · M submitted` | "3 rankings · 2 submitted". Profile shows 3 rankings (Submitted, Saved, Finalized); Finalized counts as submitted. |
| Lists | `N lists` | "3 lists" |
| Start/Sit | `N open · M closed` | "1 open · 3 closed". It stays the same after the user posts a poll, even though Profile's Start/Sit list grows (it reads `s.cmMine`, l.1487). Real product should compute it. |

**Matchup cards (one per league the user belongs to; fixed order in the prototype)**

| Field | Format | SF (live) | Joy to Us (pre) | Work League (pre) | FB (live) |
|---|---|---|---|---|---|
| ini / av | 2 letters / colour | "SF" / `var(--x-ink,#1D1D1F)` | "JU" / `#9D70E9` (WR purple) | "WL" / `#5C7CE5` (RB blue) | "FB" / `#ECAD48` (TE gold), white text |
| sub | live: `{N}-team {scoring} · Week {wk}`; pre: `{N}-team {scoring} · {season}` | "12-team standard · Week 5" | "12-team PPR · 2026" | "12-team PPR · 2026" | "10-team standard · Week 5" |
| me / opp | `Team name (W-L)` | "Touchdown Tacos (2-6)" / "Gridiron Gurus (8-0)" | — | — | "Touchdown Tacos (3-1)" / "Team 5 (2-2)" |
| pts | 2 decimals | 39.70 / 16.40 | — | — | 35.84 / 65.70 |
| proj | `Proj 83.44` | 83.44 / 73.01 | — | — | 94.32 / 106.58 |
| win | integer % + " win"; colour `#07B85A` if ≥ 50, else `#FF0028` (same rule as `side()` on League › Match) | "66% win", green | — | — | "33% win", red |
| hasDot | red 8px dot | true | false | false | false |

- SF values equal `MUPS[0]`, so they match League › Match.
- Home scores are static. The 7s `livePlay` ticker does not update them.
- **Conflicts with `LEAGUES` (l.1194)**, see §7:
  - FB "Touchdown Tacos (3-1)" vs `LEAGUES[1].team` "Dalton's Dynasty" 3-1. The injury row agrees with LEAGUES ("On your roster · Dalton's Dynasty").
  - Work League "12-team PPR · 2026" vs "10-team half PPR".
  - Joy to Us and Work League are "Pre-draft" in Week 5, while LEAGUES gives "Draft Aug 28" and "Draft Sep 2".
  - Home order is SF, JU, WL, FB. The switcher swipe order and the "Switch league" sheet use the LEAGUES order: SF, FB, JU, WL.
  - FB exists as `lg` 1 but its card only toasts.

**Trending players**
- Source `TREND` (l.1148), top 5. Adds use `TREND` order; Drops are the same array **reversed**.
- Name: full name.
- Meta: `POS · TEAM · {rost}% rostered`. POS shows "D/ST" for DST. Rostered has 1 decimal.
- Change: Adds `+{n}K` in `#07A852`; Drops `−{n}K` (U+2212) in `#FF0028`. One decimal with a "K" suffix.
- **Sort artifacts:**
  - Drops show the **smallest** drop first (−150.9K) and the largest last (−301.3K).
  - Tucker, Bourne and Kolar appear in both lists with mirrored numbers.
  - Intended real rule (assumed, §7): magnitude descending for both lists.

| Adds | Meta | Chg | Drops | Meta | Chg |
|---|---|---|---|---|---|
| Roschon Johnson | RB · CHI · 14.8% rostered | +502.1K | Jahan Dotson | WR · PHI · 22.0% rostered | −150.9K |
| Jaydon Blue | RB · DAL · 54.9% rostered | +388.6K | Justice Hill | RB · BAL · 18.2% rostered | −198.2K |
| Sean Tucker | RB · TB · 10.5% rostered | +301.3K | Charlie Kolar | TE · LAC · 26.8% rostered | −236.5K |
| Kendrick Bourne | WR · ARI · 10.4% rostered | +244.7K | Kendrick Bourne | WR · ARI · 10.4% rostered | −244.7K |
| Charlie Kolar | TE · LAC · 26.8% rostered | +236.5K | Sean Tucker | RB · TB · 10.5% rostered | −301.3K |

Injury status (e.g. Justice Hill "Q") is **not** shown on these rows.

**Injury news**
- Meta: `POS · TEAM`.
- Status pill colour:

  | Status | Pill bg |
  |---|---|
  | Questionable | `#FF8A00` (Warning orange) |
  | Out | `#FF0028` (Danger) |
  | IR | `var(--x-t1,#1D1D1F)` (black) |

- `mine` line: `On your roster · {fantasy team name}`, across any of the user's leagues, in blue `#0088FF`.
- Time: relative ("2h", "1d").
- The prototype rows happen to be in recency order (2h, 4h, 6h, 1d, 1d). Real data: newest first (assumed, §7).

| Player | Meta | Status | Note | Mine line | Time |
|---|---|---|---|---|---|
| James Conner | RB · ARI | Questionable | Limited Thursday with an ankle injury | On your roster · Touchdown Tacos | 2h |
| Justice Hill | RB · BAL | Questionable | Missed Wednesday practice, back injury | On your roster · Touchdown Tacos | 4h |
| Puka Nacua | WR · LAR | Out | Ruled out for Week 5 with a knee injury | — | 6h |
| George Kittle | TE · SF | IR | Placed on injured reserve, hamstring | On your roster · Dalton's Dynasty | 1d |
| Chuba Hubbard | RB · CAR | Questionable | Full practice Thursday, expected to play | — | 1d |

Justice Hill's roster line contradicts `ownerOf` (l.1249), where he is a free agent (not in `slots`/`bench`; TREND owner "").

**Notifications (`NOTIFS`, l.1198, displayed in array order)**
- Row tuple: `[title, sub, time, icon (ICON key or raw path), stroke colour, circle bg]`.
- Time: relative short form ("8m", "12h", "1d").
- **Not chronological:** "40m" (row 1) sits above "22m" (row 2). Intended real sort: newest first (assumed, §7).

| k | Type | Title | Sub | Time | Icon path | Stroke | Circle bg | Unread initially | Tap |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Trade offer | Trade offer from Marcus | Darnell Mooney + 2026 3rd for James Conner | 8m | `ICON.trade` `M3 5.5h9.5L10 3M13 10.5H3.5L6 13` | `#0088FF` | `var(--x-gb,#E6F2FF)` | yes | trade detail |
| 1 | Followed user updated a ranking | @shahranks updated Week 5 · RB · PPR | Hubbard ▲4, Conner ▼3 · 4 changes | 40m | `M3 13.5V9M8 13.5V3M13 13.5V6.5` (bars) | `#9D70E9` | `var(--x-gp,#F3EDFD)` | yes | Rankings `#view-r1` |
| 2 | Player scored (your team) | Jameson Williams scored a TD | +7.6 pts · Touchdown Tacos | 22m | `M3 8.5l3.2 3L13 4.5` (check) | `#07A852` | `var(--x-gg,#E3F9EC)` | yes | toast |
| 3 | Waiver processed | Waiver claim processed | You added Kendrick Bourne for $1 | 12h | `M8 3.5v9M3.5 8h9` (plus) | `#07A852` | `var(--x-gg,#E3F9EC)` | yes | toast |
| 4 | Injury affecting lineup | T.J. Hockenson is out this week | He's in your TE slot. Set your lineup. | 1d | `M8 4.5v4M8 11h.01` (exclamation mark, no circle) | `#FF0028` | `var(--x-gr,#FFE9EC)` | no | toast |
| 5 | Lineup lock reminder | Lineup locks in 2 hours | Sun 1:00 PM games | 2d | `M8 4.5V8l2.5 1.5` (clock hands, no circle) | `#FF8A00` | `var(--x-go,#FFF3E6)` | no | toast |

- The ▲ and ▼ glyphs in the row 1 sub are plain `t3` text, not coloured.
- The "@shahranks" handle in the title has no special link styling.
- **Placeholder contradictions:**
  - Row 4: Hockenson appears nowhere else in the file, and the user's TE is Evan Engram (`MINE`, l.1145).
  - Row 3: `TRANS` (l.1152) records Bourne as a Free-agency add with no bid; the $1 waiver was Ray Davis. Priya's DM (l.1188, "Your waiver bid on Bourne was $1 lol") agrees with the notification.

**Placeholder vs real product data**
- Everything above is placeholder: counts, leagues, scores, projections, win probability, trending counts, injuries and notifications.
- Hard-coded copy that is not data: "Week 5" in the Matchups header, and the "Mock draft" / "Practice against AI drafters" / "Start" card.

---

### 6. Dark mode (`.fs-dark` on the phone frame; stored in `localStorage["fieldscout-theme"]`)

| Use in this area | Variable | Light (fallback) | Dark |
|---|---|---|---|
| Page bg, badge cut-out ring, segment "on" bg, read notification bg, home indicator, Profile-tab outer ring | `--x-b0` | #FFFFFF | #121212 |
| Primary text, header icons, status-bar "9:41" and glyphs, IR pill bg | `--x-t1` | #1D1D1F | #FFFFFF |
| Injury note | `--x-t2` | #3A3A3C | #D9D9D9 |
| Meta, subs, segment "off" text | `--x-t3` | #6E6E73 | #B3B3B3 |
| Tiles, league cards, practice card, notification row pressed (declared) | `--x-b1` | #F5F5F7 | #282828 |
| Header button pressed, Back pressed, segmented track, row dividers | `--x-b2` | #F2F2F4 | #333333 |
| Tile pressed, league card pressed (declared, not rendered) | `--x-b2` | #EDEDF0 | #333333 |
| Win-prob track, Join outline | `--x-b3` | #E5E5EA | #3E3E3E |
| Tile icon square, SF avatar, practice icon tile, Start pill, toast, Profile-tab inner ring | `--x-ink` | #1D1D1F | #4D4D4D |
| Pre-draft pill bg / lineup-lock icon bg | `--x-go` | #FFF3E6 | #3A2A14 |
| Pre-draft pill text | `--x-to` | #B25C00 | #FFB340 |
| Unread notification row bg | `--x-gb2` | #F5FAFF | #16212E |
| Trade notification icon bg | `--x-gb` | #E6F2FF | #12263F |
| Ranking notification icon bg | `--x-gp` | #F3EDFD | #261E36 |
| TD / waiver notification icon bg | `--x-gg` | #E3F9EC | #12301F |
| Injury notification icon bg | `--x-gr` | #FFE9EC | #3A1A1D |
| Tab bar bg | `--x-barA` | rgba(29,29,31,.94) (renders #2A2A2C over white) | rgba(18,18,18,.92) (renders #121212 over the page) |

**Literals that do not change in dark mode:**
- logo tile `#07D066`, and the black logomark fill on it
- notification badge and alert dot `#FF0028`
- DM badge, links, Back, Mark all read, unread dot and roster line `#0088FF`
- win fill `#07B85A` / `#FF0028`
- trend `#07A852` / `#FF0028` (README's dark `#1ED760` / `#FF6B6B` are not applied)
- Questionable `#FF8A00` and Out `#FF0028` pills
- notification icon strokes
- all `#fff` text
- league avatar colours `#9D70E9`, `#5C7CE5`, `#ECAD48`
- tab colours `#fff` / `#A1A1A6`, and the Profile avatar `#0088FF`
- headshot gap `#fff`, bg `#EEEEF1` and initials `#6E6E73`, so the initials discs show as light grey on the `#121212` page

**Dark-mode side effects:**
- The **IR pill becomes white text on a white (`#FFFFFF`) pill**, which is unreadable.
- The Profile-tab outer ring (`--x-b0` → #121212) merges with the bar. This only shows on Profile, not on these screens.
- The home indicator is invisible here too, as it is in light mode (§2C).

---

### 7. Open questions

1. **Badge count:** the bell badge is hard-coded to 3 (`nUnread = notifRead ? 0 : 3`), but the list marks 4 rows unread (`k < 4`). Should the badge be derived from the unread rows?
2. **Tap-to-read:** tapping a single notification never marks it read; only "Mark all read" does. Should a row become read when tapped?
3. **Dock on Notifications:** it shows the in-league tab bar with nothing highlighted, even when you arrive from Home, because `inLg` treats any `scr` outside home/community/me as league context. Intended, or should it show the outside-league bar?
4. **Notification sort:** the prototype is not in time order (8m, 40m, 22m, 12h, 1d, 2d). Newest first, or grouped by type or priority?
5. **Drops sort:** Drops is Adds reversed with the sign flipped, so the smallest drop comes first and three players appear in both lists. Use drop count descending, from separate data?
6. **Dark IR pill:** `var(--x-t1)` bg with #fff text is white on white in dark mode. What colour should it be?
7. **Home indicator:** it paints under the z4 tab bar and is invisible in both modes. Should the build place it above the bar (z > 4), and in what colour (white in light, and what in dark)?
8. **League card navigation:** only the Sunday Funday card navigates, and it does not set `lg` or reset `mi`. Should every card open its own league's Match tab (pre-draft leagues perhaps to a draft lobby)?
9. **Red dot:** what does the 8px dot on a league card mean (unread league chat, pending trade, action needed)? It has no defined trigger.
10. **Sample-data conflicts — do engineers need canonical values?**
    - Work League "10-team half PPR" (LEAGUES) vs "12-team PPR · 2026" (Home).
    - FB team "Dalton's Dynasty" vs "Touchdown Tacos (3-1)".
    - Justice Hill "On your roster" but a free agent in ownerOf.
    - The Hockenson notification says "in your TE slot", but the TE is Evan Engram.
    - Bourne: the notification and Priya's DM say a $1 waiver; TRANS says a free-agency add.
    - Home league order (SF, JU, WL, FB) vs switcher order (SF, FB, JU, WL).
11. **Pre-draft cards:** they show only "12-team PPR · 2026" plus the pill. Should they show the draft date or time ("Draft Aug 28")?
12. **FB avatar text:** white on #ECAD48 on Home, but `LEAGUES.avFg` (switcher) uses #1D1D1F for that colour. Which is correct?
13. **Toast duration:** the code uses 1800ms; the README says about 2.2s.
14. **Missing states:**
    - no leagues (only the Join button?)
    - no notifications (empty Notifications screen)
    - loading and error for trending and injuries
    - badge overflow (9+/99+)

    Should we extend the design language ourselves, per CLAUDE.md?
15. **Logo on Home:** should tapping it while already on Home scroll to top? Currently a no-op.
16. **Outside-league "Players" tab:** it only toasts. Global player research, or the current league's Players tab?
17. **Launch screen:** the prototype launches on League › Match (initial `scr:"league"`). Which screen should the real app open to?
18. **"Mark all read" when nothing is unread:** it stays visible and tappable. Should it hide or disable?
19. **Ranking deep link:**
    - What Next.js route should "@user updated <ranking>" map to (community ranking by author + type, position, scoring)?
    - Where should its back go? Notifications is presumably intended; the prototype reloads to League › Match.
20. **Rankings tile sub:** "3 rankings · 2 submitted" truncates at 390px (needs 120px of 90). Acceptable, or shorten the copy?
21. **Pressed states:** tiles, league cards and notification rows declare pressed backgrounds that the prototype never renders, because the inline bg wins. Build the declared `:active` colours (intent) or match the prototype (no pressed state)?
22. **Small hit targets:** "Mark all read" (17px tall) and "See all" (16px) are below the README's 30px minimum. Pad them to 30+?
23. **Leaving via "Message @marcus":** trade detail → "Message @marcus" ends at `prevScr` (e.g. Home) and never returns to Notifications. Intended?
24. **Player tap in trade detail:** tapping a player inside trade detail opens the profile behind the detail (z22 < z23). Treat it as a bug and close the detail first, or stack the profile above it?
25. **Menu sheet "Notifications" item:** it only toasts "Notifications: screen coming next". Is it league notification settings, separate from this Notifications screen?
26. **My-stuff counts:** the subs are static in the prototype. Confirm the real app computes them live from the user's rankings, lists and start/sit posts.
27. **Line-heights:** confirm we reproduce Inter Display `normal` line boxes (§0 table), not Tailwind's default leading, so the rendered heights here (tiles 98, live cards 141, rows 55/61/71/64) hold.


---

### Open questions
- Dropped critic finding (disproved): 'Inside the Menu sheet, picking a league sets lg and closes the sheet but stays on Notifications (l.1855)'. `menuLeagues` (l.1855) is never bound in markup. The Menu sheet body (l.703-716) renders only My team, the league settings items (`menuLeagueItems`) and the FieldScout apps (`menuApps`). It has no league list, so the claim was not incorporated.
- Adjusted critic finding: 'Accept, Decline and Withdraw' on the trade detail. Withdraw (`td.cancel`) renders only when `isOutgoing`. The Marcus offer is incoming and Pending, so only Decline, Counter and Accept appear. Withdraw is not reachable from Notifications row 0.
- Adjusted critic finding: the line-height advice 'use `leading-normal`' is wrong for Tailwind 3. `leading-normal` is 1.5, not CSS `normal`. The spec instead tells engineers to use explicit px line boxes, or `leading-[normal]`.
- Adjusted critic finding: measured sizes differ by renderer. Headless Chromium (Playwright) gave:
- tiles 98, live cards 141, injury rows with the roster line 71
- scrollHeight 1714, header blocks 20

The critic's renderer gave 97, 140, 69.5, 1709 and 20.5. Chromium rounds ascent and descent separately. Both sets are recorded and the line-box table explains the difference.
- Adjusted critic finding: the home indicator is not 'a faint ~#2B2B2D bar'. Pixel sampling shows the indicator area and the surrounding tab bar are the same colour (#2A2A2C) on both screens, so it is invisible in light mode as well as dark.
- Adjusted critic finding: 'switcher and menu order' for leagues. The Menu sheet lists no leagues. The order conflict is between the Home cards (SF, JU, WL, FB) and the switcher swipe order and 'Switch league' sheet (LEAGUES order: SF, FB, JU, WL).
- Adjusted critic finding: the community-author back. In the Rankings file, `cv.back` (l.436) is defined but never bound in markup. The visible back chevron is `goProfile` (l.416, markup l.49). It does the same `window.location.href = APP`, so the critic's conclusion holds (the app reloads to League › Match, initial state).
- Adjusted critic finding: on the Bourne $1 waiver conflict, Priya's DM (l.1188, 'Your waiver bid on Bourne was $1 lol') agrees with the notification. Only TRANS (l.1152) disagrees.
- Product question: should the notification bell badge be derived from the unread rows? It is hard-coded to 3, while 4 rows are unread.
- Product question: should tapping a notification mark it read? Currently only 'Mark all read' changes read state.
- Product question: should Notifications show the outside-league tab bar when you arrive from Home? It currently shows the in-league bar with nothing highlighted.
- Product question: what sort rules should real data use?
- Notifications: newest first? The prototype order is 8m, 40m, 22m, 12h, 1d, 2d.
- Drops: magnitude descending? The prototype shows the reversed Adds list.
- Injury news: newest first?
- Product question: what colour should the IR pill be in dark mode? It is currently white text on a white `var(--x-t1)` pill.
- Product question: should the home indicator sit above the tab bar (z > 4) so it is visible? In what colour for light and dark?
- Product question: should every league card navigate to its own league (setting `lg`, resetting `mi`)? Where should pre-draft leagues go? Currently only Sunday Funday navigates.
- Product question: what triggers the red dot on a league card?
- Product question: should pre-draft cards show the draft date ('Draft Aug 28' / 'Draft Sep 2')?
- Product question: which canonical sample values apply?
- Work League: 10-team half PPR or 12-team PPR
- FB team: Dalton's Dynasty or Touchdown Tacos
- Justice Hill: rostered or free agent
- Hockenson vs Engram at TE
- Bourne: waiver or free agency
- league order
- Product question: what text colour goes on the FB avatar (#ECAD48)? Home uses white; LEAGUES.avFg uses #1D1D1F.
- Product question: what toast duration should we use? The code has 1800ms; the README says about 2.2s.
- Product question: who designs the missing states, and should we extend the design language ourselves?
- no leagues
- empty notifications
- loading and error for trending and injuries
- badge overflow (9+)
- Product question: should the Home logo scroll to top when you are already on Home?
- Product question: where should the outside-league 'Players' tab go? It currently toasts 'Not part of this prototype'.
- Product question: which screen should the real app launch to? The prototype starts on League › Match.
- Product question: should 'Mark all read' hide or disable once everything is read?
- Product question: what Next.js route should the '@user updated <ranking>' deep link map to? Where should its back go (Notifications, presumably), given the prototype reloads to League › Match?
- Product question: is truncating '3 rankings · 2 submitted' in the Rankings tile acceptable, or should the copy be shortened?
- Product question: should the declared-but-unrendered pressed backgrounds be built? They are on My-stuff tiles, league cards and notification rows.
- Product question: should 'Mark all read' (17px tall) and 'See all' (16px) be padded to the README's 30px minimum hit target?
- Product question: should leaving trade detail via 'Message @marcus' return to Notifications? Currently it ends at the original prevScr.
- Product question: is tapping a player inside trade detail (the profile opens hidden underneath) a bug to fix?
- Product question: is the Menu sheet's 'Notifications' item (toast 'Notifications: screen coming next') league notification settings, separate from the Notifications screen?
- Product question: should the My-stuff tile subs be computed from real counts? They are static in the prototype.

---

## Gap analysis vs the current app

## Home and Notifications: mobile spec compared with the current app (worktree `redesign-v7` @ 27d455b)

**Files checked:**
- **Pages:** `src/app/app/(shell)/page.tsx`, `src/app/app/(shell)/notifications/page.tsx`, `src/app/app/(shell)/profile/page.tsx`, `src/app/app/(shell)/{weekly-ranks,start-or-sit}/layout.tsx`, `src/app/app/(shell)/leagues/[leagueId]/*`
- **Home components:** `src/components/home/*` (your-leagues, home-quick-actions, trending-players-card, injury-news-card, waiver-adds-card, scout-ai-card, home-player-row)
- **Layout:** `src/components/layout/{app-shell,top-nav,bottom-tabs,more-sheet,layout-mode-frame}.tsx`, `src/components/layout/rail/{messages-panel,notifications-panel,notifications-panel-ops,research-rail}.*`
- **Notifications:** `src/components/notifications/{notifications-feed,notification-href}.ts(x)`
- **Leagues:** `src/components/leagues/{leagues-index,league-cells,matchup-view,players-page,trade-center}.tsx`
- **Players:** `src/components/players/player-image.tsx`, `src/lib/nfl-team-colors.ts`
- **Hooks:** `src/hooks/{use-notifications,use-leagues,use-matchups,use-open-player,use-layout-mode}.ts`, `src/stores/theme-store.ts`
- **API:** `src/app/api/notifications/{route,read/route}.ts`, `src/lib/leagues/api/matchups-service.ts`
- **Flags and UI:** `src/lib/feature-flags.ts`, `src/components/ui/{toast,toaster}.tsx`
- **Config and schema:** `tailwind.config.ts`, `src/app/globals.css`, `src/types/database.ts`
- **Migrations:** 019/038 (list notifications), 034 (injury detail), 148/150/151 (trade and waiver notifications)

### Frame and global

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Light colour tokens (t1–t3, b0–b3, ink, gb/gg/gr/go/to/gb2/gp, bar) | restyle-only | `tailwind.config.ts` `m.*` + `globals.css` `--m-*` (27d455b) | All fallback hexes already exist as `m-*` tokens. The fixed colours (#0088FF, #07D066, #07A852, #FF0028, #FF8A00, #07B85A) already exist as `accent`, `brand`, `positive-strong`, `negative-strong`, `warn` and `confirm`. |
| Dark mode (`.fs-dark`, `localStorage["fieldscout-theme"]`) | out-of-scope-or-question | `stores/theme-store.ts`, `use-layout-mode.ts` (sets `data-theme`), dark `--m-*` in `globals.css` | CLAUDE.md still says single theme. The latest commit adds mobile-only dark tokens and a store, and its comments cite a ruling: "Chris, 2026-10-15 — dark mode is mobile-only". CLAUDE.md needs reconciling with that. No toggle UI was found. Dark-mode bugs: the IR pill renders white on white (Q6), and the green/red values do not switch. |
| Inter Display plus `line-height: normal` boxes | restyle-only | `src/app/layout.tsx` (next/font Inter, Display cut), `font-inter` | The spec's heights (tiles 98, cards 141, rows 55/61/71/64) need explicit `leading-[Npx]` values. Tailwind's `leading-normal` is 1.5, not CSS `normal` (Q27). |
| Status bar and home indicator | out-of-scope-or-question | none; no `safe-area-inset` anywhere in `src` | This is fake phone chrome. A web build uses the OS chrome plus safe-area padding. In the prototype the indicator is invisible anyway (Q7). |
| Dock spacer (84px) and tab bar overlaying the scroller | restyle-only | `app-shell.tsx` main `pb-20` over fixed `BottomTabs` | Only the padding values need to change. |
| Pressed `:active` backgrounds | out-of-scope-or-question | app components use `hover:` only | Q21: build the pressed states the spec declares, or match what the prototype renders (none)? |
| Toast | restyle-only | `ui/toast.tsx` (ink pill), `ui/toaster.tsx` (duration 4500) | The spec says 1800ms and bottom 100px above the dock. The README says ~2.2s (Q13). |
| Empty, loading and error states | restyle-only | `notifications-feed.tsx`, `your-leagues.tsx` and `trending-players-card.tsx` all have skeleton, error and empty states | Extend them in the new design language. The injury card has none because it is mock data. |

### Home

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Header row: logo tile + "FieldScout" text, scrolls with the page (not sticky) | restyle-only | `top-nav.tsx` (sticky global bar, `LogoTile` 24px, SVG `Wordmark`) | The spec wants a 28px tile with a 15px mark and a 19/700 text wordmark, inside the Home scroller. Logo tap scroll-to-top is Q15. |
| Search button → global search | restyle-only | `bottom-tabs.tsx` Search → `CommandPalette` (players, users, lists) | Only the entry point moves. The overlay's recent searches and trending topics belong to another area. |
| Bell + unread badge | restyle-only | `top-nav.tsx` `NotificationBell` → `/app/notifications` (mobile); `useNotifications` unreadCount, polled every 60s | Real count from the DB, which answers Q1. The app badge is blue accent with a 9+ cap; the spec is red #FF0028 with no cap (Q14). |
| Messages button + blue DM badge (conversations with unread messages) | needs-new-backend | `rail/messages-panel.tsx` (mock, `featureFlags.messages`, desktop rail only) | There is no DM schema or API. `league_chat` exists, but nothing tracks read state for it. |
| My stuff: Lists tile ("N lists") | new-ui-on-existing-data | `lists` table / `useLists`; `/app/lists` | The count can be computed (`deleted_at` null). The spec's target, a Profile screen with a Lists segment, does not exist: `/app/profile` is "My stats". |
| My stuff: Rankings ("N rankings · M submitted") and Start/Sit ("N open · M closed") tiles | out-of-scope-or-question | `weekly_rankings.submitted_at`, `start_sit_questions.voting_closes_at` / `resolved_at`; both route layouts redirect to `/app` when their flags are off | The data exists, but both surfaces are hidden at the 2026 launch. Show the tiles or not? The Rankings sub also truncates at 390px (Q20). |
| "Matchups · Week N" header | new-ui-on-existing-data | `nfl_weeks`, `use-schedule` | The week comes from the calendar, not a literal. |
| League card header (36px avatar, name, "N-team {scoring} · Week N") | new-ui-on-existing-data | `your-leagues.tsx` → `LeagueIndexCard` (`leagues-index.tsx`): name, season, team count, role, status badge, Open button | `MyLeagueRow` has no scoring label, week, my team name or record. That data is in `leagues`, `scoring_systems`, `teams` and standings. |
| Live block: my and opponent team (W-L) and live points | new-ui-on-existing-data | `useMatchups` (`home_score` / `away_score`), `use-standings`, `teams` | Needs one fetch per league. A summary endpoint over existing tables would avoid N×3 requests. |
| "Proj X" per side | new-ui-on-existing-data | `matchup-view.tsx` `projectedTotal(...)` from `league_player_values.projected_points` | Already computed on League › Match. |
| Win-probability bar + "66% win" | needs-new-backend | `WinProbMeter` in `league-cells.tsx` (unused); `matchup-view.render.test.ts` pins "no win probability" | No win-probability model exists. |
| Pre-draft pill | restyle-only | `league.status` (setup / scheduled) → `STATUS_BADGE` | Showing the draft date is possible from `drafts` `scheduled_at` (Q11). |
| Red alert dot on league card | out-of-scope-or-question | none | No trigger is defined (Q9). |
| League avatar colours (position-chip colours, white text) | out-of-scope-or-question | `Crest` = ink tile or `leagues.avatar_url` | There is no rule for which colour a league gets, and Home and the switcher disagree on the text colour (Q12). |
| League card tap → that league's Match tab | restyle-only | `/app/leagues/[id]/matchup` exists; the card currently links to the league home | Every card can navigate with real data (Q8). |
| "Join or create a league" button | restyle-only | `JoinLeagueDialog` + `LeagueCreateModal` (`home-quick-actions.tsx`), `/app/leagues` | One button needs one target: a chooser or `/app/leagues`. Leagues are flag-gated. |
| Trending players, Adds/Drops ("+502.1K", "% rostered") | needs-new-backend | `trending-players-card.tsx`: Risers/Fallers from projection vs last season (`TODO(data)`) | No source for add/drop counts or % rostered is synced, and `players` has no rostered column. The segmented control already exists (`Tabs`). Drops sort is Q5. |
| Trending "See all" → League › Players (Available + Trending) | needs-new-backend | `leagues/players-page.tsx` (free_agents scope, no trending section) | Depends on trend data and on a league context. |
| Trending / injury row tap → player profile | restyle-only | `useOpenPlayer` | The app opens the mini card first (Chris ruling 2026-10-05); the design opens the full profile directly. Keep the app rule. |
| FSHeadshot (team-colour ring, initials fallback, title tooltip) | restyle-only | `players/player-image.tsx` + `ui/avatar` fallback; `lib/nfl-team-colors.ts` | Add a ring variant. Do not fork the component. |
| Injury news list (status pill Q/Out/IR, note, "2h") | needs-new-backend | `injury-news-card.tsx` (hard-coded `MOCK_INJURIES`); `players.status` / `injury_*` / `practice_participation` (migration 034, Sleeper sync) | Statuses exist, but there is no status-change timestamp or news feed, so "2h" and newest-first can't be shown (Q14). A version without times could be built on existing data. |
| "On your roster · {team}" line | new-ui-on-existing-data | `league_rosters` + `teams` (useRosters) | Overlap across the user's leagues, which are flag-gated. |
| Injury "See all" | out-of-scope-or-question | none | The prototype only toasts; no destination is defined. |
| Practice / Mock draft card (Start) | restyle-only | `MockLaunchDialog`, `/app/mocks` (`featureFlags.mockDrafts`); today it is a "Mock" chip in `HomeQuickActions` | The same flow in a card presentation. |
| App-only Home content (Scout AI card, Top waiver adds, Recently viewed, AI experts shelf) | out-of-scope-or-question | `scout-ai-card.tsx` (mock), `waiver-adds-card.tsx` (mock), `recently-viewed.tsx`, `ai-expert-shelf.tsx` | Not in the design. CLAUDE.md says AI and persona features must be kept and restyled, so where do they go on mobile Home? |
| Launch screen | restyle-only | the app opens `/app` (Home) | The prototype opens League › Match, which is only a prototype artefact (Q17). |

### Tab bar and dock

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Outside-league bar: Home / Community / Players / Profile avatar | out-of-scope-or-question | `bottom-tabs.tsx`: Home / Lists / Players / Search / More, h-16, lime active | Community is flag-off at launch, and the Lists tab would be dropped. Players → `/app/players` already exists, which answers Q16. |
| Bar look (80px, `--m-bar-a`, #fff / #A1A1A6, 22px icons, avatar ring) | restyle-only | `bottom-tabs.tsx`; `m-bar-a` token exists | — |
| In-league bar on Notifications (Match / Team / Players / League / Menu, none active) | out-of-scope-or-question | there is no in-league bottom bar; league routes exist (matchup, team, players, standings) | Q3: should Notifications show the in-league bar at all? |
| Menu sheet over Notifications (league items + FieldScout apps) | new-ui-on-existing-data | `more-sheet.tsx` (generic "More"); `/app/leagues/[id]/{settings,schedule,draft,standings}` | Belongs to another area. League history and Previous seasons have no route. |

### Notifications

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Notifications screen (real feed) | restyle-only | `/app/notifications` → `notifications-feed.tsx`; `GET /api/notifications` (newest first, limit 50) | Sorted newest first, which answers Q4. Ships a card layout today. |
| Top bar Back | restyle-only | none today (`PageHeader` only) | `router.back()` gives the "return to where you came from" behaviour. |
| "Mark all read" | new-ui-on-existing-data | `POST /api/notifications/read` with no body marks all; `useMarkNotificationsRead` | The page currently marks everything read automatically on open (`useEffect`). That contradicts the spec, where rows stay unread until the button is tapped. Q2/Q18. |
| Title "Notifications" 28/600 | restyle-only | `PageHeader title="Notifications"` | — |
| Row look: unread tint, 40px tinted icon circle, title 600/500, "sub · time", 9px blue dot | restyle-only | `NotificationRow`: 27px tile, type label + time line, 6px dot; `notificationKind` / `notificationIcon` | Map each type to its tint (`m-gb` / `gg` / `gr` / `go` / `gp`) and stroke colour. |
| Tap a row → that row becomes read | new-ui-on-existing-data | the API accepts `ids`; the rail panel already marks a row read on click (`notifications-panel.tsx` l.57) | The prototype never marks on tap (Q2). The app's rail already does. |
| Trade offer row → trade detail (Accept / Decline / Counter, team view, counter builder) | new-ui-on-existing-data | `league_trade_*` rows carry `trade_id`; `notificationHref` → `/app/leagues/[id]/trades` (the list); `TradeCard` in `trade-center.tsx` | There is no deep link to a single trade or a detail overlay. "Message @marcus" needs DMs (needs-new-backend). |
| Waiver processed row | restyle-only | `league_waiver_claim` from `waiver_claim_notify_internal` (migration 150) | The row renders inert: `notificationHref` doesn't route this type even though it carries `league_id`. |
| "@user updated <ranking>" row + ranking deep link | needs-new-backend | only `list_updated` exists (`notify_list_followers`, 019/038) | Nothing notifies followers of ranking changes, and Rankings is flag-off. The route and its Back are Q19. |
| "Player scored a TD" row | needs-new-backend | none (`score_fanout` is an internal scoring queue) | Needs per-play event notifications. |
| "Player is out, in your lineup" row | needs-new-backend | none | Needs a job that compares injury status with lineups. |
| "Lineup locks in 2 hours" reminder | needs-new-backend | none | Needs a scheduled job. |
| Rows that only toast; edge cases H1m, N1i and the Message path | out-of-scope-or-question | — | Prototype artefacts. N1i (profile opening under the trade detail) is Q24; the "Message @marcus" exit path is Q23. |
| Small hit targets ("Mark all read" 17px, "See all" 16px) | out-of-scope-or-question | — | Q22: pad them to 30px or more? |
