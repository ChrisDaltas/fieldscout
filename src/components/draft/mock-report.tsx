'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/hooks/use-auth'
import { useDraft, type DraftPickSummary } from '@/hooks/use-draft'
import { useDraftSeatNames } from '@/hooks/use-draft-seats'
import { useDeleteMockDraft } from '@/hooks/use-mock-drafts'
import { usePlayersByIds, type PlayerIdentity } from '@/hooks/use-players-by-ids'
import { toast } from '@/hooks/use-toast'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import { cn } from '@/lib/utils'
import type { Draft } from '@/types/database'

import { parseDraftOrder } from './draft-board-ops'
import {
  recapBuysInOrder,
  recapPicksByRound,
  recapRostersFromPicks,
  recapTeamOrder,
  recapTeamSpend,
  recapVariant,
  type RecapDraftedRow,
} from './draft-recap-ops'
import { PRACTICE_HOME_HREF } from './room-scope'

/**
 * The MOCK DRAFT REPORT — `/app/mocks/[mockId]/report` (MP task MP.8; spec
 * v2.16 §8.8; D230). Chris asked for exactly one thing:
 *
 *   *"a table of every player from the draft and their cost and what team
 *   they went to."*
 *
 * **A real table with headers, and TWO COLUMN SETS — never one table with
 * blanks** (D230(2)). An auction row is *player · position · team · price ·
 * nomination #*; a snake/linear row is *player · position · team · round ·
 * pick #*. A single five-column table would print an empty `price` on every
 * snake row and an empty `round` on every auction row, and **an empty column
 * claims the value exists and is unknown, which is false in both
 * directions.**
 *
 * **It composes the shipped derivations rather than re-solving them**
 * (D230(3); a second recap component tree is the LV.7 failure pattern):
 * `recapBuysInOrder` is the auction row set, `recapTeamSpend` the per-team
 * totals, `recapRostersFromPicks` + `recapTeamOrder` the grouping, and the
 * snake row set is `recapPicksByRound` — the one new pure derivation, added
 * to the same ops file with colocated tests.
 *
 * **It serves BOTH kinds of mock**, and that is what makes the legacy
 * redirect honest (D230(4)): `/app/leagues/[id]/draft/recap?draft=<mock_id>`
 * now redirects here for the launcher, so a league-attached mock's report has
 * to render. What it never does is offer a LEAGUE exit — F119's remaining
 * half: every way out of this page goes to `/app/mocks`.
 *
 * **No leak.** The route's server page resolves the id through the
 * launcher-scoped `listMyMockDrafts`, so someone else's mock, a mock that
 * never existed and a real draft's id are ONE answer. The arms below are the
 * belt on the same rule: an unreadable draft, a non-mock and an unfinished
 * one all render the same empty state, worded as *not here* rather than
 * *not yours*.
 */
export function MockDraftReport({ mockId }: { mockId: string }) {
  const { user } = useAuth()
  const room = useDraft(mockId)
  const draft = room.data?.draft ?? null

  const order = useMemo(() => parseDraftOrder(draft?.draft_order), [draft?.draft_order])
  const seats = useDraftSeatNames(order)
  const picks = useMemo(() => room.data?.picks ?? [], [room.data?.picks])
  const livePicks = useMemo(() => picks.filter((p) => !p.is_undone), [picks])
  const { playerById } = usePlayersByIds(
    useMemo(() => livePicks.map((p) => p.player_id), [livePicks]),
  )

  if (room.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Mock draft report" />
        <Skeleton className="h-9 rounded-sm" />
        <Skeleton className="h-64 rounded-sm" />
      </div>
    )
  }

  if (room.isError) {
    return (
      <ReportShell>
        <Card className="border-negative bg-negative-soft">
          <CardContent className="flex flex-col items-start gap-2 p-4">
            <p className="text-[13px] font-bold" role="alert">
              Couldn&apos;t load this report.
            </p>
            <p className="text-[12px] font-medium text-n-3">
              The draft didn&apos;t come back. Retry, or head back to your practice drafts.
            </p>
            <div className="flex items-center gap-2.5">
              <Button variant="stroke" size="sm" onClick={() => void room.refetch()}>
                <Icon name="reset" size={13} /> Retry
              </Button>
              <Button variant="stroke" size="sm" asChild>
                <Link href={PRACTICE_HOME_HREF}>Back to practice drafts</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </ReportShell>
    )
  }

  if (!draft || !draft.is_mock || draft.status !== 'complete') {
    // ONE honest empty state for every "no report": an id RLS won't show us,
    // a real draft's id, and a practice draft that hasn't finished. The page
    // must never be able to tell a stranger that the row exists.
    return <MockReportMissing />
  }

  return (
    <MockReportBody
      draft={draft}
      picks={picks}
      order={order}
      seatNames={seats.data?.namesById ?? new Map()}
      seatsMissing={seats.data?.missing ?? 0}
      playerById={playerById}
      userId={user?.id ?? null}
    />
  )
}

function ReportShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Mock draft report" />
      {children}
    </div>
  )
}

/**
 * The one no-leak empty state (unknown · foreign · unfinished · not a mock).
 * Exported because the ROUTE renders it too: the server page's
 * launcher-scoped lookup already answers "not here" without a client read,
 * and both surfaces must say the same words — a second copy is a second
 * story.
 */
export function MockReportMissing() {
  return (
    <ReportShell>
      <Card>
        <CardContent className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <Icon name="rocket" size={18} className="text-n-3" />
          <p className="text-h5 text-ink">No report here yet</p>
          <p className="max-w-md text-[13px] font-medium text-n-3">
            A report appears once a practice draft finishes. This one may still be running, or it
            may have been deleted.
          </p>
          <div className="mt-1">
            <Button variant="blue" size="sm" shadow asChild>
              <Link href={PRACTICE_HOME_HREF}>Back to practice drafts</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------
// The report body (a completed mock, resolved)
// ---------------------------------------------------------------------------

function MockReportBody({
  draft,
  picks,
  order,
  seatNames,
  seatsMissing,
  playerById,
  userId,
}: {
  draft: Draft
  picks: DraftPickSummary[]
  order: string[]
  seatNames: ReadonlyMap<string, string>
  seatsMissing: number
  playerById: ReadonlyMap<string, PlayerIdentity>
  userId: string | null
}) {
  const variant = recapVariant(draft, userId, null)
  const anchorTeamId = variant.kind === 'mock' ? variant.humanTeamId : null
  const isAuction = draft.draft_type === 'auction'

  const rosters = useMemo(() => recapRostersFromPicks(picks), [picks])
  const teamOrder = useMemo(
    () => recapTeamOrder(order, rosters, anchorTeamId),
    [order, rosters, anchorTeamId],
  )
  const buys = useMemo(() => recapBuysInOrder(picks), [picks])
  const drafted = useMemo(() => recapPicksByRound(picks, order.length), [picks, order.length])
  const rowCount = isAuction ? buys.length : drafted.length
  const totalSpent = useMemo(() => buys.reduce((sum, p) => sum + (p.price ?? 0), 0), [buys])

  const teamName = (teamId: string) => seatNames.get(teamId) ?? 'Team'

  // §8.8: delete belongs to the LAUNCHER alone — the RPC refuses everyone
  // else, and the UI must not offer it more widely (`recapVariant`'s
  // `canDelete`). Delete travels with the report, which is now the only
  // surface that owns a finished standalone mock.
  const actions = (
    <div className="flex flex-wrap items-center gap-1.5">
      {variant.kind === 'mock' && variant.canDelete && (
        <DeleteReportButton draftId={draft.id} leagueId={draft.league_id} />
      )}
      <Button variant="ghost" size="sm" asChild>
        <Link href={PRACTICE_HOME_HREF}>Back to practice drafts</Link>
      </Button>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Mock draft report" actions={actions} />

      {/* The shell header is `hidden lg:block`, so the actions above reach
          nobody below `lg` — and a page whose only way out and only delete
          live in an invisible header is the R340 dead end on a phone.
          Mobile-first: the same controls, in the page, at the widths the
          header is not there. `MocksHome` does exactly this for its Start
          control (MP.5). */}
      <div className="flex flex-wrap items-center gap-2.5 lg:hidden">{actions}</div>

      {seatsMissing > 0 && (
        // A short seat read is a BROKEN draft, not a small one — say so
        // rather than printing "Team" and letting it read as complete.
        <p className="text-[11px] font-semibold text-negative-strong" role="status">
          {seatsMissing} of {order.length} seats couldn&apos;t be read, so some rows show no team
          name.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isAuction ? 'Every buy' : 'Every pick'}</CardTitle>
          <span className="fs-overline text-[9px] text-n-3">
            {isAuction ? (
              <>
                <span className="fs-num">{rowCount}</span> {rowCount === 1 ? 'buy' : 'buys'} ·{' '}
                <span className="fs-num">${totalSpent}</span> spent
              </>
            ) : (
              <>
                <span className="fs-num">{rowCount}</span> {rowCount === 1 ? 'pick' : 'picks'} ·{' '}
                <span className="fs-num">{draft.total_rounds ?? 0}</span> rounds
              </>
            )}
          </span>
        </CardHeader>
        <CardContent>
          {rowCount === 0 ? (
            // Completed with nothing drafted — an ended-early practice run.
            <p className="text-[12px] font-medium text-n-3">
              {isAuction
                ? 'No player was bought before this draft ended.'
                : 'No player was drafted before this draft ended.'}
            </p>
          ) : isAuction ? (
            <AuctionReportTable
              buys={buys}
              teamName={teamName}
              playerById={playerById}
              anchorTeamId={anchorTeamId}
            />
          ) : (
            <SnakeReportTable
              rows={drafted}
              teamName={teamName}
              playerById={playerById}
              anchorTeamId={anchorTeamId}
            />
          )}
        </CardContent>
      </Card>

      {isAuction && rowCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What each team spent</CardTitle>
          </CardHeader>
          <CardContent>
            <TeamSpendTable
              teamOrder={teamOrder}
              rosters={rosters}
              teamName={teamName}
              playerById={playerById}
              anchorTeamId={anchorTeamId}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The two column sets (D230(2)) — two tables, never one with blank columns
// ---------------------------------------------------------------------------

/**
 * Wide content scrolls INSIDE its own container (CLAUDE.md's responsive
 * rule), the treatment `AuctionFinalBoard` already uses: a focusable
 * `role="region"` with an `aria-label`, so a keyboard user can scroll it.
 * `Table` brings its own `overflow-x-auto` wrapper, so the page body never
 * scrolls sideways. **No resting elevation** — a table is not an overlay.
 */
function ScrollRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="max-h-[560px] overflow-y-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  )
}

function PlayerCells({
  pick,
  playerById,
}: {
  pick: DraftPickSummary
  playerById: ReadonlyMap<string, PlayerIdentity>
}) {
  const player = playerById.get(pick.player_id)
  return (
    <>
      <TableCell className="font-bold">{player ? player.full_name : pick.player_id}</TableCell>
      <TableCell>
        {player ? (
          <PositionBadge position={player.position} size="sm" />
        ) : (
          <span className="text-[11px] font-semibold text-n-3">—</span>
        )}
      </TableCell>
    </>
  )
}

/** Auction: player · position · team · PRICE · NOMINATION #. */
function AuctionReportTable({
  buys,
  teamName,
  playerById,
  anchorTeamId,
}: {
  buys: DraftPickSummary[]
  teamName: (teamId: string) => string
  playerById: ReadonlyMap<string, PlayerIdentity>
  anchorTeamId: string | null
}) {
  return (
    <ScrollRegion label="Every player bought, in nomination order">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Player</TableHead>
            <TableHead>Pos</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Nom #</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {buys.map((pick) => (
            <TableRow key={pick.pick_number} className={anchorRow(pick.team_id, anchorTeamId)}>
              <PlayerCells pick={pick} playerById={playerById} />
              <TableCell className="font-semibold text-n-3">{teamName(pick.team_id)}</TableCell>
              <TableCell className="fs-num text-right font-extrabold">
                ${pick.price ?? 0}
              </TableCell>
              <TableCell className="fs-num text-right text-n-3">{pick.pick_number}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollRegion>
  )
}

/** Snake / linear: player · position · team · ROUND · PICK #. */
function SnakeReportTable({
  rows,
  teamName,
  playerById,
  anchorTeamId,
}: {
  rows: RecapDraftedRow[]
  teamName: (teamId: string) => string
  playerById: ReadonlyMap<string, PlayerIdentity>
  anchorTeamId: string | null
}) {
  return (
    <ScrollRegion label="Every player drafted, in pick order">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Player</TableHead>
            <TableHead>Pos</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">Round</TableHead>
            <TableHead className="text-right">Pick #</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ pick, round, pickInRound }) => (
            <TableRow key={pick.pick_number} className={anchorRow(pick.team_id, anchorTeamId)}>
              <PlayerCells pick={pick} playerById={playerById} />
              <TableCell className="font-semibold text-n-3">{teamName(pick.team_id)}</TableCell>
              <TableCell className="fs-num text-right font-bold">{round}</TableCell>
              <TableCell className="fs-num text-right text-n-3">
                {pick.pick_number}
                <span className="ml-1 text-[10px] text-n-3">({round}.{String(pickInRound).padStart(2, '0')})</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollRegion>
  )
}

/** Per-team spend — `recapTeamSpend` over the same grouping the rosters use. */
function TeamSpendTable({
  teamOrder,
  rosters,
  teamName,
  playerById,
  anchorTeamId,
}: {
  teamOrder: string[]
  rosters: ReadonlyMap<string, DraftPickSummary[]>
  teamName: (teamId: string) => string
  playerById: ReadonlyMap<string, PlayerIdentity>
  anchorTeamId: string | null
}) {
  return (
    <ScrollRegion label="What each team spent">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">Players</TableHead>
            <TableHead className="text-right">Spent</TableHead>
            <TableHead>Biggest buy</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {teamOrder.map((teamId) => {
            const teamPicks = rosters.get(teamId) ?? []
            const spend = recapTeamSpend(teamPicks)
            const biggest = spend.biggest ? playerById.get(spend.biggest.player_id) : undefined
            return (
              <TableRow key={teamId} className={anchorRow(teamId, anchorTeamId)}>
                <TableCell className="font-bold">
                  {teamName(teamId)}
                  {teamId === anchorTeamId && (
                    <Badge variant="stroke" className="ml-1.5">
                      Your seat
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="fs-num text-right">{teamPicks.length}</TableCell>
                <TableCell className="fs-num text-right font-extrabold">${spend.total}</TableCell>
                <TableCell className="font-semibold text-n-3">
                  {spend.biggest
                    ? `${biggest ? biggest.full_name : spend.biggest.player_id} · $${spend.biggest.price ?? 0}`
                    : '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </ScrollRegion>
  )
}

/** The viewer's own seat, marked by FILL — a resting state is never a shadow. */
function anchorRow(teamId: string, anchorTeamId: string | null): string {
  return cn(anchorTeamId !== null && teamId === anchorTeamId && 'bg-accent-soft')
}

// ---------------------------------------------------------------------------
// Delete (§8.8 "until the user deletes it") — launcher-keyed, and it travels
// with the report because this is where a finished practice draft now lives
// ---------------------------------------------------------------------------

function DeleteReportButton({ draftId, leagueId }: { draftId: string; leagueId: string | null }) {
  const router = useRouter()
  // `null` ⇒ `DELETE /api/mocks/[mockId]` (MP.5's standalone door); a league
  // id ⇒ the league sibling. One hook, the shipped branch — no new route.
  const deleteMock = useDeleteMockDraft(leagueId)
  const [open, setOpen] = useState(false)

  const handleDelete = () => {
    deleteMock
      .mutateAsync(draftId)
      .then(() => {
        router.push(PRACTICE_HOME_HREF)
      })
      .catch((error: unknown) => {
        setOpen(false)
        toast({
          title: "Couldn't delete the report",
          description:
            error instanceof LeagueActionError ? error.message : 'Something went wrong.',
          variant: 'destructive',
        })
      })
  }

  return (
    <>
      <Button variant="stroke" size="sm" onClick={() => setOpen(true)}>
        <Icon name="close" size={13} />
        Delete report
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this practice report?</DialogTitle>
            <DialogDescription>
              Every pick from this practice run goes away for good. It only ever was practice —
              nothing else is touched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMock.isPending}
              onClick={handleDelete}
            >
              {deleteMock.isPending ? 'Deleting…' : 'Delete report'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
