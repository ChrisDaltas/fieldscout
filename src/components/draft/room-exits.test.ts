import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * **No room state is a dead end** — the invariant DR.1 broke and this file
 * makes un-breakable (review finding **R340**, 2026-08-18).
 *
 * DR.1 / D147 moved `/app/leagues/[id]/draft` out of the app shell into the
 * chrome-free `(room)` group. The room's surfaces used to get their way out
 * from `PageHeader`, which renders `null` and writes `{title, actions}` into
 * `useHeaderStore` — a store only `AppHeader` reads, and `AppHeader` is shell
 * chrome (`app-shell.tsx`, `hidden lg:block`). So on `main` those actions
 * rendered at ≥`lg` and nowhere below it; on the `(room)` route they render
 * **nowhere, at every width**. Two surfaces were never enumerated when that
 * consequence was disclosed, and both were left with no exit at all:
 *
 *   - `draft-lobby.tsx` — DOM inventory of a NON-commissioner lobby, dev-local
 *     2026-08-18: **one link, and it pointed deeper** (`…/draft?practice=1`).
 *     *Draft setup* is inside `{isCommish && …}`, so a plain member never saw
 *     it. *Back to league* lived only in the `PageHeader` actions.
 *   - `mock-draft-launcher.tsx` — same inventory: **zero links, zero buttons.**
 *
 * The pins below therefore assert the exits exist **with `PageHeader` deleted
 * from the source**, because a `PageHeader` that satisfies a pin is a pin that
 * measures nothing here — and because DR.2 deletes those calls outright when
 * it rehomes Exit Draft onto the 54px command bar (§16.4). These pins must
 * stay green through that change: what they require is an exit, not a header.
 *
 * DR.7(4) (2026-08-18) moved the LOBBY's exit onto the command bar: the
 * lobby now mounts `DraftCommandBar` itself (un-gated), whose Exit Draft is
 * unconditional across every variant (`command-bar-ops.test.ts`'s
 * whole-table Q13 pin) and survives the deletion of every gate in the bar
 * file (`draft-command-bar.test.ts`). The lobby's in-card Back-to-league —
 * a second exit voice under a bar that already carries one — retired with
 * that change, so the lobby pins below assert the UN-GATED BAR MOUNT
 * instead of the in-card link; the exit itself is the bar's, pinned where
 * the bar lives. Bar coverage at every width is the DR.7 PR's browser
 * evidence (Exit Draft never abbreviates and never hides — D176(5)).
 *
 * Source-level for the same reason `route-groups.test.ts` and
 * `elevation-rule.test.ts` are: `jsx: "preserve"` means Vite cannot import a
 * `.tsx` here. The point is that the exit is in the returned tree and is not
 * gated, not that React mounted it — the mount is measured by DOM inventory,
 * recorded above and in the PR.
 */

const LOBBY = 'src/components/draft/draft-lobby.tsx'
const LAUNCHER = 'src/components/draft/mock-draft-launcher.tsx'
const ROOM = 'src/components/draft/draft-room.tsx'

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** Source with comments removed — these files DISCUSS their exits at length,
 *  and a pin a comment can satisfy is not pinning the code. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/** Index just past the JSX element opening at `start` (handles nested
 *  children and self-closing tags). */
function endOfElement(source: string, start: number): number {
  let i = start
  let depth = 0
  while (i < source.length) {
    if (source.startsWith('/>', i)) {
      depth -= 1
      i += 2
      if (depth === 0) return i
      continue
    }
    if (source.startsWith('</', i)) {
      depth -= 1
      i = source.indexOf('>', i) + 1
      if (depth === 0) return i
      continue
    }
    if (source[i] === '<' && /[A-Za-z]/.test(source[i + 1] ?? '')) {
      depth += 1
      i += 1
      continue
    }
    i += 1
  }
  return source.length
}

/** Every `<PageHeader …/>` element removed. See the docblock: the exits have
 *  to survive this, today (it renders nothing) and after DR.2 (it is gone). */
function withoutPageHeader(rel: string): string {
  let out = code(rel)
  for (;;) {
    const start = out.indexOf('<PageHeader')
    if (start === -1) return out
    out = out.slice(0, start) + out.slice(endOfElement(out, start))
  }
}

/** The `{<cond> && ( … )}` block removed, so "the exit is not behind this
 *  gate" is pinned by construction rather than by reading. */
function withoutGate(source: string, cond: string): string {
  const marker = `{${cond} && (`
  const start = source.indexOf(marker)
  if (start === -1) throw new Error(`gate not found: ${marker}`)
  let i = start + marker.length - 1 // at the '('
  let depth = 0
  for (; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) break
    }
  }
  return source.slice(0, start) + source.slice(i + 1)
}

/** The literal exit link both surfaces now carry. */
const EXIT = /<Link href=\{`\/app\/leagues\/\$\{leagueId\}`\}>\s*Back to league\s*<\/Link>/

describe('the chrome-free lobby carries its own exit (R340 → DR.7(4): the bar)', () => {
  it('mounts DraftCommandBar — whose Exit Draft is unconditional (Q13)', () => {
    // The exit is the bar's: `draft-command-bar.test.ts` pins that Exit
    // Draft survives the deletion of every gate in the bar file, and the
    // ops golden pins `exit: true` on every row including the lobby ones.
    // `withoutPageHeader` is kept as a no-op guard: if a PageHeader ever
    // returns to the lobby it still cannot satisfy this pin.
    expect(withoutPageHeader(LOBBY)).toMatch(/<DraftCommandBar/)
  })

  it('the bar is not commissioner-gated — a plain member gets the same exit', () => {
    // The R340 defect shape, applied to the bar: with `{isCommish && …}`
    // removed, a member's lobby must still contain the way out. Before R340
    // the only survivor was the Practice CTA, which points DEEPER into the
    // room; today the survivor must be the bar mount.
    expect(withoutGate(withoutPageHeader(LOBBY), 'isCommish')).toMatch(/<DraftCommandBar/)
  })
})

describe('the chrome-free practice launcher carries its own exit (R340)', () => {
  it('has a Back-to-league link that does not come from PageHeader', () => {
    expect(withoutPageHeader(LAUNCHER)).toMatch(EXIT)
  })

  it('the exit sits above the pre-draft fork, so both arms keep it', () => {
    // `preDraft ? <form> : <notice>` are mutually exclusive; an exit inside
    // either arm is an exit the other arm does not have.
    const source = withoutPageHeader(LAUNCHER)
    const exitAt = source.search(EXIT)
    const forkAt = source.indexOf('{preDraft ?')
    expect(exitAt, 'exit link').toBeGreaterThan(-1)
    expect(forkAt, 'preDraft fork').toBeGreaterThan(-1)
    expect(exitAt).toBeLessThan(forkAt)
  })
})

describe("the resolver's own states keep the exits their docblock claims", () => {
  it('four or more in-card Back-to-league exits survive PageHeader deletion', () => {
    // `draft-room.tsx`'s docblock asserts the empty / problem / not-found /
    // post-draft arms each carry one. DR.7 sweeps these states inside the new
    // frame; this is the pin that keeps the claim true while it does.
    const matches = withoutPageHeader(ROOM).match(new RegExp(EXIT.source, 'g')) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(4)
  })
})

describe('the takeover state carries its exit AND the ruled takeover action (DR.6)', () => {
  it('DraftRoomTakenOver renders Back to league and "Use this tab instead"', () => {
    // The §9.3 v2.12 takeover state (D156 — newest tab wins): a released
    // tab renders THIS and nothing else, in the chrome-free frame — so an
    // exit-less takeover is the R340 dead-end class, and a takeover state
    // without its "Use this tab instead" button strands the user with no
    // way to take the room back (the ruling's own affordance). Scoped to
    // the component so a neighbour's exit can never satisfy it.
    const source = withoutPageHeader(ROOM)
    const start = source.indexOf('function DraftRoomTakenOver')
    expect(start, 'DraftRoomTakenOver found').toBeGreaterThan(-1)
    const nextFn = source.indexOf('function ', start + 'function DraftRoomTakenOver'.length)
    const slice = source.slice(start, nextFn === -1 ? source.length : nextFn)
    expect(slice).toMatch(EXIT)
    expect(slice).toContain('Use this tab instead')
  })
})

describe('the transient skeleton carries an exit too (DR.2’s deliberate call)', () => {
  it('DraftRoomSkeleton renders its own Back to league', () => {
    // DR.7(5)/R348 left the skeleton as the last exit-less resolver state,
    // "transient — decide deliberately". DR.2 decided YES (PROGRESS D176):
    // in the chrome-free frame a slow or hung fetch renders the skeleton
    // full-viewport with zero affordances, and a link costs one line. This
    // pin scopes the match to the component so a neighbour's exit can never
    // satisfy it.
    const source = withoutPageHeader(ROOM)
    const start = source.indexOf('function DraftRoomSkeleton')
    const end = source.indexOf('function DraftRoomProblem')
    expect(start, 'DraftRoomSkeleton found').toBeGreaterThan(-1)
    expect(end, 'DraftRoomProblem follows it').toBeGreaterThan(start)
    expect(source.slice(start, end)).toMatch(EXIT)
  })
})

/**
 * MP.5 — the STANDALONE arm, and the measurement that decided where it goes.
 *
 * The task named five *"Back to league"* links to re-point —
 * `draft-recap.tsx` ×3 and `mock-draft-launcher.tsx` ×2 (verified on `main`
 * @ `6e9e8d1`: `grep -n "Back to league" -r src` puts them at 143/235/555 and
 * 103/119 exactly). **Measured, none of the five is on a standalone mock's
 * path, so re-pointing any of them would send a LEAGUE mock's user to the
 * wrong place:**
 *
 *   - `MockDraftLauncher` takes `leagueId: string` and `detail: LeagueDetail`
 *     (both required) and is mounted only at `?practice=1` on the league
 *     draft route. There is no league-less way to render it.
 *   - `DraftRecap` takes `leagueId: string`, is mounted only under
 *     `/app/leagues/[leagueId]/draft/recap`, and refuses to render a body
 *     unless `draft.league_id === leagueId` — which a `league_id IS NULL`
 *     mock can never satisfy.
 *
 * So the standalone exits MP.5 actually owns are the ones on the surfaces it
 * builds: `MockRow`'s league-optional arm, and `/app/mocks` itself. Those are
 * pinned below. The recap's standalone half belongs to **MP.8**, which builds
 * `/app/mocks/[mockId]/report` — handed over as ledger row **F119** rather
 * than left implied (R51).
 */
describe('the standalone arm never offers a league exit (MP.5 / E79)', () => {
  const ROW_FILE = 'src/components/draft/mock-draft-launcher.tsx'
  const HOME = 'src/components/draft/mocks-home.tsx'

  /** `MockRow`'s body, so a neighbour in the same file cannot satisfy these. */
  function mockRowBody(): string {
    const source = code(ROW_FILE)
    const start = source.indexOf('export function MockRow')
    expect(start, 'MockRow found').toBeGreaterThan(-1)
    return source.slice(start)
  }

  it('every league-scoped URL in the row sits behind the league-optional arm', () => {
    // The defect this catches: a later edit adding an unconditional
    // `/app/leagues/...` link to the row, which would 404 (or redirect, with
    // the leagues flag off) for every standalone mock listed on /app/mocks.
    //
    // **R513 — the first version of this pin PASSED with exactly that edit
    // planted.** It walked BACKWARD from each URL (`lastIndexOf('leagueId
    // === null')`) and happily landed on an unrelated earlier ternary, so any
    // stray league URL after the first one satisfied it. A guard found by
    // scanning backwards is not the guard the URL is under. The fix is to
    // match the WHOLE conditional as one expression and require every league
    // URL to be inside one — proximity replaced by structure.
    const body = mockRowBody()
    const leagueUrls = body.match(/`\/app\/leagues\/[^`]*`/g) ?? []
    expect(leagueUrls.length, 'league URLs present to check').toBeGreaterThan(0)

    // `leagueId === null ? <standalone> : <league URL>` — the false arm is the
    // ONLY place a league URL may appear, and it must be THIS ternary's.
    const guardedArms =
      body.match(/leagueId === null\s*\?[^:]*:\s*`\/app\/leagues\/[^`]*`/g) ?? []
    const guardedUrls = guardedArms.map((arm) => arm.slice(arm.lastIndexOf('`/app/leagues/')))

    // Set equality, not a count: an unguarded URL is one this list misses.
    expect([...leagueUrls].sort()).toEqual([...guardedUrls].sort())
  })

  it('the standalone half points into /app/mocks, where MP.6 and MP.8 build', () => {
    const body = mockRowBody()
    expect(body).toContain('`/app/mocks/${row.id}`')
    expect(body).toContain('`/app/mocks/${row.id}/report`')
  })

  it('the practice home SOURCE builds no /app/leagues URL of its own', () => {
    // R519 — renamed to what it actually measures. The old name ("contains no
    // /app/leagues URL at all") was true of the FILE and false of the PAGE: a
    // league-attached row rendered here gets its URL from `MockRow`, not from
    // this file. What this pin really says is that the practice home never
    // hand-rolls a league route — the page-level half is `openBlockedReason`,
    // pinned below.
    expect(code(HOME)).not.toContain('/app/leagues')
  })

  it('the page disables an open control it knows goes nowhere (R515/R519)', () => {
    // The half the source pin above cannot see. Two rows can offer a control
    // that dead-ends — a standalone one (MP.6/MP.8 have not built the route)
    // and a league-attached one with the leagues flag off (the link silently
    // redirects to /app) — and BOTH must arrive at `MockRow` blocked. A
    // docblock disclosure is not a disclosure the user reads.
    const home = code(HOME)
    expect(home).toContain('openBlocked={openBlockedReason(row)}')
    const start = home.indexOf('function openBlockedReason')
    expect(start, 'openBlockedReason found').toBeGreaterThan(-1)
    const body = home.slice(start)
    expect(body).toMatch(/row\.league_id === null\s*\)?\s*return '/)
    expect(body).toMatch(/!featureFlags\.leagues\s*\)?\s*return '/)

    // …and the row honours it by disabling rather than by hiding: a hidden
    // control is a second dead end (nothing to press, nothing explained).
    const rowBody = mockRowBody()
    expect(rowBody).toMatch(/\{openBlocked \?/)
    expect(rowBody).toContain('disabled>')
  })

  it('the five shipped Back-to-league links are still exactly five, all league-only', () => {
    // Re-pointed by measurement rather than by count: the inventory is
    // unchanged BECAUSE none of it is reachable without a league. If a later
    // change makes either surface league-optional, this count moves and the
    // decision above gets re-taken instead of silently inherited.
    const recap = read('src/components/draft/draft-recap.tsx')
    const launcher = read(ROW_FILE)
    const count = (s: string) => (s.match(/Back to league/g) ?? []).length
    expect(count(recap)).toBe(3)
    expect(count(launcher)).toBe(2)
    // …and both surfaces still REQUIRE a league, which is why that is right.
    //
    // **R514 — this half was vacuous TWICE and the reviewer proved it**: it
    // used `read()` (so each file's docblock, which quotes `leagueId: string`
    // while explaining this very decision, satisfied it on its own), and
    // `/\bleagueId: string\b/` matches inside `leagueId: string | null` —
    // so widening either prop kept the suite green and the decision WAS
    // silently inheritable, the one thing this pin claims to prevent. That is
    // D241(8)'s lesson recurring on the sibling pin, which is why the fix is
    // structural: comments stripped, and the match anchored to end-of-line so
    // a union cannot satisfy it.
    // …and SCOPED to each entry point's own props block. Anchoring alone was
    // not enough — re-probing the R514 fix caught it a THIRD time: both files
    // contain inner helpers (`MockList`, `DraftRecapBody`, `RecapProblem`)
    // whose own `leagueId: string` satisfied a file-wide match while the
    // exported component's prop had been widened. A pin must name the symbol
    // it is about.
    const propsBlock = (source: string, name: string): string => {
      const start = source.indexOf(`interface ${name} {`)
      expect(start, `${name} found`).toBeGreaterThan(-1)
      const end = source.indexOf('\n}', start)
      expect(end, `${name} closes`).toBeGreaterThan(start)
      return source.slice(start, end)
    }
    const recapCode = code('src/components/draft/draft-recap.tsx')
    const launcherCode = code(ROW_FILE)
    expect(
      propsBlock(recapCode, 'DraftRecapProps'),
      'DraftRecap requires a league',
    ).toMatch(/^\s*leagueId: string\s*$/m)
    expect(
      propsBlock(launcherCode, 'MockDraftLauncherProps'),
      'MockDraftLauncher requires a league',
    ).toMatch(/^\s*leagueId: string\s*$/m)
    // The guard that makes DraftRecap unreachable for a NULL-league mock —
    // the OTHER half of why its three exits are correctly league-voiced.
    expect(recapCode).toContain('draft.league_id !== leagueId')
  })
})
