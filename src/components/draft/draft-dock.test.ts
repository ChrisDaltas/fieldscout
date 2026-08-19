import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Source-level pins for the DR.5 bottom dock (spec §16.4's dock paragraph,
 * §16.2 `draft-dock`; D150/D151/D152/D119(6); Chris's requirement (2)) —
 * the `draft-command-bar.test.ts` idiom: `jsx: "preserve"` keeps Vite from
 * importing a `.tsx` here, so what these pins assert is structural (what
 * is in the tree, what is ABSENT, and which tokens carry the numbers), not
 * that React mounted it — the mounts and the geometry are measured by the
 * DR.5 PR's browser pass (D151's board-rect-stable measurement).
 *
 * What is pinned, and why:
 *   - the tab strip renders the OPS CATALOG (`DOCK_TABS.map`), never a
 *     hard-coded ladder, and the five labels live only in the catalog;
 *   - ONE panel container, rendered only while a tab is open, with the
 *     state a single `DockState` scalar — the source half of the
 *     single-open invariant (the ops golden enumerates the other half);
 *   - D151 as far as source can encode it: the panel is `absolute` (out of
 *     flow — it CANNOT change the board zone's geometry), `bottom-full`
 *     above the strip, at the fixed height TOKENS (`h-dock-panel-mobile`
 *     base / `lg:h-dock-panel`) whose literals are pinned in
 *     tailwind.config.ts; no arbitrary height classes;
 *   - D150's non-modal contract as ABSENCES: no Radix overlay primitives,
 *     no `inert`, no FocusScope/focus-trap, no backdrop; plus the focus
 *     wiring (into the panel on open, back to the tab on close) and
 *     Escape;
 *   - D152: both resting shadows (strip + panel) present WITH their
 *     exception comments;
 *   - D119(6): the dock never mounts `AddDraftListModal` (the room does,
 *     once, outside the dock) and exposes no external close API a dialog
 *     could trip;
 *   - no `BottomTabs` anywhere in the room's bottom edge — the dock has it
 *     to itself (§16.4 mobile specifics; the room is outside the shell).
 */

const DOCK = 'src/components/draft/draft-dock.tsx'
const ROOM = 'src/components/draft/draft-room.tsx'
const TAILWIND = 'tailwind.config.ts'

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** Source with comments removed — the dock's docblock DISCUSSES Sheets,
 *  Radix and the modal by name (it documents why they are absent), and a
 *  pin a comment can satisfy or violate is not pinning the code. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('the tab strip renders the ops catalog (five tabs, one source of labels)', () => {
  const source = code(DOCK)

  it('maps DOCK_TABS — never a hard-coded ladder', () => {
    expect(source).toMatch(/DOCK_TABS\.map/)
  })

  it('carries NONE of the five labels as component literals — the catalog owns them', () => {
    // The L.C3.1 Targets sweep (D140) renames the catalog entry and the
    // whole strip follows; a literal here would half-rename.
    for (const label of ['Players', 'Queue', 'Roster', 'Lists', 'Chat']) {
      expect(source).not.toContain(`>${label}<`)
      expect(source).not.toContain(`'${label}'`)
    }
    expect(source).toMatch(/\{tab\.label\}/)
  })

  it('is a toolbar of toggle BUTTONS with aria-expanded, not a Radix anything', () => {
    expect(source).toMatch(/role="toolbar"/)
    expect(source).toMatch(/aria-label="Draft panels"/)
    expect(source).toMatch(/type="button"/)
    expect(source).toMatch(/aria-expanded=\{isOpen\}/)
    expect(source).toMatch(/aria-controls=\{isOpen \? dockPanelId\(tab\.id\) : undefined\}/)
  })

  it('scrolls horizontally when the labels don’t fit (§16.4 mobile specifics)', () => {
    expect(source).toMatch(/overflow-x-auto/)
  })

  it('open-state emphasis is fill + border, never a shadow (D152’s ordinary rule)', () => {
    expect(source).toMatch(/border-accent bg-accent-soft/)
  })
})

describe('single-open, at the source layer (D150: one panel at a time)', () => {
  const source = code(DOCK)

  it('the state is ONE DockState scalar', () => {
    expect(source).toMatch(/useState<DockState>\(null\)/)
    // No second open-state anywhere in the file.
    const stateHooks = source.match(/useState[<(]/g) ?? []
    expect(stateHooks).toHaveLength(1)
  })

  it('exactly ONE panel container exists, rendered only while a tab is open', () => {
    const panels = source.match(/role="region"/g) ?? []
    expect(panels).toHaveLength(1)
    expect(source).toMatch(/\{openTab && \(/)
    expect(source).toMatch(/\{panels\[openTab\.id\]\}/)
  })

  it('every transition goes through the pure reducer', () => {
    expect(source).toMatch(/dockReducer\(current, action\)/)
  })
})

describe('D151: fixed height, absolutely positioned OVER the board', () => {
  const source = code(DOCK)

  it('the panel is out of flow — absolute, anchored above the strip', () => {
    expect(source).toMatch(/absolute inset-x-0 bottom-full/)
  })

  it('the open height is the TOKENS — taller below lg, capped on desktop', () => {
    expect(source).toMatch(/h-dock-panel-mobile/)
    expect(source).toMatch(/lg:h-dock-panel/)
    // No arbitrary height class smuggles a different number in.
    expect(source).not.toMatch(/h-\[/)
  })

  it('the tokens carry D151’s literals in tailwind.config.ts', () => {
    const tailwind = read(TAILWIND)
    expect(tailwind).toContain("'dock-panel': 'min(60vh, 640px)'")
    expect(tailwind).toContain("'dock-panel-mobile': '75vh'")
  })

  it('the dock band itself never grows or shrinks the column (shrink-0, no flex-1)', () => {
    expect(source).toMatch(/relative z-30 shrink-0/)
    expect(source).not.toMatch(/flex-1/)
  })

  it('the panel owns its own scroll — the dock’s ONE overflow-y-auto', () => {
    const occurrences = source.match(/overflow-y-auto/g) ?? []
    expect(occurrences).toHaveLength(1)
  })

  it('the room hosts the dock OUTSIDE the board zone scroller, after it', () => {
    const room = code(ROOM)
    const scrollerIdx = room.indexOf('className="min-h-0 flex-1 overflow-y-auto"')
    const dockIdx = room.indexOf('<DraftDock')
    expect(scrollerIdx).toBeGreaterThan(-1)
    expect(dockIdx).toBeGreaterThan(scrollerIdx)
  })
})

describe('D150: non-modal, by absence and by wiring', () => {
  const source = code(DOCK)

  it('imports no overlay primitive and traps nothing', () => {
    expect(source).not.toMatch(/@radix-ui/)
    expect(source).not.toMatch(/Sheet/)
    expect(source).not.toMatch(/Dialog/)
    expect(source).not.toMatch(/FocusScope|focus-trap|inert/)
    // No backdrop element to swallow clicks; no body scroll lock.
    expect(source).not.toMatch(/backdrop|bg-black\/|pointer-events-none/)
    expect(source).not.toMatch(/document\.body\.style/)
  })

  it('focus enters the panel on open (tabIndex −1 + programmatic focus)', () => {
    expect(source).toMatch(/tabIndex=\{-1\}/)
    expect(source).toMatch(/panelRef\.current\?\.focus\(\{ preventScroll: true \}\)/)
  })

  it('focus returns to the owning tab button on close, via the pure target', () => {
    expect(source).toMatch(/focusReturnTarget\(prev, open\)/)
    expect(source).toMatch(/getElementById\(dockTabButtonId\(returnTo\)\)\?\.focus\(\)/)
  })

  it('Escape closes, scoped to the dock (no document-level key ownership)', () => {
    expect(source).toMatch(/event\.key === 'Escape'/)
    expect(source).toMatch(/dispatch\(\{ type: 'escape' \}\)/)
    expect(source).not.toMatch(/addEventListener/)
  })
})

describe('D152: the two sanctioned resting shadows, each with its comment', () => {
  const raw = read(DOCK)
  const source = code(DOCK)

  it('the strip and the panel both rest elevated — the up members', () => {
    expect(source).toMatch(/shadow-hard-up-4/)
    expect(source).toMatch(/shadow-hard-up-6/)
  })

  it('each shadow’s exception comment names D152', () => {
    // The comments live immediately above each className; both name the
    // ruling. (Raw source on purpose — the comments ARE the requirement.)
    const mentions = raw.match(/D152 exception, stated:/g) ?? []
    expect(mentions).toHaveLength(2)
  })
})

describe('D119(6): the modal stays at room level, outside the dock', () => {
  const dock = code(DOCK)
  const room = code(ROOM)

  it('the dock never mounts (or imports) AddDraftListModal', () => {
    expect(dock).not.toMatch(/AddDraftListModal/)
  })

  it('the room mounts it exactly once, AFTER the dock — a sibling, never a panel body', () => {
    const mounts = room.match(/<AddDraftListModal/g) ?? []
    expect(mounts).toHaveLength(1)
    expect(room.indexOf('<AddDraftListModal')).toBeGreaterThan(room.indexOf('<DraftDock'))
  })

  it('onAddList opens the modal directly — the dock stays open (nothing closes it)', () => {
    expect(room).toMatch(/onAddList=\{\(\) => setAddListOpen\(true\)\}/)
  })

  it('the dock exposes NO external open/close API a dialog could trip', () => {
    expect(dock).toMatch(/interface DraftDockProps \{/)
    expect(dock).not.toMatch(/onOpenChange|open\?:|open:/)
  })
})

describe('no stacked bottom bars: the global BottomTabs never enters the room', () => {
  it('neither the dock nor the room references BottomTabs', () => {
    expect(code(DOCK)).not.toMatch(/BottomTabs/)
    expect(code(ROOM)).not.toMatch(/BottomTabs/)
  })

  it('the (room) layout renders no AppShell (whose bottom tabs are the shell’s)', () => {
    expect(code('src/app/app/(room)/layout.tsx')).not.toMatch(/AppShell|BottomTabs/)
  })
})
