import { expect, test, type Page } from '@playwright/test'

import { NO_LOCK_RECORD_COPY } from '@/components/leagues/lineup-editor-ops'
import { SEASON_ROUNDS } from '@/lib/leagues/sim/plan'

import {
  advanceWeekAt,
  assertNoForeignSeasonFixtures,
  assertPlayerPoolPresent,
  cleanupSweep,
  countLeagueRosters,
  driveDraftToCompletion,
  driveScoreBatch,
  finalizeWeekAt,
  lockTickAt,
  nflWeekInstants,
  plantGameRow,
  plantStatLines,
  readLeague,
  readLeagueWeeks,
  readTeamLineup,
  readTeamRoster,
  readWeekMatchups,
  recordWeekEnd,
  serviceClient,
  setInWeekGamesFinal,
  upsertLineupRow,
  waitFor,
  type RosterEntry,
  type StatLine,
} from './helpers/harness'
import { provisionLeague, signInDev, signInDevPro } from './helpers/provision'
import { STORAGE_STATE } from './helpers/local-env'

/**
 * Spec — ONE scored week end to end in a real browser: lineups → lock →
 * live scores visible → correction window → finalize → the standings move
 * (M4 task L.D6.2, tasks-M4 §6 item 1; delivery plan §4.1's E2E row; spec
 * §11.2, §11.4, §22.2, §23.2; PROGRESS D291, D293, D297, D321, D323).
 *
 * EVERY INSTANT IS INJECTED. The three week jobs take `p_now` (D291) and are
 * driven league-scoped from the harness's service key; the values come from
 * the synthetic calendar's own STORED literals (`nfl_weeks` on season 2099),
 * never from the wall clock. No production cadence is asserted and no cron
 * entry is added — Q43 is OPEN and stays open.
 *
 * NOTHING HERE HAND-WRITES A SCORE. The only thing that moves
 * `matchups.home_score` is `runScoreWeekBatch`, the production worker, over
 * a real `score_fanout` queue (`driveScoreBatch`). That is what makes step 5
 * below a NEGATIVE CONTROL rather than a decoration: with the queue full and
 * the worker NOT invoked, the score on screen is still the door's `pending`.
 *
 * THE Q42 SAFE CONSTRUCTION (the task's §6.4 rule, applied). Q42 — what a
 * starter with NO stat line contributes — is OPEN (F263(c)), so this spec
 * seeds EVERY seated starter on EVERY team with a delivered `player_stats`
 * row. Every starter therefore scores with `reason: 'scored'` and no
 * `no_stat_row` starter contributes to any number this spec asserts; the
 * arithmetic is Q42-independent by construction. An UNSEATED slot is an
 * empty seat, which is ruled (`EMPTY_SEAT_TITLE`), not Q42.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED:
 *   · Q40 — the lock countdown's REFERENT. Only the named placeholder hook
 *     and its copy are asserted; never a decrementing number, never anything
 *     against `team_lineups.locked_at` (a RECORD, not the lock — D327(9)).
 *   · Q38 — Points Against. W/L, Points For and rank ORDER only; no PA
 *     value, no Σ identity, and the fixture is checked to prove PA never
 *     separated two teams here.
 *   · Q37 — a held week is LAWFUL; the harness classifies by the job
 *     report's own `reason` and never treats "held" as red.
 */

const WEEK = 1
const TEAM_COUNT = 8
const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/** SEASON_ROSTER's six starting seats (`plan.ts:114-126`), in slot-key form. */
const SEASON_SLOTS: ReadonlyArray<{ key: string; position: string }> = [
  { key: 'qb:0', position: 'QB' },
  { key: 'rb:0', position: 'RB' },
  { key: 'wr:0', position: 'WR' },
  { key: 'te:0', position: 'TE' },
  { key: 'k:0', position: 'K' },
  { key: 'dst:0', position: 'DST' },
]

/** `positionMatches`'s own normalisation (`lineup-editor-ops.ts:75-78`). */
const normalize = (position: string): string => (position === 'DEF' ? 'DST' : position)

/** A legal placement over SEASON_ROSTER for one roster — the same rule the
 *  editor enforces client-side, so a plan built here is seatable there. */
function seatingPlan(roster: readonly RosterEntry[]): Record<string, string> {
  const used = new Set<string>()
  const plan: Record<string, string> = {}
  for (const slot of SEASON_SLOTS) {
    const pick = roster.find((p) => !used.has(p.player_id) && normalize(p.position) === slot.position)
    if (pick) {
      used.add(pick.player_id)
      plan[slot.key] = pick.player_id
    }
  }
  return plan
}

/**
 * Deterministic, position-shaped stat lines. The point VALUES are the
 * league's frozen snapshot's business (rule 9) — this only guarantees that
 * every seated starter HAS a row (the Q42 safe construction) and that team
 * totals separate. `scale` is the second drain's "bigger lines": every
 * yardage term grows, so a re-scored total can only move up.
 */
function statLineFor(playerId: string, position: string, teamIndex: number, scale: number): StatLine {
  const p = normalize(position)
  const bump = teamIndex + 1
  if (p === 'QB') return { player_id: playerId, pass_yards: (200 + bump * 10) * scale, pass_tds: 1 + (teamIndex % 3) }
  if (p === 'RB') return { player_id: playerId, rush_yards: (50 + bump * 7) * scale, rush_tds: teamIndex % 2 }
  if (p === 'WR') return { player_id: playerId, receptions: 3, receiving_yards: (40 + bump * 5) * scale, receiving_tds: (teamIndex + 1) % 2 }
  if (p === 'TE') return { player_id: playerId, receptions: 2, receiving_yards: (20 + bump * 3) * scale }
  // K and D/ST: a bare DELIVERED row. `deliveredLine` fills every
  // column-backed key with 0 and `deriveTierIndicators` emits the tier keys,
  // so the starter scores 0.00 with `reason: 'scored'` — never `no_stat_row`.
  return { player_id: playerId }
}

/** The rendered `data-score` attribute of one side of the scoreboard —
 *  `'pending'` (the door's NULL, E61/R788) or the formatted number. */
async function sideScore(page: Page, teamId: string): Promise<string> {
  const value = await page.locator(`[data-side="${teamId}"] [data-score]`).first().getAttribute('data-score')
  if (value === null) throw new Error(`no [data-score] rendered for side ${teamId}`)
  return value
}

test.describe('a scored week end to end (real browser)', () => {
  test.beforeAll(async () => {
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
    await assertNoForeignSeasonFixtures(service)
  })

  test.afterAll(async () => {
    await cleanupSweep(serviceClient())
  })

  test('lineup saved in the browser → week opens → the worker moves the live score → window closes → finalize → standings move', async ({
    browser,
  }) => {
    test.setTimeout(600_000)
    const service = serviceClient()

    // ---- A scorable league, through the real service path (D100) ---------
    const commishAuth = await signInDev()
    const managerAuth = await signInDevPro()
    const league = await provisionLeague({
      nameSuffix: 'inseason week',
      teamCount: TEAM_COUNT,
      rounds: SEASON_ROUNDS,
      season: true, // SEASON_ROSTER — QB·RB·WR·TE·K·D/ST + bench
      clockSeconds: 30,
      commish: commishAuth,
      manager: managerAuth,
      order: 'commish-first',
      createDraftRow: true,
      start: true,
    })
    const drive = await driveDraftToCompletion(service, league.draftId!, { maxSteps: 200 })
    expect(await readLeague(service, league.leagueId)).toMatchObject({ status: 'in_season' })
    expect(await countLeagueRosters(service, league.leagueId)).toBe(TEAM_COUNT * SEASON_ROUNDS)
    // eslint-disable-next-line no-console -- the DoD evidence line
    console.log(`[inseason-week] ${TEAM_COUNT * SEASON_ROUNDS} picks in ${drive.steps} engine steps → ${drive.status}`)

    const week = await nflWeekInstants(service, WEEK)
    const matchupsBefore = await readWeekMatchups(service, league.leagueId, WEEK)
    const mine = matchupsBefore.find(
      (m) => m.home_team_id === league.commishTeamId || m.away_team_id === league.commishTeamId,
    )
    if (!mine || !mine.away_team_id) throw new Error('the commissioner has no week-1 head-to-head pairing')
    const opponentTeamId = mine.home_team_id === league.commishTeamId ? mine.away_team_id : mine.home_team_id

    // Every franchise's roster and its legal week-1 placement.
    const teamIds = [
      ...new Set(matchupsBefore.flatMap((m) => [m.home_team_id, m.away_team_id]).filter((id): id is string => id !== null)),
    ].sort()
    expect(teamIds.length).toBe(TEAM_COUNT)
    const rosters = new Map<string, RosterEntry[]>()
    const plans = new Map<string, Record<string, string>>()
    for (const teamId of teamIds) {
      const roster = await readTeamRoster(service, league.leagueId, teamId)
      rosters.set(teamId, roster)
      plans.set(teamId, seatingPlan(roster))
    }
    const commishPlan = plans.get(league.commishTeamId)!
    expect(Object.keys(commishPlan).length, 'the commissioner must have at least one seatable starter').toBeGreaterThan(0)

    const commishContext = await browser.newContext({ storageState: STORAGE_STATE.dev })
    try {
      const page = await commishContext.newPage()

      // ---- (1) LINEUPS — the one lineup this spec asserts rides the ------
      // BROWSER and the real `set_lineup` RPC. No game row exists yet, so
      // nothing can be locked and the save is admitted (`112`'s wrapper
      // passes the transaction's own `now()` — there is no caller clock to
      // move, which is why the setup lineups below take the direct row).
      await page.goto(`/app/leagues/${league.leagueId}/team/${league.commishTeamId}`)
      const editor = page.locator(`[data-lineup-editor="${league.commishTeamId}"]`)
      await expect(editor).toBeVisible({ timeout: 60_000 })

      // Q40 (OPEN, F251): the named placeholder and its copy — nothing about
      // a referent, nothing that decrements, nothing against `locked_at`.
      const countdown = page.locator('[data-lock-countdown="placeholder-q40"]')
      await expect(countdown).toHaveCount(1)
      await expect(countdown).toHaveText(NO_LOCK_RECORD_COPY)

      for (const slot of SEASON_SLOTS) {
        const playerId = commishPlan[slot.key]
        if (!playerId) continue
        await page.locator(`[data-player="${playerId}"]`).click()
        await page.locator(`[data-slot="${slot.key}"]`).getByRole('button', { name: 'Seat here' }).click()
      }
      const savedResponse = page.waitForResponse(
        (res) => res.url().includes('/lineup') && res.request().method() === 'PATCH',
        { timeout: 60_000 },
      )
      await page.locator('[data-save-lineup]').click()
      expect((await savedResponse).status()).toBe(200)

      // The SERVER's canonical map is the assertion, never the DOM's idea of
      // it (§11.2/D293: "what renders after a save is the server's map").
      const stored = await waitFor(
        'the saved lineup row',
        async () => {
          const row = await readTeamLineup(service, league.commishTeamId, WEEK)
          return { ok: row !== null, seen: row }
        },
        { timeoutMs: 20_000 },
      )
      expect(stored!.slot_map).toEqual(commishPlan)

      // ---- (2) The other seven franchises' lineups, service-side ---------
      // A setup lineup takes the direct row (the dev driver's own move) —
      // there is no browser for a placeholder seat, and this spec asserts
      // nothing about how they were written, only that they exist so the
      // week has a full slate of scorable teams.
      for (const teamId of teamIds) {
        if (teamId === league.commishTeamId) continue
        await upsertLineupRow(service, teamId, WEEK, plans.get(teamId)!)
      }

      // ---- (3) The week's game row -------------------------------------
      // `week_games_state_internal` never finalizes a week with ZERO in-week
      // games (`116:317-358`). The kickoff is inside the SYNTHETIC 2099 week
      // and therefore far in the wall-clock future — nothing here locks, and
      // the E32 mechanism deliberately lives in its own spec.
      await plantGameRow(service, {
        suffix: `week-wk${WEEK}`,
        week: WEEK,
        homeTeam: 'ZZA',
        awayTeam: 'ZZB',
        kickoffAt: new Date(Date.parse(week.starts_at) + 4 * DAY_MS).toISOString(),
        status: 'scheduled',
      })

      // ---- (4) The week OPENS (the job, twice, at one injected instant) --
      const opened = await advanceWeekAt(
        service,
        league.leagueId,
        new Date(Date.parse(week.starts_at) + MINUTE_MS).toISOString(),
      )
      expect(Number(opened.first.opened)).toBeGreaterThan(0)
      // Idempotence (M4 rule 10): the SAME instant again opens nothing more.
      expect(Number(opened.second.opened ?? 0)).toBe(0)

      // The LOCK pass — driven, league-scoped, at the same injected instant.
      // What it did is read from its own report; `locked_until` is a VIEW
      // and decides nothing here (E32's row), and Q40 bars any claim about
      // the countdown's referent.
      const tick = await lockTickAt(
        service,
        league.leagueId,
        new Date(Date.parse(week.starts_at) + MINUTE_MS).toISOString(),
      )
      expect(Number(tick.leagues)).toBe(1)

      await page.goto(`/app/leagues/${league.leagueId}/matchup?week=${WEEK}`)
      await expect(page.locator('[data-week-badge="live"]').first()).toBeVisible({ timeout: 60_000 })
      await expect(page.locator(`[data-matchup="${mine.id}"]`)).toHaveAttribute('data-matchup-status', 'live')

      // ---- (5) THE NEGATIVE CONTROL — the queue is full, the worker held -
      // "Holding the worker" is literal and honest: there is NO pause switch
      // in the repo, so the hold IS not invoking `driveScoreBatch`. The stat
      // lines and their `score_fanout` rows exist; nothing has drained them;
      // the door has written no score.
      //
      // What that reads as on screen is `0.00`, NOT `pending`: the schedule
      // engine's INSERT omits the score columns (`110:773-778`) and
      // `matchups.home_score` carries `DEFAULT 0` (`109:162`), so an opened
      // week that nothing has scored holds a stored ZERO — the door's
      // NULL-as-pending state (E61) belongs to a starter with an undelivered
      // applicable key, not to a never-scored week. Measured, not assumed;
      // recorded as F293 for whoever owns that column's intent.
      const linesAt = (scale: number): StatLine[] =>
        teamIds.flatMap((teamId, index) =>
          Object.entries(plans.get(teamId)!).map(([slotKey, playerId]) =>
            statLineFor(
              playerId,
              SEASON_SLOTS.find((s) => s.key === slotKey)!.position,
              index,
              scale,
            ),
          ),
        )
      const planted = await plantStatLines(service, WEEK, linesAt(1))
      await page.reload()
      await expect(page.locator('[data-week-badge="live"]').first()).toBeVisible({ timeout: 60_000 })
      const heldMine = await sideScore(page, league.commishTeamId)
      const heldTheirs = await sideScore(page, opponentTeamId)
      expect(Number(heldMine), 'the worker was never invoked — no score can have been written').toBe(0)
      expect(Number(heldTheirs)).toBe(0)
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(
        `[inseason-week] worker HELD: ${planted.queued} queue rows planted, ` +
          `sides read data-score="${heldMine}" / "${heldTheirs}"`,
      )

      // ---- (6) Drive the PRODUCTION worker: the number lands -------------
      const firstBatch = await driveScoreBatch(service, league.leagueId)
      expect(firstBatch.leagues.length).toBeGreaterThan(0)
      expect(firstBatch.written).toBeGreaterThan(0)
      // The Q42 SAFE CONSTRUCTION, proved from the worker's own report rather
      // than asserted by faith: not one starter this drain scored fell to
      // `no_stat_row`, so no number below owes anything to Q42's open reading.
      for (const leagueReport of firstBatch.leagues) {
        for (const team of leagueReport.teams) {
          expect(team.no_stat_row, `team ${team.team_id} has a no_stat_row starter`).toEqual([])
          expect(team.pending, `team ${team.team_id} has a pending starter (E61)`).toEqual([])
        }
      }
      await page.reload()
      const firstScore = await waitFor(
        'the live score to land',
        async () => {
          const seen = await sideScore(page, league.commishTeamId)
          return { ok: seen !== 'pending' && Number(seen) > 0, seen }
        },
        { timeoutMs: 30_000 },
      )
      expect(Number(firstScore)).toBeGreaterThan(0)

      // ---- (7) …and MOVES on the next drain (bigger lines) ---------------
      await plantStatLines(service, WEEK, linesAt(2))
      const secondBatch = await driveScoreBatch(service, league.leagueId)
      await page.reload()
      const secondScore = await waitFor(
        'the live score to move',
        async () => {
          const seen = await sideScore(page, league.commishTeamId)
          return { ok: seen !== 'pending' && seen !== firstScore, seen }
        },
        { timeoutMs: 30_000 },
      )
      expect(Number(secondScore)).toBeGreaterThan(Number(firstScore))
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(
        `[inseason-week] live score ${firstScore} → ${secondScore} ` +
          `(drains ${firstBatch.drained} then ${secondBatch.drained}; written ${firstBatch.written}/${secondBatch.written})`,
      )

      // The standings have NOT moved yet — no week is final.
      await page.goto(`/app/leagues/${league.leagueId}/standings`)
      await expect(page.locator('[data-standings-table]')).toBeVisible({ timeout: 60_000 })
      await expect(page.locator('[data-weeks-counted]')).toContainText('0 weeks final')
      const liveOrder = await page.locator('[data-standings-table] [data-team]').evaluateAll((rows) =>
        rows.map((row) => (row as HTMLElement).dataset.team!),
      )
      expect(liveOrder.length).toBe(TEAM_COUNT)

      // ---- (8) The window closes -----------------------------------------
      const inWeekGames = await setInWeekGamesFinal(service, WEEK)
      const lastEnd = new Date(Date.parse(week.starts_at) + 5 * DAY_MS).toISOString()
      await recordWeekEnd(service, WEEK, lastEnd)
      const closed = await advanceWeekAt(
        service,
        league.leagueId,
        new Date(Date.parse(lastEnd) + MINUTE_MS).toISOString(),
      )
      expect(Number(closed.first.closed)).toBeGreaterThan(0)
      await page.goto(`/app/leagues/${league.leagueId}/matchup?week=${WEEK}`)
      await expect(page.locator('[data-week-badge="pending_corrections"]').first()).toBeVisible({ timeout: 60_000 })

      // ---- (9) FINALIZE ---------------------------------------------------
      const finalReport = await finalizeWeekAt(
        service,
        league.leagueId,
        new Date(Date.parse(week.correction_window_ends_at) + MINUTE_MS).toISOString(),
      )
      expect(Number(finalReport.finalized)).toBeGreaterThan(0)
      const ladder = await readLeagueWeeks(service, league.leagueId)
      expect(ladder.find((w) => w.week === WEEK)?.status).toBe('final')
      await page.reload()
      await expect(page.locator('[data-week-badge="final"]').first()).toBeVisible({ timeout: 60_000 })
      await expect(page.locator(`[data-matchup="${mine.id}"]`)).toHaveAttribute('data-matchup-status', 'final')
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(
        `[inseason-week] ${inWeekGames} in-week game(s) final · finalize_matchups finalized ` +
          `${finalReport.finalized} matchup(s), weeks ${JSON.stringify(finalReport.weeks)}`,
      )

      // ---- (10) THE STANDINGS MOVE ---------------------------------------
      // Winners and losers come from the SERVER's stored `result` (D297 —
      // the client never infers one from the scores).
      const settled = await readWeekMatchups(service, league.leagueId, WEEK)
      const winners = new Set<string>()
      const losers = new Set<string>()
      for (const row of settled) {
        if (row.away_team_id === null) continue
        const homeWon = row.result === 'home'
        const awayWon = row.result === 'away'
        expect(homeWon || awayWon, `week ${WEEK} matchup ${row.id} did not decide (result ${row.result})`).toBe(true)
        winners.add(homeWon ? row.home_team_id : row.away_team_id)
        losers.add(homeWon ? row.away_team_id : row.home_team_id)
      }
      expect(winners.size).toBe(TEAM_COUNT / 2)
      expect(losers.size).toBe(TEAM_COUNT / 2)

      await page.goto(`/app/leagues/${league.leagueId}/standings`)
      await expect(page.locator('[data-standings-table]')).toBeVisible({ timeout: 60_000 })
      await expect(page.locator('[data-weeks-counted]')).toContainText('1 week final')
      const finalOrder = await page.locator('[data-standings-table] [data-team]').evaluateAll((rows) =>
        rows.map((row) => (row as HTMLElement).dataset.team!),
      )
      expect(finalOrder.length).toBe(TEAM_COUNT)
      // RANK ORDER only (Q38): every winner above every loser.
      const lastWinnerRank = Math.max(...finalOrder.map((id, i) => (winners.has(id) ? i : -1)))
      const firstLoserRank = Math.min(...finalOrder.map((id, i) => (losers.has(id) ? i : TEAM_COUNT)))
      expect(lastWinnerRank).toBeLessThan(firstLoserRank)
      // The commissioner's row carries the record the server wrote.
      const myRow = page.locator(`[data-standings-table] [data-team="${league.commishTeamId}"]`)
      await expect(myRow).toContainText(winners.has(league.commishTeamId) ? '1-0' : '0-1')
      // Q38 guard: Points Against is PROVISIONAL, so this fixture must never
      // have leaned on it — no row may have been separated by it.
      const separators = await page
        .locator('[data-standings-table] [data-team]')
        .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.separatedBy ?? ''))
      expect(separators).not.toContain('points_against')
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(
        `[inseason-week] standings: live order ${liveOrder.join(',')} → final order ${finalOrder.join(',')} ` +
          `(separated_by ${JSON.stringify(separators)})`,
      )

      test.info().annotations.push({
        type: 'scored-week',
        description: `held→${firstScore}→${secondScore}; finalized ${finalReport.finalized}; winners above losers`,
      })
    } finally {
      await commishContext.close()
    }
  })
})
