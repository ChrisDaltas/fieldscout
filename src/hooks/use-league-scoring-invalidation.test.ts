/**
 * **THE TEN-MINUTE HOLE — SE.6 / tasks-SE §0(C).**
 *
 * `auctionPoolKeys.scoring(leagueId)` = `['league-scoring-family', leagueId]`
 * carries `staleTime: 10 * 60 * 1000`, and before this task
 * `grep -rn "auctionPoolKeys.scoring\|league-scoring-family" src/` returned
 * **exactly two hits — the definition and the one use.** Nothing invalidated
 * it. So a commissioner's fork or save left every surface of their own client
 * that reads a league's scoring document — the auction player table today, the
 * §7.3.3.1 editor next — serving the **pre-edit** document for up to ten
 * minutes, with no error, no empty state and no way to tell: CLAUDE.md's
 * *"never let 'nothing happened' mean 'it worked'"* shape exactly.
 *
 * These pins drive a REAL `QueryClient` through the mutations' own options
 * objects with `MutationObserver` — no DOM, no React, no stack (the
 * `use-draft-feed-sink.test.ts` posture). That matters: a source-level pin
 * ("the file contains `invalidateQueries`") stays green the moment the call
 * moves somewhere that never runs, and the whole defect class here is a line
 * that does not run.
 *
 * The assertions are on the KEY's cache state, never on a refetch count, and
 * every one carries a NEGATIVE control — a second league's scoring entry and
 * the auction pool's own window entry, which must be untouched — so a blanket
 * `queryClient.invalidateQueries()` cannot pass this suite either. And the
 * determinant is pinned as well as the effect: a REFUSED save invalidates
 * nothing, which is what `onSuccess` (rather than `onSettled`) means.
 */
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ScoringRulesDoc } from '@/lib/leagues/scoring/rules-doc'

import { auctionPoolKeys } from './use-draft-pool'
import {
  forkScoringTemplateMutationOptions,
  leagueScoringInvalidationKeys,
  updateLeagueScoringMutationOptions,
} from './use-league'
import { leaguesKeys } from './use-leagues'

const LEAGUE = '3f2b1c4d-0000-4000-8000-000000000001'
const OTHER_LEAGUE = '3f2b1c4d-0000-4000-8000-000000000002'
const TEMPLATE = '3f2b1c4d-0000-4000-8000-0000000000aa'
const NEW_SYSTEM = '3f2b1c4d-0000-4000-8000-0000000000bb'

const DOC: ScoringRulesDoc = {
  format: 2,
  base: { receptions: 1 },
  positions: {},
  tier_cuts: { def_pa: [0, 1, 7, 14, 21, 28, 35], def_ya: [0, 100, 200] },
}

/** A pre-edit document sitting in the cache exactly as an open room holds it. */
const PRE_EDIT = { receptions: 0.5 }

function seededClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(auctionPoolKeys.scoring(LEAGUE), PRE_EDIT)
  client.setQueryData(leaguesKeys.detail(LEAGUE), { league: { id: LEAGUE } })
  // Negative controls — a different league's scoring, and the auction pool's
  // own player window. Neither has anything to do with this league's rules.
  client.setQueryData(auctionPoolKeys.scoring(OTHER_LEAGUE), PRE_EDIT)
  client.setQueryData(auctionPoolKeys.window('', ''), [])
  return client
}

const invalidated = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryState(key)?.isInvalidated

function stubFetch(response: { ok: boolean; status: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body),
    } as unknown as Response)
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe('the fork and the save each invalidate the scoring key (§0(C))', () => {
  it('the invalidation list names the reader’s own key, built by the reader’s own factory', () => {
    // Value-level, so a reader whose key silently changed shape would be
    // caught here rather than by ten minutes of wrong numbers in a room.
    expect(leagueScoringInvalidationKeys(LEAGUE)).toEqual([
      ['leagues', LEAGUE],
      ['league-scoring-family', LEAGUE],
    ])
  })

  it('fork: the open room’s scoring entry is invalidated; its neighbours are not', async () => {
    const client = seededClient()
    stubFetch({ ok: true, status: 200, body: { scoring_system_id: NEW_SYSTEM } })
    expect(invalidated(client, auctionPoolKeys.scoring(LEAGUE))).toBe(false)

    const observer = new MutationObserver(client, forkScoringTemplateMutationOptions(client, LEAGUE))
    await observer.mutate(TEMPLATE)

    expect(invalidated(client, auctionPoolKeys.scoring(LEAGUE))).toBe(true)
    // The repoint the fork performs lands in the league detail, so that moves too.
    expect(invalidated(client, leaguesKeys.detail(LEAGUE))).toBe(true)
    // …and nothing else does. A blanket invalidateQueries() fails right here.
    expect(invalidated(client, auctionPoolKeys.scoring(OTHER_LEAGUE))).toBe(false)
    expect(invalidated(client, auctionPoolKeys.window('', ''))).toBe(false)
  })

  it('save: the same, on the verb that is used every time a value is edited', async () => {
    const client = seededClient()
    const calls = stubFetch({ ok: true, status: 200, body: { scoring_system_id: NEW_SYSTEM } })

    const observer = new MutationObserver(client, updateLeagueScoringMutationOptions(client, LEAGUE))
    await observer.mutate(DOC)

    expect(invalidated(client, auctionPoolKeys.scoring(LEAGUE))).toBe(true)
    expect(invalidated(client, leaguesKeys.detail(LEAGUE))).toBe(true)
    expect(invalidated(client, auctionPoolKeys.scoring(OTHER_LEAGUE))).toBe(false)
    expect(invalidated(client, auctionPoolKeys.window('', ''))).toBe(false)

    // The document reaches the wire unchanged — no layer between the editor
    // and the RPC rewrites it (the RPC REFUSES an un-normalized document
    // rather than normalizing it; migration 105's `scoring_update_rules`).
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`/api/leagues/${LEAGUE}/scoring/rules`)
    expect(calls[0].init.method).toBe('PUT')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ rules: DOC })
  })

  it('a REFUSED save invalidates nothing — the determinant is success, not completion', async () => {
    const client = seededClient()
    const message =
      'scoring_update_rules: league x is on a shared template — fork first, templates are immutable (§7.3.3.1)'
    stubFetch({ ok: false, status: 409, body: { error: message } })

    const observer = new MutationObserver(client, updateLeagueScoringMutationOptions(client, LEAGUE))
    const failure = await observer.mutate(DOC).catch((error: unknown) => error)

    // The refusal reaches the caller as the shape the settings panel branches
    // on, carrying the RPC's own sentence.
    expect((failure as { name: string }).name).toBe('LeaguePatchError')
    expect((failure as { status: number }).status).toBe(409)
    expect((failure as Error).message).toBe(message)

    // Nothing changed on the server, so nothing may be marked stale: an
    // invalidate-on-settled would refetch the document the room already
    // holds — motion that looks like a fix and hides the next real staleness.
    expect(invalidated(client, auctionPoolKeys.scoring(LEAGUE))).toBe(false)
    expect(invalidated(client, leaguesKeys.detail(LEAGUE))).toBe(false)
  })

  it('a 400 with field errors arrives with its paths intact', async () => {
    const client = seededClient()
    stubFetch({
      ok: false,
      status: 400,
      body: { error: { fieldErrors: { 'rules.base.receptions': ['too big'] } } },
    })

    const observer = new MutationObserver(client, updateLeagueScoringMutationOptions(client, LEAGUE))
    const failure = (await observer
      .mutate(DOC)
      .catch((error: unknown) => error)) as { status: number; fieldErrors?: Record<string, string[]> }

    expect(failure.status).toBe(400)
    expect(failure.fieldErrors).toEqual({ 'rules.base.receptions': ['too big'] })
    expect(invalidated(client, auctionPoolKeys.scoring(LEAGUE))).toBe(false)
  })
})

describe('the reader and the invalidator cannot drift apart', () => {
  it('useLeagueScoringFamily builds its queryKey from auctionPoolKeys.scoring', () => {
    // The behavioural pins above compare the invalidated key against
    // `auctionPoolKeys.scoring`. That is only meaningful while the READER
    // registers its query under that same factory — a hook that inlined the
    // literal would drift silently. Source-level for the reason
    // `use-mock-drafts-cache.test.ts` is: the claim is about what the file
    // DOES, and mounting the hook needs a DOM this repo deliberately has not.
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/hooks/use-draft-pool.ts'),
      'utf8',
    )
    const at = source.indexOf('export function useLeagueScoringFamily')
    expect(at).toBeGreaterThan(-1)
    const body = source.slice(at, at + 2000)
    expect(body).toContain('queryKey: auctionPoolKeys.scoring(')
    expect(body).toContain('staleTime: 10 * 60 * 1000')
  })
})
