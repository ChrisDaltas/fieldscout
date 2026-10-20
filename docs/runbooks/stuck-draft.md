# Runbook: a live draft is stuck

> Spec §24.3 "stuck draft (deadline in past, no tick)". Written for M7
> L.F2.9. It has **not been rehearsed**. That happens in L.F2.10 (D574).

## When to use this

A live draft's pick clock has run out and nothing happens. No auto-pick,
no next team on the clock. Or several drafts stall at once.

## How drafts move

The `draft-tick` scheduled job runs **every 5 seconds**. When a pick's clock
runs out, it makes the auto-pick and starts the next clock. If `draft-tick`
stops running, every timed draft stops at its next deadline.

## What you cannot do (not built in 2026)

- The Admin console has **no draft buttons**: no pause-all-drafts, no
  "unstick this draft". Drafts are run by each league's commissioner.
- What to do instead: the **commissioner's draft controls** in the draft
  room. The steps below use them.

## Steps

1. **Is it one draft or all of them?** Open **Admin → Home** (`/app/admin`):
   - **Scheduler**: find `draft-tick`. Its last run should be a few seconds
     ago. "Last run FAILED", or a last run more than a minute ago, means the job
     itself is down, and **every** live draft is stuck. Go to step 5.
   - **Needs attention → Stalled jobs** lists a scheduled job whose last
     run failed or that is switched off in the scheduler. A job that has
     simply stopped running is not listed there: read its time in
     **Scheduler**.
   - If `draft-tick` is running fine, only this draft is affected. Go to
     step 2. Note: a failure inside **one** draft is caught and logged, so
     `draft-tick` still shows a successful run. A green **Scheduler** does
     not prove every draft is moving. Nothing watches for one stuck draft
     (F751), so you usually hear about it from the league.

2. **One draft stuck: check for an auto-pause first.** If no commissioner
   or co-commissioner has been connected to the draft room for about 45
   seconds (plus a short grace period), the tick pauses the draft by itself,
   and the draft chat says "Draft auto-paused: no commissioner or
   co-commissioner is connected." This only happens if a commissioner was
   connected at some point. It never resumes on its own. The fix is for a
   commissioner to open the draft room and resume it.

3. **Ask the commissioner to act.** In the draft room
   (`/app/leagues/[id]/draft`) the commissioner has:
   - **Pause** / **Resume** on the command bar. Pausing keeps the time left
     on the clock, and resuming restores it exactly. A clock that had
     already run out resumes already run out, so the next tick makes the
     auto-pick.
   - **Draft Options**: **Clock & timers**, **Undo picks**, **Fix a pick**,
     **Pick for a manager**, **Reset draft**, and **End draft** (auction
     drafts only).

   These actions are recorded in the league's commissioner log
   (League → Activity → Commissioner).

4. **If the commissioner's controls also fail**, write down what the
   screen said (the exact words) and stop. Raise it with Chris as a bug,
   with the league, the draft and the time. You have no override: you do
   not edit draft rows by hand.

5. **`draft-tick` is down (all drafts stuck).**
   - **Tell people.** **Admin → Notify** → **Everyone in any league** (or
     **One league's members** if only one league is drafting): "Drafts are
     paused for a few minutes while we fix a problem. No picks will be lost."
   - Ask each drafting league's commissioner to **Pause**. This
     stands in for pause-all-drafts, which is not built. A paused draft
     keeps each clock's remaining time, so nobody is auto-picked unfairly
     when the job comes back.
   - In the Supabase dashboard (Integrations → Cron), check the
     `draft-tick` job: is it there and active, and what do its last runs
     say? Do not edit or reschedule the job by hand. Its definition lives
     in a migration. If it is missing or broken, that is a fix-forward
     migration, pushed with `npx supabase db push`, never a dashboard edit.
   - While `draft-tick` is down the clock sits at 0:00 and no auto-pick
     happens: only the tick makes auto-picks. A commissioner who wants to
     keep going can use **Pick for a manager** for each team on the clock.
   - When **Scheduler** shows `draft-tick` running again, ask the
     commissioners to **Resume**, and send a second notice.

6. **Check it worked.** The draft room shows the next team on the clock and
   the clock counting down. **Scheduler** shows `draft-tick` running every
   few seconds.

## Record it

For a rehearsal (L.F2.10), write a timestamped line for every step: the
time, what you or the commissioner pressed, and what the screen said. Fix
this runbook, or file an F-row, for every mismatch.
