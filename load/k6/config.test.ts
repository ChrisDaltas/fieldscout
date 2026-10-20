import { describe, expect, it } from 'vitest'

import {
  CERTIFYING_PROFILES,
  LOAD_SEASON,
  PICK_TO_BROADCAST_P95_MS,
  SCORING_LAG_P95_MS,
  assertSafeTarget,
  derivedDenyNames,
  normalizeTarget,
  realtimeSocketUrl,
  resolveProfile,
  seatsPerDraft,
  sizeBanner,
  soakConnections,
} from './config'

describe('load profiles (TD1 / D570 — sizes are parameters, two certifying profiles)', () => {
  it('y2026 is the Q88 (a) 2026 size: 5 drafts, 25 leagues', () => {
    const p = resolveProfile('y2026')
    expect([p.drafts, p.leagues, p.clockSec, p.soakHours]).toEqual([5, 25, 60, 24])
    expect(p.replaySpeed).toEqual([1, 4])
    expect([p.bidsPerStorm, p.stormWindowMs]).toEqual([20, 2000])
  })

  it('ga is the printed §22.6 size: 50 drafts, 500 leagues, 60 s clocks, 1× and 4×, 24 h', () => {
    const p = resolveProfile('ga')
    expect([p.drafts, p.leagues, p.clockSec, p.soakHours]).toEqual([50, 500, 60, 24])
    expect(p.replaySpeed).toEqual([1, 4])
  })

  it("ga's seats per draft are NOT set — resolving them refuses with the spec's own sentence (§22.6 v2.16.100)", () => {
    expect(resolveProfile('ga').botsPerDraft).toBeNull()
    expect(() => seatsPerDraft(resolveProfile('ga'))).toThrow(/set when the GA-size load task \(M7 L\.F2\.13\) is cut/)
  })

  it('only y2026 and ga certify; smoke says so on its banner', () => {
    expect(CERTIFYING_PROFILES).toEqual(['y2026', 'ga'])
    expect(sizeBanner(resolveProfile('smoke'))).toMatch(/SMOKE — certifies nothing/)
    expect(sizeBanner(resolveProfile('ga'))).toMatch(/GA \/ launch-gate size/)
  })

  it('refuses an unknown profile rather than defaulting', () => {
    expect(() => resolveProfile('production')).toThrow(/unknown load profile/)
  })

  it('soak connections follow §22.1: leagues × avg 4 viewers', () => {
    expect(soakConnections(resolveProfile('y2026'))).toBe(100)
    expect(soakConnections(resolveProfile('ga'))).toBe(2000)
  })

  it('the asserts are the numbers §22.6 prints', () => {
    expect(PICK_TO_BROADCAST_P95_MS).toBe(500)
    expect(SCORING_LAG_P95_MS).toBe(15_000)
  })

  it('the harness season is its own (2070)', () => {
    expect(LOAD_SEASON).toBe(2070)
  })
})

describe('assertSafeTarget (TD2 / D571 — refuses production by name)', () => {
  const derivedDeny = ['abcdefghijklmnopqrst', 'prod-host.example.co']

  it('accepts the local stack for a local target', () => {
    expect(assertSafeTarget({ kind: 'local', url: 'http://127.0.0.1:54321/', derivedDeny })).toBe('http://127.0.0.1:54321')
  })

  it('refuses a hosted URL given as local', () => {
    expect(() => assertSafeTarget({ kind: 'local', url: 'https://test-proj.supabase.co', derivedDeny })).toThrow(/local stack URL/)
  })

  it('refuses a test target that names production — by ref or by host, any case', () => {
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://abcdefghijklmnopqrst.supabase.co', derivedDeny })).toThrow(/PRODUCTION/)
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://ABCDEFGHIJKLMNOPQRST.supabase.co', derivedDeny })).toThrow(/PRODUCTION/)
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://prod-host.example.co', derivedDeny })).toThrow(/PRODUCTION/)
  })

  it('refuses the production app domain whatever the deny list says', () => {
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://fieldscout.gg', derivedDeny: [] })).toThrow(/production app domain/)
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://api.fieldscout.gg', derivedDeny })).toThrow(/production app domain/)
  })

  it('FAILS CLOSED: with no production name to check against, a test target is refused', () => {
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://test-proj.supabase.co', derivedDeny: [] })).toThrow(/fails closed/)
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://test-proj.supabase.co', derivedDeny: ['', '  '] })).toThrow(/fails closed/)
  })

  it('refuses the local stack as a test target, and plain http', () => {
    expect(() => assertSafeTarget({ kind: 'test', url: 'http://localhost:54321', derivedDeny })).toThrow(/use --target local/)
    expect(() => assertSafeTarget({ kind: 'test', url: 'http://test-proj.supabase.co', derivedDeny })).toThrow(/https/)
  })

  it('accepts a hosted test project that names no production identity', () => {
    expect(assertSafeTarget({ kind: 'test', url: 'https://test-proj.supabase.co/', derivedDeny })).toBe('https://test-proj.supabase.co')
  })
})

describe('R1640 — the guard judges the host a client would reach, and hands out only the normalized origin', () => {
  const derivedDeny = ['abcdefghijklmnopqrst']
  const PROD = 'abcdefghijklmnopqrst'

  it.each([
    ['percent-encoded letter (%61 = a)', `https://%61bcdefghijklmnopqrst.supabase.co`],
    ['percent-encoded whole ref', `https://${[...PROD].map((c) => '%' + c.charCodeAt(0).toString(16)).join('')}.supabase.co`],
    ['soft hyphen inside the ref', `https://abcdefghij\u00ADklmnopqrst.supabase.co`],
    ['fullwidth letters', `https://\uFF41\uFF42\uFF43defghijklmnopqrst.supabase.co`],
    ['fieldscout%2egg', 'https://fieldscout%2egg'],
    ['fullwidth app domain', 'https://\uFF46ieldscout.gg'],
    ['userinfo before the host', `https://user@${PROD}.supabase.co`],
    ['a path after the host', 'https://test-proj.supabase.co/rest/v1'],
    ['a trailing-dot-free empty label', 'https://test-proj..supabase.co'],
  ])('refuses %s', (_label, url) => {
    expect(() => assertSafeTarget({ kind: 'test', url, derivedDeny })).toThrow(/refused/)
  })

  it('the URL parser would have decoded them — which is why the raw string is judged', () => {
    expect(new URL('https://%61bcdefghijklmnopqrst.supabase.co').hostname).toBe(`${PROD}.supabase.co`)
    expect(new URL('https://fieldscout%2egg').hostname).toBe('fieldscout.gg')
    expect(new URL('https://\uFF41\uFF42\uFF43defghijklmnopqrst.supabase.co').hostname).toBe(`${PROD}.supabase.co`)
    expect(new URL(`https://abcdefghij\u00ADklmnopqrst.supabase.co`).hostname).toBe(`${PROD}.supabase.co`)
  })

  it('returns the normalized origin (lower-cased, no slash) — never the raw string', () => {
    expect(assertSafeTarget({ kind: 'test', url: '  HTTPS://Test-Proj.Supabase.CO/  ', derivedDeny })).toBe('https://test-proj.supabase.co')
    expect(normalizeTarget('http://LOCALHOST:54321')).toEqual({ scheme: 'http', host: 'localhost', origin: 'http://localhost:54321' })
  })
})

describe('R1641 — FS_LOAD_DENY only adds names', () => {
  it('extra names add refusals', () => {
    expect(() =>
      assertSafeTarget({ kind: 'test', url: 'https://other-prod.supabase.co', derivedDeny: ['zzzz'], extraDeny: ['other-prod'] }),
    ).toThrow(/PRODUCTION/)
  })
  it('extra names never satisfy the fail-closed check', () => {
    expect(() =>
      assertSafeTarget({ kind: 'test', url: 'https://test-proj.supabase.co', derivedDeny: [], extraDeny: ['something'] }),
    ).toThrow(/fails closed/)
  })
  it('derivedDenyNames reads the link ref and a hosted .env.local host, never a local one', () => {
    expect(derivedDenyNames(' RefX \n', 'NEXT_PUBLIC_SUPABASE_URL=https://Prod-Host.example.co/\n')).toEqual(['refx', 'prod-host.example.co'])
    expect(derivedDenyNames(null, 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321')).toEqual([])
    expect(derivedDenyNames(null, 'NEXT_PUBLIC_SUPABASE_URL=https://we%69rd.example.co')).toEqual(['we%69rd.example.co'])
  })
})

describe('realtimeSocketUrl', () => {
  it('is the Realtime v1 websocket with the anon key', () => {
    expect(realtimeSocketUrl('http://127.0.0.1:54321', 'k e y')).toBe('ws://127.0.0.1:54321/realtime/v1/websocket?apikey=k%20e%20y&vsn=1.0.0')
    expect(realtimeSocketUrl('https://x.supabase.co', 'a')).toBe('wss://x.supabase.co/realtime/v1/websocket?apikey=a&vsn=1.0.0')
  })
})
