/**
 * Pure helpers for the mobile Home (FieldScout Mobile handoff, m-home.md).
 * No time, DOM or fetch here — callers pass `now` where a clock matters.
 */
import type { ScoringFamily } from '@/components/draft/auction-player-table-ops'
import { healthyIrBlockers } from '@/components/leagues/healthy-ir-ops'
import {
  buildEditorModel,
  currentWeekOf,
  keptStarters,
  lockedPlayerIds,
  placementFromStored,
  weekEditability,
} from '@/components/leagues/lineup-editor-ops'
import { lineupChecks, statusTag, wholeProjectedTotal, type ProjectedTotal, type WeekGame } from '@/components/leagues/my-team-ops'
import { pendingCount, type MTradeOffer } from '@/components/mobile/messages/messages-ops'
import type { ScheduleMatchup, ScheduleWeek } from '@/hooks/use-schedule'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { StandingsRow } from '@/lib/leagues/api/standings-service'
import type { IrSlot, RosterSettings } from '@/lib/leagues/settings/league-settings'

/**
 * The league Trending "See all" opens (m-home §3 `homeTrendAll`: League ›
 * Players, Available): the user's first league with a season in play, else
 * their first league that isn't finished — in the app's league order. None
 * (no leagues, or only finished ones) hides the link.
 */
export function trendSeeAllHref(leagues: readonly { id: string; status: string }[]): string | null {
  const league = leagues.find((l) => seasonInPlay(l.status)) ?? leagues.find((l) => l.status !== 'complete')
  return league ? `/app/leagues/${league.id}/players?status=avail` : null
}

/** "1 list" / "3 lists". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Where a league stands, for its Home card (m-home §2A.5, Q8):
 *  - `pre-draft` (setup / scheduled): the "Pre-draft" pill; the card opens
 *    the League tab's draft home (checklist, countdown, lobby);
 *  - `draft-live` (drafting): a "Draft live" pill; the card opens the draft
 *    room (desktop labels the same status "Draft live");
 *  - `season` (in season, playoffs, finished): the week's matchup; the card
 *    opens the Match tab.
 */
export type LeaguePhase = 'pre-draft' | 'draft-live' | 'season'

export function leaguePhase(status: string): LeaguePhase {
  if (status === 'setup' || status === 'scheduled') return 'pre-draft'
  if (status === 'drafting') return 'draft-live'
  return 'season'
}

/** A season being played — the Matchups header's week comes from one. */
export function seasonInPlay(status: string): boolean {
  return status === 'in_season' || status === 'playoffs'
}

/**
 * A league whose rosters are this season's: drafting, in season or in the
 * playoffs. A finished league's rosters are last season's, so they don't
 * make a player "On your roster".
 */
export function hasCurrentRoster(status: string): boolean {
  return status === 'drafting' || seasonInPlay(status)
}

/** The scoring word on a league card sub ("12-team PPR · Week 5"). */
export function scoringWord(family: ScoringFamily | null): string | null {
  if (family === 'ppr') return 'PPR'
  if (family === 'half_ppr') return 'half PPR'
  if (family === 'standard') return 'standard'
  return null
}

/** A league's size and scoring ("12-team PPR", "10-team half PPR") — the
 *  Home card sub's first part and the Switch league sheet's format. No
 *  scoring word when the league's scoring can't be read ("8-team"). */
export function leagueSize(teamCount: number, family: ScoringFamily | null): string {
  const word = scoringWord(family)
  return `${teamCount}-team${word ? ` ${word}` : ''}`
}

/**
 * League card sub (m-home §5): in season `{N}-team {scoring} · Week {wk}`;
 * before the season (pre-draft or drafting) `{N}-team {scoring} · {season}`.
 * A part with no source is left out rather than guessed.
 */
export function leagueSub(input: {
  teamCount: number
  family: ScoringFamily | null
  beforeSeason: boolean
  season: number
  week: number | null
}): string {
  const when = !input.beforeSeason && input.week !== null ? `Week ${input.week}` : String(input.season)
  return `${leagueSize(input.teamCount, input.family)} · ${when}`
}

/** "Aug 28 · 7:00 PM" — a draft time in the viewer's own clock (the
 *  League tab's "Your time"); "Aug 28" with `dayOnly`; null for an
 *  unreadable instant. `timeZone` is for tests. */
export function draftTimeText(iso: string, timeZone?: string, dayOnly = false): string | null {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(at)
  if (dayOnly) return day
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(at)
  return `${day} · ${time}`
}

/**
 * What a league that hasn't started its season says about its draft — the
 * Home card's pill and the switcher's record slot (gap list §3 #20; the
 * handoff's LEAGUES gives "Draft Aug 28"):
 *  - drafting: "Draft live";
 *  - before the draft, with a draft time still ahead: "Draft Aug 28 · 7:00 PM";
 *  - before the draft with no time set (or one that has gone by without
 *    the draft starting): "Pre-draft";
 *  - in season or later: null — the record and the matchup speak instead.
 * `scheduledAt` is the league's saved draft time (settings
 * `draft.draft_scheduled_at`); `now` is the caller's clock. `dayOnly` gives
 * the handoff's short form, "Draft Aug 28", for the switcher strip, where a
 * full time would crowd out your team's name. `timeZone` is for tests.
 */
export function draftLabel(
  phase: LeaguePhase,
  scheduledAt: string | null | undefined,
  now: number,
  opts: { timeZone?: string; dayOnly?: boolean } = {},
): string | null {
  if (phase === 'season') return null
  if (phase === 'draft-live') return 'Draft live'
  const at = scheduledAt ? Date.parse(scheduledAt) : Number.NaN
  const when = scheduledAt && at > now ? draftTimeText(scheduledAt, opts.timeZone, opts.dayOnly) : null
  return when ? `Draft ${when}` : 'Pre-draft'
}

/**
 * A team's record from the final standings ("2-6", ties "2-6-1"). Before any
 * week is final the RPC says so (`no_final_weeks`) and every record is 0-0;
 * a team missing from a non-empty table has no record to show (null).
 */
export function recordText(
  standings: { standings: Pick<StandingsRow, 'team_id' | 'wins' | 'losses' | 'ties'>[]; reason: string | null } | undefined,
  teamId: string,
): string | null {
  if (!standings) return null
  const row = standings.standings.find((r) => r.team_id === teamId)
  if (row) return `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ''}`
  if (standings.reason === 'no_final_weeks') return '0-0'
  return null
}

/** "Touchdown Tacos (2-6)" — the name alone when there is no record. */
export function teamWithRecord(name: string, record: string | null): string {
  return record ? `${name} (${record})` : name
}

/** "Proj 83.44" — only when every starter has a stored projection (the
 *  matchup page's rule, `wholeProjectedTotal`: a partial sum is never shown). */
export function projText(total: ProjectedTotal | null, filled: number): string | null {
  const whole = wholeProjectedTotal(total, filled)
  return whole === null ? null : `Proj ${whole.toFixed(2)}`
}

/** A signed one-decimal delta with a real minus (U+2212), e.g. "+12.3" / "−4.0". */
export function signedDelta(delta: number): string {
  const text = Math.abs(delta).toFixed(1)
  return delta < 0 ? `−${text}` : `+${text}`
}

/**
 * Trending players — the app's one trend signal (the desktop Home's
 * `TrendingPlayersCard` rule, unchanged): this season's projection against
 * last season's actual points, for relevant players with a real last season.
 * Risers: biggest gain first. Fallers: biggest drop first.
 */
export const TREND_RELEVANCE_FLOOR = 50
export const TREND_MIN_LAST_GAMES = 8

export interface TrendEntry<T> {
  player: T
  delta: number
}

export function trendLists<T extends { projected_pts: number | null; last_pts: number; last_games: number }>(
  players: readonly T[],
  n = 5,
): { risers: TrendEntry<T>[]; fallers: TrendEntry<T>[] } {
  const candidates = players
    .filter((p) => p.projected_pts !== null && p.projected_pts >= TREND_RELEVANCE_FLOOR && p.last_games >= TREND_MIN_LAST_GAMES)
    .map((p) => ({ player: p, delta: (p.projected_pts ?? 0) - p.last_pts }))
  const byDeltaDesc = [...candidates].sort((a, b) => b.delta - a.delta)
  return {
    risers: byDeltaDesc.filter((e) => e.delta > 0).slice(0, n),
    fallers: byDeltaDesc
      .filter((e) => e.delta < 0)
      .reverse()
      .slice(0, n),
  }
}

/** The injury designations Home's "Injury news" reports, most severe last. */
export const INJURY_STATUSES = ['Questionable', 'Doubtful', 'Out', 'IR', 'PUP'] as const

/** Status pill fill + text (m-home §5): Questionable orange, IR ink, both
 *  with white text. Doubtful / Out is the phone's red TINT with red text —
 *  the bright red is for text and small icons, never a fill (Chris,
 *  2026-10-18; the desktop badge already reads this way). */
export function injuryPillClass(status: string): string {
  if (status === 'Questionable') return 'bg-warn text-white'
  if (status === 'Doubtful' || status === 'Out') return 'bg-m-gr text-m-tr'
  return 'bg-m-ink text-white'
}

/**
 * The injury note under a name, from the synced injury fields: body part,
 * the feed's note and practice participation ("Ankle · Sprain · limited
 * practice"). Null when the feed has nothing to say.
 */
export function injuryNote(p: {
  injury_body_part: string | null
  injury_notes: string | null
  practice_participation: string | null
}): string | null {
  const parts: string[] = []
  if (p.injury_body_part) parts.push(p.injury_body_part)
  if (p.injury_notes) parts.push(p.injury_notes)
  if (p.practice_participation) parts.push(`${p.practice_participation.toLowerCase()} practice`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** "today" / "3d ago" / "2w ago" / "4mo ago" — the AI experts shelf's age. */
export function ageText(iso: string, now: number): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

// ---------------------------------------------------------------------------
// The league card's red dot — "something needs you" (Chris, ruling #14,
// 2026-10-15; m-home §2A.5 `hasDot`)
// ---------------------------------------------------------------------------

/**
 * Why a league card carries the red dot, in the order the label names them:
 *  - `trade`: a trade offer sent to the user's team is still waiting on
 *    their answer (`awaitingMe`, as the league Trades screen marks it);
 *  - `ir_spot`: a player who isn't IR-eligible (a healthy one, say) is in
 *    one of the user's IR spots, so their adds and waiver claims are blocked
 *    — the Team tab's "You have an ineligible player in your IR spot."
 *    notice (`healthyIrBlockers`, D593). Chris, 2026-10-27, item #14 ("Should
 *    a Home league card's red dot also light up when a healthy player is
 *    stuck in your IR spot? That now blocks adds and claims, so I'd say
 *    yes."): "go with your recommendations on the rest";
 *  - `out` / `ir`: one of this week's starters is listed Out / on IR;
 *  - `bye`: one of this week's starters is on bye;
 *  - `empty`: a starting slot this week is empty.
 * Chat never lights it — the app keeps no "last read" mark.
 */
export type HomeAlertReason = 'trade' | 'ir_spot' | 'out' | 'ir' | 'bye' | 'empty'

export interface HomeAlertInput {
  /** `leagues.status` — only a season being played can need you. */
  status: string
  myTeamId: string | null
  /** The league's schedule read (week ladder + every pairing); undefined while unread. */
  schedule: { weeks: readonly Pick<ScheduleWeek, 'week' | 'status'>[]; matchups: readonly Pick<ScheduleMatchup, 'week' | 'home_team_id' | 'away_team_id'>[] } | undefined
  /** This league's offers as the trades read returns them
   *  (`leagueTradeOffers`); undefined while unread, failed, or trades off. */
  offers: readonly Pick<MTradeOffer, 'awaitingMe'>[] | undefined
  /** The user's roster and the league's IR spots (the Team tab's notice
   *  reads the same two); undefined while either is unread. */
  irSpots: { roster: readonly RosterPlayer[]; irSlots: readonly IrSlot[] } | undefined
  /** The user's roster, the week's stored `slot_map` (null = no row yet —
   *  every slot open, as the Team tab shows it), the league's slots and the
   *  week's NFL games; undefined while any of them is unread. */
  lineup:
    | {
        roster: readonly RosterPlayer[]
        slotMap: Record<string, string> | null
        settings: RosterSettings
        games: readonly WeekGame[]
      }
    | undefined
}

/**
 * The reasons a league card's dot is on — empty when nothing needs you.
 * Every rule is the league screens' own:
 *  - the IR spot is the Team tab's notice exactly (`healthyIrBlockers` over
 *    the same roster, spots and current week): it lights the dot whenever
 *    the notice shows — his game under way or not, since adds stay blocked
 *    either way (Chris 2026-10-21: "Nothing changes if the player is
 *    locked.") — and not for a player still inside a Restricted IR stint
 *    (no block). It doesn't wait on the lineup reads, the week's
 *    editability or a playoff pairing: adds are blocked all the same;
 *  - the lineup reasons read the current week (`currentWeekOf`, the Home
 *    card's and the Team tab's) and only while its lineup can still change
 *    (`weekEditability` — a finished week has nothing to fix);
 *  - in the playoffs only a team still playing this week (a pairing with an
 *    opponent on the schedule) — a knocked-out team's lineup, or one on a
 *    first-round bye, doesn't count;
 *  - the starters are the Team tab's model of the stored lineup
 *    (`buildEditorModel` over `placementFromStored`); a seat kept for a
 *    dropped starter who already played is filled, not empty (`keptStarters`);
 *  - a starter whose game has kicked off is locked (`lockedPlayerIds`) —
 *    nothing can be done about him, so he doesn't light the dot;
 *  - Out / IR is the status tag beside his name (`statusTag` — Questionable
 *    and Doubtful don't count); bye and empty are the desktop Lineup check's
 *    rules (`lineupChecks`).
 * A read that hasn't landed asserts nothing (no dot from it).
 */
export function homeAlertReasons(input: HomeAlertInput): HomeAlertReason[] {
  const { status, myTeamId, schedule, offers, irSpots, lineup } = input
  if (!seasonInPlay(status) || !myTeamId) return []
  const reasons: HomeAlertReason[] = []
  if (offers && pendingCount(offers) > 0) reasons.push('trade')

  const week = schedule ? currentWeekOf(schedule.weeks) : null
  // With the schedule unread the week is unknown, and a Restricted occupant
  // isn't counted (the Team tab's rule too) — only a certain block lights it.
  if (irSpots && healthyIrBlockers(irSpots.roster, irSpots.irSlots, week).length > 0) reasons.push('ir_spot')

  if (!schedule || week === null || !lineup) return reasons
  if (weekEditability(schedule.weeks, week, week).state !== 'open') return reasons
  if (status === 'playoffs') {
    // A real opponent: a first-round bye is stored as a row with no away
    // team (migration 118), and that week's lineup doesn't count — the Team
    // tab's pairing rule.
    const playing = schedule.matchups.some(
      (m) => m.week === week && m.away_team_id !== null && (m.home_team_id === myTeamId || m.away_team_id === myTeamId),
    )
    if (!playing) return reasons
  }

  const { roster, slotMap, settings, games } = lineup
  const model = buildEditorModel(placementFromStored(slotMap, roster), roster, settings)
  const kept = keptStarters(slotMap, roster)
  const locked = lockedPlayerIds(roster, true)
  // The seats the user can still act on: open ones, and filled ones whose
  // player hasn't kicked off.
  const seats = model.starters.filter((r) => !kept.has(r.slot.key) && !(r.player && locked.has(r.player.player_id)))
  const tags = seats.map((r) => (r.player ? statusTag(r.player.status) : null))
  if (tags.includes('O')) reasons.push('out')
  if (tags.includes('IR')) reasons.push('ir')
  const checks = lineupChecks({ starters: seats, week, games, mine: null, opponent: null })
  const flagged = (id: 'bye' | 'starters') => checks.find((c) => c.id === id)?.tone === 'caution'
  if (flagged('bye')) reasons.push('bye')
  if (flagged('starters')) reasons.push('empty')
  return reasons
}

const ALERT_WORDS: Record<HomeAlertReason, string> = {
  trade: 'a trade offer is waiting for your answer',
  // The Team tab notice's headline (HEALTHY_IR_HEADLINE), as a clause.
  ir_spot: 'you have an ineligible player in your IR spot',
  out: 'a starter is out',
  ir: 'a starter is on IR',
  bye: 'a starter is on bye',
  empty: 'a starting slot is empty',
}

/** The dot's screen-reader label — "Needs your attention: a trade offer is
 *  waiting for your answer and a starter is on bye". Null with no reason. */
export function homeAlertLabel(reasons: readonly HomeAlertReason[]): string | null {
  if (reasons.length === 0) return null
  const words = reasons.map((r) => ALERT_WORDS[r])
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
  return `Needs your attention: ${list}`
}
