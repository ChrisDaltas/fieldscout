import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The identity contract (Chris's ruling, 2026-08-05, verbatim):
 *
 *   "we don't need either a display name or a full name. we just need the
 *    email, password and unique username."
 *
 * So FieldScout stores NO name for a person. An account is an email, a
 * password and a permanent username, and every surface renders `@username`.
 * There is no private name field either — `profiles` is world-readable
 * ("Profiles are viewable by everyone" USING (true) + anon SELECT), so a
 * column called "private" would not have been.
 *
 * The rule spans ~20 files, so it is pinned at the source level (the
 * `launch-scope-gates` precedent): a component that starts rendering a
 * person's name, or a query that starts selecting one, fails here.
 *
 * Two unrelated columns share these names and are explicitly in bounds:
 *   · `players.full_name`      — an NFL player's name, used all over.
 *   · `ai_personas.display_name` — a fictional analyst's PUBLIC parody brand
 *     name ("Bathew Merry (AI)"). No human behind it, nothing to leak.
 * That is why the sweeps key on a name token appearing in a PROFILE context,
 * never on the bare string.
 */

const SRC = path.join(process.cwd(), 'src')

/**
 * Generated Supabase types. Excluded from the sweeps: they declare every
 * column the database has, including `ai_personas.display_name` and the dead
 * `expert_profiles` legacy table. `profiles.display_name` is no longer among
 * them — migration 077 dropped the column, and the type file was hand-edited
 * to match (see the `migration 077` describe below, which pins that).
 */
const GENERATED_TYPES = 'src/types/database.ts'

/** This file quotes the retired names on purpose — it is the guard. */
const SELF = 'src/lib/identity-render.test.ts'

const NAME_COLUMN = /\bdisplay_name\b|\bdisplayName\b|\bfull_name\b|\bfullName\b/
const PROFILE_TOKEN = /\bprofiles?\b|\bProfiles?\b/
const PERSONA_TOKEN = /persona/i

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry) ? [full] : []
  })
}

function repoRelative(file: string): string {
  return path.relative(process.cwd(), file)
}

/** Source lines with comments and JSDoc dropped — prose is not behaviour. */
function codeLines(file: string): { line: number; text: string }[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((text, i) => ({ line: i + 1, text: text.trim() }))
    .filter(({ text }) => !/^(\/\/|\/\*|\*)/.test(text))
}

const FILES = sourceFiles(SRC).filter((f) => {
  const rel = repoRelative(f)
  return rel !== SELF && rel !== GENERATED_TYPES
})

const SETTINGS_PAGE = 'src/app/app/settings/page.tsx'

describe('identity contract — a person has no name, only a handle', () => {
  it('collects a non-trivial source tree (the sweeps below are not vacuous)', () => {
    expect(FILES.length).toBeGreaterThan(100)
  })

  it('no code reads or writes a name on a profile', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      for (const { line, text } of codeLines(file)) {
        // React's own `Component.displayName = '…'` is unrelated plumbing.
        if (/\.displayName\b/.test(text)) continue
        if (!NAME_COLUMN.test(text)) continue
        // An AI persona's public brand name is a different column.
        if (PERSONA_TOKEN.test(text)) continue
        if (PROFILE_TOKEN.test(text)) {
          offenders.push(`${repoRelative(file)}:${line} — ${text}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('no PostgREST select pulls a name out of profiles', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      const code = codeLines(file)
        .map(({ text }) => text)
        .join('\n')
      // `.from('profiles').select('… display_name …')` and the embedded
      // `owner:profiles!fk(… full_name …)` join form. The character class
      // stops at the closing paren/quote, so a persona embed on a later line
      // of the same select string cannot be mistaken for a profile column.
      if (/profiles[^)'"`]*(\bdisplay_name\b|\bfull_name\b)/.test(code)) {
        offenders.push(repoRelative(file))
      }
    }
    expect(offenders).toEqual([])
  })

  it('account settings offers no name field at all', () => {
    const settings = readFileSync(path.join(process.cwd(), SETTINGS_PAGE), 'utf8')
    expect(settings).not.toMatch(/display_name|full_name|displayName|fullName/)
    expect(settings).not.toMatch(/Display name|Full name|Your name/)
    // What it does keep: the permanent handle, read-only.
    expect(settings).toContain('id="settings-username"')
    expect(settings).toMatch(/id="settings-username"[\s\S]{0,200}readOnly/)
  })

  it('the username-selection page writes the handle and nothing else', () => {
    const page = readFileSync(
      path.join(process.cwd(), 'src/app/(auth)/username/page.tsx'),
      'utf8',
    )
    expect(page).not.toMatch(/display_name|full_name/)
  })

  it('no seed or dev script plants a name on a profile', () => {
    for (const rel of [
      'supabase/seed.sql',
      'scripts/seed-dev-user.ts',
      'scripts/seed-ai-personas.ts',
    ]) {
      const text = readFileSync(path.join(process.cwd(), rel), 'utf8')
      const profileWrites = text
        .split('\n')
        .filter((l) => !/^\s*(--|\/\/|\*)/.test(l))
        .filter((l) => PROFILE_TOKEN.test(l) && NAME_COLUMN.test(l))
        .filter((l) => !PERSONA_TOKEN.test(l))
      expect(profileWrites, `${rel} still writes a profile name`).toEqual([])
    }
  })
})

describe('migration 075', () => {
  const migration = readFileSync(
    path.join(
      process.cwd(),
      'supabase/migrations/075_handle_new_user_stores_no_name.sql',
    ),
    'utf8',
  )

  it('stops handle_new_user writing a name', () => {
    expect(migration).toContain(
      'INSERT INTO public.profiles (id, username, avatar_url)',
    )
    // The OAuth real-name claim must not be read anywhere in the new body.
    expect(migration).not.toMatch(/raw_user_meta_data->>'full_name'/)
  })

  it('makes no schema change — that is what makes the deploy order-safe', () => {
    expect(migration).not.toMatch(/ALTER TABLE/i)
    expect(migration).not.toMatch(/DROP\s+COLUMN/i)
    expect(migration).not.toMatch(/ADD\s+COLUMN/i)
    expect(migration).not.toMatch(/RENAME\s+COLUMN/i)
  })

  it('clears the names already stored, and only on profiles', () => {
    expect(migration).toMatch(
      /UPDATE public\.profiles\s*\n\s*SET display_name = NULL\s*\n\s*WHERE display_name IS NOT NULL;/,
    )
    // ai_personas.display_name is NOT NULL public brand copy — never touched.
    expect(migration).not.toMatch(/UPDATE public\.ai_personas/i)
    expect(migration).not.toMatch(/ALTER TABLE public\.ai_personas/i)
  })

  it('leaves RLS alone', () => {
    expect(migration).not.toMatch(
      /CREATE POLICY|DROP POLICY|ALTER POLICY|ROW LEVEL SECURITY/i,
    )
  })
})

describe('migration 077 — the column is dropped', () => {
  const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase/migrations')
  const FILE = '077_drop_profiles_display_name.sql'
  const migration = readFileSync(path.join(MIGRATIONS_DIR, FILE), 'utf8')

  /** The five functions that read the column through a COALESCE onto username. */
  const REPOINTED = [
    'notify_list_followers',
    'create_league',
    'seat_league_member_internal',
    'get_join_preview',
    'draft_actor_name',
  ] as const

  it('is the HIGHEST-numbered migration — a fresh reset replays cleanly only if it is last', () => {
    const numbers = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .map((f) => Number(f.slice(0, 3)))
    expect(Math.max(...numbers)).toBe(77)
    // And nothing else claims 077.
    expect(numbers.filter((n) => n === 77)).toHaveLength(1)
  })

  it('drops the column, guarded and idempotent', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.profiles DROP COLUMN IF EXISTS display_name;/,
    )
    // The tripwire: never destroy a value that somehow exists.
    expect(migration).toMatch(/RAISE EXCEPTION[\s\S]{0,200}refusing to drop/i)
  })

  it('re-points every reader BEFORE the drop — Postgres tracks no body dependency, so these would break at runtime', () => {
    const dropAt = migration.search(/ALTER TABLE public\.profiles DROP COLUMN/)
    expect(dropAt).toBeGreaterThan(0)
    for (const fn of REPOINTED) {
      const replaceAt = migration.indexOf(
        `CREATE OR REPLACE FUNCTION public.${fn}`,
      )
      expect(replaceAt, `${fn} is not replaced in 077`).toBeGreaterThan(-1)
      expect(replaceAt, `${fn} is replaced AFTER the drop`).toBeLessThan(dropAt)
    }
  })

  it('leaves no display_name read in any replaced body', () => {
    // Comments quote the old expression on purpose; code must not.
    const code = migration
      .split('\n')
      .filter((l) => !/^\s*--/.test(l))
      .join('\n')
    expect(code).not.toMatch(/COALESCE\([^)]*display_name/i)
    expect(code).not.toMatch(/NULLIF\(\s*p?\.?display_name/i)
    // The only surviving mentions in code are the drop and its guard.
    const mentions = code.split('\n').filter((l) => /display_name/.test(l))
    for (const line of mentions) {
      expect(line).toMatch(
        // the drop · the guard's catalog lookup · the guard's count · the
        // guard's own refusal message
        /DROP COLUMN IF EXISTS|column_name|WHERE display_name IS NOT NULL|still hold a display_name/,
      )
    }
  })

  it('changes no signature, no security context and no search_path pin', () => {
    // SECURITY DEFINER is kept on exactly the three that had it, and the two
    // INVOKER functions are not silently promoted.
    expect(migration).toMatch(
      /public\.notify_list_followers[\s\S]{0,200}SECURITY DEFINER/,
    )
    expect(migration).toMatch(/public\.create_league\([\s\S]{0,900}SECURITY DEFINER/)
    expect(migration).toMatch(/public\.get_join_preview[\s\S]{0,200}SECURITY DEFINER/)
    // draft_actor_name and seat_league_member_internal stay INVOKER: no
    // SECURITY DEFINER between their CREATE line and their body opener.
    for (const fn of ['draft_actor_name', 'seat_league_member_internal']) {
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`)
      const header = migration.slice(start, migration.indexOf('AS $$', start))
      expect(header, `${fn} gained SECURITY DEFINER`).not.toMatch(/SECURITY DEFINER/)
    }
    // notify_list_followers keeps its legacy-app search_path; the other four
    // keep the spec form. Losing either is how unqualified identifiers break.
    expect(migration).toMatch(/SET search_path = public, pg_temp/)
    expect(migration.match(/SET search_path = ''/g) ?? []).toHaveLength(4)
  })

  it('does not touch the unrelated display_name columns', () => {
    expect(migration).not.toMatch(/ALTER TABLE public\.ai_personas/i)
    expect(migration).not.toMatch(/ALTER TABLE public\.expert_profiles/i)
    expect(migration).not.toMatch(/UPDATE public\.ai_personas/i)
  })

  it('touches no RLS and re-grants nothing (CREATE OR REPLACE preserves the ACL)', () => {
    expect(migration).not.toMatch(
      /CREATE POLICY|DROP POLICY|ALTER POLICY|ROW LEVEL SECURITY/i,
    )
    // 038's REVOKE must survive by being left alone, not re-issued.
    expect(migration).not.toMatch(/^\s*GRANT /im)
    expect(migration).not.toMatch(/^\s*REVOKE /im)
  })
})

describe('the generated types match the post-077 schema', () => {
  const types = readFileSync(path.join(process.cwd(), GENERATED_TYPES), 'utf8')

  /** The `profiles:` table block, up to the next sibling table. */
  const profilesBlock = (() => {
    const start = types.indexOf('\n      profiles: {')
    expect(start).toBeGreaterThan(-1)
    const next = types.indexOf('\n      Relationships', start)
    return types.slice(start, next > -1 ? next : start + 4000)
  })()

  it('profiles Row/Insert/Update no longer declare a name', () => {
    expect(profilesBlock).not.toMatch(/display_name/)
    expect(profilesBlock).not.toMatch(/full_name/)
    // Non-vacuity: we sliced the right block.
    expect(profilesBlock).toMatch(/username: string/)
    expect(profilesBlock).toMatch(/cred_score\?: number \| null/)
  })

  it('keeps the unrelated columns — an over-broad edit would take these too', () => {
    expect(types).toMatch(/ai_personas: \{[\s\S]{0,2000}display_name: string/)
    expect(types).toMatch(/expert_profiles: \{[\s\S]{0,2000}display_name: string/)
  })

  it('keeps the hand-written alias block that a naive typegen clobbers', () => {
    expect(types).toContain('// Hand-written convenience aliases.')
    expect(types).toMatch(
      /export type Profile = Database\['public'\]\['Tables'\]\['profiles'\]\['Row'\]/,
    )
  })
})
