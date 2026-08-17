/**
 * auction-start-db.test.ts — L.C1.2 item 4 at the WIRE layer: an AUCTION
 * league scheduled through the real settings surface auto-starts on the
 * `draft_tick` D94 arm and comes up in the §8.6 nominating shape, with the
 * migration-084 budget derivation reading its goldens over PostgREST.
 *
 * WHY THIS SUITE EXISTS (the D94 no-dead-end pin, auction edition): 068's
 * auto-start arm was written for snake and calls
 * `draft_start_internal(league, FALSE)` — the same internal 084 replaced.
 * 084 changed no line of 068, so the ONLY honest proof that an auction can
 * still reach the board without a human pressing Start is to schedule one
 * in the past and let the tick have it. pgTAP 033 owns the exhaustive
 * derivation/nomination-order/solvency matrix against the engine; pgTAP
 * 020 owns the commissioner-wrapper start; this file owns the arm nobody
 * else exercises for auctions.
 *
 * THE PAST INSTANT IS DELIBERATE (and is exactly what F49 warns about):
 * `DRAFT_INSTANT` is in the past so the D94 scan claims the league. That
 * is safe HERE and nowhere else, because the fixture is created and
 * destroyed inside this suite — nothing committed to the repo carries it.
 * The live 5s pg_cron job is a LEGAL concurrent actor on it: it performs
 * the same deterministic start the explicit `draft_tick()` call performs,
 * so every assertion below is on CONVERGED state, never on which caller
 * ticked (the draft-tick-db.test.ts precedent).
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 *
 * Determinism: FIXED emails/usernames/action_ids/league name + cleanup
 * first and last. No wall-clock read anywhere (the D3/D17 ESLint guard
 * covers this path).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { patchLeague } from './leagues-service'
import { addPlaceholderSeat } from './members-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-auction-start-league'
/** PAST on purpose — this suite's subject IS the D94 auto-start arm. See
 *  the docblock: never copy this into a committed snake fixture (F49). */
const DRAFT_INSTANT = '2020-09-01T17:00:00+00:00'
const TEAM_COUNT = 8
/** §7.3.8 auction block for this league — every value differs from a
 *  default that could mask a bug: a 45s nomination clock (default 30) and
 *  an UNTIMED pick timer (0), which must not null the auction clock. */
const AUCTION_BUDGET = 200
const AUCTION_MIN_BID = 1
const NOMINATION_SECONDS = 45
/** D91 draftable slots for the default roster (9 starters + 6 bench; IR
 *  excluded) — the auction's per-team roster capacity (D126). */
const OPEN_SLOTS = 15
/** §8.6.1: max_bid = remaining − (open_slots − 1) × min_bid. */
const MAX_BID = AUCTION_BUDGET - (OPEN_SLOTS - 1) * AUCTION_MIN_BID // 186

const COMMISH = {
  email: 'auction-start-commish@fieldscout.test',
  password: 'pgtap-auction-pass-1',
  username: 'as_wire_commish',
}
const ACTION = { create: 'ae000000-0000-4000-8000-000000000001' } as const

type DraftRow = Database['public']['Tables']['drafts']['Row']
interface TeamBudgetRow {
  remaining: number
  open_slots: number
  max_bid: number
  committed: number
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let leagueId: string
/** [commissioner's own team, ...7 placeholders] — the manual draft order,
 *  which `nomination_order_mode: same_as_draft_order` copies. */
let orderedTeamIds: string[]

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').eq('name', LEAGUE_NAME)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    await service.from('drafts').delete().in('league_id', ids)
    await service.from('teams').delete().in('league_id', ids)
    await service.from('leagues').delete().in('id', ids)
  }
  await deleteUserByUsername(COMMISH.username)
}

/** Poll the drafts row until the tick has started it (bounded, loud on
 *  timeout — never a silent skip). Each pass drives `draft_tick()` itself
 *  rather than waiting on the 5s cron. */
async function tickUntilLive(): Promise<DraftRow> {
  let last: DraftRow | null = null
  for (let attempt = 0; attempt < 10; attempt++) {
    const { error: tickError } = await service.rpc('draft_tick')
    if (tickError) throw new Error(`draft_tick failed: ${tickError.message}`)
    const { data, error } = await service
      .from('drafts')
      .select('*')
      .eq('league_id', leagueId)
      .eq('is_mock', false)
      .maybeSingle()
    if (error) throw new Error(`drafts read failed: ${error.message}`)
    last = data
    if (data?.status === 'live') return data
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    `the D94 auto-start arm never started the auction — last drafts row: ${JSON.stringify(last)}`,
  )
}

beforeAll(async () => {
  await cleanup()
  const { data: created, error: userError } = await service.auth.admin.createUser({
    email: COMMISH.email,
    password: COMMISH.password,
    email_confirm: true,
    user_metadata: { username: COMMISH.username },
  })
  if (userError) throw new Error(`createUser failed: ${userError.message}`)
  void created

  commishClient = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error: signInError } = await commishClient.auth.signInWithPassword({
    email: COMMISH.email,
    password: COMMISH.password,
  })
  if (signInError) throw new Error(`sign-in failed: ${signInError.message}`)

  const settings = defaultsForTeamCount(TEAM_COUNT)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [`p_${key}`, value]),
  )
  const { data: template } = await commishClient
    .from('scoring_systems')
    .select('id')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  const { data: league, error: createError } = await commishClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: 2026,
    p_scoring_system_id: template?.id,
    p_team_name: 'Auction Commish Team',
    p_action_id: ACTION.create,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (league as { league_id: string }).league_id

  const placeholderIds: string[] = []
  for (let i = 0; i < TEAM_COUNT - 1; i++) {
    const fill = await addPlaceholderSeat(commishClient, leagueId, {})
    if (fill.status !== 201) throw new Error(`placeholder fill failed: ${JSON.stringify(fill.body)}`)
    placeholderIds.push((fill.body as { team_id: string }).team_id)
  }
  const { data: commishMember, error: memberError } = await service
    .from('league_members')
    .select('team_id')
    .eq('league_id', leagueId)
    .eq('role', 'commissioner')
    .single()
  if (memberError || !commishMember?.team_id) {
    throw new Error(`commissioner team lookup failed: ${memberError?.message}`)
  }
  orderedTeamIds = [commishMember.team_id, ...placeholderIds]

  // The whole §7.3.8 auction block through the REAL settings surface —
  // the validated path a commissioner uses (its solvency floor, 16 × 1
  // ≤ 200, passes; migration 084's engine-side backstop is 033's).
  const configured = await patchLeague(commishClient, leagueId, {
    settings: {
      draft: {
        draft_type: 'auction',
        draft_order_mode: 'manual',
        draft_order: orderedTeamIds,
        nomination_order_mode: 'same_as_draft_order',
        auction_budget: AUCTION_BUDGET,
        auction_min_bid: AUCTION_MIN_BID,
        auction_nomination_seconds: NOMINATION_SECONDS,
        pick_timer_seconds: 0,
        draft_scheduled_at: DRAFT_INSTANT,
      },
    },
  })
  if (configured.status !== 200) {
    throw new Error(`auction configure PATCH failed: ${JSON.stringify(configured.body)}`)
  }
  const scheduled = await patchLeague(commishClient, leagueId, { status: 'scheduled' })
  if (scheduled.status !== 200) {
    throw new Error(`scheduled PATCH failed: ${JSON.stringify(scheduled.body)}`)
  }
}, 120_000)

afterAll(async () => {
  await cleanup()
})

describe('auction start over the wire (migration 084)', () => {
  it('D94, auction edition: a scheduled auction auto-starts on the tick into the nominating shape', async () => {
    const draft = await tickUntilLive()

    expect(draft.draft_type).toBe('auction')
    expect(draft.status).toBe('live')
    // D91/D126: total_rounds is the per-team roster capacity, not a count
    // of rounds anyone will play.
    expect(draft.total_rounds).toBe(OPEN_SLOTS)
    // D126's phase rule: NULL current_nomination ⇒ NOMINATING.
    expect(draft.current_nomination).toBeNull()
    expect(draft.current_pick_number).toBe(1)
    // same_as_draft_order copies the manual order; the head nominates.
    expect(draft.nomination_order).toEqual(orderedTeamIds)
    expect(draft.on_clock_team_id).toBe(orderedTeamIds[0])
    // §7.3.8: pick_timer_seconds = 0 is the SNAKE soft-timer option — an
    // auction still gets its nomination clock, or the tick would have no
    // deadline to enforce and the board would sit forever.
    expect(draft.current_deadline).not.toBeNull()

    const { data: leagueRow, error: leagueError } = await service
      .from('leagues')
      .select('status, scoring_rules_snapshot')
      .eq('id', leagueId)
      .single()
    if (leagueError) throw new Error(`league read failed: ${leagueError.message}`)
    expect(leagueRow.status).toBe('drafting')
    // D43/D64(2): the snapshot is taken BEFORE the transition on the
    // auction arm too.
    expect(leagueRow.scoring_rules_snapshot).not.toBeNull()
  }, 60_000)

  it('the budget derivation reads §8.6.1 goldens for every seated franchise', async () => {
    const { data: draft, error: draftError } = await service
      .from('drafts')
      .select('id')
      .eq('league_id', leagueId)
      .eq('is_mock', false)
      .single()
    if (draftError) throw new Error(`drafts read failed: ${draftError.message}`)

    for (const teamId of orderedTeamIds) {
      const { data, error } = await service.rpc('draft_team_budget', {
        p_draft_id: draft.id,
        p_team_id: teamId,
      })
      if (error) throw new Error(`draft_team_budget(${teamId}) failed: ${error.message}`)
      const rows = data as unknown as TeamBudgetRow[]
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        remaining: AUCTION_BUDGET,
        open_slots: OPEN_SLOTS,
        max_bid: MAX_BID, // 186 — the formula, not a copy of the budget
        committed: 0,
      })
    }

    const { data: solvent, error: solventError } = await service.rpc('draft_auction_solvent', {
      p_draft_id: draft.id,
    })
    if (solventError) throw new Error(`draft_auction_solvent failed: ${solventError.message}`)
    expect(solvent).toBe(true)
  }, 60_000)

  it('the derivation family is not reachable by a signed-in member (the triple REVOKE, over the wire)', async () => {
    const { data: draft, error: draftError } = await service
      .from('drafts')
      .select('id')
      .eq('league_id', leagueId)
      .eq('is_mock', false)
      .single()
    if (draftError) throw new Error(`drafts read failed: ${draftError.message}`)

    // The commissioner of THIS league — the most privileged human there
    // is — still cannot call the engine internals directly. Budgets reach
    // the room through the D134 broadcast payloads (L.C1.6) and the TS
    // display mirror (L.C2.1), never by RPC.
    const budget = await commishClient.rpc('draft_team_budget', {
      p_draft_id: draft.id,
      p_team_id: orderedTeamIds[0],
    })
    expect(budget.error).not.toBeNull()
    const solvent = await commishClient.rpc('draft_auction_solvent', { p_draft_id: draft.id })
    expect(solvent.error).not.toBeNull()
  }, 60_000)
})
