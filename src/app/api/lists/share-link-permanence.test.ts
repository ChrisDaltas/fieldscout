import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { slugify } from '@/lib/lists/helpers'

/**
 * A shared list link must keep working.
 *
 * `/u/{username}/lists/{slug}` is what people paste into group chats. Until
 * 2026-08-05 the PATCH handler regenerated the slug whenever the title
 * changed, so renaming a list 404'd every link already shared — no redirect,
 * no warning. Verified against production: renaming "mytop10wrs" to "My Top 10
 * WRs" turned the shared URL into a 404 while a new one silently took over.
 *
 * The slug is now assigned once at creation and never rewritten.
 */

const PATCH_ROUTE = 'src/app/api/lists/[id]/route.ts'
const CREATE_ROUTE = 'src/app/api/lists/route.ts'

const read = (rel: string) =>
  readFileSync(path.resolve(process.cwd(), rel), 'utf8')

describe('list share links are permanent', () => {
  it('the PATCH (rename) handler never writes a slug', () => {
    const source = read(PATCH_ROUTE)

    // The rename path must not assign a slug by any route: no regeneration,
    // no direct assignment into the update payload.
    expect(source).not.toContain('generateUniqueSlug')
    expect(source).not.toMatch(/updates\.slug\s*=/)
  })

  it('still lets the title change', () => {
    // Permanence applies to the URL, not the label above it.
    expect(read(PATCH_ROUTE)).toMatch(/updates\.title\s*=\s*input\.title/)
  })

  it('creation still assigns a slug, so new lists are addressable', () => {
    expect(read(CREATE_ROUTE)).toContain('generateUniqueSlug')
  })
})

describe('slugify (what a shared URL is built from)', () => {
  it('passes an already-clean title straight through', () => {
    expect(slugify('mytop10wrs')).toBe('mytop10wrs')
  })

  it('hyphenates spaces and drops punctuation', () => {
    expect(slugify('My Top 10 WRs')).toBe('my-top-10-wrs')
    expect(slugify("Joe's  Sleepers!!")).toBe('joe-s-sleepers')
  })

  it('never yields an empty slug', () => {
    // An emoji-only or symbol-only title would otherwise produce '' and make
    // the list unreachable.
    expect(slugify('!!!')).toBe('list')
    expect(slugify('   ')).toBe('list')
  })
})
