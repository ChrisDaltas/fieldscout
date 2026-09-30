import { MembersPage } from '@/components/leagues/members-page'

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
 */
export default async function LeagueMembersRoute({ params }: MembersRouteProps) {
  const { leagueId } = await params
  return <MembersPage leagueId={leagueId} />
}
