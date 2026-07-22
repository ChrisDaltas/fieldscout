'use client'

// -----------------------------------------------------------------------------
// TEMPORARY DEV HARNESS — L.A2.2 roster-slot-builder preview (not a product
// route). The real consumers are the create-wizard roster step (L.A2.1) and
// the settings panel (L.A2.4); REMOVE this page when L.A2.4 wires the panel
// (PROGRESS ledger F26). Dev-only: 404s outside development.
// -----------------------------------------------------------------------------
import { notFound } from 'next/navigation'
import { useState } from 'react'

import { RosterSlotBuilder } from '@/components/leagues/roster-slot-builder'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DEFAULT_ROSTER_SETTINGS,
  type RosterSettings,
} from '@/lib/leagues/settings/league-settings'

export default function RosterBuilderDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Harness />
}

function Harness() {
  const [value, setValue] = useState<RosterSettings>(() =>
    structuredClone(DEFAULT_ROSTER_SETTINGS),
  )

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="yellow">dev harness</Badge>
        <span className="text-[12px] font-semibold text-n-3">
          L.A2.2 roster-slot-builder — temporary preview; removed when the settings panel
          (L.A2.4) embeds it.
        </span>
        <Button
          type="button"
          variant="stroke"
          size="sm"
          onClick={() => setValue(structuredClone(DEFAULT_ROSTER_SETTINGS))}
        >
          Reset to default
        </Button>
      </div>

      <RosterSlotBuilder value={value} onChange={setValue} teamCount={12} />

      <details className="rounded-sm border border-ink bg-white p-3">
        <summary className="cursor-pointer text-[13px] font-bold">
          Emitted roster_settings JSONB (live)
        </summary>
        <pre className="fs-num mt-2 overflow-x-auto text-[11px] leading-relaxed">
          {JSON.stringify(value, null, 2)}
        </pre>
      </details>
    </div>
  )
}
