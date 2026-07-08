import { redirect } from 'next/navigation'

// Teams live inside the league workspace (My Team tab) in the new IA, so the
// standalone teams index just forwards there. Individual teams open at
// /app/leagues/[leagueId]?tab=team.
export default function TeamsPage() {
  redirect('/app/leagues')
}
