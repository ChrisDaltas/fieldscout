# Runbook: a waiver run fails for some leagues

> Spec §24.3 "waiver job partial failure (re-run idempotently per league)".
> Written for M7 L.F2.9. It has **not been rehearsed**. That happens in
> L.F2.10 (D574).

## When to use this

Waivers processed in most leagues, but in one or more leagues the claims
are still pending after their run time. Managers say "my claim never went
through".

## How waiver runs work

- `process-waivers` runs **every minute**. It processes each league that is
  due **on its own**. If one league fails, only that league is rolled back:
  no claim in it is awarded and no FAAB moves. Every other league carries
  on.
- A failed league is retried **every minute** until it succeeds. Its run is
  not skipped or moved on.
- A run is settled **exactly once** per league and run time. Re-running can
  never award a claim twice. That is why **Run now** is safe.
- A failure is recorded in the database's waiver run log, with the error.
  It does **not** show under **Stalled jobs**, and no admin page reads that
  log yet (F753).

## What you cannot do (not built in 2026)

- There is no admin view of failed waiver runs (F753). What to do instead:
  spot it on the league page (step 1), and read the log with a read-only
  query in the Supabase SQL editor (step 2).
- You cannot award a claim or move a player yourself. That is the
  commissioner's job (step 5).

## Steps

1. **Find the stuck league.** **Admin → Leagues → the league**
   (`/app/admin/leagues/[id]`) → **Now**. The tell is **pending claims with
   a next waiver run time in the past**. **Admin → Home → Needs attention**
   also shows the total "Waiting: N waiver claims" across all leagues.

2. **Read why.** In the Supabase SQL editor, read only: the newest
   `waiver_runs` rows for that league with status `refused`, and their
   `last_error`. Copy the error text into your notes. Do not change any
   rows.

3. **Is it a bug or bad data?**
   - If the error names one team's data, for example "has claims in a FAAB
     league but no FAAB balance on record", it is data the commissioner
     can fix. Go to step 5.
   - Anything else is a bug. Raise it with Chris with the league, the time
     and the error. Pause the league's waivers meanwhile (step 4) so it
     stops retrying every minute.

4. **Pause while it is fixed (optional).** League page → **Jobs → Waivers →
   Pause**. Pending claims keep their order. **Run now** is hidden while
   paused.
   - To stop waivers in **every** league: **Admin → Home → Jobs for every
     league → Waivers → Pause**. Note: there is also an older service-role
     "waivers paused" switch in the database's system flags. It is separate
     from this button and is not shown in the console. If waivers are
     paused and the console says they are not, check that flag.

5. **Commissioner fixes the data.** The commissioner opens the team's page
   and presses **Turn on override mode**. Then **Commissioner roster tools**
   to fix a roster, or **Set balance** for FAAB. Every change is in the
   commissioner log.

6. **Re-run.** League page → **Jobs → Waivers → Resume** (if you paused),
   then **Run now**. It runs the same function the schedule runs, under the
   same rules.

7. **Check it worked.** **Now** shows no pending claims due in the past.
   League Home's activity shows the waiver results. A second **Run now**
   changes nothing. The confirm box says nothing changed and why.
   **Admin → Log** has your pause, resume and run rows.

8. **Tell the league** if claims were late: **Admin → Notify → One
   league's members**, "Waivers ran late this week. They have now been
   processed."

## Record it

For a rehearsal (L.F2.10), write a timestamped line for every step: the
time, what you did, and what the screen said. Fix this runbook, or file an
F-row, for every mismatch.
