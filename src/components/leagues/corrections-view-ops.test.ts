/**
 * corrections-view-ops.test.ts — the copy and the decisions of the
 * corrections view, the matchup change note and the box score's points
 * note (M6 L.E2.4; spec §23.4 / §16.5.2 / §7.3.6; tasks-M6 §6 L.E2.4 read
 * through Q81 / Q86; PROGRESS D456, F475 / F477).
 *
 * The task's ops proof: a member reads "receiving yards", never the stat
 * key; every state's copy is a stored sentence, never an inferred empty.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { StatCorrectionsState } from '@/hooks/use-stat-corrections'
import {
  BOX_NO_GAME_NOTE,
  BOX_NONE_STORED_NOTE,
  BOX_OVERRIDDEN_NOTE,
  BOX_UNRECOVERABLE_NOTE,
} from '@/lib/leagues/api/box-score-copy'
import type { StatCorrectionItem, StatCorrectionsPage } from '@/lib/leagues/api/corrections-service'
import { CORRECTION_LABELS } from '@/lib/leagues/scoring/stat-correction-labels'
import { PRE_158_SENTENCE } from '@/lib/leagues/scoring/player-points-store'

import * as ops from './corrections-view-ops'
import {
  BOX_FINAL_STORED_COPY,
  BOX_NO_GAME_COPY,
  BOX_NONE_STORED_COPY,
  BOX_OVERRIDDEN_COPY,
  BOX_PRE_STORE_COPY,
  BOX_UNRECOVERABLE_COPY,
  CORRECTIONS_EMPTY_FALLBACK_COPY,
  MATCHUP_NOTE_RESULT_TITLE,
  OTHER_RESULTS_LINE,
  TEAM_NOTE_RESULT_TITLE,
  TEAM_NOTE_SCORE_TITLE,
  MATCHUP_NOTE_SCORE_TITLE,
  RESULT_NOT_YET_COPY,
  RESULT_UNCHANGED_COPY,
  STAT_FIX_RULE_COPY,
  boxPointsNote,
  correctionCard,
  correctionWeekOptions,
  correctionsHref,
  correctionsListView,
  matchupCorrectionNote,
  noteReadState,
  noteShouldFetchNextPage,
  statChangeText,
  weekMayHaveCorrections,
} from './corrections-view-ops'

const T1 = 'team-1'
const T2 = 'team-2'
const T3 = 'team-3'

function correctionItem(over: Partial<StatCorrectionItem> = {}): StatCorrectionItem {
  return {
    id: 'c1',
    week: 3,
    recorded_at: '2099-09-24T15:00:00Z',
    player: { id: 'p1', name: 'Lou Receiver', position: 'WR', nfl_team: 'AAA' },
    team: { id: T1, name: 'Team One' },
    matchup_id: 'm1',
    slot: 'wr:0',
    stat_changes: [{ stat_key: 'receiving_yards', stat: 'receiving yards', old: 100, new: 94, words: 'receiving yards 100 → 94' }],
    player_points: { before: 10, after: 9.4 },
    team_score: { before: 101.2, after: 100.6 },
    result: { known: true, changed: false, changes: [] },
    summary: 'Lou Receiver’s receiving yards 100 → 94 — Team One 101.20 → 100.60',
    ...over,
  }
}

function known(over: Partial<StatCorrectionsPage> = {}): StatCorrectionsState {
  return { state: 'known', page: { week: 3, items: [], limit: 50, has_more: false, next_cursor: null, note: null, ...over } }
}

describe('the copy — a member reads words, never a stat key (the task’s ops proof)', () => {
  it('a moved stat is the record’s words, sentence-cased: "Receiving yards 100 → 94"', () => {
    const text = statChangeText({ stat_key: 'receiving_yards', stat: 'receiving yards', old: 100, new: 94, words: '' })
    expect(text).toBe('Receiving yards 100 → 94')
    expect(text).not.toContain('receiving_yards')
  })

  it('a raw key in place of the words is replaced by the registry’s words — never shown', () => {
    expect(statChangeText({ stat_key: 'receiving_yards', stat: 'receiving_yards', old: 100, new: 94, words: '' })).toBe('Receiving yards 100 → 94')
    expect(statChangeText({ stat_key: 'receiving_yards', stat: '  ', old: 100, new: 94, words: '' })).toBe('Receiving yards 100 → 94')
  })

  it('every key a correction can carry reads as words with no underscore', () => {
    expect(CORRECTION_LABELS.size).toBeGreaterThan(0)
    for (const key of CORRECTION_LABELS.keys()) {
      const text = statChangeText({ stat_key: key, stat: key, old: 1, new: 2, words: '' })
      expect(text, key).not.toMatch(/_/)
      expect(text, key).not.toContain(key.includes('_') ? key : '\u0000')
    }
  })

  it('a missing value is a dash, not "null" or 0', () => {
    expect(statChangeText({ stat_key: 'receiving_tds', stat: 'receiving TD', old: null, new: 1, words: '' })).toBe('Receiving TD — → 1')
  })

  it('no exported copy string carries a snake_case key or a code word', () => {
    const strings = Object.entries(ops).filter(([name, v]) => /_COPY$|_TITLE$|_LABEL$/.test(name) && typeof v === 'string') as Array<[string, string]>
    expect(strings.length).toBeGreaterThan(10)
    for (const [name, value] of strings) {
      expect(value, name).not.toMatch(/\b[a-z]+_[a-z_]+\b/)
      expect(value, name).not.toMatch(/week_final|migration|backfill|PGRST|stat_key/i)
    }
  })

  it('Q86: the settings sentence is the ruling’s, word for word', () => {
    expect(STAT_FIX_RULE_COPY.replace(/’/g, "'")).toBe("Stat fixes count until next week's first game")
  })
})

describe('one correction’s card', () => {
  it('names the player, the team, each stat, his points and the team score before → after', () => {
    const card = correctionCard(correctionItem())
    expect(card).toMatchObject({
      playerName: 'Lou Receiver',
      position: 'WR',
      nflTeam: 'AAA',
      teamName: 'Team One',
      teamId: T1,
      week: 3,
      stats: ['Receiving yards 100 → 94'],
      playerPoints: 'His points 10.00 → 9.40',
      teamScore: 'Team score 101.20 → 100.60',
      result: { tone: 'unchanged', lines: [RESULT_UNCHANGED_COPY] },
    })
  })

  it('a pending score (E61) reads "pending", never 0.00', () => {
    const card = correctionCard(correctionItem({ team_score: { before: null, after: 100.6 }, player_points: { before: null, after: 9.4 } }))
    expect(card.teamScore).toBe('Team score pending → 100.60')
    expect(card.playerPoints).toBe('His points pending → 9.40')
  })

  it('a result change is listed in the record’s words; while the games were still on, says so', () => {
    const flipped = correctionCard(
      correctionItem({
        result: {
          known: true,
          changed: true,
          changes: [
            { game: 'matchup', before: 'win', after: 'loss', words: 'Matchup: win → loss' },
            { game: 'median_game', before: 'win', after: 'loss', words: 'Median game: win → loss' },
          ],
        },
      }),
    )
    expect(flipped.result).toEqual({ tone: 'changed', lines: ['Matchup: win → loss', 'Median game: win → loss'] })
    const live = correctionCard(correctionItem({ result: { known: false, changed: false, changes: [] } }))
    expect(live.result).toEqual({ tone: 'not_yet', lines: [RESULT_NOT_YET_COPY] })
  })
})

describe('the list’s state — asserted from the server, never inferred', () => {
  it('pre-push: the named 503 wins over everything, in the server’s sentence', () => {
    expect(correctionsListView([{ state: 'unavailable', reason: 'not yet' }])).toEqual({ kind: 'unavailable', reason: 'not yet' })
  })

  it('an empty week renders the server’s note; the fallback only if the server sent none', () => {
    expect(correctionsListView([known({ note: 'No stat correction changed a score in this league in Week 3.' })])).toEqual({
      kind: 'empty',
      note: 'No stat correction changed a score in this league in Week 3.',
    })
    expect(correctionsListView([known()])).toEqual({ kind: 'empty', note: CORRECTIONS_EMPTY_FALLBACK_COPY })
  })

  it('items across pages, in order; "more" is the LAST page’s has_more', () => {
    const a = correctionItem({ id: 'a' })
    const b = correctionItem({ id: 'b' })
    const view = correctionsListView([known({ items: [a], has_more: true, next_cursor: 'x' }), known({ items: [b] })])
    expect(view).toEqual({ kind: 'items', items: [a, b], hasMore: false })
    expect(correctionsListView([known({ items: [a], has_more: true })])).toMatchObject({ hasMore: true })
  })

  it('the week filter lists "All weeks" then each week once, in order (a linked week always present)', () => {
    expect(correctionWeekOptions([2, 1, 3], null).map((o) => o.label)).toEqual(['All weeks', 'Week 1', 'Week 2', 'Week 3'])
    expect(correctionWeekOptions([], 5).map((o) => o.value)).toEqual(['all', '5'])
  })

  it('the door carries the week', () => {
    expect(correctionsHref('L', null)).toBe('/app/leagues/L/corrections')
    expect(correctionsHref('L', 4)).toBe('/app/leagues/L/corrections?week=4')
  })
})

describe('the matchup page’s change note (§16.5.2)', () => {
  it('only a started week can hold one', () => {
    expect(['live', 'correction_window', 'final'].map(weekMayHaveCorrections)).toEqual([true, true, true])
    expect(['upcoming', null, undefined].map(weekMayHaveCorrections)).toEqual([false, false, false])
  })

  it('nothing when no correction touched this matchup’s teams', () => {
    expect(matchupCorrectionNote([correctionItem({ team: { id: T3, name: 'Three' } })], [T1, T2])).toBeNull()
    expect(matchupCorrectionNote([], [T1, T2])).toBeNull()
  })

  it('a score-only change: the score title and the record’s sentence', () => {
    const note = matchupCorrectionNote([correctionItem(), correctionItem({ id: 'x', team: { id: T3, name: 'Three' } })], [T1, T2])
    expect(note).toEqual({
      resultChanged: false,
      title: MATCHUP_NOTE_SCORE_TITLE,
      lines: [{ id: 'c1', text: 'Lou Receiver’s receiving yards 100 → 94 — Team One 101.20 → 100.60', results: [] }],
      otherResults: [],
    })
  })

  it('a flipped result: the result title and who it moved for', () => {
    const note = matchupCorrectionNote(
      [
        correctionItem({
          team: { id: T2, name: 'Team Two' },
          result: { known: true, changed: true, changes: [{ game: 'matchup', before: 'loss', after: 'win', words: 'Matchup: loss → win' }] },
        }),
      ],
      [T1, T2],
    )
    expect(note?.title).toBe(MATCHUP_NOTE_RESULT_TITLE)
    expect(note?.resultChanged).toBe(true)
    expect(note?.lines[0].results).toEqual(['Team Two — Matchup: loss → win'])
  })

  // R1365 — one cell per game kind: the title claims THIS row's result only when THIS row's game flipped.
  const flip = (game: 'matchup' | 'second_game' | 'median_game', words: string) =>
    correctionItem({ result: { known: true, changed: true, changes: [{ game, before: 'win', after: 'loss', words }] } })

  it('R1365: a MEDIAN-game flip alone is not this matchup’s result — the score title, the flip under the neutral line', () => {
    const note = matchupCorrectionNote([flip('median_game', 'Median game: win → loss')], [T1, T2], 'matchup')
    expect(note?.title).toBe(MATCHUP_NOTE_SCORE_TITLE)
    expect(note?.resultChanged).toBe(false)
    expect(note?.lines[0].results).toEqual([])
    expect(note?.otherResults).toEqual(['Team One — Median game: win → loss'])
    expect(OTHER_RESULTS_LINE).toContain('changed a result this week')
  })

  it('R1365: a SECOND-game flip is the other row’s — on the primary row it is listed apart; on a secondary row it IS the result', () => {
    const onPrimary = matchupCorrectionNote([flip('second_game', 'Second game: win → loss')], [T1, T2], 'matchup')
    expect([onPrimary?.title, onPrimary?.otherResults]).toEqual([MATCHUP_NOTE_SCORE_TITLE, ['Team One — Second game: win → loss']])
    const onSecondary = matchupCorrectionNote([flip('second_game', 'Second game: win → loss')], [T1, T2], 'second_game')
    expect([onSecondary?.title, onSecondary?.lines[0].results, onSecondary?.otherResults]).toEqual([
      MATCHUP_NOTE_RESULT_TITLE,
      ['Team One — Second game: win → loss'],
      [],
    ])
  })

  it('R1365: a MATCHUP flip on the primary row is its result; a median flip beside it stays apart', () => {
    const both = correctionItem({
      result: {
        known: true,
        changed: true,
        changes: [
          { game: 'matchup', before: 'win', after: 'loss', words: 'Matchup: win → loss' },
          { game: 'median_game', before: 'win', after: 'loss', words: 'Median game: win → loss' },
        ],
      },
    })
    const note = matchupCorrectionNote([both], [T1, T2], 'matchup')
    expect([note?.title, note?.lines[0].results, note?.otherResults]).toEqual([
      MATCHUP_NOTE_RESULT_TITLE,
      ['Team One — Matchup: win → loss'],
      ['Team One — Median game: win → loss'],
    ])
  })

  it('R1368: a total_points week speaks of the one team — its score, or its result', () => {
    expect(matchupCorrectionNote([correctionItem()], [T1], 'team')?.title).toBe(TEAM_NOTE_SCORE_TITLE)
    const flipped = matchupCorrectionNote([flip('median_game', 'Median game: win → loss')], [T1], 'team')
    expect([flipped?.title, flipped?.lines[0].results, flipped?.otherResults]).toEqual([TEAM_NOTE_RESULT_TITLE, ['Team One — Median game: win → loss'], []])
  })

  it('a bye side (null id) is ignored, not matched', () => {
    expect(matchupCorrectionNote([correctionItem()], [T1, null])?.lines).toHaveLength(1)
  })
})

describe('R1366 — the note reads every page, and never re-asks for a page that failed', () => {
  const base = { hasData: true, isError: false, isFetchNextPageError: false, hasNextPage: false, isFetchingNextPage: false }

  it('waits for the first page and for every later page; ready once the last is in', () => {
    expect(noteReadState({ ...base, hasData: false })).toBe('wait')
    expect(noteReadState({ ...base, hasNextPage: true })).toBe('wait')
    expect(noteReadState(base)).toBe('ready')
  })

  it('a failed first page OR a failed later page is said — never a partial note, never "none"', () => {
    expect(noteReadState({ ...base, hasData: false, isError: true })).toBe('error')
    expect(noteReadState({ ...base, isError: true, isFetchNextPageError: true, hasNextPage: true })).toBe('error')
  })

  it('asks for the next page only while none is in flight and the last ask did not fail (the 25-calls loop)', () => {
    expect(noteShouldFetchNextPage({ ...base, hasNextPage: true })).toBe(true)
    expect(noteShouldFetchNextPage({ ...base, hasNextPage: true, isFetchingNextPage: true })).toBe(false)
    expect(noteShouldFetchNextPage({ ...base, hasNextPage: true, isError: true, isFetchNextPageError: true })).toBe(false)
    expect(noteShouldFetchNextPage({ ...base, hasNextPage: true, isError: true })).toBe(false)
    expect(noteShouldFetchNextPage({ ...base, hasNextPage: false })).toBe(false)
  })
})

describe('the box score’s points note (F477)', () => {
  it('each server note is said in a member’s words', () => {
    expect(boxPointsNote({ points_source: 'live', stored_note: BOX_NONE_STORED_NOTE }, 'final')).toBe(BOX_NONE_STORED_COPY)
    expect(boxPointsNote({ points_source: 'live', stored_note: BOX_NO_GAME_NOTE }, 'final')).toBe(BOX_NO_GAME_COPY)
    expect(boxPointsNote({ points_source: 'stored', stored_note: BOX_OVERRIDDEN_NOTE }, 'final')).toBe(BOX_OVERRIDDEN_COPY)
    expect(boxPointsNote({ points_source: 'stored', stored_note: BOX_UNRECOVERABLE_NOTE }, 'final')).toBe(BOX_UNRECOVERABLE_COPY)
    expect(boxPointsNote({ points_source: 'live', stored_note: PRE_158_SENTENCE }, 'correction_window')).toBe(BOX_PRE_STORE_COPY)
  })

  it('an unknown note is shown as sent (sentence-cased) — never dropped', () => {
    expect(boxPointsNote({ points_source: 'live', stored_note: 'something new' }, 'final')).toBe('Something new.')
  })

  it('a FINAL week on the stored points says the stat line may have moved since (80 yards beside 12.00)', () => {
    expect(boxPointsNote({ points_source: 'stored', stored_note: null }, 'final')).toBe(BOX_FINAL_STORED_COPY)
    // R1367: "final", never "locked" (a lineup lock is not the week being final); one short line.
    expect(BOX_FINAL_STORED_COPY).toContain('after the week was final')
    expect(BOX_FINAL_STORED_COPY).not.toMatch(/lock/i)
    expect(BOX_FINAL_STORED_COPY.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length).toBe(1)
  })

  it('a live week, and a week still in its window (a fix there re-scores), say nothing', () => {
    expect(boxPointsNote({ points_source: 'live', stored_note: null }, 'live')).toBeNull()
    expect(boxPointsNote({ points_source: 'stored', stored_note: null }, 'correction_window')).toBeNull()
  })
})

describe('Q81 — no final-week state, no would-be number, no commissioner door', () => {
  it('the view and its ops name none of them', () => {
    for (const file of ['corrections-view.tsx', 'corrections-view-ops.ts']) {
      const src = readFileSync(path.join(process.cwd(), 'src/components/leagues', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')
      expect(src, file).not.toMatch(/week_final|would have been|would-be|Apply (the )?fix/i)
      expect(src, file).not.toMatch(/useCommish|is_league_commish|my_role/)
    }
  })
})
