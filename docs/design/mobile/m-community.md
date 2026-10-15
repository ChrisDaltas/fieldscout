## Community feed, topic pills, detail pages

Source: `design_handoff_fieldscout_mobile/FieldScout Mobile.dc.html`.

- **Markup:**
  - Community screen: lines 147–231.
  - `hasPage` (league Menu sub-pages): lines 891–957.
  - `hasCmDetail` (list detail): lines 958–980.
  - Status bar: lines 39–42.
  - Dock and tab bar: lines 639–644.
  - Create sheet: lines 646–662.
  - Toast: line 1117.
- **Logic:**
  - `cmVals()`: lines 1508–1623.
  - `CMFEED` / `RSLOT` / `postRoster` / `CMTOPICS`: lines 1341–1364.
  - Global search `gsVals()`: lines 1472–1485.
  - `pg` builder: lines 1786–1807.
  - Create options: lines 1817–1818.
  - Tab bar: line 1857.
  - `toast()`: line 1624.
- **Headshot component:** `FSHeadshot.dc.html`.

### 0. Conventions used below

- **Tokens.** Every colour written `var(--x-NAME, #fallback)` in the source is only defined under `.fs-dark` (line 19). In light mode the inline fallback is the rendered value. Some tokens have **different light fallbacks on different elements**, so the exact fallback is given per element:
  - `b2`: `#F2F2F4` on most uses, but `#EDEDF0` on vote-bar tracks.
  - `b3`: `#EBEBEE` on dividers, but `#E5E5EA` on disabled buttons, rings and the Following pill.
  - `b4`: `#C7C7CC` on checkbox rings and `#D1D1D6` on the sheet handle (README value `#D1D1D6`).
  - Notation: `t3 #6E6E73` means `var(--x-t3,#6E6E73)`. Dark values are in §6.
- **Global base CSS** (lines 14–23):
  - `*{box-sizing:border-box}`. This governs every padded box below: search field, pills, cards, chips.
  - `input::placeholder{color:#6E6E73}` (not tokenised).
  - `a{color:#0088FF}`.
  - `.fsm-scroll::-webkit-scrollbar{display:none}`.
  - **Dock spacer:** `.fsm-scroll[style*="overflow-y"]::after{content:"";display:block;flex:none;height:var(--x-dockpad,0px)}`.
    - `--x-dockpad` is 84px under `.dock-sm` and 150px under `.dock-lg`.
    - The phone root gets `dock-lg` when `scr === "league" && !prof && !trade && !settings`, otherwise `dock-sm` (line 1858).
    - So on Community **every** vertical scroller (feed, Create sheet, detail) gets an 84px blank block at its end.
- **Font.** Inter Display (`'InterDisplay'`), `font-feature-settings:'tnum' 1,'cv11' 1`, antialiased. Line-height is `normal` unless stated.
- **Icons.** Inline SVG, `viewBox 0 0 16 16`, `fill:none; stroke:currentColor`, round caps (and round joins where noted). The path `d` is quoted where it matters.
- **FSHeadshot** (`FSHeadshot.dc.html`), used everywhere a player appears:
  - **Root:** circle of `size` px, `flex:none`, `overflow:hidden`, background `#EEEEF1`. It carries `title="{player}"`, a native tooltip with the full name.
  - **Ring:** `box-shadow: 0 0 0 1px #fff, 0 0 0 (1+rw)px <team colour>`, where `rw = 2` if size ≥ 32, else `1.5`. With no team colour: `inset 0 0 0 1px rgba(0,0,0,.04)`.
  - **Photo:** `<img alt="{player}">`, absolute inset 0, `object-fit:cover; object-position:50% 15%; transform:scale(1.25) translateY(8%)`. On image load error (`onError` → `state.failed = src`) it falls back to initials.
  - **Fallback initials:** `#6E6E73`, weight 700, font-size `max(9, round(size×0.36))` px.
    - Sizes used here: 24 → 9px, 26 → 9px, 32 → 12px, 34 → 12px, 36 → 13px, 40 → 14px, 44 → 16px, 64 → 23px.
  - **Initials rule:**
    1. Strip a trailing `" D/ST"`.
    2. Split on `/[\s'-]+/`.
    3. Take the first character of the **first** part plus the first character of the **last** part (when there is more than one part), uppercased.
    - Examples: "Steelers D/ST" → "S"; "A.J. Brown" → "AB"; "Puka Nacua" → "PN".
  - **Team colours (TC):** e.g. ARI `#97233F`, ATL `#A71930`, BAL `#241773`, BUF `#00338D`, CHI `#0B162A`, CLE `#FF3C00`, DEN `#FB4F14`, IND `#002C5F`, KC `#E31837`, LAR `#003594`, MIN `#4F2683`, NE `#002244`, NYJ `#125740`, PHI `#004C54`, PIT `#FFB612`, SF `#AA0000`.
  - **Photos exist only for:** Bijan Robinson, A.J. Brown, Alvin Kamara, James Conner, Shedeur Sanders, Jameson Williams, Isiah Pacheco, Evan Engram, Darnell Mooney, Braelon Allen, Cole Kmet, Adonai Mitchell, Jaylen Wright, Jahan Dotson, Justice Hill, Sean Tucker, Jaydon Blue, Roschon Johnson, Charlie Kolar (`assets/headshots/<last>.jpg`). Everyone else renders initials.
- **Name formats.**
  - `short(n)` = first initial + ". " + rest, e.g. "DK Metcalf" → "D. Metcalf". Names whose first word contains "." (e.g. "A.J. Brown") and names ending "D/ST" are unchanged.
  - Player `meta` = `"<POS> · <TEAM>"`, with DST shown as "D/ST".
  - Projection `proj` = the player's `proj` field, or a seeded 5.0–13.0 value when missing. Always shown with 1 decimal.

---

### 1. Screens & states in this area

| # | Screen / state | Exact condition |
|---|---|---|
| A | Community screen | `state.scr === "community"` (`isCommunity`) |
| A1 | Header, default (logo + Search + Create) | `!state.cmSearch` (`cmSearchClosed`) |
| A2 | Header, inline search open | `state.cmSearch === true` (`cmSearchOpen`) |
| A3 | "Updated by people you follow" block | `(cmTab ∈ {all, following, rank}) && !cmTopic && !q && some non-closed rank item has an upd string AND its author is followed`. `q` = `cmQuery.toLowerCase().trim()`, so a query of only spaces counts as empty. Defaults: `cmFollow = {"@shahranks": true}`, so r1 and r5 qualify. |
| A4 | **Shelves mode** (For you landing) | `cmTab === "all" && !cmTopic && !q` (`cmShelves`). Three shelves: "Start or sit · Week 5" carousel, "Rankings this week" rows, "Lists for you" masonry. A whitespace-only query keeps shelves mode and applies no filter, while the input still shows the spaces. |
| A5 | **Grouped mode** | `!cmShelves`: any tab other than For you, or any topic, or a non-empty trimmed query. |
| A5a | Section headings ("Start or sit", "Rankings", "Lists") | Grouped mode AND `cmTab ∈ {all, following}` (`cmMixed`), only for sections that have items |
| A5b | Rankings filter rows (type × position × scoring) | `cmTab === "rank"` (`cmRkFilters`). Shown even when results are empty. |
| A6 | Empty state, Following | `filtered.length === 0 && cmTab === "following" && !q && !cmTopic`. **Unreachable in this prototype** (see note below the table). |
| A7 | Empty state, no match | `filtered.length === 0` otherwise |
| A8 | Blank results, no message (quirk) | `cmTab === "rank"` and the type/pos/scoring chips exclude every ranking. `cmEmpty` uses the list **before** rank filtering, so no empty message renders. Examples: Pre-draft + QB, or K, or D/ST. |
| P | Poll card, start/sit (`isSS`) | `item.qtype !== "trade"` |
| P1 | Start/sit, not voted, 0 picked | `!Array.isArray(cmVotes[id])` and `cmSel[id]` empty. Hint "Pick N". Vote button disabled. |
| P2 | Start/sit, partly picked | `0 < sel.length < N`. Hint "k of N picked", e.g. "1 of 2 picked". Vote disabled. |
| P3 | Start/sit, ready | `sel.length === N`. Hint "N of N picked" ("1 of 1 picked", "2 of 2 picked", "3 of 3 picked"). Vote button enabled (blue). |
| P4 | Start/sit, voted | `Array.isArray(cmVotes[id])`. Shows bars, percentages, a blue check on your picks and the footer "N votes · you voted". Checkboxes, hint and Vote button are hidden. |
| P5 | Trade poll, not voted | `qtype === "trade"` and not voted. Gives/Gets panels plus Accept/Decline buttons, no percentages. |
| P6 | Trade poll, voted | Bars, percentages, 2px blue ring on your choice, footer |
| P7 | "Roster attached" collapsed / expanded | `item.roster` exists; open when `cmRosterOpen[id] === true`. Seed polls p2 and p3 have **no** roster. |
| L | List card cover variants | All seed lists use the **collage** variant (L3). User-created lists can produce L3 (no videos, or players present without a YouTube id) or L1 (any video, since every composer video carries a `yt` id). **L2 is unreachable in this file**: it needs videos without `yt` and no players, and neither seed nor composer data produces that. |
| L1 | YouTube thumbnail cover (110px tall) | Any `videos[i].yt` id exists |
| L2 | Video placeholder cover | No yt, `videos.length > 0` and `players.length === 0` (unreachable here) |
| L3 | Collage cover | No yt and (no videos, or players > 0). A user list with 0 players and 0 videos renders L3 with no heads: a plain colour block. |
| L4 | "N video(s)" badge | `videos.length > 0` |
| U | User-created post in feed | Item in `state.cmMine` (prepended by `post()`, line 1571); details in §3 and §5 |
| S | Create sheet | `state.sheet === "create"` |
| D | **Community detail page** (list) | `state.cmOpen` is set AND matches a non-closed item in `[...cmMine, ...CMFEED]` (`hasCmDetail`). It does **not** check `scr`: the overlay stays on top of whatever screen until closed. |
| D1 | Detail: Follow button | `item.by !== "@dalton"` (your own posts hide it) |
| D2 | Detail: description | `item.desc` non-empty |
| D3 | Detail: Videos shelf | `item.videos.length > 0` |
| D4 | Detail, ranking variant (code path only) | `item.type === "rank"`. No UI in this file sets `cmOpen` to a ranking (ranking taps navigate to the Rankings file), so it is unreachable. Spec below for completeness. |
| G | **League sub-page overlay** (`hasPage`) | `state.page` truthy. Also independent of `scr`. |
| G1 | My team | `page === "myteam"` |
| G2 | Settings rows: League settings / Scoring / Playoffs | `page ∈ {"general","scoring","playoffs"}`. The playoffs note block shows only for `"playoffs"`. |
| G3 | Draft results | `page === "draft"` |
| G4 | League history | `page === "history"` |
| G5 | Previous seasons | `page === "seasons"` |
| T | Toast | `state.toast` non-empty; cleared after **1800 ms** (README says ~2.2s; code says 1800) |

Closed polls (p6, p7, p8; `closed: true`) are excluded from every Community view. They appear only in My start/sit, and in global-search results (see §4).

**A6 reachability.**
- `cmFollow` is only written by the detail page's Follow button (line 1520).
- Detail is reachable only for lists.
- @shahranks has no list, so it can never be unfollowed. The Following tab therefore always contains r1 and r5, and A6 ("Follow people to see…" / "Browse For you") cannot appear in the prototype. It only matters in the product.

---

### 2. Layout, top to bottom

#### 2.1 Frame (Community)

- **Phone:** 390×844, radius 48, `overflow:hidden`, background `b0 #fff`, flex column. Inside a 410×864 bezel (padding 10, radius 58, `ink #1D1D1F`).
- **Status bar** (lines 39–42):
  - `flex:none`, height 50, flex, `align-items:center`, `justify-content:space-between`, padding `6px 32px 0 40px`, 16px/600.
  - **No background of its own:** it is transparent over the phone root's `b0`.
  - Left: "9:41".
  - Centre notch: absolute, left 50%, top 11, `translateX(-50%)`, 120×34, radius 999, `#000`.
  - Right: flex, gap 6.
    - Signal icon 18×12: four `rx 1` bars at x 0/5/10/15 with heights 4/7/9.5/12, fill `t1`.
    - Battery 25×12: outline rect 21×11 `rx 3.5` at 40% opacity; fill rect 16×8 `rx 2`; cap 1.5×4 at 40%. All `t1`.
- **Community scroll container:** `flex:1; min-height:0; overflow-y:auto; padding:0 16px 24px`, hidden scrollbar.
  - `::after` adds an extra 84px block (`--x-dockpad` from `.dock-sm`). Total trailing space below the last item is 84 + 24 = 108px.
  - **Header, tabs and topic pills are inside the scroller and scroll away with the feed.** Nothing is sticky.
- **Bottom tab bar:**
  - `flex:none; position:relative; z-index:4`, height 80, **padding `6px 8px 0`**, flex.
  - `margin-top:-80px` (`barMt`), so it overlays the bottom of the scroller and content scrolls behind it.
  - Background `rgba(29,29,31,.94)` (`--x-barA`).
- **Home indicator** (line 644):
  - `position:absolute; left:50%; bottom:8px; transform:translateX(-50%)`, 134×5, radius 999, background `b0 #fff`, **no z-index**.
  - The tab bar (`position:relative; z-index:4`) paints on top of it. In light mode the white pill shows only through the bar's 6% transparency (≈`#2B2B2C`), the same colour as the bar over the white page, so it is **effectively invisible**. In dark mode it is fully invisible.
  - Overlays (sheet backdrop z 20, page z 25, detail z 26) cover it too. Do not build it as a visible white pill.

#### 2.2 Header, default (A1)

Row height 48, flex, `justify-content:space-between`, `align-items:center`.

- **Left (tappable):** flex, gap 8.
  - Logo tile 28×28, radius 8, `#07D066`, containing `assets/fieldscout-logomark.svg` at 15×15.
  - Wordmark "FieldScout", 19px/700, letter-spacing -0.03em, `t1`.
- **Right:** flex, gap 4.
  - **Search button:** 38×38 circle, transparent.
    - Pressed (`:active`) background `b2 #F2F2F4`.
    - Icon 20×20: `circle cx7 cy7 r4.8` + `M10.6 10.6L14 14`, stroke-width 1.6, colour `t1 #1D1D1F`.
  - **Create button** (`title="Create"`): 34×34 circle, `#0088FF` (pressed `#0074DB`).
    - Icon 15×15, `M8 3v10M3 8h10`, stroke-width 2.4, white.

#### 2.3 Header, search open (A2)

Replaces the 2.2 row: height 48, flex, center, gap 10.

- **Field:** flex 1, min-width 0, height 38, padding 0 12, radius 12, `b2 #F2F2F4`, flex, center, gap 8.
  - Icon 15×15 (same magnifier), stroke 1.8, `t4 #8E8E93`.
  - `<input autofocus>`:
    - Placeholder "Lists, rankings, people or players".
    - 15px/500, `t1`, `font-family:inherit`. No border, outline or background; flex 1, min-width 0.
    - Placeholder colour `#6E6E73` (global `input::placeholder`, not tokenised).
- **"Cancel":** 15px/500, `#0088FF`, flex none.

#### 2.4 Tabs row

- Container: horizontal scroll (hidden bar), flex, gap 18, `margin:2px -16px 0; padding:0 16px` (bleeds to the screen edge), `border-bottom:1px solid b3 #EBEBEE`.
- Tabs, in order: **"For you"** (`all`), **"Following"**, **"Start or sit"** (`poll`), **"Rankings"** (`rank`), **"Lists"** (`list`).
- Each tab: `flex:none`, height 38, flex, center, 14px/600, nowrap.
  - Active: text `t1 #1D1D1F` plus a 2px underline as `box-shadow: inset 0 -2px 0 ink #1D1D1F`. The underline is the width of the label, inside the tab, sitting on the 1px row border.
  - Inactive: `t3 #6E6E73`, shadow colour `transparent`.
- No transition.

#### 2.5 Topic pills row (`CMTOPICS`)

- Container: horizontal scroll, flex, gap 6, `margin:10px -16px 0; padding:0 16px`.
- Order: "Sleeper picks", "Waiver stashes", **"Puka Nacua"** (player), **"Injuries"** (trend), **"George Kittle"** (player), "Rookies", "Trade targets", **"DK Metcalf"** (player).
- Pill: `flex:none`, height 32, radius 999, flex, center, gap 6, 13px/600, nowrap.
  - Padding `0 12px 0 12px`; player pills use `0 12px 0 4px`.
  - Off: text `t1 #1D1D1F` on `b2 #F2F2F4`. On: `#fff` on `ink #1D1D1F`.
- Player pills: a 24px FSHeadshot before the label. These players have no photos, so they render initials:
  - "PN" with ring `0 0 0 1px #fff, 0 0 0 2.5px #003594`
  - "GK" with `#AA0000`
  - "DM" with `#FFB612`
- Trend pill ("Injuries"): 12×12 icon before the label, path `M2.5 11.5l4-4 3 3 4-5M10 5.5h3.5V9`, stroke 2, round caps and joins, `currentColor` (follows the pill text colour).

#### 2.6 "Updated by people you follow" (A3)

- Block: `margin-top:16px`, flex column, gap 8.
- Label: "Updated by people you follow", 13px/600, `t3 #6E6E73`.
- Each row (tappable): flex, `align-items:center`, gap 10, padding 10px 12px, radius 14, `b1 #F5F5F7`.
  - **Avatar:** relative, 34×34 circle, background = author colour. Initial = handle character 2 uppercased ("S"), 13px/600, white.
  - **Unread dot:** 10×10 circle `#0088FF`, absolute top -1 right -1, `box-shadow:0 0 0 2px b1 #F5F5F7` (a ring the colour of the card).
    - The dot is **static and always shown**: no read state exists, and tapping the row navigates away without clearing it.
  - **Text column:** flex 1, min-width 0, column, gap 1, both lines nowrap + ellipsis.
    - Line 1: `"{by} · {title}"`, 13px/600, e.g. "@shahranks · Week 5 · RB · PPR".
    - Line 2: `"{upd} · {moves}"`, 11px/500, `t3`, e.g. "Updated 40m ago · 4 changes · C. Hubbard ▲4, J. Conner ▼3".
  - **Chevron:** 11×11, `M6 3l5 5-5 5`, stroke 2, round joins, `t5 #AEAEB2`, flex none.
- Seed rows, in feed order:
  1. "@shahranks · Week 5 · RB · PPR" / "Updated 40m ago · 4 changes · C. Hubbard ▲4, J. Conner ▼3"
  2. "@shahranks · Week 5 · WR · PPR" / "Updated 1h ago · 2 changes · K. Shakir ▲5"

#### 2.7 Shelves mode (A4), after 2.6

**Shelf 1: Start or sit carousel**

- Header: flex, `align-items:baseline`, space-between, `margin:22px 0 10px`. Always renders.
  - Title "Start or sit · Week 5", 18px/700, letter-spacing -0.02em, nowrap.
  - "See all", 13px/600, `#0088FF`.
- Carousel: horizontal scroll, flex, gap 10, `margin:0 -16px; padding:0 16px`, no scroll snap. **`align-items` is the default `stretch`.**
- Cards: **286px** wide (`flex:none; box-sizing:border-box`); anatomy in 2.8.
- **Equal-height cards:** every card stretches to the height of the tallest card in the row, with its content top-aligned.
  - With seed data p1 (5 options + roster header) is ≈475px tall, p3 ≈460, p2 ≈380, p5 ≈345 and p4 (trade) ≈325–330.
  - So p4 shows ≈150px of empty `b1` space under its Accept/Decline row, and p5 ≈130px.
  - Expanding any card's roster adds 14×28 + 8 = 400px to that card. It becomes the tallest, so **every card in the carousel grows to that height**.

**Shelf 2: Rankings this week** (renders when any ranking exists; always true in seed data)

- Header `margin:22px 0 6px`: "Rankings this week", 18px/700, -0.02em, plus "See all" (13px/600, `#0088FF`).
- Rows in a flex column; anatomy in 2.10.
- Includes **all** six rankings (ROS and Pre-draft too).

**Shelf 3: Lists for you**

- Header `margin:22px 0 10px`: "Lists for you", 18px/700, -0.02em, plus "See all". Always renders.
- Masonry (2.11).

#### 2.8 Poll card anatomy (carousel and grouped)

- Card: padding 14, radius 18, `b1 #F5F5F7`, flex column, gap 10. Width 286px in the carousel (stretched in height, see 2.7), 100% in grouped mode (natural height).
- Children, in this order:

1. **Author row:** flex, center, gap 8.
   - Avatar 26×26 circle, background = author colour, initial (handle char 2 uppercased) 10px/600 white.
   - Name span (flex 1, min-width 0, nowrap, ellipsis): `"{by} "` at 12px/600, then `"· {time}"` at 500 `t3`. Example: "@jordan · 25m".
   - Right meta: `flex:none`, 10px/600, `t3`, nowrap, e.g. "Half PPR", "Standard · Week 5".
2. **Mode + title:** flex column, gap 6.
   - Mode pill: `align-self:flex-start`, height 22, padding 0 9, radius 999, 11px/700, white, nowrap.
     - "Start N of M" on `#07B85A`.
     - "Sit N of M" on `#FF0028`.
     - "Trade" on `#0088FF`.
   - Title: 15px/600, line-height 1.3, `text-wrap:pretty`.
3. **Roster attached** (if `roster`):
   - Box: radius 12, `b0 #fff`, `overflow:hidden`.
   - Header row (tappable): height 36, padding 0 10, flex, center, gap 8.
     - Icon 13×13, `M3 3.5h10v9H3zM3 6.5h10M6 3.5v9`, stroke 1.7, `t3`.
     - Text (flex 1, ellipsis): "Roster attached" at 12px/600, then `" · {label}"` at 500 `t3`.
     - Chevron 10×10, `M4 6l4 4 4-4`, stroke 2.4, `t4 #8E8E93`. `transform: rotate(180deg)` when open, `none` when closed; no transition.
   - Expanded list: flex column, padding 0 10 8. Each row:
     - Height 28, flex, center, gap 8, `border-top:1px solid b2 #F2F2F4`.
     - Slot: 34px wide, 10px/600, `t3`.
     - Name (flex 1, ellipsis): **full name**, 12px.
       - Players named in the question (options ∪ give ∪ get): weight 700, `#0088FF`.
       - Others: weight 500, `t1`.
     - Right: position (10px/600, position text colour) + " " + team (500 `t3`), e.g. "RB KC".
4. **Trade block** (if `qtype === "trade"`):
   - **Sides:** `display:grid; grid-template-columns:1fr 1fr; gap:6px`. Grid items stretch, so the 1-player "Gives" box is as tall as the 2-player "Gets" box (content top-aligned).
     - Each side: padding 8, radius 12, `b0 #fff`, flex column, gap 6, min-width 0.
     - Label "Gives" or "Gets": 10px/600, `t3`.
     - Player rows: flex, center, gap 6, min-width 0.
       - FSHeadshot 26.
       - Column (flex 1, min-width 0):
         - Short name: 12px/600, nowrap + ellipsis.
         - Meta: **9.5px**/500, `t3`, e.g. "WR · PHI". It is `white-space:nowrap` with **no overflow/ellipsis**, so a long meta overflows the box rather than truncating.
   - **Vote buttons:** grid of 2 columns, gap 6. Each button:
     - Height 40, radius 12, `b0 #fff`, flex, centred, gap 6, `position:relative; overflow:hidden`.
     - Ring: 1px inset `b3 #E5E5EA`; 2px inset `#0088FF` on your choice after voting.
     - Bar: absolute left/top/bottom, width 0 → pct, `transition: width .25s linear`.
     - Label "Accept" / "Decline", 13px/600.
       - Before voting: Accept `tg #067A3E`, Decline `tr #C8001C`.
       - After voting: `t1`.
     - After voting, a pct span follows the label, 13px/700.
5. **Start/sit options** (if not trade): flex column, gap 4. Each option:
   - min-height 46, flex, center, gap 10, padding `6px 10px 6px 8px`, radius 12, `b0 #fff`, `position:relative; overflow:hidden`.
   - Ring: `inset 0 0 0 2px #0088FF` only when selected and not yet voted; otherwise `none`.
   - Bar: absolute left/top/bottom, width 0 → pct, `transition: width .25s linear`.
   - **Checkbox** (only before voting):
     - 20×20, radius 6.
     - Selected: `#0088FF`, no ring.
     - Unselected: `b0 #fff` with `inset 0 0 0 1.5px b4 #C7C7CC`.
     - Contains a 10×10 check `M3 8.5l3.2 3L13 4.5`, stroke 3, white. It is always rendered, so it is invisible on white when unselected.
   - FSHeadshot 32.
   - Text column (flex 1, min-width 0, gap 1):
     - Short name: 13px/600, ellipsis.
     - `"{meta} · Proj {proj}"`: 10px/500, `t3`, ellipsis, e.g. "WR · PIT · Proj 13.0".
   - After voting, right side: flex, gap 5, 14px/700, pct colour. If it is your pick, a 12×12 check (`M3 8.5l3.2 3L13 4.5`, stroke 2.6, `#0088FF`) comes before the pct.
6. **Hint + Vote row** (start/sit, not voted): flex, center, gap 10.
   - Hint: flex 1, 11px/500, `t3`. "Pick N" when nothing is picked, otherwise "k of N picked" (including "N of N picked" when ready).
   - **Vote** button: height 32, padding 0 16, radius 999, 13px/600.
     - Enabled: `#0088FF` with white text.
     - Disabled: `b3 #E5E5EA` with `t3 #6E6E73` text.
7. **Footer** (voted, both kinds): 11px/500, `t3`, `"{total.toLocaleString()} vote(s) · you voted"`, e.g. "1,241 votes · you voted" or "1 vote · you voted".

#### 2.9 Grouped mode (A5), after 2.6 if shown

Order is fixed: polls, then rank filter rows, then rankings, then lists, then the empty state. Feed interleaving is ignored.

- **Polls:**
  - With `cmMixed`, heading "Start or sit" (15px/600, `margin:20px 0 10px`).
  - Stack: flex column, gap 10, `margin-top:12px`. Cards are 100% wide with natural height (2.8).
- **Rank filter rows** (Rankings tab): flex column, gap 6, `margin-top:12px`. Three rows; each is a horizontal scroller, flex, gap 6, `margin:0 -16px; padding:0 16px`.
  - Chip: `flex:none`, height 30, padding 0 12, radius 999, 12px/600, nowrap.
    - Off: `t1` on `b2 #F2F2F4`. On: `#fff` on `ink #1D1D1F`.
  - Row 1 (type): "All types" · "Weekly" · "Rest of season" · "Pre-draft"
  - Row 2 (pos): "All positions" · "QB" · "RB" · "WR" · "TE" · "K" · "D/ST"
  - Row 3 (scoring): "Any scoring" · "PPR" · "Standard"
- **Rankings:**
  - With `cmMixed`, heading "Rankings" (15px/600, `margin:20px 0 10px`).
  - List: flex column, `margin-top:8px`; rows as in 2.10.
- **Lists:**
  - With `cmMixed`, heading "Lists".
  - Wrapper `margin-top:12px`, then masonry (2.11).
- The scroller is a block container, so heading and section margins collapse to max(10, x): 12px above polls and lists, 10px above rankings.

#### 2.10 Ranking row

- Row: flex, center, gap 12, padding 8px 0, no divider.
- Tile: 60×60, radius 10, `overflow:hidden`, background = author colour. Contains a centred FSHeadshot 40 of `players[0]` with that player's team ring.
- Text column (flex 1, min-width 0, column, gap 2; all lines nowrap + ellipsis):
  - Title, 14px/600, e.g. "Week 5 · RB · PPR".
  - `"{by} · {meta}"`, 12px/500, `t3`, e.g. "@shahranks · 12k follows".
  - Top line, 11px/500, `t3`.
    - The source joins the top three entries with **two** spaces (`join("  ")`, line 1537). The span is `white-space:nowrap`, which collapses runs of whitespace, so it **renders with a single space**: "1. B. Robinson 2. J. Taylor 3. K. Williams".
    - Build it with one space to match.
- Chevron: 12×12, `M6 3l5 5-5 5`, stroke 2, `t5 #AEAEB2`.

#### 2.11 List card (masonry)

- **Container:** `column-count:2; column-gap:10px`.
  - This is CSS multi-column: cards flow **down column 1, then column 2**, and the browser balances heights.
  - Column width is (358−10)/2 = 174px.
  - With seed data, column 1 ≈ l1, l2, l3 and column 2 ≈ l4, l5 (estimate from heights).
- **Card:** `break-inside:avoid; margin-bottom:14px`, flex column, gap 6.
- **Cover:**
  - `position:relative`, height `coverH`, radius 14, `overflow:hidden`, background `coverBg`.
  - Height for non-YouTube covers: `["150px","180px","205px"][floor(seeded(id)()*3)]`.
    - Seed values: l1 150, l2 180, l3 205, l4 205, l5 150.
    - User lists have id `"u"+Date.now()`, so their height is effectively random among the three.
    - YouTube thumbnail covers are 110px.
  - Background:
    - Collage: author colour (or the list's `color` for user lists).
    - YouTube thumbnail or video placeholder: `ink #1D1D1F`.
  - **Collage:** absolute inset 0, centred grid `repeat(2,44px)`, gap 6, of up to 4 FSHeadshot 44 (`players[0..3]`).
    - With 3 players the third sits bottom-left.
    - With 0 players the cover is a plain colour block.
  - **YouTube cover:** full-bleed `url(https://i.ytimg.com/vi/<id>/hqdefault.jpg)`, `center/cover no-repeat`, ink base.
  - **Video placeholder:** absolute inset 0, padding 10, flex column, content at the bottom (`justify-content:flex-end`), video title 12px/600, line-height 1.25, white.
  - **Video badge** (absolute top 8, left 8):
    - Height 20, padding 0 7, radius 999, gap 4, `rgba(0,0,0,.6)`.
    - Text 10px/600, white: "1 video" or "N videos".
    - Icon: 10×10 play triangle, filled, `M4.5 2.8v10.4L13 8z`.
- **Title:** 13px/600, line-height 1.25, `text-wrap:pretty` (wraps, no clamp).
- **Byline:** flex, center, gap 5, 11px/500, `t3`.
  - Avatar 16×16 circle, author colour, initial 8px/600 white.
  - Text (nowrap + ellipsis): `"{by} · {N} players"`.

#### 2.12 Empty state (A6/A7)

- Block: padding 48px 16px, flex column, centred, gap 10, text-align centre.
- Message: 14px/500, line-height 1.4, `t3`, `text-wrap:pretty`.
- Action link: 14px/600, `#0088FF`.
- Copy:
  - **A6 (Following, nothing followed; unreachable here):** "Follow people to see their lists, rankings and start/sit questions here" / "Browse For you".
  - **A7 with a topic:** "Nothing matches {topic}", e.g. "Nothing matches Puka Nacua" / "Clear filters". The topic wins if a query is also set.
  - **A7 with a query only:** "Nothing matches your search" / "Clear filters".

#### 2.13 Create sheet (S)

- **Backdrop:** absolute inset 0 (covers the status bar and the tab bar), z 20, `rgba(0,0,0,.32)` (README says .4; code says .32), flex, `align-items:flex-end`.
- **Sheet:**
  - Width 100%, max-height 86%, flex column, radius 24 24 0 0, `b0 #fff`, padding 8px 0 30px.
  - Handle row: `flex:none`, padding 2px 0 8px, centred. Handle 36×5, radius 999, `b4 #D1D1D6`.
  - Title row: `flex:none`, padding 4px 16px 12px 20px. "Create" at 19px/600, -0.02em. No sub-line and no close button (the × shows only for the "leagues" sheet).
- **Options scroller:** `.fsm-scroll`, `flex:1; min-height:0; overflow-y:auto`. Because it matches the global dock-spacer rule, **an 84px blank `::after` block sits under the three rows** on Community. This is on top of the list's 6px bottom padding and the sheet's 30px bottom padding.
  - Total sheet height ≈ 380px: 8 + ≈15 handle row + ≈39 title row + ≈200 options + 84 spacer + 30.
- **Options:** padding 0 12 6, flex column, gap 2. Each row:
  - min-height 64, flex, center, gap 12, padding 8, radius 14; pressed `b2 #F2F2F4`.
  - Icon tile: 44×44, radius 12, with a 20px white icon (stroke 1.6, round caps and joins).
  - Text column: flex 1, min-width 0, column, **gap 2**.
    - Label: 15px/600.
    - Sub-line: 12px/500, `t3`, **`text-wrap:pretty`**. The sub-lines wrap to 2 lines at this width, making rows ≈65px.
  - Chevron 12, `M6 3l5 5-5 5`, stroke 2, `t5`.
- Rows:
  1. "Start or sit" — "Ask who to start, or whether to take a trade". Tile `#07B85A`; icon `M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5`.
  2. "Ranking" — "Rank players for a week, rest of season or the draft". Tile `#0088FF`; icon `ICON.rank` = `M4 13V8M8 13V3M12 13V6`.
  3. "List" — "Group players for research, targets or stashes". Tile `t1 #1D1D1F`; icon `ICON.lists` = `M3 4h10M3 8h10M3 12h6`.

#### 2.14 Community detail page (D)

- **Overlay:** absolute, left/right 0, top 50, bottom 0, **z 26**, `b0`, flex column.
- One scroller: `padding-bottom:32px` plus the 84px `::after`.
- There is no fixed header. The back button lives on the cover and scrolls away with it.

1. **Cover:**
   - `position:relative`, height 230, full width, `overflow:hidden`, background = cover colour (2.11 rules).
   - Collage: absolute inset 0, centred grid `repeat(2,64px)`, gap 8, of up to 4 FSHeadshot 64.
   - A YouTube thumbnail variant (L1) uses the 2.11 background rules.
   - **Back button:** absolute top 10, left 12, 36×36 circle, `rgba(0,0,0,.35)`. White chevron 18×18, `M10 3L5 8l5 5`, stroke 2.
2. **Info block:** padding 16, flex column, gap 12.
   - Kind pill: `align-self:flex-start`, height 20, padding 0 8, radius 999, 10px/600, white.
     - "List" on `ink #1D1D1F`.
     - Ranking variant: "Ranking · PPR" or "Ranking · Standard" on `#0088FF`.
   - Title: 24px/700, -0.02em, line-height 1.15, `text-wrap:pretty`.
   - Author row: flex, center, gap 8.
     - Avatar 26 circle with initial (10px/600).
     - Text (flex 1, ellipsis): `"{by} "` at 13px/600, then `"· {meta}"` at 500 `t3`, e.g. "@fieldfilm · 1.2k follows". Your own posts show "Just now".
     - **Follow pill:** height 30, padding 0 14, radius 999, 12px/600.
       - "Follow": `#fff` on `#0088FF`.
       - "Following": `t2 #3A3A3C` on `b3 #E5E5EA`.
   - Description: 14px/500, line-height 1.45, `t2 #3A3A3C`, `text-wrap:pretty`.
   - Action row: flex, gap 8. Two pills, each height 36, padding 0 14, radius 999, gap 6, 13px/600, `b2 #F2F2F4`:
     - **Save:** icon 14×14 bookmark `M4 2.5h8v11L8 10.5l-4 3z`, stroke 1.6, round joins.
       - Unsaved: fill none, text "Save", `t1`.
       - Saved: fill `currentColor`, text "Saved", `#0088FF`.
     - **Share:** icon 14×14 `M8 2.5v8M5 5.5l3-3 3 3M3.5 9v4h9V9`, stroke 1.6, text "Share", `t1`.
3. **Videos** (D3):
   - Heading "Videos", 16px/600, padding 6px 16px 8px.
   - Horizontal scroller: gap 10, padding 0 16px 8px.
   - Card: 220 wide, flex column, gap 6.
     - Thumbnail: 220×124, radius 12, `ink #1D1D1F`; the YouTube image if a yt id exists.
     - Centred play badge: 40×28, radius 8, `#FF0028`, white filled triangle 12×12.
     - Duration chip: absolute bottom 6, right 6, height 18, padding 0 5, radius 4, `rgba(0,0,0,.75)`, 10px/600 white, e.g. "14:02". Only when `d` is set.
     - Title: 12px/600, line-height 1.3. Composer videos are titled "YouTube video".
     - "YouTube": 11px/500, `t3`.
4. **Players heading:** padding 12px 16px 4px, 16px/600.
   - Lists: `"Players · {N}"`. Rankings: `"Ranked players · {N}"`.
   - A 0-player user list shows "Players · 0" with no rows.
5. **Player rows:** container padding 0 16. Each row:
   - flex, center, gap 10, padding 8px 0, `border-bottom:1px solid b2 #F2F2F4`.
   - Number: 20px wide, 13px/600, `t3` ("1", "2", …).
   - FSHeadshot 36.
   - Column (flex 1, min-width 0, gap 1):
     - **Full name**: 14px/600, ellipsis.
     - Meta: 11px/600, position text colour, e.g. "RB · ATL".
   - Ranking only: move 12px/600, "+4" in `#07A852` or "-3" in `#FF0028`.
   - Projection: 13px/600, `t1`, e.g. "6.8".

#### 2.15 League sub-page overlay (G, `hasPage`)

- **Overlay:** absolute, left/right 0, top 50, bottom 0, **z 25**, `b0`, flex column.
- **Header:**
  - `flex:none`, height 52, flex, center, gap 8, padding 0 12, `border-bottom:1px solid b3 #EBEBEE`.
  - Back: 36×36 circle; pressed `b2 #F2F2F4`. Chevron 18×18, `M10 3L5 8l5 5`, stroke 2, `#0088FF`.
  - Title: flex 1, centred, 16px/600.
  - Right spacer: 36px, so the title is centred.
- **Scroller:** `padding-bottom:32px` plus `::after`. The spacer is 150px when opened from a league screen (`.dock-lg`; always the case via the Menu), 84px otherwise.

**G1 "My team"**

- Body: padding 24px 16px, flex column, gap 24.
- **Avatar block:** column, centred, gap 12.
  - Circle 96×96, background = draft colour, initial 36px/600 white. The initial is the first character of the trimmed draft name, **uppercased**, or "T".
  - "Upload photo" pill: height 32, padding 0 14, radius 999, 13px/600, `#0088FF` text on `gb #E6F2FF`.
- **"Avatar color" block:** flex column, **gap 8**.
  - Label: 13px/600, `t3`.
  - Swatch row: flex wrap, gap 10. Swatches are 36×36 circles: `#0088FF`, `t1 #1D1D1F`, `#07A852`, `#F75252`, `#9D70E9`, `#ECAD48`, `#00A6A3`, `#E5508A`.
  - Selected ring: `0 0 0 2px b0 #fff, 0 0 0 4px <swatch>`.
- **"Team name" block:** flex column, **gap 8**.
  - Label: 13px/600, `t3`.
  - Input: height 48, padding 0 14, radius 12, `b2 #F2F2F4`, 16px/600, `t1`, `border:0; outline:0; font-family:inherit`, `maxlength=24`.
  - Counter: `"{len} / 24"`, 11px/500, `t3`. It counts the **untrimmed** length (default "15 / 24").
- **Save:** height 48, full width, radius 999, centred, 15px/600.
  - Enabled: `#0088FF` with white text.
  - Disabled: `b3 #E5E5EA` with `t3` text.

**G2 Settings rows** (League settings / Scoring / Playoffs)

- Body: padding 8px 16px, flex column, gap 18.
- Section: flex column. Title: padding 10px 0 4px, 13px/600, `t3`.
- Row: min-height 44, flex, center, gap 12, `border-bottom:1px solid b2 #F2F2F4`. Label 14px/500 (flex 1); value 14px/600, right-aligned.
- Playoffs note: padding 12, radius 12, `b1 #F5F5F7`, 12px/500, line-height 1.45, `t2 #3A3A3C`.
- Footer on all three pages: "Only the commissioner can change these settings", 11px/500, `t3`, centred.

**G3 Draft results**

- **Round chips:** scroller, padding 12px 16px 8px, gap 6.
  - Chip: `flex:none`, height 32, padding 0 14, radius 999, 12px/600, nowrap.
  - On: white on `ink`. Off: `t1` on `b2 #F2F2F4`.
  - Labels: "Round 1" … "Round 6".
- **Picks:** container padding 0 16. Each row:
  - flex, center, gap 10, padding 8px 0, `border-bottom:1px solid b2 #F2F2F4`, background `transparent`.
  - Pick number: 36px wide, 12px/600, `t3`, e.g. "1.06".
  - FSHeadshot 34.
  - Column (flex 1, min-width 0, gap 1):
    - Full name: 14px/600, ellipsis.
    - Meta: 11px/600, position text colour.
  - Owner: `flex:none`, max-width 120, 12px, nowrap + ellipsis.
    - Your team: weight 600, `#0088FF`.
    - Others: weight 500, `t3`.
- **Round 6** renders an empty list with **no empty-state copy** (just blank under the chips).

**G4 League history**

- **Season chips:** same style as G3, padding 12px 16px 4px. Labels "All-time", "2025", "2024", "2023".
- **KPI grid:** padding 12px 16px 0, `repeat(2,minmax(0,1fr))`, gap 8.
  - Card: padding 12, radius 14, `b1 #F5F5F7`, column, gap 3.
  - Label: 11px/600, `t3`. Value: 20px/700, -0.02em. Sub-line: 11px/500, `t3`.
- **"Head to head" heading:** 15px/600, padding 22px 16px 6px.
- **Table:** container padding 0 16. Grid columns `minmax(0,1fr) 46px 58px 58px`, gap 8.
  - Header row: padding 6px 0, `border-bottom:1px solid b3 #EBEBEE`, 10px/600, `t3`. Columns "Opponent" | "W-L" | "PF" | "PA"; the last three are right-aligned.
  - Body rows: `align-items:center`, min-height 46, `border-bottom:1px solid b2 #F2F2F4`.
    - Opponent cell: flex, gap 8, min-width 0.
      - 26px team-colour circle with the team initial (`name[0]`, 10px/600 white).
      - Then a column: team name (13px/600, ellipsis) over manager handle (10px/500, `t3`).
    - W-L: 13px/600, right-aligned.
    - PF: 12px/500, right-aligned.
    - PA: 12px/500, `t3`, right-aligned.

**G5 Previous seasons**

- Body: padding 8px 16px, flex column. Each row (tappable):
  - flex, center, gap 12, padding 12px 0, `border-bottom:1px solid b2 #F2F2F4`.
  - Year: 52px wide, 17px/700, -0.02em.
  - Column (flex 1, min-width 0, gap 2):
    - "Champion · {champ}": 13px/600, ellipsis.
    - "You finished {finish} · {rec}": 12px/500, `t3`.
  - Chevron: 12, `t5 #AEAEB2`.

#### 2.16 Toast

- Position: absolute, horizontally centred, bottom 100, **z 30**.
- Pill: height 36, padding 0 16, radius 999, `ink #1D1D1F`, white 13px/500, nowrap.

---

### 3. Interactions

| Element | Effect |
|---|---|
| Logo + "FieldScout" | `scr = "home"`, `sheet = null`. |
| Search icon | `cmSearch = true`. The header swaps to the search field and the input autofocuses. |
| Search input | Every keystroke sets `cmQuery` (raw string). Filtering is live. The query `q = cmQuery.toLowerCase().trim()` is matched as a substring of title + handle + desc + tags + (players or opts). A whitespace-only query is treated as empty (shelves mode stays, no filter, updated-by block stays). Trade polls match only on "Accept"/"Decline" among their options; give/get names are not searched (titles still are). A non-empty trimmed query switches to grouped mode. |
| "Cancel" | `cmSearch = false`, `cmQuery = ""`. Tab and topic are kept. |
| Create (+) | Opens the Create sheet (`sheet = "create"`). |
| Create › "Start or sit" | Closes the sheet and opens the composer: `cmp = {kind:"poll", qtype:"ss", q:"", mode:"start", pickN:1, opts:[null,null,null], give:[null], get:[null], roster:null, scoring:"PPR", close:"kickoff"}`. Composer is z 27, separate area. |
| Create › "Ranking" | Navigates to `FieldScout Mobile Lists and Rankings.dc.html#new-ranking` (in the product, the new-ranking flow). |
| Create › "List" | Closes the sheet and opens the composer: `{kind:"list", step:1, name:"", desc:"", pub:true, players:[], videos:[], link:"", color:"#0088FF"}`. |
| Composer Post / Save (feed effect) | `post(item)` prepends `{id:"u"+Date.now(), by:"@dalton", av:myAv, time:"now", mine:true, tags:[], ...item}` to `cmMine`. It sets `cmp = null`, `pick = null`, `cmTab = "all"`, `cmTopic = null`, `cmQuery = ""`, `cmSearch = false`, then toasts "Posted to Community". `scr` is unchanged. The new item is the first carousel card (poll) or the first masonry card (list). |
| Sheet backdrop | `sheet = null`. Taps on the sheet body stop propagation. |
| Tab | `cmTab = value`. Topic, query, rank filters and search state persist. Scroll position is **not** reset. |
| Topic pill | Single-select toggle: `cmTopic = on ? null : label`. Matches items whose `tags` include the label, or whose players/options include it. Combines with tab and query (AND). |
| "See all" (×3) | `cmTab = "poll"`, `"rank"` or `"list"`. |
| Updated-by row | Navigates to `Lists and Rankings.dc.html#view-<id>` (that author's ranking view). Does not clear the unread dot. |
| Ranking row | Same navigation to `#view-<id>`. |
| Rank filter chip | `cmRk[row] = value`. One per row; reselecting "All …" resets that row. ANDed across rows; persists across tabs. |
| "Roster attached" header | Toggles `cmRosterOpen[id]`. Chevron flips instantly. In the carousel this also resizes every card (2.7). |
| Start/sit option (before voting) | Toggles the option in `cmSel[id]`. If the new selection exceeds N, the **oldest** picks are dropped (`nx.slice(nx.length − N)`). With N=1, tapping another option replaces the pick. After voting, taps do nothing. |
| "Vote" | Only when `sel.length === N`: `cmVotes[id] = sel` (array of option indices). Otherwise nothing, with no toast. Votes are final; there is no undo. |
| Accept / Decline (trade) | Votes **immediately** on tap if not yet voted: `cmVotes[id] = [i]`. After voting, no-op. |
| Vote result animation | Bars go from width 0% to the percentage, `transition: width .25s linear`. Percentage text and checks appear with no animation. |
| List card | `cmOpen = id` opens detail (D). |
| Empty-state link | `cmQuery = ""`, `cmTab = "all"`, `cmTopic = null`. Does not close search or reset rank filters. |
| Detail back | `cmOpen = null`. |
| Detail Follow / Following | Toggles `cmFollow[handle]`. It changes which items appear in the Following tab (every non-closed item by that handle), and the label on any detail by the same author. The updated-by block also reads `cmFollow`, but only @shahranks' rankings carry an `upd` string, and @shahranks can't be toggled from any reachable UI. **In this file Follow never changes the updated-by block.** |
| Detail Save / Saved | Toggles `cmSaved[id]`. Not shown anywhere else in this file. |
| Detail Share | Toast "Link copied". |
| Detail video card | Toast "Opens in YouTube". |
| Detail player rows | Not interactive. |
| Tab bar › Home / Community / Profile | `scr = home` / `community` / `me`, plus `sheet = null`. Re-tapping Community resets nothing. |
| Tab bar › Players | Toast "Not part of this prototype". |
| Toast (any) | `toast(t)` clears any pending timer first. A new toast replaces the current text immediately and restarts the 1800ms timer. |
| Page back | `page = null`. Returns to the league screen beneath; the Menu sheet stays closed. Discards any unsaved G1 draft. |
| G1 "Upload photo" | Toast "Photo upload: not part of this prototype". |
| G1 swatch | Sets `draftAv`. |
| G1 name input | Sets `draftName` (raw, untrimmed). |
| G1 Save: enabling | Enabled only when `dirty = name.trim() !== "" && (name !== myName \|\| colour !== myAv)`. Untrimmed name is compared, so adding only a leading or trailing space enables Save. |
| G1 Save: effect | Writes `TEAMS[0].name = name.trim()`, `TEAMS[0].av = colour`, `TEAMS[0].ini = name.trim()[0]` (**not uppercased**), `LEAGUES[0].team = name.trim()`, `myName`, `myAv`. Then closes the page and toasts "Team updated". A whitespace-only edit saves the same name and still toasts. The edit always targets **league 0's** team, whichever league is selected (League settings › League name shows `LEAGUES[lg].name`). The new colour also recolours the Profile tab avatar. |
| G3 round chip | `draftRd = r`. |
| G4 season chip | `histYr = value`. |
| G5 row | Toast "{year} season: opens the archived league". |
| Pressed states | Only the Search button (`b2`), Create (`#0074DB`), page back (`b2`) and create-sheet rows (`b2`) have them. |

There are no swipes, drags or long-presses in this area. The tabs, pills, carousel, filter rows, chip rows and videos shelf are native horizontal scrollers with hidden scrollbars and no snap.

---

### 4. Navigation

**How users reach Community**
- Non-league tab bar "Community".
- League Menu sheet › "FieldScout" grid › "Community".
- Global search (`gsVals`, line 1478):
  - **Person result** from the feed: `scr = community`, `cmTab = all`, `cmQuery = <handle>`, `cmSearch = true`. `cmTopic` is **not** cleared, so an active topic still ANDs with the handle.
  - **Poll result:** `scr = community`, `cmTab = poll` only. `cmTopic`, `cmQuery` and `cmSearch` are **not** cleared, so an active topic or query still filters the landing view.
  - **List result:** `scr = community`, `cmOpen = id` (feed state underneath unchanged).
  - **Ranking result:** the Rankings file `#view-<id>`.
  - Post results do **not** filter `closed`. p6 "WR2 for Sunday?", p7 "Conner for Mooney. Do I take it?" and p8 "Which RB sits this week?" can appear; tapping one lands on Community › Start or sit, where it is not shown.
- Jump panel #2 (outside the phone).
- State persists across visits: tab, topic, query, follows, votes, picks, saved items, roster-open, rank filters and posted items.

**Dock on Community**
- Non-league tab bar. Container padding `6px 8px 0`, background `barA`.
- Tab items: flex 1, height 48, flex column, centred, gap 3. Icons 22×22 at stroke 1.5, round caps and joins. Labels 10px/600.
- Order and icons:
  1. Home: `ICON.home` = `M2.5 7.5L8 3l5.5 4.5V13h-11z`.
  2. Community: star `M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z`.
  3. Players: `ICON.players` = `M5.5 6.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5`.
  4. Profile.
- **Community is highlighted** (`#fff`); the other tabs are `#A1A1A6`.
- Profile is a 22×22 avatar circle.
  - Background `s.myAv` (default `#0088FF`; changes when G1 Save sets a new colour). Initial is the literal "D", 10px/600 white.
  - Ring `0 0 0 2px ink, 0 0 0 3.5px b0` only when on Profile.
- No league switcher.

**Detail (D)**
- Opened from a list card (or a global-search list result).
- It covers everything below the status bar, including the tab bar and home indicator (z 26 > tab bar z 4), so **no dock shows**.
- Back returns to the feed in its previous state.

**Rankings**
- Ranking rows and updated-by rows leave this file for the Rankings view (other spec section).

**League pages (G)**
- Reached from the league tab bar "Menu" sheet:
  - The "My team" card ("My team · edit name and avatar") opens G1 and seeds `draftName = myName`, `draftAv = myAv`.
    - The card's initial is `myName[0]` (**not uppercased**), unlike the G1 avatar.
  - Menu rows open the other pages: "League settings" (sub "12 teams") → general, "Scoring" ("Standard"), "Playoffs" ("Weeks 15–17"), "Draft results" ("Aug 30") → draft, "League history" ("Since 2023"), "Previous seasons" ("3").
  - Rows without a page show the toast "{label}: screen coming next": Notifications, Co-owners ("None"), Commissioner note, Stat corrections.
- The `settingsTiles` overlay (z 23) can also set `page`, but nothing in the markup calls `openSettings`, so it is unreachable.
- The page covers the league switcher and tab bar.

**Z-order** (all absolute inside the phone, top 50 unless noted):
1. Home indicator: absolute, no z-index (painted under the tab bar)
2. Tab bar: z 4
3. Sheets (incl. Create): z 20, inset 0
4. Team view: 21
5. Player profile: 22
6. Settings / Trade detail: 23
7. Trade builder: 24
8. **League page: 25**
9. **Community detail: 26**
10. Composer: 27
11. Player picker: 28
12. Global search: 29
13. Toast / column tip: 30

Neither `hasPage` nor `hasCmDetail` is cleared by tab-bar or jump navigation. The product should make them routes.

---

### 5. Data shown

**Feed set**
- `[...cmMine (newest first), ...CMFEED]` with `closed` items removed.
- Filter: tab (`all`; `following` = author followed; otherwise `type` equals the tab) AND topic AND trimmed query. On the Rankings tab, rank filters also apply.
- Within each section, feed order is preserved.

**Seed polls** (feed order: p4, p5, p1, p2, p3; avatar initial = handle char 2 uppercased)

- **p4 (trade):** "@jordan" `#5C7CE5` "J" · "25m" · "Half PPR".
  - Title: "Offered A.J. Brown for Taylor + Odunze. Do I take it?"
  - Roster: "@jordan's team · 12-team half PPR" (li 1).
  - Gives: A.J. Brown (WR · PHI, photo). Gets: J. Taylor (RB · IND), R. Odunze (WR · CHI).
  - Votes: Accept 64 / Decline 36 of 932.
- **p5:** "@dalton" `#0088FF` "D" · "1h" · "Standard · Week 5" · "Start 1 of 3".
  - Title: "FLEX spot: who starts?"
  - Roster: "Touchdown Tacos · 12-team standard" (li 0).
  - Options: I. Pacheco (RB · KC · Proj 9.9) 46, R. Stevenson (RB · NE · 8.1) 33, T. Allgeier (RB · ATL · 6.8) 21. n = 58.
- **p1:** "@kelly" `#9D70E9` "K" · "12m" · "PPR · Week 5" · "Start 2 of 5".
  - Title: "Two WR spots, five guys. Who starts?"
  - Roster: "@kelly's team · 12-team PPR" (li 1).
  - Options: D. Metcalf (WR · PIT · 13.0) 62, C. Sutton (WR · DEN · 6.4) 35, G. Wilson (WR · NYJ · 11.1) 71, Z. Flowers (WR · BAL · 10.2) 18, R. Odunze (WR · CHI · 10.2) 14. n = 1240.
- **p2:** "@tightendtom" `#00A6A3` "T" · "2h" · "Half PPR · Week 5" · "Sit 1 of 4". **No roster attached.**
  - Title: "Kittle's out. Which TE do I bench?"
  - Options: D. Kincaid (TE · BUF · 7.6) 34, E. Engram (TE · DEN · 8.2) 41, T. Warren (TE · IND · 8.9) 9, T. Kelce (TE · KC · 11.7) 16. n = 860.
- **p3:** "@mom" `#ECAD48` "M" · "6h" · "Standard · Week 5" · "Start 3 of 6". **No roster attached.**
  - Title: "RB, RB, FLEX. Help a mom out."
  - Options: R. Stevenson (RB · NE · 8.1) 48, C. Hubbard (RB · CAR · 7.9) 79, J. Williams (WR · DET · 11.4) 72, K. Shakir (WR · BUF · 9.8) 31, T. Allgeier (RB · ATL · 6.8) 30, Z. Flowers (WR · BAL · 10.2) 40. n = 412.

**Vote maths**
- After voting, `total = n + 1`.
- `pct_i = round((pct_i/100 × n + (you picked i ? 1 : 0)) / total × 100)`. Before voting, `total = n`. If `total` is 0, every pct is 0.
- Start/sit percentages are per-player (they do not sum to 100).
- "Top" options:
  - **Start/sit:** the N highest percentages (ties broken by order).
    - Top options get the tint bar (start: `gg #E3F9EC`; sit: `gr #FFE9EC`) and an ink percentage (start: `tg #067A3E`; sit: `tr #C8001C`).
    - Other options: `b2 #EDEDF0` bar and `t3` percentage.
  - **Trade:** the option(s) equal to the maximum. Accept gets green tint and green text; Decline gets red. Otherwise `#EDEDF0` / `t3`.
    - The top highlight is independent of your vote. Example: voting Decline on p4 gives Accept 64% green-tinted, Decline 36% with the blue ring, "933 votes · you voted".
- Worked examples:
  - p5 voting Pacheco → 47% / 32% / 21%, "59 votes · you voted".
  - p1 voting Metcalf + Wilson → 62 / 35 / 71 / 18 / 14, "1,241 votes · you voted".
- User-created polls start at `n = 0`. After your vote they read 100% (green top) / 0% and "1 vote · you voted".

**Roster attached**
- `postRoster(li)`: li 0 = your league lineup plus bench (static `MINE` + `BENCH_ME`); any other li = the opponent's (`THEIRS` + `BENCH_THEM`).
- Slots follow `RSLOT` = QB, RB, RB, WR, WR, TE, FLEX, K, D/ST; the rest are "BN". 14 rows total.
- li 0:
  - QB Shedeur Sanders CLE, RB Bijan Robinson ATL, RB James Conner ARI, WR A.J. Brown PHI, WR Jameson Williams DET, TE Evan Engram DEN, FLEX Isiah Pacheco (RB KC), K Jake Bates DET, D/ST Steelers D/ST PIT.
  - BN: Kendrick Bourne WR ARI, Tyler Allgeier RB ATL, Jahan Dotson WR PHI, Rhamondre Stevenson RB NE, Dalton Kincaid TE BUF.
- li 1:
  - QB Josh Allen BUF, RB Alvin Kamara NO, RB Jaylen Wright MIA, WR Darnell Mooney ATL, WR Adonai Mitchell IND, TE Cole Kmet CHI, FLEX Braelon Allen (RB NYJ), K Brandon Aubrey DAL, D/ST Ravens D/ST BAL.
  - BN: Jordan Mason RB MIN, Khalil Shakir WR BUF, Rome Odunze WR CHI, Tyler Warren TE IND, Justin Fields QB NYJ.
- Highlights:
  - p5: Pacheco, Allgeier, Stevenson.
  - p1: Rome Odunze only.
  - p4: Rome Odunze only (A.J. Brown and J. Taylor are not on the li 1 roster; see open questions).
- **User posts:**
  - Label = `LEAGUES[i].team + " · " + LEAGUES[i].sub`: "Touchdown Tacos · 12-team standard" (i 0) or "Dalton's Dynasty · 10-team standard" (i 1). League 0's team name follows a G1 rename.
  - Attaching league 1 still expands to the opponent roster above (Josh Allen … Justin Fields, Gridiron Gurus).
  - li 0 uses the static MINE/BENCH_ME, not the live `s.slots`/`s.bench`, so lineup swaps are not reflected.

**Seed rankings**

Every ranking's lead tile shows `players[0]` with its team ring. "Top line" is the rendered text (single spaces).

| id | Author | Colour | Meta | Title | Lead player (ring) | Top line | Extra |
|---|---|---|---|---|---|---|---|
| r1 | @shahranks | `#0088FF` | "12k follows" | "Week 5 · RB · PPR" | Bijan Robinson, photo (ATL `#A71930`) | "1. B. Robinson 2. J. Taylor 3. K. Williams" | Update text and moves |
| r2 | @ortizff | `#F75252` | "8.4k follows" | "Rest of season · WR · PPR" | Puka Nacua "PN" (LAR `#003594`) | "1. P. Nacua 2. A.J. Brown 3. G. Wilson" | |
| r3 | @halefantasy | `#ECAD48` | "3.2k follows" | "Week 5 · QB · Standard" | Josh Allen "JA" (BUF `#00338D`) | "1. J. Allen 2. J. Hurts 3. B. Mayfield" | |
| r4 | @kellyscouts | `#5C7CE5` | "2.1k follows" | "Pre-draft · TE · PPR" | Travis Kelce "TK" (KC `#E31837`) | "1. T. Kelce 2. T. Warren 3. G. Kittle" | |
| r5 | @shahranks | `#0088FF` | "12k follows" | "Week 5 · WR · PPR" | A.J. Brown, photo (PHI `#004C54`) | "1. A.J. Brown 2. P. Nacua 3. G. Wilson" | Update text |
| r6 | @bellball | `#07A852` | "640 follows" | "Rest of season · RB · Standard" | Jonathan Taylor "JT" (IND `#002C5F`) | "1. J. Taylor 2. B. Robinson 3. K. Williams" | |

Filter fields: `rk.type` ∈ {w5, ros, pre}, `rk.pos`, `rk.scoring` ∈ {PPR, Standard}.

**Seed lists**

| id | Author | Colour | Meta (detail) | Title | Players | Videos | Cover |
|---|---|---|---|---|---|---|---|
| l1 | @fieldfilm | `#07A852` | "1.2k follows" | "Backs one injury away from 15 touches" | 5 | 1 | 150px |
| l2 | @kellyscouts | `#5C7CE5` | "2.1k follows" | "Buy-low WRs after Week 4" | 6 | 0 | 180px |
| l3 | @waiverwire | `ink` | "3.3k follows" | "Week 5 waiver stashes" | 5 | 2 | 205px |
| l4 | @tightendtom | `#00A6A3` | "480 follows" | "TE tiers after the Kittle injury" | 5 | 0 | 205px |
| l5 | @rookieroom | `#E5508A` | "920 follows" | "Rookies trending up" | 3 | 1 | 150px |

- **Descriptions:**
  - l1: "Handcuffs worth a bench spot right now. Ordered by how much the role grows if the starter goes down."
  - l2: "Targets are there, the points haven't caught up yet."
  - l3: "Add before Wednesday. FAAB suggestions in the video."
  - l4: "Kittle to IR reshuffles the middle tier."
  - l5 has no description (the block is hidden).
- **Videos:**
  - l1: "Handcuff rankings for Week 5", 14:02.
  - l3: "Week 5 waiver wire: 8 adds before it's too late" 18:45; "FAAB bids explained" 6:10.
  - l5: "Rookie report, Week 5", 9:30.
  - No seed video has a YouTube id, so detail thumbnails are plain `ink` with the red play badge.
- **Collage heads** (`players[0..3]`; initials unless noted; ring = team colour):
  - l1: TA (ATL `#A71930`), JM (MIN `#4F2683`), Justice Hill photo (BAL `#241773`), RS (NE `#002244`).
  - l2: GW (NYJ `#125740`), DM (PIT `#FFB612`), CS (DEN `#FB4F14`), ZF (BAL `#241773`).
  - l3: KB (ARI `#97233F`), TW (IND `#002C5F`), Jahan Dotson photo (PHI `#004C54`), KS (BUF `#00338D`).
  - l4: TK (KC `#E31837`), TW (IND `#002C5F`), DK (BUF `#00338D`), Evan Engram photo (DEN `#FB4F14`).
  - l5 (3 heads; third bottom-left): TW (IND `#002C5F`), Shedeur Sanders photo (CLE `#FF3C00`), RO (CHI `#0B162A`).
- **Detail rows** (full name, meta, proj):
  - l1: Tyler Allgeier RB · ATL 6.8; Jordan Mason RB · MIN 9.1; Justice Hill RB · BAL 7.0; Rhamondre Stevenson RB · NE 8.1; Isiah Pacheco RB · KC 9.9.
  - l2: Garrett Wilson WR · NYJ 11.1; DK Metcalf WR · PIT 13.0; Courtland Sutton WR · DEN 6.4; Zay Flowers WR · BAL 10.2; Rome Odunze WR · CHI 10.2; Khalil Shakir WR · BUF 9.8.
  - l3: Kendrick Bourne WR · ARI 5.1; Tyler Warren TE · IND 8.9; Jahan Dotson WR · PHI 4.2; Khalil Shakir WR · BUF 9.8; Justin Fields QB · NYJ 14.6.
  - l4: Travis Kelce TE · KC 11.7; Tyler Warren TE · IND 8.9; Dalton Kincaid TE · BUF 7.6; Evan Engram TE · DEN 8.2; George Kittle TE · SF 10.0.
  - l5: Tyler Warren TE · IND 8.9; Shedeur Sanders QB · CLE 19.7; Rome Odunze WR · CHI 10.2.

**User-created posts** (`cmMine`)
- Common fields: by "@dalton", initial "D", avatar colour = `myAv` at post time, time "now", `mine: true`, no tags (topic pills never match them unless a player/option name matches).
- **Poll:**
  - Meta `"{scoring} · Week 5"` (scoring ∈ Standard / Half PPR / PPR).
  - Default titles (when the question is blank): "Who should I start?", "Who should I sit?", "Should I accept this trade?".
- **List:**
  - Meta "Public" or "Private". Meta isn't shown on the card, and the detail shows "Just now" instead.
  - **Private lists still appear in the public feed** (no filter).
  - Cover colour = the composer swatch (`#0088FF`, `t1`, `#07A852`, `#9D70E9`, `#F75252`).
  - A list with 0 players can be saved (only the name is required). It gets a plain colour-block cover, the byline "@dalton · 0 players" and the detail heading "Players · 0" with no rows.

**Follow behaviour in practice**
- Only list authors can be followed in this file (detail is list-only).
- Following an author adds all their non-closed items to the Following tab:
  - @kellyscouts → r4 + l2
  - @tightendtom → p2 + l4
  - @fieldfilm → l1
  - @waiverwire → l3
  - @rookieroom → l5
- When Following shows several kinds, the "Start or sit" / "Rankings" / "Lists" headings appear.

**Topic results on "For you"**

| Topic | Items |
|---|---|
| Sleeper picks | r3, l1, l3, p3, l5 |
| Waiver stashes | l1, l3 |
| Puka Nacua | r2, r5 |
| Injuries | r1, p2, l4 |
| George Kittle | r4, p2, l4 |
| Rookies | r4, l3, l5 |
| Trade targets | p4, p1, l2 |
| DK Metcalf | r2, r5, p1, l2 |

- Following (default) = r1, r5. That tab shows the updated-by block **and** the same two rows under "Rankings".
- Empty combinations, for example:
  - Following + Sleeper picks / Waiver stashes / George Kittle / Rookies / Trade targets
  - Start or sit + Waiver stashes / Puka / Rookies
  - Rankings + Waiver stashes / Trade targets
  - Lists + Puka

**Formats**
- Counts: `toLocaleString`, e.g. "1,241".
- Percentages: integer + "%".
- Projections: 1 decimal.
- Moves:
  - Detail: "+4" / "-3".
  - Updated-by rows: "▲4" / "▼3" (U+25B2/U+25BC, absolute value, preceded by a space), at most 2 names joined by ", ", even when the text says "4 changes".
- "N players"; "1 video" / "N videos".
- Relative times are given strings ("25m", "1h", "now").
- "Week 5" is hard-coded as the current week.
- Position text colours: QB `#E03E3E`, RB `#4A68D4`, WR `#8656D8`, TE `#C98A1F`, K `#5E8C8C`, D/ST `#A68A00`.

**League pages data (G)**

- **general:**
  - League: League name = `LEAGUES[lg].name` (default "Sunday Funday League"); Teams "12"; Commissioner "@marcus"; Season "2026".
  - Roster: Starters "QB, 2 RB, 2 WR, TE, FLEX, K, D/ST"; Bench "6"; IR "1".
  - Waivers & trades: Waiver type "FAAB · $200 budget"; Waivers process "Wed 12:00 AM"; Trade review "Commissioner · 1 day"; Trade deadline "Week 11".
- **scoring:**
  - Passing: Passing yards "1 pt per 25"; Passing TD "4"; Interception "−2"; 2-pt conversion "2".
  - Rushing & receiving: Rushing yards "1 pt per 10"; Receiving yards "1 pt per 10"; Reception "0"; Rushing or receiving TD "6"; Fumble lost "−2".
  - Kicking: FG 0–39 yds "3"; FG 40–49 yds "4"; FG 50+ yds "5"; Extra point "1".
  - Defense: Sack "1"; Interception "2"; Fumble recovery "2"; Defensive TD "6"; 0 points allowed "10".
  - Negative values use the U+2212 minus sign.
- **playoffs:**
  - Format: Playoff teams "6"; Weeks "15, 16, 17"; First-round byes "Top 2 seeds"; Seeding "Record, then points for".
  - Other: Consolation bracket "On"; Reseed each round "Off"; Tiebreaker "Bench points".
  - Note: "The playoff bracket shows at the top of the League tab once the playoffs start in Week 15."
- **draft:**
  - Pool: 49 unique players from MINE, THEIRS, LEAD, EXTRA, BENCH_ME, BENCH_THEM and TREND, shuffled with `seeded("draft")`, 12 per round.
  - Pick label `"{round}.{2-digit}"`.
  - Owner = `ownerOf(name, state)`. This reads the live `s.slots`/`s.bench`, so roster swaps change owners; otherwise it is a seeded team. Names come from `TEAMS[ti].name`, so they follow a G1 rename.
  - Rows show name · meta · owner; TT = Touchdown Tacos (your team, blue 600), GG = Gridiron Gurus.
  - **Round 1:** 1.01 Jaydon Blue RB · DAL (Priya's Punters); 1.02 Alvin Kamara RB · NO (GG); 1.03 Puka Nacua WR · LAR (End Zone Elite); 1.04 DK Metcalf WR · PIT (Blitz Brigade); 1.05 Baker Mayfield QB · TB (Leo's Lions); 1.06 Jameson Williams WR · DET (TT); 1.07 Charlie Kolar TE · LAC (End Zone Elite); 1.08 Braelon Allen RB · NYJ (GG); 1.09 James Conner RB · ARI (TT); 1.10 Chuba Hubbard RB · CAR (Maya's Mavericks); 1.11 Harrison Butker K · KC (Hail Marys); 1.12 Evan Engram TE · DEN (TT).
  - **Round 2:** 2.01 Khalil Shakir (GG); 2.02 Adonai Mitchell (GG); 2.03 Eagles D/ST (Blitz Brigade); 2.04 Rome Odunze (GG); 2.05 Justice Hill (Fourth & Long); 2.06 Josh Allen (GG); 2.07 Roschon Johnson (GG); 2.08 Cole Kmet (GG); 2.09 Kendrick Bourne (TT); 2.10 Brock Purdy (End Zone Elite); 2.11 Jalen Hurts (Fourth & Long); 2.12 Jonathan Taylor (Blitz Brigade).
  - **Round 3:** 3.01 A.J. Brown (TT); 3.02 Jahan Dotson (TT); 3.03 Jake Bates (TT); 3.04 Tyler Allgeier (TT); 3.05 George Kittle (GG); 3.06 Shedeur Sanders (TT); 3.07 Dak Prescott (Hail Marys); 3.08 Bijan Robinson (TT); 3.09 Courtland Sutton (Hail Marys); 3.10 Darnell Mooney (GG); 3.11 Travis Kelce (End Zone Elite); 3.12 Garrett Wilson (Priya's Punters).
  - **Round 4:** 4.01 Zay Flowers (GG); 4.02 Justin Fields (GG); 4.03 Isiah Pacheco (TT); 4.04 Dalton Kincaid (TT); 4.05 Tyler Warren (GG); 4.06 Jordan Mason (GG); 4.07 Sean Tucker (End Zone Elite); 4.08 Rhamondre Stevenson (TT); 4.09 Jaylen Wright (GG); 4.10 Brandon Aubrey (GG); 4.11 Kyren Williams (Maya's Mavericks); 4.12 Ravens D/ST (GG).
  - **Round 5:** 5.01 Steelers D/ST D/ST · PIT (TT) only.
  - **Round 6:** empty, no copy.
- **history:**
  - KPIs: Record sub-line is "3 seasons" for All-time, else "{year} season".

    | Season | Record | Start/sit accuracy | Points for | Points against |
    |---|---|---|---|---|
    | All-time | "26-20" ("3 seasons") | "66%" ("Optimal lineup choices") | "5323.5" ("115.7 per game") | "5075.3" ("110.3 per game") |
    | 2025 | "10-6" ("2025 season") | "71%" | "1893.6" ("118.3 per game") | "1798.2" ("112.4 per game") |
    | 2024 | "11-6" | "67%" | "1976.6" ("116.3 per game") | "1801.7" ("106.0 per game") |
    | 2023 | "5-8" | "62%" | "1453.3" ("111.8 per game") | "1475.5" ("113.5 per game") |

  - Head to head lists the 11 other teams in league order.
    - Avatar colours: Gridiron Gurus `ink`, Priya's Punters `#9D70E9`, End Zone Elite `#F75252`, Sam's Sleepers `#ECAD48`, Blitz Brigade `#5C7CE5`, Leo's Lions `#07A852`, Hail Marys `#FF8A00`, Fourth & Long `t2 #3A3A3C`, Red Zone Rebels `#00A6A3`, Maya's Mavericks `#E5508A`, Raj's Rushers `t3 #6E6E73`.
  - **All-time H2H** (W-L, PF, PA):

    | Team | Manager | W-L | PF | PA |
    |---|---|---|---|---|
    | Gridiron Gurus | @marcus | 3-2 | 630.5 | 621.8 |
    | Priya's Punters | @priya | 2-2 | 479.3 | 456.3 |
    | End Zone Elite | @devin | 4-0 | 480.5 | 383.1 |
    | Sam's Sleepers | @sam | 2-2 | 429.9 | 424.7 |
    | Blitz Brigade | @tara | 2-2 | 443.5 | 413.0 |
    | Leo's Lions | @leo | 2-3 | 606.9 | 584.2 |
    | Hail Marys | @nina | 3-1 | 494.7 | 462.2 |
    | Fourth & Long | @chris | 3-1 | 457.6 | 415.8 |
    | Red Zone Rebels | @owen | 1-2 | 317.1 | 306.0 |
    | Maya's Mavericks | @maya | 2-3 | 534.9 | 565.3 |
    | Raj's Rushers | @raj | 2-2 | 448.7 | 443.1 |

  - **Single seasons**, in the same team order (W-L PF/PA):
    - 2025: 1-1 239.4/254.3; 1-1 248.2/229.9; 1-0 123.5/90.5; 1-0 135.9/115.2; 1-1 200.5/199.6; 1-0 121.9/113.9; 2-0 239.0/231.4; 1-0 137.8/110.3; 0-1 91.3/92.1; 1-1 234.5/236.5; 0-1 121.5/124.5.
    - 2024: 2-0 258.0/229.0; 1-0 138.3/98.2; 2-0 264.8/202.2; 1-1 189.4/194.6; 0-1 114.3/121.8; 1-1 263.2/217.8; 0-1 120.7/130.4; 1-0 92.2/80.2; 0-1 105.7/122.0; 1-1 193.1/211.1; 2-0 237.0/194.3.
    - 2023: 0-1 133.0/138.5; 0-1 92.7/128.1; 1-0 92.2/90.3; 0-1 104.6/114.9; 1-0 128.7/91.7; 0-2 221.8/252.5; 1-0 135.1/100.3; 1-1 227.6/225.4; 1-0 120.1/91.9; 0-1 107.3/117.6; 0-1 90.2/124.3.
  - W-L colour: `#07A852` if winning, `#FF0028` if losing, `t1` if even.
  - PF/PA: 1 decimal, no thousands separator.
- **seasons:**
  - "2025 · Champion · Gridiron Gurus · You finished 4th · 9-5"
  - "2024 · Priya's Punters · 7th · 6-8"
  - "2023 · Touchdown Tacos · 1st · 10-4"

**Real product data vs placeholder**
- **Real data:**
  - Posts: type, author handle and colour, follower count, created time, scoring and week, mode, pick N, options or give/get, tags/topics, visibility.
  - Votes: vote counts and per-option shares, your vote.
  - Your follows and saves.
  - Attached roster snapshot with slots (from the poster's chosen league).
  - Rankings: type/pos/scoring, players, moves and last-updated summary, plus a read state for the updated-by dot.
  - Lists: players, description, videos (YouTube id, title, duration).
  - Players: name, position, team, headshot, projection.
  - League: settings, draft, history.
- **Placeholder:** all numbers (seeded), the topic list, "Week 5".

---

### 6. Dark mode (`.fs-dark` on the phone root; `localStorage["fieldscout-theme"]`)

**Token values**

| Token | Light (fallback used here) | Dark |
|---|---|---|
| t1 | `#1D1D1F` | `#FFFFFF` |
| t2 | `#3A3A3C` | `#D9D9D9` |
| t3 | `#6E6E73` | `#B3B3B3` |
| t4 | `#8E8E93` | `#A7A7A7` |
| t5 | `#AEAEB2` | `#727272` |
| b0 | `#fff` | `#121212` |
| b1 | `#F5F5F7` | `#282828` |
| b2 | `#F2F2F4` / `#EDEDF0` | `#333333` |
| b3 | `#EBEBEE` / `#E5E5EA` | `#3E3E3E` |
| b4 | `#C7C7CC` / `#D1D1D6` | `#575757` |
| ink | `#1D1D1F` | `#4D4D4D` |
| gg (green tint) | `#E3F9EC` | `#12301F` |
| gr (red tint) | `#FFE9EC` | `#3A1A1D` |
| gb (blue tint) | `#E6F2FF` | `#12263F` |
| tg | `#067A3E` | `#1ED760` |
| tr | `#C8001C` | `#FF6B6B` |
| barA (tab bar) | `rgba(29,29,31,.94)` | `rgba(18,18,18,.92)` |

**How surfaces resolve in dark mode**
- Poll cards and updated-by rows sit on `#282828`. Their inner surfaces (options, roster box, Gives/Gets, Accept/Decline) are `#121212`, darker than the card.
- Chips and pills off: `#333333`. On: `#4D4D4D` with white text.
- Active tab underline: `#4D4D4D`.
- `ink` covers (l3, YouTube and video placeholders, video thumbnails, "List" kind pill, toast) and the Gridiron Gurus H2H avatar: `#4D4D4D`.

**Fixed colours (unchanged in dark)**
- `#0088FF` / `#0074DB`, `#07B85A`, `#FF0028`, `#07A852`, `#07D066`.
- Author and avatar colours (except token-based ones).
- `rgba(0,0,0,.6/.35/.75)` overlays; `rgba(0,0,0,.32)` backdrop.
- White text on fills; tab bar inactive `#A1A1A6`.
- Headshot `#EEEEF1` fallback with `#6E6E73` initials and the `#fff` ring gap.
- Search placeholder `#6E6E73`: the global `input::placeholder` is not tokenised, so it renders `#6E6E73` on the `#333333` field.
- Status-bar notch `#000`.

**Defects visible in dark mode** (see open questions)
- The unchecked start/sit checkbox shows its white check on `#121212`.
- The Create sheet "List" tile (`t1`) turns `#FFFFFF` with a white icon.
- The My-team swatch `t1` becomes white, so the white initial is invisible on the 96px avatar.
- A user list made with the composer's `t1` swatch gets a `#FFFFFF` cover in dark mode.
- H2H team avatars:
  - Fourth & Long (`t2`) becomes `#D9D9D9` and Raj's Rushers (`t3`) becomes `#B3B3B3`, both behind white initials (near-invisible).
  - Gridiron Gurus (`ink`) becomes `#4D4D4D`.
- The home indicator (`b0` = `#121212`) sits under the `rgba(18,18,18,.92)` tab bar and is fully invisible. In light mode it is also effectively invisible (§2.1).

`.fs-dark` sets `color-scheme: dark` on the root and on `input` / `textarea`.

---

### Open questions
- Verification note: every critic finding (omissions and errors) was checked against the source and holds. None was disproved, so none was dropped. Values such as H2H numbers, draft order, ranking top lines, collage heads, detail rows and vote maths were confirmed by running the prototype's own script.
- Rankings tab: when the type/position/scoring chips exclude every ranking (e.g. Pre-draft + QB, or K, or D/ST), the prototype shows a blank area with no empty-state message, because cmEmpty is computed before rank filtering. Should it show 'Nothing matches…' plus 'Clear filters'?
- Dark mode: the unchecked start/sit checkbox always renders a white check. It is invisible on white in light mode but visible on #121212 in dark mode. Render the check only when the option is selected?
- Dark mode: several fills use var(--x-t1) or t2/t3 behind white content and become near-invisible. These are the Create sheet 'List' tile, the My team avatar swatch and its 96px avatar, user-list covers made with the t1 swatch, and the H2H avatars for Fourth & Long (t2 → #D9D9D9) and Raj's Rushers (t3 → #B3B3B3). Which colour should these use in dark mode (e.g. ink)?
- Dark mode: the search placeholder colour (#6E6E73, from the global input::placeholder rule) is not tokenised. Should it use t3 (#B3B3B3 in dark)?
- The Community header, tabs and topic pills sit inside the scroller and scroll away; nothing is sticky. Is that intended, or should the tabs (or header plus tabs) stick?
- Tab switches, 'See all' and re-tapping the Community tab do not reset scroll position or feed state. Should a tab change scroll to top, and should re-tapping Community scroll to top or reset to For you?
- The Start or sit carousel uses the default align-items:stretch, so every card is as tall as the tallest one. The trade card p4 shows ≈150px of empty space, and expanding any card's roster makes every card ≈730–875px tall. Copy this, or let cards size to their content (align-items:flex-start)?
- The Create sheet's options scroller picks up the global 84px dock spacer (::after), leaving a blank band under the three rows (sheet ≈380px tall). Intended, or should sheets be excluded from the dock spacer?
- The home indicator (134×5 white pill) has no z-index and is painted under the tab bar, so it is effectively invisible in both modes. In the web app, should we render a home indicator at all (iOS draws its own), or omit it?
- Ranking top lines are joined with two spaces in the source, but white-space:nowrap collapses them to one when rendered. Build with a single space (as rendered), or use a deliberate wider separator?
- List detail has no fixed header: the back button is overlaid on the cover and scrolls away. Keep it, or add a sticky back/title bar after scrolling?
- Follow is only available on the list detail page. Poll cards, ranking rows and updated-by rows have no follow control, and usernames are not links. As a result @shahranks can never be unfollowed, and the Following empty state (A6) is unreachable in the prototype. Project rule (2026-09-30) says every displayed username links to the user's profile. Should handles in cards and rows link to profiles, with follow/unfollow available there?
- List-detail player rows (and roster, option and trade player names) are not tappable. Project rule says every player click opens the mini card first. Should these open the player mini card?
- Trade polls vote immediately on tapping Accept/Decline, while start/sit requires selection plus a 'Vote' button. Votes cannot be changed. Confirm both behaviours.
- Seed poll p4 (@jordan trades away A.J. Brown) attaches roster li 1, which contains neither A.J. Brown nor Jonathan Taylor, so only Rome Odunze highlights. For user posts, attaching league 1 ('Dalton's Dynasty · 10-team standard') expands to the opponent's roster, and league 0 uses a static roster rather than the live lineup. Confirm the product attaches a snapshot of the poster's actual roster in the chosen league and highlights every player in the question.
- Private user lists (meta 'Private') still appear in the public Community feed, since the prototype has no visibility filter. Confirm the product excludes private lists from the feed and from other users' search.
- A user list can be saved with 0 players (only a name is required). It renders as a plain colour-block cover, '0 players' and 'Players · 0' with no rows. Should saving require at least one player, or should an empty list get a placeholder cover and empty-state copy?
- Global search 'Posts' results include closed polls (p6, p7, p8). Tapping one opens Community › Start or sit, where closed polls are never shown. Poll and person results also leave an active topic (and, for polls, the query) applied. Should search exclude closed polls (or route them to My start/sit), and should search navigation clear topic/query?
- The 'Updated by people you follow' unread dot is static and always shown; nothing marks it read. What clears it in the product: opening the ranking, or viewing the row?
- The trade Gives/Gets meta line (9.5px) is white-space:nowrap with no ellipsis, so a long 'POS · TEAM' overflows its box. Add ellipsis?
- My team (G1) edge cases: (a) Save enables when only leading or trailing spaces are added, then saves the same trimmed name and still toasts 'Team updated'. (b) The saved initial (TEAMS[0].ini) and the Menu card initial are not uppercased, while the G1 avatar is. (c) G1 always edits league 0's team, even when another league is selected. Should Save compare trimmed names, initials always be uppercased, and G1 edit the current league's team?
- The 'Rankings this week' shelf lists all rankings, including Rest of season and Pre-draft. Should it be limited to the current week, or retitled?
- In the Following and Rankings tabs, the 'Updated by people you follow' rows duplicate items that also appear in the Rankings list below. Intended?
- Lists masonry uses CSS multi-column (column-first order: down column 1, then column 2). Keep column-first, or switch to row-first (left/right alternating) masonry?
- Toast duration is 1800ms in code (README says ~2.2s), and the sheet backdrop is rgba(0,0,0,.32) in code (README says .4). Which values win?
- Saved state (cmSaved) is only visible on the detail page. Should saved lists or rankings surface somewhere (e.g. Profile > Lists > Saved, as in the Lists file)?
- The prototype never clears hasCmDetail/hasPage on navigation (they float above any screen). Confirm these become real routes (e.g. /community/lists/[id]; league menu pages as /league/[id]/settings, /draft, /history, /seasons) with normal back behaviour.
- Draft results placeholder data runs out: Round 5 has 1 pick and Round 6 is an empty list with no copy. Real data will come from the league's draft. Should the round chips show the league's actual round count, and what should an empty round show?
- The ranking detail variant in hasCmDetail ('Ranking · PPR' pill, 'Ranked players · N', +/- moves) is unreachable in this file, because ranking taps go to the Rankings file's #view-<id>. Treat the Rankings file as the only ranking detail and drop this variant?

---

## Gap analysis vs the current app

## Community feed, topic pills, detail pages: gap analysis against the redesign-v7 worktree

**Bottom line:** the app already has a list-only Community feed at `/app/explore`, but it's behind the `community` flag. It has Trending / Newest / Following tabs, tag chips, likes, comments and Follow. Polls don't exist at all: `start_sit_questions` / `start_sit_votes` only support "player A vs player B" with no API routes, and the `/app/start-or-sit/*` pages are placeholders. So every poll card, both poll shelves, the vote maths, trade polls and "Roster attached" need new backend. Lists, rankings-as-lists, follows, saving (Pin), share, video links and search all have data, so those are mostly restyle work or new UI on existing data.

Leagues have one season each, so G4's all-time view, G5, and team avatar colour or photo need backend. Rename, settings, draft picks and current-season head-to-head already exist.

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Community screen as a mobile surface (scrolling header + tabs + pills, 84px dock spacer, nothing sticky) | restyle-only | `src/app/app/(shell)/explore/page.tsx`, `src/components/explore/explore-feed.tsx`, `src/components/layout/app-shell.tsx` | Currently a desktop `TwoColumnLayout` with an aside. App-shell comment: phones get "the same top bar plus the bottom tabs until the mobile pass". Gated by `featureFlags.community` (`explore/layout.tsx` redirects to `/app` when off). |
| Header A1: logo tile + wordmark (tap goes Home), round Search button, blue round Create (+) | restyle-only | `src/components/layout/top-nav.tsx` (`LogoTile`, `Wordmark`, `CreateMenu`, `TopSearch` desk-only) | Pieces exist. On mobile the search input is hidden (`desk:block`) and Create is a stroke button with a dropdown, not a 34px blue circle. |
| Header A2: inline feed search (autofocus, Cancel, live filter on title + handle + desc + tags + players) | new-ui-on-existing-data | `src/app/api/search/community/route.ts` (matches list title + username only), `src/components/shared/command-palette.tsx` | The data exists. The query needs widening to description, tags (`list_tags`) and player names (`list_players`). The feed has no in-page search state today. |
| Tabs row: For you / Following / Start or sit / Rankings / Lists | out-of-scope-or-question | `explore-feed.tsx` (Trending / Newest / Following) | Product call: drop Trending/Newest? What ranks "For you"? Following, Rankings and Lists can be served from existing data. Start or sit cannot (see polls). |
| Topic pills, text topics (Sleeper picks, Waiver stashes, Rookies, Trade targets) | new-ui-on-existing-data | `useTags({trending:true})` in `explore-feed.tsx`, `tags` / `list_tags` tables | Single-select toggle already exists (`SegmentItem`). The design uses a scrolling pill row, not a boxed segment. Who curates the topic list is a question (spec calls it placeholder). |
| Topic pills, player pills (24px headshot + team ring) and trend pill ("Injuries" with icon) | new-ui-on-existing-data | `list_players`, `players`, `src/components/players/player-image.tsx`, `src/lib/nfl-team-colors` | Filtering by player needs a `list_players` join, which doesn't exist yet. How "Injuries" is defined as a topic needs a ruling. |
| A3 "Updated by people you follow" rows (author avatar, unread dot, "Updated 40m ago · 4 changes · C. Hubbard ▲4") | needs-new-backend | `follows`, `lists.updated_at`, `ranking_history` (table from 001, never written by app or trigger), `notifications` type `list_updated` (038, sent to list *pinners*, not author followers) | Follows + updated_at exist. The per-player move summary needs `ranking_history` to actually be written. The unread dot needs a per-viewer read state. |
| A4 Shelves mode: "Start or sit · Week 5" carousel (286px cards, equal height, See all) | needs-new-backend | none (`start-or-sit/*` pages are `PlaceholderPage`) | Depends on the poll backend. |
| A4 Shelves: "Rankings this week" rows + See all | new-ui-on-existing-data | `use-explore-feed.ts` (`is_ranking = ranking_mode !== 'unranked'`), `list_players` | Needs a ranking-only query that includes the top 3 players. |
| A4 Shelves: "Lists for you" masonry (2-column multi-column, random cover heights 150/180/205) | new-ui-on-existing-data | `use-explore-feed.ts`, `src/components/lists/v2/cover-tile.tsx` | The feed query has no players or links today. Covers need players[0..3] and a video count. |
| A5 Grouped mode with section headings (Start or sit / Rankings / Lists) | new-ui-on-existing-data | `explore-feed.tsx` (single flat list) | The polls section depends on the backend. Rankings and Lists can be grouped from existing rows. |
| A5b Rank filter rows: type (Weekly / ROS / Pre-draft) × position × scoring | needs-new-backend | `lists.position_filter`, `lists.scoring_system_id`, `lists.is_big_board`, `big_board_weekly` | Position and scoring exist. Weekly can come from `big_board_weekly` and pre-draft from `is_big_board`. Nothing marks a list "Rest of season", so the type row needs a field or a ruling. Fix the A8 quirk: show the empty state when the chips exclude everything. |
| A6 / A7 empty states ("Follow people…" / "Browse For you", "Nothing matches {topic}" / "Clear filters") | restyle-only | `explore-feed.tsx` empty branch | Copy and layout differ. Following-empty is reachable in the real app. |
| Poll card: author row, mode pill (Start N of M / Sit N of M / Trade), title | needs-new-backend | `start_sit_questions` (player_a/player_b only), `start_sit_votes.voted_for` | The current schema can't express N-of-M, sit mode, more than 2 options, or trade. |
| Start/sit options P1–P4: multi-select checkboxes, oldest-pick drop, "k of N picked" hint, Vote button, bars + % + your check, "N votes · you voted" | needs-new-backend | none | Vote storage per option index, aggregates, one final vote per user, plus API routes (none exist). |
| Trade poll P5/P6: Gives/Gets panels, instant Accept/Decline vote, bars, 2px ring on your choice | needs-new-backend | none (league `trades` / `trade_votes` are league trades, not community polls) | New poll type. |
| P7 "Roster attached" (collapsed/expanded 14 rows, highlighted players, chevron) | needs-new-backend | `league_rosters` / `team_lineups` exist but are flag-gated; no snapshot on a post | Needs a roster snapshot stored with the post. In the prototype, li 0 is static, not live. |
| Vote maths (n+1, per-player % not summing to 100, top-N tint) | needs-new-backend | none | Server must aggregate. Per CLAUDE.md, clients don't compute authoritative values. |
| Closed polls excluded from feed | needs-new-backend | `start_sit_questions.voting_closes_at` exists (2-player schema) | Needs the close rule (composer `close:"kickoff"`). |
| Ranking row (60px author-colour tile + 40px lead headshot, title, "@by · 12k follows", top-3 line, chevron) | new-ui-on-existing-data | `profiles.follower_count`, `list_players`, `lists` | Author colour has no source (see question below). |
| List card: collage cover (up to 4 × 44px headshots), title, byline avatar + "@by · N players" | new-ui-on-existing-data | `cover-tile.tsx` (wide band, headshots stacked bottom-right), `ThumbnailPlayer` in `use-lists` | Cover colour conflicts: the design uses author or composer colour; Chris's 2026-08-11 ruling in `cover-tile.tsx` makes covers position-group colour. |
| List card video badge ("1 video" / "N videos") and YouTube thumbnail cover (110px, i.ytimg.com) | new-ui-on-existing-data | `list_links` (migration 080, `kind IN ('video','article')`, url/title/duration_label), `list-details-tab.tsx` | `list-details-tab.tsx` deliberately shows a placeholder block ("no thumbnail image"). Deriving the YouTube id from the URL and loading ytimg needs a ruling (no-scraping rule; `next.config` has no image hosts). |
| Detail page D: 230px cover with collage, floating back button, no fixed header | restyle-only | `src/app/u/[username]/lists/[listSlug]/page.tsx`, `src/components/lists/public-list-view.tsx`, `/app/lists/[id]` | Spec says the product should make it a route, and it already is one. |
| Detail: kind pill ("List" / "Ranking · PPR"), 24px title, author row with avatar and "· 1.2k follows" | new-ui-on-existing-data | `ListHeroShell` in `public-list-view.tsx`, `profiles.follower_count`, `scoring_systems` | Follower count isn't shown in the hero today. |
| D1 Detail Follow / Following pill (hidden on own posts) | new-ui-on-existing-data | `src/components/explore/follow-button.tsx`, `use-follows.ts` | FollowButton is used only in the feed, top scouts and profile rows, never on list detail. |
| Detail Save / Saved (bookmark) | restyle-only | `src/components/lists/pin-list-button.tsx`, `/api/lists/[id]/favorite`, `list_favorites` | Exists as "Pin". Rename to Save/Saved is a copy call. |
| Detail Share → toast "Link copied" | restyle-only | `ShareLinkButton` in `public-list-view.tsx` | Exists. |
| D2 Description | restyle-only | `lists.description`, `list-details-tab.tsx` | Exists (in a Details tab). |
| D3 Videos shelf (220×124 thumbs, red play badge, duration chip, "YouTube") | new-ui-on-existing-data | `list_links` (title, url, duration_label), `LinksSection` in `list-details-tab.tsx` | Rendered today as rows in the Details tab. Thumbnail is the same ytimg question as the card cover. |
| Detail player rows (#, 36px headshot, full name, position-coloured meta, projection) | restyle-only | `ListBody` / `list-row-parts.tsx`, `players.projected_pts_*`, `player_weekly_projections` | Conflict: D497 (`projected-points.ts`) makes projections dark blue everywhere, but the design uses t1. |
| D4 Ranking detail: "+4 / −3" moves per player | needs-new-backend | `ranking_history` (never written) | Same dependency as A3. |
| Create sheet S (handle, "Create" title, 3 rows with coloured icon tiles) | new-ui-on-existing-data | `CreateMenu` in `top-nav.tsx`, `src/components/ui/sheet.tsx` (bottom side) | The current menu holds List + league. |
| Create › Start or sit composer + Post (prepend, reset filters, toast "Posted to Community") | needs-new-backend | `start-or-sit/new/page.tsx` placeholder | Composer is another section. |
| Create › Ranking / Create › List | new-ui-on-existing-data | `src/components/lists/list-form-dialog.tsx` (Basic / Ranked / Team types, position), `POST /api/lists` | The composer's colour swatch has no column (see the cover-colour conflict). The design composer adds players and videos in one flow. |
| Toast (ink pill, bottom 100, 1800ms, replace-on-new) | restyle-only | `src/components/ui/toast.tsx`, `use-toast.ts` | Exists as an ink pill. Timing and position differ. |
| FSHeadshot (team-colour ring, initials fallback, D/ST rule, scale/offset crop) | restyle-only | `src/components/players/player-image.tsx` (`PlayerAvatarImage`), `src/lib/nfl-team-colors` | Has the initials fallback but no team ring. |
| Author avatars (colour circle + handle initial) | out-of-scope-or-question | `src/components/ui/user-avatar.tsx`, `profiles.avatar_url` (no colour column) | The app shows photo avatars with 2-letter initials on grey. Should authors get a colour (stored or hashed)? |
| Likes and comment counts, top scouts, trending tags aside | out-of-scope-or-question | `explore-feed.tsx` `LikeButton`, `top-scouts-card.tsx`, `trending-tags-card.tsx`, list comments tab | The design shows none of these. Drop them on mobile, or keep them? |
| Dock / bottom tab bar (Home / Community / Players / Profile avatar, `barA` translucency, content scrolls under) | new-ui-on-existing-data | `src/components/layout/bottom-tabs.tsx` (Home / Lists / Players / Search / More), `more-sheet.tsx` | IA question below. The Profile avatar comes from existing profile data. |
| Tab bar IA change (Lists, Search and More removed; Community added) | out-of-scope-or-question | `bottom-tabs.tsx`, `featureFlags.community` / `startOrSit` (off at launch) | The go-live scope has Community hidden. |
| Global search routing (person → Community filtered by handle; poll → Start or sit tab; list → detail; ranking → view) | out-of-scope-or-question | `command-palette.tsx` (list → `/app/lists/{id}`, user → profile) | Memory rule "usernames always link to profile" conflicts with person → feed filter. Poll results depend on the poll backend. |
| Status bar, notch, bezel, home indicator | out-of-scope-or-question | n/a | Prototype device chrome. Don't build (spec itself says the home indicator is invisible). |
| G overlay header (back chevron, centred title, 36px spacer) | restyle-only | league routes under `src/app/app/(shell)/leagues/[leagueId]/*` | Leagues are flag-gated (test cohort). |
| G1 My team: rename (24-char limit, counter, dirty-check Save, toast "Team updated") | restyle-only | `POST /api/leagues/[id]/teams/[tid]/name`, `use-rename-own-team.ts`, `team-commish-tools.tsx` | Exists. The prototype bugs (always edits league 0, initial not uppercased) should not be copied. |
| G1 avatar colour swatches + "Upload photo" + 96px avatar | needs-new-backend | `teams` has no avatar or colour column (`leagues.avatar_url` only) | New team avatar fields and upload. |
| G2 League settings / Scoring / Playoffs read-only rows + "Only the commissioner can change these settings" | restyle-only | `src/components/leagues/settings-panel.tsx` (read-only for non-commish; reseed, consolation, tiebreakers), `/leagues/[id]/settings` | Compact summary rows plus the static playoffs note. |
| G3 Draft results (round chips, pick rows with owner, your team in blue) | new-ui-on-existing-data | `src/components/draft/draft-recap.tsx`, `draft_picks`, `/leagues/[id]/draft/recap` | A per-round list view is new. Add an empty state for an empty round. |
| G4 League history, current-season head-to-head table + Record / PF / PA KPIs | new-ui-on-existing-data | `src/components/leagues/stats-page.tsx` (H2H W-L / PF / PA), `team_week_results` | Exists for one season. |
| G4 All-time / past-season chips and "Start/sit accuracy · Optimal lineup choices" KPI | needs-new-backend | `stats-page.tsx` comment: "One season per league" | Needs multi-season league continuity and an optimal-lineup computation (none exists). |
| G5 Previous seasons (champion, finish, record; tap opens archived league) | needs-new-backend | `leagues.season` (single), `champion_team_id` | No league renewal or archive. |
| Dark mode (`.fs-dark`, token table, `localStorage["fieldscout-theme"]`) and its listed defects | out-of-scope-or-question | `src/stores/theme-store.ts`, `src/app/globals.css` `--m-*`, `tailwind.config.ts` `m.*`, `use-layout-mode.ts` (worktree commit 27d455b) | CLAUDE.md says single theme with no toggle. But this worktree's newest commit adds mobile-only dark tokens and a theme switch, with a "Chris, 2026-10-15" ruling in the code comments. The design defects (white check on #121212, t1 swatch/cover turning white, t2/t3 H2H avatars) need decisions. |

**Files checked:**
- **Community:** `src/app/app/(shell)/explore/{page,layout}.tsx`, `src/components/explore/*`
- **Hooks:** `src/hooks/{use-explore-feed,use-follows,use-favorites,use-top-scouts,use-rename-own-team,use-layout-mode}.ts`
- **API:** `src/app/api/search/community/route.ts`, `src/app/api/lists/[id]/{favorite,like,links,comments}`
- **Search:** `src/components/shared/command-palette.tsx`
- **Layout:** `src/components/layout/{bottom-tabs,more-sheet,top-nav,app-shell,layout-mode-frame,sidebar}.tsx`
- **Lists:** `src/components/lists/{public-list-view,pin-list-button,list-form-dialog}.tsx`, `src/components/lists/v2/{cover-tile,list-details-tab}.tsx`, `src/app/u/[username]/lists/[listSlug]/page.tsx`
- **Start or sit:** `src/app/app/(shell)/start-or-sit/**`
- **Leagues and draft:** `src/components/leagues/{settings-panel,stats-page,my-team-ops,team-commish-tools}.tsx`, `src/components/draft/draft-recap.tsx`
- **Schema (`src/types/database.ts`):** `start_sit_*`, `follows`, `list_favorites`, `list_links`, `lists`, `ranking_history`, `big_board_weekly`, `profiles`, `teams`, `leagues`, `notifications`, `tags`
- **Migrations:** `supabase/migrations/{001,012,038,080}`
- **Flags:** `src/lib/feature-flags.ts`
- **UI primitives:** `src/components/ui/{toast,sheet,user-avatar}.tsx`, `src/components/players/{player-image,projected-points}.ts(x)`
- **Theme:** `src/stores/theme-store.ts`

