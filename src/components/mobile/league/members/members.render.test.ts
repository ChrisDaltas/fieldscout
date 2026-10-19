/**
 * League Menu › Members on the phone (gap list §4 item 106) — the screen
 * rendered from seeded queries (`renderToStaticMarkup`; effects don't run),
 * on the same reads as desktop's Members page (the league detail, the
 * commissioner's invite rows). Sheets are portalled (nothing in a static
 * render), so each sheet's body is mounted on its own. The pure rules are
 * pinned in `members-ops.test.ts`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  CREATOR_SEAT_NOTE,
  LEAVE_BLOCKED_NOTE,
  LINK_CLOSED_INVITE_HINT,
  LINK_CLOSED_NOTE,
  MEMBERS_INTRO_COMMISH,
  MEMBERS_INTRO_MEMBER,
  leaveLeagueCopy,
  removeOptionCopy,
  type PendingInviteInput,
  type Seat,
} from '@/components/leagues/invite-panel-ops'
import type { LeagueDetail } from '@/hooks/use-league'
import { leagueInvitesKeys } from '@/hooks/use-league-invites'
import { leaguesKeys } from '@/hooks/use-leagues'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { InviteBody, LeaveStepBody, ManageBody, PendingBody, RemoveBody, TransferBody } from './member-sheets'
import { MobileMembers } from './members-screen'

const auth = vi.hoisted(() => ({ userId: 'user-commish' }))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: auth.userId }, profile: { username: 'someone' }, isLoading: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/leagues/lg-1/members',
  useSearchParams: () => new URLSearchParams(''),
}))
// Who's online is filled over a live socket a static render never has.
const presence = vi.hoisted(() => ({ online: new Set<string>() }))
vi.mock('@/hooks/use-online', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/use-online')>()
  return {
    ...actual,
    useOnlineUserIds: () => presence.online,
    useTeamOnline: (members: Parameters<typeof actual.teamOnlineLookup>[0] | null | undefined) =>
      actual.teamOnlineLookup(members ?? [], presence.online),
  }
})

const LEAGUE = 'lg-1'
const [T1, T2, T3, T4, T5] = ['t1', 't2', 't3', 't4', 't5']

/** Five teams and a sixth seat still open (`team_count` 6): Alpha is yours
 *  (the commissioner's), Bravo a manager, Charlie a co-commissioner, Delta
 *  has an invite out, Echo has no manager. */
function detailWith(status: string, over: Partial<LeagueDetail> = {}): LeagueDetail {
  return {
    league: {
      id: LEAGUE,
      name: 'Members League',
      avatar_url: null,
      description: null,
      season: 2099,
      status,
      owner_id: 'user-commish',
      scoring_system_id: null,
      invite_code: 'abc123def456',
      invite_slug: null,
      max_teams: 6,
      created_at: null,
      updated_at: null,
      champion_team_id: null,
    },
    settings: { ...defaultsForTeamCount(8), team_count: 6 },
    members: [
      { id: 'm1', user_id: 'user-commish', team_id: T1, role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'chris', avatar_url: null } },
      { id: 'm2', user_id: 'user-manager', team_id: T2, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'jason', avatar_url: null } },
      { id: 'm3', user_id: 'user-co', team_id: T3, role: 'co_commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'tim', avatar_url: null } },
      { id: 'm4', user_id: null, team_id: T4, role: 'manager', is_placeholder: true, is_autodraft: true, joined_at: null, profiles: null },
      { id: 'm5', user_id: null, team_id: T5, role: 'manager', is_placeholder: true, is_autodraft: true, joined_at: null, profiles: null },
    ],
    teams: [
      { id: T1, name: 'Alpha', owner_id: 'user-commish', status: 'active', created_at: null },
      { id: T2, name: 'Bravo', owner_id: 'user-manager', status: 'active', created_at: null },
      { id: T3, name: 'Charlie', owner_id: 'user-co', status: 'active', created_at: null },
      { id: T4, name: 'Delta', owner_id: 'user-commish', status: 'active', created_at: null },
      { id: T5, name: 'Echo', owner_id: 'user-commish', status: 'active', created_at: null },
    ],
    my_role: 'commissioner',
    active_draft: null,
    ...over,
  } as LeagueDetail
}

const INVITES: PendingInviteInput[] = [
  {
    id: 'inv-1',
    target_team_id: T4,
    invited_email: 'new.manager@example.com',
    invited_username: null,
    token: 'seat-token-1',
    max_uses: 1,
    use_count: 0,
    expires_at: '2999-01-01T12:00:00.000Z',
    revoked_at: null,
    created_at: '2099-01-01T00:00:00.000Z',
  },
]

const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
}

function renderScreen(seed: { detail?: LeagueDetail | 'missing' | 'error'; viewer?: string } = {}): string {
  auth.userId = seed.viewer ?? 'user-commish'
  const qc = client()
  const detail = seed.detail ?? detailWith('in_season')
  if (detail === 'error') {
    const query = qc.getQueryCache().build(qc, { queryKey: leaguesKeys.detail(LEAGUE) })
    query.setState({ status: 'error', error: new Error('league read failed'), fetchStatus: 'idle' })
  } else if (detail !== 'missing') {
    qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)
    // The invite rows are commissioner-only over RLS (§12.23) — seeded only
    // for a commissioner viewer, as the database would answer.
    if (detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner') qc.setQueryData(leagueInvitesKeys.all(LEAGUE), INVITES)
  }
  return unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileMembers, { leagueId: LEAGUE }))))
}

function renderBody(el: ReactElement): string {
  return unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: client() }, el)))
}

/** The `<li>` of one seat, by its team name. */
function row(html: string, team: string): string {
  const at = html.indexOf(`>${team}<`)
  return html.slice(html.lastIndexOf('<li', at), html.indexOf('</li>', at))
}

const noop = () => {}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

describe('Members on the phone — the commissioner, before the draft', () => {
  const html = renderScreen({ detail: detailWith('setup') })

  it('is its own phone screen: the page bar titled Members, the intro, no desktop panel', () => {
    expect(html).toContain('data-mobile-screen')
    expect(html).toContain('>Members</h1>')
    expect(html).toContain('data-members-screen')
    expect(html).toContain(MEMBERS_INTRO_COMMISH)
    expect(html).not.toContain('data-members-page')
    expect(html).not.toContain('League share link')
  })

  it('the share link with Copy, then the custom link and rotate rows', () => {
    expect(html).toContain('data-share-link')
    expect(html).toContain('/join/abc123def456')
    expect(html).toContain('aria-label="Copy the league share link"')
    expect(html).toMatch(/data-link-row="slug"[^>]*>.*Custom link.*Not set/)
    expect(html).toContain('data-link-row="rotate"')
    expect(html).not.toContain('data-link-closed')
  })

  it('every seat, with its claimed count; each seat’s control by what it is', () => {
    expect(html).toContain('3 / 6 claimed')
    expect(row(html, 'Alpha')).not.toContain('data-seat-more') // yours — Leave is at the foot
    expect(row(html, 'Bravo')).toContain('data-seat-more="manage"')
    expect(row(html, 'Bravo')).toContain('aria-label="Manage Bravo"')
    expect(row(html, 'Charlie')).toContain('data-seat-more="manage"')
    expect(row(html, 'Delta')).toContain('data-seat-more="pending"')
    expect(row(html, 'Delta')).toContain('Invited new.manager@example.com')
    expect(row(html, 'Echo')).toContain('data-seat-more="invite"')
    expect(row(html, 'Echo')).toContain('No manager yet')
    expect(row(html, 'Open seat')).not.toContain('data-seat-more')
    expect(html.match(/data-seat-more=/g)).toHaveLength(4)
  })

  it('adds seats before the draft: one open seat → "Add an open seat" alone, and how many are left', () => {
    expect(html).toContain('data-add-seats')
    expect(html).toContain('Add an open seat')
    expect(html).not.toContain('data-fill-seats')
    expect(html).toContain('1 seat still open.')
    const more = detailWith('setup', { settings: defaultsForTeamCount(8) })
    expect(renderScreen({ detail: more })).toContain('Fill all 3 seats')
    expect(renderScreen({ detail: more })).toContain('3 seats still open.')
  })

  it('the sitting commissioner’s Leave is greyed, with why — prevent, don’t refuse', () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-leave-league/)
    expect(html).toContain(LEAVE_BLOCKED_NOTE)
  })
})

describe('Members on the phone — the commissioner, after the draft', () => {
  it.each(['drafting', 'in_season', 'playoffs', 'complete'])('%s: the link is closed and said; no seats to add; seats still managed', (status) => {
    const html = renderScreen({ detail: detailWith(status) })
    expect(html).not.toContain('data-share-link')
    expect(html).not.toContain('abc123def456')
    expect(html).toContain(`${LINK_CLOSED_NOTE} ${LINK_CLOSED_INVITE_HINT}`)
    expect(html).not.toContain('data-add-seats')
    expect(html).toContain('Open seat')
    expect(html.match(/data-seat-more=/g)).toHaveLength(4)
  })
})

describe('Members on the phone — a manager', () => {
  const html = renderScreen({ detail: detailWith('in_season', { my_role: 'manager' }), viewer: 'user-manager' })

  it('reads the list: the member intro, no link, no seat controls, no add', () => {
    expect(html).toContain(MEMBERS_INTRO_MEMBER)
    expect(html).not.toContain(MEMBERS_INTRO_COMMISH)
    expect(html).not.toContain('data-share-link')
    expect(html).not.toContain('data-link-closed')
    expect(html).not.toContain('data-seat-more')
    expect(html).not.toContain('data-add-seats')
    // No invite rows are read for him — Delta is a team with no manager.
    expect(row(html, 'Delta')).toContain('No manager yet')
    expect(html).not.toContain('new.manager@example.com')
  })

  it('his own Leave is offered, not greyed', () => {
    expect(html).toContain('data-leave-league')
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-leave-league/)
    expect(html).not.toContain(LEAVE_BLOCKED_NOTE)
  })
})

describe('Members on the phone — a co-commissioner and the league creator’s seat (§7.2)', () => {
  it('the creator’s seat says why it has no control; the commissioner’s seat has none; no transfer', () => {
    const detail = detailWith('in_season', {
      my_role: 'co_commissioner',
      members: [
        { id: 'm1', user_id: 'user-commish', team_id: T1, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'chris', avatar_url: null } },
        { id: 'm2', user_id: 'user-other', team_id: T2, role: 'co_commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'jason', avatar_url: null } },
        { id: 'm3', user_id: 'user-co', team_id: T3, role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'tim', avatar_url: null } },
        { id: 'm4', user_id: 'user-x', team_id: T4, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'xavier', avatar_url: null } },
      ],
    })
    const html = renderScreen({ detail, viewer: 'user-other' })
    expect(row(html, 'Alpha')).toContain('data-creator-seat')
    expect(row(html, 'Alpha')).toContain(CREATOR_SEAT_NOTE)
    expect(row(html, 'Alpha')).not.toContain('data-seat-more')
    expect(row(html, 'Charlie')).not.toContain('data-seat-more')
    expect(row(html, 'Delta')).toContain('data-seat-more="manage"')
    // A co-commissioner can leave freely.
    expect(html).not.toContain(LEAVE_BLOCKED_NOTE)
  })
})

describe('Members on the phone — doors', () => {
  it('every manager’s @handle opens his profile; every team its page', () => {
    for (const [viewer, role] of [['user-commish', 'commissioner'], ['user-manager', 'manager']] as const) {
      const html = renderScreen({ detail: detailWith('in_season', { my_role: role }), viewer })
      for (const name of ['chris', 'jason', 'tim']) {
        expect(html, `${role}/${name}`).toContain(`data-username-link="${name}"`)
        expect(html, `${role}/${name}`).toContain(`href="/u/${name}">@${name}</a>`)
      }
      for (const t of [T1, T2, T3, T4, T5]) expect(html, `${role}/${t}`).toContain(`href="/app/leagues/${LEAGUE}/team/${t}"`)
    }
  })
})

describe('Members on the phone — states and the look', () => {
  it('loading: the bar and a skeleton, never an empty list; error: said, with Try again', () => {
    const loading = renderScreen({ detail: 'missing' })
    expect(loading).toContain('data-members-loading')
    expect(loading).toContain('>Members</h1>')
    expect(loading).not.toContain('claimed')
    const error = renderScreen({ detail: 'error' })
    expect(error).toContain('Couldn’t load this league.')
    expect(error).toContain('Try again')
    expect(error).not.toContain('data-members-screen')
  })

  it('phone tokens only: no dark: variants, nothing elevated at rest, the bright red never a fill', () => {
    for (const html of [renderScreen({ detail: detailWith('setup') }), renderScreen({ detail: detailWith('in_season', { my_role: 'manager' }), viewer: 'user-manager' })]) {
      expect(html).not.toContain('dark:')
      expect(html).not.toMatch(/\bshadow-(?!none)/)
      expect(html).not.toMatch(/\bbg-(negative-strong|m-red)\b/)
    }
  })

  it('the route draws it on the phone (ByLayout); desktop keeps MembersPage', () => {
    const page = readFileSync(path.join(process.cwd(), 'src/app/app/(shell)/leagues/[leagueId]/members/page.tsx'), 'utf8')
    expect(page).toContain('<ByLayout desktop={<MembersPage leagueId={leagueId} />} mobile={<MobileMembers leagueId={leagueId} />} />')
  })
})

// ---------------------------------------------------------------------------
// The sheets' bodies
// ---------------------------------------------------------------------------

const BRAVO: Seat = {
  key: 'm2',
  status: 'claimed',
  teamName: 'Bravo',
  teamId: T2,
  memberId: 'm2',
  role: 'manager',
  isSelf: false,
  identity: '@jason',
  username: 'jason',
  emailTarget: null,
  usernameTarget: null,
  invite: null,
}

describe('a seated manager’s sheet', () => {
  it('who manages it (a profile door), then make co-commissioner, the transfer and Remove — Remove in red words', () => {
    const html = renderBody(createElement(ManageBody, { leagueId: LEAGUE, seat: BRAVO, myRole: 'commissioner', onPick: noop, onDone: noop }))
    expect(html).toContain('Managed by <a data-username-link="jason"')
    expect(html).toContain(' · Manager')
    expect([...html.matchAll(/data-manage-option="([a-z_]+)"/g)].map((m) => m[1])).toEqual(['make_co', 'transfer', 'remove'])
    expect(html).toMatch(/text-m-red[^"]*"[^>]*data-manage-option="remove"/)
    expect(html).not.toMatch(/retire/i)
  })
  it('a co-commissioner viewing: no transfer', () => {
    const html = renderBody(createElement(ManageBody, { leagueId: LEAGUE, seat: { ...BRAVO, role: 'co_commissioner' }, myRole: 'co_commissioner', onPick: noop, onDone: noop }))
    expect([...html.matchAll(/data-manage-option="([a-z_]+)"/g)].map((m) => m[1])).toEqual(['make_manager', 'remove'])
  })
  it('the transfer says what happens, with Transfer role and Back', () => {
    const html = renderBody(createElement(TransferBody, { leagueId: LEAGUE, seat: BRAVO, onBack: noop, onDone: noop }))
    expect(html).toContain('becomes the league commissioner and you step down to co-commissioner')
    expect(html).toContain('>Transfer role</button>')
    expect(html).toContain('>Back</button>')
  })
})

describe('remove — open the seat or hand it to someone (no retire)', () => {
  it('after the draft: takeover is preselected and Remove waits for the new manager’s username; the reason is optional', () => {
    const html = renderBody(createElement(RemoveBody, { leagueId: LEAGUE, leagueName: 'Members League', seat: BRAVO, phase: 'in_season', onBack: noop, onDone: noop }))
    expect(html).toContain('<a data-username-link="jason"')
    expect(html).toContain('manages Bravo in Members League.')
    expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>.*?Open the seat/)
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>.*?Hand it to someone/)
    expect(html).toContain(removeOptionCopy('in_season').takeover)
    expect(html).toContain('New manager’s username')
    expect(html).toContain('Reason (optional)')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-remove-confirm="true">Remove manager</)
    expect(html).not.toMatch(/retire/i)
  })
  it('before the draft: open the seat is preselected, and Remove is ready', () => {
    const html = renderBody(createElement(RemoveBody, { leagueId: LEAGUE, leagueName: 'Members League', seat: BRAVO, phase: 'pre_draft', onBack: noop, onDone: noop }))
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>.*?Open the seat/)
    expect(html).not.toContain('New manager’s username')
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-remove-confirm/)
  })
})

describe('a team with no manager — invite', () => {
  it('Email first (Username and Assign beside it), what it does, Send invite greyed until typed, and the team’s own link', () => {
    const html = renderBody(createElement(InviteBody, { leagueId: LEAGUE, teamId: T5, onDone: noop }))
    expect(html).toMatch(/aria-pressed="true"[^>]*>Email/)
    expect(html).toMatch(/aria-pressed="false"[^>]*>Username/)
    expect(html).toMatch(/aria-pressed="false"[^>]*>Assign/)
    expect(html).toContain('type="email"')
    expect(html).toContain('aria-label="Invite by email"')
    expect(html).toContain('no account needed first')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-invite-submit="email">Send invite</)
    expect(html).toContain('data-copy-seat-link')
    expect(html).toContain('Copy a link for this team')
  })
})

describe('an invite that’s out', () => {
  it('who it’s for and when it runs out; copy its link or revoke it (red words)', () => {
    const seat: Seat = { ...BRAVO, key: 'm4', status: 'invited', teamName: 'Delta', teamId: T4, memberId: 'm4', username: null, identity: null, emailTarget: 'new.manager@example.com', invite: INVITES[0] }
    const html = renderBody(createElement(PendingBody, { leagueId: LEAGUE, seat, nowMs: Date.parse('2099-06-01T00:00:00Z'), onDone: noop }))
    expect(html).toContain('Invited new.manager@example.com · Expires ')
    expect(html).toContain('>Copy invite link</button>')
    expect(html).toMatch(/text-m-red[^"]*"[^>]*data-revoke-invite="true">Revoke invite</)
  })
  it('an invite by username names a real account — a profile door', () => {
    const seat: Seat = { ...BRAVO, key: 'm4', status: 'invited', teamName: 'Delta', teamId: T4, username: null, identity: null, usernameTarget: 'newbie_gm', invite: INVITES[0] }
    const html = renderBody(createElement(PendingBody, { leagueId: LEAGUE, seat, nowMs: 0, onDone: noop }))
    expect(html).toContain('Invited <a data-username-link="newbie_gm"')
  })
})

describe('leaving — two confirmations (L.E1.41)', () => {
  it.each(['pre_draft', 'in_season'] as const)('%s: step one says what happens and only moves on; step two is the one that leaves', (phase) => {
    const copy = leaveLeagueCopy(phase, 'Alpha', 'Members League')
    const first = renderBody(createElement(LeaveStepBody, { step: 'consequences', copy, pending: false, onStep: noop, onConfirm: noop }))
    expect(first).toContain('data-leave-step="consequences"')
    expect(first).toContain(copy.consequences)
    expect(first).toContain('data-leave-continue="true">Continue</button>')
    expect(first).not.toContain('data-leave-confirm')
    const final = renderBody(createElement(LeaveStepBody, { step: 'final', copy, pending: false, onStep: noop, onConfirm: noop }))
    expect(final).toContain(copy.finalBody)
    expect(final).toContain('data-leave-confirm="true">Yes, leave this league</button>')
    expect(final).toContain('>Stay in the league</button>')
    expect(final).toContain('>Back</button>')
    expect(renderBody(createElement(LeaveStepBody, { step: 'final', copy, pending: true, onStep: noop, onConfirm: noop }))).toContain('Leaving…')
  })
  it('the sheet leaves only on the second confirmation (source pin)', () => {
    const src = readFileSync(path.join(__dirname, 'member-sheets.tsx'), 'utf8')
    const sheet = src.slice(src.indexOf('export function LeaveSheet('), src.indexOf('export function LeaveStepBody('))
    expect(sheet).toContain('if (!seat.memberId || !leaveConfirms(step)) return')
  })
})
