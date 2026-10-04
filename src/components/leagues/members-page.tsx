'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { useLeague } from '@/hooks/use-league'

import { InvitePanel } from './invite-panel'
import { MEMBERS_INTRO_COMMISH, MEMBERS_INTRO_MEMBER, MEMBERS_TITLE } from './invite-panel-ops'
import { ProblemCard, problemCopy } from './team-page'
import { LeaguePageTitle } from './league-cells'

/**
 * The league's members — `/app/leagues/[id]/members` (M6 task L.E1.39;
 * F539; spec §7.2 / §7.2.1, §16.5's "Replace a GM" row; PROGRESS D460).
 *
 * **One panel, not a new one.** The page hosts the SAME `InvitePanel` League
 * Home mounts before the draft and the draft room mounts in Draft Options —
 * seats, seat invites, assign, roles, remove — so after the draft a
 * commissioner can still change who runs a team (standing rule (a): a verb
 * he cannot reach is a defect). The panel offers each control only where its
 * verb accepts it in the league's state (`memberControls`).
 *
 * **Who sees what.** Any member of the league may open it: a commissioner or
 * co-commissioner gets the controls; everyone else gets the panel's own
 * read-only list (and "Leave league" on their own seat — `leave_league`
 * accepts in every state). Every control's verb gates itself on the server;
 * the panel never offers a commissioner control to a manager
 * (`canManage` = the league detail's `my_role`).
 *
 * A SHELL page under the `(shell)/leagues/layout.tsx` flag gate; `useLeague`
 * answers membership first (a non-member gets the league's own refusal).
 */
export function MembersPage({ leagueId }: { leagueId: string }) {
  const league = useLeague(leagueId)
  if (league.isPending) {
    return (
      <div className="flex flex-col gap-4" data-members-loading>
        <LeaguePageTitle title={MEMBERS_TITLE} />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (league.isError || !league.data) {
    return (
      <ProblemCard
        heading={MEMBERS_TITLE}
        title="Couldn’t load this league."
        detail={problemCopy(league.error)}
        onRetry={() => league.refetch()}
        leagueId={null}
      />
    )
  }
  const detail = league.data
  const isCommish = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  return (
    <div className="flex flex-col gap-4" data-members-page>
      <LeaguePageTitle title={MEMBERS_TITLE} />
      <p className="-mt-2 text-[11px] font-medium text-n-3" data-members-intro>
        {isCommish ? MEMBERS_INTRO_COMMISH : MEMBERS_INTRO_MEMBER}
      </p>
      <InvitePanel leagueId={leagueId} detail={detail} />
    </div>
  )
}
