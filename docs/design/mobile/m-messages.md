## Messages, conversations and trade offers in DMs

Source: `design_handoff_fieldscout_mobile/FieldScout Mobile.dc.html`.

**Markup covered**
- Lines 543–581: `isDms`.
- Lines 582–607: `isThread`, including `hasMsg`.
- Line 639: the dock.
- Lines 646–652: the generic sheet shell.
- Lines 717–723: `sheetChat`.
- Lines 832–858: `hasTd`.

**Script covered**
- Data: `TEAMS` (1130), `short` (1129), `MINE` (1145), `BENCH_ME`/`BENCH_THEM` (1213–1214), `PDB`/`pinfo` (1216–1222), `DEPTH` (1224–1231), `rosterOf` (1256), and `CONVOS`/`LEAGUES`/`TRADES`/`CTIME`/`UNREAD0` (1185–1197).
- State: line 1414.
- Helpers: `newTrade`/`openTrade` (1416–1417), `toast` (1623) and `go` / the jump list (1628–1629).
- Handlers: `send`/`cv`/`openConvo`/`thMsgs` (1696–1706), the tab bar (1708–1709) and `openChat` (1747).
- Bindings: the trade builder `tr` (1756–1768), `dmTabs`/`tradeRows` (1778–1781), the team-page `message` (1827), `td` (1828–1838) and the remaining DM bindings (1839–1858).
- The headshot comes from `FSHeadshot.dc.html`. The README is cited where it conflicts (lines 89, 130, 131).

I also rendered the prototype headlessly (Chromium, 390×844 phone frame, Playwright). I measured positions, hit-tested with `elementFromPoint`, and clicked for real. "y" is measured from the top of the 844px phone, and the status bar is y 0–50.

**Token key.** In light mode no `--x-*` variable is defined, so **the inline fallback is the real light value**. This matters for b3: it falls back to `#EBEBEE` in some places and `#E5E5EA` in others, so each fallback is quoted as written.

| token | light | dark (`.fs-dark`) |
|---|---|---|
| t1 | #1D1D1F | #FFFFFF |
| t2 | #3A3A3C | #D9D9D9 |
| t3 | #6E6E73 | #B3B3B3 |
| t4 | #8E8E93 | #A7A7A7 |
| t5 | #AEAEB2 | #727272 |
| b0 | #FFFFFF | #121212 |
| b1 | #F5F5F7 | #282828 |
| b2 | #F2F2F4 | #333333 |
| b3 | #EBEBEE / #E5E5EA | #3E3E3E |
| b4 | #D1D1D6 | #575757 |
| ink | #1D1D1F | #4D4D4D |
| tg / gg | #067A3E / #E3F9EC | #1ED760 / #12301F |
| tr / gr | #C8001C / #FFE9EC | #FF6B6B / #3A1A1D |
| to / go | #B25C00 / #FFF3E6 | #FFB340 / #3A2A14 |
| barA | rgba(29,29,31,.94) | rgba(18,18,18,.92) |

**Rules that apply everywhere in this area**
- **Font:** Inter Display with `font-feature-settings:'tnum' 1,'cv11' 1`, antialiased.
- **Icons:** 16×16 viewBox, `fill:none`, `stroke:currentColor`, round caps.
- **Text inputs:** `border:0; outline:0; background:transparent; font-family:inherit; font-size:15px; font-weight:500; color:t1`.
  - There is **no focus style** (outline is 0) and no clear (×) button.
- **Placeholder colour:** set by global CSS (`input::placeholder{color:#6E6E73}`) and **not** changed in dark mode.
- **Scrollers:** every vertical scroller (`.fsm-scroll[style*="overflow-y"]`) hides its scrollbar and gets a `::after{content:"";display:block;flex:none;height:var(--x-dockpad)}` spacer.
  - The spacer is 84px under `dock-sm` and 150px under `dock-lg`. `dock-lg` is used only when `scr==="league"` and no profile, trade builder or settings is open.
  - The DMs and thread screens are always `dock-sm` (84px).
  - In a **flex** scroller the spacer is a flex item, so the scroller's `gap` is added before it as well as its bottom padding:
    - Thread: 16 padding + 4 gap + 84 = **104px** of blank below the last item. Measured 104 at max scroll.
    - Trade detail: 24 + 20 + 84 = **128px**.
  - The horizontal people row (`overflow-x` only) gets no spacer.

---

### 1. Screens & states

| # | Screen / state | Exact condition |
|---|---|---|
| S1 | **Messages list, "All" tab** (base screen, not an overlay) | `s.scr === "dms"` and `s.dmFilter !== "trades"` (`dmAll`). Default `dmFilter: "all"`. |
| S1a | All tab with a search query | `s.dmQuery` is non-empty. Conversation rows are filtered by name. The people row is **not** filtered. |
| S1b | All tab, no matches | Filter returns 0 rows. The people row still shows and the list is blank. **There is no empty-state copy.** |
| S2 | **Messages list, "Trades" tab** | `s.scr === "dms"` and `s.dmFilter === "trades"` (`dmTrades`). The people row is hidden. |
| S2a | Trade card, incoming pending (actions shown) | `dir === "in"` and status `=== "Pending"` (`actionable`). |
| S2b | Trade card, resolved or outgoing (no actions) | Any other combination. |
| S2c | Trades tab, no matches | Blank. No empty state. |
| S3 | **Conversation (thread)** (base screen) | `s.scr === "thread"`. It shows `s.convo`, or `convos[0]` (the league group) if `convo` is null. The fallback is never reached in practice: every route into the thread sets `convo` (`openConvo(id)`, or jump 17 sets `"marcus"`). |
| S3a | 1:1 thread | `!thc.group`. Round avatar. The sub-line is the team name, prefixed "Active now · " if online. No sender name labels. |
| S3b | Group thread (league message board) | `thc.group` (`id:"league"`). Rounded-square avatar (radius 11px), sub "12 members", and the sender's name above the first bubble of each run. |
| S3c | "Seen" receipt | The last message in the thread has sender `"me"`. |
| S3d | Send button visible | `hasMsg = !!s.msg.trim()`. |
| S4 | **Trade offer detail** (overlay, z-index 23) | `!!s.tradeOpen` (a TRADES id). It sits over whatever screen is underneath. |
| S4a | Incoming pending | `st === "Pending" && dir === "in"`: footer shows Decline / Counter / Accept. |
| S4b | Outgoing pending | `st === "Pending" && dir === "out"`: footer shows "Withdraw offer". **Unreachable.** The sample data has no outgoing pending trade, and nothing can create one: `TRADES` is a `const`, and the builder's send only toasts. |
| S4c | Resolved | `st !== "Pending"`: footer shows a centred message. |
| S4d | Usernames hidden | `s.tdHide === true`. Global, defaults to false, and persists across offers. |
| S5 | **League chat sheet** (bottom sheet, z-index 20) | `s.sheet === "chat"`, title "League chat". **There is no UI entry point.** The only code that sets it is `go(scr, tab, "chat")` (line 1628: `if (sub === "chat") o.sheet = "chat"`), and no JUMPS row passes `"chat"`. No markup or Menu item sets it. `openChat` (line 1747) does **not** open this sheet: it is an unbound DMs entry, `set({scr:"dms", sheet:null, prevScr:s.scr})`. |
| S6 | DM badge on the header chat icon (Home and League headers) | `hasDmBadge = dmCount > 0`, where `dmCount` is the number of truthy values in `s.unread`. Initially 3 (`{league, marcus, nina}`). |
| S7 | "Trades" segment count badge | `n > 0`, where n is the number of TRADES whose status (`s.tradeStatus[id] ‖ t[4]`) is `"Pending"`. Initially 2. It ignores the search query. |

---

### 2. Layout (top to bottom)

#### 2.1 Messages list (S1/S2): `isDms`
The screen is a flex column inside the 390×844 phone, below the 50px status bar.

**A. Header row** (y 50–102)
- Container: `height:52px; display:flex; align-items:center; gap:8px; padding:0 12px`.
- **Back pill** (measured 66×36 at x12): `height:36px; padding:0 8px 0 4px; gap:2px; border-radius:999px; color:#0088FF` (accent). The text "Back" is 15px/500.
  - Chevron: 18×18, path `M10 3L5 8l5 5`, stroke-width 2, round caps and joins.
  - Pressed: `background:b2 (#F2F2F4)`.
- Spacer: `flex:1`.
- **Compose button** (x340): 38×38 circle with a centred 20×20 icon, colour t1, stroke 1.5.
  - Pencil path: `M11 2.5l2.5 2.5L6 12.5H3.5V10zM9.5 4l2.5 2.5`.
  - Pressed: b2.

**B. Title, search and segmented control** (y 102–240). Wrapper: `flex:none; padding:0 16px 10px`.
- **"Messages"** title: 28px/600, letter-spacing -0.03em, `padding-bottom:10px`. The block is 44px tall (y 102–146).
- **Search field** (y 146–184): `height:38px; display:flex; align-items:center; gap:8px; padding:0 12px; border-radius:12px; background:b2 (#F2F2F4)`.
  - Magnifier: 15×15, colour t4 (#8E8E93), stroke 1.8, round caps. Shapes: `<circle cx=7 cy=7 r=4.8>` and path `M10.6 10.6L14 14`.
  - Input: `flex:1; min-width:0`, 15px/500, t1, placeholder **"Search"**. No clear button.
- **Segmented control** (y 194–230; measured segments 176×32 at x18 and x196, y196): `margin-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:2px; padding:2px; border-radius:10px; background:b2 (#F2F2F4)`.
  - Each segment: `height:32px; border-radius:8px; flex centred; gap:6px; 13px/600`.
  - On: `color:t1; background:b0 (#fff); box-shadow:0 1px 2px rgba(0,0,0,.12)`.
  - Off: `color:t3 (#6E6E73); background:transparent; box-shadow:none`.
  - Labels: **"All"** and **"Trades"**.
  - Trades badge (only when n>0, whether the segment is on or off): `min-width:18px; height:18px; padding:0 5px; border-radius:999px; 10px/600; color:#fff; background:#0088FF`. Text is n, e.g. "2".

**C. People row** (All tab only, y 240–327)
- Container: `.fsm-scroll`, horizontal scroll, scrollbar hidden; `flex:none; display:flex; gap:14px; overflow-x:auto; padding:4px 16px 12px`.
- Item: `flex:none; width:58px; flex-direction:column; align-items:center; gap:5px`.
  - Avatar: 52×52 circle on the manager colour, initial 17px/600 #fff.
  - Online dot (if online): `position:absolute; right:1px; bottom:1px; 13×13; border-radius:50%; background:#07B85A; box-shadow:0 0 0 2.5px b0 (#fff)`.
  - Name: 11px/500, t2 (#3A3A3C), nowrap, ellipsis, `max-width:58px`.
- Six items: Marcus, Priya, Leo, Nina, Devin, Raj. The 6th starts at x376, so it is clipped by the screen edge and reached by scrolling sideways.
- No pressed state.

**D. Scroller** (y 327 to bottom): `.fsm-scroll; flex:1; min-height:0; overflow-y:auto`, with an 84px `::after` spacer.
- **It is one element shared by both tabs** (line 557). On All it holds the conversation rows, and on Trades it holds the trade cards, so **the scroll offset carries across a segment switch**.
- All tab: content 7×72 + 84 = 588 against a client height of 517, so the maximum scroll is 71.
- Trades tab: the people row is hidden, so the scroller is y 240–844. Content is 702 against a client height of 604, so the maximum scroll is 98.
- Measured: with All scrolled to 71, switching to Trades gave `scrollTop` 98. The Trades list opened scrolled to the bottom.

**E. Conversation row** (All tab). Each row is 72px. Rows start at y 327, 399, 471, 543, 615, 687 and 759. **There are no dividers.**
- Row: `height:72px; display:flex; align-items:center; gap:12px; padding:0 16px`. Pressed: `background:b1 (#F5F5F7)`.
- Avatar: 52×52 with initials 16px/600 #fff on the avatar colour.
  - Radius: `16px` for the group, `50%` for people.
  - Online dot: same as in the people row (13px, right 1 / bottom 1, 2.5px b0 ring).
- Text column: `flex:1; min-width:0; flex-direction:column; gap:3px`.
  - Name: 15px, weight **600 if unread, else 500**, colour inherits t1, ellipsis (19px line).
  - Preview line: 13px, weight 600 if unread else 500, colour t1 if unread else t3 (#6E6E73), one line with ellipsis (16px line).
    - Text is `"{preview} · {time}"`.
    - The time is part of the same string, so a long preview truncates the time too.
- Unread dot: `10×10; flex:none; border-radius:50%; background:#0088FF`. Right edge sits at x 364–374.

**F. Trade card** (Trades tab)
- List wrapper: `display:flex; flex-direction:column; gap:8px; padding:4px 16px 20px`.
- Card: `padding:12px; border-radius:16px; box-shadow:inset 0 0 0 1px b3 (#EBEBEE); flex column; gap:10px; cursor:pointer`. Pressed: b1.
- Measured heights:
  - Marcus: y 244–422 (178px; two "get" lines plus actions).
  - Nina: 430–590 (160px).
  - Devin: 598–714 (116px).
  - Leo: 722–838 (116px).
- **Header row** (36px): `flex; align-items:center; gap:10px`.
  - Avatar: 36×36 circle, 13px/600 #fff.
  - Text column (gap 1px):
    - Name: 14px/600, ellipsis (the manager's display name, e.g. "Marcus").
    - Sub: 11px/500, t3, ellipsis, `"{Sent to you | You sent} · {time}"`.
  - Status pill: `flex:none; height:22px; padding:0 9px; border-radius:999px; 11px/600`.
    - Pending: `to #B25C00` on `go #FFF3E6`.
    - Accepted: `tg #067A3E` on `gg #E3F9EC`.
    - Declined: `tr #C8001C` on `gr #FFE9EC`.
- **Assets grid**: `grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:8px`.
  - Each box: `padding:8px 10px; border-radius:10px; background:b1 (#F5F5F7); flex column; gap:2px; min-width:0`.
  - Left box label: **"You get"**, 10px/600, **#07A852**.
  - Right box label: **"You give"**, 10px/600, **#FF0028**.
  - Each asset is its own line: 13px/600, nowrap, ellipsis, full name (e.g. "Darnell Mooney", "2026 3rd round pick").
- **Action row** (S2a only): `grid 1fr 1fr 1fr; gap:6px`.
  - Buttons: `height:34px; border-radius:999px; 13px/600`. They have **no pressed state and no `cursor:pointer`**.
  - **Decline**: tr (#C8001C) on gr (#FFE9EC).
  - **Counter**: t1 on b2 (#F2F2F4).
  - **Accept**: #fff on #07B85A.

#### 2.2 Conversation: `isThread`

**A. Header** (y 50–106): `height:56px; flex; align-items:center; gap:10px; padding:0 12px; border-bottom:1px solid b3 (#EBEBEE)`.
- **Back**: 36×36 circle with no label, colour #0088FF, 20×20 chevron `M10 3L5 8l5 5` at stroke 2. Pressed: b2.
- **Avatar**: 36×36, initials 13px/600 #fff. **Not tappable** (no onClick).
  - Radius: `11px` for the group, `50%` otherwise.
  - Online dot: `right:0; bottom:0; 10×10; #07B85A; box-shadow:0 0 0 2px b0 (#fff)`.
- **Title column** (`flex:1; min-width:0; gap:1px`). **Not tappable**, so a thread has no route to the team page or to a trade.
  - Name: 15px/600, ellipsis.
  - Sub: 11.5px/500, t3, with **no nowrap or ellipsis**, so a long team name wraps to a second line instead of truncating. Values:
    - "12 members" (group).
    - "Active now · {team name}" (online).
    - "{team name}" (offline).
- **Info button**: 36×36 circle; icon 19×19, t1, stroke 1.5, `<circle cx=8 cy=8 r=6>` plus path `M8 7.2v4M8 5h.01`. Pressed: b2.

**B. Message scroller** (y 106–785, client height 679): `.fsm-scroll; flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:4px; padding:16px 12px`, plus the 84px spacer.
- Content is **top-anchored**, and nothing auto-scrolls. After 16 sends, `scrollTop` stayed 0.
- At max scroll there are 104px of blank below "Seen" (16 + 4 + 84). The scroller's bottom 21px (y 764–785) is also under the dock.
- **"Today"** separator: `align-self:center; 11px/500; t3; padding-bottom:8px` (y 122–144).
  - It is **hard-coded on every thread**, including Devin's (CTIME "Tue") and Raj's ("Mon").
  - Messages have no per-message timestamps.
- **Message row** (one per message):
  - Row: `display:flex; align-items:flex-end; gap:6px`.
    - `justify-content`: `flex-start` for them, `flex-end` for me.
    - `margin-top`: 8px if this is the first message of a sender run and not index 0, else 0.
  - Avatar slot (them only):
    - Last message of a run: 26×26 circle with the sender name's initial (`m[0][0]`) at 10px/600 #fff, on `TEAMS[senderIndex].av`.
    - Otherwise: an empty 26px-wide spacer, so the bubbles stay aligned.
    - My messages have no avatar and no spacer.
  - Bubble column: `max-width:74%` of the row. The row is 366px, so the column is at most about 271px. `flex column; gap:2px; align-items:flex-start|flex-end`.
  - Sender label (group thread, them, first of a run only): 11px/500, t3, `padding:0 10px`.
  - **Bubble**: `padding:9px 13px; 15px/500; line-height:1.35; text-wrap:pretty`. A single line is 38px tall.
    - Mine: `background:#0088FF; color:#fff`.
    - Theirs: `background:b2 (#F2F2F4); color:t1`.
  - Bubble corner radius depends only on whether the bubble is the last of its run (CSS order TL TR BR BL):

    | Sender | Last of run | Not last of run |
    |---|---|---|
    | Me | `18px 18px 6px 18px` | `18px 6px 6px 18px` |
    | Them | `18px 18px 18px 6px` | `6px 18px 18px 6px` |

    So in a run of their messages, every bubble except the last has a 6px top-left corner, and the last one has an 18px top-left corner.
- **"Seen"** (S3c): `align-self:flex-end; 11px/500; t3; padding:2px 4px 0`, placed after the last bubble.

**C. Composer**: `flex:none; flex; align-items:center; gap:8px; padding:8px 12px 10px; border-top:1px solid b3 (#EBEBEE)`. Total height 59px (y 785–844).
- **"+" button** (x 12–48, y 796–832): 36×36 circle, `background:b2 (#F2F2F4); cursor:pointer`.
  - Icon: 16×16, t1, stroke 1.8, path `M8 3v10M3 8h10`.
  - No pressed state.
- **Input pill** (x 56–378, y 794–834): `flex:1; height:40px; padding:0 6px 0 14px; border-radius:999px; box-shadow:inset 0 0 0 1px b3 (#E5E5EA)`. The input is 15px/500 with placeholder **"Message"**.
- **Send pill** (S3d only), inside the input pill on the right (measured x 317–372, y 799–829): `height:30px; padding:0 12px; border-radius:999px; background:#0088FF; color:#fff; 13px/600; cursor:pointer`, text **"Send"**.
- ⚠ **As built, the composer is completely covered by the tab bar**, and taps there go to the bar.
  - The bar is z-index 4 at y 764–844, with `margin-top:-80px`.
  - Only a faint "+" and "Message" show through the translucent bar.
  - Hit-testing (`elementFromPoint` plus a real click). Tab items are y 770–818:
    - Match: x 8–83.
    - Team: x 83–158.
    - Players: x 158–232.
    - League: x 232–307.
    - Menu: x 307–382.
  - Below y 818, and at x <8 or >382, taps land on the bar container, which has no handler, so they do nothing.
  - What each composer area does when tapped:
    - "+" (y 796–818) → **Match**, which navigates to League › Match (verified).
    - Input pill → x 56–83 Match, then Team, Players and League, and x 307–378 Menu.
    - Send pill → **Menu**, which toggles the Menu sheet.
  - As built, the input cannot be focused by tapping. **The only way to send in the thread is to focus the input from the keyboard (Tab) and press Enter.**

#### 2.3 Trade offer detail: `hasTd` (as reached from DMs or notifications)
Overlay: `position:absolute; left:0; right:0; top:50px; bottom:0; z-index:23; flex column; background:b0`. It starts below the status bar and covers the dock.

**A. Header** (y 50–102): `height:52px; flex; justify-content:space-between; padding:0 12px`.
- **Close**: 36×36 circle, colour t1, 16×16 icon `M4 4l8 8M12 4l-8 8` at stroke 2.2. Pressed: b2.
- **League chip** (right): `flex; gap:6px; 11px/600; t3`.
  - Square: 20×20, `border-radius:6px`, 9px/600. Background is `LEAGUES[s.lg].av` and text is `LEAGUES[s.lg].ini`.
  - **The text colour is hard-coded `#fff`**, so `LEAGUES.avFg` is ignored.
  - Chip text: `LEAGUES[s.lg].sub`, the format line rather than the league name.
  - It **follows the selected league**, although the trade itself does not change:

    | `s.lg` | Square | Text |
    |---|---|---|
    | 0 | "SF" on ink #1D1D1F | "12-team standard" |
    | 1 | "FB" on #ECAD48, white text (the intended `avFg` is #1D1D1F) | "10-team standard" |
    | 2 | "JU" on #9D70E9 | "12-team PPR" |
    | 3 | "WL" on #5C7CE5 | "10-team half PPR" |

  - The chip does not react to "Hide usernames".

**B. Scroller** (y 102–755, height 653): `padding:4px 16px 24px; flex column; gap:20px`, plus the 84px spacer.
- Because the spacer is a flex item, there are 24 + 20 + 84 = 128px of content below "Message @marcus".
- With Marcus's offer the content ends at about y 744, so it still fits the 653px scroller and nothing scrolls. The extra space only appears with longer offers.
- **Title block** (gap 2, y 106–154):
  - **"Trade offer"**: 26px/700, letter-spacing -0.03em.
  - Sub: 12px/500, t3, format `"{Sent to you | You sent} {time}"`, plus `" · expires in 2 days"` when Pending.
    - Example: "Sent to you 8m · expires in 2 days".
    - There is no dot between the direction and the time.
- **Side block ×2**: me first, then the other manager. Column gap 8. Side 1 is y 174–337 and side 2 is y 357–520.
  - **Head row** (31px; 28px when usernames are hidden): `flex; align-items:center; gap:8px`.
    - Avatar: 28×28 circle, 11px/600 #fff.
    - Name/team column:
      - Name: 14px/600, ellipsis, tappable. Me = **"@dalton"**; them = the manager handle, e.g. **"@marcus"**.
      - Team: 11px/500, t3, ellipsis. Me = `s.myName` ("Touchdown Tacos"); them = the team name ("Gridiron Gurus").
    - Status pill: `flex:none; height:24px; padding:0 10px; border-radius:999px; gap:5px; 11px/600`, with an 11×11 icon at stroke 2.2.

      | Status | Colours | Icon |
      |---|---|---|
      | **"Pending"** | `to` on `go` | clock `M8 4v4l2.5 1.5M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z` |
      | **"Sent offer"** | `tg` on `gg` | check `M3 8.5l3.2 3L13 4.5` |
      | **"Accepted"** | `tg` on `gg` | check |
      | **"Declined"** | `tr` on `gr` | X `M4 4l8 8M12 4l-8 8` |

      Which pill each side shows:
      - Incoming pending: me = Pending, them = Sent offer.
      - Outgoing pending: me = Sent offer, them = Pending.
      - Resolved: both sides show Accepted, or both show Declined.
  - **Asset card**: `grid minmax(0,1fr) minmax(0,1fr); border-radius:14px; background:b1 (#F5F5F7); overflow:hidden`.
    - Left column: `padding:10px 12px 12px; flex column; gap:8px; border-right:1px solid b3 (#E5E5EA)`, label **"Receives"** at 11px/600 #07A852.
    - Right column: same padding with no border, label **"Sends"** at 11px/600 #FF0028.
    - Me: Receives = `gets`, Sends = `gives`. Them: the reverse.
  - **Asset row**: `flex; align-items:center; gap:8px; min-width:0; cursor:pointer`.
    - Player: `FSHeadshot` at size 36 (`FSHeadshot.dc.html`):
      - Container: 36×36 circle, `overflow:hidden; background:#EEEEF1`, `title` = the player's full name.
      - Photo: `position:absolute; inset:0; object-fit:cover; object-position:50% 15%; transform:scale(1.25) translateY(8%)`, `alt` = name. On load error it falls back to initials.
      - Ring with a known team: `box-shadow:0 0 0 1px #fff, 0 0 0 3px {TC[team]}`. The ring width is 2px at size ≥32 (1.5px below that), after a 1px white gap.
      - Ring with an unknown team (e.g. "FA"): `inset 0 0 0 1px rgba(0,0,0,.04)` (a hairline, not "no ring").
      - Initials: font-size `max(9, round(size×.36))` = 13px, 700, #6E6E73.
        - Rule: strip a trailing " D/ST", split on spaces, apostrophes and hyphens, then take the first letter of the first part plus the first letter of the last part, uppercased.
    - Pick: 36×36 circle, `background:b3 (#E5E5EA)`, with a 16×16 calendar icon in t2 at stroke 1.5: `M3 4.5h10v8.5H3zM3 7.5h10M6 3v3M10 3v3`.
    - Text column (gap 1):
      - Name: 13px/600, ellipsis.
        - Player: short form, e.g. "D. Mooney".
        - Pick: `name.replace(" round pick"," round")`, e.g. "2026 3rd round".
      - Meta: 10px/600, nowrap.
        - Player: "WR · ATL" in the position text colour.
        - Pick: "Draft pick" in t3.
- **Hide toggle row** (y 540–564; 534–558 when hidden): the whole row is tappable; `flex; align-items:center; justify-content:flex-end; gap:10px; cursor:pointer`.
  - Label **"Hide usernames for screenshots"**: 12px/500, t3, right-aligned.
  - Switch: `40×24; border-radius:999px; padding:2px; box-sizing:border-box`.
    - Background: `#07B85A` when on, `b3 (#E5E5EA)` when off, with `transition:background .2s linear`.
    - The knob sits at the start or end. Only `justify-content` changes, so the knob does not slide.
  - Knob: 20×20 circle in b0, `box-shadow:0 1px 2px rgba(0,0,0,.2)`.
- **Message pill** (measured 158×32 at x16, y 584–616; y 578 when hidden): `align-self:flex-start; height:32px; padding:0 12px; border-radius:999px; gap:6px; 13px/600; t1 on b2 (#F2F2F4); cursor:pointer`.
  - Icon: 13×13 chat bubble at stroke 1.6, `M8 13.5c3.3 0 6-2.4 6-5.5S11.3 2.5 8 2.5 2 4.9 2 8c0 1.2.4 2.3 1.1 3.2L2.5 13.8l2.9-.9c.8.4 1.7.6 2.6.6z`.
  - Label: **"Message {tm.mgr}"**, e.g. "Message @marcus". It is **always the real handle, even with usernames hidden**.

**C. Footer** (`flex:none`, border-top `1px solid b3 (#EBEBEE)`, y 755–844). Buttons have `cursor:pointer` and no pressed state.
- S4a: `grid 1fr 1fr 1fr; gap:8px; padding:12px 16px 28px`. Buttons are `height:48px; border-radius:999px; 15px/600`:
  - **Decline**: tr on gr.
  - **Counter**: t1 on b2.
  - **Accept**: #fff on #07B85A.
- S4b: `padding:12px 16px 28px` with one full-width 48px button **"Withdraw offer"** (tr on gr).
- S4c: `padding:14px 16px 30px; text-align:center; 13px/600`. Text and colour:
  - Accepted: **"Trade accepted · players move after the review period"** in #07A852.
  - Declined: **"This offer was declined"** in t3. This also shows for a withdrawn offer.

#### 2.4 League chat sheet (S5): `sheetChat`
- **Scrim**: `position:absolute; inset:0; z-index:20; background:rgba(0,0,0,.32); flex; align-items:flex-end`.
  - Its parent is the 390×844 phone root, so **the scrim also covers the 50px status bar** (verified with the Menu sheet: the scrim is y 0–844). Full-screen overlays start at `top:50px` instead.
  - ⚠ The README (line 130) says the backdrop is `rgba(0,0,0,.4)`. The code uses .32.
- **Sheet**: `width:100%; max-height:86%; flex column; border-radius:24px 24px 0 0; background:b0; padding:8px 0 30px`.
- **Grab handle**: wrapper `padding:2px 0 8px`, bar 36×5, `border-radius:999px; background:b4 (#D1D1D6)`.
- **Title row**: `padding:4px 16px 12px 20px`, **"League chat"** at 19px/600, letter-spacing -0.02em. No close button (that only exists on the league-switcher sheet).
- **Body scroller** (generic sheet scroller, line 652): `.fsm-scroll; flex:1; min-height:0; overflow-y:auto` **only**. It has no flex, gap or padding.
- **Message list** (inner div, line 718): `display:flex; flex-direction:column; gap:14px; padding:0 20px 12px`.
  - The `::after` spacer follows this div, so the blank space under the last message is 12 + 84 = **96px** on dock-sm screens.
  - It would be 12 + 150 = **162px** if the sheet were opened while `scr==="league"` (dock-lg).
  - Each message is `flex; gap:10px`:
    - Avatar: 30×30 circle with the initial `who[0]` at 11px/600 #fff. Background is `TEAMS[i].av`, or t5 (#AEAEB2) for system rows.
    - Text column (gap 3, `min-width:0`):
      - First line: `"{who} "` at 12.5px/600, followed by the time at weight 500 in t3.
      - Body: 14px/500, `line-height:1.4`, `text-wrap:pretty`. Colour t1, or t3 for system rows.
- **Composer**: `flex:none; padding:8px 16px 0`.
  - Pill: `height:44px; padding:0 6px 0 16px; border-radius:999px; background:b2; gap:6px`.
  - Input placeholder: **"Message the league"**.
  - Send button (always visible): 34×34 circle #0088FF with a 14×14 white arrow `M8 13V3M3.5 7.5L8 3l4.5 4.5` at stroke 2.2.

#### 2.5 Entry badge on the header chat icon (Home line 53, League header line 241)
- Button: 38×38 circle, pressed b2.
- Icon: 20×20 chat bubble (path above), stroke 1.5, t1.
- Badge: `position:absolute; top:4px; right:4px; min-width:16px; height:16px; padding:0 4px; border-radius:999px; background:#0088FF; color:#fff; 10px/600; box-shadow:0 0 0 2px b0`. Text = `dmCount`.
- The red notification badge on the neighbouring bell belongs to a separate area.

#### 2.6 Toast (used by every action here)
- `position:absolute; left:50%; bottom:100px; translateX(-50%); z-index:30; height:36px; padding:0 16px; border-radius:999px; background:ink; color:#fff; 13px/500; nowrap`.
- Auto-dismisses after **1800ms** (line 1623). A new toast replaces the old one and restarts the timer.
- ⚠ The README (line 131) says "auto-dismiss after about 2.2s".

---

### 3. Interactions

**Messages list**
- **Back pill** (`backFromDms`): `scr = s.prevScr || "league"`. Only the screen changes; the league `tab` and other state stay as they were. For when `prevScr` is stale, see §4.
- **Compose (pencil)**: toast "Not part of this prototype". No new-message flow exists.
- **Search input** (`onDmQuery`): `dmQuery = value`. Filtering is live, case-insensitive substring matching with **no trimming**.
  - All tab: matches the conversation display name only ("Sunday Funday League", "Marcus", …), not message text. A single space leaves only "Sunday Funday League", the only name containing a space (verified).
  - Trades tab: the text searched is `c.name + gets.join(" ") + gives.join(" ")` with **no separator between the three parts**.
    - Marcus's string is "MarcusDarnell Mooney 2026 3rd round pickJames Conner".
    - "mooney" and "sdarn" match. "marcus darnell" does not.
    - It matches the display name, so "@marcus" matches nothing (all verified).
  - The people row ignores the query.
  - The Trades segment badge keeps counting all Pending trades regardless of the query (verified with "zzz": still "2").
  - The query persists for the session and is never reset, not even by jump 16.
- **Segment tap**: `dmFilter = "all" | "trades"`. It persists across visits and switches instantly (no animation). The scroll offset is shared (§2.1 D).
- **People avatar or conversation row** → `openConvo(id)`: `scr:"thread", convo:id, unread[id]:false, msg:""`.
  - This clears the unread dot, decrements the header badge and discards any composer draft.
  - It does **not** set `prevScr`.
- **Trade card body** → `tradeOpen = id`, which opens S4 over the list.
- **Trade card Accept**: `stopPropagation`; `tradeStatus[id] = "Accepted"`; toast **"Trade accepted with Marcus"** (the display name).
  - The card stays in place, the pill turns green and the actions disappear.
  - The Trades badge count decrements and hides at 0.
- **Trade card Decline**: `stopPropagation`; status becomes `"Declined"`; toast **"Trade declined"**.
- **Trade card Counter**: `stopPropagation`; `openTrade(c.ti || 1, [])`.
  - This opens the trade builder (z-index 24, "Propose a trade") with that manager as the opponent.
  - **Nothing is pre-selected**: `mine:[]`, `theirs:[]`, `exp:"Never"`, `dm:true`, `hide:false`, `review:false`.
  - The status is not changed.

**Conversation**
- **Back**: `goDms`. Sets `scr:"dms"`; `prevScr` is kept because the current screen is a messaging screen.
- **Info (i)** and **"+"**: toast "Not part of this prototype". As built, the "+" toast cannot fire, because the tab bar intercepts the tap (§2.2 C).
- **Avatar and name in the header**: not tappable.
- **Typing** (`onMsg`): `msg = value`. The Send pill appears as soon as `msg.trim()` is non-empty.
- **Send** (Send pill tap, or the Enter key in the input):
  - `onMsgKey` fires on **any** Enter keydown, with no `isComposing` or Shift check.
  - If `msg.trim()` is empty, or `s.convo` is null, nothing happens.
  - Otherwise `["me", 0, text]` is appended to `threads[convo]` and `msg` is cleared. Effects:
    - The blue bubble appears at the end, the previous bubble's corner shape is recomputed, and "Seen" appears under it.
    - There is no auto-scroll. A message sent below the fold stays out of view (verified).
    - In the list, that row's preview becomes `"You: {text} · now"`. Any session message makes the time "now".
    - The **row order does not change**.
    - Session messages persist in memory only.
- ⚠ As built, a tap can neither focus the input nor hit Send (§2.2 C). The only working path is keyboard focus plus Enter.
- There is no swipe, long-press or reaction on bubbles.

**Trade detail**
- **Close (X)**: `tradeOpen:null`, which returns to the screen underneath. The Trades tab is still selected if you came from it.
- **Other manager's name** → `tradeOpen:null`, then `openTeam(c.ti || 1)` (`teamView = ti`).
  - This opens that team's page overlay (z-index 21) over the current screen.
  - The team page's back (`tv.close`, `teamView:null`) returns to the screen underneath (the Messages Trades tab or Notifications), **not** to the offer.
  - Your own name (`me.open`) does nothing.
- **Player asset** → `openProf(name)`. ⚠ The profile is z-index 22, below this overlay (z-index 23), so it is set **invisibly**. It shows up on **every** exit from the detail (all verified in render):
  - Close → the profile is over the list.
  - Accept, Decline or Withdraw → the detail closes and the profile shows over the list or Notifications.
  - Message @{mgr} → the profile **covers the new thread**.
  - Other manager's name → the team page (z21) opens **underneath** the profile (z22), so the user sees the player profile, not the team.
  - Counter → the builder (z24) covers it. Closing the builder with X reveals the profile, while the builder's "Send trade proposal" clears it (`prof:null`).
- **Pick asset**: no-op.
- **Hide usernames row**: toggles `tdHide`. When hidden:
  - Me: name "Team 1", team line "", avatar text "1".
  - Them: name "Team 2", team line "", avatar text "2".
  - Avatar colours stay.
  - **"Message @marcus" still shows the handle**, and the league chip is unchanged.
  - Layout shift: the emptied team line collapses each head row from 31px to 28px (the avatar height), and the name becomes vertically centred.
    - Measured: "@dalton" at y174 becomes "Team 1" at y180.
    - Side 2 moves up 3px (its name goes from y357 to y360, centred).
    - The toggle row and Message pill move up 6px.
- **Message {mgr}** → `tradeOpen:null`, then `openConvo(id)`, landing in that manager's thread. `prevScr` is not changed (see §4).
- **Accept** → status Accepted, the detail closes, toast **"Trade accepted with @marcus"** (the handle, unlike the card's "Marcus").
- **Decline** → status Declined, the detail closes, toast **"Trade declined"**.
- **Withdraw offer** → status is set to **"Declined"** (there is no "Withdrawn" state), the detail closes, toast **"Offer withdrawn"**. If reopened, the offer shows red "Declined" pills and "This offer was declined".
- **Counter** → `tradeOpen:null`, and the builder opens **pre-filled**: `newTrade(c.ti || 1, theirs = gets minus picks, mine = gives minus picks)`.
  - Marcus's offer gives `theirs:["Darnell Mooney"]` and `mine:["James Conner"]`. Both tiles show checked (verified).
  - Picks are dropped silently. Marcus's "2026 3rd round pick" is removed, and the builder has no pick support at all: tiles come from the rosters only.
  - Nina's offer gives `newTrade(7, ["Jake Bates"], ["Cairo Santos"])`:
    - Bates is on **your** roster, so he sits in `theirs` but his tile appears unchecked in your column.
    - Santos is on no roster, so he has no tile at all.
    - Even so, the builder shows the count badge "2" and "1 for 1", with nothing visibly selected (verified).
  - **Builder X** (`set({trade:null})`) lands on the screen underneath (the Messages Trades tab or Notifications), not back on the offer.
  - **Builder "Send trade proposal"** runs `set({trade:null, prof:null})` and toasts "Trade proposal sent to @marcus".
    - The original offer stays Pending.
    - No card is added to the Trades tab and nothing is posted to the thread.
- The only animation is the switch background (.2s linear). Overlays appear and disappear instantly.

**League chat sheet** (unreachable; see S5)
- Tapping the scrim calls `closeSheet` (`sheet:null`). Taps inside the sheet are stopped with `stopPropagation`.
- The send circle and the Enter key call the same `send()`. ⚠ That appends to `threads[s.convo]` (the last opened DM), **not** to `s.chat`. With `convo` null it does nothing.
- There is only one `msg` state, shared with the thread composer.

**Other entry points**
- **Header chat icon** (`goDms`): `scr:"dms", sheet:null, prevScr: (current scr is dms/thread/notifs) ? keep : current scr`.
  - It does not close player-profile, trade or team overlays, but those cover the header anyway.
- **Another team's page, "Message" button** (line 736): 44px pill, t1 on b2, 15px chat icon.
  - If CONVOS has that team (ti 1, 2, 3, 6, 7, 11) → `teamView:null` plus `openConvo` (which does not set `prevScr`).
  - Otherwise → toast **"New message to @sam"** (or @tara, @chris, @owen, @maya). No new thread is created.
- **Notification "Trade offer from Marcus"** → `tradeOpen:"marcus"` over the Notifications screen.
- **Trade builder toggle** "Send a direct message / Notify @marcus in your messages" (default on): sending only toasts "Trade proposal sent to @marcus". Nothing is posted to a thread.
- **`openChat`** (line 1747, `set({scr:"dms", sheet:null, prevScr:s.scr})`): defined but bound nowhere. Unlike `goDms`, it would always overwrite `prevScr`.

**Pressed states (`style-active`)**
- b2: DMs Back pill, compose button, thread back, thread info, trade-detail close.
- b1: conversation row, trade card.
- No pressed state: trade-card action buttons (which also lack `cursor:pointer`), Send, "+", people-row items, trade-detail footer buttons, the hide row and the Message pill.

---

### 4. Navigation

**How you arrive**
- Home header chat icon (`goDms`, prevScr = "home").
- League header chat icon (`goDms`, prevScr = "league"; the league tab is kept).
- Another team's page → Message → thread directly (`openConvo`; prevScr untouched).
- Trade detail → Message → thread (`openConvo`; prevScr untouched).
- Notifications → trade offer → trade detail over Notifications.

**Back behaviour**
- Thread back always goes to the Messages list (`goDms`, keeping prevScr).
- Messages Back goes to `s.prevScr || "league"`. **Only `goDms` and `goNotifs` record `prevScr`**, and only when you come from a non-messaging screen.
  - `openConvo`, the jump panel's `go()` and the unbound `openChat` do not record it (`openChat` would).
  - The initial value is `"league"`.
- So a thread entered from a team page or from the trade detail goes Back → Messages → Back to a **stale** `prevScr`.
  - Verified chain: Home → chat icon (prevScr = home) → Back (Home) → League › standings → "Priya's Punters" team page → Message → thread → Back → Messages → Back lands on **Home**, not the league screen.
- Notifications use the same `prevScr` logic. Notifications → trade → Message → thread → Back → Messages list → Back returns to the screen before Notifications.
- There is no deeper history stack.
- Closing anything opened from the trade detail (team page, builder) returns to the screen under the detail, never to the detail.

**Bottom dock on the list and thread screens**
- `inLg` is true for every screen except home/community/me, so these screens **always show the league tab bar**, even when you came from Home: **Match, Team, Players, League, Menu**.
- Tab bar: 80px, `padding:6px 8px 0`, `background:barA rgba(29,29,31,.94)`, z-index 4, `margin-top:-80px`. It overlays the bottom 80px of the screen (measured y 764–844), which covers the thread composer (§2.2 C).
- Tab items: `flex:1; height:48px; column; gap:3px`; 22×22 icon at stroke 1.5; label 10px/600. Measured 75px wide, at y 770–818.
- Icons:
  - Match: `M2.5 4.5h4v7h-4zM9.5 4.5h4v7h-4zM8 3v10`
  - Team: `ICON.players`
  - Players: `ICON.search`
  - League: `ICON.leaders`
  - Menu: `M2.5 4h11M2.5 8h11M2.5 12h11`
- **No tab is highlighted.** All are #A1A1A6, because "on" requires `scr === "league"` (verified). Menu turns #fff only while the menu sheet is open.
- Tapping Match, Team, Players or League leaves messaging (`scr:"league", tab:v, sheet:null, swap:null`). The `msg` draft stays in state until the next `openConvo`.
- Menu toggles the menu sheet over the current messaging screen.
- There is no league switcher card (`showSwitcher` requires `scr === "league"`).
- The dock class is `dock-sm`, so scrollers get an 84px bottom spacer.
- Home indicator: 134×5 bar in b0 at `bottom:8px`.

**Trade detail and sheets**
- The trade detail runs from top 50 to bottom 0, covering the dock but not the status bar.
- Sheets (z-index 20) use `inset:0`, covering the status bar and the dock.

**Stacking order (z-index)**

| z-index | Layer | Extent |
|---|---|---|
| — | Base screens (list, thread) in normal flow | below the status bar |
| 4 | Dock | y 764–844 |
| 20 | Sheet scrim (League chat / Menu) | `inset:0`, **including the status bar** |
| 21 | Another team's page | `top:50px` to the bottom |
| 22 | Player profile | `top:50px` to the bottom |
| 23 | Trade detail (and settings) | `top:50px` to the bottom |
| 24 | Trade builder | `top:50px` to the bottom |
| 25–29 | Other overlays | — |
| 30 | Toast | pill |

Consequences of this order in this area:
- A profile opened from the trade detail is hidden until the detail closes.
- A team page opened from the detail while a profile is pending sits under that profile.

**Prototype-only shortcuts** (left-hand jump panel, `go()`, line 1628)
- `go()` always resets `sheet, prof, trade, settings, tradeOpen, teamView` and **never sets `prevScr`**.
- **16 "Messages"**: list screen; closes all overlays.
  - Does **not** reset `dmFilter` or `dmQuery`, so it can reopen on the Trades tab with an old query.
  - Stays highlighted while a trade detail is open, because `tradeOpen` is not part of its on-test.
- **17 "Conversation"**: thread with `convo:"marcus"`.
  - Does **not** clear unread or `msg`.
  - After sending, the Marcus row still shows as unread: bold t1 "You: Deal · now" plus the blue dot (verified).
  - **Never highlighted**: its on-test compares `s.sheet` to `"convo"`.
- **24 "Trade offer"**: list screen with `dmFilter:"trades"` and `tradeOpen:"marcus"`.
  - **Never highlighted**: its on-test compares `s.sheet` to `"tradeoffer"`.

---

### 5. Data shown

**Conversations** (`CONVOS`, in this fixed order). "Me" is team 0: @dalton / Touchdown Tacos.
- For people, the display name is the manager handle without "@", capitalised, and the initial is the handle's first letter.
- Avatar colour is `TEAMS[ti].av`.
- **The list is not per-league.** `CONVOS`, `TRADES` and the group row ("Sunday Funday League", "12 members") never change with `s.lg`. Only the trade-detail chip follows `s.lg` (§2.3).

| id | Name | Initial | Avatar | Online | Thread sub-line | Messages (sender: text) | Time | Unread at start |
|---|---|---|---|---|---|---|---|---|
| league (group) | Sunday Funday League | SF | ink #1D1D1F, radius 16 (list) / 11 (thread) | — | "12 members" | Priya: "Who's starting Shough over Love? Bold." · Leo: "Watson for 53 to the house. That's a catch." · Marcus: "Still 8-0. Just saying." | 2m | ✓ |
| marcus (ti 1) | Marcus | M | ink #1D1D1F | ✓ | Active now · Gridiron Gurus | Marcus: "You still shopping Conner?" · me: "Depends. What are you offering?" · Marcus: "Mooney + a 2026 3rd" · Marcus: "Sent it over, check your trades" | 8m | ✓ |
| priya (2) | Priya | P | #9D70E9 | ✓ | Active now · Priya's Punters | Priya: "Your waiver bid on Bourne was $1 lol" · me: "Value play" | 1h | – |
| leo (6) | Leo | L | #07A852 | – | Leo's Lions | Leo: "Good game last week" · me: "You too, that Watson TD hurt" | 3h | – |
| nina (7) | Nina | N | #FF8A00 | ✓ | Active now · Hail Marys | Nina: "Want to swap kickers? I have two on bye" | 5h | ✓ |
| devin (3) | Devin | D | #F75252 | – | End Zone Elite | me: "Interested in Engram?" · Devin: "Not really, set at TE" | Tue | – |
| raj (11) | Raj | R | t3 #6E6E73 | – | Raj's Rushers | Raj: "1-7 and still believing" | Mon | – |

**Preview rule.** The preview is the last message's text, with a prefix:
- **"You: "** if I sent it.
- **"{Sender}: "** in the group.
- Nothing otherwise.

Then comes `" · "` and the time: `CTIME[id]` ("Xm", "Xh", or a weekday such as "Tue" or "Mon"), or **"now"** once this session has sent a message there.

Example previews: "Marcus: Still 8-0. Just saying. · 2m" and "You: Value play · 1h".

**Order.** The list is in data order, which happens to be newest first, with the group first. The people row uses the same order without the group. Nothing re-sorts.

**Unread and presence**
- An unread row shows a bold name, a bold t1 preview and a blue dot.
- The header badge counts unread conversations.
- "Seen" is derived purely from whether the last message is mine.
- Online presence is static.
- Thread date grouping is the static "Today" label only.

**Trades** (`TRADES`: `[id, dir, gets, gives, status, time]`, in this order)

| Manager | Direction | You get | You give | Status | Time |
|---|---|---|---|---|---|
| Marcus | in ("Sent to you") | Darnell Mooney (WR · ATL), 2026 3rd round pick | James Conner (RB · ARI) | Pending | 8m |
| Nina | in | Jake Bates (K · DET) | Cairo Santos | Pending | 5h |
| Devin | out ("You sent") | Evan Engram (TE · DEN) | Rhamondre Stevenson (RB · NE) | Declined | Tue |
| Leo | out | Jahan Dotson (WR · PHI) | 2026 4th round pick | Accepted | Sep 24 |

- Status is overridden by `s.tradeStatus[id]` for the session.
- **There is no sort.** `tradeRows` maps the `TRADES` constant in fixed order. The pending trades only happen to come first, and a card you Accept or Decline keeps its position.

**Asset formatting in the detail view**
- Pick: any name matching `/pick/i`. Shown as "2026 3rd round" with meta "Draft pick".
- Player name: `short()` gives "D. Mooney". Names whose first word contains "." are shown in full, as are names ending in "D/ST".
- Player meta: `"{POS} · {TEAM}"`, with DST shown as "D/ST".
- Meta colour by position (`POSTXT`): QB #E03E3E, RB #4A68D4, WR #8656D8, TE #C98A1F, K #5E8C8C, D/ST #A68A00.
- Headshot ring by team: ATL #A71930, ARI #97233F, DET #0076B6, DEN #FB4F14, NE #002244, PHI #004C54.
- Headshot photos exist for Mooney, Conner, Engram and Dotson. Bates, Santos and Stevenson fall back to the initials "JB", "CS" and "RS".

**Sample-data contradictions** (⚠)
- **Devin's trade** lists Evan Engram under "You get", but Engram is already on your roster (`MINE`, TE slot).
- **Nina's trade** lists Jake Bates under "You get", but Bates is already on your roster (`MINE`, K slot, line 1145).
- **Cairo Santos** ("You give") is on no fantasy roster at all. He appears only in the CHI depth chart (`DEPTH`), not in `PDB`, so `pinfo` falls back and he renders as **"WR · FA"** in purple, with the hairline `rgba(0,0,0,.04)` ring instead of a team ring.
- Together these produce the invisible pre-selection in Nina's Counter (§3).

**Avatars in the detail view**
- My side: avatar colour `s.myAv` (#0088FF), initial "D".
- Their side: uses the **team** initial (Marcus shows "G" for Gridiron Gurus), not the manager initial used in Messages.

**League chat data** (`s.chat`)
- Priya (#9D70E9), 12:41 PM: "Who's starting Shough over Love? Bold."
- Leo (#07A852), 12:44 PM: "Watson for 53 to the house. Missing people report is over."
- System row "League" (t5 avatar, t3 text), 12:58 PM: "You added K. Bourne (WR · ARI)"

**What would be real product data**
- **Real:**
  - Conversation membership. The README (line 89) describes "DMs per league member plus a league message board"; **the prototype shows only one league's members and board, and does not switch with the selected league**.
  - Messages, timestamps (relative format) and date separators.
  - Unread state and read receipts, and online presence.
  - Team and manager names and colours.
  - Trade offers: direction, assets, status, expiry ("expires in 2 days").
  - The pending count, and the league format line and league mark on the chip.
- **Static copy:** all labels and toasts listed above.
- Per CLAUDE.md, league screens are UI-only with mock data and stub handlers for now, so build this as clearly-marked mock data.

---

### 6. Dark mode (`.fs-dark` on the phone root; `color-scheme:dark`)

**Messages list**
- Page: b0 #121212, text t1 #FFFFFF.
- Back pill, Send pill and unread dots stay #0088FF.
- Search field #333333, magnifier #A7A7A7. The placeholder stays #6E6E73. The input gets `color-scheme:dark` (line 20) and #FFFFFF text.
- Segmented control: track #333333; on-segment #121212 with the same shadow; on text #FFFFFF; off text #B3B3B3. The Trades badge is unchanged.
- People names #D9D9D9.
- Online-dot ring #121212 (the dot stays #07B85A).
- Avatars that use ink (league group, Marcus) become **#4D4D4D** everywhere: list, people row, thread header, bubbles, trade card and trade detail.
- Raj's avatar (t3) becomes **#B3B3B3**: a white initial on light grey, low contrast.
- Row pressed #282828; unread preview #FFFFFF; read preview #B3B3B3.

**Trade cards**
- Ring #3E3E3E; asset boxes #282828.
- Status pills: Pending #FFB340 on #3A2A14; Accepted #1ED760 on #12301F; Declined #FF6B6B on #3A1A1D.
- Buttons: Decline #FF6B6B on #3A1A1D; Counter #FFFFFF on #333333; Accept unchanged.
- "You get" #07A852 and "You give" #FF0028 are hard-coded and do not change.
- Sub-line #B3B3B3.

**Thread**
- Header and composer borders #3E3E3E. Back stays #0088FF; the info icon is #FFFFFF.
- Their bubbles #333333 with #FFFFFF text; my bubbles unchanged.
- "Today", "Seen", sender names and the header sub-line #B3B3B3.
- "+" button #333333 with a #FFFFFF icon; input ring #3E3E3E; input text #FFFFFF.
- The tab bar on top of the composer is rgba(18,18,18,.92).

**Trade detail**
- Background #121212; close icon #FFFFFF; title #FFFFFF; sub-line #B3B3B3.
- Status pills: Pending #FFB340 on #3A2A14; "Sent offer" and Accepted #1ED760 on #12301F; Declined #FF6B6B on #3A1A1D.
- Asset card #282828 with a #3E3E3E divider.
- "Receives" #07A852 and "Sends" #FF0028 are hard-coded and do not change.
- Position meta colours (`POSTXT`) do not change, e.g. RB #4A68D4 on #282828. "Draft pick" becomes #B3B3B3.
- Pick circle #3E3E3E with a #D9D9D9 icon.
- Headshots: the white gap ring stays #fff and the fallback stays #EEEEF1 / #6E6E73 (not themed).
- Hide row: label and team lines #B3B3B3; switch on stays #07B85A; switch off #3E3E3E; knob **#121212**.
- Message pill #333333 with #FFFFFF text.
- Footer border #3E3E3E; footer buttons follow the trade-card colours.
- Resolved text: Declined #B3B3B3; Accepted stays #07A852.
- League chip: the square uses ink #4D4D4D for Sunday Funday, and other leagues' hex colours are unchanged. Chip text #B3B3B3.

**League chat sheet**
- Sheet #121212; handle #575757; composer pill #333333.
- System avatar #727272; system text #B3B3B3.
- The scrim stays rgba(0,0,0,.32).

**Dock, toast and badges**
- Tab bar rgba(18,18,18,.92). Tab label colours (#A1A1A6 / #fff) are unchanged.
- The home indicator becomes b0 #121212, which is effectively invisible on the dark tab bar.
- Toast background #4D4D4D.
- DM badge ring #121212.

---

### Open questions
- Verification note: I checked every critic finding against the source and in a headless render, and all of them hold, so none were dropped. Two were refined. First, the input pill under the tab bar spans Match (x56-83) through Menu (x307-378), not only Team, Players and League. Second, Cairo Santos does appear in the CHI depth chart (DEPTH), but he is on no fantasy roster and is missing from PDB.
- Thread composer is fully hidden under the tab bar. The 80px league tab bar uses margin-top:-80px and z-index 4, so it covers the 59px composer (y785-844). Taps there go to Match, Team, Players, League or Menu, and tapping Send opens the Menu sheet. The only way to send is keyboard focus plus Enter. Should the conversation screen hide the tab bar, or should the composer sit above the dock?
- Messages, Conversation and Notifications always show the league tab bar (Match/Team/Players/League/Menu) with no tab highlighted, even when opened from Home. Is that intended, or should the outside-league bar (Home/Community/Players/Profile) show when you arrive from Home?
- Back from Messages goes to a stale prevScr when you entered a thread from a team page or the trade detail. Example: you start on Home, later open a team page from League › Standings, tap Message, and Back twice takes you to Home. Should Back from Messages return to wherever you actually came from, for example a real history stack?
- The League chat sheet ('League chat', 'Message the league') has no entry point. openChat is not this sheet's opener; it is an unbound Messages entry. The sheet's send also writes to the last opened DM thread, not to the chat. Has it been replaced by the 'Sunday Funday League' group conversation in Messages, and can it be dropped?
- Tapping a player in the trade offer detail opens the player profile underneath it (profile z-index 22, detail 23). The profile then appears on whatever comes next: over the list after Accept, Decline or Close, on top of the thread after 'Message @marcus', and on top of the team page after tapping the manager's name. Should the profile open on top of the detail immediately?
- Are Messages scoped to the selected league or global? The README says 'DMs per league member plus a league message board', but the prototype only has Sunday Funday members and switching league doesn't change the list. Meanwhile the trade-detail chip does switch league. The chip also shows the format line ('12-team standard') rather than the league name, and its text is hard-coded white even on the gold Family Bragging Rights mark (avFg #1D1D1F is ignored). Which is right?
- 'Hide usernames for screenshots' doesn't hide the handle in the 'Message @marcus' pill or the league chip, and it shifts the layout up 3-6px. Should the pill read 'Message Team 2' (or be hidden) while names are hidden, and should the row height stay fixed?
- No flows are designed for compose/new message (pencil), '+' attachments, the (i) conversation info button, tapping the thread header avatar or name, or messaging a manager with no existing thread (toast 'New message to @sam'). What should these do?
- No empty states exist: search with no results, no conversations, no trades. The list just goes blank. What copy and design should be used?
- Search filters conversation names only, ignores the people row, is never trimmed (a single space filters to 'Sunday Funday League'), and never clears, not even when you leave and come back. On Trades it joins name and assets with no separator ('marcus darnell' fails) and '@marcus' matches nothing. Should the people row filter too, should message text and handles be searchable, and should the query reset when you leave?
- All and Trades share one scroller, so the scroll position carries over: switching tabs after scrolling All opens Trades at the bottom. Should each tab keep its own scroll position, or reset to the top on switch?
- Conversation order is fixed and doesn't re-sort when a message is sent; only the time changes to 'now'. Should the list sort by latest activity, and should the league board stay pinned on top?
- Messages are top-anchored and don't scroll to the newest message on open or send. Should the thread be bottom-anchored and auto-scroll like a standard chat?
- Every thread shows a hard-coded 'Today' separator (even Devin's 'Tue' and Raj's 'Mon' threads), and messages have no timestamps. Should real date separators and per-message times be designed?
- The thread header sub-line (team name) has no truncation and will wrap on long team names. Should it truncate with an ellipsis like the name line?
- 'Seen' shows whenever the last message is mine, and 'Active now' presence is static. Are read receipts and online presence in scope for the real product?
- Counter from a trade card opens an empty trade builder, but Counter from the trade detail pre-fills it with the offer's players and silently drops picks (the builder has no pick support). Closing the builder returns to the list, not the offer. Which behaviour is right, should picks carry over, and should closing return to the offer?
- Accept and Decline on trade cards act at once with no confirmation. Should Accept confirm first?
- Copy and identity don't match between views. The card's accept toast says 'Trade accepted with Marcus', while the detail's says 'Trade accepted with @marcus'. The detail avatar shows the team initial ('G'), while Messages shows the manager initial ('M'). Which should win?
- 'Withdraw offer' can't be reached: there is no outgoing pending trade, and sending a proposal from the builder doesn't create one. Withdrawing sets the status to 'Declined' and shows 'This offer was declined'. Should a withdrawn offer get its own status and wording, and should a sent proposal appear as an outgoing Pending card?
- The trade builder's 'Send a direct message / Notify @marcus in your messages' toggle (on by default) posts nothing to the thread. Should a proposal show up in the DM conversation, for example as a trade card bubble?
- The prototype doesn't match the README on two values: the toast dismisses after 1800ms (README says about 2.2s) and the sheet backdrop is rgba(0,0,0,.32) (README says .4). Which values should be used?
- The sample data contradicts itself. Devin's trade gives you Evan Engram and Nina's gives you Jake Bates, but both are already on your roster. Cairo Santos is on no roster and shows as 'WR · FA'. Because of this, Counter on Nina's offer opens the builder showing '2' and '1 for 1' with nothing visibly selected. Should the data be fixed or left as placeholder?
- The trade-detail scroller (24 padding + 20 gap + 84 spacer = 128px) and the sheet scroller (12 + 84 = 96px) still get the dock spacer even though the dock is covered there, and the thread gets 104px below 'Seen'. Is that extra bottom space intended?

---

## Gap analysis vs the current app

## Gap analysis: Messages, conversations and trade offers in DMs (mobile)

**Worktree:** `/Users/chrisdaltas/Documents/Hadouken/.claude/worktrees/redesign-v7` at HEAD `27d455b`.

**Files checked**
- **Messaging:**
  - `src/components/layout/rail/messages-panel.tsx`
  - `src/components/layout/rail/research-rail.tsx`
  - `src/stores/rail-store.ts`
  - `src/lib/feature-flags.ts` (`messages` is "mock-data UI, no backend yet")
- **Navigation:** `src/components/layout/{bottom-tabs,more-sheet,top-nav,app-shell,app-header}.tsx`
- **League chat:**
  - `src/components/leagues/league-message-board.tsx`
  - `src/hooks/use-league-chat.ts`
  - `supabase/migrations/065_draft_tables.sql`, which defines `league_chat.context`
- **Trades:**
  - Components: `src/components/leagues/{trade-center,trade-builder,trades-ops,team-page,league-cells}.tsx/.ts`
  - Service: `src/lib/leagues/api/trades-service.ts`
  - Routes: `src/app/api/leagues/[id]/trades/{route,[tid]/route,preview,deadline}.ts`
  - Hooks: `src/hooks/use-{trades,trade-action,propose-trade,trade-preview,trade-deadline}.ts`
  - Migrations: `supabase/migrations/148_trades_core.sql`, `151`, `155`, `162`, `174`
- **Notifications:** `src/components/notifications/notification-href.ts`
- **Players:** `src/components/players/{player-image,player-link}.tsx`, `src/lib/nfl-team-colors.ts`
- **Presence:** `supabase/migrations/070_draft_realtime.sql` (the presence policy)
- **Schema:** `src/types/database.ts`
- **UI primitives and theme:**
  - `src/components/ui/{tabs,toast,toaster,switch,sheet,user-avatar}.tsx`
  - `tailwind.config.ts` and `src/app/globals.css` (the `m-*` tokens)
  - `src/stores/theme-store.ts`, `src/hooks/use-layout-mode.ts`
- **Spec:** `docs/specs/spec-redraft-leagues.md` line 402

**Summary**
- **DMs have no backend.** There are no DM, conversation, read-marker or app-wide presence tables. The only messaging UI is a desktop-only rail panel (`messages-panel.tsx`) behind the `messages` flag. It always renders its empty state; there are no mock threads anywhere.
- **Nothing in this area exists on mobile.** The research rail is wrapped in `hidden desk:block`. There is no `/app/messages` route, no mobile header chat icon and no `mob:` usage yet.
- **The league group board exists:** `league_chat` with `context='league'`, live over the league channel, with a send hook.
- **Trades are fully server-backed.**
  - Verbs: propose, accept (with drops), reject, cancel, counter and vote.
  - 10 statuses.
  - Notifications carry `trade_id` (148:902).
  - What's missing is a dedicated trade-detail screen, a cross-league trades inbox, offer expiry and draft-pick assets. Draft picks are excluded by the spec: "no draft picks in redraft".

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| Messages list screen (S1), as a mobile route | needs-new-backend | No `/app/messages` route. Desktop `messages-panel.tsx` (rail, flag `messages`) | No DM tables (searched migrations and `database.ts`). Per CLAUDE.md, build behind `featureFlags.messages` with clearly-marked mock data. `RailDmThread` in `messages-panel.tsx` already defines the thread shape. |
| Header: Back pill | restyle-only | Router history | Use real history. Do not copy the prototype's stale `prevScr` (§4). |
| Header: Compose (pencil) | out-of-scope-or-question | — | The prototype only toasts "Not part of this prototype". There is no designed flow, and it would need the DM backend. |
| "Messages" title + Search (All tab, name filter) | needs-new-backend | `messages-panel.tsx` has a GM filter strip, not search | The filter is client-only, but there is nothing to filter until DMs exist. |
| All / Trades segmented control | restyle-only | `Segment`/`SegmentItem` in `src/components/ui/tabs.tsx` (already supports `count`) | Use a separate scroll position per tab. The prototype's shared offset is a defect. |
| Trades segment badge (pending count) | new-ui-on-existing-data | `TradesDocument.trades` (`trades-service.ts`), `splitTrades` in `trades-ops.ts` | Count trades in `proposed` whose recipient is the viewer's team. This needs reads across all of the user's leagues (see the Trades tab row). |
| People row (avatars, names, online dot) | needs-new-backend | League members exist (`use-league.ts` `members[].profiles`) | A tap opens a DM thread, which has no backend. The online dot is covered in the presence row. |
| Conversation rows (avatar, bold if unread, "You:" / "Sender:" preview · time, blue unread dot) | needs-new-backend | `messages-panel.tsx` thread list (desktop, empty) | Needs DM messages and per-user read markers. Only `notifications.read` exists. |
| Group row = league message board | new-ui-on-existing-data | `use-league-chat.ts` (`league_chat`, `context='league'`, live via `useLeagueChannel`), `league-message-board.tsx` | Preview and time come from the latest row. **The unread dot and bold text need a read marker (new backend).** The prototype shows one league only; product must decide whether there is one group row per league. |
| Empty states (S1b, S2c: blank in the design) | restyle-only | `messages-panel.tsx` "No messages yet"; trade-center `TRADES_PENDING_EMPTY_COPY` | Extend the design language with real empty-state copy (CLAUDE.md prototype-gaps rule). |
| Trades tab: cross-league trade-card inbox | new-ui-on-existing-data | `GET /api/leagues/[id]/trades` (per league), `use-trades.ts` | There is no cross-league read. Either fan out per league (`useLeagues`) or add a thin aggregate read. Product question: is the inbox all leagues or the selected league? |
| Trade card (header, status pill, You get / You give boxes) | restyle-only | `TradeCard` in `trade-center.tsx`, `tradeSides` in `trades-ops.ts` | The manager handle comes from `members[].profiles.username`, because `TradeTeamRef` holds only the team name. |
| Trade card actions: Accept / Decline / Counter | restyle-only | `TradeCard` buttons, `useTradeAction` (PATCH op accept/reject/counter), `acceptGate` + drop picker | **The design omits the required drop picker (E36), which Accept needs when the roster would overflow, and the deadline gate.** The mobile card must fit both. |
| Trade search (name + assets) | new-ui-on-existing-data | Data in `TradeView.items[].player.full_name` and team names | Client filter. Use a separator and match handles. The prototype's concatenation without separators is a defect. |
| Thread screen, 1:1 (S3a) | needs-new-backend | `messages-panel.tsx` conversation view (desktop, local-only composer) | No DM storage. The bubble grouping logic (`ChatRun`) exists and can be reused. |
| Thread screen, group / league board (S3b) | new-ui-on-existing-data | `use-league-chat.ts` (read + `useSendLeagueChat`), `league-message-board.tsx` | Today the board is a card on League Home. The mobile chat-bubble thread is new UI. The members count comes from league detail. |
| Bubbles, run grouping, corner radii, sender labels | restyle-only | `ChatRun` in `messages-panel.tsx` | Visual restyle only. |
| "Today" separator / dates | new-ui-on-existing-data | `league_chat.created_at`; `formatInstantWithDate` in `lineup-editor-ops.ts` | The design hard-codes "Today". Derive it from real timestamps. |
| "Seen" read receipt | needs-new-backend | — | The prototype fakes it from the last sender. A real receipt needs per-recipient read markers. |
| Online presence ("Active now", green dot) | new-ui-on-existing-data | Realtime presence policy on `league:<id>` (`070_draft_realtime.sql`:356). Today only the draft room tracks presence (`use-draft.ts`) | No new tables are needed, but the app does not track presence outside the draft yet. |
| Thread composer (+, input pill, Send pill appears on text, Enter sends) | needs-new-backend | `messages-panel.tsx` local composer; `league-message-board.tsx` composer (group, real) | Group sends work today. 1:1 sends need DMs. **Do not replicate the prototype's dock covering the composer** (§2.2 C). Use IME-safe Enter. |
| Thread info (i) and "+" attach | out-of-scope-or-question | — | Both toast "Not part of this prototype". |
| Trade offer detail overlay (S4) | new-ui-on-existing-data | `TradeView` (items, players with pos/team, status, `created_at`) via `use-trades.ts`; actions via `PATCH …/trades/[tid]` | No per-trade detail screen exists. The app shows trades as inline cards on `/app/leagues/[id]/trades`. |
| Detail league chip (mark + format line) | new-ui-on-existing-data | `leagues.avatar_url`, `format`, `team_count` | Use the **trade's** league, not the selected league (prototype bug). |
| Side blocks (handle, team, per-side Pending / Sent offer pill) | new-ui-on-existing-data | `tradeSides` in `trades-ops.ts`; handles from `use-league` members | Derive the pill from `status` plus viewer direction. |
| Asset rows (headshot with team-colour ring, short name, POS · TEAM) | restyle-only | `player-image.tsx`, `nfl-team-colors.ts`, `PositionBadge`, `PlayerLink` | FAAB legs exist (`trade_items.faab_amount`) but the design has no FAAB row. Extend it. |
| Draft-pick assets | out-of-scope-or-question | `trade_items` is player XOR FAAB (148:173-175) | Spec line 402: "no draft picks in redraft". It would need a spec change and new backend. |
| "expires in 2 days" | needs-new-backend | `trades.status 'expired'` exists only for the trade deadline (148:88) | There is no per-offer expiry column or job. Product ruling needed. |
| Hide usernames for screenshots toggle | new-ui-on-existing-data | — | Purely client-side. Hide the handle on the Message pill too (the prototype leaks it). |
| "Message @manager" pill on detail | needs-new-backend | — | Needs DMs. |
| Footer Accept / Decline / Counter (incoming) | restyle-only | `TradeCard` actions + `acceptGate`, `useTradeAction` | Fit the drop picker and vote states. |
| Footer "Withdraw offer" (outgoing) | restyle-only | PATCH `op:'cancel'` → status `cancelled` ("Called off") | The app has a real cancelled state. The prototype's mapping to Declined is a defect. |
| Resolved footer copy | restyle-only | `tradeStatusView` in `trades-ops.ts` (server sentences per status) | The design covers Accepted and Declined only. |
| Statuses missing from the design | restyle-only | `tradeStatusView`, `tallyWords`, vote buttons in `trade-center.tsx` | Missing states: Under review (commish / league vote with tally, veto/approve), Waiting for games, Completed, Countered, Called off, Vetoed, No longer valid, Expired, Reversed. Extend the 4-pill vocabulary. |
| Counter → builder pre-filled | restyle-only | `counterSeed` in `trades-ops.ts`, `TradeBuilderView mode='counter'` | The app always seeds the builder. The design's empty builder from the card is a defect. |
| Other manager's name → team page | restyle-only | `TeamNameLink` (`league-cells.tsx`), `/app/leagues/[id]/team/...` | — |
| Player asset tap → player card | restyle-only | `PlayerLink` + `leagueCardContext` (mini card, then full) | Don't replicate the prototype's z-index bug, where the profile is hidden under the detail. |
| Toasts (accepted / declined / withdrawn / sent) | restyle-only | `src/components/ui/toast.tsx`, `toaster.tsx` | Style: ink pill at bottom 100, 1800ms. The copy should use server outcomes. |
| Notification "Trade offer from X" → trade detail | new-ui-on-existing-data | `notification-href.ts` sends every `league_trade_*` to `/app/leagues/[id]/trades`; data has `trade_id` (148:902) | Deep-link to the specific trade's detail. |
| Team page "Message" button | needs-new-backend | `team-page.tsx`:348 has "Propose trade" only | Needs DMs. |
| Header chat icon + DM unread badge (Home / League mobile headers) | needs-new-backend | Desktop rail strip `dmUnreadCount()`, stubbed to 0 (`research-rail.tsx`:69); no mobile header icon | Needs DM unread counts. |
| League chat sheet (S5) | out-of-scope-or-question | `league_chat` data exists | Unreachable in the prototype, and its `send()` writes to the last DM. It is probably superseded by the group thread. |
| League dock on DM screens (Match / Team / Players / League / Menu) | new-ui-on-existing-data | `bottom-tabs.tsx` (app tabs only); no mobile league dock | Owned by the League section. Questions: it covers the composer, and no tab is highlighted. |
| Builder "Send a direct message / Notify @mgr" toggle | needs-new-backend | `trade_notify_team_internal` already notifies (TD16) | Posting to a DM needs the DM backend. |
| Per-league scoping of conversations | out-of-scope-or-question | — | README line 89 says DMs are per league member plus a board. The prototype is single-league and never switches. |
| Prototype defects | out-of-scope-or-question | — | Recommend not copying any of them: shared scroll offset across tabs, stale `prevScr`, composer under the dock, hidden profile under the detail, Withdraw shown as Declined, Counter dropping picks, chip following the selected league, hard-coded "Today". |
| Avatar colours per team (`TEAMS[ti].av`) | restyle-only | No team colour column (`teams` row in `database.ts`); `UserAvatar` fallback | Use the profile `avatar_url` or initials fallback. |
| Tokens, Inter Display, tnum, icons, scroll spacer under dock | restyle-only | `tailwind.config.ts` `m-*` tokens + `font-inter`; `globals.css` | Tokens already landed in `27d455b`. |
| Dark mode (`.fs-dark` values) | out-of-scope-or-question | `globals.css` `html[data-theme='dark']` `m-*` tokens; `theme-store.ts` | CLAUDE.md says single theme. However, HEAD `27d455b` adds mobile-only dark tokens and a switch, citing "Chris, 2026-10-15 — dark mode is mobile-only". Confirm that this ruling supersedes CLAUDE.md. |
