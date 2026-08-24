import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * **Two lists, one cache — the mock hooks may never invalidate only half of
 * it** (MP.5 review, **R518**).
 *
 * There are two questions about the same rows: *"my practice drafts for THIS
 * league"* (`mockDraftKeys.list(leagueId)`, the league launcher and the
 * league-home card) and *"my practice drafts"* (`mockDraftKeys.mine`, the
 * `/app/mocks` practice home). Both live under the `['mock-drafts', …]`
 * prefix, and **every mutation moves rows in BOTH** — a league mock launched
 * from a league belongs on the practice home too, and a mock deleted from
 * either surface leaves the other.
 *
 * The defect this exists to catch is the one R518 found: `useLaunchMockDraft`
 * invalidated `list(leagueId)` alone, so launching from a league left
 * `/app/mocks` stale — the exact disagreement `useDeleteMockDraft`'s own
 * docblock warns about, one mutation over. A per-key invalidation is correct
 * only while there is one list, and there are two.
 *
 * Source-level for the reason `route-groups.test.ts` and
 * `elevation-rule.test.ts` are: the claim is about what the file DOES, and
 * mounting a QueryClient to observe a refetch would pin the plumbing rather
 * than the rule.
 */

const HOOKS = 'src/hooks/use-mock-drafts.ts'

function code(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('every mock mutation invalidates the whole mock-drafts prefix (R518)', () => {
  const MUTATIONS = ['useLaunchMockDraft', 'useLaunchStandaloneMock', 'useDeleteMockDraft']

  /** One exported hook's body, so a neighbour cannot satisfy the pin. */
  function hookBody(name: string): string {
    const source = code(HOOKS)
    const start = source.indexOf(`export function ${name}`)
    expect(start, `${name} found`).toBeGreaterThan(-1)
    const next = MUTATIONS.concat(['useMyMockDrafts', 'useMockDrafts'])
      .map((other) => source.indexOf(`export function ${other}`, start + 1))
      .filter((at) => at > start)
    return source.slice(start, next.length > 0 ? Math.min(...next) : source.length)
  }

  for (const name of MUTATIONS) {
    it(`${name} invalidates ['mock-drafts'], not one key`, () => {
      const body = hookBody(name)
      expect(body, 'has an onSuccess').toContain('invalidateQueries')
      expect(body).toContain("queryKey: ['mock-drafts']")
      // The defect, pinned from the other side: a league-scoped key here is
      // half an invalidation.
      expect(body).not.toContain('mockDraftKeys.list(')
    })
  }

  it('both list keys really do sit under that prefix', () => {
    // The pin above is only meaningful if the prefix covers both questions.
    const source = code(HOOKS)
    expect(source).toContain("list: (leagueId: string) => ['mock-drafts', leagueId]")
    expect(source).toContain("mine: ['mock-drafts', 'mine']")
  })
})
