/**
 * Audit lists-2: a shared list on a phone. The public share page
 * (`/u/[username]/lists/[listSlug]`) is the desktop design — no dock, no
 * Back, always light — so:
 *
 *  - a signed-in phone that lands there (Copy link, Community's Share, any
 *    link from outside the app) is handed to the phone List view inside the
 *    app (`PhoneHandoff` → `listHref`): someone else's list read-only, your
 *    own with Edit. The page itself stays the server-rendered one for search
 *    engines, signed-out visitors and desktop — the split the public profile
 *    makes (audit profile-1);
 *  - and no phone screen links to the share page itself, except to build the
 *    address it copies (a share link must be the public page).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { listHref as navListHref } from './lists-nav'
import { listHref } from './lists-routes'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

const SHARE_PAGE = 'src/app/u/[username]/lists/[listSlug]/page.tsx'

describe('the share page hands a signed-in phone to the List view (audit lists-2)', () => {
  const page = read(SHARE_PAGE)

  it('renders the handoff to this list’s phone List view', () => {
    expect(page).toContain('<PhoneHandoff to={listHref(list.id)} />')
    // The one handoff — the person pages use it too — not a copy of it.
    expect(page).toContain("import { PhoneHandoff } from '@/components/shared/phone-handoff'")
  })

  it('…only for a signed-in visitor on a device that gets the phone layout', () => {
    const handoff = read('src/components/shared/phone-handoff.tsx')
    expect(handoff).toContain("if (signedIn && detectMode() === 'mobile') router.replace(to)")
  })

  it('the page stays a server component that renders the list itself (SEO, signed-out visitors, desktop)', () => {
    expect(page).not.toMatch(/^['"]use client['"]/m)
    expect(page).toContain('<PublicListView')
  })

  it('builds the address from the plain module: a server page cannot call into a client one', () => {
    expect(page).toContain("import { listHref } from '@/components/mobile/lists/lists-routes'")
    expect(page).not.toContain("from '@/components/mobile/lists/lists-nav'")
    expect(read('src/components/mobile/lists/lists-routes.ts')).not.toMatch(/^['"]use client['"]/m)
  })

  it('the List view’s address — one spelling, which the Lists screens share', () => {
    expect(listHref('a0a0-1')).toBe('/app/lists?list=a0a0-1')
    expect(listHref('a b/c')).toBe('/app/lists?list=a%20b%2Fc')
    expect(listHref('l1', 'grid')).toBe('/app/lists?list=l1&from=grid')
    expect(navListHref).toBe(listHref)
  })
})

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

/** A share page address built in code: `/u/${…}/lists/${…}`, or a profile
 *  href with `/lists/${…}` after it. */
const SHARE_ADDRESS = /(\/u\/|ProfileHref\().*\/lists\/\$\{/

/** Phone files that may build the share page's address — only to copy it. */
const SHARE_ADDRESS_ALLOWED: ReadonlyArray<{ file: string; contains: string; why: string }> = [
  {
    file: 'src/components/mobile/lists/list-actions-sheet.tsx',
    contains: 'const link = `${window.location.origin}/u/${username}/lists/${list.slug}`',
    why: 'List options › Copy link — the address someone else opens, so the public page',
  },
  {
    file: 'src/components/mobile/community/list-actions.tsx',
    contains: 'const url = `${window.location.origin}${userProfileHref(owner)}/lists/',
    why: 'Community’s Share — the address someone else opens, so the public page',
  },
]

describe('phone screens never link to the desktop share page (audit lists-2)', () => {
  const hits = sourceFiles(path.join(ROOT, 'src/components/mobile')).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) => {
        const text = line.trim()
        if (text.startsWith('*') || text.startsWith('//') || !SHARE_ADDRESS.test(text)) return []
        return [{ file: path.relative(ROOT, file), line: i + 1, text }]
      }),
  )

  it.each(hits.map((h) => [`${h.file}:${h.line}`, h] as const))('%s builds a share address only to copy it', (_where, hit) => {
    const allowed = SHARE_ADDRESS_ALLOWED.some((a) => a.file === hit.file && hit.text.includes(a.contains))
    expect(allowed, `${hit.file}:${hit.line} sends a phone to the desktop share page — open the List view (listHref): ${hit.text}`).toBe(true)
  })

  it.each(SHARE_ADDRESS_ALLOWED.map((a) => [a.file, a] as const))('allowlist entry is live: %s', (_label, entry) => {
    expect(hits.filter((h) => h.file === entry.file && h.text.includes(entry.contains))).toHaveLength(1)
  })

  it('Home’s AI-expert boards open the List view', () => {
    const home = read('src/components/mobile/home/home-extras.tsx')
    expect(home).toContain('href: listHref(b.id),')
  })
})
