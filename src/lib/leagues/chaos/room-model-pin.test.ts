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

  it("runs the room's watchdog with the room's numbers: a scheduled room asks every 5 s, a live one after 45 s of silence", () => {
    const ops = readFileSync(resolve(__dirname, '../../../hooks/use-draft-ops.ts'), 'utf8')
    expect(ops).toContain('export const ROOM_WATCHDOG_MS = 5_000')
    expect(ops).toContain('export const HEARTBEAT_SILENCE_MS = 45_000')
    expect(ops).toContain("if (status === 'scheduled') return true")
    expect(room).toContain('}, ROOM_WATCHDOG_MS)')
    expect(drill).toContain('const ROOM_WATCHDOG_MS = 5_000')
    expect(drill).toContain('const ROOM_HEARTBEAT_SILENCE_MS = 45_000')
    expect(drill).toContain("status === 'scheduled' || (status === 'live' && this.lastBeatAtMs !== null && now - this.lastBeatAtMs > ROOM_HEARTBEAT_SILENCE_MS)")
  })

  it('refetches on every confirmed join and first on every failure, then reopens with the same backoff', () => {
    expect(room).toContain('const delay = Math.min(1_000 * 2 ** attempt, 15_000)')
    expect(drill).toContain('const delay = Math.min(1_000 * 2 ** this.attempt, 15_000)')
    expect(room.match(/refetchDraft\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(drill).toContain('void this.refetch() // §9.3: reconcile on every confirmed join')
    expect(drill).toContain('void this.refetch() // the reconnect doctrine: refetch FIRST')
  })
})
