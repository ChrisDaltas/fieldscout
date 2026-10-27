/**
 * auto-pick.render.test.ts — the manager's own "Auto-draft me" switch
 * (spec §8.4; the design's Auto-pick in the Targets panel header). Before
 * this, the route and `useToggleAutodraft` existed but no screen used them,
 * so only the commissioner could put a seat on auto.
 *
 * Pins: who gets the switch (`selfAutoPickControl`), what it says
 * (`autoPickCaption` — the server picks at the DEADLINE, never early, and
 * never bids), that it shows the server's value and the in-flight value
 * while a toggle is pending, and that the Targets panel renders it only
 * when the room hands it a control. Rig: `renderToStaticMarkup` over the
 * REAL `MyQueue` with the queue cache pre-seeded (acting-as.render.test.ts).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { draftQueueKeys } from '@/hooks/use-draft-queue'

import {
  autoPickCaption,
  autoPickShown,
  selfAutoPickControl,
  type AutoPickControl,
  type SelfAutoPickInput,
} from './auto-pick-ops'
import { MyQueue } from './my-queue'

const LEAGUE = 'lg-1'
const DRAFT = 'dr-1'
const ME = 'user-me'
const T1 = 'team-1'
const T4 = 'team-4'

const MEMBERS: SelfAutoPickInput['members'] = [
  { user_id: ME, team_id: T1, is_autodraft: false },
  { user_id: 'user-4', team_id: T4, is_autodraft: true },
  { user_id: null, team_id: 'team-placeholder', is_autodraft: null },
]

function input(over: Partial<SelfAutoPickInput> = {}): SelfAutoPickInput {
  return {
    isMock: false,
    leagueId: LEAGUE,
    myTeamId: T1,
    userId: ME,
    actingForAnother: false,
    members: MEMBERS,
    isAuction: false,
    pickTimerSeconds: 90,
    ...over,
  }
}

function panel(autoPick: AutoPickControl | null): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(draftQueueKeys.queue(DRAFT, T1), [])
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(MyQueue, {
        leagueId: LEAGUE,
        draftId: DRAFT,
        teamId: T1,
        draftedIds: new Set<string>(),
        autoPick,
      }),
    ),
  )
}

describe('who gets the switch', () => {
  it('a seated manager on a real league draft — reading his own seat’s flag', () => {
    expect(selfAutoPickControl(input())).toEqual({
      leagueId: LEAGUE,
      on: false,
      isAuction: false,
      untimed: false,
    })
    // T4's manager sees T4's flag (on), not anyone else's.
    expect(selfAutoPickControl(input({ userId: 'user-4', myTeamId: T4 }))?.on).toBe(true)
  })

  it('nobody in a practice room — mocks never read the flag, and a league mock would flip the real seat', () => {
    expect(selfAutoPickControl(input({ isMock: true }))).toBeNull()
    expect(selfAutoPickControl(input({ isMock: true, leagueId: null }))).toBeNull()
  })

  it('no league, no seat, or signed out: no switch', () => {
    expect(selfAutoPickControl(input({ leagueId: null }))).toBeNull()
    expect(selfAutoPickControl(input({ myTeamId: null }))).toBeNull()
    expect(selfAutoPickControl(input({ userId: null }))).toBeNull()
    // A team id that is not the viewer's own seat row (stale detail).
    expect(selfAutoPickControl(input({ myTeamId: 'team-unknown' }))).toBeNull()
  })

  it('a commissioner looking at ANOTHER team’s Targets does not get his own switch there', () => {
    expect(selfAutoPickControl(input({ actingForAnother: true }))).toBeNull()
  })

  it('untimed only for a snake/linear draft with no pick clock — an auction always has its clocks', () => {
    expect(selfAutoPickControl(input({ pickTimerSeconds: 0 }))?.untimed).toBe(true)
    expect(selfAutoPickControl(input({ pickTimerSeconds: 30 }))?.untimed).toBe(false)
    expect(selfAutoPickControl(input({ pickTimerSeconds: undefined }))?.untimed).toBe(false)
    expect(selfAutoPickControl(input({ isAuction: true, pickTimerSeconds: 0 }))?.untimed).toBe(false)
  })
})

describe('what it says (the server acts at the deadline, never early, never bids)', () => {
  it('snake/linear: drafts from Targets when the clock runs out, without the away wait', () => {
    const line = autoPickCaption({ isAuction: false, untimed: false })
    expect(line).toBe(
      'When your clock runs out, we draft from your Targets first — without waiting for you to come back.',
    )
  })

  it('auction: nominates on the nomination clock, never bids', () => {
    const line = autoPickCaption({ isAuction: true, untimed: false })
    expect(line).toContain('nomination clock runs out')
    expect(line).toContain('We never bid for you.')
  })

  it('no pick clock: says there is nothing to act on', () => {
    expect(autoPickCaption({ isAuction: false, untimed: true })).toContain('no pick clock')
  })

  it('never promises an instant pick the server does not make', () => {
    for (const control of [
      { isAuction: false, untimed: false },
      { isAuction: true, untimed: false },
      { isAuction: false, untimed: true },
    ]) {
      expect(autoPickCaption(control)).not.toMatch(/right away|immediately|as soon as/i)
    }
  })
})

describe('the shown value', () => {
  it('the value being sent while a toggle is in flight, the server’s otherwise', () => {
    expect(autoPickShown(false, undefined)).toBe(false)
    expect(autoPickShown(true, undefined)).toBe(true)
    expect(autoPickShown(false, true)).toBe(true)
    expect(autoPickShown(true, false)).toBe(false)
  })
})

describe('the Targets panel', () => {
  const control: AutoPickControl = { leagueId: LEAGUE, on: false, isAuction: false, untimed: false }

  it('renders a labelled Auto-pick switch with its caption when handed a control', () => {
    const html = panel(control)
    expect(html).toContain('>Auto-pick</label>')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('without waiting for you to come back')
  })

  it('reflects the seat’s flag when it is on', () => {
    expect(panel({ ...control, on: true })).toContain('aria-checked="true"')
  })

  it('shows no switch without a control — the panel as before', () => {
    const html = panel(null)
    expect(html).not.toContain('Auto-pick')
    expect(html).not.toContain('role="switch"')
    expect(html).toContain('My Targets')
  })
})

describe('the wiring (source pins — the write is the shipped self route, nothing client-side picks)', () => {
  const read = (file: string) => readFileSync(join(__dirname, file), 'utf8')

  it('the panel writes through useToggleAutodraft (POST …/draft/autodraft) and nothing else', () => {
    const src = read('my-queue.tsx')
    expect(src).toContain("import { useToggleAutodraft } from '@/hooks/use-draft'")
    expect(src).not.toMatch(/useMakePick|makePick|useNominate/)
  })

  it('the room hands the panel its control from selfAutoPickControl', () => {
    const src = read('draft-room.tsx')
    expect(src).toContain('selfAutoPickControl({')
    expect(src).toContain('autoPick={autoPick}')
  })
})
