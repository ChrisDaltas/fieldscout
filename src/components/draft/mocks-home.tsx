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
 *   - **STANDALONE rows are no longer blocked at all — F119 is discharged.**
 *     MP.6c mounted the room at `/app/mocks/[mockId]` and MP.8 built
 *     `/app/mocks/[mockId]/report`, so both controls land somewhere. Each
 *     task removed its own reason and never touched the href, which is what
 *     made the hand-off checkable rather than remembered.
 *   - an UNFINISHED LEAGUE-attached row while `featureFlags.leagues` is OFF,
 *     whose *Rejoin* is real but silently redirects to `/app`. **A FINISHED
 *     one is not blocked**: its *View report* now goes to `/app/mocks/…`,
 *     which the leagues flag does not gate. **The flag read is a
 *     presentation decision made HERE, by the surface that knows which page
 *     it is** — never in `MockRow` (shared) and never in an authorization
 *     path (§4 rule 13 / D231(4)).
 *
 * The launch flow still does NOT navigate: it closes and the new mock appears
 * in the list below, now with a live *Rejoin* beside it.
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
          // Still no navigation, now by CHOICE rather than by absence
          // (MP.6c: the room exists). The dialog closes and the new run
          // appears in the list with a live *Rejoin* — the launcher decides
          // whether to walk in, which is also what MP.7's Home chip will
          // hand them. The mutation invalidates the `['mock-drafts', …]`
          // prefix, so the row is there before the dialog finishes closing.
          setLaunchOpen(false)
        }}
      />

      <PageHeader title="Mock drafts" actions={startButton} />

      {/* The shell header is `hidden lg:block`, so the header action above
          reaches nobody below `lg`. Mobile-first: the same control, rendered
          in the page, at the widths the header is not there.

          **MP.10: the TITLE rides in this row too.** Below `lg` the shell
          header takes the page name with it, and this page opened on a bare
          blue button with nothing naming the surface — measured at 375px
          against `/app/lists`, the launch scope's own reskinned page, which
          prints `<h3 className="mr-auto text-h5">Lists</h3>` in exactly this
          row (`lists-page-v2.tsx`). Same element, same tokens: the practice
          home was the one that had drifted, not the pattern. */}
      <div className="flex flex-wrap items-center gap-2.5 lg:hidden">
        <h3 className="mr-auto text-h5">Mock drafts</h3>
        {startButton}
      </div>

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
 * Colocated with the mount rather than inside `MockRow`, because the answer
 * is a fact about `/app/mocks` — which release flags this page is rendering
 * under. See `MocksHome`'s docblock.
 *
 * **One arm left, and it is a flag rather than a gap.** The "route does not
 * exist yet" arm is gone: MP.6c built the room and MP.8 built the report, so
 * a standalone row's controls all land somewhere. What survives is the
 * LEAGUE row whose *Rejoin* would walk into a hidden `/app/leagues` URL, and
 * it disappears the day the leagues flag is on.
 */
function openBlockedReason(row: MockDraftSummary): string | null {
  // **F119 is fully discharged.** MP.6c cleared the ROOM half
  // (`/app/mocks/[mockId]` mounts the real room), and MP.8 clears the REPORT
  // half by building `/app/mocks/[mockId]/report` — the reason is removed
  // rather than the link changed, exactly as D242 set it up. A standalone
  // row now has nowhere left to dead-end, so it has no reason at all.
  if (row.league_id === null) return null
  // A LEAGUE-attached row keeps ONE reason, and MP.8 narrowed it to the
  // control it is actually true of. *View report* now goes to
  // `/app/mocks/[mockId]/report` for EVERY mock (D230(4)), and that route is
  // gated on `mockDrafts` — the leagues flag cannot hide it. Only the
  // unfinished row's *Rejoin* / *Resume* still walks into `/app/leagues/…`,
  // which silently redirects to `/app` with the flag off.
  if (!featureFlags.leagues && row.status !== 'complete') {
    return 'This league is hidden right now.'
  }
  return null
}
