import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Source-level pins for the DR.4 status strip + full-width board (spec
 * §16.4 zones 2–3; D149/D151/D152; Chris's requirements (1) and (3)) — the
 * `draft-command-bar.test.ts` idiom: `jsx: "preserve"` keeps Vite from
 * importing a `.tsx` here, so what these pins assert is structural (what is
 * in the returned tree, in what order, and what is ABSENT), not that React
 * mounted it — the mounts are measured by the DR.4 PR's browser pass.
 *
 * What is pinned, and why:
 *   - the strip's physical contract — ONE `h-header` band, ink rule
 *     beneath, NO resting shadow (the strip is not one of D152's two
 *     sanctioned exceptions);
 *   - requirement (3) as ORDER: on-clock line leading, then badge, then
 *     Round/Pick, presence in the middle, the clock LAST at the right edge
 *     (the ops golden pins the same assignment at the model layer);
 *   - requirement (1): no `_340px` rail track anywhere in the room — the
 *     desktop board region is a plain full-width block;
 *   - the scroll contract: the live room's root is non-scrolling
 *     (`overflow-hidden`) and the board zone is the room's only page
 *     scroller (the one other `overflow-y-auto` is the mobile lists
 *     Sheet — an overlay, enumerated below so a third can't sneak in);
 *   - the five parked panels (DR.5's dock tenants) staying exported AND
 *     still mounted by the room's mobile branch — parked, not deleted;
 *   - the mobile treatment surviving untouched (the four-way Segment is
 *     DR.5's to replace, NOT DR.4's to delete — v2.12 reconciliation);
 *   - R270's fix in the board grid: no invalid `role="table"` /
 *     `columnheader` skeleton; an aria-label'd focusable region instead.
 */

const STRIP = 'src/components/draft/draft-status-strip.tsx'
const ROOM = 'src/components/draft/draft-room.tsx'
const GRID = 'src/components/draft/draft-board-grid.tsx'

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** Source with comments removed — these files DISCUSS their layout at
 *  length (the room's docblock names the retired 340px grid), and a pin a
 *  comment can satisfy (or violate) is not pinning the code. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('the strip’s physical contract (spec §16.4 zone 2; D149/D152)', () => {
  const source = code(STRIP)

  it('is ONE band at the h-header token, with the ink rule as its separation', () => {
    expect(source).toMatch(/h-header/)
    expect(source).not.toMatch(/h-\[58px\]/)
    expect(source).toMatch(/border-b border-ink/)
    expect(source).toMatch(/shrink-0/)
  })

  it('does NOT rest elevated — no shadow of any kind in the strip', () => {
    // Not even an interaction-prefixed one exists here today; the strip is
    // not one of D152's two sanctioned resting shadows (bar + dock panels).
    expect(source).not.toMatch(/shadow/)
  })

  it('carries the strip contents: badge, Round/Pick, presence, clock', () => {
    expect(source).toMatch(/<Badge/)
    expect(source).toMatch(/Round /)
    expect(source).toMatch(/<PresenceBar/)
    expect(source).toMatch(/<PickClock/)
  })
})

describe('requirement (3): on-clock LEFT, clock RIGHT (D149)', () => {
  const source = code(STRIP)

  it('renders on-clock → badge → Round/Pick → presence → clock, in that order', () => {
    const idxOnClock = source.indexOf('model.left.onClock.text')
    const idxBadge = source.indexOf('<Badge')
    const idxRound = source.indexOf('Round ')
    const idxPresence = source.indexOf('<PresenceBar')
    const idxClock = source.indexOf('<PickClock')
    expect(idxOnClock).toBeGreaterThan(-1)
    expect(idxBadge).toBeGreaterThan(idxOnClock)
    expect(idxRound).toBeGreaterThan(idxBadge)
    expect(idxPresence).toBeGreaterThan(idxRound)
    expect(idxClock).toBeGreaterThan(idxPresence)
  })

  it('the clock is the band’s LAST element — the right edge by construction', () => {
    expect(source).toMatch(/<PickClock[\s\S]*?\/>\s*<\/section>/)
    expect(source).toMatch(/ml-auto shrink-0/)
  })

  it('on-clock emphasis is text color/weight — never a shadow (D152)', () => {
    expect(source).toMatch(/text-accent-strong/)
  })

  it('the "Your next" hint keeps its shipped hidden sm:inline responsiveness', () => {
    expect(source).toMatch(/hidden shrink-0 text-\[9px\] text-n-3 sm:inline/)
  })
})

describe('the room hosts the strip and the status Card stays extracted (DR.4)', () => {
  const room = code(ROOM)

  it('mounts DraftStatusStrip with the live on-clock derivation', () => {
    expect(room).toMatch(/<DraftStatusStrip/)
    expect(room).toMatch(/youAreOnClock,/)
    expect(room).toMatch(/onClockTeamName: onClockTeam\?\.name \?\? null/)
  })

  it('no longer renders PresenceBar or PickClock itself — the strip does', () => {
    expect(room).not.toMatch(/<PresenceBar/)
    expect(room).not.toMatch(/<PickClock/)
  })
})

describe('requirement (1): the full-width board — the 340px rail is GONE', () => {
  const room = code(ROOM)

  it('contains no 340px track and no two-column room grid', () => {
    expect(room).not.toMatch(/_340px/)
    expect(room).not.toMatch(/grid-cols-\[minmax\(0,1fr\)/)
  })

  it('the desktop board region is a plain full-width block', () => {
    expect(room).toMatch(/className="hidden min-w-0 lg:block">\{boardCard\}/)
  })
})

describe('the scroll contract: the board zone owns the room’s only vertical scroll (DR.4)', () => {
  const room = code(ROOM)

  it('the live room’s root is a non-scrolling h-full column', () => {
    expect(room).toMatch(/className="flex h-full min-h-0 flex-col overflow-hidden"/)
  })

  it('the board zone is the one page scroller; the only other overflow-y-auto is the mobile lists Sheet overlay', () => {
    expect(room).toMatch(/className="min-h-0 flex-1 overflow-y-auto"/)
    const occurrences = room.match(/overflow-y-auto/g) ?? []
    expect(occurrences).toHaveLength(2)
    // The second, enumerated: the bottom-sheet host for MyListsPanel.
    expect(room).toMatch(/side="bottom" className="max-h-\[80vh\] overflow-y-auto"/)
  })

  it('the strip adds no scroll region of its own', () => {
    expect(code(STRIP)).not.toMatch(/overflow-y/)
  })

  it('PresenceBar’s scroll container is positioned, so its sr-only absolutes cannot leak page scrollbars', () => {
    // Measured at 1280 (DR.4 browser pass): without `relative`, the chips'
    // absolute sr-only spans anchor to the viewport, escape the overflow
    // clip, and grow document.scrollWidth — giving the PAGE the scrollbars
    // the board zone is supposed to own.
    expect(code('src/components/draft/presence-bar.tsx')).toMatch(
      /relative flex gap-1\.5 overflow-x-auto/,
    )
  })
})

describe('the five panels are PARKED for DR.5, not deleted', () => {
  const room = code(ROOM)

  it('each remains exported from its own module', () => {
    expect(code('src/components/draft/available-players.tsx')).toMatch(
      /export function AvailablePlayers/,
    )
    expect(code('src/components/draft/my-queue.tsx')).toMatch(/export function MyQueue/)
    expect(code('src/components/draft/my-lists-panel.tsx')).toMatch(
      /export function MyListsPanel/,
    )
    expect(code('src/components/draft/my-roster-tracker.tsx')).toMatch(
      /export function MyRosterTracker/,
    )
    expect(code('src/components/draft/draft-chat.tsx')).toMatch(/export function DraftChat/)
  })

  it('each is still mounted by the room (the mobile branch hosts all five)', () => {
    expect(room).toMatch(/<AvailablePlayers/)
    expect(room).toMatch(/<MyQueue/)
    expect(room).toMatch(/<MyListsPanel/)
    expect(room).toMatch(/<MyRosterTracker/)
    expect(room).toMatch(/<DraftChat/)
  })
})

describe('mobile is untouched: DR.5 replaces the pane switcher, DR.4 does not (v2.12)', () => {
  const room = code(ROOM)

  it('keeps the four-way Segment: Players / Queue / Full board / Chat', () => {
    expect(room).toMatch(/aria-label="Room view"/)
    for (const label of ['Players', 'Queue', 'Full board', 'Chat']) {
      expect(room).toContain(`>\n              ${label}\n            </SegmentItem>`)
    }
    expect(room).toMatch(/const \[mobilePane, setMobilePane\] = useState<MobilePane>/)
  })

  it('keeps the picks ticker and the compact "My picks" rail (§16.4’s board-zone density rule)', () => {
    expect(room).toMatch(/aria-label="Recent picks"/)
    expect(room).toMatch(/>My picks<\/span>/)
    expect(room).toMatch(/<MyRosterTracker\s+compact/)
  })
})

describe('R270 discharged: the board grid’s ARIA is valid (F55’s first member)', () => {
  const grid = code(GRID)

  it('no table skeleton — the invalid role="table"/columnheader pair is gone', () => {
    expect(grid).not.toMatch(/role="table"/)
    expect(grid).not.toMatch(/columnheader/)
  })

  it('is an aria-label’d, keyboard-focusable scroll region instead', () => {
    expect(grid).toMatch(/role="region"/)
    expect(grid).toMatch(/aria-label="Draft board"/)
    expect(grid).toMatch(/tabIndex=\{0\}/)
  })

  it('keeps its own horizontal scroll and its minmax(96px, 1fr) columns (D151)', () => {
    expect(grid).toMatch(/overflow-x-auto/)
    expect(grid).toMatch(/minmax\(96px, 1fr\)/)
  })
})
