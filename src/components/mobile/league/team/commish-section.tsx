'use client'

import Link from 'next/link'
import { useMemo } from 'react'

import { MEMBERS_NAV_LABEL, membersPageHref } from '@/components/leagues/invite-panel-ops'
import { autopilotSwitchShown, NO_SEAT_ROW_AUTOPILOT_COPY, noSeatRowAutopilotShown, RENAME_VIA_OVERRIDE_HINT } from '@/components/leagues/team-commish-ops'
import { MIcon } from '@/components/mobile/ui/m-icon'
import type { LeagueDetail } from '@/hooks/use-league'
import type { LeagueRosters, RosterTeam } from '@/lib/leagues/api/rosters-service'
import { cn } from '@/lib/utils'

import { MAutopilot, MCommishRename, MFaabEdit, MRosterTools } from './commish-tools'

/**
 * The commissioner's team tools on mobile — the desktop team page's set
 * (M6A: rename, per-team autopilot, FAAB edit, move / drop / add — all faces
 * of the ONE override-mode switch, turned on from League settings), kept
 * reachable under a "Commissioner" heading, plus the Members door — drawn
 * in the mobile design language (`commish-tools.tsx`) on the desktop's
 * hooks and words. Outside override mode it says how to get in; it never
 * offers a second switch.
 */
export function CommishSection({
  leagueId,
  detail,
  teamId,
  teamName,
  rosterTeam,
  rosters,
  inOverride,
  isOwnTeam,
  className,
}: {
  leagueId: string
  detail: LeagueDetail
  teamId: string
  teamName: string
  rosterTeam: RosterTeam | null
  rosters: LeagueRosters | undefined
  inOverride: boolean
  isOwnTeam: boolean
  className?: string
}) {
  const hasSeatRow = detail.members.some((m) => m.team_id === teamId)
  const otherTeams = useMemo(() => detail.teams.filter((t) => t.id !== teamId && t.status !== 'retired').map((t) => ({ id: t.id, name: t.name })), [detail.teams, teamId])
  const held = useMemo(() => new Set((rosters?.teams ?? []).flatMap((t) => t.roster.map((p) => p.player_id))), [rosters])
  return (
    <section className={cn('flex flex-col gap-3', className)} data-commish-section>
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Commissioner</h2>
      <Link href={membersPageHref(leagueId)} className="flex h-11 items-center gap-2 rounded-[14px] bg-m-b1 px-3 text-[14px] font-semibold active:bg-m-b2" data-door="members">
        <MIcon name="coowners" size={16} stroke={1.6} />
        <span className="flex-1">{MEMBERS_NAV_LABEL}</span>
        <MIcon name="chevronRight" size={14} stroke={2} className="text-m-t5" />
      </Link>
      {!inOverride ? (
        !isOwnTeam && <p className="text-[12px] font-medium text-m-t3">{RENAME_VIA_OVERRIDE_HINT} The same switch lets you set this team’s lineup and move its players.</p>
      ) : (
        <div className="flex flex-col gap-3 rounded-[14px] bg-m-b1 p-3" data-commish-tools>
          <p className="text-[12px] font-semibold text-m-tg">Override mode is on — your changes here are logged for the league.</p>
          <MCommishRename key={`rename:${teamId}`} leagueId={leagueId} teamId={teamId} teamName={teamName} />
          {rosterTeam && autopilotSwitchShown({ inOverride, managerUserId: rosterTeam.manager_user_id, status: rosterTeam.status, hasSeatRow }) && (
            <MAutopilot leagueId={leagueId} teamId={teamId} on={rosterTeam.autopilot} />
          )}
          {rosterTeam && noSeatRowAutopilotShown({ inOverride, hasSeatRow, status: rosterTeam.status }) && (
            <p className="text-[12px] font-medium text-m-t3">{NO_SEAT_ROW_AUTOPILOT_COPY}</p>
          )}
          {detail.settings.waiver_type === 'faab' && rosterTeam && (
            <MFaabEdit key={`faab:${teamId}`} leagueId={leagueId} teamId={teamId} teamName={teamName} balance={rosterTeam.faab_balance} />
          )}
          {rosterTeam && (
            <MRosterTools key={`tools:${teamId}`} leagueId={leagueId} teamId={teamId} teamName={teamName} roster={rosterTeam.roster} otherTeams={otherTeams} heldPlayerIds={held} />
          )}
        </div>
      )}
    </section>
  )
}
