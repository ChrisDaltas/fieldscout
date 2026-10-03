import { LeagueShell } from '@/components/leagues/league-shell'

interface LeagueLayoutProps {
  children: React.ReactNode
  params: Promise<{ leagueId: string }>
}

/**
 * The league workspace — ONE header for every league page, in every league
 * state (League UX batch 1, Chris 2026-10-03): the identity row and the
 * league sub-nav (Home · My Team · Matchup · Players · Schedule · Stats ·
 * More), claimed into the app shell's single sticky header. Pages render no
 * header, back button or nav of their own.
 *
 * Server layout; the header itself is a client component over the same
 * league-detail query every page already reads (one fetch, kept live by the
 * league channel), so a status change (draft starts, season begins) updates
 * the tabs without a reload. Membership is still decided by each page and
 * by the server's reads — the header only shows what the detail returns.
 *
 * The live draft room is NOT under this layout — it is chrome-free in
 * `(room)/leagues/[leagueId]/draft`.
 */
export default async function LeagueLayout({ children, params }: LeagueLayoutProps) {
  const { leagueId } = await params
  return <LeagueShell leagueId={leagueId}>{children}</LeagueShell>
}
