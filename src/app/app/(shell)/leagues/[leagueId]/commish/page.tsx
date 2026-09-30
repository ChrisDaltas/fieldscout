import { redirect } from 'next/navigation'

import { CommishConsole } from '@/components/leagues/commish-console'
import { readCommishConsoleGate } from '@/lib/leagues/api/commish-console-gate'
import { createServerClient } from '@/lib/supabase/server'

export const metadata = { title: 'Commissioner · FieldScout' }

interface CommishConsolePageProps {
  params: Promise<{ leagueId: string }>
}

/**
 * The Commissioner Console — §16.1 `…/leagues/[id]/commish` (M6 task
 * L.E1.33; spec §10.1 as folded by v2.16.77: the launchpad — what needs the
 * commissioner now, one door per kind of tool, his last few actions;
 * PROGRESS D443, D457). A SHELL page under the `(shell)/leagues/layout.tsx`
 * flag gate.
 *
 * **Commissioners only, decided HERE on the server** before the client
 * mounts: a manager (or anyone who is not a commissioner / co-commissioner
 * of this league) is redirected to the league page — the task's "a manager
 * gets the league page, not the console". The nav door is hidden from them
 * too, but hiding a link is not the gate. The server still refuses every
 * commissioner read and verb on its own (`GET …/commish/summary`'s 403).
 */
export default async function CommishConsolePage({ params }: CommishConsolePageProps) {
  const { leagueId } = await params
  const supabase = await createServerClient()
  const gate = await readCommishConsoleGate(supabase, leagueId)
  if (gate !== 'console') redirect(`/app/leagues/${leagueId}`)
  return <CommishConsole leagueId={leagueId} />
}
