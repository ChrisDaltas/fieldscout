/**
 * `appEntryBehind` — whether Back (or a screen stepping back further, like a
 * saved New list returning to Community, gap list §3 #8) stays in the app.
 * `pathBehind` / `leaveVia` — leaving a screen for another without leaving
 * it in history (a deleted mock report landing on Mock drafts, item 110).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appEntryBehind, leaveVia, pathBehind } from './back-nav'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('appEntryBehind', () => {
  it('with the Navigation API: the entries behind this one are the app’s', () => {
    vi.stubGlobal('window', { navigation: { currentEntry: { index: 2 } }, history: { length: 9 } })
    expect(appEntryBehind()).toBe(true)
    expect(appEntryBehind(2)).toBe(true)
    expect(appEntryBehind(3)).toBe(false)
  })

  it('a fresh tab (nothing of the app behind)', () => {
    vi.stubGlobal('window', { navigation: { currentEntry: { index: 0 } }, history: { length: 4 } })
    expect(appEntryBehind()).toBe(false)
  })

  it('without the API: a same-origin referrer and a history at least that long', () => {
    vi.stubGlobal('window', { history: { length: 2 }, location: { origin: 'https://fieldscout.gg' } })
    vi.stubGlobal('document', { referrer: 'https://fieldscout.gg/app/explore' })
    expect(appEntryBehind()).toBe(true)
    expect(appEntryBehind(2)).toBe(false)
    vi.stubGlobal('document', { referrer: '' })
    expect(appEntryBehind()).toBe(false)
  })
})

/** A Navigation API whose entries are these paths, standing on the last. */
function stubEntries(paths: string[], index = paths.length - 1) {
  const entries = paths.map((p) => ({ url: `https://fieldscout.gg${p}` }))
  vi.stubGlobal('window', { navigation: { currentEntry: { index }, entries: () => entries }, history: { length: 9 } })
}

describe('pathBehind', () => {
  it('the path of the app screen right behind this one', () => {
    stubEntries(['/app', '/app/mocks?tab=finished', '/app/mocks/m1/report'])
    expect(pathBehind()).toBe('/app/mocks')
  })

  it('null with nothing of the app behind, or no Navigation API to ask', () => {
    stubEntries(['/app/mocks/m1/report'])
    expect(pathBehind()).toBeNull()
    vi.stubGlobal('window', { navigation: { currentEntry: { index: 2 } }, history: { length: 9 } })
    expect(pathBehind()).toBeNull()
    vi.stubGlobal('window', { history: { length: 9 } })
    expect(pathBehind()).toBeNull()
  })
})

describe('leaveVia — a deleted (or empty) mock report leaving for Mock drafts', () => {
  it('Mock drafts › report: steps back to it — no second Mock drafts, so the next Back reaches Home', () => {
    stubEntries(['/app', '/app/mocks', '/app/mocks/m1/report'])
    expect(leaveVia('/app/mocks')).toBe('back')
  })

  it('opened from anywhere else, or fresh: replaces the report with Mock drafts', () => {
    stubEntries(['/app', '/app/leagues/lg1', '/app/mocks/m1/report'])
    expect(leaveVia('/app/mocks')).toBe('replace')
    stubEntries(['/app/mocks/m1/report'])
    expect(leaveVia('/app/mocks')).toBe('replace')
    vi.stubGlobal('window', { history: { length: 3 } })
    expect(leaveVia('/app/mocks')).toBe('replace')
  })

  it('compares paths only: a practice home behind with its own query still counts', () => {
    stubEntries(['/app/mocks?tab=finished', '/app/mocks/m1/report'])
    expect(leaveVia('/app/mocks')).toBe('back')
    expect(leaveVia('/app/mocks/other')).toBe('replace')
  })
})
