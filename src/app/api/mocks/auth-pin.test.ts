/**
 * THE `/api/mocks/**` FAMILY ANSWERS 401 SIGNED OUT — every handler, found by
 * walking the directory rather than by listing them (MP task MP.8 item 8;
 * filed at MP.6b's review as **R526**).
 *
 * **Why one family pin instead of a test per route.** MP.6b shipped six
 * standalone verb routes with no route-level test — house parity (the league
 * siblings are equally untested) with RLS as the backstop. The gap R526 named
 * is not that any one route is wrong, it is that **a route added later could
 * forget the guard and nothing would say so.** So the pin is written against
 * the FAMILY: it discovers every `route.ts` under `src/app/api/mocks`, calls
 * every HTTP method each one exports, and requires a 401 from all of them
 * with no session. A seventh route inherits this test the moment it is
 * created — which is the only version of it worth having.
 *
 * **It is a real invocation, not a source grep.** The Supabase server client
 * is faked to a signed-out session, so a handler that reads the user and
 * returns 401 passes and one that falls through to the service layer does
 * not. The fake's `from()` throws: **any handler that reaches the database
 * signed-out fails loudly here rather than returning some other status that
 * happens not to be 200.**
 *
 * It does NOT claim these routes are otherwise authorized — that is the
 * launcher predicate inside `resolveDraftForAction` (MP.6b), pinned
 * stack-backed in `standalone-actions-db.test.ts`.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    from: () => {
      throw new Error('a signed-out handler must not reach the database')
    },
    rpc: () => {
      throw new Error('a signed-out handler must not reach the database')
    },
  }),
}))

const API_MOCKS = path.resolve(process.cwd(), 'src/app/api/mocks')
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const

/** Every `route.ts` under /api/mocks, as an import specifier + its URL. */
function routeFiles(): Array<{ rel: string; url: string }> {
  const found: Array<{ rel: string; url: string }> = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry === 'route.ts') {
        const rel = path.relative(process.cwd(), full)
        const segs = path.relative(API_MOCKS, path.dirname(full)).split(path.sep).filter(Boolean)
        found.push({ rel, url: ['/api/mocks', ...segs].join('/') })
      }
    }
  }
  walk(API_MOCKS)
  return found.sort((a, b) => a.rel.localeCompare(b.rel))
}

/** A params promise for whatever dynamic segments the URL declares. */
function paramsFor(url: string) {
  const params: Record<string, string> = {}
  for (const seg of url.split('/')) {
    if (seg.startsWith('[') && seg.endsWith(']')) {
      params[seg.slice(1, -1)] = '00000000-0000-4000-8000-000000000000'
    }
  }
  return Promise.resolve(params)
}

describe('every /api/mocks handler refuses a signed-out caller (R526)', () => {
  const files = routeFiles()

  it('the walk actually found the family (a zero here would pass vacuously)', () => {
    // CLAUDE.md: never let "nothing happened" mean "it worked". An empty
    // discovery would make every assertion below run zero times.
    expect(files.length).toBeGreaterThanOrEqual(8)
    expect(files.map((f) => f.url)).toContain('/api/mocks')
    expect(files.map((f) => f.url)).toContain('/api/mocks/[mockId]/pick')
  })

  for (const file of files) {
    it(`${file.url} → 401`, async () => {
      const mod = (await import(/* @vite-ignore */ path.resolve(process.cwd(), file.rel))) as Record<
        string,
        unknown
      >
      const exported = METHODS.filter((m) => typeof mod[m] === 'function')
      expect(exported.length, `${file.rel} exports at least one handler`).toBeGreaterThan(0)

      for (const method of exported) {
        const handler = mod[method] as (
          request: Request,
          ctx: { params: Promise<Record<string, string>> },
        ) => Promise<Response>
        const request = new Request(`http://localhost${file.url.replace(/\[|\]/g, '')}`, {
          method,
          ...(method === 'GET' || method === 'DELETE'
            ? {}
            : { body: '{}', headers: { 'content-type': 'application/json' } }),
        })
        const response = await handler(request, { params: paramsFor(file.url) })
        expect(response.status, `${method} ${file.url}`).toBe(401)
      }
    })
  }
})
