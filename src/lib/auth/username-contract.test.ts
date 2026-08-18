import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  isPlaceholderUsername,
  PLACEHOLDER_USERNAME_REGEX,
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
