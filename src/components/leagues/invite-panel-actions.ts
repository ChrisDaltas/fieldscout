'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  useCreateInvite,
  useRevokeInvite,
  useRotateInviteCode,
  useSetInviteSlug,
} from '@/hooks/use-league-invites'
import {
  useAddPlaceholderSeat,
  useAssignManager,
  useLeaveLeague,
  useRemoveManager,
  useSetMemberRole,
  type MemberRole,
  type RemoveMode,
} from '@/hooks/use-league-members'
import { toast } from '@/hooks/use-toast'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import { createBrowserClient } from '@/lib/supabase/client'

import {
  buildJoinLink,
  fillOutcome,
  isAlreadyFullRefusal,
  readSeatCounts,
  validateSlug,
  type Seat,
  type SeatCounts,
} from './invite-panel-ops'

/**
 * The members panel's actions — ONE set, run by both layouts: desktop's
 * `InvitePanel` and the phone's Members screen (gap list §4 item 106). Each
 * hook wraps the real L.A1.14 / L.A1.15 mutation (no RPC reimplemented, no
 * route added) with the panel's toasts, so a commissioner gets the same
 * words whichever screen he presses. Inline form errors come back as a
 * message (null when it went through) for the caller to show; the others
 * answer whether they worked, so a phone sheet knows when to close.
 */

export function messageOf(cause: unknown): string {
  if (cause instanceof LeagueActionError) return cause.message
  if (cause instanceof Error) return cause.message
  return 'Something went wrong. Please try again.'
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Copy, then say so — or show the text to copy by hand. */
export async function copyWithToast(text: string, label: string): Promise<void> {
  const ok = await copyToClipboard(text)
  toast(ok ? { title: label } : { title: 'Copy it manually', description: text })
}

/** Resolve a public @username to its profile id (§7.2 usernames are public;
 *  profiles are world-readable). Throws a friendly LeagueActionError. */
export async function resolveUsername(raw: string): Promise<string> {
  const handle = raw.trim().replace(/^@/, '').toLowerCase()
  if (!handle) throw new LeagueActionError(400, 'Enter a username.')
  const supabase = createBrowserClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', handle)
    .maybeSingle()
  if (error) throw new LeagueActionError(500, 'Could not look up that username.')
  if (!data) throw new LeagueActionError(404, `No FieldScout account @${handle}.`)
  return data.id
}

export const ROLE_LABELS: Record<string, string> = {
  commissioner: 'Commissioner',
  co_commissioner: 'Co-commissioner',
  manager: 'Manager',
}

/** The toast after a removal. */
export function removeToast(mode: RemoveMode, teamName: string): { title: string; description: string } {
  if (mode === 'takeover') return { title: 'Team handed over', description: `${teamName} has a new manager.` }
  return { title: 'Seat opened', description: `${teamName} is now an open seat — invite a replacement.` }
}

// ---------------------------------------------------------------------------
// The share link: custom link + rotate
// ---------------------------------------------------------------------------

/** Custom slug: save (checked here first — the RPC is still the authority)
 *  or clear. Each answers the form's error, or null when it went through. */
export function useSlugActions(leagueId: string) {
  const setSlug = useSetInviteSlug(leagueId)

  async function save(raw: string): Promise<string | null> {
    const trimmed = raw.trim()
    const clientError = validateSlug(trimmed)
    if (clientError) return clientError
    try {
      await setSlug.mutateAsync(trimmed.toLowerCase())
      toast({ title: 'Custom link saved', description: `/join/${trimmed.toLowerCase()}` })
      return null
    } catch (cause) {
      return messageOf(cause)
    }
  }

  async function clear(): Promise<string | null> {
    try {
      await setSlug.mutateAsync(null)
      toast({ title: 'Custom link cleared', description: 'The random share code is active again.' })
      return null
    } catch (cause) {
      return messageOf(cause)
    }
  }

  return { save, clear, pending: setSlug.isPending }
}

/** Rotate = destructive: invalidates the current share code (old links stop
 *  working). The caller confirms first (§22.5); the custom slug survives. */
export function useRotateLink(leagueId: string) {
  const rotate = useRotateInviteCode(leagueId)

  async function run(): Promise<boolean> {
    try {
      await rotate.mutateAsync()
      toast({
        title: 'Invite link rotated',
        description: 'The old share code no longer works. Your custom link still does.',
      })
      return true
    } catch (cause) {
      toast({ title: "Couldn't rotate the link", description: messageOf(cause) })
      return false
    }
  }

  return { rotate: run, pending: rotate.isPending }
}

// ---------------------------------------------------------------------------
// Seats: add one, or fill them all
// ---------------------------------------------------------------------------

export function useFillSeats(leagueId: string) {
  const addSeat = useAddPlaceholderSeat(leagueId)
  const [fill, setFill] = useState<{ done: number; target: number } | null>(null)
  const busy = addSeat.isPending || fill !== null

  async function add() {
    try {
      const seats = readSeatCounts(await addSeat.mutateAsync(undefined))
      toast(fillOutcome(seats, 1, 1))
    } catch (cause) {
      toast({ title: "Couldn't add a seat", description: messageOf(cause) })
    }
  }

  // Fill every remaining slot in one press. §7.2/D96 requires every franchise
  // to EXIST before the draft can start, so a solo commissioner opening a
  // 12-team league otherwise has to press "Add an open seat" eleven times
  // before start_draft will accept — the failure Chris hit on 2026-09-09.
  //
  // Sequential, never parallel: add_placeholder_seat re-reads capacity under
  // the league lock (063/R93) and raises once full, so overlapping requests
  // would race on the final seat.
  async function fillAll(openCount: number) {
    const requested = openCount
    setFill({ done: 0, target: requested })
    let added = 0
    let seats: SeatCounts | null = null
    try {
      for (let i = 0; i < requested; i += 1) {
        seats = readSeatCounts(await addSeat.mutateAsync(undefined))
        added += 1
        setFill({ done: added, target: requested })
        // THE SERVER'S POSTCONDITION ENDS THE LOOP, never the client's count
        // (R958). `openCount` comes from a cached league document with no
        // window-focus refetch and no realtime on members, so it can be stale
        // HIGH — and one call past capacity turns 063:446's already-full
        // refusal into a "failure" report on a league that is seated and
        // draft-ready, whose own remediation text ("raise team_count first")
        // would turn a correct 12-team league into a 13-team one.
        if (seats && seats.filled >= seats.total) break
      }
      toast(fillOutcome(seats, added, requested))
    } catch (cause) {
      const message = messageOf(cause)
      // A refusal BECAUSE the league is already full is completion, not
      // failure — reachable when someone claims the last seat mid-loop.
      // Asserting the reason instead of inferring failure from the raise.
      if (isAlreadyFullRefusal(message)) {
        toast(fillOutcome(seats ? { ...seats, filled: seats.total } : null, added, requested))
      } else {
        toast({
          title: added > 0 ? `Stopped after ${added} of ${requested}` : "Couldn't add the seats",
          description: message,
        })
      }
    } finally {
      setFill(null)
    }
  }

  return { add, fillAll, fill, busy }
}

/** The fill button's words: its progress while it runs. */
export function fillAllLabel(fill: { done: number; target: number } | null, openCount: number): string {
  return fill ? `Adding ${Math.min(fill.done + 1, fill.target)} of ${fill.target}…` : `Fill all ${openCount} seats`
}

// ---------------------------------------------------------------------------
// One seat with no manager: email-first invite, a username, or assign
// ---------------------------------------------------------------------------

export type SeatInviteMode = 'email' | 'username' | 'assign'

export function useSeatInvite(leagueId: string, teamId: string) {
  const createInvite = useCreateInvite(leagueId)
  const assignManager = useAssignManager(leagueId)
  const busy = createInvite.isPending || assignManager.isPending

  /** Answers the form's error, or null when it went through. */
  async function submit(mode: SeatInviteMode, raw: string): Promise<string | null> {
    const entry = raw.trim()
    if (!entry) return mode === 'email' ? 'Enter an email address.' : 'Enter a username.'
    try {
      if (mode === 'email') {
        const result = await createInvite.mutateAsync({ target_team_id: teamId, invited_email: entry })
        toast({
          title: result.email_sent ? 'Invite emailed' : 'Invite created',
          description: result.email_sent
            ? `We sent ${entry} a claim link.`
            : `Share the seat link with ${entry}.`,
        })
      } else if (mode === 'username') {
        await createInvite.mutateAsync({
          target_team_id: teamId,
          invited_username: entry.replace(/^@/, ''),
        })
        toast({ title: 'Invite sent', description: `@${entry.replace(/^@/, '')} was notified.` })
      } else {
        const userId = await resolveUsername(entry)
        await assignManager.mutateAsync({ teamId, userId })
        toast({ title: 'Manager seated', description: `@${entry.replace(/^@/, '')} now runs this seat.` })
      }
      return null
    } catch (cause) {
      return messageOf(cause)
    }
  }

  /** A fresh seat-targeted link, copied. Answers an error, or null. */
  async function copySeatLink(): Promise<string | null> {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    try {
      const result = await createInvite.mutateAsync({ target_team_id: teamId })
      const link = buildJoinLink(origin, result.token)
      await copyToClipboard(link)
      toast({ title: 'Seat link copied', description: 'Anyone with it claims this exact seat.' })
      return null
    } catch (cause) {
      return messageOf(cause)
    }
  }

  return { submit, copySeatLink, busy }
}

/** A pending seat invite: revoke it. */
export function useRevokeSeatInvite(leagueId: string) {
  const revoke = useRevokeInvite(leagueId)

  async function run(inviteId: string): Promise<boolean> {
    try {
      await revoke.mutateAsync(inviteId)
      toast({ title: 'Invite revoked', description: 'That link no longer works.' })
      return true
    } catch (cause) {
      toast({ title: "Couldn't revoke the invite", description: messageOf(cause) })
      return false
    }
  }

  return { revoke: run, pending: revoke.isPending }
}

// ---------------------------------------------------------------------------
// A seated manager: roles, the commissioner transfer, remove
// ---------------------------------------------------------------------------

/** Promote / demote between manager and co-commissioner. */
export function useRoleChange(leagueId: string) {
  const setRole = useSetMemberRole(leagueId)

  async function change(seat: Seat, role: MemberRole): Promise<boolean> {
    if (!seat.memberId) return false
    try {
      await setRole.mutateAsync({ memberId: seat.memberId, role })
      toast({ title: 'Role updated', description: `${seat.teamName} is now ${ROLE_LABELS[role]}.` })
      return true
    } catch (cause) {
      toast({ title: "Couldn't change the role", description: messageOf(cause) })
      return false
    }
  }

  return { change, pending: setRole.isPending }
}

/** The atomic commissioner transfer (§7.2/D74(4)) — you become a
 *  co-commissioner. Only the sitting commissioner may; the caller confirms. */
export function useTransferCommish(leagueId: string) {
  const setRole = useSetMemberRole(leagueId)

  async function transfer(seat: Seat): Promise<boolean> {
    if (!seat.memberId) return false
    try {
      await setRole.mutateAsync({ memberId: seat.memberId, role: 'commissioner' })
      toast({
        title: 'Commissioner role transferred',
        description: `${seat.teamName} is now the commissioner. You're a co-commissioner.`,
      })
      return true
    } catch (cause) {
      toast({ title: "Couldn't transfer the role", description: messageOf(cause) })
      return false
    }
  }

  return { transfer, pending: setRole.isPending }
}

/** D42 remove — takeover (a successor by @username) or vacate. Answers the
 *  chooser's error, or null when it went through. The reason is optional. */
export function useRemoveSeat(leagueId: string) {
  const remove = useRemoveManager(leagueId)

  async function run(
    seat: Seat,
    choice: { mode: RemoveMode; successorHandle: string; reason: string },
  ): Promise<string | null> {
    if (!seat.memberId) return null
    try {
      let successorUserId: string | undefined
      if (choice.mode === 'takeover') {
        successorUserId = await resolveUsername(choice.successorHandle)
      }
      await remove.mutateAsync({
        memberId: seat.memberId,
        mode: choice.mode,
        successorUserId,
        reason: choice.reason.trim() || undefined,
      })
      toast(removeToast(choice.mode, seat.teamName))
      return null
    } catch (cause) {
      return messageOf(cause)
    }
  }

  return { remove: run, pending: remove.isPending }
}

// ---------------------------------------------------------------------------
// Your own seat: leave
// ---------------------------------------------------------------------------

/** `leave_league` — the caller gates it on the second confirmation
 *  (`leaveConfirms`); this leaves and takes you to your leagues. */
export function useLeaveSeat(leagueId: string) {
  const router = useRouter()
  const leave = useLeaveLeague(leagueId)

  async function run(seat: Seat): Promise<boolean> {
    if (!seat.memberId) return false
    try {
      await leave.mutateAsync(seat.memberId)
      toast({ title: 'You left the league', description: `${seat.teamName} no longer has you as its manager.` })
      router.push('/app/leagues')
      return true
    } catch (cause) {
      toast({ title: "Couldn't leave the league", description: messageOf(cause) })
      return false
    }
  }

  return { leave: run, pending: leave.isPending }
}
