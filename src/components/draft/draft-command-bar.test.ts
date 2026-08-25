import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Source-level pins for the 54px command bar (tasks-DR DR.2; spec §16.4
 * zone 1, D149/D152/D154) — the same idiom as `room-exits.test.ts`:
 * `jsx: "preserve"` keeps Vite from importing a `.tsx` here, and what these
 * pins assert is structural (what is in the returned tree, and behind which
 * gate), not that React mounted it — the mounts are measured by the DR.2
 * PR's per-variant DOM inventories.
 *
 * What is pinned, and why:
 *   - the bar's physical contract — 54px token / ink fill / pinned /
 *     resting shadow with the D152 exception named in a comment;
 *   - Exit Draft surviving the deletion of EVERY variant gate in the file
 *     (Q13: everyone can leave — commissioner, member, mock);
 *   - the room mounting the bar and containing no PageHeader element or
 *     app-header import (the DR.2 deletion staying deleted);
 *   - the door seam (D110(1) as amended by MS.5): the room's ONE door
 *     predicate is `canOpenDraftOptions` — commissioner on a real draft,
 *     the LAUNCHER on a LEAGUE-ATTACHED mock (§8.8 v2.15/D259; standalone
 *     stays shut, F128/F129) — and the ONLY `CommishDraftPanel` mount sits
 *     behind it (the variant table in `command-bar-ops.test.ts` pins the
 *     same derivation at the ops layer);
 *   - the panel's old blue trigger staying retired (D153): no SheetTrigger
 *     anywhere in `commish-draft-panel.tsx`, and its Sheet controlled.
 */

const BAR = 'src/components/draft/draft-command-bar.tsx'
const ROOM = 'src/components/draft/draft-room.tsx'
const PANEL = 'src/components/draft/commish-draft-panel.tsx'
const TAILWIND = 'tailwind.config.ts'

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** Source with comments removed — these files DISCUSS their chrome at
 *  length, and a pin a comment can satisfy is not pinning the code. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/** The `{<cond> && ( … )}` block removed (the room-exits idiom), so "this
 *  control is not behind that gate" is pinned by construction. */
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

/** Remove EVERY occurrence of a gate (some conditions gate two blocks). */
function withoutAllGates(source: string, cond: string): string {
  let out = source
  while (out.includes(`{${cond} && (`)) out = withoutGate(out, cond)
  return out
}

describe('the bar’s physical contract (spec §16.4 zone 1; D149/D152; C47)', () => {
  const source = code(BAR)

  it('is 54px via the draft-topbar token — never an arbitrary class', () => {
    expect(source).toMatch(/h-draft-topbar/)
    expect(source).not.toMatch(/h-\[54px\]/)
    // The token itself is 54px, literal per C47 (no ×0.8 conversion).
    expect(read(TAILWIND)).toMatch(/'draft-topbar':\s*'54px'/)
  })

  it('is ink-filled and pinned over the scrolling room', () => {
    expect(source).toMatch(/bg-ink/)
    expect(source).toMatch(/sticky top-0/)
  })

  it('keeps a RESTING hard shadow — the D152 pinned-bar exception', () => {
    // The accent member of the shadow-hard family (an ink shadow disappears
    // into an ink fill), with NO interaction prefix in front of it.
    expect(source).toMatch(/(?<!:)shadow-hard-accent-4/)
    expect(source).not.toMatch(/hover:shadow-hard-accent-4/)
  })

  it('names the D152 exception in a comment beside the shadow', () => {
    // Raw source on purpose: the COMMENT is the requirement here (D152:
    // "with a comment naming the exception").
    const raw = read(BAR)
    expect(raw).toMatch(/D152/)
    expect(raw).toMatch(/pinned chrome over scrolling content/i)
  })
})

describe('Exit Draft is for everyone (Q13; §16.4 zone 1)', () => {
  it('survives the deletion of every variant gate in the bar', () => {
    let source = code(BAR)
    for (const cond of [
      'showMockBadge',
      'showPauseResume',
      'showDraftOptions',
      'showPracticeOptions',
    ]) {
      source = withoutAllGates(source, cond)
    }
    // MP.6c: the destination is the ROOM SCOPE's exit, not a league URL the
    // bar builds — a standalone practice room leaves to `/app/mocks`. What
    // this pin is about is unchanged and is what still fails if it breaks:
    // Exit Draft survives every variant gate, and it is a real link.
    expect(source).toMatch(/<Link\s+href=\{exitHref\}/)
    expect(source).toMatch(/Exit Draft/)
    // …and the bar cannot quietly re-acquire a league of its own.
    expect(source).not.toMatch(/\/app\/leagues/)
  })

  it('is a navigation, not a window.close or a confirm', () => {
    const source = code(BAR)
    expect(source).not.toMatch(/window\.close/)
    expect(source).not.toMatch(/confirm/i)
  })

  it('never touches the sticky is_autodraft flag (Q13’s hard boundary)', () => {
    expect(code(BAR)).not.toMatch(/is_autodraft/)
    expect(code(ROOM)).not.toMatch(/setMemberAutodraft|useSetMemberAutodraft/)
  })
})

describe('the room hosts the bar and the PageHeader stays deleted (DR.2)', () => {
  const room = code(ROOM)

  it('mounts DraftCommandBar', () => {
    expect(room).toMatch(/<DraftCommandBar/)
  })

  it('contains no PageHeader element and no app-header import', () => {
    expect(room).not.toMatch(/<PageHead/)
    expect(room).not.toMatch(/@\/components\/layout\/app-header/)
  })

  it('passes the RAW role and the mock flag separately, so the ops mask is live', () => {
    // MP.6c: the role now arrives on the room's scope object (`scope.myRole`
    // — null on a standalone practice draft, where there is no commissioner
    // at all). Still the RAW role, still masked in the ops.
    expect(room).toMatch(/commishRole:\s*canUseCommishPanel\(scope\.myRole\)/)
    expect(room).toMatch(/isMock:\s*draft\.is_mock/)
  })
})

describe('the room’s ONE door predicate (D110(1) as amended by MS.5)', () => {
  const room = code(ROOM)

  it('canOpenDraftOptions: commissioner on a real draft, the LAUNCHER on a league-attached mock', () => {
    // The pin MOVED here from the pre-MS.5 `isCommish … && !draft.is_mock`
    // text (D221(5): moved, never deleted). What it still guarantees: role
    // alone NEVER opens the door on a mock (the mock arm reads only
    // `isMockLauncher`), and a STANDALONE practice room opens nothing
    // (`scope.leagueId !== null` — no wire door exists there, F128/F129).
    expect(room).toMatch(
      /const canOpenDraftOptions = draft\.is_mock\s*\n\s*\? isMockLauncher && scope\.leagueId !== null\s*\n\s*: canUseCommishPanel\(scope\.myRole\)/,
    )
  })

  it('the ONLY CommishDraftPanel mount sits behind the canOpenDraftOptions gate', () => {
    expect(room).toMatch(/<CommishDraftPanel/)
    expect(withoutAllGates(room, 'canOpenDraftOptions')).not.toMatch(/<CommishDraftPanel/)
  })
})

describe('the panel’s own door stays retired (D153)', () => {
  const panel = code(PANEL)

  it('carries no SheetTrigger — the bar’s Draft Options is the one door', () => {
    expect(panel).not.toMatch(/SheetTrigger/)
    expect(panel).not.toMatch(/Commish panel/)
  })

  it('its Sheet is controlled by the bar', () => {
    expect(panel).toMatch(/<Sheet open=\{open\} onOpenChange=\{onOpenChange\}>/)
  })
})
