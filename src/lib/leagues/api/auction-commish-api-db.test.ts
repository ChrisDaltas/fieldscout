/**
 * auction-commish-api-db.test.ts — L.C2.2 at the WIRE layer: the §15.2
 * AUCTION commissioner routes (the C40 erratum — `reverseWonBid` /
 * `adjustBudget` / `cancelNomination` / `endDraft`) plus 087's priced and
 * timer arms riding the EXISTING verbs (`reassignPick` / `movePlayer` with
 * `price`; `setClock` with the auction timers; `patchDraftOrder` editing
 * `nomination_order`), driven over the LOCAL stack through PostgREST by real
 * signed-in users — the exact composition the Route Handlers run (the D68
 * wire-suite convention; pgTAP 036 owns the RPC-side matrices, and
 * `auction-commish-db.test.ts` drives the RPCs bare). Same shape as
 * `draft-commish-api-db.test.ts` (the L.B2.3 suite).
 *
 * What this suite owns (tasks-M3 L.C2.2 items 1–3):
 *   - the per-route AUTH SWEEP: a plain manager answers 403 on every auction
 *     verb (§17 row "Draft: pause/undo/reassign/move/reset — Manager: —");
 *     an outsider answers the no-leak 404 (R155 class);
 *   - `reason` REQUIRED on all four (missing / blank → 400) and STORED
 *     NOWHERE (F32/F40: the literal appears in no `league_chat` post, the
 *     drafts row carries it nowhere, and the audit table still does not
 *     exist — each landed control grows `league_chat` by EXACTLY one row,
 *     the D97 post);
 *   - the D138 MOCK refusal passing through with the RPC's exact copy;
 *   - the D141 LIVE refusal passing through with the RPC's exact copy
 *     (byte-compared) for the two gated new verbs, and the NOT-gated posture
 *     of budget (lands LIVE) and end (terminal);
 *   - the ONE-UNIT E28 arm-3 pin (D131(4)/D146): a budget cut that leaves
 *     max_bid EXACTLY equal to the standing high bid LANDS; one dollar more
 *     is refused with the arm-3 copy verbatim, and the DB proves the refused
 *     write rolled back (`budget_adjustments` unchanged);
 *   - happy paths with DB corroboration: the budget map after adjust; the
 *     voided row (D162) + the un-consumed sequence number (D143) after
 *     cancel; the priced reassign/move landing on the pick row with its
 *     price; the reversed pick's `is_undone` + the refund BY DERIVATION
 *     (D127 — read back through 084's `draft_team_budget`); `in_season` +
 *     priced `league_rosters` after end (C41);
 *   - the auction timers through the clock route (087's arm; an auction
 *     refuses the pick clock) and `nomination_order` through the PATCH.
 *
 * LIVE-CRON SAFETY (the 022/068 concurrent-actor rule): 120s nomination /
 * 60s bid clocks (the validator's ceilings) and every live bidding window
 * is seconds of route calls or frozen by a pause — no timeout lands
 * mid-test; the awards below are driven by an explicit 240s rewind + direct
 * tick. `cpu_speed: 'realistic'` on the mock
 * (it exists only to be refused), far-future `draft_scheduled_at` (F49).
 * Deadline rewinds SUBTRACT from the SERVER-written deadline; no wall clock
 * is read (the D3/D17 ESLint guard covers this file).
 *
 * FIXTURE ADP IS FRACTIONAL (R286 / ledger F60): the real player pool is
 * restored when `npm run test` runs and 068's ADP arm orders the whole table.
 *
 * Requires the local stack — D59(5); FAILS loudly when the stack is down,
 * never skips (§4.3). Determinism: fixed emails/usernames/action-ids (prefix
 * ac2 — ac1 is `auction-commish-db.test.ts`; the D108(14)/D114(10)
 * registry), fixed player fixtures, cleanup-first. Fixture names are unique
 * to this suite (`acapi_*`, `vitest-auction-commish-api-league`,
 * `acapi-rb*`) — the D114(7) lesson.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import {
  adjustBudget,
  cancelNomination,
  endDraft,
  launchMockDraft,
  movePlayer,
  patchDraftOrder,
  pauseOrResumeDraft,
  reassignPick,
  reverseWonBid,
  setClock,
  startDraft,
} from './draft-service'
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

const LEAGUE_NAME = 'vitest-auction-commish-api-league'
/** F49: far future — the live cron auto-starts COMMITTED scheduled leagues
 *  whose stored instant has passed. This suite starts the draft itself. */
const DRAFT_INSTANT = '2028-09-01T17:00:00+00:00'
const TEAM_COUNT = 8
/** D91 draftable slots after the roster override below (1 starter + 1 bench)
 *  — the auction's per-team roster CAPACITY (D126). */
const SLOTS_PER_TEAM = 2
const AUCTION_BUDGET = 200
const AUCTION_MIN_BID = 1
/** Both auction clocks at the settings validator's CEILING (120s / 60s —
 *  league-settings.ts) — every live bidding window below is sub-10s of
 *  route calls or is frozen by a pause, so no cron award lands mid-test
 *  (the awards below are explicit rewind + tick). */
const NOMINATION_SECONDS = 120
const BID_SECONDS = 60
const ANTI_SNIPE_SECONDS = 10
const GRACE_SECONDS = 30
/** Rewind past BOTH clocks + grace: 120 + 30, with margin. */
const REWIND_MS = 240_000

/** The commissioner's OPENING bid on the one-unit fixture — legal (≤ the
 *  fresh max bid of 199) and far enough from the floor that the arm-3 cut
 *  below is unambiguous. */
const HIGH_BID = 150
/** §8.6.1: max_bid = remaining − (open_slots − 1) × min_bid. Fresh:
 *  200 − 1 = 199. A delta d gives max_bid' = 199 + d, so the cut that leaves
 *  max_bid EXACTLY equal to the $150 high bid is d = 150 − 199 = −49 — the
 *  D146 boundary: −49 lands, one more dollar (−50 total) is refused. */
const EXACT_CUT = HIGH_BID - (AUCTION_BUDGET - (SLOTS_PER_TEAM - 1) * AUCTION_MIN_BID)
const ONE_MORE_DOLLAR = -1

const COMMISH = {
  email: 'auction-commish-api-commish@fieldscout.test',
  password: 'pgtap-acapi-pass-1',
  username: 'acapi_wire_commish',
}
const MGR2 = {
  email: 'auction-commish-api-mgr2@fieldscout.test',
  password: 'pgtap-acapi-pass-2',
  username: 'acapi_wire_mgr_two',
}
const OUTSIDER = {
  email: 'auction-commish-api-outsider@fieldscout.test',
  password: 'pgtap-acapi-pass-3',
  username: 'acapi_wire_outsider',
}
const COMMISH_TEAM_NAME = 'ACAPI Commish'

/** 12 RBs at adp 0.001…0.012 — below every real ADP (see the header). */
const PLAYERS = Array.from({ length: 12 }, (_, i) => ({
  id: `acapi-rb${String(i + 1).padStart(2, '0')}`,
  full_name: `ACAPI RB ${String(i + 1).padStart(2, '0')}`,
  position: 'RB',
  adp: (i + 1) / 1000,
}))
const [P1, P2, P3, P4] = PLAYERS.map((p) => p.id)

const ACTION = {
  create: 'ac200000-0000-4000-8000-000000000001',
  mockLaunch: 'ac200000-0000-4000-8000-000000000011',
  nominate1: 'ac200000-0000-4000-8000-000000000021',
  nominate2: 'ac200000-0000-4000-8000-000000000022',
  nominate3: 'ac200000-0000-4000-8000-000000000023',
  nominate4: 'ac200000-0000-4000-8000-000000000024',
} as const

/** A syntactically valid uuid that is no pick of any draft. */
const NO_SUCH_PICK = 'ac2fffff-0000-4000-8000-00000000dead'

type DraftRow = Database['public']['Tables']['drafts']['Row']
type PickRow = Database['public']['Tables']['draft_picks']['Row']
interface DraftBody {
  draft: DraftRow
  created?: boolean
}
interface LiveNomination {
  player_id: string
  high_bid: number
  high_bidder_team_id: string
}
interface BudgetRow {
  remaining: number
  open_slots: number
  max_bid: number
  committed: number
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let mgr2Client: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let leagueId: string
let draftId: string
let mockId: string
let commishTeamId: string
let mgr2TeamId: string
let placeholderIds: string[] = []

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

/** Orphan heal (D114(7)): a swallowed `profiles_username_key` collision can
 *  mint an auth user with NO profile row, invisible to the cleanup above. */
async function deleteOrphanByCredentials(user: {
  email: string
  password: string
}): Promise<void> {
  const probe = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { data, error } = await probe.auth.signInWithPassword(user)
  if (error || !data.user) {
    throw new Error(
      `orphan heal failed for ${user.email}: cannot recover the auth id ` +
        `(sign-in said: ${error?.message ?? 'no user'})`,
    )
  }
  const { error: deleteError } = await service.auth.admin.deleteUser(data.user.id)
  if (deleteError) {
    throw new Error(`orphan delete failed for ${user.email}: ${deleteError.message}`)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').eq('name', LEAGUE_NAME)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    await service.from('league_rosters').delete().in('league_id', ids)
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

async function createUser(user: {
  email: string
  password: string
  username: string
}): Promise<string> {
  const attempt = () =>
    service.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { username: user.username },
    })
  let { data, error } = await attempt()
  if (error?.message.includes('already been registered')) {
    await deleteOrphanByCredentials(user)
    ;({ data, error } = await attempt())
  }
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  const created = data.user
  if (!created) throw new Error(`createUser returned no user for ${user.email}`)
  const { data: profile } = await service
    .from('profiles')
    .select('id')
    .eq('id', created.id)
    .maybeSingle()
  if (!profile) {
    throw new Error(
      `signup trigger created NO profile for ${user.email} — ` +
        'a swallowed profiles_username_key collision (stale fixture user?)',
    )
  }
  return created.id
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

async function readDraft(): Promise<DraftRow> {
  const { data, error } = await service.from('drafts').select('*').eq('id', draftId).single()
  if (error) throw new Error(`draft read failed: ${error.message}`)
  return data as DraftRow
}

/** The ONE budget authority (084/D127), read as the engine reads it. */
async function budgetOf(teamId: string): Promise<BudgetRow> {
  const { data, error } = await service.rpc('draft_team_budget', {
    p_draft_id: draftId,
    p_team_id: teamId,
  })
  if (error) throw new Error(`draft_team_budget(${teamId}) failed: ${error.message}`)
  return (data as unknown as BudgetRow[])[0]
}

/** System posts for THIS draft (the D97 trail) — count + messages. */
async function systemPosts(): Promise<string[]> {
  const { data, error } = await service
    .from('league_chat')
    .select('message')
    .eq('context', `draft:${draftId}`)
    .eq('is_system', true)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`league_chat read failed: ${error.message}`)
  return (data ?? []).map((p) => p.message)
}

/**
 * Rewind the SERVER-written deadline past both clocks + grace and tick once.
 * `status='live'`-conditional (F52(a)): the 5s cron is a legal concurrent
 * actor and can move the board between the read and the write.
 */
async function rewindAndTick(): Promise<void> {
  const draft = await readDraft()
  if (draft.status === 'live') {
    if (draft.current_deadline === null) {
      throw new Error('a live auction with a NULL deadline — the clock cannot be advanced')
    }
    const rewound = new Date(Date.parse(draft.current_deadline) - REWIND_MS).toISOString()
    const { error: rewindError } = await service
      .from('drafts')
      .update({ current_deadline: rewound })
      .eq('id', draftId)
      .eq('status', 'live')
    expect(rewindError).toBeNull()
  }
  const { error } = await service.rpc('draft_tick')
  expect(error).toBeNull()
}

/** Nominate through the RPC directly — fixture setup only. The nominate
 *  ROUTE is L.C2.1's and is deliberately not touched by this suite. */
async function nominate(
  client: SupabaseClient<Database>,
  playerId: string,
  openingBid: number,
  actionId: string,
): Promise<void> {
  const { error } = await client.rpc('draft_nominate', {
    p_draft_id: draftId,
    p_player_id: playerId,
    p_opening_bid: openingBid,
    p_action_id: actionId,
  })
  if (error) throw new Error(`draft_nominate(${playerId}, $${openingBid}) failed: ${error.message}`)
}

/** Stub entropy for patchDraftOrder calls that never randomize. */
const noEntropy = { randomValues: () => [] as number[] }

const MOCK_REFUSAL = (verb: string) =>
  `${verb}: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)`
const PAUSE_FIRST = (verb: string) =>
  `${verb}: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)`

beforeAll(async () => {
  await cleanup()
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
    p_season: 2026,
    p_scoring_system_id: template?.id,
    p_team_name: COMMISH_TEAM_NAME,
    p_action_id: ACTION.create,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  // mgr2's seat (a REAL second manager — the §17 auth sweep needs one), then
  // six placeholders.
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
  placeholderIds = []
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

  // Manual order [commish, mgr2, placeholders…] = the nomination order
  // (same_as_draft_order), so the COMMISSIONER nominates first.
  const configured = await patchLeague(commishClient, leagueId, {
    settings: {
      roster_settings: {
        starting_slots: [{ key: 'rb', label: 'RB', eligible: ['RB'], count: 1 }],
        bench: 1,
        ir_slots: [],
        swap_spots: 0,
      },
      draft: {
        draft_type: 'auction',
        draft_order_mode: 'manual',
        draft_order: [commishTeamId, mgr2TeamId, ...placeholderIds],
        nomination_order_mode: 'same_as_draft_order',
        auction_budget: AUCTION_BUDGET,
        auction_min_bid: AUCTION_MIN_BID,
        auction_nomination_seconds: NOMINATION_SECONDS,
        auction_bid_seconds: BID_SECONDS,
        auction_anti_snipe_seconds: ANTI_SNIPE_SECONDS,
        disconnect_grace_seconds: GRACE_SECONDS,
        pick_timer_seconds: 90,
        draft_scheduled_at: DRAFT_INSTANT,
      },
    },
  })
  if (configured.status !== 200) {
    throw new Error(`auction configure PATCH failed: ${JSON.stringify(configured.body)}`)
  }

  // The MOCK auction (L.C1.7 lifted 071's refusal) — launched by mgr2 while
  // the league is still in its launch window, coexisting with the real
  // draft below (E60). It exists here ONLY to be refused (D138).
  const launched = await launchMockDraft(
    mgr2Client,
    leagueId,
    { cpu_speed: 'realistic' },
    { mintActionId: () => ACTION.mockLaunch },
  )
  if (launched.status !== 201) throw new Error(`mock launch failed: ${JSON.stringify(launched.body)}`)
  const mock = (launched.body as unknown as DraftBody).draft
  if (!mock.is_mock || mock.draft_type !== 'auction') {
    throw new Error(`mock launch did not produce a mock auction: ${JSON.stringify(mock)}`)
  }
  mockId = mock.id

  const scheduled = await patchLeague(commishClient, leagueId, { status: 'scheduled' })
  if (scheduled.status !== 200) {
    throw new Error(`scheduled PATCH failed: ${JSON.stringify(scheduled.body)}`)
  }
  const started = await startDraft(commishClient, leagueId)
  if (started.status !== 200) throw new Error(`startDraft failed: ${JSON.stringify(started.body)}`)
  const draft = (started.body as unknown as DraftBody).draft
  if (draft.status !== 'live' || draft.draft_type !== 'auction') {
    throw new Error(`auction did not start live: ${JSON.stringify(draft)}`)
  }
  draftId = draft.id
  if ((draft.nomination_order as string[])[0] !== commishTeamId) {
    throw new Error('fixture: the commissioner is not the first nominator')
  }
}, 240_000)

afterAll(async () => {
  await cleanup()
})

describe('auction commissioner routes over PostgREST (§8.7 auction rows / §15.2 via C40 / §17)', () => {
  it('AUTH SWEEP: a plain manager answers 403 on EVERY auction verb (§17); an outsider answers the no-leak 404; nothing moved', async () => {
    const managerCalls: [string, Promise<{ status: number; body: unknown }>][] = [
      [
        'reverse-bid',
        reverseWonBid(mgr2Client, leagueId, { pick_id: NO_SUCH_PICK, reason: 'nope' }),
      ],
      [
        'budget',
        adjustBudget(mgr2Client, leagueId, { team_id: mgr2TeamId, delta: 50, reason: 'nope' }),
      ],
      ['cancel-nomination', cancelNomination(mgr2Client, leagueId, { reason: 'nope' })],
      ['end', endDraft(mgr2Client, leagueId, { reason: 'nope' })],
      [
        'priced reassign',
        reassignPick(mgr2Client, leagueId, {
          pick_id: NO_SUCH_PICK,
          team_id: mgr2TeamId,
          price: 1,
          reason: 'nope',
        }),
      ],
    ]
    for (const [verb, call] of managerCalls) {
      const result = await call
      expect(result.status, `manager on ${verb}`).toBe(403)
      expect(JSON.stringify(result.body), `manager on ${verb}`).toContain(
        'Only the commissioner can manage the draft',
      )
    }

    // Outsider: the RLS probe sees no draft — the no-leak 404 (R155 class),
    // on every route (explicit draft_id too — the same member-scoped read).
    for (const call of [
      reverseWonBid(outsiderClient, leagueId, { pick_id: NO_SUCH_PICK, reason: 'x' }),
      adjustBudget(outsiderClient, leagueId, { team_id: mgr2TeamId, delta: 1, reason: 'x' }),
      cancelNomination(outsiderClient, leagueId, { reason: 'x' }),
      endDraft(outsiderClient, leagueId, { draft_id: draftId, reason: 'x' }),
    ]) {
      expect((await call).status).toBe(404)
    }

    // Nothing changed: live, nominating, seq 1, no adjustments, no posts.
    const draft = await readDraft()
    expect(draft).toMatchObject({ status: 'live', current_pick_number: 1, budget_adjustments: {} })
    expect(draft.current_nomination).toBeNull()
    const { data: league } = await service.from('leagues').select('status').eq('id', leagueId).single()
    expect(league?.status).toBe('drafting')
  })

  it('`reason` is REQUIRED on all four: missing → 400 naming the field; blank → 400; an unknown key → 400 (strict bodies)', async () => {
    const missing: [string, Promise<{ status: number; body: unknown }>][] = [
      ['reverse-bid', reverseWonBid(commishClient, leagueId, { pick_id: NO_SUCH_PICK })],
      ['budget', adjustBudget(commishClient, leagueId, { team_id: commishTeamId, delta: -5 })],
      ['cancel-nomination', cancelNomination(commishClient, leagueId, {})],
      ['end', endDraft(commishClient, leagueId, {})],
    ]
    for (const [verb, call] of missing) {
      const result = await call
      expect(result.status, `no reason on ${verb}`).toBe(400)
      // The flattened Zod error names the field — the hook's LeagueActionError
      // routes it to the input (client-fetch.ts).
      expect(JSON.stringify(result.body), `no reason on ${verb}`).toContain('"reason"')
    }
    // Blank (whitespace) trims to empty — min(1) refuses it.
    const blank = await endDraft(commishClient, leagueId, { reason: '   ' })
    expect(blank.status).toBe(400)
    // Strict: a smuggled confirm phrase (or any unknown key) is a 400 — the
    // hard-confirm is the UI's, the route takes no phrase (C41).
    const smuggled = await endDraft(commishClient, leagueId, { reason: 'x', confirm: 'END' })
    expect(smuggled.status).toBe(400)

    // None of those reached an RPC: still seq 1, no adjustments, zero posts.
    const draft = await readDraft()
    expect(draft).toMatchObject({ status: 'live', current_pick_number: 1, budget_adjustments: {} })
    expect(await systemPosts()).toHaveLength(0)
  })

  it('MOCK REFUSAL (D138): each of the four refuses a mock auction with the RPC’s exact copy — role grants nothing on a mock', async () => {
    const calls: [string, Promise<{ status: number; body: unknown }>][] = [
      [
        'draft_reverse_won_bid',
        reverseWonBid(commishClient, leagueId, { draft_id: mockId, pick_id: NO_SUCH_PICK, reason: 'x' }),
      ],
      [
        'draft_adjust_budget',
        adjustBudget(commishClient, leagueId, { draft_id: mockId, team_id: mgr2TeamId, delta: 5, reason: 'x' }),
      ],
      [
        'draft_cancel_nomination',
        cancelNomination(commishClient, leagueId, { draft_id: mockId, reason: 'x' }),
      ],
      ['draft_end', endDraft(commishClient, leagueId, { draft_id: mockId, reason: 'x' })],
    ]
    for (const [verb, call] of calls) {
      const result = await call
      expect(result.status, verb).toBe(400)
      expect((result.body as { error: string }).error, verb).toBe(MOCK_REFUSAL(verb))
    }
    // The mock is untouched — still the launcher's live practice.
    const { data: mock } = await service.from('drafts').select('status, is_mock').eq('id', mockId).single()
    expect(mock).toMatchObject({ status: 'live', is_mock: true })
  })

  it('D141 over the wire: reverse-bid and cancel-nomination refuse LIVE with the ruling’s exact copy (byte-compared); budget is NOT gated', async () => {
    // Fixture: the commissioner nominates P1 at $150 — bidding phase, the
    // commissioner is the standing high bidder (§8.6.7(b)).
    await nominate(commishClient, P1, HIGH_BID, ACTION.nominate1)
    const live = await readDraft()
    expect(live.status).toBe('live')
    expect(live.current_nomination as unknown as LiveNomination).toEqual({
      player_id: P1,
      high_bid: HIGH_BID,
      high_bidder_team_id: commishTeamId,
    })

    const reverse = await reverseWonBid(commishClient, leagueId, {
      pick_id: NO_SUCH_PICK,
      reason: 'live reverse (must refuse — D141)',
    })
    expect(reverse.status).toBe(400)
    expect((reverse.body as { error: string }).error).toBe(PAUSE_FIRST('draft_reverse_won_bid'))

    const cancel = await cancelNomination(commishClient, leagueId, {
      reason: 'live cancel (must refuse — D141)',
    })
    expect(cancel.status).toBe(400)
    expect((cancel.body as { error: string }).error).toBe(PAUSE_FIRST('draft_cancel_nomination'))

    // The priced Manual Edit paths are gated too (the same ONE helper).
    const pricedMove = await movePlayer(commishClient, leagueId, {
      player_id: P1,
      from_team: commishTeamId,
      to_team: mgr2TeamId,
      price: 10,
      reason: 'live priced move (must refuse — D141)',
    })
    expect(pricedMove.status).toBe(400)
    expect((pricedMove.body as { error: string }).error).toBe(PAUSE_FIRST('draft_move_player'))

    // Refused means refused: the nomination stands, no posts landed.
    const still = await readDraft()
    expect((still.current_nomination as unknown as LiveNomination).high_bid).toBe(HIGH_BID)
    expect(await systemPosts()).toHaveLength(0)
  })

  it('ONE UNIT (E28 arm 3 / D131(4) / D146): the cut that leaves max_bid EXACTLY = the high bid LANDS live; one dollar more is refused verbatim and rolls back', async () => {
    const postsBefore = (await systemPosts()).length
    const REASON = 'acapi-one-unit-reason-7f3e'

    // d = −49: max_bid' = 199 − 49 = 150 = the standing high bid → LANDS,
    // and NOT pause-gated — the draft is LIVE (D141 does not name budget).
    const lands = await adjustBudget(commishClient, leagueId, {
      team_id: commishTeamId,
      delta: EXACT_CUT,
      reason: REASON,
    })
    expect(lands.status).toBe(200)
    expect(lands.body).toMatchObject({
      team_id: commishTeamId,
      adjustment_before: 0,
      adjustment_after: EXACT_CUT,
      remaining: AUCTION_BUDGET + EXACT_CUT,
      open_slots: SLOTS_PER_TEAM,
      max_bid: HIGH_BID,
    })
    // DB corroboration — the map, and the ONE family's derivation (D127).
    const afterLand = await readDraft()
    expect(afterLand.budget_adjustments).toEqual({ [commishTeamId]: EXACT_CUT })
    expect(afterLand.status).toBe('live')
    expect(await budgetOf(commishTeamId)).toMatchObject({
      remaining: AUCTION_BUDGET + EXACT_CUT,
      open_slots: SLOTS_PER_TEAM,
      max_bid: HIGH_BID,
      committed: 0,
    })

    // One more dollar: max_bid' = 149 < 150 → E28 arm 3, the exact copy
    // (team name, player name, the two numbers, and the NOT-pause-gated
    // remedy — 087's parameterised sentence for THIS verb).
    const refused = await adjustBudget(commishClient, leagueId, {
      team_id: commishTeamId,
      delta: ONE_MORE_DOLLAR,
      reason: REASON,
    })
    expect(refused.status).toBe(400)
    expect((refused.body as { error: string }).error).toBe(
      `draft_adjust_budget: ${COMMISH_TEAM_NAME} is the high bidder on ${PLAYERS[0].full_name} at $${HIGH_BID}, ` +
        `and that leaves a max bid of $${HIGH_BID - 1} — the close would be unaffordable. ` +
        'Void the nomination (pause, then Edit current nomination) or reverse a won bid first (E28/D131(4))',
    )
    // The refused write ROLLED BACK inside the RPC's transaction: the map
    // still reads −49, the derivation still reads max_bid 150.
    const afterRefuse = await readDraft()
    expect(afterRefuse.budget_adjustments).toEqual({ [commishTeamId]: EXACT_CUT })
    expect((await budgetOf(commishTeamId)).max_bid).toBe(HIGH_BID)

    // F40 — `reason` accepted, validated, STORED NOWHERE: exactly ONE post
    // landed (the D97 budget post), it carries the money and not the reason,
    // the drafts row carries it nowhere, and the audit table does not exist.
    const posts = await systemPosts()
    expect(posts).toHaveLength(postsBefore + 1)
    const budgetPost = posts[posts.length - 1]
    expect(budgetPost).toContain(`Budget adjusted by`)
    expect(budgetPost).toContain(`${COMMISH_TEAM_NAME} -$${-EXACT_CUT} (total adjustment -$${-EXACT_CUT}`)
    expect(budgetPost).not.toContain(REASON)
    expect(JSON.stringify(afterRefuse)).not.toContain(REASON)
    // (Untyped client on purpose: the table is absent from the generated
    // types BECAUSE it does not exist — F32/F40 are still M6's.)
    const untyped = service as unknown as SupabaseClient
    const { error: noAuditTable } = await untyped.from('commissioner_actions').select('*').limit(1)
    expect(noAuditTable).not.toBeNull()
    expect(noAuditTable?.message).toMatch(/commissioner_actions/)
  }, 60_000)

  it('cancel-nomination PAUSED: lands; the bid row is VOIDED not deleted (D162), the sequence number is NOT consumed (D143), same nominator', async () => {
    const before = await readDraft()
    const seq = before.current_pick_number as number

    const paused = await pauseOrResumeDraft(commishClient, leagueId, {
      action: 'pause',
      reason: 'pause-first (D141)',
    })
    expect(paused.status).toBe(200)
    // Measured AFTER the pause (the pause posts its own D97 line).
    const postsBefore = (await systemPosts()).length

    const cancelled = await cancelNomination(commishClient, leagueId, {
      reason: 'wrong player nominated (wire cancel check)',
    })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body).toMatchObject({
      cancelled_player_id: P1,
      voided_bids: 1,
      nomination_seq: seq,
    })

    const after = await readDraft()
    expect(after.status).toBe('paused')
    expect(after.current_nomination).toBeNull()
    expect(after.current_pick_number).toBe(seq)
    expect(after.on_clock_team_id).toBe(commishTeamId)
    // The opening-bid row STANDS, stamped (D162) — nothing deleted.
    const { data: bids } = await service
      .from('draft_bids')
      .select('player_id, amount, voided_at')
      .eq('draft_id', draftId)
      .eq('nomination_seq', seq)
    expect(bids).toHaveLength(1)
    expect(bids?.[0]).toMatchObject({ player_id: P1, amount: HIGH_BID })
    expect(bids?.[0].voided_at).not.toBeNull()
    // D97: exactly one post, naming the void.
    const posts = await systemPosts()
    expect(posts).toHaveLength(postsBefore + 1)
    expect(posts[posts.length - 1]).toContain(`${PLAYERS[0].full_name} comes off the block at $${HIGH_BID} and 1 bid is void`)
  })

  it('priced reassign + move-player land behind the pause (D142 — the re-entered cost rides the pick row); the E28-class and missing-price refusals pass through', async () => {
    // Resume, renominate (same nominator — D143), award by rewind + tick.
    const resumed = await pauseOrResumeDraft(commishClient, leagueId, { action: 'resume' })
    expect(resumed.status).toBe(200)
    await nominate(commishClient, P2, 5, ACTION.nominate2)
    await rewindAndTick()
    const { data: awarded } = await service
      .from('draft_picks')
      .select('*')
      .eq('draft_id', draftId)
      .eq('player_id', P2)
      .eq('is_undone', false)
      .single()
    expect(awarded).not.toBeNull()
    const pick = awarded as PickRow
    expect(pick).toMatchObject({ team_id: commishTeamId, price: 5 })

    // Live: the priced reassign refuses with the gate (pinned above for move;
    // the same ONE helper) — then pause.
    const liveReassign = await reassignPick(commishClient, leagueId, {
      pick_id: pick.id,
      team_id: mgr2TeamId,
      price: 40,
      reason: 'live (must refuse)',
    })
    expect(liveReassign.status).toBe(400)
    expect((liveReassign.body as { error: string }).error).toBe(PAUSE_FIRST('draft_reassign_pick'))
    const paused = await pauseOrResumeDraft(commishClient, leagueId, { action: 'pause' })
    expect(paused.status).toBe(200)

    // Hands change WITHOUT a price on an auction → the RPC's 22023 (the
    // route maps it 400, copy verbatim) — the re-entered cost is the input.
    const noPrice = await reassignPick(commishClient, leagueId, {
      pick_id: pick.id,
      team_id: mgr2TeamId,
      reason: 'no price (must refuse)',
    })
    expect(noPrice.status).toBe(400)
    expect((noPrice.body as { error: string }).error).toBe(
      'draft_reassign_pick: this is an auction — re-enter the price this pick should cost the receiving team (§8.7 Manual Edit Mode)',
    )

    // Priced reassign to mgr2 at $40 — lands; the row carries the price.
    const reassigned = await reassignPick(commishClient, leagueId, {
      pick_id: pick.id,
      team_id: mgr2TeamId,
      price: 40,
      reason: 'wire priced reassign',
    })
    expect(reassigned.status).toBe(200)
    const { data: afterReassign } = await service
      .from('draft_picks')
      .select('team_id, price')
      .eq('id', pick.id)
      .single()
    expect(afterReassign).toEqual({ team_id: mgr2TeamId, price: 40 })
    expect(await budgetOf(mgr2TeamId)).toMatchObject({
      remaining: AUCTION_BUDGET - 40,
      open_slots: SLOTS_PER_TEAM - 1,
      committed: 40,
    })

    // Priced move over the E28 ceiling: a placeholder has max_bid 199 —
    // $250 is refused with the E28 copy (the remedy text passes through).
    const overMax = await movePlayer(commishClient, leagueId, {
      player_id: P2,
      from_team: mgr2TeamId,
      to_team: placeholderIds[0],
      price: 250,
      reason: 'over max (must refuse)',
    })
    expect(overMax.status).toBe(400)
    expect((overMax.body as { error: string }).error).toBe(
      `draft_move_player: $250 is over that team's max bid of $199 — they have $200 for 2 open roster spots at a $1 minimum bid; reverse a won bid or adjust their budget first (E28/§8.6.8)`,
    )

    // Priced move back to the commissioner at $30 — lands.
    const moved = await movePlayer(commishClient, leagueId, {
      player_id: P2,
      from_team: mgr2TeamId,
      to_team: commishTeamId,
      price: 30,
      reason: 'wire priced move',
    })
    expect(moved.status).toBe(200)
    const { data: afterMove } = await service
      .from('draft_picks')
      .select('team_id, price')
      .eq('id', pick.id)
      .single()
    expect(afterMove).toEqual({ team_id: commishTeamId, price: 30 })
    // mgr2 refunded by derivation; the commissioner charged (with the −49
    // adjustment from the one-unit pin still in the map).
    expect(await budgetOf(mgr2TeamId)).toMatchObject({ remaining: AUCTION_BUDGET, committed: 0 })
    expect(await budgetOf(commishTeamId)).toMatchObject({
      remaining: AUCTION_BUDGET + EXACT_CUT - 30,
      open_slots: SLOTS_PER_TEAM - 1,
      committed: 30,
    })
  }, 120_000)

  it('reverse-bid PAUSED: the pick is soft-undone, the player returns to the pool, the refund is BY DERIVATION (D127/D131(1)); a bogus pick is the mapped 404', async () => {
    const postsBefore = (await systemPosts()).length
    const { data: livePick } = await service
      .from('draft_picks')
      .select('id, price')
      .eq('draft_id', draftId)
      .eq('player_id', P2)
      .eq('is_undone', false)
      .single()
    expect(livePick).not.toBeNull()

    // P0002 → 404 (the 063 mapping) for a pick that is no live pick here.
    const bogus = await reverseWonBid(commishClient, leagueId, {
      pick_id: NO_SUCH_PICK,
      reason: 'bogus pick (must 404)',
    })
    expect(bogus.status).toBe(404)

    const reversed = await reverseWonBid(commishClient, leagueId, {
      pick_id: livePick!.id,
      reason: 'mis-click (wire reverse check)',
    })
    expect(reversed.status).toBe(200)
    expect(reversed.body).toMatchObject({
      refunded: 30,
      remaining: AUCTION_BUDGET + EXACT_CUT,
      open_slots: SLOTS_PER_TEAM,
    })
    const { data: afterPick } = await service
      .from('draft_picks')
      .select('is_undone, price')
      .eq('id', livePick!.id)
      .single()
    expect(afterPick).toEqual({ is_undone: true, price: 30 })
    // Nothing was written back to a counter — the ONE family simply no
    // longer sums the row (D127).
    expect(await budgetOf(commishTeamId)).toMatchObject({
      remaining: AUCTION_BUDGET + EXACT_CUT,
      open_slots: SLOTS_PER_TEAM,
      committed: 0,
    })
    const posts = await systemPosts()
    expect(posts).toHaveLength(postsBefore + 1)
    expect(posts[posts.length - 1]).toContain(
      `${PLAYERS[1].full_name} returns to the pool and ${COMMISH_TEAM_NAME} is refunded $30`,
    )
  })

  it('the clock route carries the AUCTION timers (087’s arm, E15 analog); an auction refuses the pick clock; the PATCH edits nomination_order', async () => {
    const clock = await setClock(commishClient, leagueId, {
      nomination_seconds: 60,
      bid_seconds: 25,
      anti_snipe_seconds: 8,
      reason: 'wire auction clock edit',
    })
    expect(clock.status).toBe(200)
    const config = (await readDraft()).config as Record<string, unknown>
    expect(config).toMatchObject({
      auction_nomination_seconds: 60,
      auction_bid_seconds: 25,
      auction_anti_snipe_seconds: 8,
    })
    // An auction has no pick clock — the RPC's refusal passes through.
    const pickClock = await setClock(commishClient, leagueId, {
      pick_timer_seconds: 45,
      reason: 'wrong clock (must refuse)',
    })
    expect(pickClock.status).toBe(400)
    expect((pickClock.body as { error: string }).error).toContain(
      'this is an auction — it has no pick clock',
    )
    // A body naming NO timer is the route's own 400 (strict shape).
    const noTimer = await setClock(commishClient, leagueId, { reason: 'nothing named' })
    expect(noTimer.status).toBe(400)

    // The PATCH's post-start dispatch edits NOMINATION order on an auction
    // (087's set_order arm); draft_order is untouched.
    const before = await readDraft()
    const newOrder = [commishTeamId, placeholderIds[0], mgr2TeamId, ...placeholderIds.slice(1)]
    const dispatched = await patchDraftOrder(
      commishClient,
      leagueId,
      { order: newOrder, reason: 'wire nomination-order edit' },
      noEntropy,
    )
    expect(dispatched.status).toBe(200)
    const after = await readDraft()
    expect(after.nomination_order).toEqual(newOrder)
    expect(after.draft_order).toEqual(before.draft_order)
  })

  it('END (C41 end-as-is): rosters at their winning prices, unfilled slots absent, league in_season, the live nomination voided un-awarded; a second end refuses', async () => {
    // One REAL award on the board first (so prices ride into rosters): the
    // rotation is at mgr2 (advanced after the P2 award); resume, mgr2
    // nominates P3 at $7, rewind + tick awards it.
    const resumed = await pauseOrResumeDraft(commishClient, leagueId, { action: 'resume' })
    expect(resumed.status).toBe(200)
    const onClock = (await readDraft()).on_clock_team_id
    expect(onClock).toBe(mgr2TeamId)
    await nominate(mgr2Client, P3, 7, ACTION.nominate3)
    await rewindAndTick()
    const { data: p3pick } = await service
      .from('draft_picks')
      .select('team_id, price')
      .eq('draft_id', draftId)
      .eq('player_id', P3)
      .eq('is_undone', false)
      .single()
    expect(p3pick).toEqual({ team_id: mgr2TeamId, price: 7 })

    // A LIVE nomination for End to void: the next nominator opens P4.
    const next = await readDraft()
    expect(next.status).toBe('live')
    expect(next.current_nomination).toBeNull()
    const nominatorId = next.on_clock_team_id as string
    // Placeholders have no user — force-nominate is the commissioner's arm
    // for them; the commissioner's own seat nominates through the RPC when
    // it is the nominator. Either way the board ends with P4 on the block.
    if (nominatorId === commishTeamId) {
      await nominate(commishClient, P4, 3, ACTION.nominate4)
    } else if (nominatorId === mgr2TeamId) {
      await nominate(mgr2Client, P4, 3, ACTION.nominate4)
    } else {
      const { error } = await commishClient.rpc('draft_force_pick', {
        p_draft_id: draftId,
        p_player_id: P4,
        p_action_id: ACTION.nominate4,
      })
      if (error) throw new Error(`force-nominate failed: ${error.message}`)
    }
    expect((await readDraft()).current_nomination).not.toBeNull()
    const postsBefore = (await systemPosts()).length

    const ended = await endDraft(commishClient, leagueId, { reason: 'calling it (wire end check)' })
    expect(ended.status).toBe(200)
    expect(ended.body).toMatchObject({
      ended: true,
      rostered: 1,
      unfilled_slots: TEAM_COUNT * SLOTS_PER_TEAM - 1,
      voided_bids: 1,
    })

    const after = await readDraft()
    expect(after.status).toBe('complete')
    expect(after.current_nomination).toBeNull()
    const { data: league } = await service.from('leagues').select('status').eq('id', leagueId).single()
    expect(league?.status).toBe('in_season')
    const { data: rosters } = await service
      .from('league_rosters')
      .select('team_id, player_id, acquisition_type, acquisition_cost')
      .eq('league_id', leagueId)
    expect(rosters).toEqual([
      { team_id: mgr2TeamId, player_id: P3, acquisition_type: 'draft', acquisition_cost: 7 },
    ])
    // The P4 nomination's opening row is voided, un-awarded (D162).
    const { data: p4bids } = await service
      .from('draft_bids')
      .select('voided_at')
      .eq('draft_id', draftId)
      .eq('player_id', P4)
    expect(p4bids).toHaveLength(1)
    expect(p4bids?.[0].voided_at).not.toBeNull()
    const posts = await systemPosts()
    expect(posts).toHaveLength(postsBefore + 1)
    expect(posts[posts.length - 1]).toContain(
      `1 players are rostered at their winning prices and ${TEAM_COUNT * SLOTS_PER_TEAM - 1} roster spots stay empty for free agency`,
    )

    // Terminal: a second End (explicit draft_id — the active-draft default
    // no longer resolves a complete draft) refuses; so does a budget edit.
    const again = await endDraft(commishClient, leagueId, { draft_id: draftId, reason: 'again' })
    expect(again.status).toBe(400)
    expect((again.body as { error: string }).error).toBe('draft_end: the draft is already complete')
    const afterEnd = await adjustBudget(commishClient, leagueId, {
      draft_id: draftId,
      team_id: mgr2TeamId,
      delta: 1,
      reason: 'after end',
    })
    expect(afterEnd.status).toBe(400)
    expect((afterEnd.body as { error: string }).error).toContain('the draft is complete')
  }, 120_000)
})
