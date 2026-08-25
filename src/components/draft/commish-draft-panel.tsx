'use client'

import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { InvitePanel } from '@/components/leagues/invite-panel'
import { type DraftPickSummary } from '@/hooks/use-draft'
import {
  useAdjustBudget,
  useCancelNomination,
  useEndDraft,
  useForcePick,
  useMovePlayer,
  usePauseResumeDraft,
  useReassignPick,
  useResetDraft,
  useReverseWonBid,
  useSetDraftClock,
  useSetMemberAutodraft,
  useUndoDraft,
} from '@/hooks/use-draft-controls'
import { useDraftOrder } from '@/hooks/use-draft'
import { useDraftPool } from '@/hooks/use-draft-pool'
import type { LeagueDetail } from '@/hooks/use-league'
import type { PlayerIdentity } from '@/hooks/use-players-by-ids'
import { toast } from '@/hooks/use-toast'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import { PICK_TIMER_SECONDS } from '@/lib/leagues/settings/league-settings'
import type { Draft } from '@/types/database'

import {
  auctionKnobsOf,
  readLiveNomination,
  teamBudgets,
  type TeamBudget,
} from './auction-budget'
import { buildAuctionColumns, type AuctionTeamColumn } from './auction-block-ops'
import {
  activeFranchises,
  auctionTimerPayload,
  budgetEditPreview,
  endDraftConsequences,
  priceEntry,
  unfilledSlotsAtEnd,
  AUCTION_TIMER_RANGES,
  END_CONFIRM_WORD,
} from './commish-auction-ops'
import {
  cascadeTargetBounds,
  deriveUndoPreview,
  moveOrderEntry,
  pauseFirstGate,
  pickTimerLabel,
  type ControlGate,
  type UndoTarget,
} from './commish-panel-ops'
import { abbreviateName, parseDraftOrder } from './draft-board-ops'
import { sectionDomId, type DraftOptionsSectionId } from './draft-options-ops'

interface CommishDraftPanelProps {
  leagueId: string
  draft: Draft
  detail: LeagueDetail
  picks: DraftPickSummary[]
  playerById: ReadonlyMap<string, PlayerIdentity>
  /** DR.2 (D153): the panel is CONTROLLED — its own blue `Commish panel`
   *  SheetTrigger is retired; the command bar's `Draft Options` menu is the
   *  one door (DR.3). */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** DR.3: the `Draft Options` menu group the viewer chose — the sheet
   *  opens scrolled to that section's anchor (`sectionDomId`). Null when
   *  the panel is closed (the room clears it on close). */
  openAtSection: DraftOptionsSectionId | null
}

/**
 * Commissioner Draft Panel (§8.7; §16.2 `commish-draft-panel`; M2 task
 * L.B3.3) — every §8.7 snake control over the L.B2.3 routes (D114's one
 * dispatch pipeline; the RPCs own auth/lock/legality and post the D97
 * system message in-txn, so every action here VISIBLY lands in chat — the
 * §16.3 transparency loop).
 *
 * Renders ONLY for commissioner/co-commissioner (§17) on a NON-mock draft
 * (D110(1): the §8.7 controls refuse mocks in-RPC; the UI must not offer
 * what the engine forbids). The panel is UNMISTAKABLE (§16.3): accent
 * treatment on the sheet's leading edge and the header badge — and, since
 * DR.2 (D153), on its ONE door: the command bar's accent-filled
 * `Draft Options` control. The panel's own blue trigger is retired; the
 * Sheet is controlled (`open`/`onOpenChange`) and the eight section bodies,
 * gates, confirm dialogs and system-post semantics are unchanged.
 *
 * "Reassign a draft seat" is COMPOSED from M1's membership surface (the
 * invite panel's assign/remove/invite affordances — no new RPC; E48 covers
 * the mid-draft claim path): the seat-controls entry opens it in place.
 */
export function CommishDraftPanel({
  leagueId,
  draft,
  detail,
  picks,
  playerById,
  open,
  onOpenChange,
  openAtSection,
}: CommishDraftPanelProps) {
  const paused = draft.status === 'paused'
  // L.C3.2 / F72's remaining half: ONE gate for BOTH draft types, mirroring
  // migration 090's type-neutral `draft_auction_pause_gate_internal`. Every
  // pause-first section takes it and renders disabled-with-copy while the
  // draft RUNS, instead of offering a click the server answers with a
  // refusal (spec §8.7 v2.12.5; D141).
  const gate = pauseFirstGate(draft)
  const isAuction = draft.draft_type === 'auction'
  const livePicks = useMemo(
    () => picks.filter((p) => !p.is_undone).sort((a, b) => a.pick_number - b.pick_number),
    [picks],
  )
  const teamsById = useMemo(() => new Map(detail.teams.map((t) => [t.id, t])), [detail.teams])
  const playerLabel = (playerId: string) => playerById.get(playerId)?.full_name ?? playerId
  const pickSummary = (p: DraftPickSummary) =>
    `#${p.pick_number} · ${playerLabel(p.player_id)} → ${teamsById.get(p.team_id)?.name ?? 'Team'}`

  const surfaceError = (error: unknown, title: string) => {
    toast({
      title,
      description:
        error instanceof LeagueActionError || error instanceof Error
          ? error.message // the RPCs' friendly refusals (exclusivity etc.) verbatim
          : 'Something went wrong.',
      variant: 'destructive',
    })
  }

  // ----- auction money (§4.7: the DISPLAY-ONLY mirror of 084) -------------
  // Every number the auction sections show comes from `auction-budget.ts`,
  // the parity-pinned mirror of `draft_team_budget` — the same one the room's
  // team columns render off. Nothing here admits or refuses an edit; the RPC
  // does, with its own numbers (E28's arms).
  const auctionKnobs = useMemo(() => auctionKnobsOf(draft.config), [draft.config])
  const budgetInputs = useMemo(
    () => ({
      auctionBudget: auctionKnobs.auctionBudget,
      reserve: auctionKnobs.reserve,
      totalRounds: draft.total_rounds,
      budgetAdjustments: draft.budget_adjustments,
    }),
    [auctionKnobs, draft.total_rounds, draft.budget_adjustments],
  )
  // R436 (M3 batch 14): the franchises the ENGINE counts. `draft_end` sums
  // open slots over `teams … WHERE t.status <> 'retired'` (087) while the
  // detail endpoint returns every team row unfiltered, so a raw `detail.teams`
  // would make the End confirm's "N roster spots stay empty" disagree with the
  // number `draft_end` posts the moment a franchise is retired. ONE derivation
  // feeds all three consumers — the budget mirror + End's count, Manual Edit's
  // cells/move targets, and the budget picker. (Latent today: nothing writes
  // `'retired'` until `retire_franchise`, F1/M4.) `teamsById` deliberately
  // keeps EVERY team — a retired franchise's existing picks still need a name.
  const activeTeams = useMemo(() => activeFranchises(detail.teams), [detail.teams])
  const teamIds = useMemo(() => activeTeams.map((t) => t.id), [activeTeams])
  const budgets = useMemo(
    () => (isAuction ? teamBudgets(budgetInputs, picks, teamIds) : new Map<string, TeamBudget | null>()),
    [isAuction, budgetInputs, picks, teamIds],
  )
  const nomination = useMemo(
    () => readLiveNomination(draft.current_nomination),
    [draft.current_nomination],
  )
  const nominationOrder = useMemo(
    () => parseDraftOrder(draft.nomination_order),
    [draft.nomination_order],
  )
  // Manual Edit Mode's cells: the SAME per-team columns the board renders
  // (`buildAuctionColumns` — no second derivation of who owns what for how
  // much), ordered by nomination order per §16.4.
  const auctionColumns = useMemo(
    () =>
      isAuction
        ? buildAuctionColumns({
            nominationOrder,
            teams: activeTeams,
            picks,
            budgets,
            positionById: new Map(
              Array.from(playerById.values()).map((p) => [p.id, p.position]),
            ),
            startingSlots: detail.settings.roster_settings.starting_slots,
            bench: detail.settings.roster_settings.bench,
            myTeamId: null,
            nominatingTeamId: draft.on_clock_team_id,
            nomination,
          })
        : [],
    [
      isAuction,
      nominationOrder,
      activeTeams,
      detail.settings.roster_settings,
      picks,
      budgets,
      playerById,
      draft.on_clock_team_id,
      nomination,
    ],
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // Distinct accent on the overlay itself (§16.3) — the sheet's
        // leading edge carries it. Scrolls: the §8.7 control list is long.
        className="flex w-full flex-col gap-4 overflow-y-auto border-l-2 border-accent sm:max-w-md"
        // DR.3 open-at-section: when the Draft Options menu chose a group,
        // the open-time focus goes to that group's anchor instead of
        // Radix's default (the sheet root) — focusing lands the screen
        // reader on the section AND the explicit scrollIntoView lands the
        // eye. Done in onOpenAutoFocus because Radix's own auto-focus runs
        // AFTER mount effects and would scroll the sheet back to the top
        // (measured in the DR.3 browser pass: a rAF-scheduled scroll was
        // reset to scrollTop 0 by the time the sheet settled).
        onOpenAutoFocus={(event) => {
          if (!openAtSection) return
          const anchor = document.getElementById(sectionDomId(openAtSection))
          if (!anchor) return
          event.preventDefault()
          anchor.focus({ preventScroll: true })
          anchor.scrollIntoView({ block: 'start' })
        }}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Commissioner panel
            <Badge variant="accent">Commish</Badge>
          </SheetTitle>
          <SheetDescription>
            Every action posts a system message to the draft chat — the room sees it happen.
          </SheetDescription>
        </SheetHeader>

        {/* DR.3 open-at-section: each section mount gets a focusable scroll
            anchor (`sectionDomId`, tabIndex -1) so onOpenAutoFocus above can
            land the sheet on the chosen group. The anchors belong to this
            mount site — the section BODIES below are D153-untouched. */}
        <div id={sectionDomId('clock')} tabIndex={-1}>
          <ClockSection
            leagueId={leagueId}
            draft={draft}
            paused={paused}
            isAuction={isAuction}
            gate={gate}
            onError={surfaceError}
          />
        </div>
        <div id={sectionDomId('undo')} tabIndex={-1}>
          <UndoSection
            leagueId={leagueId}
            draftId={draft.id}
            livePicks={livePicks}
            pickSummary={pickSummary}
            isAuction={isAuction}
            gate={gate}
            onError={surfaceError}
          />
        </div>
        {/* §8.7's v2.10 ruling: Manual Edit Mode REPLACES the reassign/move
            articulation on an auction (D142), so the two never both render —
            one pair of engine paths, one door. */}
        {isAuction ? (
          <>
            <div id={sectionDomId('manual-edit')} tabIndex={-1}>
              <ManualEditSection
                leagueId={leagueId}
                draftId={draft.id}
                columns={auctionColumns}
                budgets={budgets}
                reserve={auctionKnobs.reserve}
                playerById={playerById}
                livePicks={livePicks}
                gate={gate}
                onError={surfaceError}
              />
            </div>
            <div id={sectionDomId('cancel-nomination')} tabIndex={-1}>
              <CancelNominationSection
                leagueId={leagueId}
                draftId={draft.id}
                nomination={nomination}
                nominatingTeamName={
                  draft.on_clock_team_id
                    ? (teamsById.get(draft.on_clock_team_id)?.name ?? null)
                    : null
                }
                playerLabel={playerLabel}
                gate={gate}
                onError={surfaceError}
              />
            </div>
            <div id={sectionDomId('budget')} tabIndex={-1}>
              <BudgetSection
                leagueId={leagueId}
                draftId={draft.id}
                teams={activeTeams}
                budgets={budgets}
                reserve={auctionKnobs.reserve}
                nomination={nomination}
                onError={surfaceError}
              />
            </div>
          </>
        ) : (
          <div id={sectionDomId('fix-pick')} tabIndex={-1}>
            <FixPickSection
              leagueId={leagueId}
              draftId={draft.id}
              livePicks={livePicks}
              activeTeams={activeTeams}
              pickSummary={pickSummary}
              playerLabel={playerLabel}
              gate={gate}
              onError={surfaceError}
            />
          </div>
        )}
        <div id={sectionDomId('force-pick')} tabIndex={-1}>
          <ForcePickSection
            leagueId={leagueId}
            draft={draft}
            teamsById={teamsById}
            isAuction={isAuction}
            onError={surfaceError}
          />
        </div>
        <div id={sectionDomId('order')} tabIndex={-1}>
          <OrderSection
            leagueId={leagueId}
            draft={draft}
            detail={detail}
            isAuction={isAuction}
            onError={surfaceError}
          />
        </div>
        <div id={sectionDomId('autopick')} tabIndex={-1}>
          <AutopickSection leagueId={leagueId} detail={detail} onError={surfaceError} />
        </div>
        <div id={sectionDomId('seats')} tabIndex={-1}>
          <SeatControlsSection leagueId={leagueId} detail={detail} />
        </div>
        <div id={sectionDomId('reset')} tabIndex={-1}>
          <ResetSection leagueId={leagueId} draftId={draft.id} onError={surfaceError} />
        </div>
        {isAuction && (
          <div id={sectionDomId('end')} tabIndex={-1}>
            <EndDraftSection
              leagueId={leagueId}
              draftId={draft.id}
              unfilled={unfilledSlotsAtEnd(budgetInputs, picks, teamIds)}
              onError={surfaceError}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Shared section shell (in-flow: flat at rest — the elevation rule)
// ---------------------------------------------------------------------------

function PanelSection({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2.5 rounded-sm border border-ink bg-white p-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-extrabold text-ink">{title}</h3>
        {hint && <p className="text-[11px] font-medium text-n-3">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function ReasonInput({
  value,
  onChange,
  required,
}: {
  value: string
  onChange: (next: string) => void
  required?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px]">
        Reason {required ? '(required)' : '(optional)'}
      </Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={500}
        placeholder="Why — the audit log arrives in M6; chat shows the action either way"
        className="h-btn-md text-[12px]"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pause/resume + clock edit (§8.7 rows 1–2; E15)
// ---------------------------------------------------------------------------

function ClockSection({
  leagueId,
  draft,
  paused,
  isAuction,
  gate,
  onError,
}: {
  leagueId: string
  draft: Draft
  paused: boolean
  isAuction: boolean
  gate: ControlGate
  onError: (error: unknown, title: string) => void
}) {
  const pauseResume = usePauseResumeDraft(leagueId, draft.id)
  const setClock = useSetDraftClock(leagueId, draft.id)
  const [timer, setTimer] = useState<string>('')

  return (
    <PanelSection
      title="Clock"
      hint={
        gate.reason ??
        'Pause freezes every clock; resume restores the exact remaining time (§8.7).'
      }
    >
      <Button
        variant={paused ? 'green' : 'stroke'}
        size="sm"
        disabled={pauseResume.isPending}
        onClick={() =>
          pauseResume
            .mutateAsync({ action: paused ? 'resume' : 'pause' })
            .catch((e: unknown) => onError(e, paused ? 'Resume failed' : 'Pause failed'))
        }
      >
        {pauseResume.isPending ? 'Working…' : paused ? 'Resume draft' : 'Pause draft'}
      </Button>

      {isAuction ? (
        <AuctionTimerFields
          config={draft.config}
          gate={gate}
          pending={setClock.isPending}
          onApply={(auction) =>
            setClock
              .mutateAsync({ pickTimerSeconds: null, extendCurrent: false, auction })
              .then(() => toast({ title: 'Auction timers updated' }))
              .catch((e: unknown) => onError(e, 'Clock edit failed'))
          }
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px]">New pick clock (applies to subsequent picks)</Label>
          <Select value={timer} onValueChange={setTimer} disabled={gate.blocked}>
            <SelectTrigger className="h-btn-md text-[12px] font-bold" aria-label="New pick clock">
              <SelectValue placeholder="Choose a timer…" />
            </SelectTrigger>
            <SelectContent>
              {PICK_TIMER_SECONDS.map((seconds) => (
                <SelectItem key={seconds} value={String(seconds)}>
                  {pickTimerLabel(seconds)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="stroke"
            size="sm"
            // F72's disabled-states half (L.C3.2): 090 made the clock edit
            // pause-first on EVERY draft type, so the control is disabled
            // while the draft runs and says why (D141's "UI disables with
            // the same copy") instead of spending a click on a refusal.
            disabled={gate.blocked || timer === '' || setClock.isPending}
            title={gate.reason ?? undefined}
            onClick={() =>
              setClock
                // extendCurrent is pinned FALSE: migration 090 deleted the
                // extend-in-place arm (spec v2.12.5 §8.7 Edit-pick-clock — the
                // pause itself is the time relief), so `true` refuses in EVERY
                // state. The checkbox that used to drive it, with its
                // "(resume first)" hint that pause-first made a lie, is
                // removed (F72's dead-control half, taken minimally in DR.3).
                .mutateAsync({ pickTimerSeconds: Number(timer), extendCurrent: false })
                .then(() => toast({ title: 'Pick clock updated' }))
                .catch((e: unknown) => onError(e, 'Clock edit failed'))
            }
          >
            Apply clock
          </Button>
        </div>
      )}
    </PanelSection>
  )
}

/**
 * The auction's three timers (§7.3.8 — nomination 10–120s, bid 10–60s,
 * anti-snipe 0–15s; 0 disables anti-snipe). 087's `draft_set_clock` auction
 * arm writes them into `drafts.config` and refuses a `pick_timer_seconds` on
 * an auction, so this form names only the three and sends only what CHANGED
 * (each omitted key means "unchanged" at the RPC).
 */
function AuctionTimerFields({
  config,
  gate,
  pending,
  onApply,
}: {
  config: Draft['config']
  gate: ControlGate
  pending: boolean
  onApply: (auction: {
    nominationSeconds?: number
    bidSeconds?: number
    antiSnipeSeconds?: number
  }) => void
}) {
  const stored = useMemo(() => {
    const record = (config ?? {}) as Record<string, unknown>
    const read = (key: string, fallback: number) => {
      const value = record[key]
      return typeof value === 'number' && Number.isInteger(value) ? value : fallback
    }
    return {
      nomination: read('auction_nomination_seconds', 30),
      bid: read('auction_bid_seconds', 20),
      antiSnipe: read('auction_anti_snipe_seconds', 10),
    }
  }, [config])

  const [nomination, setNomination] = useState(String(stored.nomination))
  const [bid, setBid] = useState(String(stored.bid))
  const [antiSnipe, setAntiSnipe] = useState(String(stored.antiSnipe))

  // R435 (M3 batch 14): the payload is CLAMPED into §7.3.8's ranges — the
  // same `clampInt` the settings editor applies to these two clocks. This
  // form printed the ranges as labels and enforced none of them, and neither
  // the route (`timerSecondsSchema` = 0…86400) nor 090's auction arm (which
  // only refuses negatives) would stop a 3-second bid clock reaching
  // `drafts.config`. Server-authoritative still holds: the RPC decides, this
  // just stops the UI proposing a number its own label calls illegal.
  const payload = auctionTimerPayload({ nomination, bid, antiSnipe }, stored)
  const dirty = Object.keys(payload).length > 0

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[11px]">Auction timers (apply to the next nomination)</Label>
      <div className="flex flex-wrap gap-1.5">
        {/* Label and clamp read the SAME literals (R435) — a range printed
            in one place and enforced in another is how this form came to
            promise 10–60s while accepting 3. */}
        <TimerInput
          label="Nominate"
          range={AUCTION_TIMER_RANGES.nominationSeconds}
          value={nomination}
          disabled={gate.blocked}
          onChange={setNomination}
        />
        <TimerInput
          label="Bid"
          range={AUCTION_TIMER_RANGES.bidSeconds}
          value={bid}
          disabled={gate.blocked}
          onChange={setBid}
        />
        <TimerInput
          label="Anti-snipe"
          range={AUCTION_TIMER_RANGES.antiSnipeSeconds}
          value={antiSnipe}
          disabled={gate.blocked}
          onChange={setAntiSnipe}
        />
      </div>
      <Button
        variant="stroke"
        size="sm"
        disabled={gate.blocked || !dirty || pending}
        title={gate.reason ?? undefined}
        onClick={() => onApply(payload)}
      >
        {pending ? 'Applying…' : 'Apply timers'}
      </Button>
    </div>
  )
}

function TimerInput({
  label,
  range,
  value,
  disabled,
  onChange,
}: {
  label: string
  range: { min: number; max: number }
  value: string
  disabled: boolean
  onChange: (next: string) => void
}) {
  const { min, max } = range
  return (
    <div className="flex flex-col gap-0.5">
      <Label className="text-[10px] text-n-3">
        {label} <span className="fs-num">{`${min}–${max}s`}</span>
      </Label>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        aria-label={`${label} seconds`}
        onChange={(e) => onChange(e.target.value)}
        className="h-btn-md w-24 text-[12px]"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Undo — single + cascade with the §8.7 confirm dialog (E4)
// ---------------------------------------------------------------------------

function UndoSection({
  leagueId,
  draftId,
  livePicks,
  pickSummary,
  isAuction,
  gate,
  onError,
}: {
  leagueId: string
  draftId: string
  livePicks: DraftPickSummary[]
  pickSummary: (p: DraftPickSummary) => string
  isAuction: boolean
  gate: ControlGate
  onError: (error: unknown, title: string) => void
}) {
  const undo = useUndoDraft(leagueId, draftId)
  const bounds = cascadeTargetBounds(livePicks)
  const [cascadeFrom, setCascadeFrom] = useState('')
  // R273 (M2 batch 14): store the TARGET, not a preview snapshot — the
  // preview derives from the LIVE pick cache at render, so a pick landing
  // (or another commissioner's undo) while the dialog is open updates what
  // it lists instead of diverging from what actually reverts.
  const [target, setTarget] = useState<UndoTarget | null>(null)
  const [reason, setReason] = useState('')
  const preview = useMemo(
    () => (target ? deriveUndoPreview(livePicks, target) : null),
    [livePicks, target],
  )

  const openSingle = () => setTarget({ kind: 'single' })
  const openCascade = () => {
    const first = Number(cascadeFrom)
    if (!Number.isInteger(first) || !bounds || first < bounds.min || first > bounds.max) return
    setTarget({ kind: 'cascade', from: first })
  }

  const confirm = () => {
    if (!target) return
    // Re-verify at confirm (R273): derive once more from the current picks —
    // if everything the dialog listed has since reverted, there is nothing
    // left to undo and the dialog simply closes instead of firing a no-op.
    const fresh = deriveUndoPreview(livePicks, target)
    if (fresh.reverts.length === 0) {
      setTarget(null)
      return
    }
    undo
      .mutateAsync({
        toPickNumber: fresh.toPickNumber,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
      .then(() => setTarget(null))
      .catch((e: unknown) => onError(e, 'Undo failed'))
  }

  return (
    <PanelSection
      title={isAuction ? 'Undo nominations' : 'Undo picks'}
      hint={
        gate.reason ??
        (isAuction
          ? 'Undone buys return to the pool and the winning manager is refunded; a live nomination is voided first (E29).'
          : 'Undone picks return to the pool and the clock rewinds to that team (E4).')
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="stroke"
          size="sm"
          // F72's disabled-states half: `draft_undo` (both arms) is
          // pause-first on every draft type since 090 (D141).
          disabled={gate.blocked || livePicks.length === 0}
          title={gate.reason ?? undefined}
          onClick={openSingle}
        >
          {isAuction ? 'Undo last buy' : 'Undo last pick'}
        </Button>
        <div className="flex items-center gap-1.5">
          <Input
            value={cascadeFrom}
            onChange={(e) => setCascadeFrom(e.target.value)}
            inputMode="numeric"
            placeholder={bounds ? `Pick ${bounds.min}–${bounds.max}` : 'No picks yet'}
            disabled={gate.blocked || !bounds}
            aria-label="First pick to revert"
            className="h-btn-md w-28 text-[12px]"
          />
          <Button
            variant="stroke"
            size="sm"
            disabled={gate.blocked || !bounds}
            title={gate.reason ?? undefined}
            onClick={openCascade}
          >
            Undo from here…
          </Button>
        </div>
      </div>

      <Dialog open={target !== null} onOpenChange={(next) => !next && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo {preview?.reverts.length === 1 ? 'this pick' : 'these picks'}?</DialogTitle>
            <DialogDescription>
              {/* §8.7: the confirm dialog lists EXACTLY what reverts. */}
              {preview && preview.reverts.length > 1
                ? `${preview.reverts.length} picks revert — players return to the pool and the clock rewinds to pick ${preview.reverts[0]?.pick_number}.`
                : 'The player returns to the pool and the clock rewinds to that team.'}
            </DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto text-[12px] font-semibold text-ink">
            {preview?.reverts.map((p) => (
              <li key={p.pick_number} className="rounded-sm border border-ink px-2 py-1">
                {pickSummary(p)}
              </li>
            ))}
          </ul>
          <ReasonInput value={reason} onChange={setReason} />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>
              Keep the picks
            </Button>
            <Button
              variant="destructive"
              size="sm"
              // R437: the CONFIRM reads the gate too. A dialog opened while
              // paused stays mounted if a co-commissioner resumes, and this
              // click would then meet the server's pause-first refusal —
              // F72's exact shape, in a race.
              disabled={
                gate.blocked || undo.isPending || !preview || preview.reverts.length === 0
              }
              title={gate.reason ?? undefined}
              onClick={confirm}
            >
              {undo.isPending ? 'Undoing…' : 'Undo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PanelSection>
  )
}

// ---------------------------------------------------------------------------
// Reassign / move (§8.7 "Edit / reassign a pick"; exclusivity errors friendly)
// ---------------------------------------------------------------------------

function FixPickSection({
  leagueId,
  draftId,
  livePicks,
  activeTeams,
  pickSummary,
  playerLabel,
  gate,
  onError,
}: {
  leagueId: string
  draftId: string
  livePicks: DraftPickSummary[]
  /** R443: retired franchises are refusal targets (090:716 / 090:956), so the
   *  reassign/move pickers take the same `activeFranchises()` derivation R436
   *  introduced for the auction sections. This section resolves no names of
   *  its own (`pickSummary`/`playerLabel` are passed in), so it takes the
   *  filtered list ONLY — `detail` is no longer threaded here. */
  activeTeams: LeagueDetail['teams']
  pickSummary: (p: DraftPickSummary) => string
  playerLabel: (playerId: string) => string
  gate: ControlGate
  onError: (error: unknown, title: string) => void
}) {
  const reassign = useReassignPick(leagueId, draftId)
  const movePlayer = useMovePlayer(leagueId, draftId)

  // Reassign targets need the ROW id (the wire's pick_id); broadcast hint
  // rows carry id:null until the next refetch reconciles — they simply
  // aren't offered for the second it takes.
  const reassignable = livePicks.filter((p): p is DraftPickSummary & { id: string } =>
    Boolean(p.id),
  )
  const [pickId, setPickId] = useState('')
  const [newTeam, setNewTeam] = useState('')
  const [newPlayer, setNewPlayer] = useState<{ id: string; name: string } | null>(null)

  const [movePickNumber, setMovePickNumber] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const movePick = livePicks.find((p) => String(p.pick_number) === movePickNumber)

  return (
    <PanelSection
      title="Fix a pick"
      hint={
        gate.reason ??
        'Correct the player a pick selected, or move a drafted player between teams — exclusivity is validated (§8.7).'
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px]">Reassign a pick</Label>
        <Select value={pickId} onValueChange={setPickId} disabled={gate.blocked}>
          <SelectTrigger className="h-btn-md text-[12px] font-bold" aria-label="Pick to reassign">
            <SelectValue placeholder="Choose a pick…" />
          </SelectTrigger>
          <SelectContent>
            {reassignable.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {pickSummary(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={newTeam} onValueChange={setNewTeam} disabled={gate.blocked}>
          <SelectTrigger className="h-btn-md text-[12px] font-bold" aria-label="New team">
            <SelectValue placeholder="New team (optional)" />
          </SelectTrigger>
          <SelectContent>
            {activeTeams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <PlayerSearchPicker
          label="New player (optional)"
          selected={newPlayer}
          onSelect={setNewPlayer}
          disabled={gate.blocked}
        />
        <Button
          variant="stroke"
          size="sm"
          // F72's disabled-states half: `draft_reassign_pick` is pause-first
          // on every draft type since 090 (D141).
          disabled={gate.blocked || !pickId || (!newTeam && !newPlayer) || reassign.isPending}
          title={gate.reason ?? undefined}
          onClick={() =>
            reassign
              .mutateAsync({
                pickId,
                ...(newTeam ? { teamId: newTeam } : {}),
                ...(newPlayer ? { playerId: newPlayer.id } : {}),
              })
              .then(() => {
                setPickId('')
                setNewTeam('')
                setNewPlayer(null)
              })
              .catch((e: unknown) => onError(e, 'Reassign failed'))
          }
        >
          Reassign pick
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px]">Move a drafted player</Label>
        <Select value={movePickNumber} onValueChange={setMovePickNumber} disabled={gate.blocked}>
          <SelectTrigger className="h-btn-md text-[12px] font-bold" aria-label="Player to move">
            <SelectValue placeholder="Choose a drafted player…" />
          </SelectTrigger>
          <SelectContent>
            {livePicks.map((p) => (
              <SelectItem key={p.pick_number} value={String(p.pick_number)}>
                {playerLabel(p.player_id)} ({pickSummary(p)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={moveTo} onValueChange={setMoveTo} disabled={gate.blocked}>
          <SelectTrigger className="h-btn-md text-[12px] font-bold" aria-label="Destination team">
            <SelectValue placeholder="Move to team…" />
          </SelectTrigger>
          <SelectContent>
            {activeTeams
              .filter((t) => t.id !== movePick?.team_id)
              .map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Button
          variant="stroke"
          size="sm"
          disabled={gate.blocked || !movePick || !moveTo || movePlayer.isPending}
          title={gate.reason ?? undefined}
          onClick={() =>
            movePick &&
            movePlayer
              .mutateAsync({
                playerId: movePick.player_id,
                fromTeam: movePick.team_id,
                toTeam: moveTo,
              })
              .then(() => {
                setMovePickNumber('')
                setMoveTo('')
              })
              .catch((e: unknown) => onError(e, 'Move failed'))
          }
        >
          Move player
        </Button>
      </div>
    </PanelSection>
  )
}

// ---------------------------------------------------------------------------
// Force pick (§8.7 "Pick for a manager"; live only — 069 refuses paused)
// ---------------------------------------------------------------------------

function ForcePickSection({
  leagueId,
  draft,
  teamsById,
  isAuction,
  onError,
}: {
  leagueId: string
  draft: Draft
  teamsById: ReadonlyMap<string, { name: string }>
  isAuction: boolean
  onError: (error: unknown, title: string) => void
}) {
  const force = useForcePick(leagueId, draft.id)
  const [player, setPlayer] = useState<{ id: string; name: string } | null>(null)
  const onClockName = draft.on_clock_team_id
    ? (teamsById.get(draft.on_clock_team_id)?.name ?? 'the on-clock team')
    : 'the on-clock team'
  const live = draft.status === 'live'

  // L.C3.2: on an auction, 087's arm (R301) makes this a force-NOMINATION at
  // the §8.6.2 nomination floor (092/AP.1 — $1, or $0 in a league that allows
  // $0 nominations), legal only in the NOMINATING phase — there is
  // deliberately no commissioner force-BID (§8.6.5/OQ 10). The copy says
  // what the verb does rather than borrowing the snake sentence.
  return (
    <PanelSection
      title={isAuction ? 'Nominate for a manager' : 'Pick for a manager'}
      hint={
        live
          ? isAuction
            ? `Opens a nomination for ${onClockName} at this league's nomination floor (disconnect/AFK relief) — bidding then runs as normal.`
            : `Drafts the player for ${onClockName} (disconnect/AFK relief).`
          : 'Resume the draft first — a paused clock can’t take a pick (069).'
      }
    >
      <PlayerSearchPicker label="Player" selected={player} onSelect={setPlayer} />
      <Button
        variant="stroke"
        size="sm"
        disabled={!player || !live || force.isPending}
        onClick={() =>
          player &&
          force
            .forcePickAsync(player.id)
            .then(() => setPlayer(null))
            .catch((e: unknown) => onError(e, isAuction ? 'Force nomination failed' : 'Force pick failed'))
        }
      >
        {player
          ? isAuction
            ? `Nominate ${player.name} for ${onClockName}`
            : `Draft ${player.name} for ${onClockName}`
          : 'Choose a player'}
      </Button>
    </PanelSection>
  )
}

// ---------------------------------------------------------------------------
// Order editor (E31 — completed picks stand, remaining re-derive)
// ---------------------------------------------------------------------------

function OrderSection({
  leagueId,
  draft,
  detail,
  isAuction,
  onError,
}: {
  leagueId: string
  draft: Draft
  detail: LeagueDetail
  isAuction: boolean
  onError: (error: unknown, title: string) => void
}) {
  const patchOrder = useDraftOrder(leagueId)
  // L.C3.2: on a started AUCTION the order this control edits is
  // `nomination_order`, not `draft_order` (087's `draft_set_order` auction
  // arm) — reading the draft order here would have shown a list the save
  // never touches, and gone stale the moment the two diverged.
  const storedOrder = useMemo(
    () => parseDraftOrder(isAuction ? draft.nomination_order : draft.draft_order),
    [isAuction, draft.nomination_order, draft.draft_order],
  )
  const [order, setOrder] = useState<readonly string[] | null>(null)
  const [reason, setReason] = useState('')
  const teamsById = useMemo(() => new Map(detail.teams.map((t) => [t.id, t])), [detail.teams])

  const working = order ?? storedOrder
  const dirty = order !== null && order.join('|') !== storedOrder.join('|')

  return (
    <PanelSection
      title={isAuction ? 'Nomination order' : 'Draft order'}
      hint={
        isAuction
          ? 'Completed nominations stand; the rotation follows the new order from the next nomination (§8.3). A reason is required mid-draft.'
          : 'Completed picks stand; remaining picks re-derive from the new order (E31). A reason is required mid-draft.'
      }
    >
      <ol className="flex flex-col gap-1">
        {working.map((teamId, index) => (
          <li
            key={teamId}
            className="flex items-center justify-between gap-1.5 rounded-sm border border-ink px-2 py-1 text-[12px] font-semibold"
          >
            <span className="min-w-0 truncate">
              <span className="fs-num text-n-3">{index + 1}.</span>{' '}
              {teamsById.get(teamId)?.name ?? 'Team'}
            </span>
            <span className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => setOrder(moveOrderEntry(working, index, 'up'))}
              >
                ↑
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Move down"
                disabled={index === working.length - 1}
                onClick={() => setOrder(moveOrderEntry(working, index, 'down'))}
              >
                ↓
              </Button>
            </span>
          </li>
        ))}
      </ol>
      <ReasonInput value={reason} onChange={setReason} required />
      <div className="flex items-center gap-1.5">
        <Button
          variant="stroke"
          size="sm"
          disabled={!dirty || reason.trim().length === 0 || patchOrder.isPending}
          onClick={() =>
            patchOrder
              .mutateAsync({ order: [...working], reason: reason.trim() })
              .then(() => {
                setOrder(null)
                setReason('')
                toast({ title: isAuction ? 'Nomination order updated' : 'Draft order updated' })
              })
              .catch((e: unknown) => onError(e, 'Order edit failed'))
          }
        >
          Save order
        </Button>
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => setOrder(null)}>
            Discard
          </Button>
        )}
      </div>
    </PanelSection>
  )
}

// ---------------------------------------------------------------------------
// Autopick per seat (§8.7 "Toggle autopick for any team" — 072's RPC)
// ---------------------------------------------------------------------------

function AutopickSection({
  leagueId,
  detail,
  onError,
}: {
  leagueId: string
  detail: LeagueDetail
  onError: (error: unknown, title: string) => void
}) {
  const setAutodraft = useSetMemberAutodraft(leagueId)
  const teamsById = useMemo(() => new Map(detail.teams.map((t) => [t.id, t])), [detail.teams])
  const seats = detail.members.filter((m) => m.team_id)

  return (
    <PanelSection
      title="Autopick"
      hint="Force a seat to (or from) auto mode — its badge shows in the room (§16.5.4)."
    >
      <ul className="flex flex-col gap-1">
        {seats.map((member) => {
          const teamName = member.team_id
            ? (teamsById.get(member.team_id)?.name ?? 'Team')
            : 'Team'
          const noUser = !member.user_id
          return (
            <li
              key={member.id}
              className="flex items-center justify-between gap-1.5 rounded-sm border border-ink px-2 py-1"
            >
              <span className="min-w-0 truncate text-[12px] font-semibold">
                {teamName}
                {member.profiles && (
                  <span className="text-n-3"> — @{member.profiles.username}</span>
                )}
              </span>
              {noUser ? (
                // A seat with no user autopicks by rule (E48/D102) — there
                // is nothing to toggle, and pretending otherwise would lie.
                <span className="fs-overline shrink-0 text-[9px] text-n-3">Auto (no manager)</span>
              ) : (
                <Switch
                  checked={member.is_autodraft === true}
                  disabled={setAutodraft.isPending}
                  aria-label={`Autopick for ${teamName}`}
                  onCheckedChange={(next) =>
                    setAutodraft
                      .mutateAsync({ memberId: member.id, on: next === true })
                      .catch((e: unknown) => onError(e, 'Autopick toggle failed'))
                  }
                />
              )}
            </li>
          )
        })}
      </ul>
    </PanelSection>
  )
}

// ---------------------------------------------------------------------------
// Seat controls (§8.7 "Reassign a draft seat" — M1's membership surface
// COMPOSED, no new RPC; E48 covers the mid-draft claim path)
// ---------------------------------------------------------------------------

function SeatControlsSection({
  leagueId,
  detail,
}: {
  leagueId: string
  detail: LeagueDetail
}) {
  // INLINE expand, deliberately not a nested Dialog: a modal Dialog opened
  // from inside the Sheet (itself a Radix Dialog) steals focus, the Sheet
  // treats it as an outside interaction and closes, and the unmount takes
  // the child dialog with it — observed live in the L.B3.3 D39 pass.
  const [open, setOpen] = useState(false)
  return (
    <PanelSection
      title="Reassign a draft seat"
      hint="Swap who controls a team with the league's seat tools — invites, assignment, takeover. A mid-draft claim takes over immediately (E48)."
    >
      <Button variant="stroke" size="sm" onClick={() => setOpen((prev) => !prev)}>
        {open ? 'Hide seat controls' : 'Open seat controls'}
      </Button>
      {open && <InvitePanel leagueId={leagueId} detail={detail} />}
    </PanelSection>
  )
}

// ---------------------------------------------------------------------------
// Reset (§8.7 — hard confirm; 069 owns the semantics + the D107(5) seam)
// ---------------------------------------------------------------------------

const RESET_CONFIRM_WORD = 'RESET'

function ResetSection({
  leagueId,
  draftId,
  onError,
}: {
  leagueId: string
  draftId: string
  onError: (error: unknown, title: string) => void
}) {
  const reset = useResetDraft(leagueId, draftId)
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [reason, setReason] = useState('')

  return (
    <PanelSection
      title="Reset draft"
      hint="Wipes every pick back to pre-draft and returns the league to scheduled. It cannot be silent."
    >
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Reset draft…
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setConfirmText('')
            setReason('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset the entire draft?</DialogTitle>
            <DialogDescription>
              Every pick is reverted, the draft and league return to <b>scheduled</b>, and the
              stored draft time is cleared — re-schedule (or press Start) to draft again. The
              room sees a system post; this cannot be undone from here.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">
              Type <span className="fs-num font-bold">{RESET_CONFIRM_WORD}</span> to confirm
            </Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              aria-label="Type RESET to confirm"
              className="h-btn-md text-[12px]"
            />
          </div>
          <ReasonInput value={reason} onChange={setReason} />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Keep the draft
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={confirmText !== RESET_CONFIRM_WORD || reset.isPending}
              onClick={() =>
                reset
                  .mutateAsync({ ...(reason.trim() ? { reason: reason.trim() } : {}) })
                  .then(() => setOpen(false))
                  .catch((e: unknown) => onError(e, 'Reset failed'))
              }
            >
              {reset.isPending ? 'Resetting…' : 'Reset the draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PanelSection>
  )
}

// ---------------------------------------------------------------------------
// AUCTION SECTIONS (M3 task L.C3.2 — spec §8.7's v2.10 auction rows; D141's
// pause-first gate; D142 Manual Edit Mode; D143 cancel-and-renominate; E28's
// budget arms; C41's ruled End-as-is). Each is a `Draft Options` GROUP over
// the L.C2.2 routes — no new door, no floating affordance (§8.7's v2.12
// note).
//
// DOUBLE-SUBMIT POSTURE, stated once for all four (the L.C2.2 review's
// hand-off): 087's four auction verbs take NO `action_id` (D188(4)), so the
// wire has no idempotency key. Three of them are self-guarding on a replay —
// a second `reverse-bid` on the same pick meets "not a live pick", a second
// `cancel-nomination` meets "no player is nominated", a second `end` meets
// "already complete" — but **`draft_adjust_budget`'s delta is CUMULATIVE**
// (087: `v_after := v_before + p_delta`), so a double submit moves twice the
// money and nothing refuses it. Every submit below is therefore disabled
// while its mutation is pending; the budget editor is the one where that
// disable is load-bearing rather than good manners, and it is pinned.
// ---------------------------------------------------------------------------

/** One drafted cell in Manual Edit Mode — the click target §8.7 names. */
interface ManualEditTarget {
  pickNumber: number
  /** The `draft_picks` row id — null on a broadcast hint row that has not
   *  reconciled yet (the same second-long gap the reassign select has). */
  pickId: string | null
  playerId: string
  playerName: string
  price: number | null
  teamId: string
  teamName: string
}

function ManualEditSection({
  leagueId,
  draftId,
  columns,
  budgets,
  reserve,
  playerById,
  livePicks,
  gate,
  onError,
}: {
  leagueId: string
  draftId: string
  columns: readonly AuctionTeamColumn[]
  budgets: ReadonlyMap<string, TeamBudget | null>
  reserve: 0 | 1
  playerById: ReadonlyMap<string, PlayerIdentity>
  livePicks: DraftPickSummary[]
  gate: ControlGate
  onError: (error: unknown, title: string) => void
}) {
  // D142: "enter mode → click any drafted player's cell → modal with exactly
  // two choices". The mode is a real state, not decoration: money-moving
  // paths should not be one stray click away, and arming is the beat that
  // separates browsing the board from editing it.
  const [armed, setArmed] = useState(false)
  const [target, setTarget] = useState<ManualEditTarget | null>(null)

  const pickIdByNumber = useMemo(
    () => new Map(livePicks.map((p) => [p.pick_number, p.id ?? null])),
    [livePicks],
  )
  const drafted = columns.reduce((sum, column) => sum + column.picks.length, 0)

  return (
    <PanelSection
      title="Manual Edit Mode"
      hint={
        gate.reason ??
        'Enter the mode, then click a drafted player: reset the pick (refund) or move the player to another team (the new owner is charged the cost you re-enter). §8.7'
      }
    >
      <Button
        variant={armed ? 'green' : 'stroke'}
        size="sm"
        disabled={gate.blocked || drafted === 0}
        title={gate.reason ?? undefined}
        aria-pressed={armed}
        onClick={() => setArmed((current) => !current)}
      >
        {armed ? 'Exit Manual Edit Mode' : 'Enter Manual Edit Mode'}
      </Button>

      {drafted === 0 && (
        <p className="text-[11px] font-medium text-n-3">
          Nothing has been bought yet — there are no picks to edit.
        </p>
      )}

      {armed && !gate.blocked && (
        <div className="flex flex-col gap-1.5" aria-label="Drafted players by team">
          {columns.map((column) => (
            <div key={column.teamId} className="flex flex-col gap-1">
              <span className="fs-overline text-[9px] text-n-3">
                {column.name}
                {column.budget ? ` · $${column.budget.remaining} left` : ''}
              </span>
              {column.picks.length === 0 ? (
                <span className="text-[10px] font-medium text-n-3">No buys yet</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {column.picks.map((pick) => {
                    const player = playerById.get(pick.playerId)
                    return (
                      <button
                        key={pick.pickNumber}
                        type="button"
                        className="flex items-center gap-1 rounded-sm border border-ink bg-white px-1.5 py-0.5 text-[11px] font-bold transition-colors hover:bg-accent-soft"
                        onClick={() =>
                          setTarget({
                            pickNumber: pick.pickNumber,
                            pickId: pickIdByNumber.get(pick.pickNumber) ?? null,
                            playerId: pick.playerId,
                            playerName: player ? player.full_name : pick.playerId,
                            price: pick.price,
                            teamId: column.teamId,
                            teamName: column.name,
                          })
                        }
                      >
                        <span className="max-w-[120px] truncate">
                          {player ? abbreviateName(player.full_name) : pick.playerId}
                        </span>
                        <span className="fs-num text-n-3">${pick.price ?? reserve}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* R437: the dialog lives OUTSIDE the `armed && !gate.blocked` guard
          above (it must survive the mode toggle), so it carries the gate
          itself — a resume by a co-commissioner disarms its confirms. */}
      <ManualEditDialog
        leagueId={leagueId}
        draftId={draftId}
        target={target}
        budgets={budgets}
        reserve={reserve}
        columns={columns}
        gate={gate}
        onClose={() => setTarget(null)}
        onError={onError}
      />
    </PanelSection>
  )
}

/** D142's modal: EXACTLY two choices, and the move's cost is re-entered. */
function ManualEditDialog({
  leagueId,
  draftId,
  target,
  budgets,
  reserve,
  columns,
  gate,
  onClose,
  onError,
}: {
  leagueId: string
  draftId: string
  target: ManualEditTarget | null
  budgets: ReadonlyMap<string, TeamBudget | null>
  reserve: 0 | 1
  columns: readonly AuctionTeamColumn[]
  gate: ControlGate
  onClose: () => void
  onError: (error: unknown, title: string) => void
}) {
  const reverse = useReverseWonBid(leagueId, draftId)
  const movePlayer = useMovePlayer(leagueId, draftId)
  const [choice, setChoice] = useState<'reset' | 'move' | null>(null)
  const [toTeam, setToTeam] = useState('')
  const [price, setPrice] = useState('')
  const [reason, setReason] = useState('')

  const close = () => {
    setChoice(null)
    setToTeam('')
    setPrice('')
    setReason('')
    onClose()
  }

  const cost = priceEntry({ raw: price, reserve, receivingBudget: budgets.get(toTeam) ?? null })
  const reasonReady = reason.trim().length > 0

  return (
    <Dialog open={target !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target ? `${target.playerName} — $${target.price ?? reserve}` : 'Edit a pick'}
          </DialogTitle>
          <DialogDescription>
            {target
              ? `Bought by ${target.teamName} at nomination #${target.pickNumber}. Every edit posts to the draft chat.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {choice === null && (
          <div className="flex flex-col gap-1.5">
            <Button
              variant="stroke"
              size="sm"
              disabled={target?.pickId === null}
              title={
                target?.pickId === null
                  ? 'This pick is still arriving — try again in a second.'
                  : undefined
              }
              onClick={() => setChoice('reset')}
            >
              Reset pick — player back to the pool, manager refunded
            </Button>
            <Button variant="stroke" size="sm" onClick={() => setChoice('move')}>
              Move player to a different team
            </Button>
          </div>
        )}

        {choice === 'reset' && target && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[12px] font-semibold">
              {target.playerName} returns to the pool and {target.teamName} is refunded{' '}
              <span className="fs-num font-extrabold">${target.price ?? reserve}</span>.
            </p>
            <ReasonInput value={reason} onChange={setReason} required />
          </div>
        )}

        {choice === 'move' && target && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px]">New team</Label>
            <Select value={toTeam} onValueChange={setToTeam}>
              <SelectTrigger className="h-btn-md text-[12px] font-bold" aria-label="New team">
                <SelectValue placeholder="Move to team…" />
              </SelectTrigger>
              <SelectContent>
                {columns
                  .filter((column) => column.teamId !== target.teamId)
                  .map((column) => (
                    <SelectItem
                      key={column.teamId}
                      value={column.teamId}
                      // A full roster is a refusal the engine already owns
                      // (090's capacity arm) — offered as visibly unavailable
                      // rather than as a click that fails.
                      disabled={column.rosterComplete}
                    >
                      {column.name}
                      {column.rosterComplete
                        ? ' — roster full'
                        : column.budget
                          ? ` — max bid $${column.budget.maxBid}`
                          : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Label className="text-[11px]">Cost to the new team (re-enter it)</Label>
            <Input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="numeric"
              aria-label="Cost to the new team"
              className="h-btn-md w-28 text-[12px]"
            />
            <p className="text-[10px] font-medium text-n-3">{cost.hint}</p>
            <ReasonInput value={reason} onChange={setReason} required />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close}>
            {choice === null ? 'Close' : 'Back out'}
          </Button>
          {choice === 'reset' && (
            <Button
              variant="destructive"
              size="sm"
              // R437: gate.blocked here too — `draft_reverse_won_bid` is
              // pause-first (090), and this dialog outlives the resume.
              disabled={gate.blocked || !reasonReady || !target?.pickId || reverse.isPending}
              title={gate.reason ?? undefined}
              onClick={() =>
                target?.pickId &&
                reverse
                  .mutateAsync({ pickId: target.pickId, reason: reason.trim() })
                  .then(close)
                  .catch((e: unknown) => onError(e, 'Reset pick failed'))
              }
            >
              {reverse.isPending ? 'Resetting…' : 'Reset the pick'}
            </Button>
          )}
          {choice === 'move' && (
            <Button
              variant="stroke"
              size="sm"
              // R437: `draft_move_player` is pause-first too (090).
              disabled={
                gate.blocked ||
                !target ||
                !toTeam ||
                cost.blocker !== null ||
                !reasonReady ||
                movePlayer.isPending
              }
              title={gate.reason ?? undefined}
              onClick={() =>
                target &&
                cost.parsed !== null &&
                movePlayer
                  .mutateAsync({
                    playerId: target.playerId,
                    fromTeam: target.teamId,
                    toTeam,
                    price: cost.parsed,
                    reason: reason.trim(),
                  })
                  .then(close)
                  .catch((e: unknown) => onError(e, 'Move failed'))
              }
            >
              {movePlayer.isPending ? 'Moving…' : 'Move the player'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Edit current nomination (D143 — cancel-and-renominate; paused only)
// ---------------------------------------------------------------------------

function CancelNominationSection({
  leagueId,
  draftId,
  nomination,
  nominatingTeamName,
  playerLabel,
  gate,
  onError,
}: {
  leagueId: string
  draftId: string
  nomination: { player_id: string; high_bid: number; high_bidder_team_id: string } | null
  nominatingTeamName: string | null
  playerLabel: (playerId: string) => string
  gate: ControlGate
  onError: (error: unknown, title: string) => void
}) {
  const cancel = useCancelNomination(leagueId, draftId)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  return (
    <PanelSection
      title="Edit current nomination"
      hint={
        gate.reason ??
        'There is no swap-in-place: the live nomination is cancelled (open bids void, no money moves, the sequence number is not consumed) and the same team nominates again on resume (D143).'
      }
    >
      {nomination ? (
        <p className="text-[12px] font-semibold">
          On the block: <span className="font-extrabold">{playerLabel(nomination.player_id)}</span>{' '}
          at <span className="fs-num font-extrabold">${nomination.high_bid}</span>
          {nominatingTeamName ? ` · ${nominatingTeamName} nominates again on resume` : ''}
        </p>
      ) : (
        <p className="text-[11px] font-medium text-n-3">
          No player is nominated right now — there is nothing to cancel.
        </p>
      )}
      <Button
        variant="stroke"
        size="sm"
        disabled={gate.blocked || !nomination}
        title={gate.reason ?? undefined}
        onClick={() => setOpen(true)}
      >
        Cancel this nomination…
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setReason('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel the live nomination?</DialogTitle>
            <DialogDescription>
              {nomination
                ? `${playerLabel(nomination.player_id)} comes off the block at $${nomination.high_bid}. Every open bid is voided — no money moves — and ${nominatingTeamName ?? 'the same team'} nominates again when the draft resumes.`
                : 'Nothing is nominated right now.'}
            </DialogDescription>
          </DialogHeader>
          <ReasonInput value={reason} onChange={setReason} required />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Keep the nomination
            </Button>
            <Button
              variant="destructive"
              size="sm"
              // R437: the confirm reads the gate — `draft_cancel_nomination`
              // is pause-first (090) and this dialog outlives a resume.
              disabled={
                gate.blocked || reason.trim().length === 0 || !nomination || cancel.isPending
              }
              title={gate.reason ?? undefined}
              onClick={() =>
                cancel
                  .mutateAsync({ reason: reason.trim() })
                  .then(() => {
                    setOpen(false)
                    setReason('')
                  })
                  .catch((e: unknown) => onError(e, 'Cancel nomination failed'))
              }
            >
              {cancel.isPending ? 'Cancelling…' : 'Cancel the nomination'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PanelSection>
  )
}

// ---------------------------------------------------------------------------
// Team budgets (§8.7 "adjust a team's remaining budget"; E28's arms carry the
// remedy copy). NOT pause-gated — D141's ruled set does not name it.
// ---------------------------------------------------------------------------

function BudgetSection({
  leagueId,
  draftId,
  teams,
  budgets,
  reserve,
  nomination,
  onError,
}: {
  leagueId: string
  draftId: string
  teams: ReadonlyArray<{ id: string; name: string }>
  budgets: ReadonlyMap<string, TeamBudget | null>
  reserve: 0 | 1
  nomination: { high_bid: number; high_bidder_team_id: string } | null
  onError: (error: unknown, title: string) => void
}) {
  const adjustBudget = useAdjustBudget(leagueId, draftId)
  const [teamId, setTeamId] = useState('')
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')

  const parsedDelta = /^-?\d+$/.test(delta.trim()) ? Number.parseInt(delta.trim(), 10) : null
  const preview = budgetEditPreview({
    budget: budgets.get(teamId) ?? null,
    delta: parsedDelta ?? 0,
    reserve,
    highBidHeld:
      nomination && nomination.high_bidder_team_id === teamId ? nomination.high_bid : null,
  })
  const teamName = teams.find((t) => t.id === teamId)?.name ?? 'This team'

  return (
    <PanelSection
      title="Team budgets"
      hint="Add or remove dollars from a team's auction budget. Adjustments COMPOSE — each one is added to what came before. Runs live or paused (§8.7)."
    >
      <Select value={teamId} onValueChange={setTeamId}>
        <SelectTrigger className="h-btn-md text-[12px] font-bold" aria-label="Team to adjust">
          <SelectValue placeholder="Choose a team…" />
        </SelectTrigger>
        <SelectContent>
          {teams.map((team) => {
            const budget = budgets.get(team.id) ?? null
            return (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
                {budget ? ` — $${budget.remaining} left` : ''}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>

      <div className="flex flex-col gap-1">
        <Label className="text-[11px]" htmlFor="commish-budget-delta">
          Adjustment (dollars — negative removes)
        </Label>
        <Input
          id="commish-budget-delta"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          inputMode="numeric"
          placeholder="+10 / -10"
          aria-label="Budget adjustment"
          className="h-btn-md w-28 text-[12px]"
        />
      </div>

      {/* The live solvency preview (§8.7's row) — the DISPLAY-ONLY mirror of
          084, never a decision: the submit stays enabled and the RPC's E28
          refusal, with its own numbers and remedy, is what a commissioner
          reads if a floor is really breached. */}
      {preview.before && (
        <div className="flex flex-col gap-0.5 rounded-sm border border-n-4 px-2 py-1.5 text-[11px] font-semibold">
          <span className="fs-overline text-[9px] text-n-3">
            {parsedDelta === null || parsedDelta === 0 ? 'Now' : 'After this adjustment'}
          </span>
          <span>
            Budget{' '}
            <span className="fs-num font-extrabold">
              ${(preview.after ?? preview.before).remaining}
            </span>{' '}
            · max bid{' '}
            <span className="fs-num font-extrabold">
              ${(preview.after ?? preview.before).maxBid}
            </span>{' '}
            · <span className="fs-num">{preview.before.openSlots}</span> open{' '}
            {preview.before.openSlots === 1 ? 'spot' : 'spots'}
          </span>
          {preview.note && (
            <span className="text-negative-strong">
              {teamName}: {preview.note}
            </span>
          )}
        </div>
      )}

      <ReasonInput value={reason} onChange={setReason} required />
      <Button
        variant="stroke"
        size="sm"
        // DOUBLE-SUBMIT GUARD — a UX courtesy now, not the safety mechanism:
        // since 099/AP.6 (E69, F82 discharged) `useAdjustBudget` mints ONE
        // `action_id` per submit and `draft_adjust_budget` replays the
        // ORIGINAL result on a repeat, so the double-charge R438 named is
        // closed in the engine where it bites (the guard's mount-scoping —
        // no `forceMount` on `SheetContent` — no longer matters for money;
        // it just spares the commissioner a duplicate no-op round-trip).
        disabled={
          !teamId ||
          parsedDelta === null ||
          parsedDelta === 0 ||
          reason.trim().length === 0 ||
          adjustBudget.isPending
        }
        onClick={() =>
          parsedDelta !== null &&
          adjustBudget
            // adjustBudgetAsync mints the per-submit action_id (D68 pattern).
            .adjustBudgetAsync(teamId, parsedDelta, reason.trim())
            .then(() => {
              setDelta('')
              setReason('')
              toast({ title: 'Budget adjusted' })
            })
            .catch((e: unknown) => onError(e, 'Budget edit failed'))
        }
      >
        {adjustBudget.isPending ? 'Adjusting…' : 'Adjust budget'}
      </Button>
    </PanelSection>
  )
}

// ---------------------------------------------------------------------------
// End draft (C41 RULED end-as-is — spec v2.10.1 §8.7). Terminal, like Reset,
// so it takes Reset's hard-confirm treatment: the consequences listed, and a
// word typed. The ROUTE takes no confirm phrase (D188(3)) — the hard confirm
// is entirely this control's, which is why it is pinned.
// ---------------------------------------------------------------------------

function EndDraftSection({
  leagueId,
  draftId,
  unfilled,
  onError,
}: {
  leagueId: string
  draftId: string
  unfilled: number | null
  onError: (error: unknown, title: string) => void
}) {
  const endDraft = useEndDraft(leagueId, draftId)
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [reason, setReason] = useState('')
  const consequences = endDraftConsequences(unfilled)

  return (
    <PanelSection
      title="End draft"
      hint="Ends the auction as it stands and moves the league to in-season. It cannot be silent, and it cannot be undone from here."
    >
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        End draft…
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setConfirmText('')
            setReason('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End this auction now?</DialogTitle>
            <DialogDescription>
              Ending stops the draft where it is. Here is exactly what happens:
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1 text-[12px] font-semibold text-ink">
            {consequences.map((line) => (
              <li key={line} className="rounded-sm border border-ink px-2 py-1">
                {line}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">
              Type <span className="fs-num font-bold">{END_CONFIRM_WORD}</span> to confirm
            </Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              aria-label="Type END to confirm"
              className="h-btn-md text-[12px]"
            />
          </div>
          <ReasonInput value={reason} onChange={setReason} required />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Keep drafting
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={
                confirmText !== END_CONFIRM_WORD ||
                reason.trim().length === 0 ||
                endDraft.isPending
              }
              onClick={() =>
                endDraft
                  .mutateAsync({ reason: reason.trim() })
                  .then(() => setOpen(false))
                  .catch((e: unknown) => onError(e, 'End draft failed'))
              }
            >
              {endDraft.isPending ? 'Ending…' : 'End the draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PanelSection>
  )
}

// ---------------------------------------------------------------------------
// Tiny player picker (shared by reassign/force) — rides the SAME bounded
// server-searched pool read as available-players (use-draft-pool; the
// "exactly 1000 rows" lesson: search narrows the QUERY, never a page scan).
// ---------------------------------------------------------------------------

function PlayerSearchPicker({
  label,
  selected,
  onSelect,
  disabled = false,
}: {
  label: string
  selected: { id: string; name: string } | null
  onSelect: (next: { id: string; name: string } | null) => void
  disabled?: boolean
}) {
  const [term, setTerm] = useState('')
  const pool = useDraftPool(term, '')
  const results = term.trim() && !disabled ? (pool.data ?? []).slice(0, 6) : []

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-1.5 rounded-sm border border-accent bg-accent-soft px-2 py-1">
        <span className="min-w-0 truncate text-[12px] font-semibold">{selected.name}</span>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onSelect(null)}>
          Change
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px]">{label}</Label>
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search players…"
        aria-label={label}
        disabled={disabled}
        className="h-btn-md text-[12px]"
      />
      {results.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full rounded-sm border border-ink px-2 py-1 text-left text-[12px] font-semibold transition-colors hover:bg-n-4"
                onClick={() => {
                  onSelect({ id: p.id, name: p.full_name })
                  setTerm('')
                }}
              >
                {p.full_name}
                <span className="text-n-3">
                  {' '}
                  · {p.position} · {p.team ?? '—'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
