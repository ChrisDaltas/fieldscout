## Rankings hub

Source: `/Users/chrisdaltas/Documents/Hadouken/FieldScout Mobile Handoff/FieldScout Mobile Lists and Rankings.dc.html`.

- **Markup:** lines 41–97 (status bar, header, hub) and 267–271 (tab bar).
- **Logic:**
  - 307–363: data and helpers. `oppOf` is at 333, `scoreOf` at 334, `COMM` at 356.
  - 366–372: state and hash parsing.
  - 374–379: `rank`, `breaks`, `itemsFrom`, `seedRanks`.
  - 412–427: root chrome.
  - 430–466: the hub.
  - 499: editor back. 557: Submitted back. 579: theme class.
- **Missing component:** `FSHeadshot.dc.html` isn't in the handoff folder. An identical copy of the bundle that includes it is at `/Users/chrisdaltas/Documents/Hadouken/design_handoff_fieldscout_mobile/`. Its Lists and Rankings file is byte-identical, and so is its `assets/` folder.
- **Cross-file behaviour** comes from `design_handoff_fieldscout_mobile/FieldScout Mobile.dc.html`, cited below as "main:<line>".

**How the numbers were checked.** I ran the prototype's `componentDidMount()` and `renderVals()` headless in Node across all 150 hub views: 3 sources × 4 types × 2 scorings × 6 positions = 144, plus the 6 `#view-` community views. Every rule, count and sample row below comes from that run unless marked otherwise. Text widths were measured offline with CoreText, using `InterVariable.ttf` at opsz 32 / wght 600 or 500 (the Inter Display instances) with `cv11` and `tnum` on. They were not rendered in a browser, so treat them as ±1px.

---

### 1. Screens and states

State lives in `state.rk = { src, type, scoring, pos }`. The default is `{ src: "ecr", type: "w5", scoring: "ppr", pos: "RB" }`. The other hub flags are:
- `rkMenu`: null | "type" | "scoring".
- `rkOpen`: null | a player's full name.
- `follows`: a map keyed by community-ranking id. It is undefined until the first Follow tap.
- `myOnly`: set only by `#mine`.
- `fromComm`: set by `#view-`, never read.

| # | State | Condition | What renders |
|---|---|---|---|
| S1 | **Source ranking: Experts** (default) | `scr==="rk" && rk.src==="ecr"` | Header, title "Rankings", source tabs (Experts active), sticky filter bar, info line, tiered rows |
| S2 | **Source ranking: Scout AI** | `rk.src==="ai"` | Same as S1, with Scout AI active |
| S3 | **Source ranking: Users** | `rk.src==="users"` | Same as S1, with Users active |
| S4 | **Someone else's ranking** (community author) | `rk.src==="c:<id>"` with `COMM[id]` present. Only reachable via `#view-<id>` | See the S4 notes below the table |
| S5 | **Mine tab** (inside the hub) | `rk.src==="mine"` and `myOnly` false | Title stays "Rankings"; source tabs stay visible (Mine active). Everything inside `rkNotMine` is hidden (filters, info line, rows) and the My rankings body renders. That body is specified in the My rankings section; only entry and exit are covered here |
| S6 | **My rankings via `#mine`** | `myOnly && src==="mine"` | Title "My rankings", **no source tabs** (`showSrcTabs=false`). Body as S5. **`myOnly` is never cleared in a `#mine` session** (there are no tabs to tap), so every later return to Mine in that session lands on S6, not S5 (see §4) |
| S7 | **Type menu open** | `rkMenu==="type"` | Popover under the filter bar titled "Ranking type", with **4 options including Pre-draft**. This conflicts with the README, which says "Pre-draft hidden in season"; see S12 |
| S8 | **Scoring menu open** | `rkMenu==="scoring"` | Popover titled "Scoring", 2 options |
| S9 | **Row expanded** ("Compare sources") | `rkOpen === <player full name>` | Breakdown panel directly under that row. **Only one row can be open at a time** |
| S10 | **Expanded, user has the same ranking** | Expanded, and `myRanks.find(m => type, scoring and pos all match)` hits. Any status counts: draft, saved or submitted | The 6th breakdown cell is "Your rank" instead of "Std dev". With seed data this happens in **8 views**: Week 5 · PPR · RB and Rest of season · PPR · WR on each of Experts, Scout AI and Users, plus `#view-r1` and `#view-r2`. Seeded `r1` is Week 5 · RB · PPR (submitted) and `r2` is ROS · WR · PPR (saved). Seeded `r3` is Week 4, which the hub can't select. **The default view hits this.** Any ranking the user saves during the session adds its view to the list |
| S11 | **Following** | `follows[<id>]` true | The author card's Follow pill reads "Following", greyed |
| S12 | **Pre-draft type** | `rk.type==="pre"` | The info-line dot turns green `#07D066`, the "updated" copy changes, and movement arrows appear. **README conflict:** the README's hub section says "type pills (Week 5, Week 6, Rest of season; Pre-draft hidden in season)". My rankings does treat Pre-draft as closed in season (`periods`, line 581: "Opens for 2027 drafts", hidden when empty). The hub type menu still offers Pre-draft, because `TYPES` (line 324) feeds `rm.opts` (line 443), and community `r4` is a Pre-draft ranking. Needs a ruling |
| S13 | **ROS type** | `rk.type==="ros"` | Movement arrows appear; the row subline shows "Bye N" instead of the opponent |
| S14 | **Sparse list (K and D/ST)** | `pos` is K or DST | The sample data has only 3 kickers and 3 D/STs, so every K and D/ST view shows **1–3 rows**. See the sparse-view breakdown below the table |

**S4 notes (someone else's ranking):**
- The source tabs gain a 4th tab named after the author (e.g. "@shahranks"), inserted before "Mine" and active.
- An **author card** replaces the filter bar. **The sticky filter bar is not rendered** (`rkFilters = src!=="mine" && !CM`), so type, scoring and position are locked to the community ranking.
- The info-line copy changes.
- The comparison sources become **Experts + Scout AI only**. **Users disappears completely**: there's no Users comparison column, the third breakdown cell becomes the author, and the info line doesn't mention Users.

**S14 notes (sparse views):**
- **Week 6 D/ST** shows exactly one row: "Broncos D/ST · DEN @ ATL" under "Tier 1" / "1 players". The Steelers and Texans are on bye.
- **Week 6 K** shows 2 rows: B. Aubrey and C. Dicker.
- Every other K or D/ST view shows 3 rows.
- Of the 48 source views for K and D/ST, **40 are a single tier**. With 1 row, `breaks()` sees no gaps (mean 0). With 2 rows, a break is never allowed at index 1.
- **8 split 2 + 1**: Scout AI · W5 · K, Scout AI · ROS · D/ST, Users · W5 · D/ST and Users · Pre · K, each under both scorings.

**No loading, empty, error or offline states exist for the hub,** and there are no skeletons. No hub view has 0 rows with the sample data, because no player has a Week 5 bye and Week 6 always leaves at least 1 D/ST. No copy is defined for an empty case.

---

### 2. Layout, top to bottom

Frame: 390 × 844, `background: var(--x-b0,#fff)`. Font is `'InterDisplay', sans-serif` with `font-feature-settings:'tnum' 1,'cv11' 1`, antialiased. Line-heights are browser default unless stated. Default text colour is t1 `#1D1D1F`.

#### 2.1 Status bar (presentation chrome, shared)
- 50px tall, `padding: 6px 32px 0 40px`, 16px / 600.
- "9:41" on the left.
- A 120×34 black (`#000`) pill centred at top 11px.
- Signal (18×12) and battery (25×12) SVGs on the right, gap 6px.

#### 2.2 Root header (fixed, does not scroll)
Shown when `showRoot` (scr is "rk" or "lists"). Row: `display:flex; align-items:center; gap:10px; padding:2px 16px 0`, 36px tall overall.
- **Back button** (left):
  - 34×34 circle, bg b2 `#F2F2F4`.
  - 16px chevron-left SVG, path `M10 3L5 8l5 5`, stroke t1, stroke-width 2, round caps and joins.
  - Handler: `goProfile` (see §4).
- Flexible spacer.
- **Create button** (right):
  - 34×34 circle, bg `#0088FF` (accent).
  - White 15px plus SVG, path `M8 3v10M3 8h10`, stroke-width 2.4, round caps.
  - HTML `title="Create"`.
- There is **no** Rankings/Lists segmented control. `rootSeg` is computed in JS (line 415) but bound nowhere. `rkNotComm` is likewise computed and unbound.

#### 2.3 Scroll container
- `class="fsm-scroll"`; `flex:1; min-height:0; overflow-y:auto; position:relative`; scrollbar hidden (`scrollbar-width:none` plus `::-webkit-scrollbar{display:none}`).
- It contains everything below, down to the end of the rows.
- A trailing `::after` spacer adds **84px**. The rule is `.fsm-scroll[style*="overflow-y"]::after{height:var(--x-dockpad)}`, and `--x-dockpad:84px` comes from the class `dock-sm`, which `themeCls` adds to the phone frame whenever `showBar` is true. The spacer lets the last row clear the tab bar.
- **The scroller stays mounted across every hub state change**: source tab, position chip, menu option, row expand, and Mine (all inside `sc-if isRk`). See §3.7 for scroll behaviour.

#### 2.4 Page title
- Wrapper padding `12px 16px 0`.
- Text: **"Rankings"**, or **"My rankings"** in S6.
- 26px / 700, letter-spacing -0.03em, t1.

#### 2.5 Source tabs (hidden in S6)
Container: `display:flex; gap:18px; overflow-x:auto` (scrollbar hidden), `padding:0 16px; margin-top:6px; border-bottom:1px solid var(--x-b3,#EBEBEE)`.

Tabs, in order: **Experts · Scout AI · Users · [author handle, S4 only] · Mine**.

Each tab is `flex:none; height:38px; display:flex; align-items:center`, 14px / 600, nowrap.
- Active: colour t1 `#1D1D1F`, underline `box-shadow: inset 0 -2px 0 var(--x-ink,#1D1D1F)`. The 2px bar sits inside the tab, directly on the 1px container border.
- Inactive: colour t3 `#6E6E73`, no underline (`inset 0 -2px 0 transparent`).

#### 2.6 Author card (S4 only), placed before the filter area
Card: `margin:12px 16px 0; padding:14px; border-radius:16px; background: var(--x-b1,#F5F5F7)`, flex column, gap 10px.

1. **Author row** (flex, align center, gap 10):
   - **Avatar:** 36×36 circle, bg `COMM[id].av`. It holds one initial, `by[1].toUpperCase()` (the letter after "@", e.g. "S"), 14px / 600, white.
   - **Text column** (flex 1, min-width 0, gap 1):
     - Handle: 14px / 600, t1 (e.g. "@shahranks").
     - Accuracy line: 11px / 500, t3, single-line ellipsis. Format `"{acc} · {follows} follows"`, e.g. **"#1 accuracy in 2025 · 12k follows"**. Measured at about 171–179px, so it fits; no sample line truncates.
   - **Follow pill:** flex none, 30px tall, `padding:0 14px`, radius 999, 12px / 600.
     - Not following: label "Follow", bg `#0088FF`, text `#fff`.
     - Following: label "Following", bg b3 `var(--x-b3,#E5E5EA)`, text t2 `var(--x-t2,#3A3A3C)`.
2. **Title block** (column, gap 2):
   - Title: 17px / 700, letter-spacing -0.01em, e.g. "Week 5 · RB · PPR".
   - Meta: 11px / 500, t3. Format `"{Type} · {Pos} · {Scoring} · submitted {time}"`, e.g. **"Week 5 · RB · PPR · submitted 40m ago"**. It always says "submitted", even when the main app calls the same ranking "Updated 40m ago" (see §5.5).
3. **Note** (only if `note` is non-empty): 13px / 500, line-height 1.4, t2 `#3A3A3C`, `text-wrap:pretty`.
4. **"Start my ranking from this" button:**
   - Full width, 38px tall, radius 12px, centred, gap 6px, 13px / 600.
   - t1 text on bg b0 `#fff`, with ring `box-shadow: inset 0 0 0 1px var(--x-b3,#E5E5EA)`.
   - Leading 13px "copy" SVG: path `M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3`, stroke-width 1.8, round caps and joins.

#### 2.7 Sticky filter bar (S1–S3 only; absent in S4, S5 and S6)
Container: `position:sticky; top:0; z-index:5; background: var(--x-b0,#fff); padding:10px 0 8px; border-bottom:1px solid var(--x-b2,#F2F2F4)`. It sticks to the top of the scroll container. The title, tabs and info line scroll away under the fixed header.

Inner row: `display:flex; gap:6px; overflow-x:auto` (scrollbar hidden), `padding:0 16px`.

**The row scrolls horizontally.** Measured content widths:
- About **451px** with "Week 5" + "PPR", against 358px visible (scrollWidth about 483px including padding). At rest the **K chip is clipped at the right edge (about 390–407px) and the D/ST chip is fully off-screen** until you scroll.
- About 494px with "Rest of season".
- About 525px with "Rest of season" + "Standard".

Elements, left to right:
1. **Type pill** and 2. **Scoring pill**, which share a style:
   - `flex:none; height:30px; padding:0 10px 0 12px; border-radius:999px; gap:5px`, 13px / 600, nowrap.
   - **Text `#fff` on bg ink `var(--x-ink,#1D1D1F)`, always.** There is no separate selected or open look.
   - Label, then a 10px chevron-down SVG: path `M4 6l4 4 4-4`, stroke-width 2.4, round.
   - Type labels: "Week 5", "Week 6", "Rest of season" or "Pre-draft". Scoring labels: "PPR" or "Standard".
   - Measured widths: Week 5 about 82px, Rest of season about 125px, PPR about 62px, Standard about 92px.
3. **Vertical divider:** `flex:none; width:1px; margin:4px 2px; background: var(--x-b3,#E5E5EA)`, so 22px tall and 5px wide including margin.
4. **Position chips**, in order: QB · RB · WR · TE · K · D/ST. There is no Overall or FLEX chip in the hub.
   - Shape: `flex:none; height:30px; padding:0 12px; border-radius:999px`, 13px / 600, nowrap.
   - Selected: bg `#0088FF`, text `#fff`.
   - Unselected: bg b2 `#F2F2F4`, text t1 `#1D1D1F`.

**Menu popover (S7/S8).** It sits inside the sticky container, so it travels with it.
- **Backdrop:** `position:fixed; inset:0; z-index:6`, fully transparent (no dim).
  - No ancestor is transformed, so it covers the **entire browser viewport**. In the prototype that includes the jump panel outside the phone.
  - It paints above the tab bar because its **sticky parent (z 5) outranks the bar (z 4)** in the shared stacking context. Its own z 6 only orders it within the sticky container. A rebuild must give the menu layer a higher stacking order than the dock.
- **Panel:**
  - `position:absolute; left:16px; right:16px; top:calc(100% + 4px); z-index:7; padding:12px; border-radius:16px; background: var(--x-b0,#fff)`.
  - Shadow is the README "Menus" token, `0 10px 30px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.05)`.
  - Flex column, gap 8. About 129px tall for the type menu and about 85px for scoring.
  - **Title:** 12px / 600, t3. Copy is **"Ranking type"** or **"Scoring"**.
  - **Options grid:** `grid-template-columns: 1fr 1fr; gap:6px`.
  - **Each option:** 38px tall, `padding:0 10px`, radius 10px, text centred, label 13px / 600.
    - Selected: bg ink `#1D1D1F`, text `#fff`.
    - Unselected: bg b2 `#F2F2F4`, text t1.
  - Type options, 2×2: **Week 5 | Week 6 / Rest of season | Pre-draft**. Scoring options: **PPR | Standard**.

#### 2.8 Info line (S1–S4; not sticky)
Row: `display:flex; align-items:center; gap:8px; padding:10px 16px 4px`. It sits **outside** the sticky container, so it scrolls away (comparison header included) while the filter bar sticks. Once scrolled, only the per-row "AI" / "Users" / "Experts" labels identify the comparison columns.

- **Dot:** 6×6 circle, flex none.
  - `#07D066` (brand green) when type is Pre-draft.
  - Otherwise t5 `var(--x-t5,#AEAEB2)`.
- **Text** (`rkLine`): flex 1, min-width 0, 11px / 500, t3, single-line ellipsis.
  - Experts: **"Consensus of 5 experts · {upd}"**
  - Scout AI: **"Scout AI model · {upd}"**
  - Users: **"Average of 2,418 user rankings · {upd}"**
  - `{upd}`: Pre-draft → "updated 4 min ago"; ROS → "updated today 9:12 AM"; weekly → "updated 9:12 AM".
  - Community (S4): **"Compared with Experts and Scout AI · tap a player for detail"**, with no "updated" suffix.
  - **Measured truncation:**
    - Users + ROS (about 284px of text vs about 254px available) and Users + Pre-draft (about 259 vs 254) **end in "…"**.
    - Users weekly is about 253 vs 254, a hair from truncating.
    - The community line (about 296 vs 254) **truncates**, so "tap a player for detail" is cut.
    - Experts and Scout AI always fit.
- **Right-hand comparison header** (`rkCmpHead`): flex none, 10px / 600, t3, nowrap. It shows the full names of the two comparison sources, joined with " · ":
  - Experts tab → "Scout AI · Users"
  - Scout AI tab → "Experts · Users"
  - Users tab → "Experts · Scout AI"
  - Community → "Experts · Scout AI"

#### 2.9 Rows container
`padding: 0 16px 24px`, plus the 84px dock spacer after it.

**Tier header row**, always emitted before the first player and at every tier break. **Not tappable** (no handler).
- Row: `display:flex; align-items:center; gap:8px; padding:14px 0 4px`.
- Label "Tier N": 12px / 700, colour `TIERC[N-1]`. The colours cycle **#4A68D4, #8656D8, #07A852, #C98A1F, #E03E3E, #5E8C8C**; Tiers 7–8 use t3 `#6E6E73`.
- Rule: flex 1, 1px, b3 `#EBEBEE`.
- Count: 10px / 500, t3. Copy is **"{n} players"**. The prototype literally renders "1 players" for a one-player tier.

**Player row** (the whole row is the tap target; `cursor:pointer`; no hover or pressed style):
- **Row:** `display:flex; align-items:center; gap:10px; min-height:54px; padding:6px 0; border-bottom:1px solid var(--x-b2,#F2F2F4)`.
- **Rank column:** 26px wide, flex column centred, gap 1.
  - Rank: 14px / 700, t1, e.g. "1".
  - Movement (ROS and Pre-draft only, and only when non-zero): 9.5px / 600. "▲N" in `#07A852` or "▼N" in `#FF0028`.
- **Headshot:** `<dc-import name="FSHeadshot">` with `team`, `player` = full name, `src` and `size="36"`. Component details:
  - **Root:** `title="{full name}"` (tooltip); `position:relative; width/height 36px; flex:none; border-radius:50%; overflow:hidden; background:#EEEEF1`; flex-centred content.
  - **Ring:** `box-shadow: 0 0 0 1px #fff, 0 0 0 {1+rw}px {TC[team]}`. `rw` is **2px when size ≥ 32** and **1.5px below 32**. So at 36px: `0 0 0 1px #fff, 0 0 0 3px {teamColor}`.
  - **Unknown team** (not in TC): ring `inset 0 0 0 1px rgba(0,0,0,.04)`.
  - **Team colours (TC):** ARI #97233F, ATL #A71930, BAL #241773, BUF #00338D, CAR #0085CA, CHI #0B162A, CIN #FB4F14, CLE #FF3C00, DAL #003594, DEN #FB4F14, DET #0076B6, GB #203731, HOU #03202F, IND #002C5F, JAX #006778, KC #E31837, LV #000000, LAC #0080C6, LAR #003594, MIA #008E97, MIN #4F2683, NE #002244, NO #D3BC8D, NYG #0B2265, NYJ #125740, PHI #004C54, PIT #FFB612, SF #AA0000, SEA #002244, TB #D50A0A, TEN #4B92DB, WAS #5A1414, WSH #5A1414.
  - **Image** (when `src` is set and hasn't failed): `<img alt="{full name}">`, `position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:50% 15%; transform:scale(1.25) translateY(8%)`.
    - `onError` stores `failed = src`, which swaps to initials.
  - **Initials fallback:**
    - Strip a trailing " D/ST", split on `/[\s'-]+/`, then take the first letter of the first part plus the first letter of the last part, uppercased. For example: "Broncos D/ST" → "B", "De'Von Achane" → "DA", "Amon-Ra St. Brown" → "AB".
    - Font size `max(9, round(size × 0.36))`, which is **13px** at 36. Weight 700, colour `#6E6E73`.
  - **Coverage:** only 14 sample players have images (`assets/headshots/{robinson,brown,kamara,conner,sanders,williams,pacheco,engram,mooney,allen,kmet,mitchell,wright,dotson}.jpg`). Everyone else shows initials. In the default RB view, 6 of 15 rows have photos.
- **Name block** (flex 1, min-width 0, column, gap 2):
  - **Name:** 14px / 600, `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`.
    - Uses the short form: first initial + ". " + the rest. Examples: "S. Barkley", "A. St. Brown", and "A. Brown" for A.J. Brown.
    - D/ST names are kept whole, e.g. "Broncos D/ST".
  - **Subline:** `display:flex; align-items:center; gap:5px; min-width:0; overflow:hidden`, 11px / 500, t3, nowrap. **No ellipsis**: overflow is hard-clipped.
    - Weekly: **"{TEAM} {vs|@} {OPP}"**, e.g. "PHI @ BAL", "DET vs NYG".
    - ROS / Pre-draft: **"{TEAM} · Bye {n}"**, e.g. "CIN · Bye 10".
    - The widest subline, "WAS · Bye 12", measures about 68px, so it clips by about 1px. All others fit.
- **Stat columns** (flex none, gap 2): 3 cells, each 36px wide, centred column, gap 1.
  - Value: 12px / 600, t1, nowrap.
  - Label: 9px / 500, t3, nowrap. Labels are **"Pts"**, **"Avg"** and **"Pos rk"**.
- **Divider:** 1px wide, `flex:none; align-self:stretch; margin:6px 0`, b3 `#EBEBEE`.
- **Comparison columns** (flex none, gap 2): 2 cells, each 32px wide, centred column, gap 1.
  - Value: 13px / 600, colour per §3.4.
  - Label: 9px / 500, t3, nowrap. Short labels are **"Experts"**, **"AI"** (for Scout AI) and **"Users"**.
- **Width budget at 390px:**
  - Fixed parts total 291px: rank 26 + headshot 36 + stats 112 + divider 1 + comparison 66 + 5 gaps × 10. That leaves **67px for the name**.
  - **Measured: about 17 of the 54 short names exceed 67px and end in "…":**
    - C. McCaffrey 85, A. St. Brown 79, P. Mahomes 80, B. Robinson 76, J. Jefferson 76, C. Hubbard 73, K. Fairbairn 74, B. Mayfield 72, K. Williams 71, S. Sanders 70, T. McBride 70, L. Jackson 69, J. Williams 69, D. Mooney 69.
    - All three D/STs: Broncos 88, Steelers 88, Texans 80.
    - Borderline, within 1px: A. Kamara 67.7, A. Mitchell 67.6.
    - **In the default RB view: B. Robinson, C. McCaffrey, K. Williams and C. Hubbard truncate**, and A. Kamara is borderline.

**Expanded breakdown panel** (S9). It renders directly after the open row's bottom border, as a **sibling of the row with no handler**. Tapping inside it does nothing and does not collapse the row.
- **Panel:** `margin:6px 0 8px; padding:10px; border-radius:12px; background: var(--x-b1,#F5F5F7)`, flex column, gap 8.
- **Grid:** `repeat(3, minmax(0,1fr))`, gap 6, giving 6 cells in 2 rows.
- **Each cell:** `padding:8px; border-radius:10px; background: var(--x-b0,#fff)`, column, gap 1.
  - Value: 15px / 700.
  - Label: 10px / 500, t3.
- **Cells, in order:**
  1. **Experts:** "#N"
  2. **Scout AI:** "#N"
  3. **Users:** "#N". In S4 the label is the author handle (e.g. "@shahranks") and the value is the author's rank.
  4. **Best expert:** "#N"
  5. **Worst expert:** "#N"
  6. **Your rank** (S10): "#N", or "–" if the player isn't in your ranking. Otherwise **Std dev**: a 1-decimal value with no "#", e.g. "1.6" or "0.0".
- **Agreement note:** 11px / 500, line-height 1.4, t2 `#3A3A3C`, `text-wrap:pretty`. Copy rules are in §5.4.

#### 2.10 Bottom tab bar (dock)
Shown (`showBar`) on scr rk, lists, lv and done.

- **Bar:** `flex:none; height:84px; margin-top:-84px` (overlays the content, which scrolls behind it), `position:relative; z-index:4; display:grid; grid-template-columns:repeat(4,1fr); padding:8px 8px 26px`, bg `var(--x-barA, rgba(29,29,31,.94))`.
- **Items:** `display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px`. Each item fills its grid cell (50px content height).
  - Icon: 22px SVG, viewBox 16, stroke-width 1.5, round caps and joins.
  - Label: 10px / 600.
- **Items, in order:**
  1. **Home:** path `M2.5 7.2L8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5z`, colour t3 `#6E6E73`.
  2. **Community:** star path `M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z`, t3.
  3. **Leagues:** trophy path `M5 2.5h6v3a3 3 0 0 1-6 0zM5 3.5H3v1.2A2.3 2.3 0 0 0 5.2 7M11 3.5h2v1.2A2.3 2.3 0 0 1 10.8 7M8 8.5v2.5M5.5 13.5h5L10 11H6z`, t3.
  4. **Profile:** an avatar, **always shown active**. 24×24 circle, **hard-coded** bg `#0088FF`, letter "D" 11px / 700 white, ring **always drawn**: `0 0 0 2px var(--x-ink,#1D1D1F), 0 0 0 3.5px var(--x-b0,#fff)`. Label colour `#fff`.
- **There is no home indicator in this file.**

**This bar does not match the main app's outside-league bar** (main:639–643, 1857):

| Property | Rankings file (this hub) | Main app |
|---|---|---|
| Items | Home · Community · **Leagues** · Profile | Home · Community · **Players** · Profile (Players shows a "soon" toast) |
| Container | `display:grid`, 84px tall, padding `8px 8px 26px` | `display:flex`, 80px tall, padding `6px 8px 0` |
| Item size | Fills the cell, gap 4px | `flex:1; height:48px`, gap **3px** |
| Inactive colour | t3 `#6E6E73` | Hard-coded `#A1A1A6` |
| Active colour | `#fff` | `#fff` |
| Avatar | 24px, 11px / 700, bg `#0088FF`, ring always | **22px**, 10px / **600**, bg `s.myAv`; ring **only when Profile is active** (`ring: on ? … : "none"`) |
| Community star path | As listed above | `M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z` (different) |
| Home indicator | None | **134×5**, radius 999, bg b0, `position:absolute; left:50%; bottom:8px; translateX(-50%)` |

The README also says the tab bar is 80px with padding `6px 8px 0`. See the open questions.

#### 2.11 Toast
Not triggered anywhere in the hub. The shared toast spec is `position:absolute; bottom:100px; left/right 16px; z-index:40`, ink bg, white 13px / 600, centred, radius 14, padding 12px 14px, auto-dismissing after 2200ms.

---

### 3. Interactions

#### 3.1 Header
- **Back chevron:** `window.location.href = "FieldScout Mobile.dc.html"`, with no hash. See §4 for where that actually lands.
- **Create (+):** `rootCreate`. On the hub it calls `startNewRank(rk.src==="mine" ? null : rk)`. That opens New ranking step 1 (`scr:"rkNew"`), pre-filled with the hub's current **type, scoring and position**; `from` defaults to "ai".
  - This applies on the Experts, Scout AI, Users and Community tabs. The Community tab pre-fills the author's type, scoring and position.
  - On Mine (S5/S6) it uses the defaults: Week 5 / PPR / RB.
  - **With seed data, + from the default view or from Mine lands on step 1 with the button reading "Open my ranking"**, because seeded r1 already is Week 5 · RB · PPR (line 482).
  - `rkOpen` is **not** cleared (see §3.6).

#### 3.2 Source tabs
- A tap runs `set({ rk: { ...R, src: v }, rkOpen: null, myOnly: false })` (line 438).
- **Every tap collapses any expanded row, including a tap on the already-active tab.** That goes for Experts, Scout AI, Users and the author tab alike. Otherwise an active-tab tap changes nothing.
- Type, scoring and position are **kept** across tabs.
- **Leaving the author tab removes it.** The tab only exists while `src` starts with "c:", and nothing in the file brings it back. The filter bar then appears, pre-set to the author's type, scoring and position. (The URL hash still says `#view-<id>`; see §4.)
- **Mine** switches to S5 (title stays "Rankings").

#### 3.3 Filter bar
- **Type pill / Scoring pill:** toggles `rkMenu` between that menu and null. Tapping the same pill again closes it.
- **While a menu is open:**
  - The transparent fixed backdrop covers the whole browser viewport: the other pill, the chips, the rows and the tab bar (and, in the prototype, the jump panel).
  - Any tap outside the panel only closes the menu (`rkMenu=null`). It does not also activate whatever was underneath. So with a menu open, the other pill can't be opened in one tap.
- **Menu option:** sets `rk[type|scoring]`, closes the menu and collapses any open row. Selecting the current value behaves the same.
- **Position chip:**
  - Sets `rk.pos` and collapses the open row.
  - Single-select only: tapping the active chip keeps it, with no deselect.
  - It does **not** close an open menu, though that can't come up because the backdrop is on top.
- **No animation:** the menu mounts and unmounts instantly.

#### 3.4 Rows
- **Tap a player row:** `rkOpen = open ? null : playerFullName`. It toggles that row; opening another row closes the previous one.
- **Not tappable:** tier header rows and the expanded breakdown panel (which is a sibling of the row, so taps don't bubble to it).
- **Expansion is instant**: no height or opacity transition.
- **No other gestures:** rows don't swipe or drag in the hub, there's no long-press, and there's no link to a player profile.
- **Comparison colour rule** (per cell): `d = otherSourceRank − thisRowRank`.
  - |d| ≥ 3 and d > 0 (the other source ranks him **lower**): **red `#FF0028`**.
  - |d| ≥ 3 and d < 0 (the other source ranks him **higher**): **green `#07A852`**.
  - Otherwise t1 `#1D1D1F`.
  - A missing rank shows "–" in t1.
- **Movement arrow rule:**
  - Only when type is ROS or Pre-draft.
  - Value is `round((seeded(name+type+"mv")() − .5) × 7)`, a range of −3…+3.
  - 0 hides the arrow; > 0 shows "▲N" in green `#07A852`; < 0 shows "▼N" in red `#FF0028`.
  - It depends only on player + type, so it is **identical across Experts, Scout AI, Users and Community** and doesn't change with scoring.

#### 3.5 Author card (S4)
- **Follow / Following:** toggles `follows[<communityRankingId>]`.
  - The key is the **ranking id, not the author.** Following @shahranks on r1 does not show "Following" on r5.
  - No toast, no count change ("12k follows" stays static).
  - **This conflicts with the main app**, which keys follows by **author handle** and seeds `cmFollow: { "@shahranks": true }` (main:1414, `followBits` main:1520). Its "Updated by people you follow" card only lists followed authors (main:1549–1550). The hub's `follows` starts empty. So a user who taps "@shahranks · Week 5 · RB · PPR" in "Updated by people you follow" lands on an author card that says **"Follow"**.
  - Follow state isn't persisted (in-memory `setState` only) and isn't shared between the two files.
- **"Start my ranking from this"** opens the Ranking editor (`scr:"ed"`) with:
  - kind "rank", id null, the community ranking's type, scoring and position, `from:"comm"` and `fromBy:"@handle"`.
  - Title `"{Type} · {Pos} · {Scoring}"`.
  - Items: the top 20 of this view, `itemsFrom("c:id", …, 20)`. These include the non-author padding players **and the auto tier line between the author's players and the padding** (§5.5). For r1 the editor shows 15 rows: B. Robinson … B. Allen, then "Tier 2", then S. Barkley, J. Gibbs, D. Henry, C. McCaffrey, D. Achane, J. Wright.
  - Editor subtitle: **"15 players · drag to reorder · started from @shahranks"** (line 507, `comm: E.fromBy`).
  - `start` (the baseline for movement) is set to this order, **`dirty:true`** (Save is immediately enabled, and the status reads "Unsaved changes"), and `status:"new"`.
  - There is **no check for an existing ranking** of the same type, scoring and position. New ranking step 1 does check ("Open my ranking").
  - **Saving creates a duplicate.** Copying r1 while you already own Week 5 · RB · PPR and pressing Save creates a second record with the same title:
    - It gets a new id `"r"+Date.now()`, status "saved", savedAt "Just now", and is **prepended** to `myRanks` (line 501).
    - My rankings then shows two "Week 5 · RB · PPR" cards. The new one reads "Saved" with meta "15 players · 2 tiers · started from another user · Just now".
    - Because the hub's `myRanks.find` (line 446) returns the first match, **"Your rank" in the hub now reads from the copy.** For example, S. Barkley on Experts · W5 · PPR · RB changes from "Your rank #3" to "#10".
  - The editor's back arrow then goes to the hub **Mine** tab (`rk.src="mine"`), not back to the author's ranking, and the author tab is gone.

#### 3.6 Tab bar
- **Home, Community, Leagues:** all three run `window.location.href = "FieldScout Mobile.dc.html"`, the same URL with no hash.
- **Profile:** `go("rk")`, which sets `scr:"rk"`, `rkMenu:null`, `sheet:null`.
  - It **keeps** the current `rk` (source, type, scoring, position), `rkOpen` and `myOnly`.
  - So Profile on Mine stays on Mine, and Profile on S6 stays S6.
  - It does not reset to Experts and does not collapse an expanded row.

#### 3.7 Transitions and scroll
- **No transitions in the hub.** Every state change is an instant re-render. (The README's general "linear, about 200ms" rule isn't applied anywhere in the hub.)
- **There is no scroll reset.** The file has no `scrollTop` or `scrollTo` code, and the hub scroller stays mounted across source-tab, position-chip, menu and Mine changes. The scroll position therefore carries over between filters; the browser only clamps it when the new content is shorter.
- Scroll resets only when the screen unmounts: editor, New ranking or Submitted, then back.

---

### 4. Navigation

**Entry points:**

| From | Mechanism | Lands on |
|---|---|---|
| Main app › Community › Rankings tab card (main:1537) | `…Lists and Rankings.dc.html#view-<id>` | S4 for that community ranking |
| Main app › Community "Updated by people you follow" card (main:1549) | `#view-<id>` (only r1 and r5 have `upd`, and only followed authors show) | S4. The author card says "Follow" even though the user follows them (§3.5) |
| Main app › global search, ranking result (main:1478) | `#view-<id>` | S4 |
| Main app › Notifications row 2, "@shahranks updated Week 5 · RB · PPR" (main:1853) | `#view-r1` | S4 (r1). Nothing on the page shows what was updated (§5.5) |
| Main app › Profile › My stuff › Rankings rows (main:1814) | `#mine` | S6 (My rankings, no tabs) |
| Main app › Profile "New ranking" (main:1816) and Create sheet › Ranking (main:1818) | `#new-ranking` | New ranking step 1, not the hub. **Step 1's close (X) then lands on S1** (Experts · Week 5 · PPR · RB), because `go("rk")` runs with the default `rk` |
| Main app › Profile › My stuff › Lists rows (main:1812) | `#lists` | My lists. **Tab-bar Profile from there lands on S1** |
| Opening the file with no hash, `#rankings`, or an unknown or invalid `#view-xx` | No special handling | **S1 default**: Experts · Week 5 · PPR · RB. `#rankings` is listed in the README but isn't parsed; it simply falls through to the default |
| Within this file | Editor back (rank, line 499) and Submitted › "Back to my rankings" (line 557) | Hub with `src:"mine"`, keeping type, scoring and position. **S5 if `myOnly` is false; S6 in a session entered via `#mine`.** Neither handler resets `myOnly` or `rkOpen` |
| Within this file | New ranking step 1 close (X) | `go("rk")`: hub with whatever `rk`, `rkOpen` and `myOnly` were. A previously expanded row is **still expanded** |
| Within this file | Tab bar Profile | Hub; `rk`, `rkOpen` and `myOnly` unchanged |
| Within this file | Jump panel "Rankings hub" / "Compare sources" | Presentation only. S1 with `src:"ecr"` and current type, scoring and position, collapsed or with ECR row 1 expanded. They don't reset `myOnly` |

**Hash parsing** (`componentDidMount`, line 368). The hash is read once; there is no `hashchange` listener.
- `#view-<id>` with `COMM[id]` present sets `rk = { src:"c:"+id, type, scoring, pos }` from that record and sets `fromComm = true`.
- `#mine` sets `rk.src="mine"` and `myOnly=true`.
- `#lists`, `#new-ranking` and `#new-list` open other screens.

**No browser-history integration.** The file has no `pushState`, `replaceState`, `popstate` or `hashchange` code.
- In-file screen changes never touch the URL. After leaving the author tab the URL still holds `#view-r1`, so **a reload brings the author view back**.
- Browser or OS Back from any in-file screen leaves the file entirely, to whatever page preceded it, instead of going to the previous in-file screen.
- Cross-file moves use `location.href`, which pushes an entry. Back from the main app therefore returns to this file, re-mounted fresh from its original hash, with all in-memory state lost.

**Ways into the Experts / Scout AI / Users hub.** No main-app link targets them directly. They're reachable only indirectly:
- `#view-<id>`, then tap a tab.
- `#new-ranking`, then X.
- `#lists`, then the tab-bar Profile.
- The editor or Submitted screen back to Mine (S5), then tap a tab.
- Opening the file directly.

From `#mine` (S6) the tabs are hidden, so the source rankings can't be reached in that session.

**Exits:**
- **Back chevron:** `FieldScout Mobile.dc.html` with no hash. The main app ignores hashes and starts at `scr:"league", tab:"match"` (main:1414), so in the prototype the back button lands on **League › Match**.
  - The handler is named `goProfile`, which suggests Profile was intended.
  - `fromComm` is set when arriving via `#view-` but **never read**, and `cv.back` (→ APP) is defined but bound nowhere. The likely intent is to return to Community when you arrived from Community; it isn't implemented.
- **Tab bar Home / Community / Leagues:** the same URL, so in the prototype all three land on League › Match.
- **Create (+):** New ranking step 1 (same file).
- **Start my ranking from this:** Ranking editor (same file).

**Dock on this screen:**
- The tab bar is visible on every hub state, with Profile highlighted (Rankings is treated as part of Profile's "My stuff").
- There is no league switcher.
- The scroller gets 84px of bottom padding (`dock-sm`).
- The fixed root header (back + create) stays above the scroller and doesn't scroll.

---

### 5. Data shown

#### 5.1 Rank list composition (`rank(src,type,sc,pos)`, line 374)
- **Players:** everyone at the selected position (`posOk`).
- **Bye exclusion:** weekly types exclude any player whose bye equals that week. **No player in `PL` has a Week 5 bye**, so this only bites in Week 6. Week 6 drops Bijan Robinson, Tyler Allgeier, Justin Jefferson, DK Metcalf, Darnell Mooney, Ka'imi Fairbairn, and the Steelers and Texans D/ST.
- **Order:** sorted by a source-specific score, descending.
- **Cap:** the hub shows **the top 24** (40 for "ALL", which the hub can't select). The sample data has at most 15 per position (QB 10, RB 15, WR 15, TE 8, K 3, D/ST 3).
- **Weeks available:** the hub's weekly options are **hard-coded to Week 5 and Week 6** (`TYPES`, line 324). New ranking offers Weeks 5–8 (line 483), and My rankings opens Weeks 5–8 (`EDIT_TO = CUR_WK+3`, line 331). A user's Week 7 or Week 8 ranking can never be compared in the hub, and seeded r3 (Week 4) can't be either.
- **Score model (placeholder, `scoreOf`, line 334):**
  - `v = base + rec × ppr × 3.2 − (sc==="std" ? rec × .5 : 0)`, where `ppr` is 1 for PPR, 0 for Standard, and **0.5 for "half"**. That branch exists but has no UI, since `SCOR` is only ppr/std.
  - Half PPR does appear in the main app, but only in the start/sit poll composer (main:1591) and in a main-app ranking composer (main:1593) that is unreachable: the Create sheet's Ranking option navigates to `#new-ranking` before that branch runs (main:1818). So no reachable path produces a Half PPR ranking.
  - Plus source noise:
    - **Each individual expert e0–e4:** `(seeded(n+"e"+k+type+sc)() − .5) × 3.4`, i.e. ±1.7.
    - **Experts (ECR):** the **mean of those five noises**, so the ECR score is the average of the five expert scores. This gives Best expert, Worst expert and Std dev real meaning: the min, max and population SD of those five ranks.
    - **Scout AI:** ±1.5 (×3).
    - **Users and any other src:** ±2.2 (×4.4).
  - Plus type noise: weekly ±2.25 (`seeded(n+type+"m")`, ×4.5); Pre-draft ±1.2 (`seeded(n+"pre")`, ×2.4).

#### 5.2 Auto-tiering (`breaks`, line 376)
Applies to every hub view.
1. Compute the gaps between consecutive scores.
2. Take `mean` = the average gap (0 for a 1-row list).
3. Insert a tier break before index i+1 when **gap > 1.55 × mean**, **at least 2 players** have passed since the previous break (so the first tier always has ≥ 2), and **fewer than 7** breaks exist so far (max 8 tiers).
4. The last tier can hold 1 player.

Tier numbering starts at 1. Count copy is "{n} players". Sparse K and D/ST views are covered in S14: one tier in 40 of 48 views, otherwise 2 + 1.

#### 5.3 Row fields
| Field | Format | Source / rule |
|---|---|---|
| Rank | "1", "2", … | Index in this source's list |
| Movement | "▲2" / "▼3" | ROS and Pre-draft only; placeholder seeded value (§3.4) |
| Name | "S. Barkley" | Short form (§2.9) |
| Subline (weekly) | "PHI @ BAL" / "DET vs NYG" | Team + seeded opponent (`oppOf`, line 333). See the opponent notes below the table. Placeholder |
| Subline (ROS / Pre) | "CIN · Bye 10" | Bye from the player table (see §5.7) |
| Pts | "54.5" (1 decimal) | Season-to-date total = avg × games played (3 or 4 games; `gp = 4`, or 3 with 15% odds) |
| Avg | "18.2" (1 decimal) | Season-to-date points per game, `base × (.78 + rand × .4)` |
| Pos rk | "RB9", "D/ST2" (no space) | Rank by season Pts within the position |
| Comparison ×2 | "3", "–" | The other two sources' ranks; colour rule §3.4 |

**Opponent notes (`oppOf`):**
- The opponent is random per player and week, drawn from `TEAMS32`. It is not a real schedule.
- **Teammates show different opponents in the same week.** For example, in Week 5 S. Barkley shows "PHI @ BAL", J. Hurts "PHI @ SEA" and A. Brown "PHI vs DEN".
- **Self-match rule:** `if (o === p.team) o = "DAL"`. A Dallas player who rolls DAL keeps DAL, so **"C. Lamb · DAL vs DAL"** renders in every Week 5 WR view: Experts, Scout AI and Users under both scorings, plus `#view-r5` (7 views).
- **Opponents can be on bye.** In Week 6, 6 rows face a bye team: J. Taylor "IND vs ATL", G. Wilson "NYJ vs PIT", T. McBride "ARI @ HOU", T. Kelce "KC vs PIT", D. Kincaid "BUF vs HOU", and Broncos D/ST "DEN @ ATL".
- An opponent matchup rank (`oppOf().rk`) is computed but **not displayed**.

Pts, Avg and Pos rk are **the same regardless of type or scoring**; PPR vs Standard doesn't change them. All three are placeholder.

#### 5.4 Breakdown values and agreement note
- **Experts / Scout AI / Users:** "#" + that source's rank. The current source uses the row index; the others are looked up over the full list.
- **Best / Worst expert:** "#" + min / max of the 5 expert ranks.
- **Std dev:** population SD of the 5 expert ranks, `toFixed(1)`.
- **Your rank:** "#" + the position in the first matching `myRanks` record, or "–".
- **Note:**
  - If SD > 2.2: **"Experts disagree on {Short name}. Range #{best} to #{worst} is wider than most at this tier."**
  - Else, if worst − best ≤ 2: **"Experts mostly agree. Every expert has him within two spots."**
  - Else: **"Experts mostly agree. Range #{best} to #{worst}."**
  - The copy says "him" even for K and D/ST, and even for a one-row list. **The app names the player instead:** "Every expert has {Short name} within two spots" (gap list §4 item 16).

**What the sample data actually renders** (checked across all 150 views):
- **"Experts disagree on …" never renders.** The highest SD is 2.04 (Experts · W5 · PPR · WR, G. Wilson, expert ranks 3, 5, 7, 8, 3).
- **"Your rank –" never renders with seed data**, because every player is in the matching seeded ranking. It appears only after the user saves a partial ranking of the same type, scoring and position, e.g. "Start blank" plus a few players.
- **"Std dev 0.0" is common.** Examples: `#view-r4` row 1 (T. Kelce), `#view-r6` row 1 (J. Taylor), and Week 6 D/ST (Broncos D/ST, with all five cells "#1").

Verified example (default view, row 1 expanded):
- Cells: Experts #1 · Scout AI #3 · Users #3 · Best expert #1 · Worst expert #3 · Your rank #3.
- Note: "Experts mostly agree. Every expert has him within two spots."

#### 5.5 Community rankings (COMM, lines 356–363, placeholder)
| id | by | av | acc | follows | type · pos · scoring | time | note | top (author's order) |
|---|---|---|---|---|---|---|---|---|
| r1 | @shahranks | #0088FF | #1 accuracy in 2025 | 12k | Week 5 · RB · PPR | 40m ago | "Hubbard is my RB value of the week. Conner down with the ankle." | Bijan Robinson, Jonathan Taylor, Kyren Williams, Chuba Hubbard, James Conner, Alvin Kamara, Isiah Pacheco, Tyler Allgeier, Braelon Allen |
| r2 | @ortizff | #F75252 | #2 accuracy in 2025 | 8.4k | Rest of season · WR · PPR | 5h ago | (none) | Puka Nacua, A.J. Brown, Garrett Wilson, DK Metcalf, Zay Flowers, Jameson Williams, Rome Odunze |
| r3 | @halefantasy | #ECAD48 | #5 accuracy in 2025 | 3.2k | Week 5 · QB · Standard | 8h ago | "Fields is a top 8 play with the rushing floor." | Josh Allen, Jalen Hurts, Baker Mayfield, Justin Fields, Shedeur Sanders |
| r4 | @kellyscouts | #5C7CE5 | #9 accuracy in 2025 | 2.1k | Pre-draft · TE · PPR | 1d ago | "Warren is already a top 5 TE for 2027 drafts." | Travis Kelce, Tyler Warren, George Kittle, Dalton Kincaid, Evan Engram, Cole Kmet |
| r5 | @shahranks | #0088FF | #1 accuracy in 2025 | 12k | Week 5 · WR · PPR | 1h ago | (none) | A.J. Brown, Puka Nacua, Garrett Wilson, DK Metcalf, Zay Flowers, Jameson Williams, Rome Odunze |
| r6 | @bellball | #07A852 | #11 accuracy in 2025 | 640 | Rest of season · RB · Standard | 2d ago | (none) | Jonathan Taylor, Bijan Robinson, Kyren Williams, James Conner, Chuba Hubbard, Alvin Kamara |

**How a community view is built (`scoreOf` with src "c:<id>"):**
- Each author `top` player scores `1000 − index`, so they take ranks 1…k in the author's order.
- **Every other player at the position is then appended, sorted by score.** They fall into `scoreOf`'s else-branch: base + PPR/Std adjustment + **±2.2 noise** (seed `n+"c:<id>"+type+sc`), + ±2.25 for weekly or ±1.2 for Pre-draft. It is the same model as a Users list, with a different seed. Capped at 24 total.
- `rank()`'s **bye filter still applies**, so an author `top` player on bye that week would be **silently dropped**. This is latent with sample data: no community ranking is Week 6.
- Because of the 1000-point jump, the tier algorithm **always produces exactly 2 tiers**: Tier 1 is the author's list, Tier 2 is the padding. Verified for all 6.
  - r1: 9 + 6. r2: 7 + 8. r3: 5 + 5. r4: 6 + 2. r5: 7 + 8. r6: 6 + 9.
- In S4 the 6th breakdown cell is "Your rank" for r1 and r2 (they match seeded r1 and r2) and "Std dev" for r3–r6.

**The main app's matching CMFEED records** (main:1342–1347) disagree with the hub in several ways:
- **Extra players.** They list players this file lacks: r1 adds "Jordan Mason", r2 adds "Khalil Shakir", r5 adds "Khalil Shakir" (6th), and r6 adds "Jordan Mason". These are missing from the hub, because the Rankings file's player table doesn't contain them.
- **Lost update data.** The main app shows r1 as "Updated 40m ago · 4 changes" with moves C. Hubbard ▲4 and J. Conner ▼3 (main:1342, rendered at main:1549). r5 is "Updated 1h ago · 2 changes" with K. Shakir ▲5. The hub shows none of this:
  - r1, r3 and r5 are weekly, so they render no arrows at all.
  - The author card says "submitted {time}", not "updated".
  - The notification "@shahranks updated …" therefore leads to a page that doesn't show what changed.
- **Contradictory arrows.** The ROS and Pre-draft community views show the seeded arrows (`n+type+"mv"`), which contradict CMFEED:

  | Ranking | Hub shows | CMFEED says |
  |---|---|---|
  | r2 | P. Nacua ▼2, R. Odunze ▲2 | Puka ▼1, Odunze ▲3 |
  | r4 | T. Warren ▼3 | Warren ▲2 |
  | r6 | J. Taylor ▼2 | Taylor ▲1 |

#### 5.6 Verified default render (Experts · Week 5 · PPR · RB)
Info line: "Consensus of 5 experts · updated 9:12 AM" · header "Scout AI · Users".

**Tier 1 (#4A68D4), 3 players**
1. S. Barkley — PHI @ BAL — 54.5 / 18.2 / RB9 — AI 3, Users 3
2. B. Robinson — ATL @ SEA — 82.0 / 20.5 / RB2 — AI 2, Users 2
3. J. Gibbs — DET vs NYG — 86.4 / 21.6 / RB1 — AI 1, Users 1

**Tier 2 (#8656D8), 8 players**
4. C. McCaffrey — SF vs CLE — 65.2 / 16.3 / RB6 — AI 4, Users 4
5. K. Williams — LAR vs CIN — 62.8 / 15.7 / RB7 — AI **9 red**, Users **10 red**
6. J. Taylor — IND vs PHI — 80.4 / 20.1 / RB3 — AI 6, Users **9 red**
7. D. Henry — BAL vs DET — 75.6 / 18.9 / RB4 — AI 7, Users 5
8. A. Kamara — NO vs TEN — 56.1 / 14.0 / RB8 — AI **5 green**, Users 6
9. D. Achane — MIA vs JAX — 71.4 / 17.8 / RB5 — AI 8, Users 8
10. J. Conner — ARI vs CHI — 43.2 / 10.8 / RB12 — AI 10, Users **7 green**
11. C. Hubbard — CAR @ DET — 53.4 / 13.4 / RB10 — AI 11, Users 11

**Tier 3 (#07A852), 3 players**
12. B. Allen — NYJ @ CLE — 37.1 / 9.3 / RB13 — AI 12, Users 13
13. I. Pacheco — KC vs CLE — 44.4 / 11.1 / RB11 — AI 14, Users 12
14. J. Wright — MIA vs PIT — 27.8 / 7.0 / RB14 — AI 13, Users 14

**Tier 4 (#C98A1F), "1 players"**
15. T. Allgeier — ATL @ PIT — 23.3 / 5.8 / RB15 — AI 15, Users 15

#### 5.7 Placeholder vs real
- **README statement:** "All stats, projections, votes, ranks and accuracy numbers are placeholder data… Player names are real NFL players." The README says nothing either way about teams or byes.
- **Placeholder:**
  - Every rank, score, movement value, opponent, Pts, Avg and Pos rk.
  - The "2,418" user count and the "updated …" times.
  - The COMM authors, accuracy, follows, times and notes.
  - The headshot coverage.
- **Teams and byes are not product-true.**
  - Teams look like 2025 rosters (e.g. DK Metcalf PIT, Evan Engram DEN, Justin Fields NYJ).
  - Byes look like the 2025 schedule, adjusted so that **no team has a Week 5 bye** (the current week). ATL and PIT are listed as bye 6 and CHI as bye 7, where they appear to have been Week 5 byes in 2025. This comes from my recollection of the 2025 schedule, not from the source.
  - Treat both as sample data to be replaced by the real feed.
- **Real (product structure):** player names; the sources; type × scoring × position; auto-tiers; the comparison colour rule; the breakdown cells and note logic.

---

### 6. Dark mode (`.fs-dark`, line 19)

**How it's toggled:**
- The jump-panel **"Dark mode"** switch (`toggleDark`, line 579) flips `state.dark` and writes `localStorage["fieldscout-theme"]` = "dark" or "light". The switch is presentation only: track 36×22, `#07B85A` on / `#C7C7CC` off.
- `localStorage` is **read once**, in `componentDidMount` (line 368). There is no `storage` listener, so a theme change made in the main app (e.g. Profile's Dark/Light pill) doesn't reach an already-open Rankings page until it reloads.
- `state.dark` adds class `fs-dark` to the 390×844 phone frame (`themeCls`), and the tokens below switch under it.

**Tokens that switch:**

| Element | Token | Dark value |
|---|---|---|
| Page, sticky filter bg, menu panel, author-card button, breakdown cells | b0 | `#121212` |
| Author card, breakdown panel | b1 | `#282828` |
| Back button, unselected chips and menu options, filter-bar border, row borders | b2 | `#333333` |
| Tab-strip border, tier rules, stat/compare divider, filter divider, Following pill bg, button ring | b3 | `#3E3E3E` |
| Text: primary | t1 | `#FFFFFF` |
| Text: note, agreement note, Following | t2 | `#D9D9D9` |
| Text: secondary (inactive tabs, labels, meta, info line, tier counts, bar items), Tier 7–8 labels | t3 | `#B3B3B3` |
| Info dot (non-pre) | t5 | `#727272` |
| Type/scoring pills, selected menu option, **active tab underline** | ink | `#4D4D4D`. Low contrast against `#121212`; that's what the source shows |
| Tab bar | barA | `rgba(18,18,18,.92)` |
| Avatar ring | ink + b0 | `#4D4D4D`, then `#121212` |

**Hard-coded colours that do not switch:**
- `#0088FF` (accent, selected chip, Follow, Create, avatar).
- `#07A852` and `#FF0028` (comparison and movement). The README's dark success and danger text values are `#1ED760` and `#FF6B6B`, and the file defines `--x-tg` and `--x-tr` for them, but the hub doesn't use them.
- Tier hexes `#4A68D4 #8656D8 #07A852 #C98A1F #E03E3E #5E8C8C`.
- `#07D066` (Pre-draft dot).
- COMM avatar colours and the white text on pills.
- Headshot fallback `#EEEEF1` / `#6E6E73` and its 1px `#fff` ring gap; team ring colours (e.g. LV `#000000` on a near-black page).
- Menu shadow `0 10px 30px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.05)`.

---

### Open questions
- Critic finding adjusted, not dropped: the claim that the README says 'only player names are real and everything else is placeholder' overstates the source. The README says stats, projections, votes, ranks and accuracy are placeholder and names are real, and says nothing about teams or byes. §5.7 now quotes the README and treats teams and byes as sample data. The '2025 bye table adjusted' observation comes from my recollection of the 2025 schedule, not from the source.
- Critic finding adjusted: 'the main app's Community composer offers Half PPR (main:1591/1593)'. Line 1591 is the start/sit poll composer. Line 1593 is a main-app ranking composer that can't be reached, because the Create sheet's Ranking option navigates to #new-ranking before that branch runs (main:1818). So no reachable path creates a Half PPR ranking. The scoreOf 'half' branch exists with no UI.
- Critic line numbers were off by a few lines: oppOf is at line 333 and scoreOf at 334 (not 336/340). The spec uses the verified numbers.
- Correction to the earlier spec: it said nothing in the main app reaches the Experts/Scout AI/Users hub except #view- plus a tab tap. The source shows two more indirect paths that land on S1: #new-ranking then X, and #lists then the tab-bar Profile. Neither is a deliberate entry. Where should users enter the source rankings (a Rankings entry under Profile, Community's Rankings tab, Home)?
- README vs prototype: the README says Pre-draft is hidden in season, and My rankings treats Pre-draft as closed ('Opens for 2027 drafts'), but the hub's type menu always offers Pre-draft and community r4 is a Pre-draft ranking. Hide Pre-draft in the hub in season, or keep it?
- The hub's type menu only offers Week 5 and Week 6, while New ranking and My rankings open Weeks 5–8 (current through +3). A user's Week 7 or 8 ranking can never be compared in the hub. Which weeks should the hub list?
- When Pre-draft is selected, the info-line dot turns green (#07D066) and the copy reads 'updated 4 min ago'. What is the green dot meant to signal (live, fresh, or something else)?
- Back chevron: the handler is named goProfile but opens the main app with no hash, which lands on League › Match. fromComm is set on #view- links but never read, and cv.back is unbound. Should Back return to Community when the user came from Community, and to Profile otherwise?
- Tab bar: this file's bar (Home · Community · Leagues · Profile; 84px grid; 24px always-ringed #0088FF avatar; inactive #6E6E73; no home indicator) differs from the main app's (Home · Community · Players · Profile; 80px flex; 48px items with gap 3; 22px avatar in s.myAv, ringed only when active; inactive #A1A1A6; 134×5 home indicator) and from the README (80px). Home, Community and Leagues here all open the same URL. Which bar is canonical? Proposal: reuse the main app's bar.
- Follow model: the hub keys follows by ranking id and starts empty, but the main app keys them by author handle and seeds @shahranks as followed. Arriving from 'Updated by people you follow' shows 'Follow' for an author you already follow, and following @shahranks on r1 doesn't carry to r5. Confirm Follow should be per author and shared app-wide.
- Author update data: the main app advertises 'Updated 40m ago · 4 changes' (Hubbard ▲4, Conner ▼3), and the notification says '@shahranks updated…'. The hub's author view shows 'submitted 40m ago' and no arrows for weekly rankings. For ROS/Pre-draft, its seeded arrows contradict CMFEED (r2 Puka ▼2/Odunze ▲2 vs ▼1/▲3; r4 Warren ▼3 vs ▲2; r6 Taylor ▼2 vs ▲1). Should the author view show the author's own changes since their last update?
- A community author's ranking is padded with every other player at the position as 'Tier 2' (ordered like a Users list), as if the author ranked them. 'Start my ranking from this' copies that padding and the tier line too. Show only the author's players, or label the rest as not ranked by the author?
- 'Start my ranking from this' doesn't check for an existing ranking with the same type, scoring and position (New ranking step 1 does). Copying r1 while owning Week 5 · RB · PPR creates a duplicate on Save that then shadows the original for the hub's 'Your rank'. Should it open the existing ranking, or ask before replacing it?
- After leaving the author tab it disappears and can't be reopened, though the URL still says #view-<id>, so a reload restores it. The editor's back from a copied ranking goes to Mine, not the author's ranking. Is that intended?
- Browser history: no in-file screen pushes a history entry, so browser or OS Back leaves the Rankings file entirely, and returning re-mounts it from the original hash with state lost. In the Next.js rebuild, should each hub state (source, type, scoring, position, author view) be URL-addressable with Back stepping through them?
- Scroll is never reset when switching source, position or type (the scroller stays mounted). Keep the scroll position across filters, or reset to the top?
- Expanded-row state survives leaving and returning (New ranking X, tab-bar Profile, editor back). Keep it, or collapse on return?
- Pts, Avg and Pos rk ignore scoring and type: they're season-to-date and identical under PPR and Standard. Should they follow the selected scoring, and should weekly views show a projection instead?
- The movement arrows (ROS and Pre-draft) are identical across Experts, Scout AI, Users and Community, and ignore scoring. What is the baseline (since last update, last week, or preseason), and is it per source?
- The weekly opponent is seeded per player, not a real schedule. That gives 'C. Lamb · DAL vs DAL' in every Week 5 WR view, teammates facing different opponents, and Week 6 opponents who are on bye (e.g. 'DEN @ ATL'). Confirm the opponent comes from the real schedule. Also, a matchup rank is computed but not shown: should rows colour the opponent by matchup (README: rank ≥ 23 green, ≤ 10 red, otherwise orange)?
- Copy edge cases: the tier count reads '1 players'; the agreement note says 'him' for K and D/ST and 'Every expert has him within two spots' even for a one-row list. Approve fixing these ('1 player', neutral wording)?
- The 'Experts disagree on …' note never appears with sample data (max SD 2.04 vs the 2.22 threshold). Is the 2.2 threshold intended, or should disagreement be relative to tier or position?
- Names get about 67px at 390 wide. Measured offline, about 17 of 54 short names truncate (e.g. B. Robinson, K. Williams, C. Hubbard, C. McCaffrey, A. St. Brown, all D/STs). The Users ROS/Pre-draft and community info lines also truncate. Accept the truncation, or tighten the columns or shorten the copy?
- No loading, empty or error states are designed for the hub (for example a source with no ranking for this type, Users for Pre-draft, a position or week with zero eligible players, or a fetch failure). K and D/ST views can be a single row. Should we extend the design language for these?
- The type and scoring pills look the same whether or not their menu is open, the menu backdrop is fully transparent and swallows the first outside tap, and rows have no pressed state. Keep that as designed, or add open and pressed states?
- rootSeg (a Rankings/Lists segmented control) is computed but never rendered. Was a Rankings/Lists switch meant to be in the header?
- Dark mode uses fixed #07A852 and #FF0028 for the comparison and movement colours instead of the README's dark #1ED760 and #FF6B6B (available as --x-tg/--x-tr), and the active-tab underline becomes #4D4D4D on #121212. Keep these as designed, or use the dark tokens?
- Theme is read from localStorage only on load, so a theme switch in the main app doesn't apply to an open Rankings page. In the rebuild the theme should be app-wide state. Confirm. (CLAUDE.md also says the redesign is single-theme with no dark/light toggle, which conflicts with this handoff's dark mode; that needs a ruling.)
- FSHeadshot.dc.html, referenced by the README, is missing from 'FieldScout Mobile Handoff/'. A copy is in 'design_handoff_fieldscout_mobile/' (the Rankings file and assets are byte-identical). Which folder is the canonical handoff?

---

## Gap analysis vs the current app

## Rankings hub: spec vs. current app (worktree redesign-v7 @ 27d455b)

### What the app has today
The app has no unified Rankings hub. Three separate surfaces sit closest to it, and all three are switched off by feature flags for the 2026 go-live (`src/lib/feature-flags.ts`: `weeklyRanks`, `bigBoard`, `consensus`).
- `/app/weekly-ranks` (`src/components/weekly-ranks/weekly-ranks-view.tsx`): the user's own weekly board. It supports drag-to-edit and a Submit button, has QB/RB/WR/TE/FLEX chips and Week 1–18 + "Pre draft" tabs (`big-board/week-tabs.tsx`), and a "Reset to Scout AI" button that is only a "coming soon" stub (`TODO(scout-ai)`).
- `/app/big-board` (`src/components/big-board/big-board-dashboard.tsx`): a source picker (My board / "Expert consensus" / ADP / Auction / AI personas), position (ALL/QB/RB/WR/TE/FLEX/K/DEF), scoring (Standard/Half/Full PPR), team, search, a tiers toggle and card-field options.
- `/consensus` (`src/app/consensus/page.tsx`): a public, server-rendered, cred-weighted list.

### Backend facts that drive the classification
- **"Expert consensus" is mislabelled.** `useConsensusBoard` (`src/hooks/use-board-sources.ts`) reads `consensus_rankings`, which averages **users'** public lists. The app has no real expert feed.
- **`consensus_rankings` is never refreshed.** It is a MATERIALIZED VIEW (`supabase/migrations/001_initial_schema.sql:1020`), and nothing in migrations or in `src/app/api/cron/*` refreshes it, so it never updates.
- **`consensus_rankings` mixes every kind of list.** It averages `overall_rank` across all public lists of any type. It has no week, position or scoring dimension, and only a per-player `ranker_count`, not a total.
- **`weekly_rankings` exists but nothing uses it.** The table (user, season, week, position, rankings jsonb, accuracy_score; 001:436) has RLS, but no code reads or writes it.
- **There is no accuracy grading.** `cred_scores`, `profiles.cred_rank` and `accuracy_score` exist, but no job fills them (see `docs/specs/spec-submissions-cred.md`).
- **The persona scraper is a dead end.** `persona_source_rankings` (021) is service-role only, and `scripts/scrape-persona-sources.ts` has no source URLs. The standing rule is no scraping service, RSS and YouTube only.
- **Rank history covers only the user's own big board.** `ranking_history` exists, but nothing writes to it. `big_board_snapshots` (010) covers only the user's own big board.
- **Real data already available:**
  - `players.bye_week` (`src/lib/sync/bye-weeks.ts`).
  - The `nfl_games` schedule (`src/lib/sync/schedule.ts`, `src/hooks/use-nfl-week-games.ts`).
  - Season points by scoring: `/api/players/builder` returns `current_pts` and `current_games`.
  - Projections: `player_weekly_projections` (136) and `players.projected_pts_*`.
  - `NFL_TEAM_COLORS` (`src/lib/nfl-team-colors.ts`), with the same hexes as the prototype's TC.
  - Follows: the `follows` table, `profiles.follower_count` and `useToggleFollow` (`src/hooks/use-follows.ts`).
  - Pins: `list_favorites`, which drive `list_updated` notifications (019).
  - The `duplicate_list` RPC (`src/app/api/lists/[id]/duplicate/route.ts`).
  - `getCurrentNflWeek` (`src/lib/sports-data/nfl-state.ts`).
- **Mobile groundwork is already at HEAD (27d455b):** the `m-*` light/dark tokens (`globals.css`, `tailwind.config.ts`), the `mob:` variant, and `theme-store.ts`, which uses the handoff's own `fieldscout-theme` key.
- **The bottom tab bar is still the old one.** `src/components/layout/bottom-tabs.tsx` is the 5-tab ink bar (Home/Lists/Players/Search/More, lime active state).

### Gap table
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| **DATA SOURCES & MODEL** | | | |
| Experts source: "Consensus of 5 experts" ranking for each type × scoring × position | needs-new-backend | `use-board-sources.ts` useConsensusBoard (actually user consensus); `021_persona_source_rankings.sql`; `scripts/scrape-persona-sources.ts` | No expert feed exists. Getting one needs a licensed or free source **and** a ruling, because of the RSS/YouTube-only rule. AI persona boards could stand in, but they're season-only and AI-generated. |
| Per-expert ranks behind Best expert, Worst expert and Std dev | needs-new-backend | none | The hub needs each expert's individual rank, not only the average. |
| Scout AI source for each type × scoring × position | needs-new-backend | `weekly-ranks-view.tsx` handleResetToScoutAi stub; `/api/lists/generate` + `lib/claude/*`; `player_weekly_projections` (136) | The AI generation pipeline and weekly projections exist and could feed it, but nothing produces or stores a Scout AI ranking per view. |
| Users source: "Average of 2,418 user rankings" for each type × scoring × position | needs-new-backend | `consensus_rankings` mat-view (001:1020); `/consensus`; useConsensusBoard | The existing view is season-only and never refreshed (no REFRESH anywhere). It mixes all list types and has no position or scoring dimension. Needs a new aggregate over the new ranking records. |
| User ranking record (type W-n / ROS / Pre-draft × scoring × position; draft / saved / submitted) | needs-new-backend | `weekly_rankings` (001, unused); `big_board_weekly` + `/api/big-board/week/[weekNumber]`; `lists.is_big_board` | The current boards are one cross-position list per week plus one season board. They have no scoring, no separate ROS type and no status. The big board doubles as both "Pre draft" and "rest of season". The hub, the Mine tab, "Your rank" and community rankings all depend on this model. |
| Community ranking view (S4: someone else's typed ranking) | needs-new-backend | public lists + `use-explore-feed.ts` | Depends on the ranking model. Public lists and their authors exist, but not as typed rankings. |
| Author accuracy line ("#1 accuracy in 2025") | needs-new-backend | `cred_scores`, `profiles.cred_rank`, `weekly_rankings.accuracy_score` (no job) | Needs accuracy grading per `spec-submissions-cred.md`. |
| Author follows count ("12k follows") | new-ui-on-existing-data | `profiles.follower_count` | Needs a compact number format ("12k", "8.4k"). |
| Follow / Following pill | new-ui-on-existing-data | `follows` table, `use-follows.ts` useToggleFollow | Follows are per author. The prototype keys them per ranking (see questions). Per-ranking "follow" is closer to pinning (`list_favorites`). |
| Author avatar (36px circle with a colour fill and one initial) | new-ui-on-existing-data | `profiles.avatar_url`, `ui/user-avatar.tsx` | There's no avatar-colour field; derive a colour or use the uploaded image. |
| Author note | needs-new-backend | `lists.description` (analog) | Part of the ranking model. |
| "Start my ranking from this" (copies the top 20 and their tier line into the editor, records "started from @x", unsaved) | needs-new-backend | `duplicate_list` RPC (`/api/lists/[id]/duplicate`) | Needs the ranking model plus a field for who it was copied from. The prototype never checks for an existing ranking and saves a duplicate (see questions). |
| Movement arrows ▲N / ▼N (ROS, Pre-draft) | needs-new-backend | `big_board_snapshots` (own board only); `ranking_history` (unwritten) | Needs a dated history for each source ranking. The prototype values are random seeds. |
| "Your rank" cell (S10) | needs-new-backend | none | Needs a lookup into the user's matching ranking (ranking model). |
| Info-line details (expert count, user count, "updated 9:12 AM") | needs-new-backend | none | Each source must carry a count and an updated-at time. |
| Comparison columns (the other two sources' ranks) and the ±3 colour rule | needs-new-backend | none | The colour logic itself is trivial UI. It is blocked by the Experts, Scout AI and Users sources. |
| **ROW DATA** | | | |
| Pts / Avg / Pos rk to date ("54.5 / 18.2 / RB9") | new-ui-on-existing-data | `player_stats`, `lib/scoring/default`, `/api/players/builder` (current_pts, current_games) | Pos rk isn't computed yet but can be derived. The real numbers should follow the selected scoring; the prototype keeps them fixed. Position code DEF must display as "D/ST2". |
| Weekly subline "PHI @ BAL" / "DET vs NYG" | new-ui-on-existing-data | `nfl_games` (`lib/sync/schedule.ts`), `use-nfl-week-games.ts` | The real schedule removes the prototype's random-opponent bugs ("DAL vs DAL", teammates with different opponents). |
| ROS / Pre subline "CIN · Bye 10" | new-ui-on-existing-data | `players.bye_week` (`lib/sync/bye-weeks.ts`) | Real data. |
| Weekly bye exclusion | new-ui-on-existing-data | `players.bye_week` | An author's player who is on bye drops out silently (see questions). |
| Headshot: 36px, team-colour ring, initials fallback, scaled crop | restyle-only | `players/player-image.tsx` PlayerAvatarImage, `lib/nfl-team-colors.ts` | Colours already match. The app shows a team logo for D/ST where the prototype shows the initial "B". It adds the WSH alias. |
| Short names ("S. Barkley", "A. Brown") | restyle-only | `draft/draft-board-ops.ts` abbreviateName (`utils/format-name.ts` abbreviates differently) | The name column gets about 67px, so about 17 of 54 names ellipsise (see questions). |
| Rank number column | restyle-only | `big-board/board-row.tsx`, `players/player-row.tsx` | |
| **TIERING** | | | |
| Auto-tiers by score gaps (gap > 1.55 × mean, at least 2 per tier, at most 8 tiers) | new-ui-on-existing-data | `big-board-dashboard.tsx` tierBands (fixed proportional cuts, a different algorithm); list tiers are manual | A pure util, but it needs a numeric score from each source: a projection for Scout AI, an average rank for Users. The choice of score depends on the backend. |
| Tier header ("Tier N" in its colour, a rule, "N players") | restyle-only | `lists/bucket-colors.ts` TIER_RAMP | Use the hub's six-colour cycle. Fix "1 players". |
| **HUB CHROME** | | | |
| Root header: 34px back circle + 34px blue Create (+) | new-ui-on-existing-data | `layout/app-shell.tsx` (TopNav + BottomTabs on mobile), `layout/top-nav.tsx` CreateMenu | The mobile app has no per-screen root header. CreateMenu only covers lists and leagues. |
| Page title "Rankings" / "My rankings" (26/700) | restyle-only | weekly-ranks-view PageHeader "Rankings" | |
| Source tabs (Experts · Scout AI · Users · [@author] · Mine) with an underline | new-ui-on-existing-data | big-board-dashboard source `<Select>` | A new control. The author tab appears and disappears with the view. It is hidden in the `#mine` view. |
| Sticky filter bar (type pill, scoring pill, divider, QB…D/ST chips; scrolls sideways) | new-ui-on-existing-data | weekly-ranks Segment (QB/RB/WR/TE/FLEX), `week-tabs.tsx`; big-board Selects (ALL/FLEX/K/DEF) | The position set changes: K and D/ST are added, FLEX and ALL dropped. At rest the K chip is clipped and D/ST is off-screen. |
| Type menu popover ("Ranking type": Week N, Week N+1, Rest of season, Pre-draft) | new-ui-on-existing-data | `ui/popover.tsx`, `getCurrentNflWeek` | Weeks should come from the current week, not hard-coded W5/W6. The menu layer must sit above the dock, and outside taps only close it. Overlay shadows are allowed. |
| Scoring menu (PPR / Standard) | new-ui-on-existing-data | big-board SCORINGS (std/half/ppr) | The app has Half PPR; the hub drops it (see questions). |
| Info line (dot, source text, comparison header, Pre-draft green dot) | new-ui-on-existing-data | none | The text depends on the source metadata above. The Users ROS/Pre and community lines truncate. |
| Expanded breakdown panel (6 cells: Experts, AI, Users / author, Best, Worst, Std dev / Your rank) | needs-new-backend | none | The UI is new. It needs per-expert ranks and the ranking model. |
| Agreement note ("Experts mostly agree…" / "Experts disagree on…") | new-ui-on-existing-data | none | Pure copy logic on the breakdown data. Fix "him" for K and D/ST. "Disagree" never shows with the sample data. |
| Row tap expands one row at a time; no player link | out-of-scope-or-question | `players/player-link.tsx`, `use-open-player.ts` | **Conflicts** with the standing rule "every player click opens the mini card first". The hub has no route to the player card at all. |
| Bottom tab bar: Home · Community · Leagues · Profile, Profile always active, 84px grid, translucent | new-ui-on-existing-data | `layout/bottom-tabs.tsx` (Home/Lists/Players/Search/More, 64px, lime) | A full rebuild. This file's bar conflicts with the main mobile file's (Players instead of Leagues, sizes, active state, home indicator). Community and Leagues are flag-gated. |
| Profile tab avatar (24px, ring) | new-ui-on-existing-data | `ui/user-avatar.tsx`, `profiles.avatar_url` | The prototype hard-codes "D" on `#0088FF`; use the real avatar. |
| Dock overlay (bar over the content, 84px spacer, hidden scrollbar) | restyle-only | `m-bar-a` token at HEAD | |
| Status bar (9:41, island, signal, battery) | out-of-scope-or-question | n/a | Device chrome from the presentation. Don't build it. |
| Toast (ink, bottom 100px, 2200ms) | restyle-only | `ui/toast.tsx`, `ui/toaster.tsx` | The hub never triggers it. Mobile position only. |
| Dark mode (`m-*` tokens; which colours stay fixed) | restyle-only | `globals.css` `--m-*`, `stores/theme-store.ts`, `use-layout-mode.ts` (HEAD) | Already landed. Open points: the low-contrast `#4D4D4D` active underline and pills, and the README's dark green/red (`--x-tg`/`--x-tr`) not being used. |
| Loading / empty / error / offline states | new-ui-on-existing-data | `ui/skeleton.tsx`; error and empty patterns in weekly-ranks-view and big-board-dashboard | The prototype has none. Extend the design language (CLAUDE.md). Copy is needed for "no rankings yet" and a failed source. |
| No animations; scroll kept across filter changes | restyle-only | n/a | Keep filters in the URL or in a store, and navigate without resetting scroll. |
| **NAVIGATION** | | | |
| Hub routes (`#view-<id>`, `#mine`, `#new-ranking`, `#lists`, `#rankings`) | new-ui-on-existing-data | no `/app/rankings` route; `/app/weekly-ranks` and `/app/big-board` are flag-gated layouts | The prototype uses a hash read once and keeps no browser history. The build should use real routes, e.g. a rankings route with src/type/scoring/pos query params, a community-ranking route and a mine route. |
| Back chevron destination | out-of-scope-or-question | n/a | In the prototype it lands on League › Match. The handler is named goProfile, and `fromComm` is never read. |
| Create (+): New ranking step 1 pre-filled from the hub's filters; "Open my ranking" if one exists | needs-new-backend | `top-nav.tsx` CreateMenu | Depends on the ranking model. The New ranking flow is its own section. |
| Mine tab (S5) and `#mine` (S6: no tabs, sticky `myOnly`) | needs-new-backend | `profile/page.tsx` (no "My stuff"), `stats/ranking-history-card.tsx` | The body is the My rankings section. S6's sticky `myOnly` is a prototype quirk. |
| Leaving the author tab removes it and carries its filters over | new-ui-on-existing-data | n/a | UI state only. |
| Profile tab keeps hub state; Home / Community / Leagues leave the hub | new-ui-on-existing-data | `stores/ui-store.ts` (Zustand) | Persist the hub filters in a store or the URL. |
| Entry points: Community rankings card, "Updated by people you follow", search ranking results, "@x updated…" notification, Profile › My stuff › Rankings | needs-new-backend | `use-explore-feed.ts`, `api/search/community/route.ts` (users and lists only), 019 `list_updated` (pins only), `profile/page.tsx` | Rankings must become searchable, notifiable and listable entities. |
| Comparison sources on a community view (Experts + Scout AI; author replaces Users) | new-ui-on-existing-data | n/a | A UI rule once the sources exist. |
| **PRODUCT SCOPE** | | | |
| Rankings in the mobile launch | out-of-scope-or-question | `feature-flags.ts` (weeklyRanks, bigBoard, consensus off); CLAUDE.md go-live scope | Launch is Lists + Stats + AI stat lists. Does the hub ship, and behind which flag? |
| Hub vs. existing surfaces | out-of-scope-or-question | weekly-ranks-view, big-board-dashboard, `/consensus` | Does the hub replace weekly-ranks, big-board and consensus? It drops ADP, Auction, persona sources, draft labels, card fields, team filter and search. `/consensus` is a public, server-rendered SEO page. |
| AI personas (gap in the prototype) | out-of-scope-or-question | big-board persona sources, `use-persona-boards.ts` | CLAUDE.md says keep and restyle them. Where do persona boards sit in the hub: extra source tabs, or community authors? |

### Questions for Chris (each with a recommendation)
1. **Expert data source.** "Experts" needs five real analysts' ranks for every week, position and scoring, but the standing rule is RSS and YouTube only, with no scraping. Use AI personas as "the experts", license a feed, or drop the Experts tab for now? *Recommend: personas as experts for the feedback year, labelled as AI.*
2. **Pre-draft during the season.** The hub's type menu offers Pre-draft mid-season, but the README hides it. *Recommend: hide it in season, as My rankings already does.*
3. **Half PPR.** It exists across the app but not in the hub. *Recommend: offer PPR, Half and Standard, the way ESPN, Yahoo and Sleeper do.*
4. **Weeks offered.** The hub hard-codes W5/W6, while New ranking allows W5–8. *Recommend: current week plus next, matching what a user can rank.*
5. **What Follow means.** It's per ranking in this file and per author in the main app. *Recommend: per author, using the existing `follows` table, with pinning as the per-ranking option.*
6. **Copying a ranking.** "Start my ranking from this" creates a duplicate when you already own that ranking. *Recommend: ask to open or replace yours, the way New ranking step 1 does.*
7. **Showing what changed.** The "@x updated" notification lands on a page that doesn't show the changes, its card says "submitted", and the arrows contradict the feed. *Recommend: show "Updated {time} · N changes" and the real moves.*
8. **Tapping a player.** A row tap expands the comparison, but the standing rule is that a player click opens the mini card first. *Recommend: tapping the row expands; tapping the photo or name opens the mini card.*
9. **Back and tab bar.** Where does Back go? Which tab bar wins, Leagues or Players? *Recommend: Back goes to the previous screen (real history); use the main app's bar.*
10. **Page length.** The rank cap is 24 rows. Is that right with real player pools?
11. **Truncation.** About a third of names ellipsise at 390px, and the Users ROS/Pre and community info lines truncate. Accept that, or shorten the copy or the stat columns?
12. **Bye weeks on someone else's list.** An author's player on bye silently disappears. *Recommend: keep the player, marked "Bye".*
