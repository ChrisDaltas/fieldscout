import { afterEach, describe, expect, it, vi } from 'vitest'

import { LAST_RANK_POS_KEY, readLastRankPos, rememberRankPos } from '@/components/mobile/rankings/last-position'

/** Rankings start on the position last used on this device (gap list #32). */

function storage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the remembered Rankings position', () => {
  it('remembers the last position and reads it back', () => {
    const s = storage()
    vi.stubGlobal('window', { localStorage: s })
    expect(readLastRankPos()).toBeNull()
    rememberRankPos('WR')
    rememberRankPos('TE')
    expect(s.data.get(LAST_RANK_POS_KEY)).toBe('TE')
    expect(readLastRankPos()).toBe('TE')
  })

  it('ignores anything that isn’t a ranking position', () => {
    const s = storage()
    s.data.set(LAST_RANK_POS_KEY, 'FLEX')
    vi.stubGlobal('window', { localStorage: s })
    expect(readLastRankPos()).toBeNull()
  })

  it('blocked storage (a private window) remembers nothing and never throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError')
        },
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      },
    })
    expect(() => rememberRankPos('QB')).not.toThrow()
    expect(readLastRankPos()).toBeNull()
  })

  it('no window (the server) reads nothing', () => {
    vi.stubGlobal('window', undefined)
    expect(readLastRankPos()).toBeNull()
    expect(() => rememberRankPos('QB')).not.toThrow()
  })
})
