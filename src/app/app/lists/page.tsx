import { Suspense } from 'react'

import { ListsPageV2 } from '@/components/lists/v2/lists-page-v2'

/**
 * Lists.
 *
 * **LV.7 (the cutover) removed the route-level branch LV.1.1 introduced.**
 * `featureFlags.listsV2` and `ListsPageLegacy` are gone; this route serves the
 * rebuilt page unconditionally, so there is no second Lists page to keep in
 * sync and no flag left to flip the wrong way.
 *
 * The `Suspense` boundary is required, not decorative: `ListsPageV2` reads
 * `?list=<id>` with `useSearchParams` — the deep link the retired
 * `/app/lists/[listId]` route now redirects into — and Next refuses to
 * prerender a route whose client tree calls that hook outside a boundary.
 */
export default function ListsPage() {
  return (
    <Suspense>
      <ListsPageV2 />
    </Suspense>
  )
}
