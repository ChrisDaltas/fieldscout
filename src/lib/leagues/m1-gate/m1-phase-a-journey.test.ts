/**
 * m1-phase-a-journey.test.ts — L.A1.16(1a): the M1 exit-criterion-1 proof
 * (tasks-M1 §1.1 / §8 row 1; spec §18 Phase A gate). This is the gate's
 * NEW work — the integration JOURNEY that proves the L.A1.12–15 pieces
 * COMPOSE: a commissioner creates a league at each §18 size (8/10/12/14/16),
 * fully configures it, invites & seats managers by every path (email-claim,
 * username-claim, link/code join, placeholder fill), and reaches `scheduled`
 * — driving the REAL RPCs/routes end-to-end over the local stack's PostgREST
 * wire path, asserting the actual DB state at each step. NOT a mock, NOT a
 * re-run of unit tests that already pass in isolation.
 *
 * It also pins the v1 templates-only invariant (§7.3.3) at BOTH enforcement
 * points — a PERSONAL (owner-scoped, non-template) scoring_systems id is
 * rejected at create_league AND at update_league_settings — because that is
 * the security-relevant floor the task text names as part of the journey.
 *
 * COMPOSED INTO the gate suite (`npm run test:gate:m1` → vitest.gate-m1.config.ts)
 * alongside the L.A1.11 snapshot force-transition probes (lifecycle-db),
 * the L.A1.13 per-§7.3-field round-trip (settings-round-trip-db), and the
 * L.A1.9(5)/L.A1.10 template parity + TS↔DB equivalence suites — one file
 * per §1 exit criterion. See PROGRESS §8 for the exit-criterion → proof map.
 *
 * FALSIFIABILITY (§4.3 — the whole point of a gate): every assertion below
 * would genuinely FAIL if its criterion regressed. The seat-count invariant
 * is decomposed (1 commissioner + 1 email-claim + 1 username-claim + 1
 * code-join + (team_count − 4) placeholders == team_count) so a dropped or
 * mis-seated step cannot pass vacuously; the deliberate-break probe recorded
 * in the L.A1.16 session log skips one placeholder fill and shows the gate go
 * RED on exactly the seat-count pin.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) — the
 * gate runner (`scripts/gate-m1.sh`) does a fresh `supabase db reset` first,
 * so the journey runs against a pristine, fully-migrated chain (001–063).
 * FAILS loudly when the stack is down; never skips (§4.3; D59(5)).
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first (the D3/D17
 * ESLint bans cover `src/lib/leagues/**` — no wall-clock/random uniqueness).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { EmailMessage, EmailSender } from '@/lib/email/email-sender'
import type { Database } from '@/types/database'

import {
  createInvite,
  claimInvite,
  joinLeague,
} from '../api/invites-service'
import { createLeague, getLeagueDetail, patchLeague } from '../api/leagues-service'
import { addPlaceholderSeat } from '../api/members-service'
import {
  defaultsForTeamCount,
  V1_TEAM_COUNTS,
  type LeagueSettings,
} from '../settings/league-settings'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME_PREFIX = 'vitest-m1gate-league'

/** A fixed future draft instant — no wall clock (D3/D17). */
const DRAFT_INSTANT = '2026-09-13T17:00:00.000Z'
/** A non-default faab set at create so the round-trip pin is falsifiable. */
const CREATE_FAAB = 300

const CREATOR = {
  email: 'm1gate-creator@fieldscout.test',
  password: 'pgtap-m1gate-pass-1',
  username: 'm1g_creator_1',
}
/** Seated by an EMAIL-targeted invite → claim (invited_email stored in a
 *  different case than the account's, so a successful claim also proves
 *  case-insensitive JWT-email matching, E65). */
const INVITEE = {
  email: 'm1gate-invitee@fieldscout.test',
  password: 'pgtap-m1gate-pass-2',
  username: 'm1g_invitee_2',
}
/** Seated by a USERNAME-targeted invite → claim. */
const UNAME = {
  email: 'm1gate-uname@fieldscout.test',
  password: 'pgtap-m1gate-pass-3',
  username: 'm1g_uname_3',
}
/** Seated by joining with the league share code (the "link" path). Joins all
 *  five leagues — a FREE user in five leagues (the C3/C4 018-cap regression
 *  the invite suite pins, re-exercised here inside the gate journey). */
const JOINER = {
  email: 'm1gate-joiner@fieldscout.test',
  password: 'pgtap-m1gate-pass-4',
  username: 'm1g_joiner_4',
}
/** Owns the PERSONAL (non-template) scoring system for the templates-only
 *  negative probe. */
const OUTSIDER = {
  email: 'm1gate-outsider@fieldscout.test',
  password: 'pgtap-m1gate-pass-5',
  username: 'm1g_out_5',
}

/** Fixed action_ids — one per logical create in this suite (deterministic). */
const ACTION = {
  sweep8: 'b0000000-0000-4000-8000-000000000008',
  sweep10: 'b0000000-0000-4000-8000-000000000010',
  sweep12: 'b0000000-0000-4000-8000-000000000012',
  sweep14: 'b0000000-0000-4000-8000-000000000014',
  sweep16: 'b0000000-0000-4000-8000-000000000016',
  probe: 'b0000000-0000-4000-8000-0000000000b1',
  rejectedCreate: 'b0000000-0000-4000-8000-0000000000b2',
} as const
const sweepActionId = (teamCount: number): string =>
  ACTION[`sweep${teamCount}` as keyof typeof ACTION]

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

/** Capturing fake for the D37 email seam (the email-seat path's send test). */
class CapturingEmailSender implements EmailSender {
  messages: EmailMessage[] = []
  async send(message: EmailMessage) {
    this.messages.push(message)
    return { ok: true, sender: 'capturing-fake' }
  }
}

let creatorClient: SupabaseClient<Database>
let inviteeClient: SupabaseClient<Database>
let unameClient: SupabaseClient<Database>
let joinerClient: SupabaseClient<Database>
let creatorId: string
let inviteeId: string
let unameId: string
let joinerId: string
let espnStandardId: string
let personalScoringId: string

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service
    .from('leagues')
    .select('id')
    .like('name', `${LEAGUE_NAME_PREFIX}%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    // teams.league_id has no ON DELETE action — clear franchises first.
    await service.from('teams').delete().in('league_id', ids)
    await service.from('leagues').delete().in('id', ids)
  }
  // The personal scoring system is owner-scoped; delete it before its owner.
  await service.from('scoring_systems').delete().eq('name', 'vitest-m1gate-personal')
  for (const u of [CREATOR, INVITEE, UNAME, JOINER, OUTSIDER]) {
    await deleteUserByUsername(u.username)
  }
}

async function createUser(user: {
  email: string
  password: string
  username: string
}): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error(`createUser(${user.email}) failed: ${error.message}`)
  return data.user.id
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/** The full valid create body for one sweep size (non-default faab so the
 *  create-time configure round-trip below is falsifiable). */
function sweepInput(teamCount: (typeof V1_TEAM_COUNTS)[number]): {
  name: string
  season: number
  scoring_system_id: string
  team_name: string
  action_id: string
  settings: LeagueSettings
} {
  const settings = defaultsForTeamCount(teamCount)
  settings.faab_budget = CREATE_FAAB
  return {
    name: `${LEAGUE_NAME_PREFIX}-${teamCount}`,
    season: 2026,
    scoring_system_id: espnStandardId,
    team_name: `Gate Commish ${teamCount}`,
    action_id: sweepActionId(teamCount),
    settings,
  }
}

beforeAll(async () => {
  await cleanup()

  creatorId = await createUser(CREATOR)
  inviteeId = await createUser(INVITEE)
  unameId = await createUser(UNAME)
  joinerId = await createUser(JOINER)
  await createUser(OUTSIDER)

  creatorClient = await signIn(CREATOR)
  inviteeClient = await signIn(INVITEE)
  unameClient = await signIn(UNAME)
  joinerClient = await signIn(JOINER)

  const { data: template } = await service
    .from('scoring_systems')
    .select('id')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  if (!template) throw new Error('ESPN Standard template missing (is 058 applied?)')
  espnStandardId = template.id

  // A PERSONAL (owner-scoped, non-template) scoring system — the v1
  // templates-only negative (§7.3.3), owned by the outsider fixture.
  const { data: outsiderProfile } = await service
    .from('profiles')
    .select('id')
    .eq('username', OUTSIDER.username)
    .single()
  const { data: personal, error: personalError } = await service
    .from('scoring_systems')
    .insert({
      owner_id: outsiderProfile?.id ?? '',
      name: 'vitest-m1gate-personal',
      rules: { passing_yards: 0.05 },
    })
    .select('id')
    .single()
  if (personalError || !personal) {
    throw new Error(`personal scoring seed failed: ${personalError?.message}`)
  }
  personalScoringId = personal.id
}, 60_000)

afterAll(async () => {
  await cleanup()
})

// ---------------------------------------------------------------------------
// The v1 templates-only invariant (§7.3.3), pinned at BOTH enforcement points
// (task item 1a: "personal scoring-system id rejected at create AND at PATCH").
// ---------------------------------------------------------------------------

describe('M1 gate — templates-only invariant (§7.3.3), create AND PATCH', () => {
  let probeLeagueId: string

  beforeAll(async () => {
    // A live setup-state league to run the PATCH-side probe against.
    const result = await createLeague(creatorClient, {
      ...sweepInput(8),
      name: `${LEAGUE_NAME_PREFIX}-probe`,
      action_id: ACTION.probe,
    })
    if (result.status !== 201) {
      throw new Error(`probe league create failed: ${JSON.stringify(result.body)}`)
    }
    probeLeagueId = (result.body as { league_id: string }).league_id
  }, 30_000)

  it('create_league REJECTS a personal (non-template) scoring id — 400 per-field, NO league row', async () => {
    const result = await createLeague(creatorClient, {
      ...sweepInput(10),
      name: `${LEAGUE_NAME_PREFIX}-rejected`,
      action_id: ACTION.rejectedCreate,
      scoring_system_id: personalScoringId,
    })
    expect(result.status).toBe(400)
    const body = result.body as { error: { fieldErrors: Record<string, string[]> } }
    expect(body.error.fieldErrors.scoring_system_id?.[0]).toContain(
      'personal scoring systems cannot be attached to a league in v1',
    )

    // No-write pin: the rejected create left nothing behind.
    const { data: rows } = await service
      .from('leagues')
      .select('id')
      .eq('creation_action_id', ACTION.rejectedCreate)
    expect(rows).toHaveLength(0)
  })

  it('update_league_settings REJECTS a personal scoring id — 400 per-field, scoring_system_id UNCHANGED', async () => {
    // Baseline: the probe league is on the ESPN Standard template.
    const { data: before } = await service
      .from('leagues')
      .select('scoring_system_id')
      .eq('id', probeLeagueId)
      .single()
    expect(before?.scoring_system_id).toBe(espnStandardId)

    const result = await patchLeague(creatorClient, probeLeagueId, {
      scoring_system_id: personalScoringId,
    })
    expect(result.status).toBe(400)
    const body = result.body as { error: { fieldErrors: Record<string, string[]> } }
    expect(body.error.fieldErrors.scoring_system_id?.[0]).toContain(
      'personal scoring systems cannot be attached to a league in v1',
    )

    // No-write pin: the reference is untouched.
    const { data: after } = await service
      .from('leagues')
      .select('scoring_system_id')
      .eq('id', probeLeagueId)
      .single()
    expect(after?.scoring_system_id).toBe(espnStandardId)
  })
})

// ---------------------------------------------------------------------------
// The Phase A journey at every §18 size. One league per size, carried from
// create through configure → seat (every path) → scheduled.
// ---------------------------------------------------------------------------

describe('M1 gate — Phase A journey at every §18 size (8/10/12/14/16)', () => {
  it.each([...V1_TEAM_COUNTS])(
    'create → configure → email/username/link seat → placeholder fill → scheduled at team_count %i',
    async (teamCount) => {
      // -- 1. CREATE (real create_league RPC via the service layer) ---------
      const input = sweepInput(teamCount)
      const created = await createLeague(creatorClient, input)
      expect(created.status).toBe(201)
      const { league_id: leagueId, team_id: commishTeamId } = created.body as {
        league_id: string
        team_id: string
      }

      const { data: leagueRow } = await service
        .from('leagues')
        .select('status, team_count, max_teams, owner_id, invite_code')
        .eq('id', leagueId)
        .single()
      expect(leagueRow?.status).toBe('setup')
      expect(leagueRow?.team_count).toBe(teamCount)
      expect(leagueRow?.max_teams).toBe(teamCount)
      expect(leagueRow?.owner_id).toBe(creatorId)
      const inviteCode = leagueRow?.invite_code ?? ''
      expect(inviteCode).toHaveLength(10)

      // The creator is seated as commissioner on their franchise (seat 1).
      const { data: commishMember } = await service
        .from('league_members')
        .select('user_id, role, team_id, is_placeholder')
        .eq('league_id', leagueId)
        .single()
      expect(commishMember).toMatchObject({
        user_id: creatorId,
        role: 'commissioner',
        team_id: commishTeamId,
        is_placeholder: false,
      })

      // -- 2. CONFIGURE (real update_league_settings PATCH) -----------------
      // The create-time non-default faab round-trips (create-side configure),
      // and a PATCH sets the draft instant the scheduled transition requires
      // (PATCH-side configure). The exhaustive per-§7.3-field round-trip is
      // the L.A1.13 suite, re-run in the same gate.
      const detailAfterCreate = await getLeagueDetail(creatorClient, creatorId, leagueId)
      expect(detailAfterCreate.status).toBe(200)
      expect((detailAfterCreate.body as { settings: LeagueSettings }).settings.faab_budget).toBe(
        CREATE_FAAB,
      )

      const configured = await patchLeague(creatorClient, leagueId, {
        settings: { draft: { draft_scheduled_at: DRAFT_INSTANT } },
      })
      expect(configured.status).toBe(200)
      const detailAfterPatch = await getLeagueDetail(creatorClient, creatorId, leagueId)
      expect(
        (detailAfterPatch.body as { settings: LeagueSettings }).settings.draft.draft_scheduled_at,
      ).toBe(DRAFT_INSTANT)

      // -- 3a. EMAIL seat: placeholder → seat-targeted email invite → claim --
      const emailSeat = await addPlaceholderSeat(creatorClient, leagueId, {
        team_name: 'Email Seat',
      })
      expect(emailSeat.status).toBe(201)
      const emailTeamId = (emailSeat.body as { team_id: string }).team_id
      const sender = new CapturingEmailSender()
      const emailInvite = await createInvite(
        creatorClient,
        leagueId,
        {
          target_team_id: emailTeamId,
          // Different case than the account — E65 case-insensitive matching.
          invited_email: 'M1Gate-Invitee@Fieldscout.TEST',
        },
        sender,
      )
      expect(emailInvite.status).toBe(201)
      const emailToken = (emailInvite.body as { token: string }).token
      // The D37 seam sent league name + team label + the /join/[token] link.
      expect(sender.messages).toHaveLength(1)
      expect(sender.messages[0].text).toContain(`/join/${emailToken}`)
      const emailClaim = await claimInvite(inviteeClient, { token: emailToken })
      expect(emailClaim.status).toBe(200)
      expect((emailClaim.body as { team_id: string }).team_id).toBe(emailTeamId)

      // -- 3b. USERNAME seat: placeholder → username invite → claim ---------
      const unameSeat = await addPlaceholderSeat(creatorClient, leagueId, {
        team_name: 'Username Seat',
      })
      expect(unameSeat.status).toBe(201)
      const unameTeamId = (unameSeat.body as { team_id: string }).team_id
      const unameInvite = await createInvite(creatorClient, leagueId, {
        target_team_id: unameTeamId,
        invited_username: UNAME.username,
      })
      expect(unameInvite.status).toBe(201)
      const unameClaim = await claimInvite(unameClient, {
        token: (unameInvite.body as { token: string }).token,
      })
      expect(unameClaim.status).toBe(200)
      expect((unameClaim.body as { team_id: string }).team_id).toBe(unameTeamId)

      // -- 3c. LINK seat: a free user joins with the share code -------------
      const joined = await joinLeague(joinerClient, { code: inviteCode })
      expect(joined.status).toBe(200)
      const joinerTeamId = (joined.body as { team_id: string }).team_id

      // -- 4. PLACEHOLDER FILL to team_count (the remaining seats) ----------
      // Seats so far: commissioner + email + username + joiner = 4.
      const placeholderTeamIds: string[] = []
      for (let i = 0; i < teamCount - 4; i++) {
        const fill = await addPlaceholderSeat(creatorClient, leagueId, {})
        expect(fill.status).toBe(201)
        placeholderTeamIds.push((fill.body as { team_id: string }).team_id)
      }

      // Adding one more than team_count is refused (capacity floor, §7.2).
      const overfill = await addPlaceholderSeat(creatorClient, leagueId, {})
      expect(overfill.status).toBe(400)

      // -- 4b. SEAT-COUNT INVARIANT (the falsifiable decomposition) ---------
      const { data: members } = await service
        .from('league_members')
        .select('user_id, is_placeholder')
        .eq('league_id', leagueId)
      const { count: teamCountRows } = await service
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)

      expect(members).toHaveLength(teamCount)
      expect(teamCountRows).toBe(teamCount)

      const claimedUserIds = (members ?? [])
        .filter((m) => !m.is_placeholder && m.user_id !== null)
        .map((m) => m.user_id)
        .sort()
      // Exactly the four real seats, one per path — no dup, no missing seat.
      expect(claimedUserIds).toStrictEqual([creatorId, inviteeId, unameId, joinerId].sort())
      const placeholders = (members ?? []).filter((m) => m.is_placeholder && m.user_id === null)
      expect(placeholders).toHaveLength(teamCount - 4)

      // The three seat-targeted claims/joins landed on the exact franchises.
      const { data: seatedTeams } = await service
        .from('league_members')
        .select('user_id, team_id')
        .eq('league_id', leagueId)
        .in('user_id', [inviteeId, unameId, joinerId])
      const byUser = Object.fromEntries((seatedTeams ?? []).map((r) => [r.user_id, r.team_id]))
      expect(byUser[inviteeId]).toBe(emailTeamId)
      expect(byUser[unameId]).toBe(unameTeamId)
      expect(byUser[joinerId]).toBe(joinerTeamId)
      expect(placeholderTeamIds).toHaveLength(teamCount - 4)

      // -- 5. REACH `scheduled` (real set_league_status via the PATCH route) -
      const scheduled = await patchLeague(creatorClient, leagueId, { status: 'scheduled' })
      expect(scheduled.status).toBe(200)
      const { data: finalRow } = await service
        .from('leagues')
        .select('status')
        .eq('id', leagueId)
        .single()
      expect(finalRow?.status).toBe('scheduled')
    },
    120_000,
  )
})
