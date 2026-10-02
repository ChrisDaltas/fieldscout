/**
 * Static demo content for the public landing page (Claude Design
 * "FieldScout Landing v13" and its ScoutAIDemo / LineupDemo / StatsTableDemo
 * files). Illustrative marketing copy, NOT live data — nothing here is read
 * from or written to the database.
 */

export type Pos = 'QB' | 'RB' | 'WR' | 'TE'

export const TICKER_POSITIONS: Pos[] = ['QB', 'RB', 'WR', 'TE']

export const POSITION_LABELS: Record<Pos, string> = {
  QB: 'Quarterbacks',
  RB: 'Running backs',
  WR: 'Wide receivers',
  TE: 'Tight ends',
}

const GAMES_WEEK_4: [string, string][] = [
  ['NO', 'BUF'], ['BAL', 'KC'], ['PHI', 'TB'], ['WAS', 'ATL'], ['CIN', 'DEN'], ['CAR', 'NE'],
  ['DET', 'CLE'], ['SF', 'JAX'], ['IND', 'LAR'], ['CHI', 'LV'], ['GB', 'DAL'], ['PIT', 'MIN'],
  ['LAC', 'NYG'], ['MIA', 'NYJ'], ['SEA', 'ARI'], ['HOU', 'TEN'],
]
const OPPONENT: Record<string, string> = {}
for (const [away, home] of GAMES_WEEK_4) {
  OPPONENT[away] = `@ ${home}`
  OPPONENT[home] = `vs ${away}`
}

const TICKER_NAMES: Record<Pos, [string, string][]> = {
  QB: [['Josh Allen','BUF'],['Lamar Jackson','BAL'],['Jalen Hurts','PHI'],['Jayden Daniels','WAS'],['Joe Burrow','CIN'],['Patrick Mahomes','KC'],['Drake Maye','NE'],['Baker Mayfield','TB'],['Kyler Murray','ARI'],['Jared Goff','DET'],['Caleb Williams','CHI'],['Justin Herbert','LAC'],['Brock Purdy','SF'],['Dak Prescott','DAL'],['Bo Nix','DEN'],['C.J. Stroud','HOU'],['Jordan Love','GB'],['Matthew Stafford','LAR'],['Trevor Lawrence','JAX'],['Tua Tagovailoa','MIA'],['J.J. McCarthy','MIN'],['Bryce Young','CAR'],['Michael Penix Jr.','ATL'],['Geno Smith','LV']],
  RB: [['Bijan Robinson','ATL'],['Jahmyr Gibbs','DET'],['Christian McCaffrey','SF'],['Saquon Barkley','PHI'],['Jonathan Taylor','IND'],['Derrick Henry','BAL'],['Ashton Jeanty','LV'],["De'Von Achane",'MIA'],['James Cook','BUF'],['Josh Jacobs','GB'],['Kyren Williams','LAR'],['Chase Brown','CIN'],['Bucky Irving','TB'],['Omarion Hampton','LAC'],['Breece Hall','NYJ'],['Alvin Kamara','NO'],['Kenneth Walker III','SEA'],['Chuba Hubbard','CAR'],['James Conner','ARI'],["D'Andre Swift",'CHI'],['Jaylen Warren','PIT'],['Javonte Williams','DAL'],['Travis Etienne Jr.','JAX'],['Tony Pollard','TEN']],
  WR: [["Ja'Marr Chase",'CIN'],['Puka Nacua','LAR'],['Justin Jefferson','MIN'],['CeeDee Lamb','DAL'],['Amon-Ra St. Brown','DET'],['Malik Nabers','NYG'],['Nico Collins','HOU'],['Brian Thomas Jr.','JAX'],['A.J. Brown','PHI'],['Drake London','ATL'],['Jaxon Smith-Njigba','SEA'],['Garrett Wilson','NYJ'],['Tee Higgins','CIN'],['Ladd McConkey','LAC'],['Tyreek Hill','MIA'],['Mike Evans','TB'],['Terry McLaurin','WAS'],['Davante Adams','LAR'],['DK Metcalf','PIT'],['Marvin Harrison Jr.','ARI'],['Jaylen Waddle','MIA'],['Zay Flowers','BAL'],['DJ Moore','CHI'],['Xavier Worthy','KC']],
  TE: [['Brock Bowers','LV'],['Trey McBride','ARI'],['George Kittle','SF'],['Sam LaPorta','DET'],['Travis Kelce','KC'],['Tucker Kraft','GB'],['Mark Andrews','BAL'],['T.J. Hockenson','MIN'],['Tyler Warren','IND'],['Dalton Kincaid','BUF'],['David Njoku','CLE'],['Evan Engram','DEN'],['Jake Ferguson','DAL'],['Hunter Henry','NE'],['Kyle Pitts','ATL'],['Dallas Goedert','PHI'],['Jonnu Smith','PIT'],['Colston Loveland','CHI'],['Cade Otton','TB'],['Brenton Strange','JAX'],['Mason Taylor','NYJ'],['Dalton Schultz','HOU'],['Zach Ertz','WAS'],['Isaiah Likely','BAL']],
}
const TOP_PROJ: Record<Pos, number> = { QB: 25.0, RB: 20.8, WR: 19.9, TE: 13.4 }
const PROJ_DROP: Record<Pos, number> = { QB: 0.36, RB: 0.42, WR: 0.4, TE: 0.27 }

export interface TickerItem {
  code: string
  name: string
  opp: string
  proj: string
}

export function tickerItems(pos: Pos): TickerItem[] {
  return TICKER_NAMES[pos].map(([name, team], i) => ({
    code: `${pos}.${i + 1}`,
    name,
    opp: `${team} ${OPPONENT[team] ?? ''}`.trim(),
    proj: (TOP_PROJ[pos] - i * PROJ_DROP[pos] - (i % 3) * 0.05).toFixed(1),
  }))
}

/* ---- Scout AI demo ---- */

export interface DemoScript {
  prompt: string
  typeMs: number
  stepMs: number
  holdMs: number
  steps: [text: string, detail: string][]
}

export const FIND_SCRIPT: DemoScript = {
  prompt: 'List of available WRs with the most targets through Week 3',
  typeMs: 2600,
  stepMs: 800,
  holdMs: 7500,
  steps: [
    ['Finding WRs available in your league', '41 on waivers'],
    ['Counting targets, Weeks 1–3', 'Play-by-play'],
    ['Adding target share and roster %', ''],
    ['Sorting by total targets', ''],
  ],
}

export const SIT_SCRIPT: DemoScript = {
  prompt: 'Start Jaylen Waddle or Jakobi Meyers this week?',
  typeMs: 2300,
  stepMs: 1050,
  holdMs: 7500,
  steps: [
    ['Checking Vegas over/under for MIA @ LV', 'O/U 46.5 · MIA 25.3 implied'],
    ['Checking defensive matchups', 'LV allows 3rd-most WR pts'],
    ['Looking at historical performance', 'Waddle 5 of last 7 over 12 pts'],
    ['Pulling target share and air yards', '26% vs 19%'],
    ['Checking injury reports and practice', 'Both full participants'],
    ['Checking weather at kickoff', 'Dome · no impact'],
  ],
}

export const LINEUP_SCRIPT: DemoScript = {
  prompt: 'Swap J. Addison for Justin Jefferson in my lineup if Jefferson is ruled out',
  typeMs: 3000,
  stepMs: 1000,
  holdMs: 7500,
  steps: [
    ['Finding Justin Jefferson in your lineup', 'WR · MIN'],
    ['Checking Jordan Addison on your bench', 'Bench · MIN'],
    ['Watching the Week 4 injury report', 'Jefferson: Questionable'],
    ['Setting the swap for inactives', 'Sun 11:30 AM ET'],
  ],
}

export const FIND_RESULTS: { name: string; team: string; tgt: number; share: string; rost: string }[] = [
  { name: "Wan'Dale Robinson", team: 'NYG', tgt: 29, share: '27%', rost: '38%' },
  { name: 'Jalen Coker', team: 'CAR', tgt: 26, share: '24%', rost: '22%' },
  { name: 'Romeo Doubs', team: 'GB', tgt: 24, share: '23%', rost: '41%' },
  { name: 'Kayshon Boutte', team: 'NE', tgt: 22, share: '21%', rost: '18%' },
  { name: 'Tre Tucker', team: 'LV', tgt: 21, share: '20%', rost: '15%' },
  { name: 'Troy Franklin', team: 'DEN', tgt: 20, share: '19%', rost: '24%' },
]

export const SIT_FACTORS = ['Vegas', 'Matchup', 'History', 'Usage', 'Health', 'Weather']

export const LINEUP_ROSTER: {
  slot: Pos | 'BN'
  name: string
  team: string
  proj: string
  questionable?: boolean
  tag?: string
}[] = [
  { slot: 'QB', name: 'Jalen Hurts', team: 'PHI', proj: '21.4' },
  { slot: 'RB', name: 'Bijan Robinson', team: 'ATL', proj: '19.8' },
  { slot: 'WR', name: 'Justin Jefferson', team: 'MIN', proj: '16.9', questionable: true, tag: 'Auto-swap armed' },
  { slot: 'WR', name: 'Jaylen Waddle', team: 'MIA', proj: '14.8' },
  { slot: 'TE', name: 'Brock Bowers', team: 'LV', proj: '13.2' },
  { slot: 'BN', name: 'Jordan Addison', team: 'MIN', proj: '11.6', tag: 'Ready to swap in' },
]

/* ---- Stats table demo ---- */

export type StatKey =
  | 'tgt' | 'share' | 'tprr' | 'air' | 'snap' | 'route'
  | 'adot' | 'yprr' | 'catch' | 'yac' | 'rz' | 'fpg'

const pct = (v: number) => `${v}%`
const one = (v: number) => v.toFixed(1)
const two = (v: number) => v.toFixed(2)
const int = (v: number) => String(v)

export const STAT_COLUMNS: { key: StatKey; label: string; group: string; fmt: (v: number) => string }[] = [
  { key: 'tgt', label: 'Targets', group: 'Usage', fmt: int },
  { key: 'share', label: 'Tgt %', group: 'Usage', fmt: pct },
  { key: 'tprr', label: 'TPRR', group: 'Usage', fmt: two },
  { key: 'air', label: 'Air yds %', group: 'Usage', fmt: pct },
  { key: 'snap', label: 'Snap %', group: 'Usage', fmt: pct },
  { key: 'route', label: 'Route %', group: 'Usage', fmt: pct },
  { key: 'adot', label: 'aDOT', group: 'Efficiency', fmt: one },
  { key: 'yprr', label: 'YPRR', group: 'Efficiency', fmt: two },
  { key: 'catch', label: 'Catch %', group: 'Efficiency', fmt: pct },
  { key: 'yac', label: 'YAC/rec', group: 'Efficiency', fmt: one },
  { key: 'rz', label: 'RZ tgts', group: 'Scoring', fmt: int },
  { key: 'fpg', label: 'FP/G', group: 'Scoring', fmt: one },
]

// Values in STAT_COLUMNS order.
export const STAT_ROWS: { name: string; team: string; v: number[] }[] = [
  { name: "Ja'Marr Chase", team: 'CIN', v: [34, 31, 0.29, 38, 94, 97, 10.8, 2.84, 71, 5.9, 6, 22.4] },
  { name: 'Puka Nacua', team: 'LAR', v: [33, 31, 0.31, 33, 92, 95, 8.9, 3.02, 76, 5.2, 5, 21.7] },
  { name: 'Justin Jefferson', team: 'MIN', v: [30, 29, 0.27, 41, 96, 98, 12.6, 2.71, 67, 4.8, 4, 19.8] },
  { name: 'CeeDee Lamb', team: 'DAL', v: [31, 28, 0.27, 36, 93, 96, 11.2, 2.48, 68, 5.6, 5, 18.6] },
  { name: 'Amon-Ra St. Brown', team: 'DET', v: [29, 27, 0.28, 27, 91, 94, 7.4, 2.66, 79, 5.1, 7, 19.1] },
  { name: 'Malik Nabers', team: 'NYG', v: [35, 30, 0.3, 39, 95, 97, 11.9, 2.39, 63, 4.4, 3, 17.9] },
  { name: 'Nico Collins', team: 'HOU', v: [27, 26, 0.26, 37, 89, 93, 13.1, 2.77, 70, 4.9, 4, 18.2] },
  { name: 'Brian Thomas Jr.', team: 'JAX', v: [25, 24, 0.24, 40, 90, 94, 14.8, 2.35, 60, 5.3, 2, 16.4] },
  { name: 'Jaxon Smith-Njigba', team: 'SEA', v: [28, 27, 0.27, 30, 88, 92, 9.1, 2.58, 75, 5.0, 3, 16.9] },
  { name: 'Jaylen Waddle', team: 'MIA', v: [26, 26, 0.25, 29, 87, 91, 10.4, 2.21, 69, 5.4, 3, 15.3] },
]

export const STAT_BASE: StatKey[] = ['tgt', 'share', 'fpg']
export const STAT_ADDS: StatKey[] = ['tprr', 'air', 'snap', 'route', 'adot', 'yprr', 'rz']
