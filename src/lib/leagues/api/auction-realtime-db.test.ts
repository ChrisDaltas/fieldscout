/**
 * auction-realtime-db.test.ts — L.C1.6 item 5 at the WIRE layer: migration
 * 088's auction realtime against the LOCAL stack's real Realtime service
 * (spec §9.1/§9.2/§9.3; delivery plan §8.4; tasks-M3 §4 rule 5; D133/D134;
 * F69 — the void-event decision, heard on a real socket):
 *
 *   (a) a MEMBER supabase-js client subscribed to the PRIVATE `draft:<id>`
 *       channel hears a real nomination + a real raise (085's verbs, called
 *       by two signed-in managers over PostgREST) as TWO 'draft_bids'
 *       INSERT events carrying EXACTLY the 088 column set (nomination_seq,
 *       player_id, team_id, amount, created_at, voided_at — never action_id),
 *       and the accompanying 'drafts' event carrying current_nomination +
 *       budget_adjustments (the D134 pair — 10 keys);
 *   (b) a commissioner pause + cancel (087's D143 verb) reaches the SAME
 *       subscription as EXACTLY ONE 'draft_bids' UPDATE event — the
 *       per-statement VOID summary {voided_at, voided_count 2, nominations
 *       [{1, player}]} — and the accompanying 'drafts' event shows
 *       current_nomination NULL at the same seq (the phase truth rides
 *       beside the void);
 *   (c) a NON-MEMBER client gets nothing: the private-channel subscribe is
 *       REFUSED by the realtime.messages policies and zero events are
 *       delivered — while the member's channel receives in the same window
 *       (the positive control — F52's discipline: driven, not waited on).
 *
 * pgTAP 037 owns the exhaustive matrix (exact records, the bulk pin, the
 * undo's two statements, the column discriminator, channel auth per role).
 * This suite exists for the one thing pgTAP cannot show: that the events
 * DELIVER over the real Realtime service to a real JWT client with the
 * selected columns, and that the §9.3 ONE-channel posture carries the new
 * event (the client subscribes ONE topic for drafts + draft_picks +
 * draft_bids + tick).
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 *
 * Determinism: FIXED emails/usernames/action_ids/player-fixture ids +
 * cleanup first and last; the draft instant is FAR FUTURE (F49) and the
 * draft is started explicitly by the commissioner.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { claimInvite, createInvite } from './invites-service'
import { patchLeague } from './leagues-service'
import { addPlaceholderSeat } from './members-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-auction-rt-league'
/** F49: far future — this suite starts the draft itself. */
const DRAFT_INSTANT = '2028-09-02T17:00:00+00:00'
const TEAM_COUNT = 8

const COMMISH = {
  email: 'auction-rt-commish@fieldscout.test',
  password: 'pgtap-auction-rt-1',
  username: 'art_wire_commish',
}
const MGR2 = {
  email: 'auction-rt-mgr2@fieldscout.test',
  password: 'pgtap-auction-rt-2',
  username: 'art_wire_mgr_two',
}
const OUTSIDER = {
  email: 'auction-rt-outsider@fieldscout.test',
  password: 'pgtap-auction-rt-3',
  username: 'art_wire_outsider',
}

const PLAYERS = [
  { id: 'vitest-art-p1', full_name: 'Vitest ART Player One', position: 'RB' },
  { id: 'vitest-art-p2', full_name: 'Vitest ART Player Two', position: 'WR' },
] as const

const ACTION = {
  create: 'af100000-0000-4000-8000-000000000001',
  nominate: 'af100000-0000-4000-8000-000000000011',
  raise: 'af100000-0000-4000-8000-000000000012',
} as const

type BroadcastEnvelope = {
  operation?: string
  table?: string
  schema?: string
  record?: Record<string, unknown>
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let mgr2Client: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let leagueId: string
let draftId: string
let commishTeamId: string
let mgr2TeamId: string
const openChannels: RealtimeChannel[] = []

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
  await service
    .from('players')
    .delete()
    .in(
      'id',
      PLAYERS.map((p) => p.id),
    )
  for (const u of [COMMISH, MGR2, OUTSIDER]) {
    await deleteUserByUsername(u.username)
  }
}

async function createUser(user: { email: string; password: string; username: string }): Promise<void> {
  const { error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { data, error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  await client.realtime.setAuth(data.session?.access_token ?? null)
  return client
}

function subscribeAndWait(channel: RealtimeChannel, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMED_OUT'), timeoutMs)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        clearTimeout(timer)
        resolve(status)
      }
    })
  })
}

const POLL_MS = 200

/** Attempt-counted poll (no wall-clock read — harness only). */
async function waitFor<T>(probe: () => T | undefined, timeoutMs: number, label: string): Promise<T> {
  const attempts = Math.ceil(timeoutMs / POLL_MS)
  for (let i = 0; i < attempts; i++) {
    const value = probe()
    if (value !== undefined) return value
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  throw new Error(`timed out waiting for ${label}`)
}

beforeAll(async () => {
  await cleanup()
  // F215 / R724 / migration 110: starting a real draft pre-flights the §11.7
  // fit against the NFL calendar at now() — this suite creates its league on
  // a SYNTHETIC season so the start never depends on the wall clock.
  await seedSyntheticSeason(service)
  await createUser(COMMISH)
  await createUser(MGR2)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  mgr2Client = await signIn(MGR2)
  outsiderClient = await signIn(OUTSIDER)

  await service.from('players').upsert([...PLAYERS])

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
  const { data: created, error: createError } = await commishClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: SYNTHETIC_SEASON, // F215/R724: the fixture owns its calendar (migration 110 pre-flights every draft START against nfl_weeks)
    p_scoring_system_id: template?.id,
    p_team_name: 'Auction RT Commish',
    p_action_id: ACTION.create,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  // Seat mgr2 on a real franchise (placeholder → username invite → claim).
  const seat = await addPlaceholderSeat(commishClient, leagueId, { team_name: 'Seat for mgr2' })
  if (seat.status !== 201) throw new Error(`addPlaceholderSeat failed: ${JSON.stringify(seat.body)}`)
  mgr2TeamId = (seat.body as { team_id: string }).team_id
  const invite = await createInvite(commishClient, leagueId, {
    target_team_id: mgr2TeamId,
    invited_username: MGR2.username,
  })
  if (invite.status !== 201) throw new Error(`createInvite failed: ${JSON.stringify(invite.body)}`)
  const claim = await claimInvite(mgr2Client, { token: (invite.body as { token: string }).token })
  if (claim.status !== 200) throw new Error(`claimInvite failed: ${JSON.stringify(claim.body)}`)

  const placeholderIds: string[] = []
  for (let i = 0; i < TEAM_COUNT - 2; i++) {
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
  commishTeamId = commishMember.team_id

  const configured = await patchLeague(commishClient, leagueId, {
    settings: {
      draft: {
        draft_type: 'auction',
        draft_order_mode: 'manual',
        draft_order: [commishTeamId, mgr2TeamId, ...placeholderIds],
        nomination_order_mode: 'same_as_draft_order',
        auction_budget: 200,
        auction_zero_dollar_nominations: false, // 092/AP.1 (was auction_min_bid: 1 — same behaviour, derived)
        auction_nomination_seconds: 45,
        auction_bid_seconds: 30,
        auction_anti_snipe_seconds: 10,
        pick_timer_seconds: 90,
        draft_scheduled_at: DRAFT_INSTANT,
      },
    },
  })
  if (configured.status !== 200) {
    throw new Error(`auction configure PATCH failed: ${JSON.stringify(configured.body)}`)
  }
  const scheduled = await patchLeague(commishClient, leagueId, { status: 'scheduled' })
  if (scheduled.status !== 200) throw new Error(`scheduled PATCH failed: ${JSON.stringify(scheduled.body)}`)

  const { data: startData, error: startError } = await commishClient.rpc('draft_start', {
    p_league_id: leagueId,
  })
  if (startError) throw new Error(`draft_start failed: ${startError.message}`)
  const started = startData as unknown as { draft: { id: string; status: string } }
  draftId = started.draft.id
  if (started.draft.status !== 'live') throw new Error(`auction did not start live: ${JSON.stringify(started.draft)}`)

  // Realtime READINESS GATE (harness, not assertion — the draft-realtime-db
  // pattern): prove Broadcast-from-DB DELIVERY end to end on the league
  // topic before asserting anything on the draft topic. ON A DEDICATED
  // CLIENT, fully disconnected afterwards — NOT on commishClient's socket.
  // Measured while building this suite (2026-08-19): `removeChannel` of the
  // gate's last channel calls `disconnect()`, and a channel subscribed on
  // that same socket IMMEDIATELY after joins fine and is then torn down by
  // the in-flight transport close ~150ms later ('transport close' → channel
  // error → realtime-js reconnects with backoff, and every event emitted in
  // the gap is lost). The M2 suite shares that shape and has been winning
  // the race (its events are produced within the window) — ledger row F74.
  const gateClient = await signIn(COMMISH)
  let delivered = false
  for (let attempt = 0; attempt < 8 && !delivered; attempt++) {
    const readyEvents: unknown[] = []
    const probe = gateClient
      .channel(`league:${leagueId}`, { config: { private: true } })
      .on('broadcast', { event: 'leagues' }, (msg) => readyEvents.push(msg.payload))
    const status = await subscribeAndWait(probe, 10_000)
    if (status === 'SUBSCRIBED') {
      for (let fire = 0; fire < 5 && readyEvents.length === 0; fire++) {
        await service.from('leagues').update({ name: LEAGUE_NAME }).eq('id', leagueId)
        for (let poll = 0; poll < 15 && readyEvents.length === 0; poll++) {
          await new Promise((r) => setTimeout(r, POLL_MS))
        }
      }
      delivered = readyEvents.length > 0
    }
    await probe.unsubscribe().catch(() => undefined)
    await gateClient.removeChannel(probe)
    if (!delivered) await new Promise((r) => setTimeout(r, 3_000))
  }
  gateClient.realtime.disconnect()
  if (!delivered) {
    throw new Error('realtime service never delivered a Broadcast-from-DB message (join or delivery pipeline still down)')
  }
}, 300_000)

afterAll(async () => {
  for (const channel of openChannels) {
    await channel.unsubscribe().catch(() => undefined)
  }
  commishClient?.realtime.disconnect()
  mgr2Client?.realtime.disconnect()
  outsiderClient?.realtime.disconnect()
  await cleanup()
})

describe('auction realtime over the real Realtime service (migration 088)', () => {
  it('a member on ONE draft:<id> channel hears the nomination + raise as draft_bids INSERTs with the 088 column set, the D134 drafts pair, and then the cancel as ONE void event', async () => {
    const bidEvents: BroadcastEnvelope[] = []
    const draftEvents: BroadcastEnvelope[] = []

    // ONE channel — the §9.3 posture: drafts + draft_bids ride the same topic.
    const channel = commishClient
      .channel(`draft:${draftId}`, { config: { private: true } })
      .on('broadcast', { event: 'draft_bids' }, (msg) => bidEvents.push(msg.payload as BroadcastEnvelope))
      .on('broadcast', { event: 'drafts' }, (msg) => draftEvents.push(msg.payload as BroadcastEnvelope))
    openChannels.push(channel)
    try {
      const status = await subscribeAndWait(channel, 15_000)
      expect(status).toBe('SUBSCRIBED')
      // Settle past any transport churn before producing events (the F74
      // race is avoided by the dedicated gate client above; this idle is a
      // belt-and-braces check that the channel is STABLY joined, asserted).
      await new Promise((r) => setTimeout(r, 1_000))
      expect(channel.state).toBe('joined')

      // (a) nominate (commish/t1) + raise (mgr2/t2) through the real verbs.
      const { error: nomErr } = await commishClient.rpc('draft_nominate', {
        p_draft_id: draftId,
        p_player_id: PLAYERS[0].id,
        p_opening_bid: 5,
        p_action_id: ACTION.nominate,
      })
      expect(nomErr).toBeNull()
      const { error: raiseErr } = await mgr2Client.rpc('draft_place_bid', {
        p_draft_id: draftId,
        p_amount: 7,
        p_action_id: ACTION.raise,
        p_nomination_seq: 1,
        p_player_id: PLAYERS[0].id,
      })
      expect(raiseErr).toBeNull()

      await waitFor(
        () => (bidEvents.filter((e) => e.operation === 'INSERT').length >= 2 ? true : undefined),
        20_000,
        'two draft_bids INSERT broadcasts',
      )
      const inserts = bidEvents.filter((e) => e.operation === 'INSERT')
      expect(inserts).toHaveLength(2)
      for (const ev of inserts) {
        expect(ev.table).toBe('draft_bids')
        expect(ev.schema).toBe('public')
        expect(Object.keys(ev.record ?? {}).sort()).toEqual([
          'amount',
          'created_at',
          'nomination_seq',
          'player_id',
          'team_id',
          'voided_at',
        ])
        expect(ev.record).not.toHaveProperty('action_id')
        expect(ev.record?.voided_at).toBeNull()
        expect(ev.record?.nomination_seq).toBe(1)
        expect(ev.record?.player_id).toBe(PLAYERS[0].id)
      }
      const amounts = inserts.map((e) => e.record?.amount).sort()
      expect(amounts).toEqual([5, 7])
      expect(inserts.find((e) => e.record?.amount === 5)?.record?.team_id).toBe(commishTeamId)
      expect(inserts.find((e) => e.record?.amount === 7)?.record?.team_id).toBe(mgr2TeamId)

      // The D134 pair on the drafts event — the raise's event names $7/t2.
      const raised = await waitFor(
        () =>
          draftEvents.find(
            (e) =>
              (e.record?.current_nomination as { high_bid?: number } | null)?.high_bid === 7,
          ),
        20_000,
        'the drafts broadcast carrying the $7 nomination',
      )
      expect(Object.keys(raised.record ?? {}).sort()).toEqual([
        'budget_adjustments',
        'current_deadline',
        'current_nomination',
        'current_pick_number',
        'current_round',
        'deadline_remaining_ms',
        'on_clock_team_id',
        'paused_at',
        'status',
        'updated_at',
      ])
      expect(raised.record?.current_nomination).toEqual({
        player_id: PLAYERS[0].id,
        high_bid: 7,
        high_bidder_team_id: mgr2TeamId,
      })
      expect(raised.record?.budget_adjustments).toEqual({})
      expect(raised.record).not.toHaveProperty('config')

      // (b) pause + cancel (D143) → ONE void event (F69 — per statement).
      const { error: pauseErr } = await commishClient.rpc('draft_pause', { p_draft_id: draftId })
      expect(pauseErr).toBeNull()
      const { error: cancelErr } = await commishClient.rpc('draft_cancel_nomination', {
        p_draft_id: draftId,
      })
      expect(cancelErr).toBeNull()

      const voided = await waitFor(
        () => bidEvents.find((e) => e.operation === 'UPDATE'),
        20_000,
        'the draft_bids void broadcast',
      )
      expect(voided.table).toBe('draft_bids')
      expect(Object.keys(voided.record ?? {}).sort()).toEqual(['nominations', 'voided_at', 'voided_count'])
      expect(voided.record?.voided_count).toBe(2)
      expect(voided.record?.nominations).toEqual([{ nomination_seq: 1, player_id: PLAYERS[0].id }])
      expect(typeof voided.record?.voided_at).toBe('string')
      // The accompanying drafts event: nomination NULL, seq still 1.
      await waitFor(
        () =>
          draftEvents.find(
            (e) => e.record?.current_nomination === null && e.record?.current_pick_number === 1,
          ),
        20_000,
        'the drafts broadcast with current_nomination NULL at seq 1',
      )
      // Settle briefly, then assert the void was ONE event — not one per row
      // (two rows were stamped). The cancel's statements have all committed
      // by the time the drafts event arrived (same transaction), so any
      // per-row emission would already be in the buffer.
      await new Promise((r) => setTimeout(r, 1_500))
      expect(bidEvents.filter((e) => e.operation === 'UPDATE')).toHaveLength(1)
      expect(bidEvents.filter((e) => e.operation === 'INSERT')).toHaveLength(2)

      // DB corroboration: both rows stand, both stamped (D131(2)/D162).
      const { data: rows, error: rowsErr } = await service
        .from('draft_bids')
        .select('amount, voided_at')
        .eq('draft_id', draftId)
      expect(rowsErr).toBeNull()
      expect(rows?.map((r) => r.amount).sort()).toEqual([5, 7])
      expect(rows?.every((r) => r.voided_at !== null)).toBe(true)
    } finally {
      await channel.unsubscribe().catch(() => undefined)
      commishClient.removeChannel(channel)
    }
  }, 120_000)

  it('a non-member client gets nothing: the private channel refuses the subscribe and delivers zero events — while a member hears a driven drafts event on the same topic (positive control)', async () => {
    const received: BroadcastEnvelope[] = []
    const memberReceived: BroadcastEnvelope[] = []

    // The positive control rides mgr2's socket — a member socket that has
    // never carried a channel, so no prior removeChannel/disconnect is in
    // flight on it (the F74 race; commishClient's socket just tore test
    // (a)'s channel down).
    const memberProbe = mgr2Client
      .channel(`draft:${draftId}`, { config: { private: true } })
      .on('broadcast', { event: 'drafts' }, (msg) => memberReceived.push(msg.payload as BroadcastEnvelope))
    openChannels.push(memberProbe)
    const memberStatus = await subscribeAndWait(memberProbe, 15_000)
    expect(memberStatus).toBe('SUBSCRIBED')
    await new Promise((r) => setTimeout(r, 1_000))
    expect(memberProbe.state).toBe('joined')

    const outsiderChannel = outsiderClient
      .channel(`draft:${draftId}`, { config: { private: true } })
      .on('broadcast', { event: '*' }, (msg) => received.push(msg.payload as BroadcastEnvelope))
    openChannels.push(outsiderChannel)
    const status = await subscribeAndWait(outsiderChannel, 15_000)
    expect(status).not.toBe('SUBSCRIBED')

    // Drive a drafts event (a privileged same-value drafts UPDATE fires
    // 070's AFTER UPDATE trigger — F52: the positive control is produced,
    // not awaited from the cron, and independent of test (a)'s outcome).
    const { error: driveErr } = await service
      .from('drafts')
      .update({ current_round: 1 })
      .eq('id', draftId)
    expect(driveErr).toBeNull()
    await waitFor(() => memberReceived[0], 20_000, 'the member hears the driven drafts event')
    expect(received).toHaveLength(0)

    await memberProbe.unsubscribe().catch(() => undefined)
    mgr2Client.removeChannel(memberProbe)
    await outsiderChannel.unsubscribe().catch(() => undefined)
    outsiderClient.removeChannel(outsiderChannel)
  }, 90_000)
})
