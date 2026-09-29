/**
 * Trade center + trade builder — pure derivation (M5 task L.D3.7; spec §13.3,
 * §16.2 `trade-center` / `trade-builder`, §16.5.2's Trade lifecycle row,
 * §16.5.4's badges; PROGRESS D417 (the read + hooks this consumes), D419;
 * F438, F450, F451, F452).
 *
 * **The server decides; this file only says it.** Every status, reason,
 * countdown, tally and refusal comes from `GET …/trades` (D417(4)) or a verb's
 * answer. Nothing here decides whether a trade is legal, whether a deadline
 * has passed or whether voting is open by reading a clock:
 *
 *   - countdowns are the read's `ms_remaining`, computed at the TimeProvider's
 *     now (`evaluated_at`) — printed as "about N left", never ticked;
 *   - "voting open" is the TALLY's own `closes_at` against the TALLY's own
 *     `evaluated_at` — one clock (R1236), never the review countdown's;
 *   - the trade deadline is the stored WEEK only (F452 — the instant has no
 *     read door; a refused propose / accept names it verbatim);
 *   - there is no legality preview route (no door to `trade_check_internal`),
 *     so the builder sends the offer and, when the server says a roster would
 *     overflow, reads the NUMBER of drops out of that sentence and prompts
 *     for them (`dropsNeeded`) — the refusal itself renders verbatim.
 *
 * Plain fantasy-football words throughout (Chris's rule): "offer", "turned
 * down", "called off", "goes through" — never a status enum on screen.
 */
import type { CommishTradeOp, CommishTradeResult, TradeView, TradeVoteTally, TradesDocument } from '@/lib/leagues/api/trades-service'

// ---------------------------------------------------------------------------
// Where the trade center lives
// ---------------------------------------------------------------------------

/** The trade center, optionally opening the builder toward a team (and a
 *  player on it) — the door from a player row and the team page. */
export function tradesHref(leagueId: string, target?: { teamId?: string | null; playerId?: string | null }): string {
  const params = new URLSearchParams()
  if (target?.teamId) params.set('with', target.teamId)
  if (target?.playerId) params.set('player', target.playerId)
  const qs = params.toString()
  return `/app/leagues/${leagueId}/trades${qs ? `?${qs}` : ''}`
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const TRADES_TITLE = 'Trades'
export const TRADES_PENDING_EMPTY_COPY = 'No trades in progress. Offer one with “Propose a trade” — the other team gets a notification.'
export const TRADES_HISTORY_EMPTY_COPY = 'No finished trades yet — completed, turned-down and called-off trades are listed here.'
export const TRADES_ERROR_TITLE = 'Couldn’t load this league’s trades.'
/** The 503's title — the deploy-before-push state (D417(5)): the database has
 *  no trade objects yet. The body is the route's own sentence. */
export const TRADES_UNAVAILABLE_TITLE = 'Trades aren’t switched on for this league yet'
export const NO_TEAM_TRADE_COPY = 'You don’t manage a team in this league, so you can’t offer trades — but you can follow every trade here.'
export const NOT_IN_SEASON_TRADE_COPY = 'Trades open once the season starts — offers can be made while the league is in season or in the playoffs.'
export const COMMISH_TRADE_MODE_COPY = 'Force a trade through now, veto one that’s waiting, or reverse a completed one — each is logged for the whole league.'
export const NEVER_WHO_VOTED_COPY = 'Votes are secret — the league sees the count, never who voted.'

/** F452: the deadline as its WEEK (the instant is not readable by the app —
 *  the verb's refusal names it). Q76: deadline week N ⇒ offers can be made
 *  and accepted until week N+1 begins. */
export function tradeDeadlineCopy(deadlineWeek: number | null): string {
  if (deadlineWeek === null) return 'No trade deadline — trades are allowed all season.'
  return `Trade deadline: Week ${deadlineWeek} — offers can be made and accepted until Week ${deadlineWeek + 1} begins.`
}

/** How the league reviews an accepted trade (§13.3 / §7.3.5), said plainly. */
export function reviewModeCopy(settings: Pick<TradesDocument['settings'], 'trade_review' | 'trade_review_period_hours'>): string {
  const hours = settings.trade_review_period_hours
  const period = `${hours} hour${hours === 1 ? '' : 's'}`
  switch (settings.trade_review) {
    case 'none':
      return 'An accepted trade goes through at once — there is no review.'
    case 'league_vote':
      return `An accepted trade goes through after ${period} unless enough managers vote to veto it.`
    default:
      return `An accepted trade goes through after ${period} unless the commissioner vetoes it first.`
  }
}

/** What a 🔒 on a trade asset means under this league's rule (Q75 / E35). */
export function lockedAssetTitle(lockBehavior: string): string {
  return lockBehavior === 'reject'
    ? 'His game has started this week — a trade with him is refused until the week’s last game ends.'
    : 'His game has started this week — a trade with him waits and goes through right after the week’s last game ends.'
}

/** A server sentence with its trailing builder citation removed — "(§13.3 /
 *  Q77)", "(E36)" — the same rule `userFacingMessage` applies to a refusal
 *  (a section number is a builder's pointer, not a user's, F116). The words
 *  themselves are the server's, untouched. */
export function plainServerSentence(text: string): string {
  return text.replace(/\s*\((?:[^()]*§[^()]*|[EQRFCD]\d+(?:\s*\/\s*[EQRFCD]?\d+)*)\)\s*$/, '').trim()
}

/** A refusal as a league member reads it (R1244): every builder citation is
 *  taken out of its parentheses — a `§` pointer, a rule code ("E36", "Q76"),
 *  a setting's column name ("trade_deadline_week 11") — and a group left
 *  empty goes entirely; the rest of the server's words stay as sent (the
 *  deadline's date and time survive). Display only: `dropsNeeded` and
 *  `isDeadlineRefusal` still read the raw sentence. */
export function plainRefusal(text: string): string {
  const citation = (part: string) =>
    /§/.test(part) || /\b[EQRFCD]\d+\b/.test(part) || /\b[a-z]+(?:_[a-z]+)+\b/.test(part)
  return text
    .replace(/(\s*)\(([^()]*)\)/g, (_whole, lead: string, inner: string) => {
      const kept = inner.split(';').map((p) => p.trim()).filter((p) => p && !citation(p))
      return kept.length ? `${lead}(${kept.join('; ')})` : ''
    })
    .replace(/\s+([:.,])/g, '$1')
    .trim()
}

// ---------------------------------------------------------------------------
// Time words — from the read's own numbers, never a clock
// ---------------------------------------------------------------------------

/** "about 5 hours", "about 40 minutes", "less than a minute". */
export function durationWords(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'less than a minute'
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `about ${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `about ${days} days`
}

// ---------------------------------------------------------------------------
// A trade's status, in words (F438 — every state 151 / 155 / 156 can leave)
// ---------------------------------------------------------------------------

export type TradeTone = 'accent' | 'caution' | 'positive' | 'negative' | 'neutral'

export interface TradeStatusView {
  label: string
  tone: TradeTone
  /** One sentence under the teams — what happens next, or why it ended. */
  detail: string | null
}

/**
 * The card's status line. `fmt` formats a stored instant for the viewer (the
 * host owns the zone). Every closed trade names its reason — the server's
 * sentence, citation stripped — and never a bare status (C74: a trade never
 * leaves flight without saying why).
 */
export function tradeStatusView(trade: TradeView, fmt: (iso: string) => string): TradeStatusView {
  const reason = trade.status_reason ? plainServerSentence(trade.status_reason) : null
  switch (trade.status) {
    case 'proposed':
      return { label: 'Offer', tone: 'accent', detail: `Waiting for ${trade.recipient.name ?? 'the other team'} to answer.` }
    case 'in_review': {
      const who = trade.review?.mode === 'league_vote' ? 'the league votes to veto it' : 'the commissioner vetoes it'
      const at = trade.review?.ends_at ? fmt(trade.review.ends_at) : null
      const left = trade.review?.ms_remaining != null ? ` (${durationWords(trade.review.ms_remaining)} left)` : ''
      return {
        label: 'Under review',
        tone: 'caution',
        detail: at ? `Goes through ${at}${left} unless ${who}.` : `Goes through when the review ends unless ${who}.`,
      }
    }
    case 'accepted':
      if (trade.deferred) {
        return {
          label: 'Waiting for games to end',
          tone: 'caution',
          detail:
            trade.deferred.until === null
              ? 'Accepted — a player in it has already played this week, so it goes through when the week’s last game ends.'
              : `Accepted — a player in it has already played this week, so it goes through right after the week’s last game ends (${fmt(trade.deferred.until)}).`,
        }
      }
      return { label: 'Accepted', tone: 'caution', detail: 'Accepted — going through.' }
    case 'complete':
      return { label: 'Completed', tone: 'positive', detail: trade.resolved_at ? `Went through ${fmt(trade.resolved_at)}.` : 'Went through.' }
    case 'rejected':
      return { label: reason?.startsWith('countered') ? 'Countered' : 'Turned down', tone: 'neutral', detail: reason ? capitalize(reason) + '.' : null }
    case 'cancelled':
      return { label: 'Called off', tone: 'neutral', detail: reason ? capitalize(reason) + '.' : null }
    case 'vetoed':
      return { label: 'Vetoed', tone: 'negative', detail: reason ? capitalize(reason) : 'Vetoed.' }
    case 'invalid':
      return { label: 'No longer valid', tone: 'negative', detail: reason ? capitalize(reason) : 'It could no longer go through.' }
    case 'expired':
      return { label: 'Expired', tone: 'neutral', detail: reason ? capitalize(reason) : 'Still waiting for an answer when the trade deadline passed.' }
    case 'reversed':
      return { label: 'Reversed', tone: 'negative', detail: reason ? capitalize(reason) : 'The commissioner undid this trade — every player went back.' }
  }
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1)
}

// ---------------------------------------------------------------------------
// The league vote (Q77, F450) — the count and the number, never who
// ---------------------------------------------------------------------------

/** R1236: voting is open by the TALLY's own clock — `closes_at` after the
 *  tally's `evaluated_at`, both read in the same database statement. */
export function votingOpen(tally: Pick<TradeVoteTally, 'closes_at' | 'evaluated_at'>): boolean {
  if (tally.closes_at === null) return false
  const closes = Date.parse(tally.closes_at)
  const at = Date.parse(tally.evaluated_at)
  return Number.isFinite(closes) && Number.isFinite(at) && closes > at
}

export interface TallyWords {
  /** "2 veto votes so far". */
  count: string
  /** How many vetoes stop it — the capped number said plainly (F450). */
  rule: string
  /** The viewer's own vote, or why he doesn't vote. */
  mine: string | null
}

export function tallyWords(tally: TradeVoteTally): TallyWords {
  const n = tally.veto_votes
  const count = `${n} veto vote${n === 1 ? '' : 's'} so far`
  let rule: string
  if (tally.eligible_voters === 0) {
    rule = 'No manager can vote on this trade, so it goes through when the review ends.'
  } else if (tally.capped) {
    const all = tally.veto_number === 1 ? 'the 1 manager who can vote vetoes' : `all ${tally.veto_number} managers who can vote veto`
    rule = `It’s vetoed if ${all} it — the league’s setting is ${tally.setting}, but only ${tally.eligible_voters} manager${tally.eligible_voters === 1 ? '' : 's'} can vote on this trade.`
  } else {
    rule = `It’s vetoed at ${tally.veto_number} veto vote${tally.veto_number === 1 ? '' : 's'} — ${tally.eligible_voters} manager${tally.eligible_voters === 1 ? '' : 's'} can vote.`
  }
  let mine: string | null = null
  if (tally.my_vote === 'veto') mine = 'You voted to veto.'
  else if (tally.my_vote === 'approve') mine = 'You voted to let it through.'
  else if (tally.cannot_vote_because === 'party') mine = 'Your team is in this trade, so you don’t vote on it.'
  else if (tally.cannot_vote_because === 'no_team') mine = 'Only managers of teams vote on trades.'
  else if (tally.cannot_vote_because === 'retired') mine = 'A retired team doesn’t vote.'
  else if (tally.cannot_vote_because === 'voting_closed') mine = 'Voting has closed.'
  return { count, rule, mine }
}

// ---------------------------------------------------------------------------
// Who may press what — the buttons only; the server decides every move
// ---------------------------------------------------------------------------

export interface TradeViewer {
  teamId: string | null
  isCommissioner: boolean
  /** The ONE override-mode switch (PROGRESS §3 rule (h)), commissioners only. */
  overrideMode: boolean
}

export interface TradeActionSet {
  accept: boolean
  reject: boolean
  counter: boolean
  cancel: boolean
  vote: boolean
  /** The commissioner's review of a trade under commissioner review (§13.3 —
   *  his job, so outside override mode). */
  reviewApprove: boolean
  reviewVeto: boolean
  /** Override mode (F451): approve / veto a league-vote trade or a trade
   *  waiting for the week's games, force, reverse. */
  overrideApprove: boolean
  overrideVeto: boolean
  force: boolean
  reverse: boolean
  /** The team the commissioner is answering FOR (TD5), when he acts on an
   *  offer for a team that is not his — shown so the act is never ambiguous. */
  actingFor: 'proposer' | 'recipient' | null
}

const NONE: TradeActionSet = {
  accept: false,
  reject: false,
  counter: false,
  cancel: false,
  vote: false,
  reviewApprove: false,
  reviewVeto: false,
  overrideApprove: false,
  overrideVeto: false,
  force: false,
  reverse: false,
  actingFor: null,
}

export function tradeActions(trade: TradeView, viewer: TradeViewer): TradeActionSet {
  const commish = viewer.isCommissioner
  const override = commish && viewer.overrideMode
  const isProposer = viewer.teamId !== null && viewer.teamId === trade.proposer.team_id
  const isRecipient = viewer.teamId !== null && viewer.teamId === trade.recipient.team_id
  switch (trade.status) {
    case 'proposed': {
      // A manager answers his own side; the commissioner in override mode may
      // answer either side (TD5 — "act like any GM"), and force it (D416(4)).
      const recipientSide = isRecipient || (override && !isProposer)
      const proposerSide = isProposer || (override && !isRecipient)
      return {
        ...NONE,
        accept: recipientSide,
        reject: recipientSide,
        counter: recipientSide,
        cancel: proposerSide,
        force: override,
        actingFor: override && !isRecipient && !isProposer ? 'recipient' : null,
      }
    }
    case 'in_review': {
      const mode = trade.review?.mode ?? 'commissioner'
      const canVote = mode === 'league_vote' && trade.tally !== null && trade.tally.can_vote && votingOpen(trade.tally)
      return {
        ...NONE,
        vote: canVote,
        reviewApprove: commish && mode === 'commissioner',
        reviewVeto: commish && mode === 'commissioner',
        overrideApprove: override && mode === 'league_vote',
        overrideVeto: override && mode === 'league_vote',
        force: override,
      }
    }
    case 'accepted':
      // Waiting for the week's last game (or mid-flight): the commissioner may
      // call it off or put it through now — override mode.
      return { ...NONE, overrideVeto: override, force: override }
    case 'expired':
      // D416(4): an offer the deadline closed is closed by timing alone.
      return { ...NONE, force: override }
    case 'complete':
      return { ...NONE, reverse: override }
    default:
      return NONE
  }
}

// ---------------------------------------------------------------------------
// Refusals the builder reads (the legality "preview" is the server's answer)
// ---------------------------------------------------------------------------

/**
 * E36 (148/151's check): "<Team>'s roster would hold N players after this
 * trade — K more than its M spots (…): name K more drop(s) as part of the
 * trade". Returns the team and the number of drops it still needs, or null
 * for any other sentence — including 151's "no longer fits this offer … ask
 * them to cancel" (that team is not the one answering, so no picker opens).
 */
export function dropsNeeded(message: string): { teamName: string; more: number } | null {
  const m = /^(?:[a-z_]+: )?(.+?)['’]s roster would hold \d+ players after this trade — \d+ more than its \d+ spots[^:]*: name (\d+) more drop/.exec(message)
  if (!m) return null
  const more = Number(m[2])
  return Number.isInteger(more) && more > 0 ? { teamName: m[1], more } : null
}

/** Q76: a propose / accept / counter refused because the deadline passed
 *  (151's sentence). The builder then locks and shows the sentence — the
 *  instant is the server's (F452). */
export function isDeadlineRefusal(message: string): boolean {
  return /trade deadline has passed/i.test(message)
}

/** The drop-picker prompt for a team the server says overflows. */
export function dropsPromptCopy(more: number): string {
  return `Pick ${more} player${more === 1 ? '' : 's'} to drop so your roster fits — ${more === 1 ? 'he is' : 'they are'} dropped only if the trade goes through.`
}

// ---------------------------------------------------------------------------
// The builder's legs
// ---------------------------------------------------------------------------

export type BuilderLeg = { playerId: string; fromTeamId: string } | { faabAmount: number; fromTeamId: string }

export interface BuilderSides {
  fromTeamId: string
  toTeamId: string
  /** Players the offering team gives. */
  give: readonly string[]
  /** Players the offering team asks for. */
  get: readonly string[]
  faabGive: number | null
  faabGet: number | null
}

/** The legs sent (148's leg shape: from one of the two teams). */
export function builderLegs(sides: BuilderSides): BuilderLeg[] {
  const legs: BuilderLeg[] = [
    ...sides.give.map((playerId) => ({ playerId, fromTeamId: sides.fromTeamId })),
    ...sides.get.map((playerId) => ({ playerId, fromTeamId: sides.toTeamId })),
  ]
  if (sides.faabGive !== null && sides.faabGive > 0) legs.push({ faabAmount: sides.faabGive, fromTeamId: sides.fromTeamId })
  if (sides.faabGet !== null && sides.faabGet > 0) legs.push({ faabAmount: sides.faabGet, fromTeamId: sides.toTeamId })
  return legs
}

/** A whole-dollar FAAB box: blank = none, else a whole number ≥ 1 (148's
 *  leg bound; the balance is the server's check). NaN = not a number. */
export function parseFaab(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, '')
  if (trimmed === '' || trimmed === '0') return null
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

/** What stops the builder's Send button (advice only — the server's check is
 *  the rule). Null = send it. */
export function builderProblem(sides: Partial<BuilderSides> & { faabValid?: boolean }): string | null {
  if (!sides.toTeamId) return 'Pick the team you want to trade with.'
  if (sides.faabValid === false) return 'FAAB is whole dollars.'
  const anything = (sides.give?.length ?? 0) + (sides.get?.length ?? 0) > 0 || (sides.faabGive ?? 0) > 0 || (sides.faabGet ?? 0) > 0
  if (!anything) return 'Pick at least one player (or some FAAB) to trade.'
  return null
}

/** A counter-offer starts from the offer, turned around: the receiving team
 *  now offers — what it was asked for is what it gives. */
export function counterSeed(trade: TradeView): BuilderSides {
  const from = trade.recipient.team_id
  const to = trade.proposer.team_id
  const players = (teamId: string) => trade.items.filter((i) => i.from_team_id === teamId && i.player !== null).map((i) => i.player!.player_id)
  const faab = (teamId: string) => trade.items.find((i) => i.from_team_id === teamId && i.faab_amount !== null)?.faab_amount ?? null
  return { fromTeamId: from, toTeamId: to, give: players(from), get: players(to), faabGive: faab(from), faabGet: faab(to) }
}

// ---------------------------------------------------------------------------
// A trade's sides, in words
// ---------------------------------------------------------------------------

export interface TradeSideView {
  teamId: string
  teamName: string
  gives: Array<{ playerId: string | null; name: string; position: string | null; nflTeam: string | null; faab: number | null }>
  drops: Array<{ playerId: string; name: string }>
}

export function tradeSides(trade: TradeView): [TradeSideView, TradeSideView] {
  const side = (ref: TradeView['proposer']): TradeSideView => ({
    teamId: ref.team_id,
    teamName: ref.name ?? 'A team',
    gives: trade.items
      .filter((i) => i.from_team_id === ref.team_id)
      .map((i) =>
        i.player
          ? { playerId: i.player.player_id, name: i.player.full_name ?? i.player.player_id, position: i.player.position, nflTeam: i.player.nfl_team, faab: null }
          : { playerId: null, name: `$${i.faab_amount} FAAB`, position: null, nflTeam: null, faab: i.faab_amount },
      ),
    drops: trade.drops.filter((d) => d.team_id === ref.team_id).map((d) => ({ playerId: d.player.player_id, name: d.player.full_name ?? d.player.player_id })),
  })
  return [side(trade.proposer), side(trade.recipient)]
}

// ---------------------------------------------------------------------------
// The commissioner's tools (F451) — confirmation, and the answer in words
// ---------------------------------------------------------------------------

export const COMMISH_OP_LABELS: Record<CommishTradeOp, string> = {
  approve: 'Approve',
  veto: 'Veto',
  force: 'Force it through',
  reverse: 'Reverse trade',
}

/**
 * §10.4's confirmation for the two ops that move players at once — force and
 * reverse — as before → after lines, one per player / FAAB amount / drop.
 */
export function commishConfirmLines(trade: TradeView, op: 'force' | 'reverse'): string[] {
  const name = (teamId: string) => (teamId === trade.proposer.team_id ? trade.proposer.name : trade.recipient.name) ?? 'a team'
  const lines: string[] = []
  for (const item of trade.items) {
    const what = item.player ? (item.player.full_name ?? item.player.player_id) : `$${item.faab_amount} FAAB`
    const [before, after] = op === 'force' ? [item.from_team_id, item.to_team_id] : [item.to_team_id, item.from_team_id]
    lines.push(`${what}: ${name(before)} → ${name(after)}`)
  }
  for (const drop of trade.drops) {
    const who = drop.player.full_name ?? drop.player.player_id
    lines.push(op === 'force' ? `${who}: dropped by ${name(drop.team_id)}` : `${who}: back to ${name(drop.team_id)}`)
  }
  return lines
}

export function commishConfirmTitle(op: 'force' | 'reverse'): string {
  return op === 'force' ? 'Force this trade through now?' : 'Reverse this trade?'
}

export function commishConfirmCopy(op: 'force' | 'reverse'): string {
  return op === 'force'
    ? 'It goes through now — past any review, league vote, trade deadline or game-day lock. Every player must still be on the team giving him, and both rosters must fit.'
    : 'Every player goes back to the team that had him, every dropped player comes back, and any FAAB is returned. Past weeks’ scores stay as they are.'
}

/** One `bypassed` entry in words (156: `review_period`, `league_vote`,
 *  `trade_deadline`, `game_day_lock:<player_id>`). */
export function bypassedWords(entry: string, playerName: (id: string) => string | null): string {
  if (entry === 'review_period') return 'the rest of the review period'
  if (entry === 'league_vote') return 'the league vote'
  if (entry === 'trade_deadline') return 'the trade deadline'
  if (entry.startsWith('game_day_lock:')) {
    const id = entry.slice('game_day_lock:'.length)
    return `${playerName(id) ?? 'a player'}’s game-day lock`
  }
  return entry.replace(/_/g, ' ')
}

function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** The commissioner's answer, in words. */
export function commishOutcomeCopy(result: Pick<CommishTradeResult, 'outcome' | 'bypassed' | 'no_changes_why' | 'score_stale'>, playerName: (id: string) => string | null): string {
  switch (result.outcome) {
    case 'approved':
      return 'Approved — the trade went through.'
    case 'approved_deferred':
      return 'Approved — a player in it has already played this week, so it goes through right after the week’s last game ends.'
    case 'vetoed':
      return 'Vetoed — the trade is off, and both managers were told.'
    case 'forced': {
      const past = result.bypassed.map((b) => bypassedWords(b, playerName))
      return `Forced through${past.length > 0 ? ` — past ${joinWords(past)}` : ''}.${result.score_stale ? ' The week’s scores are being updated.' : ''}`
    }
    case 'reversed':
      return `Reversed — every player is back with the team that had him.${result.score_stale ? ' The week’s scores are being updated.' : ''}`
    case 'no_change':
      return result.no_changes_why ? `Nothing changed — ${plainServerSentence(result.no_changes_why)}` : 'Nothing changed — it was already that way.'
  }
}

// ---------------------------------------------------------------------------
// The tabs
// ---------------------------------------------------------------------------

export function splitTrades(trades: readonly TradeView[]): { pending: TradeView[]; history: TradeView[] } {
  return { pending: trades.filter((t) => t.in_flight), history: trades.filter((t) => !t.in_flight) }
}

/** The 503 the route answers when the database has no trade objects (D417(5)). */
export function isTradesUnavailable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status: unknown }).status === 503
}
