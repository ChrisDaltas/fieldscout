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
 *   1. As the manager: a bench player's name opens his MINI CARD in the
 *      league; the card's expand icon opens the player view MODAL (D486(13))
 *      over the team page with the league's actions; Esc closes it and the
 *      page is still there; the global variant lists "Your leagues"; Full
 *      stats expands in place; the deep link renders the same view.
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
const seededKeyStatPlayers: string[] = []

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
  const st = await service.from('player_stats').insert([1, 2, 3].map((week) => ({ player_id: playerId, season: SEED_SEASON, week, rush_attempts: 14 + week, rush_yards: 40 + week * 10, rush_tds: week === 2 ? 1 : 0, targets: 4, receptions: 3, receiving_yards: 20 })))
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
    if (seededKeyStatPlayers.length > 0) {
      await service.from('player_stats').delete().eq('season', SEED_SEASON).in('player_id', seededKeyStatPlayers).in('week', [1, 2, 3])
    }
    if (seededStatsPlayer) await service.from('player_stats').delete().eq('season', SEED_SEASON).eq('player_id', seededStatsPlayer).in('week', [1, 2, 3])
    await cleanupSweep(service)
  })

  test('name → mini card → expand → player view MODAL; Esc keeps the page; deep link renders it', async ({ browser }) => {
    const { leagueId, managerTeamId } = fixture()
    const context = await browser.newContext({ storageState: STORAGE_STATE.devPro, viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const teamUrl = `/app/leagues/${leagueId}/team/${managerTeamId}`
    await page.goto(teamUrl)
    await expect(page.locator('[data-bench]')).toBeVisible({ timeout: 60_000 })

    // A plain name click opens the MINI CARD (the quick peek), not the modal.
    const link = page.locator('[data-bench] [data-player-link]').first()
    const playerId = await link.getAttribute('data-player-link')
    const seeded = await seedMatchup(playerId!)
    await link.click()
    await expect(page.locator('[data-card-actions="league"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-player-modal]')).toHaveCount(0)

    // The card's expand icon opens the decision view as a modal over the page.
    await page.getByRole('button', { name: 'Open player view' }).click()
    const modal = page.locator(`[data-player-modal="${playerId}"]`)
    await expect(modal).toBeVisible({ timeout: 30_000 })
    expect(new URL(page.url()).pathname).toBe(teamUrl) // never navigated
    const full = modal.locator('[data-player-page="league"]')
    await expect(full.locator('[data-viewing-in]')).toHaveText(/^Viewing in .+/, { timeout: 30_000 })
    await expect(full.locator('[data-card-where]')).toHaveText(/^On your team in /, { timeout: 30_000 })
    await expect(full.locator('[data-card-action="drop"]')).toBeVisible()
    // The calm default view: identity, three numbers, this week, the table.
    await expect(full.getByText(/^Bye Wk \d+$/)).toHaveCount(1)
    await expect(full.locator('[data-core-tile]')).toHaveCount(3)
    await expect(full.locator('[data-core-basis]')).toHaveText(/^(?!ESPN Standard scoring$)(?!Couldn).+ scoring$/, { timeout: 30_000 })
    const tw = full.locator('[data-this-week="game"]')
    await expect(tw.locator('[data-this-week-opp]')).toHaveText(`@ ${seeded.opp}`, { timeout: 30_000 })
    await expect(tw.locator('[data-matchup-badge="negative"]')).toHaveText(`4th toughest vs ${seeded.position}`)
    await expect.poll(() => full.locator('[data-season-week]').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(6)
    await expect(full.locator('[data-season-week="4"]')).toHaveAttribute('data-current', 'true')
    // Every section collapsed by default.
    for (const k of ['stats', 'log', 'scoring', 'value']) {
      await expect(full.locator(`[data-section-toggle="${k}"]`)).toHaveAttribute('aria-expanded', 'false')
    }
    await expect(full.locator('[data-section]')).toHaveCount(0)
    await page.waitForTimeout(300) // the dialog's fade — screenshot evidence only
    await page.screenshot({ path: process.env.PP_LEAGUE_SHOT ?? test.info().outputPath('player-modal-league.png') })

    // Esc closes it; the team page underneath is still there.
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    await expect(page.locator('[data-bench]')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(teamUrl)

    // Reopen, then step out of the league: the same modal re-targets to the
    // global variant ("Your leagues") — still over the team page.
    await link.click()
    await page.getByRole('button', { name: 'Open player view' }).click()
    await expect(modal).toBeVisible({ timeout: 30_000 })
    await modal.locator('[data-card-all-leagues]').click()
    const global = modal.locator('[data-player-page="global"]')
    await expect(global.locator(`[data-card-league-row="${leagueId}"]`)).toBeVisible({ timeout: 30_000 })
    await expect(global.locator('[data-core-basis]')).toHaveText('ESPN Standard scoring', { timeout: 30_000 })
    await expect(global.locator('[data-season-week="1"] td').last()).toHaveText(/^\d+\.\d$/, { timeout: 30_000 })
    // D486(14) Key stats from the seeded box lines (3 completed games).
    if (seeded.position === 'RB') {
      await expect(global.locator('[data-key-stat="carries_pg"] p').first()).toHaveText('16.0')
      await expect(global.locator('[data-key-stat="rush_yds"] p').first()).toHaveText('180')
    } else {
      await expect(global.locator('[data-key-stats="primary"]')).toBeVisible()
    }
    await page.waitForTimeout(300)
    await page.screenshot({ path: process.env.PP_GLOBAL_SHOT ?? test.info().outputPath('player-modal-global.png') })

    // Tapping the basis opens Scoring; switching re-scores the view.
    await global.locator('[data-core-basis]').click()
    await expect(global.locator('[data-section="scoring"]')).toBeVisible()
    await global.locator('[data-core-scoring]').click()
    await page.locator('[data-core-scoring-option="ppr"]').click()
    await expect(global.locator('[data-core-basis]')).toHaveText('Full PPR scoring', { timeout: 30_000 })
    // Full stats expands in place.
    await global.locator('[data-section-toggle="stats"]').click()
    await expect(global.locator('[data-section-toggle="stats"]')).toHaveAttribute('aria-expanded', 'true')
    await expect(global.locator('[data-section="stats"]')).toBeVisible()
    await global.locator('[data-section="stats"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: process.env.PP_SECTION_SHOT ?? test.info().outputPath('player-modal-section.png') })
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)

    // Mobile: the modal is a full-screen sheet, no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 844 })
    await link.click()
    await page.getByRole('button', { name: 'Open player view' }).click()
    await expect(modal).toBeVisible({ timeout: 30_000 })
    const box = await modal.boundingBox()
    expect(box?.width).toBe(390)
    expect(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.waitForTimeout(300)
    await page.screenshot({ path: process.env.PP_MOBILE_SHOT ?? test.info().outputPath('player-modal-mobile.png') })
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1280, height: 900 })

    // The deep link renders the same view under the standard header.
    await page.goto(`/app/players/${playerId}`)
    const deep = page.locator('[data-player-view="page"]')
    await expect(deep).toBeVisible({ timeout: 60_000 })
    const shellHeader = page.locator('header:has(h3)')
    await expect(shellHeader.locator('h3')).toHaveText('Player')
    expect((await shellHeader.boundingBox())?.height).toBeLessThanOrEqual(60)
    await expect(deep.locator('[data-season-table]')).toBeVisible({ timeout: 30_000 })
    await context.close()
  })

  test('key stats per position on the deep link (RB / WR / QB)', async ({ browser }) => {
    const service = serviceClient()
    const context = await browser.newContext({ storageState: STORAGE_STATE.devPro, viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const lines: Record<string, (w: number) => Record<string, number>> = {
      RB: (w) => ({ rush_attempts: 15 + w, rush_yards: 60 + w * 5, rush_tds: w === 1 ? 1 : 0, targets: 3, receptions: 2, receiving_yards: 15 }),
      WR: (w) => ({ targets: 8, receptions: 5 + (w % 2), receiving_yards: 70 + w * 4, receiving_tds: w === 3 ? 1 : 0 }),
      QB: (w) => ({ pass_attempts: 33, pass_completions: 22, pass_yards: 250 + w * 10, pass_tds: 2, interceptions: w === 2 ? 1 : 0, rush_attempts: 4, rush_yards: 18, rush_tds: 0 }),
    }
    for (const pos of ['RB', 'WR', 'QB'] as const) {
      const { data: p, error } = await service.from('players').select('id').eq('position', pos).not('team', 'is', null).not('id', 'in', `(${seededStatsPlayer ?? 'none'})`).order('adp', { ascending: true, nullsFirst: false }).limit(1).single()
      if (error) throw error
      const clear = await service.from('player_stats').select('id').eq('season', SEED_SEASON).eq('player_id', p.id).in('week', [1, 2, 3])
      if ((clear.data ?? []).length > 0) throw new Error(`${p.id} already has 2026 wk1–3 lines locally — refusing to seed over them`)
      const ins = await service.from('player_stats').insert([1, 2, 3].map((week) => ({ player_id: p.id, season: SEED_SEASON, week, ...lines[pos](week) })))
      if (ins.error) throw ins.error
      seededKeyStatPlayers.push(p.id)
      await page.goto(`/app/players/${p.id}`)
      const view = page.locator('[data-player-view="page"]')
      await expect(view.locator('[data-key-stats="primary"]')).toBeVisible({ timeout: 60_000 })
      if (pos === 'QB') await expect(view.locator('[data-key-stat="comp_pct"] p').first()).toHaveText('66.7%')
      if (pos === 'WR') await expect(view.locator('[data-key-stat="ypt"] p').first()).toHaveText(/^\d+\.\d$/)
      await page.screenshot({ path: process.env[`PP_KEY_${pos}_SHOT`] ?? test.info().outputPath(`player-key-stats-${pos}.png`) })
    }
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
