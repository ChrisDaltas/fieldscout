/**
 * Invite-panel derivation — pure logic for the seat list, the identity render
 * rule, and the invite-status machine (M1 task L.A2.5; spec §7.2 email-first,
 * §16.4 identity display rule, §16.5.2 invite-workflow states, §12.23 RLS).
 *
 * Colocated with the component (the roster/scoring/wizard-ops precedent) and
 * pure so the golden pins run without React. It is deliberately NOT under
 * `src/lib/leagues/**` — the panel is a UI surface, not league engine, so the
 * TimeProvider ESLint guard does not apply; even so, every time-dependent read
 * takes `nowMs` as a parameter (never a wall-clock read inside) so expiry is
 * deterministic and pinnable.
 *
 * THE PRIVACY INVARIANT (§7.2 / §12.23 — a real security rule, not cosmetic).
 * `invited_email` is commissioner-visible on PENDING invites only, and this
 * module is the render authority the panel trusts: a seat only ever exposes an
 * email when its status is `invited` (a still-pending seat-targeted invite).
 * The instant a seat is `claimed`, its identity is *display name (@username)*
 * and it carries NO email — even if a leftover/consumed invite row for the
 * same franchise still holds one (the commissioner can see that row over RLS;
 * the seat must not render it). `deriveSeats` enforces this by attaching the
 * invite (hence its email) only to `invited` seats — `claimed` seats get
 * `invite: null`, `emailTarget: null`. The invite-panel-ops test pins it both
 * ways (a claimed seat serialises with no email present; an invited seat does
 * surface it, so the guard isn't vacuously green).
 */

// ---------------------------------------------------------------------------
// Inputs (subsets of the GET /api/leagues/[id] detail + the league_invites
// commish-only SELECT — see use-league-invites.ts)
// ---------------------------------------------------------------------------

export interface SeatMemberInput {
  id: string
  user_id: string | null
  team_id: string | null
  role: string
  is_placeholder: boolean | null
  profiles: { username: string; display_name: string | null; avatar_url: string | null } | null
}

export interface SeatTeamInput {
  id: string
  name: string
  status: string
}

/** One `league_invites` row as the commissioner sees it (RLS commish-only). */
export interface PendingInviteInput {
  id: string
  target_team_id: string | null
  invited_email: string | null
  invited_username: string | null
  token: string
  max_uses: number
  use_count: number
  expires_at: string
  revoked_at: string | null
  created_at: string | null
}

// ---------------------------------------------------------------------------
// Identity render rule (§16.4): "display name (@username)"
// ---------------------------------------------------------------------------

/**
 * The manager half of the §16.4 identity line — *display name (@username)* —
 * with a graceful fallback to the bare handle when the display name is unset
 * (the auto-generated pre-selection placeholder can leave it null). Never
 * renders an email: profiles carry none, and this is the only identity string
 * a claimed seat ever shows.
 */
export function formatManagerIdentity(
  profile: { username: string; display_name: string | null } | null,
): string {
  if (!profile) return 'Unclaimed'
  const handle = `@${profile.username}`
  return profile.display_name ? `${profile.display_name} (${handle})` : handle
}

// ---------------------------------------------------------------------------
// Invite status machine (§16.5.2 invite-workflow states)
// ---------------------------------------------------------------------------

export type InviteState = 'active' | 'revoked' | 'expired' | 'spent'

/**
 * Display state of a `league_invites` row. Precedence mirrors the 062 claim
 * algebra (D72): revoked → expired-at-instant → spent → active. Expiry is
 * expires-AT-the-instant (`nowMs >= expires_at`, D72(3)/F6), so a row is
 * `expired` the moment its `expires_at` passes.
 */
export function inviteState(invite: PendingInviteInput, nowMs: number): InviteState {
  if (invite.revoked_at) return 'revoked'
  const expiresMs = Date.parse(invite.expires_at)
  if (!Number.isNaN(expiresMs) && nowMs >= expiresMs) return 'expired'
  if (invite.use_count >= invite.max_uses) return 'spent'
  return 'active'
}

/** A pending invite is one that can still be claimed (state === 'active'). */
export function isPendingInvite(invite: PendingInviteInput, nowMs: number): boolean {
  return inviteState(invite, nowMs) === 'active'
}

// ---------------------------------------------------------------------------
// Seat model
// ---------------------------------------------------------------------------

export type SeatStatus = 'claimed' | 'invited' | 'placeholder' | 'open'

export interface Seat {
  /** Stable key: the member id for materialised seats, `open-N` for ghosts. */
  key: string
  status: SeatStatus
  /** The franchise label (team name), or a synthetic "Open seat" for ghosts. */
  teamName: string
  teamId: string | null
  memberId: string | null
  role: string | null
  isSelf: boolean
  /** claimed only — *display name (@username)*; null otherwise. */
  identity: string | null
  /** invited only — the commissioner-visible invited email; NULL for claimed. */
  emailTarget: string | null
  /** invited only — the commissioner-visible invited username; NULL for claimed. */
  usernameTarget: string | null
  /**
   * invited only — the pending seat-targeted invite (carries token for the
   * copyable link + id for revoke). NULL for every non-invited seat, which is
   * what keeps a claimed seat's email off the wire.
   */
  invite: PendingInviteInput | null
}

export interface SeatListModel {
  seats: Seat[]
  /** team_count — the total seats the league will field. */
  total: number
  /** Seats with a real, seated manager (a claimed franchise). */
  claimedCount: number
  /** Materialised franchises (claimed + placeholder/invited). */
  materialisedCount: number
  /** Seats not yet materialised as a franchise (total − materialised, ≥ 0). */
  openCount: number
}

/**
 * Build the seat list from the league detail + the commissioner's invite rows.
 *
 * A materialised seat is a `league_members` row with a franchise (`team_id`):
 *   - `user_id` set                    → `claimed`   (identity from profiles)
 *   - placeholder + a pending invite   → `invited`   (email/username shown)
 *   - placeholder + no pending invite  → `placeholder`
 * The remaining `team_count − materialised` seats are `open` ghosts the
 * commissioner can add.
 *
 * Precedence is claimed > invited > placeholder: a franchise that already has
 * a seated manager NEVER renders as `invited`, so a leftover invite's email is
 * never shown for it (the privacy invariant). Callers pass `members` already
 * ordered (the detail query orders by `joined_at`); ghost seats append last.
 */
export function deriveSeats(
  input: {
    teamCount: number
    members: SeatMemberInput[]
    teams: SeatTeamInput[]
    invites: PendingInviteInput[]
    currentUserId: string | null
  },
  nowMs: number,
): SeatListModel {
  const { teamCount, members, teams, invites, currentUserId } = input

  const teamsById = new Map(teams.map((t) => [t.id, t]))

  // Most-recent pending seat-targeted invite per franchise. Seat-targeted =
  // target_team_id set; pending = still claimable. General links (no target)
  // are the share link, not a seat, and are excluded here.
  const inviteByTeam = new Map<string, PendingInviteInput>()
  for (const invite of invites) {
    if (!invite.target_team_id) continue
    if (!isPendingInvite(invite, nowMs)) continue
    const existing = inviteByTeam.get(invite.target_team_id)
    if (!existing || sortsAfter(invite, existing)) {
      inviteByTeam.set(invite.target_team_id, invite)
    }
  }

  const seats: Seat[] = members.map((member) => {
    const team = member.team_id ? teamsById.get(member.team_id) : undefined
    const teamName = team?.name ?? 'Team'
    const isClaimed = member.user_id != null
    const pendingInvite = member.team_id ? inviteByTeam.get(member.team_id) : undefined

    // claimed > invited > placeholder. The invite (and its email) is attached
    // ONLY on the invited branch — a claimed seat gets invite/email null.
    let status: SeatStatus
    if (isClaimed) status = 'claimed'
    else if (pendingInvite) status = 'invited'
    else status = 'placeholder'

    const invited = status === 'invited' ? (pendingInvite ?? null) : null

    return {
      key: member.id,
      status,
      teamName,
      teamId: member.team_id,
      memberId: member.id,
      role: member.role,
      isSelf: member.user_id != null && member.user_id === currentUserId,
      identity: status === 'claimed' ? formatManagerIdentity(member.profiles) : null,
      emailTarget: invited?.invited_email ?? null,
      usernameTarget: invited?.invited_username ?? null,
      invite: invited,
    }
  })

  const materialisedCount = seats.length
  const claimedCount = seats.filter((s) => s.status === 'claimed').length
  const openCount = Math.max(0, teamCount - materialisedCount)

  for (let i = 0; i < openCount; i++) {
    seats.push({
      key: `open-${i}`,
      status: 'open',
      teamName: 'Open seat',
      teamId: null,
      memberId: null,
      role: null,
      isSelf: false,
      identity: null,
      emailTarget: null,
      usernameTarget: null,
      invite: null,
    })
  }

  return { seats, total: teamCount, claimedCount, materialisedCount, openCount }
}

/** Deterministic "b is newer than a" using created_at, id as the tiebreak. */
function sortsAfter(a: PendingInviteInput, b: PendingInviteInput): boolean {
  const at = a.created_at ? Date.parse(a.created_at) : 0
  const bt = b.created_at ? Date.parse(b.created_at) : 0
  if (at !== bt) return at > bt
  return a.id > b.id
}

// ---------------------------------------------------------------------------
// Share link (§7.2 path 1: /join/<slug> with fallback to the random code)
// ---------------------------------------------------------------------------

/** The share code the join URL uses: the custom slug when set, else the code. */
export function preferredShareCode(
  inviteSlug: string | null,
  inviteCode: string | null,
): string | null {
  return inviteSlug ?? inviteCode ?? null
}

/** `${origin}/join/${codeOrToken}` — origin is '' during SSR (relative link). */
export function buildJoinLink(origin: string, codeOrToken: string): string {
  return `${origin}/join/${codeOrToken}`
}

/**
 * The inverse of `buildJoinLink`: normalise whatever a commissioner pasted into
 * the join-by-code field down to the bare code / token / slug the `/join/[token]`
 * route (and `get_join_preview`) expects. The real share artifacts ARE absolute
 * URLs — `buildJoinLink`'s `${origin}/join/<code>` and the wizard's copied
 * `${window.location.origin}/join/<invite_code>` — so a pasted link must resolve
 * to the same invite a bare code would, not dead-end as an unresolvable
 * `/join/https%3A%2F%2F…` segment (R114; the field's own copy invites the paste).
 *
 * Handles a full absolute URL, a protocol-relative / bare-host form, a path-only
 * `/join/<code>`, a trailing slash, and `?query` / `#hash` suffixes: strips the
 * query/hash, then takes the last non-empty path segment after `/join/`. A bare
 * code/slug (no `/join/`) passes through trimmed. The extracted value keeps its
 * original case (seat tokens are case-sensitive; the RPC lower()s codes/slugs
 * itself) and is NOT URL-encoded — the caller encodes it for the route param.
 */
export function extractJoinCode(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  // Everything before the first ? or # — a query/hash never belongs to the code.
  const path = trimmed.split(/[?#]/, 1)[0]
  const marker = /\/join\//i.exec(path)
  // No /join/ marker: a bare code/token/slug — pass it through as typed.
  if (!marker) return trimmed
  const afterJoin = path.slice(marker.index + marker[0].length)
  const segments = afterJoin.split('/').filter((segment) => segment.length > 0)
  return segments.length > 0 ? segments[segments.length - 1] : ''
}

// ---------------------------------------------------------------------------
// Custom slug validation (mirrors the 062 contract so the field fails fast —
// 3–40 chars [a-z0-9-], alphanumeric ends; the RPC is still the authority)
// ---------------------------------------------------------------------------

export const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$/

/** Client-side slug check; returns an error message or null. The RPC re-checks
 *  (taken / code-shadow) and is the authority — this only saves a round trip. */
export function validateSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase()
  if (slug.length < 3) return 'Use at least 3 characters.'
  if (slug.length > 40) return 'Keep it to 40 characters or fewer.'
  if (!SLUG_PATTERN.test(slug)) {
    return 'Letters, numbers and hyphens only, starting and ending with a letter or number.'
  }
  return null
}
