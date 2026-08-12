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
 * One element's own `className` string, found by a class only it carries.
 *
 * **The marker has to stay unique, and that is checked rather than assumed**
 * (R226's audit). This returns the *first* match, so a second element carrying
 * the same class would silently redirect every assertion below onto the wrong
 * element — and `cursor-grab` is one edit away from being ambiguous, because
 * **LV.16** brings drag-reorder rows into this same file. Ambiguity fails here
 * instead of resolving to whichever element happens to come first.
 */
const classNameContaining = (file: string, marker: string) => {
  const all = [...code(file).matchAll(new RegExp(`className="([^"]*${marker}[^"]*)"`, 'g'))]
  if (all.length === 0) {
    throw new Error(
      `LV.15: no className containing \`${marker}\` in ${file} — the pin below is guarding nothing.`,
    )
  }
  if (all.length > 1) {
    throw new Error(
      `LV.15: \`${marker}\` appears in ${all.length} classNames in ${file} — it no longer ` +
        'identifies one element, so the pin below is asserting about whichever came first.',
    )
  }
  return all[0][1]
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
    const header = classNameContaining(WINDOW, 'cursor-grab')
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
    expect(source).toContain("import { useList } from '@/hooks/use-lists'")
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
    for (const phrase of ['shadow-hard-*', 'ZOOM = 0.8', '12.5 × 0.8']) {
      expect(read(WINDOW), phrase).toContain(phrase)
      expect(source, phrase).not.toContain(phrase)
    }
  })
})
