import Link from 'next/link'

import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { getTeamColors } from '@/lib/nfl-team-colors'
import { NFL_DIVISIONS, teamsInDivision } from '@/lib/nfl-teams'

export const metadata = { title: 'NFL teams · FieldScout' }

/**
 * NFL teams index — one flat white card per division, flush team rows with
 * square team-color crests. Batch E surface: extends the design language,
 * no prototype screen to match.
 */
export default function NflTeamsPage() {
  return (
    <div className="grid grid-cols-1 gap-[19px] md:grid-cols-2">
      {NFL_DIVISIONS.map(({ conference, division }) => (
        <Card key={`${conference}-${division}`}>
          <CardHeader className="min-h-0 py-2.5">
            <CardTitle>
              {conference} {division}
            </CardTitle>
          </CardHeader>
          <ul>
            {teamsInDivision(conference, division).map((team) => {
              const colors = getTeamColors(team.abbr)
              return (
                <li key={team.abbr} className="border-b border-n-4 last:border-0">
                  <Link
                    href={`/app/nfl/${team.abbr}`}
                    className="flex h-[45px] items-center gap-2.5 px-card-pad transition-colors duration-200 ease-linear hover:bg-accent-soft"
                  >
                    <span
                      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm border border-ink text-[10px] font-extrabold text-white"
                      style={{ backgroundColor: colors.primary }}
                    >
                      {team.abbr}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-extrabold text-ink">
                      {team.city} {team.name}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      ))}
    </div>
  )
}
