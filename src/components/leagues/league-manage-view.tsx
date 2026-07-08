'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { PageHeader } from '@/components/layout/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import { TeamCell } from './league-cells'
import {
  MOCK_ROSTER_SLOTS,
  MOCK_SCORING_GROUPS,
  MOCK_WAIVER_SETTINGS,
  getMockLeague,
  getMockLeagueTeams,
} from './league-mock-data'

/**
 * Manage league — commissioner scaffold (TeamView League Settings content):
 * members, waivers & trades, roster slots, and the scoring summary. Editing
 * scoring routes to the scoring builder; league-scoped scoring comes later.
 *
 * TODO(live-draft): no league backend exists — every value is mock and every
 * action is a stub. Wire to real league settings when leagues land.
 */

// TODO(live-draft): stubs — commissioner actions need the league backend.
function inviteStub() {
  toast({
    title: 'Invites are coming',
    description: 'Invite links go out to your league mates with league sync.',
  })
}

function editStub(section: string) {
  toast({
    title: `${section} locks for now`,
    description: 'Commissioner editing ships with league sync.',
  })
}

function removeStub(team: string) {
  toast({
    title: `${team} stays in the league`,
    description: 'Managing members ships with league sync.',
  })
}

export function LeagueManageView({ leagueId }: { leagueId: string }) {
  const router = useRouter()
  const league = getMockLeague(leagueId)
  const teams = getMockLeagueTeams(league.id)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Manage league"
        actions={
          <Button variant="stroke" size="sm" onClick={inviteStub}>
            <Icon name="send" size={13} />
            Copy invite link
          </Button>
        }
      />

      <div>
        <Button variant="stroke" size="sm" onClick={() => router.back()}>
          <Icon name="arrow-prev" size={13} />
          Back
        </Button>
      </div>

      <div className="grid grid-cols-1 items-start gap-[19px] lg:grid-cols-[1.4fr_1fr]">
        {/* Members */}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <Badge variant="stroke">
              <span className="fs-num">{teams.length}</span> teams
            </Badge>
          </CardHeader>
          <div>
            {teams.map((team, i) => (
              <div
                key={team.team}
                className={cn(
                  'flex items-center gap-2.5 px-card-pad py-2',
                  i < teams.length - 1 && 'border-b border-n-4',
                  team.manager === 'You' && 'bg-accent-soft',
                )}
              >
                <TeamCell team={team.team} sub={team.manager} className="mr-auto" />
                <span className="fs-num shrink-0 text-[11px] font-extrabold">
                  {team.w}–{team.l}
                </span>
                {team.manager === 'You' ? (
                  <Badge variant="stroke">Commissioner</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeStub(team.team)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-[19px]">
          {/* Waivers & trades */}
          <Card>
            <CardHeader>
              <CardTitle>Waivers &amp; trades</CardTitle>
              <Button
                variant="stroke"
                size="sm"
                onClick={() => editStub('Waivers & trades')}
              >
                <Icon name="edit" size={13} />
                Edit
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {MOCK_WAIVER_SETTINGS.map((setting) => (
                <div
                  key={setting.label}
                  className="flex items-baseline justify-between gap-2.5 text-[12px] font-bold"
                >
                  <span className="whitespace-nowrap text-n-3">
                    {setting.label}
                  </span>
                  <span className="text-right">{setting.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Roster slots */}
          <Card>
            <CardHeader>
              <CardTitle>Roster slots</CardTitle>
              <Button
                variant="stroke"
                size="sm"
                onClick={() => editStub('Roster slots')}
              >
                <Icon name="edit" size={13} />
                Edit
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {MOCK_ROSTER_SLOTS.map((slot) => (
                <div
                  key={slot.abbr}
                  className="flex items-center gap-2.5 text-[12px] font-bold"
                >
                  <span className="w-10 shrink-0 text-[10px] font-extrabold text-n-3">
                    {slot.abbr}
                  </span>
                  <span className="mr-auto">{slot.label}</span>
                  <span className="fs-num font-extrabold">{slot.count}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Scoring summary — edits happen in the scoring builder. */}
      <Card>
        <CardHeader>
          <CardTitle>Scoring</CardTitle>
          <div className="flex items-center gap-2.5">
            <Badge variant="stroke">{league.format.split(' · ')[0]}</Badge>
            <Button variant="stroke" size="sm" asChild>
              <Link href="/app/settings/scoring">
                <Icon name="edit" size={13} />
                Edit scoring
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-x-7 gap-y-4 sm:grid-cols-2">
          {MOCK_SCORING_GROUPS.map((group) => (
            <div key={group.group}>
              <div className="fs-overline mb-2 text-[9px] text-n-3">
                {group.group}
              </div>
              {group.items.map((item) => (
                <div
                  key={item.label}
                  className="flex items-baseline justify-between gap-2.5 border-b border-n-4 py-1.5 text-[12px] font-bold"
                >
                  <span>{item.label}</span>
                  <span
                    className={cn(
                      'fs-num font-extrabold',
                      item.value < 0 && 'text-negative-strong',
                    )}
                  >
                    {item.value > 0 ? `+${item.value}` : item.value}{' '}
                    <span className="text-[10px] font-semibold text-n-3">
                      {item.abbr}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
