import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Duplicate — someone else's ranking becomes YOUR ranking (Chris,
 * 2026-10-18: "the way that works is a user duplicates the ranking, no need
 * for some make a new one like this"; 2026-10-19: "If a user dupes some
 * popular ranking it then becomes their own"). It replaced "Start my ranking
 * from this" (gap list §3 #28).
 *
 * Pinned:
 *   1. which lists get it, and for which of your rankings (the same period;
 *      a played or not-yet-open week can't be duplicated now);
 *   2. the scoring rule (yours stays when your board has one, else the
 *      original's), the "Replace …?" question and the toast;
 *   3. the requests: the ranking's own read, your board's read, then the
 *      ranking publish's own writes — exact copy at the copied positions,
 *      every other position untouched — and a failed step fails it;
 *   4. copying never reaches AI list generation (it costs real money and
 *      the ranking already exists): the import graph and the source of
 *      every file on the path.
 */

// The client pieces of AI list generation (`POST /api/lists/generate`):
// importing any of them from the Duplicate path throws (see "import graph").
const AI_GENERATION_MODULES = vi.hoisted(() => [
  '@/hooks/use-ai-list-build',
  '@/hooks/use-ai-generation-quota',
  '@/components/mobile/lists/ai-create-sheet',
  '@/components/lists/generate-ai-modal',
])
const reachedAi = (name: string) => {
  throw new Error(`AI list generation (${name}) is on the Duplicate path`)
}
vi.mock('@/hooks/use-ai-list-build', () => reachedAi('@/hooks/use-ai-list-build'))
vi.mock('@/hooks/use-ai-generation-quota', () => reachedAi('@/hooks/use-ai-generation-quota'))
vi.mock('@/components/mobile/lists/ai-create-sheet', () => reachedAi('@/components/mobile/lists/ai-create-sheet'))
vi.mock('@/components/lists/generate-ai-modal', () => reachedAi('@/components/lists/generate-ai-modal'))

import type { MyRankingBoards } from '@/hooks/use-mobile-rankings-boards'
import { duplicateRanking } from '@/hooks/use-duplicate-ranking'

import {
  duplicateQuestion,
  duplicateScoring,
  duplicatedToast,
  hasRankingAt,
  myRankingDesktopHref,
  myRankingEditorHref,
  rankingDuplicateOf,
  replaceQuestion,
} from './duplicate-ops'

// ---------------------------------------------------------------------------
// 1. Which lists, which of your rankings
// ---------------------------------------------------------------------------

describe('which lists Duplicate makes into your ranking', () => {
  const on = { owned: false, currentWeek: 6, rankingsOn: true }
  const expertBoard = { is_big_board: false, slug: 'top-25-rb-ppr', ai_persona_id: 'p1' }
  const bigBoard = { is_big_board: true, slug: 'big-board', ai_persona_id: null }
  const week = (n: number) => ({ is_big_board: false, slug: `week-${n}-big-board-1760000000000`, ai_persona_id: null })

  it('an AI expert’s board and a person’s big board: your season ranking, always open', () => {
    expect(rankingDuplicateOf(expertBoard, on)).toEqual({ type: 'season', week: 0, blocked: null })
    expect(rankingDuplicateOf(bigBoard, on)).toEqual({ type: 'season', week: 0, blocked: null })
  })

  it('a weekly ranking: your ranking for the same week — this week and the next three', () => {
    expect(rankingDuplicateOf(week(6), on)).toEqual({ type: 'w6', week: 6, blocked: null })
    expect(rankingDuplicateOf(week(9), on)).toEqual({ type: 'w9', week: 9, blocked: null })
  })

  it('a played week, or one not open yet, can’t be duplicated now — and says why', () => {
    expect(rankingDuplicateOf(week(5), on)?.blocked).toBe('Week 5 is over')
    expect(rankingDuplicateOf(week(12), on)?.blocked).toBe('Week 12 opens in Week 9')
  })

  it('a plain list, your own ranking, or Rankings switched off: the list Duplicate (null)', () => {
    expect(rankingDuplicateOf({ is_big_board: false, slug: 'my-sleepers', ai_persona_id: null }, on)).toBeNull()
    expect(rankingDuplicateOf(bigBoard, { ...on, owned: true })).toBeNull()
    expect(rankingDuplicateOf(expertBoard, { ...on, rankingsOn: false })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. Scoring, the question, the toast, where it opens
// ---------------------------------------------------------------------------

describe('the scoring a Duplicate publishes with', () => {
  it('your board already has one: it stays — a board has one scoring for every position', () => {
    expect(duplicateScoring('half', 'ppr')).toEqual({ format: 'half', keptYours: true, original: 'ppr' })
  })
  it('your board has none yet: the original’s', () => {
    expect(duplicateScoring(null, 'standard')).toEqual({ format: 'standard', keptYours: false, original: 'standard' })
    expect(duplicateScoring(undefined, 'quarter').format).toBe('quarter')
  })
  it('neither has one: Half PPR (Chris, 2026-10-16)', () => {
    expect(duplicateScoring(null, null)).toEqual({ format: 'half', keptYours: false, original: 'half' })
  })
})

describe('what Duplicate says', () => {
  it('asks before replacing a ranking you have — one position, or several', () => {
    expect(replaceQuestion('w7', ['RB'], 6)).toBe('Replace your Week 7 RB ranking with this one?')
    expect(replaceQuestion('season', ['QB', 'RB', 'DST'], 0)).toBe(
      'Replace your Pre-draft QB, RB and D/ST rankings with this one?',
    )
    expect(replaceQuestion('season', ['RB', 'WR'], 6)).toBe(
      'Replace your Rest of season RB and WR rankings with this one?',
    )
    expect(duplicateQuestion('w8', ['TE'], 6)).toBe('Duplicate this as your Week 8 TE ranking?')
  })

  it('the toast: it’s your ranking now — and when your own scoring was kept over another, so', () => {
    expect(duplicatedToast(duplicateScoring(null, 'ppr'))).toEqual({ title: 'Duplicated — it’s your ranking now' })
    expect(duplicatedToast(duplicateScoring('ppr', 'ppr'))).toEqual({ title: 'Duplicated — it’s your ranking now' })
    expect(duplicatedToast(duplicateScoring('half', 'ppr'))).toEqual({
      title: 'Duplicated — it’s your ranking now',
      description: 'It keeps your Half PPR scoring.',
    })
    expect(duplicatedToast(duplicateScoring(null, 'ppr'), 'boom').description).toBe("Its scoring wasn't saved: boom")
  })

  it('opens yours: the phone’s editor in Rankings › Mine; desktop’s Rankings page or that week’s board', () => {
    expect(myRankingEditorHref('w7', 'RB')).toBe('/app/weekly-ranks?view=mine&pos=RB&edit=w7&ep=RB')
    expect(myRankingEditorHref('season', 'DST')).toBe('/app/weekly-ranks?view=mine&pos=DST&edit=season&ep=DST')
    expect(myRankingDesktopHref(0)).toBe('/app/weekly-ranks?tab=pre')
    expect(myRankingDesktopHref(7)).toBe('/app/big-board/week/7')
  })
})

describe('do you already have a ranking there?', () => {
  const player = (position: string) => ({
    list_id: 'x',
    player_id: `${position}-1`,
    position: 1,
    updated_at: null,
    added_at: null,
    player: { id: `${position}-1`, full_name: 'A B', position, team: 'KC', headshot_url: null },
  })
  const boards: MyRankingBoards = {
    season: { listId: 's', week: 0, players: [player('RB')] },
    weeks: [{ listId: 'w7', week: 7, players: [player('DEF')] }],
  }
  it('by period and position', () => {
    expect(hasRankingAt(boards, 0, ['RB'])).toBe(true)
    expect(hasRankingAt(boards, 0, ['WR'])).toBe(false)
    expect(hasRankingAt(boards, 7, ['DST'])).toBe(true)
    expect(hasRankingAt(boards, 8, ['DST'])).toBe(false)
    expect(hasRankingAt(undefined, 0, ['RB'])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. The requests
// ---------------------------------------------------------------------------

type Call = { method: string; url: string; body?: unknown }

const net = {
  calls: [] as Call[],
  routes: new Map<string, () => Response>(),
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  net.calls.length = 0
  net.routes.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      net.calls.push({ method, url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) })
      const route = net.routes.get(`${method} ${url}`)
      return route ? route() : json({ ok: true })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const row = (id: string, position: string, slot = 0) => ({
  player_id: id,
  position: slot,
  player: { position },
})

describe('the requests a Duplicate makes', () => {
  it('season, one position of an overall AI expert board: an exact copy at RB, your scoring kept', async () => {
    net.routes.set('GET /api/lists/e1-all', () =>
      json({
        scoring_format: 'ppr',
        players: [row('w1', 'WR'), row('r1', 'RB'), row('w2', 'WR'), row('r2', 'RB'), row('q1', 'QB')],
      }),
    )
    net.routes.set('GET /api/lists/big-board', () =>
      json({
        list: { id: 'season', scoring_format: 'half' },
        players: [row('r9', 'RB', 1), row('w9', 'WR', 2), row('r1', 'RB', 3), row('q9', 'QB', 4)],
      }),
    )

    const res = await duplicateRanking({ sourceListId: 'e1-all', week: 0, positions: ['RB'] })

    expect(net.calls).toEqual([
      { method: 'GET', url: '/api/lists/e1-all' },
      { method: 'GET', url: '/api/lists/big-board' },
      // Yours at RB that the copy doesn't rank leave it.
      { method: 'DELETE', url: '/api/lists/season/players/r9' },
      { method: 'POST', url: '/api/lists/season/players/bulk', body: { player_ids: ['r2'] } },
      // The season board's publish route; only RB's own slots are sent.
      {
        method: 'POST',
        url: '/api/big-board/save',
        body: {
          positions: [
            { playerId: 'r1', position: 1 },
            { playerId: 'r2', position: 3, isNew: true },
          ],
          scoringFormat: 'half',
        },
      },
    ])
    expect(res).toEqual({
      listId: 'season',
      week: 0,
      positions: ['RB'],
      openAt: 'RB',
      scoring: { format: 'half', keptYours: true, original: 'ppr' },
      scoringError: undefined,
    })
  })

  it('a week you never ranked: its board is made by the read, every position copied, the original’s scoring', async () => {
    net.routes.set('GET /api/lists/kelly-w7', () =>
      json({
        scoring_format: 'standard',
        players: [row('r1', 'RB'), row('q1', 'QB'), row('r2', 'RB')],
      }),
    )
    // The weekly GET creates the week (seeded from your latest ranking).
    net.routes.set('GET /api/big-board/week/7', () =>
      json({
        list: { id: 'my-w7', scoring_format: null },
        players: [row('q8', 'QB', 1), row('r8', 'RB', 2), row('k8', 'K', 3)],
        created: true,
      }),
    )

    const res = await duplicateRanking({ sourceListId: 'kelly-w7', week: 7, positions: null })

    expect(res.positions).toEqual(['QB', 'RB'])
    // Yours opens where the original leads.
    expect(res.openAt).toBe('RB')
    expect(res.scoring).toEqual({ format: 'standard', keptYours: false, original: 'standard' })
    const writes = net.calls.slice(2)
    expect(writes.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
      '/api/lists/my-w7/players/q8',
      '/api/lists/my-w7/players/r8',
    ])
    expect(writes.find((c) => c.url.endsWith('/bulk'))?.body).toEqual({ player_ids: ['r1', 'q1', 'r2'] })
    // A week's board publishes through the reorder route; its first version
    // has no previous positions (#33). The K it was seeded with stays.
    expect(writes[writes.length - 1]).toEqual({
      method: 'PATCH',
      url: '/api/lists/my-w7/players/reorder',
      body: {
        positions: [
          { playerId: 'r1', position: 1, isNew: true },
          { playerId: 'q1', position: 2, isNew: true },
          { playerId: 'r2', position: 4, isNew: true },
        ],
        scoringFormat: 'standard',
      },
    })
  })

  it('nothing at the position to copy: it fails, and never touches your board', async () => {
    net.routes.set('GET /api/lists/e1-qb', () => json({ scoring_format: 'ppr', players: [row('q1', 'QB')] }))
    await expect(duplicateRanking({ sourceListId: 'e1-qb', week: 0, positions: ['RB'] })).rejects.toThrow(
      'This ranking has no players to copy',
    )
    expect(net.calls.map((c) => c.url)).toEqual(['/api/lists/e1-qb'])
  })

  it('a failed step fails the Duplicate — it is never reported as done', async () => {
    net.routes.set('GET /api/lists/e1-rb', () => json({ players: [row('r1', 'RB')] }))
    net.routes.set('GET /api/lists/big-board', () =>
      json({ list: { id: 'season', scoring_format: 'half' }, players: [row('r9', 'RB', 1)] }),
    )
    net.routes.set('DELETE /api/lists/season/players/r9', () => json({ error: 'Forbidden' }, 403))
    await expect(duplicateRanking({ sourceListId: 'e1-rb', week: 0, positions: ['RB'] })).rejects.toThrow('Forbidden')
    expect(net.calls.some((c) => c.url === '/api/big-board/save')).toBe(false)
  })

  it('never calls AI list generation', async () => {
    net.routes.set('GET /api/lists/e1-rb', () => json({ players: [row('r1', 'RB')] }))
    net.routes.set('GET /api/lists/big-board', () => json({ list: { id: 'season' }, players: [] }))
    await duplicateRanking({ sourceListId: 'e1-rb', week: 0, positions: ['RB'] })
    expect(net.calls.some((c) => c.url.includes('/api/lists/generate'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4. Never AI generation: the import graph and the sources
// ---------------------------------------------------------------------------

describe('the Duplicate path never reaches AI list generation (import graph)', () => {
  it('the trap is armed: each AI generation module fails to import here', async () => {
    for (const name of AI_GENERATION_MODULES) {
      await expect(import(/* @vite-ignore */ name), name).rejects.toThrow()
    }
  })

  it('the screens that offer Duplicate import none of them', async () => {
    await expect(import('./rankings-hub')).resolves.toHaveProperty('RankingsHub')
    await expect(import('./ranking-editor')).resolves.toHaveProperty('RankingEditor')
    await expect(import('./duplicate-ranking')).resolves.toHaveProperty('useDuplicateRankingFlow')
    await expect(import('@/components/mobile/community/community-detail')).resolves.toHaveProperty('CommunityDetail')
    await expect(import('@/components/lists/v2/ranking-duplicate-dialog')).resolves.toHaveProperty(
      'RankingDuplicateDialog',
    )
  })
})

describe('the Duplicate path never reaches AI list generation (source pins)', () => {
  const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')
  const RANKINGS_DIR = 'src/components/mobile/rankings'
  /** The phone's Rankings screens, Duplicate's pieces, and the hooks they
   *  read and publish with. */
  const PATH = [
    ...readdirSync(path.resolve(process.cwd(), RANKINGS_DIR))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => `${RANKINGS_DIR}/${f}`),
    'src/hooks/use-duplicate-ranking.ts',
    'src/hooks/use-mobile-rankings-sources.ts',
    'src/hooks/use-mobile-rankings-boards.ts',
    'src/hooks/use-mobile-rankings-save.ts',
    'src/components/mobile/community/community-cards.tsx',
    'src/components/mobile/community/community-detail.tsx',
    'src/components/mobile/community/community-ops.ts',
    'src/components/mobile/community/list-actions.tsx',
    'src/components/lists/v2/ranking-duplicate-dialog.tsx',
  ]

  /** The route, and every client piece that reaches it (by file and by name). */
  const AI_GENERATION =
    /api\/lists\/generate|generate-ai|GenerateAi|ai-build|useGenerate|use-ai-list-build|useAiListBuild|ai-create-sheet|AiCreateSheet|ai-generation-quota|useAiGenerationQuota/

  it('the pattern catches each client piece of generation', () => {
    for (const piece of [
      "fetch('/api/lists/generate', { method: 'POST' })",
      "import { useAiListBuild } from '@/hooks/use-ai-list-build'",
      "import { AiCreateSheet } from '@/components/mobile/lists/ai-create-sheet'",
      "import { useAiGenerationQuota } from '@/hooks/use-ai-generation-quota'",
      "import { GenerateAiModal } from '@/components/lists/generate-ai-modal'",
      "import { AiBuildStrip } from './ai-build-strip'",
    ]) {
      expect(piece).toMatch(AI_GENERATION)
    }
  })

  it('no file on it names the generation route or its client pieces', () => {
    expect(PATH.length).toBeGreaterThan(10)
    for (const file of PATH) {
      expect(read(file), file).not.toMatch(AI_GENERATION)
    }
  })

  it('"Start my ranking from this" is gone: no screen offers it, and the editor has no expert start', () => {
    for (const file of PATH) {
      expect(read(file), file).not.toMatch(/Start my ranking|Start from this ranking/)
    }
    const editor = read(`${RANKINGS_DIR}/ranking-editor.tsx`)
    expect(editor).not.toContain('usePersonaBoardPlayers')
    expect(editor).not.toContain("startsWith('p:')")
  })
})
