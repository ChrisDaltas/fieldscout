/**
 * draft-board-autopick-db.test.ts — L.B4.2 item 3: the §8.9 AUTOPICK TIE-IN
 * proven end-to-end against the REAL tick. pgTAP 022 already pins the §8.4
 * source priority at the SQL layer; this suite is the CONSUMER proof — the
 * UI's own attach path (the §15.5 service the attach modal drives) sets a
 * primary board, the draft times out, and 068's `draft_tick` picks from
 * that board (queue empty, ADP present as the tempting wrong answer), then
 * a mid-draft DEMOTE (the panel's set-primary/PATCH surface) flips the same
 * seat back to ADP — `is_primary_board` is the driver, falsifiable alone.
 *
 * HARNESS (D100): timeouts come from service-role `current_deadline`
 * rewinds between direct draft_tick() calls — production RPCs never accept
 * a caller clock; rewinds SUBTRACT from the server-written deadline (no
 * wall-clock — the D3/D17 guard covers this file). The rewind is
 * `status='live'`-CONDITIONAL (the F52 family's draft-tick-db lesson: the
 * concurrent 5s cron is a legal actor and an unconditional rewind can race
 * a just-completed draft).
 *
 * Seats: 1 real commissioner (STALE — never heartbeats; every rewind jumps
 * past deadline + grace) + 7 placeholder seats (E48 autopilot, ADP).
 * Board: the commissioner's PRIMARY list ranks the five WORST-ADP players
 * first — no ADP-driven seat reaches them in 16 picks, so a board-sourced
 * pick is unmistakable.
 *
 * Requires the local stack — D59(5); FAILS loudly when the stack is down,
 * never skips (§4.3). Fixture prefixes: username `bap_`, players
 * `bap-wire-rb*`, action ids `af2` (D108(14) registry — af0 members-api,
 * af1 league-lists-api).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { attachLeagueList, patchLeagueList } from './league-lists-service'
import { patchLeague } from './leagues-service'
import { addPlaceholderSeat } from './members-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-board-autopick-league'
/** Future instant (the D94 arm must not fire; this suite starts manually).
 *  Far-future per F49's fixture-instant discipline. */
const DRAFT_INSTANT = '2027-09-02T17:00:00+00:00'
const TEAM_COUNT = 8
const ROUNDS = 2
const TOTAL_PICKS = TEAM_COUNT * ROUNDS

const COMMISH = {
  email: 'board-autopick-commish@fieldscout.test',
  password: 'pgtap-bap-pass-1',
  username: 'bap_wire_commish',
}

/** 20 RBs, adp 0.01..0.20 — DELIBERATELY below every real player's ADP
 *  (a real ADP is a draft position, ≥ 1): the local stack carries the full
 *  real player pool, and integer fixture ADPs interleaved/tied with real
 *  values (observed live: the commissioner's round-2 resolve drew a
 *  different adp-7 tie winner per run — '9488' vs '6813' vs rb07). Owning
 *  the top of the ADP space outright makes the walk deterministic:
 *  fixtures only, in order. */
const PLAYERS = Array.from({ length: 20 }, (_, i) => ({
  id: `bap-wire-rb${String(i + 1).padStart(2, '0')}`,
  full_name: `BAP Wire RB ${String(i + 1).padStart(2, '0')}`,
  position: 'RB',
  adp: (i + 1) / 100,
}))
/** The primary board ranks the five WORST-ADP players first — unreachable
 *  by any ADP-driven seat inside 16 picks. */
const BOARD_ORDER = ['bap-wire-rb20', 'bap-wire-rb19', 'bap-wire-rb18', 'bap-wire-rb17', 'bap-wire-rb16']

const ACTION = { create: 'af200000-0000-4000-8000-000000000001' } as const

type DraftRow = Database['public']['Tables']['drafts']['Row']
type PickRow = {
  pick_number: number
  round: number
  team_id: string
  player_id: string
  is_auto: boolean
  made_via: string | null
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let commishId: string
let leagueId: string
let draftId: string
let commishTeamId: string
let boardListId: string
let attachmentId: string

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
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/** Rewind the SERVER-written deadline past deadline + grace, LIVE-gated
 *  (the F52 lesson: never race the cron on a just-completed draft), then
 *  tick directly. Returns the draft's status after the pass. */
async function rewindAndTick(): Promise<string> {
  const { data: row, error } = await service
    .from('drafts')
    .select('status, current_deadline')
    .eq('id', draftId)
    .single()
  if (error) throw new Error(`draft read failed: ${error.message}`)
  if (row.status !== 'live' || !row.current_deadline) return row.status
  const rewound = new Date(Date.parse(row.current_deadline) - 90_000).toISOString()
  await service
    .from('drafts')
    .update({ current_deadline: rewound })
    .eq('id', draftId)
    .eq('status', 'live')
  const { error: tickError } = await service.rpc('draft_tick')
  if (tickError) throw new Error(`draft_tick failed: ${tickError.message}`)
  const { data: after } = await service.from('drafts').select('status').eq('id', draftId).single()
  return after?.status ?? 'unknown'
}

async function readPicks(): Promise<PickRow[]> {
  const { data } = await service
    .from('draft_picks')
    .select('pick_number, round, team_id, player_id, is_auto, made_via')
    .eq('draft_id', draftId)
    .eq('is_undone', false)
    .order('pick_number')
  return (data ?? []) as PickRow[]
}

beforeAll(async () => {
  await cleanup()
  const { data: user, error: userError } = await service.auth.admin.createUser({
    email: COMMISH.email,
    password: COMMISH.password,
    email_confirm: true,
    user_metadata: { username: COMMISH.username },
  })
  if (userError) throw new Error(`createUser failed: ${userError.message}`)
  commishId = user.user.id
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
    p_season: 2026,
    p_scoring_system_id: template?.id,
    p_team_name: 'BAP Commish Team',
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

  // Tiny board (D91: 1 RB starter + 1 bench = 2 rounds), 30s clock/grace.
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

  // The commissioner's ranked list, made through the ordinary client write
  // path (own list + list_players — the lists surface the attach modal
  // offers).
  const { data: list, error: listError } = await commishClient
    .from('lists')
    .insert({
      owner_id: commishId,
      title: 'bap wire board',
      slug: 'bap-wire-board',
      is_private: true,
    })
    .select('id')
    .single()
  if (listError) throw new Error(`list insert failed: ${listError.message}`)
  boardListId = list.id
  const { error: lpError } = await commishClient.from('list_players').insert(
    BOARD_ORDER.map((playerId, index) => ({
      list_id: boardListId,
      player_id: playerId,
      position: index + 1,
      overall_rank: index + 1,
    })),
  )
  if (lpError) throw new Error(`list_players insert failed: ${lpError.message}`)
}, 120_000)

afterAll(async () => {
  await cleanup()
})

describe('§8.9 autopick tie-in over the real tick (L.B4.2)', () => {
  it('attach-as-primary via the §15.5 service → the timeout pick honors the board; demote → the same seat falls to ADP', async () => {
    // 1. The UI's own attach path (the attach modal's service call): attach
    //    the list AS PRIMARY.
    const attached = await attachLeagueList(commishClient, leagueId, commishId, {
      list_id: boardListId,
      is_primary_board: true,
    })
    expect(attached.status).toBe(201)
    attachmentId = (attached.body as unknown as { id: string }).id

    // 2. Start (manual path; the instant is far-future so D94 stays quiet).
    const { data: started, error: startError } = await commishClient.rpc('draft_start', {
      p_league_id: leagueId,
    })
    expect(startError).toBeNull()
    const draft = (started as unknown as { draft: DraftRow }).draft
    expect(draft.status).toBe('live')
    draftId = draft.id

    // 3. NO queue rows for the seat (the discriminator: a board-sourced
    //    pick can't be the queue speaking — source 1 is empty).
    const { data: queueRows } = await service
      .from('draft_queues')
      .select('id')
      .eq('draft_id', draftId)
      .eq('team_id', commishTeamId)
    expect(queueRows ?? []).toHaveLength(0)

    // 4. Tick until the commissioner's ROUND-1 pick lands (every seat times
    //    out; placeholders resolve to ADP).
    for (let i = 0; i < TEAM_COUNT + 3; i++) {
      const picks = await readPicks()
      if (picks.some((p) => p.team_id === commishTeamId && p.round === 1)) break
      const status = await rewindAndTick()
      if (status === 'complete') break
    }
    const round1 = (await readPicks()).find(
      (p) => p.team_id === commishTeamId && p.round === 1,
    )
    // §8.9: "if the user set a primary draft board, autopick uses it before
    // the generic Big Board" — the board's #1 (worst ADP in the pool, so no
    // other source could have produced it).
    expect(round1?.player_id).toBe(BOARD_ORDER[0])
    expect(round1?.is_auto).toBe(true)
    expect(round1?.made_via).toBe('autopick')

    // 5. DEMOTE mid-draft through the panel's PATCH surface: the flag — not
    //    the attachment — is the autopick driver.
    const demoted = await patchLeagueList(commishClient, leagueId, attachmentId, commishId, {
      is_primary_board: false,
    })
    expect(demoted.status).toBe(200)

    // 6. Run the draft to completion.
    for (let i = 0; i < TOTAL_PICKS + 5; i++) {
      const status = await rewindAndTick()
      if (status === 'complete') break
    }
    const picks = await readPicks()
    expect(picks).toHaveLength(TOTAL_PICKS)

    // 7. The commissioner's ROUND-2 pick ignored the demoted board: it is
    //    the lowest-ADP player still available at that pick (computed from
    //    the recorded sheet — deterministic whatever the random order was),
    //    and NOT the board's next entry.
    const round2 = picks.find((p) => p.team_id === commishTeamId && p.round === 2)
    expect(round2).toBeDefined()
    const takenBefore = new Set(
      picks.filter((p) => p.pick_number < round2!.pick_number).map((p) => p.player_id),
    )
    const adpBest = PLAYERS.map((p) => p.id).find((id) => !takenBefore.has(id))
    expect(round2?.player_id).toBe(adpBest)
    // The board's next entry (rb19) was still available — a primary-board
    // read would have taken it. (rb20 went to the seat in round 1; rb19
    // is unreachable by ADP in 16 picks.)
    expect(round2?.player_id).not.toBe(BOARD_ORDER[1])
    expect(takenBefore.has(BOARD_ORDER[1] as string)).toBe(false)

    // The league completed normally behind the demotion (no side effects on
    // the engine from the list surface).
    const { data: league } = await service
      .from('leagues')
      .select('status')
      .eq('id', leagueId)
      .single()
    expect(league?.status).toBe('in_season')
  }, 120_000)
})
