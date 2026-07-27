'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { PageHeader } from '@/components/layout/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useScoringTemplates } from '@/hooks/use-scoring-templates'
import { toast } from '@/hooks/use-toast'
import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'

import { TeamCell } from './league-cells'

/**
 * Manage league — commissioner overview (M1 task L.A2.4). Real league data via
 * `useLeague`: the member roster, and read-only summaries of the roster,
 * waivers/trades, and scoring settings. Every "Edit" affordance links to the
 * full grouped settings panel (`/app/leagues/[leagueId]/settings`, L.A2.4) —
 * the summaries themselves stay read-only here.
 *
 * Boundary: member management (invite link, per-seat invite/remove) lands with
 * the invite panel + seat list (L.A2.5), which replaces the stubs below.
 */

// TODO(L.A2.5): stubs — the invite panel + seat list replace these.
function inviteStub() {
  toast({
    title: 'Invites are coming',
    description: 'The invite panel and seat list ship next (L.A2.5).',
  })
}

function removeStub(team: string) {
  toast({
    title: `${team} stays in the league`,
    description: 'Managing members ships with the seat list (L.A2.5).',
  })
}

const ROLE_LABELS: Record<string, string> = {
  commissioner: 'Commissioner',
  co_commissioner: 'Co-commissioner',
  manager: 'Manager',
}

export function LeagueManageView({ leagueId }: { leagueId: string }) {
  const router = useRouter()
  const { data, isPending, isError, refetch } = useLeague(leagueId)

  const settingsHref = `/app/leagues/${leagueId}/settings`

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

      <div className="flex items-center gap-2.5">
        <Button variant="stroke" size="sm" onClick={() => router.back()}>
          <Icon name="arrow-prev" size={13} />
          Back
        </Button>
        <Button variant="stroke" size="sm" asChild>
          <Link href={settingsHref}>
            <Icon name="setup" size={13} />
            League settings
          </Link>
        </Button>
      </div>

      {isPending ? (
        <div className="grid grid-cols-1 gap-[19px] lg:grid-cols-[1.4fr_1fr]">
          <Skeleton className="h-64 rounded-sm" />
          <Skeleton className="h-64 rounded-sm" />
        </div>
      ) : isError || !data ? (
        <Card className="border-negative bg-negative-soft">
          <CardContent className="flex flex-col items-start gap-2 p-4">
            <p className="text-[13px] font-bold" role="alert">
              Couldn&apos;t load this league.
            </p>
            <Button variant="stroke" size="sm" onClick={() => refetch()}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ManageContent data={data} settingsHref={settingsHref} />
      )}
    </div>
  )
}

function ManageContent({ data, settingsHref }: { data: LeagueDetail; settingsHref: string }) {
  const { user } = useAuth()
  const { data: templates } = useScoringTemplates()
  const { settings, members, teams, league } = data

  const teamsById = new Map(teams.map((t) => [t.id, t]))
  const templateName =
    templates?.find((t) => t.id === league.scoring_system_id)?.name ?? null

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-[19px] lg:grid-cols-[1.4fr_1fr]">
        {/* Members */}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <Badge variant="stroke">
              <span className="fs-num">{members.length}</span> / {settings.team_count} seats
            </Badge>
          </CardHeader>
          <div>
            {members.map((m, i) => {
              const teamName = m.team_id ? (teamsById.get(m.team_id)?.name ?? '—') : 'No team'
              const profile = m.profiles
              const manager = profile
                ? `${profile.display_name ?? profile.username} · @${profile.username}`
                : m.is_placeholder
                  ? 'Open seat'
                  : 'Unclaimed'
              const isMe = m.user_id != null && m.user_id === user?.id
              const isCommish = m.role === 'commissioner'
              return (
                <div
                  key={m.id}
                  className={cn(
                    'flex items-center gap-2.5 px-card-pad py-2',
                    i < members.length - 1 && 'border-b border-n-4',
                    isMe && 'bg-accent-soft',
                  )}
                >
                  <TeamCell team={teamName} sub={manager} className="mr-auto" />
                  <Badge variant="stroke">{ROLE_LABELS[m.role] ?? m.role}</Badge>
                  {!isCommish && !isMe && (
                    <Button variant="ghost" size="sm" onClick={() => removeStub(teamName)}>
                      Remove
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </Card>

        <div className="flex flex-col gap-[19px]">
          {/* Waivers & trades */}
          <Card>
            <CardHeader>
              <CardTitle>Waivers &amp; trades</CardTitle>
              <Button variant="stroke" size="sm" asChild>
                <Link href={settingsHref}>
                  <Icon name="edit" size={13} />
                  Edit
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {waiverSummary(settings).map((row) => (
                <SummaryLine key={row.label} label={row.label} value={row.value} />
              ))}
            </CardContent>
          </Card>

          {/* Roster slots */}
          <Card>
            <CardHeader>
              <CardTitle>Roster slots</CardTitle>
              <Button variant="stroke" size="sm" asChild>
                <Link href={settingsHref}>
                  <Icon name="edit" size={13} />
                  Edit
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {rosterSummary(settings).map((slot) => (
                <div key={slot.label} className="flex items-center gap-2.5 text-[12px] font-bold">
                  <span className="mr-auto">{slot.label}</span>
                  <span className="fs-num font-extrabold">{slot.count}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Scoring — edits happen in the settings panel. */}
      <Card>
        <CardHeader>
          <CardTitle>Scoring</CardTitle>
          <div className="flex items-center gap-2.5">
            {templateName && <Badge variant="stroke">{templateName}</Badge>}
            <Button variant="stroke" size="sm" asChild>
              <Link href={settingsHref}>
                <Icon name="edit" size={13} />
                Edit scoring
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-[12px] font-semibold text-n-3">
            {templateName
              ? `Scoring follows the ${templateName} template. Change it in League settings.`
              : 'Pick a scoring template in League settings.'}
          </p>
        </CardContent>
      </Card>
    </>
  )
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5 text-[12px] font-bold">
      <span className="whitespace-nowrap text-n-3">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary derivations (read-only; the panel owns editing)
// ---------------------------------------------------------------------------

const WAIVER_TYPE_LABELS: Record<string, string> = {
  faab: 'FAAB (blind bid)',
  rolling_priority: 'Rolling priority',
  reverse_standings: 'Reverse standings',
  none_fcfs: 'None (first come)',
}

const TRADE_REVIEW_LABELS: Record<string, string> = {
  none: 'Instant',
  commissioner: 'Commissioner',
  league_vote: 'League vote',
}

function waiverSummary(s: LeagueSettings): Array<{ label: string; value: string }> {
  return [
    { label: 'Waivers', value: WAIVER_TYPE_LABELS[s.waiver_type] ?? s.waiver_type },
    ...(s.waiver_type === 'faab' ? [{ label: 'FAAB budget', value: `$${s.faab_budget}` }] : []),
    { label: 'Trade review', value: TRADE_REVIEW_LABELS[s.trade_review] ?? s.trade_review },
    {
      label: 'Trade deadline',
      value: s.trade_deadline_week === null ? 'None' : `Week ${s.trade_deadline_week}`,
    },
  ]
}

function rosterSummary(s: LeagueSettings): Array<{ label: string; count: number }> {
  const roster = s.roster_settings
  const starters = roster.starting_slots
    .filter((slot) => slot.count > 0)
    .map((slot) => ({ label: slot.label, count: slot.count }))
  return [
    ...starters,
    { label: 'Bench', count: roster.bench },
    { label: 'IR', count: roster.ir_slots.length },
    ...(roster.swap_spots === 1 ? [{ label: 'Hot Swap', count: 1 }] : []),
  ]
}
