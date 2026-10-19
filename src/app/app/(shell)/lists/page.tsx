import { Suspense } from 'react'

import { ListsPageV2 } from '@/components/lists/v2/lists-page-v2'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileLists } from '@/components/mobile/lists/mobile-lists'
import { getCurrentNflWeek } from '@/lib/sports-data/nfl-state'

/**
 * Lists.
 *
 * **LV.7 (the cutover) removed the route-level branch LV.1.1 introduced.**
 * `featureFlags.listsV2` and `ListsPageLegacy` are gone; this route serves the
 * rebuilt page unconditionally, so there is no second Lists page to keep in
 * sync and no flag left to flip the wrong way.
 *
 * The mobile layout (FieldScout Mobile, lr-lists) renders its own Lists screens
 * — grid, List view, editor, Edit details — chosen by the same query string
 * (`?list=` is shared with desktop). Desktop is untouched.
 *
 * The `Suspense` boundary is required, not decorative: `ListsPageV2` reads
 * `?list=<id>` with `useSearchParams` — the deep link the retired
 * `/app/lists/[listId]` route now redirects into — and Next refuses to
 * prerender a route whose client tree calls that hook outside a boundary.
 *
 * The NFL week (the weekly-ranks page's own read, cached for an hour) names
 * the rankings the phone editor's Import a ranking sheet offers, and says
 * whether someone else's weekly ranking can be duplicated now (both layouts).
 */
export default async function ListsPage() {
  const currentWeek = await getCurrentNflWeek()
  return (
    <Suspense>
      <ByLayout
        desktop={<ListsPageV2 currentWeek={currentWeek} />}
        mobile={<MobileLists currentWeek={currentWeek} />}
      />
    </Suspense>
  )
}
