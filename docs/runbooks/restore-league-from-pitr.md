# Runbook: restore one league from a point-in-time backup

> Spec §24.3: restoring one league from PITR without touching other leagues
> is **possible but last-resort**. Written for M7 L.F2.9. It is rehearsed in
> L.F2.10 only if the hosted test project has PITR (C1 (f)); otherwise it is
> reported as **not rehearsed** and Chris rules (D574). Until then it has
> **not been rehearsed**.

## Paid add-on caveat — read first

**Point-in-time recovery (PITR) is a paid Supabase add-on.** It is not part
of the base plan. Before you rely on this page, check in the Supabase
dashboard (Project → Database → Backups) that:

1. PITR is switched on for the project you need to restore, and
2. the moment you want to go back to is inside its retention window.

If PITR is not on, the only backups are the plan's daily ones, and you can
only go back to a daily snapshot. Everything below still applies, with
"the daily backup" in place of "the PITR moment". Without PITR, the
spec's "PITR enabled before beta" (§24.2) is not met: tell Chris.

## Never restore production in place

A Supabase restore, PITR included, rolls back the **whole database**: every
league, every user, every list. That is never the fix for one league. This
runbook restores into a **separate project** and copies one league's rows
back. If the dashboard offers only an in-place restore of production, stop
and ask Chris.

## When to use this — and when not to

Use it only when one league's data is damaged or lost **and** nothing
smaller can fix it. Try these first, in this order:

1. **The commissioner's own tools** (their commissioner pages). They can
   edit lineups, rosters, scores, results, FAAB and settings. Every edit is
   audited.
2. **Admin console knobs** (`/app/admin`). Pause / resume / run now for a
   job, or a game mark. See the other runbooks.
3. **Re-pull stats** for a past week with `npm run sync:reingest` (see the
   stats outage runbook), then `npm run reconcile` to check.

If one of these works, stop here.

## What you cannot do

- You cannot edit or delete audit rows. The commissioner log, the operator
  log and the other `*_actions` tables refuse every update and delete, for
  everyone (§12.12). A restore may only **add back** missing audit rows,
  never overwrite one.
- There is no script that copies one league out of a backup. You copy rows
  by hand with SQL, table by table. Chris, or someone he names, does this.
  It is never done from the app.

## What you need

- Chris's go-ahead in writing, with the league and the moment to restore to.
- Dashboard access to the Supabase organisation, and the project's database
  password. Keep both out of chat, PRs and logs. The repo is public.
- The league's id (from its page address, or **Admin → Leagues**).

## Steps

1. **Freeze the league, as far as you can.** This freeze is **partial**.
   It stops the scheduled jobs and asks people to hold off, but members can
   still make moves (lineups, claims, trade offers, chat), and lineup
   locking keeps running. That is why step 6 re-checks before copying.
   - **Admin → Leagues → the league** (`/app/admin/leagues/[id]`) →
     **Jobs**: **Pause** Waivers, Week advance and Week finalize. Lineup
     locking can't be paused. That's fine: it only locks players at kickoff.
   - If a draft is running in that league, ask the commissioner to **pause
     the draft** from the draft room. The console has no draft buttons.
   - **Admin → Notify** → **One league's members**: tell them the league is
     being repaired and not to make moves until you say so.

2. **Write down the moment to restore to.** Use the league's activity
   (League Home) and **Admin → Log** to find the last good moment. Use UTC.

3. **Restore into a new project.** In the Supabase dashboard, restore the
   backup at that moment **to a new project**, not over production. Name it
   so nobody mistakes it for production, and never point the app at it.

4. **List the league's rows in the restored copy.** Every table with a
   `league_id`, plus the rows that hang off them (teams, drafts, matchups,
   trades, waiver claims). Measured from the generated types on 2026-10-20 —
   **re-measure before use**, because new tables are added:
   - `leagues` (the row itself)
   - membership and teams: `league_members`, `teams`, `team_managers`,
     `team_lineups`, `team_autopilot`, `league_invites`
   - draft: `drafts`, `draft_picks`, `draft_bids`, `draft_budget_adjustments`,
     `draft_queues`, `draft_dnd_marks`, `draft_liveness`, `league_player_pool`
   - season: `league_weeks`, `matchups`, `team_week_results`,
     `league_week_player_points`, `league_stat_corrections`,
     `league_player_values`, `league_rosters`
   - moves: `transactions`, `waiver_claims`, `waiver_runs`, `trades`,
     `trade_items`, `trade_drops`, `trade_votes`
   - other: `league_chat`, `league_lists`, `job_pauses`
   - audit (add back only): `commissioner_actions`, every `commish_*_actions`,
     `lineup_actions`, `schedule_actions`, `trade_actions`,
     `waiver_claim_actions`, `platform_operator_actions`, `admin_rescore_actions`

5. **Compare.** For each table, compare the restored rows with production's
   rows for that league. Write down what is missing, what differs and what
   is extra. Show Chris the list before changing anything.

6. **Copy back, in one transaction, parents before children.** With Chris's
   go-ahead:
   - **Redo the step 5 comparison first, just before copying.** The freeze
     is partial, so production may have moved since. If anything new
     appears, show Chris again before going on.
   - Put back missing rows, and correct changed ones, in the non-audit
     tables, starting with `leagues`, then teams, then everything else.
   - Add missing audit rows. Never update or delete an existing one.
   - **Triggers that stay on even in replication mode.** These triggers
     are switched on ALWAYS, so `session_replication_role = replica` does
     not get past them. Measured from the migrations on 2026-10-20 —
     **re-measure before use** (`grep -rn "ENABLE ALWAYS TRIGGER"
     supabase/migrations`):
     - audit logs, which refuse any update, delete or truncate:
       `commissioner_actions` (123, plus 179's revert check) and
       `platform_operator_actions` (182);
     - `league_week_player_points`: the stored points of a final week are
       locked (158);
     - pointers at the commissioner log (170): `matchups`
       (`override_action_id`, `pairing_set_by_action_id`), `transactions`
       (`related_action_id`) and `league_weeks` (`reopened_by_action_id`,
       `scoring_rules_action_id`);
     - `matchups`' override guard (126); `league_weeks`' scoring-rules
       guards (144); `team_lineups`' one-start-per-week rule (154);
       `league_rosters`' trade invalidation (148); `team_managers`' trade
       rescind on a closed stint (151); `leagues`' scoring-rules and waiver
       order guards (104, 163).

     Plan for them before you start:
     - the two audit tables: insert only the rows that are missing. Rows
       added after the restore moment stay. They are the true record of
       what happened, including this repair.
     - final-week player points cannot be changed. If the restored copy
       differs for a final week, stop and take it to Chris.
     - **A row that points at the commissioner log cannot be copied back
       with plain SQL.** Only the audited commissioner action that wrote
       that log entry, in the same transaction, may set the pointer. If any
       row you need carries one of the pointers above, stop and take it to
       Chris. **Never set `app.commish_action_id` (or any `app.*`
       setting) by hand** to get a row past the guard.
     - The other guards check the row is valid. A row the restored copy
       holds should pass them. If one refuses, stop. Do not work round it.
   - Touch **only** rows for this league. Every statement filters on the
     league id, or on ids that belong to it.
   - If anything refuses (a trigger, a constraint), roll back the whole
     transaction and stop. Do not switch triggers off to get past it.

7. **Check the league.**
   - `npm run reconcile -- <season> --league <league id>`. It only reads.
     It prints a JSON summary. A clean result needs **all three**:
     `"alerts": 0`, `"reason": null`, and `"cells"` above 0. A `reason` of
     `"no_leagues_in_scope"` or `"no_league_weeks_started"`, or `"cells": 0`,
     means it compared nothing. That is not a pass. It exits 1 on any alert.
   - The admin league page **Now** section shows the weeks you expect.
   - Open the league as a member: standings, rosters and the activity read
     right.

8. **Unfreeze.** **Resume** the three jobs from step 1. Ask the commissioner
   to resume the draft if one was paused. Send the members a second notice
   saying the league is back.

9. **Delete the restored project** once Chris agrees it is no longer needed.
   It holds a full copy of every user's data.

## Record it

For a rehearsal (L.F2.10), write a timestamped line for every step: the
time, what you did, and what you saw. Note anything that did not match this
page. Fix this runbook, or file an F-row, for every mismatch. If the test
project has no PITR, write "not rehearsed — no PITR on the test project" and
hand it to Chris.
