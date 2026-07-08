# Field Scout reskin — implementation plan

Working plan for applying the Claude Design handoff package. Read this alongside the
package docs; this file adds the repo-side mapping and the execution order.

**Package:** `redesign_pkg.zip` (repo root — do not commit). Extract and read:
`README.md` (rules, tokens, component mapping), `SCREENS.md` (per-screen anatomy),
`_ds/field-scout-design-system-*/readme.md` (voice, color law, iconography),
`screenshots/` (20 reference captures), `ui_kits/web/` (interactive prototype —
run with `npx serve .`, open `/ui_kits/web/index.html`).

**Ground truth order:** `_ds/.../tokens/*.css` > prototype JSX > screenshots > readme prose.
Two known stale values in the DS readme prose: blue is `#3d5cff` (not `#1F6BF0`) and the
tier ramp is the 7-color pink→blue ramp in `colors.css` (not an indigo 6-ramp).

**Standing rules (also in CLAUDE.md):** re-skin shadcn/Radix components in place; no
near-duplicate components; single blended theme (no dark mode); Tailwind 3.4 tokens
(`tailwind.config.ts` + CSS vars, no `@theme`); keep TanStack Query/Zustand wiring;
league/draft screens are mock-data UI only; business rules and SSR of public pages
are non-negotiable; every reskinned surface swaps lucide for the filled 16×16 icon set.

---

## Phase status

- [x] **0 — Intake** (done): package read, inventories below.
- [ ] **1 — Tokens & fonts**: CSS vars in `globals.css`, `tailwind.config.ts` extensions
      (colors, `hard-*` shadows, radius, control heights), Roboto Flex / Roboto Mono /
      Silkscreen via `next/font/google`, remove next-themes provider, port icon map from
      `_ds_bundle.js` → `src/components/ui/icon.tsx` (typed name map).
      **Scale decision — pre-scaled token values** (see below).
- [ ] **2 — Primitives**: restyle existing `components/ui/*`; add missing shadcn
      primitives (select, checkbox, switch, radio, progress, slider, table) then reskin;
      port hover/press recipes from `tokens/components.css` into CVA variants.
      Deliverable: **component manifest** (appendix below, completed) + style-guide page
      skeleton at `/app/styleguide` as the living acceptance checklist.
- [ ] **3 — App shell**: ink sidebar (wordmark, search, nav, Teams section), sticky
      header + breadcrumbs + page actions, lime draft alert bar, right rail (56px strip +
      320px panels: Account/Notifications/Messages/Teams/Players), search overlay
      (restyle `shared/command-palette.tsx`), toast restyle (sonner → fs-toast),
      mini player card restyle (`players/player-window.tsx` + `shared/window-shell.tsx`).
- [ ] **4 — Screens** (parallel agent batches, see below).
- [ ] **5 — New interactions** (serial): lists draft-mode marking, rail drag-to-add,
      draggable list reorder upgrades, customize-columns sets.
- [ ] **6 — League/draft mock screens** (can overlap 5): league workspace tabs, snake
      draft room, auction draft, scoring-builder league version. Mock data + stub
      handlers, `// TODO(live-draft):` markers. No new API routes/tables/schema.
- [ ] **7 — Cleanup & acceptance**: remove next-themes + dead `dark:` variants (grep
      count → 0), delete orphaned styles, finish style guide, type-check + build +
      /code-review, visual QA sweep vs screenshots at desktop + mobile widths.

**The 0.8 scale decision (phase 1):** the prototype renders at 0.8 zoom. Strategy:
define Tailwind/CSS tokens at **pre-scaled (×0.8) values** — button 42px, input 51px,
header 58px, sidebar 243px, content padding 22/29 — rather than the root
`font-size: 12.8px` trick. Explicit values, no rem magic, matches painted result.
Treat inline px in prototype JSX as ×0.8. Never mix strategies.

---

## Screen mapping (package → repo)

| Package screen | Source | Repo target | Batch |
|---|---|---|---|
| Home (hub) | `Home.jsx` | `src/app/app/page.tsx` | A |
| Lists browse | `Lists.jsx` | `/app/lists` | A |
| List detail | `Lists.jsx` | `/app/lists/[listId]` | A |
| Draft-mode select + side-by-side | `Lists.jsx` | **new** `/app/lists/draft-mode` | A |
| Players (research table) | `Research.jsx` | `/app/research` (see decision D2) | B |
| Player full page | `PlayerPage.jsx` | `/app/players/[playerId]` | B |
| Mini player card | `PlayerCard.jsx` | `players/player-window.tsx` (phase 3) | — |
| Rankings (weekly + pre-draft) | `Rankings.jsx` | `/app/weekly-ranks` (+ history) + `/app/big-board` (+ week) | B |
| Community | `Community.jsx` | `/app/explore` (see decision D3) | C |
| My Stats | `Profile.jsx` | `/app/stats` + `/app/profile`; same language on public `/u/[username]` + consensus | C |
| Account settings | `AccountSettings.jsx` | `/app/settings`, `/settings/profile`, `/settings/billing` | C |
| League workspace (tabs) | `TeamView.jsx`, `MyTeam.jsx`, `Scoreboard.jsx` | `/app/leagues/[leagueId]` (+ manage, new) | D |
| Snake draft room | `DraftRoom.jsx` | new league sub-route, mock-only | D |
| Auction draft | `AuctionDraft.jsx` | new league sub-route, mock-only | D |
| Scoring builder | `ScoringBuilder.jsx` | `/app/settings/scoring` now; league-scoped later | D |
| Style guide | `StyleGuide.jsx` | **new** internal `/app/styleguide` | 2→7 |
| Shell / rail / search / toasts | `AppShell.jsx`, `ResearchRail.jsx` | `src/app/app/layout.tsx` + `components/layout/*` | 3 |

`Dashboard.jsx` = legacy reference only; do not implement.

**No-mock surfaces (batch E — extend the design language per README §"Features the
prototype does NOT show"):** auth screens (`(auth)/*`), AI list generation flow
(`/app/lists/new` + generate API UI), personas/AI experts (`/personas/*`, home shelf,
admin posts + review gate), start-or-sit (`/app/start-or-sit/*`), NFL team pages
(`/app/nfl/*`), notifications page, trash, tag pages (`/tag`, api tags), teams pages
(`/app/teams/*`), followers/following, `/consensus`, guest big board.
Skeletons = flat `--n-4` blocks; empty states = bordered card + heavy heading; errors =
`--negative`; Pro gates = accent-blue CTA in Scout AI voice, never lime.

## Open decisions

- **D1 (routing):** keep all existing URLs during the reskin; nav items point at
  current routes. URL renames (`/app/explore` → `/community`, public `/players/[slug]`
  SSR, dropping the `/app` prefix) are a separate post-reskin task with redirects.
- **D2 (Players vs Research):** package has one Players surface (the table). Repo has
  `/app/players` (browse) and `/app/research` (spreadsheet). Reskin both; sidebar
  "Players" points at `/app/research`; consolidation decided post-reskin.
- **D3 (Community):** `/app/explore` is the Community surface for now (D1). Persona
  posts remain part of Community content.

## Component manifest (dedup map — phase 2 completes this)

**Existing `components/ui/` → restyle in place:** avatar (square crests + round people
per `kind`), badge (+ FilterChip variant), button (blue/stroke/ghost/dark/lime variants,
press physics), card (head-row recipe), command (search overlay), dialog (`.85` ink
overlay, hard shadow), dropdown-menu (nested submenus), input (64-token Field), popover,
separator, sheet, skeleton (flat `--n-4`), tabs (boxed, accent active), toast/toaster
(sonner → fs-toast), tooltip (ink), user-avatar.

**Missing shadcn primitives to add then reskin:** select, checkbox (accent blue),
switch (lime-on/ink knob), radio, progress, slider, table (Players stat table).

**Package "net-new" primitives with EXISTING repo counterparts — restyle, do not
duplicate:** `PositionBadge` → `players/position-badge.tsx` · `PlayerRow` →
`players/player-row.tsx` · `TierGroup` → grow from `lists/tier-badge.tsx` + grouping in
`lists/list-detail-view.tsx` · mini card → `players/player-window.tsx` +
`shared/window-shell.tsx` · search overlay → `shared/command-palette.tsx` · wordmark →
`shared/wordmark.tsx` (Silkscreen lime) · `Headshot` → check `user-avatar.tsx` +
`lists/list-thumbnail.tsx` first.

**Genuinely net-new:** `Icon` (filled 16×16 map from `_ds_bundle.js`), `StatBar`,
`MatchupMeter`, `DraftPick`, `AIInsight`. Anything else an agent thinks it needs goes in
its report, not in a new file.

## Phase-4 agent rules (paste into every screen-task prompt)

1. Scope: only your screen's route + feature-component files. Never edit
   `components/ui/*`, layout/shell, tokens, or another screen's files.
2. Compose from the component manifest. If the mock differs slightly from what an
   existing component renders, the existing component wins — report the delta.
3. Need a component that doesn't exist? Report it; do not create shared components.
4. Keep hooks/data wiring/business rules intact. Reskin the rendering layer.
5. Verify against `screenshots/NN-*.jpg` and the running prototype; code is ground
   truth for values. Remember the ×0.8 scale when reading JSX px.
6. Sentence case everywhere; mono tabular numerals; no lucide icons on reskinned
   surfaces; no `dark:` classes; state deviations in your final report.

Batch order: A → B → C → D → E, 3–5 agents per batch, worktree isolation, batch-boundary
audit (new-file diff + duplicate-component review) before the next batch launches.

## Mechanics

Branch: `redesign/field-scout` off `main`; commit per phase / per batch; `main` stays
shippable. Verification per batch: `npm run type-check`, `npm run build`, preview
screenshots vs package references. Never ship the mock data's stats/ADP numbers.
