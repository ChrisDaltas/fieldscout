## Global frame, navigation, shared parts (Lists & Rankings file)

**Sources and line references**
- The source is `FieldScout Mobile Handoff/FieldScout Mobile Lists and Rankings.dc.html` (593 lines). Markup is lines 9–305 and the script is lines 306–591. `L###` means a line in that file.
- `APP L###` means a line in `design_handoff_fieldscout_mobile/FieldScout Mobile.dc.html`, the main app. It was read only to check cross-file behaviour.

**Which folder holds what**
- The copy of the Lists file in `design_handoff_fieldscout_mobile/` is byte-identical to this one.
- `support.js` is identical in both folders.
- The two READMEs differ only in the `design_handoff_fieldscout_mobile` copy, which adds an "Assets" section and a note about the desktop app.
- The headshot component exists only as `design_handoff_fieldscout_mobile/FSHeadshot.dc.html`. It is **not** in `FieldScout Mobile Handoff/`; §2.13.1 explains what that does to the handoff copy.

Notation:
- "t3 #6E6E73" means `var(--x-t3,#6E6E73)`. The token names come from the README: t1–t5, b0–b4, ink, barA, and the tints gb/gg/go with their text colours tb/tg/to.
- Every icon is an inline SVG with `viewBox="0 0 16 16"`, `fill="none"`, `stroke="currentColor"` and `stroke-linecap:round`, unless another fill or stroke is stated. The size given is the rendered width × height.
- Fonts: `font-family:'InterDisplay',sans-serif` loaded from `https://rsms.me/inter/inter.css`, with `font-feature-settings:'tnum' 1,'cv11' 1` and `-webkit-font-smoothing:antialiased` (set on the page wrapper, L25). Line-height is `normal` unless stated.

---

### 1. Screens & states

#### 1.1 Screen switch: `state.scr`
Only one screen renders at a time. Each screen is an `<sc-if>` gated by a computed flag. A false `<sc-if>` returns `null` (support.js `walkIf`), so changing `scr` **unmounts the old screen's DOM and mounts a fresh one**. §4.6 covers the effect on scroll position.

| `scr` | Screen | Render flag | Root header (`showRoot`) | Dock (`showBar`) |
|---|---|---|---|---|
| `"rk"` | Rankings hub. Modes: Experts, Scout AI, Users, a community author's ranking, and Mine / "My rankings" | `isRk = scr==="rk"` | yes | yes |
| `"lists"` | Lists grid (My lists / Saved) | `isLists` | yes | yes |
| `"lv"` | List view (one list) | `isLv = scr==="lv" && lists.find(id===lvId)` | no | **yes** |
| `"rkNew"` | New ranking wizard, step 1 or 2 | `isRkNew` | no | no |
| `"lsNew"` | New list details (step "1 of 2") | `isLsNew = scr==="lsNew" && !!ed` | no | no |
| `"ed"` | Editor, either `ed.kind==="rank"` or `"list"` | `isEd = scr==="ed" && !!ed` | no | no |
| `"done"` | "Ranking submitted" confirmation | `isDone` | no | **yes** |

- `showRoot = scr==="rk" || scr==="lists"` (L414)
- `showBar = ["rk","lists","lv"].includes(scr) || scr==="done"` (L413–414)
- Initial state (L366–367):
  - `scr:"rk"`
  - `rk:{src:"ecr", type:"w5", scoring:"ppr", pos:"RB"}`
  - `listTab:"mine"`
  - `pick:{q:"",pos:"All"}`
  - `submitProf:true`
  - `toast:""`
  - Every other key starts `null` or unset.
- On mount (L368–373), a single `setState` does all of the following:
  - sets `myRanks = seedRanks()` and `lists = seedLists()`
  - reads `dark` from localStorage
  - applies the hash (§4.2)

#### 1.2 Complete state object (every key that any screen reads)
| Key | Values | Meaning |
|---|---|---|
| `scr` | see 1.1 | current screen |
| `rootTab` | `"rk"` | **declared, never read or written (dead)** |
| `rk` | `{src, type, scoring, pos}` | Hub filters. `src` is `ecr`, `ai`, `users`, `c:<COMM id>` or `mine`. `type` is `w5`, `w6`, `ros` or `pre`. It is set only from the type menu (TYPES, L443) or a `#view-` hash (COMM types w5/ros/pre, L369). Tapping an empty-week card writes `nw.type` (w5–w8), **never** `rk.type`. `scoring` is `ppr` or `std`. `pos` is `QB`, `RB`, `WR`, `TE`, `K` or `DST`. |
| `myOnly` | bool | See the note below this table. |
| `fromComm` | bool | Set by `#view-…` (L369). **Never read.** |
| `rkMenu` | `null`, `"type"` or `"scoring"` | the open filter popover |
| `rkOpen` | player name or `null` | the expanded hub row (one at a time) |
| `myRankF` | `"all"` (default), `"submitted"`, `"unsubmitted"` or `"finalized"` | My-rankings filter chip |
| `mgScoring` | `"ppr"` (default) or `"std"` | Scoring used when an open empty-week card is tapped (L586). Its segmented control (`out.mgScoring`, L471) is never rendered, so in practice it is always PPR. |
| `follows` | `{[COMM id]: bool}` | Follow state on the author card. **Keyed by ranking id, not by author.** @shahranks owns both r1 and r5, and the two follow independently. |
| `listTab` | `"mine"` or `"saved"` | Lists tab |
| `myRanks` | array of ranking records (shape below) | the user's rankings. Reseeded on every page load. |
| `lists` | array of list records (shape below) | lists. Reseeded on every page load. |
| `nw` | `{step, type, scoring, pos, from}`. `step` is 1 or 2; `from` is ai, ecr, users or blank. | wizard draft |
| `ed` | ranking or list draft (shapes below) | editor draft; also backs `lsNew` |
| `lvId`, `lvTf` | list id; timeframe override (`w5`, `l3`, `season`, or `null` to use the list's own `tf`) | list view |
| `sheet` | `null`, `"pick"`, `"stats"`, `"import"` or `"submit"` | open bottom sheet |
| `pick` | `{q, pos}`. `pos` is All, QB, RB, WR, TE, K or DST. | Add-players sheet search and position chip |
| `submitProf` | bool (default true) | "Show on my profile" switch. **Never read by the submit action**, so it has no effect on the record. |
| `dragOver` | index or `null` | drop-indicator row in the editor |
| `done` | `{title, type}` | confirmation screen payload |
| `toast` | string | toast text (`""` = hidden) |
| `dark` | bool | theme |

**How `myOnly` works**
- It is set only by `#mine` (L370).
- The effective flag is `s.myOnly && rk.src==="mine"` (L432). While it is true, the title reads "My rankings" and the source tabs are hidden.
- Only a source-tab tap clears it (L438). While the tabs are hidden, nothing inside the phone can clear it.
- The jump items "Rankings hub" and "Compare sources" set `src:"ecr"` without clearing it (L422). The tabs and the "Rankings" title come back, and a tab tap then clears it.
- Until it is cleared, the stored flag hides the tabs again whenever `src` returns to `mine`:
  - editor back (L499)
  - "Back to my rankings" (L557)
  - the "My rankings" jump (L422)
  - the dock Profile tab, while `src` is still `mine`

Instance fields outside `state`: `_t` (toast timer), `_from` (drag source index), `_file` (hidden file input), and `_m` (the per-render `rank()` memo).

**Record shapes**

*Ranking record* (`myRanks`; L379, L501, L575): `{id, type, scoring, pos, from, status, savedAt, acc, title, items}`.
- `id`: seeds use r1–r3. New ids are `"r"+Date.now()`. The seed ids share names with COMM ids r1–r6, but the two namespaces never mix.
- `type`: w4 (seed r3 only), w5–w8, ros or pre.
- `from`: ai, ecr, users, blank or comm.
- `status`: stored only as `"saved"` or `"submitted"`.
  - `"finalized"` is derived by `rStatus`.
  - `"new"` exists only on unsaved drafts.
  - Save writes `"saved"` in both branches of its ternary (L501), so **re-saving a submitted ranking stores it as Saved**.
  - As a result, the "Draft" status pill (L472) can never appear on a stored record.
- `savedAt`: "Oct 13" style for seeds; "Just now" after a save or submit.
- `acc`: "Graded after Monday night", "Top 18% accuracy" or "". Submit writes "Graded " + grade text.
- `items`: an array of `{t:"p", n}` and `{t:"tier"}`.
- Seeds (L380), each with 20 players and auto tiers:
  - r1 "Week 5 · RB · PPR": ai, submitted, Oct 13
  - r2 "Rest of season · WR · PPR": ecr, saved, Oct 11
  - r3 "Week 4 · QB · PPR": ai, submitted, so it shows as Finalized; Oct 4

*Ranking draft* (`ed` with `kind:"rank"`): the record fields plus:
- `kind`
- `start`: player name → 1-based position when the draft was opened or created. This drives the editor's delta column.
- `dirty`
- `fromBy`: set only by "Start my ranking from this", and dropped on save (L501)

Unsaved drafts have `id:null` and `status:"new"`.

*List record* (`lists`; L382–385, L502):
- `id`: new ids are `"l"+Date.now()`
- `title`, `desc`
- `thumb`: `"collage"`, `"upload"` or `"video"`
- `color`
- `img`: an object URL or ""
- `video`: `{url, yt, title}` or `null`
- `items`, `ranked`, `tiersOn`
- `stats`: STATS keys
- `tf`: `"w5"`, `"l3"` or `"season"`
- `mine`
- `by`: lists that aren't the user's only
- `updated`

A saved list also keeps the draft's `link`, `linkErr` and `dirty`, because save deletes only `kind` (L502).

*List draft* (`ed` with `kind:"list"`): the record plus `kind`, `link`, `linkErr` and `dirty`.

Saving or submitting moves the record to index 0 of its array (L501, L502, L575). Jumps that open `myRanks[0]` or `lists[0]` therefore open the most recently saved one.

#### 1.3 Overlay and transient states
| State | Condition | What shows |
|---|---|---|
| Popover menu | `rkMenuOpen = !!rkMenu`. Only inside the hub's sticky filter bar, so only when `src` is not `mine` and not a community view. | A transparent `position:fixed` catcher plus the menu card (§2.11). The catcher covers the **whole browser viewport**, including the jump panel outside the phone. |
| Bottom sheet | `hasSheet = !!sheet && !!ed` | A sheet needs an editor draft and a non-null `sheet`. In practice it only shows over `scr:"ed"`: the backdrop blocks the editor's back button, so you can't reach lsNew with a sheet open. Shows a dimmed backdrop and the sheet (§2.10). |
| Toast | `hasToast = !!toast` | dark card 100px from the bottom (§2.12) |
| Expanded hub row | `rkOpen === name` | inline detail card under the row |
| Drop indicator | `dragOver === i` | 2px blue line on the top edge of wrapper *i*. **Only visible on tier-line rows** (§2.13.9). |

#### 1.4 Hub modes (all on `scr:"rk"`)
| Condition | Title | Source tabs | Filter bar (pills + position chips) | Body |
|---|---|---|---|---|
| `src` is ecr, ai or users | "Rankings" | Experts · Scout AI · Users · Mine | yes (sticky) | line row + tiered rows |
| `src = "c:rN"` (community) | "Rankings" | Experts · Scout AI · Users · **@author** · Mine | **no** | author card, line row, rows |
| `src = "mine"`, effective `myOnly` false | "Rankings" | yes, "Mine" active | no | My rankings cards |
| `src = "mine"`, effective `myOnly` true (`#mine`) | "My rankings" | **hidden** | no | My rankings cards |

#### 1.5 Dead or unrendered code (computed in the script, never in markup)
These show earlier design intent:
- `rootSeg` (L415): a Rankings | Lists segmented control for the root header, never rendered. Together with the unused `rootTab` state, this means **no control inside the phone switches from Rankings to Lists**. The dock Profile tab does go from Lists to Rankings.
- `cv.back` → APP (L436). The author card has no back button of its own.
- `newRank` (L464), `rkNotComm` (L432), `mgNote` ("Weeks 5–8 are open for rankings", L470), and the `mgScoring` segmented control (L471).
- On week cards: `wk.sub`, `wk.subC`, `wk.fg`, `wk.ring` and `wk.bg` (L583–585).
- Editor row `up`, `down`, `upOp`, `downOp` and player-row `remove` (L512–514). L214 and L219 are the blank lines where they used to render. The README says rows have "no handles, arrows or delete".
- `ln.vidImg` (L530), `lv.vidImg` (L549), `thumbs[].img` (L527) and `cover().img` (L539). The markup uses the `bgImg`/`vidBg` strings instead.
- The `fline()` and `ord()` helpers (L355, L323).
- The `submitProf` state is rendered but never used by submit.

---

### 2. Layout (top to bottom)

#### 2.1 Presentation wrapper (do NOT build; it only explains states)
- **Page**: `body{margin:0;background:#F5F5F7}`. The wrapper (L25) uses `min-height:100vh; display:flex; align-items:flex-start; justify-content:center; gap:40px; flex-wrap:wrap; padding:32px 24px 48px`.
  - The page and the jump panel sit outside `.fs-dark`, so they never go dark.
- **Jump panel** (L27): 240px wide, a column with gap 14px and padding-top 8px.
  - Title "Lists and rankings", 20/600, -0.02em.
  - Subtitle "Mobile flows. Tap inside the phone or jump to a step.", 13/500, t3, line-height 1.4.
  - **Dark mode toggle row** (L29):
    - 34px tall, radius 10, padding 0 12px, 13/600, hardcoded #1D1D1F on #EBEBEE, label "Dark mode".
    - Switch: 36×22, radius 999, padding 2px, with an 18px white knob.
    - Track #07B85A when on and #C7C7CC when off. The knob position comes from justify-content flex-end/flex-start. No transition.
  - **Jump list** (L30–34), column with gap 2:
    - Group heads: 11/600 t3, padding 12px 12px 4px.
    - Items: 32px tall, radius 10, padding 0 12, gap 8, 13px. Each has an 18px-wide number at 11/500 t4.
    - Active item: weight 600, t1 on b3 #EBEBEE. Inactive: weight 500, t2, transparent.
    - Hover shows b3 (`style-hover`). This is the only hover style in the whole file.
  - **Jump items.** The number is the array index, so 0 and 10 are the group heads and are skipped.
    - **Rankings**: 1 Rankings hub · 2 Compare sources · 3 My rankings · 4 New ranking: type · 5 New ranking: start from · 6 Ranking editor · 7 Blank ranking · 8 Submit sheet · 9 Submitted.
    - **Lists**: 11 My lists · 12 List view · 13 New list: details · 14 List editor · 15 Add stats · 16 Import a ranking · 17 Add players.
    - Target states and the active-highlight rules are in §4.4.
- **Bezel** (L38): 410×864, padding 10, radius 58, background `var(--x-ink,#1D1D1F)`.
  - The dark class sits on the inner screen, so the bezel stays #1D1D1F.
  - Shadow `0 30px 80px -30px rgba(0,0,0,.45)`.

#### 2.2 Phone screen (the real viewport)
- **Box** (L39): 390×844, `position:relative`, `border-radius:48px`, `overflow:hidden`, `display:flex; flex-direction:column`, color t1 #1D1D1F, background b0 #FFFFFF.
  - There is no `transform`, so `position:fixed` descendants escape the phone (§2.11).
- **Theme class**: `themeCls` = `"fs-dark"` when dark, plus `" dock-sm"` whenever `showBar` is true (L579).
- **Global CSS** (L13–22):
  - `body{margin:0;background:#F5F5F7}` (L13)
  - `a{color:#0088FF;text-decoration:none}` and `a:hover{color:#0074DB}` (L14–15). The file contains no `<a>` elements.
  - `*{box-sizing:border-box}` (L16)
  - `input::placeholder,textarea::placeholder{color:#6E6E73}` (L17). Not theme-aware.
  - `.fsm-scroll::-webkit-scrollbar{display:none}` (L18), plus inline `scrollbar-width:none` on every `.fsm-scroll`.
  - `.fs-dark{…tokens…; color-scheme:dark}` (L19). This applies to the **whole phone subtree**, not only inputs. L20 repeats it for `.fs-dark input,.fs-dark textarea`.
  - `.fsm-scroll[style*="overflow-y"]::after{content:"";display:block;flex:none;height:var(--x-dockpad,0px)}` (L21)
  - `.dock-lg{--x-dockpad:150px}` (unused in this file) and `.dock-sm{--x-dockpad:84px}` (L22)
- **Dock clearance** (L21):
  - Every vertical scroller gets a spacer after its last child: 84px when the dock shows, 0px otherwise. Horizontal scrollers (`overflow-x` only) don't match the selector.
  - The spacer sits behind the 84px dock. **The visible gap between the last row and the top of the dock is therefore the screen's own bottom padding, 24px**, on rk (L80, L100), lists (L127) and lv (L228). The total space below the last row is 108px, but 84px of it is hidden under the dock.
- **Side effect in flex-column scrollers**: there, the `::after` is a 0px flex item, and the container's `gap` is still inserted before it. This adds extra bottom space on top of each scroller's padding, even with no dock:
  - 22px in rkNew (L149)
  - 18px in lsNew (L175)
  - 14px in the stats sheet (L285)
  - 8px in the import sheet (L289)
  - The editor (L207) and pick-sheet (L282) scrollers aren't flex, so they don't get it. None of the scrollers on dock screens are flex.
- **Done screen** (L258) is not a `.fsm-scroll`, so it gets no spacer and can't scroll.
  - It is `flex:1`, which is 794px (844 − 50 status bar), with its content centred.
  - The dock covers its bottom 84px. The content is centred at about y=447 of the phone, while the visible area's centre is about y=405, so it sits **about 42px low**.
- **Vertical stack inside the phone**:
  1. status bar, 50px
  2. root header, 36px (rk and lists only)
  3. screen body (`flex:1; min-height:0`)
  4. dock, overlaying the bottom of the body through a negative margin
  5. absolutely positioned layers: sheet (z 30/31) and toast (z 40)

#### 2.3 Status bar (L41–45), every screen
- Container: `flex:none`, 50px, flex row, align center, `justify-content:space-between`, padding `6px 32px 0 40px`, 16px/600, color inherits t1. It has no background of its own; the phone's b0 shows through.
- Left: "9:41".
- Dynamic Island: absolute, `left:50%`, `top:11px`, `translateX(-50%)`, 120×34, radius 999, #000. It does not change in dark mode.
- Right cluster (flex, gap 6px, color t1):
  - Signal: SVG 18×12, viewBox 0 0 18 12, fill currentColor. Four rects, each 3 wide with rx 1, at x=0/5/10/15 and y=8/5/2.5/0, with heights 4/7/9.5/12.
  - Battery: SVG 25×12, viewBox 0 0 25 12.
    - Outline rect: x .5, y .5, 21×11, rx 3.5, stroke currentColor, opacity .4.
    - Fill rect: x 2, y 2, 16×8, rx 2.
  - **There is no Wi-Fi glyph and no battery nub.**
- **No home indicator is drawn anywhere in this file.** The main app draws one (§2.14).

#### 2.4 Root header (L47–53), only on `scr` rk and lists
- Row: `flex:none`, align center, gap 10px, padding `2px 16px 0`. Total height 36px.
- Left, **back button**:
  - 34×34 circle, background b2 #F2F2F4.
  - Chevron-left icon 16×16 (`M10 3L5 8l5 5`), stroke-width 2, round caps and joins, color t1.
  - Handler `goProfile` (L416) sets `window.location.href = "FieldScout Mobile.dc.html"`.
  - **Design intent:** the handler is named `goProfile`, the dock always lights Profile (L417), and the main app links here from Profile › My stuff (APP L1812, L1814, L1816). So the intended parent of Rankings and Lists is **Profile**. In the prototype the link actually lands on League › Match, because the main app ignores hashes and boots there (§4.3).
- Middle: a flex:1 spacer. **There is no title in the header row**; the large title lives in the scroll body.
- Right, **Create (+)**:
  - 34×34 circle, #0088FF (Accent), `title="Create"`.
  - White plus 15×15 (`M8 3v10M3 8h10`), stroke-width 2.4.
  - Handler `rootCreate` (§3.2).

#### 2.5 Large page title and underline tabs (inside the scroller, so they scroll away)
- Title block: padding `12px 16px 0`; text 26px/700, letter-spacing -0.03em, so the block is about 43px tall.
  - Copy: "Rankings", "My rankings" (when `myOnly` is effective) or "Lists".
- **Underline tabs** (hub source tabs, L58; list tabs, L126):
  - Row: flex, gap 18px, padding `0 16px`, margin-top 6px, `border-bottom:1px solid` b3 #EBEBEE. The row is 45px including the margin.
  - Hub tabs scroll horizontally (`overflow-x:auto`, nowrap). List tabs don't scroll.
  - Each tab: `flex:none`, 38px tall, 14px/600.
  - Active: color t1 with `box-shadow: inset 0 -2px 0 var(--x-ink,#1D1D1F)`. That is a 2px ink underline drawn inside the tab's bottom edge, sitting on the row's 1px border.
  - Inactive: color t3, transparent underline. No transition.
  - Hub copy: "Experts", "Scout AI", "Users", then "@author" (e.g. "@shahranks") on a community ranking, then "Mine".
  - Lists copy: "My lists", "Saved".

#### 2.6 Flow header, progress bar and footer CTA (rkNew L142–167; lsNew L169–190)
- **Header**: `flex:none`, 52px, align center, gap 8px, padding `0 12px`, `border-bottom:1px solid` b3 #EBEBEE.
  - Left button: 36×36 circle with **no fill**, icon color t1.
    - rkNew step 1: X icon 16px (`M4 4l8 8M12 4l-8 8`, stroke 2).
    - rkNew step 2: chevron-left 16px, stroke 2.
    - lsNew: always an X, at **14px** with stroke **2.2**.
  - Centre title: flex:1, centred, 16px/600. Copy is "New ranking", or on lsNew "New list" / "Edit details" (the latter only when `ed.id` is set).
  - Right: a 36px-wide slot, right-aligned, 12px/600, t3.
    - rkNew: "1 of 3" / "2 of 3".
    - lsNew: "1 of 2", or empty when `ed.id` is set.
- **Progress bar** (rkNew only, directly under the header):
  - Track: 3px tall, b2 #F2F2F4.
  - Fill: 3px #0088FF at width "33%" (step 1) or "66%" (step 2), `transition: width .2s linear`.
- **Body scroller**:
  - rkNew: padding `18px 16px 24px`, column, gap 22px, plus the 22px trailing gap from §2.2.
  - lsNew: padding 16px, gap 18px, plus 18px trailing.
- **Footer**: `flex:none`, padding `10px 16px 30px`, `border-top:1px solid` b2 #F2F2F4.
  - Button: 48px tall, radius 14, centred 15px/600.
  - rkNew: always white on #0088FF. Copy is "Continue", "Open my ranking" (when a matching ranking exists) or "Start ranking" (step 2).
  - lsNew: white on #0088FF when the title is non-empty. Otherwise t3 on b3 #E5E5EA, but still tappable (it shows a toast). Copy is "Next: add players", or "Done" when `ed.id` is set.
  - The 30px bottom padding reserves the home-indicator area, but no home indicator is drawn.

#### 2.7 Editor header and footer (L192–224)
- **Header**: 52px, gap 8, padding `0 12px`, **no bottom border**.
  - The border belongs to the tools block below it: `padding:0 16px 10px; gap 10; border-bottom 1px b3 #EBEBEE`.
  - Back: 36×36 circle, no fill, chevron-left 16px.
  - Centre: an editable `<input>` holding the title. flex:1, centred, 16px/600, t1, transparent background, no border, `outline:0`.
  - Save pill: 32px tall, padding 0 14, radius 999, 13px/600.
    - Ranking: "Save" in white on #0088FF while dirty. "Saved" in t3 on b2 when clean, and tapping it does nothing (L501).
    - List: always "Save", white on #0088FF.
- **Footer** (ranking only):
  - Row: flex, align center, gap 12, padding `10px 16px 30px`, `border-top:1px solid` b3 #EBEBEE, background b0. Total height 85px.
  - Left: a 13px/600 status line in `stC` over an 11px/500 t3 sub-line.
  - Submit: 44px tall, padding 0 20, radius 14, 14px/600.
    - Enabled (white on #07B85A) only when all of these hold: not dirty, status isn't "submitted", and `id` is set.
    - Otherwise t3 on b3 #E5E5EA.

#### 2.8 List view overlay controls (L229–234)
- The cover is 200px tall, sits inside the scroller and scrolls away. Two buttons are positioned over it:
  - Back: absolute top 10, left 12. 36×36 circle, `rgba(0,0,0,.35)`, white chevron 16px.
  - "Edit" (own lists only): absolute top 10, right 12. 36px pill, padding 0 14, radius 999, 13px/600, white on `rgba(0,0,0,.35)`.
- There is no root header and no title bar. The status bar sits above the cover on b0.

#### 2.9 Bottom dock / tab bar (L267–271)
- Shown on rk, lists, lv and done.
- **Container**:
  - `flex:none`, height **84px**, `position:relative`, `z-index:4`, `margin-top:-84px`. It overlays the last 84px of the screen body, which scrolls behind it.
  - `display:grid; grid-template-columns:repeat(4,1fr)`, so each cell is (390−16)/4 = 93.5px.
  - Padding `8px 8px 26px`, which leaves a 50px content band.
  - Background `var(--x-barA, rgba(29,29,31,.94))`.
  - No backdrop blur and no top border.
- **Cells**: flex column, centred both ways, gap 4px, `cursor:pointer`, color `b.fg`.
  - Icon tabs: SVG 22×22, stroke-width 1.5, round caps and joins.
  - Label: 10px/600.
- **Tabs, in order**:

| # | Label | Icon `d` | Colour | Tap |
|---|---|---|---|---|
| 0 | Home | `M2.5 7.2L8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5z` (house with door) | t3 #6E6E73 | `location.href = APP` |
| 1 | Community | `M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z` (star) | t3 | `location.href = APP` |
| 2 | **Leagues** | `M5 2.5h6v3a3 3 0 0 1-6 0zM5 3.5H3v1.2A2.3 2.3 0 0 0 5.2 7M11 3.5h2v1.2A2.3 2.3 0 0 1 10.8 7M8 8.5v2.5M5.5 13.5h5L10 11H6z` (trophy) | t3 | `location.href = APP` |
| 3 | Profile | avatar | **#fff (always the active tab)** | `go("rk")` |

- **Profile avatar**: 24×24 circle, #0088FF, with a centred "D" at 11px/700 white.
  - Ring: `box-shadow: 0 0 0 2px var(--x-ink,#1D1D1F), 0 0 0 3.5px var(--x-b0,#fff)`.
  - In light mode the inner 2px #1D1D1F merges into the bar and reads as a 2px gap, followed by a visible 1.5px white ring. Dark mode reverses this (§6).
  - The ring is always on.
- The active state is fixed: Profile is white and every other tab is t3. Nothing reflects the current screen.
- The dock is identical on every screen that shows it. There is no league switcher in this file.
- **This dock does not match the main app's dock or the README** (different height, padding, tab set, icons, colours and avatar). See §2.14.

#### 2.10 Bottom sheet shell (L273–298)
- **Backdrop**: `position:absolute; inset:0; z-index:30; background:rgba(0,0,0,.4)`. It covers the whole phone, status bar included. Tapping it calls `closeSheet` (`sheet:null`).
- **Panel**: a sibling of the backdrop, not nested in it.
  - `position:absolute; left:0; right:0; bottom:0; z-index:31`.
  - `max-height:86%`, which is 725.8px of 844. Otherwise its height follows its content.
  - `display:flex; flex-direction:column`, `border-radius:22px 22px 0 0`, background b0. No shadow.
- **Grab handle**:
  - Wrapper: `flex:none`, centred, padding `8px 0 2px`.
  - Handle: 36×5, radius 999, b4 #D1D1D6.
  - **Decorative only: no drag and no swipe-to-dismiss.**
- **Header row**: flex, align center, gap 8, padding `8px 16px 10px`.
  - Left column (gap 2): title 17px/600, sub-line 12px/500 t3.
  - Right: action pill, 32px tall, padding 0 14, radius 999, 13px/600, white on #0088FF.
- **Body**:
  - pick, stats and import: a scroller with padding `0 16px 30px`. Stats and import also get the trailing-gap extra from §2.2.
  - submit: a static block with padding `0 16px 34px`, column, gap 12.
- **Per-sheet header copy and right-button behaviour**:

| `sheet` | Title | Sub | Button label | Button action | Opened from |
|---|---|---|---|---|---|
| `pick` | Add players | `"{N} in your ranking"` or `"{N} in your list"` | Done | close | Editor tool "Add players"; empty-state "Add players"; auto-opened after "Next: add players" on a brand-new empty list |
| `stats` | Add stats | `"{N} selected · shown as columns in your list"` | Done | close | "Add stat" chip (list editor) |
| `import` | Import a ranking | Brings in players in order, with their tiers | **Cancel** | close | "Import a ranking" tool (list editor) |
| `submit` | Submit your ranking | the ranking title, e.g. "Week 5 · RB · PPR" | **Submit** | submits, then `scr:"done"` | footer Submit, when enabled |

- Pick and stats are **live-edit** sheets: every tap writes straight into `ed` and marks it dirty. "Done", the backdrop and Cancel all just close, so nothing is ever discarded.
- Import closes itself when you choose a source (L569).
- The submit sheet can be dismissed through the backdrop without submitting.
- **Pick-sheet layout** (L280–282):
  - The top block is `flex:none`, with padding `0 16px 8px`, column, gap 8.
  - Search field: 40px tall, radius 12, b2, padding 0 12, gap 8.
    - Search icon 15px in t4 (circle cx7 cy7 r4.8 plus `M10.6 10.6L14 14`, stroke 1.8).
    - Input: 15px/500, `outline:0`, placeholder "Search players".
  - Below the search field: a horizontally scrolling row of position chips, gap 6 (§2.13.11f).
  - Rows: see §2.13.6-D.
- **Pick-sheet rules** (L562–567):
  - **Position limit** (`lim`): the ranking's `pos` for a ranking, or `"ALL"` for a list.
  - **Chips**: a list shows All, QB, RB, WR, TE, K, D/ST. A ranking shows only **All plus its own position** (e.g. "All", "RB"; or "All", "D/ST"). Rows are always restricted to `lim`, so on a ranking "All" and the position chip show the same rows.
  - **Preselected chip**: the editor's "Add players" tool preselects the ranking's position (L506). The empty-state "Add players" button (L508), the lsNew auto-open (L531) and the jump (L427) all preselect "All".
  - **Search**: matches a case-insensitive **substring of the full name**, or an **exact team code** (case-insensitive; "phi" matches PHI players).
  - **Sort**: by overall Week 5 PPR Scout AI rank, `rank('ai','w5','ppr','ALL')`, which is POSW-weighted. That rank is the "#N" shown in "Scout AI #N".
  - **No results**: there is no no-results state, just an empty list.
  - **Sizing**: the sheet is content-sized up to 86%, so it shrinks while the user filters.
- The main app's sheet differs in backdrop, z-order, radius, padding and type (§2.14).

#### 2.11 Popover menu `rkMenu` (L67–78), hub filter bar only
- **Host: the sticky filter bar** (L68):
  - `position:sticky; top:0; z-index:5; background:b0; padding:10px 0 8px; border-bottom:1px solid b2 #F2F2F4`.
  - Its padding box is 48px tall; with the border it is 49px.
  - It sticks to the top of the hub scroller (L56, `position:relative; overflow-y:auto`). That scroller starts directly under the 36px root header, so after about 88px of scroll (title plus tabs) the bar pins at phone y=86. Rows then scroll under it.
  - The open menu card is a child of the bar, so it stays pinned with the bar.
  - Contents: a horizontal scroller (gap 6, padding 0 16) holding:
    - two dropdown pills (§2.13.11a)
    - a 1px vertical divider (b3 #E5E5EA, margin `4px 2px`)
    - six position chips
- **Outside-tap catcher** (L71): `position:fixed; inset:0; z-index:6`, transparent. Tapping it sets `rkMenu:null`.
  - The sticky bar's `z-index:5` creates a stacking context, and the catcher sits inside it. That context ranks above the dock (z 4).
  - No ancestor has a transform, so the catcher escapes the phone's `overflow:hidden` and covers **the entire browser viewport, including the jump panel**.
  - **Any tap outside the card only closes the menu and is swallowed.** Tapping another pill while a menu is open closes the menu rather than switching menus.
- **Menu card** (L72):
  - `position:absolute; left:16px; right:16px; top:calc(100% + 4px); z-index:7`.
  - It is 358px wide. The `100%` is measured against the bar's 48px padding box, so the card starts 52px below the bar's top edge. That is **3px below the bottom of the bar's 1px border**.
  - Padding 12, radius 16, background b0. Shadow `0 10px 30px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.05)` (the README's "Menus" shadow).
  - Column, gap 8. It is clipped by the hub scroller's bounds.
- **Menu content**:
  - Heading: 12px/600 t3, "Ranking type" or "Scoring".
  - Options: a 2-column grid with gap 6. Each option is 38px tall, padding 0 10, radius 10, centred 13px/600.
  - Selected option: white on ink #1D1D1F. Unselected: t1 on b2 #F2F2F4.
  - Type menu options: Week 5 · Week 6 · Rest of season · Pre-draft. All four always show, Pre-draft included, which conflicts with the README (§2.14).
  - Scoring options: PPR · Standard.
- **Behaviour**:
  - Tapping a pill toggles its menu (`rkMenu = rkMenu===k ? null : k`).
  - Tapping an option sets `rk[type|scoring]`, closes the menu and collapses any open row (`rkOpen:null`).
  - A pill looks the same whether or not its menu is open.
  - No animation.

#### 2.12 Toast (L300)
- **Position**: `position:absolute; left:16px; right:16px; bottom:100px; z-index:40`.
  - It is a full-width card inset 16px on each side, **not a centred pill**.
  - 100px from the bottom puts it 16px above the 84px dock, 15px above the 85px editor footer, and 11px above the 89px wizard and lsNew footers. It also sits above an open sheet (z 31).
- **Style**: padding `12px 14px`, radius 14, background ink #1D1D1F (dark #4D4D4D), white 13px/600, centred. Long text wraps.
- **Timing**: auto-dismisses after **2200ms** (L386). A new toast replaces the current one (`clearTimeout`) and restarts the timer. No enter or exit animation. The toast can't be tapped.
- **Every toast string in the file**:
  - "Auto tiers applied. Drag a tier line to adjust."
  - "Ranking saved"
  - "List saved"
  - "Save your changes first"
  - "Attach a YouTube link first"
  - "Give your list a name"
  - "Added {N} players from Scout AI" / "…from the experts" / "…from your ranking"
- **Conflicts**: the README calls toasts a "bottom-centered dark pill". The main app's toast is a 36px nowrap pill at 13/500 that lasts 1800ms (§2.14).

#### 2.13 Shared building blocks

**2.13.1 FSHeadshot** (`<dc-import name="FSHeadshot" team player src size>`; source `design_handoff_fieldscout_mobile/FSHeadshot.dc.html`)
- **Element**: a circle with `width = height = size px`, `position:relative`, `flex:none`, `overflow:hidden`, background **#EEEEF1**. `title` is the full player name.
- **Ring** (box-shadow):
  - With a known team colour: `0 0 0 1px #fff, 0 0 0 {1+rw}px {teamColor}`, where `rw = 2` if size ≥ 32, otherwise 1.5.
    - Sizes 26 and 30 get a 1px white gap plus a 1.5px team ring, 2.5px outside the box.
    - Sizes 34, 36, 46 and 60 get a 1px white gap plus a 2px team ring, 3px outside the box.
    - The ring is outside layout, so it doesn't affect spacing.
  - Unknown team: `inset 0 0 0 1px rgba(0,0,0,.04)`. Every PL team is in the map, so this never happens here.
- **Photo**: `<img alt={player}>`, absolute inset 0, 100%×100%, `object-fit:cover`, `object-position:50% 15%`, `transform:scale(1.25) translateY(8%)`. `onError` falls back to initials.
- **Initials**:
  - Font size: `max(9, round(size×0.36))` px, which gives 9px at 26, 11 at 30, 12 at 34, 13 at 36, 17 at 46 and 22 at 60. Weight 700, #6E6E73.
  - Built from the name with " D/ST" stripped, split on spaces, apostrophes and hyphens. Take the first letter of the first part and the first letter of the last part, uppercased.
  - Examples: "Ka'imi Fairbairn" → "KF"; "Amon-Ra St. Brown" → "AB"; "A.J. Brown" → "AB"; "Broncos D/ST" → "B".
- **Sizes used in this file**: 36 (hub row), 26 (editor row and card head stack), 30 (list-view table), 34 (picker row), 46 (list card collage), 60 (list view cover collage).
- **Team colour map** (TC): ARI #97233F, ATL #A71930, BAL #241773, BUF #00338D, CAR #0085CA, CHI #0B162A, CIN #FB4F14, CLE #FF3C00, DAL #003594, DEN #FB4F14, DET #0076B6, GB #203731, HOU #03202F, IND #002C5F, JAX #006778, KC #E31837, LV #000000, LAC #0080C6, LAR #003594, MIA #008E97, MIN #4F2683, NE #002244, NO #D3BC8D, NYG #0B2265, NYJ #125740, PHI #004C54, PIT #FFB612, SF #AA0000, SEA #002244, TB #D50A0A, TEN #4B92DB, WAS/WSH #5A1414.
- **Colours are hardcoded** (#EEEEF1 fill, #fff gap, #6E6E73 initials). There is no dark variant.
- **Card head stack** (My-rankings cards, L107/L116):
  - Each 26px headshot sits in a wrapper with `margin-right:-6px; border-radius:50%; box-shadow:0 0 0 2px var(--x-b0,#fff)`. Up to 5 heads, then the accuracy text (`margin-left:14px`, 12px/600).
  - **The wrapper's 2px page-coloured cut-out never shows.** Each headshot's own ring (1px #fff plus 1.5px team colour, 2.5px outside its box) covers its wrapper's 2px shadow. And because the FSHeadshot root is `position:relative`, every head paints above every wrapper's shadow.
  - Each later head overlaps the earlier one by 6px. What actually separates the heads is the later head's white hairline plus its team ring.
  - The last wrapper's −6px margin means the accuracy text starts **8px** from the last head's box, not 14px. That is about 5.5px from the outer edge of its team ring.
- **Runtime wrapper**: support.js wraps every imported component in a plain block `div.sc-host`, which becomes the flex or grid item. It has no other layout effect, and a rebuild shouldn't reproduce it.
- **In the `FieldScout Mobile Handoff/` copy, headshots don't render.**
  - support.js fetches `./FSHeadshot.dc.html` (COMPONENT_DIR ".", support.js L1402/L1426). The fetch fails and logs "[dc-runtime] sibling fetch … failed".
  - It then renders a `.sc-placeholder` at the `hint-size` (e.g. 36×36): a **square** with radius 2px, a 1px border in 50% currentColor, and an 8% currentColor fill.
  - Open the byte-identical copy in `design_handoff_fieldscout_mobile/` to see real headshots.

**2.13.2 `prow(name)`** (L387): the player view-model every row uses.

| Field | Value | Used where |
|---|---|---|
| `name` | full name | headshot prop; picker row title |
| `dname` | `short(name)`: "J. Allen". D/ST names stay unchanged ("Broncos D/ST"). | hub, editor and list-view row titles |
| `team` | e.g. "BUF" | headshot ring; list-view and picker sub-line |
| `head` | `"assets/headshots/<slug>.jpg"` or `""` | headshot src |
| `posL` | QB/RB/WR/TE/K, or "D/ST" for DST | editor chip; list-view and picker text |
| `posBg`, `posFg` | POSBG/POSFG | editor position chip |
| `posC` | POSTXT | list-view and picker position text colour |

**2.13.3 Position chip** (editor row sub-line, L217)
- 16px tall, padding 0 5, radius **4**, 9.5px/700, `posFg` on `posBg`. It sits inline before the sub text, with gap 5.

| Pos | Chip bg | Chip text | Text-on-white (POSTXT) |
|---|---|---|---|
| QB | #F75252 | #fff | #E03E3E |
| RB | #5C7CE5 | #fff | #4A68D4 |
| WR | #9D70E9 | #fff | #8656D8 |
| TE | #ECAD48 | #fff | #C98A1F |
| K | #D2E8E8 | #1D1D1F | #5E8C8C |
| DST ("D/ST") | #FFE75E | #1D1D1F | #A68A00 |

- Position as coloured text (list-view and picker sub-lines): "RB" in POSTXT at 10px/600 (list view) or 11px/600 (picker), followed by the team in weight 500, t3.

**2.13.4 Stat columns** (hub and editor rows)
- Three columns from `fstats(n)`, in a flex group with gap 2.
- Each column: 36px wide, centred, gap 1.
  - value: 12px/600 t1, nowrap
  - label: 9px/500 t3, nowrap
- Labels: "Pts", "Avg" and "Pos rk".
- Values look like "54.5", "18.2" and "RB9". For D/ST the rank reads "D/ST1". At 12px/600 InterDisplay with tabular figures that is roughly 34–36px wide, so **whether it fits the 36px column is unverified**. The column is nowrap, so if it is wider it overflows by a pixel or two rather than clipping.

**2.13.5 Line row, compare columns and movement** (hub)
- **Line row** (L79), directly above the rows: flex, align center, gap 8, padding `10px 16px 4px`.
  - A 6px dot: #07D066 for Pre-draft, otherwise t5 #AEAEB2.
  - `rkLine`: 11/500 t3, ellipsis, flex:1.
  - `rkCmpHead`: 10/600 t3, nowrap, at the right end. It holds the two compare sources joined by " · ":
    - "Scout AI · Users" on Experts
    - "Experts · Users" on Scout AI
    - "Experts · Scout AI" on Users and on community views
  - The header isn't aligned with the columns below. It also says "Scout AI", while the label under each value says "AI".
- **Compare block**: after the stat columns comes a divider (1px wide, `align-self:stretch`, margin `6px 0`, b3 #EBEBEE), then two compare columns 32px wide each, gap 2.
  - value: 13px/600
  - label: 9px/500 t3, nowrap. "AI", "Users" or "Experts"; the label is literally "AI" when the source is "Scout AI".
- **Compare value colour** comes from `d = otherRank − thisRank`:
  - |d| ≥ 3 and d > 0 (the other source ranks him lower): **#FF0028**
  - |d| ≥ 3 and d < 0: **#07A852**
  - otherwise: t1
  - "–" (en dash) appears when the other source doesn't rank him. Every source ranks the same filtered set, so in practice this never happens.
- **Movement**: the rank column is 26px wide, holding the rank (14px/700) over the movement (9.5px/600), gap 1.
  - Shows "▲3" in #07A852 or "▼2" in #FF0028.
  - Only when the hub type is ros or pre and the value is non-zero.
- **Editor delta**: 24px wide, right-aligned, 12px/600. Shows "+3" in #07A852 or "-2" in #FF0028. Only on a ranking, and only when the player has moved from the starting order.

**2.13.6 Player row variants**
- **A. Hub row** (L84):
  - Flex, align center, gap 10, `min-height:54px`, padding `6px 0`, `border-bottom:1px solid` b2 #F2F2F4. The whole row is tappable.
  - Order: rank column 26 · headshot 36 · name column (flex:1, min-width 0, gap 2) · 3 stat columns · divider · 2 compare columns.
  - Name: 14px/600, ellipsis.
  - Sub-line: 11px/500 t3. Weekly types show "PHI @ BAL" or "DET vs NYG" (team, space, opponent). ros and pre show "PHI · Bye 9".
  - No position chip.
  - At 390px the name column is **≈67px**: 358 width − 241 fixed − 50 for the five 10px gaps. Most names ellipsize.
- **B. Editor row** (L213):
  - Flex, gap 9, `min-height:46px`, padding `4px 8px 4px 4px`, `border-bottom:1px solid` b2, **opaque background b0**, `cursor:grab`.
  - Order:
    - number: 22px wide, 14px/700, centred. Always shown on a ranking; on a list only when Ranked is on.
    - headshot 26
    - name (14px/600) over a sub-line (position chip + sub text)
    - 3 stat columns
    - delta, 24px (ranking only)
  - The scroller has padding `4px 12px 24px`.
- **C. List-view table** (L242–250):
  - **Table structure**: a horizontal `.fsm-scroll`, containing an `inline-flex` column with `min-width:100%; padding-right:12px`.
  - **Header row** (only when the list has stat columns, L244): 28px tall, `border-bottom:1px solid` b3.
    - A sticky "Player" cell (`position:sticky; left:0; z-index:2`, lead width, b0, padding-left 16, 10/600 t3).
    - Then 58px column labels at 10/600 t3, centred, nowrap.
  - **Rows**: 52px tall, `border-bottom:1px solid` b1 #F5F5F7.
  - **Sticky lead cell**:
    - `position:sticky; left:0; z-index:1`, background b0, padding-left 16, gap 8.
    - Width **172px**, or 100% when the list has no stat columns.
    - A right divider `inset -1px 0 0 b3` appears only when there are stat columns.
    - Contents:
      - number: 18px wide, 13px/700. **Shown only when the list is Ranked** (`showNum: L.ranked`, L547).
      - headshot 30
      - name: 13px/600, ellipsis, `padding-right:8`
      - position and team line at 10px
  - **Stat cells**: 58px wide, padding 0 3. Inner box 26px tall, radius 6, b1, 12px/600.
    - Value colour (L547): "–" in t5 #AEAEB2; a value starting with "+" in #07A852; starting with "-" in #FF0028; otherwise t1.
- **D. Picker row** (sheet, L282):
  - Flex, gap 10, padding `8px 0`, `border-bottom:1px solid` b2.
  - Headshot 34.
  - **Full name**, 14px/600.
  - Sub-line: "RB" in POSTXT at 11px/600, then " ATL · Scout AI #12" at weight 500, t3.
  - Right: a 28px circle with a white 12px icon (stroke 2.6).
    - Selected: #0088FF with a check (`M3 8.5l3.2 3L13 4.5`).
    - Not selected: **ink** #1D1D1F with a plus (`M8 3.5v9M3.5 8h9`).
- **E. Collage heads**:
  - List card: up to 4 heads at 46px in a 2×2 grid, gap 6.
  - List view cover: 60px heads, gap 8.

**2.13.7 Tier line `T_`** (the data marker is `{t:"tier"}`; a player is `{t:"p", n}`)
- **Hub tier header** (L82):
  - Flex, gap 8, padding `14px 0 4px`.
  - Contents: label "Tier N" 12px/700 in TIERC[N−1] · a 1px b3 line (flex:1) · "{k} players" 10px/500 t3.
  - Tier 1 is always emitted before row 1.
- **Editor static "Tier 1"** (L209): shown only when tiers are visible and at least one player exists.
  - Padding `10px 4px 4px`, label 12px/700 **#4A68D4**, line 1px b3.
  - Not draggable, not removable, and it has no drop handler.
- **Editor tier-line row** (L212):
  - Padding `12px 4px 4px`, gap 8, `cursor:grab`, **no background**.
  - Grip icon: 12px, fill currentColor t5 #AEAEB2, six dots of r 1.2 at (5.5|10.5, 4|8|12).
  - Label "Tier N", 12px/700 in TIERC[N−1]. N counts up from 2.
  - Line: 1px in the **tier colour** at `opacity:.35`.
  - Remove: a 24×24 circle in t3 with a 10px X (stroke 2.4), `title="Merge tiers"`. Tapping it removes that marker, which merges the tier into the one above.
  - The whole row is draggable (§2.13.9).
- **List view tier label** (L246): `position:sticky; left:0`, width = lead width, padding `12px 0 4px 16px`, 12px/700 in the tier colour. No rule line.
- **Tier colours** (TIERC): tier 1 #4A68D4, 2 #8656D8, 3 #07A852, 4 #C98A1F, 5 #E03E3E, 6 #5E8C8C, then t3 #6E6E73 for tier 7 and above.

**2.13.8 Auto-tier algorithm `breaks(scores)`** (L376–377)
This is real behaviour behind "Auto tiers" and the seeded tiers, so port it.
1. Take the scores **in the order given. There is no sort.**
2. Compute the signed gaps `g[i] = s[i] − s[i+1]` and their mean (sum ÷ max(1, n−1)).
3. Walk the gaps in order. Start a new tier before item `i+1` when all of these hold:
   - `g[i] > mean × 1.55`
   - the current tier already has at least 2 players (`i+1 − lastBreak ≥ 2`)
   - fewer than 7 breaks so far
4. The result is at most 8 tiers. Every tier except the last has at least 2 players; the last tier can have 1.

How the callers use it:
- **`itemsFrom(src,type,sc,pos,max)`** (L378) passes the top `max` from `rank()`, already sorted descending, so every gap is ≥ 0. It inserts a `T_()` before each break index. Tier 1 is implicit: there is no leading marker.
- **Editor "Auto tiers"** (L496) passes scores **in the user's current order**:
  - Where the user has put a lower-scored player above a higher one, the gap is negative. A negative gap never qualifies while the mean is positive.
  - If the order is mostly ascending (reversed), the mean is negative, so the threshold is negative too. Then almost every gap qualifies, and up to 7 breaks appear (minimum 2 per tier).
- **Auto tiers specifics** (L496):
  - A **ranking** is scored with `scoreOf(n,"ai", E.type, E.scoring, E.pos)`.
  - A **list** is scored with `scoreOf(n,"ai","w5","ppr","ALL")`. So POSW weighting applies, and the list's timeframe and stats are ignored.
  - All existing tier markers are dropped and rebuilt; the player order is kept.
  - `tiersOn` is forced true, which flips a list's Tiers switch on.
  - The draft is marked dirty, and the toast "Auto tiers applied. Drag a tier line to adjust." shows.
  - Byes are not filtered.
- **Community copies** (L335, L435): players on the author's `top` list score `1000 − index`, so the one huge gap after them is the only break. The hub's community view and "Start my ranking from this" therefore always show **exactly two tiers**: the author's list, then everyone else.

**2.13.9 Drag rows `dragRow(i, items, apply)`** (L396–400; editor only)
- **Wrapper**: each editor item, player or tier line, is wrapped in `<div draggable="true" style="box-shadow:{drop}; border-radius:10px">` (L211). It uses HTML5 drag and drop:
  - `dragstart`: remember `from = i`; `effectAllowed="move"`; `setData("text/plain", i)`.
  - `dragover`: `preventDefault`, then set `dragOver = i` (it re-renders only when the value changes).
  - `drop`: `preventDefault`, clear `dragOver`. If `from === null` or `from === i`, do nothing. Otherwise `a.splice(from,1)`, then `a.splice(i,0,moved)`, then `apply(a)`, which writes `ed.items` and sets dirty.
  - `dragend`: clear `dragOver`.
- **Drop indicator**: the hovered wrapper gets `box-shadow: inset 0 2px 0 #0088FF`.
  - **It only shows on tier-line rows.** A player row (L213) has an opaque `background:var(--x-b0)` that fills its wrapper and paints over the wrapper's inset shadow, so no line appears over player rows.
  - On a tier-line row (L212, no background), the 2px line shows along the top edge and curves into the 10px radius at both ends.
- **Edge cases**:
  - There is no `dragleave` handler. The indicator stays on the last hovered wrapper while the pointer is over space with no drop target — the static "Tier 1" header, the empty state, or the scroller padding — until drop or dragend. Dropping there does nothing.
  - Hovering the dragged row's own wrapper sets the indicator on it, but dropping there is a no-op.
  - Nothing styles the dragged row beyond the browser's default ghost.
  - There is no custom auto-scroll. The browser's native HTML5 drag auto-scroll of the `overflow-y:auto` editor scroller (L207) still applies near its edges.
  - There is no long-press. There are no handles: the whole row drags, and tier lines show a grip glyph only.
  - This is mouse-driven desktop DnD. **Touch behaviour for a 390px mobile build is unspecified** (a gap to fill).
- **Semantics quirk**: dragging **down** onto row *i* places the item **after** that row, because removing it first shifts the indices. Dragging up lands at row *i*'s position.
- Indices refer to the full `items` array, tier markers included. When a list's Tiers switch is off, its tier markers are hidden but kept.

**2.13.10 Switches**
- Editor "Ranked" / "Tiers" toggles (L200):
  - Tile: flex:1, 40px tall, padding `0 10px 0 12px`, radius 12, b1, gap 8, label 13px/600.
  - Track: 38×22, radius 999, padding 2. #07B85A when on, b3 #E5E5EA when off, `transition: background .2s linear`.
  - Knob: 18×18 in b0, `box-shadow 0 1px 2px rgba(0,0,0,.2)`. Its position is set by `justify-content` (flex-end when on), so **the knob jumps; only the colour animates**.
- Submit sheet "Show on my profile" (L295):
  - Row: padding 12, radius 12, b1, gap 10, label 14px/600.
  - Track: 44×26 with padding 2. Knob 22px. Same colours and transition.
- Jump-panel Dark mode switch: §2.1.

**2.13.11 Segmented controls, pills, chips, buttons and radio cards**

| Name | Size / shape | Type | On | Off |
|---|---|---|---|---|
| (a) Dropdown filter pill (hub "Week 5", "PPR") | h30, padding 0 10 0 12, radius 999, gap 5, chevron-down 10px (`M4 6l4 4 4-4`, stroke 2.4) | 13/600 | always white on ink | — |
| (b) Hub position chip | h30, padding 0 12, radius 999 | 13/600 | white on **#0088FF** | t1 on b2 |
| (c) My-rankings filter chip with count | h30, padding 0 12, gap 5; count 11/600 at opacity .6 | 13/600 | white on ink | t1 on b2 |
| (d) Wizard choice chip (week, scoring) | h34, padding 0 14, radius 999, wraps | 13/600 | white on ink | t1 on b2 |
| (e) Wizard position grid button | 4-column grid, gap 6, h36, radius 10 | 13/600 | white on ink | t1 on b2 |
| (f) Picker position chip | h30, padding 0 12, radius 999 | 12/600 | white on ink | t1 on b2 |
| (g) Stats-sheet option | h32, padding 0 12, radius 999 | 13/600 | white on #0088FF | t1 on b2 |
| (h) Removable stat chip | h28, padding 0 4 0 10, gap 2; 20px X hit area with a 9px X (stroke 2.6) | 12/600 | white on #0088FF | — |
| (i) "Add stat" outline chip | h28, padding 0 10, gap 4, `inset 0 0 0 1.5px` b4 #D1D1D6, 10px plus | 12/600 | — | t1 |
| (j) Tool chip ("Add players", "Import a ranking", "Auto tiers", "Add tier line") | h30, padding 0 12, radius 999, gap 5, icon 12px (stroke 1.9), b2 | 12/600 | — | — |
| (k) Status pill (Draft, Saved, Submitted, Finalized) | h22, padding 0 8, radius 999 | 11/600 | per status | — |
| (l) "Recommended" badge | h18, padding 0 6, radius 999 | 10/600 | #0088FF on gb #E6F2FF | — |
| (m) "Start" pill (empty-week card) | h28, padding 0 12, radius 999. **No handler of its own; the whole card is the hit target.** | 12/600 | white on #0088FF | — |
| (n) Segmented control (time frame Week 5 / Last 3 / Season) | track padding 2, radius 999, b2; segment h24, padding 0 10, radius 999, nowrap | 11/600 | t1 on b0, shadow `0 1px 2px rgba(0,0,0,.12)` | t3, transparent, no shadow |
| (o) Radio card | padding 12 14, radius 14, b1; selected ring `inset 0 0 0 2px #0088FF`; dot 20px | — | dot `inset 0 0 0 6px #0088FF` (a blue annulus around an 8px hollow centre) | dot `inset 0 0 0 1.5px var(--x-b4,#C7C7CC)` |
| (p) Follow pill (author card, L62) | h30, padding 0 14, radius 999 | 12/600 | "Following": t2 #3A3A3C on b3 #E5E5EA | "Follow": white on #0088FF |
| (q) Author CTA "Start my ranking from this" (L65) | full width, h38, radius 12, gap 6, b0 with `inset 0 0 0 1px` b3 #E5E5EA; 13px copy icon (stroke 1.8) | 13/600 | t1 | — |
| (r) Attach button (lsNew, L184) | h42, padding 0 14, radius 12; always tappable | 13/600 | white on ink when the trimmed link is non-empty | t3 on b3 #E5E5EA |
| (s) Colour swatch (lsNew, L181) | 24px circle; row gap 8, padding-top 2 | — | ring `0 0 0 2px b0, 0 0 0 3.5px <colour>` | no ring |
| (t) Thumbnail tile (lsNew, L179) | 3-column grid gap 8; square tile, radius 12, 22px icon (stroke 1.5); label 11/600 t2, centred, gap 5. The collage tile uses the list colour with a #fff icon; the others use b2 with a t3 icon. | — | ring `0 0 0 2px b0, 0 0 0 4px #0088FF` | no ring. Disabled ("Video frame" with no video): opacity .4 |
| (u) Empty-state "Add players" (editor, L208) | h40, padding 0 18, radius 999 | 14/600 | white on #0088FF | — |
| (v) Done-screen buttons (L263) | full width, h48, radius 14, stacked with gap 8, margin-top 10 | 15/600 | primary "View in Community": white on #0088FF | secondary "Back to my rankings": t1 on b2 #F2F2F4 |
| (w) Import-source avatar (L290) | 34×34 rounded square, radius 10 | 11/700 white initials | QB #F75252, RB #5C7CE5, WR #9D70E9, TE #ECAD48, "EC" on ink, "D" on #0088FF | — |
| (x) Submit-sheet point icon (L294) | 30px circle in gb #E6F2FF, 14px #0088FF icon (stroke 1.8), top-aligned, gap 12 | — | — | — |

- Selected-state colour differs between groups. Hub position chips (b) and stat options (g) use the accent blue; every other chip group uses ink.
- Status pill colours are covered in the My-rankings section. Finalized is the inverted one: b0 text on a t1 background.

**2.13.12 Icon catalogue** (all viewBox 16)

| Icon | Path |
|---|---|
| chevron-left | `M10 3L5 8l5 5` |
| close (X) | `M4 4l8 8M12 4l-8 8` |
| plus | `M8 3v10M3 8h10` |
| plus (small) | `M8 3.5v9M3.5 8h9` |
| check | `M3 8.5l3.2 3L13 4.5` |
| chevron-down | `M4 6l4 4 4-4` |
| search | circle (7,7) r4.8 + `M10.6 10.6L14 14` |
| play (fill currentColor) | `M4.5 2.8v10.4L13 8` |
| copy | `M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3` |
| import | `M3 3.5h10M3 8h6M3 12.5h4M11 9v5M8.5 11.5L11 14l2.5-2.5` |
| auto tiers | `M3 4h10M3 8h7M3 12h4` |
| add tier line | `M2.5 8h11M8 5v6` |
| star | as the Community tab |
| bars | `M2.5 13.5h11M4 11V7M8 11V3.5M12 11V5.5` |
| clock | `M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 5v3.3l2.2 1.4` |
| collage | `M2.5 2.5h5v5h-5zM8.5 2.5h5v5h-5zM2.5 8.5h5v5h-5zM8.5 8.5h5v5h-5z` |
| upload | `M8 10.5V3M5 5.5L8 2.5l3 3M2.5 10v3.5h11V10` |
| video frame | `M2.5 4h11v8h-11zM7 6.3v3.4L9.8 8z` |
| grip (fill currentColor) | six circles r1.2 at (5.5/10.5, 4/8/12) |

#### 2.14 Cross-file and README conflicts in the shared frame
A user moves between this file and the main app constantly, so **the dock visibly jumps and swaps a tab and two glyphs**. No single shared Dock, Toast or BottomSheet component can match both files as drawn. The README matches neither file completely.

| Part | This file | Main app (`FieldScout Mobile.dc.html`) | README |
|---|---|---|---|
| Dock box | 84px, 4-column grid, padding `8px 8px 26px`, cell gap 4, overlays via `margin-top:-84px` | 80px, flex, padding `6px 8px 0`, cells flex:1 at h48 with gap 3; overlays via `margin-top:-80px` outside a league, 0 on league screens (APP L639) | "80px tall, padding 6px 8px 0" |
| Tabs (outside a league) | Home, Community, **Leagues** (trophy), Profile | Home, Community, **Players** (toast "Not part of this prototype"), Profile (APP L1857). Inside a league: Match, Team, Players, League, Menu. | "Home, Community, Players, Profile" |
| Home glyph | house with door (§2.9) | `M2.5 7.2…` not used; `M2.5 7.5L8 3l5.5 4.5V13h-11z` (APP L1157) | — |
| Community glyph | `M8 2.2l1.7 3.6…` | `M8 1.8l1.9 3.9 4.3.6…` (a larger star) | — |
| Inactive colour | t3 #6E6E73 / dark #B3B3B3 | hardcoded #A1A1A6 in both themes | — |
| Active tab | Profile, always | the tab matching the current screen | — |
| Avatar | 24px, 11/700, fixed #0088FF, ring always on | 22px, 10/600, `s.myAv`, ring only when Profile is active | — |
| Home indicator | none | 134×5, radius 999, b0, absolute, bottom 8, centred (APP L644) | — |
| Scroller spacer | 84 (`dock-sm`) | 84 (`dock-sm`) or 150 (`dock-lg`) | 84 / 150 |
| Sheet backdrop | rgba(0,0,0,.4), z 30, panel is a sibling at z 31 | rgba(0,0,0,.32), z 20, panel nested in the backdrop (flex-end) (APP L647) | rgba(0,0,0,.4) |
| Sheet panel | radius 22, no padding; handle wrapper `8px 0 2px`; header `8px 16px 10px`; title 17/600; sub 12/500; action pill on the right | radius 24, padding `8px 0 30px`; handle wrapper `2px 0 8px`; header `4px 16px 12px 20px`; title 19/600 −0.02em; sub 13/500; optional 32px X close | "grab handle and a dimmed backdrop" |
| Toast | full width, inset 16, padding 12 14, radius 14, 13/600, wraps, z 40, 2200ms | centred pill (`translateX(-50%)`), h36, padding 0 16, radius 999, 13/500, nowrap, z 30, 1800ms (APP L1117, L1624) | "bottom-centered dark pill … about 2.2s" |
| Pressed states | none | 41 `style-active` rules | pressed accent #0074DB |
| Ranking type filter | Week 5, Week 6, Rest of season, **Pre-draft** | n/a | "Pre-draft hidden in season" |
| Shadows | adds a switch-knob `0 1px 2px rgba(0,0,0,.2)` | — | "No other shadows" |

---

### 3. Interactions

#### 3.1 `go(scr)` (L404)
`set({scr, rkMenu:null, sheet:null})`. It does **not** reset `rkOpen`, `rk`, `ed` or `myOnly`.

Used by:
- the dock Profile tab → `go("rk")`
- the wizard's step-1 X → `go("rk")`
- the new-list X when there is no id → `go("lists")`
- list-view back → `go("lists")`
- the "My lists" jump

Other navigations call `setState` directly; each one is listed in §4.

#### 3.2 Root header and dock
- **Back (chevron)**: leaves the file via `window.location.href = "FieldScout Mobile.dc.html"`, with no hash.
- **Create (+)** (L416):
  - On `lists`: starts a new list. Sets `scr:"lsNew"` with a fresh draft: title "", desc "", thumb "collage", color "#0088FF", img "", video null, items [], ranked true, tiersOn false, stats ["proj"], tf "w5", mine true, link "", linkErr false.
  - On `rk`: starts a new ranking.
    - The wizard is prefilled from the current hub filters (`type`, `scoring` and `pos` from `rk`).
    - If `src==="mine"`, it uses the defaults Week 5 / PPR / RB instead.
    - On a community view, the prefill is the author's type, scoring and position.
    - `from` is always "ai", and the wizard opens at step 1.
- **Dock Home / Community / Leagues**: a full page load of APP.
- **Dock Profile**: `go("rk")`.
  - It returns to the hub in whatever `rk` and `myOnly` state it was left in.
  - From Lists or a list view it goes to **Rankings, not Lists**. This is the only in-phone path from the Lists side to the Rankings side.

#### 3.3 Hub controls (shared mechanics only; the full hub is another section)
- **Source tab**: sets `rk.src = v`, `rkOpen:null`, `myOnly:false`.
  - The author tab exists only while `src` is that `c:` id. **Leaving it removes the tab, with no way back.**
- **Dropdown pill**: toggles `rkMenu`. Choosing an option sets the filter and closes the menu.
- **Position chip**: sets `rk.pos` and `rkOpen:null`. A chip can't be tapped while a menu is open, because the catcher swallows the tap (§2.11).
- **Row tap**: toggles `rkOpen`. It behaves as an accordion (one row open at a time), with no animation.
- **Author card Follow pill**: toggles `follows[COMM id]`.
- **"Start my ranking from this"** (L435) opens the editor with the author's ranking copied in, tiers included:
  - `kind:"rank"`, `id:null`, `from:"comm"`, `fromBy:"@author"`, `dirty:true`, `status:"new"`
  - 20 players, or 40 for ALL

#### 3.4 Sheets
- **Opening**: by setting `state.sheet`.
  - From the editor, synchronously.
  - From the jump panel and from lsNew "Next", in a `setTimeout(…,0)` after the screen switch, so the sheet appears over the already-rendered editor.
- **Closing**: a backdrop tap or the header pill. For submit, the pill commits instead of closing.
- **No animation**: sheets appear and disappear instantly, with no slide or fade.
- **No other dismiss affordance**: no X, no swipe-down, no Escape.
- **Pick-sheet rules**: §2.10.
- **Import** (L569):
  - Players already in the list are skipped.
  - If the list already has items, a tier marker is added between the existing items and the imported ones. Leading and doubled markers are stripped.
  - Importing sets `ranked:true` and `tiersOn:true`, closes the sheet, and shows the toast with the count.

#### 3.5 Toast
`toast(t)` sets the text and starts a 2200ms timer that clears it. A new toast cancels the previous timer. The toast can't be tapped.

#### 3.6 Popover
See §2.11.

#### 3.7 Drag
See §2.13.9. Drag works only on `scr:"ed"`, for both kinds of editor, on both player rows and tier-line rows. When a list's Tiers switch is off, its tier rows are hidden but their markers are kept.

#### 3.8 Animations present in the file
- Wizard progress fill: `width .2s linear`.
- Switch tracks: `background .2s linear`.
- **Nothing else** is animated. Screen changes, sheets, menus, toasts, row expansion and knob position are all instant.

#### 3.9 Inert, or disabled-looking but tappable
None of these use the HTML `disabled` state:
- New-list "Next" with an empty title shows the toast "Give your list a name".
- The editor Submit when it isn't enabled:
  - If the draft is dirty, it shows "Save your changes first".
  - Otherwise it **does nothing**. That covers a ranking that is already submitted or finalized, and one that has never been saved (no `id`, e.g. the "Blank ranking" jump) (L517–518).
- The ranking "Saved" pill when clean does nothing (L501).
- The "Video frame" thumbnail at opacity .4 shows "Attach a YouTube link first".
- My-rankings empty-week cards for locked weeks are inert, with opacity .5 and `cursor:default` (L583–586).

#### 3.10 Hover, pressed, focus and accessibility
- **No hover, pressed (`:active`) or focus styling exists anywhere inside the phone.**
  - The only `style-hover` in the file is on the jump items (L33).
  - This file has no `style-active` at all. The main app has 41.
  - The README's pressed accent #0074DB appears only in the unused `a:hover`.
- **Every control is a `<div>` or `<span>` with `onClick`.**
  - There is no `<button>`, `role`, `aria-*`, `tabindex` or keyboard handling.
  - The only keyboard handler is Enter in the YouTube link input (L184, which calls `addLink`).
- Native inputs and textareas use `outline:0` (5 places), so they show no focus ring.
- **Tooltips**: only `title="Create"` (L51), `title="Merge tiers"` (L212), and FSHeadshot's `title` and `alt` (the player name).
- **Cursors**: `pointer` on tappable elements, `grab` on editor rows and tier lines, and `default` on inert week cards.

---

### 4. Navigation

#### 4.0 Navigation model at a glance
- **Main app → this file.** Every entry is a full page load with a hash:
  - Profile › My stuff › a Rankings row → `#mine` → My rankings (title only, no source tabs)
  - Profile › My stuff › a Lists row → `#lists` → Lists grid
  - Profile › contextual create → `#new-ranking` or `#new-list`
  - Community › Create (+) › Ranking → `#new-ranking`
  - Community ranking card, global search ranking result, "Updated by people you follow" row, or Notifications "@user updated…" → `#view-rN` → that author's ranking on the hub
- **Inside this file, Rankings side:**
  - Hub (Experts / Scout AI / Users / @author / Mine) ⇄ source tabs, when visible
  - Hub + → wizard step 1 → step 2 → editor → Save → Submit sheet → Done
  - Done → "Back to my rankings" (Mine), or "View in Community" (leaves the file)
  - A My-rankings card → editor → back → Mine
- **Inside this file, Lists side:**
  - Lists → a card → List view → Edit → list editor → Save → List view
  - Lists + / "New list" tile → New list → "Next: add players" → editor (with the Add players sheet open) → Save → List view
- **Crossing between the two sides:**
  - Lists → Rankings: only through the dock Profile tab.
  - Rankings → Lists: **no path**.
- **This file → main app:**
  - root back, dock Home / Community / Leagues, and "View in Community"
  - all of them land on the main app's boot screen, League › Match

#### 4.1 Entry and exit map

| Screen | Entered from | Back / close goes to | Dock |
|---|---|---|---|
| Hub `rk` (ecr) | Default load; `#rankings` or any unknown hash; dock Profile; the wizard's step-1 X (returns to whatever `rk` was); jumps 1–2. **No main-app link opens it directly.** From the main app it is reachable only via `#view-…` then the Experts tab (`#mine` hides the tabs). | header chevron → APP (main app) | yes, Profile lit |
| Community author `rk` (c:rN) | `#view-r1` … `#view-r6` only. The main app links here from global search ranking results (APP L1478), Community › Rankings cards (APP L1537), "Updated by people you follow" (APP L1549; only r1 and r5 have updates, and only when you follow that author), and Notifications item 2 (always `#view-r1`, APP L1853). | header chevron → APP | yes |
| My rankings `rk` (mine) | "Mine" tab; `#mine` (`myOnly`, no tabs), linked from all three main-app Profile › My stuff › Rankings rows (APP L1814); editor back (ranking); "Back to my rankings" on the Done screen; jump 3 | header chevron → APP | yes |
| Lists `lists` | `#lists`, linked from all three main-app Profile › My stuff › Lists rows (APP L1812); list-view back; new-list X (no id); jump 11. **No in-phone control on the hub leads here.** | header chevron → APP | yes |
| List view `lv` | tap a list card; after "Save" in the list editor; jump 12 | top-left back → `lists` | yes |
| Wizard `rkNew` | hub +; tap anywhere on an open empty-week card in My rankings (prefilled with that period, `mgScoring` (always PPR) and RB; the "Start" pill is decorative); `#new-ranking`, linked from main-app Community › Create › "Ranking" (APP L1818) and Profile's create button on the Rankings tab (APP L1816); jumps 4–5 | step 1: X → `rk`. Step 2: chevron → step 1. | no |
| New list `lsNew` | lists + or the "New list" tile; `#new-list`, linked from main-app Profile's create button on the Lists tab (APP L1816); back from the editor of a never-saved list; jump 13. Main-app Community › Create › "List" does **not** come here; it uses the main app's own composer. | X → `lists`. The "Edit details" variant (`ed.id` set) would return to `ed`, but **nothing navigates into it**. | no |
| Editor `ed` (rank) | wizard "Start ranking"; wizard "Open my ranking" (existing); a My-rankings card; author "Start my ranking from this"; jumps 6–8 | chevron → `rk` with `src:"mine"`, `ed:null`. **Unsaved edits are discarded with no prompt.** | no |
| Editor `ed` (list) | lsNew "Next: add players"; list view "Edit"; jumps 14–17 | chevron → `lv` if the list was saved before (edits discarded); otherwise back to `lsNew` with the draft kept | no |
| Done `done` | the Submit sheet's "Submit"; jump 9 | "View in Community" → APP (lands on League › Match); "Back to my rankings" → `rk` with src mine | yes |

#### 4.2 Hash deep links (`componentDidMount`, L368–373)
- The hash is read **once, on mount**.
- There is no `hashchange` listener, and the hash never updates as you navigate.
- Nothing pushes history entries, so browser back leaves the file. Cross-file `location.href` assignments do create history entries, so browser back returns to the main app, which reboots to League › Match.
- `myRanks` and `lists` are reseeded and the theme is read in the same `setState` that applies the hash.

| Hash | Result |
|---|---|
| `#view-<id>` where `<id>` is r1–r6 | `rk = {src:"c:<id>", type, scoring, pos of that ranking}`, `fromComm:true` (unused). An unknown id falls through to the default hub. |
| `#lists` | `scr:"lists"` |
| `#mine` | `rk.src:"mine"` (other filters kept at the defaults), `myOnly:true`: title "My rankings", no source tabs |
| `#new-ranking` | `scr:"rkNew"`, `nw:{step:1, type:"w5", scoring:"ppr", pos:"RB", from:"ai"}` |
| `#new-list` | `scr:"lsNew"` with a fresh list draft (`color:"#0088FF"`, `stats:["proj"]`, `tf:"w5"`, `ranked:true`, `tiersOn:false`) |
| `#rankings`, no hash, anything else | default hub: Experts · Week 5 · PPR · RB |

#### 4.3 Cross-file links (`APP = "FieldScout Mobile.dc.html"`)
- **Outbound.** All are `window.location.href = APP` with no hash:
  - root back chevron (`goProfile`)
  - dock Home, dock Community, dock Leagues
  - "View in Community" on the Done screen
  - The author card's `cv.back` is also wired to APP but is never rendered.
  - The main app ignores hashes and always boots to `scr:"league"`, `tab:"match"` (APP L1402, L1414). **Every outbound link therefore lands on League › Match**, whatever its label says.
  - Intended targets, inferred from names and the README:
    - root back → Profile › My stuff
    - Home → Home
    - Community → Community
    - View in Community → the submitted ranking in Community
    - Leagues → no equivalent; the main app has no Leagues tab outside a league
- **Other external link**: inside the phone, `window.open(video.url, "_blank")` on the list view's video card.
- **Inbound** (all are full page loads into this file):

| Main-app surface | Target | APP line |
|---|---|---|
| Global search, a ranking result | `#view-<id>` | L1478 |
| Community › Rankings cards | `#view-<id>` | L1537 |
| Community "Updated by people you follow" rows | `#view-<id>` | L1549 |
| Notifications, item 2 ("@user updated <ranking>") | `#view-r1` | L1853 |
| Profile › My stuff › Lists rows (all three) | `#lists`, the grid, **not the tapped list** | L1812 |
| Profile › My stuff › Rankings rows (all three) | `#mine`, the list, **not the tapped ranking** | L1814 |
| Profile contextual create (`meNew`) | `#new-list` on the Lists tab; `#new-ranking` on the Rankings tab (Start/Sit stays in the main app) | L1816 |
| Community › Create (+) sheet › "Ranking" | `#new-ranking` (the sheet's "List" stays in the main-app composer) | L1818 |

- The main app's post ids r1–r6 match `COMM` here.
- The main app's Profile rows are hardcoded copies of this file's seed titles. Lists and rankings created here never appear there.
- No main-app link uses `#rankings`.

#### 4.4 Jump-panel targets and highlighting (exact states to reproduce)

| # | Jump item | Resulting state | Lit when |
|---|---|---|---|
| 1 | Rankings hub | `scr rk`, `rk = {...rk, src:"ecr"}` (type, scoring and pos kept), `rkOpen null`, `sheet null`. **Doesn't clear `myOnly`.** | `scr rk` and `src ≠ mine`, community views included |
| 2 | Compare sources | Same as 1, plus `rkOpen` = the first Experts player for the current filters (that row expanded) | never |
| 3 | My rankings | `src mine`; `myOnly` keeps its current value | `scr rk` and `src mine` |
| 4 | New ranking: type | wizard step 1 (defaults) | `rkNew` step 1 |
| 5 | New ranking: start from | step 2 with `{w6, ppr, WR, ai}` | `rkNew` step 2 |
| 6 | Ranking editor | `myRanks[0]` opened. **This jump doesn't clear `sheet`**, so a sheet left open stays open over the new editor. | any ranking editor |
| 7 | Blank ranking | `ed:{kind rank, id null, type w6, scoring ppr, pos TE, from blank, title "Week 6 · TE · PPR", items [], start {}, dirty false, status "new"}` | never (shows as "Ranking editor") |
| 8 | Submit sheet | `myRanks[0]` opened with status saved, then the submit sheet on the next tick | never |
| 9 | Submitted | `scr done`, `done:{title:"Week 6 · WR · PPR", type:"w6"}` | `scr done` |
| 11 | My lists | `lists` screen | `scr lists` |
| 12 | List view | `lv` with `lvId:"l1"`, `lvTf:null` | `scr lv` |
| 13 | New list: details | `lsNew` (fresh draft) | `scr lsNew` |
| 14 | List editor | `lists[0]` in the editor (no `link`/`linkErr`/`dirty` fields) | any list editor |
| 15–17 | Add stats / Import a ranking / Add players | `lists[0]` in the editor, then that sheet on the next tick (Add players: `pick {q:"", pos:"All"}`) | never (shows as "List editor") |

- `myRanks[0]` and `lists[0]` are whichever record was saved most recently (§1.2).
- While a hub menu is open, the jump panel can't be clicked: the catcher covers it.

#### 4.5 Dock behaviour by screen
- **Shown**, identical every time with Profile highlighted, on: the Hub (every mode), Lists, List view and Done.
- **Hidden** on: Wizard, New list, Editor (both kinds), and whenever a sheet is open, since sheets only exist on editor screens.
- No league switcher, no badge, and no active-tab change anywhere in this file.

#### 4.6 State persistence and scroll position
- **What persists**:
  - Within a page load, all state survives screen changes: saved rankings and lists, follows, `myRankF`, `lvTf`, hub filters and `myOnly`.
  - Across page loads, only `localStorage["fieldscout-theme"]` persists (read at L368, written at L579).
- **What resets**: every page load reseeds `myRanks` and `lists` and resets everything else to the initial state (L366–368). This includes:
  - any dock tap except Profile
  - the root back button
  - "View in Community"
  - a reload
  - re-entering from the main app through a hash

  Rankings the user saved or submitted, new lists, follows and filters are all lost.
- **Scroll position**:
  - Each screen is its own `<sc-if>` subtree, so changing `scr` unmounts the old scroller and **every screen opens scrolled to the top**.
  - There is no scroll restoration, e.g. when returning from List view to Lists or from the editor to the hub.
  - Changing the source tab, a filter or the position keeps the same hub scroller (L56) mounted, so its scroll offset is kept, clamped to the new content height.

---

### 5. Data shown

#### 5.1 Formats
- **Short name**: `short(n)` = the first character + ". " + every remaining word.
  - "Josh Allen" → "J. Allen"
  - "Amon-Ra St. Brown" → "A. St. Brown"
  - "A.J. Brown" → "A. Brown" (the "J." is lost). **The app keeps initials whole:** "A.J. Brown", "DK Metcalf", "CJ Stroud" (gap list §4 item 17; `shortPlayerName` in `src/utils/format-name.ts`).
  - "Ka'imi Fairbairn" → "K. Fairbairn"
  - Names ending in "D/ST" are unchanged.
- **Stat columns** (`fstats`):
  - Pts = season total, 1 decimal ("54.5").
  - Avg = season per-game, 1 decimal ("18.2").
  - Pos rk = position label + rank by season points, with no space ("RB9", "D/ST1").
  - The same three columns show on hub and editor rows, whatever the ranking type.
- **Sub-line**: weekly types show `"{TEAM} {vs |@ }{OPP}"` ("PHI @ BAL"). ros, pre and lists show `"{TEAM} · Bye {N}"` ("PHI · Bye 9").
- **Rank numbers**: plain integers ("1"). The detail card uses "#3"; the picker uses "Scout AI #12".
- **Movement**: "▲3" / "▼2" (U+25B2 / U+25BC).
- **Delta**: "+3" / "-2" (ASCII hyphen).
- **Empty value**: "–" (U+2013), shown in t5 inside list-view cells.
- **Positions**: displayed as QB, RB, WR, TE, K, D/ST; stored as `DST`. "ALL" displays as "Overall"; the code supports it, but no UI offers it.

#### 5.2 Sort, filter and grouping rules (shared engine)
- **`rank(src,type,sc,pos)`** (L374–375):
  1. Start from all 54 PL players and keep those that pass `posOk`: `ALL` matches any position, `FLEX` matches RB/WR/TE, otherwise an exact match.
  2. For weekly types, **drop players on bye that week** (`bye === week`).
  3. Score each player with `scoreOf` and sort descending.
  4. The result is memoised per render (`this._m` is reset at the start of every `renderVals`).
- The hub shows the top 24 (40 for ALL). Seeded rankings and copies take the top 20 (40 for ALL).
- Tiers come from `breaks()` (§2.13.8). The hub tier header count reads "{k} players".
- `rStatus(r)`: a submitted weekly ranking with week < `CUR_WK` (5) shows as **finalized**; otherwise the stored status is used.
- **Bye consequences of the PL data**:
  - No PL player has bye 5, so Week 5 views never drop anyone.
  - Week 6 drops 8 players: Bijan Robinson, Tyler Allgeier, Justin Jefferson, DK Metcalf, Darnell Mooney, Ka'imi Fairbairn, Steelers D/ST, Texans D/ST.
  - Week 7, wizard only, drops 7: Josh Allen, Lamar Jackson, Derrick Henry, Zay Flowers, Rome Odunze, Dalton Kincaid, Cole Kmet.
  - Week 8, wizard only, drops 8: Jahmyr Gibbs, Kyren Williams, James Conner, Puka Nacua, Amon-Ra St. Brown, Jameson Williams, Brock Bowers, Trey McBride.
  - The hub only ever offers Weeks 5 and 6.
  - `statv` rank stats always use w5, so the "Bye" value can never appear.
  - Auto tiers and the picker don't filter byes.

#### 5.3 Constant tables (script L307–363)

| Constant | Shape / content | Used for |
|---|---|---|
| `PL` | 54 rows `[name, pos, team, bye, base, rec]`: QB 10, RB 15, WR 15, TE 8, K 3, DST 3. `base` = per-game fantasy baseline; `rec` = reception weight. | the player universe for every screen (placeholder) |
| `PI` | `{[name]: {name,pos,team,bye,base,rec}}` | lookup by name |
| `HEAD` | 14 names → file slug: robinson, brown (A.J.), kamara, conner, sanders, williams (Jameson), pacheco, engram, mooney, allen (Braelon), kmet, mitchell, wright, dotson | `head(n)` → `assets/headshots/<slug>.jpg`; everyone else shows initials. The assets folder also holds johnson, blue, kolar, tucker, watson and hill, which this file doesn't use. |
| `POSBG` / `POSFG` / `POSTXT` | position chip bg, chip text and text-on-white (§2.13.3) | editor chips; list-view and picker position text |
| `TIERC` | 6 colours + t3 ×2 (§2.13.7) | tier labels and lines |
| `TEAMS32` | 32 team codes | random opponent in `oppOf` (placeholder) |
| `seeded(str)` | deterministic PRNG | every placeholder number |
| `ord(n)` | ordinal suffix | **unused** |
| `TYPES` | w5 "Week 5", w6 "Week 6", ros "Rest of season", pre "Pre-draft" | hub type menu; `tName` |
| `SCOR` | ppr "PPR", std "Standard" | scoring menu and chips; `sName` |
| `POSS` | QB RB WR TE K DST | hub position chips; wizard position grid |
| `posL`, `tName`, `sName` | Label helpers. `tName("w4")` → "Week 4" via a regex fallback. | titles such as "Week 5 · RB · PPR" (`type · pos · scoring`, joined by " · ") |
| `POSW` | QB .72, RB 1, WR 1, TE .9, K .55, DST .55 | Multiplies the score whenever `pos === "ALL"`. That happens in two live places: the Add-players sheet's "Scout AI #N" and its row order (`rank('ai','w5','ppr','ALL')`, L563), and list Auto tiers (posK `'ALL'`, L496). No hub view or ranking uses ALL. |
| `weekOf(t)` | "w6" → 6, otherwise 0 | weekly checks |
| `CUR_WK = 5`, `EDIT_TO = 8` | current week; last editable week | finalized logic; open weeks 5–8 |
| `rStatus` | see 5.2 | status pills; filters |
| `oppOf(n,t)` | `{opp:"vs XXX" or "@ XXX", rk:1–32}`. If the random opponent equals the player's own team it becomes "DAL", so DAL's own players (CeeDee Lamb, Brandon Aubrey) can show "vs DAL" / "@ DAL". **`rk` is never displayed in this file.** | weekly sub-line |
| `scoreOf(n,src,type,sc,pos)` (L334–340) | see the breakdown below this table | all orderings (placeholder model) |
| `posOk` | position filter, including FLEX | `rank`; picker |
| `STATS` | 25 `[key,label,group]` entries. **Rankings**: ecr "ECR", ai "Scout AI", users "Users", prk "Pos rk". **Fantasy**: proj "Proj", pts "Pts", avg "Avg pts". **Usage**: snap "Snap %", tgts "Tgt share", route "Route %", rshare "Rush share". **Receiving**: tgt "Tgt", rec "Rec", recyd "Rec yds", yac "YAC", adot "aDOT", yprr "YPRR". **Rushing**: ratt "Rush att", ryd "Rush yds", yco "YCO/att", ryoe "RYOE". **Passing**: pyd "Pass yds", ptd "Pass TD", cmp "Cmp %", int "Int". | list stat columns; Add-stats sheet groups |
| `PG` | per-position per-game baselines for QB, RB, WR and TE. K and DST have none, so their cells show "–". | `statv` |
| `TOPB` | top base per position (QB 24.5, RB 19.8, WR 17.2, TE 12.6, K 9.4, DST 8.8) | quality factor `q` in `statv` |
| `ytId(u)` | 11-character id from youtu.be/, `?v=`/`&v=`, /shorts/ or /embed/ | YouTube validation; thumbnail `https://i.ytimg.com/vi/<id>/hqdefault.jpg` |
| `P_(n)`, `T_()` | `{t:"p",n}` / `{t:"tier"}` | item arrays for rankings and lists |
| `SEASON` | `{avg, pts, gp}`. `avg = base×(.78…1.18)`; `gp` = 4 games, or 3 with a 15% chance. | Pts and Avg columns |
| `PRK` | position rank by `SEASON.pts` | the "Pos rk" column |
| `fstats(n)` | `[{v:pts,l:"Pts"},{v:avg,l:"Avg"},{v:"RB9",l:"Pos rk"}]` | hub and editor stat columns |
| `fline(n)` | "54.5 pts · 18.2 avg · RB9" | **unused** |
| `COMM` | r1–r6 community rankings `{by, av (avatar colour), acc ("#1 accuracy in 2025"), type, scoring, pos, title, time, follows ("12k"), note, top[]}`. Authors: @shahranks (#0088FF) ×2 (r1, r5), @ortizff (#F75252), @halefantasy (#ECAD48), @kellyscouts (#5C7CE5), @bellball (#07A852). | `#view-…` deep links; author card and tab |

**`scoreOf` breakdown** (L334–340):
1. **Base**: `v = base + rec×3.2` in PPR, or `base − rec×.5` in Standard. A `"half"` branch (`rec×.5×3.2`) exists, but no UI produces "half".
2. **Source noise**:
   - `c:<id>`: players on the author's `top` list return `1000 − index` immediately, with no noise and no POSW. Everyone else falls through to the generic ±2.2 noise.
   - `ecr`: the mean of five seeded draws, each ±1.7 (`(r−.5)×3.4`). It is checked before the `e*` branch.
   - `e0`–`e4` (individual experts, used for best, worst and std dev): one draw of ±1.7.
   - `ai`: ±1.5.
   - `users`, and any other source: ±2.2.
3. **Type noise**: weekly types add ±2.25; `pre` adds ±1.2.
4. **POSW**: when `pos === "ALL"`, the score is multiplied by POSW.

**Shared inline tables** (defined in place, not as constants):
- **"Started from" labels**: ai "Scout AI", ecr "Experts", users "Users", blank "blank". `comm` reads "another user" on My-rankings cards (L473) and `E.fromBy` (e.g. "@shahranks") in the editor info line (L507). Anything unknown reads "Scout AI".
- **Timeframes** (editor L504, list view L551): w5 "Week 5", l3 "Last 3", season "Season".
- **Collage colours** (L528): #0088FF, var(--x-t1,#1D1D1F), #F75252, #9D70E9, #5C7CE5, #07B85A.
- **Wizard weeks** (L483): 5, 6, 7, 8, shown as "Week 5" … "Week 8".
- **My-rankings periods** (L581):
  - ros "Rest of season": open
  - pre "Pre-draft": closed, "Opens for 2027 drafts"; hidden when there are no cards
  - Weeks 1–4: past, "Finalized"; hidden when there are no cards
  - Week 5: "This week"
  - Weeks 6–8: "Open"
  - Weeks 9–18: locked, "Opens Week N−3", opacity .5

**`statv` value formats** (list view cells; the Lists section also documents these):
- Rank stats (ecr, ai, users, prk): a plain integer position rank from the Week 5 PPR list.
  - **"Pos rk" here is the expert position rank ("9"), unlike the hub's "RB9" season rank.**
  - It would show "Bye" if the player were unranked, but that can't happen (§5.2).
- proj, pts, avg, adot and yco: 1 decimal. yprr: 2 decimals.
- Percentages: integer + "%", capped at 99.
- ryoe: a signed integer — "+N" when positive, "-N" when negative, "0" when zero.
- Counts: integers.
- No baseline: "–".

#### 5.4 Placeholder vs real
- **Placeholder** (generated by `seeded`, per the README): every number shown, including:
  - Pts, Avg, Pos rk, projections, ranks, movement, opponents and the expert spread
  - "Consensus of 5 experts", "Average of 2,418 user rankings", and "updated 9:12 AM" / "updated today 9:12 AM" / "updated 4 min ago"
  - "#2,419 Submission", accuracy strings and follower counts
  - the seeded rankings, lists and COMM authors
- **Hardcoded identity**: user "@dalton", avatar letter "D", avatar colour #0088FF.
- **Real product data**:
  - player names, teams, positions and bye-week semantics (the byes in PL are illustrative)
  - the structure of type × scoring × position
  - the auto-tier rule
  - the statuses
  - the editable-week window (current week to current+3)

---

### 6. Dark mode

**How it works**
- `state.dark` adds the class `fs-dark` to the phone screen. That class redefines the `--x-*` variables and sets `color-scheme:dark` on the whole phone subtree (L19); L20 repeats it for inputs and textareas.
- Light mode defines **no variables**: every value comes from the inline fallback.
- The preference is read on mount from `localStorage["fieldscout-theme"] === "dark"`, and `toggleDark` writes "dark" or "light". The main app uses the same key (APP L1402), so the theme carries across files.
- **The only toggle is in the jump panel, outside the phone.** No in-phone theme control exists in this file; the README puts it on the main app's Profile.
- There is no `prefers-color-scheme` fallback and no cross-tab sync.
- The page, jump panel and bezel never change.

| Var | Light fallback(s) in this file | Dark |
|---|---|---|
| t1 | #1D1D1F | #FFFFFF |
| t2 | #3A3A3C | #D9D9D9 |
| t3 | #6E6E73 | #B3B3B3 |
| t4 | #8E8E93 | #A7A7A7 |
| t5 | #AEAEB2 | #727272 |
| b0 | #fff | #121212 |
| b1 | #F5F5F7 | #282828 |
| b2 | #F2F2F4 | #333333 |
| b3 | #EBEBEE **and** #E5E5EA | #3E3E3E |
| b4 | #D1D1D6 **and** #C7C7CC (radio-off dot; the README lists #C7C7CC under t5) | #575757 |
| ink | #1D1D1F | #4D4D4D |
| barA | rgba(29,29,31,.94) | rgba(18,18,18,.92) |
| gb / tb | #E6F2FF / #0074DB | #12263F / #6FB5FF |
| gg / tg | #E3F9EC / #067A3E | #12301F / #1ED760 |
| go / to | #FFF3E6 / #B25C00 | #3A2A14 / #FFB340 |

- Defined in `.fs-dark` but unused here: `tr` #FF6B6B, `gr` #3A1A1D, `gb2` #16212E, `gp` #261E36, `bar` #121212, `mini` #090909, `dock` #121212, `miniline` transparent, `dockA` rgba(18,18,18,.86).

**Area-specific dark results**
- **Dock**:
  - Background rgba(18,18,18,.92). Inactive labels and icons #B3B3B3.
  - Avatar ring: the inner 2px ink (#4D4D4D) shows clearly as a grey ring on the bar, while the outer 1.5px b0 (#121212) disappears against it. Light mode is the reverse (§2.9).
- **Toast**: #4D4D4D card with white text.
- **Sheet and menu**: #121212 surface. Handle #575757. The backdrop stays rgba(0,0,0,.4). The menu shadow is unchanged, so it barely reads.
- **Chips**: off = #333333 with white text. Ink-selected chips become #4D4D4D, not near-black.
- **Underline tabs** (hub and lists): the active underline is ink, so it becomes #4D4D4D on #121212. Low contrast.
- **Root back button**: #333333 with a white chevron.
- **Status bar glyphs**: white.
- **Status pills**:
  - Finalized inverts to a white pill with #121212 text.
  - Submitted: #1ED760 on #12301F.
  - Saved: #6FB5FF on #12263F.
  - Draft: #D9D9D9 on #333333.
- **List colour `var(--x-t1,#1D1D1F)`** (seed l2 at L383, and the second swatch at L528) **turns white in dark mode**:
  - l2's cover becomes a white square.
  - The collage thumbnail tile's #fff icon (L527) disappears on it.
  - That swatch's selected ring is also white.
- **FSHeadshot's 1px #fff gap** shows as a white hairline on every dark background.
- **Ink-filled small elements**: the picker's unselected add circle and the Experts "EC" import avatar become #4D4D4D.

**Not theme-aware (hardcoded)**
- POSBG, POSFG and POSTXT. POSTXT text such as #4A68D4 on #121212 has low contrast.
- TIERC.
- Success #07A852: arrows, deltas, the better-rank colour, and the "Top…" accuracy text. The README gives dark success as #1ED760.
- Danger #FF0028. The README gives dark danger text as #FF6B6B.
- Accent #0088FF, green fill #07B85A, and brand dot #07D066.
- The FSHeadshot #EEEEF1 fill, #fff ring gap and #6E6E73 initials.
- The input placeholder colour #6E6E73 (global CSS L17).
- The Dynamic Island #000 and the presentation bezel.

---

### Open questions
- Which dock is canonical? This file's dock is 84px tall with padding 8px 8px 26px and four grid columns: Home, Community, Leagues (trophy) and Profile. Inactive tabs are t3, the avatar is 24px with its ring always on, and there is no home indicator. The main app and the README use an 80px dock with padding 6px 8px 0: Home, Community, Players and Profile. Inactive tabs are #A1A1A6, the avatar is 22px with a ring only when active, and there is a 134x5 home indicator. The Home and Community icons also differ between the two files. Is the third tab Leagues or Players?
- Which toast is canonical? This file uses a full-width card inset 16px, radius 14, 13px/600, text that wraps, shown for 2200ms. The main app uses a centred 36px pill at 13px/500, no wrapping, shown for 1800ms. The README says 'pill, ~2.2s'.
- Should the two bottom sheets be unified? This file: backdrop rgba(0,0,0,.4), radius 22, 17px title, action pill on the right, z-index 30/31. Main app: backdrop .32, radius 24, 19px title, optional X button, panel nested in the backdrop. Should sheets slide up, and should the grab handle support swipe-to-dismiss? The prototype animates neither.
- Every outbound link goes to the main app with no hash, and the main app always opens on League > Match. That covers the back chevron (whose handler is named goProfile), the Home, Community and Leagues tabs, and 'View in Community'. Are these the intended targets? Back to Profile > My stuff; Home to Home; Community to the Community tab; View in Community to the submitted ranking. Where should Leagues go, given the main app has no Leagues tab outside a league?
- No control inside the phone goes from Rankings to Lists. A Rankings | Lists segmented control (rootSeg) is built in the code but never shown. Going the other way, the Profile tab takes you from Lists to Rankings. Should the header carry a Rankings | Lists switch, or are both meant to be reached only from Profile > My stuff?
- Main-app Profile > My stuff rows open the Lists grid (#lists) or My rankings (#mine), not the list or ranking that was tapped. No hash exists for a single list or ranking. Should rows open the specific item? Also, Community > Create > List uses the main app's own composer, while Profile > Lists > create opens this file's New list screen (#new-list). Which list-creation flow is canonical?
- From the main app, the Experts/Scout AI/Users rankings hub can only be reached by opening someone's community ranking (#view-) and then tapping Experts. #mine hides the source tabs. Is that intended, or should something open the hub directly (#rankings exists but nothing links to it)?
- On a community ranking (#view-), tapping Experts, Scout AI or Users removes the @author tab, and there is no way back to that ranking. Is that intended, or should the author tab stay?
- The README says Pre-draft is hidden during the season, but the hub's type menu and wizard step 1 both offer it. Which is correct?
- Drag and drop: how should reordering work on touch? The prototype uses desktop mouse drag only: no long-press, no styling on the dragged row, and only the browser's built-in auto-scroll. The blue drop line never appears over player rows, because their solid background hides it; it only shows on tier-line rows. Dragging down drops the row below the target, not where the line suggests. Should a drag start immediately (the whole row as the handle, which competes with scrolling) or after a long-press? And should the drop line always show exactly where the row will land?
- Going back from the editor throws away unsaved changes without asking, for both rankings and lists. Is that intended, or do we want a 'discard changes?' prompt?
- The only way to remove a player from a ranking or list is to un-tick them in the Add players sheet. Delete and up/down buttons exist in the code but aren't shown. Confirm that's intended.
- The 'Edit details' version of the new-list screen (name, description, thumbnail and video for an existing list) can't be reached from the list view or the list editor. Where should its entry point go?
- 'Pos rk' means two different things. On hub and editor rows it is the season-points position rank ('RB9'). In a list's stat columns it is the expert-consensus rank shown as a bare number ('9'). Which meaning and format do we want? Separately, it's unverified whether 'D/ST1' fits the 36px column.
- At 390px the hub row's name column is only about 67px wide, so most short names get cut off with '…' (for example 'C. McCaffrey'). Accept that, or adjust the columns?
- Dark mode: several colours are fixed and don't adapt — position text (POSTXT), tier colours, success green #07A852, danger red #FF0028, the headshot's #EEEEF1 fill and white ring, and the input placeholder #6E6E73. Should they use the README's dark values (success #1ED760, danger text #FF6B6B), and what should position and tier text use on #121212? Also, the black list colour (var(--x-t1)) turns white in dark mode: the '5 players not to draft' cover becomes a white square and the collage icon on it disappears. Is that intended?
- Selected chips are accent blue #0088FF in some places (hub position chips, stat options) and ink in all the others. Is that intentional?
- Which folder is the source of truth? The Lists file and support.js are identical in both folders. FSHeadshot.dc.html and FieldScout Mobile.dc.html exist only in design_handoff_fieldscout_mobile/. As a result, opening the FieldScout Mobile Handoff/ copy shows grey square placeholders instead of circular headshots.
- The Profile avatar is hardcoded: letter 'D', colour #0088FF, handle '@dalton'. Confirm it should use the signed-in user's avatar, colour and handle.
- The dock is semi-transparent (94% / 92% opacity) with no background blur. Confirm there should be no blur.
- Nothing inside the phone has hover, pressed or focus styling, and no control is a real button or carries accessibility labels. The main app uses pressed states on 41 controls. Should this area get the same pressed states (README pressed accent #0074DB), plus proper buttons, labels and focus rings in the rebuild?
- The Done ('Ranking submitted') screen centres its content in an area that includes the 84px behind the dock, so the content sits about 42px lower than the visible centre. Centre it in the visible area instead?
- My-rankings cards overlap up to 5 headshots and give each one a 2px page-coloured cut-out, but the cut-out never shows: each headshot's own white and team-colour ring covers it. Is the intended look that 2px gap between heads?
- Follow on a community ranking is stored per ranking, not per author. @shahranks owns r1 and r5, and following him on one doesn't show 'Following' on the other. Should follow be per author?
- Saving a ranking that was already submitted stores it as 'Saved', so its card changes from Submitted to Saved. That contradicts the editor's own copy, 'Edits are saved privately until you resubmit', and it means the 'Draft' status pill can never appear. Should a submitted ranking stay submitted while its edits are saved privately?
- Should the app remember scroll position when returning from List view to Lists, or from the editor to the hub? The prototype always reopens a screen at the top.
- Critic findings: I dropped none — all were confirmed against the source. Four were refined: (1) Negative gaps never create a tier break only while the average gap is positive. If the user's order is mostly ascending, the average and the threshold go negative and most gaps create breaks (up to 7). (2) The missing FSHeadshot renders as a grey square placeholder with a 1px border, radius 2px, at the hint size, rather than an empty box. (3) The critic's line numbers for the global CSS were off by one; the correct lines are L14–15 (a / a:hover), L16 (box-sizing) and L21 (dock spacer). (4) The main-app Home icon differs from this file's too, not only the Community star.

---

## Gap analysis vs the current app

## Gap table: Lists & Rankings mobile file, §1–6 (global frame, navigation, shared parts)

All paths are relative to `/Users/chrisdaltas/Documents/Hadouken/.claude/worktrees/redesign-v7`.

**What the mobile build has so far:** one commit on this worktree's HEAD, `27d455b` ("mobile(v1)"):
- the `--m-*` light/dark tokens in `src/app/globals.css`
- the `m.*` colours and the `mob:` variant in `tailwind.config.ts`
- `src/stores/theme-store.ts`, plus the head script in `src/hooks/use-layout-mode.ts`

Nothing uses `mob:` or `m-*` yet. On a phone today the app shows:
- the desktop `TopNav`
- `BottomTabs`: Home / Lists / Players / Search / More, on an ink bar 64px tall, with a lime active tab
- `MoreSheet`

### A. Frame and chrome
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Presentation wrapper, jump panel, bezel (§2.1) | out-of-scope-or-question | — | Don't build. The dark-mode toggle only exists here (see row G1). |
| Status bar, Dynamic Island, home indicator (§2.3, §2.14) | restyle-only | `src/app/layout.tsx`, `globals.css` | The phone draws these itself. Gap: the app has no `viewport-fit=cover` or `env(safe-area-inset-*)` handling anywhere, and the 30px footer padding and the 26px dock padding need to map to safe-area insets. |
| Mobile shell: no top bar; each screen has its own header; dock overlays the body (§2.2) | restyle-only | `src/components/layout/app-shell.tsx`, `top-nav.tsx`, `bottom-tabs.tsx`, `more-sheet.tsx` | The shell always renders `TopNav`. Needs a `mob:` branch that hides TopNav, DraftBar and the rail and uses the new chrome. |
| Dock look: 84px, 4-column grid, barA background, 22px stroke icons, 10/600 labels, no blur | restyle-only | `bottom-tabs.tsx` | Today: 64px, flex, `bg-ink`, lime active, 16px filled icons. |
| Dock tab set | out-of-scope-or-question | `bottom-tabs.tsx`, `feature-flags.ts` | This file has Home/Community/**Leagues**/Profile. The main app and README have Home/Community/**Players**/Profile. The app has Home/Lists/Players/Search/More. Community (`community` flag) and Leagues (`leagues` flag, test cohort) are off in production. |
| Dock active state (Profile always lit) | out-of-scope-or-question | `bottom-tabs.tsx` (`isTabActive`) | The main app lights the current tab. Recommend that. |
| Dock avatar: 24px, ring, "D" on #0088FF | new-ui-on-existing-data | `src/components/ui/user-avatar.tsx`, `profiles` | Use the real avatar. Sizes differ: 24px here, 22px in the main app. |
| Dock visibility per screen; 84px scroller spacer (`dock-sm`) | restyle-only | — | Shown on rk/lists/lv/done; hidden on wizard/lsNew/editor. |
| Root header: back chevron + blue Create (+) (§2.4) | new-ui-on-existing-data | `src/app/app/(shell)/profile/page.tsx` | Back is meant to go to Profile › My stuff, which doesn't exist: the profile page is "My stats". |
| Create (+) context (§3.2) | new-ui-on-existing-data | `list-form-dialog.tsx`, `/app/lists/new` → `builder/list-builder.tsx` | Lists side exists, with different fields. Rankings side: the wizard prefilled from hub filters is new. |
| Large title + underline tabs (§2.5) | restyle-only | `src/components/ui/tabs.tsx` | Add an underline variant: 2px inset ink, 14/600. Hub tabs scroll sideways. |
| Lists tabs My lists / Saved | new-ui-on-existing-data | `list_favorites`, `/api/lists/favorites`, `use-lists.ts` (`useToggleFavorite`) | The data exists. |
| Flow header + 3px progress bar + footer CTA (§2.6) | restyle-only | — | Disabled-looking but tappable CTA (toast "Give your list a name"). |
| Editor header (inline title input, Save pill) + ranking footer (status + Submit) (§2.7) | out-of-scope-or-question | `lists/v2/list-body.tsx`, `use-lists.ts`, `weekly-ranks/weekly-ranks-view.tsx` | Lists save every change at once through the API. The spec uses a draft + Save model, and back discards edits with no prompt (§4.1). Need a ruling: keep autosave or copy Save? |
| List-view overlay back + Edit on a 200px cover (§2.8) | new-ui-on-existing-data | `lists/v2/list-detail-hero.tsx`, `/app/lists/[listId]` | |
| Sticky hub filter bar pinned under the root header (§2.11) | restyle-only | — | |

### B. Overlays
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Bottom sheet shell (§2.10) | restyle-only | `src/components/ui/sheet.tsx` | Spec: 36×5 grab handle, 17/600 title + sub-line, action pill, max height 86%, backdrop .4, radius 22, no X, no animation, no swipe. Today: Radix side sheet with X, 200ms slide, `shadow-hard-8` and border. Add a CVA variant. The main app's sheet differs (radius 24, title 19/600, backdrop .32): needs a ruling. |
| Popover menu (type/scoring, 2-column option grid, catcher swallows taps) | restyle-only | `src/components/ui/popover.tsx` | Radix outside-click already gives close-on-tap. Uses the README menu shadow (an allowed overlay). |
| Toast (full-width card inset 16px, 100px from bottom, 13/600, wraps, 2200ms, no animation) | restyle-only | `ui/toast.tsx`, `ui/toaster.tsx` (`duration={4500}`), `use-toast.ts` (`TOAST_LIMIT 1`) | Today: 11px pill, 4.5s, slides. Conflicts with the main app's pill (h36, 13/500, 1800ms) and the README's "centered pill": needs a ruling. Toast copy strings are copy-only. |

### C. Shared building blocks
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| FSHeadshot: team ring (1px white + 1.5/2px team colour), #EEEEF1 fill, scale(1.25) translateY(8%), initials rules | restyle-only | `players/player-image.tsx`, `src/lib/nfl-team-colors.ts`, `src/lib/player-image.ts` | No ring exists today. The colour map matches except **SEA** (app #69BE28, spec #002244) and the WSH alias. The app shows a team logo for D/ST where the spec shows initials ("B"): needs a ruling. |
| Player view-model: short name "J. Allen", "D/ST" label | restyle-only | `src/utils/format-name.ts`, `players/position-badge.tsx` | The app says DEF; the spec displays D/ST. |
| Position chip (16px, radius 4, 9.5/700) + POSTXT text colours | restyle-only | `tailwind.config.ts` `pos.*`, `position-badge.tsx` | Chip backgrounds match. The POSTXT colours (#E03E3E, #4A68D4, #8656D8, #C98A1F, #5E8C8C, #A68A00) are missing as tokens. |
| Stat columns Pts / Avg / Pos rk (season) | new-ui-on-existing-data | `lib/stats/aggregate-fantasy.ts`, `lib/players/core-stats-service.ts`, `players-spreadsheet.tsx` | Needs a batched per-row query. |
| Sub-line "PHI @ BAL" / "PHI · Bye 9" | new-ui-on-existing-data | `nfl_games` (`use-nfl-week-games.ts`), `players.bye_week` | |
| Compare columns (Experts / Scout AI / Users rank, coloured at ±3) + line-row header | needs-new-backend | `use-board-sources.ts`, `consensus_rankings` (001), `weekly-ranks-view.tsx` TODO "no Scout AI / consensus baseline" | No expert (ECR) feed and no Scout AI per-player rank. Users consensus exists, but only overall, not per week/position/scoring. `expert_profiles` / `expert_follows` exist with no ingestion. |
| Movement ▲/▼ (ROS / pre-draft) | needs-new-backend | `big_board_snapshots` is per user only | Needs a history of each source's rankings. |
| Editor delta (+3 / −2 against the starting order) | new-ui-on-existing-data | `weekly-ranks-view.tsx` already tracks `serverOrder` and `dirty` | Client-only. |
| Hub row (54px, accordion detail) | new-ui-on-existing-data | `big-board/board-row.tsx` | Body depends on the source rows above. |
| Editor row (whole row drags; no handles, arrows or delete) | restyle-only | `lists/v2/list-row-parts.tsx` | Removal goes through the picker's check toggle. |
| List-view table (sticky 172px lead, 58px stat cells, number only when Ranked, sticky tier labels) | new-ui-on-existing-data | `lists/v2/list-body.tsx`, `lists.ranking_mode` | |
| Picker row (full name, POSTXT, "Scout AI #12", +/✓ circle) | new-ui-on-existing-data | `/api/players/search` | "Scout AI #N" needs the backend; ADP is the stand-in. |
| Collage heads (2×2 at 46px; 60px on the cover) | restyle-only | `list-thumbnail.tsx`, `lists/v2/cover-tile.tsx` | |
| Tier lines: hub header with count; static editor "Tier 1"; draggable tier rows with grip + merge X; sticky list-view label; TIERC colours | new-ui-on-existing-data | `list_players.tier`, `/api/lists/[id]/players/[playerId]/tier`, `lists/v2/list-buckets.ts`, `tier-badge.tsx` | The spec stores markers between items; the app stores a label on each player, so a mapping is needed. TIERC tokens are missing. |
| Auto-tier `breaks()` algorithm (1.55× mean gap, ≥2 per tier, ≤8 tiers) | new-ui-on-existing-data | none in the app | Port it as a pure util. The spec scores by Scout AI; use projections until that exists. |
| Drag rows: drop line shows only on tier rows; drag down lands after the target | restyle-only | `lists/v2/use-list-drag.tsx` (dnd-kit Mouse + Touch, 220ms delay) | The spec doesn't define touch drag: needs a ruling. The app's long-press is the obvious answer. |
| Switches: Ranked / Tiers tiles, "Show on my profile" | restyle-only | `ui/switch.tsx` | Ranked and Tiers are independent in the spec. `ranking_mode` (unranked / ranked / rank_and_tier) can't store "Tiers on, Ranked off". |
| Chips, pills, segmented controls, radio cards (a)–(x) | restyle-only | `ui/tabs.tsx` (Segment), `ui/button.tsx`, `ui/badge.tsx` | Add CVA variants. Blue vs ink selected states differ by group, as the spec draws. |
| Status pills Draft / Saved / Submitted / Finalized | needs-new-backend | `/app/weekly-ranks/history/page.tsx` ("no submissions table/API") | |
| Icon catalogue (stroke icons, viewBox 16) | out-of-scope-or-question | `ui/icon.tsx` | The file's rule says "filled glyphs… never mix outline icons". Mobile is stroked: need a ruling to add a mobile stroke set. |
| Fonts: InterDisplay with tnum + cv11 | restyle-only | `src/app/layout.tsx` (next/font Inter), `globals.css` | Set the font features on the mobile root. |

### D. Rankings data and flows referenced by the frame
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Ranking record (type w4–w8/ros/pre × scoring × position, from, status, savedAt, acc, title) | needs-new-backend | `big_board_weekly` + lists (`use-big-board.ts`), big board, unused `weekly_rankings` table (001) | Today: one overall board per (user, season, week), filtered by position in the client. No ROS, no per-scoring ranking, no record of where a ranking started from. |
| Editable window (current week to +3), locked weeks "Opens Week N−3", past weeks Finalized | needs-new-backend | `weekly-ranks-view.tsx` never fetches future weeks (the server would auto-create them) | |
| Accuracy grading ("Graded after Monday night", "Top 18% accuracy") | needs-new-backend | `cred_scores`, `weekly_rankings.accuracy_score` | Columns exist; no job and no cron route. |
| Wizard "start from" Scout AI / Experts / Users / blank; "Open my ranking" when one already exists | needs-new-backend | consensus is overall only | Blank works today. |
| Submit sheet → Done → "View in Community" | needs-new-backend | `community` flag off | Rankings aren't published anywhere. |
| "Show on my profile" (has no effect in the prototype) | out-of-scope-or-question | — | |
| Community author ranking `#view-rN`, author card, Follow, "Start my ranking from this" | needs-new-backend | `follows` (user→user), `use-follows.ts` | The prototype keys Follow by ranking id. Recommend following the author. |
| Placeholder counters ("Consensus of 5 experts", "2,418 user rankings", "#2,419 submission", "updated 9:12 AM", follower counts) | needs-new-backend | — | |
| `rank()` engine: position/FLEX filter, weekly bye drop, top 24 (40 for ALL) | new-ui-on-existing-data | `players.bye_week`, `src/utils/positions.ts` | Usable for Users/blank. Experts and Scout AI wait on the backend. |
| Type menu always lists Pre-draft (the README hides it in season) | out-of-scope-or-question | `big-board` | |

### E. Lists data and flows referenced by the frame
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Cover type: collage / upload / video frame | new-ui-on-existing-data | `list-thumbnail.tsx`, `/api/lists/[id]/thumbnail`, `list_links` kind=video (`lib/lists/links-service.ts`) | The YouTube thumbnail can be built from the video id, so no backend call. |
| List colour swatch (6 colours) | needs-new-backend | `POS_TINTS` takes the colour from `position_filter` | No `lists.color` column. In dark mode the t1 swatch turns white. |
| Stats columns + timeframe (Week 5 / Last 3 / Season) saved on the list | out-of-scope-or-question | `src/stores/list-display-store.ts`, `lists/v2/list-stats.ts` | The store is deliberately session-only: D3 ruling, pinned by a test. The spec saves `stats` and `tf` on the list record: needs a ruling. Timeframe totals can be computed from weekly `player_stats` (exists). |
| Add-stats catalogue (25 stats in 6 groups) | needs-new-backend | `STAT_CATALOG` has 7 (adp, auction, proj, current, last, sos, bye); `player_usage` has snap % and target share | Route %, rush share, YAC, aDOT, YPRR, YCO/att and RYOE have no data source. ECR / Scout AI / Users need the ranking backend. |
| Pick sheet: substring or exact team-code search, position chips, Scout AI sort | new-ui-on-existing-data | `/api/players/search` (name ilike, ADP sort, limit 50), `/api/players/builder` | No team-code match; small route tweak. The Scout AI sort waits on the backend. |
| Import a ranking into a list | new-ui-on-existing-data | `/api/lists/[id]/players/bulk` | Importing the user's own boards works now. Experts and Scout AI need the backend. |
| "Edit details" variant (unreachable in the prototype) | out-of-scope-or-question | `list-form-dialog.tsx` mode=edit exists | |
| App features the spec leaves out: AI list generation, folders, side-by-side, comments, likes, drafted marks, visibility, tags, position group / type / roster on create | out-of-scope-or-question | `generate-ai-button.tsx`, `lists-folders.tsx`, `side-by-side-*.tsx`, `list-comments-tab.tsx`, `list-form-dialog.tsx` | CLAUDE.md says AI generation must be kept and restyled. Needs a mobile placement. |

### F. Navigation
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Screen switch = fresh mount at scroll top; no history; hash read once | out-of-scope-or-question | Next routes | Recommend real routes with browser back, instead of the prototype's no-history model. |
| Hash deep links: #lists, #new-list, #mine, #new-ranking, #rankings, #view-rN | new-ui-on-existing-data | `/app/lists`, `/app/lists/new` exist | No Rankings hub, My rankings or New ranking route. `/app/weekly-ranks` is gated by `weeklyRanks`. `#view-` needs community rankings. |
| Inbound links: Profile › My stuff rows, Community create, search, notifications "@user updated" | needs-new-backend | `/app/notifications`, `/api/search/community` | Profile › My stuff doesn't exist. The rows open the grid, not the tapped item (prototype quirk): recommend deep-linking to the item. |
| No in-phone path Rankings → Lists; Lists → Rankings only via dock Profile | out-of-scope-or-question | — | |
| Shipping the Rankings side at launch | out-of-scope-or-question | `feature-flags.ts` (`weeklyRanks`, `bigBoard`, `consensus` off) | Launch scope is Lists + Stats + AI stat lists. |

### G. Theme, states, accessibility
| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Dark mode tokens + stored preference `fieldscout-theme` | new-ui-on-existing-data | `globals.css` `--m-*`, `tailwind.config.ts` `m.*`, `theme-store.ts`, `use-layout-mode.ts` | Tokens and storage are done. There is no toggle UI: the spec only has one in the jump panel; the README puts it on Profile. |
| Copy the spec's hardcoded non-dark colours (POS, TIERC, #07A852 / #FF0028, headshot fill, #4D4D4D ink underline, white l2 cover)? | out-of-scope-or-question | — | Several are low-contrast in dark mode. |
| No hover/pressed/focus states; everything a div; `outline:0` | out-of-scope-or-question | — | Recommend keeping real buttons, aria and focus-visible; nobody sees the difference. The main app has 41 pressed rules: decide whether pressed states apply here too. |
| Animations: only progress width and switch colour; everything else instant | restyle-only | `sheet.tsx`, `toast.tsx` animate 200ms | Remove the motion on mobile, or rule to keep it. |
| Done screen sits about 42px low (dock covers it) | out-of-scope-or-question | — | Prototype quirk: fix or copy? |

**Summary.** Almost nothing of the mobile frame is built yet: only the tokens, the `mob:` variant and the theme store from 27d455b.
- **Lists side:** mostly restyle work or new UI over data the app already has.
- **Exceptions on the Lists side:** list colour, saving stats columns on a list (conflicts with the D3 ruling), the advanced stats catalogue, and Scout AI sorting.
- **Rankings side:** most of it needs new backend. That covers the per type × scoring × position ranking record, Save / Submit / Finalized statuses, grading, Experts and Scout AI rankings, movement history, and publishing rankings to Community.
- **Rankings flags:** the Rankings side is also behind the `weeklyRanks`, `bigBoard` and `consensus` flags (off in production) and outside the launch scope.
- **The frame itself:** these items need a ruling before it can be built — dock tab set and active state, toast and sheet style (the two prototype files disagree), stroke icons vs the filled-only icon rule, autosave vs draft + Save, where the dark-mode toggle lives, and the back target (Profile › My stuff doesn't exist).
