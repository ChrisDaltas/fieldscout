# Active build

> **This file decides what `/build-next` builds.** It is the single pointer the
> build loop reads before anything else. Change it here, and every future
> cycle — including an unattended `/loop /build-next` — follows.
>
> Exactly one build is active at a time. Pausing a milestone means pointing
> this file elsewhere; it does **not** mean editing that milestone's PROGRESS.

---

## Active: **Redraft Leagues M6A — Commissioner Fallback & Autopilot** *(scope ruled by Chris 2026-09-09/11; breakdown approved and merged 2026-09-11, PR #289)*

**The breakdown is LAW — `docs/specs/tasks-M6A-commissioner-fallback.md` (PR #289).**
A pulled-forward slice of M6 / Phase E, sequenced **BEFORE M5**. The loop builds
`L.E1.*` in order. **`L.E1.1` is LANDED** (PR #286, migration 123 — the
`commissioner_actions` spine + `commish_edit_lineup`), **`L.E1.2` is LANDED**
(PR #291, docs only — spec v2.16.39's errata, Q60–Q64 filed, D335–D354 and
F334–F344 transcribed), **`L.E1.3` is LANDED** (PR **#294** —
pgTAP 064 + 067 gain explicit `league_members` coverage and each gains ONE
seating-premise cell, its own commit, no migration; re-review CLEAN with three
nits recorded, **R997 filed as F346**, now swept), **`L.E1.4` is LANDED**
(PR **#295** — migration **125** + pgTAP **073** `plan(103)` — `plan(80)` as first
built, taken to 103 by its own fix round — plus one stack vitest
suite: `lineup_autopilot_internal` as a PURE chooser plus a THIRD ARM (c) on
`lineup_lock_tick`, four hunks against `119:696`'s file text with arms (a)/(b)
byte-identical and the carry / `league_week_advance` / `118:1825` untouched;
**Q62 and Q63 shipped their recommendations on silence**; the
`autopilot_disabled` kill switch minted on `system_flags`; **discharges F334 and
F346**, mints **F347**, records **D356**), and **`L.E1.5` is LANDED**
(migration **126** + pgTAP **074** `plan(117)` after its fix round — `commish_edit_score` /
`commish_set_result` as ONE verb with two optional arms over one internal and one
replay namespace, **F325's `matchups` backstop discharged in the same migration as
its first writer** with D343's corrected predicate in the trigger's `WHEN` clause,
and `rebuild_team_week_results` replaced against `117:758-891`'s file text with
**exactly one body hunk** per D344. **THE SPLIT SEAM WAS NOT TAKEN — 131 / pgTAP
079 stay unspent and §6's dependency graph is unamended.** **Q61 shipped to its
recommendation with the default on ONE labelled line** — grep `Q61 SWAP LINE` in
126; it stays OPEN because Chris has not ruled, but a different answer is now a
one-line migration rather than a design — **and after the fix round the swap is
one line in CORRECTNESS as well as in plumbing (R1007): the freeze copy moved
into `commish_override_freeze_internal`, a PURE chooser taking that decision as
an ARGUMENT, and pgTAP 074 §L walks BOTH rulings' arms.** Mints **F351**,
records **D357** (amended in place through (13) by the fix round)),
**`L.E1.6` is LANDED** (PR **#297** — migration **127** + pgTAP **075**
`plan(158)` after its fix round, plus two stack vitest cells:
`commish_move_player` / `commish_force_add_drop` as ONE `p_verb`-discriminated
internal under two DEFINER doors, a shared lineup-sync helper, and
`commish_roster_actions` (D350). **115 is byte-untouched and PINNED** (075 §K).
TIMING lifted and NAMED in `bypassed[]`; LEGALITY kept and refused BY NAME —
**F324's second site recorded, not decided**. **F353** is the round's own find
(a force-DROP's enqueue reached NO league, because the worker maps a queued
player through `league_rosters`). **Half-discharges F344**, **re-routes F350**
(127 never calls the matcher — 075 **I3** proves zero `prosrc` hits), mints
**F352 / F353 / F354**, records **D358**), and **`L.E1.7` is LANDED**
(migration **128** + pgTAP **076** `plan(89)` — `commish_rename_team` **and**
`rename_own_team`, the manager's own, because F338's gap was TOTAL. **128
REPLACES NOTHING — zero D137 hunks**, every function is new. §C asserts the gap
BEFORE the verb closes it, with its premise and a positive control; the one
refusal is the spec's own (`spec:183`, a sealed franchise's name is frozen) and
its message names **F354** rather than a remedy nobody built. **Discharges
F338**, mints **F355 / F356**, records **D359**. The manager arm is a documented
**clean drop seam** — migration 128's banner and pgTAP 076's header say exactly
what to delete), and **`L.E1.8` is LANDED** (migration **129** + pgTAP **077**
`plan(121)` — `commish_change_setting`, a PER-KEY read-modify-write, **zero
D137 hunks** (118 byte-untouched and pinned); the per-key policy table ships as
data (`commish_setting_policy`); the FAAB re-seed narrowed to pre-draft and the
snapshot re-freeze kept, both re-decided in the banner; `rescore` built to
**Q64's recommendation** — a final week refused BY NAME behind one marked
`-- Q64 SEAM` block, `reopen_week` NOT built, seam numbers **132 / 080 released
unspent**. **Discharges F345**, mints **F359**, records **D360**), and
**`L.E1.9` is LANDED** (migration **130** + pgTAP **078** `plan(118)` —
`commish_edit_schedule`, the lock-exempt sibling (lifts `111:887` / `:904` /
`:913` / `:993`, each named in `bypassed[]` and proven by an ADJACENT paired
contrast; KEEPS `111:894` (§22.2) and `111:881` (a bracket row — **F360**)),
plus `schedule_edit_matchup`'s **ONE receipt hunk** against `111:785-1153`'s
file text (D137 — `diff -u` shows one `@@`, zero original lines touched;
`schedule_remix_confirm`'s pre-130 prosrc md5 is a stored-literal pin, F341's
wall). ~~The hunk makes 111's reason UNCONDITIONAL (the receipt's `reason` is
NOT NULL) — 059 / the stack vitest amended, the M4 panel hint is **F361**.~~
**FIX ROUND 2026-09-16 on TWO RULINGS BY CHRIS: (1) Q66 — a reason is
OPTIONAL on every commissioner action, the audit row is ALWAYS written, every
action is shown in League Home's activity section (spec v2.16.41); 130 §0
makes `commissioner_actions.reason` nullable once (123 is in production,
untouched) and both of 130's verbs are under the ruling — 111's OWN
post-kickoff gate is outside the one hunk and is the sweep's; (2) R1047 —
hand-picking playoff matchups is a WANTED feature, its own task. THE SWEEP
(F362, the six earlier verbs + 111/112) AND THE BRACKET VERB (F360) ARE
FILED AS tasks-M6A §6 AMENDMENT NOTES (proposed L.E1.15 / L.E1.16), UNBUILT,
PENDING CHRIS'S APPROVAL OF THE AMENDMENT.** D361(6) retracted into Q66.
**Discharges F339**, F225 in part (the `schedule_edit_matchup` half), mints
**F360 / F361 / F362**, records **D361**), so
**`L.E1.10` is LANDED** (API + hooks, part 1 — `/commish/score`,
`/commish/result`, `/commish/move-player`, `/commish/roster` over 126/127;
NO migration, NO pgTAP, NO typegen — **131 / 079 still unspent**; built to
**Q66** with `reason` OPTIONAL on all four schemas (`optionalReason`, no
`.min(1)`); **the transitional state is recorded, not hidden** — 126's and
127's in-body gates still refuse a blank reason until L.E1.15, and four
stack cells pin that 400 BY NAME so the sweep reds them; F65(b) guard per
verb on its own fields + the verb (shared ledgers, D350); records **D362**), so
**`L.E1.15` is LANDED** (PR **#302** — the reason-optional sweep, F362 — migration **131** +
pgTAP **079** + eight re-cut suites; Q66 brought to the CODE: ONE migration
`CREATE OR REPLACE`-ing all eight bodies against their newest definers' FILE
TEXT (D137; 123 in production, 125–130 unpushed — **the Architect's two open
calls decided: one new migration, and `set_lineup`'s commissioner arm IS IN**,
D363), every gate a normalisation, every post clause conditional, 111's
`reason_required` → false, `schedule_remix_confirm`'s receipt landed (F341
discharged; 078 L7/L8 re-derived), the L.E1.1 route + hook (R1052) and
L.E1.10's four transitional stack cells re-cut (R1053/R1054 taken), (h)/F343
clarified, out-of-scope remainders → **F363**; records **D363**), so
the next takeable task is **`L.E1.11`** — API + hooks part 2 (`/commish/team`,
`/commish/setting`, `/commish/schedule`, `GET /commish/log`; D351; the C70
caveat in the log service's docblock). After it: L.E1.12 → L.E1.13 → L.E1.14 →
**L.E1.16** (`commish_edit_bracket`, F360). Every route built from here on
takes `reason` as OPTIONAL — `optionalReason`, no `.min(1)`. ⚠ **Chris owes
`npx supabase db push` for migrations 125–131** (hosted tops out at 124; 131
re-defines 123's verb, which IS in production).
*(Advanced from `L.E1.2` in L.E1.2's own fix round, R982; advanced again by
L.E1.3's, L.E1.4's, L.E1.5's, L.E1.7's, L.E1.8's, L.E1.9's, L.E1.10's and L.E1.15's own sessions.*
> **⚠ THE STREAK BROKE AT `L.E1.6`, AND THIS IS THE FAILURE THIS FILE'S OWN
> HEADER WARNS ABOUT.** Every task from L.E1.2 through L.E1.5 advanced this
> pointer inside its own PR, so a fresh `/build-next` reading this file first —
> which the loop mandates — always found an unbuilt task. **PR #297 landed
> L.E1.6 without touching this line**, so for a day the pointer named a task
> that was already merged, and the next session would have rebuilt it (burning
> migration 128 on a duplicate of 127, or halting). **L.E1.7's PR repairs it and
> records why: the pointer is not a summary of what happened, it is the input to
> the next build, so advancing it is part of finishing a task — not part of
> describing one.** If a future PR lands an `L.E1.*` task without moving this
> line, that is a review finding in its own right.*
Migration numbers **125–132** and pgTAP **073–080** are reservations confirmed at
task time — **125 / 073, 126 / 074, 127 / 075, 128 / 076, 129 / 077 and 130 / 078 are now SPENT**;
**131 / 079 were RESERVED for L.E1.5's seam and are released unspent**, and
**132 / 080 were RESERVED for L.E1.8's seam (`reopen_week`) and are released
unspent too — F359's task takes the next free number at its own time (D161)**.
Next free: **131 / 079** (the M6A band is exhausted; the next schema task
measures with `ls … | tail -1`, D161).

> **⚠️ MIGRATIONS 125, 126, 127, 128, 129 AND 130 ARE NOT ON PRODUCTION YET.**
> `npx supabase db push` is **Chris's to run**; `db-drift.yml` is expected red
> until he does, which is the drift check working. No `HELD-FROM-PRODUCTION`
> entry was added for any of them and none should be — the hold was cleared
> 2026-09-09 (PR #282); the file stays in the tree as the hold's record and
> no entry is added (R1042). Because none of the six is
> deployed, each was authored against the REPO's chain and a fix round may still
> edit one in place; the moment Chris pushes, that stops being true.
>
> **126 CHANGES WHAT THE DATABASE ALLOWS, so read this before the push.** It adds
> `trg_matchups_override_guard` (`BEFORE UPDATE`, `ENABLE ALWAYS`) on `matchups`:
> from the moment it lands, **no statement may move `is_overridden` in either
> direction without `app.commish_action_id`** — not `authenticated`, not
> `service_role`, not the table owner. That is §12.12's own ask and M6A exit
> criterion 1, and it is why two stack test suites and one pgTAP fixture had to
> change in the same PR. Nothing in production writes that column today (measured:
> zero writers in 109–125), so the push is safe; but **any future hand-run SQL that
> sets the flag will be refused**, and the route through it is an audited verb.
>
> **The GUC is an INTENT marker, not a credential (R1010).** The trigger checks
> that `app.commish_action_id` is non-empty; it does not verify that an audit row
> exists, and a forged value passes. That is §12.12's own printed check and it is
> not a hole — `matchups` carries no UPDATE policy for any role (`109:193-194`), so
> the only callers who reach the trigger at all are the DEFINER verbs, **the service
> role** and the table owner. **Do not read the guard as proof that every `TRUE` flag has a receipt
> behind it, and do not GRANT EXECUTE on `rebuild_team_week_results` believing the
> GUC would hold that door — the REVOKE does (`117:892-893`).**

**Scope is spec §15.4 IN FULL plus `commish_rename_team`**, per the standing rule
in PROGRESS §3 (*"a commissioner may do anything a manager can, on any team"* —
**a verb that refuses a commissioner is a DEFECT to fix, never a question to
ask**). Trade and FAAB overrides defer to M5 for want of a SUBJECT, not
authority.

**Read before taking any task:**
1. **PROGRESS §3's STANDING RULE, all of (a)–(i)** — especially **(g)** the
   game-day lock does not bind a commissioner, **(h)** override is a MODE
   with **no reason prompt** (superseded its own "captured once" clause the day
   it was written), and **(i)** (ruled 2026-09-11, explaining Q59) — the test to
   apply to every future verb: **commissioner powers FIX what is broken; they do
   not CHANGE what the game is.** A TIMING or REACHABILITY refusal is a defect to
   fix; a VALIDITY refusal binds him too and needs no question. L.E1.6's
   roster-shape legality question turns on it. (Grep the clause headings —
   PROGRESS line numbers move.)
2. **Q59 is RULED (2026-09-11): timing is lifted, POSITIONAL legality is not.**
   *"even a commish cannot break the positional rules."* No exemption from E16.
3. **The breakdown's citation discipline** (head of its §2): for `src/**` the
   IDENTIFIER is authoritative and the line number advisory — grep the symbol.
   Migration, pgTAP and `spec:` citations stay exact, and a wrong one THERE is a
   real error to report.
4. **Q60–Q64** are open and Chris's (filed in PROGRESS §3 by L.E1.2); none
   blocks starting — each names exactly what it blocks.

> **⚠ THE HOLD-FILE INSTRUCTION IS RETIRED — do NOT follow M4's §4 rule 11.**
> `tasks-M4-inseason.md` §4 rule 11 says every new migration extends
> `supabase/HELD-FROM-PRODUCTION.txt`'s closed range in the same PR. **That was
> true while production ran behind; it is false now.** Chris cleared the hold on
> 2026-09-09 for go-live (commit `26eca84`) and production has since taken 123
> and 124 — the file has **zero live entries**. Adding a hold line for a new
> migration would keep the fix out of the very league it was written for; that
> nearly happened with 123. **The default act for a new migration is
> `npx supabase db push`, which is CHRIS'S to run, after merge.** A new migration
> reds `db-drift.yml` between merge and push — that is rule 1 working, not a
> defect.

---

## Paused: **Redraft Leagues M4 — In-season core** *(not abandoned — two items outstanding)*

**M4 is 🟡, and the loop is NOT taking `L.D*` tasks while M6A is active.** What
remains, so nobody has to re-derive it:
- **`L.D6.4` — the real-2026 replay gate (exit criterion 2).** Was calendar-blocked
  on the first recorded 2026 week; **that block is GONE** — week 1 is in the books
  and Chris's live league carries real `player_stats`, `matchups` and scores.
  Takeable whenever this file points back.
- **F308 / blocker B11 — exit criterion 4 (continuity).** `test:gate:m4` last
  exited 1 at `e2e/auction-live.spec.ts:213`, the nomination broadcast, and F308
  is deliberately NOT in the flake policy. Diagnosed (the Realtime tenant's
  100 events/s ceiling is the mechanism in the reproduction, F311) but the gate
  instance's own trigger is unproven.

Exit criteria 1 and 3 are measured green and shown three times over.

---

## Previous: **Redraft Leagues M4 — In-season core** *(approved by Chris 2026-09-01, PR #244 merged; Q29 ruled at approval)* — **SUPERSEDED as the active build 2026-09-11; see "Paused: M4" above for what remains**

**The breakdown is LAW — Chris approved and merged PR #244 (2026-09-01).**
`docs/specs/tasks-M4-inseason.md` sequences the milestone (24 tasks, 6 lanes;
spec at **v2.16.11**; Q29 ruled — a mid-season league starts at the next NFL
week, shrink-or-refuse ≤ 18). **The loop builds `L.D*` tasks in lane order,
starting L.D1.1** (migration 109 — schema lane opener; numbers 109–118 /
pgTAP 057–066 are reservations confirmed at task time; every migration extends
`HELD-FROM-PRODUCTION.txt` same-PR). PROGRESS §2 carries the M4 checklist;
§4 carries D287–D301; §3's Q28 is re-framed LIVE and needs Chris **before the
cohort's first scored week**. The L.D6.4 real-replay gate is calendar-blocked
on the first recorded 2026 week (~Sept 10+) — the loop runs everything ahead
of it and holds there if it arrives first.

*(The F210 merge-time duties — this lane clause + the D288–D301 transcription
into PROGRESS §4 — were executed by the same PR that carries this edit.)*

---

## Previous: **NONE — awaiting Chris's direction** *(SE completed 2026-09-01; every candidate next build runs through a Chris gate)*

> **[corrected 2026-09-01]** ~~the remaining lane is SE~~ — **the SE track is COMPLETE.**
> The gate statement on the record: *"the editor's own quality gate (spec §7.3.3.1,
> v2.16.11) passed 2026-09-01"* (PROGRESS §1; D286; PR #241). SE.1–SE.10 plus the
> four SC cuts (Scout Standard + Scout PPR, the rename, the roster default, the
> preselection) are all built, adversarially reviewed, and merged. **This header
> outlived the lane exactly as the 2026-08-25 correction above warned; corrected
> the day the gate passed rather than eleven days later.**
>
> **The loop takes NOTHING until this file points somewhere new, and every
> candidate is gated on Chris:**
> 1. **F59 — the boundary editor** (the SE successor named in the ledger): gated
>    on **Q26** (PROGRESS §3 — the tier re-cut allowlist question; silence ships
>    option (c), which reverses two of his v2.11 rulings), then an Architect
>    breakdown he approves.
> 2. **M4** (canonical milestone order M2 ✓ → M3 ✓ → M4): needs its Architect
>    breakdown, which is his approval gate (the #150/#161 precedent).
> 3. **DR2 (PR #180)**: parked for his Figma session; owes a rebase (F134's
>    strike-keeping rule applies).
> 4. **MS.1/MS.4/MS.6**: parked with the deferred league-attached mock feature,
>    per the standing ruling (mocks lead, leagues follow demand).

---

## Previous: Redraft Leagues M3 — Auction engine (**COMPLETE**) → SE (**COMPLETE 2026-09-01**)

> **[corrected 2026-08-25, PROGRESS D266]** ~~M3 — Auction engine (in build)~~ — **M3 is COMPLETE.** HEAD commit subject: *"L.C6.1 — THE M3 GATE: `test:gate:m3` green twice; F84/F56/F60 discharged; M3 complete (#215)"*; PROGRESS §1 → **🟢 Gate passed 2026-08-25**. This file had not been touched since `8fc5852` (2026-08-24), so the header outlived the milestone. **The one lane with unchecked tasks is SE** (`SE.1`–`SE.10`, prefix `SE.`, table below) — plus MS.1/MS.4/MS.6, which stay **parked** with the deferred league-attached feature per step 1c. **Before taking ANY `SE.*` task, read `docs/specs/tasks-SE-scoring-editor.md` §0** — that breakdown sat unrevised through five lanes and was re-measured 2026-08-25; two of its corrections change what gets built.

*(Set 2026-08-14 — **ruled by Chris in-session** ("M3 — Auction engine", the
recommended option of the M2-gate-passed question), recorded here per this
file's rule. **M2 passed its gate 2026-08-14** (L.B7.1, `npm run test:gate:m2`
green end-to-end — see the PROGRESS §1 row and the gate session-log entry).
In the same ruling Chris settled **R278**: D39-class browser-pass evidence is
**prose + DB corroboration** (the merged-PR precedent) — recorded at the
standing sites in PROGRESS.)*

**The breakdown is LAW — Chris approved and merged PR #150 (2026-08-16).**
`docs/specs/tasks-M3-auction.md` sequences the milestone (15 tasks, 5 lanes;
spec at **v2.10.1** with every C-row resolved or ruled); PROGRESS §2 carries
the M3 checklist and §4/§6 carry D126–D143 + F57. **The loop builds `L.C*`
tasks in lane order, starting L.C1.1** (migration 083 — schema lane opener).
The C43 projections-splits sync runs as an authorized standalone data-task PR
in parallel with the loop, never an `L.C` dependency.

| | |
| --- | --- |
| **PROGRESS (the loop's only memory)** | `docs/specs/PROGRESS-leagues.md` |
| **Delivery plan** | `docs/specs/delivery-plan-redraft-leagues.md` (v1.4 — §3 M3 row: Phase C gate; solvency property test incl. bot-driven mocks; bid-storm E2E) |
| **Spec (LAW)** | `docs/specs/spec-redraft-leagues.md` — **v2.13** (§8.6 auction incl. §8.6.7–8 endgame/solvency and **§8.6.9 the uncontestable instant award**; §8.8's pacing bar; L.C1) |
| **Task breakdown** | `docs/specs/tasks-M3-auction.md` (Architect; **approved & merged 2026-08-16**, PR #150) |
| **Task id prefix** | ~~`L.C`~~ **`SE.`** *(corrected 2026-08-25 — the `L.C` lane is complete; SE is the only lane with unchecked tasks. `SE.` was already declared below and step 3 already routes to it.)* |

**Standing constraints:** CLAUDE.md + the M2-era standing rules carry forward
(spec is LAW; server-authoritative always; branch + PR per task; proof chains
shown, not claimed; the realtime doctrine and draft-lock discipline as landed).
Inherited M3 notes already recorded: tasks-M2 §11's M3-inherits line
(presence-only `realtime.messages` INSERT posture — M3's auction realtime
decides whether to open Client Broadcast for bid-pulse UX, deliberately);
auction refusal seams in 066/071 name M3; the 2026 test-cohort note (CLAUDE.md)
makes **auction + custom scoring the headline feedback goals** — ~~the custom
scoring editor un-punt still needs its spec changelog entry (Architect) before
any build touches it~~ *(satisfied 2026-08-18: spec v2.11/§7.3.3.1 merged as
PR #152, and the SE lane block below carries the build — ~~no editor build until
Chris also merges the SE breakdown PR~~ **[corrected 2026-08-25: he merged it 2026-08-19 (#161); the editor build is authorized]**)*.

**Lane precedence — TWO lanes under one active build (added 2026-08-17; takes effect when
the draft-room redesign PR merges, and is part of what Chris approves with it).**
Chris used the shipped M2 draft room live and ordered a **layout redesign**, ruling it runs
**AHEAD of the auction UI** so the auction room is built into the new shell rather than the
old one — **with the M3 engine lane continuing behind it**. That is not a build swap, so this
file's pointer does not move: **M3 stays the active build and gains a second lane.**

| | |
| --- | --- |
| **Redesign breakdown** | `docs/specs/tasks-DR-draft-room-redesign.md` (Architect, 2026-08-17) |
| **Redesign task id prefix** | `DR.` |
| **Spec fold** | `spec-redraft-leagues.md` **v2.12** (§16.1/§16.2/§16.3/§16.4/§16.5, §8.7, §9.3) |
| **PROGRESS** | the same file — `docs/specs/PROGRESS-leagues.md` §2 carries both checklists |

**Third concurrent lane — SE, the custom scoring editor (added 2026-08-18; ~~takes effect
when the SE breakdown PR merges~~ — **LIVE: PR #161 merged 2026-08-19**, and as of 2026-08-25 it is the
**only lane with unblocked tasks**).**
Spec **v2.11** (§7.3.3.1, approved & merged 2026-08-18 as PR #152) made the test-cohort
custom scoring editor LAW and required a follow-up Architect breakdown before build; that
breakdown exists and this row activates it. SE is the **C37 separate parallel track — never
an M3 lane**: it never blocks and is never blocked by `DR.*` or `L.C*` (its schema work is
additive; ~~SE migration numbers stay **above tasks-M3 §7's 088/089 reservations**~~ **[corrected 2026-08-25 — that band is a dead
letter 13 numbers behind the head; SE takes the NEXT FREE number measured at task time, heads 102 / 050]**). The only
shared surface is `PROGRESS-leagues.md` (append-collisions resolved at merge, the
established two-lane pattern).

| | |
| --- | --- |
| **SE breakdown** | `docs/specs/tasks-SE-scoring-editor.md` (Architect, 2026-08-18; **AMENDED 2026-08-25 — read its §0 before any `SE.*` task**: five lanes landed under it unrevised, and two of the corrections change what gets built — §0(A)/**F133** adds SE.2 a sixth deliverable, §0(B)/§0(C) retire SE.6's planned hook. PROGRESS **D266**) |
| **SE task id prefix** | `SE.` |
| **Spec fold** | `spec-redraft-leagues.md` **v2.11** (§7.3.3.1, §7.3.8, §12.25, §16.2, §23.5, App B.4) |
| **PROGRESS** | the same file — `docs/specs/PROGRESS-leagues.md` §2 carries all three checklists |

**Fourth lane — AP, auction pacing (added 2026-08-20; takes effect when the AP breakdown PR
merges, and is part of what Chris approves with it).**
Chris drove the **finished** M3 auction room on 2026-08-20 and ruled six changes to it — bot
pacing with a number on it (a mock under 45 minutes, a live draft under 90), instant awards for
uncontestable nominations, `$0` nominations as a per-league toggle with `auction_min_bid`
retired, the auction's manual nomination order, the six projection split columns that have
data, and idempotent budget adjustments. Spec **v2.13** is the fold. **This is not a build swap
and the pointer does not move: M3 stays the active build and gains a fourth lane** — the DR
precedent, applied again.

**AP runs AHEAD of M3's remaining three tasks — Chris ruled that order in-session.** `L.C4.1`
(sim + the solvency property test), `L.C5.1` (auction E2E incl. the bid storm) and `L.C6.1` (the
gate) all encode current behaviour as assertions, and **the bid-storm spec in particular assumes
today's bot cadence**; writing them against behaviour about to change buys a suite that must be
rewritten and, worse, a green gate certifying the wrong thing. Reasoning recorded at PROGRESS
**D197(4)**.

| | |
| --- | --- |
| **AP breakdown** | `docs/specs/tasks-AP-auction-pacing.md` (Architect, 2026-08-20) |
| **AP task id prefix** | `AP.` |
| **Spec fold** | `spec-redraft-leagues.md` **v2.13** (§7.3.8 · §8.3 · §8.6.1–8.6.3 · §8.6.8 · NEW §8.6.9 · §8.8 · §16.2 · §16.4 · §16.5.4 · E67–E70 · App A.4) |
| **MS breakdown** | `docs/specs/tasks-MS-mock-sandbox.md` (Architect, 2026-08-20; PR #184) |
| **MS task id prefix** | `MS.` |
| **MS spec fold** | `spec-redraft-leagues.md` **v2.15** (§8.7 · §8.8 · §19.2 · E75–E77) |
| **MP breakdown** | `docs/specs/tasks-MP-mock-practice.md` (Architect, 2026-08-21; PR #187 — **standalone mocks, base scoring templates, no league inheritance**; the league-attached practice launch is DEFERRED until league demand, per Chris) |
| **MP task id prefix** | `MP.` |
| **MP spec fold** | `spec-redraft-leagues.md` **v2.16** (§8.8 · E78–E80; Q23 lapsed, F85 de-targeted) |
| **MP release gate** | `NEXT_PUBLIC_FLAG_MOCK_DRAFTS` — never the `leagues` flag; everything must work with `leagues` OFF (E79) |
| **PROGRESS** | the same file — `docs/specs/PROGRESS-leagues.md` §2 carries all six checklists |

**The loop's order, precisely:**

1. Take the next unblocked **`DR.*`** task (dependency order in tasks-DR §5).
   *(**The DR lane is COMPLETE — DR.1–DR.8 all landed 2026-08-18**, so this step
   never fires again; the DR prerequisites in step 3 are all satisfied.)*
1a. **THE MOCK TRACK RUNS AHEAD OF THE LEAGUE LANES — take the next unblocked `MP.*` task
   first** (dependency order in `tasks-MP-mock-practice.md` §5; **D225–D233**, spec **v2.16**).
   Chris's ruling, 2026-08-21: standalone mocks are what users are invited to during the
   2026 launch, while league work waits for demand (*"until then we can invite users to come
   do mocks for practice"*) — and he opened the build in-session (*"perfect, lets build"*).
   `MP.1` (the storage investigation) is first and writes no code; its finding gates the
   lane's shape. **The lane's one cross-lane constraint: MP.4's launch dialog/RPC and MS.8's
   slot picker compose — one dialog, one RPC; whichever lands second composes, never forks.**
1b. **When no `MP.*` task is unblocked, take the next unblocked `AP.*` task** (dependency
   order in tasks-AP §7) before any remaining `L.C*` task. **`AP.4` is CLOSED with no code**
   (Q17's numbers already ship; Q23 lapsed with the standalone rewrite; the measurement is
   banked in the AP.4 closure row — do NOT re-run a ~52-minute mock to re-derive it). The
   remaining AP tasks are **AP.5 / AP.6 / AP.7**.
1c. **When no `MP.*` or `AP.*` task is unblocked, take the next unblocked `MS.*` task**
   (dependency order in `tasks-MS-mock-sandbox.md` §5, as re-read by tasks-MP §7) **before any
   remaining `L.C*` task.** The lane makes the mock launcher the commissioner of their own mock
   (**D216–D223**, spec **v2.15**). **MS.1, MS.4 and MS.6 serve the DEFERRED league-attached
   feature and are parked with it** (tasks-MP §7) — skip them until that feature returns.
   **One hard ordering constraint, and it is the only correctness-affecting one in the lane:
   `MS.7` must land BEFORE `MS.5` renders the order control.** `draft_set_order`'s route
   resolves `.eq('is_mock', false)`, so today the control is aimed at the REAL draft; it is
   live but latent, and rendering it in a mock room first makes the bug one click away
   (R468/D222).
2. When no `MP.*`, `AP.*` or `MS.*` task is unblocked, take the next **`L.C*`** engine task (tasks-M3 §6).
   **The three that remain — `L.C4.1`, `L.C5.1`, `L.C6.1` — must not be started while any
   `AP.*` task is unblocked** (the ordering above). `L.C6.1` additionally owes **F84**: the gate
   composes the AP suites by name.
3. ~~When **all three** are blocked~~ **[corrected 2026-08-25 — there is no "three": FIVE steps precede this one (1 DR, 1a MP, 1b AP, 1c MS, 2 L.C). Read it as: **when no `MP.*`, `AP.*`, `MS.*` or `L.C*` task is unblocked** — which, as of 2026-08-25, is the case: DR, AP, MP and L.C are all complete, and the only unchecked MS tasks (MS.1/MS.4/MS.6) are parked by step 1c. **SE is the live lane.**]** — or when Chris directs by name ("build SE.x") — take the
   next unblocked **`SE.*`** task (dependency order in tasks-SE §5). *(Its breakdown PR #161
   **merged 2026-08-19**, so this clause is live.)* The pure-TS opener
   chain (SE.1 → SE.2 → SE.3) touches no migration, so it is always safe to take while
   the schema lanes are contended. ~~**AP and SE contend for migration numbers 091+ and pgTAP 039+**~~ **[corrected 2026-08-25 — false in both halves: AP has ZERO unchecked tasks, and 091 / pgTAP 039 were consumed by `091_mock_cpu_reactive_bidding.sql` / `039_mock_cpu_reactive_bidding.sql` (AP.3). Heads on 2026-08-25 are **migration 102 / pgTAP 050**.]** — **the rule below is unchanged and is the half of this bullet that MATTERED:** both lanes confirm the real next-free with
   `ls supabase/migrations/` at task time (D161/D166); **neither trusts a number written in a planning document** — which is exactly what kept SE from
   colliding when every number its breakdown "expected" was taken out from under it.
4. **Do not start `L.C3.1` until DR.1, DR.4 and DR.5 have landed** — it builds into the
   new shell (tasks-M3 §6's amended banners carry the dependency). `L.C3.2` additionally
   waits on DR.3; `L.C3.3` on DR.5.
5. The M3 **engine** lane — `L.C1.3` → `L.C1.7`, `L.C2.1`, `L.C2.2` — has **no `DR.`
   dependency** and is never blocked by the redesign. Exception: **`L.C1.8`** (added
   2026-08-18, F57 ruled — snake pause-first alignment) is engine work that runs
   **AFTER DR.2 lands**, per its own banner's sequencing note (it resets the local DB
   and DR.2's browser fixtures live on the stack).

**Do not build `LV.*` or Scout tasks while M3 is active.**

---

## Completed: Redraft Leagues M2 — Snake draft engine

*(🟢 **Gate passed 2026-08-14** — L.B7.1, `npm run test:gate:m2` green
end-to-end in one run; every §2 checkbox checked; F49/F52/F53/F54 discharged.
PROGRESS-leagues.md §1 + the 2026-08-14 session-log entry are the record.
M3 continues in the same PROGRESS file under the `L.C` prefix.)*

---

## Paused: Lists v2 — Round 2 complete, no Round 3 queued

*(Parked 2026-08-13 with **both rounds shipped**: Round 1 (LV.1 – LV.11)
completed 2026-08-11; Round 2 (LV.12 – LV.17) landed 2026-08-12. The seven
LV.7 follow-ups (F-LV7.1 – F-LV7.7) in `PROGRESS-lists-v2.md` §5 remain
**filed items, not queued tasks** — queueing them as a Round 3 is a Chris
decision this file would record.)*

| | |
| --- | --- |
| **PROGRESS** | `docs/specs/PROGRESS-lists-v2.md` |
| **Delivery plan** | `docs/specs/delivery-plan-lists-v2.md` |
| **Design LAW** | `docs/design/lists/README.md` (+ prototype in `docs/design/lists/design/`) |
| **Task text** | Round 2 was the plan's §6 (Round 1 was §4 — corrected 2026-08-11, LV.12 review R210) |
| **Task id prefix** | `LV.` |

**Standing constraints for any reactivation** (full text in the plan §1):

- UI/UX only, with **three** exceptions, each individually ruled by Chris:
  (a) the `drafted` table (LV.1.2, 2026-08-09); (b) widening
  `list_players.tier`'s CHECK constraint (LV.1.5, 2026-08-09 — one
  `ALTER TABLE`, no new table or column); and (c) the `list_links` table plus
  its routes (LV.8, 2026-08-11 — *"we need a way to link back to resources
  used and a way for creators to attached videos to their lists"*).
  **That is the whole budget** — no fourth schema change, no other new API
  route. A task that thinks it needs one has left scope: stop and raise it.
  *(This row said "two" until 2026-08-11. Each exception was raised by a
  Builder rather than improvised around, and ruled on its own merits — the
  count moving is the process working, not the budget eroding.)*
- **Boards are off limits.** No task opens `src/components/big-board/**`,
  `src/stores/board-labels-store.ts`, or `src/components/lists/draft-mode/**`.
- ~~Everything lands behind `featureFlags.listsV2`.~~ **The flag was removed at
  LV.7 (2026-08-11)** — `/app/lists` serves the rebuilt page unconditionally and
  the legacy components are deleted. Nothing left to gate. **Round 2 shipped
  unflagged too**, which is why LV.15's app-shell host renders nothing when
  no window is open.
- **Round 2 composed Round 1, never re-solved it** (plan §6, D11).
  Grouping is `list-buckets.ts`, rows are `list-row-parts.tsx`, covers are
  `cover-tile.tsx`, marks are `use-draft-mode.ts`, reorder is
  `use-list-drag.tsx`, the mode control is `Segment`. A new surface that
  quietly reimplements one of these is the LV.7 failure repeating.
- Keep the app's ×0.8 token scale; implement colors from tokens, not the
  handoff's literal hex.
- **Browser verification runs against the LOCAL Supabase stack, never hosted.**
  `.env.local` points at the **hosted production** project, so `npm run dev`
  straight out of the box drives a real users' database — LV.12 did exactly
  that and left seven soft-deleted `LV12 tmp` rows in production (**R207**).
  Use the gitignored `.claude/launch.json` config **`dev-local`** (port 3123),
  which overrides `NEXT_PUBLIC_SUPABASE_URL` to `http://127.0.0.1:54321` with
  the keys from `npx supabase status`; confirm it took by checking a network
  request goes to `127.0.0.1:54321`. **State the verification environment in
  the PR body and in PROGRESS §4** — the LV.12 PR disclosed neither, which is
  what made the finding a should-fix rather than a note.
- **The local stack carries a deliberate saved-list fixture, and
  `supabase db reset` destroys it.** LV.12's fix round (**R208**) left a public
  list owned by the *second* local account (`dev-pro@fieldscout.local`),
  favourited from `dev@`, in the **local** DB on purpose — so the `saved` half
  of the collection is non-empty by default, which is the one condition LV.12's
  original verification never had. After a reset, **re-create it before
  verifying anything about saved lists**: a public list on the `dev-pro`
  account, favourited as `dev@` through the shipped
  `POST /api/lists/[id]/favorite`. Skip that and the verification reproduces
  R208 exactly — every observation taken over an empty array, looking green.
  Full detail in `PROGRESS-lists-v2.md` §4 item 6. *(Added 2026-08-11, LV.12
  review **R215** — the same "put it where the next Builder reads it" argument
  R207 made, applied to R207's own round's artefact.)*
- **There is a second deliberate local fixture, and the same reset destroys
  it.** LV.13 left **`LV13 local fixture — round board`** in the **local** DB on
  purpose: owned by `dev@fieldscout.local`, 8 players carrying tiers `r1`–`r4`.
  It is the **only** list on the local stack that can render a *round*-grouped
  column, which is what makes "each column groups independently" observable —
  without it every column groups by tier and a build that ignored per-column
  grouping entirely would produce identical-looking evidence. To re-create it
  after a reset: make a list on `dev@` in the UI, add ~8 players, then set the
  rounds directly —
  `docker exec supabase_db_fieldscout psql -U postgres -d postgres -c "update list_players set tier = 'r' || ((position - 1) / 2 + 1) where list_id = '<id>'"`
  — and switch the column's `dots` menu to **Rounds**. (`r1`–`r30` are legal
  because LV.1.5 widened `list_players.tier`'s CHECK constraint to
  `^([SABCDF]|r([1-9]|[12][0-9]|30)|c[1-4])$`; that is exception (b) above, not
  a new one.) The `update` was run to verify it — `UPDATE 8`, reproducing the
  fixture's exact `r1,r1,r2,r2,r3,r3,r4,r4` — so it is a tested instruction, not
  a remembered one. *(Added 2026-08-12, LV.13 review
  **R219** — R215's argument applied to R215's own round's successor: the
  fixture was documented only in `PROGRESS-lists-v2.md` §4, which is the
  placement R215 corrected one task earlier.)*
- **A third local-fixture note, and this one is a correction rather than a
  creation.** `Secret sleepers` (`aaaa1111-…ab99`) carried
  `lists.player_count = 3` against **2** `list_players` rows, so every surface
  that reads the denormalised count — the picker card, the rail row, the gallery
  card — said *"3 players"* for a 2-player list. Corrected 2026-08-12 (LV.17
  review **R247**) with
  `update lists set player_count = (select count(*) from list_players lp where lp.list_id = lists.id) where id = '…ab99'`,
  and the whole table then checked for the same drift (**0 rows**). It is
  recorded here because a `supabase db reset` re-seeds the fixture from whatever
  produced the drift in the first place: **after a reset, re-check
  `player_count` against `list_players` across the table before trusting any
  count on screen.** Nothing in the app writes that column from the client, so a
  wrong count is always seed drift, never a bug you are looking at.

---

## Not yet active: Scout

*(Specced and prototyped; no code written into the app. `PROGRESS-scout.md`
committed 2026-08-13 — it was sitting untracked in the working tree; Chris
ruled it committed. Activation is a Chris decision recorded here.)*

| | |
| --- | --- |
| **PROGRESS** | `docs/specs/PROGRESS-scout.md` |
| **Delivery plan** | `docs/specs/delivery-plan-scout.md` (v2.7) |
| **Spec (LAW)** | `docs/specs/spec-scout.md` (v2.7) |
| **Content** | `docs/specs/scout-content/` (registry, trait model, guides, lesson copy — done) |

---

## Switching builds

1. Finish the current cycle (PROGRESS current, `main` clean, no open PRs).
2. Move the milestone's row from **Active** to **Paused**, noting the task id
   it paused at and the date.
3. Promote the incoming one to **Active**.
4. Do not edit either PROGRESS file as part of the switch — they are each
   milestone's own memory and stay truthful about their own state.
