import { LeaguesIndex } from '@/components/leagues/leagues-index'

export const metadata = { title: 'Leagues · FieldScout' }

/**
 * Leagues index — real membership card grid (via `useLeagues`) + free create /
 * join (business rule 5 / Q6). M1 task L.A2.7.
 */
export default function LeaguesPage() {
  return <LeaguesIndex />
}
