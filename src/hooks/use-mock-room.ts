'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'
import {
  DEFAULT_ROSTER_SETTINGS,
  rosterSettingsSchema,
  type RosterSettings,
} from '@/lib/leagues/settings/league-settings'

/**
 * The STANDALONE practice room's context read — MP task MP.6c item 2 (spec
 * v2.16 §8.8; the second fill site of `room-scope.ts`).
 *
 * It answers the three questions `useLeague` answers for a league room, off
 * the practice draft itself:
 *   - **the seats** — the mock's own `teams` rows (D227: the launcher's seat
 *     plus `CPU 1…N-1`, minted in the launch transaction), read in
 *     `draft_order` order so the board's columns are the draft's order;
 *   - **the roster** — MP.2's `config->'roster'` (migration 094: the draft
 *     row describes its own roster, so editing a league's roster mid-mock
 *     cannot move the bots under the human);
 *   - **the scoring family's id** — MP.4's `config->>'scoring_system_id'`,
 *     which until now nothing read (ledger F117).
 *
 * **Reads, not routes** (D92's read rule): both selects are RLS-scoped. 095's
 * standalone SELECT arm on `drafts` is keyed on the launcher, so someone
 * else's mock and an id that never existed answer the SAME empty result —
 * `null` here, and the mount renders one honest not-found for both (item 8:
 * the page must never leak that the row exists).
 *
 * `is_mock` + `league_id IS NULL` are in the query on purpose: this hook is
 * the STANDALONE context, and a league-attached mock (or a real draft) typed
 * at `/app/mocks/[mockId]` must not resolve through it. The route's server
 * page redirects a league-attached mock to the room it actually has (R521)
 * before this ever runs; this is the belt.
 */

export const mockRoomKeys = {
  context: (mockId: string) => ['mock-room-context', mockId] as const,
}

export interface MockRoomContext {
  teams: Array<{ id: string; name: string }>
  roster: RosterSettings
  scoringSystemId: string | null
  /** `config.mock.human_team_id` — the ONE human seat (D103(2)). The room
   *  resolves its own "You" seat from the same place; this copy is what the
   *  mount announces on the §9.3 presence channel, so the board's own seat
   *  reads online rather than absent. */
  humanTeamId: string | null
}

export function useMockRoomContext(mockId: string | undefined) {
  return useQuery({
    queryKey: mockRoomKeys.context(mockId ?? 'none'),
    enabled: Boolean(mockId),
    queryFn: async (): Promise<MockRoomContext | null> => {
      const supabase = createBrowserClient()
      const { data: draft, error } = await supabase
        .from('drafts')
        .select('id, config, draft_order')
        .eq('id', mockId!)
        .eq('is_mock', true)
        .is('league_id', null)
        .maybeSingle()
      if (error) throw error
      if (!draft) return null

      const config = (draft.config ?? {}) as {
        roster?: unknown
        scoring_system_id?: unknown
        mock?: { human_team_id?: unknown }
      }
      // 094's guarantee is a KEY, not a shape the client may assume: parse
      // it, and fall back to the shipped default rather than rendering a
      // roster of nothing if a pre-094 row ever reaches here (094's backfill
      // covered them; this is the belt, and it fails loudly in neither
      // direction — the tracker's slots are a display read-model).
      const parsed = rosterSettingsSchema.safeParse(config.roster)
      const roster: RosterSettings = parsed.success
        ? parsed.data
        : structuredClone(DEFAULT_ROSTER_SETTINGS)

      // **"Nothing happened" must never read as "it worked"** (CLAUDE.md;
      // R535). A standalone mock is minted with its whole seat set inside
      // `create_mock_draft`'s one transaction (D227) — the `teams` rows and
      // the `draft_order` that names them. So neither shortfall below is a
      // small draft, it is a BROKEN one, and the mount's problem state is
      // the honest answer:
      //   - an EMPTY `draft_order` would otherwise resolve to a non-null
      //     context with zero seats, and the room would render a board with
      //     no columns as though that were the draft;
      //   - a `.in()` read that comes back SHORT (a seat deleted, or hidden
      //     from this reader) would otherwise be filtered away silently and
      //     seat a board with a hole where a bot should be picking.
      // Both fail loudly instead, and say which.
      const order = Array.isArray(draft.draft_order) ? (draft.draft_order as string[]) : []
      if (order.length === 0) {
        throw new Error('This practice draft has no seats recorded, so its board cannot be built.')
      }
      const { data: rows, error: teamsError } = await supabase
        .from('teams')
        .select('id, name')
        .in('id', order)
      if (teamsError) throw teamsError
      const byId = new Map((rows ?? []).map((row) => [row.id, row.name]))
      // Draft-order order: the board's columns are the draft's order (D90),
      // and `.in()` returns rows in no promised order.
      const teams = order
        .filter((id) => byId.has(id))
        .map((id) => ({ id, name: byId.get(id) as string }))
      if (teams.length !== order.length) {
        throw new Error(
          `This practice draft is missing seats: ${teams.length} of ${order.length} found.`,
        )
      }

      return {
        teams,
        roster,
        scoringSystemId:
          typeof config.scoring_system_id === 'string' ? config.scoring_system_id : null,
        humanTeamId:
          typeof config.mock?.human_team_id === 'string' ? config.mock.human_team_id : null,
      }
    },
    staleTime: 5 * 60 * 1000,
  })
}
