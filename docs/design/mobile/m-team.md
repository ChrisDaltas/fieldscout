## League › Team, swap, team view, trade builder, trade detail

Sources: `FieldScout Mobile.dc.html`.
- **Markup:** L16 (global `*{box-sizing:border-box}`), L19–22 (dark vars + dock spacer CSS), L38 (phone root), L302–342 (Team tab), L627–644 (dock), L646–651 + L692–701 + L722–727 (sheet shell + swap body), L729–748 (team view), L832–858 (trade detail), L859–890 (trade builder), L1117 (toast).
- **Script:**
  - Constants: TEAMS L1130–1143, SLOTS L1144, MINE/THEIRS L1145–1146, OPRK L1147, TRANS L1152, MUPS L1162, CONVOS L1185–1193, LEAGUES L1194, TRADES L1195, tierOpp L1206, BENCH_ME/BENCH_THEM L1213–1214, EXTRA L1215, ownerOf L1249–1253, rosterOf L1256.
  - Profile and roster helpers: profile action button L1286, teamRoster L1365–1367, initial state L1414, newTrade/openTrade L1418–1419, Players-tab trade action L1426.
  - Component methods: toast L1624, go() L1628, lineupOf/compare L1632–1635, rowFor/swap L1636–1650, openTeam L1701, openConvo L1703, sheetTitle L1707, lgTabbar L1709–1710, leagueTabs L1723 (unbound), teamActions L1736, `tr` L1756–1768, switcher L1769–1777, Messages › Trades rows L1780–1781, `tv` L1820–1827, `td` L1828–1838, closeSheet L1841, goDms/backFromDms L1845–1846, dock flags L1858.
- **Also:** README L20–22, L54, L76, L130–133; `FSHeadshot.dc.html` L11–27.
- **Verification:**
  - I ran the prototype script headless to resolve every seeded value quoted below.
  - I served the file locally and measured it in a browser; measured positions are marked "measured".
  - All y values are relative to the phone's top edge (0–844).

### 0. Reading conventions (apply to every value below)
- **Colour variables.** In the source, colours are written as `var(--x-NAME,#HEX)`.
  - In light mode the `--x-*` variables are **not defined**, so the **fallback hex is what renders**.
  - The same variable has different fallbacks at different call sites (e.g. `--x-b2` is `#F2F2F4` in some places and `#EDEDF0` in others). Each element below lists the fallback used at that element.
  - In dark mode, `.fs-dark` on the phone root defines the variables (see §6). README token names are in [brackets].
- **Type.** Inter Display, `font-feature-settings:'tnum' 1,'cv11' 1`, antialiased, line-height normal. "15/600" means font-size 15px, weight 600. Text with no colour inherits t1 `var(--x-t1,#1D1D1F)` from the phone root. A global `*{box-sizing:border-box}` applies.
- **Icons.** 16×16 viewBox, `fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round`. Rendered size and stroke width are given per use.
- **Phone and status bar.** The phone is 390×844 and the status bar is 50px. Every full-screen overlay in this area starts at `top:50px`, so the status bar ("9:41", notch, signal and battery) stays visible above it.
- **Slot chip colours** (POS bg / POSFG text):
  - QB `#F75252`/#fff · RB `#5C7CE5`/#fff · WR `#9D70E9`/#fff · TE `#ECAD48`/#fff · FLEX `var(--x-ink,#1D1D1F)`/#fff · K `#D2E8E8`/`#1D1D1F` · DST (label "D/ST") `#FFE75E`/`#1D1D1F`.
  - BN uses a literal **`#EDEDF0`/`#1D1D1F`**. rowFor and tv.rowOf both use the hex literal, not the `POS.BN` var.
  - All except FLEX are literals, so they do not change in dark mode.
- **POSTXT** (position colour for text): QB `#E03E3E`, RB `#4A68D4`, WR `#8656D8`, TE `#C98A1F`, K `#5E8C8C`, DST `#A68A00`.
- **FSHeadshot** (`<dc-import name="FSHeadshot" team player src size>`):
  - Shape: N×N circle, bg literal `#EEEEF1`, overflow hidden, `title="{player}"` (native hover tooltip, e.g. "Empty" on an empty slot).
  - Photo: `<img alt="{player}">`, `object-fit:cover; object-position:50% 15%; transform:scale(1.25) translateY(8%)`.
  - Ring: box-shadow `0 0 0 1px #fff, 0 0 0 (1+rw)px <team colour>`, where rw = 2 if N ≥ 32, else 1.5. Team colours come from the TC map in FSHeadshot.dc.html. With no team colour (e.g. team "FA" or "") the ring is `inset 0 0 0 1px rgba(0,0,0,.04)`.
  - Initials fallback:
    - Algorithm: strip a trailing " D/ST", split on `/[\s'-]+/` (spaces, apostrophes and hyphens), then take the first letter of the first part plus the first letter of the last part, uppercased.
    - Style: weight 700, literal colour `#6E6E73`, its own `font-family:'InterDisplay'`, size max(9, round(N×0.36)): N 38 → 14px, 36 → 13, 34 → 12, 30 → 11.
    - An image load error also falls back to initials.
  - Photos exist only for names in the HEAD map: Bijan Robinson, A.J. Brown, Alvin Kamara, James Conner, Shedeur Sanders, Jameson Williams, Isiah Pacheco, Evan Engram, Darnell Mooney, Braelon Allen, Cole Kmet, Adonai Mitchell, Jaylen Wright, Jahan Dotson, Justice Hill, Sean Tucker, Jaydon Blue, Roschon Johnson, Charlie Kolar. Everyone else shows initials (Jake Bates "JB", Steelers D/ST "S", Kendrick Bourne "KB", Josh Allen "JA", Ka'imi Fairbairn "KF").
- **Name helpers.** `short(n)` gives "B. Robinson". The name is returned unchanged if its first word contains "." ("A.J. Brown") or it ends in "D/ST". `ord(n)` gives 1st/2nd/3rd/4th/11th/12th/22nd/23rd.
- **Toast** (z 30, last in DOM):
  - Position: absolute, left 50%, bottom 100px, `translateX(-50%)`. This puts it at y 708–744 (measured).
  - Shape: height 36, padding 0 16, radius 999, bg `var(--x-ink,#1D1D1F)`, text #fff 13/500 nowrap. Width follows the text: 179.6px for "Not part of this prototype", 264.2px for "Pick at least one player from each team" (measured).
  - Timing: appears instantly and clears after **1800 ms** (`setTimeout`, L1624). A new toast replaces the text and restarts the timer. No animation. The README says "about 2.2s"; see §7.
  - Overlaps (measured):
    - On the Team tab it sits on top of the league-switcher card (y 702–758).
    - In the trade builder it covers the footer's top border (y 725–727) and the top ~4–6px of the "Trade proposal" summary row (y 738/740–758). It does **not** reach "View proposal" (y 768–816).
- **Animation.** No overlay, sheet or step change in this area animates. Everything mounts and unmounts instantly. The only transitions are the toggle switch tracks (`background .2s linear`) and the dock's league-switcher swipe and dots.

### 1. Screens & states

| ID | Screen / state | Exact condition | Layer |
|---|---|---|---|
| T1 | League › Team tab (my team) | `scr==="league" && tab==="team"` | base screen, under dock (dock z 4) |
| T2 | Lineup row, filled | `slots[i]` / `bench[i]` is a name | – |
| T3 | Lineup row, empty | value `null`. Initially the 6th bench slot is `null`. A starter becomes `null` when moved to an empty bench slot. A bench-to-bench move into the empty slot leaves `null` at the mover's old index, so the "Empty" row can render first or mid-bench. | – |
| T4 | Row is the current swap target | `sheet==="swap" && swapFor.t===kind && swapFor.i===i` → chip ring on. The ring is visible only if the row sits above the sheet panel's top edge, where it shows dimmed through the backdrop (see §2.2). | under backdrop |
| S1 | Swap player sheet | `sheet==="swap"`, with `swapFor {t:"s"\|"b", i}`. Closing via the backdrop sets only `sheet:null`; `swapFor` stays set, which is harmless. | z 20 |
| S2 | – eligible starters listed | `stIdx.length>0` (no header) | – |
| S3 | – "Bench" header + eligible bench rows | `bnIdx.length>0` | – |
| S4 | – nothing eligible | `!stIdx.length && !bnIdx.length` → "No eligible players for this slot". Reachable e.g. when the bench is full and you pick K with no K on the bench. | – |
| V1 | Team view (another team) | `teamView != null` (1–11). teamView 0 is never set; my team routes to T1. | z 21 |
| V2 | – Recent moves rows | `moves.length>0` | – |
| V3 | – no moves | `!moves.length` → "No moves this season" | – |
| V4 | – Empty roster row | code path only (`rowOf(null)`). With the seeded data every team fills all 9 starters and 5 bench, so it never renders. | – |
| D1 | Trade detail, incoming pending | `tradeOpen` set, `status==="Pending" && dir==="in"` → Decline/Counter/Accept footer | z 23 |
| D2 | Trade detail, outgoing pending | `status==="Pending" && dir==="out"` → "Withdraw offer". No sample trade reaches this state. | z 23 |
| D3 | Trade detail, finished | `status!=="Pending"` (Accepted / Declined) → text footer | z 23 |
| D4 | – usernames hidden | `tdHide===true` (global, persists across trades) | – |
| B1 | Trade builder, pick step | `trade && !trade.review` | z 24 |
| B2 | – not ready | `trade.mine.length===0 \|\| trade.theirs.length===0` → grey button + "Pick players on both sides" | – |
| B3 | – ready | both sides ≥ 1 → blue button + "{mine} for {theirs}". Counts include names that have no visible tile (see the Counter edge case in §3). | – |
| B4 | – count badge | `mine.length+theirs.length>0` | – |
| B5 | Trade builder, review step | `trade.review===true` | z 24 |
| B6 | – team names hidden | `trade.hide===true` | – |
| X | Toast | `toast!==""` | z 30 |

### 2. Layout (top to bottom)

#### 2.1 Team tab (T1)
The top context is shared with the other league tabs; the full spec is in the League › Match section. In summary:
- **League header**: flex none, padding 0 12px, border-bottom 1px `var(--x-b3,#EBEBEE)`. 48px row with gap 10, so content starts at y 99.
  - 28px logo tile, radius 8, `#07D066`, 15px logomark, margin-left 4.
  - Home button: 38px circle, margin-left -6, house icon 20px, stroke 1.5.
  - League name 13/600, ellipsis, flex 1.
  - Search, Notifications and Messages: 38px circles, gap 2. Badges are 16px pills (`#FF0028` notifications, `#0088FF` DMs) with 10/600 white text and a 2px b0 ring.
- **No in-page tab strip.** The script computes `leagueTabs` (Match/Team/Players/League with an `inset 0 -2px 0 #0088FF` underline, L1723), but it is bound nowhere in the markup. Tab switching happens only through the dock tab bar (§4).
- **Scroll container**: flex 1, overflow-y auto, hidden scrollbar. It runs from y 99 down to y 844, under the dock. It holds:

**A. Team summary card.**
- Wrapper padding `12px 12px 0`. Card radius 18, bg `var(--x-b1,#F5F5F7)` [b1], padding `14px 14px 10px`, flex column gap 12.
- Measured: card x 12, y 111, 366×157; content is 338 wide.
- **Every string and number in this card is literal markup (L305–306), not bound to state.** It contradicts the rest of the prototype (§7) and ignores `myName`/`myAv` and the league switcher.

1. Identity row (flex, align center, gap 10):
   - Avatar: 44×44 circle, bg `#0088FF` [accent], letter "T" 15/600 #fff, centered.
   - Text column (flex 1, min-width 0, gap 2):
     - "Touchdown Tacos" 17/600, letter-spacing -0.01em.
     - "2-6 · 11th · PF 12th · PA 10th" 12/500 `var(--x-t3,#6E6E73)` [t3].
   - Right column (flex column, align flex-end): "Proj" 11/500 t3 `#6E6E73`, then "70.92" 15/600.
2. Win row (flex, align center, gap 8):
   - "72% win" 11/600 `#07A852` [success text].
   - Track: flex 1, height 5, radius 999, `var(--x-b3,#E5E5EA)`, overflow hidden.
   - Fill: width 72%, height 100%, `#07B85A` [green fill]. The fill has no radius of its own; the track clips it.
3. Quick actions: grid `repeat(4,minmax(0,1fr))`, gap 6, so each tile is 80px wide (measured first tile x 26, y 206).
   - Tile: height 52, radius 12, bg `var(--x-b0,#fff)`, flex column centered, gap 4, cursor pointer. Pressed (`:active`): bg `var(--x-b2,#EDEDF0)`.
   - Icon: 16×16, stroke-width 1.6, colour `var(--x-t1,#1D1D1F)`. Label 11/600.
   - Tiles in order:
     - **"Schedule"**: ICON.sched `M3 4.5h10v8.5H3zM3 7.5h10M6 3v3M10 3v3`
     - **"Trade"**: ICON.trade `M3 5.5h9.5L10 3M13 10.5H3.5L6 13`
     - **"Moves"**: ICON.trans `M4 3.5h8v9H4zM6 6.5h4M6 9.5h4`. Its source label is "Transactions", renamed to "Moves".
     - **"News"**: ICON.news `M3.5 3.5h9v9h-9zM5.5 6h5M5.5 8.5h5M5.5 11h3`

**B. Starters header.** Flex, align flex-end, justify space-between, padding `18px 16px 8px`.
- Left column (gap 2): "Starters" 17/600, letter-spacing -0.01em; "Tap a position to swap players" 12/500 t3.
- Right: "Week {week}" 13/600 `#0088FF`, flex none, nowrap.
  - The default is "Week 5".
  - The value is shared with the Match tab's week arrows (clamped 1–17).
  - It is not tappable here.

**C. Starter rows.** The list wrapper has padding `0 12px 20px` and wraps both starters and bench. There are 9 rows in SLOTS order: QB, RB, RB, WR, WR, TE, FLEX, K, D/ST.
- Row: flex, align center, gap 10, padding `10px 4px`, border-bottom 1px `var(--x-b2,#F2F2F4)`.
- Measured row height: 68px filled, 59px Empty. The first row is at y 331 at scroll 0.
- Elements in order:
  1. Slot chip: 44×30, radius 9, flex none, centered, 11/600, colours from the slot chip table, cursor pointer. box-shadow is `0 0 0 2px #fff, 0 0 0 4px #0088FF` when the row is the swap target (T4), otherwise `none`.
  2. Avatar: filled → FSHeadshot 38. Empty → 38×38 circle with no fill and box-shadow `inset 0 0 0 1.5px var(--x-b3,#E5E5EA)`.
  3. Text column (flex 1, min-width 0, column gap 2, cursor pointer):
     - Line 1: full name 14/600, nowrap ellipsis.
       - Colour `var(--x-t1,#1D1D1F)` when filled, `var(--x-t5,#AEAEB2)` for "Empty".
       - After a space comes an inline meta span 11/500 t3, e.g. "RB · ATL (5)" (pos · team (bye week); DST shows as "D/ST").
     - Line 2: "99% rostered · 98% start" 11/500 t3.
     - Line 3: 11/500 t3, game string + space + rank span (weight 600, colour rkC), e.g. "W 19-17 vs PHI **(9th)**".
     - Empty row: lines 2–3 and the points column are empty strings. They collapse to zero height, but the 2px gaps remain.
  4. Points column (flex column, align flex-end, gap 1): points 15/600 (shows "–", an en dash, when there are no points); projection 11/500 t3.

**D. "Bench" title.** 17/600, letter-spacing -0.01em, padding `18px 4px 4px`.

**E. Bench rows.** Same row spec. The chip reads "BN" in `#EDEDF0`/`#1D1D1F`. There are 6 rows: 5 players and 1 "Empty", rendered in `bench` array order (the Empty row moves if the bench is reordered).

The scroller then ends with the list's 20px padding plus a CSS `::after` spacer of **150px** (`.dock-lg` → `--x-dockpad`, L21–22), so the last row clears the floating dock (§4). The dock covers y 696–844.

#### 2.2 Swap player sheet (S1)
**Sheet shell** (shared):
- Backdrop: `position:absolute; inset:0; z-index:20; background:rgba(0,0,0,.32); display:flex; align-items:flex-end`. It dims the status bar and dock too. The README says `.4`; see §7.
- Panel: width 100%, `max-height:86%` (725.84px), flex column, radius `24px 24px 0 0`, bg `var(--x-b0,#fff)`, padding `8px 0 30px`. It mounts instantly, anchored to the bottom edge; there is no slide.
- Grab handle: wrapper padding `2px 0 8px`, centered; bar 36×5, radius 999, `var(--x-b4,#D1D1D6)`. It is visual only; there is no drag.
- Header: flex, align flex-start, gap 12, padding `4px 16px 12px 20px`. Title **"Swap player"** 19/600, letter-spacing -0.02em. There is no subtitle, no close X (that exists only on the "Switch league" sheet), and no Done button.
- Body: `.fsm-scroll` (flex 1, min-height 0, overflow-y auto, hidden scrollbar).
  - Because its style contains `overflow-y`, it gets the dock `::after` spacer. On the Team tab that is **150px** (`dock-lg`), so every swap sheet ends with 150px of blank space, plus the panel's 30px bottom padding.
  - Measured panel heights with the default roster:
    - QB: 420px (top y 424)
    - RB1: 620 (top 224)
    - WR1: 570 (top 274)
    - FLEX and BN rows: 725.8, the max-height (top 118); the body scrolls.
  - Consequence for T4: the target ring is only visible when the row is above the panel top. QB at default scroll shows it; RB1, WR1, FLEX and the bench rows are hidden under the panel.

**Swap body** (wrapper padding `0 12px 8px`):
1. **Selected-player card**: padding 2, radius 14, bg `var(--x-b1,#F5F5F7)`, containing one row for the tapped slot.
   - The row object is built with rowFor, so its `ring` value is on. However, the sheet chip markup (L694/696/698) has **no box-shadow binding**, so no ring ever shows inside the sheet. Do not add one.
   - Its tap handler is a no-op.
2. **Row spec** (shared by the selected row and all candidate rows): flex, align center, gap 10, padding `8px 6px`, radius 12, cursor pointer, `:active` bg `var(--x-b2,#F2F2F4)`.
   - Slot chip: 44×**28**, radius 9, 11/600, slot colours, no ring.
   - Avatar: FSHeadshot **34**, or an empty 34×34 circle with `inset 0 0 0 1.5px var(--x-b3,#E5E5EA)`.
   - Text column (flex 1, min-width 0, gap 1):
     - Line 1: `short` name 14/600, nowrap ellipsis, colour nameC, then " " + meta 11/500 t3 ("WR · PHI (9)").
     - Line 2: 11/500 t3, nowrap ellipsis: game + " " + rank span (600, rkC). There is no rostered/start line here.
   - Right: **projection** 13/600, flex none. The sheet shows projections, not points.
3. **Divider**: flex, align center, gap 10, padding `14px 8px 6px`. A 1px line (flex 1, `var(--x-b3,#EBEBEE)`), then "Choose a player to swap" 12/600 t3, then another line.
4. Eligible starter rows, with no header.
5. If any bench row is eligible: "Bench" 13/600, padding `12px 8px 4px`, then the bench rows.
6. If nothing is eligible: "No eligible players for this slot" 13/500 t3, centered, padding `16px 8px`.

#### 2.3 Team view (V1)
Overlay: `position:absolute; left:0; right:0; top:50px; bottom:0; z-index:21`, flex column, bg `var(--x-b0,#fff)`.
- **Top bar**: flex none, height 52, padding `0 12px`, align center.
  - Back button: 36×36 circle, colour t1 `#1D1D1F`, `:active` bg `var(--x-b2,#F2F2F4)`. Chevron-left 18px, path `M10 3L5 8l5 5`, stroke 2.
  - No title.
- **Scroll**: flex 1, overflow-y auto, hidden scrollbar, padding `0 16px 28px` (content 358 wide). It is a block container, not flex.
  1. **Identity** (flex, align center, gap 14):
     - Avatar: 64×64 circle, bg = team colour, initial 24/600 #fff.
     - Column (flex 1, min-width 0, gap 2): team name 22/700, letter-spacing -0.02em, nowrap ellipsis; then "{@mgr} · {league name}" 13/500 t3, e.g. "@marcus · Sunday Funday League".
  2. **Stat tiles**: grid `repeat(4,minmax(0,1fr))`, gap 8, margin-top 16 (each about 83.5px).
     - Tile: padding 10, radius 14, bg `var(--x-b1,#F5F5F7)`, column gap 2, min-width 0. Value 15/700 nowrap in colour k.c; label 10/500 t3 nowrap.
     - Tiles in order: "Record", "Rank", "Points for", "Streak".
     - Value colours: `var(--x-ink,#1D1D1F)` for the first three. Streak is `#07A852` for a W and `#FF0028` for an L.
  3. **Buttons**: grid `1fr 1fr`, gap 8, margin-top 14 (each 175px). Each is height 44, radius 999, flex centered, gap 7, 14/600, with no `:active` style.
     - **"Message"**: bg `var(--x-b2,#F2F2F4)`, colour t1. Chat-bubble icon 15px, stroke 1.6, path `M8 13.5c3.3 0 6-2.4 6-5.5S11.3 2.5 8 2.5 2 4.9 2 8c0 1.2.4 2.3 1.1 3.2L2.5 13.8l2.9-.9c.8.4 1.7.6 2.6.6z`.
     - **"Propose trade"**: bg `#0088FF`, text #fff. ICON.trade 15px, stroke 1.8.
  4. **Starters header** (flex, space-between, align center, margin-top 22): "Starters" 17/600; right "Week 5 · Proj {projTotal}" 12/500 t3. "Week 5" is literal.
  5. **Starter rows** (9):
     - Row: flex, align center, gap 10, padding `8px 0`, border-bottom 1px `var(--x-b2,#F2F2F4)`, cursor pointer, including on an Empty row whose tap is a no-op.
     - Slot chip: **40×26**, radius 8, 11/600.
     - FSHeadshot 34. It is always rendered, even for an Empty row, where it shows initials "E" and the tooltip "Empty" (V4, unreachable with seeded data).
     - Column (flex 1, min-width 0, gap 1): full name 14/600 ellipsis; meta 11/500 t3 ellipsis, `"{pos} · {team} · {game}"` (game defaults to "Sun 1:00 PM").
     - Right: projection 13/600 with 2 decimals ("–" if empty).
  6. **"Bench"** 17/600, margin-top 20; then 5 bench rows in the same spec with "BN" chips.
  7. **Recent moves header** (flex, space-between, align center, margin-top 22): "Recent moves" 17/600; "See all" 13/600 `#0088FF`, cursor pointer.
  8. **Move rows**:
     - Row: flex, align center, gap 10, padding `10px 0`, border-bottom 1px `var(--x-b2,#F2F2F4)`.
     - Kind pill: flex none, height 22, padding `0 8px`, radius 999, 11/600. "Added" = `var(--x-tg,#067A3E)` on `var(--x-gg,#E3F9EC)`. "Dropped" = `var(--x-tr,#C8001C)` on `var(--x-gr,#FFE9EC)`.
     - Player name 13/600, flex 1, nowrap ellipsis.
     - Date 11/500 t3, flex none ("Oct 10").
  9. **Empty state**: "No moves this season" 13/500 t3, padding `10px 0`.
  - **Scroll end**: after the content comes the `::after` dock spacer (inside the padding box), then the 28px bottom padding.
    - The spacer is **150px** when `scr==="league" && !prof && !trade && !settings`, otherwise **84px**.
    - It switches to 84px while a profile or the builder is open over the team view, and is 84px when the team view sits over Messages/Notifications.

#### 2.4 Trade detail (D1–D3)
Overlay: absolute, top 50, bottom 0, z 23, flex column, bg `var(--x-b0,#fff)`.
- **Top bar**: height 52, padding `0 12px`, flex, justify space-between, align center.
  - Close: 36×36 circle, colour t1, no bg, `:active` `var(--x-b2,#F2F2F4)`. X icon 16px, path `M4 4l8 8M12 4l-8 8`, stroke 2.2.
  - League tag (flex, align center, gap 6, 11/600 t3):
    - 20×20 square, radius 6, bg = current league avatar colour (Sunday Funday = `var(--x-ink,#1D1D1F)`), initials 9/600, always #fff.
    - Then the league **format** text `LEAGUES[lg].sub`, e.g. "12-team standard". It is not the league name.
- **Scroll**: flex 1, overflow-y auto, padding `4px 16px 24px`, flex column, gap 20. Measured: y 102–755.
  1. **Title block** (column gap 2):
     - "Trade offer" 26/700, letter-spacing -0.03em.
     - Subtitle 12/500 t3: `("Sent to you " | "You sent ") + time + (status==="Pending" ? " · expires in 2 days" : "")`.
  2. **Two side blocks** (my side first, then the opponent), each a column with gap 8:
     - Header row (flex, align center, gap 8):
       - Avatar: 28 circle, 11/600 #fff on the side colour.
       - Column (flex 1, min-width 0): name 14/600, ellipsis, cursor pointer; team name 11/500 t3, ellipsis.
       - Status pill: flex none, height 24, padding `0 10px`, radius 999, flex gap 5, 11/600, with an 11px icon at stroke 2.2. Measured "Pending" pill is 76.7px wide.
     - Asset card: grid `minmax(0,1fr) minmax(0,1fr)` (179 + 179), radius 14, bg `var(--x-b1,#F5F5F7)`, overflow hidden.
       - Left cell: padding `10px 12px 12px`, column gap 8, min-width 0, border-right 1px `var(--x-b3,#E5E5EA)`. Label "Receives" 11/600 `#07A852`, then asset rows.
       - Right cell: same padding, no border. Label "Sends" 11/600 `#FF0028`, then asset rows.
       - Asset row: flex, align center, gap 8, cursor pointer.
         - Player: FSHeadshot 36.
         - Draft pick: 36×36 circle, bg `var(--x-b3,#E5E5EA)`, calendar icon (ICON.sched path) 16px, stroke 1.5, colour `var(--x-t2,#3A3A3C)`.
         - Text column (flex 1, gap 1): label 13/600, nowrap ellipsis; meta 10/600 nowrap in posC.
           - A player shows the short name + "WR · ATL" in POSTXT.
           - A pick shows "2026 3rd round" (" round pick" replaced with " round") + "Draft pick" in `var(--x-t3,#6E6E73)`.
  3. **Hide toggle row** (flex, justify flex-end, align center, gap 10; the whole row is tappable):
     - Text: "Hide usernames for screenshots" 12/500 t3, right-aligned.
     - Switch: 40×24, radius 999, padding 2, border-box. Track `#07B85A` when on, `var(--x-b3,#E5E5EA)` when off, `transition:background .2s linear`.
     - Knob: 20×20 circle, `var(--x-b0,#fff)`, shadow `0 1px 2px rgba(0,0,0,.2)`. It is positioned by `justify-content: flex-end` (on) / `flex-start` (off), so it jumps rather than slides.
  4. **Message chip**: align-self flex-start, height 32, padding `0 12px`, radius 999, flex gap 6, 13/600 t1 on `var(--x-b2,#F2F2F4)`, chat-bubble icon 13px at stroke 1.6.
     - Label "Message {@mgr}", e.g. "Message @marcus" (measured 158.2px wide).
     - It keeps the @handle even when usernames are hidden.
  - **Scroll end**: the `::after` dock spacer is a flex item, so it adds the 20px gap **plus** 84px (the detail always sits over Messages or Notifications, so `dock-sm` applies), then the 24px bottom padding.
- **Footer** (flex none, outside the scroll). Exactly one of:
  - **D1, incoming pending**:
    - Container: grid `1fr 1fr 1fr`, gap 8, padding `12px 16px 28px`, border-top 1px `var(--x-b3,#EBEBEE)`. Measured: footer y 755–844 (89px); buttons 114×48 at y 768.
    - Buttons are 48 tall, radius 999, 15/600, no `:active` style:
      - **"Decline"**: `var(--x-tr,#C8001C)` on `var(--x-gr,#FFE9EC)`
      - **"Counter"**: t1 on `var(--x-b2,#F2F2F4)`
      - **"Accept"**: #fff on `#07B85A`
  - **D2, outgoing pending**: same padding and border. One full-width "Withdraw offer" 48px pill, `var(--x-tr,#C8001C)` on `var(--x-gr,#FFE9EC)`, 15/600.
  - **D3, finished**: padding `14px 16px 30px`, same border, centered text 13/600:
    - Accepted: "Trade accepted · players move after the review period" in `#07A852`
    - Declined: "This offer was declined" in `var(--x-t3,#6E6E73)` (also shown after "Withdraw offer", which stores "Declined")

Status pills (fg/bg):

| Trade state | My side | Their side |
|---|---|---|
| Incoming pending | "Pending" `var(--x-to,#B25C00)`/`var(--x-go,#FFF3E6)`, clock icon | "Sent offer" `var(--x-tg,#067A3E)`/`var(--x-gg,#E3F9EC)`, check icon |
| Outgoing pending | "Sent offer" (green, check) | "Pending" (orange, clock) |
| Accepted | "Accepted" green, check | same |
| Declined | "Declined" `var(--x-tr,#C8001C)`/`var(--x-gr,#FFE9EC)`, X icon | same |

Icon paths: clock `M8 4v4l2.5 1.5M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z` · check `M3 8.5l3.2 3L13 4.5` · X `M4 4l8 8M12 4l-8 8`.

#### 2.5 Trade builder, pick step (B1)
Overlay: absolute, top 50, bottom 0, z 24, flex column, bg `var(--x-b0,#fff)`.
- **Top bar**: flex none, height **48**, flex, align center, gap 8, padding `0 12px`.
  - Close: 36×36 circle, bg `var(--x-b2,#F2F2F4)`, colour inherits t1. X 14px, stroke 2.2.
  - Title "Propose a trade" 16/600, centered, flex 1.
  - Right spacer 36px.
- **Instruction**: "Pick players from both rosters" 13/500 t3, padding `0 16px 10px`.
- **Opponent chip row**: flex none, flex, gap 6, overflow-x auto, hidden scrollbar, padding `0 16px 12px`.
  - Its style has no `overflow-y`, so it gets no dock spacer.
  - It holds 11 chips: every team except mine, in TEAMS order.
  - Chip: flex none, height 32, padding `0 12px 0 4px`, radius 999, flex, align center, gap 6, 12/600 nowrap.
  - Avatar: 24 circle, initial 10px (weight 600 inherited), #fff on the team colour. Then the team name.
  - Selected: bg `var(--x-ink,#1D1D1F)`, text #fff. Unselected: `var(--x-b2,#F2F2F4)`, t1.
  - **Gridiron Gurus edge case:** its avatar colour is also `var(--x-ink,#1D1D1F)`. When it is the selected chip, the 24px avatar circle disappears into the chip and only the white "G" shows (also in dark: `#4D4D4D` on `#4D4D4D`).
- **Team heads**: grid `1fr 1fr`, gap 10, padding `0 16px 8px`. These columns line up with the grid below. Each head: flex, align center, gap 8.
  - Avatar: 28 circle, 11/600 #fff on the team colour.
  - Column: team name 13/600 ellipsis; "{record} · {ord(rank)}" 11/500 t3 (e.g. "2-6 · 11th", "8-0 · 1st").
  - Left = my team, always `TEAMS[0]` (literal "Touchdown Tacos", "T", `#0088FF`; it ignores the My team rename). Right = the selected opponent.
- **Roster grid**: scroll area (flex 1, min-height 0, overflow-y auto), padding `0 16px 16px`, `display:grid; grid-template-columns:1fr 1fr; gap:10px; align-content:start`.
  - Measured grid top: y 204. Each column is about 174px and is a flex column with gap 6. Left = my players, right = the opponent's players.
  - **Scroll end:** the `::after` dock spacer (84px, `dock-sm` while a trade is open) becomes a grid item in a new row, column 1. It adds the 10px row gap + 84px before the 16px bottom padding (measured: 110px of extra scroll below the last tile).
  - Tile: position relative, padding `8px 10px`, radius 12, cursor pointer, column gap 1, min-width 0.
    - Unselected bg is literal **`#F5F5F7`** with no ring. Selected bg is literal **`#E6F2FF`** plus `box-shadow: inset 0 0 0 1.5px #0088FF`. The README selection ring is 2px; see §7.
  - Line 1: meta "QB · CLE (9)" 10/600 in POSTXT.
  - Line 2: short name 14/600, nowrap ellipsis, padding-right 22 to clear the check.
  - Line 3: "Age 26" ("Defense" for D/ST) 10/500 `var(--x-t3,#6E6E73)`.
  - Check circle: absolute, top 8, right 8, 20×20 circle.
    - Selected: bg `#0088FF`, no ring.
    - Unselected: bg `#fff` with `inset 0 0 0 1.5px #C7C7CC`.
    - Check `M3 8.5l3.2 3L13 4.5`, 10px, stroke 3, #fff (invisible on the white unselected circle).
- **Footer**: flex none, padding `12px 16px 28px`, border-top 1px `var(--x-b3,#EBEBEE)`, column gap 10, bg `var(--x-b0,#fff)`.
  - Measured: y 727–844 (117px) with no badge. The 20px badge grows the summary row from 18 to 20px, giving 119px (top y 725).
  - Summary row (flex, align center, gap 8):
    - "Trade proposal" 15/600.
    - Count badge (only when count > 0): min-width 20, height 20, padding `0 6px`, radius 999, 11/600 #fff on `#0088FF`. It shows the total selected across both sides.
    - Summary text (flex 1, right-aligned) 12/500 t3: `"{mine.length} for {theirs.length}"` when ready (e.g. "1 for 1"), otherwise "Pick players on both sides".
  - **"View proposal"**: 48px pill (measured y 768–816), 15/600, no `:active` style. Ready: bg `#0088FF`, text #fff. Not ready: bg `var(--x-b3,#E5E5EA)`, text `var(--x-t3,#6E6E73)`.

#### 2.6 Trade builder, review step (B5)
Same overlay and top bar ("Propose a trade" with X). The instruction, chips and heads are not rendered.
- **Scroll**: flex 1, overflow-y auto, padding `0 16px 16px`, flex column, gap 20.
  1. **"Edit players"**: align-self flex-start, height 30, flex, gap 4, 13/600 `#0088FF`, chevron-left 12px `M10 3L5 8l5 5` at stroke 2.2.
  2. **Expiry row** (flex, space-between, align center, gap 10):
     - "Offer expires in" 14/600.
     - Native `<select>`: height 32, padding `0 10px`, border 0, radius 999, bg `var(--x-b2,#F2F2F4)`, inherited font 13/600 t1, cursor pointer. The native arrow is kept (no `appearance` reset).
     - Options: **"Never"** (default), "1 day", "2 days", "1 week".
  3. **Two side blocks** (my team, then the opponent), each a column with gap 8:
     - Header: avatar 26 circle (11/600 #fff on the team colour) plus team name 14/600. There is no record and no status. My side is `TEAMS[0]`, not `myName`.
     - Grid `1fr 1fr`, gap 8. Two columns, each flex column with gap 6:
       - "Receives" 11/600 `#07A852` + chips
       - "Sends" 11/600 `#FF0028` + chips
     - Chip: flex, align center, gap 8, padding 8, radius 12, bg `var(--x-b1,#F5F5F7)`.
       - FSHeadshot 30.
       - Short name 13/600 ellipsis.
       - Meta "QB · BUF" 10/600 in POSTXT, with no bye week.
     - Chips are not tappable.
  4. **Two toggle rows** (flex, align center, gap 10; the whole row is tappable):
     - Text column (flex 1, gap 1): label 14/600, sub 11/500 t3.
     - Switch: 44×26 (border-box), radius 999, padding 2. Track `#07B85A` when on, `var(--x-b3,#E5E5EA)` when off, `background .2s linear`.
     - Knob: 22×22, `var(--x-b0,#fff)`, shadow `0 1px 2px rgba(0,0,0,.2)`, positioned by justify-content.
     - Rows:
       - "Hide team names" / "For sharing screenshots" (default **off**)
       - "Send a direct message" / "Notify {@mgr} in your messages" (default **on**). The @handle stays visible even when "Hide team names" is on.
  - **Scroll end:** the `::after` spacer is a flex item, so it adds the 20px gap + 84px, then the 16px bottom padding.
- **Footer**: flex none, padding `12px 16px 28px`, border-top 1px `var(--x-b3,#EBEBEE)`. **"Send trade proposal"** 48px pill, bg `#0088FF`, text #fff 15/600, `:active` bg `#0074DB`.

### 3. Interactions

**Team tab**

| Element | Gesture | Effect |
|---|---|---|
| Slot chip (any starter/bench row, filled or empty) | tap | `set({sheet:"swap", swapFor:{t:"s"\|"b", i}})` → swap sheet opens; that row's chip gets the blue ring (visible only if above the panel) |
| Text column of a filled row | tap | `openProf(name)` → player profile overlay (z 22) with tab "summary", year "2026" |
| Text column of an Empty row | tap | same as the slot chip (opens swap) |
| Headshot, points column, "Week 5" | – | not interactive |
| Schedule tile | tap | toast "Not part of this prototype" |
| Trade tile | tap | `openTrade(1, [])` → builder against **Gridiron Gurus**, nothing selected |
| Moves tile | tap | `set({scr:"trans", tMine:true, tType:"All"})` → "My moves" transactions screen; its X (`backTeam`) returns to the Team tab |
| News tile | tap | toast "Not part of this prototype" |

**Swap sheet**
- **Closing.** Tapping the backdrop calls `closeSheet`, which sets **only** `sheet:null`. `swapFor` keeps its old value; this is harmless because the ring also requires `sheet==="swap"`. Taps inside the panel are swallowed (`stopPropagation`). No animation.
- **Selected row.** It has a pressed state but does nothing.
- **Tapping a candidate.** `doSwap` exchanges the two values between the slots/bench arrays and sets `{sheet:null, swapFor:null}`. It then shows a toast:
  - Both filled: "Swapped {short(a)} and {short(b)}" (e.g. "Swapped A.J. Brown and J. Williams").
  - Selected player into an empty target: "Moved {short(a)} to bench" (bench target) or "Moved {short(a)} to {SLOT}" (starter target). SLOT is the raw code: "WR", "FLEX", "DST".
  - Empty selected slot: "Moved {short(b)} to {selected SLOT}" if the selected slot is a starter (e.g. "Moved S. Sanders to QB"), otherwise "Moved {short(b)} to bench".
- **Bench-to-bench moves are allowed.**
  - Example: a filled bench player into the empty bench slot gives the toast "Moved K. Bourne to bench".
  - The bench array becomes `[null, Allgeier, Dotson, Stevenson, Kincaid, Bourne]`, so the "Empty" row now renders **first**. Likewise, an Empty bench slot can pick a filled bench player.
- **Eligibility rule**, where a = the selected value, sa = its slot, b = the target value, s2 = its slot:
  - The target must be a different slot, and a and b cannot both be empty.
  - `fits(s2,a) && fits(sa,b)`, where `fits(slot,p)` is true if p is empty, or slot is BN, or slot is FLEX and pos is RB/WR/TE, or pos === slot.
  - Bench list: eligible filled bench slots plus **only the first** empty bench slot.
  - Order: starters in SLOTS order, then bench in bench order.
- **Resolved examples** (default roster; all verified headless):
  - **QB S. Sanders** → no starters; Bench: Empty.
  - **RB1 B. Robinson** → starters RB J. Conner, FLEX I. Pacheco; Bench: T. Allgeier, R. Stevenson, Empty.
  - **RB2 J. Conner** → starters RB B. Robinson, FLEX I. Pacheco; Bench: T. Allgeier, R. Stevenson, Empty.
  - **WR1 A.J. Brown** (the jump default) → WR J. Williams; Bench: K. Bourne, J. Dotson, Empty.
  - **WR2 J. Williams** → WR A.J. Brown; Bench: K. Bourne, J. Dotson, Empty.
  - **TE E. Engram** → Bench: D. Kincaid, Empty.
  - **FLEX I. Pacheco** → RB B. Robinson, RB J. Conner; Bench: all 5 + Empty.
  - **K / D/ST** → Bench: Empty only.
  - **BN K. Bourne** or **BN J. Dotson** → WR A.J. Brown, WR J. Williams, FLEX I. Pacheco; Bench: the other 4 + Empty.
  - **BN T. Allgeier** or **BN R. Stevenson** → RB B. Robinson, RB J. Conner, FLEX I. Pacheco; Bench: the other 4 + Empty.
  - **BN D. Kincaid** → TE E. Engram, FLEX I. Pacheco; Bench: the other 4 + Empty.
  - **BN Empty** → all 9 starters; Bench: the 5 filled bench players.
  - **QB Empty** (after Sanders was moved to the bench) → no starters; Bench: S. Sanders only. Tapping it toasts "Moved S. Sanders to QB".
- **Per-player values travel with the player.** Opponent rank, rostered % and start % are looked up by player name (`MINE.findIndex`), not by slot.
  - A starter moved to the bench keeps his OPRK rank and fixed ownership numbers (A.J. Brown on the bench still shows "98% rostered · 91% start" and "(8th)" in red).
  - A bench player moved into a starting slot keeps his seeded values (K. Bourne at WR shows "32% rostered · 12% start" and "(4th)").
- **No lineup lock.** Players whose games are Final or in progress can still be moved. The README says lineups lock at kickoff; see §7.
- **Where swaps do and don't show:**
  - Swaps do not change the summary card (Proj, win%), which is literal.
  - **Swaps do not reach the Match tab.** `compare` uses `lineupOf(0)`, which returns the static `MINE`, not `s.slots`. After moving A.J. Brown to the bench, the Team tab shows WR1 "Empty" while the Match tab still shows A.J. Brown at WR1 (verified).
  - The builder's "mine" column does reflect the new arrangement.

**Team view**
- Back chevron → `teamView:null`. You land on whatever screen was underneath: a league tab, Messages, or Notifications.
- **Starter/bench row** → `openProf(name)`. The profile (z 22) opens above the team view; closing it returns here. An Empty row (code path only) is a no-op despite `cursor:pointer`.
  - Profile action button, per player (`ownerOf`, L1249):
    - Players on teams 2–11's generated rosters are mostly unknown to `ownerOf`, so their profile says **"Free agent"** with a green `#07B85A` **"Add"** button (toast "Added {name}"), even though the same players are tradeable in the builder.
    - Exceptions: players tagged to that manager in TREND/LEAD (e.g. Jaydon Blue → Priya) show blue "Propose trade".
    - Jordan Love (AVAIL waiver, on the benches of teams 9 and 11) shows "On waivers" with a gold `#C98A1F` "Claim off waivers" button.
    - Gridiron Gurus players all resolve to "Propose trade".
- **Message** → `teamView:null`, then:
  - If a DM exists for that team (Gridiron Gurus/@marcus, Priya's Punters/@priya, End Zone Elite/@devin, Leo's Lions/@leo, Hail Marys/@nina, Raj's Rushers/@raj), `openConvo(id)` opens that thread: `scr:"thread"`, unread cleared, draft cleared.
    - `openConvo` does **not** set `prevScr` or `dmFilter`.
    - The thread's back chevron (`goDms`) goes to the Messages list.
    - Messages' back arrow (`backFromDms`) then goes to `s.prevScr`. That is whatever screen Messages/Notifications were last entered from (initial value "league"), not necessarily the screen the team view sat on. Example: team view over League, with `prevScr` "home", ends up on Home.
  - Otherwise it shows the toast "New message to {@mgr}" (Sam's Sleepers, Blitz Brigade, Fourth & Long, Red Zone Rebels, Maya's Mavericks), and you land on whatever was under the team view.
- **Propose trade** → `openTrade(ti, [])`. The builder (z 24) opens over the team view with that team preselected and nothing selected.
- **See all** → `teamView:null, scr:"trans", tMine:false, tType:"All", tTeams:[ti]` → "League transactions" filtered to that team. Its X (`backTeam`) goes to the **Team tab**, not back to the team view.
- Identity, stat tiles and move rows are not interactive.

**Trade detail**
- X → `tradeOpen:null`. You return to Messages (with its current filter) or Notifications, whichever was underneath.
- **Opponent name** → `tradeOpen:null`, then `openTeam(ti)` → team view.
  - `scr` is unchanged, so the team view opens over Messages/Notifications.
  - Its back chevron returns to that screen (Messages › Trades if you came from a Trades row; Notifications if from there), **not** to the trade detail.
  - My own name is a no-op, even though it has `cursor:pointer`.
- **Player asset** → `openProf(name)`. The profile is z 22, **under** the trade detail (z 23), so nothing visible happens until the detail is closed. **Pick asset** → no-op.
- **Hide toggle row** flips `tdHide`. When on:
  - Names become "Team 1" (me) and "Team 2".
  - The team line is blank.
  - Avatars show "1" and "2" in the same colours.
- **Message chip** → `tradeOpen:null`, then `openConvo(id)` opens the DM thread with that manager.
  - `dmFilter` is not reset, so the thread's back chevron lands on Messages with the **Trades filter still on**.
  - `prevScr` is not touched, so Messages' back arrow goes to the screen Messages/Notifications were entered from.
- **Decline** → status "Declined", detail closes, toast "Trade declined".
- **Accept** → status "Accepted", detail closes, toast **"Trade accepted with @marcus"** (`tm.mgr`, with "@").
- **Counter** → detail closes, then the builder opens at the pick step with:
  - opponent = that team;
  - their side = the players they offered (non-pick);
  - my side = the players they asked for (non-pick).
  - Example, Marcus: theirs [Darnell Mooney], mine [James Conner]; the 2026 3rd is dropped.
  - **Edge case, Nina's offer:** the builder state is `{opp:7, theirs:["Jake Bates"], mine:["Cairo Santos"]}`.
    - Jake Bates is not in `rosterOf(7)` and Cairo Santos is not on my roster, so **no tile is highlighted in either column**.
    - The footer still shows badge "2", "1 for 1" and a blue, ready "View proposal".
    - These invisible selections cannot be deselected.
    - Picking another opponent chip clears only `theirs`, so "Cairo Santos" stays in `mine` and appears in my Sends on review.
- **Withdraw offer** → status "Declined" (there is no "Withdrawn" status), closes, toast "Offer withdrawn". Reopening it shows the "Declined" pill and "This offer was declined".
- **Effects are status-only.**
  - Accept/Decline/Withdraw only write `tradeStatus[id]`.
  - **Rosters never change.** After accepting Marcus's offer, James Conner stays in my lineup and Darnell Mooney is not added.
  - `tradeStatus` also drives Messages › Trades rows and the Trades pending count.
  - The inline Messages › Trades buttons use different toasts:
    - Accept: **"Trade accepted with Marcus"** (display name, no "@")
    - Decline: "Trade declined"
    - Counter: opens an empty builder for that manager

**Trade builder**
- X on either step → `trade:null`. Whatever was underneath shows again: Team tab, team view, player profile or Messages.
- **Opponent chip** → `setT({opp: ti, theirs: []})`.
  - Their selections are cleared; mine are kept. No auto-scroll.
  - Tapping the **already-selected** chip runs the same call, so it silently clears all of their selected players.
- **Tile** → adds or removes that player in `mine` (left) or `theirs` (right).
  - Selection order is kept and is the order shown on review.
  - There is no maximum and no roster or position validation.
- **View proposal**: if ready, goes to `review:true`. If not, shows the toast "Pick at least one player from each team". There is no other disabled behaviour.
- **Edit players** → `review:false`, selections kept.
- **Expiry select** stores `exp`, with no other effect.
- **Toggles** flip `hide` / `dm`.
  - `hide` renames the review sides to "Team 1"/"Team 2" with avatars "1"/"2"; the "Notify @mgr…" sub-label is unaffected.
  - `dm` has no effect.
- **Send trade proposal** → `set({trade:null, prof:null})` and toast "Trade proposal sent to {@mgr}".
  - This also closes a player profile that was underneath.
  - A team view underneath stays open.
  - The proposal is not added to Messages › Trades.
- **Identity mismatch:** the builder heads and review sides use `TEAMS[0]` ("Touchdown Tacos", "T", `#0088FF`). The trade detail uses `s.myName` / `s.myAv` with a literal "D" initial. After a My team rename, the two disagree.

### 4. Navigation

**Entry points**

| Destination | Ways to get there |
|---|---|
| Team tab | Tab bar "Team" (2nd item): `{scr:"league", tab:"team", sheet:null, swap:null}` · `openTeam(0)` from tapping my team name on the Match card or my row in League › Standings (also clears teamView and tradeOpen) · Transactions screen X (`backTeam`) · jump "Team" |
| Swap sheet | Team tab slot chip or Empty row · jump "Swap player" (`swapFor {t:"s", i:3}` = WR1 A.J. Brown) |
| Team view | Match tab team-name tap (another team) · League › Standings row (another team) · Global search people result (league managers) · Trade detail opponent name. My team always goes to the Team tab instead. |
| Trade detail | Messages › Trades row · Notifications item 1 "Trade offer from Marcus" (sets `tradeOpen:"marcus"` over Notifications) · jump "Trade offer" (sets `scr:"dms"`, `dmFilter:"trades"`, `tradeOpen:"marcus"`) |
| Trade builder | Team tab "Trade" tile (Gridiron Gurus, empty) · Team view "Propose trade" · Player profile header "Propose trade" and Profile › Leagues "Trade" (owner team, that player preselected on their side) · Players-tab trade action for a player on another roster (preselected) · Trade detail Counter (both sides prefilled) · Messages › Trades "Counter" (empty builder for that manager) · jump "Propose a trade" (Gridiron Gurus; theirs Josh Allen, mine Shedeur Sanders) |

**Dock on the Team tab** (measured: switcher wrapper y 696–764, tab bar y 764–844). It overlays the bottom of the scroller, which runs to y 844 underneath it.
- **League switcher**:
  - Wrapper: flex none, position relative, z 4, margin-top -148px, padding `6px 8px`, bg `var(--x-dockA,rgba(29,29,31,.9))`.
  - Card: 56px tall (y 702–758), 374 wide, radius 10, overflow hidden, bg `var(--x-mini,#3A3A3C)`, box-shadow `inset 0 0 0 1px var(--x-miniline,transparent)`, white text, `touch-action:none; user-select:none; cursor:grab`.
  - Grab bar: 28×3, top 4, centered, radius 999, `rgba(255,255,255,.28)`.
  - Content (padding `6px 16px 0`, gap 10; moved by `translateX(lsDx)` and `opacity`):
    - League avatar 34, radius 10, 12/600, colour `lg.avFg` (#fff, or `#1D1D1F` on the gold Family Bragging Rights avatar).
    - "Touchdown Tacos" 14/600 + record "2-6" 12/500 `rgba(255,255,255,.62)`.
    - League name 11/500 at the same `.62` white.
    - Dots: 6px tall, active one 14px wide `var(--x-b0,#fff)`, others 6px `#636366`, gap 4, radius 999, `transition: width .2s linear`.
    - Chevron-up 14px `M4 10l4-4 4 4`, stroke 2, at `.62` white.
  - Gestures (pointer events):
    - **pointerdown**: records x/y, calls `setPointerCapture(pointerId)`, and sets `lsAnim:false` (no transition while dragging).
    - **pointermove**:
      - If |dx| > |dy|: `lsDx = clamp(dx, -140, 140)`. Content opacity is `max(.2, 1-|dx|/200)`, i.e. 0.4 at ±120 and 0.3 at ±140.
      - Otherwise, **as soon as dy < -24** (with |dy| ≥ |dx|), it opens the "Switch league" sheet immediately, during the move: `_ls=null`, `lsDx:0`, `sheet:"leagues"`. It does not wait for release.
    - **pointerup**, checked in order:
      1. |dx| > 50 and |dx| > |dy| → switch league. Swipe left (dx < 0) = next league (+1); swipe right = previous (−1), wrapping. The content animates out to ∓120px (`transform .14s linear, opacity .14s linear`). After 140 ms it swaps `lg`, jumps to ±120 on the other side with no transition, and animates back to 0 two animation frames later. Toast: "Switched to {team}" (e.g. "Switched to Dalton's Dynasty"). **The Team tab content does not change.**
      2. A tap (|dx| < 8 **and** |dy| < 8) or dy < -24 → opens the "Switch league" sheet.
      3. Anything else → animates back to 0 (`lsAnim:true, lsDx:0`).
    - **pointercancel** → animates back to 0.
- **Tab bar**:
  - Bar: flex none, position relative, z 4, height 80, padding `6px 8px 0`, bg `var(--x-barA,rgba(29,29,31,.94))`.
  - Items: flex 1, height 48, column, gap 3, cursor pointer. Icon 22px at stroke 1.5. Label 10/600.
  - Tabs and icons:
    - Match: `M2.5 4.5h4v7h-4zM9.5 4.5h4v7h-4zM8 3v10`
    - **Team**: ICON.players `M5.5 6.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5`
    - Players: ICON.search
    - League: ICON.leaders
    - Menu: `M2.5 4h11M2.5 8h11M2.5 12h11` (toggles the Menu sheet)
  - Colours: active `#fff`, others `#A1A1A6`.
  - **Team is highlighted whenever `scr==="league" && tab==="team" && sheet!=="menu"`.** When the Menu sheet is open, Menu is highlighted instead. Team stays highlighted while the swap sheet is open.
- **Home indicator**:
  - Geometry: 134×5, radius 999, `var(--x-b0,#fff)`, absolute, bottom 8 (y 831–836), centered, **no z-index**.
  - It paints **beneath** the z-index 4 tab bar (verified: the tab bar is the topmost element at that point).
  - Because the page underneath is also white (b0), it composites to the same colour as the surrounding bar. In practice it is **not visible**, in light or dark mode.
- **Scroll clearance**:
  - When the switcher shows, the phone root carries `dock-lg` and **every** vertical `.fsm-scroll` (any `.fsm-scroll` whose inline style contains `overflow-y`) gets a 150px `::after` spacer; otherwise `dock-sm`, 84px. This includes sheets and overlays.
  - The switcher shows (and the class is `dock-lg`) when `scr==="league" && !prof && !trade && !settings`. Otherwise the tab bar uses margin-top -80px and there is no switcher.

**What the dock does per overlay**
- **Swap sheet**: the dock stays rendered under the 32% backdrop, and Team stays highlighted. The sheet panel mounts instantly at the bottom edge over it (no slide or fade).
- **Team view, trade detail and trade builder** cover y = 50 to 844. The league header, switcher, tab bar and home indicator are all hidden behind them; there is no dock on these screens.
  - Opening the builder (or a profile) also flips the dock to its collapsed state (`dock-sm`, no switcher), but nothing is visible either way.
  - The tab bar's click handler does not clear `teamView`, `trade`, `tradeOpen` or `prof`, but it can't be reached while those cover it.
- **Back and close**:
  - Team view: chevron. You land on the screen underneath (league tab, Messages or Notifications).
  - Trade detail and builder: X.
  - Builder review: "Edit players" goes back one step.
  - There are no swipe-back gestures and no hardware-back handling.
- **Messages loop**: `goDms` / `goNotifs` store `prevScr` only when entered from a non-Messages screen. `openConvo` (used by team view Message and the trade detail Message chip) never sets it. `backFromDms` returns to `s.prevScr || "league"`.

**Z-order** (higher is on top; same z → later in DOM wins):

| Layer | z |
|---|---|
| Base screen | auto |
| Home indicator | auto (under the tab bar) |
| Dock (switcher, tab bar) | 4 |
| Sheets, incl. Swap (cover status bar) | 20 |
| Team view | 21 |
| Player profile | 22 |
| League settings | 23 |
| **Trade detail** | 23 (later in DOM than settings) |
| **Trade builder** | 24 |
| Settings sub-pages | 25 |
| Community detail | 26 |
| Composer | 27 |
| Player picker | 28 |
| Global search | 29 |
| Column tip | 30 |
| Toast | 30 (last) |

Consequences:
- Builder sits over team view and profile.
- The profile is over the team view, but **under** the trade detail.
- The `go()` jump helper clears sheet, prof, trade, settings, tradeOpen and teamView.

### 5. Data shown

**TEAMS** (index, name, @manager, record, streak, standing rank, avatar colour, PF). Initial = first letter of the name. Records are W-L. Streak is shown as "W8"/"L2"; ▲/▼ only appears elsewhere.

| # | Name | Manager | Record | Streak | Rank | Avatar | PF |
|---|---|---|---|---|---|---|---|
| 0 | Touchdown Tacos (me) | @dalton | 2-6 | 2L | 11 | `#0088FF` | 353.86 |
| 1 | Gridiron Gurus | @marcus | 8-0 | 8W | 1 | `var(--x-ink,#1D1D1F)` | 407.62 |
| 2 | Priya's Punters | @priya | 7-1 | 3W | 2 | `#9D70E9` | 421.56 |
| 3 | End Zone Elite | @devin | 6-2 | 6W | 3 | `#F75252` | 433.58 |
| 4 | Sam's Sleepers | @sam | 6-2 | 2L | 4 | `#ECAD48` | 398.14 |
| 5 | Blitz Brigade | @tara | 5-3 | 2L | 5 | `#5C7CE5` | 373.10 |
| 6 | Leo's Lions | @leo | 4-4 | 2W | 6 | `#07A852` | 382.80 |
| 7 | Hail Marys | @nina | 3-5 | 3L | 7 | `#FF8A00` | 377.44 |
| 8 | Fourth & Long | @chris | 3-5 | 1W | 8 | `var(--x-t2,#3A3A3C)` | 360.02 |
| 9 | Red Zone Rebels | @owen | 3-5 | 1L | 9 | `#00A6A3` | 351.90 |
| 10 | Maya's Mavericks | @maya | 2-6 | 1W | 10 | `#E5508A` | 340.18 |
| 11 | Raj's Rushers | @raj | 1-7 | 5L | 12 | `var(--x-t3,#6E6E73)` | 322.40 |

**Team summary card vs real data** (all literal; bind to real data):

| Card shows | Elsewhere in the prototype |
|---|---|
| "Proj 70.92" | Sum of my starters' projections = **105.85**; the Match card's my proj = **83.44** (MUPS[0]) |
| "72% win" | Match card says **66%** |
| "PF 12th" | TEAMS[0].pf 353.86 ranks **9th** of 12 |
| "2-6 · 11th" | matches TEAMS[0] (rec 2-6, rank 11) |
| "T" on `#0088FF`, "Touchdown Tacos" | ignores `myName`/`myAv` (My team rename) and the league switcher |

**Team tab rows** (state `slots` = MINE names, `bench` = BENCH_ME names + `null`).

Per-row formats:
- Meta: `"{POS|D/ST} · {TEAM} ({bye})"`.
- Ownership line: `"{rost}% rostered · {start}% start"`.
  - For the 9 MINE players these come from fixed arrays keyed by player name.
  - For anyone else they are seeded: rost = 20 + floor(r×70), start = max(1, rost − 20).
- Opponent rank: `"(" + ord + ")"`, using OPRK (by player name) for MINE players and a seeded 1–32 otherwise.
- **rkC**: green `#07A852` if rank ≥ **20**, red `#FF0028` if ≤ 10, otherwise orange `#FF8A00`. README and `tierOpp` use ≥ 23; see §7.
- Points: "–" when "-"; projections use 2 decimals.

| Slot | Player | Meta | Own line | Game | Rk (colour) | Pts | Proj |
|---|---|---|---|---|---|---|---|
| QB | Shedeur Sanders | QB · CLE (9) | 55% rostered · 47% start | Sun 1:00 PM vs DET | (13th) orange | – | 19.71 |
| RB | Bijan Robinson | RB · ATL (5) | 99% · 98% | W 19-17 vs PHI | (9th) red | 9.60 | 16.03 |
| RB | James Conner | RB · ARI (8) | 92% · 84% | Mon 8:15 PM @ LAR | (17th) orange | – | 13.88 |
| WR | A.J. Brown | WR · PHI (9) | 98% · 91% | Sun 4:25 PM vs SF | (8th) red | – | 12.59 |
| WR | Jameson Williams | WR · DET (8) | 76% · 38% | Final W 31-20 @ GB | (22nd) green | 26.30 | 11.40 |
| TE | Evan Engram | TE · DEN (12) | 62% · 39% | Sun 4:05 PM vs KC | (16th) orange | – | 8.24 |
| FLEX | Isiah Pacheco | RB · KC (10) | 88% · 70% | Q4 6:50 @ DEN | (5th) red | 4.10 | 9.90 |
| K | Jake Bates | K · DET (8) | 71% · 65% | Final W 31-20 @ GB | (28th) green | – | 8.10 |
| D/ST | Steelers D/ST | D/ST · PIT (5) | 44% · 30% | Sun 1:00 PM vs CLE | (3rd) red | – | 6.00 |
| BN | Kendrick Bourne | WR · ARI (8) | 32% · 12% | Sun 1:00 PM vs DET | (4th) red | – | 5.10 |
| BN | Tyler Allgeier | RB · ATL (5) | 50% · 30% | W 19-17 vs PHI | (28th) green | 3.20 | 6.80 |
| BN | Jahan Dotson | WR · PHI (9) | 89% · 69% | Sun 4:25 PM vs SF | (23rd) green | – | 4.20 |
| BN | Rhamondre Stevenson | RB · NE (14) | 48% · 28% | Sun 1:00 PM vs NO | (28th) green | – | 8.10 |
| BN | Dalton Kincaid | TE · BUF (7) | 53% · 33% | Mon 8:15 PM @ LAR | (17th) orange | – | 7.60 |
| BN | Empty | – | – | – | – | – | – |

STATUS ("Q" for James Conner) exists in the data but is not shown on these rows.

**Team view data**
- Record = `t.rec`. Rank = `ord(t.rank)`. Points for = `t.pf`. Streak = W/L + number.
- Subtitle = `t.mgr · LEAGUES[selected].name`. It follows the league switcher even though the roster does not.
- **Roster:**
  - Team 1 uses THEIRS (starters) + BENCH_THEM (bench).
  - Teams 2–11 are generated by `teamRoster(ti)`:
    - It fills SLOTS from `rosterOf(ti)` first, then from a seeded shuffle of all PDB players, excluding my roster and Gridiron Gurus' players.
    - It then fills a bench of RB, WR, WR/TE, QB, RB.
    - The exclusion set is per team, so teams do not exclude each other.
  - This is placeholder data, and players repeat across teams. **Baker Mayfield appears on all 10 generated team views**: starter on teams 2, 4, 5, 6, 9, 10, 11 and bench on 3, 7, 8.
  - Gaps in `rosterOf` are filled from the global pool. Hail Marys and Raj's Rushers start "Jets D/ST"; End Zone Elite starts K "Jake Elliott".
- **Projections:** row projection = PDB projection, or a seeded 5–13 when there is none, shown with 2 decimals. projTotal = sum of the starters' projections, `toFixed(2)`.
  - Header totals ("Week 5 · Proj …"): 1 Gurus 89.62 · 2 Priya 86.94 · 3 Devin 97.76 · 4 Sam 84.37 · 5 Tara 85.84 · 6 Leo 85.04 · 7 Nina 88.46 · 8 Chris 84.62 · 9 Owen 88.58 · 10 Maya 85.04 · 11 Raj 81.46.
- **Gridiron Gurus sample:**
  - Header: "Week 5 · Proj 89.62".
  - Starters: QB Josh Allen (QB · BUF · Mon 8:15 PM @ LAR, 22.23), RB Alvin Kamara 10.80, RB Jaylen Wright 9.45, WR Darnell Mooney 9.24, WR Adonai Mitchell 8.10, TE Cole Kmet 6.80, FLEX Braelon Allen 7.30, K Brandon Aubrey 8.70, D/ST Ravens D/ST 7.00.
  - Bench: Jordan Mason 9.10, Khalil Shakir 9.80, Rome Odunze 10.20, Tyler Warren 8.90, Justin Fields 14.60.
- **Recent moves:** TRANS rows whose manager matches, first 3 transactions (TRANS is stored newest first), flattened to one row per add/drop. Date = text before the comma ("Oct 11").
  - @marcus: Added Roschon Johnson · Dropped Jermaine Burton (Oct 10). **Inconsistent:** Roschon Johnson is not on the Gridiron Gurus team view; he appears on the benches of teams 4, 6 and 11.
  - @priya: Added Jaylen Wright · Dropped Jahan Dotson (Oct 9). Also inconsistent: Wright is on Gurus and Dotson is on my bench.
  - @devin: Added Malik Washington · Dropped Jordan Love (Oct 11)
  - @leo: Added Efton Chism III · Dropped Patriots D/ST (Oct 11)
  - All other teams: "No moves this season".

**Trade builder data**
- **Left column:** my current `slots` + `bench` (non-empty, 14 players), sorted by position QB → RB → WR → TE → K → DST. The sort is stable, so the original order is kept within a position.
- **Right column:** `rosterOf(opp)`, same sort.
  - Gridiron Gurus (14): J. Allen, J. Fields, A. Kamara, J. Wright, B. Allen, J. Mason, D. Mooney, A. Mitchell, K. Shakir, R. Odunze, C. Kmet, T. Warren, B. Aubrey, Ravens D/ST.
  - Teams 2–11: the manager's TREND/LEAD-tagged players plus the first 11 of a seeded shuffle of EXTRA. Only Priya (Jaydon Blue), Devin (Sean Tucker, Brock Purdy) and Nina (Dak Prescott) have tagged players.
  - Sizes: Priya 12, Devin 13, Sam 11, Tara 11, Leo 11, Nina 12, Chris 11, Owen 11, Maya 11, Raj 11.
  - Gaps: **Hail Marys and Raj's Rushers have no D/ST; End Zone Elite has no K.**
  - Example, Priya's Punters: Baker Mayfield, Jalen Hurts, Jaydon Blue, Chuba Hubbard, Jonathan Taylor, Kyren Williams, Garrett Wilson, Puka Nacua, Zay Flowers, Courtland Sutton, Harrison Butker, Eagles D/ST.
  - For teams 2–11, `rosterOf` is **not** the same roster the team view shows (`teamRoster`).
- **Ages** are seeded placeholders, 22–30 (e.g. Josh Allen "Age 22").
  - My column sample: S. Sanders Age 26, B. Robinson 28, J. Conner 22, I. Pacheco 27, T. Allgeier 28, R. Stevenson 28, A.J. Brown 25, J. Williams 29, K. Bourne 30, J. Dotson 27, E. Engram 27, D. Kincaid 25, J. Bates 26, Steelers D/ST "Defense".
- **Review sides:**
  - Mine: Receives = theirs, Sends = mine.
  - Opponent: Receives = mine, Sends = theirs.
  - Header = team name (not @handle), or "Team 1"/"Team 2" when hidden.

**Trade detail data** (TRADES: id, dir, what I get, what I give, status, time)

| id | dir | I receive | I send | Status | Time | Subtitle | Footer |
|---|---|---|---|---|---|---|---|
| marcus | in | Darnell Mooney, 2026 3rd round pick | James Conner | Pending | 8m | "Sent to you 8m · expires in 2 days" | Decline/Counter/Accept |
| nina | in | Jake Bates | Cairo Santos | Pending | 5h | "Sent to you 5h · expires in 2 days" | Decline/Counter/Accept |
| devin | out | Evan Engram | Rhamondre Stevenson | Declined | Tue | "You sent Tue" | "This offer was declined" |
| leo | out | Jahan Dotson | 2026 4th round pick | Accepted | Sep 24 | "You sent Sep 24" | green "Trade accepted · players move after the review period" |

- My side: "@dalton" (literal), team = `myName` ("Touchdown Tacos"), avatar = `myAv` with the literal initial "D".
- Opponent side: @handle, team name, team colour and initial.
- The opponent's Receives/Sends mirror mine.
- Pick label: "2026 3rd round" / "Draft pick".
- Cairo Santos is not in PDB, so he falls back to "WR · FA" in WR purple `#8656D8` with no headshot ring.
- **Sample-data inconsistencies (placeholder bugs):**
  - Nina's offer gives me Jake Bates, who is already my K, for Cairo Santos, who is not on my roster.
  - Devin's offer has me receiving Evan Engram, who is already my TE.
  - Leo's offer has me receiving Jahan Dotson, who is already on my bench.

**Real product data vs prototype placeholders**
- Real data: team names, @handles, avatars, records, streaks, standings, PF/PA ranks, projected points, win probability, lineups and slots, positions, NFL teams, byes, game status strings, opponent rank, rostered/start %, points, projections, player ages, trade offers (assets, direction, status, sent time, expiry), and transactions.
- Placeholder only: the seeded rosters, ages and percentages, and the literal summary card.

### 6. Dark mode
`.fs-dark` on the phone root sets the following values and `color-scheme:dark` (so the native `<select>` and its popup render dark).

| Variable | Dark value |
|---|---|
| `--x-t1` | `#FFFFFF` |
| `--x-t2` | `#D9D9D9` |
| `--x-t3` | `#B3B3B3` |
| `--x-t5` | `#727272` |
| `--x-b0` | `#121212` |
| `--x-b1` | `#282828` |
| `--x-b2` | `#333333` |
| `--x-b3` | `#3E3E3E` |
| `--x-b4` | `#575757` |
| `--x-ink` | `#4D4D4D` |
| `--x-tg` | `#1ED760` |
| `--x-tr` | `#FF6B6B` |
| `--x-to` | `#FFB340` |
| `--x-gg` | `#12301F` |
| `--x-gr` | `#3A1A1D` |
| `--x-go` | `#3A2A14` |
| `--x-mini` | `#090909` |
| `--x-miniline` | transparent |
| `--x-dockA` | `rgba(18,18,18,.86)` |
| `--x-barA` | `rgba(18,18,18,.92)` |

Resulting dark-mode appearance in this area:
- **Team tab**:
  - Summary card `#282828`; quick-action tiles `#121212`, pressed `#333333`; icons and labels white.
  - Win track `#3E3E3E`.
  - Row dividers `#333333`; empty avatar ring `#3E3E3E`; "Empty" text `#727272`; secondary text `#B3B3B3`.
  - FLEX chip `#4D4D4D` with white text.
- **Swap sheet**: panel `#121212`, handle `#575757`, selected card `#282828`, pressed rows `#333333`, divider lines `#3E3E3E`. The backdrop stays `rgba(0,0,0,.32)`.
- **Team view**:
  - Background `#121212`, stat tiles `#282828`.
  - Message button `#333333` with white text.
  - Added pill `#1ED760` on `#12301F`; Dropped pill `#FF6B6B` on `#3A1A1D`.
  - **The Record/Rank/PF values use `--x-ink`, so they render `#4D4D4D` on `#282828` (very low contrast).**
- **Trade detail**:
  - Asset card `#282828` with a `#3E3E3E` divider; pick circle `#3E3E3E` with a `#D9D9D9` icon.
  - Pending pill `#FFB340` on `#3A2A14`; Sent/Accepted `#1ED760` on `#12301F`; Declined `#FF6B6B` on `#3A1A1D`.
  - Decline `#FF6B6B` on `#3A1A1D`; Counter white on `#333333`.
  - Toggle off-track `#3E3E3E`; knob `#121212`, i.e. a dark knob.
  - Footer border `#3E3E3E`.
  - League tag avatar (Sunday Funday, `var(--x-ink)`) becomes `#4D4D4D` with white initials.
- **Trade builder**:
  - Close button bg `#333333`; unselected chips `#333333`; selected chip `#4D4D4D`.
  - Not-ready button `#3E3E3E` with `#B3B3B3` text.
  - Review chips `#282828`; select `#333333`; toggle knobs `#121212`.
- **Team avatars that use variables change in dark**, everywhere a team avatar shows (builder chips and heads, review headers, team view 64px avatar, trade detail avatars), always with a white initial:
  - Gridiron Gurus `var(--x-ink)` → `#4D4D4D`.
  - Fourth & Long `var(--x-t2)` → `#D9D9D9` (white initial nearly invisible).
  - Raj's Rushers `var(--x-t3)` → `#B3B3B3` (white initial nearly invisible).
  - The selected Gurus chip is `#4D4D4D` on `#4D4D4D`, so its avatar disappears.
- **Toast**: `#4D4D4D` background with white text.
- **Dock**:
  - Switcher wrapper `rgba(18,18,18,.86)`, card `#090909`, tab bar `rgba(18,18,18,.92)`.
  - **The active switcher dot uses `var(--x-b0)` → `#121212` on the `#090909` card, so it is effectively invisible.** The inactive dots stay `#636366`.
  - Home indicator `#121212`, under the bar, invisible.
- **Hardcoded colours that stay the same in dark mode** (so they may look wrong):
  - Builder tiles `#F5F5F7` / `#E6F2FF`. Their names inherit white text, so they become **white on near-white**. The tile age line `var(--x-t3)` becomes `#B3B3B3` on `#F5F5F7`; the POSTXT meta line stays readable.
  - The builder's unselected check circle `#fff` with `#C7C7CC` ring.
  - Position chips QB `#F75252`, RB `#5C7CE5`, WR `#9D70E9`, TE `#ECAD48`, K `#D2E8E8`, D/ST `#FFE75E` (only FLEX uses a variable).
  - BN chip `#EDEDF0` / `#1D1D1F`.
  - Swap-target ring gap `#fff`.
  - FSHeadshot `#EEEEF1` background, `#6E6E73` initials and `#fff` ring gap.
  - Team summary avatar `#0088FF`.
  - Receives `#07A852` / Sends `#FF0028` labels (the README's dark success/danger text is `#1ED760` / `#FF6B6B`).
  - rkC `#07A852` / `#FF0028` / `#FF8A00`; win% `#07A852`; accent `#0088FF`; green fills `#07B85A`.
  - Tab bar active `#fff` / inactive `#A1A1A6`.

### 7. Flags for engineers (prototype vs README, and data that must be bound)

| Topic | Prototype (code) | README / elsewhere |
|---|---|---|
| Toast dismiss | 1800 ms (L1624) | "about 2.2s" (README L131) |
| Sheet backdrop | `rgba(0,0,0,.32)` (L647) | `rgba(0,0,0,.4)` (README L130) |
| Opponent-rank colour | Team tab + swap sheet rkC: green ≥ **20**, red ≤ 10 (L1640) | README L54 and `tierOpp` (L1206): green ≥ **23** |
| Selection ring | Builder tile `inset 0 0 0 1.5px #0088FF` (L1757); swap target `0 0 0 2px #fff, 0 0 0 4px #0088FF` | README L76: `inset 0 0 0 2px #0088FF` |
| Position chip radius | 9px (Team tab, swap), 8px (team view) | README: position chips 4–5px |
| Lineup lock | none; Final and in-progress players can be swapped | README L133: "Lineups lock at kickoff" |
| Summary card | literal: Proj 70.92, 72% win, PF 12th | starters sum 105.85; Match card 83.44 / 66%; PF rank is 9th |
| Lineup ↔ Match tab | Team tab edits `s.slots` | Match tab reads static `MINE`, so edits never show there |
| My team identity | Builder: `TEAMS[0]`; trade detail: `myName`/`myAv` + literal "D"; summary card: literal | My team page edits `myName`/`myAv` |
| Trade outcomes | status only; rosters never change; withdraw → "Declined" | footer copy promises "players move after the review period" |
| Rosters | team view = `teamRoster`, builder = `rosterOf`, profile owner = `ownerOf`; all three disagree for teams 2–11 | one real roster per team |

---

### Open questions
- Dropped/refined critic claims after checking the source: (1) The toast does NOT overlap the top of 'View proposal'. Measured in a browser, the toast is at y 708–744 and 'View proposal' at y 768–816. The toast only covers the builder footer's top border (y 725–727) and the top ~4–6px of the 'Trade proposal' summary row. (2) 'Leo's Lions has no own TREND/LEAD players' is true but not unique: Sam, Tara, Chris, Owen, Maya and Raj have none either. Only Priya, Devin and Nina do. (3) 'Generated-roster players open a profile saying Free agent + Add' holds for most of them. Exceptions: TREND/LEAD-tagged players show 'Propose trade', and Jordan Love shows 'On waivers' / 'Claim off waivers'. (4) Empty team-view rows (tooltip 'Empty', no-op tap with cursor:pointer) exist only as a code path; every seeded team fills all 14 slots. (5) A team view opened from the trade detail returns to whichever screen was underneath: Messages › Trades when opened from a Trades row, or Notifications when opened from there.
- Dock spacer leaks into sheets and overlays. The .fsm-scroll ::after spacer (150px with the switcher, 84px otherwise) also lands in the swap sheet (each swap sheet ends with 150px of blank space), the team view, the trade detail and both builder scrollers. In the builder's 2-column grid it even becomes an extra grid cell (adding 10 + 84px). Copy this, or limit the spacer to scrollers that sit under the dock?
- The swap-target ring on the Team tab is usually hidden under the sheet panel. Only rows above the panel's top edge show it; for RB1, WR1, FLEX and all bench rows it is covered. Should the ring be kept, moved into the sheet, or dropped?
- Lineup swaps on the Team tab never reach the Match tab, which reads the static starting lineup. Should the Match tab read the live lineup?
- Accept, Decline and Withdraw only change the trade status; rosters never move, and a withdrawn offer is stored and shown as 'Declined'. What should happen to rosters after acceptance (the review period), and should withdrawn offers have their own status and copy?
- Profile opens behind the trade detail: tapping a player in the trade detail calls openProf, but the profile is z 22 and the detail is z 23, so nothing visible happens until the detail is closed. Should the profile open above the trade detail?
- Builder tiles break in dark mode: the tiles use literal #F5F5F7/#E6F2FF and a #fff/#C7C7CC check, while the names inherit white text, so dark mode shows white on near-white. Should these move to tokens (e.g. b1 and the blue tint var(--x-gb) #12263F)?
- Several dark-mode colours are near-invisible: team view stat values use --x-ink (#4D4D4D on #282828); the active league-switcher dot is #121212 on the #090909 card; and the Fourth & Long (#D9D9D9) and Raj's Rushers (#B3B3B3) avatars carry white initials. Should these use t1 or a dedicated token?
- Team tab summary card is literal markup: 'T' on #0088FF, 'Touchdown Tacos', '2-6 · 11th · PF 12th · PA 10th', Proj 70.92, 72% win. It conflicts with the Match tab (proj 83.44, 66% win), the starters' sum (105.85) and TEAMS PF rank (9th). It ignores the My team rename and doesn't change with the league switcher. What should it be bound to?
- Team identity differs across trade screens. The builder uses TEAMS[0] ('Touchdown Tacos', 'T', #0088FF). The trade detail uses myName/myAv with a literal 'D' initial and '@dalton'. Which identity source is correct?
- Opponent-rank colours on the Team tab and swap sheet use green at rank ≥ 20 (red ≤ 10, orange otherwise), while the README and tierOpp use green at ≥ 23. Which threshold is right?
- There is no lineup lock: players whose games are Final or in progress (Robinson, J. Williams, Pacheco, Bates) can still be swapped, though the README says lineups lock at kickoff. How should locked players look and behave?
- README vs prototype mismatches: the sheet backdrop is rgba(0,0,0,.32) in code vs .4 in the README; the toast lasts 1800 ms in code vs ~2.2 s in the README; the builder selection ring is 1.5px vs 2px; position chips use radius 9 (8 in the team view) vs 4–5px. Which values win?
- No overlay, sheet or builder step animates in the prototype, and the swap sheet has no close button or drag-to-dismiss. Should we add slide or fade transitions and drag-to-dismiss, or match the prototype exactly?
- The home indicator has no z-index and paints under the z 4 tab bar, so it is effectively invisible (white page under a 94%-opaque bar). Should it sit above the tab bar?
- The toast (y 708–744) sits on top of the league-switcher card on league screens and over the builder's footer edge. Should it be raised above the dock or footer?
- 'Withdraw offer' (outgoing pending) can't be reached with the sample data, and after withdrawing the footer says 'This offer was declined'. Is that the intended wording?
- The builder's 'Send a direct message' toggle and 'Offer expires in' select (default 'Never') do nothing, and a sent proposal doesn't appear in Messages › Trades. Meanwhile the trade detail always says 'expires in 2 days'. What are the real expiry options and default?
- Counter on an offer whose players aren't on the current rosters (e.g. Nina's: Jake Bates is not on Hail Marys' builder roster and Cairo Santos is not mine) creates invisible selections. No tile is highlighted, they can't be deselected, yet the button reads '1 for 1' and is ready. Should Counter drop or flag unavailable players?
- Tapping the already-selected opponent chip in the builder clears all of their picked players. Intended, or should it be a no-op?
- Sample data inconsistencies: outgoing trades list my own players under 'I receive' (Engram, Dotson); Nina's offer gives me Jake Bates, who is already my kicker; Cairo Santos is missing from the player data so he shows 'WR · FA'; Marcus's 'Added Roschon Johnson' doesn't match the Gurus roster; Baker Mayfield is on all 10 generated rosters. These look like placeholder bugs. Please confirm.
- For teams 2–11, three sources disagree: the builder's 'theirs' column uses rosterOf(), the team view uses teamRoster(), and the player profile uses ownerOf() (most of those players show as 'Free agent' with an Add button). Real data would use one roster. Confirm.
- Messages › Trades inline Accept toasts 'Trade accepted with Marcus' while the trade detail's Accept toasts 'Trade accepted with @marcus'. Which string?
- Navigation from overlays into DMs: the team view's and trade detail's Message actions open the thread without setting prevScr or resetting the Trades filter. Back from the thread lands on Messages (Trades filter still on), and back from Messages goes to whatever screen Messages was last entered from. Intended?
- Team view 'See all' goes to Transactions, but closing Transactions returns to my Team tab instead of the team view. Similarly, a team view opened from the trade detail goes back to Messages or Notifications, not to the trade detail. Intended?
- Team view 'Message' for a team with no existing DM (Sam's Sleepers, Blitz Brigade, Fourth & Long, Red Zone Rebels, Maya's Mavericks) only closes the view and shows a toast. Should it start a new DM thread?
- The trade detail's league tag shows the league format ('12-team standard') rather than the league name, and its initials are always white (even on the gold Family Bragging Rights avatar, where the switcher uses dark text). Intended?
- The Team tab 'Trade' quick action always opens the builder against Gridiron Gurus (this week's opponent) with nothing selected. Is that the intended default?
- The hide toggle copy differs between screens: 'Hide usernames for screenshots' in the trade detail vs 'Hide team names' / 'For sharing screenshots' in the builder. Also, neither hides the @handle in 'Message @marcus' or 'Notify @marcus in your messages'. Keep both, and should those handles be hidden?
- The 'Week 5' label on the Team tab isn't tappable but shares state with the Match tab's week arrows (1–17), and the team view's 'Week 5' is literal. Should the Team tab get its own week navigation?
- Selecting Gridiron Gurus in the builder's opponent chips makes its avatar vanish, because the chip's selected fill and the team colour are both var(--x-ink). Should the selected chip or the team colour change?

---

## Gap analysis vs the current app

## League › Team, swap, team view, trade builder, trade detail: gap analysis

**Worktree:** `/Users/chrisdaltas/Documents/Hadouken/.claude/worktrees/redesign-v7` (read-only)

### Files checked
- **Team page and lineup**
  - `src/app/app/(shell)/leagues/[leagueId]/team/[teamId]/page.tsx`
  - `src/components/leagues/team-page.tsx`
  - `src/components/leagues/lineup-editor.tsx`
  - `src/components/leagues/lineup-editor-ops.ts`
  - `src/components/leagues/my-team-ops.ts`
  - `src/components/leagues/team-transactions-panel.tsx`
  - `src/components/leagues/team-transactions-ops.ts`
  - `src/components/leagues/drop-player-dialog.tsx`
- **Trades**
  - `src/app/app/(shell)/leagues/[leagueId]/trades/page.tsx`
  - `src/components/leagues/trade-center.tsx`
  - `src/components/leagues/trade-builder.tsx`
  - `src/components/leagues/trades-ops.ts`
  - `src/lib/leagues/api/trades-service.ts`
  - `supabase/migrations/148_trades_core.sql`
  - `supabase/migrations/151_trade_execution.sql`
  - `supabase/migrations/162_trade_preview.sql`
- **League shell and nav**
  - `src/components/leagues/league-shell.tsx`
  - `src/components/leagues/league-shell-ops.ts`
  - `src/components/leagues/league-cells.tsx` (`WinProbMeter` is defined but used nowhere)
  - `src/components/layout/bottom-tabs.tsx`
  - `src/components/layout/more-sheet.tsx`
  - `src/components/layout/rail/messages-panel.tsx` (mock DMs)
  - `src/components/layout/rail/notifications-panel*.ts(x)`
  - `src/components/notifications/notification-href.ts`
- **Activity and player card**
  - `src/components/leagues/activity-page-ops.ts`
  - `src/components/leagues/activity-page.tsx`
  - `src/app/api/leagues/[id]/activity/route.ts` (supports a `team_id` filter)
  - `src/components/players/player-card-league-ops.ts`
- **Hooks and services**
  - `src/hooks/use-nfl-week-games.ts` (selects only id/home/away/kickoff/status)
  - `src/hooks/use-schedule.ts`
  - `src/hooks/use-standings.ts`
  - `src/hooks/use-leagues.ts`
  - `src/lib/leagues/api/standings-service.ts` (has PF/PA, no streak)
  - `src/lib/leagues/api/rosters-service.ts` (RosterPlayer has `bye_week`, no age)
- **Schema**: `src/types/database.ts`
  - `nfl_games` has scores, quarter, game_clock and status.
  - `players` has `birth_date`, `bye_week` and `headshot_url`.
  - `teams` has no colour or avatar column.
- **Primitives and flags**
  - `src/components/ui/sheet.tsx`
  - `src/components/ui/toast.tsx`, `src/components/ui/toaster.tsx` (duration 4500)
  - `src/hooks/use-toast.ts`
  - `src/lib/feature-flags.ts` (`leagues`, `messages` = mock)

### Key context
- **The app has one team route for both views.** `team/[teamId]` is both "My Team" (editable) and another team's page (read-only, `canEdit=false`). The spec's Team tab (T1) and Team view (V1) map onto that one route.
- **Trades are fully server-backed.** Built in M5: propose, accept, reject, cancel, counter, review and votes, a legality preview, deadline handling and execution. The prototype only changes a status, and its rosters never change. The app's real behaviour wins.
- **The prototype has no lineup lock; the app does.** The app enforces the per-player `game_lock`, which matches the README's "lock at kickoff". Keep the app's behaviour.
- **Two prototype bugs don't apply to the app.**
  - The Match tab showing stale lineups: the app's matchup reads the real lineups.
  - Rosters disagreeing between views: the app has one roster read.

### Team tab (T1)
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| League header: logo tile, Home button, league name, Search, Notifications + badge | restyle-only | `league-shell.tsx` (LeagueIdentity, mobile copy at page top); command palette (`useUIStore`); `rail/notifications-panel.tsx` | Today the mobile league header is identity + a horizontal sub-nav at the top of the page. |
| Messages icon + DM unread badge in the header | needs-new-backend | `rail/messages-panel.tsx` (mock, `featureFlags.messages`) | No DM tables or API. |
| No in-page tab strip; league dock tab bar (Match / Team / Players / League / Menu) | new-ui-on-existing-data | `league-shell-ops.ts` `leagueTabs`/`leagueMoreItems`; `bottom-tabs.tsx` is global (Home/Lists/Players/Search/More) | All target routes exist. Swapping the global bottom tabs for league tabs is an IA call (see the questions below). |
| Dock league switcher card: team name, record, league name, dots, swipe left/right to switch league, swipe up or tap opens "Switch league" sheet, "Switched to …" toast | new-ui-on-existing-data | `use-leagues.ts`, `use-standings.ts`, `leagues-index.tsx` | Nothing like it exists today. Gestures, animation and the sheet are all new. |
| Summary card: avatar, team name, "2-6 · 11th" | restyle-only | `team-page.tsx` header card; `league-shell.tsx` `useIdentity` (record and rank from standings) | Bind to real data. The prototype's card is literal text. |
| Summary card: "PF 12th · PA 10th" | new-ui-on-existing-data | `standings-service.ts` `points_for`/`points_against` | The ranks would be computed client-side from standings. |
| Summary card: "Proj 70.92" | restyle-only | `lineup-editor.tsx` projected total (`my-team-ops.ts projectedTotal`, `league_player_values`) | Use the real starters' total. |
| Summary card: "72% win" + bar | needs-new-backend | `WinProbMeter` in `league-cells.tsx` is unused | No win-probability model or data exists anywhere. |
| Quick action "Schedule" | restyle-only | `leagues/[leagueId]/schedule` | The prototype only toasts; the app has a schedule page to link to. |
| Quick action "Trade" | restyle-only | `tradesHref()` → trade center + builder | — |
| Quick action "Moves" | restyle-only | `TeamTransactionsPanel` on your own team page | It currently renders inline on the page, not as its own screen. |
| Quick action "News" | needs-new-backend | `home/injury-news-card.tsx` is mock | No player or team news feed is synced. |
| Starters header ("Tap a position to swap players", "Week N") | restyle-only | `team-page.tsx` WeekTabs + week picker | The app also has week tabs and past weeks. Keep them (prototype gap). |
| Lineup rows: coloured slot chip, headshot, full name, meta "RB · ATL (5)", points, projection | restyle-only | `lineup-editor.tsx` StarterRow/BenchRow, `PositionBadge`, `PlayerFace`, `RosterPlayer.bye_week`, box-score points, `league_player_values` | Mostly look-and-layout work (table → stacked rows). |
| Row line 2: "% rostered · % start" | needs-new-backend | `my-team-ops.ts`: "Rostered %" has no source and always reads "—" | No cross-league ownership or start % exists. It is also of doubtful value in a small test cohort (question). |
| Row line 3 game string ("Sun 1:00 PM vs DET", "W 19-17", "Final", "Q4 6:50") | new-ui-on-existing-data | `my-team-ops.ts opponentOf`; `use-nfl-week-games.ts` selects only id/home/away/kickoff/status | `nfl_games` already has `home_score`, `away_score`, `quarter`, `game_clock` and `status`. Extend the select; no new table needed. |
| Row line 3 opponent rank "(9th)" with colour | restyle-only | `oprkOf`, `oprkTone`, `OprkChip` (`defense_position_splits`) | The app uses its own tone bands; the prototype's ≥20/≤10 rule vs the README's ≥23 is moot. |
| Empty rows (starter and bench), including empty bench seats | new-ui-on-existing-data | Empty starter seats render "Empty"; the bench lists only rostered players | Empty bench count = bench size from `roster_settings` minus the roster. |
| Tap slot chip / Empty row → "Swap player" bottom sheet: selected card, "Choose a player to swap" divider, eligible starters, "Bench" section, "No eligible players for this slot" | new-ui-on-existing-data | Today a per-player Move dropdown + drag-and-drop (`MoveMenu`, `moveOptions`, `planMove` with displacement, autosave via `set_lineup`); `ui/sheet.tsx` side="bottom" | The sheet lists who can come into a slot; the app's logic lists where a player can go. Needs a small inverse ops function over `planMove`. Locked players must be excluded or marked locked. |
| Swap target ring on the chip | new-ui-on-existing-data | — | Purely visual. |
| Swap toasts ("Swapped X and Y", "Moved X to bench/WR") | restyle-only | `moveToastCopy` + `toast` | — |
| Bench-to-bench moves; bench order and position of the Empty row | out-of-scope-or-question | Bench is an unordered set (`slot_key 'bn'`) | No bench order is stored. Bench-to-bench is a no-op in the app. |
| No lineup lock in the prototype | restyle-only | `game_lock` / `lockedPlayerIds` / `LockTag` | Keep the app's lock (README agrees). Locked rows can't be swapped. |
| Tap player text → profile | restyle-only | `PlayerLink` (mini card, then Expand) | Player clicks open the mini card first (ruled 2026-10-05). |
| App-only team-page features not in the spec | restyle-only | `lineup-editor.tsx`, `team-page.tsx`, `team-commish-tools.tsx`, `team-transactions-panel.tsx` | Lineup check, matchup strip, Customize columns, save indicator, drag, IR/Reserve, injury tag, Drop, waiver/FAAB line, commissioner override/rename/autopilot/FAAB, Members door, loading/error/stale states. CLAUDE.md says keep them and restyle. |
| Dock scroll spacer (150 / 84 px) | restyle-only | — | Layout only. |

### Team view (V1, another team)
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Full-screen team view with back chevron | restyle-only | `team/[teamId]` read-only render | The app uses a route, not an overlay. |
| Identity: team name + "@mgr · league name" | restyle-only | `team-page.tsx` "Managed by `UsernameLink`"; `detail.league.name` | The @handle must link to the profile (ruled 2026-09-30). |
| 64px avatar in a team colour | out-of-scope-or-question | `teams` table has no colour or avatar; `Crest` = initials on grey | Decide: a derived colour (client-side) or a team colour/avatar managers choose (new column). Applies everywhere team avatars show. |
| Stat tiles: Record, Rank, Points for | new-ui-on-existing-data | `useStandings` (not read by the team page for other teams) | — |
| Stat tile: Streak (W/L + n) | new-ui-on-existing-data | `use-schedule.ts` matchups (week status + scores) | No streak field. Derive it from final weeks. |
| "Message" button | needs-new-backend | `messages-panel.tsx` mock | No DM backend. The fallback toast is prototype-only. |
| "Propose trade" button | restyle-only | `team-page.tsx` `data-propose-trade` → `tradesHref({teamId})` | The app hides it for your own team, an unmanaged team and after the deadline. Keep that. |
| Starters/bench rows (40×26 chip, headshot, name, "POS · TEAM · game", projection) + "Week N · Proj X" | restyle-only | `LineupEditor` with `canEdit=false` | — |
| Recent moves (Added/Dropped pills, date) + "No moves this season" | new-ui-on-existing-data | Activity API `GET …/activity?type=…&team_id=…` (`activity/route.ts`) | `TeamTransactionsPanel` is own-team only. |
| "See all" → league transactions filtered to that team | new-ui-on-existing-data | `activity-page.tsx` Adds & drops tab | The URL team filter exists only on the Commissioner tab. The API already supports `team_id`. |
| Player row → profile with an owner-based action (Add / Propose trade / Claim off waivers) | restyle-only | `player-card-league-ops.ts` (`cardLeagueView`, `acquireAction`, `whereLine`) | The real pool state replaces the prototype's buggy `ownerOf`. |

### Trade detail (D1–D3)
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Full-screen single-trade view (X, league tag + format text, "Trade offer", "Sent to you 8m" / "You sent …") | new-ui-on-existing-data | `trade-center.tsx` TradeCard list; `TradeView.created_at`; `identityLine` | No single-trade GET, so filter the trades list read. Today trades are cards on the Trades page. |
| "· expires in 2 days" | needs-new-backend | `151_trade_execution.sql` | Offers expire only at the trade deadline. There is no per-offer expiry. |
| Side blocks: avatar, @name (tap → team view), team name, per-side status pill ("Pending" / "Sent offer" / "Accepted" / "Declined") | restyle-only | `tradeSides`, `tradeStatusView`, `TeamNameLink` | `TradeTeamRef` has only the team name. Join the @handle from the league detail's members. The app's status set is richer: under review, waiting for games, completed, countered, called off, vetoed, expired, invalid. |
| Receives/Sends asset grid with headshots, short name, "WR · ATL" in position colour | restyle-only | `tradeSides` gives lists, `PlayerLink`, `PositionBadge` | "Receives" mirrors the other side's gives. FAAB legs and to-make-room drops are app-only; keep them. |
| Draft-pick assets ("2026 3rd round", "Draft pick") | out-of-scope-or-question | `148_trades_core.sql` `trade_items` = players + FAAB only | Redraft leagues have no future picks. Pick trading would need a product call and new backend. |
| "Hide usernames for screenshots" toggle | new-ui-on-existing-data | — | Client-only. |
| "Message @mgr" chip | needs-new-backend | Mock DMs | — |
| Incoming pending: Decline / Counter / Accept | restyle-only | `TradeButtons` ("Turn down" / "Counter" / "Accept"), `acceptGate` (162 preview), accept-with-drops picker | Keep the drops gate, deadline gate and the server's refusal wording. |
| Outgoing pending: "Withdraw offer" | restyle-only | "Call off offer" (`cancel`) | The app has a real `cancelled` status. Don't map it to "Declined". |
| Finished footer ("Trade accepted · players move after the review period" / "This offer was declined") | restyle-only | `tradeStatusView` detail, review tally, deferred badge | In the app, accepted trades really execute (151). |
| Commissioner review, league-vote tally, override approve/veto/force | restyle-only | `TradeButtons`, `CommishConfirm` | Not in the prototype. Keep them. |
| Notification "Trade offer from X" → this trade's detail | new-ui-on-existing-data | `notification-href.ts` sends `league_trade_*` to the trade center | The payload carries `trade_id`. Deep-link to the specific trade. |

### Trade builder (B1–B6)
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Full-screen builder (X, "Propose a trade", "Pick players from both rosters") | restyle-only | `trade-builder.tsx` (a Card inline on the Trades page) | — |
| Opponent chip row (horizontal scroll, avatar + name, ink when selected) | restyle-only | "Trade with" `Select` over `partners` | The list holds teams with a manager only (R1410). Keep that. |
| Team heads: avatar, name, "{record} · {rank}" | new-ui-on-existing-data | Standings read (the builder doesn't read it today) | — |
| Roster grid tiles: "QB · CLE (9)", short name, check circle, selected tint, sorted QB→DST | restyle-only | `PlayerPickRow` (checkbox list), `bye_week` | Keep the lock note on started players. |
| Tile "Age 26" / "Defense" | new-ui-on-existing-data | `players.birth_date` (not in the rosters read) | Fetch with `usePlayersByIds` or extend the rosters read. |
| Footer: "Trade proposal", count badge, "N for M" / "Pick players on both sides", "View proposal" | restyle-only | `builderProblem` / `builderGate` reason, Send button | The app allows one-sided offers when `allow_future_considerations` is on, and gates Send on the 162 preview. Make invalid offers impossible to send (disable the button) rather than allowing the tap and refusing it with a toast. |
| Two-step flow: pick → review ("Edit players", Receives/Sends chips per side) | new-ui-on-existing-data | `builderLegs`, `tradeSides` | The app is one step. |
| "Offer expires in" select (Never / 1 day / 2 days / 1 week) | needs-new-backend | — | No per-offer expiry. "Never" matches today's behaviour (expires at the deadline only). |
| "Hide team names" toggle | new-ui-on-existing-data | — | Client-only. |
| "Send a direct message" toggle ("Notify @mgr in your messages") | needs-new-backend | Mock DMs | The app already sends an in-app notification when you propose. |
| "Send trade proposal" + "sent" toast | restyle-only | `useProposeTrade`; the "Offer sent to X" card | — |
| Counter → builder prefilled (their offer → theirs, their ask → mine) | restyle-only | `counterSeed`, counter mode (teams fixed) | — |
| App-only builder features | restyle-only | `trade-builder.tsx`, `trade-center.tsx` | FAAB legs, drop picker for roster overflow, note, 162 legality preview, deadline lock, no-partner state, rosters-loading state. Keep and restyle. |
| Entry doors (Team tile, team view, profile "Propose trade", Players-tab trade with a preselected player) | restyle-only | `tradesHref(?with=&player=)`, `tradeDoorStep` | — |
| Sent offers listed in Messages › Trades with a pending count and inline Accept/Decline/Counter | out-of-scope-or-question | Trades live in league More › Trades (Pending/History); Messages is mock | Should trades also live in DMs? IA ruling needed. |

### Shared chrome
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Bottom sheet shell (backdrop .32, 24px top radius, grab handle, appears without animation) | restyle-only | `ui/sheet.tsx` side="bottom" | It currently slides in. |
| Toast (ink pill, bottom 100, ~1.8 s, a new toast replaces the old) | restyle-only | `ui/toast.tsx` (already a pill; `shadow-hard-8` allowed as an overlay), `toaster.tsx` duration 4500, `TOAST_LIMIT=1` | Only the duration and position need tuning. |
| Dark mode (`.fs-dark` vars) | out-of-scope-or-question | CLAUDE.md: single theme, no toggle | Don't build. |

### Spec flags resolved by the app
- **Lineup lock:** the app enforces it, as the README says.
- **Summary-card literals:** bind them to real reads.
- **Match ↔ Team sync:** already consistent in the app.
- **Trade outcomes:** real execution.
- **Withdraw:** a real `cancelled` status.
- **Roster disagreement across views:** one rosters read.
- **My-team identity:** the viewer's real team everywhere.
- **Opponent-rank colour bands:** use the app's `oprkTone`.
- **Selection ring and chip radii:** token decisions on v13 surfaces.
