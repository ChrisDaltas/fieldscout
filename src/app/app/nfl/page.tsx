import Link from 'next/link'

import { getTeamColors } from '@/lib/nfl-team-colors'
import { NFL_DIVISIONS, teamsInDivision } from '@/lib/nfl-teams'

export const metadata = { title: 'NFL Teams · FieldScout' }

export default function NflTeamsPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold leading-tight">NFL Teams</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Browse fantasy-relevant rosters for all 32 teams.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        {NFL_DIVISIONS.map(({ conference, division }) => (
          <section key={`${conference}-${division}`}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              {conference} {division}
            </h2>
            <ul className="space-y-1">
              {teamsInDivision(conference, division).map((team) => {
                const colors = getTeamColors(team.abbr)
                return (
                  <li key={team.abbr}>
                    <Link
                      href={`/app/nfl/${team.abbr}`}
                      className="flex items-center gap-3 rounded-md border border-bg-elevated-2 bg-bg-elevated px-3 py-2.5 transition-colors hover:border-bg-elevated-3 hover:bg-bg-elevated-2"
                    >
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                        style={{ backgroundColor: colors.primary }}
                      >
                        {team.abbr}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {team.city} {team.name}
                        </span>
                        <span className="block text-xs text-text-secondary">
                          {team.conference} {team.division}
                        </span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
