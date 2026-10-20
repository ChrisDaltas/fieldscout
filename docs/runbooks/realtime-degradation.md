# Runbook: live updates are slow or stopped

> Spec §24.3 "realtime degradation". Written for M7 L.F2.9. It has **not
> been rehearsed**. That happens in L.F2.10 (D574).

## When to use this

Pages stop updating live, or update late: the draft board, the matchup
page, League Home's activity. Managers see a "Reconnecting" banner or have
to reload to see changes.

## How live updates work

- Every league page loads its data first, then listens for live updates.
  Live updates are a bonus. The data always comes from a normal page fetch.
- When the live connection drops, the page shows **"Reconnecting — syncing
  this league…"**. It reloads its data and reconnects, then reloads again
  on every reconnect.
- The draft room has a watchdog. After 45 seconds with no heartbeat it
  shows **"Reconnecting — syncing the room…"** and reloads the room.
- A pick, bid, lineup change or claim is saved by the server whether or not
  live updates are working. Nothing is lost. People just see it late.
- The spec says clients fall back to polling every 10 seconds. That is
  **not built**: pages reload on reconnect, not on a timer (F758). So while
  the connection stays down, a page catches up only when it reconnects or
  is reloaded.

## What you cannot do (not built in 2026)

- There is **no operator switch** for live updates.
- What to do instead: tell people to reload, and, in a draft, ask the
  commissioner to pause until it settles.

## Steps

1. **Is it us, or one person's connection?** Open the affected page
   yourself, in a second browser. If yours updates and theirs doesn't, it is
   their connection. Tell them to reload.

2. **Check the database side.** **Admin → Home** (`/app/admin`):
   **Scheduler** and **Needs attention**. If jobs are failing there, the
   problem is bigger than live updates. Use the stuck draft or stats outage
   runbook instead.

3. **Check Supabase's realtime.** In the Supabase dashboard, look at the
   project's Realtime usage and reports (connections, messages, errors), and
   at Supabase's public status page. Spec §24.1: above 85% of the
   connection or message limit is the danger line.

4. **If a draft is live:** ask its commissioner to **Pause** from the draft
   room's command bar until updates are back, so nobody runs out of time
   while their screen is stale. Then **Resume**.

5. **Tell people.** **Admin → Notify**. Use **One league's members** if one
   league is affected, or **Everyone in any league** if all are: "Live
   updates are slow right now. Your moves are saved. Reload the page to see
   the latest."

6. **When it recovers:** the "Reconnecting" banners clear on their own.
   Send an all-clear if you sent a notice.

## Record it

For a rehearsal (L.F2.10), write a timestamped line for every step: the
time, what you did, and what the screen said. Fix this runbook, or file an
F-row, for every mismatch.
