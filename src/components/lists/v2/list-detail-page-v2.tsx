import { PlaceholderPage } from '@/components/shared/placeholder-page'

interface ListDetailPageV2Props {
  listId: string
}

/**
 * Lists v2 — list detail.
 *
 * Route-level branch target for `featureFlags.listsV2` (LV.1.1,
 * delivery-plan-lists-v2.md §4). The real surface — hero, tabs, toolbar,
 * and the three view styles — lands task by task starting at LV.3.1. This
 * is a minimal placeholder that proves the branch works; it is not the
 * real screen.
 */
export function ListDetailPageV2({ listId }: ListDetailPageV2Props) {
  return (
    <PlaceholderPage
      title="List detail v2"
      description="The rebuilt list detail screen lands here task by task — see delivery-plan-lists-v2.md §4."
    >
      List ID: <span className="fs-num text-[11px]">{listId}</span>
    </PlaceholderPage>
  )
}
