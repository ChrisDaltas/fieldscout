'use client'

import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  useForcePick,
  useMovePlayer,
  usePauseResumeDraft,
  useReassignPick,
  useResetDraft,
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
  cascadeTargetBounds,
  deriveUndoPreview,
  moveOrderEntry,
  pickTimerLabel,
  type UndoTarget,
} from './commish-panel-ops'
import { parseDraftOrder } from './draft-board-ops'

interface CommishDraftPanelProps {
  leagueId: string
  draft: Draft
  detail: LeagueDetail
  picks: DraftPickSummary[]
  playerById: ReadonlyMap<string, PlayerIdentity>
  /** DR.2 (D153): the panel is CONTROLLED — its own blue `Commish panel`
   *  SheetTrigger is retired; the command bar's `Draft Options` control is
   *  the one door (DR.3 swaps that door's target for `draft-options-menu`,
   *  which opens this same panel at a section). */
  open: boolean
  onOpenChange: (open: boolean) => void
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
}: CommishDraftPanelProps) {
  const paused = draft.status === 'paused'
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // Distinct accent on the overlay itself (§16.3) — the sheet's
        // leading edge carries it. Scrolls: the §8.7 control list is long.
        className="flex w-full flex-col gap-4 overflow-y-auto border-l-2 border-accent sm:max-w-md"
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

        <ClockSection
          leagueId={leagueId}
          draft={draft}
          paused={paused}
          onError={surfaceError}
        />
        <UndoSection
          leagueId={leagueId}
          draftId={draft.id}
          livePicks={livePicks}
          pickSummary={pickSummary}
          onError={surfaceError}
        />
        <FixPickSection
          leagueId={leagueId}
          draftId={draft.id}
          livePicks={livePicks}
          detail={detail}
          pickSummary={pickSummary}
          playerLabel={playerLabel}
          onError={surfaceError}
        />
        <ForcePickSection
          leagueId={leagueId}
          draft={draft}
          teamsById={teamsById}
          onError={surfaceError}
        />
        <OrderSection leagueId={leagueId} draft={draft} detail={detail} onError={surfaceError} />
        <AutopickSection leagueId={leagueId} detail={detail} onError={surfaceError} />
        <SeatControlsSection leagueId={leagueId} detail={detail} />
        <ResetSection leagueId={leagueId} draftId={draft.id} onError={surfaceError} />
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
  onError,
}: {
  leagueId: string
  draft: Draft
  paused: boolean
  onError: (error: unknown, title: string) => void
}) {
  const pauseResume = usePauseResumeDraft(leagueId, draft.id)
  const setClock = useSetDraftClock(leagueId, draft.id)
  const [timer, setTimer] = useState<string>('')
  const [extendCurrent, setExtendCurrent] = useState(false)

  return (
    <PanelSection
      title="Clock"
      hint="Pause freezes every clock; resume restores the exact remaining time (§8.7)."
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

      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px]">New pick clock (applies to subsequent picks)</Label>
        <Select value={timer} onValueChange={setTimer}>
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
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-ink">
          <Checkbox
            checked={extendCurrent}
            onCheckedChange={(next) => setExtendCurrent(next === true)}
            disabled={paused}
          />
          Also extend the current pick{paused ? ' (resume first)' : ''}
        </label>
        <Button
          variant="stroke"
          size="sm"
          disabled={timer === '' || setClock.isPending}
          onClick={() =>
            setClock
              .mutateAsync({ pickTimerSeconds: Number(timer), extendCurrent })
              .then(() => toast({ title: 'Pick clock updated' }))
              .catch((e: unknown) => onError(e, 'Clock edit failed'))
          }
        >
          Apply clock
        </Button>
      </div>
    </PanelSection>
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
  onError,
}: {
  leagueId: string
  draftId: string
  livePicks: DraftPickSummary[]
  pickSummary: (p: DraftPickSummary) => string
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
      title="Undo picks"
      hint="Undone picks return to the pool and the clock rewinds to that team (E4)."
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="stroke" size="sm" disabled={livePicks.length === 0} onClick={openSingle}>
          Undo last pick
        </Button>
        <div className="flex items-center gap-1.5">
          <Input
            value={cascadeFrom}
            onChange={(e) => setCascadeFrom(e.target.value)}
            inputMode="numeric"
            placeholder={bounds ? `Pick ${bounds.min}–${bounds.max}` : 'No picks yet'}
            disabled={!bounds}
            aria-label="First pick to revert"
            className="h-btn-md w-28 text-[12px]"
          />
          <Button variant="stroke" size="sm" disabled={!bounds} onClick={openCascade}>
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
              disabled={undo.isPending || !preview || preview.reverts.length === 0}
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
  detail,
  pickSummary,
  playerLabel,
  onError,
}: {
  leagueId: string
  draftId: string
  livePicks: DraftPickSummary[]
  detail: LeagueDetail
  pickSummary: (p: DraftPickSummary) => string
  playerLabel: (playerId: string) => string
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
      hint="Correct the player a pick selected, or move a drafted player between teams — exclusivity is validated (§8.7)."
    >
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px]">Reassign a pick</Label>
        <Select value={pickId} onValueChange={setPickId}>
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
        <Select value={newTeam} onValueChange={setNewTeam}>
          <SelectTrigger className="h-btn-md text-[12px] font-bold" aria-label="New team">
            <SelectValue placeholder="New team (optional)" />
          </SelectTrigger>
          <SelectContent>
            {detail.teams.map((t) => (
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
        />
        <Button
          variant="stroke"
          size="sm"
          disabled={!pickId || (!newTeam && !newPlayer) || reassign.isPending}
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
        <Select value={movePickNumber} onValueChange={setMovePickNumber}>
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
        <Select value={moveTo} onValueChange={setMoveTo}>
          <SelectTrigger className="h-btn-md text-[12px] font-bold" aria-label="Destination team">
            <SelectValue placeholder="Move to team…" />
          </SelectTrigger>
          <SelectContent>
            {detail.teams
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
          disabled={!movePick || !moveTo || movePlayer.isPending}
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
  onError,
}: {
  leagueId: string
  draft: Draft
  teamsById: ReadonlyMap<string, { name: string }>
  onError: (error: unknown, title: string) => void
}) {
  const force = useForcePick(leagueId, draft.id)
  const [player, setPlayer] = useState<{ id: string; name: string } | null>(null)
  const onClockName = draft.on_clock_team_id
    ? (teamsById.get(draft.on_clock_team_id)?.name ?? 'the on-clock team')
    : 'the on-clock team'
  const live = draft.status === 'live'

  return (
    <PanelSection
      title="Pick for a manager"
      hint={
        live
          ? `Drafts the player for ${onClockName} (disconnect/AFK relief).`
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
            .catch((e: unknown) => onError(e, 'Force pick failed'))
        }
      >
        {player ? `Draft ${player.name} for ${onClockName}` : 'Choose a player'}
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
  onError,
}: {
  leagueId: string
  draft: Draft
  detail: LeagueDetail
  onError: (error: unknown, title: string) => void
}) {
  const patchOrder = useDraftOrder(leagueId)
  const storedOrder = useMemo(() => parseDraftOrder(draft.draft_order), [draft.draft_order])
  const [order, setOrder] = useState<readonly string[] | null>(null)
  const [reason, setReason] = useState('')
  const teamsById = useMemo(() => new Map(detail.teams.map((t) => [t.id, t])), [detail.teams])

  const working = order ?? storedOrder
  const dirty = order !== null && order.join('|') !== storedOrder.join('|')

  return (
    <PanelSection
      title="Draft order"
      hint="Completed picks stand; remaining picks re-derive from the new order (E31). A reason is required mid-draft."
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
                toast({ title: 'Draft order updated' })
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
// Tiny player picker (shared by reassign/force) — rides the SAME bounded
// server-searched pool read as available-players (use-draft-pool; the
// "exactly 1000 rows" lesson: search narrows the QUERY, never a page scan).
// ---------------------------------------------------------------------------

function PlayerSearchPicker({
  label,
  selected,
  onSelect,
}: {
  label: string
  selected: { id: string; name: string } | null
  onSelect: (next: { id: string; name: string } | null) => void
}) {
  const [term, setTerm] = useState('')
  const pool = useDraftPool(term, '')
  const results = term.trim() ? (pool.data ?? []).slice(0, 6) : []

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-1.5 rounded-sm border border-accent bg-accent-soft px-2 py-1">
        <span className="min-w-0 truncate text-[12px] font-semibold">{selected.name}</span>
        <Button variant="ghost" size="sm" onClick={() => onSelect(null)}>
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
