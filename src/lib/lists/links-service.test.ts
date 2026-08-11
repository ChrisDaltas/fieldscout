/**
 * links-service — the URL guard, and the wire schema, at the UNIT layer.
 *
 * This file exists for one reason: `url` is user input that renders as an
 * `href` on a PUBLIC, server-rendered page (`/u/[username]/lists/[slug]`,
 * SEO-critical per plan D7). A `javascript:` or `data:` href there is stored
 * XSS with a click, so the rejections are pinned as literals rather than
 * described.
 *
 * The RLS and the wire behaviour are proven elsewhere — pgTAP `029` for the
 * policies, `links-api-db.test.ts` over real PostgREST. Nothing here touches a
 * database, so it runs in `test:unit`.
 *
 * **The load-bearing test is `keeps both layers in agreement`.** It asserts
 * that every URL this service ACCEPTS also satisfies migration 080's
 * `list_links_url_scheme_check` regex, transcribed. Two independent guards are
 * only worth having while they agree; if a future edit loosens one, that test
 * is what goes red instead of a 23514 surfacing as an HTTP 500 in production.
 */
import { describe, expect, it } from 'vitest'

import {
  addLinkInputSchema,
  MAX_URL_LENGTH,
  normalizeLinkUrl,
  reorderLinksInputSchema,
  URL_INVALID_MESSAGE,
  URL_SCHEME_MESSAGE,
  URL_TOO_LONG_MESSAGE,
} from './links-service'

/**
 * Migration 080's `list_links_url_scheme_check`, transcribed from the SQL:
 *   CHECK (url ~* '^https?://[^[:space:]]+$')
 * Postgres `~*` is case-insensitive; `[^[:space:]]` is `\S` in JS.
 */
const DB_URL_CHECK = /^https?:\/\/\S+$/i

describe('normalizeLinkUrl — dangerous schemes are refused', () => {
  /**
   * `java\tscript:` is not padding. Browsers strip TAB and newline out of a
   * scheme, so it is a LIVE `javascript:` URL; `new URL()` performs the same
   * normalisation, which is exactly why this service parses instead of
   * pattern-matching the raw string.
   */
  const dangerous = [
    ['plain javascript:', 'javascript:alert(1)'],
    ['tab-smuggled javascript:', 'java\tscript:alert(1)'],
    ['newline-smuggled javascript:', 'java\nscript:alert(1)'],
    ['mixed-case javascript:', 'JaVaScRiPt:alert(1)'],
    ['leading-whitespace javascript:', '   javascript:alert(1)'],
    ['bare javascript:', 'javascript:'],
    ['data: html', 'data:text/html,<script>alert(1)</script>'],
    ['data: base64 html', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
    ['blob:', 'blob:https://example.com/1234'],
  ] as const

  it.each(dangerous)('rejects %s', (_label, raw) => {
    const result = normalizeLinkUrl(raw)
    expect(result.ok).toBe(false)
    // Not just "rejected" — rejected for the RIGHT reason, so a future change
    // that reclassifies these as merely unparseable is still visible.
    if (!result.ok) expect(result.reason).toBe(URL_SCHEME_MESSAGE)
  })

  it('never lets the bare-domain convenience launder a dangerous scheme', () => {
    // The retry only fires when the raw string fails to parse AT ALL. Anything
    // carrying a scheme parses on the first attempt and is judged there, so
    // `https://` is never prepended to `javascript:…`.
    for (const [, raw] of dangerous) {
      const result = normalizeLinkUrl(raw)
      expect(result.ok, raw).toBe(false)
      // The proof that no laundering happened: no storable URL came back at
      // all. (Asserted on the result's shape, not on its text — the rejection
      // MESSAGE legitimately contains the literal "http://".)
      expect(result).not.toHaveProperty('url')
    }
  })
})

describe('normalizeLinkUrl — real links are accepted and normalised', () => {
  it.each([
    ['https stays https', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ'],
    ['http is allowed', 'http://example.com/a', 'http://example.com/a'],
    // The WHATWG parser lowercases the scheme AND the host, but preserves path
    // case — which is correct, since paths are case-sensitive.
    ['scheme and host case are normalised', 'HTTPS://Example.com/A', 'https://example.com/A'],
    ['surrounding whitespace is trimmed', '  https://x.com/a  ', 'https://x.com/a'],
    ['inner spaces are percent-encoded', 'https://x.com/a b', 'https://x.com/a%20b'],
    ['a bare domain gains https', 'youtube.com/watch?v=x', 'https://youtube.com/watch?v=x'],
    ['a protocol-relative url gains https', '//example.com', 'https://example.com/'],
  ])('%s', (_label, raw, expected) => {
    const result = normalizeLinkUrl(raw)
    expect(result).toEqual({ ok: true, url: expected })
  })

  it('rejects a string that is not a web address at all', () => {
    for (const raw of ['', '   ', 'not a url', 'a b c', '::::', '?query=1']) {
      const result = normalizeLinkUrl(raw)
      expect(result.ok, raw).toBe(false)
    }
  })

  /**
   * A DELIBERATE limit, pinned so it is a decision rather than a surprise.
   *
   * `http://` alone is nonsense, and the bare-domain retry turns it into
   * `https://http//` — a syntactically valid https URL whose host is literally
   * `http`. It is **accepted**, and that is the right trade: this guard's job
   * is to prove the SCHEME is safe, not to prove the host resolves. Nothing
   * can prove the latter without a network call, and this codebase does not
   * make one (no scraping — CLAUDE.md). Host heuristics ("must contain a dot")
   * would buy nothing here and would reject `https://localhost` and intranet
   * hosts. The user sees the link they typed and can remove it.
   */
  it('accepts syntactically-valid nonsense rather than guessing at hosts', () => {
    expect(normalizeLinkUrl('http://')).toEqual({ ok: true, url: 'https://http//' })
    expect(normalizeLinkUrl('https://')).toEqual({ ok: true, url: 'https://https//' })
    // Still https, still safe to render as an href — which is the only claim
    // this guard makes.
    for (const raw of ['http://', 'https://']) {
      const result = normalizeLinkUrl(raw)
      if (result.ok) expect(result.url).toMatch(DB_URL_CHECK)
    }
  })

  it('bounds the length on both the raw input and the encoded result', () => {
    const tooLongRaw = `https://x.com/${'a'.repeat(MAX_URL_LENGTH)}`
    expect(normalizeLinkUrl(tooLongRaw)).toEqual({ ok: false, reason: URL_TOO_LONG_MESSAGE })

    // Percent-encoding GROWS the string, so a raw value under the ceiling can
    // still exceed it once encoded — checked AFTER parsing, not only before.
    // The spaces must be interior: the parser strips leading/trailing ones.
    const interiorSpaces = `https://x.com/${' '.repeat(MAX_URL_LENGTH / 2)}end`
    expect(interiorSpaces.length).toBeLessThan(MAX_URL_LENGTH)
    const result = normalizeLinkUrl(interiorSpaces)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe(URL_TOO_LONG_MESSAGE)
  })

  it('refuses an empty url with the invalid-address reason, not a crash', () => {
    expect(normalizeLinkUrl('')).toEqual({ ok: false, reason: URL_INVALID_MESSAGE })
  })
})

describe('the two guards agree', () => {
  /**
   * THE load-bearing pin. Migration 080's CHECK is the backstop that covers
   * routes, RPCs and seed scripts this service never sees; it is only a
   * backstop while everything this service accepts also passes it. Drift in
   * either direction turns a friendly 400 into a raw `23514` at 500 — the
   * exact failure PROGRESS §3 Q2 documents for the tier route.
   */
  it('keeps both layers in agreement: everything accepted here satisfies 080 CHECK', () => {
    const accepted = [
      'https://youtu.be/dQw4w9WgXcQ',
      'http://example.com/a',
      'HTTPS://Example.com/A',
      '  https://x.com/a  ',
      'https://x.com/a b',
      'youtube.com/watch?v=x',
      '//example.com',
      'https://x.com/path?q=1&r=2#frag',
      'https://user:pass@x.com/p',
      'https://x.com/ünïcode',
    ]

    for (const raw of accepted) {
      const result = normalizeLinkUrl(raw)
      expect(result.ok, `${raw} should be accepted`).toBe(true)
      if (result.ok) {
        expect(result.url, `${raw} -> ${result.url} must satisfy 080's CHECK`).toMatch(
          DB_URL_CHECK,
        )
        expect(result.url.length).toBeLessThanOrEqual(MAX_URL_LENGTH)
      }
    }
  })

  it('and the DB CHECK independently rejects every scheme this service rejects', () => {
    for (const raw of [
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'vbscript:x',
      'file:///etc/passwd',
      'https://ok.com/a\njavascript:alert(1)',
    ]) {
      expect(raw, `${raw} must fail 080's CHECK too`).not.toMatch(DB_URL_CHECK)
    }
  })
})

describe('addLinkInputSchema', () => {
  const valid = {
    kind: 'video' as const,
    url: 'https://youtu.be/x',
    title: 'Round 1 walkthrough — every pick, ranked',
    source_label: 'Field Scout on YouTube',
    duration_label: '18:42',
  }

  it('accepts the reference screenshot’s own card', () => {
    expect(addLinkInputSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts a bare link with no source and no duration', () => {
    const parsed = addLinkInputSchema.safeParse({
      kind: 'article',
      url: 'https://example.com/a',
      title: 'Why tiers beat ranks',
    })
    expect(parsed.success).toBe(true)
  })

  it('closes `kind` to the handoff’s two values', () => {
    for (const kind of ['podcast', 'tweet', '', 'VIDEO']) {
      expect(addLinkInputSchema.safeParse({ ...valid, kind }).success).toBe(false)
    }
  })

  it('refuses a blank or whitespace-only title — 080 CHECKs btrim(title) too', () => {
    for (const title of ['', '   ', '\t\n']) {
      expect(addLinkInputSchema.safeParse({ ...valid, title }).success).toBe(false)
    }
  })

  it('bounds the title at 200, matching 080', () => {
    expect(addLinkInputSchema.safeParse({ ...valid, title: 'a'.repeat(200) }).success).toBe(true)
    expect(addLinkInputSchema.safeParse({ ...valid, title: 'a'.repeat(201) }).success).toBe(false)
  })

  it('holds duration to a clock shape, so it cannot become a second caption', () => {
    for (const duration_label of ['18:42', '0:07', '1:02:33', '120:00']) {
      expect(
        addLinkInputSchema.safeParse({ ...valid, duration_label }).success,
        duration_label,
      ).toBe(true)
    }
    for (const duration_label of [
      '18 minutes',
      '18:99',
      'a really long read about tiers',
      '<script>x</script>',
      '18:42:99',
      '',
    ]) {
      expect(
        addLinkInputSchema.safeParse({ ...valid, duration_label }).success,
        duration_label,
      ).toBe(false)
    }
  })
})

describe('reorderLinksInputSchema', () => {
  it('takes a non-empty list of uuids', () => {
    expect(
      reorderLinksInputSchema.safeParse({
        link_ids: ['11111111-1111-4111-8111-111111111111'],
      }).success,
    ).toBe(true)
  })

  it('refuses an empty order, a non-uuid, and more ids than a list can hold', () => {
    expect(reorderLinksInputSchema.safeParse({ link_ids: [] }).success).toBe(false)
    expect(reorderLinksInputSchema.safeParse({ link_ids: ['nope'] }).success).toBe(false)
    expect(
      reorderLinksInputSchema.safeParse({
        link_ids: Array.from({ length: 11 }, () => '11111111-1111-4111-8111-111111111111'),
      }).success,
    ).toBe(false)
  })
})
