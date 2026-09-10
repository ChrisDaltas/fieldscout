/**
 * ingest-flags-db.test.ts — F217's persisted surface over the REAL stack
 * (L.D2.3; migration 122's `system_flags`; spec §23.2 / E45; PROGRESS
 * D322, F217 ✅, F263(e) — the worker's last-poll seam bound).
 *
 * Pinned here:
 *   1. THE COUNT SURVIVES THE PROCESS: three failed polls, each on a tracker
 *      freshly LOADED from the table (a serverless invocation per poll),
 *      reach `consecutive_failures = 3` and raise `degraded` on exactly the
 *      third (§23.2); the first success clears both and stamps the week's
 *      `ingest_poll` key with the poll's OWN instant (`polledAt`, never a
 *      wall-clock read).
 *   2. A FAILED poll never writes the `ingest_poll` key (no successful
 *      completion ⇒ no orphan escape — the safe direction).
 *   3. THE SEAM: `lastPollCompletedAtReader(db)` returns the stamp for a
 *      polled week and null for an unpolled one — the worker's
 *      `deps.lastPollCompletedAt` contract (D321(1)).
 *   4. RLS (122): an ANON client reads the flag (the banner's read) and
 *      cannot write it — an INSERT is refused (42501), an UPDATE matches 0
 *      rows through PostgREST (RETURNING-count discipline, §4.2).
 *
 * Every instant is a 2099 literal (F226); requires the local stack
 * (001–122) — D59(5); FAILS loudly when the stack is down, never skips.
 * Fixture hygiene (F199): the keys this suite writes are deleted before
 * and after (`stats_degraded` is the global key — the local stack carries
 * no production flag; `ingest_poll:2099:*`).
 */
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { DegradationTracker } from '@/lib/leagues/stats/degradation'
import { SYNTHETIC_SEASON } from '@/lib/leagues/sim/synthetic-season'

import {
  ingestPollKey,
  lastPollCompletedAtReader,
  loadDegradationTracker,
  persistPollOutcome,
  readLastPollCompletedAt,
  readLiveScoringFlags,
  readStatsDegraded,
  STATS_DEGRADED_KEY,
} from './ingest-flags'
import type { IngestReport } from './ingest-week'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
const SEASON = SYNTHETIC_SEASON

function report(week: number, polledAt: string, ok: boolean, degraded: boolean): IngestReport {
  return {
    provider: 'synthetic',
    season: SEASON,
    week,
    polledAt,
    ok,
    degraded,
    error: ok ? undefined : 'synthetic outage',
    games: { seen: 0, withoutKickoff: 0, inserted: 0, updated: 0, unchanged: 0 },
    weeks: { touched: 0, updated: 0, unchanged: 0, outsideCalendar: 0 },
    stats: { seen: 0, unknownPlayer: 0, empty: 0, droppedAdvancedKeys: 0, inserted: 0, updated: 0, metaOnly: 0, unchanged: 0, deltas: 0, enqueued: 0, restamped: 0 },
    reasons: [],
  }
}

async function cleanup(): Promise<void> {
  const { error } = await service.from('system_flags').delete().or(`key.eq.${STATS_DEGRADED_KEY},key.like.ingest_poll:${SEASON}:%`)
  if (error) throw new Error(`cleanup: ${error.message}`)
}

beforeAll(cleanup)
afterAll(cleanup)

describe('system_flags — the persisted ingestion flags (122, F217)', () => {
  it('a fresh table reads as the empty flag; the seam reads null', async () => {
    expect(await readStatsDegraded(service)).toEqual({ degraded: false, consecutive_failures: 0, last_failure_at: null, last_success_at: null, last_error: null, provider: null })
    expect(await readLastPollCompletedAt(service, SEASON, 1)).toBeNull()
    expect((await loadDegradationTracker(service)).consecutiveFailures).toBe(0)
  })

  it('three failed polls on three FRESHLY LOADED trackers raise the flag on exactly the third; a failed poll never stamps the week', async () => {
    const stamps = ['2099-09-13T18:00:00.000Z', '2099-09-13T18:00:20.000Z', '2099-09-13T18:00:40.000Z']
    for (let i = 0; i < 3; i++) {
      const tracker = await loadDegradationTracker(service) // a new process per poll
      expect(tracker.consecutiveFailures).toBe(i)
      tracker.recordPollResult(false)
      const flag = await persistPollOutcome(service, tracker, report(1, stamps[i], false, tracker.degraded))
      expect(flag).toMatchObject({ consecutive_failures: i + 1, degraded: i + 1 >= 3, last_failure_at: stamps[i], last_error: 'synthetic outage', provider: 'synthetic', last_success_at: null })
      expect(await readStatsDegraded(service)).toEqual(flag)
      expect(await readLastPollCompletedAt(service, SEASON, 1)).toBeNull() // no successful completion, no escape
    }
    const row = await service.from('system_flags').select('updated_at').eq('key', STATS_DEGRADED_KEY).single()
    expect(new Date(row.data!.updated_at).toISOString()).toBe(stamps[2]) // the poll's instant, never the wall
  })

  it('the first success clears the count and the flag, keeps the last failure on the record, and stamps the week with the poll’s OWN instant', async () => {
    const tracker = await loadDegradationTracker(service)
    expect(tracker.degraded).toBe(true)
    tracker.recordPollResult(true)
    const flag = await persistPollOutcome(service, tracker, report(1, '2099-09-13T18:01:00.000Z', true, false))
    expect(flag).toEqual({
      degraded: false,
      consecutive_failures: 0,
      last_failure_at: '2099-09-13T18:00:40.000Z',
      last_success_at: '2099-09-13T18:01:00.000Z',
      last_error: null,
      provider: 'synthetic',
    })
    expect(await readLastPollCompletedAt(service, SEASON, 1)).toBe('2099-09-13T18:01:00.000Z')
    const key = await service.from('system_flags').select('value, updated_at').eq('key', ingestPollKey(SEASON, 1)).single()
    expect(key.data!.value).toEqual({ completed_at: '2099-09-13T18:01:00.000Z', provider: 'synthetic' })
    expect(new Date(key.data!.updated_at).toISOString()).toBe('2099-09-13T18:01:00.000Z')
    // 124 ARM 2 RESTS ON THIS EQUALITY. `scoring_stall_check` reads
    // `max(updated_at)` over the `ingest_poll:%` keys — the COLUMN, so a
    // malformed value can never raise inside a cron job — and calls it the
    // last successful ingestion. That is only honest while the two are the
    // same instant. A change that lets them drift reds HERE, by name,
    // instead of silently widening the window in which a dead scheduler
    // reads as healthy.
    expect(new Date(key.data!.updated_at).toISOString()).toBe((key.data!.value as { completed_at: string }).completed_at)
  })

  it('the worker’s seam, bound: a polled week answers its stamp, an unpolled week null; a later poll moves the stamp forward', async () => {
    const seam = lastPollCompletedAtReader(service)
    expect(await seam(SEASON, 1)).toBe('2099-09-13T18:01:00.000Z')
    expect(await seam(SEASON, 2)).toBeNull()
    await persistPollOutcome(service, new DegradationTracker(), report(1, '2099-09-13T18:01:20.000Z', true, false))
    expect(await seam(SEASON, 1)).toBe('2099-09-13T18:01:20.000Z')
  })

  it('the banner’s ONE round trip reads BOTH keys: `readLiveScoringFlags` agrees with `readStatsDegraded` on the provider half and carries 124’s stall half (never the wrong key’s value)', async () => {
    const [degraded, both] = await Promise.all([readStatsDegraded(service), readLiveScoringFlags(service)])
    const { stall, ...providerHalf } = both
    // The `.in()` query must map each row to its own key — the failure this
    // pins is a two-key read that hands one key's value to the other field.
    expect(providerHalf).toEqual(degraded)
    // `scoring_stalled` is written IN THE DATABASE by the per-minute
    // `scoring-stall-check` job, so its VALUES are not this suite's to assert
    // (that is pgTAP 072 §E's job, deterministically). What is asserted here
    // is that the reader produces the parsed shape either way — a missing row
    // reads as the empty stall, never as undefined.
    expect(typeof stall.stalled).toBe('boolean')
    expect(stall).toHaveProperty('oldest_enqueued_at')
    expect(stall).toHaveProperty('checked_at')
    // Both of 124's arms reach the client, or the banner can only ever
    // report the half that has queue rows to age.
    expect(typeof stall.ingest_stale).toBe('boolean')
    expect(Array.isArray(stall.reasons)).toBe(true)
    expect(stall).toHaveProperty('last_ingest_at')
  })

  it('RLS: ANON reads the flag (the banner) and cannot write it — INSERT refused (42501), UPDATE matches 0 rows', async () => {
    const read = await anon.from('system_flags').select('key, value').eq('key', STATS_DEGRADED_KEY).single()
    expect(read.error).toBeNull()
    expect(read.data!.value).toMatchObject({ degraded: false, consecutive_failures: 0 })

    const insert = await anon.from('system_flags').insert({ key: `ingest_poll:${SEASON}:99`, value: {} }).select('key')
    expect(insert.error?.code).toBe('42501')

    const update = await anon.from('system_flags').update({ value: { degraded: true } }).eq('key', STATS_DEGRADED_KEY).select('key')
    expect(update.error).toBeNull()
    expect(update.data).toEqual([]) // RETURNING 0 rows — the row is untouched
    expect((await readStatsDegraded(service)).degraded).toBe(false)

    const del = await anon.from('system_flags').delete().eq('key', STATS_DEGRADED_KEY).select('key')
    expect(del.data).toEqual([])
    expect((await service.from('system_flags').select('key').eq('key', STATS_DEGRADED_KEY)).data).toHaveLength(1)
  })
})
