import { expect, test, type Page } from '@playwright/test'

import { SEASON_ROUNDS } from '@/lib/leagues/sim/plan'

import { assertPlayerPoolPresent, cleanupSweep, driveDraftToCompletion, readLeague, readTeamRoster, serviceClient } from './helpers/harness'
import { provisionLeague, signInDev, signInDevPro, type ProvisionedLeague } from './helpers/provision'
import { STORAGE_STATE } from './helpers/local-env'

/**
 * Spec — the player card everywhere, with league actions (League UX batch 2;
 * Chris 2026-10-03: "when I click on a player who is on my roster, there is
 * no option to drop them and the player detail card is not opening up").
 *
 *   1. As the manager (dev-pro@): on My Team, a player's NAME opens his card
 *      in the league context ("On your team in …"); Drop asks first, in
 *      plain words; confirming drops him — the server's roster no longer
 *      holds him and the team page no longer lists him.
 *   2. As the commissioner (dev@) on the manager's team: the card shows HIS
 *      own view — "On <Team>" with Propose trade, never a Drop for someone
 *      else's player (acting-as stays in the commissioner tools).
 *
 * TIME: the 2099 synthetic season's week 1, from WALL time — nothing has
 * kicked off, so no player is locked (the `inseason-week` shape).
 */

const TEAM_COUNT = 8

let league: ProvisionedLeague | null = null
const fixture = (): ProvisionedLeague => {
  if (!league) throw new Error('the league fixture was not provisioned (beforeAll failed)')
  return league
}

async function openTeam(page: Page, leagueId: string, teamId: string): Promise<void> {
  await page.goto(`/app/leagues/${leagueId}/team/${teamId}`)
  await expect(page.locator('[data-bench]')).toBeVisible({ timeout: 60_000 })
}

test.describe.configure({ mode: 'serial' })

test.describe('the player card — open from My Team, drop with confirmation (real browser)', () => {
  test.beforeAll(async () => {
    test.setTimeout(300_000)
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
    const commish = await signInDev()
    const manager = await signInDevPro()
    league = await provisionLeague({
      nameSuffix: 'player card',
      teamCount: TEAM_COUNT,
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
    expect(await readLeague(service, league.leagueId)).toMatchObject({ status: 'in_season' })
  })

  test.afterAll(async () => {
    await cleanupSweep(serviceClient())
  })

  test('manager: the name opens the card; Drop → confirm → he is gone', async ({ browser }) => {
    const { leagueId, managerTeamId } = fixture()
    const service = serviceClient()
    const before = await readTeamRoster(service, leagueId, managerTeamId!)
    const context = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    const page = await context.newPage()
    await openTeam(page, leagueId, managerTeamId!)

    // A bench player's name — the door to his card.
    const benchLink = page.locator('[data-bench] [data-player-link]').first()
    await expect(benchLink).toBeVisible()
    const playerId = await benchLink.getAttribute('data-player-link')
    const name = (await benchLink.textContent())?.trim() ?? ''
    expect(before.map((p) => p.player_id)).toContain(playerId)
    await benchLink.click()

    const actions = page.locator('[data-card-actions="league"]')
    await expect(actions).toBeVisible({ timeout: 30_000 })
    await expect(actions.locator('[data-card-where]')).toHaveText(/^On your team in /, { timeout: 30_000 })
    await actions.locator('[data-card-action="drop"]').click()
    await expect(actions.locator('[data-drop-copy]')).toHaveText(`${name} leaves your roster, and other teams can pick him up.`)

    const posted = page.waitForResponse(
      (res) => new URL(res.url()).pathname === `/api/leagues/${leagueId}/transactions` && res.request().method() === 'POST',
      { timeout: 60_000 },
    )
    await actions.locator('[data-drop-confirm]').click()
    const response = await posted
    expect(response.status(), `the drop answered ${response.status()}`).toBe(200)
    await expect(actions.locator('[data-drop-copy]')).toHaveText(`Dropped ${name}.`)

    // The server's roster no longer holds him, and neither does the page.
    const after = await readTeamRoster(service, leagueId, managerTeamId!)
    expect(after.map((p) => p.player_id)).not.toContain(playerId)
    expect(after.length).toBe(before.length - 1)
    await expect(page.locator(`[data-player="${playerId}"]`)).toHaveCount(0, { timeout: 30_000 })
    await context.close()
  })

  test('commissioner on another team: his own view — Propose trade, no Drop', async ({ browser }) => {
    const { leagueId, managerTeamId } = fixture()
    const context = await browser.newContext({ storageState: STORAGE_STATE.dev })
    const page = await context.newPage()
    await openTeam(page, leagueId, managerTeamId!)
    await page.locator('[data-bench] [data-player-link]').first().click()
    const actions = page.locator('[data-card-actions="league"]')
    await expect(actions.locator('[data-card-where]')).toHaveText(/^On .+ · /, { timeout: 30_000 })
    await expect(actions.locator('[data-card-action="trade"]')).toBeVisible()
    await expect(actions.locator('[data-card-action="drop"]')).toHaveCount(0)
    // D481: another team's player has no "+".
    await expect(actions.locator('[data-card-action="acquire"]')).toHaveCount(0)
    await context.close()
  })
  // D481(n) (Chris 2026-10-03, "Always confirm first"; clarified: an instant
  // add or a waiver claim gets a confirm, a FAAB claim's step IS its bid).
  // The + on a free agent opens ONE step on both surfaces — nothing is sent
  // until its button is pressed, and Cancel returns to where it started.
  test('manager: the + opens one step first — on the Players page and on the card; Cancel sends nothing', async ({ browser }) => {
    const { leagueId } = fixture()
    const context = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    const page = await context.newPage()
    const posts: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/api\/leagues\/[^/]+\/(transactions|waivers)$/.test(new URL(req.url()).pathname)) posts.push(req.url())
    })
    await page.goto(`/app/leagues/${leagueId}/players`)
    const row = page.locator('[data-pool-row][data-availability]').filter({ has: page.locator('[data-action="acquire"]:not([disabled])') }).first()
    await expect(row).toBeVisible({ timeout: 60_000 })
    const plus = row.locator('[data-action="acquire"]')
    const kind = await plus.getAttribute('data-acquire')
    expect(kind === 'add' || kind === 'claim', `the + runs an add or a claim (got ${kind})`).toBe(true)

    // Surface 1 — the Players page row: the dialog's one step.
    await plus.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('[data-acquire-copy]')).toBeVisible()
    await expect(dialog.locator(`[data-acquire-confirm="${kind}"]`)).toHaveText(kind === 'add' ? 'Add' : 'Place claim')
    await page.screenshot({ path: test.info().outputPath('confirm-players-page.png') })
    await dialog.locator('[data-acquire-cancel]').click()
    await expect(dialog).toHaveCount(0)
    await expect(plus).toBeEnabled()

    // Surface 2 — the same player's card: the step inline, then Cancel.
    await row.locator('[data-player-link]').first().click()
    const actions = page.locator('[data-card-actions="league"]')
    await expect(actions).toBeVisible({ timeout: 30_000 })
    const cardPlus = actions.locator('[data-card-action="acquire"]')
    await expect(cardPlus).toHaveAttribute('data-acquire', kind!)
    await expect(actions.locator('[data-card-acquire-choice]')).toHaveCount(0)
    await cardPlus.click()
    await expect(actions.locator('[data-card-acquire-choice]')).toBeVisible()
    await expect(actions.locator('[data-card-acquire-copy]')).toBeVisible()
    await expect(actions.locator('[data-card-acquire-confirm]')).toHaveText(kind === 'add' ? 'Add' : 'Place claim')
    await expect(cardPlus).toBeDisabled()
    await page.screenshot({ path: test.info().outputPath('confirm-player-card.png') })
    await actions.locator('[data-card-acquire-cancel]').click()
    await expect(actions.locator('[data-card-acquire-choice]')).toHaveCount(0)
    await expect(cardPlus).toBeEnabled()

    expect(posts, 'a + and a Cancel send nothing').toEqual([])
    await context.close()
  })
})
