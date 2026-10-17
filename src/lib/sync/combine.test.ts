/**
 * combine.test.ts — the 40-time match (F578 / D540). Pure — no network, no
 * database. Header shapes are the real files' (columns trimmed).
 */
import { describe, expect, it } from 'vitest'

import { buildFortyMap } from './combine'

const IDS = [
  'mfl_id,sleeper_id,espn_id,pfr_id,name',
  '1,4046,111,MahoPa00,Patrick Mahomes',
  '2,9509,222,RobiBi01,Bijan Robinson',
  '3,7000,333,DupeAa00,Two Ids', // listed twice with DIFFERENT pfr ids → ambiguous
  '4,7000,334,DupeAa01,Two Ids',
  '5,8000,NA,NA,No pfr id',
  '6,NA,555,NoSlee00,No sleeper id',
  '7,9000,666,TwoFor00,Two forties', // pfr id with two different Combine times → ambiguous
  '8,9100,777,NoRun00,Did not run',
].join('\n')

const COMBINE = [
  'season,draft_year,pfr_id,player_name,pos,forty',
  '2017,2017,MahoPa00,Patrick Mahomes,QB,4.80',
  '2023,2023,RobiBi01,Bijan Robinson,RB,4.46',
  '2016,2016,TwoFor00,Two Forties,WR,4.40',
  '2017,2017,TwoFor00,Two Forties,WR,4.52',
  '2020,2020,NoRun00,Did Not Run,TE,',
  '2019,2019,Typo00,Typo,WR,44.5',
].join('\n')

describe('buildFortyMap — matched through the id crosswalk only, never by name', () => {
  it('maps Sleeper id → forty (stored literals)', () => {
    const m = buildFortyMap(IDS, COMBINE)
    expect(Object.fromEntries(m.bySleeperId)).toEqual({ '4046': 4.8, '9509': 4.46 })
  })
  it('names the ambiguous ids and leaves them without a time; blanks and NA are no match', () => {
    const m = buildFortyMap(IDS, COMBINE)
    expect(m.ambiguous).toEqual(['7000', '9000'])
    expect(m.bySleeperId.has('8000')).toBe(false)
    expect(m.bySleeperId.has('9100')).toBe(false)
  })
  it('a renamed column refuses loudly', () => {
    expect(() => buildFortyMap(IDS.replace('sleeper_id', 'sleeperid'), COMBINE)).toThrow(/sleeper_id/)
    expect(() => buildFortyMap(IDS, COMBINE.replace('forty', 'dash'))).toThrow(/forty/)
  })
})
