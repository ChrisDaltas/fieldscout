import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The identity-render contract (Chris's ruling, 2026-08-05).
 *
 *   The username is the only name FieldScout displays. `profiles.full_name`
 *   is PRIVATE: editable in account settings, rendered nowhere else. There is
 *   no "display name" concept — the username IS the displayed name, and we do
 *   not call it that.
 *
 * The rule spans ~20 files, so it is pinned at the source level (the
 * `launch-scope-gates` precedent): a component that starts rendering a real
 * name, or a query that starts selecting one, fails here.
 *
 * `players.full_name` is a different, unrelated column (an NFL player's name)
 * and is used all over — that is why the profile check keys on `full_name`
 * appearing alongside a profile/username token in the same statement rather
 * than on the bare string.
 */

const SRC = path.join(process.cwd(), 'src')

/** The ONE surface allowed to touch a person's private full name. */
const FULL_NAME_ALLOWLIST = ['src/app/app/settings/page.tsx']

/**
 * Generated Supabase types. Excluded from the `display_name` sweep because
 * the dead `expert_profiles` legacy table still carries a column by that
 * name; migration 075 deliberately left it alone (nothing reads that table).
 */
const GENERATED_TYPES = 'src/types/database.ts'

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

/** This file quotes the retired names on purpose — it is the guard. */
const SELF = 'src/lib/identity-render.test.ts'

const FILES = sourceFiles(SRC).filter((f) => repoRelative(f) !== SELF)

describe('identity render contract', () => {
  it('collects a non-trivial source tree (the sweeps below are not vacuous)', () => {
    expect(FILES.length).toBeGreaterThan(100)
  })

  it('the phrase "display name" survives nowhere in the code', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      const rel = repoRelative(file)
      if (rel === GENERATED_TYPES) continue
      for (const { line, text } of codeLines(file)) {
        // React's own `Component.displayName = '…'` is unrelated plumbing.
        if (/\.displayName\b/.test(text)) continue
        if (/\bdisplay_name\b|\bdisplayName\b/.test(text)) {
          offenders.push(`${rel}:${line} — ${text}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('only account settings reads a person’s private full name', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      const rel = repoRelative(file)
      if (rel === GENERATED_TYPES || FULL_NAME_ALLOWLIST.includes(rel)) continue
      for (const { line, text } of codeLines(file)) {
        // A profile-identity reference: `full_name` next to a profile or
        // username token. A bare `player.full_name` never matches.
        if (
          /\bfull_name\b/.test(text) &&
          /\bprofiles?\b|\bProfile\b|\busername\b/.test(text)
        ) {
          offenders.push(`${rel}:${line} — ${text}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('no PostgREST select pulls full_name out of profiles', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      // The generated types legitimately declare the column on the table.
      if (repoRelative(file) === GENERATED_TYPES) continue
      const code = codeLines(file)
        .map(({ text }) => text)
        .join('\n')
      // `.from('profiles').select('… full_name …')` and the embedded
      // `owner:profiles!fk(… full_name …)` join form.
      if (/profiles[^)'"`]*\bfull_name\b/.test(code)) {
        offenders.push(repoRelative(file))
      }
    }
    expect(offenders).toEqual([])
  })

  it('account settings keeps the field, labelled and marked private', () => {
    const settings = readFileSync(
      path.join(process.cwd(), FULL_NAME_ALLOWLIST[0]),
      'utf8',
    )
    expect(settings).toContain('full_name')
    expect(settings).toContain('Full name')
    expect(settings).toMatch(/Private — only you can see this/)
    // Still editable: it is a controlled input, not read-only display.
    expect(settings).toMatch(/onChange=\{\(e\) => setFullName\(e\.target\.value\)\}/)
    expect(settings).not.toMatch(/id="settings-full-name"[^>]*readOnly/)
  })
})

describe('migration 075', () => {
  const migration = readFileSync(
    path.join(process.cwd(), 'supabase/migrations/075_display_name_to_full_name.sql'),
    'utf8',
  )

  it('RENAMES the columns, so every existing value is preserved', () => {
    expect(migration).toContain(
      'ALTER TABLE public.profiles RENAME COLUMN display_name TO full_name',
    )
    expect(migration).toContain(
      'ALTER TABLE public.ai_personas RENAME COLUMN display_name TO persona_name',
    )
    // A DROP/ADD would silently discard every row's value.
    expect(migration).not.toMatch(/DROP\s+COLUMN/i)
    expect(migration).not.toMatch(/ADD\s+COLUMN/i)
  })

  it('is idempotent — re-running it is a no-op, never an error', () => {
    expect(migration).toMatch(/IF EXISTS \(\s*\n?\s*SELECT 1 FROM information_schema\.columns/)
    expect(migration).toContain('CREATE OR REPLACE FUNCTION')
  })

  it('keeps seeding the private full name from the OAuth full_name claim', () => {
    expect(migration).toContain('INSERT INTO public.profiles (id, username, full_name, avatar_url)')
    expect(migration).toContain("COALESCE(NEW.raw_user_meta_data->>'full_name', effective_username, 'New User')")
  })

  it('leaves RLS alone', () => {
    expect(migration).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY|ROW LEVEL SECURITY/i)
  })
})
