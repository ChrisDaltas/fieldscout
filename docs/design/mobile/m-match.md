## League › Match tab, live game feed, game stats

Sources, all in `FieldScout Mobile.dc.html` unless noted:
- **Markup:** lines 17–22 (global CSS), 40–44 (status bar), 232–301 (league header and Match tab), 456–518 (live game feed), 609–625 (Notifications header, for its dock), 627–644 (dock and home indicator), 1090–1107 (`hasGS`), 1117 (toast).
- **Script:** constants at 1123–1221 (`GAMES` 1165, `GPLAYS` 1170, `POOL` 1175, `BOX` 1180, `LEAGUES` 1194, `BENCH_ME`/`BENCH_THEM` 1213–1214, `PDB` 1216–1220), `rosterOf` 1256, `livePlay()` 1403–1413, initial `state` 1414, `gsVals` 1472–1485, `toast()` 1624, `renderVals` 1626–1859.
- **Headshot component:** `FSHeadshot.dc.html`.

> **Read this first: light-mode colours are the per-use fallbacks.** Apart from `--x-dockpad` (set in both themes by `.dock-lg`/`.dock-sm`, line 22), no `--x-*` variable is defined in light mode. Only `.fs-dark` defines them (line 19), so every `var(--x-token, #hex)` renders its **fallback hex** in light mode. The same token sometimes has a different fallback at different call sites:
> - `b2` is `#F2F2F4` or `#EDEDF0`.
> - `b3` is `#EBEBEE` or `#E5E5EA`.
> - `b4` is `#D1D1D6`, `#AEAEB2` or `#C7C7CC`.
>
> Below, colours are written as `token (light fallback)` exactly as each element uses them. Dark values are in §6.
>
> README token reference:
>
> | Token | Light value |
> |---|---|
> | t1 | #1D1D1F |
> | t2 | #3A3A3C |
> | t3 | #6E6E73 |
> | t4 | #8E8E93 |
> | t5 | #AEAEB2 / #C7C7CC |
> | b0 | #FFFFFF |
> | b1 | #F5F5F7 |
> | b2 | #F2F2F4 |
> | b3 | #EBEBEE / #E5E5EA |
> | b4 | #D1D1D6 |
> | ink | #1D1D1F |
> | accent | #0088FF |
> | green fill | #07B85A |
> | success text | #07A852 |
> | danger | #FF0028 |
> | TE / "to-go" yellow | #ECAD48 |
> | RB blue | #5C7CE5 |
>
> **Correction to the task brief:** `hasGS` (lines 1090–1107, built by `gsVals`) is **not** a play stat detail. It is the **global search overlay** ("Players, people and posts"). The league header's Search icon opens it, so it is documented here in §2.4. The prototype has **no play stat-detail view** (§3.4); the README conflict is listed in §7, question Q1.

---

### 1. Screens & states

| # | Screen / state | Exact condition (script) |
|---|---|---|
| 1 | **League header** (shared by every league tab) | `isLeague` = `s.scr === "league"` |
| 2 | **Match tab** | `isLeague && tabMatch` (`s.tab === "match"`). This is the prototype's **initial screen** (`state.scr:"league", tab:"match"`). |
| 2a | Matchup index `mi`, 0 to 5 (6 matchups, `MUPS.length`) | `mi = s.mi \|\| 0`. The state starts undefined, which reads as 0. `mi === 0` is "your matchup" (Touchdown Tacos vs Gridiron Gurus). |
| 2b | Matchup content mid-drag | `s.mxDx ≠ 0 && !s.mxAnim`: the content follows the finger. |
| 2c | Matchup content animating (slide out, slide in, snap back) | `s.mxAnim === true` (transition on) |
| 2d | Starter row, player not yet played | Row `pts === "-"` (hyphen-minus). Points show "-" in t5. |
| 2e | Starter row, empty slot | The generated lineup has no eligible player, so the row is `["Empty", slot, "", "", "-", "–", ""]` and `mk` returns `{name:"Empty", pos:"", posC:t5, team:"", pts:"–" (en dash), ptsC:t5, proj:"", game:"", openP:() => {}}`. Rendering: the name "Empty" stays **t1** because the name span has no colour binding. The meta line still prints the literal **" · "** separator between the empty pos and team (line 287: `{{pos}} · {{team}}`) in t3. Points "–" in t5. The projection is blank and the game line is an empty span. The half keeps `cursor:pointer` but tapping it does nothing (no-op). Does not occur with the sample data. |
| 2f | Week navigation, week N | `s.week` (initial 5), clamped to 1–17. Only the label changes. |
| 2g | Week at 1 or 17 | The ‹ or › button still renders and responds. The value silently stays clamped and there is no disabled style. |
| 3 | **Live game feed, "My players" view** | `s.scr === "feed" && s.game === "mine"`. `hasGame` = false, `showPlays` = true, `showBox` = false. No game header and no Plays/Box toggle. |
| 3a | **Live game feed, single game, Play by play** | `s.game ∈ {"cin","min","chi"} && s.gtab === "plays"`. `hasGame` and `showPlays` are true. |
| 3b | **Live game feed, single game, Box score** | `s.game ≠ "mine" && s.gtab === "box"` → `showBox` |
| 3c | Play row, "fresh" (new) | The play timestamp `ts` is less than 20 000 ms old at render time → `isNew` (red "New" pill) and bg `var(--x-gb2,#F5FAFF)`. Live plays only; static plays have no `ts`. |
| 3d | Play row, touchdown | `/TD/.test(title)` → title in #07A852 plus a green "TD" pill |
| 3e | Play row, fantasy-relevant | `fpts` is non-empty → owner and points footer row (`p.mine`) |
| 3f | "My players" card subtitle | `nNew` = number of entries across all of `s.extra` with `Date.now() - ts < 20000`. Shows "N new play" or "N new plays", otherwise "Following 14 players". |
| 3g | After a simulated touchdown | `livePlay` sets down "Kickoff", spot "Touchback" and ball 25, and flips possession (§3.5). The field label then reads "Kickoff at Touchback", and the **next** play's situation reads "Kickoff @ Touchback". |
| 3h | Game clock exhausted | The clock floors at 0 and stays at "Q4 0:00". The quarter never changes. The red live dot and red status remain. There is **no final, pre-game, halftime, empty, loading or error state**: `gm.live` is always true and `statusC` is always #FF0028 (line 1680). This is an undesigned state (§7, Q12). |
| 3i | "N new plays" that the list doesn't show | `nNew` counts every fresh live play, including plays without `fpts`. My players lists only plays **with** `fpts`, so the card can announce plays that are not in the list. |
| 4 | **Global search overlay** | `hasGS` = `!!s.gs` (`s.gs = {q, scope}`) |
| 4a | Empty query | `gs.empty` = trimmed query is empty → "Recent" and "Trending" |
| 4b | Results | `hasPlayers` / `hasPeople` / `hasPosts`. Each requires the scope to be "all" or that scope, plus at least 1 match. |
| 4c | No results | `gs.none` = a query is present and no visible section has results → "No results" |
| 4d | Clear button visible | `gs.hasQ` = trimmed query is non-empty |
| 5 | Notification badge | `hasNotifBadge` = `nUnread > 0`, where `nUnread = s.notifRead ? 0 : 3` |
| 6 | DM badge | `hasDmBadge` = `dmCount > 0`, where `dmCount` = number of `true` values in `s.unread` (initial `{league, marcus, nina}` = 3) |
| 7 | Toast | `hasToast` = `!!s.toast`. Auto-clears after **1800 ms** in code (`toast()`, line 1624). |
| 8 | Notifications / Messages, reached from the header bell and bubble | `scr === "notifs"` / `"dms"`. Their content is outside this section; their **dock** is covered in §2.5. |

**Code that exists but is not rendered or not used by this area (do not build it from here):**
- `mxLabel` ("Your matchup" / "Matchup N of 6"), `mxHint` ("Swipe to see other matchups"), the `mxPrev`/`mxNext` arrows, and `leagueTabs` (a top tab strip with a blue `inset 0 -2px 0 #0088FF` underline).
- `PLAYS` (line 1151) is dead data. It is only defined; the feed uses `GPLAYS`. It carries per-play reaction counts and comments.
- The `s.reacts` state and the `ICON.fire` / `ICON.laugh` / `ICON.clap` icons are never rendered.
- `OPRK` (line 1147) is read only by the Team tab's `rowFor` (line 1638). It does **not** feed the Match tab.
- `BENCH_ME` / `BENCH_THEM` (lines 1213–1214) do **not** feed the Match tab. They feed `PDB`, the initial `s.bench`, `ownerOf` (`BENCH_THEM`), `rosterOf(1)`, `postRoster`, `teamRoster` and the draft pool. If a Match-tab Bench is built (§7, Q3), their data is in §5.

---

### 2. Layout (top to bottom)

#### 2.0 Frame, status bar, home indicator, toast
- **Phone:** 390×844, radius 48px, `overflow:hidden`, bg `var(--x-b0,#fff)`, text t1, flex column, `position:relative`. It carries the theme class plus `dock-lg`/`dock-sm`.
- **Font:** Inter Display with `font-feature-settings:'tnum' 1,'cv11' 1`, antialiased.
- **Status bar** (line 40): height 50px, flex, `align-items:center`, `justify-content:space-between`, `padding:6px 32px 0 40px`, 16px/600, colour t1.
  - Left: "9:41".
  - Dynamic Island: absolute, `left:50%`, `top:11px`, `translateX(-50%)`, 120×34, radius 999, #000.
  - Right (flex, gap 6px), all icons in t1:
    - Signal SVG 18×12: four bars at x = 0, 5, 10 and 15, each 3 wide, with heights 4, 7, 9.5 and 12, rx 1, bottom-aligned.
    - Battery SVG 25×12: outline rect 21×11 at (.5,.5), rx 3.5, stroke at opacity .4; fill rect 16×8 at (2,2), rx 2; cap 1.5×4 at (23,4), rx .75, opacity .4.
- **Home indicator** (line 644): 134×5, radius 999, `var(--x-b0,#fff)`, `position:absolute; left:50%; bottom:8px; translateX(-50%)`, with **no z-index**.
  - The tab bar is `position:relative; z-index:4` and the phone container creates no stacking context, so by CSS painting order the indicator paints **beneath** the tab bar, which is 94% or 92% opaque.
  - As written it is effectively invisible in both themes. In light mode it is a white pill under a dark bar over a mostly white page; in dark mode it is #121212.
  - Confirm whether it should sit above the bar (§7, Q11).
- **Toast** (line 1117): absolute, `left:50%; bottom:100px; translateX(-50%)`, z 30, height 36px, `padding:0 16px`, radius 999, bg `var(--x-ink,#1D1D1F)`, white 13px/500, nowrap.
  - It spans y 708–744.
  - On league screens it sits **on top of the league switcher card** (y 702–758).
  - On the feed it floats 20px above the tab bar, whose top edge is at y 764.

#### 2.1 League header (`isLeague`, lines 233–244)
- **Container:** `flex:none; padding:0 12px; border-bottom:1px solid var(--x-b3,#EBEBEE)`.
  - Inner row: height 48px, flex, `align-items:center`, `gap:10px`.
  - Total height 49px, at y 50–99.
- **Logo tile:** 28×28, `margin-left:4px` (left edge at x = 16), radius 8px, bg #07D066 (brand green).
  - Centres `assets/fieldscout-logomark.svg` at 15×15, `alt="FieldScout"`.
  - **Not tappable** here (no onClick, unlike Home).
- **Home button:** 38×38 circle, `margin-left:-6px` (the box gap after the logo is 4px), colour t1.
  - Pressed bg `var(--x-b2,#F2F2F4)`.
  - Icon 20×20, viewBox 16, stroke 1.5, round caps and joins, path `M2.5 7.2L8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5z`.
  - `title="Home"`.
- **League name:** `{{ lg.name }}` = `LEAGUES[s.lg].name`. Values by `s.lg`:
  0. "Sunday Funday League" (default)
  1. "Family Bragging Rights"
  2. "Joy to Us"
  3. "Work League"

  13px/600, `flex:1; min-width:0`, single line with ellipsis.
- **Right cluster:** flex, `gap:2px`, `flex:none`, three 38×38 circular buttons.
  - Pressed bg `var(--x-b2,#F2F2F4)`. Icons are 20×20, viewBox 16, stroke 1.5, colour t1.
  1. **Search:** `<circle cx=7 cy=7 r=4.8>` plus `M10.6 10.6L14 14` (round caps). `title="Search"`.
  2. **Notifications (bell):** `M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14h3`.
     - Badge when `hasNotifBadge`: absolute, top 4px, right 4px, min-width 16px, height 16px, padding 0 4px, radius 999, bg **#FF0028**, white 10px/600, centred.
     - Badge ring: `box-shadow:0 0 0 2px var(--x-b0,#fff)` (a 2px ring in the page colour).
     - Text `{{ notifBadge }}` = "3".
  3. **Messages (bubble):** `M8 13.5c3.3 0 6-2.4 6-5.5S11.3 2.5 8 2.5 2 4.9 2 8c0 1.2.4 2.3 1.1 3.2L2.5 13.8l2.9-.9c.8.4 1.7.6 2.6.6z`.
     - Badge styled the same but with bg **#0088FF**.
     - Text `{{ dmBadge }}` = "3" initially.
- **Below the header:** the tab scroller `.fsm-scroll` (`flex:1; min-height:0; overflow-y:auto`, scrollbar hidden). Its `::after` adds a bottom spacer equal to `--x-dockpad`, which is **150px** on league screens (`dock-lg`).

#### 2.2 Match tab (`tabMatch`, lines 248–300)
The **entire Match tab content is one swipe container** (line 249): dots, card, "Yet to play" row, Starters header **and** starter rows.
- Style: `touch-action:pan-y; user-select:none; transform:translateX({{mx.x}}); opacity:{{mx.op}}; transition:{{mx.tr}}`.
- It sits inside the `overflow-y:auto` scroller, so that scroller's `overflow-x` computes to `auto` (see §3.2 for the side effect).

**A. Top block** (`padding:6px 12px 0`, so the card is 366px wide)
1. **Pager dots:**
   - Row: flex, centred, `padding:0 0 8px`. Inner flex `gap:4px`.
   - Six dots, one per `MUPS` entry. Each is 6px tall, radius 999, `cursor:pointer`, `transition:width .2s linear`.
   - Active (`k === mi`): **14px** wide, `var(--x-ink,#1D1D1F)`.
   - Inactive: 6px wide, `var(--x-b4,#D1D1D6)`.
   - There is **no label and no arrows**.
   - The hit area is only the dot itself (6×6 or 14×6, no padding), below the README's 30px minimum hit target.
2. **Matchup card** (`mainMatch`, always exactly one item): radius **18px**, bg `var(--x-b1,#F5F5F7)`, `overflow:hidden`.
   - **Score grid:** `grid-template-columns:minmax(0,1fr) 30px minmax(0,1fr)`, `gap:8px`, `align-items:center`, `padding:14px 12px 12px`. Each side column is 148px.
   - **Side A (left):** flex column, `gap:6px`, `min-width:0`.
     - Row (flex, centred, gap 8px):
       - Avatar circle 34×34, team initial `m.a.ini` (first character of the team name), 12px/600 white, bg `m.a.av`.
       - Flex spacer.
       - Score column (flex column, `align-items:flex-end`): score `m.a.score` 22px/600, letter-spacing -0.02em; projection `m.a.proj` 11px/500 t3. The projection is the bare number (e.g. "83.44") with no "Proj" label.
     - **Win bar:** height 4px, radius 999, track `var(--x-b3,#E5E5EA)`, `overflow:hidden`.
       - Fill: height 100%, width `m.a.winW` (e.g. 66%), colour `m.a.winC`, anchored **left**.
       - The fill has **no border-radius of its own**. Its outer (left) end is rounded only by the track's clip; its inner (right) end is **square**.
     - Text column (flex column, gap 1px, `min-width:0`):
       - "`{win}` win" (e.g. "66% win") 11px/600 in `winC`.
       - Team name 14px/600, nowrap, ellipsis, `cursor:pointer`, **tappable**.
       - Meta 11px/500 t3, nowrap: "`@mgr` · `rec` `stk`" (e.g. "@dalton · 2-6 ▼2L"). The streak `stk` is in its own span coloured `stkC`.
   - **Centre:** 30×30 circle, bg `var(--x-b0,#fff)`, "vs" 11px/600 t3.
   - **Side B (right)** mirrors side A with `text-align:right`:
     - Row order: score column (`align-items:flex-start`, so the score sits next to "vs"), spacer, then the avatar at the far right.
     - Win bar container `display:flex; justify-content:flex-end`, so the fill is anchored **right**. Its inner (left) end is square.
     - Meta order: "`rec` `stk` · `@mgr`" (e.g. "8-0 ▲8W · @marcus").
   - **Live-play row** (line 268; static content):
     - Container: flex, centred, `gap:10px`, `padding:10px 12px`, `border-top:1px solid var(--x-b3,#E5E5EA)`, `cursor:pointer`, bg transparent, pressed bg `var(--x-b2,#EDEDF0)`.
     - Headshot `FSHeadshot` size 32, team "NO", player "Devaughn Vele", src "". It shows initials "DV" on #EEEEF1 at 12px/700 #6E6E73, with ring `0 0 0 1px #fff, 0 0 0 3px #D3BC8D` (NO colour from the FSHeadshot map).
     - Text column (flex 1, `min-width:0`, gap 1px): "Q4 6:50 · 2nd & 7 @ NO 44" 11px/500 t3; "D. Vele 9 yd catch" **13.5px**/600.
     - Right column (`align-items:flex-end`, gap 1px):
       - "Live" 11px/600 #FF0028, preceded by a 6×6 #FF0028 dot (gap 4px).
       - "+0.9" 14px/600 #07A852.
     - Chevron: 14×14, viewBox 16, stroke 2, round caps and joins, `var(--x-t5,#AEAEB2)`, path `M6 3l5 5-5 5`.
3. **"Yet to play" line:** flex `space-between`, `padding:10px 4px 0`, 11px/500 t3.
   - Left: "Yet to play: 4 · QB, RB, WR, D/ST". Right: "Yet to play: 5".
   - Static text, identical for every matchup.

**B. Starters header** (line 279): flex, `space-between`, centred, `padding:18px 16px 6px`.
- "Starters": 17px/600, letter-spacing -0.01em.
- **Week navigator** (flex, `gap:2px`):
  - Prev button: 30×30 circle, pressed bg `var(--x-b2,#F2F2F4)`. Chevron 12×12, viewBox 16, #0088FF, stroke 2.2, round caps and joins, path `M10 3L5 8l5 5`.
  - Label "Week {{week}}" (e.g. "Week 5"): 13px/600 #0088FF, nowrap.
  - Next button: same styling, path `M6 3l5 5-5 5`.
- **No "Bench" section is rendered on the Match tab.** There are only 9 starter rows; the README says "Starters/Bench" (§7, Q3).

**C. Starter comparison rows** (container `padding:0 12px 20px`). Nine rows, one per `SLOTS` entry: QB, RB, RB, WR, WR, TE, FLEX, K, DST.
- **Row:** grid `minmax(0,1fr) 38px minmax(0,1fr)`, `gap:8px`, `align-items:center`, `padding:10px 4px`, `border-bottom:1px solid var(--x-b2,#F2F2F4)`. Each side is 152px.
- **Left player (A):** flex column, gap 3px, `min-width:0`, `cursor:pointer`, tappable.
  - Top row (flex, `align-items:flex-start`, gap 6px):
    - Name column (flex 1, `min-width:0`, gap 1px):
      - Short name 14px/600, nowrap, ellipsis.
      - Under it, 11px/500 t3, nowrap: "**POS** · TEAM (bye)". POS is 600 in the position text colour.
    - Points column (`align-items:flex-end`, gap 1px):
      - Points 16px/600: t1, or `var(--x-t5,#AEAEB2)` when "-".
      - Under it the projection, 11px/500 t3.
  - Game line: 11px/500 t3, nowrap, ellipsis (e.g. "Sun 1:00 PM vs DET", "Final W 31-20 @ GB", "Q4 6:50 @ DEN").
- **Slot chip (centre):** 38px column, height 26px, radius **8px**, 11px/600, centred, not interactive. The README says position chips are 4–5px (§7, Q9).

  | Slot | Background | Text | Label |
  |---|---|---|---|
  | QB | #F75252 | #fff | QB |
  | RB | #5C7CE5 | #fff | RB |
  | WR | #9D70E9 | #fff | WR |
  | TE | #ECAD48 | #fff | TE |
  | FLEX | `var(--x-ink,#1D1D1F)` | #fff | FLEX |
  | K | #D2E8E8 | #1D1D1F | K |
  | D/ST | #FFE75E | #1D1D1F | D/ST |

- **Right player (B)** mirrors A (`text-align:right`): the points column comes first and is left-aligned (`align-items:flex-start`), then the name column. The game line is right-aligned.
- **Position text colours** (`POSTXT`):

  | QB | RB | WR | TE | K | DST |
  |---|---|---|---|---|---|
  | #E03E3E | #4A68D4 | #8656D8 | #C98A1F | #5E8C8C | #A68A00 |

#### 2.3 Live game feed (`isFeed`, lines 456–518)
**Fixed header** (`flex:none; padding:0 12px`):
1. **Top row:** height 52px, flex, centred, `gap:8px`.
   - **Back button:** 36×36 circle, pressed bg `var(--x-b2,#F2F2F4)`. Chevron 18×18, viewBox 16, stroke 2, t1, path `M10 3L5 8l5 5`.
   - **Matchup strip** (flex 1): grid `minmax(0,1fr) 60px minmax(0,1fr)`, `gap:8px`, centred. It is **static** and always shows your matchup.
     - Left column (`align-items:flex-end`): "Touchdown Tacos" 11px/500 t3, nowrap, **no** ellipsis; "39.70" 16px/600.
     - Middle: 60px bar, height 5px, radius 999, track `var(--x-b3,#E5E5EA)`, `overflow:hidden`. Fill **66%** #07B85A from the left. The fill has no radius, so its right end is square.
     - Right column: "Gridiron Gurus" 11px/500 t3, nowrap, ellipsis; "16.40" 16px/600.
   - Right spacer 36px, which keeps the strip centred.
2. **Game picker:** horizontal `.fsm-scroll`, `display:flex; gap:8px; overflow-x:auto; padding:4px 0 12px`, scrollbar hidden.
   - It scrolls inside the 12px header padding, so cards clip at x = 12 and x = 378.
   - Content width is 4×130 + 3×8 = 544px, so the CHI card (starting at x = 426 before scrolling) is initially off-screen.
   - **Card:** `flex:none; width:130px; padding:10px 12px; border-radius:14px`, flex column, `gap:6px`, `cursor:pointer`.
     - Row 1: `top` (13px/600, nowrap) and `topS` (13px/600), `space-between`, gap 6px.
     - Row 2: `bot` and `botS`, same styling.
     - Sub line: `sub` 11px/500 in `subC`, nowrap.
     - Unselected: bg `var(--x-b1,#F5F5F7)`, no ring.
     - **Selected:** bg `var(--x-gb,#E6F2FF)` plus `box-shadow:inset 0 0 0 1.5px #0088FF`.
   - **Cards in order:**
     1. "My players" / "3 live games" (no scores). Sub "Following 14 players" or "N new play(s)" in **#0088FF**.
     2. CIN 28 / MIA 18. Sub "Q4 2:19 · FOX" in **#FF0028**.
     3. MIN 23 / NO 13. Sub "Q4 6:05 · CBS" in #FF0028.
     4. CHI 7 / GB 31. Sub "Q4 12:00 · FOX" in #FF0028.
   - The away team is on the top row and the home team on the bottom row. Scores and clock are live (`gNow`).

**Scrolling body** (`.fsm-scroll`, `flex:1; min-height:0; overflow-y:auto; border-top:1px solid var(--x-b3,#EBEBEE)`). Its `::after` spacer is **84px**, because the feed uses `dock-sm`.

3. **Game header** (only when `hasGame`; it scrolls with the content): `padding:14px 14px 10px`, flex column, `gap:12px`, `border-bottom:1px solid var(--x-b2,#F2F2F4)`.
   - **Score row:** grid `minmax(0,1fr) auto minmax(0,1fr)`, `gap:10px`, centred.
     - **Away** (flex, centred, gap 8px):
       - Team tile 34×34, **radius 10px**, bg `gm.awayC`, abbreviation 11px/600 white.
       - Column: score 24px/600, letter-spacing -0.02em; sub 11px/500 t3 = `awayRec` + `awayPoss`. Example: "3-2 · ball" when the away team has the ball, else "3-2".
     - **Centre** (column, `align-items:center`, gap 2px):
       - Status (flex, gap 4px, 11px/600, colour `statusC` #FF0028): a 6×6 #FF0028 dot (`gm.live`, always true) plus "Q4 2:19".
       - Under it: "2nd & 9 · FOX" (`down · net`), 11px/500 t3, nowrap.
     - **Home** (flex, `justify-content:flex-end`, gap 8px, `text-align:right`):
       - Column (`align-items:flex-end`): score 24px/600; sub `homePoss` + `homeRec` (e.g. "ball · 1-4").
       - Then the team tile.
   - **Field strip:** `position:relative`, height 28px, radius 8px, bg `var(--x-gg,#E3F9EC)`, `overflow:hidden`.
     - Left end zone: absolute, width 10%, full height, bg away colour, opacity .15.
     - Right end zone: same, with the home colour.
     - Ball line: 2px wide, full height, at `left:{ball}%`, bg `var(--x-ink,#1D1D1F)`.
     - First-down line: 2px wide at `left:min(98, ball+9)%`, bg #ECAD48.
     - Centred label (`left:50%; top:50%; translate(-50%,-50%)`): "`{down}` at `{spot}`" (e.g. "2nd & 9 at MIA 9"), 10.5px/600, `var(--x-t2,#3A3A3C)`, nowrap.
   - **Segmented control:** flex, `padding:3px`, radius 999, track `var(--x-b2,#F2F2F4)`.
     - Two segments, each `flex:1`, height 30px, radius 999, 13px/600, centred, `cursor:pointer`. Text colour is inherited t1 for both.
     - Selected: bg `var(--x-b0,#fff)`, `box-shadow:0 1px 3px rgba(0,0,0,.12)`. The README says `0 1px 2px` (§7, Q9).
     - Unselected: transparent, no shadow.
     - Labels: "Play by play", "Box score".
4. **Play rows** (`showPlays`), one per play:
   - **Row:** `padding:14px 14px 12px`, `border-bottom:1px solid var(--x-b2,#F2F2F4)`, flex, `gap:10px`, `cursor:pointer`.
     - bg `p.bg`: `var(--x-b0,#fff)`, or `var(--x-gb2,#F5FAFF)` when fresh.
     - `transition:background .4s linear`. Pressed bg `var(--x-b1,#F5F5F7)`.
   - **Headshot** `FSHeadshot` size **40**: ring `0 0 0 1px #fff, 0 0 0 3px <team colour>`, initials 14px/700.
   - **Content column** (flex 1, `min-width:0`, `gap:5px`):
     - **Meta row** (`space-between`, gap 8px, 11px/500 t3):
       - Situation `sit` (e.g. "2nd & 7 @ NO 44").
       - Right side (flex, centred, gap 6px): optional **"New" pill** (height 16, padding 0 6px, radius 999, bg #FF0028, white 9.5px/600), then the clock `clock` (e.g. "Q4 6:05") at weight 600 in `var(--x-t1,#1D1D1F)`.
     - **Title row** (flex, centred, gap 8px):
       - Title 15px/600, letter-spacing -0.01em, flex 1. Colour #07A852 if the title contains "TD", else t1.
       - Optional **"TD" pill**: height 20, padding 0 8px, radius 999, bg #07B85A, white 11px/600, nowrap, `flex:none`.
       - Game score `score` 11px/600 t3, nowrap ("MIN 23-13 NO"). Shown **only in My players**; in single-game view it is an empty span.
     - **Lines** (flex column, gap 1px, 11.5px/500 t3):
       - `l1`, then a space, then the gain in a 600 #07A852 span, wrapped in parentheses. Example: "D. Vele WR · 4/6 rec, 26 yd **(+9 yd)**".
       - `l2` (e.g. "T. Shough QB · 13/19, 80 yd"). When `l2` is "" the empty span still renders: it has zero height but keeps the 1px gap.
     - **Yard bar:** `position:relative`, height 6px, `margin:6px 0 4px`, radius 999, track `var(--x-b3,#E5E5EA)`, **no** `overflow:hidden`. Its three children are absolutely positioned and paint in DOM order:
       1. Fill from 0 to `yard%`, #5C7CE5, radius 999.
       2. Knob: 14×14 circle at `left:yard%`, `top:-4px`, `margin-left:-7px`, bg `var(--x-b0,#fff)`, `box-shadow:0 0 0 2px #5C7CE5`.
       3. Right end zone: width 10%, full track height, `border-radius:0 999px 999px 0`, bg **#FDE4E4** (hard-coded).
       - Because the end zone comes **last**, at `yard ≥ 90%` (Chase 91%, Watson TD 100%) it paints over the blue fill and over the middle 6px band of the knob.
       - At 100% the knob overhangs the track's right end by 7px.
     - **Owner row** (only when `fpts`): flex, centred, gap 6px. Owner team name 12px/600 (flex 1); fantasy points 14px/600 in #07A852 if `owner === "Touchdown Tacos"` (literal string), otherwise #FF0028.
5. **Box score** (`showBox`): container `padding:12px 14px 20px`, flex column, `gap:18px`.
   - **Team stats table:**
     - Header: grid `minmax(0,1fr) 64px 64px`, gap 8px, `padding:6px 0`, 11px/600 t3, `border-bottom:1px solid var(--x-b3,#EBEBEE)`. Cells: "Team stats" | away abbreviation | home abbreviation (both right-aligned).
     - Seven rows, same grid, `padding:9px 0`, `border-bottom:1px solid var(--x-b2,#F2F2F4)`, 13px.
     - Label weight 500 in `var(--x-t2,#3A3A3C)`. Values are right-aligned and inherit t1: weight 600 for the better side, else 500.
   - **Three player groups:** Passing (C/Att, Yds, TD, Int), Rushing (Car, Yds, TD), Receiving (Rec, Yds, TD).
     - Grid `minmax(0,1fr)` plus one 44px column per stat, `gap:6px`.
     - Header: `padding:6px 0`, 11px/600 t3, `border-bottom:1px solid var(--x-b3,#EBEBEE)`. The first header cell is the group name, left-aligned; the others are right-aligned.
     - Rows: `padding:8px 0`, `border-bottom:1px solid var(--x-b2,#F2F2F4)`, `align-items:center`, `cursor:pointer`, tappable.
     - Cells: 13px, nowrap, ellipsis.
       - Name cell, e.g. "J. Burrow · CIN": left-aligned, weight 600, colour `var(--x-ink,#1D1D1F)`.
       - Number cells: right-aligned, weight 500, colour **#3A3A3C** (hard-coded).

#### 2.4 Global search overlay (`hasGS`, lines 1090–1107)
- **Panel:** `position:absolute; left:0; right:0; top:50px; bottom:0; z-index:29`, bg `var(--x-b0,#fff)`, flex column.
  - It covers the header, the content and the whole dock. The status bar stays visible.
  - There is **no open or close animation and no backdrop**.
- **Search row:** height 52px, `padding:0 16px`, `gap:10px`.
  - **Field:** flex 1, `min-width:0`, height **38px**, radius 12px, bg `var(--x-b2,#F2F2F4)`, `padding:0 12px`, gap 8px.
    - Search icon 15×15, stroke 1.8, round caps, `var(--x-t4,#8E8E93)` (same circle and line paths as the header icon).
    - Input: `autofocus`, placeholder "Players, people and posts", 15px/500, colour t1, transparent background, no border or outline, inherits the font.
      - Placeholder colour is **#6E6E73** from the global `input::placeholder` rule (line 17). It is not themed.
    - Clear button when `hasQ`: 18×18 circle, bg `var(--x-b4,#AEAEB2)`, white ×, 8×8, stroke 3, path `M4 4l8 8M12 4l-8 8`.
  - **"Cancel":** 15px/500, #0088FF, `flex:none`.
- **Scope chips:** horizontal scroll, `flex:none`, `gap:6px`, `padding:0 16px 10px`.
  - Chips: height 30px, `padding:0 14px`, radius 999, 13px/600.
  - Labels "All", "Players", "People", "Posts".
  - Selected: bg `var(--x-ink,#1D1D1F)`, text #fff. Unselected: bg `var(--x-b2,#F2F2F4)`, text t1.
- **Body:** scroller `padding:0 16px 24px`, plus the `.fsm-scroll[style*="overflow-y"]::after` spacer at `var(--x-dockpad)`. That is **150px** when opened from the league header, because the phone still carries `dock-lg` even though the overlay hides the dock.
  - **Empty query:**
    - Heading "Recent" (`padding:6px 0 4px`, 13px/600 t3).
    - Four rows, each height 42px, gap 10px, `border-bottom:1px solid var(--x-b2,#F2F2F4)`.
      - Clock-arrow icon 14×14, stroke 1.6, t4, path `M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5`.
      - Label 14px/500, flex 1.
      - Items: "Puka Nacua", "waiver stashes", "@shahranks", "Tyler Warren".
    - Heading "Trending" (`padding:18px 0 8px`, 13px/600 t3).
    - Wrapping chips (`gap:6px`):
      - Height 32px, `padding:0 12px`, radius 999, gap 5px, 13px/600, bg `var(--x-b2,#F2F2F4)`.
      - Trend icon 11×11, stroke 2, path `M2.5 11.5l4-4 3 3 4-5M10 5.5h3.5V9`. The stroke is `currentColor` with no colour set, so it inherits **t1**.
      - Chips (`CMTOPICS.slice(0,6)`): "Sleeper picks", "Waiver stashes", "Puka Nacua", "Injuries", "George Kittle", "Rookies".
  - **Players** section (heading `padding:6px 0 2px`, 13px/600 t3):
    - Rows `padding:8px 0`, gap 10px, bottom border b2.
    - Headshot 34; name 14px/600 with ellipsis; meta "WR · LAR" 11px/500 t3 ("D/ST" for DST).
    - Owner label 11px/600, `flex:none`:
      - "Your team" in #0088FF.
      - Another team's name in t3.
      - "Waivers" or "Free agent" in #07A852.
  - **People** section (heading `padding:16px 0 2px`):
    - Avatar 34 circle in the person's colour; the initial is the handle's second character uppercased, 13px/600 white.
    - Name (the handle) 14px/600, **no ellipsis**.
    - Sub 11px/500 t3, nowrap, ellipsis (e.g. "Gridiron Gurus · your league", "12k follows").
  - **Posts** section (heading `padding:16px 0 2px`):
    - Rows `padding:10px 0`, gap 10px.
    - Kind pill: height 20, `padding:0 7px`, radius 999, 10px/600 white, `flex:none`. "Start or sit" #07B85A, "Ranking" #0088FF, "List" `var(--x-ink,#1D1D1F)`.
    - Title 14px/600 with ellipsis; author handle 11px/500 t3.
  - **No results:** "No results", `padding:40px 0`, centred, 14px/500 t3.

#### 2.5 Dock on these screens (lines 627–644)
- **Match tab** (and every `scr === "league"` screen with no profile, trade builder or settings open): **league switcher plus tab bar**.
  - **Switcher wrapper:** `flex:none; position:relative; z-index:4; margin-top:-148px; padding:6px 8px`, bg `var(--x-dockA, rgba(29,29,31,.9))`. It is 68px tall and spans y 696–764.
  - **Switcher card:**
    - 56px tall (y 702–758), radius 10, `overflow:hidden`, bg `var(--x-mini,#3A3A3C)`.
    - `box-shadow:inset 0 0 0 1px var(--x-miniline,transparent)`, colour #fff.
    - `touch-action:none; user-select:none; cursor:grab`.
    - Grab handle: 28×3, radius 999, `rgba(255,255,255,.28)`, absolute at top 4px, centred.
  - **Content row** (translates with `ls.x`, fades with `ls.op`): `padding:6px 16px 0`, gap 10px.
    - League avatar 34×34, radius 10, bg `lg.av`, text `lg.avFg`, 12px/600 (e.g. "SF" on `var(--x-ink,#1D1D1F)`).
    - Team name 14px/600 white plus the record in 12px/500 `rgba(255,255,255,.62)` (e.g. "Touchdown Tacos 2-6"). Ellipsis.
    - League name 11px/500 at `rgba(255,255,255,.62)`, ellipsis.
    - Four dots: height 6, gap 4, 14px wide when active and 6px when inactive. Active `var(--x-b0,#fff)`, inactive #636366. `transition:width .2s linear`.
    - Up-chevron 14×14, stroke 2, path `M4 10l4-4 4 4`, colour `rgba(255,255,255,.62)`.
  - **Tab bar:** height 80px (y 764–844), `padding:6px 8px 0`, bg `var(--x-barA, rgba(29,29,31,.94))`, `position:relative; z-index:4`, `margin-top:0` (`barMt`). The scroller's bottom spacer is 150px.
- **Live feed** (`scr === "feed"`): **no switcher**. Tab bar only, with `margin-top:-80px` so it floats over the feed list. The scroller spacer is 84px.
- **Notifications and Messages** (reached from the header bell and bubble; also Transactions): `inLg` is true for any `scr` other than home, community or me (line 1708).
  - They show the **league tab bar** with **no tab highlighted**, no switcher, `margin-top:-80px`, and the `dock-sm` 84px spacer.
- **League tab bar items** (all of the screens above): 5 items, each `flex:1`, height 48px, flex column, centred, gap 3px, `cursor:pointer`.
  - Icon 22×22, viewBox 16, stroke 1.5, round caps and joins. Label 10px/600.
  - Colour: active **#fff**, inactive **#A1A1A6**.
  - Items:
    1. Match `M2.5 4.5h4v7h-4zM9.5 4.5h4v7h-4zM8 3v10`
    2. Team (`ICON.players`)
    3. Players (`ICON.search`)
    4. League (`ICON.leaders`: `M3 13V9h3v4M6.5 13V5h3v8M10 13V7.5h3V13`)
    5. Menu `M2.5 4h11M2.5 8h11M2.5 12h11`
  - Highlight rule: `s.scr === "league" && s.tab === v && s.sheet !== "menu"`. On the Match tab **Match** is highlighted. On the feed, Notifications and Messages **nothing** is highlighted. Menu is highlighted only while the menu sheet is open.
- **Home indicator:** see §2.0. It paints beneath the tab bar.

---

### 3. Interactions

#### 3.1 League header
| Element | Effect |
|---|---|
| Home button | `set({scr:"home", sheet:null})`. Goes to Home. `tab`, `mi`, `lg` and `week` are kept. |
| Search | `openGS` → `set({gs:{q:"", scope:"all"}})`. Opens the global search overlay, always reset to an empty query and the "All" scope. |
| Bell | `goNotifs` → `set({scr:"notifs", sheet:null, prevScr:"league"})`. Back on Notifications returns to `prevScr` with the last tab. |
| Messages | `goDms` → `set({scr:"dms", sheet:null, prevScr:"league"})`. |
| Logo, league name | Not interactive. |

**Badge lifecycle:**
- **Notification badge "3":**
  - Opening Notifications does **not** clear it.
  - Only "Mark all read" (14px/600 #0088FF, right of the Notifications header, `markRead`, lines 613 and 1854) sets `notifRead:true`, which hides the badge everywhere.
  - Inconsistency: the badge says 3 (`nUnread` is hard-coded, line 1700), while the Notifications list highlights **4** unread rows (`k < 4`, line 1853).
- **DM badge:**
  - It counts `true` values in `s.unread`.
  - Opening a conversation (`openConvo`, line 1703) sets `unread[id] = false`, so the badge drops by 1 for each of the conversations league, marcus and nina that is opened. It hides at 0.
  - Opening the Messages list alone does not change it.

#### 3.2 Matchup content: swipe mechanics (`mx`, lines 1728–1733)
Pointer handlers sit on the **whole Match tab container**, which has `touch-action:pan-y` (the browser keeps vertical scrolling) and `user-select:none`.

1. **pointerdown:** store `this._mx = {x: clientX, y: clientY, h: null}`. No pointer capture is used.
2. **pointermove** (ignored if `_mx` is null):
   - `dx = x − x0`, `dy = y − y0`.
   - **Axis lock:** while `h` is null, once `|dx| > 8` or `|dy| > 8`, set `h = |dx| > |dy|` (true means horizontal). The lock is kept for the rest of the gesture.
   - If horizontal: `mxAnim = false`, `mxDx = clamp(dx, −180, 180)`. The content follows the finger with no transition. If vertical, nothing happens.
   - Opacity while dragging: `max(.35, 1 − |mxDx|/320)`, which is 0.4375 at the 180px clamp.
3. **pointerup:**
   - If horizontal and `|dx| > 60` → `step(dx < 0 ? +1 : −1)`. Swipe left shows the **next** matchup; swipe right shows the **previous** one.
   - Otherwise, if `mxDx ≠ 0` → snap back (`mxAnim = true; mxDx = 0`) over 140ms linear.
4. **pointercancel** (including the browser taking over a vertical pan): snap back (`mxAnim = true; mxDx = 0`).
5. **`step(d)` animation:**
   1. `mxAnim = true; mxDx = d > 0 ? −160 : +160`. The content slides out in the swipe direction over **140ms**: `transition: transform .14s linear, opacity .14s linear`. Opacity reaches .5.
   2. After a 140ms `setTimeout`: `mi = (mi + d + 6) % 6`, which **wraps around** (from matchup 6 to 1 and from 1 to 6). Set `mxAnim = false` and jump to `mxDx = d > 0 ? +160 : −160`, the opposite side.
   3. After two `requestAnimationFrame` calls: `mxAnim = true; mxDx = 0`. The content slides in over 140ms linear.
   - There is no guard against a second swipe during the 140ms: `step` reads the `mi` captured at render time, so a second swipe before the timeout fires produces a net single step.
6. **Pager dots:** tapping dot k → `set({mi:k})` immediately, with no slide. The dot widths animate `width .2s linear`.
7. **Match in the tab bar:** its handler adds `mi: 0` whenever `v === "match" && s.tab === "match"` (line 1709). It does **not** check `scr`.
   - On the Match tab itself, it resets to your matchup instantly with no animation.
   - It also resets `mi` from the live feed, Notifications, Messages or Transactions **whenever `s.tab` is still "match"**. `goFeed`, `goNotifs` and `goDms` don't change `tab`, so opening the feed from the card and then tapping Match lands on **your** matchup. The feed's back chevron keeps the swiped matchup.
   - Tapping Match from Team, Players or League (or from a screen opened while one of those tabs was active) keeps `mi`.

**Edge cases and implementation notes:**
- **Horizontal overflow.** The swipe container sits in an `overflow-y:auto` scroller, so that scroller's `overflow-x` computes to `auto`. A rightward translate (up to +180px, and ±160px during `step`) creates horizontal scrollable overflow; the scrollbar is hidden. Set `overflow-x:hidden` (or `clip`) on the scroller.
- **No pointer capture.** With a mouse or pen, releasing outside the container (for example over the dock) never delivers `pointerup` to it. `_mx` stays set and `mxDx` stays offset, and later pointer moves over the tab, even with no button pressed, keep dragging. Touch pointers are implicitly captured by browsers, so this mainly affects desktop. Use `setPointerCapture` on pointerdown.
- **Click after drag.** The prototype doesn't suppress the click that can follow a drag. Because the content moves with the pointer, a mouse drag that starts on a team name, starter row or the live-play row can end on the same element and fire its tap. Suppress tap handlers when a horizontal drag was recognised.
- **Pager dot hit area.** The dots are 6×6 or 14×6 with no padding. Extend the hit area to the README's 30px minimum without changing the visual.

#### 3.3 Match tab tap targets
| Element | Effect |
|---|---|
| Team name (side A or B) | `e.stopPropagation(); openTeam(t.i)`. Touchdown Tacos (`i === 0`) → `set({scr:"league", tab:"team", teamView:null, tradeOpen:null})`, which is the Team tab. Any other team → `set({teamView: i})`, which opens the Team view overlay (z 21; its back chevron closes it). The avatar and score are **not** tappable. |
| Live-play row | `goFeed` → `set({scr:"feed", game:"min", gtab:"plays"})`. Opens the live feed on the **MIN @ NO** game, Play by play. The same for every matchup. |
| Week ‹ / › | `week = max(1, week−1)` / `min(17, week+1)`. **Only the label changes**; rows and scores stay the same. There is no disabled style at 1 or 17. |
| Starter row (either half) | `openProf(fullName)` → `set({prof:name, pfTab:"summary", pfYear:"2026", pfAvail:false})`. Opens the player profile overlay (z 22), which hides the switcher. |
| Empty starter half | `openP` is `() => {}`: no effect, although `cursor:pointer` remains. |
| Slot chip | Not interactive. |
| Pressed states | Live-play row bg `var(--x-b2,#EDEDF0)`. Week buttons bg `var(--x-b2,#F2F2F4)`. |

#### 3.4 Live game feed
| Element | Effect |
|---|---|
| Back chevron | `backLeague` → `set({scr:"league", tab:"match"})`. Returns to the Match tab; `mi` is kept. `game` is **not** reset (§3.5). |
| Game card | `set({game:id, gtab:"plays"})`. Selects the game and **always** resets to "Play by play", including when the already-selected card is tapped while on Box score. "My players" removes the game header and toggle. The body scroll position is **not** reset. |
| "Play by play" / "Box score" | `set({gtab})` |
| Play row, **My players** view | `set({game:<play's game>, gtab:"plays"})`, which jumps to that game's feed. Neither the body scroll nor the picker scroll is reset: the selected card (e.g. CHI) can stay off-screen in the picker. |
| Play row, single-game view | Same handler, so it is effectively a **no-op**. **There is no stat-detail view** (§7, Q1). |
| Box score player row | Toast "`<Full Name>` · player card" (e.g. "Joe Burrow · player card"). |
| Team-stats rows, headshots, header strip, field strip | Not interactive. |

#### 3.5 Live-play simulation (`livePlay`, lines 1403–1413; prototype only)
`componentDidMount` starts `setInterval(livePlay, 7000)`. It runs on **every screen**, and each tick calls `setState`, so the whole app re-renders at least every 7s.

**Each tick:**
- **Which game:** `gid = s.game` if a specific game is selected; otherwise a random game from cin, min and chi.
  - `s.game` **persists after leaving the feed**. After `goFeed` it stays "min", so every background tick from then on simulates MIN @ NO only, until the user picks "My players" again.
- **State:** `g = GAMES[gid]` merged with `s.gstate[gid]`. Pick a random entry from `POOL[gid]` as `[name, team, kind ("catch"/"rush"), avgYds, fpts]` (§5). The player is drawn from **either** team regardless of possession.
- **Yards:** `yds = max(1, round(avgYds × (0.4 + rand×1.2)))`.
- **Clock:** `clock = max(0, g.clock − 20 − floor(rand×25))` seconds. The quarter never advances and the clock stops at 0 ("Q4 0:00") forever.
- **Ball:** `ball = min(99, g.ball + yds)`. **A touchdown happens when `ball ≥ 99`.**
- **New game state:**
  - `clock` as above.
  - `ball`: 25 after a TD, else the new ball.
  - `down`: "Kickoff" after a TD, else a random choice of "1st & 10", "2nd & 6" or "3rd & 3".
  - `spot`: "Touchback" after a TD; otherwise `ball > 50 ? "<HOME> <100−ball>" : "<AWAY> <ball>"`.
  - On a TD the possessing team gets +7 and possession flips. Possession **only** flips on a TD.
- **New play,** prepended to `s.extra[gid]`, which grows without limit:
  - `sit` = "`{old down}` @ `{old spot}`".
  - `clock` = "Q`{q}` `{m:ss}`" (the new clock).
  - Title "`{first initial}`. `{rest of name}` `{yds}` yd `{TD }`catch|rush" (e.g. "J. Chase 9 yd catch" or "J. Chase 9 yd TD catch").
  - `l1` = "`{Full name}` · live".
  - Gain "+`{yds}` yd" (displayed in parentheses).
  - `l2` = "".
  - `yard` = the old ball position.
  - `fpts` is set **only if the POOL entry has fpts**: the POOL value, or "+`(yds/10+6).toFixed(1)`" on a TD.
  - `owner` = randomly "Touchdown Tacos" or "Gridiron Gurus" when `fpts` is set, else "".
  - `ts = Date.now()`.
- **Fresh highlight:** the "New" pill and bg `var(--x-gb2,#F5FAFF)` show while `Date.now() − ts < 20 000` at **render** time. They clear on the first render after 20s:
  - If idle, that is the next 7s tick, so 20s up to just under 27s.
  - Sooner, right after 20s, if any other state change re-renders (a pointer move on the Match tab, a tap, a toast).
  - The background then fades to b0 via `transition: background .4s linear`. There is no fade-in when a row appears.
- **Not updated by livePlay:**
  - The feed header strip (39.70 / 16.40 / 66%).
  - The Match card scores.
  - The live-play row on the card.

In the real product this is a realtime feed. Keep only the visual behaviour:
- New plays are prepended.
- The "New" pill shows for about 20s, and the row is tinted, then fades over .4s.
- Scores, clock, down, spot and field markers update.

#### 3.6 Global search
- **Typing:** `onChange` updates `gs.q`. Matching uses the trimmed, lower-cased query.
  - **Players:** the name contains the query, or the team abbreviation equals it. 5 results in "All", 30 in "Players".
    - Order is `PDB` insertion order: MINE, THEIRS, BENCH_ME, BENCH_THEM, TREND, AVAIL, LEAD, EXTRA, then the extra K/DST list (line 1220).
    - The owner label comes from `ownerOf(name, s)`, so "Your team" reflects the live edited `s.slots`/`s.bench`.
  - **People:** the handle plus sub-label contains the query. 4 results in "All", 30 in "People".
    - Order: the league managers in `TEAMS` order **excluding you** (`TEAMS.slice(1)`: @marcus, @priya, @devin, @sam, @tara, @leo, @nina, @chris, @owen, @maya, @raj; sub "`<team>` · your league").
    - Then `CMFEED` authors in order of first appearance, each with the `meta` of their first post: @shahranks "12k follows", @ortizff "8.4k follows", @halefantasy "3.2k follows", @kellyscouts "2.1k follows", @bellball "640 follows", @jordan "Half PPR", **@dalton (you) "Standard · Week 4"**, @kelly "PPR · Week 5", @fieldfilm "1.2k follows", @tightendtom "Half PPR · Week 5", @waiverwire "3.3k follows", @mom "Standard · Week 5", @rookieroom "920 follows".
  - **Posts:** title, author, tags and players/options contain the query. 4 results in "All", 30 in "Posts". Your own `s.cmMine` posts come first, then `CMFEED`.
- **Clear (×):** sets `q = ""`. Focus is not explicitly restored.
- **Cancel:** `gs = null`, back to the screen underneath with its state unchanged.
- **Scope chip:** sets the scope. Sections outside the scope are hidden.
- **Recent row or Trending chip:** sets `q` to its label.
- **Player result:** closes search, then `openProf(name)`.
- **Person result:** closes search.
  - A league member → `openTeam(ti)` (Team view overlay).
  - A community author → `set({scr:"community", cmTab:"all", cmQuery:handle, cmSearch:true})`.
- **Post result:** closes search, then:
  - Poll → `scr:"community", cmTab:"poll"`.
  - Ranking → navigates to `FieldScout Mobile Lists and Rankings.dc.html#view-<id>`.
  - List → `scr:"community", cmOpen:id`.

#### 3.7 League switcher (dock)
- **pointerdown:** store the start point, `setPointerCapture`, `lsAnim:false`.
- **pointermove:**
  - If `|dx| > |dy|`: `lsDx = clamp(dx, −140, 140)`, opacity `max(.2, 1−|lsDx|/200)`.
  - Otherwise, if `dy < −24`: open the "Switch league" sheet immediately, mid-move (`lsDx:0, sheet:"leagues"`).
- **pointerup:**
  - `|dx| > 50` and more horizontal than vertical → `step(±1)`. The content slides 120px out, jumps to the other side and slides in, 140ms linear each, wrapping through 4 leagues. The toast "Switched to `<team>`" fires **at release**, before the slide completes.
  - A tap (`|dx| < 8 && |dy| < 8`) or `dy < −24` → open the "Switch league" sheet.
  - Anything else (e.g. `8 ≤ |dx| ≤ 50`) → animated snap back (`lsAnim:true, lsDx:0`).
- **pointercancel:** animated snap back.
- **Effect:** switching league changes `lg.name` in the header and the switcher content. **Match tab data does not change** in the prototype (§7, Q10).

---

### 4. Navigation

**Ways to reach the Match tab**
- App start (initial state).
- Home league card "Sunday Funday League" → `scr:"league", tab:"match"`. `mi` is kept.
- League tab › Matchups row k → `set({tab:"match", mi:k})`. The card opens on that matchup.
- Tab bar "Match" from another league tab (keeps `mi`). Re-tapping it while `s.tab === "match"`, from any screen, resets to your matchup (`mi = 0`, §3.2 item 7).
- Live feed back chevron (keeps `mi`).
- Jump panel item 4, "Matchup" (presentation only).

**Ways to reach the live feed**
- Match card live-play row → game "min", Play by play.
- Jump panel item 12, "Live plays". This keeps the current `s.game`: initially "mine" (My players), but "min" after any earlier visit through the live-play row.

**Back and close**

| From | Action | Result |
|---|---|---|
| Live feed | Back chevron | Match tab (`mi` kept) |
| Live feed | Tab bar "Match" (when `tab` is "match") | Match tab on your matchup (`mi = 0`) |
| Global search | Cancel | The underlying screen, unchanged |
| Player profile | × (`closeProf`) | Match tab, with the switcher back |
| Team view | Back chevron | Match tab |
| Notifications / Messages | Back (`backFromDms`) | `prevScr` = "league" (last tab kept) |

**Tab bar from the feed, Notifications or Messages:** any league tab → `set({scr:"league", tab:v, sheet:null, swap:null})`, plus `mi:0` under the rule above. Menu toggles the Menu sheet over the current screen.

**Dock per screen**

| Screen | Dock | Highlighted |
|---|---|---|
| Match tab | Switcher plus league tab bar; 150px spacer | Match (#fff) |
| Live feed | League tab bar only, `margin-top:-80px`; 84px spacer | Nothing |
| Notifications / Messages | League tab bar only, `margin-top:-80px`; 84px spacer | Nothing |
| Overlays with `top:50px; bottom:0` (search, profile, team view, …) | Dock covered | n/a |

**Z-order** (all inside the 390×844 phone; the status bar is never covered):

| Layer | z-index |
|---|---|
| Content; home indicator (painted beneath the bar) | auto |
| Switcher and tab bar | 4 |
| Bottom sheets (backdrop `rgba(0,0,0,.32)`; README says `.4`) | 20 |
| Team view | 21 |
| Player profile | 22 |
| Settings / trade detail | 23 |
| Trade builder | 24 |
| League pages | 25 |
| Community detail | 26 |
| Composer | 27 |
| Player picker | 28 |
| **Global search** | **29** |
| Column tip and **toast** | 30 |

**Visibility rules**
- Switcher: shown only when `scr === "league"` and no profile, trade builder or settings is open. The Team view overlay does not hide it; it just covers it.
- `barMt`: "0" in that case, else "−80px".
- Scroller bottom spacer: `dock-lg` (150px) in the same case, else `dock-sm` (84px). This class is on the phone, so it also applies inside overlays such as global search.

---

### 5. Data shown

**Formatting helpers**
- `short(n)`:
  - Unchanged if the name ends in "D/ST" or its first token contains "." (so "A.J. Brown" and "J.J. McCarthy" stay as they are).
  - Otherwise "F. Rest": "Ja'Marr Chase" → "J. Chase", "DK Metcalf" → "D. Metcalf", "Ka'imi Fairbairn" → "K. Fairbairn".
- `mmss(t)` = `m:ss`.
- Game score = "`AWAY` `awayS`-`homeS` `HOME`".
- Streak = "▲" + stk if it ends in W (#07A852), else "▼" + stk (#FF0028).
- Win % is an integer followed by "%".
  - Win colour: ≥ 50 is #07B85A, otherwise #FF0028.
  - Side B shows 100 − A.
- Points and projections are strings with 2 decimals.
  - "-" (hyphen) means "not played yet" (t5).
  - An empty slot shows "–" (en dash). The Team tab converts "-" to "–"; the Match tab does not.
- Player team is shown as "TEAM (bye)". Position "DST" is shown as "D/ST".

**Matchups** (`MUPS` = [teamA, teamB, scoreA, projA, winA, scoreB, projB]; team data from `TEAMS` = name, @mgr, record, streak, rank, avatar colour). Index 0 is "your matchup". Avatar initial = first character of the team name.

| mi | A (score / proj / win) | B (score / proj / win) |
|---|---|---|
| 0 | Touchdown Tacos, @dalton 2-6 ▼2L, #0088FF: 39.70 / 83.44 / 66% | Gridiron Gurus, @marcus 8-0 ▲8W, `var(--x-ink,#1D1D1F)`: 16.40 / 73.01 / 34% |
| 1 | Priya's Punters, @priya 7-1 ▲3W, #9D70E9: 59.70 / 71.52 / 23% | Leo's Lions, @leo 4-4 ▲2W, #07A852: 33.42 / 86.98 / 77% |
| 2 | Blitz Brigade, @tara 5-3 ▼2L, #5C7CE5: 85.60 / 117.99 / 90% | Sam's Sleepers, @sam 6-2 ▼2L, #ECAD48: 31.90 / 85.21 / 10% |
| 3 | Hail Marys, @nina 3-5 ▼3L, #FF8A00: 54.74 / 63.79 / 2% | End Zone Elite, @devin 6-2 ▲6W, #F75252: 54.50 / 113.74 / 98% |
| 4 | Fourth & Long, @chris 3-5 ▲1W, `var(--x-t2,#3A3A3C)`: 41.50 / 90.91 / 19% | Red Zone Rebels, @owen 3-5 ▼1L, #00A6A3: 89.10 / 111.23 / 81% |
| 5 | Maya's Mavericks, @maya 2-6 ▲1W, #E5508A: 62.30 / 88.10 / 58% | Raj's Rushers, @raj 1-7 ▼5L, `var(--x-t3,#6E6E73)`: 48.20 / 80.40 / 42% |

**Starters for mi 0** (`MINE` vs `THEIRS`; points / projection / game):

| Slot | A: Touchdown Tacos | B: Gridiron Gurus |
|---|---|---|
| QB | S. Sanders, QB · CLE (9): - / 19.71 / Sun 1:00 PM vs DET | J. Allen, QB · BUF (7): - / 22.23 / Mon 8:15 PM @ LAR |
| RB | B. Robinson, RB · ATL (5): 9.60 / 16.03 / W 19-17 vs PHI | A. Kamara, RB · NO (11): - / 10.80 / Sun 1:00 PM vs NYG |
| RB | J. Conner, RB · ARI (8): - / 13.88 / Mon 8:15 PM @ LAR | J. Wright, RB · MIA (12): 12.20 / 9.45 / L 16-24 vs TB |
| WR | A.J. Brown, WR · PHI (9): - / 12.59 / Sun 4:25 PM vs SF | D. Mooney, WR · ATL (5): - / 9.24 / Sun 1:00 PM vs SEA |
| WR | J. Williams, WR · DET (8): 26.30 / 11.40 / Final W 31-20 @ GB | A. Mitchell, WR · IND (11): 2.60 / 8.10 / Q3 2:10 vs TEN |
| TE | E. Engram, TE · DEN (12): - / 8.24 / Sun 4:05 PM vs KC | C. Kmet, TE · CHI (5): - / 6.80 / Sun 4:25 PM @ GB |
| FLEX | I. Pacheco, RB · KC (10): 4.10 / 9.90 / Q4 6:50 @ DEN | B. Allen, RB · NYJ (9): 1.60 / 7.30 / Q4 9:12 vs NE |
| K | J. Bates, K · DET (8): - / 8.10 / Final W 31-20 @ GB | B. Aubrey, K · DAL (10): - / 8.70 / Sun 8:20 PM @ PHI |
| D/ST | Steelers D/ST, D/ST · PIT (5): - / 6.00 / Sun 1:00 PM vs CLE | Ravens D/ST, D/ST · BAL (7): - / 7.00 / Sun 1:00 PM vs CIN |

**Starters for mi 1–5** are generated by `lineupOf(ti, usedMx)` (lines 1632–1634).
- **Algorithm:**
  1. Shuffle `rosterOf(ti)` (the team's TREND/LEAD players plus 11 seeded picks from `EXTRA`) with `seeded("team"+ti)`, then shuffle all `PDB` names.
  2. For each slot, take the first eligible unused player from the roster, falling back to all players.
  3. Points come from `seeded(name+"wk5"+ti)`: 45% get `rand×22+1`, otherwise "-". Projection is `rand×12+6`.
  4. The game is the player's `PDB` game string, or "Sun 1:00 PM" when that is empty. LEAD, EXTRA and the extra K/DST players have the literal "Sun 1:00 PM".
- The result is **deterministic**; it is the same on every load. Values (points / projection / game; the game is "Sun 1:00 PM" unless shown):

| Slot | mi 1 A: Priya's Punters | mi 1 B: Leo's Lions |
|---|---|---|
| QB | B. Mayfield, QB · TB (9): - / 13.29 | J. Hurts, QB · PHI (9): 12.09 / 12.84 |
| RB | K. Williams, RB · LAR (8): 18.03 / 7.50 | J. Hill, RB · BAL (7): 22.68 / 10.23 / Sun 1:00 PM vs CIN |
| RB | C. Hubbard, RB · CAR (14): - / 15.85 | R. Johnson, RB · CHI (10): - / 8.85 / Final L 7-31 @ GB |
| WR | G. Wilson, WR · NYJ (9): - / 13.29 | C. Sutton, WR · DEN (12): 18.46 / 8.05 |
| WR | Z. Flowers, WR · BAL (7): - / 9.80 | P. Nacua, WR · LAR (8): - / 7.83 |
| TE | D. Kincaid, TE · BUF (7): 5.85 / 7.27 / Mon 8:15 PM @ LAR | T. Kelce, TE · KC (10): - / 16.92 |
| FLEX | J. Taylor, RB · IND (11): 10.10 / 6.73 | J. Dotson, WR · PHI (9): 1.61 / 14.58 / Sun 4:25 PM vs SF |
| K | H. Butker, K · KC (10): 22.39 / 17.03 | K. Fairbairn, K · HOU (6): - / 15.34 |
| D/ST | Eagles D/ST, D/ST · PHI (9): 21.62 / 15.98 | Bills D/ST, D/ST · BUF (7): - / 16.43 |

| Slot | mi 2 A: Blitz Brigade | mi 2 B: Sam's Sleepers |
|---|---|---|
| QB | B. Mayfield, QB · TB (9): - / 16.66 | J. Hurts, QB · PHI (9): - / 17.80 |
| RB | J. Taylor, RB · IND (11): - / 14.34 | C. Hubbard, RB · CAR (14): 8.50 / 6.79 |
| RB | J. Blue, RB · DAL (10): 9.42 / 7.85 / Sun 8:20 PM @ PHI | K. Williams, RB · LAR (8): - / 9.54 |
| WR | P. Nacua, WR · LAR (8): - / 10.71 | G. Wilson, WR · NYJ (9): 3.81 / 13.87 |
| WR | D. Metcalf, WR · PIT (5): 9.77 / 16.93 | Z. Flowers, WR · BAL (7): 19.42 / 7.20 |
| TE | T. Kelce, TE · KC (10): - / 7.80 | T. Warren, TE · IND (11): 1.66 / 7.77 / Q3 2:10 vs TEN |
| FLEX | G. Kittle, TE · SF (14): 3.25 / 8.11 | R. Johnson, RB · CHI (10): 16.77 / 14.81 / Final L 7-31 @ GB |
| K | H. Butker, K · KC (10): - / 9.04 | J. Myers, K · SEA (8): 11.72 / 7.90 |
| D/ST | Eagles D/ST, D/ST · PHI (9): - / 8.62 | Vikings D/ST, D/ST · MIN (6): - / 12.41 |

| Slot | mi 3 A: Hail Marys | mi 3 B: End Zone Elite |
|---|---|---|
| QB | D. Prescott, QB · DAL (10): - / 15.31 | B. Mayfield, QB · TB (9): 9.08 / 15.78 |
| RB | J. Taylor, RB · IND (11): 5.74 / 12.85 | S. Tucker, RB · TB (9): 8.15 / 8.28 / Final W 24-16 @ DAL |
| RB | C. Hubbard, RB · CAR (14): 14.68 / 12.86 | K. Williams, RB · LAR (8): - / 12.41 |
| WR | Z. Flowers, WR · BAL (7): 3.60 / 13.27 | D. Metcalf, WR · PIT (5): - / 16.53 |
| WR | C. Sutton, WR · DEN (12): 13.18 / 14.08 | P. Nacua, WR · LAR (8): 20.18 / 7.12 |
| TE | T. Kelce, TE · KC (10): 15.75 / 6.03 | G. Kittle, TE · SF (14): - / 12.98 |
| FLEX | G. Wilson, WR · NYJ (9): - / 10.90 | J. Hill, RB · BAL (7): 16.50 / 16.16 / Sun 1:00 PM vs CIN |
| K | H. Butker, K · KC (10): 18.02 / 11.15 | C. Dicker, K · LAC (12): - / 13.31 |
| D/ST | Jets D/ST, D/ST · NYJ (9): - / 10.22 | Eagles D/ST, D/ST · PHI (9): 16.34 / 10.00 |

| Slot | mi 4 A: Fourth & Long | mi 4 B: Red Zone Rebels |
|---|---|---|
| QB | J. Hurts, QB · PHI (9): - / 6.30 | B. Mayfield, QB · TB (9): - / 17.15 |
| RB | C. Hubbard, RB · CAR (14): 9.41 / 6.88 | T. Allgeier, RB · ATL (5): - / 7.65 / W 19-17 vs PHI |
| RB | J. Taylor, RB · IND (11): - / 17.71 | J. Blue, RB · DAL (10): 10.32 / 7.94 / Sun 8:20 PM @ PHI |
| WR | Z. Flowers, WR · BAL (7): 20.33 / 7.29 | P. Nacua, WR · LAR (8): - / 11.20 |
| WR | G. Wilson, WR · NYJ (9): 4.72 / 13.96 | C. Sutton, WR · DEN (12): - / 6.89 |
| TE | G. Kittle, TE · SF (14): - / 10.60 | D. Kincaid, TE · BUF (7): - / 12.51 / Mon 8:15 PM @ LAR |
| FLEX | T. Kelce, TE · KC (10): 10.48 / 12.05 | J. Dotson, WR · PHI (9): 7.79 / 8.65 / Sun 4:25 PM vs SF |
| K | H. Butker, K · KC (10): - / 12.41 | J. Myers, K · SEA (8): - / 9.46 |
| D/ST | Eagles D/ST, D/ST · PHI (9): - / 11.99 | Lions D/ST, D/ST · DET (8): 13.76 / 6.61 |

| Slot | mi 5 A: Maya's Mavericks | mi 5 B: Raj's Rushers |
|---|---|---|
| QB | B. Mayfield, QB · TB (9): - / 17.05 | J. Herbert, QB · LAC (12): - / 11.93 / Sun 1:05 PM vs DEN |
| RB | K. Williams, RB · LAR (8): - / 7.10 | C. Hubbard, RB · CAR (14): - / 9.52 |
| RB | J. Taylor, RB · IND (11): 21.36 / 16.21 | J. Blue, RB · DAL (10): - / 6.11 / Sun 8:20 PM @ PHI |
| WR | C. Sutton, WR · DEN (12): 10.22 / 6.34 | G. Wilson, WR · NYJ (9): 15.95 / 14.01 |
| WR | Z. Flowers, WR · BAL (7): 21.21 / 17.19 | P. Nacua, WR · LAR (8): 7.95 / 15.45 |
| TE | T. Kelce, TE · KC (10): - / 6.49 | G. Kittle, TE · SF (14): - / 9.82 |
| FLEX | D. Metcalf, WR · PIT (5): 17.35 / 12.27 | T. Warren, TE · IND (11): - / 13.75 / Q3 2:10 vs TEN |
| K | H. Butker, K · KC (10): - / 8.89 | Y. Koo, K · ATL (5): - / 13.64 |
| D/ST | Eagles D/ST, D/ST · PHI (9): - / 7.80 | Broncos D/ST, D/ST · DEN (12): 13.66 / 8.78 |

**Placeholder artefacts in these lineups** (do not copy into production):
- **Repeated players.** `usedMx` (line 1634) excludes only the `MINE`/`THEIRS` starters and is rebuilt for each matchup, so the same players recur across matchups:
  - B. Mayfield starts at QB in every one of mi 1–5.
  - H. Butker is side A's K in all five.
  - Eagles D/ST appears in all five.
- **Bench players on other teams.** Your bench players (D. Kincaid, J. Dotson, T. Allgeier) and Gridiron Gurus' bench player T. Warren appear in other teams' starting lineups. The Team tab's `teamRoster` excludes the bench arrays, but `usedMx` does not.
- **Starter points don't match card scores:**

  | Matchup | Side A: starters / card | Side B: starters / card |
  |---|---|---|
  | mi 0 | 40.00 / 39.70 | 16.40 / 16.40 |
  | mi 1 | 77.99 / 59.70 | 54.84 / 33.42 |
  | mi 2 | 22.44 / 85.60 | 61.88 / 31.90 |
  | mi 3 | 70.97 / 54.74 | 70.25 / 54.50 |
  | mi 4 | 44.94 / 41.50 | 31.87 / 89.10 |
  | mi 5 | 70.14 / 62.30 | 37.56 / 48.20 |

- **Constant lineup.** The Match tab reads the **constant** `MINE`, not the user's edited lineup from the Team tab (`s.slots`).
- **In production,** every field is real league data: team, manager, record, streak, live score, projection, win probability, lineup, and each player's points, projection and game status.

**Bench data** (not rendered on the Match tab; use it only if a Bench section is built, §7, Q3):

| | Player, POS · TEAM (bye) | pts / proj | Game |
|---|---|---|---|
| BENCH_ME (Touchdown Tacos) | Kendrick Bourne, WR · ARI (8) | - / 5.10 | Sun 1:00 PM vs DET |
| | Tyler Allgeier, RB · ATL (5) | 3.20 / 6.80 | W 19-17 vs PHI |
| | Jahan Dotson, WR · PHI (9) | - / 4.20 | Sun 4:25 PM vs SF |
| | Rhamondre Stevenson, RB · NE (14) | - / 8.10 | Sun 1:00 PM vs NO |
| | Dalton Kincaid, TE · BUF (7) | - / 7.60 | Mon 8:15 PM @ LAR |
| BENCH_THEM (Gridiron Gurus) | Jordan Mason, RB · MIN (6) | - / 9.10 | Sun 1:00 PM vs CLE |
| | Khalil Shakir, WR · BUF (7) | - / 9.80 | Mon 8:15 PM @ LAR |
| | Rome Odunze, WR · CHI (5) | - / 10.20 | Sun 4:25 PM @ GB |
| | Tyler Warren, TE · IND (11) | - / 8.90 | Q3 2:10 vs TEN |
| | Justin Fields, QB · NYJ (9) | - / 14.60 | Q4 9:12 vs NE |

The initial `s.bench` also has a sixth, empty slot (`null`).

**Game status strings** (the starter row "game" field):
- Pre-game: "Sun 1:00 PM vs DET", "Mon 8:15 PM @ LAR", or the bare "Sun 1:00 PM".
- In progress: "Q4 6:50 @ DEN".
- Final: "Final W 31-20 @ GB", "Final L 7-31 @ GB", or the short form "W 19-17 vs PHI" / "L 16-24 vs TB".

**Live feed games** (`GAMES`):

| Game | Score | Clock | Down / spot | Ball | Possession | Records | Network |
|---|---|---|---|---|---|---|---|
| cin | CIN (#FB4F14) 28 @ MIA (#008E97) 18 | Q4 2:19 (139s) | 2nd & 9, MIA 9 | 91 | away | 3-2 / 1-4 | FOX |
| min | MIN (#4F2683) 23 @ NO (#B5945B) 13 | Q4 6:05 (365s) | 2nd & 7, NO 44 | 56 | home | 4-1 / 1-4 | CBS |
| chi | CHI (#0B162A) 7 @ GB (#203731) 31 | Q4 12:00 (720s) | 1st & 10, CHI 31 | 69 | home | 2-3 / 4-1 | FOX |

Team tile colours come from `GAMES`. NO is #B5945B there, which differs from the headshot ring map's #D3BC8D.

**Static plays** (`GPLAYS`, lines 1171–1173; listed in data order, newest game-clock first):

| Game | Player (team) | Situation | Clock | Title | l1 | Gain | l2 | Yard | fpts · owner |
|---|---|---|---|---|---|---|---|---|---|
| cin | Ja'Marr Chase (CIN) | 2nd & 9 @ MIA 9 | Q4 2:19 | J. Chase 14 yd catch | Ja'Marr Chase WR · 9/11 rec, 132 yd | +14 yd | Joe Burrow QB · 24/31, 288 yd | 91% | none |
| cin | De'Von Achane (MIA) | 3rd & 2 @ MIA 38 | Q4 3:02 | D. Achane 4 yd rush | De'Von Achane RB · 14 car, 71 yd | +4 yd | (empty) | 38% | +0.4 · Raj's Rushers (red) |
| cin | Joe Burrow (CIN) | 1st & 10 @ CIN 40 | Q4 4:11 | J. Burrow 22 yd pass to T. Higgins | Tee Higgins WR · 5/7 rec, 74 yd | +22 yd | Joe Burrow QB · 23/30, 274 yd | 40% | none |
| min | Devaughn Vele (NO) | 2nd & 7 @ NO 44 | Q4 6:05 | D. Vele 9 yd catch | D. Vele WR · 4/6 rec, 26 yd | +9 yd | T. Shough QB · 13/19, 80 yd | 56% | +0.9 · Touchdown Tacos (green) |
| min | Devaughn Vele (NO) | 1st & 10 @ NO 41 | Q4 6:37 | D. Vele 3 yd catch | D. Vele WR · 3/5 rec, 17 yd | +3 yd | T. Shough QB · 12/18, 71 yd | 52% | +0.3 · Touchdown Tacos (green) |
| min | Justin Jefferson (MIN) | 3rd & 4 @ NO 28 | Q4 8:40 | J. Jefferson 17 yd catch | Justin Jefferson WR · 7/9 rec, 104 yd | +17 yd | J.J. McCarthy QB · 19/27, 231 yd | 72% | none |
| chi | Christian Watson (GB) | 1st & 10 @ CHI 31 | Q4 12:00 | C. Watson 2 yd catch | C. Watson WR · 6/8 rec, 143 yd | +2 yd | J. Love QB · 23/29, 352 yd | 72% | +0.2 · Touchdown Tacos (green) |
| chi | Christian Watson (GB) | 3rd & 22 @ GB 47 | Q3 13:19 | C. Watson 53 yd TD catch (TD styling) | C. Watson WR · 4/6 rec, 131 yd, 2 TD | +53 yd | J. Love QB · 15/18, 193 yd, 2 TD | 100% | +11.3 · Touchdown Tacos (green) |
| chi | Roschon Johnson (CHI) | 2nd & 6 @ CHI 22 | Q3 14:02 | R. Johnson 8 yd rush | Roschon Johnson RB · 9 car, 44 yd | +8 yd | (empty) | 30% | +0.8 · Gridiron Gurus (red) |

- **Single game:** live extras (newest first), then that game's static plays in the order above. Every play is shown; the owner row appears only when `fpts` is set.
- **My players:** only plays **with fpts** from all games, each with the current game score added (e.g. "MIN 23-13 NO"). They are sorted by `ts` descending. Live plays come first; static plays have `ts` 0 and keep the order cin, min, chi:
  1. Achane
  2. Vele 9 yd
  3. Vele 3 yd
  4. Watson 2 yd
  5. Watson TD
  6. R. Johnson
- **Fantasy-point colour:** green only when `owner` is the literal string "Touchdown Tacos"; any other owner is red.
- **Static copy:** "3 live games" and "Following 14 players".
- **Data inconsistency:** Vele (NO) and Watson (GB) are credited to Touchdown Tacos in the feed, but neither is on `MINE` or `BENCH_ME`.

**Live-play pool** (`POOL`, lines 1175–1179: player, team, kind, avgYds, fpts). Entries with no fpts produce plays without an owner row, which are therefore hidden in My players.

| Game | Player | Team | Kind | avgYds | fpts |
|---|---|---|---|---|---|
| cin | Ja'Marr Chase | CIN | catch | 8 | +0.8 |
| cin | Chase Brown | CIN | rush | 5 | none |
| cin | De'Von Achane | MIA | rush | 6 | +0.6 |
| cin | Tyreek Hill | MIA | catch | 12 | none |
| min | Justin Jefferson | MIN | catch | 11 | none |
| min | Aaron Jones | MIN | rush | 4 | none |
| min | Alvin Kamara | NO | rush | 5 | +0.5 |
| min | Devaughn Vele | NO | catch | 7 | +0.7 |
| chi | Christian Watson | GB | catch | 9 | +0.9 |
| chi | Josh Jacobs | GB | rush | 6 | none |
| chi | Roschon Johnson | CHI | rush | 3 | +0.3 |
| chi | DJ Moore | CHI | catch | 10 | none |

**Box score** (`BOX`, lines 1180–1184; the fallback is `BOX.cin`).
- **Team stats** (`BOX.team` gives away/home pairs). Weight 600 marks the better side: higher wins, except Turnovers, where lower wins. Ties are 500 on both sides. "3rd down" (e.g. "7/12") and "Possession" ("33:12") are never bolded, because the numeric compare gives NaN.

  | Stat | cin: CIN / MIA | min: MIN / NO | chi: CHI / GB |
  |---|---|---|---|
  | Total yards | 412 / 296 | 341 / 214 | 229 / 468 |
  | Passing | 288 / 201 | 231 / 80 | 168 / 352 |
  | Rushing | 124 / 95 | 110 / 134 | 61 / 116 |
  | First downs | 24 / 17 | 21 / 14 | 13 / 26 |
  | 3rd down | 7/12 / 4/11 | 6/11 / 3/10 | 3/12 / 8/13 |
  | Turnovers | 0 / 2 | 0 / 1 | 2 / 0 |
  | Possession | 33:12 / 26:48 | 31:40 / 28:20 | 24:51 / 35:09 |

- **Player groups** (rows in data order, no sorting; name cell = `short(name) · TEAM`):

  | Game | Passing (C/Att, Yds, TD, Int) | Rushing (Car, Yds, TD) | Receiving (Rec, Yds, TD) |
  |---|---|---|---|
  | cin | J. Burrow · CIN 24/31, 288, 2, 0; T. Tagovailoa · MIA 19/28, 201, 1, 1 | C. Brown · CIN 16, 64, 1; D. Achane · MIA 14, 71, 0 | J. Chase · CIN 9, 132, 1; T. Higgins · CIN 5, 74, 1; T. Hill · MIA 6, 88, 0 |
  | min | J.J. McCarthy · MIN 19/27, 231, 1, 0; T. Shough · NO 13/19, 80, 0, 1 | A. Jones · MIN 15, 68, 1; A. Kamara · NO 12, 49, 1 | J. Jefferson · MIN 7, 104, 1; J. Addison · MIN 4, 61, 0; D. Vele · NO 4, 26, 0 |
  | chi | C. Williams · CHI 17/30, 168, 0, 2; J. Love · GB 23/29, 352, 3, 0 | R. Johnson · CHI 9, 44, 0; J. Jacobs · GB 18, 86, 1 | D. Moore · CHI 5, 62, 0; C. Watson · GB 6, 143, 2; T. Kraft · GB 5, 71, 1 |

- The toast on tap uses the **full** name, e.g. "Tua Tagovailoa · player card".

**Headshots** (`FSHeadshot.dc.html`)
- **Ring:**
  - `0 0 0 1px #fff, 0 0 0 (1+rw)px <team colour>`, where rw = 2 at size ≥ 32, else 1.5.
  - For a team not in the map: `inset 0 0 0 1px rgba(0,0,0,.04)`.
- **Root:** circle, `overflow:hidden`, bg #EEEEF1, `title` = player name (a hover tooltip).
- **Photo:** `object-fit:cover; object-position:50% 15%; transform:scale(1.25) translateY(8%)`. An image `onError` falls back to initials.
- **Fallback initials:**
  - A trailing " D/ST" is stripped first. The name is split on spaces, apostrophes and hyphens, and the initials are the first and last parts (e.g. "Ja'Marr Chase" → "JC").
  - Weight 700, #6E6E73, font size `max(9, round(size×.36))`: 12px at size 32 and 34, 14px at size 40.
- **Mapped photos in the feed** (`HEAD`, line 1127):
  - Static plays: only **Roschon Johnson** (`johnson.jpg`).
  - Live plays: **Alvin Kamara** (`kamara.jpg`, from `POOL.min`).
  - `watson.jpg` exists in `assets/headshots` but is not mapped, so Watson shows "CW".
  - The box score has no headshots.

**Team-rename edge case:**
- Saving team settings (line 1792) mutates `TEAMS[0].name`, `.av` and `.ini` and `LEAGUES[0].team`. The Match card's side A and the switcher (when `lg` is 0) update.
- The feed does **not** update:
  - The header strip hard-codes "Touchdown Tacos" (line 461).
  - `GPLAYS` and `livePlay` owners are fixed "Touchdown Tacos" / "Gridiron Gurus" strings.
- So after a rename the feed keeps showing the old name. The green colour is unchanged, because the comparison `owner === "Touchdown Tacos"` is between two hard-coded strings.
- In production, the owner and "is mine" must come from the user's team id.

**Placeholder vs real data**
- **Real product data:**
  - Everything in the feed (games, plays, situations, box score).
  - Badges (unread counts).
  - League and team names.
  - The matchup card and lineups.
- **Static or placeholder copy:**
  - The card's live-play row: "Q4 6:50 · 2nd & 7 @ NO 44", "D. Vele 9 yd catch", "+0.9".
  - The "Yet to play" line.
  - The feed header strip (39.70 / 16.40 / 66%).
  - "3 live games" and "Following 14 players".
- **Field-position math** in the prototype ignores drive direction. For example, the initial "CHI 31" for chi contradicts the formula, which gives "GB 31" for ball 69.

---

### 6. Dark mode (`.fs-dark`; theme stored in `localStorage["fieldscout-theme"]`)

Variables used in this area:

| Var | Dark | Light fallback(s) used here |
|---|---|---|
| --x-t1 | #FFFFFF | #1D1D1F (body text, status bar text and icons, header icons, play clock) |
| --x-t2 | #D9D9D9 | #3A3A3C (field label, team-stat labels, Fourth & Long avatar) |
| --x-t3 | #B3B3B3 | #6E6E73 (meta text, Raj's Rushers avatar) |
| --x-t4 | #A7A7A7 | #8E8E93 (search icons) |
| --x-t5 | #727272 | #AEAEB2 (chevron, "-" points, empty-slot pts) |
| --x-b0 | #121212 | #fff (page, "vs" circle, selected segment, yard knob, badge ring, search panel, **home indicator**) |
| --x-b1 | #282828 | #F5F5F7 (match card, game cards, play pressed) |
| --x-b2 | #333333 | #F2F2F4 / #EDEDF0 (row dividers, segmented track, search field, chips, pressed states) |
| --x-b3 | #3E3E3E | #EBEBEE / #E5E5EA (header border, win-bar and yard-bar tracks, live-row divider, table header borders) |
| --x-b4 | #575757 | #D1D1D6 (inactive pager dot) / #AEAEB2 (search clear button) |
| --x-ink | #4D4D4D | #1D1D1F (active pager dot, FLEX chip, ball line, selected scope chip, Gridiron Gurus avatar, **"SF" league avatar in the switcher**, **search "List" pill**, toast, box name cells) |
| --x-gg | #12301F | #E3F9EC (field strip) |
| --x-gb | #12263F | #E6F2FF (selected game card) |
| --x-gb2 | #16212E | #F5FAFF (fresh play row) |
| --x-mini | #090909 | #3A3A3C (switcher card) |
| --x-miniline | transparent | transparent |
| --x-dockA | rgba(18,18,18,.86) | rgba(29,29,31,.9) |
| --x-barA | rgba(18,18,18,.92) | rgba(29,29,31,.94) |
| --x-dockpad | 150px / 84px (both themes) | |

`color-scheme: dark` is also set on the phone, and on inputs and textareas.

**Not themed** (identical in dark mode):
- Accent and status colours: #0088FF, #07B85A, #07A852 (success text; the README's dark #1ED760 is **not** applied here), #FF0028, #5C7CE5, #ECAD48.
- The slot chip colours and the team tile colours.
- The "New" and "TD" pills.
- The tab bar's #fff / #A1A1A6.
- The switcher's `rgba(255,255,255,.62)`, #636366 and `.28` handle.
- The headshot's #fff gap and #EEEEF1 / #6E6E73 fallback.
- The search input placeholder #6E6E73 (global rule, line 17).
- The Dynamic Island #000.

**Dark-mode defects as written** (confirm before copying, §7, Q8):
- The active pager dot (ink #4D4D4D) is barely distinguishable from inactive dots (b4 #575757).
- The switcher's active dot (b0 #121212) is nearly invisible on #090909.
- The "SF" league avatar is #4D4D4D on the #090909 card.
- The yard-bar end zone stays #FDE4E4 (bright pink).
- Box-score numbers are hard-coded #3A3A3C and names use ink #4D4D4D, giving dark text on a #121212 background.
- Team avatars that use `var(--x-t2)` or `var(--x-t3)` become light grey (#D9D9D9 / #B3B3B3) under white initials.
- The search "List" pill becomes #4D4D4D with white text.
- The placeholder stays #6E6E73 on the #333333 field.
- The home indicator is #121212. It sits beneath the bar in both themes anyway (§2.0).

---

### 7. Open questions (README vs prototype, and undesigned states)

Each needs a ruling before build. The recommendation describes what the prototype or README implies; it is not a decision.

- **Q1. Tapping a play.**
  - README: "Live game feed: Play-by-play; plays open stat detail."
  - Prototype: a play row only runs `set({game, gtab:"plays"})` (`toPlay.open`, line 1675). In My players that jumps to the game; in single-game view it does nothing. No stat-detail view exists.
  - *Recommendation:* follow the FieldScout rule that every player click opens the mini card first (Expand opens the full profile), and ask whether a separate stat-detail sheet is wanted.
- **Q2. Box-score player rows and Match starter rows.**
  - Box-score rows only toast "`<Name>` · player card". Starter rows open the full profile overlay directly.
  - *Recommendation:* both open the mini player card first, per the same rule.
- **Q3. Bench on the Match tab.**
  - README: "Starters/Bench with week navigation."
  - Markup: lines 279–298 render only Starters.
  - If a Bench is wanted, the data for mi 0 is the `BENCH_ME` / `BENCH_THEM` table in §5. For mi 1–5 it would need generating (the Team view's `teamRoster` already does this). It also needs a design for the BN slot chip; `POS.BN` = `var(--x-b2,#EDEDF0)` with #1D1D1F text is what the Team tab uses.
- **Q4. Week navigation.**
  - ‹ / › only change the "Week N" label (clamped 1–17, no disabled state).
  - Should changing week load that week's matchup, lineups and scores?
  - Should the range be 1–18, to match the 18-week season used elsewhere in the prototype (`genSeason`)?
- **Q5. Static content.**
  - The card's live-play row (D. Vele), the "Yet to play: 4 · QB, RB, WR, D/ST / Yet to play: 5" line and the feed header strip (Touchdown Tacos 39.70 vs Gridiron Gurus 16.40, 66%) are static and don't follow the swiped matchup.
  - Should they reflect the selected matchup? Which play should the card show (for example, the latest play involving either roster)?
- **Q6. Live-play row target.**
  - It always opens the feed on MIN @ NO.
  - Should it open the game of the play shown, or the "My players" view?
- **Q7. Play reactions and comments.**
  - The unused `PLAYS` constant has reaction counts and comments (e.g. Priya: "Please, Shough, I need a pass TD"). Fire, laugh and clap icons and a `reacts` state exist but are never rendered.
  - Are play reactions and comments intended for the feed?
- **Q8. Dark-mode contrast.**
  - The defects are listed in §6.
  - Copy them exactly, or fix them? The FieldScout app is moving to a single blended theme with no dark/light toggle.
- **Q9. Smaller README conflicts:**

  | Item | Prototype | README |
  |---|---|---|
  | Toast auto-dismiss | 1800 ms (line 1624) | "about 2.2s" |
  | Sheet backdrop | `rgba(0,0,0,.32)` (line 647) | `.4` |
  | Segmented "on" shadow | `0 1px 3px rgba(0,0,0,.12)` (line 1746) | `0 1px 2px` |
  | Slot chip radius | 8px | position chips 4–5px |

  Which wins in each case?
- **Q10. League switch scope.**
  - Switching league via the switcher changes only the header and the switcher; Match content stays as Sunday Funday data.
  - Confirm the Match tab should fully re-scope to the selected league and team.
- **Q11. Home indicator.**
  - It paints beneath the tab bar and is effectively invisible (§2.0).
  - Should it sit above the bar? A real app usually leaves this to the OS.
- **Q12. Undesigned feed states.**
  - Pre-game, halftime, final (the clock currently freezes at "Q4 0:00" with the live dot still on), no live games, loading, error, and "N new plays" when those plays are hidden from My players.
  - These need the design language extended.
- **Q13. Sample-data inconsistencies** (not to be copied):
  - Vele and Watson are credited to Touchdown Tacos but are not on its roster.
  - Bench players appear in other teams' Match lineups.
  - Card scores don't equal the starter totals.
  - The notification badge says 3 while 4 rows are highlighted as unread.
  - The field spot ignores drive direction.


---

### Open questions
- Critic correction (partially disproved): the ERRORS/OMISSIONS item 'after a team rename every fantasy-point value in the feed turns red' does not hold. fptsC compares `owner === "Touchdown Tacos"` (line 1675) against GPLAYS/livePlay owners that are the same hard-coded string, and neither side reads TEAMS[0].name. After a rename the feed keeps the old name and stays green. The valid part of that finding (the feed does not follow a rename) is incorporated in §5.
- Critic nuance: 'releasing outside the container never fires pointerup' applies to mouse and pen only. Browsers implicitly capture touch pointers, so on a phone pointerup still reaches the container. The spec keeps the recommendation to call setPointerCapture.
- Critic nuance: the home indicator is not 'barely visible in light mode' but effectively invisible in both themes. It is #fff under a 94%-opaque dark bar over a mostly white page, so it adds no visible contrast.
- Critic nuance: 'tapping Match from the feed, Notifications, Messages or Transactions also jumps back to mi 0' holds only while s.tab is still "match". If one of those screens was opened from the Team, Players or League tab, s.tab is that tab and mi is kept.
- Q1: What should tapping a play open? README says 'plays open stat detail'; the prototype has none (in single-game view a tap is a no-op; in My players it jumps to the play's game). Recommendation: the player mini card first, per the 'every player click opens the mini card first' rule.
- Q2: Should box-score player rows (currently a toast) and Match starter rows (currently the full profile) open the mini player card first, with Expand opening the full profile?
- Q3: README says the Match tab has 'Starters/Bench', but only 9 starter rows render. Should a Bench section be added for both teams (BENCH_ME/BENCH_THEM data is in §5 for mi 0; mi 1-5 would need generating)?
- Q4: Should Week ‹/› load that week's matchup, lineups and scores (today only the label changes), and should the range be 1-18 instead of 1-17?
- Q5: Should the card's live-play row, the 'Yet to play' line and the feed header strip follow the swiped matchup, and which play should the card show?
- Q6: Should the card's live-play row open the game of the play shown, or 'My players', rather than always MIN @ NO?
- Q7: Are play reactions and comments (the unused PLAYS data, the fire/laugh/clap icons and the reacts state) intended for the feed?
- Q8: Copy the dark-mode contrast defects exactly (#4D4D4D vs #575757 dots, #121212 switcher dot and #4D4D4D SF avatar on #090909, #FDE4E4 end zone, #3A3A3C box numbers, unthemed #6E6E73 placeholder), or fix them? The app is moving to a single blended theme.
- Q9: Which wins in each README conflict: toast 1800ms vs ~2.2s, sheet backdrop .32 vs .4, segmented shadow 0 1px 3px vs 0 1px 2px, slot chip radius 8px vs 4-5px?
- Q10: Should switching league via the switcher re-scope the Match tab (today only the header and switcher change)?
- Q11: Should the home indicator sit above the tab bar? It currently paints beneath it and is invisible.
- Q12: The feed has no designed pre-game, halftime, final, no-live-games, loading or error state, and the clock freezes at 'Q4 0:00' with the live dot on. These need the design language extended. Also confirm whether the 'N new plays' count should only count plays shown in My players.

---

## Gap analysis vs the current app

## League › Match tab, live game feed, game stats: gap analysis

**Worktree checked (read-only):** `/Users/chrisdaltas/Documents/Hadouken/.claude/worktrees/redesign-v7`

**Bottom line:**
- **The Match tab is mostly built.** `MatchupPage` already has the scoreboard, week navigation that loads real data, the slot-aligned starters board, bench, totals and every loading, error and live state. Most of it is **restyle-only**.
- **The gaps on the Match tab** are:
  - swiping between matchups with pager dots
  - record and streak on the card
  - win probability
  - the live-play row on the card
  - the in-league dock: league switcher card plus the Match / Team / Players / League / Menu tab bar
- **The live game feed does not exist and is mostly needs-new-backend.**
  - There is no play-by-play source anywhere. Ingestion is Sleeper's free stats plus nflverse, which gives stat lines and game status only.
  - There are no columns for down and distance, possession, field position or TV network.
  - There is no NFL team-game stats table.
- **Only the box score's per-player groups can be built from existing data**, because `player_stats.game_id` is ingested.

### Feature table

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Status bar, Dynamic Island, home indicator (§2.0) | out-of-scope-or-question | n/a | Device chrome, not built in a web app. Q11: the indicator paints under the bar. Leave it to the OS. |
| League header row: logo tile, Home button, league name, 38px icon buttons (§2.1) | restyle-only | `layout/top-nav.tsx` (logo goes to `/app`, bell, account); `leagues/league-shell.tsx` (`LeagueHeaderParts`: team crest, team and league name, record/rank, sub-nav at page top on mobile) | All the parts exist. The mobile layout differs: the design puts the league name in the 48px bar with Search, Bell and Messages buttons on the right. |
| Search icon opens global search | restyle-only | `shared/command-palette.tsx` (players via `/api/players/search`; lists and users via `/api/search/community`); `bottom-tabs.tsx` Search | The overlay exists as a cmdk dialog. The design wants a full-screen panel at z 29 with a Cancel button. Player picks already open the mini card (D494). |
| Search scope chips: All / Players / People / Posts | new-ui-on-existing-data | `command-palette.tsx` | Results are grouped but there is no scope filter. The All-scope caps (5/4/4) and the single-scope cap of 30 are new. |
| Search "Recent" rows | new-ui-on-existing-data | none | No store. Per-device `localStorage` is enough (CLAUDE.md allows it for conveniences). Cross-device would need a table. |
| Search "Trending" chips | needs-new-backend | none | No trending or topics computation exists. |
| Search player owner label (Your team / other team / Waivers / Free agent) | new-ui-on-existing-data | `hooks/use-rosters`, waivers service | The data exists per league. A global search spans several leagues, so it needs a rule for which league (or only inside a league). |
| Search People: league managers ("Team · your league") and follower counts | new-ui-on-existing-data | `league_members`; `follows` and `expert_follows` tables; `/api/search/community` users | Users are already returned. League-member grouping and follower counts are new UI. |
| Search Posts: Start or sit / Ranking / List / Poll pills | out-of-scope-or-question | `featureFlags.community` and `startOrSit` (off at launch); lists only in the palette | Community and start-or-sit are flag-gated out of the launch. Polls have no backend. |
| Notification bell plus unread badge | restyle-only | `top-nav.tsx` `NotificationBell`; `hooks/use-notifications.ts` (60s poll) | The app badge is blue accent; the design's is red #FF0028 with a 2px page-colour ring. |
| Badge lifecycle: cleared only by "Mark all read" | out-of-scope-or-question | `notifications/notifications-feed.tsx` (marks all read when the page opens); `/api/notifications/read` (POST without ids = all) | The API supports a "Mark all read" button. The design keeps the badge until it is tapped; the app clears it on open. Needs a ruling. |
| Messages bubble plus DM badge, opening Messages | needs-new-backend | `layout/rail/messages-panel.tsx` (mock, `featureFlags.messages`); no DM table in `types/database.ts` | Messages are mock-only. The icon can only be wired to mock data until DMs get a backend. |
| Toast | restyle-only | `ui/toast.tsx`, `ui/toaster.tsx` | Design: ink pill, 36px tall, 100px from the bottom. Q9: 1800 ms vs README 2.2s. |
| Match tab as the league's initial screen | out-of-scope-or-question | `league-shell-ops.ts` `leagueTabs` (Home is the landing; Matchup is a tab) | The app opens a league on League Home. The design opens on Match. This is an IA call. |
| Matchup card score grid: avatar initial, score, "vs", team name linking to the team page, @manager | restyle-only | `leagues/matchup-view.tsx` `Scoreboard` / `Side` (`Crest`, `TeamNameLink`, `UsernameLink`, stored scores) | Everything is there at ×0.8. The design hides the avatar and score from taps; the app's team name already links. |
| Per-team avatar colours (blue, ink, purple…) | out-of-scope-or-question | `league-cells.tsx` `Crest` (initials on grey); `teams` has no colour or avatar column | Needs either a deterministic palette rule (client-only) or a stored team colour. |
| Projection under each score | restyle-only | `matchup-view.tsx` `TotalCell` / `projectedTotalText` | It exists in the board's Total row and only shows when every starter has a stored projection. The work is moving it into the card. |
| Record in meta line ("2-6") | new-ui-on-existing-data | `hooks/use-standings`; `standings-table-ops.ts` `formatRecord` (already used in `league-shell.tsx`) | The scoreboard doesn't read standings yet. |
| Streak ("▼2L" / "▲8W") | needs-new-backend | `lib/leagues/api/standings-service.ts` (no streak); PROGRESS F566 | It must be a server field on the standings document. The client computes nothing. |
| Win-probability bar plus "66% win" | needs-new-backend | `league-cells.tsx` `WinProbMeter` (built, unused); `matchup-view.render.test.ts` pins "no win probability"; F566 open | There is no model. Whether to have one is a product call. The feed header strip's 66% bar has the same gap. |
| Swipe between matchups (axis lock, ±180 clamp, 60px threshold, 140ms slide out/in, wrap) plus 6 pager dots | new-ui-on-existing-data | `hooks/use-matchups.ts` `useMatchupsLive` (all of the week's matchups); `/leagues/[leagueId]/matchup/[mid]`; `MatchupList` "Around the league" | The data and the per-matchup routes exist; today other matchups are a list. Build notes from the spec: `setPointerCapture`, `overflow-x: clip` on the scroller, suppress taps after a drag, 30px hit area on the dots. |
| Re-tapping Match resets to your matchup | new-ui-on-existing-data | `matchup-view-ops.ts` `selectedMatchup` (no `mid` = mine) | Trivial once the tab bar exists. |
| Live-play row on the card (latest play, situation, "+0.9", Live dot, opens the feed) | needs-new-backend | none | No play-by-play source. Q5/Q6 (which play, which target) are moot until one exists. |
| "Yet to play: N · QB, RB, WR, D/ST" per side | new-ui-on-existing-data | `matchup-view-ops.ts` `yetToPlayCount` / `yetToPlayCopy` (live weeks, in `TotalCell`); `BoxStarter.phase` | The count exists. The position list can be built from the box starters' `up_next` phase. |
| "Starters" header plus Week ‹ › navigator | restyle-only | `matchup-view.tsx` `WeekStrip`; `weekNav`; `?week=` | It already loads that week's matchups and lineups (Q4 resolved) and disables at the ladder ends. Keep that rather than the design's silent clamp. |
| Starter comparison rows (slot-aligned, name, POS · TEAM, points, projection, game line) | restyle-only | `matchup-view.tsx` `LineupBoard` / `StarterCellView`; `pairSlots`; `starterCell`; `gameStateLine`; `opponentLabel`; `formatKickoff` | Everything is real data. The design uses short names ("J. Chase") and the "Final W 31-20 @ GB" game format. The app shows "Final · away – home". |
| "(bye)" after TEAM in the meta line | new-ui-on-existing-data | `players.bye_week` exists; `BoxStarter.player` in `box-score-service.ts` doesn't select it | Add the field to the box read. |
| Slot chips coloured by position (QB red, RB blue, …, FLEX ink) | restyle-only | `players/position-badge.tsx`; board centre label | Q9: chip radius 8px vs README 4–5px. |
| Empty slot, not-yet-played "-", pending | restyle-only | `StarterCellView` ("Empty"); `starterCell` tones (pending is a word, E61) | The app's states are richer than the design's "-". |
| Starter tap opens the player | restyle-only | `players/player-link.tsx` (`PlayerLink` opens the mini card first, then Expand) | The house rule (2026-10-05) beats the design's direct full profile (Q2). |
| Bench on Match | restyle-only | `matchup-view.tsx` bench section (`benchRows`, `pairBench`, `BENCH_NOT_COUNTED_COPY`) | Already built (Q3 resolved in the app). It needs the design's BN chip styling. |
| App-only Match content: Total row, vs League Median, 2nd opponent, ✸ Adjusted, commissioner override tools, correction note, total-points leaderboard variant, Bye side | restyle-only | `matchup-view.tsx`; `matchup-override-panel.tsx`; `corrections-view.tsx` | Not in the prototype. Extend the v13 language; never drop them. |
| Match states: skeleton, problem/retry, no week, no matchups, stale, reconnecting, live stats delayed | restyle-only | `matchup-view.tsx` `MatchupSkeleton` / `ProblemCard` / `EmptyCard`; `status-banners.tsx` | The design shows none of these. Extend the language. |
| Live game feed screen (route, header, back to Match) | needs-new-backend | No route under `app/app/(shell)/leagues/[leagueId]/`; no API in `src/app/api/**` | Feed content needs play-by-play. Ingestion (`api/cron/sync-live/route.ts`: Sleeper + nflverse) has stat lines and game status only. |
| Feed header matchup strip (your two scores) | new-ui-on-existing-data | `useMatchupsLive` | The scores exist. The 60px win bar is the same gap as win probability. |
| Game picker cards (NFL games: score, quarter and clock, live status) | new-ui-on-existing-data | `nfl_games` (home/away score, quarter, game_clock, status, kickoff_at); currently only read per starter via `box-score-service.ts` | Needs a thin read of the week's games for your players (no new table). |
| TV network on game cards and header ("· FOX") | needs-new-backend | `nfl_games` has no network column | Not ingested. |
| Game header score row: team tiles, scores, live dot, clock | new-ui-on-existing-data | `nfl_games`; `lib/nfl-team-colors.ts` `NFL_TEAM_COLORS` | Team colours and scores exist. |
| NFL team records ("3-2") in the game header | needs-new-backend | none | Not stored. It could be derived server-side from final `nfl_games` rows. |
| Possession ("ball"), down and distance ("2nd & 9") | needs-new-backend | none | Not in `nfl_games` and not in the provider feed. |
| Field strip (ball line, first-down line, end zones, "2nd & 9 at MIA 9") | needs-new-backend | none | Needs drive and field-position data. |
| "My players" view and card ("Following 14 players", "N new plays") | needs-new-backend | none | The followed set (your and your opponent's starters) can be built from box reads. The plays themselves need play-by-play. |
| Play rows: situation, clock, title, TD pill, stat lines, gain, yard bar, New pill and fresh tint fading over .4s | needs-new-backend | none | Needs a play-by-play feed plus realtime per-play pushes. Today realtime carries only `matchups` `scores_updated` (`use-matchups.ts`, spec §9.1 "never per-player stat lines" broadcast). |
| Per-play fantasy points plus owning team (green mine / red opponent) | needs-new-backend | `league_week_player_points` stores per-player weekly points only | Needs per-play scoring attribution. "Mine" must come from the team id, never a name string. |
| Play row tap: stat detail | out-of-scope-or-question | none | Q1: the prototype has no stat-detail view. Recommendation: open the mini card. |
| Play by play / Box score segmented control | new-ui-on-existing-data | `ui/tabs.tsx` `segmentItemVariants` | The UI pattern exists. The Box score half can be built (next row); Play by play can't. |
| Box score player groups: Passing (C/Att, Yds, TD, Int), Rushing (Car, Yds, TD), Receiving (Rec, Yds, TD) | new-ui-on-existing-data | `player_stats` (`game_id` ingested per `lib/sync/ingest-week.ts`; `pass_completions`/`attempts`/`yards`/`tds`, `interceptions`, `rush_attempts`/`yards`/`tds`, `receptions`, `receiving_yards`/`tds`) | Needs a read grouped by `game_id`. No new table. |
| Box score team stats (total yards, first downs, 3rd down, turnovers, possession) | needs-new-backend | none | There is no team-game stats table. Only passing, rushing and turnover sums can be derived from `player_stats`; first downs, 3rd-down rate and possession time can't. |
| Box score row tap: player card | restyle-only | `PlayerLink` mini card | The prototype's toast is a placeholder. |
| Undesigned feed states: pre-game, halftime, final, no live games, loading, error | out-of-scope-or-question | `nfl_games.status` (scheduled/live/final) supports them | Q12: the design language has to be extended. |
| Play reactions and comments (unused `PLAYS` data) | out-of-scope-or-question | none | Q7. Would also need a backend if wanted. |
| Dock league switcher card (swipe to change league, swipe up or tap for the "Switch league" sheet, dots, team and record) | new-ui-on-existing-data | `hooks/use-leagues`; `top-nav.tsx` `LeagueSwitcher` (desktop dropdown only, `desk:flex`); `/app/leagues` | Switching navigates to the other league's route, so content re-scopes (Q10 resolved). Fire the toast after the navigation, not at release. |
| In-league tab bar: Match / Team / Players / League / Menu | new-ui-on-existing-data | `layout/bottom-tabs.tsx` (global Home / Lists / Players / Search / More); `league-shell-ops.ts` (Home, My Team, Matchup, Players, Schedule, Stats + More) | Every target page exists. Open questions: how six tabs plus More map onto five (where Home, Schedule and Stats go under "League" or "Menu"), and whether this bar replaces the global tabs inside a league. |
| Tab bar on the feed, Notifications and Messages with nothing highlighted | new-ui-on-existing-data | `bottom-tabs.tsx` `isTabActive` | Comes with the dock. |
| Dark mode (`.fs-dark` tokens, `localStorage` theme) | out-of-scope-or-question | CLAUDE.md: single blended theme, no toggle | Don't build it. §6's dark defects are moot. |
| README vs prototype conflicts: toast duration, sheet backdrop .32 vs .4, segmented shadow, slot chip radius | out-of-scope-or-question | `tailwind.config.ts` `fs-*` tokens | Q9. Also, the segmented "on" shadow is a resting shadow; it is fine on v13 surfaces but forbidden elsewhere. |
| Team rename propagation; sample-data inconsistencies (Q13) | restyle-only | Everything is keyed by team id (`teamName(doc, id)`) | No action. Real data has none of the prototype's artefacts. |

### Files checked
- **Leagues components:** `src/components/leagues/` `matchup-view.tsx`, `matchup-view-ops.ts`, `league-shell.tsx`, `league-shell-ops.ts`, `league-cells.tsx`, `league-home-season.tsx`, `team-page.tsx`
- **Layout:** `src/components/layout/` `top-nav.tsx`, `bottom-tabs.tsx`, `more-sheet.tsx`, `top-search.tsx`, `app-shell.tsx`, `rail/messages-panel.tsx`
- **Shared, notifications, players, UI:** `src/components/shared/command-palette.tsx`; `src/components/notifications/notifications-feed.tsx`; `src/components/players/player-link.tsx`, `player-image.tsx`, `position-badge.tsx`; `src/components/ui/toast.tsx`, `ui/toaster.tsx`
- **Hooks:** `src/hooks/use-matchups.ts`, `use-notifications.ts`, plus use-box-score, use-standings and use-leagues
- **Lib:** `src/lib/leagues/api/box-score-service.ts`, `standings-service.ts`; `src/lib/nfl-team-colors.ts`; `src/lib/feature-flags.ts`; `src/lib/sync/ingest-week.ts`
- **API and routes:** `src/app/api/cron/sync-live/route.ts`; the full `src/app/api/**` route list (no games, feed, play-by-play or DM routes); `src/app/app/(shell)/leagues/[leagueId]/**`
- **Schema and specs:** `src/types/database.ts` (`nfl_games`, `player_stats`, `players.bye_week`, `teams` with no colour; no play, team-game-stats or DM tables); `docs/specs/PROGRESS-leagues.md` (F566, D479, D484); `docs/specs/spec-redraft-leagues.md`
