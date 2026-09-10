# OPEN — the per-minute scoring jobs are being rejected (401)

**Status:** parked 2026-09-10 evening. **Nothing is broken.** The league runs;
scoring falls back to the once-daily Vercel crons, which are still scheduled
and still working. This only costs latency: scores appear the next morning
instead of within a minute.

## What is already done

- Migration **124** is applied to production. `select count(*) from cron.job` = 8:
  the 5 originals plus `sync-live-ping`, `score-week-ping`, `scoring-stall-check`,
  all at `* * * * *`.
- Both Vault entries exist: `fieldscout_site_origin`, `fieldscout_cron_secret`
  (created 2026-09-10 21:27:22Z).
- PR #287 merged. `vercel.json` still carries the daily `sync-live` /
  `score-week` entries deliberately (F331) — that is the fallback keeping
  scoring alive right now.

## The one thing wrong

`net._http_response` rows 1 and 2 (2026-09-10 21:33:00Z) are both **401**.

The value stored in Vault as `fieldscout_cron_secret` does not equal
production's `CRON_SECRET`. Cause: the first command handed to Chris read
`CRON_SECRET` from his local `.env.local`, which holds the DEVELOPMENT value
`dev-cron-secret`. That is what went into Vault.

**`npx vercel env pull` cannot fix this.** Measured — Vercel refuses to emit
production secret values to the CLI:

> `6 Secret values cannot be pulled from the production Environment. Wrote
> "[SENSITIVE]" as placeholders`

So the real value exists only in the Vercel dashboard UI (and inside the running
deployment). Any fix must get it from there, or replace it on both sides.

## Options, none attempted yet

1. **Read it from the Vercel dashboard** and re-create the Vault secret.
   Settings → Environment Variables → `CRON_SECRET` → reveal → copy.
2. **Rotate it**: set a new value in BOTH Vercel and Vault. Removes the need to
   reveal anything, but touches a live env var.
3. **Investigate a path that needs no human step** — e.g. whether the Vercel MCP
   server (now installed, needs auth) can read or set env vars directly. NOT yet
   explored; this is the one to try first next session.

## How to verify a fix worked

```sql
select status_code, created from net._http_response order by created desc limit 4;
```
200 means it landed. Then:
```sql
select count(*) from score_fanout;                    -- expect 0
select count(*) from team_week_results;               -- expect > 0
```
The 24 rows queued since 2026-09-10 08:50:35Z drain within a minute of a 200.

## Note for whoever picks this up

The failure was found in one query because migration 124 was built to fail
loudly and log the response. That part worked. The wrong value getting in was a
handover error, not a design fault — but the handover itself burned a lot of
Chris's evening across ~15 messages of shell commands that could not have
worked. Prefer a path with no terminal step.
