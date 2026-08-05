# Hosted ↔ repo migration reconciliation (project `xhqrdzllcsrvbbcygilv`)

> Audit + reconciliation of the production Supabase project behind fieldscout.gg
> against `supabase/migrations/`. Performed 2026-08-05. Production is live
> (friends-only soft launch) — no resets, no destructive steps.

---

## 1. What was actually deployed

**Verified by object inspection, not by trusting the history table.**

| Repo migrations | Hosted status |
|---|---|
| `001`–`014` | Applied. Recorded under numeric versions that already matched the repo filenames. |
| `015`–`036` | Applied. Recorded under **timestamp** versions (`20260612185124` …). Content verified identical to the repo files. |
| `037`–`040` | **Not applied.** |
| `041`–`047` | Do not exist — the gap is intentional (D50: reserved on paper by tasks-M1 §7, work landed as 052–059). |
| `048`–`072` | **Not applied.** |
| `073` | Applied out-of-band 2026-08-05 18:07 via MCP during the signup incident. Byte-identical to the repo file. |
| `074` | Applied out-of-band 2026-08-05 19:45 via MCP, ahead of the code deploy (PR #93). Byte-identical to the repo file. |

### Evidence that 001–036 are truthful, not just name-matched

A prod-shaped clone (`fs_rehearsal`) was built locally by replaying repo
`001`–`036` + `073` + `074`, then compared to production:

| Signature | Production | Replay |
|---|---|---|
| public columns (md5, 427 cols) | `6cafcbec398b271a8184556f99bb969c` | identical |
| public policies (md5, 64) | `78375ccdd6f584552d2fac502d5d0334` | identical |
| public app functions | 15 | identical set |

**Production therefore has zero out-of-band schema drift** beyond the two known
migrations. Nothing was hand-patched; the divergence was purely the recorded
*version strings*.

### Absence checks for the unapplied range

`nfl_weeks` ✗ · `citext` ✗ · `profiles_username_format_check` ✗ ·
`profiles_username_lower_key` ✗ · `leagues.settings` / `.deleted_at` /
`.scoring_rules_snapshot` ✗ · `scoring_systems.is_template` ✗ · all league and
draft tables ✗ · `is_league_member` ✗ · `create_league` ✗ ·
`notify_list_followers` lacks the R5 in-body auth check ✗.

**037 is a special case:** its default-ACL model is *natively* present, because
the hosted project was provisioned under Supabase's legacy grant model — which
is exactly what 037's header documents. On production 037 is a no-op by design;
it exists so a fresh local reset reproduces production's grant model.

---

## 2. Live data — all preconditions pass

| Check | Value |
|---|---|
| players / lists | 3254 / 65 |
| auth users / profiles | 6 / 6, no orphans either direction |
| `leagues` rows (040's C9 gate requires 0) | **0** ✓ |
| usernames violating 040's CHECK | none ✓ |
| usernames violating 050's final CHECK | none ✓ |
| case-insensitive duplicates | none ✓ |
| persona-shaped handles | `fieldscout-ai` only (covered by the exemption) ✓ |

Two notes against the original brief:

- `c41b5e9b-…` (chris.daltas@gmail.com) is **`chris`**, not `user_c41b5e9b` —
  the placeholder was already replaced through the `/username` flow.
- A real friend signup landed *during* this audit (21:15, `user_2c6f328e`,
  placeholder-shaped). It passes both CHECKs — 050 explicitly permits the
  reserved shape when the trigger assigns it. **Production is taking live
  traffic; re-run the precondition query immediately before any push.**

---

## 3. Blocking defect found: 073 reverted the username-contract guards

`073` is a `CREATE OR REPLACE FUNCTION handle_new_user()` hotfix authored
against the *006-era* body. It pins `search_path` (the real fix) but drops the
hardening added by `049`, `050` and `051`:

- 049 — client metadata may only claim a **human-pattern** handle
- 050 — the `user_<8hex>` placeholder shape is **reserved**
- 051 — `display_name` derives from the effective username, never the rejected value

Because `073` sorts after `051`, **any fresh `supabase db reset` of `main` ends
with the guards gone.** Proven empirically: a clean numeric replay of `001`–`074`
(`fs_canonical`) yields `has_049_guard = false, has_050_guard = false`.

This is the failure mode where an anonymous GoTrue signup carrying
`user_metadata.username = 'evil-ai'` mints a persona-pattern handle (D49(9)).

**`main` is RED.** `PR #91` fixes it but is **blocked by a numbering collision**:
it claims `074_restore_handle_new_user_username_contract.sql`, and
`074_ai_generation_quota.sql` (PR #93) merged first.

### Interaction with this reconciliation — benign

Pushing `037`–`072` leaves production's `handle_new_user` at **051's body**:
guards present, `search_path = public, pg_temp`. `073` will not re-run (already
recorded), so it cannot re-revert. Production therefore ends up *more correct
than a fresh reset* until PR #91 lands.

---

## 4. Rehearsal (delivery plan §6 — expand-first, idempotent)

No staging clone exists (the standing R6/D23 waiver), and the local dev database
is owned by a concurrent in-flight session, so the rehearsal ran in **separate
databases inside the local container** — the dev database was never touched.

`fs_rehearsal` = prod-shaped (§1 above) + production's six real usernames seeded,
then the full missing chain applied in numeric order:

- `037`–`067` applied clean.
- `068` needs `pg_cron`; it cannot be installed outside the `postgres` database,
  so the rehearsal stubbed the `cron` API and stripped the `CREATE EXTENSION`
  line. `068`–`072` then applied clean.
- **All 6 profiles survived with usernames unchanged.** 040's pre-checks passed
  against real production usernames.
- Final state: 52 tables, 78 policies, 81 app functions.
- No `SECURITY DEFINER` function lacks a pinned `search_path` (048 doctrine).

### Signup behaviour on the post-push database

| metadata | resulting username | verdict |
|---|---|---|
| *(none)* | `user_aa000000` | fallback ✓ |
| `evil-ai` | `user_bb000000` | persona claim refused ✓ |
| `user_deadbeef` | `user_cc000000` | placeholder claim refused ✓ |
| `realhandle` | `realhandle` | honoured ✓ |

Big boards auto-created 4/4.

### Convergence check

`fs_rehearsal` (prod after push) vs `fs_canonical` (fresh reset of `main`):

- columns md5 — **identical**
- policies md5 — **identical**
- **one** function differs: `handle_new_user` (see §3; the fresh reset is the
  broken side)

---

## 5. Reconciliation performed

### Step 1 — history repair ✅ DONE (2026-08-05)

Single transaction against production, **metadata only, no DDL**: the 22
timestamp-versioned rows for `015`–`036` plus the two out-of-band rows were
renumbered to the repo's numeric versions, and `name` set to the repo filename
suffix. `statements` was deliberately left untouched — it is the truthful record
of the SQL that actually ran.

Production history is now:

```
001…036, 073, 074
```

Every version corresponds to a real repo filename. Backup of the pre-repair
table: `prod-history-backup-20260805.tsv` (in the session scratchpad) — the
repair is reversible by inverting the mapping.

### Step 2 — push the gap (037–040, 048–072) — PENDING A RULING

Requires `--include-all`, because `073`/`074` are recorded ahead of the gap and
the CLI refuses out-of-order migrations by default:

```bash
npx supabase db push --include-all
```

**Precondition — `pg_cron` is not enabled on production.** `068` runs
`CREATE EXTENSION IF NOT EXISTS pg_cron` and schedules `draft-tick` every
**5 seconds** (plus `mock-expiry` nightly). 068's own header flags this as a
prod precondition. Enabling it starts an always-on job on the live project;
`draft_tick()` is a self-gating no-op when nothing is drafting.

### Step 3 — land the restore — PENDING A RULING

PR #91 must be renumbered off the taken `074`. Ordering constraint: the restore
must run **before** the in-flight `075_display_name_to_full_name`, whose header
explicitly requires it. Cleanest resolution is restore → `076`, rename → `077`,
but `075` is owned by another live session.

---

## 6. Going forward

- Never apply schema through MCP `apply_migration` against production without
  landing the identical file in `supabase/migrations/` in the same change — both
  out-of-band entries here were content-correct, but only by luck of discipline.
- A `CREATE OR REPLACE FUNCTION` hotfix must be authored against **the current
  head of the chain**, not against the body that happens to be deployed. 073 is
  the counter-example.
- After any out-of-band production fix, replay `main` into a scratch database
  and diff — that is what caught §3.
