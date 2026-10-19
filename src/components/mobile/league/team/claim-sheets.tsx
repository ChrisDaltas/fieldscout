'use client'

import { useMemo, useState } from 'react'

import { formatInstantWithDate, lockBadgeFor } from '@/components/leagues/lineup-editor-ops'
import { CLAIM_ORDER_LABEL } from '@/components/leagues/team-transactions-ops'
import { claimSettlesCopy } from '@/components/leagues/waiver-claims-ops'
import { moveSub } from '@/components/mobile/league/league/league-tab-ops'
import { BidStepper, DropPicker, Refusal, SheetButton } from '@/components/mobile/player/player-move-sheet'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { ROSTER_FULL_COPY } from '@/components/players/player-card-league-ops'
import { useEditClaim } from '@/hooks/use-edit-claim'
import { useLeague } from '@/hooks/use-league'
import { usePlayersByIds, type PlayerIdentity } from '@/hooks/use-players-by-ids'
import { useReorderClaims } from '@/hooks/use-reorder-claims'
import { useRosters } from '@/hooks/use-rosters'
import { toast } from '@/hooks/use-toast'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { WaiverClaimPlayer, WaiverClaimView, WaiverClaimsDocument } from '@/lib/leagues/api/waivers-service'
import { deriveRosterSize } from '@/lib/leagues/settings/league-settings'
import { shortPlayerName } from '@/utils/format-name'

import {
  CLAIM_UPDATED_COPY,
  DROP_ONLY_IF_WON_NOTE,
  DROP_OPTIONAL_TITLE,
  EDIT_CLAIM_TITLE,
  EDIT_ROSTER_ERROR_COPY,
  claimBidBounds,
  claimDropChoices,
  claimEditChange,
  claimEditStart,
  claimEditState,
  claimOrderCaption,
  claimOrderMeta,
  claimOrderRows,
  dropGoneCopy,
  takenDrops,
  type ClaimOrderRow,
} from './claim-edit-ops'

/**
 * Change a pending waiver claim on the phone (gap list §3 #13) — the bid,
 * the drop and the claim order, through the app's own claim verbs (the
 * desktop Transactions panel's): `useEditClaim` (bid and drop in place, one
 * call; the add can't change) and `useReorderClaims` (one claim to a new
 * place — optimistic, rolled back on a refusal). Your own team's claims
 * only (bids are blind). The handoff has no claim screens, so both are
 * bottom sheets in the claim flow's language: the bid stepper and drop
 * picker the Claim sheet uses, and the up / down arrows the handoff's
 * composer uses for an order. A refusal renders verbatim.
 */

/** The "Claim order" pill beside the Pending claims heading (2+ claims). */
export function ClaimOrderDoor({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[26px] flex-none items-center rounded-pill bg-m-b2 px-3 text-[12px] font-semibold text-m-t1 active:bg-m-b2h"
      data-claim-order-door
    >
      {CLAIM_ORDER_LABEL}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Edit claim — the bid and the drop
// ---------------------------------------------------------------------------

/** Open while `claim` is set; the host clears it on close (and a claim the
 *  run settled meanwhile drops out of the host's pending list, closing it). */
export function ClaimEditSheet({
  leagueId,
  doc,
  claim,
  onClose,
}: {
  leagueId: string
  doc: WaiverClaimsDocument
  claim: WaiverClaimView | null
  onClose: () => void
}) {
  const league = useLeague(leagueId)
  const detail = league.data
  const next = detail?.waiver_window?.next_run_at ?? null
  const nextRunLocal = next ? formatInstantWithDate(next, detail?.settings.draft.time_zone ?? null).local : null
  return (
    <MobileSheet open={claim !== null} onOpenChange={(open) => !open && onClose()} title={EDIT_CLAIM_TITLE} subtitle={claimSettlesCopy(nextRunLocal)}>
      {claim && (
        <ClaimEditBody
          key={claim.id}
          leagueId={leagueId}
          doc={doc}
          claim={claim}
          rosterSize={detail ? deriveRosterSize(detail.settings.roster_settings) : null}
          onDone={onClose}
        />
      )}
    </MobileSheet>
  )
}

function ClaimEditBody({
  leagueId,
  doc,
  claim,
  rosterSize,
  onDone,
}: {
  leagueId: string
  doc: WaiverClaimsDocument
  claim: WaiverClaimView
  rosterSize: number | null
  onDone: () => void
}) {
  const rosters = useRosters(leagueId)
  const edit = useEditClaim(leagueId)
  const players = usePlayersByIds([claim.add.player_id])
  const taken = useMemo(() => takenDrops(doc.claims, claim), [doc.claims, claim])
  const roster = rosters.data?.teams.find((t) => t.team_id === doc.team_id)?.roster ?? null

  if ((rosters.isPending && !rosters.data) || rosterSize === null) {
    return (
      <div className="flex flex-col gap-2 px-5 pb-2" data-claim-edit="loading">
        <div className="h-[44px] animate-pulse rounded-[12px] bg-m-b1" />
        <div className="h-[46px] animate-pulse rounded-pill bg-m-b1" />
      </div>
    )
  }
  if (!roster) {
    // Fail loud: without the roster there is no knowing who may be dropped.
    return (
      <div role="alert" className="flex flex-col gap-4 px-5 pb-1" data-claim-edit="error">
        <p className="text-[14px] font-medium leading-[1.45] text-m-t2">{EDIT_ROSTER_ERROR_COPY}</p>
        <div className="flex gap-2">
          <SheetButton tone="neutral" onClick={onDone}>
            Close
          </SheetButton>
          <SheetButton tone="neutral" onClick={() => void rosters.refetch()}>
            Try again
          </SheetButton>
        </div>
      </div>
    )
  }
  return (
    <ClaimEditForm
      claim={claim}
      taken={taken}
      bounds={claimBidBounds(doc)}
      roster={roster}
      rosterSize={rosterSize}
      identity={players.playerById.get(claim.add.player_id) ?? null}
      pending={edit.isPending}
      refusal={edit.isError ? edit.error : null}
      onSave={(change) =>
        edit
          .editAsync(claim.id, change)
          .then(() => {
            toast({ title: CLAIM_UPDATED_COPY })
            onDone()
          })
          .catch(() => {
            // The refusal renders from `edit.error` — verbatim.
          })
      }
      onClose={onDone}
    />
  )
}

const NONE_TAKEN: ReadonlySet<string | null> = new Set()

/** The edit form over a read roster — exported for the render tests (a
 *  sheet portals, so a static render can't reach it inside one). */
export function ClaimEditForm({
  claim,
  taken = NONE_TAKEN,
  bounds,
  roster,
  rosterSize,
  identity,
  pending,
  refusal,
  onSave,
  onClose,
}: {
  claim: WaiverClaimView
  /** Drops your other pending claims for the same player name (`takenDrops`). */
  taken?: ReadonlySet<string | null>
  /** The FAAB bid's bounds; null = no bid (a priority league). */
  bounds: { min: number; max: number | null } | null
  roster: readonly RosterPlayer[]
  rosterSize: number
  identity: PlayerIdentity | null
  pending: boolean
  refusal: unknown
  onSave: (change: { faab_bid: number; drop_player_id: string | null }) => void
  onClose: () => void
}) {
  const [start] = useState(() => claimEditStart(claim, roster))
  const [bid, setBid] = useState(start.bid)
  const [dropId, setDropId] = useState(start.dropId)
  const currentDrop = claim.drop?.player_id ?? null
  const choices = useMemo(() => claimDropChoices(roster, currentDrop, (p) => lockBadgeFor(p.game_lock, true).locked, taken), [roster, currentDrop, taken])
  const needsDrop = roster.length >= rosterSize
  const { ready } = claimEditState({ claim, bounds, bid, dropId, needsDrop, taken })
  const note = start.dropGone ? `${dropGoneCopy(start.dropGone)} ${DROP_ONLY_IF_WON_NOTE}` : DROP_ONLY_IF_WON_NOTE

  return (
    <div className="flex flex-col gap-4 px-5 pb-1" data-claim-edit={claim.id}>
      <ClaimHead player={claim.add} identity={identity} />
      {bounds && <BidStepper bid={bid} bounds={bounds} onChange={setBid} />}
      <DropPicker title={needsDrop ? ROSTER_FULL_COPY : DROP_OPTIONAL_TITLE} note={note} choices={choices} value={dropId} onChange={setDropId} allowNone={!needsDrop && (!taken.has(null) || currentDrop === null)} />
      {refusal ? <Refusal error={refusal} /> : null}
      {/* Pinned to the sheet's bottom edge: the drop picker lists the whole
          roster, and Save must stay in reach. */}
      <div className="sticky bottom-0 -mx-5 flex gap-2 bg-m-b0 px-5 pb-1 pt-2">
        <SheetButton tone="neutral" disabled={pending} onClick={onClose}>
          Close
        </SheetButton>
        <SheetButton tone="claim" disabled={!ready || pending} onClick={() => onSave(claimEditChange(bounds !== null, bid, dropId))}>
          {pending ? 'Saving…' : 'Save'}
        </SheetButton>
      </div>
    </div>
  )
}

/** The claimed player: headshot, name, position and NFL team. The add is
 *  not editable (a different player is a different claim). */
function ClaimHead({ player, identity }: { player: WaiverClaimPlayer; identity: PlayerIdentity | null }) {
  const name = player.full_name ?? identity?.full_name ?? 'Unknown player'
  const sub = moveSub(player.position, player.nfl_team)
  return (
    <div className="flex items-center gap-3 rounded-[14px] bg-m-b1 px-3 py-2.5" data-claim-head={player.player_id}>
      <MHeadshot player={{ id: player.player_id, full_name: name, team: player.nfl_team, position: player.position, headshot_url: identity?.headshot_url ?? null }} size={40} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[15px] font-semibold text-m-t1">{name}</span>
        {sub && <span className="truncate text-[12px] font-medium text-m-t3">{sub}</span>}
      </span>
      <span className="flex h-[22px] flex-none items-center rounded-pill bg-m-go px-2 text-[11px] font-semibold text-m-gold">Claim</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Claim order — up / down arrows
// ---------------------------------------------------------------------------

export function ClaimOrderSheet({
  leagueId,
  doc,
  open,
  onOpenChange,
}: {
  leagueId: string
  doc: WaiverClaimsDocument
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const rows = useMemo(() => claimOrderRows(doc), [doc])
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title={CLAIM_ORDER_LABEL} subtitle={claimOrderCaption(rows, doc.waiver_type)}>
      <ClaimOrderBody leagueId={leagueId} rows={rows} faab={doc.waiver_type === 'faab'} onDone={() => onOpenChange(false)} />
    </MobileSheet>
  )
}

/** Mounted only while the sheet is open: the headshots are read, and a
 *  refusal is shown, for this opening only. */
function ClaimOrderBody({ leagueId, rows, faab, onDone }: { leagueId: string; rows: readonly ClaimOrderRow[]; faab: boolean; onDone: () => void }) {
  const reorder = useReorderClaims(leagueId)
  const ids = useMemo(() => rows.map((r) => r.claim.add.player_id), [rows])
  const players = usePlayersByIds(ids)
  return (
    <ClaimOrderList
      rows={rows}
      faab={faab}
      playerById={players.playerById}
      pending={reorder.isPending}
      refusal={reorder.isError ? reorder.error : null}
      onMove={(claimId, place) => reorder.move(claimId, place)}
      onDone={onDone}
    />
  )
}

/** The order list — exported for the render tests. */
export function ClaimOrderList({
  rows,
  faab,
  playerById,
  pending,
  refusal,
  onMove,
  onDone,
}: {
  rows: readonly ClaimOrderRow[]
  faab: boolean
  playerById: ReadonlyMap<string, PlayerIdentity>
  /** A move is on its way: further taps wait for it (the desktop drag's rule). */
  pending: boolean
  refusal: unknown
  onMove: (claimId: string, place: number) => void
  onDone: () => void
}) {
  return (
    <div className="flex flex-col px-4 pb-1" data-claim-order>
      {refusal ? (
        <div className="pb-2">
          <Refusal error={refusal} />
        </div>
      ) : null}
      {rows.map(({ claim, rank, up, down }) => {
        const identity = playerById.get(claim.add.player_id) ?? null
        const name = claim.add.full_name ?? identity?.full_name ?? 'Unknown player'
        const move = (place: number | null) => {
          if (place !== null && !pending) onMove(claim.id, place)
        }
        return (
          <div key={claim.id} className="flex items-center gap-2.5 border-b border-m-b2 py-2" data-claim-order-row={claim.id} data-claim-rank={rank}>
            <span className="w-[22px] flex-none text-center text-[14px] font-bold tabular-nums text-m-t1">{rank}</span>
            <MHeadshot
              player={{ id: claim.add.player_id, full_name: name, team: claim.add.nfl_team, position: claim.add.position, headshot_url: identity?.headshot_url ?? null }}
              size={36}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="truncate text-[14px] font-semibold text-m-t1">{shortPlayerName(name, claim.add.position)}</span>
              <span className="truncate text-[11px] font-semibold text-m-t3">{claimOrderMeta(claim, faab, shortPlayerName)}</span>
            </span>
            <OrderArrow dir="up" off={up === null} label={`Move ${name} up`} onClick={() => move(up)} />
            <OrderArrow dir="down" off={down === null} label={`Move ${name} down`} onClick={() => move(down)} />
          </div>
        )
      })}
      <div className="flex pt-4">
        <SheetButton tone="neutral" onClick={onDone}>
          Done
        </SheetButton>
      </div>
    </div>
  )
}

/** The handoff composer's order arrow: a 32px circle, b2, a 14px chevron;
 *  at .3 when the move isn't open. */
function OrderArrow({ dir, off, label, onClick }: { dir: 'up' | 'down'; off: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={off}
      onClick={onClick}
      className="flex size-8 flex-none items-center justify-center rounded-full bg-m-b2 text-m-t1 active:bg-m-b2h disabled:opacity-30"
      data-claim-move={dir}
    >
      <MIcon name={dir === 'up' ? 'chevronUp' : 'chevronDown'} size={14} stroke={2} />
    </button>
  )
}
