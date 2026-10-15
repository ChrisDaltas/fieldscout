import { Suspense } from 'react'

import { ListBuilder } from '@/components/lists/builder/list-builder'
import { ByLayout } from '@/components/mobile/by-layout'
import { NewListScreen } from '@/components/mobile/lists/list-details-screen'

// The mobile New list reads `?from=` (where its back goes) with
// `useSearchParams`, which Next requires inside a Suspense boundary.
export default function NewListPage() {
  return (
    <Suspense>
      <ByLayout desktop={<ListBuilder />} mobile={<NewListScreen />} />
    </Suspense>
  )
}
