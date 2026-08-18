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

describe('the chrome-free lobby carries its own exit (R340)', () => {
  it('has a Back-to-league link that does not come from PageHeader', () => {
    expect(withoutPageHeader(LOBBY)).toMatch(EXIT)
  })

  it('the exit is not commissioner-gated — a plain member sees it', () => {
    // The specific defect: with `{isCommish && …}` removed, a member's lobby
    // must still contain a way out. Before R340 the only survivor was the
    // Practice CTA, which points DEEPER into the room.
    expect(withoutGate(withoutPageHeader(LOBBY), 'isCommish')).toMatch(EXIT)
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
