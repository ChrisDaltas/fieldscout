/**
 * username-link.render.test.ts — M6 L.E1.41's proofs (PROGRESS D462). Chris,
 * 2026-09-30: *"Clicking a user name should always take a user to the user
 * profile they clicked on. and user profile names should virtually always be
 * clickable."*
 *
 *  1. The primitive and its pure half — one URL spelling, the marked-name
 *     parts, and where a stored post names its actor (boundary cases).
 *  2. The surfaces whose renderer lives outside a heavier rig: the activity
 *     feed's posts, the commissioner log's sentences, the draft chat, the
 *     draft room's lists panel rows. (The seat list, League Home, the
 *     Activity page and the team page are pinned in their own render suites.)
 *  3. THE CENSUS — every place the source renders a person's handle by hand
 *     (`@{…username}`, `` `@${…username}` ``, a hand-built `/u/${…}` profile
 *     URL) must be on the list below with the reason it is not a link. A new
 *     plain handle anywhere in the app fails here BY FILE AND LINE.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ChatItem } from '@/components/draft/draft-chat'
import { deriveListsPanelRows } from '@/components/draft/my-lists-panel-ops'
import { ActivityFeed, CommishLogSection } from '@/components/leagues/activity-feed'
import { chatAuthorsById, chatItemView } from '@/hooks/use-draft-chat-ops'
import type { ActivityItem } from '@/lib/leagues/api/activity-service'
import type { CommishLogItem } from '@/lib/leagues/api/commish-log-service'

import { TextWithActor, TextWithUsernames, UsernameLink } from './username-link'
import { markUsername, plainText, splitActorName, userProfileHref, usernameParts } from './username-link-ops'

const html = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

// ---------------------------------------------------------------------------
// 1. The primitive
// ---------------------------------------------------------------------------

describe('UsernameLink — the one person link', () => {
  it('opens /u/<username>, shows @username by default, and adds only the link treatment', () => {
    expect(userProfileHref('chris_gm')).toBe('/u/chris_gm')
    expect(userProfileHref('bathew-ai')).toBe('/u/bathew-ai')
    const out = html(createElement(UsernameLink, { username: 'chris_gm', className: 'font-bold' }))
    expect(out).toContain('href="/u/chris_gm"')
    expect(out).toContain('>@chris_gm</a>')
    expect(out).toContain('data-username-link="chris_gm"')
    expect(out).toContain('decoration-transparent')
    expect(out).toContain('font-bold')
    expect(out).not.toContain('target=')
    // Elevation is a hover state only (CLAUDE.md) — and text never lifts.
    expect(out).not.toMatch(/shadow-/)
  })
  it('inside a sentence the name reads bare; in the draft room it opens in a new tab', () => {
    expect(html(createElement(UsernameLink, { username: 'chris_gm', at: false }))).toContain('>chris_gm</a>')
    const room = html(createElement(UsernameLink, { username: 'chris_gm', newTab: true }))
    expect(room).toContain('target="_blank"')
    expect(room).toContain('rel="noopener noreferrer"')
  })
})

describe('marked names — the app’s own sentences link exactly the names they interpolated', () => {
  it('parts, plain text, and a sentence with two people', () => {
    const marked = `replaced Bravo’s manager: ${markUsername('jason')} → ${markUsername('tim_b')}`
    expect(plainText(marked)).toBe('replaced Bravo’s manager: jason → tim_b')
    expect(usernameParts(marked)).toEqual(['replaced Bravo’s manager: ', { username: 'jason' }, ' → ', { username: 'tim_b' }])
    const out = html(createElement(TextWithUsernames, { marked }))
    expect(out).toMatch(
      /^replaced Bravo’s manager: <a data-username-link="jason" class="[^"]+" href="\/u\/jason">jason<\/a> → <a data-username-link="tim_b" class="[^"]+" href="\/u\/tim_b">tim_b<\/a>$/,
    )
  })
  it('a sentence with no marks is its own words; a stray mark never leaks to the screen', () => {
    expect(usernameParts('set Alpha’s Week 3 lineup')).toEqual(['set Alpha’s Week 3 lineup'])
    expect(plainText('half open')).toBe('half open')
  })
})

describe('splitActorName — where a stored post names its actor', () => {
  it('after "by", or opening the post', () => {
    expect(splitActorName('Draft paused by chris.', 'chris')).toEqual({ before: 'Draft paused by ', username: 'chris', after: '.' })
    expect(splitActorName('chris (commissioner) vetoed a trade: A gives B', 'chris')).toEqual({ before: '', username: 'chris', after: ' (commissioner) vetoed a trade: A gives B' })
  })
  it('the "by" occurrence wins over the default team name that repeats the username', () => {
    const split = splitActorName("Pick 3 edited by chris: chris's Team takes X", 'chris')
    expect(split?.before).toBe('Pick 3 edited by ')
    expect(split?.after).toBe(": chris's Team takes X")
  })
  it('never a guess: part of a longer name, a renamed account, a missing actor — plain', () => {
    expect(splitActorName('Draft paused by chrisb.', 'chris')).toBeNull()
    expect(splitActorName('Draft paused by chris_b.', 'chris')).toBeNull()
    expect(splitActorName('standby chris.', 'chris')).toBeNull()
    expect(splitActorName('Draft paused by old_name.', 'new_name')).toBeNull()
    expect(splitActorName('Draft paused by chris.', null)).toBeNull()
    expect(splitActorName('chrisx vetoed', 'chris')).toBeNull()
  })
  it('TextWithActor renders the split, or the text untouched', () => {
    expect(html(createElement(TextWithActor, { text: 'Draft paused by chris.', actor: 'chris' }))).toMatch(/^Draft paused by <a [^>]*href="\/u\/chris">chris<\/a>\.$/)
    expect(html(createElement(TextWithActor, { text: 'Week 3 finalized.', actor: null }))).toBe('Week 3 finalized.')
  })
})

// ---------------------------------------------------------------------------
// 2. The surfaces
// ---------------------------------------------------------------------------

const LEAGUE = 'e1410000-0000-4000-8000-000000000001'
const MEMBERS = new Map([
  ['user-c', 'chris'],
  ['user-d', 'dana'],
])

function post(over: Partial<Extract<ActivityItem, { kind: 'system' }>>): ActivityItem {
  return { kind: 'system', id: 'p1', created_at: '2099-09-08T12:00:00Z', context: 'league', message: '', actor_id: null, topic: null, week: null, commish_action_id: null, ...over } as ActivityItem
}

describe('the activity feed (League Home, the Activity page) — a post’s actor opens his profile', () => {
  const render = (items: ActivityItem[], memberNames?: ReadonlyMap<string, string>) =>
    html(
      createElement(ActivityFeed, {
        leagueId: LEAGUE,
        items,
        pending: false,
        problem: null,
        onRetry: () => {},
        teamNames: new Map(),
        leagueTimeZone: null,
        memberNames,
      }),
    )
  it('a commissioner’s post names him — linked; a system notice names no one — plain', () => {
    const out = render(
      [
        post({ id: 'p-veto', message: 'chris (commissioner) vetoed a trade: Alpha gives E; Bravo gives F', actor_id: 'user-c' }),
        post({ id: 'p-remix', message: 'Schedule remixed by dana: 3 of 14 regular-season weeks regenerated', actor_id: 'user-d' }),
        post({ id: 'p-sys', message: 'Week 3 finalized with a postponed game.' }),
      ],
      MEMBERS,
    )
    expect(out).toMatch(/data-feed-text="true"><a data-username-link="chris"[^>]*href="\/u\/chris">chris<\/a> \(commissioner\) vetoed/)
    expect(out).toMatch(/Schedule remixed by <a data-username-link="dana"[^>]*href="\/u\/dana">dana<\/a>: 3 of 14/)
    expect(out.match(/data-username-link=/g)).toHaveLength(2)
  })
  it('an actor no longer in the league, or a host that passes no members: the words, no link', () => {
    expect(render([post({ message: 'Draft paused by gone_gm.', actor_id: 'user-gone' })], MEMBERS)).not.toContain('data-username-link')
    expect(render([post({ message: 'Draft paused by chris.', actor_id: 'user-c' })])).not.toContain('data-username-link')
  })
})

describe('the commissioner log (League Home, the console, the Activity page) — the actor and every member named', () => {
  const item = (over: Partial<CommishLogItem>): CommishLogItem => ({
    id: 'ca-1', action_type: 'promote_member', actor: { id: 'user-c', username: 'chris' }, target_type: 'member', target_id: null, reason: null,
    before: { role: 'manager' }, after: { role: 'co_commissioner' }, metadata: { user_id: 'user-d' }, acting_as_team_id: null, reverts_action_id: null, created_at: '2099-09-12T12:00:00Z', ...over,
  })
  const render = (items: CommishLogItem[]) =>
    html(
      createElement(CommishLogSection, {
        items,
        pending: false,
        problem: null,
        onRetry: () => {},
        hasMore: false,
        memberNames: MEMBERS,
        teamNames: new Map([['t2', 'Bravo']]),
        leagueTimeZone: null,
      }),
    )
  it('"chris made dana a co-commissioner" — both names are doors', () => {
    const out = render([item({})])
    expect(out).toMatch(/<a data-username-link="chris"[^>]*font-bold[^>]*href="\/u\/chris">chris<\/a> made <a data-username-link="dana"[^>]*href="\/u\/dana">dana<\/a> a co-commissioner/)
  })
  it('a receipt with no named actor reads "A commissioner" — plain, never a dead link', () => {
    const out = render([item({ actor: { id: 'user-x', username: null } })])
    expect(out).toContain('<span class="font-bold">A commissioner</span>')
    expect(out.match(/data-username-link=/g)).toHaveLength(1) // dana only
  })
})

describe('the draft room — names open in a new tab (leaving the room can cost a pick)', () => {
  const members = [
    { user_id: 'user-c', team_id: 't1', profiles: { username: 'chris' } },
    { user_id: 'user-d', team_id: null, profiles: { username: 'dana' } },
  ]
  const authors = chatAuthorsById(members, [{ id: 't1', name: 'Alpha' }])
  const row = (over: Partial<Parameters<typeof chatItemView>[0]>) => ({ id: 'r', user_id: 'user-c', message: 'gl all', context: 'draft', is_system: false, created_at: null, ...over })
  it('chat: "Alpha — @chris", the handle a door; a member with no team is the bare handle, linked', () => {
    const out = html(createElement(ChatItem, { view: chatItemView(row({}), authors, null, MEMBERS) }))
    expect(out).toMatch(/Alpha — <a data-username-link="chris" target="_blank" rel="noopener noreferrer"[^>]*href="\/u\/chris">@chris<\/a>/)
    const bare = html(createElement(ChatItem, { view: chatItemView(row({ user_id: 'user-d' }), authors, null, MEMBERS) }))
    expect(bare).toMatch(/<a data-username-link="dana" target="_blank"[^>]*>@dana<\/a>/)
  })
  it('chat: a commissioner’s system post names him — linked; a former member stays plain', () => {
    const sys = html(createElement(ChatItem, { view: chatItemView(row({ is_system: true, message: 'Draft paused by chris.' }), authors, null, MEMBERS) }))
    expect(sys).toMatch(/Draft paused by <a data-username-link="chris" target="_blank"[^>]*>chris<\/a>\./)
    const gone = html(createElement(ChatItem, { view: chatItemView(row({ user_id: null }), authors, null, MEMBERS) }))
    expect(gone).not.toContain('data-username-link')
  })
  it('lists panel: a fellow member’s shared list names him by username (the row links it); mine names no one', () => {
    const rows = deriveListsPanelRows(
      [
        { id: 'a1', list_id: 'l1', owner_id: 'user-d', is_primary_board: false, shared_with_league: true, lists: { title: 'Dana’s', player_count: 10 } },
        { id: 'a2', list_id: 'l2', owner_id: 'user-c', is_primary_board: true, shared_with_league: false, lists: { title: 'Mine', player_count: 5 } },
      ] as unknown as Parameters<typeof deriveListsPanelRows>[0],
      'user-c',
      null,
      MEMBERS,
    )
    expect(rows.find((r) => r.key === 'a1')?.ownerUsername).toBe('dana')
    expect(rows.find((r) => r.key === 'a2')?.ownerUsername).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. The census
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '../../..')
const SCAN = ['src/components', 'src/app', 'src/hooks']
/** A handle rendered by hand, or a person's profile URL built by hand. */
const PATTERNS = [
  /@\{[^}]*(?:username|handle)[^}]*\}/, // JSX text: @{x.username}
  /@\$\{[^}]*(?:username|handle)[^}]*\}/, // a template: `@${x.username}`
  /[`'"]\/u\/\$\{[^}]+\}[`'"]/, // `/u/${x}` — a person's profile, by hand
]

/**
 * Every hit, and why it is not a `UsernameLink`. `contains` is a substring of
 * the hit's line. An entry that matches nothing fails too (no dead reasons).
 */
const ALLOWED: ReadonlyArray<{ file: string; contains: string; why: string }> = [
  { file: 'src/components/shared/username-link.tsx', contains: '{at ? `@${username}` : username}', why: 'the primitive itself' },
  { file: 'src/components/shared/username-link-ops.ts', contains: 'return `/u/${encodeURIComponent(username)}`', why: 'the one spelling of the URL' },
  { file: 'src/components/draft/draft-chat.tsx', contains: 'const handle = username ? `@${username}` : null', why: 'ChatAuthor finds the handle in the label to render it as a UsernameLink' },
  { file: 'src/hooks/use-draft-chat-ops.ts', contains: '— @${member.profiles.username}', why: 'the chat author LABEL; ChatAuthor links its handle (proved above)' },
  { file: 'src/components/draft/my-lists-panel-ops.ts', contains: 'ownerLabel: mine ? null : username ? `@${username}`', why: 'the row label; the panel renders ownerUsername as a UsernameLink' },
  { file: 'src/components/leagues/invite-panel-ops.ts', contains: 'return `@${profile.username}`', why: 'the seat identity string for confirm-dialog sentences; the seat row renders `username` as a UsernameLink (invite-panel.render.test)' },
  { file: 'src/components/leagues/invite-panel.tsx', contains: 'No FieldScout account @${handle}.', why: 'an error message about a username that has no account — there is no profile to open' },
  { file: 'src/components/lists/public-list-card.tsx', contains: '`@${owner.username}`', why: 'the unlinked arm: the owner’s own profile page, or an AI persona (its page is /personas/…)' },
  { file: 'src/components/explore/explore-feed.tsx', contains: '· @${item.author.handle}', why: 'an AI persona’s handle — its page is /personas/…, not a person’s profile' },
  { file: 'src/components/layout/account-menu.tsx', contains: 'const handle = `@${profile.username}`', why: 'the viewer’s own handle on the account-menu trigger button (the menu holds the profile link)' },
  { file: 'src/components/shared/command-palette.tsx', contains: 'by @${list.owner_username}', why: 'inside a command-palette item — the whole item is one button (opens the list)' },
  { file: 'src/components/shared/command-palette.tsx', contains: '@{u.username}</span>', why: 'inside a command-palette item that itself opens this profile' },
  { file: 'src/app/app/(shell)/settings/page.tsx', contains: 'value={`@${profile.username}`}', why: 'a read-only text input — never a link' },
  { file: 'src/components/profile/profile-header.tsx', contains: '@{username}', why: 'the profile page’s own heading — a link to the page you are on' },
  { file: 'src/app/u/[username]/page.tsx', contains: 'const handle = `@${profile.username}`', why: 'page metadata (title / description), not rendered text' },
  { file: 'src/app/u/[username]/page.tsx', contains: 'Public lists @{profile.username} publishes', why: 'the profile page’s own empty state' },
  { file: 'src/app/u/[username]/followers/page.tsx', contains: 'Followers of @${username}', why: 'page metadata' },
  { file: 'src/app/u/[username]/followers/page.tsx', contains: '← @{profile.username}', why: 'already inside the back link to the profile' },
  { file: 'src/app/u/[username]/followers/page.tsx', contains: 'When scouts follow @{profile.username}', why: 'the empty state under the back link to the same profile' },
  { file: 'src/app/u/[username]/following/page.tsx', contains: '`@${username} is following', why: 'page metadata' },
  { file: 'src/app/u/[username]/following/page.tsx', contains: '← @{profile.username}', why: 'already inside the back link to the profile' },
  { file: 'src/app/u/[username]/following/page.tsx', contains: 'Scouts @{profile.username} follows', why: 'the empty state under the back link to the same profile' },
  { file: 'src/app/u/[username]/lists/[listSlug]/page.tsx', contains: 'const handle = `@${profile.username}`', why: 'page metadata' },
  { file: 'src/app/u/[username]/big-board/page.tsx', contains: 'const handle = `@${data.profile.username}`', why: 'metadata, and the page header title string (big board is flag-gated at launch — F551)' },
  { file: 'src/app/u/[username]/big-board/week/[week]/page.tsx', contains: 'const handle = `@${data.profile.username}`', why: 'metadata, and the page header title string (big board is flag-gated at launch — F551)' },
  { file: 'src/app/personas/[username]/page.tsx', contains: '@{persona.username}', why: 'an AI persona’s own page — not a person' },
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(tsx?|ts)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

describe('the census — no person’s handle is rendered plain without a reason (L.E1.41)', () => {
  const hits = SCAN.flatMap((dir) =>
    sourceFiles(path.join(ROOT, dir)).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (PATTERNS.some((re) => re.test(line)) ? [{ file: path.relative(ROOT, file), line: i + 1, text: line.trim() }] : [])),
    ),
  )
  it('the scan reads real source (the census is not vacuous)', () => {
    expect(hits.length).toBeGreaterThanOrEqual(ALLOWED.length)
  })
  it.each(hits.map((h) => [`${h.file}:${h.line}`, h] as const))('%s is a link or has a reason', (_where, hit) => {
    const allowed = ALLOWED.some((a) => a.file === hit.file && hit.text.includes(a.contains))
    expect(allowed, `${hit.file}:${hit.line} renders a handle or builds a profile URL by hand — use UsernameLink / userProfileHref, or add it to ALLOWED with the reason: ${hit.text}`).toBe(true)
  })
  it.each(ALLOWED.map((a) => [`${a.file} — ${a.contains}`, a] as const))('allowlist entry is live: %s', (_label, entry) => {
    expect(hits.some((h) => h.file === entry.file && h.text.includes(entry.contains))).toBe(true)
  })
})
