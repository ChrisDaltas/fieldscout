---
name: build-next
description: Orchestrate one full Builder→Reviewer→merge cycle on the next unblocked task of the active FieldScout build (reads docs/specs/ACTIVE-BUILD.md to learn which build is active, then that build's PROGRESS file to pick the task). Use when Chris says "build the next task", "keep building", or via "/loop /build-next" for continuous autonomous building. Only interrupts Chris for product/UX/spec rulings.
---

# build-next — the autonomous build cycle

One invocation = one complete task cycle: pick → build (subagent) → review
(fresh subagent) → fix → prove → merge → record. Under `/loop /build-next`
this repeats until no unblocked work remains or a ruling is needed.

**Which build?** `docs/specs/ACTIVE-BUILD.md` names exactly one active build
and points at its PROGRESS file, delivery plan, LAW, task text and task-id
prefix. **Read it first, every cycle.** More than one build exists in this
repo and the others are deliberately paused mid-milestone with truthful
PROGRESS files — picking a task from a paused build's PROGRESS is a real
failure mode, not a hypothetical one. If a task id does not start with the
active build's prefix, you have read the wrong file: stop.

**Authority chain:** LAW (spec or design handoff, per ACTIVE-BUILD) >
delivery plan > tasks breakdown (where one exists) > PROGRESS. This skill is
dispatch plumbing only — it never overrides them.

**Statelessness rule (context discipline):** treat the active build's
PROGRESS file as the ONLY memory. Re-read it at the start of every cycle;
never rely on chat history or a previous cycle's in-context state.
Every cycle ends at a task boundary with PROGRESS current and `main` clean,
so the session can be compacted or killed at any time and a fresh session
resumes losslessly. Builders and Reviewers run as subagents (fresh
contexts) — keep their transcripts out of this session; consume only their
structured reports.

## Cycle

0. **Orient.** Read `docs/specs/ACTIVE-BUILD.md`. Note the active build's
   PROGRESS path, plan, LAW, where task text lives, its task-id prefix, and
   its standing constraints (some builds forbid whole directories). Every
   later step means *that* build's files.
1. **Preflight.** `git checkout main && git pull --ff-only`; working tree
   must be clean (if not: stop and report — never stash someone's work).
   Local Supabase stack up (`npx supabase status`; start it if down —
   Docker must be running). Check for open PRs from previous cycles
   (`gh pr list`) — a leftover REVIEWED-CLEAN PR gets merged first (step
   6); a leftover unreviewed PR resumes at step 4.
2. **Pick.** From the active PROGRESS §2's checklist + lane graph and §5
   blockers: the next unchecked task whose dependencies are all checked and
   whose lane is not blocked. Schema-lane tasks are serialized; engine/API/UI
   lanes may be picked when schema is blocked. **Sanity-check the id against
   the prefix from step 0 before spawning anything.** If NOTHING is unblocked:
   report why (open question ids) and stop the loop (in `/loop` mode:
   ScheduleWakeup stop) — do not idle-poll.
3. **Build.** Spawn the `fs-builder` agent with: the task id, the task's
   verbatim task text from wherever ACTIVE-BUILD says it lives (a
   `tasks-M*.md` §6 for leagues; the delivery plan §4 plus the cited LAW
   section for builds with no separate breakdown), the active build's
   standing constraints from ACTIVE-BUILD, and the instruction to follow its
   own agent charter. Wait for its report.
4. **Review.** If Builder reported `LANDED`: spawn a FRESH `fs-reviewer`
   agent on the branch (never reuse any prior context — independence is
   the point). If Builder reported `HALTED`: skip to step 7.
5. **Fix cycle.** `VERDICT: FIX-THEN-MERGE` → spawn a fresh `fs-builder`
   with the findings verbatim, charter: resolve every BLOCKER/SHOULD-FIX
   on the same branch (or a `fix/` branch per house precedent), re-run the
   full proof chain, update PROGRESS's review-findings section in house
   format. Then ONE re-review pass of the fix diff. If blockers survive
   two fix rounds: stop the loop and report — that is a process failure,
   not a retry-forever situation.
6. **Merge.** Ruled by Chris 2026-07-22 (merge-authority option (b)): the
   loop merges its own PR when — and only when — ALL of: reviewer verdict
   CLEAN (nits allowed, recorded), Builder proof chain shown green in the
   PR/report, PROGRESS updated in the PR. Merge with a merge commit
   (house history style): `gh pr merge <n> --merge --delete-branch`.
   Then `git checkout main && git pull --ff-only`. A PR that doesn't meet
   all three conditions is NEVER merged by the loop — leave it open and
   escalate.
7. **Escalate (the only reason to involve Chris).** Escalation = Builder
   `HALTED` (spec question filed) or reviewer `VERDICT: ESCALATE`. Verify
   the question + blocker are recorded in PROGRESS §3/§5 (that IS the
   escalation artifact — options + recommendation included). Then:
   - Interactive session → AskUserQuestion with the recommendation first.
   - Unattended (`/loop`) → send a PushNotification naming the question id,
     then CONTINUE the cycle loop on other unblocked lanes; stop the loop
     only when everything is blocked. Chris answers with a ruling line
     (chat or PROGRESS edit); the next cycle picks it up from PROGRESS.
   Never guess a product/UX/spec answer to keep the loop moving.
8. **Report.** End the turn with a compact cycle summary: task, PR,
   verdict, merge state, proof counts, what the next cycle will pick. In
   `/loop` mode, schedule the next iteration immediately after a merge
   (there is more work) and stop the loop when step 2 finds nothing.

## Hard limits

- Never weaken a stop condition to make progress; never edit the spec
  except as a Builder folding back a recorded erratum.
- Never run Builder and Reviewer as the same agent or context.
- Proof commands that need the local stack run on this machine only —
  do not offload cycles to remote/cloud agents.
- Cost sanity: one cycle ≈ one Builder + one Reviewer (+ possible fix
  round). If a task text says "≤ half a day", a subagent burning far past
  that scope should be stopped and the cycle reported as FAILED for Chris
  to inspect.
