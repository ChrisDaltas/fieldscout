/**
 * `appEntryBehind` — whether Back (or a screen stepping back further, like a
 * saved New list returning to Community, gap list §3 #8) stays in the app.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appEntryBehind } from './back-nav'

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
