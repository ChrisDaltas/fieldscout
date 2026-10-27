/**
 * room-model-pin.test.ts — the source pin behind M7 L.F2.3 drill 1
 * (`realtime-kill-db.test.ts`; PROGRESS D761). That drill's draft room is a
 * model built from the app's real pieces plus `use-draft.ts`'s subscribe
 * doctrine; this pin fails the moment `use-draft.ts` stops doing what the
 * model mirrors, so the drill can never quietly prove an old room.
 *
 * Fast lane on purpose: a stack suite that read `use-draft.ts` would pull
 * the whole draft-room hook tree into the Database job's import closure
 * (F290's pin), for a check that needs no database.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { HEARTBEAT_SILENCE_MS, ROOM_WATCHDOG_MS as APP_WATCHDOG_MS, roomWatchdogWantsRefetch } from '@/hooks/use-draft-ops'

import { modelWatchdogWantsRefetch, ROOM_HEARTBEAT_SILENCE_MS, ROOM_WATCHDOG_MS } from './room-watchdog'

const room = readFileSync(resolve(__dirname, '../../../hooks/use-draft.ts'), 'utf8')
const drill = readFileSync(resolve(__dirname, 'realtime-kill-db.test.ts'), 'utf8')

describe('the drill-1 room model still mirrors use-draft.ts', () => {
  it("reads what the room reads: the drafts row + its picks with the room's exact column list", () => {
    const select = /const PICKS_SELECT = '([^']+)'/.exec(drill)?.[1]
    expect(select).toBeDefined()
    expect(room).toContain(`'${select}'`)
    expect(room).toContain(".from('drafts').select('*').eq('id', draftId!).maybeSingle()")
  })

  it('goes degraded on a failed status and clears it on SUBSCRIBED (F758), polling only while degraded', () => {
    expect(room).toContain('setDegraded(true) // F758: poll every 10 s until SUBSCRIBED again')
    expect(room).toContain('setDegraded(false) // F758: the poll stops the moment we are back')
    expect(room).toContain('useRealtimeFallbackPoll(degraded && Boolean(draftId)')
    expect(room).toContain("if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {")
  })

  it("runs the room's watchdog with the room's numbers (5 s beat, 45 s silence)", () => {
    expect([ROOM_WATCHDOG_MS, ROOM_HEARTBEAT_SILENCE_MS]).toEqual([APP_WATCHDOG_MS, HEARTBEAT_SILENCE_MS])
    expect(room).toContain('}, ROOM_WATCHDOG_MS)')
    expect(drill).toContain('modelWatchdogWantsRefetch({ status: this.view.status, lastBeatAtMs: this.lastBeatAtMs, nowMs: now })')
  })

  // R1718: every branch of the app's rule, against the model's copy — the scheduled arm, the LIVE arm on both
  // sides of the silence (and before the first beat), and the inert PAUSED / complete / no-row arms.
  const NOW = 1_000_000
  const cases: Array<[string, string | null, number | null, boolean]> = [
    ['scheduled, never beat — asks', 'scheduled', null, true],
    ['scheduled, just beat — still asks (a scheduled draft emits no beats)', 'scheduled', NOW, true],
    ['live, beat 1 s ago — quiet', 'live', NOW - 1_000, false],
    ['live, exactly 45 s of silence — quiet (strictly more is doubt)', 'live', NOW - 45_000, false],
    ['live, 45 s + 1 ms of silence — asks', 'live', NOW - 45_001, true],
    ['live, no beat yet — quiet', 'live', null, false],
    ['paused, a minute of silence — inert (silent by design)', 'paused', NOW - 60_000, false],
    ['complete — inert', 'complete', NOW - 60_000, false],
    ['no draft row — inert', null, null, false],
  ]
  for (const [name, status, lastBeatAtMs, wants] of cases) {
    it(`watchdog branch: ${name}`, () => {
      const input = { status, lastBeatAtMs, nowMs: NOW }
      expect(roomWatchdogWantsRefetch(input)).toBe(wants)
      expect(modelWatchdogWantsRefetch(input)).toBe(wants)
    })
  }

  it('refetches on every confirmed join and first on every failure, then reopens with the same backoff', () => {
    expect(room).toContain('const delay = Math.min(1_000 * 2 ** attempt, 15_000)')
    expect(drill).toContain('const delay = Math.min(1_000 * 2 ** this.attempt, 15_000)')
    expect(room.match(/refetchDraft\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(drill).toContain('void this.refetch() // §9.3: reconcile on every confirmed join')
    expect(drill).toContain('void this.refetch() // the reconnect doctrine: refetch FIRST')
  })
})
