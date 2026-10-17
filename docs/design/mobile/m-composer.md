## Create flows: composer and player picker

**Sources** (all in `FieldScout Mobile.dc.html` unless another file is named):

| Area | Lines |
|---|---|
| Sheet shell and `sheetCreate` | 645–662 |
| `hasCmp` composer | 981–1072 |
| `hasPick` picker | 1073–1089 |
| Toast | 1117 |
| Entry points | Profile button L118, My start/sit "+" L124, Community "+" L149 |
| Script: `createOpts`/`openCreate` | L1817–1818 |
| Script: `ssNew` | L1506 |
| Script: `meNew`/`meNewLabel` | L1815–1816 |
| Script: `ytId` | L1513 |
| Script: `cmVals` composer block `C = s.cmp` | L1567–1613 |
| Script: picker block `P = s.pick` | L1614–1622 |
| Script: `toast()` | L1624 |
| Script: `ssVals` (downstream My start/sit) | L1486–1505 |
| Script: `listCover` (downstream Community) | L1534–1535 |
| Script: `themeCls` | L1858 |
| Headshot | `FSHeadshot.dc.html` |
| Rankings file | `FieldScout Mobile Lists and Rankings.dc.html` L368–371, L405–436, L481 |

Token names come from README.md. A hex in parentheses is the light-mode fallback that the prototype writes as `var(--x-…, #hex)`.

**Measured** values come from rendering the prototype in headless Chromium in the 390×844 phone frame with Inter Display loaded. Coordinates are relative to the phone's top-left corner. They confirm the CSS. Where the two differ, follow the CSS; the measurement only shows what that CSS renders with this font.

### Global conventions for this area

**Icons.** All SVG icons use `viewBox="0 0 16 16"`, `fill="none"`, `stroke="currentColor"` and round caps (plus round joins where noted). Paths:

| Icon | Path |
|---|---|
| X / close | `M4 4l8 8M12 4l-8 8` |
| Back chevron | `M10 3L5 8l5 5` |
| Row chevron | `M6 3l5 5-5 5` |
| Plus (composer) | `M8 3v10M3 8h10` |
| Plus (picker badge, = `ICON.add`) | `M8 3.5v9M3.5 8h9` |
| Check | `M3 8.5l3.2 3L13 4.5` |
| Up | `M4 10l4-4 4 4` |
| Down | `M4 6l4 4 4-4` |
| Search | `<circle cx=7 cy=7 r=4.8>` + `M10.6 10.6L14 14` |
| YouTube play (filled, `fill="currentColor"`) | `M4.5 2.8v10.4L13 8z` |

**Pressed and animation.** "Pressed" means the prototype's `style-active` (the `:active` state). Apart from the switch track (below), nothing in this area animates. Overlays mount and unmount instantly, with no slide or fade.

**Font.** The phone root sets (L25):
- `font-family:'InterDisplay',sans-serif`, loaded from `rsms.me/inter/inter.css`
- `font-feature-settings:'tnum' 1,'cv11' 1`, which gives tabular numbers plus Inter's single-storey "a" alternate
- `-webkit-font-smoothing:antialiased`

The global CSS also sets `*{box-sizing:border-box}`.

**Form fields.** Every `<input>` and `<textarea>` sets only these, plus its own size and weight:
- `border:0; outline:0; font-family:inherit; color:var(--x-t1)`
- `background:transparent`, except the description textarea, which is on b1

None of them sets padding or line-height, with these exceptions:
- question textarea: `line-height:1.3`
- description and rank-note textareas: `line-height:1.4`
- description textarea: `padding:12px`
- list step-1 input: `padding-bottom:10px`

So the UA defaults apply. In Chromium that is textarea padding 2px, input padding 1px 2px, line-height `normal`. Measured results:
- Question textarea: 358×56 (2 rows × 26px + 4px).
- List step-2 name input: 26px tall.
- Description textarea: 82.8px tall (3 × 19.6 + 24).

**Placeholder colours.** Only `input::placeholder{color:#6E6E73}` is defined globally. The three textareas (question, description, rank note) have no placeholder rule, so they show the browser-default grey.

**Conditional wrappers.** `<sc-if>` renders a React Fragment with no wrapper element (`support.js` `walkIf`). Its children become direct flex items of the parent and take part in the parent's `gap`. An element that is always rendered still takes a gap slot even when it is empty (see §2.5, item 6).

**Headshots** use `FSHeadshot`. Sizes in this area are 34, 36 and 40.
- Element: circle, `overflow:hidden`, background `#EEEEF1`, `title={player}`.
- Ring: team colour from `TC`, ring width 2px when size ≥ 32, so the ring is `0 0 0 1px #fff, 0 0 0 3px <team color>`.
  - If the team code is not in `TC`, the ring is `inset 0 0 0 1px rgba(0,0,0,.04)` instead. All 26 team codes in the sample pool are in `TC`. The fallback only appears for a name missing from `PDB` (`pinfo` then returns team `"FA"`). In the real product that means free agents.
- Photo: `<img>` absolutely positioned, `object-fit:cover; object-position:50% 15%; transform:scale(1.25) translateY(8%)`. An image `onError` swaps to initials.
- Initials:
  - Font: `#6E6E73`, weight 700, size `max(9, round(size×0.36))`, which is 12px at 34, 13px at 36 and 14px at 40.
  - Algorithm: strip a trailing `" D/ST"`, split on `/[\s'-]+/`, then take the first letter of the first part plus the first letter of the last part (only one letter if there is one part), uppercased.
  - Examples: "Eagles D/ST" → "E", "49ers D/ST" → "4", "Ka'imi Fairbairn" → "KF", "Michael Penix Jr." → "MJ", "A.J. Brown" → "AB", "DK Metcalf" → "DM".
  - Only 19 of the 67 pool players have a headshot file, so initials are the common case in the picker and recommendations.

---

### 1. Screens and states

| # | Screen / state | Exact condition |
|---|---|---|
| S1 | **Create sheet** (bottom sheet, 3 options) | `s.sheet === "create"`, i.e. `hasSheet` (`!!s.sheet`) && `sheetCreate`. `sheetTitle` = "Create". |
| S2 | **Composer: Start or sit** (poll, start/sit question) | `s.cmp.kind === "poll" && s.cmp.qtype !== "trade"` → `cmp.isPoll && cmp.isSSq` |
| S3 | **Composer: Trade question** | `s.cmp.kind === "poll" && s.cmp.qtype === "trade"` → `cmp.isPoll && cmp.isTq` |
| S2/S3a | Roster attach **off** / **on** (on shows the league chooser) | `s.cmp.roster == null` / `s.cmp.roster != null` (0 or 1) |
| S2b | "Add another option" link visible | `s.cmp.opts.length < 6` |
| S2/S3c | Post button enabled / disabled | See validation (§3.4) |
| S3d | Trade side with N slots | `s.cmp.give.length` / `s.cmp.get.length` (≥ 1, no cap) |
| S4 | **Composer: New list, step 1** (name your list) | `kind === "list" && step === 1` → `cmp.isList1` |
| S5 | **Composer: Edit list, step 2** | `kind === "list" && step === 2` → `cmp.isList2` |
| S5a | Cover collage vs. empty-cover icon | `players.length > 0` → `hasCollage`; otherwise `noCollage` |
| S5b | Empty players: big "Add players" button | `players.length === 0` → `noPlayers` |
| S5c | YouTube link error | `s.cmp.linkErr === true` |
| S5d | Public on / off | `s.cmp.pub` |
| S5e | Recommended has 0 rows | First list player is a kicker (`pos0 === "K"`; see §3.5) |
| S6 | **Composer: New ranking step 1 / Edit ranking step 2** (in-file) | `kind === "rank" && step === 1/2` → `isRank1` / `isRank2`. **Unreachable from the UI**: the Create sheet's "Ranking" row navigates to the Rankings file first (§3.1). The `label === "Ranking"` branch of the draft ternary in L1818 is dead. Documented in §2.6 and §3.7 for completeness only. |
| S7 | **Player picker: single** ("Choose a player") | Overlay mounts on `hasPick: !!s.pick` (L1556) with `s.pick.mode === "single"`. The `pk` bindings are only filled when `s.pick && s.cmp` (L1616). With no composer an empty picker would render, which cannot happen through the UI. |
| S8 | **Player picker: multi** ("Add players") | `!!s.pick && s.pick.mode === "multi"` |
| S7/S8a | Picker with no matches | `rows.length === 0`. **No empty-state UI exists**; the list area is simply blank. |
| T | Toast "Posted to Community" | `hasToast: !!s.toast`. Set by every successful post and cleared after 1800ms. |

**Composer initial drafts** (exact objects):
- From Create sheet → "Start or sit":
  `{ kind:"poll", qtype:"ss", q:"", mode:"start", pickN:1, opts:[null,null,null], give:[null], get:[null], roster:null, scoring:"PPR", close:"kickoff" }`. Roster is **off**.
- From My start/sit "+" and Profile "Ask a question" (`ssNew`, L1506): identical, except `roster: 0`. Roster is **on**, with the first league selected.
- From Create sheet → "List":
  `{ kind:"list", step:1, name:"", desc:"", pub:true, players:[], videos:[], link:"", color:"#0088FF" }`
- Dead rank draft: `{ kind:"rank", step:1, period:"w5", pos:"All", scoring:"PPR", from:"consensus", title:"", note:"", order:[] }`

---

### 2. Layout, top to bottom

#### 2.1 Create sheet (S1)

**Backdrop.**
- `position:absolute; inset:0` over the whole 390×844 phone, so it also dims the 50px status bar, the dock and the 134×5 home-indicator pill (L645).
- `z-index:20`, background `rgba(0,0,0,.32)`. The README says .4; the source uses .32.
- `display:flex; align-items:flex-end`.

**Panel.**
- Width 100%, `max-height:86%` (≈726px), flex column.
- Radius `24px 24px 0 0`, background `var(--x-b0,#fff)` (b0).
- Padding `8px 0 30px`.
- **Measured:** 390×381, top edge at y=463. The max-height never applies to this sheet.

**Grab handle.**
- Wrapper: flex none, centred, padding `2px 0 8px`. Measured 15px tall.
- Handle: 36×5, radius 999, `var(--x-b4,#D1D1D6)` (b4).
- Visual only: there is no drag-to-dismiss.

**Header.**
- Flex, `align-items:flex-start`, gap 12, padding `4px 16px 12px 20px`. Measured 39px tall.
- Title column: `flex:1; min-width:0`, column, gap 2.
- Title "Create": 19px / 600, letter-spacing -0.02em, t1. Measured line box 23px.
- No subtitle (`hasSheetSub` is only true for `"grid"`).
- **No close button.** The 32px X in this header renders only for the league switcher.

**Body.**
- `.fsm-scroll`: `flex:1; min-height:0; overflow-y:auto; scrollbar-width:none`.
- Every `.fsm-scroll` whose inline style contains `overflow-y` gets an `::after` block spacer (`flex:none`) of `height:var(--x-dockpad)`.
- `--x-dockpad` is 150px with class `dock-lg` and 84px with `dock-sm`. `themeCls` (L1858) applies `dock-lg` only when `scr === "league" && !prof && !trade && !settings`, and `dock-sm` otherwise.
- Every entry point to this area has `scr` = `"community"`, `"myss"` or `"me"`, so the spacer is always **84px** here. That includes the sheet, the composer and the picker list, even though all three cover the dock.

**Options container.** Padding `0 12px 6px`, flex column, gap 2.

**Option row** (×3):
- `min-height:64px`, flex, `align-items:center`, gap 12, padding 8, radius 14.
- Cursor pointer. Pressed background `var(--x-b2,#F2F2F4)`.
- Icon tile: 44×44, radius 12, background = option colour. Icon 20×20, stroke `#fff`, width 1.6, round caps and joins.
- Text column: `flex:1; min-width:0`, column, gap 2. Measured width 270px.
  - Label: 15px / 600, t1.
  - Sub: 12px / 500, `var(--x-t3,#6E6E73)`, `text-wrap:pretty`, line box 15px.
- Trailing chevron: 12×12, `var(--x-t5,#AEAEB2)`, stroke 2, round joins, path `M6 3l5 5-5 5`.
- **Measured:** row heights 64 / **67** / 64. The "Ranking" sub wraps to 2 lines (30px) at 270px; the other two fit on one line. The body is then 64+2+67+2+64+6 = 205, plus the 84px spacer, = 289.

| Order | Label | Sub (exact) | Tile bg | Icon path |
|---|---|---|---|---|
| 1 | Start or sit | Ask who to start, or whether to take a trade | `#07B85A` | `M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5` |
| 2 | Ranking | Rank players for a week, rest of season or the draft | `#0088FF` | `ICON.rank` `M4 13V8M8 13V3M12 13V6` |
| 3 | List | Group players for research, targets or stashes | `var(--x-t1,#1D1D1F)` | `ICON.lists` `M3 4h10M3 8h10M3 12h6` |

#### 2.2 Composer shell (all composer states)

**Overlay.**
- `position:absolute; left:0; right:0; top:50px; bottom:0`, which leaves the simulated 50px iOS status bar visible.
- `z-index:27`, flex column, opaque background b0.
- It covers the dock and tab bar (z 4) and the home-indicator pill.

**Header** (y 50–102).
- Flex none, height 52, flex, `align-items:center`, gap 8, padding `0 12px`.
- `border-bottom:1px solid var(--x-b3,#EBEBEE)`.
- **Left button:** 36×36 circle, centred, colour t1, pressed background b2.
  - `isFirst` (poll, or any step 1): X icon 14×14, stroke 2.2.
  - Step 2 (`notFirst`): back chevron 18×18, stroke 2, round joins.
- **Title:** `flex:1; text-align:center`, 16px / 600, t1.
  - It is centred between the 36px button and a pill of variable width, so it is **not** screen-centred.
  - Measured title-box centre: 185.8 with "Post" (54.4px pill), 185.1 with "Next" (55.8), 184.1 with "Save" (57.9). That is about 9–11px left of the screen centre (195).

| State | Title |
|---|---|
| Start/sit poll | Start or sit |
| Trade poll | Trade question |
| List step 1 | New list |
| List step 2 | Edit list |
| Rank step 1 (dead) | New ranking |
| Rank step 2 (dead) | Edit ranking |

**Action pill.**
- Flex none, height 32, padding `0 14px`, radius 999, flex `align-items:center`, 13px / 600, cursor pointer, no pressed state.
- Enabled: background `#0088FF`, text `#fff`.
- Disabled: background `var(--x-b3,#E5E5EA)`, text `var(--x-t3,#6E6E73)`.

| State | Pill label |
|---|---|
| Polls | Post |
| List step 1 | Next |
| List step 2 | Save |
| Rank step 1 | Next |
| Rank step 2 | Publish |

**Body.**
- `.fsm-scroll`, flex 1, `min-height:0`, `overflow-y:auto`, scrollbar hidden. Visible height 742 (y 102–844).
- The 84px `::after` spacer applies here.
- This is **one DOM element for every kind and step**. See §3.8 for scroll-position behaviour.

#### 2.3 Poll composer (S2 / S3)

The body wrapper has padding 16 and is a flex column with **gap 18**. In order:

1. **Author row** (static).
   - Flex, `align-items:center`, gap 10, 36px tall.
   - Avatar: 36×36 circle, background `myTeam.av` (= `s.myAv`, default `#0088FF`). Letter **"D"** in `#fff`, 14px / 600. The letter is hard-coded.
   - Text column, gap 1:
     - **"@dalton"** 14px / 600 (17px line).
     - **"Public · Week 5"** 11px / 500, t3 (14px line).

2. **Question-type segmented control.**
   - Track: `display:grid; grid-template-columns:1fr 1fr; gap:2px; padding:2px; border-radius:10px`, background b2 `#F2F2F4`. 36px tall; segments 176px wide.
   - Segments: height 32, radius 8, centred, 13px / 600. Labels **"Start or sit"** and **"Trade"**.
   - On: text t1, background b0 `#fff`, `box-shadow:0 1px 2px rgba(0,0,0,.12)`.
   - Off: text t3, background transparent, `box-shadow:none`.

3. **Question textarea.**
   - `rows=2`, placeholder **"Who should I start?"**. The placeholder is static in every mode, including Sit and Trade.
   - `resize:none`, 20px / 600, line-height 1.3, colour t1. UA padding 2px. Measured 358×56.
   - Placeholder colour is the browser default (see Global conventions).

4. **Start/sit only (S2).**

   **Options list.** Flex column, gap 8. One row per `C.opts` entry (initially 3).
   - **Empty row:**
     - Height 60, radius 14, `box-shadow:inset 0 0 0 1.5px var(--x-b4,#D1D1D6)`.
     - `display:flex; align-items:center` with **no `justify-content`**, gap 10, padding `0 14px`. The content is **left-aligned**: the circle starts 14px from the row's left edge and is vertically centred.
     - Text `#0088FF`, 14px / 600.
     - Leading 36×36 circle on `var(--x-gb,#E6F2FF)` with a plus icon 14×14, stroke 2.2.
     - Text: **"Choose player N"**, where N is the 1-based row index (rows renumber after a removal).
   - **Filled row:**
     - `min-height:60px`, radius 14, background `var(--x-b1,#F5F5F7)`.
     - Flex, `align-items:center`, gap 10, padding `8px 10px 8px 12px`.
     - Headshot 40.
     - Text column (`flex:1; min-width:0`, gap 1; measured width 244):
       - Name: 14px / 600, nowrap, ellipsis.
       - Meta: 11px / 500, t3, format **`{POS} · {TEAM} · Proj {x.x}`**.
     - Remove button: 32×32 circle, background b2, colour t1, X 14×14, stroke 2, round joins.

   **"Add another option".**
   - Only when `opts.length < 6`.
   - 13px / 600, `#0088FF`, padding `4px 0` (24px tall), `align-self:flex-start`.
   - It sits inside the gap-8 options list, 8px under the last row.

   **Controls row.** Flex, `align-items:flex-end`, gap 16, `flex-wrap:wrap`. Measured 56px tall, on one line.
   - Group "Ask people to": column, gap 8; label 13px / 600, t3.
     - Chips "Start" and "Sit": height 32, padding `0 16px`, radius 999, 13px / 600, gap 6. Measured 61.8 and 48 wide.
     - Start on: background `#07B85A`, text `#fff`.
     - Sit on: background `#FF0028`, text `#fff`.
     - Off: background b2, text t1.
   - Group "How many": chips are **32×32 circles**, centred, 13px / 600, gap 6.
     - On: background `var(--x-ink,#1D1D1F)`, text `#fff`.
     - Off: background b2, text t1.
     - Values: `[1,2,3,4,5].filter(k => k < max(2, opts.length))`, so there is one fewer chip than there are rows.

   **Summary.**
   - 12px / 500, t3, `margin-top:-8px` (10px effective gap).
   - Text: **"Voters pick {pickN} to {start|sit} from {max(filled,2)} players"**.
   - With 0 or 1 players chosen it still reads "Voters pick 1 to start from 2 players".

   **Measured** (3 empty rows, roster off): author 118–154 · segmented 172–208 · textarea 226–282 · options block 300–528 · controls 546–602 · summary 612–627 · roster card 645–702 · Scoring 720–776 · Voting closes 794–850. The wrapper is 764px tall, so the scroll height is 848 against 742 visible: it **scrolls 106px**.

5. **Trade only (S3).**

   **Two columns.** `grid-template-columns:1fr 1fr; gap:10px`, 174px each.

   Each column is a flex column, gap 8, `min-width:0`:
   - Label **"You give"** / **"You get"**: 13px / 600, t3.
   - **Slot stack:** flex column, **gap 6**. It holds the slots **and, as its last child, the "Add another" link**. The link is therefore 6px under the last slot, not 8px.

   **Empty slot:**
   - Height 52, radius 14, `inset 0 0 0 1.5px var(--x-b4,#D1D1D6)`.
   - `display:flex; align-items:center` with **no `justify-content`** (left-aligned), gap 10, padding `0 12px`.
   - Text `#0088FF`, 13px / 600. Plus icon 13×13, stroke 2.2, shown with no circle behind it.
   - Text **"Add a player you give"** / **"Add a player you get"**, with no `nowrap`. Measured: "Add a player you give" **wraps to 2 lines** (127px box, 32px tall). "Add a player you get" **fits on one line** (123.5px).

   **Filled slot:**
   - `min-height:52px`, radius 14, background b1. Flex, centred, gap 10, padding `6px 8px 6px 10px`.
   - Headshot 34.
   - Text column (`flex:1; min-width:0`, gap 1; **measured 74px wide**):
     - Name: 13px / 600, ellipsis. Typical names truncate, e.g. "Bijan Robi…", "Charlie Kol…".
     - Meta: 11px / 500, t3, format `{POS} · {TEAM}` (no projection).
   - Remove: 28×28 circle with **no background**, colour t3, X 11×11, stroke 2.2.

   **"Add another"** (one per column): 12px / 600, `#0088FF`, padding `2px 0` (19px tall), `align-self:flex-start`. There is no cap.

   After the grid: **"Voters choose Accept or Decline"**, 12px / 500, t3, `margin-top:-8px`.

   **Measured** (1 slot per side): the grid is 101px tall. With roster on, the whole body is 617px; with roster off it is shorter. Either way the trade layout **does not scroll** (617 + 84 < 742).

6. **Attach-roster card** (both poll types).
   - Card: flex column, gap 10, padding 12, radius 14, background b1 `#F5F5F7`. Measured 57px tall when off, 111 when on.
   - **Toggle row** (the whole row is tappable): flex, centred, gap 10.
     - Text column, **gap 2**:
       - **"Attach my roster"** 14px / 600.
       - **"Voters see your full team for context"** 11px / 500, t3.
     - Switch track:
       - 44×26, radius 999, padding 2.
       - Background `#07B85A` when on, `var(--x-b3,#E5E5EA)` when off.
       - `transition: background .2s linear`.
       - `justify-content` is `flex-end` when on and `flex-start` when off.
     - Knob: 22×22 circle, background b0, `box-shadow:0 1px 2px rgba(0,0,0,.2)`.
   - **League chooser** (only when on): flex, gap 6, two chips, each measured 164×44.
     - Each chip: `flex:1; min-width:0`, padding `8px 10px`, radius 10, flex column, gap 1.
     - Top line: `LEAGUES[i].team`, 12px / 600, ellipsis.
     - Bottom line: `LEAGUES[i].name`, 10px / 500, `opacity:.7`, ellipsis.
     - Selected: background ink `#1D1D1F`, text `#fff`. Unselected: background b2, text t1.
     - Chips: "Touchdown Tacos" / "Sunday Funday League" (index 0) and "Dalton's Dynasty" / "Family Bragging Rights" (index 1).
     - Only `LEAGUES.slice(0,2)` is used, so the two pre-draft leagues are excluded.
     - `LEAGUES[0].team` is live: renaming the team in My team settings (L1792) changes the first chip and the posted roster label.

7. **Scoring.** Column, gap 8. Label "Scoring" 13px / 600, t3. Chips wrap with gap 6.
   - Height 32, padding `0 14px`, radius 999, 13px / 600, nowrap.
   - On: ink background, text `#fff`. Off: b2 background, text t1.
   - Options: **Standard · Half PPR · PPR**, default PPR. Measured widths 83.3 / 80.6 / 52.6.

8. **Voting closes.** Same chip style. Label "Voting closes".
   - Options: **At kickoff** (`kickoff`, default) · **In 24 hours** (`24h`) · **In 1 hour** (`1h`). Measured widths 84.2 / 95.9 / 81.

#### 2.4 List step 1 (S4)

**Header:** X button, title "New list", "Next" pill.

**Wrapper.**
- `min-height:100%` (fills the 742px body), flex column, centred on both axes, gap 22.
- Padding `40px 24px 120px`, `text-align:center`.
- Measured scroll height 826 against 742 visible, so the page scrolls by 84px (the spacer).

**Contents.**
- Heading **"Name your list"**: 22px / 700, -0.02em. Measured y 354, 26px tall.
- Input:
  - Placeholder **"Week 5 sleepers"**, `maxlength=40`, `width:100%`, centred text.
  - 26px / 700, no letter-spacing.
  - `padding-bottom:10px`. The top keeps the UA 1px.
  - No border except `border-bottom:2px solid var(--x-ink,#1D1D1F)`.
  - Transparent background, colour t1. Placeholder `#6E6E73`.
  - Measured 342×44 at y 402.
- **"Create"** button:
  - Height 44, padding `0 28px`, radius 999, 15px / 600.
  - Same enabled/disabled colours as the header pill: `#0088FF` + `#fff`, or b3 + t3.
  - Measured 102.6×44 at y 468.

#### 2.5 List step 2 (S5)

**Header:** back chevron, "Edit list", "Save".

The wrapper has padding 16 and is a flex column with gap 14:

1. **Cover + name row.** Flex, gap 14, `align-items:flex-start`.
   - **Cover:** 96×96, radius 14, `overflow:hidden`, background `C.color`, content centred.
     - With players: a 2-column grid (`repeat(2,34px)`, gap 4; 72px square, 12px inset) of the first 4 players' 34px headshots. With 1–3 players the grid is partly filled from the top-left.
     - Without players: white list icon 28×28, stroke 1.5 (`M3 4h10M3 8h10M3 12h6`).
   - **Right column:** `flex:1; min-width:0` (248px), column, gap 6.
     - Name input: **no placeholder and no maxlength**, 20px / 700, -0.02em, `min-width:0`. Measured 26px tall.
     - Swatch row (flex, gap 6): five 22×22 circles, in order `#0088FF`, `var(--x-t1,#1D1D1F)`, `#07A852`, `#9D70E9`, `#F75252`.
       - Selected ring: `0 0 0 2px var(--x-b0,#fff), 0 0 0 3.5px <color>`. Others: `none`.
       - The swatch stores the literal string, so the second swatch is saved as `"var(--x-t1,#1D1D1F)"` and resolves per theme.
2. **Description textarea.**
   - Placeholder **"Add a description"**, rows 3, `resize:none`.
   - Padding 12, radius 12, background b1 `#F5F5F7`, 14px / 500, line-height 1.4.
   - Measured 358×82.8.
3. **Public row** (the whole row is tappable). Flex, centred, gap 10. Measured 32px tall.
   - Text column with **gap 1** (the roster card uses 2):
     - **"Public"** 14px / 600.
     - Sub, 11px / 500, t3: **"Anyone can find and follow this list"** when on, **"Only you can see this list"** when off.
   - Switch identical to the roster switch (on `#07B85A`, off b3, 200ms background transition).
4. **Videos.** Column, gap 8, `padding-top:6px`.
   - Title **"Videos"**: 16px / 600.
   - **Input row** (flex, gap 8):
     - Field: `flex:1; min-width:0` (298px), height 40, padding `0 12px`, radius 12, background b2 `#F2F2F4`, gap 8.
       - YouTube glyph: 20×14, radius 4, background `#FF0028`, with a white filled play triangle 8×8.
       - Input: placeholder **"Paste a YouTube link"**, 14px / 500.
     - **"Add"** button:
       - Height 40, padding `0 14px` (52px wide), radius 12, 13px / 600.
       - Ink + `#fff` text when `link.trim()` is non-empty; otherwise b3 + t3.
       - **It is tappable in both states** (§3.5).
   - **Error** (S5c): **"That doesn't look like a YouTube link"**, 11px / 500, `#FF0028`.
   - **Video rows:** flex, centred, gap 10. Measured 54px tall.
     - Thumbnail: 96×54, radius 8, `overflow:hidden`, background ink. Inner div: `background: var(--x-ink) center/cover no-repeat; background-image:url(https://i.ytimg.com/vi/{id}/hqdefault.jpg)`.
     - Text column, gap 1:
       - **"YouTube video"**, 13px / 600. Hard-coded in the markup; it does not read `x.t`.
       - The pasted URL, 11px / 500, t3, nowrap, ellipsis.
     - Remove: 32×32 circle, transparent, t3, X 14, stroke 2.
5. **Players header.** Flex, `space-between`, centred, `padding-top:6px`. Measured 26px tall.
   - Left: **"Players · {n}"**, 16px / 600.
   - Right: **"Add players"** link, 13px / 600, `#0088FF`.
6. **Player rows.** The wrapping `<div>` (L1061) is always rendered.
   - Each row: flex, centred, gap 10, padding `8px 0`, `border-bottom:1px solid var(--x-b2,#F2F2F4)`. Measured 53px tall.
     - Headshot 36.
     - Name: 14px / 600, ellipsis.
     - Meta: 11px / **600** in the position colour (POSTXT), format `{POS} · {TEAM}`.
     - Remove: 32 circle, transparent, t3, X 14.
   - With 0 players this empty div still takes a gap slot. The space between the "Players · 0" header and the empty-state button is therefore **28px** (14 + 0 + 14), not 14.
7. **Empty players (S5b).** "Add players" outline button:
   - Height 44, radius 14, `inset 0 0 0 1.5px var(--x-b3,#E5E5EA)`.
   - 14px / 600, t1, centred, plus icon 12×12 (stroke 2.2), gap 6.
8. **Recommended.** Column, gap 2, padding `12px 0 20px`.
   - **"Recommended"** 16px / 600.
   - Sub, 11px / 500, t3:
     - With players: **"More {POS}s like the ones in your list"** (DST → "D/ST"; a kicker gives "More Ks like the ones in your list").
     - Without players: **"Popular players to start your list"**.
   - Up to five rows in the player-row layout (53px each).
   - Trailing **add** button: 32 circle with `inset 0 0 0 1.5px var(--x-b4,#C7C7CC)`, colour t1, plus icon 12×12 (stroke 2.2). No pressed state.

**Measured** (3 players, 1 video): cover row 118–214 · description 228–311 · Public 325–357 · Videos 371–507 · Players header 521–547 · rows from 561 at 53px each.

#### 2.6 Ranking composer (in-file; unreachable, build only if asked)

**Rank step 1.** Padding 16, column, gap 20. Four labelled groups (column, gap 8; label 13px / 600, t3). Chips use the standard chip style (32h, `0 14px`, 999, 13/600, wrap gap 6):
- **"Ranking for":** Week 5 (`w5`) · Week 6 (`w6`) · Rest of season (`ros`) · 2026 draft (`draft`).
- **"Position":** Overall (`All`) · QB · RB · WR · TE.
- **"Scoring":** Standard · Half PPR · PPR.
- **"Start from":** option cards, flex, centred, gap 12, padding 12, radius 14, background b1.
  - The selected card gets ring `inset 0 0 0 2px #0088FF`; others `none`.
  - Text column, gap 2: label 14px / 600; sub 12px / 500, t3.
  - Radio: 20×20 circle. Selected: `inset 0 0 0 6px #0088FF`. Unselected: `inset 0 0 0 1.5px var(--x-b4,#C7C7CC)`.
  - Options: "Expert consensus" / "Start with the FieldScout consensus and adjust", and "My last ranking" / "Pick up where you left off".

**Rank step 2.**
- **Top block:** padding `16px 16px 8px`, column, gap 8.
  - Title input: placeholder "Ranking title", 20px / 700, -0.02em.
  - Note textarea: placeholder "Add a note for your followers (optional)", rows 2, 14px / 500, line-height 1.4.
  - Hint: "Use the arrows to reorder. {N} players", 11px / 500, t3.
- **Rows wrapper:** padding `0 16px`. Each row: flex, centred, gap 10, padding `8px 0`, bottom border b2.
  - Rank number: width 22, 14px / 700.
  - Headshot 36.
  - Name: 14px / 600, ellipsis. Meta: 11px / 600, position colour.
  - Up and down buttons: 32 circles, background b2, colour t1, icons 14 (stroke 2, round joins). Opacity .3 on the first row's up and the last row's down.
  - Remove: 32 circle, transparent, t3, X 14.
- **"Add players"** outline button: margin `12px 16px 24px`, height 44, radius 14, `inset 0 0 0 1.5px var(--x-b3)`, 14/600, plus 12, gap 6.

#### 2.7 Player picker (S7 / S8)

**Overlay.** `position:absolute; top:50px; left:0; right:0; bottom:0`, `z-index:28`, flex column, opaque b0.

**Header** (y 50–102).
- Height 52, flex, centred, gap 8, padding `0 12px`. **No bottom border.**
- Back: 36 circle, chevron 18 (stroke 2, round joins), pressed background b2.
- Title: `flex:1`, centred, 16px / 600. **"Choose a player"** (single) or **"Add players"** (multi).
- Right side:
  - Multi: **"Done"** pill, height 32, padding `0 14px` (measured 59.1px wide), radius 999, 13px / 600, `#fff` on `#0088FF`, no pressed state. The title is therefore **not** screen-centred: measured centre 183.4, 11.6px left.
  - Single: a 36px-wide empty spacer, so the title is exactly centred (measured 195).

**Search and filters.** Flex none, padding `0 16px 10px`, column, gap 10 (y 102–194).
- Search field: height 40, padding `0 12px`, radius 12, background b2, flex, gap 8.
  - Magnifier: 15×15, `var(--x-t4,#8E8E93)`, stroke 1.8.
  - Input: `flex:1`, placeholder **"Search players"**, 15px / 500.
  - No autofocus, no clear (×) button, no Cancel.
- Position chips: `.fsm-scroll`, `display:flex; gap:6px; overflow-x:auto`, hidden scrollbar. No dock spacer, because the inline style has no `overflow-y`.
  - Chips: flex none, height 32, padding `0 14px`, radius 999, 13px / 600, nowrap. On: ink + `#fff`. Off: b2 + t1.
  - Labels: **All · QB · RB · WR · TE · K · D/ST**. There is no FLEX chip.
  - Measured chip widths: 43.1 / 46.1 / 44.7 / 49.1 / 43.9 / 36.7 / 57.4. Total content is 357px in the 358px row, so at 390 **the row fits and does not scroll** (scrollWidth = clientWidth = 358). It only scrolls if text renders wider.

**List.** `.fsm-scroll`, flex 1, `min-height:0`, `overflow-y:auto`, padding `0 16px 24px`, plus the 84px spacer. Visible height 650 (y 194–844).
- Row (the whole row is tappable): flex, centred, gap 10, padding `8px 0`, `border-bottom:1px solid var(--x-b2,#F2F2F4)`. Measured 53px tall.
  - Headshot 36.
  - Name: 14px / 600, ellipsis.
  - Meta: 11px / 600 in the position colour, format `{POS} · {TEAM}`.
  - **"Proj {x.x}"**: 12px / 500, t3, `flex` default (not `none`).
  - Multi only: a 28×28 badge circle (flex none) with a `#fff` icon 12×12 (stroke 2.6, round joins), `box-shadow:none`.
    - Selected: background `#0088FF`, check icon.
    - Not selected: background `var(--x-ink,#1D1D1F)`, plus icon (`ICON.add`).
  - Measured text-column width: 251.7 (single), 213.7 (multi).
- Measured scroll height with 40 rows: 40 × 53 + 24 + 84 = 2228.

#### 2.8 Toast

- `position:absolute; left:50%; bottom:100px; transform:translateX(-50%)`, `z-index:30`.
- Height 36, padding `0 16px`, radius 999, flex centred, background `var(--x-ink,#1D1D1F)`, text `#fff`, 13px / 500, nowrap.
- Copy: **"Posted to Community"**. Measured 158.5×36 at y 708–744.
- It appears over whichever screen opened the composer, above the dock.

#### 2.9 Entry-point controls

- **Community header "+"** (L149):
  - 34×34 circle, `#0088FF`, pressed `#0074DB`.
  - White plus 15×15, stroke 2.4.
  - `title="Create"`.
  - Rendered only inside `cmSearchClosed`.
- **My start/sit header "+"** (L124):
  - 34×34 circle, `#0088FF`, flex none.
  - White plus 15×15, stroke 2.4.
  - `title="Ask a question"`.
  - **No pressed state** (no `style-active`).
- **Profile → My stuff create button** (L118):
  - `margin-top:14px`, height 44, flex centred, gap 6, radius 14, `box-shadow:inset 0 0 0 1.5px var(--x-b3,#E5E5EA)`, 14px / 600.
  - Plus icon 12×12, stroke 2.2.
  - Label from `meNewLabel`: **"Ask a question"** on the Start/Sit tab, "New list" on Lists, "New ranking" on Rankings (fallback when `meTab` is unset).

---

### 3. Interactions

#### 3.1 Create sheet

- **Backdrop tap** → `sheet: null` (closes). Taps inside the panel are stopped with `stopPropagation`.
- **"Start or sit"** → one `setState({ sheet:null, cmp:<poll draft, roster:null> })`. The sheet closes and the composer appears in the same frame.
- **"List"** → `setState({ sheet:null, cmp:<list draft> })`.
- **"Ranking"** → `window.location.href = "FieldScout Mobile Lists and Rankings.dc.html#new-ranking"`. This is a full page navigation, and all in-app state is lost.
  - The Rankings file's `componentDidMount` reads the hash and opens `scr:"rkNew"` with `nw = { step:1, type:"w5", scoring:"ppr", pos:"RB", from:"ai" }`. That screen belongs to the Rankings spec.
- **Return path from Create → Ranking:**
  - In the Rankings file, the step-1 X (`nw.back`, L481) calls `go("rk")`, which opens the Rankings hub inside that file. It does not go back to Community.
  - Every route back to the main app sets `window.location.href = "FieldScout Mobile.dc.html"` **with no hash** (`APP`, L405; used at L416, L417, L436, L557).
  - The main file has no hash handling, so it reloads in its initial state: `scr:"league"`, `tab:"match"` (League › Match), `cmMine:[]`. The user does not land on Community, and any posts made this session are gone.
  - Only dark mode survives, through `localStorage["fieldscout-theme"]`.
- There is no swipe-to-dismiss, no close button and no animation.

#### 3.2 Composer header

- **X** (poll, or any step 1) → `cmp: null`. The draft is discarded immediately, with no confirmation.
- **Back chevron** (step 2) → `step: 1`. All draft fields are kept, including list players and videos.
- **Action pill** → `act: () => ok && fn()`. It runs only when enabled; a tap while disabled does nothing (no toast, no inline error).

#### 3.3 Poll composer

- **Segment tap** → `qtype: "ss" | "trade"`. Start/sit options, give/get, question text, roster, scoring and close are each kept independently, so switching back and forth loses nothing.
- **Question textarea** → `q` updates on every change. There is no length limit; Enter inserts a newline.
- **Empty option row** (the whole 60px row) → opens the picker: `pick = { mode:"single", target:"poll", idx:i, q:"", pos:"All" }`.
- **Filled option** → only the **text column** (name/meta) opens the same picker to **replace** that slot. The headshot and row padding are not tap targets.
- **Option remove (X)**:
  - If `opts.length > 2`, the row is deleted.
  - Otherwise the slot is cleared to `null`. There are always at least 2 rows.
- **"Add another option"** → appends a `null` row. Hidden once there are 6 rows (max 6).
- **Start / Sit chip** → `mode: "start" | "sit"`.
- **How-many chip** → stores `pickN: k`. The **displayed and posted value is clamped**: `pickN = min(C.pickN || 1, max(1, filledCount − 1))`.
  - The number of chips follows the row count, but the highlight follows the filled count.
  - Example: with 3 rows and 2 filled, tapping "2" stores 2 but still highlights "1" until a third player is chosen.
- **Trade slots:**
  - An **empty** slot (whole 52px card) opens the picker: `pick = { mode:"single", target:"give"|"get", idx:i, q:"", pos:"All" }`.
  - A **filled** slot opens it only from its **text column**. The 34px headshot and the slot padding are not tappable (L997/L1000).
- **Trade remove** → deletes that slot if the side has more than one; otherwise resets the side to `[null]`.
- **"Add another"** (give/get) → appends `null`. **There is no cap.**
- **Roster row tap** → toggles `roster` between `null` and `0`. Turning it on always re-selects league 0.
- **League chip** → `roster: i`.
- **Switch animation:** the track background crossfades over 200ms (linear). The knob jumps without animation.
- **Scoring chip** → `scoring`.
- **Voting-closes chip** → `close`. The `close` value is **never written to the posted item**.

#### 3.4 Validation and posting

**Start/sit "Post"** is enabled when `filled ≥ 2 && pickN < filled`. Because of the clamp this is effectively `filled ≥ 2`. The question is optional. It posts:
```
{ type:"poll", ...rosterPost, mode: C.mode || "start", pick: pickN, meta: "{scoring} · Week 5",
  title: q.trim() || (mode==="sit" ? "Who should I sit?" : "Who should I start?"),
  opts: filledNames (row order, blanks dropped), pct: filled.map(() => 0), n: 0 }
```

**Trade "Post"** is enabled when there is at least one filled give **and** at least one filled get. `give` and `get` are posted with blank slots removed (`(C.give||[]).filter(Boolean)`). There is no `mode` or `pick`, and `rosterPost` is spread **last**. It posts:
```
{ type:"poll", qtype:"trade", meta:"{scoring} · Week 5",
  title: q.trim() || "Should I accept this trade?",
  give, get, opts:["Accept","Decline"], pct:[0,0], n:0, ...rosterPost }
```

**`rosterPost`** = `{ roster: { li: i, label: LEAGUES[i].team + " · " + LEAGUES[i].sub } }` when roster is on, otherwise `{}`. The labels are "Touchdown Tacos · 12-team standard" and "Dalton's Dynasty · 10-team standard". The team name follows a My team rename.

**`post()` common effects:**
- Prepends `{ id:"u"+Date.now(), by:"@dalton", av:s.myAv, time:"now", mine:true, tags:[], ...item }` to `cmMine`.
- Sets `cmp:null, pick:null, cmTab:"all", cmTopic:null, cmQuery:"", cmSearch:false`.
- Calls `toast("Posted to Community")`, which clears any pending timer, shows the toast and hides it after **1800ms**. The README says about 2.2s; the source uses 1800.
- `scr` is unchanged, so the user returns to whichever screen opened the composer.

**Duplicates are not prevented.** The same player can fill two start/sit rows, or appear in both give and get.

#### 3.5 List composer

**Step 1.**
- Input → `name`.
- Enter (when `name.trim()` is non-empty) → `step:2`.
- "Create" and the header "Next" both go to `step:2` when `name.trim()` is non-empty; otherwise they are disabled.

**Step 2.**
- Name input → `name`. It can be cleared to empty, which disables Save. No length limit.
- Swatch → `color`.
- Description → `desc`.
- Public row → toggles `pub`.

**YouTube link.**
- Typing → updates `link` and clears `linkErr`.
- Enter, or tapping **"Add"**, → `addLink()`. **It runs even when the field is empty or whitespace.** The button only *looks* disabled (b3/t3) then, and tapping it shows the error line.
- Validation: `ytId(link)` with `/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([\w-]{11})/`, run on the untrimmed link.
  - The **host is never checked**. Any URL containing `?v=` or `&v=` followed by 11 word/dash characters (e.g. `example.com/?v=abcdefghijk`), or `/shorts/` or `/embed/` + 11 characters, is accepted.
  - The pattern is **not anchored**, so a longer ID is silently cut to its first 11 characters.
- No match → `linkErr:true`, which shows the error line.
- Match → appends `{ yt:id, url:link.trim(), t:"YouTube video" }` and clears the field and the error. There is no dedupe and no cap.

**Video remove** → removes that video.

**Players.**
- "Add players" (link or empty-state button) → `pick = { mode:"multi", target:"list", q:"", pos:"All" }`.
- Player remove → filters that player out.
- Recommended "+" → appends the player. Recommendations recompute immediately, so the added player drops out and the next one appears.
- **Recommendation rule:** `ALLP` minus players already in the list, **excluding kickers**. When the list has players, it is also filtered to the **first** player's position (`pos0`). Sorted by projection (desc), top 5.
  - If the first list player is a kicker, the filter needs `pos === "K"` while kickers are excluded, so there are **0 rows**. The block then shows only "Recommended" + "More Ks like the ones in your list" with nothing under it.
- There is no reordering in this composer.

**"Save"** is enabled when `name.trim()` is non-empty; zero players is allowed. It posts:
```
{ type:"list", meta: pub ? "Public" : "Private", title:name.trim(), desc:desc.trim(), players, videos, color }
```
A private list is still added to the Community feed and still gets the "Posted to Community" toast.

#### 3.6 Picker

**Search** (`onChange` → `pick.q`). The query is **not trimmed**. A row matches when either:
- the name contains the query (case-insensitive), or
- the team code **equals** the query (case-insensitive exact). "atl" returns all ATL players, but "atl " with a trailing space returns none.

**Position chip** → `pick.pos`. Values: `All`, `QB`, `RB`, `WR`, `TE`, `K`, `DST`.

**Results:** players filtered by position and query, then sorted by projection (desc, stable, so ties keep `PDB` insertion order), **max 40 rows**.
- With All selected and an empty query, 27 of the 67 pool players **cannot be reached** without searching or filtering. Row 40 is Evan Engram (8.2).

**Single mode, row tap:**
- `key = target==="poll" ? "opts" : target` (`give` or `get`), then `arr[idx] = name`.
- The picker closes in the same `setState`, returning the user to the composer.
- Already-chosen players are not marked.

**Multi mode, row tap:**
- Toggles the player in `C.players` (list) or `C.order` (rank) **immediately**.
- Selection order is the order players were added; a removed player is filtered out.
- The picker stays open and the badge switches between plus/ink and check/blue.

**Back chevron and "Done"** both do `pick:null`. There is no cancel or revert, because changes are already applied.

#### 3.7 Ranking composer (dead path; documented for completeness)

**Step 1 "Next"** is **always enabled** (`btn(true, …)`). Each tap:
- **Rebuilds `order` from scratch:** `ALLP` filtered (`All` excludes K and DST; otherwise exact position), sorted by `pjN` desc, cut to 12.
  - `from:"mine"` reorders that list with `seeded(name+"m")`.
- Sets `step:2` and `title: C.title || PER[C.period] + " · " + (pos==="All" ? "Overall" : pos) + " · " + scoring`.
  - `PER = { w5:"Week 5", ros:"Rest of season", draft:"2026 draft" }` (L1573) has **no `w6` key**. With Week 6 and an empty title, the default title is **"undefined · Overall · PPR"** (bug).
- So Back (step 2 → 1) followed by Next **discards every reorder, add and remove** made in step 2. The title is kept because of `C.title ||`.

**Step 2:**
- Title and note inputs update `title` and `note`.
- **Up/down** swap with the neighbour. The up arrow on row 1 and the down arrow on the last row stay tappable but do nothing (`mv` returns early); they only fade to opacity .3.
- Remove filters the player out.
- **"Add players"** opens `pick = { mode:"multi", target:"rank", q:"", pos: C.pos }`, so the picker is pre-filtered to the ranking's position.

**"Publish"** is enabled only when `order.length >= 3 && title.trim()`. It posts:
```
{ type:"rank", meta:"Just now", title:title.trim(),
  short: ("Week 5"|"Week 6"|"Rest of season"|"2026 draft") + (pos==="All" ? " overall" : " "+pos),
  scoring, desc:note.trim(), players:order, moves:{} }
```
There is **no `rk` field**. Community `rankV` (L1537) reads `x.rk.pos`, so reviving this path would throw and crash the feed.

#### 3.8 Scroll position

- The composer scroll element persists across poll ↔ trade, list step 1 ↔ 2, and while the picker is open. **Nothing resets its `scrollTop`.**
  - Returning from the picker keeps the exact position (verified: 80px before and after).
  - Switching to shorter content only clamps it. The trade layout does not scroll at all, so switching to Trade lands at 0, and switching back stays at 0.
- Closing and reopening the composer remounts it at 0.
- The picker list starts at 0 each time it opens.

---

### 4. Navigation

**Entry points**
- **Community header "+"** → Create sheet (`openCreate` → `sheet:"create"`).
- **My start/sit header "+"** → `ssNew`. Opens the poll composer directly with **roster on (league 0)**.
- **Profile (`scr:"me"`) → My stuff "Start/Sit" tab → "Ask a question"** → `meNew` → `ssNew` (same as above).
- **Profile "New list" / "New ranking"** buttons do **not** use this composer. They navigate to `FieldScout Mobile Lists and Rankings.dc.html#new-list` / `#new-ranking`.
  - So "Create → List" (the simple in-file composer) and "Profile → New list" (the full Rankings-file editor) are two different list builders.

**Stacking (z-order) within the phone frame:**

| z | Layer |
|---|---|
| auto | Home-indicator pill (134×5, b0, `bottom:8px`, L645); status bar |
| 4 | Dock: tab bar (L639), plus the league switcher (L628) on league screens |
| 20 | Bottom-sheet backdrop + panel (covers status bar, dock and home indicator) |
| 21 | Team view (`hasTv`) |
| 22 | Player profile (`hasProf`) |
| 23 | Settings (`hasSettings`) / `hasTd` overlay |
| 24 | Trade builder (`hasTrade`) |
| 25 | Page (`hasPage`) |
| 26 | Community list/ranking detail (`hasCmDetail`) |
| **27** | **Composer** |
| **28** | **Picker** |
| 29 | Global search |
| 30 | Column-tip dialog (L1109) |
| 30 | Toast (L1117). It is later in the DOM than the column tip, so it paints above it at the same z. |

The composer and picker both start at `top:50px`, so the status bar stays visible. Both are opaque and cover the home-indicator pill.

**Dock and tab bar.** The dock is fully hidden under the composer and picker; no tab is visible or tappable. On the screen underneath it stays as it was:
- From Community: the Home / **Community** / Players / Profile bar, with Community selected (`#fff`; others `#A1A1A6`).
- From Profile (`scr:"me"`): Profile is selected (avatar ring).
- From My start/sit (`scr:"myss"`): not in `["home","community","me"]`, so `inLg` is true and the league tab bar is used. It is hidden either way.

The sheet also covers the dock (backdrop at z 20).

**Back behaviour.**
- Picker back or Done → composer.
- Composer step-2 back → step 1.
- Composer X → closes the composer and returns to the originating screen. That screen stays mounted underneath, so its scroll position is preserved.
- Create → Ranking leaves the file (§3.1).

**After posting:**
- The composer and picker close, and the toast shows.
- Community state is reset: `cmTab:"all"` (For you), topic, query and search cleared. Nothing resets the Community scroll position.
- `scr` is unchanged. When the composer was opened from My start/sit or Profile, the user stays on that screen, and only the toast says "Posted to Community".

There is no swipe-back, Android back or deep link for the composer or picker. In the web build, `top:50px` should map to the top of the viewport / safe area, because the 50px bar and the home-indicator pill are simulated device chrome.

---

### 5. Data shown

**Player row data (`prow`).**
- `name`: full name.
- `short`: e.g. "J. Allen"; names whose first word contains "." and D/ST names are kept whole.
- `meta`: `"{POS} · {TEAM}"`, with `DST` shown as `D/ST`.
- `posC`: POSTXT colour by position. QB `#E03E3E`, RB `#4A68D4`, WR `#8656D8`, TE `#C98A1F`, K `#5E8C8C`, D/ST `#A68A00`. Fallback `var(--x-t3)`.
- `proj`: `pjN(n).toFixed(1)`.
- `head`: `assets/headshots/{file}.jpg` when one exists, otherwise `""`, which gives initials.

**Projection (`pjN`).**
- `parseFloat(player.proj)` when present. This is the Week 5 projection, e.g. Josh Allen `"22.23"` → "22.2".
- Otherwise a seeded placeholder `seeded(name+"pj")()×8+5`, rounded to 1 decimal (5.0–13.0).
- Real product: the current-week projection in the selected scoring.

**Player pool.** `ALLP = Object.values(PDB)` = **67 players**: QB 11, RB 16, WR 13, TE 7, K 10, DST 10 (PDB built at L1216–1220).
- Only **28** have a real `proj`; the other 39 use the seeded placeholder.
- Only **19** have headshot files.
- 26 team codes, all present in `TC`.
- Real product: the full player database.

**Where each field appears:**

| Context | Meta format | Meta style | Projection |
|---|---|---|---|
| Start/sit option | `{POS} · {TEAM} · Proj {x.x}` | 11/500, t3 | In the meta line |
| Trade slot | `{POS} · {TEAM}` | 11/500, t3 | None |
| List row / recs / picker / rank row | `{POS} · {TEAM}` | 11px / 600 in position colour | Picker only: separate "Proj x.x" (12/500, t3) |

**Sorting.**
- **Picker:** projection desc, top 40. The top 5 with no filter are Josh Allen 22.2, Shedeur Sanders 19.7, Bijan Robinson 16.0, Justin Fields 14.6, James Conner 13.9.
- **Recommended:** see §3.5. With an empty list it shows Josh Allen, Shedeur Sanders, Bijan Robinson, Justin Fields, James Conner.
- **Rank seed (dead):** see §3.7.

**Static or sample copy that would be real data:**
- "@dalton" and the avatar letter "D" are hard-coded. The avatar colour follows `s.myAv` (default `#0088FF`, changeable in My team settings).
- "Public · Week 5" and "Week 5" in the post meta are the current week.
- League chooser teams and leagues are the user's leagues. Only the first two appear in the prototype, and `LEAGUES[0].team` follows a team rename.
- Composer defaults (PPR, At kickoff).

**Colour rules.**
- Start = `#07B85A`, Sit = `#FF0028`.
- Selection = ink fill with white text (chips, league chooser) or `#0088FF` (picker check, action pill, start-from ring).
- Disabled action = b3 background + t3 text.
- Error = `#FF0028`.

**Downstream rendering of posted items:**
- **Community (For you, shelves mode):** `items = [...cmMine, ...CMFEED]`, so a new item comes before the sample items of its type. The "Updated by people you follow" block is above the shelves.
  - A new poll is the **first (leftmost) 286px card** in the horizontally scrolling "Start or sit · Week 5" shelf.
  - A new list is the **first card in "Lists for you"**.
  - In the grouped tab views it is first in its group.
  - Poll cards show `modeLabel` "Start N of M" / "Sit N of M" / "Trade", the meta "{scoring} · Week 5", time "now", and 0 votes.
- **Community list cover (`listCover`):**
  - Composer videos always carry `yt`. So if **any video was added**, the card shows a **110px YouTube-thumbnail cover on `var(--x-ink)`** and `color` is ignored.
  - With no videos, the cover background is `color`, with the player collage, at a seeded height of 150, 180 or 205px.
  - With no players and no videos, it is a plain colour block.
- **My start/sit (`ssVals`):**
  - The new poll is listed **first** (it sorts with other open polls ahead of closed ones).
  - Status: **"Open · closes Sun 1:00 PM"**, whatever `close` was chosen. Meta: **"Just now"**.
  - Foot: **"0 votes[ · roster attached] · crowd leans {short(opts[0])}"**. For a trade, `short("Accept")` gives **"A. "**, so the foot reads "crowd leans A. " (prototype bug).
  - The `ssTab` filter is not reset by posting, so with "Closed" selected the new open poll is not shown.
- Composer posts carry `tags:[]`, so they never match topic pills except by player name.

---

### 6. Dark mode (`.fs-dark` values used in this area)

| Variable | Dark | Used here for |
|---|---|---|
| `--x-b0` | `#121212` | Sheet panel; composer and picker background; segmented "on" pill; switch knob; swatch ring gap |
| `--x-b1` | `#282828` | Filled option and slot cards; roster card; description textarea; rank start-from cards |
| `--x-b2` | `#333333` | Pressed rows; segmented track; unselected chips; start/sit remove-button background; search field; YouTube field; row dividers; rank arrow buttons |
| `--x-b3` | `#3E3E3E` | Composer header border; disabled action pill; switch off; outline "Add players" / "Ask a question" ring; disabled-looking "Add" button |
| `--x-b4` | `#575757` | Sheet grab handle; empty-slot ring; recommendation "+" ring; rank radio ring |
| `--x-ink` | `#4D4D4D` | Selected chips (scoring, close, how-many, league, position); list-name underline; active video "Add"; video thumbnail fallback; unselected picker badge; toast |
| `--x-t1` | `#FFFFFF` | Text, plus the "List" create-tile background and the second list swatch (both turn white; verified: the tile renders `rgb(255,255,255)`, so its white list icon becomes invisible) |
| `--x-t3` | `#B3B3B3` | Subs, labels, disabled-pill text, remove icons |
| `--x-t4` | `#A7A7A7` | Picker magnifier |
| `--x-t5` | `#727272` | Create-row chevron |
| `--x-gb` | `#12263F` | Empty-option plus circle |

**The `var(--x-t1)` swatch in dark mode.**
- In list step 2 the cover background (`C.color`) is then **#FFFFFF**.
- With no players, its white list icon is invisible.
- The posted Community list card's cover is also white when the list has no videos, because the stored colour is the variable string.
- The selected ring for this swatch becomes `0 0 0 2px #121212, 0 0 0 3.5px #FFFFFF`.

**Unchanged in dark:**
- `#0088FF`, `#07B85A`, `#FF0028`, `#0074DB`.
- The backdrop `rgba(0,0,0,.32)`.
- POSTXT position colours.
- Headshot initials background `#EEEEF1`, initials `#6E6E73`, and the white ring gap.
- Input placeholder `#6E6E73` (global rule).
- Error text `#FF0028`.

`color-scheme:dark` is set on the `.fs-dark` root and on its inputs and textareas, so the textarea placeholder default and the caret follow the dark scheme.

---

### Open questions
- Two list builders exist. Community Create → List opens the simple composer in this file (name → edit, swatches, videos, recommended). Profile → New list goes to the Rankings file's full list editor (#new-list: thumbnail options, Ranked/Tiers, stats, timeframe). The README says lists use this file's composer. Which should ship, or should both entry points use one builder?
- Create → Ranking leaves the main file. In the Rankings file, X goes to the Rankings hub, and every way back reloads the main file at League › Match with all posts lost. In the web build, should Create → Ranking open the in-app New ranking flow and return to Community on close or publish?
- The in-file ranking composer (New ranking / Edit ranking with arrow reordering) can't be reached and is broken: there is no 'w6' in PER, so the default title becomes 'undefined · Overall · PPR'; Back then Next discards edits; and the published item has no rk field, so Community would crash. Confirm it should be ignored.
- Dark mode: the 'List' create tile and the second list-cover swatch use var(--x-t1), which becomes #FFFFFF. The white list icon disappears, and posted list covers turn white. Intended, or should they use ink #4D4D4D?
- 'Attach my roster' defaults to off from Community Create but on (first league) from My start/sit '+' and Profile 'Ask a question'. Intentional?
- The 'Voting closes' choice (At kickoff / In 24 hours / In 1 hour) is never saved on the post, and My start/sit always shows 'Open · closes Sun 1:00 PM'. Should the choice set the close time?
- A posted trade question's My start/sit footer reads 'crowd leans A. ' because the player-name shortener is applied to 'Accept'. Should it read 'crowd leans Accept' (or 'Decline')?
- Duplicates aren't prevented: the same player can fill two start/sit options or appear in both You give and You get, and single-select picker rows don't mark players already chosen. Should the picker hide, disable or mark them?
- The picker has no empty state when a search or position filter matches nothing; the list is just blank. What copy should show? Also, should search trim spaces and match team names, not just exact team codes?
- The picker shows at most 40 rows, so 27 of the 67 sample players can't be reached without searching or filtering. In the product, should it paginate or scroll the full pool?
- The question placeholder is always 'Who should I start?', even in Sit and Trade modes, while the fallback titles change ('Who should I sit?', 'Should I accept this trade?'). Should the placeholder follow the mode? The textarea placeholder colours are also unstyled (browser default) while input placeholders are #6E6E73. Unify?
- Trade sides have no cap on 'Add another' (start/sit is capped at 6 options). Is there a maximum per side?
- A filled start/sit option or trade slot only opens the picker from its name/meta text, not from the headshot or card padding. Should the whole card be tappable?
- The summary reads 'Voters pick 1 to start from 2 players' even with 0 or 1 players chosen. Keep, or hide it until 2 are chosen?
- How many: the chips are based on the number of rows, but the highlighted value is clamped to (filled players − 1), so a tapped chip can look unselected until enough players are chosen. Keep this, or base both on filled players?
- A private list is still posted to the Community feed with the 'Posted to Community' toast. Should private lists stay off Community, with different toast copy?
- The X discards the composer draft instantly with no confirmation. Keep that, or add a 'Discard draft?' prompt?
- YouTube validation never checks the host: any URL with ?v= plus 11 characters is accepted, and longer IDs are cut to 11. The 'Add' button looks disabled when the field is empty but still shows the error when tapped. Tighten validation and make the button truly disabled?
- Recommended shows nothing when the first list player is a kicker, because kickers are excluded while recommendations match the first player's position. Should kickers be allowed, or should recommendations fall back to popular players?
- Source vs README conflicts: the sheet backdrop is rgba(0,0,0,.32) in the source vs .4 in the README, and the toast lasts 1800ms vs about 2.2s. Every vertical scroller, including the Create sheet, composer and picker, also gets an 84px dock spacer even though the dock is covered. Which values should the build follow?
- The list name has maxlength 40 on step 1 but no limit on step 2, and the step-2 name field has no placeholder. Apply the 40-character limit (and a placeholder) on both?
- The picker's position chips have no FLEX chip, although the Players screen has one. Is that the intended filter set?
- The composer author row hard-codes '@dalton' and the letter 'D', while the avatar colour follows the My team setting. Confirm both should come from the signed-in user.
- Verification note (critic findings refined, none dropped): (1) The multi-picker 'Done' pill measures 59.1px, not ~62; the title sits 11.6px left of centre. (2) The Create panel measures 381px, not ≈378, because the 'Ranking' sub wraps to 2 lines (67px row). (3) In For you, a new post is first in its type's shelf ('Start or sit · Week 5' or 'Lists for you'), not first in one combined list. (4) Composer scrollTop does carry over, but the browser clamps it when content is shorter; the trade layout doesn't scroll, so switching to Trade lands at 0. (5) The font-feature line is L25, as the critic said.
- Verification note (corrections to the previous section found while rendering, not raised by the critic): (1) The picker position-chip row does not scroll at 390; it measures 357px of content in 358px (the old text said about 386px). (2) Only 'Add a player you give' wraps to 2 lines; 'Add a player you get' fits on one line. (3) The README's toast/backdrop values were re-checked: the README does say .4 and about 2.2s.

---

## Gap analysis vs the current app

## Create flows: composer and player picker vs. the current app (worktree `redesign-v7` @ 27d455b)

**Summary.** The **List** path can be built almost entirely on existing data. `POST /api/lists`, bulk player add, player delete, `list_links` for videos and `/api/players/builder` for recommendations all exist, and so do the Create menu, the bottom-sheet primitive, Switch, Segment, chips and the ink toast.

The whole **Start or sit / Trade question** path needs new backend:
- `start_sit_questions` only stores 2 players (player A or B, which must differ), with A/B votes.
- No API route writes it.
- `/app/start-or-sit/*` are placeholder pages behind `startOrSit` (off).
- There is no community "trade question" model at all.

The in-file Ranking composer is dead in the prototype and belongs to the Rankings spec.

Files checked:
- Layout: `src/components/layout/{top-nav,app-shell,bottom-tabs,more-sheet}.tsx`
- UI primitives: `src/components/ui/{sheet,toast,toaster,switch,tabs,badge,avatar,user-avatar}.tsx`, `src/hooks/use-toast.ts`
- Lists: `src/components/lists/{list-form-dialog.tsx,builder/list-builder.tsx,builder/player-sidebar.tsx,builder/types.ts,v2/cover-tile.tsx,v2/list-toolbar.tsx,v2/list-details-tab.tsx}`
- Players: `src/components/players/{player-search,player-image,projected-points}.ts(x)`
- Explore: `src/components/explore/explore-feed.tsx`, `src/hooks/{use-explore-feed,use-leagues}.ts`
- Routes: `src/app/app/(shell)/{explore,profile,start-or-sit/**,lists/new}/*`
- API: `src/app/api/lists/route.ts`, `src/app/api/lists/[id]/{links,players/bulk}/route.ts`, `src/app/api/players/{builder,search}/route.ts`
- Lib and schemas: `src/lib/lists/links-service.ts`, `src/types/schemas/lists.ts`, `src/lib/feature-flags.ts`, `src/lib/scoring/default.ts`
- Schema: `src/types/database.ts` (start_sit_questions, start_sit_votes, lists, list_links, player_weekly_projections, weekly_rankings), `supabase/migrations/001_initial_schema.sql`, `011_player_projections.sql`
- Config and theme: `next.config.mjs`, `src/app/layout.tsx`, `src/app/globals.css`, `tailwind.config.ts`, `src/stores/theme-store.ts`

### Entry points and Create sheet

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Create sheet shell: backdrop .32, 24px top radius, grab handle, "Create" title, no X, tap backdrop to close | restyle-only | `top-nav.tsx` `CreateMenu` (a dropdown); `ui/sheet.tsx` (`side="bottom"`); `more-sheet.tsx` uses the same pattern | The Create menu exists. Mobile needs it as a bottom sheet. The Radix Sheet slides in and draws its own close X, but the design has instant mount, no X and no drag-to-dismiss, so this should be a Sheet variant, not a new component. |
| Sheet option set (Start or sit / Ranking / List) | out-of-scope-or-question | `CreateMenu` has New list / Create or join a league (`leagues` flag) / Start a mock draft (`mockDrafts` flag) | Needs decisions: keep the league and mock entries on mobile? Hide Start or sit and Ranking while `startOrSit` and `weeklyRanks` are off? |
| "List" option opens the list composer | new-ui-on-existing-data | `ui-store.setCreateListOpen` → `ListFormDialog` (app-shell) | Reuse the store action and swap in the new composer UI. |
| "Start or sit" option opens the poll composer | needs-new-backend | `start-or-sit/*` = `PlaceholderPage` | See the poll rows. |
| "Ranking" option navigates to the Rankings new-ranking flow | out-of-scope-or-question | `/app/weekly-ranks` (flag off), `weekly_rankings` table | Owned by the Rankings spec. In the app this should be a route push. The prototype reloads to League › Match and loses posts, which is a prototype artefact. |
| Community header "+" (34px blue circle) | new-ui-on-existing-data | `explore/page.tsx` PageHeader has no action; `community` flag off | Add it as a header action. |
| My start/sit header "+" (poll composer with roster on) | needs-new-backend | No My start/sit screen; `/app/start-or-sit` is a placeholder | Depends on the polls backend. |
| Profile → My stuff create button ("Ask a question" / "New list" / "New ranking") | new-ui-on-existing-data (lists) / needs-new-backend (Start/Sit tab) | `profile/page.tsx` is "My stats", with no My stuff tabs | The prototype has two list builders: Create → List (simple) and Profile → New list (full editor). The app also has two: `ListFormDialog` and `/app/lists/new` `ListBuilder`. Which one does mobile keep? |

### Composer shell and poll composer

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Full-screen composer overlay: 52px header with X or back chevron, title, Post/Next/Save pill (disabled = b3/t3, tapping it does nothing), one scroll body that keeps scrollTop across steps and the picker | new-ui-on-existing-data | `ListFormDialog` is a centred Dialog; `ListBuilder` is a page | UI only. X discards the draft with no confirm; step-2 back keeps the draft. |
| Author row (avatar, @handle, "Public · Week N") | new-ui-on-existing-data | `useAuth()` profile.username / avatar_url; current week from `nfl_weeks` | The prototype hard-codes "@dalton" and "D". |
| Question-type segmented control (Start or sit / Trade) | restyle-only | `ui/tabs.tsx` `Segment` / `SegmentItem` | The control exists; what it switches between needs backend. |
| Question textarea (optional; default titles "Who should I start/sit?" and "Should I accept this trade?") | needs-new-backend | `start_sit_questions.context_note` (≤280) is a note, not a title | No route writes start_sit_questions. |
| Start/sit options: 2–6 rows, empty "Choose player N", filled row, tap name to replace, remove (minimum 2), "Add another option" | needs-new-backend | Schema has `player_a_id` / `player_b_id` only, CHECK a≠b; votes are `'a'|'b'` | Needs an options model and per-option votes. |
| "Ask people to" Start/Sit, "How many" pick-N (clamped to filled−1), summary line | needs-new-backend | No mode or pick_n columns | The clamp logic is UI-only. |
| Trade question (You give / You get columns, uncapped slots, Accept/Decline) | needs-new-backend | No table. `trades` / `trade_votes` are league trades under the leagues spec | This is a new community poll type. |
| Attach my roster switch + league chooser chips (team / league) | needs-new-backend | `useLeagues()` `MyLeagueRow` has name, team_count, my_team_id but no team name; `league_rosters`; `leagues` flag is the test cohort | Needs a post→team link and a decision on roster snapshot vs. live roster. The prototype shows only the first 2 leagues. Should this show at all when `leagues` is off? |
| Scoring chips (Standard / Half PPR / PPR, default PPR) | new-ui-on-existing-data | `start_sit_questions.scoring_system_id`; `SCORING_PRESETS` in `lib/scoring/default.ts`; `FilterChip` | Persists once a poll API exists. |
| Voting closes chips (At kickoff / In 24 hours / In 1 hour) | new-ui-on-existing-data | `start_sit_questions.voting_closes_at`; `nfl_games` kickoffs | The prototype never saves this choice and always shows "closes Sun 1:00 PM"; the real build must save it. For several players, does "kickoff" mean the earliest kickoff? |
| Post validation and payload (≥2 filled; trade needs ≥1 give and ≥1 get) | needs-new-backend | No POST route for start/sit or polls under `src/app/api` | — |
| The same player allowed twice (two rows, or both give and get) | out-of-scope-or-question | DB CHECK `player_a_id != player_b_id`; the "prevent, don't refuse" rule | Recommendation: mark or disable already-chosen players in the picker. |

### List composer

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Step 1 "Name your list" (centred 26px input, maxlength 40; Create and Next disabled until non-empty; Enter advances) | new-ui-on-existing-data | `ListFormDialog` (placeholder "e.g. Top 10 sleeper picks"); `listTitleSchema` max 100 | The design's 40 conflicts with the API's 100; pick one. |
| Cover: 96px, 2×2 headshot collage or a list icon | restyle-only | `lists/v2/cover-tile.tsx`, `list-thumbnail.tsx` | The existing cover is headshots over the position-group fill. |
| Colour swatches (5); cover takes the picked colour | out-of-scope-or-question | `lists` has no colour column; cover-tile.tsx records Chris's 2026-08-11 ruling that the background is the position group | Conflicts with that ruling. If approved, it needs a column. In the prototype's dark mode the `t1` swatch makes a white cover with an invisible icon. |
| Name, description (≤500), Public switch with on/off sub copy | new-ui-on-existing-data | `POST/PATCH /api/lists` (title, description, is_private); `ListFormDialog` Visibility segment; `ui/switch.tsx` | `POST /api/lists` still enforces `FREE_PRIVATE_LIST_LIMIT` (403 "Upgrade to Pro") for non-Pro users, despite the 2026-08-03 Pro suspension. Switching Public off on a second list will fail. Needs a ruling. |
| Videos: paste YouTube link, Add, error line, 96×54 thumbnail rows, remove | new-ui-on-existing-data | `list_links` (migration 080) via `/api/lists/[id]/links` POST (kind `video`, title required) and `/links/[linkId]` DELETE; `list-details-tab.tsx` already has link-add UI | Differences from the design: the API caps links at 10 per list (design: no cap). The API checks only http/https, while the prototype's `ytId` accepts any host with `?v=`, so require a YouTube host. Use the i.ytimg.com thumbnail as a plain `<img>` or CSS background (no `images.remotePatterns` in `next.config.mjs`). Links can only be added after the list exists. |
| Players section ("Players · n", rows with remove, empty-state "Add players" button) | new-ui-on-existing-data | `/api/lists/[id]/players/bulk` (≤500), `DELETE /api/lists/[id]/players/[playerId]`; `ListBuilder` already does create + bulk | — |
| Recommended (top 5 by projection at the first player's position, excluding kickers; "Popular players to start your list") | new-ui-on-existing-data | `/api/players/builder` (sorted by projection, `positions` filter) | Filtered on the client. Prototype bug: a kicker first gives 0 rows under a visible heading. Hide the block or allow kickers. |
| Save: create list + players + videos, toast "Posted to Community", stay on the originating screen | new-ui-on-existing-data | `ListFormDialog` / `ListBuilder` toast "List created" then `router.push('/app/lists/[id]')` | Three separate calls (create, bulk, links), so a partial failure must be handled. Announcing a private list as "Posted to Community" is a prototype bug. Navigate to the list (current behaviour) or stay? |

### Ranking composer (dead in the prototype)

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| In-file New/Edit ranking (chips, start-from cards, up/down reorder, Publish) | out-of-scope-or-question | `weekly_rankings` (user/week/position/rankings JSON), `/app/weekly-ranks` (flag off) | Unreachable. It has bugs: the Week 6 title becomes "undefined · …", and the missing `rk` field crashes the Community feed. Build it only through the Rankings spec. |

### Player picker

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Full-screen picker overlay (back chevron, centred title, "Done" in multi mode, spacer in single mode) | new-ui-on-existing-data | `PlayerSearch` (`onSelect`, `/api/players/search`); `AddPlayersPopover` (`list-toolbar.tsx`); `PlayerSidebar` (builder; has `layout` and `frameless` props) | Build it as a mobile layout or variant of the existing pickers, not a new component (CLAUDE.md: no near-duplicates). |
| Search (name contains, or exact team code) | new-ui-on-existing-data | `/api/players/builder?teams=`; `PlayerSidebar` filters names on the client | — |
| Position chips All / QB / RB / WR / TE / K / D/ST | restyle-only | `PlayerSidebar` `POSITION_FILTERS` (QB…K, DEF); `FilterChip` | Label DEF as D/ST. |
| Row: 36px headshot, name, POS · TEAM in position colour, trailing "Proj x.x"; multi-mode plus/check badge | restyle-only | `PlayerRow`, `PositionBadge`, `PlayerAvatarImage`, `nfl-team-colors` | — |
| Current-week projection in the selected scoring (used to sort and display) | needs-new-backend | `/api/players/builder` returns season-long `players.projected_pts_*`; `player_weekly_projections` (stats JSON) is only scored per player in `core-stats-ops` | Needs a bulk weekly-projection read. Colour conflict: D497 (`projected-points.ts`, `PROJ_TEXT` = fs-blue-deep everywhere) vs. the design's t3 grey. |
| Results capped at 40 | out-of-scope-or-question | The builder route deliberately pages the whole pool (`pageAll`, the 1000-row lesson) | The cap leaves 27 of 67 players unreachable in the prototype. Recommendation: a full virtualised list. |
| Multi mode: toggle applies immediately; Done and back both close | new-ui-on-existing-data | `ListBuilder` `added` set; `AddPlayersPopover` | — |
| Single mode: fills the slot and closes; chosen players not marked | new-ui-on-existing-data | — | See the duplicates question. |
| No-match state (blank in the prototype) | new-ui-on-existing-data | `AddPlayersPopover` already tells a failed fetch apart from no match | CLAUDE.md requires designed empty and error states: add "No players match" plus an error state. |

### Shared visuals, downstream rendering, theme

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Toast "Posted to Community" (ink pill, bottom 100px, 1800ms, no animation) | restyle-only | `ui/toast.tsx` (ink pill), `toaster.tsx` (4500ms, slide/fade), `use-toast.ts` | Needs a duration, position and animation variant. |
| Switch 44×26, green on, 200ms background fade, knob jumps | restyle-only | `ui/switch.tsx` (32×19, brand fill, knob slides) | Mobile variant. |
| Chips (32px pills: ink on / b2 off; Start green, Sit red; 32px circular how-many) | restyle-only | `FilterChip` in `ui/badge.tsx` | — |
| Headshot: team-colour ring + initials fallback | restyle-only | `PlayerAvatarImage`, `Avatar`, `getTeamColors` | The initials rule differs (strip " D/ST", first + last part). The app shows a team logo for DEF. |
| Font: Inter Display with tnum + cv11 | restyle-only | `layout.tsx` Inter (opsz 32); `globals.css` sets tnum only on `.fs-num` | cv11 is not set. |
| Overlay z-order (sheet 20 / composer 27 / picker 28 / toast 30) and instant mount | new-ui-on-existing-data | Radix Dialog and Sheet animate by default | — |
| New poll first in Community "Start or sit · Week N" shelf | needs-new-backend | `use-explore-feed.ts` reads public lists only | — |
| New list first in "Lists for you" | new-ui-on-existing-data | `use-explore-feed` (newest = recent public lists) | `community` flag is off. |
| Community list cover becomes a YouTube thumbnail when the list has a video | out-of-scope-or-question | `cover-tile.tsx` ruling (position-group fill) | Conflicts with the cover ruling. |
| My start/sit row ("Open · closes …", votes, roster attached, crowd leans) | needs-new-backend | None | Prototype bugs: "crowd leans A. " on trades, and the close choice is ignored. |
| Dark mode values for this area | out-of-scope-or-question | CLAUDE.md says single theme, but HEAD 27d455b adds `m-*` light/dark tokens (`globals.css`, `tailwind.config.ts`) and `src/stores/theme-store.ts`, citing "Chris 2026-10-15: dark mode is mobile-only" | Needs confirmation. Prototype dark bugs: the "List" tile turns white and hides its icon, and the t1 swatch gives a white cover. |

**Feature flags behind these flows:** `startOrSit`, `community`, `weeklyRanks` and `leagues` are all off for the launch build. Lists are the only path fully live.
