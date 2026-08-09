# PROGRESS — Lists v2

> **The build loop's only memory for this build.** Re-read at the start of
> every cycle; never rely on chat history. Every cycle ends at a task boundary
> with this file current and `main` clean, so a session can be compacted or
> killed at any point and a fresh one resumes losslessly.
>
> **Authority:** design LAW (`docs/design/lists/README.md`) > delivery plan
> (`docs/specs/delivery-plan-lists-v2.md` v3.3) > this file.
>
> Active per `docs/specs/ACTIVE-BUILD.md`. Task ids are `LV.*`. **`L.*` tasks
> belong to the paused leagues build — never pick one from here.**

---

## 1. Milestone status

| Round | Contents | Exit criteria | Status |
| --- | --- | --- | --- |
| **Round 1** | Lists page (rail + cards) and list detail (hero, tabs, toolbar, three view styles, drag-and-drop, stats picker, notes, drafted) in the new design language | Both screens match the handoff at desktop and mobile; `featureFlags.listsV2` flipped on; old components retired | 🔵 In progress (LV.1.1 landed 2026-08-09) |
| **Round 2** | Side-by-side compare; pop-out windows (app-shell hosted) | — | ⚪ Deferred (plan §6) |

Nothing is blocked. No open questions.

---

## 2. Round 1 task checklist

Task text: **delivery plan §4**, read with the handoff section each task cites.
Dependencies in parentheses; pick the first unchecked task whose dependencies
are all checked.

**Phase 1 — foundations**

- [x] **LV.1.1** — `featureFlags.listsV2` + route-level branch so old and new Lists coexist (2026-08-09)
- [x] **LV.1.2** — migration: `list_player_drafted (user_id, list_id, player_id)` + RLS + indexes, and its read/toggle route (D2) (2026-08-09)
- [ ] **LV.1.3** — point `use-draft-mode.ts` **only** at the new server source (LV.1.2)
- [ ] **LV.1.4** — session-only display state: `view`, `cols`, band labels, `budget`; **no `persist` middleware** (D3)
- [ ] **LV.1.5** — widen the tier route's Zod enum for round/band buckets beyond six; S–F stays valid (D4)

**Phase 2 — Lists page**

- [ ] **LV.2.1** — page header: heading, view-mode segmented control, My lists / Saved tabs, New list (LV.1.1)
- [ ] **LV.2.2** — rail mode: 200px sticky rail, shared edge, selected-row treatment (LV.2.1)
- [ ] **LV.2.3** — cards mode: responsive gallery, flat at rest, lift on hover (LV.2.1)

**Phase 3 — list detail**

- [ ] **LV.3.1** — hero: cover, inline rename, byline, action cluster, options menu (LV.1.1)
- [ ] **LV.3.2** — tabs + toolbar: grouping dropdown, view-style toggle, Stats, Add players (LV.3.1, LV.1.4)
- [ ] **LV.3.3** — view style List: 60px rows, stat cells, computed `minWidth` (LV.3.2)
- [ ] **LV.3.4** — view style Table: 44px rows, sticky header (LV.3.2)
- [ ] **LV.3.5** — view style Cards: corner cells, stat strip, label rail (LV.3.2)
- [ ] **LV.3.6** — drag-and-drop across all three views; header drop assigns the bucket (LV.3.3–3.5, LV.1.5)
- [ ] **LV.3.7** — stats picker modal: grouped catalog, search, reorderable chips (LV.3.2)
- [ ] **LV.3.8** — notes: accent mark + body-portalled hover card (LV.3.3)
- [ ] **LV.3.9** — drafted checkbox + "Clear drafted" (LV.1.3, LV.3.3)

**Phase 4 — states and cutover**

- [ ] **LV.4.1** — loading / empty / error / overflow states (LV.3.*)
- [ ] **LV.4.2** — AI list generation + persona surfaces restyled (LV.3.*)
- [ ] **LV.4.3** — public share view, still server-rendered (LV.3.*)
- [ ] **LV.4.4** — flag flip + retire old components (all)

**Lane note:** LV.1.1, LV.1.2, LV.1.4 and LV.1.5 are independent and may be
picked in any order. LV.1.2 is the only schema task in the build.

---

## 3. Design questions

*(A Builder that finds the handoff wrong or ambiguous files the question here
with a recommendation and HALTs — it never improvises.)*

None open.

---

## 4. Decisions log

Design decisions D1–D7 live in delivery plan §3 and are not duplicated here.
This section records decisions made **during** the build.

- **LV.1.1 (2026-08-09) — branch mechanism.** Both routes
  (`src/app/app/lists/page.tsx`, `src/app/app/lists/[listId]/page.tsx`) now
  check `featureFlags.listsV2` as the first statement in the default export
  and return early to a new `*V2` component when on. The pre-existing body
  of each page moved, unedited, into a same-file `*Legacy` component
  (`ListsPageLegacy`, `ListDetailPageLegacy`) — this was required, not
  stylistic: `useList`/`useAiListBuild`/`useHistoryStore`/`useState` are real
  hooks, so they can't sit in the branch itself without violating
  react-hooks/rules-of-hooks (confirmed clean via `npm run lint`). `use(props.params)`
  is exempt from that rule per React/Next 15 and stays in the outer
  component so both branches can read `listId`. New placeholder components
  live at `src/components/lists/v2/{lists-page-v2,list-detail-page-v2}.tsx`,
  built on the existing `PlaceholderPage` shared component (same pattern as
  `src/app/app/teams/[teamId]/page.tsx`) rather than inventing new markup.

  **Where `src/components/lists/v2/` comes from is now plan law, not a note
  here** — this entry originally carried a Builder's counter-reading of D1,
  which was the wrong place for it (R168). Plan **v3.3** amends D1 in place:
  Lists v2 screens live in `src/components/lists/v2/`, are swapped in at the
  route branch, and are retired at LV.4.4; "no forks of `src/components/ui/`
  primitives" survives as the absolute prohibition. **Read D1, not this
  bullet.** No task should re-derive the structure.

  Added `NEXT_PUBLIC_FLAG_LISTS_V2` to `.env.example` beside the other flags.
  **Its dev default takes something away, which no previous flag did**
  (R170): unset or blank means ON in local development, so until LV.2.1 and
  LV.3.1 land, `npm run dev` shows placeholders where today's working Lists
  page and list detail are. That is what plan §1 asks for — the rebuild is
  what you want to see locally — but it is surprising the first time, so
  `.env.example` now says it outright, along with the escape hatch:
  `NEXT_PUBLIC_FLAG_LISTS_V2=false` in `.env.local` restores today's Lists
  locally. `.env.local` itself is gitignored and was used only transiently
  for the flag-OFF browser verification.

- **LV.1.2 (2026-08-09) — the drafted table, and the four judgement calls in
  it.** Migration `079_list_player_drafted.sql` ships D2's printed DDL. This
  is **the only schema change in the whole Lists v2 build** (plan §1/D6);
  nothing after it may add another. Four decisions the plan did not make for
  the Builder:

  1. **The write takes an explicit desired state, not a blind toggle.** Wire
     contract is `POST {player_id, drafted: boolean}`, and the response
     carries `changed: boolean`. §4 calls LV.1.2 "the read/toggle route",
     which names the user's *gesture*; the transport is idempotent on
     purpose, because an optimistic checkbox retries and a blind toggle
     applied twice lands on the opposite answer with nothing to notice it
     (CLAUDE.md's "never let 'nothing happened' mean 'it worked'"). `changed`
     is what lets a caller tell a replay from a write. Pinned by
     `drafted-service.test.ts`, which explicitly **rejects** a toggle-shaped
     `{player_id}` body so a later "simplification" goes red.

  2. **The INSERT policy defers to `lists`'s own RLS instead of restating
     visibility.** Its `EXISTS (SELECT 1 FROM lists WHERE id = list_id AND
     deleted_at IS NULL)` carries no `is_private`/`owner_id` conjunct: policy
     expressions are evaluated as the invoking role, so the subquery runs
     under `lists`'s policies (the mechanism migration 067's D106 note
     documents). The encoded rule is therefore **"you may mark drafted on any
     list you can read"** — which is D2's Saved-list case for free, *and*
     covers 067's league-shared private lists, which copying
     `list_favorites`' hardcoded `is_private = FALSE OR owner_id = auth.uid()`
     would have silently excluded. **All three** directions pinned in pgTAP
     028 — u2 can mark on u1's public list, cannot on u1's plain private one,
     **and can on u1's private list shared with a league they both belong
     to**. The third pin was missing on the first pass and is the only one
     that distinguishes this design from the 013 form it rejects; the
     Reviewer proved the 013 form passed the entire suite green (R173, §6).
     The DELETE policy is
     `user_id = auth.uid()` **alone** — you must always be able to clean up
     your own rows, including on a list that has since gone private or into
     the trash — which is also why `clearDrafted` skips the visibility probe
     that GET and POST perform.

  3. **Beyond-the-print hardening: a composite FK `(list_id, player_id) →
     list_players`, ON DELETE CASCADE**, replacing the obvious separate
     `list_id → lists` / `player_id → players` FKs (which it subsumes
     transitively). The D106/R43 class — it makes a mark for a player who is
     not on that list impossible on *any* path rather than merely unlikely,
     and it self-cleans when a player leaves the list. Checked before
     choosing it that nothing delete-and-reinserts `list_players`:
     `reorder_list_players` (004) is UPDATE-only and `/api/big-board/save`
     diffs, so no reorder or board save can wipe a mark. Costs one index —
     the cascade lookup is not a PK prefix.

  4. **No UPDATE policy at all** — row presence *is* the state and
     `drafted_at` is write-once, so §8.2's "immutable tables have no UPDATE
     policy" applies. Proven from the row's **own user**, not a stranger: a
     stranger being blocked would not prove immutability.

  **Layering.** The 20 pre-existing `/api/lists` routes inline their logic;
  this one does not. Everything decidable lives in
  `src/lib/lists/drafted-service.ts` over an injected client (the leagues
  D68/D71 thin-route pattern), because the LV.1.2 DoD requires the RLS
  isolation to be proven through the code that actually ships.
  `ServiceResult` is re-declared locally rather than imported from
  `leagues-service.ts` — a two-field type is not worth pulling a paused
  build's module onto the launch path.

  **Grants.** No per-object `GRANT` (leagues D18→D23): migration 037's
  default privileges cover the new table. Verified after a real
  `npx supabase db reset` — `authenticated` holds SELECT/INSERT/DELETE — and
  pinned in pgTAP 028, because no RLS assertion can see a missing grant.
  *(Trap for the next Builder: hand-applying a migration with `psql -U
  postgres` on a drifted local DB grants only `Dxtm`. That is an artifact of
  hand-application, not of the migration; `db reset` is the only honest
  check.)*

  **Typegen.** `src/types/database.ts` regenerated with
  `npx supabase gen types typescript --local`; the hand-written alias block
  was re-appended and verified **byte-identical by sha256**, and the file
  diff is **+89 / −0**. The regen also picked up `ai_generation_usage`
  (074), `applied_migration_versions` (078) and three RPCs that had never
  been typegen'd — pre-existing drift, additive, not scope creep.

---

## 5. Blockers

None for Lists v2.

**Two pre-existing repo-wide test-infrastructure faults were measured during
LV.1.2 and are NOT caused by it.** Neither blocks this build (the Lists v2
DoD, plan §5, is type-check / lint / `test:unit` / PROGRESS / branch+PR), but
the first one **does** block the leagues M2 DoD, which includes
`npm run test:db`. Task chips were filed for both.

- **`npm run test:db` is red on `main`: the local Postgres backend
  segfaults.** `supabase/tests/002_notify_list_followers_auth.sql:35` kills
  the backend (`signal 11: Segmentation fault` in `docker logs
  supabase_db_fieldscout`), which puts the DB into recovery mode so every
  later file reports `FATAL: the database system is in recovery mode` —
  hence `Files=29, Tests=20, Result: FAIL`. Run file-by-file, **9 of 29
  crash**: 002, 013, 014, 015, 016, 018, 020, 022, 026; the other 20 pass.
  Every crash is the same idiom — `throws_ok(..., '42501')` where the error
  is *permission denied for function* on a REVOKEd SECURITY DEFINER routine
  under `set local role anon`. Proven pre-existing by A/B: reproduced with
  migration 079 removed from the chain (chain at 078). pgTAP **028 passes
  49/49** (47/47 before the R173/R174 pins) — its `throws_ok` cases expect
  runtime errors (RLS `WITH CHECK` 42501, 23503, 23505), which do not trip
  the bug. Suspected cause is the Postgres 17 image from the pinned CLI
  (2.109.1; 2.113.0 available). **Run 028 on its own** —
  `docker exec -i supabase_db_fieldscout psql -U postgres -d postgres -q -t
  -A -f - < supabase/tests/028_list_player_drafted.sql` — rather than through
  the whole `test:db` sweep, which the segfault zeroes.

- **`npm run test:stack` is intermittently red at roughly 1 run in 3**, on a
  different leagues suite each time (most often `draft-realtime-db.test.ts`'s
  private-channel test, which fails on a **50-second** subscribe timeout —
  a load symptom, not an authorization one; also seen: invites capacity,
  `create_league` at team_count 14, draft-core picks, settings PATCH 409).
  Measured over 17 consecutive runs: **3 failures in 9 runs without** the new
  `drafted-api-db.test.ts` and **3 failures in 8 runs with** it — the same
  rate, the same failure families. `drafted-api-db.test.ts` itself passed
  **8/8**. Likely causes are parallel-run timing against one local stack plus
  cross-suite fixture collisions (the class the R161 finding already
  documented).

---

## 6. Review findings

*(Reviewer findings per cycle, in house format.)*

### LV.1.1 — 2026-08-09 (PR #107) — verdict **FIX-THEN-MERGE**

*Reviewer session (fresh context, red-team brief) against PR #107 —
`featureFlags.listsV2` + the route-level branch — verified against plan v3.2
§1/§4/§5, D1, and the `.env.example` / `feature-flags.ts` conventions. Method
included a deliberate-break probe (inverting both branch conditions) run
against the full DoD gate. **R166–R170: three should-fix, two nits, no
blockers.**

**The finding that mattered:** the PR added **zero** tests (656 = 656 against
main's baseline), so nothing anywhere was falsifiable against the branch
*direction* or the flag's deployed default. The Reviewer inverted both
conditions to `if (!featureFlags.listsV2)` — the change that would replace
production Lists with the "coming soon" placeholder for every user — and the
entire gate stayed green: type-check clean, lint exit 0, `test:unit` 39
files / 656 tests passed.*

#### Resolution — 2026-08-09 (Builder, same branch `feat/LV.1.1-lists-v2-flag-and-route-branch`)

*All five resolved on the same branch; nothing deferred, nothing escalated.
Proof re-run this session: `type-check` clean · `lint` exit 0 (only the
pre-existing `auction-draft-room.tsx:105` warning) · `test:unit` **40 files /
663 tests** — above the 656 baseline by the 7 tests R166 required.*

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R166** — nothing falsifiable against the branch direction or the flag's deployed default | should-fix | **`src/lib/lists-v2-flag.test.ts`** (new, 7 tests), following the `launch-scope-gates.test.ts` idiom the house already owns. Pins (a) `featureFlags.listsV2 === false` under the deployed default (unset var, `NODE_ENV=test`), (b) `=== true` under the local-dev default via `vi.stubEnv('NODE_ENV','development')` + `resetModules`, (c) the literal `process.env.NEXT_PUBLIC_FLAG_LISTS_V2` read (build-time inlining), (d) per route, the exact **un-negated** `if (featureFlags.listsV2) {` **plus** an ordering assertion that the v2 screen is returned *inside* the ON branch and the `*Legacy` screen is the fallback below it, and (e) that the OFF path still mounts `PageHeader`/`ListsBrowse` and `ListDetailView`/`AiBuildBanner`/`CommentsThread`. **Shown falsifiable twice:** the Reviewer's exact probe → 2 RED, reverted → green; and a second probe swapping the two return bodies (same net effect, no negation) → 1 RED on the ordering assertion, reverted → green. `launch-scope-gates.test.ts` also gained a comment stating that `listsV2` is *not* a launch-scope gate and must not be deleted as one |
| **R167** — DoD §5.4 browser evidence asserted in prose, shown nowhere; the OFF-state check rendered the "List not found" error card, never the legacy happy path | should-fix | Re-verified from scratch against the **local** stack with a **real seeded 20-player list** owned by the dev user (`Draft Board — 2026 PPR`, seeded into the local DB only — nothing hosted touched). All 8 combinations re-run (2 routes × 2 flag states × 1440×900 / 375×812); the flag-OFF detail page rendered the full `ListDetailView` — hero, owner-only cover "Change", grouping selector, six tier sections, 20 players with PROJ/2025/ADP cells — **and** `CommentsThread`, with **zero console errors** on a clean tab. Verification log with rendered-text extracts written into the PR body; the PR states plainly that screenshots were taken locally and **cannot** be attached via `gh` (no image upload), rather than claiming attachments that do not exist |
| **R168** — plan §3 D1 ("New Lists replaces the bodies of existing components") contradicts the shipped `src/components/lists/v2/` structure, and the Builder resolved it unilaterally in PROGRESS §4 | should-fix | **Plan amended in place to v3.3** (changelog entry added). D1 now states that Lists v2 screens live in `src/components/lists/v2/`, are swapped in at the route branch, and are retired at LV.4.4 — with **"no forks of `src/components/ui/` primitives"** kept as the surviving absolute prohibition, and the §4/LV.4.4 derivation spelled out so none of the remaining twelve tasks re-derives it. §4 below now points at D1 instead of arguing with it. **Editorial reconciliation — no product decision** |
| **R169** — §1 Round 1 still read "🟡 Not started" with LV.1.1 ticked in §2 | nit | §1 Round 1 status → **🔵 In progress (LV.1.1 landed 2026-08-09)** |
| **R170** — `.env.example` documented only the `"true"` case; unset also routes to v2 in local dev, taking away a shipped surface | nit | `.env.example` comment expanded to say outright that blank = ON locally, that `npm run dev` therefore shows placeholders where Lists is today until LV.2.1/LV.3.1 land, and that `NEXT_PUBLIC_FLAG_LISTS_V2=false` in `.env.local` restores today's Lists. Same note added to the §4 decision entry |

#### Re-review — 2026-08-09 (fresh Reviewer, fix diff `2c17a76`) — **VERDICT: CLEAN**

*Re-ran the full gate independently (type-check clean · lint exit 0 · `test:unit`
40 files / 663 tests) and corroborated the R167 fixture against the local DB —
tier counts and player rows matched the PR's rendered-text extract, so it could
not have been fabricated from the diff. R166 confirmed **load-bearing** by six
break-probes, four of which the fix Builder never claimed to cover: inverted
branch → 2 RED · flag read deleted → 1 RED · coherent flag rename across all
three files → 5 RED · `enabled(...) || true` (defeats the source pin, trips the
behavioral pin) → 1 RED · swapped return bodies → 1 RED. Behavioral and source
pins proved complementary rather than redundant.*

Two nits recorded, **not fixed** — both are inherent ceilings of the source-pin
idiom (the routes are `.tsx`, unparseable by Vite under Next's
`jsx: "preserve"`, which is why the house source-pins at all):

| Finding | Severity | Disposition |
| --- | --- | --- |
| **R171** — `src/lib/lists-v2-flag.test.ts` locates the canonical `if (featureFlags.listsV2) {` but never asserts it is the *only* decider. A reachable shadow condition inserted *above* it (probe: `if (process.env.NEXT_PUBLIC_FLAG_LISTS_V2 !== 'false') return <ListsPageV2 />`) ships v2 to production with the gate green, because the ordering assertion only searches forward from the branch | nit | **Open.** Fix direction: assert the branch is the first statement of the default export, or that `<${v2}` occurs exactly once in the file. Worth folding into LV.2.1 when that task next opens these routes |
| **R172** — the "flag-OFF path still mounts today's Lists UI" assertion scans the whole file rather than the `*Legacy` body, so a mount dropped from the OFF render still passes if the same JSX survives elsewhere in the file. Outright deletion **is** caught; the miss window is narrow | nit | **Open.** Fix direction: slice the source to the `function ${legacy}` body before asserting mounts, or narrow the test name to what a whole-file pin can honestly claim |

### LV.1.2 — 2026-08-09 (PR #108) — verdict **FIX-THEN-MERGE**

*Reviewer session (fresh context, red-team brief) against PR #108 — migration
079 `list_player_drafted` + `/api/lists/[id]/drafted` — verified against plan
v3.3 §1/§2.2/§3 D2/D6, the migration + RLS checklists, and the falsifiability
floor. **R173–R175: one should-fix, two nits, no blockers.***

***The finding that mattered:** the Reviewer applied, against the live local
DB, exactly the 013-style policy that 079's own banner names as the wrong
answer — and **nothing moved**: pgTAP 028 47/47, `drafted-api-db.test.ts`
21/21, `drafted-service.test.ts` 11/11 all green. The regression was
nonetheless real (their 067 fixture went from SUCCEEDED to `new row violates
row-level security policy`). The banner's "both directions are pinned" claim
was true of the two directions that did not distinguish the design, and the
one that did was pinned nowhere. The forgery pin, by contrast, was shown
load-bearing by the Reviewer's control break.*

#### Resolution — 2026-08-09 (Builder, same branch `feat/LV.1.2-drafted-table-and-route`)

*All three resolved on the same branch; nothing deferred, nothing escalated.
Each fix was **shown falsifiable** — the pin reddens under the exact break it
exists to catch, then restored (R173's restore was a full `npx supabase db
reset`, the honest one).*

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R173** — the RLS-deferring `EXISTS` was pinned only in directions the rejected 013 form satisfies too; the 067 league-shared-private case, the sole discriminator, was pinned nowhere | should-fix | **pgTAP 028 gains the 067 fixture and the pin.** New fixture: `leagues` `pgtap-lpd-league` (u1 commissioner, u2 manager, u3 deliberately not a member), `league_lists (shared_with_league = TRUE)` over a NEW private list `lpd u1 private league-shared` (`94000000-…-0005`). New assertion 38, a `lives_ok` for u2 marking on it, sits **immediately after** the existing `throws_ok` for u2 on u1's plain-private `…-0002` — the two lists differ in exactly one respect, so the pair isolates the `EXISTS` and nothing else. `plan(47)` → `plan(49)`. **Probe:** the Reviewer's exact `ALTER POLICY` → **not ok 38** (`42501: new row violates row-level security policy`) **+ not ok 47** (the downstream total-rows epilogue), `# Looks like you failed 2 tests of 49`; restored by full `db reset` → **49/49**. The 079 banner was rewritten to stop overclaiming: it now names all three directions, says which suite pins each, states that the third is the load-bearing one, and records that the 013 form was **measured** passing the whole suite green before the pin existed |
| **R174** — "does not cascade to other lists", D2's most explicit prohibition, was indistinguishable from a cascade that wiped every list: both fixtures gave the victim exactly one list | nit | **The victim now lives on two lists in both suites.** pgTAP 028: `pgtap-lpd-p2` joins `lp4` as well as `lp1` and is marked on both; the positive control asserts 2 marks, then removing him from `lp1` asserts **0 on lp1 and 1 on lp4** (new assertion 24). `drafted-api-db.test.ts`: the cascade test puts `PLAYERS[1]` on the private board too, marks him there, and asserts that mark survives the public-list removal — then restores the fixture so the downstream clear-drafted counts are unchanged. **Probe:** an `AFTER DELETE` trigger on `list_players` wiping marks for that player across every list → **not ok 24** (+ the two total-rows guards), `# Looks like you failed 3 tests of 49`; dropped by the same `db reset` → 49/49 |
| **R175** — the un-mark path collapsed "you had no mark" and "the delete was not permitted" into one `changed: false`, while its `drafted: true` twin distinguishes them (42501 → 403) | nit | **Hard assertion, not a comment** (LV.1.3 consumes `setDrafted`). New `assertCallerIs(supabase, userId)` in `drafted-service.ts` compares `userId` against the client's real `auth.uid()` and returns the same **403 `CANNOT_MARK_MESSAGE`** the twin returns. It is called **only when the DELETE removed nothing** — in `setDrafted`'s un-mark arm and in `clearDrafted` — which is deliberate on two counts: the happy path pays no extra auth round-trip, and the 42501 arm of `setDrafted` stays **reachable through the service**, so the existing "a 42501 the probe cannot foresee becomes a friendly 403" test keeps pinning that code→copy mapping instead of being short-circuited into dead code by an eager guard. `getUser()` failing is a 500, never a swallowed no-op. Three new stack tests: the two 403s (each with a privileged positive control proving the row the call failed to delete really exists) plus a **counter-control** — a genuine zero-row un-mark by the rightful caller is still a plain 200 `changed:false`. **Probe:** both `assertCallerIs` call sites removed → **2 RED** (`expected 200 to be 403`) with the counter-control still green; reverted → 24/24 |

**Not changed, and why:** `clearDrafted` still skips the list-readability
probe (§4's decision 2 — 079's DELETE policy is unconditional on purpose, so
you can always clean up your own rows on a list that has since gone private
or into the trash). R175 adds an identity check, not a visibility check.
