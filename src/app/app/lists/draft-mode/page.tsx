import { Suspense } from 'react'

import { DraftModeView } from '@/components/lists/draft-mode/draft-mode-view'

// The view reads ?folder=ID via useSearchParams, which requires a Suspense
// boundary for static prerendering of this route.
export default function DraftModePage() {
  return (
    <Suspense>
      <DraftModeView />
    </Suspense>
  )
}
