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
 * column the database has, including `profiles.display_name` (retired but not
 * dropped — migration 075 deliberately leaves the column in place so the
 * deploy is order-safe) and the dead `expert_profiles` legacy table.
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
