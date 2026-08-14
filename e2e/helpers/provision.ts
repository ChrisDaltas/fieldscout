import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { claimInvite, createInvite } from '@/lib/leagues/api/invites-service'
import { createDraft, patchDraftOrder, startDraft } from '@/lib/leagues/api/draft-service'
import { createLeague, patchLeague } from '@/lib/leagues/api/leagues-service'
import { addPlaceholderSeat } from '@/lib/leagues/api/members-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import { rosterForRounds } from '@/lib/leagues/sim/runner'

import { anonClient } from './harness'
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
  placeholderTeamIds: string[]
  teamCount: number
  totalRounds: number
  totalPicks: number
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
  const configured = {
    ...settings,
    roster_settings: rosterForRounds(input.rounds),
    draft: {
      ...settings.draft,
      draft_type: 'snake' as const,
      draft_order_mode: input.orderMode ?? ('manual' as const),
      pick_timer_seconds: input.clockSeconds as (typeof settings.draft)['pick_timer_seconds'],
      disconnect_grace_seconds: GRACE_SECONDS,
      draft_scheduled_at: DRAFT_INSTANT,
    },
  }

  const created = await createLeague(commish.client, {
    name,
    season: 2026,
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

  const humanSeats = manager ? 2 : 1
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
    .filter((id) => id !== commishTeamId && id !== managerTeamId)

  const totalRounds = input.rounds
  const result: ProvisionedLeague = {
    leagueId,
    draftId: null,
    commishTeamId,
    managerTeamId,
    placeholderTeamIds,
    teamCount: input.teamCount,
    totalRounds,
    totalPicks: input.teamCount * totalRounds,
  }

  if (input.stayInSetup) return result

  const scheduled = await patchLeague(commish.client, leagueId, { status: 'scheduled' })
  expectStatus(scheduled, [200], 'status → scheduled PATCH')

  if (!input.createDraftRow && !input.start) return result

  const draftCreated = await createDraft(commish.client, leagueId)
  expectStatus(draftCreated, [200, 201], 'createDraft')
  result.draftId = (draftCreated.body as { draft: { id: string } }).draft.id

  const humanOrder =
    input.order === 'manager-first' && managerTeamId
      ? [managerTeamId, commishTeamId]
      : managerTeamId
        ? [commishTeamId, managerTeamId]
        : [commishTeamId]
  const order = [...humanOrder, ...placeholderTeamIds]
  const ordered = await patchDraftOrder(
    commish.client,
    leagueId,
    { order },
    { randomValues: () => [] }, // explicit order — the shuffle arm is unused
  )
  expectStatus(ordered, [200], 'patchDraftOrder')

  if (input.start) {
    const started = await startDraft(commish.client, leagueId)
    expectStatus(started, [200], 'startDraft')
  }

  return result
}
