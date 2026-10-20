# Runbooks

What to do when something goes wrong with leagues. Spec §24.3. Written in
M7 L.F2.9 (PROGRESS D640–D641). Each one is **rehearsed for real** on the
hosted test project in L.F2.10, with a timestamped log (D574). Reading a
runbook through does not count as rehearsing it.

| Runbook | Use it when |
|---|---|
| [stuck-draft.md](stuck-draft.md) | A live draft's clock has run out and nothing happens |
| [stats-outage-mid-sunday.md](stats-outage-mid-sunday.md) | Live scores stop moving during games |
| [realtime-degradation.md](realtime-degradation.md) | Pages stop updating live, or update slowly |
| [waiver-partial-failure.md](waiver-partial-failure.md) | A waiver run worked for some leagues and not others |
| [commissioner-locked-out.md](commissioner-locked-out.md) | A commissioner can't reach their league's commissioner tools |
| [restore-league-from-pitr.md](restore-league-from-pitr.md) | One league's data is lost or damaged and nothing smaller fixes it |
| [postponed-game.md](postponed-game.md) | An NFL game is postponed or cancelled |

## The tools these pages use

- **Admin console** (admins only; anyone else gets "not found"):
  - `/app/admin` (Home): **Needs attention**, **Games**, **Jobs for every
    league**, **Scheduler**.
  - `/app/admin/leagues` and `/app/admin/leagues/[id]`: one league's
    **Now**, **Jobs**, **Games this week**, **Recent actions**.
  - `/app/admin/notify`: a notice to **Everyone in any league**, **Every app
    user** or **One league's members**. In-app bell only.
  - `/app/admin/log`: the operator log. Every change you made, never
    editable.
- **Job buttons:** **Pause**, **Resume** and **Run now** for **Waivers**,
  **Week advance** and **Week finalize**. **Lineup locking** has **Run now**
  only. **Run now** is hidden while that job is paused: resume it first.
  (`op_pause_job` / `op_resume_job` / `op_run_job_now`, via
  `POST /api/admin/jobs`.)
- **Game marks:** **Moved later this week**, **Moved out of the week**,
  **Cancelled**, **Back to normal**. A final game shows no buttons.
  (`op_set_game_status`, via `POST /api/admin/games/[id]/status`.)
- **Scripts** (run from a checkout; they read `.env.local`, which names the
  hosted project. A write needs `--confirm-target`):
  - `npm run reconcile -- <season> [--league <id>]`: read-only check of
    stored scores against stats. Exits 1 on any alert.
  - `npm run sync:reingest -- --season <yyyy> --weeks <n-m> --confirm-target <host>`:
    re-pulls stats for weeks that have already been played. Safe to repeat.
  - `npm run rescore:final-weeks` is **retired**: it refuses to run (F489).
    `npm run backfill:player-points` was a one-time fix. Neither is a
    runbook tool.

## Not built in 2026 — each runbook says what to do instead

No draft buttons in the console (no pause-all-drafts). No stats-sync buttons.
No freeze-scoring switch. No force-close or "finalize anyway" for a week.
No alerts page anyone in 2026 (Q91): you find problems on **Needs
attention**, or because someone tells you.

## Writing rules

Plain steps. No hostnames, project ids, keys or passwords. The repo is
public. Name the console screen or the `op_*` verb each step uses.
