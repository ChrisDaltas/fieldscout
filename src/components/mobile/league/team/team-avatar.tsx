import { cn } from '@/lib/utils'

import { teamAvClass, teamInitial } from './team-ops'

/**
 * The handoff's team avatar: a circle in the team's colour with a white
 * initial (or "1" / "2" when names are hidden for a screenshot). Your own
 * team is the accent blue; every other team takes the palette in league
 * order — the Match / League tabs' rule (`teamAvClass`), so a team keeps one
 * colour on every screen.
 */
export function TeamAvatar({
  teamId,
  name,
  teamIds,
  myTeamId,
  size,
  fontSize,
  label,
  className,
}: {
  teamId: string
  name: string | null | undefined
  /** The league's team ids in league order (`teamOrder(detail.teams)`). */
  teamIds: readonly string[]
  /** The viewer's own team — always the accent blue. */
  myTeamId: string | null
  size: number
  fontSize: number
  /** Replaces the initial (the hide-names toggles show "1" / "2"). */
  label?: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex flex-none items-center justify-center rounded-full font-semibold text-white', teamAvClass(teamId, teamIds, myTeamId), className)}
      style={{ width: size, height: size, fontSize }}
      data-team-avatar={teamId}
    >
      {label ?? teamInitial(name)}
    </span>
  )
}
