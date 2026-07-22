---
name: design-fidelity
description: Implement or review FieldScout UI against a design reference. Use whenever a Figma URL or claude.ai/design link is shared, or the user asks to "match the design", "update X per the mock", or critiques visual fidelity. Covers both design sources (Figma and the Claude Design prototype), the value→token mapping, and the states checklist.
---

# FieldScout design fidelity

Design work for this app is ~50/50 between two sources. Get the exact spec
from the source FIRST — never implement from a screenshot alone. Screenshots
are for layout gestalt; they lie about borders, radii, and exact colors
(this has caused real regressions twice).

## 1. Pull the spec

**Figma URL** (`figma.com/design/...?node-id=N-N`):
- Call `get_design_context` with the exact nodeId/fileKey. It returns
  reference code with exact values (px, hex, radii, borders, fonts).
- If the design has multiple states, they are usually sibling frames —
  pull each state's node, not just the composite overview.
- If the response is raw divs, check `get_code_connect_map` first — a
  mapped node means the design IS an existing code component; implement
  the delta on that component, never a parallel one.
- `get_screenshot` is supplementary, for visual sanity only.

**Claude Design prototype** (`claude.ai/design/...`):
- Share links 403 for WebFetch and the in-app browser. Read via the
  DesignSync tool instead: `list_files` → `get_file`.
- The Field Scout package lives in project
  `061f4728-5ffe-48e9-aa7c-caaff836b0a9`; per-screen source is under
  `ui_kits/web/*.jsx`, tokens under `_ds/.../tokens/*.css`.

## 2. Map values to tokens — never copy raw hex

Mocks are often hand-drawn and drift slightly from the real tokens. Map to
the nearest token in `tailwind.config.ts`; only introduce a new value if no
token is plausibly intended.

| Mock value (typical)         | Token / class                          |
| ---------------------------- | -------------------------------------- |
| #121212, #000, near-black    | `ink` (#0B0C10) → `border-ink`, `bg-ink`, `text-ink` |
| #3d5cff blue                 | `accent` (buttons/selection/AI — "do a thing") |
| #b4ff89 lime                 | `brand` (signals/callouts — never controls) |
| light green tint             | `positive-soft` (drafted/success states) |
| pink / #f8c8cc / #ffd0d0     | `negative` or `negative-soft` (SOS, warnings) |
| #777, #5f646d grey text      | `text-n-3`                             |
| #e7e8e9 hairlines/fills      | `n-4`                                  |
| position colors (#bc723a TE…)| `pos-qb/rb/wr/te/k/def` via `PositionBadge` |
| tier ramp                    | `tier-1..7`                            |
| radius ≤2px                  | `rounded-sm` (DS default is hard corners) |
| 0.5px borders                | `border-[0.5px] border-ink` (hairline)  |
| hard drop shadows (no blur)  | `shadow-hard-4/6/8`                    |
| mono/tabular numbers         | `fs-num`                               |
| small caps labels            | `fs-overline`                          |

Heights: `h-btn` 42 / `h-btn-md` 29 / `h-btn-sm` 26 / `h-input` 51 /
`h-chip` 19 / `h-tab` 26. Filter/dropdown rows on content pages use
`h-btn-md`.

## 3. States checklist

The mock rarely shows everything. Cover, extending the design language for
anything missing: default · hover (ink border/hard shadow lift) · active/
selected · drafted-highlighted (positive-soft) · demoted/do-not-draft
(greyed) · empty · loading (Skeleton grid) · error card · overflow/truncation
at real grid density · free-vs-Pro gates.

## 4. Implementation rules

- Never fork a component for a mock. `PlayerCard` is the only player tile —
  add a prop/variant (see its docstring). Same for Button/Badge/etc.
  (CLAUDE.md: small visual differences never justify forking.)
- AI-only features (personas, AI list gen) aren't in mocks — restyle them in
  the new language, never remove them.
- Headshots are Sleeper JPGs with backgrounds; mocks use cutouts. Don't
  chase cutout-dependent effects.

## 5. The FieldScout Library (Figma) — component ↔ code map

The generated library file is `figma.com/design/Wol5Ssp7z0UMZckRVDKJi7`
(variables carry Tailwind code syntax; component descriptions carry these
same pointers). Code Connect is unavailable on the current Figma plan, so
resolve mocks built from these components with this table:

Chris's variable vocabulary (Figma name → Tailwind token): the identity
palette lives under `brand/` — `brand/green`→`brand` (lime), `brand/blue`→
`accent`, `brand/ink`→`ink`, `brand/page`→`page`. Tokens are FLAT (no
primitive layer); ink's hex intentionally repeats across `brand/ink`,
`text/primary`, `border/default` — a palette re-tune must edit all copies
(script it).

| Figma component (page) | Code |
| --- | --- |
| Position Badge | `PositionBadge` (players/position-badge.tsx) — Position→`position`, Size→`size` |
| Badge | `Badge` (ui/badge.tsx) — Variant→`variant` |
| Button | `Button` (ui/button.tsx) — Variant→`variant`, Size→`size` |
| Filter Chip | `FilterChip` (ui/badge.tsx) — On→`pressed` |
| Tab | `TabsTrigger` (ui/tabs.tsx) / `WeekTabs` (big-board/week-tabs.tsx); Locked = future week |
| Player Card / Board | `PlayerCard layout="board"` — Hover=hover CSS, Highlighted=`label="drafted"`, Demoted=`label="dnd"`, More stats=`statChips` |
| Nav Item / Sidebar Nav | `NavRow` / `Sidebar` (layout/sidebar.tsx) |
| Rail Strip / Rail Panel Shell | `ResearchRail` / `RailPanelShell` (layout/rail/) |

If a mock contains an INSTANCE of a library component, implement via the
mapped code component and its props — never rebuild it from the raw geometry.

## 6. Verify

- Check in the browser at REAL grid density (cards are ~200px wide, not the
  mock's 490px) — names/meta must not truncate unreasonably.
- Walk each mock state live (hover, toggles, labels) before calling it done.
- Never run `npm run build` while the dev server is running — it corrupts
  `.next` and the app serves plain HTML until cache is cleared + restarted.
