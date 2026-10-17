## Player profile

**Source:** `/Users/chrisdaltas/Documents/Hadouken/design_handoff_fieldscout_mobile/FieldScout Mobile.dc.html`
- Markup: lines 749–822 (`<sc-if value="{{ hasProf }}">`).
- Binding: renderVals line 1754, which sets `hasProf: !!s.prof`, `pf: buildProfile(s.prof, s, { set, toast, openTrade })` and `closeProf: () => set({ prof: null })`.
- `openProf(n)`: line 1417, `setState({ prof: n, pfTab: "summary", pfYear: "2026", pfAvail: false })`.
- `buildProfile`: lines 1257–1303. `extraProf` (KS, games, leagues, transactions): lines 1305–1338.
- Data tables: SDEF / BIO / PDB / DEPTH / TC / TINT / STATUS (lines 1201–1232). genSeason / genStats / ownerOf: lines 1233–1253. `pinfo` (unknown-player fallback): line 1221. `bioOf`: line 1222.
- Headshot: `/Users/chrisdaltas/Documents/Hadouken/design_handoff_fieldscout_mobile/FSHeadshot.dc.html`.

**Merge order.** `buildProfile` returns one object and spreads `...extraProf(...)` in the middle of it (line 1295). The keys come from three places:
- **Set by `buildProfile` before the spread:** `name`, `first`, `last`, `team`, `head`, `tc`, `fg`, `sub`, `chipBg`, `hasStatus`, `status`, `statusBg`, `posL`, `posBg`, `posFg`, `teamLine`, `owner`, `bio`, `act`, `addList`, `availOpen`, `chev`, `toggleAvail`, `others`, `tabs`, and the gates **`isLgs`** (`tab === "leagues"`) and **`isTx`** (`tab === "tx"`).
- **From `extraProf`:** `name` (the same value, overwritten), `bioLine`, `strip`, `keyStats`, `keySub`, `ownDot`, `goLeagues`, `lgSummary`, `games`, `gRef`, `gPrev`, `gNext`, `col`, `lgs`, `txLgs`, `txAll`, `txNone`.
- **Set by `buildProfile` after the spread:** `isSum`, `isLog`, `isTeam`, `isHist`, `hasTable`, `tbl`, `kpis`, `projs`, `news`, `years`, `teamRanks`, `depth`, `txs`.

**Which binding shows each tab** (markup line in brackets):

| Tab | Binding |
|---|---|
| Summary | `pf.isSum` (765) |
| Leagues | `pf.isLgs` (786) |
| Transactions | `pf.isTx` (789) |
| Game log | year chips under `pf.isLog` (796), then the shared table under `pf.hasTable` (812) |
| Team | `pf.isTeam` (797) |
| History | `pf.isHist` (807), then the shared table under `pf.hasTable` (812) |

`tbl` is only non-null when the tab is `log` or `history`.

**Computed but never rendered (do not build):**
- `pf.first` and `pf.last` (line 1288). The markup only uses `pf.name`.
- `pf.bio` (`bioRow`).
- `pf.kpis`, and with it `ppr`, `ovr` and `start` (lines 1261–1263). These only feed `kpis`.
- `pf.projs`.
- `pf.others`.
- `pf.availOpen` / `chev` / `toggleAvail`. `pfAvail` is reset on open but has no UI.
- `g.res` / `g.resC` on game cards.
- `g.line` on cards where `hasLine` is false. It holds e.g. `"Matchup rank 12th vs RB"` (line 1320), but it is hidden.
- `tbl.k2W`.
- The third element `"attpg"` on the QB "Pass att/g" entry in the KS table (line 1307).

Token names follow the README. Where the markup uses `var(--x-b1,#F5F5F7)`, this spec writes **b1 #F5F5F7**.

---

### 1. Screens & states

| # | State | Exact condition |
|---|---|---|
| P0 | Profile overlay mounted | `s.prof != null` (`hasProf`). The value is the player's full name string. |
| P1 | Summary tab | `pfTab === "summary"` (`pf.isSum`). This is the default; `openProf` resets to it. |
| P1a | Key stats expanded / collapsed | Expanded when `!(s.pfCol \|\| {}).key`; collapsed when `pfCol.key === true`. |
| P1b | Games and projections expanded / collapsed | `pfCol.games` |
| P1c | Recent news expanded / collapsed | `pfCol.news` |
| P1d | News variant: injury | `STATUS[name]` exists. Data: James Conner "Q" and Justice Hill "Q" only. |
| P1e | News variant: returning from bye | Week 4 was a bye. Unreachable with 2026 data, because the generated 2026 bye is always Wk 6–14 (see §5 Bye week). |
| P1f | News variant: default | Otherwise. |
| P1g | Game card: played | `w.played && w.w < 5` (weeks 1–4 of 2026). |
| P1h | Game card: current week | `w.w === 5`. Two sub-states: points known (`p.pts && p.pts !== "-"`) or not. |
| P1i | Game card: upcoming | Weeks 6–18 that are not the bye. |
| P1j | Game card: bye | `w.bye` |
| P2 | Game log tab | `pfTab === "log"` (`pf.isLog` + `pf.hasTable`). Year sub-state `pfYear` is "2026", "2025" or "2024". The chips shown are `min(3, max(1, bio.exp))`, so rookies see only 2026. D/ST always has `exp 4`, so it always shows 3 chips. |
| P3 | Leagues tab | `pfTab === "leagues"` (`pf.isLgs`). Each row is one of: pre-draft, on your team, rostered by other, free agent, on waivers, rostered elsewhere. |
| P4 | Transactions tab | `pfTab === "tx"` (`pf.isTx`). Filter `pfTxLg` is `"all"`, 0, 1, 2 or 3; undefined is treated as `"all"`. |
| P4a | Transactions empty | `txAll.length === 0` (`pf.txNone`). Shows "No transactions in this league". Always the case for Joy to Us and Work League (pre-draft). Also the case for Sunday Funday League when the player is a free agent with no TRANS rows. Family Bragging Rights is never empty, because it always has a Drafted row. |
| P5 | Team tab | `pfTab === "team"` (`pf.isTeam`). The depth chart comes from `DEPTH[team]` for ATL, DET, CHI, PHI, KC and BUF; otherwise it is derived from PDB (§2.9, §5). |
| P5a | Team tab, empty depth chart | `depthOf(team)` returns `[]`, so the card shows only its header row ("Pos / Starter / 2nd / 3rd"). This happens for the unknown-player fallback (team "FA"). |
| P6 | History tab | `pfTab === "history"` (`pf.isHist` + `pf.hasTable`). |
| P6a | History, no transactions | The player is a free agent with no TRANS rows. Shows a single "None" row with "No transactions this season". |
| P7 | Unknown-player fallback | `PDB[name]` is undefined, so `pinfo()` (line 1221) returns `{ pos:"WR", team:"FA", bye:0, pts:"-", proj:"", game:"" }`. **Reachable today:** "Cairo Santos" is a trade-offer asset in TRADES (nina's offer, line 1195) and is not in PDB. Trade-detail assets call `openProf` (line 1829). The effects are listed below this table. |
| H1 | Header action variants | `own.kind === "mine"` gives Drop. `"other"` gives Propose trade. `"fa"` with `waiver` gives Claim off waivers. `"fa"` without it gives Add. |
| H2 | Injury status pill | Shown when `STATUS[name]` exists. "Q" shows "Questionable"; any other value shows "Out". Only "Q" exists in STATUS, so **the "Out" branch is unreachable** and there is no mapping for "IR" (it would render "Out"). |
| H3 | Light team colour | `isLight(tc)`, i.e. luminance `(R*299+G*587+B*114)/1000 > 160`. True only for PIT #FFB612 and NO #D3BC8D. Switches the header to dark text. |
| H4 | DST profile | `pos === "DST"`. Changes the bio line, the team line (no jersey number), the initials and the last name. `bioOf` returns `{ num:"", ht:"", wt:"", exp:4 }`, so there is no jersey number, height or weight, and Game log / History always show 3 year chips / 4 career rows. |
| T | Toast over the profile | `s.toast` is non-empty. The toast sits at z-30, above the profile. |

**Effects of the unknown-player fallback (P7):**
- Header background #3A3A3C (the `TC` fallback) with white text.
- Team line `"FA · #17"`, from the WR jersey range.
- WR key stats and a WR box score, even though Cairo Santos is a kicker.
- Strip `#17 / 15.0 / 59.8 / 79% (Rost -0.1) / 9`. The bye is 9 because `6 + ((0||3) % 8)`.
- The headshot has no team ring (§2.1). Initials "CS".
- Owner "Free agent", action "Add", `lgSummary` "Available in 1 league".
- The Team tab shows "Depth chart · FA" with a header-only card.
- Wk 5 opponent is random (no `p.game`) and Wk 5 kickoff falls back to "Sun 1:00 PM".
- Because the trade detail is z-23 above the profile's z-22, this profile is only seen after the trade detail is closed (§4).

There are no loading or error states; everything is computed synchronously.

---

### 2. Layout (top to bottom)

#### 2.0 Overlay container
- `position:absolute; left:0; right:0; top:50px; bottom:0; z-index:22; display:flex; flex-direction:column; background:` b0 #FFFFFF.
- It starts below the 50px status bar. The status bar keeps the page background (b0); it is not team-coloured.
- It covers the whole bottom dock (tab bar and league switcher) and the home indicator. Nothing of the dock is visible.
- It appears and disappears instantly (no enter/exit animation; no `transition` in markup lines 749–822).
- **Measured at 390×844** (headless Chromium, Inter Display loaded, 1× and 2× DPR give the same result). The overlay is 390×794:

  | Part | Height | y range |
  |---|---|---|
  | Header | 124px | 50–174 |
  | Stat strip | 52px | 174–226 |
  | Tab strip | 41px | 226–267 |
  | Body scroller | 577px | 267–844 |

  The strip and tab heights come from content (`line-height: normal`), so another engine or font build may differ by about ±0.5px.
- **The header, stat strip and tab strip are `flex:none` and sit outside the scroller.** They stay fixed while the body scrolls; there is no collapsing header.

#### 2.1 Header (team-coloured)
- Container: `flex:none; padding:8px 16px 12px; flex-direction:column; gap:10px; background: pf.tc; color: pf.fg`.
- `pf.tc = TC[team]`, falling back to `#3A3A3C`. TC hexes:

  | Team | Hex | Team | Hex | Team | Hex | Team | Hex |
  |---|---|---|---|---|---|---|---|
  | ARI | #97233F | ATL | #A71930 | BAL | #241773 | BUF | #00338D |
  | CAR | #0085CA | CHI | #0B162A | CIN | #FB4F14 | CLE | #FF3C00 |
  | DAL | #003594 | DEN | #FB4F14 | DET | #0076B6 | GB | #203731 |
  | HOU | #03202F | IND | #002C5F | JAX | #006778 | KC | #E31837 |
  | LV | #000000 | LAC | #0080C6 | LAR | #003594 | MIA | #008E97 |
  | MIN | #4F2683 | NE | #002244 | NO | #D3BC8D | NYG | #0B2265 |
  | NYJ | #125740 | PHI | #004C54 | PIT | #FFB612 | SF | #AA0000 |
  | SEA | #002244 | TB | #D50A0A | TEN | #4B92DB | WAS | #5A1414 |

- **Dark team colour (default):** `fg #fff`, `sub rgba(255,255,255,.8)`, `chipBg rgba(255,255,255,.16)`.
- **Light team colour (PIT, NO):** `fg` is `var(--x-t1)` (#1D1D1F in light mode), `sub rgba(29,29,31,.72)`, `chipBg rgba(0,0,0,.08)`.

**Row 1** (`display:flex; align-items:center; gap:6px`; height 30; measured y 58):
1. **Close.** 30×30, `border-radius:50%`, background `pf.chipBg`. Centred X icon 14×14: viewBox 16, path `M4 4l8 8M12 4l-8 8`, stroke-width 2.2, round caps, `stroke=currentColor`, so it takes `pf.fg`.
2. **Action pill** (`pf.act`). Height 30, padding 0 14px, radius 999px, 13px/600.

   | Owner | Label | Background | Text |
   |---|---|---|---|
   | mine | "Drop" | gr #FFE9EC | tr #C8001C |
   | other | "Propose trade" | #0088FF | #fff |
   | waivers | "Claim off waivers" | waiver gold #C98A1F | #fff |
   | free agent | "Add" | green fill #07B85A | #fff |

   Measured: "Drop" is 56.7px wide and starts at x 52.
3. **"+ List" pill.** `title="Add to list"`. Height 30, padding 0 12px, radius 999, gap 5px, 13px/600. Text t1 #1D1D1F on b2 #F2F2F4; these do **not** follow the team colour. Contents: a plus icon 11×11 (ICON.add `M8 3.5v9M3.5 8h9`, stroke 2.4, round caps), then the text "List". Measured width 61.4px.
4. `flex:1` spacer.
5. **Status pill** (only if `pf.hasStatus`). Height 22, padding 0 9px, radius 999, 11px/600, `#fff` text. Background is orange #FF8A00 for "Questionable" and danger #FF0028 for "Out".

**Row 2** (`display:flex; align-items:center; gap:12px`; measured y 98, height 64):
- **FSHeadshot, size 64.**
  - Circle 64×64, `overflow:hidden`, background #EEEEF1 (hard-coded).
  - Ring: `box-shadow: 0 0 0 1px #fff, 0 0 0 3px <TC[team]>`. The ring width is 2 because size ≥ 32. On the team-coloured header the outer ring blends in, so what shows is a 1px white gap.
  - **If the team is not in TC** (e.g. "FA"), the ring is `inset 0 0 0 1px rgba(0,0,0,.04)`.
  - Image: `object-fit:cover; object-position:50% 15%; transform:scale(1.25) translateY(8%)`. Path `assets/headshots/<HEAD[name]>.jpg`, only for the 19 names in HEAD.
  - Fallback initials: `max(9, round(64*.36))` = 23px/700 #6E6E73. Rule: strip a trailing " D/ST", split on whitespace, apostrophe or hyphen, then take the first letter of the first and last token. "Steelers D/ST" gives "S"; "Ja'Marr Chase" gives "JC"; "Cairo Santos" gives "CS".
  - `title` and `alt` are the player name. If the image errors it falls back to initials.
- **Text column** (`flex:1; min-width:0; flex-direction:column; gap:2px`):
  - **Name.** 22px/700, letter-spacing -0.02em, line-height 1.1, nowrap with ellipsis. The full name, e.g. "Bijan Robinson".
  - **Position line.** `flex; align-items:center; gap:6px; 12px/600`.
    - Position chip: height 17, padding 0 5px, radius 5px, 10px/600. Background `POS[pos]`: QB #F75252, RB #5C7CE5, WR #9D70E9, TE #ECAD48, K #D2E8E8, DST #FFE75E. Text #1D1D1F for K and D/ST, #fff otherwise. The DST label is "D/ST".
    - Then `teamLine`: `"ATL · #36"`. DST shows the team only, e.g. `"PIT"`.
  - **Bio line.** 11px/500, colour `pf.sub`, nowrap with ellipsis.
    - Format: `"Age 28 · 5'9\" · 221 lb · 7th season"`. Experience is "Rookie" when exp = 1, otherwise the ordinal plus " season".
    - DST: `"Defense / special teams"`.

#### 2.2 Stat strip
- `flex:none; display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); padding:10px 8px; border-bottom:1px solid` b3 #EBEBEE.
- Five cells, each 74.8px wide and 31px tall (measured): `flex-direction:column; align-items:center; gap:1px; min-width:0; text-align:center`.
  - Value: 15px/700, nowrap.
  - Label: 9.5px/500, t3 #6E6E73, nowrap.
- Cells in order:
  1. `#24` / `RB rank`. The label is `<POS> rank`, or "D/ST rank" for DST.
  2. `13.7` / `Avg pts`
  3. `55.0` / `2026 pts`
  4. `99%` / `Rost +0.5`. The label is `"Rost " + sign + change`.
  5. `11` / `Bye week`. This is the generated 2026 bye (§5).

#### 2.3 Tab strip
- `flex:none; display:flex; gap:18px; overflow-x:auto; padding:0 16px; border-bottom:1px solid` b3 #EBEBEE. Scrollbar hidden.
- Tabs: Summary, Game log, Leagues, Transactions, Team, History.
- Each tab: `flex:none; height:40px; 13px/600; nowrap`.
  - Active: colour t1 #1D1D1F, `box-shadow: inset 0 -2px 0` ink #1D1D1F. This draws a 2px underline the width of the text.
  - Inactive: t3 #6E6E73 with a transparent underline.
- Measured x and width at 390px:

  | Tab | x | Width |
  |---|---|---|
  | Summary | 16 | 57.8 |
  | Game log | 91.8 | 57.2 |
  | Leagues | 167 | 50.8 |
  | Transactions | 235.8 | 77 |
  | Team | 330.8 | 32.7 |
  | History | 381.5 | 42.7 |

  The content is about 440px wide, so **History is clipped at 390 and reached by scrolling sideways**. Selecting a tab does not scroll it into view.

#### 2.4 Body scroller
- `flex:1; min-height:0; overflow-y:auto; padding-bottom:28px`. Scrollbar hidden.
- The global rule `.fsm-scroll[style*="overflow-y"]::after` adds a block whose height is `--x-dockpad`. While the profile is open that is 84px (`dock-sm`). So the content ends with **28 + 84 = 112px** of empty space, even though the dock is hidden.
- The same scroller element is reused across tabs, so **scrollTop is NOT reset when switching tabs**; the new content height just clamps it.

#### 2.5 Summary tab
Wrapper: `padding:14px 16px; flex-direction:column; gap:18px`.

**(a) Ownership row** (tappable; measured 358×36 at y 281)
- `display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:12px; background:` b1 #F5F5F7.
- Contents, left to right:
  - 8×8 dot, colour `ownDot`: mine #0088FF, waivers #C98A1F, free agent #07B85A, other team t5 #AEAEB2.
  - Owner label: 13px/600, `flex:1`, ellipsis.
  - `lgSummary`: 12px/500, t3, nowrap.
  - Chevron-right 11×11 (`M6 3l5 5-5 5`, stroke 2, round caps and joins), colour t5 #AEAEB2.
- Owner label strings:
  - mine: `"Touchdown Tacos · your team"`
  - other: `"<Team name> · @<mgr>"`, e.g. "Gridiron Gurus · @marcus"
  - waivers: `"On waivers"`
  - free agent: `"Free agent"`
- `lgSummary`: `"Available in N league"` or `"Available in N leagues"`. N counts Leagues-tab rows whose button is "Add" or "Claim".
  - **When N = 0 it reads `"All leagues"`.** This reads like "available everywhere" but means "available nowhere"; it is flagged for the product owner.
- A long owner label truncates, e.g. "Touchdown Tacos · your te…" next to "Available in 1 league".

**(b) Key stats** (`flex-direction:column; gap:10px`; section measured at 171px tall)
- Header (tappable row; `flex; align-items:center; gap:8px`):
  - Title "Key stats": 15px/600, `flex:1`.
  - `keySub`: `"RB · 2026"` (`<POS> · 2026`), 11px/500, t3.
  - Chevron 12×12 (`M4 10l4-4 4 4`, stroke 2.2, round), colour t4 #8E8E93. `transform:none` when expanded (points up); `rotate(180deg)` when collapsed (points down). No transition.
- Body (if open): `grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px`. Six tiles, each 115.3×68.
  - Tile: `padding:10px; border-radius:12px; background:` b1; `flex-direction:column; gap:2px; min-width:0; cursor:pointer`.
  - Value: 17px/700, nowrap.
  - Label: 10px/600, t2 #3A3A3C, ellipsis.
  - Trend: 10px/600, nowrap. Text is e.g. `"▲ last 3 5%"` or `"▼ last 3 3.9"`. Colour is success #07A852 for ▲ and danger #FF0028 for ▼.

**(c) Games and projections** (section measured at 149px)
- Header row (tappable; gap 8), left to right:
  - Title "Games and projections": 15px/600, `flex:1`.
  - **Prev button**: 26×26 circle on b2 #F2F2F4, chevron 10×10 `M10 3L5 8l5 5`, stroke 2.4, colour t1. No `cursor:pointer` is set.
  - **Next button**: the same, with path `M6 3l5 5-5 5`.
  - Collapse chevron, the same as Key stats.
- Body (if open): a horizontal scroller.
  - `display:flex; gap:8px; overflow-x:auto; margin:0 -16px; padding:0 16px; scroll-behavior:smooth`. Full-bleed (390 wide), scrollbar hidden.
  - 18 cards, one per week Wk 1–18, including the bye. Content width is 3768px (18×200 + 17×8 + 32).
- **Card** (all cards stretch to the tallest, 113px):
  - `flex:none; width:200px; box-sizing:border-box; padding:12px; border-radius:14px; background:` b1; `flex-direction:column; gap:8px`.
  - `box-shadow` is `inset 0 0 0 2px #0088FF` on the current week (Wk 5) and none otherwise.
  - **Top row** (`flex; align-items:center; gap:6px`):
    - Week pill: height 20, padding 0 7px, radius 999, 10px/700, nowrap, text `"Wk 5"`. Colours:
      - current week: #0088FF background, #fff text
      - played: ink #1D1D1F background, #fff text
      - upcoming or bye: b3 #E5E5EA background, t2 #3A3A3C text
    - Opponent: 12px/600, nowrap, `flex:1; min-width:0`. Text such as `"vs PHI "` or `"@ LV "`, then a span `"(32nd)"`. Opponent-rank colour: ≥23 is #07A852, ≤10 is #FF0028, otherwise #FF8A00. These are hard-coded, not tints.
  - **Bye card:** the pill only (empty opponent), then `"Bye week"` at 13px/500 t3.
  - **Non-bye card:**
    - Row `display:flex; align-items:flex-end; justify-content:space-between; gap:8px`:
      - Left column (gap 1): `mainL` 10px/500 t3; `main` 22px/700, letter-spacing -0.02em, colour `mainC`.
      - Right column (align end, gap 1): `subL` 10px/500 t3; `subV` 14px/600 t2.
    - If `hasLine`: a stat line, 11px/500 t2, nowrap with ellipsis.
- **Initial scroll position:** `scrollLeft = gIdx * 208`. It is applied instantly (scroll-behavior is set to `auto`, then back to `smooth`) once per mounted element, guarded by `el._init`.
  - `gIdx` is the index of Wk 5 in the weeks array, minus 1. That is 3, so scrollLeft is 624.
  - Result: the **previous week's card sits flush at the 16px gutter**. The current-week card follows at x 224 and is clipped at 390.

**(d) Recent news** (section header the same as Key stats, without a subtitle)
- Card (if open; one item only):
  - `padding:14px; border-radius:16px; box-shadow: inset 0 0 0 1px` b3 #EBEBEE. This is an outlined card with no fill. `flex-direction:column; gap:8px`.
  - Title: 15px/600, line-height 1.3, `text-wrap:pretty`.
  - Body: 13px/500, line-height 1.45, t2, `text-wrap:pretty`.
  - Source: 11px/500, t3 (e.g. `"FieldScout news · 6h ago"`).
  - Analysis box: `padding:10px 12px; border-radius:10px; background:` b1; `flex-direction:column; gap:3px`.
    - Label `"Analysis"`: 11px/600, #0088FF.
    - Text: 12.5px/500, line-height 1.45, t2, `text-wrap:pretty`.
- Measured card height for Bijan: 233px.

#### 2.6 Game log tab
- Year chips row: `display:flex; gap:6px; padding:14px 16px 10px` (54px tall).
  - Chip: height 30, padding 0 14px, radius 999, 12px/600. Measured 58.9px wide.
  - Selected: ink #1D1D1F background, #fff text. Unselected: b2 #F2F2F4 background, t1 text.
  - Labels "2026", "2025", "2024". Count is `min(3, max(1, exp))`.
- Then the stats table (§2.11) with `k1L "Wk"`, `k1W 28px`, `k2L "Opp"`.
  - Column groups: Fantasy [Fpts, Snap %, Rank] (138px), then the SDEF groups.
  - 18 rows, one per week.

#### 2.7 Leagues tab
- Wrapper: `padding:8px 16px`.
- One row per league in LEAGUES (4 rows). Row: `min-height:58px; display:flex; align-items:center; gap:12px; border-bottom:1px solid` b2 #F2F2F4. The last row has the border too.
  - **Avatar**: 32×32, radius 9px, 11px/600, initials SF / FB / JU / WL.
    - Backgrounds: SF ink #1D1D1F, FB #ECAD48, JU #9D70E9, WL #5C7CE5.
    - Text #1D1D1F on #ECAD48, otherwise #fff.
  - **Text column** (`flex:1; min-width:0; gap:1px`):
    - League name: 14px/600, ellipsis.
    - Sub line: 12px/500, colour `subC`, ellipsis.
  - **Button** (if `hasBtn`): height 30, padding 0 14px, radius 999, 12px/600, #fff text on `btnBg`.
- Row variants, checked in this order. `rs2 = seeded(n + L.name)()`.

  | # | Variant | When | Sub line | Sub colour | Button |
  |---|---|---|---|---|---|
  | 1 | Pre-draft | `/Draft/.test(L.rec)`. **Always** for Joy to Us ("Draft Aug 28") and Work League ("Draft Sep 2"). | `"Pre-draft · ADP 52 · Draft Aug 28"`, where ADP = posRank×2+4 | to #B25C00 | "Add to queue" on ink |
  | 2 | Your team | League 0, `own.kind === "mine"` | `"On your team · Touchdown Tacos"` | #0088FF | none |
  | 3 | Rostered by another team | League 0, `own.kind === "other"` | `"Rostered by @marcus"` (`TEAMS[ti].mgr`) | t3 | "Trade" on #0088FF |
  | 4a | Free agent | League 0: `own.kind === "fa"` and not waiver. League 1: `.15 ≤ rs2 < .4`. | `"Free agent"` | #07A852 | "Add" on #07B85A |
  | 4b | Waivers | League 0: `own.waiver`. League 1: `rs2 < .15`. | `"On waivers · clears Wed"` | to #B25C00 | "Claim" on #C98A1F |
  | 5 | Rostered elsewhere | League 1 only, `rs2 ≥ .4` | `"Rostered by " + ["@kelly","@jordan","@mom","@uncle.ray"][floor(rs2*4)]`. With rs2 ≥ .4 the index is 1–3, so **only "@jordan", "@mom" or "@uncle.ray" appear; "@kelly" can never appear.** Bijan: "Rostered by @uncle.ray". | t3 | "Trade" on #0088FF |

  In practice only Family Bragging Rights (league 1) reaches the seeded branches 4a, 4b and 5.

#### 2.8 Transactions tab
- **Filter chips**: a horizontal scroller, `display:flex; gap:6px; overflow-x:auto; padding:12px 16px 6px` (48px tall). Scrollbar hidden.
  - Chip: height 30, padding 0 12px, radius 999, 12px/600, nowrap.
  - Selected: ink background, #fff text. Unselected: b2 background, t1 text.
  - Labels and measured widths: "All leagues" (84.2), "Sunday Funday League" (154), "Family Bragging Rights" (151.2), "Joy to Us" (75.6), "Work League" (96.7). They overflow past 390.
- **List**: wrapper `padding:0 16px`. Rows: `flex; align-items:center; gap:10px; padding:12px 0; border-bottom:1px solid` b2 (56px tall).
  - **Kind pill**: `min-width:62px; height:22px; padding:0 8px; box-sizing:border-box; radius 999`, centred, 11px/600.

    | Kind | Background | Text |
    |---|---|---|
    | Added | gg #E3F9EC | #07A852 |
    | Drafted | gb #E6F2FF | #0088FF |
    | Dropped | gr #FFE9EC | #FF0028 |
    | other | b2 | `x.fg` |

  - **Text column** (`flex:1; min-width:0; gap:1px`):
    - Text: 13px/600, ellipsis.
    - League name: 11px/500, t3, ellipsis.
  - **Date**: 11px/500, t3, nowrap, right-aligned.
- **Empty state**: `padding:30px 0; text-align:center; 13px/500; t3`, text `"No transactions in this league"`.

#### 2.9 Team tab
- Wrapper: `flex-direction:column; gap:20px; padding:16px 0`.
- **Team rank**:
  - Label `"Team rank"`: 15px/600, padding 0 16px. Gap 8 below.
  - Tile scroller: `display:flex; gap:6px; overflow-x:auto; padding:0 16px`. Scrollbar hidden.
  - Seven tiles: `flex:none; min-width:70px; padding:8px 10px; border-radius:12px; background:k.bg; flex-direction:column; gap:2px`.
    - Label: 10px/600, t2, nowrap.
    - Value: 14px/700, colour `k.fg`.
  - Labels in order: Offense, Pass yds, Pass att, Pass TD, Rush yds, Total TD, Red zone. Values are ordinals, e.g. "19th".
  - Tint, where low is good because this is the player's own offence:
    - rank ≤10: green (gg #E3F9EC / tg #067A3E)
    - rank ≥23: red (gr #FFE9EC / tr #C8001C)
    - otherwise: orange (go #FFF3E6 / to #B25C00)
- **Depth chart** (`padding:0 16px; gap:8px`):
  - Title `"Depth chart · ATL"` (`pf.team`): 15px/600.
  - Card: `border-radius:14px; box-shadow:inset 0 0 0 1px` b3 #EBEBEE; `overflow:hidden`.
  - **Header row**: `grid-template-columns:40px repeat(3,minmax(0,1fr)); gap:8px; padding:8px 12px; background:` b1; 10px/600 t3. Text "Pos", "Starter", "2nd", "3rd". Measured 28px tall.
  - **Each slot row**: the same grid, `align-items:center; padding:8px 12px; border-top:1px solid` b2. Measured **45px tall**: 1px border + 8 + a 28px content row + 8.
    - Slot label: 12px/700 (15px line box, vertically centred). Colour is POSTXT of the slot with digits stripped: QB #E03E3E, RB #4A68D4, WR1/2/3 #8656D8, TE #C98A1F, K #5E8C8C; anything else t1.
    - Three cells (`flex-direction:column; min-width:0`):
      - Line 1, e.g. `"Bijan · 23"`: the first name, a space, then `"· " + age`. 10px/500, t3, ellipsis. 12px line box.
      - Line 2, the last name, e.g. `"Robinson"` or `"Penix Jr."`: 13px/600, ellipsis, 16px line box. **#0088FF when it is the profiled player**, otherwise t1.
    - **Empty slot.** Line 2 shows `"–"` in t5 #AEAEB2. Line 1 renders `{{ c.first }} {{ c.age }}` with empty values, which collapses to a single space with **0px height**. So the empty cell is only 16px tall and is vertically centred in the row: the dash sits 6px higher than the last names in filled cells (measured: dash top at row-top + 15, filled last-name top at row-top + 21).
  - Depth cells are **not tappable**.

#### 2.10 History tab
- Section: `flex-direction:column; gap:8px; padding:16px 16px 10px`.
  - `"Transactions"` heading: 15px/600.
  - One card per league-0 transaction: `flex; align-items:center; gap:10px; padding:10px 12px; border-radius:12px; background:` b1. Measured 42px tall.
    - Pill: height 22, padding 0 8px, radius 999, 11px/600. Text colour `x.fg`: Added #07A852, Dropped #FF0028, Drafted #0088FF, None t3. Pill background is **b0 #fff**, so it is a white pill on a grey card.
    - Text: 12px/500, t2, `flex:1; min-width:0`. It wraps; there is no ellipsis.
    - Date: 11px/500, t3.
  - `"Career"` heading: 15px/600, margin-top 14px.
- Then the stats table (§2.11) with `k1L "Year"`, `k1W 40px`, `k2L "Team"`.
  - Column groups: Fantasy [Gm, Fpts] (92px), Position rank [Std, PPR] (92px), then the SDEF groups.
  - Rows: 2026, 2025, 2024, 2023, truncated to `min(4, max(1, exp))`. D/ST always shows 4.

#### 2.11 Shared stats table (Game log and History)
- Outer: `overflow-x:auto`, scrollbar hidden. Inner: `display:inline-flex; flex-direction:column; min-width:100%; padding-right:16px`.
- **Stickiness.** Only the first 96px column is sticky, horizontally (`position:sticky; left:0; z-index:1`, b0 background).
  - The group-label row and column-header row are **not** vertically sticky; they scroll away with the body.
  - The sticky column has **no right-edge divider or shadow**. The Players sheet table, by contrast, uses `box-shadow: inset -1px 0 0` b3 on its sticky column.
- **Group label row** (`flex; align-items:flex-end`):
  - Sticky spacer: width 96px, b0 background, `align-self:stretch`.
  - One cell per group: `width: 46 × column count` px, `padding:0 4px 4px`, 11px/600 t1, nowrap.
- **Column header row**: `height:26px; border-bottom:1px solid` b3.
  - Sticky cell: 96px, `padding-left:16px`, b0 background, 10px/600 t3. It contains a span of width `k1W` holding `k1L`, then `k2L`.
  - Then 46px centred labels: 10px/600 t3, nowrap.
- **Data rows**: `height:30px`.
  - Sticky cell: 96px, padding-left 16, b0, 12px/600.
    - `k1` is in t3, width `k1W`.
    - `k2` uses colour `k2C`:
      - Game log: the opponent, `"CAR"` (home) or `"@LV"` (away, no space). Coloured with the themed opponent-rank tint text: ≥23 tg #067A3E, ≤10 tr #C8001C, otherwise to #B25C00. A bye row shows "Bye" in t3.
      - History: the team abbreviation in t1.
  - Cells: wrapper `width:46px; padding:0 2px`; inner `height:24px; border-radius:6px`, centred, 12px/600, `c.fg` on `c.bg`.
- Cell types:
  - plain: b1 #F5F5F7 / t1
  - dash `"–"`: b1 / t5 #AEAEB2
  - bye: empty text on b3 #E5E5EA
  - tint: the green, orange or red pairs listed in §2.9
- Measured: the RB game-log table is 572px wide (96 + 138 + 138 + 184 + 16).

#### 2.12 Toast (shared component, appears over the profile)
- `position:absolute; left:50%; bottom:100px; transform:translateX(-50%); z-index:30`.
- `height:36px; padding:0 16px; border-radius:999px; background:` ink #1D1D1F; text `#fff`; 13px/500; nowrap.
- Auto-dismisses after **1800 ms** (`toast()`, line 1624). A new toast resets the timer.
- It appears and disappears instantly, with no animation. The README says "about 2.2s"; that conflict is flagged.

---

### 3. Interactions

| Element | Effect |
|---|---|
| Close (X) | `set({ prof: null })`. The overlay unmounts instantly (no animation) and reveals whatever was underneath, with that screen's state intact. See the scroll caveat in §4. |
| Action: Drop (mine) | Toast `"Drop <Full Name>: not part of this prototype"`. No data change. |
| Action: Propose trade (other) | `openTrade(own.ti, [name])` sets `trade` to `{ opp: ti, theirs: [name], mine: [], review: false, exp: "Never", dm: true, hide: false }`. The trade builder overlay (z-24) opens **on top of** the profile, which stays mounted. Builder close (`trade: null`) returns to the profile. Builder Send sets `{ trade: null, prof: null }` and toasts `"Trade proposal sent to @<mgr>"`, so it returns to the screen under the profile. |
| Action: Claim off waivers | Toast `"Claim placed: <Full Name>"`. No data change. |
| Action: Add | Toast `"Added <Full Name>"`. No data change. |
| + List | Toast `"Choose a list for <Full Name>"`. A placeholder for a list picker. |
| Status pill | Not interactive. |
| Tab (6) | `set({ pfTab: v })` with v one of `summary`, `log`, `leagues`, `tx`, `team`, `history`. Instant switch: the underline jumps and the body content swaps. The body scroll is not reset, and the strip does not auto-scroll. |
| Ownership row | `set({ pfTab: "leagues" })`. |
| Section header (Key stats / Games and projections / Recent news) | Toggles collapse. `pfCol[k] = open`, so `true` means collapsed. The chevron rotates 180° instantly (no transition) and the content mounts or unmounts instantly. Sections default to expanded. |
| Key stat tile | `cursor:pointer`, but the handler is a no-op (`tip: () => {}`). |
| Games prev / next | `e.stopPropagation()` (so the section does not collapse), then the scroller's `scrollLeft += ∓208` with native smooth scrolling. 208 = card 200 + gap 8. See the notes below this table. |
| Games scroller | Free horizontal swipe or scroll, with no snap. Re-expanding the section or returning to the Summary tab mounts a new element, which re-runs the initial position (prior week at the gutter). |
| Year chip (Game log) | `set({ pfYear: y })` re-renders the table for that season. |
| Leagues: Add to queue | Toast `"Added to your <League> queue"` |
| Leagues: Trade (league 0, other owner) | `openTrade(o.ti, [name])`, the same as the header Propose trade. |
| Leagues: Trade (league 1, seeded owner) | Toast `"Trade builder for <League>"` |
| Leagues: Add | Toast `"Added in <League>"` |
| Leagues: Claim | Toast `"Claim placed in <League>"` |
| Leagues row body | Not tappable. |
| Transactions filter chip | `set({ pfTxLg: v })` with v = `"all"` or the league index 0–3. Single-select. |
| Transactions rows, depth chart cells, team rank tiles, table cells, History cards | Not tappable. |

**Games prev / next details:**
- There is no clamping beyond the native limits. The maximum `scrollLeft` is 3378 (3768 − 390), which is not a multiple of 208, so the last position is not card-aligned.
- Each tap adds ±208 to the **live** `scrollLeft`. Rapid taps during a smooth scroll read a mid-animation value and drift off the card grid.
- With the section collapsed the buttons still render, but a tap does nothing, because the scroller element does not exist.

**No pressed, hover or focus feedback** anywhere in the profile. Markup lines 749–822 contain no `style-active`, `style-hover` or `transition`, unlike other rows in the prototype (e.g. the notification rows use `style-active`).

There are no long-press, drag or swipe gestures in this area beyond the native horizontal scrollers: tab strip, games, transaction chips, team-rank tiles and tables. Every scroller hides its scrollbar.

**Live updates:** `livePlay` calls `setState` every 7s (line 1402), which rebuilds `pf`. All profile values are seeded and deterministic, and the games scroller is guarded by `_init`, so nothing visibly changes. Nothing in the profile updates live, including Wk 5 "Points so far".

---

### 4. Navigation

**Arrival.** Every entry except jump #22 calls `openProf(name)`, which sets `prof`, `pfTab "summary"`, `pfYear "2026"` and `pfAvail false`. It does **not** reset `pfCol` (collapse state) or `pfTxLg` (transactions filter); both persist across profiles for the session.

| Entry point | Binding | Underlying layer |
|---|---|---|
| Home › Trending players rows | `homeTrend` `r.open` | Home |
| Home › Injury news rows | `homeInjuries` `r.open` | Home |
| League › Matchup compare rows, both sides | `compare` `c.a.openP` / `c.b.openP` (empty rows are a no-op) | Matchup |
| League › Team starters and bench, player name block | `myLineup` / `myBench` `r.openP`. **Empty slots do not open a profile:** their `openP` is `swap`, which opens the swap sheet (`sheet: "swap"`, `swapFor: { t, i }`, line 1637). | Team |
| League › Players trending tiles | `trendTiles` `r.openP` | Players |
| League › Players rows, all three views | `pList` `r.openP` in list view (markup 379), cards view (394) and sheet/table view (408) | Players |
| Other-team view (Team view overlay, z-21), starters and bench | `tv.starters` / `tv.bench` `r.open` (empty rows are a no-op) | The team view stays open beneath (the profile is z-22) |
| Global search player results (z-29) | `gs.players` `r.open` | Search closes first (`gs: null`) and is not restored when the profile closes |
| Trade offer detail (z-23), player assets | `td` `sd.gets` / `sd.sends` `a.open` (pick assets are a no-op) | **Bug:** the profile mounts at z-22, underneath the trade detail, so it is invisible until the trade detail is closed |
| Prototype jump panel #22 "Player profile" | `go("league","team","profile")` (line 1628) | Opens "Bijan Robinson" over League › Team. **It sets only `prof` and `pfTab "summary"`; it does not reset `pfYear` or `pfAvail`**, so a stale year from an earlier profile carries over to Game log. It also clears `sheet`, `trade`, `settings`, `tradeOpen` and `teamView`. |

**Back and close.**
- There is no back button and no profile stack: `prof` is a single string. Close (X) is the only exit.
- Close always returns to the layer beneath, which was never unmounted, so its tabs and state are preserved.
- Nothing inside the profile opens another profile (depth chart names and transaction names are not links), so the README's "player-profile stack" is not exercised.

**Scroll caveat (do not reproduce).** Inside a league, opening the profile switches the phone frame from `dock-lg` to `dock-sm` (`themeCls`, line 1858). That shrinks the `::after` spacer on every underlying `.fsm-scroll[style*="overflow-y"]` from 150px to 84px. An underlying screen scrolled to within 66px of its bottom has its scrollTop clamped by the browser, and closing the profile does not restore it.

**Dock, tab bar and league switcher.**
- While `prof` is set:
  - `showSwitcher = false`
  - the tab bar's `barMt = -80px`
  - the phone frame class is `dock-sm`, which gives scrollers 84px of dock padding
- The overlay (top 50 to bottom 0, z-22) covers the tab bar (z-4) completely. **No tab bar, no league switcher and no home indicator are visible, and no tab is highlighted.**
- The underlying tab state (for example League › Team) is untouched and reappears on close. Inside a league, the league switcher reappears too.
- The status bar (9:41, notch, battery) stays visible above the header, on b0.

**Z-order** (all `position:absolute` panels starting at `top:50px` and full height, unless noted):

| z | Layer | Relation to the profile |
|---|---|---|
| 4 | Dock / tab bar | Below |
| 20 | Bottom sheets (dim backdrop `rgba(0,0,0,.32)`, `inset:0`), including the swap sheet | Below |
| 21 | Team view | Below |
| **22** | **Player profile** | — |
| 23 | Settings and Trade offer detail | Above |
| 24 | Trade builder | Above; opened from the profile |
| 25 | Page | Above |
| 26 | Community detail | Above |
| 27 | Composer | Above |
| 28 | Pick | Above |
| 29 | Global search | Above |
| 30 | Column-tip popover and toast | Above |

---

### 5. Data shown
All values are seeded placeholders. The notes say which fields become real product data. The current week is 5; weeks 1–4 of 2026 are "played".

**Identity (real data):**
- `name` and `pos`. Display "D/ST" for DST.
- `team`.
- Jersey number. Ranges by position: QB 1–19, RB 20–39, WR 10–19, TE 80–89, K 1–9; none for DST.
- Height, formatted `6'4"`.
- Weight, formatted `234 lb`.
- Age.
- Experience: "Rookie" when exp = 1, otherwise `ord(exp) + " season"`.
- Headshot.
- Injury status: Questionable or Out.

**Injury status gaps:**
- STATUS (line 1208) only contains James Conner and Justice Hill (both "Q").
- Home › Injury news (line 1716) also lists Puka Nacua "Out", George Kittle "IR" and Chuba Hubbard "Questionable". Opening those three from Home shows **no status pill and the default (non-injury) news**.
- The injury news hard-codes "ankle injury" for both STATUS players, while Home says Justice Hill has a "back injury".
- Real data must drive the pill and the news from the same injury feed, and needs an IR mapping.

**Ownership (`ownerOf`).** Real data: the user's league rosters and the waiver state.
- In your lineup or bench → mine.
- In the opponent's roster (THEIRS / BENCH_THEM) → other, team index 1 (Gridiron Gurus, @marcus).
- Has a manager in TREND/LEAD and that manager is not "you" → other, that team.
- In AVAIL with flag "w" → waivers.
- Otherwise → free agent.
- This is always evaluated against Sunday Funday League. It ignores the selected league `s.lg`.

**Stat strip.** Real data: season aggregates and roster percentage.
- **Position rank**, `#N`. Formula `clamp(1..48, round(26 − (avg/base − .95) × 40))`.
- **Avg pts**: 1 decimal; the mean standard fantasy points of the weeks played.
- **2026 pts**: 1 decimal; the season total through Wk 4.
- **Rostered %**: integer + "%".
  - The 9 MINE starters use fixed values `[55,99,92,98,76,62,88,71,44]` (line 1263). Everyone else gets `20 + floor(seeded(n+"pf") × 79)`, i.e. 20–98.
  - **This differs from other screens.** Team rows use the same fixed MINE values but `20 + floor(seeded(n+"own") × 70)` (20–89) for everyone else (line 1639). The Players screen uses `info(n).rost`: TREND value, free agents 2–32, others 45–99. So the same player shows different percentages on different screens. Real data must use one value.
  - The label carries the weekly change with 1 decimal and a leading "+" when positive. Because the change is a string, zero renders as `"Rost -0.0"` or `"Rost 0.0"`.
- **Bye week**: the **generated 2026 bye**, not the player's real bye. Rule (genSeason line 1240): `p.bye` if `p.bye > 5`, otherwise `6 + (p.bye % 8)`, and `6 + (3 % 8) = 9` if `p.bye` is missing or 0. So it is always Wk 6–14.
  - Bijan's real bye is 5, shown as "ATL (5)" on the Team screen and in the trade builder. The profile strip shows **11**, and the Game log bye row also moves to Wk 11.
  - Real data must show the actual bye.

**Key stats (KS table, line 1307).** Six per position, formatted as shown:

| Pos | Stats |
|---|---|
| QB | Pass att/g (1dp), Rush att/g, aDOT, CPOE (signed `+1.2` / `-3.5`), RZ att/g, Sack % (int%) |
| RB | Snap %, Rush share, Tgt share (int%), RZ touches/g, YCO/att, RYOE/g (signed) |
| WR | Tgt share, Route %, Air yds share (int%), YPRR (2dp), aDOT, RZ tgt/g |
| TE | Route %, Tgt share (int%), YPRR (2dp), RZ tgt/g, Snap % (int%), aDOT |
| K | FG att/g, FG % (int%), 50+ att (int), XP att/g, Team RZ trips/g, Indoor games (int) |
| D/ST | Pressure % (int%), Sacks/g, Takeaways/g, Pts allowed/g, Opp pass att/g, Def TD (int) |

- Trend line: `"▲ last 3 <Δ>"` or `"▼ last 3 <Δ>"`. Δ has 1 decimal, or is a rounded integer + "%" when the value is a percentage.
- ▲ is always green and ▼ always red, even for lower-is-better stats.
- An unknown player (P7) gets the WR set.

**Games and projections cards.** Real data: schedule, opponent rank vs position, actual and projected points, kickoff and live status, box score.

| Card state | Main label | Main value | Main colour | Sub label | Sub value | Stat line |
|---|---|---|---|---|---|---|
| Played | "Points" | points, 1 decimal | green #07A852 if ≥ the card's seeded projection, else red #FF0028 | "Proj" | the seeded projection, 1 decimal | yes |
| Current week, points known | "Points so far" | `p.pts` as provided, e.g. "9.60" | t1 | "Proj" | `p.proj`, e.g. "16.03`; falls back to the seeded projection when `p.proj` is empty | yes |
| Current week, no points | "Projected" | **the seeded projection, 1 decimal, even when the player has a real `p.proj`** (e.g. Jake Bates ignores "8.10", Kendrick Bourne ignores "5.10") | t1 | "Kickoff" | `(p.game \|\| "Sun 1:00 PM")` with the ` vs/@ OPP` suffix removed, e.g. "Sun 1:00 PM", "Q4 2:00 · 31-7", "Final W 31-20". The label stays "Kickoff" even for live or final strings. | no |
| Upcoming | "Projected" | seeded projection, 1 decimal | t1 | "Kickoff" | one of "Sun 1:00 PM" / "Sun 4:25 PM" / "Sun 8:20 PM" / "Mon 8:15 PM" (seeded) | no |

Stat-line formats:
- QB: `"22/34 · 278 yds · 2 TD"`
- RB: `"16 car 80 yds · 3 rec 17 yds"`
- WR/TE: `"3/6 rec · 42 yds · 1 TD"`
- K: `"1/2 FG · 3 XP"`
- D/ST: `"3 sacks · 20 PA"`

**News.** Real data: news feed plus analysis. One item. `Last` is the last name, or the full name for D/ST.
- **Injury variant:**
  - Title: "`<Last>` limited at practice, listed questionable"
  - Body: "`<Last>` was limited on Wednesday and Thursday with an ankle injury and is questionable for Week 5."
  - Source: "FieldScout news · 2h ago"
  - Analysis: "Check the final injury report before kickoff. `<Last>` is averaging `<avg 1dp>` points per game, `<ord rank>` among `<POS>`s."
- **Bye variant:**
  - Title: "`<Last>` returns from bye in Week 5"
  - Body: "`<Last>` had the week off and is averaging `<avg>` points per game."
  - Source: "FieldScout news · 1d ago"
  - Analysis: `nextLine`
- **Default variant:**
  - Title: "`<Last>` posts `<w4 1dp>` points in Week 4"
  - Body: "`<Last>` finished Week 4 against `<OPP>` with `<line>`", then ", playing `<snap>`% of snaps." when there is a snap value, otherwise ".".
  - Source: "FieldScout news · 6h ago"
  - Analysis: "`<nextLine>` `<Last>` is `<ord rank>` among `<POS>`s at `<avg>` points per game."
- `nextLine` = "Week 5 is a `<ord oppRank>`-ranked matchup against `<OPP>` for `<POS>`s.", or "`<Last>` is on bye in Week 5."
- `line` (long form):
  - QB: "17 of 26 for 203 yards and 2 TD"
  - RB: "20 carries for 75 yards and 0 catches for 0 yards"
  - WR/TE: "5 catches for 63 yards on 6 targets"
  - K: "1 of 1 field goals and 3 extra points"
  - D/ST: "3 sacks and 20 points allowed"

**Leagues** (real data: the user's leagues and per-league availability).
- LEAGUES:
  - Sunday Funday League, 12-team standard, team "Touchdown Tacos", record 2-6
  - Family Bragging Rights, 10-team standard, "Dalton's Dynasty", 3-1
  - Joy to Us, 12-team PPR, "Taco Tuesday", "Draft Aug 28"
  - Work League, 10-team half PPR, "Spreadsheet Slingers", "Draft Sep 2"
- Row order follows LEAGUES.
- League 0 uses `ownerOf`; league 1 uses the seeded thresholds in §2.7; leagues 2 and 3 are always pre-draft.

**Transactions tab.** Real data: league transaction logs.
- **League 0 rows** come from TRANS where this player is part of a move:
  - Kind is "Added" or "Dropped".
  - Text is `"by @<mgr> · <type lowercased>"`, plus `" $<bid>"` if there was one, e.g. "by @devin · waiver $11".
  - Date is the part before the comma, e.g. "Oct 11".
  - If the player is rostered in league 0 and has no Added row, a row is appended: "Drafted", "by @dalton for $N" (mine) or "by <owner @mgr> for $N" (other), N = 1–60, date "Aug 30".
- **League 1 rows** (only league 1, because leagues 2 and 3 are pre-draft and produce none). They use `rs3 = seeded(n + "tx" + j)`:
  - "Drafted", `"by " + one of ["@kelly","@jordan","@mom"] + " in round N"` (N 1–10), dated "Aug 20"–"Aug 28".
  - With 50% probability, a "Dropped" row `"by " + one of ["@kelly","@jordan","@mom"]`, dated "Sep 10"–"Sep 24", listed **above** the Drafted row.
  - Both managers are picked independently at random.
- **Order:** grouped by league, league 0 first. It is not sorted by date.
- The league name shows under each row.
- **Inconsistency:** the league-1 rows do not agree with the Leagues tab, because they come from different seeds. For example, Bijan's Leagues tab says "Rostered by @uncle.ray", while Transactions says "Dropped by @mom" and "Drafted by @jordan in round 6". "Steelers D/ST" shows "Free agent" on the Leagues tab but "Dropped by @kelly" and "Drafted by @mom in round 6" here. Real data must use one source.

**History.**
- Transactions section: league-0 rows only, the same as above. If there are none: "None", "No transactions this season".
- Career table:
  - Gm: games played (plain).
  - Fpts: season total, 1 decimal, tinted by the Std rank.
  - Std: position rank, **tinted** with `rt(Std)`.
  - PPR: `max(1, Std + floor(seeded×5) − 2)`, so always within ±2 of Std, tinted with `rt(PPR)`.
  - Then season sums per SDEF column (plain); "Long" is the maximum, not a sum.
- Rank tint `rt`: ≤12 good, ≥24 bad, otherwise mid.
- The Team column shows the current team for every season (a prototype simplification).

**Game log cells.**
- Fpts: 2 decimals. Tint is good if ≥ 1.2×base, bad if < 0.75×base, otherwise mid.
- Snap %: integer with no "%" sign. **QB is always "100"** (genSeason line 1246). K and D/ST show a dash.
- Rank: weekly position rank 1–40, tinted with `rt`.
- Box stats are plain integers.
- Unplayed weeks show dashes in every cell, and the bye row shows grey blank cells.
- **The 2026 Wk 5 row is all dashes even when the Summary Wk 5 card shows "Points so far 9.60" (Bijan).** The two views disagree; real data must reconcile them.

**SDEF columns:**

| Pos | Groups |
|---|---|
| QB | Passing [Att, Cmp, Yds, TD, Int] · Rushing [Att, Yds, TD] |
| RB | Rushing [Att, Yds, TD] · Receiving [Tgt, Rec, Yds, TD] |
| WR/TE | Receiving [Tgt, Rec, Yds, TD] · Rushing [Att, Yds] |
| K | Kicking [FGM, FGA, Long, XPM] |
| D/ST | Defense [Sack, Int, FR, TD, PA] |

**Team tab** (real data: team offensive ranks and the depth chart).
- Team ranks are seeded per team and shown as ordinals.
- **Depth chart from `DEPTH`** (ATL, DET, CHI, PHI, KC, BUF). Slots QB, RB, WR1, WR2, WR3, TE, K, each with up to 3 entries "Name/age".
- **Derived depth chart** (any other team) is built from PDB players on that team:
  - Slots QB, RB, WR, TE and K only, with labels without numbers. **There is never a D/ST row.**
  - Players within a slot are in **PDB insertion order** (MINE, THEIRS, BENCH_ME, BENCH_THEM, TREND, AVAIL, LEAD, EXTRA, then the extra K/DST list), not by depth rank.
  - Only the first 3 per slot are shown, and empty slots are omitted.
  - Ages come from the seeded `bioOf`.
  - Example: "Steelers D/ST" gets only a WR row (DK Metcalf) and a K row (Chris Boswell).
- `DEPTH` ages can disagree with the header's seeded age (e.g. Bijan 23 in the depth chart vs 28 in the header). Real data must use one source.

**Reference sample, Bijan Robinson (jump #22):**
- Header ATL #A71930, "Drop", "RB · ATL · #36", "Age 28 · 5'9" · 221 lb · 7th season".
- Strip `#24 / 13.7 / 55.0 / 99% (Rost +0.5) / 11`.
- Owner "Touchdown Tacos · your team", "All leagues".
- Wk 5 card "vs PHI (32nd)", "Points so far 9.60", "Proj 16.03".
- Leagues: "On your team · Touchdown Tacos" / "Rostered by @uncle.ray" (Trade) / "Pre-draft · ADP 52 · Draft Aug 28" / "Pre-draft · ADP 52 · Draft Sep 2".
- Transactions (All):
  - Drafted, "by @dalton for $59", Aug 30, Sunday Funday League
  - Dropped, "by @mom", Sep 21, Family Bragging Rights
  - Drafted, "by @jordan in round 6", Aug 26, Family Bragging Rights

---

### 6. Dark mode
Dark mode is driven by the `.fs-dark` class on the phone frame. The toggle is stored in `localStorage["fieldscout-theme"]`.

| Token | Light | Dark | Used in the profile for |
|---|---|---|---|
| `--x-b0` | #FFFFFF | #121212 | Overlay background; sticky table cells; History transaction pill background |
| `--x-b1` | #F5F5F7 | #282828 | Ownership row; key-stat tiles; game cards; analysis box; plain and dash table cells; depth header row; History transaction cards |
| `--x-b2` | #F2F2F4 | #333333 | "+ List" pill; prev/next buttons; unselected year and league chips; Leagues and Transactions row dividers; depth row borders |
| `--x-b3` | #EBEBEE / #E5E5EA | #3E3E3E | Strip, tab and table header borders; news card outline; depth card outline; bye cells; upcoming week pill |
| `--x-t1` | #1D1D1F | #FFFFFF | Primary text; selected tab text; table values; **header text on light team colours** |
| `--x-t2` | #3A3A3C | #D9D9D9 | Tile labels; game card sub values and lines; news body and analysis; History transaction text; team-rank labels |
| `--x-t3` | #6E6E73 | #B3B3B3 | Meta text; inactive tabs; table headers; dates; empty state |
| `--x-t4` | #8E8E93 | #A7A7A7 | Section collapse chevrons |
| `--x-t5` | #AEAEB2 | #727272 | Ownership chevron; "other owner" dot; dash cells; empty depth slots |
| `--x-ink` | #1D1D1F | #4D4D4D | Active tab underline; played week pill; selected year and league chips; "Add to queue" button; SF league avatar; **toast background** |
| `--x-gg` / `--x-tg` | #E3F9EC / #067A3E | #12301F / #1ED760 | Good tint (table, team rank, Game log opponent text); "Added" pill background |
| `--x-gr` / `--x-tr` | #FFE9EC / #C8001C | #3A1A1D / #FF6B6B | Bad tint; **Drop button** (background / text); "Dropped" pill background |
| `--x-go` / `--x-to` | #FFF3E6 / #B25C00 | #3A2A14 / #FFB340 | Mid tint; pre-draft and waiver sub-lines |
| `--x-gb` | #E6F2FF | #12263F | "Drafted" pill background |

**Not themed (identical in both modes):**
- #0088FF: accent, current-week ring and pill, Analysis label, the profiled player in the depth chart, Propose trade and Trade buttons.
- #07A852 and #FF0028: trend arrows, played-points colour, Added/Dropped text.
- The game-card opponent rank #07A852 / #FF0028 / #FF8A00. Note that the Game log opponent abbreviation uses the themed tint text instead, so in dark mode it becomes #1ED760 / #FF6B6B / #FFB340 while the card stays fixed.
- #FF8A00: Questionable pill.
- #C98A1F: waiver dot and buttons.
- #07B85A: Add.
- Team colours, POS chip colours, POSTXT depth slot colours, league avatar colours, and `#fff` button text.
- The header's `sub` and `chipBg` rgba values.
- **FSHeadshot:** background #EEEEF1, initials #6E6E73 and the #fff 1px ring gap are all hard-coded (FSHeadshot lines 11 and 22), so the headshot stays light in dark mode.
- The toast **text** (#fff). Its background is `var(--x-ink)` and becomes #4D4D4D.

**Known dark-mode artefact (PIT and NO).** On these light team colours, `pf.fg` is `var(--x-t1)`, which turns white in dark mode:
- The name, the team line text and the Close X (`currentColor`) become white on #FFB612 / #D3BC8D, which is low contrast. This was confirmed by rendering.
- The bio line stays `rgba(29,29,31,.72)` and the Close chip stays `rgba(0,0,0,.08)`, so the header text is a mix of white and dark.
- The "+ List" pill becomes #333333 with white text on the team colour.

---

### Open questions
- Dropped critic finding (measurements): the critic said the stat strip is 51.5px (cells 30.5px), the tab strip spans y 225.5-266.5 and the body is 577.5px. Re-rendered at 390x844 in headless Chromium with Inter Display (all weights) loaded, at both 1x and 2x DPR, the result is header 124 (y 50-174), strip 52 (174-226), cells 74.8x31, tabs 41 (226-267) and body 577 (267-844). Those match the original values, so they were kept. A note was added that these heights come from content (line-height normal) and may differ by about 0.5px in other engines or font builds. Likewise, Chromium measures depth rows at 45px (critic: 44.5) and the empty-cell dash at 16px tall (critic: 15.5). The critic's substance holds (the empty cell's first line is 0px, so the dash is vertically centred and 6px higher than filled last names) and was incorporated with the Chromium values.
- Minor correction to the critic: the isLgs and isTx sc-if gates are at markup lines 786 and 789, not 784 and 788. The finding itself holds and was incorporated.
- Profile stack: the prototype holds a single prof string. There is no stack and no back button, and nothing inside a profile (depth chart names, transaction names) opens another profile, but the README mentions a 'player-profile stack'. Should depth-chart players be tappable and push a new profile, with Close popping back to the previous one?
- Trade offer detail (z-23) sits above the profile (z-22). Tapping a player asset in a trade offer mounts the profile underneath it, where it stays invisible until the trade detail is closed. Should the profile open above the trade detail?
- Unknown-player fallback: Cairo Santos (a trade-offer asset in nina's offer) is not in the player table, so his profile renders as a WR on team 'FA'. That means a grey #3A3A3C header, 'FA · #17', WR key stats and box score, no headshot ring, bye 9 and an empty depth chart. Real data will always have the player; confirm there is no intended 'unknown player' state, or what it should show.
- Dark mode on light team colours (PIT #FFB612, NO #D3BC8D): the name, team line and Close X use var(--x-t1), which becomes #FFFFFF, while the bio line and chip stay dark, so white and dark text are mixed on a light gold header. Should light team colours keep #1D1D1F text in dark mode?
- The FSHeadshot background (#EEEEF1), initials (#6E6E73) and white ring gap are hard-coded and stay light in dark mode. Intended?
- Header action (Drop / Propose trade / Claim / Add), the ownership row and the 'mine' check are always evaluated against Sunday Funday League (ownerOf ignores s.lg). Should they follow the league selected in the switcher, or the league context the profile was opened from? And what should they show when the profile is opened outside a league (Home, search)?
- Key-stat tiles have cursor:pointer but a no-op tap (tip: () => {}). Should a tap open the stat explainer popover (the colTip / PCOLMETA pattern used on the Players screen)?
- Key-stat trend colouring is never inverted: the up arrow is always green, even for lower-is-better stats (Sack %, Pts allowed/g, Opp pass att/g). Keep, or invert for those?
- Switching tabs keeps the body's scrollTop (one shared scroller), and the tab strip does not scroll the active tab into view (History is clipped at 390px). Replicate exactly, or reset to the top and scroll the active tab into view?
- Drop, Add, Claim, '+ List' and 'Add to queue' only show toasts (Drop says 'not part of this prototype'). What are the real flows: a drop confirmation, FAAB bid entry for waiver claims, a list picker sheet, the draft queue?
- Ownership-row copy shows 'All leagues' when the player is available in ZERO leagues (lgSummary, line 1335). That reads as the opposite ('available everywhere'). What is the intended wording, e.g. 'Rostered in all leagues'?
- The stat strip can render 'Rost -0.0' because a zero change is formatted from a string. What is the intended zero format?
- The stat-strip 'Bye week' is a generated 2026 bye (always Wk 6-14), not the player's real bye. Bijan's real bye is 5, shown as 'ATL (5)' on the Team screen, but the profile shows 11 and the Game log bye row moves to Wk 11. Confirm that the build should use the real bye everywhere.
- Rostered % comes from three different formulas: profile, Team rows (non-MINE players) and the Players screen. So the same player shows different percentages on different screens. Confirm that one roster-% source is used app-wide.
- Leagues tab vs Transactions tab, league 1 (Family Bragging Rights): they use different seeds, so the owners never agree. For example, Bijan is 'Rostered by @uncle.ray' but was 'Drafted by @jordan' and 'Dropped by @mom'; Steelers D/ST is a 'Free agent' but has 'Drafted by @mom' and 'Dropped by @kelly'. Real data will reconcile this; confirm nothing else is intended.
- Current-week card with no points yet: the main 'Projected' value is a seeded number even when the player has a real projection (Jake Bates 8.10, Kendrick Bourne 5.10 are ignored). The sub label reads 'Kickoff' even when the game string is live or final ('Q4 2:00 · 31-7', 'Final W 31-20'). Confirm that the build should show the real projection, and what label to use for live or final games.
- The 2026 Game log Wk 5 row shows dashes in every cell while the Summary Wk 5 card shows 'Points so far 9.60'. Should the in-progress week appear in the Game log with live partial stats?
- Injury status source: STATUS only lists James Conner and Justice Hill (Q). Home › Injury news also shows Puka Nacua 'Out', George Kittle 'IR' and Chuba Hubbard 'Questionable', but their profiles show no status pill and the default news. The injury news also says 'ankle injury' for Justice Hill, while Home says 'back injury'. Should the profile pill and news come from the same injury feed? And how should IR (and Doubtful, PUP etc.) be labelled and coloured, given the code maps every non-Q value to 'Out'?
- The Transactions tab list is grouped by league (Sunday Funday first) rather than sorted chronologically. Intended?
- Toast duration: the script uses 1800 ms; the README says about 2.2s. Which wins?
- Motion: the profile has no enter or exit animation, and the section collapse and chevron rotation are instant, but the README says transitions are linear, about 200ms, on transform. Should the build add a slide-up or push transition for the profile and a 200ms chevron rotation and collapse, and with what easing?
- There is no pressed or hover feedback on any profile control (no style-active), unlike other rows in the prototype. Should profile buttons and rows get the standard pressed state?
- The profile scroller inherits the 84px dock padding (dock-sm) plus its own 28px, giving 112px of bottom space even though the dock is hidden behind the overlay. Keep the 112px, or use 28px?
- Opening the profile inside a league switches dock-lg to dock-sm. That can clamp the underlying screen's scroll position (within 66px of the bottom), and it is not restored on close. Assumed to be an artefact not to reproduce; confirm.
- Stats tables (Game log, History): the column headers are not vertically sticky, and the sticky first column has no divider shadow (the Players sheet table has one). Replicate exactly, or add the divider for consistency?
- History › Career shows the player's current team for every season, and depth-chart ages come from a different source than the header age. Real data should use the per-season team and a single age source; confirm the expected behaviour.
- The derived depth chart (teams other than ATL, DET, CHI, PHI, KC and BUF) has no D/ST row and orders players by data insertion, not depth. The real depth chart feed is assumed; should it include a D/ST row and a fixed slot list (QB, RB, WR1-3, TE, K) for every team?

---

## Gap analysis vs the current app

## Player profile: mobile spec compared with the current app (worktree `redesign-v7` @ 27d455b)

**Summary.** The app already has a full player view, but it is shaped differently. `PlayerView` sits inside `PlayerViewModal`, which is a full-screen sheet on a phone. It shows a header, then a decision line, then This week, Key stats and the season table, followed by four remembered section toggles (D486(13)).

- **Already exists, only needs the mobile look:** the header, injury status, headshot ring, Drop / Trade / "+" actions, Add to list, the pos rank / avg / total / bye numbers, the opponent-rank tones, Key stats, the per-league availability rows and the box-score columns.
- **New UI on data we already store:** the tab strip, the games card scroller, multi-season game logs and career table, the per-player transactions tab, the depth chart, pre-draft "Add to queue" and the trade builder as an overlay.
- **Needs new backend:** rostered % with its weekly change, news, the advanced key-stat metrics, weekly snap %, team offence ranks, and the team per past season.

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Full-screen overlay that covers the dock; opens and closes instantly; the screen underneath keeps its state | restyle-only | `src/components/players/player-view-modal.tsx` (Radix `ui/dialog`, `h-[100dvh]` under `sm`; the page underneath is never navigated) | The portal already covers `bottom-tabs.tsx`. Drop the dialog's enter/exit animation to match "instant". |
| Header, stat strip and tab strip fixed; only the body scrolls | restyle-only | The modal wraps the whole `PlayerView` in a single `overflow-y-auto` | Split the header and strips out of the scroller. Prototype quirks not to copy: scrollTop is not reset between tabs, the 112px dock pad, and the dock-lg/sm scroll clamp. |
| Loading and error states (the spec has none) | restyle-only | `PlayerView` Skeletons and "Player not found" (`player-detail-page-view.tsx`) | Restyle them in the mobile design language (CLAUDE.md). |
| Tapping a player opens the profile directly (`openProf`) | out-of-scope-or-question | `src/hooks/use-open-player.ts` and `player-link.tsx`: every click opens the mini card first (D494); only `?player=` deep links and the command palette open the modal | Conflicts with the ruling "Player click: mini card, then full". Does mobile skip the mini card? |
| Team-coloured header (TC table, #3A3A3C fallback) | restyle-only | `src/lib/nfl-team-colors.ts` (the hexes match: ATL #A71930, PIT #FFB612, NO #D3BC8D, LV #000000) | Today these colours are used only for the headshot ring. |
| Dark text on light team colours (PIT, NO luminance switch) | restyle-only | A pure derivation over `NFL_TEAM_COLORS` | — |
| Close (X) chip | restyle-only | The Dialog's × and Esc | — |
| Context action pill: Drop / Propose trade / Claim / Add | restyle-only | `player-card-actions.tsx` → `LeagueCardActions`: `MineActions` (`DropConfirm`), the trade link, and `PickupActions` (one "+" picks Add or Claim, D481; confirm step, FAAB bid, drop picker on a full roster); gates are in `player-card-league-ops.ts` | The app does the real moves where the spec only shows placeholder toasts. Keep the app's verbs and gates (closed actions show their reason) and restyle as pills. Needs a league context (see the league-context question). |
| Propose trade opens the trade builder on top of the profile; closing it returns to the profile | new-ui-on-existing-data | `src/components/leagues/trades-ops.ts` `tradesHref()` navigates to `/app/leagues/[id]/trades?with=&player=` (`trade-builder.tsx`) | The builder exists as a page. Mobile wants it stacked over the profile, and Send should close both. |
| "+ List" pill | restyle-only | `AddToListPopover` (`player-detail-actions.tsx`, `add-to-list-popover.tsx`) | The app has a real list picker; the spec only toasts. |
| Injury status pill (Questionable / Out) | restyle-only | `players.status`, `injury_body_part`, `practice_participation`; `STATUS_CHIPS` in `player-detail-header.tsx` (Q/D/O/IR/PUP/SUS) | Real data already maps IR and Doubtful, which fixes the spec's IR gap. The spec puts a full-word pill on the right of row 1; the app puts a letter chip after the name. |
| Headshot (64px, team ring, initials fallback) | restyle-only | `PlayerAvatarImage` plus `Avatar` ring `0 0 0 1px #fff, 0 0 0 3px <team>` (`player-detail-header.tsx`, `player-image.tsx`) | The app shows the team logo for D/ST; the spec shows initials. The spec's initials rule also splits on apostrophe and hyphen. |
| Name, position chip and team line "ATL · #36" | restyle-only | `players.full_name`, `position`, `team`, `jersey_number`; `PositionBadge` (`pos-*` tokens) | D/ST shows the team only. |
| Bio line "Age · 5'9" · 221 lb · 7th season / Rookie" | restyle-only | `identityParts()` (`player-page-ops.ts`) and `players.experience_years` (`BioPanel`) | The experience ordinal is not in the header today. D/ST reads "Defense / special teams". |
| Stat strip: position rank, Avg pts, season pts | restyle-only | `GET /api/players/[id]/core-stats` → `pos_rank`, `avg_points`, `total_points` (`src/lib/players/core-stats-ops.ts`) | Which scoring these use is an open question (see below). |
| Stat strip: Rost % and weekly change | needs-new-backend | No source: `src/components/layout/rail/players-panel-ops.ts` says no rostered-% source exists, and `home/waiver-adds-card.tsx` is mock data | Needs a rostered-% snapshot plus a weekly change. The prototype also shows 3 different % values for the same player — use one source. |
| Stat strip: Bye week | restyle-only | `players.bye_week` | Show the real bye. The spec's generated bye (Wk 6–14) is a prototype bug. |
| 6-tab strip (Summary / Game log / Leagues / Transactions / Team / History), scrolls sideways | new-ui-on-existing-data | Today the calm view plus 4 section toggles (`SectionToggles`, D486(13)). `player-page.render.test.ts` checks that the page has no tabs | The content mostly exists; the tab UI is new. Conflicts with Chris's no-tabs ruling (see the IA question). |
| Ownership row (dot, owner label, "Available in N leagues", opens the Leagues tab) | new-ui-on-existing-data | `cardLeagueView`, `whereLine`, `leagueRowStatus` (`player-card-league-ops.ts`); `GlobalLeaguesExpander` (`player-card-actions.tsx`) | `GlobalLeaguesExpander` counts **all** leagues; the spec counts leagues where he is available. Needs a count across `useRosters`/`useLeaguePool`. Hidden while `featureFlags.leagues` is off. |
| Key stats section (6 tiles in a 3-column grid) | restyle-only | `KeyStatsPanel` and `keyStats()` (`src/lib/players/key-stats-ops.ts`) | Six position tiles from stored or derived values. The stat set differs from the spec. |
| The spec's advanced key stats (aDOT, CPOE, Sack %, RZ att/g, Route %, Air yds share, YPRR, Rush share, RZ touches/g, YCO/att, RYOE/g, Pressure %, Opp pass att/g, Team RZ trips/g, Indoor games, 50+ att) | needs-new-backend | F578 (`docs/specs/PROGRESS-leagues.md`): red-zone, routes, snap count and FG long are not stored. `player_usage` has only season `snap_pct` and `target_share` | Needs a tracking/charting feed (for example the `player_stats.advanced` jsonb). Until then keep the app's sourced set. |
| "▲/▼ last 3" trend under each key stat | new-ui-on-existing-data | Weekly box rows in `player_stats` (`/api/players/[id]/stats` gameLog) | Can be derived. The spec colours ▲ green even for lower-is-better stats (INT, Sack %, Pts allowed) — decide how to handle that. |
| Collapsible sections (Key stats / Games / News) with chevron | restyle-only | The app has collapsible sections remembered in localStorage (`fs.player-view.sections`) | Pure client state. |
| Games and projections card scroller (Wk 1–18 plus bye; prev/next; starts at the prior week) | new-ui-on-existing-data | `scheduleRows`, `thisWeek`, `seasonTable` (`player-page-ops.ts`); core-stats `weekly{points,proj}`; `useNflTeamSchedule`; `useDefenseSplits` | The same data the app shows as `SeasonTable`; the card layout is new. |
| Card opponent plus coloured rank "(32nd)" | restyle-only | `oprkOf` and `oprkTone` (`components/leagues/my-team-ops.ts`; bands ruled in D486(16): 1–10 red, 11–22 orange, 23–32 green) | The spec's ≥23 / ≤10 thresholds match the ruled bands. |
| Card played state: points vs projection, coloured | restyle-only | core-stats `weekly.points` / `proj` (`player_weekly_projections`) | Projection only where a stored line exists. |
| Card current week: "Points so far" and live/final string ("Q4 2:00 · 31-7") | new-ui-on-existing-data | `player_stats.is_live`/`game_clock`; `nfl_games.quarter`/`game_clock`/`home_score`/`away_score`/`status` | Core-stats `weekly` leaves out live weeks (R1506). The route needs to return the partial points. One source also fixes the spec's Wk 5 card-vs-game-log mismatch. |
| Card upcoming week: projection and kickoff | new-ui-on-existing-data | `nfl_games.kickoff_at` (`shortKickoff`); `player_weekly_projections` (`scripts/sync-weekly-projections.ts`) | Far-future weeks may have no projection. Leave it out rather than seeding a value. |
| Card stat line ("16 car 80 yds · 3 rec 17 yds") | new-ui-on-existing-data | `gameLog[].stats` from `/api/players/[id]/stats` | Only the formatting is new. |
| Recent news card (title, body, source and age) | needs-new-backend | F575: no player-news source. `home/injury-news-card.tsx` is mock data | Needs a news feed keyed to players. House rule: RSS or YouTube only. |
| News "Analysis" box and app-written news text (injury / bye / stat recap) | out-of-scope-or-question | Could be templated from `players.injury_*` and stored stats | D486 says the view "never writes advice of its own" ("Check the final injury report…"). Is app-written copy allowed? |
| Game log year chips (2026 / 2025 / 2024, count by experience) | new-ui-on-existing-data | The stats route reads only the 2026 game log and 2025 totals (`src/app/api/players/[id]/stats/route.ts`); `scripts/load-historical-stats.py` loads `player_stats` for 2022–2025 | Extend the read; no schema change. |
| Shared stats table (sticky first column, group headers, tinted cells) | new-ui-on-existing-data | `GameLogPanel` with a Fantasy/NFL toggle (`player-detail-panels.tsx`) | Rebuild as one grouped table. |
| Game log Fpts per week, tinted | restyle-only | gameLog `fantasy.ppr`/`standard` | Watch F576: this uses the old PPR calculator, while core-stats uses the newer scoring engine. Use core-stats `weekly` so both views agree. |
| Game log weekly position rank | new-ui-on-existing-data | `computePoolStandings(…, season, week)` (`src/lib/players/core-stats-service.ts`) | Computed per week; cache it. |
| Game log weekly Snap % | needs-new-backend | F578: Sleeper `off_snp` is read but not stored; only the season `player_usage.snap_pct` exists | Store snaps per week. |
| Game log Opp column (tinted) for past seasons | new-ui-on-existing-data | `nfl_games` via `scripts/sync-nflverse.ts <season>`; `defense_position_splits` has a `season` column | Past seasons need schedule and split rows synced with the existing jobs. Otherwise leave the column out. |
| Box columns by position (SDEF) | restyle-only | `positionColumns()` (`player-detail-panels.tsx`) | Kicker "Long" is not stored (F578), so leave it out. D/ST PA = `def_points_allowed`. |
| Leagues tab: one row per league (avatar, name, status, button) | restyle-only | `LeagueAvailabilityRow` (`player-card-actions.tsx`; `Crest`, `leagueRowStatus`) | The spec uses coloured initials tiles; the app uses `Crest` with `avatar_url`. |
| Leagues row states: your team / rostered by @mgr / free agent / on waivers (clears day) | restyle-only | `poolRows` availability `rostered{mine,teamName}` / `on_waivers{until}` / free (`components/leagues/players-page-ops.ts`) | The app shows the team name; @handles come from league members (which usernames should link, per the house rule). |
| Leagues row: Pre-draft "ADP 52 · Draft Aug 28" | new-ui-on-existing-data | `players.adp`, settings `draft_scheduled_at` (`src/lib/leagues/settings/league-settings.ts`), league `status` | Today a pre-draft league shows a "+" leading to "Roster moves open once the draft is done." |
| Leagues row: "Add to queue" | new-ui-on-existing-data | `useDraftQueue` / `useUpdateDraftQueue`; `DraftCardActions` exists in draft-room context only | Needs a league → draft and team lookup outside the room. |
| Leagues row buttons (Trade / Add / Claim) | restyle-only | The row re-opens the view in that league (`onOpen` → `goContext`), where `LeagueCardActions` runs | The spec acts in the row (placeholder toasts); the app routes through the league context. |
| Transactions tab: per-player history across leagues with league filter chips | new-ui-on-existing-data | `transactions` (payload, type), `draft_picks` (round, price, team_id); `GET /api/leagues/[id]/activity` filters by kind/type/week/team_id but **not by player** (`src/lib/leagues/api/activity-service.ts`); `/api/leagues/[id]/transactions` is POST-only | Needs a player filter or a new read over existing tables. One source also fixes the prototype's mismatch between the Leagues and Transactions tabs. |
| Transaction kind pills (Added / Drafted / Dropped, $bid, round) and the "No transactions" empty state | restyle-only | `transactions.type` (add_drop / waiver / trade), `draft_picks.price`/`round` | Depends on the row above. |
| Team tab: team rank tiles (Offense, Pass yds, Pass att, Pass TD, Rush yds, Total TD, Red zone) | needs-new-backend | No team-offence table; `player_stats` has no team column; no red-zone data (F578) | Needs a team-stats sync or aggregate. |
| Team tab: depth chart (QB / RB / WR1–3 / TE / K × 3, age, profiled player highlighted) | new-ui-on-existing-data | `players.depth_chart_position`/`depth_chart_order` (`supabase/migrations/029_player_depth_chart.sql`, Sleeper sync); today only a tag in `players-spreadsheet.tsx` | Map Sleeper's LWR/RWR/SWR to WR1–3. Ages from `birth_date` (one source fixes the spec's age mismatch). No D/ST row. |
| History: Transactions section (one league) | new-ui-on-existing-data | Same reads as the Transactions tab | Which league? See the league-context question. |
| History: Career table (Year, Gm, Fpts, Std rank, PPR rank, season sums) | new-ui-on-existing-data | `player_stats` 2022–2025 (`load-historical-stats.py`); `SeasonCard` totals; `computePoolStandings` for ranks | Extend the route; compute past-season ranks on demand and cache them. |
| History: Team column per season | needs-new-backend | `player_stats` has no team column; `players.team` is the current team only | Or accept the prototype's shortcut (current team every season). That is a product call. |
| Toast over the profile (pill, bottom 100px) | restyle-only | `src/hooks/use-toast.ts` (TOAST_LIMIT 1) | Spec says 1800ms; the README says about 2.2s. Pick one. |
| Ways in (Home trending/injury, matchup, team, players list, team view, search, trade detail) | restyle-only | `PlayerLink`/`PlayerFace` everywhere → `openPlayer`; the command palette opens the modal | Home's trending/injury lists are mock data. Do not copy the trade-detail z-order bug (profile hidden under the trade detail). |
| Dark mode tokens for the profile, and the PIT/NO dark-mode problem | out-of-scope-or-question | CLAUDE.md says single theme. **But** worktree HEAD 27d455b adds `m-*` light/dark tokens (`globals.css`, `tailwind.config.ts` `mob:` variant) and `src/stores/theme-store.ts` noting "Dark mode is mobile-only (Chris, 2026-10-15)" | Confirm that ruling replaces CLAUDE.md. If it stays, fix the PIT/NO header (white text on gold, mixed text colours) rather than copying it. |
| Which league drives the header action, the ownership row and History when the profile opens outside a league | out-of-scope-or-question | The prototype always uses league 0 and ignores the selected league (`s.lg`). The app uses the `leagueId` context, or a global "Your leagues" list | Probably the mobile league switcher's selected league. Needs a ruling. |
| Scoring basis for the strip, cards and game log | out-of-scope-or-question | The app has a scoring dropdown (ESPN Standard default, the selected league, or a remembered choice, D486(11)); the spec has no picker | Use the selected league's scoring? Where does the dropdown go on mobile? |
| Mobile layout (6 tabs) vs the desktop calm view with toggles | out-of-scope-or-question | D486(13) ruled progressive disclosure with no tabs; a render test checks this | Does the mobile layout diverge from desktop on purpose? |
| "All leagues" copy when he is available in 0 leagues | out-of-scope-or-question | — | Reads as "available everywhere" but means "nowhere"; the spec itself flags it for the product owner. |
| Profile with the leagues flag off (free-only launch) | out-of-scope-or-question | `src/lib/feature-flags.ts` `leagues` gate; `ActionsColumn` already hides league blocks when it is off | The spec has no layout without leagues. Which tabs, header action and ownership row remain? |

**Not to build:** the fields the spec lists as never rendered (`first`/`last`, `bio`, `kpis`, `projs`, `others`, `availOpen`, `g.res`, the hidden `g.line`, `tbl.k2W`), the no-op key-stat tap, the unknown-player fallback (the app always has a real player row), and the data mismatches caused by seeding (generated bye, three roster % formulas, depth ages vs header ages, Leagues vs Transactions tabs, Wk 5 row of dashes). Real single-source data removes all of them.

**Files checked** (all paths relative to `/Users/chrisdaltas/Documents/Hadouken/.claude/worktrees/redesign-v7/`):
- **Player components:** `src/components/players/{player-detail-page-view,player-detail-header,player-detail-actions,player-detail-panels,player-card-actions,player-view-modal,player-modal-url-sync,player-link,player-image,position-badge}.tsx`, `player-page-ops.ts`, `player-card-league-ops.ts`, `player-page.render.test.ts`
- **Hooks and stores:** `src/hooks/{use-open-player,use-layout-mode,use-leagues,use-toast}.ts`, `src/stores/{player-modal-store,theme-store}.ts`
- **API and services:** `src/app/api/players/[id]/{stats,core-stats}/route.ts`, `src/lib/players/{core-stats-ops,key-stats-ops}.ts`, `src/app/api/leagues/[id]/{activity,transactions}/route.ts`, `src/lib/leagues/api/activity-service.ts`
- **Other app code:** `src/components/leagues/trades-ops.ts`, `src/components/layout/rail/players-panel-ops.ts`, `src/components/home/{injury-news-card,waiver-adds-card}.tsx`, `src/lib/nfl-team-colors.ts`, `src/lib/feature-flags.ts`, `src/lib/leagues/settings/league-settings.ts`, `src/app/app/(shell)/nfl/[team]/page.tsx`
- **Schema, scripts and styling:** `src/types/database.ts` (players, player_stats, player_usage, player_weekly_projections, nfl_games, defense_position_splits, transactions, draft_picks, league_rosters, league_player_values, drafts), `supabase/migrations/029_player_depth_chart.sql`, `scripts/load-historical-stats.py`, `scripts/sync-nflverse.ts`, `src/app/globals.css` and `tailwind.config.ts` (HEAD 27d455b)
- **Docs:** `docs/specs/PROGRESS-leagues.md` (D486, F575, F578)
