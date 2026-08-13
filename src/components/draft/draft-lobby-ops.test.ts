import { describe, expect, it } from 'vitest'

import type { LeagueDetail } from '@/hooks/use-league'
import { LEAGUE_SETTINGS_DEFAULTS } from '@/lib/leagues/settings/league-settings'

import {
  deriveLobbyChecklist,
  lobbyAutopickTeamIds,
  lobbyOrderTeamIds,
} from './draft-lobby-ops'

// ---------------------------------------------------------------------------
// Fixture — a minimal real-shaped LeagueDetail (the home-states test pattern)
// ---------------------------------------------------------------------------

function member(over: Partial<LeagueDetail['members'][number]>): LeagueDetail['members'][number] {
  return {
    id: over.id ?? 'm1',
    user_id: over.user_id === undefined ? 'u1' : over.user_id,
    team_id: over.team_id ?? 't1',
    role: over.role ?? 'manager',
    is_placeholder: over.is_placeholder ?? false,
    is_autodraft: over.is_autodraft ?? false,
    joined_at: over.joined_at ?? null,
    profiles: over.profiles ?? null,
  }
}

function detailWith(over: {
  members?: LeagueDetail['members']
  scoringSystemId?: string | null
  maxTeams?: number
  draft?: Partial<LeagueDetail['settings']['draft']>
}): LeagueDetail {
  const settings = structuredClone(LEAGUE_SETTINGS_DEFAULTS)
  Object.assign(settings.draft, over.draft ?? {})
  return {
    league: {
      id: 'lg1',
      name: 'Lobby League',
      avatar_url: null,
      description: null,
      season: 2026,
      status: 'scheduled',
      owner_id: 'u1',
      scoring_system_id: over.scoringSystemId === undefined ? 'sys1' : over.scoringSystemId,
      invite_code: null,
      invite_slug: null,
      max_teams: over.maxTeams ?? 2,
      created_at: null,
      updated_at: null,
    },
    settings,
    members: over.members ?? [member({}), member({ id: 'm2', user_id: 'u2', team_id: 't2' })],
    teams: [],
    my_role: 'commissioner',
    active_draft: null,
  }
}

// ---------------------------------------------------------------------------
// Order display — the drafts row beats the settings store (D101/D95)
// ---------------------------------------------------------------------------

describe('lobbyOrderTeamIds', () => {
  it('prefers the DRAFTS row order (a pre-start randomize wrote it — D101)', () => {
    expect(lobbyOrderTeamIds(['tB', 'tA'], ['tA', 'tB'])).toEqual(['tB', 'tA'])
  })

  it('falls back to the settings store (manual/custom saved order — D95)', () => {
    expect(lobbyOrderTeamIds(null, ['tA', 'tB'])).toEqual(['tA', 'tB'])
  })

  it('empty when neither exists — random pre-randomize has NO order to show', () => {
    expect(lobbyOrderTeamIds(null, null)).toEqual([])
    expect(lobbyOrderTeamIds([], null)).toEqual([])
  })

  it('a malformed drafts-row order degrades to the settings store, never junk rows', () => {
    expect(lobbyOrderTeamIds('not-an-array', ['tA'])).toEqual(['tA'])
    expect(lobbyOrderTeamIds([1, 2], ['tA'])).toEqual(['tA'])
  })
})

// ---------------------------------------------------------------------------
// Checklist — seats / settings / order (§16.5.2 lobby row)
// ---------------------------------------------------------------------------

describe('deriveLobbyChecklist', () => {
  it('all-ready: every seat claimed, scoring set, order stored', () => {
    const items = deriveLobbyChecklist(detailWith({}), ['t1', 't2'])
    expect(items.map((i) => [i.key, i.done])).toEqual([
      ['seats', true],
      ['settings', true],
      ['order', true],
    ])
  })

  it('an unclaimed seat is informational (autodraft copy), not silent', () => {
    const items = deriveLobbyChecklist(
      detailWith({ members: [member({}), member({ id: 'm2', user_id: null, team_id: 't2' })] }),
      [],
    )
    const seatsRow = items.find((i) => i.key === 'seats')!
    expect(seatsRow.done).toBe(false)
    expect(seatsRow.detail).toContain('1 / 2')
    expect(seatsRow.detail).toContain('autodraft')
  })

  it('missing scoring template is the settings blocker (draft_start snapshots it — D43)', () => {
    const items = deriveLobbyChecklist(detailWith({ scoringSystemId: null }), [])
    expect(items.find((i) => i.key === 'settings')!.done).toBe(false)
  })

  it('random mode with no stored order is READY (066 shuffles at start — D101)', () => {
    const items = deriveLobbyChecklist(detailWith({ draft: { draft_order_mode: 'random' } }), [])
    const orderRow = items.find((i) => i.key === 'order')!
    expect(orderRow.done).toBe(true)
    expect(orderRow.detail).toContain('Randomizes automatically')
  })

  it('manual mode with no stored order is NOT ready (the one order state draft_start refuses)', () => {
    const items = deriveLobbyChecklist(detailWith({ draft: { draft_order_mode: 'manual' } }), [])
    const orderRow = items.find((i) => i.key === 'order')!
    expect(orderRow.done).toBe(false)
    expect(orderRow.detail).toContain('No saved order')
  })

  it('a stored order marks the order row done in any mode', () => {
    const random = deriveLobbyChecklist(detailWith({ draft: { draft_order_mode: 'random' } }), ['t1', 't2'])
    expect(random.find((i) => i.key === 'order')!.detail).toContain('Randomized')
    const manual = deriveLobbyChecklist(detailWith({ draft: { draft_order_mode: 'manual' } }), ['t1', 't2'])
    expect(manual.find((i) => i.key === 'order')!.done).toBe(true)
  })

  it('the untimed clock renders honestly in the settings detail (§8.2 soft timer)', () => {
    const items = deriveLobbyChecklist(
      detailWith({ draft: { pick_timer_seconds: 0 } }),
      [],
    )
    expect(items.find((i) => i.key === 'settings')!.detail).toContain('untimed')
  })
})

// ---------------------------------------------------------------------------
// Autopick badge set (§16.5.4 — mirrors the room's derivation)
// ---------------------------------------------------------------------------

describe('lobbyAutopickTeamIds', () => {
  it('flags is_autodraft seats and no-user seats; leaves manned seats alone', () => {
    const ids = lobbyAutopickTeamIds([
      member({ id: 'm1', team_id: 't1' }), // manned, flag off
      member({ id: 'm2', team_id: 't2', is_autodraft: true }), // §8.4 flag
      member({ id: 'm3', team_id: 't3', user_id: null }), // E48 autopilot
      member({ id: 'm4', team_id: null }), // no seat — nothing to badge
    ])
    expect([...ids].sort()).toEqual(['t2', 't3'])
  })
})
