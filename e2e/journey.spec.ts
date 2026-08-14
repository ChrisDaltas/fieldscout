import { expect, test } from '@playwright/test'

import { cleanupSweep, serviceClient } from './helpers/harness'
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
 * F49 discipline: the schedule set here is Dec 30 of the league's season —
 * months past any run date this file will see before L.B7.1's sweep, and
 * the league graph is swept in `finally` regardless (the R285 class).
 */

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

      // Authoritative confirmation (harness read — job 4): the league row
      // itself says `scheduled`, not just the hero.
      const { data, error } = await serviceClient()
        .from('leagues')
        .select('status, name')
        .eq('id', leagueId)
        .single()
      expect(error).toBeNull()
      expect(data?.name).toBe(LEAGUE_NAME)
      expect(data?.status).toBe('scheduled')

      // The manager sees the scheduled state too (cross-client journey end).
      await manager.goto(`/app/leagues/${leagueId}`)
      await expect(manager.getByText('Draft scheduled').first()).toBeVisible()
    } finally {
      await commishContext.close()
      await managerContext.close()
    }
  })
})
