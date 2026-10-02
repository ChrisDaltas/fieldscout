import { describe, expect, it } from 'vitest'

import { reportVisitedLeagues, runScopedJob } from './scoped-job'

// F558 / F559: a scoped job call that skipped its league on a row lock
// (`leagues: 0`) is re-run at the same instant; a league out of the job's
// scope is accepted at once; a lock that never clears fails LOUD.
const noSleep = async (): Promise<void> => {}

function scripted(reports: number[]) {
  let calls = 0
  return {
    call: async () => ({ leagues: reports[Math.min(calls++, reports.length - 1)] }),
    calls: () => calls,
  }
}

describe('runScopedJob (F558)', () => {
  it('re-runs a call that skipped an in-scope league until the job visits it', async () => {
    const s = scripted([0, 0, 1])
    const r = await runScopedJob({ label: 't', call: s.call, visited: (x) => reportVisitedLeagues(x) === 1, inScope: async () => true, sleep: noSleep })
    expect(r.report).toEqual({ leagues: 1 })
    expect(r.skippedOnLock).toBe(2)
    expect(s.calls()).toBe(3)
  })

  it('accepts a 0-league report at once when the league is out of the job scope', async () => {
    const s = scripted([0])
    const r = await runScopedJob({ label: 't', call: s.call, visited: (x) => reportVisitedLeagues(x) === 1, inScope: async () => false, sleep: noSleep })
    expect(r.skippedOnLock).toBe(0)
    expect(s.calls()).toBe(1)
  })

  it('does not re-run a call that visited the league', async () => {
    const s = scripted([1])
    const r = await runScopedJob({ label: 't', call: s.call, visited: (x) => reportVisitedLeagues(x) === 1, inScope: async () => true, sleep: noSleep })
    expect(r.skippedOnLock).toBe(0)
    expect(s.calls()).toBe(1)
  })

  it('fails loud, naming the call, when the lock never clears', async () => {
    const s = scripted([0])
    await expect(
      runScopedJob({ label: 'lineup_lock_tick@2099-09-13T17:00:00.000Z', call: s.call, visited: (x) => reportVisitedLeagues(x) === 1, inScope: async () => true, sleep: noSleep, attempts: 4 }),
    ).rejects.toThrow(/lineup_lock_tick@2099-09-13T17:00:00.000Z: the job never visited the league in 4 call\(s\)/)
    expect(s.calls()).toBe(4)
  })

  it('reads a missing or malformed leagues count as 0 (never as visited)', () => {
    expect(reportVisitedLeagues(null)).toBe(0)
    expect(reportVisitedLeagues({})).toBe(0)
    expect(reportVisitedLeagues({ leagues: 'x' })).toBe(0)
    expect(reportVisitedLeagues({ leagues: 1 })).toBe(1)
  })
})
