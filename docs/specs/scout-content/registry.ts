/**
 * Scout metric registry — the single definition of every metric FieldScout
 * knows about. Spec: docs/specs/spec-scout.md §4.
 *
 * This one object feeds four surfaces: the rail explainer, the stat-center
 * column, the player-profile percentile bar, and the public /scout page.
 * There is no second glossary. If a number or a phrase appears anywhere in
 * the product, it comes from here.
 *
 * Copy ceilings (§4.5) are enforced by registry.test.ts:
 *   plain ≤110 · impact ≤160 · insteadOf.because ≤180 · watchOut[n] ≤140
 *
 * Evidence discipline (§3.1): every stabilityEvidence carries its statistic
 * (r vs r2 — never mixed), sample window and source. A claim with no citable
 * source is `null`, never a plausible-looking invented figure.
 */

import type { MetricDefinition } from './types'

// ---------------------------------------------------------------------------
// Sources — referenced by evidence blocks below.
// ---------------------------------------------------------------------------
const SHARP = {
  wr: 'https://www.sharpfootballanalysis.com/fantasy/wide-receiver-stats-that-matter-fantasy-football-2024/',
  rb: 'https://www.sharpfootballanalysis.com/fantasy/running-back-stats-that-matter-fantasy-football-2024/',
  te: 'https://www.sharpfootballanalysis.com/fantasy/te-stats-that-matter-fantasy-football/',
  qb: 'https://www.sharpfootballanalysis.com/fantasy/quarterback-stats-that-matter-fantasy-football-2025/',
} as const
const FOUR4 = 'https://www.4for4.com/2024/preseason/most-predictable-wide-receiver-stats'
const SUMER = 'https://sumersports.com/the-zone/sticky-football-stats-predictive-nfl-metrics/'
const NFELO = 'https://www.nfeloapp.com/analysis/over-expected-explained-what-are-cpoe-ryoe-and-yacoe/'
const FPTS_XTD = 'https://www.fantasypoints.com/nfl/articles/2023/xtd-touchdown-regression-candidates'
const PFF_YPRR = 'https://www.pff.com/news/fantasy-football-metrics-that-matter-yards-per-route-run'

/** Sharp publishes R². Never render these on the same axis as an r value. */
const sharpR2 = (
  value: number,
  window: string,
  url: string,
  contested = false,
): MetricDefinition['stabilityEvidence'] => ({
  statistic: 'r2',
  value,
  sampleWindow: window,
  sourceName: 'Sharp Football Analysis',
  sourceUrl: url,
  contested,
})

/** 4for4 publishes Pearson r. */
const fourR = (
  value: number,
  url = FOUR4,
  contested = false,
): MetricDefinition['stabilityEvidence'] => ({
  statistic: 'r',
  value,
  sampleWindow: '2017–2023, WR, 30+ targets',
  sourceName: '4for4',
  sourceUrl: url,
  contested,
})

const RECEIVERS: MetricDefinition['positions'] = ['WR', 'TE', 'RB']

// ---------------------------------------------------------------------------
// The registry.
// ---------------------------------------------------------------------------
export const METRICS: Record<string, MetricDefinition> = {
  // =========================================================================
  // FANTASY — the headline numbers
  // =========================================================================
  'points-per-game': {
    slug: 'points-per-game',
    key: 'fantasy_points_per_game',
    name: 'Points per game',
    abbr: 'PPR/G',
    category: 'volume',
    positions: [],
    unit: 'points',
    precision: 1,
    higherIsBetter: true,
    formula: 'total fantasy points ÷ games played',
    plain: 'Fantasy points per game he actually played.',
    impact:
      'The most repeatable headline number there is. A guy who missed three games is not 20 spots worse than one who did not.',
    insteadOf: {
      metric: 'Total points',
      because:
        'Season totals mostly measure who stayed healthy, and nobody can predict injuries. Per-game strips that out and leaves you the part that repeats.',
    },
    watchOut: [
      'A guy who played hurt for six weeks still drags his own average down. Check whether the bad games clustered.',
    ],
    stability: 'sticky',
    stabilityEvidence: sharpR2(0.567, '2016–2022, WR', SHARP.wr),
    predictiveness: 5,
    type: 'volume',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: { field: 'games', min: 4, label: '4+ games' },
    related: ['total-points', 'games-played', 'expected-fantasy-points'],
    traps: ['season-totals'],
  },

  'total-points': {
    slug: 'total-points',
    key: 'fantasy_points',
    name: 'Total points',
    abbr: 'PTS',
    category: 'volume',
    positions: [],
    unit: 'points',
    precision: 1,
    higherIsBetter: true,
    formula: 'Σ (scoring rules × stat line)',
    plain: 'Fantasy points scored across the whole season.',
    impact:
      'Tells you who won you weeks last year. Says much less about next year, because most of the gap between players is games played.',
    insteadOf: null,
    watchOut: [
      'Rewards availability more than skill. Two identical players separated by a hamstring look nothing alike here.',
    ],
    stability: 'moderate',
    stabilityEvidence: null,
    predictiveness: 2,
    type: 'volume',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: null,
    related: ['points-per-game', 'games-played'],
    traps: ['season-totals'],
  },

  'games-played': {
    slug: 'games-played',
    key: 'games',
    name: 'Games played',
    abbr: 'G',
    category: 'volume',
    positions: [],
    unit: 'count',
    precision: 0,
    higherIsBetter: true,
    formula: 'count of games with a recorded snap',
    plain: 'How many games he suited up for.',
    impact:
      'Worth knowing, worth nothing as a projection. Availability barely repeats — treating durability as a skill is the oldest mistake in fantasy.',
    insteadOf: null,
    watchOut: [
      'A clean injury history does not lower next season’s risk in any way you can measure.',
    ],
    stability: 'noisy',
    stabilityEvidence: sharpR2(0.022, '2016–2022, WR', SHARP.wr),
    predictiveness: 1,
    type: 'volume',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: null,
    related: ['points-per-game', 'total-points'],
    traps: ['season-totals'],
  },

  // =========================================================================
  // OPPORTUNITY — the core of the argument
  // =========================================================================
  'target-share': {
    slug: 'target-share',
    key: 'target_share',
    name: 'Target share',
    abbr: 'TGT%',
    category: 'opportunity',
    positions: RECEIVERS,
    unit: 'percent',
    precision: 1,
    higherIsBetter: true,
    formula: 'his targets ÷ his team’s targets',
    plain: 'The slice of his team’s throws that go to him.',
    impact:
      'The most repeatable thing a receiver does. A big slice means a safe floor even when the offense has a bad day.',
    insteadOf: {
      metric: 'Touchdowns',
      because:
        'A guy can catch 3 touchdowns one year and 12 the next without changing how he plays. His share of the targets barely moves.',
    },
    watchOut: [
      'A season average hides a role change. 14% through week 8 and 28% after is not a 21% player.',
      'Says nothing about target quality. A big share of checkdowns is not a big share of end-zone looks.',
    ],
    stability: 'sticky',
    stabilityEvidence: sharpR2(0.401, '2016–2022, WR', SHARP.wr),
    predictiveness: 5,
    type: 'opportunity',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: { field: 'targets', min: 50, label: '50+ targets' },
    related: ['air-yards-share', 'wopr', 'targets-per-game', 'expected-fantasy-points'],
    traps: ['small-sample', 'garbage-time', 'role-change'],
  },

  'targets-per-game': {
    slug: 'targets-per-game',
    key: 'targets_per_game',
    name: 'Targets per game',
    abbr: 'TGT/G',
    category: 'opportunity',
    positions: RECEIVERS,
    unit: 'count',
    precision: 1,
    higherIsBetter: true,
    formula: 'targets ÷ games played',
    plain: 'How often the ball is thrown his way each week.',
    impact:
      'Volume is the floor of fantasy scoring. Eight looks a game beats better hands on five looks almost every time.',
    insteadOf: {
      metric: 'Receptions',
      because:
        'Catches depend on the quarterback. Targets depend on the coach, and coaches do not change their minds much once a role is set.',
    },
    watchOut: [
      'Team pace inflates it. A team that throws 40 times a game hands out more targets to everyone.',
    ],
    stability: 'sticky',
    stabilityEvidence: sharpR2(0.539, '2016–2022, WR', SHARP.wr),
    predictiveness: 5,
    type: 'opportunity',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: { field: 'games', min: 4, label: '4+ games' },
    related: ['target-share', 'targets', 'receptions'],
    traps: ['garbage-time'],
  },

  targets: {
    slug: 'targets',
    key: 'targets',
    name: 'Targets',
    abbr: 'TGT',
    category: 'opportunity',
    positions: RECEIVERS,
    unit: 'count',
    precision: 0,
    higherIsBetter: true,
    formula: 'count of passes thrown his way',
    plain: 'Times he was thrown to, caught or not.',
    impact:
      'The raw currency of receiving production. Every other receiving number is downstream of this one.',
    insteadOf: {
      metric: 'Receptions',
      because:
        'A dropped ball and an overthrow both count here, and neither is the receiver’s job to fix. Targets measure the decision to use him.',
    },
    watchOut: [
      'Season totals reward health as much as role. Read it per game, or as a share.',
    ],
    stability: 'sticky',
    stabilityEvidence: fourR(0.7),
    predictiveness: 4,
    type: 'opportunity',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: null,
    related: ['targets-per-game', 'target-share', 'receptions'],
    traps: ['season-totals', 'garbage-time'],
  },

  'air-yards-share': {
    slug: 'air-yards-share',
    key: 'air_yards_share',
    name: 'Air yards share',
    abbr: 'AY%',
    category: 'opportunity',
    positions: RECEIVERS,
    unit: 'percent',
    precision: 1,
    higherIsBetter: true,
    formula: 'his air yards ÷ his team’s air yards',
    plain: 'His share of how far downfield his team throws the ball.',
    impact:
      'Separates the real number one from the checkdown guy padding a target count. This is the receiver the offense trusts deep.',
    insteadOf: {
      metric: 'Catch rate',
      because:
        'A 75% catch rate usually just means they are throwing him screens. Air yards show whether he is the one they look for downfield.',
    },
    watchOut: [
      'High air yards on a bad offense can be empty. Pair it with RACR to see if the yards actually arrive.',
    ],
    stability: 'sticky',
    stabilityEvidence: {
      statistic: 'r',
      value: 0.7,
      sampleWindow: '2016–2022, WR',
      sourceName: 'Fantasy Classroom',
      sourceUrl: 'https://fantasyclassroom.org/Blogs/sticky-stats/wr-sticky-season-totals',
      contested: false,
    },
    predictiveness: 4,
    type: 'opportunity',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 2006,
    qualification: { field: 'targets', min: 50, label: '50+ targets' },
    related: ['target-share', 'wopr', 'racr', 'adot'],
    traps: ['empty-air-yards', 'small-sample'],
  },

  wopr: {
    slug: 'wopr',
    key: 'wopr',
    name: 'Weighted opportunity',
    abbr: 'WOPR',
    category: 'opportunity',
    positions: RECEIVERS,
    unit: 'index',
    precision: 2,
    higherIsBetter: true,
    formula: '1.5 × target share + 0.7 × air yards share',
    plain: 'Target share and downfield share, combined into one number.',
    impact:
      'The closest thing to a single "how much of this offense is his" score. If you check one advanced number before drafting, check this.',
    insteadOf: {
      metric: 'Receiving yards',
      because:
        'Yards tell you what already happened. This tells you how much of the offense actually runs through him, which is the part that carries over.',
    },
    watchOut: [
      'Two players can reach the same score from opposite directions — one on volume, one on depth. Look at both inputs.',
    ],
    stability: 'sticky',
    stabilityEvidence: {
      statistic: 'r',
      value: 0.7,
      sampleWindow: '2016–2022, WR',
      sourceName: 'Fantasy Classroom',
      sourceUrl: 'https://fantasyclassroom.org/Blogs/sticky-stats/wr-sticky-season-totals',
      contested: false,
    },
    predictiveness: 5,
    type: 'composite',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 2006,
    qualification: { field: 'targets', min: 50, label: '50+ targets' },
    related: ['target-share', 'air-yards-share', 'expected-fantasy-points'],
    traps: ['small-sample'],
  },

  'snap-share': {
    slug: 'snap-share',
    key: 'snap_pct',
    name: 'Snap share',
    abbr: 'SNP%',
    category: 'opportunity',
    positions: ['QB', 'RB', 'WR', 'TE'],
    unit: 'percent',
    precision: 1,
    higherIsBetter: true,
    formula: 'his offensive snaps ÷ team offensive snaps',
    plain: 'How much of his team’s offense he is on the field for.',
    impact:
      'A floor check, not a projection. It tells you he is employed — it does not tell you the ball is coming to him.',
    insteadOf: {
      metric: 'Depth chart position',
      because:
        'Published depth charts are guesses. Snap share is what the coaching staff actually did on Sunday, which is the only vote that counts.',
    },
    watchOut: [
      'A blocking tight end and a receiving tight end post identical snap shares. Never use it as a stand-in for routes run.',
    ],
    stability: 'moderate',
    stabilityEvidence: null,
    predictiveness: 3,
    type: 'opportunity',
    source: 'sleeper',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 2012,
    qualification: { field: 'games', min: 4, label: '4+ games' },
    related: ['target-share', 'touches-per-game', 'route-participation'],
    traps: ['snap-share-proxy'],
  },

  'red-zone-target-share': {
    slug: 'red-zone-target-share',
    key: 'rz_target_share',
    name: 'Red zone target share',
    abbr: 'RZ%',
    category: 'situational',
    positions: RECEIVERS,
    unit: 'percent',
    precision: 1,
    higherIsBetter: true,
    formula: 'his targets inside the 20 ÷ team targets inside the 20',
    plain: 'His share of the throws his team makes inside the 20.',
    impact:
      'Where touchdowns come from. A receiver with real red zone volume is far less dependent on luck to find the end zone.',
    insteadOf: {
      metric: 'Touchdowns',
      because:
        'Scoring is the outcome. Getting the chance to score is the input, and the input is the part that comes back next season.',
    },
    watchOut: [
      'Small by nature — a team may only throw 60 red zone passes all year, so a few plays swing it hard.',
    ],
    stability: 'moderate',
    stabilityEvidence: null,
    predictiveness: 3,
    type: 'situational',
    source: 'nflverse-pbp',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: { field: 'rz_targets', min: 10, label: '10+ red zone targets' },
    related: ['expected-touchdowns', 'receiving-touchdowns', 'target-share'],
    traps: ['small-sample', 'td-regression'],
  },

  // =========================================================================
  // EXPECTED — the regression tools
  // =========================================================================
  'expected-touchdowns': {
    slug: 'expected-touchdowns',
    key: 'expected_tds',
    name: 'Expected touchdowns',
    abbr: 'xTD',
    category: 'expected',
    positions: RECEIVERS,
    unit: 'count',
    precision: 1,
    higherIsBetter: true,
    formula: 'Σ per-target touchdown probability, by field position and depth',
    plain: 'The touchdowns he should have scored, given where he got the ball.',
    impact:
      'Below it? Buy him, he is cheap. Above it? Sell high before the room notices. That is the whole trade.',
    insteadOf: {
      metric: "Last year's touchdowns",
      because:
        'Expected touchdowns predict next season’s scoring slightly better than actual touchdowns do, and they repeat far better themselves.',
    },
    watchOut: [
      'A gap only becomes a signal over a full season. Four weeks of bad luck is just four weeks.',
    ],
    stability: 'moderate',
    stabilityEvidence: {
      statistic: 'r2',
      value: 0.382,
      sampleWindow: 'year-over-year, receivers',
      sourceName: 'Fantasy Points',
      sourceUrl: FPTS_XTD,
      contested: false,
    },
    predictiveness: 4,
    type: 'expected',
    source: 'ff-opportunity',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 2006,
    qualification: { field: 'targets', min: 50, label: '50+ targets' },
    related: ['receiving-touchdowns', 'red-zone-target-share', 'points-over-expected'],
    traps: ['td-regression', 'small-sample'],
  },

  'expected-fantasy-points': {
    slug: 'expected-fantasy-points',
    key: 'expected_fantasy_points',
    name: 'Expected fantasy points',
    abbr: 'xFP',
    category: 'expected',
    positions: [],
    unit: 'points',
    precision: 1,
    higherIsBetter: true,
    formula: 'Σ expected value of each touch, by field position and play type',
    plain: 'The points his workload was worth, before luck got involved.',
    impact:
      'The fairest measure of a role. Two receivers with the same expected points had the same job, whatever the box score says.',
    insteadOf: {
      metric: 'Total points',
      because:
        'Actual points bundle the role with the luck. This is the role on its own, which is the half that shows up again next season.',
    },
    watchOut: [
      'It is a model, not a fact. Different providers publish different numbers for the same player.',
    ],
    stability: 'sticky',
    stabilityEvidence: null,
    predictiveness: 4,
    type: 'expected',
    source: 'ff-opportunity',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 2006,
    qualification: { field: 'games', min: 4, label: '4+ games' },
    related: ['points-over-expected', 'expected-touchdowns', 'wopr'],
    traps: ['small-sample'],
  },

  'points-over-expected': {
    slug: 'points-over-expected',
    key: 'points_over_expected',
    name: 'Points over expected',
    abbr: '+/-xFP',
    category: 'expected',
    positions: [],
    unit: 'points',
    precision: 1,
    higherIsBetter: true,
    formula: 'actual fantasy points − expected fantasy points',
    plain: 'How much more, or less, he scored than his workload was worth.',
    impact:
      'A shopping list. Deeply negative players are next year’s bargains; deeply positive ones are this year’s sell-high candidates.',
    insteadOf: {
      metric: 'Gut feel about who underperformed',
      because:
        'Everyone senses when a player disappointed. This tells you whether the role was actually there, or whether he never had the chances.',
    },
    watchOut: [
      'A genuinely elite finisher can run positive for years. Check whether the gap is one season or a pattern.',
    ],
    stability: 'noisy',
    stabilityEvidence: null,
    predictiveness: 3,
    type: 'expected',
    source: 'ff-opportunity',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 2006,
    qualification: { field: 'games', min: 6, label: '6+ games' },
    related: ['expected-fantasy-points', 'expected-touchdowns'],
    traps: ['td-regression'],
  },

  // =========================================================================
  // RECEIVING — production and efficiency
  // =========================================================================
  'receiving-yards': {
    slug: 'receiving-yards',
    key: 'receiving_yards',
    name: 'Receiving yards',
    abbr: 'Rec yds',
    category: 'receiving',
    positions: RECEIVERS,
    unit: 'yards',
    precision: 0,
    higherIsBetter: true,
    formula: 'Σ yards gained on receptions',
    plain: 'Total yards gained catching the ball.',
    impact:
      'A fine scoreboard and a weak forecast. It blends the role he had with the luck he ran into, and only one of those comes back.',
    insteadOf: {
      metric: 'Nothing — but pair it',
      because:
        'Yards are worth knowing. Just read them next to target share, so you can see whether the yards came from a role or from a hot streak.',
    },
    watchOut: [
      'Two 1,200-yard seasons can be built completely differently. 150 targets and 90 targets are not the same player.',
    ],
    stability: 'moderate',
    stabilityEvidence: null,
    predictiveness: 3,
    type: 'volume',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: null,
    related: ['target-share', 'yards-per-target', 'racr'],
    traps: ['season-totals'],
  },

  receptions: {
    slug: 'receptions',
    key: 'receptions',
    name: 'Receptions',
    abbr: 'Rec',
    category: 'receiving',
    positions: RECEIVERS,
    unit: 'count',
    precision: 0,
    higherIsBetter: true,
    formula: 'count of completed passes to him',
    plain: 'Passes he actually caught.',
    impact:
      'In PPR this is points in the bank. Just remember it is a target plus a completion, and only the target is his to control.',
    insteadOf: {
      metric: 'Nothing — but read targets first',
      because:
        'Catches depend on quarterback accuracy as much as on him. Targets isolate the part of the equation the coaching staff decides.',
    },
    watchOut: [
      'A bad quarterback suppresses catches without touching the role. Check targets before downgrading anyone.',
    ],
    stability: 'sticky',
    stabilityEvidence: sharpR2(0.521, '2016–2022, WR', SHARP.wr),
    predictiveness: 4,
    type: 'volume',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: null,
    related: ['targets', 'catch-rate', 'targets-per-game'],
    traps: ['season-totals'],
  },

  'receiving-touchdowns': {
    slug: 'receiving-touchdowns',
    key: 'receiving_tds',
    name: 'Receiving touchdowns',
    abbr: 'Rec TD',
    category: 'receiving',
    positions: RECEIVERS,
    unit: 'count',
    precision: 0,
    higherIsBetter: true,
    formula: 'count of touchdowns caught',
    plain: 'Touchdowns caught.',
    impact:
      'The stat everyone drafts on and the least repeatable one in football. Same player, same role: 3 one year, 12 the next.',
    insteadOf: {
      metric: 'Expected touchdowns',
      because:
        'Scoring rate is close to random from season to season. What he should have scored predicts next year better than what he did score.',
    },
    watchOut: [
      'A big touchdown year on modest volume is the single most reliable sell-high signal in fantasy.',
    ],
    stability: 'noisy',
    stabilityEvidence: sharpR2(0.008, '2016–2022, WR, TD per target', SHARP.wr),
    predictiveness: 1,
    type: 'volume',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: null,
    related: ['expected-touchdowns', 'red-zone-target-share'],
    traps: ['td-regression'],
  },

  'catch-rate': {
    slug: 'catch-rate',
    key: 'catch_rate',
    name: 'Catch rate',
    abbr: 'CTH%',
    category: 'efficiency',
    positions: RECEIVERS,
    unit: 'percent',
    precision: 1,
    higherIsBetter: true,
    formula: 'receptions ÷ targets',
    plain: 'The share of passes thrown his way that he caught.',
    impact:
      'Mostly tells you how far downfield he plays, not how good his hands are. Screen merchants lead the league in this every year.',
    insteadOf: {
      metric: 'Air yards share',
      because:
        'A high catch rate is usually a short-target rate in disguise. Air yards share answers the question people think catch rate answers.',
    },
    watchOut: [
      'Almost entirely driven by average target depth. Compare it only between receivers with similar aDOT.',
    ],
    stability: 'noisy',
    stabilityEvidence: sharpR2(0.098, '2016–2022, TE', SHARP.te),
    predictiveness: 1,
    type: 'efficiency',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: { field: 'targets', min: 50, label: '50+ targets' },
    related: ['adot', 'air-yards-share', 'receptions'],
    traps: ['small-sample'],
  },

  'yards-per-target': {
    slug: 'yards-per-target',
    key: 'yards_per_target',
    name: 'Yards per target',
    abbr: 'Y/T',
    category: 'efficiency',
    positions: RECEIVERS,
    unit: 'yards',
    precision: 2,
    higherIsBetter: true,
    formula: 'receiving yards ÷ targets',
    plain: 'Yards gained for every pass thrown his way.',
    impact:
      'Looks like talent, behaves like a coin flip. One of the least repeatable numbers a receiver produces.',
    insteadOf: {
      metric: 'Target share',
      because:
        'Efficiency swings wildly from year to year while role barely moves. Buy the guy who gets the chances, not the one who cashed them in.',
    },
    watchOut: [
      'A couple of long touchdowns can carry a whole season’s worth of this number.',
    ],
    stability: 'noisy',
    stabilityEvidence: sharpR2(0.028, '2016–2022, WR', SHARP.wr),
    predictiveness: 1,
    type: 'efficiency',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: { field: 'targets', min: 50, label: '50+ targets' },
    related: ['target-share', 'racr', 'adot'],
    traps: ['small-sample', 'garbage-time'],
  },

  adot: {
    slug: 'adot',
    key: 'adot',
    name: 'Average depth of target',
    abbr: 'aDOT',
    category: 'receiving',
    positions: RECEIVERS,
    unit: 'yards',
    precision: 1,
    higherIsBetter: false,
    formula: 'total air yards ÷ targets',
    plain: 'How far past the line of scrimmage he is thrown to, on average.',
    impact:
      'Tells you what kind of receiver he is, not how good. Deep guys boom and bust; short guys give you a steadier weekly floor.',
    insteadOf: null,
    watchOut: [
      'Not a quality grade in either direction. A 6-yard aDOT slot receiver can outscore a 15-yard deep threat every week.',
    ],
    stability: 'sticky',
    stabilityEvidence: fourR(0.65),
    predictiveness: 3,
    type: 'opportunity',
    source: 'nflverse-pbp',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 2006,
    qualification: { field: 'targets', min: 30, label: '30+ targets' },
    related: ['air-yards-share', 'catch-rate', 'racr'],
    traps: ['small-sample'],
  },

  racr: {
    slug: 'racr',
    key: 'racr',
    name: 'Air yards conversion',
    abbr: 'RACR',
    category: 'efficiency',
    positions: RECEIVERS,
    unit: 'rate',
    precision: 2,
    higherIsBetter: true,
    formula: 'receiving yards ÷ air yards',
    plain: 'How many real yards he turns each intended yard into.',
    impact:
      'A filter, not a projection. Use it to check whether a big air yards share is actually producing, or whether he is just a decoy.',
    insteadOf: null,
    watchOut: [
      'Short-target receivers post huge numbers here because yards after the catch inflate it. Only compare within similar aDOT.',
    ],
    stability: 'moderate',
    stabilityEvidence: null,
    predictiveness: 2,
    type: 'efficiency',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 2006,
    qualification: { field: 'targets', min: 50, label: '50+ targets' },
    related: ['air-yards-share', 'adot', 'yards-per-target'],
    traps: ['empty-air-yards', 'small-sample'],
  },

  'receiving-epa': {
    slug: 'receiving-epa',
    key: 'receiving_epa',
    name: 'Receiving value added',
    abbr: 'EPA',
    category: 'efficiency',
    positions: RECEIVERS,
    unit: 'points',
    precision: 1,
    higherIsBetter: true,
    formula: 'Σ change in expected points on plays targeting him',
    plain: 'How much his catches moved his team closer to scoring.',
    impact:
      'A good measure of what already happened and a weak one for what comes next. Real football value, limited fantasy forecasting value.',
    insteadOf: null,
    watchOut: [
      'Rewards situation heavily. A third-down role inflates it without meaning more fantasy points are coming.',
    ],
    stability: 'noisy',
    stabilityEvidence: fourR(0.18),
    predictiveness: 2,
    type: 'efficiency',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: { field: 'targets', min: 50, label: '50+ targets' },
    related: ['yards-per-target', 'target-share'],
    traps: ['garbage-time', 'small-sample'],
  },

  // =========================================================================
  // RUSHING
  // =========================================================================
  'touches-per-game': {
    slug: 'touches-per-game',
    key: 'touches_per_game',
    name: 'Touches per game',
    abbr: 'TCH/G',
    category: 'rushing',
    positions: ['RB'],
    unit: 'count',
    precision: 1,
    higherIsBetter: true,
    formula: '(carries + receptions) ÷ games played',
    plain: 'How often he gets the ball each week, running or catching.',
    impact:
      'The only running back number that really holds up. Find the guy who gets 18 touches and stop worrying about what he does with them.',
    insteadOf: {
      metric: 'Yards per carry',
      because:
        'Yards per carry is almost random from one season to the next. How often a coach hands him the ball is not, and it is worth far more points.',
    },
    watchOut: [
      'Committee backfields change fast. A season average can describe a job that ended in October.',
    ],
    stability: 'sticky',
    stabilityEvidence: sharpR2(0.567, '2016–2022, RB', SHARP.rb),
    predictiveness: 5,
    type: 'opportunity',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: { field: 'games', min: 4, label: '4+ games' },
    related: ['carries-per-game', 'yards-per-carry', 'target-share'],
    traps: ['role-change', 'rb-efficiency'],
  },

  'carries-per-game': {
    slug: 'carries-per-game',
    key: 'carries_per_game',
    name: 'Carries per game',
    abbr: 'ATT/G',
    category: 'rushing',
    positions: ['RB', 'QB'],
    unit: 'count',
    precision: 1,
    higherIsBetter: true,
    formula: 'rush attempts ÷ games played',
    plain: 'How many times he runs the ball each week.',
    impact:
      'The bulk of a running back’s floor. It repeats about as well as anything at the position.',
    insteadOf: {
      metric: 'Rushing yards',
      because:
        'Yards mix the workload with the blocking and the luck. Carries are the part the coaching staff actually decides each week.',
    },
    watchOut: [
      'Ignores passing-game work entirely. A three-down back and a two-down grinder can look identical here.',
    ],
    stability: 'sticky',
    stabilityEvidence: sharpR2(0.562, '2016–2022, RB', SHARP.rb),
    predictiveness: 4,
    type: 'opportunity',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: { field: 'games', min: 4, label: '4+ games' },
    related: ['touches-per-game', 'goal-line-carry-share', 'yards-per-carry'],
    traps: ['role-change'],
  },

  'yards-per-carry': {
    slug: 'yards-per-carry',
    key: 'yards_per_carry',
    name: 'Yards per carry',
    abbr: 'YPC',
    category: 'efficiency',
    positions: ['RB', 'QB'],
    unit: 'yards',
    precision: 2,
    higherIsBetter: true,
    formula: 'rushing yards ÷ rush attempts',
    plain: 'Average yards gained each time he runs the ball.',
    impact:
      'Close to a coin flip year to year. A back at 5.4 is no more likely to repeat it than a back at 4.1.',
    insteadOf: {
      metric: 'Touches per game',
      because:
        'This is the number that makes people fall in love with backup running backs. Volume is worth far more points and actually repeats.',
    },
    watchOut: [
      'One 70-yard run can move a whole season. Depends heavily on the offensive line, which changes without warning.',
    ],
    stability: 'noisy',
    stabilityEvidence: sharpR2(0.031, '2016–2022, RB', SHARP.rb),
    predictiveness: 1,
    type: 'efficiency',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: { field: 'carries', min: 50, label: '50+ carries' },
    related: ['touches-per-game', 'carries-per-game', 'rush-yards-over-expected'],
    traps: ['rb-efficiency', 'small-sample'],
  },

  'goal-line-carry-share': {
    slug: 'goal-line-carry-share',
    key: 'goal_line_carry_share',
    name: 'Goal line carry share',
    abbr: 'GL%',
    category: 'situational',
    positions: ['RB'],
    unit: 'percent',
    precision: 1,
    higherIsBetter: true,
    formula: 'his carries inside the 5 ÷ team carries inside the 5',
    plain: 'His share of his team’s runs from inside the five yard line.',
    impact:
      'The cleanest touchdown signal a back has. Losing this job costs more fantasy points than losing 40 carries elsewhere.',
    insteadOf: {
      metric: 'Rushing touchdowns',
      because:
        'Touchdowns are the outcome and they bounce. The goal line job is the input, and it holds until the coaching staff changes its mind.',
    },
    watchOut: [
      'Tiny samples — some teams run 15 goal-line plays all season. Two games can swing it completely.',
    ],
    stability: 'moderate',
    stabilityEvidence: null,
    predictiveness: 3,
    type: 'situational',
    source: 'nflverse-pbp',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: { field: 'gl_carries', min: 5, label: '5+ goal line carries' },
    related: ['carries-per-game', 'expected-touchdowns'],
    traps: ['small-sample', 'td-regression'],
  },

  // =========================================================================
  // PASSING
  // =========================================================================
  'qb-rushing-yards': {
    slug: 'qb-rushing-yards',
    key: 'qb_rush_yards',
    name: 'Quarterback rushing yards',
    abbr: 'QB rush',
    category: 'rushing',
    positions: ['QB'],
    unit: 'yards',
    precision: 0,
    higherIsBetter: true,
    formula: 'Σ rushing yards by the quarterback',
    plain: 'Yards a quarterback gains with his legs.',
    impact:
      'The most repeatable thing a fantasy quarterback does, and the cheapest floor in the game. A running quarterback rarely busts.',
    insteadOf: {
      metric: 'Passing yards',
      because:
        'Rushing production repeats better than anything a passer does with his arm, and it scores at four times the rate per yard.',
    },
    watchOut: [
      'Designed runs and scrambles are different jobs. A new coordinator can cut one overnight.',
    ],
    stability: 'sticky',
    stabilityEvidence: sharpR2(0.553, '2016–2022, QB', SHARP.qb),
    predictiveness: 5,
    type: 'opportunity',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: { field: 'games', min: 4, label: '4+ games' },
    related: ['carries-per-game', 'passing-yards', 'cpoe'],
    traps: ['role-change'],
  },

  'passing-yards': {
    slug: 'passing-yards',
    key: 'pass_yards',
    name: 'Passing yards',
    abbr: 'Pass yds',
    category: 'passing',
    positions: ['QB'],
    unit: 'yards',
    precision: 0,
    higherIsBetter: true,
    formula: 'Σ yards gained on completed passes',
    plain: 'Total yards thrown for.',
    impact:
      'Repeats reasonably well, but scores slowly — most formats pay a quarter point per yard. Volume matters more than the average.',
    insteadOf: null,
    watchOut: [
      'A quarterback on a bad defense throws more. Game script drives this as much as skill does.',
    ],
    stability: 'sticky',
    stabilityEvidence: sharpR2(0.511, '2016–2022, QB', SHARP.qb),
    predictiveness: 3,
    type: 'volume',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: null,
    related: ['qb-rushing-yards', 'yards-per-attempt', 'cpoe'],
    traps: ['garbage-time', 'season-totals'],
  },

  'yards-per-attempt': {
    slug: 'yards-per-attempt',
    key: 'yards_per_attempt',
    name: 'Yards per attempt',
    abbr: 'Y/A',
    category: 'efficiency',
    positions: ['QB'],
    unit: 'yards',
    precision: 2,
    higherIsBetter: true,
    formula: 'passing yards ÷ pass attempts',
    plain: 'Average yards gained on each pass he throws.',
    impact:
      'A classic that barely repeats. Fantasy quarterbacks are made by volume and rushing, not by yards per throw.',
    insteadOf: {
      metric: 'Quarterback rushing yards',
      because:
        'Efficiency through the air swings hard from year to year. Rushing volume is the most stable thing a fantasy quarterback offers.',
    },
    watchOut: [
      'Rewards deep-throwing offenses regardless of whether the quarterback is any good.',
    ],
    stability: 'noisy',
    stabilityEvidence: sharpR2(0.092, '2016–2022, QB', SHARP.qb),
    predictiveness: 1,
    type: 'efficiency',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 1999,
    qualification: { field: 'attempts', min: 150, label: '150+ attempts' },
    related: ['passing-yards', 'cpoe'],
    traps: ['garbage-time'],
  },

  cpoe: {
    slug: 'cpoe',
    key: 'cpoe',
    name: 'Completion percentage over expected',
    abbr: 'CPOE',
    category: 'passing',
    positions: ['QB'],
    unit: 'percent',
    precision: 1,
    higherIsBetter: true,
    formula: 'actual completion % − expected completion % for those throws',
    plain: 'How much more often he completes passes than the average quarterback would.',
    impact:
      'The most reliable public quarterback number there is. Unlike most "over expected" stats, this one genuinely repeats.',
    insteadOf: {
      metric: 'Completion percentage',
      because:
        'Raw completion percentage rewards a coordinator who calls short passes. This adjusts for throw difficulty, so it grades the passer.',
    },
    watchOut: [
      'Measures accuracy, not fantasy scoring. An accurate game manager still loses to a mediocre passer who runs.',
    ],
    stability: 'sticky',
    stabilityEvidence: {
      statistic: 'r2',
      value: 0.226,
      sampleWindow: 'one prior season → next season, QB',
      sourceName: 'nfelo',
      sourceUrl: NFELO,
      contested: false,
    },
    predictiveness: 4,
    type: 'expected',
    source: 'nflverse-stats',
    licenseTier: 1,
    status: 'live',
    seasonsFrom: 2006,
    qualification: { field: 'attempts', min: 150, label: '150+ attempts' },
    related: ['yards-per-attempt', 'qb-rushing-yards', 'passing-yards'],
    traps: ['small-sample'],
  },

  // =========================================================================
  // TIER 2 — built, gated on the legal read (spec §2.2, open question #1)
  // =========================================================================
  separation: {
    slug: 'separation',
    key: 'avg_separation',
    name: 'Average separation',
    abbr: 'SEP',
    category: 'receiving',
    positions: ['WR', 'TE'],
    unit: 'yards',
    precision: 2,
    higherIsBetter: true,
    formula: 'average yards from the nearest defender when the ball arrives',
    plain: 'How open he is, on average, at the moment the ball gets there.',
    impact:
      'A real skill that barely moves fantasy points. Being open only pays if the ball comes — and volume decides that, not separation.',
    insteadOf: {
      metric: 'Target share',
      because:
        'Separation grades the play. Fantasy scoring counts the plays. Getting open on throws that never come to you is worth nothing.',
    },
    watchOut: [
      'Use it to break a tie between two players with similar target volume. That is the correct size of the tool.',
    ],
    stability: 'noisy',
    stabilityEvidence: null,
    predictiveness: 1,
    type: 'tracking',
    source: 'nflverse-ngs',
    licenseTier: 2,
    status: 'planned',
    seasonsFrom: 2016,
    qualification: { field: 'targets', min: 50, label: '50+ targets' },
    related: ['target-share', 'catch-rate'],
    traps: ['small-sample'],
  },

  'rush-yards-over-expected': {
    slug: 'rush-yards-over-expected',
    key: 'ryoe',
    name: 'Rush yards over expected',
    abbr: 'RYOE',
    category: 'rushing',
    positions: ['RB'],
    unit: 'yards',
    precision: 1,
    higherIsBetter: true,
    formula: 'actual rushing yards − yards expected from the blocking and box count',
    plain: 'Yards he gains beyond what the situation should have produced.',
    impact:
      'Fun to read, almost useless to project. It takes roughly four seasons of this to be as trustworthy as one season of a quarterback’s CPOE.',
    insteadOf: {
      metric: 'Touches per game',
      because:
        'Running back efficiency barely repeats in any form. Buy the workload — it is more stable and worth more points.',
    },
    watchOut: [
      'Credits the back for scheme and blocking he did not create. A great line lifts everyone in the room.',
    ],
    stability: 'noisy',
    stabilityEvidence: null,
    predictiveness: 1,
    type: 'expected',
    source: 'nflverse-ngs',
    licenseTier: 2,
    status: 'planned',
    seasonsFrom: 2016,
    qualification: { field: 'carries', min: 50, label: '50+ carries' },
    related: ['yards-per-carry', 'touches-per-game'],
    traps: ['rb-efficiency'],
  },

  'drop-rate': {
    slug: 'drop-rate',
    key: 'drop_rate',
    name: 'Drop rate',
    abbr: 'DRP%',
    category: 'efficiency',
    positions: RECEIVERS,
    unit: 'percent',
    precision: 1,
    higherIsBetter: false,
    formula: 'charted drops ÷ catchable targets',
    plain: 'How often he drops a ball he should have caught.',
    impact:
      'Barely predicts anything. Drops are rare, they bounce around year to year, and coaches keep throwing to good players anyway.',
    insteadOf: {
      metric: 'Target share',
      because:
        'A receiver with bad hands and a big role outscores one with great hands and no targets, every single week.',
    },
    watchOut: [
      'Charting is subjective — different providers disagree on what counts as a drop.',
    ],
    stability: 'noisy',
    stabilityEvidence: fourR(0.14),
    predictiveness: 1,
    type: 'tracking',
    source: 'nflverse-pfr',
    licenseTier: 2,
    status: 'planned',
    seasonsFrom: 2018,
    qualification: { field: 'targets', min: 50, label: '50+ targets' },
    related: ['catch-rate', 'target-share'],
    traps: ['small-sample'],
  },

  // =========================================================================
  // TIER 4 — needs a paid feed. Pages exist, numbers do not (spec §2.1).
  // =========================================================================
  'yards-per-route-run': {
    slug: 'yards-per-route-run',
    key: 'yprr',
    name: 'Yards per route run',
    abbr: 'YPRR',
    category: 'efficiency',
    positions: RECEIVERS,
    unit: 'yards',
    precision: 2,
    higherIsBetter: true,
    formula: 'receiving yards ÷ routes run',
    plain: 'Yards earned per route — not per snap, per route.',
    impact:
      'We cannot show this yet. No free source publishes route counts, and faking it from snap counts would count blocking tight ends as route runners.',
    insteadOf: null,
    watchOut: [
      'Anyone quoting it off a small sample is quoting noise — the standard studies require a 50-target minimum.',
    ],
    stability: 'moderate',
    stabilityEvidence: {
      statistic: 'r',
      value: 0.43,
      sampleWindow: '2007–2017, n=565, 50+ targets, vs next-season fantasy points',
      sourceName: 'Pro Football Focus',
      sourceUrl: PFF_YPRR,
      contested: false,
    },
    predictiveness: 4,
    type: 'efficiency',
    source: 'paid',
    licenseTier: 4,
    status: 'planned',
    seasonsFrom: null,
    qualification: { field: 'targets', min: 50, label: '50+ targets' },
    related: ['targets-per-route-run', 'route-participation', 'yards-per-target'],
    traps: ['small-sample'],
  },

  'targets-per-route-run': {
    slug: 'targets-per-route-run',
    key: 'tprr',
    name: 'Targets per route run',
    abbr: 'TPRR',
    category: 'opportunity',
    positions: RECEIVERS,
    unit: 'percent',
    precision: 1,
    higherIsBetter: true,
    formula: 'targets ÷ routes run',
    plain: 'How often he gets thrown to when he actually runs a route.',
    impact:
      'The purest measure of target-earning skill, because it removes snaps from the equation. Blocked on route data we cannot get for free.',
    insteadOf: null,
    watchOut: [
      'Small route counts make this swing wildly. A backup with 40 routes tells you nothing.',
    ],
    stability: 'sticky',
    stabilityEvidence: sharpR2(0.392, '2016–2022, WR, targets per route', SHARP.wr),
    predictiveness: 4,
    type: 'opportunity',
    source: 'paid',
    licenseTier: 4,
    status: 'planned',
    seasonsFrom: null,
    qualification: { field: 'routes', min: 100, label: '100+ routes' },
    related: ['yards-per-route-run', 'target-share', 'route-participation'],
    traps: ['small-sample'],
  },

  'route-participation': {
    slug: 'route-participation',
    key: 'route_participation',
    name: 'Route participation',
    abbr: 'RTE%',
    category: 'opportunity',
    positions: RECEIVERS,
    unit: 'percent',
    precision: 1,
    higherIsBetter: true,
    formula: 'routes run ÷ team pass plays',
    plain: 'How often he runs a route when his team drops back to pass.',
    impact:
      'The honest version of snap share for pass catchers. It counts the snaps where he was actually eligible to be thrown to.',
    insteadOf: {
      metric: 'Snap share',
      because:
        'Snap share counts a tight end who stayed in to block as if he ran a route. This counts only the plays where he could have been targeted.',
    },
    watchOut: [
      'Describes a current role rather than a lasting trait — it moves the moment the depth chart does.',
    ],
    stability: 'moderate',
    stabilityEvidence: null,
    predictiveness: 3,
    type: 'opportunity',
    source: 'paid',
    licenseTier: 4,
    status: 'planned',
    seasonsFrom: null,
    qualification: null,
    related: ['snap-share', 'targets-per-route-run', 'yards-per-route-run'],
    traps: ['snap-share-proxy', 'role-change'],
  },
}

export type MetricSlug = keyof typeof METRICS
export const ALL_METRICS = Object.values(METRICS)
export const LIVE_METRICS = ALL_METRICS.filter((m) => m.status === 'live')

/**
 * Symmetric closure of `related`.
 *
 * Authors declare a relationship ONCE, in whichever direction reads naturally
 * ("yards per target → target share"). This computes the reverse edge, so the
 * internal link graph is fully bidirectional without every hub metric having
 * to list its ten dependents by hand.
 *
 * Spec §4.4 #3 originally demanded hand-written symmetry. Running that test
 * showed why it was wrong: `target-share` accrued eleven back-references, and
 * "Related metrics" with eleven entries is a sitemap, not a recommendation.
 */
const RELATED_CLOSURE: Record<string, string[]> = (() => {
  const out: Record<string, Set<string>> = {}
  for (const m of ALL_METRICS) out[m.slug] = new Set(m.related)
  for (const m of ALL_METRICS) {
    for (const r of m.related) out[r]?.add(m.slug)
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]))
})()

/**
 * Related metrics for display, most predictive first, capped.
 * Planned metrics sort last — never lead a live page with a dead end.
 */
export function relatedFor(slug: string, limit = 4): MetricDefinition[] {
  return (RELATED_CLOSURE[slug] ?? [])
    .map((s) => METRICS[s])
    .filter(Boolean)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'live' ? -1 : 1
      return b.predictiveness - a.predictiveness
    })
    .slice(0, limit)
}
