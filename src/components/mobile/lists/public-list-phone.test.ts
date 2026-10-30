/**
 * Audit lists-2: a shared list on a phone. The public share page
 * (`/u/[username]/lists/[listSlug]`) is the desktop design — no dock, no
 * Back, always light — so:
 *
 *  - a signed-in phone that lands there (Copy link, Community's Share, any
 *    link from outside the app) is handed to the list's phone screen inside
 *    the app (`PhoneHandoff`): your own list on the List view with Edit
 *    (`listHref`); someone else's where every other phone link to it goes
 *    (`inAppListHref`) — Community's list page while Community is on (since
 *    plan C5 a server hand-off, on either layout — `sharedListHandoff`),
 *    else the List view, read-only. The page itself stays the
 *    server-rendered one for search engines, signed-out visitors and the
 *    owner on desktop — the split the public profile makes (audit
 *    profile-1);
 *  - a signed-out visitor who opens one of those phone addresses (shared
 *    from a phone's address bar) gets the public page back — the middleware
 *    reads them with `phoneListIdOf`;
 *  - and no phone screen links to the share page itself, except to build the
 *    address it copies (a share link must be the public page).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { communityDetailHref, LATEST_HREF } from '@/components/mobile/community/community-ops'

import { listHref as navListHref } from './lists-nav'
import { listHref, phoneListIdOf } from './lists-routes'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

const SHARE_PAGE = 'src/app/u/[username]/lists/[listSlug]/page.tsx'

describe('the share page hands a signed-in phone to the list’s phone screen (audit lists-2)', () => {
  const page = read(SHARE_PAGE)

  it('renders the handoff: your own list to the List view, someone else’s where every phone link to it goes', () => {
    // `inAppListHref` with `own`: your own → the List view; someone else's →
    // Community's list page while Community is on, else the List view — the
    // same addresses #550 built (pinned in community-ops.test).
    expect(page).toContain('<PhoneHandoff to={inAppListHref(list.id, featureFlags.community, { own: isOwner })} />')
    // The one handoff — the person pages use it too — not a copy of it.
    expect(page).toContain("import { PhoneHandoff } from '@/components/shared/phone-handoff'")
  })

  it('Community on: someone signed in on someone else’s list is handed in on the server, before the page renders (plan C5)', () => {
    expect(page).toContain('const handoff = sharedListHandoff({')
    expect(page).toContain('communityOn: featureFlags.community,')
    expect(page).toContain('if (handoff) redirect(handoff)')
    // Before the list's own reads — the redirect wastes none of them.
    expect(page.indexOf('if (handoff) redirect(handoff)')).toBeLessThan(page.indexOf('await loadList(header, user)'))
  })

  it('…only for a signed-in visitor on a device that gets the phone layout', () => {
    const handoff = read('src/components/shared/phone-handoff.tsx')
    expect(handoff).toContain("if (signedIn && detectMode() === 'mobile') router.replace(to)")
  })

  it('the page stays a server component that renders the list itself (SEO, signed-out visitors, desktop)', () => {
    expect(page).not.toMatch(/^['"]use client['"]/m)
    expect(page).toContain('<PublicListView')
  })

  it('builds the address from plain modules: a server page cannot call into a client one', () => {
    expect(page).toContain("import { inAppListHref, sharedListHandoff } from '@/components/mobile/community/community-ops'")
    expect(page).not.toContain("from '@/components/mobile/lists/lists-nav'")
    expect(page).not.toContain("from '@/components/mobile/search/search-ops'")
    for (const file of ['src/components/mobile/lists/lists-routes.ts', 'src/components/mobile/community/community-ops.ts']) {
      expect(read(file), file).not.toMatch(/^['"]use client['"]/m)
    }
  })

  it('the List view’s address — one spelling, which the Lists screens share', () => {
    expect(listHref('a0a0-1')).toBe('/app/lists?list=a0a0-1')
    expect(listHref('a b/c')).toBe('/app/lists?list=a%20b%2Fc')
    expect(listHref('l1', 'grid')).toBe('/app/lists?list=l1&from=grid')
    expect(navListHref).toBe(listHref)
  })
})

describe('the phone addresses the middleware turns back into the public page (audit lists-2)', () => {
  const at = (href: string) => {
    const url = new URL(href, 'http://x')
    return phoneListIdOf(url.pathname, url.searchParams)
  }

  it('reads the list from every phone screen that opens one: the List view and Community’s list page', () => {
    const id = '5d0c1a7e-3b2f-4c11-9e8a-0f1b2c3d4e5f'
    expect(at(listHref(id))).toBe(id)
    expect(at(listHref(id, 'grid'))).toBe(id)
    expect(at(communityDetailHref(id))).toBe(id)
    expect(at(communityDetailHref(id, LATEST_HREF))).toBe(id)
    expect(at(`/app/lists/?list=${id}`)).toBe(id)
  })

  it('…and nothing else', () => {
    for (const href of ['/app/lists', '/app/lists?list=', '/app/explore', '/app/weekly-ranks?list=l1', '/app/lists/l1', '/u/a/lists/b']) {
      expect(at(href), href).toBeNull()
    }
  })
})

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

/** A share page address built in code: `/u/${…}/lists/${…}`, a profile
 *  href with `/lists/${…}` after it, or the shared builder that makes one
 *  (`listShareLink`, `lists/v2/list-owner.ts`). */
const SHARE_ADDRESS = /(\/u\/|ProfileHref\().*\/lists\/\$\{|listShareLink\(/

/** Phone files that may build the share page's address — only to copy it. */
const SHARE_ADDRESS_ALLOWED: ReadonlyArray<{ file: string; contains: string; why: string }> = [
  {
    file: 'src/components/mobile/lists/list-actions-sheet.tsx',
    contains: 'const link = listShareLink(window.location.origin, linkAs, list.slug)',
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

  it('Home’s AI-expert boards open where every other phone link to them goes', () => {
    const home = read('src/components/mobile/home/home-extras.tsx')
    expect(home).toContain('href: inAppListHref(b.id, featureFlags.community),')
  })
})
