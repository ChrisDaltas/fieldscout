'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

import { PageHeader } from '@/components/layout/app-header'
import { PlayersSpreadsheet } from '@/components/players/players-spreadsheet'

const VALID_POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const

/**
 * The canonical Players research surface (decision D2): the full stat table.
 * `/app/players` renders the same table until post-reskin consolidation.
 */
export default function ResearchPage() {
  return (
    <>
      <PageHeader title="Players" />
      <Suspense fallback={null}>
        <Research />
      </Suspense>
    </>
  )
}

function Research() {
  const searchParams = useSearchParams()
  const param = searchParams.get('position') ?? 'All'
  const position = (VALID_POSITIONS as readonly string[]).includes(param)
    ? (param as (typeof VALID_POSITIONS)[number])
    : 'All'
  return <PlayersSpreadsheet initialPosition={position} />
}
