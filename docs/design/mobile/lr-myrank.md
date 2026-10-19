## My rankings, New ranking flow, Ranking editor, Submit

**Sources.** The prototype is `FieldScout Mobile Handoff/FieldScout Mobile Lists and Rankings.dc.html`. Markup is at L41–L57, L99–L121, L142–L167, L192–L225 and L257–L301; the script is L307–L590. The README is in the same folder.

**Missing files in the handoff folder.** The folder holds only the prototype, `README.md`, `support.js` and `assets/`. Two files are missing:
- **`FSHeadshot.dc.html`.** `support.js` fetches `./FSHeadshot.dc.html` (`COMPONENT_DIR = "."`, L1402). When the fetch fails it logs "the reference renders as an empty placeholder", so in the handoff copy **every headshot in this area is blank**.
- **`FieldScout Mobile.dc.html`**, the main app. Every cross-file link from this area therefore goes to a missing file when opened from the handoff folder.

Both files exist in `/Users/chrisdaltas/Documents/Hadouken/design_handoff_fieldscout_mobile/`. That folder's copies of the Lists and Rankings file and of `support.js` are byte-identical to the handoff folder's. Cross-file behaviour and headshot details below were checked against those copies.

**How values were checked.** Every placeholder value and behaviour quoted below was produced by running the prototype's own `Component` script headlessly in Node, not read off a screenshot. Paint-order claims (the drop indicator and headshot rings) were checked by rendering the same markup in headless Chrome.

**How colours are written.** In light mode the prototype defines no CSS variables, so every `var(--x-…, fallback)` renders its fallback. Each colour is written as `token (light fallback)`, and dark values are in §6. One token can have different light fallbacks in different places. For example, `--x-b4` is #D1D1D6 in most places but #C7C7CC on radio buttons; each place is quoted exactly.

**Global frame (only what affects this area)**
- **Phone.** Viewport 390 × 844, radius 48px, `overflow:hidden`. Background b0 (#FFFFFF), text t1 (#1D1D1F). The phone is a vertical flex column.
- **Font.** `'InterDisplay'` from `https://rsms.me/inter/inter.css`, with `font-feature-settings:'tnum' 1,'cv11' 1` and `-webkit-font-smoothing:antialiased`. Line-height is the browser default unless stated.
- **Status bar** (device chrome). 50px tall, padding `6px 32px 0 40px`, "9:41" in 16/600. The dynamic island is 120 × 34, radius 999, #000, 11px from the top, centred.
- **Rendering of `<sc-if>` / `<sc-for>`.** They render as React Fragments and add no DOM wrapper. Their children are direct flex children of the surrounding element, so parent `gap` values apply between them.
- **Scrollbars.** `.fsm-scroll` hides them (`scrollbar-width:none` and `::-webkit-scrollbar{display:none}`).
- **Dock spacer.** When the tab bar is visible, the phone gets class `dock-sm`, which sets `--x-dockpad:84px`.
  - Every `.fsm-scroll` whose inline style contains `overflow-y` gets an `::after { content:""; display:block; flex:none; height:var(--x-dockpad,0px) }`, so its last row clears the bar.
  - On screens without the bar the spacer is 0px tall.
  - When the scroller is itself a flex column with `gap`, the `::after` is a flex item. Even at 0px it adds one more `gap` at the bottom (see §2.2).
- **Input placeholders** are #6E6E73 everywhere (global CSS, not themed).

---

### 1. Screens and states

| # | Screen / state | Condition in code | Notes |
|---|---|---|---|
| A | **My rankings, standalone (`#mine`)** | `scr==="rk" && rk.src==="mine" && myOnly===true` | Title "My rankings". No source tabs. The root header (back + Create) and the tab bar are shown. |
| A′ | **My rankings as the hub's "Mine" tab** | `scr==="rk" && rk.src==="mine" && !myOnly` | Title "Rankings". The source tabs are **always exactly Experts / Scout AI / Users / Mine**, with Mine underlined. A community-author tab exists only when `rk.src` starts with `c:`, which can never be true here because `rk.src` is `"mine"`. The body is identical to A. `myOnly` is set only by the `#mine` hash, and tapping any source tab clears it. |
| A1 | Filter **All**: grouped by period | `myRankF` is `"all"` (default) → `mgShow` | Ranking cards grouped by period, plus empty-period cards (open ones with Start, locked ones faded). |
| A2 | Filter **Submitted / Unsubmitted / Finalized** | `myRankF !== "all"` → `myRankCardsV` | A flat list of matching cards. No period grouping, and no empty or locked cards. |
| A3 | Filtered, nothing matches | `myRankF !== "all"` and zero matches → `myRankNone` | Centred message (copy in §2.1). |
| A4 | Open empty period | Rest of season, or Week 5–8, with no ranking of that type | Card with a "Start" pill. |
| A5 | Locked future period | Week 9–18 with no ranking | Card at opacity .5 reading "Opens in Week N". No Start pill; cursor is default. |
| A6 | Hidden periods | Weeks 1–4 with no ranking; Pre-draft with no ranking | Not rendered. A past week that has a ranking is still shown (e.g. Week 4 Finalized). |
| B1 | **New ranking, step 1 (type)** | `scr==="rkNew" && nw.step===1` | No tab bar and no root header. Counter "1 of 3", progress bar at 33%. |
| B1a | Step 1, Weekly selected | `weekOf(nw.type) > 0` | The Week chip row is shown. |
| B1b | Step 1, ranking already exists | `myRanks` has a ranking with the same type, scoring and pos | Orange notice, and the button reads "Open my ranking". **The default preset (Week 5 · RB · PPR) is already in the seed data, so this is the first state the user sees.** |
| B2 | **New ranking, step 2 (start from)** | `nw.step===2` | Counter "2 of 3", progress bar at 66%. The back icon becomes a chevron. |
| C | **Ranking editor** | `scr==="ed" && ed.kind==="rank"` | No tab bar and no root header. The footer bar is shown. |
| C1 | New, unsaved (from step 2 or "Start my ranking from this") | `dirty:true, status:"new", id:null` | Save is blue. The footer reads "Unsaved changes"; Submit is grey. |
| C2 | Saved | `!dirty && status==="saved"` | Save reads "Saved" (grey). The footer reads "Saved {date}"; Submit is green and enabled. |
| C3 | Submitted (current or future week, ROS or pre-draft) | `status==="submitted"`, not a past week | The footer reads "Submitted" in green. The button reads "Submitted" (grey, inert). |
| C4 | Finalized | `status==="submitted"` and week < 5 | The footer reads "Finalized" / "{acc} · can't be edited", and the button reads "Finalized" (grey). Editing is **not** actually blocked (see quirks). |
| C4d | Finalized **and** dirty | Finalized + `dirty:true` | The finalized check runs first, so the footer **still** reads "Finalized" (now in `--x-to` #B25C00) with "{acc} · can't be edited". The button still reads "Finalized" (grey), but tapping it shows the toast "Save your changes first". The Save pill turns blue "Save". |
| C5 | Dirty (any edit), not finalized | `dirty:true` and not finalized | Save is blue. The footer reads "Unsaved changes" (orange) / "Save before you submit". Tapping Submit shows the toast "Save your changes first". |
| C6 | Empty, no players | No item with `t==="p"` | "No players yet" empty state. The Tier 1 header is hidden. |
| C6t | Empty, but tier lines exist | No players, and at least one `{t:"tier"}` | The empty state still shows (`isEmpty` checks players only), and the tier-line rows render **below** it. Example: Blank ranking → Add tier line gives "No players yet…" with a "Tier 2" line under it and no Tier 1 header. |
| C7 | Drag in progress | `dragOver === i` | The hovered row's wrapper gets `box-shadow: inset 0 2px 0 #0088FF`. It is **visible only when the hovered row is a tier line**. On a player row, the row's own opaque `b0` background paints over the wrapper's inset shadow, so nothing shows (confirmed by rendering). On a tier row the line follows the wrapper's 10px radius, so its ends curve down. |
| C8 | Clean but never saved | `dirty:false, status:"new", id:null` (only reachable from the jump panel's "Blank ranking") | Save pill reads "Saved" (grey). Footer reads "Saved just now" (t1) / "Only you can see this until you submit". Submit is grey; tapping it does nothing and shows no toast. **The screen says "Saved" for a ranking that was never saved.** |
| D | **Add players sheet** | `sheet==="pick"` over the editor | Bottom sheet. |
| E | **Submit sheet** | `sheet==="submit"` over the editor | Bottom sheet. |
| F | **Ranking submitted (confirmation)** | `scr==="done"` | The tab bar is shown; there is no root header. |
| — | Toast | `toast` is non-empty; cleared after 2200ms | Strings: "Ranking saved", "Auto tiers applied. Drag a tier line to adjust.", "Save your changes first". |

**Jump panel** (presentation only). It seeds these states:
- **"My rankings"** sets `rk.src:"mine"` but does **not** touch `myOnly`. It renders A′, unless the session began at `#mine` and no source tab has been tapped since; then `myOnly` is still true and it renders A.
- **"New ranking: type"** opens step 1.
- **"New ranking: start from"** opens step 2 with Week 6 · WR · PPR.
- **"Ranking editor"** opens `myRanks[0]`.
- **"Blank ranking"** opens Week 6 · TE · PPR with no items, `dirty:false`, `status:"new"` (state C8).
- **"Submit sheet"** opens `myRanks[0]` as saved, with the sheet open.
- **"Submitted"** opens the confirmation with the title "Week 6 · WR · PPR".

---

### 2. Layout, top to bottom

#### 2.1 My rankings (A / A′)

**Root header.** It sits outside the scroller and does not scroll. `flex:none`, row, `align-items:center`, `gap:10px`, `padding:2px 16px 0`.
- **Back** (left): 34 × 34 circle on b2 (#F2F2F4). Chevron icon 16 × 16, viewBox 16, path `M10 3L5 8l5 5`, stroke 2, round caps and joins, colour t1 (#1D1D1F).
- A `flex:1` spacer.
- **Create** (right): 34 × 34 circle on #0088FF, `title="Create"`. Plus icon 15 × 15, path `M8 3v10M3 8h10`, stroke 2.4, round caps, white.

**Scroller.** `flex:1; min-height:0; overflow-y:auto; position:relative`, not a flex container. It gets the 84px dock spacer as a block after the content.

- **Title.** Wrapper `padding:12px 16px 0`. Text "My rankings" (A) or "Rankings" (A′) at 26px / 700, letter-spacing -0.03em.
- **(A′ only) Source tabs.**
  - Row: `gap:18px`, `overflow-x:auto`, `padding:0 16px`, `margin-top:6px`, `border-bottom:1px solid` b3 (#EBEBEE).
  - Each tab: height 38, 14/600, nowrap. Colour is t1 when active and t3 (#6E6E73) otherwise.
  - Underline: `box-shadow: inset 0 -2px 0` in ink (#1D1D1F) when active, transparent otherwise.
  - Labels: always "Experts", "Scout AI", "Users", "Mine".
- **Body container.** `padding:14px 16px 24px`, column, `gap:10px`. Its children, in order:
  1. **Filter chips row.** `overflow-x:auto`, `gap:6px`.
     - Each chip: height 30, `padding:0 12px`, radius 999, `gap:5px`, 13/600, nowrap.
     - Active: #FFFFFF text on ink (#1D1D1F). Inactive: t1 (#1D1D1F) text on b2 (#F2F2F4).
     - Content: the label, then a count `<span>` at 11/600, opacity .6.
     - Order: **All**, **Submitted**, **Unsubmitted**, **Finalized**. Every chip shows its count, All included.
     - Seed counts: All 3 · Submitted 1 · Unsubmitted 1 · Finalized 1.
  2. **(All filter) Period groups.** Each visible period is a column with `gap:10px`. It holds that period's ranking cards; only if it has none, it holds one empty-period card instead.
     - Because sc-for adds no wrapper, groups are spaced by the body's 10px gap.
     - **There is no period header text.** A period's name appears only on its empty card.
  3. **(Filtered, no matches) Empty message.** `padding:36px 0`, centred, 13/500, t3 (#6E6E73):
     - Submitted: "Nothing submitted for upcoming weeks"
     - Finalized: "No finalized rankings yet. Submitted weeks finalize once they're played."
     - Unsubmitted: "Everything is submitted"
  4. **(Filtered) Flat list of ranking cards.**

**Ranking card** (the same markup in grouped and flat lists):
- **Container.** `padding:12px 14px`, radius 16, **no fill** (the page shows through). Outline is `box-shadow: inset 0 0 0 1px` b3 (#EBEBEE). Column, `gap:8px`, cursor pointer.
- **Row 1** (`gap:8px`, centred):
  - Title: `flex:1; min-width:0`, 15/600, single line with ellipsis.
  - Status pill: height 22, `padding:0 8px`, radius 999, 11/600, nowrap.

    | Status | Text | Background |
    |---|---|---|
    | **Finalized** | b0 (#FFFFFF) | t1 (#1D1D1F), a black pill |
    | **Submitted** | `--x-tg` (#067A3E) | `--x-gg` (#E3F9EC) |
    | **Saved** | `--x-tb` (#0074DB) | `--x-gb` (#E6F2FF) |
    | **Draft** | t2 (#3A3A3C) | b2 (#F2F2F4) |
- **Row 2.** Meta text at 12/500, t3 (#6E6E73). Format in §5.
- **Row 3** (flex, centred):
  - **Headshots.** Up to 5 overlapping. Each sits in a wrapper with `margin-right:-6px`, radius 50% and `box-shadow: 0 0 0 2px` b0 (#FFFFFF), holding an `FSHeadshot` at 26px.
  - **The wrapper's 2px ring is never visible.** FSHeadshot's own ring (`0 0 0 1px #fff, 0 0 0 2.5px {team colour}`) is 2.5px wide and paints over it. Later headshots paint above earlier ones.
  - The visible separator between overlapping heads is therefore **1px #fff plus 1.5px team colour** from the upper head. This was confirmed by rendering; see §6 for dark mode.
  - **Accuracy text.** `margin-left:14px`, 12/600. #07A852 if the text contains "Top", otherwise t3 (#6E6E73). An empty string renders nothing.

**Empty-period card:**
- **Container.** `padding:12px 14px`, radius 16, outline `inset 0 0 0 1px` b3 (#EBEBEE), row, centred, `gap:8px`. Cursor is pointer when open and default when locked. Opacity is 1 when open and **.5** when locked.
- **Left column** (`flex:1; min-width:0`, `gap:2px`): the period label at 15/600 (e.g. "Week 6", "Rest of season"), then a sublabel at 12/500, t3 (#6E6E73).
- **Right, open periods only.** A **"Start"** pill: height 28, `padding:0 12px`, radius 999, 12/600, white on #0088FF.
- **Sublabels:**
  - "This week · not started" for Week 5, the current week. It never shows in the seed, because Week 5 has a ranking.
  - "Not started" for Weeks 6–8 and Rest of season.
  - "Opens in Week N" for locked weeks, where N = week − 3. Week 9 shows "Opens in Week 6"; Week 18 shows "Opens in Week 15".

**Seed render, filter All, top to bottom:**
1. **"Rest of season · WR · PPR"**, status **Saved**.
   - Meta "15 players · 3 tiers · started from Experts · Oct 11".
   - Heads: J. Chase, A. St. Brown, P. Nacua, J. Jefferson, C. Lamb. No accuracy text.
2. **"Week 4 · QB · PPR"**, status **Finalized**.
   - Meta "10 players · 2 tiers · started from Scout AI · Oct 4".
   - Heads: Allen, Daniels, Jackson, Burrow, Hurts. Accuracy "Top 18% accuracy" in green.
3. **"Week 5 · RB · PPR"**, status **Submitted**.
   - Meta "15 players · 4 tiers · started from Scout AI · Oct 13".
   - Heads: Gibbs, Robinson (photo), Barkley, McCaffrey, Kamara (photo). Accuracy "Graded after Monday night" in t3.
4. **Empty cards "Week 6", "Week 7", "Week 8"**, each "Not started" with **Start**.
5. **Empty cards "Week 9" through "Week 18"**, faded, "Opens in Week 6" through "Opens in Week 15".

After the last item come the 24px of body padding and then the 84px dock spacer.

**Tab bar** (this file's version; it differs from the main app, see §4):
- **Bar.** `flex:none`, height 84, `position:relative`, `z-index:4`, `margin-top:-84px` (so it overlays the scroller), `grid-template-columns:repeat(4,1fr)`, `padding:8px 8px 26px`, background `--x-barA` (rgba(29,29,31,.94)). No blur.
- **Items.** Column, centred, `gap:4px`. Icons are 22 × 22, viewBox 16, stroke 1.5, round caps and joins. Labels are 10/600.
  - **Home**: `M2.5 7.2L8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5z`
  - **Community**: star `M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z`
  - **Leagues**: trophy `M5 2.5h6v3a3 3 0 0 1-6 0zM5 3.5H3v1.2A2.3 2.3 0 0 0 5.2 7M11 3.5h2v1.2A2.3 2.3 0 0 1 10.8 7M8 8.5v2.5M5.5 13.5h5L10 11H6z`
  - **Profile**: a 24 × 24 avatar circle on #0088FF with "D" at 11/700 in white. Its ring is always shown: `0 0 0 2px` ink (#1D1D1F), then `0 0 0 3.5px` b0 (#FFFFFF).
- **Colours.** Profile's label is #FFFFFF, so Profile always looks active. The other three use t3 (#6E6E73).

#### 2.2 New ranking (B1 / B2)

**Header.** Height 52, row, `gap:8px`, `padding:0 12px`, `border-bottom:1px solid` b3 (#EBEBEE).
- **Left.** A 36 × 36 hit area with no fill, holding a 16 × 16 icon (stroke 2, t1). Step 1 shows an **X** (`M4 4l8 8M12 4l-8 8`); step 2 shows a **chevron** (`M10 3L5 8l5 5`).
- **Centre.** "New ranking", 16/600, `flex:1`, centred.
- **Right.** `width:36px`, right-aligned, 12/600, t3 (#6E6E73). Reads "1 of 3" or "2 of 3". The flow has only two steps: the editor that follows shows no step or progress indicator.

**Progress track.** Height 3, background b2 (#F2F2F4). The fill is 3px of #0088FF at **33%** (step 1) or **66%** (step 2), with `transition: width .2s linear`. It animates both forward (Continue) and **backward** (the step-2 chevron).

**Scroll body.** `.fsm-scroll`, `flex:1; min-height:0; overflow-y:auto; padding:18px 16px 24px`, column, `gap:22px`.
- The bar is hidden, so the dock spacer is 0px. But the 0px `::after` is still a flex item, which adds one more 22px gap.
- **The space under the last element is therefore 22 + 24 = 46px**, not 24px.

**Step 1 content.** Blocks are separated by the 22px gap.
- **Heading block** (column, `gap:4px`):
  - "What are you ranking?" at 22/700, letter-spacing -0.02em.
  - Subtext at 13/500, t3: "Each type is saved separately, so a Week 6 ranking never changes your Week 5 one."
- **Type radio cards** (column, `gap:8px`):
  - Each card: row, `align-items:center`, `gap:12px`, `padding:12px 14px`, radius 14, background b1 (#F5F5F7).
  - Selection ring: `inset 0 0 0 2px #0088FF` when selected, none otherwise.
  - Text column (`flex:1`, `gap:2px`): label at 15/600, sub at 12/500 in t3.
  - Radio: a 20 × 20 circle.
    - Selected: `inset 0 0 0 6px #0088FF`, leaving an 8px centre that shows the card's b1.
    - Unselected: `inset 0 0 0 1.5px` b4 (#C7C7CC).
  - Options:
    1. **Weekly**: "One week of games. Graded after Monday night."
    2. **Rest of season**: "Where players finish from here. Graded weekly."
    3. **Pre-draft**: "Your board for upcoming drafts. Syncs to the draft room."
- **Week block** (Weekly only). Column, `gap:8px` between label and chips.
  - Label "Week" at 13/600, t3.
  - A wrapping row with `gap:6px` of "Week 5", "Week 6", "Week 7", "Week 8".
  - Chips: height 34, `padding:0 14px`, radius 999, 13/600. Selected: white on ink (#1D1D1F). Unselected: t1 on b2 (#F2F2F4).
- **Scoring block.** Column, `gap:8px`. Label "Scoring", then chips **PPR** and **Standard** in the same chip style.
- **Position block.** Column, `gap:8px`. Label "Position", then a grid.
  - Grid: `repeat(4, minmax(0,1fr))`, `gap:6px`.
  - Cells: height 36, radius 10, 13/600, centred, same selected and unselected colours as the chips.
  - Order: QB, RB, WR, TE on row 1; K and D/ST left-aligned on row 2.
- **Existing-ranking notice** (B1b).
  - `padding:10px 12px`, radius 12, background `--x-go` (#FFF3E6), text `--x-to` (#B25C00) at 12/500, line-height 1.4.
  - Copy: "You already have a {summary} ranking. Continuing opens it instead of starting a new one."
  - Example: "You already have a Week 5 · RB · PPR ranking. Continuing opens it instead of starting a new one."

**Step 2 content:**
- **Heading** (column, `gap:4px`):
  - "Start from" at 22/700, -0.02em.
  - Subtext at 13/500, t3: "{summary}. Starting from a ranking gives you auto tiers you can adjust." Example: "Week 6 · WR · PPR. Starting from a ranking gives you auto tiers you can adjust."
- **Source radio cards** (column, `gap:8px`):
  - Each card: column, `gap:8px`, `padding:12px 14px`, radius 14, background b1, with the same selection ring and radio as step 1.
  - **Top row** (row, centred, `gap:12px`):
    - Text column (`flex:1`, `gap:2px`). Its first line is a label row (`gap:6px`) holding the label at 15/600 nowrap and, optionally, a **"Recommended"** badge. The badge is height 18, `padding:0 6px`, radius 999, 10/600, #0088FF text on `--x-gb` (#E6F2FF). The second line is the sub at 12/500 in t3.
    - Then the 20px radio.
  - **Below the top row:** a top-3 preview at 11/500, t3, `white-space:nowrap`, single line with ellipsis.
  - Options:
    1. **Scout AI** (Recommended): "Model ranking, updated 6:00 AM"
    2. **Expert consensus**: "Average of 5 experts"
    3. **Users average**: "2,418 submitted rankings"
    4. **Start blank**: "Add players one at a time". This option has no preview line.
- **Preview format.** The source string joins entries with three spaces (`"1. J. Gibbs   2. B. Robinson   3. S. Barkley"`). `white-space:nowrap` collapses runs of spaces, so it **renders with single spaces**: "1. J. Gibbs 2. B. Robinson 3. S. Barkley". Names are short-form.
  - Small pools give fewer than three entries. Week 6 D/ST shows only "1. Broncos D/ST", and Week 6 K shows "1. B. Aubrey 2. C. Dicker".

**Footer** (fixed): `padding:10px 16px 30px`, `border-top:1px solid` b2 (#F2F2F4).
- Button: height 48, radius 14, 15/600, white on #0088FF, **always enabled**.
- Label on step 1: "Continue", or "Open my ranking" when a matching ranking exists.
- Label on step 2: "Start ranking".

#### 2.3 Ranking editor (C)

**Header.** Height 52, row, `gap:8px`, `padding:0 12px`, **no bottom border**.
- **Back**: 36 × 36 with no fill; chevron 16 × 16, stroke 2, t1.
- **Title input**:
  - `flex:1`, `min-width:0`, no border or outline, transparent background, inherits the font.
  - 16/600, centred, t1. No placeholder.
  - Default value is "{Type} · {Pos} · {Scoring}".
- **Save pill**: height 32, `padding:0 14px`, radius 999, 13/600.
  - Dirty: "Save", white on #0088FF.
  - Clean: "Saved", t3 (#6E6E73) on b2 (#F2F2F4).

**Tools block.** `padding:0 16px 10px`, column, `gap:10px`, `border-bottom:1px solid` b3 (#EBEBEE).
- **Tool chips** (`overflow-x:auto`, `gap:6px`):
  - Each chip: height 30, `padding:0 12px`, radius 999, `gap:5px`, 12/600, nowrap, background b2 (#F2F2F4), text t1.
  - Icons are 12 × 12 at stroke 1.9.
  - In order: **Add players** (`M8 3v10M3 8h10`), **Auto tiers** (`M3 4h10M3 8h7M3 12h4`), **Add tier line** (`M2.5 8h11M8 5v6`).
- **Info line** at 11/500, t3. Format: "{n} players · drag to reorder · started from {source}". Example: "15 players · drag to reorder · started from Scout AI".
  - For a ranking copied from a community ranking, the source shows the author's handle (e.g. "started from @ortizff"). This holds only in the unsaved editor, and in the same editor session after saving.
  - Saving drops the author, because the saved record has no `fromBy`. Reopening the ranking later shows "started from another user".

**List scroller.** `flex:1`, `overflow-y:auto`, `padding:4px 12px 24px`. It is a block, not a flex container. Note the **12px** gutter; rows add their own 4px inset.
- Children in order: the empty state (if no players), the Tier 1 header (if players exist), then one row wrapper per item.

- **Empty state.** `padding:48px 20px`, column, centred, `gap:12px`, centred text.
  - "No players yet" at 15/600.
  - "Add players one at a time, or go back and start from Scout AI or the experts." at 13/500, line-height 1.4, t3.
  - **Add players** button: height 40, `padding:0 18px`, radius 999, 14/600, white on #0088FF.
  - Tier-line rows still render below the empty state if any exist (state C6t).
- **Tier 1 header** (shown only when players exist). `padding:10px 4px 4px`, row, `gap:8px`.
  - "Tier 1" at 12/700 in **#4A68D4**, followed by a `flex:1` 1px line in **b3** (#EBEBEE).
  - It has no grip and no remove button, it is not draggable, and it is not a drop target.
  - If a tier line is dragged to the very top, Tier 1 is empty: the header sits directly above "Tier 2".
- **Row wrapper** (every item, tier lines and players alike): `draggable="true"`, radius 10.
  - Its `box-shadow` is `inset 0 2px 0 #0088FF` while it is the drop target, and none otherwise.
  - The line is **visible only over tier-line rows**. Player rows have an opaque background that covers it (see C7).
- **Tier line row.** `padding:12px 4px 4px`, row, `gap:8px`, `cursor:grab`.
  - **Grip icon**: 12 × 12, six dots of r 1.2 at (5.5 or 10.5, 4 / 8 / 12), filled t5 (#AEAEB2).
  - **Label** "Tier N" at 12/700 in the tier colour.
  - A `flex:1` 1px line in the **tier colour at opacity .35**.
  - **Remove** button: a 24 × 24 circle, `title="Merge tiers"`, with an X icon 10 × 10 at stroke 2.4 in t3.
  - Tier colours by N: 2 #8656D8, 3 #07A852, 4 #C98A1F, 5 #E03E3E, 6 #5E8C8C, 7 and above t3 (#6E6E73).
- **Player row.** Row, centred, `gap:9px`, `min-height:46px`, `padding:4px 8px 4px 4px`, `border-bottom:1px solid` b2 (#F2F2F4), `cursor:grab`, background b0. Left to right:
  1. **Rank number**: `width:22px`, 14/700, centred. Numbering runs 1…N continuously; tier lines are not counted.
  2. **FSHeadshot** at 26px.
  3. **Name column** (`flex:1; min-width:0`, `gap:2px`):
     - Short name at 14/600 with ellipsis.
     - Subline at 11/500, t3, nowrap, `gap:5px`, `overflow:hidden`. It starts with a **position chip**: height 16, `padding:0 5px`, radius 4, 9.5/700, label "D/ST" for DST. The sub text follows the chip. Chip colours (background / text):

       | Pos | Background | Text |
       |---|---|---|
       | QB | #F75252 | #fff |
       | RB | #5C7CE5 | #fff |
       | WR | #9D70E9 | #fff |
       | TE | #ECAD48 | #fff |
       | K | #D2E8E8 | #1D1D1F |
       | D/ST | #FFE75E | #1D1D1F |
  4. **Stats**: three columns, each `width:36px`, with `gap:2px` between columns.
     - Inside each column (`gap:1px`): the value at 12/600 in t1, then the label at 9/500 in t3, both nowrap.
     - Labels: **Pts**, **Avg**, **Pos rk**.
  5. **Movement delta**, only when non-zero: `width:24px`, right-aligned, 12/600.
     - "+N" in #07A852; "-N" in #FF0028.
     - When the delta is zero the element is absent and **no width is reserved**. The stat columns then sit 33px further right (24px + the 9px gap) than on rows that have a delta.
  - The row has no handles, no arrows, and no delete button. The code computes `up`, `down`, `upOp`, `downOp` and `remove` for each player row but never renders them.
  - **Tapping a player row does nothing**: there is no player card. The wrapper has only drag handlers.

**Footer** (fixed): row, centred, `gap:12px`, `padding:10px 16px 30px`, `border-top:1px solid` b3 (#EBEBEE), background b0.
- **Status column** (`flex:1; min-width:0`, `gap:1px`): a status label at 13/600 in a state colour, then a sub at 11/500 in t3.
- **Submit button**: height 44, `padding:0 20px`, radius 14, 14/600.
  - Enabled: white on **#07B85A**.
  - Disabled: t3 (#6E6E73) on b3 (#E5E5EA).

Footer content by state. Rows are evaluated top to bottom: the label rule checks Finalized, then Dirty, then Submitted; the button rule checks Finalized, then Submitted-and-clean.

| State | Status label (colour) | Sub | Button label | Button enabled? / tap result |
|---|---|---|---|---|
| Finalized, clean | "Finalized" (#07A852) | "{acc or 'Graded'} · can't be edited", e.g. "Top 18% accuracy · can't be edited" | "Finalized" | No; tap does nothing |
| Finalized, dirty | "Finalized" (`--x-to` #B25C00) | same as above | "Finalized" | No; tap shows the toast "Save your changes first" |
| Dirty (not finalized) | "Unsaved changes" (`--x-to` #B25C00) | "Save before you submit" | "Submit" | No; tap shows the toast "Save your changes first" |
| Submitted, clean | "Submitted" (#07A852) | "Edits are saved privately until you resubmit" | "Submitted" | No; inert |
| Saved, clean | "Saved {savedAt or 'just now'}" (t1), e.g. "Saved Oct 11", "Saved just now" | "Only you can see this until you submit" | "Submit" | **Yes**, if the ranking has an id |
| Clean, never saved (C8) | "Saved just now" (t1) | "Only you can see this until you submit" | "Submit" | No (no id); tap does nothing, no toast |

Submit is enabled only when all three hold: `!dirty`, `status !== "submitted"`, and the ranking has an `id` (it has been saved at least once). There is no player-count check, so a ranking with **0 players** can be saved and submitted.

#### 2.4 Add players sheet (D)

**Sheet shell** (shared by every sheet):
- **Backdrop**: absolute, `inset:0`, `z-index:30`, rgba(0,0,0,.4).
- **Panel**: absolute at the bottom, full width, `z-index:31`, `max-height:86%`, column, radius `22px 22px 0 0`, background b0.
- **Grab handle**: wrapper `padding:8px 0 2px`; the handle is 36 × 5, radius 999, b4 (#D1D1D6). It is visual only.
- **Header row**: `padding:8px 16px 10px`, `gap:8px`.
  - Title at 17/600 and sub at 12/500 in t3, stacked with `gap:2px`.
  - A right-aligned action pill: height 32, `padding:0 14px`, radius 999, 13/600, white on #0088FF.
- No open or close animation.

**Content:**
- **Header.** Title "Add players". Sub "{n} in your ranking", e.g. "15 in your ranking". Action pill "Done".
- **Search + chips wrapper**: `flex:none`, `padding:0 16px 8px`, column, `gap:8px`.
  - **Search field**: height 40, `gap:8px`, `padding:0 12px`, radius 12, background b2 (#F2F2F4).
    - Search icon 15 × 15 in t4 (#8E8E93), stroke 1.8: a circle (7, 7, r 4.8) plus `M10.6 10.6L14 14`.
    - Input: placeholder "Search players", 15/500, t1.
  - **Position chips** (`gap:6px`, `overflow-x:auto`): height 30, `padding:0 12px`, radius 999, 12/600.
    - Selected: white on ink. Unselected: t1 on b2.
    - For a ranking, the chips are "All" plus the ranking's own position (e.g. "All", "RB").
    - **The list is always limited to the ranking's position**, so "All" and "RB" return the same rows.
    - The Add players tool opens with the ranking's position selected; the empty-state button opens with "All" selected.
- **Rows.** Scroller `padding:0 16px 30px`. Each row: `gap:10px`, `padding:8px 0`, `border-bottom:1px solid` b2, cursor pointer.
  - FSHeadshot at **34px**.
  - Name column (`flex:1; min-width:0`, `gap:1px`):
    - The **full name** (e.g. "Ja'Marr Chase") at 14/600 with ellipsis.
    - Subline at 11/600 in the position text colour: QB #E03E3E, RB #4A68D4, WR #8656D8, TE #C98A1F, K #5E8C8C, D/ST #A68A00. It reads "{POS} " followed by a 500-weight t3 span "{TEAM} · Scout AI #{n}".
  - **Right**: a 28 × 28 circle with a white 12 × 12 icon at stroke 2.6.
    - Player already in the ranking: #0088FF with a check (`M3 8.5l3.2 3L13 4.5`).
    - Not in the ranking: ink (#1D1D1F) with a plus (`M8 3.5v9M3.5 8h9`).
- **Bye weeks are not filtered.** A Week 6 WR ranking starts with 12 players (byes removed), but its sheet lists all 15 WRs.
- **No empty-results state.** A search with no matches shows a blank list.
- **In the seed every row is checked**, because each seed ranking already contains its whole position pool (RB 15 of 15, WR 15 of 15, QB 10 of 10).

#### 2.5 Submit sheet (E)

- **Header.** Title "Submit your ranking". Sub is the ranking title (e.g. "Week 5 · RB · PPR"; blank if the title is empty).
  - The header pill reads **"Submit"**. It is the only submit control in the sheet.
  - There is no Cancel or Done. The sheet closes without submitting only through a backdrop tap.
- **Body**: `padding:0 16px 34px`, column, `gap:12px`.
- **Three explanation points.** Each is a row, `gap:12px`, `align-items:flex-start`.
  - Icon disc: 30 × 30, background `--x-gb` (#E6F2FF), icon colour #0088FF, icon 14 × 14 at stroke 1.8.
  - Text column (`flex:1`, `gap:2px`): title at 14/600, then sub at 12/500, line-height 1.4, t3.
  - The points:
    1. **Star** icon (`M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z`). Title **"Published to Community"**. Sub "Posted as @dalton. Others can view, save and compare against it."
    2. **Bars** icon (`M2.5 13.5h11M4 11V7M8 11V3.5M12 11V5.5`). Title **"Counts toward the Users average"**. Sub "Your ranks are averaged with 2,418 other submissions."
    3. **Clock** icon (`M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 5v3.3l2.2 1.4`). Title **"Accuracy is graded {grade}"**. Sub "You can keep editing. Changes stay private until you resubmit."
       - `{grade}` is "after Monday night's game" (weekly), "every week through Week 17" (rest of season) or "after Week 4" (pre-draft).
- **Toggle row**: `gap:10px`, `padding:12px`, radius 12, background b1 (#F5F5F7), cursor pointer.
  - Label "Show on my profile" at 14/600.
  - **Switch**: 44 × 26, radius 999, `padding:2px`.
    - Track is **#07B85A** when on and b3 (#E5E5EA) when off, with `transition: background .2s linear`.
    - Knob: 22 × 22, background b0, shadow `0 1px 2px rgba(0,0,0,.2)`.
    - The knob moves by switching `justify-content` between flex-end and flex-start, so its movement is **not** animated.
  - **Default is on.**

#### 2.6 Ranking submitted (F)

- **Container.** `flex:1`, column, centred on both axes, `gap:14px`, `padding:24px 28px`, `text-align:center`.
  - It is not a scroller and gets no dock spacer. The tab bar overlays its bottom 84px, and the content is centred over the full height.
- **Check badge.** A 72 × 72 circle in **#07B85A** with a white check: 32 × 32, stroke 2.4, path `M3 8.5l3.2 3L13 4.5`.
- **Heading.** "Ranking submitted" at 24/700, letter-spacing -0.02em.
- **Body.** 14/500, line-height 1.45, t3: "{title} is live in Community and now counts toward the Users average."
  - With an empty title it starts with a space: " is live in Community and now counts toward the Users average."
- **Facts grid.** Two columns, `gap:8px`, `margin-top:6px`, full width.
  - Each tile: `padding:12px`, radius 14, background b1, left-aligned, `gap:2px`. Value at 17/700, label at 11/500 in t3.
  - Tile 1: "#2,419" / "Submission".
  - Tile 2: "Tuesday" (weekly), "Weekly" (rest of season) or "Week 4" (pre-draft) / "Accuracy graded".
- **Buttons.** Column, `gap:8px`, `margin-top:10px`, full width. Each is 48 tall, radius 14, 15/600.
  - **"View in Community"**: white on #0088FF.
  - **"Back to my rankings"**: background b2 (#F2F2F4). It sets no text colour, so it inherits t1.
- The tab bar is shown, with Profile styled active. There is no back arrow.

#### 2.7 Toast

- **Position.** Absolute, `left:16px`, `right:16px`, `bottom:100px`, `z-index:40` (above sheets).
- **Style.** `padding:12px 14px`, radius 14, background ink (#1D1D1F), white 13/600, centred text. It is full-width minus the gutters, not a pill.
- **Timing.** No animation. It dismisses after 2200ms, and a new toast resets the timer.

---

### 3. Interactions

**My rankings**
- **Back chevron.** Navigates to `FieldScout Mobile.dc.html` with no hash. The handler is named `goProfile`; see §4 for where it actually lands.
- **Create (+).**
  - In My rankings: opens New ranking step 1 with the defaults Week 5 · PPR · RB · Scout AI. Week 5 · RB · PPR already exists in the seed, so the existing-ranking notice and "Open my ranking" appear immediately.
  - From any other hub tab, including a community author's tab: presets step 1 from the hub's current type, scoring and position.
- **Filter chip.** Sets `myRankF`. It is single-select; tapping the active chip does nothing.
  - The filter is not stored across reloads. It **does persist for the session**, through round trips to the editor and the confirmation.
  - Example: with "Unsubmitted" active, a ranking you have just submitted is not visible after "Back to my rankings".
  - Scroll position resets each time, because the scroller is unmounted and remounted.
- **Ranking card** (the whole card). Opens the editor. Its order at that moment becomes the "start order" that movement deltas are measured against.
- **Open empty-period card** (the whole card; the Start pill is not a separate target). Opens New ranking step 1 with the type set to that period, and with **scoring always PPR and position always RB**.
  - The scoring comes from `mgScoring`, a PPR/Standard control that is never rendered, so it is always PPR.
- **Locked empty card.** No action.
- **Tab bar.**
  - Home, Community and Leagues navigate to `FieldScout Mobile.dc.html` with no hash.
  - **Profile** calls `go("rk")`. That keeps the current `rk` state unchanged and closes any menu or sheet. Profile therefore opens whatever source was active before the flow: My rankings when the session came from `#mine`, but the **Experts hub** if the session began at `#new-ranking` or on a hub tab.

**New ranking**
- **Type card.**
  - Weekly keeps the current week if a week is already selected, otherwise sets **Week 5**. It does not remember the last week picked: Week 7 → Rest of season → Weekly gives Week 5.
  - Rest of season sets `ros`; Pre-draft sets `pre`.
  - The Week chip row appears or disappears instantly.
- **Week, scoring and position chips.** Single-select.
- **Existing-ranking check.** Runs on every change; type, scoring and position must all match. It updates the notice and the button label live.
- **Step 1 button.**
  - If a matching ranking exists, opens it in the editor (clean, deltas starting at 0).
  - Otherwise moves to step 2. The progress bar animates 33% → 66% (200ms, linear).
- **Step 2 source card.** Single-select; the default is Scout AI.
- **"Start ranking".** Creates an unsaved ranking in the editor: `id:null`, status "new", **dirty**, title "{summary}".
  - Items come from the chosen source's order, top 20 (fewer when the bye-filtered pool is smaller), with **auto tier lines** inserted.
  - "Start blank" gives an empty list.
  - The start order equals the source order.
- **Header X (step 1).** Goes to the rk screen with whatever source was active; see §4.
- **Chevron (step 2).** Returns to step 1 with the selections kept. The progress bar animates back from 66% to 33%.
- There is no swipe-back gesture.

**Ranking editor**
- **Title input.** Every keystroke updates the title and marks the ranking dirty. There is no validation, so an empty title is allowed.
  - With an empty title, the card title, the Submit sheet sub and the start of the confirmation line are all blank.
- **Save.** Does nothing when clean. When dirty:
  - Writes the record `{id, type, scoring, pos, from, title, items, status:"saved", savedAt:"Just now", acc:""}`. The record has **no `fromBy`**, so a copied community author is lost.
  - Moves the record to the **front** of My rankings.
  - Makes the editor clean with status "saved". The editor's own `savedAt` is not updated, so an existing ranking's footer keeps its old date (e.g. "Saved Oct 13").
  - Shows the toast "Ranking saved".
  - Saving a *submitted* or *finalized* ranking turns it into **Saved** and clears its accuracy text.
  - **Movement deltas survive Save.** The start order is kept, so a just-saved ranking still shows +1, -3 and so on. Deltas reset only when the ranking is reopened from My rankings.
- **Add players.** Opens the pick sheet with the position filter set to the ranking's own position.
- **Auto tiers.**
  1. Removes every tier line.
  2. Re-scores the players with Scout AI for this ranking's type, scoring and position, **keeping the user's current order**.
  3. Inserts a break before player i+1 when the score gap to the previous player exceeds **1.55 × the mean gap**. A break needs at least 2 players since the previous break, and there can be **at most 7 breaks** (so at most 8 tiers). Tier 1 therefore always has at least 2 players.
  4. Marks the ranking dirty and shows the toast "Auto tiers applied. Drag a tier line to adjust."
  - There is no confirmation, even though manual tiers are lost.
  - **After reordering, gaps go negative** and breaks land in nearly every allowed slot. Example: reversing the seed Week 5 RB ranking and tapping Auto tiers gives **7 tiers (2/3/2/2/3/2/1)**. On the seed order it gives 4/7/3/1.
  - **On an empty ranking** it still shows the toast and marks the ranking dirty, but changes nothing.
- **Add tier line.** Appends a tier line at the **end** of the list, below the last player, and marks the ranking dirty. The user then drags it into place.
  - Empty tiers are possible: two lines in a row, a line dragged to the very top (empty Tier 1), or a trailing line.
- **Tier-line X ("Merge tiers").** Removes that line immediately, with no toast or confirmation. Later tiers renumber and recolour.
- **Drag.** HTML5 drag-and-drop on the wrapper of every row, players and tier lines alike.
  - `dragstart` records the source index.
  - `dragover` sets `dragOver`, which applies the blue top line. The line is visible only over tier-line rows (see C7).
  - `drop` removes the item at the source index, inserts it at the target index, and marks the ranking dirty.
  - `dragend` clears the indicator.
  - **Moving up**, the item lands above the target row.
  - **Moving down**, it lands *below* the target row, one slot past where the indicator would be. Example: dragging #1 J. Gibbs onto #4 C. McCaffrey gives "1. B. Robinson +1, 2. S. Barkley +1, 3. C. McCaffrey +1, 4. J. Gibbs -3", followed by the Tier 2 line.
  - Rank numbers and deltas recompute instantly. There is no drag-ghost styling and no animation.
- **Delta.** Delta = start position − current position, so "+4" in green means the player moved up four places.
  - A player added after the editor opened, who was not in the ranking at open, has no start position and shows no delta.
  - A player who **was** in the ranking at open, then removed and re-added through the sheet, keeps their start position and **does** show a delta. Example: removing Gibbs from the seed RB ranking and re-adding him puts him at #15 with "-14", and everyone else shows "+1".
- **Footer Submit.** Opens the Submit sheet when enabled. When dirty, including a dirty Finalized ranking, it shows the toast "Save your changes first". Otherwise it does nothing.
- **Back chevron.** Goes to the rk screen with `src:"mine"`. **Unsaved edits are discarded silently**, and a new ranking that was never saved disappears.
- **Player row tap.** Does nothing.

**Add players sheet**
- **Search.** Updates on every keystroke. It matches a case-insensitive substring of the full name, **or** an exact match on the team abbreviation.
  - Results are always limited to the ranking's position. In the seed Week 5 RB ranking, "det" returns only Jahmyr Gibbs; in the Rest of season WR ranking, "det" returns Amon-Ra St. Brown and Jameson Williams.
  - The query is **not trimmed**. "det " (with a trailing space) matches nothing.
- **Position chips.** Filter the list; "All" equals the ranking's own position (see §2.4).
- **Sort order.** Rows are sorted by **Scout AI overall rank** across all positions, for Week 5 and PPR, regardless of the ranking's week.
- **Row tap.** Toggles the player, and either way the ranking becomes dirty. The sheet stays open and the subtitle count updates.
  - Adding appends the player to the **end** of the list, after any trailing tier line.
  - Removing deletes the player. **This sheet is the only way to remove a player from a ranking.**
  - **Bye players are not blocked.** A bye player added to a weekly ranking gets a made-up opponent. Example: Justin Jefferson (bye 6) added to Week 6 WR appears at #13 as "MIN @ BUF", with no delta.
- **Done**, or a tap on the backdrop, closes the sheet.

**Submit sheet**
- **Toggle.** Flips "Show on my profile". The state is global (`submitProf`), not stored on the ranking, and has no effect anywhere in the prototype.
- **Submit** (header pill):
  - Sets the record's status to submitted, `savedAt` to "Just now", and `acc` to "Graded {grade}" (e.g. "Graded after Monday night's game").
  - Moves the record to the front of the list.
  - Closes the sheet and goes to the confirmation (`done = {title, type}`).
  - `rk` is unchanged.
- **Backdrop tap.** Closes the sheet without submitting.

**Confirmation**
- **"View in Community".** Navigates to `FieldScout Mobile.dc.html` with no hash.
- **"Back to my rankings".** Goes to the rk screen with `src:"mine"`. The `myOnly` flag is kept from earlier in the session, so the title is "My rankings" only if the session began at `#mine`.
- **Profile tab.** Returns to the source that was active before the flow (see the tab bar under My rankings).

**Animations, complete list.** Two properties animate: progress-bar width (.2s linear, both directions) and switch background (.2s linear). Nothing else animates: no sheet slide, no toast fade, no screen transition, no drag reflow.

---

### 4. Navigation

**Entry points into this area**

| From | Action | Destination |
|---|---|---|
| Main app, Profile › My stuff › Rankings preview rows (main L1814) | Tap any row | `Lists and Rankings#mine`, i.e. My rankings, not the specific ranking. The rows are **hard-coded** and never reflect the user's changes. Seed rows: "Week 5 · RB · PPR" / "Submitted · graded after Monday night" (#07A852); "Rest of season · WR · PPR" / "Saved, not submitted" (`--x-tb`); "Week 4 · QB · PPR" / "Finalized · top 18%" (`--x-t4`) |
| Main app, Profile, contextual "New ranking" button (main L1816) | Tap | `#new-ranking` |
| Main app, Community Create (+) sheet, "Ranking" ("Rank players for a week, rest of season or the draft", #0088FF) (main L1818) | Tap | `#new-ranking` |
| Main app, Community ranking cards (main L1537) | Tap | `#view-<id>`, the community view of that ranking |
| Main app, global search ranking results (main L1478) | Tap | `#view-<id>` |
| Main app, "Updated by people you follow" (main L1549) | Tap | `#view-<id>` |
| Main app, notification #2 "@shahranks updated Week 5 · RB · PPR" (main L1853) | Tap | `#view-r1` |
| Main app, Home "My stuff" tiles | Tap | Profile on that tab (per the README), then as above |
| This file, root Create (+) | Tap | New ranking step 1 |
| This file, open empty-period card | Tap | New ranking step 1 with that period preset |
| This file, community view "Start my ranking from this" | Tap | Editor with `from:"comm"`. The existing-ranking rule is skipped, so a duplicate is possible (e.g. two "Rest of season · WR · PPR" cards). The community view (reached only via `#view-<id>`) is the only way to reach this button. |
| Hash `#mine` | On load | A (`src:"mine"`, `myOnly:true`) |
| Hash `#new-ranking` | On load | B1 with Week 5 · PPR · RB · Scout AI; `rk.src` stays `"ecr"` |
| Hash `#view-<id>` (r1–r6) | On load | Hub, community author tab (`src:"c:<id>"`) |
| Hash `#rankings` (listed in the README) | On load | **No handler.** It falls through to the default hub on the Experts tab. |

The hash is read only once, on mount. There is no `hashchange` listener, and in-app navigation never updates the URL.

**There is no persistence.** `myRanks` is re-seeded on every mount, so every save or submit is lost on reload, and whenever the user goes to the main app and back. That includes "View in Community", the tab bar, the back chevron and the main app's links.

**Exits and back**

| Screen | Control | Goes to |
|---|---|---|
| My rankings | Back chevron | `FieldScout Mobile.dc.html` (no hash) |
| New ranking, step 1 | X | rk screen with the current source. From `#mine` that is My rankings. From `#new-ranking` it is the **Rankings hub, Experts tab**. From a hub tab it is that tab. |
| New ranking, step 2 | Chevron | Step 1 |
| Editor | Chevron | rk screen with source Mine. Title "My rankings" only if the session began at `#mine`; otherwise "Rankings" with the Mine tab selected |
| Add players sheet | Done, or backdrop | Closes the sheet |
| Submit sheet | Backdrop only (the pill submits) | Closes the sheet |
| Confirmation | View in Community | `FieldScout Mobile.dc.html` (no hash) |
| Confirmation | Back to my rankings | rk screen, source Mine (same `myOnly` rule as the editor) |
| Confirmation | Profile tab | rk screen with the **pre-flow** source unchanged (Experts hub if the session began at `#new-ranking`) |

**Important:** the main app ignores `location.hash`; its `componentDidMount` only starts the live-play timer and reads the theme. It always starts at `scr:"league"`, `tab:"match"`, so every cross-file exit above lands on **League › Match**, not on Profile, Community or Home.

**No in-phone route out of My rankings to other surfaces.** `rootSeg`, a Rankings/Lists segmented control, is computed but never rendered.
- So there is no route from My rankings to Lists.
- Under `#mine` (no source tabs) there is no route to the Experts / Scout AI / Users hub either.

**Dock and tab bar by screen**
- **My rankings:** bar shown, Profile active, 84px spacer in the scroller.
- **New ranking:** no bar.
- **Editor:** no bar; sheets cover the footer.
- **Confirmation:** bar shown, Profile active.
- No screen in this area shows the league switcher.

**This file's tab bar differs from the main app's:**

| | This file | Main app (outside a league) |
|---|---|---|
| Items | Home / Community / **Leagues** / Profile | Home / Community / **Players** / Profile |
| Height | 84px | 80px |
| Padding | `8px 8px 26px` | `6px 8px 0` |
| Avatar | 24px, ring always shown | 22px, ringed only when active |
| Inactive colour | t3 (#6E6E73) | #A1A1A6 |
| Home indicator | None | 134 × 5 |

The README describes the main app's version.

---

### 5. Data shown

**Ranking record** (`myRanks[]`):

| Field | Values |
|---|---|
| `id` | — |
| `type` | `"w1"`…`"w18"`, `"ros"`, `"pre"` |
| `scoring` | `"ppr"`, `"std"` |
| `pos` | `"QB"`, `"RB"`, `"WR"`, `"TE"`, `"K"`, `"DST"` |
| `from` | `"ai"`, `"ecr"`, `"users"`, `"blank"`, `"comm"` |
| `status` | `"saved"`, `"submitted"`; `"draft"` is styled but never produced |
| `savedAt`, `acc`, `title` | strings |
| `items[]` | ordered mix of `{t:"p", n:<player name>}` and `{t:"tier"}` |

The editor-only `fromBy` (a community author handle) is **not** saved to the record.

**Tiers are stored as divider markers between players**, not as a tier field on each player.

**Display status.**
- `submitted` on a week before the current week (Week 5) displays as **Finalized**.
- Any other `submitted` displays as Submitted.
- `saved` displays as Saved.
- Anything else displays as Draft.

**Filter rules.**
- **Unsubmitted** = any status that is neither Submitted nor Finalized.
- Card order inside a filter or period follows the array order, which is most recently saved or submitted first.

**Periods** (All filter).
- **Order:** Rest of season, Pre-draft, then Week 1 through Week 18.
- **Open:** Rest of season, and the current week (5) through the current week + 3 (8).
- **Hidden:** past weeks with no ranking, and Pre-draft with no ranking.
- **Locked:** Week 9 and later, at opacity .5. A locked week opens at week − 3.
- An empty card appears only when the period has **zero** rankings of any position or scoring.

**Title.** "{Week N | Rest of season | Pre-draft} · {QB|RB|WR|TE|K|D/ST} · {PPR|Standard}". The user can edit it, and it can be empty.

**Card meta.** "{players} players · {tiers} tiers · started from {Scout AI|Experts|Users|blank|another user} · {savedAt}".
- `tiers` = number of tier lines, plus 1 if there are any players. Every line is counted, including empty tiers.
  - A ranking with 0 players and 2 tier lines reads "0 players · 2 tiers".
  - A line dragged to the top still counts, so the seed RB ranking reads "4 tiers".
- There is no singular form, so "1 tiers" and "1 players" are possible.
- A community copy **always** reads "started from another user" on its card.
- Dates appear as "Oct 13" or "Just now".

**Accuracy line.** One of: "Top 18% accuracy" (green), "Graded after Monday night" (seed), "Graded after Monday night's game", "Graded every week through Week 17", "Graded after Week 4", or empty.

**Short name.** First character + ". " + every word after the first. D/ST names stay whole ("Broncos D/ST").
- "Amon-Ra St. Brown" → "A. St. Brown".
- It produces collisions and odd forms: "A.J. Brown" → "A. Brown" (listed next to "A. St. Brown"), "DK Metcalf" → "D. Metcalf", "De'Von Achane" → "D. Achane".
  - **The app keeps a first name that is already initials:** "A.J. Brown", "DK Metcalf", "CJ Stroud" (gap list §4 item 17; `shortPlayerName` in `src/utils/format-name.ts`).
- The pick sheet uses full names.

**Editor row data.**
- **Rank:** 1…N.
- **Sub text:**
  - Weekly rankings: "{TEAM} vs {OPP}" or "{TEAM} @ {OPP}" (e.g. "DET vs NYG"). The opponent comes from a seeded random pick that **ignores bye weeks**, so a bye player shows a made-up opponent.
  - Rest of season and pre-draft: "{TEAM} · Bye {n}" (e.g. "CIN · Bye 10").
- **Stats** are **season** values whatever the ranking type:
  - Pts: season total to 1 decimal ("86.4").
  - Avg: to 1 decimal ("21.6").
  - Pos rk: position + rank by season points ("RB1", "D/ST1").
- **Delta:** "+4" or "-1".

**Source rankings.** Each source is a seeded score per player, sorted descending.
- For weekly types, players on bye that week are excluded:
  - Week 6 WR drops Jefferson, Metcalf and Mooney, leaving 12.
  - Week 6 RB drops Bijan Robinson and Tyler Allgeier, leaving 13.
  - Week 6 K has 2 (Aubrey, Dicker) and Week 6 D/ST has 1 (Broncos).
- At most 20 players are taken. Full pools are QB 10, RB 15, WR 15, TE 8, K 3 and D/ST 3.
- Auto tiers on start use the break rule in §3.
- Tier layouts:
  - Seed Week 5 RB: **4/7/3/1**.
  - Seed Week 4 QB: **9/1**.
  - Seed Rest of season WR: **3/8/4**.
  - A new Week 6 WR from Scout AI: 12 players, **10/2** (Tier 2: A. Mitchell, J. Dotson).
  - A copy of @ortizff's Rest of season WR: **7/8**.

**Top-3 previews** (as rendered, single-spaced):

| Ranking | Source | Preview |
|---|---|---|
| Week 5 · RB · PPR | Scout AI | "1. J. Gibbs 2. B. Robinson 3. S. Barkley" |
| Week 5 · RB · PPR | Expert consensus | "1. S. Barkley 2. B. Robinson 3. J. Gibbs" |
| Week 5 · RB · PPR | Users | "1. J. Gibbs 2. B. Robinson 3. S. Barkley" |
| Week 6 · WR · PPR | All three | "1. J. Chase 2. P. Nacua 3. C. Lamb" |

**Pick sheet rank.** "Scout AI #N" is the overall rank across all positions for Week 5 and PPR, with positional weighting (QB .72, RB 1, WR 1, TE .9, K .55, D/ST .55). It is not the ranking's own position or week.

**Computed in code but never rendered.** A builder will find these; they read like an earlier design. Do not render them without a ruling.
- `rootSeg`: a Rankings/Lists segmented control (L415).
- `mgNote`: "Weeks 5–8 are open for rankings" (L470).
- `mgScoring`: a PPR/Standard segment (L471). It feeds the Start card's scoring, which is therefore always PPR.
- Per-period fields (L581–585):
  - `sub`: "This week" / "Open" / "Finalized" / "Opens Week N" / "Open all season" / "Opens for 2027 drafts".
  - `subC`: #0088FF for the current week, #07A852 for open, t3 otherwise.
  - `fg`: #0088FF open, t5 otherwise.
  - `ring`: open `inset 0 0 0 1.5px` b4 (#D1D1D6).
  - `bg`: open b0, otherwise b1.
- `out.newRank` (L464).
- Player-row `up`, `down`, `upOp`, `downOp` and `remove` (L514).

**Placeholder vs real.** All of the following are placeholder:
- Player stats and points.
- Opponents (seeded random).
- Source orders, and update times ("6:00 AM").
- "Average of 5 experts", "2,418" (users count), "#2,419" (submission number), "Top 18%".
- The "@dalton" handle and "D" avatar.
- Current week = 5, and the seed dates.
- The hard-coded Profile rankings rows in the main app.

These need real product data:
- Player pool with team and bye week.
- Schedule and opponents.
- Season Pts / Avg / Pos rk.
- The three source rankings with their timestamps.
- The count of user submissions and the user's submission number.
- Accuracy grading and its timing.
- The user's handle and avatar.
- Current week and the editable window.
- The saved ranking records, which must persist (the prototype has no persistence).

**Headshots** (`FSHeadshot.dc.html`, present only in `design_handoff_fieldscout_mobile/`).
- **Assets.** Only 14 players in this area have photo assets: Robinson, A.J. Brown, Kamara, Conner, Sanders, Jameson Williams, Pacheco, Engram, Mooney, Braelon Allen, Kmet, Mitchell, Wright, Dotson. Everyone else falls back to initials.
- **Root.** A circle at the given size, `overflow:hidden`, background #EEEEF1, `title` = the full name (tooltip).
- **Photo.** `position:absolute; inset:0; object-fit:cover; object-position:50% 15%; transform:scale(1.25) translateY(8%)`. `onError` falls back to initials.
- **Initials.** #6E6E73, weight 700, font size `max(9, round(size × .36))`: 9px at 26px, 12px at 34px.
  - " D/ST" is stripped first, then the name is split on spaces, apostrophes and hyphens. The initials are the first letter of the first part and of the last part.
  - "Ja'Marr Chase" → "JC"; "Broncos D/ST" → "B".
- **Ring.** `0 0 0 1px #fff, 0 0 0 {1+rw}px {team colour}`, where rw is 1.5 below 32px and 2 at 32px or above. An unknown team gets `inset 0 0 0 1px rgba(0,0,0,.04)` instead; every team in this area is known.

---

### 6. Dark mode

Dark mode is triggered by class `.fs-dark` on the phone. The setting is stored in `localStorage["fieldscout-theme"]`. It sets these variables:

| Variable | Dark value |
|---|---|
| t1 | #FFFFFF |
| t2 | #D9D9D9 |
| t3 | #B3B3B3 |
| t4 | #A7A7A7 |
| t5 | #727272 |
| b0 | #121212 |
| b1 | #282828 |
| b2 | #333333 |
| b3 | #3E3E3E |
| b4 | #575757 |
| ink | #4D4D4D |
| barA | rgba(18,18,18,.92) |
| tg / gg | #1ED760 / #12301F |
| tb / gb | #6FB5FF / #12263F |
| to / go | #FFB340 / #3A2A14 |

Inputs also get `color-scheme:dark`.

Resolved values for this area:
- **Status pills:**
  - Finalized becomes **#121212 text on a #FFFFFF pill** (inverted).
  - Submitted: #1ED760 on #12301F.
  - Saved: #6FB5FF on #12263F.
  - Draft: #D9D9D9 on #333333.
- **Chips:** selected is white on #4D4D4D; unselected is #FFFFFF on #333333. Filter count spans are that colour at opacity .6.
- **Card outlines and dividers:** #3E3E3E. Row bottom borders: #333333.
- **Card headshot separator:** the wrapper's b0 ring would be #121212, but it is never visible. The visible separator stays **1px #fff + 1.5px team colour**, because FSHeadshot's ring is not themed.
- **New ranking:**
  - Radio cards: background #282828. The unselected radio ring is #575757; the selected ring and dot stay #0088FF.
  - Progress track: #333333.
  - Header bottom border: #3E3E3E. Footer top border: #333333.
  - Existing-ranking notice: #FFB340 on #3A2A14.
- **"Recommended" badge and Submit-sheet icon discs:** #0088FF on #12263F.
- **Editor:**
  - Save pill when clean: #B3B3B3 on #333333.
  - Submit when disabled: #B3B3B3 on #3E3E3E.
  - "Unsaved changes", and a dirty "Finalized": #FFB340.
  - Footer and header background: #121212.
  - Tier 1 line: #3E3E3E. Tier grip: #727272. Player-row background: #121212.
- **Pick sheet:** the "add" circle is #4D4D4D; the search field is #333333; the search icon is #A7A7A7.
- **Sheet surface:** #121212. Grab handle: #575757.
- **"Show on my profile" switch:** the off track is #3E3E3E, and the on track stays #07B85A. The knob is b0, so it becomes **#121212: a dark knob on the green track**.
- **Toast:** #4D4D4D with white text.
- **Tab bar:** rgba(18,18,18,.92). Inactive items: #B3B3B3. Avatar ring: `0 0 0 2px #4D4D4D, 0 0 0 3.5px #121212`.
- **Confirmation:** fact tiles #282828; secondary button #333333 with white (inherited t1) text.

**Not themed** (identical in both modes):
- #0088FF and #07B85A.
- **#07A852**: deltas, "Top …" accuracy, and the "Submitted"/"Finalized" footer label.
- #FF0028, the tier colours, position-chip colours and position text colours.
- The headshot initials fallback (#EEEEF1 / #6E6E73) and the headshot's #fff gap and team-colour ring.
- The sheet backdrop rgba(0,0,0,.4), and the input placeholder #6E6E73.

The README gives #1ED760 as the dark success-text colour, but this file does not use it for those greens.

---

### Prototype behaviour that needs a ruling, not a copy
1. Every exit to the main app lands on League › Match, because the main app ignores the hash.
2. The tab bar here differs from the main app and the README in its items, height and avatar treatment.
3. "Finalized … can't be edited" is not enforced. A finalized ranking can be edited and saved, which turns it into Saved and re-enables Submit. While it is dirty, the button still reads "Finalized" but tapping it shows "Save your changes first".
4. Re-saving a submitted ranking silently makes it Saved and clears its accuracy text.
5. Dragging downward lands one slot below the target row.
6. The drop-indicator line is invisible over player rows; it only shows over tier lines.
7. The delta column takes no width when the delta is zero, so the stat columns misalign between rows.
8. Deltas survive Save. A player removed and re-added keeps their old start position and shows a delta.
9. After saving an existing ranking, the footer shows its old date ("Saved Oct 13"). A new ranking shows "Saved just now", while the card shows "Just now".
10. A clean, never-saved ranking (jump "Blank ranking") reads "Saved just now" with Submit dead.
11. Rankings with zero players can be saved and submitted. Empty tiers (and tier lines with no players) are counted in "N tiers".
12. Auto tiers on a reordered list over-splits (up to 8 tiers), wipes manual lines, and fires a toast even on an empty ranking.
13. "Start my ranking from this" creates a duplicate of a ranking you already have. The author handle is lost on save ("started from another user").
14. Leaving the editor discards changes with no prompt.
15. Drag uses HTML5 drag-and-drop, which does not fire on touch screens.
16. The Add players sheet's "All" chip equals the ranking's position, search is not trimmed, and bye players can be added to weekly rankings (with a made-up opponent).
17. No persistence: every save or submit is lost on reload or on any trip to the main app.
18. The filter persists for the session, so a just-submitted ranking can be hidden under "Unsubmitted".
19. Pre-draft copy contradicts itself: "Opens for 2027 drafts" vs "graded after Week 4" and a "Week 4" tile.
20. An empty title is allowed and leaves blanks in the card, the sheet and the confirmation line.
21. The step counter says "of 3" but the flow has two steps.
22. Short names collide ("A. Brown" next to "A. St. Brown").
23. There is no delete, archive or unsubmit, and tapping a player row does nothing.
24. The handoff folder is missing `FSHeadshot.dc.html` (headshots render blank) and `FieldScout Mobile.dc.html` (cross-file links break).

---

### Open questions
- Every critic finding was checked against the source and confirmed; none was dropped. Two small corrections: the critic cited the runtime's 'empty placeholder' message at support.js L1426, but it is at L1434 (COMPONENT_DIR is at L1402, as cited). The critic's headshot-ring point was marked PLAUSIBLE; rendering it in headless Chrome confirmed it. One finding is mine, not the critic's: the blue drop line never shows over player rows, because the row's white background covers the wrapper's inset shadow (confirmed by rendering). It only shows over tier lines.
- The handoff folder is missing FSHeadshot.dc.html and FieldScout Mobile.dc.html. Both exist only in design_handoff_fieldscout_mobile/. Can the handoff be re-exported with them, or should engineers treat that folder as canonical?
- Where should cross-file exits go? The main app ignores location.hash and opens on League > Match. The exits are: (a) the My rankings back chevron (its handler is named goProfile; Profile > My stuff > Rankings?); (b) 'View in Community' on the confirmation (the Community Rankings tab, or the ranking just submitted?); (c) tab bar Home, Community and Leagues.
- Which tab bar is canonical? This file has Home/Community/LEAGUES/Profile: 84px, padding 8px 8px 26px, 24px avatar always ringed, inactive t3 #6E6E73, no home indicator. The main app and README have Home/Community/PLAYERS/Profile: 80px, padding 6px 8px 0, 22px avatar ringed only when active, inactive #A1A1A6, 134x5 home indicator.
- Closing New ranking (X on step 1) returns to the last rankings source. Arriving from Profile 'New ranking' or the Community Create sheet (#new-ranking), the user lands on the Rankings hub's Experts tab, not where they came from. The Profile tab on the confirmation screen does the same. Is that intended, or should both return to My rankings or the originating screen?
- After the editor or the confirmation, 'back' shows the standalone 'My rankings' only if the session began at #mine. Otherwise it shows 'Rankings' with source tabs and Mine selected. Should these always return to the standalone My rankings?
- My rankings has no in-app route to Lists, and under #mine none to the Experts/Scout AI/Users hub either. A Rankings/Lists segmented control (rootSeg) is coded but not rendered. Should it be shown?
- Should leaving the editor with unsaved changes warn the user, or auto-save a Draft? The prototype silently discards edits, and a never-saved new ranking vanishes.
- Finalized rankings: the footer says 'can't be edited', but drag, Add players, tiers and the title all still work, and Save turns the ranking back into Saved with Submit enabled. While dirty, the button reads 'Finalized' but tapping it says 'Save your changes first'. Should finalized rankings be fully read-only (no drag, tools hidden, title locked, Save hidden)?
- Editing and re-saving a submitted ranking makes its card 'Saved' and clears its accuracy line, while the submit sheet promises 'Changes stay private until you resubmit'. Should there be a distinct state such as 'Submitted · unsaved changes', and what does Community show meanwhile?
- The 'Draft' status pill (t2 on b2) is styled but unreachable, because every save produces 'Saved'. What is a Draft: an auto-saved ranking the user never saved manually?
- Touch drag: the prototype uses HTML5 drag-and-drop (mouse only), and the whole row is draggable, which conflicts with vertical scrolling on a phone. Long-press to lift? Auto-scroll near the edges? Lifted-row styling (the elevation rule allows a shadow on drag ghosts)? Should the blue drop line show on every row, and should the dragged player land exactly where the line shows? Today a downward drag lands one slot lower.
- Movement deltas (+N/-N): they survive Save and reset only when the ranking is reopened. A player removed and re-added keeps their old start spot (e.g. Gibbs re-added shows -14). Should Save reset the baseline? What should a re-added player show?
- The movement delta column reserves no width when the delta is 0, so the Pts/Avg/Pos rk columns shift between rows. Always reserve the 24px slot?
- Save timestamp copy: after saving an existing ranking the footer keeps the old date ('Saved Oct 13'). New rankings show 'Saved just now' (lowercase), and cards show 'Just now'. What format is wanted ('Saved just now', 'Saved 2:14 PM' or 'Saved Oct 13')?
- Can a ranking with 0 players, or very few, be saved or submitted? The prototype has no minimum or maximum, and it counts empty tiers ('0 players · 2 tiers'). Should empty tiers be pruned on save, and should Auto tiers be disabled when there are no players? Should a new ranking still start from the top 20?
- Auto tiers keeps the user's current order and re-tiers using Scout AI scores. On a reordered list it splits into many tiny tiers (a reversed Week 5 RB list gives 7 tiers). It also wipes manual tier lines without asking. Intended? Should 'Add tier line' insert somewhere smarter than the very bottom?
- One ranking per type + scoring + position: step 1 redirects to the existing ranking, but 'Start my ranking from this' on a community ranking creates a duplicate (two 'Rest of season · WR · PPR' cards). Should it replace, open, or merge into the existing one? Should the saved ranking keep the author's handle? Today the card says 'started from another user'.
- My rankings 'All' view: a period's empty 'Start' card disappears once ANY ranking exists for that week, so a second position for the same week can only be started via +. Should each period offer 'Add another position'? 'Start' also always presets PPR + RB. Should it use the user's default scoring and last-used position?
- Several values are computed but never rendered in My rankings. They are: period sub-labels ('This week', 'Open', 'Opens Week N', 'Open all season', 'Finalized') with colours (#0088FF for the current week, #07A852 for open); empty-card ring and fill variants; the note 'Weeks 5–8 are open for rankings'; a PPR/Standard segmented control; and the Rankings/Lists control. Were period headers or these controls meant to be visible?
- Add players sheet: (a) For weekly rankings it lists bye-week players, which the source rankings exclude. Once added they show a made-up opponent (Jefferson in Week 6 shows 'MIN @ BUF'). Should bye players be hidden or marked 'BYE'? (b) 'Scout AI #N' is the overall Week 5 rank, not the ranking's week or position. Which rank should show? (c) There is no empty-search state. What copy? (d) The 'All' chip shows the same players as the position chip. Keep both chips, or drop them for single-position rankings? (e) Should the search ignore leading and trailing spaces?
- 'Show on my profile' (default ON) is not saved on the ranking and affects nothing. Where does it surface on Profile, and is it per ranking?
- The Submit sheet's only submit control is the small top-right blue pill labelled 'Submit', and the only way to back out is tapping the dimmed backdrop. There is no Cancel and no large bottom button, unlike the rest of the flow. Confirm? Should sheets get the README's ~200ms linear open/close animation? The prototype has none, and the grab handle doesn't drag.
- Accuracy-grading copy is inconsistent. Weekly: the sheet says 'after Monday night's game', the confirmation says 'Tuesday', and the seed card says 'Graded after Monday night'. Rest of season: 'every week through Week 17' vs 'Weekly', although the season has 18 weeks. Pre-draft: 'after Week 4' and a 'Week 4' tile, while My rankings calls pre-draft 'Opens for 2027 drafts'. Which strings are canonical?
- Copy fixes to approve: the existing-ranking notice says 'Continuing opens it…' but the button reads 'Open my ranking'. Plurals are unhandled ('1 tiers', '1 players'). The step counter reads '1 of 3' / '2 of 3' for a two-step flow.
- Short names collide or read oddly: 'A.J. Brown' → 'A. Brown' (next to 'A. St. Brown'), 'DK Metcalf' → 'D. Metcalf', 'De'Von Achane' → 'D. Achane'. Use real display names for these?
- Toast style: this file uses a full-width card (16px gutters, radius 14) at bottom 100px. The README says 'bottom-centered dark pill'. Which?
- Dark mode: the Finalized pill inverts to a white pill with #121212 text. Success greens (#07A852) stay the same in dark, although the README gives #1ED760 for dark success text. The headshot initials fallback (#EEEEF1) and its white gap ring are not themed. The 'Show on my profile' knob turns dark (#121212) on the green track. Confirm, or provide dark values.
- Removing a player is only possible by un-checking them in the Add players sheet; there is no swipe-to-delete or row menu (README: 'no handles, arrows or delete'). Tapping a player row does nothing. Your app rule is that every player click opens the mini card first, so should tapping a row in the editor open the player mini card? How should delete work?
- Rankings cannot be deleted, archived, unsubmitted or withdrawn anywhere. Which of these are needed for launch? Soft deletes apply per CLAUDE.md.
- Title editing has no placeholder or validation, so an empty title is allowed and leaves blanks on the card, the submit sheet and the confirmation line. Should the title fall back to the type · position · scoring label? Does a custom title show in Community?
- Pre-draft can be created in-season from New ranking. Yet My rankings hides Pre-draft unless one exists, and the hub hides it in season. Should Pre-draft be selectable in New ranking during the season?
- Week chips are hard-coded to Week 5–8. Engineers should derive them from the current week through the current week + 3. What happens in Weeks 16–18, when fewer than 4 remain?
- No Overall/FLEX ranking position is offered, although the code supports 'ALL' (Overall, 40 players). Confirm one position per ranking for launch.
- The My rankings filter persists for the session. After submitting with 'Unsubmitted' active, 'Back to my rankings' hides the ranking just submitted. Should returning from submit reset the filter to All, or scroll to the submitted card?
- URLs and routing: the prototype never updates the URL, and the README's '#rankings' hash has no handler. Proposed Next.js routes need sign-off: /rankings/mine, /rankings/new (step in state or ?step=2), /rankings/[id]/edit, /rankings/[id]/submitted, plus /rankings/view/[id] for community rankings. Each also needs defined browser and OS back behaviour.
- The tier-line remove hit target is 24x24, below the README's 30px minimum. Enlarge the hit area while keeping the visual size?

---

## Gap analysis vs the current app

## My rankings, New ranking flow, Ranking editor, Submit: gap analysis (mobile spec vs app at `redesign-v7` @ 27d455b)

### Headline
- **None of this area exists in the app as a feature.** Three nearby pieces exist, and all are flag-OFF at launch:
  - **Weekly ranks** (`/app/weekly-ranks`, flag `weeklyRanks`). One cross-position list per week. Its "Submit" is only a reorder save, with no submission record. "Reset to Scout AI" is a stub, and `weekly-ranks/history` is an honest empty state that says "Submission records don't exist yet".
  - **Big Board** (`/app/big-board`, flag `bigBoard`). One season-long list with snapshots. The draft room reads it.
  - **Consensus** (`/consensus`, flag `consensus`). A season-long, cred-weighted materialized view over all public lists.
- **The `weekly_rankings` table exists but no app code uses it.** Only `database.ts` mentions it.
  - Columns: user, season, week, position, rankings JSONB, accuracy_score, submitted_at; UNIQUE(user, season, week, position).
  - It has no scoring, type (ROS / pre-draft), status, title, source or author column.
  - Its RLS is `SELECT USING (true)`. That breaks the promise "Only you can see this until you submit".
- **Lists v2 has the editing building blocks:** title, position_filter, scoring_system_id, `rank_and_tier`, add/remove players, a duplicate RPC, and dnd-kit drag that works on touch. But its tiers are a per-player bucket key (S–F / r1–r30). That cannot hold numeric "Tier N", more than 6 tiers, or empty tiers.
- **Already landed and reusable as-is:** the mobile colour tokens, light and dark (`m-*`, commit 27d455b); position colours; headshots with team colours; season stats aggregation; `nfl_games` / `nfl_weeks`; the current NFL week; player pool with bye weeks; and the toast, sheet and switch components.

### Backend this area needs (none of it exists)
1. **Ranking record store.**
   - Fields: type (w1–w18 / ros / pre), season, scoring, position, title, items with tier markers, started-from source and author user id, status, saved_at, show_on_profile, accuracy.
   - It needs a **private working copy** plus a **public submitted snapshot**, because "edits stay private until you resubmit".
   - Unique on (user, season, type, scoring, position). RLS must be owner-only for unsubmitted rankings. Soft delete (rule 8).
2. **Three source rankings, each with per-player scores and an "updated" timestamp:** Scout AI, Expert consensus and Users average.
3. **Submission counts and a per-ranking submission number.**
4. **Accuracy grading job and percentile.** `spec-submissions-cred.md` specifies Spearman; no grading cron exists.
5. **Community publish and read of submitted rankings,** plus an "@user updated" notification type.

### Gap table
| # | Feature | Status | Where in app (checked) | Notes |
|---|---|---|---|---|
| 1 | Mobile colour tokens, light and dark (t1–t5, b0–b4, ink, barA, tg/gg, tb/gb, to/go) | restyle-only | `tailwind.config.ts` `colors.m.*`; `src/app/globals.css`; `src/stores/theme-store.ts`; `src/hooks/use-layout-mode.ts` | Already landed. b4's two light fallbacks map to `m-b4` (#D1D1D6) and `m-b4m` (#C7C7CC, used on radios). Dark mode is mobile-only and stored under `localStorage["fieldscout-theme"]`, as in the prototype. |
| 2 | Unthemed accents and tier / position-text colours | restyle-only | `tailwind.config.ts` (`accent` #0088FF, `confirm` #07B85A, `positive.strong` #07A852, `negative.strong` #FF0028) | Tier colours #4A68D4 / #8656D8 / #C98A1F / #E03E3E / #5E8C8C and position-text #A68A00 are not tokens yet. Add them as tokens; CLAUDE.md forbids arbitrary hex. |
| 3 | Font: InterDisplay with tnum / cv11 | restyle-only | `src/app/layout.tsx` (next/font Inter with opsz axis); `tailwind.config.ts` fontFamily | The app loads Google Inter, not rsms InterDisplay. Apply `tnum` and `cv11` on the mobile surfaces. |
| 4 | Position chip (16px, 9.5/700, "D/ST" label) | restyle-only | `src/components/players/position-badge.tsx` (`bg-pos-*`) | Colours match the spec. The app's position code is `DEF`, so the label must render "D/ST". Needs a 16px size. |
| 5 | FSHeadshot: 26/34px, 50% 15% crop at 1.25×, initials fallback, 1px #fff + team-colour ring, unthemed | restyle-only | `src/components/players/player-image.tsx`; `src/lib/nfl-team-colors.ts`; `players.headshot_url` | Real photos exist for all players (the prototype has 14). The ring and the initials rule are a new variant. For D/ST the app shows the team logo; the prototype shows initials ("B"). |
| 6 | Toast: ink, full width minus 16px gutters, bottom 100, z-40, 2200ms, no animation | restyle-only | `src/components/ui/toast.tsx`, `toaster.tsx`, `src/hooks/use-toast.ts` | Needs a mobile variant. Strings: "Ranking saved", "Auto tiers applied…", "Save your changes first". |
| 7 | Bottom sheet shell: backdrop .4, max-height 86%, top radius 22, grab handle, title / sub / action pill | restyle-only | `src/components/ui/sheet.tsx` (`side="bottom"`) | The shared sheet slides in and out; the spec has no animation. Restyle in place. |
| 8 | Switch: 44×26, #07B85A when on, knob movement not animated | restyle-only | `src/components/ui/switch.tsx` | In dark mode the knob is b0, so it is dark on the green track. |
| 9 | Dock spacer: tab bar overlays the scroller (84px, `margin-top:-84`); 0px spacer on bar-less screens | restyle-only | `src/components/layout/app-shell.tsx` (`pb-20`); `bottom-tabs.tsx` (fixed, h-16) | The shell pads for a 64px bar. Mobile needs an 84px bar and a per-screen spacer. |
| 10 | This file's tab bar: Home / Community / **Leagues** / Profile, 84px, barA, 24px avatar always ringed, Profile always active | out-of-scope-or-question | `src/components/layout/bottom-tabs.tsx` (Home / Lists / Players / Search / More, 64px ink, lime active) | The prototype has two different tab bars; the main app's has Players and is 80px. Needs a ruling. Community and Leagues are flag-OFF. The avatar comes from `profiles.avatar_url`. |
| 11 | Status bar and phone frame (390×844) | out-of-scope-or-question | — | Device chrome; do not build. |
| 12 | My rankings screen (#mine): root header (back + blue Create), 26/700 title, scroller | needs-new-backend | Nothing. Closest: `src/app/app/(shell)/weekly-ranks/page.tsx`, `weekly-ranks/history/page.tsx` | No store for a user's set of rankings. The UI is simple once #40 exists. Needs a new route and a new flag. |
| 13 | Hub "Mine" tab variant (title "Rankings", source tabs Experts / Scout AI / Users / Mine) | needs-new-backend | `src/components/weekly-ranks/weekly-ranks-view.tsx` (PageHeader "Rankings") | The hub is a separate spec section. The source tabs depend on #25–27. |
| 14 | Filter chips All / Submitted / Unsubmitted / Finalized, with counts | needs-new-backend | — | Needs a per-ranking status. Finalized = submitted and the week has been played. Prototype: the filter persists for the session (Zustand would do it), which can hide a ranking just submitted. Needs a ruling. |
| 15 | Period grouping: ROS, Pre-draft, Weeks 1–18; open = ROS plus current week to current+3; locked weeks at .5 "Opens in Week N" (N = week−3); past weeks and Pre-draft hidden when empty | new-ui-on-existing-data | `src/lib/sports-data/nfl-state.ts` `getCurrentNflWeek`; `nfl_weeks`; `src/components/big-board/week-tabs.tsx` | The calendar data exists. **Conflict:** the app opens only the current week (`canEdit = status==='current'`; "unlocks once the prior week kicks off"). The README hides Pre-draft "until the season ends", but the spec hides it only when empty. Neither defines offseason (`currentWeek` 0). |
| 16 | Ranking card: title with ellipsis, status pill (Finalized black, Submitted green, Saved blue, Draft grey), meta line, 5 overlapping headshots, accuracy text | needs-new-backend | — | started-from, status, savedAt and accuracy have no store; the headshot stack is restyle. "Draft" is never produced. Fix singular forms ("1 tiers", "1 players"). |
| 17 | Empty-period card with Start pill (whole card tappable) → step 1 preset to that period | new-ui-on-existing-data | — | Depends on #15 and #40. The prototype always presets PPR + RB, via an unrendered control. Needs a ruling, e.g. last-used values. |
| 18 | Filtered, no matches: three copy strings | new-ui-on-existing-data | — | Copy only. |
| 19 | Finalized display (submitted, week already played) | needs-new-backend | `nfl_weeks.last_game_ends_at` | Needs the submitted state. Key "played" off `last_game_ends_at`, not "week < current". |
| 20 | Accuracy line ("Top 18% accuracy", "Graded after Monday night…") | needs-new-backend | `weekly_rankings.accuracy_score` (unused); `cred_scores`; `src/components/profile/profile-stats.tsx` (accuracy is a placeholder); `src/app/api/cron/*` (no grading job) | Needs a grading job and a percentile across submitters. |
| 21 | New ranking header (X on step 1, chevron on step 2, "New ranking", "1 of 3") and progress track (33% / 66%, .2s, animates both ways) | new-ui-on-existing-data | — | "of 3" on a two-step flow needs a ruling. |
| 22 | Step 1: type radio cards, Week chips 5–8, scoring PPR / Standard, position grid QB…D/ST | new-ui-on-existing-data | `src/lib/stats/aggregate-fantasy.ts` (ppr / standard / half_ppr); `src/lib/scoring/default.ts` | New controls. The app supports Half-PPR; the spec offers only PPR / Standard. Needs a ruling. Week chips follow the open window (#15). |
| 23 | Existing-ranking check (type + scoring + position) → orange notice and "Open my ranking" | needs-new-backend | `weekly_rankings` UNIQUE(user, season, week, position) | Has no scoring or type, so it cannot express the key. Needs a unique key on the new record. |
| 24 | Step 2 source cards: "Recommended" badge, subs, single-line top-3 preview (single-spaced, short names) | new-ui-on-existing-data | — | The UI is new; its data comes from #25–27. |
| 25 | Source: Scout AI ("Model ranking, updated 6:00 AM") | needs-new-backend | `weekly-ranks-view.tsx` TODO(scout-ai) ("Reset to Scout AI — coming soon"); `player_weekly_projections` plus `src/app/api/cron/sync-weekly-projections`; `players.projected_pts_*` | No Scout AI ranking exists. Weekly projections × scoring rules, and season projections for ROS / pre-draft, could seed one. Whether "Scout AI" may be projection-ordered, and what "updated" means, is a product call. Per-player scores are needed for auto tiers. |
| 26 | Source: Expert consensus ("Average of 5 experts") | needs-new-backend | `persona_source_rankings` (migration 021, service-role, scraped); `src/hooks/use-persona-boards.ts` | No expert feed. The persona table depends on scraping, which memory rules out (RSS / YouTube only), and AI personas are not real experts. Needs a ruling on the data source. |
| 27 | Source: Users average ("2,418 submitted rankings") | needs-new-backend | `consensus_rankings` MV (001); `src/app/consensus/page.tsx`; `src/hooks/use-board-sources.ts` | The MV is season-long and built over all public lists. It is not split by week, type, scoring or position, and it is not built from submissions. Needs an aggregate over submissions plus a count. Rule 9 (cred weighting) applies if this is "consensus". |
| 28 | Source: Start blank | new-ui-on-existing-data | — | — |
| 29 | Bye-week filter on weekly pools; top-20 cap | new-ui-on-existing-data | `players.bye_week`; `nfl_games` (`src/hooks/use-nfl-week-games.ts`) | Use the real schedule. |
| 30 | Auto tiers on start (break when the gap exceeds 1.55× the mean gap; at least 2 players per tier; at most 7 breaks) | new-ui-on-existing-data | — | A pure utility, but it needs source scores from #25–27. |
| 31 | Step footer: Continue / Open my ranking / Start ranking, always enabled | new-ui-on-existing-data | — | — |
| 32 | Editor header: back, centred editable title (no validation), Save pill (blue "Save" / grey "Saved") | needs-new-backend | `src/app/api/lists/[id]/route.ts` (title PATCH); `useSaveBigBoard` in `src/hooks/use-big-board.ts` (explicit-save pattern) | The explicit-save pattern exists for the big board; the ranking record does not (#40). An empty title is allowed (ruling #20). |
| 33 | Tool chips (Add players, Auto tiers, Add tier line) and info line "N players · drag to reorder · started from X" | new-ui-on-existing-data | — | started-from comes from #40. |
| 34 | Tier lines stored as divider markers (Tier N label and colour, line at 35%, grip, "Merge tiers" X, draggable, empty tiers allowed) and a fixed Tier 1 header | needs-new-backend | `list_players.tier` (S–F, r1–r30, c1–c4; migration 081); `src/components/lists/v2/list-buckets.ts`, `list-reorder.ts` | Per-player buckets cannot represent this model. Needs an ordered items array with tier markers (JSONB) or a tier-break table. Lists v2's header bands are a different visual. |
| 35 | Player row: rank, 26px headshot, short name, position chip plus "TEAM vs/@ OPP" (weekly) or "TEAM · Bye n", then Pts / Avg / Pos rk | new-ui-on-existing-data | `src/lib/stats/aggregate-fantasy.ts`; `player_stats`; `use-nfl-week-games.ts`; `players.bye_week`; `src/components/players/players-spreadsheet.tsx` (position rank) | A real opponent replaces the prototype's seeded random one. Stats are season totals in every ranking type; whether weekly should show projections needs a ruling. The short-name rule collides ("A. Brown" next to "A. St. Brown"). |
| 36 | Movement delta against the order at open (+N green / -N red; no width when 0; survives Save) | new-ui-on-existing-data | `weekly-ranks-view.tsx` (delta vs saved order, biggest riser / faller) | Similar logic exists. The zero-delta column shift needs a ruling (reserve the width). |
| 37 | Drag to reorder players and tier lines; blue drop line | new-ui-on-existing-data | `weekly-ranks-view.tsx` and `src/components/big-board/board-row.tsx` (dnd-kit PointerSensor); `src/components/lists/v2/use-list-drag.tsx` | dnd-kit works on touch; the prototype's HTML5 drag does not. Don't copy two prototype bugs: a downward drop lands one slot low, and the line is invisible over player rows. |
| 38 | Auto tiers tool (removes manual tier lines, re-scores with Scout AI keeping the user's order, toast) | needs-new-backend | — | Needs Scout AI scores (#25). It over-splits after reordering, has no confirm, and fires on an empty ranking. Needs a ruling. |
| 39 | Add tier line (appended at the end); empty state "No players yet" with Add players; tier lines still render under the empty state | new-ui-on-existing-data | — | — |
| 40 | Ranking persistence (save, submit, reopen; the prototype persists nothing) | needs-new-backend | `weekly_rankings` (001, unused, RLS SELECT true); `big_board_weekly` (010); `lists.is_big_board` | Needs the full record in "Backend" above. Submitting must snapshot; later edits stay private. Owner-only RLS before submit. Soft delete. |
| 41 | Editor footer: status label and sub, plus Submit (green only when saved, clean, unsubmitted and saved at least once) | needs-new-backend | `weekly-ranks-view.tsx` (labels In progress / Saved / Submitted; "Re-submit") | Needs status and saved_at. Prototype bugs: the "Saved {date}" text doesn't update after a save, a never-saved ranking reads "Saved just now", and a dirty Finalized ranking still reads "Finalized". |
| 42 | Finalized "can't be edited" is not enforced; re-saving a submitted ranking turns it back into Saved and clears its accuracy | out-of-scope-or-question | `docs/specs/spec-submissions-cred.md` ("Submission is a frozen snapshot… immutable") | Conflicts with the existing spec. Needs a ruling on locking at kickoff and on whether the snapshot survives edits. |
| 43 | Leaving the editor silently discards unsaved edits, including a never-saved new ranking | out-of-scope-or-question | — | Needs a ruling: prompt, autosave, or keep. |
| 44 | Tapping a player row does nothing | out-of-scope-or-question | `src/hooks/use-open-player.ts`; memory rule "player click: mini card, then full" | The app rule says every player click opens the mini card. On touch, tap and drag must also be told apart. |
| 45 | A ranking with 0 players can be saved and submitted; "N tiers" counts empty tiers | out-of-scope-or-question | — | Needs a ruling. |
| 46 | Add players sheet: "{n} in your ranking", Done pill, search, position chips, rows (34px headshot, full name, "POS TEAM · …"), add/check toggle; adding appends at the end; it is the only way to remove a player | new-ui-on-existing-data | `src/components/players/player-search.tsx`; `src/app/api/players/search/route.ts` (name ilike, position filter, max 50); `useAddPlayer` / `useRemovePlayer` in `src/hooks/use-lists.ts` | The search API matches names only, not team abbreviations. Filtering the position pool on the client covers "det". Add a no-results state, per the rule that states missing from the prototype get designed. |
| 47 | Pick sheet "Scout AI #n" overall rank and sort order | needs-new-backend | `players.adp` (possible stand-in) | Needs a Scout AI overall rank. Whether ADP stands in until then needs a ruling. |
| 48 | Pick sheet quirks: "All" equals the ranking's position, search not trimmed, bye players addable to a weekly ranking | out-of-scope-or-question | — | Needs a ruling; with the real schedule a bye player shows BYE, not a made-up opponent. |
| 49 | Submit sheet: "Submit your ranking", sub = title, header "Submit" pill is the only submit control, backdrop closes | new-ui-on-existing-data | `src/components/ui/sheet.tsx` | There is no Cancel; optional ruling. |
| 50 | "Published to Community · Posted as @handle" | needs-new-backend | `src/hooks/use-explore-feed.ts` (public lists only); `featureFlags.community` OFF; `profiles.username` | Community has no ranking content type. The handle must render as a `UsernameLink` (memory rule). |
| 51 | "Counts toward the Users average · N other submissions" | needs-new-backend | — | Needs a live count per ranking key. |
| 52 | "Accuracy is graded {after Monday night's game / every week through Week 17 / after Week 4}" | needs-new-backend | `nfl_weeks.last_game_ends_at` | Needs the grading job. Pre-draft "after Week 4" contradicts "Opens for 2027 drafts"; needs a ruling. |
| 53 | "Show on my profile" toggle (default on; does nothing in the prototype; global, not per ranking) | needs-new-backend | `src/app/app/(shell)/profile/page.tsx`; `src/app/u/[username]/page.tsx` | Needs a per-ranking flag and a profile section that reads it. |
| 54 | Ranking submitted screen: 72px green check, heading, body copy, two buttons, tab bar shown | new-ui-on-existing-data | — | Layout only. An empty title leaves a leading space in the body copy. |
| 55 | Fact tile "#2,419 · Submission" | needs-new-backend | — | Needs a submission sequence per ranking key. |
| 56 | Fact tile "Tuesday / Weekly / Week 4 · Accuracy graded" | new-ui-on-existing-data | `nfl_weeks` | Derived from the ranking type. |
| 57 | "View in Community" | needs-new-backend | `src/app/app/(shell)/explore` (community flag OFF) | Needs a public view of the ranking. The prototype lands on League › Match (ruling #1). |
| 58 | "Back to my rankings" | new-ui-on-existing-data | — | — |
| 59 | Deep links #mine, #new-ranking, #view-&lt;id&gt; (and #rankings, which has no handler) mapped to real routes | new-ui-on-existing-data | `src/app/app/(shell)/weekly-ranks`, `big-board` (flag-gated); `src/lib/feature-flags.ts` | Needs real Next routes, e.g. `/app/rankings`, `/mine`, `/new`, `/[id]`. Unlike the prototype, the URL should update and browser back should work. Needs a new flag. |
| 60 | Profile › My stuff › Rankings preview rows and the contextual "New ranking" button | needs-new-backend | `src/app/app/(shell)/profile/page.tsx`; `src/components/stats/ranking-history-card.tsx` (big-board snapshots) | The prototype hard-codes these rows. Use real records; whether a row opens that ranking or My rankings needs a ruling. |
| 61 | Community Create (+) "Ranking" entry; Home "My stuff" tiles go to the Profile tab | new-ui-on-existing-data | `src/components/home/home-quick-actions.tsx` | These belong to other sections; listed here for routing. |
| 62 | Community ranking view and "Start my ranking from this" (copy with from=comm and author) | needs-new-backend | `src/app/api/lists/[id]/duplicate/route.ts` (list equivalent); `src/components/lists/public-list-view.tsx` | Needs a public read of submitted rankings. Store `from_user_id`; the prototype loses the author on save. The prototype also skips the existing-ranking check, which allows duplicates. |
| 63 | Notification "@user updated &lt;ranking&gt;" | needs-new-backend | `notifications` table; `src/hooks/use-notifications.ts` | Needs a new notification type and a trigger. |
| 64 | Exit and back targets for every screen; Profile tab returns to the pre-flow source | out-of-scope-or-question | — | In the prototype every cross-file exit lands on League › Match, and the Profile tab returns to a stale source. Real destinations need a ruling. |
| 65 | No route from My rankings to Lists or to the hub (the Rankings/Lists `rootSeg` control is computed but never rendered) | out-of-scope-or-question | — | Needs a ruling. |
| 66 | Computed but never rendered (rootSeg, mgNote, mgScoring, per-period sub/subC/fg/ring/bg, newRank, row up/down/remove) | out-of-scope-or-question | — | Do not build without a ruling. |
| 67 | How this relates to the Big Board, weekly ranks and consensus | out-of-scope-or-question | `src/components/big-board/*`; `weekly-ranks-view.tsx`; `src/hooks/use-draft-pool.ts` (the draft room reads the one season Big Board) | The spec's position × scoring × type model replaces the cross-position weekly board. "Syncs to the draft room": which per-position pre-draft rankings feed the room? Keep, migrate or retire the Big Board? |
| 68 | Launch scope and flags | out-of-scope-or-question | `src/lib/feature-flags.ts`; CLAUDE.md go-live scope | Rankings and Community are outside the 2026 go-live and flag-OFF. Free-only: no Pro gate (rule 4). The "2 submissions per week" cap in `spec-submissions-cred.md` is stale. |
| 69 | Delete, archive, unsubmit | out-of-scope-or-question | CLAUDE.md rule 8 (soft delete) | The prototype has none of these. |

### Prototype bugs: don't copy without a ruling
The prototype's §"needs a ruling" items 1–24 apply. These bite hardest once there is a real backend:
- **#17:** there is no persistence.
- **#3 and #4:** Finalized / Submitted rankings can still be edited and get demoted to Saved.
- **#5 and #6:** downward drops land one slot low, and the drop line doesn't show over player rows.
- **#7:** the delta column takes no width when the delta is zero.
- **#9 and #10:** "Saved" status text is wrong in two cases.
- **#13:** the copied author is lost, and duplicates are possible.
- **#15:** HTML5 drag doesn't work on touch. dnd-kit already solves this.

The app also conflicts with the spec in four places:
- The editable window: the app allows the current week only; the spec allows the current week through +3.
- Half-PPR exists in the app but not in the spec.
- Player tap opens the mini card in the app (memory rule); the spec does nothing.
- `spec-submissions-cred.md` says submissions are immutable; the prototype keeps them editable.
