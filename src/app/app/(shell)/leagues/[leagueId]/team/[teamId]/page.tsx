import { TeamPage } from '@/components/leagues/team-page'

export const metadata = { title: 'Team · FieldScout' }

interface TeamPageProps {
  params: Promise<{ leagueId: string; teamId: string }>
}

/**
 * Team / roster + weekly lineup — §16.1 `…/leagues/[id]/team/[teamId]` (M4
 * task L.D5.1). A SHELL page: the chrome-free treatment is the live draft
 * surface's alone (§16.1 v2.12 — the lobby and the room), and this is a
 * reading-and-editing page like settings and the recap. The
 * `(shell)/leagues/layout.tsx` flag gate (`featureFlags.leagues`) covers
 * it. Server shell; the page is a client component (`useLeague` gates
 * membership before anything else mounts — D316).
 */
export default async function LeagueTeamPage({ params }: TeamPageProps) {
  const { leagueId, teamId } = await params
  return <TeamPage leagueId={leagueId} teamId={teamId} />
}
