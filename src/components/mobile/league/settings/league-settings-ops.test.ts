/**
 * League Menu › League settings / Scoring / Playoffs on the phone (handoff
 * m-community G2; gap list §4 item 105) — the read model. Every row comes
 * from the league's real settings and scoring document; nothing desktop's
 * settings page shows is dropped.
 */
import { describe, expect, it } from 'vitest'

import { defaultsForTeamCount, type LeagueSettings } from '@/lib/leagues/settings/league-settings'
import type { ScoringRulesDocV2 } from '@/lib/leagues/scoring/rules-doc'
import { SCORING_TEMPLATES } from '@/lib/leagues/scoring/templates'

import {
  clock12,
  coefficientLine,
  freeAgencyLine,
  generalGroupFor,
  generalGroups,
  hoursLine,
  irRows,
  playoffByes,
  playoffsPage,
  playoffWeekList,
  pointsValue,
  scoringGroups,
  settingsPageFor,
  startersLine,
  tiebreakOrder,
  tradeReviewLine,
  waiverRunLine,
  waiverTypeLine,
  zoneWords,
  type GeneralInput,
  type SettingsGroup,
  type SettingsRow,
} from './league-settings-ops'

const settings = (over: Partial<LeagueSettings> = {}): LeagueSettings => ({ ...defaultsForTeamCount(12), ...over })

const member = (role: string, username: string | null, team: string | null = `t-${username}`) => ({
  user_id: username ? `u-${username}` : null,
  team_id: team,
  role,
  profiles: username ? { username } : null,
})

function general(over: Partial<GeneralInput> = {}) {
  return generalGroups({
    name: 'Sunday Funday League',
    season: 2099,
    settings: settings(),
    members: [member('commissioner', 'marcus'), member('manager', 'kelly')],
    formatDraftAt: (iso) => `at ${iso}`,
    membersHref: '/app/leagues/l1/members',
    ...over,
  })
}

/** label → shown value ("@a, @b" for handles, "›" for a door). */
function rowsOf(group: SettingsGroup | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of group?.rows ?? []) out[r.label] = valueOf(r)
  return out
}
function valueOf(r: SettingsRow): string {
  if ('handles' in r) return r.handles.map((h) => `@${h}`).join(', ')
  if ('href' in r) return `› ${r.href}`
  return r.value
}
const group = (groups: readonly SettingsGroup[], id: string) => groups.find((g) => g.id === id)

describe('which page an address opens', () => {
  it('maps the Menu’s three rows and folds desktop’s other sections into League settings', () => {
    expect(settingsPageFor(null)).toBe('general')
    expect(settingsPageFor('scoring')).toBe('scoring')
    expect(settingsPageFor('league')).toBe('playoffs')
    for (const s of ['teams', 'roster', 'draft', 'waivers'] as const) expect(settingsPageFor(s)).toBe('general')
  })

  it('opens League settings at the group the address names', () => {
    expect(generalGroupFor('teams')).toBe('league')
    expect(generalGroupFor('roster')).toBe('roster')
    expect(generalGroupFor('draft')).toBe('draft')
    expect(generalGroupFor('waivers')).toBe('waivers')
    expect(generalGroupFor(null)).toBeNull()
    expect(generalGroupFor('scoring')).toBeNull()
  })
})

describe('League settings (G2 general)', () => {
  it('draws the handoff’s League, Roster and Waivers & trades sections, plus Draft', () => {
    expect(general().map((g) => g.title)).toEqual(['League', 'Roster', 'Draft', 'Waivers & trades'])
  })

  it('League: the name, size with open seats, commissioner handles, season and format — and the Members door', () => {
    const rows = rowsOf(group(general(), 'league'))
    expect(rows).toMatchObject({
      'League name': 'Sunday Funday League',
      Teams: '12 · 10 open spots',
      Commissioner: '@marcus',
      Season: '2099',
      Schedule: 'Head-to-head',
      'Regular season': '14 weeks',
      'Median game': 'Off',
      'Second opponent': 'Off',
      Members: '› /app/leagues/l1/members',
    })
    expect(rows['Co-commissioner']).toBeUndefined()
  })

  it('names co-commissioners as profile handles, and a full league has no "open"', () => {
    const members = [
      member('commissioner', 'marcus'),
      member('co_commissioner', 'jordan'),
      ...Array.from({ length: 6 }, (_, i) => member('manager', `m${i}`)),
    ]
    const rows = rowsOf(group(general({ settings: settings({ team_count: 8 }), members }), 'league'))
    expect(rows.Teams).toBe('8')
    expect(rows['Co-commissioner']).toBe('@jordan')
  })

  it('leaves the Members door off when there is no page for it', () => {
    expect(rowsOf(group(general({ membersHref: null }), 'league')).Members).toBeUndefined()
  })

  it('Roster: the handoff’s starters line, bench, IR — and the lineup rules desktop shows', () => {
    const rows = rowsOf(group(general(), 'roster'))
    expect(rows).toMatchObject({
      Starters: 'QB, 2 RB, 3 WR, TE, FLEX, K, D/ST',
      Bench: '6',
      'Hot Swap': 'Off',
      IR: '1 · OUT, IR',
      'Roster spots': '17 per team',
      'Lineup lock': 'Each player’s kickoff',
      'Auto-sub inactives': 'Off',
      'Stat corrections': 'Until next week’s first game',
    })
  })

  it('Roster: Hot Swap on, and a DL beside the IR spots — each kind its own row with what it takes and how long a player stays', () => {
    const base = settings()
    const roster = {
      ...base.roster_settings,
      swap_spots: 1 as const,
      ir_slots: [
        { key: 'ir1', type: 'unrestricted' as const, eligible_designations: ['OUT' as const, 'IR' as const] },
        { key: 'ir2', type: 'unrestricted' as const, eligible_designations: ['OUT' as const, 'IR' as const] },
        { key: 'dl1', label: 'DL', type: 'restricted' as const, eligible_designations: ['OUT' as const, 'IR' as const, 'Doubtful' as const], min_weeks: 4 },
      ],
    }
    const rows = rowsOf(group(general({ settings: settings({ roster_settings: roster }) }), 'roster'))
    expect(rows).toMatchObject({ 'Hot Swap': 'On', IR: '2 · OUT, IR', DL: '1 · OUT, IR, Doubtful · stays 4 weeks', 'Roster spots': '19 per team' })
  })

  it('Draft: a snake draft’s rows; an unscheduled draft says so; an auction adds its knobs', () => {
    const snake = rowsOf(group(general(), 'draft'))
    expect(snake).toMatchObject({ 'Draft type': 'Snake', 'Third-round reversal': 'Off', 'Draft time': 'Not set', 'Draft order': 'Random', 'Pick clock': '90 seconds' })
    expect(snake['Auction budget']).toBeUndefined()

    const s = settings()
    const auction = rowsOf(
      group(
        general({ settings: { ...s, draft: { ...s.draft, draft_type: 'auction', draft_scheduled_at: '2099-08-30T19:00:00-07:00', time_zone: 'America/Los_Angeles' } } }),
        'draft',
      ),
    )
    expect(auction).toMatchObject({
      'Draft type': 'Auction',
      'Draft time': 'at 2099-08-30T19:00:00-07:00',
      'League time zone': 'Pacific',
      'Auction budget': '$200',
      'Allow $0 nominations': 'Off',
      'Nomination clock': '30 seconds',
      'Bid clock': '20 seconds',
      'Anti-snipe': '10 seconds',
      'Nomination order': 'Same as draft order',
    })
    expect(auction['Third-round reversal']).toBeUndefined()
  })

  it('Waivers & trades: FAAB rows only in a FAAB league; no schedule rows without waivers', () => {
    const faab = rowsOf(group(general(), 'waivers'))
    expect(faab).toMatchObject({
      'Waiver type': 'FAAB · $100 budget',
      'Waivers process': 'Wed 3:00 AM Eastern',
      'Free agency opens': 'After each waiver run',
      'Minimum bid': '$0',
      'Bid tiebreaker': 'Rolling priority',
      'Acquisitions per week': 'Unlimited',
      'Free agent hold': 'None',
      'Trade review': 'Commissioner · 1 day',
      'Trade deadline': 'Week 11',
      'FAAB in trades': 'Off',
      'Future considerations': 'Off',
      'If a game is live': 'Defer to next lock-free',
    })

    const none = rowsOf(group(general({ settings: settings({ waiver_type: 'none_fcfs', trade_review: 'league_vote', trade_deadline_week: null }) }), 'waivers'))
    expect(none['Waiver type']).toBe('None — first come, first served')
    for (const gone of ['Waivers process', 'Free agency opens', 'Minimum bid', 'Bid tiebreaker', 'FAAB in trades']) expect(none[gone]).toBeUndefined()
    expect(none['Trade review']).toBe('League vote · 1 day')
    expect(none['Votes to veto']).toBe(String(settings().trade_veto_votes))
    expect(none['Trade deadline']).toBe('None')
  })
})

describe('the small words', () => {
  it('starters count repeats; the standard flex is the handoff’s bare FLEX, a custom flex keeps the positions it takes', () => {
    expect(
      startersLine([
        { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
        { key: 'flex', label: 'FLEX (W/R/T)', eligible: ['WR', 'RB', 'TE'], count: 1 },
        { key: 'sf', label: 'SUPERFLEX (Q/W/R/T)', eligible: ['QB', 'WR', 'RB', 'TE'], count: 2 },
        { key: 'wt', label: 'FLEX (W/T)', eligible: ['WR', 'TE'], count: 1 },
        { key: 'wrt', label: 'W/R/T', eligible: ['WR', 'RB', 'TE'], count: 1 },
        { key: 'k', label: 'K', eligible: ['K'], count: 0 },
      ]),
    ).toBe('QB, FLEX, 2 SUPERFLEX (QB/WR/RB/TE), FLEX (WR/TE), W/R/T')
    expect(startersLine([])).toBe('None')
  })

  it('IR rows: none says so; an unlabeled restricted spot is "Restricted IR" with its stay', () => {
    expect(irRows([])).toEqual([{ key: 'ir', label: 'IR', value: 'None' }])
    expect(irRows([{ key: 'r1', type: 'restricted', eligible_designations: ['IR'], min_weeks: 1 }])).toEqual([
      { key: 'ir', label: 'Restricted IR', value: '1 · IR · stays 1 week' },
    ])
  })

  it('clocks, zones, waiver runs and free agency in plain words', () => {
    expect(clock12('03:00')).toBe('3:00 AM')
    expect(clock12('21:30')).toBe('9:30 PM')
    expect(clock12('12:05')).toBe('12:05 PM')
    expect(zoneWords('America/Chicago')).toBe('Central')
    expect(zoneWords('America/Boise')).toBe('Boise')
    expect(waiverRunLine({ waiver_run_days: ['tue', 'thu'], waiver_run_time: '09:00', waiver_time_zone: 'America/Los_Angeles' })).toBe('Tue, Thu 9:00 AM Pacific')
    expect(waiverRunLine({ waiver_run_days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], waiver_run_time: '03:00', waiver_time_zone: 'America/New_York' })).toBe('Every day 3:00 AM Eastern')
    expect(freeAgencyLine({ free_agency_opens: 'day_and_time', free_agency_open_day: 'sun', free_agency_open_time: '06:00', waiver_time_zone: 'America/Los_Angeles' })).toBe('Sun 6:00 AM Pacific')
    expect(freeAgencyLine({ free_agency_opens: 'never', free_agency_open_day: 'sun', free_agency_open_time: '06:00', waiver_time_zone: 'America/New_York' })).toBe('Never — claims only')
  })

  it('waiver types and trade review read like the handoff', () => {
    expect(waiverTypeLine({ waiver_type: 'faab', faab_budget: 200 })).toBe('FAAB · $200 budget')
    expect(waiverTypeLine({ waiver_type: 'rolling_priority', faab_budget: 200 })).toBe('Rolling priority')
    expect(tradeReviewLine({ trade_review: 'commissioner', trade_review_period_hours: 24 })).toBe('Commissioner · 1 day')
    expect(tradeReviewLine({ trade_review: 'none', trade_review_period_hours: 0 })).toBe('None — trades go through at once')
    expect(hoursLine(48)).toBe('2 days')
    expect(hoursLine(12)).toBe('12 hours')
    expect(hoursLine(1)).toBe('1 hour')
    expect(hoursLine(0)).toBe('No wait')
  })
})

describe('Playoffs (G2 playoffs)', () => {
  it('the handoff’s Format and Other rows, from the league’s bracket', () => {
    const page = playoffsPage(settings({ playoff_teams: 6, playoff_start_week: 15, playoff_weeks_per_round: 1, consolation_bracket: true }))
    expect(page.groups.map((g) => g.title)).toEqual(['Format', 'Other', 'Tiebreakers'])
    expect(rowsOf(group(page.groups, 'format'))).toEqual({ 'Playoff teams': '6', Weeks: '15, 16, 17', 'First-round byes': 'Top 2 seeds', Seeding: 'Record, then points for' })
    expect(rowsOf(group(page.groups, 'other'))).toMatchObject({ 'Weeks per round': '1 week', 'Consolation bracket': 'On', 'Reseed each round': 'On', 'Third-place game': 'Off' })
    expect(page.note).toBe('The playoff bracket shows at the top of the League tab once the playoffs start in Week 15.')
  })

  it('two-week rounds and a bracket with no byes', () => {
    expect(playoffWeekList({ playoff_teams: 4, playoff_start_week: 15, playoff_weeks_per_round: 2 })).toBe('15–16, 17–18')
    expect(playoffByes(4)).toBe(0)
    expect(playoffByes(6)).toBe(2)
    expect(playoffByes(10)).toBe(6)
    expect(playoffByes(12)).toBe(4)
    expect(playoffByes(0)).toBe(0)
    const page = playoffsPage(settings({ playoff_teams: 8 }))
    expect(rowsOf(group(page.groups, 'format'))['First-round byes']).toBe('None')
  })

  it('the tiebreak order: the stored chain, divisions left out, head-to-head too in a points race, stopping at the coin flip', () => {
    expect(tiebreakOrder({ tiebreakers: ['win_pct', 'points_for', 'head_to_head', 'points_against', 'division_record', 'coin_flip'], schedule_mode: 'h2h' })).toEqual([
      'Record',
      'Points for',
      'Head-to-head',
      'Points against',
      'Coin flip',
    ])
    expect(tiebreakOrder({ tiebreakers: ['points_for', 'coin_flip'], schedule_mode: 'total_points' })).toEqual(['Points for', 'Coin flip'])
    const ranked = playoffsPage(settings({ tiebreakers: ['points_for', 'win_pct', 'head_to_head', 'points_against', 'division_record', 'coin_flip'] }))
    expect(rowsOf(group(ranked.groups, 'format')).Seeding).toBe('Points for, then record')
    expect(rowsOf(group(ranked.groups, 'tiebreakers'))).toMatchObject({ '1st': 'Points for', '2nd': 'Record', '3rd': 'Head-to-head' })
  })

  it('no playoffs: says why — a points race, or playoffs switched off', () => {
    const points = playoffsPage(settings({ schedule_mode: 'total_points', playoff_teams: 0 }))
    expect(rowsOf(group(points.groups, 'format'))).toEqual({ 'Playoff teams': 'None' })
    expect(points.note).toMatch(/season-long points race is the playoff/)
    const off = playoffsPage(settings({ playoff_teams: 0 }))
    expect(off.note).toBe('Playoffs are off for this league — the final standings decide the champion.')
    expect(group(off.groups, 'other')).toBeUndefined()
  })
})

describe('Scoring (G2 scoring)', () => {
  const template = (name: string) => {
    const t = SCORING_TEMPLATES.find((x) => x.name === name)
    if (!t) throw new Error(`no template ${name}`)
    return t.rules
  }

  it('values read like the handoff: yards as "1 pt per 25", a true minus, decimals trimmed', () => {
    expect(coefficientLine('pass_yards', 0.04)).toBe('1 pt per 25')
    expect(coefficientLine('rush_yards', 0.1)).toBe('1 pt per 10')
    expect(coefficientLine('receiving_yards', 0.07)).toBe('0.07 per yard')
    expect(coefficientLine('interceptions', -2)).toBe('−2')
    expect(coefficientLine('receptions', 0.5)).toBe('0.5')
    expect(pointsValue(0)).toBe('0')
  })

  it('a template’s every scored stat, in the handoff’s order, then the D/ST tiers with their unit', () => {
    const groups = scoringGroups(template('ESPN Standard'))
    expect(groups.map((g) => g.title)).toEqual(['Passing', 'Rushing', 'Receiving', 'Turnovers', 'Special teams', 'Kicking', 'Defense', 'Points allowed', 'Yards allowed'])
    const passing = rowsOf(group(groups, 'passing'))
    expect(passing['Passing yards']).toBe('1 pt per 25')
    expect(passing['Passing TDs']).toBe('4')
    expect(rowsOf(group(groups, 'turnovers'))['Interceptions thrown']).toBe('−2')
    expect(rowsOf(group(groups, 'def_pa'))['0 points']).toBeDefined()
    expect(Object.keys(rowsOf(group(groups, 'def_ya')))[0]).toMatch(/ yards$/)
  })

  it('a custom league’s per-position values are their own rows under the shared one; unscored stats have none', () => {
    const { pass_2pt: _unscored, ...base } = template('ESPN Standard') as Record<string, number>
    void _unscored
    const doc: ScoringRulesDocV2 = {
      format: 2,
      base: { ...base, qb_sack_taken: -1 },
      positions: { TE: { receptions: 1 } },
      tier_cuts: { def_pa: [0, 1, 7, 14, 18, 28, 35, 46], def_ya: [0, 100, 200, 300, 350, 400, 450, 500, 550] },
    }
    const receiving = group(scoringGroups(doc), 'receiving')
    const labels = receiving?.rows.map((r) => r.label) ?? []
    expect(labels.slice(0, 2)).toEqual(['Receptions', 'Receptions (TE)'])
    expect(rowsOf(receiving)['Receptions (TE)']).toBe('1')
    const passing = rowsOf(group(scoringGroups(doc), 'passing'))
    expect(passing['Sacks taken']).toBe('−1')
    expect(passing['2-pt conversions (pass)']).toBeUndefined()
  })
})
