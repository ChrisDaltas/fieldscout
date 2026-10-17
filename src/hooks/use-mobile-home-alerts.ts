'use client'

import { useMemo } from 'react'

import { currentWeekOf } from '@/components/leagues/lineup-editor-ops'
import { homeAlertLabel, homeAlertReasons, seasonInPlay, type HomeAlertReason } from '@/components/mobile/home/home-ops'
import { leagueTradeOffers } from '@/components/mobile/messages/messages-ops'
import { useLeague } from '@/hooks/use-league'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import { useLineup } from '@/hooks/use-lineup'
import { useMobileTeamGames } from '@/hooks/use-mobile-team-games'
import { useRosters } from '@/hooks/use-rosters'
import { useSchedule } from '@/hooks/use-schedule'
import { useTrades } from '@/hooks/use-trades'
import { featureFlags } from '@/lib/feature-flags'

/**
 * One Home league card's red dot (ruling #14, 2026-10-15): on when something
 * in that league needs the user — a trade offer waiting on their answer, or
 * a problem in this week's starting lineup (`homeAlertReasons` decides).
 *
 * Only a league whose season is being played reads anything (pre-draft,
 * drafting and finished cards never carry the dot), and nothing is read
 * while the leagues release is off. Every read is one the league screens
 * already make, under their own query keys, so opening the league afterwards
 * is instant and Home's other sections share them:
 *  - the schedule (the card's week; the Team tab's ladder),
 *  - the league detail (the slots, the managers — the Team tab and
 *    the league Trades screen),
 *  - every roster (Home's Injury news reads the same one),
 *  - the user's stored lineup for the week (the Team tab's),
 *  - the week's NFL games (the Team tab's game line — one read per week,
 *    shared by every league),
 *  - the trades (the league Trades page).
 * Plain reads, not the live room: the dot refreshes when Home is opened
 * again, and a trade answered or a lineup saved anywhere in the app
 * invalidates the same keys.
 */
export interface HomeAlert {
  reasons: HomeAlertReason[]
  /** The dot's screen-reader label; null when nothing needs you. */
  label: string | null
}

export function useMobileHomeAlert(league: MyLeagueRow): HomeAlert {
  const on = featureFlags.leagues && seasonInPlay(league.status) && Boolean(league.my_team_id)
  const id = on ? league.id : undefined
  const myTeamId = league.my_team_id

  const schedule = useSchedule(id)
  const week = useMemo(() => (schedule.data ? currentWeekOf(schedule.data.weeks) : null), [schedule.data])
  const wk = week ?? undefined
  const detail = useLeague(id)
  const rosters = useRosters(id)
  const lineup = useLineup(on ? (myTeamId ?? undefined) : undefined, wk)
  const games = useMobileTeamGames(on ? league.season : undefined, wk)
  const trades = useTrades(id)

  const offers = useMemo(
    () => (trades.data && detail.data ? leagueTradeOffers(trades.data, detail.data, league.id) : undefined),
    [trades.data, detail.data, league.id],
  )
  const roster = rosters.data?.teams.find((t) => t.team_id === myTeamId)?.roster
  const settings = detail.data?.settings.roster_settings
  // A games read that failed still lets the stored bye week speak (the
  // lineup check reads "no game" only from a week that has games).
  const gamesSettled = games.data !== undefined || games.isError
  const gameRows = games.data
  const stored = lineup.data

  const reasons = useMemo(
    () =>
      homeAlertReasons({
        status: league.status,
        myTeamId,
        schedule: schedule.data,
        offers,
        lineup:
          roster && settings && stored !== undefined && gamesSettled
            ? { roster, slotMap: stored?.slot_map ?? null, settings, games: gameRows ?? [] }
            : undefined,
      }),
    [league.status, myTeamId, schedule.data, offers, roster, settings, stored, gamesSettled, gameRows],
  )
  return { reasons, label: homeAlertLabel(reasons) }
}
