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
    const calls = stubFetch({ ok: true, status: 200, body: { scoring_system_id: NEW_SYSTEM } })
    expect(invalidated(client, auctionPoolKeys.scoring(LEAGUE))).toBe(false)

    const observer = new MutationObserver(client, forkScoringTemplateMutationOptions(client, LEAGUE))
    await observer.mutate(TEMPLATE)

    // R670 — **the JOIN, not just the two ends.** The server half of this
    // contract is pinned twice (the strict schema, and the route's POST-only
    // export), and the fork's own request was pinned nowhere: URL, method and
    // body key could each be mutated with the whole suite green, and `PUT`ing
    // the save's URL with `{ templateId }` is a 405 in production against a
    // route whose POST-only export is itself pinned. Asserted here the way the
    // save cell below already does.
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`/api/leagues/${LEAGUE}/scoring/fork`)
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ template_id: TEMPLATE })

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

  it('a REFUSED fork invalidates nothing either — the determinant, on BOTH verbs', async () => {
    // R671 — probe (B) flips both mutations at once but only the SAVE's cells
    // red, so the fork's `onSuccess`-vs-`onSettled` choice was reported as
    // pinned while nothing tested it. (The harm direction on the fork is the
    // safe one — an over-invalidation — which is exactly why it would have sat
    // untested indefinitely.)
    const client = seededClient()
    const message =
      'scoring_fork_template: league x is in drafting — scoring can only be customized while the league is in setup or scheduled'
    stubFetch({ ok: false, status: 409, body: { error: message } })

    const observer = new MutationObserver(client, forkScoringTemplateMutationOptions(client, LEAGUE))
    const failure = await observer.mutate(TEMPLATE).catch((error: unknown) => error)

    expect((failure as { status: number }).status).toBe(409)
    expect((failure as Error).message).toBe(message)
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

/**
 * **THE SEAMS.** The behavioural pins above prove what `invalidateLeagueScoring`
 * DOES. They cannot see the three edges of the construction it sits inside, and
 * a review measured all three escaping (R666/R667/R669/R670 — the review's §7
 * "when a defect class is closed by CONSTRUCTION, the construction gets pinned
 * and its EDGES do not"):
 *
 *   1. which call sites route through it (a whole WRITER was missing);
 *   2. whether the shipped hooks still use the factories the pins drive;
 *   3. whether the reader's key ARGUMENT still matches the invalidator's.
 *
 * Source-level, for the reason `use-mock-drafts-cache.test.ts` is: the claim is
 * about which line a file contains at a call site, and mounting a React hook
 * needs a DOM this repo deliberately does not have. Each assertion below was
 * shown RED against the exact mutation it exists to catch.
 */
describe('the seams of the invalidation construction', () => {
  const source = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), 'utf8')

  /** One exported function's body, so a neighbour cannot satisfy the pin. */
  function bodyOf(text: string, name: string): string {
    const at = text.indexOf(`export function ${name}`)
    expect(at, `${name} found`).toBeGreaterThan(-1)
    const next = text.indexOf('\nexport ', at + 1)
    return text.slice(at, next > at ? next : text.length)
  }

  it('EVERY writer of the league scoring document routes through the shared list (R666)', () => {
    // The enumeration is the point. `create_league` is the fourth writer and
    // is deliberately absent: it mints the league, so there is no prior cache
    // entry to stale. A fifth writer added without a line here is the defect
    // this cell exists to catch — the previous docblock addressed "any future
    // writer" and missed an existing one.
    const hooks = source('src/hooks/use-league.ts')
    for (const writer of [
      'useForkScoringTemplate',
      'useUpdateLeagueScoring',
      'useUpdateLeagueSettings',
    ]) {
      const body = bodyOf(hooks, writer)
      expect(body, `${writer} invalidates the scoring key`).toMatch(
        /invalidateLeagueScoring\(queryClient, leagueId\)|MutationOptions\(queryClient, leagueId\)/,
      )
    }
    // …and `useUpdateLeagueSettings` reaches it directly, not by a rename.
    expect(bodyOf(hooks, 'useUpdateLeagueSettings')).toContain(
      'invalidateLeagueScoring(queryClient, leagueId)',
    )
  })

  it('the shipped hooks still use the factories these pins drive (R667)', () => {
    // The factories are exported precisely so a pin cannot be defeated by the
    // call moving somewhere that never runs — and the identical escape lived
    // one level up: inlining `useMutation({ mutationFn })` with no `onSuccess`
    // was green on this suite, `tsc` and `lint`.
    const hooks = source('src/hooks/use-league.ts')
    expect(bodyOf(hooks, 'useForkScoringTemplate')).toContain(
      'useMutation(forkScoringTemplateMutationOptions(queryClient, leagueId))',
    )
    expect(bodyOf(hooks, 'useUpdateLeagueScoring')).toContain(
      'useMutation(updateLeagueScoringMutationOptions(queryClient, leagueId))',
    )
  })

  it('the reader registers under the same key ARGUMENT the invalidator passes (R669)', () => {
    // The shared factory fixes the key's SHAPE; its ARGUMENT is chosen per call
    // site. In a league room BOTH ids are supplied, so reversing this `??`
    // order parks the reader on a key no invalidation reaches — and it passed
    // the entire unit lane and `tsc` before this assertion existed.
    const body = bodyOf(source('src/hooks/use-draft-pool.ts'), 'useLeagueScoringFamily')
    expect(body).toContain('queryKey: auctionPoolKeys.scoring(leagueId ?? scoringSystemId ??')
    expect(body).toContain('staleTime: 10 * 60 * 1000')
  })
})
