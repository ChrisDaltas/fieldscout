## Lists

**Sources**

- **Prototype:** `FieldScout Mobile Lists and Rankings.dc.html`. The copy in `FieldScout Mobile Handoff/` is byte-identical to the one in `design_handoff_fieldscout_mobile/`.
- **Markup lines:**
  - 41–45: status bar
  - 47–53: root header
  - 123–140: `lists`
  - 169–190: `lsNew`
  - 192–225: `ed`
  - 227–255: `lv`
  - 267–271: dock
  - 273–298: sheets
  - 300: toast
- **Script lines:**
  - 307–363: sample data, `STATS`, `PG`, `ytId`, `SEASON`/`PRK`
  - 366–373: state and deep links
  - 374–400: `rank`, `breaks`, `itemsFrom`, seeds, `toast`, `prow`, `statv`, `dragRow`
  - 402–428: root, dock, jump panel
  - 493–534: editor, New list, file input
  - 536–553: grid and list view
  - 559–573: sheets
  - 579: theme
- **Headshots:** `design_handoff_fieldscout_mobile/FSHeadshot.dc.html`.
- **Main-app cross-links:** `design_handoff_fieldscout_mobile/FieldScout Mobile.dc.html`. Line numbers for this file are prefixed "main app".

**Files missing from the handoff folder.**

`FieldScout Mobile Handoff/` contains only this file, `README.md`, `support.js` and `assets/` (logomark, wordmark, and `headshots/` with 20 jpgs). It has **no `FSHeadshot.dc.html` and no `FieldScout Mobile.dc.html`**, even though the README's "Files" list names both. If you open the prototype from that folder:

- **Headshots do not render.** Every headshot is a `<dc-import name="FSHeadshot">` (lines 132, 216, 231, 248, 282). `support.js` fetches `FSHeadshot.dc.html` as a sibling file. The fetch fails and logs `[dc-runtime] sibling fetch for <FSHeadshot/> failed`, so neither photos nor initials appear.
- **Some taps lead nowhere.** `APP = "FieldScout Mobile.dc.html"` (line 405) is the target of the Lists back chevron and of the Home, Community and Leagues dock tabs (lines 416–417). Those taps go to a file that is not there.
- **Where the files are.** Both files exist in `design_handoff_fieldscout_mobile/` and in `FieldScout Design System Overhaul/`. This section was written from those copies.

**Tokens.** Token names follow the README: `t1…t5`, `b0…b4`, `ink`, accent `#0088FF`. Unless a dark value is given, the light value is the fallback in `var(--x-…, fallback)`.

**Font.** Text is `'InterDisplay', sans-serif` (rsms.me/inter), with `font-feature-settings: 'tnum' 1, 'cv11' 1` (tabular figures) and `-webkit-font-smoothing: antialiased`, set on the outer wrapper (line 25).

---

### 1. Screens and states

All state lives in one `state` object.
- The screen is chosen by `scr`.
- Sheets are chosen by `sheet`. A sheet renders only when an editor draft `ed` exists (`hasSheet = !!sheet && !!ed`).
- The navigation helper `go(scr)` sets `scr` and clears `sheet` and `rkMenu`. It does not clear `ed`.

| # | Screen / state | Condition | Notes |
|---|---|---|---|
| L1 | **Lists grid, "My lists" tab** | `scr==="lists"` and `listTab==="mine"` (default) | Root header, dock, a "New list" tile first, then `lists.filter(l=>l.mine)` in array order. |
| L2 | **Lists grid, "Saved" tab** | `scr==="lists"` and `listTab==="saved"` | `lists.filter(l=>!l.mine)`. No "New list" tile, but the root header's Create (+) is still shown and still creates a list (see §3). **No empty state is defined**: an empty grid renders nothing under the tabs. |
| L3 | **New list, step 1 ("New list")** | `scr==="lsNew"`, `ed` set, `ed.id==null` | Header "New list", step label "1 of 2", CTA "Next: add players". |
| L3a | New list, title empty | `!ed.title.trim()` | CTA is grey (looks disabled) but still tappable: it shows the toast "Give your list a name". |
| L3b | Thumbnail = Player collage | `ed.thumb==="collage"` (default) | The 6 colour swatches show. |
| L3c | Thumbnail = Upload image | `ed.thumb==="upload"` | Set only by the file input's change event. Swatches hidden. The Upload tile shows the image. |
| L3d | Thumbnail = Video frame | `ed.thumb==="video"` | Enabled only when `ed.video.yt` exists. Swatches hidden. The tile shows the YouTube thumbnail. When disabled, the whole option is at opacity .4. |
| L3e | Video: none attached | `!ed.video` | Link field plus "Attach". |
| L3f | Video: link typed | `ed.link.trim()!==""` | "Attach" turns dark (`ink`). |
| L3g | Video: invalid link | `ed.linkErr===true` | Red helper text "That doesn't look like a YouTube link". |
| L3h | Video: attached | `!!ed.video` | Card with thumbnail, "YouTube video", URL and remove ✕. **The link row is hidden**, so a list holds one video. To change it, remove it first. |
| L3x | "Edit details" variant | `scr==="lsNew"` and `ed.id` set | Header "Edit details", no step label, CTA "Done". **No code path reaches this** (see §7). |
| L4 | **List editor** | `scr==="ed"` and `ed.kind==="list"` | No dock, no root header, no footer (the footer is for rankings only). |
| L4a | Editor empty | no `{t:"p"}` items | "No players yet" empty state. |
| L4b | Ranked on/off | `ed.ranked` | Rank-number column shown or removed. |
| L4c | Tiers on/off | `ed.tiersOn` | On: "Tier 1" header (only if ≥1 player), tier lines, and the tools "Auto tiers" and "Add tier line". Off: tier markers stay in `items` but are hidden. |
| L4d | Has stats | `ed.stats.length>0` | Time-frame segmented control shows next to "Stats". |
| L4e | Dragging | `dragOver===i` | The target wrapper gets `inset 0 2px 0 #0088FF`. **This is visible only on tier-line rows** (see §2.3). |
| L4f | Tiers off with hidden markers | `!tiersOn` and markers in `items` | Markers still occupy array slots and count for drag indexes. |
| L4g | Tiers on, markers but no players | `tiersOn` and only `{t:"tier"}` items | The empty state renders, **and** the "Tier 2", "Tier 3"… lines render below it with no "Tier 1" header. Reached by turning Tiers on in an empty list and tapping "Add tier line". |
| L5 | **Add players sheet** | `sheet==="pick"` | Over the editor. |
| L5a | Add players, no matches | the filter returns 0 rows | Blank area under the chips. There is no "no results" message. |
| L6 | **Add stats sheet** | `sheet==="stats"` | Over the editor. |
| L7 | **Import a ranking sheet** | `sheet==="import"` | Over the editor. |
| L8 | **List view, own list** | `scr==="lv"`, `lists.find(id===lvId)` exists, `mine` | Dock shown. "Edit" pill on the cover. |
| L8a | List view, someone else's list | `mine===false` | No Edit button. Meta starts with the author handle. No save/unsave control. |
| L8b | List view with stats | `L.stats.length>0` | Header row, 172px locked player column, 58px stat columns, time-frame control. |
| L8c | List view, no stats | `L.stats.length===0` | No header row and no time-frame control. Player column is 100% wide with no right hairline. |
| L8d | Tiers on | `L.tiersOn` | Tier label rows, with no rule lines. |
| L8e | Ranked | `L.ranked` | Number column shown. Meta says "Ranked", otherwise "Unranked". |
| L8f | Description / video | `!!L.desc` / `!!L.video` | Each block shows only if present. The thumbnail image shows only if `video.yt` is set. |
| L8g | List with 0 players | saved with no players (Save has no player check) | See below. |
| L8h | Video without a YouTube id (sample l2) | `L.video` set, `L.video.yt===null` | Grid card shows the "Video" badge. The view's video card has a plain `ink` thumbnail with only the red play badge. |
| T | Toast | `toast!==""` | Shown for 2200 ms. A new toast replaces the current one. |

**L8g, list with 0 players:**
- With stats: "Players · 0", the time-frame control, and only the 28px "Player | <stat>…" header row.
- Without stats: nothing under "Players · 0".
- If Tiers is on and only markers exist: orphan "Tier 2"… labels with no "Tier 1".
- The grid card is a plain colour square with meta "0 players · Updated Just now".

There are **no loading, error, offline, hover or pressed states** anywhere in Lists. The only `style-hover` in the file is on the dev jump panel, outside the phone.

---

### 2. Layout (top to bottom)

#### 2.0 Shared chrome

**Phone frame and status bar**
- **Phone frame:** 390×844, `b0` background, radius 48, `overflow:hidden`, flex column. The presentation bezel is 410×864, padding 10, radius 58, `ink` fill, shadow `0 30px 80px -30px rgba(0,0,0,.45)`.
- **Status bar** (lines 41–45):
  - 50px tall, `flex:none`, `justify-content:space-between`, padding `6px 32px 0 40px`, 16/600, no background (the page `b0` shows through).
  - Left: "9:41".
  - Centre: an absolute pill, 120×34, radius 999, `#000` in both themes, `top:11px; left:50%; translateX(-50%)`.
  - Right: a row with gap 6, in `t1`:
    - **Signal** (18×12): four bars, 3px wide, rx 1, at x 0/5/10/15, heights 4/7/9.5/12, bottom-aligned.
    - **Battery** (25×12): outline rect at 0.5,0.5, size 21×11, rx 3.5, stroke `currentColor` at opacity .4; fill rect at 2,2, size 16×8, rx 2. No terminal nub.
  - No home-indicator bar is drawn. Bottom paddings reserve that space: dock 26px, footers 30px, sheet bodies 30px.

**Root header** (Lists grid only; also used on the Rankings hub)
- `flex:none`, padding `2px 16px 0`, gap 10, total height 36. It does not scroll.
- **Left:** 34×34 circle, bg `b2` #F2F2F4, chevron-left 16px (`M10 3L5 8l5 5`, stroke 2, round caps and joins, `t1`). No title attribute.
- Then a flex spacer.
- **Right:** 34×34 circle, bg `#0088FF`, white plus 15px (`M8 3v10M3 8h10`, stroke 2.4, round caps), `title="Create"`.

**Dock** (Lists grid and List view; line 268)
- 84px tall, `position:relative; z-index:4; margin-top:-84px`, so it overlays the bottom of the scroller.
- Background `var(--x-barA, rgba(29,29,31,.94))`, dark `rgba(18,18,18,.92)`. It is a dark bar in light mode too. No blur, no top border.
- `display:grid; grid-template-columns:repeat(4,1fr)`, padding `8px 8px 26px`.
- Each item is a centred column, gap 4. Icon 22px, viewBox 16, stroke 1.5, round caps and joins. Label 10/600.
- **Items:**
  - "Home": `M2.5 7.2L8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5z`
  - "Community" (star): `M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z`
  - "Leagues" (trophy): `M5 2.5h6v3a3 3 0 0 1-6 0zM5 3.5H3v1.2A2.3 2.3 0 0 0 5.2 7M11 3.5h2v1.2A2.3 2.3 0 0 1 10.8 7M8 8.5v2.5M5.5 13.5h5L10 11H6z`
  - "Profile": a 24px avatar circle with "D" 11/700 white on `#0088FF`, `box-shadow: 0 0 0 2px var(--x-ink,#1D1D1F), 0 0 0 3.5px var(--x-b0,#fff)`.
- **Colours:** Home, Community and Leagues use `t3` (#6E6E73). Profile uses `#fff`, so it always reads as the active tab. No item ever changes colour.
- **Scroll clearance:** while the dock shows, the phone root gets class `dock-sm` (`--x-dockpad:84px`). Every vertical scroller (`.fsm-scroll` whose inline style contains `overflow-y`) gets an 84px `::after` block so its last row clears the dock. On screens without the dock (New list, Editor) the spacer is 0. Horizontal scrollers never get it.

**Bottom sheet** (lines 273–298)
- **Backdrop:** absolute inset 0 inside the phone, z 30, `rgba(0,0,0,.4)`. It also dims the status bar and the notch pill.
- **Panel:** absolute bottom, z 31, `max-height:86%` (≈726px), radius `22px 22px 0 0`, bg `b0`, flex column. Height follows its content up to that cap.
- **Grab handle:** 36×5, radius 999, `b4` #D1D1D6, in a wrapper with padding `8px 0 2px`. It is a plain `<span>`: no drag and no swipe-to-dismiss.
- **Header row:** padding `8px 16px 10px`, gap 8.
  - Title 17/600 and subtitle 12/500 `t3`, stacked with gap 2.
  - Right button: 32px tall pill, padding `0 14px`, 13/600, white on `#0088FF`.
- **Closing:** the header button and a backdrop tap both only set `sheet:null`.
- No open or close animation.

**Toast** (line 300)
- Absolute, `left:16px; right:16px; bottom:100px`, z 40. It sits above the dock and above an open sheet.
- Padding `12px 14px`, radius 14, bg `ink` (#1D1D1F), white 13/600, centred text.
- `toast()` calls `clearTimeout` before setting a new 2200 ms timer, so a new toast replaces the current one and restarts the timer.
- It is a full-width rounded rectangle, not a pill, and has no animation.

**Headshot (`FSHeadshot`)**
- **Circle:** `border-radius:50%; overflow:hidden; background:#EEEEF1`, `title` = player name (tooltip).
- **Image:** `<img alt=player>` positioned absolute and filling the circle, `object-fit:cover; object-position:50% 15%; transform:scale(1.25) translateY(8%)`.
- **Ring:** `0 0 0 1px #fff, 0 0 0 (1+rw)px <teamColor>`. rw is 2 at size ≥32 and 1.5 below.
  - Total ring is 2.5px at 26/30px and 3px at 34/46/60px.
  - If the team is unknown: `inset 0 0 0 1px rgba(0,0,0,.04)`.
  - The 1px gap is always white, including in dark mode.
- **Initials fallback:** used when `src` is empty, or when the image errors (`onError`, which marks that `src` as failed).
  - Style: 700 weight, `#6E6E73` on `#EEEEF1`.
  - Font size `max(9, round(size×0.36))`: 26→9px, 30→11px, 34→12px, 46→17px, 60→22px.
  - Rule: strip a trailing " D/ST", split on spaces, apostrophes and hyphens (`/[\s'-]+/`), take the first letter of the first and last parts, and uppercase them.
  - Examples: "Ja'Marr Chase" → "JC", "Amon-Ra St. Brown" → "AB", "A.J. Brown" → "AB", "De'Von Achane" → "DA", "Broncos D/ST" → "B".
- **Size:** the runtime fallback is 28 (the prop editor default is 40). Lists always passes a size: 26, 30, 34, 46 or 60.
- **Team colours** (team code is uppercased; `WSH` is an alias of `WAS`):

  | Team | Colour | Team | Colour | Team | Colour |
  |---|---|---|---|---|---|
  | ARI | #97233F | DET | #0076B6 | NE | #002244 |
  | ATL | #A71930 | GB | #203731 | NO | #D3BC8D |
  | BAL | #241773 | HOU | #03202F | NYG | #0B2265 |
  | BUF | #00338D | IND | #002C5F | NYJ | #125740 |
  | CAR | #0085CA | JAX | #006778 | PHI | #004C54 |
  | CHI | #0B162A | KC | #E31837 | PIT | #FFB612 |
  | CIN | #FB4F14 | LV | #000000 | SF | #AA0000 |
  | CLE | #FF3C00 | LAC | #0080C6 | SEA | #002244 |
  | DAL | #003594 | LAR | #003594 | TB | #D50A0A |
  | DEN | #FB4F14 | MIA | #008E97 | TEN | #4B92DB |
  | | | MIN | #4F2683 | WAS / WSH | #5A1414 |

- **Photos:** the `HEAD` map (line 314) gives photos to 14 players only, at `assets/headshots/<key>.jpg`: Bijan Robinson, A.J. Brown, Alvin Kamara, James Conner, Shedeur Sanders, Jameson Williams, Isiah Pacheco, Evan Engram, Darnell Mooney, Braelon Allen, Cole Kmet, Adonai Mitchell, Jaylen Wright, Jahan Dotson.
  - `allen.jpg` is **Braelon** Allen, not Josh Allen.
  - The folder's other 6 jpgs (blue, hill, johnson, kolar, tucker, watson) are unused.
  - Everyone else shows initials.

**Position colours**

Chip background / chip text / text-on-white, per the README:

| Pos | Chip bg | Chip text | Text on white |
|---|---|---|---|
| QB | #F75252 | #fff | #E03E3E |
| RB | #5C7CE5 | #fff | #4A68D4 |
| WR | #9D70E9 | #fff | #8656D8 |
| TE | #ECAD48 | #fff | #C98A1F |
| K | #D2E8E8 | #1D1D1F | #5E8C8C |
| D/ST | #FFE75E | #1D1D1F | #A68A00 |

The code key "DST" is always displayed as "D/ST".

**Tier colours (`TIERC`, line 320)**
- Tier 1 #4A68D4, Tier 2 #8656D8, Tier 3 #07A852, Tier 4 #C98A1F, Tier 5 #E03E3E, Tier 6 #5E8C8C.
- Tier 7 and Tier 8 are `var(--x-t3,#6E6E73)`. Tier 9+ falls back to the same `t3` (lines 511, 547).
- Grey from Tier 7 on does **not** cycle back to blue.

**Time-frame segmented control** (editor and list view)
- Track: `display:flex`, padding 2, radius 999, bg `b2`.
- Segments: 24px tall, padding `0 10px`, radius 999, 11/600, nowrap.
- On: `t1` text on `b0` with `0 1px 2px rgba(0,0,0,.12)`. Off: `t3` text, transparent, no shadow.
- Order: "Week 5" | "Last 3" | "Season" (values `w5` / `l3` / `season`).

#### 2.1 Lists grid (`scr:"lists"`)

1. **Root header** (above).
2. **Scroller:** `flex:1; overflow-y:auto`, scrollbar hidden.
   - **Title "Lists":** wrapper padding `12px 16px 0`, 26/700, letter-spacing -0.03em.
   - **Tabs row:** flex, gap 18, padding `0 16px`, margin-top 6, `border-bottom:1px solid b3 (#EBEBEE)`. It does not scroll horizontally.
     - Each tab: 38px tall, 14/600, `flex:none`.
     - Active: `t1` text, underline `box-shadow: inset 0 -2px 0 ink(#1D1D1F)`.
     - Inactive: `t3` text, transparent underline.
     - Labels: "My lists", "Saved".
   - **Grid:** padding `14px 16px 24px`, `grid-template-columns: repeat(2, minmax(0,1fr))`, gap `14px` (rows) × `10px` (columns). Each column is 174px wide at 390.
     - **"New list" tile** (My lists only, first cell):
       - Square (`aspect-ratio:1`, 174×174), radius 14, outline `inset 0 0 0 1.5px b4 (#D1D1D6)`, no fill.
       - Centred column, gap 8, colour `#0088FF`.
       - A 40px circle, bg `gb` #E6F2FF, with a plus icon 16px, stroke 2.4.
       - Label "New list" 13/600.
       - No title or meta below the tile.
     - **List card:** flex column, gap 6, `min-width:0`, whole card tappable.
       - **Cover:** square, radius 14, `overflow:hidden`, `position:relative`. Background is the list colour, or `ink` when an image is shown.
         - *Collage (no image):* a centred grid with `grid-template-columns:repeat(2,46px)`, gap 6, showing the first 4 players' **46px** headshots. A full 2×2 block is 98×98.
           - The grid always has two 46px columns, so 1 or 3 heads are **off-centre**. One head sits in the left column of a centred 98×46 block. With 3 heads, the third sits bottom-left.
           - 0 players leaves a plain colour square.
         - *Image:* absolute inset 0, `background-size:cover; background-position:center`. The image is the upload, or the YouTube `hqdefault.jpg` when the thumbnail is "video".
         - *Video badge* (whenever `l.video` exists, even without a YouTube id):
           - Absolute `top:8px; left:8px`, 20px tall, padding `0 7px`, radius 999, gap 4.
           - 10/600 white on `rgba(0,0,0,.6)`.
           - Filled play icon 8px (`M4.5 2.8v10.4L13 8z`), then the text "Video".
       - **Title:** 13/600, line-height 1.25, `text-wrap:pretty`. Not clamped; long titles wrap to several lines. An empty title renders as an empty line.
       - **Meta:** 11/500 `t3` (formats in §5).
   - Then the 84px dock spacer, so the last card has 24 + 84px of clearance.
3. **Dock.**

#### 2.2 New list, step 1 (`scr:"lsNew"`)

1. **Header:** 52px, padding `0 12px`, gap 8, `border-bottom:1px solid b3 (#EBEBEE)`.
   - **Left:** 36×36 round hit area, no fill. ✕ icon 14px (`M4 4l8 8M12 4l-8 8`, stroke 2.2, round caps, `t1`).
   - **Centre:** 16/600 "New list" ("Edit details" when `ed.id` is set), flex 1, centred.
   - **Right:** a 36px-wide, right-aligned, 12/600 `t3` "1 of 2" (empty when `ed.id`).
   - No progress bar, unlike New ranking.
2. **Scroller:** padding 16, flex column, gap 18. No dock spacer.
   - **Name input:**
     - No box, transparent, `font-family:inherit`, `t1`, 22/700, letter-spacing -0.02em, padding `4px 0 10px`.
     - `border-bottom:1.5px solid b3`; the fallback here is #E5E5EA.
     - Placeholder "List name, like My top 5 QBs for Week 6", in #6E6E73 (global CSS, not themed).
     - No `maxlength`, no autofocus, and **Enter does nothing**.
   - **Description textarea:** rows 3, padding 12, radius 12, bg `b1` #F5F5F7, 14/500, line-height 1.4, `resize:none`, no border. Placeholder "Add a description". No `maxlength`.
   - **Thumbnail block:** column, gap 8.
     - Label "Thumbnail" 13/600 `t3`.
     - A 3-column grid, gap 8. Tiles are ≈114×114.
     - Each option is a column, gap 5:
       - A square tile: radius 12, `overflow:hidden`, centred icon 22px (stroke 1.5, round caps and joins).
       - A label below: 11/600 `t2` #3A3A3C, centred.
     - **Options:**
       - **"Player collage":** icon `M2.5 2.5h5v5h-5zM8.5 2.5h5v5h-5zM2.5 8.5h5v5h-5zM8.5 8.5h5v5h-5z` (four squares). Tile bg is the selected colour; icon `#fff`. It shows the icon, not real headshots.
       - **"Upload image":** icon `M8 10.5V3M5 5.5L8 2.5l3 3M2.5 10v3.5h11V10`. Tile bg `b2`, icon `t3`. Once a file has been chosen, the image fills the tile (cover) even when this option is not selected.
       - **"Video frame":** icon `M2.5 4h11v8h-11zM7 6.3v3.4L9.8 8z`. Tile bg `b2`, icon `t3`.
         - With a video attached, the tile shows `https://i.ytimg.com/vi/<id>/hqdefault.jpg` (cover).
         - Without one, the whole option (tile and label) is at opacity .4.
     - **Selected ring:** `0 0 0 2px var(--x-b0,#fff), 0 0 0 4px #0088FF`: a 2px page-colour gap, then a 2px blue ring.
     - A hidden `<input type=file accept="image/*">`. Its value is never reset.
     - **Colour swatches** (only when Player collage is selected): row, gap 8, padding-top 2.
       - Six 24×24 circles: `#0088FF`, `var(--x-t1,#1D1D1F)`, `#F75252`, `#9D70E9`, `#5C7CE5`, `#07B85A`.
       - Selected ring: `0 0 0 2px var(--x-b0,#fff), 0 0 0 3.5px <that colour>`.
       - Default `#0088FF`.
   - **Video block:** column, gap 8. Label "Video" 13/600 `t3`.
     - **No video attached:** a row, gap 8.
       - **Field:** flex 1, 42px tall, padding `0 12px`, radius 12, bg `b2`, gap 8.
         - YouTube badge: 20×14, radius 4, `#FF0028`, white filled play 8px.
         - Input: 14/500, `t1`, transparent, placeholder "Paste a YouTube link".
       - **"Attach":** 42px tall, padding `0 14px`, radius 12, 13/600. With text typed: white on `ink` #1D1D1F. Empty: `t3` on `b3` #E5E5EA.
       - **Error line** under the row (inside the same block): 11/500 `#FF0028` "That doesn't look like a YouTube link".
     - **Video attached** (the link row is removed):
       - Row: padding 8, radius 12, bg `b1`, gap 10.
       - Thumbnail: 96×54, radius 8, bg `ink`, YouTube `hqdefault.jpg` as cover.
       - Text column (gap 1): "YouTube video" 13/600, then the URL 11/500 `t3` on one line with ellipsis.
       - Remove: 30×30 round hit area, `t3`, ✕ 12px stroke 2.2.
3. **Footer** (outside the scroller, pinned): padding `10px 16px 30px`, `border-top:1px solid b2 (#F2F2F4)`.
   - Button: 48px tall, radius 14, 15/600, centred. Label "Next: add players" ("Done" in the edit variant).
   - Enabled: white on `#0088FF`. Disabled look: `t3` on `b3` #E5E5EA (still tappable).
4. No dock and no root header.

#### 2.3 List editor (`scr:"ed"`, `kind:"list"`)

1. **Header:** 52px, padding `0 12px`, gap 8, **no bottom border**.
   - **Back:** 36×36, chevron-left 16px, stroke 2.
   - **Title input:** flex 1, centred, 16/600, `t1`, no placeholder, no border. Editable in place.
   - **Save:** pill, 32px tall, padding `0 14px`, 13/600. For lists it always reads "Save" and is always white on `#0088FF`.
2. **Controls block:** padding `0 16px 10px`, column, gap 10, `border-bottom:1px solid b3 (#EBEBEE)`.
   - **Toggles row:** flex, gap 8. Two equal cards (`flex:1`). **The whole card is the tap target**, not just the switch.
     - Card: 40px tall, padding `0 10px 0 12px`, radius 12, bg `b1`, gap 8. Label 13/600: "Ranked", "Tiers".
     - Switch track: 38×22, radius 999, padding 2, `transition: background .2s linear`.
       - On: bg `#07B85A`, knob at right. Off: bg `b3` #E5E5EA, knob at left.
       - The knob moves via `justify-content` and is **not** animated.
     - Knob: 18×18, `b0`, `0 1px 2px rgba(0,0,0,.2)`.
   - **Stats block:** column, gap 6.
     - Row: "Stats" 13/600 (flex 1), plus the time-frame segmented control on the right. The control shows only when ≥1 stat is selected.
     - **Chips row:** horizontal scroll, hidden scrollbar, gap 6. It sits inside the block's 16px padding, so chips are **clipped at the 16px gutters** and do not bleed to the screen edge.
       - **Stat chip:** 28px tall, padding `0 4px 0 10px`, radius 999, gap 2, 12/600, white on `#0088FF`.
         - The label is **not tappable**. Only the trailing 20×20 round ✕ (9px icon, stroke 2.6) has a handler.
       - **"Add stat" chip:** 28px tall, padding `0 10px`, radius 999, gap 4, 12/600, `t1` text, outline `inset 0 0 0 1.5px b4 (#D1D1D6)`, plus icon 10px stroke 2.4.
   - **Tools row:** horizontal scroll, hidden scrollbar, gap 6. Also clipped at the 16px gutters.
     - Chip: 30px tall, padding `0 12px`, radius 999, gap 5, 12/600, `t1`, nowrap, bg `b2`.
     - Icon 12px, stroke 1.9, round caps and joins.
     - **Chips, in order:**
       - "Add players" (`M8 3v10M3 8h10`)
       - "Import a ranking" (`M3 3.5h10M3 8h6M3 12.5h4M11 9v5M8.5 11.5L11 14l2.5-2.5`)
       - "Auto tiers" (`M3 4h10M3 8h7M3 12h4`), only if Tiers is on
       - "Add tier line" (`M2.5 8h11M8 5v6`), only if Tiers is on
   - **Info line:** 11/500 `t3`, `"<n> players · drag to reorder"`. This includes "0 players…" and "1 players…".
3. **Rows scroller:** flex 1, padding `4px 12px 24px`. No dock spacer.
   - **Empty state:** padding `48px 20px`, centred column, gap 12, centred text.
     - "No players yet" 15/600.
     - Body 13/500, line-height 1.4, `t3`, `text-wrap:pretty`: "Add players, or import a ranking to bring in players in order with tiers."
     - Button "Add players": 40px tall, padding `0 18px`, radius 999, 14/600, white on `#0088FF`.
     - With Tiers on, any tier lines still render below this block (state L4g).
   - **"Tier 1" header** (Tiers on and ≥1 player):
     - Padding `10px 4px 4px`, gap 8.
     - "Tier 1" 12/700 `#4A68D4`, then a flex-1, 1px line in `b3`. The line is grey, not tier-coloured, unlike Tier 2+.
     - Not draggable, not removable, not a drop target.
   - **Each item** sits in a wrapper div:
     - `draggable="true"`, `border-radius:10px`, no padding.
     - `box-shadow: inset 0 2px 0 #0088FF` while it is the drag-over target, `none` otherwise.
     - **Visibility caveat:** an inset shadow paints above the wrapper's own background but beneath its children. The player row inside fills the wrapper and has an opaque `background: b0`, so **the indicator is hidden on player rows**. It shows only on tier-line rows, which have no background. There it follows the 10px corner radius.
     - Intended (per the code) is a 2px blue line at the top of the target row.
   - **Tier line (Tier 2+):** padding `12px 4px 4px`, gap 8, `cursor:grab`.
     - A 6-dot grip, 12px, `t5` #AEAEB2 (dots r 1.2 at x 5.5/10.5, y 4/8/12).
     - Label "Tier N", 12/700, in the tier colour.
     - A flex-1, 1px line in the tier colour at opacity .35.
     - ✕: 24×24 round, `t3`, 10px icon stroke 2.4, `title="Merge tiers"`.
   - **Player row:** min-height 46, padding `4px 8px 4px 4px`, gap 9, `border-bottom:1px solid b2 (#F2F2F4)`, bg `b0`, `cursor:grab`.
     - **Rank number:** only when Ranked is on. 22px wide, 14/700, centred. It counts players only, not tier markers.
     - **Headshot:** 26px.
     - **Name block** (flex 1, gap 2):
       - Short name, 14/600, ellipsis ("J. Allen"; D/ST names unchanged).
       - Sub line, 11/500 `t3`, gap 5: a **position chip** (16px tall, padding `0 5px`, radius 4, 9.5/700, chip colours), then `"BUF · Bye 7"`.
     - **Stat mini-columns:** 3 columns, each 36px wide, gap 2 (column gap 1).
       - Value 12/600 `t1`; label 9/500 `t3`.
       - Always **Pts / Avg / Pos rk**, whatever stats the list has selected.
     - No delta column (that is for rankings). No handles, no up/down arrows, no delete.
       - `up`, `down` and `remove` are computed (line 514) but never bound.
     - No hover or pressed state.
4. No footer and no dock.

#### 2.4 Add players sheet (`sheet:"pick"`)

- **Header:** title "Add players", subtitle `"<n> in your list"` (live count of players), button "Done".
- **Top block:** padding `0 16px 8px`, column, gap 8.
  - **Search field:** 40px tall, padding `0 12px`, radius 12, bg `b2`, gap 8.
    - Magnifier 15px `t4` #8E8E93 (circle cx 7 cy 7 r 4.8, plus `M10.6 10.6L14 14`, stroke 1.8).
    - Input 15/500 `t1`, placeholder "Search players". **Not auto-focused**, including when the sheet auto-opens after "Next".
  - **Position chips:** horizontal scroll, gap 6, clipped at the 16px gutters.
    - Each chip: 30px tall, padding `0 12px`, radius 999, 12/600.
    - Selected: white on `ink`. Unselected: `t1` on `b2`.
    - Chips: "All", "QB", "RB", "WR", "TE", "K", "D/ST". Default "All".
- **Rows:** scroller padding `0 16px 30px`. Sorted by Scout AI overall rank.
  - Each row: padding `8px 0`, gap 10, `border-bottom:1px solid b2`. **The whole row is tappable.**
  - Headshot 34px.
  - Text column (gap 1):
    - Full name 14/600, ellipsis.
    - Sub line: position 11/600 in the text-on-white colour, a space, then 500-weight `t3` `"CIN · Scout AI #1"`. The full line reads "WR CIN · Scout AI #1".
  - Right: a 28×28 circle with a white 12px icon (stroke 2.6, round).
    - Not in the list: bg `ink`, plus icon (`M8 3.5v9M3.5 8h9`).
    - In the list: bg `#0088FF`, check icon (`M3 8.5l3.2 3L13 4.5`).
- **No matches:** the list area is simply empty. There is no copy.

#### 2.5 Add stats sheet (`sheet:"stats"`)

- **Header:** title "Add stats", subtitle `"<n> selected · shown as columns in your list"`, button "Done".
- **Body:** scroller padding `0 16px 30px`, column, gap 14.
- **Six groups,** each a column with gap 8. Group label 13/600 `t3`. Options wrap with gap 6.
- **Option chip:** 32px tall, padding `0 12px`, radius 999, 13/600. Selected: white on `#0088FF`. Unselected: `t1` on `b2`.
- **Groups and labels (25 stats):**

  | Group | Stats |
  |---|---|
  | Rankings | ECR, Scout AI, Users, Pos rk |
  | Fantasy | Proj, Pts, Avg pts |
  | Usage | Snap %, Tgt share, Route %, Rush share |
  | Receiving | Tgt, Rec, Rec yds, YAC, aDOT, YPRR |
  | Rushing | Rush att, Rush yds, YCO/att, RYOE |
  | Passing | Pass yds, Pass TD, Cmp %, Int |

#### 2.6 Import a ranking sheet (`sheet:"import"`)

- **Header:** title "Import a ranking", subtitle "Brings in players in order, with their tiers". The button reads **"Cancel"** but is still blue-filled.
- **Body:** scroller padding `0 16px 30px`, column, gap 8.
- **Option card:** padding `12px 14px`, radius 14, bg `b1`, gap 12, whole card tappable.
  - Tile: 34×34, **radius 10** (a rounded square), initials 11/700 white on the option colour.
  - Text column (gap 2): label 14/600, sub 11/500 `t3` on one line with ellipsis.
- **Options, in order (8 with the sample data):**

  | # | Label | Tile | Sub |
  |---|---|---|---|
  | 1 | "Scout AI · Week 5 · QB" | "QB" on #F75252 | "J. Daniels, J. Allen, L. Jackson…" |
  | 2 | "Scout AI · Week 5 · RB" | "RB" on #5C7CE5 | "J. Gibbs, B. Robinson, S. Barkley…" |
  | 3 | "Scout AI · Week 5 · WR" | "WR" on #9D70E9 | "J. Chase, J. Jefferson, P. Nacua…" |
  | 4 | "Scout AI · Week 5 · TE" | "TE" on #ECAD48 | "T. McBride, B. Bowers, G. Kittle…" |
  | 5 | "Experts · Rest of season · RB" | "EC" on `ink` | "Top 10 consensus" |
  | 6 | "Mine · Week 5 · RB · PPR" | "D" on #0088FF | "15 players · Submitted" |
  | 7 | "Mine · Rest of season · WR · PPR" | "D" on #0088FF | "15 players · Saved" |
  | 8 | "Mine · Week 4 · QB · PPR" | "D" on #0088FF | "10 players · Submitted" |

  - Rows 1–4: the sub is the top-3 short names joined with ", " plus "…".
  - Rows 6–8 come from the session's `myRanks`. A ranking saved in this session is added at the top of this group. The sub is `"<player count> players · " + (status==="submitted" ? "Submitted" : "Saved")`, using the raw status.
  - Row 8 is a past week, which `rStatus` elsewhere would call "Finalized", but here it says "Submitted".
  - The count is the whole ranking. The import takes only the first 14 items (see §5).

#### 2.7 List view (`scr:"lv"`)

One vertical scroller with `padding-bottom:24px`, plus the 84px dock spacer.
- There is no header bar. The 50px status bar keeps the page `b0` background; the cover starts directly under it and does not run behind it.
- **Back and Edit live inside the cover and scroll away with it.** Once the cover has scrolled off, there is no back or edit control on screen. There is no sticky or collapsing header.

1. **Cover:**
   - 200px tall, full width, `position:relative; overflow:hidden`. Background is the list colour, or `ink` for an image.
   - *Collage:* a centred grid with `repeat(2,60px)`, gap 8 (a 128×128 block), showing the first 4 players' **60px** headshots. The same off-centre behaviour as the grid applies for 1 or 3 players. 0 players gives a plain colour block.
   - *Image:* full cover.
   - **Back:** absolute `top:10px; left:12px`, 36×36 circle, white chevron 16px (stroke 2), bg `rgba(0,0,0,.35)`.
   - **Edit** (own lists only): absolute `top:10px; right:12px`, 36px tall pill, padding `0 14px`, 13/600, white on `rgba(0,0,0,.35)`, text "Edit".
2. **Info block:** padding `14px 16px 0`, column, gap 8.
   - Title: 22/700, letter-spacing -0.02em, line-height 1.15, `text-wrap:pretty`.
   - Meta: 12/500 `t3`.
   - Description (if any): 14/500, line-height 1.45, `t2` #3A3A3C, `text-wrap:pretty`.
   - **Video card** (if any): padding 8, radius 12, bg `b1`, gap 10, tappable.
     - Thumbnail: 112×63, radius 8, bg `ink`, with the YouTube `hqdefault.jpg` as cover when `yt` is set.
     - Centred red badge: absolute centre, 32×22, radius 6, `#FF0028`, white filled play icon 10px.
     - Text column (gap 2): video title 13/600, line-height 1.3, then "Watch on YouTube" 11/500 `t3`.
3. **Players header row:** padding `18px 16px 8px`, gap 8. Label `"Players · <n>"` 16/600 (flex 1). The time-frame segmented control sits on the right if the list has stats.
4. **Table:** a horizontal scroller (hidden scrollbar) containing an `inline-flex` column with `min-width:100%; padding-right:12px`.
   - Because of that padding, every row's and the header's bottom border **stops 12px short** of the scroll end. With no stats, the row dividers run from x=0 (flush left) to x=378.
   - **Header row** (if stats): 28px tall, `border-bottom:1px solid b3`. **Not vertically sticky**; it scrolls away with the page.
     - Locked cell "Player": `position:sticky; left:0; z-index:2`, width **172px**, full height, bg `b0`, padding-left 16, 10/600 `t3`. **No right hairline.**
     - Stat headers: each `flex:none; width:58px`, centred, 10/600 `t3`, nowrap, labelled as in `STATS`.
   - **Tier row** (if Tiers on):
     - `position:sticky; left:0`, no z-index, no background, width 172px (100% with no stats), padding `12px 0 4px 16px`.
     - "Tier N" 12/700 in the tier colour. No rule line and **no right hairline**.
     - "Tier 1" comes first, only when there are players.
   - **Player row:** 52px tall, `border-bottom:1px solid b1 (#F5F5F7)`. Not tappable.
     - **Locked lead cell:** sticky left 0, z 1, width 172px (100% with no stats), full height, padding-left 16, gap 8, bg `b0`.
       - Right hairline `inset -1px 0 0 b3`, only when there are stats.
       - The vertical divider therefore exists only beside player rows. It is broken at the header cell and at every tier row.
       - **Rank number:** if ranked, 18px wide, 13/700, centred.
       - **Headshot:** 30px.
       - **Name block** (flex 1, `padding-right:8px`):
         - Short name 13/600, ellipsis.
         - Sub line: position 10/600 in the text-on-white colour, a space, then 500-weight `t3` team, e.g. "QB BUF".
     - **Stat cells:** each 58px wide, padding `0 3px`. Inner pill 26px tall, radius 6, bg `b1`, centred 12/600, coloured per §5. Stat cells scroll under the locked cell.
   - **Width example:**
     - 4 stats: 172 + 4×58 + 12 = 416px, so the table scrolls 26px.
     - 3 stats: 358px fits. The container is 390 wide, so the rows end at 378 and the 32px right of the last cell is empty.
5. **Dock.**

---

### 3. Interactions

**Lists grid**
- **Back chevron** (`goProfile`): sets `window.location.href = "FieldScout Mobile.dc.html"` with no hash. The main app's default `scr` is `"league"`, so this lands on League › Match, not Profile.
- **Create (+)** (root header, shown on **both** tabs) and the **"New list" tile** (My lists only): both run `startNewList()`.
  - It sets `scr:"lsNew"` with a fresh draft: `{kind:"list", id:null, title:"", desc:"", thumb:"collage", color:"#0088FF", img:"", video:null, items:[], ranked:true, tiersOn:false, stats:["proj"], tf:"w5", mine:true, link:"", linkErr:false}`.
  - It also closes any sheet.
  - It does **not** change `listTab`.
- **Tabs:** set `listTab` to "mine" or "saved".
  - Nothing else ever resets it; it persists across all Lists screens for the session.
  - **Edge case:** start a list from Saved via (+), save it, then tap Back in the List view. You return to the Saved tab, where the new list is not shown.
- **Card:** sets `scr:"lv", lvId:<id>, lvTf:null`, so the view always opens on the list's own saved time frame.

**New list, step 1**
- **✕** (new list): `go("lists")`. There is no confirmation.
  - The draft is not cleared from `state.ed`, but nothing can reach it again; the next New list overwrites it. In practice it is discarded.
  - In the edit variant, ✕ would return to the editor (`scr:"ed"`).
- **Name and description:** update on every keystroke (`onChange`). Validity is `title.trim() !== ""`.
  - Enter in the name field does nothing (there is no `onKeyDown`).
  - No field is auto-focused.
- **Thumbnail tiles:**
  - **Collage:** selects collage.
  - **Upload:** always calls `this._file.click()`, which opens the system image picker (`accept="image/*"`). The tap **never selects "upload" by itself**, even when an image was already chosen.
    - Only the file input's change event selects it: `img = URL.createObjectURL(file)`, `thumb = "upload"`.
    - Cancelling the picker changes nothing.
    - The input's value is never reset, so **re-picking the same file fires no change**. After switching to Collage, the user cannot get back to the same uploaded image by picking it again; they must pick a different file.
  - **Video frame:** with no YouTube id attached, shows the toast "Attach a YouTube link first" and does not select. Otherwise it selects "video".
  - **Switching back to Collage** keeps the uploaded image in memory, and the Upload tile keeps showing it.
- **Swatch:** sets `color`. The colour is used only for collage covers.
- **Link input:**
  - Typing clears `linkErr`.
  - **Enter** or **Attach** runs validation with `ytId`. The regex `/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([\w-]{11})/` takes the first 11-character id.
  - **Valid:** `video = { url: link.trim(), yt: id, title: "YouTube video" }`, and the input clears. The link row is replaced by the attached card.
  - **Invalid or empty:** `linkErr = true`, which shows the red helper.
  - Attaching does **not** auto-select "Video frame".
- **Remove video (✕):** `video = null`. If the thumbnail was "video", it reverts to "collage". The link row comes back, empty.
- **Next: add players:**
  - **Untitled:** toast "Give your list a name".
  - **Titled:** sets `scr:"ed"` with draft `dirty:true`.
  - If `items` is empty (`!items.length`, which also counts tier markers) and there is no id, the **Add players sheet opens automatically** (`setTimeout 0`, `pick:{q:"",pos:"All"}`).

**List editor**
- **Back:**
  - **New draft (no id):** `scr:"lsNew"`, keeping the draft. The header still reads "New list / 1 of 2".
  - **Existing list:** `scr:"lv", lvId, ed:null`. **Unsaved edits are dropped with no confirmation.** `lvTf` is *not* reset here, so a time-frame override chosen in the view before tapping Edit is still applied.
- **Title input:** edits the title in place. There is no validation, so an empty title can be saved; the card then shows a blank title line.
- **Save:**
  - Assigns an id (`"l"+Date.now()` when new).
  - Stores `{...draft (minus kind), mine:true, updated:"Just now"}` at the **front** of `lists`, replacing the same id.
  - Then sets `scr:"lv"` for that id with `lvTf:null`.
  - Toast "List saved".
  - Works with 0 players (state L8g).
- **Ranked toggle** (tap anywhere on the card): toggles `ranked`, which shows or hides the number column in both the editor and the view.
- **Tiers toggle** (whole card): toggles `tiersOn`.
  - On: shows the "Tier 1" header (if there are players), all tier markers, and the "Auto tiers" and "Add tier line" tools.
  - Off: hides the markers but keeps them in `items`, so turning Tiers back on restores them.
- **Time-frame segment:** sets `ed.tf` (`w5` / `l3` / `season`). It is saved with the list as the view's default time frame.
- **Stat chip ✕** (the 20×20 target only): removes that stat. When none are left, the segmented control disappears.
  - Stat columns **cannot be reordered** except by removing and re-adding (re-adding appends to the end).
- **Add stat:** opens the Add stats sheet.
- **Add players** (tool chip or empty-state button): opens the Add players sheet with `{q:"", pos:"All"}`. The search and filter reset on every open.
- **Import a ranking:** opens the Import sheet.
- **Auto tiers:**
  1. Takes the current player order and scores each player with `scoreOf(n,"ai","w5","ppr","ALL")` (overall, position-weighted).
  2. Computes consecutive gaps **in the current order**, with no re-sort.
  3. Inserts a break before index i when all of these hold: the gap is greater than 1.55× the mean gap, at least 2 players have passed since the last break, and there are fewer than 7 breaks.
  4. Rebuilds `items` from players only, which **removes every existing tier marker**, and sets `tiersOn:true`.
  5. Toasts "Auto tiers applied. Drag a tier line to adjust."
  - **Edge cases:**
    - With ≤2 players no break is possible, but it still sets Tiers on and shows the same toast.
    - With 0 players it wipes any orphan markers.
    - In a list not sorted by score, some gaps are negative. That skews the mean, so breaks can land almost anywhere, up to the 7-break cap.
- **Add tier line:** appends a tier marker at the **end** of `items` and sets `tiersOn:true`. The user then drags it into place. Until moved, it creates an **empty last tier** whose header has no players under it.
- **Tier line ✕ ("Merge tiers"):** removes that marker, which merges the two tiers. Later tiers renumber and recolour.
- **Drag to reorder** (HTML5 drag and drop on each row wrapper, both player rows and Tier 2+ lines; the whole row is the handle, `cursor:grab`):
  - **dragstart:** stores the source index, sets `dataTransfer.effectAllowed = "move"` and `setData("text/plain", index)`.
  - **dragover:** `preventDefault()` (every row wrapper is a drop target), then `dragOver = target index`. This should draw the 2px blue top line, but it is only visible on tier rows (§2.3).
  - **No `dragleave` handler.** The last hovered row keeps the indicator until drop or dragend, including while the pointer is outside all rows.
  - **drop:** `splice` out of `from`, `splice` into the target index. The moved item takes the target's index:
    - Moving **up**, it lands **above** the target.
    - Moving **down**, it lands **below** the target. The indicator still shows a top line, so it **misplaces the drop position** when moving down.
    - Dropping on itself does nothing.
  - **dragend:** clears the indicator.
  - **Indexes are full-array indexes,** so hidden tier markers (Tiers off) still occupy slots. Dragging a player past a hidden marker silently changes which tier it is in when Tiers is turned back on.
  - The "Tier 1" header and the empty state are neither draggable nor drop targets. Moving a player above the first marker puts it in Tier 1.
  - **Empty tiers are never cleaned up.** Any of these leaves an empty "Tier N" header in the editor, and in the view if saved:
    - dragging a tier line to the very top
    - two lines next to each other
    - a trailing line
    - removing the players between two lines
  - HTML5 drag and drop does **not** fire on iOS touch. There are no touch or pointer handlers anywhere (see §7).

**Add players sheet**
- **Search:** filters on every keystroke. A player matches if the query is a case-insensitive substring of the full name **or** exactly equals the team abbreviation (case-insensitive). "buf" returns all BUF players.
  - The query is **not trimmed**: " buf" matches no team, and a leading space breaks name matches that don't contain one.
- **Position chips:** single-select filter. "All" shows everything.
- **Row tap:** toggles membership and sets `dirty:true`.
  - Adding appends the player to the end of `items`.
  - Removing deletes that player only, which can leave a leading or doubled tier marker. Example: remove both players above l3's marker and you get an empty Tier 1.
  - This is **the only way to remove a player from a list**.
  - The subtitle count and the ✓/+ update live. The sheet stays open after each add.
- **Done** or **backdrop tap:** only closes (`sheet:null`). Changes were already applied, so Done commits nothing.

**Add stats sheet**
- **Chip tap:** toggles the stat immediately. New stats are **appended**, so selection order is column order. There is no maximum.
- **Done** or backdrop: closes only.

**Import sheet**
- **Option tap:**
  1. Takes the source items:
     - Scout AI options: Scout AI W5 PPR top 10 for that position (with its tier markers).
     - Experts option: Experts ROS PPR RB top 10.
     - Mine options: `myRanking.items.slice(0,14)`, the first 14 *items* including markers.
  2. Drops players already in the list.
  3. Removes markers that are first or that follow another marker. A **trailing marker is not removed** (e.g. importing Scout AI QB when Shedeur Sanders is already in the list leaves a trailing empty tier).
  4. Sets `items = [...existing, (existing.length ? TierMarker : nothing), ...clean]`. `existing.length` counts markers too.
  5. **Forces `ranked:true, tiersOn:true`** (even if the user had Ranked off) and closes the sheet.
  6. Toasts `"Added <k> players from Scout AI"`, `"…from the experts"` or `"…from your ranking"`.
  - If every player was a duplicate, the toast says "Added 0 players…" and the separator marker is still appended, giving an empty trailing tier.
- **Cancel** or backdrop: closes. Nothing has changed, so there is nothing to revert.

**List view**
- **Back:** `go("lists")`. It keeps `listTab`, so it returns to whichever tab was last selected.
- **Edit** (own only): opens the editor on a copy of the list (`items` sliced, `link:""`, `linkErr:false`).
- **Video card:** `window.open(video.url, "_blank")`. For l2 that is `https://youtube.com/`.
- **Time-frame segment:** sets `lvTf`, a session-only view override. It is not saved. It resets when the list is opened from the grid or after Save, but not when returning from the editor via Back.
- **Table:** scrolls horizontally while the player column stays locked. Rows, headshots and names are not tappable (no player card).

**Animations**
- The only animation is the switch track, `background .2s linear`.
- Sheets, toasts, the drag indicator, tab changes and screen changes are all instant.
- The README's global rule is linear, about 200ms, on colour, opacity, width and transform.

---

### 4. Navigation

```
Main app Home › "My stuff" › "Lists" tile ("3 lists")       ──► main app Profile (scr "me", meTab "lists")   [main app 1715]
Main app Profile › My stuff [Lists tab = default meTab]
      any of the 3 preview rows                               ──► Lists file #lists     ──► Lists grid (whatever listTab → "mine" on load)   [main app 1812]
      "New list" button (meNew)                               ──► Lists file #new-list  ──► New list step 1                                  [main app 1816]
Lists grid   [‹]  ──► FieldScout Mobile.dc.html (no hash → League › Match)
             [+] (either tab) / "New list" tile ──► New list step 1
             card ──► List view
New list     [✕]  ──► Lists grid (draft abandoned)          Next ──► Editor (+ Add players sheet if items empty)
Editor (new) [‹]  ──► New list step 1 (draft kept)          Save ──► List view of the new list + "List saved"
Editor (existing) [‹] ──► List view (edits discarded)       Save ──► List view + "List saved"
List view    [‹]  ──► Lists grid (last listTab)   Edit ──► Editor   video card ──► YouTube URL (new tab)
Dock (grid, view): Home / Community / Leagues ──► FieldScout Mobile.dc.html (League › Match);  Profile ──► Rankings hub (scr "rk")
```

**Deep links** (read once in `componentDidMount`, line 368)
- `#lists` → `scr:"lists"`.
- `#new-list` → `scr:"lsNew"` with the default draft.
- No hash → the Rankings hub (`scr:"rk"`).
- There is no hash for a specific list view or for the editor.
- After arriving via `#new-list`, ✕ goes to **this file's** Lists grid, not back to the main app.

**No history or URL updates**
- Every screen change is `setState` only. There is **no `hashchange` listener and no `history.pushState`**, so the URL never changes after load; it stays `#lists` or `#new-list` if the page arrived with one.
- Browser or OS back therefore leaves this file entirely, back to the page that linked here.
- Reload returns to the hash's screen and **re-seeds the state**: lists created or edited in the session, and uploaded images (object URLs), are lost. Only the theme survives, in localStorage.
- A Next.js rebuild must define real routes for the grid (and tab), the New list step, the editor, and the list view.

**Rankings ↔ Lists inside this file**
- There is **no visible control** between them. A "Rankings | Lists" `rootSeg` is computed (line 415) but never rendered.
- The dock's Profile tab goes to `scr:"rk"`.
- Lists is reachable only by hash, by the dev jump panel, or from inside the Lists flow.

**Dock behaviour per screen**
- **Lists grid and List view:** dock shown, with Home, Community, Leagues and Profile (avatar "D", always styled active).
- **New list and Editor:** no dock and no root header.
- **Sheets:** cover the whole phone, including the status bar.
- This dock says **"Leagues"** (trophy), where the README says "Players". It is also 84px with padding `8px 8px 26px`, where the README says 80px with padding `6px 8px 0` (see §7).

**Other main-app entries** (outside this flow)
- **Community › Create sheet › "List"** ("Group players for research, targets or stashes") opens a **different** list composer inside the main app: `cmp:{kind:"list", step:1, name, desc, pub:true, players, videos, link, color:"#0088FF"}`. Its name field *does* advance on Enter. The README says, "Lists use the composer in this file."
- **Community › Lists** has its own masonry grid and detail page.
- **Player profile "+ List"** (main app line 752, `title="Add to list"`) only shows the toast `"Choose a list for <name>"` (main app line 1291). There is no list-picker flow.
- None of these link into this file's Lists.
- The main app's Profile preview rows are **hard-coded** (main app line 1812) and never reflect lists saved here:
  - "My top 5 QBs for Week 6" / "5 players · Ranked · Updated 2d ago"
  - "5 players not to draft" / "5 players · Video · Updated Aug 20"
  - "RB handcuffs, tiered" / "4 players · Tiers · Updated Oct 12"

  Their sub format (with Ranked / Video / Tiers) differs from this file's grid meta.

**Dev-only jump panel** (outside the phone)
- A "Dark mode" switch row at the top: the only theme control for Lists screens.
- Under the heading "Lists", items numbered 11–17:
  - "My lists": `go("lists")`
  - "List view": opens `l1`
  - "New list: details": `startNewList()`
  - "List editor": `lists[0]` in the editor. After a save, that is the most recently saved list.
  - "Add stats", "Import a ranking", "Add players": each opens `lists[0]` in the editor, then that sheet.

---

### 5. Data shown

**Seed lists.** All placeholder; the owner handle is `@dalton`.

| id | Title | Description | Cover | Video | Players (order) | Ranked | Tiers | Stats (column order) | tf | Mine / by | Updated |
|---|---|---|---|---|---|---|---|---|---|---|---|
| l1 | My top 5 QBs for Week 6 | Who I'd start in a 1QB league this week. Allen and Lamar are a coin flip. | collage #F75252 | – | Josh Allen, Lamar Jackson, Jalen Hurts, Jayden Daniels, Joe Burrow | yes | no | Proj, Pass yds, Pass TD, Rush yds | Last 3 | mine | 2d ago |
| l2 | 5 players not to draft | Going too early for what the usage says. | collage `var(--x-t1)` (black; **white in dark**) | url `https://youtube.com/`, `yt:null`, title "Why I'm fading these five" | Travis Kelce, Derrick Henry, Alvin Kamara, Patrick Mahomes, Isiah Pacheco | no | no | Snap %, Tgt share, Rush share, YCO/att | Season | mine | Aug 20 |
| l3 | RB handcuffs, tiered | Bench stashes ranked by how much the role grows if the starter goes down. | collage #5C7CE5 | – | Tyler Allgeier, Braelon Allen, │tier│, Jaylen Wright, Isiah Pacheco | yes | yes | Snap %, Rush share, Rush att, RYOE | Last 3 | mine | Oct 12 |
| l4 | Buy-low WRs after Week 4 | Targets are there, the points haven't caught up yet. | collage #9D70E9 | – | Garrett Wilson, DK Metcalf, Zay Flowers, Rome Odunze | no | no | Tgt share, aDOT, YPRR | Season | **@kellyscouts** (Saved tab) | 3h ago |

**l2 in the UI.** The grid shows the "Video" badge. The view's video card shows an `ink` thumbnail with only the red play badge, the title "Why I'm fading these five", and "Watch on YouTube", which opens `https://youtube.com/`.

**Photos in the seeds.** Collage photos appear for Kamara and Pacheco (l2), and Braelon Allen, Jaylen Wright and Pacheco (l3). All others show initials.

**Grid order.** Array order. A saved list moves to the front, so the order is most recently saved first, then the seed order l1, l2, l3 (l4 sits on Saved).

**Field formats**
- **Grid card meta:**
  - Mine: `"<n> players · Updated <updated>"`, e.g. "5 players · Updated 2d ago".
  - Saved: `"<n> players · <@author>"`, e.g. "4 players · @kellyscouts".
  - Counts are players only, never tier markers. "players" is never singular ("1 players", "0 players").
- **Updated:** relative values ("Just now" after a save, "3h ago", "2d ago") or a short date ("Aug 20", "Oct 12). The cut-over rule is not defined.
  - After a save the copy reads "… · Updated Just now", with a **capital J mid-sentence**, in both the grid and the view.
- **List view meta:** `"<@dalton | @author> · <n> players · <Ranked|Unranked> · Updated <updated>"`.
  - Examples: "@dalton · 5 players · Ranked · Updated 2d ago" and "@kellyscouts · 4 players · Unranked · Updated 3h ago".
- **Count label:** `"Players · <n>"`.
- **Short name:** first letter + ". " + every word after the first ("A.J. Brown" → "A. Brown", "Amon-Ra St. Brown" → "A. St. Brown", "Ja'Marr Chase" → "J. Chase"). D/ST names are unchanged ("Broncos D/ST").
- **Editor sub line:** `"<TEAM> · Bye <n>"`, e.g. "BUF · Bye 7".
- **Editor mini-stats** (season to date, independent of the list's stats and time frame):
  - Pts = season total, 1 decimal ("95.5").
  - Avg = season average, 1 decimal ("23.9").
  - Pos rk = position label + rank by season points ("QB3", "RB15", "D/ST2").
  - l1 examples: J. Allen 95.5 / 23.9 / QB3; J. Hurts 100.4 / 25.1 / QB1.
- **Pick sheet:**
  - Players are sorted by the **Scout AI Week 5 PPR overall** rank. Overall scores are weighted QB×.72, RB×1, WR×1, TE×.9, K×.55, D/ST×.55.
  - The top 5 are #1 Ja'Marr Chase CIN, #2 Jahmyr Gibbs DET, #3 Bijan Robinson ATL, #4 Saquon Barkley PHI, #5 Justin Jefferson MIN.
  - The sub line shows `"Scout AI #<overall rank>"`.
  - The pool is all 54 sample players: 10 QB, 15 RB, 15 WR, 8 TE, 3 K, 3 D/ST.
- **Import results** (prototype data; `|` = tier break):

  | Source | Players |
  |---|---|
  | Scout AI QB | Daniels, Allen, Jackson, Burrow, Hurts, Mahomes \| Mayfield, Nix, Fields \| Sanders |
  | Scout AI RB | Gibbs, Robinson, Barkley, McCaffrey \| Kamara, Taylor, Henry, Achane, K. Williams, Conner |
  | Scout AI WR | Chase, Jefferson, Nacua, Lamb, **A.J. Brown, Amon-Ra St. Brown**, Wilson \| Nabers, Flowers, Jameson Williams |
  | Scout AI TE | McBride, Bowers, Kittle, Warren, Kincaid, Kelce, Engram, Kmet (8 players, no break) |
  | Experts ROS RB | Robinson, Gibbs, Barkley, Achane, Taylor, McCaffrey \| Henry, Kamara, K. Williams, Hubbard |
  | Mine · Week 5 · RB · PPR (`slice(0,14)`, 12 players) | Gibbs, Robinson, Barkley, McCaffrey \| Kamara, Taylor, Henry, Achane, K. Williams, Conner, Hubbard \| B. Allen |
  | Mine · Rest of season · WR · PPR (12 players) | Chase, St. Brown, Nacua \| Jefferson, Lamb, A.J. Brown, Wilson, Nabers, Metcalf, Flowers, Odunze \| J. Williams |
  | Mine · Week 4 · QB · PPR (10 players) | Allen, Daniels, Jackson, Burrow, Hurts, Mahomes, Fields, Mayfield, Nix \| Sanders |

**Tiering rule (`breaks`)**, used by Import, the seeded rankings and Auto tiers:
- Gaps are consecutive score differences in the given order.
- A break goes before index i when the gap is greater than 1.55 × the mean gap, the tier has ≥2 players, and there are fewer than 7 breaks.
- Tier labels count from the top: the first explicit marker shows as "Tier 2".

**Stat value rules (`statv(name, key, tf)`)**, which drive the List view table:

| Stat(s) | Format | Rule (prototype) | Uses the time frame? |
|---|---|---|---|
| ECR, Scout AI, Users, Pos rk | Integer rank string "1", "12". "Bye" if the player is not in that ranking. | Player's rank within **their own position** in that source's **Week 5 PPR** ranking. Pos rk = the ECR rank. **No sample player has a Week 5 bye**, so "Bye" never renders with the sample data; don't expect it in QA. | **No**: always Week 5 PPR |
| Proj | 1 decimal, "20.6" | base × jitter (0.8–1.2) | Only through the random seed, so the value changes per time frame (an artifact) |
| Pts | 1 decimal | Week 5 = one game; Last 3 = 3-game total; Season = season total (3–4 games) | Yes |
| Avg pts | 1 decimal | Season average | **No** |
| Snap %, Cmp % | Integer + "%", capped at 99 | base × (0.85–1.05) | Seed only |
| Tgt share, Route %, Rush share | Integer + "%", capped at 99 | base × quality × jitter | Seed only |
| aDOT, YCO/att | 1 decimal, "11.4", "2.8" | base × jitter | Seed only |
| YPRR | **2 decimals**, "1.76" | base × quality × jitter | Seed only |
| RYOE | Signed integer: "+5", "0", "-3" (ASCII hyphen) | round((r−.35)×14×G/2) | Yes (via G) |
| Tgt, Rec, Rec yds, YAC, Rush att, Rush yds, Pass yds, Pass TD, Int | Integer, "907" (no thousands separator, so "1594") | base × quality × jitter × G | Yes: G = 1 (Week 5), 3 (Last 3), 5 (Season) |
| Any stat not defined for the position | "–" (en dash U+2013) | — | — |

**Position applicability (`PG`).** Rankings and Fantasy stats apply to everyone.

| Pos | Applicable stats |
|---|---|
| QB | Pass yds, Pass TD, Int, Rush att, Rush yds, Cmp %, aDOT, Snap % |
| RB | Rush att, Rush yds, YCO/att, RYOE, Rush share, Snap %, Tgt, Rec, Rec yds, YAC, Tgt share, Route %, aDOT, YPRR |
| WR | Tgt, Rec, Rec yds, YAC, aDOT, YPRR, Tgt share, Route %, Snap %, Rush att, Rush yds |
| TE | Tgt, Rec, Rec yds, YAC, aDOT, YPRR, Tgt share, Route %, Snap % |
| K, D/ST | None, so every usage, receiving, rushing and passing cell is "–" |

**Cell colour rule**, checked in this order:
1. "–" → `t5` #AEAEB2.
2. Starts with "+" → #07A852.
3. Starts with "-" → #FF0028.
4. Otherwise `t1`.

**Example values**
- l1, Last 3 (its default): J. Allen Proj 29.1 · Pass yds 907 · Pass TD 6 · Rush yds 65.
- l1, Season: J. Allen Pass yds 1594.
- l3, Last 3, RYOE: -1, -3, +5, +2.
- l2: Kelce and Mahomes show "–" in Rush share and YCO/att; Mahomes also shows "–" in Tgt share.

**Placeholder vs real**
- **Placeholder:** every stat, rank, projection and Scout AI/Experts/Users order (seeded random); all list content; `@dalton`, `@kellyscouts`; the "Updated" strings; the video title; the import catalogue.
- **Real-looking sample data:** player names, teams and bye weeks.
- **Real:** the YouTube thumbnail URL pattern (`i.ytimg.com/vi/<id>/hqdefault.jpg`).
- **Hard-coded:** the current week is 5 (`CUR_WK`); scoring is always PPR.
- **Not persisted:** all list data lives in component state and is re-seeded on every load.

---

### 6. Dark mode (`.fs-dark` on the phone root)

| Usage in Lists | Var | Light | Dark |
|---|---|---|---|
| Page and status-bar bg, sticky table cells, sheet bg, editor row bg, switch knob, segmented "on" fill, thumbnail and swatch ring gap, **dock avatar outer 3.5px ring** | `--x-b0` | #FFFFFF | #121212 |
| Description field, toggle cards, attached-video card, list-view video card, import cards, stat cell pills, list-view row divider | `--x-b1` | #F5F5F7 | #282828 |
| Root back button, video link field, **Upload and Video-frame thumbnail tiles**, tool chips, unselected position and stat chips, search field, segmented track, editor row divider, **pick-sheet row divider**, New-list footer border | `--x-b2` | #F2F2F4 | #333333 |
| Tab, header and controls dividers, name-input underline, editor "Tier 1" rule, switch off, disabled CTA and Attach, list-view header border and lead hairline | `--x-b3` | #EBEBEE / #E5E5EA | #3E3E3E |
| New-list tile outline, Add stat outline, sheet handle | `--x-b4` | #D1D1D6 | #575757 |
| Tab underline, active Attach, selected position chip, pick "+" circle, toast, image-cover bg, video thumbnail bg, import "EC" tile, dock avatar inner ring | `--x-ink` | #1D1D1F | #4D4D4D |
| Text and status-bar icons, segmented "on" text, **"black" colour swatch and the l2 cover** | `--x-t1` | #1D1D1F | #FFFFFF |
| Description text, thumbnail labels | `--x-t2` | #3A3A3C | #D9D9D9 |
| Meta, labels, inactive tabs and dock items, step label, ✕ icons, **Tier 7+ labels** | `--x-t3` | #6E6E73 | #B3B3B3 |
| Search icon | `--x-t4` | #8E8E93 | #A7A7A7 |
| "–" cells, tier grip | `--x-t5` | #AEAEB2 | #727272 |
| New-list "+" circle | `--x-gb` | #E6F2FF | #12263F |
| Dock | `--x-barA` | rgba(29,29,31,.94) | rgba(18,18,18,.92) |

**The "black" swatch in dark mode.** `var(--x-t1)` becomes white.
- The **l2 cover** (and any list given that colour) becomes a white square with its headshot collage on top. Covers never show the collage icon.
- The white `#fff` icon that disappears is on the New list **"Player collage" thumbnail tile** when that swatch is selected (`bg: E.color`, `ic: "#fff"`, line 527).

**Not themed (identical in dark):**
- `#0088FF`, `#07B85A`, `#FF0028`, `#07A852`, the position and tier colours (Tiers 1–6), and white text on fills.
- The cover buttons `rgba(0,0,0,.35)`, the video badge `rgba(0,0,0,.6)`, and the backdrop `rgba(0,0,0,.4)`.
- The notch pill `#000`.
- Input placeholder #6E6E73 (global CSS).
- Headshot fallback #EEEEF1 / #6E6E73, its 1px **white** ring gap, and team rings. LV's `#000000` ring nearly vanishes on #121212.

**Conflicts with the README in dark mode.** The README gives dark success text #1ED760 and dark danger text #FF6B6B, and `.fs-dark` defines them as `--x-tg` and `--x-tr` (line 19). Lists never uses those variables. So +RYOE stays #07A852, and both −RYOE and the link error stay #FF0028 in dark mode.

**Colour scheme.** `.fs-dark` sets `color-scheme: dark` on the whole phone subtree (line 19). Inputs and textareas also get it explicitly (line 20).

**Theme switch.** The theme is read from `localStorage["fieldscout-theme"]` on mount. The only in-file control is the jump panel's "Dark mode" row, outside the phone (line 29, `toggleDark` line 579), which writes `"dark"` or `"light"`. Nothing inside the phone toggles the theme on any Lists screen.

---

### 7. Gaps, inconsistencies and missing pieces (to resolve at the end)

**Navigation and structure**
1. **Missing files.** The handoff folder lacks `FSHeadshot.dc.html` and `FieldScout Mobile.dc.html`. Headshots fail and every cross-file tap leads to a missing file unless those are added.
2. **No in-app path from Rankings to Lists.** `rootSeg` "Rankings | Lists" is computed but never rendered, and the dock's Profile tab opens Rankings.
3. **Exits go to the wrong place.** The Lists back chevron (`goProfile`) and the Home, Community and Leagues dock tabs all go to the main-app root, which defaults to League › Match. None of them returns to Profile › My stuff › Lists.
4. **Profile rows don't open the tapped list.** All 3 Profile › My stuff › Lists preview rows open the grid. There is no deep link to a single list. The rows are hard-coded and never show real lists, and their sub format differs from the grid meta.
5. **No routing or history.** The hash is read once; there is no `hashchange` listener and no `pushState`. Browser back leaves the file. Reload loses all session lists and images.
6. **List view controls scroll away.** Back and Edit leave the screen with the cover, and there is no sticky header.
7. **Create (+) on the Saved tab** makes a list that the Saved tab then doesn't show when you return to it.
8. **Two list-creation flows and two detail pages.** Creation: the main-app Community composer (with `pub:true` and Enter-to-advance) vs this file. Detail: the Community masonry detail vs this List view.
9. **Player profile "+ List"** only toasts "Choose a list for <name>". Adding a player to a list from outside the editor is undefined.

**Missing features**
10. **"Edit details" is unreachable.** It covers re-editing a saved list's name, description, thumbnail, colour or video; it exists in code, but nothing opens it. Only the title can be changed, in the editor header.
11. **No list management.** There is no delete, duplicate, share or public/private toggle. There is no save/unsave on someone else's list, and no Saved-tab empty state.
12. **No per-row remove in the editor.** Players can be removed only by un-checking them in Add players (`up`, `down` and `remove` are computed but unused). Stat columns can't be reordered, and the stat chip label isn't tappable.
13. **Editor stats don't match the list.**
    - Editor rows always show season Pts / Avg / Pos rk, not the list's chosen stats or time frame.
    - Editor "Pos rk" ("QB3", by season points) differs from the stat column "Pos rk" ("1", by ECR Week 5).
14. **The time frame is applied inconsistently.**
    - Rankings stats ignore it and are always Week 5 PPR. Avg pts ignores it too.
    - Proj changes with it only through the random seed.
    - Season counting stats scale ×5 games, while Season Pts uses 3–4 games.
    - "Bye" never appears with the sample data.
15. **Missing settings and states.** No scoring setting (PPR / Half / Std) for list stats. No pagination or limits for players or stats. No "1 player" singular. No "no results" state in Add players. The search isn't trimmed. Enter in the name field does nothing, and nothing auto-focuses.
16. **Silent loss and weak validation.** Unsaved changes are dropped silently on editor back and on New list ✕. An empty title can be saved from the editor header. A 0-player list can be saved and has no empty state in the view.
17. **Touch drag is needed.** HTML5 drag and drop does not work on iOS touch, so a touch drag pattern is needed (long-press to lift? auto-scroll near the edges? haptics?).
18. **The drop indicator is broken.**
    - It is hidden on player rows by the row's opaque background.
    - It always draws a top line even when the item will land below the target (moving down).
    - It sticks on the last hovered row because there is no `dragleave`.
19. **Tier hygiene.**
    - Empty tiers are never cleaned up (Add tier line appends to the end, plus adjacent or leading markers).
    - Hidden markers still take drag slots while Tiers is off.
    - Tier lines render beneath the "No players yet" empty state.
    - Auto tiers with ≤2 players still toasts success.
    - Auto tiers on an unsorted list places erratic breaks.
20. **Sheets and toasts.**
    - Sheets have no enter/exit animation and no swipe-to-dismiss.
    - "Done" and "Cancel" only close the sheet; changes are already applied.
    - The toast is a full-width rounded rectangle, not the README's "pill".
21. **YouTube validation.**
    - It accepts any domain with a `[?&]v=` parameter of 11 `[\w-]` characters, e.g. `example.com/?v=abcdefghijk`.
    - Ordinary Vimeo URLs (`vimeo.com/<digits>`) are rejected, as they should be.
    - It rejects `youtube.com/live/<id>` and a bare video id.
    - The attached title is always "YouTube video" (no oEmbed lookup), while the seeded list shows a real title.
    - "Video frame" is just YouTube's `hqdefault`, not a chosen frame.
    - One video per list; to change it you must remove it first.
22. **Uploaded images are only an object URL.** No storage, no crop or focal-point control, and no size or type errors. Re-picking the same file after switching away does nothing.
23. **The Import catalogue is hard-coded:** Scout AI W5 QB/RB/WR/TE top 10, Experts ROS RB top 10, and the first 14 items of the user's rankings.
    - The "Mine" sub shows the full player count (15 / 15 / 10) but the import adds 12 / 12 / 10.
    - It labels a past-week ranking "Submitted" where `rStatus` would say "Finalized".
    - Importing 0 new players still toasts "Added 0 players" and adds an empty tier.
    - A trailing marker can survive the import.
24. **Step indicator.** New list shows "1 of 2", but the editor never shows "2 of 2", and there is no progress bar (New ranking has one).
25. **Dark mode issues.**
    - The "black" swatch turns white, which hides the collage icon on the New list tile and gives l2 a white cover.
    - +/− RYOE and the link error don't switch to the README's dark success and danger colours.
    - There is no in-phone theme control.
26. **No loading, error, offline, hover or pressed states** anywhere in Lists.
27. **List-view player rows are not tappable.** There is no player mini card, which conflicts with the app rule that every player click opens the mini card.
28. **Copy.** "Updated Just now" is capitalised mid-sentence.
29. **Collage layout.** A collage with 1 or 3 players is off-centre: the grid has a fixed two columns and fills from the top-left.
30. **Table layout in the List view.**
    - The vertical divider is missing on the header cell and on tier rows.
    - The header row isn't sticky.
    - Row borders stop 12px short of the right edge.
    - Horizontal chip rows in the editor and the pick sheet clip at the 16px gutters instead of bleeding to the screen edge.

**Conflicts between the file and the README**

31. **Dock.** The README says the tab bar is 80px with padding `6px 8px 0` and items Home / Community / **Players** / Profile. This file's dock is 84px with padding `8px 8px 26px` and says **Leagues** (trophy).
32. **Hit targets.** The README says "at least 30px". This file has:
    - stat-chip ✕ 20×20
    - tier-line Merge ✕ 24×24
    - colour swatches 24×24
    - time-frame segments 24px tall
    - stat and Add stat chips 28px tall
33. **Shadows.** The README says "No other shadows" beyond its list (selection ring `inset 0 0 0 2px #0088FF`, outlined card `inset 0 0 0 1px #EBEBEE`, segmented on, menus). This file adds:
    - an outer thumbnail ring `0 0 0 2px b0, 0 0 0 4px #0088FF`
    - a swatch ring `…3.5px <c>`
    - a switch knob `0 1px 2px rgba(0,0,0,.2)`
    - the dock avatar double ring
    - 1.5px `b4` outlines on the New list tile and Add stat
    - a tab underline `inset 0 -2px 0 ink`
    - a drop line `inset 0 2px 0 #0088FF`
    - a lead-cell hairline `inset -1px 0 0 b3`
34. **Tier colours.** The README says tier labels "cycle" through the 6 colours. `TIERC` makes Tier 7, Tier 8 and later grey `t3` instead.
35. **Toast.** The README says "bottom-centered dark pill". This file has a full-width rectangle, radius 14, at bottom 100px.
36. **Dark text colours.** See item 25: #1ED760 and #FF6B6B are not applied.

---

### Open questions
- (Note) Every critic finding was checked against the source and confirmed; none were dropped. Corrected: trophy path (ends at 5.2 7), Scout AI WR import order (A.J. Brown before Amon-Ra St. Brown), drop indicator only visible on tier rows, dark-mode note (the vanishing white icon is on the New-list collage tile, not the l2 cover), color-scheme applies to the whole phone subtree, YouTube regex accepts any domain with ?v=<11> but rejects normal Vimeo URLs.
- Can the handoff folder be completed with FSHeadshot.dc.html and FieldScout Mobile.dc.html, which the README lists but the folder lacks?
- How should a user get from Rankings to Lists (and back) inside the app? The prototype computes a 'Rankings | Lists' segmented control (rootSeg) but never renders it, and the dock's Profile tab goes to the Rankings hub.
- Where should the Lists back chevron go? It is named goProfile but navigates to the main app root, which opens League › Match. Should it return to Profile › My stuff › Lists?
- Should the Lists dock read Home / Community / Leagues / Profile as in this file (trophy icon), or Home / Community / Players / Profile as the README says? Which size wins: 84px with padding 8px 8px 26px (file) or 80px with padding 6px 8px 0 (README)? Which tab should be highlighted on Lists screens?
- What URL should each Lists screen have in the Next.js rebuild (grid and tab, New list step, editor, list view)? Should browser and OS back step through them? The prototype never updates the URL.
- Should Profile › My stuff › Lists rows deep-link to the specific list and show real lists with the grid's meta format? If so, what is the URL scheme for a single list?
- Should the List view have a sticky or collapsing header so Back and Edit stay reachable after the cover scrolls away?
- What should a list with 0 players look like in the List view and the grid? Should Save be blocked with 0 players, or with an empty title in the editor?
- If a list is created from the Saved tab's Create (+), should Lists switch to My lists after saving? Should Create (+) be hidden on Saved?
- How should a user edit a saved list's description, thumbnail, colour or video? The 'Edit details' state exists in code, but nothing reaches it. Should the editor have an 'Edit details' entry?
- Is a per-row remove control (swipe to delete or ✕) wanted in the list editor, or is unchecking in Add players the only intended way to remove a player? Should stat columns be reorderable?
- Should list editor rows show the list's chosen stat columns and time frame instead of the fixed season Pts / Avg / Pos rk? Which 'Pos rk' is correct: the season-points rank ('QB3') or the ECR rank ('1')?
- What do the time frames mean for the current week? Is 'Week 5' the current week (projections or live) or the last completed week? Should the label follow the real current week? Should the Rankings stats (ECR / Scout AI / Users / Pos rk) and Avg pts respond to the time frame?
- Which scoring format (PPR / Half / Standard) should list stats like Proj and Pts use, and is it set per list or per user?
- Do lists need delete, duplicate, share, and public/private visibility? The main-app composer carries pub:true; this flow has no visibility setting.
- How does a list get into 'Saved'? The List view has no save/bookmark button. Is Saved shared with Community's saved state? What is the Saved-tab empty-state copy?
- Which list-creation flow is canonical: this file's two-step New list → Editor, or the main-app Community composer (kind 'list' with pub, players, videos)? Which list detail page wins: the Community detail or this List view?
- What should Player profile '+ List' do? It only toasts 'Choose a list for <name>'. Is a list picker (with a create-new option) wanted?
- What touch drag behaviour is needed for reordering on mobile (long-press to lift, auto-scroll near edges, haptics)? The prototype uses HTML5 drag and drop, which does not fire on iOS touch.
- Drop indicator: should it show where the item will land (a line below the target when moving down)? Should it appear on player rows? In the prototype it is hidden there by the row background and never clears on drag-leave.
- Should empty tiers be cleaned up automatically (a trailing 'Add tier line' marker, adjacent or leading markers, markers left after removing players or after an import)? Should tier lines be hidden when the list has no players?
- With Tiers off, should hidden tier markers be dropped or kept? Today they still take drag slots, so reordering can silently move players between tiers.
- Tier 7 and later: cycle back through the 6 tier colours (README) or show grey t3 (file)?
- Should leaving the editor or New list with unsaved changes ask for confirmation?
- Should Enter in the list-name field advance (as the main-app composer does)? Should the name field or the Add players search auto-focus?
- Should the Add players sheet have a 'no results' state (and what copy)? Should the search query be trimmed?
- Should sheets support swipe-to-dismiss on the grab handle, and should sheets and toasts animate (slide up or fade)? The toast here is a full-width rounded rectangle at bottom 100px, not the README's 'bottom-centered dark pill'.
- Small hit targets: should the stat-chip ✕ (20px), tier Merge ✕ (24px), colour swatches (24px) and time-frame segments (24px) be enlarged to the README's 30px minimum?
- README says 'No other shadows', but this file uses an outer selection ring on thumbnails and swatches, a switch knob shadow, the dock avatar double ring, tab underlines and hairlines drawn as shadows. Which rule wins?
- YouTube handling: should validation check the domain (it currently accepts any ?v=<11 chars> URL and rejects bare ids and youtube.com/live/ links)? Should the attached video's real title be fetched? Should 'Video frame' let the user pick a frame, or is YouTube's hqdefault thumbnail final? Should a second video be allowed, or replacing without removing?
- Where do uploaded cover images go (storage, size and type limits, crop or focal point)? Re-picking the same file after switching thumbnails currently does nothing.
- What should the Import a ranking sheet list in production? Are the hard-coded Scout AI W5 QB/RB/WR/TE and Experts ROS RB options placeholders for a real catalogue? Should imports cap at top 10 / first 14 items, and should the 'Mine' sub show the count that will actually be added and 'Finalized' for graded weeks?
- Auto tiers: what should happen with ≤2 players (currently a success toast with no change) or on a list not sorted by score?
- What is the rule for 'Updated' timestamps (relative like 'Just now', '3h ago', '2d ago' versus a short date like 'Aug 20')? Should 'Just now' be lowercase mid-sentence?
- In dark mode the 'black' colour swatch (var(--x-t1)) turns white, which hides the white collage icon on the New list tile and gives l2 a white cover. Is that intended, or should the swatch be a fixed near-black?
- Should +RYOE / −RYOE and the link error use the README's dark success and danger colours (#1ED760 / #FF6B6B) in dark mode? Where should the theme toggle live on Lists screens?
- Should tapping a player in the List view open the player mini card (the app-wide rule), even though the prototype rows are not tappable?
- Should New list step 1 and the editor show a '2 of 2' step indicator or a progress bar to match New ranking?
- Should a 1- or 3-player collage be centred rather than filling the 2-column grid from the top-left?
- List view table: should the header row stick to the top while scrolling? Should the locked column's divider run continuously (header and tier rows included)? Should row borders run to the scroll end rather than stopping 12px short?

---

## Gap analysis vs the current app

## Lists (mobile spec) compared with the app code

**Worktree:** `/Users/chrisdaltas/Documents/Hadouken/.claude/worktrees/redesign-v7`, HEAD `27d455b`. That commit only adds the mobile `m-*` theme tokens, the `mob:` variant and a mobile-only dark-mode store. **No mobile Lists UI exists yet.** Today a phone gets the desktop Lists v2 page stacked vertically (`PageHeader inPageOnMobile`), the legacy `ListFormDialog` modal, and the legacy `BottomTabs`.

**Path key** (all relative to the worktree root):
- `v2/` = `src/components/lists/v2/`
- `page` = `v2/lists-page-v2.tsx`
- `panel` = `v2/list-detail-panel.tsx`
- `hero` = `v2/list-detail-hero.tsx`
- `toolbar` = `v2/list-toolbar.tsx`
- `body` = `v2/list-body.tsx`
- `rowparts` = `v2/list-row-parts.tsx`
- `buckets` = `v2/list-buckets.ts`
- `stats` = `v2/list-stats.ts`
- `store` = `src/stores/list-display-store.ts`
- `form` = `src/components/lists/list-form-dialog.tsx`
- `cover` = `v2/cover-tile.tsx`
- `card` = `v2/list-gallery-card.tsx`
- `details` = `v2/list-details-tab.tsx`
- `schemas` = `src/types/schemas/lists.ts`

### Rulings Chris needs to make (the spec conflicts with existing rulings or the data model)

1. **Cover colour swatches.** The spec has 6 user-chosen colours. `lists` has no colour column, and `cover.tsx` `coverBg()` derives the colour from `position_filter`, per Chris's ruling of 2026-08-11.
2. **Saving stat columns and time frame per list.** The spec saves `stats` and `tf` with the list. D3 (Chris, 2026-08-09) makes these session-only, and `list-display-store.test.ts` enforces that.
3. **Save model.** The spec uses a local draft, an explicit Save, and Back that discards silently. The app writes every change immediately (`useAddPlayer`, `useReorderPlayers`, `useSetPlayerTier`, `useUpdateList`).
4. **Ranked and Tiers as independent toggles.** `ranking_mode` has 3 values (migration 012: "hide_order wins"), so "Ranked off + Tiers on" can't be stored.
5. **Number of tiers.** `TIER_VALUES` has 6 letters (S–F). The spec allows Tier 7, 8 and up (Auto tiers allows up to 7 breaks).
6. **Dock and where Lists lives.** The spec dock is Home/Community/Leagues/Profile and puts Lists under Profile › My stuff. The README dock says "Players". Community and Leagues are flag-off at launch.
7. **App features the mobile spec lacks:** delete, duplicate, share, privacy, pin/save, folders, comments, likes, tags, page modes, drafted marks, rounds/cost/budget groupings, attach to league, team lists. AI generation must be kept (CLAUDE.md).

### Gap table

| Feature | Status | Where in app | Notes |
|---|---|---|---|
| **§2.0 Shared chrome** | | | |
| Phone frame, status bar (9:41, notch pill, signal, battery) | out-of-scope-or-question | n/a | Prototype chrome that the device draws. Build only safe-area insets (`env(safe-area-inset-bottom)`) where the spec reserves 26px (dock) and 30px (footers, sheets). |
| Root header: 34px back circle + blue Create (+) | restyle-only (Create) / question (Back) | `page` (PageHeader `inPageOnMobile`, actions); create = `useUIStore.setCreateListOpen` in `src/stores/ui-store.ts` | Create exists. Back in the spec goes to League › Match, which is a prototype bug. Lists' back target depends on the IA ruling. |
| Dock bar (84px dark bar, 4 items, 22px icons, avatar with double ring) | restyle-only | `src/components/layout/bottom-tabs.tsx` (legacy 64px ink bar, lime active), mounted in `src/components/layout/app-shell.tsx` | Rebuild in place with `m-bar-a` / `m-dock` tokens (`tailwind.config.ts`). The spec's Profile is styled active on every screen (prototype bug). Use the real active-state logic in `isTabActive`. |
| Dock items Home / Community / Leagues / Profile | out-of-scope-or-question | `bottom-tabs.tsx` TABS (Home/Lists/Players/Search/More); `src/lib/feature-flags.ts` (community, leagues off) | README says Players, this file says Leagues. With flags off only Home and Profile would work. Lists stops being a tab. |
| Dock scroll clearance (84px spacer on vertical scrollers) | restyle-only | `app-shell.tsx` | Layout padding only. |
| Bottom sheet (backdrop .4, max 86%, radius 22, grab handle, title/subtitle, blue pill button) | restyle-only | `src/components/ui/sheet.tsx` (Radix) | Add a bottom variant with CVA. The spec has no swipe-to-dismiss and no animation (gap 20). `tailwindcss-animate` is available if we want one. |
| Toast (ink rectangle, radius 14, bottom 100px above the dock, 2200ms, replaces the previous one) | restyle-only | `src/components/ui/toast.tsx`, `toaster.tsx`, `src/hooks/use-toast.ts` | README says "dark pill" (conflict #35). Pick one. |
| Headshot (team-colour ring, 1px white gap, initials fallback, onError) | restyle-only | `src/components/players/player-image.tsx` (`PlayerAvatarImage`), `src/components/ui/avatar.tsx` (falls back to initials on image error), `src/lib/nfl-team-colors.ts` | Real `players.headshot_url` exists for every player; the prototype has only 14. `cover` StackedHeadshot uses first-two-word initials. Implement the spec rule: strip " D/ST", split on `[\s'-]+`, take first and last initials. |
| Position chip colours and text-on-white colours | restyle-only | `tailwind.config.ts` `pos.qb…def`; `src/components/players/position-badge.tsx` | Chip colours are already tokens. Text-on-white (#E03E3E, #4A68D4…) needs tokens. The app's code is `DEF` (`schemas` POSITION_FILTERS); display "D/ST". |
| Tier colours `TIERC` (blue, purple, green, gold, red, teal, then grey from Tier 7) | restyle-only | `src/components/lists/bucket-colors.ts` BAND_RAMP (red→teal, cycles) | New mobile tokens. README says tiers cycle (conflict #34). Pick one rule. |
| Time-frame segmented control (Week N / Last 3 / Season) | new-ui-on-existing-data | `src/components/ui/tabs.tsx` Segment; weekly `player_stats`; `src/lib/stats/fetch-weekly-stats.ts`; `/api/players/builder` (season totals only: `current_pts` / `last_pts`) | Week and Last-3 aggregation needs an endpoint extension, not a new table. Use the live current week (`lib/sports-data/nfl-state`), not the hard-coded 5. |
| Font: InterDisplay with tabular figures | restyle-only | `tailwind.config.ts`, `fs-num` class | Check the font is loaded in mobile mode. |
| Dark-mode token map (§6) | restyle-only | `src/app/globals.css` `--m-*` light/dark; `src/stores/theme-store.ts`; `src/hooks/use-layout-mode.ts` | Landed in 27d455b. Values match the spec table. |
| Dark-mode success/danger text (+RYOE, −RYOE, link error) | out-of-scope-or-question | `globals.css` `--m-tg` / `--m-tr` (dark #1ED760 / #FF6B6B) | The spec keeps #07A852 / #FF0028 in dark. Recommend the README tokens (conflict #36). |
| In-phone theme toggle | out-of-scope-or-question | `theme-store.ts` (no UI rendered anywhere) | The spec has only the dev jump panel. Needs a home, probably Profile or settings. |
| **§2.1 Lists grid** | | | |
| "Lists" title + My lists / Saved underline tabs | restyle-only | `page` tabSwitch (Segment, bare, with counts); Saved = favourited lists owned by someone else (`src/app/api/lists/route.ts` `owner` field) | Same semantics. The spec tabs show no counts. `listTab` should persist in the URL (e.g. `?tab=`). |
| 2-column square grid (14px row gap, 10px column gap) | restyle-only | `page` Gallery `GALLERY_GRID` (213px auto-fill) | Layout only. |
| "New list" tile, first cell, My lists only | restyle-only | `card` NewListTile | The app renders it last; move it first. |
| Card cover collage (first 4 headshots, 2×2, 46px, on the list colour) | restyle-only | `cover` ListCoverBand (93px band, 4×26px stack bottom-right, a 2026-08-11 ruling); `/api/lists` `first_players` (COVER_PLAYERS = 4) | Data exists. Replaces the ruled stacked layout on mobile, so confirm. Centre 1- or 3-head collages (the spec draws them off-centre). |
| Cover colour (user-chosen) | out-of-scope-or-question | `cover` `coverBg()` → `POS_TINTS` in `src/components/lists/list-thumbnail.tsx`; no colour column on `lists` | Needs a `lists.cover_color` column and reverses the 2026-08-11 ruling. |
| Cover image (upload or YouTube frame) | new-ui-on-existing-data | `lists.thumbnail_url`; ListCoverBand already renders `thumbnail_url` | See New list rows. |
| "Video" badge on the card | new-ui-on-existing-data | `list_links` (migration 080), not in the `GET /api/lists` collection select | Add `has_video` (or link kinds) to the collection payload. API change, no schema change. |
| Card title (13/600, wraps) + meta | restyle-only | `card` (`player_count`, owner), `stats` `formatRelative`, `lists.updated_at` (bumped by the 001 trigger on add/remove) | Meta: "n players · Updated x" or "n players · @author". Use singular "1 player" (the `card` line 186 also has the "1 players" bug). Lowercase "just now". The @author must be a profile link (UsernameLink). |
| Card tap → List view | new-ui-on-existing-data | `page` onOpen → `panel` | Mobile goes to a full-screen view (see §2.7). |
| Saved tab empty state | restyle-only | `page` Gallery: "Lists you save from other people show up here." | The spec defines none. Keep the app's. |
| Loading, error, offline states | restyle-only | `page` Gallery skeleton, ErrorState, paused branch; `panel` DetailSkeleton | The spec has none (gap 26). CLAUDE.md requires extending the design language to cover them. |
| Create (+) on the Saved tab makes a list that tab doesn't show | out-of-scope-or-question | n/a | Recommend switching to My lists after creating (gap 7). |
| Card actions: share, duplicate, delete to trash, pin, move to folder, attach to league | out-of-scope-or-question | `card` DropdownMenu; `src/hooks/use-lists.ts` (useDuplicateList, useDeleteList soft delete, useToggleFavorite); `src/hooks/use-folders.ts`; `/api/lists/trash`, `restore` | All built; the mobile spec has none (gap 11). Decide what survives on mobile and where (List view overflow? long-press?). |
| Folders | out-of-scope-or-question | `v2/lists-folders.tsx`, `src/components/lists/folder-form-dialog.tsx`, `list_folders` | Kept at LV.7 by ruling. Absent from the mobile spec. |
| Page modes List / Cards / Side by side; New folder | out-of-scope-or-question | `page` MODES; `v2/side-by-side-*.tsx` | The mobile grid is effectively Cards mode only. Side by side is probably desktop-only. |
| Create with AI (AI list generation) | new-ui-on-existing-data | `src/components/lists/generate-ai-button.tsx`, `generate-ai-modal.tsx`, `ai-build-banner.tsx`; `/api/lists/generate`; `src/hooks/use-ai-list-build.ts` | Missing from the prototype. CLAUDE.md says keep it and restyle it; `ai-surfaces.test.ts` pins it on the Lists page. Needs a mobile entry point (Create (+) menu or the New list screen). |
| **§2.2 New list, step 1** | | | |
| Full-screen New list (✕, title, "1 of 2", pinned footer CTA) | new-ui-on-existing-data | `form` (modal: name, position group, type Basic/Ranked/Team, visibility; then `router.push` to `/app/lists/<id>`); `POST /api/lists` | The `/app/lists/new` route (`builder/list-builder.tsx`) is an orphaned legacy builder; nothing links to it. Good place for the mobile route. |
| Name input (22/700, underline, placeholder) | restyle-only | `schemas` `listTitleSchema` (1–100) | Enter should advance (the app dialog submits on Enter; the spec does nothing). |
| Description textarea | new-ui-on-existing-data | `lists.description` (≤500); `createListSchema` accepts it but `form` has no field; editable later in `details` | |
| Thumbnail picker: 3 tiles + blue selection ring | new-ui-on-existing-data | Collage = default render; upload via `src/app/api/lists/[id]/thumbnail/route.ts` | The old picker `editable-thumbnail.tsx` was deleted, and `lists-cutover.test.ts` keeps that filename deleted, so the new component needs a new name. |
| Upload image | new-ui-on-existing-data | Thumbnail POST route (5MB; png/jpeg/webp/gif; bucket `list-thumbnails`) | The prototype keeps only an object URL; the app persists to storage. The list must exist before upload, so create, then POST. Show size and type errors (gap 22). |
| Switching back to Collage after an upload, keeping the upload | needs-new-backend | `updateListSchema` has no `thumbnail_url`; the thumbnail route has no DELETE | Needs a cover-mode field, or PATCH support to clear or restore `thumbnail_url`. |
| Video-frame cover | needs-new-backend | `lists.thumbnail_url` is only writable through upload; `next.config.mjs` has no `remotePatterns` | Needs PATCH to accept `i.ytimg.com/vi/<id>/hqdefault.jpg` (or a cover-mode column). Render with `<img>` or add the image host. |
| Colour swatches (6, default #0088FF, ring) | out-of-scope-or-question | Same as "Cover colour" | Needs a column and a ruling. The black swatch turns white in dark mode (gap 25). |
| Video link field, Attach, validation, red error, attached card, remove | new-ui-on-existing-data | `list_links` (080: kind `video`, title NOT NULL, ≤10 per list); `src/lib/lists/links-service.ts` (http/https only); `useAddLink` / `useRemoveLink`; `details` LinksSection (typed title, source, duration) | The spec allows one video and auto-titles it "YouTube video". Tighten `ytId` to YouTube hosts (gap 21) and accept `/live/`. The thumbnail is a fixed `i.ytimg.com` image URL, so no scraping is involved. Fetching the real title via oEmbed would need Chris to OK it (no-scraping memory). |
| CTA "Next: add players" (grey-looking but tappable; toast "Give your list a name") | restyle-only | `form` disables submit until there is a title | Per "prevent, don't refuse", keep it truly disabled. |
| ✕ abandons the draft without confirmation | restyle-only | n/a | Nothing is lost: the app only creates the list on Next. |
| "Edit details" variant (unreachable in the spec) | new-ui-on-existing-data | `form` `mode="edit"`; `hero` inline rename; `details` description and links | Wire it from the List view or editor (gap 10). The thumbnail and colour parts depend on the rows above. |
| Step label "1 of 2" with no "2 of 2" | out-of-scope-or-question | n/a | Copy decision (gap 24). |
| **§2.3 List editor** | | | |
| Full-screen editor (back, centred editable title, Save pill) | new-ui-on-existing-data | `panel` / `hero` (inline rename via `useUpdateList`) | The app edits inside the open panel; there is no separate editor screen or route. |
| Save model (draft, Save, Back discards silently) | out-of-scope-or-question | Every edit is written immediately (`use-lists.ts` mutations) | Recommend keeping autosave: Save becomes Done and nothing is ever discarded (fixes gap 16). Needs a ruling. |
| Ranked toggle (number column on/off) | new-ui-on-existing-data | `lists.ranking_mode`; `body` always renders `#rank`, even on `unranked` lists | Data exists; the v2 body ignores `unranked`. |
| Tiers toggle (markers hidden but kept) | new-ui-on-existing-data | `ranking_mode` `rank_and_tier`; `panel` `chooseOrg` persists it; `list_players.tier` survives toggling | |
| Ranked off + Tiers on | out-of-scope-or-question | `schemas` RANKING_MODES; migration `012_ranking_mode.sql` | Not representable; needs an enum change or a ruling. Import also forces Ranked on. |
| Toggle card + switch (38×22, green on, whole card tappable) | restyle-only | `src/components/ui/switch.tsx` | |
| Stats row: selected-stat chips with ✕, Add stat chip, time-frame control | new-ui-on-existing-data | `store` `cols` / `toggleCol`; `toolbar` StatsPicker popover | Chips would be a new presentation of existing state. Spec: chip label not tappable, ✕ only 20px (gap 32); columns reorderable only by remove and re-add. |
| Stats and time frame saved with the list (viewer default) | out-of-scope-or-question | `store` D3 header; `list-display-store.test.ts` | Spec gives the list's saved defaults; the app forgets them on reload. Needs a ruling plus a column. |
| Tool: Add players | new-ui-on-existing-data | `toolbar` AddPlayersPopover | See §2.4. |
| Tool: Auto tiers (gap > 1.55× mean, ≥2 per tier, ≤7 breaks) | new-ui-on-existing-data | No auto-tier code. Tier writes go through `PATCH /api/lists/[id]/players/[playerId]/tier`, one call per player, with no bulk route | The spec scores with Scout AI, which doesn't exist; use projections. A bulk tier endpoint is advisable. Limited to 6 tiers (row below). Don't toast success when ≤2 players. |
| Tool: Add tier line; drag tier lines; Merge (✕); "Tier N" labels | new-ui-on-existing-data | `list_players.tier` (S–F); `buckets`; `v2/use-list-drag.tsx` bucket drag; `rowparts` BucketHeader / DropGap / NewBucketZone | The app stores a tier on each player, while the spec stores markers between players. The two map onto each other. Relabel S–F as "Tier 1…6". Merge rewrites the tiers below it. Avoid the spec's empty trailing tier. |
| More than 6 tiers | needs-new-backend | `schemas` `TIER_VALUES` / `BUCKET_KEY_PATTERN`; `list_players_tier_check` (081) | Widen the vocabulary or cap the UI at 6. |
| Info line "n players · drag to reorder" | restyle-only | n/a | Use singular "1 player". |
| Empty state "No players yet" + Add players button | restyle-only | `rowparts` EmptyListState | Don't render tier lines under it (L4g). |
| "Tier 1" header (grey rule) | restyle-only | `rowparts` BucketHeader | |
| Player row (rank, 26px headshot, short name, position chip, "BUF · Bye 7") | restyle-only | `body` ListRow; `rowparts` PlayerFace / PlayerName / PlayerMeta; `players.bye_week` | Short-name rule ("J. Allen"; D/ST unchanged) is new formatting. |
| Editor mini stats Pts / Avg / Pos rk (season) | new-ui-on-existing-data | `/api/players/builder` (`current_pts`, whole pool for ranking); `src/hooks/use-player-stats.ts` | The spec's own mismatch (gap 13): should rows show the list's chosen stats instead? Question. |
| Drag to reorder (whole row, touch) | restyle-only | `use-list-drag.tsx` (MouseSensor 6px; TouchSensor 220ms delay, 6px tolerance = long-press lift); `v2/list-reorder.ts`; RPC `reorder_list_players` (004) | The app already solves gaps 17 and 18 (touch drag, correct indicator). Don't copy the prototype's HTML5 drag-and-drop bugs. |
| Per-row remove / up / down | restyle-only | `rowparts` RowMenu "Remove from list"; mini card Remove (D494) | The spec can only remove by un-ticking in Add players (gap 12). The app has more. |
| Player tap → mini card | restyle-only | `src/hooks/use-open-player.ts` | The spec rows aren't tappable (gap 27). The 2026-10-05 ruling (mini card, then full) wins. |
| Drafted checkbox, notes, rounds / avg cost / budget groupings, List/Table/Cards views | out-of-scope-or-question | `rowparts` DraftedCheckbox; `store` LIST_ORGS / LIST_VIEWS; `buckets` ORG_OPTIONS | Not in the mobile spec. Decide what stays. |
| **§2.4 Add players sheet** | | | |
| Sheet: title, live "n in your list", Done | new-ui-on-existing-data | `toolbar` AddPlayersPopover | |
| Search (name substring OR exact team) | new-ui-on-existing-data | Popover matches name only and trims the query; the pool already includes `team` | Add the team match. Keep the trim (spec gap 15). |
| Position chips All / QB / RB / WR / TE / K / D/ST | new-ui-on-existing-data | `/api/players/builder?positions=` | `DEF` displays as D/ST. |
| Rows (34px headshot, full name, position + team) with a +/✓ toggle that also removes | new-ui-on-existing-data | Popover caps at 8 results and disables added rows; `DELETE /api/lists/[id]/players/[playerId]` exists | Show the full pool (virtualise it) and make the toggle remove. |
| "Scout AI #N" sub line and sort by Scout AI overall | needs-new-backend | `/api/players/builder` sorts by projection, then ADP | No stored Scout AI ranking exists. Interim: projection order. |
| No-results state | restyle-only | Popover "No players found." plus a load-error message | The spec is blank. Keep the app's. |
| **§2.5 Add stats sheet** | | | |
| Sheet: 6 groups of chips; selection order = column order | new-ui-on-existing-data | `stats` STAT_CATALOG (7: ADP, Cost PPR, Proj, 2026 pts, 2025 pts, Bye, SOS); `toolbar` StatsCatalog | The catalog must grow. ADP, Cost, Bye, SOS aren't in the spec: keep them? |
| Rankings: ECR | needs-new-backend | No expert-consensus feed. `persona_source_rankings` is per persona and flag-gated | |
| Rankings: Scout AI | needs-new-backend | `/api/lists/generate` builds lists on demand; no weekly AI ranks are stored | |
| Rankings: Users | new-ui-on-existing-data | `consensus_rankings` view, `consensus_position_rank` (001) | Season-wide, not per week or scoring. The consensus flag is off. |
| Rankings: Pos rk | new-ui-on-existing-data | Derivable from `player_stats` points | The spec defines it as the ECR rank, which conflicts with the editor's points-based "QB3" (gap 13). |
| Fantasy: Proj | new-ui-on-existing-data | `players.projected_pts_*`; `player_weekly_projections` | |
| Fantasy: Pts, Avg pts | new-ui-on-existing-data | Weekly `player_stats`; `src/lib/stats/aggregate-fantasy.ts` | |
| Usage: Snap %, Tgt share | new-ui-on-existing-data | `player_usage` (season only); `src/hooks/use-player-usage.ts`; `src/lib/sync/usage.ts` | No weekly values, so the time frame can't apply. |
| Usage: Route %, Rush share | needs-new-backend | `player_usage` has only `snap_pct` and `target_share` | Rush share means extending the usage sync. Route % needs a routes data source. |
| Receiving: Tgt, Rec, Rec yds | new-ui-on-existing-data | `player_stats` targets, receptions, receiving_yards | |
| Receiving: YAC, aDOT, YPRR | needs-new-backend | `player_stats.advanced` (109) is empty; `src/lib/leagues/stats/stat-keys.ts` lists only placeholder advanced keys | |
| Rushing: Rush att, Rush yds | new-ui-on-existing-data | `player_stats` | |
| Rushing: YCO/att, RYOE | needs-new-backend | Same as YAC, aDOT, YPRR | |
| Passing: Pass yds, Pass TD, Int, Cmp % | new-ui-on-existing-data | `player_stats` pass_* (Cmp % = completions ÷ attempts) | |
| Not-applicable "–" cells and cell colour rule | restyle-only | `stats` `formatStat` (em dash "—"; spec uses en dash) | |
| Scoring for list stats (spec hard-codes PPR) | out-of-scope-or-question | `lists.scoring_system_id`; `/api/players/builder?scoring=` | Gap 15. |
| **§2.6 Import a ranking sheet** | | | |
| Sheet and insert rules (dedupe, tier separator, force Ranked + Tiers, toast) | new-ui-on-existing-data | `POST /api/lists/[id]/players/bulk` (≤500, skips duplicates); tier PATCH | Fix the spec bugs: the "Added 0 players" toast and the empty trailing tier (gap 23). |
| Source: Scout AI · Week N · position | needs-new-backend | n/a | Needs a stored weekly Scout AI ranking. |
| Source: Experts · Rest of season · position | needs-new-backend | n/a | Needs an expert-consensus feed. |
| Source: Mine (Submitted / Saved / Finalized) | out-of-scope-or-question | `big_board_weekly` plus `lists.is_big_board` (`src/components/weekly-ranks/weekly-ranks-view.tsx`); `weekly_rankings` table (unused); bigBoard / weeklyRanks flags off | Depends on the Rankings section rebuild. Interim: import from any of the user's own lists. |
| **§2.7 List view** | | | |
| Full-screen List view screen and route | new-ui-on-existing-data | `/app/lists/[listId]` redirects to `?list=` (pinned by `lists-cutover.test.ts`); `panel` is the detail view | Either render full screen under `?list=` in mobile mode, or change the route and the test. |
| Cover 200px (2×2 60px collage or image), Back and Edit overlays | restyle-only | `cover`, `thumbnail_url` | The overlays scroll away (gap 6). A sticky mini header is a question. |
| Info block: title; "@author · n players · Ranked/Unranked · Updated x"; description | restyle-only | `hero` ListHeroShell (shows the created date); `details` description | Switch to `updated_at`. Make the username a profile link. |
| Video card (112×63 thumbnail, red play badge, title, "Watch on YouTube") | new-ui-on-existing-data | `list_links`; `details` LinksSection (glyph block, no image) | YouTube id → `i.ytimg.com` thumbnail. |
| "Players · n" + time-frame control (session-only override) | new-ui-on-existing-data | Same as the time-frame control row | The session-only override is consistent with D3. |
| Table: sticky 172px player column, 58px stat pills, horizontal scroll | restyle-only | `body` TableBody (`overflow-x-auto`, no sticky column) | Fix the spec's broken divider and the 12px border shortfall (gap 30). |
| Tier label rows (no rule lines) | restyle-only | `rowparts` BucketHeader | |
| Someone else's list: no Edit, author meta, save/unsave | new-ui-on-existing-data | `is_owner`; `useToggleFavorite` (favourite = Saved); `hero` pin action | The spec has no save control (gap 11); the app does. |
| Comments, likes, view count, tags, copy share link, public SSR page | out-of-scope-or-question | `v2/list-comments-tab.tsx`; `/api/lists/[id]/like`; `view_count`; `list_tags`; `src/app/u/[username]/lists/[listSlug]/page.tsx` | Absent from the mobile spec. Social features belong to Community. |
| 0-player list in the view | restyle-only | `rowparts` EmptyListState | The spec shows nothing (L8g). |
| **§3–4 Navigation** | | | |
| Real routes for grid (+ tab), New list, editor, list view; browser back | new-ui-on-existing-data | `/app/lists`, `/app/lists/new` (orphan legacy builder), `?list=` deep link | Next.js routes fix gap 5. The spec uses only `setState`. |
| Entry from Profile › My stuff › Lists (3 preview rows + New list) and Home "My stuff" tile | new-ui-on-existing-data | `src/app/app/(shell)/profile/page.tsx` ("My stats", no My stuff); `src/app/app/(shell)/page.tsx` (only RecentlyViewed) | Preview rows should be real lists from `useLists`, each opening that list (gap 4). Owned by the Profile/Home sections. |
| Rankings ↔ Lists switch (`rootSeg` never rendered) | out-of-scope-or-question | Rankings flags off at launch | IA decision (gap 2). |
| Community › Create › List (a second composer) | out-of-scope-or-question | Community flag off | README says lists use this file's composer. Keep one creation flow (gap 8). |
| Player card "+ List" | restyle-only | `src/components/players/add-to-list-popover.tsx` (real picker, bulk add, new list) | The app already solves gap 9. |
| **§7 Other spec gaps** | | | |
| Hit targets under 30px (stat ✕ 20, merge ✕ 24, swatches 24, segments 24, chips 28) | out-of-scope-or-question | n/a | README minimum is 30px. Recommend enlarging the hit areas, not the visuals. |
| Shadows outside the README list (selection rings, knob, avatar ring, outlines, underline) | restyle-only | `src/components/ui/elevation-rule.test.ts` (desktop rule) | Mobile tokens; check the elevation test's scope. |
| Animation (only the switch track) | restyle-only | n/a | Optional sheet and toast transitions. |
| Seed data (l1–l4, @dalton, @kellyscouts, "Week 5") | out-of-scope-or-question | Real data via `useLists` | Lists is a launch surface: no mock data. |

