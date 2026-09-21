'use client'

import Link from 'next/link'

import { RailPanelShell } from '@/components/layout/rail/rail-panel-shell'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useLeagues } from '@/hooks/use-leagues'
import { featureFlags } from '@/lib/feature-flags'

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
}

/**
 * Teams tool — the viewer's fantasy leagues, one 45px row per membership
 * (crest tile, league name over role). Wired to real data via `useLeagues`
 * (the same query as home / the index); rows open the league home. Empty
 * until the user creates or joins a league.
 */
export function TeamsPanel({ onClose, teams }: TeamsPanelProps) {
  const { data, isPending } = useLeagues({ enabled: featureFlags.leagues })
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
