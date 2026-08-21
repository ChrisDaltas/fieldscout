# Task breakdown: MS — the mock is your sandbox (the launcher holds the commissioner's tools)

**Lane:** MS (`MS.*`) · **Architect session 2026-08-20** · **Spec fold: `spec-redraft-leagues.md` v2.15**
**Input:** four rulings Chris made in-session on 2026-08-20 (§3), after using Mock Draft Mode.
**Base:** `main` @ **`90178a7`** (AP.2). AP.3 (`a4e3bc7`/091), AP.1 (`ce25b0c`/092) and AP.2 (`90178a7`/093) are all merged; **PR #180 (DR2) is open** and holds D204–D212 / F87–F91 / Q19–Q21 / E71–E74 — R312 first-filed-keeps, so this lane takes numbers above both (§1.9).
**Status:** authored — **awaiting Chris's approval of this PR.** Nothing here is built until it merges (the #150 / #155 / #161 / #178 precedent).

> **This lane overturns a rule that was correct when it was written.** D103/D110(1) closed every §8.7 commissioner control on a mock because it read them as *interference with a member's solo practice* — one member reaching into another's rehearsal. That reading was right about authority and it caught a real bug (an unguarded `draft_reset` was live-proven to write the league). What it missed is that **in a mock the launcher and the commissioner are the same person**, so there is nobody to interfere with. Chris ruled it: the solo driver is the commish of their own sandbox.
>
> **What is NOT overturned: §8.8's zero-side-effects rule.** A mock still writes nothing to the real league. That rule is the *reason* D103 caught something real, and it is this lane's gate on every task (§4 rule 14). **The audit finds which controls can pass it — it does not assume `draft_reset` is the only one that cannot.** As of this survey, **three** of the fourteen-item §8.7 surface are structural breaches, not one (§2.3).
>
> **The spec is LAW.** Where this document and v2.15 disagree, v2.15 wins and this document gets corrected.

---

## 1. Surveyed facts (2026-08-20; every load-bearing fact opened and read on `main` @ `90178a7`, or measured against the deployed local schema)

Cited by symbol where a symbol exists; a line number is given for the exact clause and a symbol beside it so the citation survives the next edit. Where a fact was measured rather than read, the command is named.

### 1.1 The refusal, and where it actually lives

- **The refusal is SPEC LAW, not only a decision.** `spec-redraft-leagues.md:567` (§8.8, erratum v2.8.16) prints: *"…every §8.7 commissioner control refuses mocks — an unguarded reset was a live-proven league write."* **This is why this PR folds the spec** (§1.8): without the fold, every MS task contradicts LAW and the first Builder is obliged to halt.
- **The in-body refusal is one sentence, repeated verbatim in eleven functions**, all at the head of the migration chain:

  ```
  <verb>: mock drafts have no commissioner controls — the launcher can pause,
  resume, or delete their practice (§8.8/D103)
  ```

  Head sites, resolved with `grep -lE '^CREATE (OR REPLACE )?FUNCTION +(public\.)?<name>\(' supabase/migrations/*.sql` and each line located with `grep -n "mock drafts have no commissioner controls" supabase/migrations/*.sql`:
  `draft_set_clock` **090:209** · `draft_undo` **090:389** · `draft_reassign_pick` **092:1488** · `draft_move_player` **092:1776** · `draft_adjust_budget` **092:721** · `draft_force_pick` **093:2208** · `draft_set_order` **087:2341** · `draft_reset` **087:2513** · `draft_reverse_won_bid` **087:541** · `draft_cancel_nomination` **087:856** · `draft_end` **087:967**.
  *(Superseded copies also exist in 069 and in the earlier 087/092 bodies — 27 sites in the file tree, 11 of them live. Do not edit a superseded body; D137/CLAUDE.md.)*
- **The guard's own comment already names the exception it did not take** — `090:201–206`, identical text at every site:
  > `-- MOCK GUARD (L.B1.6/071 — amended in place, F12; D103(2)/§8.8): §8.7 is the REAL-draft commissioner surface. On a mock this control is interference with a member's solo practice (and for draft_reset an outright zero-side-effect breach — it writes leagues.status and the stored schedule instant). The launcher's controls are pause/resume/delete (069 mock arms + 071). Pinned in pgTAP 025.`
- **The identity gate runs BEFORE the mock refusal in all eleven — measured, not read.** `SELECT proname, strpos(prosrc,'is_league_commish') < strpos(prosrc,'mock drafts have no commissioner controls') FROM pg_proc …` returns **`t` for all 11**. So today a launcher who is *not* the league commissioner gets `42501 not a commissioner of this draft's league`, never the friendly P0001 — exactly as D110(1) recorded ("A launcher without the commissioner role gets 42501 on those seven"). **MS.2 must reorder, or the friendly refusal stays unreachable for the very person the lane is about.**

### 1.2 The launcher-authority idiom already ships, and it is NOT `resolveActingSeat`

- **The pattern to copy is `draft_pause` / `draft_resume`** — `069:404–415` and `069:458–468`, a two-part gate:
  1. `IF NOT FOUND OR NOT is_league_member(league_id) OR (NOT is_mock AND NOT is_league_commish(league_id)) THEN` → `42501` with the message **unchanged for real drafts** (pgTAP 023's pins);
  2. `IF is_mock AND config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN` → `P0001 'draft_pause: only the member practicing this mock can pause it (§8.8/D103)'`.

  The comment at `069:395–403` states the doctrine: *"on a mock the authority is the LAUNCHER, not the commissioner … commissioners have NO bypass — nobody else drives a solo practice."*
- **`resolveActingSeat` is a different thing at a different layer, and the working draft of this document had it wrong.** `draft-service.ts:361–387` is TypeScript; it resolves the caller's **acting franchise** (`league_members.team_id`, or `config.mock.human_team_id` on a mock) for the queue writers and for the F65 response-integrity discriminator (R420/D190). Its mock arm *does* compare `launched_by` and return `NOT_YOUR_MOCK_MESSAGE` at 403 — but it also **requires `human_team_id` and returns a team**, which no commissioner control needs, and it is **not** the server-authoritative gate. **MS.2's authority is SQL, in-body, and modelled on 069's arms.** `resolveActingSeat` is not extended and not reused.
- **Two gate helpers already exist in this exact shape**, so a third is idiomatic rather than novel: `draft_auction_pause_gate_internal(p_draft drafts, p_verb text)` and `draft_auction_high_bid_gate_internal(p_draft drafts, p_team_id uuid, p_verb text, p_remedy text)` (both 087, the first replaced by 090).

### 1.3 The API layer needs almost nothing

- **One pipeline already reaches a mock.** `dispatchControl` (`draft-service.ts:1070–1094`) parses → `resolveDraftForAction` → RPC over a closed union. `resolveDraftForAction` (`:317–341`) applies `.eq('is_mock', false)` **only on the no-`draft_id` probe**; with an explicit `draft_id` — which a mock room always sends — there is no mock filter and no status filter. So ten of the eleven verbs already reach a mock's `draft_id` and are refused only by the RPC.
- **The routes carry no authorization at all** — `…/draft/clock/route.ts` is auth-check → `setClock(supabase, id, body)`. Server-authoritative, in-body, as §12/§4.1 require. **No route file changes for MS.2.**
- **`draft_set_order` is the one exception and it is an API-layer block.** The order edit is not in `ControlRpcName`; it rides the draft **PATCH** (`patchDraft`, spec erratum v2.8.17/D114), whose draft lookup is `.eq('is_mock', false)` at **`draft-service.ts:202`** with no `draft_id` override. Even with the RPC opened, a mock's order edit is unreachable. MS.2 owns that decision explicitly (§5).
- **Two §8.7 panel sections are not `draft_*` RPCs at all** — see §2.2.

### 1.4 What each control writes (measured against the deployed schema)

Direct write targets, extracted from `pg_proc.prosrc`:

```sql
SELECT p.proname, string_agg(DISTINCT m[1]||':'||m[2], ', ')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
     LATERAL regexp_matches(p.prosrc,
       '(INSERT INTO|UPDATE|DELETE FROM)\s+public\.([a-z_]+)', 'gi') AS m
WHERE n.nspname = 'public' AND p.proname LIKE 'draft%' GROUP BY 1 ORDER BY 1;
```

The result is in §2.1. **Direct statements are not the whole answer** — three of the controls reach further through helpers, and the call graph must be followed:

- `draft_end` → `draft_complete_internal`, which writes **`league_rosters` and `leagues`** — but **already inside `IF NOT v_draft.is_mock THEN`** (measured: the guard wraps both writes). So the completion breach is closed at the writer, not at the caller. 041 §J (R467) pins that a mock completing through AP.2's new route leaves the whole `leagues` row byte-identical.
- `draft_force_pick` → `draft_apply_pick_internal` → `draft_complete_internal` (same guard) and, since AP.2, `draft_award_nomination_internal`.
- `draft_undo` / `draft_cancel_nomination` → `draft_void_nomination_internal` (`draft_bids`, `drafts` — draft-scoped).
- **A side effect is not only a row.** Every one of `drafts`, `draft_picks`, `draft_bids`, `league_chat`, `leagues`, `league_rosters` carries a broadcast trigger (`pg_trigger`, non-internal). Measured: `broadcast_draft_update` sends to `'draft:' || NEW.id`, `broadcast_league_chat_insert` routes on `NEW.context LIKE 'draft:%'` and otherwise to `'league:' || NEW.league_id`. So a mock-scoped write reaches only the mock's own topic — **and `draft_reset`'s `UPDATE public.leagues` fires `tr_broadcast_leagues` onto the `league:<id>` topic, which every member of the real league is subscribed to.** §8.8 isolation therefore has a *topic* dimension as well as a *row* dimension; MS.1 measures both.

### 1.5 `draft_reset` — the breach, and why a mock-safe variant is not a subtraction

`draft_reset`'s HEAD is **087:2481–2615**. Its writes, in order: `draft_picks` soft-undo · `draft_bids` void sweep (R379/D162) · `league_chat` system post · the `drafts` row back to pre-draft · `DELETE FROM draft_liveness` · and then

```sql
UPDATE public.leagues SET
  status     = 'scheduled',
  settings   = settings #- '{draft,draft_scheduled_at}',
  updated_at = now()
WHERE id = v_draft.league_id;
```

(`087:2604–2608`, with the D107(5) reasoning in the comment above it). It also takes `FOR UPDATE` on the league row at `087:2529–2531`. **D110(1) live-proved the breach** — *"main's unguarded draft_reset restored in a rolled-back txn: reset(mock) flipped the league `setup`→`scheduled` AND removed `settings.draft.draft_scheduled_at`"*.

Two facts make the variant a design problem rather than a deletion:

- **`drafts.status = 'scheduled'` is a state a mock cannot leave.** `draft_start_internal` filters `AND d.is_mock = FALSE` (measured, twice in the body), so neither the Start button nor `draft_tick`'s D94 auto-start arm can restart it. A reset mock would be **permanently stuck**.
- **…and the room has a rendering for it, which is the wrong one.** `draft-room.tsx:415` is `if (draft.status === 'scheduled') return <DraftLobby …/>`, mounted with `isCommish={canUseCommishPanel(detail.data.my_role)}` at `:427` — **no `!is_mock` mask on that mount**, because a mock has never been `scheduled`. A reset mock would render the real draft's pre-start lobby, offering a Start that cannot fire.

So a mock-safe reset must return the mock to **`live` at pick 1**, not to `scheduled`. That is a different write, not a removed one. §5 MS.4.

### 1.6 The D141 pause-first gate, and the exact width of the carve-out

- **D141 is auction-only in its own text** (PROGRESS §4 D141: *"enforced IN-BODY, auction-only; snake keeps its shipped posture"*, with the divergence filed as F57). **Chris's F57 ALIGN ruling of 2026-08-18** is what made it every draft type — folded as spec **§8.7 v2.12.5** (`spec:541`) and built as **migration 090 / L.C1.8**. Cite both; they are not the same event.
- **One gate function, six consumers — measured, not listed from memory.** `SELECT proname FROM pg_proc WHERE prosrc ~ 'draft_auction_pause_gate_internal'` (excluding itself) returns exactly `draft_cancel_nomination, draft_move_player, draft_reassign_pick, draft_reverse_won_bid, draft_set_clock, draft_undo`. The gate's HEAD is **090** and its body refuses only `IF p_draft.status = 'live'`, with two sentences (auction / non-auction).
- **That consumer set is pinned against the migrations by a vitest test.** `commish-auction-ops.test.ts:171` asserts `consumers` (read out of the migration HEADs at `MIGRATIONS`/`GATE`, `:53–54`) equals `Object.keys(PAUSE_FIRST_RPC_SECTIONS)` (`draft-options-ops.ts:106–118`). **A carve-out that changes the *consumer set* reddens this pin; a carve-out that changes the gate's *body* does not.** MS.3 must take the second shape.
- **The clock edit already never rewrites a running clock, on either draft type, and there is no machinery left that could.** `draft_set_clock`'s auction arm writes only `drafts.config` + a `league_chat` post whose text ends *"(applies to upcoming nominations)"* (`090:264–276`); the snake arm writes `config.pick_timer_seconds` + *"(applies to upcoming picks)"* (`090:312–326`). **Both `extend_current` arms are refusals** — the auction one shipped that way in 087, and 090 **deleted** the snake extend machinery outright, with the reason in the comment at `090:291–303`: *"Keeping the live extend machinery below a gate that forbids reaching it would be a booby trap."* So E15's "subsequent picks only" is structural here, not something MS.3 builds.
- **…but both refusal messages presuppose a paused draft, and on a running mock they become false.** Auction: *"the draft is paused, and the new timer applies when it resumes (§8.7 v2.10)"* (`090:236–239`). Snake: *"the current pick keeps its stored remaining time across the pause…"* (`090:305–307`). MS.3 owns the wording.
- **The three auction clocks are named, in the settings panel and the panel section:** *Nomination clock*, *Bid clock* (hint: *"Seconds each bid resets the clock to."* — `settings-panel.tsx:1525`), *Anti-snipe* (`settings-panel.tsx:1539`, `commish-draft-panel.tsx:614`). There is no control called "bid reset". A **snake** mock's clock is `pick_timer_seconds`, and Chris's ruling is about mocks, not about auctions — MS.3 covers `draft_set_clock` entire.

### 1.7 The room already has the seam MS.5 needs — no layout is prejudged

- **`commandBarModel` is a pure ops function with the two buckets already separated** (`command-bar-ops.ts:97–129`):
  `const commissioner = input.commishRole && !isMock` (`:101`, comment: *"D110(1): a commissioner in a mock is NOT a commissioner"*) · `draftOptions: commissioner && !lobby` (`:114`) · **`practiceOptions: isMock && isMockLauncher && !lobby`** (`:115`). `isMockLauncher` is already an input (`:56`) and `pauseResume` already resolves *"commissioner on a real draft, the LAUNCHER on a mock"* (`:75–81`).
- **The launcher's menu exists and holds exactly one item.** `draft-command-bar.tsx:163–185` renders *Practice options* → a single `DropdownMenuItem`, **"Delete practice & exit"**. That is the whole launcher surface today.
- **The commissioner's door is `DraftOptionsMenu`** (`draft-options-menu.tsx`), whose entries come from `draftOptionsEntries(isAuction)` (`draft-options-ops.ts:83–86`) — 8 snake groups, 11 auction groups — and which opens the **shipped** `CommishDraftPanel` at a section (D153: a menu over the panel, never a reimplementation).
- **The panel's mount carries the mask, and a test pins the mask's source text.** `draft-room.tsx:704` — `const isCommish = canUseCommishPanel(detail.my_role) && !draft.is_mock` — gates `{isCommish && <CommishDraftPanel …/>}` at `:1311`. **`draft-command-bar.test.ts:151–153` asserts that exact line by regex.** MS.5 moves that pin; it does not delete it.
- **DR2 does not restructure the command bar.** Its nine tasks are the dock, the dark treatment, the Lists filter, the Chat pop-out, notes-in-row, the auction board zone, the schedule and league creation; the only command-bar mentions in `tasks-DR2-draft-room-v2.md` are a line-number reference (`:23`) and a non-modality requirement (`:258`). **So MS.5 inside the command bar prejudges nothing** — but see §4 rule 16.

### 1.8 The pins that hold the current rule (they move, they are never deleted)

| Where | Count | What it pins |
|---|---|---|
| `supabase/tests/025_mock_draft_mode.sql:783–822` | **7** | the 069 controls refusing a snake mock (`draft_reset`'s cell at `:784` names the breach) |
| `supabase/tests/036_auction_commish_controls.sql:2114–2181` | **11** | §M's full mock refusal sweep, plus the §8.8 composite at `:2185–2201` |
| `supabase/tests/038_mock_auctions.sql:1390–1447` | **11** | D138's sweep on an auction mock |
| `src/lib/leagues/api/draft-commish-api-db.test.ts:424–435` | 2 | the refusal through the ROUTE (`undo`, `clock`) |
| `src/lib/leagues/api/auction-commish-api-db.test.ts:365–366` | 1 | `MOCK_REFUSAL(verb)` helper, used across the auction verbs |

**29 pgTAP assertions and 3 vitest sites.** Every one is a never-weaken pin under tasks-M3 §4 rule 3: they **re-point** (a refusal becomes a success plus an isolation composite, or a refusal with a *new, true* message), and a diff that deletes one without replacing its coverage is an automatic review finding.

**The §8.8 composite pattern already exists in three shapes and MS.6 unifies them:**
- `025:940–1000` — `to_jsonb(l)` whole-row for `leagues`, **counts** for `league_members`/`teams`/`team_managers`/`league_invites`/`league_weeks`/`league_lists`/`notifications`/`league_chat`-outside-the-mock.
- `036:2185–2200` (**R383**) — whole `drafts` row `|` whole `leagues` row `|` picks/bids/chat/liveness counts.
- `039:726–760` (AP.3) — `EXCEPT ALL` whole-row for `leagues` **and** the real `drafts` row, counts for the rest; `041:719–741` (AP.2/R467) — `to_jsonb(l)::text` plus five counts.

**A count is blind to an in-place UPDATE**, and the controls this lane enables include three that UPDATE `draft_picks` in place (`draft_reassign_pick`, `draft_move_player`, `draft_reverse_won_bid`). That is the gap MS.6 closes.

### 1.9 Numbers and chain heads (confirm again at task time — D161)

**Number note (D161's grep-together rule).** R, D, F, Q and E swept **together**, across `main` @ `90178a7` **and** the one open branch (`gh pr list --state open` → PR **#180**, `docs/DR2-draft-room-v2`), per D161's "`git show <open-branch>:docs/specs/PROGRESS-leagues.md` must be grepped for R, D and F together" — extended to Q and E because both counters are also in flight.

| Counter | `main` | PR #180 | **This session takes** |
|---|---|---|---|
| R | 467 | 455 | *(none — Architect sessions file no findings)* |
| D | 215 | 212 | **D216–D221** |
| F | 97 | 91 | **F98–F100** |
| Q | 18 | 21 | **Q22** *(one, §7)* |
| E | 70 | 74 | **E75–E76** |

`D700` / `F9731` are the `#FFD700` / `#F97316` hexes in `spec-tier-view.md`, excluded per D180. **F97 on `main` is a real row** (AP.2's `useAntiSnipe` finding) as well as a hex — both exist; the ledger value is 97. **Re-sweep at merge.**

- Migrations top at **093** (`093_uncontestable_instant_award.sql`); pgTAP tops at **041**. MS expects **094+** and pgTAP **042+** — **AP.4/AP.5/AP.6, DR2 and SE all contend for the same band.** Confirm the real next-free with `ls supabase/migrations/ supabase/tests/` at task time and do not trust a number written here (D161/D166; AP.1 and AP.3 both had their expected numbers move).
- **Spec version: this lane takes v2.15**, because PR #180 already filed **v2.14** and R312 is first-filed-keeps. If #180 merges after this PR the changelog will briefly read v2.15 → v2.13 and then fill in; that is the same resolution D144(6) anticipated for v2.11/v2.12.

---

## 2. The control inventory (enumerated from the deployed schema, not from memory)

### 2.1 The eleven RPCs that refuse a mock today, and what each writes

Write targets are §1.4's query; "reaches" follows the call graph (`prosrc ~ 'public\.<name>\s*\('`). **Scope** answers one question only: *do these writes leave the mock's own draft_id?*

| # | Control (§8.7 row) | HEAD | Writes | Reaches | Scope |
|---|---|---|---|---|---|
| 1 | **Edit pick clock / auction timers** `draft_set_clock` | 090 | `drafts`, `league_chat` | `draft_auction_pause_gate_internal` | mock-local (config + `draft:<mock>` chat) |
| 2 | **Undo last pick / cascade** `draft_undo` | 090 | `drafts`, `draft_picks`, `draft_bids`, `league_chat` | pause gate, `draft_void_nomination_internal`, `draft_team_for_pick` | mock-local — all rows keyed on `draft_id` |
| 3 | **Reassign a pick** `draft_reassign_pick` | 092 | `drafts`, `draft_picks` (**in place**), `league_chat` | pause gate, high-bid gate, `draft_team_budget`, `draft_auction_solvent` | mock-local; `team_id` points at REAL `teams` rows but writes none |
| 4 | **Move a drafted player** `draft_move_player` | 092 | `drafts`, `draft_picks` (**in place**), `league_chat` | as above | as above |
| 5 | **Pick / nominate for a manager** `draft_force_pick` | 093 | `drafts`, `draft_picks`, `draft_bids`, `league_chat` | `draft_apply_pick_internal` → `draft_complete_internal` (**mock-guarded**), `draft_award_nomination_internal`, `draft_nomination_uncontestable` | mock-local *if* the completion guard holds — **measure it** |
| 6 | **Reverse a won bid** `draft_reverse_won_bid` | 087 | `drafts`, `draft_picks` (**in place**), `league_chat` | pause gate, `draft_auction_solvent`, `draft_team_budget` | mock-local |
| 7 | **Adjust auction budget** `draft_adjust_budget` | 092 | `drafts` (`budget_adjustments`), `league_chat` | high-bid gate, `draft_auction_reserve`, solvency | mock-local |
| 8 | **Edit current nomination** `draft_cancel_nomination` | 087 | `drafts`, `league_chat` | pause gate, `draft_void_nomination_internal` | mock-local |
| 9 | **Edit draft / nomination order** `draft_set_order` | 087 | `drafts`, `league_chat` | `draft_team_for_pick` | mock-local — **but unreachable via the API (§1.3)** |
| 10 | **End draft** `draft_end` | 087 | `league_chat` | `draft_complete_internal` (**mock-guarded**), `draft_void_nomination_internal`, solvency | mock-local *if* the completion guard holds — **measure it** |
| 11 | **Reset draft** `draft_reset` | 087 | `draft_picks`, `draft_bids`, `drafts`, `draft_liveness`, `league_chat`, **`leagues`** | — | ❌ **BREACH** — writes `leagues.status` + `settings`, and broadcasts on `league:<id>` |

**Already open to the launcher** (D110(1); not part of this lane's change, listed so the surface is complete):

| | Control | HEAD | Writes | Note |
|---|---|---|---|---|
| 12 | **Pause** `draft_pause` | 069 | via `draft_pause_internal`: `drafts`, `league_chat` | the launcher-authority idiom, `069:404–415` |
| 13 | **Resume** `draft_resume` | 069 | `drafts`, `league_chat` | `069:458–468` |
| — | **Delete practice** `delete_mock_draft` | 071 | `DELETE FROM drafts`, `DELETE FROM league_chat` | launcher-only; the §8.8 chat-FK sweep |

### 2.2 …and two §8.7 controls that are not `draft_*` RPCs at all

The `Draft Options` catalog has **twelve** section ids (`draft-options-ops.ts:32–44`). Ten map onto the RPCs above. The other two reach the **league**, not the draft, and are the part of the surface a `draft_*` sweep does not see:

| Section | Reached by | Writes | Scope |
|---|---|---|---|
| **`autopick`** — "Toggle autopick for any team" | `AutopickSection` (`commish-draft-panel.tsx:369–371`) → `useSetMemberAutodraft` (`use-draft-controls.ts:228`) → `PATCH …/members/[mid]` → `set_team_autodraft` (**072**) | `league_members` (**`is_autodraft`**), `league_chat` | ❌ **BREACH by construction.** The RPC is keyed on `p_league_id`, not a draft id, and its draft lock explicitly excludes mocks (`072:267`, `AND d.is_mock = FALSE`, comment: *"Mocks never read is_autodraft (068 hard-codes FALSE) and are excluded here"*). There is no mock target — the write always lands on the real seat, and D110(4) says the flag is meaningless inside a practice anyway. |
| **`seats`** — "Reassign a draft seat" | `SeatControlsSection` (`commish-draft-panel.tsx:1219–1242`) → `InvitePanel` | the league's real invite/assignment surface (`league_invites`, `league_members`, `team_managers`) | ❌ **BREACH by construction.** These are league verbs embedded in the panel; a mock has no seats of its own — it borrows the league's franchises. |

### 2.3 The count, stated plainly

The §8.7 surface is **fourteen items**: eleven refusing RPCs, two already-open launcher verbs, and two panel sections that reach league verbs. **Three of the fourteen are structural §8.8 breaches — `draft_reset`, the autopick toggle, and seat reassignment — not one.** The working draft of this document assumed `draft_reset` might be the only one; it was not. Everything else in the table is *provisionally* mock-local **by code read**, which is not the standard: **MS.1 converts every "mock-local" cell above into a measurement or removes it from the cleared list.**

---

## 3. The rulings this lane exists to implement (Chris, 2026-08-20 — verbatim)

1. *"in a mock my assumption was that the solo person is the commish so the user running the mock should be able to make it as fast as possible IMO and pause it if they need to do something. that's kind of the point of these mocks…"*
2. *"these mocks just get deleted when they're done so it really doesn't matter. if anything it could be a good way for random people to know what tools a commish has."*
3. On explanatory copy — **"no."**
4. Earlier the same day, governing the whole lane: *"a commish can pause a draft and change anything or someone can disconnect at any time. TBH in drafts that's known as a 'personal problem'."*

**What each one settles.**

- **(1) is the scope and the reason.** The launcher is the commissioner of their own sandbox, and the two things named — *make it as fast as possible* and *pause it* — are the clock and the pause. Pause already works (D110(1)); the clock is D141's carve-out (MS.3).
- **(2) is the answer to "is this worth building".** A mock is disposable, so the blast radius of a commissioner tool inside one is zero — provided §8.8 holds. Discovery is a *bonus he noticed*, not a feature to build. See (3).
- **(3) settles the copy question and it is CLOSED — do not reopen it.** No teaching label, no "these are the tools a commissioner has" line, no tutorial, no onboarding hint, no first-run tip. The tools are simply present and work. **MS.5's bar is that the controls are FINDABLE, not that they are EXPLAINED**, and no task may add copy to compensate for placement.
- **(4) forbids defensive machinery.** Nothing in this lane specs a confirm-you-really-meant-it flow, an are-you-sure over a clock change, an undo-the-undo, or a reconnect-safety net for a human who changed their mind. A commissioner changing things mid-draft and a manager dropping off are *the normal case*, and the engine already handles both. **A "safety" feature that (4) rules out is scope creep with good manners.** (This does not touch the *engine's* correctness guards — solvency, locks, idempotency and the §8.8 gate are not "defensive machinery", they are the contract.)

### 3.5 Design decisions (Architect; **D216–D221** — they enter PROGRESS §4 verbatim when this PR merges, the D126–D143 / D147–D156 / D166–D175 / D197–D203 / D204–D212 precedent)

#### D216 — Lane charter, numbering, and why MS is its own lane

**Number note (D161's grep-together rule).** R, D, F, Q **and E** swept together across `main` @ `90178a7` and the one open branch (PR **#180**, `docs/DR2-draft-room-v2`) — the full table is §1.9. `main` tops at **R467 / D215 / F97 / Q18 / E70**; #180 holds **D204–D212 / F87–F91 / Q19–Q21 / E71–E74**. R312 first-filed-keeps, so this session takes **D216–D221**, files **F98–F100**, opens **Q22**, and takes edge cases **E75–E76** and spec version **v2.15**. Re-sweep at merge.

1. **MS is a new lane with its own prefix, not an append to tasks-M3 §6 or to tasks-AP.** The AP/DR2 precedent exactly: Chris drove a *shipped* surface (Mock Draft Mode), ruled changes to it, and those changes get their own Architect document plus an ACTIVE-BUILD clause, while the milestone's approved breakdown stays what it is. MS's subject — who may drive a mock — is orthogonal to M3's exit criteria, to AP's pacing and to DR2's layout.
2. **The lane is small and it is a permissions change with one product consequence.** Six tasks, three of them without a migration. It is filed as a lane rather than as one big task because **the audit must be a separate deliverable from the change it authorizes** (D218), and because the §8.8 pins are the point rather than an afterthought.
3. **Task ids are `MS.1`–`MS.6`.** No `L.C`, `AP.` or `DR2.` id is reused, retired or renumbered.
4. **This PR folds the spec, and it has to.** §8.8's v2.8.16 erratum (`spec:567`) is LAW and says every §8.7 control refuses mocks. Cutting tasks that contradict LAW would oblige the first Builder to stop and file a spec question — a halt this session would have manufactured. The fold is deliberately narrow (§10 item 1) and takes **v2.15** because #180 already filed v2.14.

#### D217 — What D103 got right, what it missed, and the exact shape of the overturn

1. **D103/D110(1) were right about authority and right about the bug.** "A commissioner control on a mock is interference with a member's solo practice" is a correct sentence about a commissioner reaching into *someone else's* rehearsal, and the guard caught a live-proven `leagues` write. Neither of those is being called a mistake.
2. **What it missed is that in a mock the launcher IS the commissioner.** The doctrine was written from the *actor* side (who is reaching in) and never asked what happens when there is only one person in the room. Chris's ruling 1 supplies the missing premise, and the whole lane follows from it.
3. **The overturn is scoped to identity, not to isolation.** What changes: *who* may call a §8.7 control on a mock. What does not change: **§8.8's zero-side-effects rule** (unweakened, and now the explicit gate — D218), **D103(2)'s no-other-driver doctrine** (a commissioner who is not the launcher still gets nothing — MS.2 item 7 pins it), and every real-draft behaviour (§4 rule 13).
4. **The pattern is already in the codebase and it is 069's, not `resolveActingSeat`'s.** `draft_pause`/`draft_resume` solved this exact problem at L.B1.6 — member floor, then commissioner for real drafts, then launcher for mocks. MS.2 extracts that into one helper and applies it. The working draft of this document proposed reusing R420's `resolveActingSeat`; that is a **TypeScript API-layer seat resolver** for the F65 response-integrity check, not a server-authoritative gate, and reusing it would have put authorization in the wrong layer (§1.2).
5. **The gate ORDER is the load-bearing bug, and it is measured.** In all eleven controls `is_league_commish` fires before the mock refusal, so today's friendly P0001 is unreachable for a non-commissioner launcher — the exact person this lane is about. D110(1) recorded the consequence in one clause and nobody had a reason to act on it until now.

#### D218 — §8.8 is the gate, it is answered by measurement, and `draft_reset` was not the only breach

1. **The audit is its own task (MS.1) and produces a list, not a change.** Separating them is the point: a task that audits *and* enables will report on its own work, and the enable step's design will bend toward whatever the audit found convenient. MS.1 ships a cleared list with evidence per row and touches no behaviour.
2. **"Which controls are safe" is a measurement, never a reading.** §1.4 is why: two of the eleven reach a `leagues` write through a helper, so the direct write set is not the answer; and §2.2 is why a `draft_*` sweep is not the answer either — two §8.7 *panel sections* reach league verbs that no draft-function query will surface.
3. **Three structural breaches, found by this survey, against the working draft's assumption of one.** `draft_reset` (writes `leagues.status` + `settings`, and broadcasts on `league:<id>`); the **autopick toggle** (`set_team_autodraft`, 072 — keyed on `p_league_id`, mocks explicitly excluded from its lock, writes the real `league_members.is_autodraft`); and **seat reassignment** (the league's invite/assignment surface, embedded in the panel). The first is a body that could be narrowed; the other two are breaches *by construction* and have no mock-scoped version worth building (§10 item 4).
4. **Isolation has three dimensions, and a row count is the weakest.** Rows (whole-row composites, because three enabled controls UPDATE `draft_picks` in place), **broadcast topics** (`draft_reset`'s `leagues` write reaches every member's `league:<id>` subscription), and the whole-schema sweep as the net for a table nobody enumerated. §4 rule 10 states the standard; MS.6 builds the one harness that applies it.

#### D219 — The D141 carve-out is the CLOCK, and mocks only

1. **The carve-out's width is Chris's ruling 1 read literally.** He named two things: *"make it as fast as possible"* and *"pause it if they need to do something"*. Pause already works. The clock is what pause-first makes expensive — you cannot try a shorter bid clock without pausing, resuming, and losing the beat you were trying to feel.
2. **The other five pause-gate consumers keep pause-first even in a mock, and that is deliberate.** `draft_undo`, `draft_reassign_pick`, `draft_move_player`, `draft_reverse_won_bid` and `draft_cancel_nomination` all edit *draft state the tick is concurrently reading*, and the pause is what takes the tick out of the race — the gate's value there is not only social. Chris's own words endorse the workflow (*"pause it if they need to do something"*). **This is a narrowing, stated as one**: widening it later is one predicate, and MS.1's measurements will say whether it is worth it.
3. **D141 and the ALIGN ruling are two events and must be cited as two.** D141 (PROGRESS §4) was enforced **auction-only**, with the snake divergence recorded and filed as **F57**. **Chris ruled ALIGN on 2026-08-18**, folded as spec §8.7 **v2.12.5** and built as migration **090 / L.C1.8**. A document that says "D141 made all clock edits pause-first on every draft type" has compressed a ruling out of the record.
4. **The implementation shape is fixed by a pin, not by taste.** `commish-auction-ops.test.ts:171` couples the gate's *consumer set* to the UI's `PAUSE_FIRST_RPC_SECTIONS`. So the carve-out changes the gate's **body** (`AND NOT p_draft.is_mock`), never which functions call it — one predicate, one place, and the coupling that keeps the UI mirror honest stays intact.
5. **"The new value governs the next clock" is inherited, not built.** Both `extend_current` arms are refusals and 090 **deleted** the snake extend machinery precisely so a future gate-weakening could not resurrect it (`090:291–303`). MS.3 must not undo that reasoning for mocks — the two false refusal messages get re-worded, the machinery stays gone.

#### D220 — `draft_reset` in a mock: the frame, the constraint, and the recommendation

1. **The decision is real, not a formality.** "Stays off" is defensible — *Delete practice & exit* already exists and a fresh mock is one click away.
2. **But delete-and-relaunch is rate-limited and lossy.** §22.5 caps mock creations at **5 per hour** per user (in-body, advisory-locked — D110(6)), so a launcher iterating on settings hits a wall; and a relaunch **re-seeds a `random` order** on the new mock's own id (D110(5)), so "run that same board again" is something relaunch cannot do.
3. **The shape is constrained by a measured fact, and it is not the obvious one.** A mock-safe reset **cannot** write `status = 'scheduled'`: `draft_start_internal` filters `is_mock = FALSE`, so nothing could restart it, and `draft-room.tsx:415` would render the real draft's lobby with a Start button that cannot fire (**F99**). The variant must land the mock **`live` at pick 1**.
4. **Recommendation: build it**, as a mock arm inside the one verb (never a second RPC), taking no `leagues` lock and performing no `leagues` write. **Chris can overturn this when he reviews this PR** — it is recorded here rather than decided in a Builder session because it is a product call about what a practice room is for.
5. **Either way, MS.4 owns the lane's single most important pin:** the whole `leagues` row byte-identical around a mock reset, plus the absence of a `league:<id>` broadcast. That is D110(1)'s original live proof, converted from a memory into a permanent assertion.

#### D221 — Surfacing without teaching: the room already has the seam

1. **Chris ruled "no" on explanatory copy and that is a build constraint (§4 rule 14).** No teaching label, no "these are the tools a commissioner has" line, no tutorial, no onboarding hint, no first-run tip. **MS.5's bar is FINDABLE, not EXPLAINED.** Ruling 2's discovery benefit is a *consequence* of the tools existing, not a feature to be built on top of them, and copy added to compensate for placement fails both halves.
2. **Recommendation: the launcher gets `Draft Options` itself, not a grown `Practice options`.** Chris's ruling 2 is that a mock is where someone learns what a commissioner has — the honest way to do that is the **same door with the same name**, not a parallel menu that happens to hold the same items. It also means **one** catalog and **one** panel: a second menu re-solving a solved surface is the LV.7 failure pattern. `Delete practice & exit` joins the destructive group beside Reset, and the single-item practice menu disappears (§10 item 3).
3. **No layout is prejudged, and that is measured rather than assumed.** `commandBarModel` already separates `draftOptions` from `practiceOptions` and already takes `isMockLauncher`; the change is which groups a pure ops function returns. DR2's nine tasks do not restructure the command bar (measured against `tasks-DR2-draft-room-v2.md`). **If a control needs a place the room does not have, that is a DR2 question and MS.5 stops and flags it** (§4 rule 15).
4. **The UI must not offer what the engine forbids** — D110(1)'s rule survives the lane that overturns its conclusion. The launcher's group list is derived from MS.1's cleared list through one predicate, not maintained by hand in two places, and `autopick`/`seats` never render in a mock.
5. **`draft-command-bar.test.ts:151–153` pins `isCommish`'s source text by regex.** It moves to pin the new predicate; it is not deleted, and the docblock at `:21` that states the D110(1) seam is corrected with it.

---

## 4. Standing rules for every MS task

**`tasks-M3-auction.md` §4 rules 1–8 carry forward verbatim and in full force** — M1's four (grants doctrine D18→D23 · SECURITY DEFINER = in-body auth + `search_path=''` + REVOKE, §4.1 · the no-write-policy pgTAP pattern per role with RETURNING counts, §4.2 · the falsifiability floor incl. the ≥1 deliberate-break probe SHOWN failing and reverted, §4.3 · the migration checklist + typegen alias-block re-append, §4.4), M2's realtime doctrine (rule 5) and draft-row lock discipline (rule 6, incl. SQLSTATE conventions and held-lock < 50 ms per RPC family), and M3's solvency doctrine (rule 7) and bid-path discipline (rule 8). Builders cite all eight in the self-review note.

**Reproduced verbatim from `tasks-DR-draft-room-redesign.md` §4 rule 9, because this lane's central claim — "this control writes nothing outside the mock" — is the species of claim that is easiest to assert from intent and hardest to notice when it is wrong:**

> **A claim about the state of the world after your change must name the command or observation that establishes it — the falsifiability floor of tasks-M1/M2/M3 §4 rule 3, applied to prose — *no pin counts as a pin until it has been shown RED against the defect it claims to catch*. (This doc's own §4.3 is the design-system rule; the floor lives in the milestone docs, and DR tasks inherit it.)** This rule exists because of one measured pattern in DR.1's review (R339–R344, 2026-08-18): **every claim in that PR that had been MEASURED held up** — the `next build` route-manifest diff (136 URL values + 39 static/71 dynamic entries incl. every `namedRegex`, EMPTY), the same-cookie middleware differential in both directions, the F66 404 comparison against a `main` worktree, the shell-provider enumeration — several of them in more detail than they were written up with. **Every claim that failed was the same species: an assertion about the post-change world inferred from the INTENT of the change rather than observed.** "The rename replaced two identifiers so the file is still 1013 lines" (true of the rename, false of the commit — it was +22). "The other arms have buttons, so no state is a dead end" (four arms checked, two never enumerated — both had no exit at all). "The false docblock claim WAS corrected" (one of its two false sentences was). "`route-groups.test.ts` pins that" (pin written, path recalled — it is `src/lib/`, not `src/app/app/`). "Replayed with the identical cookie" (named in the helper, never delivered to `request.cookies`). Each was written in the *proved* register beside claims that genuinely were proved, and inherited their credibility; **each was one `grep`, one `wc -l`, or one DOM inventory away from being caught.** So, concretely: a sentence of the form *"X still lands"*, *"Y is not a dead end"*, *"Z was corrected"*, *"the pin covers it"* is **not shippable without the command or measurement beside it** — in the PR body, the docblock, or the PROGRESS entry. Prefer citing by **symbol** over line number where you can; a symbol survives the next edit. If you cannot cheaply establish it, write what you actually know ("not checked") — a hedge is free and a false disclosure costs the next Builder a day.

Five more join them for this lane:

10. **§8.8 IS THE GATE ON EVERY TASK, AND IT IS ANSWERED BY MEASUREMENT.** No MS task may enable, widen, or re-route a control without, in the same PR, an isolation proof over the **real league** taken around the enabled action: the **whole `leagues` row**, the **whole real `drafts` row**, and a **whole-row composite** (not a count) over every league-scoped table the action's write set or trigger graph can reach. *"It only writes `draft_picks`, which is keyed on `draft_id`"* is a reading, not a measurement, and §1.4's call graph is why: two of the eleven reach a `leagues` write through a helper. A whole-schema delta over all 56 `public` tables is the cheap first pass (`information_schema.tables` → 56, measured); the whole-row composite is what makes the pass mean something.
11. **The refusal message becomes a lie the moment the first control opens, and the sentence must move with the behaviour.** *"mock drafts have no commissioner controls"* is stated by eleven functions, 29 pgTAP assertions and 3 vitest sites (§1.8). When ten of the eleven open, the three that stay shut must say **why they specifically are shut** — not repeat a sentence about the whole class that is no longer true. Re-point every pin; delete none.
12. **The launcher gate is SQL, in-body, and one implementation.** Model it on `draft_pause`/`draft_resume` (`069:404–415`), extract it once in the `draft_auction_pause_gate_internal` idiom, and do not add a second identity path — in particular do not extend `resolveActingSeat`, which resolves a *seat* at the API layer for a different purpose (§1.2). Commissioners get **no bypass** on somebody else's mock; that is D103(2)'s doctrine and it is not what this lane overturns.
13. **Real drafts do not change. At all.** D141 stays exactly as Chris ruled it for every non-mock draft; the 42501 no-leak floor and every real-draft refusal message stay byte-identical (023/036's pins are the evidence, and they must pass untouched). Any diff whose effect is visible on a `is_mock = FALSE` draft has left this lane.
14. **Chris's ruling 3 is a build constraint, not a preference.** No MS task ships explanatory, teaching, onboarding or first-run copy about the commissioner tools. Control labels and refusal messages say what the control does or why it refused — that is the §16.5.4 designed-copy rule and it is not "explanation". A PR that adds a tooltip explaining what a commissioner is has broken this rule.
15. **The draft-room layout is parked and this lane does not move it.** DR2 (PR #180) is the layout rework and it is awaiting Chris. MS.5 works **within the existing structure** — the command bar's two menus and the shipped `CommishDraftPanel` sections (§1.7). If a Builder finds themselves needing a new region, a new panel, a resized zone or a new breakpoint, **stop and flag it**: that is a DR2 question, not an MS decision.

---

## 5. Task list (one Builder session each; ≤ half a day)

Every task: branch from up-to-date `main`, **one task one PR, do not merge**. Migration and pgTAP numbers are **expected** — confirm the real next-free at task time (§1.9).

**Why this is six tasks and not five (the restructure, and the reason).** The working draft put every §8.8 pin in a final MS.6. That is wrong as written: a task that enables a control **without** its isolation pin fails §4 rule 10 and the M1 §4.3 floor on its own DoD, so MS.2/MS.3/MS.4 each carry their own pins. **MS.6 is therefore re-scoped**, following the **DR.8 precedent** (a closing verification pass over a finished lane): it is the §8.8 **harness** — one reusable composite that every enabled control is driven through in one file — plus the strengthening of the three shipped composites' *count* cells into whole-row comparisons (§1.8). It closes the lane; it does not supply pins that earlier tasks owed.

---

### MS.1 — The audit: which controls can pass §8.8, decided by measurement *(no behaviour change)*

> Read spec **v2.15 §8.8** (the whole section, incl. the amended v2.8.16 erratum and the new v2.15 block), §8.7's table; this doc **§1.4, §2, D218**; `CLAUDE.md`'s "Never let *nothing happened* mean *it worked*". **Lane opener — nothing else in MS starts before its list exists.**
>
> 1. **Enumerate the surface from the deployed schema, not from this document.** Re-run §1.4's write-target query and §2's call-graph query; re-derive the §8.7 section catalog from `draft-options-ops.ts`. **If the count is not fourteen, the difference is the finding** — record it.
> 2. **For every item, run it against a live mock inside a transaction and take the delta**, in this order: (a) a **whole-schema row-count delta across all 56 `public` tables** (the cheap sweep that catches a table nobody thought of); (b) a **whole-row composite** over the real league's rows — the `leagues` row, the real `drafts` row, `teams`, `league_members`, `team_managers`, `league_rosters`, `league_invites`, `league_weeks`, `league_lists`, `notifications`, and `league_chat` outside `draft:<mock_id>` — using the `EXCEPT ALL` form of `039:726–738`, **because a count cannot see an in-place UPDATE and three of these controls UPDATE `draft_picks` in place** (§2.1 rows 3/4/6); (c) the **broadcast topics** the action fires (§1.4 — `draft_reset`'s `UPDATE leagues` reaches `league:<id>`, which every member is subscribed to).
> 3. **Two known breaches are not to be re-derived from the comment — re-measure them.** `draft_reset` (D110(1) live-proved it in a rolled-back txn; reproduce that) and the **autopick toggle** / **seat reassignment** of §2.2, which no `draft_*` sweep will find because they are league verbs. **Say explicitly whether you found a fourth.**
> 4. **Measure the two guarded paths rather than trusting the guard.** `draft_force_pick` and `draft_end` reach `draft_complete_internal`, whose `IF NOT v_draft.is_mock` wraps the `league_rosters` + `leagues` writes. 041 §J proved this for AP.2's route; prove it for **these two callers**, which is a path it has not been exercised from.
> 5. **Deliverable: the cleared list and the excluded list, each row with its evidence** — in the PR body and folded into PROGRESS. **No migration, no behaviour change, no test edits beyond adding the measurement harness** if you build one (which MS.6 will then own and generalize).
>
> **DoD:** §4 rules 1–15; the full-schema sweep and the composite shown for **every** item, not a sample; `npm run test:db`, `npm run test`, `npm run type-check` shown green (nothing should have moved — say so and show it). **Break probe:** temporarily strip `draft_complete_internal`'s `IF NOT v_draft.is_mock` and show the composite going RED on the `league_rosters` cell for the `draft_end` path; revert, and evidence both states. *(This is the probe that proves the harness can see a breach at all — without it, a clean sweep is CLAUDE.md's "nothing happened means it worked".)*

---

### MS.2 — Migration ~094: the launcher is the commissioner of their own mock

> Read spec **v2.15 §8.7** (the table + the v2.15 mock note) and **§8.8**, E75; this doc **§1.1, §1.2, §1.3, §2, D217**; `069:396–415` and `069:455–468` (the idiom), the eleven HEAD sites of §1.1, `draft-service.ts:196–215` (`patchDraft`'s mock filter) and `:1074–1094` (`dispatchControl`); **PROGRESS D103 / D110(1) / D138.** **Depends MS.1** — it enables exactly MS.1's cleared list and nothing else.
>
> 1. **One new gate helper, in the shipped idiom:** `draft_mock_launcher_gate_internal(p_draft drafts, p_verb text)` — SECURITY DEFINER, `SET search_path = ''`, REVOKEd per §4.1. Body = 069's second arm: on `is_mock`, refuse unless `p_draft.config->'mock'->>'launched_by' = auth.uid()::text`, with the friendly P0001 in `draft_pause`'s wording (*"only the member practicing this mock can …"*). **One implementation; a second COALESCE or a per-verb copy is a review finding.**
> 2. **Reorder the gates at every cleared site — this is the load-bearing change.** Today `is_league_commish` fires first in all eleven (measured, §1.1), so a non-commissioner launcher gets 42501 and never reaches the mock arm. The new order, matching `draft_pause`: **member floor → (real draft ⇒ commissioner) → (mock ⇒ launcher)**. The real-draft path must produce a **byte-identical** 42501 message (rule 13; pgTAP 023/036 are the evidence).
> 3. **`CREATE OR REPLACE` at the chain HEAD (D137 — read the newest migration that defines each, never `pg_get_functiondef`)** for each cleared control. **Re-resolve the heads with `grep -lE '^CREATE (OR REPLACE )?FUNCTION +(public\.)?<name>\(' supabase/migrations/*.sql` and record the resolved list in the banner** — §1.1's heads span 087/090/092/093 and AP.1 already found a breakdown's head list stale.
> 4. **Re-word the refusal that remains (rule 11).** Every control MS.1 excluded keeps a refusal, but *"mock drafts have no commissioner controls"* is then false. Each excluded control says why **it** is shut and what to do instead — e.g. `draft_reset` (pending MS.4) points at *delete this practice and start a new one*; the message must be true on the day it ships. **All 29 pgTAP + 3 vitest sites re-point in the same PR.**
> 5. **`draft_set_order`: decide and record, do not leave it half-open.** Its RPC is mock-local but `patchDraft` filters `is_mock = false` at `draft-service.ts:202` with no `draft_id` override (§1.3), so opening the RPC alone changes nothing observable. Either give the order edit the `dispatchControl` treatment for mocks, or **exclude it and say so in the refusal** — a control that is open in SQL and unreachable over the wire is the worst of both.
> 6. **Nothing else moves.** No route file changes (§1.3). No `resolveActingSeat` change (rule 12). No UI in this task — MS.5 owns the surface, and a control that is server-open but unrendered is a correct intermediate state.
> 7. **pgTAP ~042:** per cleared control — the **launcher succeeds** on a mock; a **member who is not the launcher** is refused with the friendly P0001; a **commissioner who is not the launcher** is refused identically (no bypass, D103(2)); the **real draft** is unchanged in both the success and the refusal message; and **the §8.8 composite of §4 rule 10 around each success**.
> 8. Migration banner per delivery-plan §8.1 with the R6/D38 waivers cited. **Typegen: one new function that is not PostgREST-visible** (an `_internal` helper is REVOKEd) — if `database.ts` regenerates at all, preserve and re-append the hand-written alias block and show the diff is additive-only (§4.4).
>
> **DoD:** §4 rules 1–15; fresh `npx supabase db reset` over the full chain; `npm run test:db`, `npm run test`, `npm run test:gate`, `npm run type-check` — all shown, none claimed. **Break probe:** make `draft_mock_launcher_gate_internal` return without raising → the *"a member who is not the launcher"* pin fails on every cleared control (shown RED, reverted, both states evidenced). **A second probe is required by rule 13:** flip one control's real-draft arm to admit a non-commissioner and show 036's 42501 pin going RED — proving the reorder did not quietly widen a real draft.

---

### MS.3 — Migration ~095: the clock is live in a mock (the D141 carve-out)

> Read spec **v2.15 §8.7's pause-first bullet incl. the v2.15 mock sentence**, §8.8, E15, **E76**; this doc **§1.6, D219**; **PROGRESS D141 and F57's ALIGN ruling (Chris, 2026-08-18)** — they are two events, cite both; `draft_auction_pause_gate_internal` at its **090** head; `draft_set_clock`'s auction arm `090:230–277` and snake arm `090:278–331`; `commish-auction-ops.test.ts:37–38/171` and `draft-options-ops.ts:88–118`. **Depends MS.2.**
>
> 1. **The carve-out is the CLOCK, and mocks only.** `draft_set_clock` no longer requires a pause on a mock. **The other five pause-gate consumers keep pause-first even in a mock** — see D219(2) for why, and say so in the banner rather than letting a reader infer that the gate was lifted wholesale.
> 2. **Take the shape that does not redden the coupling pin.** `commish-auction-ops.test.ts:171` asserts that the set of functions *calling* the gate equals `Object.keys(PAUSE_FIRST_RPC_SECTIONS)`. So **change the gate's body, not its consumer set** — the helper already receives the whole `drafts` record, so `IF p_draft.status = 'live' AND NOT p_draft.is_mock THEN` is one predicate in one place. **Do not** remove the `PERFORM` from `draft_set_clock`; that is the shape that breaks the pin and, worse, breaks the coupling that makes the UI mirror trustworthy.
> 3. **All the clocks a mock can have.** Auction: **nomination clock**, **bid clock**, **anti-snipe** (the three §7.3.8 timers; there is no control called "bid reset" — that phrase is the Bid clock's hint text at `settings-panel.tsx:1525`). Snake/linear: **`pick_timer_seconds`**. Chris's ruling is about mocks, not about auctions, so the carve-out is `draft_set_clock` **entire**.
> 4. **"The new value governs the NEXT clock" is already structural and must stay that way.** Both `extend_current` arms are refusals and 090 **deleted** the snake extend machinery on purpose (`090:291–303` — *"a booby trap"*). **Do not resurrect it for mocks.** A launcher who wants the current clock to end sooner has pause, and the very next nomination or pick takes the new number.
> 5. **Two refusal messages become false on a running mock and must be re-worded** (§4 rule 9): the auction `extend_current` refusal says *"the draft is paused, and the new timer applies when it resumes"* (`090:236–239`) and the snake one says *"the current pick keeps its stored remaining time across the pause"* (`090:305–307`). Both presuppose a pause the mock no longer needs. Give the mock path a true sentence and re-point the 023/036 pins onto it.
> 6. **The UI mirror moves with the SQL.** `pauseFirstDisabledSections` / `PAUSE_FIRST_RPC_SECTIONS` (`draft-options-ops.ts:106–127`) decides what renders disabled on a running draft; on a mock the clock group must not render disabled. **The RPC is still the authority** (§4.7) — the ops layer only stops inviting a click the server would refuse.
> 7. **pgTAP ~043:** on a **running** mock, each of the four timers is set with **no pause** and the stored `drafts.config` value changes (stored literals, both draft types); the **running deadline is untouched** by the edit and the **next** clock takes the new value (the E15 property, pinned at the boundary instant); on a **running real draft** every one of those calls still refuses with the **byte-identical** §8.7 v2.12.5 sentence; the other five gate consumers **still refuse on a running mock**; and the §8.8 composite around a mock clock edit.
>
> **DoD:** §4 rules 1–15; full-chain reset; all four suites shown. **Break probe:** widen the gate's new predicate to drop the `status = 'live'` term (i.e. lift pause-first everywhere) → the real-draft refusal pins in 036 §C and 023 go RED (shown, reverted). **This is the probe that proves rule 13 held** — a mock-only carve-out that a real draft cannot feel.

---

### MS.4 — `draft_reset` in a mock: the mock-safe variant, or it stays off

> Read spec **v2.15 §8.8**, §8.7's Reset row, §22.5's mock caps; this doc **§1.5, D220**; `draft_reset`'s HEAD **087:2481–2615** in its current file text, `draft_start_internal`'s `is_mock = FALSE` filters, `draft-room.tsx:415–430`, `071`'s `create_mock_draft` (the 3-active / 5-per-hour caps, D110(6)). **Depends MS.2.** **Decide and record — a "we didn't get to it" is not an outcome.**
>
> **The decision frame, so the Builder is not re-deriving it.**
>
> - **The case for "stays off":** the launcher already has *Delete practice & exit*, and a fresh mock is one click away. Zero §8.8 risk, zero new code.
> - **The case against, and it is not weak:** §22.5 caps mock **creations at 5/hour** per user (in-body, `pg_advisory_xact_lock`, D110(6)) — so delete-and-relaunch is a *rate-limited* substitute, and a launcher iterating on clock settings will hit the cap. A relaunch also **re-shuffles a `random` order** (the mock seeds on its own id — D110(5)), so "run that same board again" is not something relaunch can do.
> - **The constraint that decides the shape:** a mock-safe reset **may not write `drafts.status = 'scheduled'`**. `draft_start_internal` filters `is_mock = FALSE` (measured), so nothing could restart it, and `draft-room.tsx:415` would render the real draft's **lobby** — with a Start button that cannot fire — because that mount carries no `!is_mock` mask. **A reset mock must land `live` at pick 1**, holding its order and its seat.
>
> **Architect's recommendation: BUILD the mock-safe variant**, because the §22.5 cap makes the alternative a rate limit on practising, and because the variant is a *narrower* body (no league lock, no `leagues` UPDATE, no `draft_scheduled_at` strip) plus one honest difference (`live`, not `scheduled`). **Chris can overturn this in his review of this PR** — that is why it is written here and not decided in a Builder session.
>
> 1. If built: a mock arm inside `draft_reset` (**not** a second RPC — one verb, one door), taking **no** lock on `leagues` and performing **no** `leagues` write; picks soft-undone, bids voided (R379/D162's reasoning carries), `draft_liveness` cleared, the `drafts` row rewound to **pick 1, `status = 'live'`, a fresh `current_deadline`**, `current_nomination` NULL and `budget_adjustments` `'{}'` (R302's auction hygiene).
> 2. If **not** built: the refusal stays and gets rule 11's treatment — a sentence that names *this* control's reason and the way out (*delete this practice and start a new one*), and the 3 pgTAP cells that pin it are re-pointed onto the new text.
> 3. **Either way, MS.4 owns the `leagues`-row pin.** The composite around a mock reset must show the whole `leagues` row byte-identical **and** no broadcast on `league:<id>` (§1.4) — this is the one control with a live-proven breach on record, and its pin is the lane's most important single assertion.
> 4. **`draft_liveness`:** deleting the mock's heartbeat rows is mock-scoped (`WHERE draft_id = p_draft_id`) and correct; note in the banner that it re-arms the D108 supervision memory for the mock only.
>
> **DoD:** §4 rules 1–15; full-chain reset; all four suites shown. **Break probe (required in both outcomes):** restore the `UPDATE public.leagues …` line into the mock path → the §8.8 whole-`leagues`-row composite fails (shown RED, reverted). This reproduces D110(1)'s original live proof as a permanent pin instead of a memory.

---

### MS.5 — The tools are present in the mock room (findable, not explained)

> Read spec **v2.15 §8.8's surfacing sentence**, §8.7's v2.12 door note, §16.3 (say-a-thing-once), §16.5.4's designed-copy rule; this doc **§1.7, D221**, **§3 ruling 3** and **§4 rules 14 and 15**; `command-bar-ops.ts:97–129`, `draft-command-bar.tsx:150–185`, `draft-options-menu.tsx`, `draft-options-ops.ts:32–86`, `draft-room.tsx:704` + `:1311`, `draft-command-bar.test.ts:151–153`. **Depends MS.2** (and MS.3/MS.4 for which groups exist). **UI + ops only — no migration, no DB surface.**
>
> 1. **The seam is already there.** `commandBarModel` separates `draftOptions` (commissioner, real draft) from `practiceOptions` (launcher, mock) as two booleans, and `isMockLauncher` is already an input. The change is **which groups a launcher's menu holds**, computed in the pure ops layer where it is golden-pinnable.
> 2. **Decide between the two containers and record the reason:** (a) the launcher's **Practice options** menu grows the cleared groups above *Delete practice & exit*; or (b) a mock launcher gets **Draft Options** itself, with *Delete practice & exit* joining it. **The Architect's recommendation is (b)** — Chris's ruling 2 is that a mock is where someone finds out what a commissioner has, and the honest way to do that is to show them **the same door with the same name**, not a parallel menu that happens to contain the same things. (b) also means one catalog and one panel instead of two (the LV.7 anti-pattern is a second surface re-solving a solved one). **Whichever is chosen, the excluded groups must not render** — `autopick` and `seats` reach league verbs (§2.2) and `reset` depends on MS.4.
> 3. **The UI must not offer what the engine forbids** — D110(1)'s rule, which this lane inherits rather than retires: the group list a launcher sees is exactly MS.1's cleared list, derived from one predicate, not hand-maintained in two places.
> 4. **`draft-room.tsx:704`'s `&& !draft.is_mock` mask and the panel mount at `:1311` change together, and `draft-command-bar.test.ts:151–153` pins that line by regex.** **Move the pin, do not delete it** — it becomes an assertion about the *new* predicate, and its docblock at `:21` (which states the D110(1) seam) is corrected with it.
> 5. **No explanatory copy of any kind** (rule 14, ruling 3). Control labels and refusal text only. If a group's label reads oddly inside a practice room, the fix is a *better label*, never a sentence explaining what commissioners are.
> 6. **Do not restructure the room** (rule 15). Everything above lives in the command bar and the shipped `CommishDraftPanel`, neither of which DR2 touches (§1.7 — measured against `tasks-DR2-draft-room-v2.md`). **If a control genuinely needs a place the room does not have, stop and flag it for DR2** rather than inventing one.
> 7. **Goldens:** `command-bar-ops.test.ts`'s existing input matrix (`commishRole × isMock × isMockLauncher × paused`, `:33–190`) extends to cover launcher-with-controls, launcher-without-commissioner-role, commissioner-who-is-not-the-launcher, and the lobby; `draft-options-menu.test.ts`'s catalog golden gains the mock lists as **stored literals** (the exact group ids, not a count).
>
> **DoD:** §4 rules 1–15 (UI work, but this is the *reachability* half of a server change — it gets pins, not the one-review-pass reskin treatment); `npm run test`, `npm run test:gate`, `npm run type-check` shown; and a **browser pass in R278 form (prose + DB corroboration)**: launch a mock on the local stack, open the menu, use **at least two** enabled controls, and corroborate each in the database — *"a feature nobody can reach is a feature that does not exist"* (tasks-DR2 §4 rule 11's lesson, which this task is squarely in the path of). **Break probe:** force `isMockLauncher` false for the launcher → the menu disappears and the launcher-sees-controls golden fails (shown RED, reverted).

---

### MS.6 — The §8.8 harness and the lane's closing sweep

> Read spec **v2.15 §8.8**, this doc **§1.8, §4 rule 10, D218**; `025:831–1000` (§F), `036:2185–2200` (§M, R383), `039:722–760`, `041:716–741`; MS.1's cleared list. **Depends MS.2–MS.5.** **Closes the lane — the DR.8 precedent (a verification pass over finished work), not a place to put pins an earlier task owed.**
>
> 1. **One reusable §8.8 composite, in SQL, used by every mock suite.** Today there are four hand-rolled variants (§1.8) that measure different things: 025 counts eight tables, 036 whole-rows two and counts four, 039 uses `EXCEPT ALL` on two and counts six, 041 whole-rows one and counts five. Build the **one** the others become: a before/after snapshot helper over the real league's whole rows plus the mock's own counters.
> 2. **Strengthen the count cells into whole-row comparisons where a control can reach them in place.** Specifically `teams`, `league_members`, `team_managers`, `league_rosters`, `league_lists` and the real draft's `draft_picks`/`draft_bids` — **a count cannot see an UPDATE**, and `draft_reassign_pick`/`draft_move_player`/`draft_reverse_won_bid` are in-place writers (§2.1). **Do not weaken any existing cell to fit the harness** (never-weaken class): if a shipped composite measures something the harness does not, the harness grows.
> 3. **Drive every enabled control through it, in one file, on both draft types** — a snake mock and an auction mock, each with a **real scheduled draft alive in the same league** (025's E60 fixture and 039's §C6 second-practice-room case are the shapes that have caught things).
> 4. **The whole-schema pass, kept.** One `information_schema.tables`-driven row-count delta across all 56 `public` tables around the full sweep — the cheap net for a table nobody enumerated. It is a *complement* to the composite, never a substitute (a count is exactly what item 2 says it cannot do).
> 5. **Re-run every earlier MS break probe against the enlarged file and report that each original RED set reproduced** — D161(5)'s rule: recorded counts must be re-run when the file they count changes.
> 6. **Report the disclosure honestly.** State which controls are enabled, which are excluded and why, and **whether the harness would have caught D110(1)'s original `draft_reset` breach** — run it and say.
>
> **DoD:** §4 rules 1–15; full-chain reset; all four suites shown, with assertion counts before and after. **Break probe:** re-open one excluded control (the autopick toggle is the cleanest — it writes `league_members` unconditionally) and show the harness going RED on the `league_members` whole-row cell; revert, evidence both states. **A harness that cannot be shown RED is not a harness.**

---

## 6. Explicitly out of scope

- **Any change to real-draft commissioner behaviour, including D141 pause-first.** Real drafts keep the pause-first gate exactly as Chris ruled it under F57 ALIGN, keep every refusal message byte-identical, and keep the 42501 no-leak floor. This is §4 rule 13 and it is testable: a diff whose effect is visible on an `is_mock = FALSE` draft has left the lane.
- **The draft-room layout rework** — that is **DR2**, PR #180, **parked pending Chris**. MS.5 works inside the existing command bar and the shipped panel (§4 rule 15).
- **Broadening who may act on a REAL league's draft.** Nothing here touches `is_league_commish`, co-commissioner scope, seat ownership, or `canUseCommishPanel`. On a mock, commissioners get **no** bypass either — D103(2)'s "nobody else drives a solo practice" survives intact; the launcher gains authority, nobody else does.
- **The two league verbs of §2.2** (`set_team_autodraft`, the seat/invite tools). They are §8.7 *panel sections*, not draft RPCs, and they write the real league by construction. They stay off in a mock and this lane does not attempt a mock-scoped version of either.
- **Multi-human mock rooms** (§8.8's v1.1 line). "The launcher is the commissioner" is a statement about a *solo* practice; a mock with two humans in it would reopen D103's original question, and it is not v1.
- **`commissioner_actions` audit rows.** F32/F40 stand: the table does not exist until M6, every MS verb validates a `reason` and stores it nowhere, and the system chat post is the only trail. Say so in MS.2's banner rather than letting "the launcher is the commissioner" imply an audit that is not there.
- **Defensive machinery for humans changing their minds or dropping connection** — §3 ruling 4. No confirms beyond the hard-confirm class §8.7 already prints, no undo-the-undo, no reconnect nanny.

---

## 7. Open questions

**Q22 — should a mock's system chat posts stay?** *(filed 2026-08-20 by the MS Architect session. **NON-BLOCKING** — every task ships today's behaviour, which is that they do.)*

**Evidence.** Every enabled control posts a `league_chat` system row into `draft:<mock_id>` in the same transaction as its write (D97; measured — nine of the eleven write `league_chat` directly, §2.1). In a real draft that is §8.7's transparency requirement: *"Pause/Play, Reset, and every commissioner action remain visible to all users"* (`spec:544`). **In a solo practice there is nobody to be transparent to** — the launcher is the only human in the room, and the post tells them what they just did.

**Options.** **(a)** keep them, unchanged — one code path, and the transcript is a useful record of what you tried; **(b)** suppress them on mocks — less noise in a room where every message is your own echo; **(c)** keep them but let the room's chat default closed on a mock.

**Recommendation: (a), keep them.** Three reasons. The posts are **in-transaction** (D97) and removing them means branching nine write paths for a cosmetic gain. `delete_mock_draft` already sweeps the mock's chat rows explicitly (§8.8's chat-FK note), so they cost nothing at the end of a practice. And §8.8's own promise is *"Same engine, literally"* — a mock that behaves differently from draft night is worse than no mock, and the transcript is part of what draft night looks like. **This is deliberately a question rather than a decision** because it is the one place where Chris's ruling 2 (a mock is where you learn what a commissioner does) and his ruling 3 (no explanatory copy) point in slightly different directions: a system post is not *explanation*, but it is the closest thing in the room to a narration of what a commissioner tool did.

*(**The copy question is CLOSED and must not be reopened.** Chris ruled *"no"* on explanatory copy — §3 ruling 3, §4 rule 14. A task that files a question about tooltips, teaching labels or onboarding hints has misread the ruling.)*

---

## 8. Ledger dispositions (every §6 row this lane touches, swept 2026-08-20)

| Row | Disposition in MS |
|---|---|
| **F32 / F40** — `commissioner_actions` does not exist until M6 | **Unchanged and still true of MS.** Every enabled control validates a `reason` and stores it nowhere; the system chat post is the whole trail. MS.2's banner states this so "the launcher is the commissioner" does not imply an audit record. |
| **F41** — §22.5 rate limits on draft actions | **Unchanged, and relevant to MS.4:** §22.5's **5 mock creations per hour** is the measured reason delete-and-relaunch is not a free substitute for a reset (D220(2)). No new rate-limit surface is added. |
| **F57** — snake/auction pause-first divergence | **Already ruled and built** (ALIGN, Chris 2026-08-18; migration 090 / L.C1.8). **MS.3 must not disturb it:** the carve-out is `is_mock`, never `draft_type`, and 036 §C's four snake refusal pins stay green. |
| **F92** — the CPU nomination still rides the 5-second sweep | **Untouched.** A pacing row inside the mock, unrelated to who may drive it. Named here only because MS.3 changes clocks and a reader could mistake the two: MS.3 changes *when a commissioner may edit a clock*, not *when the sweep runs*. |
| **F94** — the local player pool is empty after a `db reset` | **Unchanged, and it bites this lane.** Several MS pins need drafted players (`draft_undo`, `draft_reassign_pick`, `draft_move_player`, `draft_reverse_won_bid`). Every MS suite must **assert its fixture is non-empty before asserting anything about it** — the CLAUDE.md "nothing happened means it worked" rule, which is what F94 is an instance of. Not discharged here. |
| **F98** *(NEW — filed by this PR)* | **MS has no ACTIVE-BUILD lane clause, so `/build-next` cannot take `MS.*`.** Every other lane's clause (DR, AP, SE, and DR2's in PR #180) was added by its own breakdown PR. This PR deliberately does **not** write one: PR #180 rewrites the same block *and* the loop-order list, and two concurrent edits there produce a conflict in the file the loop reads first. **Fix shape:** one lane block after AP's, plus a step in "The loop's order, precisely", naming MS's precedence relative to AP/DR2/`L.C*` (the Architect's read: **MS is a peer of AP and DR2 and blocks none of them** — its only shared file is `PROGRESS-leagues.md` and its migration band). **Discharged by the merge of this PR** (one commit on top, or resolved as part of #180's merge). Filed rather than left implicit because R51 makes an unrecorded hand-off a finding in itself. |
| **F99** *(NEW — filed by this PR)* | **`draft-room.tsx`'s lobby mount carries no `!is_mock` mask, and MS.4 is the first thing that could reach it.** `draft-room.tsx:415` renders `<DraftLobby …/>` for any `draft.status === 'scheduled'`, and `:427` passes `isCommish={canUseCommishPanel(detail.data.my_role)}` **without** the mask that `:704` applies to the live room. Harmless today (a mock is born `live` — `071`; and `draft_start_internal` filters `is_mock = FALSE` so no mock can be `scheduled`), which is exactly why it is a latent trap: any future write that lands a mock in `scheduled` renders the real draft's pre-start lobby with a Start button that cannot fire. **Discharged by MS.4** if the mock-safe reset is built (its `live`-at-pick-1 constraint is this row's reason); otherwise it stays filed as the trap it is, and any task that gives a mock a `scheduled` state owes it. |
| **F100** *(NEW — filed by this PR)* | **The `…/draft/clock` route's docblock describes behaviour migration 090 deleted.** `src/app/api/leagues/[id]/draft/clock/route.ts:19–20` states *"`extend_current: true` also extends the current deadline (GREATEST — extend-only; paused + extend refused in the RPC)"*. 090/L.C1.8 **retired the extend-current arm on both draft types** (`090:291–303`) — `extend_current` is now an unconditional refusal, so the docblock describes the opposite of what the route does. Noticed in passing while reading the route for §1.3; **not** drive-by fixed (no adjacent edits). **Discharged by MS.3**, which is already re-wording that refusal's messages and is the task a reader of this docblock would be working on. One-line fix. |

---

## 9. Sequencing

```
MS.1 (audit by measurement — the cleared list)        ← lane opener, nothing skips it
  └─→ MS.2 (~094: the launcher gate; enable the cleared set; re-point 32 pins)
        ├─→ MS.3 (~095: the D141 clock carve-out, mocks only)      ← discharges F100
        ├─→ MS.4 (draft_reset: mock-safe variant or stays off)     ← may discharge F99
        └─→ MS.5 (surfacing — command bar + the shipped panel)
              └─→ MS.6 (the §8.8 harness + the closing sweep)      ← closes the lane
```

- **The migration lane is serialized** (delivery plan §2.2): MS.2 → MS.3 → MS.4, each `CREATE OR REPLACE` authored against the chain HEAD's **file text** (D137 / CLAUDE.md). MS.1, MS.5 and MS.6 carry no migration; MS.6 adds pgTAP only.
- **MS.3, MS.4 and MS.5 are independent of one another** and may take any order after MS.2 — but **MS.5 renders whatever exists**, so taking it last means one pass over the menu instead of three.
- **MS.6 runs last by definition.** It is the verification pass, and a verification pass over an unfinished lane verifies nothing.

**Where MS sits relative to the other lanes:**

- **MS is a peer of `AP.*` and `DR2.*` and blocks neither.** It touches no auction pacing surface and no room layout. Shared surfaces are `PROGRESS-leagues.md` (append-collisions resolved at merge, the established pattern) and the migration/pgTAP number band (§1.9 — confirm next-free at task time).
- **MS does not block, and is not blocked by, `SE.*`** — the C37 parallel-track rule is unchanged.
- **MS must land before `L.C6.1`.** The M3 gate composes the lane suites by name (F84 for AP, F90 for DR2); MS's pgTAP files and its §8.8 harness join that list, and `L.C6.1`'s Builder must read this document's §5 and §8. *(Not filed as a fourth F-row: F84's text is the general obligation and the gate task already owes an enumeration; adding MS to it is one line at merge.)*
- **One shared file with DR2, in one direction:** `draft-room.tsx` (MS.5 changes the `isCommish` predicate at `:704`/`:1311`; DR2 changes the dock below it). Different regions of one file; resolve at merge deliberately.

---

## 10. Open items (not tasks — recorded so they are findable)

1. **The spec fold in this PR is deliberately narrow, and here is exactly what it does.** §8.8's v2.8.16 erratum is **amended, not rewritten** (its history is the record of a real bug); a new v2.15 block states the launcher-is-the-commissioner rule and re-states the zero-side-effects gate over it; §8.7 gains one sentence under the pause-first bullet carving the clock out for mocks; §19.2 gains **E75/E76**. **§16.2/§16.4 are NOT touched** — partly because Chris's ruling 3 means MS.5 adds no copy that would need a spec home, and partly because PR #180 rewrites §16.4 substantially and a second concurrent editor there buys a conflict for no content. If MS.5's container choice (D221(2)) turns out to need a §16 sentence, it rides MS.5's own PR as an erratum.
2. **Three merge conflicts with PR #180 are expected and all three are trivial** — the spec's `**Version:**` header line, the top of the spec changelog, and the tail of §19.2's edge-case table (DR2 appends E71–E74 where this PR appends E75–E76). Resolve as "keep both, in order". **No conflict in §8.7 or §8.8** — measured: `git diff main...FETCH_HEAD -- docs/specs/spec-redraft-leagues.md` shows DR2's nearest hunk is `@@ -570,14 @@`, which is §8.9.
3. **The `Practice options` menu is a one-item menu today** (*Delete practice & exit*, `draft-command-bar.tsx:176–182`). Whichever container MS.5 chooses, note that a menu holding a single destructive item is a shape that reads oddly either way — if MS.5 takes recommendation (b), the practice menu disappears entirely and *Delete practice & exit* joins Draft Options' destructive group beside Reset. That is a simplification, not a loss, and it is the tidiest outcome of the choice.
4. **Not proposed, and recorded so it is not re-proposed as an oversight:** a mock-scoped `league_members` shadow table (so the autopick toggle could work in a practice), a per-mock copy of the league's `teams`, and a "mock commissioner" role on `league_members` were all considered as ways to open §2.2's two league verbs. All three were rejected: each adds schema to make a control work that D110(4) already says is meaningless inside a mock (`is_autodraft` is hard-coded FALSE for mock seats at 068), and §8.8's v1 scope is explicitly *"league-attached only"* — the mock borrows the league's franchises on purpose.
5. **A note for whoever writes `L.C6.1`:** the §8.8 harness MS.6 builds is the natural home for any future "does this write outside the mock" question, including ones this lane did not raise (waivers, transactions, notifications). It is worth naming in the gate rather than leaving it as one more pgTAP file.
