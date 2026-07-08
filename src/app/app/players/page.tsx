'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

import { PageHeader } from '@/components/layout/app-header'
import { PlayersSpreadsheet } from '@/components/players/players-spreadsheet'

const VALID_POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const

/**
 * Players browse — currently the same stat table as `/app/research` (which is
 * the canonical surface per decision D2). Kept as-is during the reskin;
 * consolidation is a post-reskin task.
 */
export default function PlayersBrowserPage() {
  return (
    <>
      <PageHeader title="Players" />
      <Suspense fallback={null}>
        <Browser />
      </Suspense>
    </>
  )
}

function Browser() {
  const searchParams = useSearchParams()
  const param = searchParams.get('position') ?? 'All'
  const position = (VALID_POSITIONS as readonly string[]).includes(param)
    ? (param as (typeof VALID_POSITIONS)[number])
    : 'All'
  return <PlayersSpreadsheet initialPosition={position} />
}
