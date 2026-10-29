/**
 * faults.test.ts — the chaos injectors themselves (M7 L.F2.3, PROGRESS
 * D760): a drill is only as honest as its fault, so each injector is pinned
 * to do exactly what its drill claims it does.
 */
import { describe, expect, it } from 'vitest'

import type { ProviderPlayerWeekStats } from '@/lib/leagues/stats/stats-provider'

import { applyRowFaults, crashingClient, DEAD_REALTIME_URL, FaultyProvider, ProviderPollFailure, realtimeKillSwitch, ScriptedProvider, WorkerCrash } from './faults'

const row = (playerId: string, rush_yards: number): ProviderPlayerWeekStats => ({ playerId, season: 2072, week: 1, stats: { rush_yards }, advanced: {} })

describe('applyRowFaults', () => {
  const lines = [row('a', 10), row('b', 20), row('c', 30)]

  it('no faults: the answer unchanged (copies, never the same objects)', () => {
    const out = applyRowFaults(lines, {})
    expect(out).toEqual(lines)
    expect(out[0]).not.toBe(lines[0])
  })

  it('duplicate: N identical copies of a player\'s row, in place', () => {
    const out = applyRowFaults(lines, { duplicate: new Map([['b', 3]]) })
    expect(out.map((l) => l.playerId)).toEqual(['a', 'b', 'b', 'b', 'c'])
    expect(out.filter((l) => l.playerId === 'b').every((l) => l.stats.rush_yards === 20)).toBe(true)
  })

  it('withhold: the row is not in the answer at all (a late row)', () => {
    expect(applyRowFaults(lines, { withhold: new Set(['a', 'c']) }).map((l) => l.playerId)).toEqual(['b'])
  })

  it('stale: the stale row is served INSTEAD of the current one', () => {
    expect(applyRowFaults(lines, { stale: new Map([['c', row('c', 5)]]) }).map((l) => l.stats.rush_yards)).toEqual([10, 20, 5])
  })

  it('conflicting: the row, then a SECOND row for the same player with other numbers', () => {
    const out = applyRowFaults(lines, { conflicting: new Map([['a', { rush_yards: 11 }]]) })
    expect(out.map((l) => `${l.playerId}:${l.stats.rush_yards}`)).toEqual(['a:10', 'a:11', 'b:20', 'c:30'])
  })
})

describe('FaultyProvider', () => {
  it('fails exactly failPolls polls at getSchedule, then answers again', async () => {
    const base = new ScriptedProvider('synthetic:test')
    base.lines = [row('a', 1)]
    const p = new FaultyProvider(base)
    p.faults = { failPolls: 2 }
    await expect(p.getSchedule(2072)).rejects.toBeInstanceOf(ProviderPollFailure)
    await expect(p.getSchedule(2072)).rejects.toBeInstanceOf(ProviderPollFailure)
    await expect(p.getSchedule(2072)).resolves.toEqual([])
    expect(p.failed).toBe(2)
    expect(p.name).toBe('synthetic:test')
    expect(await p.getWeekStats(2072, 1)).toEqual([row('a', 1)])
  })
})

describe('crashingClient', () => {
  function fakeClient() {
    const sent: string[] = []
    return {
      sent,
      client: {
        label: 'real',
        rpc(fn: string) {
          sent.push(fn)
          return Promise.resolve({ data: `${fn}-ok`, error: null })
        },
        from(this: { label: string }, table: string) {
          return `${this.label}:${table}`
        },
      },
    }
  }

  it('`before`: the planned call never reaches the client; other calls pass through', async () => {
    const f = fakeClient()
    const { client, log } = crashingClient(f.client, [{ rpc: 'door', mode: 'before', on: (n) => n === 2 }])
    await expect(client.rpc('door')).resolves.toEqual({ data: 'door-ok', error: null })
    await expect(client.rpc('door')).rejects.toBeInstanceOf(WorkerCrash)
    await expect(client.rpc('other')).resolves.toEqual({ data: 'other-ok', error: null })
    expect(f.sent).toEqual(['door', 'other'])
    expect(log.crashes).toEqual(['door #2 before'])
    expect(log.calls.get('door')).toBe(2)
  })

  it('`after`: the planned call IS sent, then the caller sees a crash instead of the answer', async () => {
    const f = fakeClient()
    const { client, log } = crashingClient(f.client, [{ rpc: 'ack', mode: 'after', on: () => true }])
    await expect(client.rpc('ack')).rejects.toThrow(/after sending ack/)
    expect(f.sent).toEqual(['ack'])
    expect(log.crashes).toEqual(['ack #1 after'])
  })

  it('every non-rpc member is the real client\'s, bound to it', () => {
    const { client } = crashingClient(fakeClient().client, [])
    expect(client.from('players')).toBe('real:players')
  })
})

describe('realtimeKillSwitch', () => {
  it('while killed, a new socket is sent to the dead port and counted; restore lets the next one through', () => {
    const k = realtimeKillSwitch()
    k.kill()
    expect(k.dead).toBe(true)
    const s = new k.transport('ws://127.0.0.1:54321/realtime/v1/websocket')
    s.addEventListener('error', () => {})
    expect(s.url).toBe(DEAD_REALTIME_URL)
    expect([k.refused, k.opened, k.dropped]).toEqual([1, 0, 0])
    s.close()
    k.restore()
    expect(k.dead).toBe(false)
  })
})
