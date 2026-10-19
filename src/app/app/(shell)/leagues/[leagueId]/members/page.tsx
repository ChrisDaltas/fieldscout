import { MembersPage } from '@/components/leagues/members-page'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileMembers } from '@/components/mobile/league/members/members-screen'

export const metadata = { title: 'Members · FieldScout' }

interface MembersRouteProps {
  params: Promise<{ leagueId: string }>
}

/**
 * The league's members — seats, seat invites, roles, remove / assign a
 * manager (M6 task L.E1.39; F539; PROGRESS D460). The same `InvitePanel`
 * League Home mounts before the draft, reachable after it from the
 * Commissioner Console and League Home's header. A SHELL page covered by
 * the `(shell)/leagues/layout.tsx` flag gate; the page is a client component
 * (`useLeague` gates membership first). Every commissioner control's verb
 * gates itself on the server; the panel offers them to commissioners only.
 *
 * On the phone it is League Menu › Members (gap list §4 item 106): the same
 * reads and actions in the phone's own screen (`MobileMembers`).
 */
export default async function LeagueMembersRoute({ params }: MembersRouteProps) {
  const { leagueId } = await params
  return <ByLayout desktop={<MembersPage leagueId={leagueId} />} mobile={<MobileMembers leagueId={leagueId} />} />
}
