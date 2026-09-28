'use client'

import { useQuery } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { WaiverClaimsDocument } from '@/lib/leagues/api/waivers-service'

/**
 * A team's waiver claims — M5 task L.D2.12 (spec §15.3 `GET …/waivers`,
 * §15.6 `use-waivers`; tasks-M5 §5 `useWaiverClaims`).
 *
 * READ over the route, never the table directly: the route asserts
 * membership first (a non-member is a 403, never an empty list) and refuses
 * another team's claims by name for anyone but the commissioner — bids are
 * blind (E13), and an RLS-empty read must not render as "no claims".
 *
 * `waiver_claims` is NEVER broadcast (§12.14 / TD3), so there is no channel
 * subscription here: the claim mutations re-read this key, and the owner's
 * notification carries the run's outcome.
 *
 * `waiverClaimKeys.all(leagueId)` is THE invalidation target for every claim
 * verb and for `useCommishFaab` (a balance edit changes the bid ceiling and
 * `pending_bids_above_balance`).
 */
export const waiverClaimKeys = {
  all: (leagueId: string) => ['waiver-claims', leagueId] as const,
  /** `teamId` null = "my team" (the route's default). */
  team: (leagueId: string, teamId: string | null, status: 'pending' | 'all') =>
    ['waiver-claims', leagueId, teamId ?? 'mine', status] as const,
}

export interface UseWaiverClaimsOptions {
  /** Another team's claims — the commissioner's only (the route 403s others). */
  teamId?: string | null
  /** `pending` (default) or `all` (settled ones too, with `result_reason`). */
  status?: 'pending' | 'all'
}

export function waiverClaimsUrl(leagueId: string, options: UseWaiverClaimsOptions = {}): string {
  const params = new URLSearchParams()
  if (options.status && options.status !== 'pending') params.set('status', options.status)
  if (options.teamId) params.set('team_id', options.teamId)
  const qs = params.toString()
  return `/api/leagues/${leagueId}/waivers${qs ? `?${qs}` : ''}`
}

export function useWaiverClaims(leagueId: string | undefined, options: UseWaiverClaimsOptions = {}) {
  const status = options.status ?? 'pending'
  return useQuery({
    queryKey: waiverClaimKeys.team(leagueId ?? 'none', options.teamId ?? null, status),
    enabled: Boolean(leagueId),
    queryFn: () => sendLeagueAction<WaiverClaimsDocument>(waiverClaimsUrl(leagueId!, { ...options, status })),
  })
}
