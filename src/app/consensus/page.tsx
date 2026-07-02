import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { Card, CardContent } from '@/components/ui/card'

export const metadata: Metadata = {
  title: 'Community Consensus · FieldScout',
  description:
    "Cred-weighted consensus rankings from every FieldScout Big Board. Updates as users rank.",
}

export default function ConsensusPage() {
  return (
    <GuestShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Top Rankers
          </p>
          <h1 className="mt-1 text-2xl font-bold leading-tight">
            Community Consensus
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Cred-weighted aggregate rankings from every public Big Board on
            FieldScout. The more accurate your rankings, the more your votes count.
          </p>
        </header>
        <Card className="border-bg-elevated-2 bg-bg-elevated">
          <CardContent className="p-6 text-sm text-text-secondary">
            Consensus rankings unlock once enough users have submitted their
            Big Boards for the season. Sign up and add yours to be part of the
            first run.
          </CardContent>
        </Card>
      </div>
    </GuestShell>
  )
}
