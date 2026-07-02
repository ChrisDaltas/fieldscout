/**
 * Static metadata for the 32 NFL teams, keyed by the same Sleeper-style
 * abbreviations used in `players.team` and `nfl-team-colors.ts`.
 */

export type NflConference = 'AFC' | 'NFC'
export type NflDivision = 'East' | 'North' | 'South' | 'West'

export interface NflTeamInfo {
  abbr: string
  city: string
  name: string
  conference: NflConference
  division: NflDivision
}

const team = (
  abbr: string,
  city: string,
  name: string,
  conference: NflConference,
  division: NflDivision,
): NflTeamInfo => ({ abbr, city, name, conference, division })

export const NFL_TEAMS: Record<string, NflTeamInfo> = {
  // AFC East
  BUF: team('BUF', 'Buffalo', 'Bills', 'AFC', 'East'),
  MIA: team('MIA', 'Miami', 'Dolphins', 'AFC', 'East'),
  NE: team('NE', 'New England', 'Patriots', 'AFC', 'East'),
  NYJ: team('NYJ', 'New York', 'Jets', 'AFC', 'East'),

  // AFC North
  BAL: team('BAL', 'Baltimore', 'Ravens', 'AFC', 'North'),
  CIN: team('CIN', 'Cincinnati', 'Bengals', 'AFC', 'North'),
  CLE: team('CLE', 'Cleveland', 'Browns', 'AFC', 'North'),
  PIT: team('PIT', 'Pittsburgh', 'Steelers', 'AFC', 'North'),

  // AFC South
  HOU: team('HOU', 'Houston', 'Texans', 'AFC', 'South'),
  IND: team('IND', 'Indianapolis', 'Colts', 'AFC', 'South'),
  JAX: team('JAX', 'Jacksonville', 'Jaguars', 'AFC', 'South'),
  TEN: team('TEN', 'Tennessee', 'Titans', 'AFC', 'South'),

  // AFC West
  DEN: team('DEN', 'Denver', 'Broncos', 'AFC', 'West'),
  KC: team('KC', 'Kansas City', 'Chiefs', 'AFC', 'West'),
  LV: team('LV', 'Las Vegas', 'Raiders', 'AFC', 'West'),
  LAC: team('LAC', 'Los Angeles', 'Chargers', 'AFC', 'West'),

  // NFC East
  DAL: team('DAL', 'Dallas', 'Cowboys', 'NFC', 'East'),
  NYG: team('NYG', 'New York', 'Giants', 'NFC', 'East'),
  PHI: team('PHI', 'Philadelphia', 'Eagles', 'NFC', 'East'),
  WAS: team('WAS', 'Washington', 'Commanders', 'NFC', 'East'),

  // NFC North
  CHI: team('CHI', 'Chicago', 'Bears', 'NFC', 'North'),
  DET: team('DET', 'Detroit', 'Lions', 'NFC', 'North'),
  GB: team('GB', 'Green Bay', 'Packers', 'NFC', 'North'),
  MIN: team('MIN', 'Minnesota', 'Vikings', 'NFC', 'North'),

  // NFC South
  ATL: team('ATL', 'Atlanta', 'Falcons', 'NFC', 'South'),
  CAR: team('CAR', 'Carolina', 'Panthers', 'NFC', 'South'),
  NO: team('NO', 'New Orleans', 'Saints', 'NFC', 'South'),
  TB: team('TB', 'Tampa Bay', 'Buccaneers', 'NFC', 'South'),

  // NFC West
  ARI: team('ARI', 'Arizona', 'Cardinals', 'NFC', 'West'),
  LAR: team('LAR', 'Los Angeles', 'Rams', 'NFC', 'West'),
  SF: team('SF', 'San Francisco', '49ers', 'NFC', 'West'),
  SEA: team('SEA', 'Seattle', 'Seahawks', 'NFC', 'West'),
}

export function getNflTeam(abbr: string | null | undefined): NflTeamInfo | null {
  if (!abbr) return null
  return NFL_TEAMS[abbr.toUpperCase()] ?? null
}

export const NFL_DIVISIONS: { conference: NflConference; division: NflDivision }[] = [
  { conference: 'AFC', division: 'East' },
  { conference: 'AFC', division: 'North' },
  { conference: 'AFC', division: 'South' },
  { conference: 'AFC', division: 'West' },
  { conference: 'NFC', division: 'East' },
  { conference: 'NFC', division: 'North' },
  { conference: 'NFC', division: 'South' },
  { conference: 'NFC', division: 'West' },
]

export function teamsInDivision(
  conference: NflConference,
  division: NflDivision,
): NflTeamInfo[] {
  return Object.values(NFL_TEAMS)
    .filter((t) => t.conference === conference && t.division === division)
    .sort((a, b) => a.abbr.localeCompare(b.abbr))
}
