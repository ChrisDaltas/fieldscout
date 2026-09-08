import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { LeagueDetail } from '@/hooks/use-league'
import { LEAGUE_SETTINGS_DEFAULTS } from '@/lib/leagues/settings/league-settings'

import {
  deriveLobbyChecklist,
  draftTimeReachedLine,
  lobbyAutopickTeamIds,
  lobbyFranchiseCapacity,
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

function team(id: string, status = 'active'): LeagueDetail['teams'][number] {
  return { id, name: `Team ${id}`, owner_id: 'u1', status, created_at: null }
}

function detailWith(over: {
  members?: LeagueDetail['members']
  teams?: LeagueDetail['teams']
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
      champion_team_id: null,
    },
    settings,
    members: over.members ?? [member({}), member({ id: 'm2', user_id: 'u2', team_id: 't2' })],
    // Default: at capacity (both franchises exist) — the capacity-blocked
    // shapes build their own teams list (R274).
    teams: over.teams ?? [team('t1'), team('t2')],
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
  it('all-ready: every franchise exists, every seat claimed, scoring set, order stored', () => {
    const items = deriveLobbyChecklist(detailWith({}), ['t1', 't2'])
    expect(items.map((i) => [i.key, i.done])).toEqual([
      ['franchises', true],
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
// Franchise capacity — the D96 refusal's lobby read (R274, M2 batch 15)
// ---------------------------------------------------------------------------

describe('lobbyFranchiseCapacity + draftTimeReachedLine (R274)', () => {
  // The reviewer's scenario verbatim: a 12-team league with 5 franchises —
  // 066's draft_start refuses (5 <> 12, §7.2/D96) and the D94 tick
  // re-refuses every ~5s; pre-fix the lobby promised "any moment now"
  // forever over that standing refusal.
  const blocked12 = detailWith({
    maxTeams: 12,
    teams: [team('t1'), team('t2'), team('t3'), team('t4'), team('t5')],
  })

  it('capacity-blocked: NO "any moment" promise — the honest line points at Add an open seat', () => {
    const capacity = lobbyFranchiseCapacity(blocked12)
    expect(capacity).toEqual({ active: 5, total: 12, blocked: true })
    const line = draftTimeReachedLine(capacity)
    expect(line).not.toContain('any moment')
    expect(line).toContain('5 of 12 franchise seats')
    expect(line).toContain('Add an open seat')
  })

  it('capacity-blocked: the checklist carries the capacity line, not-done', () => {
    const row = deriveLobbyChecklist(blocked12, []).find((i) => i.key === 'franchises')!
    expect(row.done).toBe(false)
    expect(row.detail).toContain('5 / 12 franchise seats exist')
    expect(row.detail).toContain('add an open seat')
  })

  it('at capacity: the auto-start promise stands and the row is done', () => {
    const capacity = lobbyFranchiseCapacity(detailWith({}))
    expect(capacity.blocked).toBe(false)
    expect(draftTimeReachedLine(capacity)).toContain('any moment now')
    expect(deriveLobbyChecklist(detailWith({}), []).find((i) => i.key === 'franchises')!.done).toBe(
      true,
    )
  })

  it("retired franchises don't count toward capacity; orphaned do (066's exact filter)", () => {
    const detail = detailWith({
      teams: [team('t1'), team('t2', 'retired'), team('t3', 'orphaned')],
    })
    expect(lobbyFranchiseCapacity(detail)).toEqual({ active: 2, total: 2, blocked: false })
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

// ---------------------------------------------------------------------------
// §16.5.2 practice entry point (R279) — source pin, not a render (the
// ai-surfaces/lists-cutover idiom: .tsx is unparseable under jsx:"preserve")
// ---------------------------------------------------------------------------

describe('the lobby mounts the §16.5.2 practice entry (R279)', () => {
  // Comments stripped so the pin reads CODE, not the prose about it (the
  // lists-cutover lesson); `[^:]` keeps `https://` out of the line-comment arm.
  const code = readFileSync(
    path.resolve(process.cwd(), 'src/components/draft/draft-lobby.tsx'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (_match, before) => before ?? '')

  it('renders PracticeCta — the mock-workflow map names TWO entry points ("Practice card · draft lobby"), and this is the second', () => {
    expect(code).toContain('<PracticeCta leagueId={leagueId} />')
  })

  it('composes the home CTA, never a fork (one treatment behind MOCK_LAUNCHER_READY)', () => {
    expect(code).toContain("import { PracticeCta } from '@/components/leagues/league-home-states'")
  })
})
