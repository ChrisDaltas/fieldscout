'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'

export const leaguesKeys = {
  all: ['leagues'] as const,
  detail: (leagueId: string) => ['leagues', leagueId] as const,
}

/** One row of GET /api/leagues (my leagues via league_members — §15.1). */
export interface MyLeagueRow {
  id: string
  name: string
  season: number
  status: string
  team_count: number
  created_at: string | null
  my_role: string
  my_team_id: string | null
}

/** Caller-facing create input; `action_id` is stamped by `createLeague` below. */
export interface CreateLeagueInput {
  name: string
  season: number
  scoring_system_id: string
  team_name?: string
  settings: LeagueSettings
}

export interface CreateLeagueResult {
  league_id: string
  team_id: string
  invite_code: string
  replayed: boolean
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  if (!response.ok) {
    const message =
      typeof body?.error === 'string' ? body.error : JSON.stringify(body?.error ?? 'Request failed')
    throw new Error(message)
  }
  return body as T
}

/**
 * My leagues (GET /api/leagues) — M1 task L.A1.12.
 *
 * `enabled` lets an app-wide caller (the sidebar nav) skip the fetch when the
 * leagues release is gated off, so /api/leagues isn't hit on every page load
 * where the feature is hidden. Defaults to on for the existing callers.
 */
export function useLeagues(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: leaguesKeys.all,
    queryFn: async (): Promise<MyLeagueRow[]> => {
      const response = await fetch('/api/leagues')
      const body = await parseJsonOrThrow<{ leagues: MyLeagueRow[] }>(response)
      return body.leagues
    },
    enabled: options?.enabled ?? true,
  })
}

/**
 * Create a league (POST /api/leagues — free, no Pro gate; Q6/v2.8).
 *
 * Idempotency (D68): `createLeague` stamps ONE `action_id` per call — the
 * mutation variables (including that id) are what React Query re-submits on
 * retry, so a retried submit REPLAYS server-side instead of creating a
 * second league. Callers use the returned `createLeague`/`createLeagueAsync`
 * wrappers, not `mutate` directly.
 */
export function useCreateLeague() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (variables: CreateLeagueInput & { action_id: string }) => {
      const response = await fetch('/api/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables),
      })
      return parseJsonOrThrow<CreateLeagueResult>(response)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.all })
    },
  })

  return {
    ...mutation,
    createLeague: (input: CreateLeagueInput) =>
      mutation.mutate({ ...input, action_id: crypto.randomUUID() }),
    createLeagueAsync: (input: CreateLeagueInput) =>
      mutation.mutateAsync({ ...input, action_id: crypto.randomUUID() }),
  }
}
