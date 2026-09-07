/**
 * inseason-realtime-db.test.ts — L.D1.9 item 5 at the WIRE layer: migration
 * 119's in-season Broadcast-from-DB against the LOCAL stack's real Realtime
 * service (spec §9.1 "one compact scores_updated event per league per
 * batch" / §9.2 / §9.3 / §22.2; PROGRESS D292 / D296 / D298 / D319; ledger
 * F233(c) + F248(a) — the delivery proofs those rows deferred to this task):
 *
 *   (a) a MEMBER supabase-js client subscribed to the PRIVATE `league:<id>`
 *       channel receives a driven `score_write_week_batch` (the worker's
 *       door — the production writer) as EXACTLY ONE `matchups` event
 *       (asserted by COUNT after a settle window — the D292 claim at the
 *       wire), carrying the column-selected summary (season / week /
 *       count / the changed rows with 119's 14 keys — nothing per player,
 *       no snapshot); the identical re-send writes nothing and delivers
 *       NOTHING (rule 10's loud emptiness, `no_change`);
 *   (b) a `transactions` INSERT arrives as one `transactions` event with
 *       the column-selected record — the payload blob (a planted `faab`)
 *       never on the wire (F233(c)'s arm);
 *   (c) a `league_weeks` status flip arrives as one `league_weeks` event
 *       (F248(a)'s finalization-badge arm);
 *   (d) a NON-MEMBER client gets nothing: the private-channel subscribe is
 *       REFUSED by 070's realtime.messages policy (never SUBSCRIBED) and
 *       zero events are delivered — while the member's channel on the same
 *       topic receives BOTH driven door writes, the second one across a
 *       deliberate 3 s idle gap and during the outsider's refused rejoin
 *       loop (the positive controls; probe 3 — a public topic — reds this
 *       cell; R847's probe — the second write commented out — reds it too).
 *
 * HARNESS (the draft-realtime-db pattern): the readiness gate proves
 * DELIVERY end-to-end before any assertion (the post-reset boot-window
 * races — a join that times out, a `realtime.send` that silently drops
 * until the day partitions exist); a dead service FAILS loudly, never
 * skips (§4.3). ONE SOCKET PER CELL (MEASURED in the R847 fix round —
 * PROGRESS D319(9) / F259(c)): each cell signs the member in afresh, so
 * the cell's channel is its socket's FIRST channel — the one shape that
 * delivered in every probe (3 s / 6 s / 15 s gaps here, 104 s in the
 * reviewer's Node run). On the local stack (realtime v2.124.4,
 * realtime-js 2.101.1 in Node) a LATER channel on the same socket — one
 * joined after an earlier channel on the topic left — sometimes stops
 * receiving Broadcast-from-DB about a second after its last delivery
 * (deterministic in the gate → cell shape this file first had: 3/3 red on
 * the second write; a second socket's channel received every message the
 * deaf one missed — the loss is per socket, the rows are in
 * `realtime.messages`, the service logs nothing). Cause unknown; the
 * determinant was NOT isolated (not gap length alone, not the outsider,
 * not the event name or its trigger, not time since connect); recorded,
 * not doctrine. Deliveries are awaited by attempt-counted polls (no
 * wall-clock read — the D3/D17 ESLint fence covers this file).
 *
 * CALENDAR (F215 / F226): the league lives on `SYNTHETIC_SEASON` (2099);
 * the door reads no clock — the week's own `league_weeks.status` is the
 * datum (D319(3)) — so nothing here evaluates an instant; the one
 * `league_weeks` write is a status flip (`upcoming → live` at setup, then
 * `live → correction_window` for (c)), both legal steps (F4).
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips.
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first. Action-id
 * prefix `afd` — this suite owns it (the D108(14) registry: af0–af9, afa,
 * afb, afc taken; afd measured free 2026-09-07).
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-inseason-rt-league'

const COMMISH = {
  email: 'inseason-rt-commish@fieldscout.test',
  password: 'pgtap-irt-pass-1',
  username: 'irt_commish_one',
}
const MANAGER = {
  email: 'inseason-rt-manager@fieldscout.test',
  password: 'pgtap-irt-pass-2',
  username: 'irt_manager_two',
}
const OUTSIDER = {
  email: 'inseason-rt-outsider@fieldscout.test',
  password: 'pgtap-irt-pass-3',
  username: 'irt_outsider_three',
}

const ACTION = {
  league: 'afd00000-0000-4000-8000-000000000001',
  txn: 'afd00000-0000-4000-8000-000000000011',
} as const

/** 119's `matchup_broadcast_payload` key set — the stored literal 067 D1 pins. */
const MATCHUP_KEYS = [
  'away_score',
  'away_seed',
  'away_team_id',
  'home_score',
  'home_seed',
  'home_team_id',
  'id',
  'is_overridden',
  'result',
  'round_type',
  'season',
  'status',
  'updated_at',
  'week',
]

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

interface BroadcastEnvelope {
  operation?: string
  table?: string
  schema?: string
  record?: Record<string, unknown> | null
  [key: string]: unknown
}

interface DoorReport {
  written: number
  writable: number
  unchanged: number
  reason: string | null
  skipped: unknown[]
}

let managerClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let managerId: string
let commishId: string
let leagueId: string
let teamIds: string[] = []
const openChannels: RealtimeChannel[] = []
const openClients: SupabaseClient<Database>[] = []

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    // The learned order (D306(6)): results + matchups + weeks before teams.
    for (const table of [
      'transactions',
      'team_week_results',
      'matchups',
      'league_weeks',
      'league_player_pool',
      'league_rosters',
      'league_chat',
      'league_members',
    ] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
  }
  for (const u of [COMMISH, MANAGER, OUTSIDER]) {
    await deleteUserByUsername(u.username)
  }
}

async function createUser(user: { email: string; password: string; username: string }): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  return data.user.id
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { data, error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  // Deterministic realtime auth: the private-channel check runs against
  // this user's JWT (the explicit call removes the onAuthStateChange race).
  await client.realtime.setAuth(data.session?.access_token ?? null)
  return client
}

/** Await a terminal subscribe status (SUBSCRIBED or a refusal). */
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

/** Attempt-counted poll (no wall-clock read; timeout ≈ attempts × POLL_MS). */
async function waitFor<T>(probe: () => T | undefined, timeoutMs: number, label: string): Promise<T> {
  const attempts = Math.ceil(timeoutMs / POLL_MS)
  for (let i = 0; i < attempts; i++) {
    const value = probe()
    if (value !== undefined) return value
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  throw new Error(`timed out waiting for ${label}`)
}

/** A settle window: what arrives AFTER the first delivery is the coalescing claim. */
async function settle(ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

async function door(week: number, scores: Array<{ team_id: string; points: number | null }>): Promise<DoorReport> {
  const { data, error } = await service.rpc('score_write_week_batch', {
    p_league_id: leagueId,
    p_week: week,
    p_scores: scores as unknown as Json,
  })
  if (error) throw new Error(`score_write_week_batch: ${error.message}`)
  return data as unknown as DoorReport
}

/** A fresh member socket for ONE cell (the header's one-socket-per-cell rule). */
async function memberSocket(): Promise<SupabaseClient<Database>> {
  const client = await signIn(MANAGER)
  openClients.push(client)
  return client
}

function memberChannel(
  client: SupabaseClient<Database>,
  handlers: Partial<Record<'matchups' | 'transactions' | 'league_weeks' | 'team_week_results', (payload: BroadcastEnvelope) => void>>,
): RealtimeChannel {
  let ch = client.channel(`league:${leagueId}`, { config: { private: true } })
  for (const [event, handler] of Object.entries(handlers)) {
    ch = ch.on('broadcast', { event }, (msg) => handler?.(msg.payload as BroadcastEnvelope))
  }
  openChannels.push(ch)
  return ch
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  commishId = await createUser(COMMISH)
  managerId = await createUser(MANAGER)
  await createUser(OUTSIDER)
  const commishClient = await signIn(COMMISH)
  managerClient = await signIn(MANAGER)
  outsiderClient = await signIn(OUTSIDER)

  const settings = defaultsForTeamCount(8)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient
    .from('scoring_systems')
    .select('id, rules')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  const { data: created, error: createError } = await commishClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: SYNTHETIC_SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'Commish Team',
    p_action_id: ACTION.league,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id
  commishClient.realtime.disconnect()

  // Eight seats: the commissioner's + the manager's (a MEMBER — the
  // subscriber) + six commissioner-owned fixtures.
  const { data: commishTeam, error: commishTeamError } = await service
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .single()
  if (commishTeamError) throw new Error(`commissioner team: ${commishTeamError.message}`)
  const { data: manager, error: teamError } = await service
    .from('teams')
    .insert({ owner_id: managerId, name: 'Manager Team', league_id: leagueId })
    .select('id')
    .single()
  if (teamError) throw new Error(`teams insert: ${teamError.message}`)
  const { data: extra, error: extraError } = await service
    .from('teams')
    .insert(
      Array.from({ length: 6 }, (_, i) => ({ owner_id: commishId, name: `Seat ${i + 3}`, league_id: leagueId })),
    )
    .select('id')
  if (extraError) throw new Error(`teams insert (extra): ${extraError.message}`)
  teamIds = [commishTeam.id, manager.id, ...(extra ?? []).map((t) => t.id)]
  const { error: memberError } = await service
    .from('league_members')
    .insert({ league_id: leagueId, user_id: managerId, team_id: manager.id, role: 'manager' })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)

  const { error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  const { error: weeksError } = await service
    .from('league_weeks')
    .insert([1, 2].map((week) => ({ league_id: leagueId, season: SYNTHETIC_SEASON, week })))
  if (weeksError) throw new Error(`league_weeks insert: ${weeksError.message}`)
  // upcoming → live (a legal F4 step; the door writes only an open week).
  const { error: openError } = await service
    .from('league_weeks')
    .update({ status: 'live' })
    .eq('league_id', leagueId)
    .eq('week', 1)
  if (openError) throw new Error(`league_weeks → live: ${openError.message}`)

  // Four week-1 pairings at 109's DEFAULT 0 / 0 — the door writes them.
  const { error: matchupsError } = await service.from('matchups').insert(
    Array.from({ length: 4 }, (_, i) => ({
      league_id: leagueId,
      season: SYNTHETIC_SEASON,
      week: 1,
      round_type: 'regular',
      home_team_id: teamIds[i * 2 + 1],
      away_team_id: teamIds[i * 2],
      status: 'live',
    })),
  )
  if (matchupsError) throw new Error(`matchups insert: ${matchupsError.message}`)

  // Realtime READINESS GATE (harness, not assertion — the draft-realtime-db
  // shape): subscribe the league topic as the member and fire 070's
  // leagues trigger (a same-value name UPDATE) until an event ARRIVES.
  let delivered = false
  for (let attempt = 0; attempt < 8 && !delivered; attempt++) {
    const readyEvents: unknown[] = []
    const probe = managerClient
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
    managerClient.removeChannel(probe)
    if (!delivered) await new Promise((r) => setTimeout(r, 3_000))
  }
  if (!delivered) {
    throw new Error('realtime service never delivered a Broadcast-from-DB message (join or delivery pipeline still down)')
  }

}, 300_000)

afterAll(async () => {
  for (const channel of openChannels) {
    await channel.unsubscribe().catch(() => undefined)
  }
  for (const client of openClients) {
    client.realtime.disconnect()
  }
  managerClient?.realtime.disconnect()
  outsiderClient?.realtime.disconnect()
  await cleanup()
})

describe('in-season Broadcast-from-DB over the real Realtime service (migration 119)', () => {
  it('a driven door batch reaches a subscribed MEMBER as EXACTLY ONE `matchups` event, column-selected; the identical re-send delivers nothing', async () => {
    const events: BroadcastEnvelope[] = []
    const member = await memberSocket()
    const channel = memberChannel(member, { matchups: (p) => events.push(p) })
    expect(await subscribeAndWait(channel, 15_000)).toBe('SUBSCRIBED')

    const report = await door(
      1,
      teamIds.map((team_id, i) => ({ team_id, points: i === 6 ? null : 100 + i + 0.25 })),
    )
    expect(report.written).toBe(4)
    expect(report.reason).toBeNull()

    await waitFor(() => (events.length > 0 ? true : undefined), 20_000, 'the matchups event')
    // The coalescing claim is what arrives AFTER the first delivery: a
    // per-row trigger (or a per-cell door) would put three more here.
    await settle(8)
    expect(events).toHaveLength(1)

    const [event] = events
    expect(event.operation).toBe('UPDATE')
    expect(event.table).toBe('matchups')
    expect(event.schema).toBe('public')
    const record = event.record as { season: number; week: number; count: number; matchups: Array<Record<string, unknown>> }
    expect(record.season).toBe(SYNTHETIC_SEASON)
    expect(record.week).toBe(1)
    expect(record.count).toBe(4)
    expect(record.matchups).toHaveLength(4)
    for (const row of record.matchups) {
      expect(Object.keys(row).sort()).toEqual(MATCHUP_KEYS)
    }
    // E61 on the wire: the pending team's cell is null, never 0.
    const pending = record.matchups.find((m) => m.home_team_id === teamIds[7] || m.away_team_id === teamIds[7])
    expect(pending).toBeDefined()
    expect(pending?.home_team_id === teamIds[7] ? pending.home_score : pending?.away_score).toBe(100 + 7 + 0.25)
    const pendingRow = record.matchups.find((m) => m.home_team_id === teamIds[6] || m.away_team_id === teamIds[6])
    expect(pendingRow?.home_team_id === teamIds[6] ? pendingRow.home_score : pendingRow?.away_score).toBeNull()
    // Nothing blind: no snapshot, no per-player lines, no audit id.
    const text = JSON.stringify(event)
    expect(text).not.toContain('scoring_rules_snapshot')
    expect(text).not.toContain('player_id')
    expect(text).not.toContain('override_action_id')

    // The identical re-send: zero writes, said out loud, and NO delivery.
    const again = await door(
      1,
      teamIds.map((team_id, i) => ({ team_id, points: i === 6 ? null : 100 + i + 0.25 })),
    )
    expect(again.written).toBe(0)
    expect(again.reason).toBe('no_change')
    await settle(8)
    expect(events).toHaveLength(1)

    await channel.unsubscribe().catch(() => undefined)
    member.removeChannel(channel)
    member.realtime.disconnect()
  }, 90_000)

  it('a transactions INSERT and a league_weeks status flip each arrive as one column-selected event (F233(c) / F248(a))', async () => {
    const txnEvents: BroadcastEnvelope[] = []
    const weekEvents: BroadcastEnvelope[] = []
    const member = await memberSocket()
    const channel = memberChannel(member, {
      transactions: (p) => txnEvents.push(p),
      league_weeks: (p) => weekEvents.push(p),
    })
    expect(await subscribeAndWait(channel, 15_000)).toBe('SUBSCRIBED')

    // The trigger is the TABLE's; 113's roster_add_drop is the production
    // writer — the row shape below is its `add_drop` row with a planted
    // `faab` (M5's amount) to prove the blob never reaches the wire.
    const { data: txn, error: txnError } = await service
      .from('transactions')
      .insert({
        league_id: leagueId,
        type: 'add_drop',
        status: 'complete',
        initiator_team_id: teamIds[1],
        initiated_by: managerId,
        payload: { add_player_id: 'irt-add', drop_player_id: 'irt-drop', faab: 17 },
        week: 1,
        action_id: ACTION.txn,
      })
      .select('id')
      .single()
    if (txnError) throw new Error(`transactions insert: ${txnError.message}`)

    const txnEvent = await waitFor(() => txnEvents[0], 20_000, 'the transactions event')
    expect(txnEvent.operation).toBe('INSERT')
    expect(txnEvent.table).toBe('transactions')
    const txnRecord = txnEvent.record as Record<string, unknown>
    expect(Object.keys(txnRecord).sort()).toEqual([
      'add_player_id',
      'created_at',
      'drop_player_id',
      'id',
      'initiator_team_id',
      'status',
      'type',
      'week',
    ])
    expect(txnRecord.id).toBe(txn.id)
    expect(txnRecord.add_player_id).toBe('irt-add')
    expect(txnRecord.drop_player_id).toBe('irt-drop')
    expect(JSON.stringify(txnEvent)).not.toContain('faab')
    expect(JSON.stringify(txnEvent)).not.toContain(ACTION.txn)
    expect(JSON.stringify(txnEvent)).not.toContain(managerId)

    // live → correction_window (a legal F4 step) — the "pending corrections"
    // badge's moment.
    const { error: flipError } = await service
      .from('league_weeks')
      .update({ status: 'correction_window' })
      .eq('league_id', leagueId)
      .eq('week', 1)
    if (flipError) throw new Error(`league_weeks flip: ${flipError.message}`)
    const weekEvent = await waitFor(() => weekEvents[0], 20_000, 'the league_weeks event')
    expect(weekEvent.operation).toBe('UPDATE')
    expect(weekEvent.record).toEqual({
      season: SYNTHETIC_SEASON,
      week: 1,
      status: 'correction_window',
      median_score: null,
      finalized_at: null,
    })
    await settle(4)
    expect(weekEvents).toHaveLength(1)
    expect(txnEvents).toHaveLength(1)

    await channel.unsubscribe().catch(() => undefined)
    member.removeChannel(channel)
    member.realtime.disconnect()
  }, 90_000)

  it('a NON-MEMBER client gets nothing: the private channel refuses the subscribe and delivers zero events while a member on the same topic receives the door', async () => {
    const memberReceived: BroadcastEnvelope[] = []
    const outsiderReceived: BroadcastEnvelope[] = []

    // Positive control FIRST: a fresh member subscription on the topic
    // receives a real door write — "gets nothing" is proven against a
    // delivering topic, not a dead room.
    const member = await memberSocket()
    const memberProbe = memberChannel(member, { matchups: (p) => memberReceived.push(p) })
    expect(await subscribeAndWait(memberProbe, 15_000)).toBe('SUBSCRIBED')
    const control = await door(1, [{ team_id: teamIds[0], points: 55.5 }])
    expect(control.written).toBe(1)
    await waitFor(() => memberReceived[0], 20_000, 'the member positive control')

    const outsiderChannel = outsiderClient
      .channel(`league:${leagueId}`, { config: { private: true } })
      .on('broadcast', { event: '*' }, (msg) => outsiderReceived.push(msg.payload as BroadcastEnvelope))
    openChannels.push(outsiderChannel)
    const status = await subscribeAndWait(outsiderChannel, 15_000)
    expect(status).not.toBe('SUBSCRIBED')

    // A deliberate IDLE gap on the member's channel before the second write
    // (≈ 3 s of no traffic on the topic) — the standing measurement behind
    // PROGRESS F259(c) / D319(9): the first Builder's scratch probes read a
    // private channel as deaf after a ≥ 1 s lull; on a socket's FIRST
    // channel (this one) it is not — the reviewer's 11/11 to 104 s (R847)
    // and this cell every run. The SECOND write below is asserted, across
    // the gap. If this cell ever misses here, that is a measurement —
    // record the count in PROGRESS, do not weaken the assertion.
    await settle(15)

    // A real write lands while the refused channel is live (and re-joining
    // on realtime-js's backoff): the member receives it as ONE more event;
    // nothing reaches the outsider's handler.
    const during = await door(1, [{ team_id: teamIds[0], points: 56.5 }])
    expect(during.written).toBe(1)
    await waitFor(() => memberReceived[1], 20_000, 'the member second write (across the idle gap)')
    await settle(10)

    expect(memberReceived).toHaveLength(2)
    const secondRow = (memberReceived[1].record as { matchups: Array<Record<string, unknown>> }).matchups[0]
    expect(secondRow.home_team_id === teamIds[0] ? secondRow.home_score : secondRow.away_score).toBe(56.5)
    expect(outsiderReceived).toHaveLength(0)

    await memberProbe.unsubscribe().catch(() => undefined)
    member.removeChannel(memberProbe)
    member.realtime.disconnect()
  }, 150_000)
})
