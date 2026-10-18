import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Gap list §3 #28: "Start my ranking from this" on an AI expert's ranking
 * copies that ranking into a new one of yours — and copying must never call
 * AI list generation (it costs real money, and the ranking already exists).
 *
 * The copy is the editor's `from: "p:<listId>"` start: it reads the expert's
 * board players (`usePersonaBoardPlayers` → `list_players`) and nothing
 * else. Pinned two ways: the read itself, run against a recording client;
 * and the source of every file on the copy path, so a later change can't
 * route it through generation unnoticed.
 */

const seen = vi.hoisted(() => ({
  queries: [] as Array<{ queryKey: unknown; enabled?: boolean; queryFn: () => Promise<unknown> }>,
  tables: [] as string[],
  filters: [] as Array<[string, unknown]>,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (opts: (typeof seen.queries)[number]) => {
    seen.queries.push(opts)
    return { data: undefined }
  },
}))

const ROWS = [
  { position: 1, player: { id: 'r1', full_name: 'Bijan Robinson', position: 'RB' } },
  { position: 2, player: [{ id: 'r2', full_name: 'Jahmyr Gibbs', position: 'RB' }] },
  { position: 3, player: null },
]

vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: (table: string) => {
      seen.tables.push(table)
      const q = {
        select: () => q,
        eq: (col: string, value: unknown) => {
          seen.filters.push([col, value])
          return q
        },
        order: () => q,
        limit: async () => ({ data: ROWS, error: null }),
      }
      return q
    },
  }),
}))

afterEach(() => {
  vi.restoreAllMocks()
  seen.queries.length = 0
  seen.tables.length = 0
  seen.filters.length = 0
})

describe('"Start my ranking from this" copies the expert’s ranking — no AI generation', () => {
  it('the copy reads the board’s own players, in its order, and makes no other call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { usePersonaBoardPlayers } = await import('@/hooks/use-board-sources')
    usePersonaBoardPlayers('board-1')
    expect(seen.queries).toHaveLength(1)
    const players = (await seen.queries[0]!.queryFn()) as Array<{ id: string }>
    expect(seen.tables).toEqual(['list_players'])
    expect(seen.filters).toEqual([['list_id', 'board-1']])
    expect(players.map((p) => p.id)).toEqual(['r1', 'r2'])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('nothing is read until a copy is asked for', async () => {
    const { usePersonaBoardPlayers } = await import('@/hooks/use-board-sources')
    usePersonaBoardPlayers(null)
    expect(seen.queries[0]!.enabled).toBe(false)
  })
})

describe('the copy path never reaches AI list generation (source pins)', () => {
  const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')
  const RANKINGS_DIR = 'src/components/mobile/rankings'
  /** The phone's Rankings screens, and the hooks they read and publish with. */
  const COPY_PATH = [
    ...readdirSync(path.resolve(process.cwd(), RANKINGS_DIR))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => `${RANKINGS_DIR}/${f}`),
    'src/hooks/use-board-sources.ts',
    'src/hooks/use-mobile-rankings-sources.ts',
    'src/hooks/use-mobile-rankings-boards.ts',
    'src/hooks/use-mobile-rankings-save.ts',
    'src/components/mobile/community/community-cards.tsx',
    'src/components/mobile/community/community-ops.ts',
  ]

  it('the editor starts a copy from the expert’s board players', () => {
    const editor = read(`${RANKINGS_DIR}/ranking-editor.tsx`)
    expect(editor).toContain("effFrom?.startsWith('p:') ? effFrom.slice(2) : null")
    expect(editor).toContain('usePersonaBoardPlayers(personaListId)')
  })

  it('no file on it names the generation route or its client pieces', () => {
    expect(COPY_PATH.length).toBeGreaterThan(8)
    for (const file of COPY_PATH) {
      const src = read(file)
      expect(src, file).not.toMatch(/api\/lists\/generate/)
      expect(src, file).not.toMatch(/generate-ai|GenerateAi|ai-build|useGenerate/)
    }
  })
})
