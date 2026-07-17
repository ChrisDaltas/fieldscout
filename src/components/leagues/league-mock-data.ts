/**
 * League workspace mock data.
 *
 * The league backend does NOT exist yet — every surface under /app/leagues
 * renders from this module so the layout is real while the data is
 * preview-only. Shapes mirror the redesign package's `platform.js` /
 * `teams.js` / `data.js` so live data can slot in without markup changes.
 *
 * TODO(live-draft): replace with real data when the league backend lands.
 */

/** One league membership (mirrors `platform.js` → `leagues`). */
export interface MockLeague {
  id: string
  name: string
  /** Your team in this league. */
  team: string
  /** "PPR · 12 team" — scoring first, ` · `-separated. */
  format: string
  record: string
  rank: number
  pf: number
  pa: number
  /** Your projected total this week. */
  proj: number
  oppProj: number
  /** This week's opponent (team name). */
  opp: string
  /** Playoff odds, 0–100. */
  playoff: number
  /** Your win probability this week, 0–100. */
  winProb: number
  /** True while this league has a draft running (drives the draft-room link). */
  liveDraft?: boolean
}

/** A team in a league (mirrors `data.js` → `leagueTeams`). */
export interface MockLeagueTeam {
  team: string
  manager: string
  w: number
  l: number
  pf: number
}

/** One side of a weekly matchup (mirrors `data.js` → `matchups`). */
export interface MockMatchupSide {
  team: string
  manager: string
  proj: number
  yetToPlay: number
}

export interface MockMatchup {
  home: MockMatchupSide
  away: MockMatchupSide
  /** Home team's win probability, 0–100. */
  winProb: number
}

/** A week on your schedule (mirrors `TeamView.jsx` → `SCHEDULE`). */
export interface MockScheduleGame {
  week: number
  opp: string
  /** Final score line, e.g. "W 128.4–101.2". */
  result?: string
  win?: boolean
  live?: boolean
  /** Kickoff for future games, e.g. "Sun 1:00". */
  kickoff?: string
}

/** Message-board post (mirrors `TeamView.jsx` → `MESSAGES`). */
export interface MockBoardMessage {
  user: string
  text: string
  time: string
}

export type MockInjuryStatus = '' | 'Q' | 'O' | 'D'

/** A rostered player in a lineup slot (mirrors `data.js` → `lineup`). */
export interface MockLineupPlayer {
  slot: string
  name: string
  pos: string
  team: string
  /** "@MIA" / "vs CAR" */
  opp: string
  /** Kickoff, e.g. "Sun 1:00". */
  time: string
  proj: number
  /** Opponent positional rank (1 = toughest matchup). */
  oprk: number
  status: MockInjuryStatus
}

export interface MockLineup {
  starters: MockLineupPlayer[]
  bench: MockLineupPlayer[]
  ir: MockLineupPlayer | null
  dl: MockLineupPlayer | null
}

/** Free agent row (mirrors `platform.js` → `waivers`). */
export interface MockFreeAgent {
  name: string
  pos: string
  team: string
  /** Rostered %, 0–100. */
  rostered: number
  /** Adds this week, %. */
  add: number
  /** Average winning FAAB bid. */
  faab: string
}

/** Head-to-head record vs one opponent (mirrors `TeamView.jsx` → `H2H`). */
export interface MockH2HRecord {
  team: string
  w: number
  l: number
  pf: number
  pa: number
  last: string
}

/** One team's season line (mirrors `TeamView.jsx` → `HISTORY`). */
export interface MockSeasonRow {
  team: string
  w: number
  l: number
  titles: number
  pf: number
}

export type MockSeasonKey = 'all' | '2026' | '2025' | '2024'

export interface MockStatRecord {
  label: string
  value: string
  sub: string
}

export interface MockWaiverSetting {
  label: string
  value: string
}

/** Roster slot definition (mirrors `data.js` → `rosterSlots`). */
export interface MockRosterSlot {
  label: string
  abbr: string
  count: number
}

/** Scoring rule group (mirrors `data.js` → `scoringGroups`). */
export interface MockScoringGroup {
  group: string
  items: Array<{ label: string; abbr: string; value: number }>
}

// ---------------------------------------------------------------------------
// Data — all values are illustrative preview numbers from the design package.
// TODO(live-draft): replace with real data.
// ---------------------------------------------------------------------------

// Preseason: no games have been played, so every league is 0–0 (tied for
// first). `proj`/`oppProj`/`opp`/`winProb` preview the Week 1 matchup —
// projections are legitimate preseason content, unlike a record or a result.
export const MOCK_LEAGUES: MockLeague[] = [
  {
    id: 'log',
    name: 'League of Ordinary Gentlemen',
    team: 'Gridiron Gurus',
    format: 'PPR · 12 team',
    record: '0–0',
    rank: 1,
    pf: 0,
    pa: 0,
    proj: 132.4,
    oppProj: 118.9,
    opp: 'The Audibles',
    playoff: 96,
    winProb: 71,
  },
  {
    id: 'din',
    name: 'Dynasty Degenerates',
    team: 'Check Downs',
    format: 'Half-PPR · 12 team · Dynasty',
    record: '0–0',
    rank: 1,
    pf: 0,
    pa: 0,
    proj: 121.0,
    oppProj: 127.6,
    opp: 'Air Raid',
    playoff: 64,
    winProb: 44,
  },
  {
    id: 'wrk',
    name: 'The Work League',
    team: 'Cubicle Kings',
    format: 'Standard · 12 team',
    record: '0–0',
    rank: 1,
    pf: 0,
    pa: 0,
    proj: 140.1,
    oppProj: 109.8,
    opp: 'Lambeau Leapers',
    playoff: 99,
    winProb: 78,
    liveDraft: true,
  },
]

// Preseason: every team in every league is 0–0/0 PF — no games played yet.
const MOCK_LEAGUE_TEAMS_BY_ID: Record<string, MockLeagueTeam[]> = {
  log: [
    { team: 'Gridiron Gurus', manager: 'You', w: 0, l: 0, pf: 0 },
    { team: 'Sunday Scaries', manager: 'Marcus W.', w: 0, l: 0, pf: 0 },
    { team: 'Air Raid', manager: 'Priya N.', w: 0, l: 0, pf: 0 },
    { team: 'Lambeau Leapers', manager: 'Devon K.', w: 0, l: 0, pf: 0 },
    { team: 'Check Downs', manager: 'Sara L.', w: 0, l: 0, pf: 0 },
    { team: 'The Audibles', manager: 'Tom R.', w: 0, l: 0, pf: 0 },
    { team: 'Pepperbox Farmers', manager: 'Alex T.', w: 0, l: 0, pf: 0 },
    { team: 'Cleveland Clowns', manager: 'Jordan M.', w: 0, l: 0, pf: 0 },
    { team: 'Mud Ducks', manager: 'Alexis F.', w: 0, l: 0, pf: 0 },
    { team: 'Hail Marys', manager: 'Nina P.', w: 0, l: 0, pf: 0 },
    { team: 'Bench Mob', manager: 'Omar S.', w: 0, l: 0, pf: 0 },
    { team: 'Waiver Wire Wizards', manager: 'Dana K.', w: 0, l: 0, pf: 0 },
  ],
  din: [
    { team: 'Check Downs', manager: 'You', w: 0, l: 0, pf: 0 },
    { team: 'Air Raid', manager: 'Priya N.', w: 0, l: 0, pf: 0 },
    { team: 'Trench Warfare', manager: 'Felix M.', w: 0, l: 0, pf: 0 },
    { team: 'Rookie Hoarders', manager: 'Gus B.', w: 0, l: 0, pf: 0 },
    { team: 'Draft Capital', manager: 'Lena K.', w: 0, l: 0, pf: 0 },
    { team: 'Taxi Squad', manager: 'Theo M.', w: 0, l: 0, pf: 0 },
    { team: 'Future Picks', manager: 'Ada V.', w: 0, l: 0, pf: 0 },
    { team: 'Window Closers', manager: 'Raj P.', w: 0, l: 0, pf: 0 },
    { team: 'The Long Game', manager: 'Mia D.', w: 0, l: 0, pf: 0 },
    { team: 'Devy Devils', manager: 'Cole R.', w: 0, l: 0, pf: 0 },
    { team: 'Pick Flippers', manager: 'Ivy S.', w: 0, l: 0, pf: 0 },
    { team: 'Churn and Burn', manager: 'Ben W.', w: 0, l: 0, pf: 0 },
  ],
  wrk: [
    { team: 'Cubicle Kings', manager: 'You', w: 0, l: 0, pf: 0 },
    { team: 'Lambeau Leapers', manager: 'Drew F.', w: 0, l: 0, pf: 0 },
    { team: 'Spreadsheet FC', manager: 'Rosa T.', w: 0, l: 0, pf: 0 },
    { team: 'Reply All', manager: 'Quinn H.', w: 0, l: 0, pf: 0 },
    { team: 'Sync Meeting', manager: 'Sofia G.', w: 0, l: 0, pf: 0 },
    { team: 'The Deliverables', manager: 'Max C.', w: 0, l: 0, pf: 0 },
    { team: 'Stand Up Stars', manager: 'Noor A.', w: 0, l: 0, pf: 0 },
    { team: 'Ping Me Later', manager: 'Jack O.', w: 0, l: 0, pf: 0 },
    { team: 'Out of Office', manager: 'Tara L.', w: 0, l: 0, pf: 0 },
    { team: 'Circle Back', manager: 'Eli N.', w: 0, l: 0, pf: 0 },
    { team: 'Q4 Crunch', manager: 'Zoe M.', w: 0, l: 0, pf: 0 },
    { team: 'The Interns', manager: 'Sam Y.', w: 0, l: 0, pf: 0 },
  ],
}

// The tabs below (matchups, schedule, lineup, board, stats, settings) are
// scoped to the demo "log" league and reused for every mock league.
// TODO(live-draft): scope per league once the backend exists.

// Preseason: no games have started, so every side has its full lineup left
// to play (yetToPlay always equals the 9-man starting lineup).
export const MOCK_MATCHUPS: MockMatchup[] = [
  {
    home: { team: 'Gridiron Gurus', manager: 'You', proj: 132.4, yetToPlay: 9 },
    away: { team: 'The Audibles', manager: 'Tom R.', proj: 118.9, yetToPlay: 9 },
    winProb: 71,
  },
  {
    home: { team: 'Sunday Scaries', manager: 'Marcus W.', proj: 121.2, yetToPlay: 9 },
    away: { team: 'Check Downs', manager: 'Sara L.', proj: 127.6, yetToPlay: 9 },
    winProb: 44,
  },
  {
    home: { team: 'Air Raid', manager: 'Priya N.', proj: 140.1, yetToPlay: 9 },
    away: { team: 'Lambeau Leapers', manager: 'Devon K.', proj: 109.8, yetToPlay: 9 },
    winProb: 78,
  },
  {
    home: { team: 'Pepperbox Farmers', manager: 'Alex T.', proj: 99.8, yetToPlay: 9 },
    away: { team: 'Cleveland Clowns', manager: 'Jordan M.', proj: 112.4, yetToPlay: 9 },
    winProb: 39,
  },
]

// Preseason: nothing has been played, so no week has a result or is live —
// every week is an upcoming kickoff.
export const MOCK_SCHEDULE: MockScheduleGame[] = [
  { week: 1, opp: 'The Audibles', kickoff: 'Sun 1:00' },
  { week: 2, opp: 'Sunday Scaries', kickoff: 'Sun 1:00' },
  { week: 3, opp: 'Check Downs', kickoff: 'Sun 4:05' },
  { week: 4, opp: 'Air Raid', kickoff: 'Sun 1:00' },
  { week: 5, opp: 'Lambeau Leapers', kickoff: 'Sun 4:25' },
  { week: 6, opp: 'Pepperbox Farmers', kickoff: 'Sun 1:00' },
  { week: 7, opp: 'Cleveland Clowns', kickoff: 'Sun 1:00' },
  { week: 8, opp: 'Mud Ducks', kickoff: 'Mon 8:15' },
  { week: 9, opp: 'Hail Marys', kickoff: 'Sun 1:00' },
  { week: 10, opp: 'Bench Mob', kickoff: 'Sun 4:05' },
  { week: 11, opp: 'The Audibles', kickoff: 'Sun 1:00' },
  { week: 12, opp: 'Sunday Scaries', kickoff: 'Sun 1:00' },
  { week: 13, opp: 'Air Raid', kickoff: 'Sun 4:25' },
  { week: 14, opp: 'Waiver Wire Wizards', kickoff: 'Sun 1:00' },
  { week: 15, opp: 'Lambeau Leapers', kickoff: 'Sun 4:05' },
  { week: 16, opp: 'Pepperbox Farmers', kickoff: 'Sun 1:00' },
  { week: 17, opp: 'Cleveland Clowns', kickoff: 'Sun 1:00' },
  { week: 18, opp: 'Mud Ducks', kickoff: 'Sun 1:00' },
]

export const MOCK_MESSAGES: MockBoardMessage[] = [
  { user: 'Marcus W.', text: 'Trade deadline is Friday — get your offers in.', time: '2h' },
  { user: 'Priya N.', text: 'Anyone thin at TE? I have two and need RB depth.', time: '4h' },
  { user: 'Devon K.', text: 'That Monday-night comeback was criminal.', time: '1d' },
  { user: 'Sara L.', text: 'Reminder: playoffs seed on record, then PF.', time: '2d' },
]

export const MOCK_LINEUP: MockLineup = {
  starters: [
    { slot: 'QB', name: 'Josh Allen', pos: 'QB', team: 'BUF', opp: '@MIA', time: 'Sun 1:00', proj: 24.6, oprk: 27, status: '' },
    { slot: 'RB', name: 'Christian McCaffrey', pos: 'RB', team: 'SF', opp: 'vs CAR', time: 'Sun 4:05', proj: 22.1, oprk: 30, status: '' },
    { slot: 'RB', name: 'Saquon Barkley', pos: 'RB', team: 'PHI', opp: 'vs NYG', time: 'Sun 1:00', proj: 18.1, oprk: 24, status: '' },
    { slot: 'WR', name: 'CeeDee Lamb', pos: 'WR', team: 'DAL', opp: 'vs WAS', time: 'Sun 1:00', proj: 20.8, oprk: 28, status: '' },
    { slot: 'WR', name: 'Garrett Wilson', pos: 'WR', team: 'NYJ', opp: 'vs SF', time: 'Sun 4:25', proj: 16.8, oprk: 5, status: 'Q' },
    { slot: 'TE', name: 'Sam LaPorta', pos: 'TE', team: 'DET', opp: '@CHI', time: 'Sun 1:00', proj: 14.2, oprk: 29, status: '' },
    { slot: 'FLEX', name: 'Jahmyr Gibbs', pos: 'RB', team: 'DET', opp: '@CHI', time: 'Sun 1:00', proj: 17.6, oprk: 21, status: '' },
    { slot: 'D/ST', name: 'Eagles D/ST', pos: 'DEF', team: 'PHI', opp: 'vs NYG', time: 'Sun 1:00', proj: 8.4, oprk: 18, status: '' },
    { slot: 'K', name: 'Jake Elliott', pos: 'K', team: 'PHI', opp: 'vs NYG', time: 'Sun 1:00', proj: 9.1, oprk: 14, status: '' },
  ],
  bench: [
    { slot: 'BE', name: 'Mike Evans', pos: 'WR', team: 'TB', opp: '@ATL', time: 'Sun 1:00', proj: 16.2, oprk: 25, status: '' },
    { slot: 'BE', name: 'Derrick Henry', pos: 'RB', team: 'BAL', opp: '@CLE', time: 'Sun 1:00', proj: 16.9, oprk: 20, status: '' },
    { slot: 'BE', name: 'Travis Kelce', pos: 'TE', team: 'KC', opp: 'vs CIN', time: 'Sun 4:25', proj: 13.4, oprk: 12, status: '' },
    { slot: 'BE', name: 'Jaylen Waddle', pos: 'WR', team: 'MIA', opp: 'vs BUF', time: 'Sun 1:00', proj: 12.1, oprk: 16, status: 'O' },
    { slot: 'BE', name: 'Tony Pollard', pos: 'RB', team: 'TEN', opp: 'vs JAX', time: 'Sun 1:00', proj: 11.3, oprk: 22, status: '' },
  ],
  ir: null,
  dl: null,
}

/** Opponent starters, slot-aligned with `MOCK_LINEUP.starters` (Matchup tab). */
export const MOCK_OPP_STARTERS: MockLineupPlayer[] = [
  { slot: 'QB', name: 'Lamar Jackson', pos: 'QB', team: 'BAL', opp: '@CLE', time: 'Sun 1:00', proj: 20.4, oprk: 22, status: '' },
  { slot: 'RB', name: 'Bijan Robinson', pos: 'RB', team: 'ATL', opp: 'vs TB', time: 'Sun 1:00', proj: 16.8, oprk: 19, status: '' },
  { slot: 'RB', name: 'Breece Hall', pos: 'RB', team: 'NYJ', opp: 'vs SF', time: 'Sun 4:25', proj: 12.2, oprk: 9, status: '' },
  { slot: 'WR', name: 'Justin Jefferson', pos: 'WR', team: 'MIN', opp: 'vs GB', time: 'Sun 1:00', proj: 16.9, oprk: 23, status: '' },
  { slot: 'WR', name: 'A.J. Brown', pos: 'WR', team: 'PHI', opp: 'vs NYG', time: 'Sun 1:00', proj: 14.1, oprk: 26, status: '' },
  { slot: 'TE', name: 'George Kittle', pos: 'TE', team: 'SF', opp: 'vs CAR', time: 'Sun 4:05', proj: 9.8, oprk: 17, status: '' },
  { slot: 'FLEX', name: "De'Von Achane", pos: 'RB', team: 'MIA', opp: 'vs BUF', time: 'Sun 1:00', proj: 11.6, oprk: 13, status: 'Q' },
  { slot: 'D/ST', name: 'Ravens D/ST', pos: 'DEF', team: 'BAL', opp: '@CLE', time: 'Sun 1:00', proj: 7.4, oprk: 15, status: '' },
  { slot: 'K', name: 'Brandon Aubrey', pos: 'K', team: 'DAL', opp: 'vs WAS', time: 'Sun 1:00', proj: 9.7, oprk: 11, status: '' },
]

export const MOCK_FREE_AGENTS: MockFreeAgent[] = [
  { name: 'Jaylen Warren', pos: 'RB', team: 'PIT', rostered: 48, add: 31, faab: '18%' },
  { name: 'Demario Douglas', pos: 'WR', team: 'NE', rostered: 39, add: 24, faab: '9%' },
  { name: 'Cade Otton', pos: 'TE', team: 'TB', rostered: 55, add: 22, faab: '12%' },
  { name: 'Tyjae Spears', pos: 'RB', team: 'TEN', rostered: 61, add: 18, faab: '15%' },
  { name: 'Jalen McMillan', pos: 'WR', team: 'TB', rostered: 20, add: 16, faab: '6%' },
  { name: 'Cameron Dicker', pos: 'K', team: 'LAC', rostered: 44, add: 12, faab: '4%' },
  { name: 'Broncos D/ST', pos: 'DEF', team: 'DEN', rostered: 38, add: 9, faab: '3%' },
]

export const MOCK_H2H: MockH2HRecord[] = [
  { team: 'The Audibles', w: 5, l: 1, pf: 742.1, pa: 668.9, last: 'W 128.4–101.2' },
  { team: 'Sunday Scaries', w: 4, l: 2, pf: 731.6, pa: 702.3, last: 'W 134.0–121.7' },
  { team: 'Check Downs', w: 2, l: 4, pf: 655.0, pa: 690.8, last: 'L 109.2–117.5' },
  { team: 'Air Raid', w: 3, l: 3, pf: 700.2, pa: 693.4, last: 'W 162.4–140.8' },
  { team: 'Lambeau Leapers', w: 5, l: 1, pf: 748.8, pa: 641.2, last: 'W 121.9–98.3' },
  { team: 'Pepperbox Farmers', w: 3, l: 3, pf: 684.5, pa: 671.0, last: 'L 84.1–102.6' },
]

export const MOCK_HISTORY: Record<MockSeasonKey, MockSeasonRow[]> = {
  all: [
    { team: 'Gridiron Gurus', w: 38, l: 18, titles: 2, pf: 5210 },
    { team: 'Check Downs', w: 35, l: 21, titles: 1, pf: 5044 },
    { team: 'Sunday Scaries', w: 33, l: 23, titles: 1, pf: 4988 },
    { team: 'Air Raid', w: 30, l: 26, titles: 0, pf: 4879 },
    { team: 'Lambeau Leapers', w: 26, l: 30, titles: 0, pf: 4551 },
    { team: 'The Audibles', w: 24, l: 32, titles: 0, pf: 4402 },
    { team: 'Pepperbox Farmers', w: 10, l: 46, titles: 0, pf: 3910 },
  ],
  // Preseason: the 2026 season hasn't started, so every team is 0–0/0 PF.
  '2026': [
    { team: 'Gridiron Gurus', w: 0, l: 0, titles: 0, pf: 0 },
    { team: 'Sunday Scaries', w: 0, l: 0, titles: 0, pf: 0 },
    { team: 'Check Downs', w: 0, l: 0, titles: 0, pf: 0 },
    { team: 'Air Raid', w: 0, l: 0, titles: 0, pf: 0 },
    { team: 'Lambeau Leapers', w: 0, l: 0, titles: 0, pf: 0 },
    { team: 'The Audibles', w: 0, l: 0, titles: 0, pf: 0 },
    { team: 'Pepperbox Farmers', w: 0, l: 0, titles: 0, pf: 0 },
  ],
  '2025': [
    { team: 'Check Downs', w: 11, l: 3, titles: 1, pf: 1401 },
    { team: 'Gridiron Gurus', w: 10, l: 4, titles: 0, pf: 1382 },
    { team: 'Air Raid', w: 8, l: 6, titles: 0, pf: 1265 },
    { team: 'Sunday Scaries', w: 7, l: 7, titles: 0, pf: 1224 },
    { team: 'The Audibles', w: 6, l: 8, titles: 0, pf: 1150 },
    { team: 'Lambeau Leapers', w: 5, l: 9, titles: 0, pf: 1119 },
    { team: 'Pepperbox Farmers', w: 2, l: 12, titles: 0, pf: 968 },
  ],
  '2024': [
    { team: 'Gridiron Gurus', w: 12, l: 2, titles: 1, pf: 1466 },
    { team: 'Sunday Scaries', w: 9, l: 5, titles: 0, pf: 1301 },
    { team: 'Check Downs', w: 8, l: 6, titles: 0, pf: 1254 },
    { team: 'Lambeau Leapers', w: 7, l: 7, titles: 0, pf: 1188 },
    { team: 'Air Raid', w: 6, l: 8, titles: 0, pf: 1147 },
    { team: 'The Audibles', w: 5, l: 9, titles: 0, pf: 1092 },
    { team: 'Pepperbox Farmers', w: 3, l: 11, titles: 0, pf: 1002 },
  ],
}

// Preseason: no weeks have been played, so there's no record to report yet.
export const MOCK_STAT_RECORDS: MockStatRecord[] = [
  { label: 'Highest week', value: '—', sub: 'No games played yet' },
  { label: 'Lowest week', value: '—', sub: 'No games played yet' },
  { label: 'Average', value: '—', sub: 'Season starts soon' },
  { label: 'Current streak', value: '—', sub: 'No games played yet' },
]

export const MOCK_WAIVER_SETTINGS: MockWaiverSetting[] = [
  { label: 'Waiver type', value: 'FAAB · $100 budget' },
  { label: 'Waivers process', value: 'Wednesday · 3:00 AM ET' },
  { label: 'Claim period', value: '2 days' },
  { label: 'Trade deadline', value: 'Fri, Nov 28' },
  { label: 'Trade review', value: 'League vote · 24 hours' },
  { label: 'Acquisition limit', value: 'None' },
]

export const MOCK_ROSTER_SLOTS: MockRosterSlot[] = [
  { label: 'Quarterback', abbr: 'QB', count: 1 },
  { label: 'Running back', abbr: 'RB', count: 2 },
  { label: 'Wide receiver', abbr: 'WR', count: 2 },
  { label: 'Tight end', abbr: 'TE', count: 1 },
  { label: 'Flex (RB/WR/TE)', abbr: 'FLEX', count: 1 },
  { label: 'Team defense', abbr: 'D/ST', count: 1 },
  { label: 'Place kicker', abbr: 'K', count: 1 },
  { label: 'Bench', abbr: 'BE', count: 5 },
  { label: 'Injured reserve', abbr: 'IR', count: 1 },
]

export const MOCK_SCORING_GROUPS: MockScoringGroup[] = [
  {
    group: 'Passing',
    items: [
      { label: 'Passing yards', abbr: 'per yd', value: 0.04 },
      { label: 'Passing TD', abbr: 'per TD', value: 4 },
      { label: 'Interception', abbr: 'per INT', value: -2 },
      { label: '2-pt conversion', abbr: 'per 2PC', value: 2 },
    ],
  },
  {
    group: 'Rushing',
    items: [
      { label: 'Rushing yards', abbr: 'per yd', value: 0.1 },
      { label: 'Rushing TD', abbr: 'per TD', value: 6 },
    ],
  },
  {
    group: 'Receiving',
    items: [
      { label: 'Reception (PPR)', abbr: 'per rec', value: 1 },
      { label: 'Receiving yards', abbr: 'per yd', value: 0.1 },
      { label: 'Receiving TD', abbr: 'per TD', value: 6 },
    ],
  },
  {
    group: 'Misc',
    items: [
      { label: 'Fumble lost', abbr: 'per FUM', value: -2 },
      { label: 'Kick/punt return TD', abbr: 'per TD', value: 6 },
    ],
  },
  {
    group: 'Kicking',
    items: [
      { label: 'FG made 0–39', abbr: 'per FG', value: 3 },
      { label: 'FG made 40–49', abbr: 'per FG', value: 4 },
      { label: 'FG made 50+', abbr: 'per FG', value: 5 },
      { label: 'FG missed', abbr: 'per miss', value: -1 },
      { label: 'Extra point made', abbr: 'per XP', value: 1 },
      { label: 'Extra point missed', abbr: 'per miss', value: -1 },
    ],
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Crest/avatar initials from a team or league name ("Gridiron Gurus" → "GG"). */
export function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .replace(/[^A-Za-z]/g, '')
  return (letters.slice(0, 2) || '?').toUpperCase()
}

/** Look up a mock league — unknown ids fall back to the first demo league,
 *  mirroring the prototype's behavior. */
export function getMockLeague(leagueId: string): MockLeague {
  return MOCK_LEAGUES.find((l) => l.id === leagueId) ?? MOCK_LEAGUES[0]
}

export function getMockLeagueTeams(leagueId: string): MockLeagueTeam[] {
  return MOCK_LEAGUE_TEAMS_BY_ID[leagueId] ?? MOCK_LEAGUE_TEAMS_BY_ID.log
}

export interface MockStandingRow extends MockLeagueTeam {
  rank: number
}

/** Standings — wins first, points-for breaks ties. */
export function getMockStandings(leagueId: string): MockStandingRow[] {
  return getMockLeagueTeams(leagueId)
    .slice()
    .sort((a, b) => b.w - a.w || b.pf - a.pf)
    .map((t, i) => ({ ...t, rank: i + 1 }))
}

export const MOCK_ROSTER_SPOT_COUNT = MOCK_ROSTER_SLOTS.reduce(
  (sum, slot) => sum + slot.count,
  0,
)

/** The current mock week. 0 = preseason (matches the app-wide convention —
 *  see lib/sports-data/nfl-state.ts): no games played, nothing is "final,"
 *  and every week 1–18 is still ahead of you. */
export const MOCK_CURRENT_WEEK = 0

/** For "Week N" labels — preseason (0) previews the season-opening Week 1
 *  rather than printing the meaningless "Week 0". */
export const MOCK_DISPLAY_WEEK = MOCK_CURRENT_WEEK === 0 ? 1 : MOCK_CURRENT_WEEK

// ---------------------------------------------------------------------------
// Weekly lineup engine (My Team, all 18 weeks)
//
// The league backend does not exist, so every week's opponent / kickoff /
// projection / OPRK is DERIVED from the MOCK_LINEUP baseline above via a
// deterministic (seeded, not Math.random()) generator — stable across
// re-renders and week-to-week navigation. Preseason (MOCK_CURRENT_WEEK = 0)
// never equals a selectable week, so weeklyVariant's no-op branch never
// fires today — every week 1–18 is generated uniformly, which is correct
// pre-season: nothing is "the current actual week" yet. That branch exists
// for when the season starts and MOCK_CURRENT_WEEK becomes a real 1–18 week.
// TODO(live-draft): replace with the real week-by-week roster/schedule.
// ---------------------------------------------------------------------------

/** NFL team → bye week. Only teams appearing in the demo roster need an
 *  entry; anything else falls back to week 9. */
const TEAM_BYE_WEEK: Record<string, number> = {
  BUF: 7,
  SF: 9,
  PHI: 5,
  DAL: 10,
  NYJ: 9,
  DET: 8,
  TB: 9,
  BAL: 7,
  KC: 6,
  MIA: 12,
  TEN: 5,
  ATL: 12,
  MIN: 6,
  CAR: 8,
}

function byeWeekFor(team: string): number {
  return TEAM_BYE_WEEK[team] ?? 9
}

const OPPONENT_POOL = [
  'MIA', 'NE', 'CLE', 'CIN', 'PIT', 'HOU', 'IND', 'JAX', 'DEN', 'LAC',
  'NYG', 'WAS', 'GB', 'CHI', 'NO', 'SEA', 'ARI', 'LAR', 'BUF', 'NYJ',
  'SF', 'DAL', 'PHI', 'BAL', 'KC', 'DET', 'TB', 'TEN', 'ATL', 'MIN', 'CAR',
] as const

const KICKOFF_SLOTS = ['Sun 1:00', 'Sun 4:05', 'Sun 4:25', 'Mon 8:15', 'Thu 8:15'] as const

/** Deterministic hash → [0, 1) — stable across renders (no Math.random()). */
function seeded(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

/** A player's opponent/kickoff/projection/OPRK/status for `week`, derived
 *  from their MOCK_LINEUP baseline (the "typical week" figures other tabs
 *  read directly). Only a no-op at MOCK_CURRENT_WEEK — see the note above. */
function weeklyVariant(base: MockLineupPlayer, week: number): MockLineupPlayer {
  if (week === MOCK_CURRENT_WEEK) return base

  const bye = byeWeekFor(base.team)
  if (week === bye) {
    return { ...base, opp: 'BYE', time: '', proj: 0, oprk: 0, status: '' }
  }

  const seedKey = `${base.name}:${week}`
  const projVariance = (seeded(`${seedKey}:proj`) - 0.5) * 0.3 // ±15%
  const oprkShift = Math.round((seeded(`${seedKey}:oprk`) - 0.5) * 20) // ±10
  const pool = OPPONENT_POOL.filter((t) => t !== base.team)
  const opponent = pool[Math.floor(seeded(`${seedKey}:opp`) * pool.length)]
  const home = seeded(`${seedKey}:home`) >= 0.5
  const kickoff =
    KICKOFF_SLOTS[Math.floor(seeded(`${seedKey}:time`) * KICKOFF_SLOTS.length)]

  return {
    ...base,
    opp: home ? `vs ${opponent}` : `@${opponent}`,
    time: kickoff,
    proj: Math.max(0, +(base.proj * (1 + projVariance)).toFixed(1)),
    oprk: Math.min(32, Math.max(1, base.oprk + oprkShift)),
    // Past weeks are final — never show a stale injury designation.
    status: week < MOCK_CURRENT_WEEK ? '' : base.status,
  }
}

/** The full 14-player roster pool (starters + bench), independent of any
 *  week's slot assignment. */
export const MOCK_ROSTER: MockLineupPlayer[] = [
  ...MOCK_LINEUP.starters,
  ...MOCK_LINEUP.bench,
]

/** The 9 starter slots, in display order (mirrors `MOCK_LINEUP.starters`). */
export const STARTER_SLOTS: string[] = MOCK_LINEUP.starters.map((p) => p.slot)

/** Can `pos` fill `slot`? FLEX takes RB/WR/TE; D/ST takes the DEF entry. */
export function slotEligible(slot: string, pos: string): boolean {
  if (slot === 'FLEX') return pos === 'RB' || pos === 'WR' || pos === 'TE'
  if (slot === 'D/ST') return pos === 'DEF'
  return slot === pos
}

/** starters[i] occupies STARTER_SLOTS[i] — positional, NOT keyed by slot
 *  label. Two starter slots share the label "RB" and two share "WR", so a
 *  label-keyed map would silently collapse them onto one player. `ir` is the
 *  name of the bench player placed on IR this week, if any. */
export interface WeekAssignment {
  starters: string[]
  ir: string | null
}

export function defaultAssignment(): WeekAssignment {
  return { starters: MOCK_LINEUP.starters.map((p) => p.name), ir: null }
}

/** Can a player go on IR? Mirrors real leagues, which only allow an official
 *  "Out" designation — the only status this mock data models that far. */
export function irEligible(status: MockInjuryStatus): boolean {
  return status === 'O'
}

/** Resolve one week's starters/bench/IR from a slot assignment (defaults to
 *  `defaultAssignment()` when the user hasn't edited that week). */
export function resolveWeekLineup(
  week: number,
  assignment: WeekAssignment = defaultAssignment(),
): MockLineup {
  const byName = new Map(MOCK_ROSTER.map((p) => [p.name, p]))
  const starters = STARTER_SLOTS.map((slot, i) => {
    const base = byName.get(assignment.starters[i])
    if (!base) throw new Error(`No roster player assigned to slot index ${i}`)
    return { ...weeklyVariant(base, week), slot }
  })
  const startingNames = new Set(starters.map((p) => p.name))
  const irBase = assignment.ir ? byName.get(assignment.ir) : undefined
  const ir = irBase ? { ...weeklyVariant(irBase, week), slot: 'IR' } : null
  const bench = MOCK_ROSTER.filter(
    (p) => !startingNames.has(p.name) && p.name !== assignment.ir,
  ).map((p) => ({ ...weeklyVariant(p, week), slot: 'BE' }))
  return { starters, bench, ir, dl: MOCK_LINEUP.dl }
}

/** A week's fantasy opponent + a deterministic projected score for them,
 *  derived from `league.oppProj` the same way a player's projection varies
 *  week to week.
 *
 * At MOCK_CURRENT_WEEK, `league.opp`/`league.oppProj` are used as-is — they're
 * per-league truth. MOCK_SCHEDULE, by contrast, is a single opponent list
 * authored for the "log" demo league and reused for every league (see its
 * comment above), so it only supplies the opponent NAME for other weeks;
 * pairing it with `league.opp` at the current week would show e.g. "din"'s
 * oppProj next to "log"'s opponent name. */
export function weekMatchup(
  league: MockLeague,
  week: number,
): { opp: string; oppProj: number } {
  if (week === MOCK_CURRENT_WEEK) return { opp: league.opp, oppProj: league.oppProj }
  const game = MOCK_SCHEDULE.find((g) => g.week === week)
  const opp = game?.opp ?? league.opp
  const variance = (seeded(`${opp}:${week}:oppProj`) - 0.5) * 0.3
  return {
    opp,
    oppProj: Math.max(0, +(league.oppProj * (1 + variance)).toFixed(1)),
  }
}
