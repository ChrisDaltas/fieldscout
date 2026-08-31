/**
 * scoring-routes.test.ts — the two SE.6 Route Handlers' SHAPE.
 *
 * `scoring-api-db.test.ts` drives the SERVICE layer over the real stack, which
 * is the D68 convention and covers everything testable — but it means the
 * handler's own four lines are covered by nothing: the uuid guard, the
 * `auth.getUser()` 401, the delegation, and the status pass-through. Those
 * lines are exactly where a Route Handler goes wrong (an unauthenticated POST
 * reaching a service that assumes a session), and they are the reason the
 * route file exists at all.
 *
 * Source-level, for the reason `route-groups.test.ts` and
 * `use-mock-drafts-cache.test.ts` are: the claim is about what the file DOES,
 * and instantiating a Next Route Handler needs the `next/headers` cookie
 * plumbing this repo's suites deliberately do not stand up (CLAUDE.md: routes
 * carry minimal logic — the logic is tested one layer down).
 *
 * Falsifiability: deleting the `if (!user)` block from either route turns the
 * 401 assertion RED (shown in this task's PR); deleting the delegation turns
 * the service assertions RED.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROUTES = [
  {
    file: 'src/app/api/leagues/[id]/scoring/fork/route.ts',
    verb: 'POST',
    service: 'forkScoringTemplate',
  },
  {
    file: 'src/app/api/leagues/[id]/scoring/rules/route.ts',
    verb: 'PUT',
    service: 'updateScoringRules',
  },
] as const

/** File text with block comments and `//` lines removed, so a docblock that
 *  merely MENTIONS a guard cannot satisfy a pin about the code. */
function code(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('the two custom-scoring Route Handlers keep the house shape (§15.1)', () => {
  for (const route of ROUTES) {
    describe(route.file, () => {
      const source = code(route.file)

      it(`exports exactly ${route.verb} — no second verb sneaks onto the path`, () => {
        const exported = [...source.matchAll(/export async function (\w+)\(/g)].map((m) => m[1])
        expect(exported).toEqual([route.verb])
      })

      it('refuses an unauthenticated caller with 401 before touching the service', () => {
        // THE GUARD. Its absence is silent: the service would run with an
        // anon client, RLS would answer "no such league", and the caller
        // would read a 403/404 that looks like an authorization decision.
        expect(source).toContain('await supabase.auth.getUser()')
        expect(source).toContain('if (!user) {')
        expect(source).toContain("{ error: 'Unauthorized' }, { status: 401 }")
        // …and it comes BEFORE the service call, which is the whole point.
        expect(source.indexOf('if (!user) {')).toBeLessThan(source.indexOf(`${route.service}(`))
      })

      it('answers 404 for a malformed league id rather than passing it down', () => {
        // R675 — the fence's STRENGTH, not only its presence. Weakening
        // `z.uuid()` to `z.string()` was green across the whole non-stack
        // suite, `type-check` and `lint`; a malformed id then reaches
        // PostgREST, raises 22P02, and the mapper's default arm answers 500
        // echoing the raw Postgres message. (The obvious pin — importing the
        // schema — is not available: exporting a non-route symbol from a Next
        // 15 route file is a build-time type error, measured in review.)
        expect(source).toContain('const idSchema = z.uuid()')
        expect(source).toContain('idSchema.safeParse(id).success')
        expect(source).toContain("{ error: 'League not found' }, { status: 404 }")
      })

      it('delegates to the service and passes its status through unchanged', () => {
        expect(source).toContain(`${route.service}(supabase, id, body)`)
        expect(source).toContain('NextResponse.json(result.body, { status: result.status })')
        // An unparseable body becomes `null` and is refused by Zod one layer
        // down — never a 500 from `request.json()` throwing.
        expect(source).toContain('await request.json().catch(() => null)')
      })

      it('holds no rule of its own — no scoring logic in app/', () => {
        // CLAUDE.md: "app/ → Routes and layouts only. Minimal logic."
        for (const name of ['resolveRules', 'normalizeScoringDoc', 'validateScoringRulesDoc']) {
          expect(source, name).not.toContain(name)
        }
      })
    })
  }
})
