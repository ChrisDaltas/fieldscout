# Runbook: the stats provider goes down during games

> Spec §24.3 "stats provider outage mid-Sunday"; §23.2 / E45 ("never wrong
> numbers, just honest staleness"). Written for M7 L.F2.9. It has **not been
> rehearsed**. That happens in L.F2.10 (D574).

## When to use this

Live scores stop moving while games are being played. Managers see the
banner **"Live stats delayed — scores show the last update we received."**

## How live scoring works

- `sync-live-ping` (every minute) pulls live stats from the provider.
  After **three failed pulls in a row**, it sets the "stats degraded" flag
  and the banner appears.
- `score-week-ping` (every minute) turns new stats into league scores.
- `scoring-stall-check` (every minute) sets the "scoring stalled" flag when
  queued scoring work hasn't moved for 10 minutes, or no stats pull has
  been recorded for 2 hours. Managers see the same banner.
- The Admin console does **not** show either flag. You see them as the
  banner on any league page during games.
- The banner clears on its own at the first successful pull. Nobody can
  switch it on or off by hand (F754).
- There is **no backup provider**. Live stats come from Sleeper, with
  nflverse's schedule combined in. If the feed is down, there is nothing to
  switch to.
- Scores never go to zero or to a guess. The last good scores stay on
  screen until new stats arrive.

## What you cannot do (not built in 2026)

- There are **no stats-sync buttons** in the Admin console, and **no
  freeze-scoring switch**. What to do instead: the last good scores
  already stay on screen by themselves. Tell people, and wait.
- Do not pause **Week advance** or **Week finalize** to "protect" scores.
  A week cannot finalize while its games are not final, or while scores or
  results are still waiting to be worked out. It cannot advance before the
  week's last game has an end time. Those jobs follow that rule on their own.
- Do not mark games (Moved out of the week / Cancelled) because stats are
  late. A mark gives players 0. It is only for games the NFL has moved or
  cancelled (see `postponed-game.md`).

## Steps

1. **Confirm what is stuck.** Open **Admin → Home** (`/app/admin`):
   - **Scheduler**: the last runs of `sync-live-ping`, `score-week-ping`
     and `scoring-stall-check`.
   - **Needs attention**: **Stalled jobs** (a job whose last run failed or
     is switched off), and the "players to re-score" count.
   - Open a league with a game on: is the "Live stats delayed" banner up?
   - If `sync-live-ping` runs but fails, the **provider** is the problem.
     Go to step 2.
   - If `sync-live-ping` is fine but `score-week-ping` is stalled, or the
     "players to re-score" count keeps growing, **our scoring** is the
     problem. Go to step 4.

2. **Provider down: tell people.** **Admin → Notify** → **Everyone in any
   league**. Title: "Live scores are delayed". Message: "Our stats provider
   is having problems. Scores show the last update we received and will
   catch up on their own. Nothing is lost." Check the recipient count.

3. **Wait.** When the provider comes back, the next `sync-live-ping`
   catches up, the banner clears and scores move again. You do nothing.
   - If the provider is still down after the games end, the week stays open
     until stats arrive. That is the rule working, not a fault.

4. **Our scoring is stalled.** Write down what **Scheduler** and **Stalled
   jobs** say (the exact words and times), and raise it with Chris as a
   bug. Then send the notice in step 2, which is true in this case too.

5. **After it recovers: check the numbers.**
   - For a week that has already finished, re-pull its stats:
     `npm run sync:reingest -- --season <yyyy> --weeks <n> --confirm-target <host>`.
     The first line it prints is the target. It writes nothing unless
     `--confirm-target` matches that target. Running it twice is safe.
     The scripts do not refuse production by name (F755): read the target
     line before you confirm it.
   - Then run `npm run reconcile -- <season>`. It only reads. "No alerts"
     means stored scores match the stats. Any alert (it exits 1) goes to
     Chris. Do not fix scores by hand.
   - If one league's result is wrong after all this, its commissioner
     fixes it with their commissioner tools.

6. **Send a short "all clear" notice** to the same audience.

## Record it

For a rehearsal (L.F2.10), write a timestamped line for every step: the
time, what you did, and what the screen said. Fix this runbook, or file an
F-row, for every mismatch.
