/**
 * draft-realtime-db.test.ts — L.B1.5 item 5 at the WIRE layer: migration
 * 070's Broadcast-from-DB + channel auth against the LOCAL stack's real
 * Realtime service (spec §9.1/§9.2; delivery plan §8.4; tasks-M2 §4.5 —
 * the repo's FIRST realtime, proven end-to-end):
 *
 *   (a) a MEMBER supabase-js client subscribes to the PRIVATE
 *       `draft:<id>` channel and a pick INSERT (the tick's autopick — the
 *       production writer) arrives as a 'draft_picks' broadcast carrying
 *       EXACTLY the §5 column-selected record (pick_number, round,
 *       team_id, player_id, is_auto, is_undone — nothing blind);
 *       the drafts-row advance arrives as a 'drafts' broadcast; the §9.1
 *       heartbeat arrives as a 'tick' event (server_now + deadline).
 *   (b) a NON-MEMBER client gets nothing: the private-channel subscribe
 *       is REFUSED by the realtime.messages policies (never reaches
 *       SUBSCRIBED) and zero events are delivered — while the member's
 *       channel receives in the same window (the positive control).
 *
 * HARNESS (D100): the pick is produced by a service-role deadline rewind
 * (90s — past deadline + grace, so the never-heartbeat commissioner seat
 * autopicks immediately, the draft-tick-db pattern) + a direct
 * draft_tick() call; the live 5s cron is a LEGAL concurrent actor (022
 * rule) — whichever caller ticks, the broadcast is the assertion target.
 * Rewinds SUBTRACT from the server-written deadline (no wall-clock).
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
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

const LEAGUE_NAME = 'vitest-draft-rt-league'
/** Future instant — the D94 arm must NOT fire; this suite starts manually. */
const DRAFT_INSTANT = '2027-09-05T17:00:00+00:00'
const TEAM_COUNT = 8

const COMMISH = {
  email: 'draft-rt-commish@fieldscout.test',
  password: 'pgtap-rt-pass-1',
  username: 'rt_wire_commish',
}
const OUTSIDER = {
  email: 'draft-rt-outsider@fieldscout.test',
  password: 'pgtap-rt-pass-2',
  username: 'rt_wire_outsider',
}

const PLAYERS = Array.from({ length: 10 }, (_, i) => ({
  id: `rt-wire-rb${String(i + 1).padStart(2, '0')}`,
  full_name: `RT Wire RB ${String(i + 1).padStart(2, '0')}`,
  position: 'RB',
  adp: i + 1,
}))

const ACTION = { create: 'ad500000-0000-4000-8000-000000000001' } as const

type BroadcastEnvelope = {
  operation?: string
  table?: string
  schema?: string
  record?: Record<string, unknown>
  server_now?: string
  current_deadline?: string | null
  id?: string
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let leagueId: string
let draftId: string
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
  await deleteUserByUsername(COMMISH.username)
  await deleteUserByUsername(OUTSIDER.username)
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { data, error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  // Deterministic realtime auth: the private-channel check runs against
  // this user's JWT (supabase-js wires it via onAuthStateChange too; the
  // explicit call removes the race).
  await client.realtime.setAuth(data.session?.access_token ?? null)
  return client
}

/** Await a terminal subscribe status (SUBSCRIBED or a refusal). */
function subscribeAndWait(
  channel: RealtimeChannel,
  timeoutMs: number,
): Promise<string> {
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

/** Attempt-counted poll (no wall-clock read — the D3/D17 guard covers this
 *  file; timeout ≈ attempts × POLL_MS). */
async function waitFor<T>(
  probe: () => T | undefined,
  timeoutMs: number,
  label: string,
): Promise<T> {
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
  for (const user of [COMMISH, OUTSIDER]) {
    const { error } = await service.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { username: user.username },
    })
    if (error) throw new Error(`createUser failed: ${error.message}`)
  }
  commishClient = await signIn(COMMISH)
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
    p_season: 2026,
    p_scoring_system_id: template?.id,
    p_team_name: 'RT Commish Team',
    p_action_id: ACTION.create,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  for (let i = 0; i < TEAM_COUNT - 1; i++) {
    const fill = await addPlaceholderSeat(commishClient, leagueId, {})
    if (fill.status !== 201) throw new Error(`placeholder fill failed: ${JSON.stringify(fill.body)}`)
  }

  const configured = await patchLeague(commishClient, leagueId, {
    settings: {
      roster_settings: {
        starting_slots: [{ key: 'rb', label: 'RB', eligible: ['RB'], count: 1 }],
        bench: 1,
        ir_slots: [],
        swap_spots: 0,
      },
      draft: {
        draft_scheduled_at: DRAFT_INSTANT,
        draft_order_mode: 'random',
        pick_timer_seconds: 30,
        disconnect_grace_seconds: 30,
      },
    },
  })
  if (configured.status !== 200) {
    throw new Error(`configure PATCH failed: ${JSON.stringify(configured.body)}`)
  }
  const scheduled = await patchLeague(commishClient, leagueId, { status: 'scheduled' })
  if (scheduled.status !== 200) {
    throw new Error(`scheduled PATCH failed: ${JSON.stringify(scheduled.body)}`)
  }

  const { data: started, error: startError } = await commishClient.rpc('draft_start', {
    p_league_id: leagueId,
  })
  if (startError) throw new Error(`draft_start failed: ${startError.message}`)
  draftId = (started as unknown as { draft: { id: string } }).draft.id

  // Realtime READINESS GATE (harness, not assertion): `db reset` restarts
  // the realtime container. Two boot races were observed under the full
  // parallel `npm run test` right after a reset: (1) the private-channel
  // JOIN times out while the service re-establishes its DB session, and
  // (2) the join succeeds but Broadcast-from-DB DELIVERY is not yet
  // flowing — the service recreates the realtime.messages day partitions
  // at boot, and realtime.send() SILENTLY drops inserts until they exist
  // (its internal exception trap), so trigger-emitted messages are lost,
  // not late. The gate therefore proves DELIVERY end-to-end: subscribe
  // the league topic, then repeatedly fire the leagues broadcast trigger
  // (a same-value name UPDATE — UPDATE OF fires on the SET list, no data
  // change) until an event actually ARRIVES. A dead service still FAILS
  // loudly here (never a skip, §4.3).
  let delivered = false
  for (let attempt = 0; attempt < 8 && !delivered; attempt++) {
    const readyEvents: unknown[] = []
    const probe = commishClient
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
    commishClient.removeChannel(probe)
    if (!delivered) await new Promise((r) => setTimeout(r, 3_000))
  }
  if (!delivered) {
    throw new Error('realtime service never delivered a Broadcast-from-DB message (join or delivery pipeline still down)')
  }
  // Hook timeout > the gate's worst-case budget — 8 attempts x (10s join
  // + 5 fires x 15 polls x 200ms + 3s backoff) = ~224s — plus setup slack,
  // so terminal failure always surfaces as the diagnostic error above,
  // never vitest's generic hook timeout (R147).
}, 300_000)

afterAll(async () => {
  for (const channel of openChannels) {
    await channel.unsubscribe().catch(() => undefined)
  }
  commishClient?.realtime.disconnect()
  outsiderClient?.realtime.disconnect()
  await cleanup()
})

describe('Broadcast-from-DB over the real Realtime service (migration 070)', () => {
  it('a member subscribed to draft:<id> receives the pick INSERT with the selected columns, the drafts advance, and the tick heartbeat', async () => {
    const pickEvents: BroadcastEnvelope[] = []
    const draftEvents: BroadcastEnvelope[] = []
    const tickEvents: BroadcastEnvelope[] = []

    const channel = commishClient
      .channel(`draft:${draftId}`, { config: { private: true } })
      .on('broadcast', { event: 'draft_picks' }, (msg) =>
        pickEvents.push(msg.payload as BroadcastEnvelope),
      )
      .on('broadcast', { event: 'drafts' }, (msg) =>
        draftEvents.push(msg.payload as BroadcastEnvelope),
      )
      .on('broadcast', { event: 'tick' }, (msg) => tickEvents.push(msg.payload as BroadcastEnvelope))
    openChannels.push(channel)
    try {
      const status = await subscribeAndWait(channel, 15_000)
      expect(status).toBe('SUBSCRIBED')

      // Force a timeout autopick: rewind the SERVER-written deadline 90s
      // (past deadline + grace — the stale never-heartbeat commissioner seat
      // autopicks immediately), then tick (the cron may beat us to it —
      // either caller's broadcast is the target).
      const { data: row } = await service
        .from('drafts')
        .select('current_deadline')
        .eq('id', draftId)
        .single()
      expect(row?.current_deadline).not.toBeNull()
      const rewound = new Date(Date.parse(row!.current_deadline as string) - 90_000).toISOString()
      await service.from('drafts').update({ current_deadline: rewound }).eq('id', draftId)
      const { error: tickError } = await service.rpc('draft_tick')
      expect(tickError).toBeNull()

      // (a) The pick INSERT arrives with EXACTLY the §5 selected columns.
      const pick = await waitFor(() => pickEvents[0], 20_000, 'the draft_picks broadcast')
      expect(pick.operation).toBe('INSERT')
      expect(pick.table).toBe('draft_picks')
      expect(pick.schema).toBe('public')
      expect(Object.keys(pick.record ?? {}).sort()).toEqual([
        'is_auto',
        'is_undone',
        'pick_number',
        'player_id',
        'round',
        'team_id',
      ])
      expect(pick.record?.pick_number).toBe(1)
      expect(pick.record?.is_auto).toBe(true)
      expect(
        PLAYERS.some((p) => p.id === pick.record?.player_id),
      ).toBe(true)

      // The drafts-row advance broadcast (column-selected; updated_at = the
      // D92 state_version; never the config blob).
      const draftEvent = await waitFor(
        () => draftEvents.find((e) => e.operation === 'UPDATE'),
        20_000,
        'the drafts broadcast',
      )
      expect(draftEvent.table).toBe('drafts')
      const draftKeys = Object.keys(draftEvent.record ?? {}).sort()
      expect(draftKeys).toEqual([
        'current_deadline',
        'current_pick_number',
        'current_round',
        'deadline_remaining_ms',
        'on_clock_team_id',
        'paused_at',
        'status',
        'updated_at',
      ])
      expect(draftEvent.record).not.toHaveProperty('config')

      // The §9.1 heartbeat (068 ARM 3 — the live 5s cron alone would deliver
      // it; the direct tick above already did).
      const tick = await waitFor(() => tickEvents[0], 20_000, 'the tick heartbeat')
      expect(typeof tick.server_now).toBe('string')
      expect(tick).toHaveProperty('current_deadline')

    } finally {
      // Release the topic even on failure (one channel per topic per
      // client; §9.3's unsubscribe-on-route-change discipline) so test (b)
      // can always subscribe its own fresh member channel.
      await channel.unsubscribe().catch(() => undefined)
      commishClient.removeChannel(channel)
    }
  }, 90_000)

  it('a non-member client gets nothing: the private channel refuses the subscribe and delivers zero events', async () => {
    const received: BroadcastEnvelope[] = []
    const memberReceived: BroadcastEnvelope[] = []

    // Positive control: a fresh member subscription on the SAME topic in
    // the SAME window hears the cron heartbeat while the outsider hears
    // silence — "gets nothing" is proven against a delivering channel,
    // not a dead room.
    const memberProbe = commishClient
      .channel(`draft:${draftId}`, { config: { private: true } })
      .on('broadcast', { event: 'tick' }, (msg) =>
        memberReceived.push(msg.payload as BroadcastEnvelope),
      )
    openChannels.push(memberProbe)
    const memberStatus = await subscribeAndWait(memberProbe, 15_000)
    expect(memberStatus).toBe('SUBSCRIBED')

    const outsiderChannel = outsiderClient
      .channel(`draft:${draftId}`, { config: { private: true } })
      .on('broadcast', { event: '*' }, (msg) => received.push(msg.payload as BroadcastEnvelope))
    openChannels.push(outsiderChannel)
    const status = await subscribeAndWait(outsiderChannel, 15_000)
    expect(status).not.toBe('SUBSCRIBED')

    // The cron beats every ~5s. This positive control is the ONE assertion
    // in the suite with no direct tick behind it — it waits on the live cron
    // alone, so under a full parallel `npm run test` the realtime container
    // contends with every other stack-backed suite and two beats' worth of
    // budget was not enough (R163: observed timing out in 2 of 4 parallel
    // full runs, green when the file runs alone). Budget widened to ~9 beats
    // (and the case timeout with it — two 15s subscribes precede the wait);
    // nothing about the assertion changed, only the patience.
    await waitFor(() => memberReceived[0], 45_000, 'the member-side heartbeat (positive control)')
    expect(received).toHaveLength(0)
  }, 150_000)
})
