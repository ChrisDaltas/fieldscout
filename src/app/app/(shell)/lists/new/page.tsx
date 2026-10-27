import { Suspense } from 'react'

import { ListBuilder } from '@/components/lists/builder/list-builder'
import { ByLayout } from '@/components/mobile/by-layout'
import { NewListScreen } from '@/components/mobile/lists/list-details-screen'
import { getCurrentNflWeek } from '@/lib/sports-data/nfl-state'

// The mobile New list reads `?from=` (where its back goes) and `?step=` (its
// step 2, the editor) with `useSearchParams`, which Next requires inside a
// Suspense boundary. Step 2's Import a ranking sheet names rankings by the
// NFL week, as the Lists page's editor does.
export default async function NewListPage() {
  const currentWeek = await getCurrentNflWeek()
  return (
    <Suspense>
      <ByLayout desktop={<ListBuilder />} mobile={<NewListScreen currentWeek={currentWeek} />} />
    </Suspense>
  )
}
