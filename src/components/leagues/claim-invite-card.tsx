'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'

import {
  cardCopy,
  claimKindForType,
  isActionable,
  previewToCardKind,
  outcomeReasonToCardKind,
  successLeagueId,
  type CardKind,
  type JoinClaimOutcome,
  type JoinPreview,
  type JoinPreviewFound,
} from './claim-invite-card-ops'

/**
 * Pre-auth /join/[token] claim card — M1 task L.A2.6 (spec §16.2
 * `claim-invite-card.tsx`; §16.5.2 states; §19.2 E53/E54/E65; D47; F29/F30).
 *
 * The Server Component (`page.tsx`) resolves the param through
 * `get_join_preview` (the §4.1 anon carve-out — F2: league name + team label
 * + inviter only, NEVER the invited email) and hands the narrowed preview +
 * the visitor's auth state here. This component owns the interactive half:
 *
 *   • signed-out + actionable → sign-in / create-account handoff. F29
 *     resolution (D80): we do NOT pre-fill the email E65 describes — the anon
 *     preview can't see it (F2) — so we direct the visitor to use the account
 *     the invite was sent to and let the claim's server-side E65/E53 check be
 *     the gate. Sign-in returns here via `?redirect`; a wrong account yields
 *     the friendly `mismatch` state below with the invite intact.
 *   • signed-in + actionable → claim (seat token → `claim_league_invite`) or
 *     join (code/slug → `join_league_by_code`) → land on the league home.
 *   • every terminal state (§16.5.2) renders from the pure `*-ops` mapping.
 *
 * Outcome states are driven from the RPC payload, not the HTTP status
 * (D72) — the claim/join routes answer with `{ok,reason,message,...}` on both
 * success and refusal.
 */
export function ClaimInviteCard({
  token,
  preview,
  isSignedIn,
}: {
  token: string
  preview: JoinPreview
  isSignedIn: boolean
}) {
  const router = useRouter()
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'success'>('idle')
  // A refusal/error from the claim/join action overrides the preview-derived
  // card (e.g. a race that filled the seat, or an E53 wrong-account claim).
  const [outcome, setOutcome] = useState<{ kind: CardKind; message?: string } | null>(null)

  const previewKind = previewToCardKind(preview)
  const effectiveKind = outcome?.kind ?? previewKind

  async function handleAction() {
    if (!preview.found) return
    setPhase('submitting')
    setOutcome(null)
    const kind = claimKindForType(preview.type)
    const endpoint = kind === 'seat' ? '/api/invites/claim' : '/api/leagues/join'
    const payload = kind === 'seat' ? { token } : { code: token }
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await res.json().catch(() => null)) as JoinClaimOutcome | { error?: unknown } | null
      const asOutcome = body as JoinClaimOutcome | null
      const leagueId = asOutcome ? successLeagueId(asOutcome) : null
      if (leagueId) {
        // Success (incl. the idempotent already-member replay) → league home.
        setPhase('success')
        router.push(`/app/leagues/${leagueId}`)
        return
      }
      const reason = asOutcome?.reason
      setOutcome({
        kind: outcomeReasonToCardKind(reason),
        message: asOutcome?.message,
      })
      setPhase('idle')
    } catch {
      setOutcome({ kind: 'error' })
      setPhase('idle')
    }
  }

  return (
    <Card>
      {preview.found && <PreviewHeader preview={preview} />}

      <CardContent className="space-y-4 py-5">
        {phase === 'success' ? (
          <SuccessBody preview={preview} />
        ) : isActionable(effectiveKind) && preview.found ? (
          isSignedIn ? (
            <ActionableSignedIn
              kind={effectiveKind}
              submitting={phase === 'submitting'}
              onAction={handleAction}
            />
          ) : (
            <ActionableSignedOut kind={effectiveKind} token={token} />
          )
        ) : (
          <TerminalBody kind={effectiveKind} message={outcome?.message} />
        )}
      </CardContent>
    </Card>
  )
}

/** League / team / inviter — the "reason to finish sign-up" (§16.4). Keyed on
 *  the team label (a specific franchise → "manage" framing) rather than the
 *  resolution type, so a general/open invite link reads "join". Never renders
 *  an email (F2 — the preview doesn't carry one). */
function PreviewHeader({ preview }: { preview: JoinPreviewFound }) {
  const hasSeat = Boolean(preview.team_label)
  return (
    <div className="border-b border-ink px-card-pad py-3.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-n-3">
        {hasSeat ? "You're invited to manage" : "You're invited to join"}
      </p>
      {hasSeat ? (
        <>
          <p className="mt-1 text-h5 leading-tight text-ink">{preview.team_label}</p>
          <p className="mt-0.5 text-[12px] font-semibold text-n-3">in {preview.league_name}</p>
        </>
      ) : (
        <p className="mt-1 text-h5 leading-tight text-ink">{preview.league_name}</p>
      )}
      {preview.inviter_name && (
        <p className="mt-2 text-[11px] font-medium text-n-3">
          Invited by <span className="font-bold text-ink">{preview.inviter_name}</span>
        </p>
      )}
      {!hasSeat && typeof preview.seats_open === 'number' && preview.seats_open > 0 && (
        <p className="mt-2 text-[11px] font-medium text-n-3">
          <span className="fs-num font-bold text-ink">{preview.seats_open}</span>{' '}
          {preview.seats_open === 1 ? 'seat' : 'seats'} open
        </p>
      )}
    </div>
  )
}

function ActionableSignedIn({
  kind,
  submitting,
  onAction,
}: {
  kind: CardKind
  submitting: boolean
  onAction: () => void
}) {
  const seat = kind === 'claimable-seat'
  return (
    <div className="space-y-3">
      <p className="text-[13px] font-medium leading-snug text-n-3">
        {seat
          ? 'Claim this seat to take over the team and start setting your lineup.'
          : 'Join this league to draft your team and play the season.'}
      </p>
      <Button variant="blue" className="w-full" shadow disabled={submitting} onClick={onAction}>
        {submitting ? (seat ? 'Claiming…' : 'Joining…') : seat ? 'Claim your seat' : 'Join league'}
      </Button>
    </div>
  )
}

function ActionableSignedOut({ kind, token }: { kind: CardKind; token: string }) {
  const seat = kind === 'claimable-seat'
  // Return to THIS claim page after sign-in (login honors ?redirect). Sign-up
  // is a plain handoff — a fresh account re-enters via the emailed invite link
  // or the in-app notification (F30); we never thread the invited email
  // through signup (F2), and never pre-fill it (F29/D80).
  const signInHref = `/login?redirect=${encodeURIComponent(`/join/${token}`)}`
  return (
    <div className="space-y-3">
      <p className="text-[13px] font-medium leading-snug text-n-3">
        {seat
          ? 'Sign in or create an account to claim your seat.'
          : 'Sign in or create an account to join this league.'}
      </p>
      <div className="flex flex-col gap-2">
        <Button variant="blue" className="w-full" shadow asChild>
          <Link href={signInHref}>Sign in</Link>
        </Button>
        <Button variant="stroke" className="w-full" asChild>
          <Link href="/signup">Create account</Link>
        </Button>
      </div>
      {seat && (
        <p className="text-[11px] font-medium leading-snug text-n-3">
          Use the FieldScout account this invite was sent to. New here? Create your account with
          that email, then open this invite link again to claim your seat.
        </p>
      )}
    </div>
  )
}

function SuccessBody({ preview }: { preview: JoinPreview }) {
  const name = preview.found ? preview.league_name : 'your league'
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <Icon name="check-circle" size={20} className="text-positive-strong" />
      <p className="text-h5 text-ink">You&apos;re in</p>
      <p className="text-[12px] font-medium text-n-3">
        Taking you to <span className="font-bold text-ink">{name}</span>…
      </p>
    </div>
  )
}

function TerminalBody({ kind, message }: { kind: CardKind; message?: string }) {
  const copy = cardCopy(kind, message)
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center" role="alert">
      <Icon name={copy.icon} size={20} className="text-n-3" />
      <p className="text-h5 text-ink">{copy.title}</p>
      <p className="max-w-xs text-[12px] font-medium leading-snug text-n-3">{copy.message}</p>
      <Button variant="stroke" size="sm" className="mt-2" asChild>
        <Link href="/app">Go to FieldScout</Link>
      </Button>
    </div>
  )
}
