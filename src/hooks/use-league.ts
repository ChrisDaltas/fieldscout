'use client'

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { ScoringRulesDoc } from '@/lib/leagues/scoring/rules-doc'
import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'

// SE.6: the scoring query key comes from the READER's own module (see
// `leagueScoringInvalidationKeys`) — one factory, so the key a mutation
// invalidates is by construction the key the query is stored under.
import { auctionPoolKeys } from './use-draft-pool'
import { leaguesKeys } from './use-leagues'

/**
 * A structured PATCH failure the settings panel can branch on: `status` picks
 * the 403 (not commissioner) / 404 / 409 (structural lock past scheduled) /
 * 400 (validation) treatments, and `fieldErrors` (when present) map the
 * contract's per-field messages to their inputs. Anything else is `message`.
 */
export class LeaguePatchError extends Error {
  status: number
  fieldErrors?: Record<string, string[]>
  constructor(status: number, message: string, fieldErrors?: Record<string, string[]>) {
    super(message)
    this.name = 'LeaguePatchError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

/** GET /api/leagues/[id] response shape (§15.1 detail — L.A1.12). */
export interface LeagueDetail {
  league: {
    id: string
    name: string
    avatar_url: string | null
    description: string | null
    season: number
    status: string
    owner_id: string
    scoring_system_id: string | null
    invite_code: string | null
    invite_slug: string | null
    max_teams: number
    created_at: string | null
    updated_at: string | null
  }
  settings: LeagueSettings
  members: Array<{
    id: string
    user_id: string | null
    team_id: string | null
    role: string
    is_placeholder: boolean | null
    is_autodraft: boolean | null
    joined_at: string | null
    profiles: { username: string; avatar_url: string | null } | null
  }>
  teams: Array<{
    id: string
    name: string
    owner_id: string
    status: string
    created_at: string | null
  }>
  my_role: string | null
  /** L.B2.1: the active NON-MOCK draft summary (≤ 1 — the D95 partial
   *  unique), or null. `scheduled_at` is settings.draft.draft_scheduled_at
   *  (D95's single pre-start store). `useActiveDraft` rides this field. */
  active_draft: {
    id: string
    status: 'scheduled' | 'live' | 'paused'
    draft_type: string
    started_at: string | null
    scheduled_at: string | null
  } | null
}

/** League detail (GET /api/leagues/[id]) — M1 task L.A1.12. */
export function useLeague(leagueId: string | undefined) {
  return useQuery({
    queryKey: leaguesKeys.detail(leagueId ?? 'none'),
    enabled: Boolean(leagueId),
    queryFn: async (): Promise<LeagueDetail> => {
      const response = await fetch(`/api/leagues/${leagueId}`)
      const body = (await response.json().catch(() => null)) as
        | LeagueDetail
        | { error?: unknown }
        | null
      if (!response.ok) {
        const error = body && 'error' in body ? body.error : undefined
        throw new Error(typeof error === 'string' ? error : 'Failed to load league')
      }
      return body as LeagueDetail
    },
  })
}

/** Body for a settings/scoring PATCH (§15.1; L.A1.13 wire shape). The panel
 *  sends the FULL reconciled settings (cross-field re-clamps span groups, so a
 *  whole-object save keeps the merged result internally consistent — a full
 *  object merges to itself, D71) plus `scoring_system_id` only when it changed. */
export interface UpdateLeagueSettingsBody {
  settings?: LeagueSettings
  scoring_system_id?: string
}

/**
 * Update a league's settings / scoring template (PATCH /api/leagues/[id] —
 * commish only; the route calls `update_league_settings` per Q8/v2.8.2 via
 * `patchLeague`). On failure it throws a `LeaguePatchError` carrying the
 * status + any per-field messages so the settings panel (L.A2.4) can render
 * the 403 / 409-lock / per-field states from §16.5.4. Success invalidates the
 * detail query so the panel reloads the persisted baseline (round-trip).
 */
export function useUpdateLeagueSettings(leagueId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (body: UpdateLeagueSettingsBody) => {
      const response = await fetch(`/api/leagues/${leagueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const parsed = (await response.json().catch(() => null)) as { error?: unknown } | null
      if (!response.ok) {
        const error = parsed?.error
        // The contract's per-field 400s arrive as { error: { fieldErrors } }.
        const fieldErrors =
          error && typeof error === 'object' && 'fieldErrors' in error
            ? ((error as { fieldErrors: Record<string, string[]> }).fieldErrors)
            : undefined
        const message =
          typeof error === 'string'
            ? error
            : fieldErrors
              ? 'Some settings need attention.'
              : 'Failed to save settings.'
        throw new LeaguePatchError(response.status, message, fieldErrors)
      }
      return parsed as { ok: true }
    },
    // R666 — **this verb WRITES THE LEAGUE'S SCORING DOCUMENT**, so it owes the
    // scoring invalidation exactly as SE.6's two verbs do: the panel's body
    // carries `scoring_system_id` whenever the commissioner re-picks a template
    // (`settings-panel.tsx`), and `update_league_settings` repoints the league
    // at it. The two keys are DISJOINT (`['leagues', id]` vs
    // `['league-scoring-family', id]`), so React Query's prefix matching does
    // not cover one with the other — this was the writer SE.6's first cut
    // missed while its docblock addressed "any future writer".
    onSuccess: () => invalidateLeagueScoring(queryClient, leagueId),
  })
}

/**
 * The §7.1 setup ↔ scheduled lifecycle flip (PATCH /api/leagues/[id] with
 * `status` as the only key — the L.A1.13 route → `set_league_status`; commish
 * only). L.B3.4 gives the transition its first UI affordance: "Schedule the
 * draft" on the setup hero moves the league to `scheduled` once a draft time
 * is saved — which is what arms the D94 auto-start (the tick scans
 * `scheduled` leagues only) and reveals the countdown hero + lobby CTAs.
 * The route validates the CURRENT stored settings before the `scheduled`
 * transition; its per-field 400 surfaces through `LeaguePatchError` exactly
 * like a settings save.
 */
export function useSetLeagueStatus(leagueId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (status: 'setup' | 'scheduled') => {
      const response = await fetch(`/api/leagues/${leagueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const parsed = (await response.json().catch(() => null)) as { error?: unknown } | null
      if (!response.ok) {
        const error = parsed?.error
        const fieldErrors =
          error && typeof error === 'object' && 'fieldErrors' in error
            ? ((error as { fieldErrors: Record<string, string[]> }).fieldErrors)
            : undefined
        const message =
          typeof error === 'string'
            ? error
            : fieldErrors
              ? 'Some settings need attention before scheduling.'
              : 'Failed to update the league status.'
        throw new LeaguePatchError(response.status, message, fieldErrors)
      }
      return parsed as { ok: true }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.all })
    },
  })
}

/**
 * Soft-delete a league (DELETE /api/leagues/[id] — commish only; the route
 * calls the `soft_delete_league` RPC per Q8/v2.8.2). Retry-safe: the RPC is
 * an idempotent no-op on an already-deleted league.
 */
export function useDeleteLeague() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (leagueId: string) => {
      const response = await fetch(`/api/leagues/${leagueId}`, { method: 'DELETE' })
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null
      if (!response.ok) {
        throw new Error(
          typeof body?.error === 'string' ? body.error : 'Failed to delete league',
        )
      }
      return { leagueId }
    },
    onSuccess: ({ leagueId }) => {
      queryClient.removeQueries({ queryKey: leaguesKeys.detail(leagueId) })
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.all })
    },
  })
}

/**
 * League profile — rename + avatar (PATCH/POST/DELETE /api/leagues/[id]/
 * profile; migration 064's update_league_profile RPC, commissioner-only).
 * Cosmetic writes, allowed in every league status (unlike the §7.1
 * structural lock). Success invalidates both the detail and the leagues
 * list, so the sidebar tile and every crest refresh together.
 */
export function useLeagueProfile(leagueId: string) {
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.all })
  }

  const throwOnError = async (response: Response) => {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null
    if (!response.ok) {
      throw new Error(
        typeof body?.error === 'string' ? body.error : 'Failed to update the league profile',
      )
    }
    return body
  }

  const rename = useMutation({
    mutationFn: async (name: string) => {
      const response = await fetch(`/api/leagues/${leagueId}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      return throwOnError(response)
    },
    onSuccess: invalidate,
  })

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch(`/api/leagues/${leagueId}/profile`, {
        method: 'POST',
        body: form,
      })
      return throwOnError(response)
    },
    onSuccess: invalidate,
  })

  const removeAvatar = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/leagues/${leagueId}/profile`, {
        method: 'DELETE',
      })
      return throwOnError(response)
    },
    onSuccess: invalidate,
  })

  return { rename, uploadAvatar, removeAvatar }
}

// ---------------------------------------------------------------------------
// Custom scoring — SE.6 (spec §7.3.3.1; routes §15.1 via this task's erratum)
// ---------------------------------------------------------------------------

/**
 * **THE READ IS NOT HERE, AND THAT IS THE DISPOSITION.**
 *
 * SE.6's original item 2 planned a `use-league-scoring.ts` hook that would
 * read a league's scoring document. `useLeagueScoringFamily`
 * (`src/hooks/use-draft-pool.ts`) already does exactly that — snapshot first,
 * `scoring_systems.rules` by id as the fallback — so a second reader would be
 * the near-duplicate CLAUDE.md forbids, and the answer is **WRAP/EXTEND, not
 * COEXIST**: SE.6 writes **no** reader, `useLeagueScoringFamily` stays the one
 * hook that reads a league's scoring document, and its raw `data` (the
 * document itself, not only the derived family) is what SE.7's editor consumes.
 * Measured at build time: `grep -rn "useLeagueScoringFamily" src/` → its
 * definition plus `auction-player-table.tsx`, and no other hook selects
 * `scoring_rules_snapshot` or `scoring_systems.rules` for a league.
 *
 * What SE.6 adds beside it is the two MUTATIONS, and the invalidation they owe.
 */

/**
 * Every query key a write of the league's scoring document invalidates — one
 * list, every writer, so they cannot disagree.
 *
 * **THE WRITER SET IS ENUMERATED, not gestured at** (R666 — an earlier form of
 * this docblock said *"any future writer of this document owes the same
 * invalidation"* while an EXISTING writer was missed). Measured across the
 * service layer: `scoring_fork_template` and `scoring_update_rules` (SE.6's
 * two verbs, below), `update_league_settings` via `useUpdateLeagueSettings`
 * (`leagues-service.ts` passes `p_scoring_system_id`), and `create_league` —
 * which mints the league, so it can have no stale prior entry. The first three
 * route their `onSuccess` through `invalidateLeagueScoring`; the fourth needs
 * nothing. Adding a fifth writer means adding it here.
 *
 * **What the shared factory does and does not guarantee** (R669). It fixes the
 * key's SHAPE — `auctionPoolKeys.scoring` is imported from the reader's own
 * module rather than re-spelled — so a rename or a re-shaping moves both sides
 * together. It does NOT fix the key's ARGUMENT: the reader registers under
 * `auctionPoolKeys.scoring(leagueId ?? scoringSystemId ?? 'none')` and this
 * invalidates `auctionPoolKeys.scoring(leagueId)`, so the two agree only while
 * the reader prefers `leagueId`. That preference is load-bearing in a league
 * room, where both ids are supplied, and it is pinned by argument and not only
 * by name in `use-league-scoring-invalidation.test.ts`.
 *
 * **Why it matters.** Before SE.6, `grep -rn "auctionPoolKeys.scoring|
 * league-scoring-family" src/` returned exactly two hits — the definition and
 * the one use — i.e. **nothing invalidated it**. A write that does not
 * invalidate leaves a surface serving the PRE-EDIT document with no error and
 * no empty state: CLAUDE.md's *"never let 'nothing happened' mean 'it worked'"*
 * shape. `leaguesKeys.detail` rides along because a fork REPOINTS
 * `leagues.scoring_system_id`, which the detail query carries.
 *
 * **The window, measured rather than quoted** (a review correction — earlier
 * drafts of this block said "up to ten minutes", which was wrong in BOTH
 * directions). `query-provider.tsx` sets `refetchOnWindowFocus: false` and no
 * `gcTime`. So: for a surface that stays MOUNTED there is no automatic refetch
 * trigger at all — no focus refetch, no interval — and `staleTime`'s ten
 * minutes is therefore not an upper bound; the pre-edit document is served
 * until the next mount or reconnect. For a surface that is CLOSED, React
 * Query's browser default `gcTime` of 5 minutes
 * (`query-core/build/modern/removable.js`: `newGcTime ?? (isServer ? Infinity
 * : 5 * 60 * 1e3)`) evicts the entry, so a later mount refetches regardless.
 * Ten minutes overstated the closed case and understated the open one.
 *
 * Scope, stated rather than implied: a React Query cache is per client, so
 * this reaches the surfaces of the app instance that made the edit. Another
 * member's already-open room is a different cache and is not something an
 * invalidation can reach — ledger F167. It is also not reachable on a REAL
 * draft in progress: both RPCs refuse outside `setup`/`scheduled` (§7.3
 * header), and a started draft reads the frozen snapshot.
 */
export function leagueScoringInvalidationKeys(leagueId: string) {
  return [leaguesKeys.detail(leagueId), auctionPoolKeys.scoring(leagueId)] as const
}

function invalidateLeagueScoring(queryClient: QueryClient, leagueId: string) {
  for (const queryKey of leagueScoringInvalidationKeys(leagueId)) {
    void queryClient.invalidateQueries({ queryKey })
  }
}

/** The two scoring routes' shared failure translation: the service answers
 *  403 / 404 / 409 / 400-with-fieldErrors, and the panel branches on exactly
 *  that (`LeaguePatchError`). */
async function scoringRequest(
  url: string,
  method: 'POST' | 'PUT',
  body: unknown,
  fallbackMessage: string,
): Promise<{ scoring_system_id: string }> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const parsed = (await response.json().catch(() => null)) as
    | { scoring_system_id?: string; error?: unknown }
    | null
  if (!response.ok) {
    const error = parsed?.error
    const fieldErrors =
      error && typeof error === 'object' && 'fieldErrors' in error
        ? (error as { fieldErrors: Record<string, string[]> }).fieldErrors
        : undefined
    const message =
      typeof error === 'string'
        ? error
        : fieldErrors
          ? 'Some scoring values need attention.'
          : fallbackMessage
    throw new LeaguePatchError(response.status, message, fieldErrors)
  }
  return parsed as { scoring_system_id: string }
}

/**
 * The mutation OPTIONS, exported separately from the hook so the invalidation
 * can be driven by a real `QueryClient` with no DOM (the
 * `use-draft-feed-sink.test.ts` posture). A pin that only read the source text
 * would go green the moment the call moved somewhere that never runs.
 */
export function forkScoringTemplateMutationOptions(queryClient: QueryClient, leagueId: string) {
  return {
    mutationFn: (templateId: string) =>
      scoringRequest(
        `/api/leagues/${leagueId}/scoring/fork`,
        'POST',
        { template_id: templateId },
        'Failed to customize scoring.',
      ),
    // onSuccess, never onSettled: a REFUSED fork changed nothing, and
    // invalidating on failure would refetch the document the room already
    // holds — noise that looks like a fix and hides the next real staleness.
    onSuccess: () => invalidateLeagueScoring(queryClient, leagueId),
  }
}

/**
 * POST /api/leagues/[id]/scoring/fork — "Customize" (§7.3.3.1 entry point).
 * Takes the template id; resolves to the league's new custom scoring row id.
 */
export function useForkScoringTemplate(leagueId: string) {
  const queryClient = useQueryClient()
  return useMutation(forkScoringTemplateMutationOptions(queryClient, leagueId))
}

/** Options for the editor's save — see `forkScoringTemplateMutationOptions`. */
export function updateLeagueScoringMutationOptions(queryClient: QueryClient, leagueId: string) {
  return {
    mutationFn: (rules: ScoringRulesDoc) =>
      scoringRequest(
        `/api/leagues/${leagueId}/scoring/rules`,
        'PUT',
        { rules },
        'Failed to save scoring.',
      ),
    onSuccess: () => invalidateLeagueScoring(queryClient, leagueId),
  }
}

/**
 * PUT /api/leagues/[id]/scoring/rules — the editor's save (§7.3.3.1).
 *
 * The caller passes the WHOLE document, already normalized
 * (`normalizeScoringDoc` — SE.7's save-time duty): the RPC refuses an
 * un-normalized document rather than rewriting it, so no layer between the
 * editor and the row alters what the commissioner sent.
 */
export function useUpdateLeagueScoring(leagueId: string) {
  const queryClient = useQueryClient()
  return useMutation(updateLeagueScoringMutationOptions(queryClient, leagueId))
}
