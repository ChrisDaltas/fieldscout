import { MockDraftReport, MockReportMissing } from '@/components/draft/mock-report'
import { listMyMockDrafts } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'
import type { MockDraftLists, MockDraftSummary } from '@/hooks/use-mock-drafts'

export const metadata = { title: 'Mock draft report · FieldScout' }

interface MockReportPageProps {
  params: Promise<{ mockId: string }>
}

/**
 * `/app/mocks/[mockId]/report` — the MOCK DRAFT REPORT (MP task MP.8; spec
 * v2.16 §8.8; D230). Chris's first ask, in his words: *"a table of every
 * player from the draft and their cost and what team they went to."*
 *
 * **It is in `(shell)`, not `(room)`** — Q12's ruling, already applied to the
 * league recap: a report is not a draft surface, so it keeps the app chrome.
 * The gate above it is `(shell)/mocks/layout.tsx`'s `featureFlags.mockDrafts`
 * and nothing else (E79/D231), which is the whole reason `/app/mocks` is a
 * route family rather than a page under `/app/leagues`.
 *
 * **The resolution is the shipped launcher-scoped read** (`listMyMockDrafts`,
 * MP.5's `GET /api/mocks`), the same one `/app/mocks/[mockId]` uses — no new
 * server surface, and the no-leak posture comes free: **someone else's mock,
 * a mock that never existed and a real draft's id are ONE empty answer**
 * (the league recap's own posture, `recap/page.tsx:15–21`). An UNFINISHED
 * mock joins them, because a report of a draft in progress is not a thing
 * this page has.
 *
 * **It serves league-attached mocks too, deliberately** — that is what makes
 * D230(4)'s legacy redirect honest: `/app/leagues/[id]/draft/recap?draft=<mock>`
 * now sends the launcher here rather than to the league recap, so this page
 * has to render a league mock's report. It still offers no league exit
 * (F119): every way out goes to `/app/mocks`.
 */
export default async function MockReportPage({ params }: MockReportPageProps) {
  const { mockId } = await params

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // `src/app/app/layout.tsx` owns the auth guard above both route groups
  // (D147), so a null user here is the same "no report to show" answer an
  // unknown id gives — not a second case to handle.
  let mock: MockDraftSummary | null = null
  let failed = false
  if (user) {
    const result = await listMyMockDrafts(supabase, user.id)
    if (result.status !== 200) failed = true
    else {
      const lists = result.body as unknown as MockDraftLists
      mock = [...lists.active, ...lists.recaps].find((row) => row.id === mockId) ?? null
    }
  }

  // **A FAILED READ IS NOT AN EMPTY ONE** (CLAUDE.md: "never let 'nothing
  // happened' mean 'it worked'"). Only a read that SUCCEEDED and found
  // nothing is allowed to render the not-found; when the lookup itself
  // failed, the component mounts and its own client read decides — it has a
  // loud error arm with a retry, which is the honest answer to "we could not
  // look".
  if (!failed && mock === null) return <MockReportMissing />

  return <MockDraftReport mockId={mockId} />
}
