## Navigation graph (every transition in the app)

Source: `/Users/chrisdaltas/Documents/Hadouken/design_handoff_fieldscout_mobile/FieldScout Mobile.dc.html`. The markup is lines 1–1121 and the script starts at line 1122. `renderVals()` starts at line 1626. Line numbers are cited as `L###`.

All navigation is in-memory `setState`. Nothing in the main file touches the URL or browser history. The only URL changes are `window.location.href` jumps to a second file, `FieldScout Mobile Lists and Rankings.dc.html`, listed in §4(f).

Glossary of helpers used in the tables:
- `set(o)` means `this.setState(o)`, a shallow merge.
- `soon()` means `toast("Not part of this prototype")`.
- `toast(t)`: sets `{toast:t}`, clears any pending timer and clears the toast after **1800 ms** (L1624). The README says about 2.2 s.
- `openProf(n)` sets `{prof:n, pfTab:"summary", pfYear:"2026", pfAvail:false}` (L1417). `pfCol` (collapsed sections) and `pfTxLg` are **not** reset, so they carry over to the next profile.
- `newTrade(ti, theirs, mine)` returns `{opp:ti, theirs:theirs||[], mine:mine||[], review:false, exp:"Never", dm:true, hide:false}`. `openTrade(ti, theirs)` sets `{trade:newTrade(ti, theirs)}` (L1418–1419).
- `openTeam(ti)` is exposed as `this._openTeam` (L1701):
  - `ti === 0` (my team): `{scr:"league", tab:"team", teamView:null, tradeOpen:null}`.
  - any other team: `{teamView:ti}`.
- `openConvo(id)` sets `{scr:"thread", convo:id, unread:{...unread,[id]:false}, msg:""}` (L1703). It does **not** touch `prevScr` or `sheet`.
- `goHome` sets `{scr:"home", sheet:null}`. `goHomeLogo` does the same.
- `goDms` sets `{scr:"dms", sheet:null, prevScr: [dms,thread,notifs].includes(scr) ? prevScr : scr}`. `goNotifs` is the same with `scr:"notifs"` (L1845).
- `backFromDms` sets `{scr: prevScr || "league"}` (L1846).
- `backLeague` sets `{scr:"league", tab:"match"}`. It keeps `mi`.
- `backTeam` sets `{scr:"league", tab:"team", sheet:null}` (L1714).
- `goFeed` sets `{scr:"feed", game:"min", gtab:"plays"}` (L1714). This always opens game `min` (MIN @ NO), never "My players".
- `closeSheet` sets `{sheet:null}`.

**Initial state (L1414):**
- Navigation: `scr:"league"`, `tab:"match"`, `mi` undefined (treated as 0), `lg:0`, `ltab:"matchups"`, `ptab:"trend"`.
- All overlays are closed: `sheet:null`, `prof:null`, `trade:null`, `tradeOpen:null`, `teamView:null`, `settings:false`, `page:null`, `cmOpen:null`, `cmp:null`, `pick:null`, `gs:null`, `colTip:null`, `pmenu:null`.
- Other values: `prevScr:"league"`, `convo:null`, `game:"mine"`, `gtab:"plays"`, `meTab:"lists"`, `cmTab:"all"`, `cmSearch:false`, `dmFilter:"all"`, `pview:"list"`, `week:5`, `notifRead:false`, `unread:{league:true, marcus:true, nina:true}`, `pf2:{status:"avail", per:"w5", pos:"All", team:"All"}`, `trendOpen:true`.
- **The app opens on League › Match, with the league switcher showing.**

---

### 1. Screens & states (state machine nodes)

#### (a) Screen / overlay table

**Base screens.** These are keyed by `scr`, and only one shows at a time. Each is a `flex:1` column under the 50px status bar.

| `scr` | Screen | Visible sub-states (state that drives them) |
|---|---|---|
| `"home"` | Home | `homeTrend` (`"adds"`/`"drops"`) |
| `"community"` | Community | `cmTab` (`all`/`following`/`poll`/`rank`/`list`); `cmTopic`; `cmSearch` true (inline search header) or false; `cmQuery`; `cmRk` filters (rank tab only); empty state when `cmEmpty` |
| `"me"` | Profile | `meTab` (`rankings`/`lists`/`ss`). Initial value is `"lists"`. The code falls back to `"rankings"` only when the value is falsy |
| `"myss"` | My start/sit | `ssTab` (`all`/`open`/`closed`, default `all`); empty state "No questions here yet" |
| `"league"` | League shell: header, body and switcher | `tab` (`match`/`team`/`players`/`league`), `mi` (0–5), `week` (1–17), `ltab` (`matchups`/`standings`/`activity`), `pf2` filters, `pmenu`, `pview` (`list`/`cards`/`sheet`), `trendOpen`, `lg` (0–3), `lsDx`/`lsAnim`, `mxDx`/`mxAnim` |
| `"feed"` | Live game feed | `game` (`"mine"`/`"cin"`/`"min"`/`"chi"`), `gtab` (`plays`/`box`; box only when `game !== "mine"`) |
| `"trans"` | Transactions | `tMine` true gives title "My moves" and hides the team filter; false gives "League transactions". Also `tType`, `tTeams`; empty state when `transEmpty` |
| `"dms"` | Messages | `dmFilter` (`all`/`trades`), `dmQuery` |
| `"thread"` | Conversation | `convo` (an id; `null` falls back to `convos[0]`, the "Sunday Funday League" group, for display, but Send is then a no-op) |
| `"notifs"` | Notifications | `notifRead` |

**Bottom sheets.** These are keyed by `sheet` and drawn in one sheet container at z-index 20 (L646).

| `sheet` | Title (`sheetTitle`, L1707) | Opened by | Extra chrome |
|---|---|---|---|
| `"create"` | "Create" | Community "+" (`openCreate`) | – |
| `"leagues"` | "Switch league" | Tap or swipe up on the league switcher | 32px close "X" button (the only sheet with one) and footer hint "Swipe the bar left or right to switch faster" |
| `"filters"` | "Transaction filters" | "Filter" pill on League › Activity or on Transactions | "Done" button (50px) |
| `"grid"` | "Customize stats" | Players tab "Customize" | Sub-line "Pick the stats shown in the list and sheet views"; "Done" button |
| `"swap"` | "Swap player" | Team tab slot chip (`swapFor:{t:"s"\|"b", i}`) | – |
| `"menu"` | "Menu" | League tab bar "Menu" (toggle) | – |
| `"chat"` | "League chat" | **Nothing in the UI opens it.** Only `go(…, "chat")` sets it, and no JUMP passes `"chat"`. (`openChat` is unrelated: it navigates to Messages, see the dead-bindings list.) | Message input bar, placeholder "Message the league". Its Send writes to `threads[convo]`, not to the chat list, and does nothing while `convo` is null |

**Full-screen overlays.** Each is `position:absolute; left:0; right:0; top:50px; bottom:0`, background `var(--x-b0,#fff)`. Each one has its own state key, so several can be open at once.

| State | Overlay | z-index | Line |
|---|---|---|---|
| `teamView != null` | Other team view | 21 | L729 |
| `prof` (player name) | Player profile | 22 | L749 |
| `settings === true` | League settings tile grid. **Unreachable**: `openSettings` is never bound and no JUMP uses `sub "settings"` | 23 | L823 |
| `tradeOpen` (trade id = convo id) | Trade offer detail | 23 | L832 |
| `trade` (builder object) | "Propose a trade" builder; sub-state `trade.review` | 24 | L859 |
| `page` (`myteam`/`general`/`scoring`/`playoffs`/`draft`/`history`/`seasons`) | League settings sub-page | 25 | L891 |
| `cmOpen` (post id) | Community list detail | 26 | L958 |
| `cmp` (composer object) | Composer. `kind:"poll"` (qtype `ss` or `trade`) or `kind:"list"` step 1/2. `kind:"rank"` step 1/2 is coded but **unreachable**, because the Create › Ranking option leaves the file | 27 | L981 |
| `pick` | Player picker; `mode:"single"` or `"multi"` | 28 | L1073 |
| `gs` (`{q, scope}`) | Global search | 29 | L1090 |
| `colTip` (stat key) | Centered stat-explainer card. Scrim `rgba(0,0,0,.18)`, `inset:0` | 30 | L1108 |
| `toast` (string) | Toast pill, bottom 100px | 30 | L1117 |

**In-content popover.**
- `pmenu` (`status`/`per`/`pos`/`team`) is the Players filter quick-pick. Its layout is in §2.
- Its scrim is `position:fixed; inset:0; z-index:7` with no background. The card is `z-index:8`.
- Both sit inside the sticky Players filter bar (`position:sticky; top:0; z-index:6`) (L344–354).
- The sticky bar's z-index creates a stacking context at 6, which is above the dock (z 4) and the unpositioned league header. So while the popover is open, the invisible scrim catches every tap on the header, the switcher and the tab bar, and those taps only close the popover.
- No ancestor is transformed, so in a plain browser the fixed scrim covers the whole browser window, including the JUMP panel.

**Dead or unused bindings.** These are computed in the script but nothing in the markup uses them, so do not build them as navigation unless asked:
- `leagueTabs` (an in-header Match/Team/Players/League strip), `mxLabel` ("Your matchup" / "Matchup N of 6"), `mxPrev`, `mxNext`, `mxHint`.
- `bracket`, `menuLeagues`, `openSettings`.
- `openChat`. It would set `{scr:"dms", sheet:null, prevScr:scr}`, always overwriting `prevScr` (unlike `goDms`) (L1747). It does **not** open the chat sheet.
- `pTabs`, `trendTabs`, top-level `posChips`, `pRows`, `pTitle`, `isTrend`, `notTrend`, `isLeaders`, `trendSeg`, `gridLabel`.
- The `pick()` helper inside `ls` (L1771).
- The local `gridGroups` at L1691 (View / Week or season / Year, using `view`/`period`/`year` state). It is never returned. The Customize stats sheet renders `pVals`' `gridGroups` instead (L1465): 8 groups, Fantasy, Ownership, Matchup, Base stats, Usage, Advanced passing, Advanced rushing, Advanced receiving.
- `ptab` (only the JUMP panel sets it; the Players list ignores it).
- Trending tile `tc`/`tcFg` (L1458).

---

### 2. Layout of navigation chrome (per screen)

This section lists only navigation-bearing elements: headers, back and close controls, in-content navigation controls, the dock and sheets. Screen bodies belong to other areas. Icons are 16×16 viewBox stroke paths with round caps and joins unless noted.

#### Device and presentation chrome (prototype only)
- **Page:** body bg `#F5F5F7`. The wrapper is `min-height:100vh`, flex, centred, gap 40px, wraps, padding `32px 24px 48px`. Font `'InterDisplay'`, `font-feature-settings:'tnum' 1,'cv11' 1`, antialiased (L13, L25).
- **Bezel:** 410×864, padding 10, radius 58, bg `var(--x-ink,#1D1D1F)`. It sits outside `.fs-dark`, so it is always `#1D1D1F`. Shadow `0 30px 80px -30px rgba(0,0,0,.45)` (L37).
- **Screen (phone root):** 390×844, radius 48, `overflow:hidden`, bg `var(--x-b0,#fff)`, flex column, `position:relative`. It carries the classes `themeCls` = `fs-dark?` plus ` dock-lg` or ` dock-sm` (L38).
- **Status bar:**
  - 50px tall, padding `6px 32px 0 40px`, "9:41" in 16px/600.
  - Dynamic-island pill: 120×34, `#000`, absolute top 11px, centered.
  - Right icons (gap 6, colour `var(--x-t1)`):
    - Signal: 18×12, four bars 3px wide with rx 1, heights 4 / 7 / 9.5 / 12.
    - Battery: 25×12. Body 21×11 rx 3.5 stroked at opacity .4; fill 16×8 rx 2; nub 1.5×4 at opacity .4 (L40–43).
  - All full-screen overlays start at `top:50px`, below this bar. Sheets and the col-tip use `inset:0`, so their scrim also covers the status bar.
- **Home indicator:** `position:absolute; bottom:8px`, centered, 134×5, radius 999, `var(--x-b0,#fff)` (L644).
  - It has **no z-index**, while the dock is `position:relative; z-index:4`. It therefore paints *under* the 94%-opaque tab bar and is effectively invisible.
  - In dark mode it is fully invisible (`#121212` under `rgba(18,18,18,.92)`).
- **JUMP panel** (outside the phone, outside `.fs-dark`, so it always uses the light fallbacks):
  - Column 240px wide, gap 14, padding-top 8.
  - Title "FieldScout mobile", 20px/600, −0.02em. Sub "League screens. Tap inside the phone or jump to a screen.", 13px/500, t3, line-height 1.4 (L28).
  - "Dark mode" row (L29):
    - 34px tall, padding 0 12px, gap 8, radius 10, bg `#EBEBEE`, 13px/600 `#1D1D1F`.
    - Switch: 36×22, padding 2, radius 999. Knob 18px `#fff`. Track `#07B85A` when on, `#C7C7CC` when off.
  - Jump rows: see §4(f).

#### Headers by screen

**Home** (L48–55)
- Row is 48px, `space-between`.
- Left side (clickable, `goHomeLogo`): logo tile 28×28, radius 8, `#07D066`, logomark 15×15; "FieldScout" in 19px/700, letter-spacing −0.03em; gap 8px.
- Right group, gap 2px: three 38px circular buttons (active bg `var(--x-b2,#F2F2F4)`):
  - Search: 20px icon drawn as `circle cx7 cy7 r4.8` plus `M10.6 10.6L14 14`, stroke 1.5.
  - Bell: path `M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14h3`.
  - Chat bubble: path `M8 13.5c3.3 0 6-2.4 6-5.5S11.3 2.5 8 2.5 2 4.9 2 8c0 1.2.4 2.3 1.1 3.2L2.5 13.8l2.9-.9c.8.4 1.7.6 2.6.6z`.
- Badges:
  - Absolute top 4px, right 4px; min-width 16px, height 16px, padding 0 4px, radius 999; 10px/600 white; ring `0 0 0 2px var(--x-b0,#fff)`.
  - The notifications badge bg is `#FF0028` (Danger).
  - The messages badge bg is `#0088FF` (Accent).

**Community** (L149–150)
- Same 48px row: logo (→ `goHomeLogo`), Search 38px (stroke 1.6) and Create (+).
- Create is a 34px circle, `#0088FF` (active `#0074DB`), with a 15px plus at stroke 2.4.
- **There is no bell and no chat button on Community.**
- Search mode replaces the row. It contains:
  - An input 38px tall, radius 12, bg `var(--x-b2)`, with a 15px magnifier in `var(--x-t4,#8E8E93)`.
  - Placeholder "Lists, rankings, people or players", 15px/500, `autofocus`.
  - A "Cancel" link, 15px/500, `#0088FF`.

**Profile** (L110)
- 48px row with "Profile" in 28px/600, −0.03em.
- Theme pill: 34px tall, padding `0 12px 0 10px`, gap 6, radius 999, bg `var(--x-b2)`, 13px/600, 16px icon.
- The label is "Dark" or "Light" (`themeLabel`). The title attribute is "Switch to dark mode" or "Switch to light mode".

**My start/sit** (L124)
- 52px row, gap 10.
- Back: 34px circle, bg `var(--x-b2,#F2F2F4)`, chevron `M10 3L5 8l5 5` at 16px, stroke 2.
- Spacer.
- "+": 34px circle `#0088FF` with a white plus at 15px/2.4, title "Ask a question".
- Then the page title "My start/sit", 26px/700, −0.03em.

**League** (L233–246, shown only when `scr==="league"`)
- Container: `flex:none; padding:0 12px; border-bottom:1px solid var(--x-b3,#EBEBEE)`. Row 48px, gap 10px.
- Logo tile 28×28 (margin-left 4px; **not clickable**).
- Home button: 38px circle, margin-left −6px, `title="Home"`. House icon 20px at stroke 1.5, path `M2.5 7.2L8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5z`.
- League name `{{ lg.name }}`: 13px/600, flex:1, ellipsis.
- Search, Bell (with badge) and Chat (with badge), the same as on Home.

**Live feed** (L458–466)
- 52px row, padding 0 12px, gap 8.
- Back: 36px circle, chevron 18px at stroke 2, active bg b2.
- Centre: **static** mini-score, a 3-column grid `minmax(0,1fr) 60px minmax(0,1fr)` with gap 8:
  - Left: "Touchdown Tacos" (11px/500 t3) over "39.70" (16px/600), right-aligned.
  - Middle: 5px bar, radius 999, track b3, fill 66% `#07B85A`.
  - Right: "Gridiron Gurus" over "16.40".
  - It always shows matchup 0, whatever matchup the user swiped to.
- Right spacer 36px.

**Transactions** (L521–525)
- 52px row.
- **Close "X"**: 36px, icon `M4 4l8 8M12 4l-8 8` at 16px, stroke 2.
- Centered title `{{ transTitle }}`, 16px/600.
- Spacer 36px.

**Messages** (L544–548)
- 52px row.
- "Back" pill: 36px tall, padding `0 8px 0 4px`, gap 2, radius 999, `#0088FF`, 15px/500, chevron 18px, active bg b2.
- Compose (pencil, `M11 2.5l2.5 2.5L6 12.5H3.5V10zM9.5 4l2.5 2.5`): 38px.
- Below the row:
  - Title "Messages", 28px/600.
  - Search input, placeholder "Search".
  - All/Trades segmented control.

**Conversation** (L583–588)
- 56px row, border-bottom 1px b3.
- Back: 36px circle, chevron 20px `#0088FF`.
- Avatar 36px (radius 11px for the group, otherwise 50%).
- Name 15px/600 and sub 11.5px/500.
- Info icon 36px.

**Notifications** (L610–614)
- 52px row: "Back" pill (same as Messages), spacer, then "Mark all read" in 14px/600 `#0088FF`, padding 0 6px.
- Title "Notifications", 28px/600, padding `0 16px 8px`.

#### Navigation affordances available per screen

Global search (`openGS`) is bound only at L51 (Home) and L239 (League). Bell and Chat are bound only at L52–53 and L240–241.

| Screen | Search (global) | Bell | Chat | Way home |
|---|---|---|---|---|
| Home | yes | yes | yes | (logo, no-op) |
| Community | inline Community search only | no | no | logo |
| Profile | no | no | no | tab bar |
| My start/sit | no | no | no | back chevron (goes Home) |
| League | yes | yes | yes | Home icon |
| Feed, Transactions, Messages, Conversation, Notifications | no | no | no | back/close, or league tab bar → Menu → Home tile |

#### Overlay headers

| Overlay | Header |
|---|---|
| Team view | 52px. Back chevron 36px (18px icon, `var(--x-t1)`). |
| Player profile | Team-colour header `background:{{pf.tc}}`, padding `8px 16px 12px`, gap 10. Close "X": 30px circle, bg `pf.chipBg` (`rgba(0,0,0,.08)` on light team colours, otherwise `rgba(255,255,255,.16)`), 14px icon at stroke 2.2. Then the action pill (30px, padding 0 14px, 13px/600) and the "+ List" pill (30px, padding 0 12px, bg `var(--x-b2)`, text `var(--x-t1)`). "Light" means luminance > 160 (`isLight`, L1207), which applies only to **PIT `#FFB612` and NO `#D3BC8D`**. Unknown teams fall back to `#3A3A3C`. |
| Settings | 48px. X: 36px circle, bg b2, 14px icon. |
| Trade detail | 52px, `justify-content:space-between`, padding 0 12px. X: 36px (16px icon, stroke 2.2). Right chip (gap 6, 11px/600 t3): a 20×20 square, radius 6, bg `lg.av`, initials `lg.ini` in **9px/600 `#fff` always** (it does not use `avFg`, even on FB `#ECAD48`), followed by `td.league` = **`LEAGUES[lg].sub`, the format string** ("12-team standard", "10-team standard", "12-team PPR", "10-team half PPR"), not the league name. |
| Trade builder | 48px. X: 36px circle, bg b2, 14px icon. Centered "Propose a trade", 16px/600. Spacer 36. |
| Page | 52px, border-bottom 1px b3. Back chevron 36px `#0088FF` (18px). Centered `pg.title` 16px/600: "My team", "League settings", "Scoring", "Playoffs", "Draft results", "League history" or "Previous seasons". Spacer 36. |
| Community detail | Floating back button over the 230px cover: absolute top 10px, left 12px, 36px circle, bg `rgba(0,0,0,.35)`, white chevron 18px. |
| Composer | 52px, gap 8, padding 0 12px, border-bottom 1px b3. Left button 36px: **X (14px, stroke 2.2)** when `cmp.isFirst` (poll, or step 1); **chevron (18px, stroke 2)** at step 2. Centered title 16px/600 (strings below). Right action pill: 32px tall, padding 0 14px, 13px/600; bg `#0088FF` with white text when enabled, otherwise `var(--x-b3,#E5E5EA)` with `var(--x-t3,#6E6E73)` text. |
| Picker | 52px. Back chevron 36px. Centered "Choose a player" (single mode) or "Add players" (multi mode). Right side: a "Done" pill (32px, `#0088FF`) in multi mode, otherwise a 36px spacer. |
| Global search | 52px, padding 0 16px. Input 38px, radius 12, bg b2, placeholder "Players, people and posts", `autofocus`. Clear button: 18px circle, bg `var(--x-b4,#AEAEB2)`, 8px white X. "Cancel": 15px/500 `#0088FF`. |
| Col tip | Card max-width 300px, padding 16, radius 18, shadow `0 12px 32px rgba(0,0,0,.2)`. Close button: 28px circle, bg b2. Sort button: 36px pill. |

**Composer header strings** (L1574–1612):

| State | Title | Action label | Enabled when |
|---|---|---|---|
| poll, `qtype:"ss"` | "Start or sit" | "Post" | ≥2 options filled (`pickN` is clamped to `filled−1`, so this is the only effective rule) |
| poll, `qtype:"trade"` | "Trade question" | "Post" | ≥1 give and ≥1 get |
| list step 1 | "New list" | "Next" | trimmed name is non-empty |
| list step 2 | "Edit list" | "Save" | trimmed name is non-empty |
| rank step 1 (unreachable) | "New ranking" | "Next" | always |
| rank step 2 (unreachable) | "Edit ranking" | "Publish" | ≥3 players and a non-empty title |

**List composer step 1 body** (L1040–1043):
- Centred column, gap 22, padding `40px 24px 120px`.
- Heading "Name your list", 22px/700, −0.02em.
- Name input:
  - Placeholder "Week 5 sleepers", `maxlength="40"`.
  - 26px/700, centred, padding-bottom 10, `border-bottom:2px solid var(--x-ink)`.
  - Enter advances to step 2 when the name is valid.
- In-body **"Create"** button:
  - 44px tall, padding 0 28px, radius 999, 15px/600, colours from `cmp.actBg`/`cmp.actFg`.
  - It calls the same `cmp.act` as the header "Next", so it advances to step 2 under the same rule.

#### In-content navigation controls

**Match tab swipe wrapper** (L249–299). One `div` carries the pointer handlers plus `transform`, `opacity` and `transition`. Everything inside it slides and fades with the swipe, top to bottom:
1. Dots row: padding `6px 12px 0`, then a centred row with padding-bottom 8 and gap 4.
2. Matchup card (radius 18, bg b1), including the live-play row.
3. The "Yet to play" line (L277): padding `10px 4px 0`, 11px/500 t3, `space-between`. It always reads "Yet to play: 4 · QB, RB, WR, D/ST" on the left and "Yet to play: 5" on the right, whatever `mi` is.
4. The "Starters" header (17px/600, −0.01em, padding `18px 16px 6px`) with the Week stepper.
5. The starters compare list.

**Live-play row** (L268–273). This is static and identical for every `mi`.
- Padding `10px 12px`, gap 10, `border-top:1px solid var(--x-b3,#E5E5EA)`, active bg `var(--x-b2,#EDEDF0)`.
- FSHeadshot 32px (team NO, player "Devaughn Vele", `src=""`).
- Text column:
  - "Q4 6:50 · 2nd & 7 @ NO 44" in 11px/500 t3.
  - "D. Vele 9 yd catch" in 13.5px/600.
- Right column:
  - "Live" in 11px/600 `#FF0028`, with a 6px `#FF0028` dot and gap 4.
  - "+0.9" in 14px/600 `#07A852`.
- Then a 14px chevron `M6 3l5 5-5 5`, `var(--x-t5)`, stroke 2.

**Week stepper** (L280):
- Two 30px circles with active bg `var(--x-b2,#F2F2F4)`. Each holds a 12px chevron in `#0088FF` at stroke 2.2 (`M10 3L5 8l5 5` / `M6 3l5 5-5 5`).
- Label "Week {n}" in 13px/600 `#0088FF`; group gap 2.
- **There is no disabled styling at weeks 1 or 17.** The value only clamps.
- The Team tab shows the same "Week {n}" label without the arrows (L312).

**Team tab action tiles** (L307–308, L1736):
- 4-column grid, gap 6, inside the team card (radius 18, bg b1, padding `14px 14px 10px`).
- Each tile: 52px tall, radius 12, bg `var(--x-b0,#fff)`, active `var(--x-b2,#EDEDF0)`, column centred, gap 4. 16px icon in t1 at stroke 1.6; label 11px/600.
- Tiles:
  - "Schedule": `ICON.sched` `M3 4.5h10v8.5H3zM3 7.5h10M6 3v3M10 3v3`.
  - "Trade": `ICON.trade` `M3 5.5h9.5L10 3M13 10.5H3.5L6 13`.
  - "Moves": `ICON.trans` `M4 3.5h8v9H4zM6 6.5h4M6 9.5h4`. The script label is "Transactions", renamed to "Moves".
  - "News": `ICON.news` `M3.5 3.5h9v9h-9zM5.5 6h5M5.5 8.5h5M5.5 11h3`.

**Players filter bar and quick-pick popover** (L345–354, L1443–1454):
- Bar: sticky, bg b0, padding `10px 0 8px`, border-bottom 1px b2. The pills row scrolls horizontally, gap 6, padding 0 12px.
- Pill: 30px tall, padding `0 10px 0 12px`, radius 999, gap 5, 13px/600. 10px chevron `M4 6l4 4 4-4` at stroke 2.4.
  - Filled (`var(--x-ink)` bg, `#fff` text) when the value differs from its default "all" / "w5" / "All" / "All", otherwise b2 bg with t1 text. So the **default status pill "Available" is filled**.
  - Labels:
    - Status: "All" when status is `all`, otherwise its PSTAT label (default "Available").
    - Period: its PPER label (default "Week 5").
    - Position: "Position" when `All`, otherwise the position.
    - Team: "Teams" when `All`, otherwise the team code.
  - An unfilled pill whose menu is open gets `box-shadow: inset 0 0 0 1.5px var(--x-ink)`.
- Popover card:
  - Absolute, left/right 12px, `top:calc(100% + 4px)`, max-height 340px, `overflow-y:auto`.
  - Padding 12, radius 16, bg b0, gap 10, shadow `0 10px 30px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.05)`.
  - Title row (`space-between`): the title in 12px/600 t3, plus "Reset" in 12px/600 `#0088FF`. Reset shows only when this key differs from its default (`hasReset`).
  - Options grid, gap 6. Columns: status 2, per 2, pos 4, team 4.
  - Option: 36px tall, padding 0 8px, radius 10, 13px/600. Selected is ink with `#fff` text; otherwise b2 with t1 text.

  | Key | Title | Options |
  |---|---|---|
  | status | "Show" | All players, Available, Free agents, Waivers, Rostered, My team |
  | per | "Stats for" | Week 5, Week 4, Season, 2025 |
  | pos | "Position" | All, QB, RB, WR, TE, FLEX, K, D/ST |
  | team | "NFL team" | "All teams", then the TC keys sorted: ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS |

#### Bottom dock (L627–644)

Both dock parts are `flex:none; position:relative; z-index:4`.

**League switcher** (only when `showSwitcher` = `scr==="league" && !prof && !trade && !settings`):
- Wrapper: `margin-top:-148px; padding:6px 8px; background:var(--x-dockA, rgba(29,29,31,.9))`. Its rendered height is 68px.
- Card:
  - Height 56px, radius 10px, bg `var(--x-mini,#3A3A3C)`, `box-shadow: inset 0 0 0 1px var(--x-miniline,transparent)`.
  - Colour `#fff`, `touch-action:none`, `user-select:none`, `cursor:grab`, `overflow:hidden`.
- Grab handle: absolute top 4px, centered, 28×3, radius 999, `rgba(255,255,255,.28)`.
- Content row: height 100%, padding `6px 16px 0`, gap 10px. This row translates and fades during a swipe: `transform:translateX({{ls.x}}); opacity:{{ls.op}}; transition:{{ls.tr}}`. It contains:
  - League avatar: 34×34, radius 10, 12px/600, text `lg.avFg`, bg `lg.av`.
  - Text: `lg.team` in 14px/600, then `lg.rec` in 12px/500 `rgba(255,255,255,.62)`. Second line `lg.name` in 11px/500 `rgba(255,255,255,.62)`.
  - Dots, gap 4px: height 6px, radius 999, `transition:width .2s linear`. The active dot is 14px wide with bg `var(--x-b0,#fff)`; inactive dots are 6px wide, `#636366`.
  - Chevron-up 14px `M4 10l4-4 4 4`, `rgba(255,255,255,.62)`, stroke 2.
- Position measured from the phone bottom: tab bar 0–80px, switcher wrapper 80–148px, card 86–142px.

**Tab bar:**
- `margin-top:{{barMt}}`: `0` when the switcher shows, otherwise `-80px`, so the screen content runs under the bar.
- Height 80px, padding `6px 8px 0`, `display:flex`, bg `var(--x-barA, rgba(29,29,31,.94))`.
- Items: flex 1, height 48px, column, centered, gap 3px. Icon 22px at stroke 1.5. Label 10px/600.
- Colour is `#fff` when on and `#A1A1A6` when off.
- Profile avatar item: 22px circle, bg `myAv` (default `#0088FF`), "D" in 10px/600 white. When on it gets the ring `0 0 0 2px var(--x-ink,#1D1D1F), 0 0 0 3.5px var(--x-b0,#fff)`.

**Scroll clearance:**
- Every `.fsm-scroll` whose inline style contains `overflow-y` gets an `::after` spacer of height `var(--x-dockpad)` (L21).
- `.dock-lg` sets 150px when `scr==="league" && !prof && !trade && !settings`. `.dock-sm` sets 84px otherwise (L22).
- These classes sit on the phone root (`themeCls`), so every overlay scroller inherits them, and so does the **sheet body scroller** (L651). Every bottom sheet opened on League ends with **150px of blank space**; elsewhere it is 84px.
- Overlays opened over League that do not hide the switcher (team view, page, global search, community detail, composer, picker) also get the 150px spacer.

**Toast** (L1117):
- `position:absolute; left:50%; bottom:100px; transform:translateX(-50%); z-index:30`.
- Height 36px, padding 0 16px, radius 999, bg `var(--x-ink,#1D1D1F)`, white 13px/500, `white-space:nowrap`.
- It occupies 100–136px from the bottom. **On league screens this lies inside the switcher card's band (86–142px), so the toast covers the centre of the switcher card**, including during the "Switched to …" toast. On other screens it floats 20px above the 80px tab bar.

#### Sheet container (L646–727)
- Scrim: `position:absolute; inset:0; z-index:20; background:rgba(0,0,0,.32)`, flex aligned to the end. Tapping it calls `closeSheet`. The README says `.4`; the code uses `.32`.
- Panel: width 100%, `max-height:86%`, column, radius `24px 24px 0 0`, bg `var(--x-b0)`, padding `8px 0 30px`. `onClick={{stop}}` stops propagation, so taps inside never reach the scrim.
- Grab handle: 36×5, radius 999, `var(--x-b4,#D1D1D6)`; wrapper padding `2px 0 8px`. **It is decorative.** There is no drag-to-dismiss and no pointer handlers on the panel.
- A sheet closes only by:
  - a scrim tap
  - the "leagues" X
  - "Done" (filters and grid)
  - an action inside it
- Title row: padding `4px 16px 12px 20px`, gap 12. Title 19px/600, −0.02em. Optional sub 13px/500 t3. The "leagues" X is a 32px circle, bg b2 (active b3), with a 14px X at stroke 2.2.
- Body: scrollable `.fsm-scroll` (gets the dock spacer, see above).
- "Done" footer (filters and grid only): wrapper padding `12px 20px 0`; button 50px tall, radius 999, `#0088FF` (active `#0074DB`), 16px/600 white.

**Menu sheet content** (L703–716):
- **My team card** (→ My team page):
  - Margin `0 12px 14px`, padding 12, gap 12, radius 16, bg b1, active `var(--x-b2,#EDEDF0)`.
  - Avatar 44px circle, 16px/600, `#fff` on `myTeam.av`, text `myTeam.ini`.
  - Name 15px/600 with ellipsis.
  - Sub "My team · edit name and avatar", 12px/500 t3.
  - Chevron 12px t5 `M6 3l5 5-5 5`, stroke 2.
- **Section label** `{{lg.name}}`: 12px/600 t3, padding `0 20px 6px`.
- **League items**: container padding `0 12px 14px`. Each row:
  - 48px tall, padding 0 8px, gap 12, radius 12, active bg `var(--x-b2,#F2F2F4)`.
  - Icon tile 32px, radius 9, bg b2, holding a 16px icon in t1 at stroke 1.5.
  - Label flex:1, 15px/600.
  - The **sub is a trailing value on the same line**, placed just before the chevron: 12px/500 t3, nowrap. It is not stacked under the label.
  - Chevron 12px t5 at stroke 2.

  | Label | Trailing value | Icon path | Tap |
  |---|---|---|---|
  | League settings | 12 teams | `ICON.leaders` `M3 13V9h3v4M6.5 13V5h3v8M10 13V7.5h3V13` | page `general` |
  | Scoring | Standard | `M3 13h10M5 10V6M8 10V3M11 10V7` | page `scoring` |
  | Playoffs | Weeks 15–17 | `M3 3.5h3v3H3zM3 9.5h3v3H3zM6 5h2.5v6H6M8.5 8H13` | page `playoffs` |
  | Draft results | Aug 30 | `ICON.lists` `M3 4h10M3 8h10M3 12h6` | page `draft` |
  | League history | Since 2023 | `M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5` | page `history` |
  | Previous seasons | 3 | `ICON.sched` `M3 4.5h10v8.5H3zM3 7.5h10M6 3v3M10 3v3` | page `seasons` |
  | Notifications | (empty) | bell `M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14h3` | toast |
  | Co-owners | None | `M6 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13c.4-2 2-3.2 4-3.2s3.6 1.2 4 3.2M11 7.5a1.8 1.8 0 1 0 0-3.6M12 9.9c1.3.4 2.2 1.5 2.5 3.1` | toast |
  | Commissioner note | (empty) | `ICON.news` `M3.5 3.5h9v9h-9zM5.5 6h5M5.5 8.5h5M5.5 11h3` | toast |
  | Stat corrections | (empty) | `M3 13h10M4.5 10.5l6.8-6.8 1.5 1.5-6.8 6.8H4.5z` | toast |

- **"FieldScout" label** (12px/600 t3, padding `0 20px 8px`), then a 3-column grid (gap 8, padding `0 20px 8px`) of tiles:
  - Each tile is 76px tall, radius 16, bg b1, active `var(--x-b2,#EDEDF0)`, column centred, gap 6. 22px icon in t1 at stroke 1.5; label 12px/600.
  - Tiles:
    - Home: `ICON.home` `M2.5 7.5L8 3l5.5 4.5V13h-11z`.
    - Community: star `M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z`.
    - Stats: `M3 13V9h3v4M6.5 13V5h3v8M10 13V7.5h3V13`, the same path as ICON.leaders.
    - Profile: `ICON.profile` `M8 8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 14c.8-2.6 3-4 5.5-4s4.7 1.4 5.5 4`.
    - Settings: gear `M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1` (L1856).

**Switch league sheet** (L663–671): container padding `0 12px 6px`, gap 2. Each row:
- Min-height 60px, padding 8, gap 12, radius 14. Bg `var(--x-b1)` when selected, otherwise transparent; active b2.
- Avatar 40px, radius 12, 13px/600, text `o.avFg` on `o.av`.
- `o.team` in 15px/600, plus `o.rec` in 12px/500 t3.
- Second line "`name · sub`" in 12px/500 t3.
- Selected check: 18px `#0088FF` at stroke 2.2, path `M3 8.5l3.2 3L13 4.5`.
- Footer hint: padding `8px 8px 0`, 12px/500 t3, centred.

---

### 3. Interactions: the transition table

#### (b) Transition table

"Returns to" describes what the close or back control on the destination does.

**Home** (`scr:"home"`)

| Trigger (element + copy) | To | State change | Back / close returns to |
|---|---|---|---|
| Logo tile + "FieldScout" | Home (no-op) | `{scr:"home", sheet:null}` | – |
| Search icon | Global search | `{gs:{q:"", scope:"all"}}` | "Cancel" → Home |
| Bell | Notifications | `goNotifs` → `prevScr:"home"` | "Back" → Home |
| Chat bubble | Messages | `goDms` → `prevScr:"home"` | "Back" → Home |
| My stuff tile "Rankings" | Profile, Rankings tab | `{scr:"me", sheet:null, meTab:"rankings"}` | Tab bar only |
| My stuff tile "Lists" | Profile, Lists tab | `{scr:"me", sheet:null, meTab:"lists"}` | Tab bar only |
| My stuff tile "Start/Sit" | Profile, Start/Sit tab | `{scr:"me", sheet:null, meTab:"ss"}` | Tab bar only |
| Matchups card "Sunday Funday League" | League › Match | `{scr:"league", tab:"match"}`. **Neither `lg` nor `mi` is reset**, so the header and switcher show the last selected league and the Match tab shows the last viewed matchup | Header Home icon → Home |
| Cards "Joy to Us", "Work League", "Family Bragging Rights" | – | `soon()` | – |
| "Join or create a league" | – | `soon()` | – |
| Trending players "See all" | League › Players | `{scr:"league", tab:"players", pf2:{...pf2, status:"avail"}, trendOpen:true, trendTab:"trend"}`. The existing `per`/`pos`/`team` filters are kept. If `team ≠ "All"` the Trending card stays hidden even though `trendOpen` is true (`showTrendCard` requires `team==="All"`). `trendTab` has no visible effect because `trendSeg` is unbound | Header Home icon → Home |
| Adds / Drops segmented | in place | `{homeTrend:"adds"\|"drops"}` | – |
| Trending row | Player profile | `openProf(name)` | X → Home |
| Injury news "See all" | – | `soon()` | – |
| Injury row | Player profile | `openProf(name)` | X → Home |
| Practice card "Mock draft" / "Start" | – | `soon()` | – |
| Tab bar Home / Community / Profile | that screen | `{scr:v, sheet:null}` | – |
| Tab bar Players | – | `soon()` (never highlights) | – |

**Community** (`scr:"community"`)

| Trigger | To | State change | Returns to |
|---|---|---|---|
| Logo + "FieldScout" | Home | `{scr:"home", sheet:null}` | – |
| Search icon | Inline search header | `{cmSearch:true}` | "Cancel" → `{cmSearch:false, cmQuery:""}` |
| "+" (Create) | Create sheet | `{sheet:"create"}` | Scrim → `{sheet:null}` |
| Tabs: For you / Following / Start or sit / Rankings / Lists | in place | `{cmTab:"all"\|"following"\|"poll"\|"rank"\|"list"}` | – |
| Topic pill | in place | `{cmTopic: on ? null : label}` (toggle) | – |
| "Updated by people you follow" row | **Other file** | `href = "FieldScout Mobile Lists and Rankings.dc.html#view-<id>"` | The other file's back control or tab bar loads the main file at its initial state |
| Shelf "Start or sit · Week 5" › "See all" | in place | `{cmTab:"poll"}` | – |
| Shelf "Rankings this week" › "See all" | in place | `{cmTab:"rank"}` | – |
| Shelf "Lists for you" › "See all" | in place | `{cmTab:"list"}` | – |
| Ranking row | **Other file** | `#view-<id>` | (same) |
| List card | List detail | `{cmOpen:id}` | Back → `{cmOpen:null}` |
| Empty-state link "Browse For you" / "Clear filters" | in place | `{cmQuery:"", cmTab:"all", cmTopic:null}` | – |
| "Roster attached" row | in place | Toggle `cmRosterOpen[id]` | – |
| Tab bar | as on Home | | |

**Create sheet** (`sheet:"create"`)

| Trigger | To | State change | Returns to |
|---|---|---|---|
| "Start or sit" | Composer (poll) | `{sheet:null, cmp:{kind:"poll", qtype:"ss", q:"", mode:"start", pickN:1, opts:[null,null,null], give:[null], get:[null], roster:null, scoring:"PPR", close:"kickoff"}}` | X → Community |
| "Ranking" | **Other file** | `href = "...Lists and Rankings.dc.html#new-ranking"` | – |
| "List" | Composer (list, step 1) | `{sheet:null, cmp:{kind:"list", step:1, name:"", desc:"", pub:true, players:[], videos:[], link:"", color:"#0088FF"}}` | X → Community |
| Scrim tap | – | `{sheet:null}` | – |

**Composer** (`cmp`, z 27)

| Trigger | To | State change | Returns to |
|---|---|---|---|
| X (poll, or list step 1) | underlying screen | `{cmp:null}` | – |
| Chevron (list step 2) | list step 1 | `cmp.step = 1` | – |
| Qtype segmented "Start or sit" / "Trade" (poll) | in place | `cmp.qtype` | – |
| "Post" (poll) | underlying screen. **`scr` is not changed** | Enabled per the composer table in §2. `post()` sets `{cmMine:[new,...], cmp:null, pick:null, cmTab:"all", cmTopic:null, cmQuery:"", cmSearch:false}` and toasts "Posted to Community" | – |
| "Next" in the header (list step 1), the in-body **"Create"** button, or Enter in the name field | list step 2 | `cmp.step = 2`; enabled when the trimmed name is non-empty | – |
| "Save" (list step 2) | underlying screen | Enabled when the name is non-empty. Calls `post()` as above | – |
| **Empty** slot "Choose player N" / "Add a player you give" / "Add a player you get" | Picker (single) | `{pick:{mode:"single", target:"poll"\|"give"\|"get", idx:i, q:"", pos:"All"}}` | Back → composer |
| **Filled** slot name block (L997/L1000/L1006) | Picker (single) | Same as an empty slot. The chosen player replaces that index | Back → composer |
| Option slot remove (X) | in place | When there are more than 2 options the slot is removed; otherwise it is set to `null` | – |
| Give/get slot remove (X) | in place | When there is more than 1 slot it is removed; otherwise the list resets to `[null]` | – |
| "Add another option" | in place | Appends `null`. Shown only while `opts.length < 6` | – |
| "Add another" (give / get) | in place | Appends `null`. No limit | – |
| List step 2 "Add players" header link (L1060), **or** the "Add players" empty-state button (L1062, only while no players) | Picker (multi) | `{pick:{mode:"multi", target:"list", q:"", pos:"All"}}` | "Done" or back → composer |
| List step 2 Recommended row "+" (L1064) | in place, **no picker** | `cmp.players = [...players, n]` | – |

**Picker** (`pick`, z 28)

| Trigger | State change |
|---|---|
| Back chevron, or "Done" (multi) | `{pick:null}` |
| Row, single mode | Writes the player into `cmp[key][idx]`, then `{pick:null}` |
| Row, multi mode | Toggles membership; the picker stays open |
| Position chips, search | Update `pick.pos` / `pick.q` |

**Profile** (`scr:"me"`)

| Trigger | To | State change |
|---|---|---|
| Dark/Light pill | theme | `toggleDark`: writes `localStorage["fieldscout-theme"]` and sets `{dark}` |
| Segmented Rankings / Lists / Start/Sit | in place | `{meTab}` |
| Rankings item | **Other file** | `href = "...#mine"` |
| Lists item | **Other file** | `href = "...#lists"` |
| Start/Sit item | My start/sit | `{scr:"myss", ssTab:"all"}` |
| Bottom button "New ranking" | **Other file** | `#new-ranking` |
| Bottom button "New list" | **Other file** | `#new-list` |
| Bottom button "Ask a question" | Composer (poll) | `ssNew`: `{sheet:null, cmp:{kind:"poll", qtype:"ss", ..., roster:0, scoring:"PPR", close:"kickoff"}}`. `roster:0` means the roster attachment is on, unlike Create, which uses `null` |

**My start/sit** (`scr:"myss"`)

| Trigger | To | State change |
|---|---|---|
| Back chevron | **Home**, not Profile | `goHome` |
| "+" | Composer (poll) | `ssNew` (as above) |
| All / Open / Closed chips | in place | `{ssTab}` |
| League tab bar (shown here, see §4c) | League | as the League tab bar |

**League shell** (`scr:"league"`)

| Trigger | To | State change | Returns to |
|---|---|---|---|
| Header Home icon | Home | `goHome` | – |
| Header Search | Global search | `{gs:{q:"", scope:"all"}}` | Cancel → League |
| Header Bell | Notifications | `goNotifs` (`prevScr:"league"`) | Back → League (same `tab`) |
| Header Chat | Messages | `goDms` (`prevScr:"league"`) | Back → League |
| Tab bar Match / Team / Players / League (on any screen that shows the league tab bar) | League tab | `{scr:"league", tab:v, sheet:null, swap:null}`. It also adds `mi:0` **whenever `v==="match"` and `tab` is already `"match"`, whatever `scr` is** (L1709). So a re-tap on Match resets to "Your matchup", and so does tapping Match from Feed, Transactions, Messages, Conversation, Notifications or My start/sit while `tab` is still `"match"`. Feed's back chevron (`backLeague`) does not reset it | – |
| Tab bar Menu | Menu sheet | `{sheet: sheet==="menu" ? null : "menu"}` | Scrim → `{sheet:null}` |
| Switcher tap, or swipe up | Switch league sheet | `{sheet:"leagues"}` (thresholds in the gesture spec below) | X or scrim → `{sheet:null}` |
| Switcher swipe left / right | in place (next / previous league) | Toasts "Switched to `<LEAGUES[n].team>`" **immediately on release**, then animates. `lg` changes 140 ms later. Wraps: `lg = (lg ± 1 + 4) % 4` | – |

**Match tab** (`tab:"match"`)

| Trigger | To | State change | Returns to |
|---|---|---|---|
| Horizontal drag anywhere on the swipe wrapper (dots, card, "Yet to play", Starters header, stepper and compare list; L249–299) | Next / previous matchup | `mi = (mi ± 1 + 6) % 6` (6 matchups) | – |
| Dot | that matchup | `{mi:k}` (no slide animation) | – |
| Team name in the matchup card: "Touchdown Tacos" (TEAMS[0]) | League › Team | `openTeam(0)`; `stopPropagation` first | – |
| Team name in the matchup card: any other team | Team view overlay | `{teamView:i}` | Back → Match |
| Live-play row ("Q4 6:50 · 2nd & 7 @ NO 44 / D. Vele 9 yd catch / Live / +0.9") | Live feed, game MIN @ NO | `goFeed`: `{scr:"feed", game:"min", gtab:"plays"}`. The same row and target for every `mi` | Back → League › Match at the same `mi` |
| Week ‹ / › | in place | `week = max(1, week−1)` / `min(17, week+1)`. This changes the label only; the data does not change | – |
| Starter cell, either side | Player profile | `openProf(full)`; empty cells do nothing | X → Match |

**Team tab** (`tab:"team"`)

| Trigger | To | State change | Returns to |
|---|---|---|---|
| Action tile "Schedule" | – | `soon()` | – |
| Action tile "Trade" | Trade builder | `openTrade(1, [])` (opponent Gridiron Gurus) | X → Team |
| Action tile "Moves" | Transactions ("My moves") | `{scr:"trans", tMine:true, tType:"All"}` | X → League › Team |
| Action tile "News" | – | `soon()` | – |
| Slot chip (QB, RB…, BN) | Swap sheet | `{sheet:"swap", swapFor:{t:"s"\|"b", i}}`. The chip gets the ring `0 0 0 2px #fff, 0 0 0 4px #0088FF` while the sheet is open | Scrim → Team |
| Player name block | Player profile | `openProf(n)`. On an empty row this opens the swap sheet instead | X → Team |

**Swap sheet** (`sheet:"swap"`)

| Trigger | State change |
|---|---|
| Selected (top) row | no-op |
| Candidate row (starters, then a "Bench" heading, under "Choose a player to swap") | Swaps `slots`/`bench`, then `{sheet:null, swapFor:null}`, with one of these toasts: "Swapped A and B", "Moved A to bench", "Moved A to `<slot>`" or "Moved B to `<slot\|bench>`" |
| No candidates | Shows "No eligible players for this slot" |
| Scrim | `{sheet:null}` (`swapFor` is kept but not shown) |

Swap eligibility (L1642–1650). A candidate `(t2, i2)` is offered only when all of these hold:
1. It is not the selected slot itself.
2. At least one of the two positions is non-empty.
3. The selected player fits the candidate's slot.
4. The candidate's player fits the selected slot.

`fits(slot, n)` is true when the position is empty or `slot==="BN"`. Otherwise FLEX accepts RB/WR/TE and every other slot needs an exact position match. Among empty bench slots, only the first one is offered.

**Players tab** (`tab:"players"`)

| Trigger | To | State change |
|---|---|---|
| Filter pill (status / period / position / team) | Quick-pick popover | `{pmenu: pmenu===k ? null : k}` |
| Popover option | in place | `{pf2:{...pf2, [k]:v}, pmenu:null}` |
| Popover "Reset" (shown only when that key is not at its default) | in place | Resets **only the open key**: status→`"avail"`, per→`"w5"`, pos→`"All"` or team→`"All"`. Then `pmenu:null` |
| Any tap outside the card (fixed transparent scrim, including header, switcher and tab bar) | – | `{pmenu:null}` only |
| "Trending" header | in place | `{trendOpen:!trendOpen}` |
| Trending tile name **or headshot** (both inside one `openP` block, L361) | Player profile | `openProf(n)` |
| List / Cards / Sheet row **name block only** (L379, L394, L408). The FSHeadshot in these views has no handler | Player profile | `openProf(n)` |
| Tile button or row circle, kind trade ("Trade" / "Propose trade") | Trade builder | `openTrade(ownerOf(n).ti, [n])` |
| Tile button or row circle, kind add / waiver / drop | – | Toast "Add: `<n>`", "Claim off waivers: `<n>`" or "Drop: `<n>`" |
| View toggle (List / "Stats under each player" / Sheet) | in place | `{pview}` |
| "Customize" | Customize stats sheet | `{sheet:"grid"}`; "Done" or scrim → `{sheet:null}` |
| Stat cell (list strip / cards strip) | Col tip | `{colTip:k}` |
| Sheet-view column header | Col tip (toggle) | `{colTip: colTip===k ? null : k}` |
| Col tip "Sort by this" | in place | `{psort:k, colTip:null}`. When the column is already sorted the label reads "Sorted by this" and the button still closes the tip |
| Col tip X or scrim | – | `{colTip:null}` |

**League tab** (`tab:"league"`)

| Trigger | To | State change |
|---|---|---|
| Segmented Matchups / Standings / Activity | in place | `{ltab}` |
| Matchup card (whole card; the names on this tab are not separately tappable) | League › Match at that matchup | `{tab:"match", mi:k}` |
| Standings row | My team → Team tab; any other team → Team view | `openTeam(t.i)` |
| Activity "Filter" pill | Transaction filters sheet | `{sheet:"filters"}`. The Activity tab renders **only** this pill; there is no transaction list in the markup (L445–450) |

**Transaction filters sheet** (`sheet:"filters"`)
- Type chips "All types" / "Trades" / "Free agents" / "Waivers": `{tType}`.
- Team rows (hidden for My moves): toggle `tTeams`. "All teams" clears the list.
- "Done" or scrim: `{sheet:null}`.

**Menu sheet** (`sheet:"menu"`). The Menu tab is on **every** league-set screen (`myss`, `feed`, `trans`, `dms`, `thread`, `notifs` as well as `league`). This sheet, its Page overlays and its FieldScout tiles can therefore open over Messages, Feed and the rest. Page back returns to whichever screen it was opened over.

| Trigger | To | State change | Returns to |
|---|---|---|---|
| My team card | Page "My team" | `openMyTeam`: `{sheet:null, page:"myteam", draftName:myName, draftAv:myAv}` | Back → underlying screen (menu not reopened) |
| "League settings" | Page "League settings" | `{sheet:null, page:"general"}` | Back → underlying screen |
| "Scoring" | Page | `{sheet:null, page:"scoring"}` | Back → underlying screen |
| "Playoffs" | Page | `{sheet:null, page:"playoffs"}` | Back → underlying screen |
| "Draft results" | Page | `{sheet:null, page:"draft"}` | Back → underlying screen |
| "League history" | Page | `{sheet:null, page:"history"}` | Back → underlying screen |
| "Previous seasons" | Page | `{sheet:null, page:"seasons"}` | Back → underlying screen |
| "Notifications", "Co-owners", "Commissioner note", "Stat corrections" | – | Toast "`<label>`: screen coming next" (sheet stays open) | – |
| Grid "Home" | Home | `{scr:"home", sheet:null}` | – |
| Grid "Community" | Community | `{scr:"community", sheet:null}` | – |
| Grid "Profile" | Profile | `{scr:"me", sheet:null}` | – |
| Grid "Stats", "Settings" | – | `soon()` | – |
| Scrim | – | `{sheet:null}` | – |

**Switch league sheet** (`sheet:"leagues"`)
- League row: `{lg:i, sheet:null}`. If `i !== lg`, it toasts "Switched to `<team>`".
- X or scrim: `{sheet:null}`.

**Page overlay** (`page`, z 25)
- Back chevron: `{page:null}`.
- My team "Save" (enabled only when the trimmed name is non-empty and the name or colour changed):
  - Mutates `TEAMS[0]` and `LEAGUES[0].team`.
  - Sets `{myName, myAv, page:null}`.
  - Toasts "Team updated".
- My team "Upload photo": toast "Photo upload: not part of this prototype".
- Draft "Round N" chips: `{draftRd}`. History season chips: `{histYr}`.
- A Previous seasons row: toast "`<year>` season: opens the archived league".

**Live feed** (`scr:"feed"`)

| Trigger | State change |
|---|---|
| Back chevron | `backLeague` → `{scr:"league", tab:"match"}` (`mi` kept) |
| Game chip ("My players" or a game) | `{game:id, gtab:"plays"}` |
| Play row | `{game:<that play's game id>, gtab:"plays"}`. From "My players" this jumps into that game's feed |
| "Play by play" / "Box score" | `{gtab}` (the segmented control shows only when `game !== "mine"`) |
| Box-score row | Toast "`<name>` · player card" |

**Transactions** (`scr:"trans"`)
- X: `backTeam` → **always League › Team**, even when the screen was reached from the Team view's "See all".
- "Filter" / "Filter · N": `{sheet:"filters"}`.
- Empty state "Clear filter": `{tType:"All", tTeams: myMoves ? tTeams : []}`.

**Messages** (`scr:"dms"`)

| Trigger | State change |
|---|---|
| "Back" | `{scr: prevScr \|\| "league"}` |
| Compose (pencil) | `soon()` |
| Search input (placeholder "Search") | `{dmQuery}`. Filters the trade cards and the conversation rows, **but not the avatar strip** (`dmPeople`, L1849) |
| All / Trades | `{dmFilter}`. The avatar strip and the conversation rows show only under All; the trade cards only under Trades |
| Avatar in the strip, or conversation row | `openConvo(id)` → Conversation |
| Trade card | `{tradeOpen:id}` → Trade detail |
| Card "Decline" / "Accept" (`stopPropagation`; shown only on incoming Pending cards) | Sets `tradeStatus[id]` and toasts "Trade declined" or "Trade accepted with `<Name>`" |
| Card "Counter" | `openTrade(c.ti \|\| 1, [])` → an empty builder (unlike Trade detail Counter, which pre-fills) |

**Conversation** (`scr:"thread"`)
- Back chevron: `goDms` → Messages; `prevScr` is kept.
- Info icon and "+": `soon()`.
- "Send" (shown only when the input has text) or Enter: appends `["me",0,text]` to `threads[convo]`.

**Notifications** (`scr:"notifs"`)
- "Back": `{scr: prevScr || "league"}`.
- "Mark all read": `{notifRead:true}`.
- Row 1 "Trade offer from Marcus": `{tradeOpen:"marcus"}` → Trade detail over Notifications.
- Row 2 "@shahranks updated Week 5 · RB · PPR": **other file**, `#view-r1`.
- Rows 3–6: toast with the row title.

**Team view** (`teamView`, z 21)

| Trigger | State change |
|---|---|
| Back chevron | `{teamView:null}` |
| "Message" | `{teamView:null}`, then `openConvo(cv.id)` if a convo exists for that team (marcus, priya, leo, nina, devin, raj); otherwise toast "New message to `<@mgr>`" |
| "Propose trade" | `openTrade(ti, [])` → builder on top (z 24); X returns to Team view |
| Starter or bench row | `openProf(n)` → profile on top (z 22); X returns to Team view. Empty rows do nothing |
| Recent moves "See all" | `{teamView:null, scr:"trans", tMine:false, tType:"All", tTeams:[ti]}` |

**Player profile** (`prof`, z 22)

| Trigger | State change |
|---|---|
| X | `{prof:null}` |
| Action pill "Drop" (my player) | Toast "Drop `<n>`: not part of this prototype" |
| Action pill "Propose trade" (another team's player) | `openTrade(own.ti, [n])` → builder over the profile |
| Action pill "Add" / "Claim off waivers" | Toast "Added `<n>`" / "Claim placed: `<n>`" |
| "+ List" | Toast "Choose a list for `<n>`" |
| Tabs: Summary / Game log / Leagues / Transactions / Team / History | `{pfTab}` |
| Ownership row | `{pfTab:"leagues"}` |
| Section headers "Key stats" / "Games and projections" / "Recent news" | Toggle `pfCol[k]` |
| Key stat tile | no-op (`tip: () => {}`) |
| ‹ / › (26px circles in the games header) | Scroll the games strip ±208px, smoothly; `stopPropagation` |
| Leagues tab "Trade" (league 0, other owner) | `openTrade` |
| Leagues tab "Trade" (other leagues) | Toast "Trade builder for `<League>`" |
| Leagues tab "Add" / "Claim" | Toast "Added in `<League>`" / "Claim placed in `<League>`" |
| Leagues tab "Add to queue" | Toast "Added to your `<League>` queue" |
| Year chips | `{pfYear}` |
| League chips (Transactions tab) | `{pfTxLg}` |

**Trade builder** (`trade`, z 24)
- X: `{trade:null}`, revealing whatever is underneath.
- Opponent chip: `{trade.opp:i, theirs:[]}`.
- Tile: toggles membership.
- "View proposal": goes to the review step only if both sides are non-empty; otherwise toasts "Pick at least one player from each team".
- "Edit players": `review:false`.
- "Offer expires in" select: `exp`. Toggles: `hide`, `dm`.
- **"Send trade proposal"**: `{trade:null, prof:null}` and toast "Trade proposal sent to `<@mgr>`". This also closes the profile but **not** the Team view. It does **not** add anything to `TRADES`.

**Trade detail** (`tradeOpen`, z 23)

| Trigger | State change |
|---|---|
| X | `{tradeOpen:null}` |
| Opponent name | `{tradeOpen:null}`, then `openTeam(c.ti \|\| 1)` → Team view |
| My name | no-op |
| Player asset | `openProf(n)`. **Bug: the profile (z 22) renders under the still-open detail (z 23)** |
| Pick asset | no-op |
| "Hide usernames for screenshots" | `{tdHide}` |
| "Message `<@mgr>`" | `{tradeOpen:null}`, then `openConvo(id)` |
| "Decline" | Sets `tradeStatus[id]`, then `tradeOpen:null`; toast "Trade declined" |
| "Accept" | Same pattern; toast "Trade accepted with `<@mgr>`" |
| "Withdraw offer" (outgoing pending) | Sets the status to "Declined" and toasts "Offer withdrawn". **Unreachable with the shipped data**: TRADES has no outgoing Pending trade (devin is out/Declined, leo is out/Accepted, L1195), `tradeStatus` only ever becomes Accepted or Declined, and "Send trade proposal" never adds to TRADES |
| "Counter" | `{tradeOpen:null, trade:newTrade(c.ti\|\|1, gets without picks, gives without picks)}` |

**Global search** (`gs`, z 29)

| Trigger | State change |
|---|---|
| "Cancel" | `{gs:null}` |
| Clear (x) | `q:""` |
| Scope chips All / Players / People / Posts | `scope` |
| "Recent" row or "Trending" pill | Sets `q` |
| Player result | `{gs:null}`, then `openProf` |
| Person result, league member. The list is built from `TEAMS.slice(1)`, so `ti` is always 1–11 (L1476) | `{gs:null}`, then `openTeam(ti)` → **always the Team view overlay**, never League › Team |
| Person result, community user | `{gs:null, scr:"community", cmTab:"all", cmQuery:<handle>, cmSearch:true}` |
| Post result "Start or sit" | `{gs:null}`, then `{scr:"community", cmTab:"poll"}` |
| Post result "Ranking" | Other file `#view-<id>` |
| Post result "List" | `{gs:null}`, then `{scr:"community", cmOpen:id}`. The detail's Back returns to **Community**, not to the screen where the search started |

**Community detail** (`cmOpen`, z 26)
- Back: `{cmOpen:null}`.
- Follow / Following: toggles `cmFollow[by]`.
- Save / Saved: toggles `cmSaved[id]`.
- Share: toast "Link copied".
- Video card: toast "Opens in YouTube".
- Player rows are **not** tappable.

**Settings overlay** (z 23, unreachable)
- X: `{settings:false}`.
- Tiles that have a page key (My team, General, Scoring, Playoffs, Draft results, League history, Previous seasons) set `{page:k, draftName, draftAv}`.
- Other tiles toast "`<label>` settings: screens coming next".

#### Gesture specs

**Matchup swipe** (`mx`, L1728–1733). Wrapper style: `touch-action:pan-y; user-select:none`. There is no pointer capture.
1. **pointerdown:** record `{x, y, h:null}`.
2. **pointermove:** once |dx| > 8 or |dy| > 8, lock the axis: `h = |dx| > |dy|`. If horizontal, set `mxAnim:false, mxDx = clamp(dx, −180, 180)`.
3. **pointerup:** if horizontal and |dx| > 60, call `step(dx<0 ? +1 : −1)`. Otherwise, if `mxDx ≠ 0`, animate back to 0.
4. **pointercancel:** animate to 0.
5. **`step(d)`:**
   - Set `mxAnim:true`, `mxDx = d>0 ? −160 : 160`.
   - After 140 ms: update `mi`, set `mxAnim:false`, `mxDx = d>0 ? 160 : −160`.
   - After two `requestAnimationFrame`s: set `mxAnim:true, mxDx:0`.
   - Net effect: the content slides out, then slides in from the opposite side.
6. **Rendering:** `translateX(mxDx px)`, `opacity = max(.35, 1 − |mxDx|/320)`. `transition = "transform .14s linear, opacity .14s linear"` while animating, otherwise `none`.
7. **Dots:** active 14px wide `var(--x-ink)`; inactive 6px `var(--x-b4,#D1D1D6)`; height 6px, gap 4px, `transition: width .2s linear`.
8. **No click suppression.** The `onClick`s on the team names, starter cells, dots, Week ‹ › and the live-play row all sit inside the dragged wrapper. The content tracks the pointer (up to ±180px), so a mouse drag that starts on one of them usually ends over the same element. Its click then also fires after the swipe (opening a profile, team view or the feed, or changing week or dot). The prototype does nothing to stop this on touch either. The rebuild needs an explicit rule.

**League switcher** (`ls`, L1771–1776). Card style: `touch-action:none`. There is no `onClick`; a tap is detected in pointerup.
1. **pointerdown:** record `{x, y}`, call `setPointerCapture`, set `lsAnim:false`.
2. **pointermove:**
   - If |dx| > |dy|: `lsDx = clamp(dx, −140, 140)`.
   - Otherwise, if dy < −24: stop tracking and set `{lsDx:0, sheet:"leagues"}`. A swipe up opens the sheet mid-gesture.
3. **pointerup:**
   - If |dx| > 50 and |dx| > |dy|: `step(dx<0 ? +1 : −1)`.
   - Otherwise, if (|dx| < 8 and |dy| < 8) **or** dy < −24: open the sheet (`{lsDx:0, lsAnim:true, sheet:"leagues"}`).
   - Otherwise snap back (`lsDx:0, lsAnim:true`).
4. **pointercancel:** snap back.
5. **`step(d)`:**
   - The next league is `n = (lg + d + 4) % 4`.
   - Set `lsAnim:true` and slide out: `lsDx = d>0 ? −120 : 120`.
   - **Toast "Switched to `<LEAGUES[n].team>`" synchronously, at release.**
   - After 140 ms, set `lg = n`, `lsAnim:false`, and jump to ±120 on the opposite side. After two rAFs, animate to 0.
6. **Rendering:** `opacity = max(.2, 1 − |lsDx|/200)`, transition `transform .14s linear, opacity .14s linear` while `lsAnim`.

**Animations.** Overlays and sheets mount and unmount instantly. There is no slide-in, fade or scrim fade, and no drag-to-dismiss. The full list of motion:
- The two swipe animations above (.14s linear).
- Dot width on the matchup and switcher dots (`.2s linear`).
- Toggle-switch backgrounds (`.2s linear`, L847, L885, L1012, L1054).
- Live-feed play-row background (`.4s linear`, L491).
- Community poll vote bars (`width .25s linear`, L164, L166, L200, L202).
- The profile games strip, which uses `scroll-behavior:smooth` for ‹ › (±208px, L772). Its initial position, `scrollLeft = gIdx*208` (the card before Week 5, normally Week 4), is set instantly by turning smooth scrolling off for that one assignment (L1335).

**Toast.** Only one toast shows at a time; a new one replaces the old and restarts the 1800 ms timer. For geometry and the overlap with the switcher, see §2.

---

### 4. Navigation

#### (c) Dock state on every screen

`inLg = !["home","community","me"].includes(scr)` (L1708). So **every** `scr` except Home, Community and Profile gets the league tab bar.

| Screen (`scr`) | Tab bar set | Highlighted item | League switcher | Scroll spacer |
|---|---|---|---|---|
| `home` | Home · Community · Players · Profile (avatar) | Home | hidden | 84px |
| `community` | same | Community | hidden | 84px |
| `me` | same | Profile (avatar ring) | hidden | 84px |
| `league` (any tab, no prof/trade/settings) | Match · Team · Players · League · Menu | Current `tab`. If `sheet==="menu"`, **Menu** is lit and the tab is not | **shown** | 150px |
| `league` with `teamView`, `page`, `gs`, `colTip` (or `cmOpen`/`cmp`/`pick`/`tradeOpen` left open by a JUMP) | same, covered by the overlay | same | **still mounted** (`showSwitcher` checks only prof/trade/settings, L1769), hidden under the overlay | **150px**, also inside those overlays' scrollers |
| `league` with `prof` or `trade` (or `settings`) open | same, covered by the overlay | same | **removed from the DOM**; tab bar margin −80px | 84px |
| `league` › Players with `pmenu` open | same | same | shown, but taps on it (and on the tab bar and header) hit the popover's invisible scrim and only close the popover | 150px |
| `myss` | **league set** (`inLg` is true) | none (Menu only while the menu sheet is open) | hidden | 84px |
| `feed`, `trans`, `dms`, `thread`, `notifs` | league set, **even when reached from Home** | none (Menu while the sheet is open) | hidden | 84px |

**Tab bar items:**
- Outside a league:

  | Item | Icon path | Tap |
  |---|---|---|
  | Home | `ICON.home` `M2.5 7.5L8 3l5.5 4.5V13h-11z` | `{scr:"home", sheet:null}` |
  | Community | star `M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z` | `{scr:"community", sheet:null}` |
  | Players | `ICON.players` `M5.5 6.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5` | `soon()` |
  | Profile | avatar "D" on `myAv` | `{scr:"me", sheet:null}` |

- Inside a league:

  | Item | Icon path |
  |---|---|
  | Match | `M2.5 4.5h4v7h-4zM9.5 4.5h4v7h-4zM8 3v10` |
  | Team | `ICON.players` `M5.5 6.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5` (person) |
  | Players | `ICON.search` `M7 2.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6zM10.6 10.6L14 14` (magnifier) |
  | League | `ICON.leaders` `M3 13V9h3v4M6.5 13V5h3v8M10 13V7.5h3V13` (bars) |
  | Menu | `M2.5 4h11M2.5 8h11M2.5 12h11` |

- On / off rule: `#fff` versus `#A1A1A6`. League tabs light only when `scr==="league" && tab===v && sheet!=="menu"`.
- All full-screen overlays (z ≥ 21) and the sheet scrim (z 20) cover the dock (z 4), and so does the Players popover scrim (z 7 inside the z 6 sticky bar). The tab bar is never tappable while any of these is open. In practice the Menu tab's "close" toggle is reached only through the sheet scrim.

#### (d) Overlay stacking rules

Paint order, bottom to top:
1. Base screen. The league header is not positioned.
2. Home indicator (positioned, no z-index).
3. Dock (z 4).
4. Players sticky filter bar (z 6), with its pmenu scrim (z 7, `position:fixed`) and card (z 8).
5. Sheet (z 20).
6. Team view (z 21).
7. Profile (z 22).
8. Settings and Trade detail (both z 23).
9. Trade builder (z 24).
10. Page (z 25).
11. Community detail (z 26).
12. Composer (z 27).
13. Picker (z 28).
14. Global search (z 29).
15. Col tip and Toast (both z 30). The toast is later in the DOM, so it paints on top.

Each overlay is its own state key, so **closing one reveals whatever is still set beneath it**. These stacks are reachable:

| Stack (bottom → top) | How | Closing order |
|---|---|---|
| League → Team view → Profile → Trade builder | Standings or matchup name → team row → "Propose trade" | Builder X → Profile; Profile X → Team view; back → League. "Send" clears both `trade` and `prof`, landing on the Team view |
| League → Team view → Trade builder | "Propose trade" | X → Team view |
| Any → Profile → Trade builder | Profile action "Propose trade" | X → Profile; Send → base |
| Messages / Notifications → Trade detail | Trade card / notification 1 | X → that screen |
| Trade detail → Team view | Opponent name (clears `tradeOpen` first) | Back → base screen |
| Trade detail → Trade builder | "Counter" (clears `tradeOpen`) | X → base screen |
| Trade detail + Profile | Asset tap. **The profile is hidden under the detail** until the detail is closed | X on detail → Profile is now visible → X → base |
| Trade detail + hidden Profile, then opponent name | Asset tap, then opponent name: `tradeOpen` clears and `teamView` (z 21) opens, but the still-set `prof` (z 22) paints **above** it | The user sees the profile, not the team view. Profile X → Team view → back → base |
| Messages → Trade builder | Card "Counter" | X → Messages |
| Community → Composer → Picker | Create → slot | Picker back → Composer; Composer X → Community |
| Profile / My start/sit → Composer → Picker | "Ask a question" / "+" | As above; Post stays on Profile / My start/sit |
| League (or any league-set screen) → Menu sheet → Page | Menu item (the sheet closes on open) | Page back → that screen, with no menu |
| League › Players → Col tip | Stat cell / header | X or scrim → Players |
| Home / League → Global search → (Profile \| Team view \| Community \| Community detail) | Result tap (search closes first) | Normal close of the destination; a community destination stays on Community |

Sheets are cleared by:
- every tab bar tap except Menu, which **toggles** the menu sheet
- `goHome`, `goDms`, `goNotifs`
- `backTeam`
- the Home "My stuff" tiles
- the Menu sheet "FieldScout" tiles and Menu league items with a page key
- `openMyTeam`
- Switch-league rows (`lgOptions`)
- `doSwap` on a swap candidate
- `closeSheet` (scrim, "Done", the leagues X)
- the Create sheet options and `ssNew`
- every JUMP (`go()`)

The global search, composer, picker, page and community detail are **not** cleared by the tab bar. They do not need to be, because they cover it.

#### (e) Entering and leaving league context

**Enter a league** (`scr` becomes `"league"`):
1. Home card "Sunday Funday League": tab Match. `mi` and `lg` are not reset, so it can open on the last-viewed matchup and the last-switched league label.
2. Home Trending "See all": tab Players, with the "Available" status filter, the other filters kept, and the trending card open (hidden if a team filter is set).
3. Any league-set tab bar tap from My start/sit, Feed, Transactions, Messages, Conversation or Notifications.
4. `backFromDms` when `prevScr === "league"` (the initial value).
5. Feed back (`backLeague`), Transactions X (`backTeam`).
6. `openTeam(0)`. This is reachable only from the "Touchdown Tacos" name on a Match card and from the 11th standings row ("Touchdown Tacos"). Global search cannot reach it, because its people list excludes TEAMS[0].

**Leave a league:**
1. League header Home icon.
2. Menu sheet tiles Home / Community / Profile.
3. Bell / Chat. These keep the league tab bar and set `prevScr:"league"`.
4. Live-play row (Feed) and Team "Moves" (Transactions). Both are league sub-screens without the switcher.
5. Global search from the League header:
   - A community-person result sets `{scr:"community", cmTab:"all", cmQuery, cmSearch:true}`.
   - A "Start or sit" post sets `{scr:"community", cmTab:"poll"}`.
   - A "List" post sets `{scr:"community", cmOpen:id}`.
   - All three drop the user onto Community with the outside tab bar. The List detail's Back returns to Community, not League.
   - A "Ranking" post leaves the file.

**Persistence.** `tab`, `mi`, `ltab`, `pf2`, `pview` and `lg` persist while the user is outside the league. Re-entering through the Home card always forces `tab:"match"`, but not `mi:0`.

**Relationship between the two tab bars:**
- They are two separate sets that **replace each other**; they never stack.
- The outside set (Home / Community / Players / Profile) has no league entry. Home's league card is the doorway.
- The league set has no Home, Community or Profile tabs. Those live in the **Menu sheet "FieldScout" grid** and the header Home icon.
- The outside "Players" tab is a dead toast. The league "Players" tab is a real screen.

**Switching league** (`lg`):
- Ways to switch: a switcher swipe, or a row in the Switch league sheet.
- What changes:
  - `lg.name` (the league header and the menu section label).
  - The switcher card (avatar, team, record, name, dots).
  - The Trade detail header chip: avatar `lg.av`/`lg.ini`, plus `td.league = LEAGUES[lg].sub`, the format string.
  - `tv.lgName` (the Team view sub-line).
  - Page General "League name".
- What does not change: matchups, rosters, players, standings and transactions all stay Sunday Funday data.

#### `prevScr` rules (the Messages / Notifications back stack)
- `goDms` and `goNotifs` record the current `scr` as `prevScr`, unless the user is already in `dms`, `thread` or `notifs`.
- `openConvo` (from Team view "Message", Trade detail "Message", or any DM row) never updates `prevScr`.
- Example: `prevScr` is still `"home"` from an earlier visit, and the user opens a Conversation from a Team view over League. Back goes to Messages, and Messages "Back" then goes to **Home**.
- JUMP-panel entries to `dms`, `thread` and `notifs` also leave `prevScr` untouched.

#### (f) Deep-link-like entry points

**JUMPS panel** (L1163; presentation-only, outside the phone). Each click calls `go(scr, tab, sub)` (L1628). `go` always sets `{scr, sheet:null, prof:null, trade:null, settings:false, tradeOpen:null, teamView:null}` and then applies:
- `scr==="trans"`: `tMine:false, tType:"All"`.
- `sub "profile"`: `prof:"Bijan Robinson", pfTab:"summary"`.
- `sub "trade"`: `trade:newTrade(1, ["Josh Allen"], ["Shedeur Sanders"])`.
- `sub "swap"`: `sheet:"swap", swapFor:{t:"s", i:3}` (the WR1 slot, A.J. Brown).
- `sub "settings"`: `settings:true`.
- `sub "tradeoffer"`: `tradeOpen:"marcus", dmFilter:"trades"`.
- `sub "convo"`: `convo:"marcus"`.
- `tab` given: sets `tab`.
- `league` + `players` + a `sub` other than grid: `ptab = sub`.
- `tab "league"` + `sub`: `ltab = sub`.
- `sub "grid"`, `"filters"`, `"chat"` or `"menu"`: the matching `sheet`.

`go` does **not** reset any of the following:
- `page`, `cmOpen`, `cmp`, `pick`, `gs`, `colTip`, `pmenu`.
- `tTeams`, so #13/#14 can show a stale team filter.
- `dmFilter`, so #16 after #24 opens on Trades.
- `game`, so #12 keeps the last game.
- `pfYear`, `pfAvail`, `pfCol` (#22 sets only `prof` and `pfTab`).
- `mi`, `msg`, `prevScr`.
- `unread` (#17).

**Highlight rule** (L1629):
- Rows with `sub "profile"` are lit when `prof && !trade`. Rows with `sub "trade"` are lit when `trade` is set.
- Every other row requires `!prof && !trade && !settings`, `scr` equal to the row's screen, and `tab` equal to the row's tab if the row has one.
- Its sub-check is `ptab===sub` for players rows (except grid), `ltab===sub` for league rows, and `sheet===sub` otherwise.
- Rows **without** a sub additionally require that no sheet is open, except Home.

| # | Label | Resulting state | When it is lit |
|---|---|---|---|
| 1 | Home · leagues | `scr:"home"` | whenever on Home (even with a sheet) |
| 2 | Community | `scr:"community"` | on Community while no sheet (the Create sheet unlights it) |
| 3 | Profile · lists & rankings | `scr:"me"` | on Profile, no sheet |
| 4 | Matchup | `scr:"league", tab:"match"` | Match tab, no sheet (lit at start) |
| 5 | Team | `tab:"team"` | Team tab, no sheet |
| 6 | Players · trending | `tab:"players", ptab:"trend"` | `ptab==="trend"` on the Players tab. The initial `ptab` is `"trend"` and nothing in the UI changes it, so #6 is lit **whenever the Players tab shows**, even with a sheet or popover open, and together with #15 when the grid sheet is open. The Players list ignores `ptab` |
| 7 | Players · available | `tab:"players", ptab:"avail"` | after clicking it; it then stays lit on the Players tab (#6 goes off). The list does not change |
| 8 | Players · leaders | `tab:"players", ptab:"leaders"` | as #7 |
| 9 | League · matchups | `tab:"league", ltab:"matchups"` | `ltab` matches, even with a sheet open |
| 10 | League · standings | `ltab:"standings"` | as #9 |
| 11 | League · activity | `ltab:"activity"` | as #9 |
| 12 | Live plays | `scr:"feed"` (`game` unchanged; initially `"mine"`) | on Feed, no sheet |
| 13 | Transactions | `scr:"trans", tMine:false, tType:"All"` → "League transactions" | on Transactions, no sheet. Also lights for "My moves" |
| 14 | Transaction filters | as #13, plus `sheet:"filters"` | `scr:"trans"` with the filters sheet open (not the Activity-tab filters sheet) |
| 15 | Player grid settings | `scr:"league", tab:"players", sheet:"grid"` | grid sheet open on Players |
| 16 | Messages | `scr:"dms"` | on Messages, no sheet |
| 17 | Conversation | `scr:"thread", convo:"marcus"` (`unread.marcus` **not** cleared) | never (it checks `sheet==="convo"`) |
| 18 | Notifications | `scr:"notifs"` | on Notifications, no sheet |
| 19 | Menu · leagues & app | `tab:"match", sheet:"menu"` | Match tab with the menu sheet open; always lit **together with #25**. Not lit if the menu was opened from another tab |
| 20 | League switcher | `tab:"match"`. **`go` does not handle `sub "leagues"`, so the sheet does NOT open** | only if the leagues sheet was opened by gesture while on the Match tab |
| 21 | Swap player | `tab:"team", sheet:"swap", swapFor:{t:"s", i:3}` | swap sheet open on Team |
| 22 | Player profile | `tab:"team", prof:"Bijan Robinson"` | whenever any `prof` is open and `!trade` |
| 23 | Propose a trade | `tab:"team"`, builder with opponent 1 Gridiron Gurus, theirs ["Josh Allen"], mine ["Shedeur Sanders"] | whenever `trade` is set |
| 24 | Trade offer | `scr:"dms", dmFilter:"trades", tradeOpen:"marcus"` | never |
| 25 | Menu · league settings | identical to #19 | always together with #19 |

Jump row styling (L32):
- Rows are 34px tall, padding 0 12px, gap 8, radius 10, 13px, `nowrap`.
- Number column: 18px wide, 11px/500, `var(--x-t4,#8E8E93)`.
- Active row: weight 600, `var(--x-t1)`, bg `var(--x-b0)`.
- Inactive row: weight 500, `var(--x-t2,#3A3A3C)`, transparent bg.
- Hover: bg `var(--x-b3,#EBEBEE)`.
- The list has gap 2.

**Cross-file links** (`window.location.href`). Targets in `FieldScout Mobile Lists and Rankings.dc.html`:

| Hash | Opened from |
|---|---|
| `#view-<id>` | Community ranking rows, "Updated by people you follow" rows, global search Ranking posts, Notification 2 (`#view-r1`) |
| `#mine` | Profile Rankings items |
| `#lists` | Profile Lists items |
| `#new-ranking` | Profile "New ranking", Create sheet "Ranking" |
| `#new-list` | Profile "New list" |

**The return path.** The other file links back with `APP = "FieldScout Mobile.dc.html"` and **no hash**. Its tab-bar Home / Community / Leagues, `goProfile` and the community-ranking "back" all use it. The main file has no hash routing (`componentDidMount` only reads the theme), so **every return lands on the initial state: League › Match**.

---

### 5. Data shown in navigation chrome

- **League header title:** `LEAGUES[lg].name`. **Real product data:** the user's leagues.
- **Switcher card:** league avatar, team name and record (`LEAGUES[lg]`). There is one dot per league, in LEAGUES order.

  | # | League (`name`) | Format (`sub`) | Avatar | Team | Record field |
  |---|---|---|---|---|---|
  | 0 | Sunday Funday League | 12-team standard | SF on `var(--x-ink)` | Touchdown Tacos | 2-6 |
  | 1 | Family Bragging Rights | 10-team standard | FB on `#ECAD48`, text `#1D1D1F` | Dalton's Dynasty | 3-1 |
  | 2 | Joy to Us | 12-team PPR | JU on `#9D70E9` | Taco Tuesday | "Draft Aug 28" |
  | 3 | Work League | 10-team half PPR | WL on `#5C7CE5` | Spreadsheet Slingers | "Draft Sep 2" |

  - For pre-draft leagues the record slot shows a draft date.
  - `avFg` is `#1D1D1F` only for `#ECAD48`, otherwise white. The Trade detail chip ignores `avFg` and always uses `#fff`.
  - **Real data:** leagues, team names, records, draft dates.
- **Home "Matchups" cards:**
  - Order: Sunday Funday, Joy to Us, Work League, Family Bragging Rights.
  - They use their own literals, which differ from LEAGUES. Work League shows "12-team PPR · 2026". Family Bragging Rights shows me as "Touchdown Tacos (3-1)" against "Team 5 (2-2)", although LEAGUES names that team "Dalton's Dynasty".
  - The avatar is a 36px rounded square (radius 10) with `#fff` text on every card, including FB's `#ECAD48`.
  - The pre-draft pill is orange `var(--x-go)`/`var(--x-to)`. The red dot (`#FF0028`, 8px) shows only on Sunday Funday (`hasDot`).
  - Win bar colour: `#07B85A` when ≥ 50%, otherwise `#FF0028`.
- **Badges:**
  - Messages: `dmCount` = the number of truthy `unread` convos (initially 3: league, marcus, nina). Each convo's flag clears when it is opened. **Real data.**
  - Notifications: hard-coded `3` until "Mark all read" (`notifRead`), even though 4 rows (`k < 4`) render as unread (bold, a blue 9px dot, bg `var(--x-gb2,#F5FAFF)`). **Real data:** the unread count.
- **Messages Trades tab badge:** the count of trades with status "Pending" (initially 2: marcus, nina). 18px pill, `#0088FF`.
- **Transactions title:** "My moves" (`tMine`) or "League transactions".
- **"Filter" pill:** reads "Filter · N", where N = (`tType ≠ All`) + (a team filter is active and this is not My moves). Active style: bg `var(--x-gb,#E6F2FF)`, text `var(--x-tb,#0074DB)`. Otherwise bg `var(--x-b2)`, text `var(--x-t1)`.
- **Matchups used by the swipe:** `MUPS` (L1162). Each entry is `[a, b, aScore, aProj, aWin%, bScore, bProj]`, and b's win is `100 − aWin`.

  | mi | Team a (TEAMS idx) | a score / proj | a win | Team b | b score / proj | b win |
  |---|---|---|---|---|---|---|
  | 0 | Touchdown Tacos (0) | 39.70 / 83.44 | 66% | Gridiron Gurus (1) | 16.40 / 73.01 | 34% |
  | 1 | Priya's Punters (2) | 59.70 / 71.52 | 23% | Leo's Lions (6) | 33.42 / 86.98 | 77% |
  | 2 | Blitz Brigade (5) | 85.60 / 117.99 | 90% | Sam's Sleepers (4) | 31.90 / 85.21 | 10% |
  | 3 | Hail Marys (7) | 54.74 / 63.79 | 2% | End Zone Elite (3) | 54.50 / 113.74 | 98% |
  | 4 | Fourth & Long (8) | 41.50 / 90.91 | 19% | Red Zone Rebels (9) | 89.10 / 111.23 | 81% |
  | 5 | Maya's Mavericks (10) | 62.30 / 88.10 | 58% | Raj's Rushers (11) | 48.20 / 80.40 | 42% |

  - Win colour: `#07B85A` when ≥ 50, otherwise `#FF0028`.
  - In the Starters comparison, my side always uses the static `MINE` lineup, not the edited `slots`. Teams 0 and 1 use MINE and THEIRS; other teams get seeded generated lineups.
  - **Real data:** weekly matchups, live scores, win probability.
- **Toast strings, sheet titles and composer titles:** quoted verbatim in §2 and §3. Pure UI copy.
- **Profile owner routing** (`ownerOf`) decides the profile action:
  - Rostered by me: "Drop" (`var(--x-gr)`/`var(--x-tr)`).
  - Another team: "Propose trade" (`#0088FF`).
  - Free agent: "Add" (`#07B85A`).
  - Waivers: "Claim off waivers" (`#C98A1F`).
  - **Real data:** roster ownership per league.

### 6. Dark mode (`.fs-dark` on the phone root, L19)

| Token | Dark value | Used in navigation chrome |
|---|---|---|
| `--x-dockA` | `rgba(18,18,18,.86)` | Switcher wrapper (light fallback `rgba(29,29,31,.9)`) |
| `--x-barA` | `rgba(18,18,18,.92)` | Tab bar (light `rgba(29,29,31,.94)`) |
| `--x-mini` | `#090909` | Switcher card (light `#3A3A3C`) |
| `--x-miniline` | `transparent` | Switcher inset ring (also transparent in light) |
| `--x-bar`, `--x-dock` | `#121212` | Defined but not referenced by the markup |
| `--x-b0` | `#121212` | Overlay and sheet backgrounds, badge ring, outer Profile tab ring, home indicator, team action tiles, **switcher active dot** (which becomes `#121212` on a `#090909` card) |
| `--x-b1` | `#282828` | Selected league row in the sheet, menu cards and tiles |
| `--x-b2` | `#333333` | Icon-button pressed state, sheet X button, back circles (My start/sit, settings, trade), pill tracks, profile "+ List" pill bg |
| `--x-b3` | `#3E3E3E` | Header borders, disabled action pills, live-play row divider |
| `--x-b4` | `#575757` | Sheet grab handle, inactive matchup dots, search clear button |
| `--x-ink` | `#4D4D4D` | Toast bg, active matchup dot, inner Profile tab ring, filled Players pills (but **not** the bezel, which sits outside `.fs-dark`) |
| `--x-gb2` | `#16212E` | Unread notification row bg |
| `--x-gb` / `--x-tb` | `#12263F` / `#6FB5FF` | Active "Filter · N" pill |
| `--x-gp` | `#261E36` (light `#F3EDFD`) | Notification row 2 icon bg |
| `--x-go` / `--x-to` | `#3A2A14` / `#FFB340` | Home pre-draft pill, "Pending" trade status |
| `--x-gg` / `--x-tg` | `#12301F` / `#1ED760` | "Accepted" and "Sent offer" statuses, other sent / positive states |
| `--x-gr` / `--x-tr` | `#3A1A1D` / `#FF6B6B` | Decline buttons, "Declined" status, profile "Drop" pill |
| `--x-t1` / `--x-t2` / `--x-t3` / `--x-t4` / `--x-t5` | `#FFFFFF` / `#D9D9D9` / `#B3B3B3` / `#A7A7A7` / `#727272` | Header text, icons and status-bar icons (t1); the sorted col-tip button text and the inactive JUMP rows' fallback (t2); sub-labels (t3/t4); chevrons (t5) |

**Hard-coded values that do not flip in dark mode:**
- Tab label colours `#fff` / `#A1A1A6`.
- Switcher text `#fff` / `rgba(255,255,255,.62)` and inactive switcher dot `#636366`.
- Scrims: `rgba(0,0,0,.32)` (sheet) and `rgba(0,0,0,.18)` (col tip).
- Accent `#0088FF`, badge red and blue.
- Swap-slot ring inner `#fff` (`0 0 0 2px #fff, 0 0 0 4px #0088FF`, L1636).
- BN slot chip `#EDEDF0` (L1636, L1821).
- Trade builder tiles `#F5F5F7` / selected `#E6F2FF`, check `#fff` with ring `#C7C7CC` (L1757). These stay light on the `#121212` overlay.
- League › Matchups median card `#FFF6E5` (L421).
- Home league avatar text `#fff`.
- Global input placeholder `#6E6E73` (L17).
- Dynamic island `#000`, logo tile `#07D066`, bezel `#1D1D1F`.
- The whole JUMP panel (outside `.fs-dark`; its "Dark mode" row is literally `#EBEBEE` / `#1D1D1F`).

**Profile header on light team colours** (only PIT `#FFB612` and NO `#D3BC8D` pass `isLight`):
- The name colour `pf.fg` is `var(--x-t1)`, which becomes `#FFFFFF` in dark mode, so white text sits on gold or tan.
- The sub-line stays `rgba(29,29,31,.72)` and the close chip stays `rgba(0,0,0,.08)`.
- On every team colour, the "+ List" pill becomes `#333333` with `#FFFFFF` text in dark mode.

The theme toggle lives on the Profile pill and on the JUMP panel's "Dark mode" row. It persists as `localStorage["fieldscout-theme"]` = `"dark"` or `"light"`, read in `componentDidMount`.

---

### Open questions
- Critic finding partly disproved, light team colours. The critic listed PIT #FFB612, NO #D3BC8D, TEN #4B92DB, CIN/DEN #FB4F14 and CLE #FF3C00 as the profile header's light colours. That five-colour list is lightTc (L1452), and it only feeds the Trending-tile tc/tcFg bindings, which the markup never uses. The profile header uses isLight, luminance > 160 (L1207). That holds only for PIT (185.1) and NO (189.5); TEN is 133.1, CIN/DEN 123.7 and CLE 111.5. The revised §2 and §6 use the correct two-team list. The critic's dark-mode consequence (t1 turns white on a light header) holds for those two teams.
- Critic finding refined, Players pill default labels. The critic said the default pill labels are 'All', 'Position' and 'Teams'. In the source, the status pill shows 'All' only when status is 'all'. The default status ('avail') shows 'Available', filled, and the period pill shows 'Week 5'. The revised §2 states the exact rule.
- inLg treats every scr except home, community and me as 'in league'. So My start/sit, Messages, Conversation, Notifications, Live feed and Transactions all show the league tab bar (Match/Team/Players/League/Menu), even when the user reached them from Home. Through the Menu tab they can also open the league Menu sheet and its settings pages. Is that intended, or should Messages, Notifications and My start/sit keep the outside bar (Home/Community/Players/Profile) when entered from outside a league?
- My start/sit is reached from Profile, but its back chevron calls goHome, so it lands on Home rather than Profile. Should back return to Profile?
- In Trade detail, tapping a player asset calls openProf. The profile (z-index 22) renders under the still-open Trade detail (z-index 23), so it stays invisible until the detail is closed. If the user then taps the opponent name, the team view (z 21) opens under that hidden profile, and the user sees the profile instead. Should an asset tap close the detail first, or should the profile stack above it?
- The League settings tile overlay (hasSettings, z-index 23, 13 tiles) and the 'League chat' sheet (sheet 'chat') have no entry point. openSettings is never bound. openChat is never bound either, and it would navigate to Messages rather than open the chat sheet. The chat sheet's Send writes to threads[convo], not to the chat list. Should these be built, and if so, where does the user enter them? Or should they be dropped?
- Switching league (by switcher swipe or the sheet) changes only labels: the header name, switcher card, menu section title, the Trade detail chip (avatar plus format string) and the Team view league name. Matchups, rosters, players and standings stay Sunday Funday data. The Home 'Sunday Funday League' card also resets neither lg nor mi. In the real app, should switching reload every league tab for that league, should each Home league card enter its own league, and should entering always start on 'Your matchup'?
- Only the Home 'Sunday Funday League' card navigates. 'Joy to Us', 'Work League' and 'Family Bragging Rights' show the 'Not part of this prototype' toast. What should pre-draft league cards open (for example a draft lobby)?
- prevScr (the back target for Messages and Notifications) is not updated by openConvo or by JUMP-panel entries. For example, a Conversation opened from a Team view or Trade detail inside a league can lead back to a stale screen such as Home. Should Messages and Conversation use a real back stack (browser history) in the Next.js build?
- The main file has no hash or URL routing, and every return from the Lists and Rankings file (it links to 'FieldScout Mobile.dc.html' with no hash) lands on the initial League › Match. What URL route map should the web app use for screens and overlays? Should the overlays (profile, team view, trade, community detail) be URL-addressable so browser back works?
- JUMP 20 'League switcher' never opens the sheet, because go() ignores sub 'leagues'. JUMPs 6–8 set ptab (trend/avail/leaders), which drives only their own highlight; the Players list ignores it. JUMPs 17 and 24 never highlight. Please confirm these are prototype artifacts that need no production equivalent.
- The League › Activity tab renders only the 'Filter' pill and no transaction list; the list exists only on the separate Transactions screen. Should Activity embed the transactions list?
- The Notifications badge is hard-coded to 3, but 4 rows render as unread (k < 4). Which count is correct?
- In dark mode the switcher's active dot uses var(--x-b0), which becomes #121212 on the #090909 card and is nearly invisible. Should the active dot stay #fff in dark mode?
- The code and the README disagree on two values. Toast auto-dismiss is 1800 ms in code versus about 2.2 s in the README. The sheet scrim is rgba(0,0,0,.32) in code versus .4 in the README. Which wins?
- The prototype has no enter or exit animation for sheets or full-screen overlays (they mount instantly), and the sheet grab handle does not support drag-to-dismiss. Should the web build add standard slide-up and slide-in transitions plus drag-to-dismiss, or match the prototype exactly?
- Full-screen overlays start at top:50px, below the simulated iOS status bar. The device chrome includes a home indicator that actually paints under the tab bar (no z-index) and is effectively invisible. In the Next.js mobile web layout, should overlays start at top 0 / safe-area-inset-top, with the status bar, dynamic island and home indicator dropped?
- The outside tab bar's 'Players' tab only shows the 'Not part of this prototype' toast. Should it open a league-independent player research screen, and is that screen specified anywhere?
- Home league cards use different literals from the LEAGUES table. Work League shows '12-team PPR · 2026' where LEAGUES says '10-team half PPR'. Family Bragging Rights shows me as 'Touchdown Tacos (3-1)' where LEAGUES names the team 'Dalton's Dynasty'. Which source is canonical?
- The Match tab swipe has no click suppression. The team names, starter cells, dots, Week arrows and the live-play row are inside the dragged wrapper, and the content follows the pointer, so a drag that starts on one of them usually also fires its click. What rule should the rebuild use? For example: suppress clicks once the horizontal axis locks (|dx| > 8).
- On league screens the toast (bottom 100px, 36px tall) sits on top of the centre of the league switcher card (86–142px from the bottom), including for the 'Switched to …' toast. That toast also fires on release, before the league actually changes. Should the toast move above the switcher on league screens, and should it fire after the switch completes?
- Every .fsm-scroll with overflow-y gets the dock spacer. That includes the bottom-sheet body, so every sheet opened on League ends with 150px of blank space (84px elsewhere). Overlays opened over League that keep the switcher mounted (team view, page, global search, community detail) also get 150px. Is this intended, or should sheets and overlays use a spacer of 0?
- The Players filter popover's scrim is position:fixed, inset 0, transparent, inside the z-6 sticky bar. While the popover is open, taps on the league header, switcher and tab bar (and, in a browser, anywhere else in the window) only close the popover. Is that the intended outside-tap behaviour, or should outside taps also act on their target?
- 'Withdraw offer' (outgoing pending trade) is coded but unreachable. TRADES has no outgoing Pending trade, and 'Send trade proposal' never adds one. Should sent proposals appear in Messages › Trades as outgoing Pending, so they can be withdrawn?
- The Live feed header mini-score is static (Touchdown Tacos 39.70, 66%, Gridiron Gurus 16.40). The live-play row on the Match card is identical for every matchup, and goFeed always opens MIN @ NO. Should these follow the matchup currently shown (mi)?
- The Week stepper (weeks 1–17) changes only its label, and it has no disabled styling at the limits. Should changing the week reload the matchup data, and should the arrows dim at weeks 1 and 17?

---

## Gap analysis vs the current app

## Navigation graph: mobile spec compared with the current app (worktree `redesign-v7` @ 27d455b)

**Files checked:**
- **Layout:** `src/components/layout/{app-shell,bottom-tabs,more-sheet,top-nav,layout-mode-frame}.tsx` and `rail/{research-rail,messages-panel,notifications-panel}.tsx`
- **Hooks and stores:** `src/hooks/{use-layout-mode,use-leagues,use-notifications,use-league-chat,use-box-score,use-open-player}.ts` and `src/stores/theme-store.ts`
- **Leagues:** `src/components/leagues/{league-shell,league-shell-ops,matchup-view,matchup-view-ops,players-page,players-page-ops,lineup-editor,lineup-editor-ops,trade-builder,trade-center,trades-ops,activity-page-ops,team-transactions-ops,team-page,standings-table,settings-index-ops,leagues-index}.ts(x)`
- **Home:** `src/components/home/*`
- **Players:** `src/components/players/{player-card-actions,player-card-league-ops,player-detail-page-view,players-spreadsheet}.tsx`
- **Shared and community:** `src/components/shared/command-palette.tsx`, `src/components/explore/explore-feed.tsx`, `src/components/notifications/notification-href.ts`
- **Routes:** `src/app/app/(shell)/**` (leagues/[leagueId]/*, notifications, profile, start-or-sit, teams/[teamId]/live, explore), `src/app/api/**`, `src/app/u/[username]/*`
- **Schema and flags:** `src/lib/feature-flags.ts`, `src/types/database.ts`, `supabase/migrations/{109,148}*`

**Context:**
- **Navigation model.** The app uses Next.js routes; the prototype keeps navigation in in-memory state.
- **Mobile chrome today.** The `mob:`/`desk:` layout mode already exists (`use-layout-mode.ts`). On a phone the chrome is `TopNav` (logo, bell linking to `/app/notifications`, Create, avatar), a static `BottomTabs` bar (Home/Lists/Players/Search/More) and `MoreSheet`. There is no league-aware dock.
- **Dark mode conflict.** Commit 27d455b adds light/dark `--m-*` tokens for the mobile layout only, plus a theme store under `fieldscout-theme`, citing "Chris, 2026-10-15 mobile-only". The worktree's CLAUDE.md still says single theme with no toggle. Someone needs to decide which is current.

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| **App frame and navigation model** |||||
| Screen state machine (`scr` + overlays) mapped to the app | out-of-scope-or-question | Next.js routes under `(shell)`; the player modal already syncs to the URL (`player-modal-url-sync.tsx`) | Someone must decide which overlays get URLs and how browser history replaces the `prevScr` stack. In the prototype, every return from the Lists file resets to League › Match; real back navigation should keep state. |
| Device chrome (bezel, status bar, island, home indicator) | out-of-scope-or-question | none | Prototype only. The real build needs `env(safe-area-inset-*)`, and no file in the app uses it. |
| JUMP panel (25 rows, "Dark mode" row) | out-of-scope-or-question | none | Presentation only. |
| Dead bindings (`leagueTabs` strip, `mxLabel`/`mxPrev`/`mxNext`, `openSettings`, `openChat`, `ptab`, `bracket`, the local `gridGroups`) | out-of-scope-or-question | none | The spec says do not build these. |
| Prototype bugs that should not be copied | out-of-scope-or-question | none | Transactions X always returns to Team. My start/sit back goes to Home. `prevScr` goes stale. Trade detail covers a profile opened from it. The toast sits over the switcher. Sheets get 150px of blank space on League. The live-play row is the same for every matchup. A Match re-tap from other screens resets `mi`. The Home card doesn't reset `lg`. The Players popover scrim swallows taps on the header and dock. |
| Matchup-swipe click suppression | out-of-scope-or-question | none | The spec says the rebuild needs an explicit rule, because taps fire after a drag. |
| **Docks and tab bars** |||||
| Outside tab bar: Home · Community · Players (toast) · Profile avatar | out-of-scope-or-question | `bottom-tabs.tsx` (Home/Lists/Players/Search/More) | The design has no Lists tab, but Lists is the launch's core surface. Community is flag-off at launch. Players is a dead toast in the design, while `/app/players` research is a launch surface. This needs an IA ruling. |
| League tab bar: Match · Team · Players · League · Menu, replacing the outside bar on all league screens | new-ui-on-existing-data | `league-shell-ops.ts` `leagueTabs` (Home/My Team/Matchup/Players/Schedule/Stats + More); `league-shell.tsx` renders an in-page sub-nav on mobile | Every destination route exists. What's missing is a dock that knows the context; `BottomTabs` is static. Active-tab lighting can come from `activeLeagueSection`. |
| Feed, Transactions, DMs, Thread, Notifications and My start/sit showing the league tab bar | out-of-scope-or-question | none | In the prototype, `inLg` is true even when the screen was reached from Home. Someone should decide the dock for non-league screens. |
| League switcher card in the dock (avatar, team, record or draft date, league name, dots, chevron) | new-ui-on-existing-data | `top-nav.tsx` `LeagueSwitcher` (desktop-only dropdown); `use-leagues.ts` `MyLeagueRow` | Memberships are real. `MyLeagueRow` lacks my team name, record, draft date and scoring format. That data exists in teams, standings, drafts and leagues, so the work is widening `GET /api/leagues`. |
| Switcher gestures (swipe left/right steps the league; tap or swipe up opens the sheet) | new-ui-on-existing-data | no gesture primitive in `src/components` | Client-only. Switching should route to the same tab in the next league. Note that prototype leagues share data; real ones don't. |
| Switch league sheet (rows with avatar, team, record, `name · sub`, check, swipe hint, X) | new-ui-on-existing-data | `LeagueSwitcher` dropdown | Same data as the switcher card, presented as a bottom sheet. |
| Scroll clearance under the dock (150px / 84px spacer) | restyle-only | `app-shell.tsx` `pb-20` | Use tokens, and drop the spacer inside sheets. |
| **Headers** |||||
| Home header: logo, Search, Bell (red badge), Chat (blue badge) | restyle-only (Chat: needs-new-backend) | `top-nav.tsx` `NotificationBell` (real `unreadCount`, accent badge); `command-palette.tsx` | The design's notification badge is red (Danger) where the app's is blue. Chat depends on DMs. |
| League header: logo, Home button, league name, Search, Bell, Chat | new-ui-on-existing-data | `league-shell.tsx` `LeagueIdentity` (team crest, record and rank badges, override indicator) | The compact header drops the identity row. Someone should decide where record, rank and "Commissioner override on" go. |
| Chat icon and unread DM badge | needs-new-backend | `messages-panel.tsx` mock behind `featureFlags.messages`; `dmUnreadCount` is always 0 | There are no DM tables, and `league_chat` has no read state. |
| Community header (logo, Search, blue "+" Create; inline search mode with Cancel) | new-ui-on-existing-data | `explore-feed.tsx`; `/api/search/community`; `CreateMenu` | Community is flag-off at launch. |
| Back, close and title headers (Feed, Transactions, Messages, Thread, Notifications, Page, Composer, Picker, Search) | restyle-only | n/a | Pure chrome. |
| **Global search overlay** |||||
| Search: input, clear, Cancel, scope chips All/Players/People/Posts, Recent, Trending pills | new-ui-on-existing-data | `command-palette.tsx` (Players, Lists & rankings, Users, Go to); `/api/players/search`; `/api/search/community` | Player, user and list results exist. Scope chips, recent searches (nothing stores them) and trending pills are new. |
| Search result → league member opens their Team view | new-ui-on-existing-data | team route `leagues/[id]/team/[teamId]` | The palette doesn't search the current league's members. |
| Search result → "Start or sit" post | needs-new-backend | no start/sit API | See the Composer row. |
| **Notifications** |||||
| Notifications screen: Back, "Mark all read", unread rows, deep links | restyle-only | `/app/notifications`, `notifications-feed.tsx`, `notification-href.ts`, `useMarkNotificationsRead` | Real backend. Trade rows go to `/trades` (the trade center), not a trade-detail overlay. The badge must use the real count, not the prototype's hard-coded 3. |
| **Messages** |||||
| Messages screen: search, All/Trades segment, avatar strip, conversation rows, compose | needs-new-backend | `rail/messages-panel.tsx` (mock) | DMs have no backend. The Trades segment's pending-offer cards could use real trades (`use-trades.ts`, with Accept/Decline/Counter in `trade-center.tsx`). |
| Conversation screen (thread, Send, info, "+") | needs-new-backend | none for DMs | The league group thread could map to `league_chat` (`use-league-chat.ts`). |
| League chat sheet | out-of-scope-or-question | `league_chat`, `league-message-board.tsx` | Nothing in the prototype opens it. Today the board lives on League Home. |
| **Sheets** |||||
| Bottom sheet container (scrim .32, 24px top radius, grab handle, title row, Done footer, leagues X) | restyle-only | `ui/sheet.tsx` (`side="bottom"`, `bg-black/40`) | Add a mobile CVA variant. The grab handle is decorative (no drag-to-dismiss). |
| Toast pill (1800ms, one at a time) | restyle-only | `ui/toast.tsx`, `use-toast.ts` (`TOAST_LIMIT` 1) | Move it off the switcher band. |
| **Menu sheet** |||||
| Menu sheet (toggled from the tab bar) | new-ui-on-existing-data | `league-shell-ops.ts` `leagueMoreItems` | The app's More items differ (Settings, Draft, Trades, Members, Activity). |
| Menu › My team card → page (edit name) | new-ui-on-existing-data | `/api/leagues/[id]/teams/[tid]/name`, `use-rename-own-team.ts` | |
| Menu › My team avatar colour and "Upload photo" | needs-new-backend | `teams` Row has no avatar or colour column | |
| Menu › League settings / Scoring / Playoffs | restyle-only | `settings/page.tsx` with `?section=` (`settings-index-ops.ts`); `playoff-bracket.tsx` | Map each row to `settingsHref(section)`. |
| Menu › Draft results (Round chips) | restyle-only | `draft/recap/page.tsx` | |
| Menu › League history and Previous seasons (season chips, archived league) | needs-new-backend | `leagues.season` only; no renew or parent-league link | |
| Menu › Notifications (league prefs) | needs-new-backend | no prefs table | The prototype only shows a "screen coming next" toast. |
| Menu › Co-owners | needs-new-backend | `team_managers.role` CHECK is `'manager'`; the spec reserves co_manager for post-v1 | |
| Menu › Commissioner note | out-of-scope-or-question | commissioner system posts appear in activity | No note field exists, and the prototype only toasts. |
| Menu › Stat corrections | new-ui-on-existing-data | `leagues/[id]/corrections/page.tsx`; activity tab `corrections` | The prototype toasts, but the page exists, so wire it. |
| Menu FieldScout grid: Home, Community, Stats, Profile, Settings | new-ui-on-existing-data | `/app`, `/app/explore`, `/app/stats`, `/app/research`, `/app/profile`, `/app/settings` | The prototype toasts Stats and Settings; both pages exist. |
| League pages with no mobile door: League Home (message board, banners), Trades center, Members and invites, Commissioner console, pre-draft Draft room | out-of-scope-or-question | `leagueTabs`, `leagueMoreItems`, `commish/page.tsx`, `members/page.tsx`, `trades/page.tsx` | The design's menu and tabs omit these. |
| **Match tab** |||||
| Swipeable matchup carousel (the week's matchups, dots, slide animation) | new-ui-on-existing-data | `matchup-view.tsx`, `use-matchups.ts`, `/api/leagues/[id]/matchups`, `matchup/[mid]` | The data is real. The carousel and gesture are new. |
| Matchup card team names → My team (League › Team) or another team's view | restyle-only | `TeamNameLink` (`league-cells`), `team/[teamId]` route | |
| Win % per side and the win bar (Match card and Home cards) | needs-new-backend | no win-probability source anywhere | |
| Projected totals | restyle-only | `my-team-ops.ts` `projectedTotal`; `league_player_values` | |
| Live-play row (quarter and clock, down and distance, play text, points delta) → Feed | needs-new-backend | `box-score-service.ts` has `quarter`, `game_clock` and scores only | There are no down, distance or play events. |
| "Yet to play" line | new-ui-on-existing-data | box-score starter phases (`up_next`/`live`/`final`) | The prototype hard-codes it. |
| Week stepper ‹ Week n › | restyle-only | `matchup-view.tsx` prev/next `?week=` links | Real data changes with the week. Add disabled ends; the prototype has none. |
| Starter cells → player profile | restyle-only | box-score rows, `useOpenPlayer` | |
| **Live feed** |||||
| Live game feed (mini-score header, game chips, play-by-play, Box score tab) | needs-new-backend | `teams/[teamId]/live` is a `PlaceholderPage`; `nfl_games` has no play rows | A per-game box could partly be built from `player_stats`. |
| **Team tab** |||||
| Tile "Schedule" | new-ui-on-existing-data | `schedule-view.tsx`, `/schedule` | The prototype toasts. |
| Tile "Trade" → trade builder | restyle-only | `trade-builder.tsx`, `trade-center.tsx`, `tradesHref` | |
| Tile "Moves" → Transactions "My moves" | restyle-only | `team-transactions-panel.tsx` | |
| Tile "News" | needs-new-backend | `injury-news-card.tsx` uses mock rows; there is no news feed | |
| Slot chip → Swap sheet (eligible candidates, swap or bench toasts) | new-ui-on-existing-data | `lineup-editor.tsx` Move menu; `lineup-editor-ops.ts` `planMove` | The eligibility, lock and IR rules exist. The bottom-sheet presentation is new. |
| Player name → profile; an empty row opens the swap sheet | restyle-only | `lineup-editor.tsx` | |
| **Players tab** |||||
| Filter pills and quick-pick popover: Status (All, Available, Free agents, Waivers, Rostered, My team) | new-ui-on-existing-data | `players-page-ops.ts` `PoolScope` and `Availability` (`on_waivers`, `mine`) | Today there are only three scopes; the finer statuses can be derived. |
| Period filter (Week n / Week n−1 / Season / last year) | new-ui-on-existing-data | `player_stats` weekly and season rows | The page shows only current Proj/Pts/Avg. |
| Position filter incl. FLEX, D/ST | restyle-only | `POSITIONS` QB–DEF | Add FLEX. |
| NFL team filter | new-ui-on-existing-data | `players.team` | |
| Trending card (collapsible) and Home "See all" into it | needs-new-backend | `trending-players-card.tsx` stands in projection vs last season (`TODO(data)`) | There is no real adds/drops trend source. |
| View toggle List / Cards / Sheet | new-ui-on-existing-data | `players-page.tsx` (single table) | |
| Customize stats sheet (8 groups) | new-ui-on-existing-data | `players-spreadsheet.tsx` grouped column defs; `player_usage`; `defense_position_splits` | The Ownership % group needs a backend aggregate. |
| Col tip (explainer, "Sort by this") | new-ui-on-existing-data | spreadsheet `full` labels; `SortHead` in `players-page.tsx` | |
| Row and tile actions Add / Claim / Drop / Propose trade | restyle-only | `player-card-league-ops.ts`, `pickupActions`, `drop-player-dialog.tsx` | The prototype toasts; the app runs the real actions. |
| **League tab** |||||
| Segmented Matchups / Standings / Activity | new-ui-on-existing-data | `matchup/page.tsx`, `standings-page.tsx`, `activity-page.tsx` (separate routes) | One tab replaces three pages. |
| Matchup card → Match tab at that matchup | restyle-only | `matchup/[mid]` links | |
| Median card | restyle-only | median handling in `matchup-view-ops.ts` | |
| Standings row → team | restyle-only | `standings-table.tsx` `TeamNameLink` | |
| Activity "Filter" pill and Transaction filters sheet (type chips, team rows) | new-ui-on-existing-data | `activity-page-ops.ts` tabs; `transactions.type` add/drop/add_drop/waiver_claim/trade (mig 109) | A team filter exists only on the Commissioner tab. The prototype's Activity tab has no list; build one. |
| Transactions screen (My moves / League, "Filter · N", Clear filter) | new-ui-on-existing-data | `team-transactions-panel.tsx`, `/api/leagues/[id]/transactions` | |
| **Overlays** |||||
| Other team view (Back, Propose trade, roster rows → profile, "See all" moves) | restyle-only | `team-page.tsx` (propose link with deadline gating) | |
| Team view "Message" | needs-new-backend | none | Needs DMs. |
| Player profile overlay (team-colour header, X, action pill, "+ List", ownership row, Key stats, games strip) | restyle-only | `player-card.tsx`, `player-view-modal.tsx`, `player-card-actions.tsx`, `add-to-list-popover.tsx` | Memory rule: a player click opens the mini card first. The design opens the full profile directly, so this needs a ruling. |
| Profile tabs Summary / Game log / Leagues / Transactions / Team / History | new-ui-on-existing-data | `player-detail-page-view.tsx` SECTIONS (Full stats, Game log, Scoring, Draft & value); league rows in card actions | The Transactions, Team and History tabs are new. Recent news needs a news feed. |
| Trade builder (opponent chips, asset tiles, review step, Send) | restyle-only | `trade-builder.tsx`, `use-propose-trade.ts` | |
| Trade builder "Offer expires in" select | needs-new-backend | `trades` table (mig 148) has an `expired` status but no per-offer expiry | |
| Trade builder "Send DM" toggle | needs-new-backend | none | Needs DMs. |
| Trade builder "Hide usernames" | new-ui-on-existing-data | none | Client-only. |
| Trade detail (Accept, Decline, Counter pre-filled, Withdraw, opponent → team) | restyle-only | `trade-center.tsx`, `trades-ops.ts` (cancel = withdraw, counter seed) | |
| Trade detail draft-pick assets | needs-new-backend | `trade_items` holds a player XOR FAAB | |
| Trade detail "Message" | needs-new-backend | none | Needs DMs. |
| Settings tile overlay | out-of-scope-or-question | settings index exists | Unreachable in the prototype. |
| Community list detail (cover, Follow, Save, Share, video cards) | new-ui-on-existing-data | `follows`, `list_favorites`, `list_links` (video kind), `follow-button.tsx` | Flag-gated. |
| Composer › Start or sit poll (up to 6 options, pick N, trade-question type, roster attach, scoring, close time) | needs-new-backend | `start-or-sit/{page,new}.tsx` are placeholders; `start_sit_questions` has only player_a/player_b; no API | |
| Composer › List step 1/2 (name, description, public, players, videos, link, recommended) | new-ui-on-existing-data | `list-form-dialog.tsx`, `ListFormDialog` in `app-shell.tsx`, `list_links` | |
| Composer › List colour | needs-new-backend | `lists` has `thumbnail_url` but no colour column | |
| Composer › Ranking | out-of-scope-or-question | `weekly-ranks` (flag) | Unreachable; it leaves the file. |
| Player picker (single/multi, position chips, search, Done) | restyle-only | `player-search.tsx`, `/api/players/search` | |
| **Home** |||||
| "My stuff" tiles Rankings / Lists / Start-Sit → Profile tabs | new-ui-on-existing-data | `/app/lists`, `/app/weekly-ranks` (flag) | Start-Sit needs the start/sit backend. |
| Matchups cards (league, my score vs opponent, pre-draft pill, red dot) → League › Match | new-ui-on-existing-data | `your-leagues.tsx` / `LeagueIndexCard` (name, season, size, role only) | Needs per-league matchup and score reads. Win % needs a backend. |
| "Join or create a league" | restyle-only | `JoinLeagueDialog`, `LeagueCreateModal` (`home-quick-actions.tsx`) | The prototype toasts; the real flows exist. |
| Trending Adds/Drops segment and rows → profile | needs-new-backend | `trending-players-card.tsx` (Risers/Fallers proxy) | |
| Injury news rows → profile | needs-new-backend | `injury-news-card.tsx` (mock) | `players.status` holds the designation only. |
| Practice card "Mock draft" | restyle-only | `MockLaunchDialog`, `/app/mocks` (`mockDrafts` flag) | The prototype toasts. |
| **Community and Profile** |||||
| Community screen (For you / Following / Start or sit / Rankings / Lists tabs, topics, shelves, "See all", empty state) | new-ui-on-existing-data | `explore-feed.tsx` (Trending/Newest/Following, tag chips) | The poll shelf and tab need the start/sit backend. Flag-off at launch. |
| Create sheet (Start or sit / Ranking / List) | new-ui-on-existing-data | `top-nav.tsx` `CreateMenu` (New list, league, mock) | |
| Profile screen (Rankings / Lists / Start-Sit segment; New ranking, New list, Ask a question) | new-ui-on-existing-data | `/app/profile` ("My stats"), `/u/[username]` | Rankings is flag-gated. Start/sit needs a backend. |
| My start/sit screen (All / Open / Closed, "+") | needs-new-backend | `start-or-sit` placeholder | |
| Profile theme pill Dark/Light and §6 dark token table | out-of-scope-or-question | `theme-store.ts`, `use-layout-mode.ts`, `globals.css` `--m-*` tokens (27d455b) | Tokens and store exist with no toggle UI. CLAUDE.md conflicts with the 2026-10-15 mobile-only ruling. |
| **Flags and cross-file links** |||||
| Cross-file links (`#view-<id>`, `#mine`, `#lists`, `#new-ranking`, `#new-list`) | restyle-only | `/app/lists`, `/app/lists/[listId]`, `/app/lists/new`, `/u/[username]/lists/[slug]`, `/app/weekly-ranks` | Real routes exist. |
| Flag-gated surfaces in the dock and menus (community, messages, leagues, startOrSit, weeklyRanks) | out-of-scope-or-question | `feature-flags.ts` | The prototype assumes everything is on. Someone should decide what each bar and menu shows when flags are off. |
| Pre-draft and offseason league states | out-of-scope-or-question | `leagueTabs` disables Matchup/Schedule/Stats (`NOT_STARTED_REASON`) | The design only shows in-season Match, Team and League tabs. |

