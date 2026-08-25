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

/**
 * URLs ADDED since the golden — and the golden above stays byte-frozen so
 * the two stay distinguishable. A NEW route is not the thing this pin was
 * written to catch (that is a MOVED one), but an unannounced new route is
 * how a moved one would hide, so every entry here has to say what it is and
 * when it leaves.
 */
const APP_URLS_ADDED_SINCE_GOLDEN = [
  // MP.5 — the practice home (spec v2.16 §8.8). Its own route family, NOT a
  // page under /app/leagues, because `(room)/leagues/layout.tsx` redirects
  // that whole URL space away when the leagues flag is off (D231(3a)/R470)
  // and practice must survive that (E79). Gated on `featureFlags.mockDrafts`
  // — asserted below. Permanent; MP.6 adds `/app/mocks/[mockId]` and MP.8
  // `/app/mocks/[mockId]/report` beside it, each declared here in turn.
  //
  // MP.4's dev-only `/app/dev/mock-launch` harness lived here and is DELETED
  // by this same task (F115) — the launch dialog's real mount is /app/mocks.
  '/app/mocks',
  // MP.6 — the practice ROOM's own route, keyed on the MOCK's id (D243,
  // layer 1 of three). It is here rather than under `/app/leagues` because
  // that whole URL space is redirected away when the leagues flag is off
  // (R470), and because a standalone mock has no league id to key a URL on.
  // Gated on `featureFlags.mockDrafts` by `(room)/mocks/layout.tsx` —
  // asserted below, beside the two leagues gates. Permanent; MP.6c mounts
  // the room in it, MP.8 adds `/app/mocks/[mockId]/report` beside it.
  '/app/mocks/[mockId]',
  // MP.8 — the MOCK DRAFT REPORT (D230): the flat table of every player, its
  // price and the team it went to. It is in `(shell)` rather than `(room)`
  // for Q12's reason, already applied to the league recap — a report is not
  // a draft surface, so it keeps the app chrome. Gated on
  // `featureFlags.mockDrafts` by `(shell)/mocks/layout.tsx`. Permanent.
  '/app/mocks/[mockId]/report',
]

describe('route groups are invisible to the URL space', () => {
  it('the /app page URLs match the pre-split golden exactly (plus the declared additions)', () => {
    expect(pageUrls().filter((u) => u === '/app' || u.startsWith('/app/'))).toEqual(
      [...APP_URLS_GOLDEN, ...APP_URLS_ADDED_SINCE_GOLDEN].sort(),
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

  it('the mock report is in the shell too, for the same reason (MP.8/Q12)', () => {
    const REPORT = 'src/app/app/(shell)/mocks/[mockId]/report/page.tsx'
    expect(() => read(REPORT)).not.toThrow()
    expect(() => read('src/app/app/(room)/mocks/[mockId]/report/page.tsx')).toThrow()
    // …and it is the report component that is mounted there, not the room's.
    expect(read(REPORT)).toContain('@/components/draft/mock-report')
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

describe('practice is released on its OWN flag (E79 / D231)', () => {
  // The lane's central claim, pinned at the layer it is easiest to break:
  // a later editor "tidying" this gate onto `featureFlags.leagues` would
  // silently re-couple practice to the league product, and flags default ON
  // in development so nothing would show it until a deploy.
  const GATE = 'src/app/app/(shell)/mocks/layout.tsx'

  it('/app/mocks redirects on featureFlags.mockDrafts', () => {
    // `code()`, not `read()`: this file's docblock NAMES both flags to
    // explain the distinction, and a pin a comment can satisfy is not a pin.
    const source = code(GATE)
    expect(source).toContain('featureFlags.mockDrafts')
    expect(source).toContain("redirect('/app')")
  })

  it('/app/mocks never reads the leagues flag — with leagues OFF it still renders', () => {
    expect(code(GATE)).not.toContain('featureFlags.leagues')
  })

  it('nothing under /app/mocks GATES on the leagues flag', () => {
    // The gate is one file; the pages under it are the other half of the same
    // claim. `mocks-home.tsx` is swept with them because it IS the page's
    // body (the route file is two lines).
    //
    // **Narrowed at review (R519), and the narrowing was forced by this pin
    // going RED — which is the pin working.** The first version forbade the
    // STRING `featureFlags.leagues` anywhere under /app/mocks. R519's fix
    // then needed a legitimate read of it: a league-attached mock listed here
    // while leagues is off has a real link that silently redirects to `/app`,
    // so the page disables that control. **That is presentation, not a gate**
    // — the page still renders in full, every standalone row still works, and
    // nothing about access changes. What must never exist is a *gate* keyed
    // on the leagues flag, so that is what is pinned: no `redirect(`, no
    // `notFound(`, and no early return, in the same statement as the flag.
    for (const rel of [
      'src/app/app/(shell)/mocks/layout.tsx',
      'src/app/app/(shell)/mocks/page.tsx',
      'src/components/draft/mocks-home.tsx',
    ]) {
      const source = code(rel)
      for (const [at, line] of source.split('\n').entries()) {
        if (!line.includes('featureFlags.leagues')) continue
        expect(line, `${rel}:${at + 1}`).not.toMatch(/redirect\(|notFound\(/)
      }
    }
  })

  it('the ONE leagues-flag read under /app/mocks is the R519 disabled state', () => {
    // The other side of the narrowing: the exemption is a named function with
    // a stated job, not a licence. A second read appearing anywhere on this
    // page reddens here and has to argue for itself.
    const home = code('src/components/draft/mocks-home.tsx')
    const reads = (home.match(/featureFlags\.leagues/g) ?? []).length
    expect(reads, 'exactly one leagues-flag read').toBe(1)
    const fn = home.indexOf('function openBlockedReason')
    expect(fn, 'openBlockedReason found').toBeGreaterThan(-1)
    expect(home.indexOf('featureFlags.leagues')).toBeGreaterThan(fn)
    // The gate itself stays entirely free of it.
    expect(code('src/app/app/(shell)/mocks/layout.tsx')).not.toContain('featureFlags.leagues')
  })

  it('the MP.4 dev harness is gone (F115) — the dialog has a real mount now', () => {
    expect(() => read('src/app/app/(shell)/dev/mock-launch/page.tsx')).toThrow()
    expect(read('src/components/draft/mocks-home.tsx')).toContain('MockLaunchDialog')
  })
})

describe('the mock room is released on the mockDrafts flag, past the leagues gate (MP.6)', () => {
  // ONE test for both halves on purpose (MP.6 item 5). The claim is not "the
  // mock room has a gate" — it is that the two gates are INDEPENDENT: with
  // `leagues` off the room's `/app/leagues` URL space is still redirected
  // away, and `/app/mocks/[mockId]` is still reachable. Asserting either one
  // alone leaves the coupling R470 found (a different flag on a different
  // layout) invisible.
  const MOCK_ROOM_GATE = 'src/app/app/(room)/mocks/layout.tsx'
  const MOCK_ROOM_PAGE = 'src/app/app/(room)/mocks/[mockId]/page.tsx'

  it('/app/mocks/[mockId] gates on mockDrafts ONLY, while /app/leagues still redirects on leagues', () => {
    // `code()`, not `read()`: the gate's docblock names both flags to explain
    // the distinction, and a pin a comment can satisfy is not a pin.
    const gate = code(MOCK_ROOM_GATE)
    expect(gate).toContain('featureFlags.mockDrafts')
    expect(gate).toContain("redirect('/app')")
    expect(gate, 'the mock room never reads the leagues flag').not.toContain(
      'featureFlags.leagues',
    )
    // …and the page under it does not smuggle one in either.
    expect(code(MOCK_ROOM_PAGE)).not.toContain('featureFlags.leagues')

    // The other half, in the same test: the leagues room gate is untouched,
    // so this route is an escape from it rather than a hole in it.
    const leaguesGate = code('src/app/app/(room)/leagues/layout.tsx')
    expect(leaguesGate).toContain('if (!featureFlags.leagues) redirect')
  })

  it('an old league-side URL for a STANDALONE mock redirects, never 404s (MP.6 item 6)', () => {
    // `?draft=<id>` room links exist in the wild. The redirect is the reason
    // this route move costs nobody a dead end, so it is pinned at the file
    // that performs it — and pinned to the SHARED href builder, because a
    // hand-rolled `/app/mocks/${…}` here is the second source of truth the
    // seam exists to prevent.
    const source = code('src/app/app/(room)/leagues/[leagueId]/draft/page.tsx')
    expect(source).toContain("import { mockRoomHref } from '@/components/draft/mock-launcher-entry'")
    expect(source).toMatch(/redirect\(mockRoomHref\(/)
    // Narrow by construction: only a mock with no league is re-routed.
    expect(source).toContain(".is('league_id', null)")
    expect(source).toContain(".eq('is_mock', true)")
  })

  it('a LEAGUE-attached mock id is sent to the room it already has (R521)', () => {
    // The route is keyed on a mock id, and MP.5's list — which this page
    // reads — contains league-attached mocks too. Rendering the standalone
    // page over one would put "the board lands here next" on a mock whose
    // board is a click away.
    const page = code(MOCK_ROOM_PAGE)
    expect(page).toMatch(/mock\.league_id !== null/)
    expect(page).toMatch(/redirect\(leagueMockRoomHref\(/)
    // The URL comes from the seam, not a second hand-rolled copy — and the
    // seam's own entry-sweep disposition lives in `room-entry.test.ts`.
    expect(page).toContain(
      "import { leagueMockRoomHref } from '@/components/draft/mock-launcher-entry'",
    )
  })

  it('MP.6c: the ROOM mounts here — ONE component, two mounts (D243)', () => {
    // MP.6's pin said the opposite and said why: at layer 1 this route
    // could only have rendered an error card and 404'd every pick (Q25's
    // measurement). Layers 3 (MP.6b) and 2 (MP.6c) landed, so it flips —
    // and what it now pins is the LV.7 rule: BOTH routes mount out of the
    // SAME module. A second room component would show up here as a second
    // import path.
    const mockPage = code(MOCK_ROOM_PAGE)
    const leaguePage = code('src/app/app/(room)/leagues/[leagueId]/draft/page.tsx')
    expect(mockPage).toContain('@/components/draft/draft-room')
    expect(leaguePage).toContain('@/components/draft/draft-room')
    expect(mockPage).toMatch(/import \{ MockDraftRoom \} from '@\/components\/draft\/draft-room'/)
    expect(leaguePage).toMatch(/import \{ DraftRoom \} from '@\/components\/draft\/draft-room'/)
    // …and neither route reaches for a room file of its own.
    for (const source of [mockPage, leaguePage]) {
      const roomImports = [...source.matchAll(/from '@\/components\/draft\/[a-z-]*room[a-z-]*'/g)]
      expect(roomImports).toHaveLength(1)
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
