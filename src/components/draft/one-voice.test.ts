import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * **One state, one voice** — the DR.7 status-source table (spec §16.3
 * "say a thing once"; §16.5.4's v2.12 note: inside the draft room, the
 * 54px command bar is the banner surface and paused / MOCK / reconnecting
 * render there "and nowhere else in the room"; D154/D155).
 *
 * DR.2 shipped the bar with two DELIBERATE interim duplications on record
 * (PROGRESS D176(6)): a paused room said "paused" in the bar, the strip
 * badge AND the overlay's copy card; a mock room carried the bar's Mock
 * badge AND the stacked `MockBanner`. DR.7 retired the duplicates, and
 * this file is the pin that stops them coming back: for each state, the
 * ANNOUNCING copy lives in exactly one source file, asserted as an
 * enumerated set (the `room-entry.test.ts` dispositioned-enumeration
 * idiom) so a new teller fails the suite until it is dispositioned here.
 *
 * What the table does NOT flatten — sanctioned non-announcement sites,
 * each with its LAW citation, enumerated per state below:
 *   - the strip's LIVE/PAUSED badge and the strip's on-clock line are
 *     §16.4 zone 2's MANDATED band contents (the layout contract lists
 *     them by name) — they are chrome occupants, not "a banner or an
 *     overlay underneath" the bar, which is the say-once rule's own scope;
 *   - `PickClock`'s paused mode is kept by D155 in so many words ("the
 *     clock keeps its shipped paused rendering");
 *   - WHO paused is the D97 system post in draft chat — content, not
 *     chrome (the bar's status deliberately carries no attribution,
 *     D176(3));
 *   - the board's on-clock CELL label and the presence chip's "On clock"
 *     marker are object-local state at the thing itself (§16.3 one-glance
 *     clarity: fill/border/label on the object), not room-level
 *     announcements — pinned below as exact sets so they cannot silently
 *     grow into one.
 *
 * Source-level for the room-exits reason: `jsx: "preserve"` keeps Vite
 * from importing a `.tsx` here; the renders are measured by the DR.7 PR's
 * DOM inventories (one 'Draft paused' text node in a paused room, one
 * MOCK identity in a mock room, one reconnecting strip during an outage).
 */

const DRAFT_DIR = 'src/components/draft'
const OVERLAY = 'src/components/draft/pause-overlay.tsx'
const ROOM = 'src/components/draft/draft-room.tsx'
const LOBBY = 'src/components/draft/draft-lobby.tsx'
const BAR = 'src/components/draft/draft-command-bar.tsx'
const BANNERS = 'src/components/leagues/status-banners.tsx'

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** Source with comments removed — these files DISCUSS the retired copy at
 *  length, and a pin a comment can satisfy (or redden) pins nothing. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

function code(rel: string): string {
  return stripComments(read(rel))
}

/** Every non-test source file in the draft component dir. */
function draftSourceFiles(): string[] {
  return readdirSync(path.resolve(process.cwd(), DRAFT_DIR))
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.test.'))
    .sort()
}

/** The draft-dir files whose CODE (comments stripped) contains `needle`. */
function draftFilesContaining(needle: string): string[] {
  return draftSourceFiles().filter((f) => code(`${DRAFT_DIR}/${f}`).includes(needle))
}

// ---------------------------------------------------------------------------
// The status-source table: state → the ONE announcing site (DR.7 DoD)
// ---------------------------------------------------------------------------

/**
 * Stored as literals. `announcedBy` is the exact set of draft-dir files
 * allowed to carry each needle in code — one entry per state unless a row
 * says why not (each extra entry is a disposition, not a leak).
 */
const STATUS_SOURCE: {
  state: string
  needle: string
  announcedBy: string[]
  why: string
}[] = [
  {
    state: 'paused (words)',
    needle: 'Draft paused',
    announcedBy: ['command-bar-ops.ts'],
    why: 'the bar status line — D155 retired the overlay copy',
  },
  {
    state: 'paused (mock words)',
    needle: 'Practice paused',
    announcedBy: ['command-bar-ops.ts'],
    why: 'same line, mock arm (D154 identity + D155)',
  },
  {
    state: 'mock (banner mount)',
    needle: '<MockBanner',
    announcedBy: ['draft-recap.tsx'],
    why:
      'the ROOM identity is the bar badge (D154 — banner absorbed); the recap is a ' +
      'SHELL page with no bar (Q12: not a draft surface), so its banner stays',
  },
  {
    state: 'reconnecting (mount)',
    needle: '<ReconnectingBanner',
    announcedBy: ['draft-command-bar.tsx'],
    why: 'the §16.5.4 v2.12 note — in the bar, one strip not a stack (DR.7(3))',
  },
  {
    state: 'on the clock (announcement)',
    needle: "You're on the clock",
    announcedBy: ['status-strip-ops.ts'],
    why: "the strip's LEFT edge is the ruled announcement site (requirement 3, D149)",
  },
  {
    state: 'on the clock (object-local label)',
    needle: "'On the clock'",
    announcedBy: ['draft-pick.tsx', 'status-strip-ops.ts'],
    why:
      'TWO dispositioned entries: the current board CELL labels itself (object-local ' +
      "state, §16.3 one-glance) and the strip's someone-else arm ('On the clock · Team')",
  },
  {
    state: 'on the clock (object-local label — unquoted companion)',
    needle: 'On the clock',
    announcedBy: ['draft-pick.tsx', 'status-strip-ops.ts'],
    why:
      'R398: the quoted needle above matches STRING LITERALS only, so a future teller ' +
      'written as bare JSX text (>On the clock<) would slip past it — this companion ' +
      'sweeps the raw substring and pins the same two-file set (case-sensitive, so ' +
      `"You're on the clock" stays the strip row's needle, not this one's)`,
  },
  {
    state: 'on the clock (seat marker)',
    needle: 'On clock<',
    announcedBy: ['presence-bar.tsx'],
    why: 'the presence chip marks the SEAT (color-independent status, §16.3) — JSX text, hence the closing-bracket needle',
  },
  {
    state: 'lobby phase (words)',
    needle: 'Draft scheduled',
    announcedBy: ['command-bar-ops.ts'],
    why: "the lobby bar's status (DR.7(4)) — the lobby card's badge retired into it",
  },
]

describe('the status-source table — each state announced by exactly one dispositioned set', () => {
  for (const row of STATUS_SOURCE) {
    it(`${row.state} → ${row.announcedBy.join(' + ')}`, () => {
      expect(draftFilesContaining(row.needle), row.why).toEqual(row.announcedBy)
    })
  }

  it('the reconnecting COPY is single-sourced in the catalog (the exported constants)', () => {
    // The words live in status-banners.tsx — BOTH forms (the full sentence
    // and the sub-`sm` compact form, D176(5)) — and the bar renders the
    // CONSTANTS, never a re-spelled literal. A second copy string (the M2
    // room passed its own children) fails these pins.
    const banners = code(BANNERS)
    expect(banners).toContain("RECONNECTING_COPY = 'Reconnecting — syncing the room…'")
    expect(banners).toContain("RECONNECTING_COPY_COMPACT = 'Reconnecting…'")
    expect(draftFilesContaining('Reconnecting')).toEqual(['draft-command-bar.tsx'])
    const bar = code(BAR)
    expect(bar).toContain('{RECONNECTING_COPY_COMPACT}')
    expect(bar).toContain('{RECONNECTING_COPY}')
    expect(bar).not.toMatch(/['"`]Reconnecting/)
  })
})

// ---------------------------------------------------------------------------
// The paused overlay is VISUAL ONLY (D155)
// ---------------------------------------------------------------------------

describe('the paused overlay illustrates and never narrates (D155)', () => {
  const overlay = code(OVERLAY)

  it('carries NO copy, no badge, no button — a dim layer and nothing else', () => {
    for (const retired of [
      'Draft paused',
      'Practice paused',
      'Paused',
      'Resume',
      'frozen',
      '72 hours',
      '<Badge',
      '<Button',
    ]) {
      expect(overlay, `retired voice back in the overlay: ${retired}`).not.toContain(retired)
    }
  })

  it('is hidden from assistive tech — the bar status line is the ONE announcement', () => {
    // The M2 overlay was `role="status"` + aria-label "Draft paused": a
    // second live announcement beside the bar's. Visual-only means AT
    // hears the pause exactly once.
    expect(overlay).toContain('aria-hidden="true"')
    expect(overlay).not.toMatch(/role=/)
  })

  it('the room mounts it bare — no clock, no canResume, no onResume to lose again', () => {
    const room = code(ROOM)
    expect(room).toMatch(/\{paused && <DraftPauseOverlay \/>\}/)
    expect(room).not.toContain('canResume')
    expect(room).not.toContain('onResume')
  })
})

// ---------------------------------------------------------------------------
// The room mounts no banner — the bar is the banner surface (§16.5.4 v2.12)
// ---------------------------------------------------------------------------

describe('the room body carries no banner of its own', () => {
  const room = code(ROOM)

  it('references neither MockBanner nor ReconnectingBanner nor the catalog import', () => {
    expect(room).not.toContain('MockBanner')
    expect(room).not.toContain('ReconnectingBanner')
    expect(room).not.toContain('status-banners')
  })

  it('feeds the bar the SAME reconnecting trigger the M2 banner used (§9.3 untouched)', () => {
    // The state moved; the condition did not. `useDraftRoom`'s
    // refetch-then-resubscribe semantics are out of this lane's reach
    // (DR §4.5) — this pin is the wire, connection === 'reconnecting'.
    expect(room).toMatch(/reconnecting: connection === 'reconnecting'/)
  })
})

// ---------------------------------------------------------------------------
// The lobby speaks through the bar (DR.7(4))
// ---------------------------------------------------------------------------

describe('the pre-start lobby has the bar as its one voice', () => {
  const lobby = code(LOBBY)

  it('mounts DraftCommandBar with the lobby arm', () => {
    expect(lobby).toMatch(/<DraftCommandBar/)
    expect(lobby).toMatch(/lobby: true/)
  })

  it('carries no PageHeader and no app-header import (the R340 no-op is gone)', () => {
    expect(lobby).not.toMatch(/<PageHead/)
    expect(lobby).not.toContain('@/components/layout/app-header')
  })

  it('tells the phase once — no in-card "Draft scheduled" badge, no second exit', () => {
    // The phase words live in the bar (the table above); the card keeps
    // the countdown HERO (§16.5.1's scheduled row), which the bar does not
    // carry — content and announcement split cleanly. And with the bar's
    // unconditional Exit Draft present, an in-card Back-to-league is a
    // second exit voice: retired (room-exits.test.ts pins the bar mount).
    expect(lobby).not.toContain('Draft scheduled')
    expect(lobby).not.toContain('Back to league')
  })
})
