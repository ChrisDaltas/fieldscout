/**
 * scoring-walls-db.test.ts — **SE.4b(5): the bypass, refused at the write.**
 *
 * D175 is Chris's ruling in one sentence — *"creating an invalid scoring
 * system should not be possible"* — and pgTAP 052 proves the two triggers in
 * the database. This file proves them **at the layer that matters**: a
 * commissioner's own signed-in Supabase client, over PostgREST, over HTTP.
 * A trigger a client can route around is not a wall, and `set local role
 * authenticated` in psql is the same in-database subject but not the same
 * request.
 *
 * ── WHAT THE THREE ACTS ARE ────────────────────────────────────────────────
 *
 * 1. **THE BYPASS.** §12.25 names 001:623's `"Users can manage own scoring
 *    systems" FOR ALL` as the reason a backstop was needed at all: a
 *    commissioner can hand-write their own row straight through PostgREST,
 *    with no RPC in the path. That policy is still live (asserted, not
 *    assumed — the same client renames the row successfully), and the
 *    write of the F21 double-pay document through it now FAILS. The test
 *    records exactly what a caller gets back: HTTP status, `code`,
 *    `message`, `details`, `hint` — because SE.5's RPCs and SE.6's routes
 *    turn those last three into a field-level error, and a wall that raised
 *    a different shape would break both tasks downstream.
 *
 * 2. **THE D33 CONTROL.** The same client, the same session, a legacy
 *    research row: a legacy-namespace document lands. Without this, act 1
 *    is equally consistent with "clients can no longer write scoring
 *    systems", which is not the ruling and would be a regression.
 *
 * 3. **THE SECOND WALL, PROVED INDEPENDENTLY** — the corrupt-while-attached
 *    state forged, then `draft_start` refusing to snapshot it.
 *
 * ── A DOCUMENTED ADAPTATION, AND THE FINDING BEHIND IT (§4 rule 9) ─────────
 * tasks-SE §5 SE.4b(5) prescribes forging act 3's state with
 * `ALTER TABLE scoring_systems DISABLE TRIGGER` as superuser, calling that
 * "the only way the state can exist". **Measured, it is not the only way, and
 * the other way needs no DDL and no superuser:**
 *
 *    a. the commissioner writes the corrupt flat document to a row of their
 *       own **while it is unreferenced** — legal, and it must stay legal,
 *       because an unreferenced non-template flat row is a D33 research row
 *       and the league validator has no jurisdiction over it;
 *    b. the league is then **repointed** at that row — a write to `leagues`,
 *       which wall 1 does not watch (it guards `scoring_systems`) and wall 2
 *       does not watch either (it guards `scoring_rules_snapshot`, unchanged
 *       here).
 *
 * So this suite forges the state the way it can actually arise, which makes
 * the proof stronger rather than weaker: wall 1 never fires at all in act 3,
 * so wall 2's refusal is genuinely independent of it. It also measures why
 * D169's attach-time `PERFORM scoring_rules_validate` in `update_league_settings`
 * is still owed by **SE.5**: step (b) is the door it closes. Today the
 * client-only version of step (b) is blocked by 061's template-only predicate
 * (`update_league_settings` refuses a non-template row), so the repoint here
 * is done with `service_role` — privileged, exactly as SE.4b(5) intends.
 *
 * Requires the local stack (`npx supabase start` + migrations applied through
 * 104) — the D59(5) precondition. FAILS loudly when the stack is down; never
 * skips (§4.3).
 *
 * Determinism: fixed emails/usernames/ids/action ids, a fixed future draft
 * instant, cleanup-first. No wall clock is read anywhere (the D3/D17 ESLint
 * guard covers `src/lib/leagues/**`).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { patchLeague } from '../api/leagues-service'
import { addPlaceholderSeat } from '../api/members-service'
import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { forkTemplateDoc, type FlatScoringRules } from './rules-doc'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-se4b-walls-league'
const FORK_NAME = 'vitest-se4b-fork'
const RESEARCH_NAME = 'vitest-se4b-research'
const ATTACHED_NAME = 'vitest-se4b-flat-attached'
const DRAFT_INSTANT = '2027-09-01T17:00:00+00:00'
const TEAM_COUNT = 8

const COMMISH = {
  email: 'se4b-walls-commish@fieldscout.test',
  password: 'pgtap-se4b-pass-1',
  username: 'se4b_wall_commish',
}

const ACTION = { create: 'ae520000-0000-4000-8000-000000000001' } as const

/** The literal F21 was filed for (R55): a PA=18–20 week one-hots BOTH
 *  families' buckets and pays `def_pa_14_20` + `def_pa_18_27` — 7 = 4 + 3
 *  through the shipped derivation and the shipped calculator (SE.3 measured
 *  it before refusing it), where either key alone pays once. */
const F21_DOUBLE_PAY: FlatScoringRules = { def_pa_14_20: 4, def_pa_18_27: 3 }

/** A legal flat league document — the same namespace, nothing overlapping. */
const VALID_FLAT: FlatScoringRules = { pass_yards: 0.04, receptions: 1 }

/** A legacy RESEARCH document (`src/lib/scoring/default.ts`'s world, D33).
 *  Not one of these keys is a §23.5 registry key, which is precisely why the
 *  league validator must never be pointed at it. */
const LEGACY_RESEARCH: FlatScoringRules = { passing_yards: 0.05 }

const PLAYERS = Array.from({ length: 20 }, (_, i) => ({
  id: `se4b-rb${String(i + 1).padStart(2, '0')}`,
  full_name: `SE4b RB ${String(i + 1).padStart(2, '0')}`,
  position: 'RB',
  adp: (i + 1) / 100,
}))

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let commishToken: string
let leagueId: string
let forkId: string
let researchId: string
let attachedId: string
let templateRules: FlatScoringRules

/** The exact PostgREST error a caller sees, flattened for comparison. */
interface WireError {
  code: string | null
  message: string
  details: string | null
  hint: string | null
}

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
    // Detach before deleting the systems: leagues.scoring_system_id is an FK.
    await service.from('leagues').update({ scoring_system_id: null }).in('id', ids)
    await service.from('drafts').delete().in('league_id', ids)
    await service.from('teams').delete().in('league_id', ids)
    await service.from('leagues').delete().in('id', ids)
  }
  await service
    .from('scoring_systems')
    .delete()
    .in('name', [FORK_NAME, RESEARCH_NAME, ATTACHED_NAME])
  await service
    .from('players')
    .delete()
    .in(
      'id',
      PLAYERS.map((p) => p.id),
    )
  await deleteUserByUsername(COMMISH.username)
}

async function signIn(user: {
  email: string
  password: string
}): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/** Read a scoring row's `rules` privileged — the unchanged-proof for every
 *  refusal below. Reading it as the writer would confound "the write was
 *  refused" with "the read was filtered". */
async function rulesOf(id: string): Promise<unknown> {
  const { data, error } = await service.from('scoring_systems').select('rules').eq('id', id).single()
  if (error) throw new Error(`rulesOf(${id}) failed: ${error.message}`)
  return data.rules
}

beforeAll(async () => {
  await cleanup()

  const { error: userError } = await service.auth.admin.createUser({
    email: COMMISH.email,
    password: COMMISH.password,
    email_confirm: true,
    user_metadata: { username: COMMISH.username },
  })
  if (userError) throw new Error(`createUser failed: ${userError.message}`)
  commishClient = await signIn(COMMISH)
  const { data: session } = await commishClient.auth.getSession()
  if (!session.session) throw new Error('no session for the commissioner client')
  commishToken = session.session.access_token

  await service.from('players').upsert([...PLAYERS])

  const { data: template, error: templateError } = await commishClient
    .from('scoring_systems')
    .select('id, rules')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  if (templateError || !template) {
    throw new Error(`ESPN Standard template missing (is 058 applied?): ${templateError?.message}`)
  }
  templateRules = template.rules as FlatScoringRules

  const settings = defaultsForTeamCount(TEAM_COUNT)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [`p_${key}`, value]),
  )
  const { data: created, error: createError } = await commishClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: 2026,
    p_scoring_system_id: template.id,
    p_team_name: 'Wall Commish Team',
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

  // THE FORK ROW, INSERTED BY THE COMMISSIONER'S OWN CLIENT. SE.5's
  // `scoring_fork_template` does not exist yet, and that is the point: this is
  // the raw 001:623 path the RPC will eventually front, so the row is created
  // exactly the way an unassisted client could create it — and wall 1 sees it
  // (a `format` member is arm (b) of the profile, D175(2)).
  const { data: fork, error: forkError } = await commishClient
    .from('scoring_systems')
    .insert({
      name: FORK_NAME,
      owner_id: session.session.user.id,
      is_template: false,
      rules: forkTemplateDoc(templateRules) as unknown as Database['public']['Tables']['scoring_systems']['Insert']['rules'],
    })
    .select('id')
    .single()
  if (forkError || !fork) throw new Error(`fork insert failed: ${forkError?.message}`)
  forkId = fork.id

  // Repoint the league at the fork (service_role: 061's step-5 predicate is
  // still template-only until SE.5's D169 amendment lands, so there is no
  // client path yet — stated rather than worked around).
  const { error: repointError } = await service
    .from('leagues')
    .update({ scoring_system_id: forkId })
    .eq('id', leagueId)
  if (repointError) throw new Error(`repoint failed: ${repointError.message}`)

  // A personal RESEARCH row, owned by the same commissioner, referenced by
  // nothing — act 2's control.
  const { data: research, error: researchError } = await commishClient
    .from('scoring_systems')
    .insert({
      name: RESEARCH_NAME,
      owner_id: session.session.user.id,
      is_template: false,
      rules: LEGACY_RESEARCH as unknown as Database['public']['Tables']['scoring_systems']['Insert']['rules'],
    })
    .select('id')
    .single()
  if (researchError || !research) throw new Error(`research insert failed: ${researchError?.message}`)
  researchId = research.id
}, 180_000)

afterAll(async () => {
  await cleanup()
})

describe('SE.4b — the three write walls, over the wire (migration 104; D175/D168/R618)', () => {
  it('act 1 premise: 001:623 FOR ALL is LIVE — the commissioner writes their own scoring row with no RPC in the path', async () => {
    const { error, data } = await commishClient
      .from('scoring_systems')
      .update({ description: 'the bypass path, still open' })
      .eq('id', forkId)
      .select('id')
    expect(error).toBeNull()
    // A RETURNING count, not a silent success: an RLS-filtered UPDATE reports
    // no error and touches nothing, and that is the failure mode this whole
    // suite would otherwise be blind to (CLAUDE.md's "nothing happened").
    expect(data).toHaveLength(1)
  })

  it('act 1: the F21 double-pay document is REFUSED AT THE WRITE, and the caller gets the field-path contract', async () => {
    const before = await rulesOf(forkId)

    const { error, data } = await commishClient
      .from('scoring_systems')
      .update({
        rules: F21_DOUBLE_PAY as unknown as Database['public']['Tables']['scoring_systems']['Update']['rules'],
      })
      .eq('id', forkId)
      .select('id')

    expect(data).toBeNull()
    expect(error).not.toBeNull()

    const wire: WireError = {
      code: error!.code ?? null,
      message: error!.message,
      details: error!.details ?? null,
      hint: error!.hint ?? null,
    }
    // The contract SE.5's RPCs and SE.6's routes consume, asserted axis by
    // axis rather than as "it threw".
    expect(wire.code).toBe('P0001')
    expect(wire.hint).toBe('tier_exclusivity')
    expect(wire.details).toBe('(document)')
    expect(wire.message).toContain('Tier exclusivity (§7.3.3.1 guardrail 2)')
    expect(wire.message).toContain('F21 defect')
    expect(wire.message).toContain('def_pa_14_20')
    expect(wire.message).toContain('def_pa_18_27')

    // And the row is untouched — read privileged, so a filtered read cannot
    // masquerade as an unchanged row.
    expect(await rulesOf(forkId)).toEqual(before)
  })

  it('act 1, at the HTTP layer: the same write over raw fetch returns 400 with the same four fields', async () => {
    // The supabase-js client is a thin wrapper, but "what a caller sees" is an
    // HTTP status and a JSON body, and no assertion above has looked at
    // either. This is the one place the STATUS CODE is pinned — SE.6's route
    // layer has to map it.
    const response = await fetch(
      `${LOCAL_URL}/rest/v1/scoring_systems?id=eq.${forkId}`,
      {
        method: 'PATCH',
        headers: {
          apikey: LOCAL_ANON_KEY,
          Authorization: `Bearer ${commishToken}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ rules: F21_DOUBLE_PAY }),
      },
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as WireError
    expect(body.code).toBe('P0001')
    expect(body.hint).toBe('tier_exclusivity')
    expect(body.details).toBe('(document)')
    expect(body.message).toContain('guardrail 2')
  })

  it('act 1 control: a VALID edit through the very same path LANDS', async () => {
    const { error, data } = await commishClient
      .from('scoring_systems')
      .update({
        rules: VALID_FLAT as unknown as Database['public']['Tables']['scoring_systems']['Update']['rules'],
      })
      .eq('id', forkId)
      .select('id')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(await rulesOf(forkId)).toEqual(VALID_FLAT)

    // …and each half of the F21 pair is legal on its own, so the refusal above
    // is provably about the PAIR — the defect — not about either key name.
    for (const [key, value] of Object.entries(F21_DOUBLE_PAY)) {
      const { error: soloError } = await commishClient
        .from('scoring_systems')
        .update({
          rules: {
            [key]: value,
          } as unknown as Database['public']['Tables']['scoring_systems']['Update']['rules'],
        })
        .eq('id', forkId)
      expect(soloError, `${key} alone must be legal`).toBeNull()
    }

    // Restore the fork document for act 3.
    const { error: restoreError } = await commishClient
      .from('scoring_systems')
      .update({
        rules: forkTemplateDoc(
          templateRules,
        ) as unknown as Database['public']['Tables']['scoring_systems']['Update']['rules'],
      })
      .eq('id', forkId)
    expect(restoreError).toBeNull()
  })

  it('act 1, the INSERT arm: a NEW format-2 row carrying an invalid document is refused too', async () => {
    const { data: session } = await commishClient.auth.getSession()
    const envelope = forkTemplateDoc(templateRules) as unknown as Record<string, unknown>
    const { error } = await commishClient.from('scoring_systems').insert({
      name: 'vitest-se4b-should-never-exist',
      owner_id: session.session!.user.id,
      is_template: false,
      rules: {
        ...envelope,
        base: { def_points_allowed: 1 },
      } as unknown as Database['public']['Tables']['scoring_systems']['Insert']['rules'],
    })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('P0001')
    expect(error!.hint).toBe('scorable_allowlist')
    expect(error!.details).toBe('base.def_points_allowed')

    // The row does not exist. A guard that raised AFTER the insert would leave
    // one behind, which is why the trigger is BEFORE (pgTAP 052 §A12).
    const { data: leaked } = await service
      .from('scoring_systems')
      .select('id')
      .eq('name', 'vitest-se4b-should-never-exist')
    expect(leaked).toHaveLength(0)
  })

  it('act 2 (D33): the same client writes a LEGACY-namespace document to a research row, and it lands', async () => {
    // Premise: this row is outside all three profile arms.
    const { data: premise } = await service
      .from('scoring_systems')
      .select('is_template, rules')
      .eq('id', researchId)
      .single()
    expect(premise!.is_template).toBe(false)
    expect(Object.keys(premise!.rules as Record<string, unknown>)).not.toContain('format')
    const { data: referencing } = await service
      .from('leagues')
      .select('id')
      .eq('scoring_system_id', researchId)
      .is('deleted_at', null)
    expect(referencing).toHaveLength(0)

    const nextDoc = { passing_yards: 0.06, rushing_touchdowns: 6 }
    const { error, data } = await commishClient
      .from('scoring_systems')
      .update({
        rules: nextDoc as unknown as Database['public']['Tables']['scoring_systems']['Update']['rules'],
      })
      .eq('id', researchId)
      .select('id')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(await rulesOf(researchId)).toEqual(nextDoc)

    // The control that gives act 2 its meaning: the IDENTICAL document is
    // refused on the row that IS in the profile. Act 2 passes because of the
    // profile, not because clients can no longer be stopped.
    const { error: inProfile } = await commishClient
      .from('scoring_systems')
      .update({
        rules: nextDoc as unknown as Database['public']['Tables']['scoring_systems']['Update']['rules'],
      })
      .eq('id', forkId)
    expect(inProfile).not.toBeNull()
    expect(inProfile!.code).toBe('P0001')
    expect(inProfile!.hint).toBe('scorable_allowlist')
  })

  it('act 3 (R618): the REPOINT is refused by wall 3 — the door F142 was filed for is shut at the column', async () => {
    const { data: session } = await commishClient.auth.getSession()

    // Step (a) of the escape chain, and it must still SUCCEED: an unreferenced,
    // non-template flat row is a D33 research row, and the league validator has
    // no jurisdiction over it.
    const { data: attached, error: attachedError } = await commishClient
      .from('scoring_systems')
      .insert({
        name: ATTACHED_NAME,
        owner_id: session.session!.user.id,
        is_template: false,
        rules: F21_DOUBLE_PAY as unknown as Database['public']['Tables']['scoring_systems']['Insert']['rules'],
      })
      .select('id')
      .single()
    expect(attachedError, 'an UNREFERENCED non-template flat row is outside the profile').toBeNull()
    attachedId = attached!.id

    // Step (b) used to be the whole hole: a privileged repoint, which neither
    // wall watched. Wall 3 watches the column now.
    const { error: repointError } = await service
      .from('leagues')
      .update({ scoring_system_id: attachedId })
      .eq('id', leagueId)
    expect(repointError, 'wall 3 must refuse the repoint').not.toBeNull()
    expect(repointError!.code).toBe('P0001')
    expect(repointError!.hint).toBe('tier_exclusivity')
    expect(repointError!.message).toContain('guardrail 2')

    // The league still points where it did, and is untouched.
    const { data: league } = await service
      .from('leagues')
      .select('scoring_system_id, status, scoring_rules_snapshot')
      .eq('id', leagueId)
      .single()
    expect(league!.scoring_system_id).toBe(forkId)
    expect(league!.status).toBe('scheduled')
    expect(league!.scoring_rules_snapshot).toBeNull()
  })

  it('act 3b (R615): with the reference door shut, the two-step is_template escape cannot even start', async () => {
    // The measured escape was: private invalid row (still legal, above) → put
    // it in the profile via a `leagues` write → PATCH {is_template:true,
    // owner_id:null}, which the identity short-circuit skipped → a
    // world-readable template an ordinary commissioner then attaches.
    //
    // Step 2 is now refused (act 3). Step 3 is refused independently, which is
    // what makes the two fixes composable rather than redundant: even from a
    // state where the row IS in the profile, the promotion is validated.
    const { error: promoteError } = await service
      .from('scoring_systems')
      .update({ is_template: true, owner_id: null })
      .eq('id', attachedId)
    expect(promoteError, 'the is_template promotion must be validated').not.toBeNull()
    expect(promoteError!.code).toBe('P0001')
    expect(promoteError!.hint).toBe('tier_exclusivity')

    // And nothing leaked into the world-readable template set.
    const { data: templates } = await service
      .from('scoring_systems')
      .select('id')
      .eq('is_template', true)
      .eq('id', attachedId)
    expect(templates).toHaveLength(0)

    // The row is still exactly what the commissioner privately wrote.
    expect(await rulesOf(attachedId)).toEqual(F21_DOUBLE_PAY)
  })

  it('act 3c: fix the document, and the repoint + draft_start freeze it VERBATIM', async () => {
    const { error: fixError } = await commishClient
      .from('scoring_systems')
      .update({
        rules: VALID_FLAT as unknown as Database['public']['Tables']['scoring_systems']['Update']['rules'],
      })
      .eq('id', attachedId)
    expect(fixError).toBeNull()

    // Now the same repoint lands — wall 3 refuses documents, not repointing.
    const { error: repointError } = await service
      .from('leagues')
      .update({ scoring_system_id: attachedId })
      .eq('id', leagueId)
    expect(repointError).toBeNull()

    const { data: started, error: startError } = await commishClient.rpc('draft_start', {
      p_league_id: leagueId,
    })
    expect(startError).toBeNull()
    expect((started as unknown as { draft: { status: string } }).draft.status).toBe('live')

    const { data: league } = await service
      .from('leagues')
      .select('status, scoring_rules_snapshot')
      .eq('id', leagueId)
      .single()
    expect(league!.status).toBe('drafting')
    // §7.3.3.1's freeze-verbatim law: the snapshot deep-equals the document,
    // byte for byte. A wall that "helpfully" normalised what it validated
    // would show up right here.
    expect(league!.scoring_rules_snapshot).toEqual(VALID_FLAT)
  })
})
