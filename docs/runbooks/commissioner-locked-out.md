# Runbook: a commissioner is locked out

> Spec §24.3 "commissioner locked themselves out (support tooling reads the
> audit log, never bypasses it)"; §7.2. Written for M7 L.F2.9. It has **not
> been rehearsed**. That happens in L.F2.10 (D574).

## When to use this

A commissioner says they can't run their league: they can't sign in, they
gave the commissioner role away by mistake, or the commissioner tools are
gone from their screens.

## How the commissioner role works

- Each league has **exactly one commissioner**. It can have
  co-commissioners, who have the same powers but cannot take the
  commissioner role.
- Only the **sitting commissioner** can hand the role on: League →
  **Members** (`/app/leagues/[id]/members`) → **Make commissioner** on
  another member. The handover is recorded in the commissioner log.
- The commissioner cannot leave the league, be removed, or be demoted.
  They must hand the role on first.

## What you cannot do

- **You have no override.** The Admin console has no power inside a
  league. It cannot change roles, members or settings. This is deliberate
  (§24.4). Support reads the record and never goes around it.
- Do not edit `league_members` or any league row in the database to "give
  the role back".
- **Do not delete anyone's account to start them fresh.** Deleting any
  member's account deletes the teams they own. Deleting the account of the
  person who **created** a league deletes that whole league and everything
  in it (F756).

## Steps

1. **Find out what happened, from the record.** Ask for the league name.
   Then read, without changing anything:
   - **Admin → Leagues → the league** (`/app/admin/leagues/[id]`) →
     **Recent actions**: the newest commissioner actions; or
   - the league's **Commissioner log** (League → Activity → Commissioner).
     Any member of the league can read it, so the person asking can too.

   Look for a handover of the commissioner role: who did it, to whom, and
   when.

2. **They can't sign in.** This is an account problem, not a league one.
   Send them to **Forgot password** (`/forgot-password`). They get a reset
   link and set a new password at `/reset-password`. Once they are back in,
   their role is unchanged. Nothing else to do.

3. **They handed the role to someone else by mistake.** Only the new
   commissioner can give it back: they open **Members** and press **Make
   commissioner** on the original one. Put the two in touch. You cannot do
   it for them.

4. **They are a co-commissioner, not the commissioner.** A co-commissioner
   already has the commissioner tools. If they want the role itself, the
   sitting commissioner must hand it over (step 3).

5. **The commissioner is gone for good** (lost their email, left
   FieldScout, won't answer): open the league in **Admin → Leagues**, find
   the member the league wants in **Members**, and press **Make
   commissioner** (F750, migration 208). Check the dialog's Now / After,
   add a reason if you like, and confirm. The old commissioner becomes a
   manager and keeps their team; the league sees "FieldScout made X the
   commissioner." Only a member who has joined can be picked — an empty
   seat has no button. Get the members' agreement on who it should be
   first; if they disagree, give it to Chris to rule. Do not improvise.

6. **Reply to the person** in plain words: what the record shows, and what
   they (or the other member) need to do next.

## Record it

For a rehearsal (L.F2.10), write a timestamped line for every step: the
time, what you did, and what the screen said. Fix this runbook, or file an
F-row, for every mismatch.
