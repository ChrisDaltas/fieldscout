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

  it('an editor that replaced New list: replaced by the view, keeping the grid behind it', () => {
    behind(true)
    navOn('list=l1&edit=1&from=grid').closeEdit('l1')
    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith('/app/lists?list=l1&from=grid')
  })
})

describe('New list’s Next: its editor is step 2 of 2 (gap list §3 #7)', () => {
  it('replaces New list with the editor, Add players up and marked new, keeping the grid behind', () => {
    behind(true)
    navOn('from=grid').createdList('l1')
    expect(router.replace).toHaveBeenCalledWith('/app/lists?list=l1&edit=1&add=1&new=1&from=grid')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('opened from Profile or Community: the same, with no grid marker', () => {
    behind(true)
    navOn('from=back').createdList('l1')
    expect(router.replace).toHaveBeenCalledWith('/app/lists?list=l1&edit=1&add=1&new=1')
  })

  it('the List view’s Edit and Add players are not new', () => {
    behind(true)
    const nav = navOn('list=l1&from=grid')
    nav.openEditor('l1')
    nav.openEditor('l1', true)
    expect(router.push).toHaveBeenNthCalledWith(1, '/app/lists?list=l1&edit=1&from=view')
    expect(router.push).toHaveBeenNthCalledWith(2, '/app/lists?list=l1&edit=1&add=1&from=view')
  })

  it('the marker survives the editor being re-rooted on the List view', () => {
    expect(editorHref('l1', { add: true, created: true, from: 'view' })).toBe('/app/lists?list=l1&edit=1&add=1&new=1&from=view')
    expect(editorHref('l1')).toBe('/app/lists?list=l1&edit=1')
  })
})
