'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

import { PlayersSpreadsheet } from '@/components/players/players-spreadsheet'

const VALID_POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const

export default function PlayersBrowserPage() {
  return (
    <Suspense fallback={null}>
      <Browser />
    </Suspense>
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
