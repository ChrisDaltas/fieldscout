import { redirect } from 'next/navigation'

import { DraftRecap } from '@/components/draft/draft-recap'
import type { MockDraftLists } from '@/hooks/use-mock-drafts'
import { featureFlags } from '@/lib/feature-flags'
import { listMyMockDrafts } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

export const metadata = { title: 'Draft recap · FieldScout' }

interface DraftRecapPageProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<{ draft?: string | string[] }>
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Draft recap — §16.1 `/draft/recap`, real & mock (M2 task L.B3.5).
 * `?draft=<id>` targets a specific completed draft in THIS league (the mock
 * path — recaps are the launcher's, reached from the launcher list and the
 * mock room's completion moment); absent ⇒ the league's completed REAL
 * draft. Unknown/foreign/unfinished ids all land on one honest empty state
 * (no leak — the component's RLS-derived resolution).
 *
 * **MP.8 / D230(4) — a MOCK's `?draft=<id>` REDIRECTS to its report, and
 * never 404s.** A finished practice draft's home is now
 * `/app/mocks/[mockId]/report` (the flat table Chris asked for), and every
 * in-app link that used to point here for a mock moved in the same PR. This
 * arm is the RESIDUAL: URLs already in a browser history, a bookmark or a
 * chat message. The redirect is keyed on the launcher-scoped
 * `listMyMockDrafts`, which is exactly who the report renders for:
 *
 *  - the LAUNCHER of that mock is sent to the report;
 *  - anyone else — a league-mate who can read the mock under RLS but does
 *    not own it, and for whom the report would be empty — keeps the shipped
 *    recap, unchanged;
 *  - a REAL draft's id never matches (`listMyMockDrafts` filters
 *    `is_mock`), so **the league recap for a real draft is untouched**.
 *
 * The `featureFlags.mockDrafts` read is a PRESENTATION decision made by the
 * page that knows where it would send you, never an authorization one
 * (§4 rule 13 / D231(4) — the same shape as `mocks-home.tsx`'s
 * `openBlockedReason`, R519). With practice released and leagues on, a
 * launcher's mock goes to its report; with practice OFF, `/app/mocks/*`
 * redirects to `/app`, so redirecting into it would strand a user on a
 * recap that still works — this page keeps rendering it instead.
 */
export default async function DraftRecapPage({ params, searchParams }: DraftRecapPageProps) {
  const { leagueId } = await params
  const { draft } = await searchParams
  const draftParam = Array.isArray(draft) ? draft[0] : draft
  const draftIdParam = draftParam && UUID_RE.test(draftParam) ? draftParam : undefined

  if (draftIdParam && featureFlags.mockDrafts) {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const result = await listMyMockDrafts(supabase, user.id)
      if (result.status === 200) {
        const lists = result.body as unknown as MockDraftLists
        const mine = [...lists.active, ...lists.recaps].some((row) => row.id === draftIdParam)
        if (mine) redirect(`/app/mocks/${draftIdParam}/report`)
      }
    }
  }

  return <DraftRecap leagueId={leagueId} draftIdParam={draftIdParam} />
}
