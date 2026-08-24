'use client'

import { useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useMyMockDrafts, type MockDraftSummary } from '@/hooks/use-mock-drafts'
import { featureFlags } from '@/lib/feature-flags'

import { MockRow } from './mock-draft-launcher'
import { MockLaunchDialog } from './mock-launch-dialog'
import {
  launchDisabledReason,
  MOCK_CAP_NOTE,
  MOCK_PAUSED_EXPIRY_NOTE,
  mockSeatCount,
} from './mock-launcher-ops'

/**
 * `/app/mocks` — the practice home (MP task MP.5; spec v2.16 §8.8, *"practice
 * is the purpose, a league is optional context"*).
 *
 * Every mock this user launched, active and finished, league-attached or
 * standalone, plus the affordance that starts a new one. It is the mount the
 * MP.4 launch dialog never had — the dev-only harness it was driven through
 * is deleted in the same commit (ledger F115).
 *
 * **Gated on `featureFlags.mockDrafts` and NOTHING else (D231; E79).** The
 * gate is the route's (`(shell)/mocks/layout.tsx`), not this component's, so
 * a flag never reaches an authorization path (§4 rule 13). With the leagues
 * flag OFF this page renders in full: it reads `/api/mocks`, which has no
 * league in the question, and mounts nothing league-scoped.
 *
 * **`MockRow` is the shipped row, given a prop rather than a copy** — this is
 * its third mount (the league launcher and the league-home card are the other
 * two) and the only change it needed was `leagueId: string | null`. A second
 * row treatment for the same object is the LV.7 failure pattern.
 *
 * **`openBlocked` is where this page is honest about what does not exist yet
 * (R515/R519), and it is a rendered state rather than a comment.** Two rows
 * can offer a control that goes nowhere, and both are disabled with the
 * reason printed on the row:
 *
 *   - a STANDALONE row, whose *Rejoin* / *View report* point at
 *     `/app/mocks/[mockId]` and `…/report` — **MP.6's and MP.8's routes**,
 *     which 404 until they land. The href stays (pointing it at the room's
 *     current `/app/leagues` URL is the workaround D231(3a) exists to
 *     prevent); the CONTROL waits.
 *   - a LEAGUE-attached row while `featureFlags.leagues` is OFF, whose link
 *     is real but silently redirects to `/app`. **The flag read is a
 *     presentation decision made HERE, by the surface that knows which page
 *     it is** — never in `MockRow` (shared) and never in an authorization
 *     path (§4 rule 13 / D231(4)).
 *
 * The launch flow therefore does NOT navigate: it closes and the new mock
 * appears in the list below.
 *
 * Copy is what-is-empty and what-a-control-does, never an explainer
 * (§4 rule 16).
 */
export function MocksHome() {
  const [launchOpen, setLaunchOpen] = useState(false)
  const mocks = useMyMockDrafts()

  const active = mocks.data?.active ?? []
  const recaps = mocks.data?.recaps ?? []

  // The §22.5 3-active pre-flight. Unlike the league launcher's — a PARTIAL
  // read of one league's actives (R280) — this list IS the set the RPC
  // counts (every active mock this user launched, league or not), so the
  // check is exact. The hourly cap stays server-only (D110(6)) and its
  // refusal surfaces verbatim inside the dialog.
  const capReason = mocks.isSuccess ? launchDisabledReason(active.length) : null

  const startButton = (
    <Button
      variant="blue"
      size="sm"
      shadow
      disabled={Boolean(capReason)}
      onClick={() => setLaunchOpen(true)}
    >
      <Icon name="rocket" size={13} />
      Start a mock draft
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      <MockLaunchDialog
        open={launchOpen}
        onOpenChange={setLaunchOpen}
        onLaunched={() => {
          // No navigation: MP.6 owns the room's route and it does not exist
          // yet (see the docblock). The launch mutation invalidates the
          // `['mock-drafts', …]` prefix, so the new run lands in the list.
          setLaunchOpen(false)
        }}
      />

      <PageHeader title="Mock drafts" actions={startButton} />

      {/* The shell header is `hidden lg:block`, so the header action above
          reaches nobody below `lg`. Mobile-first: the same control, rendered
          in the page, at the widths the header is not there. */}
      <div className="flex flex-wrap items-center gap-2.5 lg:hidden">{startButton}</div>

      {capReason && (
        <p className="text-[11px] font-semibold text-negative-strong" role="status">
          {capReason}
        </p>
      )}

      {mocks.isPending ? (
        <div className="flex flex-col gap-2.5" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[52px] rounded-sm" />
          ))}
        </div>
      ) : mocks.isError ? (
        <Card className="border-negative bg-negative-soft">
          <CardContent className="flex flex-col items-start gap-2 p-4">
            <p className="text-[13px] font-bold" role="alert">
              Couldn&apos;t load your practice drafts.
            </p>
            <Button variant="stroke" size="sm" onClick={() => void mocks.refetch()}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : active.length === 0 && recaps.length === 0 ? (
        // Every new user's first visit, so the empty state IS the launch
        // affordance rather than a notice beside one (§4 rule 14).
        <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <Icon name="rocket" size={18} className="text-n-3" />
          <p className="text-h5 text-ink">No practice drafts yet</p>
          <p className="max-w-md text-[13px] font-medium text-n-3">
            Your runs and their reports will list here.
          </p>
          <div className="mt-1 flex items-center gap-2.5">{startButton}</div>
          <span className="text-[10px] font-medium text-n-3">{MOCK_CAP_NOTE}</span>
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <MockSection title="In progress" rows={active} note={MOCK_PAUSED_EXPIRY_NOTE} />
          )}
          {recaps.length > 0 && <MockSection title="Finished" rows={recaps} note={null} />}
        </>
      )}
    </div>
  )
}

/**
 * One list section. Split in two — *In progress* and *Finished* — because
 * they are answers to different questions (what can I go back to / what did
 * I do), and the expiry note is only true of one of them. Long lists simply
 * grow: the shell owns the page scroll, rows are fixed-height and truncate,
 * and the §22.5 cap bounds the top section at three.
 */
function MockSection({
  title,
  rows,
  note,
}: {
  title: string
  rows: MockDraftSummary[]
  note: string | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title} <span className="fs-num text-n-3">{rows.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <MockRow
            key={row.id}
            leagueId={row.league_id}
            // No league to read a seat count from here: a standalone row
            // carries its own in `config.mock.cpu_seats` (095), and a
            // league-attached row honestly reports none.
            seatCount={mockSeatCount(row, null)}
            openBlocked={openBlockedReason(row)}
            row={row}
          />
        ))}
        {note && <p className="text-[10px] font-medium text-n-3">{note}</p>}
      </CardContent>
    </Card>
  )
}

/**
 * Why a listed mock's open control cannot be used from THIS page, or null.
 * Colocated with the mount rather than inside `MockRow`, because both answers
 * are facts about `/app/mocks` — where the route does not exist yet, and which
 * release flags this page is rendering under. See `MocksHome`'s docblock.
 *
 * Both arms are TEMPORARY by construction: MP.6/MP.8 delete the first by
 * building the routes, and the second disappears the day the leagues flag is
 * on — neither needs a decision later, only a route or a flag.
 */
function openBlockedReason(row: MockDraftSummary): string | null {
  if (row.league_id === null) return 'Opens when the practice room lands.'
  if (!featureFlags.leagues) return 'This league is hidden right now.'
  return null
}
