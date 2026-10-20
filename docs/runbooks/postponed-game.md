# Runbook: an NFL game is postponed or cancelled

> Spec §24.3 (the postponed-game runbook) and §24.4 "Game status" (Q100).
> This is the same procedure as M8's L.G2.1 postponed-game drill — one
> document, not two. Written for M7 L.F2.9; rehearsed for real on the hosted
> test project in L.F2.10 (D574). Until then it has **not been rehearsed**.

## When to use this

The NFL has announced that a game this week will not be played at its
scheduled time: it moves later in the same week, moves to another week, or
is cancelled.

The stat sync cannot tell a postponement from a slow game. Until you mark
the game, the week waits for it, and every league playing that week stays
open.

## What you need

- Your admin account (the only one with the Admin page).
- The NFL's announcement: the new kickoff (if any), and which week it falls in.

## What you cannot do (not built in 2026)

- There is **no "close the week now"** and **no "finalize anyway"** button
  (Q103 dropped it). Marking the game is the only way to let a held week
  close. The normal rule then closes and finalizes the week on its own.
- There is **no "freeze scoring"** switch. You do not need one here: the
  mark itself decides what the game's players score.
- You cannot edit a league's scores. If one league needs a score changed
  afterwards, that is its commissioner's job (their commissioner tools).

## Steps

1. **Find the game.** Open **Admin → Home** (`/app/admin`). Look at
   **Needs attention → Weeks waiting on a game**, then the **Games** section
   below it. The game is listed with its kickoff and why it is holding the
   week.
   - If it is not listed yet, it has not reached its kickoff. Open any
     affected league from **Admin → Leagues**, and look in **Games this week**
     on that league's page (`/app/admin/leagues/[id]`).
   - A game that is already final shows no buttons. A final game is never
     marked.

2. **If the game was stopped part-way through** (it started, then was
   suspended): stop and ask Chris before marking it. "Moved out of the week"
   and "Cancelled" both give every player in that game **0 for this week**,
   including points they had already scored.

3. **Pause waivers (optional, recommended).** This stops waiver claims
   being processed while the week's results are still moving.
   - All leagues: **Admin → Home → Jobs for every league → Waivers → Pause**.
   - One league: its league page → **Jobs → Waivers → Pause**.
   - The confirm box shows **Now** and **After**. The reason is optional and
     is kept in the operator log. Pending claims keep their order.

4. **Mark the game.** On the game's row press one of:
   - **Moved later this week** — the game will still be played inside this
     fantasy week. The week waits for it, and its players score normally.
   - **Moved out of the week** — the game will be played in a later week.
     Its players score 0 for this week, their lineup locks release, and the
     week can close.
   - **Cancelled** — the game will not be played. Same effect as moved out
     of the week.

   Read the **Now / After** lines in the confirm box, then confirm. The mark
   applies to **every league** playing that week. Each affected league gets
   one line in its activity, signed "FieldScout". The stat sync will not
   overwrite a marked game.

5. **Tell people.** Open **Admin → Notify** (`/app/admin/notify`).
   - Audience: **Everyone in any league** (a game mark reaches every league
     playing that week). For a test that reaches one league only, use
     **One league's members**. Do not use **Every app user**: people with no
     league don't need this.
   - Title: for example "Week 6: the Bills–Chiefs game has moved".
   - Message: what happened and what it means. For example: "Players in that
     game score 0 for week 6. Nothing else changes."
   - Link (optional): a page inside FieldScout, such as `/app/leagues`.
   - Press **Send…**, check the preview, and press **Send**. The page reports
     how many people it reached. A send to nobody is refused. If you see
     "Sent … to 0", stop — that is not a success.

6. **Wait for the week to close on its own.** Do nothing to force it.
   - Week advance and week finalize run on their schedule. You can press
     **Run now** for **Week advance** or **Week finalize** to run them
     sooner. Run now follows the same rule as the schedule. It cannot close
     a week the rule still holds, and it is hidden while that job is paused.
   - Watch **Needs attention**. If **Weeks stuck past Wednesday** appears, a
     game is still holding the week past its Wednesday deadline: go back to
     step 1 and check every game listed against that week.

7. **Resume waivers.** Same place as step 3 → **Resume**. Then **Run now**
   if you want claims processed straight away, rather than at the league's
   next scheduled run.

8. **Check it worked.**
   - **Admin → Home → Needs attention** no longer lists the week as waiting
     on a game, and there are no paused jobs.
   - On an affected league's admin page: **Now** shows the week closed or
     final, and **Recent actions** shows your marks.
   - Open that league as a member: League Home shows the "FieldScout" line,
     standings include the week, and the bell shows the notice labelled
     "From FieldScout".
   - **Admin → Log** (`/app/admin/log`) has one row for each thing you
     changed (pause, mark, notice, resume). A step that changed nothing
     writes no row.

## If you marked the wrong thing

- Press **Back to normal** on the game's row. This clears the mark, and
  takes back the "this week can end" time the mark recorded (F593), so the
  week waits for the game again. Then mark it correctly.
- If league weeks already **closed or went final** because of the wrong
  mark, stop and ask Chris. This page does not cover undoing a closed week
  (F752 — to be measured in the L.F2.10 rehearsal).
- Once the game is final, it shows no buttons. After that, a wrong result in
  one league is fixed by that league's commissioner.

## Record it

For a rehearsal (L.F2.10), write a timestamped line for every step: the
time, what you pressed, what the screen said. Add a line for anything that
did not match this page. Fix this runbook, or file an F-row, for every
mismatch.
