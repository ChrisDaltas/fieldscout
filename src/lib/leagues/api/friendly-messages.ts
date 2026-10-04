/**
 * friendly-messages.ts — a server refusal as a league member reads it
 * (friendly server messages, part 1 — Chris 2026-10-03; PROGRESS D481).
 *
 * The database's `RAISE EXCEPTION` text is written for builders: it names the
 * function (`set_lineup: …`), cites the spec (`§11.2`), ledger rows (`E32`,
 * `Q34(B)`) and column names (`lineup_lock = per_player_kickoff`). Members
 * saw it word for word. This is the ONE cleaner between that text and the
 * screen (it replaces the two that existed — `userFacingMessage`'s prefix/tail
 * strip and the trade center's `plainRefusal`, R1244):
 *
 *   1. a PHRASE MAP for the most-seen refusals — matched on stable fragments
 *      of the server's own sentence, rendered as a short plain sentence with
 *      the player / team / number pulled out of the message. A value that
 *      can't be pulled out reliably gives the entry's generic sentence —
 *      never an invented value. Every fragment is pinned against the newest
 *      defining migration (`friendly-messages.test.ts`), so a SQL rewording
 *      fails a test instead of silently falling back;
 *   2. the GENERIC cleanup for everything else: `fn_name:` prefixes anywhere,
 *      a trailing "— … (§…)" clause, any bracketed group citing `§`, a ledger
 *      code or a snake_case name, setting names swapped for words.
 *
 * Display only. Code that PARSES a refusal (`dropsNeeded`,
 * `isDeadlineRefusal`, the `leagues-service.ts` marker lists) reads the RAW
 * text — `LeagueActionError.raw` on the client, the RPC error on the server.
 *
 * Pure: no clock, no fetch.
 */

/** Setting / state names a member may still meet in a cleaned sentence. */
const WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bin_season\b/g, 'in season'],
  [/\broster_size\b/g, 'roster size'],
  [/\bfaab_min_bid\b/g, 'minimum bid'],
  [/\btrade_deadline_week\b/g, 'trade deadline'],
  [/\bnone_fcfs\b/g, 'no waivers'],
  [/\brolling_priority\b/g, 'rolling waiver priority'],
  [/\breverse_standings\b/g, 'reverse standings'],
  [/\bacquisitions_per_week\b/g, 'weekly pickup limit'],
  [/\bacquisitions_per_season\b/g, 'season pickup limit'],
  [/\bplayoff_start_week\b/g, 'playoff start week'],
  [/\bplayoff_teams\b/g, 'playoff teams'],
  [/\bteam_count\b/g, 'number of teams'],
  [/\bscoring_system_id\b/g, 'scoring'],
  [/\btrade_review\b/g, 'trade review'],
  [/\bwaiver_type\b/g, 'waiver type'],
  [/\bpre_draft\b/g, 'pre-draft'],
  [/\bdraft_live\b/g, 'drafting'],
  [/\bper_player_kickoff\b/g, 'each player’s kickoff'],
]

const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/
const LEDGER = /\b(?:[EQRFD]\d+|M\d+)\b/
const isCitation = (part: string) => /§/.test(part) || LEDGER.test(part) || SNAKE.test(part)

/** Ledger codes and sub-clauses written glued: "Q34(B)", "D412(5)",
 *  "§8.6.7(c)", "Q39 (C)" — joined so one bracket pass sees them whole. */
function unglue(text: string): string {
  return text
    .replace(/(§[\d.]*\d)\(([a-z0-9]{1,2})\)/g, '$1$2')
    .replace(/\b([EQRFD]\d+)\s?\(([A-Za-z0-9]{1,2})\)/g, '$1')
}

/** The generic cleanup (tier 1). Exported for the census test. */
export function cleanServerText(raw: string): string {
  let t = unglue(raw)
  // fn_name: prefixes, at the start (any lowercase word, the F116 rule) and
  // anywhere else (an underscored identifier only — "Heads up:" survives).
  t = t.replace(/^[a-z0-9_]+: /, '')
  t = t.replace(/(^|[\s(—;,])[a-z][a-z0-9]*(?:_[a-z0-9]+)+: /g, '$1')
  // A trailing "— … (§…/E…)" clause that EXPLAINS the rule ("— a player
  // whose game has started cannot …", "— an action_id identifies …") is the
  // builder's; one that TELLS the member what to do ("— finish or delete one
  // first") stays, its citation dropped below.
  t = t.replace(
    /\s+—\s+(?:a|an|the|every|each|no|only)\b[^—]*\([^()]*(?:§|\b[EQRFD]\d+\b)[^()]*\)[^—()]*$/i,
    (clause) => (t.length - clause.length > 0 ? '' : clause),
  )
  // Bracketed groups: keep the plain parts, drop the cited ones (R1244).
  for (let i = 0; i < 2; i++) {
    t = t.replace(/(\s*)\(([^()]*)\)/g, (_whole, lead: string, inner: string) => {
      const kept = inner
        .split(';')
        .map((p) => p.trim())
        .filter((p) => p && !isCitation(p))
      return kept.length ? `${lead}(${kept.join('; ')})` : ''
    })
  }
  // Bare citations left in running text.
  t = t
    .replace(/[,;]?\s*§\d+(?:\.\d+)*[a-z]?/g, '')
    .replace(/[,;/]?\s*\b(?:[EQRFD]\d+|M\d+)(?:'s)?\b/g, '')
  for (const [re, word] of WORDS) t = t.replace(re, word)
  // Anything still snake_case is a name, not a word: spaced out.
  t = t.replace(new RegExp(SNAKE.source, 'g'), (w) => w.replace(/_/g, ' '))
  t = t
    .replace(/\s+([:.,;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+—\s*$/, '')
    .replace(/[:;,]\s*$/, '')
    .trim()
  return t
}

// ---------------------------------------------------------------------------
// The phrase map (tier 2)
// ---------------------------------------------------------------------------

export interface Phrase {
  id: string
  /** The newest migration that defines the raising function (the test reads it). */
  migration: string
  /** Every fragment must be in the message (and in the migration's text). */
  fragments: string[]
  /** The plain sentence — `null` when the values can't be pulled out, and
   *  then `generic` is used. */
  render: (msg: string) => string | null
  generic: string
}

/** A player in the "Name (id)" shape most raises use. */
const NAME_ID = String.raw`(.+?) \([^()]*\)`
/** A leading "verb: " (trade_check names its caller) is gone by now. */
const at = (re: string) => new RegExp('^' + re)
const pick = (msg: string, re: RegExp, fill: (m: RegExpExecArray) => string): string | null => {
  const m = re.exec(msg)
  return m ? fill(m) : null
}
const s = (n: string) => (n === '1' ? '' : 's')

const GAME_STARTED_ADD = 'That player’s game has started — you can pick him up after the week’s games end.'

export const PHRASES: Phrase[] = [
  // Lineup (set_lineup_internal, 169)
  {
    id: 'lineup-kicked-off',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['a player whose game has started cannot enter or move slots'],
    render: (m) => pick(m, at(`(.+?)'s game kicked off at`), (x) => `${x[1]}’s game has started — he’s locked and can’t be moved into or out of your lineup.`),
    generic: 'That player’s game has started — he’s locked and can’t be moved into or out of your lineup.',
  },
  {
    id: 'lineup-slot-locked',
    migration: '169_membership_setup_receipts.sql',
    fragments: ["and a locked slot's player never moves"],
    render: (m) => pick(m, at(`slot \\S+ is locked — (.+?) kicked off at`), (x) => `That spot is locked — ${x[1]}’s game has started.`),
    generic: 'That spot is locked — its player’s game has started.',
  },
  {
    id: 'lineup-played-starter',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['a played starter is stuck in the lineup for the week'],
    render: (m) => pick(m, at('(.+?) already played this week'), (x) => `${x[1]} already played this week, so he stays in your lineup until the week ends.`),
    generic: 'That player already played this week, so he stays in your lineup until the week ends.',
  },
  {
    id: 'lineup-held',
    migration: '169_membership_setup_receipts.sql',
    fragments: ["is held in this week's lineup — his start stays"],
    render: (m) => pick(m, at("(.+?) is held in this week's lineup"), (x) => `${x[1]} is locked into this week’s lineup.`),
    generic: 'That player is locked into this week’s lineup.',
  },
  {
    id: 'lineup-two-slots',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['each player fills exactly one slot'],
    render: (m) => pick(m, at(`${NAME_ID} appears at both`), (x) => `${x[1]} is in two lineup spots. Each player can fill only one.`),
    generic: 'A player is in two lineup spots. Each player can fill only one.',
  },
  {
    id: 'lineup-cannot-place',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['no legal arrangement of the started players fills the slots'],
    render: (m) => pick(m, at(`${NAME_ID} cannot be placed`), (x) => `${x[1]} doesn’t fit — every spot he can play is held by a locked player.`),
    generic: 'That player doesn’t fit — every spot he can play is held by a locked player.',
  },
  {
    id: 'lineup-ir-stint',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['and may not leave it before week'],
    render: (m) => pick(m, at('(.+?) entered restricted IR spot \\S+ in week \\d+ and may not leave it before week (\\d+)'), (x) => `${x[1]} must stay on IR until week ${x[2]}.`),
    generic: 'That player must stay on IR a little longer.',
  },
  {
    id: 'lineup-ir-designation',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['holds designation', 'accepts only'],
    render: (m) => pick(m, at('(.+?) holds designation (\\S+) — IR spot \\S+ accepts only (.+?) \\('), (x) => `${x[1]} isn’t IR-eligible (${x[2]}). This IR spot takes ${x[3]} players only.`),
    generic: 'That player isn’t eligible for this IR spot.',
  },
  {
    id: 'lineup-bye-or-out',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['is blocked at submit', 'bench him or start someone who plays'],
    render: (m) => pick(m, at('(.+?) is (on bye|OUT \\([^()]*\\)) for week (\\d+)'), (x) => `${x[1]} is ${x[2]} in week ${x[3]}. Bench him or start someone who’s playing.`),
    generic: 'A starter isn’t playing this week. Bench him or start someone who’s playing.',
  },
  {
    id: 'lineup-past-week',
    migration: '169_membership_setup_receipts.sql',
    fragments: ["a past week's lineup changes only through the audited commissioner override"],
    render: () => null,
    generic: 'That week is over. Only the commissioner can change a past lineup.',
  },
  {
    id: 'lineup-closed-week',
    migration: '169_membership_setup_receipts.sql',
    fragments: ["a closed week's lineup changes only through the audited commissioner override"],
    render: () => null,
    generic: 'That week is over. Only the commissioner can change a past lineup.',
  },
  {
    id: 'lineup-not-in-season',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['lineups are set only while in_season or in playoffs'],
    render: () => null,
    generic: 'Lineups open once the season starts.',
  },
  // Adds, drops and claims (roster_add_drop_internal / waiver_claim_submit_internal, 157)
  {
    id: 'add-locked',
    migration: '157_played_lock.sql',
    fragments: ['is locked for adds — kicked off at', 'no in-game pickups'],
    render: (m) => pick(m, at(`${NAME_ID} is locked for adds`), (x) => `${x[1]}’s game has started — you can pick him up after the week’s games end.`),
    generic: GAME_STARTED_ADD,
  },
  {
    id: 'drop-locked',
    migration: '157_played_lock.sql',
    fragments: ['is locked for drops — kicked off at', 'no dropping a player mid-game'],
    render: (m) => pick(m, at(`${NAME_ID} is locked for drops`), (x) => `${x[1]}’s game has started — you can’t drop him until the week’s games end.`),
    generic: 'That player’s game has started — you can’t drop him until the week’s games end.',
  },
  {
    id: 'roster-full',
    migration: '157_played_lock.sql',
    fragments: ["'s roster is full (", 'include a drop in the same move'],
    render: (m) => pick(m, /roster is full \((\d+) of (\d+)/, (x) => `Your roster is full (${x[1]}/${x[2]}). Pick a player to drop.`),
    generic: 'Your roster is full. Pick a player to drop.',
  },
  {
    id: 'on-waivers-until',
    migration: '157_played_lock.sql',
    fragments: ['is on waivers until the waiver run at', 'put in a waiver claim'],
    render: (m) => pick(m, at(`${NAME_ID} is on waivers until the waiver run at [^()]*? \\(([^()]+)\\)`), (x) => `${x[1]} is on waivers until ${x[2]}. Put in a claim instead.`),
    generic: 'That player is on waivers. Put in a claim instead.',
  },
  {
    id: 'claim-only',
    migration: '157_played_lock.sql',
    fragments: ['is claim-only right now', 'put in a waiver claim instead'],
    render: (m) => pick(m, at(`${NAME_ID} is claim-only right now`), (x) => `${x[1]} is on waivers right now. Put in a claim instead.`),
    generic: 'That player is on waivers right now. Put in a claim instead.',
  },
  {
    id: 'already-rostered',
    migration: '157_played_lock.sql',
    fragments: ['is already on', "'s roster in this league — a player is on ONE roster per league"],
    render: (m) => pick(m, at(`${NAME_ID} is already on (.+?)'s roster in this league`), (x) => `${x[1]} is already on ${x[2]}.`),
    generic: 'That player is already on a team in this league.',
  },
  {
    id: 'claim-already-rostered',
    migration: '157_played_lock.sql',
    fragments: ['only an unowned player can be claimed'],
    render: (m) => pick(m, at(`${NAME_ID} is already on (.+?) — a player`), (x) => `${x[1]} is already on ${x[2]}. You can only claim free agents.`),
    generic: 'That player is already on a team. You can only claim free agents.',
  },
  {
    id: 'rostered-moment-ago',
    migration: '157_played_lock.sql',
    fragments: ['was rostered by another team in this league a moment ago'],
    render: (m) => pick(m, at(`${NAME_ID} was rostered by another team`), (x) => `${x[1]} was just picked up by another team.`),
    generic: 'That player was just picked up by another team.',
  },
  {
    id: 'week-pickup-cap',
    migration: '157_played_lock.sql',
    fragments: ['acquisitions in week', 'no more adds this week'],
    render: (m) => pick(m, /has used \d+ of (\d+) acquisitions in week (\d+)/, (x) => `You’ve used all ${x[1]} pickup${s(x[1])} for week ${x[2]}.`),
    generic: 'You’ve used all your pickups for this week.',
  },
  {
    id: 'season-pickup-cap',
    migration: '157_played_lock.sql',
    fragments: ['acquisitions this season', 'no more adds this season'],
    render: (m) => pick(m, /has used \d+ of (\d+) acquisitions this season/, (x) => `You’ve used all ${x[1]} pickup${s(x[1])} for the season.`),
    generic: 'You’ve used all your pickups for the season.',
  },
  {
    id: 'move-already-submitted',
    migration: '157_played_lock.sql',
    fragments: ['already names a', 'transaction in this league'],
    render: () => null,
    generic: 'That move was already submitted.',
  },
  {
    id: 'claim-already-submitted',
    migration: '157_played_lock.sql',
    fragments: ['already names a', 'for another request in this league'],
    render: () => null,
    generic: 'That claim was already submitted.',
  },
  {
    id: 'adds-not-in-season',
    migration: '157_played_lock.sql',
    fragments: ['rosters change through add/drop only while in_season or in playoffs'],
    render: () => null,
    generic: 'Adds and drops open once the season starts.',
  },
  {
    id: 'no-waivers',
    migration: '157_played_lock.sql',
    fragments: ['this league has no waivers (waiver type "none_fcfs")'],
    render: () => null,
    generic: 'This league has no waivers — just add him.',
  },
  {
    id: 'min-bid',
    migration: '157_played_lock.sql',
    fragments: ["is below this league's minimum bid of $"],
    render: (m) => pick(m, /minimum bid of \$(\d+)/, (x) => `The minimum bid is $${x[1]}.`),
    generic: 'That bid is below the league’s minimum.',
  },
  // Trades (162 / 174 / 155)
  {
    id: 'trade-deadline',
    migration: '174_commish_trade_powers.sql',
    fragments: ['the trade deadline has passed — trades could be proposed until week'],
    render: (m) => pick(m, /until week (\d+) began \(([^;()]+);/, (x) => `The trade deadline has passed — trades closed when week ${x[1]} began (${x[2].trim()}).`),
    generic: 'The trade deadline has passed.',
  },
  {
    id: 'trades-not-in-season',
    migration: '174_commish_trade_powers.sql',
    fragments: ['trades are made only while the league is in season or in the playoffs'],
    render: () => null,
    generic: 'Trades open once the season starts.',
  },
  {
    id: 'trade-cancel-not-yours',
    migration: '174_commish_trade_powers.sql',
    fragments: ['only the team that proposed a trade can cancel it'],
    render: () => null,
    generic: 'Only the team that sent this offer can cancel it — you can reject it instead.',
  },
  {
    id: 'trade-answer-not-yours',
    migration: '174_commish_trade_powers.sql',
    fragments: ['only the team that received a trade can'],
    render: () => null,
    generic: 'Only the team that got this offer can accept or reject it — you can cancel it instead.',
  },
  {
    id: 'trade-overflow',
    migration: '162_trade_preview.sql',
    fragments: ['players after this trade —', 'more drop(s) as part of the trade'],
    render: (m) => pick(m, at("(.+?)'s roster would hold \\d+ players after this trade — (\\d+) more than"), (x) => `${x[1]} would be ${x[2]} over the roster limit — pick ${x[2]} more player${s(x[2])} to drop.`),
    generic: 'A team would be over the roster limit — pick more players to drop.',
  },
  {
    id: 'trade-added-since-agreed',
    migration: '162_trade_preview.sql',
    fragments: ['it has added players since the trade was agreed'],
    render: (m) => pick(m, at("(.+?)'s roster would hold"), (x) => `${x[1]} added players since this trade was agreed and no longer has room — the trade can’t go through.`),
    generic: 'A team added players since this trade was agreed and no longer has room — the trade can’t go through.',
  },
  {
    id: 'trade-no-longer-fits',
    migration: '162_trade_preview.sql',
    fragments: ["'s roster no longer fits this offer"],
    render: (m) => pick(m, at("(.+?)'s roster no longer fits this offer"), (x) => `${x[1]}’s roster is now too full for this offer. Ask ${x[1]} to cancel and resend it with drops.`),
    generic: 'The other team’s roster is now too full for this offer. Ask them to cancel and resend it with drops.',
  },
  {
    id: 'trade-wrong-team',
    migration: '162_trade_preview.sql',
    fragments: ['a trade can only move a player from the team that has him'],
    render: (m) => pick(m, at(`${NAME_ID} is on (.+?)'s roster, not (.+?)'s —`), (x) => `${x[1]} is on ${x[2]}’s roster, not ${x[3]}’s.`),
    generic: 'A player in this trade isn’t on the team giving him.',
  },
  {
    id: 'trade-gives-nothing',
    migration: '162_trade_preview.sql',
    fragments: ['gives nothing in this trade', 'future considerations'],
    render: (m) => pick(m, at('(.+?) gives nothing in this trade'), (x) => `${x[1]} has to give at least one player or FAAB in this trade.`),
    generic: 'Each team has to give at least one player or FAAB in this trade.',
  },
  {
    id: 'trade-no-faab',
    migration: '162_trade_preview.sql',
    fragments: ['FAAB cannot be traded in this league'],
    render: () => null,
    generic: 'This league doesn’t allow FAAB in trades.',
  },
  {
    id: 'trade-drop-not-own',
    migration: '162_trade_preview.sql',
    fragments: ['a team can only drop its own players to make room'],
    render: (m) => pick(m, at(`${NAME_ID} is not on (.+?)'s roster —`), (x) => `${x[1]} isn’t on ${x[2]}’s roster, so he can’t be dropped.`),
    generic: 'That player isn’t on the team’s roster, so he can’t be dropped.',
  },
  {
    id: 'vote-not-manager',
    migration: '155_trade_league_vote.sql',
    fragments: ["only a team's manager votes on a trade"],
    render: () => null,
    generic: 'Only team managers can vote on trades.',
  },
  {
    id: 'vote-own-trade',
    migration: '155_trade_league_vote.sql',
    fragments: ['the two teams in a trade do not vote on it'],
    render: () => null,
    generic: 'Teams in the trade don’t vote on it.',
  },
  {
    id: 'vote-not-by-vote',
    migration: '155_trade_league_vote.sql',
    fragments: ['not by a league vote'],
    render: () => null,
    generic: 'This league doesn’t vote on trades.',
  },
  {
    id: 'vote-closed',
    migration: '155_trade_league_vote.sql',
    fragments: ['the review period is over'],
    render: () => null,
    generic: 'Voting on this trade has closed.',
  },
  // Draft room (092 / 095 / 171)
  {
    id: 'auction-max-bid',
    migration: '092_auction_reserve_toggle.sql',
    fragments: ['is over your max bid of $', 'open roster spots at a $'],
    render: (m) => pick(m, /is over your max bid of \$(\d+) — you have \$(\d+) for (\d+) open roster spot/, (x) => `Your max bid is $${x[1]} ($${x[2]} left for ${x[3]} open spot${s(x[3])}).`),
    generic: 'That bid is over your max bid.',
  },
  {
    id: 'auction-roster-complete-bid',
    migration: '092_auction_reserve_toggle.sql',
    fragments: ['your roster is complete — a complete roster cannot bid'],
    render: () => null,
    generic: 'Your roster is full, so you can’t bid.',
  },
  {
    id: 'auction-roster-complete-nominate',
    migration: '095_standalone_mock.sql',
    fragments: ['complete rosters are skipped in the nomination rotation'],
    render: () => null,
    generic: 'Your roster is full, so you can’t nominate or bid.',
  },
  {
    id: 'mock-not-yours',
    migration: '095_standalone_mock.sql',
    fragments: ["this mock draft is another member's solo practice"],
    render: () => null,
    generic: 'This is another member’s practice mock.',
  },
  // League settings (update_league_settings, 169)
  {
    id: 'settings-locked',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['settings are locked once the draft starts'],
    render: () => null,
    generic: 'Settings lock once the draft starts. The commissioner can still change some in season.',
  },
  {
    id: 'settings-teams-seated',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['franchises already seated in this league'],
    render: (m) => pick(m, /below the (\d+) franchises already seated/, (x) => `There are already ${x[1]} teams in the league. Remove a team first.`),
    generic: 'There are already more teams in the league than that. Remove a team first.',
  },
  {
    id: 'settings-playoff-range',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['playoff_start_week must be between 13 and 16'],
    render: () => null,
    generic: 'Playoffs must start between week 13 and week 16.',
  },
  {
    id: 'settings-playoff-after-season',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['playoff_start_week must be the week after the regular season ends'],
    render: (m) => pick(m, /regular season ends — week (\d+) for a/, (x) => `Playoffs must start the week after the regular season — week ${x[1]}.`),
    generic: 'Playoffs must start the week after the regular season.',
  },
  {
    id: 'settings-total-points-playoffs',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['playoff_teams must be 0 for a total-points league'],
    render: () => null,
    generic: 'Total-points leagues have no playoffs. Set playoff teams to 0 or switch to head-to-head.',
  },
  {
    id: 'settings-scoring-template',
    migration: '169_membership_setup_receipts.sql',
    fragments: ['scoring_system_id must reference one of the scoring templates'],
    render: () => null,
    generic: 'Pick one of the standard scoring templates or this league’s custom scoring.',
  },
]

/** Strips every leading `fn_name: ` (trade_check's "%: " names its caller). */
function stripPrefixes(raw: string): string {
  let t = raw.trim()
  for (;;) {
    const next = t.replace(/^[a-z0-9_]+: /, '')
    if (next === t) return t
    t = next
  }
}

/** The phrase-map entry a server message hits, if any (exported for tests). */
export function matchPhrase(raw: string): Phrase | null {
  const msg = stripPrefixes(raw).replace(/’/g, "'")
  return PHRASES.find((p) => p.fragments.every((f) => msg.includes(f))) ?? null
}

/** A server refusal as a league member reads it. */
export function friendlyMessage(raw: string): string {
  const phrase = matchPhrase(raw)
  if (phrase) return phrase.render(stripPrefixes(raw).replace(/’/g, "'")) ?? phrase.generic
  return cleanServerText(raw)
}
