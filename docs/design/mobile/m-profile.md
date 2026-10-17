## Profile (Me), My start/sit, Settings

Sources: markup lines 108–121 (`isMe`), 122–146 (`isMySS`) and 823–831 (`hasSettings`) of `FieldScout Mobile.dc.html`; tab bar and dock 639–644. Logic: `ssVals()` (lines 1486–1507), `toast()` (1624), `go()` / jumps (1628–1629), tab bars (1708–1710, 1857), Home tiles (1715), settings (1755), Menu league items (1784), My team page (1788–1792), profile (1808–1816), menu apps, tab bar, theme and dock (1856–1858). Headshot: `FSHeadshot.dc.html`. I re-ran `ssVals()` in Node against the default state and against injected states (new posts, own votes) to confirm every computed string below.

`var(--x-…, #fallback)` gives the light value; the README token name is in brackets. The font everywhere is `'InterDisplay', sans-serif` with `font-feature-settings:'tnum' 1,'cv11' 1` and `-webkit-font-smoothing:antialiased`. No element in these three areas sets `line-height` except where noted, so it is `normal`. References to "OQ n" point to §7, Open questions.

---

### 1. Screens & states

| # | Screen / state | Exact condition |
|---|---|---|
| P0 | **Profile** | `s.scr === "me"` (`isMe`) |
| P1 | Profile › My stuff = **Rankings** | `(s.meTab \|\| "rankings") === "rankings"` |
| P2 | Profile › My stuff = **Lists** | `meTab === "lists"`. **The initial state is `meTab: "lists"`** (line 1414), so the first visit to Profile from the tab bar, the Menu or the jump panel shows **Lists** selected. The code's fallback `"rankings"` applies only when `meTab` is falsy (OQ 14). |
| P3 | Profile › My stuff = **Start/Sit** | `meTab === "ss"` |
| P3e | Profile › Start/Sit with **zero rows** | `ssPosts.slice(0,4)` is empty. The preview is filtered by the current `ssTab` (OQ 5). Nothing renders between the segmented control and the "Ask a question" button: no empty copy and no divider. The sample data can't reach this state (All 4 / Open 1 / Closed 3, and posts never close), but it must be handled. The Rankings and Lists previews are static, so they have no empty state. |
| P4 | Profile, light theme | `!s.dark`: the pill shows a moon and the label "Dark" |
| P5 | Profile, dark theme | `s.dark`: the pill shows a sun and the label "Light". The class `fs-dark` goes on the 390×844 phone root. |
| S0 | **My start/sit** | `s.scr === "myss"` (`isMySS`) |
| S1 | Filter **All** | `(s.ssTab \|\| "all") === "all"`. This is the default; `ssTab` is not in the initial state. |
| S2 | Filter **Open** | `ssTab === "open"`: posts where `!x.closed` |
| S3 | Filter **Closed** | `ssTab === "closed"`: posts where `x.closed` |
| S4 | Empty list | `ssNone = !posts.length` (no post matches the filter). Shows "No questions here yet". The sample data never reaches this state, but it must still be built. |
| S5 | Card: open start/sit | `!x.closed && x.qtype !== "trade"`. A green dot sits in the status pill and the footer ends with " · crowd leans …". There is no verdict. |
| S6 | Card: closed start/sit with results | `x.closed && x.actual`. Each option shows an actual-points line and the card shows a verdict box. Requires `x.started`: if it is missing, `short(undefined)` throws. |
| S6b | Card: closed start/sit **without results** | `x.closed && !x.actual && qtype !== "trade"`. There are no actual-points lines and no verdict box. The footer has no "crowd leans" because that suffix only appears on open posts. The card shows the mode pill, a grey "Closed" pill, the title, the bars and "N votes[ · roster attached]". Not in the sample data (OQ 21). |
| S7 | Card: trade (open or closed) | `x.qtype === "trade"`. There are no headshots, and the card adds a "You give … · you get …" line. A closed trade shows a decision verdict **and requires `x.decision`**: without it, `x.decision.toLowerCase()` throws (line 1497) (OQ 21). |
| S8 | Verdict "right call" vs "wrong call" | When `vOk` is true the box is green with a check. When false it is orange with "!". |
| S9 | New user-created post (0 votes) | A post made in the composer: `time:"now"`, `n:0`, `pct:[0…]`, no `closed`, no `wk`. It shows "Just now", "Open · closes Sun 1:00 PM" (whatever close time was chosen) and every option at 0% with no highlight (`tot === 0`). The footer still says "crowd leans <opts[0]>". On a trade this reads "crowd leans A. " with a trailing space. These posts can never become closed. |
| S9b | Own vote on own 0-vote post | The user voted on this post in Community, so `s.cmVotes[id]` is an array and `tot = 1` while `n = 0`. Every option shows **0%**, but every option counts as "top" (`pcts[i] === mx && tot > 0`), so every % turns green (Start/Accept) or red (Sit/Decline), with 0-width bars. Footer: **"1 votes"** (OQ 9, OQ 19). |
| S10 | Composer opened from these screens | `s.cmp` set by `ssNew()` shows the full-screen composer overlay (z 27). The composer belongs to another area. |
| T0 | **League settings overlay** | `!!s.settings` (`hasSettings`). **Nothing in the current prototype sets `settings: true`** (see §4 and OQ 1). |
| T1 | Settings → sub-page | Tapping a tile with a page key sets `s.page`, which opens the page overlay (z 25) **on top of** the settings overlay. `settings` stays `true`. |
| T2 | Settings → "coming next" toast | A tile with no page key shows a toast. |

---

### 2. Layout (top to bottom)

#### Global frame on these screens
- **Phone root**: `position:relative; width:390px; height:844px; border-radius:48px; overflow:hidden; color t1; background b0; flex column`. Its class is `themeCls` = `(dark ? "fs-dark" : "") + " dock-sm"` on all three areas.
- **Status bar**: `flex:none; height:50px; padding:6px 32px 0 40px; space-between; 16px / 600`.
  - Left: "9:41".
  - Centre: notch, `position:absolute; top:11px; left:50%; translateX(-50%)`, 120×34, radius 999, #000.
  - Right: signal glyph (18×12) and battery glyph (25×12), both in t1.
  - The screen content is the flex child below the status bar.
- **Scrollers**: every scroller is `.fsm-scroll` with `overflow-y:auto` and `scrollbar-width:none` (the WebKit scrollbar is hidden too).
  - A CSS `::after` spacer is appended with `height: var(--x-dockpad)`. That is **84px** (`dock-sm`) on all three areas, so the bottom padding is the stated padding plus 84px.
- **Headers**: on Profile and My start/sit the header is **inside** the scroller, so it scrolls away. It is not sticky.
- **Scroll position**: each screen is mounted and unmounted by `sc-if`, so Profile, My start/sit and Settings always reopen scrolled to the top. Segment and filter changes re-render inside the same scroller and keep the current scroll offset.

#### P0 Profile (`isMe`)
Scroller: `flex:1; min-height:0; overflow-y:auto; padding:0 16px 24px` (+84px spacer).

1. **Header row**: `display:flex; align-items:center; justify-content:space-between; height:48px`.
   - Left: "Profile", **28px / 600**, letter-spacing −0.03em, colour t1 (inherited). The source uses weight 600 here, not 700.
   - Right: **theme pill**.
     - Box: `height:34px; padding:0 12px 0 10px; border-radius:999px; flex; align-items:center; gap:6px`. Type 13px / 600, label colour t1 (inherited). Background var(--x-b2,#F2F2F4) [b2]. HTML `title` = `themeTip`.
     - Icon: 16×16 svg, viewBox 0 0 16 16, `fill:none; stroke:currentColor; color var(--x-t1); stroke-width 1.5; round caps and joins`.
     - Light mode: moon `M13.5 9.6A5.5 5.5 0 0 1 6.4 2.5a5.5 5.5 0 1 0 7.1 7.1z`, label **"Dark"**, title "Switch to dark mode".
     - Dark mode: sun `M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1`, label **"Light"**, title "Switch to light mode".
2. **Identity row**: `display:flex; align-items:center; gap:14px; margin-top:8px`.
   - Avatar: 64×64 circle, `flex:none`, 24px / 600, #fff text.
     - The text is **"D"**, hard-coded. The script has `myTeam.ini`, but this avatar doesn't use it.
     - Background is `myTeam.av` = `s.myAv`, default **#0088FF**. This is the team avatar colour edited on the league "My team" page (OQ 11).
   - Text column: `flex:1; min-width:0; flex-direction:column; gap:2px`.
     - "Dalton": 18px / 700, letter-spacing −0.02em.
     - "@dalton · 4 leagues": 13px / 500, var(--x-t3,#6E6E73) [t3].
3. **Stats grid**: `grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:16px`.
   - Each card: `padding:10px 12px; border-radius:14px; background var(--x-b1,#F5F5F7)` [b1]; column, gap 2px.
   - Value: 17px / 700. Label: 11px / 500, t3.
   - Data: **"#312" / "Ranking accuracy"**, **"41" / "Followers"**, **"1" / "Titles"**.
4. **"My stuff"** heading: `margin-top:20px`, 17px / 600, letter-spacing −0.01em.
5. **Segmented control**:
   - Track: `grid 3 equal cols; gap:2px; margin-top:8px; padding:2px; border-radius:10px; background b2 #F2F2F4`.
   - Segment: `height:32px; border-radius:8px; centred; 13px / 600`.
   - On: colour t1 #1D1D1F, background var(--x-b0,#fff) [b0], `box-shadow:0 1px 2px rgba(0,0,0,.12)`.
   - Off: colour t3 #6E6E73, transparent background, no shadow.
   - Labels: **"Rankings" | "Lists" | "Start/Sit"**.
6. **Preview rows**: container `flex column; margin-top:6px`.
   - Row: `display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--x-b2,#F2F2F4)`. The last row keeps its border.
   - Icon tile: 40×40, `flex:none; border-radius:12px; background b2`. Svg 18×18 (viewBox 16), stroke t1, width 1.5, round caps and joins.
   - Text column: `flex:1; min-width:0; gap:2px`.
     - Title: 15px / 600, single line with ellipsis (`nowrap; overflow:hidden; text-overflow:ellipsis`).
     - Sub: 12px / 500, colour `subC` per row. It has **no** nowrap or ellipsis, so a long sub wraps onto more lines.
   - Chevron: svg 12×12, `flex:none`, colour var(--x-t5,#AEAEB2) [t5], stroke 2, round, path `M6 3l5 5-5 5`.
   - The rows for each tab are listed in §5.
7. **Contextual create button**:
   - Box: `margin-top:14px; height:44px; flex centred; gap:6px; border-radius:14px; box-shadow: inset 0 0 0 1.5px var(--x-b3,#E5E5EA)` [b3]; 14px / 600; text and icon in t1 (inherited currentColor).
   - Plus icon: 12×12, stroke 2.2, linecap round (no linejoin set), path `M8 3v10M3 8h10`.
   - Label: **"New ranking"** (Rankings), **"New list"** (Lists), **"Ask a question"** (Start/Sit).

None of these elements has a pressed or `style-active` state or a CSS transition. Every change is instant.

#### S0 My start/sit (`isMySS`)
Scroller: `padding:0 16px 24px` (+84px spacer).

1. **Header row**: `flex; align-items:center; gap:10px; height:52px`.
   - Back: 34×34 circle, `flex:none`, background b2. Svg 16×16, stroke t1, width 2, round caps and joins, path `M10 3L5 8l5 5`.
   - Spacer: `flex:1`.
   - Plus: 34×34 circle, **background #0088FF** (accent), colour #fff, `title="Ask a question"`. Svg 15×15, stroke 2.4, linecap round, path `M8 3v10M3 8h10`.
2. **Title**: "My start/sit", **26px / 700**, letter-spacing −0.03em.
3. **Stats grid**: 3 equal columns, `gap:8px; margin-top:12px`.
   - Card: `padding:10px 12px; radius 14px; background b1`; column, gap 2px.
   - Value: **18px / 700**. Label: **10px / 500**, t3, `white-space:nowrap`.
   - Default data: **"4" / "Questions"**, **"740" / "Votes received"**, **"2/2" / "Your calls right"**.
4. **Filter chips**: `display:flex; gap:6px; margin-top:14px`.
   - Chip: `height:30px; padding:0 12px; border-radius:999px; flex; align-items:center; gap:5px; 13px / 600; nowrap`.
   - Content: the label, then a count span. The span sets only `font-size:11px; opacity:.6`, so it inherits weight **600** and the chip's colour.
   - Selected: colour #fff, background var(--x-ink,#1D1D1F) [ink]. Unselected: colour t1, background b2 #F2F2F4.
   - Default data: **"All 4" · "Open 1" · "Closed 3"**.
5. **Card list**: `flex column; gap:10px; margin-top:12px`.
   - **Card**: `padding:14px; border-radius:18px; box-shadow: inset 0 0 0 1px var(--x-b3,#EBEBEE)`. It is an outlined card with no fill; column, gap 10px.
   - a. **Top row**: `flex; align-items:center; gap:6px`.
     - Mode pill: `height:22px; padding:0 9px; radius 999; flex centred; 11px / 700; #fff; nowrap`.
       - Background: **#07B85A** for Start, **#FF0028** for Sit, **#0088FF** for Trade.
       - Text: `"Start "|"Sit " + (x.pick || 1) + " of " + x.opts.length`, or "Trade". Sample posts read "Start 1 of 3", "Start 1 of 2" and "Sit 1 of 3".
       - User-created posts store `pick: pickN`, so they can read "Start 2 of 4", "Sit 3 of 5" and so on. The composer allows 2–6 options and a pick count of 1 to (options − 1).
     - Status pill: `height:22px; padding:0 9px; radius 999; flex; align-items:center; gap:5px; 11px / 600; nowrap`.
       - Open: colour var(--x-tg,#067A3E), background var(--x-gg,#E3F9EC) [green tint]. A **6×6 #07B85A dot** comes first. Text **"Open · closes Sun 1:00 PM"**, a hard-coded string for every open post (OQ 7).
       - Closed: colour var(--x-t2,#3A3A3C) [t2], background b2 #F2F2F4. Text **"Closed"**.
     - Spacer: `flex:1`.
     - Meta: 11px / 500, t3, nowrap. It shows `x.time` ("1h", "Sep 28", "Sep 19", "Sep 12"), or "Just now" when `time === "now"`.
   - b. **Title**: 15px / 600, `line-height:1.3; text-wrap:pretty`. It wraps and is not truncated.
   - c. **Trade line** (trade posts only): 12px / 500, t3. Format: `"You give " + give.map(short).join(", ") + " · you get " + get.map(short).join(", ")`, e.g. "You give J. Conner · you get D. Mooney".
   - d. **Result rows**: column, gap 4px, one row per option. Each row:
     - Row: `position:relative; overflow:hidden; min-height:40px; flex; align-items:center; gap:8px; padding:4px 10px 4px 6px; border-radius:10px; background b1 #F5F5F7`.
     - Fill bar: `position:absolute; left:0; top:0; bottom:0; width:<pct>%; background:<barC>`. It has no radius of its own; the row's `overflow:hidden` clips it. There is no transition.
     - Headshot (non-trade only): a `position:relative; flex:none; display:flex` wrapper around FSHeadshot at **28px**:
       - Wrapper: `title` = player name, 28×28, radius 50%, `overflow:hidden`, background #EEEEF1.
       - Ring: `0 0 0 1px #fff, 0 0 0 2.5px <team colour>`. Ring width is 1.5px because size < 32.
       - Photo: `position:absolute; inset:0; 100%×100%; object-fit:cover; object-position:50% 15%; transform:scale(1.25) translateY(8%)`, `alt` = player name. On image `onError` it falls back to initials.
       - Initials: `max(9, round(28×0.36))` = **10px / 700**, #6E6E73 on #EEEEF1. They are built from the name with any trailing " D/ST" removed, split on spaces, apostrophes and hyphens (`/[\s'-]+/`). Take the first letter of the first part and the first letter of the last part, uppercased; "?" if empty.
       - Photo source: `assets/headshots/<HEAD[name]>.jpg`. A player with no HEAD entry gets `src = ""`, which shows initials.
       - Team colour: from `pinfo(name).team`. A player missing from PDB gets team "FA", which has no TC entry, so the ring becomes `inset 0 0 0 1px rgba(0,0,0,.04)` instead of a team ring.
     - Label column: `position:relative; flex:1; min-width:0; column`.
       - Name: 13px / 600, single line with ellipsis. It is always the **full option string** (`label: isT ? o : o`): e.g. "Isiah Pacheco", or "Accept"/"Decline". It is never shortened.
       - Actual points (closed with results only): 10px / 600, colour `actC`.
     - Percent: `position:relative; flex:none; 14px / 700`, colour `pctC`.
   - e. **Verdict box** (`hasVerdict`): `flex; align-items:center; gap:8px; padding:8px 10px; border-radius:10px; background vBg`.
     - Icon: svg 14×14, `flex:none; stroke = vFg`, width 2.2, round caps and joins.
       - Check (`vOk`): `M3 8.5l3.2 3L13 4.5`.
       - Exclamation (not `vOk`): `M8 4.5v4M8 11h.01`.
     - Text: 12px / 600, `line-height:1.35`, colour vFg, `text-wrap:pretty`.
     - `vOk`: background var(--x-gg,#E3F9EC), text var(--x-tg,#067A3E). Not `vOk`: background var(--x-go,#FFF3E6), text var(--x-to,#B25C00) [orange tint].
   - f. **Footer**: 11px / 500, t3, e.g. "58 votes · roster attached · crowd leans I. Pacheco". It wraps.
6. **Empty state**: sits inside the card list, so it inherits `margin-top:12px`. `padding:36px 0; text-align:center; 13px / 500; t3`, **"No questions here yet"**.

There are no pressed states or transitions anywhere on this screen.

#### T0 League settings overlay (`hasSettings`)
- Container: `position:absolute; left:0; right:0; top:50px; bottom:0; z-index:23; flex column; background var(--x-b0,#fff)`. It covers everything under the status bar, including the tab bar (z 4) and the home indicator.
- **Fixed header** (outside the scroller): `flex:none; height:48px; flex; align-items:center; padding:0 12px`.
  - Close: 36×36 circle, background b2. X icon 14×14, stroke 2.2, linecap round, path `M4 4l8 8M12 4l-8 8`, colour t1 (inherited).
- **Scroller**: `padding:4px 16px 32px` (+84px spacer).
  - Title block: `flex column; gap:2px; padding:0 4px 16px`, so the text starts 20px from the screen edge.
    - **"Sunday Funday League"**: 24px / 700, letter-spacing −0.02em. Hard-coded (OQ 2).
    - **"League settings"**: 14px / 500, t3.
  - Tile grid: `grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px`. There are 13 tiles, so the 7th row holds "Stat corrections" alone in the left column.
  - **Tile**: `min-height:116px; padding:14px; border-radius:16px; background b1 #F5F5F7; flex column; gap:5px`.
    - Pressed (`style-active`): `background: var(--x-b2,#EDEDF0)`. The pressed fallback is **#EDEDF0**, not #F2F2F4.
    - Icon: svg 18×18 (viewBox 16), colour t1, `flex:none; margin-bottom:6px`, stroke 1.5, round caps and joins.
    - Label: 15px / 600.
    - Sub: 12px / 500, `line-height:1.4`, t3, `text-wrap:pretty`.

| Tile label | Sub copy | Icon path | Tap |
|---|---|---|---|
| My team | Team name, avatar and player nicknames | `M8 8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 14c.8-2.6 3-4 5.5-4s4.7 1.4 5.5 4` (ICON.profile) | page `myteam` |
| General | League name, size and roster | `M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4` | page `general` |
| Draft | Draft type, order and pick timer | `M2.5 3.5h11v9h-11zM2.5 6.5h11M6 3.5v9M9.5 3.5v9` | toast "Draft settings: screens coming next" |
| Playoffs | Teams, weeks and seeding | `M3 3.5h3v3H3zM3 9.5h3v3H3zM6 5h2.5v6H6M8.5 8H13` | page `playoffs` |
| Scoring | Point values for every stat | `M3 13V9h3v4M6.5 13V5h3v8M10 13V7.5h3V13` (ICON.leaders) | page `scoring` |
| Notifications | Choose which alerts you get | `M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14h3` | toast "Notifications settings: screens coming next" |
| Commissioner note | Notes from your commissioner | `M3.5 3.5h9v9h-9zM5.5 6h5M5.5 8.5h5M5.5 11h3` (ICON.news) | toast "Commissioner note settings: screens coming next" |
| Co-owners | Share control of your team | `M6 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13c.4-2 2-3.2 4-3.2s3.6 1.2 4 3.2M11 7.5a1.8 1.8 0 1 0 0-3.6M12 9.9c1.3.4 2.2 1.5 2.5 3.1` | toast "Co-owners settings: screens coming next" |
| Draft results | Every pick from this season's draft | `M3 4h10M3 8h10M3 12h6` (ICON.lists) | page `draft` |
| League legend | What the icons and labels mean | `M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 7.5V11M8 5h.01` | toast "League legend settings: screens coming next" |
| League history | Past champions and all-time stats | `M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5` | page `history` |
| Previous seasons | Open this league from past years | `M3 4.5h10v8.5H3zM3 7.5h10M6 3v3M10 3v3` (ICON.sched) | page `seasons` |
| Stat corrections | Recent scoring changes from the NFL | `M3 13h10M4.5 10.5l6.8-6.8 1.5 1.5-6.8 6.8H4.5z` | toast "Stat corrections settings: screens coming next" |

---

### 3. Interactions

**Profile**
- **Theme pill** (`toggleDark`):
  - Computes `d = !s.dark` and writes `localStorage["fieldscout-theme"] = "dark"|"light"` inside try/catch, then calls `setState({dark:d})`.
  - The root gets or loses the `fs-dark` class instantly. The pill's icon, label and tooltip swap. There is no transition.
  - The same handler drives the jump panel's "Dark mode" switch.
  - On mount, a stored value of `"dark"` restores dark mode. The Lists & Rankings file reads the same key, so the theme survives navigation between the two files.
- **Segment tap**: `set({ meTab: v })`, where v is `rankings`, `lists` or `ss`.
  - The rows and the create-button label swap instantly.
  - `meTab` persists in component state for the session, so returning to Profile keeps the last segment. A full page reload (for example coming back from the Lists file) resets it to `"lists"`.
- **Rankings row tap** (any of the 3): full-page navigation to `FieldScout Mobile Lists and Rankings.dc.html#mine`, which opens the rankings hub with source "Mine" and the title "My rankings". It does not deep-link to the tapped ranking (OQ 6).
- **Lists row tap** (any of the 3): navigates to `…Lists and Rankings.dc.html#lists` (the My lists grid). It does not open the specific list.
- **Start/Sit row tap** (any of the up to 4): `set({ scr:"myss", ssTab:"all" })`. This opens My start/sit with the filter reset to All. It does not scroll to or highlight the tapped post.
- **Create button** (`meNew`):
  - Rankings: navigates to `…#new-ranking`.
  - Lists: navigates to `…#new-list`.
  - Start/Sit: calls `ssNew()`, i.e. `set({ sheet:null, cmp:{ kind:"poll", qtype:"ss", q:"", mode:"start", pickN:1, opts:[null,null,null], give:[null], get:[null], roster:0, scoring:"PPR", close:"kickoff" } })`. This opens the full-screen composer (z 27) with the header title "Start or sit".
  - Note `roster:0`. The post defaults to **attached** to league 0's roster, labelled `LEAGUES[0].team + " · " + LEAGUES[0].sub` = "Touchdown Tacos · 12-team standard". The label follows a renamed team after a My team save. The Community "+" sheet uses `roster:null` instead (OQ 16).
- **Composer result**:
  - Close (X) sets `cmp:null` and returns to the same screen.
  - **Post** prepends `{ id:"u"+Date.now(), by:"@dalton", av:s.myAv, time:"now", mine:true, tags:[], type:"poll", …, n:0, pct:[0…] }` to `cmMine`.
    - Start/sit posts add `mode`, `pick:pickN` and `opts` (the filled options).
    - Trade posts add `qtype:"trade"`, `give`, `get` and `opts:["Accept","Decline"]`.
    - Both add `roster:{li,label}` if one is attached.
    - **The chosen close time is not stored**, and neither are `closed` or `wk`.
  - Post also sets `cmp:null, pick:null, cmTab:"all", cmTopic:null, cmQuery:"", cmSearch:false` and shows the toast **"Posted to Community"**.
  - `scr` does not change, so the user stays on Profile or My start/sit.
  - The new post appears **first**, as an open post with 0 votes (state S9). The counts update: "Questions" +1 and "All"/"Open" +1. "Votes received" stays the same.
  - The Home "My stuff" Start/Sit tile sub ("1 open · 3 closed") is a static string and does **not** update (OQ 22).

**My start/sit**
- **Back** (`goHome`): `set({ scr:"home", sheet:null })` goes to **Home**, not to Profile (OQ 3).
- **Plus** (`ssNew`): opens the same composer as above.
- **Filter chip**: `set({ ssTab: v })` for `all`, `open` or `closed`. It filters the list instantly. The chip counts are always computed over the unfiltered set. Selection is single-select.
- Cards, result rows, headshots and verdicts are **not tappable**. There is no vote UI on your own posts here. Voting on your own open post is only possible in Community, and that vote leaks into these screens as described in §5.
- There is no swipe, long-press or drag anywhere in these three areas.

**Settings overlay**
- **Close (X)** (`closeSettings`): `set({ settings:false })`.
- **Tile with a page key**: `set({ page:k, draftName:s.myName, draftAv:s.myAv })` opens the page overlay (z 25) above settings.
  - Closing that page (`closePage` → `page:null`) returns to the settings grid.
  - "My team" Save (only when the form is dirty) has these effects:
    - Writes `TEAMS[0].name/av/ini` and `LEAGUES[0].team`.
    - Sets `myName`, `myAv` and `page:null`.
    - Toasts "Team updated".
    - Leaves you on settings.
  - The new `myAv` immediately recolours the 64px Profile avatar and the 22px tab-bar avatar. The letter stays "D".
- **Tile without a page key**: toast `"<label> settings: screens coming next"`.
- Tiles darken to the b2 fallback #EDEDF0 while pressed (`style-active`).

**Toast** (shared component): `position:absolute; left:50%; bottom:100px; translateX(-50%); z-index:30; height:36px; padding:0 16px; radius 999; flex; align-items:center; background var(--x-ink,#1D1D1F); colour #fff; 13px / 500; nowrap`.
- It appears and disappears with no animation.
- It auto-clears after **1800ms**. A new toast restarts the timer through `clearTimeout`.
- The README says about 2.2s (OQ 13).

**Tab bar on Profile**
- Home: `set({scr:"home", sheet:null})`.
- Community: `set({scr:"community", sheet:null})`.
- **Players**: toast "Not part of this prototype".
- Profile: effectively a no-op. It re-sets `scr:"me"` and clears `sheet`.

---

### 4. Navigation

**Arriving at Profile (`scr:"me"`)**
- **Tab bar**: the avatar "Profile" item on any outside-league screen (Home or Community). `meTab` is unchanged, initially "lists".
- **Home › "My stuff" tiles**: `set({ scr:"me", sheet:null, meTab })` with "Rankings" → `rankings`, "Lists" → `lists`, "Start/Sit" → `ss`.
  - The tile subs are **static strings**: "3 rankings · 2 submitted", "3 lists", "1 open · 3 closed".
- **In a league**: Menu sheet › "FieldScout" grid › "Profile" tile (ICON.profile): `set({ scr:"me", sheet:null })`.
- **Jump panel #3 "Profile · lists & rankings"**: `go("me")`, which is presentation-only.
  - It sets `sheet:null` and clears `prof`, `trade`, `settings`, `tradeOpen` and `teamView`.
  - It does **not** clear `page`, `cmp`, `pick`, `gs`, `cmOpen` or `colTip`. If one of those overlays is open, it stays on top of Profile. `convo` is also not cleared, but that has no visible effect here.
- **Coming back from the Lists & Rankings file**:
  - Its root back button (`goProfile`) and its **Home / Community / Leagues** tab items do `window.location.href = "FieldScout Mobile.dc.html"` with no hash. That reloads the main file in its **initial state (League › Match)**, not Profile.
  - All in-memory state is lost on that reload: `meTab`, `ssTab`, new posts, votes and the My team edits. Only the theme survives, through localStorage.
  - That file's **Profile** tab (always #fff, avatar style) calls `go("rk")` and stays inside the Lists file (line 417 of that file). Its other tab labels are var(--x-t3).
  - OQ 15.

**Arriving at My start/sit (`scr:"myss"`)**: only from the Profile › Start/Sit preview rows, which set `ssTab:"all"`. There is no jump-panel entry, no Home entry and no tab entry.

**Leaving My start/sit**
- **Back** goes to Home.
- **League tab bar › Match / Team / Players / League** goes into the league (see the dock below).
- **League tab bar › Menu** opens the Menu sheet. From there, FieldScout grid › **Profile** (`set({scr:"me", sheet:null})`) is the only in-app route back to Profile. FieldScout grid › Home goes to Home.

**Back and close**
- Profile is a root tab with no back button.
- My start/sit back goes to Home.
- Settings X closes the overlay to whatever is underneath.

**Bottom dock per screen**
- **Profile**:
  - Tab bar: **Home · Community · Players · Profile**, with Profile highlighted.
  - No league switcher (`showSwitcher` false).
  - `barMt:-80px`, so the 80px bar overlays the scroller and content scrolls behind it.
  - Bar: `flex:none; position:relative; z-index:4; height:80px; padding:6px 8px 0; flex; background var(--x-barA, rgba(29,29,31,.94))`.
  - Item: `flex:1; height:48px; column; centred; gap:3px`. Label 10px / 600. Colour #fff when on, **#A1A1A6** when off.
  - Icons are 22×22 (viewBox 16) at stroke 1.5, round caps and joins:
    - Home (ICON.home): `M2.5 7.5L8 3l5.5 4.5V13h-11z`
    - Community star: `M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z`
    - Players (ICON.players): `M5.5 6.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5`
  - Profile item: a 22×22 avatar circle, "D" at 10px / 600 in white, background `s.myAv`.
    - Active: `box-shadow: 0 0 0 2px var(--x-ink,#1D1D1F), 0 0 0 3.5px var(--x-b0,#fff)`, i.e. a 2px ink ring, then a 1.5px b0 outer ring.
    - Inactive: `none`.
  - **Home indicator** (line 644): `position:absolute; left:50%; bottom:8px; translateX(-50%); 134×5; radius 999; background var(--x-b0,#fff)`.
    - It has **no z-index**, so it paints **beneath** the z-4 tab bar even though it comes later in the DOM.
    - Light mode: it shows through the 94%-opaque bar only as a faint line of about **#2B2B2C** (white under rgba(29,29,31,.94)).
    - Dark mode: it is **invisible** (#121212 under rgba(18,18,18,.92)).
    - It is not a visible white pill on these screens (OQ 20).
- **My start/sit (as built)**:
  - `inLg = !["home","community","me"].includes(scr)` is **true** for `"myss"`. The dock therefore shows the **league** tab bar **Match · Team · Players · League · Menu** (OQ 4).
  - No league switcher (`showSwitcher` needs `scr === "league"`). `dock-sm` (84px pad), `barMt:-80px`.
  - The bar and item metrics are the same as above. Icons:

    | Item | Icon |
    |---|---|
    | Match | `M2.5 4.5h4v7h-4zM9.5 4.5h4v7h-4zM8 3v10` |
    | Team | ICON.players `M5.5 6.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5` |
    | Players | ICON.search `M7 2.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6zM10.6 10.6L14 14` |
    | League | ICON.leaders `M3 13V9h3v4M6.5 13V5h3v8M10 13V7.5h3V13` |
    | Menu | `M2.5 4h11M2.5 8h11M2.5 12h11` |

  - Colours:
    - Match, Team, Players and League are "on" only when `scr === "league" && tab === v && sheet !== "menu"`, so they are always **#A1A1A6** here.
    - Menu is **#fff while `sheet === "menu"`**, otherwise #A1A1A6. "Nothing highlighted" is therefore true only while the menu sheet is closed.
  - Taps:
    - Match, Team, Players and League do `set({ scr:"league", tab:v, sheet:null, swap:null })`. Match also sets `mi:0` when `s.tab` is already `"match"`; `s.tab` persists from earlier league visits and starts as "match".
    - Menu toggles `sheet: s.sheet === "menu" ? null : "menu"`.
    - While the sheet is open, its z-20 backdrop `rgba(0,0,0,.32)` covers the tab bar, so the bar shows dimmed. A tap there hits the backdrop (`closeSheet` → `sheet:null`), not the Menu item.
  - The Menu sheet (another area) shows three things:
    - The My team card (`openMyTeam` → `page:"myteam"`).
    - The current league's items (`menuLeagueItems`).
    - The FieldScout grid: Home, Community, Stats (toast), Profile and Settings (toast).
- **Settings overlay**: covers the dock entirely (z 23 > dock z 4). No tab bar, switcher or home indicator is visible. While it is open, `dockCls` is `dock-sm` and the switcher is suppressed (`!s.settings`).

**Settings reachability (as built)**: none of these sets `settings:true`.
- `openSettings` (line 1755) is defined but **not bound** anywhere in the markup.
- `go()` has a `sub === "settings"` branch, and the jump "on" logic checks `sub === "settings"`, but **no JUMPS entry passes it**. Jump #25 "Menu · league settings" is `["league","match","menu"]`, which is identical to #19 and only opens the Menu sheet.
- The Menu sheet's FieldScout › "Settings" tile calls `soon` → toast "Not part of this prototype".
- The Menu sheet's league list item "League settings" (sub "12 teams") opens page `general` directly (`set({ sheet:null, page:"general" })`), not this overlay.

See OQ 1.

**Z-order** (low to high, from `z-index` on each `sc-if` root; equal z resolves by DOM order):
1. Screen content and the home indicator (z auto)
2. League switcher (z 4, line 628) and tab bar (z 4)
3. Bottom sheets with backdrop `rgba(0,0,0,.32)` (z 20)
4. Team view `hasTv` (z 21)
5. Player profile `hasProf` (z 22)
6. **Settings overlay `hasSettings` (z 23)**
7. Trade offer detail `hasTd` (z 23, later in the DOM, so it paints above Settings)
8. Trade builder `hasTrade` (z 24)
9. Page overlay `hasPage` (z 25)
10. Community post detail `hasCmDetail` (z 26)
11. Composer `hasCmp` (z 27)
12. Player picker `hasPick` (z 28). The composer that these screens launch opens it.
13. Game stats `hasGS` (z 29)
14. Column tooltip `hasColTip` (z 30)
15. Toast (z 30, last in the DOM, so it is topmost)

---

### 5. Data shown

**Profile, static placeholder copy** (in product these are real user data)
- Name "Dalton".
- Handle "@dalton".
- "4 leagues": the count of the user's leagues. There are 4 LEAGUES.
- Stats: "#312" Ranking accuracy (the accuracy rank), "41" Followers, "1" Titles (championships).

**Rankings rows** (icon ICON.rank `M4 13V8M8 13V3M12 13V6`)

| Title | Sub | Sub colour |
|---|---|---|
| Week 5 · RB · PPR | Submitted · graded after Monday night | **#07A852** (literal; README "Success text") |
| Rest of season · WR · PPR | Saved, not submitted | var(--x-tb,#0074DB) [blue tint text] |
| Week 4 · QB · PPR | Finalized · top 18% | var(--x-t4,#8E8E93) [t4] |

The title format is `<period> · <pos> · <scoring>`. The status colours are Submitted = green, Saved = blue and Finalized = t4.

**Lists rows** (icon ICON.lists `M3 4h10M3 8h10M3 12h6`, sub colour t3)
- "My top 5 QBs for Week 6": "5 players · Ranked · Updated 2d ago"
- "5 players not to draft": "5 players · Video · Updated Aug 20"
- "RB handcuffs, tiered": "4 players · Tiers · Updated Oct 12"

The sub format is `<n> players · <Ranked|Video|Tiers> · Updated <relative or date>`.

**Start/Sit rows** (icon `M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5`)
- Rows are `ssPosts.slice(0,4)`. They use the **current `ssTab` filter** (OQ 5) and the same sort as My start/sit.
- Sub: `modeLabel + " · " + ("Open"|"Closed") + " · " + foot.split(" · ")[0]`. The last part is the **footer's vote count, `tot`**, which includes the user's own Community vote.
- Sub colour: **#07A852** if open, t3 if closed.
- Defaults:
  1. "FLEX spot: who starts?": "Start 1 of 3 · Open · 58 votes" (green)
  2. "WR2 for Sunday?": "Start 1 of 2 · Closed · 214 votes"
  3. "Conner for Mooney. Do I take it?": "Trade · Closed · 167 votes"
  4. "Which RB sits this week?": "Sit 1 of 3 · Closed · 301 votes"
- After the user votes on p5 in Community, row 1 reads "Start 1 of 3 · Open · 59 votes".

**My start/sit data model**
- **Source**: `[...s.cmMine polls, ...CMFEED polls with by === "@dalton"]`. CMFEED order is p6, p7, p8, p5. In product this is real data: the user's own polls, vote tallies, close time, actual fantasy points, the user's actual lineup decision (`started`) and the trade decision (`decision`).
- **Sort**: the code uses `(a,b) => keyA > keyB ? -1 : 1` with `key = closed ? (wk || 0) : 99`.
  - That comparator returns 1 on ties, so it is not consistent. V8 happens to keep insertion order; verified, a state with two new posts sorts to [u2, u1, p5, p6, p7, p8].
  - **Implement it explicitly**: open posts first in insertion order (user posts newest-first because they are prepended, then CMFEED order). Then closed posts by `wk` descending, with a missing `wk` treated as 0.
  - Default order: p5 (open), p6 (wk 4), p7 (wk 3), p8 (wk 2).
- **Vote totals**: `tot = x.n + (Array.isArray(s.cmVotes[x.id]) ? 1 : 0)`. The +1 is the user's own vote cast in Community.
- **Percent**: `tot ? round(pct[i] / 100 × n / max(1,n) × 100) : 0`. That is `round(pct[i])` when `n > 0`, and 0 otherwise.
  - It **ignores the user's own vote**. Community's poll view folds that vote into its percentages; this screen doesn't.
  - Shown as an integer + "%". The bar width uses the same %.
  - So the three numbers can disagree by 1: the footer and preview count use `tot`, the percentages use stored `pct`/`n`, and "Votes received" uses raw `n` (OQ 17, OQ 19).
- **Top option**: `pcts[i] === max(pcts) && tot > 0`.
  - Ties are all "top".
  - Only the top value is highlighted, even for "Start 2 of N" polls (OQ 10).
  - With `tot === 0` nothing is highlighted.
  - With `tot === 1, n === 0` (own vote on a 0-vote post) **every** option is top: every % is green or red over 0-width bars.

| Poll type | Top % colour | Top bar | Non-top % | Non-top bar |
|---|---|---|---|---|
| Start | var(--x-tg,#067A3E) | var(--x-gg,#E3F9EC) | t3 | var(--x-b3,#EBEBEE) |
| Sit | var(--x-tr,#C8001C) | var(--x-gr,#FFE9EC) | t3 | b3 |
| Trade, "Accept" (index 0) top | tg | gg | t3 | b3 |
| Trade, "Decline" (index 1) top | tr | gr | t3 | b3 |

- **Actual points line**: `<pts.toFixed(1)> pts`, plus `" · you started him"` (Start) or `" · you sat him"` (Sit) on the option equal to `x.started`. The colour is tg for the **single highest scorer**, in both start and sit polls; every other option is t3.
- **Crowd pick**: `crowd = x.opts[pcts.indexOf(max)]`, i.e. the **first** option with the max %. With 0 votes every % is 0, so the crowd is `opts[0]`.
- **Verdict copy**:
  - Start/sit (closed and `actual`):
    - First sentence: "The crowd was right. " or "The crowd missed. ".
    - Second sentence, one of:
      - "You made the right call."
      - "You went with <short(started)>, <short(best)> scored more." (Start)
      - "You went with <short(started)>, <short(worst)> was the one to sit." (Sit)
    - "Crowd right" means the crowd pick was the best scorer (Start) or the worst scorer (Sit).
    - `vOk` = the user's own call was right.
  - Trade (closed): `"The crowd said " + crowd.toLowerCase() + ". You " + decision.toLowerCase() + "."`. `vOk = (crowd === "Decline") === (decision === "Declined")`.
- **Default verdicts**:
  - p6: "The crowd was right. You made the right call."
  - p7: "The crowd said decline. You declined."
  - p8: "The crowd missed. You made the right call."
  - All three are green.
- **Footer**: three parts, joined in order:
  - `tot.toLocaleString() + " votes"`: en-US commas, e.g. "1,234 votes". It is **never singular**, so one vote reads "1 votes", unlike Community's "1 vote" (OQ 9).
  - `" · roster attached"` if `x.roster`.
  - (open only) `" · crowd leans " + short(crowd)`.
- **Footer edge cases**:
  - With 0 votes the footer still says "crowd leans <short(opts[0])>".
  - On a new open trade it reads **"0 votes · roster attached · crowd leans A. "**: `short("Accept")` = "A. " with a trailing space ("D. " for Decline).
  - When tops are tied, "crowd leans" names the first tied option even though every tied option is highlighted (OQ 8).
- **`short()`**: `n[0] + ". " + rest`, so "Isiah Pacheco" becomes "I. Pacheco". Names ending in "D/ST", or whose first word contains ".", are unchanged.
- **Stats**:
  - Questions = the total count of my polls (unfiltered).
  - Votes received = Σ raw `x.n` with en-US formatting. It excludes the user's own Community votes; new posts add 0.
  - Your calls right = `hits + "/" + closedWithActual`, or **"–"** (U+2013) if there are none.
    - A hit is `started` equal to the top scorer (Start) or the lowest scorer (Sit).
    - Trade polls and closed polls without `actual` are excluded.
- **Default cards in order**:
  1. **Open start**, "1h", "FLEX spot: who starts?".
     - Rows: **Isiah Pacheco** (KC, photo `pacheco.jpg`) 46%, top, green. **Rhamondre Stevenson** (NE, no photo, initials "RS") 33%. **Tyler Allgeier** (ATL, initials "TA") 21%.
     - Footer: "58 votes · roster attached · crowd leans I. Pacheco".
  2. **Closed start**, "Sep 28", "WR2 for Sunday?".
     - Rows: **Jameson Williams** (DET, photo) 71% top, "18.4 pts · you started him" in green. **Jahan Dotson** (PHI, photo) 29%, "3.2 pts" in t3.
     - Verdict green. Footer: "214 votes · roster attached".
  3. **Closed trade**, "Sep 19", "Conner for Mooney. Do I take it?".
     - Line: "You give J. Conner · you get D. Mooney".
     - Rows: **Accept** 38% (t3 % / b3 bar); **Decline** 62% (tr % / gr bar).
     - Verdict: "The crowd said decline. You declined." Footer: "167 votes · roster attached".
  4. **Closed sit**, "Sep 12", "Which RB sits this week?".
     - Rows: **Isiah Pacheco** (KC) 24%, "6.1 pts · you sat him" in t3. **James Conner** (ARI, photo) 18%, "14.8 pts" in green. **Tyler Allgeier** (ATL, initials) 58% top, red, "9.7 pts" in t3.
     - Verdict: "The crowd missed. You made the right call." Footer: "301 votes" (no roster).
- **Headshot ring colours**: KC #E31837, NE #002244, ATL #A71930, DET #0076B6, PHI #004C54, ARI #97233F. Photos exist for Pacheco, Williams, Dotson and Conner (HEAD map → `assets/headshots/<key>.jpg`).

**Settings**: in product the league name is the selected league's name. All tile copy is static.

---

### 6. Dark mode (`.fs-dark` values used in these areas)

| Var | Light fallback | Dark | Used for |
|---|---|---|---|
| --x-t1 | #1D1D1F | #FFFFFF | titles, icons, unselected chip text, segmented "on" text, create-button and close-icon colour |
| --x-t2 | #3A3A3C | #D9D9D9 | Closed status-pill text |
| --x-t3 | #6E6E73 | #B3B3B3 | meta, labels, subs, footers, non-top % |
| --x-t4 | #8E8E93 | #A7A7A7 | "Finalized · top 18%" |
| --x-t5 | #AEAEB2 | #727272 | row chevrons |
| --x-tb | #0074DB | #6FB5FF | "Saved, not submitted" |
| --x-tg | #067A3E | #1ED760 | open-pill text, top Start/Accept %, best actual, OK verdict |
| --x-tr | #C8001C | #FF6B6B | top Sit/Decline % |
| --x-to | #B25C00 | #FFB340 | wrong-call verdict text and icon |
| --x-b0 | #fff | #121212 | segmented "on" fill, settings background, avatar outer ring, home indicator |
| --x-b1 | #F5F5F7 | #282828 | stat cards, result rows, settings tiles |
| --x-b2 | #F2F2F4 (tile pressed fallback #EDEDF0) | #333333 | theme pill, segmented track, icon tiles, row dividers, back and close buttons, unselected chips, Closed pill, tile pressed |
| --x-b3 | #EBEBEE / #E5E5EA | #3E3E3E | card outline, create-button outline, non-top bars |
| --x-ink | #1D1D1F | #4D4D4D | selected filter chip, toast, tab avatar ring |
| --x-gg | #E3F9EC | #12301F | top Start/Accept bar, open pill, OK verdict background |
| --x-gr | #FFE9EC | #3A1A1D | top Sit/Decline bar |
| --x-go | #FFF3E6 | #3A2A14 | wrong-call verdict background |
| --x-barA | rgba(29,29,31,.94) | rgba(18,18,18,.92) | tab bar |

These literals do **not** change in dark mode:
- #0088FF (plus button, Trade pill, default avatar)
- #07B85A (Start pill, open dot)
- #FF0028 (Sit pill)
- **#07A852** (Rankings "Submitted" sub and open Start/Sit sub). The README's dark success colour #1ED760 is not applied here (OQ 12).
- #fff text on pills and avatars
- the segmented shadow rgba(0,0,0,.12)
- #A1A1A6 inactive tab labels
- the headshot's #fff gap ring and its #EEEEF1 / #6E6E73 initials fallback

Dark-mode edge cases:
- The **home indicator** is invisible (b0 #121212 under the bar).
- One My team swatch is `var(--x-t1,#1D1D1F)` (line 1790). If it is saved, `myAv` resolves to **#FFFFFF** in dark mode, so the 64px Profile avatar and the 22px tab avatar show white "D" on white, which is unreadable (OQ 11).

The root sets `color-scheme: dark` under `.fs-dark`.

---

### 7. Open questions

1. **The League settings overlay can't be reached** (`hasSettings`, lines 823–831). Should the 13-tile grid be built, and if so, what opens it?
   - `openSettings` is never bound in the markup.
   - No jump passes sub "settings"; jump #25 "Menu · league settings" just opens the Menu.
   - The Menu's FieldScout › Settings tile toasts "Not part of this prototype".
   - The Menu's league list opens the sub-pages directly ("League settings" → page `general`).
2. The settings overlay title is hard-coded "Sunday Funday League" instead of `LEAGUES[s.lg].name`. Should it follow the current league?
3. My start/sit's back button calls `goHome` and lands on Home, but the only way in is from Profile's Start/Sit rows. Should back return to Profile?
4. On My start/sit the dock shows the league tab bar (Match/Team/Players/League/Menu) with nothing highlighted, because `inLg` excludes only home/community/me. Is this a bug? The expected bar would be Home/Community/Players/Profile with Profile highlighted.
5. Profile's Start/Sit preview uses whatever `ssTab` was last chosen on My start/sit (pick "Closed" there and the preview shows only closed posts). Should the preview always be unfiltered? It also has no empty-state copy when it has zero rows.
6. Profile rows don't open the tapped item: Rankings → #mine, Lists → #lists, Start/Sit → the whole My start/sit list. Should they deep-link to the specific ranking, list or post?
7. Every open post shows "Open · closes Sun 1:00 PM" whatever close time was chosen in the composer ("At kickoff" / "In 24 hours" / "In 1 hour"). The close time is never stored, and user posts never get `closed`/`wk`, so they stay open forever. Should each post store and show its real close time and then close?
8. The footer shows "crowd leans <first option>" even at 0 votes; on open trades `short()` makes it "crowd leans A. " / "D. " (trailing space). With tied tops it names the first tied option. Should "crowd leans" be hidden at 0 votes and on ties, and should trades read "Accept"/"Decline"?
9. The vote count always appends " votes" ("1 votes"), while Community's poll view uses "1 vote". Should this switch to the singular?
10. For multi-pick polls ("Start 2 of 5", "Sit 2 of 3") only the highest-% option(s) get the green/red highlight. Should the top N picks be highlighted, as Community does with `rankd`?
11. The Profile avatar and the tab-bar avatar show a hard-coded "D" on the team avatar colour (`s.myAv`, edited by the league My team page). The ink swatch makes them white-on-white in dark mode. Should the profile identity (initial, photo, colour) be separate from the team avatar?
12. The Rankings "Submitted" sub and the open Start/Sit sub use a literal #07A852, which doesn't change in dark mode. The README says success text in dark mode is #1ED760. Should these use the tg token?
13. The toast auto-dismisses after 1800ms in code, but the README says about 2.2s. Which is correct?
14. Default Profile segment: the initial state is `meTab: "lists"`, but the code's fallback is "rankings". Which tab should a first visit open on?
15. Returning from the Lists & Rankings file (root back, Home, Community or Leagues) reloads the main file in its initial state (League › Match), not Profile, and drops all in-memory state. In product, should back from Lists or Rankings return to Profile on the same segment?
16. "Ask a question" from Profile or My start/sit opens the composer with `roster: 0`, so the league-0 roster is attached by default. The Community "+" sheet starts with `roster: null`. Is attaching by default intended for this entry point?
17. "Votes received" sums only the stored counts (`n`). "Your calls right" counts only closed start/sit polls with actual points and excludes trades. Are those the intended definitions?
18. Closed posts are sorted by week number (`wk`), not by close date. User-created posts have no `wk`, so the order would break once they can close. Should closed posts sort by close time?
19. The user's own Community vote is counted in the footer and preview vote count (`tot`), but not in the percentages, and not in "Votes received". On a 0-vote post it makes every option "top" with 0% bars. Should your own vote count consistently, as Community's percentages do, or be excluded everywhere?
20. The home indicator (134×5, b0) has no z-index and paints beneath the z-4 tab bar: a faint ~#2B2B2C line in light mode, invisible in dark mode. Is it meant to sit above the bar as a visible pill?
21. What should a closed poll without results show? A closed start/sit with no `actual` shows no verdict and no points. A closed trade with no `decision` crashes the prototype. Is a "Results pending" or "No decision recorded" state needed?
22. The Home "My stuff" tile subs ("3 rankings · 2 submitted", "3 lists", "1 open · 3 closed") are static and don't update after posting. Should they be live counts?

---

### Open questions
- OQ 1: The League settings overlay (hasSettings, lines 823–831) can't be reached. openSettings is never bound in the markup. No JUMPS entry passes sub 'settings'; jump #25 'Menu · league settings' is ['league','match','menu'], the same as #19. The Menu's FieldScout › Settings tile toasts 'Not part of this prototype'. The Menu's league list opens the sub-pages directly ('League settings' → page general). Should the 13-tile grid be built, and if so, what opens it?
- OQ 2: The settings overlay title is hard-coded 'Sunday Funday League' instead of LEAGUES[s.lg].name. Should it follow the current league?
- OQ 3: My start/sit's back button calls goHome and lands on Home, but the only way in is from Profile's Start/Sit rows. Should back return to Profile?
- OQ 4: On My start/sit the dock shows the league tab bar (Match/Team/Players/League/Menu) with nothing highlighted; only Menu turns #fff while the menu sheet is open. This happens because inLg excludes only home/community/me. Is it a bug? The expected bar would be Home/Community/Players/Profile with Profile highlighted.
- OQ 5: Profile's Start/Sit preview uses the last ssTab chosen on My start/sit. It also has no empty-state copy when it has zero rows. Should the preview always be unfiltered?
- OQ 6: Profile rows don't open the tapped item: Rankings → #mine, Lists → #lists, Start/Sit → the whole My start/sit list. Should they deep-link to the specific ranking, list or post?
- OQ 7: Every open post shows 'Open · closes Sun 1:00 PM' whatever close time was chosen in the composer. The close time is never stored, and user posts never get closed/wk, so they stay open forever. Should each post store and show its real close time and then close?
- OQ 8: The footer shows 'crowd leans <opts[0]>' at 0 votes. On open trades short() gives 'crowd leans A. ' or 'D. ' with a trailing space. With tied tops it names the first tied option. Should 'crowd leans' be hidden at 0 votes and on ties, and should trades read 'Accept'/'Decline'?
- OQ 9: My start/sit always appends ' votes' ('1 votes'), while Community's poll view says '1 vote'. Should this switch to the singular?
- OQ 10: For multi-pick polls only the single highest-% option(s) are highlighted. Should the top N picks be highlighted, as Community's rankd does?
- OQ 11: The Profile and tab-bar avatars show a hard-coded 'D' on the team colour s.myAv. The ink swatch var(--x-t1) makes them white-on-white in dark mode. Should the profile identity be separate from the team avatar?
- OQ 12: The literal #07A852 (Rankings 'Submitted' sub, open Start/Sit sub) stays the same in dark mode, but the README says dark success text is #1ED760. Should these use the tg token?
- OQ 13: The toast auto-dismisses after 1800ms in code, but the README says about 2.2s. Which is correct?
- OQ 14: The initial state is meTab 'lists', but the code's fallback is 'rankings'. Which segment should a first visit open on?
- OQ 15: Returning from the Lists & Rankings file (root back or the Home/Community/Leagues tabs) reloads the main file at League › Match and drops all in-memory state; that file's Profile tab stays inside it. Should back return to Profile on the same segment?
- OQ 16: 'Ask a question' from Profile or My start/sit opens the composer with roster:0, so the league-0 roster is attached by default. Community's '+' sheet uses roster:null. Is attaching by default intended here?
- OQ 17: 'Votes received' = Σ stored n. 'Your calls right' counts only closed start/sit polls with actual points and excludes trades. Are those the intended definitions?
- OQ 18: Closed posts sort by wk, not by close time. User posts have no wk. Should closed posts sort by close time?
- OQ 19: The user's own Community vote is counted in the footer and preview count (tot) but not in the percentages, and not in 'Votes received'. On a 0-vote post it makes every option 'top' with 0% bars. Should your own vote count consistently, or be excluded everywhere?
- OQ 20: The home indicator has no z-index, so it paints beneath the z-4 tab bar: a faint ~#2B2B2C line in light mode, invisible in dark mode. Is it meant to sit above the bar as a visible pill?
- OQ 21: What should a closed poll without results show? A closed start/sit with no actual shows no verdict and no points. A closed trade with no decision crashes (x.decision.toLowerCase()). Is a 'Results pending' or 'No decision recorded' state needed?
- OQ 22: The Home 'My stuff' tile subs ('3 rankings · 2 submitted', '3 lists', '1 open · 3 closed') are static and don't update after posting. Should they be live counts?
- Verification note (not a product question): I checked every critic finding against the source and re-ran ssVals in Node; all of them held and none were dropped. One numeric refinement: the light-mode composite of the white home indicator under rgba(29,29,31,.94) is about #2B2B2C (the critic said about #2B2B2D).

---

## Gap analysis vs the current app

## Gap analysis: Profile (Me), My start/sit, League settings overlay

**Worktree:** `/Users/chrisdaltas/Documents/Hadouken/.claude/worktrees/redesign-v7`, read-only. **Files checked:**
- `src/app/app/(shell)/profile/page.tsx`
- `src/components/profile/{profile-header,profile-stats,profile-list-row,editable-user-avatar}.tsx`
- `src/app/app/(shell)/stats/page.tsx` (redirects to /app/profile)
- `src/app/app/(shell)/start-or-sit/{layout,page,new/page,[questionId]/page}.tsx` (all three pages are `PlaceholderPage` "Coming soon")
- `src/app/app/(shell)/settings/page.tsx` (account settings)
- `src/app/app/(shell)/leagues/[leagueId]/{settings,draft/recap,corrections}/page.tsx`
- `src/components/leagues/{settings-index-ops.ts,settings-panel.tsx,league-shell-ops.ts,my-team-ops.ts,league-message-board.tsx}`
- `src/hooks/use-rename-own-team.ts`, `src/hooks/use-lists.ts`
- `src/components/layout/{bottom-tabs,more-sheet,account-menu}.tsx`
- `src/hooks/use-layout-mode.ts`, `src/stores/theme-store.ts`, `src/app/globals.css` (lines 300–375)
- `src/components/weekly-ranks/weekly-ranks-view.tsx`
- `src/components/players/player-image.tsx`, `src/lib/nfl-team-colors.ts`, `src/components/ui/{tabs,user-avatar,toast}.tsx`, `src/hooks/use-toast.ts`
- `src/lib/feature-flags.ts`, `src/types/database.ts`
- Migrations `001_initial_schema.sql` (start_sit_*, weekly_rankings, RLS), `053_team_franchises.sql`, `063_league_member_management.sql`, `012_ranking_mode.sql`

**Main findings**
1. **Profile mostly needs new layout over data that already exists.** The page is the v7 desktop "My stats" layout. There is no "My stuff" area, no segmented control and no previews.
2. **My start/sit needs a new backend.**
   - The only backend is the unused `start_sit_questions` / `start_sit_votes` tables from migration 001. They hold 2 players, start only: no sit mode, no pick-N, no 3–6 options, no trade type, no roster attachment, no recorded "started"/"decision", and no resolution job.
   - There is no API route, hook or UI, and the surface is behind `featureFlags.startOrSit`, which is off at launch.
3. **The league settings content mostly exists already** as a page with an index and detail sections (`?section=`), not a 13-tile overlay.
   - Draft settings and Stat corrections are fully built in the app, even though the prototype shows a "coming next" toast for them.
   - Co-owners, notification preferences, commissioner note, league history, previous seasons, team avatar colour and player nicknames have no backend.
4. **Dark mode:** CLAUDE.md says single theme with no toggle. But commit `27d455b` in this worktree records "Dark mode is MOBILE ONLY (Chris, 2026-10-15)". It ships `--m-*` light and dark tokens (`globals.css`), `useThemeStore`, which uses the handoff's `fieldscout-theme` localStorage key, and the head script. No UI calls `toggle()`. I've flagged it as a question because CLAUDE.md looks stale. If the ruling stands, the pill only needs new UI on top of what's already built.

### Profile (P0–P5)
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Profile screen (route, scroll-away header, 84px dock pad) | restyle-only | `/app/profile` → `profile/page.tsx`; `/app/stats` redirects there | Page title today is "My stats", with an Edit/View public profile header. Mobile needs the "Profile" 28/600 header inside the scroller. |
| Theme pill (moon/"Dark" ↔ sun/"Light", `fieldscout-theme` key) | out-of-scope-or-question | `stores/theme-store.ts`, `hooks/use-layout-mode.ts`, `globals.css` `html[data-theme='dark']` | Conflicts with CLAUDE.md "single theme". Worktree commit 27d455b says dark is mobile-only, ruled 2026-10-15. Store and tokens exist; no control is bound. |
| Dark-mode token table (§6) | restyle-only (if dark is confirmed) | `globals.css` `--m-t1…--m-bar-a`, light and dark | Already transcribed from the handoff. OQ12: use `--m-tg`, not literal #07A852. |
| 64px avatar | restyle-only | `UserAvatar` (avatar_url, initials fallback) in `profile-header.tsx` | The spec uses the team avatar colour with a hard-coded "D" (OQ11). The app's real profile photo/initials is the correct source. |
| Display name "Dalton" | out-of-scope-or-question | `profiles` has no name column; `profile-header.tsx` docblock | Ruling 2026-08-05: the handle is the only name. Show the handle as the title, or drop the line. |
| "@handle" | restyle-only | `profiles.username` | — |
| "· N leagues" | new-ui-on-existing-data | `hooks/use-leagues.ts` | Behind `featureFlags.leagues` (test cohort). Hide when the flag is off. |
| Stat "Ranking accuracy #312" | needs-new-backend | `profiles.cred_rank`, `weekly_rankings.accuracy_score`, `cred_scores.average_accuracy` columns exist but are never written; `profile-stats.tsx` shows "—" placeholders | Needs a grading job and an accuracy rank. |
| Stat "Followers" | restyle-only | `profiles.follower_count`, already shown | — |
| Stat "Titles" | new-ui-on-existing-data | `leagues.champion_team_id` + `team_managers` | Count leagues where the user managed the champion. Leagues flag-gated. |
| Current Profile content not in spec (Cred score, Scout tier, Following, Cred progress, Accuracy rows, Ranking history card, Edit/View public profile buttons) | out-of-scope-or-question | `profile-stats.tsx`, `RankingHistoryCard` | Cred drives business rule 9. Decide whether these move, collapse or drop on mobile. |
| "My stuff" heading + 3-way segmented control | new-ui-on-existing-data | `ui/tabs.tsx` `Segment` | Default segment question (OQ14). Rankings and Start/Sit segments depend on flags that are off at launch (`weeklyRanks`/`bigBoard`, `startOrSit`). |
| Rankings preview rows (period · pos · scoring; Submitted / Saved / Finalized · top N%) | needs-new-backend | Weekly ranks = `big_board_weekly` list per week (`weekly-ranks-view.tsx`); `weekly_rankings` table unused; no grading cron | A plain "saved weekly boards" list could be built from `big_board_weekly`. Submit, grade and top-% need new backend. Flag-gated. |
| Lists preview rows (n players · Ranked/Tiers/Video · Updated …) | new-ui-on-existing-data | `useLists` (`hooks/use-lists.ts`); `lists.player_count`, `ranking_mode`, `tiers_enabled`, `updated_at`; `list_links` (video) | — |
| Start/Sit preview rows (mode · Open/Closed · N votes) | needs-new-backend | No hook or API; start/sit pages are placeholders | Same data as My start/sit. Preview uses the shared filter (OQ5). |
| P3e empty preview (zero rows) | needs-new-backend | — | Depends on start/sit data. Spec has no empty copy (OQ5). |
| Row taps (Rankings → hub "Mine", Lists → My lists, S/S → My start/sit) | new-ui-on-existing-data | `/app/weekly-ranks`, `/app/lists`, `/app/lists/[listId]` | The app can deep-link to the exact list today (OQ6). |
| Create button "New ranking" | new-ui-on-existing-data | `/app/weekly-ranks` (flag-gated) | No explicit "new ranking" flow; the week board is auto-created. |
| Create button "New list" | new-ui-on-existing-data | `useUIStore.setCreateListOpen`, `/app/lists/new` | — |
| Create button "Ask a question" → composer (S10) | needs-new-backend | `/app/start-or-sit/new` is a placeholder | The composer belongs to another area. Roster attached by default (OQ16). |
| Profile tab bar (Home · Community · Players · Profile, avatar item with ink ring) | new-ui-on-existing-data | `layout/bottom-tabs.tsx` = Home · Lists · Players · Search · More; `more-sheet.tsx` links My stats / My profile / Settings | No Profile or avatar tab. Community is behind `featureFlags.community`. The prototype's Players tab only shows a toast; the app has a real Players page. The IA change needs a ruling. |
| Status bar / notch / home indicator | out-of-scope-or-question | — | Device chrome. The home indicator sits under the bar (OQ20). |

### My start/sit (S0–S9b)
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| "My start/sit" screen | needs-new-backend | `start-or-sit/page.tsx` placeholder; `layout.tsx` redirects when `startOrSit` is off | No "my questions" read (`start_sit_questions` by `poster_id` has an index but no API/hook). |
| Stats: Questions / Votes received | needs-new-backend | `start_sit_questions.vote_count_a/b` (2-option only) | Derivable once there is an API and multi-option support. |
| Stat "Your calls right" | needs-new-backend | — | Needs the user's actual decision (`started`). Nothing stores it. It could come from `team_lineups` if a league roster is attached. |
| Filter chips All / Open / Closed with counts | needs-new-backend | `voting_closes_at`, `resolved_at` exist | Chip UI exists in the design language; needs data. |
| Mode pill "Start/Sit N of M" / "Trade" | needs-new-backend | Schema: `player_a_id`, `player_b_id` only, start-only | Needs a sit mode, pick count and 2–6 options. |
| Status pill "Open · closes …" / "Closed" | needs-new-backend | `voting_closes_at` exists | Show the real close time (OQ7). User posts never close in the prototype. |
| Trade question type (give/get line, Accept/Decline, `decision`) | needs-new-backend | — | No trade question type. A closed trade without `decision` crashes the prototype (OQ21). |
| Result rows (% bars, top highlight colours) | needs-new-backend | — | Percent and own-vote rules (OQ10, 17, 19). |
| 28px headshot with team ring and initials fallback | restyle-only | `players/player-image.tsx` `PlayerAvatarImage`; `lib/nfl-team-colors.ts` `getTeamColors` | Ring styling only. |
| Actual-points line ("18.4 pts · you started him") | needs-new-backend | `player_stats` + `scoring_system_id` exist for points | "you started/sat him" needs a stored decision. Needs a resolution job. |
| Verdict box (crowd right/missed; trade "crowd said …") | needs-new-backend | `start_sit_questions.correct_player` exists, never written; no cron in `api/cron/*` | Needs a resolution job. |
| Footer (N votes · roster attached · crowd leans) | needs-new-backend | — | No roster-attachment column. "1 votes" (OQ9), "crowd leans A. " (OQ8). |
| Own vote leaking into totals | needs-new-backend | `start_sit_votes` (RLS hides votes until resolved) | Pick one consistent rule (OQ19). |
| Empty state "No questions here yet" | needs-new-backend | — | Trivial UI once data exists. |
| Sort (open first, closed by week desc) | needs-new-backend | `season`/`week` columns exist | Sort by close time instead (OQ18). |
| Back → Home | out-of-scope-or-question | — | Should probably return to Profile (OQ3). |
| Plus → composer | needs-new-backend | `/app/start-or-sit/new` placeholder | — |
| Dock shows the league tab bar with nothing highlighted | out-of-scope-or-question | — | Likely a prototype bug (OQ4). |

### League settings overlay (T0–T2)
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| 13-tile 2-col settings grid overlay with close X | out-of-scope-or-question | `leagues/[leagueId]/settings/page.tsx` → `SettingsPanel`; index rows in `settings-index-ops.ts` (Teams & members, Season & playoffs, Scoring, Roster & lineups, Draft, Waivers & trades); reached from league More › League settings | Unreachable in the prototype (OQ1). The app's 6 sections don't map 1:1 to the 13 tiles. Need a ruling on the mobile entry point and the tile set. |
| Title = league name + "League settings" | restyle-only | Real `leagues.name` | The prototype hard-codes the name (OQ2). |
| Tile: My team: team name | new-ui-on-existing-data | `use-rename-own-team.ts` → `POST /api/leagues/[id]/teams/[tid]/name` | — |
| Tile: My team: team avatar colour | needs-new-backend | `teams` has no avatar/colour column | — |
| Tile: My team: player nicknames | needs-new-backend | Nothing stores nicknames | — |
| Tile: General (name, size, roster) | restyle-only | `settings-panel` sections teams / league / roster; real PATCH | — |
| Tile: Draft | restyle-only | Draft section (`draft-config-fields.tsx`, `draft-order-editor.tsx`) | Prototype shows a "coming next" toast; the app has a full form. |
| Tile: Playoffs | restyle-only | Season & playoffs section (`playoff_teams`, `playoff_start_week`); `playoff-bracket*`, `bracket-hand-pick-panel.tsx` | — |
| Tile: Scoring | restyle-only | `scoring-editor.tsx`, `scoring-template-picker.tsx` | — |
| Tile: Notifications | needs-new-backend | Account `NotificationsCard` keeps toggles in local `useState`, not saved; no league notification-prefs table | — |
| Tile: Commissioner note | needs-new-backend | No note field. `leagues.description` and the `league_chat` message board exist | Could reuse `leagues.description`; needs a decision. |
| Tile: Co-owners | needs-new-backend | `team_managers` role CHECK allows only `'manager'` (063); 053 says "co_manager reserved post-v1" | — |
| Tile: Draft results | restyle-only | `/app/leagues/[id]/draft/recap` (`draft-recap-ops.ts`) | — |
| Tile: League legend | new-ui-on-existing-data | — | Static copy, no data needed. Prototype shows a toast. |
| Tile: League history (past champions, all-time stats) | needs-new-backend | Leagues are single-season; only the current `champion_team_id` | No link between seasons. |
| Tile: Previous seasons | needs-new-backend | No season rollover or league lineage | — |
| Tile: Stat corrections | restyle-only | `/app/leagues/[id]/corrections` (`corrections-view.tsx`, `league_stat_corrections`) | Prototype shows a toast; the app has it. |
| Tile → sub-page stacked over settings; "coming next" toast; pressed state | restyle-only | App uses `?section=` URLs (`settingsHref`) | Translate overlay stacking to route or sheet. |
| Account settings (Menu › FieldScout › Settings) | out-of-scope-or-question | `/app/settings` (avatar, password, notifications, scoring, sessions) | Prototype says "Not part of this prototype"; no mobile design given. |

### Shared
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Toast (ink pill, bottom 100px, auto-clear) | restyle-only | `hooks/use-toast.ts` (`TOAST_REMOVE_DELAY` 1,000,000 ms), `ui/toast.tsx`, `ui/toaster.tsx` | Duration: 1800 ms vs about 2.2 s (OQ13). |
| Home "My stuff" tiles (live counts) | new-ui-on-existing-data | Lists count via `useLists`; ranking and S/S counts depend on the rows above | Static in the prototype (OQ22). |
