'use client'

import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMemo, useState } from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useCancelClaim } from '@/hooks/use-cancel-claim'
import { useEditClaim } from '@/hooks/use-edit-claim'
import { useReorderClaims } from '@/hooks/use-reorder-claims'
import { useWaiverClaims } from '@/hooks/use-waiver-claims'
import type { WaiverClaimView, WaiverClaimsDocument } from '@/lib/leagues/api/waivers-service'
import { cn } from '@/lib/utils'

import {
  canDragOnto,
  claimOutcome,
  claimsInRunOrder,
  draggableIds,
  dropPlace,
  faabLeftCopy,
  parseBid,
  type ClaimOutcome,
} from './waiver-claims-ops'

/**
 * `waiver-claims-panel` — spec §16.2 ("my pending claims: FAAB amounts, drag
 * claim_order, conditional drops, cancel (§13.2)") and §16.5.2's Waivers row
 * (pending · won / lost with reason) — M5 task L.D2.13 (PROGRESS F432, D414).
 *
 * **The order shown is the order the run uses** (F432): in a FAAB league the
 * biggest bid first and the team's own order only between equal bids, so a
 * drag is offered only inside an equal-bid group (150 refuses a smaller bid
 * above a bigger one by name). The drag is OPTIMISTIC — `useReorderClaims`
 * rolls back on a refusal and re-reads; the edit and cancel are not.
 *
 * **Bids are blind** (E13): this panel reads the viewer's OWN team's claims
 * (the route's default) — never another team's.
 *
 * States (§16.5.4): skeleton · empty with the reason · error with retry ·
 * the verb's refusal verbatim.
 */
export function WaiverClaimsPanel({ leagueId, nextRunLocal }: { leagueId: string; nextRunLocal: string | null }) {
  const claims = useWaiverClaims(leagueId, { status: 'all' })
  const reorder = useReorderClaims(leagueId)
  const edit = useEditClaim(leagueId)
  const cancel = useCancelClaim(leagueId)
  const [last, setLast] = useState<'reorder' | 'edit' | 'cancel' | null>(null)
  const spoke = last === 'reorder' ? reorder : last === 'edit' ? edit : last === 'cancel' ? cancel : null
  return (
    <WaiverClaimsPanelView
      doc={claims.data ?? null}
      loading={claims.isPending && !claims.data}
      error={claims.isError && !claims.data ? (claims.error instanceof Error ? claims.error.message : 'The claims read failed.') : null}
      onRetry={() => void claims.refetch()}
      nextRunLocal={nextRunLocal}
      pending={reorder.isPending || edit.isPending || cancel.isPending}
      refusal={spoke?.error?.message ?? null}
      onMove={(claimId, place) => {
        setLast('reorder')
        reorder.move(claimId, place)
      }}
      onEditBid={(claim, bid) => {
        setLast('edit')
        edit.edit(claim.id, { faab_bid: bid, drop_player_id: claim.drop?.player_id ?? null })
      }}
      onCancel={(claim) => {
        setLast('cancel')
        cancel.cancel(claim.id)
      }}
    />
  )
}

export const CLAIMS_EMPTY_COPY = 'No pending claims. Claim a player from the list below — claims are settled at the next waiver run.'
export const CLAIMS_ERROR_TITLE = 'Couldn’t load your waiver claims.'
/** How many settled claims the panel keeps on screen. */
export const RESULTS_SHOWN = 8

export function WaiverClaimsPanelView({
  doc,
  loading,
  error,
  onRetry,
  nextRunLocal,
  pending,
  refusal,
  onMove,
  onEditBid,
  onCancel,
}: {
  doc: WaiverClaimsDocument | null
  loading: boolean
  error: string | null
  onRetry: () => void
  nextRunLocal: string | null
  pending: boolean
  refusal: string | null
  onMove: (claimId: string, place: number) => void
  onEditBid: (claim: WaiverClaimView, bid: number) => void
  onCancel: (claim: WaiverClaimView) => void
}) {
  const waiverType = doc?.waiver_type ?? null
  const ordered = useMemo(() => claimsInRunOrder(doc?.claims ?? [], waiverType), [doc, waiverType])
  const settled = useMemo(() => (doc?.claims ?? []).filter((c) => c.status !== 'pending').slice(0, RESULTS_SHOWN), [doc])
  const draggable = useMemo(() => draggableIds(ordered, waiverType), [ordered, waiverType])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const faab = waiverType === 'faab'

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || pending) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (!canDragOnto(ordered, activeId, overId, waiverType)) return
    const place = dropPlace(doc?.claims ?? [], overId)
    if (place !== null) onMove(activeId, place)
  }

  return (
    <Card data-waiver-claims-panel>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-[12px]">
          Your waiver claims
          {doc && (
            <span className="ml-auto text-[11px] font-medium text-n-3" data-claims-budget>
              {faab
                ? faabLeftCopy(doc.faab_balance, doc.faab_budget)
                : doc.waiver_priority !== null
                  ? `Waiver priority #${doc.waiver_priority}`
                  : 'Waiver priority set at the first run'}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-card-pad py-3">
        {loading ? (
          <div className="flex flex-col gap-1.5" data-skeleton="claims">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-10 rounded-sm" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2" role="alert" data-claims-error>
            <p className="text-[12px] font-bold">{CLAIMS_ERROR_TITLE}</p>
            <p className="text-[11px] font-medium text-n-3">{error}</p>
            <Button variant="stroke" size="sm" onClick={onRetry}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          </div>
        ) : (
          <>
            {refusal && (
              <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink" data-claims-refusal>
                {refusal}
              </p>
            )}
            {ordered.length === 0 ? (
              <p className="text-[12px] font-medium text-n-3" data-empty="claims">
                {CLAIMS_EMPTY_COPY}
              </p>
            ) : (
              <>
                <p className="text-[11px] font-medium text-n-3">
                  {faab
                    ? 'Tried biggest bid first; drag to order claims with the same bid.'
                    : 'Tried top to bottom; drag to change the order.'}
                  {nextRunLocal ? ` Next run: ${nextRunLocal}.` : ''}
                </p>
                <DndContext sensors={sensors} onDragEnd={onDragEnd}>
                  <SortableContext items={ordered.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    <ol className="flex flex-col gap-1" data-claims-pending>
                      {ordered.map((claim, i) => (
                        <PendingClaimRow
                          key={claim.id}
                          claim={claim}
                          rank={i + 1}
                          faab={faab}
                          draggable={draggable.has(claim.id) && !pending}
                          pending={pending}
                          onEditBid={onEditBid}
                          onCancel={onCancel}
                        />
                      ))}
                    </ol>
                  </SortableContext>
                </DndContext>
              </>
            )}
            {settled.length > 0 && (
              <div className="flex flex-col gap-1 border-t border-n-4 pt-2" data-claims-results>
                <p className="fs-overline text-[9px] text-n-3">Recent results</p>
                <ul className="flex flex-col gap-1">
                  {settled.map((claim) => (
                    <SettledClaimRow key={claim.id} claim={claim} outcome={claimOutcome(claim, waiverType)} />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ClaimPlayers({ claim }: { claim: WaiverClaimView }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-w-0 items-center gap-1.5">
        {claim.add.position && <PositionBadge position={claim.add.position} size="sm" />}
        <span className="truncate text-[12px] font-bold text-ink">{claim.add.full_name ?? claim.add.player_id}</span>
      </span>
      <span className="truncate text-[10px] font-medium text-n-3">
        {claim.drop ? `Drop ${claim.drop.full_name ?? claim.drop.player_id}` : 'No drop'}
      </span>
    </span>
  )
}

function PendingClaimRow({
  claim,
  rank,
  faab,
  draggable,
  pending,
  onEditBid,
  onCancel,
}: {
  claim: WaiverClaimView
  rank: number
  faab: boolean
  draggable: boolean
  pending: boolean
  onEditBid: (claim: WaiverClaimView, bid: number) => void
  onCancel: (claim: WaiverClaimView) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: claim.id, disabled: !draggable })
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(String(claim.faab_bid))
  const bid = parseBid(text)
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-sm border border-n-4 bg-white px-2 py-1.5',
        // A drag ghost is a true overlay — its lift is the one resting shadow here.
        isDragging && 'shadow-hard-4',
      )}
      data-claim={claim.id}
      data-claim-rank={rank}
    >
      {draggable ? (
        <button type="button" className="cursor-grab text-n-3 hover:text-ink" aria-label={`Drag to reorder ${claim.add.full_name ?? 'claim'}`} {...attributes} {...listeners} data-claim-drag>
          <Icon name="dots-vertical" size={13} />
        </button>
      ) : (
        <span className="w-[13px]" aria-hidden="true" />
      )}
      <span className="fs-num w-4 text-right text-[11px] font-bold text-n-3">{rank}</span>
      <ClaimPlayers claim={claim} />
      {faab &&
        (editing ? (
          <span className="flex items-center gap-1">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              inputMode="numeric"
              aria-label="New bid in dollars"
              className="h-btn-sm w-16 px-2 text-[12px]"
            />
            <Button
              variant="blue"
              size="sm"
              disabled={pending || bid === null || bid === claim.faab_bid}
              onClick={() => {
                if (bid === null) return
                onEditBid(claim, bid)
                setEditing(false)
              }}
            >
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <button
            type="button"
            className="fs-num rounded-sm border border-ink px-2 py-0.5 text-[12px] font-bold hover:bg-ink hover:text-white"
            onClick={() => {
              setText(String(claim.faab_bid))
              setEditing(true)
            }}
            disabled={pending}
            title="Change this bid"
            data-claim-bid={claim.faab_bid}
          >
            ${claim.faab_bid}
          </button>
        ))}
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => onCancel(claim)} data-claim-cancel>
        Cancel
      </Button>
    </li>
  )
}

function SettledClaimRow({ claim, outcome }: { claim: WaiverClaimView; outcome: ClaimOutcome }) {
  return (
    <li className="flex items-start gap-2 px-1 py-1" data-claim-result={claim.status}>
      <Badge
        variant={outcome.tone === 'positive' ? 'stroke-green' : outcome.tone === 'negative' ? 'stroke-pink' : 'stroke'}
        className="shrink-0"
      >
        {outcome.label}
      </Badge>
      <span className="flex min-w-0 flex-1 flex-col">
        <ClaimPlayers claim={claim} />
        {outcome.detail && <span className="text-[11px] font-medium text-n-3">{outcome.detail}</span>}
      </span>
    </li>
  )
}
