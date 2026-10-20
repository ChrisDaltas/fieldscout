'use client'

import { useState } from 'react'

import {
  ROLE_LABELS,
  copyWithToast,
  useLeaveSeat,
  useRemoveSeat,
  useRevokeSeatInvite,
  useRoleChange,
  useRotateLink,
  useSeatInvite,
  useSlugActions,
  useTransferCommish,
  type SeatInviteMode,
} from '@/components/leagues/invite-panel-actions'
import {
  buildJoinLink,
  defaultRemoveMode,
  inviteState,
  leaveConfirms,
  leaveLeagueCopy,
  nextLeaveStep,
  removeOptionCopy,
  type LeaveCopy,
  type LeaveStep,
  type MembersPhase,
  type Seat,
} from '@/components/leagues/invite-panel-ops'
import { MChoiceChip, MField, MNotice, MRadioCard, M_TEXT_FIELD } from '@/components/mobile/ui/m-form'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { UsernameLink } from '@/components/shared/username-link'
import type { RemoveMode } from '@/hooks/use-league-members'
import { cn } from '@/lib/utils'

import { INVITE_MODES, INVITE_MODE_ORDER, inviteStatusLine, manageOptions, type ManageOptionKey } from './members-ops'

/**
 * The Members screen's sheets (gap list §4 item 106) — desktop's
 * `InvitePanel` dialogs and inline seat controls as phone bottom sheets,
 * running the SAME actions (`invite-panel-actions.ts`): a seated manager's
 * roles, the commissioner transfer and remove; a team with no manager's
 * invite; a pending invite's copy / revoke; the custom link and rotate; and
 * leaving, with its two confirmations. Each body is exported so the render
 * tests can mount it outside a (portalled) sheet.
 */

const ACTION = 'flex h-12 w-full flex-none items-center justify-center rounded-[14px] text-[15px] font-semibold'
const PRIMARY = 'bg-accent text-white active:bg-accent-strong disabled:bg-m-b3s disabled:text-m-t3'
const QUIET = 'bg-m-b2 text-m-t1 active:bg-m-b2h disabled:text-m-t5'
/** A destructive action: red WORDS on the quiet fill — the bright red is
 *  never a background (CLAUDE.md, 2026-10-18). */
const DANGER = 'bg-m-b2 text-m-red active:bg-m-b2h disabled:text-m-t5'
const BODY = 'text-[15px] font-medium leading-[1.45] text-m-t2'
const HINT = 'text-[12px] font-medium leading-[1.35] text-m-t3'

function Manager({ seat }: { seat: Seat }) {
  return seat.username ? <UsernameLink username={seat.username} /> : <>{seat.identity}</>
}

// ---------------------------------------------------------------------------
// A seat's sheet — the row's "more" control opens it
// ---------------------------------------------------------------------------

type ManageView = 'menu' | 'remove' | 'transfer'

export interface SeatSheetContext {
  leagueId: string
  leagueName: string
  myRole: string | null
  phase: MembersPhase
  nowMs: number
}

/**
 * One seat's controls, by what the seat is: a seated manager (`manage`), a
 * team with no manager (`invite`) or an invite that's out (`pending`). The
 * sheet closes once its action went through — the row below shows the
 * result.
 */
export function SeatSheet({
  open,
  onOpenChange,
  seat,
  kind,
  ctx,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  seat: Seat
  kind: 'manage' | 'invite' | 'pending'
  ctx: SeatSheetContext
}) {
  const [view, setView] = useState<ManageView>('menu')
  const close = () => onOpenChange(false)
  const manage = kind === 'manage'
  const title =
    kind === 'invite'
      ? 'Invite a manager'
      : manage && view === 'transfer'
        ? 'Transfer the commissioner role?'
        : manage && view === 'remove'
          ? 'Remove the manager'
          : seat.teamName
  const subtitle = kind === 'invite' || (manage && view === 'remove') ? seat.teamName : undefined
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title={title} subtitle={subtitle} showClose scrollKey={view}>
      {kind === 'invite' && seat.teamId ? (
        <InviteBody leagueId={ctx.leagueId} teamId={seat.teamId} onDone={close} />
      ) : kind === 'pending' ? (
        <PendingBody leagueId={ctx.leagueId} seat={seat} nowMs={ctx.nowMs} onDone={close} />
      ) : view === 'remove' ? (
        <RemoveBody leagueId={ctx.leagueId} leagueName={ctx.leagueName} seat={seat} phase={ctx.phase} onBack={() => setView('menu')} onDone={close} />
      ) : view === 'transfer' ? (
        <TransferBody leagueId={ctx.leagueId} seat={seat} onBack={() => setView('menu')} onDone={close} />
      ) : (
        <ManageBody leagueId={ctx.leagueId} seat={seat} myRole={ctx.myRole} onPick={setView} onDone={close} />
      )}
    </MobileSheet>
  )
}

/** A seated manager: who runs it, then the role change his role allows, the
 *  transfer (sitting commissioner only) and Remove. */
export function ManageBody({
  leagueId,
  seat,
  myRole,
  onPick,
  onDone,
}: {
  leagueId: string
  seat: Seat
  myRole: string | null
  onPick: (view: 'remove' | 'transfer') => void
  onDone: () => void
}) {
  const roles = useRoleChange(leagueId)
  const pick = async (key: ManageOptionKey) => {
    if (key === 'remove' || key === 'transfer') return onPick(key)
    if (await roles.change(seat, key === 'make_co' ? 'co_commissioner' : 'manager')) onDone()
  }
  return (
    <div className="flex flex-col gap-2 px-4 pb-1" data-seat-sheet="manage">
      <p className="px-1 pb-1 text-[14px] font-medium text-m-t3">
        Managed by <Manager seat={seat} />
        {seat.role ? ` · ${ROLE_LABELS[seat.role] ?? seat.role}` : ''}
      </p>
      {manageOptions(seat, myRole).map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => void pick(o.key)}
          disabled={roles.pending}
          className={cn(ACTION, o.key === 'remove' ? DANGER : QUIET)}
          data-manage-option={o.key}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The atomic commissioner transfer (§7.2/D74(4)): he becomes commissioner,
 *  you step down to co-commissioner. */
export function TransferBody({
  leagueId,
  seat,
  onBack,
  onDone,
}: {
  leagueId: string
  seat: Seat
  onBack: () => void
  onDone: () => void
}) {
  const role = useTransferCommish(leagueId)
  return (
    <div className="flex flex-col gap-2.5 px-4 pb-1" data-seat-sheet="transfer">
      <p className={cn(BODY, 'px-1 pb-1')}>
        <Manager seat={seat} /> ({seat.teamName}) becomes the league commissioner and you step down to co-commissioner. There is always exactly one
        commissioner.
      </p>
      <button
        type="button"
        onClick={async () => {
          if (await role.transfer(seat)) onDone()
        }}
        disabled={role.pending}
        className={cn(ACTION, PRIMARY)}
        data-transfer-confirm
      >
        {role.pending ? 'Transferring…' : 'Transfer role'}
      </button>
      <button type="button" onClick={onBack} className={cn(ACTION, QUIET)}>
        Back
      </button>
    </div>
  )
}

/**
 * D42 remove — the only two outcomes (L.E1.42: a team is never retired):
 * open the seat (vacate) or hand it to someone (takeover). Takeover is the
 * preselected choice once the draft has started (R1385); Remove stays
 * greyed until a takeover names its new manager. The reason is optional.
 */
export function RemoveBody({
  leagueId,
  leagueName,
  seat,
  phase,
  onBack,
  onDone,
}: {
  leagueId: string
  leagueName: string
  seat: Seat
  phase: MembersPhase
  onBack: () => void
  onDone: () => void
}) {
  const copy = removeOptionCopy(phase)
  const [mode, setMode] = useState<RemoveMode>(defaultRemoveMode(phase))
  const [successorHandle, setSuccessorHandle] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const remove = useRemoveSeat(leagueId)
  const ready = mode !== 'takeover' || successorHandle.trim().length > 0

  async function confirm() {
    setError(null)
    const problem = await remove.remove(seat, { mode, successorHandle, reason })
    if (problem) setError(problem)
    else onDone()
  }

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-1" data-seat-sheet="remove">
      <p className={cn(BODY, 'px-1')}>
        <Manager seat={seat} /> manages {seat.teamName} in {leagueName}. Choose what happens to the team.
      </p>
      <div role="radiogroup" aria-label="What happens to the team" className="flex flex-col gap-2">
        <MRadioCard label="Open the seat" sub={copy.vacate} on={mode === 'vacate'} onPick={() => setMode('vacate')} />
        <MRadioCard label="Hand it to someone" sub={copy.takeover} on={mode === 'takeover'} onPick={() => setMode('takeover')} />
      </div>
      {mode === 'takeover' && (
        <MField label="New manager’s username" htmlFor="m-successor">
          <input
            id="m-successor"
            value={successorHandle}
            placeholder="@username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => {
              setSuccessorHandle(e.target.value)
              setError(null)
            }}
            className={M_TEXT_FIELD}
          />
        </MField>
      )}
      <MField label="Reason (optional)" htmlFor="m-remove-reason">
        <input id="m-remove-reason" value={reason} placeholder="Noted for the record" onChange={(e) => setReason(e.target.value)} className={M_TEXT_FIELD} />
      </MField>
      {error && <MNotice tone="error">{error}</MNotice>}
      <div className="flex flex-col gap-2 pt-1">
        <button type="button" onClick={() => void confirm()} disabled={remove.pending || !ready} className={cn(ACTION, DANGER)} data-remove-confirm>
          {remove.pending ? 'Removing…' : 'Remove manager'}
        </button>
        <button type="button" onClick={onBack} className={cn(ACTION, QUIET)}>
          Back
        </button>
      </div>
    </div>
  )
}

/** A team with no manager: invite by email (first) or username, or seat
 *  someone directly (assign) — or copy a link only this team can claim. */
export function InviteBody({ leagueId, teamId, onDone }: { leagueId: string; teamId: string; onDone: () => void }) {
  const [mode, setMode] = useState<SeatInviteMode>('email')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  // The team's link once it's made but the clipboard refused it.
  const [madeLink, setMadeLink] = useState<string | null>(null)
  const invite = useSeatInvite(leagueId, teamId)
  const copy = INVITE_MODES[mode]

  async function submit() {
    setError(null)
    const problem = await invite.submit(mode, value)
    if (problem) setError(problem)
    else onDone()
  }

  async function copyLink() {
    setError(null)
    const result = await invite.copySeatLink()
    if (result.status === 'error') setError(result.message)
    else if (result.status === 'uncopied') setMadeLink(result.link)
    else onDone()
  }

  // The team now has its invite out — the form goes, so a second one can't
  // be started; only the link and its Copy stay.
  if (madeLink) return <SeatLinkReady link={madeLink} onCopied={onDone} />

  return (
    <div className="flex flex-col gap-3 px-4 pb-1" data-seat-sheet="invite">
      <div className="flex flex-wrap gap-2" role="group" aria-label="How to add them">
        {INVITE_MODE_ORDER.map((m) => (
          <MChoiceChip
            key={m}
            label={INVITE_MODES[m].chip}
            on={mode === m}
            onPick={() => {
              setMode(m)
              setError(null)
            }}
          />
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <input
          value={value}
          type={copy.inputType}
          placeholder={copy.placeholder}
          aria-label={copy.ariaLabel}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          className={M_TEXT_FIELD}
        />
        <p className={cn(HINT, 'px-1')}>{copy.hint}</p>
      </div>
      {error && <MNotice tone="error">{error}</MNotice>}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={invite.busy || value.trim().length === 0}
        className={cn(ACTION, PRIMARY)}
        data-invite-submit={mode}
      >
        {copy.button}
      </button>
      <div className="flex flex-col gap-1.5 border-t border-m-b2 pt-3">
        <button type="button" onClick={() => void copyLink()} disabled={invite.busy} className={cn(ACTION, QUIET)} data-copy-seat-link>
          Copy a link for this team
        </button>
        <p className={cn(HINT, 'px-1 text-center')}>Anyone with it can claim this team.</p>
      </div>
    </div>
  )
}

/** The team's new link when the clipboard refused it (iPhone Safari drops a
 *  copy that lands after the invite's network wait): the link itself, and a
 *  Copy that runs in this fresh tap. Never "copied" when it wasn't. */
export function SeatLinkReady({ link, onCopied }: { link: string; onCopied: () => void }) {
  return (
    <div className="flex flex-col gap-3 px-4 pb-1" data-seat-sheet="link-ready">
      <p className={cn(BODY, 'px-1')}>Your link for this team is ready. Copy it to share it.</p>
      <input
        readOnly
        value={link}
        aria-label="Link for this team"
        onFocus={(e) => e.currentTarget.select()}
        className={cn(M_TEXT_FIELD, 'font-medium')}
        data-made-link
      />
      <button
        type="button"
        onClick={async () => {
          if (await copyWithToast(link, 'Seat link copied')) onCopied()
        }}
        className={cn(ACTION, PRIMARY)}
        data-copy-made-link
      >
        Copy link
      </button>
      <p className={cn(HINT, 'px-1 text-center')}>Anyone with it can claim this team.</p>
    </div>
  )
}

/** An invite that's out: who it's for and when it runs out; copy its link
 *  or revoke it. */
export function PendingBody({ leagueId, seat, nowMs, onDone }: { leagueId: string; seat: Seat; nowMs: number; onDone: () => void }) {
  const revoke = useRevokeSeatInvite(leagueId)
  const invite = seat.invite
  if (!invite) return null
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return (
    <div className="flex flex-col gap-2 px-4 pb-1" data-seat-sheet="pending">
      <p className="px-1 pb-1 text-[14px] font-medium text-m-t3">
        Invited{' '}
        {seat.emailTarget ?? (seat.usernameTarget ? <UsernameLink username={seat.usernameTarget} /> : 'by a shared link')} ·{' '}
        {inviteStatusLine(inviteState(invite, nowMs), invite.expires_at)}
      </p>
      <button type="button" onClick={() => void copyWithToast(buildJoinLink(origin, invite.token), 'Seat link copied')} className={cn(ACTION, QUIET)} data-copy-invite>
        Copy invite link
      </button>
      <button
        type="button"
        onClick={async () => {
          if (await revoke.revoke(invite.id)) onDone()
        }}
        disabled={revoke.pending}
        className={cn(ACTION, DANGER)}
        data-revoke-invite
      >
        Revoke invite
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The share link: custom link and rotate
// ---------------------------------------------------------------------------

/** The custom /join/<slug> — save, or remove it (the random code returns). */
export function SlugSheet({
  open,
  onOpenChange,
  leagueId,
  inviteSlug,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leagueId: string
  inviteSlug: string | null
}) {
  const [value, setValue] = useState(inviteSlug ?? '')
  const [error, setError] = useState<string | null>(null)
  const slug = useSlugActions(leagueId)
  const dirty = value.trim() !== (inviteSlug ?? '')

  async function save() {
    setError(null)
    const problem = await slug.save(value)
    if (problem) setError(problem)
    else onOpenChange(false)
  }

  async function clear() {
    setError(null)
    const problem = await slug.clear()
    if (problem) setError(problem)
    else onOpenChange(false)
  }

  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Custom link" showClose>
      <div className="flex flex-col gap-3 px-4 pb-1" data-link-sheet="slug">
        <div className="flex items-center gap-2">
          <span className="flex-none text-[15px] font-semibold text-m-t3">/join/</span>
          <input
            value={value}
            placeholder="your-league"
            aria-label="Custom link"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            className={M_TEXT_FIELD}
          />
        </div>
        <p className={cn(HINT, 'px-1')}>Letters, numbers and hyphens. Survives a link rotation.</p>
        {error && <MNotice tone="error">{error}</MNotice>}
        <button type="button" onClick={() => void save()} disabled={!dirty || slug.pending} className={cn(ACTION, PRIMARY)} data-slug-save>
          Save
        </button>
        {inviteSlug && (
          <button type="button" onClick={() => void clear()} disabled={slug.pending} className={cn(ACTION, QUIET)} data-slug-clear>
            Remove custom link
          </button>
        )}
      </div>
    </MobileSheet>
  )
}

/** Rotate = destructive (§22.5): old links stop working; ask first. */
export function RotateSheet({ open, onOpenChange, leagueId }: { open: boolean; onOpenChange: (open: boolean) => void; leagueId: string }) {
  const rotate = useRotateLink(leagueId)
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Rotate the invite link?" showClose>
      <div className="flex flex-col gap-2 px-4 pb-1" data-link-sheet="rotate">
        <p className={cn(BODY, 'px-1 pb-1.5')}>
          This makes a new share code and the current one stops working — any link already shared with it will fail. Your custom /join link (if set)
          keeps working. This can’t be undone.
        </p>
        <button type="button" onClick={() => onOpenChange(false)} className={cn(ACTION, PRIMARY)}>
          Keep the current link
        </button>
        <button
          type="button"
          onClick={async () => {
            if (await rotate.rotate()) onOpenChange(false)
          }}
          disabled={rotate.pending}
          className={cn(ACTION, DANGER)}
          data-rotate-confirm
        >
          {rotate.pending ? 'Rotating…' : 'Rotate link'}
        </button>
      </div>
    </MobileSheet>
  )
}

// ---------------------------------------------------------------------------
// Leaving the league — two confirmations (L.E1.41)
// ---------------------------------------------------------------------------

/** Leave, from your own seat: the consequences, then the last check — only
 *  the second step's button leaves (`leaveConfirms`). */
export function LeaveSheet({
  step,
  onStep,
  leagueId,
  seat,
  phase,
  leagueName,
}: {
  step: LeaveStep
  onStep: (step: LeaveStep) => void
  leagueId: string
  seat: Seat
  phase: MembersPhase
  leagueName: string
}) {
  const leave = useLeaveSeat(leagueId)
  const copy = leaveLeagueCopy(phase, seat.teamName, leagueName)

  async function confirm() {
    if (!seat.memberId || !leaveConfirms(step)) return
    if (await leave.leave(seat)) onStep('closed')
  }

  return (
    <MobileSheet
      open={step !== 'closed'}
      onOpenChange={(open) => {
        if (!open) onStep('closed')
      }}
      title={step === 'final' ? copy.finalTitle : copy.title}
      showClose
      scrollKey={step}
    >
      <LeaveStepBody step={step} copy={copy} pending={leave.pending} onStep={(e) => onStep(nextLeaveStep(step, e))} onConfirm={() => void confirm()} />
    </MobileSheet>
  )
}

/** A leave step's words and buttons. Step one only moves on; step two's
 *  "Yes, leave this league" is the one button that leaves. */
export function LeaveStepBody({
  step,
  copy,
  pending,
  onStep,
  onConfirm,
}: {
  step: LeaveStep
  copy: LeaveCopy
  pending: boolean
  onStep: (event: 'continue' | 'back' | 'cancel') => void
  onConfirm: () => void
}) {
  if (step === 'final') {
    return (
      <div className="flex flex-col gap-2 px-4 pb-1" data-leave-step="final">
        <p className={cn(BODY, 'px-1 pb-1.5')}>{copy.finalBody}</p>
        <button type="button" onClick={() => onStep('cancel')} className={cn(ACTION, PRIMARY)}>
          {copy.stayLabel}
        </button>
        <button type="button" onClick={onConfirm} disabled={pending} className={cn(ACTION, DANGER)} data-leave-confirm>
          {pending ? 'Leaving…' : copy.confirmLabel}
        </button>
        <button type="button" onClick={() => onStep('back')} className="flex h-11 items-center justify-center text-[15px] font-semibold text-m-t1">
          Back
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2 px-4 pb-1" data-leave-step="consequences">
      <p className={cn(BODY, 'px-1 pb-1.5')}>{copy.consequences}</p>
      <button type="button" onClick={() => onStep('cancel')} className={cn(ACTION, PRIMARY)}>
        {copy.stayLabel}
      </button>
      <button type="button" onClick={() => onStep('continue')} className={cn(ACTION, DANGER)} data-leave-continue>
        {copy.continueLabel}
      </button>
    </div>
  )
}
