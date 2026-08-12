import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { draftedKeys, markMutationOptions } from '@/hooks/use-draft-mode'

import {
  fanOutReport,
  joinTitles,
  planFanOut,
  runFanOut,
  type ColumnMembership,
  type FanOutColumn,
} from './drafted-fan-out'

/**
 * LV.14 — the drafted fan-out, **executed**.
 *
 * This is deliberately not a source-pin file. `drafted-fan-out.ts` is a `.ts`
 * with no JSX precisely so that vitest (node, no jsdom) can run it: D12's rule
 * is a set intersection and a partial-failure protocol, and both are decisions,
 * not markup. The parts that genuinely cannot execute here — the JSX wiring in
 * `side-by-side-columns.tsx` — are pinned as source in
 * `side-by-side-columns.test.ts`, and the behaviour itself was measured in the
 * browser against the local stack (PROGRESS §4).
 *
 * What has to hold, and why each one has a test rather than an argument:
 *
 *   1. **The set is `columns ∩ lists containing him`** — not all columns, and
 *      never a list outside the comparison. That second half *is* Chris's
 *      2026-08-10 ruling; the design package says the opposite, so a build that
 *      drifted back to global would look like the screenshots.
 *   2. **A partial failure must not lie.** Three of five landing must leave two
 *      columns rolled back and the user told which. The rollback half is driven
 *      here through the **real** `markMutationOptions` over a **real**
 *      `QueryClient` with five cache entries — this build has been bitten three
 *      times (R190/R195/R199) by a mechanism that was right in the middle and
 *      wrong at an edge, and "each column has its own cache key so it must be
 *      isolated" is exactly that kind of claim.
 *   3. **Unticking is symmetric** — same set, no wider, and it converges
 *      columns that disagreed rather than inverting each of them.
 *   4. **A column that cannot answer is skipped, and the two reasons for that
 *      are told to the user differently** (still loading → say so; failed to
 *      load → the column already says so, permanently, on screen).
 */

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')

/** Comments stripped, so a pin cannot be satisfied by the prose about it. */
const code = (file: string) =>
  read(file).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (_match, before) => before ?? '')

const FAN_OUT = 'src/components/lists/v2/drafted-fan-out.ts'
const PANEL = 'src/components/lists/v2/list-detail-panel.tsx'

const PLAYER = 'p-nabers'

/**
 * A column, as the fan-out sees one. `write` records rather than fetches, so the
 * plan-level tests can watch exactly who was asked for what.
 */
function column(
  listId: string,
  options: {
    title?: string
    membership?: ColumnMembership
    drafted?: boolean
    fails?: boolean
    writes?: Array<{ listId: string; playerId: string; drafted: boolean }>
  } = {},
): FanOutColumn {
  const { title = listId, membership = 'in', drafted = false, fails = false, writes } = options
  return {
    listId,
    title,
    membership: () => membership,
    // What a tap in THIS column would ask for: the opposite of what it shows.
    desiredFor: () => !drafted,
    write: async (playerId, next) => {
      writes?.push({ listId, playerId, drafted: next })
      if (fails) throw new Error(`refused by ${listId}`)
      return { list_id: listId, player_id: playerId, drafted: next, changed: true }
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('planFanOut — the set is the comparison ∩ the lists holding him (D12)', () => {
  it('takes every column that contains him, and only those', () => {
    const plan = planFanOut(
      [
        column('a'),
        column('b', { membership: 'out' }),
        column('c'),
        column('d', { membership: 'out' }),
      ],
      PLAYER,
    )
    expect(plan.targets).toEqual(['a', 'c'])
    expect(plan.pending).toEqual([])
    expect(plan.unreadable).toEqual([])
  })

  /**
   * D12 consequence 2, stated as the failure it prevents: a build that fanned
   * out to *all* columns would mark a player onto a list he is not on, which
   * LV.1.2's route answers with a 404 (`PLAYER_NOT_ON_LIST_MESSAGE`) — a
   * failure toast on every tick, for a mark nobody asked for.
   */
  it('a player in only some columns marks only those', () => {
    const plan = planFanOut([column('a'), column('b', { membership: 'out' })], PLAYER)
    expect(plan.targets).not.toContain('b')
  })

  it('keeps "cannot answer yet" apart from "cannot be read at all"', () => {
    const plan = planFanOut(
      [
        column('ready'),
        column('slow', { membership: 'loading' }),
        column('broken', { membership: 'unreadable' }),
      ],
      PLAYER,
    )
    expect(plan).toEqual({ targets: ['ready'], pending: ['slow'], unreadable: ['broken'] })
  })

  /**
   * A column whose rows have not arrived must not be read as "he is not on this
   * list". `memberIds` in `side-by-side-columns.tsx` is `null`, not an empty
   * Set, for this reason — CLAUDE.md's "never let 'nothing happened' mean 'it
   * worked'" applied to a membership test.
   */
  it('never silently treats an unloaded column as "he is not on it"', () => {
    const plan = planFanOut([column('slow', { membership: 'loading' })], PLAYER)
    expect(plan.targets).toEqual([])
    expect(plan.pending).toEqual(['slow'])
  })

  it('cannot name a list it was not given — the set has exactly one source', () => {
    const plan = planFanOut([column('a'), column('b')], PLAYER)
    expect([...plan.targets, ...plan.pending, ...plan.unreadable].sort()).toEqual(['a', 'b'])
  })

  it('keeps the caller’s order, which is the on-screen order', () => {
    expect(planFanOut([column('c'), column('a'), column('b')], PLAYER).targets).toEqual([
      'c',
      'a',
      'b',
    ])
  })
})

describe('runFanOut — one tick, every column that holds him, no further', () => {
  it('writes to each containing column, with the CLICKED column’s desired state', async () => {
    const writes: Array<{ listId: string; playerId: string; drafted: boolean }> = []
    const outcome = await runFanOut({
      columns: [
        column('a', { writes }),
        column('b', { writes }),
        column('c', { membership: 'out', writes }),
        column('d', { writes }),
      ],
      clickedListId: 'a',
      playerId: PLAYER,
      playerName: 'Malik Nabers',
    })

    expect(outcome?.drafted).toBe(true)
    expect(writes).toEqual([
      { listId: 'a', playerId: PLAYER, drafted: true },
      { listId: 'b', playerId: PLAYER, drafted: true },
      { listId: 'd', playerId: PLAYER, drafted: true },
    ])
    // Nothing landed on the column that does not hold him.
    expect(writes.map((write) => write.listId)).not.toContain('c')
    expect(outcome?.report).toBeNull()
  })

  /**
   * **The ruling, as a test.** The design package would have this reach every
   * list containing the player; Chris overrode it. A list that is not a column
   * is not reachable from here at all — it is not in `columns`, and there is no
   * other input.
   */
  it('a list outside the comparison is untouched, whatever it contains', async () => {
    const writes: Array<{ listId: string; playerId: string; drafted: boolean }> = []
    const outsideTheComparison = column('not-a-column', { writes })

    await runFanOut({
      columns: [column('a', { writes }), column('b', { writes })],
      clickedListId: 'a',
      playerId: PLAYER,
      playerName: 'Malik Nabers',
    })

    expect(writes.map((write) => write.listId)).toEqual(['a', 'b'])
    expect(outsideTheComparison.listId).toBe('not-a-column')
  })

  it('unticking is symmetric — same set, and it converges columns that disagreed', async () => {
    const writes: Array<{ listId: string; playerId: string; drafted: boolean }> = []
    const outcome = await runFanOut({
      // The clicked column shows him drafted; one of the others does not,
      // which is what an earlier partial failure leaves behind.
      columns: [
        column('clicked', { drafted: true, writes }),
        column('agrees', { drafted: true, writes }),
        column('disagrees', { drafted: false, writes }),
      ],
      clickedListId: 'clicked',
      playerId: PLAYER,
      playerName: 'Malik Nabers',
    })

    expect(outcome?.drafted).toBe(false)
    // All three are asked for the SAME state, so a repeat lands on the same
    // answer instead of inverting anyone (LV.1.2's explicit-state contract).
    expect(writes.every((write) => write.drafted === false)).toBe(true)
    expect(writes.map((write) => write.listId)).toEqual(['clicked', 'agrees', 'disagrees'])
  })

  it('returns null rather than guessing when the clicked column is not registered', async () => {
    expect(
      await runFanOut({
        columns: [column('a')],
        clickedListId: 'gone',
        playerId: PLAYER,
        playerName: 'Malik Nabers',
      }),
    ).toBeNull()
  })
})

describe('runFanOut — a partial failure is reported, never swallowed (D12.3)', () => {
  it('one refusal does not stop the other four, and is named', async () => {
    const writes: Array<{ listId: string; playerId: string; drafted: boolean }> = []
    const outcome = await runFanOut({
      columns: [
        column('a', { title: 'Big board', writes }),
        column('b', { title: 'WR room', fails: true, writes }),
        column('c', { title: 'Sleepers', writes }),
        column('d', { title: 'Dynasty', writes }),
        column('e', { title: 'Bench', writes }),
      ],
      clickedListId: 'a',
      playerId: PLAYER,
      playerName: 'Malik Nabers',
    })

    // `Promise.allSettled`, not `Promise.all`: the rejection must not cancel or
    // hide the four that worked.
    expect(writes).toHaveLength(5)
    expect(outcome?.failed).toEqual(['b'])
    expect(outcome?.report).toEqual({
      title: 'Not every column was updated',
      description:
        'Malik Nabers was marked in 4 of 5 columns. ' +
        'WR room could not be updated, so nothing changed there.',
      variant: 'destructive',
    })
  })

  it('names every failure, in screen order — not just the last one', async () => {
    const outcome = await runFanOut({
      columns: [
        column('a', { title: 'Big board' }),
        column('b', { title: 'WR room', fails: true }),
        column('c', { title: 'Sleepers', fails: true }),
        column('d', { title: 'Dynasty', fails: true }),
      ],
      clickedListId: 'a',
      playerId: PLAYER,
      playerName: 'Malik Nabers',
    })

    expect(outcome?.failed).toEqual(['b', 'c', 'd'])
    expect(outcome?.report?.description).toContain(
      'WR room, Sleepers and Dynasty could not be updated',
    )
  })

  it('total failure says so, instead of claiming a partial success', async () => {
    const outcome = await runFanOut({
      columns: [column('a', { title: 'Big board', fails: true })],
      clickedListId: 'a',
      playerId: PLAYER,
      playerName: 'Malik Nabers',
    })

    expect(outcome?.report?.title).toBe('Could not update Malik Nabers')
    expect(outcome?.report?.description).not.toContain('was marked in')
  })

  it('a column still loading is skipped AND said out loud', async () => {
    const writes: Array<{ listId: string; playerId: string; drafted: boolean }> = []
    const outcome = await runFanOut({
      columns: [
        column('a', { title: 'Big board', writes }),
        column('b', { title: 'WR room', membership: 'loading', writes }),
      ],
      clickedListId: 'a',
      playerId: PLAYER,
      playerName: 'Malik Nabers',
    })

    expect(writes.map((write) => write.listId)).toEqual(['a'])
    expect(outcome?.report?.description).toContain(
      'WR room has not loaded yet, so Malik Nabers was not checked there.',
    )
  })

  /**
   * The column renders *"This list could not be loaded"* for as long as it is on
   * screen, so the fact is already told — permanently, and where it happened. A
   * toast about it on every tick would fire for the rest of the draft.
   */
  it('a column that failed to LOAD is skipped silently — it already says so', async () => {
    const outcome = await runFanOut({
      columns: [column('a', { title: 'Big board' }), column('b', { membership: 'unreadable' })],
      clickedListId: 'a',
      playerId: PLAYER,
      playerName: 'Malik Nabers',
    })

    expect(outcome?.plan.unreadable).toEqual(['b'])
    expect(outcome?.report).toBeNull()
  })

  it('the everyday case is silent — the strike-through is the confirmation', async () => {
    const outcome = await runFanOut({
      columns: [column('a'), column('b'), column('c')],
      clickedListId: 'a',
      playerId: PLAYER,
      playerName: 'Malik Nabers',
    })
    expect(outcome?.report).toBeNull()
  })
})

describe('fanOutReport — the copy, because a partial outcome has to name names', () => {
  const base = {
    playerName: 'Malik Nabers',
    drafted: true,
    targets: ['Big board', 'WR room'],
    failed: [] as string[],
    pending: [] as string[],
  }

  it('says nothing when there is nothing to say', () => {
    expect(fanOutReport(base)).toBeNull()
  })

  it('counts what landed, so the user knows it was not all-or-nothing', () => {
    expect(fanOutReport({ ...base, failed: ['WR room'] })?.description).toContain(
      'was marked in 1 of 2 columns',
    )
  })

  it('carries the direction — an untick reads as cleared, not marked', () => {
    expect(
      fanOutReport({ ...base, drafted: false, failed: ['WR room'] })?.description,
    ).toContain('was cleared in 1 of 2 columns')
  })

  it('reports a failure and a skip in one gesture, because one gesture is one toast', () => {
    const report = fanOutReport({
      ...base,
      targets: ['Big board', 'WR room'],
      failed: ['WR room'],
      pending: ['Sleepers', 'Dynasty'],
    })
    expect(report?.description).toBe(
      'Malik Nabers was marked in 1 of 2 columns. ' +
        'WR room could not be updated, so nothing changed there. ' +
        'Sleepers and Dynasty have not loaded yet, so Malik Nabers was not checked there.',
    )
  })

  it('is a destructive toast — a silently-styled failure is a silent failure', () => {
    expect(fanOutReport({ ...base, failed: ['WR room'] })?.variant).toBe('destructive')
  })

  it('does not say "1 of 1 columns"', () => {
    expect(
      fanOutReport({ ...base, targets: ['Big board'], failed: [], pending: ['WR room'] })
        ?.description,
    ).toContain('was marked in 1 of 1 column.')
  })
})

describe('joinTitles — column names in a sentence', () => {
  it('reads as English at one, two and three', () => {
    expect(joinTitles(['a'])).toBe('a')
    expect(joinTitles(['a', 'b'])).toBe('a and b')
    expect(joinTitles(['a', 'b', 'c'])).toBe('a, b and c')
  })

  it('is empty for nothing, so a caller cannot build a sentence about no columns', () => {
    expect(joinTitles([])).toBe('')
  })
})

/**
 * **The claim this build cannot afford to take on trust.**
 *
 * "Each column has its own cache key, so a failed write can only roll its own
 * column back" is exactly the shape of reasoning R190, R195 and R199 each
 * defeated. So it is measured: five real cache entries in one real
 * `QueryClient`, five real `markMutationOptions` mutations, a real (stubbed)
 * wire that refuses exactly one of them, and the fan-out driving all five.
 */
describe('the rollback is per column — five caches, one refusal (D12.3, executed)', () => {
  const LISTS = ['l1', 'l2', 'l3', 'l4', 'l5']
  const REFUSED = 'l3'

  function stubWire() {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes(REFUSED)) {
        return new Response(JSON.stringify({ error: 'List not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({ list_id: url, player_id: PLAYER, drafted: true, changed: true }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    return calls
  }

  /** A column whose `write` is the production mutation, not a stand-in. */
  function realColumn(client: QueryClient, listId: string, reported: Error[]): FanOutColumn {
    return {
      listId,
      title: listId.toUpperCase(),
      membership: () => 'in',
      desiredFor: () => true,
      write: (playerId, drafted) =>
        new MutationObserver(
          client,
          markMutationOptions(client, listId, (error) => reported.push(error)),
        ).mutate({ playerId, drafted, notify: false }),
    }
  }

  it('the four that landed keep their mark; the refused one goes back exactly as it was', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const reported: Error[] = []
    const calls = stubWire()
    for (const listId of LISTS) client.setQueryData(draftedKeys.list(listId), ['already-gone'])

    const outcome = await runFanOut({
      columns: LISTS.map((listId) => realColumn(client, listId, reported)),
      clickedListId: 'l1',
      playerId: PLAYER,
      playerName: 'Malik Nabers',
    })

    // Five POSTs, one per list in the comparison — and not one more.
    expect(calls).toHaveLength(5)
    expect(calls).toEqual(LISTS.map((listId) => `/api/lists/${listId}/drafted`))

    for (const listId of LISTS) {
      expect(client.getQueryData(draftedKeys.list(listId)), listId).toEqual(
        listId === REFUSED ? ['already-gone'] : ['already-gone', PLAYER],
      )
    }

    expect(outcome?.failed).toEqual([REFUSED])
    expect(outcome?.report?.description).toContain('was marked in 4 of 5 columns')
    expect(outcome?.report?.description).toContain('L3 could not be updated')
    client.clear()
  })

  /**
   * `notify: false` buys the caller the *telling*, and nothing else. If it ever
   * short-circuited the handler, the refused column above would keep its
   * optimistic strike — the UI showing five struck when four landed, which is
   * the precise lie D12 forbids.
   */
  it('notify:false silences the per-column toast and NOT the rollback', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const reported: Error[] = []
    stubWire()
    client.setQueryData(draftedKeys.list(REFUSED), ['already-gone'])

    await runFanOut({
      columns: [realColumn(client, REFUSED, reported)],
      clickedListId: REFUSED,
      playerId: PLAYER,
      playerName: 'Malik Nabers',
    })

    expect(reported).toEqual([])
    expect(client.getQueryData(draftedKeys.list(REFUSED))).toEqual(['already-gone'])
    client.clear()
  })

  /** Counter-control: a write that is NOT part of a fan-out still says so itself. */
  it('a lone mark still reports its own failure', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const reported: Error[] = []
    stubWire()

    await new MutationObserver(
      client,
      markMutationOptions(client, REFUSED, (error) => reported.push(error)),
    )
      .mutate({ playerId: PLAYER, drafted: true })
      .catch(() => undefined)

    expect(reported.map((error) => error.message)).toEqual(['List not found'])
    client.clear()
  })

  /**
   * A column whose own drafted read never landed holds **no** cache entry, and
   * writing `[]` there on rollback would be a claim ("no marks") the read never
   * made. The entry is removed instead — which is also what drops the R200
   * landing flag it would otherwise vouch for.
   */
  it('a column with nothing cached is emptied, not left holding an invented answer', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    stubWire()

    await runFanOut({
      columns: [realColumn(client, REFUSED, [])],
      clickedListId: REFUSED,
      playerId: PLAYER,
      playerName: 'Malik Nabers',
    })

    expect(client.getQueryData(draftedKeys.list(REFUSED))).toBeUndefined()
    expect(client.getQueryCache().find({ queryKey: draftedKeys.list(REFUSED) })).toBeUndefined()
    client.clear()
  })
})

describe('LV.14 — the fan-out reaches the comparison and nothing else', () => {
  /**
   * The module must have exactly one source for "which lists". A helper that
   * asked the server which lists contain a player would answer wider than the
   * comparison, and D12's whole boundary would then rest on nobody calling it.
   */
  it('never fetches, and never asks anything for a list of lists', () => {
    const source = code(FAN_OUT)
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('useLists')
    expect(source).not.toContain('useQuery')
    expect(source).not.toContain('/api/')
  })

  /** `Promise.all` here would hide four outcomes behind the first rejection. */
  it('settles every write rather than racing them', () => {
    const source = code(FAN_OUT)
    expect(source).toContain('Promise.allSettled(')
    expect(source).not.toMatch(/Promise\.all\(/)
  })

  /**
   * **D12 consequence 5.** The single-list detail panel is unchanged: one tick,
   * one row, exactly as LV.1.3 shipped. Only the comparison fans out.
   */
  it('the detail panel never joins the fan-out', () => {
    const panel = code(PANEL)
    expect(panel).not.toContain('drafted-fan-out')
    expect(panel).not.toContain('FanOut')
    // …and it still marks the one way it always did.
    expect(panel).toContain('toggleDrafted')
  })

  /**
   * The module header, `side-by-side-columns.tsx`'s `notify: false` comment and
   * PROGRESS §4 all justify "one report per gesture" by citing this constant.
   * A cited fact that nothing checks is a fact that quietly stops being true —
   * and if the toaster ever stacks, the aggregate is a preference rather than
   * the only honest option, which is a different argument and should be made
   * again rather than inherited.
   */
  it('the toaster really does show one at a time — the reason there is one report', () => {
    expect(code('src/hooks/use-toast.ts')).toContain('const TOAST_LIMIT = 1')
  })

  it('the comment stripper keeps code and drops prose (control for the pins above)', () => {
    const source = code(FAN_OUT)
    expect(source).toContain('export function planFanOut')

    // No pin needs the stripper today — none of the strings the negative pins
    // forbid appears in this file's own prose (checked: `useLists`, `useQuery`,
    // `fetch(` and `/api/` are absent, and `Promise.all` appears only without
    // the `(` the pin matches). This control keeps the stripper working for the
    // header that eventually will use one: the moment the prose explains a
    // phrase a pin forbids, a broken stripper turns that pin red for the
    // *comment*, and the obvious "fix" is to weaken the pin. Both halves are
    // asserted, so this control cannot itself pass for the wrong reason.
    for (const phrase of ['The comparison set *is* the draft', 'No new table', 'useDraftMode']) {
      expect(read(FAN_OUT), phrase).toContain(phrase)
      expect(source, phrase).not.toContain(phrase)
    }
  })
})
