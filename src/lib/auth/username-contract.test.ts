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
    expect(validateUsername('kina_mimes_ai')).toBe('This username is reserved')
    // The character rules still come first — their message is the useful one.
    expect(validateUsername('admin!')).toMatch(/letters, numbers/)
  })
})

/*
 * Brand and staff handles (migration 215, readiness S19). The database's
 * `username_is_reserved_internal` is the rule; this mirror is what the form
 * shows first. The cases below are pgTAP 165's §R, so both sides are held to
 * the same examples.
 */
describe('reserved brand and staff handles', () => {
  it('the brand anywhere, underscores out, look-alike digits read as letters (pgTAP 165 R1)', () => {
    for (const name of ['fieldscout', 'field_scout', 'fieldsc0ut', 'fie1dscout', 'f1eldscout', 'fi3ldscout',
      'the_fieldscout', 'fieldscout_gg', 'fieldscout_support', 'myfieldscout']) {
      expect(isReservedUsername(name), name).toBe(true)
    }
  })

  it('every staff / system word on its own (R2)', () => {
    for (const name of ['admin', 'admins', 'administrator', 'sysadmin', 'root1', 'system', 'support', 'help1',
      'helpdesk', 'moderator', 'moderators', 'mod12', 'mods1', 'staff', 'official', 'team1', 'security', 'abuse',
      'legal', 'privacy', 'billing', 'api12', 'www12', 'noreply', 'webmaster', 'postmaster']) {
      expect(isReservedUsername(name), name).toBe(true)
    }
  })

  it('with fs / the / official in front, team / hq / desk / official behind, numbers, look-alikes, any case (R3)', () => {
    for (const name of ['fs_admin', 'fsadmin', 'the_admin', 'official_mods', 'support_team', 'admin_hq', 'help_desk',
      'staff_official', 'moderator_01', 'admin2026', 'adm1n', '5upport', 'm0ds1', 'ADMIN']) {
      expect(isReservedUsername(name), name).toBe(true)
    }
  })

  it('the AI-account shape written with underscores (R4)', () => {
    for (const name of ['kina_mimes_ai', 'scout_ai', 'x_y_ai']) expect(isReservedUsername(name), name).toBe(true)
  })

  it('ordinary handles are not reserved (R5)', () => {
    for (const name of ['chris_d', 'joetheman', 'seed_owner', 'dev_user', 'devpro', 'adminbob', 'admin_bob',
      'teamtacos', 'team_tacos', 'helper', 'modern', 'apiary', 'rooted', 'systemic', 'legally', 'official_bob',
      'mods_r_us', 'scout_master', 'field_day', 'scouting', 'aimee', 'ai_fan', 'chai_lover', 'zz_ai_zz',
      'user_deadbeef', 'user_2c6f328e', '']) {
      expect(isReservedUsername(name), name).toBe(false)
    }
  })

  it('the word lists are migration 215\'s, exactly — the form and the database cannot drift', () => {
    const sql = read('supabase/migrations/215_reserved_handles_and_avatar_sources.sql')
    const list = (label: string) => {
      const m = sql.match(new RegExp(`ARRAY\\[([^\\]]*)\\]::text\\[\\] AS ${label}`))
      expect(m, label).not.toBeNull()
      return [...m![1].matchAll(/'([^']*)'/g)].map((x) => x[1])
    }
    expect(sql.match(/'([a-z]+)'::text AS brand/)?.[1]).toBe(RESERVED_USERNAME_BRAND)
    expect(list('words')).toEqual([...RESERVED_USERNAME_WORDS])
    expect(list('before')).toEqual([...RESERVED_USERNAME_BEFORE])
    expect(list('after')).toEqual([...RESERVED_USERNAME_AFTER])
    // The same look-alike readings on both sides.
    expect(sql).toContain("translate(h.flat, '013457', 'oieast')")
    expect(sql).toContain("translate(h.flat, '013457', 'oleast')")
    expect(sql).toContain("r.raw ~ '_ai$'")
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
