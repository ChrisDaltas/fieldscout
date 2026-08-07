# Runbook: hosted migration reconciliation

> Execution steps for closing the gap between production (`xhqrdzllcsrvbbcygilv`)
> and `supabase/migrations/`. Audit, evidence and rationale live in
> `hosted-migration-reconciliation.md` — this file is the ordered procedure.
>
> Production is live and taking signups. Every step below is expand-only: no
> drops, no resets, no destructive statements.

---

## Current state (verified 2026-08-05)

Production migration history:

```
001…036, 073, 074
20260805222646  handle_new_user_stores_no_name   ← should be 075
20260805230305  explicit_api_grants              ← should be 037
```

Repo `main` has `001`–`040`, `048`–`075`. The `041`–`047` gap is intentional
(D50). PR #98 adds `076`.

**Unapplied on production:** `038`, `039`, `040`, `048`–`072`, and `076`.

Production has **no schema drift** — a prod-shaped replay matched on columns
(427), policies (64) and the app-function set.

---

## Why the order below matters

Two constraints drive it:

1. **Relabel before pushing.** The CLI compares remote versions against local
   filenames. While the two auto-named rows exist, remote holds versions that
   match no local file. Renumber first, and remote reads `001`–`037`, `073`,
   `074`, `075` — every one a real file.

2. **`076` must land in the same push as `048`–`051`.** Those four redefine
   `handle_new_user` to write `display_name` again. `076` is what turns it back
   off *and* restores the username guards. Pushing the gap without `076` leaves
   production silently storing names, contradicting a shipped guarantee, with
   nothing surfacing the regression.

---

## Preconditions

- [ ] **PR #98 merged to main.** Without it `076` does not exist and step 4 is unsafe.
- [ ] **`pg_cron` enabled** (Dashboard → Database → Extensions). `068` runs
      `CREATE EXTENSION IF NOT EXISTS pg_cron` and schedules `draft-tick` every
      5 seconds. Not currently enabled.
- [ ] **No other session applying migrations** for the duration.
- [ ] **Live data gates pass** — re-run immediately before starting, these change:

```sql
select
  (select count(*) from public.leagues)                                   as leagues_must_be_0,
  (select count(*) from public.profiles where not (
      (username ~ '^[a-z0-9_]{5,20}$' and username !~ '^user_[0-9a-f]{8}$')
      or username ~ '^user_[0-9a-f]{8}$'
      or (username ~ '^[a-z0-9]+(-[a-z0-9]+)*-ai$' and char_length(username) <= 32)
  ))                                                                      as bad_usernames_must_be_0,
  (select count(*) from (
      select lower(username) from public.profiles group by 1 having count(*) > 1
  ) d)                                                                    as ci_dupes_must_be_0;
```

All three must be `0`. `leagues` non-zero aborts `040`'s roster-settings
default swap by design.

---

## Step 1 — relabel the two stray rows

```sql
begin;
update supabase_migrations.schema_migrations
   set version = '037', name = 'explicit_api_grants'
 where version = '20260805230305';
update supabase_migrations.schema_migrations
   set version = '075', name = 'handle_new_user_stores_no_name'
 where version = '20260805222646';
commit;
```

**Verify** — must return `0`:

```sql
select count(*) from supabase_migrations.schema_migrations
 where version !~ '^[0-9]{3}$';
```

**Rollback:** invert the two updates. Metadata only; no schema touched.

---

## Step 2 — push the gap

```bash
npx supabase db push --include-all
```

Applies `038`, `039`, `040`, `048`–`072`, `076`. `--include-all` is required
because `073`–`075` are recorded ahead of the gap and the CLI refuses
out-of-order migrations by default.

Expect a couple of minutes; the draft migrations are large.

**If it fails partway:** each migration is atomic and recorded only on success,
so the chain is consistent and resumable — fix the cause and re-run the same
command. Do not hand-apply the remainder.

**If it fails *after* `049` but *before* `076`:** production is writing names
again. Apply `076` immediately, then continue at step 4.

---

## Step 3 — verify the trigger

```sql
select coalesce(proconfig::text,'NONE')            as search_path,
       prosrc like '%{5,20}%'                      as guard_049,
       prosrc like '%user_[0-9a-f]{8}%'            as guard_050,
       prosrc like '%display_name%'                as writes_name
  from pg_proc where proname = 'handle_new_user';
```

Required: `{"search_path=\"\""}` · `t` · `t` · **`f`**

`writes_name = t` means `076` did not land. Stop and apply it before going on.

---

## Step 4 — clear names written during the push window

Between `049` and `076` the trigger writes `display_name`. With no OAuth
configured the value is the user's own username, not a real name — but it
breaks the "zero profiles hold a name" guarantee.

```sql
update public.profiles set display_name = null where display_name is not null;
```

---

## Step 5 — acceptance

```sql
select
  (select count(*) from supabase_migrations.schema_migrations)              as migrations_expect_67,
  (select count(*) from supabase_migrations.schema_migrations
     where version !~ '^[0-9]{3}$')                                         as stray_labels_expect_0,
  (select count(*) from pg_tables where schemaname='public')                as tables_expect_52,
  (select count(*) from pg_policies where schemaname='public')              as policies_expect_78,
  (select count(*) from public.players)                                     as players_expect_3254,
  (select count(*) from public.lists)                                       as lists_expect_65,
  (select count(*) from public.profiles where display_name is not null)     as named_profiles_expect_0,
  (select count(*) from auth.users au
     left join public.profiles p on p.id = au.id where p.id is null)        as orphan_users_expect_0;
```

Counts for `players` / `lists` are the 2026-08-05 values — they only ever grow,
so treat a *decrease* as the failure signal, not an exact mismatch.

Cron jobs — expect `draft-tick @ 5 seconds` and `mock-expiry @ 0 3 * * *`:

```sql
select jobname, schedule, active from cron.job order by jobname;
```

To switch the ticker off without reverting anything:

```sql
select cron.unschedule('draft-tick');
```

---

## After this lands

- `npx supabase db push` works normally again. **Stop hand-applying migrations
  through the database API** — every out-of-band apply re-opens this gap.
- Dropping `display_name` is now unblocked, with two constraints: it must come
  **after** this push (seven migrations here still write the column), and the
  drop must be the **last** migration numerically so a fresh `db reset` replays
  cleanly. **Done — migration `077_drop_profiles_display_name.sql`** (2026-08-07,
  spec v2.9.1 / PROGRESS D116). It re-points the five functions that read the
  column *before* dropping it: Postgres records no dependency from a function
  body to a column, so the drop would not have blocked and they would have
  broken at runtime instead. 077 must stay the highest number.
- PR #91 can be closed — `076` supersedes its guard restore.
- A `CREATE OR REPLACE FUNCTION` hotfix must be authored against the current
  head of the chain, not against the body that happens to be deployed. `073` is
  the counter-example that caused all of this.

---

## Rehearsal evidence

Rehearsed in isolated local databases (the dev database is owned by another
session and was not touched):

- All 29 migrations apply clean on a prod-shaped database seeded with
  production's real usernames; all 6 profiles survive unchanged.
- Post-push vs a fresh reset: columns and policies md5-identical.
- `075` → `076` in sequence yields `search_path=''`, both guards present,
  `display_name` not written.
- Signup smoke test through the final definition: plain signup and hostile
  `evil-ai` + `full_name` metadata both yield a fallback username and a NULL
  name.
