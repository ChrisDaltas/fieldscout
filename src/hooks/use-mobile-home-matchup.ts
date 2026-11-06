'use client'

import { useMemo, useState } from 'react'

import { currentWeekOf } from '@/components/leagues/lineup-editor-ops'
import { splitRows, teamName, teamScoreCell } from '@/components/leagues/matchup-view-ops'
import { projectedTotal, wholeProjectedTotal } from '@/components/leagues/my-team-ops'
import { draftLabel, leaguePhase, leagueSub, projText, recordText, teamWithRecord, type LeaguePhase } from '@/components/mobile/home/home-ops'
import { useBoxScore } from '@/hooks/use-box-score'
import { useLeagueScoringFamily } from '@/hooks/use-draft-pool'
import { useLeague } from '@/hooks/use-league'
import { useLeaguePlayerValues } from '@/hooks/use-league-player-values'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import { useMatchups } from '@/hooks/use-matchups'
import { useSchedule } from '@/hooks/use-schedule'
import { useStandings } from '@/hooks/use-standings'
import type { TeamBoxScore } from '@/lib/leagues/api/box-score-service'

/**
 * One Home league card's data (m-home §2A.5 / §5) — every number a stored
 * value read through the league pages' own hooks:
 *  - the week: the league's current week off its ladder (`currentWeekOf`,
 *    the matchup page's rule);
 *  - the pairing and both scores: that week's matchups read (`scoreCell` —
 *    "—" before kickoff, the projected total once the games have started and
 *    no score is in yet — Q108 / D845 — never 0, never "pending");
 *  - the records: the final standings;
 *  - "Proj": each side's starters' stored projections, shown only when every
 *    starter has one (the matchup page's `TotalCell` rule).
 * The client computes no score. No win probability: the app has no model
 * for one (F566), so the card leaves it out.
 */
export interface HomeMatchupSide {
  label: string
  points: string
  /** Q108: `points` is the live week's projected total — no score yet. */
  pointsProjected: boolean
  proj: string | null
}

export interface HomeMatchupCard {
  /** Pre-draft / draft live / season — the pill and where the card goes. */
  phase: LeaguePhase
  /** The pill's words before the season: "Draft Aug 28 · 7:00 PM" when a
   *  draft time is set, "Pre-draft" when not, "Draft live" while drafting
   *  (`draftLabel`); null in season. */
  draft: string | null
  sub: string
  week: number | null
  /** null before the season, while loading, or when the viewer has no game. */
  live: { me: HomeMatchupSide; opp: HomeMatchupSide | null } | null
  loading: boolean
  /** The week's read failed — said on the card, never shown as "no game". */
  error: boolean
}

function sideProj(box: TeamBoxScore | undefined, projOf: (id: string) => number | null): string | null {
  if (!box || !box.lineup) return null
  const ids = box.starters.map((s) => s.player?.id ?? null)
  return projText(projectedTotal(ids, projOf), ids.filter(Boolean).length)
}

/** The side's whole projected total as a number (`wholeProjectedTotal`), for
 *  Q108's "a team with no score shows its projected total". */
function sideProjTotal(box: TeamBoxScore | undefined, projOf: (id: string) => number | null): number | null {
  if (!box || !box.lineup) return null
  const ids = box.starters.map((s) => s.player?.id ?? null)
  return wholeProjectedTotal(projectedTotal(ids, projOf), ids.filter(Boolean).length)
}

/** One side of the card: its score, or — Q108, a live week with no score —
 *  its projected total in the score's place (and then not again below). */
function homeSide(label: string, score: number | null, row: { status: string }, weekStatus: string, box: TeamBoxScore | undefined, projOf: (id: string) => number | null): HomeMatchupSide {
  const cell = teamScoreCell(score, row.status, weekStatus, sideProjTotal(box, projOf))
  const projected = cell.projected === true
  return { label, points: cell.text, pointsProjected: projected, proj: projected ? null : sideProj(box, projOf) }
}

export function useMobileHomeMatchup(league: MyLeagueRow): HomeMatchupCard {
  const phase = leaguePhase(league.status)
  // No schedule exists until the draft completes: only a season league reads its week.
  const activeId = phase === 'season' ? league.id : undefined
  const scoring = useLeagueScoringFamily(league.id)
  const schedule = useSchedule(activeId)
  const week = useMemo(() => (schedule.data ? currentWeekOf(schedule.data.weeks) : null), [schedule.data])
  const matchups = useMatchups(activeId, week ?? undefined)
  const standings = useStandings(activeId)
  // The saved draft time — only a league still waiting on its draft reads it.
  const detail = useLeague(phase === 'pre-draft' ? league.id : undefined)
  const [now] = useState(() => Date.now())
  const draft = draftLabel(phase, detail.data?.settings.draft?.draft_scheduled_at, now)

  const myTeamId = league.my_team_id
  const doc = matchups.data
  const row = useMemo(() => {
    if (!doc || !myTeamId) return null
    return splitRows(doc.matchups).primary.find((m) => m.home_team_id === myTeamId || m.away_team_id === myTeamId) ?? null
  }, [doc, myTeamId])
  const oppId = row ? (row.home_team_id === myTeamId ? row.away_team_id : row.home_team_id) : null

  const myBox = useBoxScore(activeId, week ?? undefined, row ? myTeamId : null)
  const oppBox = useBoxScore(activeId, week ?? undefined, oppId)
  const values = useLeaguePlayerValues(row ? league.id : undefined, doc?.season, week ?? undefined)
  const projOf = (id: string) => values.byPlayer.get(id)?.projected_points ?? null

  const sub = leagueSub({
    teamCount: league.team_count,
    family: scoring.family,
    beforeSeason: phase !== 'season',
    season: league.season,
    week,
  })

  if (phase !== 'season') return { phase, draft, sub, week: null, live: null, loading: false, error: false }

  const loading = schedule.isPending || (week !== null && matchups.isPending)
  const error = schedule.isError || (week !== null && matchups.isError && !doc)
  if (!doc || !row || !myTeamId) return { phase, draft, sub, week, live: null, loading: loading && !error, error }

  const myHome = row.home_team_id === myTeamId
  const weekStatus = doc.league_week.status
  const me = homeSide(teamWithRecord(teamName(doc, myTeamId), recordText(standings.data, myTeamId)), myHome ? row.home_score : row.away_score, row, weekStatus, myBox.data, projOf)
  const opp: HomeMatchupSide | null = oppId
    ? homeSide(teamWithRecord(teamName(doc, oppId), recordText(standings.data, oppId)), myHome ? row.away_score : row.home_score, row, weekStatus, oppBox.data, projOf)
    : null
  return { phase, draft, sub, week, live: { me, opp }, loading: false, error: false }
}
