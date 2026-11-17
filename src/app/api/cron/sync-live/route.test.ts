/**
 * GET /api/cron/sync-live — auth, the `?sweep=` contract and the cadence pins
 * (L.D2.3, F216; migration 224 — one round per invocation, the database
 * wakes it every 30 s in a game window and once a day at 11:00Z).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createTypedAdminClient: () => {
    throw new Error('the admin client must never be built before the secret check')
  },
}))

import { FINAL_WEEK_REPOLL_UTC_HOUR, LIVE_WAKE_SECONDS, parseSweepMode, POLL_LEAD_MS, STUCK_GAME_CAP_MS, SYNC_LIVE_LEASE_SECONDS } from '@/lib/sync/live-poll'

import { GET, maxDuration } from './route'

const MIGRATION_224 = readFileSync(join(process.cwd(), 'supabase/migrations/224_wake_vercel_only_for_games.sql'), 'utf8')

describe('GET /api/cron/sync-live', () => {
  it('refuses without a secret and with the wrong one (401), before any client is built', async () => {
    const prior = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'right'
    try {
      expect((await GET(new Request('http://x/api/cron/sync-live'))).status).toBe(401)
      expect((await GET(new Request('http://x/api/cron/sync-live', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401)
      delete process.env.CRON_SECRET
      expect((await GET(new Request('http://x/api/cron/sync-live', { headers: { authorization: 'Bearer right' } }))).status).toBe(401)
    } finally {
      if (prior === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = prior
    }
  })

  it('an unknown `sweep` value is refused (400) before any client is built — never guessed into a mode', async () => {
    const prior = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'right'
    try {
      const res = await GET(new Request('http://x/api/cron/sync-live?sweep=weekly', { headers: { authorization: 'Bearer right' } }))
      expect(res.status).toBe(400)
    } finally {
      if (prior === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = prior
    }
  })

  it('`?sweep=` → the plan mode: absent is the pre-224 hourly fallback; daily / none as named; anything else null', () => {
    expect([parseSweepMode(null), parseSweepMode('daily'), parseSweepMode('none')]).toEqual(['hourly', 'daily', 'none'])
    expect([parseSweepMode(''), parseSweepMode('hourly'), parseSweepMode('DAILY')]).toEqual([null, null, null])
  })

  it('224 wakes this route with exactly the parameters the route reads, every 30 s in a window and once a day at the re-poll hour', () => {
    expect(LIVE_WAKE_SECONDS).toBe(30) // Chris 2026-11-14: "how about every 30 seconds during games" (§23.2's 20–30 s)
    expect(MIGRATION_224).toContain(`'sync-live-ping', '${LIVE_WAKE_SECONDS} seconds'`)
    expect(MIGRATION_224).toContain(`'score-week-ping', '${LIVE_WAKE_SECONDS} seconds'`)
    expect(MIGRATION_224).toContain(`'sync-live-sweep', '0 ${FINAL_WEEK_REPOLL_UTC_HOUR} * * *'`)
    expect(MIGRATION_224).toContain(`'/api/cron/sync-live?sweep=none'`)
    expect(MIGRATION_224).toContain(`'/api/cron/sync-live?sweep=daily'`)
    // The window's lead is the plan's lead (the SQL restates it; the stack test pins the two agree row by row).
    expect(MIGRATION_224).toContain(`interval '${POLL_LEAD_MS / 60_000} minutes'`)
    // …and so is the stuck-game cap (R1822).
    expect(MIGRATION_224).toContain(`g.kickoff_at >= p_now - interval '${STUCK_GAME_CAP_MS / 3_600_000} hours'`)
  })

  it('one round per invocation under a 60 s hard timeout (the daily sweep reads several weeks); the round lease lapses with it (R1823)', () => {
    expect(maxDuration).toBe(60)
    expect(SYNC_LIVE_LEASE_SECONDS).toBe(maxDuration)
  })
})
