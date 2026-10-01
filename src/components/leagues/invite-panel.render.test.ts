/**
 * invite-panel.render.test.ts — M6 task L.E1.39's render proofs (F539;
 * PROGRESS D460): the ONE seat panel, rendered in every league state, shows
 * exactly the controls whose verbs accept that state (measured per verb in
 * `invite-panel-ops.ts`'s `memberControls` docblock), never a commissioner
 * control to a manager, and the members page that mounts it after the draft.
 *
 * The console rig: `renderToStaticMarkup` over the REAL `InvitePanel` /
 * `MembersPage` with the React Query cache pre-seeded (league detail, the
 * commissioner's invite rows); `PageHeader` rendered inline. Dialogs are
 * closed in a static render, so what the remove chooser says per state is
 * pinned on its pure copy (`memberControls` / `removeOptionCopy`).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { LeagueDetail } from '@/hooks/use-league'
import { leagueInvitesKeys } from '@/hooks/use-league-invites'
import { leaguesKeys } from '@/hooks/use-leagues'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { Dialog } from '@/components/ui/dialog'

import { InvitePanel, LeaveLeagueSteps } from './invite-panel'
import {
  CREATOR_SEAT_NOTE,
  LINK_CLOSED_INVITE_HINT,
  LINK_CLOSED_NOTE,
  MEMBERS_INTRO_COMMISH,
  MEMBERS_INTRO_MEMBER,
  creatorSeatBlocked,
  defaultRemoveMode,
  leaveConfirms,
  leaveLeagueCopy,
  memberControls,
  membersPhase,
  nextLeaveStep,
  removeOptionCopy,
  type LeaveStep,
  type MembersPhase,
  type PendingInviteInput,
} from './invite-panel-ops'
import { MembersPage } from './members-page'

const auth = vi.hoisted(() => ({ userId: 'user-commish' }))

vi.mock('@/components/layout/app-header', () => ({
  PageHeader: ({ title, actions }: { title: ReactNode; actions?: ReactNode }) =>
    createElement('header', { 'data-page-header': '' }, createElement('h1', null, title), actions ?? null),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: auth.userId }, profile: { username: 'someone' } }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/',
}))

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const LEAGUE = 'e1390000-0000-4000-8000-000000000001'
const T1 = 'e1390000-0000-4000-8000-000000000101'
const T2 = 'e1390000-0000-4000-8000-000000000102'
const T3 = 'e1390000-0000-4000-8000-000000000103'
const T4 = 'e1390000-0000-4000-8000-000000000104'
const T5 = 'e1390000-0000-4000-8000-000000000105'

const STATES = ['setup', 'scheduled', 'drafting', 'in_season', 'playoffs', 'complete'] as const

/** Five franchises and a sixth seat still open (`team_count` 6) — so "Add a
 *  seat" is offered wherever `add_placeholder_seat` would accept it, and the
 *  post-draft cells prove it is NOT offered even with an open ghost seat. */
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
      { id: T5, name: 'Echo', owner_id: 'user-commish', status: 'orphaned', created_at: null },
    ],
    my_role: 'commissioner',
    active_draft: null,
    ...over,
  } as LeagueDetail
}

/** A pending seat invite on Delta (T4); Echo (T5) has none. */
const INVITES: PendingInviteInput[] = [
  {
    id: 'inv-1',
    target_team_id: T4,
    invited_email: 'new.manager@example.com',
    invited_username: null,
    token: 'seat-token-1',
    max_uses: 1,
    use_count: 0,
    expires_at: '2999-01-01T00:00:00.000Z',
    revoked_at: null,
    created_at: '2099-01-01T00:00:00.000Z',
  },
]

/** The invite rows are commissioner-only over RLS (§12.23) and the panel does
 *  not even ask for them as a manager — so they are seeded for a commissioner
 *  viewer only, as the database would answer. */
function seedInvites(qc: QueryClient, detail: LeagueDetail) {
  if (detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner') {
    qc.setQueryData(leagueInvitesKeys.all(LEAGUE), INVITES)
  }
}

function renderPanel(detail: LeagueDetail, viewer = 'user-commish'): string {
  auth.userId = viewer
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  seedInvites(qc, detail)
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(InvitePanel, { leagueId: LEAGUE, detail })),
  )
}

/** The controls present in a render, by what a commissioner can press. */
function controlsIn(html: string) {
  return {
    shareLink: html.includes('League share link'),
    rotate: html.includes('Rotate link'),
    customLink: html.includes('Custom link'),
    linkClosedNote: html.includes('data-link-closed'),
    addSeat: html.includes('Add an open seat'),
    fillAll: html.includes('Fill all'),
    seatInvite: html.includes('aria-label="Invite by email"'),
    seatLinkCopy: html.includes('aria-label="Copy this seat&#x27;s invite link"'),
    revoke: html.includes('Revoke'),
    makeCo: html.includes('Make co-commish'),
    makeManager: html.includes('Make manager'),
    transfer: html.includes('Make commissioner'),
    // The Remove button: its icon, then the word (the dialog is closed).
    remove: html.includes('</svg> Remove</button>'),
    leave: html.includes('Leave league'),
  }
}

const PRE_DRAFT_TABLE = {
  shareLink: true,
  rotate: true,
  customLink: true,
  linkClosedNote: false,
  addSeat: true,
  fillAll: false, // one open seat: "Add an open seat" alone
  seatInvite: true,
  seatLinkCopy: true,
  revoke: true,
  makeCo: true,
  makeManager: true,
  transfer: true,
  remove: true,
  leave: true,
}
const AFTER_LINK_CLOSED = {
  ...PRE_DRAFT_TABLE,
  shareLink: false,
  rotate: false,
  customLink: false,
  linkClosedNote: true,
  addSeat: false,
}

// ---------------------------------------------------------------------------
// The per-state control table (the commissioner's view)
// ---------------------------------------------------------------------------

describe('InvitePanel — each control only where its verb accepts it, per league state', () => {
  it.each([
    ['setup', PRE_DRAFT_TABLE],
    ['scheduled', PRE_DRAFT_TABLE],
    ['drafting', AFTER_LINK_CLOSED],
    ['in_season', AFTER_LINK_CLOSED],
    ['playoffs', AFTER_LINK_CLOSED],
    ['complete', AFTER_LINK_CLOSED],
  ] as const)('%s: the commissioner sees exactly this table', (status, table) => {
    expect(controlsIn(renderPanel(detailWith(status)))).toEqual(table)
  })

  it('after the draft the closed link is SAID, in words, where the link card was', () => {
    for (const status of ['drafting', 'in_season', 'playoffs', 'complete']) {
      const html = renderPanel(detailWith(status))
      expect(html, status).toContain(LINK_CLOSED_NOTE)
      expect(html, status).not.toContain('abc123def456')
    }
    expect(renderPanel(detailWith('setup'))).not.toContain(LINK_CLOSED_NOTE)
  })

  it('R1390: "invite someone to that team below" is said only when a team below has no manager', () => {
    const withOpen = renderPanel(detailWith('in_season'))
    expect(withOpen).toContain(`${LINK_CLOSED_NOTE} ${LINK_CLOSED_INVITE_HINT}`)
    // Every seat has a manager (the two open seats seated): the note stands alone.
    const full = detailWith('in_season')
    full.members = full.members.map((m, i) => (m.user_id ? m : { ...m, user_id: `user-seated-${i}`, is_placeholder: false }))
    const html = renderPanel(full)
    expect(html).toContain(LINK_CLOSED_NOTE)
    expect(html).not.toContain(LINK_CLOSED_INVITE_HINT)
  })

  it('after the draft, "Add a seat" is never offered — even with an open seat still showing (169:292 refuses it)', () => {
    for (const status of ['drafting', 'in_season', 'playoffs', 'complete']) {
      const html = renderPanel(detailWith(status))
      expect(html, status).toContain('Open seat')
      expect(html, status).not.toContain('Add an open seat')
      expect(html, status).not.toContain('still open.')
    }
  })

  it('every state: a seat with no manager can be invited to or assigned; a pending invite can be copied or revoked', () => {
    for (const status of STATES) {
      const html = renderPanel(detailWith(status))
      expect(html, status).toContain('aria-label="Invite by email"')
      expect(html, status).toContain('>Assign</button>')
      expect(html, status).toContain('Invited new.manager@example.com')
    }
  })

  it('the sitting commissioner cannot leave before handing the role over — in every state', () => {
    for (const status of STATES) {
      const html = renderPanel(detailWith(status))
      expect(html, status).toContain('Transfer the commissioner role to another member before you can leave.')
    }
  })
})

// ---------------------------------------------------------------------------
// Never a commissioner control to a manager
// ---------------------------------------------------------------------------

describe('a manager sees the list read-only (the panel already supports it) — in every state', () => {
  it.each(STATES)('%s: no link, no seat tools, no roles, no remove — only the list and his own Leave', (status) => {
    const html = renderPanel(detailWith(status, { my_role: 'manager' }), 'user-manager')
    expect(controlsIn(html)).toEqual({
      shareLink: false,
      rotate: false,
      customLink: false,
      linkClosedNote: false,
      addSeat: false,
      fillAll: false,
      seatInvite: false,
      seatLinkCopy: false,
      revoke: false,
      makeCo: false,
      makeManager: false,
      transfer: false,
      remove: false,
      leave: true,
    })
    // The seats are all there (his own marked, with Leave).
    for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) expect(html, name).toContain(name)
  })
})

// ---------------------------------------------------------------------------
// §7.2 anti-coup — a co-commissioner is refused on the creator's seat
// ---------------------------------------------------------------------------

describe('a co-commissioner and the league creator’s seat (169:442 / :787)', () => {
  it('the creator is a plain manager after a transfer: the co-commissioner is offered no role or remove on that seat — it is said', () => {
    // The creator (user-commish) handed the role to user-co and then was
    // demoted to manager; a SECOND co-commissioner (user-other) views.
    const detail = detailWith('in_season', {
      my_role: 'co_commissioner',
      members: [
        { id: 'm1', user_id: 'user-commish', team_id: T1, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'chris', avatar_url: null } },
        { id: 'm2', user_id: 'user-other', team_id: T2, role: 'co_commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'jason', avatar_url: null } },
        { id: 'm3', user_id: 'user-co', team_id: T3, role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'tim', avatar_url: null } },
        { id: 'm4', user_id: 'user-x', team_id: T4, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'xavier', avatar_url: null } },
      ],
    })
    const html = renderPanel(detail, 'user-other')
    expect(html).toContain('data-creator-seat')
    expect(html).toContain(CREATOR_SEAT_NOTE)
    // Exactly ONE seat is offered role / remove controls — the non-creator manager's.
    expect(html.match(/Make co-commish/g)).toHaveLength(1)
    // A co-commissioner never sees the transfer (only the sitting commissioner may).
    expect(html).not.toContain('Make commissioner')
    // The sitting commissioner's seat says who runs the show — nothing to press.
    expect(html).toContain('The league commissioner runs the show.')
  })

  it('the pure rule: co-commissioner + the creator’s seat only', () => {
    expect(creatorSeatBlocked({ myRole: 'co_commissioner', seatUserId: 'owner', leagueOwnerId: 'owner' })).toBe(true)
    expect(creatorSeatBlocked({ myRole: 'commissioner', seatUserId: 'owner', leagueOwnerId: 'owner' })).toBe(false)
    expect(creatorSeatBlocked({ myRole: 'co_commissioner', seatUserId: 'someone', leagueOwnerId: 'owner' })).toBe(false)
    expect(creatorSeatBlocked({ myRole: 'co_commissioner', seatUserId: null, leagueOwnerId: 'owner' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The remove chooser's words per state (dialogs are closed in a static render)
// ---------------------------------------------------------------------------

describe('the remove chooser per state — two outcomes, takeover and vacate, in every state (L.E1.42: no retire); each says what it does now', () => {
  it('memberControls: the table the panel renders from — no retire field in any state', () => {
    expect(STATES.map((s) => [s, memberControls(s)])).toEqual([
      ['setup', { phase: 'pre_draft', shareLink: true, linkClosedNote: null, addSeats: true }],
      ['scheduled', { phase: 'pre_draft', shareLink: true, linkClosedNote: null, addSeats: true }],
      ['drafting', { phase: 'drafting', shareLink: false, linkClosedNote: LINK_CLOSED_NOTE, addSeats: false }],
      ['in_season', { phase: 'in_season', shareLink: false, linkClosedNote: LINK_CLOSED_NOTE, addSeats: false }],
      ['playoffs', { phase: 'playoffs', shareLink: false, linkClosedNote: LINK_CLOSED_NOTE, addSeats: false }],
      ['complete', { phase: 'complete', shareLink: false, linkClosedNote: LINK_CLOSED_NOTE, addSeats: false }],
    ])
  })

  it('L.E1.42: the panel says nothing about retiring in any state, for a commissioner or a manager (no dead or disabled door)', () => {
    for (const status of STATES) {
      expect(renderPanel(detailWith(status))).not.toMatch(/retire/i)
      expect(renderPanel(detailWith(status, { my_role: 'manager' }), 'user-manager')).not.toMatch(/retire/i)
    }
  })

  it('the dialog wiring (closed in a static render — pinned at the source): takeover and vacate only, the reason optional, no retire anywhere', () => {
    const source = readFileSync(path.join(__dirname, 'invite-panel.tsx'), 'utf8')
    const dialog = source.slice(source.indexOf('function RemoveManagerDialog'), source.indexOf('function ModeOption'))
    expect(dialog).toContain("onSelect={() => setMode('vacate')}")
    expect(dialog).toContain("onSelect={() => setMode('takeover')}")
    expect(dialog.match(/<ModeOption\b/g)).toHaveLength(2)
    expect(dialog).not.toMatch(/retire|successor_team_name/i)
    expect(dialog).toContain('Reason (optional)')
    expect(dialog).toContain("'Remove manager'")
  })

  it('memberControls with a team that has no manager: the invite hint joins the closed-link note after the draft only', () => {
    expect(memberControls('in_season', true).linkClosedNote).toBe(`${LINK_CLOSED_NOTE} ${LINK_CLOSED_INVITE_HINT}`)
    expect(memberControls('setup', true).linkClosedNote).toBeNull()
  })

  it('R1385: the chooser preselects TAKEOVER once the draft has started (§7.2.1(a) — a mistaken vacate cancels waiver claims); vacate before it', () => {
    expect(STATES.map((s) => defaultRemoveMode(membersPhase(s)))).toEqual([
      'vacate',
      'vacate',
      'takeover',
      'takeover',
      'takeover',
      'takeover',
    ])
    // The dialog is closed in a static render, so its seed is pinned at the source:
    // the chooser's state starts from this rule, never a literal.
    const source = readFileSync(path.join(__dirname, 'invite-panel.tsx'), 'utf8')
    expect(source).toContain('useState<RemoveMode>(defaultRemoveMode(controls.phase))')
    expect(source).not.toContain("useState<RemoveMode>('vacate')")
  })

  it('an unknown status offers nothing only a pre-draft league accepts', () => {
    expect(membersPhase('archived')).toBe('complete')
    expect(memberControls('archived').addSeats).toBe(false)
    expect(memberControls('archived').shareLink).toBe(false)
  })

  it('after the draft, vacate says the team keeps its players, record and FAAB and who runs it; before, the old words', () => {
    const after = removeOptionCopy('in_season')
    expect(after.vacate).toContain('players, record and FAAB stay with it')
    expect(after.vacate).toContain('switch its autopilot on')
    expect(after.takeover).toContain('with its players, record and FAAB')
    expect(removeOptionCopy('pre_draft').vacate).toContain('recommended path before the draft')
    expect(removeOptionCopy('drafting').vacate).not.toContain('autopilot')
  })

  it('plain words: no status value, verb name or migration number reaches the screen', () => {
    const copies = STATES.flatMap((s) => {
      const c = memberControls(s)
      const r = removeOptionCopy(c.phase)
      return [
        c.linkClosedNote ?? '',
        r.vacate,
        r.takeover,
      ]
    })
    for (const text of copies) {
      expect(text).not.toMatch(/in_season|remove_manager|add_placeholder|\b1\d\d\b|Q41|F262/)
    }
  })
})

// ---------------------------------------------------------------------------
// The members page
// ---------------------------------------------------------------------------

function renderPage(seed: { detail?: LeagueDetail | 'missing' | 'error' }, viewer = 'user-commish'): string {
  auth.userId = viewer
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  const detail = seed.detail ?? detailWith('in_season')
  if (typeof detail === 'object') seedInvites(qc, detail)
  if (detail === 'error') {
    const query = qc.getQueryCache().build(qc, { queryKey: leaguesKeys.detail(LEAGUE) })
    query.setState({ status: 'error', error: new Error('league read failed'), fetchStatus: 'idle' })
  } else if (detail !== 'missing') {
    qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)
  }
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MembersPage, { leagueId: LEAGUE })))
}

describe('MembersPage — the same panel, after the draft', () => {
  it('a commissioner: the intro, the panel with its post-draft controls, and the door back to the league', () => {
    const html = renderPage({})
    expect(html).toContain('data-members-page')
    expect(html).toContain(MEMBERS_INTRO_COMMISH)
    expect(html).toContain(`href="/app/leagues/${LEAGUE}"`)
    expect(controlsIn(html)).toEqual(AFTER_LINK_CLOSED)
  })

  it('a manager: the read-only intro and list — no commissioner control', () => {
    const html = renderPage({ detail: detailWith('in_season', { my_role: 'manager' }) }, 'user-manager')
    expect(html).toContain(MEMBERS_INTRO_MEMBER)
    expect(html).not.toContain(MEMBERS_INTRO_COMMISH)
    expect(html).not.toContain('aria-label="Invite by email"')
    expect(html).not.toContain('Make co-commish')
  })

  it('loading: a skeleton, never an empty list; error: the problem card with retry — never an empty list', () => {
    expect(renderPage({ detail: 'missing' })).toContain('data-members-loading')
    const error = renderPage({ detail: 'error' })
    expect(error).toContain('Couldn’t load this league.')
    expect(error).toContain('Retry')
    expect(error).not.toContain('data-members-page')
  })

  it('nothing on the page is elevated at rest (CLAUDE.md) — every hard shadow sits behind an interaction prefix', () => {
    const html = renderPage({})
    const tokens = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/))
    for (const t of tokens.filter((x) => x.includes('shadow-hard'))) {
      expect(t, t).toMatch(/^(hover|active|focus-visible|group-hover):/)
    }
    expect(html).not.toContain('dark:')
  })
})

// ---------------------------------------------------------------------------
// L.E1.41 — every manager's name opens his profile; leaving takes TWO
// confirmations (Chris 2026-09-30, both rulings verbatim in PROGRESS D462)
// ---------------------------------------------------------------------------

describe('L.E1.41 — a seat’s manager is a door to his profile', () => {
  it.each(STATES)('%s: every claimed seat’s @username links to /u/<username>, for a commissioner and a manager', (status) => {
    for (const [viewer, role] of [['user-commish', 'commissioner'], ['user-manager', 'manager']] as const) {
      const html = renderPanel(detailWith(status, { my_role: role }), viewer)
      for (const name of ['chris', 'jason', 'tim']) {
        expect(html, `${status} / ${role} / ${name}`).toContain(`<a data-username-link="${name}" class="`)
        expect(html, `${status} / ${role} / ${name}`).toContain(`href="/u/${name}">@${name}</a>`)
      }
      // A seat with no manager names no one — nothing to link.
      expect(html.match(/data-username-link=/g)).toHaveLength(3)
    }
  })
  it('an invite by username names a real account — that name links too', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
    auth.userId = 'user-commish'
    qc.setQueryData(leagueInvitesKeys.all(LEAGUE), [{ ...INVITES[0], invited_email: null, invited_username: 'newbie_gm' }])
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: qc }, createElement(InvitePanel, { leagueId: LEAGUE, detail: detailWith('in_season') })),
    )
    expect(html).toContain('Invited <a data-username-link="newbie_gm"')
  })
  it('in the live draft room (team links off) a name opens in a NEW TAB — leaving the room can cost a pick', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
    auth.userId = 'user-commish'
    seedInvites(qc, detailWith('drafting'))
    const room = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: qc }, createElement(InvitePanel, { leagueId: LEAGUE, detail: detailWith('drafting'), linkTeams: false })),
    )
    expect(room).toMatch(/<a data-username-link="jason" target="_blank" rel="noopener noreferrer"/)
    expect(renderPanel(detailWith('in_season'))).not.toContain('target="_blank"')
  })
})

describe('L.E1.41 — leaving a league takes two confirmations', () => {
  it('the step machine: open → the consequences; continue → the last check; back / cancel; nothing else moves it', () => {
    expect(nextLeaveStep('closed', 'open')).toBe('consequences')
    expect(nextLeaveStep('consequences', 'continue')).toBe('final')
    expect(nextLeaveStep('final', 'back')).toBe('consequences')
    expect(nextLeaveStep('final', 'cancel')).toBe('closed')
    expect(nextLeaveStep('consequences', 'cancel')).toBe('closed')
    // A stray event never skips a step.
    expect(nextLeaveStep('closed', 'continue')).toBe('closed')
    expect(nextLeaveStep('consequences', 'open')).toBe('consequences')
    expect(nextLeaveStep('final', 'continue')).toBe('final')
  })
  it('only the SECOND confirmation leaves — never the first, never a closed dialog', () => {
    expect(leaveConfirms('closed')).toBe(false)
    expect(leaveConfirms('consequences')).toBe(false)
    expect(leaveConfirms('final')).toBe(true)
  })
  it('the panel’s leave handler is gated on that rule, and the first step’s button only moves on (source pin)', () => {
    const src = readFileSync(path.join(__dirname, 'invite-panel.tsx'), 'utf8')
    const self = src.slice(src.indexOf('function SelfSeatControls('), src.indexOf('export function LeaveLeagueSteps('))
    expect(self).toContain('if (!seat.memberId || !leaveConfirms(step)) return')
    const steps = src.slice(src.indexOf('export function LeaveLeagueSteps('))
    const first = steps.slice(steps.indexOf('data-leave-step="consequences"'))
    expect(first).toContain("onClick={() => onStep('continue')} data-leave-continue")
    expect(first.slice(0, first.indexOf('</DialogFooter>'))).not.toContain('onConfirm')
  })

  function renderStep(step: LeaveStep, phase: MembersPhase, pending = false): string {
    const calls: string[] = []
    const html = renderToStaticMarkup(
      createElement(
        Dialog,
        { open: true },
        createElement(LeaveLeagueSteps, {
          step,
          copy: leaveLeagueCopy(phase, 'Bravo', 'Members League'),
          pending,
          onStep: (e: string) => calls.push(e),
          onConfirm: () => calls.push('confirm'),
        }),
      ),
    )
    return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  }

  it.each(['pre_draft', 'drafting', 'in_season', 'playoffs', 'complete'] as const)(
    '%s — step one says what happens to the team and offers Continue (no leave); step two is the last check with "Yes, leave this league"',
    (phase) => {
      const copy = leaveLeagueCopy(phase, 'Bravo', 'Members League')
      const first = renderStep('consequences', phase)
      expect(first).toContain('data-leave-step="consequences"')
      expect(first).toContain('Leave Members League?')
      expect(first).toContain(copy.consequences)
      expect(first).toContain('will have no manager')
      expect(first).toContain('>Continue</button>')
      expect(first).not.toContain('data-leave-confirm')
      expect(first).not.toContain(copy.confirmLabel)

      const final = renderStep('final', phase)
      expect(final).toContain('data-leave-step="final"')
      expect(final).toContain('Are you sure you want to leave?')
      expect(final).toContain(copy.finalBody)
      expect(final).toContain('data-leave-confirm')
      expect(final).toContain('>Yes, leave this league</button>')
      expect(final).toContain('>Back</button>')
      expect(final).toContain('>Stay in the league</button>')
      expect(renderStep('final', phase, true)).toContain('Leaving…')
    },
  )
  it('R1405: the last check says how you could come back — the league link before the draft, a commissioner’s invite after', () => {
    expect(leaveLeagueCopy('pre_draft', 'Bravo', 'Members League').finalBody).toBe(
      'You’ll leave Members League and give up Bravo. To come back you’d need the league link again, and a spot still open.',
    )
    for (const phase of ['drafting', 'in_season', 'playoffs', 'complete'] as const) {
      expect(leaveLeagueCopy(phase, 'Bravo', 'Members League').finalBody, phase).toBe(
        'You’ll leave Members League and give up Bravo. You can’t undo this yourself — a commissioner can invite you back.',
      )
    }
    for (const phase of ['pre_draft', 'drafting', 'in_season', 'playoffs', 'complete'] as const) {
      expect(leaveLeagueCopy(phase, 'Bravo', 'L').finalBody, phase).not.toMatch(/only the commissioner|for good/)
    }
  })
  it('mid-season the consequences are in plain words: no manager, players / record / FAAB kept, claims cancelled, the commissioner or autopilot runs it', () => {
    const inSeason = leaveLeagueCopy('in_season', 'Bravo', 'Members League').consequences
    expect(inSeason).toBe(
      'Your team (Bravo) will have no manager. It keeps its players, record and FAAB, and its pending waiver claims are cancelled. The commissioner runs it — or puts it on autopilot — for the rest of the season, until someone new takes it over.',
    )
    expect(leaveLeagueCopy('drafting', 'Bravo', 'L').consequences).toContain('autopick makes its picks')
    expect(leaveLeagueCopy('pre_draft', 'Bravo', 'L').consequences).toContain('becomes an open seat')
    for (const phase of ['pre_draft', 'drafting', 'in_season', 'playoffs', 'complete'] as const) {
      const c = leaveLeagueCopy(phase, 'Bravo', 'L')
      expect(`${c.consequences} ${c.finalBody}`).not.toMatch(/leave_league|in_season|orphan|franchise|\b\d{3}\b/)
    }
  })
  it('leaving stays offered in every state (a manager’s own seat) — the double confirm, not a refusal', () => {
    for (const status of STATES) {
      const html = renderPanel(detailWith(status, { my_role: 'manager' }), 'user-manager')
      expect(html, status).toContain('data-leave-league')
      expect(html, status).not.toContain('data-leave-step') // the dialog opens only on a press
    }
  })
})
