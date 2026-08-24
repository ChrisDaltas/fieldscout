import { redirect } from 'next/navigation'

import { DraftRoom } from '@/components/draft/draft-room'
import { mockRoomHref } from '@/components/draft/mock-launcher-entry'
import { createServerClient } from '@/lib/supabase/server'

export const metadata = { title: 'Draft room · FieldScout' }

interface DraftRoomPageProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<{ draft?: string | string[]; practice?: string | string[] }>
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Draft room (live) — REAL data only (M2 task L.B3.1; C25: the `?format=`
 * fixture switch is gone). The room resolves the league's active non-mock
 * draft by default; `?draft=<id>` targets a specific draft in THIS league —
 * the mock-room path (the L.B3.5 launcher routes here); `?practice=1` mounts
 * the §16.2 mock-draft-launcher instead of the room (mock-launcher-entry's
 * printed destination — L.B3.5). No draft ⇒ the room renders its honest "no
 * draft yet" state pointing back at the league home (the lobby/CTA surface —
 * L.B3.4).
 *
 * Only M2's snake/linear engine can reach `live` (draft_start refuses
 * auction naming M3), so one room component serves every reachable draft;
 * the auction room re-skin is M3's (tasks-M2 §11).
 */
export default async function DraftRoomPage({ params, searchParams }: DraftRoomPageProps) {
  const { leagueId } = await params
  const { draft, practice } = await searchParams
  const draftParam = Array.isArray(draft) ? draft[0] : draft
  const draftIdParam = draftParam && UUID_RE.test(draftParam) ? draftParam : undefined
  const practiceParam = Array.isArray(practice) ? practice[0] : practice

  // An old URL lands on the new route rather than on a dead end (MP.6 item
  // 6). `?draft=<id>` room links exist in the wild, and a STANDALONE mock's
  // id typed (or bookmarked) into one has no league to resolve against: the
  // room below would fall through to its "no draft" state on a league that
  // has nothing to do with the mock. `/app/mocks/[mockId]` is where that id
  // lives now, so send it there.
  //
  // The probe is deliberately narrow and leaks nothing: `league_id IS NULL`
  // + `is_mock`, under the caller's own RLS. A mock that is not theirs, a
  // league-attached id, and an unknown id all answer NO ROW and fall through
  // to the room unchanged — this arm can only ever redirect the one case it
  // is for.
  if (draftIdParam) {
    const supabase = await createServerClient()
    const { data: standalone } = await supabase
      .from('drafts')
      .select('id')
      .eq('id', draftIdParam)
      .eq('is_mock', true)
      .is('league_id', null)
      .maybeSingle()
    if (standalone) redirect(mockRoomHref(draftIdParam))
  }

  return (
    <DraftRoom
      leagueId={leagueId}
      draftIdParam={draftIdParam}
      practice={practiceParam === '1'}
    />
  )
}
