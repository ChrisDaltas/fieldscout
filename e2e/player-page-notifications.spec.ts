import { expect, test } from '@playwright/test'

import { SEASON_ROUNDS } from '@/lib/leagues/sim/plan'
import { NFL_TEAMS } from '@/lib/nfl-teams'

import { assertPlayerPoolPresent, cleanupSweep, driveDraftToCompletion, serviceClient } from './helpers/harness'
import { provisionLeague, signInDev, signInDevPro, type ProvisionedLeague } from './helpers/provision'
import { STORAGE_STATE } from './helpers/local-env'

/**
 * Spec — the full player page and the rail's Notifications tool (built to
 * the Claude Design prototype's PlayerPage / ResearchRail, Chris 2026-10-04).
 *
 *   1. As the manager: a bench player's name opens his card in the league;
 *      the card's expand icon goes to the full page's LEAGUE variant
 *      (`?league=`, "Viewing in …" + the league's actions); Back returns to
 *      the team page. The global variant lists "Your leagues".
 *   2. Notifications: a league item and a platform item; the league chip
 *      shows ONLY the league's item (with the hidden note); clicking the row
 *      marks it read on the server and follows its link.
 *
 * TIME: the 2099 synthetic season (the player-card spec's shape).
 */

let league: ProvisionedLeague | null = null
let managerId = ''
const insertedIds: string[] = []
// D486(12): the matchup block needs a scheduled game + defense splits. The
// local 2026 tables are empty; these rows are seeded per run and removed.
const SEED_SEASON = 2026
const seededGameIds: string[] = []
let seededSplits: { position: string } | null = null
let seededStatsPlayer: string | null = null

async function seedMatchup(playerId: string): Promise<{ team: string; position: string; opp: string }> {
  const service = serviceClient()
  const { data: p, error } = await service.from('players').select('team, position').eq('id', playerId).single()
  if (error) throw error
  if (!p.team) throw new Error('the bench player has no NFL team — the matchup block cannot be seeded')
  const team = p.team
  const position = p.position === 'DST' ? 'DEF' : p.position
  const opp = team === 'SEA' ? 'KC' : 'SEA'
  const others = Object.keys(NFL_TEAMS).filter((t) => t !== team && t !== opp)
  const game = (week: number, home: string, away: string, kickoff: string, status: string) => ({
    id: `e2e-pp-${SEED_SEASON}-${week}`, season: SEED_SEASON, week, game_type: 'regular', home_team: home, away_team: away, kickoff_at: kickoff, status,
  })
  const games = [
    game(1, team, others[0], '2026-09-13T17:00:00Z', 'final'),
    game(2, others[1], team, '2026-09-20T17:00:00Z', 'final'),
    game(3, team, others[2], '2026-09-27T17:00:00Z', 'final'),
    game(4, opp, team, '2026-10-04T20:25:00Z', 'scheduled'),
    game(5, team, others[3], '2026-10-11T17:00:00Z', 'scheduled'),
    game(7, others[4], team, '2026-10-25T17:00:00Z', 'scheduled'),
  ]
  const ins = await service.from('nfl_games').insert(games)
  if (ins.error) throw ins.error
  seededGameIds.push(...games.map((g) => g.id))
  // 033 stores 1 = most generous; the opponent at stored 29 → OPRK 4 (4th toughest, red).
  const defenses = [opp, ...Object.keys(NFL_TEAMS).filter((t) => t !== opp)].slice(0, 32)
  const splits = defenses.map((d, i) => ({ defense: d, position, season: SEED_SEASON, factor: 1, rank: d === opp ? 29 : i < 29 ? i : i + 1, sample_weeks: 3 }))
  const sp = await service.from('defense_position_splits').insert(splits)
  if (sp.error) throw sp.error
  seededSplits = { position }
  // Recent: three completed weeks under the strip's scoring.
  const st = await service.from('player_stats').insert([1, 2, 3].map((week) => ({ player_id: playerId, season: SEED_SEASON, week, rush_yards: 40 + week * 10, receiving_yards: 20 })))
  if (st.error) throw st.error
  seededStatsPlayer = playerId
  return { team, position, opp }
}
const fixture = (): ProvisionedLeague => {
  if (!league) throw new Error('the league fixture was not provisioned (beforeAll failed)')
  return league
}

test.describe.configure({ mode: 'serial' })

test.describe('the full player page + rail notifications (real browser)', () => {
  test.beforeAll(async () => {
    test.setTimeout(300_000)
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
    const commish = await signInDev()
    const manager = await signInDevPro()
    managerId = manager.userId
    league = await provisionLeague({
      nameSuffix: 'player page',
      teamCount: 8,
      rounds: SEASON_ROUNDS,
      season: true,
      clockSeconds: 30,
      commish,
      manager,
      order: 'commish-first',
      createDraftRow: true,
      start: true,
    })
    await driveDraftToCompletion(service, league.draftId!, { maxSteps: 200 })
  })

  test.afterAll(async () => {
    const service = serviceClient()
    if (insertedIds.length > 0) await service.from('notifications').delete().in('id', insertedIds)
    if (seededGameIds.length > 0) await service.from('nfl_games').delete().in('id', seededGameIds)
    if (seededSplits) await service.from('defense_position_splits').delete().eq('season', SEED_SEASON).eq('position', seededSplits.position)
    if (seededStatsPlayer) await service.from('player_stats').delete().eq('season', SEED_SEASON).eq('player_id', seededStatsPlayer).in('week', [1, 2, 3])
    await cleanupSweep(service)
  })

  test('card → expand → league full page → Back returns', async ({ browser }) => {
    const { leagueId, managerTeamId } = fixture()
    const context = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    const page = await context.newPage()
    const teamUrl = `/app/leagues/${leagueId}/team/${managerTeamId}`
    await page.goto(teamUrl)
    await expect(page.locator('[data-bench]')).toBeVisible({ timeout: 60_000 })

    const link = page.locator('[data-bench] [data-player-link]').first()
    const playerId = await link.getAttribute('data-player-link')
    const seeded = await seedMatchup(playerId!)
    await link.click()
    await expect(page.locator('[data-card-actions="league"]')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Open full page' }).click()

    await page.waitForURL(`**/app/players/${playerId}?league=${leagueId}`, { timeout: 60_000 })
    const full = page.locator('[data-player-page="league"]')
    await expect(full).toBeVisible({ timeout: 60_000 })
    await expect(full.locator('[data-viewing-in]')).toHaveText(/^Viewing in .+/, { timeout: 30_000 })
    await expect(full.locator('[data-card-where]')).toHaveText(/^On your team in /, { timeout: 30_000 })
    await expect(full.locator('[data-card-action="drop"]')).toBeVisible()
    // D486(12): the standard shell header — "Player" + Back, nothing taller.
    const shellHeader = page.locator('header:has(h3)')
    await expect(shellHeader.locator('h3')).toHaveText('Player')
    const headerBox = await shellHeader.boundingBox()
    expect(headerBox?.height).toBeLessThanOrEqual(60)
    // D486(12): the identity line — each fact once.
    const identity = full.locator('[data-player-identity]')
    await expect(identity).toBeVisible()
    await expect(full.getByText(/^Bye Wk \d+$/)).toHaveCount(1)
    await expect(full.locator('[data-player-vitals]')).toHaveCount(0)
    // This week: the seeded game @ the opponent, 4th toughest (red).
    const tw = full.locator('[data-this-week="game"]')
    await expect(tw).toBeVisible({ timeout: 30_000 })
    await expect(tw.locator('[data-this-week-opp]')).toHaveText(`@ ${seeded.opp}`)
    await expect(tw.locator('[data-matchup-badge="negative"]')).toHaveText(`4th toughest vs ${seeded.position}`)
    // The season table: one row per week, the current week marked, the
    // bye as BYE; the old Overview / Schedule tabs are gone.
    await expect.poll(() => full.locator('[data-season-week]').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(6)
    await expect(full.locator('[data-season-week="4"]')).toHaveAttribute('data-current', 'true')
    await expect(full.locator('[data-full-stats-toggle]')).toHaveAttribute('aria-expanded', 'false')
    await expect(full.getByRole('tab')).toHaveCount(0)
    // D486(12): the stats strip — five tiles, scored by THIS league.
    const leagueRow = full.locator('[data-core-stats]')
    await expect(leagueRow.locator('[data-core-tile]')).toHaveCount(5)
    await expect(leagueRow.locator('[data-core-basis]')).toHaveText(/^(?!ESPN Standard scoring$)(?!Couldn).+ scoring$/, { timeout: 30_000 })
    // D486(11): ?league= preselects that league in the scoring dropdown.
    await expect(leagueRow.locator('[data-core-scoring]')).not.toHaveText(/ESPN Standard/)
    await leagueRow.locator('xpath=..').screenshot({ path: test.info().outputPath('player-hero-league.png') })
    await page.screenshot({ path: process.env.PP_LEAGUE_SHOT ?? test.info().outputPath('player-page-league.png'), fullPage: true })

    await page.locator('[data-player-back]').click()
    await page.waitForURL(`**${teamUrl}`, { timeout: 30_000 })
    await expect(page.locator('[data-bench]')).toBeVisible({ timeout: 60_000 })

    // The global variant: "Your leagues" with this league's row.
    await page.goto(`/app/players/${playerId}`)
    const global = page.locator('[data-player-page="global"]')
    await expect(global).toBeVisible({ timeout: 60_000 })
    await expect(global.locator(`[data-card-league-row="${leagueId}"]`)).toBeVisible({ timeout: 30_000 })
    const globalRow = global.locator('[data-core-stats]')
    await expect(globalRow.locator('[data-core-tile]')).toHaveCount(5)
    // The season table's completed weeks carry points under ESPN Standard.
    await expect(global.locator('[data-season-week="1"] td').last()).toHaveText(/^\d+\.\d$/, { timeout: 30_000 })
    await expect(globalRow.locator('[data-core-basis]')).toHaveText('ESPN Standard scoring', { timeout: 30_000 })
    await expect(globalRow.locator('[data-core-avg-note]')).toHaveText('Avg of completed weeks')
    // D486(11): switch scoring — the label (and the numbers) follow the pick.
    await globalRow.locator('[data-core-scoring]').click()
    await expect(page.locator(`[data-core-scoring-option="league:${leagueId}"]`)).toBeVisible()
    await page.waitForTimeout(400) // the menu's open animation — screenshot evidence only
    await page.screenshot({ path: process.env.CORE_SCORING_SHOT ?? test.info().outputPath('player-core-scoring-open.png') })
    await page.locator('[data-core-scoring-option="ppr"]').click()
    await expect(globalRow.locator('[data-core-basis]')).toHaveText('Full PPR scoring', { timeout: 30_000 })
    await expect(globalRow.locator('[data-core-tile="total"] p').first()).toHaveText(/^\d+\.\d$/, { timeout: 30_000 })
    await globalRow.locator('xpath=..').screenshot({ path: test.info().outputPath('player-hero-global.png') })
    await page.screenshot({ path: process.env.PP_GLOBAL_SHOT ?? test.info().outputPath('player-page-global.png'), fullPage: true })
    // Mobile: identity → this week → actions → strip, no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(global.locator('[data-this-week="game"]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: process.env.PP_MOBILE_SHOT ?? test.info().outputPath('player-page-mobile.png'), fullPage: true })
    await context.close()
  })

  test('notifications: filter by league, click marks read and follows the link', async ({ browser }) => {
    const { leagueId } = fixture()
    const service = serviceClient()
    const { data, error } = await service
      .from('notifications')
      .insert([
        { user_id: managerId, type: 'league_trade_proposed', title: 'E2E trade offer', body: null, data: { league_id: leagueId }, read: false },
        { user_id: managerId, type: 'list_update', title: 'E2E platform item', body: null, data: {}, read: false },
      ])
      .select('id, type')
    if (error) throw error
    for (const row of data ?? []) insertedIds.push(row.id)
    const tradeId = data!.find((r) => r.type === 'league_trade_proposed')!.id
    const platformId = data!.find((r) => r.type === 'list_update')!.id

    const context = await browser.newContext({ storageState: STORAGE_STATE.devPro, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await page.goto('/app/research')
    const badge = page.locator('[data-rail-badge="notifications"]')
    await expect(badge).toBeVisible({ timeout: 60_000 })
    await page.locator('[data-rail-tool="notifications"]').click()

    await expect(page.locator(`[data-notif-row="${tradeId}"]`)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(`[data-notif-row="${platformId}"]`)).toBeVisible()
    await page.locator(`[data-notif-filter="${leagueId}"]`).click()
    await expect(page.locator('[data-notif-filter-note]')).toContainText('Field Scout notifications are hidden')
    await expect(page.locator(`[data-notif-row="${platformId}"]`)).toHaveCount(0)
    const row = page.locator(`[data-notif-row="${tradeId}"]`)
    await expect(row).toHaveAttribute('data-notif-read', 'false')
    await page.screenshot({ path: test.info().outputPath('notifications-filtered.png') })

    await row.click()
    await page.waitForURL(`**/app/leagues/${leagueId}/trades`, { timeout: 60_000 })
    await expect
      .poll(async () => (await service.from('notifications').select('read').eq('id', tradeId).single()).data?.read, { timeout: 30_000 })
      .toBe(true)
    await context.close()
  })
})
