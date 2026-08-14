import { expect, test } from '@playwright/test'

import {
  bumpLeagueSeason,
  cleanupSweep,
  readLeague,
  readLeagueScheduledInstant,
  serviceClient,
} from './helpers/harness'
import { E2E_LEAGUE_PREFIX, STORAGE_STATE } from './helpers/local-env'

/**
 * Spec (d) — the deferred Phase A journey E2E (M2 task L.B5.1; D39's debt):
 * create modal → configure → invite → claim → scheduled, every step through
 * the real UI in two browser contexts (commissioner dev@, manager dev-pro@).
 *
 * The M1 Phase A gate proved this journey at the integration level plus a
 * screenshot browser pass (the D39 waiver); this spec is the promised
 * browser-automated twin.
 *
 * F49 discipline (the L.B7.1 sweep's NON-LITERAL arm — this file was the
 * row's fifth member): the schedule is still set through the real UI's
 * Month/Day/Time pickers, but the picker pins year = the league's SEASON,
 * so the harness bumps the created league's season to a far-future year
 * (job 5) BEFORE the schedule step — the stored instant lands in that year
 * by construction and the live 5s cron can never auto-start the committed
 * league mid-run. Asserted below (the stored year must equal the bumped
 * season), and the league graph is swept in `finally` regardless (the R285
 * class).
 */

/** Far-future season for the F49 bump — matches the 2028 discipline the
 *  provisioned specs and the sim already use. */
const F49_SEASON = 2028

const LEAGUE_NAME = `${E2E_LEAGUE_PREFIX} journey`

test.describe('Phase A journey (create → configure → invite → claim → scheduled)', () => {
  test.beforeAll(async () => {
    // A crashed prior run must never poison this one (the R285 class).
    await cleanupSweep(serviceClient())
  })

  test.afterAll(async () => {
    await cleanupSweep(serviceClient())
  })

  test('the full commissioner + manager journey lands the league in `scheduled`', async ({
    browser,
  }) => {
    test.setTimeout(240_000)

    const commishContext = await browser.newContext({ storageState: STORAGE_STATE.dev })
    const managerContext = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    try {
      const commish = await commishContext.newPage()

      // ---- Create (the 3-step modal — PR #71's surface, D86) -------------
      await commish.goto('/app/leagues')
      await commish.getByRole('button', { name: 'Create league' }).first().click()
      await expect(commish.getByRole('heading', { name: 'Create a league' })).toBeVisible()

      // Step 1 — Basics: name + team count (8 keeps the fixture small).
      await commish.locator('#create-league-name').fill(LEAGUE_NAME)
      await commish.getByRole('combobox', { name: 'Number of teams' }).click()
      await commish.getByRole('option', { name: '8', exact: true }).click()
      await commish.getByRole('button', { name: 'Next', exact: true }).click()

      // Step 2 — Draft & scoring: Snake is the default card; assert instead
      // of re-clicking (the selected state is the evidence).
      await expect(commish.getByRole('button', { name: /Snake/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await commish.getByRole('button', { name: 'Next', exact: true }).click()

      // Step 3 — Scoring template: the default style pick is PPR, which
      // filters the card list to the PPR templates — pick ESPN Full PPR.
      await commish.getByRole('button', { name: /ESPN Full PPR/ }).click()
      await commish.getByRole('button', { name: 'Create league', exact: true }).click()

      // Success step (§7.4's attach offer) → league home.
      await expect(commish.getByText(`${LEAGUE_NAME} is live`)).toBeVisible({
        timeout: 30_000,
      })
      await commish.getByRole('button', { name: 'Go to league' }).click()
      await commish.waitForURL(/\/app\/leagues\/[0-9a-f-]{36}$/, { timeout: 60_000 })
      const leagueUrl = new URL(commish.url())
      const leagueId = leagueUrl.pathname.split('/').pop()!
      await expect(commish.getByText(LEAGUE_NAME).first()).toBeVisible()

      // ---- Invite: the commissioner share link (Q5's v1 minimum bar) -----
      const shareLink = await commish.locator('#share-link').inputValue()
      expect(shareLink, 'the invite panel renders a /join share link').toContain('/join/')
      const joinPath = new URL(shareLink).pathname

      // ---- Claim: the manager follows the link and joins -----------------
      const manager = await managerContext.newPage()
      await manager.goto(joinPath)
      await expect(manager.getByText(LEAGUE_NAME).first()).toBeVisible()
      await manager.getByRole('button', { name: 'Join league' }).click()
      await manager.waitForURL(`**/app/leagues/${leagueId}`, { timeout: 60_000 })
      await expect(manager.getByText(LEAGUE_NAME).first()).toBeVisible()

      // ---- F49 (job 5): bump the season BEFORE the schedule step — the
      // settings picker builds its instant from the league's season year.
      await bumpLeagueSeason(serviceClient(), leagueId, F49_SEASON)

      // ---- Configure: schedule the draft (settings → Month/Day/Time) -----
      await commish.goto(`/app/leagues/${leagueId}/settings`)
      // The group cards are native collapsed <details> — expand the
      // schedule card before reaching for its pickers.
      await commish.locator('summary').filter({ hasText: 'Schedule the draft' }).click()
      await commish.getByRole('combobox', { name: 'Draft month' }).click()
      await commish.getByRole('option', { name: 'December' }).click()
      await commish.getByRole('combobox', { name: 'Draft day' }).click()
      await commish.getByRole('option', { name: '30', exact: true }).click()
      await commish.getByRole('combobox', { name: 'Draft time' }).click()
      await commish.getByRole('option', { name: '8:00 PM' }).click()
      await commish.getByRole('button', { name: 'Save changes' }).click()
      await expect(commish.getByText('All changes saved.')).toBeVisible({ timeout: 30_000 })

      // ---- Scheduled: the setup hero's D120(4) flip ----------------------
      await commish.goto(`/app/leagues/${leagueId}`)
      await commish.getByRole('button', { name: 'Schedule the draft' }).click()
      // The scheduled hero renders the real F38-discharge CTAs.
      await expect(commish.getByRole('link', { name: 'Enter draft lobby' })).toBeVisible({
        timeout: 30_000,
      })

      // Authoritative confirmation (harness read — job 4, via the named
      // helper per R297): the league row itself says `scheduled`, not just
      // the hero — and the name proves the URL-derived id is OUR league.
      const leagueRow = await readLeague(serviceClient(), leagueId)
      expect(leagueRow.name).toBe(LEAGUE_NAME)
      expect(leagueRow.status).toBe('scheduled')

      // The F49 arm held: the UI-set instant's year FOLLOWED the bumped
      // season (non-literal by construction — never cron bait). Falsifiable:
      // drop the bump above and this reads 2026. (Named job-4 helper — R297.)
      const storedInstant = await readLeagueScheduledInstant(serviceClient(), leagueId)
      expect(storedInstant, 'the schedule step stored an instant').toBeTruthy()
      expect(new Date(storedInstant!).getUTCFullYear()).toBe(F49_SEASON)

      // The manager sees the scheduled state too (cross-client journey end).
      await manager.goto(`/app/leagues/${leagueId}`)
      await expect(manager.getByText('Draft scheduled').first()).toBeVisible()
    } finally {
      await commishContext.close()
      await managerContext.close()
    }
  })
})
