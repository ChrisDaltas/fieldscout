/**
 * Pure logic for the pre-auth /join/[token] claim page — M1 task L.A2.6
 * (spec §16.1 resolution, §16.2 claim-invite-card, §16.5.2 invite/claim
 * states, §19.2 E53/E54/E65, D47; PROGRESS D72, F2/F29/F30).
 *
 * Two mappings live here so they are pinnable without a render (UI §4.3
 * "logic pins where there's pure logic"):
 *   1. resolution-type → claim-kind  (`claimKindForType`)
 *   2. state → card-kind → friendly copy  (`previewToCardKind`,
 *      `outcomeReasonToCardKind`, `STATE_COPY`).
 *
 * THE F2 INVARIANT (inviolable): `get_join_preview` (062, the §4.1 anon
 * carve-out) returns ONLY league name + team label + the inviter's handle —
 * never `invited_email`/`invited_username`/token internals (F2, pinned by
 * pgTAP 016 exact-jsonb equality AS ANON). Nothing this module produces
 * displays or derives the invited email, and none of the copy here echoes an
 * address. F29 resolution (D80): the anon page CANNOT pre-fill the email E65
 * describes; instead it directs the visitor to use the account the invite
 * was sent to and lets `claim_league_invite`'s server-side E65/E53 email
 * check be the gate (a wrong account yields the friendly `mismatch` state
 * with the invite intact).
 *
 * No time/stats reads — pure functions over the preview/outcome payloads.
 */
import type { IconName } from '@/components/ui/icon'

// ---------------------------------------------------------------------------
// get_join_preview return shape (062; F2 — the FULL anon-visible key set)
// ---------------------------------------------------------------------------

/** §16.1 resolution: a seat/invite `token`, a league share `code`, or a
 *  custom `slug` — the RPC reports which form resolved. */
export type PreviewType = 'invite' | 'code' | 'slug'

/** The pre-auth status vocabulary the RPC feeds the claim page (D72(11)). */
export type PreviewStatus =
  | 'ok'
  | 'revoked'
  | 'expired'
  | 'spent'
  | 'seat_filled'
  | 'league_full'
  | 'joins_closed'

export interface JoinPreviewFound {
  found: true
  type: PreviewType
  status: PreviewStatus
  league_name: string
  /** Seat invites only; NULL for open code/slug links. */
  team_label: string | null
  /** Invites only; NULL for open code/slug links. */
  inviter_name: string | null
  /** Open code/slug links only; NULL for seat invites. */
  seats_open: number | null
}

export type JoinPreview = { found: false } | JoinPreviewFound

const PREVIEW_TYPES: readonly PreviewType[] = ['invite', 'code', 'slug']
const PREVIEW_STATUSES: readonly PreviewStatus[] = [
  'ok',
  'revoked',
  'expired',
  'spent',
  'seat_filled',
  'league_full',
  'joins_closed',
]

/**
 * Narrow the raw `Json` the RPC returns (typegen renders it as `Json`) into a
 * `JoinPreview`. Anything malformed or `found !== true` collapses to
 * `{ found: false }` — an unknown token and a shape we can't trust land on the
 * same honest "not a valid link" state rather than throwing on a public page.
 */
export function parseJoinPreview(raw: unknown): JoinPreview {
  if (!raw || typeof raw !== 'object') return { found: false }
  const r = raw as Record<string, unknown>
  if (r.found !== true) return { found: false }
  if (
    !PREVIEW_TYPES.includes(r.type as PreviewType) ||
    !PREVIEW_STATUSES.includes(r.status as PreviewStatus) ||
    typeof r.league_name !== 'string'
  ) {
    return { found: false }
  }
  return {
    found: true,
    type: r.type as PreviewType,
    status: r.status as PreviewStatus,
    league_name: r.league_name,
    team_label: typeof r.team_label === 'string' ? r.team_label : null,
    inviter_name: typeof r.inviter_name === 'string' ? r.inviter_name : null,
    seats_open: typeof r.seats_open === 'number' ? r.seats_open : null,
  }
}

// ---------------------------------------------------------------------------
// resolution-type → claim-kind
// ---------------------------------------------------------------------------

/**
 * Which RPC the actionable card drives: a seat/invite token claims through
 * `claim_league_invite` (identity-checked, E53/E65); a share code or custom
 * slug joins through `join_league_by_code` (open, free — Q6/F5). The route
 * param itself is passed verbatim to whichever endpoint; the `type` only
 * selects the endpoint and the copy.
 */
export type ClaimKind = 'seat' | 'join'

export function claimKindForType(type: PreviewType): ClaimKind {
  return type === 'invite' ? 'seat' : 'join'
}

// ---------------------------------------------------------------------------
// state → card-kind → friendly copy
// ---------------------------------------------------------------------------

/** The card the page renders. The two `claimable-*` kinds are actionable
 *  (claim/join button or sign-in handoff); the rest are terminal. */
export type CardKind =
  | 'claimable-seat'
  | 'claimable-join'
  | 'not-found'
  | 'revoked'
  | 'expired'
  | 'spent'
  | 'seat-filled'
  | 'seat-unavailable'
  | 'league-full'
  | 'joins-closed'
  | 'mismatch'
  | 'error'

export function isActionable(kind: CardKind): boolean {
  return kind === 'claimable-seat' || kind === 'claimable-join'
}

/** PRE-AUTH: what the preview alone tells us (identity is unknown here, so
 *  `mismatch` is never a preview outcome — it can only surface post-claim). */
export function previewToCardKind(preview: JoinPreview): CardKind {
  if (!preview.found) return 'not-found'
  if (preview.status === 'ok') {
    return claimKindForType(preview.type) === 'seat' ? 'claimable-seat' : 'claimable-join'
  }
  switch (preview.status) {
    case 'revoked':
      return 'revoked'
    case 'expired':
      return 'expired'
    case 'spent':
      return 'spent'
    case 'seat_filled':
      return 'seat-filled'
    case 'league_full':
      return 'league-full'
    case 'joins_closed':
      return 'joins-closed'
  }
}

/**
 * POST-ACTION: the `reason` a `claim_league_invite`/`join_league_by_code`
 * refusal carries (D72 outcome-jsonb) mapped to a terminal card. `mismatch`
 * (E53/E65 — wrong account) is reachable only here; a race that fills the
 * seat between preview and claim surfaces `seat_filled`/`seat_unavailable`
 * here too. Anything unrecognized (or a 5xx) falls to the generic `error`.
 */
export function outcomeReasonToCardKind(reason: string | undefined): CardKind {
  switch (reason) {
    case 'not_found':
      return 'not-found'
    case 'mismatch':
      return 'mismatch'
    case 'revoked':
      return 'revoked'
    case 'expired':
      return 'expired'
    case 'spent':
      return 'spent'
    case 'seat_filled':
      return 'seat-filled'
    case 'seat_unavailable':
      return 'seat-unavailable'
    case 'league_full':
      return 'league-full'
    case 'joins_closed':
      return 'joins-closed'
    default:
      return 'error'
  }
}

export interface StateCopy {
  title: string
  /** Authored fallback copy; the RPC's own `message` is preferred where it
   *  exists (the actual outcome path) via `cardCopy`. */
  message: string
  /** Icon-set glyph name (ui/icon.tsx). */
  icon: IconName
  /** Terminal cards render a muted "blocked" tone; claimable cards don't
   *  reach `STATE_COPY` (they show the header + action instead). */
  tone: 'blocked'
}

/**
 * Friendly copy for every terminal state (§16.5.2). The preview path carries
 * NO message, so this is the authored source of truth for it; the outcome
 * path prefers the RPC's own `message` (D72 — "surface the messages") and
 * falls back here. No copy here names or hints an email address (F2).
 */
export const STATE_COPY: Record<Exclude<CardKind, 'claimable-seat' | 'claimable-join'>, StateCopy> = {
  'not-found': {
    title: "This link isn't valid",
    message:
      "This invite link doesn't match any league — double-check it, or ask your commissioner for a new one.",
    icon: 'info-circle',
    tone: 'blocked',
  },
  revoked: {
    title: 'Invite revoked',
    message: 'The commissioner revoked this invite. Ask them to send you a new one.',
    icon: 'close',
    tone: 'blocked',
  },
  expired: {
    title: 'Invite expired',
    message: 'This invite has expired. Ask your commissioner to send a fresh one.',
    icon: 'clock',
    tone: 'blocked',
  },
  spent: {
    title: 'Invite already used',
    message: 'This invite has already been used the maximum number of times.',
    icon: 'check-circle',
    tone: 'blocked',
  },
  'seat-filled': {
    title: 'Seat already filled',
    message: 'Someone already claimed this seat. Ask your commissioner for a new invite.',
    icon: 'team',
    tone: 'blocked',
  },
  'seat-unavailable': {
    title: 'Seat no longer available',
    message: "That seat no longer exists in this league. Ask your commissioner for a new invite.",
    icon: 'info-circle',
    tone: 'blocked',
  },
  'league-full': {
    title: 'League is full',
    message: 'Every seat in this league is taken. Ask your commissioner about openings.',
    icon: 'team',
    tone: 'blocked',
  },
  'joins-closed': {
    title: 'Joining is closed',
    message:
      "This league's draft has started, so joining by link is closed. Ask the commissioner for a seat invite.",
    icon: 'clock',
    tone: 'blocked',
  },
  mismatch: {
    // E53/E65: friendly, and the invite stays intact (no writes on refusal —
    // D72). Never echoes the invited address (F2).
    title: 'Wrong account',
    message:
      'This invite was sent to a different account. Sign in with the invited account, or ask your commissioner to re-send it.',
    icon: 'report',
    tone: 'blocked',
  },
  error: {
    title: 'Something went wrong',
    message: 'We couldn’t complete that just now. Please try again in a moment.',
    icon: 'info-circle',
    tone: 'blocked',
  },
}

/**
 * Resolve a terminal card's copy, preferring an RPC-supplied `message` (the
 * outcome path) over the authored fallback (the preview path). `title`/`icon`
 * always come from the mapping so the surface is uniform regardless of entry.
 */
export function cardCopy(kind: CardKind, overrideMessage?: string | null): StateCopy {
  const base = STATE_COPY[kind as Exclude<CardKind, 'claimable-seat' | 'claimable-join'>]
  if (!base) {
    // Defensive: an actionable kind should never be passed here.
    return STATE_COPY.error
  }
  const trimmed = typeof overrideMessage === 'string' ? overrideMessage.trim() : ''
  return trimmed ? { ...base, message: trimmed } : base
}

// ---------------------------------------------------------------------------
// claim / join outcome payload (D72 outcome-jsonb)
// ---------------------------------------------------------------------------

export interface JoinClaimOutcome {
  ok: boolean
  already_member?: boolean
  league_id?: string
  team_id?: string
  league_name?: string
  reason?: string
  message?: string
}

/** A successful claim/join (including the idempotent already-member replay)
 *  lands the user on their league home — the caller routes to this. */
export function successLeagueId(outcome: JoinClaimOutcome): string | null {
  return outcome.ok && typeof outcome.league_id === 'string' ? outcome.league_id : null
}
