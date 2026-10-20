import { describe, expect, it } from 'vitest'

import {
  CERTIFYING_PROFILES,
  LOAD_SEASON,
  PICK_TO_BROADCAST_P95_MS,
  SCORING_LAG_P95_MS,
  assertSafeTarget,
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
  const deny = ['abcdefghijklmnopqrst', 'prod-host.example.co']

  it('accepts the local stack for a local target', () => {
    expect(assertSafeTarget({ kind: 'local', url: 'http://127.0.0.1:54321/', deny })).toBe('http://127.0.0.1:54321')
  })

  it('refuses a hosted URL given as local', () => {
    expect(() => assertSafeTarget({ kind: 'local', url: 'https://test-proj.supabase.co', deny })).toThrow(/local stack URL/)
  })

  it('refuses a test target that names production — by ref or by host, any case', () => {
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://abcdefghijklmnopqrst.supabase.co', deny })).toThrow(/PRODUCTION/)
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://ABCDEFGHIJKLMNOPQRST.supabase.co', deny })).toThrow(/PRODUCTION/)
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://prod-host.example.co', deny })).toThrow(/PRODUCTION/)
  })

  it('refuses the production app domain whatever the deny list says', () => {
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://fieldscout.gg', deny: [] })).toThrow(/production app domain/)
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://api.fieldscout.gg', deny })).toThrow(/production app domain/)
  })

  it('FAILS CLOSED: with no production name to check against, a test target is refused', () => {
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://test-proj.supabase.co', deny: [] })).toThrow(/fails closed/)
    expect(() => assertSafeTarget({ kind: 'test', url: 'https://test-proj.supabase.co', deny: ['', '  '] })).toThrow(/fails closed/)
  })

  it('refuses the local stack as a test target, and plain http', () => {
    expect(() => assertSafeTarget({ kind: 'test', url: 'http://localhost:54321', deny })).toThrow(/use --target local/)
    expect(() => assertSafeTarget({ kind: 'test', url: 'http://test-proj.supabase.co', deny })).toThrow(/https/)
  })

  it('accepts a hosted test project that names no production identity', () => {
    expect(assertSafeTarget({ kind: 'test', url: 'https://test-proj.supabase.co/', deny })).toBe('https://test-proj.supabase.co')
  })
})

describe('realtimeSocketUrl', () => {
  it('is the Realtime v1 websocket with the anon key', () => {
    expect(realtimeSocketUrl('http://127.0.0.1:54321', 'k e y')).toBe('ws://127.0.0.1:54321/realtime/v1/websocket?apikey=k%20e%20y&vsn=1.0.0')
    expect(realtimeSocketUrl('https://x.supabase.co', 'a')).toBe('wss://x.supabase.co/realtime/v1/websocket?apikey=a&vsn=1.0.0')
  })
})
