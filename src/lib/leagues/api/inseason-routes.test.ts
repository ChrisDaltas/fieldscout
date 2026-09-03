/**
 * inseason-routes.test.ts — the four L.D4.2 Route Handlers' SHAPE, plus the
 * ONE pin the task's DoD names: **the confirm route cannot be pointed at a
 * client-supplied schedule.**
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
] as const

const SCHEDULE_SERVICE = 'src/lib/leagues/api/schedule-service.ts'
const TRANSACTIONS_SERVICE = 'src/lib/leagues/api/transactions-service.ts'
const ERRORS = 'src/lib/leagues/api/inseason-errors.ts'

/** File text with block comments and `//` lines removed, so a docblock that
 *  merely MENTIONS a guard cannot satisfy a pin about the code. */
function code(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('the four in-season Route Handlers keep the house shape (§15.3)', () => {
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
        expect(source).toMatch(new RegExp(`${route.service}\\(supabase, id, `))
        expect(source).toContain('NextResponse.json(result.body, { status: result.status })')
      })

      it('holds no rule of its own — no league logic in app/', () => {
        // CLAUDE.md: "app/ → Routes and layouts only. Minimal logic."
        for (const name of [
          'roster_add_drop',
          'schedule_remix_confirm',
          'schedule_preview',
          'from(',
          'is_league_member',
        ]) {
          expect(source, name).not.toContain(name)
        }
      })
    })
  }

  it('the three POST routes turn an unparseable body into null, never a 500', () => {
    for (const route of ROUTES.filter((r) => r.verb === 'POST')) {
      expect(code(route.file), route.file).toContain('await request.json().catch(() => null)')
    }
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

  it('both in-season services use it — neither maps SQLSTATEs of its own', () => {
    for (const rel of [SCHEDULE_SERVICE, TRANSACTIONS_SERVICE]) {
      const source = code(rel)
      expect(source, rel).toContain("import { mapInSeasonRpcError } from './inseason-errors'")
      expect(source, rel).not.toMatch(/'42501'|'P0001'|'P0002'|'22023'/)
    }
  })
})
