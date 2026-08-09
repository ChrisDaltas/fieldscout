import { readFileSync } from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import {
  CARD_VIEW_COL_COUNT,
  DEFAULT_BUDGET,
  DEFAULT_COLS,
  DEFAULT_COST_BANDS,
  DEFAULT_LIST_DISPLAY,
  LIST_ORGS,
  MAX_BUDGET,
  MIN_BUDGET,
  colsForView,
  resolveBandLabel,
  resolveOrg,
  selectListDisplay,
  useListDisplayStore,
} from '@/stores/list-display-store'

/**
 * LV.1.4 — session-only display state (delivery-plan-lists-v2.md §4, D3/D4).
 *
 * Two jobs, in two describes:
 *
 *   1. the state layer behaves — per-list isolation, ordered `cols`, band-label
 *      fallback, budget clamping, and **reference identity on both sides of the
 *      store**: the selector never builds a fresh object, and no mutator
 *      allocates one on a write that changes nothing (zustand v5 subscribes
 *      through `useSyncExternalStore`, so either mistake re-renders forever);
 *   2. **D3 holds and stays held.** "No `persist` middleware" is a decision
 *      that reads like an oversight — every other store in `src/stores/` is
 *      persisted — so it is guarded, not merely commented. The second describe
 *      is that guard, and it carries its own control: the same three
 *      assertions are shown tripping on a store that *is* persisted, so a
 *      green run means the detectors work, not that they are asleep.
 *
 *      That guard shipped with a hole (R179) and the fix is easy to undo by
 *      accident, so: it stubs **`window`** as well as the bare `localStorage` /
 *      `sessionStorage` globals. Without it, any write behind the house
 *      `typeof window === 'undefined'` guard — `use-draft-mode.ts:19` is the
 *      pattern — takes its early return under vitest's node environment and no
 *      spy ever fires.
 */

const STORE_FILE = 'src/stores/list-display-store.ts'
const LIST_A = 'list-aaa'
const LIST_B = 'list-bbb'

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')

/** A minimal in-memory Storage stand-in, so every access is observable. */
function fakeStorage() {
  const data = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    removeItem: vi.fn((key: string) => void data.delete(key)),
    clear: vi.fn(() => data.clear()),
    key: vi.fn(() => null),
    get length() {
      return data.size
    },
  }
}

describe('list display store — session state (LV.1.4)', () => {
  afterEach(() => {
    useListDisplayStore.setState({ byList: {} })
  })

  it('a list nobody has touched reads the shared, frozen defaults', () => {
    const display = selectListDisplay(LIST_A)(useListDisplayStore.getState())

    expect(display).toBe(DEFAULT_LIST_DISPLAY)
    expect(display).toEqual({
      view: 'list',
      org: null,
      cols: DEFAULT_COLS,
      bandLabels: {},
      budget: DEFAULT_BUDGET,
    })
    // Frozen because it is handed out by reference: a consumer that mutated it
    // would change the defaults for every other list in the session.
    expect(Object.isFrozen(display)).toBe(true)
    expect(Object.isFrozen(display.cols)).toBe(true)
  })

  it('hands out the same object reference until that list actually changes', () => {
    const first = selectListDisplay(LIST_A)(useListDisplayStore.getState())
    useListDisplayStore.getState().setView(LIST_B, 'table')
    const second = selectListDisplay(LIST_A)(useListDisplayStore.getState())

    // zustand v5 subscribes through useSyncExternalStore, which loops forever
    // on a selector that returns a fresh object every call.
    expect(second).toBe(first)

    useListDisplayStore.getState().setView(LIST_A, 'card')
    expect(selectListDisplay(LIST_A)(useListDisplayStore.getState())).not.toBe(first)
  })

  it('setting one list never touches another', () => {
    const store = useListDisplayStore.getState()
    store.setView(LIST_A, 'card')
    store.setBudget(LIST_A, 300)
    store.setCols(LIST_A, ['adp'])

    expect(selectListDisplay(LIST_A)(useListDisplayStore.getState())).toMatchObject({
      view: 'card',
      budget: 300,
      cols: ['adp'],
    })
    expect(selectListDisplay(LIST_B)(useListDisplayStore.getState())).toBe(DEFAULT_LIST_DISPLAY)
  })

  it('setOrg records every grouping mode, and null drops the override', () => {
    for (const org of LIST_ORGS) {
      useListDisplayStore.getState().setOrg(LIST_A, org)
      expect(selectListDisplay(LIST_A)(useListDisplayStore.getState()).org).toBe(org)
    }

    useListDisplayStore.getState().setOrg(LIST_A, null)
    expect(selectListDisplay(LIST_A)(useListDisplayStore.getState()).org).toBeNull()
  })

  it('resolveOrg prefers the session override, else the list’s own grouping (D4)', () => {
    // The override wins whatever the list says…
    expect(resolveOrg('round', 'rank_and_tier')).toBe('round')
    expect(resolveOrg('budget', 'unranked')).toBe('budget')

    // …and with no override, a tiered list opens tiered rather than being
    // silently flattened to plain rank by a hard-coded default.
    expect(resolveOrg(null, 'rank_and_tier')).toBe('tier')
    expect(resolveOrg(null, 'ranked')).toBe('rank')
    expect(resolveOrg(null, 'unranked')).toBe('rank')
    expect(resolveOrg(undefined, null)).toBe('rank')
  })

  it('setCols keeps the caller’s order, drops duplicates, and copies the array', () => {
    const chosen = ['adp', 'proj', 'adp', 'bye']
    useListDisplayStore.getState().setCols(LIST_A, chosen)
    expect(selectListDisplay(LIST_A)(useListDisplayStore.getState()).cols).toEqual([
      'adp',
      'proj',
      'bye',
    ])

    // The store must not alias the caller's array — a later push would
    // otherwise mutate state behind zustand's back and skip every re-render.
    chosen.push('sos')
    expect(selectListDisplay(LIST_A)(useListDisplayStore.getState()).cols).toEqual([
      'adp',
      'proj',
      'bye',
    ])
  })

  it('toggleCol appends a new stat at the end and removes a chosen one in place', () => {
    const store = useListDisplayStore.getState()
    store.setCols(LIST_A, ['proj', 'adp'])

    store.toggleCol(LIST_A, 'bye')
    expect(selectListDisplay(LIST_A)(useListDisplayStore.getState()).cols).toEqual([
      'proj',
      'adp',
      'bye',
    ])

    store.toggleCol(LIST_A, 'adp')
    expect(selectListDisplay(LIST_A)(useListDisplayStore.getState()).cols).toEqual(['proj', 'bye'])
  })

  it('moveCol reorders the chips, clamps the target, and no-ops on an unknown stat', () => {
    const store = useListDisplayStore.getState()
    store.setCols(LIST_A, ['proj', 'adp', 'bye'])

    store.moveCol(LIST_A, 'bye', 0)
    expect(selectListDisplay(LIST_A)(useListDisplayStore.getState()).cols).toEqual([
      'bye',
      'proj',
      'adp',
    ])

    store.moveCol(LIST_A, 'bye', 99)
    expect(selectListDisplay(LIST_A)(useListDisplayStore.getState()).cols).toEqual([
      'proj',
      'adp',
      'bye',
    ])

    const before = selectListDisplay(LIST_A)(useListDisplayStore.getState())
    store.moveCol(LIST_A, 'not-a-stat', 0)
    expect(selectListDisplay(LIST_A)(useListDisplayStore.getState())).toBe(before)

    // A non-finite index is refused, not clamped. NaN walks straight through
    // Math.trunc/min/max and `splice` then reads it as 0, so an unmeasurable
    // drop would silently move the chip to the *front* — the loudest possible
    // wrong answer to "I don't know". Same call `setBudget` makes on NaN.
    store.moveCol(LIST_A, 'bye', Number.NaN)
    expect(selectListDisplay(LIST_A)(useListDisplayStore.getState())).toBe(before)
    store.moveCol(LIST_A, 'bye', Number.POSITIVE_INFINITY)
    expect(selectListDisplay(LIST_A)(useListDisplayStore.getState())).toBe(before)
    expect(before.cols).toEqual(['proj', 'adp', 'bye'])
  })

  it('colsForView gives card view the first three stats and every other view all of them', () => {
    const cols = ['proj', 'adp', 'bye', 'sos', 'auction']

    expect(colsForView(cols, 'card')).toEqual(['proj', 'adp', 'bye'])
    expect(colsForView(cols, 'card')).toHaveLength(CARD_VIEW_COL_COUNT)
    expect(colsForView(cols, 'list')).toBe(cols)
    expect(colsForView(cols, 'table')).toBe(cols)
    expect(colsForView(['proj'], 'card')).toEqual(['proj'])
  })

  it('band labels are overrides — a blank rename restores the default, not an empty header', () => {
    const store = useListDisplayStore.getState()
    const [firstBand] = DEFAULT_COST_BANDS

    expect(resolveBandLabel(firstBand.key, {})).toBe(firstBand.label)
    expect(resolveBandLabel('unknown-band', {})).toBe('unknown-band')

    store.setBandLabel(LIST_A, firstBand.key, '  Studs  ')
    let bandLabels = selectListDisplay(LIST_A)(useListDisplayStore.getState()).bandLabels
    expect(bandLabels[firstBand.key]).toBe('Studs')
    expect(resolveBandLabel(firstBand.key, bandLabels)).toBe('Studs')

    store.setBandLabel(LIST_A, firstBand.key, '   ')
    bandLabels = selectListDisplay(LIST_A)(useListDisplayStore.getState()).bandLabels
    expect(bandLabels).not.toHaveProperty(firstBand.key)
    expect(resolveBandLabel(firstBand.key, bandLabels)).toBe(firstBand.label)
  })

  it('a bucket key that collides with an Object member is stored and read like any other', () => {
    // Band keys are free text, and stop being the closed `c1`–`c4` set as soon
    // as LV.1.5 widens the tier enum to DB-sourced `list_players.tier` values —
    // so `__proto__` and `constructor` are reachable input, not hypotheticals.
    // On a plain `{}` the first returns a *function* from a `: string` API and
    // the second is swallowed by the prototype setter and stored nowhere.
    expect(resolveBandLabel('constructor', {})).toBe('constructor')
    expect(resolveBandLabel('__proto__', {})).toBe('__proto__')
    expect(resolveBandLabel('toString', { toString: 'Bench' })).toBe('Bench')

    const store = useListDisplayStore.getState()
    store.setBandLabel(LIST_A, '__proto__', 'Studs')
    const { bandLabels } = selectListDisplay(LIST_A)(useListDisplayStore.getState())

    expect(Object.keys(bandLabels)).toEqual(['__proto__'])
    expect(resolveBandLabel('__proto__', bandLabels)).toBe('Studs')
    expect(Object.getPrototypeOf(bandLabels)).toBeNull()

    // …and clearing it still restores the default, on the same key.
    store.setBandLabel(LIST_A, '__proto__', '  ')
    expect(
      Object.keys(selectListDisplay(LIST_A)(useListDisplayStore.getState()).bandLabels),
    ).toEqual([])
  })

  it('every mutator hands back the same object on a value-identical write', () => {
    const s = () => useListDisplayStore.getState()
    const read = () => selectListDisplay(LIST_A)(useListDisplayStore.getState())

    // Start customised, so what follows is identity on a real stored entry and
    // not the frozen default trivially comparing equal to itself.
    s().setView(LIST_A, 'card')
    s().setOrg(LIST_A, 'cost')
    s().setCols(LIST_A, ['proj', 'adp', 'bye'])
    s().setBandLabel(LIST_A, 'c1', 'Studs')
    s().setBudget(LIST_A, 300)
    const before = read()

    // One write per mutator that leaves the value exactly as it is — every one
    // a shape a real toolbar produces: re-picking the current view, handing
    // back a copy of `cols`, dropping a chip where it already sits,
    // re-submitting a label the user never edited, clearing an unset override.
    s().setView(LIST_A, before.view)
    s().setOrg(LIST_A, before.org)
    s().setCols(LIST_A, [...before.cols])
    s().setCols(LIST_A, [...before.cols, 'adp'])
    s().moveCol(LIST_A, 'adp', 1)
    s().moveCol(LIST_A, 'not-a-stat', 0)
    s().moveCol(LIST_A, 'adp', Number.NaN)
    s().setBandLabel(LIST_A, 'c1', '  Studs  ')
    s().setBandLabel(LIST_A, 'c2', '   ')
    s().setBudget(LIST_A, 300.2)
    s().reset(LIST_B)

    // `toBe`, not `toEqual` — an equal-but-new object is the whole bug. LV.3.7's
    // reorderable chip picker derives its next `setCols` from the `cols` it just
    // read, so a fresh array per no-op write is an infinite render loop that
    // leaves nothing red anywhere.
    expect(read()).toBe(before)

    // `toggleCol` is the one mutator with no value-identical input by
    // construction — it always adds or removes exactly one stat. Its round trip
    // is therefore two genuine changes and *should* notify twice.
    s().toggleCol(LIST_A, 'sos')
    s().toggleCol(LIST_A, 'sos')
    expect(read()).toEqual(before)
    expect(read()).not.toBe(before)

    // A mutator added later gets a line above rather than inheriting this
    // silently: this fails the moment the surface changes.
    expect(
      Object.entries(useListDisplayStore.getState())
        .filter(([, value]) => typeof value === 'function')
        .map(([name]) => name)
        .sort(),
    ).toEqual([
      'moveCol',
      'reset',
      'setBandLabel',
      'setBudget',
      'setCols',
      'setOrg',
      'setView',
      'toggleCol',
    ])
  })

  it('setBudget clamps to whole dollars in range and refuses a non-number outright', () => {
    const store = useListDisplayStore.getState()
    const budget = () => selectListDisplay(LIST_A)(useListDisplayStore.getState()).budget

    store.setBudget(LIST_A, 250.4)
    expect(budget()).toBe(250)
    store.setBudget(LIST_A, MAX_BUDGET + 1)
    expect(budget()).toBe(MAX_BUDGET)
    store.setBudget(LIST_A, -5)
    expect(budget()).toBe(MIN_BUDGET)

    // A cleared number input is NaN. It must leave the last good value alone,
    // not land as "$NaN" in every budget header.
    store.setBudget(LIST_A, 200)
    store.setBudget(LIST_A, Number.NaN)
    expect(budget()).toBe(200)
    store.setBudget(LIST_A, Number.POSITIVE_INFINITY)
    expect(budget()).toBe(200)
  })

  it('reset returns one list to the defaults and leaves the rest alone', () => {
    const store = useListDisplayStore.getState()
    store.setView(LIST_A, 'table')
    store.setView(LIST_B, 'card')

    store.reset(LIST_A)
    expect(selectListDisplay(LIST_A)(useListDisplayStore.getState())).toBe(DEFAULT_LIST_DISPLAY)
    expect(selectListDisplay(LIST_B)(useListDisplayStore.getState()).view).toBe('card')
  })

  it('holds no bucket membership and no drafted marks — those are server-side (D2/D4)', () => {
    useListDisplayStore.getState().setView(LIST_A, 'card')
    const display = selectListDisplay(LIST_A)(useListDisplayStore.getState())

    // The whole of D4 is that which player sits in which bucket lives in
    // `list_players.tier` and travels with a shared list; only the label set is
    // local. A "players" or "tiers" key appearing here means that line moved.
    expect(Object.keys(display).sort()).toEqual(['bandLabels', 'budget', 'cols', 'org', 'view'])
  })
})

/**
 * D3 — *"no `persist` middleware and no columns… Do not add persistence 'for
 * convenience' — it was considered and declined."*
 *
 * Four independent detectors, because each alone has a hole: the runtime
 * `.persist` probe misses a hand-rolled `localStorage.setItem`; the storage
 * spies miss a future storage backend; the reload probe is the property users
 * actually experience but says nothing about *how* it was broken; and the
 * source pin catches an import that has not been wired up yet.
 */
describe('D3 — display state is session-only, deliberately unpersisted', () => {
  let localStorageStub: ReturnType<typeof fakeStorage>
  let sessionStorageStub: ReturnType<typeof fakeStorage>

  beforeEach(() => {
    // Vitest runs on the node environment, where web storage does not exist —
    // and `createJSONStorage` swallows that and silently no-ops, which would
    // make this whole describe pass against a genuinely persisted store. So the
    // globals are stubbed *before* the module is evaluated, and the store is
    // imported dynamically below, never statically, so persistence would find a
    // working storage to reach for.
    localStorageStub = fakeStorage()
    sessionStorageStub = fakeStorage()
    vi.stubGlobal('localStorage', localStorageStub)
    vi.stubGlobal('sessionStorage', sessionStorageStub)
    // `window` too, and this one is load-bearing rather than belt-and-braces
    // (R179). Node has no `window`, so the house SSR idiom — `if (typeof window
    // === 'undefined') return` and then `window.localStorage.setItem(...)`,
    // exactly what `src/hooks/use-draft-mode.ts` does — takes its early return
    // under vitest and the bare-global spies above never fire. A store that
    // genuinely persisted `view` in every real browser would sail through this
    // describe. Stubbing `window` puts the guard on the side of the branch that
    // actually writes.
    vi.stubGlobal('window', {
      localStorage: localStorageStub,
      sessionStorage: sessionStorageStub,
    })
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  const freshStore = async () => (await import('@/stores/list-display-store')).useListDisplayStore

  /** Every mutator, so no single unguarded write path can hide. */
  const exerciseEveryMutator = (store: Awaited<ReturnType<typeof freshStore>>) => {
    const s = store.getState()
    s.setView(LIST_A, 'table')
    s.setOrg(LIST_A, 'cost')
    s.setCols(LIST_A, ['proj', 'adp'])
    s.toggleCol(LIST_A, 'bye')
    s.moveCol(LIST_A, 'bye', 0)
    s.setBandLabel(LIST_A, 'c1', 'Studs')
    s.setBudget(LIST_A, 300)

    // `reset` returns early on a list it has never heard of, so resetting an
    // untouched id exercises the guard and never the body (R179). Seed one
    // first, and assert both halves, so the seeding cannot rot back into a
    // no-op without this failing.
    s.setView(LIST_B, 'card')
    expect(store.getState().byList[LIST_B]).toBeDefined()
    s.reset(LIST_B)
    expect(store.getState().byList[LIST_B]).toBeUndefined()
  }

  it('exposes no persist API — nothing wrapped this store in the middleware', async () => {
    const store = await freshStore()
    expect((store as { persist?: unknown }).persist).toBeUndefined()
  })

  it('touches neither localStorage nor sessionStorage, on any mutator', async () => {
    const store = await freshStore()
    exerciseEveryMutator(store)

    for (const stub of [localStorageStub, sessionStorageStub]) {
      expect(stub.getItem).not.toHaveBeenCalled()
      expect(stub.setItem).not.toHaveBeenCalled()
      expect(stub.removeItem).not.toHaveBeenCalled()
    }
  })

  it('forgets everything on reload — display prefs reset like a search filter', async () => {
    const before = await freshStore()
    exerciseEveryMutator(before)
    expect(before.getState().byList[LIST_A]).toBeDefined()

    // A fresh module registry is what a page reload looks like from here.
    vi.resetModules()
    const after = await freshStore()

    expect(after).not.toBe(before)
    expect(after.getState().byList).toEqual({})
  })

  it('control — the same three detectors DO trip on a store that is persisted', () => {
    // Proof the assertions above discriminate rather than pass vacuously: this
    // is the house persistence pattern (see rail-store / ui-store), and all
    // three checks that just passed fail against it.
    const persisted = create<{ view: string; setView: (v: string) => void }>()(
      persist((set) => ({ view: 'list', setView: (view) => set({ view }) }), {
        name: 'fieldscout.test.control',
        storage: createJSONStorage(() => localStorage),
      }),
    )

    expect((persisted as { persist?: unknown }).persist).toBeDefined()

    persisted.getState().setView('card')
    expect(localStorageStub.setItem).toHaveBeenCalled()

    const rehydrated = create<{ view: string }>()(
      persist(() => ({ view: 'list' }), {
        name: 'fieldscout.test.control',
        storage: createJSONStorage(() => localStorage),
      }),
    )
    expect(rehydrated.getState().view).toBe('card')
  })

  it('names no persistence machinery in its own source', async () => {
    // Catches an import added but not yet wired up, and a hand-rolled write the
    // runtime probes would only see if that code path happened to run. Comment
    // lines are excluded so the file can explain the decision in full; a token
    // in a trailing comment on a code line trips this on purpose.
    const codeLines = read(STORE_FILE)
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim()
        return (
          trimmed !== '' &&
          !trimmed.startsWith('//') &&
          !trimmed.startsWith('*') &&
          !trimmed.startsWith('/*')
        )
      })

    // `window` and `globalThis` are here because the bare names above are
    // trivially aliased — `window['local' + 'Storage']` names neither
    // `localStorage` nor any other token on this list (R179). Nothing in a
    // pure state module has any business reaching for either global.
    for (const banned of [
      'zustand/middleware',
      'persist',
      'createJSONStorage',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'document.cookie',
      'window',
      'globalThis',
    ]) {
      const offending = codeLines.filter((line) => line.includes(banned))
      expect(offending, `${STORE_FILE} must not reference ${banned} (D3)`).toEqual([])
    }
  })
})
