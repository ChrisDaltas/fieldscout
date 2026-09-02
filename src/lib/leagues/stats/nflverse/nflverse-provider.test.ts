/**
 * nflverse-provider.test.ts — L.D3.1's unit half, entirely over the two
 * RECORDED fixtures in `__fixtures__/` (source URLs + fetch date in their
 * `#` header lines and README). Zero network: `fetchText` is injected.
 *
 * Pins (stored literals, hand-derived from the fixture rows — the adapter
 * is measured against them, never the other way round):
 *   - Eastern → UTC: EDT (−4) in September, the fall-back INSIDE NFL week 8
 *     (Thu 2026-10-29 EDT → Sun 2026-11-01 EST), the 09:30 ET Madrid game,
 *     a January week-18 instant, and the D146 one-unit pair around the
 *     02:00 transition (01:59 EDT / 03:00 EST). The task's break probe —
 *     mangling this conversion — reds these literals.
 *   - team vocabulary: nflverse `LA` → house `LAR`; an unknown code refuses.
 *   - regular season ONLY; a season the file lacks refuses loud; a renamed
 *     column refuses loud; a ragged row refuses loud.
 *   - status: final iff a result is posted; the emitted set is exactly
 *     {scheduled, final} (never live/postponed — the T+1 honesty rule).
 *   - deterministic `nfl_games` rows (`toGameRow` literals) + idempotency
 *     (the same fixture twice ⇒ zero changes) + the E42 kickoff move as a
 *     one-row diff.
 *   - official inactives from `status = 'INA'` rows keyed by `sleeper_id`,
 *     grouped onto the week's game, OL/DL rows without an id counted and
 *     dropped, `publishedAt` = the injected instant (D16), bye/absent-game
 *     teams counted and named.
 *   - the composite: live status merged by rank, stats/injuries delegated,
 *     inactives from nflverse, name `<base>+nflverse`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { diffGames, toGameRow, type GameRow } from '@/lib/sync/ingest-week'

import type { StatTier } from '../stat-keys'
import type { ProviderGame, StatsProvider } from '../stats-provider'
import { parseCsv, requireColumns } from './csv'
import { easternOffsetMinutesAt, easternToUtc } from './eastern-time'
import {
  fetchTextViaHttp,
  GAMES_REQUIRED_COLUMNS,
  mapNflverseGameStatus,
  mapNflverseTeam,
  mergeGameStatus,
  NflverseProvider,
  NFLVERSE_URLS,
  parseGamesCsv,
  parseWeeklyRosterCsv,
  withNflverseCalendar,
} from './nflverse-provider'

const FIXTURES = resolve(__dirname, '__fixtures__')
const GAMES_CSV = readFileSync(resolve(FIXTURES, 'games-trimmed.csv'), 'utf8')
const ROSTER_CSV = readFileSync(resolve(FIXTURES, 'roster-weekly-2025-wk01-trimmed.csv'), 'utf8')

const OBSERVED = new Date('2026-09-02T12:00:00.000Z')
const time = { now: () => OBSERVED }

function fixtureProvider(overrides: { games?: string; roster?: string } = {}): NflverseProvider {
  return new NflverseProvider(time, {
    fetchText: async (url) => {
      if (url === NFLVERSE_URLS.games) return overrides.games ?? GAMES_CSV
      if (url === NFLVERSE_URLS.weeklyRosters(2025)) return overrides.roster ?? ROSTER_CSV
      throw new Error(`unexpected fetch in test: ${url}`)
    },
  })
}

/** Edit one game row in the fixture text (the columns are positional). */
function editGameRow(csv: string, gameId: string, edit: (fields: string[]) => void): string {
  const lines = csv.split('\n')
  const idx = lines.findIndex((l) => l.startsWith(`${gameId},`))
  if (idx === -1) throw new Error(`fixture has no row ${gameId}`)
  const fields = lines[idx].split(',')
  edit(fields)
  lines[idx] = fields.join(',')
  return lines.join('\n')
}

const GAMES_HEADER_IDX = { gameday: 4, gametime: 6, away_score: 8, home_score: 10, result: 12 } as const

describe('csv (RFC-4180, strict)', () => {
  it('honours quoted commas, doubled quotes, CRLF and provenance comments', () => {
    const text = '# source: x, y\r\n# fetched: z\r\na,b,c\r\n1,"two, with comma","say ""hi"""\r\n4,5,6\r\n'
    const table = parseCsv(text)
    expect(table.header).toEqual(['a', 'b', 'c'])
    expect(table.rows).toEqual([
      ['1', 'two, with comma', 'say "hi"'],
      ['4', '5', '6'],
    ])
  })

  it('refuses a ragged row, naming it', () => {
    expect(() => parseCsv('a,b\n1,2\n3,4,5\n')).toThrow('csv: row 3 has 3 fields, header has 2')
  })

  it('refuses an unterminated quote and an empty file', () => {
    expect(() => parseCsv('a,b\n1,"open\n')).toThrow('unterminated quoted field')
    expect(() => parseCsv('')).toThrow('no header row')
  })

  it('requireColumns names every missing column', () => {
    const table = parseCsv('game_id,season\nx,1\n')
    expect(() => requireColumns(table, GAMES_REQUIRED_COLUMNS, 'games')).toThrow(
      'games: unexpected header set — missing column(s) game_type, week, gameday, gametime, away_team, home_team, away_score, home_score, result',
    )
  })
})

describe('easternToUtc (the conversion the locks ultimately read — §23.3)', () => {
  it.each([
    // [gameday, gametime (ET), expected UTC instant, why]
    ['2026-09-09', '20:20', '2026-09-10T00:20:00.000Z', 'week 1 opener, EDT (−4)'],
    ['2026-09-13', '13:00', '2026-09-13T17:00:00.000Z', 'a 1:00 ET Sunday slate, EDT'],
    ['2026-10-29', '20:15', '2026-10-30T00:15:00.000Z', 'week 8 Thursday — still EDT'],
    ['2026-11-01', '13:00', '2026-11-01T18:00:00.000Z', 'week 8 Sunday — fall-back morning, EST (−5)'],
    ['2026-11-01', '20:20', '2026-11-02T01:20:00.000Z', 'week 8 SNF, EST'],
    ['2026-11-02', '20:15', '2026-11-03T01:15:00.000Z', 'week 8 MNF, EST'],
    ['2026-11-08', '09:30', '2026-11-08T14:30:00.000Z', 'week 9 Madrid 9:30 ET, EST'],
    ['2027-01-10', '13:00', '2027-01-10T18:00:00.000Z', 'week 18, January, EST'],
    // D146 one-unit pair around the 2026-11-01 02:00 ET transition.
    ['2026-11-01', '01:59', '2026-11-01T05:59:00.000Z', 'one minute BEFORE the fall-back (EDT, first occurrence)'],
    ['2026-11-01', '03:00', '2026-11-01T08:00:00.000Z', 'after the fall-back (EST)'],
  ])('%s %s ET → %s (%s)', (day, wall, expected) => {
    expect(easternToUtc(day, wall).toISOString()).toBe(expected)
  })

  it('reads the zone offset from IANA data: 240 (EDT) on Oct 31, 300 (EST) on Nov 2, 2026', () => {
    expect(easternOffsetMinutesAt(new Date('2026-10-31T12:00:00Z'))).toBe(240)
    expect(easternOffsetMinutesAt(new Date('2026-11-02T12:00:00Z'))).toBe(300)
  })

  it('refuses malformed and out-of-range input rather than guessing', () => {
    expect(() => easternToUtc('2026-9-9', '20:20')).toThrow('malformed')
    expect(() => easternToUtc('2026-09-09', '8:20 PM')).toThrow('malformed')
    expect(() => easternToUtc('2026-13-01', '20:20')).toThrow('out-of-range')
    expect(() => easternToUtc('2026-09-09', '24:00')).toThrow('out-of-range')
  })
})

describe('team vocabulary', () => {
  it('maps nflverse LA → house LAR and passes every other 2026 code through', () => {
    expect(mapNflverseTeam('LA')).toBe('LAR')
    expect(mapNflverseTeam('KC')).toBe('KC')
    expect(mapNflverseTeam('WAS')).toBe('WAS')
  })

  it('refuses a code the house does not know (a relocation must be mapped deliberately)', () => {
    expect(() => mapNflverseTeam('STL')).toThrow('nflverse team code "STL" is not a house team code')
    expect(() => mapNflverseTeam('OAK')).toThrow('not a house team code')
  })
})

describe('games.csv → ProviderGame', () => {
  it('parses the recorded fixture: 94 rows, every required column present', () => {
    const rows = parseGamesCsv(GAMES_CSV)
    expect(rows).toHaveLength(94)
    expect(rows.filter((r) => r.season === '2026')).toHaveLength(77)
  })

  it('refuses a renamed column loudly (an nflverse schema change never yields a plausible empty sync)', () => {
    const renamed = GAMES_CSV.replace('gameday,weekday,gametime,', 'gameday,weekday,kickoff_et,')
    expect(() => parseGamesCsv(renamed)).toThrow('nflverse games.csv: unexpected header set — missing column(s) gametime')
  })

  it('getSchedule(2026): 77 regular-season games with UTC kickoffs and house team codes — stored literals', async () => {
    const p = fixtureProvider()
    const games = await p.getSchedule(2026)
    expect(games).toHaveLength(77)
    const byId = new Map(games.map((g) => [g.gameId, g]))
    expect(byId.get('2026_01_NE_SEA')).toEqual<ProviderGame>({
      gameId: '2026_01_NE_SEA',
      season: 2026,
      week: 1,
      homeTeam: 'SEA',
      awayTeam: 'NE',
      kickoffAt: new Date('2026-09-10T00:20:00.000Z'),
      gameDate: '2026-09-09',
      status: 'scheduled',
    })
    // The Rams: nflverse `LA`, house `LAR` (the Melbourne game).
    expect(byId.get('2026_01_SF_LA')).toMatchObject({ homeTeam: 'LAR', awayTeam: 'SF', kickoffAt: new Date('2026-09-11T00:35:00.000Z') })
    expect(byId.get('2026_18_SEA_LA')).toMatchObject({ homeTeam: 'LAR', kickoffAt: new Date('2027-01-10T18:00:00.000Z') })
    // The DST-edge week, both sides of the flip, from the same file.
    expect(byId.get('2026_08_CAR_GB')?.kickoffAt).toEqual(new Date('2026-10-30T00:15:00.000Z'))
    expect(byId.get('2026_08_BAL_BUF')?.kickoffAt).toEqual(new Date('2026-11-01T18:00:00.000Z'))
    expect(byId.get('2026_09_CIN_ATL')?.kickoffAt).toEqual(new Date('2026-11-08T14:30:00.000Z'))
    expect(p.lastReport).toEqual({
      method: 'getSchedule',
      counts: { fileRows: 94, seasonRows: 77, regular: 77, withoutKickoff: 0 },
      reasons: [],
    })
  })

  it('the emitted status set is exactly {scheduled, final} — never live, never postponed (T+1 honesty)', async () => {
    const p = fixtureProvider()
    const statuses = new Set([...(await p.getSchedule(2026)), ...(await p.getSchedule(2025))].map((g) => g.status))
    expect([...statuses].sort()).toEqual(['final', 'scheduled'])
  })

  it('status: final iff a result is posted (result, or both scores)', () => {
    expect(mapNflverseGameStatus({ result: '6', home_score: '27', away_score: '21' })).toBe('final')
    expect(mapNflverseGameStatus({ result: '', home_score: '27', away_score: '21' })).toBe('final')
    expect(mapNflverseGameStatus({ result: '', home_score: '', away_score: '' })).toBe('scheduled')
    expect(mapNflverseGameStatus({ result: '', home_score: '27', away_score: '' })).toBe('scheduled')
  })

  it('regular season ONLY: the 2025 WC row is dropped and counted; the 16 REG week-1 games are final with real results', async () => {
    const p = fixtureProvider()
    const games = await p.getSchedule(2025)
    expect(games).toHaveLength(16)
    expect(games.find((g) => g.gameId === '2025_19_GB_CHI')).toBeUndefined()
    expect(games.every((g) => g.status === 'final')).toBe(true)
    expect(games.find((g) => g.gameId === '2025_01_KC_LAC')).toMatchObject({
      homeTeam: 'LAC',
      awayTeam: 'KC',
      kickoffAt: new Date('2025-09-06T00:00:00.000Z'), // Friday 20:00 ET, São Paulo
      status: 'final',
    })
    expect(p.lastReport?.counts).toEqual({ fileRows: 94, seasonRows: 17, regular: 16, withoutKickoff: 0 })
    expect(p.lastReport?.reasons).toEqual([
      "1 postseason row(s) dropped — regular season only (the sleeper tier's scope; nfl_games.game_type defaults to 'regular')",
    ])
  })

  it('a season the file does not carry refuses loud — never an empty schedule', async () => {
    await expect(fixtureProvider().getSchedule(2024)).rejects.toThrow(
      'nflverse games.csv carries zero rows for season 2024 (94 rows in the file) — refusing an empty schedule',
    )
  })

  it('an unpublished gametime yields kickoffAt null with the day kept, counted and named', async () => {
    const csv = editGameRow(GAMES_CSV, '2026_18_SF_ARI', (f) => {
      f[GAMES_HEADER_IDX.gametime] = ''
    })
    const p = fixtureProvider({ games: csv })
    const games = await p.getSchedule(2026)
    expect(games.find((g) => g.gameId === '2026_18_SF_ARI')).toMatchObject({ kickoffAt: null, gameDate: '2027-01-10' })
    expect(p.lastReport?.counts.withoutKickoff).toBe(1)
    expect(p.lastReport?.reasons).toEqual(['1 game(s) have no published gametime yet — kickoffAt null, gameDate kept'])
  })

  it('getGameStates(2026, 8) derives from the schedule: 14 games, all scheduled', async () => {
    const states = await fixtureProvider().getGameStates(2026, 8)
    expect(states).toHaveLength(14)
    expect(states.every((s) => s.status === 'scheduled')).toBe(true)
    expect(states[0]).toEqual({ gameId: '2026_08_CAR_GB', status: 'scheduled' })
  })

  it('supplies no stat lines and no injury designations — [] with the reason on the report, never a silent empty', async () => {
    const p = fixtureProvider()
    expect(await p.getWeekStats(2026, 1)).toEqual([])
    expect(p.lastReport?.reasons).toEqual([
      'nflverse supplies no stat lines — sleeper_free is the stats source (Q1); compose via withNflverseCalendar',
    ])
    expect(await p.getInjuries(2026, 1)).toEqual([])
    expect(p.lastReport?.reasons[0]).toContain('no injury designations')
    expect(p.capabilities.size).toBe(0)
    expect(p.name).toBe('nflverse')
  })
})

describe('deterministic nfl_games rows (through ingestWeek\'s own toGameRow/diffGames)', () => {
  async function rows(csv = GAMES_CSV): Promise<GameRow[]> {
    const games = await fixtureProvider({ games: csv }).getSchedule(2026)
    return games.map((g) => toGameRow(g)).filter((r): r is GameRow => r !== null)
  }

  it('the fixture → the exact table row for the opener (a stored literal)', async () => {
    const all = await rows()
    expect(all).toHaveLength(77)
    expect(all.find((r) => r.id === '2026_01_NE_SEA')).toEqual<GameRow>({
      id: '2026_01_NE_SEA',
      season: 2026,
      week: 1,
      home_team: 'SEA',
      away_team: 'NE',
      kickoff_at: '2026-09-10T00:20:00.000Z',
      status: 'scheduled',
    })
  })

  it('idempotent: the same fixture twice ⇒ zero inserts, zero updates, 77 unchanged', async () => {
    const first = await rows()
    const second = await rows()
    const diff = diffGames(second, new Map(first.map((r) => [r.id, r])))
    expect(diff).toEqual({ inserts: [], updates: [], unchanged: 77 })
  })

  it('E42 (real edition): the 1:00 → 8:20 SNF flex is exactly one updated row with the new UTC instant', async () => {
    const before = await rows()
    const flexed = editGameRow(GAMES_CSV, '2026_01_CHI_CAR', (f) => {
      f[GAMES_HEADER_IDX.gametime] = '20:20'
    })
    const after = await rows(flexed)
    const diff = diffGames(after, new Map(before.map((r) => [r.id, r])))
    expect(diff.inserts).toEqual([])
    expect(diff.unchanged).toBe(76)
    expect(diff.updates).toEqual([
      {
        id: '2026_01_CHI_CAR',
        season: 2026,
        week: 1,
        home_team: 'CAR',
        away_team: 'CHI',
        kickoff_at: '2026-09-14T00:20:00.000Z',
        status: 'scheduled',
      },
    ])
  })

  it('a game moved to another day (a postponement, as nflverse expresses it) is likewise one updated row', async () => {
    const before = await rows()
    const moved = editGameRow(GAMES_CSV, '2026_01_CHI_CAR', (f) => {
      f[GAMES_HEADER_IDX.gameday] = '2026-09-14'
      f[GAMES_HEADER_IDX.gametime] = '19:00'
    })
    const diff = diffGames(await rows(moved), new Map(before.map((r) => [r.id, r])))
    expect(diff.updates.map((r) => [r.id, r.kickoff_at])).toEqual([['2026_01_CHI_CAR', '2026-09-14T23:00:00.000Z']])
  })

  it('a posted result flips the row to final — one updated row', async () => {
    const before = await rows()
    const played = editGameRow(GAMES_CSV, '2026_01_NE_SEA', (f) => {
      f[GAMES_HEADER_IDX.away_score] = '17'
      f[GAMES_HEADER_IDX.home_score] = '24'
      f[GAMES_HEADER_IDX.result] = '7'
    })
    const diff = diffGames(await rows(played), new Map(before.map((r) => [r.id, r])))
    expect(diff.updates.map((r) => [r.id, r.status])).toEqual([['2026_01_NE_SEA', 'final']])
  })
})

describe('official inactives (roster_weekly status = INA — C56: the feed, never players.status)', () => {
  it('2025 week 1, KC + ARI: grouped onto the game, keyed by sleeper_id, OL rows without an id dropped and counted', async () => {
    const p = fixtureProvider()
    const inactives = await p.getInactives(2025, 1)
    expect(inactives).toEqual([
      { gameId: '2025_01_ARI_NO', playerIds: ['11014', '11717', '11767', '8122'], publishedAt: OBSERVED },
      { gameId: '2025_01_KC_LAC', playerIds: ['11595', '12505', '12615', '7561', '8001'], publishedAt: OBSERVED },
    ])
    expect(p.lastReport).toEqual({
      method: 'getInactives',
      counts: { fileRows: 190, inactiveRows: 11, games: 2, players: 9, withoutSleeperId: 2, teamsWithoutGame: 0 },
      reasons: ['2 inactive row(s) carry no sleeper_id (positions Sleeper does not track) — dropped'],
    })
    // The two dropped rows are the offensive linemen the fixture carries without a Sleeper id.
    const dropped = parseWeeklyRosterCsv(ROSTER_CSV).filter((r) => r.status === 'INA' && r.sleeper_id === '')
    expect(dropped.map((r) => [r.full_name, r.position])).toEqual([
      ['Will Hernandez', 'OL'],
      ['Hunter Nourzad', 'OL'],
    ])
  })

  it('a week with no INA rows and no final game returns [] and says nothing is declared yet', async () => {
    const p = fixtureProvider()
    expect(await p.getInactives(2025, 2)).toEqual([])
    expect(p.lastReport?.counts).toMatchObject({ inactiveRows: 0, games: 0 })
    expect(p.lastReport?.reasons).toEqual(['zero INA rows for 2025 week 2 — no game of the week is final yet (nothing to declare)'])
  })

  it('a week whose games are final but carries no INA rows is named as a feed that has not caught up (never a quiet empty)', async () => {
    const withoutIna = ROSTER_CSV.split('\n')
      .filter((l) => !l.includes(',INA,'))
      .join('\n')
    const p = fixtureProvider({ roster: withoutIna })
    expect(await p.getInactives(2025, 1)).toEqual([])
    expect(p.lastReport?.reasons).toEqual([
      'zero INA rows for 2025 week 1 although 16 game(s) are final — the roster file may not have caught up (T+1), or its status vocabulary changed',
    ])
  })

  it('a team with INA rows but no game that week is counted and named (bye weeks carry none — measured on 2025)', async () => {
    // Move one KC INA row to week 2 — the fixture schedule has no 2025 week-2 game.
    const csv = ROSTER_CSV.replace('2025,KC,RB,RB,25,INA,Elijah Mitchell', '2025,KC,RB,RB,25,INA,Elijah Mitchell').replace(
      /(2025,KC,RB,RB,25,INA,Elijah Mitchell[^\n]*?),1,REG,/,
      '$1,2,REG,',
    )
    expect(csv).not.toBe(ROSTER_CSV)
    const p = fixtureProvider({ roster: csv })
    expect(await p.getInactives(2025, 2)).toEqual([])
    expect(p.lastReport?.counts).toMatchObject({ inactiveRows: 1, teamsWithoutGame: 1 })
    expect(p.lastReport?.reasons).toContain(
      '1 team(s) with INA rows but no 2025 week 2 game in the schedule — KC (a bye week never carries INA rows; measured 2025)',
    )
  })

  it('the roster team code is mapped too: an LA row lands on the Rams game', async () => {
    const csv = ROSTER_CSV.replace(/(\n2025,)KC(,TE,TE,\d+,INA,Jared Wiley)/, '$1LA$2')
    expect(csv).not.toBe(ROSTER_CSV)
    const inactives = await fixtureProvider({ roster: csv }).getInactives(2025, 1)
    expect(inactives.find((g) => g.gameId === '2025_01_HOU_LA')?.playerIds).toEqual(['11595'])
    expect(inactives.find((g) => g.gameId === '2025_01_KC_LAC')?.playerIds).toEqual(['12505', '12615', '7561', '8001'])
  })

  it('a renamed roster column refuses loud', async () => {
    const renamed = ROSTER_CSV.replace('fantasy_data_id,sleeper_id,', 'fantasy_data_id,sleeper,')
    await expect(fixtureProvider({ roster: renamed }).getInactives(2025, 1)).rejects.toThrow(
      'nflverse roster_weekly.csv: unexpected header set — missing column(s) sleeper_id',
    )
  })
})

describe('withNflverseCalendar — the go-forward composition (L.D2.3 binds this)', () => {
  function baseProvider(games: ProviderGame[]): StatsProvider & { calls: string[] } {
    const calls: string[] = []
    return {
      name: 'sleeper',
      capabilities: new Set<StatTier>(['core_box']),
      calls,
      async getSchedule() {
        calls.push('getSchedule')
        return games
      },
      async getGameStates() {
        calls.push('getGameStates')
        return []
      },
      async getWeekStats(season, week) {
        calls.push(`getWeekStats:${season}:${week}`)
        return [{ playerId: '4046', season, week, stats: { pass_yards: 300 }, advanced: {} }]
      },
      async getInjuries(season, week) {
        calls.push(`getInjuries:${season}:${week}`)
        return [{ playerId: '4046', designation: 'questionable', reportedAt: OBSERVED }]
      },
      async getInactives() {
        calls.push('getInactives')
        return [{ gameId: 'never', playerIds: [], publishedAt: OBSERVED }]
      },
    }
  }

  const sleeperGame = (week: number, away: string, home: string, status: ProviderGame['status']): ProviderGame => ({
    gameId: `2026-wk${String(week).padStart(2, '0')}-${away}@${home}`,
    season: 2026,
    week,
    homeTeam: home,
    awayTeam: away,
    kickoffAt: null,
    gameDate: null,
    status,
  })

  it('mergeGameStatus: the more advanced reading wins; postponed is a positive claim', () => {
    expect(mergeGameStatus('scheduled', 'live')).toBe('live')
    expect(mergeGameStatus('final', 'scheduled')).toBe('final')
    expect(mergeGameStatus('scheduled', 'postponed')).toBe('postponed')
    expect(mergeGameStatus('final', 'final')).toBe('final')
  })

  it('nflverse calendar + the live tier\'s status per matched game; unmatched base games are counted, not written', async () => {
    const base = baseProvider([
      sleeperGame(1, 'NE', 'SEA', 'live'), // Sleeper says in-game; nflverse says scheduled → live
      sleeperGame(1, 'SF', 'LAR', 'final'), // house code LAR on both sides after mapping → final
      sleeperGame(1, 'CHI', 'CAR', 'scheduled'),
      sleeperGame(1, 'XXX', 'YYY', 'final'), // no nflverse counterpart → baseOnly
    ])
    const composite = withNflverseCalendar(base, fixtureProvider())
    expect(composite.name).toBe('sleeper+nflverse')
    expect(composite.capabilities).toBe(base.capabilities)
    const games = await composite.getSchedule(2026)
    expect(games).toHaveLength(77)
    const byId = new Map(games.map((g) => [g.gameId, g]))
    expect(byId.get('2026_01_NE_SEA')).toMatchObject({ status: 'live', kickoffAt: new Date('2026-09-10T00:20:00.000Z') })
    expect(byId.get('2026_01_SF_LA')).toMatchObject({ status: 'final', homeTeam: 'LAR' })
    expect(byId.get('2026_01_CHI_CAR')?.status).toBe('scheduled')
    expect(byId.get('2026_01_TB_CIN')?.status).toBe('scheduled') // no base row → nflverse's reading
    expect(composite.lastScheduleReport).toEqual({ nflverseGames: 77, baseGames: 4, matched: 3, baseOnly: 1 })
    expect(games.find((g) => g.gameId.includes('XXX'))).toBeUndefined()
  })

  it('getGameStates reads the merged schedule; stats + injuries delegate to the base; inactives come from nflverse', async () => {
    const base = baseProvider([sleeperGame(1, 'NE', 'SEA', 'final')])
    const nflverse = fixtureProvider()
    const composite = withNflverseCalendar(base, nflverse)
    expect(await composite.getGameStates(2026, 1)).toContainEqual({ gameId: '2026_01_NE_SEA', status: 'final' })
    expect(await composite.getWeekStats(2026, 1)).toEqual([{ playerId: '4046', season: 2026, week: 1, stats: { pass_yards: 300 }, advanced: {} }])
    expect((await composite.getInjuries(2026, 1))[0].designation).toBe('questionable')
    expect(await composite.getInactives(2025, 1)).toHaveLength(2) // nflverse's KC/ARI, not the base's 'never'
    expect(base.calls).toEqual(['getSchedule', 'getWeekStats:2026:1', 'getInjuries:2026:1'])
  })
})

describe('the transport', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fetchTextViaHttp refuses a non-OK response naming status and URL (a moved asset is loud)', async () => {
    vi.stubGlobal('fetch', async () => new Response('gone', { status: 404, statusText: 'Not Found' }))
    await expect(fetchTextViaHttp(NFLVERSE_URLS.weeklyRosters(2026))).rejects.toThrow(
      'nflverse fetch failed: 404 Not Found — https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_2026.csv',
    )
  })

  it('the pinned asset paths are the published release URLs (no HTML, no third-party scraping API)', () => {
    expect(NFLVERSE_URLS.games).toBe('https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv')
    expect(NFLVERSE_URLS.weeklyRosters(2026)).toBe(
      'https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_2026.csv',
    )
  })
})
