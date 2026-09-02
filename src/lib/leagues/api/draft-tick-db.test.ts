/**
 * draft-tick-db.test.ts — L.B1.3 item 5 at the WIRE layer: migration 068's
 * authoritative clock (draft_tick + autopick) against the LOCAL Supabase
 * stack — a scripted draft in which EVERY seat times out and the board
 * completes correctly with ZERO manual picks (spec §8.2/§8.4/§14: "the
 * draft is correct even if every client disconnects").
 *
 * SIZING NOTE (documented adaptation): the task text says "a 4-team
 * scripted draft", but `team_count ∈ {8,10,12,14,16}` (§7.3.8; 040's
 * CHECK) makes a 4-team league unconstructible through ANY sanctioned
 * path. The scenario ships at the v1 minimum — 8 teams × 2 rounds
 * (roster override: 1 RB starter + 1 bench, D91) = 16 all-timeout picks —
 * preserving exactly what the scenario proves.
 *
 * HARNESS (D100): timeout scenarios are produced by service-role
 * `current_deadline` rewinds between direct draft_tick() calls —
 * production RPCs never accept a caller clock. Rewinds are computed by
 * SUBTRACTING from the SERVER-written deadline (a server timestamp), so
 * no wall-clock is read anywhere (the D3/D17 ESLint guard covers this
 * file). The pg_cron 5s job is a LEGAL concurrent actor on the committed
 * fixture: it makes the same deterministic picks the direct calls make,
 * so every assertion is on converged DB state, never on which caller
 * ticked.
 *
 * Seats: 1 real commissioner (STALE — never heartbeats; the rewind jumps
 * past deadline + disconnect_grace_seconds, the D102 stale-branch) + 7
 * placeholder seats (NO user — E48's autopilot, no grace). The
 * commissioner's queue (the one client-writable draft table) pins the
 * queue→ADP source order on the wire; every other pick is ADP.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { patchLeague } from './leagues-service'
import { addPlaceholderSeat } from './members-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-draft-tick-league'
/** Future instant — the schedule gate needs one; the D94 arm must NOT fire
 *  on it (this suite starts the draft manually). */
const DRAFT_INSTANT = '2027-09-01T17:00:00+00:00'
const TEAM_COUNT = 8
const ROUNDS = 2
const TOTAL_PICKS = TEAM_COUNT * ROUNDS

const COMMISH = {
  email: 'draft-tick-commish@fieldscout.test',
  password: 'pgtap-tick-pass-1',
  username: 'tk_wire_commish',
}

/** 20 RBs, adp 0.01..0.20 — a FRACTIONAL band below every real ADP (the
 *  F60/R286 discipline, the draft-realtime-db precedent: integer `i + 1`
 *  had `tk-wire-rb01` sitting at adp 1 ALONGSIDE a real player at adp 1
 *  after `RESTORE_SCOPE=draft`, losing 068's `pl.id` tiebreak — R315's
 *  measured collision). With the fractional band the fixtures win the ADP
 *  walk BY VALUE against any restored pool, so the suite can assert
 *  fixture identity on ADP-resolved picks (the discrimination F60's sweep
 *  demands) instead of being green only by never looking. The band choice
 *  is F94-safe: fractional rows sit below all real ADPs like realtime's
 *  /100 band, the stack lane is serialized (vitest.config.ts), and no
 *  auction CPU-value suite coexists with these rows.
 *
 *  The commissioner queues the WORST-adp player so the queue source is
 *  discriminable from ADP on the wire (no ADP-driven seat ever reaches
 *  tk-wire-rb20 in 16 picks). */
const PLAYERS = Array.from({ length: 20 }, (_, i) => ({
  id: `tk-wire-rb${String(i + 1).padStart(2, '0')}`,
  full_name: `TK Wire RB ${String(i + 1).padStart(2, '0')}`,
  position: 'RB',
  adp: (i + 1) / 100,
}))
const QUEUED_PLAYER_ID = 'tk-wire-rb20'

const ACTION = { create: 'ad100000-0000-4000-8000-000000000001' } as const

type DraftRow = Database['public']['Tables']['drafts']['Row']

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let leagueId: string
let draftId: string
let commishTeamId: string

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
    // 110/L.D1.2: completion now writes matchups + league_weeks (the schedule) — both reference teams/leagues, so the league graph releases them FIRST (a fixture change forced by 110, not a drive-by).
    await service.from('matchups').delete().in('league_id', ids)
    await service.from('league_weeks').delete().in('league_id', ids)
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
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/** Compute the snake pick→team expansion from the authoritative stored
 *  order (harness assertion input — display math stays D90's concern). */
function snakeExpansion(order: string[], rounds: number): string[] {
  const out: string[] = []
  for (let r = 0; r < rounds; r++) {
    const roundOrder = r % 2 === 0 ? order : [...order].reverse()
    out.push(...roundOrder)
  }
  return out
}

beforeAll(async () => {
  await cleanup()
  // F215 / migration 110: draft completion maps the league onto the NFL
  // calendar at the call instant — this suite creates its league on a
  // SYNTHETIC season so the mapping never depends on the wall clock.
  await seedSyntheticSeason(service)
  const { error: userError } = await service.auth.admin.createUser({
    email: COMMISH.email,
    password: COMMISH.password,
    email_confirm: true,
    user_metadata: { username: COMMISH.username },
  })
  if (userError) throw new Error(`createUser failed: ${userError.message}`)
  commishClient = await signIn(COMMISH)

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
    p_season: SYNTHETIC_SEASON, // F215: the fixture owns its calendar (migration 110 maps completion onto nfl_weeks)
    p_scoring_system_id: template?.id,
    p_team_name: 'Tick Commish Team',
    p_action_id: ACTION.create,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  // Fill the seven remaining seats with PLACEHOLDERS (no user — E48's
  // autopilot: they autopick at the deadline with no grace).
  for (let i = 0; i < TEAM_COUNT - 1; i++) {
    const fill = await addPlaceholderSeat(commishClient, leagueId, {})
    if (fill.status !== 201) throw new Error(`placeholder fill failed: ${JSON.stringify(fill.body)}`)
  }

  // Tiny board (D91: 1 RB starter + 1 bench = 2 rounds) + the draft config:
  // 30s clock, default 30s grace, random order, future instant.
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

  const { data: member, error: memberError } = await service
    .from('league_members')
    .select('team_id')
    .eq('league_id', leagueId)
    .eq('role', 'commissioner')
    .single()
  if (memberError || !member?.team_id) {
    throw new Error(`commissioner team lookup failed: ${memberError?.message}`)
  }
  commishTeamId = member.team_id
}, 120_000)

afterAll(async () => {
  await cleanup()
})

describe('the authoritative clock over PostgREST (migration 068)', () => {
  it('an all-timeout draft completes correctly with zero manual picks', async () => {
    // Start (real commissioner path — the D94 arm must not fire on the
    // future instant).
    const { data: started, error: startError } = await commishClient.rpc('draft_start', {
      p_league_id: leagueId,
    })
    expect(startError).toBeNull()
    const draft = (started as unknown as { draft: DraftRow }).draft
    expect(draft.status).toBe('live')
    expect(draft.total_rounds).toBe(ROUNDS)
    draftId = draft.id
    const order = draft.draft_order as string[]
    expect(order).toHaveLength(TEAM_COUNT)

    // The commissioner queues the worst-ADP player (the one sanctioned
    // client write — own queue): the queue source must beat ADP.
    const { error: queueError } = await commishClient.from('draft_queues').insert({
      draft_id: draftId,
      team_id: commishTeamId,
      player_id: QUEUED_PLAYER_ID,
      rank: 1,
    })
    expect(queueError).toBeNull()

    // Every seat times out: rewind the SERVER-written deadline past
    // deadline + grace (90s subtraction ⇒ ~60s past due on a 30s clock —
    // beyond the 30s grace even for the stale human commissioner), then
    // tick. One pick advances per tick per draft.
    for (let i = 0; i < TOTAL_PICKS + 5; i++) {
      const { data: row, error: readError } = await service
        .from('drafts')
        .select('status, current_deadline')
        .eq('id', draftId)
        .single()
      expect(readError).toBeNull()
      if (row?.status === 'complete') break
      expect(row?.current_deadline).not.toBeNull()
      const rewound = new Date(
        Date.parse(row!.current_deadline as string) - 90_000,
      ).toISOString()
      // `status='live'`-conditional — the F52(a) discharge (L.B7.1): under
      // full-run contention the live 5s cron can complete the FINAL pick
      // between the status read above and this write, and an unconditional
      // rewind then stamps a `current_deadline` onto a COMPLETE draft (the
      // batch-13 diagnosis — a harness race, not a product one). A 0-row
      // conditional rewind just re-loops, and the loop's own status read
      // exits on `complete`.
      const { error: rewindError } = await service
        .from('drafts')
        .update({ current_deadline: rewound })
        .eq('id', draftId)
        .eq('status', 'live')
      expect(rewindError).toBeNull()
      const { error: tickError } = await service.rpc('draft_tick')
      expect(tickError).toBeNull()
    }

    // The board completed.
    const { data: done } = await service
      .from('drafts')
      .select('status, completed_at, on_clock_team_id, current_deadline')
      .eq('id', draftId)
      .single()
    expect(done?.status).toBe('complete')
    expect(done?.completed_at).not.toBeNull()
    expect(done?.on_clock_team_id).toBeNull()
    expect(done?.current_deadline).toBeNull()

    // …correctly: 16 system picks, zero manual, snake order, full teams.
    const { data: picks } = await service
      .from('draft_picks')
      .select('pick_number, round, team_id, player_id, is_auto, made_via, picked_by, action_id')
      .eq('draft_id', draftId)
      .eq('is_undone', false)
      .order('pick_number')
    expect(picks).toHaveLength(TOTAL_PICKS)
    for (const p of picks ?? []) {
      expect(p.is_auto).toBe(true)
      expect(p.made_via).toBe('autopick')
      expect(p.picked_by).toBeNull()
      expect(p.action_id).toBeNull()
    }
    // Snake expansion of the AUTHORITATIVE stored order (round 1 forward,
    // round 2 reversed — no dropped or duplicated turns).
    expect((picks ?? []).map((p) => p.team_id)).toEqual(snakeExpansion(order, ROUNDS))
    expect((picks ?? []).map((p) => p.round)).toEqual([
      ...Array.from({ length: TEAM_COUNT }, () => 1),
      ...Array.from({ length: TEAM_COUNT }, () => 2),
    ])
    // No duplicate players (E1 held under pure system traffic).
    const players = (picks ?? []).map((p) => p.player_id)
    expect(new Set(players).size).toBe(TOTAL_PICKS)
    // F60's added DISCRIMINATION (L.C6.1 sweep; R315 — this suite was
    // green only because it never asserted fixture identity on an
    // ADP-resolved pick): with the fractional band the 15 ADP-resolved
    // picks are deterministically tk-wire-rb01..rb15 (best remaining adp,
    // walked over the WHOLE pool — restored or empty) and the queued
    // rb20 completes the set. A restored real pool capturing any pick
    // reds this line by name instead of passing silently.
    expect(new Set(players)).toEqual(
      new Set([...PLAYERS.slice(0, 15).map((p) => p.id), QUEUED_PLAYER_ID]),
    )
    // Every team drafted exactly `rounds` players.
    const byTeam = new Map<string, number>()
    for (const p of picks ?? []) byTeam.set(p.team_id, (byTeam.get(p.team_id) ?? 0) + 1)
    expect([...byTeam.values()]).toEqual(Array.from({ length: TEAM_COUNT }, () => ROUNDS))

    // The queue source beat ADP for the commissioner's round-1 pick
    // (§8.4/§7.3.8 queue_then_board_then_adp on the wire).
    const commishRound1 = (picks ?? []).find(
      (p) => p.team_id === commishTeamId && p.round === 1,
    )
    expect(commishRound1?.player_id).toBe(QUEUED_PLAYER_ID)

    // The completion transition (072/L.B1.7 — this pin held 'drafting' as
    // the cross-reference until 072 flipped it, exactly as promised): the
    // league lands 'in_season' with league_rosters populated from the
    // non-undone picks in the same txn (§8.5 step 6, D88) — verified at
    // the wire.
    const { data: league } = await service
      .from('leagues')
      .select('status, scoring_rules_snapshot')
      .eq('id', leagueId)
      .single()
    expect(league?.status).toBe('in_season')
    expect(league?.scoring_rules_snapshot).not.toBeNull() // D43 held at the flip

    const { data: rosters } = await service
      .from('league_rosters')
      .select('team_id, player_id, acquisition_type, acquisition_cost, slot_key')
      .eq('league_id', leagueId)
    expect(rosters).toHaveLength(TOTAL_PICKS)
    expect(new Set((rosters ?? []).map((r) => r.player_id)).size).toBe(TOTAL_PICKS)
    for (const r of rosters ?? []) {
      expect(r.acquisition_type).toBe('draft')
      expect(r.acquisition_cost).toBeNull() // snake — D88
      expect(r.slot_key).toBeNull() // M4's
    }
  }, 120_000)
})
