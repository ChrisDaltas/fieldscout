import { PlaceholderPage } from '@/components/shared/placeholder-page'

/**
 * Lists v2 — Lists page.
 *
 * Route-level branch target for `featureFlags.listsV2` (LV.1.1,
 * delivery-plan-lists-v2.md §4). The real surface — page header, view-mode
 * segmented control, My lists / Saved tabs, rail and cards modes — lands
 * task by task starting at LV.2.1. This is a minimal placeholder that
 * proves the branch works; it is not the real screen.
 */
export function ListsPageV2() {
  return (
    <PlaceholderPage
      title="Lists v2"
      description="The rebuilt Lists page lands here task by task — see delivery-plan-lists-v2.md §4."
    />
  )
}
