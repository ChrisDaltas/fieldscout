import { expect, test } from '@playwright/test'

import { SEASON_ROUNDS } from '@/lib/leagues/sim/plan'

import { assertPlayerPoolPresent, cleanupSweep, driveDraftToCompletion, readLeague, readTeamRoster, serviceClient } from './helpers/harness'
import { provisionLeague, signInDev, signInDevPro, type ProvisionedLeague } from './helpers/provision'
import { STORAGE_STATE } from './helpers/local-env'

/**
 * Spec — the right rail's Players tool (D483, Chris 2026-10-03, built to the
 * Claude Design prototype's ResearchRail): on My Team the tool is scoped to
 * the league; search finds a free agent; his + is the player card's own
 * flow (D481 — one confirm step, the drop picker on a full roster); after
 * Add he is on the manager's bench, on the server and on the page.
 *
 * TIME: the 2099 synthetic season's week 1 from WALL time — nothing has
 * kicked off, so nobody is locked (the player-card spec's shape).
 */

let league: ProvisionedLeague | null = null
const fixture = (): ProvisionedLeague => {
  if (!league) throw new Error('the league fixture was not provisioned (beforeAll failed)')
  return league
}

test.describe.configure({ mode: 'serial' })

test.describe('the rail Players tool — search, +, confirm, on the bench (real browser)', () => {
  test.beforeAll(async () => {
    test.setTimeout(300_000)
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
    league = await provisionLeague({
      nameSuffix: 'rail players',
      teamCount: 8,
      rounds: SEASON_ROUNDS,
      season: true,
      clockSeconds: 30,
      // Free agency with no waivers: the + is an instant add (the
      // inseason-lock spec's fixture shape).
      waiverType: 'none_fcfs',
      commish: await signInDev(),
      manager: await signInDevPro(),
      order: 'commish-first',
      createDraftRow: true,
      start: true,
    })
    await driveDraftToCompletion(service, league.draftId!, { maxSteps: 200 })
    expect(await readLeague(service, league.leagueId)).toMatchObject({ status: 'in_season' })
  })

  test.afterAll(async () => {
    await cleanupSweep(serviceClient())
  })

  test('manager on My Team: open the rail, search, + a free agent → confirm → he is on the bench', async ({ browser }) => {
    const { leagueId, managerTeamId } = fixture()
    const service = serviceClient()
    const before = await readTeamRoster(service, leagueId, managerTeamId!)
    const context = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    const page = await context.newPage()
    await page.goto(`/app/leagues/${leagueId}/team/${managerTeamId}`)
    await expect(page.locator('[data-bench]')).toBeVisible({ timeout: 60_000 })

    // Open the tool (close any persisted panel first so the toggle opens it).
    const tool = page.locator('[data-rail-tool="players"]')
    if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click()
    const panel = page.getByRole('complementary', { name: 'Players panel' })
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-rail-adds-to]')).toHaveText(/^Adds go to /, { timeout: 60_000 })
    await expect(panel.locator('[data-rail-switch-label]')).toHaveText('Free agents')

    // A free agent the + adds instantly — then find him by search.
    const firstAdd = panel.locator('[data-rail-row]').filter({ has: page.locator('[data-acquire="add"]:not([disabled])') }).first()
    await expect(firstAdd).toBeVisible({ timeout: 60_000 })
    const playerId = (await firstAdd.getAttribute('data-rail-row'))!
    const name = ((await firstAdd.locator('[data-player-link]').textContent()) ?? '').trim()
    expect(before.map((p) => p.player_id)).not.toContain(playerId)
    await panel.getByRole('textbox', { name: 'Search players' }).fill(name)
    const row = panel.locator(`[data-rail-row="${playerId}"]`)
    await expect(row).toBeVisible({ timeout: 30_000 })

    // The + opens the one step first — nothing is sent until Add.
    await row.locator('[data-card-action="acquire"]').click()
    await expect(row.locator('[data-card-acquire-copy]')).toBeVisible()
    await expect(row.locator('[data-card-acquire-confirm]')).toHaveText('Add')
    const picker = row.locator('[data-card-drop-pick]')
    if (await picker.count()) {
      // Full roster: the drop picker is in the same step; Add stays off until a pick.
      await expect(row.locator('[data-card-acquire-confirm]')).toBeDisabled()
      const benchDrop = await page.locator('[data-bench] [data-player-link]').first().getAttribute('data-player-link')
      expect(benchDrop, 'a bench player to drop').toBeTruthy()
      await picker.selectOption(benchDrop!)
    }
    const posted = page.waitForResponse(
      (res) => new URL(res.url()).pathname === `/api/leagues/${leagueId}/transactions` && res.request().method() === 'POST',
      { timeout: 60_000 },
    )
    await row.locator('[data-card-acquire-confirm]').click()
    const response = await posted
    expect(response.status(), `the add answered ${response.status()}`).toBe(200)
    // The panel keeps the readout after he leaves the free-agent list.
    await expect(panel.locator('[data-card-result]').first()).toHaveText(new RegExp(`^Added ${name}`))

    // On the server's roster — and on the page's bench.
    const after = await readTeamRoster(service, leagueId, managerTeamId!)
    expect(after.map((p) => p.player_id)).toContain(playerId)
    await expect(page.locator(`[data-bench] [data-player-link="${playerId}"]`)).toBeVisible({ timeout: 30_000 })
    await context.close()
  })
})
