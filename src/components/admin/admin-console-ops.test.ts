import { describe, expect, it } from 'vitest'

import {
  attentionCount,
  canPause,
  emptyNoticeDraft,
  gameBeforeAfter,
  gameStatusChoices,
  heldWeeks,
  jobBeforeAfter,
  jobKnobState,
  leagueIdFromInput,
  markedGames,
  noOpWords,
  noticeLinkOk,
  noticePreviewItem,
  noticeProblem,
  noticeRequest,
  parseNoticeDraft,
  receiptDetail,
  stalledJobs,
  type OpGame,
  type OpPause,
  type OpPlatformState,
} from './admin-console-ops'

const ACTION = '0b6c2f5e-8f1a-4c1e-9d55-3a1c0e2b7d10'
const LEAGUE = '5f0e8f43-0e7b-4a4c-a0f2-6f4a8a1f2c33'

const game = (over: Partial<OpGame>): OpGame => ({
  game_id: 'g', matchup: 'KC @ BUF', kickoff_at: '2026-10-11T17:00:00Z', status: 'scheduled',
  operator_hold: null, holds_week: false, reason: 'Not started yet', season: 2026, week: 6, ...over,
})
const pause = (over: Partial<OpPause>): OpPause => ({
  id: 'p', job: 'waivers', league_id: null, paused_at: '2026-10-10T00:00:00Z', skipped_runs: 0, summary: 'Waivers paused', ...over,
})

describe('needs attention', () => {
  it('groups holding games by week, and lists marks / stalled jobs', () => {
    const state = {
      games: [
        game({ game_id: 'a', holds_week: true, week: 6 }),
        game({ game_id: 'b', holds_week: true, week: 6, matchup: 'NE @ NYJ' }),
        game({ game_id: 'c', holds_week: false, operator_hold: 'cancelled', week: 5 }),
      ],
      pauses: [pause({})],
      cron: [
        { job: 'waivers', schedule: '*', active: true, last_started_at: null, last_status: 'failed', last_message: 'x', summary: '' },
        { job: 'sync', schedule: '*', active: false, last_started_at: null, last_status: 'succeeded', last_message: null, summary: '' },
        { job: 'ok', schedule: '*', active: true, last_started_at: null, last_status: 'succeeded', last_message: null, summary: '' },
      ],
    } as unknown as OpPlatformState
    expect(heldWeeks(state)).toEqual([{ season: 2026, week: 6, games: [state.games[0], state.games[1]] }])
    expect(markedGames(state).map((g) => g.game_id)).toEqual(['c'])
    expect(stalledJobs(state.cron).map((c) => c.job)).toEqual(['waivers', 'sync'])
    expect(attentionCount(state)).toBe(1 + 1 + 2 + 1)
  })
})

describe('job knobs (Q98)', () => {
  it('lineup locking can never be paused', () => {
    expect(canPause('lineup-lock')).toBe(false)
    expect(canPause('waivers')).toBe(true)
  })

  it('a league sees its own pause and the every-league one separately', () => {
    const ps = [pause({ id: 'all', league_id: null }), pause({ id: 'mine', league_id: LEAGUE })]
    expect(jobKnobState('waivers', ps, LEAGUE)).toEqual({ pausedHere: ps[1], pausedEverywhere: ps[0] })
    expect(jobKnobState('waivers', ps, null)).toEqual({ pausedHere: ps[0], pausedEverywhere: null })
    expect(jobKnobState('week-advance', ps, LEAGUE)).toEqual({ pausedHere: null, pausedEverywhere: null })
  })

  it('before / after in plain words', () => {
    expect(jobBeforeAfter('waivers', 'pause', LEAGUE)).toEqual({
      before: 'Waivers run on schedule for this league.',
      after: 'Waivers are paused for this league until you resume them. Pending claims keep their order.',
    })
    expect(jobBeforeAfter('week-finalize', 'resume', null).after).toBe(
      'Week finalize runs again for every league. Anything that waited happens at the next run.',
    )
    expect(jobBeforeAfter('lineup-lock', 'run_now', LEAGUE).after).toMatch(/runs now for this league/)
  })
})

describe('game marks (Q100)', () => {
  it('offers every mark but the current one, and none for a final game', () => {
    expect(gameStatusChoices(game({}))).toEqual(['in_week', 'out_of_week', 'cancelled'])
    expect(gameStatusChoices(game({ operator_hold: 'cancelled' }))).toEqual(['in_week', 'out_of_week', 'normal'])
    expect(gameStatusChoices(game({ status: 'final' }))).toEqual([])
  })

  it('before / after', () => {
    expect(gameBeforeAfter({ operator_hold: null }, 'cancelled')).toEqual({
      before: 'Not marked. The game follows the normal schedule.',
      after: 'Cancelled. Its players score 0 and the week can close.',
    })
    expect(gameBeforeAfter({ operator_hold: 'in_week' }, 'normal').before).toBe('Moved later this week. The week waits for this game.')
  })
})

describe('plain words', () => {
  it('a no-op’s why loses its code', () => {
    expect(noOpWords('already_paused — this pause is already on; nothing was written')).toBe(
      'This pause is already on; nothing was written.',
    )
    expect(noOpWords(undefined)).toBe('Nothing changed.')
  })

  it('receipt detail', () => {
    expect(receiptDetail({ verb: 'send_notification', after: { title: 'Hi', recipients: 3 } })).toBe('“Hi” to 3 people')
    expect(receiptDetail({ verb: 'set_game_status', after: { game_id: 'g1', operator_hold: null } })).toBe('g1: Back to normal')
    expect(receiptDetail({ verb: 'set_game_status', after: { game_id: 'g1', operator_hold: 'out_of_week' } })).toBe('g1: Moved out of the week')
    expect(receiptDetail({ verb: 'pause_job', after: { job: 'waivers' } })).toBe('Waivers')
  })

  it('a pasted league link or id', () => {
    expect(leagueIdFromInput(`https://fieldscout.gg/app/leagues/${LEAGUE.toUpperCase()}/matchup`)).toBe(LEAGUE)
    expect(leagueIdFromInput('Sunday Funday')).toBeNull()
  })
})

describe('the notice draft (185)', () => {
  it('validates title, link and league', () => {
    const d = emptyNoticeDraft(ACTION)
    expect(noticeProblem(d)).toBe('Add a title.')
    expect(noticeProblem({ ...d, title: 'Hi' })).toBeNull()
    expect(noticeProblem({ ...d, title: 'Hi', link: 'https://evil.example' })).toMatch(/inside FieldScout/)
    expect(noticeProblem({ ...d, title: 'Hi', audience: 'league' })).toBe('Pick the league.')
    expect(noticeLinkOk('/app/leagues')).toBe(true)
    expect(noticeLinkOk('//evil.example')).toBe(false)
    expect(noticeLinkOk('')).toBe(true)
  })

  it('the request carries the compose’s action id and drops blanks', () => {
    const d = { ...emptyNoticeDraft(ACTION), title: ' Hi ', body: ' ', audience: 'league' as const, leagueId: LEAGUE }
    expect(noticeRequest(d)).toEqual({
      audience: 'league', league_id: LEAGUE, title: 'Hi', body: undefined, link: undefined, channels: ['in_app'], action_id: ACTION,
    })
    expect(noticeRequest({ ...d, audience: 'all_users' }).league_id).toBeUndefined()
  })

  it('the preview is the row a recipient gets', () => {
    const p = noticePreviewItem({ ...emptyNoticeDraft(ACTION), title: 'Hi', audience: 'league', leagueId: LEAGUE, link: '/app' }, 'now')
    expect(p).toMatchObject({ type: 'operator_notice', title: 'Hi', body: null, data: { from: 'fieldscout', league_id: LEAGUE, link: '/app' } })
  })

  it('a stored draft round-trips; junk is dropped', () => {
    const d = { ...emptyNoticeDraft(ACTION), title: 'Hi' }
    expect(parseNoticeDraft(JSON.stringify(d))).toEqual(d)
    expect(parseNoticeDraft('{"audience":"everyone"}')).toBeNull()
    expect(parseNoticeDraft('not json')).toBeNull()
    expect(parseNoticeDraft(null)).toBeNull()
  })
})
