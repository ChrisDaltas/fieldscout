'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { Crest } from '@/components/leagues/league-cells'
import { RailPanelShell } from '@/components/layout/rail/rail-panel-shell'
import { leagueCardContext } from '@/components/players/player-card-context'
import { PlayerLink } from '@/components/players/player-link'
import { PositionBadge } from '@/components/players/position-badge'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useLeague } from '@/hooks/use-league'
import { useLeagues } from '@/hooks/use-leagues'
import { useRosters } from '@/hooks/use-rosters'
import { useStandings } from '@/hooks/use-standings'
import { featureFlags } from '@/lib/feature-flags'

import { leagueIdFromPath, recordText, rosterGroupOf, type RosterGroup } from './players-panel-ops'

/** One row the panel renders — a real league membership. */
export interface RailTeam {
  id: string
  name: string
  /** Sub-line under the name (the viewer's role in the league). */
  leagueName: string
  crestUrl: string | null
}

const ROLE_LABEL: Record<string, string> = {
  commissioner: 'Commissioner',
  co_commissioner: 'Co-commissioner',
  manager: 'Manager',
}

interface TeamsPanelProps {
  onClose: () => void
  /** Injectable override (tests); otherwise the viewer's real memberships. */
  teams?: RailTeam[]
  /** Test seam: the page's path (else the router's). */
  pathname?: string
}

/**
 * Teams tool — the viewer's fantasy leagues, one 45px row per membership
 * (crest tile, league name over role). Wired to real data via `useLeagues`
 * (the same query as home / the index); rows open the league home. Empty
 * until the user creates or joins a league.
 */
export function TeamsPanel({ onClose, teams, pathname }: TeamsPanelProps) {
  const routePath = usePathname()
  const pageLeague = featureFlags.leagues ? leagueIdFromPath(pathname ?? routePath) : null
  const { data, isPending } = useLeagues({ enabled: featureFlags.leagues && !pageLeague })
  // D483: on a league page the tool is that league's standings + rosters.
  if (pageLeague && teams === undefined) {
    return (
      <RailPanelShell title="Teams" onClose={onClose}>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-rail-scroll>
          <LeagueTeamsList leagueId={pageLeague} />
        </div>
      </RailPanelShell>
    )
  }
  const rows: RailTeam[] =
    teams ??
    (data ?? []).map((lg) => ({
      id: lg.id,
      name: lg.name,
      leagueName: ROLE_LABEL[lg.my_role] ?? lg.my_role,
      crestUrl: null,
    }))
  const loading = teams === undefined && isPending

  return (
    <RailPanelShell title="Teams" onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-rail-scroll>
        {loading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex h-crest-row items-center gap-2.5 border-b border-n-4 px-3">
              <Skeleton className="h-7 w-7 shrink-0 rounded-sm" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}

        {!loading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-4 py-12 text-center">
            <Icon name="team" size={16} className="text-n-3" />
            <p className="text-[12px] font-bold text-ink">No leagues yet</p>
            <p className="text-[11px] font-medium text-n-3">
              Create or join a league to see it here.
            </p>
          </div>
        )}

        {!loading &&
          rows.map((team) => (
            <Link
              key={team.id}
              href={`/app/leagues/${team.id}`}
              className="flex h-crest-row items-center gap-2.5 border-b border-n-4 px-3 transition-colors duration-200 ease-linear hover:bg-n-4"
            >
              <UserAvatar
                kind="team"
                src={team.crestUrl}
                name={team.name}
                className="h-7 w-7 shrink-0"
                fallbackClassName="text-[9px]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-bold leading-tight text-ink">
                  {team.name}
                </span>
                <span className="block truncate text-[10px] font-medium leading-tight text-n-3">
                  {team.leagueName}
                </span>
              </span>
              <Icon name="arrow-next" size={12} className="shrink-0 text-n-3" />
            </Link>
          ))}
      </div>
    </RailPanelShell>
  )
}

// ---------------------------------------------------------------------------
// League-scoped: standings → one team's roster (D483)
// ---------------------------------------------------------------------------

/** Standings-ordered teams (rank, crest, team, manager, W–L, PF); a click
 *  shows that team's roster grouped Starters / Bench / Injured. Reads only
 *  the existing standings + rosters + league detail routes. */
export function LeagueTeamsList({ leagueId }: { leagueId: string }) {
  const league = useLeague(leagueId)
  const standings = useStandings(leagueId)
  const rosters = useRosters(leagueId)
  const [openTeam, setOpenTeam] = useState<string | null>(null)

  if (league.isPending || standings.isPending || rosters.isPending) {
    return (
      <div className="space-y-2.5 p-3" aria-label="Loading teams">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    )
  }
  if (league.isError || standings.isError || rosters.isError || !league.data || !rosters.data) {
    return <p className="px-4 py-10 text-center text-[11px] font-medium text-n-3">Couldn’t load this league’s teams. Try again in a moment.</p>
  }
  const managerOf = new Map<string, string>()
  for (const m of league.data.members) if (m.team_id && m.profiles?.username) managerOf.set(m.team_id, m.profiles.username)
  const context = leagueCardContext(leagueId)

  const team = openTeam ? rosters.data.teams.find((t) => t.team_id === openTeam) : null
  if (team) {
    const groups: RosterGroup[] = ['Starters', 'Bench', 'Injured']
    return (
      <div data-rail-roster={team.team_id}>
        <button
          type="button"
          onClick={() => setOpenTeam(null)}
          className="flex w-full items-center gap-1.5 border-b border-n-4 px-3 py-2 text-left text-[11px] font-extrabold text-accent-strong hover:text-accent"
        >
          <Icon name="arrow-next" size={12} className="rotate-180" />
          All teams
        </button>
        <div className="flex items-center gap-2 border-b border-ink px-3 py-2">
          <Crest name={team.name} src={null} className="h-7 w-7" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-extrabold text-ink">{team.name}</span>
            <span className="block truncate text-[10px] font-medium text-n-3">{managerOf.get(team.team_id) ?? 'No manager'}</span>
          </span>
        </div>
        {team.roster.length === 0 && <p className="px-4 py-8 text-center text-[11px] font-medium text-n-3">No players on this roster yet.</p>}
        {groups.map((g) => {
          const rows = team.roster.filter((p) => rosterGroupOf(p.slot_key) === g)
          if (rows.length === 0) return null
          return (
            <div key={g}>
              <p className="bg-n-4 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide text-n-3">{g}</p>
              {rows.map((p) => (
                <div key={p.player_id} className="flex items-center gap-2 border-b border-n-4 px-3 py-1.5" data-rail-roster-row={p.player_id}>
                  <PositionBadge position={p.position} />
                  <PlayerLink playerId={p.player_id} name={p.full_name} context={context} className="min-w-0 flex-1 text-[12px] font-bold" />
                  <span className="fs-num text-[10px] font-semibold text-n-3">{p.nfl_team ?? 'FA'}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  // Standings order; before any week is final the table may be empty, so
  // fall back to the rosters' teams (0–0, 0 PF) rather than show nothing.
  const table = standings.data?.standings ?? []
  const rows =
    table.length > 0
      ? table.map((s) => ({ rank: s.rank, id: s.team_id, name: s.name, w: s.wins, l: s.losses, t: s.ties, pf: s.points_for }))
      : rosters.data.teams.map((t, i) => ({ rank: i + 1, id: t.team_id, name: t.name, w: 0, l: 0, t: 0, pf: 0 }))
  return (
    <>
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => setOpenTeam(r.id)}
          className="flex h-crest-row w-full items-center gap-2 border-b border-n-4 px-3 text-left transition-colors duration-200 ease-linear hover:bg-n-4"
          data-rail-team={r.id}
        >
          <span className="fs-num w-4 shrink-0 text-[11px] font-extrabold text-n-3">{r.rank}</span>
          <Crest name={r.name} src={null} className="h-7 w-7" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-bold leading-tight text-ink">{r.name}</span>
            <span className="block truncate text-[10px] font-medium leading-tight text-n-3">{managerOf.get(r.id) ?? 'No manager'}</span>
          </span>
          <span className="fs-num shrink-0 text-right text-[10px] font-bold leading-tight text-ink">
            {recordText(r.w, r.l, r.t)}
            <span className="block font-semibold text-n-3">{r.pf.toFixed(1)} PF</span>
          </span>
        </button>
      ))}
    </>
  )
}
