/**
 * Home's Join league, Create league and Mock draft pop-ups on the phone
 * (gap list §4 item 2): the SAME three dialogs (`JoinLeagueDialog`,
 * `LeagueCreateModal`, `MockLaunchDialog`) with `layout="mobile"` draw as
 * FieldScout Mobile bottom sheets, and the shared settings controls inside
 * them take the phone language through `SettingsSkin` — `m-*` tokens only,
 * so the sheets follow the phone's dark mode instead of staying light.
 *
 * Rendered statically over seeded query caches (effects don't run). The
 * Radix sheet portals on the client only, so `MobileSheet` renders in place
 * here — its title, subtitle, body and footer.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app',
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ from: () => ({}) }),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, profile: { username: 'dev' } }),
}))
// The mock dialog's opening draft, swappable per describe (a static render
// can't click through steps, so a problem is seeded into the opening draft).
const launchSeed = vi.hoisted(() => ({ draft: null as null | (() => MockLaunchDraft) }))
vi.mock('@/components/draft/mock-launch-ops', async (importActual) => {
  const actual = await importActual<typeof import('@/components/draft/mock-launch-ops')>()
  return { ...actual, initialMockLaunchDraft: () => (launchSeed.draft ?? actual.initialMockLaunchDraft)() }
})
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({
    open,
    title,
    subtitle,
    children,
    footer,
    size,
  }: {
    open: boolean
    title: string
    subtitle?: string
    children: ReactNode
    footer?: ReactNode
    size?: string
  }) =>
    open
      ? createElement(
          'section',
          { 'data-sheet': title, 'data-size': size ?? 'fit' },
          createElement('h2', null, title),
          subtitle ? createElement('p', { 'data-subtitle': '' }, subtitle) : null,
          createElement('div', { 'data-body': '' }, children),
          footer ? createElement('footer', null, footer) : null,
        )
      : null,
}))

import { MockLaunchDialog } from '@/components/draft/mock-launch-dialog'
import { initialMockLaunchDraft, patchMockSettings, type MockLaunchDraft } from '@/components/draft/mock-launch-ops'
import { AttachListInline } from '@/components/leagues/attach-list-modal'
import { AuctionConfigFields, PickClockField, SnakeReversalField } from '@/components/leagues/draft-config-fields'
import { LeagueCreateModal } from '@/components/leagues/league-create-modal'
import { JoinLeagueDialog } from '@/components/leagues/leagues-index'
import { RosterSlotBuilder } from '@/components/leagues/roster-slot-builder'
import { ScoringTemplatePicker } from '@/components/leagues/scoring-template-picker'
import type { ScoringTemplateRow } from '@/components/leagues/scoring-template-picker-ops'
import { InlineIssue, SettingsSkin } from '@/components/leagues/settings-form-controls'
import { leagueListsKeys, type MyDraftList } from '@/hooks/use-league-lists'
import { scoringTemplatesKeys } from '@/hooks/use-scoring-templates'
import { SCORING_TEMPLATES } from '@/lib/leagues/scoring/templates'
import { DEFAULT_ROSTER_SETTINGS, LEAGUE_SETTINGS_DEFAULTS, type LeagueSettings } from '@/lib/leagues/settings/league-settings'

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const TEMPLATE_ROWS: ScoringTemplateRow[] = SCORING_TEMPLATES.map((t, i) => ({
  id: `row-${i + 1}`,
  name: t.name,
  description: t.description,
  rules: t.rules,
}))

const MY_LISTS: MyDraftList[] = [
  {
    id: 'list-bb',
    title: 'My Big Board',
    position_filter: null,
    player_count: 300,
    is_private: false,
    is_big_board: true,
    ranking_mode: null,
    scoring_system_id: null,
    updated_at: null,
  },
  {
    id: 'list-rb',
    title: 'RB sleepers',
    position_filter: 'RB',
    player_count: 12,
    is_private: true,
    is_big_board: false,
    ranking_mode: null,
    scoring_system_id: null,
    updated_at: null,
  },
]

function render(node: ReactElement): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(scoringTemplatesKeys.all, TEMPLATE_ROWS)
  client.setQueryData(leagueListsKeys.myLists('user-1'), MY_LISTS)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, node))
}

const phone = (node: ReactElement) => render(createElement(() => SettingsSkin({ layout: 'mobile', children: node })))

/**
 * Desktop-only colour classes — the v7 tokens that stay light in the phone's
 * dark mode. None may reach a phone sheet.
 */
const DESKTOP_TOKENS =
  /(?<![\w-])(?:bg-white|text-ink|border-n-4|border-ink|bg-surface-[a-z-]+|text-n-\d|bg-n-\d|bg-accent-soft|text-accent-deep|bg-negative-soft|bg-caution-soft|shadow-hard-\d+)(?![\w-])/

const noop = () => undefined

// ---------------------------------------------------------------------------
// The three sheets
// ---------------------------------------------------------------------------

describe('Join a league — a phone sheet (gap list §4 item 2)', () => {
  // Its props are optional (the desktop trigger form), so render it through a
  // wrapper rather than fight createElement's overloads.
  const html = render(createElement(() => JoinLeagueDialog({ open: true, onOpenChange: noop, layout: 'mobile' })))

  it('is the mobile sheet with the 48px phone field and the wizard’s Continue', () => {
    expect(html).toContain('data-sheet="Join a league"')
    expect(html).toMatch(/<input id="[^"]+-code"[^>]*class="h-12 w-full rounded-\[12px\][^"]*bg-m-b2[^"]*text-\[16px\]/)
    expect(html).toContain('placeholder="e.g. a1b2c3d4e5"')
  })

  it('submits the form from the footer; Continue is off until there is a code (prevent, don’t refuse)', () => {
    const form = html.match(/<form id="([^"]+)"/)?.[1]
    expect(form).toBeTruthy()
    expect(html).toContain(`type="submit" form="${form}" disabled=""`)
    expect(html).toMatch(/data-wizard-primary="true">Continue</)
  })

  it('draws in phone tokens only — it follows dark mode', () => {
    expect(html).not.toMatch(DESKTOP_TOKENS)
  })
})

describe('Create a league — a phone sheet, step 1 (Basics)', () => {
  const html = render(createElement(LeagueCreateModal, { open: true, onOpenChange: noop, layout: 'mobile' }))

  it('is the tall mobile sheet with the step line and the wizard progress track', () => {
    expect(html).toContain('data-sheet="Create a league" data-size="tall"')
    expect(html).toContain('Step 1 of 3 · Basics')
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuemax="3" aria-valuenow="1"/)
  })

  it('asks for the name in the phone field and the league size as choice chips (12 chosen)', () => {
    expect(html).toMatch(/<input id="create-league-name"[^>]*class="h-12 w-full[^"]*bg-m-b2/)
    const chips = [...html.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>(\d+)<\/button>/g)].map((m) => [m[2], m[1]])
    expect(chips).toEqual([
      ['8', 'false'],
      ['10', 'false'],
      ['12', 'true'],
      ['14', 'false'],
      ['16', 'false'],
    ])
    expect(html).toContain('Upload photo')
  })

  it('step 1 has Continue and no Back; creating is free (no Pro wording)', () => {
    expect(html).toMatch(/data-wizard-primary="true">Continue</)
    expect(html).not.toContain('>Back<')
    expect(html).not.toMatch(/\bPro\b/)
  })

  it('Continue is off until the league has a name, and says why (prevent, don’t refuse)', () => {
    expect(html).toMatch(/<button type="button" disabled=""[^>]*data-wizard-primary="true">Continue</)
    expect(html).toMatch(/role="status">Name your league to continue\.</)
  })

  it('draws in phone tokens only', () => {
    expect(html).not.toMatch(DESKTOP_TOKENS)
  })
})

describe('Mock draft — a phone sheet, step 1 (Format)', () => {
  const html = render(createElement(MockLaunchDialog, { open: true, onOpenChange: noop, onLaunched: noop, layout: 'mobile' }))

  it('is the tall mobile sheet with the step line', () => {
    expect(html).toContain('data-sheet="Mock draft" data-size="tall"')
    expect(html).toContain('Step 1 of 4 · Format')
  })

  it('a clean draft’s Continue is on, with no reason line', () => {
    expect(html).toMatch(/<button type="button"(?![^>]*disabled)[^>]*data-wizard-primary="true">Continue</)
    expect(html).not.toContain('role="status"')
  })

  it('draft type is three radio cards, Snake chosen', () => {
    const cards = [...html.matchAll(/role="radio" aria-checked="(true|false)"[^>]*>(?:(?!<\/button>)[\s\S])*?>(Snake|Auction|Linear)</g)].map((m) => [m[2], m[1]])
    expect(cards).toEqual([
      ['Snake', 'true'],
      ['Auction', 'false'],
      ['Linear', 'false'],
    ])
  })

  it('the draft slot is the phone’s own picker (a native select, Random first)', () => {
    expect(html).toMatch(/<select id="mock-slot" aria-label="Draft slot"[^>]*data-m-select="true">/)
    expect(html).toMatch(/<select id="mock-slot"[^>]*>(?:(?!<\/select>)[\s\S])*Random/)
  })

  it('CPU speed is the phone segmented control', () => {
    expect(html).toMatch(/role="group" aria-label="CPU speed"/)
    expect(html).toMatch(/aria-pressed="true"[^>]*>Realistic</)
  })

  it('draws in phone tokens only', () => {
    expect(html).not.toMatch(DESKTOP_TOKENS)
  })
})

describe('Mock draft — a settings problem holds the step that owns it (prevent, don’t refuse)', () => {
  const renderWith = (seed: () => MockLaunchDraft) => {
    const draft = seed() // built from the real opening draft, before the swap
    launchSeed.draft = () => draft
    try {
      return render(createElement(MockLaunchDialog, { open: true, onOpenChange: noop, onLaunched: noop, layout: 'mobile' }))
    } finally {
      launchSeed.draft = null
    }
  }

  it('a Format problem (a team count off the catalog) holds Continue on Format, with the contract’s message', () => {
    const html = renderWith(() => {
      const d = initialMockLaunchDraft()
      return { ...d, settings: { ...d.settings, team_count: 9 as unknown as LeagueSettings['team_count'] } }
    })
    expect(html).toMatch(/<button type="button" disabled=""[^>]*data-wizard-primary="true">Continue</)
    expect(html).toMatch(/role="status">Team count must be one of/)
  })

  it('a Roster problem doesn’t hold Format — it waits for the step whose controls fix it', () => {
    const html = renderWith(() =>
      patchMockSettings(initialMockLaunchDraft(), {
        roster_settings: { ...DEFAULT_ROSTER_SETTINGS, starting_slots: [] },
      }),
    )
    expect(html).toMatch(/<button type="button"(?![^>]*disabled)[^>]*data-wizard-primary="true">Continue</)
    expect(html).not.toContain('Starting lineup must total')
  })
})

// ---------------------------------------------------------------------------
// The shared controls, phone skin (one set of controls, two skins)
// ---------------------------------------------------------------------------

describe('the shared draft fields in the phone skin', () => {
  const value = LEAGUE_SETTINGS_DEFAULTS.draft
  const snake = phone(
    createElement('div', null, [
      createElement(PickClockField, { key: 'p', value, onChange: noop, idPrefix: 'mock' }),
      createElement(SnakeReversalField, { key: 's', value, onChange: noop, idPrefix: 'mock' }),
    ]),
  )
  const auction = phone(createElement(AuctionConfigFields, { value, onChange: noop, idPrefix: 'mock' }))

  it('the pick clock is a native select offering the whole catalog (R506)', () => {
    expect(snake).toMatch(/<select id="mock-pick-timer"/)
    const options = snake.match(/<select id="mock-pick-timer"[\s\S]*?<\/select>/)?.[0].match(/<option /g) ?? []
    expect(options).toHaveLength(13)
  })

  it('a toggle is a real switch the label points at', () => {
    expect(snake).toMatch(/<label for="mock-snake-reversal"/)
    expect(snake).toMatch(/<button id="mock-snake-reversal" type="button" role="switch" aria-checked="false"/)
  })

  it('the auction numbers keep their ids and open the number keypad', () => {
    for (const id of ['auction-budget', 'auction-nom', 'auction-bid', 'auction-anti-snipe']) {
      expect(auction).toMatch(new RegExp(`<input id="mock-${id}"[^>]*inputMode="numeric"|<input[^>]*id="mock-${id}"[^>]*inputmode="numeric"`, 'i'))
    }
  })

  it('draws in phone tokens only', () => {
    expect(snake).not.toMatch(DESKTOP_TOKENS)
    expect(auction).not.toMatch(DESKTOP_TOKENS)
  })

  it('outside a phone sheet the same fields stay desktop (the default skin)', () => {
    const desktop = render(createElement(PickClockField, { value, onChange: noop, idPrefix: 'set' }))
    expect(desktop).toContain('role="combobox"')
    expect(desktop).not.toContain('data-m-select')
    expect(desktop).not.toContain('bg-m-')
  })
})

describe('the roster builder in the phone skin', () => {
  const html = phone(createElement(RosterSlotBuilder, { value: LEAGUE_SETTINGS_DEFAULTS.roster_settings, onChange: noop }))

  it('keeps every control — steppers, flex, Hot Swap, bench, IR — with the same labels', () => {
    expect(html).toContain('roster spots')
    expect(html).toContain('aria-label="More: QB starters"')
    expect(html).toContain('aria-label="Fewer: Bench spots"')
    expect(html).toContain('Add Custom Flex')
    expect(html).toMatch(/id="hot-swap-toggle" type="button" role="switch"/)
    expect(html).toContain('Add IR spot')
    expect(html).toContain('Add DL spot')
  })

  it('controls inside the b1 IR card sit on the page colour, so they still read in light mode', () => {
    // b2 on b1 all but vanishes in light mode (242 on 245): the IR type
    // picker and the off designation chips take b0, like the steppers.
    expect(html).toMatch(/<select aria-label="IR spot type"[^>]*class="[^"]*bg-m-b0/)
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*class="[^"]*bg-m-b0[^"]*"[^>]*>Doubtful</)
  })

  it('draws in phone tokens only', () => {
    expect(html).not.toMatch(DESKTOP_TOKENS)
  })

  it('desktop is untouched without the skin', () => {
    const desktop = render(createElement(RosterSlotBuilder, { value: LEAGUE_SETTINGS_DEFAULTS.roster_settings, onChange: noop }))
    expect(desktop).toContain('bg-surface-sunken')
    expect(desktop).not.toContain('bg-m-')
  })
})

describe('the scoring template picker in the phone skin', () => {
  const scout = TEMPLATE_ROWS.find((r) => r.name === 'Scout Standard')!
  const html = phone(createElement(ScoringTemplatePicker, { value: scout.id, onChange: noop }))

  it('one radio-card per template, and only the chosen one pressed', () => {
    expect((html.match(/data-template-card="/g) ?? []).length).toBe(TEMPLATE_ROWS.length)
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1)
    expect(html).toMatch(new RegExp(`aria-pressed="true"[^>]*data-template-card="${scout.id}"`))
  })

  it('marks FieldScout’s default and offers Compare', () => {
    expect(html).toContain('FieldScout&#x27;s default')
    expect(html).toMatch(/aria-expanded="false"[^>]*>Compare</)
  })

  it('carries no Customize on the league-less mounts (D170) and draws in phone tokens only', () => {
    expect(html).not.toContain('Customize')
    expect(html).not.toMatch(DESKTOP_TOKENS)
  })
})

describe('the create-flow attach offer in the phone skin', () => {
  const html = phone(
    createElement(AttachListInline, {
      leagueId: 'league-1',
      leagueName: 'Practice Squad League',
      scoringSystemId: null,
      attachedListIds: new Set<string>(),
    }),
  )

  it('the suggestion strip, your lists as tick rows, the two tick toggles and Attach list', () => {
    expect(html).toContain('Your Big Board fits any draft.')
    expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>(?:(?!<\/button>)[\s\S])*My Big Board/)
    expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>(?:(?!<\/button>)[\s\S])*RB sleepers/)
    expect(html).toMatch(/role="checkbox" aria-checked="true"[^>]*>(?:(?!<\/button>)[\s\S])*Set as my primary board/)
    expect(html).toMatch(/role="checkbox" aria-checked="false"[^>]*>(?:(?!<\/button>)[\s\S])*Share with the league/)
    expect(html).toMatch(/disabled=""[^>]*>Attach list</)
  })

  it('draws in phone tokens only', () => {
    expect(html).not.toMatch(DESKTOP_TOKENS)
  })
})

describe('one phone attach body — the League tab’s “Add a draft list” sheet draws it too', () => {
  const framed = phone(
    createElement(AttachListInline, {
      leagueId: 'league-1',
      leagueName: 'Sunday Funday League',
      scoringSystemId: null,
      attachedListIds: new Set<string>(),
      frame: ({ body, attach }) =>
        createElement('section', null, createElement('div', { 'data-body': '' }, body), attach ? createElement('footer', null, attach) : null),
    }),
  )
  const bodyOf = (html: string) => html.match(/<div data-body="">([\s\S]*)<\/div>(?:<footer>|<\/section>)/)?.[1] ?? ''
  const footerOf = (html: string) => html.match(/<footer>([\s\S]*)<\/footer>/)?.[1] ?? ''

  it('framed, the body keeps the strip, rows and toggles, and the Attach button moves to the footer', () => {
    expect(bodyOf(framed)).toContain('Your Big Board fits any draft.')
    expect(bodyOf(framed)).toContain('Set as my primary board')
    expect(bodyOf(framed)).not.toContain('>Attach list<')
    // The wizard footer's button, off until a list is ticked — the same off
    // state as the inline pill (grey, not faded).
    expect(footerOf(framed)).toMatch(/<button type="button" disabled=""[^>]*bg-m-b3s text-m-t3"[^>]*data-wizard-primary="true">Attach list</)
  })

  it('framed while your lists load, there is no button to hand over yet', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(() =>
          SettingsSkin({
            layout: 'mobile',
            children: createElement(AttachListInline, {
              leagueId: 'league-1',
              leagueName: 'Sunday Funday League',
              scoringSystemId: null,
              attachedListIds: new Set<string>(),
              frame: ({ body, attach }) => createElement('section', null, body, attach ? createElement('footer', null, attach) : null),
            }),
          }),
        ),
      ),
    )
    expect(html).toContain('aria-label="Loading your lists"')
    expect(html).not.toContain('<footer>')
  })

  it('the League tab sheet draws AttachListInline rather than a second copy of it', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/components/mobile/league/league/preseason-parts.tsx'), 'utf8')
    expect(src).toMatch(/<SettingsSkin layout="mobile">\s*<AttachListInline/)
    expect(src).toContain('frame={')
    expect(src).not.toContain('Your Big Board fits any draft.')
    expect(src).not.toContain('Set as my primary board')
    expect(src).not.toMatch(/useAttachList\b|attachSuggestion|attachCandidates/)
  })
})

describe('system messages in the phone skin (CLAUDE.md, 2026-10-18)', () => {
  it('an error is a rounded rectangle on the soft tint, never a pill or a bright-red fill', () => {
    const html = phone(createElement(InlineIssue, { tone: 'error', message: 'Nope.' }))
    expect(html).toMatch(/role="alert" class="rounded-message[^"]*bg-m-gr text-m-tr"/)
    expect(html).not.toMatch(/rounded-(?:pill|full)|bg-negative-strong/)
  })
})

// ---------------------------------------------------------------------------
// Mounts: the phone's Home asks for the sheets; desktop mounts don't
// ---------------------------------------------------------------------------

describe('who asks for the phone sheets', () => {
  const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), 'utf8')

  it('the phone’s Home opens all three as phone sheets', () => {
    const matchups = read('src/components/mobile/home/home-matchups.tsx')
    expect(matchups).toMatch(/<JoinLeagueDialog [^>]*layout="mobile"/)
    expect(matchups).toMatch(/<LeagueCreateModal [^>]*layout="mobile"/)
    expect(read('src/components/mobile/home/home-practice.tsx')).toMatch(/<MockLaunchDialog\s+layout="mobile"/)
  })

  it('desktop mounts keep the dialogs (no layout prop)', () => {
    for (const rel of [
      'src/components/home/home-quick-actions.tsx',
      'src/components/home/your-leagues.tsx',
      'src/components/leagues/leagues-index.tsx',
      'src/components/draft/mocks-home.tsx',
    ]) {
      const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '')
      expect(src, rel).not.toMatch(/<(?:JoinLeagueDialog|LeagueCreateModal|MockLaunchDialog)\b[^>]*layout=/)
    }
  })
})
