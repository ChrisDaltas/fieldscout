import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { claimInvite, createInvite } from '@/lib/leagues/api/invites-service'
import { createDraft, patchDraftOrder, startDraft } from '@/lib/leagues/api/draft-service'
import { createLeague, patchLeague } from '@/lib/leagues/api/leagues-service'
import { addPlaceholderSeat } from '@/lib/leagues/api/members-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import { rosterForRounds } from '@/lib/leagues/sim/runner'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '@/lib/leagues/sim/synthetic-season'

import { anonClient, serviceClient } from './harness'
import { DEV_PRO_USER, DEV_USER, E2E_LEAGUE_PREFIX } from './local-env'

type Supabase = SupabaseClient<Database>

/**
 * League provisioning for the draft specs — M2 task L.B5.1, the D100
 * doctrine verbatim (the sim/M1-gate precedent): the seed users' OWN authed
 * supabase-js clients drive the SAME service functions the Route Handlers
 * wrap (`createLeague` → `createInvite`/`claimInvite` → `addPlaceholderSeat`
 * → status PATCH → `createDraft`/`patchDraftOrder`/`startDraft`), so every
 * fixture league travels the real RPC path end-to-end — the Next cookie
 * layer is the only plumbing skipped. The BROWSER then drives the drafting
 * itself; journey spec (d) drives even creation through the UI and uses
 * none of this.
 *
 * F49 discipline: the stored schedule instant is far-future (2028) so the
 * D94 auto-start cron can never race a spec's own manual start.
 */

/** Far-future schedule instant (the F49 fixture-instant discipline). */
const DRAFT_INSTANT = '2028-09-01T17:00:00+00:00'
const GRACE_SECONDS = 30

export interface AuthedUser {
  userId: string
  client: Supabase
}

async function signIn(user: { email: string; password: string; id: string }): Promise<AuthedUser> {
  const client = anonClient()
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error) {
    throw new Error(
      `seed-user sign-in (${user.email}) failed: ${error.message} — a fresh db reset re-seeds ` +
        'both dev users (supabase/seed.sql); is the local stack up?',
    )
  }
  return { userId: user.id, client }
}

export async function signInDev(): Promise<AuthedUser> {
  return signIn(DEV_USER)
}

export async function signInDevPro(): Promise<AuthedUser> {
  return signIn(DEV_PRO_USER)
}

export interface ProvisionedLeague {
  leagueId: string
  /** Present when `start`/`createDraftRow` asked for one. */
  draftId: string | null
  commishTeamId: string
  /** Present when a manager seat was claimed. */
  managerTeamId: string | null
  /** Seat team ids for `extraManagers`, in input order (storm bots). */
  extraTeamIds: string[]
  placeholderTeamIds: string[]
  teamCount: number
  totalRounds: number
  totalPicks: number
}

/** §7.3.8 auction knobs a spec pins explicitly (L.C5.1) — every value is
 *  validated by the real settings schema on `createLeague`, so an
 *  out-of-catalog number fails loudly at provisioning, never mid-spec. */
export interface AuctionProvisionConfig {
  budget: number
  nominationSeconds: number
  bidSeconds: number
  antiSnipeSeconds: number
}

export interface ProvisionInput {
  /** Suffix appended to the E2E prefix — keep it spec-unique. */
  nameSuffix: string
  teamCount: 8
  /** Draftable rounds (D91: starters + bench) — small boards keep specs fast. */
  rounds: number
  clockSeconds: 30 | 45 | 60
  commish: AuthedUser
  /** When present, claims seat 2 via the real invite/claim path. */
  manager?: AuthedUser
  /** Additional SEATED users (L.C5.1's storm bots — harness job 6) — each
   *  claims its own invite through the real path, after `manager`. They
   *  join the stored order after the two humans, before placeholders. */
  extraManagers?: AuthedUser[]
  /** 'auction' flips §7.3.8 on with the knobs below; default stays 'snake'
   *  byte-identical (the M2 specs are untouched by L.C5.1). */
  draftType?: 'snake' | 'auction'
  /** REQUIRED when draftType === 'auction'. */
  auction?: AuctionProvisionConfig
  /** Human seats lead the stored order: [commish, manager?, ...placeholders]
   *  unless 'manager-first' flips the two. */
  order?: 'commish-first' | 'manager-first'
  /** Leave the league in `setup` (the mock spec's shape — no draft row,
   *  no schedule flip). */
  stayInSetup?: boolean
  /** 'manual' (default) expects a later explicit-order PATCH; a league
   *  that will never store one (the mock spec) needs 'random', or
   *  `create_mock_draft` correctly refuses the incomplete manual order. */
  orderMode?: 'manual' | 'random'
  /** Create + order the draft row (league `scheduled`). */
  createDraftRow?: boolean
  /** Also start it (skips the lobby — the reconnect spec's shape). */
  start?: boolean
}

function expectStatus(
  result: { status: number; body: unknown },
  allowed: readonly number[],
  what: string,
): void {
  if (!allowed.includes(result.status)) {
    throw new Error(`${what} failed (${result.status}): ${JSON.stringify(result.body)}`)
  }
}

export async function provisionLeague(input: ProvisionInput): Promise<ProvisionedLeague> {
  const { commish, manager } = input
  const name = `${E2E_LEAGUE_PREFIX} ${input.nameSuffix}`

  // Scoring template — read under the commissioner's own JWT (templates are
  // viewable by everyone, 058; the R290 confinement lesson).
  const { data: template, error: templateError } = await commish.client
    .from('scoring_systems')
    .select('id')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  if (templateError) throw new Error(`scoring-template lookup failed: ${templateError.message}`)

  const settings = defaultsForTeamCount(input.teamCount)
  if (input.draftType === 'auction' && !input.auction) {
    throw new Error('provisionLeague: draftType "auction" requires the auction knobs (loud, not defaulted)')
  }
  const configured = {
    ...settings,
    roster_settings: rosterForRounds(input.rounds),
    draft: {
      ...settings.draft,
      draft_type: (input.draftType ?? 'snake') as 'snake',
      // AP.5: an auction's rotation is the NOMINATION order, set through
      // League settings (below, once the seats exist) — the draft-order
      // PATCH refuses a pre-start auction, so the board order stays random.
      draft_order_mode:
        input.draftType === 'auction' ? ('random' as const) : (input.orderMode ?? ('manual' as const)),
      pick_timer_seconds: input.clockSeconds as (typeof settings.draft)['pick_timer_seconds'],
      disconnect_grace_seconds: GRACE_SECONDS,
      draft_scheduled_at: DRAFT_INSTANT,
      // §7.3.8 (L.C5.1): the auction clocks a spec pins. Validated by the
      // real settings schema at createLeague — nothing here defaults.
      ...(input.auction
        ? {
            auction_budget: input.auction.budget as (typeof settings.draft)['auction_budget'],
            auction_nomination_seconds:
              input.auction.nominationSeconds as (typeof settings.draft)['auction_nomination_seconds'],
            auction_bid_seconds: input.auction.bidSeconds as (typeof settings.draft)['auction_bid_seconds'],
            auction_anti_snipe_seconds:
              input.auction.antiSnipeSeconds as (typeof settings.draft)['auction_anti_snipe_seconds'],
          }
        : {}),
    },
  }

  // F215 / migration 110: draft completion maps the league onto the NFL
  // calendar at the completing pick's instant — the league is created on a
  // SYNTHETIC season (seeded here, idempotently) so the journey never depends
  // on the wall clock.
  await seedSyntheticSeason(serviceClient())

  const created = await createLeague(commish.client, {
    name,
    season: SYNTHETIC_SEASON, // F215: the fixture owns its calendar (migration 110 maps completion onto nfl_weeks)
    scoring_system_id: template!.id,
    team_name: `${input.nameSuffix} commish`,
    action_id: randomUUID(),
    settings: configured,
  })
  expectStatus(created, [201], 'createLeague')
  const leagueId = (created.body as { league_id: string }).league_id

  let managerTeamId: string | null = null
  if (manager) {
    const invite = await createInvite(commish.client, leagueId, {})
    expectStatus(invite, [200, 201], 'createInvite')
    const token = (invite.body as { token: string }).token
    const claim = await claimInvite(manager.client, { token })
    expectStatus(claim, [200], 'claimInvite')
    managerTeamId = (claim.body as { team_id: string }).team_id
  }

  // L.C5.1: the storm's bot seats — every one claims its own invite through
  // the REAL path (D100), exactly the sim runner's bot-pool shape.
  const extraTeamIds: string[] = []
  for (const extra of input.extraManagers ?? []) {
    const invite = await createInvite(commish.client, leagueId, {})
    expectStatus(invite, [200, 201], 'createInvite (extra seat)')
    const token = (invite.body as { token: string }).token
    const claim = await claimInvite(extra.client, { token })
    expectStatus(claim, [200], 'claimInvite (extra seat)')
    extraTeamIds.push((claim.body as { team_id: string }).team_id)
  }

  const humanSeats = (manager ? 2 : 1) + extraTeamIds.length
  for (let i = 0; i < input.teamCount - humanSeats; i++) {
    const filled = await addPlaceholderSeat(commish.client, leagueId, {})
    expectStatus(filled, [201], 'addPlaceholderSeat')
  }

  const { data: memberRow, error: memberError } = await commish.client
    .from('league_members')
    .select('team_id')
    .eq('league_id', leagueId)
    .eq('user_id', commish.userId)
    .single()
  if (memberError) throw new Error(`commissioner membership read failed: ${memberError.message}`)
  const commishTeamId = memberRow!.team_id as string

  const { data: teamRows, error: teamsError } = await commish.client
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
  if (teamsError) throw new Error(`teams read failed: ${teamsError.message}`)
  const placeholderTeamIds = (teamRows ?? [])
    .map((t) => t.id as string)
    .filter((id) => id !== commishTeamId && id !== managerTeamId && !extraTeamIds.includes(id))

  const totalRounds = input.rounds
  const result: ProvisionedLeague = {
    leagueId,
    draftId: null,
    commishTeamId,
    managerTeamId,
    extraTeamIds,
    placeholderTeamIds,
    teamCount: input.teamCount,
    totalRounds,
    totalPicks: input.teamCount * totalRounds,
  }

  if (input.stayInSetup) return result

  const humanOrder =
    input.order === 'manager-first' && managerTeamId
      ? [managerTeamId, commishTeamId]
      : managerTeamId
        ? [commishTeamId, managerTeamId]
        : [commishTeamId]
  const order = [...humanOrder, ...extraTeamIds, ...placeholderTeamIds]

  if (input.draftType === 'auction') {
    // AP.5 (098): the auction's rotation is the MANUAL nomination order,
    // written through the real settings PATCH; `draft_start` hydrates
    // `drafts.nomination_order` from it. The draft-order PATCH refuses a
    // pre-start auction by design, so it is never called on this arm.
    const patched = await patchLeague(commish.client, leagueId, {
      settings: {
        draft: {
          ...configured.draft,
          nomination_order_mode: 'manual',
          nomination_order: order,
        },
      },
    })
    expectStatus(patched, [200], 'manual nomination-order PATCH')
  }

  const scheduled = await patchLeague(commish.client, leagueId, { status: 'scheduled' })
  expectStatus(scheduled, [200], 'status → scheduled PATCH')

  if (!input.createDraftRow && !input.start) return result

  const draftCreated = await createDraft(commish.client, leagueId)
  expectStatus(draftCreated, [200, 201], 'createDraft')
  result.draftId = (draftCreated.body as { draft: { id: string } }).draft.id

  if (input.draftType !== 'auction') {
    const ordered = await patchDraftOrder(
      commish.client,
      leagueId,
      { order },
      { randomValues: () => [] }, // explicit order — the shuffle arm is unused
    )
    expectStatus(ordered, [200], 'patchDraftOrder')
  }

  if (input.start) {
    const started = await startDraft(commish.client, leagueId)
    expectStatus(started, [200], 'startDraft')
  }

  return result
}
