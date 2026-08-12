import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * LV.15 — the app-shell host and the window frame, pinned at the source.
 *
 * **Source pins, not renders** — the same idiom and the same reason as
 * `side-by-side-columns.test.ts` and `side-by-side-picker.test.ts`: these are
 * `.tsx`, which Vite cannot parse under Next's `jsx: "preserve"`. Everything
 * that could be executed *is* executed, one file over: the store, the z-stack,
 * the clamps, the cascade, the viewport rescue and what `partialize` writes all
 * run for real in `src/stores/list-windows-store.test.ts` (**24 tests** — this
 * comment said 22 until **R229**; PROGRESS §4 and the PR body both had it
 * right). What is left here is markup and mounting, which is exactly what
 * source pins are for.
 *
 * **Every assertion reads the comment-stripped source** (`code`), never the raw
 * file — and here that is load-bearing rather than ceremonial, because these
 * two files *document* the very strings the negative pins forbid: the window's
 * header explains why it carries **no shadow** and why the pointer maths has no
 * **0.8** in it. Matched raw, both pins would pass on the explanation. The
 * stripper has its own control at the bottom.
 *
 * The pin that matters most is the first one. `ListWindowsHost` is the only
 * Round 2 component that mounts outside `/app/lists`, so a wrapper element
 * rendered on the empty path would reach Home, Players, Teams and every other
 * screen in the app.
 */

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')

/** Every `.tsx` under `src/`, as repo-relative paths, sorted. */
const tsxTree = (dir = 'src'): string[] =>
  readdirSync(path.resolve(process.cwd(), dir), { withFileTypes: true })
    .flatMap((entry) => {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) return tsxTree(rel)
      return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [rel] : []
    })
    .sort()

const code = (file: string) =>
  read(file).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (_match, before) => before ?? '')

/**
 * Which files actually *render* a component, over the whole tree. Used for the
 * one claim in this suite that is about the app rather than about a file: this
 * host is mounted exactly once, because a second mount would double every open
 * window on every route.
 */
const filesRendering = (jsx: string) => tsxTree().filter((file) => code(file).includes(jsx))

const HOST = 'src/components/lists/v2/list-windows-host.tsx'
const WINDOW = 'src/components/lists/v2/list-window.tsx'
const SHELL = 'src/components/layout/app-shell.tsx'
const ROOT_LAYOUT = 'src/app/layout.tsx'
const PLAYER_LAYER = 'src/components/players/player-windows-layer.tsx'
const PAGE = 'src/components/lists/v2/lists-page-v2.tsx'
/** The player mini card's frame — the window this one is a mirror of (D11/D13). */
const PRECEDENT_WINDOW = 'src/components/shared/window-shell.tsx'
/** LV.16 — where the inversion's values live, and the surfaces it composes. */
const GLOBALS = 'src/app/globals.css'
const PANEL = 'src/components/lists/v2/list-detail-panel.tsx'
const TOOLBAR = 'src/components/lists/v2/list-toolbar.tsx'
const DROP_COMMIT = 'src/components/lists/v2/use-list-drop.ts'
const ROW_PARTS = 'src/components/lists/v2/list-row-parts.tsx'

/**
 * The body of `ListWindowsHost`, isolated from the file, so "returns null
 * before anything else" can be asserted as an *order* rather than as the mere
 * presence of two strings somewhere in the module. Throws if it cannot find the
 * function: a guard that cannot locate what it guards is broken, not green.
 */
const hostBody = () => {
  const match = code(HOST).match(/export function ListWindowsHost\(\)[^{]*\{([\s\S]*)\n\}/)
  if (!match) {
    throw new Error(
      'LV.15: `export function ListWindowsHost()` could not be located in ' +
        HOST +
        ' — the render-nothing pins below are guarding nothing.',
    )
  }
  return match[1]
}

/**
 * One element's own class string, found by a class only it carries.
 *
 * **The marker has to stay unique, and that is checked rather than assumed**
 * (R226's audit). Ambiguity fails here instead of resolving to whichever element
 * happens to come first.
 *
 * ## Widened at LV.16, because R226's prediction came true in a spelling it
 * missed
 *
 * R226 said in as many words that `cursor-grab` was *"one edit away from being
 * ambiguous, because **LV.16** brings drag-reorder rows into this very file"* —
 * and it did. But the throw never fired: this only matched `className="…"`
 * **attributes**, and a conditional row class is a single-quoted string inside
 * `cn(…)` (`canDrag && 'cursor-grab touch-manipulation'`). The file gained a
 * second `cursor-grab` and the locator went on confidently returning the header.
 * That is the same shape as the four findings this build has already had — a
 * guard that reads one spelling of the thing it forbids — so the scan now covers
 * **both** forms: `className="…"` attributes *and* class-string literals inside
 * a `cn()` call. The header's own marker moved to `active:cursor-grabbing`,
 * which is the drag *handle*, not a draggable row.
 */
const classStringsContaining = (file: string, marker: string) => {
  const source = code(file)
  // Markers are Tailwind classes, and half of them carry `[`, `]` and `.` —
  // unescaped, `text-[10.5px]` becomes a character class and matches almost
  // anything.
  const safe = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const attributes = [...source.matchAll(new RegExp(`className="([^"]*${safe}[^"]*)"`, 'g'))]
  // Single-quoted class strings — the `cn('…', flag && '…')` form the row
  // classes use, which the attribute regex above cannot see.
  const literals = [...source.matchAll(new RegExp(`'([^'\\n]*${safe}[^'\\n]*)'`, 'g'))]
  return [...attributes, ...literals].map((match) => match[1])
}

const classNameContaining = (file: string, marker: string) => {
  const all = classStringsContaining(file, marker)
  if (all.length === 0) {
    throw new Error(
      `LV.15: no class string containing \`${marker}\` in ${file} — the pin below is guarding nothing.`,
    )
  }
  if (all.length > 1) {
    throw new Error(
      `LV.15: \`${marker}\` appears in ${all.length} class strings in ${file} — it no longer ` +
        'identifies one element, so the pin below is asserting about whichever came first.',
    )
  }
  return all[0]
}

/**
 * The leading indentation of the line carrying `marker`, as a JSX-depth proxy.
 *
 * Used for the one claim that is about **structure** rather than content: the
 * Stats picker is a *sibling* of the dark wrapper, not a descendant of it
 * (design LAW). There is no jsdom in this suite — these are `.tsx` files Vite
 * cannot parse under Next's `jsx: "preserve"` — so a rendered-tree assertion is
 * not available, and "appears later in the file" would still be true if the
 * element were moved inside the wrapper's last child. Indentation is
 * deterministic here because the repo formats with Prettier.
 *
 * Throws when the marker is missing, for the reason `hostBody` does.
 */
const indentOf = (file: string, marker: string): number => {
  const line = code(file)
    .split('\n')
    .find((candidate) => candidate.includes(marker))
  if (line === undefined) {
    throw new Error(
      `LV.16: \`${marker}\` is not in ${file} — the structural pin below is guarding nothing.`,
    )
  }
  return line.length - line.trimStart().length
}

/**
 * One handler's body, from its `const` to the next top-level `const on…`.
 * Throws if it cannot find it, for the reason `hostBody` does.
 *
 * Added by R226's audit. The release-not-per-frame pins used to anchor on the
 * bare name `onHeaderPointerUp`, which the file carries three times (the
 * declaration and two JSX attributes) — so they asserted that *somewhere* after
 * one of those a `setPosition` appears, and stayed green if a second, per-frame
 * write were added to the **move** handler. That is the write the store's
 * `persist` middleware turns into a `JSON.stringify` per pointer event, and it
 * is what the pin's own comment claims to forbid.
 */
/**
 * The Escape effect's body, matched **only** when `if (!isTop) return` is its
 * first statement — so a version that closes every open window on one keypress
 * cannot be located here at all, and this throws rather than passing (R227).
 */
const escapeEffect = () => {
  const match = code(WINDOW).match(
    /React\.useEffect\(\(\) => \{\s*if \(!isTop\) return\n([\s\S]*?)\n {2}\}, \[/,
  )
  if (!match) {
    throw new Error(
      `LV.15: no \`isTop\`-guarded keydown effect in ${WINDOW} — either there is no keyboard ` +
        'close at all, or it is not scoped to the front window. Both are R227.',
    )
  }
  return match[1]
}

/**
 * The Escape target guard's selector, split into its parts (**R231**).
 *
 * Read from the **named constant** rather than from the effect body, because
 * `list-window.tsx` already contains a second `closest('…')` — the
 * `closest('button, a')` that keeps a press on a header control from starting a
 * drag — and a bare `closest\(…\)` regex would happily assert about whichever
 * came first. That is R226's `classNameContaining` lesson applied before the
 * ambiguity bites rather than after.
 *
 * Throws if the constant is gone: the two pins below would otherwise be
 * guarding nothing.
 */
const escapeTargetSelector = (): string[] => {
  const match = code(WINDOW).match(/const ESCAPE_BELONGS_TO_TARGET =\s*'([^']+)'/)
  if (!match) {
    throw new Error(
      `LV.15: no \`ESCAPE_BELONGS_TO_TARGET\` selector in ${WINDOW} — the Escape guard is back ` +
        'to covering only Radix, which is R231.',
    )
  }
  return match[1].split(',').map((part) => part.trim())
}

const handlerBody = (file: string, name: string) => {
  const match = code(file).match(new RegExp(`const ${name} = [\\s\\S]*?\\n  \\}\\n`))
  if (!match) {
    throw new Error(
      `LV.15: \`const ${name}\` could not be located in ${file} — the pin below is guarding nothing.`,
    )
  }
  return match[0]
}

/**
 * **The empty guard itself, matched whole** — never the bare `return null` it
 * ends with. Both pins below locate the guard by index, and an anchor of
 * `'return null'` finds the *first* early return in the function rather than
 * this one, so any other early return above the JSX satisfies them. The
 * Reviewer demonstrated both halves of that at **41 passed**: (a) the guard
 * moved below the JSX with a decoy `if (false) return null` above it, and
 * (b) a `useEffect` writing to `document.body` on the empty path, hidden behind
 * `if (windows === undefined) return null` — *an effect firing on every route in
 * the app*, which is the one thing this suite exists to forbid. **R226**, and
 * the third time this build has had an `indexOf` pass for the wrong reason.
 */
const EMPTY_GUARD = 'if (windows.length === 0) return null'

describe('LV.15 — with no window open, the host renders nothing at all (D13)', () => {
  it('returns null, and returns it before any markup', () => {
    const body = hostBody()

    expect(body).toContain(EMPTY_GUARD)

    const guard = body.indexOf(EMPTY_GUARD)
    const markup = body.indexOf('return (')
    expect(guard).toBeGreaterThan(-1)
    expect(markup).toBeGreaterThan(-1)
    // Order, not presence: a guard placed *after* the JSX return is unreachable
    // and would read as correct in a diff.
    expect(guard).toBeLessThan(markup)
  })

  it('the empty path touches one store and nothing else', () => {
    const body = hostBody()
    const guard = body.indexOf(EMPTY_GUARD)
    // Without this, a *deleted* guard makes `slice(0, -1)` the whole function
    // and every assertion below passes for the wrong reason — which is exactly
    // what the first probe of this pin showed (16 green, 1 red, when both
    // should have been red).
    expect(guard).toBeGreaterThan(-1)
    const beforeGuard = body.slice(0, guard)

    // Exactly one hook runs before the guard, and it is the store read.
    expect(beforeGuard).toContain('useListWindowsStore((state) => state.windows)')
    for (const hook of ['useEffect', 'useState', 'useMemo', 'useQuery', 'useRef', 'usePathname']) {
      expect(beforeGuard, hook).not.toContain(hook)
    }
  })

  it('renders a bare fragment when it does render — no wrapper, no portal, no provider', () => {
    const source = code(HOST)
    // A wrapper div/section would be a layout box on every route in the app.
    expect(source).toMatch(/return \(\s*<>/)
    expect(source).not.toContain('createPortal')
    expect(source).not.toMatch(/<(div|section|main|aside|span)[\s>]/)
    expect(source).not.toContain('Provider')
  })

  /**
   * The reason the empty path is reachable on every route at all: `windows` is
   * not persisted (D13), so it is `[]` on every first render — server and
   * client — and the host cannot differ between them. If a future change
   * persisted the open stack, the host would render windows during hydration on
   * whatever page you reloaded, which is a hydration mismatch as well as a
   * product change.
   */
  it('the open stack is not persisted, which is why SSR and hydration both render nothing', () => {
    const store = code('src/stores/list-windows-store.ts')
    expect(store).toContain('partialize: (state) => ({ geometry: state.geometry })')
    expect(store).not.toMatch(/partialize[\s\S]{0,80}windows/)
  })
})

describe('LV.15 — mounted once, by the app shell (design LAW: “rendered by the app shell”)', () => {
  it('the shell imports and renders it', () => {
    const shell = code(SHELL)
    expect(shell).toContain(
      "import { ListWindowsHost } from '@/components/lists/v2/list-windows-host'",
    )
    expect(shell).toContain('<ListWindowsHost />')
  })

  it('and nothing else mounts it — a second host would double every window', () => {
    // The two specific hazards, named: the root layout already mounts the
    // *player* window layer, and the Lists page is where a reader would assume
    // a Lists pop-out belongs.
    expect(code(ROOT_LAYOUT)).not.toContain('ListWindowsHost')
    expect(code(PAGE)).not.toContain('ListWindowsHost')

    // …and then the claim this `it` actually makes, over the whole tree rather
    // than two files (R226's audit — the title said "nothing else" while the
    // assertions ruled out exactly two candidates).
    expect(filesRendering('<ListWindowsHost')).toEqual(['src/components/layout/app-shell.tsx'])
  })
})

describe('LV.15 — the z-order between the two windowing systems is chosen, not accidental', () => {
  it('pop-outs are one layer at 45: above page chrome, below dialogs and mini cards', () => {
    const source = code(HOST)
    expect(source).toContain('const LIST_WINDOW_Z = 45')
    expect(source).toContain('zIndex={LIST_WINDOW_Z}')
    // Not `LIST_WINDOW_Z + index`: a sixth window would then be at 50, inside
    // the Radix layer. Depth inside the layer is DOM order (the array is
    // back-to-front), which is also why nothing here portals.
    expect(source).not.toMatch(/LIST_WINDOW_Z\s*\+/)
  })

  /**
   * The neighbour this decision is expressed relative to. A cited fact that
   * nothing checks is a fact that quietly stops being true: if the mini cards
   * ever drop to 40, pop-outs would cover the card opened *from* a pop-out row.
   */
  it('the player mini cards really are above, at 60', () => {
    expect(code(PLAYER_LAYER)).toContain('const BASE_Z = 60')
  })
})

/**
 * **R227.** A pop-out shipped with exactly one way out — the close button in
 * its own header, which travels with the window. Drag one right, narrow the
 * viewport, and mount-time geometry resolution (the precedent's behaviour, and
 * not the defect) leaves it off-screen with nothing to scroll to, on **every**
 * route, because the host mounts in the app shell. The escape hatch is the
 * precedent's, four lines away in the file this one already mirrors.
 */
describe('LV.15 — Escape closes the top window, and only the top one (R227)', () => {
  it('mirrors window-shell.tsx: an isTop-guarded keydown effect that closes', () => {
    // Throws unless `if (!isTop) return` is the effect's first statement, which
    // is the half that keeps one Escape from emptying the whole stack.
    const effect = escapeEffect()

    expect(effect).toContain("e.key === 'Escape'")
    expect(effect).toContain('close(listId)')
    expect(effect).toContain("window.addEventListener('keydown', onKey)")
    // Added *and removed* — a leaked listener would close a window that is gone.
    expect(effect).toContain("window.removeEventListener('keydown', onKey)")
    // Radix listens on `document` in the capture phase and calls
    // `preventDefault()` when it dismisses, so a bubble-phase listener still
    // runs afterwards: without this, one Escape aimed at a dialog — or at the
    // `dots` menu LV.16 puts in this header — would also close the window.
    expect(effect).toContain('e.defaultPrevented')

    // The precedent really does say what this claims to mirror.
    expect(code(PRECEDENT_WINDOW)).toContain('if (!isTop) return')
  })

  /**
   * **R231 — half one: an Escape the focused control already owns is not ours.**
   *
   * `defaultPrevented` covers Radix and only Radix, because `preventDefault()`
   * is Radix's habit and not the app's. Four of the app's own Escape handlers
   * skip it — `players-spreadsheet.tsx`:1092, `list-detail-hero.tsx`:121,
   * `list-row-parts.tsx`:531, `list-builder.tsx`:294 — and the first of those is
   * on **Players**, a route the app-shell-hosted window survives to. Measured
   * before this pin existed: pop-out open on `/app/players`, focus in the player
   * search input with `alle` typed, one Escape → `popouts 1 → 0` while focus
   * never left the input.
   */
  it('…and not an Escape the focused control already owns (R231)', () => {
    // The effect asks where the key came from, not only what was done with it.
    expect(escapeEffect()).toContain('escapeBelongsToTarget(e.target)')

    const parts = escapeTargetSelector()
    // The native controls where Escape cancels an edit or closes a popup, and
    // the ARIA spellings of the same things — so the guard does not depend on
    // which spelling a component happened to reach for.
    for (const selector of [
      'input',
      'textarea',
      'select',
      '[contenteditable]',
      '[role="combobox"]',
      '[role="listbox"]',
      '[role="searchbox"]',
      '[role="textbox"]',
    ]) {
      expect(parts, selector).toContain(selector)
    }
  })

  /**
   * **R231 — half two, and it is the half that keeps R227 alive.** A guard wide
   * enough to be safe is one edit away from being wide enough to be useless: the
   * escape hatch only exists while *some* Escape still reaches it.
   */
  it('…and the guard stays narrow enough that the hatch still exists (R231)', () => {
    const parts = escapeTargetSelector()

    // This window IS a role=dialog, which is why that one is not merely
    // unnecessary but wrong: it would switch Escape off the moment focus landed
    // inside the very window Escape exists to close. The assertion is written
    // against the fact rather than beside it, so the two cannot drift apart.
    expect(code(WINDOW)).toContain('role="dialog"')
    // A button does not handle Escape, and focus rests on one after almost
    // every click in this app — bailing there would leave the hatch working
    // only while focus is on <body>. A button that *does* own Escape is a menu
    // trigger, i.e. Radix, i.e. the `defaultPrevented` check.
    for (const selector of [
      '[role="dialog"]',
      'button',
      '[role="button"]',
      'a',
      '[tabindex]',
      '*',
    ]) {
      expect(parts, selector).not.toContain(selector)
    }

    // The ordinary path is still reached: nothing returns before the close.
    const effect = escapeEffect()
    expect(effect.indexOf('escapeBelongsToTarget')).toBeLessThan(
      effect.indexOf("e.key === 'Escape'"),
    )
    expect(effect).toContain('close(listId)')
  })

  it('exactly one window is top: the last of the back-to-front array', () => {
    expect(code(HOST)).toContain('isTop={index === windows.length - 1}')
    // The host computes it because only the host can see the siblings. A prop
    // default here (`isTop = true`) would make every window answer Escape.
    expect(code(WINDOW)).not.toMatch(/isTop\s*=/)
  })
})

describe('LV.15 — the frame: stroke carries the lift, and there is no shadow', () => {
  it('1px n-3 stroke shifting to brand on hover', () => {
    const source = code(WINDOW)
    expect(source).toContain('border-n-3')
    expect(source).toContain('hover:border-brand')
    expect(source).toContain('bg-n-2')
  })

  /**
   * The handoff overrides CLAUDE.md's overlay exception on its own terms — *"a
   * black offset shadow can't read on a black window, so the stroke carries the
   * lift"* — so this is the one floating surface in the app with no elevation
   * token at any state. `ui/elevation-rule.test.ts` is deliberately untouched:
   * it guards `src/components/ui/**`, and a pop-out is not a `ui/` primitive.
   */
  it('no shadow at any state, in either file', () => {
    for (const file of [WINDOW, HOST]) {
      expect(code(file), file).not.toMatch(/shadow-/)
    }
  })
})

describe('LV.15 — the design LAW’s numbers, converted (and the two that are not)', () => {
  it('the header is 36px (44 × 0.8) and the whole bar is the drag handle', () => {
    // `active:cursor-grabbing` rather than `cursor-grab` since **LV.16**: the
    // rows are draggable now, so `cursor-grab` names two things and the locator
    // above throws on it. The grabbing state belongs to the handle alone.
    const header = classNameContaining(WINDOW, 'active:cursor-grabbing')
    expect(header).toContain('h-9')
    // Touch drag needs the browser to stop scrolling the page instead.
    expect(header).toContain('touch-none')
    const source = code(WINDOW)
    expect(source).toContain('onPointerDown={onHeaderPointerDown}')
    expect(source).toContain('onPointerMove={onHeaderPointerMove}')
    // A press on a header control is not a drag.
    expect(source).toContain("closest('button, a')")
  })

  it('the resize grip is 16px in the bottom-right, and is NOT converted', () => {
    const grip = classNameContaining(WINDOW, 'cursor-nwse-resize')
    expect(grip).toContain('h-4')
    expect(grip).toContain('w-4')
    expect(grip).toContain('bottom-0')
    expect(grip).toContain('right-0')
    expect(grip).toContain('touch-none')
    // 16 × 0.8 = 12.8. A hit target is a physical limit, not a rhythm measure —
    // if this ever becomes h-[13px] it was converted by reflex.
    expect(grip).not.toContain('h-[13px]')
  })

  it('pointer deltas are used 1:1 — the prototype’s / ZOOM has no meaning here', () => {
    const source = code(WINDOW)
    expect(source).toContain('e.clientX - drag.startX')
    expect(source).toContain('e.clientX - grip.startX')
    expect(source).not.toContain('ZOOM')
    // The one number that would show a stray conversion in the maths.
    expect(source).not.toContain('0.8')
  })

  it('drag and resize commit to the store on release, not per frame', () => {
    const source = code(WINDOW)
    expect(source).toContain('setPointerCapture')
    expect(source).toContain('releasePointerCapture')
    // No global window listeners (the prototype's approach): they outlive the
    // window, and this one unmounts on a close or a route change mid-drag.
    expect(source).not.toContain("window.addEventListener('pointermove'")
    expect(source).not.toContain('window.addEventListener("mousemove"')
    // The persisted write happens in the pointer-*up* handlers, and **only**
    // there — asserted against each handler's own body rather than against a
    // 220-character window after a name the file carries three times (R226's
    // audit). The store is `persist`ed, so a write per `pointermove` is a
    // `JSON.stringify` per frame.
    expect(handlerBody(WINDOW, 'onHeaderPointerUp')).toContain('setPosition(listId')
    expect(handlerBody(WINDOW, 'onGripPointerUp')).toContain('setSize(listId')
    expect(handlerBody(WINDOW, 'onHeaderPointerMove')).not.toContain('setPosition')
    expect(handlerBody(WINDOW, 'onGripPointerMove')).not.toContain('setSize')
  })
})

describe('LV.15 — the standing constraints, made falsifiable', () => {
  /**
   * The schema budget is closed at three (`ACTIVE-BUILD.md`), and pop-outs are
   * client state: no migration, no column, **no new API route**. The window
   * reads its list through the shipped `useList` and nothing else.
   */
  it('no route of its own — the window reads through the shipped hook', () => {
    const source = code(WINDOW)
    // The import was a single line until LV.16 needed `listsKeys` and the row
    // type beside it, so this asks the two questions the old string asked —
    // *which module*, and *is it actually called* — rather than pinning a
    // formatting decision Prettier owns.
    expect(source).toContain("from '@/hooks/use-lists'")
    expect(source).toMatch(/\buseList\(listId\)/)
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('/api/')
  })

  it('boards stay off limits', () => {
    for (const file of [WINDOW, HOST]) {
      expect(code(file), file).not.toContain('big-board')
      expect(code(file), file).not.toContain('board-labels-store')
      expect(code(file), file).not.toContain('draft-mode/')
    }
  })

  it('the comment stripper keeps code and drops prose (control for the pins above)', () => {
    const source = code(WINDOW)
    expect(source).toContain('export function ListWindow')

    // Not ceremonial here: the negative pins above forbid `shadow-`, `0.8` and
    // `ZOOM`, and this file's own header uses all three while explaining the
    // decisions. Without a working stripper those pins are red for the
    // *comment*, and the obvious "fix" is to weaken the pin. Both halves are
    // asserted so this control cannot itself pass for the wrong reason.
    // (`12.5 × 0.8` was the third phrase until LV.16 rewrote that table row to
    // cite LV.15 instead of re-deriving it; `36 × 0.8` is the same shape.)
    for (const phrase of ['shadow-hard-*', 'ZOOM = 0.8', '36 × 0.8']) {
      expect(read(WINDOW), phrase).toContain(phrase)
      expect(source, phrase).not.toContain(phrase)
    }
  })
})

// =============================================================================
// LV.16 — the window's content
// =============================================================================

/**
 * The design LAW's mechanism, not merely its colours:
 *
 * > "The window inverts: `--n-2` surface, white text, `--n-3` → `#b3b9c0`,
 * > `--n-4` → `rgba(255,255,255,.22)`, `--border` → `1px solid
 * > rgba(255,255,255,.24)`. **Implement by scoping the color custom properties
 * > on an inner wrapper so children invert without restyling.**"
 *
 * The wrapper is the whole point: a window that reached the same picture by
 * writing white classes onto every child would look identical in a screenshot
 * and be a fork of the row parts by the second task. So these pin the
 * *mechanism* — one wrapper, the values in one place, and the shared children
 * rendered exactly as the light surfaces render them.
 */
describe('LV.16 — the dark inversion is one wrapper, and no child is restyled for it', () => {
  it('the window renders exactly one `fs-dark` wrapper', () => {
    const wrappers = classStringsContaining(WINDOW, 'fs-dark')
    expect(wrappers).toHaveLength(1)
    // It is the frame's inner box, so the header, the rows and the footer are
    // all inside it and inherit.
    expect(wrappers[0]).toContain('flex min-h-0 flex-1 flex-col')
  })

  it('the LAW’s five values live on `.fs-dark`, once, in the token layer', () => {
    const css = read(GLOBALS)
    const block = css.slice(css.indexOf('.fs-dark {'))
    expect(css).toContain('.fs-dark {')
    // Every colour the LAW states for the inversion, by its own token name.
    expect(block).toContain('--fs-dark-ink: #ffffff')
    expect(block).toContain('--fs-dark-muted: #b3b9c0')
    expect(block).toContain('--fs-dark-hairline: rgba(255, 255, 255, 0.22)')
    expect(block).toContain('--fs-dark-border: rgba(255, 255, 255, 0.24)')
    expect(block).toContain('--fs-dark-surface: #161616')
    // Primary text is inherited from the wrapper, exactly as the prototype does
    // it (`color: var(--white)`), rather than set on each child.
    expect(block).toContain('color: var(--fs-dark-ink)')
  })

  it('every redirect points at a property — no second copy of a colour', () => {
    const css = read(GLOBALS)
    const rules = css.slice(css.indexOf('.fs-dark .'))
    for (const utility of [
      '.fs-dark .text-n-3',
      '.fs-dark .border-n-4',
      '.fs-dark .border-ink',
      '.fs-dark .bg-white',
      '.fs-dark .hover\\:bg-accent-soft:hover',
    ]) {
      expect(rules, utility).toContain(utility)
    }
    // A literal in a redirect would be the same value written twice, which is
    // how the wrapper and the sheet start disagreeing.
    expect(rules).not.toMatch(/\.fs-dark [^{]*\{[^}]*#[0-9a-f]{3,6}/i)
    expect(rules).not.toMatch(/\.fs-dark [^{]*\{[^}]*rgba\(/i)
  })

  /**
   * **`text-ink` is deliberately not in that list.** In this app it
   * overwhelmingly means "ink text *on a light fill*" — the injury chip on
   * `bg-caution`, the check glyph on `bg-positive`, tier bands 3–4 — so
   * inverting it would paint white on pastel inside the very window it is
   * meant to make legible. The LAW's `--n-1 → white` is *primary* text, and
   * that arrives by inheritance from the wrapper's own `color`.
   */
  it('…and `text-ink` is deliberately NOT one of them', () => {
    const css = read(GLOBALS)
    expect(css).not.toContain('.fs-dark .text-ink')
    expect(css).not.toContain('.fs-dark .text-n-1')
  })

  it('it is a scoped inversion, not a theme: no `dark:` variant anywhere near it', () => {
    // CLAUDE.md → Redesign: "Single theme… never generate dual-theme tokens."
    expect(code(WINDOW)).not.toMatch(/\bdark:/)
    expect(read(GLOBALS)).not.toMatch(/\bdark:[a-z-]/)
    // And it reaches exactly one component — nothing else in the app opts in.
    expect(tsxTree().filter((file) => code(file).includes('fs-dark'))).toEqual([WINDOW])
  })

  /**
   * The LV.7 failure, restated as a pin: a new surface that quietly reimplements
   * a solved behaviour. The window renders the shared row parts; it does not
   * carry dark copies of them.
   */
  it('the shared row parts are imported, not forked', () => {
    const source = code(WINDOW)
    expect(source).toContain("from './list-row-parts'")
    for (const part of ['DraftedCheckbox', 'DropGap', 'EmptyListState', 'PlayerName']) {
      expect(source, part).toContain(part)
      // No local re-declaration of any of them.
      expect(source, part).not.toMatch(new RegExp(`function ${part}\\(`))
    }
    // The badge is the players one, not a window-sized reprint.
    expect(source).toContain("from '@/components/players/position-badge'")
    // And the parts themselves stay light — the wrapper is what inverts them.
    expect(code(ROW_PARTS)).not.toContain('fs-dark')
  })

  /**
   * The one per-instance class the inversion needs, and the LAW names its value:
   * *"14px drafted checkbox with a `rgba(255,255,255,.75)` stroke"*. Everything
   * else about that checkbox — its size, its `bg-positive` fill, its check —
   * comes through unchanged.
   */
  it('the checkbox’s 75% stroke is the only per-instance dark class', () => {
    const source = code(WINDOW)
    expect(source).toContain('className="border-white/75"')
    // The 14px box is the design's, at 1:1, and it is still the shared one.
    expect(code(ROW_PARTS)).toContain("'inline-flex h-[14px] w-[14px]")
  })
})

/**
 * > "…and keep the Stats modal it opens *outside* that wrapper, since it belongs
 * > to the light page."
 *
 * The prototype puts it there literally — `StatsModal` is the sibling after the
 * `fs-dark` div closes (`ListsCommon.jsx`:675) — and so does this file.
 */
describe('LV.16 — the Stats picker belongs to the light page, so it lives outside the wrapper', () => {
  it('it is a sibling of the wrapper, not a descendant', () => {
    // Depth, not order: "appears later in the file" would still hold if the
    // picker were moved inside the wrapper's last child. See `indentOf`.
    expect(indentOf(WINDOW, '<Popover open={statsOpen}')).toBe(
      indentOf(WINDOW, '<div className="fs-dark'),
    )
    // …and the wrapper really does have children deeper than itself, so the
    // equality above is a claim about structure rather than a flat file.
    expect(indentOf(WINDOW, 'onPointerDown={onHeaderPointerDown}')).toBeGreaterThan(
      indentOf(WINDOW, '<div className="fs-dark'),
    )
  })

  it('it is the toolbar’s own catalog, not a second picker (D11)', () => {
    expect(code(WINDOW)).toContain("import { StatsCatalog } from './list-toolbar'")
    expect(code(WINDOW)).toContain('<StatsCatalog')
    // Exported for exactly this, and still used by the toolbar's own popover.
    expect(code(TOOLBAR)).toContain('export function StatsCatalog')
    expect(code(TOOLBAR)).toContain('<StatsCatalog cols={cols} onToggleCol={onToggleCol} />')
  })
})

/**
 * **F-LV15.1 and F-LV15.2, discharged.** LV.15 shipped a marked scaffold body
 * and a header two controls short, filed both as obligations on this task rather
 * than leaving them implicit, and the plan's LV.16 row names them (R230).
 */
describe('LV.16 — the scaffold is gone and the header is complete (F-LV15.1, F-LV15.2)', () => {
  it('`ListWindowBodyPending` exists nowhere in the tree', () => {
    // Deleted outright, as LV.13 deleted LV.12's `ComparisonPending` — not
    // renamed, not left unreferenced. Read stripped, so the window's own header
    // can go on *naming* the hand-off it discharged: this forbids the component,
    // not the word.
    expect(tsxTree().filter((file) => code(file).includes('ListWindowBodyPending'))).toEqual([])
    // …and the branch it occupied renders the real thing, so a rename could not
    // satisfy the line above while leaving a scaffold in place.
    expect(code(WINDOW)).toContain('<ListWindowRows')
    expect(code(WINDOW)).not.toContain('Pending')
  })

  it('the header carries cover, name, gear, dots, collapse, close — in that order', () => {
    const source = code(WINDOW)
    const at = (needle: string) => {
      const index = source.indexOf(needle)
      if (index < 0) throw new Error(`LV.16: \`${needle}\` is not in ${WINDOW}.`)
      return index
    }
    expect(at('<ListCoverTile')).toBeLessThan(at('name="gear"'))
    expect(at('name="gear"')).toBeLessThan(at('name="dots"'))
    expect(at('name="dots"')).toBeLessThan(at("label={minimized ? 'Expand' : 'Collapse'}"))
    expect(at("label={minimized ? 'Expand' : 'Collapse'}")).toBeLessThan(at('label="Close"'))
  })

  /**
   * Neither is decorative. R220's rule — a control that does nothing is worse
   * than one not yet there — is why LV.15 left them out, so what discharges the
   * hand-off is the wiring, not the glyph.
   */
  it('the gear opens the picker and the dots menu regroups THIS list', () => {
    const source = code(WINDOW)
    expect(source).toContain('onClick={() => setStatsOpen(true)}')
    expect(source).toContain('open={statsOpen}')
    // A compose, not a build: the same five options and the same per-list
    // `setOrg` a Side by side column's menu uses (plan §6's LV.16 row).
    expect(source).toContain("import {\n  bucketHeading,\n  buildBuckets,\n  canReorder,\n  ORG_OPTIONS,")
    expect(source).toContain('ORG_OPTIONS.map((option)')
    expect(source).toContain('setOrg(listId, option.id)')
    // Keyed by list id — a window and a column showing the same list agree,
    // and neither moves the other's grouping.
    expect(source).toContain('useListDisplay(listId)')
  })
})

/** The LAW's row, number by number. */
describe('LV.16 — the rows are the LAW’s, converted ×0.8', () => {
  it('36px → 29, over a 22px sticky caption row', () => {
    expect(classNameContaining(WINDOW, 'h-[29px]')).toContain('border-b border-n-4')
    expect(classNameContaining(WINDOW, 'h-[22px]')).toContain('sticky top-0')
  })

  it('the name is Regular — heavier reads as a heading on ink', () => {
    const name = classNameContaining(WINDOW, 'font-normal')
    expect(name).toContain('text-[10.5px]')
    expect(name).not.toContain('font-semibold')
    expect(name).not.toContain('font-bold')
  })

  it('hover is the 9% wash, and a drafted row dims to 45% over a 5% one', () => {
    expect(classStringsContaining(WINDOW, 'hover:bg-white/[0.09]')).not.toHaveLength(0)
    const draftedRow = classNameContaining(WINDOW, 'bg-white/[0.05]')
    expect(draftedRow).toContain('opacity-45')
  })

  it('no team code: the LAW’s row for THIS surface is checkbox, #N, name, badge, stats', () => {
    // `PlayerMeta` is the column's row (badge **+ team**); the pop-out's is the
    // badge alone, in both the README and the prototype. A 264px window spends
    // the width on a stat column instead.
    expect(code(WINDOW)).not.toContain('PlayerMeta')
    expect(code(WINDOW)).toContain('<PositionBadge')
  })
})

/**
 * > "Rows are drag-reorderable with the same gap model."
 *
 * The *gesture* is `use-list-drag.tsx` (LV.4, D5) and what a drop **writes** is
 * `use-list-drop.ts` — which is `list-detail-panel.tsx`'s own commit, moved at
 * LV.16 rather than copied, so the two surfaces cannot drift on the two rules it
 * carries (a refused drop says so; the two writes are sequenced, not raced).
 */
describe('LV.16 — drag-reorder is the shared model, and so is the commit', () => {
  it('the window drives the shared drag hook and the shared gap', () => {
    const source = code(WINDOW)
    expect(source).toContain("from './use-list-drag'")
    expect(source).toContain('useListDrag({')
    expect(source).toContain('<ListDragContext')
    expect(source).toContain('useDragHandle(entry.id')
    expect(source).toContain('<DropGap')
    expect(source).toContain('data-drop-row=')
    expect(source).toContain('data-drag-id=')
    // The model the LAW rules out in its first sentence ("rows never highlight
    // themselves"), and which `use-list-drag.tsx`'s header explains it does not
    // use.
    expect(source).not.toContain('@dnd-kit/sortable')
  })

  it('one commit, two surfaces — and the panel no longer has its own', () => {
    for (const file of [WINDOW, PANEL]) {
      expect(code(file), file).toContain('useListDropCommit({')
    }
    // The moved rules, in one place: the refusal toast and the sequencing.
    const commit = code(DROP_COMMIT)
    expect(commit).toContain('bucketDrop(')
    expect(commit).toContain('planDrop({')
    expect(commit).toContain('That section cannot be assigned')
    expect(commit).toContain('onSuccess: () => {')
    // Not two copies of it.
    expect(code(PANEL)).not.toContain('planDrop({')
    expect(code(WINDOW)).not.toContain('planDrop({')
  })

  it('reordering is offered only where the array IS the order, and only to the owner', () => {
    const source = code(WINDOW)
    // `canReorder` is the shared answer — cost and budget bands are computed
    // from the auction value, so a drag there would snap back.
    expect(source).toContain('canEdit && canReorder(org)')
    expect(source).toContain('is_owner')
  })
})

/**
 * > "**Resize:** … Widening reveals more stat columns."
 *
 * The mechanism is the prototype's: the rows keep a minimum width and the body
 * scrolls, so a wider window simply shows more of them. Nothing recomputes which
 * stats exist at which width — which is why a stat cannot silently disappear at
 * a size nobody tested.
 */
describe('LV.16 — widening the window reveals more stat columns', () => {
  it('rows carry `190 + cols × 68` at ×0.8, and the body scrolls to it', () => {
    const source = code(WINDOW)
    expect(source).toContain('return 152 + statCount * 54')
    expect(source).toContain('style={{ minWidth }}')
    expect(classStringsContaining(WINDOW, 'overflow-auto')).not.toHaveLength(0)
  })

  it('every chosen stat is rendered — the three-stat cut is card view’s', () => {
    const source = code(WINDOW)
    expect(source).toContain('resolveStats(display.cols)')
    // `colsForView` is what truncates to three, and it belongs to the card view.
    expect(source).not.toContain('colsForView')
    expect(source).toContain('formatStat(stat, entry)')
  })
})

/**
 * > "Footer: views / comments, and a **brand-lime Share button with literal
 * > `#000` text** — inside the dark wrapper `--n-1` resolves to white, so a
 * > token-based ink color would render white-on-lime."
 *
 * This is the LAW's one sanctioned literal on this surface, and the pin says so
 * rather than treating `#000` as an ordinary hex to be tidied into a token
 * later.
 */
describe('LV.16 — the footer, and the one literal the LAW asks for', () => {
  it('Share is lime with literal ink, and takes its ink from no token', () => {
    const share = classNameContaining(WINDOW, 'bg-brand')
    expect(share).toContain('text-[#000]')
    // The two tokens that would render white here, and the one that would look
    // right today and silently follow a palette change tomorrow.
    for (const token of ['text-ink', 'text-n-1', 'text-white', 'text-brand-foreground']) {
      expect(share, token).not.toContain(token)
    }
    // `variant="lime"` fills brand-*strong*; the lime is put back exactly as
    // `list-detail-hero.tsx` does it.
    expect(share).toContain('bg-brand')
  })

  it('views and comments read out, and an unknown count is not zero', () => {
    const source = code(WINDOW)
    expect(source).toContain('formatCount(list?.view_count)')
    expect(source).toContain('comments.data ? formatCount(comments.data.pagination.total)')
    // `0` over a request that has not answered is the false-empty CLAUDE.md
    // names outright.
    expect(source).toContain("'—'")
  })
})
