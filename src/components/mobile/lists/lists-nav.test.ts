/**
 * Lists' Back (Chris, 2026-10-15, gap list #27): "Back always goes to where
 * you came from. Period." — history back whenever an app screen is behind,
 * else the screen's parent, replacing. The editor and Edit details keep their
 * own hand-back to the List view.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => search,
}))

import { editorHref, useListsNav } from './lists-nav'

type Nav = ReturnType<typeof useListsNav>

/** The nav on a screen whose URL carries `query`. */
function navOn(query: string): Nav {
  search = new URLSearchParams(query)
  let nav: Nav | null = null
  function Probe() {
    nav = useListsNav()
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return nav!
}

/** Whether an app screen is behind this one (the Navigation API's index). */
function behind(appScreen: boolean) {
  vi.stubGlobal('window', { navigation: { currentEntry: { index: appScreen ? 3 : 0 } } })
}

beforeEach(() => {
  router.push.mockClear()
  router.replace.mockClear()
  router.back.mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the List view’s Back', () => {
  it('opened from Profile, Home or a player (no `from`): back there, not to the grid', () => {
    behind(true)
    navOn('list=l1').closeList()
    expect(router.back).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('opened from the grid: back to the grid', () => {
    behind(true)
    navOn('list=l1&from=grid').closeList()
    expect(router.back).toHaveBeenCalledTimes(1)
  })

  it('a shared link with nothing of the app behind: the grid, replacing', () => {
    behind(false)
    navOn('list=l1').closeList()
    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith('/app/lists')
  })
})

describe('New list’s Back', () => {
  it('opened from Profile or Community: back there', () => {
    behind(true)
    navOn('from=back').closeNew()
    expect(router.back).toHaveBeenCalledTimes(1)
  })

  it('a link with no marker but an app screen behind: back there too', () => {
    behind(true)
    navOn('').closeNew()
    expect(router.back).toHaveBeenCalledTimes(1)
  })

  it('nothing of the app behind: the grid, replacing', () => {
    behind(false)
    navOn('from=grid').closeNew()
    expect(router.replace).toHaveBeenCalledWith('/app/lists')
  })
})

describe('the grid’s Back', () => {
  it('back to where you came from, else Profile', () => {
    behind(true)
    navOn('').leaveLists()
    expect(router.back).toHaveBeenCalledTimes(1)
    behind(false)
    navOn('').leaveLists()
    expect(router.replace).toHaveBeenCalledWith('/app/profile')
  })
})

describe('the editor and Edit details hand back to their List view', () => {
  it('pushed from the view: history back to it', () => {
    behind(true)
    navOn('list=l1&edit=1&from=view').closeEdit('l1')
    expect(router.back).toHaveBeenCalledTimes(1)
  })

  it('an editor opened with the grid behind it (a link): replaced by the view, keeping the grid behind it', () => {
    behind(true)
    navOn('list=l1&edit=1&from=grid').closeEdit('l1')
    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith('/app/lists?list=l1&from=grid')
  })
})

describe('the List view’s Edit and Add players', () => {
  it('push the editor over the view', () => {
    behind(true)
    const nav = navOn('list=l1&from=grid')
    nav.openEditor('l1')
    nav.openEditor('l1', true)
    expect(router.push).toHaveBeenNthCalledWith(1, '/app/lists?list=l1&edit=1&from=view')
    expect(router.push).toHaveBeenNthCalledWith(2, '/app/lists?list=l1&edit=1&add=1&from=view')
  })

  it('the editor’s URL carries only Add players and where it came from — New list has its own step 2 (`new-list-save.ts`)', () => {
    expect(editorHref('l1', { add: true, from: 'view' })).toBe('/app/lists?list=l1&edit=1&add=1&from=view')
    expect(editorHref('l1')).toBe('/app/lists?list=l1&edit=1')
  })
})

describe('a new list started from Community returns to Community (gap list §3 #8)', () => {
  /** `entries` app screens behind this one; `go` is history.go. */
  function behindBy(entries: number) {
    const go = vi.fn()
    vi.stubGlobal('window', { navigation: { currentEntry: { index: entries } }, history: { go, length: entries + 1 } })
    return go
  }

  it('New list from Community: X goes back there, as every Back does', () => {
    behind(true)
    navOn('from=community').closeNew()
    expect(router.back).toHaveBeenCalledTimes(1)
  })

  it('saved: three entries back — past step 1 again and New list’s first entry — to Community', () => {
    const go = behindBy(3)
    expect(navOn('from=community&step=2').returnToCommunity(3)).toBe(true)
    expect(go).toHaveBeenCalledWith(-3)
    expect(router.replace).not.toHaveBeenCalled()
    expect(router.back).not.toHaveBeenCalled()
  })

  it('saved with only New list’s own entries behind (opened fresh): no step back — the caller leaves for Community', () => {
    const go = behindBy(2)
    expect(navOn('from=community&step=2').returnToCommunity(3)).toBe(false)
    expect(go).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })
})
