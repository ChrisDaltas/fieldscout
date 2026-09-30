/**
 * use-commish-log-receipt-hooks.test.ts — M6 L.E1.33, PROGRESS F535(d): the
 * hooks whose writes leave a §10.3 receipt since 168 / 169 but did not re-read
 * the audit log — the draft-room controls, draft create / order / start,
 * membership, invites, settings / status / profile / scoring, and
 * `set_lineup` (its commissioner arm writes `edit_lineup`, 169) — now
 * invalidate `commishLogKeys.all`, which reaches League Home's commissioner
 * section AND the console's "needs you" read (`commishSummaryKeys.one`, under
 * the same root). ONE CELL PER HOOK, each driving the hook's REAL options
 * through a real `QueryClient` + `MutationObserver`.
 *
 * How the options are reached without React: `useQueryClient` answers the
 * test's client and `useMutation` hands back the options it was given (the
 * rest of React Query is the real module). So the cell runs exactly the
 * `onSuccess` / `onSettled` the hook wires — not a copy of it.
 *
 * Which answers re-read: hooks that settle on BOTH answers (the draft
 * controls' `onSettled`, `set_lineup`'s R822(i) pair) are pinned on both; the
 * rest re-read on success, where a receipt can exist (a refused write rolls
 * back and leaves none — the scoring family's own "a refused save
 * invalidates nothing" posture, `use-league-scoring-invalidation.test.ts`).
 * Another league's keys are the negative control in every cell.
 *
 * Not here, measured: `useRenameOwnTeam` — `rename_own_team` writes no
 * receipt (128's `audited: false`; 170's census: it refuses a commissioner
 * on another team, whose rename is `useCommishRenameTeam`, already pinned);
 * `useToggleAutodraft` / `useMakePick` / `useLeaveLeague` — a manager's own
 * act, no receipt (170's allowlist); `useDeleteLeague` — the league is gone,
 * there is no log left to show.
 */
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

let currentClient: QueryClient | null = null
let captured: unknown[] = []
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...orig,
    useQueryClient: () => currentClient,
    useMutation: (options: unknown) => {
      captured.push(options)
      return options
    },
  }
})

import { commishLogKeys } from './use-commish-log'
import { commishSummaryKeys } from './use-commish-summary'
import { useCreateDraft, useDraftOrder, useStartDraft } from './use-draft'
import {
  useAdjustBudget,
  useCancelNomination,
  useEndDraft,
  useForcePick,
  useMovePlayer,
  usePauseResumeDraft,
  useReassignPick,
  useResetDraft,
  useReverseWonBid,
  useSetDraftClock,
  useSetMemberAutodraft,
  useUndoDraft,
} from './use-draft-controls'
import {
  useForkScoringTemplate,
  useLeagueProfile,
  useSetLeagueStatus,
  useUpdateLeagueScoring,
  useUpdateLeagueSettings,
} from './use-league'
import { useCreateInvite, useRevokeInvite, useRotateInviteCode, useSetInviteSlug } from './use-league-invites'
import { useAddPlaceholderSeat, useAssignManager, useRemoveManager, useSetMemberRole } from './use-league-members'
import { useSetLineup } from './use-lineup'

const LEAGUE = 'c3310000-0000-4000-8000-000000000301'
const OTHER_LEAGUE = 'c3310000-0000-4000-8000-000000000302'
const DRAFT = 'c3310000-0000-4000-8000-000000000401'
const TEAM = 'c3310000-0000-4000-8000-000000000501'
const MEMBER = 'c3310000-0000-4000-8000-000000000601'
const ACTION = 'c3310000-0000-4000-8000-000000000701'

function stubFetch(ok: boolean) {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok,
      status: ok ? 200 : 409,
      json: () => Promise.resolve(ok ? { action_id: ACTION, draft: { id: DRAFT }, scoring_system_id: 's1' } : { error: 'refused by name' }),
    } as unknown as Response),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  currentClient = null
  captured = []
})

function seededClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  for (const league of [LEAGUE, OTHER_LEAGUE]) {
    client.setQueryData(commishLogKeys.list(league, { limit: 8 }), { pages: [], pageParams: [] })
    client.setQueryData(commishSummaryKeys.one(league), { seeded: true })
  }
  return client
}

const invalidated = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated

type Cell = {
  name: string
  /** Calls the hook; returns which captured `useMutation` options to drive. */
  useMount: () => void
  pick?: number
  variables: unknown
  /** Re-reads on a refusal too (onSettled / R822(i)). */
  both: boolean
}

const CELLS: Cell[] = [
  // Draft-room controls (168) — one `useControlMutation`, eleven hooks, each pinned.
  { name: 'usePauseResumeDraft', useMount: () => usePauseResumeDraft(LEAGUE, DRAFT), variables: { action: 'pause' }, both: true },
  { name: 'useSetDraftClock', useMount: () => useSetDraftClock(LEAGUE, DRAFT), variables: { pickTimerSeconds: 90, extendCurrent: false }, both: true },
  { name: 'useUndoDraft', useMount: () => useUndoDraft(LEAGUE, DRAFT), variables: { toPickNumber: null }, both: true },
  { name: 'useReassignPick', useMount: () => useReassignPick(LEAGUE, DRAFT), variables: { pickId: 'p1', teamId: TEAM }, both: true },
  { name: 'useForcePick', useMount: () => useForcePick(LEAGUE, DRAFT), variables: { playerId: 'pl1', actionId: ACTION }, both: true },
  { name: 'useMovePlayer', useMount: () => useMovePlayer(LEAGUE, DRAFT), variables: { playerId: 'pl1', fromTeam: TEAM, toTeam: 'other' }, both: true },
  { name: 'useResetDraft', useMount: () => useResetDraft(LEAGUE, DRAFT), variables: {}, both: true },
  { name: 'useReverseWonBid', useMount: () => useReverseWonBid(LEAGUE, DRAFT), variables: { pickId: 'p1', reason: 'x' }, both: true },
  { name: 'useAdjustBudget', useMount: () => useAdjustBudget(LEAGUE, DRAFT), variables: { teamId: TEAM, delta: 5, actionId: ACTION, reason: 'x' }, both: true },
  { name: 'useCancelNomination', useMount: () => useCancelNomination(LEAGUE, DRAFT), variables: { reason: 'x' }, both: true },
  { name: 'useEndDraft', useMount: () => useEndDraft(LEAGUE, DRAFT), variables: { reason: 'x' }, both: true },
  { name: 'useSetMemberAutodraft', useMount: () => useSetMemberAutodraft(LEAGUE), variables: { memberId: MEMBER, on: true }, both: true },
  // Draft create / order / start (168).
  { name: 'useCreateDraft', useMount: () => useCreateDraft(LEAGUE), variables: undefined, both: false },
  { name: 'useDraftOrder', useMount: () => useDraftOrder(LEAGUE), variables: { draft_id: DRAFT, randomize: true }, both: false },
  { name: 'useStartDraft', useMount: () => useStartDraft(LEAGUE), variables: undefined, both: false },
  // Membership (169).
  { name: 'useAddPlaceholderSeat', useMount: () => useAddPlaceholderSeat(LEAGUE), variables: 'Seat 9', both: false },
  { name: 'useSetMemberRole', useMount: () => useSetMemberRole(LEAGUE), variables: { memberId: MEMBER, role: 'co_commissioner' }, both: false },
  { name: 'useAssignManager', useMount: () => useAssignManager(LEAGUE), variables: { teamId: TEAM, userId: 'u1' }, both: false },
  { name: 'useRemoveManager', useMount: () => useRemoveManager(LEAGUE), variables: { memberId: MEMBER, mode: 'vacate' }, both: false },
  // Invites (169).
  { name: 'useCreateInvite', useMount: () => useCreateInvite(LEAGUE), variables: { target_team_id: TEAM }, both: false },
  { name: 'useRevokeInvite', useMount: () => useRevokeInvite(LEAGUE), variables: 'inv1', both: false },
  { name: 'useRotateInviteCode', useMount: () => useRotateInviteCode(LEAGUE), variables: undefined, both: false },
  { name: 'useSetInviteSlug', useMount: () => useSetInviteSlug(LEAGUE), variables: 'my-league', both: false },
  // League setup (169).
  { name: 'useUpdateLeagueSettings', useMount: () => useUpdateLeagueSettings(LEAGUE), variables: { scoring_system_id: 's1' }, both: false },
  { name: 'useSetLeagueStatus', useMount: () => useSetLeagueStatus(LEAGUE), variables: 'scheduled', both: false },
  { name: 'useLeagueProfile.rename', useMount: () => useLeagueProfile(LEAGUE), pick: 0, variables: 'New Name', both: false },
  { name: 'useLeagueProfile.uploadAvatar', useMount: () => useLeagueProfile(LEAGUE), pick: 1, variables: new File(['x'], 'crest.png'), both: false },
  { name: 'useLeagueProfile.removeAvatar', useMount: () => useLeagueProfile(LEAGUE), pick: 2, variables: undefined, both: false },
  { name: 'useForkScoringTemplate', useMount: () => useForkScoringTemplate(LEAGUE), variables: 'tpl1', both: false },
  { name: 'useUpdateLeagueScoring', useMount: () => useUpdateLeagueScoring(LEAGUE), variables: {}, both: false },
  // set_lineup — its commissioner arm writes `edit_lineup` (169).
  { name: 'useSetLineup', useMount: () => useSetLineup(LEAGUE, TEAM), variables: { week: 3, slot_map: {}, action_id: ACTION }, both: true },
]

async function drive(cell: Cell, ok: boolean): Promise<QueryClient> {
  const client = seededClient()
  currentClient = client
  captured = []
  stubFetch(ok)
  cell.useMount()
  const options = captured[cell.pick ?? captured.length - 1]
  expect(options, `${cell.name}: the hook built its mutation`).toBeTruthy()
  const observer = new MutationObserver(client, options as never)
  await observer.mutate(cell.variables as never).catch(() => undefined)
  return client
}

describe('F535(d) — every receipt-writing hook re-reads the audit log’s root (the log + the console’s "needs you")', () => {
  for (const cell of CELLS) {
    it(`${cell.name}: a landed write re-reads this league’s log and summary — never another league’s`, async () => {
      const client = await drive(cell, true)
      expect(invalidated(client, commishLogKeys.list(LEAGUE, { limit: 8 })), `${cell.name} log`).toBe(true)
      expect(invalidated(client, commishSummaryKeys.one(LEAGUE)), `${cell.name} summary`).toBe(true)
      expect(invalidated(client, commishLogKeys.list(OTHER_LEAGUE, { limit: 8 })), `${cell.name} other league`).toBe(false)
      expect(invalidated(client, commishSummaryKeys.one(OTHER_LEAGUE)), `${cell.name} other summary`).toBe(false)
    })
    if (cell.both) {
      it(`${cell.name}: a refusal re-reads them too (it settles on both answers)`, async () => {
        const client = await drive(cell, false)
        expect(invalidated(client, commishLogKeys.list(LEAGUE, { limit: 8 })), `${cell.name} log`).toBe(true)
        expect(invalidated(client, commishSummaryKeys.one(LEAGUE)), `${cell.name} summary`).toBe(true)
        expect(invalidated(client, commishLogKeys.list(OTHER_LEAGUE, { limit: 8 })), `${cell.name} other league`).toBe(false)
      })
    }
  }
})
