/**
 * settings-panel-ops — the IN-SEASON half (M6A L.E1.13 item 3; D347 / D360;
 * Q64; Q66): which keys 129's policy table closes, how one working draft
 * becomes per-key calls, and which sentence a 129 document earns.
 */
import { describe, expect, it } from 'vitest'

import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import {
  SCORING_SYSTEM_KEY,
  inSeasonChangePlan,
  inSeasonRefusal,
  settingOutcome,
  settingPolicyKeys,
  type SettingPolicies,
  type SettingPolicy,
} from './settings-panel-ops'

const free: SettingPolicy = { storage: 'blob', class: 'free', refused_why: null }
const rescore: SettingPolicy = { storage: 'column', class: 'rescore', refused_why: null }
const bracket: SettingPolicy = { storage: 'column', class: 'bracket', refused_why: 'the bracket has been SEEDED from this key' }
const refused: SettingPolicy = { storage: 'column', class: 'refused', refused_why: 'team_count is PRE-DRAFT ONLY' }

describe('inSeasonRefusal — 129’s copy VERBATIM, or null', () => {
  it('free and rescore are open in every status', () => {
    for (const status of ['in_season', 'playoffs', 'complete']) {
      expect(inSeasonRefusal(free, status)).toBeNull()
      expect(inSeasonRefusal(rescore, status)).toBeNull()
    }
  })

  it('refused is closed ALWAYS, with the row’s own words', () => {
    expect(inSeasonRefusal(refused, 'in_season')).toBe('team_count is PRE-DRAFT ONLY')
    expect(inSeasonRefusal(refused, 'drafting')).toBe('team_count is PRE-DRAFT ONLY')
  })

  it('bracket is open until the bracket exists — closed in `playoffs` and `complete` ONLY (D360(5))', () => {
    expect(inSeasonRefusal(bracket, 'in_season')).toBeNull()
    expect(inSeasonRefusal(bracket, 'drafting')).toBeNull()
    expect(inSeasonRefusal(bracket, 'playoffs')).toBe('the bracket has been SEEDED from this key')
    expect(inSeasonRefusal(bracket, 'complete')).toBe('the bracket has been SEEDED from this key')
  })

  it('a key with NO policy row is not pre-judged (the verb refuses an unknown key by name), and a refused row with no copy still says something', () => {
    expect(inSeasonRefusal(null, 'in_season')).toBeNull()
    expect(inSeasonRefusal(undefined, 'in_season')).toBeNull()
    expect(inSeasonRefusal({ ...refused, refused_why: null }, 'in_season')).toMatch(/cannot be changed in-season/)
  })
})

describe('settingPolicyKeys / inSeasonChangePlan — one working draft → ONE CALL PER CHANGED KEY', () => {
  const baseline = defaultsForTeamCount(10)
  const policies: SettingPolicies = Object.fromEntries(
    settingPolicyKeys(baseline).map((key) => [key, key === 'team_count' ? refused : key === 'playoff_teams' ? bracket : key === SCORING_SYSTEM_KEY ? rescore : free]),
  )
  const plan = (over: Partial<Parameters<typeof inSeasonChangePlan>[0]>) =>
    inSeasonChangePlan({ baseline, working: baseline, baselineScoringId: 'sys-a', scoringId: 'sys-a', policies, leagueStatus: 'in_season', ...over })

  it('the policy keys are the settings document’s own top-level keys + scoring_system_id', () => {
    const keys = settingPolicyKeys(baseline)
    expect(keys).toContain('waiver_period_hours')
    expect(keys).toContain('draft')
    expect(keys).toContain(SCORING_SYSTEM_KEY)
    expect(keys).toHaveLength(Object.keys(baseline).length + 1)
  })

  it('an untouched draft plans NOTHING', () => {
    expect(plan({})).toEqual({ send: [], refused: [] })
  })

  it('two changed keys are two calls, each carrying THAT key’s whole new value, in key order — never the whole document', () => {
    const working = { ...baseline, waiver_period_hours: 72, allow_illegal_lineups: !baseline.allow_illegal_lineups }
    expect(plan({ working }).send).toEqual([
      { key: 'allow_illegal_lineups', value: !baseline.allow_illegal_lineups },
      { key: 'waiver_period_hours', value: 72 },
    ])
  })

  it('a structured key (roster_settings) is sent WHOLE as one call; a null is a value', () => {
    const roster = { ...baseline.roster_settings, bench: (baseline.roster_settings as { bench: number }).bench + 1 }
    const out = plan({ working: { ...baseline, roster_settings: roster as typeof baseline.roster_settings, trade_deadline_week: null } })
    expect(out.send.map((c) => c.key)).toEqual(['roster_settings', 'trade_deadline_week'])
    expect(out.send[0].value).toEqual(roster)
    expect(out.send[1].value).toBeNull()
  })

  it('a changed REFUSED key is NEVER sent and NEVER dropped — it is listed with 129’s words', () => {
    const out = plan({ working: { ...baseline, team_count: 12, waiver_period_hours: 72 } })
    expect(out.send).toEqual([{ key: 'waiver_period_hours', value: 72 }])
    expect(out.refused).toEqual([{ key: 'team_count', why: 'team_count is PRE-DRAFT ONLY' }])
  })

  it('the BRACKET class follows the status: sent in_season, refused in playoffs', () => {
    const working = { ...baseline, playoff_teams: 4 as const }
    expect(plan({ working }).send).toEqual([{ key: 'playoff_teams', value: 4 }])
    expect(plan({ working, leagueStatus: 'playoffs' }).refused.map((r) => r.key)).toEqual(['playoff_teams'])
  })

  it('a changed scoring reference is its own call, LAST; an unchanged or null one is not', () => {
    expect(plan({ scoringId: 'sys-b' }).send).toEqual([{ key: SCORING_SYSTEM_KEY, value: 'sys-b' }])
    expect(plan({ scoringId: null }).send).toEqual([])
    const both = plan({ working: { ...baseline, waiver_period_hours: 72 }, scoringId: 'sys-b' })
    expect(both.send.map((c) => c.key)).toEqual(['waiver_period_hours', SCORING_SYSTEM_KEY])
  })
})

describe('settingOutcome — never a bare "Saved." (§4 rule 15 / R971); ORDER is the contract', () => {
  const doc = { key: 'scoring_system_id', no_changes: false, no_changes_why: null, rescore_not_performed_why: null, consequences: {} as unknown }

  it('no_changes never says "saved", and carries 129’s why (the rescore no-op’s own sentence when there is one)', () => {
    const plain = settingOutcome({ ...doc, no_changes: true, no_changes_why: 'value_already_set' })
    expect(plain.branch).toBe('no_changes')
    expect(plain.text).toContain('value_already_set')
    expect(plain.text).not.toMatch(/: saved/)
    const withRescore = settingOutcome({ ...doc, no_changes: true, no_changes_why: 'value_already_set', rescore_not_performed_why: 'no_changes — the scoring reference is already this system' })
    expect(withRescore.branch).toBe('no_changes')
    expect(withRescore.text).toContain('the scoring reference is already this system')
  })

  it('`rescore_not_performed_why` is FIRST among the success arms — ahead of score_stale, which the same document also carries (D360(7))', () => {
    const why = 'not_requested — rescore was not asked for: 0 final week(s) [] keep their stored scores'
    const said = settingOutcome({ ...doc, rescore_not_performed_why: why, consequences: { score_stale: true, score_stale_reason: 'snapshot_changed_without_rescore' } })
    expect(said.branch).toBe('rescore_not_performed')
    expect(said.tone).toBe('caution')
    expect(said.text).toContain(why)
  })

  it('then a MIXED open week, un-refit lineups (the MEASURED count), and balances a budget change did not touch', () => {
    expect(settingOutcome({ ...doc, consequences: { score_stale: true, score_stale_reason: 'snapshot_changed_without_rescore' } }).branch).toBe('score_stale')
    const refit = settingOutcome({ ...doc, key: 'roster_settings', consequences: { lineups_not_refit: 3 } })
    expect(refit.branch).toBe('lineups_not_refit')
    expect(refit.text).toContain('3 lineups')
    expect(settingOutcome({ ...doc, key: 'roster_settings', consequences: { lineups_not_refit: 0 } }).branch).toBe('saved')
    const faab = settingOutcome({ ...doc, key: 'faab_budget', consequences: { faab_seats_off_budget: 2 } })
    expect(faab.branch).toBe('faab_not_reseeded')
    expect(faab.text).toContain('balances were NOT changed')
  })

  it('a clean save names the key in words and says it was recorded and posted', () => {
    expect(settingOutcome({ ...doc, key: 'waiver_period_hours' })).toEqual({
      branch: 'saved',
      tone: 'positive',
      text: 'waiver period hours: saved — recorded and posted to the league.',
    })
  })
})
