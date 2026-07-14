import { LeaguesIndex } from '@/components/leagues/leagues-index'

export const metadata = { title: 'Leagues · FieldScout' }

/**
 * Leagues index — membership card grid + Pro-gated create.
 *
 * TODO(live-draft): renders mock memberships until the league backend lands.
 */
export default function LeaguesPage() {
  return <LeaguesIndex />
}
