import { expect, test } from '@playwright/test'

import { SEASON_ROUNDS } from '@/lib/leagues/sim/plan'

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
    await link.click()
    await expect(page.locator('[data-card-actions="league"]')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Open full page' }).click()

    await page.waitForURL(`**/app/players/${playerId}?league=${leagueId}`, { timeout: 60_000 })
    const full = page.locator('[data-player-page="league"]')
    await expect(full).toBeVisible({ timeout: 60_000 })
    await expect(full.locator('[data-viewing-in]')).toHaveText(/^Viewing in .+/, { timeout: 30_000 })
    await expect(full.locator('[data-card-where]')).toHaveText(/^On your team in /, { timeout: 30_000 })
    await expect(full.locator('[data-card-action="drop"]')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('player-page-league.png'), fullPage: true })

    await page.locator('[data-player-back]').click()
    await page.waitForURL(`**${teamUrl}`, { timeout: 30_000 })
    await expect(page.locator('[data-bench]')).toBeVisible({ timeout: 60_000 })

    // The global variant: "Your leagues" with this league's row.
    await page.goto(`/app/players/${playerId}`)
    const global = page.locator('[data-player-page="global"]')
    await expect(global).toBeVisible({ timeout: 60_000 })
    await expect(global.locator(`[data-card-league-row="${leagueId}"]`)).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: test.info().outputPath('player-page-global.png'), fullPage: true })
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
