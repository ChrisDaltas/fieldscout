/**
 * `liveScoringDelay` — which of §23.2's reasons raises the "Live stats
 * delayed" banner, which instant it names, and which reason it is (migration
 * 122's `stats_degraded` + migration 124's `scoring_stalled`; PROGRESS Q43).
 *
 * The cells that matter are the NEGATIVE ones: a banner that is on when
 * nothing is wrong gets ignored, and an ignored banner is the failure this
 * whole change exists to end. The load-bearing POSITIVE is the both-pings-
 * dead cell: `rows: 0` with the flag raised, the shape that read as healthy
 * before 124 grew its ingestion arm.
 *
 * This helper is CLOCKLESS on purpose — see its docblock, and the two render
 * suites that pin "no clock in the view, the ops or the hooks".
 */
import { describe, expect, it } from 'vitest'

import type { LiveScoringFlags } from '@/lib/sync/ingest-flags'

import { liveScoringDelay } from './use-stats-degraded'

const OK: LiveScoringFlags = {
  degraded: false,
  consecutive_failures: 0,
  last_failure_at: null,
  last_success_at: '2099-09-13T18:00:00Z',
  last_error: null,
  provider: 'sleeper+nflverse',
  stall: {
    stalled: false,
    reasons: [],
    rows: 0,
    oldest_enqueued_at: null,
    threshold_minutes: 10,
    ingest_stale: false,
    last_ingest_at: '2099-09-13T18:04:00Z',
    ingest_threshold_minutes: 120,
    checked_at: '2099-09-13T18:05:00Z',
  },
}

describe('liveScoringDelay (122 + 124)', () => {
  it('healthy: no banner, no instant, no reason', () => {
    expect(liveScoringDelay(OK)).toEqual({ delayed: false, since: null, reason: null })
  })

  it('the flag has not loaded yet: no banner — "we could not read whether the scores are behind" is not "they are behind"', () => {
    expect(liveScoringDelay(undefined)).toEqual({ delayed: false, since: null, reason: null })
  })

  it('the PROVIDER stopped answering: the banner names the last successful poll', () => {
    expect(liveScoringDelay({ ...OK, degraded: true })).toEqual({ delayed: true, since: '2099-09-13T18:00:00Z', reason: 'provider' })
  })

  it('the DRAIN stopped running with the provider healthy: the banner names the oldest UNDRAINED queue row (the 2026-09-10 stall — until 124 nothing said this)', () => {
    const stalled = { ...OK, stall: { ...OK.stall, stalled: true, reasons: ['queue_undrained'], rows: 24, oldest_enqueued_at: '2026-09-10T08:50:35Z' } }
    expect(liveScoringDelay(stalled)).toEqual({ delayed: true, since: '2026-09-10T08:50:35Z', reason: 'drain' })
  })

  it('BOTH PINGS DEAD: ingestion stopped, so the queue is EMPTY rather than backed up — the banner still raises, on `ingest_stale`, and names the last ingestion', () => {
    const dark = {
      ...OK,
      stall: { ...OK.stall, stalled: true, reasons: ['ingest_stale'], rows: 0, oldest_enqueued_at: null, ingest_stale: true, last_ingest_at: '2099-09-13T09:00:00Z' },
    }
    // `rows: 0` — the shape that read as HEALTHY before this arm existed.
    expect(liveScoringDelay(dark)).toEqual({ delayed: true, since: '2099-09-13T09:00:00Z', reason: 'ingest' })
  })

  it('both arms at once: the QUEUE wins the reason and the instant — the oldest undrained row is the older, more specific number', () => {
    const both = { ...OK, stall: { ...OK.stall, stalled: true, reasons: ['queue_undrained', 'ingest_stale'], rows: 3, oldest_enqueued_at: '2099-09-13T09:30:00Z', ingest_stale: true, last_ingest_at: '2099-09-13T09:31:00Z' } }
    expect(liveScoringDelay(both)).toEqual({ delayed: true, since: '2099-09-13T09:30:00Z', reason: 'drain' })
  })

  it('provider AND stall: the provider wins the instant — its last success cannot be newer than the row that poll enqueued', () => {
    const both = { ...OK, degraded: true, stall: { ...OK.stall, stalled: true, reasons: ['queue_undrained'], rows: 3, oldest_enqueued_at: '2099-09-13T18:02:00Z' } }
    expect(liveScoringDelay(both)).toEqual({ delayed: true, since: '2099-09-13T18:00:00Z', reason: 'provider' })
  })

  it('a stall flag that is present but NOT raised is silent — a written flag is not an alarm', () => {
    expect(liveScoringDelay({ ...OK, stall: { ...OK.stall, rows: 0 } }).delayed).toBe(false)
  })

})
