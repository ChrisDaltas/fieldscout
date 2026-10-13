import Link from 'next/link'

import { PageHeader } from '@/components/layout/app-header'
import { Button } from '@/components/ui/button'

// Submission records don't exist yet (no submissions table/API) — this page
// is an honest empty state in the workspace language until they land.
export default function WeeklyRanksHistoryPage() {
  return (
    <>
      <PageHeader title="Rankings" />
      <section className="max-w-2xl">
        <div className="rounded-2xl border border-n-4 bg-white px-6 py-14 text-center">
          <h2 className="text-h6">No submissions yet</h2>
          <p className="mx-auto mt-1 max-w-md text-[11px] font-medium text-n-6">
            Locked weekly submissions will appear here once submission windows
            open. Pre draft snapshots live in the big board&apos;s history.
          </p>
          <div className="mt-4 flex items-center justify-center gap-1.5">
            <Button asChild variant="stroke" size="sm">
              <Link href="/app/weekly-ranks">Back to rankings</Link>
            </Button>
            <Button asChild variant="stroke" size="sm">
              <Link href="/app/big-board">Open the big board</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}
