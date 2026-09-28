'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import {
  runWaiverClaimEdit,
  type WaiverClaimEditChange,
  type WaiverClaimEditIds,
  type WaiverClaimEditOriginal,
  type WaiverClaimEditResult,
  type WaiverClaimEditSteps,
} from '@/lib/leagues/api/waiver-claim-edit'
import type { CancelClaimResult, ReorderClaimsResult, SubmitClaimResult } from '@/lib/leagues/api/waivers-service'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { waiverClaimKeys } from './use-waiver-claims'

/**
 * Edit a pending claim's bid and/or drop in ONE gesture — M5 task L.D2.12,
 * PROGRESS D383(2) ("L.D2.12/13 should offer an atomic edit").
 *
 * Cancel + resubmit + move-back over the three claim routes, sequenced by
 * `runWaiverClaimEdit` (read its header for the one non-atomic gap and how it
 * is made loud; the one-transaction verb is F417). NOT optimistic, NOT
 * retried; the five step ids are minted ONCE per `edit()` so nothing is ever
 * sent twice under different ids. Re-reads the claims on both answers, and the
 * activity feed + audit log too (a commissioner's edit writes receipts; a
 * manager's re-read is harmless).
 */

export interface EditClaimVariables {
  original: WaiverClaimEditOriginal
  change: WaiverClaimEditChange
  ids: WaiverClaimEditIds
}

export function waiverClaimEditSteps(leagueId: string): WaiverClaimEditSteps {
  const base = `/api/leagues/${leagueId}/waivers`
  return {
    cancel: (claimId, body) => sendLeagueAction<CancelClaimResult>(`${base}/${claimId}`, jsonInit('DELETE', body)),
    submit: (body) => sendLeagueAction<SubmitClaimResult>(base, jsonInit('POST', body)),
    reorder: (claimId, body) => sendLeagueAction<ReorderClaimsResult>(`${base}/${claimId}`, jsonInit('PATCH', body)),
  }
}

export function editClaimMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
  steps: WaiverClaimEditSteps = waiverClaimEditSteps(leagueId),
): UseMutationOptions<WaiverClaimEditResult, Error, EditClaimVariables> {
  const reread = () => {
    void queryClient.invalidateQueries({ queryKey: waiverClaimKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: commishLogKeys.all(leagueId) })
  }
  return {
    retry: false,
    mutationFn: ({ original, change, ids }) => runWaiverClaimEdit(steps, original, change, ids),
    onSuccess: () => reread(),
    onError: () => reread(),
  }
}

export function useEditClaim(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(editClaimMutationOptions(queryClient, leagueId))
  const variables = (original: WaiverClaimEditOriginal, change: WaiverClaimEditChange): EditClaimVariables => ({
    original,
    change,
    ids: {
      cancel: crypto.randomUUID(),
      submit: crypto.randomUUID(),
      reorder: crypto.randomUUID(),
      restore: crypto.randomUUID(),
      restoreReorder: crypto.randomUUID(),
    },
  })
  return {
    ...mutation,
    edit: (original: WaiverClaimEditOriginal, change: WaiverClaimEditChange) => mutation.mutate(variables(original, change)),
    editAsync: (original: WaiverClaimEditOriginal, change: WaiverClaimEditChange) => mutation.mutateAsync(variables(original, change)),
  }
}
