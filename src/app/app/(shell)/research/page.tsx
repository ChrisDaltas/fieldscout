'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

import { PageHeader } from '@/components/layout/app-header'
import { ByLayout } from '@/components/mobile/by-layout'
import { ResearchPlayersScreen, researchPosFromParam } from '@/components/mobile/players/research-players-screen'
import { PlayersSpreadsheet } from '@/components/players/players-spreadsheet'

const VALID_POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const

/**
 * The canonical Players research surface (decision D2): the full stat table.
 * `/app/players` renders the same table until post-reskin consolidation.
 * On the mobile layout it is the FieldScout Mobile account Players tab.
 */
export default function ResearchPage() {
  return (
    <ByLayout
      desktop={
        <>
          <PageHeader title="Players" />
          <Suspense fallback={null}>
            <Research />
          </Suspense>
        </>
      }
      mobile={
        <Suspense fallback={null}>
          <MobileResearch />
        </Suspense>
      }
    />
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

function MobileResearch() {
  const searchParams = useSearchParams()
  return <ResearchPlayersScreen initialPosition={researchPosFromParam(searchParams.get('position'))} />
}
