/**
 * scoring-round-trip-db.test.ts — SE.9(2)'s ROUND TRIP at the wire:
 * template → fork → edit → back to a plain template through the settings
 * surface → the member view shows the template again (tasks-SE SE.9(2);
 * spec §7.3.3.1 entry-point + access bullets, §12.25 orphan hygiene).
 *
 * Driven over the LOCAL stack through PostgREST by real signed-in users,
 * through the SAME service functions the UI's routes run: the fork and save
 * (`forkScoringTemplate` / `updateScoringRules` — SE.6's two verbs) and the
 * settings panel's re-pick (`patchLeague` with `scoring_system_id` — the
 * amended-061 attach path, SE.5). The MEMBER legs read exactly what the
 * member view reads: `useLeagueScoringFamily`'s two-step
 * (`leagues.scoring_rules_snapshot`/`scoring_system_id`, then
 * `scoring_systems.rules` by id — use-draft-pool.ts:267-272) issued as the
 * member's own PostgREST selects, so what these cells prove is the member
 * view's actual data path, not a lookalike.
 *
 * THE ORPHAN PROPERTY (§12.25), observed at this layer and CITED below it:
 * pgTAP 053 owns the RPC/policy matrices — F4 (re-picking a template is
 * accepted and the repoint IS the detach), F5 (the detached fork row still
 * EXISTS), E4 (the member's SELECT stops matching the moment the league
 * repoints away) — this suite does not re-prove the policy clauses, it
 * observes the same property through the member's wire path and asserts the
 * REASON for the empty read (the row exists under a privileged read while
 * the member reads 0 — policy, not deletion; CLAUDE.md's "assert the reason
 * for emptiness" rule).
 *
 * NOT here (owned elsewhere): guardrail refusals and the per-verb refusal
 * matrix (`scoring-api-db.test.ts`); §12.25 clause isolation (pgTAP 053 §E);
 * the walls (pgTAP 052). No wall clock is read.
 *
 * Requires the local stack — D59(5); FAILS loudly when the stack is down,
 * never skips (§4.3). Determinism: fixed emails/usernames (prefix `se9` —
 * the D108(14)/D114(10) registry), fixture names unique to this suite
 * (`vitest-se9-*`), cleanup-first.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import type { ScoringRulesDocV2 } from '../scoring/rules-doc'
import { defaultsForTeamCount } from '../settings/league-settings'
import { createLeague, patchLeague } from './leagues-service'
import { forkScoringTemplate, updateScoringRules } from './scoring-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME_PREFIX = 'vitest-se9-league'
const CREATE_ACTION_ID = '5e900000-0000-4000-8000-000000000001'

const COMMISH = {
  email: 'se9-commish@fieldscout.test',
  password: 'pgtap-leagues-pass-5',
  username: 'se9_commish_one',
}
const MEMBER = {
  email: 'se9-member@fieldscout.test',
  password: 'pgtap-leagues-pass-6',
  username: 'se9_member_two',
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let memberClient: SupabaseClient<Database>
let espnStandardId: string
let leagueId: string
/** Written by LEG 1, read by every later leg. */
let forkedId: string

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
    await service.from('teams').delete().in('league_id', ids)
    await service.from('leagues').delete().in('id', ids)
  }
  // AFTER the leagues: a fork row is FK-referenced while its league lives.
  // Fork rows are named "<League> Custom", so the league prefix finds them.
  await service.from('scoring_systems').delete().like('name', `${LEAGUE_NAME_PREFIX}%`)
  await deleteUserByUsername(COMMISH.username)
  await deleteUserByUsername(MEMBER.username)
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/**
 * The member view's read path, replayed as the MEMBER'S OWN wire calls
 * (use-draft-pool.ts's `useLeagueScoringFamily` two-step): the league row
 * first (snapshot-or-reference), then the scoring row by id under whatever
 * SELECT policy admits it. Returns what a member-view render would receive.
 */
async function memberViewRead(client: SupabaseClient<Database>): Promise<{
  reference: string | null
  snapshot: unknown
  scoringRows: Array<{ id: string; is_template: boolean; rules: unknown }>
}> {
  const { data: league, error: leagueError } = await client
    .from('leagues')
    .select('scoring_rules_snapshot, scoring_system_id')
    .eq('id', leagueId)
    .single()
  if (leagueError) throw new Error(`league read failed: ${leagueError.message}`)
  const reference = league.scoring_system_id
  if (reference === null) return { reference, snapshot: league.scoring_rules_snapshot, scoringRows: [] }
  const { data: rows, error } = await client
    .from('scoring_systems')
    .select('id, is_template, rules')
    .eq('id', reference)
  if (error) throw new Error(`scoring read failed: ${error.message}`)
  return { reference, snapshot: league.scoring_rules_snapshot, scoringRows: rows ?? [] }
}

describe('SE.9 round trip: template → fork → edit → re-pick template → member sees the template (local stack)', () => {
  beforeAll(async () => {
    await cleanup()

    for (const user of [COMMISH, MEMBER]) {
      const { error } = await service.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { username: user.username },
      })
      if (error) throw new Error(`createUser(${user.email}) failed: ${error.message}`)
    }

    const { data: template } = await service
      .from('scoring_systems')
      .select('id')
      .eq('is_template', true)
      .eq('name', 'ESPN Standard')
      .single()
    if (!template) throw new Error('ESPN Standard template missing (is 058 applied?)')
    espnStandardId = template.id

    commishClient = await signIn(COMMISH)
    memberClient = await signIn(MEMBER)

    const created = await createLeague(commishClient, {
      name: `${LEAGUE_NAME_PREFIX}-loop`,
      season: 2026,
      scoring_system_id: espnStandardId,
      team_name: 'SE9 Loop',
      action_id: CREATE_ACTION_ID,
      settings: defaultsForTeamCount(12),
    })
    if (created.status !== 201) {
      throw new Error(`fixture create failed (${created.status}): ${JSON.stringify(created.body)}`)
    }
    leagueId = (created.body as { league_id: string }).league_id

    // Seat the member (plain manager) — the §12.25 policy's join is
    // league_members, so no team row is needed for the read path.
    const { data: memberProfile } = await service
      .from('profiles')
      .select('id')
      .eq('username', MEMBER.username)
      .single()
    if (!memberProfile) throw new Error('member profile missing')
    const { error: seatError } = await service.from('league_members').insert({
      league_id: leagueId,
      user_id: memberProfile.id,
      role: 'manager',
    })
    if (seatError) throw new Error(`member seat failed: ${seatError.message}`)
  }, 60_000)

  afterAll(async () => {
    await cleanup()
  })

  it('LEG 0 — before any fork, the member view reads the TEMPLATE (no snapshot, world-readable template row)', async () => {
    const view = await memberViewRead(memberClient)
    expect(view.snapshot).toBeNull()
    expect(view.reference).toBe(espnStandardId)
    expect(view.scoringRows).toHaveLength(1)
    expect(view.scoringRows[0].is_template).toBe(true)
  })

  it('LEG 1 — Customize: the fork repoints the league at a fresh non-template row', async () => {
    const result = await forkScoringTemplate(commishClient, leagueId, {
      template_id: espnStandardId,
    })
    expect(result.status).toBe(200)
    forkedId = (result.body as { scoring_system_id: string }).scoring_system_id
    expect(forkedId).not.toBe(espnStandardId)

    const { data: league } = await service
      .from('leagues')
      .select('scoring_system_id')
      .eq('id', leagueId)
      .single()
    expect(league?.scoring_system_id).toBe(forkedId)
  })

  it('LEG 2 — the member reads the FORK over §12.25\'s member policy (the member view on a customized league)', async () => {
    const view = await memberViewRead(memberClient)
    expect(view.reference).toBe(forkedId)
    expect(view.scoringRows).toHaveLength(1)
    expect(view.scoringRows[0].is_template).toBe(false)
    expect((view.scoringRows[0].rules as ScoringRulesDocV2).format).toBe(2)
  })

  it('LEG 3 — an edit lands and a member\'s FRESH read sees it (F167 untouched: this is a new SELECT, not a mounted cache)', async () => {
    const stored = (await memberViewRead(memberClient)).scoringRows[0]
      .rules as ScoringRulesDocV2
    const edited = { ...stored, positions: { WR: { receptions: 1.5 } } }
    const saved = await updateScoringRules(commishClient, leagueId, { rules: edited })
    expect(saved.status).toBe(200)

    const view = await memberViewRead(memberClient)
    expect(view.scoringRows[0].rules).toStrictEqual(edited)
  })

  it('LEG 4 — back to a plain template through the settings surface (the amended 061 accepts the re-pick; the repoint IS the detach)', async () => {
    const result = await patchLeague(commishClient, leagueId, {
      scoring_system_id: espnStandardId,
    })
    expect(result.status).toBe(200)

    const { data: league } = await service
      .from('leagues')
      .select('scoring_system_id')
      .eq('id', leagueId)
      .single()
    expect(league?.scoring_system_id).toBe(espnStandardId)
  })

  it('LEG 5 — the orphan property at the member\'s wire path: the fork row EXISTS (privileged read) while the member reads 0 rows — policy, not deletion (§12.25; pgTAP 053 F4/F5/E4 cited)', async () => {
    // (a) the detached fork row is left in place — §12.25's ruling, observed.
    const { data: orphan } = await service
      .from('scoring_systems')
      .select('id, is_template')
      .eq('id', forkedId)
      .single()
    expect(orphan?.id).toBe(forkedId)
    expect(orphan?.is_template).toBe(false)

    // (b) the member's SELECT on that same row now matches NOTHING — the
    //     policy's league-reference clause stopped matching when the league
    //     repointed away. (a) is what makes this emptiness attributable to
    //     the policy rather than to a deleted row.
    const { data: memberRead, error } = await memberClient
      .from('scoring_systems')
      .select('id')
      .eq('id', forkedId)
    expect(error).toBeNull()
    expect(memberRead).toStrictEqual([])

    // (c) the member view shows the TEMPLATE again — LEG 0's read, closing
    //     the loop.
    const view = await memberViewRead(memberClient)
    expect(view.reference).toBe(espnStandardId)
    expect(view.scoringRows).toHaveLength(1)
    expect(view.scoringRows[0].is_template).toBe(true)
  })

  it('LEG 6 — re-Customize after the round trip mints a FRESH fork (the state key: the old orphan\'s rules differ), leaving the orphan in place', async () => {
    const again = await forkScoringTemplate(commishClient, leagueId, {
      template_id: espnStandardId,
    })
    expect(again.status).toBe(200)
    const secondForkId = (again.body as { scoring_system_id: string }).scoring_system_id
    // The league now references a fork that is NOT the orphaned first fork
    // (105's idempotency key is the STATE — the orphan carries LEG 3's edit,
    // so it cannot be re-matched; a fresh row is minted).
    expect(secondForkId).not.toBe(forkedId)
    expect(secondForkId).not.toBe(espnStandardId)

    // Both fork rows exist; the member reads exactly the referenced one.
    const { data: forks } = await service
      .from('scoring_systems')
      .select('id')
      .in('id', [forkedId, secondForkId])
    expect(forks?.map((r) => r.id).sort()).toStrictEqual([forkedId, secondForkId].sort())
    const view = await memberViewRead(memberClient)
    expect(view.reference).toBe(secondForkId)
    expect(view.scoringRows.map((r) => r.id)).toStrictEqual([secondForkId])
  })
})
