import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The `/app` route-group split — DR.1 / D147, spec §16.1 (v2.12).
 *
 * The draft room is a full-screen, chrome-free surface, so `<AppShell>` moved
 * down into a `(shell)` route group and the room lives in a sibling `(room)`
 * group, with the auth + username guards left ABOVE both in
 * `src/app/app/layout.tsx`. Three properties have to survive that, and each
 * one fails silently if it breaks — which is why they are pinned here rather
 * than remembered:
 *
 *  1. **URLs are byte-identical.** Route groups are invisible to the router,
 *     so `(shell)` / `(room)` must never reach a URL. The golden below is a
 *     stored literal captured from `next build`'s app-path route manifest on
 *     `main` @ 9c81f7c, BEFORE the split (delivery plan §4.3: goldens are
 *     stored literals, not recomputed expectations).
 *  2. **The guard is in exactly one place, and it is above both groups.** A
 *     copy inside `(shell)` would leave the room's copy looking optional; no
 *     copy at all in the parent is the cold-load hole D148 went looking for.
 *  3. **The leagues release gate covers the room too.** The room left the
 *     group that held `leagues/layout.tsx`, and the flag-off case is exactly
 *     the case nobody exercises locally (flags default ON in development).
 *
 * These are source-level pins for the same reason `launch-scope-gates.test.ts`
 * is: the layouts are `.tsx` under Next's `jsx: "preserve"`, so Vite cannot
 * import them. The point is that the shape exists, not that it renders.
 */

const APP_DIR = path.resolve(process.cwd(), 'src/app')

function read(rel: string) {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/**
 * Source with comments removed. Every "this file must NOT contain X" pin below
 * runs through this, because these files DISCUSS the thing they must not do —
 * `(room)/layout.tsx`'s docblock names AppShell and `pr-rail-strip` precisely
 * to say it renders neither. A pin that a prose mention can satisfy (or break)
 * is not pinning the code.
 */
function code(rel: string) {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/** Every `page.tsx` under src/app, as the URL the App Router derives from it. */
function pageUrls(): string[] {
  const urls: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (entry === 'page.tsx' || entry === 'page.ts') {
        const rel = path.relative(APP_DIR, path.dirname(full))
        const url =
          '/' +
          rel
            .split(path.sep)
            // Route groups — `(shell)`, `(room)`, `(auth)` — contribute no
            // URL segment. This is the whole reason the split is free.
            .filter((seg) => seg !== '' && !(seg.startsWith('(') && seg.endsWith(')')))
            .join('/')
        urls.push(url === '/' ? '/' : url)
      }
    }
  }
  walk(APP_DIR)
  return urls.sort()
}

/**
 * GOLDEN — the `/app` page URLs as they stood on `main` @ 9c81f7c, before the
 * route-group split. Do not regenerate this list to make a test pass: a diff
 * here means a URL moved, which is exactly the thing DR.1 promised would not
 * happen.
 */
const APP_URLS_GOLDEN = [
  '/app',
  '/app/admin/posts',
  '/app/big-board',
  '/app/big-board/week/[week]',
  '/app/explore',
  '/app/leagues',
  '/app/leagues/[leagueId]',
  '/app/leagues/[leagueId]/draft',
  '/app/leagues/[leagueId]/draft/recap',
  '/app/leagues/[leagueId]/settings',
  '/app/lists',
  '/app/lists/[listId]',
  '/app/lists/draft-mode',
  '/app/lists/new',
  '/app/nfl',
  '/app/nfl/[team]',
  '/app/notifications',
  '/app/players',
  '/app/players/[playerId]',
  '/app/profile',
  '/app/research',
  '/app/settings',
  '/app/settings/billing',
  '/app/settings/profile',
  '/app/settings/scoring',
  '/app/start-or-sit',
  '/app/start-or-sit/[questionId]',
  '/app/start-or-sit/new',
  '/app/stats',
  '/app/styleguide',
  '/app/teams',
  '/app/teams/[teamId]',
  '/app/teams/[teamId]/live',
  '/app/trash',
  '/app/weekly-ranks',
  '/app/weekly-ranks/history',
]

describe('route groups are invisible to the URL space', () => {
  it('the /app page URLs match the pre-split golden exactly', () => {
    expect(pageUrls().filter((u) => u === '/app' || u.startsWith('/app/'))).toEqual(
      APP_URLS_GOLDEN,
    )
  })

  it('no derived URL anywhere carries a group segment', () => {
    for (const url of pageUrls()) {
      expect(url, url).not.toMatch(/[()]/)
    }
  })

  it('the draft room really is inside a route group (not just an ordinary route)', () => {
    // Belt-and-braces on the golden: if someone "fixed" a URL diff by moving
    // the room back under (shell), the golden above would still pass. This
    // is the pin that says the room is hosted where the chrome-free frame is.
    const roomPage = 'src/app/app/(room)/leagues/[leagueId]/draft/page.tsx'
    expect(() => read(roomPage)).not.toThrow()
    expect(read(roomPage)).toContain('@/components/draft/draft-room')
  })

  it('the recap stayed in the shell (Q12: a recap is not a draft surface)', () => {
    expect(() =>
      read('src/app/app/(shell)/leagues/[leagueId]/draft/recap/page.tsx'),
    ).not.toThrow()
    expect(() =>
      read('src/app/app/(room)/leagues/[leagueId]/draft/recap/page.tsx'),
    ).toThrow()
  })
})

describe('the signed-in guard sits above both groups, exactly once', () => {
  const PARENT = 'src/app/app/layout.tsx'
  const GROUP_LAYOUTS = ['src/app/app/(shell)/layout.tsx', 'src/app/app/(room)/layout.tsx']

  it('the parent layout carries the auth guard and the username gate', () => {
    const layout = read(PARENT)
    expect(layout).toContain('auth.getUser()')
    expect(layout).toMatch(/redirect\('\/login\?redirect=\/app'\)/)
    expect(layout).toContain('PLACEHOLDER_USERNAME_REGEX')
    expect(layout).toMatch(/redirect\('\/username'\)/)
  })

  it('the parent layout is a pass-through — it renders no chrome of its own', () => {
    expect(code(PARENT)).not.toContain('AppShell')
    expect(read(PARENT)).toContain('{children}')
  })

  for (const file of GROUP_LAYOUTS) {
    it(`${file} does NOT duplicate the auth guard`, () => {
      // D147: one copy, above both groups. Two copies is two things to keep
      // in step, and the room's would be the one nobody exercises.
      const source = code(file)
      expect(source).not.toContain('auth.getUser')
      expect(source).not.toContain('/login')
      expect(source).not.toContain('PLACEHOLDER_USERNAME_REGEX')
    })
  }

  it('the shell group is where <AppShell> lives now', () => {
    expect(read('src/app/app/(shell)/layout.tsx')).toContain('<AppShell>')
  })
})

describe('the room frame is chrome-free and full-viewport', () => {
  const frame = () => read('src/app/app/(room)/layout.tsx')

  it('is full-viewport with a single owned scroll region', () => {
    expect(frame()).toContain('h-screen')
    expect(frame()).toContain('overflow-hidden')
    expect(frame()).toContain('overflow-y-auto')
  })

  it('renders none of the shell chrome and none of its page geometry', () => {
    const source = code('src/app/app/(room)/layout.tsx')
    for (const chrome of [
      'AppShell',
      'Sidebar',
      'TopNav',
      'AppHeader',
      'DraftBar',
      'ResearchRail',
      'BottomTabs',
    ]) {
      expect(source, chrome).not.toContain(chrome)
    }
    // The shell's page geometry: reserved rail strip, gutters, scroll tail.
    for (const geometry of ['pr-rail-strip', 'px-4', 'lg:px-7', 'pb-[20vh]']) {
      expect(source, geometry).not.toContain(geometry)
    }
  })
})

describe('the leagues release gate survived the split', () => {
  // The original gate's own comment names "live draft" first, and the live
  // draft is precisely the route that changed groups. Flags default ON in
  // development, so a missing gate here is invisible until a deploy.
  for (const file of [
    'src/app/app/(shell)/leagues/layout.tsx',
    'src/app/app/(room)/leagues/layout.tsx',
  ]) {
    it(`${file} redirects on featureFlags.leagues`, () => {
      const source = read(file)
      expect(source).toContain('featureFlags.leagues')
      expect(source).toContain("redirect('/app')")
    })
  }
})
