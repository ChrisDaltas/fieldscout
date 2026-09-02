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
 * a just-completed draft). R285: every fixture write/read in this file is
 * error-checked and THROWS — a failed cleanup or setup step must fail
 * loudly, never render as "no rows" or poison the next session (the
 * D114(7)/F53 swallow-vulnerable-cleanup class).
 *
 * Seats: 1 real commissioner (STALE — never heartbeats; every rewind jumps
 * past deadline + grace) + 7 placeholder seats (E48 autopilot, ADP).
 * Board: the commissioner's PRIMARY list ranks 5 fixture RBs carrying
 * `adp: NULL` — NULLS LAST in 068's source-4 walk puts them behind every
 * ADP'd row, so no ADP-driven seat (in this league or in ANY co-scheduled
 * suite) can ever reach them: a fixture pick is board-sourced by
 * construction (R286).
 *
 * THE PREMISE IS A PRESENCE, AND THE FIXTURE NOW MAKES IT TRUE (F70/F94 —
 * D235(5)'s sibling half). "Behind the ENTIRE real pool" was a claim about
 * a table this suite never populated. CI replays the migrations into an
 * EMPTY `players` (seed.sql inserts none), so the ADP'd pool did not exist
 * and the 7 placeholder seats walked straight onto the NULL-adp board,
 * eating it from the top; the commissioner's own board read then returned
 * whatever survived to its randomly-drawn slot. That is the whole content
 * of F70's "ordinal wander" — `draft_order_mode` here is `random`, so the
 * received id is `BOARD_ORDER[slot - 1]`, NOT a per-run counter (rb03 then
 * rb05 is slot 3 then slot 5), and once the 5-row board is gone the read
 * falls through to source 4 over whatever residue is in the table
 * (`vitest-lpd-p2`, F127). Its original `length 10 != 16` is the same
 * cause counted differently: 5 fixtures + 5 residue rows = 10 draftable
 * players for a 16-pick board. The DECOYS below are the ADP'd pool the
 * premise names, seeded here, in the same residency window as the board
 * and released with it.
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
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
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

/** 5 RBs, `adp: NULL` — the R286 redesign, and the design record:
 *
 *  The first cut owned the TOP of the global ADP space (0.01–0.20, below
 *  every real draft position) to make the walk deterministic. But 068's
 *  source-4 walk is GLOBAL (`ORDER BY adp NULLS LAST, id` over the SHARED
 *  players pool), so a dominating band captures every CO-SCHEDULED suite's
 *  autopick too: draft-realtime-db's forced-timeout pick (which asserts
 *  membership in ITS `adp: i + 1` fixture set) drew bap rows whenever the
 *  two suites' windows overlapped — a deterministic cross-suite failure
 *  (R286), made persistent by the then-swallowed cleanup (R285). No
 *  reachable band is safe: the walk is winner-take-all, an integer band
 *  just trades dominance for nondeterministic ties with real values
 *  (observed pre-band: three different adp-7 tie winners across runs), and
 *  fixtures can't be steered around source 4 either — 068 gates sources
 *  1–3 on `v_user IS NOT NULL`, so placeholder seats ALWAYS walk ADP.
 *
 *  `adp: NULL` is the one placement no walk can reach (NULLS LAST — behind
 *  the whole real pool). That makes the board discrimination STRONGER (any
 *  fixture pick MUST be the board speaking), at the price of
 *  data-dependent ADP picks elsewhere on the sheet — so the demote-arm
 *  assert below is STRUCTURAL rather than an exact-id pin, and only the 5
 *  board players exist at all (20 → 5). The durable ADP-space /
 *  suite-isolation design (no fixture band is safe by construction; ADP
 *  seats still draw shared-pool rows) is F52's → the L.B7.1 sweep. */
const PLAYERS = Array.from({ length: 5 }, (_, i) => ({
  id: `bap-wire-rb${String(i + 1).padStart(2, '0')}`,
  full_name: `BAP Wire RB ${String(i + 1).padStart(2, '0')}`,
  position: 'RB',
  adp: null,
}))
/** Board rank order = fixture order; the board's #1 is the round-1 proof,
 *  its #2 the demote-arm control (nothing but a board read can reach it). */
const BOARD_ORDER = PLAYERS.map((p) => p.id)
const BOARD_NEXT = BOARD_ORDER[1] as string

/** THE DECOY POOL — the ADP'd rows the 7 placeholder seats (and the
 *  demoted commissioner's round-2 pick) are meant to eat, so nothing but a
 *  primary-board read can reach a NULL-adp fixture. 15 of this board's 16
 *  picks are ADP-sourced; 32 rows is that with headroom, and the mix covers
 *  the forced RB need in round 1 (7 seats) plus an open-mode bench round.
 *
 *  BAND — 9100+, ABOVE the real pool (measured 2026-08-26 on the dev stack:
 *  1074 players, 549 with ADP, min 1.6, MAX 700.9) and above every fixture
 *  band in the repo (F110/D235's `(0, 1)`, the `/100` bands). The direction
 *  is deliberate and it is what F94's measured extension demands:
 *  `draft_mock_cpu_bid_value` ranks a player as
 *  `count(*) WHERE adp IS NOT NULL AND adp < v_adp`, so a row placed BELOW
 *  the real pool shifts every other suite's CPU seed, while a row placed
 *  ABOVE it shifts none. Locally these are never reached (549 real ADP'd
 *  rows sit in front of them), so this suite's local behavior is exactly
 *  what it was; in CI, where the real pool does not exist, they ARE the
 *  pool. Either way the board is unreachable — the only property the
 *  assertions below rest on. */
const DECOY_POSITIONS = [
  ...Array.from({ length: 16 }, () => 'RB'),
  ...Array.from({ length: 8 }, () => 'WR'),
  ...Array.from({ length: 4 }, () => 'TE'),
  ...Array.from({ length: 4 }, () => 'QB'),
]
const DECOYS = DECOY_POSITIONS.map((position, i) => ({
  id: `bap-decoy-${String(i + 1).padStart(2, '0')}`,
  full_name: `BAP Decoy ${position} ${String(i + 1).padStart(2, '0')}`,
  position,
  adp: 9100 + i + 1,
}))

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

/** R285: the one error gate every fixture write/read goes through. */
function throwIfError(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what} failed: ${error.message}`)
}

async function deleteUserByUsername(username: string): Promise<void> {
  const { data, error } = await service.from('profiles').select('id').eq('username', username)
  throwIfError(error, `cleanup: profile lookup for ${username}`)
  for (const row of data ?? []) {
    const { error: deleteError } = await service.auth.admin.deleteUser(row.id)
    if (deleteError) throw new Error(`cleanup: deleteUser ${row.id} failed: ${deleteError.message}`)
  }
}

/** Release every SHARED-POOL row this suite owns — league graph first (the
 *  NO ACTION player FKs on draft_picks/draft_queues/league_rosters must be
 *  gone before the players delete can succeed; list_players cascades from
 *  players), then the fixture players. R285: every step throws — a failed
 *  release must fail THIS run loudly, never poison the next session. */
async function releaseSharedRows(): Promise<void> {
  const { data: stale, error: staleError } = await service
    .from('leagues')
    .select('id')
    .eq('name', LEAGUE_NAME)
  throwIfError(staleError, 'cleanup: stale-league lookup')
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    const { error: draftsError } = await service.from('drafts').delete().in('league_id', ids)
    throwIfError(draftsError, 'cleanup: drafts delete')
    // 110/L.D1.2: completion now writes matchups + league_weeks (the schedule) — both reference teams/leagues, so the league graph releases them FIRST (a fixture change forced by 110, not a drive-by).
    const { error: matchupsError } = await service.from('matchups').delete().in('league_id', ids)
    throwIfError(matchupsError, 'cleanup: matchups delete')
    const { error: weeksError } = await service.from('league_weeks').delete().in('league_id', ids)
    throwIfError(weeksError, 'cleanup: league_weeks delete')
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    throwIfError(teamsError, 'cleanup: teams delete')
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    throwIfError(leaguesError, 'cleanup: leagues delete')
  }
  const { error: playersError } = await service
    .from('players')
    .delete()
    .in(
      'id',
      [...PLAYERS, ...DECOYS].map((p) => p.id),
    )
  throwIfError(playersError, 'cleanup: players delete')
}

async function cleanup(): Promise<void> {
  await releaseSharedRows()
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
  const { error: rewindError } = await service
    .from('drafts')
    .update({ current_deadline: rewound })
    .eq('id', draftId)
    .eq('status', 'live')
  throwIfError(rewindError, 'deadline rewind')
  const { error: tickError } = await service.rpc('draft_tick')
  if (tickError) throw new Error(`draft_tick failed: ${tickError.message}`)
  const { data: after, error: afterError } = await service
    .from('drafts')
    .select('status')
    .eq('id', draftId)
    .single()
  throwIfError(afterError, 'post-tick status read')
  return after?.status ?? 'unknown'
}

async function readPicks(): Promise<PickRow[]> {
  const { data, error } = await service
    .from('draft_picks')
    .select('pick_number, round, team_id, player_id, is_auto, made_via')
    .eq('draft_id', draftId)
    .eq('is_undone', false)
    .order('pick_number')
  throwIfError(error, 'picks read')
  return (data ?? []) as PickRow[]
}

beforeAll(async () => {
  await cleanup()
  // F215 / migration 110: draft completion maps the league onto the NFL
  // calendar at the call instant — this suite creates its league on a
  // SYNTHETIC season so the mapping never depends on the wall clock.
  await seedSyntheticSeason(service)
  const { data: user, error: userError } = await service.auth.admin.createUser({
    email: COMMISH.email,
    password: COMMISH.password,
    email_confirm: true,
    user_metadata: { username: COMMISH.username },
  })
  if (userError) throw new Error(`createUser failed: ${userError.message}`)
  commishId = user.user.id
  commishClient = await signIn(COMMISH)

  const settings = defaultsForTeamCount(TEAM_COUNT)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [`p_${key}`, value]),
  )
  const { data: template, error: templateError } = await commishClient
    .from('scoring_systems')
    .select('id')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  throwIfError(templateError, 'scoring-template lookup')
  const { data: created, error: createError } = await commishClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: SYNTHETIC_SEASON, // F215: the fixture owns its calendar (migration 110 maps completion onto nfl_weeks)
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
}, 120_000)

afterAll(async () => {
  // The belt behind the test body's own finally-release (R286) — a no-op
  // on the happy path, and it also retires the fixture USER.
  await cleanup()
})

describe('§8.9 autopick tie-in over the real tick (L.B4.2)', () => {
  it('attach-as-primary via the §15.5 service → the timeout pick honors the board; demote → the same seat falls to ADP', async () => {
    try {
      // 0. R286: the fixtures' shared-pool existence window opens HERE —
      //    not in beforeAll — and closes in the finally right behind the
      //    last assert (even on an assertion-failure path): minimal
      //    residency in the pool every db suite walks.
      const { error: upsertError } = await service.from('players').upsert([...PLAYERS])
      throwIfError(upsertError, 'players upsert')
      const { error: decoyError } = await service.from('players').upsert([...DECOYS])
      throwIfError(decoyError, 'decoy pool upsert')

      // 0b. THE PREMISE, ASSERTED (F70/F94; D235(5)'s sibling half — a
      //     fixture whose premise is a PRESENCE must make that presence
      //     true within its own fixture). Every assertion below rests on
      //     "the NULL-adp board is behind every ADP'd row", which is a
      //     property of the TABLE, not of this file. It holds iff the ADP'd
      //     pool outlasts this board's ADP-sourced picks (15 of 16 — the 7
      //     placeholders twice, plus the demoted commissioner's round 2).
      //     On an empty pool this read is 0 and the failure lands HERE,
      //     naming its reason, instead of 200 lines later as a confusing
      //     `expected 'vitest-lpd-p2' to be 'bap-wire-rb01'`.
      const { count: adpPool, error: adpPoolError } = await service
        .from('players')
        .select('id', { count: 'exact', head: true })
        .not('adp', 'is', null)
      throwIfError(adpPoolError, 'ADP-pool premise read')
      expect(
        adpPool ?? 0,
        "PREMISE: the ADP walk must hold more ADP'd players than this board has picks, or the " +
          'placeholder seats eat the NULL-adp board and every assertion below is about the ' +
          'wrong thing (F70/F94 — the DECOYS above exist to make this true)',
      ).toBeGreaterThanOrEqual(TOTAL_PICKS)

      // The commissioner's ranked list, made through the ordinary client
      // write path (own list + list_players — the lists surface the attach
      // modal offers). Lives inside the window: list_players FKs the
      // fixture rows.
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

      // 1. The UI's own attach path (the attach modal's service call):
      //    attach the list AS PRIMARY.
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
      //    pick can't be the queue speaking — source 1 is empty). R285:
      //    an ERRORED read must not render as "no rows" — that would pass
      //    this step for exactly the wrong reason.
      const { data: queueRows, error: queueError } = await service
        .from('draft_queues')
        .select('id')
        .eq('draft_id', draftId)
        .eq('team_id', commishTeamId)
      throwIfError(queueError, 'queue read')
      expect(queueRows ?? []).toHaveLength(0)

      // 4. Tick until the commissioner's ROUND-1 pick lands (every seat
      //    times out; placeholders resolve to ADP over the live pool).
      for (let i = 0; i < TEAM_COUNT + 3; i++) {
        const picks = await readPicks()
        if (picks.some((p) => p.team_id === commishTeamId && p.round === 1)) break
        const status = await rewindAndTick()
        if (status === 'complete') break
      }
      const round1 = (await readPicks()).find(
        (p) => p.team_id === commishTeamId && p.round === 1,
      )
      // §8.9: "if the user set a primary draft board, autopick uses it
      // before the generic Big Board" — the board's #1 carries adp NULL,
      // behind every ADP'd row, so no other source could have produced it.
      //
      // The message carries the commissioner's DRAW — F70's own standing
      // request (capture before reasoning). `draft_order_mode` is `random`
      // here, and on an under-populated pool the received id is exactly
      // `BOARD_ORDER[slot - 1]`; printing the slot is what turns the next
      // red from "unexplained wander" into an arithmetic statement.
      const { data: orderRow, error: orderError } = await service
        .from('drafts')
        .select('draft_order')
        .eq('id', draftId)
        .single()
      throwIfError(orderError, 'draft_order read')
      const slot = ((orderRow?.draft_order as string[] | null) ?? []).indexOf(commishTeamId) + 1
      expect(
        round1?.player_id,
        `board-sourced round-1 pick (commissioner drew slot ${slot} of ${TEAM_COUNT}; a received ` +
          "BOARD_ORDER[slot - 1] means ADP seats ate the board — check the ADP'd pool)",
      ).toBe(BOARD_ORDER[0])
      expect(round1?.is_auto).toBe(true)
      expect(round1?.made_via).toBe('autopick')

      // 5. DEMOTE mid-draft through the panel's PATCH surface: the flag —
      //    not the attachment — is the autopick driver.
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

      // 7. The commissioner's ROUND-2 pick ignored the demoted board. The
      //    assert is STRUCTURAL, not an exact-id pin (R286: the ADP
      //    fallback walks the LIVE shared pool, whose winner is
      //    data-dependent): (a) the pick is NOT a fixture — NULL-adp
      //    fixtures are unreachable by every non-board source, so only a
      //    board read could produce one; (b) the board's NEXT entry was
      //    still available the whole time (nothing else can reach it), so
      //    a primary-board read WOULD have taken it; (c) the picked player
      //    carries a real ADP — the source-4 signature (queue was asserted
      //    empty at start, the seat owns no big-board list, and §8.4's
      //    priority order itself is pinned in pgTAP 022).
      const round2 = picks.find((p) => p.team_id === commishTeamId && p.round === 2)
      expect(round2).toBeDefined()
      expect(round2?.is_auto).toBe(true)
      expect(round2?.made_via).toBe('autopick')
      const fixtureIds = new Set(PLAYERS.map((p) => p.id))
      expect(fixtureIds.has(round2!.player_id)).toBe(false)
      expect(round2?.player_id).not.toBe(BOARD_NEXT)
      const takenBefore = new Set(
        picks.filter((p) => p.pick_number < round2!.pick_number).map((p) => p.player_id),
      )
      expect(takenBefore.has(BOARD_NEXT)).toBe(false)
      const { data: picked, error: pickedError } = await service
        .from('players')
        .select('adp')
        .eq('id', round2!.player_id)
        .single()
      throwIfError(pickedError, 'round-2 player read')
      expect(picked?.adp).not.toBeNull()
      // Exactly ONE fixture on the whole sheet: the round-1 board pick.
      // (NULL-adp fixtures are invisible to every ADP walk — here and in
      // every co-scheduled suite; the R286 pin.)
      expect(picks.filter((p) => fixtureIds.has(p.player_id))).toHaveLength(1)

      // The league completed normally behind the demotion (no side
      // effects on the engine from the list surface).
      const { data: league, error: leagueError } = await service
        .from('leagues')
        .select('status')
        .eq('id', leagueId)
        .single()
      throwIfError(leagueError, 'league status read')
      expect(league?.status).toBe('in_season')
    } finally {
      // R286: close the shared-pool window HERE — league graph first, then
      // the fixture players — even when an assert above failed. Loud
      // (R285); the afterAll belt re-runs it as a no-op plus user cleanup.
      await releaseSharedRows()
    }
  }, 120_000)
})
