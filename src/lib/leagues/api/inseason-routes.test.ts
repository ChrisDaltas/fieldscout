/**
 * inseason-routes.test.ts — the in-season Route Handlers' SHAPE (L.D4.2's
 * four + L.D4.1's four — lineup PATCH, rosters / matchups / standings GET),
 * plus the ONE pin L.D4.2's DoD names: **the confirm route cannot be pointed
 * at a client-supplied schedule** — and L.D4.1's family pins: the membership
 * gate precedes every direct read, and the lineup verb inherits the SQLSTATE
 * mapper and the R768 normalisation (F224(e)).
 *
 * Source-level for the reason `scoring-routes.test.ts` is (its header, in
 * full): the stack suites drive the SERVICE layer, which is the D68
 * convention and covers everything testable — but it leaves the handler's
 * own four lines (the uuid guard, the `auth.getUser()` 401, the delegation,
 * the status pass-through) covered by nothing, and those lines are exactly
 * where a Route Handler goes wrong. Instantiating a Next Route Handler needs
 * `next/headers` cookie plumbing this repo's suites deliberately do not
 * stand up.
 *
 * Falsifiability: deleting any `if (!user)` block turns a 401 assertion RED;
 * relaxing either schedule body from `strictObject` turns the
 * regenerate-in-body pins RED (shown in this task's PR, then reverted).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROUTES = [
  {
    file: 'src/app/api/leagues/[id]/transactions/route.ts',
    verb: 'POST',
    service: 'submitAddDrop',
  },
  {
    file: 'src/app/api/leagues/[id]/schedule/remix/route.ts',
    verb: 'POST',
    service: 'previewRemix',
  },
  {
    file: 'src/app/api/leagues/[id]/schedule/confirm/route.ts',
    verb: 'POST',
    service: 'confirmRemix',
  },
  {
    file: 'src/app/api/leagues/[id]/activity/route.ts',
    verb: 'GET',
    service: 'readActivity',
  },
  // L.D4.1
  {
    file: 'src/app/api/leagues/[id]/teams/[tid]/lineup/route.ts',
    verb: 'PATCH',
    service: 'setLineup',
  },
  {
    file: 'src/app/api/leagues/[id]/rosters/route.ts',
    verb: 'GET',
    service: 'readRosters',
  },
  {
    file: 'src/app/api/leagues/[id]/matchups/route.ts',
    verb: 'GET',
    service: 'readMatchups',
  },
  {
    file: 'src/app/api/leagues/[id]/standings/route.ts',
    verb: 'GET',
    service: 'readStandings',
  },
] as const

const SCHEDULE_SERVICE = 'src/lib/leagues/api/schedule-service.ts'
const TRANSACTIONS_SERVICE = 'src/lib/leagues/api/transactions-service.ts'
const ERRORS = 'src/lib/leagues/api/inseason-errors.ts'
const IDS = 'src/lib/leagues/api/inseason-ids.ts'
const LINEUP_SERVICE = 'src/lib/leagues/api/lineup-service.ts'
const ROSTERS_SERVICE = 'src/lib/leagues/api/rosters-service.ts'
const MATCHUPS_SERVICE = 'src/lib/leagues/api/matchups-service.ts'
const STANDINGS_SERVICE = 'src/lib/leagues/api/standings-service.ts'
const READS = 'src/lib/leagues/api/inseason-reads.ts'

/** File text with block comments and `//` lines removed, so a docblock that
 *  merely MENTIONS a guard cannot satisfy a pin about the code. */
function code(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('the in-season Route Handlers keep the house shape (§15.3)', () => {
  for (const route of ROUTES) {
    describe(route.file, () => {
      const source = code(route.file)

      it(`exports exactly ${route.verb} — no second verb sneaks onto the path`, () => {
        const exported = [...source.matchAll(/export async function (\w+)\(/g)].map((m) => m[1])
        expect(exported).toEqual([route.verb])
      })

      it('refuses an unauthenticated caller with 401 before touching the service', () => {
        expect(source).toContain('await supabase.auth.getUser()')
        expect(source).toContain('if (!user) {')
        expect(source).toContain("{ error: 'Unauthorized' }, { status: 401 }")
        expect(source.indexOf('if (!user) {')).toBeLessThan(source.indexOf(`${route.service}(`))
      })

      it('answers 404 for a malformed league id rather than passing it down', () => {
        // R675: the fence's STRENGTH. `z.string()` here is green across the
        // whole non-stack suite and lets a malformed id reach PostgREST,
        // which raises 22P02 and the mapper's default arm echoes it as a 500.
        expect(source).toContain('const idSchema = z.uuid()')
        expect(source).toContain('idSchema.safeParse(id).success')
        expect(source).toContain("{ error: 'League not found' }, { status: 404 }")
      })

      it('delegates to the service and passes its status through unchanged', () => {
        expect(source).toMatch(new RegExp(`${route.service}\\(supabase, id[,)]`))
        expect(source).toContain('NextResponse.json(result.body, { status: result.status })')
      })

      it('holds no rule of its own — no league logic in app/', () => {
        // CLAUDE.md: "app/ → Routes and layouts only. Minimal logic."
        for (const name of [
          'roster_add_drop',
          'schedule_remix_confirm',
          'schedule_preview',
          'set_lineup',
          'league_standings',
          '.rpc(',
          'from(',
          'is_league_member',
        ]) {
          expect(source, name).not.toContain(name)
        }
      })
    })
  }

  it('every body-taking route turns an unparseable body into null, never a 500', () => {
    for (const route of ROUTES.filter((r) => r.verb !== 'GET')) {
      expect(code(route.file), route.file).toContain('await request.json().catch(() => null)')
    }
  })

  it('the lineup route shape-checks the TEAM segment too — a malformed tid is a 404, not a 22P02 echoed as 500', () => {
    const source = code('src/app/api/leagues/[id]/teams/[tid]/lineup/route.ts')
    expect(source).toContain('idSchema.safeParse(tid).success')
    expect(source).toContain("{ error: 'Team not found' }, { status: 404 }")
    expect(source.indexOf('safeParse(tid)')).toBeLessThan(source.indexOf('createServerClient()'))
  })
})

// ---------------------------------------------------------------------------
// L.D4.1: the membership gate precedes every direct read (CLAUDE.md — an
// RLS-empty result for a non-member must not render as an empty list).
// ---------------------------------------------------------------------------

describe('the two direct-read services assert membership BEFORE any table read (D92 + rule 10)', () => {
  for (const rel of [ROSTERS_SERVICE, MATCHUPS_SERVICE]) {
    it(`${rel} calls assertLeagueMember before its first .from(`, () => {
      const source = code(rel)
      expect(source).toContain("import { assertBelowPostgrestCap, assertLeagueMember } from './inseason-reads'")
      const gate = source.indexOf('await assertLeagueMember(supabase, leagueId)')
      expect(gate).toBeGreaterThan(-1)
      expect(source).toContain('if (refused) return refused')
      expect(gate).toBeLessThan(source.indexOf(".from("))
    })
  }

  it('the gate is the database\'s own predicate, answering one no-leak 403 (never an empty body)', () => {
    const source = code(READS)
    expect(source).toContain("supabase.rpc('is_league_member', { p_league_id: leagueId })")
    expect(source).toContain('if (data !== true) {')
    expect(source).toContain('status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE }')
    // A transport error is a 500, never a `false`.
    expect(source.indexOf('status: 500')).toBeLessThan(source.indexOf('status: 403'))
  })

  it('the standings service needs no gate of its own — 117 raises 42501 in-body and the mapper answers 403', () => {
    const source = code(STANDINGS_SERVICE)
    expect(source).toContain("supabase.rpc('league_standings', { p_league_id: leagueId })")
    expect(source).toContain('mapInSeasonRpcError(error, INSEASON_READ_FORBIDDEN_MESSAGE)')
    expect(source).not.toContain('assertLeagueMember')
  })

  it('every direct read is asserted below the PostgREST cap (CLAUDE.md\'s 1000-row rule)', () => {
    for (const rel of [ROSTERS_SERVICE, MATCHUPS_SERVICE, STANDINGS_SERVICE]) {
      expect(code(rel), rel).toContain('assertBelowPostgrestCap(')
    }
  })

  it('matchups: `week` is REQUIRED and the route infers no current week (§23.3)', () => {
    const service = code(MATCHUPS_SERVICE)
    expect(service).toContain('week: z.coerce.number().int().min(1).max(18),')
    expect(service).not.toMatch(/current_week|now\(\)|starts_at/)
    // An absent calendar row is a 404 BY NAME, never an empty week.
    expect(service).toContain('if (!weekRes.data) {')
    expect(service).toContain('status: 404')
  })
})

// ---------------------------------------------------------------------------
// THE DoD PIN: confirm regenerates IN BODY from a seed — a client-supplied
// schedule has nowhere to enter.
// ---------------------------------------------------------------------------

describe('§11.7/D289 — the Remix client sends a SEED, never a SCHEDULE', () => {
  const service = code(SCHEDULE_SERVICE)

  it('both bodies are strictObject, so a `matchups`/`proposed`/`weeks` key is REFUSED, not ignored', () => {
    // THE BREAK PROBE'S TARGET. Relaxing either to `z.object(` accepts a
    // client-supplied schedule body silently — the route would answer 200
    // for a request that asked the server to apply pairings it never
    // generated, and only the message would be honest.
    expect(service).toMatch(/export const previewRemixInputSchema = z\.strictObject\(\{/)
    expect(service).toMatch(/export const confirmRemixInputSchema = z\.strictObject\(\{/)
  })

  it('the confirm body has exactly three fields — seed, reason, action_id', () => {
    const body = service.slice(
      service.indexOf('export const confirmRemixInputSchema'),
      service.indexOf('export type ConfirmRemixInput'),
    )
    const fields = [...body.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])
    expect(fields).toEqual(['seed', 'reason', 'action_id'])
  })

  it('EXACTLY four arguments reach `schedule_remix_confirm` — there is no fifth', () => {
    const call = service.slice(
      service.indexOf("supabase.rpc('schedule_remix_confirm'"),
      service.indexOf('if (error) {', service.indexOf("supabase.rpc('schedule_remix_confirm'")),
    )
    const args = [...call.matchAll(/p_(\w+):/g)].map((m) => `p_${m[1]}`)
    expect(new Set(args)).toEqual(new Set(['p_league_id', 'p_seed', 'p_action_id', 'p_reason']))
  })

  it('neither service file names a matchup-shaped payload anywhere', () => {
    // A regeneration that took client rows would have to name them.
    for (const name of ['home_team_id', 'away_team_id', 'round_type', 'matchups:']) {
      expect(service, name).not.toContain(name)
    }
  })

  it('the seed range is the settings catalog constant, not a re-typed literal', () => {
    expect(service).toContain("import { SCHEDULE_SEED_MAX } from '../settings/league-settings'")
    expect(service).toContain('z.number().int().min(0).max(SCHEDULE_SEED_MAX)')
  })
})

// ---------------------------------------------------------------------------
// The family's SQLSTATE contract (F224(e)/F227(f)) — one mapper, four arms.
// ---------------------------------------------------------------------------

describe('the in-season SQLSTATE mapping is one shared helper (F224(e)/F227(f))', () => {
  const errors = code(ERRORS)

  it('42501 → 403 · P0002 → 404 · P0001 → 409 · 22023 → 400 · else 500', () => {
    expect(errors).toMatch(/error\.code === '42501'[\s\S]{0,140}status: 403/)
    expect(errors).toMatch(/error\.code === 'P0002'[\s\S]{0,140}status: 404/)
    expect(errors).toMatch(/error\.code === 'P0001'[\s\S]{0,160}status: 409/)
    expect(errors).toMatch(/error\.code === '22023'[\s\S]{0,200}status: 400/)
    expect(errors).toMatch(/return \{ status: 500, body: \{ error: error\.message \} \}/)
  })

  it('P0002 is tested BEFORE P0001 (R87 — a missing league is not a conflict)', () => {
    expect(errors.indexOf("'P0002'")).toBeLessThan(errors.indexOf("error.code === 'P0001'"))
  })

  it('the refusal MESSAGE is passed through verbatim on every raised arm', () => {
    // F227(f): the E32 message names the kickoff and when the week clears;
    // the waiver message names `waivers_until`; the cap message names
    // used/cap/week. A generic replacement here erases all of it.
    const arms = errors.match(/status: (404|409|400), body: \{ error: error\.message \}/g) ?? []
    expect(arms).toHaveLength(3)
  })

  it('every RPC-calling in-season service uses it — none maps SQLSTATEs of its own', () => {
    for (const rel of [SCHEDULE_SERVICE, TRANSACTIONS_SERVICE, LINEUP_SERVICE, STANDINGS_SERVICE]) {
      const source = code(rel)
      expect(source, rel).toContain("import { mapInSeasonRpcError } from './inseason-errors'")
      expect(source, rel).not.toMatch(/'42501'|'P0001'|'P0002'|'22023'/)
    }
    // The two direct-read services raise nothing to map and map nothing.
    for (const rel of [ROSTERS_SERVICE, MATCHUPS_SERVICE]) {
      expect(code(rel), rel).not.toMatch(/'42501'|'P0001'|'P0002'|'22023'/)
    }
  })
})

// ---------------------------------------------------------------------------
// R768 — the family's wire uuids are normalised where an IDENTITY GUARD reads
// them back. L.D4.1's lineup route inherits this with the SQLSTATE mapper.
// ---------------------------------------------------------------------------

describe('the F65(b) guards compare against what Postgres wrote (R768)', () => {
  it('the shared schema lower-cases, because `z.uuid()` does not', () => {
    const ids = code(IDS)
    expect(ids).toContain('z.uuid().transform((value) => value.toLowerCase())')
  })

  it('BOTH verbs take their guarded ids through it — never a bare z.uuid()', () => {
    // The failure this prevents: an UPPERCASE uuid (which `z.uuid()` accepts)
    // reaches the RPC, the move COMMITS, and the byte-for-byte guard then
    // answers 409 "that didn't go through" — with the action_id spent.
    const transactions = code(TRANSACTIONS_SERVICE)
    expect(transactions).toContain('team_id: normalizedUuid,')
    expect(transactions).toContain('action_id: normalizedUuid,')
    expect(transactions).not.toMatch(/(team_id|action_id): z\.uuid\(\)/)

    const schedule = code(SCHEDULE_SERVICE)
    expect(schedule).toContain('action_id: normalizedUuid,')
    expect(schedule).not.toMatch(/action_id: z\.uuid\(\)/)
  })

  it('the guards still compare identity — normalising is not a way past them', () => {
    // Each verb must still refuse a reused id that names a different
    // move/seed; the stack suites walk both live.
    expect(code(TRANSACTIONS_SERVICE)).toContain('result.action_id !== action_id ||')
    expect(code(SCHEDULE_SERVICE)).toContain(
      'if (result.action_id !== action_id || Number(result.schedule_seed) !== seed) {',
    )
  })

  it('L.D4.1: the lineup verb inherits it — action_id AND the path team id, and the guard covers the placement', () => {
    const lineup = code(LINEUP_SERVICE)
    expect(lineup).toContain('action_id: normalizedUuid,')
    expect(lineup).toContain('normalizedUuid.safeParse(rawTeamId)')
    expect(lineup).not.toMatch(/action_id: z\.uuid\(\)/)
    expect(lineup).toContain('result.team_id !== teamId ||')
    expect(lineup).toContain('result.week !== week ||')
    expect(lineup).toContain('result.action_id !== action_id ||')
    expect(lineup).toContain('!placementMatches(slot_map, result.slot_map, result.moved)')
    // F224(e): the map goes to the RPC WHOLE — no filter, no fill.
    expect(lineup).toContain('p_slot_map: slot_map,')
    expect(lineup).not.toMatch(/Object\.(entries|keys|fromEntries)\(slot_map\)/)
  })
})
