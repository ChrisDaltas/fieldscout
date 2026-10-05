'use client'

import { useState } from 'react'

import { acquireConfirmCopy, acquireConfirmVerb, ROSTER_FULL_COPY } from '@/components/players/player-card-league-ops'
import { PositionBadge } from '@/components/players/position-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { SubmitClaimResult } from '@/lib/leagues/api/waivers-service'

import { lockBadgeFor } from './lineup-editor-ops'
import type { PoolPlayerRow } from './players-page-ops'
import { LOCKED_DROP_TITLE } from './players-page-ops'
import { StatusBanner } from './status-banners'
import { bidHint, claimSettlesCopy, faabLeftCopy, parseBid } from './waiver-claims-ops'

/**
 * The claim flow — spec §16.2 `free-agents-table` ("FAAB bid modal"),
 * §16.5.2's Waivers row ("FAAB bid modal (or priority claim)"), M5 task
 * L.D2.13. A FAAB league asks for a bid (whole dollars, the league minimum up
 * to the balance — ADVISORY here, the verb's refusal is the rule and renders
 * verbatim); a priority league asks for nothing but the optional drop. The
 * claim spends nothing now (TD2) — it is settled at the next run.
 *
 * NOT optimistic, one `action_id` per submit (`useSubmitClaim`). A dialog is
 * a true overlay, so it keeps the primitive's resting shadow (CLAUDE.md).
 *
 * D481(n) (Chris 2026-10-03, "Always confirm first"): the Players page's one
 * "+" opens THIS step for an instant add too (`kind: 'add'`), so Add and
 * Claim behave the same — one plain line, the drop picker (required on a
 * full roster), the bid on a FAAB claim (the bid step IS the confirm), then
 * Add / Place claim. One step, never a confirm followed by a second dialog.
 */
export interface ClaimDialogProps {
  row: PoolPlayerRow | null
  /** What the + runs: an instant add, or a waiver claim (default). */
  kind?: 'add' | 'claim'
  /** The roster is full: a drop must be picked before the button lives. */
  needsDrop?: boolean
  waiverType: string
  minBid: number
  balance: number | null
  budget: number | null
  roster: readonly RosterPlayer[]
  nextRunLocal: string | null
  pending: boolean
  refusal: string | null
  result: SubmitClaimResult | null
  onSubmit: (input: { bid: number | undefined; dropPlayerId: string | null }) => void
  onClose: () => void
}

export function ClaimDialog(props: ClaimDialogProps) {
  return (
    <Dialog open={props.row !== null} onOpenChange={(open) => !open && !props.pending && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{props.kind === 'add' ? 'Add player' : 'Waiver claim'}</DialogTitle>
          <DialogDescription>{props.kind === 'add' ? 'He joins your roster now.' : claimSettlesCopy(props.nextRunLocal)}</DialogDescription>
        </DialogHeader>
        {props.row && <ClaimForm key={props.row.player.id} {...props} row={props.row} />}
      </DialogContent>
    </Dialog>
  )
}

const NO_DROP = 'none'

/** The dialog's body — rendered directly by the render tests (a portal does
 *  not reach a static render). */
export function ClaimForm({
  row,
  kind = 'claim',
  needsDrop = false,
  waiverType,
  minBid,
  balance,
  budget,
  roster,
  nextRunLocal,
  pending,
  refusal,
  result,
  onSubmit,
  onClose,
}: ClaimDialogProps & { row: PoolPlayerRow }) {
  const faab = kind === 'claim' && waiverType === 'faab'
  const [text, setText] = useState(String(minBid))
  const [dropId, setDropId] = useState<string | null>(null)
  const bid = faab ? parseBid(text) : 0
  const hint = faab ? bidHint(bid, minBid, balance) : null

  const ready = bid !== null && !(needsDrop && dropId === null)
  const copy = acquireConfirmCopy(kind === 'add' ? { kind } : { kind, nextRunLocal, bid: faab ? bid : null }, row.player.full_name)

  if (result) {
    return (
      <div className="flex flex-col gap-3" data-claim-result>
        <StatusBanner tone="accent">
          <strong>
            Claim in for {result.add_player_name ?? row.player.full_name}
            {faab ? ` — $${result.claim.faab_bid}` : ''}
          </strong>
        </StatusBanner>
        <p className="text-[12px] font-medium text-n-3">
          {result.drop_player_name ? `If it goes through, ${result.drop_player_name} is dropped. ` : ''}
          {claimSettlesCopy(nextRunLocal)} Nothing is spent until then, and you can change or cancel it under Transactions on My Team.
        </p>
        <span>
          <Button variant="stroke" size="sm" onClick={onClose}>
            Done
          </Button>
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-claim-form={kind === 'add' ? 'add' : faab ? 'faab' : 'priority'}>
      <div className="flex items-center gap-2 rounded-sm border border-n-4 px-2 py-2">
        <PositionBadge position={row.player.position} size="sm" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{row.player.full_name}</span>
        <span className="text-[11px] font-medium text-n-3">{row.player.team ?? '—'}</span>
      </div>

      <p className="text-[12px] font-semibold text-ink" data-acquire-copy>
        {copy}
      </p>

      {refusal && (
        <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink" data-claim-refusal>
          {/* VERBATIM — the verb names the rule it applied. */}
          {refusal}
        </p>
      )}

      {faab ? (
        <label className="flex flex-col gap-1 text-[11px] font-bold text-ink">
          Your bid
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-bold">$</span>
            <Input value={text} onChange={(e) => setText(e.target.value)} inputMode="numeric" aria-label="Bid in dollars" className="h-btn-md w-24 px-2 text-[12px]" data-claim-bid-input />
            <span className="text-[11px] font-medium text-n-3">{faabLeftCopy(balance, budget)}</span>
          </span>
          <span className="text-[10px] font-medium text-n-3">
            {hint ?? 'Bids are blind — nobody sees yours. The biggest bid on a player wins him.'}
          </span>
        </label>
      ) : kind === 'add' ? null : (
        <p className="text-[12px] font-medium text-n-3" data-claim-priority>
          Claims go by waiver priority — the team highest in the order gets the player.
        </p>
      )}

      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink">
        {needsDrop ? ROSTER_FULL_COPY : 'Drop (optional)'}
        <Select value={dropId ?? (needsDrop ? '' : NO_DROP)} onValueChange={(v) => setDropId(v === NO_DROP ? null : v)}>
          <SelectTrigger className="h-btn-md px-2 text-[12px]" data-claim-drop={dropId ?? ''}>
            <SelectValue placeholder={needsDrop ? 'Choose who to drop' : 'No drop'} />
          </SelectTrigger>
          <SelectContent>
            {!needsDrop && <SelectItem value={NO_DROP}>No drop</SelectItem>}
            {roster.map((p) => {
              const lock = lockBadgeFor(p.game_lock, true)
              return (
                <SelectItem key={p.player_id} value={p.player_id} disabled={lock.locked} title={lock.locked ? LOCKED_DROP_TITLE : undefined}>
                  {p.position} · {p.full_name}
                  {lock.locked ? ' 🔒' : ''}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        {kind === 'claim' && <span className="text-[10px] font-medium text-n-3">Only dropped if the claim goes through.</span>}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="blue"
          size="sm"
          shadow
          disabled={pending || !ready}
          onClick={() => onSubmit({ bid: faab ? (bid ?? undefined) : undefined, dropPlayerId: dropId })}
          data-claim-submit
          data-acquire-confirm={kind}
        >
          {pending ? 'Sending…' : acquireConfirmVerb(kind)}
        </Button>
        <Button variant="stroke" size="sm" onClick={onClose} disabled={pending} data-acquire-cancel>
          Cancel
        </Button>
      </div>
    </div>
  )
}
