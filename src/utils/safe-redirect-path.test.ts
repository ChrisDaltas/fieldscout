import { describe, expect, it } from 'vitest'

import { DEFAULT_POST_SIGN_IN_PATH, safeRedirectPath } from './safe-redirect-path'

/**
 * Each value is what the consumer actually receives: `URLSearchParams.get`
 * has already percent-decoded once, so `?next=%2F%2Fevil` arrives as
 * `//evil`. The `raw` cases also cover a value that was encoded twice.
 */
describe('safeRedirectPath', () => {
  it.each([
    ['/app', '/app'],
    ['/app/leagues/abc', '/app/leagues/abc'],
    ['/join/tok_123', '/join/tok_123'],
    ['/reset-password', '/reset-password'],
    ['/username', '/username'],
    ['/app/lists?view=grid#top', '/app/lists?view=grid#top'],
    ['/app/../app/lists', '/app/lists'],
  ])('accepts the same-origin path %s', (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['javascript: scheme', 'javascript:alert(1)'],
    ['javascript: scheme, mixed case', 'JaVaScRiPt:alert(1)'],
    ['data: scheme', 'data:text/html,hi'],
    ['absolute https URL', 'https://evil.example'],
    ['absolute http URL', 'http://evil.example/app'],
    ['protocol-relative', '//evil.example'],
    ['protocol-relative, three slashes', '///evil.example'],
    ['slash-backslash', '/\\evil.example'],
    ['backslash-slash', '\\/evil.example'],
    ['backslash anywhere', '/app\\..\\evil'],
    ['decoded %2f%2fevil', decodeURIComponent('%2f%2fevil.example')],
    ['still-encoded %2f%2fevil (double-encoded input)', '%2f%2fevil.example'],
    ['encoded tab before a second slash', decodeURIComponent('/%09/evil.example')],
    ['encoded newline before a second slash', decodeURIComponent('/%0a/evil.example')],
    ['encoded carriage return', decodeURIComponent('/%0d/evil.example')],
    ['NUL byte', '/app\u0000'],
    ['DEL character', '/app\u007f'],
    ['relative path without a slash', 'app'],
    ['userinfo trick', '@evil.example'],
    ['dot-relative', './evil'],
    ['overlong', '/' + 'a'.repeat(3000)],
  ])('rejects %s', (_label, input) => {
    expect(safeRedirectPath(input)).toBe(DEFAULT_POST_SIGN_IN_PATH)
  })

  it('uses the caller-supplied fallback', () => {
    expect(safeRedirectPath('//evil.example', '/login')).toBe('/login')
    expect(safeRedirectPath(null, '/login')).toBe('/login')
  })

  it('falls back to /app by default', () => {
    expect(DEFAULT_POST_SIGN_IN_PATH).toBe('/app')
  })

  it('never returns anything but a single-slash path', () => {
    const inputs = ['/x', '//x', '/\\x', 'https://x', 'javascript:x', '/%2f/x', '/%5cx']
    for (const input of inputs) {
      const out = safeRedirectPath(input)
      expect(out.startsWith('/')).toBe(true)
      expect(out.startsWith('//')).toBe(false)
      expect(out.includes('\\')).toBe(false)
    }
  })
})
