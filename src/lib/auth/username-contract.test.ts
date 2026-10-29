import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  isPlaceholderUsername,
  isReservedUsername,
  PLACEHOLDER_USERNAME_REGEX,
  RESERVED_USERNAME_AFTER,
  RESERVED_USERNAME_BEFORE,
  RESERVED_USERNAME_BRAND,
  RESERVED_USERNAME_LETTERS,
  RESERVED_USERNAME_PATTERNS,
  RESERVED_USERNAME_SHAPES,
  RESERVED_USERNAME_WORDS,
  USERNAME_REGEX,
  validateUsername,
} from './username-contract'

/**
 * A username is permanent and is the public identity — /u/{username}/lists/{slug}
 * share links are built from it. On 2026-08-05 two production accounts reached
 * the app still holding their generated user_xxxxxxxx handle: the email-confirm
 * callback failed to establish a session, the user signed in with a password
 * instead, and a normal login went straight to /app. Nobody ever asked them.
 */

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), 'utf8')

describe('placeholder detection', () => {
  it('recognises the generated handle', () => {
    expect(isPlaceholderUsername('user_2c6f328e')).toBe(true)
    expect(isPlaceholderUsername('user_00000000')).toBe(true)
  })

  it('treats a missing username as unchosen', () => {
    expect(isPlaceholderUsername(null)).toBe(true)
    expect(isPlaceholderUsername(undefined)).toBe(true)
    expect(isPlaceholderUsername('')).toBe(true)
  })

  it('does NOT trap a real name that merely starts with user_', () => {
    // The auth callback used startsWith('user_'), which would bounce these
    // accounts back to selection forever — they are valid, chosen names.
    expect(isPlaceholderUsername('user_bob')).toBe(false)
    expect(isPlaceholderUsername('user_zzzzzzzz')).toBe(false) // not hex
    expect(isPlaceholderUsername('user_2c6f328')).toBe(false) // 7 chars
    expect(isPlaceholderUsername('user_2c6f328ee')).toBe(false) // 9 chars
    expect(PLACEHOLDER_USERNAME_REGEX.test('xuser_2c6f328e')).toBe(false)
  })

  it('accepts chosen names generally', () => {
    for (const name of ['chris', 'joetheman', 'Dave_99']) {
      expect(isPlaceholderUsername(name)).toBe(false)
      expect(USERNAME_REGEX.test(name)).toBe(true)
    }
  })
})

describe('validateUsername', () => {
  it('accepts a normal handle', () => {
    expect(validateUsername('joetheman')).toBeNull()
  })

  it('enforces the length bounds', () => {
    expect(validateUsername('abcd')).toMatch(/at least 5/)
    expect(validateUsername('a'.repeat(21))).toMatch(/20 characters or fewer/)
    expect(validateUsername('abcde')).toBeNull()
    expect(validateUsername('a'.repeat(20))).toBeNull()
  })

  it('rejects characters that would break a URL path', () => {
    expect(validateUsername('joe theman')).toMatch(/letters, numbers/)
    expect(validateUsername('joe/theman')).toMatch(/letters, numbers/)
    expect(validateUsername('joe.theman')).toMatch(/letters, numbers/)
  })

  it('refuses the reserved placeholder shape, case-insensitively', () => {
    expect(validateUsername('user_2c6f328e')).toMatch(/reserved/)
    expect(validateUsername('USER_2C6F328E')).toMatch(/reserved/)
  })

  it('refuses brand and staff handles before anyone presses Continue (migration 215)', () => {
    expect(validateUsername('fieldscout')).toBe('This username is reserved')
    expect(validateUsername('Support_Team')).toBe('This username is reserved')
    expect(validateUsername('lega1')).toBe('This username is reserved')
    expect(validateUsername('f1e1dscout')).toBe('This username is reserved')
    // Names ending "_ai" are ordinary names (mei_ai); the AI accounts' shape
    // is the hyphen one, which a person's handle can't hold anyway.
    expect(validateUsername('mei_ai')).toBeNull()
    // The character rules still come first — their message is the useful one.
    expect(validateUsername('admin!')).toMatch(/letters, numbers/)
  })
})

/*
 * Brand and staff handles (migration 215, readiness S19). The database's
 * `username_is_reserved_internal` is the rule; this mirror is what the form
 * shows first. The examples are NOT copied here: they are read out of pgTAP
 * 165's §R (the arrays tagged "cases:reserved" / "cases:not-reserved"), which
 * the database is held to, so the form is held to exactly the same ones.
 */
const PGTAP = read('supabase/tests/165_reserved_handles_and_avatar_sources.sql')
const MIGRATION = read('supabase/migrations/215_reserved_handles_and_avatar_sources.sql')

function pgtapCases(tag: 'reserved' | 'not-reserved'): string[] {
  const blocks = [...PGTAP.matchAll(new RegExp(`unnest\\(array\\[ -- cases:${tag}\\n([\\s\\S]*?)\\]\\)`, 'g'))]
  return blocks.flatMap((b) => [...b[1].matchAll(/'([^']*)'/g)].map((x) => x[1]))
}

describe('reserved brand and staff handles', () => {
  const reserved = pgtapCases('reserved')
  const notReserved = pgtapCases('not-reserved')

  it('reads the shared examples out of pgTAP 165 (R1–R5)', () => {
    // Four reserved arrays (R1–R4) and one not-reserved array (R5); a
    // renamed tag or a reshaped array must fail here, not silently test
    // nothing.
    expect(PGTAP.match(/-- cases:reserved\n/g)).toHaveLength(4)
    expect(PGTAP.match(/-- cases:not-reserved\n/g)).toHaveLength(1)
    expect(reserved.length).toBeGreaterThan(60)
    expect(notReserved.length).toBeGreaterThan(25)
    // The look-alikes a review found getting through the first form.
    for (const name of ['suppor7', 'lega1', 'officia1', 'f1e1dscout', 'f1e1dsc0ut_hq', 'b1111ng', 'adrnin', 'rnoderator', 'fielclscout']) {
      expect(reserved).toContain(name)
    }
  })

  it('every example the database reserves, the form reserves', () => {
    for (const name of reserved) expect(isReservedUsername(name), name).toBe(true)
  })

  it('every example the database leaves open, the form leaves open', () => {
    for (const name of [...notReserved, '']) expect(isReservedUsername(name), name).toBe(false)
  })

  it('the lists are migration 215\'s, exactly — the form and the database cannot drift', () => {
    const list = (label: string) => {
      const m = MIGRATION.match(new RegExp(`ARRAY\\[([^\\]]*)\\]::text\\[\\] AS ${label}`))
      expect(m, label).not.toBeNull()
      return [...m![1].matchAll(/'([^']*)'/g)].map((x) => x[1])
    }
    expect(MIGRATION.match(/'([a-z]+)'::text AS brand/)?.[1]).toBe(RESERVED_USERNAME_BRAND)
    expect(list('words')).toEqual([...RESERVED_USERNAME_WORDS])
    expect(list('before')).toEqual([...RESERVED_USERNAME_BEFORE])
    expect(list('after')).toEqual([...RESERVED_USERNAME_AFTER])
    expect(list('letters')).toEqual([...RESERVED_USERNAME_LETTERS])
    // `shapes` holds "[" and "]" inside its items, so it is read up to its label.
    const shapes = MIGRATION.match(/ARRAY\[('\[o0\]'[\s\S]*?)\]::text\[\] AS shapes/)
    expect(shapes).not.toBeNull()
    expect([...shapes![1].matchAll(/'([^']*)'/g)].map((x) => x[1])).toEqual([...RESERVED_USERNAME_SHAPES])
    // The same assembly on both sides: brand anywhere, staff anchored with
    // optional affixes and a trailing number, on the handle with "_" removed.
    expect(MIGRATION).toContain("'^(' || max(a.alt) FILTER (WHERE a.kind = 'before') || ')?('")
    expect(MIGRATION).toContain("|| ')?[0-9]*$' AS staff")
    expect(MIGRATION).toContain("replace(lower(COALESCE(p_username, '')), '_', '') AS flat")
    expect(MIGRATION).toContain('SELECT h.flat ~ p.brand OR h.flat ~ p.staff')
  })

  it('builds the very patterns the database builds (copied from the local database, 2026-10-29)', () => {
    expect(RESERVED_USERNAME_PATTERNS.brand).toBe('f[il1][e3][il1](d|cl)[s5]c[o0]u[t7]')
    expect(RESERVED_USERNAME_PATTERNS.staff).toBe(
      '^(f[s5]|[t7]h[e3]|[o0]ff[il1]c[il1][a4][il1])?([a4](d|cl)(m|rn)[il1]n|[a4](d|cl)(m|rn)[il1]n[s5]|[a4](d|cl)(m|rn)[il1]n[il1][s5][t7]r[a4][t7][o0]r|[a4](d|cl)(m|rn)[il1]n[il1][s5][t7]r[a4][t7][o0]r[s5]|[s5]y[s5][a4](d|cl)(m|rn)[il1]n|r[o0][o0][t7]|[s5]y[s5][t7][e3](m|rn)|[s5]upp[o0]r[t7]|h[e3][il1]p|h[e3][il1]p(d|cl)[e3][s5]k|(m|rn)[o0](d|cl)[e3]r[a4][t7][o0]r|(m|rn)[o0](d|cl)[e3]r[a4][t7][o0]r[s5]|(m|rn)[o0](d|cl)|(m|rn)[o0](d|cl)[s5]|[s5][t7][a4]ff|[o0]ff[il1]c[il1][a4][il1]|[t7][e3][a4](m|rn)|[s5][e3]cur[il1][t7]y|[a4]bu[s5][e3]|[il1][e3]g[a4][il1]|pr[il1]v[a4]cy|b[il1][il1][il1][il1]ng|[a4]p[il1]|(w|vv)(w|vv)(w|vv)|n[o0]r[e3]p[il1]y|(w|vv)[e3]b(m|rn)[a4][s5][t7][e3]r|p[o0][s5][t7](m|rn)[a4][s5][t7][e3]r)([t7][e3][a4](m|rn)|hq|(d|cl)[e3][s5]k|[o0]ff[il1]c[il1][a4][il1])?[0-9]*$',
    )
  })
})

describe('the app forces selection before anything else', () => {
  it('the app shell redirects placeholder holders to /username', () => {
    const layout = read('src/app/app/layout.tsx')
    expect(layout).toContain('PLACEHOLDER_USERNAME_REGEX')
    expect(layout).toMatch(/redirect\('\/username'\)/)
  })

  it('the gate runs before anything under /app renders, not only in the auth callback', () => {
    // The callback bounces to /login whenever there is no code to exchange,
    // so it can never be the only place this is enforced.
    //
    // DR.1 moved <AppShell> out of this file into (shell)/layout.tsx, so the
    // old form of this pin — "the gate sits above <AppShell>" — no longer has
    // an <AppShell> to sit above. The property it was really defending is
    // that the gate runs before `children`: this layout renders NOTHING but
    // its children, and both redirects precede that return. Which groups
    // hang below it is pinned separately in route-groups.test.ts.
    const layout = read('src/app/app/layout.tsx')
    const gateIdx = layout.indexOf("redirect('/username')")
    const childrenIdx = layout.indexOf('{children}')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(childrenIdx).toBeGreaterThan(gateIdx) // gate runs before render
  })

  it('the selection page never treats a zero-row write as success', () => {
    const page = read('src/app/(auth)/username/page.tsx')
    const zeroRowBranch = page.slice(page.indexOf('(updated?.length ?? 0) === 0'))
    // It must re-read and only continue when a real name is actually present.
    expect(zeroRowBranch).toContain('.select(')
    expect(zeroRowBranch).toMatch(/setError\(/)
  })
})
