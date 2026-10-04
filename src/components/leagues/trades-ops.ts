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
 *   - the trade deadline is the server's instant and its `passed` (L.D3.12,
 *     migration 162's `trade_deadline` — F452); before 162 is pushed, the
 *     stored WEEK only, and a refused propose / accept names it verbatim;
 *   - the legality preview is migration 162's `trade_preview` (F462) — the
 *     verbs' own `trade_check_internal`, asked before Send / Accept, so an
 *     offer the league would refuse cannot be built (`builderGate`,
 *     `acceptGate`). Before 162 the builder sends the offer and, when the
 *     server says a roster would overflow, reads the NUMBER of drops out of
 *     that sentence and prompts for them (`dropsNeeded`) — the refusal
 *     itself renders verbatim, and still does as the backstop.
 *
 * Plain fantasy-football words throughout (Chris's rule): "offer", "turned
 * down", "called off", "goes through" — never a status enum on screen.
 */
import { userFacingMessage } from '@/lib/leagues/api/client-fetch'
import type { TradePreviewState } from '@/hooks/use-trade-preview'
import type { RosterTeam } from '@/lib/leagues/api/rosters-service'
import type {
  CommishTradeOp,
  CommishTradeResult,
  TradeDeadlineView,
  TradeView,
  TradeVoteTally,
  TradesDocument,
} from '@/lib/leagues/api/trades-service'

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
export const NEVER_WHO_VOTED_COPY = 'Votes are secret — the league sees the count, never who voted.'

/** The deadline as its WEEK — the words when the instant is not readable yet
 *  (before migration 162 is pushed, D426; F452's first answer). Q76:
 *  deadline week N ⇒ offers can be made and accepted until week N+1 begins. */
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

/** What a 🔒 on a trade asset means under this league's rule (Q75 / E35) —
 *  what WILL happen, never a ban: the lock is judged when the trade goes
 *  through (151's executor), so a started player can always be offered
 *  (R1283). */
export function lockedAssetTitle(lockBehavior: string): string {
  return lockBehavior === 'reject'
    ? 'His game has started this week — this league won’t let a trade with him go through until the week’s games are over.'
    : 'His game has started this week — a trade with him waits and goes through right after the week’s last game ends.'
}

// ---------------------------------------------------------------------------
// L.D3.12 — prevent, don't refuse (Chris 2026-09-29: "there is no such thing
// as trade that isn't legal"). The rules stay the server's: the deadline and
// the legality preview are migration 162's reads (`trade_deadline`,
// `trade_preview` over the verbs' own `trade_deadline_internal` /
// `trade_check_internal`); these functions only turn their answers into
// which buttons work and why — in plain words.
// ---------------------------------------------------------------------------

/** The deadline line from the SERVER's instant (F452). `view` null = not
 *  readable yet (162 not pushed) → the week-only words. */
export function tradeDeadlineLine(deadlineWeek: number | null, view: TradeDeadlineView | null, fmt: (iso: string) => string): string {
  if (view === null) return tradeDeadlineCopy(deadlineWeek)
  const week = view.deadline_week
  if (week === null) return 'No trade deadline — trades are allowed all season.'
  if (view.deadline_at === null) return `Trade deadline: Week ${week} — that’s the last week, so trades are allowed all season.`
  if (view.passed) return `The trade deadline has passed — trades closed ${fmt(view.deadline_at)}, when Week ${week + 1} began.`
  return `Trade deadline: ${fmt(view.deadline_at)}, when Week ${week + 1} begins — offers can be made and accepted until then.`
}

export const DEADLINE_PASSED_TITLE = 'Trades are closed for the season.'

/** Past the deadline, where the Propose door used to be (§13.3 / Q76: the
 *  commissioner's own roster tools still work, §15.4). */
export function deadlinePassedCopy(view: TradeDeadlineView, fmt: (iso: string) => string): string {
  const when = view.deadline_at ? ` on ${fmt(view.deadline_at)}` : ''
  const week = view.deadline_week !== null ? `, when Week ${view.deadline_week + 1} began` : ''
  return `The trade deadline passed${when}${week}. Offers can’t be made, accepted or countered now — the commissioner can still move players.`
}

/** Past the deadline, on an offer still waiting for an answer. */
export function offerPastDeadlineCopy(view: TradeDeadlineView, fmt: (iso: string) => string): string {
  const when = view.deadline_at ? ` on ${fmt(view.deadline_at)}` : ''
  return `The trade deadline passed${when} — this offer can’t be accepted or countered now. It expires on its own; you can still turn it down.`
}

/** R1282: the check itself failed (not "not pushed yet") — said plainly,
 *  distinct from the before-162 line; the league still checks on send. */
export const PREVIEW_FAILED_COPY = 'Couldn’t check this offer with the league just now — it will still be checked when you send it.'
export const ACCEPT_CHECK_FAILED_COPY = 'Couldn’t check this trade with the league just now — it will still be checked when you accept.'

/** A FAAB box above what the team has (the rosters read's balance — the
 *  preview rechecks it, §13.3). */
export function faabOverBalance(amount: number | null, balance: number | null): boolean {
  return amount !== null && !Number.isNaN(amount) && balance !== null && amount > balance
}

export function faabOverCopy(teamName: string, balance: number): string {
  return `${teamName} has $${balance} of FAAB — offer $${balance} or less.`
}

/** The server's refusal as a league member reads it — the one cleaner
 *  (`userFacingMessage`, D482; it absorbed R1244's `plainRefusal`). */
export function previewRefusalCopy(refusal: string): string {
  return userFacingMessage(refusal)
}

export const SEND_AND_SEE_COPY = 'The league checks both rosters, the deadline and any FAAB when you send — its answer is what you see.'
export const PREVIEW_CHECKING_COPY = 'Checking the offer with the league…'
export const PREVIEW_OK_COPY = 'Both rosters fit and the league will take this offer.'

export interface BuilderGate {
  /** Send is enabled. */
  canSend: boolean
  /** Why not — or what the league said — in words. */
  reason: string
  /** Drops the offering team still has to pick (E36), from the league's answer. */
  mustDrop: number
  /** The receiving team would be over by this many — it picks them when it accepts. */
  recipientMustDrop: number
  /** The league checked this offer (162) — false = send-and-see (before 162,
   *  or the check failed). */
  checked: boolean
  /** R1282: the check failed — shown as such, never as "not updated yet". */
  failed?: boolean
}

/**
 * The builder's Send gate (L.D3.12). `problem` / `faabProblem` are the
 * builder's own advice (nothing picked, FAAB over what the team has); the
 * rest is the league's answer. Before 162 (`unavailable`) Send works exactly
 * as it did — the verb's refusal is the answer (D419).
 */
export function builderGate(input: {
  problem: string | null
  faabProblem: string | null
  preview: TradePreviewState
  /** "your roster" for the viewer's own team, else the team's name. */
  fromWords: string
  toName: string
}): BuilderGate {
  const none = { mustDrop: 0, recipientMustDrop: 0 }
  if (input.problem) return { canSend: false, reason: input.problem, checked: false, ...none }
  if (input.faabProblem) return { canSend: false, reason: input.faabProblem, checked: false, ...none }
  const p = input.preview
  if (p.state === 'unavailable' || p.state === 'off') return { canSend: p.state === 'unavailable', reason: SEND_AND_SEE_COPY, checked: false, ...none }
  if (p.state === 'failed') return { canSend: true, reason: PREVIEW_FAILED_COPY, checked: false, failed: true, ...none }
  const answer = p.state === 'ready' ? p.preview : p.last
  const counts = {
    mustDrop: answer?.rosters?.proposer.must_drop ?? 0,
    recipientMustDrop: answer?.rosters?.recipient.must_drop ?? 0,
  }
  if (p.state === 'checking') return { canSend: false, reason: PREVIEW_CHECKING_COPY, checked: true, ...counts }
  const v = p.preview
  if (!v.in_season) return { canSend: false, reason: NOT_IN_SEASON_TRADE_COPY, checked: true, ...counts }
  if (v.deadline.passed) return { canSend: false, reason: 'The trade deadline has passed — offers can’t be made now.', checked: true, ...counts }
  if (v.refusal) return { canSend: false, reason: previewRefusalCopy(v.refusal), checked: true, ...counts }
  if (counts.mustDrop > 0) {
    return { canSend: false, reason: `Pick ${counts.mustDrop} more player${counts.mustDrop === 1 ? '' : 's'} to drop so ${input.fromWords} fits.`, checked: true, ...counts }
  }
  if (!v.ok) return { canSend: false, reason: 'The league wouldn’t take this offer as it stands.', checked: true, ...counts }
  const theirs =
    counts.recipientMustDrop > 0
      ? ` ${input.toName} would be ${counts.recipientMustDrop} over, so they’ll pick ${counts.recipientMustDrop === 1 ? 'a player' : `${counts.recipientMustDrop} players`} to drop when they accept.`
      : ''
  return { canSend: true, reason: `${PREVIEW_OK_COPY}${theirs}`, checked: true, ...counts }
}

/** "your roster" / "Andy One's roster" — who the drops are for. */
export function rosterWords(teamName: string | null, own: boolean): string {
  return own ? 'your roster' : `${teamName ?? 'the team'}’s roster`
}

/** The drop picker's prompt when the league says drops are needed. */
export function dropsNeededCopy(more: number, words: string): string {
  return `${capitalize(words)} would be over its size — pick ${more} more player${more === 1 ? '' : 's'} to drop. ${more === 1 ? 'He is' : 'They are'} dropped only if the trade goes through.`
}

export type AcceptGateState = 'fallback' | 'failed' | 'checking' | 'ready' | 'needs_drops' | 'blocked'

export interface AcceptGate {
  state: AcceptGateState
  /** Drops the receiving team still has to pick. */
  mustDrop: number
  /** Why Accept is off (blocked / checking), in words. */
  reason: string | null
  /** Blocked because the deadline passed — Counter is off too. */
  pastDeadline: boolean
}

/**
 * The Accept gate on an offer (L.D3.12). The receiving manager picks the
 * drops his roster needs AS PART
 * of accepting — the picker is there before he presses anything, never a
 * reaction to a refusal.
 *
 *   - past the deadline (the server's `passed`) → blocked, Counter too;
 *   - `reject` league + a player in the offer already played this week +
 *     review `none` (the accept would run the trade at once, and it would
 *     fail by name — Q75 / E35) → blocked until the week's games are over;
 *   - the league's answer: out of season / a refusal / the OFFERING team no
 *     longer fits (F414 — only it can fix that) → blocked; the receiving
 *     team over its size → needs_drops (K); otherwise ready.
 *   - before 162 (`unavailable`) → fallback: today's Accept / Accept with
 *     drops, the verb's refusal as the answer (D419); the check itself
 *     failing → `failed`: the same buttons, and the card says so (R1282).
 */
export function acceptGate(input: {
  preview: TradePreviewState
  deadline: TradeDeadlineView | null
  lockBehavior: string
  review: string
  lockedNames: readonly string[]
  proposerName: string
  fmt: (iso: string) => string
}): AcceptGate {
  const deadline = input.deadline?.passed ? input.deadline : input.preview.state === 'ready' && input.preview.preview.deadline.passed ? input.preview.preview.deadline : null
  if (deadline) return { state: 'blocked', mustDrop: 0, reason: offerPastDeadlineCopy(deadline, input.fmt), pastDeadline: true }
  if (input.lockBehavior === 'reject' && input.review === 'none' && input.lockedNames.length > 0) {
    const who = input.lockedNames.join(', ')
    return {
      state: 'blocked',
      mustDrop: 0,
      reason: `${who} ${input.lockedNames.length === 1 ? 'has' : 'have'} already played this week — this league doesn’t let a trade go through until the week’s games are over. You can accept once they are.`,
      pastDeadline: false,
    }
  }
  const p = input.preview
  if (p.state === 'unavailable' || p.state === 'off') return { state: 'fallback', mustDrop: 0, reason: null, pastDeadline: false }
  // R1282: the check failed — the D419 buttons (the verb decides), said.
  if (p.state === 'failed') return { state: 'failed', mustDrop: 0, reason: ACCEPT_CHECK_FAILED_COPY, pastDeadline: false }
  const answer = p.state === 'ready' ? p.preview : p.last
  const mustDrop = answer?.rosters?.recipient.must_drop ?? 0
  if (p.state === 'checking') return { state: 'checking', mustDrop, reason: PREVIEW_CHECKING_COPY, pastDeadline: false }
  const v = p.preview
  if (!v.in_season) return { state: 'blocked', mustDrop: 0, reason: NOT_IN_SEASON_TRADE_COPY, pastDeadline: false }
  if (v.refusal) return { state: 'blocked', mustDrop: 0, reason: previewRefusalCopy(v.refusal), pastDeadline: false }
  if ((v.rosters?.proposer.must_drop ?? 0) > 0) {
    return {
      state: 'blocked',
      mustDrop: 0,
      reason: `This offer no longer fits ${input.proposerName}’s roster — they’ve added players since sending it. Ask them to call it off and send a new one.`,
      pastDeadline: false,
    }
  }
  if (mustDrop > 0) return { state: 'needs_drops', mustDrop, reason: null, pastDeadline: false }
  if (!v.ok) return { state: 'blocked', mustDrop: 0, reason: 'The league wouldn’t take this trade as it stands.', pastDeadline: false }
  return { state: 'ready', mustDrop: 0, reason: null, pastDeadline: false }
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
  const reason = trade.status_reason ? userFacingMessage(trade.status_reason) : null
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
      return { label: trade.status_reason?.startsWith('countered') ? 'Countered' : 'Turned down', tone: 'neutral', detail: reason ? capitalize(reason) + '.' : null }
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
  /** The league is in season or in the playoffs (174 fix round 2, R1414).
   *  Outside them the server takes no accept / counter (151's respond gate)
   *  and no commissioner tool (the executor's gate; 174's veto gate — Chris
   *  2026-09-30: "Locked once complete"), so none is offered. */
  inSeason: boolean
}

/** What the card knows about the trade's teams beyond the trade itself. */
export interface TradeTeamsContext {
  /** The proposing team has a manager (the rosters read's `manager_user_id`,
   *  D339). A counter-offer is a new offer TO it, and only a team's own
   *  manager answers an offer, so without one there is no Counter (174 fix
   *  round 2, R1413 — the server refuses it by name too). Unknown (the
   *  rosters not read yet) counts as no. */
  proposerHasManager: boolean
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
   *  waiting for the week's games, force. Only ever on an ACCEPTED trade
   *  (Chris 2026-09-30 — L.D3.16 / D463: no answering an offer for a team,
   *  no force on an offer, no reverse). */
  overrideApprove: boolean
  overrideVeto: boolean
  force: boolean
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
}

export function tradeActions(trade: TradeView, viewer: TradeViewer, teams: TradeTeamsContext): TradeActionSet {
  // R1414: outside in_season / playoffs the commissioner has no tool on any
  // trade — the server refuses approve / force (the executor) and veto (174).
  const commish = viewer.isCommissioner && viewer.inSeason
  const override = commish && viewer.overrideMode
  const isProposer = viewer.teamId !== null && viewer.teamId === trade.proposer.team_id
  const isRecipient = viewer.teamId !== null && viewer.teamId === trade.recipient.team_id
  switch (trade.status) {
    case 'proposed':
      // An offer is the two teams' own: the receiving manager answers it, the
      // proposing manager may call it off. The commissioner has no move on it
      // (Chris 2026-09-30: "A commissioner cannot do anything to a trade
      // unless it's already been accepted" — L.D3.16); a commissioner who
      // manages one of the teams answers as its manager. Accept and Counter
      // only in season / the playoffs (the server's gate — reject and cancel
      // stay open, R1414); Counter only toward a proposer with a manager
      // (R1413).
      return {
        ...NONE,
        accept: isRecipient && viewer.inSeason,
        reject: isRecipient,
        counter: isRecipient && viewer.inSeason && teams.proposerHasManager,
        cancel: isProposer,
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
    // An offer the deadline closed was never accepted, and a completed trade
    // stands ("Remove reverse") — no commissioner move on either (D463).
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

/**
 * Who an offer can go to (174 fix round, R1410 — a consequence of Chris's
 * 2026-09-30 ruling; PROGRESS D463): only the receiving team's own manager
 * answers an offer now, so a team with NO manager (an open or orphaned seat —
 * the rosters read's `manager_user_id`, D339's predicate) is not offered, nor
 * the offering team itself or a retired franchise. The server refuses such an
 * offer by name too; this list makes it impossible to build (prevent, don't
 * refuse).
 */
export function tradePartners(teams: readonly RosterTeam[], fromTeamId: string): RosterTeam[] {
  return teams.filter((t) => t.team_id !== fromTeamId && t.status !== 'retired' && t.manager_user_id !== null)
}

/** The builder when no other team has a manager to answer an offer. */
export const NO_TRADE_PARTNER_COPY =
  'No other team has a manager right now, so there’s no one to answer a trade offer. Offers open up again once another team has a manager.'

/** A deep link toward a team with no manager (a player row, an old link). */
export function noManagerCopy(teamName: string): string {
  return `${teamName} has no manager right now, so there’s no one to answer a trade offer. Pick another team.`
}

/**
 * Whether the builder can open yet (L.E1.36 fix round, R1419 — PROGRESS
 * D464): the builder's partners and both columns ARE the rosters read, so it
 * mounts only once that read has answered. Until then the door is a skeleton;
 * a failed read (with nothing read before it) is an error with a retry —
 * never the builder over an empty list, which would claim "no other team has
 * a manager" (CLAUDE.md: a load or an error never renders as a plausible
 * empty state). A re-read that fails over rows already read keeps the builder
 * on those rows.
 */
export function rostersGate(rosters: { hasData: boolean; isPending: boolean; isError: boolean }): 'loading' | 'error' | 'ready' {
  if (rosters.hasData) return 'ready'
  if (rosters.isError) return 'error'
  return 'loading'
}

/** The builder's door when the rosters read failed. */
export const BUILDER_ROSTERS_ERROR_TITLE = 'Couldn’t load the league’s rosters, so the trade builder can’t open.'

/**
 * The builder's door, derived from the CURRENT team list every render
 * (L.E1.36 F554 + fix round R1420 — PROGRESS D464):
 *
 *   - partners come from the current list — in a propose only a team with a
 *     manager (`tradePartners`, R1410); in a counter, the other non-retired
 *     teams (its partner is fixed);
 *   - the team is the manager's explicit pick when he made one, else the
 *     door's (`initial.toTeamId`) — and only while it is a partner in the
 *     current list; a target with no manager is no pick plus the team to name
 *     (`unanswerable`, `noManagerCopy`);
 *   - a counter is fixed to the proposer — a pick never moves it;
 *   - the "they give" picks are the manager's own once he touched them, else
 *     the door's `initial.get` while the door's team stands;
 *   - `noPartner`: a propose with nobody to offer to (NO_TRADE_PARTNER_COPY).
 */
export interface BuilderDoor {
  partners: RosterTeam[]
  toTeamId: string | null
  get: string[]
  unanswerable: RosterTeam | null
  noPartner: boolean
}

export function builderDoor(args: {
  mode: 'propose' | 'counter'
  teams: readonly RosterTeam[]
  fromTeamId: string
  initial?: { toTeamId?: string; get?: readonly string[] }
  /** The team the manager picked in "Trade with" (null = none yet). */
  pickedTo: string | null
  /** The "they give" picks once the manager touched them (null = untouched). */
  pickedGet: readonly string[] | null
}): BuilderDoor {
  const { mode, teams, fromTeamId, initial, pickedTo, pickedGet } = args
  const partners =
    mode === 'counter' ? teams.filter((t) => t.team_id !== fromTeamId && t.status !== 'retired') : tradePartners(teams, fromTeamId)
  const fromDoor = mode === 'counter' || pickedTo === null
  const wanted = fromDoor ? (initial?.toTeamId ?? null) : pickedTo
  const toTeamId = wanted !== null && partners.some((t) => t.team_id === wanted) ? wanted : null
  const unanswerable =
    mode === 'propose' && wanted !== null && toTeamId === null
      ? (teams.find((t) => t.team_id === wanted && t.team_id !== fromTeamId && t.status !== 'retired' && t.manager_user_id === null) ?? null)
      : null
  const get = pickedGet !== null ? [...pickedGet] : fromDoor && toTeamId !== null ? [...(initial?.get ?? [])] : []
  return { partners, toTeamId, get, unanswerable, noPartner: mode === 'propose' && partners.length === 0 }
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
}

/**
 * §10.4's confirmation for the op that moves players at once — force (the
 * only one since 174 removed reverse) — as before → after lines, one per
 * player / FAAB amount / drop.
 */
export function commishConfirmLines(trade: TradeView): string[] {
  const name = (teamId: string) => (teamId === trade.proposer.team_id ? trade.proposer.name : trade.recipient.name) ?? 'a team'
  const lines: string[] = []
  for (const item of trade.items) {
    const what = item.player ? (item.player.full_name ?? item.player.player_id) : `$${item.faab_amount} FAAB`
    lines.push(`${what}: ${name(item.from_team_id)} → ${name(item.to_team_id)}`)
  }
  for (const drop of trade.drops) {
    const who = drop.player.full_name ?? drop.player.player_id
    lines.push(`${who}: dropped by ${name(drop.team_id)}`)
  }
  return lines
}

export const COMMISH_CONFIRM_TITLE = 'Force this trade through now?'

/** 174: force is for an accepted trade only, which the deadline never binds
 *  (Q76), so the deadline is not named. */
export const COMMISH_CONFIRM_COPY =
  'It goes through now — past any review, league vote or game-day lock. Every player must still be on the team giving him, and both rosters must fit.'

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
    case 'no_change':
      return result.no_changes_why ? `Nothing changed — ${userFacingMessage(result.no_changes_why)}` : 'Nothing changed — it was already that way.'
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

/**
 * THE `?with=` / `?player=` DOOR — PROGRESS F480 / R1268 (D423). One step of
 * the trade center's door, run once per render with the viewer's team as it
 * is known THEN. The team needs the signed-in user, and `useAuth`'s session
 * can land AFTER the league read, so the first renders may carry `null`. The
 * door is decided the FIRST time the team is known — opened toward the
 * linked team (never toward the viewer's own) or not at all — and never
 * again: a later render, or a builder the viewer closed, does not re-open it.
 */
export interface TradeDoorParams {
  with: string | null
  player: string | null
}

export interface TradeDoorOpen {
  fromTeamId: string
  toTeamId: string | null
  getPlayerIds: string[]
}

export function tradeDoorStep(
  decided: boolean,
  myTeamId: string | null,
  door: TradeDoorParams,
): { decided: boolean; open: TradeDoorOpen | null } {
  if (decided || myTeamId === null) return { decided, open: null }
  if ((door.with === null && door.player === null) || door.with === myTeamId) return { decided: true, open: null }
  return { decided: true, open: { fromTeamId: myTeamId, toTeamId: door.with, getPlayerIds: door.player === null ? [] : [door.player] } }
}
