import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { metadata } from './page'

/**
 * F744 — the landing page's <title>, description and Open Graph tags must be
 * in <head>.
 *
 * Next 15.5 streams metadata on any page rendered per request: it arrives in a
 * hidden <div> in <body>, after </head>, and Lighthouse SEO reported "no meta
 * description" (90). A static page has its metadata resolved at build time and
 * written into <head>. The landing page used to read the session to redirect
 * signed-in users, which made it per-request; that redirect now lives in
 * src/middleware.ts (pinned in middleware.test.ts).
 *
 * These pins hold the page static and its copy in place. The built-HTML proof
 * (`next build` reports `○ /`, and the served page's tags sit before </head>)
 * is in the F744 PR.
 */

const SOURCE = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('the landing page stays static (F744)', () => {
  it.each([
    ['next/headers (cookies / headers)', /from ['"]next\/headers['"]/],
    ['the server Supabase client (reads cookies)', /@\/lib\/supabase\/server/],
    ['connection()', /\bconnection\s*\(/],
    ['a forced-dynamic segment config', /export\s+const\s+dynamic\b/],
    ['searchParams', /\bsearchParams\b/],
    ['generateMetadata (await it only if it reads nothing per request)', /generateMetadata/],
  ])('page.tsx does not use %s', (_label, pattern) => {
    expect(SOURCE).not.toMatch(pattern)
  })
})

describe('the landing page metadata (F744)', () => {
  const title = 'FieldScout — AI powered fantasy football'
  const description =
    'Full leagues, live drafts, expert and consensus rankings, waiver wire reports, start or sit and advanced stats. All powered by Scout AI.'

  it('keeps the existing title and description', () => {
    expect(metadata.title).toBe(title)
    expect(metadata.description).toBe(description)
  })

  it('carries Open Graph tags with the same wording', () => {
    expect(metadata.openGraph).toEqual({
      title,
      description,
      type: 'website',
      siteName: 'FieldScout',
    })
  })
})
