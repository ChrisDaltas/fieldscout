# Runbook: taking something down from Community

> Community launch plan C10 (readiness S3). Reports arrive in **Admin ›
> Reports**; this page says how to take down each kind of thing people
> post. It has **not been rehearsed**. Walk it once on the Preview (switch-on
> step 4) before you need it.

## When to use this

Someone reported something on Community (the bell says **New reports to
review**), or you saw something that has to come down: a list, its tags,
cover, links or comments, a person's bio or profile picture, or an AI
expert's board.

## Start from the report

1. On desktop, open **Admin › Reports** (`/app/admin/reports`). The phone has
   no Admin screen. Each report shows what was reported, who wrote it, who
   reported it, the reason, the note and when.
2. **Open** takes you to the list inside the app (a reported comment opens
   its list). Read it before you act. Not everything reported needs taking
   down.
3. Decide, then do **one** of the steps below.
4. Back in Admin › Reports, press **Mark reviewed** on every report you dealt
   with, including ones you decided to leave up. The review stamp (who and
   when) is the only record of a takedown done by hand. The database
   writes it once and never changes it.

## What you need

- **Admin › Reports**: Mark reviewed, and Remove for a comment.
- The **Supabase dashboard** for the hosted project, signed in as yourself:
  the **Table editor**, the **SQL editor** and **Storage**. SQL run there runs
  as the database owner. It skips the app's permission rules, so only change
  the one row you mean to.
- **The ids.** A list's id is the end of its in-app address
  (`/app/explore?list=<list-id>`). A person's id is in `profiles`: find the
  row by `username`.

## Rules that always hold

- **Never hard-delete a list.** Lists, teams and rankings are soft-deleted:
  set `deleted_at` (CLAUDE.md, business rule 8).
- **Never delete an account to remove content.** Deleting an account
  deletes everything it owns, including any league it created.
- Take down the **smallest thing** that fixes the problem. If a list is fine
  apart from one comment, remove the comment.
- Nothing here tells the person. If you want them to know, message them
  yourself.

## Steps, by what was reported

### A comment

**Use Admin › Reports → Remove comment.** It asks first. It removes the
comment for everyone and marks every open report on that comment reviewed by
you. It also writes the operator log (**Admin › Log**, "Removed a comment").

Only if Admin is unavailable, do it by hand in the SQL editor:

```sql
update public.list_comments
   set deleted_at = now(), updated_at = now()
 where id = '<comment-id>' and deleted_at is null;
```

Expect `UPDATE 1`. `UPDATE 0` means it was already removed or the id is
wrong. Then **Mark reviewed** in Admin › Reports. A hand removal writes no
operator log row.

### Every comment on one list

Turn the list's comments off. The thread is then hidden from everyone but the
list's owner, and nobody can add new comments.

```sql
update public.lists set comments_enabled = false where id = '<list-id>';
```

### A whole list (title, description or players)

Pick one:

- **Hide it, keep it for its owner:** make it private. It leaves Community and
  its share link stops working for everyone else. The owner can make it
  public again, so use this for a first, mild case.

  ```sql
  update public.lists set is_private = true where id = '<list-id>';
  ```

- **Take it down:** soft-delete it. It leaves Community, its share link, and
  the owner's Lists.

  ```sql
  update public.lists set deleted_at = now() where id = '<list-id>' and deleted_at is null;
  ```

  > A soft-deleted list goes to its owner's **Trash**, and Trash has
  > Restore. Nothing stops them putting it back. If they do, it shows up as
  > new reports or you'll see it again. Then talk to them, and soft-delete it
  > again.

### A list's cover picture

Clear the cover, then delete the file.

```sql
update public.lists set thumbnail_url = null where id = '<list-id>';
```

In **Storage → `list-thumbnails` → the folder named by the list's id**,
delete the picture.

### A list's video or article link

Links are rows in `list_links`, one per link. Delete the one row, which is
what the owner's own Remove does:

```sql
delete from public.list_links where id = '<link-id>';
```

Find `<link-id>` with `select id, url, title from public.list_links where list_id = '<list-id>';`.

### A tag

A tag's name is shared by every list that uses it. Take it off every list,
then delete the tag itself:

```sql
delete from public.list_tags where tag_id = (select id from public.tags where name = '<tag name>');
delete from public.tags where name = '<tag name>';
```

If the same person keeps adding it back, deal with their lists as above.

### A person's bio

```sql
update public.profiles set bio = null where id = '<person-id>';
```

### A person's profile picture

Clear it, then delete the file:

```sql
update public.profiles set avatar_url = null where id = '<person-id>';
```

In **Storage → `user-avatars` → the folder named by the person's id**,
delete the picture.

### A username

There is no takedown step for a username. A handle is also the address of
the person's profile and every link to it, so renaming one by hand breaks
those links. Brand and staff look-alikes (fieldscout, admin, support,
moderator and so on) are already refused for new handles (migration 215).
For anything else, take down what they posted and decide about the account
separately.

### An AI expert's board

AI expert boards belong to the FieldScout AI account, so nobody can remove
them from the app.

- **One board:** soft-delete it, as for a whole list above.
  > The persona seed script rebuilds a board it can't find. Running it
  > again would make a new copy and spend AI calls. Don't re-run it for this.
- **The whole expert:** switch the expert off. Its boards lose their "made by
  FieldScout AI as …" line and the seed script leaves it alone from then on.
  Soft-delete its boards too if they should leave Community.

  ```sql
  update public.ai_personas set is_active = false where username = '<expert-username>';
  ```

Comments on an expert's board are handled like any comment: **Remove
comment** in Admin › Reports.

## After

- Every report you dealt with is **Mark reviewed** in Admin › Reports.
- Check the result while signed in as yourself: the thing is gone from
  Community on phone and desktop.
- Test reports made on the Preview are real rows if the Preview uses the
  production database (switch-on step 3). Mark them reviewed when the walk
  is done.
