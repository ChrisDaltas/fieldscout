/**
 * Start-or-sit's question pages on the phone (gap list §4 item 112):
 * `/app/start-or-sit/new` and `/app/start-or-sit/[id]` draw their own
 * FieldScout Mobile screens — the 52px page bar (blue back chevron, the
 * title as the h1), in `m-*` tokens only so the phone's dark mode follows —
 * instead of the borrowed desktop placeholder. Desktop keeps its pages.
 *
 *  - Ask a question: there is no way to post a question yet, so it is the
 *    honest "coming soon" in the phone's language — no composer whose Post
 *    does nothing.
 *  - A question: the real row in My start/sit's card, with Community's
 *    author row on top (the asker's @handle opens their profile, when they
 *    asked, the scoring and week); no vote control (voting isn't built).
 *    Loading, "not here" and a failed read (with Try again) are their own
 *    states.
 *
 * The screens render statically (effects don't run). Back is fired from the
 * element tree against mocked Back helpers — how those choose back /
 * replace is pinned in back-nav.test.ts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SsQuestionDetail } from '@/components/mobile/profile/profile-ops'

const nav = vi.hoisted(() => ({ goBack: vi.fn() }))
const read = vi.hoisted(() => ({
  state: { data: undefined as unknown, isError: false },
  refetch: vi.fn(),
  ids: [] as string[],
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/start-or-sit/q1',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/mobile/ui/back-nav', () => ({
  useGoBack: () => nav.goBack,
}))

vi.mock('@/hooks/use-start-sit-question', () => ({
  useStartSitQuestion: (id: string) => {
    read.ids.push(id)
    return { ...read.state, refetch: read.refetch }
  },
}))

import {
  ASK_START_SIT_COPY,
  MobileAskStartSit,
  MobileStartSitQuestion,
  START_SIT_PARENT,
  START_SIT_QUESTION_COPY,
} from './start-sit-pages'

const NOW = Date.now()
const HOUR = 60 * 60_000

const QUESTION: SsQuestionDetail = {
  id: '5f77b13f-0501-4413-9367-46cf5f84ebef',
  note: 'FLEX spot: who starts this week?',
  season: 2026,
  week: 7,
  votesA: 41,
  votesB: 17,
  closesAt: new Date(NOW + 3 * 24 * HOUR).toISOString(),
  resolvedAt: null,
  createdAt: new Date(NOW - 2 * HOUR).toISOString(),
  playerA: { id: '9509', full_name: 'Bijan Robinson', team: 'ATL', position: 'RB', headshot_url: null },
  playerB: { id: '9221', full_name: 'Jahmyr Gibbs', team: 'DET', position: 'RB', headshot_url: null },
  poster: { id: 'u2', username: 'devpro', avatarUrl: null },
  scoringName: 'Scout PPR',
}

function html(node: ReactElement): string {
  return renderToStaticMarkup(node)
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
}
const ask = () => html(createElement(MobileAskStartSit))
const question = (id = QUESTION.id) => html(createElement(MobileStartSitQuestion, { questionId: id }))

/** Desktop colour tokens: fixed light colours that don't follow phone dark
 *  mode (the phone draws in `m-*`). */
const DESKTOP_COLOUR = /^(?:[a-z]+:)*(?:text|bg|border)-(?:ink|white|n-\d|negative|positive|caution|surface)/

/** The shared parts the card reuses as-is, everywhere on the phone: the
 *  headshot's initials (#6E6E73 on its own fixed #EEEEF1 disc — the handoff
 *  draws them so in both themes) and the author avatar's root, which its
 *  photo or colour fill covers. */
const SHARED_PARTS = new Set(['text-white', 'text-n-3', 'bg-surface-pressed'])

function phoneTokensOnly(markup: string) {
  const tokens = [...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/)).filter(Boolean)
  expect(tokens.filter((t) => DESKTOP_COLOUR.test(t) && !SHARED_PARTS.has(t))).toEqual([])
  expect(tokens).toEqual(expect.arrayContaining(['bg-m-b0', 'text-m-t1']))
}

/** Every onClick in a screen's element tree, keyed by the button's text or
 *  aria-label — to fire Back and Try again without a DOM. (Only for states
 *  whose tree holds no hook-using parts: the question card's headshots
 *  render through React.) */
function clicks(node: ReactNode, out = new Map<string, () => void>()): Map<string, () => void> {
  if (Array.isArray(node)) {
    for (const child of node) clicks(child, out)
    return out
  }
  if (!isValidElement(node)) return out
  const el = node as ReactElement<Record<string, unknown>>
  if (typeof el.type === 'function') {
    const rendered = (el.type as (p: Record<string, unknown>) => ReactNode)(el.props)
    return clicks(rendered, out)
  }
  const props = el.props
  if (typeof props.onClick === 'function') {
    const key = (props['aria-label'] as string | undefined) ?? textOf(props.children as ReactNode)
    out.set(key, props.onClick as () => void)
  }
  for (const value of Object.values(props)) if (value && typeof value === 'object') clicks(value as ReactNode, out)
  return out
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

beforeEach(() => {
  nav.goBack.mockClear()
  read.refetch.mockClear()
  read.ids.length = 0
  read.state = { data: undefined, isError: false }
})

describe('Ask a question — the phone screen (gap list §4 item 112)', () => {
  it('has its own page bar: the blue back chevron and “Ask a question” as the h1', () => {
    const markup = ask()
    expect(markup).toMatch(/<button[^>]*aria-label="Back"[^>]*class="[^"]*text-accent[^"]*"[^>]*data-page-back/)
    expect(markup).toMatch(/<h1[^>]*>Ask a question<\/h1>/)
    expect(markup).toContain('data-mobile-screen')
  })

  it('says asking is coming, in plain words — desktop’s “coming soon”', () => {
    expect(ASK_START_SIT_COPY.noteTitle).toBe('Asking is coming soon')
    expect(ASK_START_SIT_COPY.noteBody).toBe(
      'Pick the players, ask the community who to start, and see how they vote before kickoff.',
    )
    const markup = ask()
    expect(markup).toContain(`>${ASK_START_SIT_COPY.noteTitle}<`)
    expect(markup).toContain(`>${ASK_START_SIT_COPY.noteBody}<`)
  })

  it('draws no composer: Back is its only control — no Post that can’t post, no fields', () => {
    const markup = ask()
    const controls = [...markup.matchAll(/<button[^>]*?(?:aria-label="([^"]*)"[^>]*)?>([^<]*)</g)].map((m) => m[1] ?? m[2])
    expect(controls).toEqual(['Back'])
    expect(markup).not.toMatch(/<(input|textarea)\b/)
    expect(markup).not.toMatch(/>Post</)
  })

  it('draws in phone tokens only, so phone dark mode follows', () => {
    phoneTokensOnly(ask())
  })

  it('Back goes to where you came from, else My start/sit', () => {
    expect(START_SIT_PARENT).toBe('/app/start-or-sit')
    clicks(MobileAskStartSit()).get('Back')?.()
    expect(nav.goBack).toHaveBeenCalledExactlyOnceWith(START_SIT_PARENT)
  })
})

describe('a question — the phone screen (gap list §4 item 112)', () => {
  it('has its own page bar: the blue back chevron and “Start or sit” as the h1', () => {
    read.state = { data: QUESTION, isError: false }
    const markup = question()
    expect(markup).toMatch(/<button[^>]*aria-label="Back"[^>]*data-page-back/)
    expect(markup).toMatch(/<h1[^>]*>Start or sit<\/h1>/)
    expect(read.ids).toEqual([QUESTION.id])
  })

  it('shows the question in My start/sit’s card: pills, the question, both players’ split and the vote count', () => {
    read.state = { data: QUESTION, isError: false }
    const markup = question()
    expect(markup).toMatch(/<article[^>]*shadow-m-outline/)
    expect(markup).toContain('>Start 1 of 2<')
    expect(markup).toMatch(/Open · closes /)
    expect(markup).toContain('>FLEX spot: who starts this week?<')
    expect(markup).toContain('>Bijan Robinson<')
    expect(markup).toContain('>Jahmyr Gibbs<')
    expect(markup).toContain('>71%<')
    expect(markup).toContain('>29%<')
    expect(markup).toContain('>58 votes · crowd leans B. Robinson<')
  })

  it('opens with who asked: their avatar, @handle (a door to their profile) and when, with the scoring and week on the right', () => {
    read.state = { data: QUESTION, isError: false }
    const markup = question()
    const author = markup.match(/<div[^>]*data-ss-author[^>]*>([\s\S]*?)<\/div><div/)?.[1] ?? ''
    expect(author).toMatch(/<a(?=[^>]*\bhref="\/u\/devpro")(?=[^>]*\bdata-username-link="devpro")[^>]*>@devpro<\/a>/)
    expect(author).toContain('> · 2h<')
    expect(author).toMatch(/>Scout PPR<\/span><span[^>]*> · <\/span><span[^>]*>Week 7<\/span>/)
    // The posting time moved up into the author row — the pills row doesn't repeat it.
    expect(markup.match(/>2h</g) ?? []).toHaveLength(0)
    expect(markup.match(/2h/g)).toHaveLength(1)
  })

  it('says just the week when the scoring can’t be read, and Closed once voting has closed', () => {
    read.state = {
      data: { ...QUESTION, scoringName: null, closesAt: new Date(NOW - HOUR).toISOString() },
      isError: false,
    }
    const markup = question()
    const meta = markup.match(/<span[^>]*data-ss-meta[^>]*>([\s\S]*?)<\/span><\/div>/)?.[1] ?? ''
    expect(meta).toBe('<span class="flex-none">Week 7</span>')
    expect(markup).toContain('>Closed<')
    expect(markup).not.toContain('crowd leans')
  })

  it('a long scoring name cuts off and never pushes the @handle off the card; the week still shows', () => {
    // Scoring names run to 80 characters; a league's is "<league name> Custom".
    const scoringName = 'The Extremely Long Sunday Funday Fantasy Football League Of Champions Custom'
    read.state = { data: { ...QUESTION, scoringName }, isError: false }
    const markup = question()
    const author = markup.match(/<div[^>]*data-ss-author[^>]*>([\s\S]*?)<\/div><div/)?.[1] ?? ''
    // The handle is still there, in a part that may shrink but keeps its share of the row.
    expect(author).toMatch(/<span class="min-w-0 flex-1 truncate[^"]*"><a[^>]*href="\/u\/devpro"[^>]*>@devpro<\/a>/)
    // The right-hand side shrinks (min-w-0) and is capped at half the row …
    const metaTag = author.match(/<span[^>]*data-ss-meta[^>]*>/)?.[0] ?? ''
    expect(metaTag).toMatch(/class="[^"]*\bmin-w-0\b/)
    expect(metaTag).toMatch(/class="[^"]*\bmax-w-\[50%\]/)
    expect(metaTag).not.toMatch(/\bflex-none\b/)
    // … the scoring name is what cuts off, with an ellipsis; the week never does.
    expect(author).toContain(`<span class="min-w-0 truncate">${scoringName}</span>`)
    expect(author).toMatch(/<span class="flex-none">Week 7<\/span><\/span>$/)
  })

  it('offers no vote — the app can’t take one yet — so the card’s only door is the asker’s profile', () => {
    read.state = { data: QUESTION, isError: false }
    const markup = question()
    expect(markup).not.toMatch(/>Vote</)
    const buttons = [...markup.matchAll(/<button\b[^>]*>/g)].map((m) => /aria-label="([^"]*)"/.exec(m[0])?.[1])
    expect(buttons).toEqual(['Back'])
    expect([...markup.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1])).toEqual(['/u/devpro'])
  })

  it('loading is a card-shaped block, not "not here"', () => {
    const markup = question()
    expect(markup).toMatch(/<span[^>]*aria-busy="true"[^>]*aria-label="Loading"[^>]*rounded-\[18px\][^>]*bg-m-b1/)
    expect(markup).not.toContain(START_SIT_QUESTION_COPY.missingTitle)
  })

  it('no question to show (no such id, gone or voided) says so plainly', () => {
    read.state = { data: null, isError: false }
    const markup = question()
    expect(START_SIT_QUESTION_COPY.missingTitle).toBe('This question isn’t here')
    expect(markup).toContain(`>${START_SIT_QUESTION_COPY.missingTitle}<`)
    expect(markup).toContain(`>${START_SIT_QUESTION_COPY.missingBody}<`)
    expect(markup).not.toContain('<article')
  })

  it('a failed read says it couldn’t load, with Try again — never "not here"', () => {
    read.state = { data: undefined, isError: true }
    const markup = question()
    expect(markup).toContain(`>${START_SIT_QUESTION_COPY.error}<`)
    expect(markup).not.toContain(START_SIT_QUESTION_COPY.missingTitle)
    clicks(MobileStartSitQuestion({ questionId: QUESTION.id })).get(START_SIT_QUESTION_COPY.retry)?.()
    expect(read.refetch).toHaveBeenCalledOnce()
  })

  it('a failed refresh keeps the question on screen', () => {
    read.state = { data: QUESTION, isError: true }
    const markup = question()
    expect(markup).toContain('>FLEX spot: who starts this week?<')
    expect(markup).not.toContain(START_SIT_QUESTION_COPY.error)
  })

  it('draws in phone tokens only, so phone dark mode follows', () => {
    read.state = { data: QUESTION, isError: false }
    phoneTokensOnly(question())
    read.state = { data: null, isError: false }
    phoneTokensOnly(question())
  })

  it('Back goes to where you came from, else My start/sit', () => {
    read.state = { data: null, isError: false }
    clicks(MobileStartSitQuestion({ questionId: QUESTION.id })).get('Back')?.()
    expect(nav.goBack).toHaveBeenCalledExactlyOnceWith(START_SIT_PARENT)
  })
})

describe('the routes draw them on the phone (ByLayout); desktop keeps its pages', () => {
  const route = (p: string) => readFileSync(path.join(process.cwd(), 'src/app/app/(shell)/start-or-sit', p), 'utf8')

  it('Ask a question: desktop keeps its placeholder, the phone gets MobileAskStartSit', () => {
    const page = route('new/page.tsx')
    expect(page).toContain('<ByLayout')
    expect(page).toContain('mobile={<MobileAskStartSit />}')
    expect(page).toContain('title="Post a start or sit"')
    expect(page).toContain('description="Coming soon — pick two players, ask the room, and get a verdict before lock."')
  })

  it('a question: desktop keeps its placeholder with the id, the phone gets MobileStartSitQuestion', () => {
    const page = route('[questionId]/page.tsx')
    expect(page).toContain('<ByLayout')
    expect(page).toContain('mobile={<MobileStartSitQuestion questionId={questionId} />}')
    expect(page).toContain('title="Start or sit"')
    expect(page).toContain('description="Coming soon — community votes land here with the start/sit split."')
    expect(page).toContain('Question ID: <span className="fs-num text-[11px]">{questionId}</span>')
  })

  it('both stay behind the Start-or-sit switch (the layout gate)', () => {
    expect(route('layout.tsx')).toContain("if (!featureFlags.startOrSit) redirect('/app')")
  })
})
