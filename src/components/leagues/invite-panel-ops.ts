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
 * The instant a seat is `claimed`, its identity is its manager's *@username*
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
  profiles: { username: string; avatar_url: string | null } | null
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
// Identity render rule (§16.4, ruling 2026-08-05): "@username"
// ---------------------------------------------------------------------------

/**
 * The manager half of the §16.4 identity line — the handle, and nothing else.
 * FieldScout stores no name for a person (ruling 2026-08-05), so there is
 * nothing else it could render. Never renders an email: profiles carry none,
 * and this is the only identity string a claimed seat ever shows.
 */
export function formatManagerIdentity(
  profile: { username: string } | null,
): string {
  if (!profile) return 'Unclaimed'
  return `@${profile.username}`
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
  /** claimed only — the manager's *@username*; null otherwise. */
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

// ---------------------------------------------------------------------------
// Bulk seat fill — the OUTCOME classifier (R958/R964)
// ---------------------------------------------------------------------------

/** The `seats_filled` / `team_count` postcondition `add_placeholder_seat`
 *  returns (063:467-473). The ONLY authoritative answer to "is this league
 *  seated yet" — `openCount` is derived from a cached league document with no
 *  window-focus refetch and no realtime on `league_members`, so it can be
 *  stale HIGH (managers joined by link since the last fetch) or stale LOW. */
export interface SeatCounts {
  filled: number
  total: number
}

export interface FillOutcome {
  title: string
  description: string
}

/** Narrow an `add_placeholder_seat` response to its seat counts, or null when
 *  the shape is not what we expect (never trust an unvalidated body). */
export function readSeatCounts(body: unknown): SeatCounts | null {
  if (body === null || typeof body !== 'object') return null
  const row = body as { seats_filled?: unknown; team_count?: unknown }
  const filled = row.seats_filled
  const total = row.team_count
  if (typeof filled !== 'number' || typeof total !== 'number') return null
  if (!Number.isFinite(filled) || !Number.isFinite(total) || total <= 0) return null
  return { filled, total }
}

/** True when the RPC refused because the league is ALREADY at capacity —
 *  i.e. the work this button exists to do is done. 063:446 raises this
 *  sentence and the API passes `error.message` straight through, so the
 *  substring is the only signal available; it is matched narrowly and the
 *  sentence is spec-pinned (§4 rule 13's byte-identical discipline). Treating
 *  it as failure is CLAUDE.md's "never let 'nothing happened' mean 'it
 *  worked'" running in REVERSE: inferring failure from a refusal without
 *  asserting its reason. */
export function isAlreadyFullRefusal(message: string): boolean {
  return /already has all \d+ seats/.test(message)
}

/** What to tell the commissioner after a bulk fill.
 *
 *  Reports from `seats` — the SERVER's numbers — and falls back to the client
 *  iteration count only when no response carried them. `added === 0` with a
 *  complete league is the concurrent case: someone else finished the job.
 *
 *  The share-link sentence is load-bearing, not decoration. Both self-serve
 *  join paths count MATERIALISED franchises, not unclaimed seats
 *  (062:1005-1008 and the general-claim arm at 062:911-916), so a league at
 *  capacity answers "This league is full" to its own invite link — and no
 *  verb anywhere removes a placeholder seat, so this is not undoable. What
 *  still works is a SEAT-TARGETED invite: that arm takes `target_team_id` and
 *  never reaches the capacity check (062:902), which is why the honest
 *  instruction is "invite a manager to a specific seat", not "share the
 *  link". */
export function fillOutcome(
  seats: SeatCounts | null,
  added: number,
  requested: number,
): FillOutcome {
  const seatWord = (n: number) => `${n} seat${n === 1 ? '' : 's'}`

  if (seats && seats.filled >= seats.total) {
    return {
      title: added === 0 ? 'Every seat already exists' : `${seatWord(added)} added`,
      description:
        `All ${seats.total} franchises exist, so the draft can start. The shared invite ` +
        `link will now answer "league is full" — invite managers to a specific seat instead.`,
    }
  }

  if (seats) {
    const short = seats.total - seats.filled
    return {
      title: `${seatWord(added)} added`,
      description:
        `${seats.filled} of ${seats.total} franchises exist — ${seatWord(short)} still ` +
        `open. Press it again to finish.`,
    }
  }

  // No server counts came back: say what we DID, never that the league is complete.
  return {
    title: `${seatWord(added)} added`,
    description:
      added >= requested
        ? 'Reload the page to confirm every seat exists.'
        : `Stopped after ${added} of ${requested}. Reload the page to see the current seats.`,
  }
}

// ---------------------------------------------------------------------------
// Which controls each league state accepts — L.E1.39 (F539; PROGRESS D460)
// ---------------------------------------------------------------------------

/**
 * The panel's league states. Every control was MEASURED against the newest
 * definition of its verb (the chain head), not assumed:
 *
 *   - `add_placeholder_seat` (169:292) — setup / scheduled only ("seats can
 *     only be added before the draft starts"). After that: not offered.
 *   - joining by the league link — the general claim (062:907) and
 *     `join_league_by_code` (062:998) answer "joining by link is closed" from
 *     `drafting` on. `rotate_invite_code` (169:1412) and
 *     `set_league_invite_slug` (169:1470) still accept, but their only job is
 *     that link — so the link card is offered before the draft only, and a
 *     sentence says why in its place.
 *   - `create_league_invite` to a seat (169:1180) + its claim (062:858),
 *     `revoke_league_invite` (169:1355), `assign_manager` (169:509),
 *     `set_member_role` (169:349), `remove_manager` takeover / vacate
 *     (169:642) and `leave_league` (150:2426) carry no league-state gate:
 *     offered in every state. (Each refuses a retired franchise, which has
 *     no seat row after 120 — so it is never a seat in this list.)
 *   - `remove_manager` retire (169:724) — accepted in_season / complete only
 *     (playoffs refused pending Q41) and it needs an `action_id` the members
 *     route does not carry (F262(a)) — so it has no door in ANY state; the
 *     reason is said per state.
 */
export type MembersPhase = 'pre_draft' | 'drafting' | 'in_season' | 'playoffs' | 'complete'

export function membersPhase(status: string): MembersPhase {
  if (status === 'setup' || status === 'scheduled') return 'pre_draft'
  if (status === 'drafting' || status === 'in_season' || status === 'playoffs' || status === 'complete') return status
  // An unknown status: the conservative arm — nothing only a pre-draft league
  // accepts is offered.
  return 'complete'
}

export const LINK_CLOSED_NOTE = 'Joining by the league link closed when the draft started.'
/** R1390: added only when a team below has no manager to invite someone to. */
export const LINK_CLOSED_INVITE_HINT = 'To fill a team, invite someone to that team below.'

export const RETIRE_BEFORE_DRAFT_WHY = 'Retiring a team is only possible after the draft.'
export const RETIRE_PLAYOFFS_WHY = 'A team can’t be retired during the playoffs.'
export const RETIRE_NO_SCREEN_WHY =
  'Retiring a team doesn’t have a screen yet — open the seat or hand the team to someone instead.'

export interface MemberControls {
  phase: MembersPhase
  /** The league share link card (copy, custom link, rotate). */
  shareLink: boolean
  /** Said in the link card's place once joining by link has closed. */
  linkClosedNote: string | null
  /** "Add an open seat" / "Fill all seats". */
  addSeats: boolean
  /** Why retire is not offered — it never is on this screen (F262(a)). */
  retireWhy: string
}

/** `hasUnmanagedSeat`: a seat below with no manager (open or invited) — the
 *  only case where "invite someone to that team below" is true (R1390). */
export function memberControls(status: string, hasUnmanagedSeat = false): MemberControls {
  const phase = membersPhase(status)
  const preDraft = phase === 'pre_draft'
  return {
    phase,
    shareLink: preDraft,
    linkClosedNote: preDraft ? null : hasUnmanagedSeat ? `${LINK_CLOSED_NOTE} ${LINK_CLOSED_INVITE_HINT}` : LINK_CLOSED_NOTE,
    addSeats: preDraft,
    retireWhy:
      phase === 'pre_draft' || phase === 'drafting'
        ? RETIRE_BEFORE_DRAFT_WHY
        : phase === 'playoffs'
          ? RETIRE_PLAYOFFS_WHY
          : RETIRE_NO_SCREEN_WHY,
  }
}

export interface RemoveOptionCopy {
  vacate: string
  takeover: string
}

/** R1385 — the remove chooser's preselected outcome. §7.2.1(a): takeover is
 *  the default ("the right call mid-season"); once the draft has started a
 *  mistaken vacate cancels the team's pending waiver claims (150), which
 *  cannot be undone. Before the draft vacate stays the recommended path.
 *  (Remove stays disabled under takeover until a username is typed.) */
export function defaultRemoveMode(phase: MembersPhase): 'takeover' | 'vacate' {
  return phase === 'pre_draft' ? 'vacate' : 'takeover'
}

/** What vacate and takeover do, said for the league's state (§7.2.1 (a) /
 *  (c); 146: once the draft has started the team keeps its FAAB through
 *  either; 150: a vacate cancels the team's pending waiver claims). */
export function removeOptionCopy(phase: MembersPhase): RemoveOptionCopy {
  if (phase === 'pre_draft') {
    return {
      vacate:
        'The team stays put and becomes an open seat. Invite a replacement to it afterward — the recommended path before the draft.',
      takeover:
        'A specific person takes over this team right now. They must have a FieldScout account and not already be in this league.',
    }
  }
  if (phase === 'drafting') {
    return {
      vacate: 'The team stays in the draft with no manager. Invite a replacement to it afterward.',
      takeover:
        'A specific person takes over this team right now, picks included. They must have a FieldScout account and not already be in this league.',
    }
  }
  return {
    vacate:
      'The team stays in the league with no manager — its players, record and FAAB stay with it, and its waiver claims are cancelled. Until you seat someone, you run it: set its lineup on its page, or switch its autopilot on.',
    takeover:
      'A specific person takes over this team right now, with its players, record and FAAB. They must have a FieldScout account and not already be in this league.',
  }
}

/** §7.2's anti-coup rule (169: `set_member_role` :442, `remove_manager`
 *  :787): a co-commissioner cannot change or remove the league CREATOR's
 *  seat (keyed on `leagues.owner_id`, never on role). */
export const CREATOR_SEAT_NOTE = 'Only the commissioner can change the league creator’s seat.'

export function creatorSeatBlocked(args: {
  myRole: string | null
  seatUserId: string | null
  leagueOwnerId: string
}): boolean {
  return args.myRole === 'co_commissioner' && args.seatUserId !== null && args.seatUserId === args.leagueOwnerId
}

/** The members page (L.E1.39) — the seat list after the draft. */
export function membersPageHref(leagueId: string): string {
  return `/app/leagues/${leagueId}/members`
}

export const MEMBERS_TITLE = 'Members'
export const MEMBERS_NAV_LABEL = 'Members'
export const MEMBERS_INTRO_COMMISH =
  'Invite someone to a team that has no manager, hand a team to someone else, name co-commissioners, or remove a manager.'
export const MEMBERS_INTRO_MEMBER = 'Everyone in the league and the team each one runs.'
