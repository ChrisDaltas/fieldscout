import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { LEAGUE_SETTINGS_DEFAULTS } from '@/lib/leagues/settings/league-settings'

import { standaloneListRows } from './my-lists-panel-ops'
import { PRACTICE_HOME_HREF, scopeFromLeague, scopeFromMock } from './room-scope'
import { draftVerbPath, queueFromListPath } from '@/hooks/use-draft-action-path'

/**
 * **THE SEAM MP.6c IS ABOUT** (spec v2.16 §8.8; tasks-MP §4 rule 12 /
 * D229(5), applied one layer out).
 *
 * The room's non-draft context is an OBJECT with TWO fill sites, and the
 * property worth pinning is not the values — it is that neither the room nor
 * the object knows where they came from. The deferred league-attached mock
 * (§6) has to be a THIRD fill site rather than a rewrite, and the way that
 * stops being true is a Builder reaching for `useLeague` (or for
 * `drafts.config`) inside `draft-room.tsx`.
 *
 * So: the two fills are pinned by value, and the room is pinned by ABSENCE.
 */

function code(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

const ROOM = 'src/components/draft/draft-room.tsx'

const DETAIL = {
  league: {
    id: 'lg-1',
    name: 'Test League',
    avatar_url: null,
    description: null,
    season: 2026,
    status: 'drafting',
    owner_id: 'u-1',
    scoring_system_id: 'sys-league',
    invite_code: null,
    invite_slug: null,
    max_teams: 12,
    created_at: null,
    updated_at: null,
  },
  settings: {
    ...LEAGUE_SETTINGS_DEFAULTS,
    regular_season_weeks: 15,
    playoff_start_week: 16,
  },
  members: [
    {
      id: 'm-1',
      user_id: 'u-1',
      team_id: 't-1',
      role: 'commissioner',
      is_placeholder: null,
      is_autodraft: null,
      joined_at: null,
      profiles: { username: 'chris', avatar_url: null },
    },
  ],
  teams: [{ id: 't-1', name: 'My Team', owner_id: 'u-1', status: 'active', created_at: null }],
  my_role: 'commissioner',
  active_draft: null,
} as unknown as Parameters<typeof scopeFromLeague>[1]

describe('fill site 1 — a league room', () => {
  const scope = scopeFromLeague('lg-1', DETAIL)

  it('takes every value from the league, and leaves by the league home', () => {
    expect(scope.leagueId).toBe('lg-1')
    expect(scope.exitHref).toBe('/app/leagues/lg-1')
    expect(scope.exitLabel).toBe('Back to league')
    expect(scope.teams).toHaveLength(1)
    expect(scope.members).toHaveLength(1)
    expect(scope.scoringSystemId).toBe('sys-league')
    expect(scope.regularSeasonWeeks).toBe(15)
    expect(scope.myRole).toBe('commissioner')
    // The league payload rides along for the league-only surfaces the room
    // hosts (the D94 lobby, §8.7's panel, the Add-a-draft-list modal).
    expect(scope.league).not.toBeNull()
  })
})

describe('fill site 2 — a standalone practice room', () => {
  const scope = scopeFromMock({
    teams: [
      { id: 't-h', name: 'My Team' },
      { id: 't-c1', name: 'CPU 1' },
    ],
    roster: LEAGUE_SETTINGS_DEFAULTS.roster_settings,
    scoringSystemId: 'sys-template',
  })

  it('has NO league, and every league-shaped field says so rather than faking one', () => {
    expect(scope.leagueId).toBeNull()
    expect(scope.league).toBeNull()
    // Bots are not users (D227): the member list is EMPTY, which is the
    // fact — no autopick badges, no chat authors, no roles.
    expect(scope.members).toEqual([])
    // No commissioner in a practice draft (D110(1)/D226(2)).
    expect(scope.myRole).toBeNull()
  })

  it('leaves to the practice home, never to a league', () => {
    expect(scope.exitHref).toBe(PRACTICE_HOME_HREF)
    expect(scope.exitHref).toBe('/app/mocks')
    expect(scope.exitLabel).not.toContain('league')
  })

  it('carries the mock’s own seats, roster and scoring template', () => {
    expect(scope.teams.map((t) => t.name)).toEqual(['My Team', 'CPU 1'])
    expect(scope.roster).toEqual(LEAGUE_SETTINGS_DEFAULTS.roster_settings)
    // F117: the id the board's projection columns resolve their family from.
    expect(scope.scoringSystemId).toBe('sys-template')
  })

  it('takes the season length from the contract’s defaults, not a literal', () => {
    // R508's rule: the launch dialog seeds its form from the same defaults,
    // so this IS the horizon the launcher chose from. A literal here would
    // be a second source of truth for a §7.3 field.
    expect(scope.regularSeasonWeeks).toBe(LEAGUE_SETTINGS_DEFAULTS.regular_season_weeks)
  })
})

describe('the ROOM cannot tell where its context came from (§4 rule 12)', () => {
  const room = code(ROOM)

  it('the shared spine and the live room read the scope, never a league query', () => {
    // `useLeague` may appear ONCE — in the LEAGUE mount, which is the fill
    // site. Anywhere below it would be the room re-acquiring a league.
    const uses = [...room.matchAll(/useLeague\(/g)].map((m) => m.index ?? -1)
    expect(uses).toHaveLength(1)
    expect(uses[0]).toBeLessThan(room.indexOf('export function MockDraftRoom'))
    expect(uses[0]).toBeLessThan(room.indexOf('function DraftRoomResolved'))
  })

  it('the room never reads the mock’s config for its context either', () => {
    // The other direction, and the one a Builder is likelier to reach for:
    // `config->'roster'` / `config->>'scoring_system_id'` belong to the
    // STANDALONE MOUNT's hook (`use-mock-room.ts`), not to the room.
    // The one `scoring_system_id` in the file is the LEAGUE's, read off the
    // scope's league payload for the Add-a-draft-list modal (a league
    // surface). The MOCK's — `config->>'scoring_system_id'` — is never read
    // here; it reaches the board through `scope.scoringSystemId`.
    const ids = [...room.matchAll(/scoring_system_id/g)]
    expect(ids).toHaveLength(1)
    expect(room).toContain('scope.league.league.scoring_system_id')
    // …and the roster shape likewise: no `config->'roster'` read, no roster
    // default imported to fall back on. That belongs to `use-mock-room.ts`.
    expect(room).not.toMatch(/config\.roster|\bconfig\?\.roster\b/)
    expect(room).not.toContain('DEFAULT_ROSTER_SETTINGS')
    expect(room).not.toContain('rosterSettingsSchema')
  })

  it('both mounts hand the SAME spine the SAME object', () => {
    const mounts = [...room.matchAll(/<DraftRoomResolved/g)]
    expect(mounts).toHaveLength(2)
    expect(room).toMatch(/scope=\{scopeFromLeague\(leagueId, detail\.data\)\}|const scope = scopeFromLeague\(/)
    expect(room).toMatch(/scope=\{scopeFromMock\(context\.data\)\}/)
    // …and there is exactly ONE live room behind them (the LV.7 rule).
    expect([...room.matchAll(/function DraftRoomLive\(/g)]).toHaveLength(1)
    expect([...room.matchAll(/<DraftRoomLive/g)]).toHaveLength(1)
  })
})

describe('which URL a room verb posts to (MP.6b’s seam, client side)', () => {
  it('a league room keeps its shipped paths, byte for byte (§4 rule 11)', () => {
    expect(draftVerbPath('lg-1', 'd-1', 'pick')).toBe('/api/leagues/lg-1/draft/pick')
    expect(draftVerbPath('lg-1', 'd-1', 'pause')).toBe('/api/leagues/lg-1/draft/pause')
    expect(draftVerbPath('lg-1', 'd-1', 'nominate')).toBe('/api/leagues/lg-1/draft/nominate')
    expect(draftVerbPath('lg-1', 'd-1', 'bid')).toBe('/api/leagues/lg-1/draft/bid')
    expect(draftVerbPath('lg-1', 'd-1', 'queue')).toBe('/api/leagues/lg-1/draft/queue')
    expect(queueFromListPath('lg-1', 'd-1', 'li-1')).toBe(
      '/api/leagues/lg-1/draft/queue/from-list/li-1',
    )
  })

  it('a standalone practice room posts to the mock’s own routes (MP.6b)', () => {
    expect(draftVerbPath(null, 'd-1', 'pick')).toBe('/api/mocks/d-1/pick')
    expect(draftVerbPath(null, 'd-1', 'pause')).toBe('/api/mocks/d-1/pause')
    expect(draftVerbPath(null, 'd-1', 'nominate')).toBe('/api/mocks/d-1/nominate')
    expect(draftVerbPath(null, 'd-1', 'bid')).toBe('/api/mocks/d-1/bid')
    expect(draftVerbPath(null, 'd-1', 'queue')).toBe('/api/mocks/d-1/queue')
    expect(queueFromListPath(null, 'd-1', 'li-1')).toBe('/api/mocks/d-1/queue/from-list/li-1')
  })

  it('no room hook hand-rolls a draft verb URL any more', () => {
    // The defect: one hook keeping `/api/leagues/${leagueId}/draft/…`, which
    // a standalone room would send with `null` in the path.
    for (const rel of [
      'src/hooks/use-draft.ts',
      'src/hooks/use-draft-queue.ts',
      'src/hooks/use-draft-auction-ops.ts',
    ]) {
      const source = code(rel)
      for (const verb of ['pick', 'nominate', 'bid', 'queue']) {
        expect(source, `${rel} / ${verb}`).not.toContain(`/draft/${verb}`)
      }
    }
    expect(code('src/hooks/use-draft-controls-ops.ts')).not.toContain('/draft/pause')
  })
})

describe('which lists a standalone room offers (ledger F122)', () => {
  const rows = standaloneListRows([
    { id: 'l-1', title: 'Sleepers', player_count: 30, is_big_board: false },
    { id: 'l-2', title: 'My Big Board', player_count: 200, is_big_board: true },
  ])

  it('offers the caller’s OWN lists — the predicate the verb enforces', () => {
    // MP.6b scoped the standalone `queue-from-list` arm by OWNERSHIP (spec
    // erratum v2.16.3), so this is D110(1): the panel cannot offer what the
    // verb would refuse, and it does not need to hide anything the verb
    // would accept.
    expect(rows.map((r) => r.listId).sort()).toEqual(['l-1', 'l-2'])
    expect(rows.every((r) => r.isMine)).toBe(true)
    expect(rows.every((r) => r.ownerLabel === null)).toBe(true)
  })

  it('the Big Board leads', () => {
    expect(rows[0].listId).toBe('l-2')
    expect(rows[0].isBigBoard).toBe(true)
  })

  it('nothing is attached and nothing is primary — both are league objects', () => {
    // `league_lists.is_primary_board` cannot exist without a league, so the
    // panel renders no §8.9 best-available helper standalone. An absence
    // with a cause, pinned so it is not "fixed" by inventing a default.
    expect(rows.every((r) => r.attached === false)).toBe(true)
    expect(rows.every((r) => r.isPrimary === false)).toBe(true)
    expect(rows.every((r) => r.leagueListId === null)).toBe(true)
  })

  it('an empty list set is empty, not a Big Board placeholder', () => {
    expect(standaloneListRows([])).toEqual([])
  })
})
