'use client'

// -----------------------------------------------------------------------------
// TEMPORARY DEV HARNESS — L.A2.3 scoring-template-picker preview (not a
// product route; same pattern as /app/dev/roster-builder). The real consumers
// are the create-wizard scoring step (L.A2.1) and the settings panel (L.A2.4);
// REMOVE this page when L.A2.4 wires the panel (PROGRESS ledger F26, extended
// to cover this route). Dev-only: 404s outside development.
//
// The mode buttons stub the PostgREST fetch for `scoring_systems` only (error
// 500 / empty [] / 3s-slow passthrough) so the §16.5.4 states are walkable in
// the browser without touching the stack — the stub lives HERE, never in the
// component or hook.
// -----------------------------------------------------------------------------
import { notFound } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'

import { ScoringTemplatePicker } from '@/components/leagues/scoring-template-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type Mode = 'live' | 'slow' | 'empty' | 'error'

/** Fresh client per mode switch. retry: 0 + networkMode 'always' (dev-only):
 *  the embedded preview pane fires spurious offline events that pause
 *  react-query retries indefinitely ("pending/paused"), so the harness
 *  fails fast — the stubbed error state renders on the first failure. */
function makeHarnessClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 0, refetchOnWindowFocus: false, networkMode: 'always' },
    },
  })
}

// -- window.fetch stub (dev harness only; the component/hook know nothing
//    about it). Patches the scoring_systems REST call per mode; everything
//    else passes through untouched. ---------------------------------------
let realFetch: typeof window.fetch | null = null

function restoreFetch() {
  if (realFetch) {
    window.fetch = realFetch
    realFetch = null
  }
}

function applyFetchStub(mode: Mode) {
  restoreFetch()
  if (mode === 'live') return
  const passthrough = window.fetch.bind(window)
  realFetch = window.fetch
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    if (url.includes('/rest/v1/scoring_systems')) {
      if (mode === 'error') {
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'dev-stubbed failure' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (mode === 'empty') {
        return Promise.resolve(
          new Response('[]', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      // slow: 3s delayed passthrough (shows the skeleton state)
      return new Promise((resolve) =>
        setTimeout(() => resolve(passthrough(input, init)), 3000),
      )
    }
    return passthrough(input, init)
  }
}

export default function ScoringPickerDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Harness />
}

function Harness() {
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('live')
  // A FRESH QueryClient per mode (dev-only): every mode switch remounts the
  // picker with an empty cache, so it refetches through the (un)stubbed
  // fetch with no cache interplay against the app-level client.
  const [queryClient, setQueryClient] = useState(() => makeHarnessClient())

  // Restore the real fetch if the harness unmounts mid-stub.
  useEffect(() => restoreFetch, [])

  // The embedded preview pane fires spurious offline events that latch
  // react-query's onlineManager offline and pause every (re)fetch. Pin it
  // online for the harness walk (dev-only).
  useEffect(() => {
    onlineManager.setOnline(true)
  })

  const switchMode = (next: Mode) => {
    // Patch SYNCHRONOUSLY, before the remounted picker's query fires.
    applyFetchStub(next)
    setQueryClient(makeHarnessClient())
    setMode(next)
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="yellow">dev harness</Badge>
        <span className="text-[12px] font-semibold text-n-3">
          L.A2.3 scoring-template-picker — temporary preview; removed when the
          settings panel (L.A2.4) embeds it (F26).
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['live', 'slow', 'empty', 'error'] as const).map((m) => (
          <Button
            key={m}
            type="button"
            variant={mode === m ? 'blue' : 'stroke'}
            size="sm"
            onClick={() => switchMode(m)}
          >
            {m}
          </Button>
        ))}
        <span className="text-[11px] font-semibold text-n-3">
          selection emitted: <span className="fs-num">{selected ?? 'none'}</span>
        </span>
      </div>

      <QueryClientProvider client={queryClient}>
        <ScoringTemplatePicker
          key={mode}
          value={selected}
          onChange={setSelected}
        />
      </QueryClientProvider>
    </div>
  )
}
