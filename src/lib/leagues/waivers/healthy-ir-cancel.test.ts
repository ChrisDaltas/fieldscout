/**
 * healthy-ir-cancel.test.ts — the syncs' call to migration 205's
 * `waiver_claims_cancel_healthy_ir` door (PROGRESS D593 / F693): the injected
 * instant is what it sends; its counts are asserted, never trusted; the door
 * missing (205 not pushed — PGRST202 naming it) is a named warning, never a
 * failure or a quiet zero; any other error is a failure, named. The door's
 * own behaviour is pgTAP 155 §W. Pure — the client is a fake.
 */
import { describe, expect, it, vi } from 'vitest'

import type { SyncClient } from '@/lib/sync/types'

import { cancelHealthyIrClaims, HEALTHY_IR_CANCEL_DOOR, HEALTHY_IR_CANCEL_NOT_DEPLOYED, isDoorMissing } from './healthy-ir-cancel'

const AT = '2026-10-18T15:10:00.000Z'
const clock = { now: () => new Date(AT) }

function fakeDb(answer: { data: unknown; error: { code?: string; message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(answer)
  return { db: { rpc } as unknown as SyncClient, rpc }
}

const LEAGUE = { league_id: 'lg-1', week: 6, source: 'injury_sync', teams: 1, cancelled: 2, notified: 1, by_team: [], evaluated_at: AT }

describe('cancelHealthyIrClaims — F693 as ruled: "if the player is no longer IR eligible the claims are cancelled"', () => {
  it('calls the door with the injected instant, and reads its counts and leagues', async () => {
    const { db, rpc } = fakeDb({ data: { at: AT, paused: false, leagues_checked: 3, cancelled: 2, notified: 1, leagues: [LEAGUE], skipped: [], why: null }, error: null })
    const r = await cancelHealthyIrClaims(db, clock)
    expect(rpc).toHaveBeenCalledWith(HEALTHY_IR_CANCEL_DOOR, { p_now: AT })
    expect(r).toEqual({
      ok: true,
      deployed: true,
      paused: false,
      leaguesChecked: 3,
      cancelled: 2,
      notified: 1,
      leagues: [{ league_id: 'lg-1', teams: 1, cancelled: 2, notified: 1 }],
      skipped: [],
      why: null,
      warnings: [],
      failures: [],
    })
  })

  it('a zero is said with the door’s own why — never an unexplained zero', async () => {
    const { db } = fakeDb({
      data: { paused: false, leagues_checked: 2, cancelled: 0, notified: 0, leagues: [], skipped: [], why: 'none_blocked — no team with a pending claim has a player who isn’t IR-eligible in an IR spot' },
      error: null,
    })
    const r = await cancelHealthyIrClaims(db, clock)
    expect(r.ok).toBe(true)
    expect(r.cancelled).toBe(0)
    expect(r.why).toMatch(/^none_blocked — /)
  })

  it('counts that don’t add up are a FAILURE (asserted, not trusted)', async () => {
    const { db } = fakeDb({ data: { paused: false, leagues_checked: 1, cancelled: 5, notified: 1, leagues: [LEAGUE], skipped: [] }, error: null })
    const r = await cancelHealthyIrClaims(db, clock)
    expect(r.ok).toBe(false)
    expect(r.failures).toEqual([
      'healthy-IR claim cancel: the door reports 5 cancelled / 1 notified but its leagues add up to 2 / 1 — refusing to call that done',
    ])
  })

  it('an answer with no counts is a FAILURE, never read as zero', async () => {
    const { db } = fakeDb({ data: { paused: false }, error: null })
    const r = await cancelHealthyIrClaims(db, clock)
    expect(r.ok).toBe(false)
    expect(r.failures[0]).toMatch(/^healthy-IR claim cancel: the door's report has no counts/)
    const none = await cancelHealthyIrClaims(fakeDb({ data: null, error: null }).db, clock)
    expect(none.ok).toBe(false)
    expect(none.failures[0]).toMatch(/answered null — no report/)
  })

  it('the door not on the database yet (205 not pushed: PGRST202 naming it) is a named WARNING — deploy before push', async () => {
    const missing = { code: 'PGRST202', message: `Could not find the function public.${HEALTHY_IR_CANCEL_DOOR}(p_now) in the schema cache` }
    const r = await cancelHealthyIrClaims(fakeDb({ data: null, error: missing }).db, clock)
    expect(r).toMatchObject({ ok: true, deployed: false, cancelled: 0, failures: [], warnings: [HEALTHY_IR_CANCEL_NOT_DEPLOYED] })
    // Anchored on the door's name: another missing function is not "not pushed yet".
    expect(isDoorMissing({ code: 'PGRST202', message: 'Could not find the function public.something_else' })).toBe(false)
    expect(isDoorMissing(missing)).toBe(true)
  })

  it('any other error is a FAILURE, named', async () => {
    const r = await cancelHealthyIrClaims(fakeDb({ data: null, error: { code: '42501', message: 'permission denied' } }).db, clock)
    expect(r.ok).toBe(false)
    expect(r.failures).toEqual(['healthy-IR claim cancel: waiver_claims_cancel_healthy_ir failed — permission denied'])
  })

  it('a skipped league and the pause are warnings, by name', async () => {
    const skipped = { league_id: 'lg-2', why: 'no_week — the league has no week at this instant' }
    const r = await cancelHealthyIrClaims(
      fakeDb({ data: { paused: false, leagues_checked: 1, cancelled: 0, notified: 0, leagues: [], skipped: [skipped], why: 'none_blocked — …' }, error: null }).db,
      clock,
    )
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual(['healthy-IR claim cancel: league lg-2 skipped — no_week — the league has no week at this instant'])
    const paused = await cancelHealthyIrClaims(
      fakeDb({ data: { paused: true, leagues_checked: 0, cancelled: 0, notified: 0, leagues: [], skipped: [], why: 'paused_by_system_flag:waivers_paused — no claim was cancelled' }, error: null }).db,
      clock,
    )
    expect(paused).toMatchObject({ ok: true, paused: true, warnings: ['healthy-IR claim cancel: paused_by_system_flag:waivers_paused — no claim was cancelled'] })
  })
})
