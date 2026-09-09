import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { abbreviateName } from './draft-board-ops'

/**
 * Source-level pins for the auction ROOM — M3 task L.C3.1 (spec §16.2
 * `auction-block.tsx`, §16.3, §16.4's v2.10/v2.12 callouts; tasks-M3
 * D135/D140; PROGRESS F56's room half).
 *
 * The `draft-dock.test.ts` idiom: `jsx: "preserve"` keeps Vite from
 * importing a `.tsx` here, so these pins are structural — what is in the
 * tree, what is ABSENT, and where the numbers come from. The behaviour is
 * pinned by the ops goldens (`auction-block-ops.test.ts`,
 * `room-health-ops.test.ts`, `auction-budget.test.ts`) and measured by this
 * PR's browser pass.
 *
 * Five things this suite exists to stop:
 *   1. the D135 fork growing a SECOND site, or the auction quietly falling
 *      back to the snake board;
 *   2. the deleted fixture room or its `mock-draft.ts` types coming back;
 *   3. the block deciding money, opening a channel, printing a second
 *      clock, or growing a commissioner control (§8.7's one door is the
 *      bar's Draft Options);
 *   4. F56's room half regressing — an absent-draft branch reachable while
 *      the fetch is failing;
 *   5. the D140 Targets sweep half-reverting, one string at a time.
 */

const ROOM = 'src/components/draft/draft-room.tsx'
const BLOCK = 'src/components/draft/auction-block.tsx'
const OPS = 'src/components/draft/auction-block-ops.ts'
const POOL = 'src/components/draft/available-players.tsx'
const DRAFT_DIR = 'src/components/draft'

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** Source with comments stripped — every docblock here NAMES the things it
 *  forbids, so a pin a comment can satisfy is not pinning the code. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

// ---------------------------------------------------------------------------
// 1. The D135 fork point
// ---------------------------------------------------------------------------

describe('D135: one shell, one fork, an auction centre stage', () => {
  const room = code(ROOM)

  it('branches on draft_type === "auction" EXACTLY once, and mounts the block there', () => {
    expect(occurrences(room, "draft.draft_type === 'auction'")).toBe(1)
    expect(occurrences(room, '<AuctionBlock')).toBe(1)
  })

  it('the auction never renders the snake pick grid, and vice versa', () => {
    // `boardCard` (the grid) and `auctionCard` are mutually exclusive
    // branches of one `isAuction` conditional — pinned as the shape.
    expect(room).toMatch(/\{isAuction \? \(/)
    expect(room).toMatch(/const auctionCard = isAuction \?/)
    // The board grid is still the SNAKE arm's, unconditionally.
    expect(occurrences(room, '<DraftBoardGrid')).toBe(1)
  })

  it('the room keeps ONE command bar, ONE status strip and ONE dock across both draft types', () => {
    expect(occurrences(room, '<DraftCommandBar')).toBe(1)
    expect(occurrences(room, '<DraftStatusStrip')).toBe(1)
    expect(occurrences(room, '<DraftDock')).toBe(1)
    // DR.3's no-second-door pin, re-asserted from the auction side.
    expect(occurrences(room, '<CommishDraftPanel')).toBe(1)
  })

  it('the SHARED status strip prints no board coordinate in an auction room (R427)', () => {
    // §16.4 zone 2 lists the strip's contents — LIVE/PAUSED, Round & Pick,
    // draft order, presence, clock. "Your next pick" is not among them, and
    // in an auction it is not merely off-contract: `nextPickNumberForTeam`
    // walks pure board geometry while the auction rotation skips filled
    // rosters (§8.6.7(c)/E27), so the two coincide in lap 1 and diverge for
    // good after. The hint has exactly ONE producer, and it is auction-gated.
    expect(occurrences(room, 'nextPickNumberForTeam(')).toBe(1)
    const memoStart = room.indexOf('const myNextPick = useMemo(')
    expect(memoStart).toBeGreaterThan(-1)
    const memo = room.slice(memoStart, room.indexOf('const makePick', memoStart))
    expect(memo).toMatch(/isAuction\s*\n?\s*\?\s*null/)
    // …and the strip is fed from that one value, so suppressing it there
    // suppresses the hint (`status-strip-ops.ts`: a null label ⇒ no hint,
    // pinned by that module's golden table).
    expect(room).toContain(
      'myNextPickLabel: myNextPick !== null ? pickLabel(myNextPick, teamCount) : null,',
    )
  })
})

// ---------------------------------------------------------------------------
// 2. The fixture room is gone
// ---------------------------------------------------------------------------

describe('D135: the fixture room dies, and `abbreviateName` survives it', () => {
  it('auction-draft-room.tsx and mock-draft.ts no longer exist', () => {
    expect(existsSync(path.resolve(process.cwd(), 'src/components/draft/auction-draft-room.tsx')))
      .toBe(false)
    expect(existsSync(path.resolve(process.cwd(), 'src/components/draft/mock-draft.ts')))
      .toBe(false)
  })

  it('nothing in the tree still imports from `./mock-draft` or names AuctionDraftRoom', () => {
    // Suites are excluded: THIS file names both strings in order to forbid
    // them, and a sweep that trips on its own assertions pins nothing.
    const shipped = readdirSync(path.resolve(process.cwd(), DRAFT_DIR)).filter(
      (file) => !file.includes('.test.'),
    )
    expect(shipped.length).toBeGreaterThan(30)
    for (const file of shipped) {
      const source = read(path.join(DRAFT_DIR, file))
      expect(source).not.toContain("from './mock-draft'")
      expect(source).not.toContain('AuctionDraftRoom')
    }
  })

  it('the helper moved to the board’s own ops layer, behaviour byte-identical', () => {
    // The four importers R304 counted now import it from `draft-board-ops`.
    for (const importer of [
      'draft-room.tsx',
      'draft-board-grid.tsx',
      'draft-recap.tsx',
      'my-roster-tracker.tsx',
    ]) {
      expect(read(path.join(DRAFT_DIR, importer))).toContain('abbreviateName')
    }
    expect(abbreviateName('Christian McCaffrey')).toBe('C. McCaffrey')
    expect(abbreviateName('Amon-Ra St. Brown')).toBe('A. St. Brown')
    // A mononym is returned unchanged rather than mangled.
    expect(abbreviateName('Ocho')).toBe('Ocho')
  })
})

// ---------------------------------------------------------------------------
// 3. What the block must not become
// ---------------------------------------------------------------------------

describe('the block renders; it never decides, subscribes, or governs', () => {
  const block = code(BLOCK)
  const ops = code(OPS)

  it('every number comes from the parity-pinned mirror — no budget arithmetic here', () => {
    expect(block).toContain("from './auction-budget'")
    expect(block).toContain('teamBudgets(')
    // §4.7: `draft_team_budget` (084) is the ONE authority. A local
    // re-derivation is the drift this rule exists to prevent.
    expect(block).not.toMatch(/openSlots\s*-\s*1/)
    expect(ops).not.toMatch(/openSlots\s*-\s*1/)
  })

  it('opens no channel and mints no action_id — the room’s ONE channel and the hooks own both', () => {
    expect(block).not.toContain('.channel(')
    expect(block).not.toContain('createBrowserClient')
    expect(block).not.toContain('randomUUID')
  })

  it('prints NO second countdown — §16.3 say-a-thing-once (the strip’s PickClock is the clock)', () => {
    expect(block).not.toContain('PickClock')
    expect(block).not.toContain('formatClockMs')
  })

  it('mounts no commissioner surface — §8.7’s one door is the bar’s Draft Options (v2.12)', () => {
    for (const forbidden of ['CommishDraftPanel', 'DraftOptionsMenu', 'usePauseResumeDraft']) {
      expect(block).not.toContain(forbidden)
    }
  })

  it('carries no resting shadow — the three §16.4 marks are fill and border (CLAUDE.md)', () => {
    for (const line of block.split('\n')) {
      if (!line.includes('shadow-hard')) continue
      // `shadow` is allowed only behind an interaction prefix or on the
      // Button primitive's own `shadow` prop (its variants own the rule).
      expect(line).toMatch(/hover:|active:|focus-visible:|group-hover:/)
    }
    expect(block).toMatch(/border-accent bg-accent-soft/)
    expect(block).toMatch(/border-positive bg-positive-soft/)
  })

  it('the anti-snipe math is wall-clock-free in the ops layer (the §9.3 grep-able rule)', () => {
    expect(ops).not.toContain('Date.now()')
    // The component samples and injects, exactly like `pick-clock.tsx`.
    expect(block).toContain('antiSnipeView(')
  })

  it('the three marks each carry a WORD as well as a colour (§16.3 colour-independent status)', () => {
    // R433: matched loosely on purpose — the JSX indentation of a badge is
    // Prettier's business, and pinning it by exact whitespace breaks this
    // suite for a reflow that changed nothing about the room.
    expect(block).toMatch(/>\s*You\s*<\/Badge>/)
    expect(block).toMatch(/>\s*Nominating\s*<\/Badge>/)
    expect(block).toMatch(/>\s*High bid\s*<\/Badge>/)
  })

  it('the two MOVING marks resolve to one fill, in the code (R432)', () => {
    // 085/087 set `high_bidder_team_id = on_clock_team_id` at nomination
    // open, so nominating + latest-bid land on the same column every time a
    // nomination opens. The precedence must be written, not left to
    // tailwind-merge's last-pair-wins: money over nomination.
    expect(block).toMatch(
      /column\.isLatestBid\s*\n?\s*\?\s*'border-positive bg-positive-soft'\s*\n?\s*:\s*column\.isNominating && 'border-accent bg-accent-soft'/,
    )
    // …and the colour-independent status survives the merge because the
    // BADGES are independent of it — neither is gated on the other.
    expect(block).toContain('{column.isNominating && <Badge variant="stroke-purple">')
    expect(block).toContain('{column.isLatestBid && <Badge variant="stroke-green">')
  })
})

// ---------------------------------------------------------------------------
// 4. F56's room half
// ---------------------------------------------------------------------------

describe('F56 room half: an absent draft is only honest when the fetch is healthy', () => {
  const room = code(ROOM)

  it('the no-banner no-draft branches are gated on `absentDraftIsHonest`, plainly', () => {
    // Two gates: the `!draftId` cascade's recap-pointer / no-draft-empty tail
    // and the resolved-but-missing-row arm.
    expect(occurrences(room, 'absentDraftIsHonest(health)')).toBe(2)
    // R430: a COUNT alone is satisfied by an inert gate. Pin the SHAPE — the
    // gate is the whole condition, never `… && somethingElse`.
    expect(occurrences(room, 'if (!absentDraftIsHonest(health)) {')).toBe(2)
    // Each gate precedes the branch it protects.
    const firstGate = room.indexOf('if (!absentDraftIsHonest(health)) {')
    expect(firstGate).toBeGreaterThan(-1)
    expect(firstGate).toBeLessThan(room.indexOf('POST_DRAFT_LEAGUE_STATUSES.has'))
    expect(room.lastIndexOf('if (!absentDraftIsHonest(health)) {')).toBeLessThan(
      room.indexOf('title="Draft not found"'),
    )
  })

  it('the D94 scheduled lobby is deliberately NOT behind the gate (R429 → D192)', () => {
    // The lobby mounts the command bar — §16.5.4 v2.12's one banner surface —
    // so `degraded` renders there as the SPEC's degraded state (last-good
    // data + banner) instead of evicting a scheduled lobby to an error card.
    // Putting it back behind the gate re-opens the rule-1/rule-2 collision
    // AND makes its `stale` prop a constant `false` again.
    const noDraftArm = room.indexOf('if (!draftId) {')
    const scheduledBranch = room.indexOf("detail.data.league.status === 'scheduled'", noDraftArm)
    const gateAfter = room.indexOf('if (!absentDraftIsHonest(health)) {', noDraftArm)
    expect(noDraftArm).toBeGreaterThan(-1)
    expect(scheduledBranch).toBeGreaterThan(noDraftArm)
    expect(scheduledBranch).toBeLessThan(gateAfter)
  })

  it('a failing refetch over last-good data keeps the room and raises the banner', () => {
    // The error CARD is now conditioned on holding nothing…
    expect(room).toContain('room.isError && room.data === undefined')
    expect(room).toContain('if (!detail.data) {')
    // …and the degraded state reaches the bar, the room's one banner surface,
    // from all THREE surfaces that mount it: the D94 lobby, the scheduled-row
    // lobby, and the live room. TWO read the mount's own health; the third —
    // the scheduled-row lobby — reads the RESOLVED room health since R944
    // (the pin below owns that wiring). Three surfaces, two sources, and the
    // sum is what this line asserts.
    expect(
      occurrences(room, "health === 'degraded'") + occurrences(room, "roomHealth === 'degraded'"),
    ).toBe(3)
    expect(occurrences(room, "health === 'degraded'")).toBe(2)
  })

  it('the scheduled-row lobby reads the RESOLVED room health, not the mount’s (R944)', () => {
    // R944: `renderScheduled`'s `stale` used to close over the MOUNT's
    // league-detail health, while `DraftRoomResolved` computes the combined
    // room health and wires it only to the bar and the no-draft gates. So
    // the one pre-start surface whose own query can fail — the state R943
    // produces — rendered a confident "Starts in …" and said nothing. A
    // substring count cannot catch this (`roomHealth === 'degraded'` contains
    // `health === 'degraded'`), so pin the wiring itself, end to end.
    expect(room).toContain('renderScheduled(draft, room.onlineTeamIds, health)')
    expect(room).toContain('renderScheduled={(draft, onlineTeamIds, roomHealth) => (')
    expect(room).toContain("stale={roomHealth === 'degraded'}")
    // The value passed is the COMBINED one — the same `health` the bar and
    // the `absentDraftIsHonest` gates read, not `contextHealth`.
    expect(room).toContain('const health = worstHealth(')
    expect(room).not.toContain('renderScheduled(draft, room.onlineTeamIds, contextHealth)')
    // The D94 no-row lobby keeps the mount's own health: there is no room
    // query behind it (no drafts row ⇒ no draft id ⇒ no room). F307.
    const noDraftArm = room.indexOf('if (!draftId) {')
    const d94Lobby = room.indexOf("stale={health === 'degraded'}", noDraftArm)
    expect(d94Lobby).toBeGreaterThan(noDraftArm)
    expect(d94Lobby).toBeLessThan(room.indexOf('<DraftRoomResolved'))
  })

  it('the retry offered by the fetch-failure surface refetches BOTH queries', () => {
    expect(room).toMatch(/const retryRoom = \(\) => \{/)
    expect(room).toContain('onRetry={retryRoom}')
  })
})

// ---------------------------------------------------------------------------
// 5. The D140 Targets sweep
// ---------------------------------------------------------------------------

describe('D140: “Targets” is the product’s word, and “queue” is the schema’s', () => {
  /** Every user-facing string literal in a swept file — JSX text, aria-label,
   *  title, placeholder, toast copy. Comments are stripped first. */
  const SWEPT = [
    'draft-room.tsx',
    'available-players.tsx',
    'my-queue.tsx',
    'my-lists-panel.tsx',
    'my-lists-panel-ops.ts',
    'best-available-card.tsx',
    'draft-queue-card.tsx',
    'draft-dock-ops.ts',
  ]

  it('no user-facing “queue” copy survives in the swept room files', () => {
    for (const file of SWEPT) {
      const source = code(path.join(DRAFT_DIR, file))
      // The copy shapes the sweep was scoped to (D140's own list): visible
      // JSX text, the two attribute forms, and the toast titles.
      for (const forbidden of [
        'Add to queue',
        'into my queue',
        'Load into queue',
        'Add remaining to queue',
        'Queue not updated',
        'My queue',
        'Your queue',
        'is queued',
        "'Queued'",
        'to your queue',
        'already queued',
        'no queue to build',
        'practice queue',
      ]) {
        expect(`${file}: ${source.includes(forbidden)}`).toBe(`${file}: false`)
      }
    }
  })

  it('the internal names are UNTOUCHED — D140’s ruled scope boundary', () => {
    const room = code(ROOM)
    // Query keys, hooks, props and the dock's tab ID all still say queue.
    expect(room).toContain('draftQueueKeys.queue(')
    expect(room).toContain('useUpdateDraftQueue')
    expect(room).toContain('queue: queueCard')
    expect(code(path.join(DRAFT_DIR, 'draft-dock-ops.ts'))).toContain("id: 'queue'")
    expect(code(POOL)).toContain('queuedIds')
  })

  it('the autopick explainer says Targets, in the one place §8.4 is cited', () => {
    expect(code(path.join(DRAFT_DIR, 'my-queue.tsx'))).toContain(
      'Timeouts draft from the top of your Targets first.',
    )
  })

  it('the pool is ONE component with two verbs, not a fork (CLAUDE.md)', () => {
    const pool = code(POOL)
    expect(pool).toContain('primaryActionLabel')
    expect(pool).toContain("primaryActionLabel = 'Draft'")
    const room = code(ROOM)
    expect(room).toContain("primaryActionLabel={isAuction ? 'Nominate' : undefined}")
    expect(occurrences(room, '<AvailablePlayers')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 6. The cheat sheet's per-player notes (§16.2 v2.10)
// ---------------------------------------------------------------------------

describe('cheat-sheet notes: rendered when present, no chrome when absent', () => {
  it('the read selects `notes` and the row renders it only when non-empty', () => {
    expect(code('src/hooks/use-league-lists.ts')).toContain(
      "'player_id, position, tier, notes'",
    )
    const panel = code(path.join(DRAFT_DIR, 'my-lists-panel.tsx'))
    expect(panel).toContain('const notes = row.notes?.trim()')
    // The guard is the whole feature: `{notes && …}` renders nothing at all
    // for a row without one (no empty container, no placeholder dash).
    expect(panel).toMatch(/\{notes && \(/)
  })
})

// ---------------------------------------------------------------------------
// 7. §8.6.9's beat retires on a CLOCK SAMPLE, never on a timer (AP.2 / R464)
// ---------------------------------------------------------------------------

describe('the uncontestable beat cannot outstay its 3 seconds (§16.5.4; R464)', () => {
  /**
   * THE DEFECT THIS PIN EXISTS TO CATCH, which shipped in AP.2's first
   * revision and was caught at review: the visibility decision read a `nowMs`
   * held in component STATE whose only writers were the initialiser and a
   * `setTimeout` callback. That makes the timeout **the sole writer that can
   * retire the message**, so any render at t+4000 with the timer not yet
   * fired still shows it — and background tabs clamp `setTimeout`, which
   * makes that ordinary rather than exotic. Measured trace from the review:
   * latched at 1000000, timer at +3000, visible at t+4000 AND t+9000.
   *
   * §16.5.4 is LAW that the beat is "exactly 3 seconds … on every client", so
   * the claim could not be withdrawn to match the behaviour — the code had to
   * move. The fix: the decision is computed from an instant sampled AT RENDER
   * through `systemTime`, so every render re-decides, and the timers only
   * cause renders. This pin is structural because `jsx: "preserve"` keeps a
   * `.tsx` out of a vitest import (the `draft-dock.test.ts` idiom); the
   * BEHAVIOUR of the decision is pinned in `auction-block-ops.test.ts`,
   * including the t+9000-with-no-timer case.
   */
  it('the decision is sampled at render, and no timer-written state can gate it', () => {
    const block = code(BLOCK)
    // The defective shape, named so it cannot come back by accident.
    expect(block).not.toContain('uncontestedBeatVisible(latched, nowMs)')
    // The decision reads the clock through D3's seam, in the render path.
    expect(block).toContain('uncontestedBeatSentence(')
    expect(block).toMatch(/uncontestedBeatSentence\(\s*latched,\s*systemTime\.now\(\)\.getTime\(\)/)
    // …and it does NOT depend on F97's unfixed raw clock: every clock read the
    // beat makes goes through `systemTime`. `useAntiSnipe` below still reads
    // `Date.now()` (F97), so this asserts the beat's own reads by slicing the
    // beat hook's body out and requiring none in it. NOTE the end marker is
    // `function useAntiSnipe`, a CODE token: `code()` strips comments on
    // purpose ("a pin a comment can satisfy is not pinning the code"), so a
    // comment marker would return -1 and slice to EOF — which is exactly how
    // the first draft of this pin swept up useAntiSnipe's clock reads and
    // failed for the wrong reason.
    const hook = block.slice(
      block.indexOf('function useUncontestedBeat'),
      block.indexOf('function useAntiSnipe'),
    )
    expect(hook.length).toBeGreaterThan(200)
    expect(hook).not.toContain('Date.now()')
    expect(occurrences(hook, 'systemTime.now()')).toBeGreaterThanOrEqual(2)
  })

  it('the timers only CAUSE renders — a boundary wake-up and a sampler while live', () => {
    const block = code(BLOCK)
    // The exact boundary keeps "exactly 3 seconds" exact; the interval keeps a
    // clamped or never-firing timeout from stranding the message on screen.
    expect(block).toContain('UNCONTESTED_BEAT_SAMPLE_MS')
    expect(block).toMatch(/setTimeout\(/)
    expect(block).toMatch(/setInterval\(/)
    // Both are torn down — a beat is at most 3s, so neither may outlive it.
    expect(block).toContain('clearTimeout(')
    expect(block).toContain('clearInterval(')
  })
})
