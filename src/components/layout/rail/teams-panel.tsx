'use client'

import Link from 'next/link'

import { RailPanelShell } from '@/components/layout/rail/rail-panel-shell'
import { Icon } from '@/components/ui/icon'
import { UserAvatar } from '@/components/ui/user-avatar'

/** Shape the panel expects once a real teams hook exists. */
export interface RailTeam {
  id: string
  name: string
  leagueName: string
  crestUrl: string | null
}

// TODO(live-draft): replace with real teams data. There is no teams hook or
// /api route yet (/app/teams/* are placeholder pages) — when leagues/teams
// land, swap MOCK_TEAMS for the hook result and delete this block.
const MOCK_TEAMS: RailTeam[] = [
  {
    id: 'mock-gridiron-gurus',
    name: 'Gridiron Gurus',
    leagueName: 'League of Ordinary Gentlemen',
    crestUrl: null,
  },
  {
    id: 'mock-check-downs',
    name: 'Check Downs',
    leagueName: 'Dynasty Degenerates',
    crestUrl: null,
  },
  {
    id: 'mock-cubicle-kings',
    name: 'Cubicle Kings',
    leagueName: 'The Work League',
    crestUrl: null,
  },
]

interface TeamsPanelProps {
  onClose: () => void
  /** Injectable for the real hook later; defaults to the mock roster. */
  teams?: RailTeam[]
}

/**
 * Teams tool — the user's fantasy teams, one 45px row per team (crest tile,
 * team name over league name). Rows navigate to the team page.
 */
export function TeamsPanel({ onClose, teams = MOCK_TEAMS }: TeamsPanelProps) {
  return (
    <RailPanelShell title="Teams" onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {teams.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-4 py-12 text-center">
            <Icon name="team" size={16} className="text-n-3" />
            <p className="text-[12px] font-bold text-ink">No teams yet</p>
            <p className="text-[11px] font-medium text-n-3">
              Join a league to see your teams here.
            </p>
          </div>
        )}

        {teams.map((team) => (
          <Link
            key={team.id}
            href={`/app/teams/${team.id}`}
            className="flex h-[45px] items-center gap-2.5 border-b border-n-4 px-3 transition-colors duration-200 ease-linear hover:bg-n-4"
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
