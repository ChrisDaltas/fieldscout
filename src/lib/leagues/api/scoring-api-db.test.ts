/**
 * scoring-api-db.test.ts — SE.6's two verbs at the WIRE layer: the §7.3.3.1
 * custom-scoring routes (`POST …/scoring/fork` → `scoring_fork_template`,
 * `PUT …/scoring/rules` → `scoring_update_rules`; migration 105) driven over
 * the LOCAL stack through PostgREST by real signed-in users — the exact
 * composition the Route Handlers run (the D68 wire-suite convention; pgTAP 053
 * owns the RPC-side matrices and this suite does not re-prove them).
 *
 * **What this suite owns, and why each assertion NAMES ITS LAYER.** Two
 * enforcement layers can answer 400 here: the route's Zod parse (SE.3's
 * validator, UX-layer) and the RPC (`scoring_rules_validate`, the wall). They
 * are byte-identical mirrors on purpose, so a bare "400" cannot tell them
 * apart — the SE.5 lesson, one level up. Every refusal below is therefore
 * asserted on a SENTENCE ONLY ONE LAYER CAN PRODUCE:
 *   - the TS validator's own text (`Document shape (§7.3.3.1) …`) ⇒ the route
 *     refused, and no RPC was called;
 *   - migration 105's own text (`fork first, templates are immutable`,
 *     `scoring can only be …`, `p_template_id must reference …`) ⇒ the RPC
 *     refused, so the mapping under test is the one that ran.
 *
 * And every refusal is corroborated in the DB: the league's reference and the
 * stored `rules` document are read back and compared to what they were before
 * the call. A refusal that changed something, or a "success" that changed
 * nothing, is exactly the class CLAUDE.md's *"never let 'nothing happened'
 * mean 'it worked'"* rule is about, and neither is visible from a status code.
 *
 * NOT here (owned elsewhere, cited rather than re-proved): the §12.25 member
 * SELECT policy and the no-write-policy matrices (pgTAP 053); the three write
 * walls (pgTAP 052); the TS≡SQL guardrail mirror (`scoring-parity-db.test.ts`);
 * the mapper's unreachable branches (`scoring-service.test.ts` §B).
 *
 * Requires the local stack — D59(5); FAILS loudly when the stack is down,
 * never skips (§4.3). Determinism: fixed emails/usernames/action-ids (prefix
 * `se6` — the D108(14)/D114(10) registry), fixture names unique to this suite
 * (`vitest-se6-*`, `se6_*` — the D114(7) lesson), cleanup-first. No wall clock
 * is read (the D3/D17 lint bans cover this file).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import type { ScoringRulesDocV2 } from '../scoring/rules-doc'
import { defaultsForTeamCount } from '../settings/league-settings'
import { createLeague } from './leagues-service'
import { forkScoringTemplate, updateScoringRules } from './scoring-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME_PREFIX = 'vitest-se6-league'
const SCORING_NAME_PREFIX = 'vitest-se6'

const COMMISH = {
  email: 'se6-commish@fieldscout.test',
  password: 'pgtap-leagues-pass-3',
  username: 'se6_commish_one',
}
const OUTSIDER = {
  email: 'se6-outsider@fieldscout.test',
  password: 'pgtap-leagues-pass-4',
  username: 'se6_outsider_two',
}

const ACTION = {
  fork: '5e600000-0000-4000-8000-000000000001',
  save: '5e600000-0000-4000-8000-000000000002',
  window: '5e600000-0000-4000-8000-000000000003',
  template: '5e600000-0000-4000-8000-000000000004',
} as const

/** A uuid that is no league — the no-existence-leak probe. */
const NO_SUCH_LEAGUE = '5e600000-0000-4000-8000-0000000000ff'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let espnStandardId: string
let espnStandardRules: Record<string, number>
let personalScoringId: string
/** The league every happy-path fork/save runs on (stays in `setup`). */
let forkLeagueId: string
/** A league deliberately left ON ITS TEMPLATE — the "fork first" fixture. */
let templateLeagueId: string
/** A league pushed out of the §7.3 window — the 409 fixture. */
let windowLeagueId: string

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

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
  // AFTER the leagues: a forked row is FK-referenced while its league lives.
  // Fork rows are named "<League> Custom", so the league prefix finds them.
  await service.from('scoring_systems').delete().like('name', `${SCORING_NAME_PREFIX}%`)
  await deleteUserByUsername(COMMISH.username)
  await deleteUserByUsername(OUTSIDER.username)
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

async function createFixtureLeague(actionId: string, suffix: string): Promise<string> {
  const result = await createLeague(commishClient, {
    name: `${LEAGUE_NAME_PREFIX}-${suffix}`,
    season: 2026,
    scoring_system_id: espnStandardId,
    team_name: `SE6 ${suffix}`,
    action_id: actionId,
    settings: defaultsForTeamCount(12),
  })
  if (result.status !== 201) {
    throw new Error(`fixture create failed (${result.status}): ${JSON.stringify(result.body)}`)
  }
  return (result.body as { league_id: string }).league_id
}

/** The league's current scoring reference, read privileged (the GET path does
 *  not expose the row itself). */
async function leagueReference(leagueId: string): Promise<string | null> {
  const { data } = await service
    .from('leagues')
    .select('scoring_system_id')
    .eq('id', leagueId)
    .single()
  if (!data) throw new Error(`league ${leagueId} missing`)
  return data.scoring_system_id
}

async function scoringRow(id: string) {
  const { data } = await service
    .from('scoring_systems')
    .select('id, name, owner_id, is_template, rules')
    .eq('id', id)
    .single()
  if (!data) throw new Error(`scoring system ${id} missing`)
  return data
}

/** Both halves of "what the league scores by", so a refusal can be shown to
 *  have moved NEITHER. */
async function scoringState(leagueId: string): Promise<{ reference: string | null; rules: Json }> {
  const reference = await leagueReference(leagueId)
  if (reference === null) return { reference, rules: null }
  return { reference, rules: (await scoringRow(reference)).rules }
}

function fieldErrorsOf(body: unknown): Record<string, string[]> {
  const error = (body as { error?: unknown }).error
  return (error as { fieldErrors: Record<string, string[]> }).fieldErrors
}

function errorText(body: unknown): string {
  return JSON.stringify(body)
}

// ---------------------------------------------------------------------------

describe('custom scoring routes (105 — local stack, PostgREST wire path)', () => {
  beforeAll(async () => {
    await cleanup()

    for (const user of [COMMISH, OUTSIDER]) {
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
      .select('id, rules')
      .eq('is_template', true)
      .eq('name', 'ESPN Standard')
      .single()
    if (!template) throw new Error('ESPN Standard template missing (is 058 applied?)')
    espnStandardId = template.id
    espnStandardRules = template.rules as Record<string, number>

    const { data: outsiderProfile } = await service
      .from('profiles')
      .select('id')
      .eq('username', OUTSIDER.username)
      .single()
    if (!outsiderProfile) throw new Error('outsider profile missing')

    // A legacy PERSONAL research system — outside D175's league profile
    // (non-template, no `format` member, referenced by no league), so it is
    // writable under its own D33 namespace and is the "not a template"
    // negative for the fork verb.
    const { data: personal, error: personalError } = await service
      .from('scoring_systems')
      .insert({
        owner_id: outsiderProfile.id,
        name: `${SCORING_NAME_PREFIX}-personal-system`,
        rules: { passing_yards: 0.05 },
      })
      .select('id')
      .single()
    if (personalError || !personal) {
      throw new Error(`personal scoring seed failed: ${personalError?.message}`)
    }
    personalScoringId = personal.id

    commishClient = await signIn(COMMISH)
    outsiderClient = await signIn(OUTSIDER)

    forkLeagueId = await createFixtureLeague(ACTION.fork, 'fork')
    templateLeagueId = await createFixtureLeague(ACTION.template, 'template')
    windowLeagueId = await createFixtureLeague(ACTION.window, 'window')
  }, 60_000)

  afterAll(async () => {
    await cleanup()
  })

  // -------------------------------------------------------------------------
  // A. The fork — the §7.3.3.1 entry point
  // -------------------------------------------------------------------------

  describe('A. POST /api/leagues/[id]/scoring/fork', () => {
    let forkedId: string

    it('A1 forks the template and repoints the league, in one transaction', async () => {
      expect(await leagueReference(forkLeagueId)).toBe(espnStandardId)

      const result = await forkScoringTemplate(commishClient, forkLeagueId, {
        template_id: espnStandardId,
      })
      expect(errorText(result.body)).toContain('scoring_system_id')
      expect(result.status).toBe(200)
      forkedId = (result.body as { scoring_system_id: string }).scoring_system_id

      // The repoint is the half a status code cannot show.
      expect(await leagueReference(forkLeagueId)).toBe(forkedId)
      expect(forkedId).not.toBe(espnStandardId)

      const row = await scoringRow(forkedId)
      expect(row.is_template).toBe(false)
      expect(row.name).toBe(`${LEAGUE_NAME_PREFIX}-fork Custom`)
      const doc = row.rules as unknown as ScoringRulesDocV2
      expect(doc.format).toBe(2)
      // `base` is the template's flat map VERBATIM — the fork-equivalence
      // property's precondition (SE.2), checked here at the wire rather than
      // assumed from the RPC's banner.
      expect(doc.base).toStrictEqual(espnStandardRules)
      expect(doc.positions).toStrictEqual({})
    })

    it('A2 is idempotent by natural key: a retried POST returns the SAME id and inserts nothing', async () => {
      const { count: before } = await service
        .from('scoring_systems')
        .select('id', { count: 'exact', head: true })
        .eq('is_template', false)
        .like('name', `${LEAGUE_NAME_PREFIX}%`)

      const retry = await forkScoringTemplate(commishClient, forkLeagueId, {
        template_id: espnStandardId,
      })
      expect(retry.status).toBe(200)
      expect((retry.body as { scoring_system_id: string }).scoring_system_id).toBe(forkedId)

      const { count: after } = await service
        .from('scoring_systems')
        .select('id', { count: 'exact', head: true })
        .eq('is_template', false)
        .like('name', `${LEAGUE_NAME_PREFIX}%`)
      expect(after).toBe(before)
    })

    it('A3 a non-commissioner is refused 403, and the refusal names no RPC', async () => {
      const before = await scoringState(templateLeagueId)
      const result = await forkScoringTemplate(outsiderClient, templateLeagueId, {
        template_id: espnStandardId,
      })
      expect(result.status).toBe(403)
      expect(errorText(result.body)).not.toContain('scoring_fork_template')
      expect(await scoringState(templateLeagueId)).toStrictEqual(before)
    })

    it('A4 a league that does not exist answers 403, NOT 404 — no existence leak', async () => {
      // The RPC checks `is_league_commish` first, which is FALSE for a
      // nonexistent league, so P0002 is unreachable from an ordinary caller.
      // Pinned because the obvious "improvement" (404 for unknown ids) would
      // turn this route into a league-existence oracle.
      const result = await forkScoringTemplate(commishClient, NO_SUCH_LEAGUE, {
        template_id: espnStandardId,
      })
      expect(result.status).toBe(403)
    })

    it('A5 Zod refuses a malformed body BEFORE any RPC call', async () => {
      const before = await scoringState(templateLeagueId)

      const missing = await forkScoringTemplate(commishClient, templateLeagueId, {})
      expect(missing.status).toBe(400)
      expect(Object.keys(fieldErrorsOf(missing.body))).toEqual(['template_id'])

      const notUuid = await forkScoringTemplate(commishClient, templateLeagueId, {
        template_id: 'not-a-uuid',
      })
      expect(notUuid.status).toBe(400)

      // R77: an unknown key is refused rather than stripped.
      const extra = await forkScoringTemplate(commishClient, templateLeagueId, {
        template_id: espnStandardId,
        templateId: espnStandardId,
      })
      expect(extra.status).toBe(400)

      const nullBody = await forkScoringTemplate(commishClient, templateLeagueId, null)
      expect(nullBody.status).toBe(400)

      expect(await scoringState(templateLeagueId)).toStrictEqual(before)
    })

    it('A6 a NON-template scoring system is a field error carrying 105’s own sentence', async () => {
      const before = await scoringState(templateLeagueId)
      const result = await forkScoringTemplate(commishClient, templateLeagueId, {
        template_id: personalScoringId,
      })
      expect(result.status).toBe(400)
      const errors = fieldErrorsOf(result.body)
      expect(Object.keys(errors)).toEqual(['template_id'])
      // 105's text, so the assertion names the layer that answered: this is
      // the RPC's template predicate, not a client-side guess about it.
      expect(errors.template_id[0]).toContain(
        'p_template_id must reference one of the scoring templates',
      )
      expect(await scoringState(templateLeagueId)).toStrictEqual(before)
    })

    it('A7 outside the §7.3 setup/scheduled window it is 409 with the RPC sentence VERBATIM', async () => {
      // 059's D43 guard refuses `drafting` without a snapshot, and 104's wall
      // 2 validates the snapshot on the way in — so the fixture writes BOTH,
      // with the template's own (valid, format-1) document. That is also the
      // truthful state: a league past the window has a frozen snapshot.
      const { error } = await service
        .from('leagues')
        .update({ status: 'drafting', scoring_rules_snapshot: espnStandardRules })
        .eq('id', windowLeagueId)
      expect(error).toBeNull()
      const before = await scoringState(windowLeagueId)

      const result = await forkScoringTemplate(commishClient, windowLeagueId, {
        template_id: espnStandardId,
      })
      expect(result.status).toBe(409)
      const message = (result.body as { error: string }).error
      expect(message).toContain('scoring can only be customized while the league is in setup or scheduled')
      expect(message).toContain('§7.3 header')
      expect(await scoringState(windowLeagueId)).toStrictEqual(before)

      await service
        .from('leagues')
        .update({ status: 'setup', scoring_rules_snapshot: null })
        .eq('id', windowLeagueId)
    })
  })

  // -------------------------------------------------------------------------
  // B. The save — the editor's write
  // -------------------------------------------------------------------------

  describe('B. PUT /api/leagues/[id]/scoring/rules', () => {
    /** A valid format-2 document that needs NO fork to exist — so a refusal
     *  test using it is provably the RPC's answer and not Zod's. (Order
     *  independence matters: with `-t` filtering, a fixture built from the
     *  league's CURRENT row would be format 1 and would 400 at the route.) */
    function standaloneDoc(): ScoringRulesDocV2 {
      return {
        format: 2,
        base: espnStandardRules,
        positions: {},
        tier_cuts: espnCuts(),
      } as unknown as ScoringRulesDocV2
    }

    /** The forked document with one per-position override — what an editor
     *  session actually produces. Built from the STORED doc so the fixture
     *  cannot drift from what the fork wrote. */
    async function editedDoc(): Promise<ScoringRulesDocV2> {
      const reference = await leagueReference(forkLeagueId)
      const doc = (await scoringRow(reference!)).rules as unknown as ScoringRulesDocV2
      return {
        ...doc,
        positions: { WR: { receptions: 1.5 } },
      }
    }

    it('B1 writes the document VERBATIM — no layer normalizes, rewrites or reorders it', async () => {
      const doc = await editedDoc()
      const result = await updateScoringRules(commishClient, forkLeagueId, { rules: doc })
      expect(errorText(result.body)).toContain('scoring_system_id')
      expect(result.status).toBe(200)

      const reference = await leagueReference(forkLeagueId)
      expect((result.body as { scoring_system_id: string }).scoring_system_id).toBe(reference)
      expect((await scoringRow(reference!)).rules).toStrictEqual(doc)
    })

    it('B2 is naturally idempotent: the same document twice leaves the same row state', async () => {
      const doc = await editedDoc()
      const first = await updateScoringRules(commishClient, forkLeagueId, { rules: doc })
      const after = await scoringState(forkLeagueId)
      const second = await updateScoringRules(commishClient, forkLeagueId, { rules: doc })
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(await scoringState(forkLeagueId)).toStrictEqual(after)
    })

    it('B3 a league still on a TEMPLATE is 409 — "fork first", 105’s sentence verbatim', async () => {
      const before = await scoringState(templateLeagueId)
      expect(before.reference).toBe(espnStandardId)

      const result = await updateScoringRules(commishClient, templateLeagueId, {
        rules: standaloneDoc(),
      })
      expect(result.status).toBe(409)
      // Only 105 produces this sentence — so this assertion proves the RPC
      // refused, not the Zod layer (which accepted the document above).
      expect((result.body as { error: string }).error).toContain(
        'fork first, templates are immutable',
      )
      expect(await scoringState(templateLeagueId)).toStrictEqual(before)
    })

    it('B4 a non-commissioner is refused 403 and writes nothing', async () => {
      const before = await scoringState(forkLeagueId)
      const result = await updateScoringRules(outsiderClient, forkLeagueId, {
        rules: standaloneDoc(),
      })
      expect(result.status).toBe(403)
      expect(errorText(result.body)).not.toContain('scoring_update_rules')
      expect(await scoringState(forkLeagueId)).toStrictEqual(before)
    })

    it('B5 outside the window it is 409 with the save verb’s own sentence', async () => {
      const before = await scoringState(forkLeagueId)
      const { error: freeze } = await service
        .from('leagues')
        .update({ status: 'in_season', scoring_rules_snapshot: before.rules })
        .eq('id', forkLeagueId)
      expect(freeze).toBeNull()

      const result = await updateScoringRules(commishClient, forkLeagueId, {
        rules: standaloneDoc(),
      })
      expect(result.status).toBe(409)
      expect((result.body as { error: string }).error).toContain(
        'scoring can only be edited while the league is in setup or scheduled',
      )
      expect(await scoringState(forkLeagueId)).toStrictEqual(before)

      await service
        .from('leagues')
        .update({ status: 'setup', scoring_rules_snapshot: null })
        .eq('id', forkLeagueId)
    })

    it('B6 a body with NO `rules` is refused by the ROUTE — the TS validator’s own sentence', async () => {
      const before = await scoringState(forkLeagueId)
      const result = await updateScoringRules(commishClient, forkLeagueId, {})
      expect(result.status).toBe(400)
      const errors = fieldErrorsOf(result.body)
      expect(Object.keys(errors)).toEqual(['rules'])
      // `Document shape (§7.3.3.1)` is validate-rules-doc.ts's wording; the
      // RPC was never called.
      expect(errors.rules[0]).toContain('Document shape (§7.3.3.1)')
      expect(await scoringState(forkLeagueId)).toStrictEqual(before)
    })

    it('B7 an out-of-bounds coefficient is refused with the offending DOT PATH', async () => {
      const before = await scoringState(forkLeagueId)
      const doc = await editedDoc()
      // One unit past |coef| ≤ 100 at 2dp (D146(1)).
      const result = await updateScoringRules(commishClient, forkLeagueId, {
        rules: { ...doc, positions: { WR: { receptions: 100.01 } } },
      })
      expect(result.status).toBe(400)
      expect(Object.keys(fieldErrorsOf(result.body))).toEqual(['rules.positions.WR.receptions'])
      expect(await scoringState(forkLeagueId)).toStrictEqual(before)

      // …and exactly 100.00 is accepted, so the pin is a BOUNDARY and not a
      // blanket refusal of the field.
      const atBound = await updateScoringRules(commishClient, forkLeagueId, {
        rules: { ...doc, positions: { WR: { receptions: 100 } } },
      })
      expect(atBound.status).toBe(200)
      await updateScoringRules(commishClient, forkLeagueId, { rules: doc })
    })

    it('B8 an UN-NORMALIZED document is refused, not silently normalized (guardrail 4)', async () => {
      const before = await scoringState(forkLeagueId)
      const doc = await editedDoc()
      // An override equal to the base value is a no-op override: the normal
      // form strips it, and the server refuses rather than stripping it for
      // the client — otherwise the derived All-Positions switch state would
      // change with no error and no diff (§7.3.3.1's "derived state" bullet).
      const result = await updateScoringRules(commishClient, forkLeagueId, {
        rules: { ...doc, positions: { WR: { receptions: doc.base.receptions } } },
      })
      expect(result.status).toBe(400)
      expect(errorText(result.body)).toContain('Normal form')
      expect(await scoringState(forkLeagueId)).toStrictEqual(before)
    })

    it('B9 the EMPTY KEY is refused at the route boundary with its own path (ledger F138)', async () => {
      const before = await scoringState(forkLeagueId)
      const doc = await editedDoc()
      // `''` is a legal JSON key that no registry entry claims. F138 asked
      // SE.6 to decide whether the ambiguity gets a nullable path or a route
      // mapping, and to pin the case AT THIS BOUNDARY: in format 2 — the only
      // format the editor authors — the path is unambiguous, its last segment
      // being the key itself.
      const result = await updateScoringRules(commishClient, forkLeagueId, {
        rules: { ...doc, base: { ...doc.base, '': 1 } },
      })
      expect(result.status).toBe(400)
      expect(Object.keys(fieldErrorsOf(result.body))).toEqual(['rules.base.'])
      expect(errorText(result.body)).toContain('Scorable allowlist')
      expect(await scoringState(forkLeagueId)).toStrictEqual(before)
    })
  })
})

/** The ESPN family's PA/YA cut lists, as the fork writes them (SE.1/SE.2).
 *  Inlined for the one fixture that needs a document WITHOUT forking. */
function espnCuts() {
  return {
    def_pa: [0, 1, 7, 14, 18, 28, 35, 46],
    def_ya: [0, 100, 200, 300, 350, 400, 450, 500, 550],
  }
}
