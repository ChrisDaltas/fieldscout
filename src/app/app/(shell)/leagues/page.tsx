import { LeaguesIndex } from '@/components/leagues/leagues-index'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileLeagues } from '@/components/mobile/leagues/mobile-leagues'

export const metadata = { title: 'Leagues · FieldScout' }

/**
 * Leagues index — real membership card grid (via `useLeagues`) + free create /
 * join (business rule 5 / Q6). M1 task L.A2.7.
 *
 * The phone draws its own screen on the same read and the same join and
 * create flows (`MobileLeagues`, gap list §4 item 104); desktop is unchanged.
 */
export default function LeaguesPage() {
  return <ByLayout desktop={<LeaguesIndex />} mobile={<MobileLeagues />} />
}
